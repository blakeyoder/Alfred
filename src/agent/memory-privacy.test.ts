import {
  shouldRetrieveMemories,
  filterMemoriesForContext,
  buildMemoryMetadata,
  formatMemoriesForPrompt,
  type Mem0Memory,
  type FilteredMemory,
} from "./memory-privacy.js";
import type { SessionContext } from "./system-prompt.js";

// ============================================================================
// shouldRetrieveMemories
// ============================================================================

describe("shouldRetrieveMemories", () => {
  describe("skip patterns - returns false", () => {
    it("skips simple greetings", () => {
      expect(shouldRetrieveMemories("hi")).toBe(false);
      expect(shouldRetrieveMemories("Hey!")).toBe(false);
      expect(shouldRetrieveMemories("hello")).toBe(false);
      expect(shouldRetrieveMemories("Good morning!")).toBe(false);
      expect(shouldRetrieveMemories("good afternoon")).toBe(false);
    });

    it("skips simple acknowledgments", () => {
      expect(shouldRetrieveMemories("ok")).toBe(false);
      expect(shouldRetrieveMemories("okay")).toBe(false);
      expect(shouldRetrieveMemories("thanks!")).toBe(false);
      expect(shouldRetrieveMemories("Thank you")).toBe(false);
      expect(shouldRetrieveMemories("got it")).toBe(false);
      expect(shouldRetrieveMemories("cool")).toBe(false);
      expect(shouldRetrieveMemories("yes")).toBe(false);
      expect(shouldRetrieveMemories("nope")).toBe(false);
    });

    it("skips bot commands", () => {
      expect(shouldRetrieveMemories("/link email@test.com")).toBe(false);
      expect(shouldRetrieveMemories("/unlink")).toBe(false);
      expect(shouldRetrieveMemories("/status")).toBe(false);
      expect(shouldRetrieveMemories("/auth")).toBe(false);
      expect(shouldRetrieveMemories("/calendar list")).toBe(false);
      expect(shouldRetrieveMemories("/help")).toBe(false);
    });

    it("skips very short messages (<=10 chars)", () => {
      expect(shouldRetrieveMemories("test")).toBe(false);
      expect(shouldRetrieveMemories("1234567890")).toBe(false);
    });
  });

  describe("trigger patterns - returns true", () => {
    it("triggers on questions about people", () => {
      expect(shouldRetrieveMemories("Who is coming to dinner?")).toBe(true);
      expect(shouldRetrieveMemories("What did she say?")).toBe(true);
      expect(shouldRetrieveMemories("When was that meeting?")).toBe(true);
      expect(shouldRetrieveMemories("Where does he work?")).toBe(true);
      expect(shouldRetrieveMemories("How did they do it?")).toBe(true);
    });

    it("triggers on relationship references", () => {
      expect(shouldRetrieveMemories("Call my mom")).toBe(true);
      expect(shouldRetrieveMemories("What is our dentist's number?")).toBe(
        true
      );
      expect(shouldRetrieveMemories("My partner's boss called")).toBe(true);
      expect(shouldRetrieveMemories("Text my sister")).toBe(true);
    });

    it("triggers on preferences", () => {
      expect(shouldRetrieveMemories("I like Italian food")).toBe(true);
      expect(shouldRetrieveMemories("She loves sushi")).toBe(true);
      expect(shouldRetrieveMemories("He hates meetings")).toBe(true);
      expect(shouldRetrieveMemories("My favorite restaurant")).toBe(true);
      expect(shouldRetrieveMemories("I'm allergic to peanuts")).toBe(true);
      expect(shouldRetrieveMemories("I can't eat gluten")).toBe(true);
    });

    it("triggers on memory-related words", () => {
      expect(shouldRetrieveMemories("Do you remember the place?")).toBe(true);
      expect(shouldRetrieveMemories("I forgot the name")).toBe(true);
      expect(shouldRetrieveMemories("I told you about it before")).toBe(true);
      expect(shouldRetrieveMemories("As I mentioned yesterday")).toBe(true);
      expect(shouldRetrieveMemories("She said she would come")).toBe(true);
    });

    it("triggers on planning words", () => {
      expect(shouldRetrieveMemories("Let's plan the trip")).toBe(true);
      expect(shouldRetrieveMemories("Schedule a meeting")).toBe(true);
      expect(shouldRetrieveMemories("Book a restaurant")).toBe(true);
      expect(shouldRetrieveMemories("Reserve a table")).toBe(true);
      expect(shouldRetrieveMemories("Arrange the party")).toBe(true);
    });

    it("triggers on dates and events", () => {
      expect(shouldRetrieveMemories("It's her birthday soon")).toBe(true);
      expect(shouldRetrieveMemories("Our anniversary is coming")).toBe(true);
      expect(shouldRetrieveMemories("Doctor appointment tomorrow")).toBe(true);
      expect(shouldRetrieveMemories("The meeting is at 3")).toBe(true);
    });
  });

  describe("default behavior", () => {
    it("retrieves for longer messages without explicit triggers", () => {
      // > 50 chars, no skip pattern, no trigger pattern
      const longMessage =
        "This is a longer message that should trigger memory retrieval by default";
      expect(longMessage.length).toBeGreaterThan(50);
      expect(shouldRetrieveMemories(longMessage)).toBe(true);
    });

    it("does not retrieve for medium messages without triggers", () => {
      // Between 10-50 chars, no patterns
      const mediumMessage = "Random medium text here";
      expect(mediumMessage.length).toBeGreaterThan(10);
      expect(mediumMessage.length).toBeLessThanOrEqual(50);
      expect(shouldRetrieveMemories(mediumMessage)).toBe(false);
    });
  });
});

