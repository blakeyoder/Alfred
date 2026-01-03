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
  MemoryCategory,
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
    console.warn(
      "[memories] Stored locally but mem0 failed:",
      mem0Result.error
    );
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
    results = await localFullTextSearch(
      coupleId,
      userId,
      query,
      visibility,
      limit
    );
  }

  // Update last_accessed_at for retrieved memories (fire and forget)
  const memoryIds = results.map((r) => r.id);
  if (memoryIds.length > 0) {
    sql`
      UPDATE memories
      SET last_accessed_at = NOW()
      WHERE id = ANY(${memoryIds})
    `.catch((err) =>
      console.error("[memories] Failed to update access time:", err)
    );
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

  const localByMem0Id = new Map(localRecords.map((r) => [r.mem0_id, r]));

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
      relevance_score: mem0Result.score,
      from_partner: local.user_id !== null && local.user_id !== currentUserId,
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
    relevance_score: m.rank,
    from_partner: m.user_id !== null && m.user_id !== currentUserId,
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
  if (memory.user_id === null) {
    return true;
  }

  // User's own memories are always visible to them
  if (memory.user_id === currentUserId) {
    return true;
  }

  // Partner's memories...
  if (currentVisibility === "dm") {
    // In DM: can't see any partner memories
    return false;
  }

  // In shared thread: can see partner's shared-sourced memories
  // but NOT their DM-sourced memories
  return memory.source_visibility !== "dm";
}

/**
 * Update a memory (content and/or category)
 */
export async function updateMemory(
  memoryId: string,
  updates: { content?: string; category?: MemoryCategory }
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
  if (current.mem0_id && updates.content) {
    await updateMemoryInMem0(current.mem0_id, newContent);
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
  if (memory.mem0_id) {
    await deleteMemoryFromMem0(memory.mem0_id);
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
    const keywords = content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
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
export async function getAllMemoriesForCouple(
  coupleId: string
): Promise<Memory[]> {
  return sql<Memory[]>`
    SELECT * FROM memories
    WHERE couple_id = ${coupleId}
    ORDER BY created_at DESC
  `;
}
