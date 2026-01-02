-- Add telegram_id to users for linking Telegram accounts
ALTER TABLE users ADD COLUMN telegram_id BIGINT UNIQUE;
