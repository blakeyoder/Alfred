# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Run entry point (src/index.ts)
npm run cli          # Start interactive CLI REPL
npm run build        # Compile TypeScript to dist/

# Database
docker compose up -d # Start local PostgreSQL
npm run migrate      # Run SQL migrations
npm run seed:demo    # Create demo users and data
```

## Architecture

**Couples EA** is an AI-powered executive assistant for couples using the Vercel AI SDK with OpenAI GPT-4o.

### Core Flow

```
CLI (src/cli.ts)
    │
    ▼
Agent (src/agent/index.ts)  ──▶  Tools (reminders, calendar)
    │                                    │
    ▼                                    ▼
Session (src/session/store.ts)    DB Queries (src/db/queries/)
                                         │
                                         ▼
                                  PostgreSQL (via postgres.js)
```

### Key Concepts

- **Couples & Users**: A couple has two users linked via `couple_members`. Each user belongs to one couple.
- **Threads**: Conversations are stored in threads with two visibility modes:
  - `shared`: Both partners can see the conversation
  - `dm`: Private to one partner (for surprises/gifts)
- **Session**: Stored in `~/.couplesea/session.json`, tracks current user, couple, and active thread
- **Tools**: Agent tools are created with session context to resolve "me"/"partner" references

### Database

Uses `postgres` (porsager) library with raw SQL. Query files are in `src/db/queries/`. Migrations are plain SQL files run by `src/db/migrations/migrate.ts`.

Schema tables: `users`, `couples`, `couple_members`, `conversation_threads`, `conversation_participants`, `messages`, `reminders`, `google_tokens`

### Google Integration

OAuth uses Device Authorization Grant flow for CLI. Tokens are encrypted at rest using AES-256-GCM (requires `ENCRYPTION_KEY` env var).

## Code Conventions

- Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
- ESM modules (`.js` extensions required in imports)
- Zod for schema validation
- Use `&apos;` to escape apostrophes in code
- Prettier requires double quotes (`"`) for strings containing single quotes
