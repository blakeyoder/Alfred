import { Telegraf } from "telegraf";
import { getUserByTelegramId } from "../../../db/queries/telegram.js";
import {
  getSharedCalendarId,
  setSharedCalendarId,
} from "../../../db/queries/couples.js";
import { hasGoogleAuth } from "../../../integrations/google-auth.js";
import { listCalendars } from "../../../integrations/google-calendar.js";
import { buildSessionContext } from "./utils.js";

/**
 * Register calendar command handler: /calendar (list, set, show)
 */
export function registerCalendarHandlers(bot: Telegraf): void {
  bot.command("calendar", async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply("Please link your account first: /link <email>");
      return;
    }

    const session = await buildSessionContext(user.id);
    if (!session) {
      await ctx.reply("Unable to find your couple. Make sure you're set up.");
      return;
    }

    const args = ctx.message.text.split(" ").slice(1);
    const subCmd = args[0]?.toLowerCase();

    switch (subCmd) {
      case "list": {
        const hasAuth = await hasGoogleAuth(user.id);
        if (!hasAuth) {
          await ctx.reply(
            "You need to connect Google Calendar first.\n\nUse /auth to get started."
          );
          return;
        }

        try {
          const calendars = await listCalendars(user.id);
          const currentShared = await getSharedCalendarId(
            session.context.coupleId
          );

          if (calendars.length === 0) {
            await ctx.reply("No writable calendars found.");
            return;
          }

          let message = "Writable calendars:\n\n";
          for (const cal of calendars) {
            const isPrimary = cal.primary ? " (primary)" : "";
            const isShared = cal.id === currentShared ? " ★" : "";
            message += `${cal.summary}${isPrimary}${isShared}\n`;
            message += `ID: ${cal.id}\n\n`;
          }
          message += "Use /calendar set <id> to set the shared calendar.";

          await ctx.reply(message);
        } catch (error) {
          await ctx.reply(
            `Failed to list calendars: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
        break;
      }

      case "set": {
        const calendarId = args.slice(1).join(" ");
        if (!calendarId) {
          await ctx.reply(
            "Usage: /calendar set <calendar_id>\n\n" +
              "Use /calendar list to see available calendar IDs."
          );
          return;
        }

        try {
          await setSharedCalendarId(session.context.coupleId, calendarId);
          await ctx.reply(`Shared calendar set to:\n${calendarId}`);
        } catch (error) {
          await ctx.reply(
            `Failed to set calendar: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
        break;
      }

      case "show": {
        const currentShared = await getSharedCalendarId(
          session.context.coupleId
        );
        if (currentShared) {
          await ctx.reply(`Shared calendar:\n${currentShared}`);
        } else {
          await ctx.reply(
            "No shared calendar configured.\n\n" +
              "Use /calendar list to see available calendars."
          );
        }
        break;
      }

      default:
        await ctx.reply(
          "Calendar commands:\n\n" +
            "/calendar list - List writable calendars\n" +
            "/calendar set <id> - Set shared calendar\n" +
            "/calendar show - Show current shared calendar"
        );
    }
  });
}
