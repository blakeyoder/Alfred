import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { storeMemory, findSimilarMemories } from "../db/queries/memories.js";
import type { SessionContext } from "./system-prompt.js";
import type { ExtractedMemory, MemoryCategory } from "../types/memory.js";

// Schema for extraction response
const ExtractionSchema = z.object({
  memories: z.array(
    z.object({
      content: z.string().describe("The fact or information to remember"),
      category: z
        .enum(["fact", "relationship", "context"])
        .describe(
          "fact = personal facts/preferences, relationship = people/connections, context = ongoing situations"
        ),
      isExplicit: z
        .boolean()
        .describe("True if user explicitly asked to remember this"),
    })
  ),
  shouldConfirm: z
    .boolean()
    .describe('True if any explicit "remember this" request was made'),
});

// Patterns indicating explicit memory request
const EXPLICIT_REMEMBER_PATTERNS = [
  /\bremember\s+that\b/i,
  /\bdon't\s+forget\b/i,
  /\bkeep\s+in\s+mind\b/i,
  /\bmake\s+a?\s*note\b/i,
  /\bremember\s+this\b/i,
];

/**
 * Check if message contains explicit memory request
 */
export function hasExplicitMemoryRequest(message: string): boolean {
  return EXPLICIT_REMEMBER_PATTERNS.some((p) => p.test(message));
}

/**
 * Extract memories from a conversation turn
 */
export async function extractMemories(
  message: string,
  response: string,
  context: SessionContext
): Promise<{
  extracted: ExtractedMemory[];
  shouldConfirm: boolean;
}> {
  const hasExplicit = hasExplicitMemoryRequest(message);

  try {
    const result = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: ExtractionSchema,
      prompt: `Analyze this conversation and extract any information worth remembering long-term.

USER MESSAGE:
${message}

ASSISTANT RESPONSE:
${response}

CONTEXT:
- User: ${context.userName}
- Partner: ${context.partnerName ?? "unknown"}
- Thread type: ${context.visibility}
${hasExplicit ? "- User explicitly asked to remember something" : ""}

EXTRACTION GUIDELINES:
1. Extract FACTS about the user or their life (preferences, allergies, habits)
2. Extract RELATIONSHIPS (names of family, friends, colleagues, doctors)
3. Extract CONTEXT about ongoing situations (projects, travel, life events)

DO NOT extract:
- Transient conversation details ("yes", "thanks", "ok")
- Information already stored in reminders/calendar
- Speculative or hypothetical statements
- Repeated information (only extract if new)

For each memory, determine if it was:
- EXPLICIT: User said "remember that..." or similar
- IMPLICIT: User shared info naturally without asking to remember

Set shouldConfirm=true only if there was an explicit "remember this" request.

Return empty memories array if nothing worth remembering.`,
    });

    return {
      extracted: result.object.memories,
      shouldConfirm: result.object.shouldConfirm,
    };
  } catch (error) {
    console.error("[extraction] Failed to extract memories:", error);
    return { extracted: [], shouldConfirm: false };
  }
}

/**
 * Store extracted memories with conflict detection
 */
export async function storeExtractedMemories(
  extracted: ExtractedMemory[],
  context: SessionContext
): Promise<{
  stored: number;
  conflicts: Array<{ new: string; existing: string }>;
}> {
  const conflicts: Array<{ new: string; existing: string }> = [];
  let stored = 0;

  for (const memory of extracted) {
    // Check for similar existing memories (potential conflicts)
    const similar = await findSimilarMemories(context.coupleId, memory.content);

    if (similar.length > 0) {
      // Found potential conflict - don't store, flag for clarification
      conflicts.push({
        new: memory.content,
        existing: similar[0].content,
      });
      continue;
    }

    // Store the memory
    await storeMemory({
      coupleId: context.coupleId,
      userId: context.userId,
      content: memory.content,
      category: memory.category as MemoryCategory,
      sourceThreadId: context.threadId,
      sourceVisibility: context.visibility,
    });

    stored++;
  }

  return { stored, conflicts };
}

/**
 * Generate confirmation message for explicit memory requests
 */
export function generateConfirmation(
  stored: number,
  conflicts: Array<{ new: string; existing: string }>
): string | null {
  if (stored === 0 && conflicts.length === 0) {
    return null;
  }

  const parts: string[] = [];

  if (stored > 0) {
    parts.push("Got it, I'll remember that.");
  }

  if (conflicts.length > 0) {
    for (const conflict of conflicts) {
      parts.push(
        `I noticed this might conflict with something I already know: "${conflict.existing}". Has this changed?`
      );
    }
  }

  return parts.join(" ");
}
