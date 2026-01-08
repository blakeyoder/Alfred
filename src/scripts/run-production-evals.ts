#!/usr/bin/env bun
/**
 * Run evaluation experiments against production-curated datasets.
 *
 * This script:
 * 1. Loads the curated dataset of production failures
 * 2. Replays each conversation through the agent
 * 3. Scores responses with evaluators
 * 4. Reports results for prompt tuning
 *
 * Usage:
 *   bun run src/scripts/run-production-evals.ts
 *   bun run src/scripts/run-production-evals.ts --dataset=voice-call-failures-production
 *   bun run src/scripts/run-production-evals.ts --model=gpt-4o
 */
import "dotenv/config";
import { generateText, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getLangfuseClient, flushLangfuse } from "../integrations/langfuse.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import { voiceCallEvaluators } from "../evals/voice-call-evaluators.js";

const DEFAULT_DATASET = "voice-call-failures-production";

interface ParsedArgs {
  dataset: string;
  model: string;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let dataset = DEFAULT_DATASET;
  let model = process.env.EVAL_MODEL ?? "gpt-4o-mini";

  for (const arg of args) {
    if (arg.startsWith("--dataset=")) {
      dataset = arg.split("=")[1];
    }
    if (arg.startsWith("--model=")) {
      model = arg.split("=")[1];
    }
  }

  return { dataset, model };
}

interface DatasetItemInput {
  currentMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  callResult?: {
    toName: string;
    summary: string;
    outcome: "success" | "failure" | "voicemail" | "no_answer";
  };
  traceMetadata?: Record<string, unknown>;
}

interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

interface LLMOutput {
  text: string;
  toolCalls: ToolCall[];
}

/**
 * Build a minimal system prompt for evaluation.
 * Uses the real system prompt from the agent.
 */
function buildEvalSystemPrompt(
  callResult?: DatasetItemInput["callResult"]
): string {
  const basePrompt = buildSystemPrompt({
    context: {
      userId: "eval-user",
      userName: "Test User",
      coupleId: "eval-couple",
      coupleName: "Test Couple",
      partnerName: "Partner",
      threadId: "eval-thread",
      visibility: "shared",
    },
  });

  // Add call result context if present
  if (callResult) {
    return (
      basePrompt +
      `\n\n**Recent Call Result:**
Call to: ${callResult.toName}
Outcome: ${callResult.outcome}
Summary: ${callResult.summary}

The user is now asking about this call result.`
    );
  }

  return basePrompt;
}

/**
 * Run the LLM with mock tools and capture what it does.
 */
