import { sql } from "../client.js";

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  user_id: string | null;
  content: string | null;
  tool_calls: unknown | null;
  created_at: Date;
}

export async function getMessages(
  userId: string,
  threadId: string,
  limit = 50
): Promise<Message[]> {
  // Only return messages from threads user can access
  const rows = await sql<Message[]>`
    SELECT m.* FROM messages m
    JOIN conversation_participants cp ON cp.thread_id = m.thread_id
    WHERE cp.user_id = ${userId}
      AND m.thread_id = ${threadId}
    ORDER BY m.created_at ASC
    LIMIT ${limit}
  `;
  return rows;
}

export async function saveMessage(
  threadId: string,
  role: Message["role"],
  content: string | null,
  userId?: string,
  toolCalls?: unknown
): Promise<Message> {
  const rows = await sql<Message[]>`
    INSERT INTO messages (thread_id, role, content, user_id, tool_calls)
    VALUES (${threadId}, ${role}, ${content}, ${userId ?? null}, ${toolCalls ? JSON.stringify(toolCalls) : null})
    RETURNING *
  `;
  return rows[0];
}

export async function getRecentMessagesForContext(
  threadId: string,
  limit = 20
): Promise<Message[]> {
  // Get the most recent messages for context window
  const rows = await sql<Message[]>`
    SELECT * FROM (
      SELECT * FROM messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    ) sub
    ORDER BY created_at ASC
  `;
  return rows;
}
