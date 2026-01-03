/**
 * Proactive reminder notifications service
 *
 * Polls for reminders due in the next hour and sends notifications
 * to the couple's Telegram group chat.
 */
import type { Telegram } from "telegraf";
import { getRemindersToNotify, markReminderNotified } from "../db/queries/reminders.js";
import { getCoupleById } from "../db/queries/couples.js";
import { getUserById } from "../db/queries/users.js";

// Check every 5 minutes
const POLL_INTERVAL_MS = 5 * 60 * 1000;

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Format a reminder notification message
 */
function formatNotificationMessage(
  title: string,
  dueAt: Date,
  assigneeName: string | null
): string {
  const timeStr = dueAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  let message = `⏰ *Reminder*: ${title}\n`;
  message += `Due at ${timeStr}`;

  if (assigneeName) {
    message += ` (${assigneeName})`;
  }

  return message;
}

/**
 * Check for due reminders and send notifications
 */
async function checkAndNotify(telegram: Telegram): Promise<void> {
  try {
    const reminders = await getRemindersToNotify();

    for (const reminder of reminders) {
      // Get the couple to find the telegram group
      const couple = await getCoupleById(reminder.couple_id);
      if (!couple?.telegram_group_id) {
        // No group configured, skip (don't mark as notified so we can try later)
        continue;
      }

      // Get assignee name if assigned
      let assigneeName: string | null = null;
      if (reminder.assigned_to) {
        const assignee = await getUserById(reminder.assigned_to);
        assigneeName = assignee?.name ?? null;
      }

      // Format and send the message
      const message = formatNotificationMessage(reminder.title, reminder.due_at!, assigneeName);

      try {
        await telegram.sendMessage(couple.telegram_group_id, message, {
          parse_mode: "Markdown",
        });

        // Mark as notified only after successful send
        await markReminderNotified(reminder.id);
        console.log(`Sent notification for reminder: ${reminder.title}`);
      } catch (sendError) {
        console.error(`Failed to send notification for reminder ${reminder.id}:`, sendError);
        // Don't mark as notified, will retry on next poll
      }
    }
  } catch (error) {
    console.error("Error in reminder notification check:", error);
  }
}

/**
 * Start the reminder notification service
 */
export function startReminderNotifications(telegram: Telegram): void {
  if (intervalId) {
    console.warn("Reminder notifications already running");
    return;
  }

  console.log("Starting reminder notification service (every 5 minutes)...");

  // Run immediately on start
  checkAndNotify(telegram);

  // Then run every 5 minutes
  intervalId = setInterval(() => {
    checkAndNotify(telegram);
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the reminder notification service
 */
export function stopReminderNotifications(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("Stopped reminder notification service");
  }
}
