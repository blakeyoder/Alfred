import { sql } from "../client.js";
import type { User } from "./users.js";

export interface Couple {
  id: string;
  name: string | null;
  shared_calendar_id: string | null;
  telegram_group_id: number | null;
  created_at: Date;
}

export async function getCoupleById(id: string): Promise<Couple | null> {
  const rows = await sql<Couple[]>`
    SELECT * FROM couples WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function getCoupleForUser(userId: string): Promise<Couple | null> {
  const rows = await sql<Couple[]>`
    SELECT c.* FROM couples c
    JOIN couple_members cm ON cm.couple_id = c.id
    WHERE cm.user_id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function getPartner(
  coupleId: string,
  userId: string
): Promise<User | null> {
  const rows = await sql<User[]>`
    SELECT u.* FROM users u
    JOIN couple_members cm ON cm.user_id = u.id
    WHERE cm.couple_id = ${coupleId} AND u.id != ${userId}
  `;
  return rows[0] ?? null;
}

export async function createCouple(name?: string): Promise<Couple> {
  const rows = await sql<Couple[]>`
    INSERT INTO couples (name)
    VALUES (${name ?? null})
    RETURNING *
  `;
  return rows[0];
}

export async function addCoupleMembers(
  coupleId: string,
  user1Id: string,
  user2Id: string
): Promise<void> {
  await sql`
    INSERT INTO couple_members (couple_id, user_id, role)
    VALUES
      (${coupleId}, ${user1Id}, 'partner1'),
      (${coupleId}, ${user2Id}, 'partner2')
  `;
}

export async function getSharedCalendarId(
  coupleId: string
): Promise<string | null> {
  const rows = await sql<{ shared_calendar_id: string | null }[]>`
    SELECT shared_calendar_id FROM couples WHERE id = ${coupleId}
  `;
  return rows[0]?.shared_calendar_id ?? null;
}

export async function setSharedCalendarId(
  coupleId: string,
  calendarId: string | null
): Promise<void> {
  await sql`
    UPDATE couples
    SET shared_calendar_id = ${calendarId}
    WHERE id = ${coupleId}
  `;
}

export async function getCoupleByGroupId(
  telegramGroupId: number
): Promise<Couple | null> {
  const rows = await sql<Couple[]>`
    SELECT * FROM couples WHERE telegram_group_id = ${telegramGroupId}
  `;
  return rows[0] ?? null;
}

export async function setTelegramGroupId(
  coupleId: string,
  telegramGroupId: number | null
): Promise<void> {
  await sql`
    UPDATE couples
    SET telegram_group_id = ${telegramGroupId}
    WHERE id = ${coupleId}
  `;
}
