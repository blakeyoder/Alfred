/**
 * Langfuse client for datasets, experiments, and direct API access.
 *
 * This complements the OpenTelemetry integration in lib/instrumentation.ts
 * by providing access to Langfuse's dataset and evaluation features.
 *
 * Uses environment variables:
 * - LANGFUSE_PUBLIC_KEY
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_BASE_URL (optional, defaults to cloud.langfuse.com)
 */
import { LangfuseClient } from "@langfuse/client";

// Singleton client instance
let client: LangfuseClient | null = null;

/**
 * Get the Langfuse client instance.
 * Lazily initialized on first access.
 */
export function getLangfuseClient(): LangfuseClient {
  if (!client) {
    // LangfuseClient automatically reads from environment variables
    client = new LangfuseClient();
  }
  return client;
}

/**
 * Flush pending data to Langfuse.
 * Call this before process exit to ensure all data is sent.
 */
export async function flushLangfuse(): Promise<void> {
  if (client) {
    await client.flush();
  }
}
