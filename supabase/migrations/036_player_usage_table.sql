-- Usage rates move from stamped players columns to a per-season table so the
-- Big Board and Research can share one filterable source (product rule:
-- "big board and research should be pulling the same stats always").
-- Both seasons coexist; nothing overwrites last season when a new one starts.
CREATE TABLE IF NOT EXISTS player_usage (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  snap_pct NUMERIC,
  target_share NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, season)
);

ALTER TABLE player_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Player usage is viewable by everyone"
  ON player_usage FOR SELECT USING (true);

-- Migrate the currently stamped values (they were computed from usage_season).
INSERT INTO player_usage (player_id, season, snap_pct, target_share)
SELECT id, usage_season, snap_pct, target_share
FROM players
WHERE usage_season IS NOT NULL
  AND (snap_pct IS NOT NULL OR target_share IS NOT NULL)
ON CONFLICT (player_id, season) DO NOTHING;

ALTER TABLE players
  DROP COLUMN IF EXISTS snap_pct,
  DROP COLUMN IF EXISTS target_share,
  DROP COLUMN IF EXISTS usage_season;
