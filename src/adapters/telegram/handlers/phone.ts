import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { getUserByTelegramId } from "../../../db/queries/telegram.js";
import { updateUserPhoneNumber } from "../../../db/queries/users.js";

/**
 * Register phone number handlers: /phone command and contact sharing
 */
export function registerPhoneHandlers(bot: Telegraf): void {
  // /phone command - request phone number for voice call callbacks
  bot.command("phone", async (ctx) => {
    // Phone number requests only work in private chats (Telegram API limitation)
    const chatType = ctx.chat.type;
    if (chatType === "group" || chatType === "supergroup") {
      await ctx.reply(
        "Please DM me to set your phone number (Telegram only allows this in private chats)."
      );
      return;
    }

    const telegramId = ctx.from.id;
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply("Please link your account first: /link <email>");
      return;
    }

    if (user.phone_number) {
      await ctx.reply(
        `Your phone number is set to: ${user.phone_number}\n\n` +
          "To update it, tap the button below.",
        {
          reply_markup: {
            keyboard: [[{ text: "Share Phone Number", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
    } else {
      await ctx.reply(
        "Share your phone number so Alfred can provide it as a callback " +
          "when making calls on your behalf (e.g., for restaurant reservations).\n\n" +
          "Tap the button below to share:",
        {
          reply_markup: {
            keyboard: [[{ text: "Share Phone Number", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
    }
  });

  // Handle contact sharing (phone number)
  bot.on(message("contact"), async (ctx) => {
    const telegramId = ctx.from.id;
    const contact = ctx.message.contact;

    // Verify the contact is the user's own (not forwarded)
    if (contact.user_id !== telegramId) {
      await ctx.reply(
        "Please share your own phone number, not someone else's.",
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await ctx.reply("Please link your account first: /link <email>", {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    // Format to E.164 (Telegram provides it with + prefix)
    const phoneNumber = contact.phone_number.startsWith("+")
      ? contact.phone_number
      : `+${contact.phone_number}`;

    await updateUserPhoneNumber(user.id, phoneNumber);

    await ctx.reply(
      `Phone number saved: ${phoneNumber}\n\n` +
        "Alfred will use this as a callback number when making voice calls on your behalf.",
      { reply_markup: { remove_keyboard: true } }
    );
  });
}
