import { addMemories, searchMemories } from "@mem0/vercel-ai-provider";

// Validate required environment variables
function validateEnv() {
  if (!process.env.MEM0_API_KEY) {
    throw new Error("MEM0_API_KEY environment variable is required");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
}

// Declarative memory extraction rules for mem0
// These tell mem0's LLM what to extract vs ignore
const MEMORY_INCLUDES = [
  "personal facts and preferences",
  "dietary restrictions and allergies",
  "relationship information (names of family, friends, colleagues)",
  "life events and context (moving, new job, travel plans)",
  "birthdays and anniversaries",
  "hobbies and interests",
  "explicit requests to remember something",
].join(", ");

const MEMORY_EXCLUDES = [
  "transactional requests (booking tables, setting reminders, calendar events)",
  "queries and questions about current state",
  "greetings and acknowledgments",
  "search requests",
  "temporary scheduling details",
].join(", ");

const CUSTOM_INSTRUCTIONS = `
You are extracting memories for a couples assistant app. Only store durable personal
information that would be useful across multiple conversations. Do NOT store:
- One-time requests like "book a table" or "set a reminder"
- Ephemeral scheduling details
- Questions or queries
Focus on facts about the people, their preferences, relationships, and life context.
`.trim();

/**
 * Store memories from a conversation
 * Uses mem0's includes/excludes for intelligent filtering
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

  // Pass includes/excludes/custom_instructions to mem0 for intelligent extraction
  // These may not be in TypeScript types yet but are supported by the API
  await addMemories(prompt, {
    user_id: coupleId,
    metadata,
    mem0ApiKey: process.env.MEM0_API_KEY,
    includes: MEMORY_INCLUDES,
    excludes: MEMORY_EXCLUDES,
    custom_instructions: CUSTOM_INSTRUCTIONS,
  } as Record<string, unknown>);
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
