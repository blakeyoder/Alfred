import { tool } from "ai";
import { z } from "zod";
import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import {
  search,
  extract,
  chatWithContext,
  type SearchResult,
} from "../../integrations/parallel.js";
import type { ToolContext } from "./reminders.js";

const tracer = trace.getTracer("alfred-web-search");

// ============ Phone Number Detection ============

/**
 * Patterns that indicate a query is looking for a phone number.
 */
const PHONE_QUERY_PATTERNS = [
  /phone\s*number/i,
  /call\s+/i,
  /contact/i,
  /\btel\b/i,
  /reach\s+(them|us)/i,
];

/**
 * Regex to extract phone numbers from text.
 */
const PHONE_NUMBER_REGEX =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;

/**
 * Check if a query is looking for a phone number.
 */
function isPhoneNumberQuery(query: string): boolean {
  return PHONE_QUERY_PATTERNS.some((pattern) => pattern.test(query));
}

/**
 * Extract phone numbers from text.
 */
function extractPhoneNumbers(text: string): string[] {
  const matches = text.match(PHONE_NUMBER_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Add phone number lookup attributes to a span.
 */
function addPhoneSpanAttributes(
  span: Span,
  query: string,
  results: string[],
  foundNumbers: string[]
): void {
  span.setAttributes({
    "phone_lookup.query": query,
    "phone_lookup.is_phone_query": isPhoneNumberQuery(query),
    "phone_lookup.results_count": results.length,
    "phone_lookup.found_numbers": foundNumbers.join(", "),
    "phone_lookup.found_number_count": foundNumbers.length,
  });
}

// ============ Schemas ============

const webSearchSchema = z.object({
  query: z
    .string()
    .describe("Natural language description of what to search for"),
  location: z
    .string()
    .optional()
    .describe(
      "Location context (city, zip, or address) if the search is location-specific. " +
        "Infer from conversation history when possible, or ask the user if needed."
    ),
  maxResults: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Maximum number of results to return"),
});

const webExtractSchema = z.object({
  url: z.string().url().describe("The URL to extract detailed content from"),
  focus: z
    .string()
    .optional()
    .describe(
      "What aspect to focus on extracting (e.g., 'menu and prices', 'hours and location')"
    ),
});

const webAnswerSchema = z.object({
  question: z
    .string()
    .describe(
      "The factual question to answer. Be specific and include relevant details " +
        "(e.g., 'What is the phone number for 4 Charles Prime Rib in NYC?')"
    ),
});

// ============ Constants ============

/**
 * Domains to always exclude from search results.
 * These sites have low signal-to-noise for recommendations.
 */
const EXCLUDED_DOMAINS = ["yelp.com", "tripadvisor.com"];

/**
 * Preferred sources for restaurant/food queries.
 * These will be searched explicitly in addition to general results.
 */
const RESTAURANT_PREFERRED_SOURCES = ["eater.com", "theinfatuation.com"];

/**
 * Keywords that indicate a restaurant/food-related query.
 */
const RESTAURANT_KEYWORDS = [
  "restaurant",
  "restaurants",
  "food",
  "dining",
  "eat",
  "eating",
  "dinner",
  "lunch",
  "breakfast",
  "brunch",
  "cafe",
  "coffee",
  "bar",
  "bars",
  "pizza",
  "sushi",
  "tacos",
  "burgers",
  "thai",
  "italian",
  "mexican",
  "chinese",
  "japanese",
  "indian",
  "french",
  "mediterranean",
  "steakhouse",
  "seafood",
  "vegetarian",
  "vegan",
];

function isRestaurantQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return RESTAURANT_KEYWORDS.some(
    (keyword) =>
      lowerQuery.includes(keyword) ||
      lowerQuery.includes(keyword.replace(/s$/, ""))
  );
}

// ============ Helper Functions ============

function formatSearchResult(
  result: SearchResult,
  index: number
): {
  index: number;
  title: string;
  url: string;
  excerpt: string;
} {
  return {
    index: index + 1,
    title: result.title ?? "Untitled",
    url: result.url,
    excerpt: result.excerpts?.join(" ") ?? "",
  };
}

// ============ Tool Factory ============

export function createWebSearchTools(
  _ctx: ToolContext,
  _partnerId: string | null
) {
  return {
    webSearch: tool({
      description:
        "Search the web for discovery and recommendation queries. " +
        "Use when exploring options (e.g., 'best Italian restaurants in Brooklyn', 'wine bars near me'). " +
        "Returns multiple URLs and excerpts for comparison. " +
        "For simple factual queries (phone numbers, hours, addresses), use webAnswer instead. " +
        "If the query is location-specific and no location is provided, ask the user.",
      inputSchema: webSearchSchema,
      execute: async ({ query, location, maxResults = 5 }) => {
        return tracer.startActiveSpan("webSearch", async (span) => {
          try {
            // Enhance query with location if provided
            const objective = location ? `${query} near ${location}` : query;

            span.setAttributes({
              "web_search.query": query,
              "web_search.objective": objective,
              "web_search.location": location ?? "",
              "web_search.max_results": maxResults,
            });

            // Build search queries - for restaurant queries, add explicit
            // queries for preferred sources to weight them higher
            const searchQueries: string[] = [];
            if (isRestaurantQuery(query)) {
              for (const source of RESTAURANT_PREFERRED_SOURCES) {
                searchQueries.push(`site:${source} ${objective}`);
              }
            }

            const response = await search({
              objective,
              search_queries:
                searchQueries.length > 0 ? searchQueries : undefined,
              max_results: maxResults,
              excerpts: {
                max_chars_per_result: 500,
              },
              source_policy: {
                exclude_domains: EXCLUDED_DOMAINS,
              },
            });

            // Track phone number lookups for debugging
            const allExcerpts = response.results
              .map((r) => r.excerpts?.join(" ") ?? "")
              .filter(Boolean);
            const foundNumbers = extractPhoneNumbers(allExcerpts.join(" "));
            addPhoneSpanAttributes(span, objective, allExcerpts, foundNumbers);

            if (response.results.length === 0) {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return {
                success: true,
                message: "No results found for your search.",
                results: [],
              };
            }

            span.setAttributes({
              "web_search.result_count": response.results.length,
            });
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();

            return {
              success: true,
              query: objective,
              resultCount: response.results.length,
              results: response.results.map(formatSearchResult),
            };
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : "Unknown error",
            });
            span.end();
            return {
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to perform web search",
              results: [],
            };
          }
        });
      },
    }),

    webExtract: tool({
      description:
        "Extract detailed content from a specific URL. Use after webSearch to get full details " +
        "about a specific result (complete menu, detailed reviews, full article text). " +
        "Not needed for simple facts - use webAnswer for those.",
      inputSchema: webExtractSchema,
      execute: async ({ url, focus }) => {
        try {
          const response = await extract({
            url,
            objective: focus,
          });

          return {
            success: true,
            url: response.url,
            title: response.title ?? "Untitled",
            content: response.content,
            extractedAt: response.extracted_at,
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to extract content from URL",
          };
        }
      },
    }),

    webAnswer: tool({
      description:
        "Get a direct answer to a factual question using real-time web search. " +
        "Best for specific factual queries like phone numbers, addresses, hours, prices, " +
        "current events, or any question with a definitive answer. " +
        "Returns the answer with citations. Prefer this over webSearch for simple factual lookups.",
      inputSchema: webAnswerSchema,
      execute: async ({ question }) => {
        return tracer.startActiveSpan("webAnswer", async (span) => {
          try {
            span.setAttributes({
              "web_answer.question": question,
              "web_answer.is_phone_query": isPhoneNumberQuery(question),
            });

            const response = await chatWithContext({
              model: "speed",
              messages: [
                {
                  role: "user",
                  content: question,
                },
              ],
              max_tokens: 500,
              temperature: 0.1,
            });

            const answer = response.choices[0]?.message?.content ?? "";

            // Track phone numbers found in the answer
            const foundNumbers = extractPhoneNumbers(answer);
            addPhoneSpanAttributes(span, question, [answer], foundNumbers);

            span.setAttributes({
              "web_answer.answer_length": answer.length,
              "web_answer.tokens_used": response.usage.total_tokens,
            });
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();

            return {
              success: true,
              question,
              answer,
              tokensUsed: response.usage.total_tokens,
            };
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : "Unknown error",
            });
            span.end();
            return {
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to answer question",
            };
          }
        });
      },
    }),
  };
}
