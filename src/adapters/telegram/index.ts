/**
 * Telegram bot entry point - Polling mode (development)
 *
 * Use this for local development. For production, use server.ts with webhooks.
 *
 * Usage: npm run telegram
 */
import "dotenv/config";
import { createBot } from "./bot.js";
import { closeConnection } from "../../db/client.js";
import {
  startReminderNotifications,
  stopReminderNotifications,
} from "../../services/reminder-notifications.js";
import { getTelegramBotToken } from "../../lib/config.js";

const bot = createBot(getTelegramBotToken());

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`);
  stopReminderNotifications();
  bot.stop(signal);
  await closeConnection();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

// Start the bot in polling mode
async function main() {
  console.log("Starting Alfred Telegram bot (polling mode)...");
  console.log("Bot is running. Press Ctrl+C to stop.\n");

  // Start proactive reminder notifications
  startReminderNotifications(bot.telegram);

  await bot.launch();
}

main().catch(async (error) => {
  console.error("Bot error:", error);
  await closeConnection();
  process.exit(1);
});