async function runLLM(
  input: DatasetItemInput,
  model: string
): Promise<LLMOutput> {
  const capturedCalls: ToolCall[] = [];

  // Build messages array
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (input.conversationHistory) {
    messages.push(...input.conversationHistory);
  }

  messages.push({ role: "user", content: input.currentMessage });

  const result = await generateText({
    model: openai(model),
    system: buildEvalSystemPrompt(input.callResult),
    messages,
    tools: {
      webSearch: tool({
        description: "Search the web for information",
        inputSchema: z.object({
          query: z.string().describe("Search query"),
          location: z.string().optional().describe("Location context"),
        }),
        execute: async (args) => {
          capturedCalls.push({ toolName: "webSearch", args });
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
        inputSchema: z.object({
          question: z.string().describe("The factual question to answer"),
        }),
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
        inputSchema: z.object({
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
        }),
        execute: async (args) => {
          capturedCalls.push({ toolName: "initiateVoiceCall", args });
          return {
            success: true,
            message: "Call initiated (mock)",
          };
        },
      }),
    },
    stopWhen: stepCountIs(3),
  });

  return {
    text: result.text,
    toolCalls: capturedCalls,
  };
}

async function runExperiment() {
  const { dataset, model } = parseArgs();

  console.log("[eval] Running production evaluation experiment");
  console.log(`[eval] Dataset: ${dataset}`);
  console.log(`[eval] Model: ${model}\n`);

  const langfuse = getLangfuseClient();

  // Fetch the dataset
  let datasetObj;
  try {
    datasetObj = await langfuse.dataset.get(dataset);
  } catch {
    console.error(`[eval] Dataset not found: ${dataset}`);
    console.log(
      "[eval] Run 'bun run src/scripts/curate-voice-call-dataset.ts' first to create it"
    );
    process.exit(1);
  }

  if (datasetObj.items.length === 0) {
    console.log("[eval] Dataset is empty. No items to evaluate.");
    console.log(
      "[eval] Run 'bun run src/scripts/curate-voice-call-dataset.ts' to add items"
    );
    return;
  }

  console.log(`[eval] Found ${datasetObj.items.length} items\n`);

  const experimentName = `production-eval-${model}-${Date.now()}`;
  console.log(`[eval] Experiment: ${experimentName}\n`);

  // Run evaluations
  const results: Array<{
    itemId: string;
    category: string;
    scores: Record<string, number>;
    comments: Record<string, string>;
  }> = [];

  for (const item of datasetObj.items) {
    const metadata = item.metadata as { category?: string } | undefined;
    const category = metadata?.category ?? "unknown";
    const input = item.input as DatasetItemInput;

    console.log(`[eval] Evaluating item ${item.id} (${category})`);
    console.log(
      `  Message: "${input.currentMessage?.slice(0, 60) ?? "(no message)"}..."`
    );

    if (!input.currentMessage) {
      console.log(`  Skipping - no currentMessage in input`);
      continue;
    }

    // Run LLM
    let output: LLMOutput;
    try {
      output = await runLLM(input, model);
    } catch (error) {
      console.error(`  Error running LLM: ${error}`);
      continue;
    }

    console.log(
      `  Tool calls: ${output.toolCalls.map((tc) => tc.toolName).join(", ") || "(none)"}`
    );

    // Run evaluators
    const scores: Record<string, number> = {};
    const comments: Record<string, string> = {};

    const expectedOutput = item.expectedOutput as Record<string, boolean>;

    for (const evaluator of voiceCallEvaluators) {
      try {
        const result = await evaluator({
          input: {
            userMessage: input.currentMessage,
            conversationHistory: input.conversationHistory,
            callResult: input.callResult,
          },
          output,
          expectedOutput,
        });

        scores[result.name] = result.value;
        if (result.comment) {
          comments[result.name] = result.comment;
        }

        if (result.value < 1.0) {
          console.log(
            `  ${result.name}: ${result.value} - ${result.comment ?? ""}`
          );
        }
      } catch (error) {
        console.error(`  Evaluator ${evaluator.name} failed: ${error}`);
      }
    }

    results.push({
      itemId: item.id,
      category,
      scores,
      comments,
    });

    console.log("");
  }

  // Summary by category
  console.log("=".repeat(60));
  console.log("RESULTS BY CATEGORY");
  console.log("=".repeat(60));

  const categories = [...new Set(results.map((r) => r.category))];

  for (const category of categories) {
    const categoryResults = results.filter((r) => r.category === category);
    console.log(
      `\n${category.toUpperCase()} (${categoryResults.length} items):`
    );

    // Aggregate scores
    const scoreNames = Object.keys(categoryResults[0]?.scores ?? {});
    for (const scoreName of scoreNames) {
      const values = categoryResults.map((r) => r.scores[scoreName] ?? 0);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const passing = values.filter((v) => v >= 1.0).length;

      if (avg < 1.0) {
        console.log(
          `  ${scoreName}: ${(avg * 100).toFixed(1)}% avg (${passing}/${values.length} passing)`
        );
      }
    }
  }

  // Overall summary
  console.log("\n" + "=".repeat(60));
  console.log("OVERALL SUMMARY");
  console.log("=".repeat(60));

  const total = results.length;
  if (total === 0) {
    console.log("No results to summarize");
  } else {
    const scoreNames = Object.keys(results[0]?.scores ?? {});
    for (const scoreName of scoreNames) {
      const values = results.map((r) => r.scores[scoreName] ?? 0);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const passing = values.filter((v) => v >= 1.0).length;
      console.log(
        `${scoreName}: ${(avg * 100).toFixed(1)}% avg (${passing}/${total} passing)`
      );
    }
  }

  await flushLangfuse();
  console.log(`\n[eval] View in Langfuse: https://cloud.langfuse.com/datasets`);
}

runExperiment().catch((error) => {
  console.error("[eval] Fatal error:", error);
  process.exit(1);
});
