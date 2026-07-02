-- ============================================================================
-- Real pre-season projections from Sleeper, stored per scoring variant.
--
-- Why this exists: pre-season the app used to fall back to "last season's
-- actual fantasy points" as the projection, which (a) was visibly wrong to
-- any user who knows football and (b) was structurally a nonsense — by
-- definition, projections are not historical results.
--
-- Going forward: projection numbers come from Sleeper's projections endpoint
-- (`/projections/nfl/<season>?season_type=regular`) which exposes pts_ppr,
-- pts_std, and pts_half_ppr distinctly. Historical fantasy points are still
-- aggregated separately from player_stats and never reused as a projection.
-- ============================================================================

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS projected_pts_ppr        NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS projected_pts_standard   NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS projected_pts_half_ppr   NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS projected_games          NUMERIC(4, 1),
  ADD COLUMN IF NOT EXISTS projections_season       INTEGER,
  ADD COLUMN IF NOT EXISTS projections_updated_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_players_projections_season
  ON players(projections_season);
