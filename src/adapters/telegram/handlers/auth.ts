import { Telegraf } from "telegraf";
import { getUserByTelegramId } from "../../../db/queries/telegram.js";
import {
  initiateDeviceFlow,
  completeDeviceFlow,
  storeTokens,
  hasGoogleAuth,
} from "../../../integrations/google-auth.js";

/**
 * Register Google OAuth handler: /auth
 */
export function registerAuthHandlers(bot: Telegraf): void {
  bot.command("auth", async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply("Please link your account first: /link <email>");
      return;
    }

    // Check if already authenticated
    const hasAuth = await hasGoogleAuth(user.id);
    if (hasAuth) {
      await ctx.reply(
        "You're already connected to Google Calendar.\n\n" +
          "Use /calendar to manage your shared calendar."
      );
      return;
    }

    try {
      await ctx.reply("Starting Google authentication...");

      const flow = await initiateDeviceFlow();

      await ctx.reply(
        "To connect Google Calendar:\n\n" +
          `1. Open: ${flow.verificationUrl}\n` +
          `2. Enter code: ${flow.userCode}\n\n` +
          "Waiting for you to complete authorization..."
      );

      // Poll for completion (with timeout)
      const tokens = await completeDeviceFlow(
        flow.deviceCode,
        flow.interval,
        flow.expiresIn
      );

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const scopes = tokens.scope.split(" ");

      await storeTokens(
        user.id,
        tokens.access_token,
        tokens.refresh_token,
        expiresAt,
        scopes
      );

      await ctx.reply(
        "Google Calendar connected successfully!\n\n" +
          "Use /calendar list to see your calendars and set up a shared one."
      );
    } catch (error) {
      if (error instanceof Error) {
        await ctx.reply(`Authentication failed: ${error.message}`);
      } else {
        await ctx.reply("Authentication failed. Please try again.");
      }
    }
  });
}
