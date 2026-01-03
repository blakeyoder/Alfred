/**
 * Voice call tools for ElevenLabs Conversational AI
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./reminders.js";
import {
  initiateOutboundCall,
  type OutboundCallResponse,
} from "../../integrations/elevenlabs.js";
import {
  createVoiceCall,
  updateVoiceCallInitiated,
  updateVoiceCallFailed,
} from "../../db/queries/voice-calls.js";
import { getUserById } from "../../db/queries/users.js";

// E.164 format: + followed by 1-15 digits
// More permissive than just US numbers
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

const initiateVoiceCallSchema = z.object({
  callType: z
    .enum(["reservation", "confirmation", "personal", "other"])
    .describe("The purpose of the call"),
  toNumber: z
    .string()
    .regex(
      E164_REGEX,
      "Phone number must be in E.164 format (e.g., +15551234567)"
    )
    .describe("Phone number to call in E.164 format"),
  toName: z.string().describe("Name of the person/business being called"),
  instructions: z
    .string()
    .min(10, "Instructions must be at least 10 characters")
    .max(2000, "Instructions must be under 2000 characters")
    .describe("Detailed instructions for what the AI should do on the call"),
  dynamicVariables: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Additional variables to pass to the voice agent"),
});

function getAgentConfig() {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;

  if (!agentId) {
    throw new Error("ELEVENLABS_AGENT_ID is required for voice calls");
  }
  if (!phoneNumberId) {
    throw new Error("ELEVENLABS_PHONE_NUMBER_ID is required for voice calls");
  }

  return { agentId, phoneNumberId };
}

export function createVoiceCallTools(
  ctx: ToolContext,
  _partnerId: string | null
) {
  return {
    initiateVoiceCall: tool({
      description:
        "Initiate an AI-powered phone call to make reservations, confirm appointments, or deliver messages. " +
        "The AI will handle the conversation autonomously and report back when complete.",
      inputSchema: initiateVoiceCallSchema,
      execute: async ({
        callType,
        toNumber,
        toName,
        instructions,
        dynamicVariables,
      }) => {
        try {
          const { agentId, phoneNumberId } = getAgentConfig();

          // Get user name for dynamic variables
          const user = await getUserById(ctx.session.userId);
          const userName = user?.name ?? "your assistant";

          // Create database record first (pending status)
          const voiceCall = await createVoiceCall(
            ctx.session.coupleId,
            ctx.session.userId,
            callType,
            toNumber,
            instructions,
            {
              toName,
              dynamicVariables: {
                user_name: userName,
                call_instructions: instructions,
                ...dynamicVariables,
              },
            }
          );

          // Initiate the call via ElevenLabs
          let response: OutboundCallResponse;
          try {
            response = await initiateOutboundCall({
              agent_id: agentId,
              agent_phone_number_id: phoneNumberId,
              to_number: toNumber,
              conversation_initiation_client_data: {
                user_id: ctx.session.userId,
                dynamic_variables: {
                  user_name: userName,
                  call_instructions: instructions,
                  recipient_name: toName,
                  call_type: callType,
                  ...dynamicVariables,
                },
              },
            });
          } catch (apiError) {
            // API call failed - mark record as failed
            const errorMessage =
              apiError instanceof Error ? apiError.message : "Unknown error";
            await updateVoiceCallFailed(voiceCall.id, errorMessage);
            return {
              success: false,
              message: `Failed to initiate call: ${errorMessage}`,
              callId: voiceCall.id,
            };
          }

          if (!response.success || !response.conversation_id) {
            // API returned failure - mark record as failed
            const errorMessage =
              response.message || "No conversation ID returned";
            await updateVoiceCallFailed(voiceCall.id, errorMessage);
            return {
              success: false,
              message: `Failed to initiate call: ${errorMessage}`,
              callId: voiceCall.id,
            };
          }

          // Update record with ElevenLabs IDs
          await updateVoiceCallInitiated(
            voiceCall.id,
            response.conversation_id,
            response.callSid
          );

          return {
            success: true,
            message: `Call initiated to ${toName} at ${toNumber}. I'll notify you when the call completes.`,
            callId: voiceCall.id,
            conversationId: response.conversation_id,
          };
        } catch (error) {
          console.error("[voice-call] Error initiating call:", error);
          return {
            success: false,
            message: `Error initiating call: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
      },
    }),
  };
}
