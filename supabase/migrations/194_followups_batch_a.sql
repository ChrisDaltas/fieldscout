-- ============================================================================
-- 194 — M8 follow-up batch A (approved by Chris 2026-10-17; FULL rigour —
--       scoring and week state). PROGRESS D524; F600 / F593 / F589.
-- ============================================================================
--
-- (1) F589 — `player_stats.team` (NEW nullable column): the NFL team a line
--     was played FOR, written by the ingest from the provider's own row
--     (Sleeper's weekly row carries team + opponent beside its game id) and
--     kept only when that pair is a game of the week. The held-game rule
--     (184) matched a NULL-game line by the player's CURRENT team — wrong for
--     a player traded or released mid-week. It now reads the line's team
--     first: the TS filter (`held-games.ts`) and the re-queue below
--     (`COALESCE(ps.team, p.team)`). A line with no stored team (written
--     before this push) still falls back to the current team.
-- (2) F593 — `op_set_game_status_internal` (184:654-829, the only definer;
--     D137 against 184's FILE TEXT, 3 hunks — this one, and F589's comment
--     and re-queue line): clearing a zeroing mark takes
--     the week's release back when it equals this game's OR any other
--     zeroing-marked game's `operator_release_at` in the week (mark B, mark
--     C — C records — clear B: the week is no longer released over B), and
--     forgets that release on those games. Ingestion's stamp is untouched.
-- (3) F600 — `op_platform_state_internal` (186:236-287, the only definer;
--     D137, 1 hunk): + `overdue_weeks` — every live week at or past its
--     Wednesday release ceiling (153's `week_release_ceiling_internal`) that
--     games still hold, with the ceiling, hours past it and the holding
--     games. Read-only; the door (186) is unchanged.
--
-- CHECKLIST (tasks-M* §4.4): one column (nullable, no default, no backfill —
-- D38: the next ingest poll of a week writes it as a metadata-only change;
-- RLS on player_stats unchanged — 005's public SELECT covers it); two PLAIN
-- internals replaced, signatures unchanged, REVOKEs restated; no DEFINER,
-- policy, grant, trigger or cron change. R6 waiver: no staging clone —
-- rehearsal = local psql apply over 001–193 + pgTAP 142 + the CI replay.
-- DEPLOY BEFORE PUSH (TD9): the app probes the column (42703 ⇒ absent) and
-- neither reads nor sends it until this is pushed; the TS filter reads
-- `select('*')`, so a pre-194 database answers "no line team". pgTAP
-- 142_followups_batch_a.sql.
-- ============================================================================

ALTER TABLE public.player_stats ADD COLUMN team TEXT;
COMMENT ON COLUMN public.player_stats.team IS
  'F589 (migration 194): the NFL team this line was played FOR (the provider row''s own team, kept only when its team / opponent pair is a game of the week). NULL = not known (written before 194, or the row named no such game). Read by the held-game rule before the player''s current team.';

-- ---------------------------------------------------------------------------
-- op_set_game_status_internal (184 + F589 / F593)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_set_game_status_internal(
  p_game_id TEXT, p_status TEXT, p_action_id UUID, p_reason TEXT, p_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_replay  JSONB;
  v_actor   UUID := auth.uid();
  v_g       public.nfl_games;
  v_hold    TEXT;
  v_status  TEXT;
  v_prior   TEXT;
  v_final   INTEGER;
  v_game    TEXT;
  v_text    TEXT;
  v_lg      RECORD;
  v_told    INTEGER := 0;
  v_before  JSONB;
  v_after   JSONB;
  v_queued  INTEGER := 0;
  v_release TIMESTAMPTZ;
  v_wk      public.nfl_weeks;
  v_state   RECORD;
  v_unstamped BOOLEAN := FALSE;
BEGIN
  v_replay := public.op_verb_prelude_internal('set_game_status', NULL, p_action_id, p_reason);
  IF v_replay IS NOT NULL THEN
    -- R1549: a replay is the SAME request — the same game AND the same mark.
    IF v_replay ->> 'game_id' IS DISTINCT FROM p_game_id
       OR v_replay ->> 'operator_hold' IS DISTINCT FROM NULLIF(p_status, 'normal') THEN
      RAISE EXCEPTION 'set_game_status: action id % was already used for a different game or status', p_action_id
        USING ERRCODE = '22023';
    END IF;
    RETURN v_replay;
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('in_week', 'out_of_week', 'cancelled', 'normal') THEN
    RAISE EXCEPTION 'set_game_status: status must be in_week (moved later this week), out_of_week (moved out of the week), cancelled, or normal (back to normal) — got %', COALESCE(p_status, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'set_game_status: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- The row lock: a concurrent mark of the same game waits.
  SELECT * INTO v_g FROM public.nfl_games g WHERE g.id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_game_status: game % does not exist', p_game_id USING ERRCODE = 'P0002';
  END IF;
  v_game := v_g.away_team || ' @ ' || v_g.home_team || ' game (week ' || v_g.week || ')';
  v_hold := CASE WHEN p_status = 'normal' THEN NULL ELSE p_status END;

  -- The same mark again (or 'normal' on an unmarked game): nothing to do.
  IF v_g.operator_hold IS NOT DISTINCT FROM v_hold THEN
    RETURN jsonb_build_object('changed', FALSE, 'game_id', p_game_id, 'operator_hold', v_hold,
      'why', CASE WHEN v_hold IS NULL THEN 'not_marked — the game has no operator mark; nothing was written'
                  ELSE 'already_marked — the game already carries this mark; nothing was written' END);
  END IF;
  -- A played game has nothing to mark (its players' points are real).
  IF v_g.operator_hold IS NULL AND v_g.status IS NOT DISTINCT FROM 'final' THEN
    RAISE EXCEPTION 'set_game_status: the % is final — it was played, so it cannot be marked moved or cancelled', v_game
      USING ERRCODE = '22023';
  END IF;
  -- §23.4: only a final week never changes — once any league has made the
  -- week final, its games are settled for every league.
  SELECT count(*)::int INTO v_final
  FROM public.league_weeks lw
  JOIN public.leagues l ON l.id = lw.league_id AND l.season = lw.season
  WHERE lw.season = v_g.season AND lw.week = v_g.week AND lw.status = 'final' AND l.deleted_at IS NULL;
  IF v_final > 0 THEN
    RAISE EXCEPTION 'set_game_status: week % of % is already final in % league(s) — a final week never changes (§23.4), so the % cannot be re-marked',
      v_g.week, v_g.season, v_final, v_game
      USING ERRCODE = '22023';
  END IF;

  v_prior  := CASE WHEN v_g.operator_hold IS NULL THEN v_g.status ELSE v_g.operator_hold_prior_status END;
  v_status := CASE p_status
    WHEN 'normal'  THEN v_g.operator_hold_prior_status
    WHEN 'in_week' THEN 'scheduled'
    ELSE 'postponed' END;
  v_before := jsonb_build_object('game_id', p_game_id, 'status', v_g.status, 'operator_hold', v_g.operator_hold,
    'kickoff_at', v_g.kickoff_at, 'season', v_g.season, 'week', v_g.week);

  UPDATE public.nfl_games
  SET status = v_status,
      operator_hold = v_hold,
      operator_hold_at = CASE WHEN v_hold IS NULL THEN NULL ELSE p_at END,
      operator_hold_prior_status = CASE WHEN v_hold IS NULL THEN NULL ELSE v_prior END,
      operator_release_at = CASE WHEN v_hold IN ('out_of_week', 'cancelled') THEN operator_release_at END,
      updated_at = p_at
  WHERE id = p_game_id;

  -- R1547: the players of a game whose mark ZEROES them (out_of_week /
  -- cancelled — before or after this change) are re-scored, so a stat line
  -- already counted leaves the score, and a switch-back restores it. The
  -- 123 pattern: one queue row per player with a line, stamped at the
  -- line's own updated_at (ready at once), never re-stamping a live row.
  -- Matched by game_id, or — a NULL game_id line (F468(a)) — by the team
  -- the LINE was played for (194, F589), else (no stored team) his current team.
  IF v_g.operator_hold IN ('out_of_week', 'cancelled') OR v_hold IN ('out_of_week', 'cancelled') THEN
    INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
    SELECT v_g.season, v_g.week, ps.player_id, min(ps.updated_at)
    FROM public.player_stats ps
    LEFT JOIN public.players p ON p.id = ps.player_id
    WHERE ps.season = v_g.season AND ps.week = v_g.week AND ps.updated_at IS NOT NULL
      AND (ps.game_id = p_game_id
           OR (ps.game_id IS NULL AND COALESCE(ps.team, p.team) IN (v_g.home_team, v_g.away_team)))
    GROUP BY ps.player_id
    -- R1554: a row a drain has CLAIMED (in flight, maybe scoring the old
    -- answer) is moved 1µs EARLIER: the drain's (token, stamp) ack misses
    -- and releases it, and the next drain re-scores it — still ready at
    -- once (its line's updated_at stays ≥ the stamp). An unclaimed row is
    -- left alone: it has not been scored yet.
    ON CONFLICT (season, week, player_id) DO UPDATE
      SET enqueued_at = public.score_fanout.enqueued_at - interval '1 microsecond'
      WHERE public.score_fanout.claim_token IS NOT NULL;
    GET DIAGNOSTICS v_queued = ROW_COUNT;
  END IF;

  -- The stuck week (review fix): a mark that leaves every in-week game final
  -- records the week's release itself when ingestion has not — the sync
  -- stops polling a week once the next one starts, so without this a game
  -- marked late would hold the week live forever (F238). The stamp is
  -- weekBounds' own rule (Q50): the LATER of now and the Tuesday floor.
  SELECT * INTO v_wk FROM public.nfl_weeks w WHERE w.season = v_g.season AND w.week = v_g.week FOR UPDATE;
  IF v_wk.season IS NOT NULL AND v_wk.last_game_ends_at IS NULL AND v_hold IN ('out_of_week', 'cancelled') THEN
    SELECT * INTO v_state FROM public.week_games_state_internal(v_g.season, v_g.week);
    IF v_state.all_final THEN
      v_release := GREATEST(p_at, public.week_release_floor_internal(v_wk.starts_at));
      UPDATE public.nfl_weeks SET last_game_ends_at = v_release
      WHERE season = v_g.season AND week = v_g.week;
      UPDATE public.nfl_games SET operator_release_at = v_release WHERE id = p_game_id;
    END IF;
  END IF;
  -- R1552 / F593 (194): clearing (or softening to in_week) a zeroing mark
  -- that leaves the week NOT all-final takes back a release a MARK recorded
  -- — this game's, or (F593: mark B, mark C — C records — clear B) any
  -- other zeroing-marked game's of the week — and never one ingestion wrote.
  -- The games that recorded that release forget it (it is no longer the week's).
  IF v_wk.season IS NOT NULL AND v_g.operator_hold IN ('out_of_week', 'cancelled')
     AND v_hold IS DISTINCT FROM 'out_of_week' AND v_hold IS DISTINCT FROM 'cancelled' THEN
    SELECT * INTO v_state FROM public.week_games_state_internal(v_g.season, v_g.week);
    IF NOT v_state.all_final AND v_wk.last_game_ends_at IS NOT NULL
       AND (v_wk.last_game_ends_at IS NOT DISTINCT FROM v_g.operator_release_at
            OR EXISTS (SELECT 1 FROM public.nfl_games o
                       WHERE o.season = v_g.season AND o.week = v_g.week AND o.id <> p_game_id
                         AND o.operator_hold IN ('out_of_week', 'cancelled')
                         AND o.operator_release_at = v_wk.last_game_ends_at)) THEN
      UPDATE public.nfl_weeks SET last_game_ends_at = NULL
      WHERE season = v_g.season AND week = v_g.week;
      UPDATE public.nfl_games SET operator_release_at = NULL
      WHERE season = v_g.season AND week = v_g.week AND operator_release_at = v_wk.last_game_ends_at;
      v_unstamped := TRUE;
    END IF;
  END IF;

  v_text := 'FieldScout marked the ' || v_game || CASE p_status
    WHEN 'in_week'     THEN ' as moved later this week. The week waits for it before it finishes.'
    WHEN 'out_of_week' THEN ' as moved out of the week. Its players score 0 this week and the week finishes without it.'
    WHEN 'cancelled'   THEN ' as cancelled. Its players score 0 this week and the week finishes without it.'
    ELSE ' back to normal. It counts in its week as usual.' END;
  -- Every league still playing that week hears it.
  FOR v_lg IN
    SELECT DISTINCT l.id
    FROM public.leagues l
    JOIN public.league_weeks lw ON lw.league_id = l.id AND lw.season = l.season
    WHERE l.season = v_g.season AND lw.week = v_g.week
      AND l.status IN ('in_season', 'playoffs') AND l.deleted_at IS NULL
      AND lw.status <> 'final'
    ORDER BY l.id
  LOOP
    PERFORM public.op_league_line_internal(v_lg.id, v_text);
    v_told := v_told + 1;
  END LOOP;

  v_after := jsonb_build_object('changed', TRUE, 'game_id', p_game_id, 'status', v_status,
    'operator_hold', v_hold, 'kickoff_at', v_g.kickoff_at, 'season', v_g.season, 'week', v_g.week,
    'leagues_told', v_told, 'marked_at', p_at, 'players_rescored', v_queued,
    'release_recorded_at', v_release, 'release_taken_back', v_unstamped);
  PERFORM public.log_operator_action_internal(p_action_id, v_actor, 'set_game_status',
    'platform', NULL, p_reason, v_before, v_after);
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION op_set_game_status_internal(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION op_set_game_status_internal(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ) IS
  'M8 TD7 / Q100 (migration 184; 194: F589 the line''s own team, F593 any mark''s release taken back): the body of op_set_game_status at an injected instant. PLAIN, REVOKEd — reached through the door and the tests only.';

-- ---------------------------------------------------------------------------
-- op_platform_state_internal (186 + F600)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_platform_state_internal(p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH live_weeks AS (
    SELECT DISTINCT w.season, w.week FROM public.league_weeks w
    JOIN public.leagues l ON l.id = w.league_id AND l.deleted_at IS NULL
    WHERE w.status IN ('live', 'correction_window')
  ),
  games AS (
    SELECT lw.season, lw.week, e AS g
    FROM live_weeks lw, jsonb_array_elements(public.op_week_games_internal(lw.season, lw.week, p_at)) e
    UNION
    -- Every mark, even on a week no league is playing.
    SELECT g.season, g.week, jsonb_build_object('game_id', g.id, 'matchup', g.away_team || ' @ ' || g.home_team,
             'kickoff_at', g.kickoff_at, 'status', g.status, 'operator_hold', g.operator_hold,
             'operator_hold_at', g.operator_hold_at, 'holds_week', g.operator_hold = 'in_week' AND g.status <> 'final',
             'reason', 'Marked by FieldScout: ' || CASE g.operator_hold WHEN 'in_week' THEN 'moved later this week'
                                                     WHEN 'out_of_week' THEN 'moved out of the week' ELSE 'cancelled' END)
    FROM public.nfl_games g
    WHERE g.operator_hold IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM live_weeks lw WHERE lw.season = g.season AND lw.week = g.week)
  ),
  shown AS (
    SELECT season, week, g FROM games
    WHERE (g ->> 'holds_week')::boolean OR g ->> 'operator_hold' IS NOT NULL
  )
  SELECT jsonb_build_object(
    'as_of', p_at,
    'pauses', (SELECT COALESCE(jsonb_agg(public.op_pause_json_internal(p) || jsonb_build_object('league_name', l.name)
                                         ORDER BY p.paused_at), '[]'::jsonb)
               FROM public.job_pauses p LEFT JOIN public.leagues l ON l.id = p.league_id
               WHERE p.resumed_at IS NULL),
    'games_total', (SELECT count(*)::int FROM shown),
    'games', (SELECT COALESCE(jsonb_agg(x.g || jsonb_build_object('season', x.season, 'week', x.week)
                                        ORDER BY x.season, x.week, x.g ->> 'kickoff_at'), '[]'::jsonb)
              FROM (SELECT * FROM shown ORDER BY season, week, g ->> 'kickoff_at' LIMIT 200) x),
    'games_limit', 200,
    -- F600 (194): a live week at or past its Wednesday release ceiling (153)
    -- that games still hold — "stuck past Wednesday". Bounded by live weeks.
    'overdue_weeks', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'season', o.season, 'week', o.week, 'ceiling_at', o.ceiling_at,
                         'hours_past_ceiling', floor(extract(epoch FROM (p_at - o.ceiling_at)) / 3600)::int,
                         'holding_games', o.holding) ORDER BY o.season, o.week), '[]'::jsonb)
                      FROM (SELECT lw.season, lw.week,
                                   public.week_release_ceiling_internal(nw.starts_at) AS ceiling_at,
                                   (SELECT jsonb_agg(gg.g ->> 'matchup' ORDER BY gg.g ->> 'kickoff_at')
                                    FROM games gg WHERE gg.season = lw.season AND gg.week = lw.week
                                      AND (gg.g ->> 'holds_week')::boolean) AS holding
                            FROM live_weeks lw
                            JOIN public.nfl_weeks nw ON nw.season = lw.season AND nw.week = lw.week) o
                      WHERE p_at >= o.ceiling_at AND o.holding IS NOT NULL),
    'live_weeks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('season', season, 'week', week,
                     'leagues', (SELECT count(*)::int FROM public.league_weeks w JOIN public.leagues l
                                   ON l.id = w.league_id AND l.deleted_at IS NULL
                                 WHERE w.season = lw.season AND w.week = lw.week
                                   AND w.status IN ('live', 'correction_window')))
                     ORDER BY season, week), '[]'::jsonb) FROM live_weeks lw),
    'pending', jsonb_build_object(
      'waiver_claims', (SELECT count(*)::int FROM public.waiver_claims c WHERE c.status = 'pending'),
      'players_waiting_to_be_rescored', (SELECT count(*)::int FROM public.score_fanout)),
    'cron', public.op_cron_last_runs_internal());
$$;
REVOKE ALL ON FUNCTION op_platform_state_internal(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
