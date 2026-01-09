#!/usr/bin/env bun
/**
 * Run LLM evaluations against Langfuse datasets.
 *
 * This tests whether the LLM correctly constructs tool calls
 * from natural language input.
 *
 * Usage:
 *   bun run src/scripts/run-tool-evals.ts          # Run all evals
 *   bun run src/scripts/run-tool-evals.ts calendar # Run only calendar evals
 */
import "dotenv/config";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getLangfuseClient, flushLangfuse } from "../integrations/langfuse.js";
import { calendarEvaluators } from "../evals/calendar-evaluators.js";
import { voiceCallEvaluators } from "../evals/voice-call-evaluators.js";
import type { ToolCall, LLMOutput } from "../evals/types.js";

const CALENDAR_DATASET = "calendar-llm-evals";
const VOICE_CALL_DATASET = "voice-call-llm-evals";
const MODEL_NAME = process.env.EVAL_MODEL ?? "gpt-4o-mini";

// Calendar tool schema (copied from calendar.ts to avoid import side effects)
const createCalendarEventSchema = z
  .object({
    title: z.string().describe("Event title/summary"),
    allDay: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether this is an all-day event (no specific times)"),
    startDate: z.iso
      .date()
      .optional()
      .describe("Start date for all-day events (YYYY-MM-DD)"),
    endDate: z.iso
      .date()
      .optional()
      .describe(
        "End date for all-day events (YYYY-MM-DD, exclusive - use the day after the last day)"
      ),
    startTime: z.iso
      .datetime()
      .optional()
      .describe(
        "Start time. CRITICAL: NEVER use Z suffix. ALWAYS include Eastern timezone offset: use -05:00 for winter (Nov-Mar) or -04:00 for summer (Mar-Nov). Example: 2024-01-15T14:00:00-05:00"
      ),
    endTime: z.iso
      .datetime()
      .optional()
      .describe(
        "End time. CRITICAL: NEVER use Z suffix. ALWAYS include Eastern timezone offset: use -05:00 for winter (Nov-Mar) or -04:00 for summer (Mar-Nov). Example: 2024-01-15T15:00:00-05:00"
      ),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    whose: z
      .enum(["me", "partner", "both", "shared"])
      .optional()
      .default("shared")
      .describe(
        "Where to add the event: 'shared' (default) uses the couple's shared calendar"
      ),
  })
  .refine(
    (data) => {
      if (data.allDay) {
        return data.startDate && data.endDate;
      }
      return data.startTime && data.endTime;
    },
    {
      message:
        "All-day events require startDate and endDate; timed events require startTime and endTime",
    }
  );

interface CalendarTestInput {
  userMessage: string;
  currentDate: string;
  currentTime: string;
}

/**
 * Build a minimal system prompt for evaluation.
 * Injects the test case's date/time so the LLM knows "today".
 */
function buildEvalSystemPrompt(
  currentDate: string,
  currentTime: string
): string {
  // Parse date to get day of week
  const date = new Date(currentDate + "T12:00:00");
  const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
  const monthDay = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return `You are an AI assistant helping a couple coordinate their lives.

Current user: Test User
Current date: ${dayOfWeek}, ${monthDay}
Current time: ${currentTime} (Eastern Time)
Timezone: America/New_York (Eastern US)

When creating calendar events, always set event times as Eastern Time with the correct offset:
- Use -05:00 for EST (November through early March)
- Use -04:00 for EDT (mid-March through early November)

IMPORTANT: Always use the createCalendarEvent tool when the user asks to schedule, add, or create an event.`;
}

/**
 * Run the LLM with mock tools and capture what it tries to call.
 */
async function runCalendarLLM(input: CalendarTestInput): Promise<LLMOutput> {
  const capturedCalls: ToolCall[] = [];

  // Also add getCalendarEvents so the LLM has options
  const mockGetEventsSchema = z.object({
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
  });

  // Try gpt-4o for better instruction following
  const result = await generateText({
    model: openai(MODEL_NAME),
    system: buildEvalSystemPrompt(input.currentDate, input.currentTime),
    messages: [{ role: "user", content: input.userMessage }],
    tools: {
      createCalendarEvent: tool({
        description:
          "Create a calendar event. All times are Eastern Time (America/New_York). " +
          "For timed events, use ISO format with Eastern offset: -05:00 (EST winter) or -04:00 (EDT summer).",
        inputSchema: createCalendarEventSchema,
        execute: async (args) => {
          capturedCalls.push({
            toolName: "createCalendarEvent",
            args: args as Record<string, unknown>,
          });
          return { success: true, message: "Event created (mock)" };
        },
      }),
      getCalendarEvents: tool({
        description: "Get calendar events within a date range",
        inputSchema: mockGetEventsSchema,
        execute: async (args) => {
          capturedCalls.push({
            toolName: "getCalendarEvents",
            args: args as Record<string, unknown>,
          });
          return { events: [] };
        },
      }),
    },
    stopWhen: (event) => event.steps.length >= 2,
  });

  return {
    toolCalls: capturedCalls,
    text: result.text,
  };
}

