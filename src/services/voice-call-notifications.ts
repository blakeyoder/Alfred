/**
 * Voice call completion notification service
 *
 * Polls for completed calls and sends summaries to Telegram.
 * Also includes fallback polling for stalled calls (webhook failure recovery).
 */
import type { Telegram } from "telegraf";
import {
  getCompletedCallsToNotify,
  getStalledCalls,
  markCallNotified,
  updateVoiceCallCompleted,
  type VoiceCall,
} from "../db/queries/voice-calls.js";
import { getCoupleById } from "../db/queries/couples.js";
import { getUserById } from "../db/queries/users.js";
import { getConversationDetails } from "../integrations/elevenlabs.js";

// Check every 30 seconds for completed calls
const POLL_INTERVAL_MS = 30 * 1000;

// Check for stalled calls every 5 minutes
const STALLED_CHECK_INTERVAL_MS = 5 * 60 * 1000;

let notificationIntervalId: ReturnType<typeof setInterval> | null = null;
let stalledCheckIntervalId: ReturnType<typeof setInterval> | null = null;

// ============ Formatting ============

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatOutcome(outcome: VoiceCall["outcome"]): string {
  switch (outcome) {
    case "success":
      return "Successful";
    case "failure":
      return "Failed";
    case "voicemail":
      return "Left voicemail";
    case "no_answer":
      return "No answer";
    default:
      return "Unknown";
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatCallNotification(
  call: VoiceCall,
  initiatorName: string | null
): string {
  const parts: string[] = [];

  // Header with emoji based on outcome
  const emoji =
    call.outcome === "success"
      ? "\u2705"
      : call.outcome === "voicemail"
        ? "\ud83d\udce9"
        : call.outcome === "no_answer"
          ? "\ud83d\udce1"
          : "\u274c";

  parts.push(
    `<b>${emoji} Call Complete: ${escapeHtml(call.to_name ?? call.to_number)}</b>`
  );
  parts.push("");

  // Outcome and duration
  parts.push(`<b>Result:</b> ${formatOutcome(call.outcome)}`);
  if (call.call_duration_secs) {
    parts.push(`<b>Duration:</b> ${formatDuration(call.call_duration_secs)}`);
  }

  // Summary
  if (call.summary) {
    parts.push("");
    parts.push(`<b>Summary:</b>`);
    parts.push(escapeHtml(call.summary));
  }

  // Error info if failed
  if (call.status === "failed" && call.error_reason) {
    parts.push("");
    parts.push(`<b>Error:</b> ${escapeHtml(call.error_reason)}`);
  }

  // Footer
  if (initiatorName) {
    parts.push("");
    parts.push(`<i>Requested by ${escapeHtml(initiatorName)}</i>`);
  }

  return parts.join("\n");
}

// ============ Notification Logic ============

async function checkAndNotify(telegram: Telegram): Promise<void> {
  try {
    const calls = await getCompletedCallsToNotify();

    for (const call of calls) {
      // Get couple's Telegram group
      const couple = await getCoupleById(call.couple_id);
      if (!couple?.telegram_group_id) {
        // No group configured - skip but don't mark notified
        continue;
      }

      // Get initiator name
      const initiator = await getUserById(call.initiated_by);
      const initiatorName = initiator?.name ?? null;

      // Format and send message
      const message = formatCallNotification(call, initiatorName);

      try {
        await telegram.sendMessage(couple.telegram_group_id, message, {
          parse_mode: "HTML",
        });

        await markCallNotified(call.id);
        console.log(
          `[voice-notifications] Sent notification for call ${call.id}`
        );
      } catch (sendError) {
        console.error(
          `[voice-notifications] Failed to send notification for call ${call.id}:`,
          sendError
        );
        // Don't mark as notified - will retry next poll
      }
    }
  } catch (error) {
    console.error("[voice-notifications] Error in notification check:", error);
  }
}

// ============ Fallback Polling ============

async function checkStalledCalls(): Promise<void> {
  try {
    const stalledCalls = await getStalledCalls(30); // 30 minutes old

    for (const call of stalledCalls) {
      if (!call.conversation_id) continue;

      try {
        // Poll ElevenLabs API for status
        const details = await getConversationDetails(call.conversation_id);

        if (details.status === "done" || details.status === "failed") {
          // Webhook must have failed - update from API response
          await updateVoiceCallCompleted(call.conversation_id, {
            status: details.status,
            transcript: details.transcript,
            summary: details.analysis?.transcript_summary,
            outcome: details.analysis?.call_successful ?? "unknown",
            callDurationSecs: details.metadata?.call_duration_secs,
            terminationReason: details.metadata?.termination_reason,
            errorCode: details.metadata?.error?.code,
            errorReason: details.metadata?.error?.reason,
          });

          console.log(
            `[voice-notifications] Recovered stalled call ${call.id} via polling`
          );
        }
      } catch (pollError) {
        console.error(
          `[voice-notifications] Failed to poll call ${call.id}:`,
          pollError
        );
      }
    }
  } catch (error) {
    console.error("[voice-notifications] Error checking stalled calls:", error);
  }
}

// ============ Service Lifecycle ============

export function startVoiceCallNotifications(telegram: Telegram): void {
  if (notificationIntervalId) {
    console.warn("[voice-notifications] Already running");
    return;
  }

  console.log("[voice-notifications] Starting service (every 30 seconds)...");

  // Run immediately
  checkAndNotify(telegram);
  checkStalledCalls();

  // Then on intervals
  notificationIntervalId = setInterval(() => {
    checkAndNotify(telegram);
  }, POLL_INTERVAL_MS);

  stalledCheckIntervalId = setInterval(() => {
    checkStalledCalls();
  }, STALLED_CHECK_INTERVAL_MS);
}

export function stopVoiceCallNotifications(): void {
  if (notificationIntervalId) {
    clearInterval(notificationIntervalId);
    notificationIntervalId = null;
  }
  if (stalledCheckIntervalId) {
    clearInterval(stalledCheckIntervalId);
    stalledCheckIntervalId = null;
  }
  console.log("[voice-notifications] Stopped service");
}
