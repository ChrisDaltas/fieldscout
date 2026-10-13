-- ============================================================================
-- 186 — the operator's live-state reads (M8 L.G1.5; spec §24.4 "Live-state
--       view"; tasks-M8-admin-console.md §6 L.G1.5; PROGRESS D518; ONE PASS —
--       read-only, writes nothing)
-- ============================================================================
--
-- WHAT THIS ADDS (two read-only doors, two PLAIN internals):
--
--   op_league_state(p_league_id)  — one league, in plain words:
--     • weeks          every league_weeks row with its status;
--     • holding_games  for each week not yet final: the NFL games still
--                      holding it, each with a plain-words reason (not
--                      started / being played / postponed but still this
--                      week / marked "moved later this week" by FieldScout),
--                      plus every game FieldScout has marked (operator_hold,
--                      184) and whether that mark still holds the week;
--     • pending        waiver claims still waiting (count + next run) and
--                      players waiting to be re-scored per open week
--                      (score_fanout — counts, never row lists);
--     • pauses         open job_pauses rows (183) that apply to this league
--                      (its own and every-league pauses);
--     • cron           the last run of every scheduled job
--                      (cron.job / cron.job_run_details);
--     • receipts       the 20 latest commissioner_actions and the 20 latest
--                      platform_operator_actions for the league.
--   op_platform_state()           — every league: open pauses, marked games
--                      and games holding any live league week, pending
--                      totals, and the last run + status of every job.
--
-- WHY AN RPC: `cron.*` is not exposed to PostgREST and is not readable by
-- `authenticated`. The doors are SECURITY DEFINER (owner postgres reads
-- cron), search_path '', and gate IN-BODY on `is_platform_operator()` (182,
-- TD1 — never league_members). There is NO identity swap (R1545): the doors
-- never touch request.jwt.claims; the internals take no caller identity.
-- Each answer is ONE jsonb value (never a set), so PostgREST's 1000-row cap
-- cannot truncate it; every list inside is either bounded by construction
-- (a league's weeks, one week's games, the job list) or LIMITed and labelled
-- (receipts 20; platform games 200, with the true total beside it).
--
-- FAIL LOUD: an unknown or deleted league is P0002, never an empty state. A
-- job that has never run is reported as "never run", not omitted.
--
-- CHECKLIST (tasks-M* §4.4): no table, no policy, no write. Doors DEFINER +
-- search_path '' + in-body gate, EXECUTE authenticated only; internals PLAIN,
-- search_path '', REVOKEd from PUBLIC / anon / authenticated. No R6 / D38
-- waiver needed. DEPLOY BEFORE PUSH (TD9): the GET routes answer a named 503
-- (PGRST202) until this is pushed. pgTAP 134_operator_live_state.sql.
-- F265 (blocked bracket) is NOT shown: the verdict is still not persisted
-- (118 computes it inside a writer), so a read-only view cannot see it —
-- PROGRESS F598.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared: the last run of every scheduled job, in plain words.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_cron_last_runs_internal()
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'job', j.jobname,
           'schedule', j.schedule,
           'active', j.active,
           'last_started_at', r.start_time,
           'last_ended_at', r.end_time,
           'last_status', COALESCE(r.status, 'never run'),
           'last_message', r.return_message,
           'summary', CASE
             WHEN r.runid IS NULL THEN 'Has not run yet'
             WHEN r.status = 'succeeded' THEN 'Last run worked'
             WHEN r.status = 'failed' THEN 'Last run FAILED'
             WHEN r.status IN ('running', 'starting') THEN 'Running now'
             ELSE 'Last run: ' || r.status END)
         ORDER BY j.jobname), '[]'::jsonb)
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT d.runid, d.status, d.return_message, d.start_time, d.end_time
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC NULLS LAST, d.runid DESC
    LIMIT 1
  ) r ON TRUE;
$$;
REVOKE ALL ON FUNCTION op_cron_last_runs_internal() FROM PUBLIC, anon, authenticated;

-- Plain words for one open pause row.
CREATE OR REPLACE FUNCTION op_pause_json_internal(p public.job_pauses)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'job', p.job, 'league_id', p.league_id,
    'paused_at', p.paused_at, 'paused_by', p.paused_by,
    'skipped_runs', p.skipped_runs, 'last_skipped_at', p.last_skipped_at,
    'summary', CASE p.job WHEN 'waivers' THEN 'Waivers' WHEN 'week-advance' THEN 'Week advance'
                          ELSE 'Week finalize' END
               || ' paused by FieldScout'
               || CASE WHEN p.league_id IS NULL THEN ' for every league' ELSE ' for this league' END
               || CASE WHEN p.skipped_runs > 0 THEN ' — ' || p.skipped_runs || ' run(s) skipped' ELSE '' END);
$$;
REVOKE ALL ON FUNCTION op_pause_json_internal(public.job_pauses) FROM PUBLIC, anon, authenticated;

