import { sql } from "../client.js";

export interface ConversationThread {
  id: string;
  couple_id: string;
  visibility: "shared" | "dm";
  dm_owner_user_id: string | null;
  started_by: string | null;
  created_at: Date;
}

export async function getThreadById(
  id: string
): Promise<ConversationThread | null> {
  const rows = await sql<ConversationThread[]>`
    SELECT * FROM conversation_threads WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function getThreadsForUser(
  userId: string
): Promise<ConversationThread[]> {
  return sql<ConversationThread[]>`
    SELECT t.* FROM conversation_threads t
    JOIN conversation_participants cp ON cp.thread_id = t.id
    WHERE cp.user_id = ${userId}
    ORDER BY t.created_at DESC
  `;
}

export async function createThread(
  coupleId: string,
  visibility: "shared" | "dm",
  startedBy: string,
  dmOwnerId?: string
): Promise<ConversationThread> {
  const rows = await sql<ConversationThread[]>`
    INSERT INTO conversation_threads (couple_id, visibility, started_by, dm_owner_user_id)
    VALUES (${coupleId}, ${visibility}, ${startedBy}, ${dmOwnerId ?? null})
    RETURNING *
  `;
  return rows[0];
}

export async function addParticipant(
  threadId: string,
  userId: string,
  role = "participant"
): Promise<void> {
  await sql`
    INSERT INTO conversation_participants (thread_id, user_id, role)
    VALUES (${threadId}, ${userId}, ${role})
    ON CONFLICT (thread_id, user_id) DO NOTHING
  `;
}

export async function isParticipant(
  threadId: string,
  userId: string
): Promise<boolean> {
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM conversation_participants
    WHERE thread_id = ${threadId} AND user_id = ${userId}
  `;
  return rows[0].count > 0;
}
