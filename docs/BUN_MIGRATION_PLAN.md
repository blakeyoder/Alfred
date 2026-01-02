# Migration Plan: npm to Bun

## Overview

Migrate the alfred project from npm/tsx to Bun for faster dependency installation, native TypeScript execution, and improved developer experience.

**Current Setup:**
- Package manager: npm (package-lock.json)
- TypeScript execution: tsx
- Build: tsc
- Runtime: Node.js

**Target Setup:**
- Package manager: bun (bun.lockb)
- TypeScript execution: bun (native)
- Build: tsc (keep for declaration files) or bun build
- Runtime: Bun

---

## Stage 1: Verify Bun Compatibility

**Goal**: Confirm all dependencies and Node.js APIs work with Bun

**Status**: Complete

### Node.js APIs in Use (All Bun-Compatible)

| API | Location | Bun Support |
|-----|----------|-------------|
| `fs/promises` | session/store.ts, migrations/migrate.ts | ✅ Full |
| `path` | session/store.ts, migrations/migrate.ts | ✅ Full |
| `crypto` | lib/crypto.ts | ✅ Full |
| `os` (homedir) | session/store.ts | ✅ Full |
| `url` (fileURLToPath) | migrations/migrate.ts | ✅ Full |
| `util` (promisify) | lib/crypto.ts | ✅ Full |
| `readline` | cli.ts | ✅ Full |
| `process` | Multiple files | ✅ Full |

### Dependencies (All Bun-Compatible)

| Package | Version | Notes |
|---------|---------|-------|
| @ai-sdk/openai | ^3.0.2 | Pure JS, works with Bun |
| ai | ^6.0.5 | Vercel AI SDK, compatible |
| dotenv | ^17.2.3 | Not needed with Bun (native .env) |
| express | ^5.2.1 | Works with Bun |
| postgres | ^3.4.7 | Pure JS, works with Bun |
| telegraf | ^4.16.3 | Works with Bun |
| zod | ^4.3.4 | Pure JS, works with Bun |

---

## Stage 2: Install Bun and Initialize

**Goal**: Set up Bun in the project

**Tasks**:
1. Install Bun globally (if not present)
2. Remove npm artifacts
3. Install dependencies with Bun
4. Update .gitignore

**Commands**:
```bash
# Install Bun (if needed)
curl -fsSL https://bun.sh/install | bash

# Remove npm artifacts
rm -rf node_modules package-lock.json

# Install with Bun
bun install
```

**Success Criteria**:
- `bun.lockb` exists
- All dependencies installed successfully
- `node_modules/` populated by Bun

**Status**: Not Started

---

## Stage 3: Update package.json Scripts

**Goal**: Replace tsx/node with bun in all scripts

### Script Changes

| Script | Before | After |
|--------|--------|-------|
| dev | `tsx src/index.ts` | `bun run src/index.ts` |
| build | `tsc` | `tsc` (keep) |
| start | `node dist/adapters/telegram/server.js` | `bun run dist/adapters/telegram/server.js` |
| cli | `tsx src/cli.ts` | `bun run src/cli.ts` |
| migrate | `tsx src/db/migrations/migrate.ts` | `bun run src/db/migrations/migrate.ts` |
| migrate:prod | `node dist/db/migrations/migrate.js` | `bun run dist/db/migrations/migrate.js` |
| seed:demo | `tsx src/scripts/seed-demo.ts` | `bun run src/scripts/seed-demo.ts` |
| seed:prod | `node dist/scripts/seed-prod.js` | `bun run dist/scripts/seed-prod.js` |
| db:setup | `npm run migrate:prod && npm run seed:prod` | `bun run migrate:prod && bun run seed:prod` |
| telegram | `tsx src/adapters/telegram/index.ts` | `bun run src/adapters/telegram/index.ts` |

### New Scripts to Add

```json
{
  "typecheck": "tsc --noEmit"
}
```

### devDependencies Changes

- Remove: `tsx` (Bun has native TypeScript)
- Keep: `typescript` (for type checking)
- Keep: `@types/node`, `@types/express`

**Status**: Not Started

---

## Stage 4: Remove dotenv (Optional)

**Goal**: Use Bun's native .env loading instead of dotenv

Bun automatically loads `.env` files without requiring dotenv. However, this is optional and can be done incrementally.

**Tasks**:
1. Remove `import 'dotenv/config'` or `dotenv.config()` calls
2. Remove `dotenv` from dependencies
3. Verify `process.env` still works

**Files to Update**:
- Check all files that import dotenv

**Status**: Not Started (Optional)

---

## Stage 5: Update Documentation

**Goal**: Update docs for Bun

### CLAUDE.md Updates

```markdown
## Commands

```bash
# Development
bun run dev          # Run entry point (src/index.ts)
bun run cli          # Start interactive CLI REPL
bun run build        # Compile TypeScript to dist/

# Database
docker compose up -d # Start local PostgreSQL
bun run migrate      # Run SQL migrations
bun run seed:demo    # Create demo users and data
```
```

### README.md Updates

Update any npm references to bun.

**Status**: Not Started

---

## Stage 6: Test All Functionality

**Goal**: Verify everything works with Bun

### Test Checklist

- [ ] `bun install` completes without errors
- [ ] `bun run dev` starts the application
- [ ] `bun run cli` launches the REPL
- [ ] `bun run migrate` runs migrations
- [ ] `bun run seed:demo` seeds the database
- [ ] `bun run telegram` starts the Telegram bot
- [ ] `bun run build` compiles TypeScript
- [ ] `bun run start` runs the production build
- [ ] Crypto encrypt/decrypt works
- [ ] Database connections work
- [ ] AI agent responds correctly
- [ ] Reminders tool works
- [ ] Calendar tool works (if Google auth configured)

**Status**: Not Started

---

## Stage 7: Clean Up

**Goal**: Finalize migration

**Tasks**:
1. Verify `package-lock.json` is deleted
2. Remove `tsx` from devDependencies
3. Commit changes
4. Delete this plan file

**Commit Message**:
```
Migrate from npm to Bun

- Replace npm with bun for package management
- Remove tsx in favor of Bun's native TypeScript
- Update all scripts to use bun run
- Remove dotenv (Bun loads .env natively)
```

**Status**: Not Started

---

## Potential Issues & Mitigations

### 1. Express Compatibility
Bun supports Express well. If any issues arise, consider `Bun.serve()` or `Hono`.

### 2. Crypto API
Bun implements Node.js crypto. The existing AES-256-GCM code should work as-is.

### 3. readline Module
Bun supports readline. If issues occur, `Bun.stdin` is an alternative.

### 4. Production Deployment
If deploying to Railway/Render, ensure Bun is available or use `bun build --compile` for a single binary.

---

## Quick Start

```bash
# 1. Install Bun (if needed)
curl -fsSL https://bun.sh/install | bash

# 2. Remove npm artifacts
rm -rf node_modules package-lock.json

# 3. Install with Bun
bun install

# 4. Test
bun run cli
```

---

## Rollback Plan

If migration fails:

```bash
# Restore npm setup
rm -rf bun.lockb node_modules
git checkout package-lock.json package.json
npm install
```
