-- 011_user_phone_number.sql
-- Add phone number to users for voice call callbacks

ALTER TABLE users ADD COLUMN phone_number TEXT;

-- Index for potential lookups by phone
CREATE INDEX idx_users_phone_number ON users (phone_number) WHERE phone_number IS NOT NULL;
