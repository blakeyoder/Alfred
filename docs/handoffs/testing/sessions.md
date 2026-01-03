# Testing Project - Session History

This file tracks test coverage planning and implementation for Alfred.

---

## Session: 2026-01-03 (Initial Planning & P0 Implementation)

### Project Context
Alfred is an AI-powered executive assistant for couples. The codebase has extensive tool implementations but minimal test coverage - only `src/lib/datetime.test.ts` existed prior to this session.

### Key Decisions Made

1. **Test Strategy by Stage**:
   - **T1**: Pure function unit tests (no mocking)
   - **T2**: Tool business logic with mocked DB/APIs
   - **T3**: Database query logic tests (focused - only complex queries, not CRUD)
   - **T4**: Integration tests (mock external APIs only)
   - **T5**: Telegram adapter tests

2. **Priority Order** (P0 = critical):
   - P0: Crypto (security), Reminders (core), Privacy constraints
   - P1: Calendar, Reservations, Web search
   - P2: Memory, Agent error handling
   - P3: Telegram adapter

3. **Mocking Boundaries**:
   - Never mock: pure functions, tool execute(), crypto
   - Always mock: External APIs (OpenAI, Google, Parallel)
   - Sometimes mock: DB queries (unit=mock, integration=real)

4. **Stage T3 Scope Refinement**: Per user feedback, T3 focuses only on queries with complex logic (filters, privacy, date comparisons) - not basic CRUD operations.

### Completed Work

1. **Comprehensive test plan** added to `IMPLEMENTATION_PLAN.md` (lines 1005-1553)
   - Critical paths identified
   - ~154 estimated test cases across 10 files
   - Coverage targets by module

2. **crypto.test.ts** - 16 tests (P0)
   - Roundtrip encryption/decryption
   - Error cases: missing key, wrong length, corrupted data
   - Key isolation verification
   - Location: `src/lib/crypto.test.ts`

3. **reservations.test.ts** - 15 tests (P1)
   - Resy, OpenTable, Tock URL parsing
   - Link generation with correct params
   - Error handling for unsupported platforms
   - Location: `src/agent/tools/reservations.test.ts`

### Current State

**All tests passing**: 58 total (16 crypto + 15 reservations + 27 datetime)

```bash
bun run test  # All 58 pass
```

**Test infrastructure**: Jest with ts-jest for ESM, working correctly.

### Remaining Tasks (by priority)

**P0 - Critical**:
- [ ] `src/agent/tools/reminders.test.ts` - Tool tests with mocked DB (~20 tests)
  - Tests `resolveAssignee()` logic (me/partner/both)
  - Tests createReminder, listReminders, completeReminder
- [ ] `src/db/queries/threads.integration.test.ts` - Privacy tests (~8 tests)
  - User A cannot see User B's DM thread
  - User A cannot read User B's DM messages

**P1 - Important**:
- [ ] `src/agent/tools/calendar.test.ts` (~25 tests)
- [ ] `src/agent/tools/web-search.test.ts` (~15 tests)
- [ ] `src/agent/index.test.ts` (~20 tests)

**P2/P3 - Lower priority**:
- [ ] `src/db/queries/reminders.integration.test.ts` (~12 tests)
- [ ] `src/db/queries/memories.integration.test.ts` (~4 tests)
- [ ] `src/adapters/telegram/bot.test.ts` (~25 tests)

### Blockers
None currently.

### Important Files

| File | Purpose |
|------|---------|
| `IMPLEMENTATION_PLAN.md` | Full test plan (search "Test Coverage Plan") |
| `src/lib/crypto.test.ts` | Encryption tests (complete) |
| `src/agent/tools/reservations.test.ts` | URL parsing tests (complete) |
| `src/agent/tools/reminders.ts` | Next file to test |
| `src/db/queries/threads.ts` | Privacy queries to test |

### Testing Patterns Established

**Tool execute testing pattern** (handles AI SDK types):
```typescript
const mockOptions: ToolExecutionOptions = {
  toolCallId: "test-call-id",
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
};

const executeRaw = tools.myTool.execute!;
const execute = async (input: Parameters<typeof executeRaw>[0]): Promise<any> =>
  executeRaw(input, mockOptions);
```

**SessionContext mock**:
```typescript
const mockCtx: ToolContext = {
  session: {
    userId: "user-1",
    coupleId: "couple-1",
    coupleName: "Test Couple",
    userName: "Test User",
    partnerName: "Partner",
    threadId: "thread-1",
    visibility: "shared",
  },
};
```
