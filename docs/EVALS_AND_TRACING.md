# Evals Framework & LLM Tracing

This document describes Alfred's evaluation framework and LLM tracing infrastructure, which provides production observability and automated quality testing.

## Architecture Overview

Alfred uses **OpenTelemetry + Langfuse** for production observability, with a separate **LLM evaluation framework** for testing agent behavior:

```
Production Flow:
  Telegram Bot -> Agent (generateText) -> OpenTelemetry Spans -> Langfuse
                                                |
                                                v
                          Scores computed (trace-scoring.ts) -> Dataset curation
                                                |
                                                v
                                  Failing traces -> Production eval datasets

Evaluation Flow:
  Seed datasets (static test cases) -> Run LLM with mock tools -> Evaluators -> Results
```

## LLM Tracing Infrastructure

### OpenTelemetry Setup

**File:** `src/lib/instrumentation.ts`

Tracing uses `@opentelemetry/sdk-trace-node` with `LangfuseSpanProcessor` from `@langfuse/otel`. It registers globally so all spans are automatically captured.

```typescript
// Called on app startup
initializeTracing(): void
  // Creates NodeTracerProvider with LangfuseSpanProcessor
  // Registers globally for automatic span capture
  // Requires LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY

shutdownTracing(): Promise<void>
  // Flushes pending spans on graceful shutdown
```

### Agent Telemetry

**File:** `src/agent/index.ts`

The Vercel AI SDK's `generateText` includes automatic telemetry:

```typescript
experimental_telemetry: {
  isEnabled: true,
  functionId: "alfred-chat",
  tracer: trace.getTracer("alfred-chat"),
  recordInputs: true,           // Captures user messages
  recordOutputs: true,          // Captures LLM responses
  metadata: {
    userId: context.userId,
    sessionId: context.threadId,
    coupleId: context.coupleId,
    visibility: context.visibility,
    userName: context.userName,
    partnerName: context.partnerName,
  },
}
```

This automatically creates spans for:
- LLM calls (message -> response)
- Tool invocations
- Token usage
- Latencies

### Telegram Handler Integration

**File:** `src/adapters/telegram/handlers/message.ts`

Parent spans are created for request context:

```typescript
const tracer = trace.getTracer("telegram-handler");
const span = tracer.startSpan("telegram.message", {
  attributes: {
    "telegram.chat_id": ctx.chat.id,
    "telegram.message_id": ctx.message.message_id,
    "telegram.user_id": telegramId,
    "alfred.user_id": user.id,
    "alfred.thread_id": session.threadId,
  },
});

// Wrap agent call in trace context
await otelContext.with(
  trace.setSpan(otelContext.active(), span),
  async () => {
    const result = await chat(messageText, { context, history, partnerId });
    span.setAttribute("alfred.response_length", result.text.length);
    span.setAttribute("alfred.tool_calls_count", result.toolCalls?.length ?? 0);
  }
);
```

This creates a trace hierarchy: `telegram.message` -> `alfred-chat` (from generateText)

### Environment Configuration

```bash
LANGFUSE_PUBLIC_KEY=pk_...        # Required for tracing
LANGFUSE_SECRET_KEY=sk_...        # Required for tracing
LANGFUSE_SCORING_ENABLED=true     # Enable production scoring
LANGFUSE_DISABLED=true            # Disable all tracing (optional)
```

## Production Trace Scoring

**File:** `src/services/trace-scoring.ts`

Scores are automatically computed for every production trace after agent response.

### Quality Dimensions

#### 1. Factual Query Verification (`factual_query_searched`)

- **When triggered:** User asks for business hours, phone numbers, addresses, prices
- **What's checked:** Did agent use `webSearch` or `webAnswer` tools?
- **Pattern matching:**
  ```
  /what time|when do|hours|open|close/i     -> Time queries
  /phone number|call/i                       -> Phone queries
  /address|where is|location/i               -> Address queries
  /how much|price|cost/i                     -> Price queries
  ```
- **Score:** 1.0 if searched, 0.0 if hallucinated

#### 2. Call Mismatch Detection (`call_mismatch_handled`)

- **When triggered:** User asks follow-up about recent call + there's a mismatch
- **What's checked:**
  1. Extract who was reached from call summary (pattern: "Reached [Name]'s voicemail")
  2. Compare to intended recipient
  3. Did agent acknowledge the wrong number?
- **Acknowledgment patterns:**
  ```
  "wrong number", "incorrect number", "different person",
  "didn't reach", "let me search", "let me find the correct"
  ```
- **Score:** 1.0 if acknowledged, 0.0 if ignored

#### 3. Citation of Business Info (`source_cited`)

- **When triggered:** Agent provides hours, phone, or address in response
- **What's checked:** Does response cite where the info came from?
- **Citation patterns:**
  ```
  "according to", "their website", "website shows",
  "search results", "i found that", "based on"
  ```
- **Score:** 1.0 if cited, 0.0 if provided without attribution

### Implementation Flow

