import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { ModelMessage } from "ai";
import { trace, context as otelContext } from "@opentelemetry/api";
import { chat } from "../../../agent/index.js";
import { getUserByTelegramId } from "../../../db/queries/telegram.js";
import {
  getCoupleForUser,
  getCoupleByGroupId,
} from "../../../db/queries/couples.js";
import {
  getRecentMessagesForContext,
  saveMessage,
} from "../../../db/queries/messages.js";
import {
  buildSessionContext,
  dbMessageToModelMessage,
  splitMessage,
  markdownToTelegramHtml,
} from "./utils.js";

/**
 * Register message handlers: text messages and non-text messages
 */
export function registerMessageHandlers(bot: Telegraf): void {
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
          "This group isn't set up yet.\n\n" +
            "Run /setup to link this group to your couple."
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
      await ctx.reply(
        "Unable to find your couple. Make sure you're set up in the system."
      );
      return;
    }

    let typingInterval: ReturnType<typeof setInterval> | undefined;

    // Create a parent span for request-level tracing
    const tracer = trace.getTracer("telegram-handler");
    const span = tracer.startSpan("telegram.message", {
      attributes: {
        "telegram.chat_id": ctx.chat.id,
        "telegram.message_id": ctx.message.message_id,
        "telegram.user_id": telegramId,
        "telegram.chat_type": chatType,
        "alfred.user_id": user.id,
        "alfred.thread_id": session.threadId,
      },
    });

    try {
      await otelContext.with(
        trace.setSpan(otelContext.active(), span),
        async () => {
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
          console.log(`[bot] Calling chat() for user ${user.id}...`);
          const chatStartTime = Date.now();
          const result = await chat(messageText, {
            context: session.context,
            history,
            partnerId: session.partnerId,
          });
          console.log(
            `[bot] chat() completed in ${Date.now() - chatStartTime}ms`
          );

          // Add response attributes to span
          span.setAttribute("alfred.response_length", result.text.length);
          span.setAttribute(
            "alfred.tool_calls_count",
            result.toolCalls?.length ?? 0
          );

          // Stop typing indicator
          clearInterval(typingInterval);

          // Save messages to DB
          await saveMessage(session.threadId, "user", messageText, user.id);
          await saveMessage(
            session.threadId,
            "assistant",
            result.text,
            undefined,
            result.toolCalls
          );

          // Send response (split if too long)
          // Guard against empty responses (can happen if agent only made tool calls)
          if (!result.text.trim()) {
            await ctx.reply(
              "I found some information but wasn't able to generate a response. Please try again."
            );
            return;
          }

          // Convert markdown to Telegram HTML for reliable formatting
          const telegramHtml = markdownToTelegramHtml(result.text);
          const chunks = splitMessage(telegramHtml);
          for (const chunk of chunks) {
            try {
              await ctx.reply(chunk, { parse_mode: "HTML" });
            } catch {
              // Fall back to plain text if HTML parsing fails
              await ctx.reply(chunk.replace(/<[^>]+>/g, ""));
            }
          }
        }
      );
    } catch (error) {
      if (typingInterval) clearInterval(typingInterval);
      console.error("[bot] Error processing message:", error);

      if (error instanceof Error) {
        await ctx.reply(`Sorry, something went wrong: ${error.message}`);
      } else {
        await ctx.reply("Sorry, something went wrong. Please try again.");
      }
    } finally {
      span.end();
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
}
