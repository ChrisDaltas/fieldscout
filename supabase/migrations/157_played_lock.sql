-- ============================================================================
-- 157_played_lock.sql — a ROSTERED player's game-day lock is judged by
-- whether HE has played this week, not by his CURRENT NFL team alone
-- (PROGRESS F447 — R1216's live probe, R1234; task L.D2.16, FULL rigour —
-- locks decide who can move players and whose points a week keeps).
-- Spec §11.2 (per-player lock: "a locked slot's player never moves … a
-- player whose game has started never enters or changes slots"), §13.1 (the
-- game-day lock: "a player cannot be added or dropped from his own kickoff
-- until the week's last game has ended"), §13.2 (Q73 / Q74: a claim whose
-- drop or add has kicked off fails at the run / is refused at submit),
-- §13.3 (E35: a trade with a player who already played waits for the week's
-- end); §11.2's one-start bullet (v2.16.64) named F447 as its open
-- exception. PROGRESS D411, D412, D413 (154's `lineup_kept_starter_internal`
-- and its three "played" arms), D416 (156's `commish_trade_rescore_
-- internal`).
--
-- Numbering: reserved by the orchestrator and measured at build time (D161)
-- — `ls supabase/migrations | tail -1` → 156_commish_force_or_reverse_
-- trade.sql, `ls supabase/tests | tail -1` → 104_commish_force_or_reverse_
-- trade.sql; so 157 / pgTAP 105. NOT held: reaches production by `npx
-- supabase db push` only (push debt: 135–157).
--
-- THE DEFECT (R1216, reproduced live on 156): OS D One plays Thursday (his
-- stat line is in); the NFL trades him to a Sunday team (`players.team`
-- now names that team) or releases him (`players.team` NULL ⇒ read as a
-- bye). Every lock reader judged him from `players.team`, so at Sunday
-- 12:00 he read as NOT kicked off: his manager could bench him in the week
-- he already played (set_lineup step 7 / autopilot), DROP him (roster_add_
-- drop — the drop lock), and another team could ADD him (the add lock) and
-- START him the same week (set_lineup — a bench player whose game has
-- started never enters a slot) ⇒ his Thursday points MOVED to another team.
-- The one-start trigger (154) cannot see it: the old start was cleared by
-- the drop first. 139's tick made it worse: every minute it re-read each
-- starter's `starters[].kickoff_at` from `players.team`, so the lineup's own
-- record of his kickoff went back to NULL (release) or to the new team's
-- later game (trade). And the trade executor read the same lock, so a
-- manager-accepted or deferred trade could move him out of a live week
-- (R1234).
--
-- THE FIX — ONE PER-PLAYER JUDGMENT, THE SAME THREE RECORDS AS 154.
--   "Has he played this week?" is answered from (i) his CURRENT NFL team's
--   kickoff (the team read every lock already makes — unchanged), or, when
--   that is still ahead or he has no team, (ii) a START this league recorded
--   for him for a game that has kicked off (`starters[].kickoff_at` of any
--   of the league's lineups for the week — a real kickoff of the week, see
--   §1), or (iii) his STAT LINE for the week (player_stats, keyed player /
--   season / week — the StatsProvider's store, read in SQL as 154 and 131
--   do; counted once the game it names — or, with no game named, the week's
--   first game — has kicked off). 154's `lineup_kept_starter_internal`
--   judges an OFF-roster stored starter from the same three records; this
--   migration carries them to every ON-roster / pool judgment:
--     §1 lineup_record_kicked_off_internal — is a recorded kickoff a real,
--        passed kickoff of the week (a game of that week, not postponed,
--        kicks off at that instant) and his current team's game not
--        postponed? The rule that makes (ii) safe beside E42 / E43: a flexed
--        or postponed game leaves no game at the old instant, so its record
--        still moves (pgTAP 064 D7 / D8 unchanged).
--     §2 lineup_played_internal — (ii) then (iii) for one league-week.
--     §3 lineup_player_kickoff_internal — the LINEUP datum per player: his
--        team's kickoff, or (when that is ahead / absent) the played
--        kickoff. Same (kickoff_at, datum_arm, on_bye) shape as 112's
--        lineup_kickoff_internal, so set_lineup / autopilot need one line
--        each.
--     §4 lineup_played_lock_internal — the lock document when he played
--        (§2) in a week that still holds its locks — the SAME candidate
--        weeks as 153's pool_game_lock_any_internal (not ahead of the
--        current week, its last game not ended, its ceiling not passed);
--        `datum_arm` names the record ('lineup_record' / 'stat_line'). The
--        lock still releases at the week's lock release (153) — only WHEN it
--        starts changed.
--     §5 pool_game_lock_player_internal — the ADD / DROP / CLAIM / TRADE
--        lock per player: 153's pool_game_lock_any_internal (his current
--        team), else §4. Same document shape.
--   and lineup_lock_tick — arm (b) keeps a passed recorded kickoff that §1
--        says is real (the F447 row's "stop the tick re-reading a passed
--        kickoff to NULL"); arm (a), the pool view, makes §5's two reads
--        (153's helper, then §4 when that says unlocked).
--
-- EVERY WRITER / READER MEASURED (`grep -n "pool_game_lock_any_internal\|
-- lineup_kickoff_internal\|trade_lock_internal"` over each function's
-- NEWEST definer — newest.py over 001–156):
--   set_lineup_internal (154)          step (6): rostered players' datum for
--                                      p_week AND the current week (IR moves)
--                                      ⇒ §3 (2 substitutions)
--   lineup_autopilot_internal (154)    the per-player datum ⇒ §3 (1)
--   roster_add_drop_internal (153)     E32 drop side + add side ⇒ §5 (2)
--   waiver_claim_submit_internal (150) Q74's add lock at submit ⇒ §5 (1)
--   process_waivers_internal (153)     the run's locked set (Q73 / Q74) ⇒
--                                      §5 per claim player (1) — also judges
--                                      a player with NO NFL team (the old CTE
--                                      skipped team NULL: never locked)
--   trade_lock_internal (151)          E35, every leg and drop ⇒ §5 (1); the
--                                      executor (156) reads it unedited
--   lineup_lock_tick (139)             arm (a) pool view ⇒ 153's helper then
--                                      §4; arm (b) the record keeps a real
--                                      passed kickoff (2)
--   NOT BOUND — the commissioner stands outside the timing rules (§10 /
--   standing rule (g)): commish_roster_override_internal (153) reads the
--   lock only for its `bypassed[]` receipt lines, commish_edit_lineup_
--   internal (154) only for `locked_players_moved` — both unedited (their
--   receipts can under-name a played, NFL-moved player: F467). The one-start
--   trigger (154) still binds everyone. lineup_carry_internal (116) opens a
--   week before anyone plays it. lineup_kept_starter_internal (154) is
--   unchanged (it already reads the three records for an off-roster start).
--   trade_execute_internal (156) is UNEDITED — R1234 measured: with the lock
--   judged per player a manager accept, a commissioner approve and the
--   tick's deferred run all DEFER a trade naming a played player until the
--   week's lock release, and from that instant every roster writer changes
--   lineups from the NEXT week (152 / 153's first-unfinished-week rule reads
--   the same release) — so the executor's complete path can no longer take
--   a played starter out of a live week. The one path that can is the
--   commissioner's FORCE, which already queues the re-score
--   (commish_trade_rescore_internal, 156 — D416 R1228). pgTAP 105 §F proves
--   the deferral, the release and the kept start.
--
-- WHAT IS UNCHANGED, STATED. The lock's release (153's lock release / the
-- ceiling); every message (the add / drop refusals still say "kicked off at
-- <instant> (<datum_arm>)" — the arm now names 'stat_line' / 'lineup_
-- record' when that is what decided); a player whose NFL game is still to
-- come and who has not played this week moves exactly as before; E42 (a
-- flexed kickoff moves the lock and the record) and E43 (a postponed game
-- releases them) — pinned unchanged by pgTAP 064 D7 / D8 and re-proved in
-- 105. The commissioner (above). Scoring. No backfill: a record 139's tick
-- already re-read to NULL before 157 is not recoverable from the schema —
-- the stat-line arm covers that player.
--
-- D137 — each replaced body is derived from its NEWEST definer's FILE TEXT
-- (measured by grep over 001–156: no later migration defines any of them)
-- by an exact-match script (derive_157.py — every substitution asserted to
-- hit once, its reversal asserted to reproduce the source byte for byte;
-- the source prosrc md5 equals the live one; hunks counted with difflib).
-- pgTAP 105 §A reverses every substitution on the LIVE prosrc and pins the
-- source md5; every older suite that pins one of these bodies reverses
-- 157's substitutions innermost first (pg_temp.un157 — additive, the R992
-- shape) so its literal stands:
--   set_lineup_internal           154:372-1042  prosrc md5 991dfe0a… → 3 hunks (+7 / -2)
--   lineup_autopilot_internal     154:1899-2536 prosrc md5 0eb0586b… → 2 hunks (+3 / -1)
--   roster_add_drop_internal      153:422-962   prosrc md5 f4879cd1… → 2 hunks (+2 / -2)
--   process_waivers_internal      153:1981-2538 prosrc md5 7b3dad5e… → 3 hunks (+4 / -6)
--   waiver_claim_submit_internal  150:1397-1709 prosrc md5 33aaaaa0… → 1 hunk  (+1 / -1)
--   trade_lock_internal           151:689-742   prosrc md5 0e8a591b… → 1 hunk  (+1 / -1)
--   lineup_lock_tick              139:1045-1508 prosrc md5 54094625… → 2 hunks (+15 / -0)
--
-- DEPLOY BEFORE PUSH. SQL only — no route, page, job or type the app reads
-- changes shape: every RPC document keeps its keys (a lock document's
-- `datum_arm` may carry two new values; the lineup record's `starters[]`
-- `datum_arm` likewise — measured: `grep -rn "datum_arm" src` reads it only
-- for display text). Merging deploys nothing; the hosted database gets 157
-- at Chris's `db push`.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: five PLAIN helpers (§1–§5 — reads only, STABLE, search_path '',
--   REVOKEd from PUBLIC / anon / authenticated; not DEFINER: every caller is
--   an internal that runs under a DEFINER door or a job). Seven bodies
--   replaced, signatures unchanged (ACLs kept; REVOKEs restated). No table,
--   column, policy, index, grant, trigger or cron row. Time only through
--   p_at / p_now (no clock read). The league row lock is unchanged — every
--   replaced writer already takes it first (rule 8); the helpers only read.
--   Typegen: the five helpers join `Functions` (additive; alias block
--   re-appended). Realtime: none new (the tick's pool broadcast fires on the
--   flips it already made). WAIVERS: R6 — no staging clone; rehearsal
--   evidence = the fresh local `db reset` 001–157 and the full pgTAP run in
--   the PR. D38 — nothing to backfill (above).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lineup_record_kicked_off_internal — is a RECORDED kickoff (a lineup's
--    `starters[].kickoff_at`) a real kickoff of the week that has passed?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_record_kicked_off_internal(
  p_season     INTEGER,
  p_week       INTEGER,
  p_player_id  TEXT,
  p_kickoff_at TIMESTAMPTZ,   -- the recorded instant
  p_at         TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_kickoff_at IS NOT NULL
     AND p_kickoff_at <= p_at
     -- a game of that week, not postponed, kicks off at that instant (a
     -- flexed or postponed game leaves none there — E42 / E43: the record
     -- is stale, not history)
     AND EXISTS (SELECT 1 FROM public.nfl_games g
                 WHERE g.season = p_season AND g.week = p_week
                   AND g.kickoff_at = p_kickoff_at
                   AND g.status IS DISTINCT FROM 'postponed')
     -- and his CURRENT team's game of the week is not postponed (E43: a
     -- postponed game releases its players' records)
     AND NOT EXISTS (SELECT 1 FROM public.nfl_games g
                     JOIN public.players p ON p.id = p_player_id
                     WHERE g.season = p_season AND g.week = p_week
                       AND g.status = 'postponed'
                       AND p.team IS NOT NULL
                       AND p.team IN (g.home_team, g.away_team));
$$;
REVOKE EXECUTE ON FUNCTION lineup_record_kicked_off_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_record_kicked_off_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  '§11.2 / §13.1 (migration 157, L.D2.16 — F447): TRUE when a recorded starters[].kickoff_at is a real, passed kickoff of the week (a non-postponed game of that week kicks off at that instant) and the player''s current NFL team''s game of the week is not postponed. A flexed or postponed game leaves no game at the old instant, so its record still moves (E42 / E43).';

-- ---------------------------------------------------------------------------
-- 2. lineup_played_internal — has he played this league-week by a record
--    OTHER than his current NFL team's kickoff? (154's arms (ii) and (iii))
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_played_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_player_id TEXT,
  p_at        TIMESTAMPTZ
) RETURNS TABLE (
  played     BOOLEAN,
  kickoff_at TIMESTAMPTZ,   -- the kickoff he played in (≤ p_at) when played
  datum_arm  TEXT           -- 'lineup_record' | 'stat_line' when played
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_rec  TIMESTAMPTZ;
  v_stat TIMESTAMPTZ;
BEGIN
  -- (ii) a START this league recorded for him this week, for a game that has
  --      kicked off (§1) — any team's lineup of the league (he is on one
  --      roster; a start kept after he left is another's row).
  SELECT min((s ->> 'kickoff_at')::timestamptz) INTO v_rec
  FROM public.team_lineups tl
  JOIN public.teams t ON t.id = tl.team_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tl.starters) = 'array' THEN tl.starters ELSE '[]'::jsonb END) s
  WHERE t.league_id = p_league_id
    AND tl.season = p_season
    AND tl.week = p_week
    AND s ->> 'player_id' = p_player_id
    AND public.lineup_record_kicked_off_internal(p_season, p_week, p_player_id, (s ->> 'kickoff_at')::timestamptz, p_at);
  IF v_rec IS NOT NULL THEN
    played := TRUE; kickoff_at := v_rec; datum_arm := 'lineup_record';
    RETURN NEXT;
    RETURN;
  END IF;
  -- (iii) his STAT LINE for the week (F442) — he played, for whichever NFL
  --       team he was on then. Counted once the game it names has kicked off
  --       at p_at (or, naming none, the week's first game): a stat line is
  --       evidence of a game that has started, and p_at never precedes it.
  SELECT min(COALESCE(g.kickoff_at,
                      (SELECT min(w.kickoff_at) FROM public.nfl_games w
                       WHERE w.season = p_season AND w.week = p_week)))
    INTO v_stat
  FROM public.player_stats ps
  LEFT JOIN public.nfl_games g ON g.id = ps.game_id
  WHERE ps.player_id = p_player_id AND ps.season = p_season AND ps.week = p_week;
  IF v_stat IS NOT NULL AND v_stat <= p_at THEN
    played := TRUE; kickoff_at := v_stat; datum_arm := 'stat_line';
    RETURN NEXT;
    RETURN;
  END IF;
  played := FALSE; kickoff_at := NULL; datum_arm := NULL;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_played_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_played_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ) IS
  '§11.2 / §13.1 (migration 157, L.D2.16 — F447): has the player played this league-week by a record other than his current NFL team''s kickoff — a start the league recorded for a real, passed kickoff (lineup_record_kicked_off_internal), or his stat line for the week once its game has kicked off? Returns the kickoff he played in and the arm.';

