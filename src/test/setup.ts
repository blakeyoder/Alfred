/**
 * Jest setup file - runs before each test file.
 * Provides mock environment variables for unit tests that don't need real services.
 */

// Set mock env vars before any modules are loaded
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.ENCRYPTION_KEY = "0".repeat(64); // 32-byte hex key
process.env.OPENAI_API_KEY = "sk-test-key";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
process.env.MEM0_API_KEY = "test-mem0-key";
process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
process.env.ELEVENLABS_PHONE_NUMBER_ID = "test-phone-id";
process.env.ELEVENLABS_WEBHOOK_SECRET = "test-webhook-secret";
process.env.PARALLEL_API_KEY = "test-parallel-key";
