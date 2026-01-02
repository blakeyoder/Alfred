# Couples EA - Implementation Plan

## Overview

An AI-powered "Executive Assistant" for couples to coordinate schedules, reminders, budgets, and date planning.

## Tech Stack

| Layer | Choice |
|-------|--------|
| **Runtime** | Node.js + TypeScript |
| **Agent Framework** | Vercel AI SDK (`ai` package) |
| **Memory** | mem0 |
| **Database** | Postgres (Railway) + `postgres` (porsager) |
| **Hosting** | Railway |
| **Observability** | Console logs (MVP), Langfuse (post-MVP) |
| **Google APIs** | Calendar, Sheets (read-only), Auth |

## Architecture

```
CLI / Simple Web UI (MVP)
       │
       ▼
┌─────────────────────┐
│  Agent Core         │
│  (Vercel AI SDK)    │
│                     │───▶ Postgres (Railway)
│  Tools:             │───▶ mem0
│  - reminders        │───▶ Google Calendar API
│  - calendar         │───▶ Google Sheets API (budget, read-only)
│  - date_suggestions │───▶ Google Places API
│  - budget           │
└─────────────────────┘
```

## Project Structure

```
couples-ea/
├── src/
│   ├── cli.ts                # CLI entry point for testing
│   ├── agent/
│   │   ├── index.ts          # Agent loop
│   │   ├── tools/
│   │   │   ├── reminders.ts
│   │   │   ├── calendar.ts
│   │   │   ├── places.ts
│   │   │   ├── budget.ts
│   │   │   └── index.ts
│   │   └── system-prompt.ts
│   ├── memory/
│   │   └── mem0.ts
│   ├── db/
│   │   ├── client.ts         # postgres client
│   │   ├── queries/          # Raw SQL query functions
│   │   │   ├── couples.ts
│   │   │   ├── reminders.ts
│   │   │   └── messages.ts
│   │   └── migrations/       # Raw .sql files
│   │       ├── 001_init.sql
│   │       └── ...
│   └── integrations/
│       ├── google-auth.ts
│       ├── google-calendar.ts
│       └── google-sheets.ts
├── package.json
├── tsconfig.json
└── .env
```

---

## Stages

### Stage 1: Project Foundation
**Goal:** Runnable TypeScript project with basic structure
**Status:** Not Started

**Deliverables:**
- Initialize Node.js + TypeScript project
- Install core dependencies (`ai`, `@ai-sdk/openai`, `postgres`, `dotenv`)
- Create folder structure
- Basic `src/index.ts` entry point
- Environment variable setup (`.env.example`)

**Success Criteria:**
- `npm run dev` prints "Couples EA ready"
- TypeScript compiles without errors

**Tests:**
- Manual: Run `npm run dev` and verify output

---

### Stage 2: Database Setup
**Goal:** Postgres connected with initial schema
**Status:** Not Started

**Deliverables:**
- `postgres` client setup (`src/db/client.ts`)
- Migration runner script (simple, runs `.sql` files in order)
- Initial migration `001_init.sql` with tables:
  - `users`
  - `couples`
  - `couple_members`
  - `conversation_threads`
  - `messages`
  - `reminders`
- Query helpers (`src/db/queries/`)

**Schema:**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  google_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE couple_members (
  couple_id UUID REFERENCES couples(id),
  user_id UUID REFERENCES users(id),
  role TEXT NOT NULL,
  PRIMARY KEY (couple_id, user_id)
);

CREATE TABLE conversation_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID REFERENCES couples(id),
  context_type TEXT DEFAULT 'shared',
  started_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES conversation_threads(id),
  role TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  content TEXT,
  tool_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID REFERENCES couples(id),
  created_by UUID REFERENCES users(id),
  title TEXT NOT NULL,
  notes TEXT,
  due_at TIMESTAMPTZ,
  assigned_to TEXT DEFAULT 'both',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Success Criteria:**
- `npm run migrate` succeeds
- Can connect to Railway Postgres
- Can insert and query test data

**Tests:**
- Manual: Run migration, insert test couple, query it back

---

### Stage 3: Minimal Agent (No Tools)
**Goal:** Chat with an agent that has a couples-focused personality
**Status:** Not Started

**Deliverables:**
- `src/agent/index.ts` - basic agent loop using Vercel AI SDK
- `src/agent/system-prompt.ts` - couples EA personality
- Hardcoded test couple for now (no auth)

**Success Criteria:**
- Can send a message and get a contextually appropriate response
- Agent identifies itself as a couples assistant

**Tests:**
- Manual: Run test script, verify agent responds appropriately

---

### Stage 4: CLI Interface
**Goal:** Interactive REPL for testing the agent
**Status:** Not Started

**Deliverables:**
- `src/cli.ts` - readline-based REPL
- Conversation history maintained in session
- Commands: `/clear`, `/history`, `/exit`

**Success Criteria:**
- Can have multi-turn conversation via CLI
- Commands work as expected
- Graceful exit

**Tests:**
- Manual: Multi-turn conversation, test all commands

---

### Stage 5: mem0 Integration
**Goal:** Agent remembers facts across sessions
**Status:** Not Started

**Deliverables:**
- `src/memory/mem0.ts` - mem0 client wrapper
- Integration into agent loop:
  - Retrieve relevant memories before generating
  - Store new facts after conversation
- Scope memories to couple ID

