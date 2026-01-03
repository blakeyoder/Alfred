/**
 * ElevenLabs Conversational AI API client
 * https://elevenlabs.io/docs/api-reference
 */

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

// ============ Voice Agent Types ============

/**
 * Specialized voice agent types for different call scenarios.
 * Each type maps to a dedicated ElevenLabs agent with optimized prompts.
 */
export type VoiceAgentType = "restaurant" | "medical" | "general";

/**
 * Get the ElevenLabs agent ID for a specific voice agent type.
 * Falls back to general agent if the specific type is not configured.
 */
export function getVoiceAgentId(agentType: VoiceAgentType): string {
  const envVarName = `ELEVENLABS_AGENT_${agentType.toUpperCase()}`;
  const specificAgent = process.env[envVarName];

  if (specificAgent) {
    console.log(
      `[elevenlabs] Using ${envVarName}=${specificAgent}`
    );
    return specificAgent;
  }

  const generalAgent = process.env.ELEVENLABS_AGENT_GENERAL;
  if (generalAgent) {
    console.log(
      `[elevenlabs] ${envVarName} not set, falling back to ELEVENLABS_AGENT_GENERAL=${generalAgent}`
    );
    return generalAgent;
  }

  // Legacy fallback to old single agent ID
  const legacyAgent = process.env.ELEVENLABS_AGENT_ID;
  if (legacyAgent) {
    console.log(
      `[elevenlabs] No typed agents configured, falling back to ELEVENLABS_AGENT_ID=${legacyAgent}`
    );
    return legacyAgent;
  }

  throw new Error(
    `No ElevenLabs agent configured. Set ${envVarName} or ELEVENLABS_AGENT_GENERAL.`
  );
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

export type ConversationStatus =
  | "initiated"
  | "in-progress"
  | "processing"
  | "done"
  | "failed";

export interface TranscriptEntry {
  role: "user" | "agent";
  message: string | null;
  time_in_call_secs: number;
}

export interface ConversationMetadata {
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

export interface ConversationAnalysis {
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

/**
 * ElevenLabs API error with parsed details
 */
export class ElevenLabsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "ElevenLabsApiError";
  }
}

/**
 * Parse ElevenLabs error response and return a user-friendly message
 */
function parseErrorResponse(status: number, responseText: string): string {
  try {
    const parsed = JSON.parse(responseText);
    const detail = parsed?.detail;

    // Handle document_not_found (404) - agent or conversation doesn't exist
    if (
      status === 404 &&
      detail?.status === "document_not_found" &&
      typeof detail?.message === "string"
    ) {
      const idMatch = detail.message.match(/agent_[a-z0-9]+/);
      if (idMatch) {
        return `Voice agent not found. The configured agent (${idMatch[0]}) may have been deleted. Please run 'bun run src/scripts/setup-elevenlabs-agents.ts' to create new agents and update your .env file.`;
      }
      return `ElevenLabs resource not found: ${detail.message}`;
    }

    // Handle other structured errors
    if (detail?.message) {
      return `ElevenLabs error: ${detail.message}`;
    }
  } catch {
    // JSON parsing failed, use raw response
  }

  return `ElevenLabs API error (${status}): ${responseText}`;
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

  const response = await fetch(`${ELEVENLABS_API_BASE}${endpoint}`, options);

  if (!response.ok) {
    const responseText = await response.text();
    const message = parseErrorResponse(response.status, responseText);

    // Extract error code from response if available
    let errorCode: string | undefined;
    try {
      const parsed = JSON.parse(responseText);
      errorCode = parsed?.detail?.status;
    } catch {
      // Ignore parsing errors
    }

    throw new ElevenLabsApiError(response.status, errorCode, message);
  }

  return response.json() as Promise<TResponse>;
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
