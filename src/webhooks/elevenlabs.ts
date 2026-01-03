/**
 * ElevenLabs webhook handler for call completion events
 */
import crypto from "crypto";
import type { Request, Response } from "express";
import {
  updateVoiceCallCompleted,
  getVoiceCallByConversationId,
} from "../db/queries/voice-calls.js";

// ============ Webhook Payload Types ============

interface TranscriptEntry {
  role: "user" | "agent";
  message: string | null;
  time_in_call_secs: number;
}

interface WebhookAnalysis {
  call_successful: "success" | "failure" | "unknown";
  transcript_summary: string;
  call_summary_title?: string;
}

interface WebhookMetadata {
  call_duration_secs: number;
  termination_reason?: string;
  error?: {
    code: string;
    reason: string;
  };
}

interface PostCallTranscriptionData {
  agent_id: string;
  conversation_id: string;
  status: string;
  transcript: TranscriptEntry[];
  metadata: WebhookMetadata;
  analysis?: WebhookAnalysis;
}

interface PostCallTranscriptionWebhook {
  type: "post_call_transcription";
  event_timestamp: number;
  data: PostCallTranscriptionData;
}

interface CallInitiationFailureWebhook {
  type: "call_initiation_failure";
  event_timestamp: number;
  data: {
    conversation_id: string;
    failure_reason: string;
    metadata?: unknown;
  };
}

type ElevenLabsWebhookPayload =
  | PostCallTranscriptionWebhook
  | CallInitiationFailureWebhook;

// ============ Signature Validation ============

const SIGNATURE_TOLERANCE_SECS = 30 * 60; // 30 minutes

function getWebhookSecret(): string {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "ELEVENLABS_WEBHOOK_SECRET is required for webhook validation"
    );
  }
  return secret;
}

function validateSignature(
  signature: string | undefined,
  rawBody: string
): boolean {
  if (!signature) {
    console.warn("[elevenlabs-webhook] Missing signature header");
    return false;
  }

  // Parse signature header: "t=timestamp,v0=hash"
  const parts = signature.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const hashPart = parts.find((p) => p.startsWith("v0="));

  if (!timestampPart || !hashPart) {
    console.warn("[elevenlabs-webhook] Invalid signature format");
    return false;
  }

  const timestamp = parseInt(timestampPart.slice(2), 10);
  const providedHash = hashPart.slice(3);

  // Check timestamp freshness
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECS) {
    console.warn("[elevenlabs-webhook] Signature timestamp too old");
    return false;
  }

  // Compute expected hash
  const secret = getWebhookSecret();
  const payload = `${timestamp}.${rawBody}`;
  const expectedHash = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedHash),
      Buffer.from(expectedHash)
    );
  } catch {
    // Buffers have different lengths - signature invalid
    return false;
  }
}

// ============ Webhook Handler ============

function mapOutcome(
  analysis: WebhookAnalysis | undefined,
  terminationReason?: string
): "success" | "failure" | "unknown" | "voicemail" | "no_answer" {
  // Check termination reason for specific cases
  if (terminationReason) {
    const reason = terminationReason.toLowerCase();
    if (reason.includes("voicemail")) return "voicemail";
    if (reason.includes("no answer") || reason.includes("no_answer"))
      return "no_answer";
  }

  // Fall back to analysis result
  if (!analysis) return "unknown";
  return analysis.call_successful;
}

// Extended Request type with rawBody from middleware
interface RawBodyRequest extends Request {
  rawBody?: string;
}

export async function handleElevenLabsWebhook(
  req: RawBodyRequest,
  res: Response
): Promise<void> {
  try {
    // Get raw body for signature validation (must be preserved by middleware)
    const rawBody = req.rawBody;
    if (!rawBody) {
      console.error(
        "[elevenlabs-webhook] Missing raw body - check middleware configuration"
      );
      res.status(500).json({ error: "Server configuration error" });
      return;
    }
    const signature = req.headers["elevenlabs-signature"] as string | undefined;

    // Validate signature
    if (!validateSignature(signature, rawBody)) {
      console.error("[elevenlabs-webhook] Signature validation failed");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const payload = req.body as ElevenLabsWebhookPayload;
    console.log(`[elevenlabs-webhook] Received ${payload.type} event`);

    if (payload.type === "post_call_transcription") {
      const { data } = payload;

      // Look up the call
      const existingCall = await getVoiceCallByConversationId(
        data.conversation_id
      );
      if (!existingCall) {
        console.warn(
          `[elevenlabs-webhook] Unknown conversation: ${data.conversation_id}`
        );
        // Still return 200 to prevent retries
        res.status(200).json({ received: true, matched: false });
        return;
      }

      // Update call record
      await updateVoiceCallCompleted(data.conversation_id, {
        status: data.status === "done" ? "done" : "failed",
        transcript: data.transcript,
        summary: data.analysis?.transcript_summary,
        outcome: mapOutcome(data.analysis, data.metadata?.termination_reason),
        callDurationSecs: data.metadata?.call_duration_secs,
        terminationReason: data.metadata?.termination_reason,
        errorCode: data.metadata?.error?.code,
        errorReason: data.metadata?.error?.reason,
      });

      console.log(
        `[elevenlabs-webhook] Updated call ${existingCall.id} to ${data.status}`
      );
    } else if (payload.type === "call_initiation_failure") {
      const { data } = payload;

      const existingCall = await getVoiceCallByConversationId(
        data.conversation_id
      );
      if (existingCall) {
        await updateVoiceCallCompleted(data.conversation_id, {
          status: "failed",
          errorReason: data.failure_reason,
        });
        console.log(
          `[elevenlabs-webhook] Marked call ${existingCall.id} as failed`
        );
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[elevenlabs-webhook] Error processing webhook:", error);
    // Return 500 so ElevenLabs will retry
    res.status(500).json({ error: "Internal server error" });
  }
}
