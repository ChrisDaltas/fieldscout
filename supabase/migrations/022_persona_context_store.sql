-- ============================================================================
-- PERSONA CONTEXT STORE (spec-ai-content-engine.md, plan M3 — Slice A)
-- ============================================================================
-- The per-persona knowledge layer: where to look for content
-- (persona_sources), what was ingested (persona_content_items), the living
-- synthesized "context file" (persona_context), and its audit history
-- (persona_context_versions).
--
-- ALL FOUR TABLES ARE SERVICE-ROLE ONLY: RLS enabled with no policies.
-- Operational/synthesized data is never served raw to clients — server-side
-- generation routes read it via the admin client.

-- ---------------------------------------------------------------------------
-- persona_sources: where to look for each persona's content
-- ---------------------------------------------------------------------------

CREATE TABLE persona_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  type TEXT NOT NULL,                    -- 'rss' | 'youtube' | 'web' | 'podcast'
  url TEXT NOT NULL,
  label TEXT,                            -- 'NBC weekly rankings', 'YouTube channel', etc.
  is_paywalled BOOLEAN DEFAULT FALSE,    -- if TRUE, never ingested
  -- change-detection state (consumed by the Slice B daily cron)
  etag TEXT,                             -- HTTP ETag / Last-Modified, when available
  last_listing_hash TEXT,                -- hash of the listing/feed for diffing
  last_item_published_at TIMESTAMPTZ,    -- newest item seen so far
  last_checked_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE persona_sources ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. Operational metadata, never served to clients.

CREATE INDEX idx_persona_sources_persona
  ON persona_sources(ai_persona_id) WHERE is_active = TRUE AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- persona_content_items: each discrete ingested piece of content
-- ---------------------------------------------------------------------------

CREATE TABLE persona_content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  source_id UUID REFERENCES persona_sources(id),
  source_url TEXT NOT NULL,
  source_type TEXT,                      -- 'rss' | 'youtube' | 'web' | 'podcast'
  title TEXT,
  published_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL,            -- dedupe key
  extracted JSONB NOT NULL,              -- structured signals from Claude (player_takes, themes, format, kind)
  raw_excerpt TEXT,                      -- short excerpt for traceability only, never full prose
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ai_persona_id, content_hash)
);

ALTER TABLE persona_content_items ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. raw_excerpt exists for audit/takedown traceability.

CREATE INDEX idx_persona_content_items_persona
  ON persona_content_items(ai_persona_id, ingested_at DESC);

-- ---------------------------------------------------------------------------
-- persona_context: the living "context file" — one current row per persona
-- ---------------------------------------------------------------------------

CREATE TABLE persona_context (
  ai_persona_id UUID PRIMARY KEY REFERENCES ai_personas(id),
  context JSONB NOT NULL,                -- synthesized living context (as_of, current_stances, recent_movements, themes_in_play, source_log)
  rendered_md TEXT,                      -- human-readable rendering for inspection/QA
  version INTEGER DEFAULT 1,
  source_item_count INTEGER DEFAULT 0,
  last_material_change_at TIMESTAMPTZ,   -- set when a refresh meaningfully changed stances
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE persona_context ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. Read by server-side generation routes via the service role.

-- ---------------------------------------------------------------------------
-- persona_context_versions: audit history (big_board_snapshots pattern)
-- ---------------------------------------------------------------------------

CREATE TABLE persona_context_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  version INTEGER NOT NULL,
  context JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE persona_context_versions ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.

CREATE INDEX idx_persona_context_versions_persona
  ON persona_context_versions(ai_persona_id, version DESC);
