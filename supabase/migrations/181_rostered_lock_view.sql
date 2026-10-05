-- ============================================================================
-- 181 — every rostered player is in the lock view (live bug 2026-10-05;
--       PROGRESS D496; FULL rigour — locks)
-- ============================================================================
--
-- THE DEFECT (reported live on Week 4). My Team showed some players locked
-- and others not, though every game had been played. The editor's lock is
-- the server's own pool view — `league_player_pool.locked_until`, refreshed
-- each minute by `lineup_lock_tick` arm (a) (spec §13.1's annotation, §14's
-- lineup-lock row; D315(5)). Arm (a) iterates the pool's EXISTING rows, and
-- pool rows are lazy (109 §4, D294): a player gets one only by passing
-- through the pool — an add, a claim, a drop. A DRAFTED player (072 writes
-- `league_rosters` only) has no row, so the view never judged him: the
-- rosters route read him as `unlocked`, while `set_lineup` — which judges
-- from `nfl_games` at call time (§7.3.4 / §11.2, never from the view) —
-- refused to move him. Measured read-only on the live league: 188 of 193
-- rostered players had no pool row (all `draft`); the 5 with rows were all
-- free-agent pickups, and exactly those showed the lock. The enforcement
-- was right throughout; the DISPLAY disagreed with it.
--
-- THE FIX — one hunk in the tick. Before arm (a), each in-season league's
-- rostered players without a pool row get one in the D294 mirror's own
-- shape (`rostered`, `waivers_until` NULL, `locked_until` NULL); arm (a)
-- then judges them in the same pass, exactly as it judges every other row,
-- and its existing diff-aware UPDATE + coalesced broadcast reach an open
-- page. An existing row of ANY state is left alone (ON CONFLICT DO
-- NOTHING), so no writer's waiver / free-agent state is touched and no
-- writer's pre-read can observe a row it did not expect inside its own
-- transaction (the tick runs in its own). Self-healing for every league,
-- every future draft, and the live league on the first minute after push —
-- no separate backfill.
--
-- D137: `lineup_lock_tick` is CREATE OR REPLACE against its NEWEST defining
-- FILE TEXT, 157:3238-3718 (definers 116 / 119 / 125 / 138 / 139 / 157 —
-- `grep -n "FUNCTION lineup_lock_tick" supabase/migrations/*` — 157 newest),
-- with ONE hunk (+12 / -0) inserted before the "(a) THE POOL VIEW" comment
-- and not one other byte (derive_181.py asserts the anchor occurs once).
-- Lock semantics are UNCHANGED: what locks, when, and when it releases are
-- 153 / 157's helpers, unedited; the view only covers more players.
--
-- CHECKLIST (tasks-M* §4.4): no table / column / policy / grant change; the
-- tick keeps SECURITY DEFINER + search_path '' and its REVOKE is restated.
-- The new rows are within §12.19's CHECKs (state 'rostered', waivers_until
-- NULL). Reconciliation's D294 `pool_mirror_broken` reads a rostered row
-- WITH a roster row as consistent — these rows are. Deploy-before-push
-- safe: no client change; until the push the display keeps today's gap.
-- No R6 / D38 waiver needed. pgTAP 129_rostered_lock_view.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION lineup_lock_tick(
  p_now       TIMESTAMPTZ DEFAULT now(),
  p_league_id UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_seen           UUID[] := '{}';
  v_loops          INTEGER := 0;
  v_pass           INTEGER;
  v_lg             RECORD;
  v_league         public.leagues;
  v_current        INTEGER;
  v_pool           RECORD;
  v_lock           JSONB;
  v_new_until      TIMESTAMPTZ;
  v_new_state      TEXT;
  v_row            RECORD;
  v_e              JSONB;
  v_pid            TEXT;
  v_team           TEXT;
  v_k              RECORD;
  v_new_locked_at  TIMESTAMPTZ;
  v_new_starters   JSONB;
  v_changed        BOOLEAN;
  v_cnt            INTEGER;
  v_leagues        INTEGER := 0;
  v_pool_rows      INTEGER := 0;
  v_pool_updates   INTEGER := 0;
  v_lineups        INTEGER := 0;
  v_lineup_updates INTEGER := 0;
  v_pool_changed   INTEGER := 0;   -- 119: THIS league's pool rows changed this pass — the coalescing key (D296/F252(a))
  v_pool_events    INTEGER := 0;   -- 119: pool broadcasts sent this run (one per league per pass that changed ≥ 1 row)
  v_skipped        JSONB := '[]'::jsonb;
  v_failures       JSONB := '[]'::jsonb;
  -- 125 (H1) — AUTOPILOT, arm (c). D337/D338/D339/D340/D354.
  v_ap_off         BOOLEAN;        -- the kill switch, read ONCE per invocation (H2)
  v_ap             RECORD;
  v_ap_r           JSONB;
  v_ap_seats       INTEGER := 0;   -- unmanaged seats arm (c) EVALUATED
  v_ap_writes      INTEGER := 0;   -- lineup rows arm (c) wrote
  v_ap_no_member   INTEGER := 0;   -- teams declined: no league_members row at all (D339)
  v_ap_no_row      INTEGER := 0;   -- seats that REACHED the materialize step and STILL had no row (R998/R999: counted after the carry, never on the D339 path)
  v_autopiloted    JSONB := '[]'::jsonb;
  v_ap_mat         JSONB := '[]'::jsonb;
  v_ap_unfill      JSONB := '[]'::jsonb;
  v_ap_locked      JSONB := '[]'::jsonb;
  -- 139 (L.E1.22, Q63 RULED): the per-team switch. An unmanaged seat whose
  -- switch is OFF — the DEFAULT — is COMMISSIONER-MANAGED: materialized (D354)
  -- but never filled, and NAMED here rather than read as a quiet zero.
  v_ap_cm          INTEGER := 0;   -- unmanaged seats left alone because the switch is OFF
  v_ap_cm_list     JSONB := '[]'::jsonb;
BEGIN
  -- A job, not a user verb: a JWT-bearing caller is refused in-body (rule 2
  -- — the REVOKE below narrows EXECUTE; this says why in the body).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'lineup_lock_tick: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  -- 125 (H2) — THE KILL SWITCH, read ONCE per invocation and not once per
  -- league (item 4b). `system_flags` is world-SELECT with NO WRITE POLICY FOR
  -- ANY ROLE (122:111-114), so an operator disables autopilot with a
  -- `service_role` write and nothing else:
  --     insert into system_flags (key, value)
  --     values ('autopilot_disabled', '{"disabled": true}')
  --     on conflict (key) do update set value = excluded.value, updated_at = now();
  -- Deleting the row re-enables it at the next minute. Nothing else in the
  -- tick is affected: the pool view and the lineup record keep running.
  SELECT COALESCE((f.value ->> 'disabled')::boolean, FALSE) INTO v_ap_off
  FROM public.system_flags f
  WHERE f.key = 'autopilot_disabled';
  v_ap_off := COALESCE(v_ap_off, FALSE);

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      BEGIN
        v_pool_changed := 0;
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;
        v_current := public.lineup_current_week_internal(v_lg.id, p_now);
        IF v_current IS NULL THEN
          v_skipped := v_skipped || jsonb_build_object('league_id', v_lg.id, 'reason', 'no_league_weeks');
          CONTINUE;
        END IF;

        -- 181 (D496): every ROSTERED player has a pool row before the view
        -- runs. A drafted player never passed through the pool (072's draft
        -- writes league_rosters only; pool rows are lazy, D294), so the view
        -- below never judged him and My Team showed him unlocked while
        -- set_lineup refused him. The row is the D294 mirror's own shape
        -- ('rostered'); an existing row of any state is left alone.
        INSERT INTO public.league_player_pool (league_id, player_id, state, updated_at)
        SELECT r.league_id, r.player_id, 'rostered', p_now
        FROM public.league_rosters r
        WHERE r.league_id = v_lg.id
        ON CONFLICT (league_id, player_id) DO NOTHING;

        -- (a) THE POOL VIEW — what 115's helper says, and nothing else.
        FOR v_pool IN
          SELECT pp.player_id, pp.state, pp.locked_until, p.team AS nfl_team
          FROM public.league_player_pool pp
          JOIN public.players p ON p.id = pp.player_id
          WHERE pp.league_id = v_lg.id
          ORDER BY pp.player_id
        LOOP
          v_pool_rows := v_pool_rows + 1;
          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);
          -- 157 / F447: the view agrees with the lock every writer enforces —
          -- per PLAYER: unlocked by his current team, but he PLAYED this week
          -- (a start recorded for a real kickoff, or his stat line) ⇒ locked.
          IF NOT (v_lock ->> 'locked')::boolean THEN
            v_lock := COALESCE(public.lineup_played_lock_internal(v_lg.id, v_league.season, v_current, v_pool.player_id, p_now), v_lock);
          END IF;
          IF (v_lock ->> 'locked')::boolean THEN
            -- Locked: until the week's recorded last game end — or 'infinity'
            -- while that end is NOT YET RECORDED (F238's loud state; never a
            -- NULL that reads as unlocked, never a release the helper did
            -- not compute).
            v_new_until := COALESCE((v_lock ->> 'window_ends_at')::timestamptz, 'infinity'::timestamptz);
          ELSE
            v_new_until := NULL;
          END IF;
          v_new_state := CASE
            WHEN v_pool.state = 'free_agent'     AND v_new_until IS NOT NULL THEN 'locked_in_game'
            WHEN v_pool.state = 'locked_in_game' AND v_new_until IS NULL     THEN 'free_agent'
            ELSE v_pool.state END;   -- on_waivers / rostered keep their state (F222(a) CHECK; D294 mirror)
          IF v_new_until IS DISTINCT FROM v_pool.locked_until
             OR v_new_state IS DISTINCT FROM v_pool.state THEN
            UPDATE public.league_player_pool pp
            SET locked_until = v_new_until, state = v_new_state, updated_at = p_now
            WHERE pp.league_id = v_lg.id AND pp.player_id = v_pool.player_id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: pool refresh for % touched % rows, expected 1', v_pool.player_id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_pool_updates := v_pool_updates + 1;
            v_pool_changed := v_pool_changed + 1;
          END IF;
        END LOOP;

        -- 119 (D296 / F252(a)): the pool's ONE broadcast — a per-league
        -- SUMMARY sent once per pass, only when this pass changed at least
        -- one pool row (a kickoff or a release instant; the guarded UPDATE
        -- above is diff-aware, so a quiet minute sends nothing). Never a
        -- row trigger (a slate kickoff would be one event per locked
        -- player per league — the broadcast storm §22.2 coalesces away),
        -- never per-player lines: the client refetches the rosters route.
        -- The 088 per-STATEMENT summary precedent: event = the table's
        -- name, `operation` UPDATE, `record` = the summary. realtime.send
        -- traps its own errors (070 banner) — an outage never fails a tick.
        IF v_pool_changed > 0 THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'operation', 'UPDATE',
              'table',     'league_player_pool',
              'schema',    'public',
              'record',    jsonb_build_object(
                'season',  v_league.season,
                'week',    v_current,
                'changed', v_pool_changed,
                'at',      p_now)),
            'league_player_pool',
            'league:' || v_lg.id::text,
            true);
          v_pool_events := v_pool_events + 1;
        END IF;

        -- (b) THE LINEUP RECORD — locked_at + each starter's kickoff_at,
        --     re-evaluated from nfl_games at p_now (E42: a moved kickoff
        --     moves the record; E43: a postponed-out kickoff releases it).
        FOR v_row IN
          SELECT tl.id, tl.week, tl.starters, tl.locked_at
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id
          JOIN public.league_weeks lw
            ON lw.league_id = t.league_id AND lw.season = tl.season AND lw.week = tl.week
          WHERE t.league_id = v_lg.id
            AND tl.season = v_league.season
            AND tl.week <= v_current
            AND lw.status <> 'final'
            AND tl.slot_map IS NOT NULL
          ORDER BY tl.week, tl.team_id
        LOOP
          v_lineups := v_lineups + 1;
          v_new_locked_at := NULL;
          v_new_starters := '[]'::jsonb;
          v_changed := FALSE;
          FOR v_e IN SELECT * FROM jsonb_array_elements(v_row.starters) LOOP
            v_pid := v_e ->> 'player_id';
            IF v_pid IS NULL THEN
              v_new_starters := v_new_starters || v_e;
              CONTINUE;
            END IF;
            SELECT p.team INTO v_team FROM public.players p WHERE p.id = v_pid;
            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);
            -- 157 / F447: a PASSED kickoff this record holds STAYS when it is a
            -- real kickoff of the week and his current team's game is not
            -- postponed — he played, and the NFL has released or traded him
            -- since: never re-read to NULL or to his new team's later game.
            -- A flexed or postponed game still moves it (E42 / E43).
            IF (v_e ->> 'kickoff_at')::timestamptz IS DISTINCT FROM v_k.kickoff_at
               AND public.lineup_record_kicked_off_internal(v_league.season, v_row.week, v_pid, (v_e ->> 'kickoff_at')::timestamptz, p_now) THEN
              v_k.kickoff_at := (v_e ->> 'kickoff_at')::timestamptz;
            END IF;
            -- Compare INSTANTS, not rendered text (a session TimeZone renders
            -- the same instant differently — idempotence must not depend on it).
            IF (v_e ->> 'kickoff_at')::timestamptz IS DISTINCT FROM v_k.kickoff_at THEN
              v_changed := TRUE;
              v_new_starters := v_new_starters || (v_e || jsonb_build_object('kickoff_at', v_k.kickoff_at));
            ELSE
              v_new_starters := v_new_starters || v_e;
            END IF;
            IF v_k.kickoff_at IS NOT NULL THEN
              v_new_locked_at := LEAST(v_new_locked_at, v_k.kickoff_at);
            END IF;
          END LOOP;
          IF v_changed OR v_new_locked_at IS DISTINCT FROM v_row.locked_at THEN
            UPDATE public.team_lineups tl
            SET locked_at = v_new_locked_at,
                starters  = CASE WHEN v_changed THEN v_new_starters ELSE tl.starters END
            WHERE tl.id = v_row.id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: lineup record refresh for % touched % rows, expected 1', v_row.id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_lineup_updates := v_lineup_updates + 1;
          END IF;
        END LOOP;

        -- 125 (H3) — (c) AUTOPILOT for a seat with NO MANAGER (§7.2.1(c),
        --     `spec:185`). Its OWN driving query, because (b) reads FROM
        --     `team_lineups` and a seat with no row for the week is invisible
        --     to it (D354). Inside the same per-league loop, so it inherits
        --     the `leagues FOR UPDATE SKIP LOCKED` row lock and the
        --     failure containment below — a league whose autopilot raises
        --     lands in `failures[]` and the next league still runs.
        IF NOT v_ap_off THEN
          FOR v_ap IN
            SELECT t.id AS team_id,
                   tl.id AS lineup_id,
                   EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = t.id) AS has_member,
                   -- 139 (L.E1.22, Q63): the commissioner's per-team switch —
                   -- NO ROW IS OFF (the ruled default; no backfill).
                   COALESCE((SELECT sw.is_on FROM public.team_autopilot sw WHERE sw.team_id = t.id), FALSE) AS autopilot_on
            FROM public.teams t
            JOIN public.league_weeks lw
              ON lw.league_id = t.league_id
             AND lw.season = v_league.season
             AND lw.week = v_current
            LEFT JOIN public.team_lineups tl
              ON tl.team_id = t.id
             AND tl.season = v_league.season
             AND tl.week = v_current
            WHERE t.league_id = v_lg.id
              AND t.status <> 'retired'
              -- NEVER a past week in correction_window: `tl.week = v_current`
              -- does not imply `live` (112:360-374 derives v_current from
              -- nfl_weeks.starts_at, so the current week sits in
              -- correction_window from the last whistle until finalize, and
              -- filling it then is a scoring rewrite).
              AND lw.status = 'live'
              -- D339: the exact complement of set_lineup's own auth
              -- (114:240-243). Covers the placeholder seat AND the vacated
              -- seat with no OR, because they converge in this table.
              AND NOT EXISTS (
                SELECT 1 FROM public.league_members m
                WHERE m.team_id = t.id AND m.user_id IS NOT NULL)
            ORDER BY t.id
          LOOP
            -- D339's UNSAFE FAILURE DIRECTION, asserted and not inferred: the
            -- predicate above is ALSO true of a team with NO member row at
            -- all, and autopilot would then seize a human's team. Declined,
            -- and NAMED.
            IF NOT v_ap.has_member THEN
              -- R999: this seat is DECLINED, and the report says exactly that.
              -- It does NOT touch `v_ap_no_row` — the decline happens BEFORE
              -- the materialize step is reached, so calling it "no row and no
              -- materialize" would report a failure that never happened
              -- (§4 rule 15's own shape, in the field built to abolish it).
              v_ap_no_member := v_ap_no_member + 1;
              v_skipped := v_skipped || jsonb_build_object(
                'league_id', v_lg.id, 'team_id', v_ap.team_id,
                'reason', 'no_league_members_row',
                'why', 'one league_members row per seat is a §12.2 invariant stated in code, not schema (120:558) — a seat with none is NOT proven unmanaged, so autopilot declines rather than seizing a human''s team (D339)');
              CONTINUE;
            END IF;

            -- D354: a seat with NO row for the live week — the mid-week
            -- `add_placeholder_seat` case (063:455-465) — is MATERIALIZED
            -- through the UNCHANGED carry and then filled. It is 0 rows
            -- because the week's one-shot carry loop (118:1816-1824) had
            -- ALREADY RUN for this week; the carry's own INSERT has no
            -- ON CONFLICT, so a concurrent materialize is a loud 23505 in
            -- `failures[]` rather than a silent second row (116:541-551).
            IF v_ap.lineup_id IS NULL THEN
              PERFORM public.lineup_carry_internal(v_lg.id, v_ap.team_id, v_league.season, v_current, p_now);
              -- THE MATERIALIZE IS ASSERTED, NOT ASSUMED (R999). The carry's
              -- contract is INSERT-or-RAISE (`116:541-551`), so this re-read
              -- can only come back empty if that contract is ever weakened —
              -- and THAT is what `no_row_and_no_materialize` means. Without
              -- this check the chooser below would raise P0002 into
              -- `failures[]` and the reason field would say nothing about the
              -- seat; with it, the pass NAMES the seat and why.
              IF NOT EXISTS (
                SELECT 1 FROM public.team_lineups tl
                WHERE tl.team_id = v_ap.team_id
                  AND tl.season = v_league.season
                  AND tl.week = v_current)
              THEN
                v_ap_no_row := v_ap_no_row + 1;
                v_skipped := v_skipped || jsonb_build_object(
                  'league_id', v_lg.id, 'team_id', v_ap.team_id, 'week', v_current,
                  'reason', 'no_row_and_no_materialize',
                  'why', 'lineup_carry_internal returned without leaving a team_lineups row for this (team, season, week) — its own contract is INSERT-or-RAISE (116:541-551), so this is a contract violation reported rather than a 0-row UPDATE read as "nothing to do" (§4 rule 15)');
                CONTINUE;
              END IF;
              v_ap_mat := v_ap_mat || jsonb_build_object(
                'league_id', v_lg.id, 'team_id', v_ap.team_id, 'week', v_current,
                'why_absent', 'the week''s one-shot auto-carry (118:1816-1824) had already run when this seat was minted');
            END IF;

            -- 139 (L.E1.22, Q63 RULED 2026-09-27): "the default would be the
            -- commissioner has to manage the team, but give the [commissioner]
            -- a button that lets them put the team on autopilot." A seat whose
            -- switch is OFF is left EXACTLY as the carry (or the commissioner)
            -- left it — never filled, never substituted — and it is NAMED, so
            -- an empty slot there reads as the ruled state ("that is fine"),
            -- never as autopilot having silently done nothing. It still passed
            -- the materialize step above (D354): a seat with NO row would hold a
            -- total_points week pending for ever (the worker writes no
            -- provisional row without one — score-week-worker.ts step (6b) —
            -- so week_results_pending_internal reports it), and a lineup row is
            -- what the commissioner's own override edits.
            IF NOT v_ap.autopilot_on THEN
              v_ap_cm := v_ap_cm + 1;
              v_ap_cm_list := v_ap_cm_list || jsonb_build_object(
                'league_id', v_lg.id, 'team_id', v_ap.team_id, 'week', v_current,
                'reason', 'unmanaged_autopilot_off',
                'why', 'unmanaged, autopilot off — commissioner-managed (Q63, ruled 2026-09-27): the seat has no manager and the commissioner has not switched autopilot on, so it plays the lineup it has and an empty slot scores zero',
                'materialized', v_ap.lineup_id IS NULL);
              CONTINUE;
            END IF;

            v_ap_r := public.lineup_autopilot_internal(
              v_lg.id, v_ap.team_id, v_league.season, v_current, p_now);
            v_ap_seats := v_ap_seats + 1;

            -- Reported whether or not anything was written: a refused slot and
            -- a locked candidate are facts about the pass, not about the write.
            FOR v_e IN SELECT * FROM jsonb_array_elements(v_ap_r -> 'unfillable') LOOP
              v_ap_unfill := v_ap_unfill || (v_e || jsonb_build_object('team_id', v_ap.team_id));
            END LOOP;
            FOR v_e IN SELECT * FROM jsonb_array_elements(v_ap_r -> 'skipped_locked') LOOP
              v_ap_locked := v_ap_locked || (v_e || jsonb_build_object('team_id', v_ap.team_id));
            END LOOP;

            IF (v_ap_r ->> 'changed')::boolean THEN
              -- The FOUR columns TOGETHER (116:543-546) — never `slot_map`
              -- alone: they are redundant projections of one truth and a
              -- partial write is silent until they disagree in front of a
              -- user. `set_at` / `edited_by_commish` are deliberately not
              -- touched (autopilot is a SYSTEM act — D338).
              UPDATE public.team_lineups tl
              SET slot_map  = v_ap_r -> 'slot_map',
                  starters  = v_ap_r -> 'starters',
                  bench     = v_ap_r -> 'bench',
                  locked_at = (v_ap_r ->> 'locked_at')::timestamptz
              WHERE tl.team_id = v_ap.team_id
                AND tl.season = v_league.season
                AND tl.week = v_current;
              GET DIAGNOSTICS v_cnt = ROW_COUNT;
              IF v_cnt <> 1 THEN
                RAISE EXCEPTION 'lineup_lock_tick: autopilot write for team % week % touched % rows, expected 1', v_ap.team_id, v_current, v_cnt
                  USING ERRCODE = 'P0001';
              END IF;
              v_ap_writes := v_ap_writes + 1;
              v_autopiloted := v_autopiloted || jsonb_build_object(
                'league_id',   v_lg.id,
                'team_id',     v_ap.team_id,
                'week',        v_current,
                'filled',      v_ap_r -> 'filled',
                'substituted', v_ap_r -> 'substituted',
                'restored',    v_ap_r -> 'restored',
                'slot_map',    v_ap_r -> 'slot_map',
                'locked_at',   v_ap_r -> 'locked_at',
                -- 138 (L.E1.21, R1122): the chooser's order_basis for this
                -- pass: which Q62 key ordered its candidates and, when none had
                -- a usable value, that it FELL BACK TO ADP and why (rule 15).
                'order_basis', v_ap_r -> 'order_basis',
                'materialized', v_ap.lineup_id IS NULL);
            END IF;
          END LOOP;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'lineup_lock_tick failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',             p_now,
    'scope',          p_league_id,
    'leagues',        v_leagues,
    'pool_rows',      v_pool_rows,
    'pool_updates',   v_pool_updates,
    'pool_events',    v_pool_events,
    'lineups',        v_lineups,
    'lineup_updates', v_lineup_updates,
    'skipped',        v_skipped,
    'failures',       v_failures,
    'loops',          v_loops,
    -- 125 (H4): autopilot's report. Every seat filled, every seat
    -- materialized, every slot refused AND WHY, every candidate left behind
    -- by the lock — and a reason when nothing was filled at all (§4 rule 15).
    'autopiloted',          v_autopiloted,
    'seats_materialized',   v_ap_mat,
    'autopilot_unfillable', v_ap_unfill,
    'skipped_locked',       v_ap_locked,
    -- 139 (L.E1.22, Q63): every unmanaged seat left alone because its switch
    -- is OFF, BY NAME — the commissioner manages it.
    'commissioner_managed', v_ap_cm_list,
    -- THE ARMS ARE ORDERED, AND THE ORDER IS THE POINT (R999, #295's fix
    -- round). Each arm names a condition that was actually MEASURED on this
    -- pass; none of them describes work the pass did not attempt.
    'autopilot_reason', CASE
      WHEN v_ap_off THEN 'disabled_by_system_flag:autopilot_disabled'
      WHEN v_ap_writes > 0 THEN NULL                       -- the arrays say what happened
      -- A seat that reached the materialize step and STILL had no row: the
      -- carry's INSERT-or-RAISE contract broke. Ahead of the `v_ap_seats = 0`
      -- arms because such a seat is CONTINUEd before `v_ap_seats` is
      -- incremented, and "no unmanaged seats" would then be a lie about it.
      WHEN v_ap_no_row > 0 THEN 'no_row_and_no_materialize'
      -- 139 (L.E1.22, Q63): the pass evaluated NO seat because every unmanaged
      -- seat it reached has its switch OFF. Ahead of the D339 decline arm:
      -- with an OFF seat present, "every unmanaged-looking seat was declined"
      -- would be false (`skipped[]` still names each declined team).
      WHEN v_ap_seats = 0 AND v_ap_cm > 0
        THEN 'every_unmanaged_seat_commissioner_managed_autopilot_off'
      -- EVERY unmanaged-LOOKING seat was declined for want of a
      -- `league_members` row (D339's unsafe failure direction). Before the
      -- fix round this fell through to `nothing_fillable` — "nothing was
      -- fillable" about seats the pass deliberately never evaluated — or, when
      -- the seat also had no lineup row, to `no_row_and_no_materialize`, a
      -- materialization failure that never happened. `skipped[]` names each
      -- team; this says why the pass as a whole was silent.
      WHEN v_ap_seats = 0 AND v_ap_no_member > 0
        THEN 'every_unmanaged_looking_seat_declined_no_league_members_row'
      -- Precisely worded on purpose: arm (c)'s driving query is bounded to
      -- `lw.status = 'live'`, so "saw nothing" also covers an unmanaged seat
      -- in a current week that has closed into `correction_window`. A bare
      -- "no unmanaged seats" there would be a plausible-looking silence about
      -- a seat that does exist (§4 rule 15).
      WHEN v_ap_seats = 0 THEN 'no_unmanaged_seats_in_a_live_current_week'
      WHEN jsonb_array_length(v_ap_unfill) = 0
           AND jsonb_array_length(v_ap_locked) > 0 THEN 'every_candidate_locked'
      ELSE 'nothing_fillable' END,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'no_in_season_leagues'
      -- 125 (H4): `v_ap_writes` joins the two 119 counters, so a pass that
      -- autopiloted can never report `no_changes`.
      WHEN v_pool_updates + v_lineup_updates + v_ap_writes = 0 THEN 'no_changes'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_lock_tick(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;
