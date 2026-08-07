-- ============================================================================
-- 077 — drop profiles.display_name (identity ruling, Chris 2026-08-05).
--
--   "we don't need either a display name or a full name. we just need the
--    email, password and unique username."
--
-- FieldScout stores NO name for a person: an account is an email, a password
-- and a permanent unique username. 075 stopped `handle_new_user` writing a
-- name and NULLed the rows; 076 restored the username guards alongside it.
-- The column has been dead weight ever since — this migration removes it.
--
-- DESTRUCTIVE AND IRREVERSIBLE. `ALTER TABLE … DROP COLUMN` cannot be undone
-- by a later migration; the values are gone. That is safe here and only here
-- because **every row's `display_name` is already NULL** — verified against
-- production immediately before authoring this file (6 profiles, 0 with a
-- non-NULL value, 2026-08-07). No data is lost by the drop. The DO block
-- below re-verifies that at apply time and aborts rather than destroying a
-- value that appeared in the meantime.
--
-- ORDERING (hard constraint — runbook-hosted-migration-reconciliation.md,
-- "After this lands"): this must be the HIGHEST-numbered migration. Thirteen
-- earlier migrations read or write the column — 001 (creates it), 006, 019,
-- 038, 048, 049, 050, 051, 060, 062, 069, 073, 075 (076 only mentions it in
-- prose; 020's `display_name` is the unrelated ai_personas column) — so a
-- fresh `supabase db reset` only replays cleanly while the drop is last.
-- Those earlier migrations are deliberately NOT edited: they run before this
-- one. Do not add a migration after this one that touches
-- `profiles.display_name`.
--
-- ----------------------------------------------------------------------------
-- Dependency scan against LIVE production (2026-08-07), not against the repo:
--
--   Views / materialized views ..................... 0
--   Indexes ........................................ 0
--   Constraints (CHECK/UNIQUE/FK/exclusion) ........ 0
--   Column defaults / generated columns ............ 0
--   RLS policies (USING + WITH CHECK) .............. 0
--   Trigger functions referencing the column ....... 0
--   Functions referencing the column ............... 5   ← handled below
--
-- Postgres does NOT track function-body dependencies, so those five would not
-- block the drop — they would break at RUNTIME, on the next call, with
-- `column "display_name" does not exist`. They are therefore re-pointed FIRST,
-- in this same migration, so no instant exists in which a live function
-- references a column that is gone:
--
--   1. notify_list_followers  (019/038) — fires on every list update. Lists is
--                                         one of three launch surfaces, so
--                                         this is the highest-risk one.
--   2. create_league          (060)
--   3. seat_league_member_internal (062)
--   4. get_join_preview       (062)     — reachable over the ANON key.
--   5. draft_actor_name       (069)
--
-- Each read the column through a COALESCE onto `username`. The ONLY edit is
-- removing the `display_name` term so the expression resolves to the username
-- directly — the observable result is unchanged for every existing row,
-- because every row's `display_name` is already NULL and each chain already
-- fell through to `username`. Signatures, volatility, SECURITY DEFINER/INVOKER,
-- `search_path` pins, grants and all surrounding logic are byte-for-byte as
-- deployed; the bodies below were dumped from production with
-- `pg_get_functiondef`, NOT copied from the repo's migration files (production
-- and the repo have diverged before — that is what caused the 2026-08 hosted
-- migration reconciliation). Only the stale COMMENTS describing the old
-- COALESCE chain are reworded, so the source does not lie about itself.
--
-- CREATE OR REPLACE FUNCTION preserves the existing ACL (grants are attached
-- to the pg_proc row, which is updated in place, not dropped and recreated) —
-- so 038's `REVOKE EXECUTE … FROM PUBLIC, anon` on notify_list_followers
-- survives untouched, as do the authenticated/service_role grants on the rest.
-- It likewise preserves any dependent trigger, since the pg_proc OID is
-- unchanged. For the record, notify_list_followers is NOT trigger-bound: it is
-- a two-argument `RETURNS void` RPC invoked from application code
-- (src/lib/lists/helpers.ts), and production carries zero triggers whose
-- function body mentions the column. Nothing here re-grants or re-revokes, so
-- there is no window in which the ACL is wider than 038 left it.
--
-- NOT TOUCHED: `ai_personas.display_name` and `expert_profiles.display_name`
-- are unrelated NOT NULL columns — an AI persona's public parody brand name
-- ("Bathew Merry (AI)") and a dead legacy table. Neither is a person's name.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. notify_list_followers — 019 body + 038's in-body authorization.
--    SECURITY DEFINER · search_path = public, pg_temp (unqualified identifiers
--    below are deliberate and depend on it — preserved exactly as deployed).
--
--    THE EDIT: `COALESCE(display_name, '@' || username)` becomes
--    `'@' || username`.
--
--    Note on the in-body comments below (and in all five): they do NOT name
--    the dropped column. `pg_proc.prosrc` stores comments, so a body that
--    merely MENTIONS it is indistinguishable from one that READS it in the
--    universal pgTAP sweep (supabase/tests/027) that guards against a future
--    reader. The "what it was" record lives out here in the migration instead.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_list_followers(p_list_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- 077: the actor is the handle, full stop. A NULL username (impossible
  -- today) still falls through to 'Someone' below, exactly as before.
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
$$;

-- ----------------------------------------------------------------------------
-- 2. create_league — 060 body. SECURITY DEFINER · search_path = ''.
--    THE EDIT: the default team name's
--    `COALESCE(NULLIF(p.display_name, ''), p.username, 'My')` becomes
--    `COALESCE(p.username, 'My')`.
-- ----------------------------------------------------------------------------
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

  -- Default team name: "<username>'s Team" (falls back to 'My' — profile
  -- always exists via handle_new_user). 077: the handle is the only source.
  SELECT COALESCE(p.username, 'My') || '''s Team'
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
$$;

-- ----------------------------------------------------------------------------
-- 3. seat_league_member_internal — 062 body. SECURITY INVOKER (deliberately
--    not DEFINER — its callers are the DEFINER routines) · search_path = ''.
--    THE EDIT: same as create_league's — the franchise name's
--    `COALESCE(NULLIF(p.display_name, ''), p.username, 'My')` becomes
--    `COALESCE(p.username, 'My')`.
-- ----------------------------------------------------------------------------
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
BEGIN
  IF p_team_id IS NULL THEN
    -- ---------------------------------------------------------------------
    -- (a) NEW franchise: join_league_by_code / general claim (unchanged).
    -- ---------------------------------------------------------------------
    -- "<username>'s Team" (create_league's naming; profile always exists via
    -- handle_new_user). 077: the handle is the only source.
    SELECT COALESCE(p.username, 'My') || '''s Team'
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
$$;

-- ----------------------------------------------------------------------------
-- 4. get_join_preview — 062 body. STABLE SECURITY DEFINER · search_path = ''.
--    Reachable over the ANON key (pre-auth invite preview, D48).
--    THE EDIT: the inviter lookup's
--    `COALESCE(NULLIF(p.display_name, ''), p.username)` becomes `p.username`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_join_preview(p_value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
    -- 077: the inviter is identified by handle only.
    SELECT p.username INTO v_inviter
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
$$;

-- ----------------------------------------------------------------------------
-- 5. draft_actor_name — 069 body. STABLE, SECURITY INVOKER · search_path = ''.
--    THE EDIT: the inner `COALESCE(NULLIF(p.display_name, ''), p.username)`
--    becomes `p.username`. The OUTER COALESCE onto 'a commissioner' stays —
--    it covers a system caller with no JWT, which is a different case.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.draft_actor_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  -- 077: the chain is username → 'a commissioner' (the fallback still covers
  -- a system caller with no JWT). Pure read of the caller's own profile row;
  -- EXECUTE left broad deliberately (leaks nothing beyond the caller's own
  -- handle — the draft_team_for_pick breadth precedent).
  SELECT COALESCE(
    (SELECT p.username
     FROM public.profiles p WHERE p.id = auth.uid()),
    'a commissioner');
$$;

-- ----------------------------------------------------------------------------
-- 6. The drop.
--
-- Tripwire first: refuse to destroy a value. If any row somehow holds a
-- display_name at apply time this raises, the drop never runs, and the column
-- survives with its data intact. Verified both ways on a scratch database:
--
--   * Applied atomically — which is how `supabase db push` / `db reset` apply
--     it, each migration wrapped in one transaction — the raise rolls the
--     whole file back, function replacements included.
--   * Applied statement-by-statement (a bare `psql` without `-1`), the five
--     replacements commit and only the drop is skipped. That partial state is
--     deliberately the SAFE one, and it is why the ordering is functions-then-
--     drop rather than the reverse: the re-pointed bodies read `username`,
--     which works whether or not the column is still there. The reverse order
--     has no safe partial state at all.
--
-- Re-running after the column is gone is a no-op — the EXISTS guard skips the
-- check (the count is dynamic so it still parses), and DROP COLUMN IF EXISTS
-- skips the drop.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_named BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'display_name'
  ) THEN
    -- Dynamic so this block still parses once the column is gone.
    EXECUTE 'SELECT count(*) FROM public.profiles WHERE display_name IS NOT NULL'
      INTO v_named;
    IF v_named > 0 THEN
      RAISE EXCEPTION
        '077: % profile row(s) still hold a display_name — refusing to drop the column and destroy them. Investigate how a name was written (075/076 should make it impossible), NULL them deliberately, then re-run.',
        v_named
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS display_name;
