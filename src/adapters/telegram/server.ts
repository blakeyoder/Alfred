/**
 * Telegram bot server - Webhook mode (production)
 *
 * Use this for Railway deployment. Uses Express to handle webhooks.
 *
 * Usage: npm start
 * Required env vars: TELEGRAM_BOT_TOKEN, APP_URL
 */
import "dotenv/config";
import {
  initializeTracing,
  shutdownTracing,
} from "../../lib/instrumentation.js";

// Initialize tracing before any other imports that might create spans
initializeTracing();
import express from "express";
import { createBot } from "./bot.js";
import { closeConnection, testConnection } from "../../db/client.js";
import { runMigrations } from "../../db/migrations/migrate.js";
import { seedProduction } from "../../scripts/seed-prod.js";
import {
  startReminderNotifications,
  stopReminderNotifications,
} from "../../services/reminder-notifications.js";
import {
  startVoiceCallNotifications,
  stopVoiceCallNotifications,
} from "../../services/voice-call-notifications.js";
import { handleElevenLabsWebhook } from "../../webhooks/elevenlabs.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

const appUrl = process.env.APP_URL;
if (!appUrl) {
  throw new Error("APP_URL is required for webhook mode");
}

const port = parseInt(process.env.PORT || "3000", 10);
const webhookPath = "/webhook/telegram";
const webhookUrl = `${appUrl}${webhookPath}`;

const bot = createBot(token);
const app = express();

// ElevenLabs webhook needs raw body for signature validation
// Must be registered BEFORE express.json() middleware
app.use(
  "/webhook/elevenlabs",
  express.json({
    verify: (req, _res, buf) => {
      (req as Express.Request & { rawBody?: string }).rawBody = buf.toString();
    },
  })
);

// Parse JSON bodies for other webhooks
app.use(express.json());

// Health check endpoint (with DB check)
app.get("/health", async (_req, res) => {
  const dbOk = await testConnection();
  if (dbOk) {
    res.json({ status: "ok", mode: "webhook", db: "ok" });
  } else {
    res.status(503).json({ status: "degraded", mode: "webhook", db: "error" });
  }
});

// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    name: "Alfred",
    status: "running",
    mode: "telegram-webhook",
  });
});

// Debug endpoint to check webhook status
app.get("/debug/webhook", async (_req, res) => {
  try {
    const info = await bot.telegram.getWebhookInfo();
    res.json({
      url: info.url,
      has_custom_certificate: info.has_custom_certificate,
      pending_update_count: info.pending_update_count,
      last_error_date: info.last_error_date,
      last_error_message: info.last_error_message,
      max_connections: info.max_connections,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Telegram webhook endpoint
app.post(webhookPath, async (req, res) => {
  const updateId = req.body?.update_id;
  const messageText = req.body?.message?.text?.slice(0, 50);
  console.log(
    `[webhook] Received update ${updateId}: ${messageText ?? "(no text)"}`
  );

  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("[webhook] Error processing update:", error);
    res.sendStatus(500);
  }
});

// ElevenLabs webhook endpoint for call completion events
app.post("/webhook/elevenlabs", async (req, res) => {
  await handleElevenLabsWebhook(
    req as Parameters<typeof handleElevenLabsWebhook>[0],
    res
  );
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`);
  stopReminderNotifications();
  stopVoiceCallNotifications();
  await shutdownTracing();
  // Don't delete webhook - new instance will set it on startup
  // Deleting here causes a race condition during deploys
  await closeConnection();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

// Start the server
async function main() {
  // Run database migrations
  console.log("Running database setup...\n");
  await runMigrations();
  await seedProduction();
  console.log("\nDatabase ready.\n");

  // Set webhook
  console.log(`Setting webhook to ${webhookUrl}...`);
  await bot.telegram.setWebhook(webhookUrl);
  console.log("Webhook set successfully.");

  // Start Express server
  app.listen(port, () => {
    console.log(`\nAlfred Telegram server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`Webhook endpoint: ${webhookUrl}\n`);
  });

  // Start proactive notification services
  startReminderNotifications(bot.telegram);
  startVoiceCallNotifications(bot.telegram);
}

main().catch(async (error) => {
  console.error("Server error:", error);
  await closeConnection();
  process.exit(1);
});
