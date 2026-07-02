-- ============================================================================
-- PERSONA SOURCE RANKINGS (spec-ai-expert-personas.md, plan M1)
-- ============================================================================
-- Raw scraped ranks from each persona's real-analyst source (free,
-- non-paywalled pages only). source_url is retained on every row for
-- traceability and takedown compliance. Ranks may mirror the source exactly;
-- prose never does — rationales are always Claude-original.
--
-- SERVICE-ROLE ONLY: RLS is enabled with no policies, so neither anon nor
-- authenticated clients can read or write. Scripts and Edge Functions use the
-- service role, which bypasses RLS.

CREATE TABLE persona_source_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  source_url TEXT NOT NULL,
  source_published_at DATE,
  position TEXT,                              -- 'Overall', 'QB', 'RB', ...
  scoring TEXT,                               -- 'PPR', 'Half-PPR', 'Standard'
  raw_rankings JSONB NOT NULL,                -- [{rank, player_name, team}, ...]
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE persona_source_rankings ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. Never exposed to clients.

CREATE INDEX idx_persona_source_rankings_persona
  ON persona_source_rankings(ai_persona_id, position, scraped_at DESC);
