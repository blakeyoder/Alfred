import { Telegraf } from "telegraf";
import {
  getUserByTelegramId,
  linkTelegramAccount,
  unlinkTelegramAccount,
} from "../../../db/queries/telegram.js";
import { buildSessionContext } from "./utils.js";

/**
 * Register account-related commands: /start, /link, /unlink, /status
 */
export function registerAccountHandlers(bot: Telegraf): void {
  // /start command
  bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await getUserByTelegramId(telegramId);

    if (user) {
      await ctx.reply(
        `Welcome back, ${user.name}! Just send me a message and I'll help you and your partner stay organized.`
      );
    } else {
      await ctx.reply(
        "Welcome to Alfred! To get started, link your account:\n\n" +
          "/link <your-email>\n\n" +
          "Example: /link blake@example.com"
      );
    }
  });

  // /link command
  bot.command("link", async (ctx) => {
    const telegramId = ctx.from.id;

    // Check if already linked
    const existingUser = await getUserByTelegramId(telegramId);
    if (existingUser) {
      await ctx.reply(
        `You're already linked as ${existingUser.name} (${existingUser.email}).\n\n` +
          "Use /unlink to disconnect first if you want to switch accounts."
      );
      return;
    }

    // Get email from command
    const args = ctx.message.text.split(" ").slice(1);
    const email = args[0]?.toLowerCase().trim();

    if (!email) {
      await ctx.reply(
        "Usage: /link <your-email>\n\nExample: /link blake@example.com"
      );
      return;
    }

    // Attempt to link
    const user = await linkTelegramAccount(email, telegramId);

    if (!user) {
      await ctx.reply(
        `No account found for ${email}.\n\n` +
          "Make sure you use the email from your Alfred account."
      );
      return;
    }

    await ctx.reply(
      `Linked! You're connected as ${user.name} (${user.email}).\n\n` +
        "Send me a message to get started!"
    );
  });

  // /unlink command
  bot.command("unlink", async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply("You're not linked to any account.");
      return;
    }

    await unlinkTelegramAccount(telegramId);
    await ctx.reply(
      `Unlinked from ${user.email}.\n\nUse /link <email> to connect a different account.`
    );
  });

  // /status command
  bot.command("status", async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply("Not linked. Use /link <email> to connect your account.");
      return;
    }

    const session = await buildSessionContext(user.id);
    if (!session) {
      await ctx.reply(
        `Linked as ${user.name} (${user.email})\n\n` +
          "But no couple found. Make sure you're part of a couple in the system."
      );
      return;
    }

    const phoneStatus = user.phone_number
      ? `Phone: ${user.phone_number}`
      : "Phone: Not set (use /phone to add)";

    await ctx.reply(
      `Account: ${session.context.userName} (${user.email})\n` +
        `Couple: ${session.context.coupleName ?? "Unnamed"}\n` +
        `Partner: ${session.context.partnerName ?? "None"}\n` +
        `${phoneStatus}\n` +
        `Thread: ${session.context.visibility}`
    );
  });
}
