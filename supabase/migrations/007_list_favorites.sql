-- ============================================================================
-- Per-user list favorites.
--
-- Lists are owned by a single user, and only the owner can favorite their own
-- list (per nav doc). A boolean column on `lists` is enough — no junction
-- table needed for V1.
-- ============================================================================

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS is_favorited BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_lists_favorites
  ON lists(owner_id, updated_at DESC)
  WHERE is_favorited = TRUE AND deleted_at IS NULL;
