/**
 * Parallel.ai API client for web search, extraction, and chat.
 * https://docs.parallel.ai/
 */
import OpenAI from "openai";

const PARALLEL_API_BASE = "https://api.parallel.ai";
const BETA_HEADER = "search-extract-2025-10-10";

// ============ Search API Types ============

interface SearchExcerptConfig {
  max_chars_per_result?: number;
  max_chars_total?: number;
}

interface SearchSourcePolicy {
  include_domains?: string[];
  exclude_domains?: string[];
  after_date?: string; // RFC 3339 format
}

export interface SearchRequest {
  objective: string;
  search_queries?: string[];
  max_results?: number;
  excerpts?: SearchExcerptConfig;
  source_policy?: SearchSourcePolicy;
}

export interface SearchResult {
  url: string;
  title: string | null;
  publish_date: string | null;
  excerpts: string[] | null;
}

export interface SearchResponse {
  search_id: string;
  results: SearchResult[];
  warnings: string[] | null;
}

// ============ Extract API Types ============

/** Internal API request format */
interface ExtractApiRequest {
  urls: string[];
  objective?: string;
}

/** Single extraction result from the API */
interface ExtractApiResult {
  url: string;
  title: string | null;
  content: string;
  extracted_at: string;
}

/** Internal API response format */
interface ExtractApiResponse {
  results: ExtractApiResult[];
}

/** Public request format (single URL for simplicity) */
export interface ExtractRequest {
  url: string;
  objective?: string;
}

/** Public response format (single result) */
export interface ExtractResponse {
  url: string;
  title: string | null;
  content: string;
  extracted_at: string;
}

// ============ Chat API Types ============

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

interface ChatChoice {
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: string;
}

export interface ChatResponse {
  choices: ChatChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============ Client Implementation ============

function getApiKey(): string {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) {
    throw new Error("PARALLEL_API_KEY environment variable is required");
  }
  return apiKey;
}

// OpenAI SDK client configured for Parallel's chat API
// Chat API uses Bearer auth (OpenAI-compatible), not x-api-key
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: getApiKey(),
      baseURL: PARALLEL_API_BASE,
    });
  }
  return openaiClient;
}

async function makeParallelRequest<TResponse>(
  endpoint: string,
  body: unknown,
  options: { useBetaHeader?: boolean } = {}
): Promise<TResponse> {
  const apiKey = getApiKey();

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };

  if (options.useBetaHeader) {
    headers["parallel-beta"] = BETA_HEADER;
  }

  const response = await fetch(`${PARALLEL_API_BASE}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Parallel API error (${response.status}): ${error}`);
  }

  return response.json() as Promise<TResponse>;
}

/**
 * Search the web using Parallel.ai's Search API.
 * Returns URLs and excerpts optimized for LLM consumption.
 */
export async function search(request: SearchRequest): Promise<SearchResponse> {
  return makeParallelRequest<SearchResponse>("/v1beta/search", request, {
    useBetaHeader: true,
  });
}

/**
 * Extract content from a specific URL.
 * Returns LLM-ready markdown content.
 */
export async function extract(
  request: ExtractRequest
): Promise<ExtractResponse> {
  // Transform to API format (urls array)
  const apiRequest: ExtractApiRequest = {
    urls: [request.url],
    objective: request.objective,
  };

  const response = await makeParallelRequest<ExtractApiResponse>(
    "/v1beta/extract",
    apiRequest,
    { useBetaHeader: true }
  );

  // Return first result (we only requested one URL)
  const result = response.results[0];
  if (!result) {
    throw new Error("No extraction result returned");
  }

  return result;
}

/**
 * Chat with context using Parallel.ai's Chat API.
 * Uses the OpenAI SDK since the endpoint is OpenAI-compatible.
 */
export async function chatWithContext(
  request: ChatRequest
): Promise<ChatResponse> {
  const client = getOpenAIClient();

  const response = await client.chat.completions.create({
    model: request.model,
    messages: request.messages,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
  });

  // Map OpenAI SDK response to our ChatResponse type
  return {
    choices: response.choices.map((choice) => ({
      message: {
        role: "assistant" as const,
        content: choice.message.content ?? "",
      },
      finish_reason: choice.finish_reason ?? "stop",
    })),
    usage: {
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      completion_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    },
  };
}