async function runCalendarEvals() {
  console.log("[eval] Running calendar LLM evaluations...\n");
  console.log(`[eval] Model: ${MODEL_NAME} (set EVAL_MODEL to change)\n`);

  const langfuse = getLangfuseClient();

  // Fetch the dataset
  console.log(`[eval] Fetching dataset: ${CALENDAR_DATASET}`);
  const dataset = await langfuse.dataset.get(CALENDAR_DATASET);
  console.log(`[eval] Found ${dataset.items.length} test cases\n`);

  const runName = `calendar-llm-eval-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}`;
  console.log(`[eval] Starting experiment run: ${runName}\n`);

  // Task function - calls actual LLM
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const task = async (params: any): Promise<LLMOutput> => {
    const input = (params.item?.input ?? params.input) as CalendarTestInput;
    console.log(`  → "${input.userMessage.slice(0, 50)}..."`);
    return runCalendarLLM(input);
  };

  // Convert evaluators to Langfuse format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const langfuseEvaluators = calendarEvaluators.map((evaluator): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (params: any) => {
      const result = await evaluator({
        input: params.input as CalendarTestInput,
        output: params.output as LLMOutput,
        expectedOutput: params.expectedOutput,
      });
      return {
        name: result.name,
        value: result.value,
        comment: result.comment,
      };
    };
  });

  console.log("[eval] Running experiment via Langfuse API...\n");

  try {
    const result = await dataset.runExperiment({
      name: runName,
      description:
        "LLM calendar tool call evaluation - tests timezone handling",
      task,
      evaluators: langfuseEvaluators,
    });

    console.log("\n" + "=".repeat(60));
    console.log("EXPERIMENT COMPLETE");
    console.log("=".repeat(60));
    console.log(await result.format({ includeItemResults: true }));
  } catch (error) {
    console.error("[eval] Experiment API failed:", error);

    // Fallback: run locally
    console.log("\n[eval] Falling back to local evaluation...\n");

    const results: Array<{
      scenario: string;
      scores: Record<string, number>;
    }> = [];

    for (const item of dataset.items) {
      const scenario =
        (item.metadata as Record<string, string>)?.scenario ?? "unknown";
      console.log(`[eval] Running: ${scenario}`);

      const input = item.input as CalendarTestInput;
      console.log(`  → "${input.userMessage}"`);

      const output = await runCalendarLLM(input);
      console.log(
        `  ← Tool calls: ${output.toolCalls.map((tc) => tc.toolName).join(", ") || "(none)"}`
      );

      const scores: Record<string, number> = {};
      for (const evaluator of calendarEvaluators) {
        const result = await evaluator({
          input,
          output,
          expectedOutput: item.expectedOutput as {
            shouldCallTool: boolean;
            startTimeOffset?: "-05:00" | "-04:00";
            shouldBeAllDay?: boolean;
          },
        });
        scores[result.name] = result.value;
        console.log(
          `  ${result.name}: ${result.value} ${result.comment ? `(${result.comment})` : ""}`
        );
      }

      results.push({ scenario, scores });
      console.log("");
    }

    // Summary
    console.log("=".repeat(60));
    console.log("SUMMARY (local run)");
    console.log("=".repeat(60));

    const total = results.length;
    const scoreNames = Object.keys(results[0]?.scores ?? {});
    for (const scoreName of scoreNames) {
      const avg =
        results.reduce((sum, r) => sum + (r.scores[scoreName] ?? 0), 0) / total;
      console.log(`${scoreName}: ${(avg * 100).toFixed(1)}%`);
    }
  }

  await flushLangfuse();
  console.log(`\n[eval] View results at: https://cloud.langfuse.com/datasets`);
}

// ============ Voice Call Eval Types ============

interface VoiceCallTestInput {
  userMessage: string;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  callResult?: {
    toName: string;
    outcome: "success" | "voicemail" | "no_answer" | "failure";
    summary: string;
  };
}

// ============ Voice Call Eval System Prompt ============

