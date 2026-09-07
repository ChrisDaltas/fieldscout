-- ============================================================================
-- 120_retire_succeed.sql — retire-and-succeed (F31 + F1): the real
-- `remove_manager(retire)` outcome + the lineage fold in standings
-- (task L.D1.10; spec v2.16.28 §7.2.1(b) / §12.22 / §11.5 / §12.2 / §12.9 /
-- §15.1 / E49; PROGRESS D42 / D53 / D74 / D137 / D290 / D301 / D314(6) / D320;
-- F1 / F31 / F42 / F256(e) / F262; tasks-M4 §4 rules 1–11 + §6 L.D1.10).
--
-- Numbering: migration head measured 119 at task time (ls supabase/migrations/
-- | tail -1) ⇒ 120; pgTAP head 067 ⇒ 068 (D161/D166). The schema lane of M4
-- COMPLETES with this migration — nothing else in tasks-M4 §7 depends on it.
--
-- WHAT THIS DOES
--   0. #266 FIX ROUND (PROGRESS R855–R862, 2026-09-07 — 120 edited IN PLACE,
--      unmerged and HELD; its md5 moved, said): (R855) an UNMANAGED seat
--      whose franchise has a CLOSED stint (vacated / left — 'orphaned',
--      §7.2.1(c) "resolves into (a) or (b)") is retirable — see 1(d′);
--      (R858) a co-commissioner cannot retire HIS OWN seat — 1(a′); (R856)
--      the `teams` broadcast trigger ships — §4 below; (R860) the retire
--      control is `src/components/leagues/invite-panel.tsx:731-737`, not a
--      `remove-manager-modal` (no such file).
--   1. `remove_manager` is DROPPED at its 063 five-argument signature and
--      RE-CREATED with a sixth, `p_action_id UUID DEFAULT NULL` (the D137
--      vehicle for a signature change is DROP + CREATE — 110's
--      `draft_complete_internal` precedent; every 3/4/5-argument call, the
--      route's included, still resolves through the defaults). Every byte
--      of the takeover and vacate arms is 063's (derive_120.py: the 063
--      file md5-asserted `cd4e9db222d122c920ebd2ee54685e9f`, nine exact-
--      match hunks, each asserted to hit once). The retire arm — D42's
--      "not before the draft" refusal until now — becomes §7.2.1(b):
--        (a) the STATUS GATE: setup/scheduled/drafting keep D42's refusal
--            byte for byte (017 J pins it); `in_season` (the LAW's
--            "mid-season … audited override") and `complete` ("primarily
--            an offseason action") proceed; `playoffs` REFUSES BY NAME —
--            §7.2.1(b)/§11.5 print nothing about a retired franchise's
--            bracket line and 118's sync derives later rounds from the
--            played rows' team ids, so the arm is a question (PROGRESS Q41),
--            never a fold (R801; F256(e) routed there);
--        (a′) R858: the ACTOR's own seat refuses 42501 by name — §7.2.1
--            gives the leaver no choice of outcome (`leave_league` is the
--            voluntary path); a plain manager was already refused as no
--            commissioner, this closes the co-commissioner's direct-RPC
--            route around the route's self-DELETE dispatch;
--        (b) `p_action_id` REQUIRED (22023) + a non-blank `p_reason`
--            (22023 — E49 "audited override", D290's interim posture);
--        (c) REPLAY by (league_id, action_id): the stored `transactions`
--            payload byte-identical (113's contract, R732), checked before
--            the seat checks because a committed retirement leaves the seat
--            an open placeholder;
--        (d) F1: the predecessor chain is walked BACKWARD over
--            `successor_team_id` (WITH RECURSIVE … CYCLE, depth ≤ 64) and a
--            cycle of ANY length is refused BY NAME with its length — the
--            successor minted here is a NEW row and cannot close a cycle
--            (D267: said, and the fixtures are privileged corruption); then
--            "already sealed" (retired / successor set) refuses;
--        (d′) R855: an UNMANAGED seat (`league_members.user_id` NULL) is
--            admitted when its franchise has a CLOSED stint — vacate and
--            leave_league both close one and set 'orphaned' (063), and
--            §7.2.1(c) says orphaned "resolves into (a) or (b)". The seal
--            names the LAST CLOSED stint's manager (History Mode reads the
--            stints — nothing else is written under a name); no stint is
--            open to close; no one is notified; `removed_user_id` is NULL
--            in the payload; the successor, the ledger row and the post
--            are written as for a managed seat. A franchise that has NEVER
--            had a manager — 120's own successor until it is claimed, or a
--            placeholder seat autopick-drafted and never claimed (draft_start
--            admits placeholders, 084) — has no name to seal under and
--            refuses BY NAME (assign-manager first); before the draft the
--            status gate's D42 refusal runs first, unchanged;
--        (e) the FOUNDING WEEK of the successor's book = 1 + the league's
--            last correction_window/final week (a reopened earlier week
--            stays the predecessor's), else the first league week; NULL
--            when no such week exists (the season is over) — nothing is
--            re-pointed then and History reads the whole book as the
--            retired franchise's;
--        (f) the SUCCESSOR: a new `teams` row in the same league slot,
--            'orphaned' (no manager until a takeover — §7.2.1(c)'s holding
--            state; assign_manager / a claim return it to 'active', D74(2)),
--            owned by the acting commissioner like every placeholder, named
--            by D74(5)'s "Team N" over the league's WHOLE franchise series
--            (retired included — a retired franchise keeps its number);
--        (g) the SEAL: `status='retired'`, `retired_at_week` = the founding
--            week, `successor_team_id` = the successor, `owner_id` = the
--            commissioner (the vacate arm's CASCADE reason);
--        (h) the STINT closes `end_reason='seat_retired'`, `ended_week` =
--            the founding week (the one §12.22 value M1 never wrote —
--            D74(9)); no stint opens;
--        (i) the SEAT (`league_members`, ONE row per seat — §12.2) is
--            re-pointed at the successor as an open placeholder; its
--            `faab_balance` is LEFT AS IS — that IS (b)'s FAAB inheritance
--            (D301: vacuous until M5 makes the balance live);
--        (j) the INHERITANCE, every re-point COUNTED (rule 10):
--            `league_rosters` whole (072's per-row trigger broadcasts each
--            row on `league:<id>`); `team_lineups` / `matchups` (both
--            sides) / `team_week_results` (team + both opponent columns)
--            for weeks ≥ the founding week ONLY — past weeks stay the
--            predecessor's (E49: History partitions at `retired_at_week`;
--            probe 2). `league_player_pool` carries no team reference;
--            `transactions`, `lineup_actions`, draft rows are history. A
--            game-day lock is per PLAYER from `nfl_games` at call time
--            (115 / Q34(B)) — the re-point unlocks no one (068 E; probe 4);
--        (k) the LEDGER (D290 interim, 113's shape): ONE `transactions` row
--            of type `commissioner_move` (§12.9's own value), commissioner-
--            initiated, `payload` = the return value, `action_id` = the
--            stamp — 119's trigger carries it to the activity feed;
--        (l) the D97 in-transaction `league_chat` system post; the removed
--            user's notification names the "franchise retired" category
--            (§7.2.1:190) — not sent for an unmanaged seat (d′).
--   2. `league_standings_internal(uuid, boolean)` CREATE OR REPLACE'd against
--      118's CURRENT FILE TEXT (md5 `811535c21fda6f66f3ac9a311ad6ec3b`;
--      three hunks): a `lineage` CTE (every seated franchise + the retired
--      predecessors whose successor chain leads to it) and the `agg` join
--      folding a successor's predecessors' rows into its line — W/L/T, PF,
--      PA, weeks — FOR SEEDING (§7.2.1(b) "the successor inherits the W-L
--      record for seeding math only"). The `h2h` CTE is UNTOUCHED: keyed on
--      the live ids, so the successor's head-to-head history does NOT
--      inherit (both sides pinned — 068 D; probe 3). The projected arm
--      inherits identically (one implementation). The two DEFINER wrappers
--      `league_standings(uuid)` / `league_standings_projected(uuid)` are NOT
--      touched — 068 A pins their 118 bodies by md5; 065 (= 108) and 066's
--      standings cells run unchanged. A league with no retired franchise
--      reads exactly 118's rows (the lineage of every seated team is itself).
--   3. `week_results_pending_internal(uuid, integer, integer)` CREATE OR
--      REPLACE'd against 117's CURRENT FILE TEXT (md5
--      `6198b88139d063e922997c8c8272a740`; one hunk): the total_points arm's
--      "ANY seated team without a row" reads through the lineage — a week
--      the predecessor played is covered by the predecessor's own row.
--      Without it a total_points league would hold its correction_window
--      week (the retirement's) forever: the successor is seated and has no
--      row for a week it never played (068 G; probe 5). The h2h arm is
--      byte-identical.
--   4. THE `teams` BROADCAST TRIGGER (R856 — F42 discharged for `teams`):
--      `tr_broadcast_teams`, AFTER UPDATE — per STATEMENT with BOTH
--      transition tables (OLD + NEW, joined by id): a row is broadcast only
--      when one of the four rendered columns CHANGED (`name`, `status`,
--      `retired_at_week`, `successor_team_id` — IS DISTINCT FROM), so ONE
--      event per league per statement that changed something, nothing for
--      an empty or no-change statement, a non-league row skipped. (PG 17
--      refuses `UPDATE OF <cols>` together with a transition table —
--      measured, the 119 species — and the diff-aware read is the better
--      shape anyway: it CLOSES F260(b)'s "column listed but unchanged"
--      case rather than saying it.) Payload column-selected `{count,
--      teams: [{id, name, status, retired_at_week, successor_team_id}]}` —
--      no owner_id, no manager identity. Why now: F42's rule is "a trigger ships with its
--      first subscriber", and this migration is the first in-season WRITER
--      whose effect a live surface must see — an h2h retirement emits
--      nothing the standings query invalidates on (`league_rosters` /
--      `matchups` / `transactions` are not in STANDINGS_INVALIDATING_EVENTS,
--      R773), so a member's standings page kept the retired row and the
--      pre-flip order until reload, and the league detail (its teams list)
--      had no channel invalidation at all. NOT on INSERT: the successor's
--      INSERT is always followed in the same transaction by the seal UPDATE
--      (the one writer of successor_team_id), and a pre-draft placeholder
--      INSERT has no live subscriber (league_members' F42 posture). An
--      owner_id / updated_at-only write — the R90 owner sweep, any touch —
--      changes none of the four and emits nothing. So a retirement is
--      exactly ONE `teams` event (068 C14 — the seal statement); the other
--      writers that now emit one: vacate / leave_league (status →
--      orphaned), a claim / assign_manager / takeover ONLY when the status
--      flips orphaned → active (a takeover of a managed franchise changes
--      nothing rendered and is silent), a rename. Client:
--      `LEAGUE_CHANNEL_EVENTS` 8 → 9, `STANDINGS_INVALIDATING_EVENTS` + the
--      league-detail predicate.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * No retirement during `playoffs` (Q41 — the successor's bracket line).
--   * No `teams` INSERT / DELETE trigger, no per-row `teams` trigger (§4).
--   * No FK on `transactions.related_action_id` (M6's `commissioner_actions`).
--   * No route / hook / UI change: the retire control stays DISABLED in
--     `src/components/leagues/invite-panel.tsx:731-737` (the "Retire the
--     franchise" ModeOption; its "not available before the draft" copy is
--     now stale — F262(a)) until F262's UI-lane task wires `action_id` +
--     E49's confirm copy.
--   * No guard in 119's door for a past-week correction handed the
--     SUCCESSOR's id (the worker maps deltas through the CURRENT roster —
--     D292; a (successor, past week) provisional row would sit beside the
--     predecessor's and the lineage fold would count that week twice):
--     the h2h arm is already safe by pairing (F257(a′) — the successor is
--     on no past-week matchup row: `no_matchup_row`); the total_points arm
--     is the exposed one, and the rule is L.D2.2's — F262(d).
--   * No re-target of a pending seat invite that names the retired
--     franchise: claiming it refuses by name ("that franchise is retired",
--     062/063) — loud, not silent (D320(7)).
--
-- Grants doctrine (D18→D23): `remove_manager` SECURITY DEFINER +
-- search_path='' + REVOKE FROM PUBLIC, anon (authenticated keeps EXECUTE —
-- the in-body commissioner check is the gate; a manager retiring himself is
-- refused 42501 by name, and so is a co-commissioner — R858); the two
-- internals stay plain / REVOKEd from every client role exactly as 117/118
-- left them (re-asserted below); the trigger function is DEFINER +
-- search_path='' + triple-REVOKEd, the payload function plain + triple-
-- REVOKEd (119's shape).
-- Lock order (063 banner, R98): leagues → the target league_members row →
-- teams; the successor is a fresh INSERT (no lock); 113's roster writer takes
-- the league row FOR UPDATE first, so a concurrent add/drop serializes behind
-- the retirement and then fails its manager check (the seat has no user).
-- Migration checklist (tasks-M* §4.4): additive — no table/column/policy
-- change; the DROP is of a function signature re-created in the same file;
-- one new trigger (`teams`, §4). R6 staging-rehearsal waiver: fresh local
-- `db reset` over 001–120 + pgTAP 068 (and 017 / 065 / 066 unchanged in
-- count; 067 B5c and 024's F42 cell edited in place for the trigger) is the
-- rehearsal evidence. D38 realtime waiver: the ONE new trigger is
-- Broadcast-from-DB on a private topic (070's policies, no publication
-- change — D89), per statement, column-selected — §12.14 (v2.16.29) lists
-- it; F42 is discharged for `teams` and stays re-waived for the other four.
-- HELD from production: `supabase/HELD-FROM-PRODUCTION.txt` closes `082-120`
-- in this PR. No launch-surface table is touched: every write is on the
-- leagues chain (teams' league rows, team_managers, league_members,
-- league_rosters, team_lineups league rows, matchups, team_week_results,
-- transactions, league_chat); reads outside it are 063's on profiles. The
-- `teams` trigger function runs once per UPDATE statement on the table —
-- a non-league team's write runs it and sends nothing (the league_id
-- guard); realtime.send traps its own errors (070).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. remove_manager — 063's text + the retire arm (derive_120.py).
--    DROP + CREATE: the signature gains p_action_id (110's precedent for a
--    signature change under D137).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS remove_manager(UUID, UUID, TEXT, UUID, TEXT);

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
    -- always (§12.2). faab re-seeded from the CURRENT budget (v2.8.7).
    UPDATE public.league_members
    SET user_id = p_successor_user_id,
        is_placeholder = FALSE,
        role = 'manager',             -- powers never inherit with a seat
        faab_balance = v_league.faab_budget
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

    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,        -- back to an open seat, team_id KEPT
        role = 'manager',
        faab_balance = v_league.faab_budget
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
-- 2. league_standings_internal — 118's text + the lineage fold (seeding only).
--    The wrappers league_standings / league_standings_projected are untouched.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_standings_internal(p_league_id UUID, p_projected BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  c_catalog  CONSTANT TEXT[] := ARRAY['win_pct', 'points_for', 'head_to_head', 'points_against', 'division_record', 'coin_flip'];
  v_league   public.leagues;
  v_settings JSONB;
  v_mode     TEXT;
  v_first    INTEGER;
  v_last     INTEGER;
  v_chain    TEXT[] := '{}';
  v_appended TEXT[] := '{}';
  v_entry    TEXT;
  v_seed     TEXT;
  v_seed_src TEXT;
  v_h2h_ord  INTEGER;
  v_h2h_on   BOOLEAN;
  v_weeks    INTEGER;
  v_rows     JSONB;
  v_skipped  JSONB;
  v_pa_gaps  JSONB;
  v_chain_js JSONB;
  v_median_on BOOLEAN;
  v_weeks_proj INTEGER;
BEGIN
  -- 118: the member check lives in the two DEFINER wrappers
  -- (`league_standings` / `league_standings_projected`); this helper is
  -- REVOKEd and reached through them, the jobs and the harness only.
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_standings: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode     := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  v_median_on := COALESCE((v_settings ->> 'median_game')::boolean, FALSE);
  IF v_mode NOT IN ('h2h', 'total_points') THEN
    RAISE EXCEPTION 'league_standings: league % has schedule_mode % — expected h2h or total_points (§7.3.1)', p_league_id, v_mode
      USING ERRCODE = 'P0001';
  END IF;

  -- The regular season in NFL-week terms (D288): first week … first +
  -- regular_season_weeks − 1. No league_weeks rows ⇒ no season ⇒ no rows.
  SELECT min(lw.week) INTO v_first
  FROM public.league_weeks lw WHERE lw.league_id = p_league_id AND lw.season = v_league.season;
  v_last := v_first + v_league.regular_season_weeks - 1;

  -- The chain: the stored order, validated; the catalog's remainder appended.
  IF jsonb_typeof(v_settings -> 'tiebreakers') = 'array' THEN
    FOR v_entry IN SELECT jsonb_array_elements_text(v_settings -> 'tiebreakers') LOOP
      IF NOT (v_entry = ANY (c_catalog)) THEN
        RAISE EXCEPTION 'league_standings: league % stores an unknown tiebreaker % (§7.3.7: win_pct, points_for, head_to_head, points_against, division_record, coin_flip)', p_league_id, v_entry
          USING ERRCODE = 'P0001';
      END IF;
      IF v_entry = ANY (v_chain) THEN
        RAISE EXCEPTION 'league_standings: league % stores the tiebreaker % twice (§7.3.7: entries are unique)', p_league_id, v_entry
          USING ERRCODE = 'P0001';
      END IF;
      v_chain := v_chain || v_entry;
    END LOOP;
  ELSIF v_settings ? 'tiebreakers' THEN
    RAISE EXCEPTION 'league_standings: league % stores tiebreakers that are not an array', p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOREACH v_entry IN ARRAY c_catalog LOOP
    IF NOT (v_entry = ANY (v_chain)) THEN
      v_chain := v_chain || v_entry;
      v_appended := v_appended || v_entry;
    END IF;
  END LOOP;
  v_h2h_ord := array_position(v_chain, 'head_to_head');
  v_h2h_on  := (v_mode = 'h2h');

  v_seed_src := CASE WHEN v_settings ? 'schedule_seed' AND jsonb_typeof(v_settings -> 'schedule_seed') <> 'null'
                     THEN 'schedule_seed' ELSE 'league_id' END;
  v_seed := CASE WHEN v_seed_src = 'schedule_seed' THEN v_settings ->> 'schedule_seed' ELSE p_league_id::text END;

  WITH RECURSIVE chain AS (
    SELECT c.e AS entry, c.ord::int AS ord FROM unnest(v_chain) WITH ORDINALITY AS c(e, ord)
  ),
  seated AS (
    SELECT t.id, t.name FROM public.teams t WHERE t.league_id = p_league_id AND t.status <> 'retired'
  ),
  -- 120 (L.D1.10 / §7.2.1(b)): the LINEAGE — every seated franchise plus
  -- the retired predecessors whose successor chain leads to it, walked
  -- BACKWARD over `successor_team_id` (bounded; the retire RPC refuses a
  -- cyclic chain — F1). A successor's standings line folds its
  -- predecessors' rows for SEEDING (W/L/T, PF, PA, weeks); the
  -- head-to-head entry below stays keyed on the LIVE ids — the successor's
  -- H2H history does NOT inherit (both sides pinned, 068 D). A league
  -- with no retired franchise reads exactly 117/118's rows.
  lineage AS (
    SELECT s.id AS root_id, s.id AS team_id, 0 AS depth FROM seated s
    UNION ALL
    SELECT l.root_id, p.id, l.depth + 1
    FROM lineage l JOIN public.teams p ON p.successor_team_id = l.team_id AND p.status = 'retired'
    WHERE l.depth < 64
  ),
  final_ AS MATERIALIZED (   -- THE scan: idx_twr_league_season (league_id, season, week)
    SELECT r.team_id, r.week, r.points, r.opponent_team_id, r.h2h_result, r.median_result,
           r.second_opponent_team_id, r.second_result
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = v_league.season
      AND r.week >= v_first AND r.week <= v_last
      AND r.is_final
  ),
  -- 118 (F253(a) / Q39(E)): the PROJECTED arm — "if the season ended now".
  -- An OPEN regular-season week (live / correction_window) holding no final
  -- row is derived through the SAME helper finalization writes from
  -- (`week_results_derive_internal`, D137): h2h from the matchups AS
  -- WRITTEN with a NULL result read from the scores (E38) and a NULL score
  -- read as 0.00 SO FAR (a projection is not a finalization — E61's
  -- pending word is finalize's); total_points from the worker's provisional
  -- rows; the median re-derived per week through `week_median_internal`.
  -- An `upcoming` week NEVER counts (unplayed); a reopened week (final rows
  -- present) reads its final rows. Empty when p_projected is FALSE — the
  -- default arm is 117's scan, byte for byte.
  proj_weeks AS (
    SELECT lw.week
    FROM public.league_weeks lw
    WHERE p_projected
      AND lw.league_id = p_league_id AND lw.season = v_league.season
      AND lw.week >= v_first AND lw.week <= v_last
      AND lw.status IN ('live', 'correction_window')
      AND NOT EXISTS (SELECT 1 FROM final_ f WHERE f.week = lw.week)
  ),
  proj_raw AS (
    SELECT pw.week, d.team_id, d.points, d.opponent_team_id, d.h2h_result,
           d.second_opponent_team_id, d.second_result
    FROM proj_weeks pw
    CROSS JOIN LATERAL public.week_results_derive_internal(p_league_id, v_league.season, pw.week, TRUE) d
  ),
  proj_med AS (
    SELECT pr.week, public.week_median_internal(array_agg(pr.points ORDER BY pr.points)) AS med
    FROM proj_raw pr GROUP BY pr.week
  ),
  rows_ AS MATERIALIZED (
    SELECT f.team_id, f.week, f.points, f.opponent_team_id, f.h2h_result, f.median_result,
           f.second_opponent_team_id, f.second_result
    FROM final_ f
    UNION ALL
    SELECT pr.team_id, pr.week, pr.points, pr.opponent_team_id, pr.h2h_result,
           CASE WHEN v_median_on AND pm.med IS NOT NULL THEN
             CASE WHEN pr.points > pm.med THEN 'win' WHEN pr.points < pm.med THEN 'loss' ELSE 'tie' END
           END,
           pr.second_opponent_team_id, pr.second_result
    FROM proj_raw pr JOIN proj_med pm ON pm.week = pr.week
  ),
  agg AS (
    SELECT s.id AS team_id, s.name,
      count(*) FILTER (WHERE r.h2h_result = 'win')  ::int AS h2h_w,
      count(*) FILTER (WHERE r.h2h_result = 'loss') ::int AS h2h_l,
      count(*) FILTER (WHERE r.h2h_result = 'tie')  ::int AS h2h_t,
      count(*) FILTER (WHERE r.median_result = 'win')  ::int AS med_w,
      count(*) FILTER (WHERE r.median_result = 'loss') ::int AS med_l,
      count(*) FILTER (WHERE r.median_result = 'tie')  ::int AS med_t,
      count(*) FILTER (WHERE r.second_result = 'win')  ::int AS sec_w,
      count(*) FILTER (WHERE r.second_result = 'loss') ::int AS sec_l,
      count(*) FILTER (WHERE r.second_result = 'tie')  ::int AS sec_t,
      COALESCE(sum(r.points), 0)::numeric AS pf,
      COALESCE(sum(o.points), 0)::numeric AS pa,
      count(r.team_id)::int AS weeks,
      count(*) FILTER (WHERE r.opponent_team_id IS NOT NULL AND o.team_id IS NULL)::int AS pa_gap
    FROM seated s
    LEFT JOIN rows_ r ON r.team_id IN (SELECT lg.team_id FROM lineage lg WHERE lg.root_id = s.id)   -- 120: the lineage fold (seeding)
    LEFT JOIN rows_ o ON o.team_id = r.opponent_team_id AND o.week = r.week
    GROUP BY s.id, s.name
  ),
  stats AS (
    SELECT a.*,
      (a.h2h_w + a.med_w + a.sec_w) AS w,
      (a.h2h_l + a.med_l + a.sec_l) AS l,
      (a.h2h_t + a.med_t + a.sec_t) AS t,
      (a.h2h_w + a.med_w + a.sec_w + a.h2h_l + a.med_l + a.sec_l + a.h2h_t + a.med_t + a.sec_t) AS g,
      (('x' || left(md5(v_seed || ':' || a.team_id::text), 15))::bit(60)::bigint)::numeric AS flip
    FROM agg a
  ),
  stats2 AS (
    SELECT s.*,
      CASE WHEN s.g = 0 THEN 0::numeric ELSE (2 * s.w + s.t)::numeric / (2 * s.g) END AS wp
    FROM stats s
  ),
  pre AS (   -- the keys of every entry BEFORE head_to_head: the group definition at that point
    SELECT s.*,
      COALESCE((SELECT array_agg(CASE c.entry
                                   WHEN 'win_pct'         THEN s.wp
                                   WHEN 'points_for'      THEN s.pf
                                   WHEN 'points_against'  THEN s.pa
                                   WHEN 'division_record' THEN 0::numeric
                                   WHEN 'coin_flip'       THEN s.flip END ORDER BY c.ord)
                FROM chain c WHERE v_h2h_ord IS NOT NULL AND c.ord < v_h2h_ord), '{}'::numeric[]) AS prekeys
    FROM stats2 s
  ),
  grp AS (
    SELECT p.*,
      count(*) OVER (PARTITION BY p.prekeys) AS gsize,
      (SELECT q.team_id FROM pre q WHERE q.prekeys = p.prekeys AND q.team_id <> p.team_id ORDER BY q.team_id LIMIT 1) AS other_id
    FROM pre p
  ),
  h2h AS (
    SELECT g.*,
      CASE WHEN v_h2h_on AND v_h2h_ord IS NOT NULL AND g.gsize = 2 THEN
        (SELECT (count(*) FILTER (WHERE r.opponent_team_id = g.other_id AND r.h2h_result = 'win')
               + count(*) FILTER (WHERE r.second_opponent_team_id = g.other_id AND r.second_result = 'win')
               - count(*) FILTER (WHERE r.opponent_team_id = g.other_id AND r.h2h_result = 'loss')
               - count(*) FILTER (WHERE r.second_opponent_team_id = g.other_id AND r.second_result = 'loss'))::numeric
         FROM rows_ r WHERE r.team_id = g.team_id)
      ELSE 0::numeric END AS h2h_key
    FROM grp g
  ),
  keyed AS (
    SELECT h.*,
      (SELECT array_agg(CASE c.entry
                          WHEN 'win_pct'         THEN h.wp
                          WHEN 'points_for'      THEN h.pf
                          WHEN 'head_to_head'    THEN h.h2h_key
                          WHEN 'points_against'  THEN h.pa
                          WHEN 'division_record' THEN 0::numeric
                          WHEN 'coin_flip'       THEN h.flip END ORDER BY c.ord)
       FROM chain c) AS keys
    FROM h2h h
  ),
  ranked AS (
    SELECT k.*,
      row_number() OVER (ORDER BY k.keys DESC, k.team_id) AS rank,
      lag(k.keys)  OVER (ORDER BY k.keys DESC, k.team_id) AS prev_keys
    FROM keyed k
  ),
  fin AS (
    SELECT r.*,
      CASE WHEN r.prev_keys IS NULL THEN NULL
           ELSE COALESCE(v_chain[(SELECT min(i) FROM generate_subscripts(r.keys, 1) i
                                  WHERE r.keys[i] IS DISTINCT FROM r.prev_keys[i])], 'unresolved') END AS separated_by
    FROM ranked r
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'rank',            f.rank,
        'team_id',         f.team_id,
        'name',            f.name,
        'wins',            f.w,
        'losses',          f.l,
        'ties',            f.t,
        'games',           f.g,
        'win_pct',         round(f.wp, 4),
        'points_for',      f.pf,
        'points_against',  f.pa,
        'weeks',           f.weeks,
        'h2h_record',      jsonb_build_object('wins', f.h2h_w, 'losses', f.h2h_l, 'ties', f.h2h_t),
        'median_record',   jsonb_build_object('wins', f.med_w, 'losses', f.med_l, 'ties', f.med_t),
        'second_record',   jsonb_build_object('wins', f.sec_w, 'losses', f.sec_l, 'ties', f.sec_t),
        'separated_by',    f.separated_by) ORDER BY f.rank), '[]'::jsonb) FROM fin f),
    (SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'teams'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('entry', 'head_to_head',
                 'reason', CASE WHEN v_h2h_on THEN 'group_of_3_or_more' ELSE 'total_points' END,
                 'teams', (SELECT jsonb_agg(g2.team_id ORDER BY g2.team_id) FROM grp g2 WHERE g2.prekeys = g.prekeys)) AS x
        FROM grp g
        WHERE v_h2h_ord IS NOT NULL
          AND ((v_h2h_on AND g.gsize >= 3) OR (NOT v_h2h_on AND g.gsize >= 2))
        GROUP BY g.prekeys, g.gsize) sk),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id', a.team_id, 'weeks_without_opponent_row', a.pa_gap) ORDER BY a.team_id), '[]'::jsonb)
     FROM agg a WHERE a.pa_gap > 0),
    (SELECT count(DISTINCT f.week)::int FROM final_ f),
    (SELECT count(*)::int FROM proj_weeks)
  INTO v_rows, v_skipped, v_pa_gaps, v_weeks, v_weeks_proj;

  SELECT jsonb_agg(jsonb_build_object(
           'entry', c.entry,
           'status', CASE c.entry
                       WHEN 'division_record' THEN 'inert'
                       WHEN 'head_to_head'    THEN CASE WHEN v_h2h_on THEN 'applied' ELSE 'skipped' END
                       ELSE 'applied' END,
           'reason', CASE c.entry
                       WHEN 'division_record' THEN 'divisions_pinned_at_1'
                       WHEN 'head_to_head'    THEN CASE WHEN v_h2h_on THEN 'clean_two_team_ties_only' ELSE 'total_points' END
                       ELSE NULL END) ORDER BY c.ord)
  INTO v_chain_js
  FROM unnest(v_chain) WITH ORDINALITY AS c(entry, ord);

  RETURN jsonb_build_object(
    'league_id',        p_league_id,
    'season',           v_league.season,
    'schedule_mode',    v_mode,
    'regular_season',   jsonb_build_object('first_week', v_first, 'last_week', v_last),
    'weeks_final',      v_weeks,
    'projected',        p_projected,
    'weeks_projected',  v_weeks_proj,
    'chain',            v_chain_js,
    'chain_appended',   to_jsonb(v_appended),
    'coin_flip_seed',   v_seed,
    'coin_flip_seed_source', v_seed_src,
    'skipped',          v_skipped,
    'pa_gaps',          v_pa_gaps,
    'standings',        v_rows,
    'reason',           CASE WHEN v_weeks = 0 AND v_weeks_proj = 0 THEN 'no_final_weeks' ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_standings_internal(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. week_results_pending_internal — 117's text + the lineage read in the
--    total_points arm.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION week_results_pending_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_mode    TEXT;
  v_pending INTEGER;
  v_missing JSONB;
BEGIN
  SELECT COALESCE(COALESCE(l.settings, '{}'::jsonb) ->> 'schedule_mode', 'h2h') INTO v_mode
  FROM public.leagues l WHERE l.id = p_league_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'week_results_pending_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_mode = 'h2h' THEN
    SELECT count(*) INTO v_pending
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week
      AND (m.home_score IS NULL OR (m.away_team_id IS NOT NULL AND m.away_score IS NULL));
    IF v_pending > 0 THEN
      RETURN jsonb_build_object('reason', 'pending_scores', 'pending', v_pending);
    END IF;
    RETURN NULL;
  END IF;

  -- total_points: the worker's provisional rows; ANY seated team missing
  -- holds the week (F241(b) — a partial absence is the silent shape).
  SELECT COALESCE(jsonb_agg(t.id ORDER BY t.id), '[]'::jsonb) INTO v_missing
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired'
    AND NOT EXISTS (
      SELECT 1 FROM public.team_week_results r
      WHERE r.league_id = p_league_id AND r.season = p_season AND r.week = p_week
        -- 120 (L.D1.10 / §7.2.1(b)): the seated franchise OR a retired
        -- predecessor in its lineage — a week the predecessor played is
        -- covered by the predecessor's own row (its book); the successor's
        -- opens at retired_at_week. Without this a total_points league
        -- would hold its correction_window week forever after a retirement
        -- (068 G; probe 5).
        AND r.team_id IN (
          WITH RECURSIVE lineage AS (
            SELECT t.id AS team_id, 0 AS depth
            UNION ALL
            SELECT p.id, l.depth + 1
            FROM lineage l JOIN public.teams p ON p.successor_team_id = l.team_id AND p.status = 'retired'
            WHERE l.depth < 64)
          SELECT lg.team_id FROM lineage lg));
  IF jsonb_array_length(v_missing) > 0 THEN
    RETURN jsonb_build_object('reason', 'pending_results',
                              'pending', jsonb_array_length(v_missing), 'missing', v_missing);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION week_results_pending_internal(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. teams — the broadcast trigger (R856; F42 discharged for `teams`).
--    119's per-STATEMENT transition-table shape, diff-aware: OLD and NEW
--    joined by id, a row counts only when one of the four columns a live
--    surface renders CHANGED — one event per league per statement, nothing
--    for an empty or no-change statement, non-league rows skipped. NOT
--    owner_id (manager identity stays off this wire), NOT updated_at, NOT
--    INSERT (the successor rides the seal UPDATE in the same transaction).
--    (`UPDATE OF <cols>` + a transition table is refused by PG 17 — the
--    diff below is what that column list would have approximated.)
-- ----------------------------------------------------------------------------
-- teams → what the standings page and the league detail render: identity,
-- status, the lineage. NOT: owner_id, list_id, scoring_system_id, the
-- legacy wins/losses/total_points cells, league_id (the topic).
CREATE OR REPLACE FUNCTION team_broadcast_payload(t teams)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',                t.id,
    'name',              t.name,
    'status',            t.status,
    'retired_at_week',   t.retired_at_week,
    'successor_team_id', t.successor_team_id);
$$;

REVOKE EXECUTE ON FUNCTION team_broadcast_payload(teams)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION broadcast_teams_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lg RECORD;
BEGIN
  FOR v_lg IN
    SELECT c.league_id,
           count(*)::int                                                     AS n,
           jsonb_agg(public.team_broadcast_payload(c) ORDER BY c.name, c.id) AS rows_
    FROM new_rows c
    JOIN old_rows o ON o.id = c.id
    WHERE c.league_id IS NOT NULL
      AND (c.name              IS DISTINCT FROM o.name
        OR c.status            IS DISTINCT FROM o.status
        OR c.retired_at_week   IS DISTINCT FROM o.retired_at_week
        OR c.successor_team_id IS DISTINCT FROM o.successor_team_id)
    GROUP BY c.league_id
    ORDER BY c.league_id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'operation', TG_OP,
        'table',     TG_TABLE_NAME,
        'schema',    TG_TABLE_SCHEMA,
        'record',    jsonb_build_object(
          'count', v_lg.n,
          'teams', v_lg.rows_)),
      'teams',
      'league:' || v_lg.league_id::text,
      true);
  END LOOP;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_teams_statement()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_teams
  AFTER UPDATE ON teams
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION broadcast_teams_statement();

COMMENT ON COLUMN teams.successor_team_id IS
  'Set on the RETIRED franchise → its successor (§7.2.1(b)). ONE writer: remove_manager(mode=''retire'') — migration 120 (the spec''s "retire_franchise" is that arm, D42); self-succession is the 053 CHECK, longer cycles are refused in-body by name (F1).';
COMMENT ON COLUMN teams.retired_at_week IS
  'The league week the successor''s book opens at (1 + the last played week when the franchise was sealed); NULL when sealed outside the season. History partitions here (E49).';
