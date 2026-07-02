-- ============================================================================
-- Migration 013: per-user list favorites via junction table.
--
-- Replaces the single `lists.is_favorited` boolean (owner-only) with a true
-- per-user model so any user can favorite any non-private list and have it
-- appear in their own sidebar.
--
-- The legacy column stays for one release as a rollback safety net; a follow-up
-- migration drops it after the new junction is confirmed live.
-- ============================================================================

CREATE TABLE list_favorites (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, list_id)
);

CREATE INDEX idx_list_favorites_user ON list_favorites(user_id, created_at DESC);
CREATE INDEX idx_list_favorites_list ON list_favorites(list_id);

-- Backfill from the legacy boolean. Today only owners can favorite their own
-- list, so the (owner_id, list_id) pair is the correct insert. ON CONFLICT
-- handles the rare case where someone re-runs the migration.
INSERT INTO list_favorites (user_id, list_id)
SELECT owner_id, id
FROM lists
WHERE is_favorited = TRUE
  AND deleted_at IS NULL
ON CONFLICT (user_id, list_id) DO NOTHING;

-- RLS: any signed-in user can read their own favorite rows; nobody else's.
ALTER TABLE list_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "list_favorites self read"
ON list_favorites FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "list_favorites self write"
ON list_favorites FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id = list_id
      AND lists.deleted_at IS NULL
      AND (lists.is_private = FALSE OR lists.owner_id = auth.uid())
  )
);

CREATE POLICY "list_favorites self delete"
ON list_favorites FOR DELETE
USING (user_id = auth.uid());
