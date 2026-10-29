-- ============================================================================
-- 215 — Community hardening: reserved brand / staff handles, where a profile
--       picture may come from, and "list updated" alerts for public lists
--       only (Community launch plan C11; readiness S17, S18, S19; FULL
--       rigour — permissions)
-- ============================================================================
--
-- Chris's go 2026-10-29 ("go on all of Community"), on the plan he approved
-- 2026-10-27 ("go with your recommendations on the rest").
--
-- THE NEWEST DEFINITION, FROM HERE ON. 215 re-creates handle_new_user,
-- guard_username_namespace and notify_list_followers. It is now the newest
-- definition of all three. 076's "It must be the LAST migration that touches
-- handle_new_user" and 197's "handle_new_user (076, the head)" no longer
-- hold, and neither does 210 being the head of notify_list_followers. Any
-- later change starts from 215's bodies and keeps 215's reserved-handle,
-- picture and private-list checks (CLAUDE.md, the migration-073 lesson).
-- 076, 197 and 210 are deliberately not edited.
--
-- PART 1 — reserved handles (S19). A stranger could sign up as @fieldscout,
--   @admin, @support or @moderator and comment as if speaking for the site.
--   `username_is_reserved_internal(handle)` answers "is this one of ours?".
--   The handle is read lower-cased with its underscores taken out, and each
--   letter of a reserved word may also be written the way it reads at small
--   sizes (the `letters` / `shapes` lists below):
--     o = 0 · i = l = 1 (one letter: "1" reads as both, so f1e1dscout is the
--     brand) · e = 3 · a = 4 · s = 5 · t = 7 · m = rn · d = cl · w = vv
--   A handle is reserved when it has
--     * the brand anywhere — "fieldscout": field_scout, fieldsc0ut,
--       f1e1dscout, fielclscout, the_fieldscout, fieldscout_gg …
--     * or a staff / system word on its own (the word list below),
--       optionally with "fs", "the" or "official" in front, "team", "hq",
--       "desk" or "official" behind, and a number on the end: admin, fs_admin,
--       support_team, moderator1, adm1n, suppor7, lega1, adrnin …
--   One pattern does both readings at once, so a look-alike digit at the end
--   (suppor7) is read as the letter, and a plain number after it (suppor71)
--   is still the number on the end.
--   The AI-account shape is the hyphen one (…-ai), already reserved by 040 /
--   050's guard and CHECK; a human handle cannot hold a hyphen at all.
--   It is a pure function of the text. The app's username form mirrors it
--   (src/lib/auth/username-contract.ts). Its unit test reads the brand, the
--   word lists and the look-alike lists out of this file, and runs every
--   example in pgTAP 165's §R against the form, so the two cannot drift.
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
--     * handle_new_user (re-created from 076 — the newest definition before
--       this one; 077, 118, 146, 197 and 206 only mention it in comments:
--       grep 2026-10-29). The signup trigger runs with auth.role() NULL, so
--       the guard above cannot see a signup (076's header says why); a
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
--     * nothing longer than 512 characters (an upload's address is about
--       130), so no multi-megabyte "address" rides along on every feed read;
--     * the app's own pictures: /avatars/<folders>/<name>.(svg|png|jpg|jpeg|
--       webp|gif) — EXCEPT /avatars/personas/…, the AI experts' own
--       pictures. Those are set only by the server (scripts/seed-ai-personas
--       .ts, service role, which this check never sees); a person may not
--       wear an expert's face. Whether to drop the /avatars/ door entirely
--       (no person's screen uses it) is Chris's call — the PR asks;
--     * our own storage, in the caller's OWN folder: <this project's
--       origin>/storage/v1/object/public/user-avatars/<caller's id>/<name>.
--       (png|jpg|jpeg|webp|gif) — exactly what /api/profile/avatar stores
--       (`${user.id}/${Date.now()}.${ext}`, then getPublicUrl). Someone
--       else's upload is refused: its owner could replace or delete that file
--       at will (014's storage policies), which is S18 again inside our own
--       storage. "This project's origin" is read from the signed-in caller's
--       JWT issuer (`iss` = <origin>/auth/v1, which GoTrue sets from the
--       project's own API URL — the same origin the app's Supabase URL
--       names), and "the caller's id" from its `sub`; so no project name is
--       written in this public repo and local / hosted each allow only their
--       own storage. No issuer or no id (no JWT) means this branch allows
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
-- PART 3 — "list updated" alerts only for public lists (S17, the half 210
--   left). When an owner makes a saved list private, the people who saved it
--   kept getting "@owner updated <list>" for a page they can't open.
--   notify_list_followers is re-created from 210 (#541, F714 — the newest of
--   019, 038, 077, 210; grep 2026-10-29) with one addition: after 210's
--   owner check, a list that is not public (is_private = false, the lists
--   SELECT policy's own test) returns without writing anything. Quietly, not
--   an error: every owner edit calls this (src/lib/lists/helpers.ts), and a
--   private list having no one to tell is the correct outcome. 210's actor
--   check, owner refusal and its one message for a missing / deleted /
--   someone else's list are byte-unchanged, so a stranger learns nothing
--   new about a private list. 210 merged (#541) and is numbered before 215,
--   so `db push` applies 210 first and this body lands on top of it.
--
-- NOT HERE (and why):
--   * Storage bucket limits (F715) — 210's; untouched.
--   * 210's guard_profile_* functions and profiles' column-level SELECT —
--     untouched (nothing here reads a profile column; Part 3 reads
--     profiles.username exactly as 210 does).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * D137: guard_username_namespace from 050, handle_new_user from 076,
--     notify_list_followers from 210 — the newest migration that defines
--     each (live bodies verified equal to those files before this was
--     written); not pg_get_functiondef.
--   * 212 / 213 / 214 define none of the objects below; 210 defines only
--     notify_list_followers, re-created here from its body.
--   * search_path = '' on all six functions, every name schema-qualified.
--     handle_new_user and notify_list_followers stay SECURITY DEFINER
--     (CREATE OR REPLACE keeps their ACLs: 038's REVOKE from PUBLIC / anon
--     on notify_list_followers survives); the rest are INVOKER.
--   * Grants: username_is_reserved_internal — EXECUTE anon, authenticated,
--     service_role (the INVOKER namespace guard calls it as the client; a
--     pure predicate over a public list); profile_avatar_url_allowed_internal
--     — EXECUTE authenticated, service_role (the INVOKER avatar guard calls
--     it as the client); the avatar trigger function — closed to PUBLIC,
--     anon, authenticated (never called directly). PUBLIC holds none.
--   * Existing rows: none read, none rewritten; no CHECK added.
--   * R6 / D38 waivers: none needed — no league table, no realtime, no new
--     RPC that writes (the two predicates read nothing but their argument
--     and the caller's JWT; notify_list_followers keeps 210's signature).
--   * Deploy before push: the app change (the username form's reserved
--     check) reads nothing from the database, so main works on 214 and 215.
--   * Rollback: DROP the trigger and the three new functions; re-run 050's
--     guard_username_namespace body, 076's handle_new_user body and 210's
--     notify_list_followers body.
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
      ARRAY['team', 'hq', 'desk', 'official']::text[] AS after,                       -- reserved:after
      -- Each letter, and every way of writing it that reads the same at small
      -- sizes. i and l share one shape: "1" reads as both.
      ARRAY['o', 'i', 'l', 'e', 'a', 's', 't', 'm', 'd', 'w']::text[] AS letters,      -- reserved:letters
      ARRAY['[o0]', '[il1]', '[il1]', '[e3]', '[a4]', '[s5]', '[t7]',
            '(m|rn)', '(d|cl)', '(w|vv)']::text[] AS shapes                          -- reserved:shapes
  ), words AS (
    SELECT 'brand'::text AS kind, l.brand AS word, 1::bigint AS ord FROM lists l
    UNION ALL SELECT 'words', x.word, x.ord FROM lists l, unnest(l.words) WITH ORDINALITY AS x(word, ord)
    UNION ALL SELECT 'before', x.word, x.ord FROM lists l, unnest(l.before) WITH ORDINALITY AS x(word, ord)
    UNION ALL SELECT 'after', x.word, x.ord FROM lists l, unnest(l.after) WITH ORDINALITY AS x(word, ord)
  ), shaped AS (
    -- Every reserved word as a pattern: each letter replaced by its shape.
    SELECT w.kind, w.ord,
           (SELECT string_agg(COALESCE(l.shapes[array_position(l.letters, ch.c)], ch.c), '' ORDER BY ch.n)
            FROM regexp_split_to_table(w.word, '') WITH ORDINALITY AS ch(c, n)) AS shape
    FROM words w CROSS JOIN lists l
  ), alts AS (
    SELECT s.kind, string_agg(s.shape, '|' ORDER BY s.ord) AS alt
    FROM shaped s
    GROUP BY s.kind
  ), patterns AS (
    SELECT max(a.alt) FILTER (WHERE a.kind = 'brand') AS brand,
           '^(' || max(a.alt) FILTER (WHERE a.kind = 'before') || ')?('
                || max(a.alt) FILTER (WHERE a.kind = 'words') || ')('
                || max(a.alt) FILTER (WHERE a.kind = 'after') || ')?[0-9]*$' AS staff
    FROM alts a
  ), handle AS (
    -- Lower-cased, underscores out.
    SELECT replace(lower(COALESCE(p_username, '')), '_', '') AS flat
  )
  SELECT h.flat ~ p.brand OR h.flat ~ p.staff
  FROM handle h CROSS JOIN patterns p
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
  v_owner TEXT;
  v_prefix TEXT;
BEGIN
  -- No picture.
  IF p_url IS NULL OR p_url = '' THEN
    RETURN TRUE;
  END IF;

  -- No real picture address is anywhere near this long (an upload's is ~130).
  IF length(p_url) > 512 THEN
    RETURN FALSE;
  END IF;

  -- The app's own pictures (public/avatars/…) — but not the AI experts'.
  IF p_url ~ '^/avatars/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.(svg|png|jpg|jpeg|webp|gif)$'
     AND p_url !~* '^/avatars/personas/' THEN
    RETURN TRUE;
  END IF;

  -- Our own storage, in the caller's own folder: the origin of the caller's
  -- JWT issuer (<origin>/auth/v1) and the caller's id (sub).
  v_origin := substring(auth.jwt() ->> 'iss'
                        FROM '^(https?://[A-Za-z0-9.-]+(:[0-9]+)?)/auth/v1/?$');
  v_owner := auth.jwt() ->> 'sub';
  IF v_origin IS NOT NULL AND v_owner ~ '^[A-Za-z0-9-]+$' THEN
    v_prefix := v_origin || '/storage/v1/object/public/user-avatars/' || v_owner || '/';
    IF left(p_url, length(v_prefix)) = v_prefix
       AND substr(p_url, length(v_prefix) + 1)
           ~ '^[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif)$' THEN
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

-- ----------------------------------------------------------------------------
-- PART 3 — notify_list_followers (210's body + the private-list return)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_list_followers(p_list_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title text;
  v_owner uuid;
  v_is_private boolean;
  v_actor_name text;
  v_message text;
BEGIN
  -- R5: SECURITY DEFINER bypasses RLS, so authorization lives here (spec §12).
  -- The actor must be the authenticated caller — no spoofed attribution. The
  -- server (210 Part 0) has no uid; it names the actor itself.
  IF (CASE WHEN auth.uid() IS NULL THEN NOT public.caller_is_server_internal()
           ELSE p_actor IS NULL OR auth.uid() IS DISTINCT FROM p_actor END) THEN
    RAISE EXCEPTION 'notify_list_followers: p_actor must be the authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  -- 210 (F714): only the list's owner notifies its followers. A missing,
  -- deleted or someone else's list gets the same refusal.
  SELECT title, owner_id, is_private INTO v_title, v_owner, v_is_private
  FROM public.lists WHERE id = p_list_id AND deleted_at IS NULL;
  IF NOT FOUND OR p_actor IS NULL OR v_owner IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'notify_list_followers: only the list''s owner may notify its followers'
      USING ERRCODE = '42501';
  END IF;

  -- 215 (S17): only a public list alerts the people who saved it — they
  -- can't open a private one. Quietly: every owner edit calls this, and a
  -- private list having no one to tell is the right outcome, not an error.
  IF v_is_private IS DISTINCT FROM FALSE THEN
    RETURN;
  END IF;

  -- 077: the actor is the handle, full stop. A NULL username (impossible
  -- today) still falls through to 'Someone' below, exactly as before.
  SELECT '@' || username INTO v_actor_name
  FROM public.profiles WHERE id = p_actor;
  v_message := COALESCE(v_actor_name, 'Someone') || ' updated ' || v_title;

  -- Refresh any existing unread notification for this list (coalesce a burst).
  UPDATE public.notifications n
  SET created_at = now(), title = v_message
  FROM public.list_favorites f
  WHERE f.list_id = p_list_id
    AND f.user_id <> p_actor
    AND n.user_id = f.user_id
    AND n.type = 'list_updated'
    AND n.read = false
    AND n.data->>'list_id' = p_list_id::text;

  -- Insert for followers who don't already have an unread one.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT f.user_id,
         'list_updated',
         v_message,
         NULL,
         jsonb_build_object('list_id', p_list_id, 'actor_id', p_actor)
  FROM public.list_favorites f
  WHERE f.list_id = p_list_id
    AND f.user_id <> p_actor
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = f.user_id
        AND n.type = 'list_updated'
        AND n.read = false
        AND n.data->>'list_id' = p_list_id::text
    )
  ON CONFLICT DO NOTHING;
END;
$$;
