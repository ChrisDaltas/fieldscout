-- ============================================================================
-- List thumbnails: a user-uploaded image used as the list's cover. When
-- thumbnail_url is null the UI falls back to the position-tinted placeholder
-- rendered by ListThumbnail.
--
-- Storage layout:
--   bucket: list-thumbnails (public read)
--   path:   <list_id>/<unix_ms>.<ext>
--
-- Owner check on writes is enforced via the lists table — only the list owner
-- may upload/replace/delete an object whose first path segment is their list.
-- ============================================================================

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('list-thumbnails', 'list-thumbnails', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop existing policies so re-running the migration is idempotent.
DROP POLICY IF EXISTS "list-thumbnails public read" ON storage.objects;
DROP POLICY IF EXISTS "list-thumbnails owner insert" ON storage.objects;
DROP POLICY IF EXISTS "list-thumbnails owner update" ON storage.objects;
DROP POLICY IF EXISTS "list-thumbnails owner delete" ON storage.objects;

CREATE POLICY "list-thumbnails public read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'list-thumbnails');

CREATE POLICY "list-thumbnails owner insert"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'list-thumbnails'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id::text = (storage.foldername(name))[1]
      AND lists.owner_id = auth.uid()
      AND lists.deleted_at IS NULL
  )
);

CREATE POLICY "list-thumbnails owner update"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'list-thumbnails'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id::text = (storage.foldername(name))[1]
      AND lists.owner_id = auth.uid()
  )
);

CREATE POLICY "list-thumbnails owner delete"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'list-thumbnails'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id::text = (storage.foldername(name))[1]
      AND lists.owner_id = auth.uid()
  )
);
