import { sql } from "../client.js";
import type { User } from "./users.js";

export interface TelegramUser extends User {
  telegram_id: number | null;
}

export async function getUserByTelegramId(
  telegramId: number
): Promise<TelegramUser | null> {
  const rows = await sql<TelegramUser[]>`
    SELECT * FROM users WHERE telegram_id = ${telegramId}
  `;
  return rows[0] ?? null;
}

export async function linkTelegramAccount(
  email: string,
  telegramId: number
): Promise<TelegramUser | null> {
  const rows = await sql<TelegramUser[]>`
    UPDATE users
    SET telegram_id = ${telegramId}
    WHERE email = ${email}
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function unlinkTelegramAccount(
  telegramId: number
): Promise<boolean> {
  const result = await sql`
    UPDATE users
    SET telegram_id = NULL
    WHERE telegram_id = ${telegramId}
  `;
  return result.count > 0;
}
