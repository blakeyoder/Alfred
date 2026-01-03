-- 006_notified_at.sql
-- Add notified_at column to track when reminder notifications were sent

ALTER TABLE reminders ADD COLUMN notified_at TIMESTAMPTZ;

-- Index for finding reminders that need notification
-- (due soon, not completed, not yet notified)
CREATE INDEX idx_reminders_notification
ON reminders (due_at)
WHERE completed_at IS NULL AND notified_at IS NULL;
