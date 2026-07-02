-- ============================================================================
-- Mark fantasy-positioned players with no team as Retired.
--
-- Sleeper marks legendary retirees (Frank Gore, Adrian Peterson, Larry
-- Fitzgerald, etc.) with active=true, so the initial sync pulled them into
-- our players table. The reliable signal that a player is no longer on an
-- NFL roster is `team IS NULL`; we already filter on that at query time, but
-- updating their status here makes them easy to identify in the DB and keeps
-- legitimate "Inactive / IR" cases distinct.
-- ============================================================================

UPDATE players
SET status = 'Retired',
    updated_at = NOW()
WHERE team IS NULL
  AND status NOT IN ('Retired', 'Inactive', 'Injured Reserve')
  AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF');
