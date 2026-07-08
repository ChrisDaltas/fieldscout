-- ----------------------------------------------------------------------------
-- Favorites list
-- ----------------------------------------------------------------------------
-- A per-user default "quick save" list (title "Favorites"), analogous to the
-- big board. It's the fast way to save players without building a list by
-- hand: the players table's pin/favorite action toggles a player in and out of
-- this list, auto-creating it on first use. Not private, so it doesn't count
-- against the free-tier private-list cap.

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS is_favorites boolean NOT NULL DEFAULT false;

-- At most one live favorites list per owner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_one_favorites_per_owner
  ON lists (owner_id)
  WHERE is_favorites AND deleted_at IS NULL;
