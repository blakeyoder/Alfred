# Couples EA - Implementation Plan

## Overview

An AI-powered "Executive Assistant" for couples to coordinate schedules, reminders, budgets, and date planning.

## Tech Stack

| Layer | Choice |
|-------|--------|
| **Runtime** | Node.js + TypeScript |
| **Agent Framework** | Vercel AI SDK (`ai` package) |
| **Memory** | Postgres (recent context) - mem0 deferred to post-MVP |
| **Database** | Postgres (Railway) + `postgres` (porsager) |
| **Hosting** | Railway |
| **Observability** | Console logs (MVP), Langfuse (post-MVP) |
| **Google APIs** | Calendar, Sheets (read-only), Auth |
| **Token Security** | Encrypted at rest |

## Architecture

```
CLI (MVP) → Telegram (post-MVP)
       │
       ▼
┌─────────────────────┐
│  Agent Core         │
│  (Vercel AI SDK)    │
│                     │───▶ Postgres (Railway)
│  Tools:             │     - Users, couples, threads
│  - reminders        │     - Messages (context window)
│  - calendar         │     - Encrypted Google tokens
│                     │
│  Post-MVP Tools:    │───▶ Google Calendar API
│  - budget           │───▶ Google Sheets API (read-only)
│  - places           │───▶ Google Places API
└─────────────────────┘
```

## Project Structure

```
couples-ea/
├── src/
│   ├── index.ts              # Entry point
│   ├── cli.ts                # CLI REPL for testing
│   ├── agent/
│   │   ├── index.ts          # Agent loop
│   │   ├── tools/
│   │   │   ├── reminders.ts
│   │   │   ├── calendar.ts
│   │   │   └── index.ts
│   │   └── system-prompt.ts
│   ├── session/
│   │   └── store.ts          # Session persistence
│   ├── db/
│   │   ├── client.ts         # postgres client
│   │   ├── queries/
│   │   │   ├── users.ts
│   │   │   ├── couples.ts
│   │   │   ├── threads.ts
│   │   │   ├── messages.ts
│   │   │   └── reminders.ts
│   │   └── migrations/
│   │       ├── 001_init.sql
│   │       ├── 002_google_tokens.sql
│   │       └── migrate.ts
│   ├── integrations/
│   │   ├── google-auth.ts
│   │   └── google-calendar.ts
│   └── lib/
│       └── crypto.ts         # Token encryption helpers
├── scripts/
│   └── seed-demo.ts          # Demo data seeder
├── package.json
├── tsconfig.json
└── .env.example
```

---

## MVP Stages (8 stages)

### Stage 1: Project Foundation
**Goal:** Runnable TypeScript project with basic structure
**Status:** Complete

**Deliverables:**
- Initialize Node.js + TypeScript project
- Install core dependencies:
  - `ai`, `@ai-sdk/openai` - Agent framework
  - `postgres` - Database client
  - `dotenv` - Environment variables
  - `zod` - Schema validation
- Create folder structure
- Basic `src/index.ts` entry point
- `.env.example` with required variables

**Success Criteria:**
- [x] `npm run dev` prints "Couples EA ready"
- [x] TypeScript compiles without errors
- [x] All folders exist per structure above

**Tests:**
- `npm run build` succeeds
- `npm run dev` outputs expected message

---

### Stage 2: Database Setup
**Goal:** Postgres connected with initial schema including privacy support
**Status:** Complete

**Deliverables:**
- `src/db/client.ts` - postgres client setup
- `src/db/migrations/migrate.ts` - runs `.sql` files in order
- `src/db/migrations/001_init.sql` with tables:
  - `users` - individual accounts
  - `couples` - couple entity
  - `couple_members` - links users to couples
  - `conversation_threads` - with visibility (shared/dm)
  - `conversation_participants` - access control
  - `messages` - conversation history
  - `reminders` - task tracking
- Basic query helpers in `src/db/queries/`

**Schema:**
```sql
-- 001_init.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
  couple_id UUID REFERENCES couples(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('partner1', 'partner2')),
  PRIMARY KEY (couple_id, user_id)
);

CREATE TABLE conversation_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID REFERENCES couples(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'dm')),
  dm_owner_user_id UUID REFERENCES users(id),
  started_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT visibility_dm_owner_check CHECK (
    (visibility = 'shared' AND dm_owner_user_id IS NULL) OR
    (visibility = 'dm' AND dm_owner_user_id IS NOT NULL)
  )
);

CREATE TABLE conversation_participants (
  thread_id UUID REFERENCES conversation_threads(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'participant',
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX idx_conversation_participants_user ON conversation_participants(user_id);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES conversation_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  user_id UUID REFERENCES users(id),
  content TEXT,
  tool_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);

CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID REFERENCES couples(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  title TEXT NOT NULL,
  notes TEXT,
  due_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES users(id), -- NULL means both
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reminders_couple ON reminders(couple_id, completed_at);
```

**Success Criteria:**
- [x] `npm run migrate` succeeds
- [x] Can connect to Postgres (Docker local)
- [x] Constraints enforced (visibility check works)
- [x] Can insert and query test data

**Tests:**
- Migration runs idempotently (can run twice without error)
- Insert shared thread without dm_owner succeeds
- Insert dm thread without dm_owner fails (constraint)
- Insert dm thread with dm_owner succeeds

---

### Stage 3: Minimal Agent (No Tools)
**Goal:** Chat with an agent that has a couples-focused personality
**Status:** Complete

