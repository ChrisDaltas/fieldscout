-- ============================================================================
-- 226_cron_log_retention.sql — THE SCHEDULER'S OWN LOG STOPS GROWING: an
-- hourly prune of `cron.job_run_details`, and a nightly VACUUM of it and of
-- pg_net's response table. Discharges PROGRESS F332 (filed 2026-09-10).
--
-- Numbering: migration head measured 225 on main (`ls supabase/migrations/ |
-- tail -1` — F917(b)'s daily pings, merged the same day) ⇒ 226; pgTAP head
-- 175 ⇒ 176. The two migrations touch no object in common.
--
-- ---------------------------------------------------------------------------
-- WHY — measured on the hosted database, read-only, 2026-11-17
-- ---------------------------------------------------------------------------
--   whole database                 671 MB   (447 MB on 2026-10-21)
--   cron.job_run_details           415 MB   2,300,045 rows, oldest 2026-08-07
--                                           (365 MB heap + 50 MB primary key)
--   net._http_response (pg_net)    184 MB   154 live rows
--   every `public` table together   47 MB
--
-- Nine tenths of the database is two logs nobody prunes.
--
--   * `cron.job_run_details` gets one row per job run and pg_cron ships no
--     retention. `draft-tick` (068, every 5 s) alone is 1,755,471 of the rows;
--     the per-minute jobs and the pings are the rest. The schedule as it
--     stands after 224, 225 and this file adds up to 29,167 runs a day
--     (17,280 of them `draft-tick`). Only 2 of the 2.3 million rows are not
--     `succeeded`.
--   * `net._http_response` is NOT a retention problem: `pg_net.ttl` is
--     '6 hours' and it works — 154 rows, the oldest 6 hours old. It is DEAD
--     SPACE. pg_net's worker deletes the expired rows, but
--     `pg_stat_all_tables` shows n_tup_ins = 0, n_tup_del = 0 and
--     autovacuum_count = 0 for the table across 199,269 requests: the
--     worker's writes never reach the statistics autovacuum decides from, so
--     the table has never been vacuumed and every response ever stored still
--     occupies its page. The same row of zeroes is on `cron.job_run_details`
--     (pg_cron's launcher writes it), which has never been vacuumed either.
--     (`pg_net.ttl` itself needs ALTER SYSTEM, which `postgres` does not hold
--     on the hosted project — measured — and it does not need changing.)
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
-- 1. `public.cron_log_prune(p_now, p_keep, p_keep_failed, p_max_rows)` —
--    deletes run-log rows that are past their window, oldest first:
--      * a `succeeded` run            older than 7 days;
--      * any other run (failed, …)    older than 30 days;
--      * a run with NO start and NO end time (one the scheduler was holding
--        when the server restarted): once a timed run with a higher runid has
--        aged past the 7-day window — runids only ever rise, so that run
--        proves this one is older still;
--      * NEVER the newest run of a job that is still scheduled, however old.
--    A row's age is its `start_time` (its `end_time` if it never started).
--    One call deletes at most `p_max_rows` (250,000) rows, the oldest first,
--    and returns {deleted, more, keep_from, keep_failed_from, at}.
-- 2. `cron-log-prune` — pg_cron, hourly at :17, `SELECT public.cron_log_prune()`.
-- 3. `cron-log-vacuum` — pg_cron, daily at 09:23Z (01:23 Pacific / 04:23
--    Eastern in winter), `VACUUM (ANALYZE) cron.job_run_details`.
-- 4. `pg-net-log-vacuum` — pg_cron, daily at 09:33Z,
--    `VACUUM (ANALYZE) net._http_response`.
--
-- ALL THREE JOBS ARE PURE SQL. None calls `cron_ping_route`, pg_net or any
-- route — nothing here wakes Vercel (Chris 2026-11-14, 224's banner: "Why are
-- we checking for stuff? The games are only played on Thursday … Sunday …
-- Monday"). pgTAP 176 pins that by reading the three commands.
--
-- ---------------------------------------------------------------------------
-- THE WINDOWS, AND WHO READS THIS TABLE
-- ---------------------------------------------------------------------------
-- 124 and F332 said the run log "has no reader in this repo". That stopped
-- being true at 186, so the windows are set by its readers:
--
--   * 186's `op_cron_last_runs_internal` (the admin console's "Scheduler"
--     list and its stalled-jobs count, `/app/admin`) reads THE NEWEST RUN OF
--     EVERY SCHEDULED JOB, and says "Has not run yet" when a job has no row.
--     The slowest jobs are daily, so any window of a day or more serves it —
--     except for a job that has been switched off, or after the scheduler
--     itself was down for longer than the window. There a plain age rule
--     would delete the job's last run and the console would then say it has
--     never run. So the newest run of every job still in `cron.job` is never
--     deleted. An unscheduled job's rows (224 re-created both pings, leaving
--     195,486 rows under two job ids no job has any more) get no such
--     protection — nothing reads them.
--   * `docs/runbooks/beta-ladder.md` §5 counts FAILED runs over a draft
--     weekend's window (Friday to the following Wednesday at the earliest),
--     and is run when the window ends or later. A 7-day window on everything
--     would quietly return a smaller count to a late read — zero failures
--     because the rows were gone. So failed runs are kept 30 days. They are
--     the rows worth keeping and there are almost none of them.
--   * PROGRESS F331 (2) and F917 tell whoever pushes a cron migration to
--     look at the newest runs of the jobs it touched — days after a push, not
--     weeks; 7 days covers both.
--   * 183's `job_pauses` does not read the run log (it keeps its own
--     `skipped_runs`), and no script under `scripts/` or `src/` does either.
--
-- 7 days for the rest is F332's own number, and one full NFL week: on any
-- day, last Sunday's runs are still there.
--
-- AFTER THE BACKLOG: ~204,000 rows (7 days × 29,167), about 37 MB packed.
--
-- ---------------------------------------------------------------------------
-- WHY HOURLY AND IN BATCHES, NOT ONE DELETE A DAY
-- ---------------------------------------------------------------------------
-- pg_cron runs each job over an ordinary connection as `postgres`
-- (`cron.use_background_workers = off`), and the hosted project's
-- `statement_timeout` is 120 s for that role (measured). The first prune has
-- ~2,118,000 rows to delete. A statement that was cancelled at 120 s would
-- roll back to nothing, fail the same way the next day, and never finish.
--
-- So one call deletes a bounded batch — the 250,000 oldest rows that are past
-- their window — and the job runs hourly: the backlog is gone in about nine
-- runs instead of nine days. After that an hourly run deletes ~1,200 rows. A
-- failed run is retried in an hour, not a day.
--
-- MEASURED on the hosted table (read-only EXPLAIN ANALYZE, 2026-11-17; 2.3
-- million rows, never analyzed):
--   * choosing one batch — the rule over the rows at or below the mark, in
--     runid order, LIMIT 250,001 — walks the primary key and stops at the
--     batch: 7.6 s with the walk that finds the mark, no sort and no pass
--     over the table;
--   * finding a scheduled job's newest run when it has none inside the window
--     IS a pass over the rows below the mark: 6.8 s against the full backlog
--     (`sync-live-sweep`, created that afternoon, had not had its first run).
--     One pass however many such jobs there are; next to nothing once the
--     backlog is gone.
-- NOT measured: the DELETE itself (this work may only read the hosted
-- database). It removes the batch by primary key, inside the range the batch
-- spans.
-- NOT GUARANTEED until the table has its first statistics (the first nightly
-- ANALYZE): the plans. The index walk above is what the hosted planner chose
-- with no statistics; under other cost settings (the local stack's) the same
-- read is a pass over the rows below the mark plus a sort, and the "jobs with
-- a run inside the window" step may read the whole table (about 7 s there)
-- instead of walking the window. An earlier draft's sort form measured 14.3 s
-- on hosted. Whichever plans are chosen, a call is tens of seconds against
-- 120 for the nine runs the backlog lasts, and well under a second after.
--
-- ---------------------------------------------------------------------------
-- WHY A SCHEDULED VACUUM, AND WHAT IT DOES NOT DO
-- ---------------------------------------------------------------------------
-- Autovacuum is blind to both tables (above), so nothing would ever reclaim
-- what pg_net's worker deletes, and the run log would depend on the prune's
-- own deletes happening to trip it. A plain VACUUM makes the space reusable
-- and hands back any EMPTY PAGES AT THE END of the file; it takes no lock
-- that blocks the scheduler (the end-of-file truncation asks for one briefly
-- and gives way to anyone waiting). VACUUM cannot run inside a function or a
-- transaction, which is why these are jobs with a bare command; pg_cron runs
-- it as a top-level statement. `postgres` holds MAINTAIN on both tables on
-- the hosted project (measured) — pgTAP 176 pins it locally, because VACUUM
-- without it only WARNS and the job would read `succeeded` having done
-- nothing.
--
-- ONE TABLE PER JOB, because of the same 120 s `statement_timeout`: a single
-- `VACUUM a, b` is one statement with one budget, and the first night it has
-- 365 MB and 180 MB of never-vacuumed heap to read. Apart, each table has its
-- own 120 s, one cannot starve the other, and the admin console shows which
-- one failed. If a first-night VACUUM is cancelled anyway, nothing is lost
-- and it runs again the next night. For the run log there is also a second
-- route: the prune's deletes are made from a job's ordinary connection, and
-- writes made that way ARE counted (pg_net's request queue, written by the
-- ping jobs, shows 199,272 inserts and 1,977 autovacuums), so autovacuum —
-- which has no statement timeout — can pick that table up by itself. Once
-- the backlog is gone a VACUUM of either table is a matter of seconds.
--
-- WHEN THE DISK SPACE COMES BACK (rehearsed on a 300,000-row copy of the
-- table's shape, local PG 17.6: DELETE and the first VACUUM left the file at
-- 38 MB; once the last pre-prune rows had aged out, the next plain VACUUM cut
-- it to 7.5 MB; VACUUM FULL packed it to 2.8 MB):
--   * `net._http_response`: its live rows sit at the end of the file today,
--     so the first nightly VACUUM frees the pages and the second — once those
--     rows have expired — truncates the file. ~184 MB back within two nights.
--   * `cron.job_run_details`: the same, on a 7-day clock. New rows fill the
--     freed pages at the front; the rows at the end age out a week after the
--     backlog clears; the VACUUM after that truncates the heap. Its primary
--     key stays at 50 MB (a B-tree file does not shrink without a rebuild).
--   * NOT DONE HERE: `VACUUM FULL cron.job_run_details;` repacks the table
--     and its index at once (to ~37 MB) instead of a week later. It cannot run
--     inside a migration's transaction, and it locks the table against the
--     scheduler for the second or two it takes, so it is left as an optional
--     one-line step for Chris, run by hand once the backlog is gone. Nothing
--     depends on it.
--
-- ---------------------------------------------------------------------------
-- MERGE BEFORE PUSH
-- ---------------------------------------------------------------------------
-- No application code calls any of this and no route changes: until the push
-- nothing is different, and after it nothing in the app depends on it. The
-- admin console lists three more jobs in "Scheduler".
--
-- SECURITY. `cron_log_prune` is SECURITY **INVOKER**, like 124's
-- `cron_ping_route` and 224's wake functions and for their reason: the caller
-- is pg_cron's `postgres`, which already holds DELETE on the run log, so
-- DEFINER buys nothing — and INVOKER fails CLOSED for everyone else
-- (anon / authenticated / service_role have no USAGE on schema `cron`,
-- measured), so a grant restored by accident still cannot delete the
-- scheduler's history. EXECUTE is REVOKEd from PUBLIC, anon, authenticated
-- AND service_role (a PUBLIC-only revoke leaves service_role standing —
-- measured in 124). search_path = ''. No harness door: nothing outside the
-- scheduler has a reason to delete its log. 183's knob list is NOT extended:
-- its by-name refusal reads "drafts and stat syncing get no pause / resume /
-- run-now", which these are not, so they stay an "unknown job" to the knobs.
-- `src/types/database.ts` gains the function's line beside its `cron_*`
-- neighbours, by hand (no API role can call it; the line keeps the next
-- regeneration from showing a stray diff).
--
-- Staging rehearsal: R6 waiver — no staging clone. Rehearsal evidence = this
-- file applied in one transaction to the local stack; pgTAP 176 and its
-- break probes; the reviewer's randomized comparison against an independent
-- oracle; all three job commands run end to end by the local
-- pg_cron (same libpq mode as hosted), with `pg_stat_all_tables` showing both
-- tables vacuumed and analyzed. The from-nothing replay 001–226 and the full
-- pgTAP suite are CI's `db` workflow on the PR — the local stack was in use
-- by another build that day, so the full suite was not run on it.
-- No table is created or altered: one new function, three cron rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. cron_log_prune — one bounded batch, oldest first
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_log_prune(
  p_now         TIMESTAMPTZ DEFAULT now(),
  p_keep        INTERVAL    DEFAULT INTERVAL '7 days',
  p_keep_failed INTERVAL    DEFAULT INTERVAL '30 days',
  p_max_rows    INTEGER     DEFAULT 250000
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER          -- 124's reason; see the banner. The caller is `postgres`.
SET search_path = ''
AS $fn$
DECLARE
  v_cut_ok     TIMESTAMPTZ;
  v_cut_failed TIMESTAMPTZ;
  v_mark       BIGINT;             -- the newest runid past the short window
  v_recent     BIGINT[];           -- jobs with a timed run inside the window
  v_quiet      BIGINT[];           -- scheduled jobs without one
  v_protected  BIGINT[] := '{}';   -- the newest run of each of those
  v_due        BIGINT[];           -- this call's batch, oldest first (+ 1 to know if there is more)
  v_more       BOOLEAN;
  v_deleted    BIGINT := 0;
BEGIN
  IF p_now IS NULL OR p_keep IS NULL OR p_keep_failed IS NULL OR p_max_rows IS NULL THEN
    RAISE EXCEPTION 'cron_log_prune: p_now, p_keep, p_keep_failed and p_max_rows are all required'
      USING ERRCODE = '22023';
  END IF;
  -- A day is the floor: the admin console reads the last run of daily jobs,
  -- and a mistyped window must not be able to empty the log.
  IF p_keep < INTERVAL '1 day' OR p_keep_failed < p_keep OR p_max_rows < 1 THEN
    RAISE EXCEPTION 'cron_log_prune: keep at least 1 day, keep failed runs at least as long as the rest, and allow at least 1 row per call (got %, %, %)',
      p_keep, p_keep_failed, p_max_rows
      USING ERRCODE = '22023';
  END IF;
  -- Nor may a mistyped instant: seen from next year, every run is old.
  IF p_now > now() + INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'cron_log_prune: p_now (%) is in the future', p_now
      USING ERRCODE = '22023';
  END IF;

  v_cut_ok     := p_now - p_keep;
  v_cut_failed := p_now - p_keep_failed;

  -- THE MARK: the newest runid that is past the short window. Everything
  -- deletable is at or below it (a failed run past 30 days is past 7 too), so
  -- the rule never has to look at the window's own rows. A run with NO
  -- timestamps is
  -- judged against it: a lower runid was created before that run, so it is
  -- older still — and a run in flight, whose runid is the highest there is,
  -- can never be below it.
  SELECT d.runid
    INTO v_mark
    FROM cron.job_run_details d
   WHERE COALESCE(d.start_time, d.end_time) < v_cut_ok
   ORDER BY d.runid DESC
   LIMIT 1;

  IF v_mark IS NULL THEN
    -- Nothing is past the window, so nothing is deletable. Said, not implied.
    RETURN jsonb_build_object('deleted', 0, 'more', FALSE,
                              'keep_from', v_cut_ok, 'keep_failed_from', v_cut_failed, 'at', p_now);
  END IF;

  -- THE NEWEST RUN OF EVERY SCHEDULED JOB IS KEPT (186's reader). A job with
  -- a timed run above the mark has its newest run inside the window, where
  -- nothing is deleted — so only a job WITHOUT one needs naming: switched
  -- off, or the scheduler was down longer than the window. For each such job
  -- still in `cron.job` (active or not), the row 186's
  -- `op_cron_last_runs_internal` would report (its ORDER BY, verbatim) is set
  -- aside.
  SELECT COALESCE(array_agg(DISTINCT d.jobid) FILTER (WHERE d.jobid IS NOT NULL), '{}')
    INTO v_recent
    FROM cron.job_run_details d
   WHERE d.runid > v_mark
     AND d.start_time IS NOT NULL;

  SELECT COALESCE(array_agg(j.jobid), '{}')
    INTO v_quiet
    FROM cron.job j
   WHERE j.jobid <> ALL (v_recent);

  IF cardinality(v_quiet) > 0 THEN
    -- ONE pass for all of them, and only over the rows at or below the mark
    -- (a job with no timed run above it has every timed run below it).
    SELECT COALESCE(array_agg(top.runid), '{}')
      INTO v_protected
      FROM (
        SELECT DISTINCT ON (d.jobid) d.runid
          FROM cron.job_run_details d
         WHERE d.runid <= v_mark
           AND d.jobid = ANY (v_quiet)
         ORDER BY d.jobid, d.start_time DESC NULLS LAST, d.runid DESC) top;
  END IF;

  -- THE RULE — written ONCE, here. The oldest p_max_rows + 1 runs that are
  -- past their window; the extra one only answers "is there more?".
  SELECT COALESCE(array_agg(x.runid ORDER BY x.runid), '{}')
    INTO v_due
    FROM (
      SELECT d.runid
        FROM cron.job_run_details d
       WHERE d.runid <= v_mark
         AND CASE
               WHEN d.start_time IS NULL AND d.end_time IS NULL THEN d.runid < v_mark
               WHEN d.status = 'succeeded' THEN COALESCE(d.start_time, d.end_time) < v_cut_ok
               ELSE COALESCE(d.start_time, d.end_time) < v_cut_failed
             END
         AND d.runid <> ALL (v_protected)
       ORDER BY d.runid
       LIMIT p_max_rows::BIGINT + 1) x;

  v_more := cardinality(v_due) > p_max_rows;
  IF v_more THEN
    v_due := v_due[1:p_max_rows];
  END IF;

  IF cardinality(v_due) > 0 THEN
    -- Exactly the runs chosen above, by primary key. The range is the
    -- batch's own span — it keeps the read on the index whatever the planner
    -- knows about the table. The rule is NOT re-checked here (it is written
    -- once): a row re-stamped as recent by someone else between the two
    -- statements would still go. Nothing does that — the launcher only
    -- writes runs in flight, and those are never chosen.
    DELETE FROM cron.job_run_details d
     WHERE d.runid >= v_due[1]
       AND d.runid <= v_due[cardinality(v_due)]
       AND d.runid = ANY (v_due);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'deleted',          v_deleted,
    -- More runs are past their window than one call takes; the next hourly
    -- run carries on.
    'more',             v_more,
    'keep_from',        v_cut_ok,
    'keep_failed_from', v_cut_failed,
    'at',               p_now);
END;
$fn$;

COMMENT ON FUNCTION public.cron_log_prune(TIMESTAMPTZ, INTERVAL, INTERVAL, INTEGER) IS
  'Migration 226 (F332): the cron-log-prune job body (hourly). Deletes cron.job_run_details rows past their window, oldest first, at most p_max_rows (250,000) per call: a succeeded run older than p_keep (7 days); any other run older than p_keep_failed (30 days — docs/runbooks/beta-ladder.md counts failed runs over a window); a run with no start and no end once a timed run with a higher runid is past p_keep. Age = start_time, else end_time. NEVER the newest run of a job still in cron.job — 186''s op_cron_last_runs_internal (the admin console) reads it. Refuses p_keep under 1 day and a p_now in the future. Returns {deleted, more, keep_from, keep_failed_from, at}. Pure SQL — calls nothing outside the database. SECURITY INVOKER (the caller is pg_cron''s postgres); EXECUTE revoked from every API role.';

REVOKE EXECUTE ON FUNCTION public.cron_log_prune(TIMESTAMPTZ, INTERVAL, INTERVAL, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The jobs — unschedule-first (124 / 068:1257-1268), idempotent
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  -- Hourly at :17 — off the hourly jobs' minutes (:00, :05) and 225's
  -- five-minute grid.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-log-prune') THEN
    PERFORM cron.unschedule('cron-log-prune');
  END IF;
  PERFORM cron.schedule('cron-log-prune', '17 * * * *',
    'SELECT public.cron_log_prune()');

  -- Daily at 09:23Z (01:23 Pacific / 04:23 Eastern in winter; before the 11:00Z
  -- sweep). A BARE command: VACUUM cannot run inside a function or beside a
  -- second statement. One table per job — each gets its own statement
  -- timeout (see the banner).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-log-vacuum') THEN
    PERFORM cron.unschedule('cron-log-vacuum');
  END IF;
  PERFORM cron.schedule('cron-log-vacuum', '23 9 * * *',
    'VACUUM (ANALYZE) cron.job_run_details');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pg-net-log-vacuum') THEN
    PERFORM cron.unschedule('pg-net-log-vacuum');
  END IF;
  PERFORM cron.schedule('pg-net-log-vacuum', '33 9 * * *',
    'VACUUM (ANALYZE) net._http_response');
END;
$do$;
