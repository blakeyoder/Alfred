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