**Deliverables:**
- `src/agent/index.ts` - basic agent loop using Vercel AI SDK
- `src/agent/system-prompt.ts` - couples EA personality
- Test script to verify agent responds

**Agent Loop Pattern:**
```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { systemPrompt } from './system-prompt';

interface SessionContext {
  userId: string;
  coupleId: string;
  threadId: string;
  visibility: 'shared' | 'dm';
}

export async function chat(
  message: string,
  history: Message[],
  context: SessionContext
) {
  const result = await generateText({
    model: openai('gpt-4o'),
    system: systemPrompt(context),
    messages: [...history, { role: 'user', content: message }],
  });

  return result.text;
}
```

**System Prompt (v1):**
```typescript
export const systemPrompt = (ctx: SessionContext) => `
You are an AI assistant helping a couple coordinate their lives together.
You help with scheduling, reminders, date planning, and staying organized.

You are warm but efficient. You remember context from the conversation.
${ctx.visibility === 'dm' ? 'This is a private conversation - be discreet about surprises or gifts.' : ''}

Current date: ${new Date().toISOString().split('T')[0]}
`;
```

**Success Criteria:**
- [ ] Can send a message and get contextually appropriate response
- [ ] Agent identifies itself as a couples assistant
- [ ] System prompt includes current date

**Tests:**
- Test script sends "What can you help with?" and gets relevant response
- DM context includes privacy note in system prompt

---

### Stage 3.5: User & Session Management
**Goal:** Bridge from hardcoded test couple to real DB-backed users
**Status:** Complete

**Deliverables:**
- `scripts/seed-demo.ts` - creates demo data:
  - Two users (blake@example.com, partner@example.com)
  - One couple linking them
  - One shared thread
  - One DM thread per user
- `src/session/store.ts` - persists session to `~/.couplesea/session.json`:
  ```typescript
  interface Session {
    userId: string;
    coupleId: string;
    activeThreadId: string;
    visibility: 'shared' | 'dm';
  }
  ```
- `src/db/queries/users.ts` - user lookup/creation
- `src/db/queries/couples.ts` - couple management
- CLI commands: `/whoami`, `/switch-user <email>`, `/switch-thread`

**Success Criteria:**
- [ ] `npm run seed:demo` creates valid test data
- [ ] `/whoami` shows current user and couple
- [ ] `/switch-user` changes active identity
- [ ] Session persists across CLI restarts

**Tests:**
- Unit: `resolveActiveCouple(userId)` returns correct couple
- Integration: Session file survives CLI restart
- `/switch-user` updates session and subsequent messages use new identity

---

### Stage 4: CLI Interface
**Goal:** Interactive REPL for testing the agent
**Status:** Complete

**Deliverables:**
- `src/cli.ts` - readline-based REPL
- In-memory conversation history (persisted in Stage 5)
- Commands:
  - `/help` - list commands
  - `/clear` - clear conversation
  - `/history` - show recent messages
  - `/whoami` - show current user/couple
  - `/switch-user <email>` - change identity
  - `/switch-thread` - list and switch threads
  - `/exit` - quit

**Interface:**
```
$ npm run cli

🤝 Couples EA (dev mode)
Logged in as: blake@example.com
Couple: Blake & Partner
Thread: shared

Type /help for commands, /exit to quit

You: Hey, what can you help with?
EA: Hey! I can help you and your partner stay organized...

You: /whoami
User: blake@example.com
Couple: Blake & Partner (id: xxx)
Thread: shared (id: xxx)

You: /exit
Bye!
```

**Success Criteria:**
- [ ] Can have multi-turn conversation via CLI
- [ ] All commands work as expected
- [ ] Graceful exit on /exit or Ctrl+C

**Tests:**
- Multi-turn conversation maintains context
- `/clear` resets conversation
- `/switch-user` changes identity shown in `/whoami`

---

### Stage 5: Conversation Persistence
**Goal:** Conversations saved to DB, resume across sessions
**Status:** Complete

**Deliverables:**
- `src/db/queries/messages.ts`:
  - `saveMessage(threadId, role, content, userId?, toolCalls?)`
  - `getMessages(threadId, limit?)` - respects participant access
  - `getThreadsForUser(userId)` - only threads user participates in
- `src/db/queries/threads.ts`:
  - `createThread(coupleId, visibility, dmOwnerId?)`
  - `addParticipant(threadId, userId)`
- Load conversation history on CLI start
- Save each message as it's sent/received
- `/threads` command to list and switch

**Privacy Enforcement:**
```typescript
// Only return threads user participates in
export const getThreadsForUser = (userId: string) => sql`
  SELECT t.* FROM conversation_threads t
  JOIN conversation_participants cp ON cp.thread_id = t.id
  WHERE cp.user_id = ${userId}
  ORDER BY t.created_at DESC
`;

// Only return messages from threads user can access
export const getMessages = (userId: string, threadId: string, limit = 50) => sql`
  SELECT m.* FROM messages m
  JOIN conversation_participants cp ON cp.thread_id = m.thread_id
  WHERE cp.user_id = ${userId}
    AND m.thread_id = ${threadId}
  ORDER BY m.created_at DESC
  LIMIT ${limit}
`;
```

**Success Criteria:**
- [ ] Messages persist across CLI sessions
- [ ] Can list threads with `/threads`
- [ ] Can switch between threads
- [ ] DM threads only visible to owner
- [ ] Shared threads visible to both partners

