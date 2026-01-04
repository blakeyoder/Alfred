# Alfred: Multi-Platform Groups Architecture

## Overview

Transform Alfred from a couples-only, Telegram-only assistant into a flexible groups-based, multi-platform assistant.

**Two Phases:**
1. **Generalize**: Couples (2 people) → Groups (N people)
2. **Abstract**: Telegram-only → Multi-platform adapters

---

## Policy Decisions

| Policy | Decision |
|--------|----------|
| **Memory visibility** | All group members see shared memories. DM memories stay private. |
| **Shared calendar** | Group has shared calendar for writing. Members can also connect personal calendars for reading availability. |
| **DM privacy** | DM is private from ALL other group members (user ↔ Alfred only). |
| **Couple migration** | No "couple" concept. All existing couples become generic groups. |
| **Language** | No "partner" keyword. Everyone uses member names ("Remind Blake"). |

---

## Phase 1: Safe Preparatory Work (No Breaking Changes)

All work in this phase can be committed incrementally. The app continues to work with existing couples model.

---

### 1.1: Create New Tables (Additive)

**Migration:** `013_groups_schema.sql`

```sql
-- Groups (will replace couples)
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  shared_calendar_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Group members (will replace couple_members)
CREATE TABLE group_members (
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  nickname TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- Platform connections for groups
CREATE TABLE group_platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_group_id BIGINT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform, platform_group_id)
);
CREATE INDEX idx_group_platform_lookup ON group_platform_connections(platform, platform_group_id);
```

✅ **Safe:** New tables, no impact on existing code

---

### 1.2: Create New Query Files (Additive)

**New file:** `src/db/queries/groups.ts`
```typescript
export interface Group { id, name, shared_calendar_id, created_at }
export interface GroupMember { group_id, user_id, role, nickname, joined_at }

getGroupById(id: string): Promise<Group | null>
getGroupForUser(userId: string): Promise<Group | null>
getGroupMembers(groupId: string): Promise<(User & GroupMember)[]>
getOtherMembers(groupId: string, excludeUserId: string): Promise<(User & GroupMember)[]>
getMemberByName(groupId: string, nameOrNickname: string): Promise<User | null>
createGroup(name): Promise<Group>
addGroupMember(groupId, userId, role?, nickname?): Promise<void>
```

**New file:** `src/db/queries/group-platforms.ts`
```typescript
getGroupByPlatformId(platform, platformGroupId): Promise<Group | null>
addPlatformConnection(groupId, platform, platformGroupId): Promise<void>
getPlatformConnections(groupId): Promise<PlatformConnection[]>
```

✅ **Safe:** New files, not imported anywhere yet

---

### 1.3: Add Nullable group_id Columns (Additive)

**Migration:** `014_add_group_id_columns.sql`

```sql
ALTER TABLE conversation_threads ADD COLUMN group_id UUID REFERENCES groups(id);
ALTER TABLE reminders ADD COLUMN group_id UUID REFERENCES groups(id);
ALTER TABLE voice_calls ADD COLUMN group_id UUID REFERENCES groups(id);

CREATE INDEX idx_threads_group ON conversation_threads(group_id);
CREATE INDEX idx_reminders_group ON reminders(group_id);
CREATE INDEX idx_voice_calls_group ON voice_calls(group_id);
```

✅ **Safe:** Nullable columns, existing queries still use couple_id

---

### 1.4: Create Platform Adapter Interface (Additive)

**New file:** `src/adapters/types.ts`
```typescript
export type Platform = 'telegram' | 'whatsapp' | 'slack' | 'discord';

export interface IncomingMessage {
  platform: Platform;
  platformMessageId: string;
  platformGroupId: string | null;
  platformUserId: string;
  text: string;
  isCommand: boolean;
  commandName?: string;
  commandArgs?: string[];
}

export interface OutgoingMessage {
  text: string;
  parseMode?: 'markdown' | 'html' | 'plain';
}

export interface PlatformAdapter {
  readonly platform: Platform;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(groupId: string, message: OutgoingMessage): Promise<string>;
  sendTypingIndicator(groupId: string): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}
```

✅ **Safe:** Interface definition, not used yet

---

### 1.5: Create User Platform Connections Table (Additive)

**Migration:** `015_user_platform_connections.sql`

