# mem0 Memory System - Detailed Implementation Plan

> Long-term semantic memory for Alfred using mem0 Cloud

## Table of Contents

1. [Design Specification](#design-specification)
2. [Architecture](#architecture)
3. [Stage 14: mem0 Client & Database Schema](#stage-14-mem0-client--database-schema)
4. [Stage 15: Memory Retrieval in Agent](#stage-15-memory-retrieval-in-agent)
5. [Stage 16: Memory Extraction](#stage-16-memory-extraction)
6. [Stage 17: Updates & Conflict Resolution](#stage-17-updates--conflict-resolution)
7. [Stage 18: Cross-Partner & Calendar Integration](#stage-18-cross-partner--calendar-integration)
8. [Privacy Model](#privacy-model)
9. [Error Handling & Fallbacks](#error-handling--fallbacks)
10. [Testing Strategy](#testing-strategy)
11. [Rollout Plan](#rollout-plan)

---

## Design Specification

### Decisions Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Memory Scope** | Individual + couple | Support "Blake prefers X" AND "We celebrate anniversary on Y" |
| **DM Privacy** | Completely hidden | Surprise planning must never leak to partner |
| **Cross-partner Sharing** | Proactive | Alfred can volunteer "Your partner mentioned..." |
| **Creation Mode** | Auto-extract + explicit | Best of both: passive learning + user control |
| **Confirmation Style** | Inline subtle | "Got it, I'll remember that" - not intrusive |
| **Retrieval Trigger** | Selective | Only when message likely needs personal context |
| **Memory Limit** | Dynamic 5-15 | More for complex queries, fewer for simple ones |
| **Transparency** | Always cite | "I remember you mentioned..." builds trust |
| **User Commands** | Conversational only | No /memory commands - manage via natural language |
| **Conflict Handling** | Ask to clarify | "I thought you were vegetarian - has that changed?" |
| **Memory Decay** | Soft | Old memories rank lower but persist forever |
| **Deployment** | mem0 Cloud | Managed service, usage-based pricing |
| **Latency Budget** | < 500ms | Timeout and fallback to DB if exceeded |
| **Encryption** | None (rely on mem0) | mem0 handles infrastructure security |

### Memory Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `fact` | Personal facts about individuals | "Blake is allergic to shellfish", "Sarah's birthday is March 15" |
| `relationship` | People and their connections | "Blake's mom is named Susan", "Dr. Smith is their dentist" |
| `context` | Ongoing situations, temporary states | "Planning vacation to Italy", "Stressed about work project" |

### What Gets Remembered

**Auto-extracted:**
- Names of people mentioned (family, friends, colleagues)
- Preferences stated directly ("I love Italian food")
- Important dates mentioned
- Ongoing projects or concerns
- Health/dietary information

**Explicit ("remember that..."):**
- Anything user explicitly asks to remember
- Corrections to existing memories
- Important one-time information

**NOT remembered:**
- Transient conversation flow ("yes", "thanks", "ok")
- Task-specific details (reminder contents already stored)
- Speculative or hypothetical statements

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Message Flow                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Message                                                    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────┐                                            │
│  │ shouldRetrieve? │──── No ────▶ Skip memory lookup            │
│  └────────┬────────┘                                            │
│           │ Yes                                                  │
│           ▼                                                      │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ mem0 Cloud API  │◀───▶│ Local Postgres  │                   │
│  │ (semantic search)│     │ (backup/fallback)│                   │
│  └────────┬────────┘     └─────────────────┘                   │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                            │
│  │ Privacy Filter  │ ── Remove partner's DM memories            │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                            │
│  │ System Prompt   │ ── Inject memory context                   │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                            │
│  │   GPT-4o Agent  │                                            │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                            │
│  │ Response + Tool │                                            │
│  │    Results      │                                            │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ extractMemories │────▶│ Store to mem0 + │                   │
│  │ (GPT-4o-mini)   │     │ Local Postgres  │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        Memory Ownership                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Couple (couple_id)                                             │
│  ├── Couple-level memories (user_id = NULL)                     │
│  │   └── "Our anniversary is June 15"                           │
│  │   └── "We're planning a trip to Italy"                       │
│  │                                                               │
│  ├── Partner A memories (user_id = A)                           │
│  │   ├── From shared thread (source_visibility = 'shared')      │
│  │   │   └── "Blake's mom is Susan" [visible to B]              │
│  │   └── From DM thread (source_visibility = 'dm')              │
│  │       └── "Planning surprise for B" [hidden from B]          │
│  │                                                               │
│  └── Partner B memories (user_id = B)                           │
│      ├── From shared thread (source_visibility = 'shared')      │
│      │   └── "Sarah is vegetarian" [visible to A]               │
│      └── From DM thread (source_visibility = 'dm')              │
│          └── "Looking for gift ideas" [hidden from A]           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── integrations/
│   └── mem0.ts              # mem0 Cloud client wrapper
├── agent/
│   ├── index.ts             # Modified: add memory hooks
│   ├── system-prompt.ts     # Modified: accept memory context
│   ├── memory-context.ts    # NEW: retrieval logic
│   └── memory-extraction.ts # NEW: extraction logic
├── db/
│   ├── migrations/
│   │   └── 007_memories.sql # NEW: memories table
│   └── queries/
│       └── memories.ts      # NEW: memory CRUD
└── types/
    └── memory.ts            # NEW: Memory interfaces
```

---

## Stage 14: mem0 Client & Database Schema

### Goal
Set up the foundational mem0 integration layer with local backup storage.

### 14.1 Environment Setup

**Add to `.env`:**
```bash
# mem0 Cloud (https://app.mem0.ai/dashboard/api-keys)
MEM0_API_KEY=m0-...
```

**Add to `.env.example`:**
```bash
# mem0 (get from https://app.mem0.ai)
MEM0_API_KEY=
```

### 14.2 Type Definitions

**File: `src/types/memory.ts`**

```typescript
export interface Memory {
  id: string;
  coupleId: string;
  userId: string | null;  // null = couple-level memory
  mem0Id: string | null;  // mem0's internal ID
  content: string;
  category: MemoryCategory;
  sourceThreadId: string | null;
  sourceVisibility: "shared" | "dm" | null;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
}

export type MemoryCategory = "fact" | "relationship" | "context";

export interface MemorySearchResult extends Memory {
  relevanceScore: number;
  fromPartner: boolean;
}

export interface StoreMemoryInput {
  coupleId: string;
  userId?: string | null;
  content: string;
  category: MemoryCategory;
  sourceThreadId?: string | null;
  sourceVisibility?: "shared" | "dm" | null;
}

export interface SearchMemoriesInput {
  coupleId: string;
  userId: string;
  query: string;
  visibility: "shared" | "dm";
  limit?: number;
}

export interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  isExplicit: boolean;
  conflictsWith?: string;  // existing memory ID if conflict detected
}
```

### 14.3 Database Migration

**File: `src/db/migrations/007_memories.sql`**

```sql
-- Memories table for long-term semantic memory
-- Stores both individual and couple-level memories with privacy tracking

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = couple-level

  -- mem0 sync
  mem0_id TEXT,  -- ID from mem0 API for updates/deletes

  -- Content
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fact', 'relationship', 'context')),

  -- Source tracking (for privacy filtering)
  source_thread_id UUID REFERENCES conversation_threads(id) ON DELETE SET NULL,
  source_visibility TEXT CHECK (source_visibility IN ('shared', 'dm')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,  -- For soft decay ranking

  -- Constraints
  CONSTRAINT valid_source_visibility CHECK (
    (source_thread_id IS NULL AND source_visibility IS NULL) OR
    (source_thread_id IS NOT NULL AND source_visibility IS NOT NULL)
  )
);

-- Indexes for common query patterns
CREATE INDEX idx_memories_couple ON memories(couple_id);
CREATE INDEX idx_memories_user ON memories(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_memories_category ON memories(couple_id, category);
CREATE INDEX idx_memories_created ON memories(couple_id, created_at DESC);
CREATE INDEX idx_memories_accessed ON memories(couple_id, last_accessed_at DESC NULLS LAST);
CREATE INDEX idx_memories_mem0 ON memories(mem0_id) WHERE mem0_id IS NOT NULL;

-- Full-text search index for fallback queries
CREATE INDEX idx_memories_content_search ON memories
  USING GIN (to_tsvector('english', content));

-- Trigger to update updated_at on changes
CREATE OR REPLACE FUNCTION update_memories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW
  EXECUTE FUNCTION update_memories_updated_at();
```

### 14.4 mem0 Client Wrapper

**File: `src/integrations/mem0.ts`**

```typescript
import { MemoryClient } from "mem0ai";
import type { Memory, MemoryCategory } from "../types/memory.js";

// Initialize client
const client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });

// Timeout wrapper for latency budget
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<{ result: T; timedOut: boolean }> {
  const timeout = new Promise<{ result: T; timedOut: boolean }>((resolve) =>
    setTimeout(() => resolve({ result: fallback, timedOut: true }), timeoutMs)
  );

  const success = promise.then((result) => ({ result, timedOut: false }));

  return Promise.race([success, timeout]);
}

// Constants
const LATENCY_BUDGET_MS = 500;
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Add a memory to mem0 Cloud
 * Uses couple_id as the user_id in mem0 for proper isolation
 */
export async function addMemoryToMem0(
  coupleId: string,
  content: string,
  metadata: {
    category: MemoryCategory;
    userId?: string | null;
    sourceThreadId?: string | null;
    sourceVisibility?: "shared" | "dm" | null;
  }
): Promise<{ mem0Id: string | null; error?: string }> {
  try {
    const response = await client.add(
      [{ role: "user", content }],
      {
        user_id: coupleId,  // Couple-scoped isolation
        metadata: {
          category: metadata.category,
          user_id: metadata.userId ?? null,
          source_thread_id: metadata.sourceThreadId ?? null,
          source_visibility: metadata.sourceVisibility ?? null,
        },
      }
    );

    // mem0 returns array of created memories
    const mem0Id = response.results?.[0]?.id ?? null;
    return { mem0Id };
  } catch (error) {
    console.error("[mem0] Failed to add memory:", error);
    return { mem0Id: null, error: String(error) };
  }
}

/**
 * Search memories in mem0 Cloud
 * Returns within latency budget or empty array
 */
export async function searchMemoriesInMem0(
  coupleId: string,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT
): Promise<{
  memories: Array<{
    mem0Id: string;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
  }>;
  timedOut: boolean;
  error?: string;
}> {
  try {
    const searchPromise = client.search(query, {
      user_id: coupleId,
      limit,
    });

    const { result, timedOut } = await withTimeout(
      searchPromise,
      LATENCY_BUDGET_MS,
      { results: [] }
    );

    if (timedOut) {
      console.warn("[mem0] Search timed out, falling back to local DB");
      return { memories: [], timedOut: true };
    }

    const memories = (result.results ?? []).map((r: {
      id: string;
      memory: string;
      score?: number;
      metadata?: Record<string, unknown>;
    }) => ({
      mem0Id: r.id,
      content: r.memory,
      score: r.score ?? 0,
      metadata: r.metadata ?? {},
    }));

    return { memories, timedOut: false };
  } catch (error) {
    console.error("[mem0] Search failed:", error);
    return { memories: [], timedOut: false, error: String(error) };
  }
}

/**
 * Update a memory in mem0 Cloud
 */
export async function updateMemoryInMem0(
  mem0Id: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.update(mem0Id, content);
    return { success: true };
  } catch (error) {
    console.error("[mem0] Failed to update memory:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Delete a memory from mem0 Cloud
 */
export async function deleteMemoryFromMem0(
  mem0Id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.delete(mem0Id);
    return { success: true };
  } catch (error) {
    console.error("[mem0] Failed to delete memory:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get all memories for a couple (for debugging/admin)
 */
export async function getAllMemoriesFromMem0(
  coupleId: string
): Promise<{
  memories: Array<{
    mem0Id: string;
    content: string;
    metadata: Record<string, unknown>;
  }>;
  error?: string;
}> {
  try {
    const response = await client.getAll({ user_id: coupleId });

    const memories = (response.results ?? []).map((r: {
      id: string;
      memory: string;
      metadata?: Record<string, unknown>;
    }) => ({
      mem0Id: r.id,
      content: r.memory,
      metadata: r.metadata ?? {},
    }));

    return { memories };
  } catch (error) {
    console.error("[mem0] Failed to get all memories:", error);
    return { memories: [], error: String(error) };
  }
}
```

### 14.5 Database Query Layer

**File: `src/db/queries/memories.ts`**

```typescript
import { sql } from "../client.js";
import {
  addMemoryToMem0,
  searchMemoriesInMem0,
  updateMemoryInMem0,
  deleteMemoryFromMem0,
} from "../../integrations/mem0.js";
import type {
  Memory,
  MemorySearchResult,
  StoreMemoryInput,
  SearchMemoriesInput,
} from "../../types/memory.js";

/**
 * Store a memory in both local DB and mem0 Cloud
 */
export async function storeMemory(input: StoreMemoryInput): Promise<Memory> {
  const {
    coupleId,
    userId = null,
    content,
    category,
    sourceThreadId = null,
    sourceVisibility = null,
  } = input;

  // Store in mem0 first (non-blocking for local storage)
  const mem0Result = await addMemoryToMem0(coupleId, content, {
    category,
    userId,
    sourceThreadId,
    sourceVisibility,
  });

  // Store in local DB (always succeeds even if mem0 fails)
  const [memory] = await sql<Memory[]>`
    INSERT INTO memories (
      couple_id,
      user_id,
      mem0_id,
      content,
      category,
      source_thread_id,
      source_visibility
    ) VALUES (
      ${coupleId},
      ${userId},
      ${mem0Result.mem0Id},
      ${content},
      ${category},
      ${sourceThreadId},
      ${sourceVisibility}
    )
    RETURNING *
  `;

  if (mem0Result.error) {
    console.warn("[memories] Stored locally but mem0 failed:", mem0Result.error);
  }

  return memory;
}

/**
 * Search memories with privacy filtering
 *
 * Privacy rules:
 * - In shared thread: see all memories EXCEPT partner's DM-sourced memories
 * - In DM thread: see only own memories + couple-level memories
 */
export async function searchMemories(
  input: SearchMemoriesInput
): Promise<MemorySearchResult[]> {
  const { coupleId, userId, query, visibility, limit = 10 } = input;

  // Try mem0 first
  const mem0Result = await searchMemoriesInMem0(coupleId, query, limit * 2);

  let results: MemorySearchResult[];

  if (mem0Result.memories.length > 0 && !mem0Result.timedOut) {
    // Use mem0 results, enrich with local data
    results = await enrichMem0Results(mem0Result.memories, userId, visibility);
  } else {
    // Fallback to local full-text search
    results = await localFullTextSearch(coupleId, userId, query, visibility, limit);
  }

  // Update last_accessed_at for retrieved memories (fire and forget)
  const memoryIds = results.map((r) => r.id);
  if (memoryIds.length > 0) {
    sql`
      UPDATE memories
      SET last_accessed_at = NOW()
      WHERE id = ANY(${memoryIds})
    `.catch((err) => console.error("[memories] Failed to update access time:", err));
  }

  return results.slice(0, limit);
}

/**
 * Enrich mem0 results with local metadata and apply privacy filter
 */
async function enrichMem0Results(
  mem0Results: Array<{
    mem0Id: string;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
  }>,
  currentUserId: string,
  currentVisibility: "shared" | "dm"
): Promise<MemorySearchResult[]> {
  const mem0Ids = mem0Results.map((r) => r.mem0Id);

  // Get local records for these mem0 IDs
  const localRecords = await sql<Memory[]>`
    SELECT * FROM memories
    WHERE mem0_id = ANY(${mem0Ids})
  `;

  const localByMem0Id = new Map(localRecords.map((r) => [r.mem0Id, r]));

  const results: MemorySearchResult[] = [];

  for (const mem0Result of mem0Results) {
    const local = localByMem0Id.get(mem0Result.mem0Id);

    if (!local) {
      // Memory exists in mem0 but not locally (sync issue) - skip
      continue;
    }

    // Apply privacy filter
    if (!isMemoryVisible(local, currentUserId, currentVisibility)) {
      continue;
    }

    results.push({
      ...local,
      relevanceScore: mem0Result.score,
      fromPartner: local.userId !== null && local.userId !== currentUserId,
    });
  }

  return results;
}

/**
 * Local full-text search fallback
 */
async function localFullTextSearch(
  coupleId: string,
  currentUserId: string,
  query: string,
  currentVisibility: "shared" | "dm",
  limit: number
): Promise<MemorySearchResult[]> {
  // Build privacy-aware query
  const memories = await sql<(Memory & { rank: number })[]>`
    SELECT
      m.*,
      ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query})) as rank
    FROM memories m
    WHERE m.couple_id = ${coupleId}
      AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
    ORDER BY
      rank DESC,
      last_accessed_at DESC NULLS LAST,
      created_at DESC
    LIMIT ${limit * 2}
  `;

  // Apply privacy filter in application layer
  const filtered = memories.filter((m) =>
    isMemoryVisible(m, currentUserId, currentVisibility)
  );

  return filtered.slice(0, limit).map((m) => ({
    ...m,
    relevanceScore: m.rank,
    fromPartner: m.userId !== null && m.userId !== currentUserId,
  }));
}

/**
 * Privacy filter: determine if a memory is visible to current user
 */
function isMemoryVisible(
  memory: Memory,
  currentUserId: string,
  currentVisibility: "shared" | "dm"
): boolean {
  // Couple-level memories are always visible
  if (memory.userId === null) {
    return true;
  }

  // User's own memories are always visible to them
  if (memory.userId === currentUserId) {
    return true;
  }

  // Partner's memories...
  if (currentVisibility === "dm") {
    // In DM: can't see any partner memories
    return false;
  }

  // In shared thread: can see partner's shared-sourced memories
  // but NOT their DM-sourced memories
  return memory.sourceVisibility !== "dm";
}

/**
 * Update a memory (content and/or category)
 */
export async function updateMemory(
  memoryId: string,
  updates: { content?: string; category?: string }
): Promise<Memory | null> {
  // Get current memory
  const [current] = await sql<Memory[]>`
    SELECT * FROM memories WHERE id = ${memoryId}
  `;

  if (!current) {
    return null;
  }

  const newContent = updates.content ?? current.content;
  const newCategory = updates.category ?? current.category;

  // Update mem0 if we have a mem0_id and content changed
  if (current.mem0Id && updates.content) {
    await updateMemoryInMem0(current.mem0Id, newContent);
  }

  // Update local DB
  const [updated] = await sql<Memory[]>`
    UPDATE memories
    SET
      content = ${newContent},
      category = ${newCategory}
    WHERE id = ${memoryId}
    RETURNING *
  `;

  return updated;
}

/**
 * Delete a memory from both local DB and mem0
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  // Get memory to find mem0_id
  const [memory] = await sql<Memory[]>`
    SELECT * FROM memories WHERE id = ${memoryId}
  `;

  if (!memory) {
    return false;
  }

  // Delete from mem0 if exists
  if (memory.mem0Id) {
    await deleteMemoryFromMem0(memory.mem0Id);
  }

  // Delete from local DB
  await sql`DELETE FROM memories WHERE id = ${memoryId}`;

  return true;
}

/**
 * Find similar memories (for conflict detection)
 */
export async function findSimilarMemories(
  coupleId: string,
  content: string,
  threshold: number = 0.7
): Promise<Memory[]> {
  // Use mem0 search with low limit for similarity check
  const mem0Result = await searchMemoriesInMem0(coupleId, content, 5);

  if (mem0Result.timedOut || mem0Result.error) {
    // Fallback: simple keyword match
    const keywords = content.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (keywords.length === 0) return [];

    const pattern = keywords.join(" | ");
    return sql<Memory[]>`
      SELECT * FROM memories
      WHERE couple_id = ${coupleId}
        AND to_tsvector('english', content) @@ to_tsquery('english', ${pattern})
      LIMIT 5
    `;
  }

  // Filter by score threshold
  const similarIds = mem0Result.memories
    .filter((m) => m.score >= threshold)
    .map((m) => m.mem0Id);

  if (similarIds.length === 0) return [];

  return sql<Memory[]>`
    SELECT * FROM memories
    WHERE mem0_id = ANY(${similarIds})
  `;
}

/**
 * Get memory by ID
 */
export async function getMemoryById(memoryId: string): Promise<Memory | null> {
  const [memory] = await sql<Memory[]>`
    SELECT * FROM memories WHERE id = ${memoryId}
  `;
  return memory ?? null;
}

/**
 * Get all memories for a couple (admin/debug)
 */
export async function getAllMemoriesForCouple(coupleId: string): Promise<Memory[]> {
  return sql<Memory[]>`
    SELECT * FROM memories
    WHERE couple_id = ${coupleId}
    ORDER BY created_at DESC
  `;
}
```

### 14.6 Success Criteria

- [ ] `MEM0_API_KEY` configured and validated on startup
- [ ] Migration `007_memories.sql` runs successfully
- [ ] `storeMemory()` saves to both mem0 and local DB
- [ ] `searchMemories()` returns semantically relevant results
- [ ] Couple isolation: couple A's memories never returned for couple B
- [ ] Fallback: local search works when mem0 times out
- [ ] Privacy filter: DM memories hidden from partner

### 14.7 Tests

```typescript
// tests/memories.test.ts

describe("Memory Storage", () => {
  it("stores memory in both mem0 and local DB", async () => {
    const memory = await storeMemory({
      coupleId: testCouple.id,
      userId: testUser.id,
      content: "Blake is allergic to shellfish",
      category: "fact",
      sourceThreadId: sharedThread.id,
      sourceVisibility: "shared",
    });

    expect(memory.id).toBeDefined();
    expect(memory.mem0Id).toBeDefined(); // May be null if mem0 failed
    expect(memory.content).toBe("Blake is allergic to shellfish");
  });

  it("enforces couple isolation", async () => {
    // Store memory for couple A
    await storeMemory({
      coupleId: coupleA.id,
      content: "Secret info",
      category: "fact",
    });

    // Search as couple B should return nothing
    const results = await searchMemories({
      coupleId: coupleB.id,
      userId: userB.id,
      query: "secret",
      visibility: "shared",
    });

    expect(results).toHaveLength(0);
  });

  it("falls back to local search on mem0 timeout", async () => {
    // Mock mem0 to timeout
    jest.spyOn(mem0Client, "search").mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    const results = await searchMemories({
      coupleId: testCouple.id,
      userId: testUser.id,
      query: "shellfish",
      visibility: "shared",
    });

    // Should still return results from local DB
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("Privacy Filter", () => {
  it("hides partner DM memories in shared thread", async () => {
    // Partner A creates memory in DM
    await storeMemory({
      coupleId: testCouple.id,
      userId: partnerA.id,
      content: "Planning surprise party for B",
      category: "context",
      sourceThreadId: partnerADmThread.id,
      sourceVisibility: "dm",
    });

    // Partner B searches in shared thread
    const results = await searchMemories({
      coupleId: testCouple.id,
      userId: partnerB.id,
      query: "surprise party",
      visibility: "shared",
    });

    expect(results).toHaveLength(0);
  });

  it("shows partner shared memories in shared thread", async () => {
    // Partner A creates memory in shared thread
    await storeMemory({
      coupleId: testCouple.id,
      userId: partnerA.id,
      content: "Blake loves Italian food",
      category: "fact",
      sourceThreadId: sharedThread.id,
      sourceVisibility: "shared",
    });

    // Partner B searches in shared thread
    const results = await searchMemories({
      coupleId: testCouple.id,
      userId: partnerB.id,
      query: "Italian food",
      visibility: "shared",
    });

    expect(results).toHaveLength(1);
    expect(results[0].fromPartner).toBe(true);
  });
});
```

---

## Stage 15: Memory Retrieval in Agent

### Goal
Inject relevant memories into the agent's context before processing user messages.

### 15.1 Retrieval Heuristics

**File: `src/agent/memory-context.ts`**

```typescript
import { searchMemories } from "../db/queries/memories.js";
import type { MemorySearchResult, SearchMemoriesInput } from "../types/memory.js";
import type { SessionContext } from "./index.js";

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

  return lines.join("\n");
}
```

### 15.2 System Prompt Modification

**File: `src/agent/system-prompt.ts` (modifications)**

```typescript
import type { SessionContext } from "./index.js";

interface SystemPromptOptions {
  context: SessionContext;
  memoryContext?: string;  // NEW
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const { context, memoryContext = "" } = options;

  const parts: string[] = [];

  // Base identity
  parts.push(`You are Alfred, an AI executive assistant for couples.
You help ${context.userName} and their partner ${context.partnerName ?? "their partner"} coordinate their lives.

Current time: ${new Date().toISOString()}
Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

  // Privacy context
  if (context.visibility === "dm") {
    parts.push(`
## Private Conversation
This is a private DM with ${context.userName}. Their partner cannot see this conversation.
Be discreet about surprises, gifts, or sensitive topics.`);
  }

  // Memory context (NEW)
  if (memoryContext) {
    parts.push(`
${memoryContext}

**Using Memories:**
- When you use information from memory, cite it naturally: "I remember you mentioned..." or "You told me before that..."
- If you're uncertain about a memory, you can ask for confirmation
- If new information conflicts with what you remember, ask for clarification: "I thought you mentioned X - has that changed?"`);
  }

  // Tool usage instructions
  parts.push(`
## Guidelines
- Use tools to look up information rather than guessing
- Be warm but efficient
- For reminders and calendar events, always use the appropriate tools
- "Me" refers to ${context.userName}, "partner" refers to ${context.partnerName ?? "their partner"}`);

  return parts.join("\n");
}
```

### 15.3 Agent Integration

**File: `src/agent/index.ts` (modifications)**

```typescript
import {
  shouldRetrieveMemories,
  getMemoriesForContext,
  buildMemoryContext,
} from "./memory-context.js";

export async function chat(
  message: string,
  options: ChatOptions
): Promise<ChatResult> {
  const { context, history, partnerId = null } = options;

  // NEW: Retrieve memories if appropriate
  let memoryContext = "";
  if (shouldRetrieveMemories(message)) {
    try {
      const memories = await getMemoriesForContext(context, message);
      memoryContext = buildMemoryContext(memories);
    } catch (error) {
      // Log but don't fail the request
      console.error("[agent] Failed to retrieve memories:", error);
    }
  }

  const tools = createTools({ session: context }, partnerId);

  const result = await generateText({
    model: openai("gpt-4o"),
    system: buildSystemPrompt({ context, memoryContext }),  // MODIFIED
    messages: [...history, { role: "user", content: message }],
    tools,
    maxSteps: 5,
    onStepFinish: ({ toolResults }) => {
      if (toolResults) {
        console.log("[agent] Tool results:", toolResults);
      }
    },
  });

  // ... rest of function (extraction will be added in Stage 16)

  return {
    text: result.text,
    toolCalls: result.toolCalls,
  };
}
```

### 15.4 Success Criteria

- [ ] `shouldRetrieveMemories()` correctly identifies when to fetch memories
- [ ] Memory context injected into system prompt
- [ ] Agent cites memories naturally ("I remember you mentioned...")
- [ ] DM memories never appear in partner's context
- [ ] Shared memories visible to both partners
- [ ] Latency impact < 500ms for memory retrieval

### 15.5 Tests

```typescript
describe("Memory Retrieval Heuristics", () => {
  it("triggers retrieval for questions about people", () => {
    expect(shouldRetrieveMemories("What's my mom's name?")).toBe(true);
    expect(shouldRetrieveMemories("Who is our dentist?")).toBe(true);
  });

  it("triggers retrieval for preference questions", () => {
    expect(shouldRetrieveMemories("What food do I like?")).toBe(true);
    expect(shouldRetrieveMemories("Am I allergic to anything?")).toBe(true);
  });

  it("skips retrieval for greetings", () => {
    expect(shouldRetrieveMemories("Hi!")).toBe(false);
    expect(shouldRetrieveMemories("Good morning")).toBe(false);
  });

  it("skips retrieval for simple acknowledgments", () => {
    expect(shouldRetrieveMemories("Thanks")).toBe(false);
    expect(shouldRetrieveMemories("Ok")).toBe(false);
  });

  it("skips retrieval for commands", () => {
    expect(shouldRetrieveMemories("/status")).toBe(false);
    expect(shouldRetrieveMemories("/calendar list")).toBe(false);
  });
});

describe("Memory Context Building", () => {
  it("formats memories with categories", () => {
    const memories: MemorySearchResult[] = [
      { ...baseMemory, content: "Blake is vegetarian", category: "fact", fromPartner: false },
      { ...baseMemory, content: "Mom's name is Susan", category: "relationship", fromPartner: false },
    ];

    const context = buildMemoryContext(memories);

    expect(context).toContain("## What You Remember");
    expect(context).toContain("**Facts:**");
    expect(context).toContain("Blake is vegetarian");
    expect(context).toContain("**People:**");
    expect(context).toContain("Mom's name is Susan");
  });

  it("marks partner memories", () => {
    const memories: MemorySearchResult[] = [
      { ...baseMemory, content: "Sarah loves hiking", category: "fact", fromPartner: true },
    ];

    const context = buildMemoryContext(memories);

    expect(context).toContain("(from partner)");
  });
});
```

---

## Stage 16: Memory Extraction

### Goal
Automatically extract and store memorable information from conversations.

### 16.1 Extraction Logic

**File: `src/agent/memory-extraction.ts`**

```typescript
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { storeMemory, findSimilarMemories } from "../db/queries/memories.js";
import type { SessionContext } from "./index.js";
import type { ExtractedMemory, MemoryCategory } from "../types/memory.js";

// Schema for extraction response
const ExtractionSchema = z.object({
  memories: z.array(
    z.object({
      content: z.string().describe("The fact or information to remember"),
      category: z.enum(["fact", "relationship", "context"]).describe(
        "fact = personal facts/preferences, relationship = people/connections, context = ongoing situations"
      ),
      isExplicit: z.boolean().describe(
        "True if user explicitly asked to remember this"
      ),
    })
  ),
  shouldConfirm: z.boolean().describe(
    "True if any explicit 'remember this' request was made"
  ),
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
function hasExplicitMemoryRequest(message: string): boolean {
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
      category: memory.category,
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
```

### 16.2 Agent Integration

**File: `src/agent/index.ts` (additional modifications)**

```typescript
import {
  extractMemories,
  storeExtractedMemories,
  generateConfirmation,
} from "./memory-extraction.js";

export async function chat(
  message: string,
  options: ChatOptions
): Promise<ChatResult> {
  const { context, history, partnerId = null } = options;

  // Memory retrieval (from Stage 15)
  let memoryContext = "";
  if (shouldRetrieveMemories(message)) {
    try {
      const memories = await getMemoriesForContext(context, message);
      memoryContext = buildMemoryContext(memories);
    } catch (error) {
      console.error("[agent] Failed to retrieve memories:", error);
    }
  }

  const tools = createTools({ session: context }, partnerId);

  const result = await generateText({
    model: openai("gpt-4o"),
    system: buildSystemPrompt({ context, memoryContext }),
    messages: [...history, { role: "user", content: message }],
    tools,
    maxSteps: 5,
  });

  let finalText = result.text;

  // NEW: Extract and store memories from this conversation turn
  try {
    const { extracted, shouldConfirm } = await extractMemories(
      message,
      result.text,
      context
    );

    if (extracted.length > 0) {
      const { stored, conflicts } = await storeExtractedMemories(extracted, context);

      // Add confirmation to response if explicit request
      if (shouldConfirm) {
        const confirmation = generateConfirmation(stored, conflicts);
        if (confirmation && !finalText.includes("remember")) {
          // Append confirmation if not already acknowledged
          finalText = `${finalText}\n\n${confirmation}`;
        }
      }

      console.log(`[agent] Extracted ${stored} memories, ${conflicts.length} conflicts`);
    }
  } catch (error) {
    // Log but don't fail the response
    console.error("[agent] Failed to extract/store memories:", error);
  }

  return {
    text: finalText,
    toolCalls: result.toolCalls,
  };
}
```

### 16.3 Success Criteria

- [ ] Auto-extraction identifies facts, relationships, context
- [ ] Explicit "remember that..." triggers storage + confirmation
- [ ] Confirmation appended: "Got it, I'll remember that"
- [ ] Memories tagged with correct user_id and source_visibility
- [ ] Extraction uses gpt-4o-mini (cost-effective)
- [ ] Extraction adds < 200ms to response time

### 16.4 Tests

```typescript
describe("Memory Extraction", () => {
  it("extracts facts from conversation", async () => {
    const { extracted } = await extractMemories(
      "I'm allergic to shellfish",
      "I'll make a note of that. Is there anything else I should know about your dietary restrictions?",
      testContext
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0].content).toContain("allergic");
    expect(extracted[0].content).toContain("shellfish");
    expect(extracted[0].category).toBe("fact");
  });

  it("extracts relationships", async () => {
    const { extracted } = await extractMemories(
      "My mom Susan is coming to visit next week",
      "How exciting! Would you like me to help you plan activities for her visit?",
      testContext
    );

    expect(extracted.some((m) =>
      m.category === "relationship" && m.content.includes("Susan")
    )).toBe(true);
  });

  it("detects explicit memory requests", async () => {
    const { extracted, shouldConfirm } = await extractMemories(
      "Remember that our anniversary is June 15th",
      "Got it! I'll remember your anniversary is June 15th.",
      testContext
    );

    expect(shouldConfirm).toBe(true);
    expect(extracted[0].isExplicit).toBe(true);
  });

  it("skips transient conversation", async () => {
    const { extracted } = await extractMemories(
      "Thanks!",
      "You're welcome! Let me know if you need anything else.",
      testContext
    );

    expect(extracted).toHaveLength(0);
  });
});

describe("Conflict Detection", () => {
  it("detects conflicting memories", async () => {
    // First, store existing memory
    await storeMemory({
      coupleId: testCouple.id,
      content: "Blake is vegetarian",
      category: "fact",
    });

    // Try to store conflicting memory
    const extracted: ExtractedMemory[] = [
      { content: "Blake eats meat", category: "fact", isExplicit: false },
    ];

    const { stored, conflicts } = await storeExtractedMemories(extracted, testContext);

    expect(stored).toBe(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].existing).toContain("vegetarian");
  });
});
```

---

## Stage 17: Updates & Conflict Resolution

### Goal
Handle memory updates, corrections, and resolve conflicts gracefully.

### 17.1 Conflict Resolution System

**File: `src/agent/memory-conflicts.ts`**

```typescript
import { updateMemory, deleteMemory, getMemoryById } from "../db/queries/memories.js";
import type { Memory } from "../types/memory.js";

// Patterns indicating a correction
const CORRECTION_PATTERNS = [
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
      return { isCorrection: true, strength: strength as "medium" | "strong" };
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
  newContent: string | null  // null = delete
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
```

### 17.2 Ambiguity Resolution

**File: `src/agent/memory-ambiguity.ts`**

```typescript
import type { SessionContext } from "./index.js";

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
```

### 17.3 Soft Decay Implementation

The soft decay is already implemented via `last_accessed_at` in Stage 14. The ranking happens in:

1. **mem0 Cloud**: Inherently handles relevance scoring based on recency
2. **Local fallback**: Orders by `last_accessed_at DESC NULLS LAST`

### 17.4 System Prompt Updates

**File: `src/agent/system-prompt.ts` (additional modifications)**

```typescript
import { CONFLICT_HANDLING_INSTRUCTIONS } from "./memory-conflicts.js";
import { AMBIGUITY_HANDLING_INSTRUCTIONS } from "./memory-ambiguity.js";

export function buildSystemPrompt(options: SystemPromptOptions): string {
  // ... existing code ...

  // Add conflict and ambiguity handling if memories are present
  if (memoryContext) {
    parts.push(CONFLICT_HANDLING_INSTRUCTIONS);

    if (options.context.visibility === "shared") {
      parts.push(AMBIGUITY_HANDLING_INSTRUCTIONS);
    }
  }

  // ... rest of function ...
}
```

### 17.5 Success Criteria

- [ ] Corrections detected: "Actually...", "That's not right...", etc.
- [ ] Memory updated/deleted on confirmed correction
- [ ] Agent asks for clarification on conflicts
- [ ] Ambiguous "my X" prompts clarification in shared threads
- [ ] Old memories rank lower than recent ones

### 17.6 Tests

```typescript
describe("Correction Detection", () => {
  it("detects 'actually' corrections", () => {
    const result = detectCorrection("Actually, I'm not vegetarian anymore");
    expect(result.isCorrection).toBe(true);
  });

  it("detects 'that's not right' corrections", () => {
    const result = detectCorrection("That's not right, my mom's name is Sarah");
    expect(result.isCorrection).toBe(true);
    expect(result.strength).toBe("strong");
  });
});

describe("Ambiguity Detection", () => {
  it("flags ambiguous possessives in shared thread", () => {
    const result = detectAmbiguity("My mom is visiting", sharedContext);
    expect(result.isAmbiguous).toBe(true);
    expect(result.clarificationPrompt).toContain("your mom or");
  });

  it("does not flag in DM thread", () => {
    const result = detectAmbiguity("My mom is visiting", dmContext);
    expect(result.isAmbiguous).toBe(false);
  });
});

describe("Memory Decay", () => {
  it("ranks recently accessed memories higher", async () => {
    // Create two memories
    const old = await storeMemory({ ...baseInput, content: "Old fact" });
    const recent = await storeMemory({ ...baseInput, content: "Recent fact" });

    // Access the "old" one to make it recent
    await searchMemories({ ...searchInput, query: "fact" });

    // Wait and access "recent" one
    await sleep(100);
    await sql`UPDATE memories SET last_accessed_at = NOW() WHERE id = ${recent.id}`;

    // Search should return recent first
    const results = await searchMemories({ ...searchInput, query: "fact" });
    expect(results[0].id).toBe(recent.id);
  });
});
```

---

## Stage 18: Cross-Partner & Calendar Integration

### Goal
Enable proactive partner context sharing and store relevant calendar event information.

### 18.1 Cross-Partner Memory Sharing

The privacy filtering in Stage 14 already supports this. Key rules:

| Current Thread | Memory Source | Visible? |
|----------------|---------------|----------|
| Shared | Partner's shared memory | ✅ Yes |
| Shared | Partner's DM memory | ❌ No |
| DM | Partner's any memory | ❌ No |
| Any | Own memories | ✅ Yes |
| Any | Couple-level memories | ✅ Yes |

### 18.2 System Prompt for Proactive Sharing

**Add to `src/agent/system-prompt.ts`:**

```typescript
export const CROSS_PARTNER_INSTRUCTIONS = `
## Partner Context

You have access to memories from both partners (except private DM memories).
When relevant, you may proactively share context about their partner:

Good examples:
- "Your partner mentioned being stressed about the Johnson project - maybe check in with them?"
- "I remember Sarah said she loves Italian food - that might help with dinner planning"

Never share:
- Information from partner's private (DM) conversations
- Sensitive information without good reason
- Speculation about partner's feelings or intentions

When sharing partner context, be helpful but not intrusive.
`;
```

### 18.3 Calendar Event Memory Extraction

**File: `src/agent/tools/calendar.ts` (modifications)**

```typescript
import { storeMemory } from "../../db/queries/memories.js";

// In createCalendarEvent tool execute function:
execute: async ({ title, startTime, endTime, description, attendees, whose }) => {
  // ... existing event creation code ...

  const result = await createEvent(calendarId, {
    title,
    startTime,
    endTime,
    description,
    attendees,
  });

  // NEW: Extract and store memories from calendar event
  if (result.success) {
    await extractCalendarMemories(result.event, ctx.session);
  }

  return result;
}

/**
 * Extract memorable information from calendar events
 */
async function extractCalendarMemories(
  event: CalendarEvent,
  context: SessionContext
): Promise<void> {
  const memories: Array<{ content: string; category: MemoryCategory }> = [];

  // Extract attendee relationships
  if (event.attendees?.length) {
    for (const attendee of event.attendees) {
      if (attendee.email && attendee.displayName) {
        // Don't store partner's email as a "relationship"
        if (attendee.email !== context.partnerEmail) {
          memories.push({
            content: `Has contact: ${attendee.displayName} (${attendee.email})`,
            category: "relationship",
          });
        }
      }
    }
  }

  // Extract meeting context if title suggests it
  const meetingPatterns = [
    { pattern: /meeting with (.+)/i, type: "meeting" },
    { pattern: /call with (.+)/i, type: "call" },
    { pattern: /appointment with (.+)/i, type: "appointment" },
    { pattern: /(.+) appointment/i, type: "appointment" },
  ];

  for (const { pattern, type } of meetingPatterns) {
    const match = event.title.match(pattern);
    if (match) {
      memories.push({
        content: `Scheduled ${type} with ${match[1]}`,
        category: "context",
      });
      break;
    }
  }

  // Store extracted memories
  for (const memory of memories) {
    try {
      await storeMemory({
        coupleId: context.coupleId,
        userId: context.userId,
        content: memory.content,
        category: memory.category,
        sourceThreadId: context.threadId,
        sourceVisibility: context.visibility,
      });
    } catch (error) {
      console.error("[calendar] Failed to store memory:", error);
    }
  }
}
```

### 18.4 Success Criteria

- [ ] Partner's shared memories visible in shared thread
- [ ] Partner's DM memories never visible
- [ ] Proactive partner sharing works naturally
- [ ] Calendar events with attendees create relationship memories
- [ ] Calendar event titles create context memories
- [ ] Privacy boundary tested: surprise planning stays hidden

### 18.5 Tests

```typescript
describe("Cross-Partner Sharing", () => {
  it("shows partner shared memories in shared thread", async () => {
    // Partner A creates memory in shared thread
    await storeMemory({
      coupleId: testCouple.id,
      userId: partnerA.id,
      content: "Working on Johnson project",
      category: "context",
      sourceVisibility: "shared",
    });

    // Partner B retrieves memories
    const results = await searchMemories({
      coupleId: testCouple.id,
      userId: partnerB.id,
      query: "Johnson project",
      visibility: "shared",
    });

    expect(results).toHaveLength(1);
    expect(results[0].fromPartner).toBe(true);
  });

  it("hides partner DM memories everywhere", async () => {
    // Partner A creates surprise memory in DM
    await storeMemory({
      coupleId: testCouple.id,
      userId: partnerA.id,
      content: "Planning surprise birthday party",
      category: "context",
      sourceVisibility: "dm",
    });

    // Partner B searches in shared AND dm
    const sharedResults = await searchMemories({
      coupleId: testCouple.id,
      userId: partnerB.id,
      query: "birthday party",
      visibility: "shared",
    });

    const dmResults = await searchMemories({
      coupleId: testCouple.id,
      userId: partnerB.id,
      query: "birthday party",
      visibility: "dm",
    });

    expect(sharedResults).toHaveLength(0);
    expect(dmResults).toHaveLength(0);
  });
});

describe("Calendar Memory Extraction", () => {
  it("extracts attendee as relationship memory", async () => {
    // Create event with attendee
    await createCalendarEventWithMemory(
      { title: "Meeting", attendees: [{ email: "dr.smith@clinic.com", displayName: "Dr. Smith" }] },
      testContext
    );

    // Search for the relationship
    const results = await searchMemories({
      coupleId: testCouple.id,
      userId: testUser.id,
      query: "Dr. Smith",
      visibility: "shared",
    });

    expect(results.some((m) => m.category === "relationship")).toBe(true);
  });
});
```

---

## Privacy Model

### Visual Reference

```
┌─────────────────────────────────────────────────────────────────┐
│                     Memory Visibility Matrix                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Memory Type          │ Partner A │ Partner B │ In Shared │     │
│  ─────────────────────┼───────────┼───────────┼───────────┤     │
│  A's shared memory    │    ✅     │    ✅     │    ✅     │     │
│  A's DM memory        │    ✅     │    ❌     │    ❌*    │     │
│  B's shared memory    │    ✅     │    ✅     │    ✅     │     │
│  B's DM memory        │    ❌     │    ✅     │    ❌*    │     │
│  Couple-level memory  │    ✅     │    ✅     │    ✅     │     │
│                                                                  │
│  * In shared thread, DM memories from EITHER partner are hidden │
│    to prevent accidental leaks                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Checklist

- [x] `source_visibility` tracked on every memory (Stage 14)
- [x] `isMemoryVisible()` filter function (Stage 14)
- [x] Privacy filter applied in `searchMemories()` (Stage 14)
- [x] DM context triggers stricter filtering (Stage 15)
- [ ] Integration tests for all visibility scenarios (Stage 18)

---

## Error Handling & Fallbacks

### Graceful Degradation

| Failure | Fallback | User Impact |
|---------|----------|-------------|
| mem0 API timeout (>500ms) | Local DB full-text search | Slightly less accurate results |
| mem0 API error | Local DB full-text search | Slightly less accurate results |
| Extraction API error | Skip extraction | No new memories stored |
| Local DB error | Fail request | Error message to user |

### Monitoring Points

```typescript
// Add to src/lib/metrics.ts (future)

interface MemoryMetrics {
  mem0_latency_p50: number;
  mem0_latency_p95: number;
  mem0_latency_p99: number;
  mem0_timeout_rate: number;
  mem0_error_rate: number;
  fallback_usage_rate: number;
  extraction_rate: number;  // memories per conversation
  retrieval_hit_rate: number;  // % of retrievals that found relevant memories
}
```

---

## Testing Strategy

### Unit Tests

| Component | File | Tests |
|-----------|------|-------|
| mem0 client | `tests/integrations/mem0.test.ts` | Connection, CRUD, timeout |
| DB queries | `tests/db/memories.test.ts` | Store, search, privacy filter |
| Retrieval heuristics | `tests/agent/memory-context.test.ts` | Trigger patterns, skip patterns |
| Extraction | `tests/agent/memory-extraction.test.ts` | Categories, explicit detection |
| Conflict detection | `tests/agent/memory-conflicts.test.ts` | Correction patterns |
| Ambiguity detection | `tests/agent/memory-ambiguity.test.ts` | Possessive patterns |

### Integration Tests

| Scenario | File | Tests |
|----------|------|-------|
| Full flow | `tests/integration/memory-flow.test.ts` | Message → extraction → retrieval |
| Privacy | `tests/integration/memory-privacy.test.ts` | DM isolation, partner visibility |
| Conflicts | `tests/integration/memory-conflicts.test.ts` | Conflict detection → clarification |

### Manual Testing Checklist

- [ ] Store memory via "remember that..." → confirm inline
- [ ] Retrieve memory via related question → see citation
- [ ] Correct memory via "actually..." → see update confirmation
- [ ] Partner A DM memory → Partner B never sees
- [ ] Partner A shared memory → Partner B sees in shared
- [ ] Calendar event with attendee → creates relationship memory
- [ ] mem0 timeout → local search works
- [ ] Ambiguous "my mom" in shared → asks for clarification

---

## Rollout Plan

### Phase 1: Foundation (Stage 14)
- Deploy mem0 client + DB migration
- No user-facing changes
- Verify mem0 connectivity in production

### Phase 2: Read Path (Stage 15)
- Enable memory retrieval for one test couple
- Monitor latency impact
- Verify privacy filtering

### Phase 3: Write Path (Stage 16)
- Enable extraction for test couple
- Monitor extraction rate and quality
- Tune extraction prompts if needed

### Phase 4: Full Features (Stage 17-18)
- Enable conflicts/corrections handling
- Enable cross-partner sharing
- Enable calendar integration

### Phase 5: General Availability
- Enable for all couples
- Monitor metrics
- Iterate based on feedback

### Feature Flag

```typescript
// src/lib/feature-flags.ts

export const MEMORY_FLAGS = {
  // Master switch
  MEMORY_ENABLED: process.env.MEMORY_ENABLED === "true",

  // Granular flags
  MEMORY_RETRIEVAL: process.env.MEMORY_RETRIEVAL === "true",
  MEMORY_EXTRACTION: process.env.MEMORY_EXTRACTION === "true",
  MEMORY_CONFLICTS: process.env.MEMORY_CONFLICTS === "true",
  MEMORY_CROSS_PARTNER: process.env.MEMORY_CROSS_PARTNER === "true",
  MEMORY_CALENDAR: process.env.MEMORY_CALENDAR === "true",

  // Per-couple allowlist (for gradual rollout)
  MEMORY_ALLOWED_COUPLES: (process.env.MEMORY_ALLOWED_COUPLES ?? "")
    .split(",")
    .filter(Boolean),
};

export function isMemoryEnabledForCouple(coupleId: string): boolean {
  if (!MEMORY_FLAGS.MEMORY_ENABLED) return false;
  if (MEMORY_FLAGS.MEMORY_ALLOWED_COUPLES.length === 0) return true;
  return MEMORY_FLAGS.MEMORY_ALLOWED_COUPLES.includes(coupleId);
}
```

---

## Appendix: mem0 API Reference

### Authentication
```typescript
const client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
```

### Add Memory
```typescript
const response = await client.add(
  [{ role: "user", content: "Blake is allergic to shellfish" }],
  { user_id: "couple-uuid", metadata: { category: "fact" } }
);
// Returns: { results: [{ id: "mem0-uuid", memory: "..." }] }
```

### Search Memories
```typescript
const response = await client.search("allergies", {
  user_id: "couple-uuid",
  limit: 10,
});
// Returns: { results: [{ id, memory, score, metadata }] }
```

### Update Memory
```typescript
await client.update("mem0-uuid", "Blake is no longer allergic to shellfish");
```

### Delete Memory
```typescript
await client.delete("mem0-uuid");
```

### Get All Memories
```typescript
const response = await client.getAll({ user_id: "couple-uuid" });
// Returns: { results: [{ id, memory, metadata }] }
```

---

*Last updated: Stage 14-18 specification complete*
