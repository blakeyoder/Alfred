-- 005_telegram_group.sql
-- Add Telegram group chat support for couples

ALTER TABLE couples ADD COLUMN telegram_group_id BIGINT;

COMMENT ON COLUMN couples.telegram_group_id IS 'Telegram group chat ID where both partners interact with Alfred';
