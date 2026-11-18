-- ============================================================================
-- 176 — the scheduler's own log stops growing (migration 226; PROGRESS F332)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  POSTURE: `cron_log_prune` is INVOKER, search_path '', executable by no
--       API role — and the second lock is real (none of them has USAGE on
--       `cron`). `postgres`, which pg_cron runs the jobs as, holds DELETE on
--       the run log and MAINTAIN on both tables: without MAINTAIN the nightly
--       VACUUM only WARNS and reads `succeeded` having done nothing.
--   §B  THE JOBS: hourly prune, a daily VACUUM per table, all PURE SQL (Chris
--       2026-11-14, 224: nothing new wakes Vercel), the DO block idempotent
--       (run twice).
--   §D  THE BATCH: a call takes the oldest runs first and no more than its
--       cap, says `more`, and the next call carries on — stepping over rows
--       it must keep (a switched-off job's last run older than everything;
--       failed runs still inside their 30 days) rather than stopping at them;
--       a batch that takes exactly the last due runs says there is no more.
--   §C  THE RULE (written once in the function), every arm: 7 days for a
--       succeeded run and 30 for any other, both boundaries at the
--       microsecond (D146); age = start_time, else end_time — for the mark
--       too; a run with no timestamps goes once a later timed run has aged
--       out and never before; THE NEWEST RUN OF A SCHEDULED JOB IS NEVER
--       DELETED — the row 186's reader reports, by 186's own ordering, for a
--       job that is switched off as much as for one that is merely quiet —
--       and 186's reader still reports it afterwards; an unscheduled job gets
--       no such protection.
--   §E  THE GUARDS: a window under a day, a failed-run window shorter than
--       the rest, a zero cap, any NULL argument and an instant in the future
--       are refused.
--
-- What it CANNOT prove: VACUUM itself (it cannot run inside a transaction).
-- §A/§B pin the commands and the privilege; the PR records each job run end
-- to end by the local pg_cron.
--
-- THE BREAK PROBES (tasks-M1 §4.3), run and reverted in this PR — listed in
-- the PR description with the cells each one reds.
--
-- FIXTURES. Every fixture run is in early 2001 with a NEGATIVE runid, and the
-- injected instant is 2001-03-01: every real row on a used stack is later
-- than any cut-off here and has a positive runid above the mark, so the
-- counts below are this file's alone. Runids rise with time, as pg_cron's do
-- (one pair, -8942 / -8940, is a microsecond out of order on purpose: it puts
-- the exactly-7-days run BELOW the mark, where only the rule can keep it).
--   cut-offs at 2001-03-01: 7 days = 2001-02-22, 30 days = 2001-01-30.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';

select plan(67);