-- ---------------------------------------------------------------------------
-- 3. lineup_player_kickoff_internal — the LINEUP lock datum per PLAYER
--    (112's lineup_kickoff_internal shape): his current NFL team's kickoff,
--    or, when that is still ahead or he has no team, the kickoff he played
--    in this week (§2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_player_kickoff_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_player_id TEXT,
  p_at        TIMESTAMPTZ
) RETURNS TABLE (
  kickoff_at TIMESTAMPTZ,
  datum_arm  TEXT,
  on_bye     BOOLEAN
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_team TEXT;
  v_k    RECORD;
  v_p    RECORD;
BEGIN
  SELECT p.team INTO v_team FROM public.players p WHERE p.id = p_player_id;
  SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_team, p_at);
  IF v_k.kickoff_at IS NULL OR v_k.kickoff_at > p_at THEN
    SELECT * INTO v_p FROM public.lineup_played_internal(p_league_id, p_season, p_week, p_player_id, p_at);
    IF v_p.played THEN
      kickoff_at := v_p.kickoff_at; datum_arm := v_p.datum_arm; on_bye := FALSE;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;
  kickoff_at := v_k.kickoff_at; datum_arm := v_k.datum_arm; on_bye := v_k.on_bye;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_player_kickoff_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_player_kickoff_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ) IS
  '§11.2 (migration 157, L.D2.16 — F447): the per-player lineup lock datum — lineup_kickoff_internal for his current NFL team, or, when that kickoff is still ahead or he has no team, the kickoff he PLAYED in this week (lineup_played_internal). Read by set_lineup_internal step (6) and lineup_autopilot_internal.';

