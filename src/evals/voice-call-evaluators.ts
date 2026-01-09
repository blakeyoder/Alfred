/**
 * Evaluators for voice call LLM tool call quality.
 *
 * These evaluate:
 * 1. Phone number source verification - did the LLM use web search?
 * 2. Call result mismatch detection - did the LLM notice wrong person/business?
 * 3. Business info citation - did the LLM cite sources?
 * 4. Challenge response - did the LLM re-verify instead of defending?
 */
import type { LLMOutput, EvaluatorResult } from "./types.js";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface CallResult {
  toName: string;
  outcome: "success" | "voicemail" | "no_answer" | "failure";
  summary: string;
}

interface EvaluatorInput {
  input: {
    userMessage: string;
    conversationHistory?: ConversationMessage[];
    callResult?: CallResult;
  };
  output: LLMOutput;
  expectedOutput: {
    shouldUseWebSearch?: boolean;
    shouldCiteSource?: boolean;
    shouldAcknowledgeMismatch?: boolean;
    shouldOfferToRetry?: boolean;
    shouldSearchAgain?: boolean;
    shouldNotDefend?: boolean;
    shouldInitiateCall?: boolean;
  };
}

// ============ Helper Functions ============

function usedWebSearch(output: LLMOutput): boolean {
  return (
    output.toolCalls?.some(
      (tc) => tc.toolName === "webSearch" || tc.toolName === "webAnswer"
    ) ?? false
  );
}

function usedTool(output: LLMOutput, toolName: string): boolean {
  return output.toolCalls?.some((tc) => tc.toolName === toolName) ?? false;
}

function textMatchesAny(text: string, patterns: string[]): boolean {
  const lowerText = text.toLowerCase();
  return patterns.some((pattern) => lowerText.includes(pattern));
}

function skipIfUndefined(
  expected: boolean | undefined,
  name: string,
  skipComment: string
): EvaluatorResult | null {
  if (expected === undefined) {
    return { name, value: 1.0, comment: skipComment };
  }
  return null;
}

// ============ Evaluators ============

/**
 * Evaluates if the LLM used web search before making a call (when expected).
 */