```sql
CREATE TABLE user_platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform, platform_user_id)
);
CREATE INDEX idx_user_platform_lookup ON user_platform_connections(platform, platform_user_id);
```

**New file:** `src/db/queries/user-platforms.ts`
```typescript
getUserByPlatformId(platform, platformUserId): Promise<User | null>
linkPlatform(userId, platform, platformUserId): Promise<void>
unlinkPlatform(platform, platformUserId): Promise<void>
```

✅ **Safe:** New table and queries, not used yet

---

### 1.6: Extract Telegram Formatters (Refactor)

**New file:** `src/adapters/telegram/formatters.ts`
- Extract `markdownToTelegramHtml()` from bot.ts
- Extract `splitLongMessage()` from bot.ts

**Update:** `src/adapters/telegram/bot.ts`
- Import formatters from new file

✅ **Safe:** Pure refactor, no behavior change

---

### 1.7: Create resolveAssignee Helper (Additive)

**New file:** `src/agent/tools/assignee-resolver.ts`
```typescript
export interface Member {
  id: string;
  name: string;
  nickname: string | null;
}

export interface ResolveResult {
  userId: string | undefined;
  error?: string;
}

export function resolveAssignee(
  who: string | undefined,
  currentUserId: string,
  members: Member[]
): ResolveResult {
  if (!who || who === "everyone" || who === "all") {
    return { userId: undefined };
  }
  if (who === "me") {
    return { userId: currentUserId };
  }

  const target = who.replace(/^@/, '');
  const matches = members.filter(m =>
    m.name.toLowerCase() === target.toLowerCase() ||
    m.nickname?.toLowerCase() === target.toLowerCase()
  );

  if (matches.length === 0) {
    return { userId: undefined, error: `No member found matching "${who}"` };
  }
  if (matches.length > 1) {
    return { userId: undefined, error: `Multiple members match "${who}"` };
  }
  return { userId: matches[0].id };
}
```

✅ **Safe:** New helper, not used yet

---

## Phase 2: Data Migration (Run Once, Carefully)

⚠️ **CHECKPOINT:** All Phase 1 work should be committed and deployed before proceeding.

---

### 2.1: Migrate Couples to Groups

**Migration:** `016_migrate_couples_data.sql`

```sql
-- Copy couples to groups
INSERT INTO groups (id, name, shared_calendar_id, created_at)
SELECT id, name, shared_calendar_id, created_at FROM couples;

-- Copy couple_members to group_members
INSERT INTO group_members (group_id, user_id, role, joined_at)
SELECT couple_id, user_id, 'member', NOW() FROM couple_members;

-- Copy telegram_group_id to group_platform_connections
INSERT INTO group_platform_connections (group_id, platform, platform_group_id, is_primary)
SELECT id, 'telegram', telegram_group_id, true FROM couples WHERE telegram_group_id IS NOT NULL;

-- Backfill group_id on dependent tables
UPDATE conversation_threads SET group_id = couple_id;
UPDATE reminders SET group_id = couple_id;
UPDATE voice_calls SET group_id = couple_id;

-- Copy telegram_id to user_platform_connections
INSERT INTO user_platform_connections (user_id, platform, platform_user_id, is_primary)
SELECT id, 'telegram', telegram_id::text, true FROM users WHERE telegram_id IS NOT NULL;
```

⚠️ **Risk:** Data copy operation. Run in transaction, verify counts match.

---

## Phase 3: Breaking Changes (Deploy Together)

⚠️ **CHECKPOINT:** Phase 2 migration must complete successfully before proceeding.

All changes in this phase must be deployed together - they break the app if deployed partially.

---

### 3.1: Update SessionContext Interface

**File:** `src/agent/system-prompt.ts`

```typescript
// OLD
export interface SessionContext {
  userId: string;
  userName: string;
  coupleId: string;
  coupleName: string | null;
  partnerName: string | null;
  threadId: string;
  visibility: "shared" | "dm";
}

// NEW
export interface SessionContext {
  userId: string;
  userName: string;
  groupId: string;
  groupName: string | null;
  members: Array<{ id: string; name: string; nickname: string | null }>;
  threadId: string;
  visibility: "shared" | "dm";
}
```

🔴 **Breaking:** All SessionContext consumers must update simultaneously

