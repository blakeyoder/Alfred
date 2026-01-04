import { Telegraf } from "telegraf";

/**
 * Register help command handler: /help
 */
export function registerHelpHandlers(bot: Telegraf): void {
  bot.help(async (ctx) => {
    await ctx.reply(
      "Alfred - Your shared assistant\n\n" +
        "Account:\n" +
        "/link <email> - Connect your account\n" +
        "/unlink - Disconnect account\n" +
        "/status - Show current connection\n" +
        "/phone - Set callback number for voice calls\n\n" +
        "Group Setup:\n" +
        "/setup - Link this group to your couple\n\n" +
        "Google Calendar:\n" +
        "/auth - Connect Google Calendar\n" +
        "/calendar list - List calendars\n" +
        "/calendar set <id> - Set shared calendar\n" +
        "/calendar show - Show shared calendar\n\n" +
        "Just send a message to chat with your EA!"
    );
  });
}
