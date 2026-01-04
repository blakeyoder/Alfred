/**
 * Centralized configuration module with Zod validation.
 * All environment variables should be accessed through this module.
 */
import { z } from "zod";

/**
 * Environment variable schema with validation rules.
 * Required variables will cause startup failure if missing.
 */
const EnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Encryption (32 bytes = 64 hex chars)
  ENCRYPTION_KEY: z
    .string()
    .length(64, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)")
    .regex(/^[0-9a-fA-F]+$/, "ENCRYPTION_KEY must be valid hex"),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),

  // mem0
  MEM0_API_KEY: z.string().min(1, "MEM0_API_KEY is required"),

  // ElevenLabs
  ELEVENLABS_API_KEY: z.string().min(1, "ELEVENLABS_API_KEY is required"),
  ELEVENLABS_PHONE_NUMBER_ID: z
    .string()
    .min(1, "ELEVENLABS_PHONE_NUMBER_ID is required"),
  ELEVENLABS_WEBHOOK_SECRET: z
    .string()
    .min(1, "ELEVENLABS_WEBHOOK_SECRET is required"),
  ELEVENLABS_AGENT_GENERAL: z.string().optional(),
  ELEVENLABS_AGENT_RESTAURANT: z.string().optional(),
  ELEVENLABS_AGENT_MEDICAL: z.string().optional(),
  ELEVENLABS_AGENT_ID: z.string().optional(), // Legacy fallback

  // Parallel
  PARALLEL_API_KEY: z.string().min(1, "PARALLEL_API_KEY is required"),

  // Server (optional - only needed in webhook mode)
  APP_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),

  // Debug (optional)
  DEBUG_AUTH_TOKEN: z.string().optional(),
});

type Environment = z.infer<typeof EnvSchema>;

let config: Environment | null = null;

/**
 * Get the validated configuration.
 * Validates environment variables on first access and caches the result.
 * Throws an error with details if validation fails.
 */
function getConfig(): Environment {
  if (!config) {
    const result = EnvSchema.safeParse(process.env);

    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      const errorMessages = Object.entries(errors)
        .map(([field, messages]) => `  ${field}: ${messages?.join(", ")}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${errorMessages}`);
    }

    config = result.data;
  }

  return config;
}

// ============================================================================
// Typed getters for specific config values
// ============================================================================

// Database
export function getDatabaseUrl(): string {
  return getConfig().DATABASE_URL;
}

// Encryption
export function getEncryptionKey(): Buffer {
  return Buffer.from(getConfig().ENCRYPTION_KEY, "hex");
}

// OpenAI
export function getOpenAIModel(): string {
  return getConfig().OPENAI_MODEL;
}

// Google OAuth
export function getGoogleCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const config = getConfig();
  return {
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
  };
}

// Telegram
export function getTelegramBotToken(): string {
  return getConfig().TELEGRAM_BOT_TOKEN;
}

// mem0
export function getMem0ApiKey(): string {
  return getConfig().MEM0_API_KEY;
}

// ElevenLabs
export type VoiceAgentType = "restaurant" | "medical" | "general";

export function getElevenLabsAgentId(agentType: VoiceAgentType): string {
  const config = getConfig();
  const agentIds: Record<VoiceAgentType, string | undefined> = {
    restaurant: config.ELEVENLABS_AGENT_RESTAURANT,
    medical: config.ELEVENLABS_AGENT_MEDICAL,
    general: config.ELEVENLABS_AGENT_GENERAL,
  };

  // Try the specific agent first
  const specificAgent = agentIds[agentType];
  if (specificAgent) {
    return specificAgent;
  }

  // Fall back to general agent
  const generalAgent = agentIds.general;
  if (generalAgent) {
    console.log(
      `[config] No agent configured for type "${agentType}", using general agent`
    );
    return generalAgent;
  }

  // Legacy fallback to old single agent ID
  const legacyAgent = config.ELEVENLABS_AGENT_ID;
  if (legacyAgent) {
    console.log(
      `[config] No typed agents configured, using legacy ELEVENLABS_AGENT_ID`
    );
    return legacyAgent;
  }

  throw new Error(
    `No ElevenLabs agent configured. Set ELEVENLABS_AGENT_GENERAL or ELEVENLABS_AGENT_ID.`
  );
}
