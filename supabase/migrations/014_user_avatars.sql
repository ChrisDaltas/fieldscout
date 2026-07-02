-- ============================================================================
-- User profile avatars: a per-user uploaded image used wherever the user
-- appears in the UI. When profiles.avatar_url is null the UI falls back to
-- the user's initials.
--
-- Storage layout:
--   bucket: user-avatars (public read)
--   path:   <user_id>/<unix_ms>.<ext>
--
-- Owner check on writes is enforced via the storage path's first segment.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('user-avatars', 'user-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "user-avatars public read" ON storage.objects;
DROP POLICY IF EXISTS "user-avatars owner insert" ON storage.objects;
DROP POLICY IF EXISTS "user-avatars owner update" ON storage.objects;
DROP POLICY IF EXISTS "user-avatars owner delete" ON storage.objects;

CREATE POLICY "user-avatars public read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'user-avatars');

CREATE POLICY "user-avatars owner insert"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'user-avatars'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "user-avatars owner update"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'user-avatars'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "user-avatars owner delete"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'user-avatars'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);
