import postgres from "postgres";
import { getDatabaseUrl } from "../lib/config.js";

export const sql = postgres(getDatabaseUrl(), {
  max: 10,
  idle_timeout: 0, // Disable idle timeout - let connections stay open
  connect_timeout: 10,
  // Keep connections fresh by forcing new ones periodically
  // This helps when containers sleep/wake
  onnotice: () => {}, // Suppress notice messages
});

export async function closeConnection(): Promise<void> {
  await sql.end({ timeout: 5 });
}

/**
 * Test database connectivity. Call this to verify the connection is working.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    console.error("[db] Connection test failed:", error);
    return false;
  }
}
