import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Disabled max_lifetime - causes negative timeout errors when containers
  // suspend/resume (the library calculates refresh time from connection start,
  // which can be in the "past" after container sleep)
});

export async function closeConnection(): Promise<void> {
  await sql.end({ timeout: 5 });
}
