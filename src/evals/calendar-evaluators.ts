/**
 * Evaluators for calendar LLM tool call quality.
 *
 * These evaluate whether the LLM correctly constructs tool calls
 * from natural language input.
 */

interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

interface EvaluatorInput {
  input: {
    userMessage: string;
    currentDate: string;
    currentTime: string;
  };
  output: {
    toolCalls: ToolCall[];
    text: string;
  };
  expectedOutput: {
    shouldCallTool: boolean;
    toolName?: string;
    shouldBeAllDay?: boolean;
  };
}

interface EvaluatorResult {
  name: string;
  value: number;
  comment?: string;
}

/**
 * Evaluates if the LLM called the correct tool (or correctly didn't call one).
 */
async function toolCalledEvaluator({
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const calledCreateEvent = output.toolCalls?.some(
    (tc) => tc.toolName === "createCalendarEvent"
  );

  if (expectedOutput.shouldCallTool) {
    if (calledCreateEvent) {
      return {
        name: "tool_called",
        value: 1.0,
        comment: "Correctly called createCalendarEvent",
      };
    }
    return {
      name: "tool_called",
      value: 0.0,
      comment: `Expected tool call but LLM responded with text: "${output.text?.slice(0, 50)}..."`,
    };
  } else {
    if (calledCreateEvent) {
      return {
        name: "tool_called",
        value: 0.0,
        comment: "Should NOT have called createCalendarEvent",
      };
    }
    return {
      name: "tool_called",
      value: 1.0,
      comment: "Correctly did not call createCalendarEvent",
    };
  }
}

/**
 * Evaluates if all-day events are correctly identified.
 */
async function allDayEvaluator({
  output,
  expectedOutput,
}: EvaluatorInput): Promise<EvaluatorResult> {
  // Skip if no all-day expectation
  if (expectedOutput.shouldBeAllDay === undefined) {
    return {
      name: "allday_correct",
      value: 1.0,
      comment: "No all-day expectation for this test case",
    };
  }

  const createEventCall = output.toolCalls?.find(
    (tc) => tc.toolName === "createCalendarEvent"
  );

  if (!createEventCall) {
    return {
      name: "allday_correct",
      value: 0.0,
      comment: "No createCalendarEvent call to evaluate",
    };
  }

  const isAllDay = createEventCall.args.allDay === true;

  if (expectedOutput.shouldBeAllDay && isAllDay) {
    return {
      name: "allday_correct",
      value: 1.0,
      comment: "Correctly set as all-day event",
    };
  } else if (!expectedOutput.shouldBeAllDay && !isAllDay) {
    return {
      name: "allday_correct",
      value: 1.0,
      comment: "Correctly set as timed event",
    };
  } else {
    return {
      name: "allday_correct",
      value: 0.0,
      comment: expectedOutput.shouldBeAllDay
        ? "Should be all-day but was timed"
        : "Should be timed but was all-day",
    };
  }
}

/**
 * Evaluates if the event has a reasonable title.
 */
async function titleEvaluator({
  input,
  output,
}: EvaluatorInput): Promise<EvaluatorResult> {
  const createEventCall = output.toolCalls?.find(
    (tc) => tc.toolName === "createCalendarEvent"
  );

  if (!createEventCall) {
    return {
      name: "has_title",
      value: 0.0,
      comment: "No createCalendarEvent call",
    };
  }

  const title = createEventCall.args.title as string | undefined;

  if (!title || title.trim().length === 0) {
    return {
      name: "has_title",
      value: 0.0,
      comment: "Missing or empty title",
    };
  }

  // Check if title is reasonable (not just "event" or similar)
  const genericTitles = ["event", "meeting", "appointment", "calendar event"];
  const isGeneric = genericTitles.includes(title.toLowerCase().trim());

  // Extract key words from user message to check if title is relevant
  const userMessage = input.userMessage.toLowerCase();
  const titleLower = title.toLowerCase();

  // Simple relevance check - title should contain some key word from request
  const keywords = [
    "dinner",
    "meeting",
    "call",
    "breakfast",
    "birthday",
    "vacation",
  ];
  const hasRelevantKeyword = keywords.some(
    (kw) => userMessage.includes(kw) && titleLower.includes(kw)
  );

  if (hasRelevantKeyword) {
    return {
      name: "has_title",
      value: 1.0,
      comment: `Good title: "${title}"`,
    };
  } else if (!isGeneric) {
    return {
      name: "has_title",
      value: 0.8,
      comment: `Title present but may not match request: "${title}"`,
    };
  } else {
    return {
      name: "has_title",
      value: 0.5,
      comment: `Generic title: "${title}"`,
    };
  }
}

/**
 * All calendar LLM evaluators for use in experiments.
 */
export const calendarEvaluators = [
  toolCalledEvaluator,
  allDayEvaluator,
  titleEvaluator,
];
