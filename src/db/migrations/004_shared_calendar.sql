-- 004_shared_calendar.sql
-- Add shared Google Calendar support for couples

ALTER TABLE couples ADD COLUMN shared_calendar_id TEXT;

COMMENT ON COLUMN couples.shared_calendar_id IS 'Google Calendar ID for the shared couple calendar';
