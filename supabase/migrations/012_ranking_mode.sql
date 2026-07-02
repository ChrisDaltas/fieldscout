-- ============================================================================
-- Migration 012: replace (hide_order, tiers_enabled) with a single ranking_mode
-- enum column.
--
-- A list is ranked in exactly one of three ways:
--   'unranked'       → free-form collection, no canonical order
--   'ranked'         → numbered 1..N
--   'rank_and_tier'  → numbered 1..N, additionally grouped into S–F tiers
--
-- This collapses two independent booleans (4 combos, only 3 valid) into one
-- enum (3 values, all valid). hide_order and tiers_enabled remain as
-- legacy columns for one release as a rollback safety net; a follow-up
-- migration drops them after consumers are confirmed reading ranking_mode.
-- ============================================================================

ALTER TABLE lists
  ADD COLUMN ranking_mode TEXT NOT NULL DEFAULT 'ranked'
    CHECK (ranking_mode IN ('unranked', 'ranked', 'rank_and_tier'));

-- Backfill from the legacy booleans.
-- hide_order wins over tiers_enabled — an unranked list with tiers makes no
-- product sense and we treat hide_order as the dominant signal.
UPDATE lists SET ranking_mode = CASE
  WHEN hide_order = TRUE      THEN 'unranked'
  WHEN tiers_enabled = TRUE   THEN 'rank_and_tier'
  ELSE                             'ranked'
END;

CREATE INDEX idx_lists_ranking_mode ON lists(ranking_mode);
