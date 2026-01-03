-- 010_voice_call_agent_types.sql
-- Add specialized voice agent types for routing calls to different ElevenLabs agents

-- Add agent_type column (which ElevenLabs agent to use)
ALTER TABLE voice_calls
ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'general'
CHECK (agent_type IN ('restaurant', 'medical', 'general'));

-- Rename call_type to call_purpose for clarity
ALTER TABLE voice_calls
RENAME COLUMN call_type TO call_purpose;

-- Drop the old constraint first
ALTER TABLE voice_calls
DROP CONSTRAINT voice_calls_call_type_check;

-- Migrate existing data to valid values BEFORE adding new constraint
-- 'personal' was in the old schema but not in the new one - map to 'other'
UPDATE voice_calls
SET call_purpose = 'other'
WHERE call_purpose = 'personal';

-- Now add the new constraint (data is already valid)
ALTER TABLE voice_calls
ADD CONSTRAINT voice_calls_call_purpose_check
CHECK (call_purpose IN ('reservation', 'confirmation', 'inquiry', 'appointment', 'other'));

-- Migrate existing call_type values to agent_type based on purpose
UPDATE voice_calls
SET agent_type = CASE
  WHEN call_purpose = 'reservation' THEN 'restaurant'
  ELSE 'general'
END
WHERE agent_type = 'general';
