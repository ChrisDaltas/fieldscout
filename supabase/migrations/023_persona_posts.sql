-- ============================================================================
-- PERSONA POSTS (spec-ai-content-engine.md, plan M5 — Slice C)
-- ============================================================================
-- Automated editorial content: persona-voiced posts wrapping an optional
-- backing list (e.g. the ranked "Top Busts" list). Every post is original AI
-- prose attributed to the fictional persona, with a citations array linking
-- the public sources behind factual claims.
--
-- Review gate: posts land as status = 'draft' and are promoted to
-- 'published' by an admin (human-in-the-loop is the default; trusted
-- auto-publish is a later toggle). Takedown = deleted_at, same as personas.

CREATE TABLE persona_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  list_id UUID REFERENCES lists(id),     -- optional backing list
  kind TEXT NOT NULL,                    -- 'themed_list' | 'take' | 'weekly_movers'
  title TEXT NOT NULL,                   -- persona-voiced, parody name only
  slug TEXT NOT NULL,
  dek TEXT,                              -- subtitle / summary
  body_md TEXT NOT NULL,                 -- original AI prose with per-player justification
  citations JSONB NOT NULL,              -- [{ "claim": "...", "source_url": "...", "published_at": "..." }]
  status TEXT DEFAULT 'draft',           -- 'draft' | 'published'
  published_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ai_persona_id, slug)
);

ALTER TABLE persona_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published persona posts are viewable by everyone"
  ON persona_posts FOR SELECT USING (status = 'published' AND deleted_at IS NULL);
-- No insert/update/delete policies: written by service role (generation job
-- + admin review routes) only.

CREATE INDEX idx_persona_posts_published
  ON persona_posts(published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX idx_persona_posts_persona
  ON persona_posts(ai_persona_id, created_at DESC) WHERE deleted_at IS NULL;
