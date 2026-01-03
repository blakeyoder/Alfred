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
