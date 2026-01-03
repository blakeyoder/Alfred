import {
  addMemories,
  searchMemories,
} from "@mem0/vercel-ai-provider";

// Validate required environment variables
function validateEnv() {
  if (!process.env.MEM0_API_KEY) {
    throw new Error("MEM0_API_KEY environment variable is required");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
}

/**
 * Store memories from a conversation
 */
export async function storeMemories(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  coupleId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  validateEnv();
  const prompt = messages.map((m) => ({
    role: m.role,
    content: [{ type: "text" as const, text: m.content }],
  }));

  await addMemories(prompt, {
    user_id: coupleId,
    metadata,
    mem0ApiKey: process.env.MEM0_API_KEY,
  });
}

/**
 * Search memories semantically
 */
export async function searchMemoriesForCouple(
  query: string,
  coupleId: string,
  limit: number = 10
): Promise<
  Array<{
    id: string;
    memory: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>
> {
  validateEnv();
  const result = await searchMemories(query, {
    user_id: coupleId,
    top_k: limit,
    mem0ApiKey: process.env.MEM0_API_KEY,
  });

  // Handle different response formats from mem0
  if (Array.isArray(result)) {
    return result;
  }

  // If result has a results/memories array property, extract it
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.results)) {
      return obj.results as Array<{
        id: string;
        memory: string;
        score?: number;
        metadata?: Record<string, unknown>;
      }>;
    }
    if (Array.isArray(obj.memories)) {
      return obj.memories as Array<{
        id: string;
        memory: string;
        score?: number;
        metadata?: Record<string, unknown>;
      }>;
    }
  }

  // Fallback: return empty array if unexpected format
  console.warn("[mem0] Unexpected searchMemories response format:", result);
  return [];
}
