import { ModelMessage } from "ai";
import { SessionContext } from "../../../agent/index.js";
import { getUserById } from "../../../db/queries/users.js";
import { getCoupleForUser, getPartner } from "../../../db/queries/couples.js";
import { getThreadsForUser } from "../../../db/queries/threads.js";
import { Message } from "../../../db/queries/messages.js";

export interface SessionData {
  context: SessionContext;
  partnerId: string | null;
  threadId: string;
}

/**
 * Convert DB messages to ModelMessage format for the AI SDK
 */
export function dbMessageToModelMessage(msg: Message): ModelMessage {
  return {
    role: msg.role as "user" | "assistant",
    content: msg.content ?? "",
  };
}

/**
 * Build session context for a user
 */
export async function buildSessionContext(
  userId: string
): Promise<SessionData | null> {
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

/**
 * Split long messages for Telegram's 4096 char limit
 */
export function splitMessage(text: string, maxLength = 4000): string[] {
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

/**
 * Convert markdown to Telegram HTML format.
 * Handles headers, links, bold, italic, and code formatting.
 */
export function markdownToTelegramHtml(text: string): string {
  // Escape HTML special characters first (except in URLs which we'll handle)
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Convert markdown headers (###, ##, #) to bold text
  // Telegram doesn't support <h1>/<h2>/<h3> tags
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Convert markdown links [text](url) to HTML <a href="url">text</a>
  // The URL was escaped above, so unescape &amp; back to & in URLs
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, linkText, url) =>
      `<a href="${url.replace(/&amp;/g, "&")}">${linkText}</a>`
  );

  // Convert **bold** to <b>bold</b>
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Convert *italic* to <i>italic</i> (but not inside bold tags)
  // Only match single asterisks not preceded/followed by another asterisk
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Convert `code` to <code>code</code>
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  return html;
}
