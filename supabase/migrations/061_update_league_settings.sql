-- ============================================================================
-- update_league_settings RPC — M1 task L.A1.13 (settings PATCH's writer).
-- Spec: §15.1 (PATCH /api/leagues/[id] "update settings (commish; structural
-- changes post-draft are overrides)"), §7.3 header ("All settings are editable
-- in setup/scheduled. After the draft, structural settings … become
-- commissioner-override-only" — the override path is M6; M1 refuses), §7.3.3
-- (v1 templates-only; "on any commissioner scoring change, the template's full
-- rules JSONB is frozen into leagues.scoring_rules_snapshot"), §7.3.8
-- ("enforced in API + DB constraints"), §12.1 (typed columns + settings blob;
-- "max_teams kept in sync with team_count" — create_league was the first
-- writer of the sync, THIS is the second: any write that changes team_count
-- writes max_teams = team_count in the same statement), §12.2 (faab_balance
-- seeded from leagues.faab_budget). PROGRESS: D70 (this task's mechanics),
-- D68/D69 (create_league precedent this RPC mirrors), Q8/v2.8.2 (league state
-- is server-authoritative — clients hold NO UPDATE on leagues, so the PATCH
-- route needs this SECURITY DEFINER writer; house precedent: create_league +
-- soft_delete_league are both RPCs).
--
-- NUMBERING (D50(1) precedent): next free migration at task time is **061**
-- (060 = create_league, landed); next free pgTAP file is **015**.
--
-- Contents — `update_league_settings(...)`, SECURITY DEFINER,
-- SET search_path = '', REVOKE FROM PUBLIC, anon (038 precedent; standing
-- rule §4.1). In-body, in order:
--   1. Commissioner auth via is_league_commish (42501; a nonexistent league
--      yields the same 42501 — no existence leak).
--   2. League row taken FOR UPDATE (deleted_at IS NULL; soft-deleted/vanished
--      → P0002 not found). Held-lock note (plan §8.3): the FOR UPDATE is held
--      across exactly the one UPDATE (+ the conditional members re-seed) the
--      write requires — the minimal lock, same shape as soft_delete_league
--      (D68(5)).
--   3. STATUS GATE (§7.3 header): settings writable only in
--      'setup'/'scheduled' — anything later refuses with a friendly P0001 the
--      route maps to a clear 409 (task text: "the post-draft override path is
--      M6; M1 returns a clear 409"). In-body deliberately (the R75 lesson: a
--      direct-PostgREST caller never runs the API layer, and M2+ leagues
--      exist from the next milestone on — the DB refuses instead of trusting
--      route prose).
--   3.5 SHRINK FLOOR (F28/R81, amended in place by L.A1.14 — unreleased
--      migration, prod history still ends at 036 (F12); D64(5)/D69
--      amend-don't-stack precedent): team_count may not drop below the
--      number of franchises already seated (active/orphaned teams — retired
--      franchises freed their slot, §7.2.1(b)). Before the join path landed
--      this was unreachable (creation seats exactly one team); L.A1.14's
--      join/claim RPCs make real occupancy reachable, so a commissioner
--      shrink could orphan seats. The floor is enforced in-body at BOTH
--      writers (here + the join/claim capacity check under the same
--      league-row lock — 062), so teams count ≤ team_count holds in both
--      directions. Friendly P0001 naming team_count (the route maps it to a
--      per-field 400); pinned in pgTAP 016 (boundary: shrink to exactly the
--      seated count succeeds; one past refuses with no-write).
--   4. Q10 STRICT-CONTINUITY BACKSTOP (R75/D69 doctrine, carried to the
--      second writer): the 13–16 range (§7.3.1 R column) checked FIRST, then
--      strict continuity playoff_start_week = regular_season_weeks + 1
--      (Q10 ruling, v2.8.6) — identical order and message shape to
--      create_league so a seam-consistent-but-out-of-range pair names the
--      range. SCOPE BOUNDARY (D68(3)/D69, restated here so the backstop's
--      scope is auditable): full §7.3.8 blob-shape validation deliberately
--      STAYS API-side (the Route Handler runs validateLeagueSettings before
--      calling — L.A1.13 is the named enforcement point per 059's banner);
--      the in-body checks cover the typed-column invariants whose violation
--      is invisible to 040's CHECKs (seam, range, templates-only, status
--      gate). 040's team_count CHECK (23514) still surfaces through the RPC.
--   5. v1 TEMPLATES-ONLY (§7.3.3, same check as create): when
--      p_scoring_system_id IS NOT NULL it must reference a scoring_systems
--      row with is_template = TRUE AND owner_id IS NULL (both predicates
--      checked so the guard survives a 058-CHECK change); friendly
--      field-named message the route maps to a per-field 400.
--      p_scoring_system_id NULL means "keep the current reference" — the
--      current value already passed this check at create/last update.
--   6. PRE-DRAFT RE-FREEZE (§7.3.3 "on any commissioner scoring change …
--      frozen"): if the scoring reference CHANGES and a snapshot already
--      exists (a pre-draft freeze via snapshot_league_scoring — legal in
--      setup/scheduled, 059/R69), the snapshot is refreshed from the NEW
--      template's rules in the same transaction — a stale snapshot
--      diverging from the league's chosen template is exactly the corrupt
--      state §7.3.3's freeze rule exists to prevent. A NULL snapshot stays
--      NULL (no premature freeze — M2's draft_start owns the draft-start
--      freeze).
--   7. ONE atomic UPDATE writes every §12.1 typed column + the settings blob
--      EXACTLY as splitSettings produced it (the RPC never re-splits or
--      reshapes — L.A1.6/D60 is the §12.1 authority; args mirror
--      create_league's explicit p_<key> mapping so a future typed column
--      added in TS without a matching arg fails LOUDLY at the PostgREST
--      boundary) + max_teams = p_team_count in the SAME statement (§12.1
--      NOTE) + scoring_system_id + the conditional snapshot refresh +
--      updated_at.
--   8. §12.2 BALANCE RE-SEED: when faab_budget changes, every
--      league_members.faab_balance in the league is re-seeded to the new
--      budget. Rationale (D70): §12.2's invariant is "faab_balance seeded
--      from leagues.faab_budget", and NOTHING spends FAAB before in_season
--      (waivers are in-season machinery) — so pre-draft, balances carry no
--      history and re-seeding is the only way to keep every seat consistent
--      with the budget (otherwise a budget change strands existing members
--      at the old figure while L.A1.14's join seeds new members from the new
--      one — mixed balances with no owner). The status gate above guarantees
--      this only ever runs pre-draft.
--
-- Grants doctrine (D18→D23/§4.1): no per-object GRANTs; the RPC gets the
-- explicit REVOKE narrowing (authenticated + service_role keep EXECUTE via
-- the 037 default ACLs; the in-body checks are the effective gate).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–061 + the full pgTAP suite is the
-- rehearsal evidence. Realtime line waived per D38 (no live subscriber in
-- the M1 UI slice). Typegen RE-RUN (R68 lesson: a new PostgREST-exposed
-- function changes the generated Functions surface); alias block
-- re-appended, diff verified additive-only.
-- Prod-safe: one new function; no table/column/policy changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_league_settings(
  p_league_id UUID,
  p_team_count INTEGER,
  p_settings JSONB,
  p_roster_settings JSONB,
  p_scoring_system_id UUID,  -- NULL = keep the current reference
  -- Remaining §12.1 typed columns, explicit and mandatory (splitSettings is
  -- the authority — the service maps every TYPED_COLUMN_KEY to p_<key>
  -- mechanically, exactly as create_league does. D68/D70).
  p_format TEXT,
  p_regular_season_weeks INTEGER,
  p_playoff_teams INTEGER,
  p_playoff_start_week INTEGER,
  p_waiver_type TEXT,
  p_faab_budget INTEGER,
  p_trade_review TEXT,
  p_trade_deadline_week INTEGER,
  p_lineup_lock TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_current_scoring UUID;
  v_current_faab_budget INTEGER;
  v_snapshot JSONB;
  v_new_scoring UUID;
  v_seated INTEGER;
BEGIN
  -- 1. In-body authorization (§12.0/§8.3): commissioner or co-commissioner.
  --    A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'update_league_settings: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Row lock (serializes with concurrent PATCHes and status transitions);
  --    soft-deleted leagues are not found.
  SELECT l.status, l.scoring_system_id, l.faab_budget, l.scoring_rules_snapshot
    INTO v_status, v_current_scoring, v_current_faab_budget, v_snapshot
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_league_settings: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. §7.3 header status gate: structural settings are editable only in
  --    setup/scheduled; the post-draft path is an audited commissioner
  --    override (M6). The route maps this to a clear 409.
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'update_league_settings: league % is in % — settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 3.5 F28 shrink floor: team_count >= franchises already seated (retired
  --     franchises don't count — their slot was freed, §7.2.1(b)). The
  --     league-row lock above serializes this count with 062's join/claim
  --     capacity checks.
  SELECT count(*)::int INTO v_seated
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF p_team_count < v_seated THEN
    RAISE EXCEPTION 'update_league_settings: team_count % is below the % franchises already seated in this league — remove a team first (§7.2 capacity; F28)',
      p_team_count, v_seated
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Q10 backstops (R75/D69 — same order + shape as create_league).
  IF p_playoff_start_week < 13 OR p_playoff_start_week > 16 THEN
    RAISE EXCEPTION 'update_league_settings: playoff_start_week must be between 13 and 16 (currently week %) (§7.3.1, Q10/v2.8.6)',
      p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;
  IF p_playoff_start_week <> p_regular_season_weeks + 1 THEN
    RAISE EXCEPTION 'update_league_settings: playoff_start_week must be the week after the regular season ends — week % for a %-week regular season (currently week %) (§7.3.8, Q10/v2.8.6)',
      p_regular_season_weeks + 1, p_regular_season_weeks, p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. v1 templates-only (§7.3.3) — same in-body check as create_league.
  IF p_scoring_system_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.scoring_systems s
    WHERE s.id = p_scoring_system_id
      AND s.is_template = TRUE
      AND s.owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'update_league_settings: scoring_system_id must reference one of the v1 scoring templates — personal scoring systems cannot be attached to a league in v1 (§7.3.3)'
      USING ERRCODE = 'P0001';
  END IF;
  v_new_scoring := COALESCE(p_scoring_system_id, v_current_scoring);

  -- 6. §7.3.3 pre-draft re-freeze: a scoring change with an existing snapshot
  --    refreshes it from the NEW template's rules; a NULL snapshot stays NULL.
  IF v_new_scoring IS DISTINCT FROM v_current_scoring AND v_snapshot IS NOT NULL THEN
    SELECT s.rules INTO v_snapshot
    FROM public.scoring_systems s
    WHERE s.id = v_new_scoring;
  END IF;

  -- 7. The atomic write: every §12.1 typed column + blob as passed, and
  --    max_teams = p_team_count IN THE SAME STATEMENT (§12.1 NOTE — this is
  --    the sync rule's second writer, after create_league).
  UPDATE public.leagues
  SET format = p_format,
      team_count = p_team_count,
      max_teams = p_team_count,
      regular_season_weeks = p_regular_season_weeks,
      playoff_teams = p_playoff_teams,
      playoff_start_week = p_playoff_start_week,
      waiver_type = p_waiver_type,
      faab_budget = p_faab_budget,
      trade_review = p_trade_review,
      trade_deadline_week = p_trade_deadline_week,
      lineup_lock = p_lineup_lock,
      roster_settings = p_roster_settings,
      settings = p_settings,
      scoring_system_id = v_new_scoring,
      scoring_rules_snapshot = v_snapshot,
      updated_at = NOW()
  WHERE id = p_league_id;

  -- 8. §12.2 invariant maintenance: pre-draft (guaranteed by the status gate),
  --    faab_balance carries no history — re-seed every seat when the budget
  --    changes so all balances match the create/join/claim seeding (D70).
  IF p_faab_budget IS DISTINCT FROM v_current_faab_budget THEN
    UPDATE public.league_members
    SET faab_balance = p_faab_budget
    WHERE league_id = p_league_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_league_settings(
  UUID, INTEGER, JSONB, JSONB, UUID,
  TEXT, INTEGER, INTEGER, INTEGER, TEXT, INTEGER, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon;
