-- ============================================================================
-- AI CALL LOG (plan M0 §3.4 — telemetry + rate-limit accounting)
-- ============================================================================
-- One row per Claude call: model, tokens, latency, feature attribution.
-- Doubles as the accounting table for per-user daily rate limits on
-- interactive AI features (/api/lists/generate, /api/ask).
--
-- Numbered 024 to match the plan's appendix (§11.3); 022/023 are reserved for
-- the content-engine tables (M3/M5). Later-numbered files apply cleanly either
-- way because nothing here depends on them.
--
-- SERVICE-ROLE ONLY: RLS enabled with no policies. All writes go through
-- src/lib/claude/telemetry.ts with the admin client.

CREATE TABLE ai_call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- NULL for system jobs (seeds, crons)
  feature TEXT NOT NULL,        -- 'list_generation' | 'persona_seed' | 'persona_refresh' | 'content_ingest' | 'content_generate' | 'ask_ai'
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_call_log ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.

-- Rate-limit lookups: calls by (user, feature) since UTC day start.
CREATE INDEX idx_ai_call_log_user_feature
  ON ai_call_log(user_id, feature, created_at DESC);

-- Cost dashboards: spend per feature over time.
CREATE INDEX idx_ai_call_log_feature ON ai_call_log(feature, created_at DESC);