```typescript
// Called in telegram message handler:
scoreProductionTrace(
  {
    traceId: span.spanContext().traceId,
    message: userMessage,
    callResult: {
      toName: "Death & Co",
      summary: "Reached Courtney Eisen's voicemail",
      outcome: "voicemail"
    }
  },
  {
    text: agentResponse,
    toolCalls: [{ toolName: "webSearch", args: {...} }]
  }
);

// For each applicable dimension:
// 1. Pattern-match message content
// 2. Check if agent used correct tools
// 3. Analyze response text for acknowledgments
// 4. Call langfuse.api.score.create({ traceId, name, value, comment })
```

## Eval Framework

### Two Types of Evaluations

#### A. LLM Tool Evals (Testing Agent Instructions)

**Files:** `seed-langfuse-datasets.ts`, `seed-voice-call-datasets.ts`, `run-tool-evals.ts`

**Purpose:** Verify agent follows instructions (e.g., "create calendar event", "verify phone numbers")

**Datasets:**
- `calendar-llm-evals` - Calendar tool instruction following
- `voice-call-llm-evals` - Voice call safety and verification

**Example Test Case (Calendar):**
```typescript
{
  input: {
    userMessage: "Schedule dinner at 7pm tomorrow",
    currentDate: "2024-01-15",
    currentTime: "14:00",
  },
  expectedOutput: {
    shouldCallTool: true,
    startTimeOffset: "-05:00",  // Winter = EST
  }
}
```

#### B. Production Eval (Regression Testing)

**Files:** `curate-voice-call-dataset.ts`, `run-production-evals.ts`

**Purpose:** Regression test on real failures from production

**Dataset:** `voice-call-failures-production` - Auto-populated from failing scores

### Evaluators

#### Calendar Evaluators

**File:** `src/evals/calendar-evaluators.ts`

| Evaluator | Purpose | Scores |
|-----------|---------|--------|
| `toolCalledEvaluator` | Did LLM call createCalendarEvent when it should? | 1.0 (correct), 0.0 (wrong) |
| `allDayEvaluator` | Is event correctly marked as all-day vs timed? | 1.0 (correct), 0.0 (incorrect) |
| `titleEvaluator` | Is event title descriptive and relevant? | 1.0 (good), 0.8 (weak), 0.5 (generic), 0.0 (missing) |

#### Voice Call Evaluators

**File:** `src/evals/voice-call-evaluators.ts`

| Evaluator | Purpose | Scores |
|-----------|---------|--------|
| `webSearchBeforeCallEvaluator` | Did agent search for phone before calling? | 1.0 (yes), 0.5 (unnecessary), 0.0 (no) |
| `callInitiatedEvaluator` | Did agent initiate call when appropriate? | 1.0 (correct), 0.0 (wrong) |
| `sourceCitationEvaluator` | Did agent cite sources for business info? | 1.0 (cited), 0.0 (not cited) |
| `mismatchDetectionEvaluator` | Did agent recognize wrong person/business? | 1.0 (acknowledged), 0.3 (partial), 0.0 (ignored) |
| `retryOfferedEvaluator` | When mismatch detected, offered retry? | 1.0 (yes), 0.0 (no) |
| `reVerificationEvaluator` | When challenged, did agent search again? | 1.0 (searched), 0.0 (ignored) |
| `noDefendEvaluator` | Did agent avoid defensive patterns? | 1.0 (verified), 0.3 (repeated), 0.0 (defensive) |

## Data Flow: Traces -> Scores -> Datasets -> Evals

```
+-------------------------------------------------------------+
|  PRODUCTION TRACE COLLECTION                                |
|                                                             |
|  User Message -> Telegram -> Agent (generateText)           |
|                               |                             |
|                        OpenTelemetry Span                   |
|                               |                             |
|                        Langfuse (stored)                    |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|  PRODUCTION SCORING (src/services/trace-scoring.ts)         |
|                                                             |
|  scoreProductionTrace(traceId, message, callResult) {       |
|    - Detect query type (factual -> check webSearch)         |
|    - Detect mismatch (call result -> check acknowledgment)  |
|    - Detect business info (-> check citation)               |
|    -> Submit scores to Langfuse API                         |
|  }                                                          |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|  DATASET CURATION (curate-voice-call-dataset.ts)            |
|                                                             |
|  Fetch traces where: score.value === 0                      |
|  For each failing trace:                                    |
|    - Determine category from failing score name             |
|    - Build expectedOutput from score                        |
|    - Add to "voice-call-failures-production" dataset        |
|    - Store sourceTraceId linking back to production         |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|  REGRESSION TESTING (run-production-evals.ts)               |
|                                                             |
|  For each curated dataset item:                             |
|    - Replay conversation through agent                      |
|    - Run evaluators on response                             |
|    - Compare to expectedOutput                              |
|    - Report failures for prompt tuning                      |
+-------------------------------------------------------------+
```

## Running Evaluations

### Seed Datasets (One-time Setup)

```bash
# Calendar eval dataset
bun run src/scripts/seed-langfuse-datasets.ts

# Voice call eval dataset
bun run src/scripts/seed-voice-call-datasets.ts

# Production-curated dataset (auto-populated via curation script)
```

