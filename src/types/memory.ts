export interface Memory {
  id: string;
  couple_id: string;
  user_id: string | null; // null = couple-level memory
  mem0_id: string | null; // mem0's internal ID
  content: string;
  category: MemoryCategory;
  source_thread_id: string | null;
  source_visibility: "shared" | "dm" | null;
  created_at: Date;
  updated_at: Date;
  last_accessed_at: Date | null;
}

export type MemoryCategory = "fact" | "relationship" | "context";

export interface MemorySearchResult extends Memory {
  relevance_score: number;
  from_partner: boolean;
}

export interface StoreMemoryInput {
  coupleId: string;
  userId?: string | null;
  content: string;
  category: MemoryCategory;
  sourceThreadId?: string | null;
  sourceVisibility?: "shared" | "dm" | null;
}

export interface SearchMemoriesInput {
  coupleId: string;
  userId: string;
  query: string;
  visibility: "shared" | "dm";
  limit?: number;
}

export interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  isExplicit: boolean;
  conflictsWith?: string; // existing memory ID if conflict detected
}
