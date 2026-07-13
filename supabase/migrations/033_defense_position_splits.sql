-- Implied defensive splits by position (sync-splits.ts): how much facing a
-- given defense moves a position's projected output, derived from the
-- matchup-adjusted weekly projections (deviation from each player's own
-- weekly average, volume-weighted). Forward-looking — no last-season stats.
--
-- factor: 1.0 = neutral matchup; >1 boosts the position, <1 suppresses it.
-- rank: 1-32 within a position, 1 = most generous (easiest matchup).
-- Read-only player data, populated by sync scripts only.
CREATE TABLE IF NOT EXISTS defense_position_splits (
  defense TEXT NOT NULL,
  position TEXT NOT NULL,
  season INTEGER NOT NULL,
  factor NUMERIC NOT NULL,
  rank INTEGER NOT NULL,
  sample_weeks INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (defense, position, season)
);

ALTER TABLE defense_position_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Defense splits are viewable by everyone"
  ON defense_position_splits FOR SELECT USING (true);
