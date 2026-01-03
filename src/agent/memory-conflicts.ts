import {
  updateMemory,
  deleteMemory,
  findSimilarMemories,
} from "../db/queries/memories.js";
import type { Memory } from "../types/memory.js";

// Patterns indicating a correction
const CORRECTION_PATTERNS: Array<{
  pattern: RegExp;
  strength: "medium" | "strong";
}> = [
  { pattern: /\bactually\b/i, strength: "medium" },
  { pattern: /\bthat's not right\b/i, strength: "strong" },
  { pattern: /\bi meant\b/i, strength: "medium" },
  { pattern: /\bno,?\s+i\b/i, strength: "medium" },
  { pattern: /\bnot anymore\b/i, strength: "strong" },
  { pattern: /\bused to\b.*\bbut\b/i, strength: "strong" },
  { pattern: /\bhas changed\b/i, strength: "strong" },
  { pattern: /\bforget (that|what i said)\b/i, strength: "strong" },
];

/**
 * Detect if message contains a correction
 */
export function detectCorrection(message: string): {
  isCorrection: boolean;
  strength: "weak" | "medium" | "strong";
} {
  for (const { pattern, strength } of CORRECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { isCorrection: true, strength };
    }
  }
  return { isCorrection: false, strength: "weak" };
}

/**
 * Instructions to add to system prompt for conflict handling
 */
export const CONFLICT_HANDLING_INSTRUCTIONS = `
## Handling Conflicting Information

When you notice new information that conflicts with what you remember:
1. Ask for clarification before updating: "I thought you mentioned X - has that changed?"
2. Wait for confirmation before updating your memory
3. If user confirms the change, acknowledge: "Got it, I've updated my memory about that."

When user explicitly corrects you:
1. Acknowledge the correction
2. Update your memory
3. Apologize briefly if appropriate

Examples:
- User: "Actually, I'm not vegetarian anymore"
  You: "Thanks for letting me know! I've updated my memory - you're no longer vegetarian."

- User: "My mom's name is Sarah, not Susan"
  You: "Sorry about that! I've corrected it - your mom's name is Sarah."
`;

/**
 * Apply a correction to an existing memory
 */
export async function applyCorrection(
  memoryId: string,
  newContent: string | null // null = delete
): Promise<{ success: boolean; action: "updated" | "deleted" }> {
  if (newContent === null) {
    const deleted = await deleteMemory(memoryId);
    return { success: deleted, action: "deleted" };
  }

  const updated = await updateMemory(memoryId, { content: newContent });
  return { success: !!updated, action: "updated" };
}

/**
 * Find memory that might be the target of a correction
 */
export async function findCorrectionTarget(
  coupleId: string,
  message: string
): Promise<Memory | null> {
  // Extract potential subjects from the correction
  // e.g., "Actually my mom's name is Sarah" -> look for memories about "mom"

  const subjectPatterns = [
    /\b(my|our)\s+(\w+)(?:'s)?\s+(?:name\s+)?is/i,
    /\bi'm\s+(?:not\s+)?(\w+)/i,
    /\bi\s+(?:don't|do not)\s+(\w+)/i,
  ];

  for (const pattern of subjectPatterns) {
    const match = message.match(pattern);
    if (match) {
      const subject = match[2] || match[1];
      // Search for memories containing this subject
      const similar = await findSimilarMemories(coupleId, subject, 0.5);
      if (similar.length > 0) {
        return similar[0];
      }
    }
  }

  return null;
}