-- One week's games with their holding verdict, in plain words.
CREATE OR REPLACE FUNCTION op_week_games_internal(p_season INTEGER, p_week INTEGER, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH bound AS (
    SELECT min(w.starts_at) AS next_starts_at
    FROM public.nfl_weeks w WHERE w.season = p_season AND w.week > p_week
  ),
  g AS (
    -- left_week is week_games_state_internal's own test (116 + 184's arm).
    SELECT g.*,
           COALESCE(g.operator_hold IN ('out_of_week', 'cancelled'), FALSE) OR
           (g.status = 'postponed' AND b.next_starts_at IS NOT NULL AND g.kickoff_at >= b.next_starts_at) AS left_week
    FROM public.nfl_games g CROSS JOIN bound b
    WHERE g.season = p_season AND g.week = p_week
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'game_id', g.id, 'matchup', g.away_team || ' @ ' || g.home_team,
           'kickoff_at', g.kickoff_at, 'status', g.status,
           'operator_hold', g.operator_hold, 'operator_hold_at', g.operator_hold_at,
           'holds_week', NOT g.left_week AND g.status IS DISTINCT FROM 'final',
           'reason', CASE
             WHEN g.operator_hold = 'in_week' THEN 'Marked by FieldScout: moved later this week — the week waits for it'
             WHEN g.operator_hold = 'out_of_week' THEN 'Marked by FieldScout: moved out of the week — players score 0, not holding the week'
             WHEN g.operator_hold = 'cancelled' THEN 'Marked by FieldScout: cancelled — players score 0, not holding the week'
             WHEN g.left_week THEN 'Postponed past this week — players score 0, not holding the week'
             WHEN g.status = 'postponed' THEN 'Postponed, but its new kickoff is still this week — the week waits for it'
             WHEN g.status = 'in_progress' THEN 'Being played now'
             WHEN g.kickoff_at > p_at THEN 'Not started yet'
             ELSE 'Kickoff has passed but there is no final score yet' END)
         ORDER BY g.kickoff_at, g.id), '[]'::jsonb)
  FROM g
  WHERE g.operator_hold IS NOT NULL OR (NOT g.left_week AND g.status IS DISTINCT FROM 'final')
     OR g.left_week;
$$;
REVOKE ALL ON FUNCTION op_week_games_internal(INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- op_league_state
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_league_state_internal(p_league_id UUID, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league public.leagues%ROWTYPE;
BEGIN
  SELECT * INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_state: no such league %', p_league_id USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'as_of', p_at,
    'league', jsonb_build_object('id', v_league.id, 'name', v_league.name, 'season', v_league.season,
                                 'status', v_league.status),
    'weeks', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'season', w.season, 'week', w.week, 'status', w.status,
               'waivers_processed_at', w.waivers_processed_at, 'finalized_at', w.finalized_at,
               'summary', CASE w.status WHEN 'upcoming' THEN 'Not started'
                                        WHEN 'live' THEN 'Being played'
                                        WHEN 'correction_window' THEN 'Games over — stat fixes still count'
                                        ELSE 'Final' END)
             ORDER BY w.season, w.week), '[]'::jsonb)
      FROM public.league_weeks w WHERE w.league_id = p_league_id),
    'open_weeks', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'season', w.season, 'week', w.week, 'status', w.status,
               'games', public.op_week_games_internal(w.season, w.week, p_at),
               'players_waiting_to_be_rescored',
                 (SELECT count(*)::int FROM public.score_fanout f WHERE f.season = w.season AND f.week = w.week))
             ORDER BY w.season, w.week), '[]'::jsonb)
      FROM public.league_weeks w WHERE w.league_id = p_league_id AND w.status IN ('live', 'correction_window')),
    'pending', jsonb_build_object(
      'waiver_claims', (SELECT count(*)::int FROM public.waiver_claims c
                        WHERE c.league_id = p_league_id AND c.status = 'pending'),
      'next_waiver_run_at', v_league.waiver_next_run_at),
    'pauses', (
      SELECT COALESCE(jsonb_agg(public.op_pause_json_internal(p) ORDER BY p.paused_at), '[]'::jsonb)
      FROM public.job_pauses p
      WHERE p.resumed_at IS NULL AND (p.league_id IS NULL OR p.league_id = p_league_id)),
    'cron', public.op_cron_last_runs_internal(),
    'commissioner_receipts', (
      SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
        SELECT a.created_at, jsonb_build_object('id', a.id, 'at', a.created_at, 'action', a.action_type,
                 'actor_id', a.actor_id, 'actor', pr.username, 'reason', a.reason) AS j
        FROM public.commissioner_actions a LEFT JOIN public.profiles pr ON pr.id = a.actor_id
        WHERE a.league_id = p_league_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT 20) x),
    'operator_receipts', (
      SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
        SELECT a.created_at, jsonb_build_object('id', a.id, 'at', a.created_at, 'action', a.verb,
                 'reason', a.reason, 'after', a.after) AS j
        FROM public.platform_operator_actions a
        WHERE a.league_id = p_league_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT 20) x),
    'receipts_limit', 20);
END;
$$;
REVOKE ALL ON FUNCTION op_league_state_internal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION op_league_state(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'league_state: only a platform operator can read this (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_league_state_internal(p_league_id, now());
END;
$$;
REVOKE ALL ON FUNCTION op_league_state(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_league_state(UUID) TO authenticated;
COMMENT ON FUNCTION op_league_state(UUID) IS
  'M8 §24.4 live-state view (migration 186, L.G1.5): one league''s weeks, games holding its open weeks and why, pending waiver / re-score work, open pauses, the last run of every cron job, and its 20 latest commissioner and operator receipts. Read-only; operators only (in-body gate); P0002 for an unknown league.';

-- ---------------------------------------------------------------------------
-- op_platform_state
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

CREATE OR REPLACE FUNCTION op_platform_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform_state: only a platform operator can read this (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_platform_state_internal(now());
END;
$$;
REVOKE ALL ON FUNCTION op_platform_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_platform_state() TO authenticated;
COMMENT ON FUNCTION op_platform_state() IS
  'M8 §24.4 live-state view, every league (migration 186, L.G1.5): open pauses, FieldScout-marked games and games holding any live league week (200 shown, true total beside), pending waiver / re-score totals, and the last run + status of every cron job. Read-only; operators only (in-body gate).';
