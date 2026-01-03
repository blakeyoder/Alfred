# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Always use `bun`, not `npm`.**

```bash
# Development
bun run dev          # Start Telegram bot (polling mode)
bun run build        # Compile TypeScript to dist/

# Database
docker compose up -d # Start local PostgreSQL
bun run migrate      # Run SQL migrations
bun run seed:demo    # Create demo users and data
```

## Development Workflow

```sh
# 1. Make changes

# 2. Format code
bun run format

# 3. Lint (fix issues automatically)
bun run lint:fix

# 4. Typecheck
bun run typecheck

# 5. Build before deploying
bun run build
```

### Linting & Formatting

```bash
bun run format        # Format all files with Prettier
bun run format:check  # Check formatting without writing
bun run lint          # Check for ESLint errors
bun run lint:fix      # Fix ESLint errors automatically
```

## Architecture

**Alfred** is an AI-powered executive assistant for couples using the Vercel AI SDK with OpenAI GPT-4o, deployed as a Telegram bot.

### Core Flow

```
Telegram Bot (src/adapters/telegram/)
    │
    ▼
Agent (src/agent/index.ts)  ──▶  Tools (reminders, calendar)
    │                                    │
    ▼                                    ▼
Session Context                   DB Queries (src/db/queries/)
                                         │
                                         ▼
                                  PostgreSQL (via postgres.js)
```

### Key Concepts

- **Couples & Users**: A couple has two users linked via `couple_members`. Each user belongs to one couple.
- **Threads**: Conversations are stored in threads with two visibility modes:
  - `shared`: Both partners can see the conversation
  - `dm`: Private to one partner (for surprises/gifts)
- **Telegram Linkage**: Users link their Telegram account via `/link <email>`
- **Shared Calendar**: Couples configure a shared Google Calendar for events
- **Tools**: Agent tools are created with session context to resolve "me"/"partner" references

### Telegram Commands

- `/link <email>` - Connect Telegram to Alfred account
- `/unlink` - Disconnect account
- `/status` - Show current connection info
- `/auth` - Connect Google Calendar (OAuth device flow)
- `/calendar list` - List writable calendars
- `/calendar set <id>` - Set shared calendar for couple
- `/calendar show` - Show current shared calendar

### Database

Uses `postgres` (porsager) library with raw SQL. Query files are in `src/db/queries/`. Migrations are plain SQL files run by `src/db/migrations/migrate.ts`.

Schema tables: `users`, `couples`, `couple_members`, `conversation_threads`, `conversation_participants`, `messages`, `reminders`, `google_tokens`

### Google Integration

OAuth uses Device Authorization Grant flow. Tokens are encrypted at rest using AES-256-GCM (requires `ENCRYPTION_KEY` env var).

## Code Conventions

- Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
- ESM modules (`.js` extensions required in imports)
- Zod for schema validation
- Use `&apos;` to escape apostrophes in code
- Prettier requires double quotes (`"`) for strings containing single quotes
