-- ============================================================================
-- 175 — news, projections and player values once a day, plus one refresh an
--       hour before each kickoff; autopilot's 30-hour bound (migration 225)
-- ============================================================================
-- Chris 2026-11-17, verbatim: "yes move those to once a day too" (F917(b));
-- on Q109: "do the hour before each kickoff one"; on Q110: "go with option 1"
-- (autopilot uses projections up to about a day old).
--
-- What this file proves, in one rolled-back transaction (pg_net's worker
-- reads COMMITTED rows, so a queued request never leaves the database — 072
-- §D / 174 §C's method):
--   §A  THE SLOT: pregame_refresh_step names the earliest DISTINCT kickoff of
--       the live season due within the hour — exactly 60 minutes before at
--       the microsecond (D146), nothing a microsecond earlier, nothing at or
--       after kickoff; `final`, `live` and `postponed` games never start a
--       refresh, a NULL status reads as scheduled; another season's game and
--       a far-future season never count; nothing on the calendar ⇒ nothing.
--   §S  ONCE PER SLOT: the projections step stamps `system_flags.
--       pregame_refresh`; the values step is due 10 minutes later at the
--       microsecond, once; then nothing until the next distinct kickoff,
--       whose slot starts on its own.
--   §C  THE WAKES, END TO END: a quiet tick queues nothing; a slot queues
--       exactly one GET to the projections route, then one to the values
--       route — in that order (137 reads 136); a ping that RAISES (no Vault
--       secret) leaves no stamp, so the next tick retries.
--   §D  THE JOBS: the three daily schedules and the 5-minute pregame job,
--       literal; the DO block idempotent (run twice); 183's knob list refusing
--       `ingest-player-news-ping` and `pregame-refresh-ping` BY NAME; the
--       security posture of both new functions.
--   §E  AUTOPILOT'S BOUND: the live lineup_autopilot_internal carries 30
--       hours; un225 (its one hunk reversed) gives back 201's live md5 and is
--       an identity on every other body; its posture is unchanged. The
--       behaviour — 29 h used, 31 h absent, and the 30 h boundary at the
--       second — is pinned in 086 §E (E1/E1c/E2/E2c/E3/E4/E5).
--
-- THE BREAK PROBE (tasks-M1 §4.3), run and reverted in this PR: the slot's
-- status filter widened to `scheduled` + `final` (applied live) — see the PR
-- for the cells it reds by name.
--
-- Fixture season 2092 (weeks from 2092-09-03): every instant below is in
-- late 2092, after it started; the far-future season 2096 is seeded in §A on
-- purpose. Any real or simulator season present on a USED stack has either
-- started long before 2092 or (2099) not yet — neither can win.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';

select plan(47);

insert into nfl_weeks (season, week, starts_at) values
  (2092, 1, '2092-09-03 04:00:00+00'),
  (2092, 2, '2092-09-10 04:00:00+00');

-- The stamp this file reads must be its own.
delete from system_flags where key = 'pregame_refresh';

-- ---------------------------------------------------------------------------
-- A. The slot
-- ---------------------------------------------------------------------------
select is(public.pregame_refresh_step('2092-09-07 16:30:00+00'), null,
  'A1 no game rows in the season ⇒ no step (nothing to refresh for)');

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q175-g1', 2092, 1, 'PHI', 'DAL', '2092-09-07 17:00:00+00', 'scheduled');
select is(public.pregame_refresh_step('2092-09-07 16:00:00+00'),
  '{"step": "projections", "kickoff_at": "2092-09-07T17:00:00+00:00"}'::jsonb,
  'A2 EXACTLY 60 minutes before a kickoff the slot is due: the projections step, keyed on that kickoff (Q109: "do the hour before each kickoff one")');
select is(public.pregame_refresh_step('2092-09-07 15:59:59.999999+00'), null,
  'A3 …and not one microsecond earlier (D146)');
select is(public.pregame_refresh_step('2092-09-07 16:59:59.999999+00') ->> 'step', 'projections',
  'A4 still due one microsecond before kickoff (a late tick still refreshes)…');
select is(public.pregame_refresh_step('2092-09-07 17:00:00+00'), null,
  'A5 …and never at or after kickoff — a started game is not "before kickoff"');

update nfl_games set status = 'final' where id = 'q175-g1';
select is(public.pregame_refresh_step('2092-09-07 16:30:00+00'), null,
  'A6 a FINAL game never starts a refresh');
update nfl_games set status = 'live' where id = 'q175-g1';
select is(public.pregame_refresh_step('2092-09-07 16:30:00+00'), null,
  'A7 nor a LIVE one');
update nfl_games set status = 'postponed' where id = 'q175-g1';
select is(public.pregame_refresh_step('2092-09-07 16:30:00+00'), null,
  'A8 nor a POSTPONED one (it waits for its new kickoff — E43)');
update nfl_games set status = null where id = 'q175-g1';
select is(public.pregame_refresh_step('2092-09-07 16:30:00+00') ->> 'step', 'projections',
  'A9 a NULL status reads as scheduled (001''s nullable column; 224''s reading)');
update nfl_games set status = 'scheduled' where id = 'q175-g1';

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q175-old', 2091, 18, 'KC', 'LV', '2092-09-08 00:20:00+00', 'scheduled');
select is(public.pregame_refresh_step('2092-09-07 23:30:00+00'), null,
  'A10 another season''s never-flipped row inside the hour does NOT start a refresh — only the live season''s games count (live_poll_season, 224)');
insert into nfl_weeks (season, week, starts_at) values (2096, 1, '2096-09-03 04:00:00+00');
select is(public.live_poll_season('2092-09-07 16:30:00+00'), 2092,
  'A11 with a far-future season on the calendar the live season is still 2092 (R1819 — a season that has not started never wins)…');
select is(public.pregame_refresh_step('2092-09-07 16:30:00+00') ->> 'kickoff_at', '2092-09-07T17:00:00+00:00',
  'A12 …so the 2092 slot is still found');

-- Distinct kickoffs: two more games at the SAME 17:00 and a late game at 17:25.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q175-g2', 2092, 1, 'NYG', 'WAS', '2092-09-07 17:00:00+00', 'scheduled'),
  ('q175-g3', 2092, 1, 'MIA', 'BUF', '2092-09-07 17:00:00+00', 'scheduled'),
  ('q175-g4', 2092, 1, 'SF',  'LAR', '2092-09-07 17:25:00+00', 'scheduled');
select is(public.pregame_refresh_step('2092-09-07 16:30:00+00') ->> 'kickoff_at', '2092-09-07T17:00:00+00:00',
  'A13 the slot is the EARLIEST distinct kickoff — three games at 17:00 are one slot, and the 17:25 game waits its turn');

-- ---------------------------------------------------------------------------
-- S. Once per slot — the stamp
-- ---------------------------------------------------------------------------
-- (The wake functions need Vault's two secrets — created in §C below; these
-- cells drive the stamp through the same body by hand so the decision is
-- isolated from the request.)
insert into system_flags (key, value, updated_at) values ('pregame_refresh',
  jsonb_build_object('kickoff_at', '2092-09-07T17:00:00+00:00'::timestamptz, 'projections_at', '2092-09-07T16:00:00+00:00'::timestamptz, 'values_at', null),
  '2092-09-07 16:00:00+00');
select is(public.pregame_refresh_step('2092-09-07 16:05:00+00'), null,
  'S1 the slot''s projections step is stamped ⇒ the next tick (5 min later) does nothing — the values step waits for the projections run');
select is(public.pregame_refresh_step('2092-09-07 16:09:59.999999+00'), null,
  'S2 …still nothing one microsecond before 10 minutes (D146)…');
select is(public.pregame_refresh_step('2092-09-07 16:10:00+00'),
  '{"step": "values", "kickoff_at": "2092-09-07T17:00:00+00:00"}'::jsonb,
  'S3 …and EXACTLY 10 minutes after the projections ping the values step is due (137 reads 136''s lines — the daily pair''s ten-minute order)');
update system_flags set value = jsonb_set(value, '{values_at}', to_jsonb('2092-09-07 16:10:00+00'::timestamptz)) where key = 'pregame_refresh';
select is(public.pregame_refresh_step('2092-09-07 16:15:00+00'), null,
  'S4 both steps stamped ⇒ nothing more for this slot (once per slot)…');
select is(public.pregame_refresh_step('2092-09-07 16:59:59.999999+00'), null,
  'S5 …right up to its kickoff');
select is(public.pregame_refresh_step('2092-09-07 17:00:00+00'),
  '{"step": "projections", "kickoff_at": "2092-09-07T17:25:00+00:00"}'::jsonb,
  'S6 once 17:00 has kicked off, the 17:25 kickoff is a slot of its own — refreshed then (each distinct kickoff gets its refresh)');
delete from system_flags where key = 'pregame_refresh';

-- ---------------------------------------------------------------------------
-- C. The wakes, end to end (no network: the transaction never commits)
-- ---------------------------------------------------------------------------
-- A ping that RAISES first: no Vault secret (removed inside this rolled-back
-- transaction, so the cell does not depend on the stack's Vault).
delete from vault.secrets where name in ('fieldscout_site_origin', 'fieldscout_cron_secret');
select throws_ok($$ select public.cron_wake_pregame_refresh('2092-09-07 16:00:00+00') $$, 'F0000', null,
  'C1 a due slot with no Vault secret RAISES (124''s loud ping — config_file_error)…');
select is((select count(*)::int from system_flags where key = 'pregame_refresh'), 0,
  'C2 …and leaves NO stamp: the stamp rolls back with the failed ping, so the next tick retries the slot');

do $$ begin
  perform vault.create_secret('https://fieldscout.gg', 'fieldscout_site_origin');
  perform vault.create_secret('q175-cron-secret', 'fieldscout_cron_secret');
end $$;
create temp table q175_base as select coalesce(max(id), 0) as id from net.http_request_queue;

select is(public.cron_wake_pregame_refresh('2092-09-07 15:55:00+00') - 'request_id',
  '{"woke": false, "step": null, "kickoff_at": null, "at": "2092-09-07T15:55:00+00:00"}'::jsonb,
  'C3 more than an hour before any kickoff ⇒ not woken…');
select is((select count(*)::int from net.http_request_queue where id > (select id from q175_base)), 0,
  'C4 …proven: nothing was queued — a quiet tick costs Vercel nothing');

select is(public.cron_wake_pregame_refresh('2092-09-07 16:00:00+00') - 'request_id',
  '{"woke": true, "step": "projections", "kickoff_at": "2092-09-07T17:00:00+00:00", "at": "2092-09-07T16:00:00+00:00"}'::jsonb,
  'C5 an hour before kickoff ⇒ woken for the projections step, and it says which slot');
select is((select string_agg(method::text || ' ' || url || ' ' || (headers ->> 'Authorization'), ' | ') from net.http_request_queue where id > (select id from q175_base)),
  'GET https://fieldscout.gg/api/cron/sync-weekly-projections Bearer q175-cron-secret',
  'C6 …exactly ONE request: a GET to the projections route, carrying the secret (it also refreshes injury tags — D592)');
select is((select value from system_flags where key = 'pregame_refresh'),
  '{"kickoff_at": "2092-09-07T17:00:00+00:00", "projections_at": "2092-09-07T16:00:00+00:00", "values_at": null}'::jsonb,
  'C7 …and the slot is stamped with its kickoff and the projections instant');
select is((public.cron_wake_pregame_refresh('2092-09-07 16:05:00+00') ->> 'woke')::boolean, false,
  'C8 the next tick does nothing (values waits 10 minutes)');
select is(public.cron_wake_pregame_refresh('2092-09-07 16:10:00+00') ->> 'step', 'values',
  'C9 10 minutes on ⇒ woken for the values step');
select is((select string_agg(url, ' | ' order by id) from net.http_request_queue where id > (select id from q175_base)),
  'https://fieldscout.gg/api/cron/sync-weekly-projections | https://fieldscout.gg/api/cron/league-player-values',
  'C10 two requests in all, projections THEN values');
select is((public.cron_wake_pregame_refresh('2092-09-07 16:15:00+00') ->> 'woke')::boolean, false,
  'C11 the slot is spent: the next tick does nothing…');
select is((select count(*)::int from net.http_request_queue where id > (select id from q175_base)), 2,
  'C12 …proven: still the two requests');

-- ---------------------------------------------------------------------------
-- D. The jobs, and the security posture
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(jobname || ' ' || schedule || ' | ' || command, E'\n' order by jobname) from cron.job
    where jobname in ('ingest-player-news-ping', 'sync-weekly-projections-ping', 'league-player-values-ping', 'pregame-refresh-ping')),
  E'ingest-player-news-ping 30 13 * * * | SELECT public.cron_ping_route(''/api/cron/ingest-player-news'')\n'
  || E'league-player-values-ping 50 12 * * * | SELECT public.cron_ping_route(''/api/cron/league-player-values'')\n'
  || E'pregame-refresh-ping */5 * * * * | SELECT public.cron_wake_pregame_refresh()\n'
  || E'sync-weekly-projections-ping 40 12 * * * | SELECT public.cron_ping_route(''/api/cron/sync-weekly-projections'')',
  'D1 the three pings ONCE A DAY (news 13:30Z, projections 12:40Z, values 12:50Z — Chris: "yes move those to once a day too"), and the 5-minute pregame job that decides in the database');