-- ---------------------------------------------------------------------------
-- 4. lineup_played_lock_internal — the lock document when he PLAYED (§2) in
--    a week that still holds its locks; NULL when he did not. The SAME
--    candidate weeks as 153's pool_game_lock_any_internal (on the calendar,
--    not ahead of the current week, its last game not ended, its ceiling not
--    passed), newest first; locked until that week's lock release, reported
--    as 153 reports it (the recorded end capped by the ceiling; NULL while
--    the end is not recorded — F238's loud state).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_played_lock_internal(
  p_league_id    UUID,
  p_season       INTEGER,
  p_current_week INTEGER,
  p_player_id    TEXT,
  p_at           TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_w RECORD;
  v_p RECORD;
BEGIN
  FOR v_w IN
    SELECT w.week, w.last_game_ends_at, w.starts_at
    FROM public.nfl_weeks w
    WHERE w.season = p_season
      AND w.week <= p_current_week
      AND (w.last_game_ends_at IS NULL OR w.last_game_ends_at > p_at)
      AND public.week_release_ceiling_internal(w.starts_at) > p_at
    ORDER BY w.week DESC
  LOOP
    SELECT * INTO v_p FROM public.lineup_played_internal(p_league_id, p_season, v_w.week, p_player_id, p_at);
    IF v_p.played THEN
      RETURN jsonb_build_object(
        'locked', TRUE, 'week', v_w.week, 'kickoff_at', v_p.kickoff_at,
        'window_ends_at', CASE WHEN v_w.last_game_ends_at IS NULL THEN NULL
                               ELSE public.week_lock_release_internal(v_w.last_game_ends_at, v_w.starts_at) END,
        'datum_arm', v_p.datum_arm, 'on_bye', FALSE);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_played_lock_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_played_lock_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ) IS
  '§13.1 / E32 (migration 157, L.D2.16 — F447): the game-day lock document (pool_game_lock_any_internal''s shape) when the player PLAYED (lineup_played_internal) in a week whose locks have not released — the same candidate weeks as 153; NULL when he did not.';