async function webSearchBeforeCallEvaluator({
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const skip = skipIfUndefined(
    expectedOutput.shouldUseWebSearch,
    "web_search_used",
    "No web search expectation for this test case"
  );
  if (skip) return skip;

  const searched = usedWebSearch(output);

  if (expectedOutput.shouldUseWebSearch) {
    return searched
      ? {
          name: "web_search_used",
          value: 1.0,
          comment: "Correctly used web search to find information",
        }
      : {
          name: "web_search_used",
          value: 0.0,
          comment:
            "Should have used webSearch/webAnswer but did not - may have hallucinated",
        };
  }

  return searched
    ? {
        name: "web_search_used",
        value: 0.5,
        comment:
          "Used web search when not needed (user provided info directly)",
      }
    : {
        name: "web_search_used",
        value: 1.0,
        comment: "Correctly did not use web search (info was provided)",
      };
}

/**
 * Evaluates if the LLM initiated a voice call when expected.
 */
async function callInitiatedEvaluator({
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const skip = skipIfUndefined(
    expectedOutput.shouldInitiateCall,
    "call_initiated",
    "No call initiation expectation for this test case"
  );
  if (skip) return skip;

  const called = usedTool(output, "initiateVoiceCall");

  if (expectedOutput.shouldInitiateCall) {
    return called
      ? {
          name: "call_initiated",
          value: 1.0,
          comment: "Correctly initiated voice call",
        }
      : {
          name: "call_initiated",
          value: 0.0,
          comment: "Should have initiated call but did not",
        };
  }

  return called
    ? {
        name: "call_initiated",
        value: 0.0,
        comment: "Should NOT have initiated call",
      }
    : {
        name: "call_initiated",
        value: 1.0,
        comment: "Correctly did not initiate call",
      };
}

const CITATION_PATTERNS = [
  "according to",
  "based on",
  "from their website",
  "per their",
  "their website shows",
  "search results show",
  "i found that",
  "the website says",
  "listed as",
  "shows that",
];

const SOURCE_REF_PATTERNS = ["http", ".com", "website", "search"];

/**
 * Evaluates if the LLM cited sources when providing business info.
 */
async function sourceCitationEvaluator({
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const skip = skipIfUndefined(
    expectedOutput.shouldCiteSource,
    "source_cited",
    "No citation expectation for this test case"
  );
  if (skip) return skip;

  const hasCitation =
    textMatchesAny(output.text, CITATION_PATTERNS) ||
    textMatchesAny(output.text, SOURCE_REF_PATTERNS);

  if (expectedOutput.shouldCiteSource) {
    return hasCitation
      ? {
          name: "source_cited",
          value: 1.0,
          comment: "Correctly cited source for information",
        }
      : {
          name: "source_cited",
          value: 0.0,
          comment:
            "Should have cited source but provided info without attribution",
        };
  }

  return {
    name: "source_cited",
    value: 1.0,
    comment: "Citation not required for this case",
  };
}

const MISMATCH_PATTERNS = [
  "wrong number",
  "incorrect number",
  "wrong person",
  "different person",
  "different business",
  "not the right",
  "doesn't match",
  "didn't reach",
  "reached someone else",
  "that wasn't",
  "appears to be incorrect",
  "number may be wrong",
  "apologize",
  "sorry about",
  "my mistake",
];

/**
 * Evaluates if the LLM detected a mismatch between intended and actual call recipient.
 */
async function mismatchDetectionEvaluator({
  input,
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const skip = skipIfUndefined(
    expectedOutput.shouldAcknowledgeMismatch,
    "mismatch_detected",
    "No mismatch detection expectation for this test case"
  );
  if (skip) return skip;

  const acknowledgedMismatch = textMatchesAny(output.text, MISMATCH_PATTERNS);

  if (expectedOutput.shouldAcknowledgeMismatch) {
    if (acknowledgedMismatch) {
      return {
        name: "mismatch_detected",
        value: 1.0,
        comment: "Correctly acknowledged call went to wrong person/business",
      };
    }

    // Check if the response mentions the wrong name from call result without acknowledging
    if (input.callResult) {
      const wrongNameInSummary = input.callResult.summary
        .toLowerCase()
        .match(/(?:spoke with|reached|called)\s+(\w+\s+\w+)/)?.[1];
      if (
        wrongNameInSummary &&
        output.text.toLowerCase().includes(wrongNameInSummary)
      ) {
        return {
          name: "mismatch_detected",
          value: 0.3,
          comment: `Mentioned "${wrongNameInSummary}" but didn't acknowledge this was wrong`,
        };
      }
    }

    return {
      name: "mismatch_detected",
      value: 0.0,
      comment: `Failed to acknowledge that call reached wrong person/business - called "${input.callResult?.toName}" but summary shows different recipient`,
    };
  }

  return acknowledgedMismatch
    ? {
        name: "mismatch_detected",
        value: 0.5,
        comment:
          "Incorrectly suggested mismatch when call was to correct place",
      }
    : {
        name: "mismatch_detected",
        value: 1.0,
        comment: "Correctly did not flag mismatch (call was successful)",
      };
}

const RETRY_PATTERNS = [
  "try again",
  "call again",
  "find the correct",
  "search for the right",
  "look up the correct",
  "let me find",
  "let me search",
  "would you like me to",
  "shall i",
  "i can try",
  "i'll search",
];

/**
 * Evaluates if the LLM offered to retry with correct number after mismatch.
 */
async function retryOfferedEvaluator({
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const skip = skipIfUndefined(
    expectedOutput.shouldOfferToRetry,
    "retry_offered",
    "No retry expectation for this test case"
  );
  if (skip) return skip;

  const offeredRetry =
    textMatchesAny(output.text, RETRY_PATTERNS) || usedWebSearch(output);

  if (expectedOutput.shouldOfferToRetry) {
    return offeredRetry
      ? {
          name: "retry_offered",
          value: 1.0,
          comment: "Correctly offered to find correct number and retry",
        }
      : {
          name: "retry_offered",
          value: 0.0,
          comment: "Should have offered to retry with correct number",
        };
  }

  return {
    name: "retry_offered",
    value: 1.0,
    comment: "Retry not expected for this case",
  };
}

/**
 * Evaluates if the LLM searched again when challenged (instead of defending).
 */
async function reVerificationEvaluator({
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const skip = skipIfUndefined(
    expectedOutput.shouldSearchAgain,
    "reverification",
    "No re-verification expectation for this test case"
  );
  if (skip) return skip;

  const searchedAgain = usedWebSearch(output);

  if (expectedOutput.shouldSearchAgain) {
    return searchedAgain
      ? {
          name: "reverification",
          value: 1.0,
          comment: "Correctly searched again to verify when challenged",
        }
      : {
          name: "reverification",
          value: 0.0,
          comment:
            "Should have searched again when challenged, but defended or repeated previous answer",
        };
  }

  return {
    name: "reverification",
    value: 1.0,
    comment: "Re-verification not expected for this case",
  };
}

const DEFENSIVE_PATTERNS = [
  "i'm confident",
  "i'm sure",
  "that is correct",
  "that's correct",
  "the number is correct",
  "i can confirm",
  "as i mentioned",
  "as i said",
  "i already told you",
  "that's the right",
  "that is the right",
];

function checkRepeatedInfo(
  previousAnswer: string | undefined,
  currentText: string
): boolean {
  if (!previousAnswer) return false;

  const text = currentText.toLowerCase();
  const prevNumbers = previousAnswer.match(/\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}/g);
  const prevTimes = previousAnswer.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi);

  if (prevNumbers?.some((num) => text.includes(num.replace(/[-.\s]/g, "")))) {
    return true;
  }
  if (prevTimes?.some((time) => text.includes(time.toLowerCase()))) {
    return true;
  }
  return false;
}

/**
 * Evaluates if the LLM avoided defending incorrect information when challenged.
 */
async function noDefendEvaluator({
  input,
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const skip = skipIfUndefined(
    expectedOutput.shouldNotDefend,
    "no_defend",
    "No defend check expectation for this test case"
  );
  if (skip) return skip;

  const searchedToVerify = usedWebSearch(output);
  const wasDefensive = textMatchesAny(output.text, DEFENSIVE_PATTERNS);
  const previousAnswer = input.conversationHistory?.find(
    (m) => m.role === "assistant"
  )?.content;
  const repeatedSameInfo = checkRepeatedInfo(previousAnswer, output.text);

  if (!expectedOutput.shouldNotDefend) {
    return {
      name: "no_defend",
      value: 1.0,
      comment: "Defend check not applicable for this case",
    };
  }

  if (searchedToVerify) {
    return {
      name: "no_defend",
      value: 1.0,
      comment: "Correctly searched to verify rather than defending",
    };
  }
  if (wasDefensive) {
    return {
      name: "no_defend",
      value: 0.0,
      comment: "Was defensive without re-verifying when challenged",
    };
  }
  if (repeatedSameInfo) {
    return {
      name: "no_defend",
      value: 0.3,
      comment: "Repeated same information without searching to verify",
    };
  }
  return {
    name: "no_defend",
    value: 0.7,
    comment: "Did not search but also did not defensively repeat",
  };
}

/**
 * All voice call LLM evaluators for use in experiments.
 */
export const voiceCallEvaluators = [
  webSearchBeforeCallEvaluator,
  callInitiatedEvaluator,
  sourceCitationEvaluator,
  mismatchDetectionEvaluator,
  retryOfferedEvaluator,
  reVerificationEvaluator,
  noDefendEvaluator,
];
