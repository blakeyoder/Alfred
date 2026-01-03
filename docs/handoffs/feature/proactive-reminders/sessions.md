# Proactive Reminders Feature - Session History

---

## Session: 2026-01-02 (continued)

### Phase 2: Proactive Reminder Notifications (COMPLETE)

Implemented the proactive reminder notification system that polls for due reminders and sends notifications to the couple's Telegram group.

**Changes made:**
1. **Migration `006_notified_at.sql`**: Added `notified_at` column to reminders table with partial index for efficient notification queries
2. **Updated `reminders.ts` queries**:
   - Added `notified_at` to `Reminder` interface
   - Added `getRemindersToNotify()` - finds reminders due in next hour, not completed, not yet notified
   - Added `markReminderNotified()` - updates `notified_at` timestamp
3. **Created `src/services/reminder-notifications.ts`**:
   - Polls every 5 minutes for due reminders
   - Sends notifications to couple's Telegram group with `⏰ Reminder: {title} - Due at {time}`
   - Only marks as notified after successful send (retries on failure)
   - Graceful start/stop functions
4. **Integrated into entry points**:
   - `server.ts` (production): Starts after Express server, stops on shutdown
   - `index.ts` (development): Starts before bot.launch(), stops on shutdown

**Build status**: ✅ Typecheck and build pass

### Current State
- **Feature complete**: All Phase 1 (group chat) and Phase 2 (notifications) implemented
- **Ready to deploy**: Run `git push` to deploy to Railway
- **Migration will run**: On first production startup, `006_notified_at.sql` runs automatically

### Testing Checklist
- [ ] Deploy to Railway
- [ ] Create a test reminder due in ~55-59 minutes
- [ ] Wait for notification in group chat (should arrive within 5 minutes of reminder becoming "due in 1 hour")
- [ ] Verify reminder doesn't notify again after completion

---

## Session: 2026-01-02 20:30

### Project Context
Adding proactive reminder notifications to Alfred, a couples assistant Telegram bot. The goal is to notify users about upcoming reminders 1 hour before they're due, sent to a shared Telegram group chat.

### Key Decisions Made
1. **Notification timing**: 1 hour before due time
2. **No follow-ups**: Notify once per reminder, no repeats
3. **Delivery method**: Send to Telegram group chat (not individual DMs) for accountability
4. **Trigger behavior**: Alfred responds to all messages in group (not just @mentions)
5. **Implementation approach**: Simple `setInterval` polling every 5 minutes (no external job scheduler)

### Completed Work

**Phase 1: Group Chat Support (COMPLETE)**
- Added `telegram_group_id` column to couples table (`005_telegram_group.sql`)
- Added `/setup` command to link a group chat to a couple
- Added group message handling in bot.ts (detects group, verifies sender is couple member)
- Configured BotFather Group Privacy (must be OFF, then re-add bot to group)
- Deployed to production, tested successfully with both partners in group

**Other fixes this session:**
- Fixed calendar to use shared calendar instead of personal (`getCalendarEvents` now uses `sharedCalendarId`)
- Fixed timezone handling (hardcoded `America/New_York`)
- Added Telegram markdown rendering (`**bold**` → `*bold*`)
- Removed Google Sheets scope (not supported by TV device flow)
- Set up Google Cloud OAuth (TVs and Limited Input devices type)

### Commits This Session
- `66b053f` - Add shared calendar support and fix timezone handling
- `2daac77` - Add Telegram group chat support