-- ---------------------------------------------------------------------------
-- 5. pool_game_lock_player_internal — the §13.1 game-day lock per PLAYER:
--    153's pool_game_lock_any_internal for his CURRENT NFL team (every lock
--    reader's judgment before 157); unlocked there ⇒ §4. Same document.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pool_game_lock_player_internal(
  p_league_id    UUID,
  p_season       INTEGER,
  p_current_week INTEGER,
  p_player_id    TEXT,
  p_at           TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_team TEXT;
  v_lock JSONB;
BEGIN
  SELECT p.team INTO v_team FROM public.players p WHERE p.id = p_player_id;
  v_lock := public.pool_game_lock_any_internal(p_season, p_current_week, v_team, p_at);
  IF (v_lock ->> 'locked')::boolean THEN
    RETURN v_lock;
  END IF;
  RETURN COALESCE(public.lineup_played_lock_internal(p_league_id, p_season, p_current_week, p_player_id, p_at), v_lock);
END;
$$;
REVOKE EXECUTE ON FUNCTION pool_game_lock_player_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION pool_game_lock_player_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ) IS
  '§13.1 / E32 / Q34(B) (migration 157, L.D2.16 — F447): the game-day lock per PLAYER — pool_game_lock_any_internal for his current NFL team, else lineup_played_lock_internal (he PLAYED this week: a start recorded for a real kickoff, or his stat line). Same document shape; datum_arm names the record that decided. Read by roster_add_drop, the waiver claim submit and run and the trade lock; the tick''s pool view makes the same two reads.';

