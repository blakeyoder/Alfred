/**
 * Production trace scoring for online evaluation.
 *
 * Scores every agent response for quality dimensions:
 * - factual_query_searched: Did agent use web search for factual queries?
 * - call_mismatch_handled: Did agent detect wrong number from call results?
 * - source_cited: Did agent cite sources for business info?
 *
 * Scores are attached to Langfuse traces for filtering and dataset curation.
 */
import { getLangfuseClient } from "../integrations/langfuse.js";

interface ToolCall {
  toolName: string;
  args: unknown;
}

interface CallResult {
  toName: string;
  summary: string;
  outcome: string;
}

interface TraceContext {
  traceId: string;
  message: string;
  callResult?: CallResult;
}

interface AgentOutput {
  text: string;
  toolCalls?: ToolCall[];
}

// ============ Pattern Matching Helpers ============

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function textContainsAny(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase();
  return phrases.some((phrase) => lower.includes(phrase));
}

// ============ Query Detection ============

const FACTUAL_QUERY_PATTERNS = [
  /what time|when do|when does|hours|open|close/i,
  /phone number|number for|call\s+\w+/i,
  /address|where is|located|location/i,
  /how much|price|cost/i,
];

const CALL_FOLLOWUP_PATTERNS = [
  /did they pick up/i,
  /what did they say/i,
  /how did the call/i,
  /call go/i,
  /reach them/i,
  /get through/i,
];

const isFactualQuery = (msg: string): boolean =>
  matchesAny(msg, FACTUAL_QUERY_PATTERNS);
const isCallFollowUp = (msg: string): boolean =>
  matchesAny(msg, CALL_FOLLOWUP_PATTERNS);

// ============ Response Analysis ============

function usedWebSearch(toolCalls?: ToolCall[]): boolean {
  return (
    toolCalls?.some(
      (tc) => tc.toolName === "webSearch" || tc.toolName === "webAnswer"
    ) ?? false
  );
}

const BUSINESS_INFO_PATTERNS = [
  /\d{1,2}(?::\d{2})?\s*(?:am|pm)/i,
  /(?:\d{3}[-.\s]?){2}\d{4}/,
  /\d+\s+\w+\s+(?:street|st|avenue|ave|boulevard|blvd|road|rd)/i,
];

const CITATION_PATTERNS = [
  /according to/i,
  /their website/i,
  /website shows/i,
  /search results/i,
  /i found that/i,
  /based on/i,
  /from their/i,
];

const containsBusinessInfo = (text: string): boolean =>
  matchesAny(text, BUSINESS_INFO_PATTERNS);
const hasCitation = (text: string): boolean =>
  matchesAny(text, CITATION_PATTERNS);

/**
 * Extract a person/business name from call summary.
 * e.g., "Reached Courtney Eisen's voicemail" -> "courtney eisen"
 */
function extractReachedName(summary: string): string | null {
  const patterns = [
    /(?:reached|spoke with|called|left (?:a )?(?:message|voicemail) (?:for|with))\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /([a-z]+(?:\s+[a-z]+)?)'s?\s+voicemail/i,
  ];

  for (const pattern of patterns) {
    const match = summary.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

/**
 * Check if there's a mismatch between intended recipient and actual.
 */
function hasNameMismatch(callResult: CallResult): boolean {
  const reachedName = extractReachedName(callResult.summary);
  if (!reachedName) return false;

  const targetLower = callResult.toName.toLowerCase();

  // Check if the reached name is completely different from target
  // Allow partial matches (e.g., "Joe" matches "Joe's Pizza")
  const targetWords = targetLower.split(/\s+/);
  const reachedWords = reachedName.split(/\s+/);

  // If any word from reached name appears in target, it's likely correct
  const hasOverlap = reachedWords.some((word) =>
    targetWords.some(
      (targetWord) =>
        targetWord.includes(word) ||
        word.includes(targetWord) ||
        // Also check for business name patterns
        targetLower.includes(word)
    )
  );

  return !hasOverlap;
}

const MISMATCH_PHRASES = [
  "wrong number",
  "incorrect number",
  "different person",
  "different business",
  "didn't reach",
  "not the right",
  "doesn't match",
  "appears to be incorrect",
  "number may be wrong",
  "apologize",
  "sorry about",
  "my mistake",
  "let me search",
  "let me find the correct",
  "try again",
];

const acknowledgesMismatch = (text: string): boolean =>
  textContainsAny(text, MISMATCH_PHRASES);

// ============ Main Scoring Function ============

/**
 * Score a production trace for quality dimensions.
 *
 * Call this after each agent response to attach scores to the trace.
 * Scores enable filtering in Langfuse UI and automated dataset curation.
 *
 * @param ctx - Trace context including message and optional call result
 * @param output - Agent output including text and tool calls
 */
export async function scoreProductionTrace(
  ctx: TraceContext,
  output: AgentOutput
): Promise<void> {
  const langfuse = getLangfuseClient();
  const scores: Array<{
    name: string;
    value: number;
    comment: string;
  }> = [];

  // 1. Factual Query → Should use web search
  if (isFactualQuery(ctx.message)) {
    const searched = usedWebSearch(output.toolCalls);
    scores.push({
      name: "factual_query_searched",
      value: searched ? 1 : 0,
      comment: searched
        ? "Used web search for factual query"
        : "WARNING: May have hallucinated factual info without searching",
    });
  }

  // 2. Call result present + mismatch → Should acknowledge
  if (ctx.callResult && isCallFollowUp(ctx.message)) {
    const hasMismatch = hasNameMismatch(ctx.callResult);

    if (hasMismatch) {
      const acknowledged = acknowledgesMismatch(output.text);
      scores.push({
        name: "call_mismatch_handled",
        value: acknowledged ? 1 : 0,
        comment: acknowledged
          ? "Correctly identified wrong number was called"
          : `FAILURE: Called "${ctx.callResult.toName}" but summary shows different person - agent did not acknowledge`,
      });
    }
  }

  // 3. Business info in response → Should cite source
  if (containsBusinessInfo(output.text)) {
    const cited = hasCitation(output.text);
    scores.push({
      name: "source_cited",
      value: cited ? 1 : 0,
      comment: cited
        ? "Cited source for business information"
        : "Provided business info without citing source",
    });
  }

  // Submit all scores to Langfuse
  for (const score of scores) {
    try {
      await langfuse.api.score.create({
        traceId: ctx.traceId,
        name: score.name,
        value: score.value,
        comment: score.comment,
      });
    } catch (error) {
      console.error(
        `[trace-scoring] Failed to submit score ${score.name}:`,
        error
      );
    }
  }

  if (scores.length > 0) {
    console.log(
      `[trace-scoring] Submitted ${scores.length} scores for trace ${ctx.traceId}`
    );
  }
}