select is((select count(*)::int from cron.job where jobname in ('ingest-player-news-ping', 'sync-weekly-projections-ping', 'league-player-values-ping')
             and (schedule like '%/30%' or schedule in ('40 * * * *', '50 * * * *'))), 0,
  'D2 the half-hourly and hourly schedules are gone');
select is((select string_agg(jobname || ' ' || schedule, '; ' order by jobname) from cron.job where jobname in ('sync-live-sweep', 'sync-live-ping', 'score-week-ping')),
  'score-week-ping 30 seconds; sync-live-ping 30 seconds; sync-live-sweep 0 11 * * *',
  'D3 224''s jobs untouched — the daily times above are staggered off its 11:00Z sweep');

do $do$
begin
  for i in 1..2 loop
    if exists (select 1 from cron.job where jobname = 'ingest-player-news-ping') then perform cron.unschedule('ingest-player-news-ping'); end if;
    perform cron.schedule('ingest-player-news-ping', '30 13 * * *', 'SELECT public.cron_ping_route(''/api/cron/ingest-player-news'')');
    if exists (select 1 from cron.job where jobname = 'sync-weekly-projections-ping') then perform cron.unschedule('sync-weekly-projections-ping'); end if;
    perform cron.schedule('sync-weekly-projections-ping', '40 12 * * *', 'SELECT public.cron_ping_route(''/api/cron/sync-weekly-projections'')');
    if exists (select 1 from cron.job where jobname = 'league-player-values-ping') then perform cron.unschedule('league-player-values-ping'); end if;
    perform cron.schedule('league-player-values-ping', '50 12 * * *', 'SELECT public.cron_ping_route(''/api/cron/league-player-values'')');
    if exists (select 1 from cron.job where jobname = 'pregame-refresh-ping') then perform cron.unschedule('pregame-refresh-ping'); end if;
    perform cron.schedule('pregame-refresh-ping', '*/5 * * * *', 'SELECT public.cron_wake_pregame_refresh()');
  end loop;