**Tests:**
- Start conversation, exit, restart - history loads
- User A cannot see User B's DM thread
- Both users can see shared thread

---

### Stage 6: Reminders Tool
**Goal:** Agent can create, list, and complete reminders
**Status:** Complete

**Deliverables:**
- `src/agent/tools/reminders.ts`:
  ```typescript
  const tools = {
    createReminder: tool({
      description: 'Create a reminder for one or both partners',
      parameters: z.object({
        title: z.string().describe('What to remember'),
        dueAt: z.string().optional().describe('ISO datetime when due'),
        assignedTo: z.enum(['me', 'partner', 'both']).optional(),
        notes: z.string().optional(),
      }),
      execute: async (args, { context }) => { ... }
    }),

    listReminders: tool({
      description: 'List upcoming or overdue reminders',
      parameters: z.object({
        filter: z.enum(['upcoming', 'overdue', 'all']).optional(),
        assignedTo: z.enum(['me', 'partner', 'both']).optional(),
      }),
      execute: async (args, { context }) => { ... }
    }),

    completeReminder: tool({
      description: 'Mark a reminder as complete',
      parameters: z.object({
        reminderId: z.string().describe('ID of reminder to complete'),
      }),
      execute: async (args, { context }) => { ... }
    }),
  };
  ```
- `src/db/queries/reminders.ts` - CRUD operations
- Register tools with agent

**Success Criteria:**
- [ ] Can create reminder via natural language
- [ ] Can list reminders (filtered)
- [ ] Can mark reminder complete
- [ ] Reminders persist in database
- [ ] "me"/"partner" resolved from context

**Tests:**
- "Remind me to buy milk tomorrow" creates reminder with correct due date
- "What reminders do we have?" lists all reminders
- "Mark the milk reminder as done" completes it
- Invalid reminder ID returns graceful error

---

### Stage 7: Google Auth Setup
**Goal:** OAuth2 Device Authorization flow for Google services
**Status:** Complete

**Deliverables:**
- Google Cloud project setup:
  - Enable Calendar API
  - Enable Sheets API (for post-MVP)
  - Create OAuth 2.0 credentials (Desktop app type)
- `src/lib/crypto.ts` - encryption helpers using `ENCRYPTION_KEY` env var
- `src/integrations/google-auth.ts`:
  - Device Authorization Grant flow
  - Token storage with encryption
  - Automatic token refresh
- `src/db/migrations/002_google_tokens.sql`
- CLI command `/auth google`

**Migration:**
```sql
-- 002_google_tokens.sql
CREATE TABLE google_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT[],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Device Flow:**
```typescript
// 1. Request device code
const deviceResponse = await fetch('https://oauth2.googleapis.com/device/code', {
  method: 'POST',
  body: new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/spreadsheets.readonly',
  }),
});
const { device_code, user_code, verification_url } = await deviceResponse.json();

// 2. Display to user
console.log(`Go to ${verification_url} and enter code: ${user_code}`);

// 3. Poll for authorization
while (!authorized) {
  await sleep(interval * 1000);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  // Handle response...
}

// 4. Encrypt and store tokens
await storeTokens(userId, encrypt(access_token), encrypt(refresh_token), expires_at);
```

**Encryption:**
```typescript
// src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(data: string): string {
  const buf = Buffer.from(data, 'base64');
  const iv = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

**Success Criteria:**
- [ ] `/auth google` displays device code and URL
- [ ] Completing OAuth stores encrypted tokens
- [ ] `getAuthorizedClient(userId)` returns working client
- [ ] Token refresh works automatically
- [ ] Missing/expired tokens prompt re-auth

**Tests:**
- Encrypt/decrypt roundtrip works
- Expired token triggers refresh
- Invalid refresh token prompts re-auth message

---

### Stage 8: Calendar Tools
**Goal:** Agent can read and create calendar events
**Status:** Complete

**Deliverables:**
- `src/integrations/google-calendar.ts`:
  - `getEvents(userId, startDate, endDate)`
  - `createEvent(userId, event)`
  - `findFreeTime(user1Id, user2Id, startDate, endDate, minDuration)`
- `src/agent/tools/calendar.ts`:
  ```typescript
  const tools = {
    getCalendarEvents: tool({
      description: 'Get calendar events in a date range',
      parameters: z.object({
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        whose: z.enum(['me', 'partner', 'both']).optional(),
      }),
      execute: async (args, { context }) => { ... }
    }),

    findFreeTime: tool({
      description: 'Find when both partners are free',
      parameters: z.object({
        startDate: z.string(),
        endDate: z.string(),
        minDurationMinutes: z.number().optional().default(60),
      }),
      execute: async (args, { context }) => { ... }
    }),

    createCalendarEvent: tool({
      description: 'Create a calendar event',
      parameters: z.object({
        title: z.string(),
        startTime: z.string().describe('ISO datetime'),
        endTime: z.string().describe('ISO datetime'),
        description: z.string().optional(),
        whose: z.enum(['me', 'partner', 'both']).optional(),
      }),
      execute: async (args, { context }) => { ... }
    }),
  };
  ```

**Success Criteria:**
- [ ] Can query calendar events for date range
- [ ] Can find overlapping free time for both partners
- [ ] Can create events on one or both calendars
- [ ] Handles missing Google auth gracefully

**Tests:**
- "What's on my calendar this week?" returns events
- "When are we both free Saturday?" finds overlap
- "Book date night Saturday 7pm" creates event
- Unauthenticated user gets helpful error message

---

## Post-MVP: Telegram Adapter