### Run LLM Tool Evals

```bash
# Run all evals
bun run src/scripts/run-tool-evals.ts

# Run specific eval type
bun run src/scripts/run-tool-evals.ts calendar
bun run src/scripts/run-tool-evals.ts voice-call

# Change eval model (default: gpt-4o-mini)
EVAL_MODEL=gpt-4o bun run src/scripts/run-tool-evals.ts
```

**Output:**
- Prints pass/fail for each test case
- Summary statistics by category (% passing)
- Option to push results to Langfuse for experiment tracking

### Curate Production Dataset

```bash
# Preview changes (dry-run)
bun run src/scripts/curate-voice-call-dataset.ts --dry-run

# Add failing traces to dataset (look back 7 days by default)
bun run src/scripts/curate-voice-call-dataset.ts

# Look back 14 days
bun run src/scripts/curate-voice-call-dataset.ts --days=14
```

**Process:**
1. Fetches all traces with `score.value === 0` from past N days
2. Groups by failing score name
3. Builds expectedOutput from score metadata
4. Creates dataset items with `sourceTraceId` linking

### Run Production Regression Tests

```bash
# Run against latest production failures
bun run src/scripts/run-production-evals.ts

# Test on different dataset
bun run src/scripts/run-production-evals.ts --dataset=custom-dataset

# Use different model
bun run src/scripts/run-production-evals.ts --model=gpt-4o
```

**Output:**
- Results grouped by category (phone_lookup, call_mismatch, business_info)
- Per-item scores and failure comments
- Aggregate statistics (% passing per evaluator)

## Configuration Reference

### Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `LANGFUSE_PUBLIC_KEY` | Enable tracing | Yes |
| `LANGFUSE_SECRET_KEY` | Enable tracing | Yes |
| `LANGFUSE_BASE_URL` | Langfuse host (default: cloud.langfuse.com) | No |
| `LANGFUSE_DISABLED` | Disable tracing entirely | No |
| `LANGFUSE_SCORING_ENABLED` | Enable production scoring in bot | No |
| `EVAL_MODEL` | Model for evals (default: gpt-4o-mini) | No |

### Dependencies

```json
{
  "@langfuse/client": "^4.5.1",
  "@langfuse/otel": "^4.5.1",
  "@opentelemetry/api": "^1.9.0",
  "@opentelemetry/sdk-trace-node": "^2.2.0",
  "ai": "^6.0.5",
  "@ai-sdk/openai": "^3.0.2"
}
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/instrumentation.ts` | Initialize OpenTelemetry + Langfuse |
| `src/agent/index.ts` | Agent with automatic telemetry |
| `src/adapters/telegram/handlers/message.ts` | Parent span + scoring trigger |
| `src/integrations/langfuse.ts` | Langfuse client singleton |
| `src/services/trace-scoring.ts` | Production quality scoring |
| `src/evals/calendar-evaluators.ts` | Calendar tool evals |
| `src/evals/voice-call-evaluators.ts` | Voice call tool evals |
| `src/scripts/seed-langfuse-datasets.ts` | Seed calendar eval dataset |
| `src/scripts/seed-voice-call-datasets.ts` | Seed voice call eval dataset |
| `src/scripts/run-tool-evals.ts` | Run LLM evals on static datasets |
| `src/scripts/curate-voice-call-dataset.ts` | Extract failing traces -> dataset |
| `src/scripts/run-production-evals.ts` | Regression test on production failures |

## Interpreting Results

### Score Values

| Score | Meaning |
|-------|---------|
| 1.0 | Perfect (behavior matches expectation) |
| 0.5-0.9 | Partial credit (useful but not ideal) |
| 0.0 | Failure (wrong behavior) |

### Common Failure Patterns

| Score | Pattern | Issue | Fix |
|-------|---------|-------|-----|
| `factual_query_searched = 0` | Agent provided business info without searching | Hallucination risk | Strengthen system prompt about search requirements |
| `call_mismatch_handled = 0` | Call reached wrong person but agent didn't acknowledge | Confidence in incorrect info | Add explicit mismatch detection in prompt |
| `source_cited = 0` | Agent provided business info without attribution | User can't verify accuracy | Add citation requirement to system prompt |
| `reverification = 0` | User challenged info and agent defended instead of searching | Stubbornness despite uncertainty | Add "humble verification" pattern to prompt |

## Quality Monitoring Workflow

### Daily/Weekly

1. Production traces accumulate in Langfuse
2. Run curation: `bun run src/scripts/curate-voice-call-dataset.ts --days=7`
3. Failing traces are extracted and linked to production

### Prompt/Code Changes

1. Run regression test: `bun run src/scripts/run-production-evals.ts`
2. Compare scores before/after change
3. If regression, revert and investigate

### Continuous Improvement

1. Review failing items in `voice-call-failures-production` dataset
2. Update system prompt based on patterns
3. Re-run evals to verify fix
4. Monitor production metrics for regression

This architecture provides **closed-loop quality monitoring**: production traces -> automatic scoring -> dataset curation -> regression testing -> prompt improvement.
