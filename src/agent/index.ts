import {
  generateText,
  ModelMessage,
  stepCountIs,
  NoSuchToolError,
  InvalidToolInputError,
  APICallError,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { buildSystemPrompt, type SessionContext } from "./system-prompt.js";
import { createTools } from "./tools/index.js";

export interface ChatOptions {
  context: SessionContext;
  history: ModelMessage[];
  partnerId?: string | null;
}

export interface ChatResult {
  text: string;
  toolCalls?: Array<{
    toolName: string;
    args: unknown;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export async function chat(
  message: string,
  options: ChatOptions
): Promise<ChatResult> {
  const { context, history, partnerId = null } = options;

  const tools = createTools({ session: context }, partnerId);

  try {
    const result = await generateText({
      model: openai("gpt-4o"),
      system: buildSystemPrompt(context),
      messages: [...history, { role: "user", content: message }],
      tools,
      stopWhen: stepCountIs(5),
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(60000), // 60 second timeout
      providerOptions: {
        openai: {
          user: context.userId,
          parallelToolCalls: true,
        },
      },
      onStepFinish: async ({ toolCalls, toolResults, finishReason }) => {
        if (toolResults && toolResults.length > 0) {
          for (const toolResult of toolResults) {
            console.log(`[Agent] Tool: ${toolResult.toolName}`, toolResult.output);
          }
        }
      },
    });

    // Check for tool errors in steps
    for (const step of result.steps) {
      if (step.content) {
        const toolErrors = step.content.filter(
          (part): part is Extract<typeof part, { type: "tool-error" }> =>
            part.type === "tool-error"
        );
        for (const toolError of toolErrors) {
          console.warn(
            `[Agent] Tool error in ${toolError.toolName}:`,
            toolError.error
          );
        }
      }
    }

    // Collect all tool calls from all steps
    const allToolCalls: Array<{ toolName: string; args: unknown }> = [];
    for (const step of result.steps) {
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (const tc of step.toolCalls) {
          // Access args via type assertion since TypedToolCall has args but DynamicToolCall doesn't
          const args = "args" in tc ? tc.args : undefined;
          allToolCalls.push({ toolName: tc.toolName, args });
        }
      }
    }

    return {
      text: result.text,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
          }
        : undefined,
    };
  } catch (error) {
    if (NoSuchToolError.isInstance(error)) {
      throw new Error(`AI tried to use an unknown tool: ${error.toolName}`);
    }
    if (InvalidToolInputError.isInstance(error)) {
      throw new Error(
        `AI provided invalid inputs for tool ${error.toolName}: ${error.message}`
      );
    }
    if (APICallError.isInstance(error)) {
      if (error.statusCode === 429) {
        throw new Error(
          "Rate limited by OpenAI. Please try again in a moment."
        );
      }
      throw new Error(`OpenAI API error (${error.statusCode}): ${error.message}`);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  }
}

export type { SessionContext } from "./system-prompt.js";