function buildVoiceCallEvalSystemPrompt(): string {
  return `You are an AI assistant helping a couple coordinate their lives.

Current user: Test User
Current date: Tuesday, January 7, 2025
Current time: 7:30 PM (Eastern Time)
Timezone: America/New_York (Eastern US)

IMPORTANT: Always use your tools to check information. Never guess or assume.
- Use webSearch to find restaurants, products, services, news, etc.
- Use webAnswer for direct factual questions (phone numbers, hours, addresses)

## Voice Calls

You can make phone calls using the initiateVoiceCall tool. When the user asks you to "call" somewhere, use this tool.

**Phone Number Verification (STRICT):**

When the user provides a phone number directly (e.g., "call 555-123-4567"):
- Use that number - no search needed

When calling a business by name (e.g., "call Other Half"):
1. ALWAYS use webSearch or webAnswer to find the phone number first
2. The number MUST appear explicitly in the search results
3. DO NOT use phone numbers from your training data or memory
4. If not found, ask: "I couldn't find a phone number for [business]. Do you have it?"
5. When providing the number to the user, cite your source

**Call Result Verification:**

After a call completes, ALWAYS check if the result matches your intent:
1. Compare the person/business reached against who you intended to call
2. If the call summary mentions a DIFFERENT person or business:
   - Immediately acknowledge the number was incorrect
   - Apologize for the error
   - Use webSearch to find the correct number
   - Offer to try again with the verified number
3. NEVER insist a number is correct when call results show it went to the wrong person

**When User Questions Your Information:**

If a user says "that's not right", "are you sure?", or challenges information:
1. DO NOT defensively repeat your previous answer
2. Search again using webSearch or webAnswer to re-verify
3. If you get the same result, cite the source explicitly
4. If you get a different result, acknowledge the correction

## Business Information (Hours, Phone Numbers, Addresses)

When providing business hours, phone numbers, or addresses:
1. ALWAYS use webSearch or webAnswer first - never provide from memory alone
2. Cite your source: "According to [source], they close at..."`;
}

// ============ Voice Call LLM Runner ============

async function runVoiceCallLLM(input: VoiceCallTestInput): Promise<LLMOutput> {
  const capturedCalls: ToolCall[] = [];

  // Mock tool schemas
  const webSearchSchema = z.object({
    query: z.string().describe("Search query"),
    location: z.string().optional().describe("Location context"),
  });

  const webAnswerSchema = z.object({
    question: z.string().describe("The factual question to answer"),
  });

  const initiateVoiceCallSchema = z.object({
    agentType: z.enum(["restaurant", "medical", "general"]),
    callPurpose: z.enum([
      "reservation",
      "confirmation",
      "inquiry",
      "appointment",
      "other",
    ]),
    toNumber: z.string().describe("Phone number in E.164 format"),
    toName: z.string().describe("Name of person/business"),
    instructions: z.string().describe("Instructions for the call"),
  });

  // Build messages array
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Add conversation history if present
  if (input.conversationHistory) {
    messages.push(...input.conversationHistory);
  }

  // Add current message
  messages.push({ role: "user", content: input.userMessage });

  // If there's a call result, inject it as context
  let systemAddendum = "";
  if (input.callResult) {
    systemAddendum = `\n\n**Recent Call Result:**
Call to: ${input.callResult.toName}
Outcome: ${input.callResult.outcome}
Summary: ${input.callResult.summary}

The user is now asking about this call result.`;
  }

  const result = await generateText({
    model: openai(MODEL_NAME),
    system: buildVoiceCallEvalSystemPrompt() + systemAddendum,
    messages,
    tools: {
      webSearch: tool({
        description: "Search the web for information",
        inputSchema: webSearchSchema,
        execute: async (args) => {
          capturedCalls.push({ toolName: "webSearch", args });
          // Return mock search results
          return {
            success: true,
            results: [
              {
                title: "Mock Search Result",
                url: "https://example.com",
                excerpt: "Phone: (212) 555-0123. Open until 11pm.",
              },
            ],
          };
        },
      }),
      webAnswer: tool({
        description: "Get a direct answer to a factual question",
        inputSchema: webAnswerSchema,
        execute: async (args) => {
          capturedCalls.push({ toolName: "webAnswer", args });
          return {
            success: true,
            answer:
              "According to their website, the phone number is (212) 555-0123 and they are open until 11pm.",
          };
        },
      }),
      initiateVoiceCall: tool({
        description: "Make a phone call",
        inputSchema: initiateVoiceCallSchema,
        execute: async (args) => {
          capturedCalls.push({ toolName: "initiateVoiceCall", args });
          return {
            success: true,
            message: "Call initiated (mock)",
          };
        },
      }),
    },
    stopWhen: (event) => event.steps.length >= 3,
  });

  return {
    toolCalls: capturedCalls,
    text: result.text,
  };
}

