-- ============================================================================
-- Big Board snapshots + weekly Big Boards
--
-- big_board_snapshots: every "Update Big Board" save writes one row capturing
--   the full ordered player list at that moment, so the user can restore any
--   prior state (PRD F2A "workspace behavior — explicit save required").
--
-- big_board_weekly: per-week Big Board lists (1–18). Each row points to a
--   normal `lists` row that holds the actual players, so the same drag/drop
--   plumbing the season-long Big Board uses works unchanged for weeklies.
--   Weekly carryover (the previous week's order) is materialized lazily by
--   the API on first GET.
-- ============================================================================

CREATE TABLE IF NOT EXISTS big_board_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- snapshot_data is an ordered array of { player_id, position, full_name,
  -- position_code, team } objects — denormalized so a snapshot still renders
  -- even if a player is later removed from the lists/players tables.
  snapshot_data JSONB NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_big_board_snapshots_user_saved
  ON big_board_snapshots(user_id, saved_at DESC);

ALTER TABLE big_board_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Snapshots: owner read" ON big_board_snapshots;
DROP POLICY IF EXISTS "Snapshots: owner write" ON big_board_snapshots;

CREATE POLICY "Snapshots: owner read"
  ON big_board_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Snapshots: owner write"
  ON big_board_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


CREATE TABLE IF NOT EXISTS big_board_weekly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 18),
  season INTEGER NOT NULL,
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, week_number, season)
);

CREATE INDEX IF NOT EXISTS idx_big_board_weekly_user
  ON big_board_weekly(user_id, season, week_number);

ALTER TABLE big_board_weekly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Weekly: owner read" ON big_board_weekly;
DROP POLICY IF EXISTS "Weekly: owner write" ON big_board_weekly;

CREATE POLICY "Weekly: owner read"
  ON big_board_weekly FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Weekly: owner write"
  ON big_board_weekly FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
