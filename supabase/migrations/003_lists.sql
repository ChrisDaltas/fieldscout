-- ============================================================================
-- Lists, list_players, list_likes, list_comments, tags, list_tags
--
-- The base tables already exist from 001_initial_schema.sql. This migration
-- brings them into line with the V1 lists API spec:
--
--   * list_players.position (1-based ordering, NOT NULL) — canonical row order
--   * list_players.tier      TEXT 'S'/'A'/'B'/'C'/'D'/'F' (was INTEGER)
--   * list_comments.parent_id (renamed from parent_comment_id)
--   * list_comments.body      ≤ 1000 chars (was 500)
--
-- Plus: like_count trigger, expanded system tag seed (Sleepers, Busts, etc.
-- and Week 1–18). The handle_new_user trigger from 001 already creates a
-- Big Board for each new user — left unchanged.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- list_players: add canonical 1-based position, switch tier to TEXT
-- ----------------------------------------------------------------------------
ALTER TABLE list_players
  ADD COLUMN IF NOT EXISTS position INTEGER;

-- Backfill position from overall_rank where applicable so existing data has a
-- sane value before NOT NULL kicks in. New rows are populated by the API.
UPDATE list_players
SET position = COALESCE(overall_rank, 1)
WHERE position IS NULL;

ALTER TABLE list_players
  ALTER COLUMN position SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_list_players_position
  ON list_players(list_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS idx_list_players_list_position_unique
  ON list_players(list_id, position);

-- Convert tier from INTEGER to TEXT (S/A/B/C/D/F). The DROP/ADD pattern is
-- safe here because lists is freshly seeded — no production data yet.
ALTER TABLE list_players DROP COLUMN IF EXISTS tier;
ALTER TABLE list_players
  ADD COLUMN tier TEXT
  CHECK (tier IS NULL OR tier IN ('S', 'A', 'B', 'C', 'D', 'F'));

-- ----------------------------------------------------------------------------
-- list_comments: rename parent_comment_id -> parent_id, expand body to 1000
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'list_comments' AND column_name = 'parent_comment_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'list_comments' AND column_name = 'parent_id'
  ) THEN
    EXECUTE 'ALTER TABLE list_comments RENAME COLUMN parent_comment_id TO parent_id';
  END IF;
END $$;

-- Drop the old 500-char check (whatever Postgres named it) and re-add at 1000.
DO $$
DECLARE
  c_name TEXT;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'list_comments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%char_length(body)%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE list_comments DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE list_comments
  ADD CONSTRAINT list_comments_body_length_check
  CHECK (char_length(body) <= 1000);

-- ----------------------------------------------------------------------------
-- like_count trigger on list_likes
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_list_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE lists SET like_count = like_count + 1 WHERE id = NEW.list_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE lists SET like_count = like_count - 1 WHERE id = OLD.list_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_list_like_change ON list_likes;
CREATE TRIGGER on_list_like_change
  AFTER INSERT OR DELETE ON list_likes
  FOR EACH ROW EXECUTE FUNCTION update_list_like_count();

-- ----------------------------------------------------------------------------
-- Seed system tags (idempotent via ON CONFLICT)
-- ----------------------------------------------------------------------------
INSERT INTO tags (name, slug, is_system_tag) VALUES
  ('Sleepers',      'sleepers',      TRUE),
  ('Busts',         'busts',         TRUE),
  ('Breakouts',     'breakouts',     TRUE),
  ('Bounceback',    'bounceback',    TRUE),
  ('Must-Start',    'must-start',    TRUE),
  ('Avoid',         'avoid',         TRUE),
  ('Deep Cuts',     'deep-cuts',     TRUE),
  ('Rookies',       'rookies',       TRUE),
  ('Veterans',      'veterans',      TRUE),
  ('Dynasty',       'dynasty',       TRUE),
  ('Redraft',       'redraft',       TRUE),
  ('Best Ball',     'best-ball',     TRUE),
  ('DFS',           'dfs',           TRUE),
  ('Superflex',     'superflex',     TRUE),
  ('PPR',           'ppr',           TRUE),
  ('Half-PPR',      'half-ppr',      TRUE),
  ('Standard',      'standard',      TRUE),
  ('TE Premium',    'te-premium',    TRUE),
  ('Draft Day',     'draft-day',     TRUE),
  ('Waiver Wire',   'waiver-wire',   TRUE),
  ('Trade Targets', 'trade-targets', TRUE),
  ('Buy-Low',       'buy-low',       TRUE),
  ('Sell-High',     'sell-high',     TRUE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO tags (name, slug, is_system_tag)
SELECT format('Week %s', w), format('week-%s', w), TRUE
FROM generate_series(1, 18) AS w
ON CONFLICT (slug) DO NOTHING;
