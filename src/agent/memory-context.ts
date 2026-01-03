import { searchMemories } from "../db/queries/memories.js";
import type { MemorySearchResult } from "../types/memory.js";
import type { SessionContext } from "./system-prompt.js";

// Patterns that indicate memory retrieval is likely useful
const MEMORY_TRIGGER_PATTERNS = [
  // Questions about people
  /\b(who|what|when|where|how)\b.*\b(is|are|was|were|does|do|did)\b/i,
  // References to relationships
  /\b(my|our|partner'?s?)\s+(mom|dad|mother|father|brother|sister|boss|friend|doctor|dentist)/i,
  // Preferences
  /\b(like|love|hate|prefer|favorite|allergic|can't eat|don't eat)/i,
  // Memory-related
  /\b(remember|forgot|told you|mentioned|said)\b/i,
  // Planning that might need context
  /\b(plan|schedule|book|reserve|arrange)\b/i,
  // Dates and events
  /\b(birthday|anniversary|appointment|meeting)\b/i,
];

// Patterns that indicate memory retrieval is NOT needed
const SKIP_PATTERNS = [
  // Simple greetings
  /^(hi|hey|hello|good morning|good afternoon|good evening|yo|sup)[\s!.?]*$/i,
  // Simple acknowledgments
  /^(ok|okay|sure|thanks|thank you|thx|got it|cool|nice|great|perfect|yes|no|yep|nope)[\s!.?]*$/i,
  // Commands
  /^\/(link|unlink|status|auth|calendar|help)/i,
  // Very short messages
  /^.{1,10}$/,
];

/**
 * Determine if we should retrieve memories for this message
 */
export function shouldRetrieveMemories(message: string): boolean {
  // Skip if matches skip pattern
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(message)) {
      return false;
    }
  }

  // Retrieve if matches trigger pattern
  for (const pattern of MEMORY_TRIGGER_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  // For longer messages, default to retrieving
  // (more likely to benefit from context)
  return message.length > 50;
}

/**
 * Calculate dynamic limit based on query complexity
 */
function calculateMemoryLimit(message: string): number {
  const wordCount = message.split(/\s+/).length;
  const hasMultipleTopics = /\b(and|also|plus|as well)\b/i.test(message);
  const isQuestion = message.includes("?");

  let limit = 5; // Base limit

  if (wordCount > 20) limit += 3;
  if (hasMultipleTopics) limit += 3;
  if (isQuestion) limit += 2;

  return Math.min(limit, 15); // Cap at 15
}

/**
 * Retrieve memories relevant to the current message
 */
export async function getMemoriesForContext(
  context: SessionContext,
  message: string
): Promise<MemorySearchResult[]> {
  const limit = calculateMemoryLimit(message);

  return searchMemories({
    coupleId: context.coupleId,
    userId: context.userId,
    query: message,
    visibility: context.visibility,
    limit,
  });
}

/**
 * Format memories for inclusion in system prompt
 */
export function buildMemoryContext(memories: MemorySearchResult[]): string {
  if (memories.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("## What You Remember About This Couple\n");

  // Group by category for cleaner presentation
  const byCategory = {
    fact: memories.filter((m) => m.category === "fact"),
    relationship: memories.filter((m) => m.category === "relationship"),
    context: memories.filter((m) => m.category === "context"),
  };

  if (byCategory.fact.length > 0) {
    lines.push("**Facts:**");
    for (const m of byCategory.fact) {
      const source = m.from_partner ? " (from partner)" : "";
      lines.push(`- ${m.content}${source}`);
    }
    lines.push("");
  }

  if (byCategory.relationship.length > 0) {
    lines.push("**People:**");
    for (const m of byCategory.relationship) {
      const source = m.from_partner ? " (from partner)" : "";
      lines.push(`- ${m.content}${source}`);
    }
    lines.push("");
  }

  if (byCategory.context.length > 0) {
    lines.push("**Current Context:**");
    for (const m of byCategory.context) {
      const source = m.from_partner ? " (from partner)" : "";
      lines.push(`- ${m.content}${source}`);
    }
    lines.push("");
  }

  lines.push(`
**Using Memories:**
- When you use information from memory, cite it naturally: "I remember you mentioned..." or "You told me before that..."
- If you're uncertain about a memory, you can ask for confirmation
- If new information conflicts with what you remember, ask for clarification: "I thought you mentioned X - has that changed?"`);

  return lines.join("\n");
}
