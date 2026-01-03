/**
 * Voice call tools for ElevenLabs Conversational AI
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./reminders.js";
import {
  initiateOutboundCall,
  getVoiceAgentId,
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
  agentType: z
    .enum(["restaurant", "medical", "general"])
    .describe(
      "The type of voice agent to use. " +
        "Use 'restaurant' for restaurant reservations, table bookings, or dining inquiries. " +
        "Use 'medical' for doctor appointments, medical office calls, or healthcare scheduling. " +
        "Use 'general' for all other calls including personal calls, services, and general inquiries."
    ),
  callPurpose: z
    .enum(["reservation", "confirmation", "inquiry", "appointment", "other"])
    .describe("The specific purpose of the call"),
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

function getPhoneNumberId(): string {
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error("ELEVENLABS_PHONE_NUMBER_ID is required for voice calls");
  }
  return phoneNumberId;
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
        agentType,
        callPurpose,
        toNumber,
        toName,
        instructions,
        dynamicVariables,
      }) => {
        console.log(
          `[voice-call] Tool invoked: ${agentType} call to ${toName} at ${toNumber}`
        );
        console.log(`[voice-call] Purpose: ${callPurpose}`);
        console.log(
          `[voice-call] Instructions: ${instructions.slice(0, 100)}...`
        );

        try {
          const phoneNumberId = getPhoneNumberId();
          const agentId = getVoiceAgentId(agentType);
          console.log(`[voice-call] Using agent ID: ${agentId}`);

          // Get user info for dynamic variables
          const user = await getUserById(ctx.session.userId);
          const userName = user?.name ?? "your assistant";
          const callbackNumber = user?.phone_number ?? null;

          // Create database record first (pending status)
          const voiceCall = await createVoiceCall(
            ctx.session.coupleId,
            ctx.session.userId,
            agentType,
            callPurpose,
            toNumber,
            instructions,
            {
              toName,
              dynamicVariables: {
                user_name: userName,
                call_instructions: instructions,
                ...(callbackNumber && { callback_number: callbackNumber }),
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
                  agent_type: agentType,
                  call_purpose: callPurpose,
                  ...(callbackNumber && { callback_number: callbackNumber }),
                  ...dynamicVariables,
                },
              },
            });
          } catch (apiError) {
            // API call failed - mark record as failed
            const errorMessage =
              apiError instanceof Error ? apiError.message : "Unknown error";
            console.error(`[voice-call] API error: ${errorMessage}`);
            await updateVoiceCallFailed(voiceCall.id, errorMessage);
            return {
              success: false,
              message: `Failed to initiate call: ${errorMessage}`,
              callId: voiceCall.id,
            };
          }

          console.log(`[voice-call] API response:`, JSON.stringify(response));

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
