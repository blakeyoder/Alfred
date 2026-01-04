import { Telegraf } from "telegraf";
import { getUserByTelegramId } from "../../../db/queries/telegram.js";
import {
  getCoupleForUser,
  getCoupleByGroupId,
  setTelegramGroupId,
} from "../../../db/queries/couples.js";

/**
 * Register group setup handler: /setup
 */
export function registerGroupHandlers(bot: Telegraf): void {
  bot.command("setup", async (ctx) => {
    const chatType = ctx.chat.type;

    // Only works in group chats
    if (chatType !== "group" && chatType !== "supergroup") {
      await ctx.reply(
        "The /setup command only works in group chats.\n\n" +
          "Add me to a group with your partner, then run /setup there."
      );
      return;
    }

    const telegramId = ctx.from.id;
    const groupId = ctx.chat.id;

    // Check if sender is linked
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await ctx.reply(
        "You need to link your account first.\n\n" +
          "DM me and use /link <email> to connect your account."
      );
      return;
    }

    // Get the user's couple
    const couple = await getCoupleForUser(user.id);
    if (!couple) {
      await ctx.reply(
        "You're not part of a couple yet. Contact support to get set up."
      );
      return;
    }

    // Check if this group is already linked to another couple
    const existingCouple = await getCoupleByGroupId(groupId);
    if (existingCouple && existingCouple.id !== couple.id) {
      await ctx.reply("This group is already linked to a different couple.");
      return;
    }

    // Link the group to the couple
    await setTelegramGroupId(couple.id, groupId);

    await ctx.reply(
      `Group linked to ${couple.name ?? "your couple"}!\n\n` +
        "Both partners can now chat with me here. " +
        "I'll also send reminder notifications to this group."
    );
  });
}