end;
$do$;
select is((select count(*)::int from cron.job where jobname in ('ingest-player-news-ping', 'sync-weekly-projections-ping', 'league-player-values-ping', 'pregame-refresh-ping')), 4,
  'D4 225''s unschedule-first block re-applied TWICE leaves exactly one job per name');

select throws_ok($$ select public.op_job_check_internal('ingest-player-news-ping', 'pause') $$, '22023',
  'job "ingest-player-news-ping" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)',
  'D5 183''s knob list names the news ping — refused BY NAME (it was an "unknown job" before 225)');
select throws_ok($$ select public.op_job_check_internal('pregame-refresh-ping', 'run') $$, '22023',
  'job "pregame-refresh-ping" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)',
  'D6 …and the new pregame job');
select throws_ok($$ select public.op_job_check_internal('sync-live-sweep', 'pause') $$, '22023',
  'job "sync-live-sweep" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)',
  'D7 224''s names still refused by name (224''s body otherwise verbatim)…');
select lives_ok($$ select public.op_job_check_internal('waivers', 'pause') $$,
  'D8 …and the knobbed jobs untouched');

select is(
  (select string_agg(p.proname || '=' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('pregame_refresh_step', 'cron_wake_pregame_refresh')),
  'cron_wake_pregame_refresh=false:search_path="" pregame_refresh_step=false:search_path=""',
  'D9 both are SECURITY INVOKER with search_path='''' (124''s reason: the caller is pg_cron''s postgres; INVOKER fails closed for every API role), one overload each');
select is(
  (select count(*)::int from unnest(array['pregame_refresh_step(timestamptz)', 'cron_wake_pregame_refresh(timestamptz)']) f,
     unnest(array['anon', 'authenticated']) r
   where has_function_privilege(r, 'public.' || f, 'EXECUTE')),
  0, 'D10 anon and authenticated can execute neither');
select ok(has_function_privilege('service_role', 'public.pregame_refresh_step(timestamptz)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.cron_wake_pregame_refresh(timestamptz)', 'EXECUTE'),
  'D11 service_role keeps the read-only step (the D291 harness door) but NOT the wake — nobody but the scheduler makes the database fire a request carrying our cron secret');
select ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname in ('pregame_refresh_step', 'cron_wake_pregame_refresh')
      and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'D12 PUBLIC holds EXECUTE on neither');

-- ---------------------------------------------------------------------------
-- E. Autopilot's read-side bound — 30 hours (Q110)
-- ---------------------------------------------------------------------------
create function pg_temp.un225(s text) returns text language sql immutable as $un225$
  select replace(s, $n225$  -- 225 (Q110, Chris 2026-11-17: "go with option 1"): the read-side bound   -- 225 / Q110
  -- (F387's read half / F389(c)) is 30 HOURS. Projections and values run once   -- 225 / Q110
  -- a day plus an hour before each kickoff (225), so a day-old row is the   -- 225 / Q110
  -- healthy case; 30 h = a day plus room for one late run. Pinned equal to   -- 225 / Q110
  -- AUTOPILOT_VALUE_MAX_AGE_MS (`player-values.ts`) by V9a.   -- 225 / Q110
  c_max_age     CONSTANT INTERVAL := interval '30 hours';   -- 225 / Q110
$n225$,
                    $o225$  -- 138 (L.E1.21, Q62): the read-side freshness bound (F387's read half /
  -- F389(c)) — the SAME six hours as the compute half's
  -- `PROJECTION_MAX_AGE_MS` (`player-values.ts`), pinned equal by a unit cell.
  c_max_age     CONSTANT INTERVAL := interval '6 hours';
$o225$)
$un225$;

select is(
  (select format('%s / tagged=%s',
            substring(p.prosrc from 'c_max_age +CONSTANT INTERVAL := interval ''[0-9]+ hours'''),
            (length(p.prosrc) - length(replace(p.prosrc, '-- 225 / Q110', ''))) / length('-- 225 / Q110'))
     from pg_proc p where p.oid = 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)'::regprocedure),
  'c_max_age     CONSTANT INTERVAL := interval ''30 hours'' / tagged=6',
  'E1 the live autopilot reads values and projections up to 30 HOURS old (Chris 2026-11-17, Q110: "go with option 1"), in one hunk of six tagged lines');
select is(
  (select md5(pg_temp.un225(p.prosrc)) from pg_proc p where p.oid = 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)'::regprocedure),
  '2b3f81bcd6cfa9e997c5e3ff20007e30',
  'E2 D137: the live body with 225''s hunk reversed is 201''s live body byte for byte (the md5 151 A4 pins as a stored literal) — not one other byte changed');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname <> 'lineup_autopilot_internal' and pg_temp.un225(p.prosrc) <> p.prosrc),
  0,
  'E3 un225 is an identity on every other body — so the suites that apply it innermost (inside their un201) pin exactly what they pinned (R992)');
select is(
  (select format('definer=%s config=%s public=%s anon=%s auth=%s',
            p.prosecdef, array_to_string(p.proconfig, ','),
            exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE' and a.grantee = 0),
            has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     from pg_proc p where p.oid = 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)'::regprocedure),
  'definer=f config=search_path="" public=f anon=f auth=f',
  'E4 its posture is unchanged: no SECURITY DEFINER, search_path '''', the triple REVOKE restated');

select * from finish();
rollback;
