/**
 * ElevenLabs Conversational AI API client
 * Uses the official @elevenlabs/elevenlabs-js SDK
 */
import { ElevenLabsClient, ElevenLabs } from "@elevenlabs/elevenlabs-js";
import {
  getElevenLabsAgentId as getAgentIdFromConfig,
  type VoiceAgentType,
} from "../lib/config.js";

// ============ SDK Client ============

let client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient {
  if (!client) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY environment variable is required");
    }
    client = new ElevenLabsClient({ apiKey });
  }
  return client;
}

// ============ Public API ============

/**
 * Get the ElevenLabs agent ID for a specific voice agent type.
 * Falls back to general agent if the specific type is not configured.
 */
export function getVoiceAgentId(agentType: VoiceAgentType): string {
  return getAgentIdFromConfig(agentType);
}

// ============ Types (maintained for backward compatibility) ============

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

// ============ Response Mappers ============

function mapOutboundCallResponse(
  response: ElevenLabs.TwilioOutboundCallResponse
): OutboundCallResponse {
  return {
    success: response.success,
    message: response.message,
    conversation_id: response.conversationId ?? null,
    callSid: response.callSid ?? null,
  };
}

function mapConversationDetails(
  response: ElevenLabs.GetConversationResponseModel
): ConversationDetails {
  return {
    agent_id: response.agentId,
    conversation_id: response.conversationId,
    status: response.status as ConversationStatus,
    transcript: response.transcript.map((entry) => ({
      role: entry.role as "user" | "agent",
      message: entry.message ?? null,
      time_in_call_secs: entry.timeInCallSecs,
    })),
    metadata: {
      start_time_unix_secs: response.metadata.startTimeUnixSecs,
      call_duration_secs: response.metadata.callDurationSecs,
      termination_reason: response.metadata.terminationReason,
      error: response.metadata.error
        ? {
            code: String(response.metadata.error.code),
            reason: response.metadata.error.reason ?? "Unknown error",
          }
        : undefined,
      phone_call: response.metadata.phoneCall
        ? {
            call_sid:
              response.metadata.phoneCall.type === "twilio"
                ? response.metadata.phoneCall.callSid
                : undefined,
          }
        : undefined,
    },
    analysis: response.analysis
      ? {
          call_successful: response.analysis.callSuccessful as
            | "success"
            | "failure"
            | "unknown",
          transcript_summary: response.analysis.transcriptSummary,
          call_summary_title: response.analysis.callSummaryTitle,
          data_collection_results: response.analysis.dataCollectionResults as
            | Record<string, unknown>
            | undefined,
        }
      : undefined,
    has_audio: response.hasAudio,
  };
}

// ============ API Functions ============

/**
 * Initiate an outbound phone call via Twilio
 */
export async function initiateOutboundCall(
  request: OutboundCallRequest
): Promise<OutboundCallResponse> {
  const sdk = getClient();

  console.log(`[elevenlabs] POST /v1/convai/twilio/outbound-call`);
  console.log(
    `[elevenlabs] Request:`,
    JSON.stringify({
      agentId: request.agent_id,
      toNumber: request.to_number,
      hasDynamicVars:
        !!request.conversation_initiation_client_data?.dynamic_variables,
    })
  );

  const startTime = Date.now();

  const response = await sdk.conversationalAi.twilio.outboundCall({
    agentId: request.agent_id,
    agentPhoneNumberId: request.agent_phone_number_id,
    toNumber: request.to_number,
    conversationInitiationClientData:
      request.conversation_initiation_client_data
        ? {
            userId: request.conversation_initiation_client_data.user_id,
            dynamicVariables:
              request.conversation_initiation_client_data.dynamic_variables,
          }
        : undefined,
  });

  const elapsed = Date.now() - startTime;
  console.log(
    `[elevenlabs] Response: success=${response.success} (${elapsed}ms)`
  );
  console.log(
    `[elevenlabs] conversationId=${response.conversationId}, callSid=${response.callSid}`
  );

  return mapOutboundCallResponse(response);
}

/**
 * Get conversation details including transcript and analysis
 */
export async function getConversationDetails(
  conversationId: string
): Promise<ConversationDetails> {
  const sdk = getClient();

  console.log(`[elevenlabs] GET /v1/convai/conversations/${conversationId}`);

  const startTime = Date.now();
  const response = await sdk.conversationalAi.conversations.get(conversationId);
  const elapsed = Date.now() - startTime;

  console.log(
    `[elevenlabs] Response: status=${response.status} (${elapsed}ms)`
  );

  return mapConversationDetails(response);
}