---

### 3.2: Update System Prompt

**File:** `src/agent/system-prompt.ts`

Remove all "partner" and "couple" language. Use member names.

```typescript
function buildSystemPrompt(ctx: SessionContext): string {
  const memberList = ctx.members.map(m => m.name).join(', ');
  return `You are an AI assistant helping ${ctx.groupName || 'your group'} coordinate.

Current user: ${ctx.userName}
${ctx.members.length > 0 ? `Other members: ${memberList}` : ''}

When assigning tasks or reminders, use member names explicitly.
...`;
}
```

🔴 **Breaking:** Must deploy with SessionContext change

---

### 3.3: Update All Tools

**Files:**
- `src/agent/tools/reminders.ts` - Use new resolveAssignee, groupId
- `src/agent/tools/calendar.ts` - Use member names for `whose`
- `src/agent/tools/voice-calls.ts` - coupleId → groupId
- `src/agent/memory-privacy.ts` - coupleId → groupId

🔴 **Breaking:** Must deploy with SessionContext change

---

### 3.4: Update Telegram Adapter

**File:** `src/adapters/telegram/bot.ts`
- `buildSessionContext()` → use groups queries
- Update `/setup` command to use groups
- Use `getGroupByPlatformId()` instead of `getCoupleByGroupId()`

🔴 **Breaking:** Must deploy with SessionContext change

---

### 3.5: Update Query Files

**Files:**
- `src/db/queries/reminders.ts` - couple_id → group_id
- `src/db/queries/voice-calls.ts` - couple_id → group_id

🔴 **Breaking:** Must deploy with data migration complete

---

### 3.6: Update Notification Services

**Files:**
- `src/services/reminder-notifications.ts` - Use group_platform_connections
- `src/services/voice-call-notifications.ts` - Use group_platform_connections
- `src/integrations/mem0-provider.ts` - coupleId → groupId

🔴 **Breaking:** Must deploy with data migration complete

---

## Phase 4: Cleanup (After Verification)

⚠️ **CHECKPOINT:** Verify app works correctly in production before cleanup.

---

### 4.1: Add NOT NULL Constraints

**Migration:** `017_add_group_constraints.sql`

```sql
ALTER TABLE conversation_threads ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE reminders ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE voice_calls ALTER COLUMN group_id SET NOT NULL;
```

---

### 4.2: Drop Old Tables and Columns

**Migration:** `018_drop_couples.sql`

```sql
ALTER TABLE conversation_threads DROP COLUMN couple_id;
ALTER TABLE reminders DROP COLUMN couple_id;
ALTER TABLE voice_calls DROP COLUMN couple_id;
ALTER TABLE users DROP COLUMN telegram_id;

DROP TABLE couple_members;
DROP TABLE couples;
```

🔴 **Destructive:** No rollback possible after this

---

### 4.3: Delete Deprecated Files

- Delete `src/db/queries/couples.ts`
- Delete `src/db/queries/telegram.ts`

## Phase 5: Future - Multi-Platform Adapters

After groups migration is complete and stable, implement full adapter pattern:

### 5.1: Telegram Adapter Class
Refactor `bot.ts` into `TelegramAdapter` implementing `PlatformAdapter` interface.

### 5.2: Unified Message Handler
New `src/adapters/message-handler.ts` - shared handler for all platforms.

### 5.3: Notification Dispatcher
New `src/services/notification-dispatcher.ts` - route notifications to correct platform.

### 5.4: WhatsApp Adapter (When Ready)
Implement WhatsApp adapter using chosen integration (Twilio, Cloud API, etc.)

---

## Summary

| Phase | Risk | Can Rollback? | Commit Strategy |
|-------|------|---------------|-----------------|
| **Phase 1** | ✅ None | N/A | Commit each step |
| **Phase 2** | ⚠️ Medium | Transaction rollback | Single commit |
| **Phase 3** | 🔴 High | Redeploy old code | All together |
| **Phase 4** | 🔴 Destructive | ❌ No | After verification |
| **Phase 5** | ✅ None | N/A | Commit each step |

**User-facing changes:**
- Alfred uses member names instead of "partner"
- If user says "remind my partner", Alfred asks "Who do you mean?"
- All data (reminders, threads, messages) preserved
