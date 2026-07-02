-- ============================================================================
-- AI EXPERT PERSONAS (spec-ai-expert-personas.md, plan M1)
-- ============================================================================
-- Fictional, parody-named analyst personas. Application-level records, NOT
-- Supabase Auth users. Their lists are owned by the system expert account:
--
--   SYSTEM EXPERT OWNER DECISION (plan §4.3): the owner is a seeded profiles
--   row with username 'fieldscout-ai', created by scripts/seed-ai-personas.ts
--   (auth admin user + profile, is_pro = TRUE so no free-tier caps apply).
--   Code resolves it by username — there is no hardcoded UUID constant.
--
-- A list is persona-owned when
--   owner_id = <fieldscout-ai profile id> AND ai_persona_id IS NOT NULL.
--
-- Takedown: set is_active = FALSE on the persona (or deleted_at on specific
-- lists). App surfaces filter on is_active; no schema work needed.

CREATE TABLE ai_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,            -- 'bathew-merry-ai'
  display_name TEXT NOT NULL,               -- 'Bathew Merry (AI)'
  bio TEXT NOT NULL,                        -- persona-voiced bio, includes parody disclaimer
  avatar_url TEXT,                          -- AI-generated cartoon avatar, never a real likeness
  style_profile JSONB NOT NULL,             -- structured tendencies (voice, biases, leans)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ                    -- soft delete, per project convention
);

ALTER TABLE ai_personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_personas readable by all"
  ON ai_personas FOR SELECT USING (deleted_at IS NULL);
-- No insert/update/delete policies: managed by service role via seed/sync scripts only.

CREATE INDEX idx_ai_personas_active ON ai_personas(is_active) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- lists.ai_persona_id: marks a list as persona-generated
-- ---------------------------------------------------------------------------

ALTER TABLE lists ADD COLUMN ai_persona_id UUID REFERENCES ai_personas(id);

CREATE INDEX idx_lists_ai_persona ON lists(ai_persona_id)
  WHERE ai_persona_id IS NOT NULL AND deleted_at IS NULL;
