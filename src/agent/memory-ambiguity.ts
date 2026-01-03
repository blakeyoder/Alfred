import type { SessionContext } from "./system-prompt.js";

// Possessive patterns that might be ambiguous in shared context
const AMBIGUOUS_PATTERNS = [
  /\bmy\s+(mom|dad|mother|father|brother|sister|boss|friend|doctor|dentist|therapist)/i,
  /\bmy\s+(\w+)'s\s+(name|birthday|number|address)/i,
];

/**
 * Detect potentially ambiguous possessive references
 */
export function detectAmbiguity(
  message: string,
  context: SessionContext
): {
  isAmbiguous: boolean;
  subject: string | null;
  clarificationPrompt: string | null;
} {
  // Only ambiguous in shared threads
  if (context.visibility !== "shared") {
    return { isAmbiguous: false, subject: null, clarificationPrompt: null };
  }

  for (const pattern of AMBIGUOUS_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const subject = match[1];
      const partnerName = context.partnerName ?? "your partner";

      return {
        isAmbiguous: true,
        subject,
        clarificationPrompt: `Just to be sure - do you mean your ${subject} or ${partnerName}'s ${subject}?`,
      };
    }
  }

  return { isAmbiguous: false, subject: null, clarificationPrompt: null };
}

/**
 * Instructions for handling ambiguity in system prompt
 */
export const AMBIGUITY_HANDLING_INSTRUCTIONS = `
## Handling Ambiguous References

In shared conversations, when someone mentions "my mom", "my boss", etc.:
1. If context makes it clear who's speaking and whom they're referring to, proceed normally
2. If ambiguous, ask: "Just to be sure - do you mean your [X] or [partner]'s [X]?"
3. Store the memory with the clarified subject

Example:
- User: "My mom is visiting next week"
  In DM: Store as "[User]'s mom is visiting"
  In shared (ambiguous): Ask "Do you mean your mom or [partner]'s mom?"
`;
