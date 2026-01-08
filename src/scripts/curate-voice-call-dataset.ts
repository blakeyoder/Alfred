#!/usr/bin/env bun
/**
 * Curate voice call evaluation dataset from low-scoring production traces.
 *
 * Workflow:
 * 1. Fetch traces with failing quality scores from Langfuse
 * 2. Extract conversation history and context
 * 3. Add to evaluation dataset with sourceTraceId linking
 *
 * Usage:
 *   bun run src/scripts/curate-voice-call-dataset.ts
 *   bun run src/scripts/curate-voice-call-dataset.ts --days=14  # Look back 14 days
 *   bun run src/scripts/curate-voice-call-dataset.ts --dry-run  # Preview without adding
 */
import "dotenv/config";
import { getLangfuseClient, flushLangfuse } from "../integrations/langfuse.js";

const DATASET_NAME = "voice-call-failures-production";

// Score names that indicate failures we want to capture
const FAILURE_SCORES = [
  "factual_query_searched",
  "call_mismatch_handled",
  "source_cited",
];

interface TraceScore {
  name: string;
  value: number;
  comment?: string;
}

interface ParsedArgs {
  days: number;
  dryRun: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let days = 7;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith("--days=")) {
      days = parseInt(arg.split("=")[1], 10);
    }
    if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  return { days, dryRun };
}

function buildExpectedOutput(
  failingScores: TraceScore[]
): Record<string, boolean> {
  const output: Record<string, boolean> = {};

  for (const score of failingScores) {
    switch (score.name) {
      case "factual_query_searched":
        output.shouldUseWebSearch = true;
        break;
      case "call_mismatch_handled":
        output.shouldAcknowledgeMismatch = true;
        output.shouldOfferToRetry = true;
        break;
      case "source_cited":
        output.shouldCiteSource = true;
        break;
    }
  }

  return output;
}

function determineCategory(failingScores: TraceScore[]): string {
  // Priority order for categorization
  if (failingScores.some((s) => s.name === "call_mismatch_handled")) {
    return "call_result_mismatch";
  }
  if (failingScores.some((s) => s.name === "factual_query_searched")) {
    return "phone_lookup";
  }
  if (failingScores.some((s) => s.name === "source_cited")) {
    return "business_info";
  }
  return "unknown";
}

async function curateDataset() {
  const { days, dryRun } = parseArgs();

  console.log(
    `[curate] Starting dataset curation from past ${days} days${dryRun ? " (DRY RUN)" : ""}...`
  );

  const langfuse = getLangfuseClient();
  const fromTimestamp = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Ensure dataset exists
  if (!dryRun) {
    try {
      await langfuse.api.datasets.create({
        name: DATASET_NAME,
        description:
          "Production traces where agent failed voice call quality checks. " +
          "Used for regression testing after prompt changes.",
        metadata: {
          type: "production-curated",
          scores: FAILURE_SCORES,
          createdAt: new Date().toISOString(),
        },
      });
      console.log(`[curate] Created dataset: ${DATASET_NAME}`);
    } catch (error) {
      if (String(error).includes("already exists")) {
        console.log(`[curate] Dataset exists: ${DATASET_NAME}`);
      } else {
        throw error;
      }
    }
  }

  // Fetch traces - we'll need to paginate through them
  console.log(
    `[curate] Fetching traces since ${fromTimestamp.toISOString()}...`
  );

  let page = 1;
  const pageSize = 50;
  let totalProcessed = 0;
  let addedCount = 0;
  let skippedNoScore = 0;
  let skippedPassing = 0;

  while (true) {
    console.log(`[curate] Fetching page ${page}...`);

    const traces = await langfuse.api.trace.list({
      fromTimestamp: fromTimestamp.toISOString(),
      page,
      limit: pageSize,
      orderBy: "timestamp.desc",
    });

    if (traces.data.length === 0) {
      console.log(`[curate] No more traces to process`);
      break;
    }

    for (const trace of traces.data) {
      totalProcessed++;

      // Get scores for this trace
      let scores: { data: TraceScore[] };
      try {
        scores = await langfuse.api.scoreV2.get({
          traceId: trace.id,
        });
      } catch {
        // Trace might not have scores
        skippedNoScore++;
        continue;
      }

      // Find failing scores (value = 0)
      const failingScores = scores.data.filter(
        (s) => FAILURE_SCORES.includes(s.name) && s.value === 0
      );

      if (failingScores.length === 0) {
        skippedPassing++;
        continue;
      }

      // Found a failing trace!
      const category = determineCategory(failingScores);
      const expectedOutput = buildExpectedOutput(failingScores);

      console.log(`\n[curate] Found failing trace: ${trace.id}`);
      console.log(`  Category: ${category}`);
      console.log(`  Failing scores:`);
      for (const s of failingScores) {
        console.log(`    - ${s.name}: ${s.comment ?? "(no comment)"}`);
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would add to dataset`);
        addedCount++;
        continue;
      }

      // Build dataset item
      // Note: We store the trace input/output as the dataset item
      // The conversation history would ideally come from the trace observations
      // For now, we store what we have from the trace
      try {
        await langfuse.api.datasetItems.create({
          datasetName: DATASET_NAME,
          input: {
            // The user message that triggered the failure
            currentMessage: trace.input,
            // Metadata about the trace for context
            traceMetadata: trace.metadata,
          },
          expectedOutput,
          metadata: {
            category,
            failingScores: failingScores.map((s) => ({
              name: s.name,
              value: s.value,
              comment: s.comment,
            })),
            originalTraceTimestamp: trace.timestamp,
            curatedAt: new Date().toISOString(),
          },
          sourceTraceId: trace.id,
        });

        addedCount++;
        console.log(`  -> Added to dataset`);
      } catch (error) {
        console.error(`  -> Failed to add: ${error}`);
      }
    }

    // Check if we've processed all traces
    if (traces.data.length < pageSize) {
      break;
    }

    page++;

    // Safety limit
    if (page > 20) {
      console.log(`[curate] Reached page limit, stopping`);
      break;
    }
  }

  await flushLangfuse();

  console.log("\n" + "=".repeat(60));
  console.log("CURATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total traces processed: ${totalProcessed}`);
  console.log(`Skipped (no quality scores): ${skippedNoScore}`);
  console.log(`Skipped (all scores passing): ${skippedPassing}`);
  console.log(`Added to dataset: ${addedCount}`);
  console.log(`\nDataset: ${DATASET_NAME}`);
  if (dryRun) {
    console.log(
      "\n[DRY RUN] No changes were made. Run without --dry-run to add items."
    );
  } else {
    console.log(`\nView dataset at: https://cloud.langfuse.com/datasets`);
  }
}

curateDataset().catch((error) => {
  console.error("[curate] Fatal error:", error);
  process.exit(1);
});
