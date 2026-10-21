-- ============================================================================
-- 205 — a player who is healthy again in an IR spot blocks the team's adds
--       until he leaves it (PROGRESS D593; spec v2.16.105 §7.3.2 / §11.2 /
--       §13.1 / §13.2; F687 discharged)
-- ============================================================================
--
-- THE RULINGS (Chris, 2026-10-20, verbatim):
--   "the only thing you can't do is put a player that's not injured into an
--   IR spot and then if you have a player that was in the IR spot but then
--   they became healthy again while they were there, most platforms block you
--   from doing anything until you put that injured player or that formerly
--   injured player out of your IR spot. So you either have to if your roster
--   is full, you either have to drop someone and move them out of the IR
--   spot, or you have to swap in another IR-eligible player into the IR spot
--   before you can make other roster moves."
--   "Okay, when I say roster moves, I mean adds and drops. You can still
--   change who's on your bench and who's in your starting lineup."
--   "The only time you can't move a player between your bench and your
--   starting lineup is because they've locked, because their game has
--   started for the week."
--
-- THE RULE. While one of a team's IR spots holds a player whose designation
-- is no longer one THAT spot takes (he got healthy, or his tag changed to one
-- the spot doesn't list — a DL spot takes Doubtful, a plain IR spot doesn't),
-- the team ADDS NOBODY: no free-agent add (alone or as an add + drop) and no
-- waiver claim — a new claim is refused when it is placed, and a claim already
-- pending fails at the waiver run with the reason `healthy_in_ir` (its owner
-- is told; nothing is spent; its waiver priority doesn't move). What stays
-- open — the ways out Chris names: a plain DROP (room on a full roster), and
-- every lineup / bench move, moving him out of the IR spot to the bench and
-- swapping an IR-eligible player into the spot included (set_lineup is not
-- touched — its kickoff locks stand). NOT blocked: trades (Chris: roster moves
-- "mean adds and drops"), and the commissioner's own roster tools (his
-- override verbs, untouched here — commissioner powers fix). A RESTRICTED-IR
-- spot whose stint still forbids moving him out does not block: the manager
-- can't fix it, so nothing is asked of him (spec §7.3.2 says so).
-- Judged at action time from the player's designation NOW
-- (`players.status` through 112's bridge) — no new job, no stored flag.
--
-- THE CHECK — ONE helper, `ir_healthy_blockers_internal(league, team,
-- current week)` (new, §1): the team's roster rows on an IR spot
-- (`ir_placed_week` set, `slot_key` = "<spot key>:0" of a configured spot)
-- whose bridged designation is not in that spot's `eligible_designations`,
-- less any whose Restricted stint still runs (`current < ir_lock_until_week`)
-- — exactly set_lineup's `ir_ineligible` test (112 / 201), at the roster
-- level. Returns them as a JSON array (empty = not blocked); each carries
-- `why` — "healthy", or "listed <designation>" — for the plain message.
--
-- THE BODIES — each CREATE OR REPLACE against its NEWEST defining migration's
-- FILE TEXT (D137; `grep -l -i -E "function[[:space:]]+(public[.])?<name>
-- [[:space:]]*[(]"` over 001–201: 199 for all four — 200 and 201 define none
-- of them; each file body's md5 equals the live prosrc on the local DB, head
-- 201), derived by derive_205.py. EVERY change is an INSERTED line ending
-- `-- 205 / D593` (no line of 199's text is altered or removed), so
-- pgTAP 155's pg_temp.un205 — drop every line carrying the tag — gives each
-- source back byte for byte and is an identity on every other body:
--   roster_add_drop_internal     199:5041-5577  md5 635060c5… → 2 hunks (+13)
--   waiver_claim_submit_internal 199:8040-8348  md5 382e6aec… → 2 hunks (+13)
--   process_waivers_internal     199:1345-1893  md5 9e3aecda… → 4 hunks (+34)
--   waiver_claim_notify_internal 199:1898-1987  md5 75f0fb9a… → 1 hunk  (+3)
--   1. roster_add_drop_internal: in THE ADD, right after the player is known,
--      a team with a healthy IR occupant is refused by name in plain words.
--      The drop side is untouched — a plain drop is never blocked.
--   2. waiver_claim_submit_internal: the same refusal, after the current week
--      is read and before the pickup lock — both arms (the manager, and a
--      commissioner acting for the team: the run would fail the claim; his
--      own roster tools stay open).
--   3. process_waivers_internal: right after the pending claims are locked
--      and BEFORE the input is built, every pending claim of a blocked team
--      settles invalid / healthy_in_ir (asserted one row each), its owner
--      notified — so the resolver (and its TS twin) never see it and the
--      player goes to the next claim in line; the resolver pair is not
--      touched. The run's summary counts them in `claims` and `invalid` and
--      names them in a new `healthy_in_ir` key; the input / result logs hold
--      only what the resolver decided.
--   4. waiver_claim_notify_internal: the notice for `healthy_in_ir`, in plain
--      words, names the IR player and why he no longer fits (the run passes
--      the helper's `name` / `why` as `ir_player` / `ir_why`).
--
-- WHAT IS UNCHANGED, STATED. IR placement (only a player holding one of the
-- spot's designations moves INTO it), Restricted-IR stints, per-player kickoff
-- locks (an IR man whose own game this week has kicked off can't leave the
-- spot until the NEXT week starts — set_lineup's IR-timing gate clears when
-- the current week flips, Wednesday 00:00 ET — and can't be dropped until the
-- week's last game ends; the block stands meanwhile, so from his kickoff to
-- the games' end the team can't add at all and from then to the new week only
-- a plain drop of him clears it — measured, PROGRESS F690, Chris's call),
-- position fit, one start per player per week, bye players never locked
-- (200), lineup saves never refused (201), set_lineup / commish_edit_lineup /
-- autopilot, the trade verbs and executor, commish_roster_override, every
-- other message. pgTAP 151 B3–B8 (lineup saves with a since-healthy IR man)
-- stay green: lineup moves are not blocked.
--
-- DEPLOY BEFORE PUSH. SQL only: one new PLAIN helper, four bodies, one column
-- comment; no signature, table, column, policy, index, grant, trigger,
-- realtime or cron change. The app ships the notice and disabled Adds first
-- (it computes the same rule from the rosters it already reads); until
-- Chris's `db push` production simply doesn't refuse yet.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): the helper is LANGUAGE sql, STABLE,
-- SECURITY INVOKER, search_path '', EXECUTE revoked from PUBLIC / anon /
-- authenticated (service_role / postgres as every internal), COMMENTed. The
-- four bodies keep their signatures, LANGUAGE plpgsql, VOLATILE, SECURITY
-- INVOKER (none is DEFINER — the `roster_add_drop` / `waiver_claim_submit` /
-- `waiver_tick` doors are, untouched), search_path '' and ACLs (REVOKEs
-- restated). No backfill. Typegen: unchanged (the helper is not exposed).
-- pgTAP 155_healthy_ir_blocks_adds.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ir_healthy_blockers_internal — the one check (new)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ir_healthy_blockers_internal(
  p_league  public.leagues,
  p_team_id UUID,
  p_current INTEGER
) RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'spot',               r.slot_key,
           'label',              COALESCE(sp.spot ->> 'label', 'IR'),
           'type',               sp.spot ->> 'type',
           'designation',        public.lineup_designation_internal(p.status),
           'why',                CASE WHEN public.lineup_designation_internal(p.status) IS NULL THEN 'healthy'
                                      ELSE 'listed ' || public.lineup_designation_internal(p.status) END,
           'eligible',           sp.spot -> 'eligible_designations',
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week)
         ORDER BY sp.ord, r.player_id), '[]'::jsonb)
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  JOIN jsonb_array_elements(COALESCE(p_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS sp(spot, ord)
    ON (sp.spot ->> 'key') || ':0' = r.slot_key
  WHERE r.league_id = p_league.id
    AND r.team_id = p_team_id
    AND r.ir_placed_week IS NOT NULL
    -- healthy, or tagged with a designation THIS spot doesn't take
    AND NOT COALESCE((sp.spot -> 'eligible_designations') ? public.lineup_designation_internal(p.status), FALSE)
    -- a Restricted stint still running: he can't leave, so he blocks nothing
    AND NOT COALESCE(r.ir_lock_until_week IS NOT NULL AND p_current < r.ir_lock_until_week, TRUE);
$$;
REVOKE EXECUTE ON FUNCTION ir_healthy_blockers_internal(public.leagues, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION ir_healthy_blockers_internal(public.leagues, UUID, INTEGER) IS
  'D593 / spec §7.3.2 (migration 205): the team''s IR occupants who no longer hold one of their spot''s eligible designations (healthy again, or tagged with one the spot does not take) — less any whose Restricted stint still runs at p_current — as a JSON array; empty = the team may add. While it is non-empty roster_add_drop refuses an add, waiver_claim_submit refuses a claim and the waiver run fails the team''s pending claims (healthy_in_ir). Drops, lineup moves, trades and the commissioner''s roster tools are not blocked.';

-- ---------------------------------------------------------------------------
-- 2. roster_add_drop_internal — 199:5041-5577 FILE TEXT (D137), 2 hunks (+13 / -0):
--    no add while a healthy player holds an IR spot.
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
  v_week_end      TIMESTAMPTZ;   -- 152 / F437: the current week's end (153: its lock release — Q78's ceiling)
  v_from_week     INTEGER;       -- 152 / F437: the first unfinished week
  v_ir_block      JSONB;   -- 205 / D593
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
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: league % has no season schedule yet, so there is no week to check game-day locks and pickup limits against',
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
    v_drop_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_drop, p_at);   -- 157 / F447: judged per player (played this week)
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
    -- D593 (Chris 2026-10-20): while a player who is healthy again holds one of   -- 205 / D593
    -- this team's IR spots (his designation is no longer one that spot takes),   -- 205 / D593
    -- the team adds nobody until he leaves it: to the bench (a plain drop makes   -- 205 / D593
    -- room on a full roster and is never blocked), or swapped for an IR-eligible   -- 205 / D593
    -- player. A Restricted stint still running does not block (he cannot leave).   -- 205 / D593
    v_ir_block := public.ir_healthy_blockers_internal(v_league, p_team_id, v_current);   -- 205 / D593
    IF jsonb_array_length(v_ir_block) > 0 THEN   -- 205 / D593
      RAISE EXCEPTION   -- 205 / D593
        'roster_add_drop: % is % and still in %''s IR spot — no adds while a player who isn''t IR-eligible holds an IR spot: move him to the bench (drop someone first if the roster is full), or swap an IR-eligible player into his spot (§7.3.2)',   -- 205 / D593
        v_ir_block -> 0 ->> 'name', v_ir_block -> 0 ->> 'why', v_team.name   -- 205 / D593
        USING ERRCODE = 'P0001';   -- 205 / D593
    END IF;   -- 205 / D593
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
    v_add_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_add, p_at);   -- 157 / F447: judged per player (played this week)
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
  -- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,
  -- or its Wednesday 00:00 Pacific ceiling when that comes first. The
  -- ceiling releases a played starter, so it must finish the week for
  -- lineups too: otherwise, in a league's LAST week (no week N+1 row to
  -- flip the current week), a move at the ceiling would clear his start.
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
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
REVOKE EXECUTE ON FUNCTION roster_add_drop_internal(UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. waiver_claim_submit_internal — 199:8040-8348 FILE TEXT (D137), 2 hunks (+13 / -0):
--    no new claim while a healthy player holds an IR spot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_submit_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT,
  p_drop      TEXT,
  p_bid       INTEGER,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_found        BOOLEAN;
  v_is_manager   BOOLEAN;
  v_is_commish   BOOLEAN;
  v_ledger       public.waiver_claim_actions;
  v_team         public.teams;
  v_reason       TEXT;
  v_waiver_type  TEXT;
  v_min_bid      INTEGER;
  v_bid          INTEGER;
  v_balance      INTEGER;
  v_has_seat     BOOLEAN;
  v_add_p        public.players;
  v_drop_p       public.players;
  v_owner        public.league_rosters;
  v_owner_team   public.teams;
  v_dup          public.waiver_claims;
  v_order        INTEGER;
  v_claim        public.waiver_claims;
  v_receipt      JSONB := NULL;
  v_result       JSONB;
  v_current      INTEGER;   -- 150 / F407
  v_add_lock     JSONB;     -- 150 / F407
  v_ir_block     JSONB;   -- 205 / D593
BEGIN
  -- (0) SHAPE — refused by name (22023), never answered as a no-op.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_team_id is required — a claim is made for one team'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_add is required — a claim names the player to add (§13.2)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add = p_drop THEN
    RAISE EXCEPTION 'waiver_claim_submit: add and drop name the same player (%) — a claim changes the roster (§13.2)', p_add
      USING ERRCODE = '22023';
  END IF;
  IF p_bid IS NOT NULL AND p_bid < 0 THEN
    RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is negative — bids are whole dollars from $0 up (§7.3.4)', p_bid
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST — the one serialization point shared with
  --     add/drop (115:410-414) and, from L.D2.9, the processor.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     The team's manager, or a commissioner / co-commissioner acting for
  --     ANY team (TD5). One no-leak 42501 for no league / not a member / not
  --     this team's manager and not a commissioner.
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'waiver_claim_submit: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099 / E2), after auth, before every business gate: the same
  --     action_id returns the stored result byte-identically, even if the
  --     league has moved on since. Verb- and team-scoped (R732).
  SELECT a.* INTO v_ledger
  FROM public.waiver_claim_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'waiver_claim_submit' OR v_ledger.team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION
        'waiver_claim_submit: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66; 131's normalisation verbatim). Only the
  --     commissioner arm stores it.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'waiver_claim_submit: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) LEAGUE STATE, re-read under the lock.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % is % — waiver claims are made only while the league is in season or in the playoffs (§13.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'waiver_claim_submit: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  v_waiver_type := COALESCE(v_league.waiver_type, 'faab');
  IF v_waiver_type = 'none_fcfs' THEN
    RAISE EXCEPTION
      'waiver_claim_submit: this league has no waivers (waiver type "none_fcfs") — every unowned player is first come, first served: add him directly (§7.3.4)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_waiver_type NOT IN ('faab', 'rolling_priority', 'reverse_standings') THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % has waiver type "%", which is not one of faab / rolling_priority / reverse_standings / none_fcfs (§7.3.4) — refusing rather than guessing how its claims are decided',
      p_league_id, v_waiver_type
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE ADD — known, and on NO roster in this league (exclusivity, the
  --     friendly refusal naming the team — never a raw 23505).
  SELECT p.* INTO v_add_p FROM public.players p WHERE p.id = p_add;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'waiver_claim_submit: no player with id % (add)', p_add USING ERRCODE = 'P0001';
  END IF;
  SELECT r.* INTO v_owner FROM public.league_rosters r
  WHERE r.league_id = p_league_id AND r.player_id = p_add;
  IF FOUND THEN
    SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_owner.team_id;
    RAISE EXCEPTION
      'waiver_claim_submit: % (%) is already on % — a player is on ONE roster per league (player exclusivity, §13.2); only an unowned player can be claimed',
      v_add_p.full_name, p_add,
      CASE WHEN v_owner.team_id = p_team_id THEN v_team.name || '''s own roster'
           ELSE COALESCE(v_owner_team.name, 'another team') || '''s roster' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (6b) 150 / F407 — Q74 AS RULED: "the app won't accept a new claim on a
  --      player whose game has kicked off". The add/drop helper at p_at
  --      (E32 / Q34(B)): locked from his own kickoff until the week's last
  --      game ends. Refused by name with the PICKUP LOCK'S message (149's
  --      add arm, verb-prefixed) — the manager reads one rule, whichever
  --      door he tried. (A claim already pending on him fails at the run —
  --      `add_locked`, the processor.)
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % has no season schedule yet, so there is no week to check the game-day lock against',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  -- D593 (Chris 2026-10-20): no new claim while a player who is healthy again   -- 205 / D593
  -- holds one of this team's IR spots — for the manager and for a commissioner   -- 205 / D593
  -- acting for the team alike (the run would fail it; the commissioner's own   -- 205 / D593
  -- roster tools are not blocked). A Restricted stint still running does not   -- 205 / D593
  -- block. A claim already pending fails at the run instead (healthy_in_ir).   -- 205 / D593
  v_ir_block := public.ir_healthy_blockers_internal(v_league, p_team_id, v_current);   -- 205 / D593
  IF jsonb_array_length(v_ir_block) > 0 THEN   -- 205 / D593
    RAISE EXCEPTION   -- 205 / D593
      'waiver_claim_submit: % is % and still in %''s IR spot — no claims while a player who isn''t IR-eligible holds an IR spot: move him to the bench (drop someone first if the roster is full), or swap an IR-eligible player into his spot (§7.3.2)',   -- 205 / D593
      v_ir_block -> 0 ->> 'name', v_ir_block -> 0 ->> 'why', v_team.name   -- 205 / D593
      USING ERRCODE = 'P0001';   -- 205 / D593
  END IF;   -- 205 / D593
  v_add_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_add, p_at);   -- 157 / F447: judged per player (played this week)
  IF (v_add_lock ->> 'locked')::boolean THEN
    RAISE EXCEPTION
      'waiver_claim_submit: % (%) is locked for adds — kicked off at % (%); week % clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
      v_add_p.full_name, p_add, v_add_lock ->> 'kickoff_at', v_add_lock ->> 'datum_arm',
      v_add_lock ->> 'week', COALESCE(v_add_lock ->> 'window_ends_at', 'an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked')
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE DROP — known, and on THIS team.
  IF p_drop IS NOT NULL THEN
    SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'waiver_claim_submit: no player with id % (drop)', p_drop USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_owner FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_drop;
    IF NOT FOUND OR v_owner.team_id <> p_team_id THEN
      RAISE EXCEPTION
        'waiver_claim_submit: % (%) is not on %''s roster — a claim can only drop one of the team''s own players (§13.2)',
        v_drop_p.full_name, p_drop, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (8) THE BID. FAAB: at least faab_min_bid, at most the seat's CURRENT
  --     balance (checked, never debited — TD2). Priority types: no money.
  v_bid := COALESCE(p_bid, 0);
  v_min_bid := COALESCE((v_league.settings ->> 'faab_min_bid')::int, 0);
  SELECT TRUE, m.faab_balance INTO v_has_seat, v_balance
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = p_team_id;
  IF v_waiver_type = 'faab' THEN
    IF v_bid < v_min_bid THEN
      RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is below this league''s minimum bid of $% (faab_min_bid, §7.3.4)', v_bid, v_min_bid
        USING ERRCODE = 'P0001';
    END IF;
    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        'waiver_claim_submit: % has no FAAB balance on record, so it can''t bid — ask the commissioner to set the team''s FAAB',
        v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    IF v_bid > v_balance THEN
      RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is more than %''s FAAB balance of $% (§13.2)', v_bid, v_team.name, v_balance
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_bid <> 0 THEN
    RAISE EXCEPTION
      'waiver_claim_submit: this league decides claims by waiver priority (%), not by bids — a claim carries no money here, so the bid must be $0 (got $%) (§13.2)',
      v_waiver_type, v_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- (9) AN IDENTICAL PENDING CLAIM — same team, same add, same drop.
  SELECT c.* INTO v_dup FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending'
    AND c.add_player_id = p_add AND c.drop_player_id IS NOT DISTINCT FROM p_drop;
  IF FOUND THEN
    RAISE EXCEPTION
      'waiver_claim_submit: % already has a pending claim for % (%)% — cancel it to change the bid or the order',
      v_team.name, v_add_p.full_name, p_add,
      CASE WHEN p_drop IS NULL THEN ' with no drop' ELSE ' dropping ' || v_drop_p.full_name || ' (' || p_drop || ')' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (10) WRITE — the claim at the back of this team's own order.
  SELECT COALESCE(max(c.claim_order), 0) + 1 INTO v_order
  FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending';

  INSERT INTO public.waiver_claims (
    league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order,
    status, action_id, created_by, created_at)
  VALUES (
    p_league_id, p_team_id, p_add, p_drop, v_bid, v_order,
    'pending', p_action_id, auth.uid(), p_at)
  RETURNING * INTO v_claim;

  -- (10b) 150 / F422(b): in a FAAB league a team's claims rank by BID —
  --       "your top choice is the choice you put the most money on"; its own
  --       order only settles EQUAL bids. The stored order is DERIVED from the
  --       bids (dense 1..n, stable within a bid — the new claim goes after
  --       the claims bidding as much or more), so what the manager sees is
  --       what the run does; the reorder verb refuses to break it.
  IF v_waiver_type = 'faab' THEN
    UPDATE public.waiver_claims c
    SET claim_order = o.rn
    FROM (SELECT c2.id, row_number() OVER (ORDER BY c2.faab_bid DESC, c2.claim_order, c2.created_at, c2.id)::int AS rn
          FROM public.waiver_claims c2
          WHERE c2.team_id = p_team_id AND c2.status = 'pending') o
    WHERE c.id = o.id AND c.claim_order <> o.rn;
    SELECT c.* INTO v_claim FROM public.waiver_claims c WHERE c.id = v_claim.id;
  END IF;

  -- (11) THE COMMISSIONER ARM (TD5): ONE audit row, the system post, the
  --      manager's notification — blind-safe (no player, no bid, league-side).
  IF NOT v_is_manager THEN
    v_receipt := public.waiver_claim_receipt_internal(
      p_league_id, v_team, 'submit_waiver_claim', 'submitted a waiver claim for',
      jsonb_build_array(v_claim.id), v_reason, p_action_id, 'waiver_claim_submit', v_league.season,
      'The commissioner placed a waiver claim for your team',
      'Claim: add ' || v_add_p.full_name
        || CASE WHEN p_drop IS NULL THEN '' ELSE ', drop ' || v_drop_p.full_name END
        || CASE WHEN v_waiver_type = 'faab' THEN ', bid $' || v_bid ELSE '' END
        || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
      jsonb_build_object('claim_id', v_claim.id, 'add_player_id', p_add, 'drop_player_id', p_drop, 'faab_bid', v_bid));
  END IF;

  v_result := jsonb_build_object(
    'verb',                   'waiver_claim_submit',
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'claim', jsonb_build_object(
      'id',             v_claim.id,
      'add_player_id',  v_claim.add_player_id,
      'drop_player_id', v_claim.drop_player_id,
      'faab_bid',       v_claim.faab_bid,
      'claim_order',    v_claim.claim_order,
      'status',         v_claim.status,
      'process_at',     v_claim.process_at,
      'created_at',     v_claim.created_at),
    'add_player_name',        v_add_p.full_name,
    'drop_player_name',       v_drop_p.full_name,
    'waiver_type',            v_waiver_type,
    'faab_min_bid',           CASE WHEN v_waiver_type = 'faab' THEN v_min_bid END,
    'faab_balance',           CASE WHEN v_waiver_type = 'faab' THEN v_balance END,
    'faab_spent',             0,
    'faab_spent_why',         'a claim spends nothing when it is placed — the bid is checked against the balance now and debited only if the claim WINS at the waiver run (TD2)',
    'settled_by',             'the next waiver run — the drop''s lock, roster room, caps and competing bids are decided there; a player whose game has started is refused here (F407)',
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'notified_user_id',       v_receipt ->> 'notified_user_id',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.waiver_claim_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, 'waiver_claim_submit', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_submit_internal(UUID, UUID, TEXT, TEXT, INTEGER, UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. process_waivers_internal — 199:1345-1893 FILE TEXT (D137), 4 hunks (+34 / -0):
--    a blocked team's pending claims fail before the decision.
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
  v_week_end    TIMESTAMPTZ;   -- 152 / F437: the current week's end (153: its lock release — Q78's ceiling)
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
  v_ir_block    JSONB;   -- 205 / D593
  v_ir_failed   INTEGER := 0;   -- 205 / D593
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
  -- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,
  -- or its Wednesday 00:00 Pacific ceiling when that comes first. The
  -- ceiling releases a played starter, so it must finish the week for
  -- lineups too: otherwise, in a league's LAST week (no week N+1 row to
  -- flip the current week), a move at the ceiling would clear his start.
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
  WHERE w.season = v_league.season AND w.week = v_current;
  v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;

  -- (3) THE INPUT.
  v_tb := COALESCE(v_league.settings ->> 'faab_tiebreaker', 'rolling_priority');   -- 160 / L.D2.17: no stored key => the rolling order (Chris 2026-09-29)
  v_persists := v_type = 'rolling_priority' OR (v_type = 'faab' AND v_tb = 'rolling_priority');
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_size;                                                   -- 115's capacity, exactly
  v_capw_txt := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_caps_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_hold_hours := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);

  PERFORM 1 FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending' FOR UPDATE;
   -- 205 / D593
  -- D593 (Chris 2026-10-20): a team with a player who is healthy again in one   -- 205 / D593
  -- of its IR spots gets nobody at this run. Each of its pending claims fails   -- 205 / D593
  -- HERE, before the decision — invalid / healthy_in_ir, nothing spent, its   -- 205 / D593
  -- owner told, its waiver priority unmoved — so the player goes to the next   -- 205 / D593
  -- claim in line. Judged from each designation now; a Restricted stint still   -- 205 / D593
  -- running does not block.   -- 205 / D593
  FOR v_claim IN   -- 205 / D593
    SELECT c.* FROM public.waiver_claims c   -- 205 / D593
    WHERE c.league_id = p_league_id AND c.status = 'pending'   -- 205 / D593
    ORDER BY c.team_id, c.claim_order, c.id   -- 205 / D593
  LOOP   -- 205 / D593
    v_ir_block := public.ir_healthy_blockers_internal(v_league, v_claim.team_id, v_current);   -- 205 / D593
    CONTINUE WHEN jsonb_array_length(v_ir_block) = 0;   -- 205 / D593
    UPDATE public.waiver_claims c   -- 205 / D593
    SET status = 'invalid', result_reason = 'healthy_in_ir', processed_at = p_at, process_at = v_run_at   -- 205 / D593
    WHERE c.id = v_claim.id AND c.status = 'pending';   -- 205 / D593
    GET DIAGNOSTICS v_cnt = ROW_COUNT;   -- 205 / D593
    IF v_cnt <> 1 THEN   -- 205 / D593
      RAISE EXCEPTION 'process_waivers: failing claim % (a healthy player in an IR spot) touched % rows, expected 1', v_claim.id, v_cnt   -- 205 / D593
        USING ERRCODE = 'P0001';   -- 205 / D593
    END IF;   -- 205 / D593
    v_ir_failed := v_ir_failed + 1;   -- 205 / D593
    v_invalid := v_invalid + 1;   -- 205 / D593
    IF public.waiver_claim_notify_internal(v_league, v_claim, 'invalid', 'healthy_in_ir',   -- 205 / D593
         jsonb_build_object('run_at', v_run_at, 'ir_player', v_ir_block -> 0 ->> 'name', 'ir_why', v_ir_block -> 0 ->> 'why')) IS NOT NULL THEN   -- 205 / D593
      v_notified := v_notified + 1;   -- 205 / D593
    END IF;   -- 205 / D593
  END LOOP;   -- 205 / D593

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
  -- every draft type — 098's draft_start writes it for an auction too).
  SELECT d.draft_order INTO v_draft_raw
  FROM public.drafts d
  WHERE d.league_id = p_league_id AND NOT d.is_mock AND d.status = 'complete'
  ORDER BY d.completed_at DESC NULLS LAST, d.id
  LIMIT 1;
  FOR v_x IN SELECT e FROM jsonb_array_elements(COALESCE(v_draft_raw, '[]'::jsonb)) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = (v_x #>> '{}')::uuid;
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
  )
  -- 157 / F447: judged per PLAYER — a player the NFL released or traded
  -- after he played this week is locked at the run (Q73 / Q74).
  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id COLLATE "C"), '[]'::jsonb) INTO v_locked
  FROM public.players p JOIN claim_players cp ON cp.pid = p.id
  WHERE (public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p.id, p_at) ->> 'locked')::boolean;

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
  -- D593: the claims failed before the decision count in the run too.   -- 205 / D593
  v_n := v_n + v_ir_failed;   -- 205 / D593

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
    'healthy_in_ir', v_ir_failed,   -- 205 / D593
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
-- 5. waiver_claim_notify_internal — 199:1898-1987 FILE TEXT (D137), 1 hunk (+3 / -0):
--    the healthy_in_ir notice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_notify_internal(
  p_league public.leagues,
  p_claim  public.waiver_claims,
  p_status TEXT,
  p_reason TEXT,
  p_extra  JSONB    -- {winner_team_id, winning_bid, faab_before, faab_after, transaction_id, run_at}
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_team      public.teams;
  v_live      public.teams;
  v_user      UUID;
  v_add       TEXT;
  v_drop      TEXT;
  v_winner    TEXT;
  v_faab      BOOLEAN := COALESCE(p_league.waiver_type, 'faab') = 'faab';
  v_title     TEXT;
  v_body      TEXT;
BEGIN
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_claim.team_id;
  v_live := v_team;
  SELECT m.user_id INTO v_user
  FROM public.league_members m
  WHERE m.league_id = p_league.id AND m.team_id = v_live.id AND m.user_id IS NOT NULL;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.full_name INTO v_add FROM public.players p WHERE p.id = p_claim.add_player_id;
  v_add := COALESCE(v_add, p_claim.add_player_id);
  IF p_claim.drop_player_id IS NOT NULL THEN
    SELECT p.full_name INTO v_drop FROM public.players p WHERE p.id = p_claim.drop_player_id;
    v_drop := COALESCE(v_drop, p_claim.drop_player_id);
  END IF;
  SELECT t.name INTO v_winner FROM public.teams t WHERE t.id = (p_extra ->> 'winner_team_id')::uuid;

  IF p_status = 'won' THEN
    v_title := 'Waiver claim won: ' || v_add;
    v_body := 'You claimed ' || v_add
      || CASE WHEN v_faab THEN ' for $' || p_claim.faab_bid ELSE '' END
      || CASE WHEN v_drop IS NOT NULL THEN ', dropping ' || v_drop ELSE '' END
      || '. He is on your bench.'
      || CASE WHEN v_faab THEN ' FAAB left: $' || (p_extra ->> 'faab_after') || '.' ELSE '' END;
  ELSIF p_status = 'lost' THEN
    v_title := 'Waiver claim lost: ' || v_add;
    v_body := v_add || ' went to ' || COALESCE(v_winner, 'another team')
      || CASE WHEN p_reason = 'outbid' THEN
                CASE WHEN v_faab THEN ' for $' || (p_extra ->> 'winning_bid') || ' — you bid $' || p_claim.faab_bid ELSE '' END
              ELSE CASE WHEN v_faab THEN ' at the same bid of $' || p_claim.faab_bid || ', on waiver priority' ELSE ' on waiver priority' END
         END
      || '. Nothing was spent.';
  ELSE
    v_title := 'Waiver claim didn''t go through: ' || v_add;
    v_body := CASE p_reason
      WHEN 'team_retired'      THEN v_team.name || ' was retired before waivers ran, so its claim for ' || v_add
                                    || ' was dropped. Put in a new claim for ' || v_live.name || ' if you still want him.'
      WHEN 'add_rostered'      THEN v_add || ' was already on a roster when waivers ran.'
      WHEN 'add_locked'        THEN v_add || '''s game had already started when waivers ran — a player is locked from kickoff until the week''s last game ends.'
      WHEN 'drop_gone'         THEN v_drop || ' was no longer on your roster when waivers ran, so the claim for ' || v_add || ' could not drop him.'
      WHEN 'drop_locked'       THEN v_drop || '''s game had already started when waivers ran — a player who has kicked off can''t be dropped, so the claim for ' || v_add || ' failed.'
      WHEN 'roster_full'       THEN 'Your roster was full when the claim for ' || v_add || ' came up — add a drop to the claim next time.'
      WHEN 'cap_reached'       THEN 'You had used all your pickups allowed (the league''s acquisition limit) when the claim for ' || v_add || ' came up.'
      WHEN 'insufficient_faab' THEN 'Your bid of $' || p_claim.faab_bid || ' for ' || v_add || ' was more than the FAAB you had left when it came up ($'
                                    || COALESCE(p_extra ->> 'faab_before', '?') || ').'
      WHEN 'own_claim_won'     THEN 'You won ' || v_add || ' with another of your claims, so this one wasn''t needed.'
      WHEN 'no_waivers'        THEN 'This league switched to no waivers, so pending claims were closed. ' || v_add || ' can be added directly if he is still available.'
      WHEN 'healthy_in_ir'     THEN COALESCE(p_extra ->> 'ir_player', 'A player') || ' was ' || COALESCE(p_extra ->> 'ir_why', 'healthy')   -- 205 / D593
                                    || ' and still in your IR spot when waivers ran, so the claim for ' || v_add   -- 205 / D593
                                    || ' didn''t go through — move him to your bench or swap an IR-eligible player into his spot before adding players.'   -- 205 / D593
      ELSE 'The claim for ' || v_add || ' could not go through (' || COALESCE(p_reason, 'unknown') || ').'
    END || ' Nothing was spent.';
  END IF;

  PERFORM public.notify_league_member_internal(
    v_user, 'league_waiver_claim', v_title, v_body,
    jsonb_build_object(
      'league_id',      p_league.id,
      'team_id',        p_claim.team_id,
      'claim_id',       p_claim.id,
      'status',         p_status,
      'reason',         p_reason,
      'add_player_id',  p_claim.add_player_id,
      'drop_player_id', p_claim.drop_player_id,
      'faab_bid',       CASE WHEN v_faab THEN p_claim.faab_bid END,
      'run_at',         p_extra -> 'run_at',
      'transaction_id', p_extra -> 'transaction_id',
      'winner_team_id', p_extra -> 'winner_team_id',
      'winning_bid',    CASE WHEN v_faab THEN p_extra -> 'winning_bid' END));
  RETURN v_user;
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_notify_internal(public.leagues, public.waiver_claims, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. the stored-reason vocabulary learns healthy_in_ir (150's comment, restated)
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN waiver_claims.result_reason IS
  'Why a claim did not go through, or how it closed (145 / 150 / 205): lost = outbid | lost_on_priority; invalid = team_retired | add_rostered | add_locked | drop_gone | drop_locked | roster_full | cap_reached | insufficient_faab | own_claim_won (the resolver''s vocabulary, FAIL_CHECK_ORDER) | no_waivers (the league switched to none_fcfs — F421(e)) | healthy_in_ir (205 / D593: the team still had a healthy player in an IR spot when the run came — failed before the decision); cancelled = cancelled (the verb) | seat_vacated | manager_left (F411). NULL for a pending or won claim.';