-- ---------------------------------------------------------------------------
-- 6. set_lineup_internal — CREATE OR REPLACE against 154:372-1042's FILE
--    TEXT (D137; definers 112 / 114 / 131 / 152 / 154 — 154 newest),
--    3 hunks (+7 / -2) from 2 substitutions: step (6)'s datum for p_week
--    and for the current week (IR moves) is §3's per-player read. The
--    DEFINER wrapper set_lineup (112) is untouched.
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
    -- 154 / F441 · F442 · F445: ONE judgment, shared with the commissioner's
    -- editor and autopilot (lineup_kept_starter_internal). He STAYS when he
    -- PLAYED — his current NFL team's game kicked off, this lineup's own
    -- record of the slot says so, or he has a stat line for the week (F442: a
    -- player released or traded after playing still reads as played) — or
    -- when the week CLOSED to moves (its lock release: the last game's end or
    -- the Wednesday ceiling) before he left and he has a game this week
    -- (D412(5) / F445: a player of the unplayed game stays in the lineup that
    -- started him). A bye, or a game gone from the week, scores nothing: his
    -- slot opens, as before (D411(7)).
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(v_league.season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;
    IF ((p_slot_map ? v_key) AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid)
       OR EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE x.key <> v_key AND (x.value #>> '{}') = v_pid) THEN
      IF v_k.why = 'kicked_off' THEN
        RAISE EXCEPTION
          'set_lineup: % already played this week — his start stays (slot "%": his game kicked off at % (%); he has left %''s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)',
          v_e ->> 'name', v_key, v_k.kickoff_at, v_k.datum_arm, v_team.name
          USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION
        'set_lineup: % is held in this week''s lineup — his start stays (slot "%": %; he has left %''s roster since, and no move changes the start he holds this week — §11.2, Q32, D412(5); the week is scored from this lineup, §7.3.3)',
        v_e ->> 'name', v_key, v_k.detail, v_team.name
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
  -- 157 / F447: each ROSTERED player's kickoff is judged per PLAYER — his
  -- current NFL team's game, or, when that is still ahead (or he has no
  -- team), a start this league recorded for a game that kicked off or his
  -- stat line for the week (lineup_player_kickoff_internal): a player the
  -- NFL released or traded AFTER he played is still locked for the week.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> 'player_id', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> 'player_id', p_at);   -- 157 / F447
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
            AND (v_kick -> (e.value #>> '{}') ->> 'kickoff_at')::timestamptz <= p_at)
           OR v_gone_kick ? (e.value #>> '{}') AS fixed   -- 154 / F445: a kept off-roster starter is FIXED even while his (postponed) game is ahead
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
                  AND (v_stored ->> v_key) = v_pid)
         AND NOT (v_gone_kick ? v_pid) THEN   -- 154 / F445: a kept off-roster starter is not the manager's to change
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
-- 7. lineup_autopilot_internal — CREATE OR REPLACE against 154:1899-2536's
--    FILE TEXT (D137; definers 125 / 138 / 139 / 142 / 152 / 154 — 154
--    newest), 2 hunks (+3 / -1) from 1 substitution: the per-player datum
--    is §3's — a played, NFL-moved starter is locked (seated, never
--    benched) and a played bench player is never seated.
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
  -- 154 / F441 · F445: stored off-roster starters KEPT for the week, and the
  -- team (if any) that already starts a candidate this league-week.
  v_kept        TEXT[] := ARRAY[]::text[];
  v_else        JSONB;
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
  -- 157 / F447: judged per PLAYER (set_lineup's step (6) helper) — a player
  -- the NFL released or traded after he played is locked, never OPEN.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, p_season, p_week, v_e ->> 'player_id', p_at);
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
    -- 154 / F441 · F442 · F445: the ONE shared judgment (set_lineup (4b)'s and
    -- the commissioner's editor's): he played (his current team's game, this
    -- lineup's record of the slot, or a stat line for the week), or the week
    -- closed to moves before he left and he has a game this week. A KEPT
    -- starter is seated whatever his health or kickoff (the classification
    -- below) — his start is the week's record, never autopilot's to change.
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(p_season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;   -- a bye / a game gone from the week: the slot stays OPEN
    v_kept := v_kept || v_pid;
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
    IF v_locked OR NOT v_unhealthy OR v_pid = ANY (v_kept) THEN   -- 154: a kept off-roster starter stays, unconditionally
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
    -- 154 / F441 · F445: ONE START PER PLAYER PER LEAGUE-WEEK. A candidate
    -- another team of this league already STARTS this week (a start kept
    -- after he left that team — D411 / D412(5)) is never offered: the write
    -- would be refused by name (team_lineups' trigger) and fail the league's
    -- tick. Named in skipped_locked[] (the tick reports it), never silently
    -- dropped (§4 rule 15).
    v_else := public.lineup_started_elsewhere_internal(p_league_id, p_team_id, p_season, p_week, v_pid);
    IF v_else IS NOT NULL THEN
      v_locked_out := v_locked_out || jsonb_build_object(
        'player_id', v_pid, 'name', v_e ->> 'name', 'position', v_e ->> 'position',
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'started_by', v_else ->> 'team_id',
        'reason', 'already in ' || (v_else ->> 'team_name') || '''s starting lineup for week ' || p_week
                  || ' — a player starts for at most one team per league-week (F441 / F445)');
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
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> 'position') AND x ? 'started_by')
            THEN 'no eligible player at ' || upper(v_e ->> 'slot') || ' free to start — another team of the league already starts him this week (F441 / F445)'
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

-- ---------------------------------------------------------------------------
-- 8. roster_add_drop_internal — CREATE OR REPLACE against 153:422-962's FILE
--    TEXT (D137; definers 113 / 115 / 149 / 152 / 153 — 153 newest),
--    2 hunks (+2 / -2): E32's drop side and add side read §5.
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
REVOKE EXECUTE ON FUNCTION roster_add_drop_internal(UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. waiver_claim_submit_internal — CREATE OR REPLACE against 150:1397-1709's
--    FILE TEXT (D137; definers 145 / 150 — 150 newest), 1 hunk (+1 / -1):
--    Q74's add lock at submit reads §5.
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
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'waiver_claim_submit: % is retired — a sealed franchise makes no claims (§7.2.1)', v_team.name
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
      'waiver_claim_submit: league % has no league_weeks rows — no season calendar to evaluate the game-day lock against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
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
        'waiver_claim_submit: % has no FAAB balance on record (its league_members seat %) — refusing to accept a bid against money that is not recorded (§12.2)',
        v_team.name, CASE WHEN v_has_seat IS NULL THEN 'is missing' ELSE 'holds NULL' END
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
REVOKE EXECUTE ON FUNCTION waiver_claim_submit_internal(UUID, UUID, TEXT, TEXT, INTEGER, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. process_waivers_internal — CREATE OR REPLACE against 153:1981-2538's
--    FILE TEXT (D137; definers 150 / 152 / 153 — 153 newest), 3 hunks
--    (+4 / -6) from 1 substitution: the run's locked set (Q73 / Q74) is
--    judged per claim player through §5 (153 judged per NFL team, and a
--    player with no team was never locked).
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
  -- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,
  -- or its Wednesday 00:00 Pacific ceiling when that comes first. The
  -- ceiling releases a played starter, so it must finish the week for
  -- lineups too: otherwise, in a league's LAST week (no week N+1 row to
  -- flip the current week), a move at the ceiling would clear his start.
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
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
-- 11. trade_lock_internal — CREATE OR REPLACE against 151:689-742's FILE TEXT
--    (D137; 151 its only definer), 1 hunk (+1 / -1): E35 reads §5 for
--    every leg and drop. trade_execute_internal (156) is untouched —
--    banner: R1234 measured.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_lock_internal(p_trade_id UUID, p_league public.leagues, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_current INTEGER;
  v_p       RECORD;
  v_lock    JSONB;
  v_locked  JSONB := '[]'::jsonb;
  v_release TIMESTAMPTZ := NULL;
  v_unknown BOOLEAN := FALSE;
BEGIN
  v_current := public.lineup_current_week_internal(p_league.id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'trade_execute: league % has no league_weeks rows — no season calendar to evaluate the game-day lock against (§12.17)',
      p_league.id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_p IN
    SELECT q.player_id, p.full_name, p.team AS nfl_team
    FROM (SELECT i.player_id FROM public.trade_items i WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL
          UNION
          SELECT d.player_id FROM public.trade_drops d WHERE d.trade_id = p_trade_id) q
    JOIN public.players p ON p.id = q.player_id
    ORDER BY q.player_id
  LOOP
    v_lock := public.pool_game_lock_player_internal(p_league.id, p_league.season, v_current, v_p.player_id, p_at);   -- 157 / F447: judged per player (played this week)
    IF (v_lock ->> 'locked')::boolean THEN
      v_locked := v_locked || jsonb_build_array(jsonb_build_object(
        'player_id',      v_p.player_id,
        'name',           v_p.full_name,
        'week',           (v_lock ->> 'week')::int,
        'kickoff_at',     v_lock -> 'kickoff_at',
        'window_ends_at', v_lock -> 'window_ends_at'));
      IF (v_lock ->> 'window_ends_at') IS NULL THEN
        v_unknown := TRUE;
      ELSE
        v_release := GREATEST(v_release, (v_lock ->> 'window_ends_at')::timestamptz);
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'locked',         jsonb_array_length(v_locked) > 0,
    'current_week',   v_current,
    'locked_players', v_locked,
    'release_at',     CASE WHEN jsonb_array_length(v_locked) = 0 THEN NULL
                           WHEN v_unknown THEN 'infinity'::timestamptz
                           ELSE v_release END,
    'evaluated_at',   p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_lock_internal(UUID, public.leagues, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. lineup_lock_tick — CREATE OR REPLACE against 139:1045-1508's FILE TEXT
--    (D137; definers 116 / 119 / 125 / 138 / 139 — 139 newest), 2 hunks
--    (+15 / -0): arm (a)'s pool view adds §4 when 153's helper says
--    unlocked (§5's judgment, 115's read kept); arm (b) keeps a passed
--    recorded kickoff §1 says is real. Arm (c) (autopilot), the kill
--    switch and the report are untouched. The cron row is unchanged.
-- ---------------------------------------------------------------------------
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