**Success Criteria:**
- Facts mentioned in one session are recalled in a new session
- Memories are scoped per couple

**Tests:**
- Manual: Tell agent a fact, exit, restart, ask about fact

---

### Stage 6: Reminders Tool
**Goal:** Agent can create, list, and complete reminders
**Status:** Not Started

**Deliverables:**
- `src/agent/tools/reminders.ts`:
  - `createReminder(title, dueAt?, assignedTo?, notes?)`
  - `listReminders(filter?, assignedTo?)`
  - `completeReminder(reminderId)`
- `src/db/queries/reminders.ts` - SQL queries
- Register tools with agent

**Success Criteria:**
- Can create reminder via natural language
- Can list reminders
- Can mark reminder complete
- Reminders persist in database

**Tests:**
- Manual: Create, list, complete reminders via CLI

---

### Stage 7: Google Auth Setup
**Goal:** OAuth2 flow for Google services
**Status:** Not Started

**Deliverables:**
- Google Cloud project setup (Calendar API, Sheets API enabled)
- `src/integrations/google-auth.ts` - OAuth2 client
- Token storage in Postgres (`google_tokens` table)
- CLI command to initiate auth flow: `/auth google`

**Migration:**
```sql
CREATE TABLE google_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT[],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Success Criteria:**
- `/auth google` opens browser for OAuth
- Token stored after successful auth
- Token refresh works

**Tests:**
- Manual: Complete OAuth flow, verify token stored

---

### Stage 8: Calendar Tools
**Goal:** Agent can read and create calendar events
**Status:** Not Started

**Deliverables:**
- `src/integrations/google-calendar.ts` - Calendar API wrapper
- `src/agent/tools/calendar.ts`:
  - `getCalendarEvents(startDate, endDate, whose?)`
  - `findFreeTime(startDate, endDate, minDurationMinutes?)`
  - `createCalendarEvent(title, startTime, endTime, description?, whose?)`

**Success Criteria:**
- Can query calendar events
- Can find overlapping free time
- Can create events on one or both calendars

**Tests:**
- Manual: Query events, find free time, create event via CLI

---

### Stage 9: Budget Tools (Google Sheets)
**Goal:** Agent can query budget spreadsheet (read-only)
**Status:** Not Started

**Deliverables:**
- `src/integrations/google-sheets.ts` - Sheets API wrapper
- `src/agent/tools/budget.ts`:
  - `getBudgetSummary(month?)`
  - `getBudgetTransactions(category?, limit?)`
  - `checkBudgetForPurchase(amount, category)`
- Config for spreadsheet ID and sheet structure

**Success Criteria:**
- Can get budget summary
- Can query transactions
- Can check if purchase fits budget

**Tests:**
- Manual: Query budget, check purchase affordability via CLI

---

### Stage 10: Places/Date Suggestions Tool
**Goal:** Agent can search for restaurants and date ideas
**Status:** Not Started

**Deliverables:**
- `src/integrations/google-places.ts` - Places API wrapper
- `src/agent/tools/places.ts`:
  - `searchPlaces(query, type?, priceLevel?, location?, radius?)`
  - `getPlaceDetails(placeId)`

**Success Criteria:**
- Can search for restaurants/activities
- Can get detailed place information
- Results include ratings, price level, location

**Tests:**
- Manual: Search for restaurants, get details via CLI

---

### Stage 11: Conversation Persistence
**Goal:** Conversations saved to DB, can resume across sessions
**Status:** Not Started

**Deliverables:**
- Save messages to `messages` table
- Load conversation history on CLI start
- `/threads` command to list/switch conversations

**Success Criteria:**
- Messages persist across CLI sessions
- Can view and switch between threads

**Tests:**
- Manual: Start conversation, exit, restart, verify continuity

---

### Stage 12: Telegram Adapter
**Goal:** Same agent accessible via Telegram
**Status:** Not Started

**Deliverables:**
- `src/platforms/telegram.ts` - webhook handler
- Telegram bot setup (BotFather)
- User linking (Telegram ID → User record)
- Group chat support (shared context)
- DM support (private context)

**Success Criteria:**
- Bot responds in Telegram group
- DMs are private to individual user
- Same agent capabilities as CLI

**Tests:**
- Manual: Test group and DM interactions

---

## Post-MVP Features

| Feature | Description |
|---------|-------------|
| **Langfuse** | Add observability, tracing, cost tracking |
| **Proactive messaging** | Cron job for reminders, anniversary nudges |
| **Web UI** | Next.js dashboard with chat + visualizations |
| **Voice** | Telegram voice messages → transcription |
| **Shared lists** | Grocery lists, gift ideas, bucket list |
| **Conflict detection** | Notice tension patterns, suggest check-ins |

---

## Open Questions / Risks

1. **Budget spreadsheet structure** - Need to confirm actual structure of existing Google Sheet
2. **Google API quotas** - Places API has costs after free tier
3. **mem0 pricing** - Need to evaluate for production use
4. **Multi-calendar complexity** - Handling multiple calendars per person
5. **Telegram rate limits** - May need queue for high-volume scenarios

---

## Dependencies

- OpenAI API key
- Railway account + Postgres addon
- Google Cloud project with APIs enabled:
  - Google Calendar API
  - Google Sheets API
  - Google Places API
- mem0 API key
- Telegram Bot Token (Stage 12)
