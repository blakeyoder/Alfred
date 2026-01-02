# Couples EA

An AI-powered "Executive Assistant" for couples to coordinate schedules, reminders, budgets, and date planning.

## Features

- **Reminders** - Create, list, and complete reminders for yourself, your partner, or both
- **Calendar Integration** - View events, find mutual free time, and create calendar events
- **Private Conversations** - Shared threads for both partners, or private DMs for surprises/gifts
- **Persistent Memory** - Conversations are saved and resume across sessions

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js + TypeScript |
| Agent Framework | Vercel AI SDK |
| Database | PostgreSQL |
| LLM | OpenAI GPT-4o |
| Google APIs | Calendar, Sheets (read-only) |

## Prerequisites

- Node.js 18+
- Docker (for local PostgreSQL)
- OpenAI API key
- Google Cloud project with Calendar API enabled (optional, for calendar features)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Database
DATABASE_URL=postgres://couples:couples@localhost:5433/couplesea

# OpenAI
OPENAI_API_KEY=sk-...

# Encryption (generate with: openssl rand -hex 32)
ENCRYPTION_KEY=your-32-byte-hex-key

# Google OAuth (optional, for calendar features)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### 3. Start Database

```bash
docker compose up -d
```

### 4. Run Migrations

```bash
npm run migrate
```

### 5. Seed Demo Data

```bash
npm run seed:demo
```

This creates:
- Two demo users (blake@example.com, partner@example.com)
- One couple linking them
- Shared and private conversation threads

## Usage

### Start the CLI

```bash
npm run cli
```

### Available Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/whoami` | Show current user and couple |
| `/switch-user <email>` | Change active identity |
| `/threads` | List available threads |
| `/thread <number>` | Switch to a different thread |
| `/history` | Show recent messages |
| `/clear` | Clear conversation history |
| `/auth google` | Connect Google Calendar |
| `/exit` | Quit the CLI |

### Example Conversation

```
You: Hey, what can you help with?

EA: Hey! I can help you and your partner stay organized. Here's what I can do:

- **Reminders**: Create reminders for groceries, tasks, appointments
- **Calendar**: Check your schedules, find when you're both free, book events
- **Coordination**: Help plan date nights, manage shared responsibilities

What would you like help with?

You: Remind me to buy flowers for our anniversary next Friday

EA: Created reminder "Buy flowers for anniversary" for you, due next Friday.

You: What's on our calendar this weekend?

EA: Let me check your calendars...
```

## Project Structure

```
couples-ea/
├── src/
│   ├── index.ts              # Entry point
│   ├── cli.ts                # CLI REPL
│   ├── agent/
│   │   ├── index.ts          # Agent loop
│   │   ├── system-prompt.ts  # Agent personality
│   │   └── tools/
│   │       ├── reminders.ts  # Reminder tools
│   │       ├── calendar.ts   # Calendar tools
│   │       └── index.ts
│   ├── session/
│   │   └── store.ts          # Session persistence
│   ├── db/
│   │   ├── client.ts         # PostgreSQL client
│   │   ├── queries/          # Database queries
│   │   └── migrations/       # SQL migrations
│   ├── integrations/
│   │   ├── google-auth.ts    # OAuth device flow
│   │   └── google-calendar.ts
│   └── lib/
│       └── crypto.ts         # Token encryption
├── scripts/
│   └── seed-demo.ts
├── docker-compose.yml
└── package.json
```

## Available Tools

The AI agent has access to these tools:

### Reminders
- `createReminder` - Create a reminder for one or both partners
- `listReminders` - List upcoming, overdue, or all reminders
- `completeReminder` - Mark a reminder as complete

### Calendar
- `getCalendarEvents` - Get calendar events in a date range
- `findFreeTime` - Find when both partners are free
- `createCalendarEvent` - Create a calendar event

## Google Calendar Setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the Google Calendar API
3. Create OAuth 2.0 credentials (Desktop app type)
4. Add credentials to `.env`
5. Run `/auth google` in the CLI to connect

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run the entry point |
| `npm run cli` | Start the interactive CLI |
| `npm run build` | Compile TypeScript |
| `npm run migrate` | Run database migrations |
| `npm run seed:demo` | Seed demo data |

## Post-MVP Roadmap

- [ ] Telegram bot adapter
- [ ] Long-term memory with mem0
- [ ] Budget tracking via Google Sheets
- [ ] Date suggestions via Google Places
- [ ] Proactive reminders and nudges
- [ ] Web dashboard

## License

ISC