### Stage 9: Telegram Foundation
**Goal:** Basic Telegram polling service that receives messages
**Status:** Not Started

**Deliverables:**
- Install `telegraf` library (popular, well-maintained Telegram bot framework)
- `src/adapters/telegram/bot.ts` - Bot initialization and configuration
- `src/adapters/telegram/polling.ts` - Long-polling update handler for local dev
- `npm run telegram` script to start bot
- Verify bot responds to `/start` command

**Bot Setup:**
```typescript
// src/adapters/telegram/bot.ts
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

bot.start((ctx) => ctx.reply('Welcome! Use /link to connect your account.'));
bot.help((ctx) => ctx.reply('Commands:\n/link - Link your account\n/status - Check connection'));

export { bot };
```

**Success Criteria:**
- [x] `npm run telegram` starts bot without errors
- [x] Bot responds to `/start` in Telegram app
- [x] Graceful shutdown on Ctrl+C

**Tests:**
- Bot token validation on startup
- `/start` command responds correctly

---

### Stage 10: User Linking
**Goal:** Link Telegram accounts to existing database users
**Status:** Not Started

**Deliverables:**
- `src/db/migrations/003_telegram_users.sql`:
  ```sql
  ALTER TABLE users ADD COLUMN telegram_id BIGINT UNIQUE;

  CREATE TABLE telegram_link_codes (
    code TEXT PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
  );

  CREATE INDEX idx_telegram_link_codes_user ON telegram_link_codes(user_id);
  ```
- `src/db/queries/telegram.ts`:
  - `getUserByTelegramId(telegramId)`
  - `createLinkCode(userId)` - generates 6-char code, expires in 10 min
  - `linkTelegramAccount(code, telegramId)` - validates code, updates user
- CLI command `/telegram-link` - generates and displays link code
- Telegram `/link <code>` command - links account

**Linking Flow:**
```
1. User runs /telegram-link in CLI
   → CLI shows: "Your code: ABC123 (expires in 10 min)"

2. User opens Telegram, sends /link ABC123 to bot
   → Bot validates code, links telegram_id to user
   → Bot replies: "Linked! You're connected as blake@example.com"

3. Future messages from that Telegram ID are associated with the user
```

**Success Criteria:**
- [ ] `/telegram-link` generates unique 6-char code
- [ ] `/link <code>` in Telegram links account
- [ ] Invalid/expired codes are rejected
- [ ] Already-linked accounts handled gracefully