// ============================================================================
// filterMemoriesForContext
// ============================================================================

describe("filterMemoriesForContext", () => {
  const USER_ID = "user-123";
  const PARTNER_ID = "partner-456";
  const COUPLE_ID = "couple-789";

  const sharedContext: SessionContext = {
    userId: USER_ID,
    userName: "Alice",
    coupleId: COUPLE_ID,
    coupleName: "Alice & Bob",
    partnerName: "Bob",
    threadId: "thread-shared",
    visibility: "shared",
  };

  const dmContext: SessionContext = {
    userId: USER_ID,
    userName: "Alice",
    coupleId: COUPLE_ID,
    coupleName: "Alice & Bob",
    partnerName: "Bob",
    threadId: "thread-dm",
    visibility: "dm",
  };

  describe("couple-level memories (null user_id)", () => {
    const coupleMemory: Mem0Memory = {
      id: "mem-1",
      memory: "They love hiking together",
      metadata: {
        user_id: null,
        source_visibility: "shared",
        category: "fact",
      },
    };

    it("visible in shared context", () => {
      const result = filterMemoriesForContext([coupleMemory], sharedContext);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("They love hiking together");
      expect(result[0].fromPartner).toBe(false);
    });

    it("visible in DM context", () => {
      const result = filterMemoriesForContext([coupleMemory], dmContext);
      expect(result).toHaveLength(1);
      expect(result[0].fromPartner).toBe(false);
    });
  });

  describe("user's own memories", () => {
    const ownSharedMemory: Mem0Memory = {
      id: "mem-2",
      memory: "I prefer morning meetings",
      metadata: {
        user_id: USER_ID,
        source_visibility: "shared",
        category: "fact",
      },
    };

    const ownDmMemory: Mem0Memory = {
      id: "mem-3",
      memory: "Planning a surprise party",
      metadata: {
        user_id: USER_ID,
        source_visibility: "dm",
        category: "context",
      },
    };

    it("own shared memory visible in shared context", () => {
      const result = filterMemoriesForContext([ownSharedMemory], sharedContext);
      expect(result).toHaveLength(1);
      expect(result[0].fromPartner).toBe(false);
    });

    it("own shared memory visible in DM context", () => {
      const result = filterMemoriesForContext([ownSharedMemory], dmContext);
      expect(result).toHaveLength(1);
    });

    it("own DM memory visible in shared context", () => {
      const result = filterMemoriesForContext([ownDmMemory], sharedContext);
      expect(result).toHaveLength(1);
    });

    it("own DM memory visible in DM context", () => {
      const result = filterMemoriesForContext([ownDmMemory], dmContext);
      expect(result).toHaveLength(1);
    });
  });

  describe("partner's memories - shared source", () => {
    const partnerSharedMemory: Mem0Memory = {
      id: "mem-4",
      memory: "Bob mentioned he likes jazz",
      metadata: {
        user_id: PARTNER_ID,
        source_visibility: "shared",
        category: "fact",
      },
    };

    it("visible in shared context", () => {
      const result = filterMemoriesForContext(
        [partnerSharedMemory],
        sharedContext
      );
      expect(result).toHaveLength(1);
      expect(result[0].fromPartner).toBe(true);
    });

    it("NOT visible in DM context", () => {
      const result = filterMemoriesForContext([partnerSharedMemory], dmContext);
      expect(result).toHaveLength(0);
    });
  });

  describe("partner's memories - DM source (NEVER visible)", () => {
    const partnerDmMemory: Mem0Memory = {
      id: "mem-5",
      memory: "Bob is planning a surprise gift",
      metadata: {
        user_id: PARTNER_ID,
        source_visibility: "dm",
        category: "context",
      },
    };

    it("NOT visible in shared context", () => {
      const result = filterMemoriesForContext([partnerDmMemory], sharedContext);
      expect(result).toHaveLength(0);
    });

    it("NOT visible in DM context", () => {
      const result = filterMemoriesForContext([partnerDmMemory], dmContext);
      expect(result).toHaveLength(0);
    });
  });

  describe("mixed memories filtering", () => {
    const memories: Mem0Memory[] = [
      {
        id: "1",
        memory: "Couple fact",
        metadata: { user_id: null, source_visibility: "shared" },
      },
      {
        id: "2",
        memory: "Own shared",
        metadata: { user_id: USER_ID, source_visibility: "shared" },
      },
      {
        id: "3",
        memory: "Own DM",
        metadata: { user_id: USER_ID, source_visibility: "dm" },
      },
      {
        id: "4",
        memory: "Partner shared",
        metadata: { user_id: PARTNER_ID, source_visibility: "shared" },
      },
      {
        id: "5",
        memory: "Partner DM secret",
        metadata: { user_id: PARTNER_ID, source_visibility: "dm" },
      },
    ];

    it("filters correctly in shared context", () => {
      const result = filterMemoriesForContext(memories, sharedContext);
      expect(result).toHaveLength(4); // All except partner's DM
      expect(result.map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
    });

    it("filters correctly in DM context", () => {
      const result = filterMemoriesForContext(memories, dmContext);
      expect(result).toHaveLength(3); // Only couple-level and own memories
      expect(result.map((m) => m.id)).toEqual(["1", "2", "3"]);
    });
  });

  describe("preserves metadata", () => {
    it("preserves score and category", () => {
      const memory: Mem0Memory = {
        id: "mem-1",
        memory: "Test memory",
        score: 0.95,
        metadata: {
          user_id: USER_ID,
          source_visibility: "shared",
          category: "relationship",
        },
      };

      const result = filterMemoriesForContext([memory], sharedContext);
      expect(result[0].score).toBe(0.95);
      expect(result[0].category).toBe("relationship");
    });
  });
});

// ============================================================================
// buildMemoryMetadata
// ============================================================================

describe("buildMemoryMetadata", () => {
  const context: SessionContext = {
    userId: "user-123",
    userName: "Alice",
    coupleId: "couple-789",
    coupleName: "Alice & Bob",
    partnerName: "Bob",
    threadId: "thread-abc",
    visibility: "shared",
  };

  it("includes all required fields", () => {
    const metadata = buildMemoryMetadata(context);

    expect(metadata.user_id).toBe("user-123");
    expect(metadata.source_thread_id).toBe("thread-abc");
    expect(metadata.source_visibility).toBe("shared");
    expect(metadata.couple_id).toBe("couple-789");
  });

  it("defaults category to fact", () => {
    const metadata = buildMemoryMetadata(context);
    expect(metadata.category).toBe("fact");
  });

  it("accepts custom category", () => {
    expect(buildMemoryMetadata(context, "relationship").category).toBe(
      "relationship"
    );
    expect(buildMemoryMetadata(context, "context").category).toBe("context");
  });

  it("uses visibility from context", () => {
    const dmContext = { ...context, visibility: "dm" as const };
    const metadata = buildMemoryMetadata(dmContext);
    expect(metadata.source_visibility).toBe("dm");
  });
});

// ============================================================================
// formatMemoriesForPrompt
// ============================================================================

describe("formatMemoriesForPrompt", () => {
  it("returns empty string for no memories", () => {
    expect(formatMemoriesForPrompt([])).toBe("");
  });

  it("includes header", () => {
    const memories: FilteredMemory[] = [
      { id: "1", content: "Test", fromPartner: false },
    ];
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("## What You Remember About This Couple");
  });

  it("groups facts under Facts heading", () => {
    const memories: FilteredMemory[] = [
      { id: "1", content: "Likes pizza", category: "fact", fromPartner: false },
    ];
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("**Facts:**");
    expect(result).toContain("- Likes pizza");
  });

  it("groups relationships under People heading", () => {
    const memories: FilteredMemory[] = [
      {
        id: "1",
        content: "Mom is Sarah",
        category: "relationship",
        fromPartner: false,
      },
    ];
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("**People:**");
    expect(result).toContain("- Mom is Sarah");
  });

  it("groups context under Current Context heading", () => {
    const memories: FilteredMemory[] = [
      {
        id: "1",
        content: "Planning vacation",
        category: "context",
        fromPartner: false,
      },
    ];
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("**Current Context:**");
    expect(result).toContain("- Planning vacation");
  });

  it("groups uncategorized under Other heading", () => {
    const memories: FilteredMemory[] = [
      { id: "1", content: "Random note", fromPartner: false },
    ];
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("**Other:**");
    expect(result).toContain("- Random note");
  });

  it("annotates partner memories with (from partner)", () => {
    const memories: FilteredMemory[] = [
      {
        id: "1",
        content: "Partner mentioned sushi",
        category: "fact",
        fromPartner: true,
      },
    ];
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("- Partner mentioned sushi (from partner)");
  });

  it("includes usage instructions", () => {
    const memories: FilteredMemory[] = [
      { id: "1", content: "Test", fromPartner: false },
    ];
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("**Using Memories:**");
    expect(result).toContain("I remember you mentioned");
  });
});
