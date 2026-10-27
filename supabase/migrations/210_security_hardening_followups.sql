-- ============================================================================
-- 210 — the remaining L.F2.7 hardening (M7 L.F2.8; spec §19.3; PROGRESS
--       D730–D740; ledger F714, F715, F719, F720, F723, F724, F777, F793;
--       FULL rigour — permissions)
-- ============================================================================
--
-- Chris's go 2026-10-27. Each part names the finding it closes. Fixes are
-- described by what they do; the review doc (security-review-M7-L.F2.7.md)
-- holds the findings.
--
-- PART 0 — `caller_is_server_internal()`. One answer to "is this call from
--   the server, not a browser?": the request's role is service_role (or a
--   superuser role set explicitly), or no role was set at all on a session
--   that is not one of the API logins (pg_cron, migrations, psql). It reads
--   the `role` setting PostgREST sets per request, which a SECURITY DEFINER
--   body still sees as the CALLER's role (measured 2026-10-27: inside a
--   definer, current_user is the owner, current_setting('role') is the
--   caller's). PLAIN (INVOKER), REVOKEd — only definer bodies call it.
--
-- PART 1 — F714 + F719 (eleven legacy SECURITY DEFINER functions).
--   Each is re-created against its NEWEST definer (D137): the five counter
--   triggers 048, reorder_list_players 190, enforce_free_list_caps 187,
--   notify_list_followers 077, guard_lists_ai_persona and
--   guard_profile_billing_columns 025, guard_profile_admin_column 026. The
--   ONE change to ten of them: `search_path = ''`, every table and function
--   name schema-qualified. Logic byte-for-byte otherwise (the PR shows each
--   diff). CREATE OR REPLACE keeps every ACL (reorder's anon EXECUTE stays
--   as 037/048 left it — its body refuses a caller with no uid).
--   notify_list_followers also gains its ownership check (F714): only the
--   list's owner (p_actor = auth.uid() = lists.owner_id), or the server
--   naming the owner as the actor, may notify the list's followers. A
--   missing, deleted or someone else's list is refused with one message
--   (42501), so the refusal says nothing about whether a list exists. The
--   app's four callers are the owner's own list routes (owner-checked before
--   the call), so nothing the app does changes.
--
-- PART 2 — F719 (the member reads). `league_standings`,
--   `league_standings_projected` and `league_playoff_bracket` (newest
--   definer: 118 for all three) refused a non-member only when a uid was
--   present. Now fail-closed: a caller WITH a uid is checked for membership
--   exactly as before; a caller with NO uid is refused unless it is the
--   server (Part 0) — the service-role script and the pgTAP / cron sessions
--   keep reading. One condition changed in each. notify_list_followers'
--   actor check (Part 1d) takes the same shape.
--
-- PART 3 — F720 (`profiles`). SELECT on the whole table is replaced, for
--   anon and authenticated, by SELECT on every column EXCEPT
--   `stripe_customer_id` and `is_admin`. The row policy ("viewable by
--   everyone") is untouched. Readers measured (grep 2026-10-27): every app
--   read names its columns except the owner's own profile hook and the
--   avatar route's update-and-return — both changed in this PR to name
--   theirs; the admin gate and the account menu ask
--   `is_platform_operator()` (182, SECURITY DEFINER, the caller's own
--   status only) instead of reading `is_admin`. Service-role reads are
--   unaffected. UPDATE grants unchanged (the 025 / 026 guards still answer
--   a client's write of either column). A FUTURE profiles column is not
--   readable by the API roles until a migration grants it — pgTAP 160 pins
--   the readable set, so a new column without a grant is named in CI.
--
-- PART 4 — F715 (storage). The four public buckets accept what their four
--   upload routes accept, and nothing else: 5 MiB (5 242 880 bytes — the
--   routes' MAX_BYTES) and image/png, image/jpeg, image/jpg, image/webp,
--   image/gif (the routes' ALLOWED_MIME). Existing objects are untouched.
--   Exactly four rows, or the migration aborts.
--
-- PART 5 — F723 (pg_net). EXECUTE on `supabase_functions.http_request()`
--   revoked from anon and authenticated where it exists (no trigger or public
--   function uses it — measured; production has no `supabase_functions`
--   schema at all, so there the step is a guarded no-op). `net.http_get` /
--   `net.http_post` are owned by supabase_admin and the migration role holds
--   no grant option on them (locally and on production): a
--   REVOKE is a no-op with a WARNING (measured locally), so they are NOT
--   touched here — filed F811 for the platform side.
--
-- PART 6 — F724 (views). `active_game_window` runs as the caller
--   (security_invoker); its one table, nfl_games, is readable by everyone,
--   so its answer is unchanged. `consensus_rankings` is a MATERIALIZED view:
--   Postgres has no security_invoker for those (measured: "unrecognized
--   parameter"). Its definition reads only public, order-visible, live lists
--   — pgTAP 160 pins that filter; filed F812.
--
-- PART 7 — F777 (`expert_profiles`). 206's guard (newest and only definer,
--   206 §2e) re-created with one more branch: a client role may not change
--   `ai_generated_disclaimer` or `claimed_at`. 206's branch and message are
--   byte-unchanged (pgTAP 156 G2 / G3). `is_claimed` / `claimed_by` are
--   already held by the UPDATE policy's check (no WITH CHECK, so USING
--   applies to the new row: is_claimed AND claimed_by = auth.uid()).
--
-- PART 8 — F793 (`scoring_systems`). A client change of a league scoring
--   row's `name` or `description` is refused unless the caller is a
--   commissioner or co-commissioner of every live league that plays by it
--   (`is_league_commish` — the same test `scoring_update_rules` uses; §17
--   gives co-commissioners the commissioner's powers). An owner who is no
--   longer either — demoted to manager, or gone from the league — keeps
--   owning the row but can no longer relabel it (review R1705). New
--   INVOKER trigger (sorts after 104's validator) + a DEFINER helper that
--   answers only about the caller's own row (170's
--   scoring_system_league_use_internal shape). The rules guard (170) is
--   untouched.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * D137: every CREATE OR REPLACE above is authored against the newest
--     migration that defines the function (named per part), not the
--     deployed body; the PR shows each diff.
--   * SECURITY DEFINER: every definer here pins `search_path = ''`, gates
--     in-body, and keeps (or sets) its REVOKE. New functions:
--     caller_is_server_internal (INVOKER, REVOKEd),
--     scoring_system_label_lock_internal (DEFINER, in-body owner gate,
--     REVOKE PUBLIC / anon, EXECUTE authenticated — the INVOKER trigger
--     calls it as the client), scoring_systems_league_label_guard_internal
--     (INVOKER trigger function, REVOKEd).
--   * Grants: profiles SELECT narrowed (Part 3); http_request EXECUTE
--     (Part 5). No policy changed.
--   * R6 / D38 waivers: none needed — no league table written, no realtime.
--   * Deploy before push: the app changes in this PR read only what both
--     schemas allow (named columns; `is_platform_operator()` exists since
--     182), so main works on 209 and on 210.
--   * Rollback: GRANT SELECT ON public.profiles TO anon, authenticated;
--     re-run each function's previous migration body; reset the four
--     buckets' limits to NULL; GRANT EXECUTE on http_request back; ALTER
--     VIEW active_game_window RESET (security_invoker); drop the two new
--     functions and the trigger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 0 — is this the server?
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.caller_is_server_internal()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN COALESCE(NULLIF(current_setting('role', true), ''), 'none')
                IN ('service_role', 'postgres', 'supabase_admin') THEN TRUE
           WHEN COALESCE(NULLIF(current_setting('role', true), ''), 'none') = 'none'
             THEN session_user::text NOT IN ('anon', 'authenticated', 'authenticator')
           ELSE FALSE
         END
$$;
REVOKE EXECUTE ON FUNCTION public.caller_is_server_internal() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- PART 1a — the five counter triggers (048 bodies, names qualified)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_follow_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles SET follower_count = follower_count + 1 WHERE id = NEW.following_id;
    UPDATE public.profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET follower_count = follower_count - 1 WHERE id = OLD.following_id;
    UPDATE public.profiles SET following_count = following_count - 1 WHERE id = OLD.follower_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_list_player_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.lists SET player_count = player_count + 1, updated_at = NOW() WHERE id = NEW.list_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.lists SET player_count = player_count - 1, updated_at = NOW() WHERE id = OLD.list_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tag_use_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tags SET use_count = use_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tags SET use_count = use_count - 1 WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_expert_follower_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.expert_profiles SET follower_count = follower_count + 1 WHERE id = NEW.expert_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.expert_profiles SET follower_count = follower_count - 1 WHERE id = OLD.expert_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_list_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.lists SET like_count = like_count + 1 WHERE id = NEW.list_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.lists SET like_count = like_count - 1 WHERE id = OLD.list_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- PART 1b — reorder_list_players (190 body, names qualified)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_list_players(
  p_list_id UUID,
  p_positions JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID := auth.uid();
  list_owner UUID;
  is_ranking BOOLEAN;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT owner_id, (COALESCE(is_big_board, false) OR ai_persona_id IS NOT NULL)
  INTO list_owner, is_ranking
  FROM public.lists
  WHERE id = p_list_id AND deleted_at IS NULL;

  IF list_owner IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  IF list_owner != caller_id THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- A weekly board is an ordinary list that big_board_weekly points at.
  is_ranking := is_ranking
    OR EXISTS (SELECT 1 FROM public.big_board_weekly AS w WHERE w.list_id = p_list_id);

  UPDATE public.list_players AS lp
  SET position = (entry->>'position')::INTEGER,
      overall_rank = (entry->>'position')::INTEGER,
      updated_at = NOW(),
      -- On a ranking: where he was before this update (the old row's
      -- position), or NULL for a player this publish added.
      previous_position = CASE
        WHEN NOT is_ranking THEN lp.previous_position
        WHEN entry->'is_new' = 'true'::jsonb THEN NULL
        ELSE lp.position
      END
  FROM jsonb_array_elements(p_positions) AS entry
  WHERE lp.list_id = p_list_id
    AND lp.player_id = entry->>'player_id';

  -- A ranking published with no scoring ever chosen is Half PPR. A scoring
  -- the caller picked is saved after this, over it (the publish routes).
  IF is_ranking THEN
    PERFORM public.fill_ranking_scoring_internal(p_list_id);
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- PART 1c — enforce_free_list_caps (187 body, names qualified)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_free_list_caps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Free accounts' caps. SUSPENDED (private 2026-10-15, team 2026-10-16):
  -- NULL = off. A Pro tier brings one back by putting a number here (each
  -- was 1).
  c_private_cap CONSTANT integer := NULL;
  c_team_cap CONSTANT integer := NULL;
  v_is_pro boolean;
  v_count integer;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- The Favorites list is a system quick-save bucket — never capped.
  IF COALESCE(NEW.is_favorites, false) THEN
    RETURN NEW;
  END IF;
  IF NOT ((c_private_cap IS NOT NULL AND COALESCE(NEW.is_private, false))
          OR (c_team_cap IS NOT NULL AND COALESCE(NEW.is_team, false))) THEN
    RETURN NEW;
  END IF;

  SELECT is_pro INTO v_is_pro FROM public.profiles WHERE id = NEW.owner_id;
  IF COALESCE(v_is_pro, false) THEN
    RETURN NEW;  -- Pro accounts are unlimited.
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 0));

  IF c_private_cap IS NOT NULL AND COALESCE(NEW.is_private, false) THEN
    SELECT count(*) INTO v_count
    FROM public.lists
    WHERE owner_id = NEW.owner_id
      AND is_private = true
      AND is_favorites = false
      AND deleted_at IS NULL
      AND id <> NEW.id;
    IF v_count >= c_private_cap THEN
      RAISE EXCEPTION 'Free accounts can have one private list.'
        USING errcode = 'check_violation';
    END IF;
  END IF;

  IF c_team_cap IS NOT NULL AND COALESCE(NEW.is_team, false) THEN
    SELECT count(*) INTO v_count
    FROM public.lists
    WHERE owner_id = NEW.owner_id
      AND is_team = true
      AND deleted_at IS NULL
      AND id <> NEW.id;
    IF v_count >= c_team_cap THEN
      RAISE EXCEPTION 'Free accounts can have one team.'
        USING errcode = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- PART 1d — notify_list_followers (077 body, names qualified) + the
--           ownership check (F714)
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
  SELECT title, owner_id INTO v_title, v_owner
  FROM public.lists WHERE id = p_list_id AND deleted_at IS NULL;
  IF NOT FOUND OR p_actor IS NULL OR v_owner IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'notify_list_followers: only the list''s owner may notify its followers'
      USING ERRCODE = '42501';
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

-- ----------------------------------------------------------------------------
-- PART 1e — the three 025 / 026 guard triggers (no table names to qualify;
--           only the pin moves)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_billing_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') THEN
    IF NEW.is_pro IS DISTINCT FROM OLD.is_pro
       OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
       OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
      RAISE EXCEPTION 'Subscription fields are managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_lists_ai_persona()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') THEN
    IF (TG_OP = 'INSERT' AND NEW.ai_persona_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.ai_persona_id IS DISTINCT FROM OLD.ai_persona_id) THEN
      RAISE EXCEPTION 'ai_persona_id is managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_admin_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Admin status is managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- PART 2 — the member reads fail closed (118 bodies; one line each)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_standings(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (CASE WHEN auth.uid() IS NULL THEN NOT public.caller_is_server_internal()
           ELSE NOT public.is_league_member(p_league_id) END) THEN
    RAISE EXCEPTION 'league_standings: only a member of the league may read its standings'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.league_standings_internal(p_league_id, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.league_standings_projected(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (CASE WHEN auth.uid() IS NULL THEN NOT public.caller_is_server_internal()
           ELSE NOT public.is_league_member(p_league_id) END) THEN
    RAISE EXCEPTION 'league_standings_projected: only a member of the league may read its standings'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.league_standings_internal(p_league_id, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.league_playoff_bracket(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state    JSONB;
  v_st       JSONB;
  v_entrants JSONB;
  v_n        INTEGER;
  v_proj     JSONB := NULL;
  v_basis    JSONB := NULL;
  v_view     TEXT;
BEGIN
  IF (CASE WHEN auth.uid() IS NULL THEN NOT public.caller_is_server_internal()
           ELSE NOT public.is_league_member(p_league_id) END) THEN
    RAISE EXCEPTION 'league_playoff_bracket: only a member of the league may read its bracket'
      USING ERRCODE = '42501';
  END IF;
  v_state := public.playoff_bracket_state_internal(p_league_id);

  IF v_state ->> 'kind' <> 'bracket' THEN
    RETURN v_state || jsonb_build_object('view', v_state ->> 'kind');
  END IF;

  IF (v_state ->> 'next_round')::int = 1 AND (v_state ->> 'status') = 'in_season' THEN
    v_st := public.league_standings_internal(p_league_id, TRUE);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'team_id', x ->> 'team_id', 'seed', (x ->> 'rank')::int, 'line', (x ->> 'rank')::int)
             ORDER BY (x ->> 'rank')::int), '[]'::jsonb), count(*)::int
      INTO v_entrants, v_n
    FROM jsonb_array_elements(v_st -> 'standings') x
    WHERE (x ->> 'rank')::int <= (v_state ->> 'playoff_teams')::int;
    IF v_n = (v_state ->> 'playoff_teams')::int THEN
      v_proj := public.playoff_round_pairs_internal(v_entrants, (v_state ->> 'bracket_size')::int, 'seed');
    END IF;
    v_basis := jsonb_build_object(
      'projected',       TRUE,
      'weeks_final',     v_st -> 'weeks_final',
      'weeks_projected', v_st -> 'weeks_projected',
      'seeded',          v_n,
      'reason',          v_st -> 'reason');
    v_view := 'projected';
  ELSE
    v_view := 'bracket';
  END IF;

  RETURN v_state || jsonb_build_object(
    'view',              v_view,
    'projected_round_1', v_proj,
    'projection_basis',  v_basis);
END;
$$;

-- ----------------------------------------------------------------------------
-- PART 3 — profiles: two columns are not for public reads (F720)
-- ----------------------------------------------------------------------------
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, username, avatar_url, bio, cred_score, cred_rank, is_pro,
              subscription_status, follower_count, following_count,
              created_at, updated_at)
  ON public.profiles TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- PART 4 — the public buckets take images only, 5 MiB at most (F715)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE storage.buckets
     SET file_size_limit = 5242880,
         allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
   WHERE id IN ('user-avatars', 'list-thumbnails', 'folder-thumbnails', 'league-avatars');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 4 THEN
    RAISE EXCEPTION '210: expected the four public buckets, updated % — refusing to guess which is missing', v_rows;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- PART 5 — the database-webhook helper is not for the API roles (F723)
-- ----------------------------------------------------------------------------
-- Only where the function exists: the local stack ships the
-- `supabase_functions` schema; production has none (measured 2026-10-27,
-- read-only catalog SELECT), and a bare REVOKE there would fail the push.
DO $$
BEGIN
  IF to_regprocedure('supabase_functions.http_request()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION supabase_functions.http_request() FROM anon, authenticated;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- PART 6 — active_game_window runs as its caller (F724)
-- ----------------------------------------------------------------------------
ALTER VIEW public.active_game_window SET (security_invoker = true);

-- ----------------------------------------------------------------------------
-- PART 7 — expert_profiles: the disclaimer and the claim instant are the
--          system's (F777; 206 §2e body + one branch)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expert_profiles_server_owned_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.follower_count IS DISTINCT FROM OLD.follower_count
       OR NEW.is_ai_generated IS DISTINCT FROM OLD.is_ai_generated THEN
      RAISE EXCEPTION 'Follower counts and the AI label are managed by the system.'
        USING errcode = 'check_violation';
    END IF;
    -- 210 (F777): the AI disclaimer text and when the profile was claimed.
    IF NEW.ai_generated_disclaimer IS DISTINCT FROM OLD.ai_generated_disclaimer
       OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
      RAISE EXCEPTION 'The AI disclaimer and the claim date are managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expert_profiles_server_owned_guard_internal()
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- PART 8 — a league scoring row's label follows the league's commissioners
--          (F793)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.scoring_system_label_lock_internal(p_scoring_system_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- The name of a live league that plays by this scoring system and of
  -- which the caller is NOT a commissioner or co-commissioner
  -- (is_league_commish) — asked ONLY about the caller's own row (the in-body
  -- gate: owner_id = auth.uid()); for anyone else's row the answer is NULL,
  -- so nothing about another user's system is told.
  SELECT l.name
  FROM public.scoring_systems s
  JOIN public.leagues l ON l.scoring_system_id = s.id AND l.deleted_at IS NULL
  WHERE s.id = p_scoring_system_id AND s.owner_id = (SELECT auth.uid())
    AND NOT public.is_league_commish(l.id)
  ORDER BY l.created_at, l.id
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.scoring_system_label_lock_internal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scoring_system_label_lock_internal(UUID) TO authenticated;

CREATE FUNCTION public.scoring_systems_league_label_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_league TEXT;
BEGIN
  -- A CLIENT statement only (D662: current_user, not the JWT); the server and
  -- the DEFINER doors run as their owner.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  v_league := public.scoring_system_label_lock_internal(OLD.id);
  IF v_league IS NOT NULL THEN
    RAISE EXCEPTION 'This scoring system belongs to the league "%". Only its commissioner or a co-commissioner can change its name or description.', v_league
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.scoring_systems_league_label_guard_internal() FROM PUBLIC, anon, authenticated;

-- Sorts after trg_scoring_systems_rules_guard (104's validator), so an
-- invalid document keeps its validator refusal; ENABLE ALWAYS like 170's.
CREATE TRIGGER trg_zz_scoring_systems_league_label
  BEFORE UPDATE ON public.scoring_systems FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name OR NEW.description IS DISTINCT FROM OLD.description)
  EXECUTE FUNCTION public.scoring_systems_league_label_guard_internal();
ALTER TABLE public.scoring_systems ENABLE ALWAYS TRIGGER trg_zz_scoring_systems_league_label;