**Tests:**
- Link code expires after 10 minutes
- Duplicate telegram_id rejected
- Valid link code consumed (can't reuse)

---

### Stage 11: Message Routing
**Goal:** Route Telegram messages to the existing agent
**Status:** Not Started

**Deliverables:**
- `src/adapters/telegram/handler.ts`:
  - `handleTextMessage(ctx)` - routes message to agent
  - Session resolution from telegram_id
  - Response formatting for Telegram (markdown, length limits)
- Thread selection logic:
  - Default to shared thread for linked users
  - Future: group chats = shared, DMs = dm threads
- `src/db/queries/telegram.ts` additions:
  - `getOrCreateTelegramSession(telegramId)` - resolves user, couple, thread
- Typing indicator while agent processes
- Error handling with user-friendly messages

**Message Flow:**
```typescript
// src/adapters/telegram/handler.ts
bot.on('text', async (ctx) => {
  const telegramId = ctx.from.id;

  // 1. Resolve user from telegram_id
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return ctx.reply('Please link your account first with /link <code>');
  }

  // 2. Get session context (couple, thread, partner)
  const session = await getOrCreateTelegramSession(user.id);

  // 3. Load conversation history
  const history = await getRecentMessagesForContext(session.threadId, 50);

  // 4. Show typing indicator
  await ctx.sendChatAction('typing');

  // 5. Call existing agent
  const result = await chat(ctx.message.text, {
    context: session.context,
    history,
    partnerId: session.partnerId,
  });

  // 6. Save messages to DB
  await saveMessage(session.threadId, 'user', ctx.message.text, user.id);
  await saveMessage(session.threadId, 'assistant', result.text);

  // 7. Reply (handle Telegram's 4096 char limit)
  await sendChunkedReply(ctx, result.text);
});
```

**Success Criteria:**
- [ ] Linked users can chat via Telegram
- [ ] Agent tools (reminders, calendar) work from Telegram
- [ ] Long responses are split correctly
- [ ] Unlinked users get helpful error message
- [ ] Conversation history persists across sessions

**Tests:**
- "Create a reminder" via Telegram creates reminder in DB
- Response over 4096 chars is split into multiple messages
- Two users in same couple share conversation context

---

### Stage 12: Telegram Commands & UX
**Goal:** Polish the Telegram experience with commands and formatting
**Status:** Not Started

**Deliverables:**
- Telegram command menu via BotFather:
  - `/start` - Welcome and link instructions
  - `/link <code>` - Link account
  - `/status` - Show current user, couple, thread
  - `/thread` - Switch between shared/dm threads
  - `/unlink` - Disconnect Telegram account
- Rich formatting for agent responses:
  - Markdown escaping for Telegram's MarkdownV2
  - Bold/italic for emphasis
  - Code blocks for technical content
- Error messages with emoji for clarity
- Graceful handling of photos/stickers/etc (unsupported message types)

**Success Criteria:**
- [ ] All commands work as expected
- [ ] Command menu appears in Telegram
- [ ] Formatting renders correctly
- [ ] Non-text messages get friendly "not supported" reply

**Tests:**
- `/status` shows correct user info
- `/thread` switches visibility
- Markdown in agent response renders correctly

---

### Stage 13: Production Readiness (Webhooks)
**Goal:** Switch from polling to webhooks for production deployment
**Status:** Not Started

**Deliverables:**
- `src/adapters/telegram/webhook.ts`:
  - Express/Fastify route for Telegram webhook
  - Webhook secret validation
  - `setWebhook` API call on startup
- Environment-based switching:
  - `NODE_ENV=development` → polling
  - `NODE_ENV=production` → webhook
- Railway deployment config
- Health check endpoint
- Rate limiting considerations

**Webhook Setup:**
```typescript
// Production webhook handler (e.g., with Express)
app.post('/webhook/telegram', async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// On startup
if (process.env.NODE_ENV === 'production') {
  await bot.telegram.setWebhook(`${process.env.APP_URL}/webhook/telegram`);
}
```

**Success Criteria:**
- [ ] Webhooks work on Railway
- [ ] Polling works locally without changes
- [ ] Webhook secret prevents unauthorized requests
- [ ] Bot recovers from temporary outages

**Tests:**
- Webhook endpoint responds correctly
- Invalid webhook secret rejected
- Health check returns 200

---

## mem0 Memory System

> **📄 Detailed specification: [docs/MEM0_IMPLEMENTATION.md](docs/MEM0_IMPLEMENTATION.md)**

Long-term semantic memory for Alfred using mem0 Cloud. Enables the assistant to remember facts, relationships, and context across conversations.

### Design Summary

| Aspect | Decision |
|--------|----------|
| **Scope** | Individual + couple memories |
| **DM Privacy** | Completely hidden from partner |
| **Cross-partner** | Proactive sharing allowed |
| **Creation** | Auto-extract + explicit "remember this" |
| **Retrieval** | Selective (only when context needed) |
| **Transparency** | Always cite when using memories |
| **Commands** | Conversational only (no /memory) |
| **Deployment** | mem0 Cloud |
| **Latency** | < 500ms budget |

### Stages Overview

| Stage | Name | Goal | Status |
|-------|------|------|--------|
| 14 | mem0 Client & Schema | Client wrapper, DB migration, CRUD operations | Complete |
| 15 | Memory Retrieval | Inject memories into agent context with privacy filtering | Complete |
| 16 | Memory Extraction | Auto-extract + explicit "remember" with confirmation | Complete |
| 17 | Updates & Conflicts | Conflict detection, corrections, soft decay, ambiguity | Complete |
| 18 | Cross-Partner | Proactive partner sharing + calendar event memory | Complete |

### File Changes

| File | Change |
|------|--------|
| `src/integrations/mem0.ts` | New - mem0 client wrapper |
| `src/types/memory.ts` | New - Memory interfaces |
| `src/db/migrations/007_memories.sql` | New - memories table |
| `src/db/queries/memories.ts` | New - memory CRUD operations |
| `src/agent/memory-context.ts` | New - retrieval logic |
| `src/agent/memory-extraction.ts` | New - extraction logic |
| `src/agent/memory-conflicts.ts` | New - conflict resolution |
| `src/agent/memory-ambiguity.ts` | New - ambiguity handling |
| `src/agent/index.ts` | Modified - integrate memory hooks |
| `src/agent/system-prompt.ts` | Modified - include memory context |
| `src/agent/tools/calendar.ts` | Modified - extract event memories |

### Environment Variable

```bash
MEM0_API_KEY=m0-...  # Get from https://app.mem0.ai
```

---

## Post-Memory Features

| Priority | Feature | Description |
|----------|---------|-------------|
| 3 | **Budget Tools** | Google Sheets read-only integration |
| 4 | **Places Tool** | Google Places API for date suggestions |
| 5 | **Langfuse** | Observability, tracing, cost tracking |
| 6 | **Proactive Messaging** | Cron for reminders, anniversary nudges |
| 7 | **Web UI** | Next.js dashboard |

---

## Environment Variables

```bash
# .env.example

# Database
DATABASE_URL=postgres://user:pass@host:5432/db

# OpenAI
OPENAI_API_KEY=sk-...

# Encryption (generate with: openssl rand -hex 32)
ENCRYPTION_KEY=...

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# mem0 (get from https://app.mem0.ai)
MEM0_API_KEY=...
```

---

## Summary

```
MVP (Complete):
Stage 1:   [Foundation]        → npm run dev works
Stage 2:   [Database]          → Schema with privacy constraints
Stage 3:   [Minimal Agent]     → Can chat (no tools)
Stage 3.5: [User/Session]      → Real users, session persistence
Stage 4:   [CLI]               → Interactive testing
Stage 5:   [Persistence]       → Conversations saved
Stage 6:   [Reminders]         → First useful tool
Stage 7:   [Google Auth]       → OAuth with encrypted tokens
Stage 8:   [Calendar]          → Schedule coordination
           ─────────────────────────────────────────────
Post-MVP - Telegram Adapter:
Stage 9:   [Telegram Found.]   → Bot polling, /start command
Stage 10:  [User Linking]      → Link Telegram ID to DB users
Stage 11:  [Message Routing]   → Chat via Telegram using agent
Stage 12:  [Commands & UX]     → Polish, formatting, /status
Stage 13:  [Prod Readiness]    → Webhooks for Railway deployment
           ─────────────────────────────────────────────
mem0 Memory System (Complete):
Stage 14:  [mem0 Client]       → Client wrapper + DB schema ✓
Stage 15:  [Retrieval]         → Inject memories into agent context ✓
Stage 16:  [Extraction]        → Auto-extract + explicit "remember" ✓
Stage 17:  [Updates]           → Conflicts, corrections, decay ✓
Stage 18:  [Cross-Partner]     → Proactive sharing + calendar integration ✓
           ─────────────────────────────────────────────
           FUTURE: Budget, Places, Langfuse, Web UI, etc.
```

---

## Open Questions

1. ~~Token encryption~~ → Encrypt from day 1 ✓
2. ~~mem0 vs Postgres~~ → mem0 Cloud with Postgres backup ✓
3. **Budget spreadsheet structure** - Define before implementing budget tool
4. **Multi-calendar support** - Assume one primary calendar per user for MVP
5. ~~mem0 memory design~~ → Fully specified in Stages 14-18 ✓

---

## Test Coverage Plan

### Overview

Current state: Only `src/lib/datetime.test.ts` exists (~47 test cases). This plan establishes comprehensive test coverage following TDD principles and avoiding anti-patterns.

### Critical Paths (Priority Order)

| Priority | Path | Risk | Coverage Goal |
|----------|------|------|---------------|
| **P0** | Reminder CRUD operations | Core functionality | 95% |
| **P0** | Assignee resolution (me/partner/both) | User-visible bugs | 100% |
| **P0** | Encryption/decryption | Security-critical | 100% |
| **P1** | Calendar event creation | Data integrity | 90% |
| **P1** | Reservation link generation | User-facing URLs | 100% |
| **P1** | Web search query handling | External API | 90% |
| **P2** | Memory extraction/storage | Feature quality | 85% |
| **P2** | Agent error handling | User experience | 90% |
| **P3** | Telegram message routing | Adapter layer | 80% |

---

### Stage T1: Pure Function Unit Tests
**Goal:** Test all pure functions with no external dependencies
**Status:** Not Started

**Files to Create:**

#### `src/lib/crypto.test.ts`
```typescript
// Critical: Encryption is security-critical
describe('encrypt/decrypt', () => {
  // Happy path
  it('roundtrips arbitrary text correctly');
  it('produces different ciphertext for same plaintext (random IV)');
  it('produces base64 output');

  // Error cases
  it('throws when ENCRYPTION_KEY is missing');
  it('throws when ENCRYPTION_KEY is wrong length');
  it('throws when decrypting invalid base64');
  it('throws when decrypting truncated data');
  it('throws when auth tag is corrupted');
});
```

#### `src/agent/tools/reservations.test.ts`
```typescript
// Pure URL parsing and generation - no mocking needed
describe('parseRestaurantUrl', () => {
  describe('Resy URLs', () => {
    it('parses resy.com/cities/{city}/venues/{slug}');
    it('parses resy.com with query params');
    it('extracts city and slug correctly');
  });

  describe('OpenTable URLs', () => {
    it('parses opentable.com/r/{slug}');
    it('parses opentable.com/{slug} without /r prefix');
  });

  describe('Tock URLs', () => {
    it('parses exploretock.com/{slug}');
    it('parses tock.com/{slug}');
  });

  it('returns unknown for unsupported domains');
});

describe('generateResyLink', () => {
  it('includes date and seats params');
  it('preserves city in URL when available');
});

describe('generateOpenTableLink', () => {
  it('formats dateTime as YYYY-MM-DDTHH:MM');
  it('includes covers param');
});

describe('generateTockLink', () => {
  it('includes date, size, and time params');
});
```

#### `src/agent/tools/web-search.test.ts` (partial)
```typescript
describe('isRestaurantQuery', () => {
  it('returns true for "best restaurants"');
  it('returns true for "sushi near me"');
  it('returns true for singular forms like "restaurant"');
  it('returns false for "best laptops"');
  it('returns false for "weather forecast"');
});

describe('formatSearchResult', () => {
  it('formats result with all fields');
  it('handles missing title');
  it('handles missing excerpts');
  it('uses 1-based index');
});
```

**Success Criteria:**
- [ ] All pure functions have tests
- [ ] No mocking required
- [ ] 100% line coverage on crypto.ts
- [ ] All edge cases covered

---

### Stage T2: Tool Business Logic Tests
**Goal:** Test tool execute functions with mocked DB/API calls
**Status:** Not Started

**Mocking Strategy:**
- Mock database queries at the module level
- Mock external API clients (Parallel, Google)
- DO NOT mock the tool function itself
- Test the REAL execute function with fake data

**Files to Create:**

#### `src/agent/tools/reminders.test.ts`
```typescript
// Mock the DB queries, not the tool
jest.mock('../../db/queries/reminders.js');

describe('createReminderTools', () => {
  const mockCtx = {
    session: {
      userId: 'user-1',
      coupleId: 'couple-1',
      partnerName: 'Partner',
      threadId: 'thread-1',
      visibility: 'shared' as const,
    },
  };
  const partnerId = 'partner-1';

  beforeEach(() => jest.clearAllMocks());

  describe('resolveAssignee', () => {
    // This is a helper function - test via tool behavior
    it('assigns to user when "me"');
    it('assigns to partner when "partner"');
    it('assigns to undefined when "both"');
    it('assigns to undefined when no assignee specified');
  });

  describe('createReminder tool', () => {
    it('creates reminder with title only');
    it('creates reminder with due date parsed as Eastern');
    it('creates reminder assigned to "me"');
    it('creates reminder assigned to "partner"');
    it('returns success with reminder ID');
  });

  describe('listReminders tool', () => {
    it('lists all reminders by default');
    it('filters by upcoming');
    it('filters by overdue');
    it('filters by assignedTo');
    it('returns empty message when no reminders');
    it('formats assigned_to as "you" or partner name');
  });

  describe('completeReminder tool', () => {
    it('completes existing reminder');
    it('returns error for non-existent reminder');
    it('returns error when reminder belongs to different couple');
    it('returns error when already completed');
  });
});
```

#### `src/agent/tools/calendar.test.ts`
```typescript
jest.mock('../../integrations/google-calendar.js');
jest.mock('../../integrations/google-auth.js');
jest.mock('../../db/queries/couples.js');
jest.mock('../../db/queries/memories.js');

describe('createCalendarTools', () => {
  describe('getCalendarEvents tool', () => {
    it('returns events for date range');
    it('returns error when no shared calendar configured');
    it('returns error when Google not connected');
    it('handles Google API errors gracefully');
  });

  describe('findFreeTime tool', () => {
    it('finds free slots when both partners connected');
    it('returns error when no partner');
    it('returns error when partner not connected');
    it('handles no free time found');
  });

  describe('createCalendarEvent tool', () => {
    describe('shared calendar', () => {
      it('creates event on shared calendar');
      it('extracts memories from event title');
      it('returns error when no shared calendar');
    });

    describe('individual calendars', () => {
      it('creates on "me" calendar');
      it('creates on "partner" calendar');
      it('creates on "both" calendars');
      it('handles partial success (one fails)');
    });
  });

  describe('extractCalendarMemories', () => {
    it('extracts meeting person from "meeting with X"');
    it('extracts birthday from "X birthday"');
    it('skips generic terms like "doctor"');
    it('handles extraction failures silently');
  });
});
```

#### `src/agent/tools/web-search.test.ts` (integration)
```typescript
jest.mock('../../integrations/parallel.js');

describe('createWebSearchTools', () => {
  describe('webSearch tool', () => {
    it('performs basic search');
    it('enhances query with location');
    it('adds preferred sources for restaurant queries');
    it('excludes Yelp and TripAdvisor');
    it('handles no results');
    it('handles API errors');
  });

  describe('webExtract tool', () => {
    it('extracts content from URL');
    it('includes focus in request');
    it('handles extraction errors');
  });

  describe('webChat tool', () => {
    it('answers question with context');
    it('returns tokens used');
    it('handles API errors');
  });
});
```

**Success Criteria:**
- [ ] All tool execute functions tested
- [ ] Mocks verify correct arguments passed to dependencies
- [ ] Error paths covered
- [ ] No actual DB or API calls in tests

---

### Stage T3: Database Query Logic Tests
**Goal:** Test queries with complex logic against real database
**Status:** Not Started

**Scope:** Only queries with non-trivial logic - filtering, privacy, date comparisons. Skip simple CRUD.

**Strategy:**
- Use test database (Docker PostgreSQL)
- Run migrations before test suite
- Clean tables between tests
- Focus on behavior, not "does SQL work"

**Test Utilities:**

#### `src/test/db-setup.ts`
```typescript
import { sql } from '../db/client.js';

export async function cleanTables() {
  await sql`TRUNCATE reminders, messages, conversation_participants,
            conversation_threads, couple_members, couples, users CASCADE`;
}

export async function createTestCouple() {
  // Returns { user1, user2, couple, sharedThread, user1DmThread }
}
```

#### `src/db/queries/reminders.integration.test.ts`
```typescript
// Only testing filter logic - not basic CRUD
describe('getReminders filter logic', () => {
  beforeEach(async () => {
    await cleanTables();
    // Seed: past-due, future-due, completed, assigned, unassigned
  });

  describe('upcoming filter', () => {
    it('includes future due dates');
    it('includes null due dates');
    it('excludes past due dates');
    it('excludes completed reminders');
  });

  describe('overdue filter', () => {
    it('includes past due dates only');
    it('excludes null due dates');
    it('excludes completed reminders');
  });

  describe('assignedTo filter', () => {
    it('returns reminders assigned to specific user');
    it('ALSO returns unassigned (null) reminders'); // Key behavior!
    it('excludes reminders assigned to other users');
  });
});

describe('getRemindersToNotify', () => {
  it('returns due within 1 hour window');
  it('excludes outside window (too early, too late)');
  it('excludes already notified');
  it('excludes completed');
});
```

#### `src/db/queries/threads.integration.test.ts`
```typescript
// Privacy constraint testing
describe('thread visibility', () => {
  let user1, user2, sharedThread, user1Dm, user2Dm;

  beforeEach(async () => {
    // Setup couple with shared + DM threads
  });

  describe('getThreadsForUser', () => {
    it('user1 sees shared thread');
    it('user1 sees own DM thread');
    it('user1 does NOT see user2 DM thread'); // Critical!
    it('user2 does NOT see user1 DM thread'); // Critical!
  });

  describe('getMessages', () => {
    it('user can read messages from shared thread');
    it('user can read messages from own DM');
    it('user CANNOT read messages from partner DM'); // Critical!
  });
});
```

#### `src/db/queries/memories.integration.test.ts`
```typescript
describe('memory visibility', () => {
  it('shared memories visible to both partners');
  it('DM memories visible only to owner'); // If applicable
});
```

**What We're NOT Testing:**
- Basic INSERT/SELECT (trust postgres)
- Simple lookups by ID
- Schema constraints (tested by migrations)

**Success Criteria:**
- [ ] Filter logic behaves correctly at boundaries
- [ ] Privacy constraints enforced (DM isolation)
- [ ] assignedTo includes NULL reminders (key behavior)
- [ ] Notification window logic correct

---

### Stage T4: Integration Tests
**Goal:** Test end-to-end flows without external APIs
**Status:** Not Started

**Strategy:**
- Mock only external APIs (OpenAI, Google, Parallel)
- Use real database
- Test complete tool execution paths

#### `src/agent/index.test.ts`
```typescript
jest.mock('@ai-sdk/openai');
jest.mock('../integrations/google-calendar.js');
jest.mock('../integrations/parallel.js');

describe('chat function', () => {
  describe('basic conversation', () => {
    it('returns text response from model');
    it('includes message history in context');
    it('applies system prompt with session context');
  });

  describe('tool execution', () => {
    it('executes single tool and returns result');
    it('handles multiple tool calls in sequence');
    it('respects stepCountIs limit');
  });

  describe('error handling', () => {
    it('wraps NoSuchToolError with friendly message');
    it('wraps InvalidToolInputError with tool name');
    it('handles rate limiting (429)');
    it('handles timeout with AbortError');
  });

  describe('memory integration', () => {
    it('retrieves memories for relevant queries');
    it('skips memory retrieval for simple queries');
    it('extracts memories from response');
    it('handles memory errors gracefully');
  });
});
```

**Success Criteria:**
- [ ] Full request/response flow tested
- [ ] Tool chaining works correctly
- [ ] Error boundaries verified
- [ ] Memory hooks integrated

---

### Stage T5: Telegram Adapter Tests
**Goal:** Test Telegram-specific logic
**Status:** Not Started

#### `src/adapters/telegram/bot.test.ts`
```typescript
describe('Telegram commands', () => {
  describe('/link', () => {
    it('links valid code to telegram account');
    it('rejects invalid code');
    it('rejects expired code');
    it('handles already linked account');
  });

  describe('/unlink', () => {
    it('removes telegram_id from user');
    it('handles not linked');
  });

  describe('/status', () => {
    it('shows user info when linked');
    it('shows instructions when not linked');
  });

  describe('/auth', () => {
    it('initiates device authorization flow');
    it('handles user not linked');
  });

  describe('/calendar', () => {
    it('lists calendars with /calendar list');
    it('sets calendar with /calendar set <id>');
    it('shows current with /calendar show');
  });
});

describe('message handling', () => {
  it('routes text to agent for linked users');
  it('prompts /link for unlinked users');
  it('shows typing indicator during processing');
  it('chunks long responses');
  it('formats markdown for Telegram');
});
```

---

### Mocking Boundaries

| Layer | Mock? | Reason |
|-------|-------|--------|
| **Pure functions** | Never | No side effects |
| **Database queries** | Sometimes | Mock for unit tests, real for integration |
| **External APIs** | Always | OpenAI, Google, Parallel |
| **Tool execute()** | Never | Test real behavior |
| **Crypto module** | Never | Test real encryption |
| **File system** | Sometimes | Only for session persistence |

### Anti-Patterns to Avoid

Per the testing-anti-patterns skill:

1. **Never test mock behavior** - If asserting on mock, delete the test
2. **Never add test-only methods** - Use test utilities instead
3. **Understand before mocking** - Know what side effects you're bypassing
4. **Complete mocks** - Mirror full API response structure
5. **Tests with TDD** - Write failing test first, then implement

### Test Infrastructure

```bash
# Run all tests
bun run test

# Run specific test file
bun run test reminders.test.ts

# Run with coverage
bun run test --coverage

# Run integration tests (requires Docker DB)
bun run test:integration
```

**Package.json additions:**
```json
{
  "scripts": {
    "test": "jest",
    "test:coverage": "jest --coverage",
    "test:integration": "docker compose up -d && jest --testPathPattern=integration && docker compose down"
  }
}
```

### Implementation Order

1. **Stage T1** - Pure functions (no setup needed)
2. **Stage T2** - Tool logic with mocks (fast feedback)
3. **Stage T3** - Database queries (requires Docker)
4. **Stage T4** - Integration tests (complex setup)
5. **Stage T5** - Telegram adapter (after core is stable)

### Coverage Targets

| Module | Target | Current |
|--------|--------|---------|
| `src/lib/` | 100% | ~60% (datetime only) |
| `src/agent/tools/` | 95% | 0% |
| `src/db/queries/` | 90% | 0% |
| `src/agent/` | 85% | 0% |
| `src/adapters/telegram/` | 80% | 0% |
| `src/integrations/` | 70% | 0% |

### Estimated Test Files

| File | Tests | Priority |
|------|-------|----------|
| `crypto.test.ts` | ~10 | P0 |
| `reservations.test.ts` | ~15 | P1 |
| `reminders.test.ts` (tool) | ~20 | P0 |
| `calendar.test.ts` (tool) | ~25 | P1 |
| `web-search.test.ts` | ~15 | P1 |
| `reminders.integration.test.ts` | ~12 | P0 |
| `threads.integration.test.ts` | ~8 | P0 |
| `memories.integration.test.ts` | ~4 | P2 |
| `agent/index.test.ts` | ~20 | P1 |
| `telegram/bot.test.ts` | ~25 | P3 |
| **Total** | **~154** | |
