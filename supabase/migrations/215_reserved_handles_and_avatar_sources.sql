-- ============================================================================
-- 215 — Community hardening: reserved brand / staff handles, and where a
--       profile picture may come from (Community launch plan C11; readiness
--       S18, S19; FULL rigour — permissions)
-- ============================================================================
--
-- Chris's go 2026-10-29 ("go on all of Community"), on the plan he approved
-- 2026-10-27 ("go with your recommendations on the rest").
--
-- PART 1 — reserved handles (S19). A stranger could sign up as @fieldscout,
--   @admin, @support or @moderator and comment as if speaking for the site.
--   `username_is_reserved_internal(handle)` answers "is this one of ours?":
--     * the brand anywhere in the handle — "fieldscout", read with the
--       underscores taken out and look-alike digits read as letters
--       (0→o, 1→i or l, 3→e, 4→a, 5→s, 7→t): field_scout, fieldsc0ut,
--       the_fieldscout, fieldscout_gg, fieldscout_support …
--     * a staff / system word on its own (the word list below), optionally
--       with "fs", "the" or "official" in front, "team", "hq", "desk" or
--       "official" behind, and numbers on the end: admin, fs_admin,
--       support_team, moderator1, the_mods …
--     * the AI-account shape written with underscores (…_ai). The hyphen
--       shape (…-ai) is already reserved by 040 / 050's guard and CHECK.
--   It is a pure function of the text. The app's username form mirrors it
--   (src/lib/auth/username-contract.ts; a unit test reads the brand and the
--   three word lists below out of this file and fails if the two drift).
--
--   Only a NEW claim is refused — never an existing holder:
--     * guard_username_namespace (re-created from 050, the newer of its two
--       definitions — 040, 050; grep of every migration 2026-10-29)
--       gains one block: a client role (auth.role() authenticated / anon,
--       050's test, unchanged) may not INSERT a reserved handle or UPDATE a
--       handle TO one. An UPDATE that leaves the handle alone (a bio or
--       picture edit by someone who already holds one) is untouched. The
--       server — service role, migrations, psql, the signup trigger (role
--       NULL) — stays exempt, as for 050's two blocks. 050's two blocks and
--       their messages are byte-unchanged.
--     * handle_new_user (re-created from 076 — the newest definition and, by
--       076's own header, the authoritative one; no later migration defines
--       it: grep 2026-10-29). The signup trigger runs with auth.role() NULL,
--       so the guard above cannot see a signup (076's header says why); a
--       reserved handle in signup metadata falls back to the id-derived
--       placeholder, exactly as 049 / 050 / 076 already do for the "-ai" and
--       placeholder shapes. The person then picks a handle on the username
--       screen, where the guard (and the form, first) says "reserved". Signup
--       itself never fails. Two additions (this condition and Part 2's
--       picture check); 076's username checks, the no-name rule, the Big
--       Board insert, search_path '' and the EXCEPTION handler are
--       byte-unchanged (the PR shows the diff).
--   The format CHECK is NOT touched: a CHECK re-validates every row, and an
--   existing holder must keep their handle.
--
-- PART 2 — where a profile picture may come from (S18). An avatar could
--   point at any web address, so every Community viewer would load an image
--   from a stranger's server (their IP address exposed, the picture
--   swappable at will). `profile_avatar_url_allowed_internal(url)` allows:
--     * NULL or empty — no picture;
--     * the app's own pictures: /avatars/<folders>/<name>.(svg|png|jpg|jpeg|
--       webp|gif) — the AI experts' self-hosted avatars
--       (scripts/seed-ai-personas.ts: /avatars/personas/<handle>.svg);
--     * our own storage: <this project's origin>/storage/v1/object/public/
--       user-avatars/<folders>/<name>.(png|jpg|jpeg|webp|gif) — what
--       /api/profile/avatar stores (getPublicUrl). "This project's origin" is
--       read from the signed-in caller's JWT issuer (`iss` =
--       <origin>/auth/v1, which GoTrue sets from the project's own API URL —
--       the same origin the app's Supabase URL names), so no project name is
--       written in this public repo and local / hosted each allow only
--       their own storage. No issuer (no JWT) means this branch allows
--       nothing.
--     * the sign-in provider's avatar host: NONE. The app signs people in by
--       email only (no signInWithOAuth anywhere in src/ or its history; no
--       [auth.external.*] provider enabled in supabase/config.toml), so no
--       provider host is allowed. Add the provider's avatar host here when one
--       is switched on.
--   Every path segment is letters, digits, "_" or "-"; the file has one image
--   extension; nothing else (no "..", "%", "?", "#", "@", "//", "\").
--   Applied in two places, both only when a picture is being SET:
--     * trg_profiles_avatar_source_guard — BEFORE UPDATE OF avatar_url, WHEN
--       the value actually changes. A client statement only (current_user
--       anon / authenticated — D662, the 206 / 210 house test); the server
--       and DEFINER doors run as their owner. So someone whose current
--       picture is outside the list can still edit their bio, and a whole-row
--       save that writes the picture back unchanged is never checked.
--       Existing avatars are reported (the PR's read-only check), never
--       rewritten. Profiles has no INSERT policy (206 §2a), so UPDATE is the
--       only client door.
--     * handle_new_user — the signup metadata's avatar_url is kept only when
--       allowed, otherwise the profile starts with no picture (the same
--       "metadata may only claim what's allowed" rule as the handle). Signup
--       never fails over it.
--
-- NOT HERE (and why):
--   * "List updated" alerts for public lists only — 210 (#541, F714) owns
--     notify_list_followers; this migration does not touch it.
--   * Storage bucket limits (F715) — 210's; untouched.
--   * 210's guard_profile_* functions and profiles' column-level SELECT —
--     untouched (nothing here reads a profile column at all).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * D137: guard_username_namespace from 050, handle_new_user from 076 —
--     the newest migration that defines each (live bodies verified equal to
--     those files before this was written); not pg_get_functiondef.
--   * 210 / 212 / 213 / 214 define none of the objects below.
--   * search_path = '' on all five functions, every name schema-qualified.
--     handle_new_user stays SECURITY DEFINER (its REVOKE-free ACL is kept by
--     CREATE OR REPLACE, as 076 left it); the rest are INVOKER.
--   * Grants: username_is_reserved_internal — EXECUTE anon, authenticated,
--     service_role (the INVOKER namespace guard calls it as the client; a
--     pure predicate over a public list); profile_avatar_url_allowed_internal
--     — EXECUTE authenticated, service_role (the INVOKER avatar guard calls
--     it as the client); the avatar trigger function — closed to PUBLIC,
--     anon, authenticated (never called directly). PUBLIC holds none.
--   * Existing rows: none read, none rewritten; no CHECK added.
--   * R6 / D38 waivers: none needed — no league table, no realtime, no RPC
--     that writes (the two predicates read nothing but their argument and
--     the caller's JWT).
--   * Deploy before push: the app change (the username form's reserved
--     check) reads nothing from the database, so main works on 214 and 215.
--   * Rollback: DROP the trigger and the three new functions; re-run 050's
--     guard_username_namespace body and 076's handle_new_user body.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1a — which handles are ours
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.username_is_reserved_internal(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  WITH lists AS (
    SELECT
      'fieldscout'::text AS brand,                                                    -- reserved:brand
      ARRAY['admin', 'admins', 'administrator', 'administrators', 'sysadmin', 'root', 'system',
            'support', 'help', 'helpdesk', 'moderator', 'moderators', 'mod', 'mods', 'staff',
            'official', 'team', 'security', 'abuse', 'legal', 'privacy', 'billing', 'api',
            'www', 'noreply', 'webmaster', 'postmaster']::text[] AS words,             -- reserved:words
      ARRAY['fs', 'the', 'official']::text[] AS before,                               -- reserved:before
      ARRAY['team', 'hq', 'desk', 'official']::text[] AS after                        -- reserved:after
  ), handle AS (
    -- Underscores out; the same handle with any trailing number taken off.
    SELECT replace(lower(COALESCE(p_username, '')), '_', '') AS flat,
           regexp_replace(replace(lower(COALESCE(p_username, '')), '_', ''), '[0-9]+$', '') AS bare,
           lower(COALESCE(p_username, '')) AS raw
  ), readings AS (
    -- Look-alike digits read as letters; "1" both ways (i and l).
    SELECT translate(h.flat, '013457', 'oieast') AS flat_i,
           translate(h.flat, '013457', 'oleast') AS flat_l,
           translate(h.bare, '013457', 'oieast') AS bare_i,
           translate(h.bare, '013457', 'oleast') AS bare_l,
           h.raw
    FROM handle h
  ), staff AS (
    SELECT '^(' || array_to_string(l.before, '|') || ')?('
           || array_to_string(l.words, '|') || ')('
           || array_to_string(l.after, '|') || ')?$' AS pattern,
           l.brand
    FROM lists l
  )
  SELECT strpos(r.flat_i, s.brand) > 0
      OR strpos(r.flat_l, s.brand) > 0
      OR r.bare_i ~ s.pattern
      OR r.bare_l ~ s.pattern
      OR r.raw ~ '_ai$'
  FROM readings r CROSS JOIN staff s
$$;
REVOKE ALL ON FUNCTION public.username_is_reserved_internal(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_is_reserved_internal(TEXT) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- PART 1b — the namespace guard (050's body + the reserved block)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_username_namespace()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- 025's defensive TG_OP form: PostgreSQL does not guarantee OR evaluation
  -- order, so OLD is never referenced in a branch that can run on INSERT.
  IF auth.role() IN ('authenticated', 'anon') THEN
    IF (TG_OP = 'INSERT' AND NEW.username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$')
       OR (TG_OP = 'UPDATE'
           AND NEW.username IS DISTINCT FROM OLD.username
           AND NEW.username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$') THEN
      RAISE EXCEPTION '"-ai" usernames are reserved for FieldScout AI accounts.'
        USING errcode = 'check_violation';
    END IF;
    IF (TG_OP = 'INSERT' AND NEW.username ~ '^user_[0-9a-f]{8}$')
       OR (TG_OP = 'UPDATE'
           AND NEW.username IS DISTINCT FROM OLD.username
           AND NEW.username ~ '^user_[0-9a-f]{8}$') THEN
      RAISE EXCEPTION 'This username format is reserved.'
        USING errcode = 'check_violation';
    END IF;
    -- 215 (S19): brand and staff handles. Only a new claim — an existing
    -- holder keeps theirs and can still edit everything else.
    IF (TG_OP = 'INSERT' AND public.username_is_reserved_internal(NEW.username))
       OR (TG_OP = 'UPDATE'
           AND NEW.username IS DISTINCT FROM OLD.username
           AND public.username_is_reserved_internal(NEW.username)) THEN
      RAISE EXCEPTION 'This username is reserved.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- PART 2a — where a profile picture may come from
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.profile_avatar_url_allowed_internal(p_url TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_origin TEXT;
  v_prefix TEXT;
BEGIN
  -- No picture.
  IF p_url IS NULL OR p_url = '' THEN
    RETURN TRUE;
  END IF;

  -- The app's own pictures (public/avatars/…).
  IF p_url ~ '^/avatars/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.(svg|png|jpg|jpeg|webp|gif)$' THEN
    RETURN TRUE;
  END IF;

  -- Our own storage: the origin of the caller's JWT issuer (<origin>/auth/v1).
  v_origin := substring(auth.jwt() ->> 'iss'
                        FROM '^(https?://[A-Za-z0-9.-]+(:[0-9]+)?)/auth/v1/?$');
  IF v_origin IS NOT NULL THEN
    v_prefix := v_origin || '/storage/v1/object/public/user-avatars/';
    IF left(p_url, length(v_prefix)) = v_prefix
       AND substr(p_url, length(v_prefix) + 1)
           ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.(png|jpg|jpeg|webp|gif)$' THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- The sign-in provider's avatar host: none — the app signs in by email only.
  RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION public.profile_avatar_url_allowed_internal(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_avatar_url_allowed_internal(TEXT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- PART 2b — a client may only SET a picture from those sources
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.profiles_avatar_source_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- A CLIENT statement only (D662: current_user, not the JWT); the server
  -- and the DEFINER doors run as their owner. The trigger's WHEN clause
  -- means this runs only when the picture actually changes.
  IF current_user IN ('anon', 'authenticated')
     AND NOT public.profile_avatar_url_allowed_internal(NEW.avatar_url) THEN
    RAISE EXCEPTION 'Profile pictures have to be uploaded to FieldScout.'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.profiles_avatar_source_guard_internal() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_profiles_avatar_source_guard
  BEFORE UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW
  WHEN (OLD.avatar_url IS DISTINCT FROM NEW.avatar_url)
  EXECUTE FUNCTION public.profiles_avatar_source_guard_internal();

-- ----------------------------------------------------------------------------
-- PART 1c + 2c — handle_new_user (076's body + the two metadata checks)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  new_user_id UUID := NEW.id;
  new_username TEXT := NEW.raw_user_meta_data->>'username';
  effective_username TEXT;
BEGIN
  effective_username := COALESCE(new_username, 'user_' || substr(new_user_id::text, 1, 8));

  -- Restored from 049/050. Client metadata may only claim a human-pattern
  -- handle, and may never claim the reserved placeholder shape.
  -- 215 (S19): nor a reserved brand / staff handle.
  IF effective_username !~ '^[a-z0-9_]{5,20}$'
     OR effective_username ~ '^user_[0-9a-f]{8}$'
     OR public.username_is_reserved_internal(effective_username) THEN
    effective_username := 'user_' || substr(new_user_id::text, 1, 8);
  END IF;

  -- No name is written. The provider's full_name claim is ignored.
  -- 215 (S18): a metadata picture is kept only from an allowed source.
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    new_user_id,
    effective_username,
    CASE WHEN public.profile_avatar_url_allowed_internal(NEW.raw_user_meta_data->>'avatar_url')
         THEN NULLIF(NEW.raw_user_meta_data->>'avatar_url', '') END
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert Big Board if the user doesn't already have one.
  INSERT INTO public.lists (
    owner_id, title, slug, hide_order, is_big_board, is_private, comments_enabled
  )
  SELECT new_user_id, 'My Big Board', 'big-board', FALSE, TRUE, FALSE, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lists WHERE owner_id = new_user_id AND is_big_board = TRUE
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block account creation if profile setup hits a race or transient
  -- error. Recovery is a re-run of this function on next sign-in.
  RAISE WARNING 'handle_new_user failed for %: %', new_user_id, SQLERRM;
  RETURN NEW;
END;
$function$;
