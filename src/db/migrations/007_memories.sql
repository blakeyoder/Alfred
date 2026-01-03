-- 007_memories.sql
-- Memories table for long-term semantic memory
-- Stores both individual and couple-level memories with privacy tracking

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = couple-level

  -- mem0 sync
  mem0_id TEXT,  -- ID from mem0 API for updates/deletes

  -- Content
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fact', 'relationship', 'context')),

  -- Source tracking (for privacy filtering)
  source_thread_id UUID REFERENCES conversation_threads(id) ON DELETE SET NULL,
  source_visibility TEXT CHECK (source_visibility IN ('shared', 'dm')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,  -- For soft decay ranking

  -- Constraints
  CONSTRAINT valid_source_visibility CHECK (
    (source_thread_id IS NULL AND source_visibility IS NULL) OR
    (source_thread_id IS NOT NULL AND source_visibility IS NOT NULL)
  )
);

-- Indexes for common query patterns
CREATE INDEX idx_memories_couple ON memories(couple_id);
CREATE INDEX idx_memories_user ON memories(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_memories_category ON memories(couple_id, category);
CREATE INDEX idx_memories_created ON memories(couple_id, created_at DESC);
CREATE INDEX idx_memories_accessed ON memories(couple_id, last_accessed_at DESC NULLS LAST);
CREATE INDEX idx_memories_mem0 ON memories(mem0_id) WHERE mem0_id IS NOT NULL;

-- Full-text search index for fallback queries
CREATE INDEX idx_memories_content_search ON memories
  USING GIN (to_tsvector('english', content));

-- Trigger to update updated_at on changes
CREATE OR REPLACE FUNCTION update_memories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW
  EXECUTE FUNCTION update_memories_updated_at();
