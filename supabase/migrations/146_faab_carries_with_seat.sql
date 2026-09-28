-- ============================================================================
-- 146_faab_carries_with_seat.sql — a team's FAAB balance stays with the team
-- once the draft has started (M5 task L.D2.6, FULL rigour — money; fixes
-- conflict C72). Spec §12.2 (the v2.8.7 note + its v2.16.55 clarification),
-- §7.2.1(a) takeover "inherits the franchise whole: … FAAB balance",
-- §7.2.1(b) / E49 retire-and-succeed "inherits … FAAB", §7.2.1(c) vacate,
-- §7.2.1 removal mechanics (leave = the vacate flow). Breakdown
-- tasks-M5-transactions.md §2.3 / §6 L.D2.6 / §10 C72; TD2 ("balance at
-- draft start − Σ won bids … = balance now"); PROGRESS D301, D384.
--
-- Numbering: heads measured at task time (D161) — `ls supabase/migrations |
-- tail -1` → 145_waiver_claims.sql, `ls supabase/tests | tail -1` →
-- 093_waiver_claims.sql ⇒ 146 / pgTAP 094.
--
-- THE DEFECT (C72). Four seat-fill paths re-seeded `faab_balance` to the
-- league's full budget with NO status gate: takeover (120:443-448), vacate
-- (120:645-649), `leave_league` (063:1061-1065) and the seat-claim / assign
-- helper `seat_league_member_internal` (077:425-431). Vacuous until a claim
-- spends FAAB (L.D2.9) — then an orphaned team that had spent $60 of $100
-- would be handed a fresh $100 by the next manager's arrival.
--
-- THE RULE BUILT. Before the draft starts (`setup` / `scheduled`) every path
-- re-seeds from the CURRENT budget exactly as before (§12.2 v2.8.7: balances
-- track the budget until the draft starts; a stored placeholder value is
-- never trusted). From `drafting` on — `drafting`, `in_season`, `playoffs`,
-- `complete` — the balance is the franchise's and every path CARRIES it
-- unchanged. `drafting` counts as started: spec:897's "until the draft
-- starts", TD2's "balance at draft start", and 129/144's budget-change arm
-- (`v_in_season := status NOT IN ('setup', 'scheduled')` — a budget change
-- during the draft already leaves balances alone, so a re-seed there could
-- disagree with the balance the draft started with). Retire-and-succeed
-- already carried it (120's in-place seat re-point, D301) and is untouched.
--
-- WHAT THIS MIGRATION DOES (three CREATE OR REPLACEs, no signature change,
-- no new object):
--   1. `remove_manager` (DEFINER) — takeover + vacate arms gated. Retire arm,
--      every refusal, the replay, the notifications: byte-identical to 120.
--   2. `leave_league` (DEFINER) — reads `l.status` under its existing league
--      lock; the leaver's open seat is gated.
--   3. `seat_league_member_internal` (PLAIN helper, SECURITY INVOKER — its
--      callers are the DEFINER doors `claim_league_invite` (062:767, its
--      chain head) and `assign_manager` (063:623, its chain head)) — reads
--      the league's status FOR UPDATE (both callers already hold that row;
--      the re-lock is a same-transaction no-op that keeps the helper
--      TOCTOU-safe alone); the placeholder FILL is gated; and a zero-row
--      fill after the draft has started is PROVEN before anything is
--      written: an occupied seat row falls through to the INSERT and trips
--      UNIQUE(league_id, team_id) exactly as before (the callers' E54
--      unique_violation handlers keep their copy), while NO seat row at all
--      — a state no writer produces (§12.2 "one row per seat"; D339) —
--      refuses BY NAME instead of minting a fresh budget. The new-franchise
--      branch (join / general claim) is untouched: both of its callers
--      refuse after `scheduled` (062:907, 062:998).
--
-- D137 — every replacement is derived from the NEWEST definition's FILE
-- TEXT (grep over every migration: `remove_manager` 063:745 → 120:222 (head);
-- `leave_league` 063:982 (only definition); `seat_league_member_internal`
-- 062:209 → 077:368 (head)). The derivation (derive_146.py, run at task
-- time) md5-asserted each source file — 120 `2bcc9f4fe22cd1bdc2368ef414feb450`,
-- 063 `cd4e9db222d122c920ebd2ee54685e9f`, 077
-- `9560e204f05d69922cc834b42076a555` — cut each function from its CREATE
-- line to its closing `$$;`, and applied exact-match hunks each asserted to
-- hit ONCE: remove_manager 2 (takeover, vacate), leave_league 2 (the status
-- read, the re-seed), seat_league_member_internal 3 (the declaration, the
-- status read, the fill + zero-row proof). Unguarded re-seeds left in the
-- three bodies: 0 / 0 / 0. Every other byte is the source's.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Replaces three functions in place (same signatures). No table, column,
--   constraint, index, policy or trigger changes. Grants (D18 → D23 → 133):
--   CREATE OR REPLACE keeps each function's ACL; the REVOKEs below restate
--   the house form — the two DEFINER doors REVOKEd from PUBLIC + anon
--   (authenticated keeps EXECUTE; the in-body commissioner / member checks
--   are the gate), the helper REVOKEd from PUBLIC, anon, authenticated.
--   SECURITY DEFINER + `search_path = ''` on both doors, `search_path = ''`
--   on the helper — all three kept as the sources had them (pgTAP 094 §A).
--   Lock order unchanged: leagues FIRST in every door (120:271, 063:1008,
--   062:801 / 063:654), then teams.
--   Typegen: no signature changes ⇒ `src/types/database.ts` unchanged
--   (regenerated and diffed empty).
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–146 and the full pgTAP run in the PR. D38 realtime —
--   nothing new is broadcast; the writes are the same rows the same
--   triggers already saw (no trigger on league_members). No backfill: no
--   balance has been spent yet (nothing debits FAAB before L.D2.9), so no
--   existing seat can hold a wrongly re-seeded balance.
--   NOT held: reaches production by `npx supabase db push` only.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. remove_manager — 120's text (the chain head, 120:222) + the takeover and
--    vacate gates (2 hunks). Same six-argument signature.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_manager(
  p_league_id UUID,
  p_member_id UUID,
  p_mode TEXT,
  p_successor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_action_id UUID DEFAULT NULL      -- 120: the retire arm's idempotency stamp (REQUIRED in-body for retire; ignored by takeover/vacate)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_target RECORD;
  v_actor_role TEXT;
  v_team RECORD;
  v_removed_user UUID;
  v_team_name TEXT;
  -- 120 (L.D1.10): the retire arm.
  v_reason TEXT;
  v_replay RECORD;
  v_cycle RECORD;
  v_week INTEGER;
  v_franchises INTEGER;
  v_successor_id UUID;
  v_successor_name TEXT;
  v_n INTEGER;
  v_n_rosters INTEGER := 0;
  v_n_lineups INTEGER := 0;
  v_n_matchups INTEGER := 0;
  v_n_results INTEGER := 0;
  v_message TEXT;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'remove_manager: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'remove_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.id, l.name, l.owner_id, l.faab_budget, l.status, l.season INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- RE-GATE UNDER THE LOCK (R93) — see add_placeholder_seat. Also the ACTOR's
  -- exact role, which the creator anti-coup guard below keys on: a stale
  -- actor reading 'manager' would sail past a guard written for
  -- 'co_commissioner'.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('commissioner', 'co_commissioner') THEN
    RAISE EXCEPTION 'remove_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('takeover', 'retire', 'vacate') THEN
    RAISE EXCEPTION 'remove_manager: mode must be takeover, retire, or vacate (§7.2.1)'
      USING ERRCODE = '22023';
  END IF;

  SELECT lm.id, lm.user_id, lm.team_id, lm.role INTO v_target
  FROM public.league_members lm
  WHERE lm.id = p_member_id AND lm.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: no such member in this league'
      USING ERRCODE = '42501';
  END IF;

  -- 120 (L.D1.10): retire-and-succeed is REAL now (§7.2.1(b) / D301 / F31).
  IF p_mode = 'retire' THEN
    -- (a) The status gate. Before the draft D42's refusal stands byte for
    --     byte (017 J pins it; a franchise has no roster or record to
    --     inherit). `in_season` (the LAW's "mid-season … audited override")
    --     and `complete` ("primarily an offseason action") proceed.
    --     `playoffs` REFUSES BY NAME: §7.2.1(b) / §11.5 print nothing about
    --     a retired franchise's bracket line (does the successor play it,
    --     or is it forfeited?) and 118's sync derives later rounds from the
    --     played rows' team ids — PROGRESS Q41 carries the question; this
    --     arm is a refusal, never a fold (R801).
    IF v_league.status IN ('setup', 'scheduled', 'drafting') THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise isn''t available before the draft — use takeover or vacate (§7.2.1; retire-and-succeed arrives with the in-season milestone)'
        USING ERRCODE = 'P0001';
    ELSIF v_league.status = 'playoffs' THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise during the playoffs is not defined yet — what the bracket does with a retired franchise''s line is PROGRESS Q41; use takeover or vacate now, or retire the franchise after the season (§7.2.1(b))'
        USING ERRCODE = 'P0001';
    ELSIF v_league.status NOT IN ('in_season', 'complete') THEN
      RAISE EXCEPTION 'remove_manager: league status % admits no retirement (§7.1)', v_league.status
        USING ERRCODE = 'P0001';
    END IF;
    -- (a′) R858: the actor's OWN seat. §7.2.1 gives the leaver no choice of
    --      outcome — leave_league is the voluntary path — and the route's
    --      self-DELETE dispatches there; a co-commissioner calling the RPC
    --      directly must not get the choice back. (A plain manager never
    --      reaches here: not a commissioner, 42501 above.)
    IF v_target.user_id = v_uid THEN
      RAISE EXCEPTION 'remove_manager: you cannot retire your own franchise — a leaver has no choice of outcome (§7.2.1); leave the league, or have the commissioner act on your seat'
        USING ERRCODE = '42501';
    END IF;
    -- (b) The audit stamp and the reason (E49 "audited override"; D290's
    --     interim posture: reason REQUIRED, stored on the ledger row).
    IF p_action_id IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retire requires action_id (idempotency key — one UUID per retirement, reused on retry; 113''s contract)'
        USING ERRCODE = '22023';
    END IF;
    v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise is an audited override — a reason is required (E49 / D290)'
        USING ERRCODE = '22023';
    END IF;
    -- (c) REPLAY by (league_id, action_id) — 113's contract (R732): the
    --     stored payload byte-identical; the same stamp on another verb or
    --     another member is a shape violation. Checked BEFORE the seat
    --     checks below: after a committed retirement the seat is an open
    --     placeholder and would otherwise refuse the retry by name.
    SELECT t.type, t.payload INTO v_replay
    FROM public.transactions t
    WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
    IF FOUND THEN
      IF v_replay.type <> 'commissioner_move'
         OR v_replay.payload ->> 'verb' IS DISTINCT FROM 'retire_franchise'
         OR (v_replay.payload ->> 'member_id')::uuid IS DISTINCT FROM p_member_id THEN
        RAISE EXCEPTION 'remove_manager: action_id % already names another action in this league — an action_id identifies ONE submit of ONE verb (R732)', p_action_id
          USING ERRCODE = '22023';
      END IF;
      RETURN v_replay.payload;
    END IF;
  END IF;

  -- §7.2 anti-coup (keyed on the CREATOR, not on role).
  IF v_actor_role = 'co_commissioner'
     AND v_target.user_id IS NOT NULL
     AND v_target.user_id = v_league.owner_id THEN
    RAISE EXCEPTION 'remove_manager: only the commissioner can remove the league creator (§7.2)'
      USING ERRCODE = '42501';
  END IF;

  -- Never leave the league headless (§7.2 "Exactly one commissioner").
  IF v_target.role = 'commissioner' THEN
    RAISE EXCEPTION 'remove_manager: transfer the commissioner role to another member before removing this manager (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 120 (R855): an UNMANAGED seat refuses takeover here as 063 wrote it and
  -- vacate stays idempotent; RETIRE passes through — §7.2.1(c) is LAW
  -- ("Orphaned is a holding state that resolves into (a) or (b)") and the
  -- retire arm's (d′) decides, by the franchise's stint history, whether
  -- there is a manager to seal it under.
  IF v_target.user_id IS NULL AND p_mode <> 'retire' THEN
    IF p_mode = 'vacate' THEN
      -- Idempotent (D63): the seat is already an open placeholder.
      RETURN jsonb_build_object(
        'ok', true, 'mode', p_mode, 'member_id', v_target.id,
        'team_id', v_target.team_id, 'already_vacant', true);
    END IF;
    RAISE EXCEPTION 'remove_manager: that seat has no manager — use assign-manager to seat someone on it'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_target.team_id IS NULL THEN
    RAISE EXCEPTION 'remove_manager: that membership has no franchise to act on'
      USING ERRCODE = 'P0001';
  END IF;

  -- teams AFTER leagues (lock order).
  SELECT t.id, t.name, t.status, t.successor_team_id INTO v_team
  FROM public.teams t
  WHERE t.id = v_target.team_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: that membership has no franchise to act on'
      USING ERRCODE = 'P0001';
  END IF;

  v_removed_user := v_target.user_id;
  v_team_name := v_team.name;

  IF p_mode = 'takeover' THEN
    IF p_successor_user_id IS NULL THEN
      RAISE EXCEPTION 'remove_manager: takeover requires successor_user_id (§15.1)'
        USING ERRCODE = '22023';
    END IF;
    IF p_successor_user_id = v_removed_user THEN
      RAISE EXCEPTION 'remove_manager: the successor must be a different manager — use vacate to open the seat'
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM public.profiles p WHERE p.id = p_successor_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'remove_manager: no such FieldScout account for the successor'
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM public.league_members lm
    WHERE lm.league_id = p_league_id AND lm.user_id = p_successor_user_id;
    IF FOUND THEN
      RAISE EXCEPTION 'remove_manager: the successor already has a team in this league'
        USING ERRCODE = 'P0001';
    END IF;

    -- CLOSE BEFORE OPEN, same txn (F3). A missing open stint is a no-op,
    -- not an error (D63 — a retry after a partially-observed removal).
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = NULL,            -- preseason (§12.22)
        end_reason = 'replaced',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- The cache row is UPDATEd IN PLACE — one league_members row per seat,
    -- always (§12.2). 146 (L.D2.6 / C72): faab re-seeded from the CURRENT
    -- budget only BEFORE the draft starts (v2.8.7 — balances track the
    -- budget until then); from `drafting` on the balance belongs to the
    -- franchise and the successor inherits it (§7.2.1(a) "inherits the
    -- franchise whole: … FAAB balance").
    UPDATE public.league_members
    SET user_id = p_successor_user_id,
        is_placeholder = FALSE,
        role = 'manager',             -- powers never inherit with a seat
        faab_balance = CASE WHEN v_league.status IN ('setup', 'scheduled')
                            THEN v_league.faab_budget ELSE faab_balance END
    WHERE id = v_target.id;

    -- Successor's stint (clock_timestamp — F3: never reuses a started_at).
    INSERT INTO public.team_managers (league_id, team_id, user_id, role, started_at)
    VALUES (p_league_id, v_team.id, p_successor_user_id, 'manager', clock_timestamp());

    UPDATE public.teams
    SET owner_id = p_successor_user_id,
        status = CASE WHEN status = 'orphaned' THEN 'active' ELSE status END,
        updated_at = now()
    WHERE id = v_team.id;
  ELSIF p_mode = 'retire' THEN
    -- (d) F1: the lineage this franchise sits in must be ACYCLIC before it
    --     is extended. The successor minted below is a NEW row (it cannot
    --     close a cycle by construction — said, D267), so the walk is over
    --     the PREDECESSOR chain as STORED: only privileged writes can
    --     corrupt it (D53: the column has no client writer), and a corrupt
    --     chain is refused BY NAME rather than misreported as "already
    --     sealed" (068 F; the DoD probe drops this block).
    WITH RECURSIVE lineage AS (
      SELECT t.id, 0 AS depth FROM public.teams t WHERE t.id = v_team.id
      UNION ALL
      SELECT p.id, l.depth + 1
      FROM lineage l JOIN public.teams p ON p.successor_team_id = l.id
      WHERE l.depth < 64
    ) CYCLE id SET is_cycle USING path
    SELECT l.is_cycle, array_length(l.path, 1) - 1 AS len INTO v_cycle
    FROM lineage l WHERE l.is_cycle
    ORDER BY array_length(l.path, 1) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'remove_manager: % sits in a succession CYCLE of length % (the successor_team_id chain revisits a franchise) — refused; repair the lineage before extending it (§12.22 / F1)', v_team_name, v_cycle.len
        USING ERRCODE = 'P0001';
    END IF;
    IF v_team.status = 'retired' OR v_team.successor_team_id IS NOT NULL THEN
      RAISE EXCEPTION 'remove_manager: % is already sealed (status %, successor %) — a retired franchise cannot be retired again (§7.2.1(b))', v_team_name, v_team.status, v_team.successor_team_id
        USING ERRCODE = 'P0001';
    END IF;
    -- (d′) R855: an UNMANAGED seat (vacated / left — 'orphaned', §7.2.1(c))
    --      is admitted when the franchise has a CLOSED stint: the seal
    --      names the LAST manager (History Mode reads the stints; nothing
    --      else is written under a name), no stint is open to close (the
    --      (h) UPDATE matches nothing — D63), no one is notified,
    --      removed_user_id is NULL in the payload. A franchise that has
    --      NEVER had a manager — 120's own successor until it is claimed,
    --      or a placeholder seat autopick-drafted and never claimed — has
    --      no name to seal under and refuses BY NAME.
    IF v_removed_user IS NULL THEN
      PERFORM 1 FROM public.team_managers tm
      WHERE tm.team_id = v_team.id AND tm.ended_at IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'remove_manager: % has never had a manager — there is no one to seal it under; use assign-manager to seat someone on it first (§7.2.1(b))', v_team_name
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (e) The founding week of the successor's book — the first week the
    --     league has NOT yet played: 1 + its last correction_window/final
    --     week (a reopened earlier week stays the predecessor's), else the
    --     first league week. NULL when that week does not exist (the
    --     season is over — `complete`, or every week played): nothing is
    --     re-pointed and History reads the whole book as the retired
    --     franchise's; retired_at_week / ended_week are NULL (§12.22's
    --     "NULL preseason" reading, extended to "outside the season").
    SELECT w.week INTO v_week
    FROM public.league_weeks w
    WHERE w.league_id = p_league_id AND w.season = v_league.season
      AND w.week = COALESCE(
        (SELECT max(x.week) + 1 FROM public.league_weeks x
         WHERE x.league_id = p_league_id AND x.season = v_league.season
           AND x.status IN ('correction_window', 'final')),
        (SELECT min(x.week) FROM public.league_weeks x
         WHERE x.league_id = p_league_id AND x.season = v_league.season));

    -- (f) The successor: a NEW franchise in the same slot (§7.2.1(b)),
    --     named by D74(5)'s series over the league's WHOLE franchise count
    --     (retired included — a retired franchise keeps its number, so the
    --     name cannot collide with a seat's default), owned by the acting
    --     commissioner like every placeholder (add_placeholder_seat),
    --     'orphaned': no manager until a takeover (§7.2.1(c)'s holding
    --     state; assign_manager / a seat claim return it to 'active' —
    --     D74(2)). It counts as seated in every capacity count.
    SELECT count(*)::int INTO v_franchises FROM public.teams t WHERE t.league_id = p_league_id;
    v_successor_name := 'Team ' || (v_franchises + 1)::text;
    INSERT INTO public.teams (owner_id, name, league_id, list_id, status)
    VALUES (v_uid, v_successor_name, p_league_id, NULL, 'orphaned')
    RETURNING id INTO v_successor_id;

    -- (g) SEAL the franchise: status, the partition week, the link. owner_id
    --     moves to the acting commissioner for the vacate arm's reason (the
    --     removed user's profile deletion would CASCADE the sealed franchise
    --     away — 001:495); name and record are frozen by the absence of any
    --     writer (§7.2.1(b)).
    UPDATE public.teams
    SET status = 'retired',
        retired_at_week = v_week,
        successor_team_id = v_successor_id,
        owner_id = v_uid,
        updated_at = now()
    WHERE id = v_team.id;

    -- (h) The stint closes `seat_retired` — the one §12.22 value M1 never
    --     wrote (D74(9)); the F3 close shape; a missing open stint is a
    --     no-op (D63). No stint opens: the successor has no manager yet.
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = v_week,
        end_reason = 'seat_retired',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- (i) The seat: ONE league_members row per seat, always (§12.2) — the
    --     cache row is re-pointed at the successor as an OPEN placeholder
    --     (assign_manager / a seat-targeted invite fill it). faab_balance is
    --     deliberately NOT re-seeded: (b)'s "inherits FAAB" is the seat's
    --     balance carrying, which the in-place UPDATE does for free (D301:
    --     vacuous until M5 makes the balance live; the transfer line M5 need
    --     not write is this one).
    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,
        role = 'manager',
        team_id = v_successor_id
    WHERE id = v_target.id;

    -- (j) THE INHERITANCE, every re-point COUNTED (rule 10). The roster
    --     whole (072's per-row trigger broadcasts each row on league:<id>);
    --     the CURRENT and future weeks' lineups, matchups and results — the
    --     successor's book opens at v_week; past weeks stay the
    --     predecessor's (History partitions at retired_at_week — E49).
    --     league_player_pool carries no team reference (109); transactions,
    --     lineup_actions and the draft rows are history under the
    --     predecessor. A game-day lock is per PLAYER, evaluated from
    --     nfl_games at call time (115/Q34(B)) — a re-point unlocks no one.
    UPDATE public.league_rosters SET team_id = v_successor_id
    WHERE league_id = p_league_id AND team_id = v_team.id;
    GET DIAGNOSTICS v_n_rosters = ROW_COUNT;
    IF v_week IS NOT NULL THEN
      UPDATE public.team_lineups SET team_id = v_successor_id
      WHERE team_id = v_team.id AND season = v_league.season AND week >= v_week;
      GET DIAGNOSTICS v_n_lineups = ROW_COUNT;
      UPDATE public.matchups SET home_team_id = v_successor_id, updated_at = now()
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND home_team_id = v_team.id;
      GET DIAGNOSTICS v_n_matchups = ROW_COUNT;
      UPDATE public.matchups SET away_team_id = v_successor_id, updated_at = now()
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND away_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_matchups := v_n_matchups + v_n;
      UPDATE public.team_week_results SET team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND team_id = v_team.id;
      GET DIAGNOSTICS v_n_results = ROW_COUNT;
      UPDATE public.team_week_results SET opponent_team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND opponent_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_results := v_n_results + v_n;
      UPDATE public.team_week_results SET second_opponent_team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND second_opponent_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_results := v_n_results + v_n;
    END IF;

    -- (k) The payload — also the LEDGER row's, so a replay is byte-identical.
    v_result := jsonb_build_object(
      'ok', true, 'mode', p_mode, 'verb', 'retire_franchise', 'action_id', p_action_id,
      'member_id', v_target.id, 'team_id', v_team.id,
      'removed_user_id', v_removed_user, 'successor_user_id', NULL, 'already_vacant', false,
      'retired_team_id', v_team.id, 'retired_team_name', v_team_name,
      'successor_team_id', v_successor_id, 'successor_team_name', v_successor_name,
      'season', v_league.season, 'retired_at_week', v_week, 'reason', v_reason,
      'repointed', jsonb_build_object(
        'rosters', v_n_rosters, 'lineups', v_n_lineups, 'matchups', v_n_matchups, 'results', v_n_results),
      'inherits', jsonb_build_object(
        'roster', true, 'record', 'seeding_only', 'h2h_history', false, 'faab', 'seat_balance_kept'));
    -- (l) The ledger (D290 interim; 113's shape): ONE transactions row of
    --     type commissioner_move, commissioner-initiated (no initiator team),
    --     stamped with p_action_id; 119's trigger carries it to the feed.
    INSERT INTO public.transactions
      (league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
    VALUES (p_league_id, 'commissioner_move', 'complete', NULL, v_uid, v_result, v_week, p_action_id);
    -- (m) The D97 in-transaction system post (111/113's shape).
    v_message := v_team_name || ' was retired by ' || public.draft_actor_name()
      || CASE WHEN v_removed_user IS NULL
           THEN ' — the vacant franchise is sealed under its last manager (§7.2.1(c)); '
           ELSE ' — the franchise is sealed under its final manager; ' END
      || v_successor_name
      || ' takes its slot' || CASE WHEN v_week IS NULL THEN ' after the season' ELSE ' from Week ' || v_week::text END
      || ' (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: ' || v_reason;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, v_uid, v_message, 'league', TRUE);
  ELSE
    -- vacate (§7.2.1(c)) — the stint closes with no successor.
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = NULL,
        end_reason = 'kicked',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- 146 (L.D2.6 / C72): the open seat keeps the franchise's balance once
    -- the draft has started (the next manager inherits it through the seat
    -- fill); before the draft it re-seeds from the CURRENT budget (v2.8.7).
    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,        -- back to an open seat, team_id KEPT
        role = 'manager',
        faab_balance = CASE WHEN v_league.status IN ('setup', 'scheduled')
                            THEN v_league.faab_budget ELSE faab_balance END
    WHERE id = v_target.id;

    -- 'orphaned', never 'retired': every capacity count is
    -- `status <> 'retired'`, so retiring would silently free a seat.
    -- owner_id moves to the acting commissioner (NOT NULL; leaving it on the
    -- removed user would let their profile deletion CASCADE the franchise).
    UPDATE public.teams
    SET status = 'orphaned',
        owner_id = v_uid,
        updated_at = now()
    WHERE id = v_team.id;
  END IF;

  -- BOTH arms (R90): the removed user may own OTHER franchises in this league
  -- — every placeholder seat they minted while holding a commissioner role
  -- carries `owner_id = <them>` (add_placeholder_seat, item 3), as does every
  -- franchise they orphaned by vacating someone. Moving only THEIR OWN seat
  -- above would leave those owned by a proven non-member on
  -- `teams.owner_id REFERENCES profiles(id) ON DELETE CASCADE` (001:495):
  -- deleting that account would destroy the franchises outright AND — because
  -- `league_members.team_id` is ON DELETE SET NULL (052:67) — leave their
  -- cache rows with `team_id` NULL, a seat with no franchise, invisible to
  -- EVERY capacity count in the build. That is the exact shape the S2 policy
  -- removal / erratum v2.8.8 / D74(3) exists to make unrepresentable. The
  -- acting commissioner is the same recipient the vacate arm already uses.
  UPDATE public.teams
  SET owner_id = v_uid,
      updated_at = now()
  WHERE league_id = p_league_id
    AND owner_id = v_removed_user
    AND id <> v_team.id;

  -- §7.2.1:190 — the removed user is notified with the outcome category.
  -- 120 (R855): an unmanaged seat's retirement has no one to notify (its
  -- last manager was notified when the seat closed — vacate / leave);
  -- takeover and vacate always carry a user here (refused above otherwise).
  IF v_removed_user IS NOT NULL THEN
  PERFORM public.notify_league_member_internal(
    v_removed_user,
    'league_member',
    'You were removed from ' || v_league.name,
    CASE WHEN p_mode = 'takeover'
      THEN v_team_name || ' has a new manager. Your record with the franchise stays in its history.'
      WHEN p_mode = 'retire'
      THEN v_team_name || ' was retired by the commissioner. The franchise is sealed under your name — its record and history stay yours.'
      ELSE 'Your seat in ' || v_league.name || ' (' || v_team_name || ') was closed by the commissioner.'
    END,
    jsonb_build_object(
      'league_id', p_league_id,
      'team_id', v_team.id,
      'event', CASE WHEN p_mode = 'takeover' THEN 'replaced' WHEN p_mode = 'retire' THEN 'retired' ELSE 'removed' END));
  END IF;

  IF p_mode = 'retire' THEN
    RETURN v_result;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'mode', p_mode, 'member_id', v_target.id,
    'team_id', v_team.id, 'removed_user_id', v_removed_user,
    'successor_user_id', CASE WHEN p_mode = 'takeover' THEN p_successor_user_id ELSE NULL END,
    'already_vacant', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_manager(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 2. leave_league — 063's text (its only definition, 063:982) + the status
--    read and the seat gate (2 hunks).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION leave_league(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_self RECORD;
  v_team RECORD;
  v_others INTEGER;
  v_commish UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'leave_league: must be signed in'
      USING ERRCODE = '42501';
  END IF;

  -- League row FIRST: reading the caller's role under the lock means a
  -- concurrent transfer cannot make them commissioner between check and
  -- write.
  SELECT l.id, l.name, l.faab_budget, l.status INTO v_league   -- 146: + status (the C72 gate)
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT lm.id, lm.user_id, lm.team_id, lm.role INTO v_self
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: not a member of this league'
      USING ERRCODE = '42501';
  END IF;

  IF v_self.role = 'commissioner' THEN
    SELECT count(*)::int INTO v_others
    FROM public.league_members lm
    WHERE lm.league_id = p_league_id AND lm.user_id IS NOT NULL AND lm.user_id <> v_uid;
    IF v_others = 0 THEN
      -- The sole member of a league IS its commissioner, with nobody to
      -- transfer to — point at deletion rather than stranding them.
      RAISE EXCEPTION 'leave_league: you are this league''s only manager — delete the league instead of leaving it (§15.1)'
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'leave_league: transfer the commissioner role to another member before leaving (§7.2.1)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_self.team_id IS NULL THEN
    RAISE EXCEPTION 'leave_league: your membership has no franchise to hand back'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.name INTO v_team
  FROM public.teams t
  WHERE t.id = v_self.team_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: your membership has no franchise to hand back'
      USING ERRCODE = 'P0001';
  END IF;

  -- Same flow as vacate (§7.2.1:192), with end_reason='left' and ended_by
  -- = self. The leaver does not choose the franchise's outcome — the spec
  -- names no chooser for the voluntary path.
  UPDATE public.team_managers
  SET ended_at = now(),
      ended_week = NULL,
      end_reason = 'left',
      ended_by = v_uid
  WHERE team_id = v_team.id AND ended_at IS NULL;

  -- 146 (L.D2.6 / C72): the open seat keeps the franchise's balance once
  -- the draft has started; before the draft it re-seeds from the CURRENT
  -- budget (v2.8.7).
  UPDATE public.league_members
  SET user_id = NULL,
      is_placeholder = TRUE,
      role = 'manager',
      faab_balance = CASE WHEN v_league.status IN ('setup', 'scheduled')
                          THEN v_league.faab_budget ELSE faab_balance END
  WHERE id = v_self.id;

  -- The franchise passes to the sitting commissioner (owner_id is NOT NULL).
  SELECT lm.user_id INTO v_commish
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.role = 'commissioner' AND lm.user_id IS NOT NULL;

  UPDATE public.teams
  SET status = 'orphaned',
      owner_id = COALESCE(v_commish, owner_id),
      updated_at = now()
  WHERE id = v_team.id;

  -- Same league-wide sweep as remove_manager (R90): a leaver who holds — or
  -- once held — a commissioner OR co-commissioner role can still own the
  -- placeholder seats they minted (add_placeholder_seat, item 3, is open to
  -- both roles) or the franchises they orphaned by vacating someone. The
  -- precondition is "ever held commissioner powers", NOT "was the sitting
  -- commissioner and transferred it away" (R100/R90 correction): a
  -- co-commissioner needs no transfer to leave, yet can own such franchises.
  -- Left behind, those sit on an ON DELETE CASCADE owner FK held by a proven
  -- non-member.
  IF v_commish IS NOT NULL THEN
    UPDATE public.teams
    SET owner_id = v_commish,
        updated_at = now()
    WHERE league_id = p_league_id
      AND owner_id = v_uid
      AND id <> v_team.id;
  END IF;

  -- Q11 (RULED 2026-07-26, Chris): notify BOTH the departing user AND the
  -- sitting commissioner. §7.2.1:190 lists `left` among the categories the
  -- departed user is notified with; the commissioner-too notification is the
  -- ruling's explicit addition (spec erratum v2.8.9). F37 discharged.
  PERFORM public.notify_league_member_internal(
    v_uid,
    'league_member',
    'You left ' || v_league.name,
    'You left ' || v_league.name || ' (' || v_team.name || '). You can be re-invited to any team later.',
    jsonb_build_object(
      'league_id', p_league_id, 'team_id', v_team.id, 'event', 'left'));

  -- The commissioner is the party who needs to act on an open seat.
  PERFORM public.notify_league_member_internal(
    v_commish,
    'league_member',
    'A manager left ' || v_league.name,
    v_team.name || ' is open — invite a replacement or assign a manager.',
    jsonb_build_object(
      'league_id', p_league_id, 'team_id', v_team.id, 'event', 'left'));

  RETURN jsonb_build_object(
    'ok', true, 'league_id', p_league_id, 'team_id', v_team.id,
    'member_id', v_self.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_league(UUID) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 3. seat_league_member_internal — 077's text (the chain head, 077:368) + the
--    status read, the fill gate and the zero-row proof (3 hunks). PLAIN,
--    SECURITY INVOKER, as 062/077 had it.
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
  v_status TEXT;        -- 146 (L.D2.6 / C72): the league's status, read under the caller's lock
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
