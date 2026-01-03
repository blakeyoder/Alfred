import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30, // Refresh connections every 30 minutes
});

export async function closeConnection(): Promise<void> {
  await sql.end({ timeout: 5 });
}
