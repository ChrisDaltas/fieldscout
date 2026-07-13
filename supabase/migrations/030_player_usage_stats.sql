-- Season usage rates from Sleeper season stats (sync-season-usage.ts).
-- snap_pct: offensive snaps / team offensive snaps, 0–100.
-- target_share: targets / team pass attempts, 0–100.
-- usage_season: the season the rates were computed from (pre-draft this is
-- last season; in-season syncs overwrite with the current one).
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS snap_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS target_share NUMERIC,
  ADD COLUMN IF NOT EXISTS usage_season INTEGER;
