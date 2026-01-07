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

const CALENDAR_DATASET = "calendar-llm-evals";

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

interface TestInput {
  userMessage: string;
  currentDate: string;
  currentTime: string;
}

interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

interface LLMOutput {
  toolCalls: ToolCall[];
  text: string;
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
async function runLLM(input: TestInput): Promise<LLMOutput> {
  const capturedCalls: ToolCall[] = [];

  // Also add getCalendarEvents so the LLM has options
  const mockGetEventsSchema = z.object({
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
  });

  // Try gpt-4o for better instruction following
  const modelName = process.env.EVAL_MODEL ?? "gpt-4o-mini";
  const result = await generateText({
    model: openai(modelName),
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
  const modelName = process.env.EVAL_MODEL ?? "gpt-4o-mini";
  console.log("[eval] Running calendar LLM evaluations...\n");
  console.log(`[eval] Model: ${modelName} (set EVAL_MODEL to change)\n`);

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
    const input = (params.item?.input ?? params.input) as TestInput;
    console.log(`  → "${input.userMessage.slice(0, 50)}..."`);
    return runLLM(input);
  };

  // Convert evaluators to Langfuse format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const langfuseEvaluators = calendarEvaluators.map((evaluator): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (params: any) => {
      const result = await evaluator({
        input: params.input as TestInput,
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

      const input = item.input as TestInput;
      console.log(`  → "${input.userMessage}"`);

      const output = await runLLM(input);
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

// Parse args and run
const args = process.argv.slice(2);
const evalType = args[0] ?? "all";

if (evalType === "calendar" || evalType === "all") {
  runCalendarEvals().catch((error) => {
    console.error("[eval] Fatal error:", error);
    process.exit(1);
  });
} else {
  console.log(`Unknown eval type: ${evalType}`);
  console.log("Available: calendar, all");
  process.exit(1);
}
