-- ============================================================================
-- Player Data Pipeline — adds columns required by Sleeper sync, nflverse
-- historical stats load, and mock current-season stats.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- players: sleeper_id (canonical id from Sleeper API), search_name (lowercased
-- name for ILIKE matching), adp (average draft position).
-- Existing rows: backfill sleeper_id from id since players.id is already the
-- Sleeper player_id, and search_name from full_name.
-- ----------------------------------------------------------------------------
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS sleeper_id TEXT,
  ADD COLUMN IF NOT EXISTS search_name TEXT,
  ADD COLUMN IF NOT EXISTS adp NUMERIC;

UPDATE players SET sleeper_id = id WHERE sleeper_id IS NULL;
UPDATE players SET search_name = lower(full_name) WHERE search_name IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_sleeper_id ON players(sleeper_id);
CREATE INDEX IF NOT EXISTS idx_players_search_name ON players(search_name);
CREATE INDEX IF NOT EXISTS idx_players_adp ON players(adp) WHERE adp IS NOT NULL;

-- ----------------------------------------------------------------------------
-- player_stats: source ('historical' | 'live' | 'mock') so we can distinguish
-- nflverse-loaded historical rows from mocked current-season rows.
-- ----------------------------------------------------------------------------
ALTER TABLE player_stats
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'historical';

CREATE INDEX IF NOT EXISTS idx_player_stats_source ON player_stats(source);
