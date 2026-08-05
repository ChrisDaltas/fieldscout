-- ============================================================================
-- 075: profiles.display_name → profiles.full_name — the username is the only
-- name the product renders (Chris's ruling, 2026-08-05; spec-redraft-leagues
-- changelog v2.9, §7.2 identity contract).
--
-- Why: profiles had no real-name field. `handle_new_user` seeds the column
-- from the OAuth `full_name` claim, so a Google sign-in put the user's REAL
-- NAME in `display_name` — and every identity surface rendered
-- `display_name ?? @username`, leaking real names across the app (found on
-- Chris's own account, 2026-08-05).
--
-- The rename makes the column's job honest: `full_name` is a PRIVATE profile
-- field, editable in account settings and rendered nowhere else. Seeding it
-- from the OAuth full_name claim is now semantically CORRECT and is kept.
-- `username` is the display name; we do not call it that.
--
-- Shape:
--   1. profiles.display_name → profiles.full_name (idempotent guard; data
--      preserved in place — a rename never rewrites rows).
--   2. Every function that read the column, re-pointed at `username`:
--      · handle_new_user            — seeds full_name from the OAuth claim
--      · notify_list_followers      — actor renders '@' || username
--      · create_league              — default team name "<username>'s Team"
--      · seat_league_member_internal— same naming on the join/claim path
--      · get_join_preview           — inviter renders '@' || username
--      · draft_actor_name           — chat/system-post actor is the handle
--
-- ai_personas.display_name is NOT this column and is NOT renamed here — see
-- the companion rename in this file's §3 (persona_name): a persona's name is
-- explicitly PUBLIC brand copy ("Bathew Merry (AI)"), never a human's name.
--
-- RLS: untouched. No policy, view, index, or constraint referenced the column
-- (verified against the live schema: pg_policies / information_schema.views /
-- pg_indexes all empty for 'display_name').
--
-- Grants: none needed — CREATE OR REPLACE preserves each function's existing
-- ACL (037 default-ACL model; the 069 REVOKEs on draft_* stay in force).
--
-- §8.1 staging rehearsal: no staging clone exists (the standing R6 waiver) —
-- the rehearsal evidence is a local `supabase migration up` against the local
-- stack followed by the full pgTAP suite + the vitest DB suites. Prod-safe:
-- ALTER ... RENAME COLUMN is a metadata-only catalog update (no table
-- rewrite, no lock beyond the brief ACCESS EXCLUSIVE), and every function is
-- replaced with the same signature, volatility, security and search_path pin.
--
-- ORDERING NOTE (handle_new_user): this file MUST run after 074
-- (`restore_handle_new_user_username_contract`), which is the last prior
-- migration to replace the function — 074 restored the 049/050/051
-- username-contract guards that 073's search_path hotfix had silently
-- reverted. Numeric ordering gives that for free (074 → 075), and this body
-- is 074's VERBATIM apart from the column name, so a fresh reset and a live
-- `migration up` land on the same definition either way. Anything ordered
-- before 074 would be silently overwritten (the 051 lesson, repeated).
--
-- Note for review: 074 was applied to the local stack and is in flight on its
-- own branch at the time this was written; if 074 has not yet reached
-- production when this is applied, apply 074 FIRST — 075 alone would leave
-- the guards reverted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column rename
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'display_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN display_name TO full_name;
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.full_name IS
  'PRIVATE. The account holder''s real name — seeded from the OAuth full_name claim, editable in account settings, and rendered on NO other surface. The username is the only name the product displays (ruling 2026-08-05).';

-- ---------------------------------------------------------------------------
-- 2. Functions that read the column
-- ---------------------------------------------------------------------------

-- 2a. handle_new_user — seeds the PRIVATE full_name from the OAuth full_name
-- claim (now semantically correct), and keeps 049/050/051's username-contract
-- guards plus 073's search_path pin (see the ordering note above).
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

  -- v2.8.1/Q7.1 (migration 049): client-supplied metadata may only claim a
  -- HUMAN-pattern handle. Persona-pattern ('*-ai') and contract-violating
  -- names fall back — the signup-trigger context has auth.role() NULL, so
  -- the 040 namespace guard cannot gate this path itself.
  -- R32 (migration 050): the placeholder shape is likewise reserved —
  -- metadata cannot explicitly claim 'user_' || 8 hex; only the id-derived
  -- fallback below may assign it.
  IF effective_username !~ '^[a-z0-9_]{5,20}$'
     OR effective_username ~ '^user_[0-9a-f]{8}$' THEN
    effective_username := 'user_' || substr(new_user_id::text, 1, 8);
  END IF;

  -- Insert profile (or skip if it already exists — e.g. from a backfill).
  -- R31 (migration 051): the fallback value derives from effective_username,
  -- never the raw metadata value — a rejected username must not resurface.
  -- 075: full_name is PRIVATE, so the OAuth full_name claim is exactly the
  -- right seed for it; it is rendered nowhere but account settings.
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    new_user_id,
    effective_username,
    COALESCE(NEW.raw_user_meta_data->>'full_name', effective_username, 'New User'),
    NEW.raw_user_meta_data->>'avatar_url'
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
  -- error. The application can recover by re-running this on next sign-in
  -- via the same function called by a backfill or a signup hook.
  RAISE WARNING 'handle_new_user failed for %: %', new_user_id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 2b. notify_list_followers (019 → 038) — the actor line.
CREATE OR REPLACE FUNCTION public.notify_list_followers(p_list_id uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text;
  v_actor_name text;
  v_message text;
BEGIN
  -- R5: SECURITY DEFINER bypasses RLS, so authorization lives here (spec §12).
  -- The actor must be the authenticated caller — no spoofed attribution.
  IF p_actor IS NULL OR auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'notify_list_followers: p_actor must be the authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  SELECT title INTO v_title
  FROM lists WHERE id = p_list_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;

  -- 075: the handle is the actor's only rendered name.
  SELECT '@' || username INTO v_actor_name
  FROM profiles WHERE id = p_actor;
  v_message := COALESCE(v_actor_name, 'Someone') || ' updated ' || v_title;

  -- Refresh any existing unread notification for this list (coalesce a burst).
  UPDATE notifications n
  SET created_at = now(), title = v_message
  FROM list_favorites f
  WHERE f.list_id = p_list_id
    AND f.user_id <> p_actor
    AND n.user_id = f.user_id
    AND n.type = 'list_updated'
    AND n.read = false
    AND n.data->>'list_id' = p_list_id::text;

  -- Insert for followers who don't already have an unread one.
  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT f.user_id,
         'list_updated',
         v_message,
         NULL,
         jsonb_build_object('list_id', p_list_id, 'actor_id', p_actor)
  FROM list_favorites f
  WHERE f.list_id = p_list_id
    AND f.user_id <> p_actor
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = f.user_id
        AND n.type = 'list_updated'
        AND n.read = false
        AND n.data->>'list_id' = p_list_id::text
    )
  ON CONFLICT DO NOTHING;
END;
$function$;

-- 2c. create_league (060) — the default franchise name.
CREATE OR REPLACE FUNCTION public.create_league(p_name text, p_season integer, p_team_count integer, p_settings jsonb, p_roster_settings jsonb, p_scoring_system_id uuid, p_team_name text, p_action_id uuid, p_format text, p_regular_season_weeks integer, p_playoff_teams integer, p_playoff_start_week integer, p_waiver_type text, p_faab_budget integer, p_trade_review text, p_trade_deadline_week integer, p_lineup_lock text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid UUID;
  v_existing RECORD;
  v_league_id UUID;
  v_team_id UUID;
  v_invite_code TEXT;
  v_default_team_name TEXT;
  v_constraint TEXT;
  v_attempts INTEGER := 0;
BEGIN
  -- In-body authorization (§12.0/§8.3): any signed-in user — creation is
  -- FREE (Q6 ruling, v2.8; §17). Deliberately NO is_pro read.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_league: must be signed in to create a league'
      USING ERRCODE = '42501';
  END IF;

  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'create_league: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotent replay (D68): a retry of an already-committed create returns
  -- the original result instead of a second league.
  SELECT l.id, l.owner_id, l.invite_code, l.deleted_at INTO v_existing
  FROM public.leagues l
  WHERE l.creation_action_id = p_action_id;
  IF FOUND THEN
    IF v_existing.owner_id <> v_uid THEN
      RAISE EXCEPTION 'create_league: this action_id was already used by another account'
        USING ERRCODE = 'P0001';
    END IF;
    -- R76: a soft-deleted league must NOT replay as success (the route would
    -- 200 while GET detail 404s) — refuse with a friendly, terminal message.
    IF v_existing.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_league: this create was already completed and the league has since been deleted — start a new league with a fresh submit'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT lm.team_id INTO v_team_id
    FROM public.league_members lm
    WHERE lm.league_id = v_existing.id AND lm.user_id = v_uid;
    RETURN jsonb_build_object(
      'league_id', v_existing.id,
      'team_id', v_team_id,
      'invite_code', v_existing.invite_code,
      'replayed', true
    );
  END IF;

  -- v1 templates-only (§7.3.3; §7.3.8 "exactly one scoring system referenced
  -- and readable"): the reference must be a template row — is_template AND
  -- ownerless (the 058 CHECK makes those inseparable, but both are checked
  -- so this guard survives a CHECK change). Friendly, field-named message —
  -- the route maps it to a per-field 400.
  IF p_scoring_system_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.scoring_systems s
    WHERE s.id = p_scoring_system_id
      AND s.is_template = TRUE
      AND s.owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'create_league: scoring_system_id must reference one of the v1 scoring templates — personal scoring systems cannot be attached to a league in v1 (§7.3.3)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Q10 strict-continuity backstop (R75; §7.3.8 "enforced in API + DB
  -- constraints"; ruling v2.8.6): a direct-PostgREST caller never runs
  -- validateLeagueSettings, so the seam invariant is re-checked at the ONE
  -- sanctioned writer. Range first (13–16, §7.3.1 R column) so a
  -- seam-consistent-but-out-of-range pair (e.g. 16+17) names the range;
  -- then strict continuity. Blob-shape validation stays API-side (D68(3)/
  -- D69 boundary). Friendly field-named messages — the route maps them to
  -- per-field 400s.
  IF p_playoff_start_week < 13 OR p_playoff_start_week > 16 THEN
    RAISE EXCEPTION 'create_league: playoff_start_week must be between 13 and 16 (currently week %) (§7.3.1, Q10/v2.8.6)',
      p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;
  IF p_playoff_start_week <> p_regular_season_weeks + 1 THEN
    RAISE EXCEPTION 'create_league: playoff_start_week must be the week after the regular season ends — week % for a %-week regular season (currently week %) (§7.3.8, Q10/v2.8.6)',
      p_regular_season_weeks + 1, p_regular_season_weeks, p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;

  -- Default team name: "<username>'s Team" (075: the handle is the only name
  -- the product renders — profiles.full_name is private. Falls back to 'My' —
  -- a profile always exists via handle_new_user).
  SELECT COALESCE(NULLIF(p.username, ''), 'My') || '''s Team'
    INTO v_default_team_name
  FROM public.profiles p
  WHERE p.id = v_uid;
  v_default_team_name := COALESCE(v_default_team_name, 'My Team');

  -- League insert, invite-code collision-retried (10 hex chars from
  -- gen_random_uuid — pg_catalog, no extension dependency; the 001 UNIQUE
  -- backs uniqueness). A creation_action_id unique_violation here is the
  -- CONCURRENT double-submit race: the other txn won — replay its result.
  LOOP
    v_attempts := v_attempts + 1;
    v_invite_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    BEGIN
      INSERT INTO public.leagues (
        owner_id, name, season, scoring_system_id, invite_code,
        creation_action_id,
        format, team_count, max_teams, regular_season_weeks, playoff_teams,
        playoff_start_week, waiver_type, faab_budget, trade_review,
        trade_deadline_week, lineup_lock, roster_settings, settings
      ) VALUES (
        v_uid, p_name, p_season, p_scoring_system_id, v_invite_code,
        p_action_id,
        p_format, p_team_count, p_team_count, -- max_teams := team_count (§12.1 sync)
        p_regular_season_weeks, p_playoff_teams,
        p_playoff_start_week, p_waiver_type, p_faab_budget, p_trade_review,
        p_trade_deadline_week, p_lineup_lock, p_roster_settings, p_settings
      ) RETURNING id INTO v_league_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'leagues_creation_action_id_key' THEN
        -- Concurrent same-action_id create committed first: replay it.
        SELECT l.id, l.invite_code, l.deleted_at INTO v_existing
        FROM public.leagues l
        WHERE l.creation_action_id = p_action_id AND l.owner_id = v_uid;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'create_league: this action_id was already used by another account'
            USING ERRCODE = 'P0001';
        END IF;
        -- R76 (same guard as the primary replay path): never replay a
        -- since-soft-deleted league as success.
        IF v_existing.deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'create_league: this create was already completed and the league has since been deleted — start a new league with a fresh submit'
            USING ERRCODE = 'P0001';
        END IF;
        SELECT lm.team_id INTO v_team_id
        FROM public.league_members lm
        WHERE lm.league_id = v_existing.id AND lm.user_id = v_uid;
        RETURN jsonb_build_object(
          'league_id', v_existing.id,
          'team_id', v_team_id,
          'invite_code', v_existing.invite_code,
          'replayed', true
        );
      ELSIF v_constraint = 'leagues_invite_code_key' AND v_attempts < 5 THEN
        CONTINUE; -- astronomically rare 10-hex collision: regenerate
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  -- Creator's franchise (§7.2 "Creator becomes commissioner and gets a
  -- team"): a league team carries no backing list (D35a).
  INSERT INTO public.teams (owner_id, name, league_id, list_id)
  VALUES (v_uid, COALESCE(NULLIF(btrim(p_team_name), ''), v_default_team_name), v_league_id, NULL)
  RETURNING id INTO v_team_id;

  -- Commissioner membership (current-state cache) — faab_balance seeded from
  -- the league's faab_budget (§12.2).
  INSERT INTO public.league_members (league_id, user_id, team_id, role, faab_balance)
  VALUES (v_league_id, v_uid, v_team_id, 'commissioner', p_faab_budget);

  -- First manager stint (historical truth — §12.22/v2.1: same txn as the
  -- cache write). started_week NULL = preseason.
  INSERT INTO public.team_managers (league_id, team_id, user_id, role)
  VALUES (v_league_id, v_team_id, v_uid, 'manager');

  RETURN jsonb_build_object(
    'league_id', v_league_id,
    'team_id', v_team_id,
    'invite_code', v_invite_code,
    'replayed', false
  );
END;
$function$;

-- 2d. seat_league_member_internal (062) — the join/claim franchise name.
CREATE OR REPLACE FUNCTION public.seat_league_member_internal(p_league_id uuid, p_user_id uuid, p_faab_budget integer, p_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_team_id UUID;
  v_team_name TEXT;
  v_filled INTEGER;
BEGIN
  IF p_team_id IS NULL THEN
    -- ---------------------------------------------------------------------
    -- (a) NEW franchise: join_league_by_code / general claim (unchanged).
    -- ---------------------------------------------------------------------
    -- "<username>'s Team" (create_league's naming; the handle is the only
    -- name the product renders — 075. Profile always exists via
    -- handle_new_user).
    SELECT COALESCE(NULLIF(p.username, ''), 'My') || '''s Team'
      INTO v_team_name
    FROM public.profiles p
    WHERE p.id = p_user_id;
    v_team_name := COALESCE(v_team_name, 'My Team');

    -- Franchise (§7.2 "On join, a teams row is created"; list_id NULL — D35a).
    INSERT INTO public.teams (owner_id, name, league_id, list_id)
    VALUES (p_user_id, v_team_name, p_league_id, NULL)
    RETURNING id INTO v_team_id;

    -- Current-state cache (§12.2; faab_balance seeded from faab_budget).
    INSERT INTO public.league_members (league_id, user_id, team_id, role, faab_balance)
    VALUES (p_league_id, p_user_id, v_team_id, 'manager', p_faab_budget);

    -- Open stint (§12.22 — same txn as the cache write; clock_timestamp so a
    -- same-txn re-seat never reuses a prior stint's started_at, F3).
    INSERT INTO public.team_managers (league_id, team_id, user_id, role, started_at)
    VALUES (p_league_id, v_team_id, p_user_id, 'manager', clock_timestamp());

    RETURN v_team_id;
  END IF;

  -- -----------------------------------------------------------------------
  -- (b) EXISTING franchise: seat-targeted claim / assign_manager (L.A1.15).
  --     The caller has already locked the league and the teams row.
  -- -----------------------------------------------------------------------
  v_team_id := p_team_id;

  -- Stint FIRST so an occupied seat hits one_open_stint_per_team (E54's
  -- named mechanism — the caller's unique_violation handler owns the copy).
  INSERT INTO public.team_managers (league_id, team_id, user_id, role, started_at)
  VALUES (p_league_id, v_team_id, p_user_id, 'manager', clock_timestamp());

  -- FILL the placeholder cache row if one exists (§7.2:170 seats carry
  -- team_id, so a blind INSERT would trip UNIQUE(league_id, team_id) —
  -- D74(1)); otherwise create the cache row. faab_balance is re-seeded from
  -- the CURRENT budget either way (§12.2/v2.8.7 — never trust a stored
  -- placeholder balance).
  UPDATE public.league_members
  SET user_id = p_user_id,
      is_placeholder = FALSE,
      faab_balance = p_faab_budget
  WHERE league_id = p_league_id AND team_id = v_team_id AND user_id IS NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;
  IF v_filled = 0 THEN
    INSERT INTO public.league_members (league_id, user_id, team_id, role, faab_balance)
    VALUES (p_league_id, p_user_id, v_team_id, 'manager', p_faab_budget);
  END IF;

  -- owner_id follows the current manager (informational on league teams —
  -- D35b removed all client write paths for league_id IS NOT NULL); an
  -- orphaned franchise is resolved by being re-managed (§7.2.1(c)).
  UPDATE public.teams
  SET owner_id = p_user_id,
      status = CASE WHEN status = 'orphaned' THEN 'active' ELSE status END,
      updated_at = now()
  WHERE id = v_team_id;

  RETURN v_team_id;
END;
$function$;

-- 2e. get_join_preview (062) — the pre-auth claim page's inviter line
-- (§7.2/§16.4: league name + team label + inviter, never the invited email —
-- F2 is untouched; only the inviter's rendered form changes).
CREATE OR REPLACE FUNCTION public.get_join_preview(p_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_val TEXT;
  v_inv RECORD;
  v_league RECORD;
  v_status TEXT;
  v_team_label TEXT;
  v_inviter TEXT;
  v_active INTEGER;
  v_seats_open INTEGER;
BEGIN
  v_val := btrim(COALESCE(p_value, ''));
  IF v_val = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- 1. Seat/invite token (exact match — tokens are 32 lowercase hex).
  SELECT i.target_team_id, i.created_by, i.revoked_at, i.expires_at,
         i.use_count, i.max_uses,
         l.id AS league_id, l.name AS league_name, l.status AS league_status,
         l.team_count
    INTO v_inv
  FROM public.league_invites i
  JOIN public.leagues l ON l.id = i.league_id AND l.deleted_at IS NULL
  WHERE i.token = v_val;
  IF FOUND THEN
    SELECT t.name INTO v_team_label
    FROM public.teams t WHERE t.id = v_inv.target_team_id;
    -- 075: the inviter renders as their handle, like every other identity.
    SELECT '@' || p.username INTO v_inviter
    FROM public.profiles p WHERE p.id = v_inv.created_by;
    SELECT count(*)::int INTO v_active
    FROM public.teams t
    WHERE t.league_id = v_inv.league_id AND t.status <> 'retired';

    IF v_inv.revoked_at IS NOT NULL THEN
      v_status := 'revoked';
    ELSIF now() >= v_inv.expires_at THEN
      v_status := 'expired';
    ELSIF v_inv.use_count >= v_inv.max_uses THEN
      v_status := 'spent';
    ELSIF v_inv.target_team_id IS NOT NULL THEN
      -- Seat invite: the seat is filled iff the franchise has an OPEN stint.
      IF EXISTS (
        SELECT 1 FROM public.team_managers tm
        WHERE tm.team_id = v_inv.target_team_id AND tm.ended_at IS NULL
      ) THEN
        v_status := 'seat_filled';
      ELSE
        v_status := 'ok';
      END IF;
    ELSIF v_inv.league_status NOT IN ('setup', 'scheduled') THEN
      v_status := 'joins_closed';
    ELSIF v_active >= v_inv.team_count THEN
      v_status := 'league_full';
    ELSE
      v_status := 'ok';
    END IF;

    RETURN jsonb_build_object(
      'found', true,
      'type', 'invite',
      'status', v_status,
      'league_name', v_inv.league_name,
      'team_label', v_team_label,
      'inviter_name', v_inviter,
      'seats_open', CASE WHEN v_inv.target_team_id IS NULL
                         THEN greatest(v_inv.team_count - v_active, 0)
                         ELSE NULL END
    );
  END IF;

  -- 2. League share code, then 3. custom slug (§16.1 resolution order;
  --    lower() matching — case-insensitive without citext operator lookup).
  SELECT l.id, l.name AS league_name, l.status AS league_status, l.team_count,
         'code' AS rtype
    INTO v_league
  FROM public.leagues l
  WHERE l.deleted_at IS NULL AND lower(l.invite_code) = lower(v_val);
  IF NOT FOUND THEN
    SELECT l.id, l.name AS league_name, l.status AS league_status, l.team_count,
           'slug' AS rtype
      INTO v_league
    FROM public.leagues l
    WHERE l.deleted_at IS NULL AND lower(l.invite_slug::text) = lower(v_val);
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT count(*)::int INTO v_active
  FROM public.teams t
  WHERE t.league_id = v_league.id AND t.status <> 'retired';
  v_seats_open := greatest(v_league.team_count - v_active, 0);

  IF v_league.league_status NOT IN ('setup', 'scheduled') THEN
    v_status := 'joins_closed';
  ELSIF v_seats_open = 0 THEN
    v_status := 'league_full';
  ELSE
    v_status := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'type', v_league.rtype,
    'status', v_status,
    'league_name', v_league.league_name,
    'team_label', NULL,
    'inviter_name', NULL,
    'seats_open', v_seats_open
  );
END;
$function$;

-- 2f. draft_actor_name (069) — the chat/system-post actor.
CREATE OR REPLACE FUNCTION draft_actor_name()
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  -- 075: the handle is the caller's only rendered name ('@' || username),
  -- falling back to 'a commissioner' for a system caller with no JWT. Pure
  -- read of the caller's own profile row; EXECUTE left broad deliberately
  -- (leaks nothing beyond the caller's own handle, which is public anyway —
  -- the draft_team_for_pick breadth precedent).
  SELECT COALESCE(
    (SELECT '@' || p.username FROM public.profiles p WHERE p.id = auth.uid()),
    'a commissioner');
$$;

-- ---------------------------------------------------------------------------
-- 3. ai_personas.display_name → ai_personas.persona_name
-- ---------------------------------------------------------------------------
-- Not the same concept, and deliberately NOT collapsed into the handle: a
-- persona is a fictional AI analyst whose name is PUBLIC brand copy carrying
-- the "(AI)" transparency marker (spec-ai-expert-personas §7.2 parody
-- firewall). It has no human behind it and therefore no private full name.
-- Renamed only so that "display name" — the phrase Chris retired — survives
-- nowhere in the schema, and so the one public name column is unmistakably
-- distinct from the private profiles.full_name.
--
-- `expert_profiles.display_name` is intentionally left alone: that table is
-- dead legacy (no reader anywhere in the app) and renaming it would be noise.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_personas'
      AND column_name = 'display_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_personas'
      AND column_name = 'persona_name'
  ) THEN
    ALTER TABLE public.ai_personas RENAME COLUMN display_name TO persona_name;
  END IF;
END $$;

COMMENT ON COLUMN public.ai_personas.persona_name IS
  'PUBLIC. The persona''s human-readable parody name, always suffixed "(AI)" — brand copy for a fictional analyst, not a person''s name. Distinct from profiles.full_name, which is private (075).';
