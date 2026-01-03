import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30, // 30 minutes
});

// Type guard for postgres.js errors
interface PostgresError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
}

export function isPostgresError(error: unknown): error is PostgresError {
  return error instanceof Error && "code" in error;
}

// Common Postgres error codes
const POSTGRES_ERROR_CODES = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  NOT_NULL_VIOLATION: "23502",
  CHECK_VIOLATION: "23514",
} as const;

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

export function handleDbError(error: unknown): never {
  if (isPostgresError(error)) {
    switch (error.code) {
      case POSTGRES_ERROR_CODES.UNIQUE_VIOLATION:
        throw new DatabaseError(
          `Duplicate entry: ${error.detail ?? error.message}`,
          error.code,
          error.detail
        );
      case POSTGRES_ERROR_CODES.FOREIGN_KEY_VIOLATION:
        throw new DatabaseError(
          `Referenced record not found: ${error.detail ?? error.message}`,
          error.code,
          error.detail
        );
      case POSTGRES_ERROR_CODES.NOT_NULL_VIOLATION:
        throw new DatabaseError(
          `Required field missing: ${error.column ?? error.message}`,
          error.code,
          error.detail
        );
      case "CONNECT_TIMEOUT":
        throw new DatabaseError("Database connection timed out", error.code);
      case "CONNECTION_CLOSED":
        throw new DatabaseError(
          "Database connection closed unexpectedly",
          error.code
        );
      default:
        throw new DatabaseError(
          `Database error: ${error.message}`,
          error.code,
          error.detail
        );
    }
  }
  throw error;
}

export async function testConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}

export async function closeConnection(): Promise<void> {
  await sql.end({ timeout: 5 });
}
