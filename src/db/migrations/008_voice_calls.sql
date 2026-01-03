-- 008_voice_calls.sql
-- Voice calls tracking for ElevenLabs Conversational AI

CREATE TABLE voice_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES users(id),

  -- ElevenLabs/Twilio identifiers
  conversation_id TEXT UNIQUE,  -- ElevenLabs conversation ID
  call_sid TEXT,                -- Twilio call SID

  -- Call details
  call_type TEXT NOT NULL CHECK (call_type IN ('reservation', 'confirmation', 'personal', 'other')),
  to_number TEXT NOT NULL,      -- E.164 format (e.g., +15551234567)
  to_name TEXT,                 -- Human-readable recipient name
  instructions TEXT NOT NULL,   -- What the AI should do/say
  dynamic_variables JSONB,      -- Variables passed to ElevenLabs agent

  -- Status tracking (matches ElevenLabs enum)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'initiated', 'in-progress', 'processing', 'done', 'failed')),

  -- Results (populated after call completes)
  transcript JSONB,             -- Full transcript array from ElevenLabs
  summary TEXT,                 -- AI-generated call summary
  outcome TEXT CHECK (outcome IN ('success', 'failure', 'unknown', 'voicemail', 'no_answer')),
  call_duration_secs INTEGER,
  termination_reason TEXT,
  error_code TEXT,
  error_reason TEXT,

  -- Notification tracking
  notified_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,       -- When call was initiated
  completed_at TIMESTAMPTZ      -- When call ended
);

-- Index for finding calls to notify (completed but not notified)
CREATE INDEX idx_voice_calls_notification
ON voice_calls (completed_at)
WHERE notified_at IS NULL AND status IN ('done', 'failed');

-- Index for looking up by conversation_id (webhook lookups)
CREATE INDEX idx_voice_calls_conversation_id ON voice_calls (conversation_id);

-- Index for couple's call history
CREATE INDEX idx_voice_calls_couple ON voice_calls (couple_id, created_at DESC);
