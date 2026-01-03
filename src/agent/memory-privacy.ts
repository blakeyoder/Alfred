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

// Patterns indicating durable personal information worth remembering
const MEMORY_STORE_PATTERNS = [
  // Explicit memory requests
  /\b(remember|don't forget|keep in mind|note that|make a note)\b/i,
  // Personal facts and preferences (declarative statements)
  /\b(i('m| am)|we('re| are)|my|our)\b.*(allergic|vegetarian|vegan|gluten|lactose|intolerant)/i,
  /\b(i|we)\s+(like|love|hate|prefer|can't stand|always|never)\b/i,
  /\b(my|our)\s+(favorite|preferred)\b/i,
  // Relationships with names
  /\b(my|our)\s+(mom|dad|mother|father|brother|sister|boss|friend|doctor|dentist|therapist)('s|\s+is|\s+name)/i,
  // Life events and context
  /\b(we('re| are)|i('m| am))\s+(moving|getting married|expecting|pregnant|starting|leaving|retiring)/i,
  /\b(birthday|anniversary)\s+(is|on)\b/i,
  // Identity statements
  /\b(i('m| am)|we('re| are))\s+(a |an )?(developer|engineer|teacher|doctor|nurse|lawyer|designer|manager|retired)/i,
];

// Patterns indicating ephemeral/transactional requests (don't store)
const MEMORY_SKIP_PATTERNS = [
  // Booking/reservation requests
  /\b(book|reserve|make a reservation|get a table|find a table)\b/i,
  // Reminder requests
  /\b(remind|set a reminder|create a reminder|alert me|notify me)\b/i,
  // Calendar requests
  /\b(add to calendar|schedule|put on calendar|create an event|what's on my calendar)\b/i,
  // Queries (not statements)
  /\b(what|when|where|how|can you|could you|show me|tell me|list|find)\b.*\?$/i,
  // Search requests
  /\b(search|look up|find out|google)\b/i,
  // Simple greetings
  /^(hi|hey|hello|good morning|good afternoon|good evening|yo|sup|thanks|thank you|ok|okay|sure|got it|perfect|great|nice|cool|yes|no|yep|nope)[\s!.?]*$/i,
  // Commands
  /^\//,
  // Short messages unlikely to contain memorable info
  /^.{1,20}$/,
];

/**
 * Determine if a conversation should be stored to memory.
 *
 * We want to store durable personal information (facts, preferences, relationships)
 * but skip ephemeral transactional requests (bookings, reminders, calendar events).
 *
 * @param message - The user's message
 * @param toolsUsed - Names of tools that were invoked (optional)
 */
export function shouldStoreMemory(
  message: string,
  toolsUsed: string[] = []
): boolean {
  // If action-oriented tools were used, this was likely a transactional request
  const actionTools = [
    "createReminder",
    "createCalendarEvent",
    "generateReservationLink",
    "detectReservationPlatform",
    "webSearch",
  ];
  if (toolsUsed.some((tool) => actionTools.includes(tool))) {
    return false;
  }

  // Check skip patterns first (ephemeral requests)
  for (const pattern of MEMORY_SKIP_PATTERNS) {
    if (pattern.test(message)) {
      return false;
    }
  }

  // Check store patterns (durable information)
  for (const pattern of MEMORY_STORE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  // Default: don't store unless it clearly contains personal info
  return false;
}

/**
 * Memory from mem0 with our custom metadata
 */
export interface Mem0Memory {
  id: string;
  memory: string;
  score?: number;
  metadata?: {
    user_id?: string | null;
    source_visibility?: "shared" | "dm" | null;
    category?: "fact" | "relationship" | "context";
    [key: string]: unknown;
  };
}

/**
 * Filtered memory with additional context
 */
export interface FilteredMemory {
  id: string;
  content: string;
  score?: number;
  category?: "fact" | "relationship" | "context";
  fromPartner: boolean;
}

/**
 * Privacy filter: determine if a memory is visible to current user
 *
 * Rules:
 * 1. Couple-level memories (user_id null) → always visible
 * 2. User's own memories → always visible
 * 3. Partner's memories from shared threads → visible in shared context
 * 4. Partner's memories from DM threads → NEVER visible
 */
function isMemoryVisible(
  memory: Mem0Memory,
  currentUserId: string,
  currentVisibility: "shared" | "dm"
): boolean {
  const memoryUserId = memory.metadata?.user_id;
  const sourceVisibility = memory.metadata?.source_visibility;

  // Couple-level memories are always visible
  if (memoryUserId === null || memoryUserId === undefined) {
    return true;
  }

  // User's own memories are always visible to them
  if (memoryUserId === currentUserId) {
    return true;
  }

  // Partner's memories...
  if (currentVisibility === "dm") {
    // In DM: can't see any partner memories
    return false;
  }

  // In shared thread: can see partner's shared-sourced memories
  // but NOT their DM-sourced memories
  return sourceVisibility !== "dm";
}

/**
 * Filter memories based on privacy rules
 *
 * @param memories - Raw memories from mem0
 * @param context - Current session context
 * @returns Filtered memories that are visible to the current user
 */
export function filterMemoriesForContext(
  memories: Mem0Memory[],
  context: SessionContext
): FilteredMemory[] {
  return memories
    .filter((m) => isMemoryVisible(m, context.userId, context.visibility))
    .map((m) => ({
      id: m.id,
      content: m.memory,
      score: m.score,
      category: m.metadata?.category,
      fromPartner:
        m.metadata?.user_id !== null &&
        m.metadata?.user_id !== undefined &&
        m.metadata?.user_id !== context.userId,
    }));
}

/**
 * Build metadata for storing a new memory
 * Includes privacy-relevant fields that will be used for filtering
 */
export function buildMemoryMetadata(
  context: SessionContext,
  category: "fact" | "relationship" | "context" = "fact"
): Record<string, unknown> {
  return {
    user_id: context.userId,
    source_thread_id: context.threadId,
    source_visibility: context.visibility,
    category,
    couple_id: context.coupleId,
  };
}

/**
 * Format filtered memories for inclusion in system prompt
 */
export function formatMemoriesForPrompt(memories: FilteredMemory[]): string {
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
    other: memories.filter((m) => !m.category),
  };

  if (byCategory.fact.length > 0) {
    lines.push("**Facts:**");
    for (const m of byCategory.fact) {
      const source = m.fromPartner ? " (from partner)" : "";
      lines.push(`- ${m.content}${source}`);
    }
    lines.push("");
  }

  if (byCategory.relationship.length > 0) {
    lines.push("**People:**");
    for (const m of byCategory.relationship) {
      const source = m.fromPartner ? " (from partner)" : "";
      lines.push(`- ${m.content}${source}`);
    }
    lines.push("");
  }

  if (byCategory.context.length > 0) {
    lines.push("**Current Context:**");
    for (const m of byCategory.context) {
      const source = m.fromPartner ? " (from partner)" : "";
      lines.push(`- ${m.content}${source}`);
    }
    lines.push("");
  }

  if (byCategory.other.length > 0) {
    lines.push("**Other:**");
    for (const m of byCategory.other) {
      const source = m.fromPartner ? " (from partner)" : "";
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
