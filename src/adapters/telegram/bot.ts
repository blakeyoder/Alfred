import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { ModelMessage } from "ai";
import { chat, SessionContext } from "../../agent/index.js";
import {
  getUserByTelegramId,
  linkTelegramAccount,
  unlinkTelegramAccount,
} from "../../db/queries/telegram.js";
import {
  getCoupleForUser,
  getCoupleByGroupId,
  getPartner,
  getSharedCalendarId,
  setSharedCalendarId,
  setTelegramGroupId,
} from "../../db/queries/couples.js";
import { getThreadsForUser } from "../../db/queries/threads.js";
import { getRecentMessagesForContext, saveMessage, Message } from "../../db/queries/messages.js";
import { getUserById } from "../../db/queries/users.js";
import {
  initiateDeviceFlow,
  completeDeviceFlow,
  storeTokens,
  hasGoogleAuth,
} from "../../integrations/google-auth.js";
import { listCalendars } from "../../integrations/google-calendar.js";

// Convert DB messages to ModelMessage format
function dbMessageToModelMessage(msg: Message): ModelMessage {
  return {
    role: msg.role as "user" | "assistant",
    content: msg.content ?? "",
  };
}

// Build session context for a user
async function buildSessionContext(userId: string): Promise<{
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
      await ctx.reply("Usage: /link <your-email>\n\nExample: /link blake@example.com");
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

  // /auth command - Google OAuth
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
      const tokens = await completeDeviceFlow(flow.deviceCode, flow.interval, flow.expiresIn);

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const scopes = tokens.scope.split(" ");

      await storeTokens(user.id, tokens.access_token, tokens.refresh_token, expiresAt, scopes);

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

  // /calendar command
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
          const currentShared = await getSharedCalendarId(session.context.coupleId);

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
        const currentShared = await getSharedCalendarId(session.context.coupleId);
        if (currentShared) {
          await ctx.reply(`Shared calendar:\n${currentShared}`);
        } else {
          await ctx.reply(
            "No shared calendar configured.\n\n" + "Use /calendar list to see available calendars."
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

  // /setup command - link group chat to a couple
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
      await ctx.reply("You're not part of a couple yet. Contact support to get set up.");
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

  // /help command
  bot.help(async (ctx) => {
    await ctx.reply(
      "Alfred - Your shared assistant\n\n" +
        "Account:\n" +
        "/link <email> - Connect your account\n" +
        "/unlink - Disconnect account\n" +
        "/status - Show current connection\n\n" +
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

  // Handle text messages
  bot.on(message("text"), async (ctx) => {
    const telegramId = ctx.from.id;
    const messageText = ctx.message.text;
    const chatType = ctx.chat.type;
    const isGroupChat = chatType === "group" || chatType === "supergroup";

    // Skip if it's a command (already handled above)
    if (messageText.startsWith("/")) return;

    // Check if sender is linked
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      if (isGroupChat) {
        // In group chats, don't spam with link prompts for every unlinked message
        // Only respond if they seem to be talking to the bot
        return;
      }
      await ctx.reply(
        "Please link your account first:\n/link <your-email>\n\nExample: /link blake@example.com"
      );
      return;
    }

    // For group chats, verify the group is set up for this couple
    if (isGroupChat) {
      const groupId = ctx.chat.id;
      const couple = await getCoupleByGroupId(groupId);

      if (!couple) {
        // Group not set up - prompt to set up
        await ctx.reply(
          "This group isn't set up yet.\n\n" + "Run /setup to link this group to your couple."
        );
        return;
      }

      // Verify the sender is part of this couple
      const userCouple = await getCoupleForUser(user.id);
      if (!userCouple || userCouple.id !== couple.id) {
        // User is not part of the couple this group is linked to
        return;
      }
    }

    // Build session context
    const session = await buildSessionContext(user.id);
    if (!session) {
      await ctx.reply("Unable to find your couple. Make sure you're set up in the system.");
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
      const dbMessages = await getRecentMessagesForContext(session.threadId, 50);
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
      // Convert **bold** to *bold* for Telegram Markdown v1
      const telegramText = result.text.replace(/\*\*(.+?)\*\*/g, "*$1*");
      const chunks = splitMessage(telegramText);
      for (const chunk of chunks) {
        try {
          await ctx.reply(chunk, { parse_mode: "Markdown" });
        } catch {
          // Fall back to plain text if Markdown parsing fails
          await ctx.reply(chunk);
        }
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

  // Handle non-text messages (but ignore service messages like member joins/leaves)
  bot.on("message", async (ctx) => {
    // Ignore service messages (member added/removed, etc.)
    if (
      "new_chat_members" in ctx.message ||
      "left_chat_member" in ctx.message ||
      "new_chat_title" in ctx.message ||
      "new_chat_photo" in ctx.message ||
      "delete_chat_photo" in ctx.message ||
      "group_chat_created" in ctx.message
    ) {
      return;
    }

    await ctx.reply(
      "I can only process text messages right now. Send me a text message!"
    );
  });

  return bot;
}