// ============ Voice Call Eval Runner ============

async function runVoiceCallEvals() {
  console.log("[eval] Running voice call LLM evaluations...\n");
  console.log(`[eval] Model: ${MODEL_NAME} (set EVAL_MODEL to change)\n`);

  const langfuse = getLangfuseClient();

  // Fetch the dataset
  console.log(`[eval] Fetching dataset: ${VOICE_CALL_DATASET}`);
  let dataset;
  try {
    dataset = await langfuse.dataset.get(VOICE_CALL_DATASET);
  } catch {
    console.error(`[eval] Dataset not found: ${VOICE_CALL_DATASET}`);
    console.log(
      "[eval] Run 'bun run src/scripts/seed-voice-call-datasets.ts' first"
    );
    return;
  }
  console.log(`[eval] Found ${dataset.items.length} test cases\n`);

  const runName = `voice-call-llm-eval-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}`;
  console.log(`[eval] Starting experiment run: ${runName}\n`);

  // Run evaluations locally (Langfuse experiment API can be flaky)
  const results: Array<{
    scenario: string;
    category: string;
    scores: Record<string, number>;
  }> = [];

  for (const item of dataset.items) {
    const metadata = item.metadata as { scenario: string; category: string };
    const scenario = metadata?.scenario ?? "unknown";
    const category = metadata?.category ?? "unknown";
    console.log(`[eval] Running: ${scenario} (${category})`);

    const input = item.input as VoiceCallTestInput;
    console.log(`  -> "${input.userMessage.slice(0, 60)}..."`);

    const output = await runVoiceCallLLM(input);
    console.log(
      `  <- Tool calls: ${output.toolCalls.map((tc) => tc.toolName).join(", ") || "(none)"}`
    );

    const scores: Record<string, number> = {};
    for (const evaluator of voiceCallEvaluators) {
      const result = await evaluator({
        input,
        output,
        expectedOutput: item.expectedOutput as {
          shouldUseWebSearch?: boolean;
          shouldCiteSource?: boolean;
          shouldAcknowledgeMismatch?: boolean;
          shouldOfferToRetry?: boolean;
          shouldSearchAgain?: boolean;
          shouldNotDefend?: boolean;
          shouldInitiateCall?: boolean;
        },
      });
      scores[result.name] = result.value;
      if (result.value < 1.0) {
        console.log(
          `  ${result.name}: ${result.value} ${result.comment ? `(${result.comment})` : ""}`
        );
      }
    }

    results.push({ scenario, category, scores });
    console.log("");
  }

  // Summary by category
  console.log("=".repeat(60));
  console.log("SUMMARY BY CATEGORY");
  console.log("=".repeat(60));

  const categories = [...new Set(results.map((r) => r.category))];
  for (const category of categories) {
    const categoryResults = results.filter((r) => r.category === category);
    console.log(
      `\n${category.toUpperCase()} (${categoryResults.length} tests):`
    );

    const scoreNames = Object.keys(categoryResults[0]?.scores ?? {});
    for (const scoreName of scoreNames) {
      const scores = categoryResults.map((r) => r.scores[scoreName] ?? 0);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg < 1.0) {
        console.log(`  ${scoreName}: ${(avg * 100).toFixed(1)}%`);
      }
    }
  }

  // Overall summary
  console.log("\n" + "=".repeat(60));
  console.log("OVERALL SUMMARY");
  console.log("=".repeat(60));

  const total = results.length;
  const scoreNames = Object.keys(results[0]?.scores ?? {});
  for (const scoreName of scoreNames) {
    const avg =
      results.reduce((sum, r) => sum + (r.scores[scoreName] ?? 0), 0) / total;
    console.log(`${scoreName}: ${(avg * 100).toFixed(1)}%`);
  }

  await flushLangfuse();
  console.log(`\n[eval] View results at: https://cloud.langfuse.com/datasets`);
}

// Parse args and run
const args = process.argv.slice(2);
const evalType = args[0] ?? "all";

async function main() {
  if (evalType === "calendar") {
    await runCalendarEvals();
  } else if (evalType === "voice-call") {
    await runVoiceCallEvals();
  } else if (evalType === "all") {
    await runCalendarEvals();
    console.log("\n" + "=".repeat(60) + "\n");
    await runVoiceCallEvals();
  } else {
    console.log(`Unknown eval type: ${evalType}`);
    console.log("Available: calendar, voice-call, all");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[eval] Fatal error:", error);
  process.exit(1);
});
