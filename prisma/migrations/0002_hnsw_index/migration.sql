-- v0.5: pgvector HNSW index for fast approximate memory search.
-- Requires the vector extension (created in 0001_init).
CREATE INDEX IF NOT EXISTS "MemoryItem_embedding_hnsw_idx"
  ON "MemoryItem"
  USING hnsw ("embedding" vector_cosine_ops);
