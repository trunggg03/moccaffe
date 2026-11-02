-- Add vector embedding column to products table for chatbot semantic search
-- This column stores embedding vectors as comma-separated floats (768-dimensional)
-- Used with Cloudflare Workers AI for embeddings and similarity search
ALTER TABLE products ADD COLUMN embedding TEXT;

-- Index not needed for TEXT in SQLite, but we note that future queries will:
--   SELECT id, name, embedding FROM products
--   WHERE embedding IS NOT NULL
--   AND embedding LIKE '%<search_term>%'  -- simplified; real similarity uses LLM cosine distance
-- ORDER BY embedding <=> <target_vector>  -- once vector extension is available
;