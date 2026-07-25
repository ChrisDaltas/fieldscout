-- ============================================================================
-- create_league + soft_delete_league RPCs — M1 task L.A1.12. Spec: §15.1
-- (POST /api/leagues, DELETE /api/leagues/[id] soft delete), §7.2 ("Create
-- league (free — v2.8 ruling; no is_pro gate): name, season, team_count …
-- Creator becomes commissioner and gets a team"), §7.3.3 (v1 templates-only),
-- §7.3.8 ("exactly one scoring system referenced and readable"), §12.1
-- (typed columns + settings blob; max_teams kept in sync with team_count),
-- §12.2 (league_members; faab_balance seeded from leagues.faab_budget;
-- current-state cache + team_managers stint written in the same txn — v2.1
-- note), §12.22 (stints), §17 (create is free), tasks-M1 §5 sketch.
-- PROGRESS: D68 (this migration's mechanics); Q6/v2.8 (no Pro gate);
-- Q8/v2.8.2 (league state is server-authoritative — these RPCs are the ONLY
-- writers; 054 removed client DML, so the §15.1 DELETE verb needs the
-- soft_delete_league RPC shipped here, per the Q8 ruling's own text "the
-- §15.1 deletion flow is a commish soft delete via RPC").
--
-- NUMBERING (D50(1) precedent): next free migration at task time is **060**
-- (059 = scoring snapshot, landed); next free pgTAP file is **014**.
--
-- Contents:
--   1. `leagues.creation_action_id UUID` + UNIQUE constraint — the
--      idempotency key (plan §2.3 "retry-safe (`action_id` or natural key)";
--      the task sketch offers either — action_id CHOSEN, D68: a natural key
--      on (owner_id, name, season) would forbid a legitimately duplicate
--      league name, which no spec rule prohibits). The route generates one
--      UUID per user submit; retries reuse it; the UNIQUE constraint turns
--      the concurrent double-submit race into a caught unique_violation that
--      returns the FIRST create's payload (replayed: true) instead of a
--      second league.
--   2. `create_league(...)` — SECURITY DEFINER, SET search_path = '',
--      in-body auth (42501 when unauthenticated; NO is_pro read anywhere —
--      Q6/v2.8: creation is free), REVOKE FROM PUBLIC, anon (038 precedent;
--      standing rule §4.1). Single txn (plpgsql body = one atomic txn):
--      leagues row (all §12.1 typed columns as explicit args + the settings
--      blob EXACTLY as splitSettings produced it — the RPC never re-splits
--      or reshapes; L.A1.6/D60 is the §12.1 authority and the route is the
--      composition point, §12.0 layering) + invite_code generated (10-hex,
--      collision-retried against the 001 UNIQUE) + max_teams := p_team_count
--      (§12.1 NOTE — first writer of the sync rule) + commissioner
--      league_members row (faab_balance := p_faab_budget, §12.2) + teams row
--      (league_id set, list_id NULL — D35a) + the first team_managers stint
--      (open, started_week NULL — preseason, §12.22). In-body v1
--      templates-only check: p_scoring_system_id must reference a
--      scoring_systems row with is_template = TRUE AND owner_id IS NULL
--      (§7.3.3; the friendly per-field message names scoring_system_id so
--      the route maps it to a 400 field error — messages are UX, plan §8.3).
--      Full §7.3.8 settings validation is deliberately NOT re-implemented in
--      SQL (059 precedent): the Route Handler runs validateLeagueSettings
--      before calling; the DB backstops are 040's CHECKs (team_count 23514
--      surfaces through the RPC) and the D43 trigger (fires on the INSERT;
--      a created league is born 'setup' with a NULL snapshot — legitimate).
--   3. `soft_delete_league(p_league_id)` — same SECURITY DEFINER form +
--      REVOKE. In-body is_league_commish (42501; a nonexistent league yields
--      the same 42501 — no existence leak). Sets deleted_at = NOW() (§15.1
--      soft delete; CLAUDE.md rule 8 — never hard-delete). Already-deleted
--      or concurrently-deleted → idempotent no-op success (D63 retry
--      doctrine). No status restriction: §15.1 prints none, and M1 leagues
--      only sit in setup/scheduled anyway (059).
--
-- Held-lock note (plan §8.3 "<50ms held-lock assertion"): create_league
-- takes NO locks on pre-existing rows — no FOR UPDATE, no advisory locks;
-- it only inserts rows invisible to concurrent transactions (the
-- double-submit race is settled by the UNIQUE constraint, not a lock), so
-- there is no held-lock window to measure and the assertion is inapplicable
-- (cited per the DoD rather than silently skipped — D68).
-- soft_delete_league holds the league row FOR UPDATE across exactly one
-- following UPDATE statement — the minimal lock the write itself requires.
--
-- Grants doctrine (D18→D23/§4.1): no per-object GRANTs; both RPCs get the
-- explicit REVOKE narrowing (authenticated + service_role keep EXECUTE via
-- the 037 default ACLs; the in-body checks are the effective gate).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–060 + the full pgTAP suite is the
-- rehearsal evidence. Realtime line waived per D38 (no live subscriber in
-- the M1 UI slice). Typegen RE-RUN (R68 lesson: new PostgREST-exposed
-- functions and the new column change the generated surface); alias block
-- re-appended, diff verified additive-only.
-- Prod-safe: additive column + constraint on a zero-row table + new
-- functions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Idempotency key (action_id — D68)
-- ----------------------------------------------------------------------------
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS creation_action_id UUID;

ALTER TABLE leagues
  ADD CONSTRAINT leagues_creation_action_id_key UNIQUE (creation_action_id);

-- ----------------------------------------------------------------------------
-- 2. create_league — §15.1 POST /api/leagues (the one sanctioned writer)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_league(
  p_name TEXT,
  p_season INTEGER,
  p_team_count INTEGER,
  p_settings JSONB,
  p_roster_settings JSONB,
  p_scoring_system_id UUID,
  p_team_name TEXT,
  p_action_id UUID,
  -- Remaining §12.1 typed columns, explicit and mandatory (splitSettings is
  -- the authority — the route maps every TYPED_COLUMN_KEY to p_<key>
  -- mechanically; a future typed column added in TS without a matching arg
  -- here fails LOUDLY at the PostgREST boundary instead of silently landing
  -- in the blob. D68).
  p_format TEXT,
  p_regular_season_weeks INTEGER,
  p_playoff_teams INTEGER,
  p_playoff_start_week INTEGER,
  p_waiver_type TEXT,
  p_faab_budget INTEGER,
  p_trade_review TEXT,
  p_trade_deadline_week INTEGER,
  p_lineup_lock TEXT
) RETURNS JSONB
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
  SELECT l.id, l.owner_id, l.invite_code INTO v_existing
  FROM public.leagues l
  WHERE l.creation_action_id = p_action_id;
  IF FOUND THEN
    IF v_existing.owner_id <> v_uid THEN
      RAISE EXCEPTION 'create_league: this action_id was already used by another account'
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

  -- Default team name: "<display name>'s Team" (falls back to username /
  -- 'My' — profile always exists via handle_new_user).
  SELECT COALESCE(NULLIF(p.display_name, ''), p.username, 'My') || '''s Team'
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
        SELECT l.id, l.invite_code INTO v_existing
        FROM public.leagues l
        WHERE l.creation_action_id = p_action_id AND l.owner_id = v_uid;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'create_league: this action_id was already used by another account'
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

REVOKE EXECUTE ON FUNCTION create_league(
  TEXT, INTEGER, INTEGER, JSONB, JSONB, UUID, TEXT, UUID,
  TEXT, INTEGER, INTEGER, INTEGER, TEXT, INTEGER, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 3. soft_delete_league — §15.1 DELETE /api/leagues/[id] (commish soft
--    delete; the Q8 ruling's named RPC — no client DELETE verb exists)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_league(p_league_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ;
BEGIN
  -- In-body authorization (§12.0/§8.3): commissioner or co-commissioner.
  -- A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'soft_delete_league: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.deleted_at INTO v_deleted_at
  FROM public.leagues l
  WHERE l.id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Commish check passed but the row vanished (hard-delete race — not a
    -- sanctioned path): treat as already gone, idempotently.
    RETURN;
  END IF;

  -- Idempotent no-op: a retried delete must not error (D63 doctrine).
  IF v_deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.leagues
  SET deleted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_league_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION soft_delete_league(UUID) FROM PUBLIC, anon;
