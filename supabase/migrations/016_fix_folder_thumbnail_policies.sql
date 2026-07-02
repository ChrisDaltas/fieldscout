-- ============================================================================
-- Migration 016: fix the folder-thumbnails storage RLS policies.
--
-- The policies added in 015 referenced an unqualified `name` inside a
-- `SELECT 1 FROM list_folders` subquery. Because list_folders ALSO has a
-- `name` column, `name` bound to list_folders.name (the folder's title)
-- instead of the storage object's path — so the ownership check
--   list_folders.id::text = (storage.foldername(name))[1]
-- could never be true and every upload was denied by RLS.
--
-- Qualifying it as storage.objects.name makes it reference the object path
-- (e.g. '<folder_id>/<ts>.png') as intended.
-- ============================================================================

DROP POLICY IF EXISTS "folder-thumbnails owner insert" ON storage.objects;
DROP POLICY IF EXISTS "folder-thumbnails owner update" ON storage.objects;
DROP POLICY IF EXISTS "folder-thumbnails owner delete" ON storage.objects;

CREATE POLICY "folder-thumbnails owner insert"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'folder-thumbnails'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM list_folders
    WHERE list_folders.id::text = (storage.foldername(storage.objects.name))[1]
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
    WHERE list_folders.id::text = (storage.foldername(storage.objects.name))[1]
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
    WHERE list_folders.id::text = (storage.foldername(storage.objects.name))[1]
      AND list_folders.owner_id = auth.uid()
  )
);
