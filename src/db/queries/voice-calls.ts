/**
 * Voice call database queries
 */
import { sql } from "../client.js";

export type VoiceAgentType = "restaurant" | "medical" | "general";
export type CallPurpose =
  | "reservation"
  | "confirmation"
  | "inquiry"
  | "appointment"
  | "other";

export interface VoiceCall {
  id: string;
  couple_id: string;
  initiated_by: string;
  conversation_id: string | null;
  call_sid: string | null;
  agent_type: VoiceAgentType;
  call_purpose: CallPurpose;
  to_number: string;
  to_name: string | null;
  instructions: string;
  dynamic_variables: Record<string, unknown> | null;
  status:
    | "pending"
    | "initiated"
    | "in-progress"
    | "processing"
    | "done"
    | "failed";
  transcript: unknown[] | null;
  summary: string | null;
  outcome: "success" | "failure" | "unknown" | "voicemail" | "no_answer" | null;
  call_duration_secs: number | null;
  termination_reason: string | null;
  error_code: string | null;
  error_reason: string | null;
  notified_at: Date | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export async function createVoiceCall(
  coupleId: string,
  initiatedBy: string,
  agentType: VoiceAgentType,
  callPurpose: CallPurpose,
  toNumber: string,
  instructions: string,
  options?: {
    toName?: string;
    dynamicVariables?: Record<string, unknown>;
  }
): Promise<VoiceCall> {
  const rows = await sql<VoiceCall[]>`
    INSERT INTO voice_calls (couple_id, initiated_by, agent_type, call_purpose, to_number, to_name, instructions, dynamic_variables)
    VALUES (
      ${coupleId},
      ${initiatedBy},
      ${agentType},
      ${callPurpose},
      ${toNumber},
      ${options?.toName ?? null},
      ${instructions},
      ${options?.dynamicVariables ? JSON.stringify(options.dynamicVariables) : null}
    )
    RETURNING *
  `;
  return rows[0];
}

export async function updateVoiceCallInitiated(
  id: string,
  conversationId: string,
  callSid: string | null
): Promise<void> {
  await sql`
    UPDATE voice_calls
    SET
      conversation_id = ${conversationId},
      call_sid = ${callSid},
      status = 'initiated',
      started_at = NOW()
    WHERE id = ${id}
  `;
}

export async function updateVoiceCallCompleted(
  conversationId: string,
  data: {
    status: VoiceCall["status"];
    transcript?: unknown[];
    summary?: string;
    outcome?: VoiceCall["outcome"];
    callDurationSecs?: number;
    terminationReason?: string;
    errorCode?: string;
    errorReason?: string;
  }
): Promise<VoiceCall | null> {
  const rows = await sql<VoiceCall[]>`
    UPDATE voice_calls
    SET
      status = ${data.status},
      transcript = ${data.transcript ? JSON.stringify(data.transcript) : null},
      summary = ${data.summary ?? null},
      outcome = ${data.outcome ?? null},
      call_duration_secs = ${data.callDurationSecs ?? null},
      termination_reason = ${data.terminationReason ?? null},
      error_code = ${data.errorCode ?? null},
      error_reason = ${data.errorReason ?? null},
      completed_at = NOW()
    WHERE conversation_id = ${conversationId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function getVoiceCallByConversationId(
  conversationId: string
): Promise<VoiceCall | null> {
  const rows = await sql<VoiceCall[]>`
    SELECT * FROM voice_calls WHERE conversation_id = ${conversationId}
  `;
  return rows[0] ?? null;
}

export async function getCompletedCallsToNotify(): Promise<VoiceCall[]> {
  return sql<VoiceCall[]>`
    SELECT * FROM voice_calls
    WHERE notified_at IS NULL
      AND status IN ('done', 'failed')
      AND completed_at IS NOT NULL
    ORDER BY completed_at ASC
  `;
}

export async function markCallNotified(id: string): Promise<void> {
  await sql`
    UPDATE voice_calls SET notified_at = NOW() WHERE id = ${id}
  `;
}

/**
 * Mark a call as failed (for API errors before call starts)
 */
export async function updateVoiceCallFailed(
  id: string,
  errorReason: string
): Promise<void> {
  await sql`
    UPDATE voice_calls
    SET
      status = 'failed',
      error_reason = ${errorReason},
      completed_at = NOW()
    WHERE id = ${id}
  `;
}

/**
 * For polling fallback: find calls that started but never completed
 */
export async function getStalledCalls(
  maxAgeMinutes = 30
): Promise<VoiceCall[]> {
  return sql<VoiceCall[]>`
    SELECT * FROM voice_calls
    WHERE status IN ('initiated', 'in-progress', 'processing')
      AND started_at < NOW() - INTERVAL '1 minute' * ${maxAgeMinutes}
  `;
}