-- ---------------------------------------------------------------------------
-- A. Posture
-- ---------------------------------------------------------------------------
select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
     from pg_proc p where p.oid = 'public.cron_log_prune(timestamptz, interval, interval, integer)'::regprocedure),
  'false:search_path=""',
  'A1 cron_log_prune is SECURITY INVOKER with search_path '''' (124''s reason: the caller is pg_cron''s postgres)');
select is(
  (select string_agg(r, ',' order by r) from unnest(array['public', 'anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'public.cron_log_prune(timestamptz, interval, interval, integer)', 'EXECUTE')),
  null,
  'A2 EXECUTE is held by NO API role — PUBLIC, anon, authenticated and service_role all revoked');
select is(
  (select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_schema_privilege(r, 'cron', 'USAGE')),
  null,
  'A3 the second lock: none of them has USAGE on schema cron, so INVOKER fails closed even if a grant came back');
select ok(has_table_privilege('postgres', 'cron.job_run_details', 'DELETE')
      and has_table_privilege('postgres', 'cron.job_run_details', 'SELECT')
      and has_table_privilege('postgres', 'cron.job', 'SELECT'),
  'A4 postgres — the role every job runs as — can read the jobs and delete from the run log');
select ok(has_table_privilege('postgres', 'cron.job_run_details', 'MAINTAIN')
      and has_table_privilege('postgres', 'net._http_response', 'MAINTAIN'),
  'A5 postgres holds MAINTAIN on BOTH tables — without it VACUUM only warns and the job would read succeeded having done nothing');
select is(pg_get_function_arguments('public.cron_log_prune(timestamptz, interval, interval, integer)'::regprocedure),
  'p_now timestamp with time zone DEFAULT now(), p_keep interval DEFAULT ''7 days''::interval, p_keep_failed interval DEFAULT ''30 days''::interval, p_max_rows integer DEFAULT 250000',
  'A6 the defaults the job runs with: 7 days, 30 days for a run that did not succeed, 250,000 rows a call');

set local role authenticated;
select throws_ok($$ select public.cron_log_prune() $$, '42501', null,
  'A7 a signed-in user cannot run it');
reset role;
set local role service_role;
select throws_ok($$ select public.cron_log_prune() $$, '42501', null,
  'A8 nor can the service role — nothing outside the scheduler deletes its log');
reset role;

-- ---------------------------------------------------------------------------
-- B. The jobs
-- ---------------------------------------------------------------------------
select is((select schedule || ' | ' || command from cron.job where jobname = 'cron-log-prune'),
  '17 * * * * | SELECT public.cron_log_prune()',
  'B1 cron-log-prune: hourly at :17, the function with its defaults');
select is((select schedule || ' | ' || command from cron.job where jobname = 'cron-log-vacuum'),
  '23 9 * * * | VACUUM (ANALYZE) cron.job_run_details',
  'B2 cron-log-vacuum: daily at 09:23Z, ONE bare VACUUM of the run log (autovacuum never sees the scheduler''s own writes)');
select is((select schedule || ' | ' || command from cron.job where jobname = 'pg-net-log-vacuum'),
  '33 9 * * * | VACUUM (ANALYZE) net._http_response',
  'B2b pg-net-log-vacuum: daily at 09:33Z, its own job — pg_net''s response table gets its own statement timeout, and nothing else ever vacuums it');
select is((select string_agg(distinct username, ',') from cron.job where jobname in ('cron-log-prune', 'cron-log-vacuum', 'pg-net-log-vacuum')),
  'postgres',
  'B3 all three run as postgres, like every other job');
select is(
  (select count(*)::int from cron.job
    where jobname in ('cron-log-prune', 'cron-log-vacuum', 'pg-net-log-vacuum')
      and command ~* '(cron_ping_route|cron_wake_|net\.http_|http_(get|post|delete))'),
  0,
  'B4 PURE SQL: no job''s command pings a route (Chris 2026-11-14 — nothing new wakes Vercel)');
select ok(
  pg_get_functiondef('public.cron_log_prune(timestamptz, interval, interval, integer)'::regprocedure)
    !~* '(cron_ping_route|cron_wake|net\.|vault\.)',
  'B5 …and the function body reaches for no route, no pg_net and no Vault secret');

do $do$
begin
  for i in 1..2 loop
    if exists (select 1 from cron.job where jobname = 'cron-log-prune') then perform cron.unschedule('cron-log-prune'); end if;
    perform cron.schedule('cron-log-prune', '17 * * * *', 'SELECT public.cron_log_prune()');
    if exists (select 1 from cron.job where jobname = 'cron-log-vacuum') then perform cron.unschedule('cron-log-vacuum'); end if;
    perform cron.schedule('cron-log-vacuum', '23 9 * * *', 'VACUUM (ANALYZE) cron.job_run_details');
    if exists (select 1 from cron.job where jobname = 'pg-net-log-vacuum') then perform cron.unschedule('pg-net-log-vacuum'); end if;
    perform cron.schedule('pg-net-log-vacuum', '33 9 * * *', 'VACUUM (ANALYZE) net._http_response');
  end loop;
end;
$do$;
select is((select count(*)::int from cron.job where jobname in ('cron-log-prune', 'cron-log-vacuum', 'pg-net-log-vacuum')), 3,
  'B6 226''s unschedule-first block re-applied TWICE leaves exactly one job per name');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select is(public.cron_log_prune('2001-03-01 00:00:00+00'),
  '{"at": "2001-03-01T00:00:00+00:00", "more": false, "deleted": 0, "keep_from": "2001-02-22T00:00:00+00:00", "keep_failed_from": "2001-01-30T00:00:00+00:00"}'::jsonb,
  'D0 nothing is past the window ⇒ {deleted: 0, more: false}, said outright — and the two cut-offs it would have used');

-- Four jobs that ARE scheduled (rows in cron.job; never run — the launcher
-- cannot see an uncommitted job) and two that are not (-176001 and -176002:
-- their rows are an unscheduled job's, like the two pings 224 re-created).
create temp table j176 on commit drop as
select cron.schedule('q176-quiet',   '0 0 1 1 *', 'SELECT 1') as quiet_id,     -- every timed run is old
       cron.schedule('q176-busy',    '0 0 1 1 *', 'SELECT 1') as busy_id,      -- has a run inside the window
       cron.schedule('q176-nostart', '0 0 1 1 *', 'SELECT 1') as nostart_id,   -- only runs with no timestamps
       cron.schedule('q176-off',     '0 0 1 1 *', 'SELECT 1') as off_id;       -- SWITCHED OFF below; one run, older than everything
do $do$ begin perform cron.alter_job((select off_id from j176), active := false); end; $do$;

-- The cap block: five contiguous old runs of the unscheduled job, inserted
-- NEWEST FIRST — "oldest first" must come from the runid, not from the order
-- the rows happen to lie in.
insert into cron.job_run_details (jobid, runid, database, username, command, status, return_message, start_time, end_time)
values (-176001, -9501, 'postgres', 'postgres', 'SELECT 1', 'succeeded', '1 row', '2000-10-01 00:04:00+00', '2000-10-01 00:04:01+00'),
       (-176001, -9502, 'postgres', 'postgres', 'SELECT 1', 'succeeded', '1 row', '2000-10-01 00:03:00+00', '2000-10-01 00:03:01+00'),
       (-176001, -9503, 'postgres', 'postgres', 'SELECT 1', 'succeeded', '1 row', '2000-10-01 00:02:00+00', '2000-10-01 00:02:01+00'),
       (-176001, -9504, 'postgres', 'postgres', 'SELECT 1', 'succeeded', '1 row', '2000-10-01 00:01:00+00', '2000-10-01 00:01:01+00'),
       (-176001, -9505, 'postgres', 'postgres', 'SELECT 1', 'succeeded', '1 row', '2000-10-01 00:00:00+00', '2000-10-01 00:00:01+00');

insert into cron.job_run_details (jobid, runid, database, username, command, status, return_message, start_time, end_time)
select v.jobid, v.runid, 'postgres', 'postgres', 'SELECT 1', v.status, v.msg, v.started, v.ended
  from j176 j, lateral (values
    -- THE OLDEST ROW IN THE LOG is a switched-off job's newest (only) run  → STAYS, and must not stop the batch
    (j.off_id,             -9600::bigint, 'succeeded', '1 row', '2000-09-01 00:00:00+00'::timestamptz, '2000-09-01 00:00:01+00'::timestamptz),
    -- the rule block
    (-176001,              -9000, 'succeeded', '1 row', '2000-11-01 00:00:00+00', '2000-11-01 00:00:01+00'),   -- old, succeeded          → goes
    (-176002,              -8998, 'succeeded', '1 row', '2000-11-03 00:00:00+00', '2000-11-03 00:00:01+00'),   -- UNSCHEDULED job's newest (only) run → goes
    (j.quiet_id,           -8995, 'succeeded', '1 row', '2000-11-05 00:00:00+00', '2000-11-05 00:00:01+00'),   -- quiet job, not newest   → goes
    (-176001,              -8990, 'failed',    'boom',  '2000-11-02 00:00:00+00', '2000-11-02 00:00:01+00'),   -- failed, 4 months        → goes
    (-176001,              -8985, 'failed',    'boom',  null,                     '2001-01-15 00:00:00+00'),   -- never started; END old  → goes
    (-176001,              -8980, 'failed',    'boom',  '2001-01-29 23:59:59.999999+00', '2001-01-30 00:00:00+00'), -- failed, 30 d + 1 µs → goes
    (j.quiet_id,           -8975, 'succeeded', '1 row', '2000-12-01 00:00:00+00', '2000-12-01 00:00:01+00'),   -- quiet job's NEWEST TIMED run → STAYS
    (-176001,              -8970, 'failed',    'boom',  '2001-01-30 00:00:00+00', '2001-01-30 00:00:01+00'),   -- failed, exactly 30 d    → stays
    (j.busy_id,            -8965, 'succeeded', '1 row', '2000-12-15 00:00:00+00', '2000-12-15 00:00:01+00'),   -- busy job, old           → goes
    (-176001,              -8960, 'running',   null,    '2001-02-01 00:00:00+00', null),                       -- not succeeded, 28 d     → stays
    (-176001,              -8955, 'failed',    'boom',  null,                     '2001-02-05 00:00:00+00'),   -- never started; END 24 d → stays
    (-176001,              -8950, null,        null,    '2001-02-10 00:00:00+00', null),                       -- no status, 19 d         → stays
    (j.nostart_id,         -8948, 'failed',    'server restarted', null, null),                                -- no times, not newest    → goes
    (j.nostart_id,         -8947, 'failed',    'server restarted', null, null),                                -- no times, job's NEWEST  → STAYS
    (-176001,              -8945, 'failed',    'server restarted', null, null),                                -- no times, below mark    → goes
    (j.quiet_id,           -8944, 'failed',    'server restarted', null, null),                                -- quiet job, HIGHER runid than -8975 but no times → goes (186 reports the timed run)
    (-176001,              -8942, 'succeeded', '1 row', '2001-02-22 00:00:00+00', '2001-02-22 00:00:01+00'),   -- exactly 7 d, BELOW the mark → stays (only the rule keeps it)
    (-176001,              -8940, 'succeeded', '1 row', '2001-02-21 23:59:59.999999+00', '2001-02-22 00:00:00+00'), -- 7 d + 1 µs          → goes
    (-176001,              -8939, 'failed',    'server restarted', null, null),                                -- no times, below THE MARK → goes
    (-176001,              -8938, 'failed',    'boom',  null,                     '2001-02-20 00:00:00+00'),   -- never started; END 9 d  → stays (30 d) — and it is THE MARK
    (-176001,              -8935, 'starting',  null,    null, null),                                           -- no times, ABOVE mark    → stays
    (j.quiet_id,           -8933, 'starting',  null,    null, null),                                           -- quiet job, a run STARTING → stays; -8975 is still its newest timed run
    (-176001,              -8930, 'succeeded', '1 row', '2001-02-22 00:00:00+00', '2001-02-22 00:00:01+00'),   -- exactly 7 d, ABOVE the mark → stays, and is not the mark (the two no-time runs just below it stay too)
    (j.busy_id,            -8925, 'succeeded', '1 row', '2001-02-26 00:00:00+00', '2001-02-26 00:00:01+00'),   -- busy job's recent run   → stays
    (-176001,              -8920, 'succeeded', '1 row', '2001-02-25 00:00:00+00', '2001-02-25 00:00:01+00'),   -- inside the window       → stays
    (null,                 -8918, 'succeeded', '1 row', '2001-02-26 12:00:00+00', '2001-02-26 12:00:01+00'),   -- NO JOB ID, inside the window → stays, and must not switch the protection off
    (-176001,              -8911, 'failed',    'server restarted', null, null),                                -- no times; nine days on it sits just below a mark that has only a START time
    (-176001,              -8910, 'running',   null,    '2001-02-28 12:00:00+00', null)                        -- started, never finished → stays now; nine days on it is THE MARK
  ) as v(jobid, runid, status, msg, started, ended);

select is((select count(*)::int from cron.job_run_details where runid < 0), 34,
  'F1 34 fixture runs, and no other row has a negative runid');

-- ---------------------------------------------------------------------------
-- D. The batch — oldest first, never more than the cap, and it says `more`
-- ---------------------------------------------------------------------------
-- D1–D5 run with the index paths switched off: the cap block lies in the table
-- newest first, so "the two oldest" can only come from the function's own
-- ORDER BY, not from the order an index happens to hand rows back in.
set local enable_indexscan = off;
set local enable_indexonlyscan = off;
set local enable_bitmapscan = off;
select is(public.cron_log_prune('2001-03-01 00:00:00+00', p_max_rows => 2) - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": true, "deleted": 2}'::jsonb,
  'D1 a cap of 2 deletes 2 and says there is MORE');
select is((select array_agg(runid order by runid) from cron.job_run_details where runid between -9505 and -9501),
  array[-9503, -9502, -9501]::bigint[],
  'D2 …the two OLDEST (lowest runid) — the batch starts at the oldest run that is due');
select is(public.cron_log_prune('2001-03-01 00:00:00+00', p_max_rows => 2) - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": true, "deleted": 2}'::jsonb,
  'D3 the next call carries on from there: 2 more, still MORE');
select is(public.cron_log_prune('2001-03-01 00:00:00+00', p_max_rows => 1) - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": true, "deleted": 1}'::jsonb,
  'D4 a cap of 1 takes the last of the block — MORE, because the rule block beyond it still has old runs');
select is((select count(*)::int from cron.job_run_details where runid between -9505 and -9501), 0,
  'D5 the cap block is gone, in three calls, and nothing past it was touched yet');
set local enable_indexscan = on;
set local enable_indexonlyscan = on;
set local enable_bitmapscan = on;
select is((select count(*)::int from cron.job_run_details where runid between -9000 and -8918), 26,
  'D6 …all 26 runs of the rule block still there');
select ok(exists (select 1 from cron.job_run_details where runid = -9600),
  'D7 THE OLDEST ROW IN THE LOG is a switched-off job''s last run: three capped calls started past it — it neither went nor stopped the batch');

select is(public.cron_log_prune('2001-03-01 00:00:00+00', p_max_rows => 7) - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": true, "deleted": 7}'::jsonb,
  'D8 a cap of 7 takes the next 7 that are due');
select is(public.cron_log_prune('2001-03-01 00:00:00+00', p_max_rows => 1) - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": true, "deleted": 1}'::jsonb,
  'D9 now the oldest rows left are ones it must KEEP (two protected, four failed / unfinished runs inside their 30 days): a cap of 1 still deletes 1 — it steps over them to the first run that is due');
select is((select array_agg(runid order by runid) from cron.job_run_details where runid between -9000 and -8946),
  array[-8975, -8970, -8960, -8955, -8950, -8947]::bigint[],
  'D10 …and exactly those six kept rows are what is left of the older part: the 7 before them and the 1 after (-8948) are gone');
select is(public.cron_log_prune('2001-03-01 00:00:00+00', p_max_rows => 4) - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": false, "deleted": 4}'::jsonb,
  'D11 a cap that is EXACTLY what is left says there is no more — the failed run beyond the batch (kept for 30 days) is not work');

-- ---------------------------------------------------------------------------
-- C. The rule — what those calls took, and what they left
-- ---------------------------------------------------------------------------
select is((select array_agg(runid order by runid) from cron.job_run_details where runid < 0),
  array[-9600, -8975, -8970, -8960, -8955, -8950, -8947, -8942, -8938, -8935, -8933, -8930, -8925, -8920, -8918, -8911, -8910]::bigint[],
  'C2 17 runs past their window are gone; the 17 that stay, by runid (each named below)');

select ok(not exists (select 1 from cron.job_run_details where runid = -8940)
      and exists (select 1 from cron.job_run_details where runid = -8942)
      and exists (select 1 from cron.job_run_details where runid = -8930),
  'C3 SUCCEEDED, 7 days: a run 7 days + 1 µs old is gone; one exactly 7 days old stays (D146) — both the one below the mark (the rule kept it) and the one above it (it is not past the window, so it is not the mark)');
select ok(not exists (select 1 from cron.job_run_details where runid = -8980)
      and exists (select 1 from cron.job_run_details where runid = -8970),
  'C4 FAILED, 30 days: 30 days + 1 µs is gone; exactly 30 days stays');
select ok(exists (select 1 from cron.job_run_details where runid = -8960)
      and exists (select 1 from cron.job_run_details where runid = -8950),
  'C5 anything that is not `succeeded` — still running, or with no status at all — gets the 30 days, not the 7');
select ok(not exists (select 1 from cron.job_run_details where runid = -8985)
      and exists (select 1 from cron.job_run_details where runid = -8955)
      and exists (select 1 from cron.job_run_details where runid = -8938),
  'C6 a run that never started is aged by its END time: 45 days old gone, 24 and 9 days old kept');
select ok(not exists (select 1 from cron.job_run_details where runid = -8945)
      and exists (select 1 from cron.job_run_details where runid = -8935),
  'C7 NO TIMESTAMPS: gone once a timed run with a higher runid is past 7 days; one ABOVE that mark — the shape of a run in flight — is never touched');
select ok(not exists (select 1 from cron.job_run_details where runid = -8939),
  'C7b …and the mark itself is found by END time when the newest old run never started: -8939 sits just below a run that has only an end time, and went');
select ok(exists (select 1 from cron.job_run_details where runid = -8975)
      and not exists (select 1 from cron.job_run_details where runid = -8995),
  'C8 THE NEWEST RUN OF A SCHEDULED JOB STAYS, 90 days old and succeeded — its older run goes; a new run of that job that is only STARTING (no start time yet) does not count as its newest');
select ok(not exists (select 1 from cron.job_run_details where runid = -8944),
  'C8b "newest" is 186''s ordering, not the highest runid: that job''s later run with NO timestamps went — the timed one is the run the console reports');
select is(
  (select (c ->> 'last_status') || ' @ ' || (c ->> 'last_started_at')
     from jsonb_array_elements(public.op_cron_last_runs_internal()) c where c ->> 'job' = 'q176-quiet'),
  'succeeded @ 2000-12-01T00:00:00+00:00',
  'C9 …so 186''s reader (the admin console) still reports that job''s last run — not "never run"');
select is(
  (select (c ->> 'active') || ' / ' || (c ->> 'last_status') || ' @ ' || (c ->> 'last_started_at')
     from jsonb_array_elements(public.op_cron_last_runs_internal()) c where c ->> 'job' = 'q176-off'),
  'false / succeeded @ 2000-09-01T00:00:00+00:00',
  'C9b a job that is SWITCHED OFF (active = false) keeps its last run too — the console lists it as stalled with the run it stopped on, six months old');
select ok(exists (select 1 from cron.job_run_details where runid = -8925)
      and not exists (select 1 from cron.job_run_details where runid = -8965),
  'C10 a job with a run inside the window needs no protection: its old run goes, its recent one is simply inside the window');
select ok(exists (select 1 from cron.job_run_details where runid = -8947)
      and not exists (select 1 from cron.job_run_details where runid = -8948),
  'C11 a scheduled job whose runs have NO timestamps keeps the one 186 would report (the highest runid), not the other');
select ok(not exists (select 1 from cron.job_run_details where runid = -8998),
  'C12 an UNSCHEDULED job gets no such protection: the only run of a job no longer in cron.job is gone (nothing reads it)');

select is(public.cron_log_prune('2001-03-01 00:00:00+00') - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": false, "deleted": 0}'::jsonb,
  'C13 the job''s own call (default cap) at the same instant: nothing to do, and it says 0 — kept and protected runs are not counted as work left');
select is(public.cron_log_prune('2001-03-01 00:00:00+00', p_max_rows => 1) - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": false, "deleted": 0}'::jsonb,
  'C13b …at a cap of 1 as well');

-- The quiet job runs again ⇒ its old newest run is no longer the newest.
insert into cron.job_run_details (jobid, runid, database, username, command, status, return_message, start_time, end_time)
select quiet_id, -8915, 'postgres', 'postgres', 'SELECT 1', 'succeeded', '1 row', '2001-02-27 00:00:00+00', '2001-02-27 00:00:01+00' from j176;
select is(public.cron_log_prune('2001-03-01 00:00:00+00') - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": false, "deleted": 1}'::jsonb,
  'C14 once that job has a newer run, the 90-day-old one is an ordinary old run: 1 deleted');
select ok(not exists (select 1 from cron.job_run_details where runid = -8975),
  'C15 …and it is the one that went');

-- Nine days on: 2001-03-10 ⇒ cut-offs 2001-03-03 and 2001-02-08.
select is(public.cron_log_prune('2001-03-10 00:00:00+00') - 'at',
  '{"more": false, "deleted": 10, "keep_from": "2001-03-03T00:00:00+00:00", "keep_failed_from": "2001-02-08T00:00:00+00:00"}'::jsonb,
  'C16 nine days later the windows have moved with the clock: the job''s own call deletes the 10 runs now past them');
select is((select array_agg(runid order by runid) from cron.job_run_details where runid < 0),
  array[-9600, -8950, -8947, -8938, -8925, -8915, -8910]::bigint[],
  'C17 what is left: the no-status run (28 days), the never-started one (18 days by its end) and the never-finished one (10 days by its start) — all inside 30 — and the NEWEST run of each of the four jobs still scheduled, all now past 7 days');
select ok(not exists (select 1 from cron.job_run_details where runid in (-8935, -8933)),
  'C18 the two runs with no timestamps that were above the mark are gone now — later timed runs have aged past the window, which proves them older');
select ok(not exists (select 1 from cron.job_run_details where runid = -8911),
  'C18b …and so is the one just below a mark that has only a START time (the never-finished run): the mark is found by start time, not only by end time');
select ok(not exists (select 1 from cron.job_run_details where runid in (-8970, -8960, -8955, -8942, -8930, -8918)),
  'C19 the failed, the never-finished and the never-started run left when THEIR 30 days were up; the two exactly-7-days runs and the one with no job id when their 7 were');

-- One of those four jobs is unscheduled ⇒ nothing reads its runs any more.
do $do$ begin perform cron.unschedule('q176-nostart'); end; $do$;
select is(public.cron_log_prune('2001-03-10 00:00:00+00') - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": false, "deleted": 1}'::jsonb,
  'C20 unschedule a job and its newest run loses the protection: same instant, 1 more deleted');
select ok(not exists (select 1 from cron.job_run_details where runid = -8947)
      and exists (select 1 from cron.job_run_details where runid = -8925),
  'C21 …the run that was only there for the console — while a job still scheduled keeps its own');

-- ---------------------------------------------------------------------------
-- E. The guards
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.cron_log_prune('2001-03-10 00:00:00+00', interval '23 hours 59 minutes') $$, '22023', null,
  'E1 a window under one day is refused — a mistyped window cannot empty the log');
select lives_ok($$ select public.cron_log_prune('2001-03-10 00:00:00+00', interval '1 day', interval '1 day') $$,
  'E2 …exactly one day is allowed');
select is((select array_agg(runid order by runid) from cron.job_run_details where runid < 0),
  array[-9600, -8925, -8915]::bigint[],
  'E3 …and even at one day for everything, the three scheduled jobs'' newest runs are still there — the three kept runs are not, the never-finished one included although it was THE MARK (the newest run past the window is deletable like any other)');
select is(public.cron_log_prune('2001-03-10 00:00:00+00', interval '1 day', interval '1 day') - 'at' - 'keep_from' - 'keep_failed_from',
  '{"more": false, "deleted": 0}'::jsonb,
  'E3b and again: now the newest run past the window IS a scheduled job''s newest run (-8915) — it stays. A job whose newest run is the mark has no run inside the window, so it is protected, not "recent"');
select throws_ok($$ select public.cron_log_prune('2001-03-10 00:00:00+00', interval '7 days', interval '6 days') $$, '22023', null,
  'E4 failed runs kept for LESS time than the rest is refused');
select throws_ok($$ select public.cron_log_prune('2001-03-10 00:00:00+00', p_max_rows => 0) $$, '22023', null,
  'E5 a cap of 0 is refused — a call that can delete nothing must not read as a clean run');
select throws_ok($$ select public.cron_log_prune(null) $$, '22023',
  'cron_log_prune: p_now, p_keep, p_keep_failed and p_max_rows are all required',
  'E6 a NULL instant is refused by name');
select throws_ok($$ select public.cron_log_prune('2001-03-10 00:00:00+00', p_keep => null) $$, '22023', null,
  'E6b …a NULL window too');
select throws_ok($$ select public.cron_log_prune('2001-03-10 00:00:00+00', p_keep_failed => null) $$, '22023', null,
  'E6c …a NULL failed-run window');
select throws_ok($$ select public.cron_log_prune('2001-03-10 00:00:00+00', p_max_rows => null) $$, '22023', null,
  'E6d …and a NULL cap — which would otherwise mean no cap at all');
select throws_ok($$ select public.cron_log_prune(now() + interval '1 year') $$, '22023', null,
  'E7 an instant in the FUTURE is refused — seen from next year every run is old, and one mistyped call would empty the log');
select throws_ok($$ select public.cron_log_prune(now() + interval '2 minutes') $$, '22023', null,
  'E7b …two minutes ahead is already the future');
select lives_ok($$ select public.cron_log_prune(now()) $$,
  'E8 …the present is not the future: the job''s own call (p_now = now()) runs');
select lives_ok($$ select public.cron_log_prune(now() + interval '30 seconds') $$,
  'E8b …and neither is a clock half a minute ahead');

select * from finish();
rollback;
