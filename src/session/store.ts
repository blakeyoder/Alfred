import { readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface Session {
  userId: string;
  coupleId: string;
  activeThreadId: string;
  visibility: "shared" | "dm";
}

const SESSION_DIR = join(homedir(), ".couplesea");
const SESSION_FILE = join(SESSION_DIR, "session.json");

async function ensureSessionDir(): Promise<void> {
  try {
    await mkdir(SESSION_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

export async function loadSession(): Promise<Session | null> {
  try {
    const data = await readFile(SESSION_FILE, "utf-8");
    return JSON.parse(data) as Session;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await ensureSessionDir();
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
}

export async function clearSession(): Promise<void> {
  try {
    await writeFile(SESSION_FILE, "");
  } catch {
    // File doesn't exist, that's fine
  }
}

export async function updateSession(
  updates: Partial<Session>
): Promise<Session | null> {
  const current = await loadSession();
  if (!current) {
    return null;
  }

  const updated = { ...current, ...updates };
  await saveSession(updated);
  return updated;
}
