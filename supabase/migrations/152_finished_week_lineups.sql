-- ============================================================================
-- 152_finished_week_lineups.sql — a move after a week's last game leaves that
-- finished week's lineups alone (PROGRESS F437; task L.D2.14, FULL rigour —
-- scoring integrity: a finished week's points).
-- Spec §13.1 (add/drop's lineup interplay; v2.16.62 erratum of the v2.16.19
-- note "cleared … from the current week on"), §13.2 (the waiver run's lineup
-- interplay, TD10), §15.4 (the commissioner's roster moves), §7.3.3 / §22.2
-- (a week is scored from THAT week's lineup); Q75 as ruled ("while it waits
-- the players stay with — and can be started by — their current teams");
-- PROGRESS D410(5) (151's executor already starts at the first unfinished
-- week), R1201 (the third site), D411 (this build).
--
-- Numbering: RESERVED by the orchestrator (152 / pgTAP 100). `ls
-- supabase/migrations | tail -1` → 151_trade_execution.sql. NOT held:
-- reaches production by `npx supabase db push` only (push debt: 135–152).
--
-- THE DEFECT (F437, measured twice by reviewers). The current week flips at
-- the NEXT week's `nfl_weeks.starts_at` (112's `lineup_current_week_internal`,
-- Wednesday 00:00 ET), but the game-day lock releases at the current week's
-- `last_game_ends_at` (115 — Q34(B)). Between the two (Monday night →
-- Wednesday) a starter who PLAYED is droppable again, and the three lineup
-- loops below cleared every `team_lineups` row "from the current week on" —
-- the FINISHED week included. The score worker scores a week from that
-- week's stored `slot_map` (score-week-worker.ts step 5), so the next re-score
-- of the finished week — a stat correction runs Tuesday–Thursday, inside the
-- week's correction window — erased the dropped player's points from the team
-- that played him. League 1's Tuesday 09:00 Pacific waiver run lands exactly
-- in that gap (R1201).
--
-- THE FIX — ONE CASE, THREE SITES, 151's rule. Lineup rows change from the
-- first UNFINISHED week: `v_from_week = v_current + 1` once the current
-- week's `last_game_ends_at <= p_at`, else `v_current` (NULL — not yet
-- recorded — is "not over", 115's reading). The next week's lineup is either
-- already stored (then the loop edits it) or materialized at the week's open
-- by 116's auto-carry, which drops a player no longer rostered and benches
-- every rostered player it does not start (bench = roster − starters − IR),
-- so an add made on Tuesday reaches the next week either way and nothing
-- stale carries. Before the week ends, and before a season's first week
-- starts, the behaviour is unchanged (pgTAP 100 pins both).
--
--   commish_roster_override_internal: `p_first_week` of the shared sync
--   helper (127) becomes `v_from_week`; `p_current` stays `v_current`, so a
--   Tuesday move vacates no current-week slot and queues no re-score of the
--   finished week (D346's scoring arm reads `vacated_current_slot`). A
--   commissioner moving a player whose game is OVER in a week still in
--   progress (E32 lifted, standing rule (g)) is NOT this defect and is
--   unchanged — PROGRESS F440 records it for Chris.
--
-- D137 — each replaced function is derived from its NEWEST definer's FILE
-- TEXT by an exact-match script (derive_152.py — every substitution
-- asserted to hit once; sources md5-asserted; hunks counted with difflib):
--   roster_add_drop_internal          149:397-922   md5 450bd73b… → 3 hunks
--       (+2 DECLARE; the from-week CASE before the loop + the loop's
--       predicate; the Q32 comment says a finished week is never touched)
--   commish_roster_override_internal  149:930-1916  md5 450bd73b… → 3 hunks
--       (+2 DECLARE; the CASE + side A's call; side B's call)
--   process_waivers_internal          150:721-1261  md5 9558ad2f… → 3 hunks
--       (+2 DECLARE; the CASE after the current week is read; the loop)
-- 151 redefines none of the three (measured: its CREATE OR REPLACE list is
-- the trade functions only) and 151's executor already carries the rule.
--
-- R1206 (PR #337's review, fix round — edited IN PLACE, 152 is unpushed).
-- Keeping the played starter in the finished week's slot_map is not enough
-- while that week is still CURRENT and `live` (up to an hour after its last
-- game, until the hourly league-week advance moves it to its correction
-- window; autopilot runs on the current week): two readers treated a stored starter
-- who is no longer rostered as nothing to protect — set_lineup step (7a)
-- (`CONTINUE WHEN NOT (v_by_pid ? v_pid)`) let a manager replace him, and
-- autopilot's classification read his slot as OPEN and filled it. Both now
-- treat a stored STARTER off the roster whose OWN game for that week has
-- kicked off as the locked starter he is (Q32's amendment: "if they are in
-- the lineup they are stuck in the lineup"): carried through unchanged,
-- never OPEN, and a manager's attempt to put anyone else in his slot is
-- refused by name ("<player> already played this week — his start stays").
-- One whose game has not kicked off (a bye) did not play: his slot opens,
-- unchanged. The same holds for a player 151's executor traded away after
-- the week's last game. Sections 4–5 below, derived by exact-match script
-- (derive_152b.py — every substitution asserted to hit once; hunks counted
-- with difflib) from the newest definer's FILE TEXT:
--   set_lineup_internal        131:3685-4283  md5 45f95f7e… → 5 hunks
--   lineup_autopilot_internal  142:459-1034   md5 fd5cf554… → 2 hunks
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   No table, column, policy, grant or signature changes — five function
--   bodies replaced (signatures unchanged ⇒ ACLs kept; REVOKEs restated).
--   Each stays PLAIN (not DEFINER), `search_path = ''`, closed to PUBLIC /
--   anon / authenticated; the doors that call them (roster_add_drop,
--   commish_force_add_drop / commish_move_player, waiver_tick, set_lineup,
--   lineup_lock_tick) are untouched.
--   Time only through p_at. Typegen: no change (no signature moved —
--   `gen types` diff shown empty in the PR). Realtime: none.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–152 and the full pgTAP run in the PR. D38 — nothing to
--   backfill: no stored lineup is rewritten (a finished week's lineup the
--   old code already emptied is not reconstructed — the schema keeps no
--   history of a slot map; PROGRESS F437's discharge says so).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. roster_add_drop_internal — CREATE OR REPLACE against 149:397-922's FILE
--    TEXT (D137), 3 hunks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roster_add_drop_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT,
  p_drop      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_team          public.teams;
  v_txn           public.transactions;
  v_found         BOOLEAN;
  v_is_manager    BOOLEAN;
  v_current       INTEGER;
  v_mode          TEXT;
  v_waiver_type   TEXT;
  v_sched         JSONB;      -- 149 (Q70): the league's waiver schedule, parsed by name
  v_fa_window     JSONB;      -- 149 (Q70): the free-agency window at p_at
  v_cap_week_txt  TEXT;
  v_cap_season_txt TEXT;
  v_cap_week      INTEGER;    -- NULL = unlimited
  v_cap_season    INTEGER;    -- NULL = unlimited
  v_hold_hours    INTEGER;
  v_roster_size   INTEGER;
  v_roster_count  INTEGER;
  v_after_count   INTEGER;
  v_used_week     INTEGER;
  v_used_season   INTEGER;
  v_drop_row      public.league_rosters;
  v_drop_p        public.players;
  v_add_p         public.players;
  v_owner_team    public.teams;
  v_pool          public.league_player_pool;
  v_pool_add_from TEXT;
  v_drop_to_state TEXT;
  v_drop_until    TIMESTAMPTZ;
  v_hold_early    BOOLEAN := FALSE;
  v_drop_lock     JSONB;
  v_add_lock      JSONB;
  v_txn_id        UUID := gen_random_uuid();
  v_result        JSONB;
  v_lineups       JSONB := '[]'::jsonb;
  v_row           public.team_lineups;
  v_map           JSONB;
  v_key           TEXT;
  v_locked        BOOLEAN;
  v_window        RECORD;
  v_k             RECORD;
  v_starters      JSONB;
  v_bench         JSONB;
  v_cnt           INTEGER;
  v_changed       BOOLEAN;
  v_week_end      TIMESTAMPTZ;   -- 152 / F437: the current week's last_game_ends_at
  v_from_week     INTEGER;       -- 152 / F437: the first unfinished week
BEGIN
  -- (0) shape
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: p_action_id is required (idempotency key — one UUID per move, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NULL AND p_drop IS NULL THEN
    RAISE EXCEPTION 'roster_add_drop: nothing to do — give a player to add, a player to drop, or both (§13.1)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NOT NULL AND p_add = p_drop THEN
    RAISE EXCEPTION 'roster_add_drop: add and drop name the same player (%) — a move changes the roster (§13.1)', p_add
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (rule 8; D294's one serialization point).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35): the manager of THIS team, never a stint. One
  --     no-leak 42501; a commissioner acting on another team is refused the
  --     same way (his roster move is M6's commissioner_move — banner §(2)).
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  IF NOT v_found OR NOT v_is_manager THEN
    RAISE EXCEPTION 'roster_add_drop: not the manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2; kind- and team-scoped — R732).
  SELECT t.* INTO v_txn
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
  IF FOUND THEN
    IF v_txn.type <> 'add_drop' THEN
      RAISE EXCEPTION
        'roster_add_drop: action_id % already names a % transaction in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_txn.type
        USING ERRCODE = 'P0001';
    END IF;
    IF v_txn.initiator_team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION
        'roster_add_drop: action_id % belongs to another team''s move in this league — an action_id identifies ONE submit (R732)',
        p_action_id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_txn.payload;
  END IF;

  -- (4) league / team / calendar
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'roster_add_drop: league % is % — rosters change through add/drop only while in_season or in playoffs (§13.1)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'roster_add_drop: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'roster_add_drop: team % is retired — a sealed franchise makes no moves (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: league % has no league_weeks rows — no season calendar to evaluate locks and caps against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- settings (§7.3.4; typed column for waiver_type + lineup_lock, the blob for the rest)
  v_mode         := COALESCE(v_league.lineup_lock, 'per_player_kickoff');
  v_waiver_type  := COALESCE(v_league.waiver_type, 'faab');
  -- 149 (Q70 as ruled): the waiver SCHEDULE replaces the retired
  -- waiver_period_hours / free_agency pair (149's CHECK refuses both keys);
  -- parsed and validated by name, defaults = the §7.3.4 catalog's.
  v_sched        := public.waiver_schedule_internal(v_league.settings, v_waiver_type);
  v_hold_hours   := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);
  v_cap_week_txt   := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_cap_season_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_cap_week   := CASE WHEN v_cap_week_txt   = 'unlimited' THEN NULL ELSE v_cap_week_txt::int   END;
  v_cap_season := CASE WHEN v_cap_season_txt = 'unlimited' THEN NULL ELSE v_cap_season_txt::int END;
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;
  SELECT count(*)::int INTO v_roster_count
  FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id;

  -- CAPS, COUNTED BEFORE EITHER SIDE (§7.3.4; R763): this team's `complete`
  -- rows whose payload carries `add_player_id` (a drop-only move never counts
  -- — it is not an acquisition). These run here rather than inside the add
  -- branch because the RESULT reports `caps.used_week_after` /
  -- `used_season_after` on EVERY move: a drop-only call read them unassigned
  -- and reported NULL to a capped league, which L.D4.2 would render as
  -- "null of 3" (F227(f)). The enforcement below is still the add side's
  -- alone.
  SELECT count(*)::int INTO v_used_week
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = p_team_id
    AND t.status = 'complete' AND t.week = v_current
    AND (t.payload ->> 'add_player_id') IS NOT NULL;
  SELECT count(*)::int INTO v_used_season
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = p_team_id
    AND t.status = 'complete'
    AND (t.payload ->> 'add_player_id') IS NOT NULL;

  -- (5) THE DROP
  IF p_drop IS NOT NULL THEN
    SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: no player with id % (drop)', p_drop USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_drop_row
    FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: % (%) is not on %''s roster — nobody in league % rosters him (§13.1)',
        v_drop_p.full_name, p_drop, v_team.name, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_drop_row.team_id <> p_team_id THEN
      SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_drop_row.team_id;
      RAISE EXCEPTION 'roster_add_drop: % (%) is on %''s roster, not %''s — a manager drops only his own players (§13.1)',
        v_drop_p.full_name, p_drop, v_owner_team.name, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    -- E32, the DROP side (independent of the add side — the DoD probe).
    -- Q34(B) (Chris, 2026-09-05; migration 115): UNCONDITIONAL — no setting
    -- turns it off (the toggle is RETIRED entirely, Q35 (a)); the release is
    -- the week's `last_game_ends_at` (NULL = still locked, said in the text).
    v_drop_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_drop_p.team, p_at);
    IF (v_drop_lock ->> 'locked')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is locked for drops — kicked off at % (%); week % clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
        v_drop_p.full_name, p_drop, v_drop_lock ->> 'kickoff_at', v_drop_lock ->> 'datum_arm',
        v_drop_lock ->> 'week', COALESCE(v_drop_lock ->> 'window_ends_at', 'an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked')
        USING ERRCODE = 'P0001';
    END IF;
    -- fa_hold_hours (§7.3.4): an early drop of a free-agent add returns him
    -- to FA, not waivers. held ≥ hold ⇒ waivers (the boundary is inclusive).
    v_hold_early := v_drop_row.acquisition_type = 'free_agent'
                    AND v_hold_hours > 0
                    AND v_drop_row.acquired_at IS NOT NULL
                    AND p_at < v_drop_row.acquired_at + make_interval(hours => v_hold_hours);
    IF v_hold_early OR v_waiver_type = 'none_fcfs' THEN
      v_drop_to_state := 'free_agent';
      v_drop_until := NULL;
    ELSE
      -- 149 (Q70 as ruled): a dropped player is on waivers until the NEXT
      -- scheduled waiver run (strictly after this instant) — never a fixed
      -- number of hours.
      v_drop_to_state := 'on_waivers';
      v_drop_until := public.waiver_next_run_internal(v_sched, p_at);
    END IF;
  END IF;

  -- (6) THE ADD
  IF p_add IS NOT NULL THEN
    SELECT p.* INTO v_add_p FROM public.players p WHERE p.id = p_add;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: no player with id % (add)', p_add USING ERRCODE = 'P0001';
    END IF;
    -- EXCLUSIVITY (business rule 7 / §12.7) — friendly, never a raw 23505.
    SELECT t.* INTO v_owner_team
    FROM public.league_rosters r JOIN public.teams t ON t.id = r.team_id
    WHERE r.league_id = p_league_id AND r.player_id = p_add;
    IF FOUND THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is already on %''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
        v_add_p.full_name, p_add, v_owner_team.name
        USING ERRCODE = 'P0001';
    END IF;
    -- POOL STATE (lazy rows: no row = free_agent, D294).
    SELECT pp.* INTO v_pool FROM public.league_player_pool pp
    WHERE pp.league_id = p_league_id AND pp.player_id = p_add;
    IF NOT FOUND THEN
      v_pool_add_from := 'free_agent';
    ELSIF v_pool.state = 'on_waivers' THEN
      -- 149: whether his waiver hold is still running is decided BELOW, after
      -- the game-day lock (Q74 — a kicked-off player is refused as locked,
      -- never offered a claim). The M4 interim (Q33 — FCFS at the lapse
      -- under both free_agency values) is REPLACED by the schedule.
      v_pool_add_from := 'on_waivers_lapsed';
    ELSIF v_pool.state = 'rostered' THEN
      -- No roster row (checked above) but a rostered pool row: the mirror is
      -- broken — asserted, not trusted (D294); reconciliation (L.D2.3) fixes.
      RAISE EXCEPTION
        'roster_add_drop: league_player_pool says % (%) is rostered in league % but league_rosters has no row — the pool mirror is broken; refusing until reconciliation (L.D2.3) repairs it (D294)',
        v_add_p.full_name, p_add, p_league_id
        USING ERRCODE = 'P0001';
    ELSE
      -- free_agent, or L.D1.6's locked_in_game (the games table decides below —
      -- never the stored state, rule 9).
      v_pool_add_from := v_pool.state;
    END IF;
    -- E32, the ADD side. Q34(B) + Q35 (a) (115): UNCONDITIONAL too —
    -- "picking up a player mid-game makes no sense" (Chris, 2026-09-05).
    v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at);
    IF (v_add_lock ->> 'locked')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is locked for adds — kicked off at % (%); week % clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
        v_add_p.full_name, p_add, v_add_lock ->> 'kickoff_at', v_add_lock ->> 'datum_arm',
        v_add_lock ->> 'week', COALESCE(v_add_lock ->> 'window_ends_at', 'an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked')
        USING ERRCODE = 'P0001';
    END IF;
    -- 149 (Q70 as ruled; Q74): THE WAIVER STATE — checked AFTER the lock, so
    -- a player whose game has started is refused as locked (the same message
    -- as always), never told to put in a claim the claim verb will refuse.
    --  (a) his own waiver hold: a dropped player is on waivers until the next
    --      run — and, once the processor tracks the league
    --      (`waiver_next_run_at` set), until that run is SETTLED: a hold whose
    --      run is due but unprocessed still refuses, so no instant add beats
    --      the claims the run is settling (E8).
    --  (b) the league's free-agency window: outside it every unowned player
    --      is claim-only until the next run (after the draft, until the first
    --      run after it; after the week's last game, until the next run).
    v_fa_window := public.waiver_window_internal(v_league, p_at);
    IF v_pool_add_from = 'on_waivers_lapsed'
       AND (v_pool.waivers_until > p_at
            OR (v_league.waiver_next_run_at IS NOT NULL AND v_pool.waivers_until >= v_league.waiver_next_run_at)) THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is on waivers until the waiver run at % (%) — put in a waiver claim; he is not an instant pickup until that run has been processed (§7.3.4/§13.1)',
        v_add_p.full_name, p_add, v_pool.waivers_until,
        to_char(v_pool.waivers_until AT TIME ZONE (v_sched ->> 'time_zone'), 'Dy YYYY-MM-DD HH24:MI') || ' ' || (v_sched ->> 'time_zone')
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT (v_fa_window ->> 'free_agency_open')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is claim-only right now — %; put in a waiver claim instead: claims settle at the next waiver run, % (%) (§7.3.4/§13.1)',
        v_add_p.full_name, p_add,
        CASE v_fa_window ->> 'why'
          WHEN 'awaiting_run' THEN 'no waiver run has happened since '
               || CASE v_fa_window ->> 'reset_kind' WHEN 'draft' THEN 'the draft' ELSE 'the week''s last game ended' END
          WHEN 'run_pending' THEN 'the waiver run at '   -- R1190: in the league's zone, like the next run
               || to_char((v_fa_window ->> 'scheduled_last_run_at')::timestamptz AT TIME ZONE (v_sched ->> 'time_zone'), 'Dy YYYY-MM-DD HH24:MI')
               || ' ' || (v_sched ->> 'time_zone') || ' is still being processed'
          WHEN 'before_opening_time' THEN 'free agency opens ' || initcap(v_sched ->> 'free_agency_open_day') || ' '
               || (v_sched ->> 'free_agency_open_time') || ' ' || (v_sched ->> 'time_zone')
          WHEN 'claims_only' THEN 'this league has no free agency — every pickup is a waiver claim'
          ELSE COALESCE(v_fa_window ->> 'why', 'unknown') END,
        v_fa_window ->> 'next_run_at',
        to_char((v_fa_window ->> 'next_run_at')::timestamptz AT TIME ZONE (v_sched ->> 'time_zone'), 'Dy YYYY-MM-DD HH24:MI') || ' ' || (v_sched ->> 'time_zone')
        USING ERRCODE = 'P0001';
    END IF;
    -- CAPACITY (§7.3.2 roster_size; §13.1 "drop one to stay within roster_size").
    v_after_count := v_roster_count + 1 - CASE WHEN p_drop IS NOT NULL THEN 1 ELSE 0 END;
    IF v_after_count > v_roster_size THEN
      RAISE EXCEPTION
        'roster_add_drop: %''s roster is full (% of % — §7.3.2 roster_size) — include a drop in the same move (§13.1)',
        v_team.name, v_roster_count, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
    -- CAPS (§7.3.4) — the counts were taken above (R763); only the ADD side
    -- enforces them.
    IF v_cap_week IS NOT NULL AND v_used_week >= v_cap_week THEN
      RAISE EXCEPTION
        'roster_add_drop: % has used % of % acquisitions in week % (acquisitions_per_week, §7.3.4) — no more adds this week',
        v_team.name, v_used_week, v_cap_week, v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF v_cap_season IS NOT NULL AND v_used_season >= v_cap_season THEN
      RAISE EXCEPTION
        'roster_add_drop: % has used % of % acquisitions this season (acquisitions_per_season, §7.3.4) — no more adds this season',
        v_team.name, v_used_season, v_cap_season
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_after_count := v_roster_count - 1;
  END IF;

  -- (7) WRITES
  IF p_drop IS NOT NULL THEN
    DELETE FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = p_drop;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'roster_add_drop: the drop of % deleted % roster rows, expected 1', p_drop, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league_id, p_drop, v_drop_to_state, v_drop_until, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
  END IF;

  IF p_add IS NOT NULL THEN
    BEGIN
      INSERT INTO public.league_rosters
        (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
      VALUES (p_league_id, p_team_id, p_add, 'bn', 'free_agent', 0, p_at);
    EXCEPTION WHEN unique_violation THEN
      -- 072's UNIQUE, kept as an UNPINNABLE backstop (R757/D276): the league
      -- row lock in (1) serializes every racer behind the exclusivity
      -- pre-check, so this branch is unreachable in practice — it exists so
      -- a raw 23505 can never reach the wire if that lock is ever weakened.
      RAISE EXCEPTION
        'roster_add_drop: % (%) was rostered by another team in this league a moment ago — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
        v_add_p.full_name, p_add
        USING ERRCODE = 'P0001';
    END;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league_id, p_add, 'rostered', NULL, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
  END IF;

  -- THE LINEUP CONSEQUENCES (banner: THE LINEUP INTERPLAY; F224(i)) — every
  -- row of this team from the first UNFINISHED week on (152 / F437).
  -- F437: the first UNFINISHED week is the current week while its last
  -- game has not ended, the next one once it has (151's trade executor's
  -- rule, D410(5)). A finished week's lineup is
  -- the record the score worker and the nightly reconcile score it from
  -- (score-week-worker.ts step 5 reads THE WEEK's slot_map), and stat
  -- corrections re-score it until its window closes — clearing a played
  -- starter from it would erase his points from the team that played him.
  SELECT w.last_game_ends_at INTO v_week_end FROM public.nfl_weeks w
  WHERE w.season = v_league.season AND w.week = v_current;
  v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;
  FOR v_row IN
    SELECT tl.* FROM public.team_lineups tl
    WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week >= v_from_week
    ORDER BY tl.week
    FOR UPDATE
  LOOP
    v_map := COALESCE(v_row.slot_map, '{}'::jsonb);
    v_starters := COALESCE(v_row.starters, '[]'::jsonb);
    v_bench := COALESCE(v_row.bench, '[]'::jsonb);
    v_changed := FALSE;
    IF p_drop IS NOT NULL THEN
      SELECT e.key INTO v_key FROM jsonb_each_text(v_map) e WHERE e.value = p_drop LIMIT 1;
      IF v_key IS NOT NULL THEN
        -- Q32 (Chris, 2026-09-03): droppability keys on the PLAYER's own
        -- kickoff (E32), never on his slot's lock state — so a droppable
        -- player has not played in any week this loop touches (a
        -- finished week is never touched — 152 / F437) and there is
        -- nothing to keep: the entry is ALWAYS cleared (the slot reads empty; 112 lets a player whose own
        -- kickoff is ahead take the empty slot — 114 retired the whole-week
        -- lock, so that is the only rule).
        -- IR keys are roster-level spots — cleared the same way.
        v_map := v_map - v_key;
        SELECT COALESCE(jsonb_agg(
                 CASE WHEN s ->> 'slot' = v_key
                      THEN s || jsonb_build_object('player_id', NULL, 'position', NULL, 'kickoff_at', NULL, 'flags', '["empty"]'::jsonb)
                      ELSE s END ORDER BY ord), '[]'::jsonb)
        INTO v_starters
        FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord);
        v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', v_key);
        v_changed := TRUE;
      END IF;
      IF v_bench ? p_drop THEN
        SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
        FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') <> p_drop;
        -- R758: a bench-only drop reports its row too (slot NULL) — the
        -- result never under-reports which lineup rows the move touched.
        IF v_key IS NULL THEN
          v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', NULL);
        END IF;
        v_changed := TRUE;
      END IF;
    END IF;
    IF p_add IS NOT NULL AND NOT (v_bench ? p_add) THEN
      SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
      FROM jsonb_array_elements(v_bench || to_jsonb(p_add)) x;
      v_changed := TRUE;
    END IF;
    IF v_changed THEN
      UPDATE public.team_lineups SET slot_map = v_map, starters = v_starters, bench = v_bench
      WHERE id = v_row.id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'roster_add_drop: lineup sync for week % touched % rows, expected 1', v_row.week, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  -- (8) POST-WRITE ASSERTIONS (R703-class; D294's mirror asserted).
  IF p_add IS NOT NULL THEN
    IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = p_add) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = p_add) THEN
      RAISE EXCEPTION 'roster_add_drop: after the add, % is not exactly once on %''s roster in league % — refusing', p_add, v_team.name, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = p_league_id AND pp.player_id = p_add) IS DISTINCT FROM 'rostered' THEN
      RAISE EXCEPTION 'roster_add_drop: the pool mirror for % is not rostered after the add (D294) — refusing', p_add
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_drop IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = p_drop) THEN
      RAISE EXCEPTION 'roster_add_drop: after the drop, % is still rostered in league % — refusing', p_drop, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = p_league_id AND pp.player_id = p_drop) IS DISTINCT FROM v_drop_to_state THEN
      RAISE EXCEPTION 'roster_add_drop: the pool mirror for % is not % after the drop (D294) — refusing', p_drop, v_drop_to_state
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  SELECT count(*)::int INTO v_cnt
  FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF v_cnt <> v_after_count OR v_cnt > v_roster_size THEN
    RAISE EXCEPTION 'roster_add_drop: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
      v_team.name, v_cnt, v_after_count, v_roster_size
      USING ERRCODE = 'P0001';
  END IF;

  -- THE RESULT = the transactions payload (returned byte-identically on replay).
  v_result := jsonb_build_object(
    'transaction_id',        v_txn_id,
    'action_id',             p_action_id,
    'league_id',             p_league_id,
    'team_id',               p_team_id,
    'season',                v_league.season,
    'week',                  v_current,
    'type',                  'add_drop',
    'add_player_id',         p_add,
    'drop_player_id',        p_drop,
    'add', CASE WHEN p_add IS NULL THEN NULL ELSE jsonb_build_object(
      'player_id',        p_add,
      'name',             v_add_p.full_name,
      'position',         v_add_p.position,
      'nfl_team',         v_add_p.team,
      'from_state',       v_pool_add_from,
      'to_state',         'rostered',
      'acquisition_type', 'free_agent',
      'slot_key',         'bn',
      'acquired_at',      p_at,
      'game_lock',        v_add_lock,
      'free_agency',      v_fa_window) END,
    'drop', CASE WHEN p_drop IS NULL THEN NULL ELSE jsonb_build_object(
      'player_id',        p_drop,
      'name',             v_drop_p.full_name,
      'position',         v_drop_p.position,
      'nfl_team',         v_drop_p.team,
      'from_slot_key',    v_drop_row.slot_key,
      'to_state',         v_drop_to_state,
      'waivers_until',    v_drop_until,
      'fa_hold', jsonb_build_object(
        'hours',            v_hold_hours,
        'acquisition_type', v_drop_row.acquisition_type,
        'acquired_at',      v_drop_row.acquired_at,
        'early',            v_hold_early),
      'lineups',          v_lineups,
      'game_lock',        v_drop_lock) END,
    'roster', jsonb_build_object(
      'count_after', v_after_count,
      'roster_size', v_roster_size),
    'caps', jsonb_build_object(
      'acquisitions_per_week',   v_cap_week_txt,
      'acquisitions_per_season', v_cap_season_txt,
      -- both counts are assigned for EVERY move (R763) — a drop-only reports
      -- the unchanged totals, never NULL.
      'used_week_after',   v_used_week   + CASE WHEN p_add IS NULL THEN 0 ELSE 1 END,
      'used_season_after', v_used_season + CASE WHEN p_add IS NULL THEN 0 ELSE 1 END),
    'settings', jsonb_build_object(
      'lineup_lock',         v_mode,
      'waiver_type',         v_waiver_type,
      'waiver_schedule',     v_sched,
      'fa_hold_hours',       v_hold_hours),
    'evaluated_at',          p_at
  );

  INSERT INTO public.transactions (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
  VALUES (v_txn_id, p_league_id, 'add_drop', 'complete', p_team_id, auth.uid(), v_result, v_current, p_action_id);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION roster_add_drop_internal(UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_roster_override_internal — CREATE OR REPLACE against
--    149:930-1916's FILE TEXT (D137), 3 hunks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_roster_override_internal(
  p_league_id    UUID,
  p_team_id      UUID,          -- force_add_drop's team (NULL for a move)
  p_add          TEXT,
  p_drop         TEXT,
  p_player_id    TEXT,          -- move's player (NULL for add/drop)
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_action_id    UUID,
  p_at           TIMESTAMPTZ,
  p_reason       TEXT,
  p_verb         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_found         BOOLEAN;
  v_is_move       BOOLEAN;
  v_result        JSONB;
  v_reason        TEXT;
  v_current       INTEGER;
  v_lw            public.league_weeks;
  v_week_status   TEXT;
  v_roster_size   INTEGER;
  v_hold_hours    INTEGER;
  v_sched         JSONB;         -- 149 (Q70): the league's waiver schedule
  v_fa_window     JSONB;         -- 149 (Q70): the free-agency window at p_at
  v_waiver_type   TEXT;
  v_cap_week_txt  TEXT;
  v_cap_season_txt TEXT;
  v_cap_week      INTEGER;
  v_cap_season    INTEGER;
  v_used_week     INTEGER;
  v_used_season   INTEGER;
  -- the normalized plan: who loses a player, who gains one
  v_lose_team     UUID;
  v_gain_team     UUID;
  v_lose_player   TEXT;
  v_gain_player   TEXT;
  v_lose_row      public.league_rosters;
  v_lose_p        public.players;
  v_gain_p        public.players;
  v_owner_team    public.teams;
  v_team_a        public.teams;         -- the move's FROM team / the add-drop team
  v_team_b        public.teams;         -- the move's TO team
  v_pool          public.league_player_pool;
  v_pool_from     TEXT;
  v_drop_to_state TEXT;
  v_drop_until    TIMESTAMPTZ;
  v_hold_early    BOOLEAN := FALSE;
  v_lose_lock     JSONB;
  v_gain_lock     JSONB;
  v_no_changes    BOOLEAN;
  v_audit_id      UUID;
  v_action_type   TEXT;
  v_arm           TEXT;
  v_bypassed      JSONB := '[]'::jsonb;
  v_affected      JSONB := '[]'::jsonb;
  v_lineups       JSONB := '[]'::jsonb;
  v_sync          JSONB;
  v_vacated       TEXT := NULL;
  v_ir_keys       TEXT[] := ARRAY[]::text[];   -- R1018: the league's BARE ir_slots keys
  v_txn_type      TEXT;                        -- R1017: the verb that already owns this action_id
  v_cap_team      UUID;                        -- R1022: the team the acquisition counts are ABOUT
  v_before        JSONB;
  v_before_drop   JSONB;
  v_after         JSONB;
  v_rescore       TEXT[] := ARRAY[]::text[];
  v_enqueued      JSONB := '[]'::jsonb;
  v_not_enq       JSONB := '[]'::jsonb;
  v_reach         TEXT[] := ARRAY[]::text[];
  v_reach_enq     JSONB := '[]'::jsonb;
  v_reachable     BOOLEAN := FALSE;
  v_unstamped     TEXT[] := ARRAY[]::text[];
  v_score_stale   BOOLEAN := FALSE;
  v_stale_why     TEXT := NULL;
  v_txn_id        UUID := gen_random_uuid();
  v_message       TEXT;
  v_cnt           INTEGER;
  v_count_a       INTEGER;
  v_count_b       INTEGER;
  v_exp_a         INTEGER;
  v_exp_b         INTEGER;
  v_week_end      TIMESTAMPTZ;   -- 152 / F437: the current week's last_game_ends_at
  v_from_week     INTEGER;       -- 152 / F437: the first unfinished week
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and is never answered with
  --     `no_changes: true` — a success document for a request that never said
  --     what it wanted is 126's rule, and it is this family's too.
  IF p_verb IS NULL OR p_verb NOT IN ('commish_move_player', 'commish_force_add_drop') THEN
    RAISE EXCEPTION
      'commish_roster_override_internal: p_verb must be commish_move_player or commish_force_add_drop (got %) — the internal is not a client door', COALESCE(p_verb, 'null')
      USING ERRCODE = '22023';
  END IF;
  v_is_move := (p_verb = 'commish_move_player');

  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      '%: p_action_id is required (idempotency key — one UUID per submit, reused on retry)', p_verb
      USING ERRCODE = '22023';
  END IF;

  IF v_is_move THEN
    IF p_player_id IS NULL OR p_from_team_id IS NULL OR p_to_team_id IS NULL THEN
      RAISE EXCEPTION
        '%: p_player_id, p_from_team_id and p_to_team_id are all required (§15.4:1694 — commish_move_player(player_id, from, to, reason))', p_verb
        USING ERRCODE = '22023';
    END IF;
    IF p_from_team_id = p_to_team_id THEN
      RAISE EXCEPTION
        '%: from and to name the same franchise (%) — a move changes which roster holds the player (§13.1)', p_verb, p_from_team_id
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_team_id IS NULL THEN
      RAISE EXCEPTION '%: p_team_id is required', p_verb USING ERRCODE = '22023';
    END IF;
    IF p_add IS NULL AND p_drop IS NULL THEN
      RAISE EXCEPTION
        '%: nothing to do — give a player to add, a player to drop, or both (§13.1); an override that names no player is not an override', p_verb
        USING ERRCODE = '22023';
    END IF;
    IF p_add IS NOT NULL AND p_add = p_drop THEN
      RAISE EXCEPTION '%: add and drop name the same player (%) — a move changes the roster (§13.1)', p_verb, p_add
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8; D294's one
  --     serialization point — the same one the manager's verb takes).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — COMMISSIONER ONLY, in-body, as ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5). This
  --     REPLACES the manager-only check at `115:416-426`; 115 keeps its own.
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION '%: not a commissioner of this league', p_verb
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), placed AFTER auth but BEFORE every business gate
  --     (123:602-609's placement), so a retry replays byte-identically even
  --     when the league has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_roster_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (3b) THE SECOND REPLAY KEY, GUARDED BY NAME (R1017; 115's R732 check at
  --      `115:429-443` is the mirror of this one, and it guards only its own
  --      direction). `uniq_transactions_league_action` (`113:283-285`) is a
  --      SHARED `(league_id, action_id)` namespace across the manager's verb
  --      and this one, so an action_id already spent on a `roster_add_drop`
  --      submit would otherwise reach (17)'s INSERT and escape as a raw 23505
  --      — a 500 at the client, because `mapInSeasonRpcError` has no 23505
  --      arm. This family's OWN ledger (step 3) has already answered every
  --      retry of THIS verb, so reaching here means a DIFFERENT verb owns the
  --      key: refuse by name and say which.
  SELECT t.type INTO v_txn_type
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
  IF FOUND THEN
    RAISE EXCEPTION
      '%: action_id % already names a "%" transaction in this league — an action_id identifies ONE submit of ONE verb (R732/R1017). Mint a new action_id for this override, or retry the verb that owns that one',
      p_verb, p_action_id, v_txn_type
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused. Absent or
  --     whitespace-only in the explicit E' \t\r\n' class (R745) ⇒ NULL
  --     (130 §0 stores it); otherwise trimmed, bounded at 500 below (the
  --     league_chat bound and the commissioner_actions CHECK). The 500
  --     check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      '%: the reason is % characters — at most 500 (the league_chat bound; §12.13)', p_verb, char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) LEAGUE / TEAMS / CALENDAR. Rosters do not exist before draft
  --     completion, which is what flips the status (066:823 / 086:448 /
  --     110:882), so the manager verb's season gate (115:449-453) binds here
  --     too — it is not a timing constraint on WHO may act, it is the absence
  --     of a subject.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      '%: league % is % — rosters change only while in_season or in playoffs (§13.1)', p_verb, p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team_a FROM public.teams t
  WHERE t.id = CASE WHEN v_is_move THEN p_from_team_id ELSE p_team_id END;
  IF NOT FOUND OR v_team_a.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb,
      CASE WHEN v_is_move THEN p_from_team_id ELSE p_team_id END, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_is_move THEN
    SELECT t.* INTO v_team_b FROM public.teams t WHERE t.id = p_to_team_id;
    IF NOT FOUND OR v_team_b.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb, p_to_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- A `retired` franchise is SEALED (spec:183 — "name/record frozen";
  -- §7.2.1). Under standing rule (i) this is a LEGALITY gate, not a timing
  -- one: a sealed franchise is not a place a roster move can land. F352.
  --
  -- R1020 — THE MESSAGE NAMES A DOOR THAT EXISTS, OR IT SAYS THAT NONE DOES.
  -- The first cut said *"Un-retire the franchise first"*. Measured by
  -- exhausting every `UPDATE … teams` in migrations 001-127 (eleven of them,
  -- `grep -n 'UPDATE public\.teams'`): the column's CHECK is
  -- `('active','orphaned','retired')`; **four statements across two functions
  -- write `'active'` and all four are guarded by the same
  -- `CASE WHEN status = 'orphaned' THEN 'active' ELSE status END`** — `seat_league_member_internal` (`062:282-285`, newest
  -- body `077:442-445`) and `remove_manager`'s successor arm (`063:903-906`,
  -- newest body `120:454-457`). **NOT ONE SITE READS `'retired'` AND WRITES
  -- ANYTHING ELSE.** So an ORPHANED franchise can be re-activated by a new
  -- owner claiming the seat, and a RETIRED one cannot be un-retired by any
  -- verb that exists — the remedy the first message named was a route to
  -- nowhere, which is the F351 posture ("route it, don't leave it") failing in
  -- its worst direction. The message now says the capability is missing rather
  -- than implying it exists, and offers the route that DOES exist. **F354**
  -- owns the gap; building the verb is not this task's scope.
  IF v_team_a.status = 'retired'
     OR (v_is_move AND v_team_b.status = 'retired') THEN
    RAISE EXCEPTION
      '%: a retired franchise is sealed — its roster and record are frozen (§7.2.1, spec:183). This is a legality gate and it binds the commissioner too (PROGRESS standing rule (i), F352). The franchise would have to be un-retired first, and NO VERB DOES THAT TODAY — every site that writes teams.status = active is guarded "WHEN status = orphaned", so nothing un-retires a franchise (F354). Until one exists, move these players to another franchise instead', p_verb
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      '%: league % has no league_weeks rows — no season calendar to place the move on (§12.17)', p_verb, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = v_current;
  IF NOT FOUND THEN
    -- LOUD, never a silent skip (§4 rule 15). `lineup_current_week_internal`
    -- derives the week FROM `league_weeks`, so its absence one statement later
    -- means the calendar changed under us — and a NULL status would make the
    -- whole scoring arm below fall through both its IFs and report nothing.
    RAISE EXCEPTION
      '%: league % has no league_weeks row for season % week % — the calendar moved under this transaction (§12.17)', p_verb, p_league_id, v_league.season, v_current
      USING ERRCODE = 'P0001';
  END IF;
  v_week_status := v_lw.status;

  -- Settings read exactly as 115:472-485 reads them.
  v_waiver_type  := COALESCE(v_league.waiver_type, 'faab');
  v_sched        := public.waiver_schedule_internal(v_league.settings, v_waiver_type);   -- 149: replaces the retired waiver_period_hours
  v_hold_hours   := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);
  v_cap_week_txt   := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_cap_season_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_cap_week   := CASE WHEN v_cap_week_txt   = 'unlimited' THEN NULL ELSE v_cap_week_txt::int   END;
  v_cap_season := CASE WHEN v_cap_season_txt = 'unlimited' THEN NULL ELSE v_cap_season_txt::int END;
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;
  -- R1018: the league's BARE `ir_slots` keys, in the scoring worker's own
  -- shape (`irKeysOf`, `score-week-worker.ts:397-407`). Passed to the lineup
  -- sync so an IR spot can never be mistaken for a vacated starting slot.
  SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[])
  INTO v_ir_keys
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) s
  WHERE COALESCE(s ->> 'key', '') <> '';

  -- The acquisition counts, hoisted here and assigned for EVERY call (R763 —
  -- 115:489-506 had to hoist them for exactly this reason: a branch that left
  -- them unassigned reported NULL to a capped league). They are read twice
  -- below — to decide whether a cap WOULD have refused (so `bypassed[]` names
  -- a real refusal and not a hypothetical one) and to report the league's own
  -- numbers back unchanged.
  --
  -- **THEY ARE COUNTED FOR THE TEAM THAT ACQUIRES, AND THE RECEIPT SAYS WHICH
  -- TEAM THAT IS (R1022).** An acquisition cap throttles the team a player
  -- ARRIVES on; the first cut counted `v_team_a`, which on a MOVE is the team
  -- the player LEAVES — so `caps.used_week_before` reported the wrong
  -- franchise's budget in a field the league is invited to read. On a move
  -- that is `v_team_b`; on an add/drop it is the one team named. `caps.team_id`
  -- is on the receipt so the number can never again be read against the wrong
  -- roster.
  v_cap_team := CASE WHEN v_is_move THEN v_team_b.id ELSE v_team_a.id END;
  SELECT count(*)::int INTO v_used_week
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = v_cap_team
    AND t.status = 'complete' AND t.week = v_current
    AND (t.payload ->> 'add_player_id') IS NOT NULL;
  SELECT count(*)::int INTO v_used_season
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = v_cap_team
    AND t.status = 'complete'
    AND (t.payload ->> 'add_player_id') IS NOT NULL;

  -- (6) THE PLAN, NORMALIZED. Both verbs reduce to "this team loses a player"
  --     and/or "that team gains one"; the writes below are then uniform.
  IF v_is_move THEN
    SELECT p.* INTO v_lose_p FROM public.players p WHERE p.id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: no player with id %', p_verb, p_player_id USING ERRCODE = 'P0001';
    END IF;
    v_gain_p := v_lose_p;
    SELECT r.* INTO v_lose_row FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % (%) is on no roster in league % — a move needs a source roster; to bring a free agent in, use commish_force_add_drop (§15.4:1695)',
        p_verb, v_lose_p.full_name, p_player_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_lose_row.team_id = p_to_team_id THEN
      -- THE NO-OP (see the banner): the requested END STATE already holds.
      v_lose_team := NULL; v_gain_team := NULL;
      v_lose_player := NULL; v_gain_player := NULL;
    ELSIF v_lose_row.team_id <> p_from_team_id THEN
      SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
      RAISE EXCEPTION
        '%: % (%) is on %''s roster, not %''s — neither the source nor the destination you named. Re-read the roster and send the move again with the right `from`',
        p_verb, v_lose_p.full_name, p_player_id, v_owner_team.name, v_team_a.name
        USING ERRCODE = 'P0001';
    ELSE
      v_lose_team   := p_from_team_id;
      v_gain_team   := p_to_team_id;
      v_lose_player := p_player_id;
      v_gain_player := p_player_id;
    END IF;
  ELSE
    -- ── force add / drop ────────────────────────────────────────────────────
    IF p_drop IS NOT NULL THEN
      SELECT p.* INTO v_lose_p FROM public.players p WHERE p.id = p_drop;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (drop)', p_verb, p_drop USING ERRCODE = 'P0001';
      END IF;
      SELECT r.* INTO v_lose_row FROM public.league_rosters r
      WHERE r.league_id = p_league_id AND r.player_id = p_drop;
      IF FOUND THEN
        IF v_lose_row.team_id <> p_team_id THEN
          SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
          RAISE EXCEPTION
            '%: % (%) is on %''s roster, not %''s — name the roster he is actually on, or move him with commish_move_player (§15.4:1694)',
            p_verb, v_lose_p.full_name, p_drop, v_owner_team.name, v_team_a.name
            USING ERRCODE = 'P0001';
        END IF;
        v_lose_team   := p_team_id;
        v_lose_player := p_drop;
      END IF;
      -- NOT FOUND ⇒ he is already on no roster in this league: the drop side's
      -- requested end state already holds (the banner's no-op rule).
    END IF;
    IF p_add IS NOT NULL THEN
      SELECT p.* INTO v_gain_p FROM public.players p WHERE p.id = p_add;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (add)', p_verb, p_add USING ERRCODE = 'P0001';
      END IF;
      -- EXCLUSIVITY (072:147's UNIQUE, CLAUDE.md business rule 7, §12.7) —
      -- A LEGALITY GATE, AND IT BINDS THE COMMISSIONER (standing rule (i)).
      -- Refused BY NAME and never silently converted into a move: the verb the
      -- commissioner wanted is the one the message names.
      SELECT t.* INTO v_owner_team
      FROM public.league_rosters r JOIN public.teams t ON t.id = r.team_id
      WHERE r.league_id = p_league_id AND r.player_id = p_add;
      IF FOUND AND v_owner_team.id <> p_team_id THEN
        RAISE EXCEPTION
          '%: % (%) is already on %''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7), and that binds a commissioner too: it is the shape of the game, not its timing (PROGRESS standing rule (i)). To take him off % and put him on %, use commish_move_player (§15.4:1694)',
          p_verb, v_gain_p.full_name, p_add, v_owner_team.name, v_owner_team.name, v_team_a.name
          USING ERRCODE = 'P0001';
      END IF;
      IF NOT FOUND THEN
        v_gain_team   := p_team_id;
        v_gain_player := p_add;
      END IF;
      -- FOUND and already on THIS team ⇒ the add side's end state holds.
    END IF;
  END IF;

  -- (7) THE NO-OP, DETECTED BY VALUE across every dimension this verb can
  --     change — which roster row exists and which team it names (D336 part 3,
  --     §4 rule 15). Never inferred from an empty write.
  v_no_changes := (v_lose_player IS NULL AND v_gain_player IS NULL);

  v_affected := CASE
    WHEN v_is_move THEN jsonb_build_array(p_from_team_id, p_to_team_id)
    ELSE jsonb_build_array(p_team_id) END;                       -- D353
  -- R1019 — THE AUDIT ROW DESCRIBES THE PLAN THAT EXECUTED, NEVER THE
  -- PARAMETERS THAT WERE SENT. The first cut keyed both on `p_add IS NOT
  -- NULL`, so a call whose ADD arm was a no-op (he is already on this roster)
  -- and whose DROP arm executed was stamped `action_type = 'force_add'` with
  -- `added_player_id` NULL — and tasks-M6A §5 calls this shape contractual
  -- *"so the activity feed can render them without a special case"*, which
  -- means the feed would render a pure drop as an add. Keyed on the NORMALIZED
  -- plan (`v_gain_player` / `v_lose_player`) the stamp is what happened.
  --
  -- The one place the PARAMETERS are still the honest answer is a total no-op:
  -- nothing executed, no audit row is written at all, and the returned
  -- document's job there is to say what was ASKED and that it changed nothing
  -- (`no_changes` + `no_changes_why` carry the rest).
  v_action_type := CASE
    WHEN v_is_move                 THEN 'move_player'
    WHEN v_no_changes              THEN CASE WHEN p_add IS NOT NULL THEN 'force_add' ELSE 'force_drop' END
    WHEN v_gain_player IS NOT NULL THEN 'force_add'
    ELSE 'force_drop' END;
  v_arm := CASE
    WHEN v_is_move    THEN 'move'
    WHEN v_no_changes THEN CASE
                             WHEN p_add IS NOT NULL AND p_drop IS NOT NULL THEN 'add+drop'
                             WHEN p_add IS NOT NULL THEN 'add'
                             ELSE 'drop' END
    WHEN v_gain_player IS NOT NULL AND v_lose_player IS NOT NULL THEN 'add+drop'
    WHEN v_gain_player IS NOT NULL THEN 'add'
    ELSE 'drop' END;

  IF NOT v_no_changes THEN
    -- (8) WHAT THIS OVERRIDE WALKS PAST, made legible (D336 part 7). Standing
    --     rule (g): the timing rules do not bind a commissioner. None of these
    --     is a refusal here — each is a receipt line, and each one is
    --     EVALUATED (not assumed) so the receipt is true as measured.
    IF v_lose_player IS NOT NULL THEN
      v_lose_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_lose_p.team, p_at);
      IF (v_lose_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_drop_lock:' || v_lose_player)::text);
      END IF;
    END IF;
    IF v_gain_player IS NOT NULL AND NOT v_is_move THEN
      v_gain_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_gain_p.team, p_at);
      IF (v_gain_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_add_lock:' || v_gain_player)::text);
      END IF;
      -- The waiver period (115:576-582) — a `when`, not a `what`.
      SELECT pp.* INTO v_pool FROM public.league_player_pool pp
      WHERE pp.league_id = p_league_id AND pp.player_id = v_gain_player;
      IF NOT FOUND THEN
        v_pool_from := 'free_agent';
      ELSE
        v_pool_from := v_pool.state;
        -- 149: a hold whose run is due but not yet settled is still a hold (E8).
        IF v_pool.state = 'on_waivers'
           AND (v_pool.waivers_until > p_at
                OR (v_league.waiver_next_run_at IS NOT NULL AND v_pool.waivers_until >= v_league.waiver_next_run_at)) THEN
          v_bypassed := v_bypassed || to_jsonb(('waiver_period:' || v_gain_player)::text);
        END IF;
        IF v_pool.state = 'rostered' THEN
          -- D294's BROKEN-MIRROR REFUSAL (115:589-595), carried verbatim: no
          -- roster row (checked above) but a `rostered` pool row means the
          -- mirror is broken. Asserted, not trusted — and it binds the
          -- commissioner because it is an integrity claim about the data, not
          -- a rule about who may act.
          RAISE EXCEPTION
            '%: league_player_pool says % (%) is rostered in league % but league_rosters has no row — the pool mirror is broken; refusing until reconciliation (L.D2.3) repairs it (D294)',
            p_verb, v_gain_p.full_name, v_gain_player, p_league_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      -- 149 (Q70): the league's free-agency window is a `when` too — outside
      -- it every unowned player is claim-only for a MANAGER; the commissioner
      -- walks past it (TD5) and the receipt NAMES it under the same
      -- `waiver_period:<player>` entry (one name for "not an instant pickup").
      v_fa_window := public.waiver_window_internal(v_league, p_at);
      IF NOT (v_fa_window ->> 'free_agency_open')::boolean
         AND NOT (v_bypassed @> to_jsonb(ARRAY['waiver_period:' || v_gain_player])) THEN
        v_bypassed := v_bypassed || to_jsonb(('waiver_period:' || v_gain_player)::text);
      END IF;
      -- The acquisition caps (115:621-632) — a league throttle. The counts
      -- were taken above (R763); only an ADD could ever have been refused by
      -- them, so only this branch reads them.
      IF v_cap_week IS NOT NULL AND v_used_week >= v_cap_week THEN
        v_bypassed := v_bypassed || to_jsonb('acquisitions_per_week'::text);
      END IF;
      IF v_cap_season IS NOT NULL AND v_used_season >= v_cap_season THEN
        v_bypassed := v_bypassed || to_jsonb('acquisitions_per_season'::text);
      END IF;
    ELSIF v_is_move AND v_gain_player IS NOT NULL THEN
      v_pool_from := 'rostered';
    END IF;

    -- (9) CAPACITY (§7.3.2 roster_size) — A LEGALITY GATE, and it binds the
    --     commissioner. The refusal names the remedy.
    SELECT count(*)::int INTO v_count_a
    FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_a.id;
    v_exp_a := v_count_a
             - CASE WHEN v_lose_team = v_team_a.id THEN 1 ELSE 0 END
             + CASE WHEN v_gain_team = v_team_a.id THEN 1 ELSE 0 END;
    IF v_is_move THEN
      SELECT count(*)::int INTO v_count_b
      FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_b.id;
      v_exp_b := v_count_b
               - CASE WHEN v_lose_team = v_team_b.id THEN 1 ELSE 0 END
               + CASE WHEN v_gain_team = v_team_b.id THEN 1 ELSE 0 END;
      IF v_exp_b > v_roster_size THEN
        RAISE EXCEPTION
          '%: %''s roster is full (% of % — §7.3.2 roster_size) — free a spot with commish_force_add_drop first. A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
          p_verb, v_team_b.name, v_count_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_exp_a > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster is full (% of % — §7.3.2 roster_size) — include a drop in the same move (§13.1). A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
        p_verb, v_team_a.name, v_count_a, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) THE BEFORE DOCUMENT, read before the writes (D353: `before`/`after`
    --      mirror each other key-for-key over THE ROW THAT CHANGED).
    --      `target_id` is the added or moved player when there is one, else
    --      the dropped one, and these two documents describe THAT player's
    --      `league_rosters` row. A combined add+drop's drop side is fully
    --      described in `metadata` (`drop_player_id`, `drop_before`,
    --      `drop_to_state`) rather than crammed into a shape that has room for
    --      one row — the audit row's headline is the row that arrived.
    v_before_drop := CASE WHEN v_lose_player IS NULL THEN NULL ELSE jsonb_build_object(
      'team_id',          v_lose_row.team_id,
      'slot_key',         v_lose_row.slot_key,
      'acquisition_type', v_lose_row.acquisition_type) END;
    v_before := CASE
      WHEN v_is_move                 THEN v_before_drop
      WHEN v_gain_player IS NOT NULL THEN jsonb_build_object('team_id', NULL, 'slot_key', NULL, 'acquisition_type', NULL)
      ELSE v_before_drop END;

    -- (11) THE WRITES.
    IF v_is_move THEN
      -- A MOVE is an UPDATE of the ONE roster row, so exclusivity is preserved
      -- BY CONSTRUCTION — there is never a second row to collide with
      -- (072:147). The IR stint is a property of the franchise the player is
      -- leaving, so it is cleared with him; acquisition_cost is 0 because a
      -- commissioner move is not a purchase (FAAB is M5's, F340).
      UPDATE public.league_rosters r
      SET team_id            = p_to_team_id,
          slot_key           = 'bn',
          acquisition_type   = 'commissioner',
          acquisition_cost   = 0,
          ir_placed_week     = NULL,
          ir_lock_until_week = NULL,
          acquired_at        = p_at
      WHERE r.league_id = p_league_id AND r.player_id = p_player_id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION '%: the move updated % roster rows for %, expected exactly 1', p_verb, v_cnt, p_player_id
          USING ERRCODE = 'P0001';
      END IF;
      -- The pool mirror stays `rostered` (he never left a roster); the stamp
      -- moves so the mirror's own freshness is not silently stale.
      INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
      VALUES (p_league_id, p_player_id, 'rostered', NULL, p_at)
      ON CONFLICT (league_id, player_id) DO UPDATE
        SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
    ELSE
      IF v_lose_player IS NOT NULL THEN
        -- fa_hold_hours (§7.3.4), 115:540-552 verbatim: an early drop of a
        -- free-agent add returns him to FA, not waivers. held >= hold ⇒
        -- waivers (the boundary is inclusive).
        v_hold_early := v_lose_row.acquisition_type = 'free_agent'
                        AND v_hold_hours > 0
                        AND v_lose_row.acquired_at IS NOT NULL
                        AND p_at < v_lose_row.acquired_at + make_interval(hours => v_hold_hours);
        IF v_hold_early OR v_waiver_type = 'none_fcfs' THEN
          v_drop_to_state := 'free_agent';
          v_drop_until := NULL;
        ELSE
          v_drop_to_state := 'on_waivers';
          v_drop_until := public.waiver_next_run_internal(v_sched, p_at);   -- 149 (Q70): until the next run
        END IF;
        DELETE FROM public.league_rosters r
        WHERE r.league_id = p_league_id AND r.team_id = v_lose_team AND r.player_id = v_lose_player;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION '%: the drop of % deleted % roster rows, expected 1', p_verb, v_lose_player, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
        VALUES (p_league_id, v_lose_player, v_drop_to_state, v_drop_until, p_at)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
      END IF;
      IF v_gain_player IS NOT NULL THEN
        BEGIN
          INSERT INTO public.league_rosters
            (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
          VALUES (p_league_id, v_gain_team, v_gain_player, 'bn', 'commissioner', 0, p_at);
        EXCEPTION WHEN unique_violation THEN
          -- 072's UNIQUE, kept as an UNPINNABLE backstop (R757/D276, 115's
          -- posture): the league row lock in (1) serializes every racer behind
          -- the exclusivity pre-check, so this branch is unreachable in
          -- practice — it exists so a raw 23505 can never reach the wire if
          -- that lock is ever weakened.
          RAISE EXCEPTION
            '%: % (%) was rostered by another team in this league a moment ago — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
            p_verb, v_gain_p.full_name, v_gain_player
            USING ERRCODE = 'P0001';
        END;
        INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
        VALUES (p_league_id, v_gain_player, 'rostered', NULL, p_at)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
      END IF;
    END IF;

    -- (12) THE LINEUP CONSEQUENCE, and the eviction that carries the score
    --      signal with it (D346). Every week from the first UNFINISHED one on
    --      (152 / F437), for both sides of a move. `p_current` stays the
    --      current week: once it is finished the sync never visits it, so
    --      nothing is vacated and nothing re-scores a finished week.
    -- F437: the first UNFINISHED week is the current week while its last
    -- game has not ended, the next one once it has (151's trade executor's
    -- rule, D410(5)). A finished week's lineup is
    -- the record the score worker and the nightly reconcile score it from
    -- (score-week-worker.ts step 5 reads THE WEEK's slot_map), and stat
    -- corrections re-score it until its window closes — clearing a played
    -- starter from it would erase his points from the team that played him.
    SELECT w.last_game_ends_at INTO v_week_end FROM public.nfl_weeks w
    WHERE w.season = v_league.season AND w.week = v_current;
    v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;
    v_sync := public.commish_roster_lineup_sync_internal(
      p_league_id, v_team_a.id, v_league.season, v_from_week, v_current,
      CASE WHEN v_lose_team = v_team_a.id THEN v_lose_player END,
      CASE WHEN v_gain_team = v_team_a.id THEN v_gain_player END,
      v_ir_keys);
    v_lineups := v_lineups || jsonb_build_object('team_id', v_team_a.id, 'rows', v_sync -> 'rows');
    v_vacated := v_sync ->> 'vacated_current_slot';
    IF v_is_move THEN
      v_sync := public.commish_roster_lineup_sync_internal(
        p_league_id, v_team_b.id, v_league.season, v_from_week, v_current,
        CASE WHEN v_lose_team = v_team_b.id THEN v_lose_player END,
        CASE WHEN v_gain_team = v_team_b.id THEN v_gain_player END,
        v_ir_keys);
      v_lineups := v_lineups || jsonb_build_object('team_id', v_team_b.id, 'rows', v_sync -> 'rows');
      v_vacated := COALESCE(v_vacated, v_sync ->> 'vacated_current_slot');
    END IF;

    -- (13) POST-WRITE ASSERTIONS (R703-class; D294's mirror asserted —
    --      115:732-753's shape, extended to both sides of a move).
    IF v_gain_player IS NOT NULL THEN
      IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = v_gain_player) <> 1
         OR NOT EXISTS (SELECT 1 FROM public.league_rosters r
                        WHERE r.league_id = p_league_id AND r.team_id = v_gain_team AND r.player_id = v_gain_player) THEN
        RAISE EXCEPTION '%: after the write, % is not exactly once on the destination roster in league % — refusing', p_verb, v_gain_player, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      IF (SELECT pp.state FROM public.league_player_pool pp
          WHERE pp.league_id = p_league_id AND pp.player_id = v_gain_player) IS DISTINCT FROM 'rostered' THEN
        RAISE EXCEPTION '%: the pool mirror for % is not rostered after the write (D294) — refusing', p_verb, v_gain_player
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_lose_player IS NOT NULL AND NOT v_is_move THEN
      IF EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = v_lose_player) THEN
        RAISE EXCEPTION '%: after the drop, % is still rostered in league % — refusing', p_verb, v_lose_player, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      IF (SELECT pp.state FROM public.league_player_pool pp
          WHERE pp.league_id = p_league_id AND pp.player_id = v_lose_player) IS DISTINCT FROM v_drop_to_state THEN
        RAISE EXCEPTION '%: the pool mirror for % is not % after the drop (D294) — refusing', p_verb, v_lose_player, v_drop_to_state
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    SELECT count(*)::int INTO v_cnt
    FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_a.id;
    IF v_cnt <> v_exp_a OR v_cnt > v_roster_size THEN
      RAISE EXCEPTION '%: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
        p_verb, v_team_a.name, v_cnt, v_exp_a, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
    IF v_is_move THEN
      SELECT count(*)::int INTO v_cnt
      FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_b.id;
      IF v_cnt <> v_exp_b OR v_cnt > v_roster_size THEN
        RAISE EXCEPTION '%: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
          p_verb, v_team_b.name, v_cnt, v_exp_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (14) THE SCORE (D346). The starter set of the CURRENT week changed
    --      exactly when the losing side's player occupied a slot in it — which
    --      is MEASURED by the sync helper and returned, not assumed. An added
    --      player lands on the BENCH and so is never in the symmetric
    --      difference; the assertion that keeps that true is (12)'s own
    --      post-write check. Read SCORING in the banner before touching the
    --      stamp.
    IF v_vacated IS NOT NULL THEN
      v_rescore := ARRAY[v_lose_player];
    END IF;
    IF array_length(v_rescore, 1) > 0 AND v_week_status IN ('live', 'correction_window') THEN
      -- A CHANGED STARTER IS QUEUED ONLY IF THIS LEAGUE STILL ROSTERS HIM
      -- (F353). The worker maps a queued player to leagues through
      -- `league_rosters`, so a row for a player nobody rosters is consumed with
      -- `report.unmapped += 1` and deleted having done nothing — it is not a
      -- queue poison (measured: `toDelete.push(row)`), but it is a row that
      -- claims to chase a score it cannot reach, and `score_enqueued` would
      -- then mean less than it says. He is NAMED `unrostered` below instead.
      INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
      SELECT v_league.season, v_current, ps.player_id, min(ps.updated_at)
      FROM public.player_stats ps
      WHERE ps.season = v_league.season AND ps.week = v_current
        AND ps.player_id = ANY (v_rescore)
        AND ps.updated_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.league_rosters r
                    WHERE r.league_id = p_league_id AND r.player_id = ps.player_id)
      GROUP BY ps.player_id
      ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row

      -- (14b) THE REACH SET — AND THE REASON IT HAS TO EXIST IS A DIFFERENCE
      --       BETWEEN THIS VERB AND 123's, MEASURED RATHER THAN ASSUMED
      --       (F353). The worker maps a queued player to LEAGUES through the
      --       roster index — its own docblock, step 3: *"ready players →
      --       leagues through `idx_league_rosters_player` … The LEAGUE comes
      --       from the roster index"* — and the query behind it is
      --       `readRosterLeagues`, a read of `league_rosters` filtered to the
      --       season's `in_season|playoffs` leagues.
      --
      --       `commish_edit_lineup` never hits this, because the player it
      --       benches STAYS ON THE ROSTER: he maps to the league, the drain
      --       visits the league-week, and `edited_by_commish` then forces the
      --       team. **A force-DROP deletes the roster row**, so the very row
      --       this verb queues maps to NO league and the drain never arrives —
      --       the enqueue is consumed having reached nothing and the stored
      --       points keep the dropped player, for ever. That is 123's own
      --       failure one layer out, and D346 did not anticipate it because it
      --       was written from the lineup verb's case.
      --
      --       So the verb ALSO queues players the league STILL rosters, drawn
      --       from the affected teams' remaining rosters. They are not there to
      --       be re-scored for their own sake — the drain recomputes every
      --       starter of an affected team through `extraStats` anyway — they
      --       are there to make the drain VISIT this league-week at all. Each
      --       carries its OWN stamp and `ON CONFLICT DO NOTHING`, so a healthy
      --       existing row is never re-stamped and the set costs at most
      --       `roster_size` rows per touched team — plus the CROSS-LEAGUE
      --       fan-out named in the banner (R1023): the queue is keyed
      --       `(season, week, player_id)` with no league column, so these rows
      --       re-drain these players for every other in-season league that
      --       rosters them. Idempotent, and deliberately not narrowed here.
      SELECT COALESCE(array_agg(DISTINCT r.player_id), ARRAY[]::text[]) INTO v_reach
      FROM public.league_rosters r
      WHERE r.league_id = p_league_id
        AND r.team_id IN (v_team_a.id, COALESCE(v_team_b.id, v_team_a.id))
        AND NOT (r.player_id = ANY (v_rescore));
      IF array_length(v_reach, 1) > 0 THEN
        INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
        SELECT v_league.season, v_current, ps.player_id, min(ps.updated_at)
        FROM public.player_stats ps
        WHERE ps.season = v_league.season AND ps.week = v_current
          AND ps.player_id = ANY (v_reach)
          AND ps.updated_at IS NOT NULL
        GROUP BY ps.player_id
        ON CONFLICT (season, week, player_id) DO NOTHING;
        SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_reach_enq
        FROM unnest(v_reach) x
        WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                      WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      END IF;
      -- WHAT THIS FIELD MEANS (123:1088-1092): "a claimable queue row EXISTS
      -- for him", not "this statement inserted one". An untouched healthy row
      -- left by ON CONFLICT drains just as well — but a player the INSERT
      -- could not queue is NEVER folded into silence.
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_enqueued
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                    WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      -- R968 — `player_stats.updated_at` is NULLABLE, so a partial ingestion
      -- can leave a scoreable line the enqueue cannot stamp. Named, never
      -- dropped silently.
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_unstamped
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.season = v_league.season AND ps.week = v_current AND ps.player_id = x)
        AND NOT EXISTS (SELECT 1 FROM public.player_stats ps
                        WHERE ps.season = v_league.season AND ps.week = v_current AND ps.player_id = x
                          AND ps.updated_at IS NOT NULL);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'player_id', x,
               'why', CASE
                 WHEN NOT EXISTS (SELECT 1 FROM public.league_rosters r
                                  WHERE r.league_id = p_league_id AND r.player_id = x)
                   THEN 'unrostered'
                 WHEN x = ANY (v_unstamped) THEN 'stats_unstamped'
                 ELSE 'no_stat_row' END) ORDER BY x), '[]'::jsonb)
      INTO v_not_enq
      FROM unnest(v_rescore) x
      WHERE NOT EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      -- (14c) REACHABILITY, MEASURED AFTER THE WRITES AND NEVER INFERRED: is
      --       there a queued player for this season-week that THIS league
      --       still rosters? That is the exact predicate the worker's map
      --       evaluates, asked of the state this transaction is about to
      --       commit. If the answer is no, the lineup moved and the score
      --       CANNOT follow — the one thing this verb must never report as
      --       success (F353).
      SELECT EXISTS (
        SELECT 1 FROM public.score_fanout f
        JOIN public.league_rosters r
          ON r.player_id = f.player_id AND r.league_id = p_league_id
        WHERE f.season = v_league.season AND f.week = v_current)
      INTO v_reachable;

      -- An `unrostered` changed starter is NOT stale, and the reason is the
      -- mechanism rather than an opinion: the drop's score does not follow
      -- from HIS queue row at all — it follows from the team being recomputed
      -- (reachable + `edited_by_commish`) against the CURRENT lineup, which no
      -- longer contains him. What WOULD be stale is a league-week the drain
      -- cannot reach, and that is the arm below.
      IF NOT v_reachable THEN
        v_score_stale := TRUE;
        v_stale_why   := 'unreachable';
      ELSIF array_length(v_unstamped, 1) > 0 THEN
        v_score_stale := TRUE;
        v_stale_why   := 'stats_unstamped';
      END IF;
    ELSIF array_length(v_rescore, 1) > 0 AND v_week_status = 'final' THEN
      -- The write door raises `week_final` (119:566-568) and the worker
      -- consumes the queue row with no cell changed — an enqueue here would
      -- delete itself having done nothing. Say so instead.
      v_score_stale := TRUE;
      v_stale_why   := 'week_final';
    END IF;
    -- `upcoming`: nothing has been scored yet, so there is nothing stale. A
    -- move that vacated no CURRENT-week slot changes no starter set at all, so
    -- there is no score to chase and a `score_stale` there would be a false
    -- alarm in the one field whose whole job is to be believed (R969).

    -- (15) THE RECEIPT (§10.3, §15.4:1690). Exactly one audit row, in THIS
    --      transaction, INSIDE the no-op guard and AFTER the state write —
    --      D336 part (2) in its plain order, because nothing here forces
    --      126's inversion: no trigger guards these tables and the only FK to
    --      `commissioner_actions` is the `transactions` row written BELOW.
    v_after := CASE
      WHEN v_gain_player IS NOT NULL THEN jsonb_build_object(
        'team_id', v_gain_team, 'slot_key', 'bn', 'acquisition_type', 'commissioner')
      ELSE jsonb_build_object('team_id', NULL, 'slot_key', NULL, 'acquisition_type', NULL) END;
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), v_action_type, 'player',
      COALESCE(v_gain_player, v_lose_player), v_reason,
      v_before, v_after,
      jsonb_build_object(
        'verb',                p_verb,
        'arm',                 v_arm,
        'season',              v_league.season,
        'current_week',        v_current,
        'week_status',         v_week_status,
        'action_id',           p_action_id,
        'affected_team_ids',   v_affected,                 -- D353
        'from_team_id',        v_lose_team,
        'to_team_id',          v_gain_team,
        'from_team_name',      CASE WHEN v_lose_team = v_team_a.id THEN v_team_a.name
                                    WHEN v_is_move AND v_lose_team = v_team_b.id THEN v_team_b.name END,
        'to_team_name',        CASE WHEN v_gain_team = v_team_a.id THEN v_team_a.name
                                    WHEN v_is_move AND v_gain_team = v_team_b.id THEN v_team_b.name END,
        'add_player_id',       v_gain_player,
        'drop_player_id',      v_lose_player,
        'drop_before',         v_before_drop,
        'drop_to_state',       v_drop_to_state,
        'player_name',         COALESCE(v_gain_p.full_name, v_lose_p.full_name),
        'transaction_id',      v_txn_id,
        -- The whole point of the verb, made legible: every rule this override
        -- walked past, with the lock documents that prove each claim.
        'bypassed',            v_bypassed,
        'drop_game_lock',      v_lose_lock,
        'add_game_lock',       v_gain_lock,
        'lineups',             v_lineups,
        'score_enqueued',      v_enqueued,
        'score_not_enqueued',  v_not_enq,
        'score_reach_enqueued', v_reach_enq,
        'score_reachable',     v_reachable,
        'score_stale',         v_score_stale,
        'score_stale_reason',  v_stale_why),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION '%: the audit row was not written — refusing to let the roster move stand without its receipt (§10.3)', p_verb
        USING ERRCODE = 'P0001';
    END IF;

    -- (16) §10.3: override system messages auto-post to league chat and CANNOT
    --      be disabled. D97/D290's in-txn post, worded as the roster override.
    v_message := CASE WHEN v_is_move
      THEN v_lose_p.full_name || ' moved from ' || v_team_a.name || ' to ' || v_team_b.name
      ELSE v_team_a.name || ': '
           || CASE WHEN v_gain_player IS NOT NULL THEN 'added ' || v_gain_p.full_name ELSE '' END
           || CASE WHEN v_gain_player IS NOT NULL AND v_lose_player IS NOT NULL THEN ', ' ELSE '' END
           || CASE WHEN v_lose_player IS NOT NULL THEN 'dropped ' || v_lose_p.full_name ELSE '' END
      END
      || ' by ' || public.draft_actor_name() || ' (commissioner override'
      || CASE WHEN jsonb_array_length(v_bypassed) > 0
              THEN ', ' || jsonb_array_length(v_bypassed) || ' rule'
                   || CASE WHEN jsonb_array_length(v_bypassed) = 1 THEN '' ELSE 's' END || ' bypassed'
              ELSE '' END
      || ')'
      || CASE WHEN v_vacated IS NOT NULL
              THEN ' — a week-' || v_current || ' starting slot was emptied'
              ELSE '' END
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   p_verb,
    'action_type',            v_action_type,
    'arm',                    v_arm,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'week',                   v_current,
    'week_status',            v_week_status,
    'team_id',                CASE WHEN v_is_move THEN p_to_team_id ELSE p_team_id END,
    'from_team_id',           CASE WHEN v_is_move THEN p_from_team_id ELSE NULL END,
    'to_team_id',             CASE WHEN v_is_move THEN p_to_team_id ELSE NULL END,
    'player_id',              p_player_id,
    'add_player_id',          CASE WHEN v_is_move THEN NULL ELSE p_add END,
    'drop_player_id',         CASE WHEN v_is_move THEN NULL ELSE p_drop END,
    'moved_player_id',        CASE WHEN v_is_move THEN v_gain_player ELSE NULL END,
    'added_player_id',        CASE WHEN v_is_move THEN NULL ELSE v_gain_player END,
    'dropped_player_id',      CASE WHEN v_is_move THEN NULL ELSE v_lose_player END,
    'drop_to_state',          v_drop_to_state,
    'drop_waivers_until',     v_drop_until,
    'pool_from_state',        v_pool_from,
    'acquisition_type',       CASE WHEN v_gain_player IS NULL THEN NULL ELSE 'commissioner' END,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                CASE WHEN v_is_move
                                  THEN 'already_on_destination — the requested end state already held, so nothing was written and no receipt was issued (PROGRESS standing rule (b))'
                                  ELSE 'end_state_already_held — the add is already on this roster and/or the drop is already on none, so nothing was written and no receipt was issued (PROGRESS standing rule (b))'
                                END END,
    'commissioner_action_id', v_audit_id,      -- NULL on a no-op, and that is the point
    'transaction_id',         CASE WHEN v_no_changes THEN NULL ELSE v_txn_id END,
    'affected_team_ids',      v_affected,      -- D353
    'bypassed',               v_bypassed,
    'drop_game_lock',         v_lose_lock,
    'add_game_lock',          v_gain_lock,
    'lineups',                v_lineups,
    'vacated_current_slot',   v_vacated,
    'roster', jsonb_build_object(
      'roster_size',   v_roster_size,
      'count_after_a', CASE WHEN v_no_changes THEN NULL ELSE v_exp_a END,
      'count_after_b', CASE WHEN v_no_changes OR NOT v_is_move THEN NULL ELSE v_exp_b END),
    'caps', jsonb_build_object(
      'acquisitions_per_week',   v_cap_week_txt,
      'acquisitions_per_season', v_cap_season_txt,
      -- STATED, NOT DISCOVERED (§4 rule 15): 115:497-506 counts a team's
      -- acquisitions by `initiator_team_id`, and D353's shape writes that
      -- column NULL — so a commissioner force-add neither obeys the cap nor
      -- consumes it. Said here so a league reading its own budget is not
      -- surprised by a number that did not move.
      'commissioner_move_not_counted', TRUE,
      -- R1022: WHOSE counts these are, said in the document. A cap throttles
      -- the ACQUIRING team, which on a move is the destination — not v_team_a.
      'team_id',            v_cap_team,
      'used_week_before',   v_used_week,
      'used_season_before', v_used_season),
    'score_enqueued',         v_enqueued,
    'score_not_enqueued',     v_not_enq,
    -- F353: the players queued ONLY so the drain REACHES this league-week,
    -- because the worker maps a queued player to leagues through
    -- `league_rosters` and a DROPPED player maps to none. `score_reachable` is
    -- the measured answer to that question, not an inference from the above.
    'score_reach_enqueued',   v_reach_enq,
    'score_reachable',        v_reachable,
    'score_stale',            v_score_stale,
    'score_stale_reason',     v_stale_why,
    'edited_by_commish',      NOT v_no_changes,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at);

  IF NOT v_no_changes THEN
    -- (17) THE TRANSACTIONS ROW — §12.9's unified in-season activity log, and
    --      the FIRST writer of `related_action_id` (109:239-250; the FK landed
    --      at 123:461-462). `initiator_team_id` is NULL because no TEAM
    --      initiated this, which is the column's documented meaning and is
    --      also what keeps the move out of the team's acquisition count.
    --      Written after the receipt because it REFERENCES it.
    INSERT INTO public.transactions
      (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id, related_action_id)
    VALUES (v_txn_id, p_league_id, 'commissioner_move', 'complete', NULL, auth.uid(), v_result, v_current, p_action_id, v_audit_id);
  END IF;

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266's
  -- posture): an action_id is consumed by its submit whether or not anything
  -- moved, so a retry replays instead of re-evaluating. This is the OPPOSITE
  -- rule from the audit row above, and deliberately so — §12.26: "an action_id
  -- is an idempotency key, not an audit record".
  INSERT INTO public.commish_roster_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, CASE WHEN v_is_move THEN p_to_team_id ELSE p_team_id END, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_roster_override_internal(UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. process_waivers_internal — CREATE OR REPLACE against 150:721-1261's
--    FILE TEXT (D137), 3 hunks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_waivers_internal(p_league_id UUID, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_type        TEXT;
  v_sched       JSONB;
  v_run_at      TIMESTAMPTZ;
  v_next        TIMESTAMPTZ;
  v_current     INTEGER;
  v_week_end    TIMESTAMPTZ;   -- 152 / F437: the current week's last_game_ends_at
  v_from_week   INTEGER;       -- 152 / F437: the first unfinished week
  v_tb          TEXT;
  v_size        INTEGER;
  v_capw_txt    TEXT;
  v_caps_txt    TEXT;
  v_hold_hours  INTEGER;
  v_persists    BOOLEAN;
  v_teams       JSONB;
  v_claims      JSONB;
  v_draft_raw   JSONB;
  v_draft       JSONB := '[]'::jsonb;
  v_st          JSONB;
  v_standings   JSONB := 'null'::jsonb;
  v_rolling     JSONB := 'null'::jsonb;
  v_locked      JSONB;
  v_input       JSONB;
  v_result      JSONB;
  v_o           JSONB;
  v_t           JSONB;
  v_x           JSONB;
  v_live        public.teams;
  v_depth       INTEGER;
  v_claim       public.waiver_claims;
  v_winners     JSONB := '{}'::jsonb;
  v_spent       INTEGER;
  v_before      INTEGER;
  v_after       INTEGER;
  v_drop_row    public.league_rosters;
  v_drop_p      public.players;
  v_add_p       public.players;
  v_pool        public.league_player_pool;
  v_pool_from   TEXT;
  v_drop_state  TEXT;
  v_drop_until  TIMESTAMPTZ;
  v_hold_early  BOOLEAN;
  v_txn_id      UUID;
  v_lineups     JSONB;
  v_row         public.team_lineups;
  v_map         JSONB;
  v_key         TEXT;
  v_starters    JSONB;
  v_bench       JSONB;
  v_changed     BOOLEAN;
  v_cnt         INTEGER;
  v_n           INTEGER := 0;
  v_won         INTEGER := 0;
  v_lost        INTEGER := 0;
  v_invalid     INTEGER := 0;
  v_faab_spent  INTEGER := 0;
  v_notified    INTEGER := 0;
  v_run_id      UUID;
  v_summary     JSONB;
BEGIN
  IF p_league_id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'process_waivers: p_league_id and p_at are required (p_at is the TimeProvider seam — no clock is read here)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) THE LEAGUE ROW FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_waivers: league % not found', p_league_id USING ERRCODE = 'P0002';
  END IF;

  -- (2) WHY NOTHING MIGHT HAPPEN — each answered by name (rule 5).
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'skipped',
      'why', 'league_not_in_season — the league is ' || v_league.status || '; waivers run only in season or in the playoffs (§13.2)',
      'evaluated_at', p_at);
  END IF;
  v_type := COALESCE(v_league.waiver_type, 'faab');

  IF v_type = 'none_fcfs' THEN
    -- F421(e) — DECIDED HERE: a claim left pending by a switch to "no
    -- waivers" can never be settled (there is no run), and every unowned
    -- player is now an instant pickup, so the claim CLOSES: `invalid` /
    -- `no_waivers`, nothing spent, its owner told; the pending run is
    -- cleared (149's setting verb clears it too — this is the backstop for
    -- every other writer of waiver_type).
    FOR v_claim IN
      SELECT c.* FROM public.waiver_claims c
      WHERE c.league_id = p_league_id AND c.status = 'pending'
      ORDER BY c.id
      FOR UPDATE
    LOOP
      UPDATE public.waiver_claims c
      SET status = 'invalid', result_reason = 'no_waivers', processed_at = p_at
      WHERE c.id = v_claim.id AND c.status = 'pending';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'process_waivers: closing claim % touched % rows, expected 1', v_claim.id, v_cnt USING ERRCODE = 'P0001';
      END IF;
      v_invalid := v_invalid + 1;
      IF public.waiver_claim_notify_internal(v_league, v_claim, 'invalid', 'no_waivers', '{}'::jsonb) IS NOT NULL THEN
        v_notified := v_notified + 1;
      END IF;
    END LOOP;
    UPDATE public.leagues SET waiver_next_run_at = NULL
    WHERE id = p_league_id AND waiver_next_run_at IS NOT NULL;
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'no_waivers',
      'claims_closed', v_invalid, 'notified', v_notified,
      'why', CASE WHEN v_invalid = 0 THEN 'no_waivers — the league has no waivers and no claim was pending'
                  ELSE 'no_waivers — the league switched to no waivers; its pending claims closed as no_waivers (F421(e))' END,
      'evaluated_at', p_at);
  END IF;

  v_sched := public.waiver_schedule_internal(v_league.settings, v_type);
  IF v_league.waiver_next_run_at IS NULL THEN
    -- F423: the first tick TRACKS the league from its next scheduled run;
    -- nothing is decided now (claims placed before it settle at that run).
    v_next := public.waiver_next_run_internal(v_sched, p_at);
    UPDATE public.leagues SET waiver_next_run_at = v_next WHERE id = p_league_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 OR v_next IS NULL THEN
      RAISE EXCEPTION 'process_waivers: seeding league %''s next run wrote % rows (next run %) — expected one row and an instant', p_league_id, v_cnt, v_next
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'seeded', 'next_run_at', v_next,
      'why', 'untracked — the processor now tracks this league from its next scheduled run (F423); nothing was decided',
      'evaluated_at', p_at);
  END IF;
  IF v_league.waiver_next_run_at > p_at THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'not_due', 'next_run_at', v_league.waiver_next_run_at,
      'why', 'not_due — the next waiver run is still ahead', 'evaluated_at', p_at);
  END IF;
  v_run_at := v_league.waiver_next_run_at;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'process_waivers: league % has no league_weeks rows — no season calendar to evaluate locks and caps against (§12.17)', p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  -- F437: the first UNFINISHED week is the current week while its last
  -- game has not ended, the next one once it has (151's trade executor's
  -- rule, D410(5)). A finished week's lineup is
  -- the record the score worker and the nightly reconcile score it from
  -- (score-week-worker.ts step 5 reads THE WEEK's slot_map), and stat
  -- corrections re-score it until its window closes — clearing a played
  -- starter from it would erase his points from the team that played him.
  SELECT w.last_game_ends_at INTO v_week_end FROM public.nfl_weeks w
  WHERE w.season = v_league.season AND w.week = v_current;
  v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;

  -- (3) THE INPUT.
  v_tb := COALESCE(v_league.settings ->> 'faab_tiebreaker', 'reverse_standings');
  v_persists := v_type = 'rolling_priority' OR (v_type = 'faab' AND v_tb = 'rolling_priority');
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_size;                                                   -- 115's capacity, exactly
  v_capw_txt := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_caps_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_hold_hours := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);

  PERFORM 1 FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending' FOR UPDATE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'teamId', t.id::text,
           'roster', COALESCE((SELECT jsonb_agg(r.player_id ORDER BY r.player_id COLLATE "C")
                               FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = t.id), '[]'::jsonb),
           'faabBalance', (SELECT m.faab_balance FROM public.league_members m WHERE m.league_id = p_league_id AND m.team_id = t.id),
           'acquisitionsWeek', (SELECT count(*)::int FROM public.transactions x
                                WHERE x.league_id = p_league_id AND x.initiator_team_id = t.id AND x.status = 'complete'
                                  AND x.week = v_current AND (x.payload ->> 'add_player_id') IS NOT NULL),
           'acquisitionsSeason', (SELECT count(*)::int FROM public.transactions x
                                  WHERE x.league_id = p_league_id AND x.initiator_team_id = t.id AND x.status = 'complete'
                                    AND (x.payload ->> 'add_player_id') IS NOT NULL),
           'retired', t.status = 'retired') ORDER BY t.id::text COLLATE "C"), '[]'::jsonb)
  INTO v_teams
  FROM public.teams t WHERE t.league_id = p_league_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'claimId', c.id::text, 'teamId', c.team_id::text, 'addPlayerId', c.add_player_id,
           'dropPlayerId', c.drop_player_id, 'faabBid', c.faab_bid, 'claimOrder', c.claim_order)
           ORDER BY c.id::text COLLATE "C"), '[]'::jsonb)
  INTO v_claims
  FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending';

  -- The round-1 order as drafted (draft_order is the resolved order for
  -- every draft type — 098's draft_start writes it for an auction too),
  -- each franchise mapped to the live one its successor chain leads to.
  SELECT d.draft_order INTO v_draft_raw
  FROM public.drafts d
  WHERE d.league_id = p_league_id AND NOT d.is_mock AND d.status = 'complete'
  ORDER BY d.completed_at DESC NULLS LAST, d.id
  LIMIT 1;
  FOR v_x IN SELECT e FROM jsonb_array_elements(COALESCE(v_draft_raw, '[]'::jsonb)) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = (v_x #>> '{}')::uuid;
    v_depth := 0;
    WHILE FOUND AND v_live.status = 'retired' AND v_live.successor_team_id IS NOT NULL AND v_depth < 64 LOOP
      SELECT t.* INTO v_live FROM public.teams t WHERE t.id = v_live.successor_team_id;
      v_depth := v_depth + 1;
    END LOOP;
    v_draft := v_draft || jsonb_build_array(COALESCE(v_live.id::text, v_x #>> '{}'));
  END LOOP;

  IF NOT v_persists THEN
    v_st := public.league_standings_internal(p_league_id, FALSE);
    IF COALESCE((v_st ->> 'weeks_final')::int, 0) > 0 THEN
      SELECT COALESCE(jsonb_agg(s -> 'team_id' ORDER BY (s ->> 'rank')::int, s ->> 'team_id'), '[]'::jsonb)
      INTO v_standings
      FROM jsonb_array_elements(v_st -> 'standings') s;
    END IF;
  ELSE
    SELECT jsonb_object_agg(m.team_id::text, m.waiver_priority) INTO v_rolling
    FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.team_id IS NOT NULL AND m.waiver_priority IS NOT NULL;
    v_rolling := COALESCE(v_rolling, 'null'::jsonb);
  END IF;

  WITH claim_players AS (
    SELECT c.add_player_id AS pid FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending'
    UNION
    SELECT c.drop_player_id FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending' AND c.drop_player_id IS NOT NULL
  ), nfl AS (
    SELECT DISTINCT p.team FROM public.players p JOIN claim_players cp ON cp.pid = p.id WHERE p.team IS NOT NULL
  ), locked_nfl AS (
    SELECT n.team FROM nfl n
    WHERE (public.pool_game_lock_any_internal(v_league.season, v_current, n.team, p_at) ->> 'locked')::boolean
  )
  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id COLLATE "C"), '[]'::jsonb) INTO v_locked
  FROM public.players p JOIN claim_players cp ON cp.pid = p.id JOIN locked_nfl ln ON ln.team = p.team;

  v_input := jsonb_build_object(
    'settings', jsonb_build_object(
      'waiverType',            v_type,
      'faabTiebreaker',        v_tb,
      'rosterSize',            v_size,
      'acquisitionsPerWeek',   CASE WHEN v_capw_txt = 'unlimited' THEN NULL ELSE v_capw_txt::int END,
      'acquisitionsPerSeason', CASE WHEN v_caps_txt = 'unlimited' THEN NULL ELSE v_caps_txt::int END),
    'teams',           v_teams,
    'claims',          v_claims,
    'priority',        jsonb_build_object('draftOrder', v_draft, 'standings', v_standings, 'rolling', v_rolling),
    'lockedPlayerIds', v_locked);

  -- (4) DECIDE.
  v_result := public.waiver_resolve_run_internal(v_input);
  FOR v_o IN SELECT e FROM jsonb_array_elements(v_result -> 'outcomes') e WHERE e ->> 'status' = 'won' LOOP
    v_winners := v_winners || jsonb_build_object(v_o ->> 'addPlayerId',
      jsonb_build_object('winner_team_id', v_o ->> 'teamId', 'winning_bid', (v_o ->> 'faabSpent')::int));
  END LOOP;

  -- (5) APPLY, in decision order.
  FOR v_o IN SELECT e FROM jsonb_array_elements(v_result -> 'outcomes') e ORDER BY (e ->> 'decision')::int LOOP
    v_n := v_n + 1;
    SELECT c.* INTO v_claim
    FROM public.waiver_claims c
    WHERE c.id = (v_o ->> 'claimId')::uuid AND c.league_id = p_league_id AND c.status = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'process_waivers: the run decided claim %, which is not a pending claim of league % — refusing', v_o ->> 'claimId', p_league_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_o ->> 'status' <> 'won' THEN
      UPDATE public.waiver_claims c
      SET status = v_o ->> 'status', result_reason = v_o ->> 'reason', processed_at = p_at, process_at = v_run_at
      WHERE c.id = v_claim.id AND c.status = 'pending';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'process_waivers: settling claim % touched % rows, expected 1', v_claim.id, v_cnt USING ERRCODE = 'P0001';
      END IF;
      IF v_o ->> 'status' = 'lost' THEN v_lost := v_lost + 1; ELSE v_invalid := v_invalid + 1; END IF;
      IF public.waiver_claim_notify_internal(v_league, v_claim, v_o ->> 'status', v_o ->> 'reason',
           COALESCE(v_winners -> v_claim.add_player_id, '{}'::jsonb)
           || jsonb_build_object('run_at', v_run_at,
                                 'faab_before', (SELECT m.faab_balance FROM public.league_members m
                                                 WHERE m.league_id = p_league_id AND m.team_id = v_claim.team_id))) IS NOT NULL THEN
        v_notified := v_notified + 1;
      END IF;
      CONTINUE;
    END IF;

    -- A WON claim.
    v_won := v_won + 1;
    v_spent := (v_o ->> 'faabSpent')::int;
    v_txn_id := gen_random_uuid();
    v_lineups := '[]'::jsonb;
    SELECT p.* INTO v_add_p FROM public.players p WHERE p.id = v_claim.add_player_id;
    SELECT pp.* INTO v_pool FROM public.league_player_pool pp WHERE pp.league_id = p_league_id AND pp.player_id = v_claim.add_player_id;
    v_pool_from := CASE WHEN NOT FOUND THEN 'free_agent' ELSE v_pool.state END;

    -- the drop (149's destination rule: on waivers until the NEXT run, or
    -- back to free agency inside fa_hold_hours of a free-agent pickup)
    v_drop_state := NULL;
    v_drop_until := NULL;
    v_hold_early := FALSE;
    IF v_claim.drop_player_id IS NOT NULL THEN
      SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = v_claim.drop_player_id;
      SELECT r.* INTO v_drop_row FROM public.league_rosters r
      WHERE r.league_id = p_league_id AND r.player_id = v_claim.drop_player_id AND r.team_id = v_claim.team_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'process_waivers: claim % drops %, who is not on the team''s roster — the resolver said he was; refusing', v_claim.id, v_claim.drop_player_id
          USING ERRCODE = 'P0001';
      END IF;
      v_hold_early := v_drop_row.acquisition_type = 'free_agent'
                      AND v_hold_hours > 0
                      AND v_drop_row.acquired_at IS NOT NULL
                      AND p_at < v_drop_row.acquired_at + make_interval(hours => v_hold_hours);
      IF v_hold_early THEN
        v_drop_state := 'free_agent';
      ELSE
        v_drop_state := 'on_waivers';
        v_drop_until := public.waiver_next_run_internal(v_sched, p_at);
      END IF;
      DELETE FROM public.league_rosters r
      WHERE r.league_id = p_league_id AND r.team_id = v_claim.team_id AND r.player_id = v_claim.drop_player_id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'process_waivers: the drop of % deleted % roster rows, expected 1', v_claim.drop_player_id, v_cnt USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
      VALUES (p_league_id, v_claim.drop_player_id, v_drop_state, v_drop_until, p_at)
      ON CONFLICT (league_id, player_id) DO UPDATE
        SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
    END IF;

    -- the add — the bench, a waiver acquisition at the price paid
    BEGIN
      INSERT INTO public.league_rosters
        (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
      VALUES (p_league_id, v_claim.team_id, v_claim.add_player_id, 'bn', 'waiver', v_spent, p_at);
    EXCEPTION WHEN unique_violation THEN
      -- Unreachable while the league row lock is held (the resolver saw him
      -- unowned under it); kept so a raw 23505 never escapes.
      RAISE EXCEPTION 'process_waivers: % (%) is already rostered in league % — a player is on ONE roster per league (player exclusivity, §12.7); refusing',
        COALESCE(v_add_p.full_name, v_claim.add_player_id), v_claim.add_player_id, p_league_id
        USING ERRCODE = 'P0001';
    END;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league_id, v_claim.add_player_id, 'rostered', NULL, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;

    -- THE LINEUP INTERPLAY (TD10) — 149's loop (roster_add_drop_internal
    -- §THE LINEUP CONSEQUENCES), copied for this team, add and drop; from
    -- the first UNFINISHED week (152 / F437 — a Tuesday run lands exactly
    -- between a week's last game and the next week's start).
    FOR v_row IN
      SELECT tl.* FROM public.team_lineups tl
      WHERE tl.team_id = v_claim.team_id AND tl.season = v_league.season AND tl.week >= v_from_week
      ORDER BY tl.week
      FOR UPDATE
    LOOP
      v_map := COALESCE(v_row.slot_map, '{}'::jsonb);
      v_starters := COALESCE(v_row.starters, '[]'::jsonb);
      v_bench := COALESCE(v_row.bench, '[]'::jsonb);
      v_changed := FALSE;
      v_key := NULL;
      IF v_claim.drop_player_id IS NOT NULL THEN
        SELECT e.key INTO v_key FROM jsonb_each_text(v_map) e WHERE e.value = v_claim.drop_player_id LIMIT 1;
        IF v_key IS NOT NULL THEN
          v_map := v_map - v_key;
          SELECT COALESCE(jsonb_agg(
                   CASE WHEN s ->> 'slot' = v_key
                        THEN s || jsonb_build_object('player_id', NULL, 'position', NULL, 'kickoff_at', NULL, 'flags', '["empty"]'::jsonb)
                        ELSE s END ORDER BY ord), '[]'::jsonb)
          INTO v_starters
          FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord);
          v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', v_key);
          v_changed := TRUE;
        END IF;
        IF v_bench ? v_claim.drop_player_id THEN
          SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
          FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') <> v_claim.drop_player_id;
          IF v_key IS NULL THEN
            v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', NULL);
          END IF;
          v_changed := TRUE;
        END IF;
      END IF;
      IF NOT (v_bench ? v_claim.add_player_id) THEN
        SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
        FROM jsonb_array_elements(v_bench || to_jsonb(v_claim.add_player_id)) x;
        v_changed := TRUE;
      END IF;
      IF v_changed THEN
        UPDATE public.team_lineups SET slot_map = v_map, starters = v_starters, bench = v_bench
        WHERE id = v_row.id;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION 'process_waivers: lineup sync for week % touched % rows, expected 1', v_row.week, v_cnt USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;

    -- the money (FAAB only — a priority league spends nothing, §13.2)
    v_before := NULL;
    v_after := NULL;
    IF v_type = 'faab' THEN
      UPDATE public.league_members m
      SET faab_balance = m.faab_balance - v_spent
      WHERE m.league_id = p_league_id AND m.team_id = v_claim.team_id
      RETURNING m.faab_balance + v_spent, m.faab_balance INTO v_before, v_after;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 OR v_after IS NULL OR v_after < 0 THEN
        RAISE EXCEPTION 'process_waivers: debiting $% from team %''s seat touched % rows (balance after %) — refusing (TD2)', v_spent, v_claim.team_id, v_cnt, v_after
          USING ERRCODE = 'P0001';
      END IF;
      v_faab_spent := v_faab_spent + v_spent;
    END IF;

    -- ONE transactions row (TD9; F416: 113's add / drop name objects)
    INSERT INTO public.transactions (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
    VALUES (v_txn_id, p_league_id, 'waiver_claim', 'complete', v_claim.team_id, v_claim.created_by,
      jsonb_build_object(
        'transaction_id', v_txn_id,
        'league_id',      p_league_id,
        'team_id',        v_claim.team_id,
        'season',         v_league.season,
        'week',           v_current,
        'type',           'waiver_claim',
        'claim_id',       v_claim.id,
        'run_at',         v_run_at,
        'decision',       (v_o ->> 'decision')::int,
        'waiver_type',    v_type,
        'add_player_id',  v_claim.add_player_id,
        'drop_player_id', v_claim.drop_player_id,
        'faab_bid',       v_spent,
        'faab_before',    v_before,
        'faab_after',     v_after,
        'add', jsonb_build_object(
          'player_id',        v_claim.add_player_id,
          'name',             v_add_p.full_name,
          'position',         v_add_p.position,
          'nfl_team',         v_add_p.team,
          'from_state',       v_pool_from,
          'to_state',         'rostered',
          'acquisition_type', 'waiver',
          'slot_key',         'bn',
          'acquired_at',      p_at),
        'drop', CASE WHEN v_claim.drop_player_id IS NULL THEN NULL ELSE jsonb_build_object(
          'player_id',     v_claim.drop_player_id,
          'name',          v_drop_p.full_name,
          'position',      v_drop_p.position,
          'nfl_team',      v_drop_p.team,
          'from_slot_key', v_drop_row.slot_key,
          'to_state',      v_drop_state,
          'waivers_until', v_drop_until,
          'fa_hold', jsonb_build_object(
            'hours',            v_hold_hours,
            'acquisition_type', v_drop_row.acquisition_type,
            'acquired_at',      v_drop_row.acquired_at,
            'early',            v_hold_early),
          'lineups',       v_lineups) END,
        'evaluated_at',   p_at),
      v_current, NULL);

    UPDATE public.waiver_claims c
    SET status = 'won', result_reason = NULL, processed_at = p_at, process_at = v_run_at
    WHERE c.id = v_claim.id AND c.status = 'pending';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'process_waivers: settling won claim % touched % rows, expected 1', v_claim.id, v_cnt USING ERRCODE = 'P0001';
    END IF;
    IF public.waiver_claim_notify_internal(v_league, v_claim, 'won', NULL,
         jsonb_build_object('run_at', v_run_at, 'transaction_id', v_txn_id, 'faab_before', v_before, 'faab_after', v_after,
                            'winner_team_id', v_claim.team_id, 'winning_bid', v_spent)) IS NOT NULL THEN
      v_notified := v_notified + 1;
    END IF;
  END LOOP;

  IF v_n <> jsonb_array_length(v_claims) THEN
    RAISE EXCEPTION 'process_waivers: the run decided % of % pending claims — every claim is decided exactly once; refusing', v_n, jsonb_array_length(v_claims)
      USING ERRCODE = 'P0001';
  END IF;

  -- the persisting order (F421(d)): 1-based, every active seat
  IF (v_result #>> '{priority,persists}')::boolean THEN
    UPDATE public.league_members m
    SET waiver_priority = a.o::int
    FROM jsonb_array_elements_text(v_result #> '{priority,after}') WITH ORDINALITY AS a(t, o)
    WHERE m.league_id = p_league_id AND m.team_id = a.t::uuid AND m.waiver_priority IS DISTINCT FROM a.o::int;
    SELECT count(*)::int INTO v_cnt
    FROM jsonb_array_elements_text(v_result #> '{priority,after}') WITH ORDINALITY AS a(t, o)
    JOIN public.league_members m ON m.league_id = p_league_id AND m.team_id = a.t::uuid AND m.waiver_priority = a.o::int;
    IF v_cnt <> jsonb_array_length(v_result #> '{priority,after}') THEN
      RAISE EXCEPTION 'process_waivers: writing the rolling order left % of % seats at their place — a franchise in the order has no seat; refusing', v_cnt, jsonb_array_length(v_result #> '{priority,after}')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (6) ASSERTED, NOT TRUSTED — the tables now say what the resolver said.
  FOR v_t IN SELECT e FROM jsonb_array_elements(v_result -> 'teams') e LOOP
    IF COALESCE((SELECT jsonb_agg(r.player_id ORDER BY r.player_id COLLATE "C") FROM public.league_rosters r
                 WHERE r.league_id = p_league_id AND r.team_id = (v_t ->> 'teamId')::uuid), '[]'::jsonb) <> v_t -> 'rosterAfter' THEN
      RAISE EXCEPTION 'process_waivers: team %''s roster after the run is not the one the run decided (%) — refusing', v_t ->> 'teamId', v_t -> 'rosterAfter'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_type = 'faab' AND jsonb_typeof(v_t -> 'faabAfter') = 'number'
       AND (SELECT m.faab_balance FROM public.league_members m
            WHERE m.league_id = p_league_id AND m.team_id = (v_t ->> 'teamId')::uuid) IS DISTINCT FROM (v_t ->> 'faabAfter')::int THEN
      RAISE EXCEPTION 'process_waivers: team %''s FAAB after the run is not the $% the run decided — refusing (TD2)', v_t ->> 'teamId', v_t ->> 'faabAfter'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (7) THE NEXT RUN, and the run log (exactly once).
  v_next := public.waiver_next_run_internal(v_sched, p_at);
  UPDATE public.leagues SET waiver_next_run_at = v_next WHERE id = p_league_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'process_waivers: advancing league %''s next run touched % rows, expected 1', p_league_id, v_cnt USING ERRCODE = 'P0001';
  END IF;

  v_summary := jsonb_build_object(
    'league_id',    p_league_id,
    'status',       'settled',
    'run_at',       v_run_at,
    'processed_at', p_at,
    'next_run_at',  v_next,
    'week',         v_current,
    'waiver_type',  v_type,
    'claims',       v_n,
    'won',          v_won,
    'lost',         v_lost,
    'invalid',      v_invalid,
    'faab_spent',   v_faab_spent,
    'notified',     v_notified,
    'priority',     jsonb_build_object('source', v_result #> '{priority,source}', 'persists', v_result #> '{priority,persists}'),
    'why',          CASE WHEN v_n = 0 THEN 'no_pending_claims — the run was due and settled with nothing to decide' END,
    'evaluated_at', p_at);

  INSERT INTO public.waiver_runs AS w (league_id, run_at, status, processed_at, attempts, input, result, summary, last_error, updated_at)
  VALUES (p_league_id, v_run_at, 'settled', p_at, 1, v_input, v_result, v_summary, NULL, p_at)
  ON CONFLICT (league_id, run_at) DO UPDATE
    SET status = 'settled', processed_at = EXCLUDED.processed_at, attempts = w.attempts + 1,
        input = EXCLUDED.input, result = EXCLUDED.result, summary = EXCLUDED.summary, updated_at = EXCLUDED.updated_at
    WHERE w.status = 'refused'
  RETURNING w.id INTO v_run_id;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'process_waivers: the waiver run at % for league % was already settled — a run is settled exactly once (TD6); refusing', v_run_at, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_summary || jsonb_build_object('run_id', v_run_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION process_waivers_internal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. set_lineup_internal — R1206 (PR #337's fix round): a PLAYED starter who
--    has left the roster since stays in the finished week's lineup.
--    CREATE OR REPLACE against 131:3685-4283's FILE TEXT (D137; definers
--    112 / 114 / 131 — 131 newest, measured by grep; 142 / 149–151 do not
--    define it), 5 hunks (+57 / -3): DECLARE; the new step (4b); step (6)
--    folds (4b)'s kickoffs into v_kick; step (7a)'s comment; step (12)'s
--    slot_key loop skips him (no roster row of his) and its count excludes
--    him. The DEFINER wrapper set_lineup (112) is untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT DEFAULT NULL   -- REQUIRED (non-blank) when the actor is not the team's manager (R738 / D290)
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;   -- the CURRENT week's datum (IR moves are judged against it — R736)
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  v_stored_at   TEXT;
  v_locked      BOOLEAN;
  v_min_weeks   INTEGER;
  v_msg         TEXT;
  -- 152 / R1206: stored starters who PLAYED and have left this roster since
  -- (player_id → {kickoff_at, datum_arm, on_bye}) — fixed for the week.
  v_gone_kick   JSONB := '{}'::jsonb;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'set_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     One no-leak 42501 for "no such league", "not a member", "not this
  --     team's manager and not a commissioner".
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'set_lineup: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written.
  SELECT a.result INTO v_result
  FROM public.lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'set_lineup: league % is % — lineups are set only while in_season or in playoffs (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'set_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'set_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  IF p_week < v_current THEN
    RAISE EXCEPTION
      'set_lineup: week % is in the past (the current week is %) — a past week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, v_current
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    RAISE EXCEPTION
      'set_lineup: week % of league % is % — a closed week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, p_league_id, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- The COMMISSIONER ARM carries the D290 interim audit posture (R738 / F40):
  -- a real change by an actor who is not this team's manager posts the
  -- in-txn system message below. RE-READ UNDER Q66 (migration 131 / L.E1.15,
  -- F362; spec v2.16.41 §10.3 / §15.4 — a commissioner setting another
  -- team's lineup IS a commissioner action): the reason is OPTIONAL, so it is
  -- NORMALISED here and never refused. Blank = nothing but whitespace
  -- INCLUDING tabs/newlines (R745) ⇒ NULL; bounded at 500 characters below,
  -- the client chat policy's own bound, so the system post stays bounded
  -- (R746) — that check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'set_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'set_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- (4b) 152 / R1206 (Q32's amendment, verbatim: "if they are in the lineup
  --      they are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN
  --      AFTER HE LEAVES THE ROSTER. Once a week's last game has ended the
  --      lock releases (E32 / 115) and a starter who played can be dropped,
  --      claimed away or traded, while the week is still current (live)
  --      until the next week starts; 152 keeps his finished-week start (the
  --      week is scored and re-scored from this slot_map). A stored STARTING
  --      slot whose player is not on this roster and whose OWN game for
  --      p_week has kicked off is therefore FIXED: carried through unchanged
  --      (the editor never holds an unrostered player — placementFromStored
  --      — so an omitted key is carried, not read as "empty it"), and a
  --      submit that puts anyone else there, or moves him, is refused by
  --      name. He joins v_by_pid (never v_roster: no bench, no roster write)
  --      so steps 7–10 treat him as the locked starter he is. A stored
  --      unrostered player whose game has NOT kicked off (a bye) did not
  --      play: his slot opens, as before.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',          p.id,
             'name',               p.full_name,
             'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation',        public.lineup_designation_internal(p.status),
             'nfl_team',           p.team,
             'ir_placed_week',     NULL,
             'ir_lock_until_week', NULL,
             'slot_key',           NULL,
             'off_roster',         TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> 'nfl_team', p_at);
    CONTINUE WHEN v_k.kickoff_at IS NULL OR v_k.kickoff_at > p_at;   -- has not played: the slot opens
    IF ((p_slot_map ? v_key) AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid)
       OR EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE x.key <> v_key AND (x.value #>> '{}') = v_pid) THEN
      RAISE EXCEPTION
        'set_lineup: % already played this week — his start stays (slot "%": his game kicked off at % (%); he has left %''s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)',
        v_e ->> 'name', v_key, v_k.kickoff_at, v_k.datum_arm, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_gone_kick := v_gone_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    p_slot_map := p_slot_map || jsonb_build_object(v_key, v_pid);   -- carried
  END LOOP;

  -- (5) VALIDATE THE SUBMITTED MAP: keys are slot instances or IR spots,
  --     values are this team's rostered players, each player exactly once.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'set_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'set_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'set_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'set_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — for p_week (the
  --     starters) and for the current week (IR moves) when they differ.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> 'nfl_team', p_at);
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  v_kick := v_kick || v_gone_kick;   -- 152 / R1206: (4b)'s played, since-unrostered starters
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) LOCKED PLAYERS NEVER MOVE (per_player_kickoff — the ONLY lineup lock,
  --     Q34(A)). Evaluated BEFORE the fit so a locked stored starter is a
  --     FIXED vertex, and a played player can neither enter nor change slots.
  --     114: the mode test that used to guard this block is gone — it is
  --     unconditional.
    -- (a) every stored starter whose game has kicked off must sit at the
    --     same key in the submitted map.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN NOT (v_by_pid ? v_pid);                       -- off the roster and NOT played (a played one is in v_by_pid since (4b) — 152 / R1206)
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: slot % is locked — % kicked off at % (%) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
          v_key, v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm'
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    -- (b) a player whose game has kicked off never enters a slot he was not
    --     already stored at.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (v_stored ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: %''s game kicked off at % (%) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "%"',
          v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm', v_key
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

  -- (8) THE FIT (E16). Input order: fixed (locked) players first, then the
  --     rest in submitted-key order — deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     x.fixed) ORDER BY x.fixed DESC, x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord,
           -- fixed = locked: the player's OWN kickoff has passed (R737 — a
           -- locked placement is a fact; 114: the whole-week arm is gone).
           ((v_kick -> (e.value #>> '{}') ->> 'kickoff_at') IS NOT NULL
            AND (v_kick -> (e.value #>> '{}') ->> 'kickoff_at')::timestamptz <= p_at) AS fixed
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'set_lineup: % (%) cannot be placed — no legal arrangement of the started players fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- 114 (Q34(A)): the whole-week refusal that stood here is RETIRED. After the
  -- week's first kickoff every UNLOCKED slot of the lineup stays editable;
  -- only a slot whose own player has kicked off is closed (step 7).

  -- (9) IR MOVES, against the CURRENT week (banner: IR LAW).
  --     Placements: under an IR key now, not on IR (or on a different spot) before.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      -- a NEW placement (or a spot change, which is removal + placement)
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        RAISE EXCEPTION
          'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
          v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'set_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        RAISE EXCEPTION
          'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
          v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
          USING ERRCODE = 'P0001';
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  --     Removals: on IR before, not under any IR key now.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      RAISE EXCEPTION
        'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
        v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      RAISE EXCEPTION
        'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
        v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
        USING ERRCODE = 'P0001';
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  v_locked_at := NULL;   -- 114: the earliest STARTED player's kickoff (below), never a week datum
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE: a bye/OUT starter in an
      -- UNLOCKED slot blocks the submit by name.
      -- (a locked slot's bye/OUT player is not the manager's to change:
      --  exempt when the stored player's own game has kicked off, R739.)
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT ((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) = v_pid) THEN
        RAISE EXCEPTION
          'set_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him or start someone who plays',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- (11) NO-OP BY NAME (rule 10): the canonical map equals the stored map
  --      and no IR move — nothing is written but the ledger row.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = NOT v_is_manager,
        set_at            = now()
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'set_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- R738 / D290 / D97: a commissioner's change posts in-txn, reason in the
    -- text (the interim audit until commissioner_actions exists — F40).
    IF NOT v_is_manager THEN
      v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' set by '
        || public.draft_actor_name() || ' (commissioner)'
        || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional
      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
      VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
    END IF;

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week: starters → instance key, the rest
      -- (not on IR) → 'bn'. Counts asserted against the roster.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        CONTINUE WHEN v_gone_kick ? (v_val #>> '{}');   -- 152 / R1206: off this roster — no roster row of his to write
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick)) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key for % starters, expected %', v_expected,
          COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick))
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,   -- 114: the CHECK-constrained column value (only 'per_player_kickoff' exists)
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      NOT v_is_manager,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free)
  );

  INSERT INTO public.lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION set_lineup_internal(UUID, UUID, INTEGER, JSONB, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. lineup_autopilot_internal — R1206: a slot holding a PLAYED starter who
--    has left the roster since is his, never OPEN.
--    CREATE OR REPLACE against 142:459-1034's FILE TEXT (D137; definers
--    125 / 138 / 139 / 142 — 142 newest, measured by grep), 2 hunks
--    (+34 / -1): the off-roster played starters join v_by_pid / v_kick after
--    the kickoff loop; the classification comment. The caller
--    (lineup_lock_tick, 139) is untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_autopilot_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_row         public.team_lineups;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_by_pid      JSONB := '{}'::jsonb;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_kick        JSONB := '{}'::jsonb;
  v_map         JSONB := '{}'::jsonb;
  v_ir_held     TEXT[] := ARRAY[]::text[];
  v_seated      TEXT[] := ARRAY[]::text[];   -- players staying where they are
  v_fixed       JSONB := '[]'::jsonb;        -- fit input: those same players
  v_free        JSONB := '[]'::jsonb;        -- fit input: HEALTHY unlocked candidates
  v_tail        JSONB := '[]'::jsonb;        -- fit input: the unhealthy tail (allow = TRUE)
  v_displace    JSONB := '{}'::jsonb;        -- slot key → vacated unhealthy starter
  v_restored    JSONB := '[]'::jsonb;
  v_locked_out  JSONB := '[]'::jsonb;        -- skipped_locked[]
  v_filtered    JSONB := '[]'::jsonb;        -- refused by the allow = FALSE hard filter
  v_fit_a       JSONB;
  v_fit_b       JSONB;
  v_players_b   JSONB := '[]'::jsonb;
  v_assign      JSONB;
  v_filled      JSONB := '[]'::jsonb;
  v_subbed      JSONB := '[]'::jsonb;
  v_unfill      JSONB := '[]'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_locked_at   TIMESTAMPTZ;
  v_pflags      JSONB;
  v_empties     INTEGER := 0;
  v_sick        INTEGER := 0;               -- unhealthy UNLOCKED seated starters
  v_e           JSONB;
  v_p           JSONB;
  v_k           RECORD;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_elig        JSONB;
  v_locked      BOOLEAN;
  v_unhealthy   BOOLEAN;
  v_changed     BOOLEAN;
  v_reason      TEXT;
  -- 138 (L.E1.21, Q62): the read-side freshness bound (F387's read half /
  -- F389(c)) — the SAME six hours as the compute half's
  -- `PROJECTION_MAX_AGE_MS` (`player-values.ts`), pinned equal by a unit cell.
  c_max_age     CONSTANT INTERVAL := interval '6 hours';
  v_tail_d      JSONB := '[]'::jsonb;        -- fit input: the DOUBTFUL tail — ahead of v_tail, under BOTH settings
  v_blocked     BOOLEAN;                     -- bye or a §7.3.6 blocking designation (Doubtful is NOT one)
  v_basis       JSONB;                       -- order_basis: what ordered this pass, and why a key was absent
  -- 142 (L.E1.25, Q68 RULED): pass 1b — a Doubtful replacement for a BLOCKED
  -- starter nobody healthy replaced.
  v_defer       JSONB := '{}'::jsonb;        -- slot key → vacated BLOCKED starter with no healthy replacement
  v_dslots      JSONB;                       -- pass 1b's slots: exactly those keys
  v_players_d   JSONB := '[]'::jsonb;        -- pass 1b's candidates: the unseated Doubtful tail
  v_fit_d       JSONB;
  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lineup_autopilot_internal: league % not found', p_league_id USING ERRCODE = 'P0002';
  END IF;

  -- The row must EXIST. D354 puts materialization in the caller, under the
  -- league lock, through the unchanged carry — so an absent row here is a
  -- caller bug and must be loud, never a silently invented lineup.
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = p_season AND tl.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'lineup_autopilot_internal: no team_lineups row for team % season % week % — the caller materializes through lineup_carry_internal first (D354); refusing to invent one',
      p_team_id, p_season, p_week
      USING ERRCODE = 'P0002';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- §7.3.6's per-league setting, read the way `set_lineup` reads it
  -- (`114:307`): absent ⇒ TRUE.
  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- THE ROSTER, in 114/116's shape (positions normalised DEF → DST;
  -- designations bridged through `lineup_designation_internal`, 112:337),
  -- plus the four keys of the one sort below and an `order` object that says
  -- which key ordered each player and why an earlier key was absent.
  --
  -- Q62's SORT, AS RULED (Chris 2026-09-27; 138, L.E1.21), AND IT IS STILL
  -- THE WHOLE SELECTION POLICY. Placement is free (D340 — the matcher
  -- CHOOSES, and greedy-by-input-order over a transversal matroid is
  -- optimal), so "which players start" is this ORDER BY and nothing else:
  -- (1) THIS week's projected points, (2) season-to-date points, (3) preseason
  -- projected points — each under the league's scoring (§12.28, 137) — then
  -- (4) ADP, then player_id. POINTS, never ranks: across positions (a FLEX
  -- slot) Chris ruled "total scored points", and within a position points
  -- order exactly as positional rank does. ONE LEXICOGRAPHIC ORDER BY, PER
  -- PLAYER (the task's READING, flagged): a player with a key outranks every
  -- player without it; the later keys order only what the earlier leave NULL.
  --
  -- F389's JOIN CONTRACT. (a) A LEFT JOIN — a rostered player with no values
  -- row (acquired since the last hourly run; a league-week the job failed)
  -- stays in the pool with all three keys NULL and is NAMED in order_basis;
  -- (b) only the POINTS columns are sort keys — `*_missing` / `*_unscored`
  -- never are; (c) F387's READ HALF — a row whose `computed_at` is older than
  -- `c_max_age` at `p_at` is ABSENT (the values job has died), and a
  -- projection whose `projection_fetched_at` is older than `c_max_age` at
  -- `p_at` is ABSENT (the projections sync has died) ⇒ the next key orders.
  -- ALL FOUR JOIN PREDICATES ARE LOAD-BEARING (R1120, #316's fix round).
  -- The job writes the CURRENT and the NEXT week for every rostered player of
  -- every league, and one real player is rostered in many leagues: without
  -- `v.week = p_week` (or the season) he joins TWICE — two roster entries, and
  -- the matcher could seat one man in two slots — and without the league
  -- predicate he is ordered by ANOTHER league's scoring. pgTAP 086 gives a
  -- §C1 player a reversing row in each of those three places.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',      r.player_id,
           'name',           p.full_name,
           'position',       CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',    public.lineup_designation_internal(p.status),
           'nfl_team',       p.team,
           'adp',            p.adp,
           'ir_placed_week', r.ir_placed_week,
           'slot_key',       r.slot_key,
           'order',          jsonb_build_object(
             'ordered_by',       CASE WHEN k.projected_points IS NOT NULL THEN 'projected_points'
                                      WHEN k.season_points    IS NOT NULL THEN 'season_points'
                                      WHEN k.preseason_points IS NOT NULL THEN 'preseason_points'
                                      WHEN p.adp              IS NOT NULL THEN 'adp'
                                      ELSE 'player_id' END,
             'projected_points', k.projected_points,
             'season_points',    k.season_points,
             'preseason_points', k.preseason_points,
             'adp',              p.adp,
             'value_row',        f.value_row,
             'projected_why',    CASE WHEN k.projected_points IS NOT NULL THEN NULL
                                      WHEN f.value_row <> 'fresh' THEN f.value_row
                                      WHEN v.projected_points IS NULL THEN v.projected_missing
                                      ELSE 'stale_line_at_read' END))
           ORDER BY k.projected_points DESC NULLS LAST, k.season_points DESC NULLS LAST,
                    k.preseason_points DESC NULLS LAST, p.adp ASC NULLS LAST, r.player_id ASC), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  LEFT JOIN public.league_player_values v
    ON v.league_id = r.league_id AND v.season = p_season AND v.week = p_week AND v.player_id = r.player_id
  CROSS JOIN LATERAL (SELECT CASE WHEN v.player_id IS NULL THEN 'no_value_row'
                                  WHEN v.computed_at < p_at - c_max_age THEN 'stale_row'
                                  ELSE 'fresh' END AS value_row) f
  CROSS JOIN LATERAL (SELECT
           CASE WHEN f.value_row = 'fresh' AND v.projection_fetched_at >= p_at - c_max_age
                THEN v.projected_points END AS projected_points,
           CASE WHEN f.value_row = 'fresh' THEN v.season_points END AS season_points,
           CASE WHEN f.value_row = 'fresh' THEN v.preseason_points END AS preseason_points) k
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order WITH their eligibility (the matcher's
  -- input, `114:355-362`), and the IR spots by key.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', (s ->> 'key') || ':0', 'spot', s ->> 'key') ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- A team with no roster has nothing to seat. Reported, never raised: one
  -- empty roster must not fail a league's whole tick.
  IF jsonb_array_length(v_roster) = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'empty_roster', 'evaluated_at', p_at);
  END IF;

  -- THE PER-PLAYER LOCK DATUM, read NOW from `nfl_games` at the injected
  -- instant (E42/§23.3) — the same helper and the same rendering 114 and 116
  -- use, so arm (b) finds nothing to change next minute.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- 152 / R1206 (Q32's amendment, verbatim: "if they are in the lineup they
  -- are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN AFTER HE
  -- LEAVES THE ROSTER. After a week's last game a starter who played can be
  -- dropped, claimed away or traded while the week is still current, and 152
  -- keeps his start in that week's slot_map (the week is scored from it). A
  -- stored STARTING slot whose player is off this roster and whose OWN game
  -- for p_week has kicked off is his, not OPEN: he joins v_by_pid / v_kick
  -- (never v_roster — he is nobody's candidate and on no bench), so the
  -- classification below seats him as the locked starter he is (D338) and the
  -- fit keeps him fixed at his key. One whose game has not kicked off (a bye)
  -- did not play: his slot is OPEN, as before.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',   p.id,
             'name',        p.full_name,
             'position',    CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation', public.lineup_designation_internal(p.status),
             'nfl_team',    p.team,
             'off_roster',  TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> 'nfl_team', p_at);
    CONTINUE WHEN v_k.kickoff_at IS NULL OR v_k.kickoff_at > p_at;   -- has not played: the slot stays OPEN
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_kick := v_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- IR KEYS ARE CARRIED VERBATIM. IR occupancy is ROSTER-level state
  -- (D308/§11.2) and autopilot never moves it; its occupants are not
  -- candidates for a starting slot.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_pid := v_val #>> '{}';
      v_map := v_map || jsonb_build_object(v_key, v_pid);
      v_ir_held := v_ir_held || v_pid;
    END IF;
  END LOOP;

  -- CLASSIFY EVERY STARTING SLOT.
  --   · empty (or holding a player who has since left the roster WITHOUT
  --     having played — 152 / R1206: a played one is in v_by_pid, locked) ⇒ OPEN;
  --   · holding a LOCKED player ⇒ he stays, unconditionally (D338 — the lock
  --     binds autopilot exactly as it binds a manager);
  --   · holding a HEALTHY unlocked player ⇒ he stays (D340 — a carried or
  --     manager-set placement is NEVER overridden on value);
  --   · holding an UNLOCKED player who is on bye or carries a blocking
  --     designation ⇒ VACATED for the substitution pass, and restored below
  --     if no healthy replacement takes the key (Q63).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_stored ->> v_key;
    IF v_pid IS NULL OR NOT (v_by_pid ? v_pid) THEN
      v_empties := v_empties + 1;
      CONTINUE;
    END IF;
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    -- THE `COALESCE` AROUND THE `IN` IS LOAD-BEARING, AND IT WAS MISSING UNTIL
    -- #295's fix round CAUGHT IT WITH §J. `lineup_designation_internal`
    -- returns NULL for a healthy player (112:337 — measured: 'Active' ⇒ NULL),
    -- and `NULL IN (…)` is NULL, not FALSE. Unguarded, `v_unhealthy` was NULL
    -- for EVERY healthy seated starter, `NOT NULL` is NULL, and the `IF` fell
    -- to the ELSE: a healthy, manager-set or carried starter was DISPLACED and
    -- re-contested on value — a D340 violation — and, because such a man also
    -- re-entered the candidate pool below, `v_restored` could seat him at his
    -- old key while pass 1 had already placed him elsewhere, writing ONE PLAYER
    -- INTO TWO SLOTS. Invisible to every other cell in 073 because no other
    -- fixture ran the pass over a map with a HEALTHY SEATED STARTER in it; §J
    -- is that fixture, and it reds on the unguarded form.
    -- 138 (L.E1.21, Q62 RULED): `Doubtful` SITS — an unlocked Doubtful
    -- starter is VACATED here like a bye/OUT man, and pass 1 below either
    -- gives his key to a HEALTHY replacement or the restore clause puts him
    -- back ("yes start the doubtful"). He is NOT in the `out` starter flag
    -- further down: a Doubtful start is legal for a manager (114:596).
    v_unhealthy := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                   OR COALESCE((v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended', 'Doubtful'), FALSE);
    IF v_locked OR NOT v_unhealthy THEN
      v_seated := v_seated || v_pid;
      v_fixed := v_fixed || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_displace := v_displace || jsonb_build_object(v_key, v_pid);
      v_sick := v_sick + 1;
    END IF;
  END LOOP;

  -- THE SHORT-CIRCUIT (tasks-M6A L.E1.4 item 2), BEFORE ANY FIT CALL. Nothing
  -- to fill and nobody to substitute ⇒ no matcher runs and the caller writes
  -- nothing. It lives HERE, in the one place that holds both halves of the
  -- predicate, rather than being half-duplicated in the tick where the
  -- designations and kickoffs are not in scope — the load mitigation is the
  -- predicate, not the cadence.
  IF v_empties = 0 AND v_sick = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'no_empty_slot_and_no_unhealthy_unlocked_starter', 'evaluated_at', p_at);
  END IF;

  -- THE CANDIDATE POOLS, in the roster's Q62 order.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_held);
    CONTINUE WHEN v_pid = ANY (v_seated);
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    IF v_locked THEN
      -- D338: never lifted, and never silently dropped.
      v_locked_out := v_locked_out || jsonb_build_object(
        'player_id', v_pid, 'name', v_e ->> 'name', 'position', v_e ->> 'position',
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'reason', 'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner''s exemption (D338)');
      CONTINUE;
    END IF;
    -- Same `COALESCE` as the classification loop above, for the same reason and
    -- stated once there. Benign on this side (`IF NULL THEN` does not fire, so a
    -- healthy man landed in `v_free` anyway) and written explicitly regardless:
    -- the two loops must classify one player identically or the pools disagree.
    -- 138 (L.E1.21): the SAME unhealthy test as the classification loop
    -- (Doubtful included), split in two because the two halves take different
    -- paths. A BLOCKED man (bye / OUT / IR / PUP / NFI / Suspended) keeps
    -- 125's item-4c split exactly. A DOUBTFUL man is a PREFERENCE under BOTH
    -- settings — never the hard filter, since a Doubtful start is legal
    -- (114:596) — and his tail is offered AHEAD of the blocked tail, which is
    -- where he stood before this migration (he was healthy then): Doubtful
    -- now sits behind every healthy candidate and nothing else changed.
    v_blocked := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                 OR COALESCE((v_e ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended'), FALSE);
    v_unhealthy := v_blocked OR COALESCE((v_e ->> 'designation') = 'Doubtful', FALSE);
    IF v_unhealthy THEN
      IF NOT v_blocked THEN
        v_tail_d := v_tail_d || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSIF v_allow THEN
        -- A PREFERENCE, not a filter: seated LAST, never left out, because an
        -- empty slot is the zero this task exists to remove (item 4c).
        v_tail := v_tail || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSE
        v_filtered := v_filtered || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position');
      END IF;
      CONTINUE;
    END IF;
    v_free := v_free || jsonb_build_object(
      'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
  END LOOP;

  -- PASS 1 — the HEALTHY pass. Seated players are `fixed` at their own key;
  -- every vacated slot and every empty slot is contested by the healthy
  -- candidates in priority order. This is the pass that decides whether a
  -- substitution happens at all.
  v_fit_a := public.lineup_fit_internal(v_slots, v_fixed || v_free);

  -- Q63's RESTORE. A vacated unhealthy starter whose key nobody healthy took
  -- goes straight back where he was: autopilot substitutes only when a
  -- healthy, unlocked, eligible replacement ACTUALLY takes the slot, and it
  -- never turns an occupied slot into an empty one.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_displace) LOOP
    v_pid := v_val #>> '{}';
    IF (v_fit_a -> 'assignment' ->> v_key) IS NULL THEN
      -- 142 (L.E1.25, Q68 RULED 2026-09-27 — "yes, swap in the doubtful"): a
      -- vacated starter who is BLOCKED (on bye, or OUT / IR / PUP / NFI /
      -- Suspended) and whose key nobody healthy took is NOT restored yet — pass
      -- 1b below offers his key to the Doubtful tail first. A vacated DOUBTFUL
      -- starter is restored here as before: never one Doubtful for another.
      IF COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
         OR COALESCE((v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended'), FALSE) THEN
        v_defer := v_defer || jsonb_build_object(v_key, v_pid);
        CONTINUE;
      END IF;
      v_restored := v_restored || jsonb_build_object(
        'slot', v_key, 'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'reason', 'no healthy, unlocked, eligible replacement existed — left exactly as he was (Q63)');
      v_seated := v_seated || v_pid;
      v_players_b := v_players_b || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_subbed := v_subbed || jsonb_build_object(
        'slot', v_key, 'out', v_pid, 'out_name', v_by_pid -> v_pid ->> 'name',
        'in', v_fit_a -> 'assignment' ->> v_key,
        'in_name', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) ->> 'name',
        'reason', CASE WHEN COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                       THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END,
        -- 138: which Q62 key ordered the man who came IN, and why an earlier
        -- key was absent (§4 rule 15) — rides through the tick's autopiloted[].
        'order', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) -> 'order');
    END IF;
  END LOOP;

  -- PASS 1b — 142 (L.E1.25, Q68 RULED 2026-09-27: "yes, swap in the
  -- doubtful"). When no healthy, unlocked, eligible replacement exists, a
  -- DOUBTFUL one replaces a starter who is OUT / on bye. The contest is
  -- exactly the deferred BLOCKED keys (never an empty slot — pass 2 owns
  -- those, unchanged) and its candidates are the Doubtful tail in Q62 order,
  -- minus every man already staying where he is — so a restored Doubtful
  -- starter is never moved to another key (never one Doubtful for another).
  -- A locked man is never a candidate (the pool loop sent him to
  -- skipped_locked[]) and a locked starter was never vacated (D338). The
  -- Doubtful tail is a preference under BOTH `allow_illegal_lineups` values
  -- (a Doubtful start is legal, 114:596), so this runs under both — which is
  -- what restores production's (125) swap in a league that forbids illegal
  -- lineups (R1123). A deferred key no Doubtful man takes is restored exactly
  -- as Q63's clause restores it.
  IF v_defer <> '{}'::jsonb THEN
    SELECT COALESCE(jsonb_agg(t.s ORDER BY t.ord), '[]'::jsonb)
    INTO v_dslots
    FROM jsonb_array_elements(v_slots) WITH ORDINALITY AS t(s, ord)
    WHERE v_defer ? (t.s ->> 'key');
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d) LOOP
      CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_seated);
      v_players_d := v_players_d || v_e;
    END LOOP;
    v_fit_d := public.lineup_fit_internal(v_dslots, v_players_d);
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_defer) LOOP
      v_pid := v_val #>> '{}';
      IF (v_fit_d -> 'assignment' ->> v_key) IS NULL THEN
        v_restored := v_restored || jsonb_build_object(
          'slot', v_key, 'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
          'reason', 'no healthy or Doubtful, unlocked, eligible replacement existed — left exactly as he was (Q63; Q68)');
        v_seated := v_seated || v_pid;
        v_players_b := v_players_b || jsonb_build_object(
          'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
          'wanted', v_key, 'fixed', TRUE);
      ELSE
        v_d_in := v_d_in || (v_fit_d -> 'assignment' ->> v_key);
        v_players_b := v_players_b || jsonb_build_object(
          'player_id', v_fit_d -> 'assignment' ->> v_key,
          'position', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) ->> 'position',
          'wanted', v_key, 'fixed', TRUE);
        v_subbed := v_subbed || jsonb_build_object(
          'slot', v_key, 'out', v_pid, 'out_name', v_by_pid -> v_pid ->> 'name',
          'in', v_fit_d -> 'assignment' ->> v_key,
          'in_name', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) ->> 'name',
          'reason', CASE WHEN COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                         THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END,
          'why', 'no healthy, unlocked, eligible replacement existed — a Doubtful one replaces a starter who cannot play (Q68, ruled 2026-09-27)',
          'order', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) -> 'order');
      END IF;
    END LOOP;
  END IF;

  -- PASS 2 — the TAIL pass. Pass 1's whole assignment is re-seeded `fixed`
  -- (112:501-505 seeds a fixed player at his wanted key unconditionally, so
  -- pass 1's result is reproduced exactly), the restored men with it, and the
  -- remaining slots are offered to the unhealthy tail — which, when the
  -- league forbids illegal lineups, holds only the Doubtful men (138), so a
  -- slot only a BLOCKED man could take stays `unfillable`.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit_a -> 'assignment') LOOP
    v_players_b := v_players_b || jsonb_build_object(
      'player_id', v_val #>> '{}',
      'position', v_by_pid -> (v_val #>> '{}') ->> 'position',
      'wanted', v_key, 'fixed', TRUE);
  END LOOP;
  -- 138: the Doubtful tail FIRST, then the blocked tail (see the pool loop).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d || v_tail) LOOP
    CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_seated);
    -- 142 (Q68): a Doubtful man pass 1b seated is already fixed above.
    CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_d_in);
    v_players_b := v_players_b || v_e;
  END LOOP;
  v_fit_b := public.lineup_fit_internal(v_slots, v_players_b);
  v_assign := v_fit_b -> 'assignment';
  v_map := v_map || v_assign;

  -- WHAT WAS FILLED, AND WHAT COULD NOT BE — with the slot KEY and a REASON
  -- string, never merely a short map (§4 rule 15).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_elig := v_e -> 'eligible';
    v_pid := v_assign ->> v_key;
    IF v_pid IS NULL THEN
      v_unfill := v_unfill || jsonb_build_object('slot', v_key, 'slot_key', v_e ->> 'slot',
        'reason', CASE
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_filtered) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no healthy eligible player at ' || upper(v_e ->> 'slot') || '; league forbids illegal lineups'
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no unlocked eligible player at ' || upper(v_e ->> 'slot') || '; every candidate''s game had kicked off'
          ELSE 'no eligible player at ' || upper(v_e ->> 'slot') || ' on the roster' END);
    ELSIF (v_stored ->> v_key) IS DISTINCT FROM v_pid AND NOT (v_displace ? v_key) THEN
      v_filled := v_filled || jsonb_build_object('slot', v_key, 'player_id', v_pid,
        'name', v_by_pid -> v_pid ->> 'name', 'position', v_by_pid -> v_pid ->> 'position',
        'order', v_by_pid -> v_pid -> 'order');
    END IF;
  END LOOP;

  -- STARTERS + flags + `locked_at`, 114 (10)'s shape byte-for-byte
  -- (`114:618-624` / `116:528-533`). `bench` = roster − starters − IR.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_map ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
    ELSE
      v_p := v_by_pid -> v_pid;
      v_started := v_started || v_pid;
      IF COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE) THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_held));

  -- THE NO-OP, BY VALUE. jsonb equality over the map — the same test
  -- `set_lineup` uses (`114:633`); the other three columns are projections of
  -- it, and arm (b) owns the kickoff refresh of an unchanged row.
  v_changed := (v_map IS DISTINCT FROM v_stored);
  v_reason := CASE
    WHEN v_changed THEN NULL
    WHEN jsonb_array_length(v_unfill) > 0 THEN 'nothing_fillable'
    ELSE 'no_change' END;

  -- 138 (L.E1.21): WHAT ORDERED THIS PASS, AND WHY A KEY WAS ABSENT (§4 rule
  -- 15; F389(a)). Over this pass's CANDIDATES: how many players each Q62 key
  -- ordered, every candidate with NO values row and every candidate whose row
  -- was STALE at `p_at` by name, and — when no candidate had any points key at
  -- all — that the pass FELL BACK TO ADP and the measured reason, never a
  -- quiet ADP order that looks like a projection order.
  -- THE CANDIDATES, NOT THE ROSTER (R1125, #316's fix round): only the men the
  -- pass actually OFFERED to the matcher un-fixed — `v_free`, `v_tail_d`,
  -- `v_tail`. An IR-held man, a seated (fixed) starter, a locked man and one
  -- the allow = FALSE filter refused are never ordered by this pass, so they
  -- are never counted: one valued IR man must not report "ordered by
  -- projection" for a pass whose every real candidate was ordered by ADP. A
  -- pass with NO candidate (an empty slot and nobody left to offer) says
  -- `candidates = 0` and did not fall back — nothing was ordered.
  SELECT jsonb_build_object(
           'candidates',        count(*),
           'by_key',            jsonb_build_object(
             'projected_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'projected_points'),
             'season_points',    count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'season_points'),
             'preseason_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'preseason_points'),
             'adp',              count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'adp'),
             'player_id',        count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'player_id')),
           'no_value_row',      COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row'), '[]'::jsonb),
           'stale_value_row',   COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row'), '[]'::jsonb),
           'max_age',           c_max_age::text,
           'fell_back_to_adp',  count(*) > 0 AND count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                                  IN ('projected_points', 'season_points', 'preseason_points')) = 0,
           'fallback_why',      CASE
             WHEN count(*) = 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                    IN ('projected_points', 'season_points', 'preseason_points')) > 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row') = count(*)
               THEN 'no_value_rows: league_player_values holds no row for any of this pass''s candidates for this league-week — the league-player-values job has not valued them; every candidate was ordered by ADP, then player_id (Q62 key 4)'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row') = count(*)
               THEN 'all_value_rows_stale: every one of this pass''s candidates'' league_player_values rows for this league-week was computed more than ' || c_max_age::text || ' before the tick instant — the job has stopped landing, so the rows were treated as absent (F387) and every candidate was ordered by ADP, then player_id'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'fresh') = 0
               THEN 'no_fresh_value_row: every candidate''s values row was absent or stale at the tick instant; every candidate was ordered by ADP, then player_id'
             ELSE 'no_points_in_any_value_row: fresh values rows exist but none carries a usable projected, season-to-date or preseason value (see each player''s order.projected_why); every candidate was ordered by ADP, then player_id' END)
  INTO v_basis
  FROM jsonb_array_elements(v_roster) e
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_free || v_tail_d || v_tail) c
                WHERE c ->> 'player_id' = e ->> 'player_id')
    -- 139 (L.E1.22, F392 / R1126): a vacated-then-RESTORED starter is back in
    -- `v_seated` and pass 2 skips him as seated, so the pass never ORDERED him —
    -- he is not a candidate, and counting him let one valued restored man
    -- report "ordered by projection" for a pass whose every real candidate
    -- was ordered by ADP (spec §7.2.1(c): "counted over the pass's candidates
    -- only").
    AND NOT ((e ->> 'player_id') = ANY (v_seated));

  RETURN jsonb_build_object(
    'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
    'source', 'autopilot',
    'slot_map', v_map, 'starters', v_starters, 'bench', v_bench, 'locked_at', v_locked_at,
    'filled', v_filled, 'substituted', v_subbed, 'unfillable', v_unfill,
    'skipped_locked', v_locked_out, 'restored', v_restored,
    'allow_illegal_lineups', v_allow,
    'order_basis', v_basis,
    'changed', v_changed, 'reason', v_reason, 'evaluated_at', p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
