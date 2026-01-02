import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { ModelMessage } from "ai";
import { chat, SessionContext } from "../../agent/index.js";
import {
  getUserByTelegramId,
  linkTelegramAccount,
  unlinkTelegramAccount,
} from "../../db/queries/telegram.js";
import { getCoupleForUser, getPartner } from "../../db/queries/couples.js";
import { getThreadsForUser } from "../../db/queries/threads.js";
import {
  getRecentMessagesForContext,
  saveMessage,
  Message,
} from "../../db/queries/messages.js";
import { getUserById } from "../../db/queries/users.js";

// Convert DB messages to ModelMessage format
function dbMessageToModelMessage(msg: Message): ModelMessage {
  return {
    role: msg.role as "user" | "assistant",
    content: msg.content ?? "",
  };
}

// Build session context for a user
async function buildSessionContext(
  userId: string
): Promise<{
  context: SessionContext;
  partnerId: string | null;
  threadId: string;
} | null> {
  const couple = await getCoupleForUser(userId);
  if (!couple) return null;

  const partner = await getPartner(couple.id, userId);
  const threads = await getThreadsForUser(userId);
  const sharedThread = threads.find((t) => t.visibility === "shared");

  if (!sharedThread) return null;

  const fullUser = await getUserById(userId);
  if (!fullUser) return null;

  return {
    context: {
      userId,
      userName: fullUser.name,
      coupleId: couple.id,
      coupleName: couple.name,
      partnerName: partner?.name ?? null,
      threadId: sharedThread.id,
      visibility: "shared",
    },
    partnerId: partner?.id ?? null,
    threadId: sharedThread.id,
  };
}

// Split long messages for Telegram's 4096 char limit
function splitMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (newline or space)
    let breakPoint = remaining.lastIndexOf("\n", maxLength);
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(" ", maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

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

    await ctx.reply(
      `Account: ${session.context.userName} (${user.email})\n` +
        `Couple: ${session.context.coupleName ?? "Unnamed"}\n` +
        `Partner: ${session.context.partnerName ?? "None"}\n` +
        `Thread: ${session.context.visibility}`
    );
  });

  // /help command
  bot.help(async (ctx) => {
    await ctx.reply(
      "Alfred - Your shared assistant\n\n" +
        "Commands:\n" +
        "/start - Welcome message\n" +
        "/link <email> - Connect your account\n" +
        "/unlink - Disconnect account\n" +
        "/status - Show current connection\n" +
        "/help - Show this message\n\n" +
        "Just send a message to chat with your EA!"
    );
  });

  // Handle text messages
  bot.on(message("text"), async (ctx) => {
    const telegramId = ctx.from.id;
    const messageText = ctx.message.text;

    // Skip if it's a command (already handled above)
    if (messageText.startsWith("/")) return;

    // Check if linked
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await ctx.reply(
        "Please link your account first:\n/link <your-email>\n\nExample: /link blake@example.com"
      );
      return;
    }

    // Build session context
    const session = await buildSessionContext(user.id);
    if (!session) {
      await ctx.reply(
        "Unable to find your couple. Make sure you're set up in the system."
      );
      return;
    }

    let typingInterval: ReturnType<typeof setInterval> | undefined;

    try {
      // Show typing indicator (refresh every 4s since it expires after 5s)
      typingInterval = setInterval(() => {
        ctx.sendChatAction("typing").catch(() => {});
      }, 4000);
      await ctx.sendChatAction("typing");

      // Load conversation history
      const dbMessages = await getRecentMessagesForContext(
        session.threadId,
        50
      );
      const history: ModelMessage[] = dbMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map(dbMessageToModelMessage);

      // Call the agent
      const result = await chat(messageText, {
        context: session.context,
        history,
        partnerId: session.partnerId,
      });

      // Stop typing indicator
      clearInterval(typingInterval);

      // Save messages to DB
      await saveMessage(session.threadId, "user", messageText, user.id);
      await saveMessage(session.threadId, "assistant", result.text);

      // Send response (split if too long)
      const chunks = splitMessage(result.text);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } catch (error) {
      if (typingInterval) clearInterval(typingInterval);
      console.error("Error processing message:", error);

      if (error instanceof Error) {
        await ctx.reply(`Sorry, something went wrong: ${error.message}`);
      } else {
        await ctx.reply("Sorry, something went wrong. Please try again.");
      }
    }
  });

  // Handle non-text messages
  bot.on("message", async (ctx) => {
    await ctx.reply(
      "I can only process text messages right now. Send me a text message!"
    );
  });

  return bot;
}
