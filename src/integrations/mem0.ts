import { MemoryClient } from "mem0ai";
import type { MemoryCategory } from "../types/memory.js";

// Initialize client lazily to allow for missing API key during tests
let client: MemoryClient | null = null;

function getClient(): MemoryClient {
  if (!client) {
    const apiKey = process.env.MEM0_API_KEY;
    if (!apiKey) {
      throw new Error("MEM0_API_KEY environment variable is required");
    }
    client = new MemoryClient({ apiKey });
  }
  return client;
}

// Timeout wrapper for latency budget
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<{ result: T; timedOut: boolean }> {
  const timeout = new Promise<{ result: T; timedOut: boolean }>((resolve) =>
    setTimeout(() => resolve({ result: fallback, timedOut: true }), timeoutMs)
  );

  const success = promise.then((result) => ({ result, timedOut: false }));

  return Promise.race([success, timeout]);
}

// Constants
const LATENCY_BUDGET_MS = 500;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 100;

// Simple retry wrapper for transient failures
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Don't retry on auth errors or client errors
      if (
        lastError.message.includes("401") ||
        lastError.message.includes("403") ||
        lastError.message.includes("400")
      ) {
        throw lastError;
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

// Types for mem0 API responses
interface Mem0AddResponse {
  results?: Array<{
    id: string;
    memory: string;
  }>;
}

interface Mem0SearchResult {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface Mem0SearchResponse {
  results?: Mem0SearchResult[];
}

interface Mem0GetAllResponse {
  results?: Array<{
    id: string;
    memory: string;
    metadata?: Record<string, unknown>;
  }>;
}

/**
 * Add a memory to mem0 Cloud
 * Uses couple_id as the user_id in mem0 for proper isolation
 *
 * Best practice: Pass both user statement and assistant acknowledgment
 * so mem0 understands the context better.
 */
export async function addMemoryToMem0(
  coupleId: string,
  content: string,
  metadata: {
    category: MemoryCategory;
    userId?: string | null;
    sourceThreadId?: string | null;
    sourceVisibility?: "shared" | "dm" | null;
  }
): Promise<{ mem0Id: string | null; error?: string }> {
  try {
    // mem0 best practice: include both user content and acknowledgment
    // This helps mem0 understand the memory was intentionally stored
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content },
      { role: "assistant", content: "I'll remember that." },
    ];

    const response = (await withRetry(async () =>
      getClient().add(messages, {
        user_id: coupleId, // Couple-scoped isolation
        metadata: {
          category: metadata.category,
          user_id: metadata.userId ?? null,
          source_thread_id: metadata.sourceThreadId ?? null,
          source_visibility: metadata.sourceVisibility ?? null,
        },
      })
    )) as unknown as Mem0AddResponse;

    // mem0 returns array of created memories
    const mem0Id = response.results?.[0]?.id ?? null;
    return { mem0Id };
  } catch (error) {
    console.error("[mem0] Failed to add memory:", error);
    return { mem0Id: null, error: String(error) };
  }
}

/**
 * Search memories in mem0 Cloud
 * Returns within latency budget or empty array
 */
export async function searchMemoriesInMem0(
  coupleId: string,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT
): Promise<{
  memories: Array<{
    mem0Id: string;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
  }>;
  timedOut: boolean;
  error?: string;
}> {
  try {
    const searchPromise = getClient().search(query, {
      user_id: coupleId,
      limit,
    }) as Promise<Mem0SearchResponse>;

    const { result, timedOut } = await withTimeout(
      searchPromise,
      LATENCY_BUDGET_MS,
      { results: [] }
    );

    if (timedOut) {
      console.warn("[mem0] Search timed out, falling back to local DB");
      return { memories: [], timedOut: true };
    }

    const memories = (result.results ?? []).map((r: Mem0SearchResult) => ({
      mem0Id: r.id,
      content: r.memory,
      score: r.score ?? 0,
      metadata: r.metadata ?? {},
    }));

    return { memories, timedOut: false };
  } catch (error) {
    console.error("[mem0] Search failed:", error);
    return { memories: [], timedOut: false, error: String(error) };
  }
}

/**
 * Update a memory in mem0 Cloud
 */
export async function updateMemoryInMem0(
  mem0Id: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await getClient().update(mem0Id, { text: content });
    return { success: true };
  } catch (error) {
    console.error("[mem0] Failed to update memory:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Delete a memory from mem0 Cloud
 */
export async function deleteMemoryFromMem0(
  mem0Id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await getClient().delete(mem0Id);
    return { success: true };
  } catch (error) {
    console.error("[mem0] Failed to delete memory:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get all memories for a couple (for debugging/admin)
 */
export async function getAllMemoriesFromMem0(coupleId: string): Promise<{
  memories: Array<{
    mem0Id: string;
    content: string;
    metadata: Record<string, unknown>;
  }>;
  error?: string;
}> {
  try {
    const response = (await getClient().getAll({
      user_id: coupleId,
    })) as Mem0GetAllResponse;

    const memories = (response.results ?? []).map((r) => ({
      mem0Id: r.id,
      content: r.memory,
      metadata: r.metadata ?? {},
    }));

    return { memories };
  } catch (error) {
    console.error("[mem0] Failed to get all memories:", error);
    return { memories: [], error: String(error) };
  }
}
