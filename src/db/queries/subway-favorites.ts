import { sql } from "../client.js";

export interface FavoriteStation {
  id: string;
  user_id: string;
  stop_id: string;
  nickname: string | null;
  created_at: Date;
}

/**
 * Get all favorite stations for a user.
 */
export async function getFavoriteStations(
  userId: string
): Promise<FavoriteStation[]> {
  return sql<FavoriteStation[]>`
    SELECT * FROM favorite_subway_stations
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `;
}

/**
 * Add a station to favorites. Updates nickname if already exists.
 */
export async function addFavoriteStation(
  userId: string,
  stopId: string,
  nickname?: string
): Promise<FavoriteStation> {
  const rows = await sql<FavoriteStation[]>`
    INSERT INTO favorite_subway_stations (user_id, stop_id, nickname)
    VALUES (${userId}, ${stopId}, ${nickname ?? null})
    ON CONFLICT (user_id, stop_id)
    DO UPDATE SET nickname = COALESCE(EXCLUDED.nickname, favorite_subway_stations.nickname)
    RETURNING *
  `;
  return rows[0];
}

/**
 * Remove a station from favorites.
 */
export async function removeFavoriteStation(
  userId: string,
  stopId: string
): Promise<boolean> {
  const result = await sql`
    DELETE FROM favorite_subway_stations
    WHERE user_id = ${userId} AND stop_id = ${stopId}
  `;
  return result.count > 0;
}

/**
 * Get a favorite station by nickname (case-insensitive).
 */
export async function getFavoriteByNickname(
  userId: string,
  nickname: string
): Promise<FavoriteStation | null> {
  const rows = await sql<FavoriteStation[]>`
    SELECT * FROM favorite_subway_stations
    WHERE user_id = ${userId} AND LOWER(nickname) = LOWER(${nickname})
  `;
  return rows[0] ?? null;
}
