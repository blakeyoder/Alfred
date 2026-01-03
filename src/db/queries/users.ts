import { sql } from "../client.js";

export interface User {
  id: string;
  email: string;
  name: string;
  google_id: string | null;
  created_at: Date;
}

export async function getUserById(id: string): Promise<User | null> {
  const rows = await sql<User[]>`
    SELECT * FROM users WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function createUser(
  email: string,
  name: string,
  googleId?: string
): Promise<User> {
  const rows = await sql<User[]>`
    INSERT INTO users (email, name, google_id)
    VALUES (${email}, ${name}, ${googleId ?? null})
    RETURNING *
  `;
  return rows[0];
}
