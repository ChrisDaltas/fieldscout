-- ============================================================================
-- Migration 015: team lists (roster settings + per-player slots) and
-- sidebar folders.
--
-- Team lists: a list with is_team = TRUE carries roster_settings (JSONB:
-- { total, qb, rb, wr, te, flex, k, dst, bench, ir }) and each list_players
-- row can be assigned to a roster slot. Slot is presentation/assignment
-- state — NULL means "not yet slotted" and the UI shows the player on the
-- bench.
--
-- Folders: personal organisation for the sidebar. A list belongs to at most
-- one folder. Deleting a folder never deletes lists — folder_id is
-- ON DELETE SET NULL so they simply become folderless again.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Team lists
-- ---------------------------------------------------------------------------

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS roster_settings JSONB;

ALTER TABLE list_players
  ADD COLUMN IF NOT EXISTS slot TEXT
    CHECK (slot IN ('QB', 'RB', 'WR', 'FLEX', 'TE', 'DST', 'K', 'IR', 'BENCH'));

-- ---------------------------------------------------------------------------
-- Folders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS list_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_list_folders_owner ON list_folders(owner_id, created_at DESC);

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES list_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lists_folder ON lists(folder_id) WHERE folder_id IS NOT NULL;

-- Folders are personal — owner-only for every operation.
ALTER TABLE list_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "list_folders owner all" ON list_folders;
CREATE POLICY "list_folders owner all"
ON list_folders
FOR ALL
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Folder thumbnails — same storage pattern as list-thumbnails (009).
--   bucket: folder-thumbnails (public read)
--   path:   <folder_id>/<unix_ms>.<ext>
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('folder-thumbnails', 'folder-thumbnails', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "folder-thumbnails public read" ON storage.objects;
DROP POLICY IF EXISTS "folder-thumbnails owner insert" ON storage.objects;
DROP POLICY IF EXISTS "folder-thumbnails owner update" ON storage.objects;
DROP POLICY IF EXISTS "folder-thumbnails owner delete" ON storage.objects;

CREATE POLICY "folder-thumbnails public read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'folder-thumbnails');

CREATE POLICY "folder-thumbnails owner insert"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'folder-thumbnails'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM list_folders
    WHERE list_folders.id::text = (storage.foldername(name))[1]
      AND list_folders.owner_id = auth.uid()
  )
);

CREATE POLICY "folder-thumbnails owner update"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'folder-thumbnails'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM list_folders
    WHERE list_folders.id::text = (storage.foldername(name))[1]
      AND list_folders.owner_id = auth.uid()
  )
);

CREATE POLICY "folder-thumbnails owner delete"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'folder-thumbnails'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM list_folders
    WHERE list_folders.id::text = (storage.foldername(name))[1]
      AND list_folders.owner_id = auth.uid()
  )
);
