import { tool } from "ai";
import { z } from "zod";
import {
  search,
  extract,
  chatWithContext,
  type SearchResult,
} from "../../integrations/parallel.js";
import type { ToolContext } from "./reminders.js";

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

const webChatSchema = z.object({
  question: z
    .string()
    .describe(
      "Follow-up question about previous search results. " +
        "Use when the user wants more details about something already found."
    ),
  context: z
    .string()
    .describe(
      "Relevant context from previous search results (URLs, excerpts, etc.) " +
        "to help answer the question accurately."
    ),
});

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
        "Search the web for information like restaurants, products, news, services, etc. " +
        "Use for discovery queries. Returns URLs and excerpts. " +
        "If the query is location-specific and no location is provided, ask the user.",
      inputSchema: webSearchSchema,
      execute: async ({ query, location, maxResults = 5 }) => {
        try {
          // Enhance query with location if provided
          const objective = location ? `${query} near ${location}` : query;

          const response = await search({
            objective,
            max_results: maxResults,
            excerpts: {
              max_chars_per_result: 500,
            },
          });

          if (response.results.length === 0) {
            return {
              success: true,
              message: "No results found for your search.",
              results: [],
            };
          }

          return {
            success: true,
            query: objective,
            resultCount: response.results.length,
            results: response.results.map(formatSearchResult),
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to perform web search",
            results: [],
          };
        }
      },
    }),

    webExtract: tool({
      description:
        "Get detailed content from a specific URL. Use after webSearch to get more " +
        "information about a specific result (menu, hours, reviews, full article, etc.).",
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

    webChat: tool({
      description:
        "Ask a follow-up question about previous search results. " +
        "Use when the user wants clarification or additional details " +
        "about something already found via webSearch or webExtract. " +
        "Requires providing context from the previous results.",
      inputSchema: webChatSchema,
      execute: async ({ question, context }) => {
        try {
          const response = await chatWithContext({
            model: "parallel-small",
            messages: [
              {
                role: "system",
                content:
                  "You are a helpful assistant answering questions based on web search results. " +
                  "Be concise and accurate. If the context does not contain the answer, say so.",
              },
              {
                role: "user",
                content: `Context from previous search:\n${context}\n\nQuestion: ${question}`,
              },
            ],
            max_tokens: 500,
            temperature: 0.3,
          });

          const answer = response.choices[0]?.message?.content ?? "";

          return {
            success: true,
            answer,
            tokensUsed: response.usage.total_tokens,
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to process follow-up question",
          };
        }
      },
    }),
  };
}
