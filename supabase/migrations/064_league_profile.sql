-- ============================================================================
-- League profile (rename + avatar) — out-of-band product request (Chris,
-- 2026-08-03): the settings panel gets a League-profile section where the
-- commissioner renames the league and uploads a league avatar image.
--
-- Three pieces:
--   1. leagues.avatar_url — nullable TEXT; the UI falls back to initials
--      (same convention as profiles.avatar_url, migration 014).
--   2. Storage bucket `league-avatars` (public read), path
--      <league_id>/<unix_ms>.<ext>. Writes are gated on the caller being
--      commissioner of the league named by the path's first segment —
--      the 014 owner-check pattern with is_league_commish (052) standing in
--      for the auth.uid() path match. A UUID shape guard precedes the cast
--      so a malformed path fails the policy, not the cast.
--   3. update_league_profile RPC — the ONLY write path for name/avatar_url
--      (054 revoked direct league writes; server-authoritative always).
--      House RPC form per 038/061: SECURITY DEFINER, search_path = '',
--      in-body commish check (42501), soft-deleted = not found, and the
--      explicit REVOKE (037's default ACLs would otherwise hand anon
--      EXECUTE — see 063's banner).
--
-- Name bounds mirror create_league's input contract (1–100 after trim).
-- Status is deliberately NOT consulted: renaming / re-cresting is cosmetic
-- and allowed in every league status, unlike the §7.1 structural lock.
-- ============================================================================

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ---------------------------------------------------------------------------
-- Storage bucket + policies (014 pattern, commissioner-gated writes)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('league-avatars', 'league-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "league-avatars public read" ON storage.objects;
DROP POLICY IF EXISTS "league-avatars commish insert" ON storage.objects;
DROP POLICY IF EXISTS "league-avatars commish update" ON storage.objects;
DROP POLICY IF EXISTS "league-avatars commish delete" ON storage.objects;

CREATE POLICY "league-avatars public read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'league-avatars');

CREATE POLICY "league-avatars commish insert"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'league-avatars'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1]
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.is_league_commish(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "league-avatars commish update"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'league-avatars'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1]
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.is_league_commish(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "league-avatars commish delete"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'league-avatars'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1]
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.is_league_commish(((storage.foldername(name))[1])::uuid)
);

-- ---------------------------------------------------------------------------
-- update_league_profile — rename and/or set/clear the avatar
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_league_profile(
  p_league_id UUID,
  p_name TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL,
  p_clear_avatar BOOLEAN DEFAULT FALSE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'update_league_profile: commissioner only'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_league_profile: league % not found', p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) < 1 OR length(v_name) > 100 THEN
      -- Field-named message: the route maps it to a per-field 400.
      RAISE EXCEPTION 'name: League name must be between 1 and 100 characters'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.leagues
    SET name = v_name, updated_at = now()
    WHERE id = p_league_id;
  END IF;

  IF p_clear_avatar THEN
    UPDATE public.leagues
    SET avatar_url = NULL, updated_at = now()
    WHERE id = p_league_id;
  ELSIF p_avatar_url IS NOT NULL THEN
    UPDATE public.leagues
    SET avatar_url = p_avatar_url, updated_at = now()
    WHERE id = p_league_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_league_profile(UUID, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
