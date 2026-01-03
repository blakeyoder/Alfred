import "dotenv/config";
import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sql, closeConnection } from "../client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function ensureMigrationsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function getAppliedMigrations(): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM migrations ORDER BY id
  `;
  return rows.map((r) => r.name);
}

async function applyMigration(name: string, content: string): Promise<void> {
  console.log(`Applying migration: ${name}`);

  await sql.begin(async (tx) => {
    await tx.unsafe(content);
    await tx`INSERT INTO migrations (name) VALUES (${name})`;
  });

  console.log(`  Applied: ${name}`);
}

export async function runMigrations(): Promise<void> {
  console.log("Starting migrations...\n");

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = await readdir(__dirname);
  const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort((a, b) => a.localeCompare(b));

  let migrationsRun = 0;

  for (const file of sqlFiles) {
    if (applied.includes(file)) {
      console.log(`  Skipping (already applied): ${file}`);
      continue;
    }

    const filePath = join(__dirname, file);
    const content = await readFile(filePath, "utf-8");
    await applyMigration(file, content);
    migrationsRun++;
  }

  if (migrationsRun === 0) {
    console.log("\nNo new migrations to apply.");
  } else {
    console.log(`\nApplied ${migrationsRun} migration(s).`);
  }
}

// Run as standalone script
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runMigrations()
    .then(() => closeConnection())
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
