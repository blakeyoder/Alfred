-- Migration: Drop memories table
-- Now using mem0 Cloud as sole memory storage via @mem0/vercel-ai-provider

DROP TABLE IF EXISTS memories;
