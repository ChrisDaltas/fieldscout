-- ============================================================================
-- 224_wake_vercel_only_for_games.sql — THE DATABASE DECIDES WHEN TO WAKE
-- VERCEL: every 30 seconds while a game is on, once a day otherwise.
--
-- Numbering: migration head measured 223 on main (`ls supabase/migrations/ |
-- tail -1`), no 224 on any branch (`git log --all -- 'supabase/migrations/
-- 22[4-9]*'` empty) ⇒ 224; pgTAP head 173 ⇒ 174.
--
-- ---------------------------------------------------------------------------
-- WHY — the measured cost
-- ---------------------------------------------------------------------------
-- The Vercel Hobby account was PAUSED 2026-11-11 for exceeding Fluid Active
-- CPU (143% of the 4 h allowance) and provisioned memory (~300 GB-hrs). The
-- cause is 124's two pings: `sync-live-ping` and `score-week-ping` called
-- Vercel EVERY MINUTE, 24 hours a day, and during a game window each call
-- stayed alive ~45–50 s on purpose — sync-live looped a poll every 20 s for
-- a 45 s budget, score-week drained every 5 s for a 50 s budget. Provisioned
-- memory is billed for the whole wall-clock time, sleeps included.
--
-- CHRIS'S RULINGS (2026-11-14, verbatim, in chat):
--   * "Why are we checking for stuff? The games are only played on Thursday
--     for a couple hours, and Sunday for a couple hours, and Monday for a
--     couple hours. So why are we looking constantly all the time?"
--   * Offered one check per wake-up, once a minute, during games: "how about
--     every 30 seconds during games."
--   * "but how about once a day on none day games?"
--   * "we need to stop checking if a game is still on, once the score is
--     final the game is over."
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
-- 1. `public.live_game_window_open(p_now, p_season)` — the GAME WINDOW, in
--    SQL: an `nfl_games` row of the season whose status is `scheduled` or
--    `live` (NULL reads as scheduled) and whose kickoff is at or before
--    now + 15 minutes. That is `planLivePoll`'s HOT rule exactly
--    (`src/lib/sync/live-poll.ts`: OPEN_STATUSES, POLL_LEAD_MS) — pinned
--    equal row by row against the TypeScript in
--    `src/lib/sync/live-poll-window-db.test.ts`. A `final` game NEVER keeps
--    a window open (Chris: "once the score is final the game is over"), so
--    the tick after the last Sunday game reads final does not call Vercel.
--    THE SEASON: the route plans for `NEXT_PUBLIC_NFL_SEASON`; the database
--    cannot read Vercel's env, so it takes the newest season in `nfl_weeks`
--    — the same season in-season (the calendar is per-season and the route
--    reads that season's rows). Scoping matters: without it, an old
--    season's never-flipped row would hold the window open forever.
-- 2. `public.score_week_wake_reason(p_now)` — why score-week should run now,
--    or NULL:
--      'game_window'     — the window above is open (every tick);
--      'queue'           — `score_fanout` holds a row `score_fanout_claim`
--                          would take NOW (its own predicate, 122 §3: lease
--                          expired or never leased, at 120 s =
--                          SCORE_WEEK_LEASE_SECONDS) that has NEVER been
--                          deferred — fresh ingestion or a dead drain's
--                          leftovers (every tick);
--      'queue_held'      — a claimable row the drain has deferred before (a
--                          held row whose 30 s hold elapsed);
--      'close_owed'      — 216's close pass has a week to close
--                          (`league_weeks_to_close(p_now, 1)` — the pass's own
--                          read, so the wake and the pass cannot disagree);
--      'stat_fix_owed'   — 222 has a stat fix owed somewhere
--                          (`stat_fix_targets(true, 1)` — the pass's own read).
--    The last three are checked once per 5 minutes (the tick in [:00, :30)
--    of a minute divisible by 5), not every tick. WHY: each of them can be
--    owed for a long time on purpose — a hold re-defers every 30 s while its
--    week is not open; a week the door keeps refusing stays owed by design
--    ("stays owed and the next pass tries again") — and an every-tick wake
--    for them would put a short Vercel call back on the clock every 30 s,
--    24/7, which is the bill this migration ends. Five minutes is still
--    prompt for a stat fix, and the stall check's ten-minute queue arm stays
--    true: a held row is re-deferred at least every ~5 minutes, so its
--    `deferred_until` is never older than ten. A read that RAISES wakes
--    score-week anyway ('check_failed') — fail OPEN, so the route's own pass
--    meets the same error and alerts by name. (A statement CANCEL cannot be
--    caught in PL/pgSQL; it fails that tick's job, and the next slot retries.)
-- 3. `public.cron_wake_sync_live(p_now)` / `public.cron_wake_score_week(
--    p_now)` — the two job bodies: decide, and call `cron_ping_route` ONLY
--    on a yes. They return what they decided (forensics in
--    `cron.job_run_details`).
-- 4. The jobs. `sync-live-ping` and `score-week-ping` KEEP THEIR NAMES (183's
--    job-knob list names them) and move from `* * * * *` to `'30 seconds'`
--    (pg_cron's seconds syntax, as 068's `draft-tick` uses `'5 seconds'`),
--    each calling its wake function. A new `sync-live-sweep` job calls
--    `/api/cron/sync-live?sweep=daily` once a day at 11:00Z — the hour TD5's
--    final-week re-poll already ran at (FINAL_WEEK_REPOLL_UTC_HOUR), before
--    the 11:15Z reconcile — so the one daily sweep carries the schedule
--    refresh, F270's open-window weeks and TD5's final weeks. The 30-second
--    wake calls `?sweep=none`: a game-window poll never sweeps. 183's knob
--    list gains `sync-live-sweep` (no knobs — Q98's stat-sync rule).
-- 5. The routes now do ONE pass per call and exit (this PR's TypeScript): no
--    20 s / 5 s sleep loops. The cadence is the schedule.
--
-- WHAT CHANGES FOR A LEAGUE MEMBER: during games, stats and scores refresh
-- every 30 s (was every 20 s / 5 s inside a held-open call). Outside games
-- nothing calls Vercel at all, except the 11:00Z sweep, a scoring queue with
-- work (stat fixes, a held week) and the close of a week. A stat correction
-- on a week still inside its correction window is picked up by the next
-- daily sweep (was: the next hourly one); a correction after the window is
-- recorded by the daily sweep, as before.
--
-- ---------------------------------------------------------------------------
-- THE STALL CHECK (124 §3) — its ingest arm, re-thresholded
-- ---------------------------------------------------------------------------
-- 124's ARM 2 fires when no `ingest_poll:%` row was written in 2 hours,
-- because the slowest healthy cadence was the HOURLY sweep (it tolerated one
-- missed sweep). Under a DAILY sweep that would light "Live stats delayed"
-- every non-game day by 13:00Z. So the threshold now depends on the window:
--   * NO window open → 49 hours. The slowest healthy cadence is the daily
--     sweep; 49 h tolerates exactly ONE missed daily sweep (48 h) plus an
--     hour for a slow one — the same "one miss, never a single blip" rule
--     124 drew for the hourly sweep. A single provider blip at 11:00Z must
--     not light a banner for a whole day (that is `stats_degraded`'s job,
--     after three failures).
--   * A window OPEN → 15 minutes, once the window has itself been open 15
--     minutes. In a window the wake polls every 30 s and every success stamps
--     `ingest_poll:`, so 15 quiet minutes is ~30 missed polls — the tight
--     alarm the in-game case deserves. The window's age (its earliest open
--     game's kickoff − 15 min) guards the opening: the last ingest before a
--     Thursday window is the morning's daily sweep, a day old, and that is
--     not a stall the moment the window opens.
-- ARM 1 (the queue, 10 minutes) is UNCHANGED and stays true: a claimable,
-- never-deferred row wakes score-week on the next 30 s tick; a held row
-- every ~5 minutes (see 2.).
-- `ingest_threshold_minutes` in the flag reports the threshold APPLIED (15 or
-- 2940), so an operator reading the flag sees which regime it judged by.
-- The function is otherwise 124's body, verbatim.
--
-- ---------------------------------------------------------------------------
-- MERGE BEFORE PUSH (the house rule: main deploys at once, the DB only on
-- Chris's push) — read out of the code, not assumed
-- ---------------------------------------------------------------------------
-- The new routes run against 124's per-minute pings until this is pushed:
--   * sync-live with NO `sweep` parameter = the pre-224 hourly sweep
--     (`'hourly'`, the named fallback), so 124's 2-hour ingest arm — still
--     the live one until the push — stays true. A HOT minute polls once
--     instead of three times: slower, still right.
--   * score-week drains once per minute instead of every 5 s: slower, still
--     right; a full claim still drains again at once.
-- And this migration against the OLD routes (pushed before the deploy —
-- not the house order, but possible): the old sync-live ignores `?sweep=`
-- (it reads no query string) and loops 45 s per call — the old cost, only
-- during windows; nothing breaks.
--
-- SECURITY. The two wake functions are SECURITY **INVOKER**, like 124's
-- `cron_ping_route` and for 124's reason: the caller is pg_cron's
-- `postgres`, which already reads Vault, and INVOKER fails CLOSED for every
-- other role (anon/authenticated have no USAGE on `vault`) — two locks
-- (that + the REVOKE) where DEFINER + REVOKE is one. A DEFINER wrapper would
-- hand whoever holds EXECUTE a way to make the database fire an
-- authenticated request at our cron routes. EXECUTE is REVOKEd from PUBLIC,
-- anon, authenticated AND service_role (a PUBLIC-only revoke leaves
-- service_role standing — measured in 124). The two read-only predicates
-- (`live_game_window_open`, `score_week_wake_reason`) carry no secret and
-- issue no request; they keep `service_role` EXECUTE as the D291 harness
-- door (the window equivalence suite calls the first through PostgREST),
-- and are REVOKEd from PUBLIC/anon/authenticated. search_path = '' on all.
--
-- Staging rehearsal: R6 waiver — no staging clone; rehearsal evidence = the
-- fresh local `db reset` 001–224 + pgTAP 174 (and 072/085/131 re-pinned) +
-- `npm run test:db` + the stack-backed equivalence suite in this PR.
-- No table is created or altered: four new functions, one replaced
-- (`scoring_stall_check`), one re-listed (`op_job_check_internal`), three
-- cron rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The game window — planLivePoll's HOT rule, in SQL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.live_game_window_open(
  p_now    TIMESTAMPTZ,
  p_season INTEGER DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
  -- OPEN_STATUSES = {scheduled, live}; NULL reads as scheduled (001's column
  -- default; `statusOf` in live-poll.ts). `final` is over and `postponed`
  -- waits for its new kickoff — neither keeps a window open.
  -- POLL_LEAD_MS = 15 minutes: polling starts 15 minutes before a kickoff.
  SELECT EXISTS (
    SELECT 1
      FROM public.nfl_games g
     WHERE g.season = COALESCE(p_season, (SELECT max(w.season) FROM public.nfl_weeks w))
       AND COALESCE(g.status, 'scheduled') IN ('scheduled', 'live')
       AND g.kickoff_at <= p_now + interval '15 minutes'
  );
$fn$;

COMMENT ON FUNCTION public.live_game_window_open(TIMESTAMPTZ, INTEGER) IS
  'Migration 224: is a game window open at p_now? — an nfl_games row of the season (default: the newest season in nfl_weeks) whose status is scheduled or live (NULL = scheduled) with kickoff_at <= p_now + 15 minutes. planLivePoll''s HOT rule exactly (live-poll.ts OPEN_STATUSES / POLL_LEAD_MS; pinned equal in live-poll-window-db.test.ts). A final game never keeps a window open (Chris 2026-11-14: "once the score is final the game is over"). Read-only; carries no secret.';

REVOKE EXECUTE ON FUNCTION public.live_game_window_open(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;
-- service_role KEEPS EXECUTE (platform default): the D291 harness door —
-- the equivalence suite calls it through PostgREST.
GRANT EXECUTE ON FUNCTION public.live_game_window_open(TIMESTAMPTZ, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Why score-week should run now — or NULL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.score_week_wake_reason(p_now TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  -- = SCORE_WEEK_LEASE_SECONDS (score-week-invoker.ts), the lease the route
  -- claims with: a row leased more recently is a LIVE drain's, not work.
  c_lease CONSTANT INTERVAL := interval '120 seconds';
  v_utc   TIMESTAMP := p_now AT TIME ZONE 'UTC';
  v_slot  BOOLEAN;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'score_week_wake_reason: p_now is required (the injected instant, D291)'
      USING ERRCODE = '22023';
  END IF;

  IF public.live_game_window_open(p_now) THEN
    RETURN 'game_window';
  END IF;

  -- Fresh work: claimable by score_fanout_claim's own predicate (122 §3) and
  -- never deferred — a new delta from ingestion (whose re-stamp clears any
  -- deferral) or the leftovers of a drain that died holding a lease.
  IF EXISTS (
    SELECT 1 FROM public.score_fanout q
     WHERE (q.claimed_at IS NULL OR q.claimed_at < p_now - c_lease)
       AND q.deferred_until IS NULL
  ) THEN
    RETURN 'queue';
  END IF;

  -- Work that can be owed for a long time on purpose: once per 5 minutes.
  v_slot := (EXTRACT(MINUTE FROM v_utc)::INTEGER % 5 = 0) AND EXTRACT(SECOND FROM v_utc) < 30;
  IF NOT v_slot THEN
    RETURN NULL;
  END IF;

  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.score_fanout q
       WHERE (q.claimed_at IS NULL OR q.claimed_at < p_now - c_lease)
         AND q.deferred_until <= p_now
    ) THEN
      RETURN 'queue_held';
    END IF;
    -- The close pass's own read (216): a week to close.
    IF EXISTS (SELECT 1 FROM public.league_weeks_to_close(p_now, 1)) THEN
      RETURN 'close_owed';
    END IF;
    -- The stat-fix pass's own read (222): a fix owed somewhere.
    IF EXISTS (SELECT 1 FROM public.stat_fix_targets(TRUE, 1)) THEN
      RETURN 'stat_fix_owed';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Fail OPEN: the route's own pass meets the same error and alerts by name
    -- (`CLOSE PASS ERROR` / `STAT FIX PASS ERROR`); staying silent here would
    -- hide it until a game window. NOT a statement timeout: WHEN OTHERS
    -- cannot catch query_canceled (57014 — measured in pgTAP 174's first
    -- run). A cancel fails that tick's whole job, recorded in
    -- cron.job_run_details, and the next slot tries again.
    RAISE WARNING 'score_week_wake_reason: a pass read failed (% %) — waking score-week so its pass reports it', SQLSTATE, SQLERRM;
    RETURN 'check_failed';
  END;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.score_week_wake_reason(TIMESTAMPTZ) IS
  'Migration 224: why /api/cron/score-week should run at p_now, or NULL. Every 30 s tick: game_window (live_game_window_open) or queue (a score_fanout row score_fanout_claim would take now — lease 120 s — that was never deferred). Once per 5 minutes (the tick in [:00,:30) of a minute divisible by 5): queue_held (a claimable row deferred before), close_owed (league_weeks_to_close(p_now, 1) — 216''s own read), stat_fix_owed (stat_fix_targets(true, 1) — 222''s own read); a read that raises returns check_failed (fail open). The slot keeps a hold or a refused week — owed for a long time on purpose — from waking Vercel every 30 s. Read-only; carries no secret.';

REVOKE EXECUTE ON FUNCTION public.score_week_wake_reason(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.score_week_wake_reason(TIMESTAMPTZ) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The two job bodies — decide, and ping only on a yes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_wake_sync_live(p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER          -- 124's reason; see the banner
SET search_path = ''
AS $fn$
DECLARE
  v_open       BOOLEAN := public.live_game_window_open(p_now);
  v_request_id BIGINT;
BEGIN
  IF v_open THEN
    -- `sweep=none`: a game-window poll never sweeps — the daily job does.
    v_request_id := public.cron_ping_route('/api/cron/sync-live?sweep=none');
  END IF;
  RETURN jsonb_build_object('woke', v_open, 'reason', CASE WHEN v_open THEN 'game_window' END,
                            'request_id', v_request_id, 'at', p_now);
END;
$fn$;

COMMENT ON FUNCTION public.cron_wake_sync_live(TIMESTAMPTZ) IS
  'Migration 224: the sync-live-ping job body (every 30 s). Calls /api/cron/sync-live?sweep=none through cron_ping_route ONLY while live_game_window_open(p_now); otherwise sends nothing. Returns {woke, reason, request_id, at}. SECURITY INVOKER like cron_ping_route (the caller is pg_cron''s postgres); EXECUTE revoked from every API role.';

REVOKE EXECUTE ON FUNCTION public.cron_wake_sync_live(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cron_wake_score_week(p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER          -- 124's reason; see the banner
SET search_path = ''
AS $fn$
DECLARE
  v_reason     TEXT := public.score_week_wake_reason(p_now);
  v_request_id BIGINT;
BEGIN
  IF v_reason IS NOT NULL THEN
    v_request_id := public.cron_ping_route('/api/cron/score-week');
  END IF;
  RETURN jsonb_build_object('woke', v_reason IS NOT NULL, 'reason', v_reason,
                            'request_id', v_request_id, 'at', p_now);
END;
$fn$;

COMMENT ON FUNCTION public.cron_wake_score_week(TIMESTAMPTZ) IS
  'Migration 224: the score-week-ping job body (every 30 s). Calls /api/cron/score-week through cron_ping_route ONLY when score_week_wake_reason(p_now) names a reason; otherwise sends nothing. Returns {woke, reason, request_id, at}. SECURITY INVOKER like cron_ping_route; EXECUTE revoked from every API role.';

REVOKE EXECUTE ON FUNCTION public.cron_wake_score_week(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. scoring_stall_check — 124's body, ARM 2 re-thresholded (see banner)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scoring_stall_check(p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER          -- writes as `postgres` (rolbypassrls) from cron; 122's
                          -- "no client write policy for any role" is untouched.
SET search_path = ''
AS $fn$
DECLARE
  -- TEN minutes, applied to ALL THREE of the row's stamps (124, unchanged).
  c_stall_after   CONSTANT INTERVAL := INTERVAL '10 minutes';
  -- 224: outside a game window the slowest healthy ingest is the DAILY sweep
  -- (11:00Z) — 49 h tolerates exactly one missed sweep plus an hour.
  c_ingest_quiet  CONSTANT INTERVAL := INTERVAL '49 hours';
  -- 224: inside a window the wake polls every 30 s — 15 quiet minutes is a
  -- stall, once the window itself is 15 minutes old.
  c_ingest_window CONSTANT INTERVAL := INTERVAL '15 minutes';
  v_cutoff        TIMESTAMPTZ;
  v_rows          INTEGER;
  v_oldest        TIMESTAMPTZ;
  v_last_ingest   TIMESTAMPTZ;
  v_window_since  TIMESTAMPTZ;
  v_ingest_after  INTERVAL;
  v_ingest_stale  BOOLEAN;
  v_reasons       JSONB := '[]'::jsonb;
  v_value         JSONB;
BEGIN
  v_cutoff := p_now - c_stall_after;

  -- ARM 1 — the queue is not being drained (124, verbatim).
  SELECT count(*)::INTEGER, min(q.enqueued_at)
    INTO v_rows, v_oldest
    FROM public.score_fanout q
   WHERE q.enqueued_at < v_cutoff
     AND (q.claimed_at     IS NULL OR q.claimed_at     < v_cutoff)
     AND (q.deferred_until IS NULL OR q.deferred_until < v_cutoff);

  -- ARM 2 — INGESTION has stopped (124), judged by the cadence that should
  -- be running NOW (224).
  SELECT max(f.updated_at)
    INTO v_last_ingest
    FROM public.system_flags f
   WHERE f.key LIKE 'ingest_poll:%';

  -- When did the open window open? The earliest open game's kickoff − 15 min
  -- (the same rows live_game_window_open reads); NULL = no window open.
  SELECT min(g.kickoff_at) - interval '15 minutes'
    INTO v_window_since
    FROM public.nfl_games g
   WHERE g.season = (SELECT max(w.season) FROM public.nfl_weeks w)
     AND COALESCE(g.status, 'scheduled') IN ('scheduled', 'live')
     AND g.kickoff_at <= p_now + interval '15 minutes';

  IF v_window_since IS NOT NULL THEN
    v_ingest_after := c_ingest_window;
    v_ingest_stale := v_last_ingest IS NOT NULL
                      AND v_last_ingest  < p_now - c_ingest_window
                      AND v_window_since < p_now - c_ingest_window;
  ELSE
    v_ingest_after := c_ingest_quiet;
    -- A MISSING row is NOT a stall (124): never ingested is not stopped.
    v_ingest_stale := v_last_ingest IS NOT NULL AND v_last_ingest < p_now - c_ingest_quiet;
  END IF;

  IF v_rows > 0        THEN v_reasons := v_reasons || to_jsonb('queue_undrained'::TEXT); END IF;
  IF v_ingest_stale    THEN v_reasons := v_reasons || to_jsonb('ingest_stale'::TEXT);    END IF;

  v_value := jsonb_build_object(
    'stalled',                  (v_rows > 0 OR v_ingest_stale),
    'reasons',                  v_reasons,
    'rows',                     v_rows,
    'oldest_enqueued_at',       v_oldest,
    'threshold_minutes',        (EXTRACT(EPOCH FROM c_stall_after) / 60)::INTEGER,
    'ingest_stale',             v_ingest_stale,
    'last_ingest_at',           v_last_ingest,
    -- 224: the threshold APPLIED — 15 in a game window, 2940 outside one.
    'ingest_threshold_minutes', (EXTRACT(EPOCH FROM v_ingest_after) / 60)::INTEGER,
    'checked_at',               p_now);

  INSERT INTO public.system_flags (key, value, updated_at)
  VALUES ('scoring_stalled', v_value, p_now)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

  IF v_rows > 0 THEN
    RAISE WARNING 'scoring_stalled/queue_undrained: % score_fanout row(s) claimable and untouched since % (> %) — the score-week drain is not running (§23.2)',
      v_rows, v_oldest, c_stall_after;
  END IF;
  IF v_ingest_stale THEN
    RAISE WARNING 'scoring_stalled/ingest_stale: the last successful ingestion poll completed % (> % ago%) — sync-live is not running, so nothing is being enqueued at all (§23.2; both pings share one helper and one pair of Vault secrets)',
      v_last_ingest, v_ingest_after, CASE WHEN v_window_since IS NOT NULL THEN ', inside a game window' ELSE ', no game window — the daily sweep' END;
  END IF;

  RETURN v_value;
END;
$fn$;

COMMENT ON FUNCTION public.scoring_stall_check(TIMESTAMPTZ) IS
  'Every minute (124; re-thresholded by 224), two arms, and upserts `system_flags.scoring_stalled` {stalled, reasons, rows, oldest_enqueued_at, threshold_minutes, ingest_stale, last_ingest_at, ingest_threshold_minutes, checked_at}. ARM 1 `queue_undrained`: `score_fanout` rows `score_fanout_claim` WOULD STILL TAKE (122 §3) that nothing has moved in 10 minutes — stamps read as INSTANTS. ARM 2 `ingest_stale`: no `ingest_poll:<season>:<week>` row written in 49 hours when no game window is open (224: the slowest healthy ingest is the daily 11:00Z sweep — one missed sweep tolerated), or in 15 minutes inside a game window that has itself been open 15 minutes (the 30-second wake should be ingesting); `ingest_threshold_minutes` reports the one applied. A MISSING ingest_poll row is not a stall (never ingested is not stopped). The in-season scoring surfaces poll this key every 60 s and raise the "Live stats delayed" banner from it. A frozen `checked_at` means this job itself stopped (F330(a)).';

-- 124's grants stand (CREATE OR REPLACE keeps the ACL); restated so a
-- reader of this file sees them.
REVOKE EXECUTE ON FUNCTION public.scoring_stall_check(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. 183's job-knob list — `sync-live-sweep` named (no knobs, Q98)
-- ---------------------------------------------------------------------------
-- 183's body verbatim (HEAD of the chain — no later migration redefines it)
-- with one name added, so an operator asking for knobs on the new job is
-- refused BY NAME like its siblings, not as an "unknown job".
CREATE OR REPLACE FUNCTION public.op_job_check_internal(p_job TEXT, p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_job IN ('waivers', 'week-advance', 'week-finalize') THEN
    RETURN;
  END IF;
  IF p_job = 'lineup-lock' THEN
    IF p_kind = 'run' THEN RETURN; END IF;
    RAISE EXCEPTION 'lineup locking can never be paused or resumed — pausing would let people move players after kickoff (Q98); it has "run now" only'
      USING ERRCODE = '22023';
  END IF;
  IF p_job IN ('draft-tick', 'mock-expiry', 'trade-tick', 'sync-live-ping', 'score-week-ping', 'sync-live-sweep',
               'scoring-stall-check', 'sync-weekly-projections-ping', 'league-player-values-ping') THEN
    RAISE EXCEPTION 'job "%" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)', p_job
      USING ERRCODE = '22023';
  END IF;
  RAISE EXCEPTION 'unknown job "%" — the operator knobs cover waivers, week-advance, week-finalize (and run-now for lineup-lock)', p_job
    USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.op_job_check_internal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The jobs — unschedule-first (124 / 068:1257-1268), idempotent
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-live-ping') THEN
    PERFORM cron.unschedule('sync-live-ping');
  END IF;
  PERFORM cron.schedule('sync-live-ping', '30 seconds',
    'SELECT public.cron_wake_sync_live()');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'score-week-ping') THEN
    PERFORM cron.unschedule('score-week-ping');
  END IF;
  PERFORM cron.schedule('score-week-ping', '30 seconds',
    'SELECT public.cron_wake_score_week()');

  -- The one daily sweep (Chris 2026-11-14: "once a day on none day games"),
  -- at TD5's re-poll hour so it carries the final-week re-poll.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-live-sweep') THEN
    PERFORM cron.unschedule('sync-live-sweep');
  END IF;
  PERFORM cron.schedule('sync-live-sweep', '0 11 * * *',
    'SELECT public.cron_ping_route(''/api/cron/sync-live?sweep=daily'')');
END;
$do$;
