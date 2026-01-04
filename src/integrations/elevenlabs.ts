/**
 * ElevenLabs Conversational AI API client
 * https://elevenlabs.io/docs/api-reference
 */
import {
  getElevenLabsAgentId as getAgentIdFromConfig,
  type VoiceAgentType,
} from "../lib/config.js";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

// Re-export the type for consumers
/**
 * Get the ElevenLabs agent ID for a specific voice agent type.
 * Falls back to general agent if the specific type is not configured.
 */
export function getVoiceAgentId(agentType: VoiceAgentType): string {
  return getAgentIdFromConfig(agentType);
}

// ============ Types ============

export interface OutboundCallRequest {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string; // E.164 format
  conversation_initiation_client_data?: {
    user_id?: string;
    dynamic_variables?: Record<string, string | number | boolean>;
  };
}

export interface OutboundCallResponse {
  success: boolean;
  message: string;
  conversation_id: string | null;
  callSid: string | null;
}

type ConversationStatus =
  | "initiated"
  | "in-progress"
  | "processing"
  | "done"
  | "failed";

interface TranscriptEntry {
  role: "user" | "agent";
  message: string | null;
  time_in_call_secs: number;
}

interface ConversationMetadata {
  start_time_unix_secs: number;
  call_duration_secs: number;
  termination_reason?: string;
  error?: {
    code: string;
    reason: string;
  };
  phone_call?: {
    call_sid?: string;
  };
}

interface ConversationAnalysis {
  call_successful: "success" | "failure" | "unknown";
  transcript_summary: string;
  call_summary_title?: string;
  data_collection_results?: Record<string, unknown>;
}

export interface ConversationDetails {
  agent_id: string;
  conversation_id: string;
  status: ConversationStatus;
  transcript: TranscriptEntry[];
  metadata: ConversationMetadata;
  analysis?: ConversationAnalysis;
  has_audio: boolean;
}

// ============ Client Implementation ============

function getApiKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  }
  return apiKey;
}

async function makeElevenLabsRequest<TResponse>(
  method: "GET" | "POST",
  endpoint: string,
  body?: unknown
): Promise<TResponse> {
  const apiKey = getApiKey();

  const options: RequestInit = {
    method,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  console.log(`[elevenlabs] ${method} ${endpoint}`);
  if (body) {
    console.log(
      `[elevenlabs] Request body:`,
      JSON.stringify(body).slice(0, 500)
    );
  }

  const startTime = Date.now();
  const response = await fetch(`${ELEVENLABS_API_BASE}${endpoint}`, options);
  const elapsed = Date.now() - startTime;

  console.log(`[elevenlabs] Response: ${response.status} (${elapsed}ms)`);

  if (!response.ok) {
    const error = await response.text();
    console.error(`[elevenlabs] Error response:`, error);
    throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
  }

  const json = await response.json();
  console.log(
    `[elevenlabs] Response body:`,
    JSON.stringify(json).slice(0, 500)
  );
  return json as TResponse;
}

/**
 * Initiate an outbound phone call via Twilio
 */
export async function initiateOutboundCall(
  request: OutboundCallRequest
): Promise<OutboundCallResponse> {
  return makeElevenLabsRequest<OutboundCallResponse>(
    "POST",
    "/v1/convai/twilio/outbound-call",
    request
  );
}

/**
 * Get conversation details including transcript and analysis
 */
export async function getConversationDetails(
  conversationId: string
): Promise<ConversationDetails> {
  return makeElevenLabsRequest<ConversationDetails>(
    "GET",
    `/v1/convai/conversations/${conversationId}`
  );
}
