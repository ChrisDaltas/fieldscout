-- ============================================================================
-- 196 — a team name is at most 24 characters, everywhere (Chris 2026-10-18:
--       "team names ≤ 24 everywhere" — the same on the phone, on desktop and
--       on the server; spec v2.16.94 §7.2; PROGRESS D545; settles F356)
-- ============================================================================
--
-- BEFORE: the phone's My team page held a name to 24, but the server and
-- desktop allowed 100 (128's shared rename gate) and create-league's optional
-- team name 60 (Zod only — no SQL bound at all on that door or on a
-- commissioner's added seat). LEAGUE names are NOT part of this ruling: the
-- league-name bound (100) is untouched.
--
-- EVERY DOOR THAT WRITES A TEAM NAME, and what 196 does to it:
--
--   rename_own_team / rename_own_team_internal (128)   ┐ both call the ONE
--   commish_rename_team / _internal (170, the head)    ┘ shared gate below:
--     1. team_rename_normalize_internal — 128's text; ONE hunk, the bound
--        100 → 24 and its message. Neither verb's body is replaced.
--   create_league (118, the head)
--     3. 118's text; TWO hunks — a given team name over 24 is refused (P0001,
--        before any write and after the replay), and the derived default goes
--        through the helper (2).
--   seat_league_member_internal (146, the head) — join by code / general
--   claim mints "<username>'s Team"; a seat-targeted claim, assign_manager
--   and every takeover keep the team's own name (no write)
--     4. 146's text; ONE hunk — the derived default through the helper (2).
--   add_placeholder_seat (169, the head)
--     5. 169's text; ONE hunk — a given name over 24 is refused (22023, the
--        house's argument-shape code; members-service maps it to a 400).
--   NOT CHANGED, measured: remove_manager (176) writes no name since retire
--   went; create_mock_draft (102) names its seats 'My Team' / 'CPU N';
--   add_placeholder_seat's own default is 'Team N'. Standalone teams
--   (`league_id IS NULL`, 095's owner UPDATE policy) are mock seats nothing
--   in the app renames.
--
--   2. team_default_name_internal — NEW, PLAIN, search_path '', REVOKEd: the
--      automatic name. "<username>'s Team" exactly as create_league and
--      seat_league_member_internal built it (077), whenever that fits in 24
--      — which is every username of up to 17 characters. A username of 18–20
--      (the human range is 5–20) would make 25–27, so the team is named after
--      the username alone (Sleeper's default); 'My Team' only where even that
--      cannot fit (no human username can reach it) or no profile exists.
--
-- NO TABLE CHECK on `teams.name`, on purpose: a name set before the rule (up
-- to 100) keeps reading and showing, and an UPDATE that does not write the
-- name (a takeover, a vacancy, autopilot, the owner sync) is not refused —
-- the limit binds a name being written, at the doors that write one.
--
-- HEAD OF CHAIN (CLAUDE.md migration discipline): each replaced body is the
-- NEWEST migration's text — 128:351-374, 118:2224-2432, 146:756-875,
-- 169:237-343 — with only the hunks above. SECURITY DEFINER / INVOKER,
-- search_path '' and every grant are as they were (CREATE OR REPLACE keeps
-- the ACL; each REVOKE is repeated from its head file).
--
-- DEPLOY ORDER (TD9): the app's 24 (teamNameSchema + every input's
-- maxLength) is stricter than the old schema, so the app works on either
-- side of this push; old app code on the new schema meets this refusal as a
-- 400. pgTAP 146_team_name_24.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. team_rename_normalize_internal — 128:351-374's FILE TEXT, 1 hunk.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION team_rename_normalize_internal(
  p_name TEXT,
  p_verb TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
BEGIN
  v_name := NULLIF(btrim(COALESCE(p_name, ''), E' \t\r\n'), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION
      '%: a team name is required — blank, or nothing but whitespace (spaces, tabs, newlines), is not a name', COALESCE(p_verb, 'team_rename')
      USING ERRCODE = '22023';
  END IF;
  -- 196 (Chris 2026-10-18): the one team-name rule, 24 (was 100).
  IF char_length(v_name) > 24 THEN
    RAISE EXCEPTION
      '%: the team name is % characters — team names can be up to 24 characters', COALESCE(p_verb, 'team_rename'), char_length(v_name)
      USING ERRCODE = '22023';
  END IF;
  RETURN v_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION team_rename_normalize_internal(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. team_default_name_internal — NEW: the automatic team name, within 24.
--    Mirrors 077's expression exactly where it fits: a profile with a NULL
--    username still yields "My's Team" (077's COALESCE), and no profile row
--    yields 'My Team' (077's fallback).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION team_default_name_internal(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_username TEXT;
  v_name TEXT;
BEGIN
  SELECT p.username INTO v_username
  FROM public.profiles p
  WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RETURN 'My Team';
  END IF;
  v_name := COALESCE(v_username, 'My') || '''s Team';
  IF char_length(v_name) <= 24 THEN
    RETURN v_name;
  END IF;
  IF char_length(v_username) <= 24 THEN
    RETURN v_username;
  END IF;
  RETURN 'My Team';
END;
$$;
REVOKE EXECUTE ON FUNCTION team_default_name_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_league — 118:2224-2432's FILE TEXT, 2 hunks (the given name's
--    bound; the default through §2). 060's REVOKE stands (CREATE OR REPLACE
--    keeps the ACL: authenticated may call, the sign-in check is in-body).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_league(
  p_name TEXT,
  p_season INTEGER,
  p_team_count INTEGER,
  p_settings JSONB,
  p_roster_settings JSONB,
  p_scoring_system_id UUID,
  p_team_name TEXT,
  p_action_id UUID,
  p_format TEXT,
  p_regular_season_weeks INTEGER,
  p_playoff_teams INTEGER,
  p_playoff_start_week INTEGER,
  p_waiver_type TEXT,
  p_faab_budget INTEGER,
  p_trade_review TEXT,
  p_trade_deadline_week INTEGER,
  p_lineup_lock TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  -- Q39 (C) — spec v2.16.25 §7.3.1 / §11.7 (Chris 2026-09-07): a total-points
  -- league has NO playoff bracket — the season-long points race IS its
  -- playoff — so `playoff_teams > 0` with `schedule_mode = total_points` is
  -- refused at settings time with a plain message (the same backstop shape
  -- as Q10's: validateLeagueSettings catches it first on the API path; a
  -- direct caller meets it here). The message names `playoff_teams` and no
  -- other marker (the leagues-service field mapper is first-match).
  IF p_playoff_teams > 0 AND COALESCE(p_settings ->> 'schedule_mode', 'h2h') = 'total_points' THEN
    RAISE EXCEPTION 'create_league: playoff_teams must be 0 for a total-points league — the season-long points race is its playoff and there is no bracket; set playoff teams to 0 or switch to head-to-head (§11.7, Q39 (C))'
      USING ERRCODE = 'P0001';
  END IF;

  -- 196 (Chris 2026-10-18: team names ≤ 24 everywhere; spec v2.16.94 §7.2)
  -- — the creator's team name, when one is given, is at most 24 characters,
  -- counted after the same btrim the INSERT below applies. AFTER the replay
  -- (a retry of a committed create still replays) and BEFORE any write.
  -- P0001 so leagues-service maps it to the `team_name` field (its marker is
  -- the rule's own words); `createLeagueInputSchema` refuses it first there.
  IF char_length(NULLIF(btrim(p_team_name), '')) > 24 THEN
    RAISE EXCEPTION 'create_league: the team name is % characters — team names can be up to 24 characters', char_length(btrim(p_team_name))
      USING ERRCODE = 'P0001';
  END IF;

  -- Default team name: "<username>'s Team" (077: the handle is the only
  -- source). 196: through the shared helper, which keeps it within the
  -- 24-character rule (the username alone when "<username>'s Team" is longer).
  v_default_team_name := public.team_default_name_internal(v_uid);

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
$$;

-- ---------------------------------------------------------------------------
-- 4. seat_league_member_internal — 146:756-875's FILE TEXT, 1 hunk (the
--    default through §2). PLAIN, SECURITY INVOKER, as 062/077/146 had it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seat_league_member_internal(
  p_league_id UUID,
  p_user_id UUID,
  p_faab_budget INTEGER,
  p_team_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
  v_team_name TEXT;
  v_filled INTEGER;
  v_status TEXT;        -- 146 (L.D2.6 / C72): the league's status, read under the caller's lock
BEGIN
  IF p_team_id IS NULL THEN
    -- ---------------------------------------------------------------------
    -- (a) NEW franchise: join_league_by_code / general claim (unchanged).
    -- ---------------------------------------------------------------------
    -- "<username>'s Team" (create_league's naming; 077: the handle is the
    -- only source). 196: through the shared helper, which keeps it within the
    -- 24-character rule (the username alone when "<username>'s Team" is longer).
    v_team_name := public.team_default_name_internal(p_user_id);

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

  -- 146 (L.D2.6 / C72): the league's status decides whether the seat's FAAB
  -- balance re-seeds (before the draft) or carries (from `drafting` on).
  -- Every caller already holds this row FOR UPDATE (claim_league_invite
  -- `FOR UPDATE OF i, l`; assign_manager) — re-taking the lock in the same
  -- transaction is a no-op that keeps the helper TOCTOU-safe on its own.
  SELECT l.status INTO v_status
  FROM public.leagues l
  WHERE l.id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'seat_league_member_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Stint FIRST so an occupied seat hits one_open_stint_per_team (E54's
  -- named mechanism — the caller's unique_violation handler owns the copy).
  INSERT INTO public.team_managers (league_id, team_id, user_id, role, started_at)
  VALUES (p_league_id, v_team_id, p_user_id, 'manager', clock_timestamp());

  -- FILL the placeholder cache row if one exists (§7.2:170 seats carry
  -- team_id, so a blind INSERT would trip UNIQUE(league_id, team_id) —
  -- D74(1)); otherwise create the cache row. 146 (L.D2.6 / C72): BEFORE the
  -- draft starts faab_balance is re-seeded from the CURRENT budget (§12.2 /
  -- v2.8.7 — pre-draft balances carry no history, so a stored placeholder
  -- value is never trusted); from `drafting` on the balance is the
  -- franchise's and the new manager inherits it unchanged (§7.2.1(a) /
  -- E49 — a vacated or left seat, or a retired franchise's successor, keeps
  -- what the team has not spent).
  UPDATE public.league_members
  SET user_id = p_user_id,
      is_placeholder = FALSE,
      faab_balance = CASE WHEN v_status IN ('setup', 'scheduled')
                          THEN p_faab_budget ELSE faab_balance END
  WHERE league_id = p_league_id AND team_id = v_team_id AND user_id IS NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;
  IF v_filled = 0 THEN
    -- 146: zero rows filled means one of two things — prove which. An
    -- OCCUPIED seat row falls through to the INSERT, which trips
    -- UNIQUE(league_id, team_id) exactly as before (the caller's
    -- unique_violation handler owns that copy — E54). NO seat row at all
    -- is a state no writer produces (one league_members row per seat,
    -- always — §12.2; D339 names it); after the draft has started there is
    -- no balance to carry, and minting a fresh budget would create money
    -- (C72), so it refuses BY NAME. Before the draft the INSERT seeds the
    -- budget as it always has.
    IF v_status NOT IN ('setup', 'scheduled') THEN
      PERFORM 1 FROM public.league_members m
      WHERE m.league_id = p_league_id AND m.team_id = v_team_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'seat_league_member_internal: franchise % has no seat row in league % — its FAAB balance cannot be carried, and a fresh budget is never minted once the draft has started (§12.2 / C72); repair the seat before seating a manager', v_team_id, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
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
$$;

REVOKE EXECUTE ON FUNCTION public.seat_league_member_internal(UUID, UUID, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. add_placeholder_seat — 169:237-343's FILE TEXT, 1 hunk (the given
--    name's bound).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_placeholder_seat(
  p_league_id UUID,
  p_team_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_actor_role TEXT;
  v_seated INTEGER;
  v_team_id UUID;
  v_member_id UUID;
  v_name TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'add_placeholder_seat: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  -- In-body authorization (§12.0/§8.3). A nonexistent league yields FALSE
  -- here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'add_placeholder_seat: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the league row FIRST (lock order leagues → teams) — this is also
  -- what serializes the capacity check against concurrent joins/claims.
  SELECT l.id, l.status, l.team_count, l.faab_budget INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'add_placeholder_seat: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- RE-GATE UNDER THE LOCK (R90/R93 class). The pre-lock is_league_commish
  -- read above is a fast-fail that answers a STALE question: an actor demoted
  -- while this call blocked on the league row would otherwise complete one
  -- privileged write. Roles move ONLY under this same lock (set_member_role
  -- takes it first), so a read taken here is stable for the rest of the txn.
  -- Kept in addition to — not instead of — the pre-lock check, which is what
  -- keeps a nonexistent league answering 42501 rather than leaking P0002.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('commissioner', 'co_commissioner') THEN
    RAISE EXCEPTION 'add_placeholder_seat: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  IF v_league.status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION 'add_placeholder_seat: seats can only be added before the draft starts (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Capacity (D47/F28): the ONE predicate, byte-for-byte identical to
  -- 061's shrink floor and 062's join/claim checks, evaluated under the lock.
  SELECT count(*)::int INTO v_seated
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_seated >= v_league.team_count THEN
    RAISE EXCEPTION 'add_placeholder_seat: this league already has all % seats — raise team_count first', v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  -- Franchise name contract (D74(5)): caller-supplied, else "Team N".
  v_name := COALESCE(NULLIF(btrim(p_team_name), ''), 'Team ' || (v_seated + 1)::text);
  -- 196 (Chris 2026-10-18: team names ≤ 24 everywhere): a caller-supplied
  -- name is at most 24 characters ("Team N" always fits). Before any write.
  IF char_length(v_name) > 24 THEN
    RAISE EXCEPTION 'add_placeholder_seat: the team name is % characters — team names can be up to 24 characters', char_length(v_name)
      USING ERRCODE = '22023';
  END IF;

  -- §7.2:170 shape: a teams row owned by the commissioner (list_id NULL —
  -- D35a), NO stint (team_managers.user_id is NOT NULL by design).
  INSERT INTO public.teams (owner_id, name, league_id, list_id)
  VALUES (v_uid, v_name, p_league_id, NULL)
  RETURNING id INTO v_team_id;

  -- Cache row: team_id SET (the seat IS a franchise), is_placeholder set
  -- EXPLICITLY, faab seeded from the current budget (§12.2).
  INSERT INTO public.league_members
    (league_id, user_id, team_id, role, is_placeholder, faab_balance)
  VALUES
    (p_league_id, NULL, v_team_id, 'manager', TRUE, v_league.faab_budget)
  RETURNING id INTO v_member_id;

  -- 169/L.E1.30 (F32) — THE RECEIPT: the seat just added, named. A new seat
  -- is always a change (every refusal above writes nothing).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'add_placeholder_seat', 'add_seat', 'team',
    v_team_id::text, NULL,
    NULL,
    jsonb_build_object('team_id', v_team_id, 'team_name', v_name, 'placeholder', TRUE),
    jsonb_build_object('member_id', v_member_id, 'seats_filled', v_seated + 1,
                       'team_count', v_league.team_count,
                       'affected_team_ids', jsonb_build_array(v_team_id)));

  RETURN jsonb_build_object(
    'member_id', v_member_id,
    'team_id', v_team_id,
    'team_name', v_name,
    'seats_filled', v_seated + 1,
    'team_count', v_league.team_count
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION add_placeholder_seat(UUID, TEXT) FROM PUBLIC, anon;
