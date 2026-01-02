/**
 * Telegram bot server - Webhook mode (production)
 *
 * Use this for Railway deployment. Uses Express to handle webhooks.
 *
 * Usage: npm start
 * Required env vars: TELEGRAM_BOT_TOKEN, APP_URL
 */
import "dotenv/config";
import express from "express";
import { createBot } from "./bot.js";
import { closeConnection } from "../../db/client.js";
import { runMigrations } from "../../db/migrations/migrate.js";
import { seedProduction } from "../../scripts/seed-prod.js";

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

// Parse JSON bodies for webhook
app.use(express.json());

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", mode: "webhook" });
});

// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    name: "Alfred",
    status: "running",
    mode: "telegram-webhook",
  });
});

// Telegram webhook endpoint
app.post(webhookPath, async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(500);
  }
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`);
  await bot.telegram.deleteWebhook();
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
}

main().catch(async (error) => {
  console.error("Server error:", error);
  await closeConnection();
  process.exit(1);
});
