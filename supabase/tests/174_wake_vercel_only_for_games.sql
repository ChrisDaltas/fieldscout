-- ============================================================================
-- 174 — the database decides when to wake Vercel (migration 224)
-- ============================================================================
-- Chris 2026-11-14, verbatim: "how about every 30 seconds during games" —
-- "but how about once a day on none day games?" — "we need to stop checking
-- if a game is still on, once the score is final the game is over."
--
-- What this file proves, in one rolled-back transaction (pg_net's worker
-- reads COMMITTED rows, so a queued request never leaves the database — 072
-- §D's method):
--   §A  THE WINDOW: live_game_window_open is planLivePoll's HOT rule — the
--       15-minute lead at the microsecond (D146), live / scheduled / NULL
--       open, FINAL and postponed closed, another season ignored.
--   §B  WHY SCORE-WEEK WAKES: game window and fresh queue work every tick;
--       a live drain's lease is not work (the 120 s boundary at the
--       microsecond); held rows, the close pass and stat fixes once per
--       5-minute slot (the slot's edge at the microsecond); a pass read that
--       raises wakes it anyway (fail open).
--   §C  THE WAKES, END TO END: no window ⇒ nothing queued; a live game ⇒
--       exactly one GET to `/api/cron/sync-live?sweep=none`; THE GAME GOES
--       FINAL ⇒ the very next tick queues nothing (Chris's rule); score-week
--       likewise. Security posture of all four functions.
--   §D  THE JOBS: the 30-second pings, the 11:00Z daily sweep, the per-minute
--       schedules gone, the DO block idempotent (run twice), and 183's knob
--       list refusing the new job BY NAME.
--   §E  THE STALL CHECK'S INGEST ARM, re-thresholded: a day-old ingest on a
--       non-game day is HEALTHY (the false alarm a daily sweep would have
--       raised under 124's 2 h); 49 h at the microsecond; inside a window 15
--       minutes, once the window is itself 15 minutes old — both boundaries
--       at the microsecond.
--
-- THE BREAK PROBE (tasks-M1 §4.3), run and reverted in this PR: changing
-- live_game_window_open's status list to include 'final' (applied live,
-- 174 re-run) red 24 of 59 cells BY NAME — 5, 8, 13-14, 16-27, 29-30, 32-36,
-- 38: A5 and C5 (the cells that pin "once the score is final the game is
-- over") and every cell that a stale final game now holds a window open over.
--
-- Fixture season 2091: newer than any real calendar row, so it IS "the
-- newest season in nfl_weeks" for the functions' default, and no dev data
-- can open or close a window under these cells.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';

select plan(59);

insert into nfl_weeks (season, week, starts_at) values
  (2091, 1, '2091-09-05 04:00:00+00'),
  (2091, 2, '2091-09-12 04:00:00+00');
insert into players (id, full_name, position, adp) values
  ('q174-p1', 'Q174 WR 1', 'WR', 0.001),
  ('q174-p2', 'Q174 WR 2', 'WR', 0.002);

-- The rows the arms read must be this file's alone.
delete from score_fanout;
delete from system_flags where key like 'ingest_poll:%';

-- ---------------------------------------------------------------------------
-- A. The window — planLivePoll's HOT rule
-- ---------------------------------------------------------------------------
select is(public.live_game_window_open('2091-09-09 00:20:00+00'), false,
  'A1 no game rows in the season ⇒ no window (nothing to wake for)');

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-g1', 2091, 1, 'SEA', 'NE', '2091-09-09 00:20:00+00', 'scheduled');
select is(public.live_game_window_open('2091-09-09 00:05:00+00'), true,
  'A2 OPEN exactly at kickoff − 15 minutes (POLL_LEAD_MS) — inactives land pre-game');
select is(public.live_game_window_open('2091-09-09 00:04:59.999999+00'), false,
  'A3 …one microsecond earlier is CLOSED (D146, both sides)');

update nfl_games set status = 'live' where id = 'q174-g1';
select is(public.live_game_window_open('2091-09-09 05:20:00+00'), true,
  'A4 a game five hours past kickoff and still `live` keeps the window open — it closes on OBSERVATION (R711), never the clock');
update nfl_games set status = 'final' where id = 'q174-g1';
select is(public.live_game_window_open('2091-09-09 01:00:00+00'), false,
  'A5 a FINAL game never keeps a window open, however recent its kickoff — Chris 2026-11-14: "once the score is final the game is over"');
update nfl_games set status = 'postponed' where id = 'q174-g1';
select is(public.live_game_window_open('2091-09-09 01:00:00+00'), false,
  'A6 a postponed game has left the window (E43; OPEN_STATUSES is scheduled + live only)');
update nfl_games set status = null where id = 'q174-g1';
select is(public.live_game_window_open('2091-09-09 01:00:00+00'), true,
  'A7 a NULL status reads as scheduled (001''s nullable column; `statusOf` in live-poll.ts)');
update nfl_games set status = 'final' where id = 'q174-g1';

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-old', 2090, 17, 'KC', 'LV', '2091-01-01 18:00:00+00', 'scheduled');
select is(public.live_game_window_open('2091-09-09 01:00:00+00'), false,
  'A8 an older season''s never-flipped row does NOT hold the window open — the default season is the newest in nfl_weeks');
select is(public.live_game_window_open('2091-09-09 01:00:00+00', 2090), true,
  'A9 …it would, for its own season named explicitly (the season is the only thing that hid it)');

select is(
  (select string_agg(p.proname || '=' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('live_game_window_open', 'score_week_wake_reason', 'cron_wake_sync_live', 'cron_wake_score_week')),
  'cron_wake_score_week=false:search_path="" cron_wake_sync_live=false:search_path="" live_game_window_open=false:search_path="" score_week_wake_reason=false:search_path=""',
  'A10 all four are SECURITY INVOKER with search_path='''' (124''s reason for the ping path: the caller is pg_cron''s postgres; INVOKER fails closed for every API role)');
select ok(not has_function_privilege('anon', 'public.live_game_window_open(timestamptz, integer)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.live_game_window_open(timestamptz, integer)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.score_week_wake_reason(timestamptz)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.score_week_wake_reason(timestamptz)', 'EXECUTE'),
  'A11 the two read-only predicates are closed to anon and authenticated');
select ok(has_function_privilege('service_role', 'public.live_game_window_open(timestamptz, integer)', 'EXECUTE'),
  'A12 …and open to service_role — the D291 harness door the equivalence suite (live-poll-window-db.test.ts) calls through');

-- ---------------------------------------------------------------------------
-- B. Why score-week wakes
-- ---------------------------------------------------------------------------
-- Deterministic stand-ins for the two passes' reads, so these cells do not
-- depend on what leagues exist; the wiring is what is under test (the reads
-- themselves are 166's / 171's). Rolled back with everything else.
create or replace function public.league_weeks_to_close(p_now timestamptz, p_limit integer default 25, p_league_ids uuid[] default null)
returns table (league_id uuid, season integer, week integer, digest text, reason text)
language plpgsql as $$
begin
  if current_setting('q174.close', true) = 'raise' then
    -- Any error but query_canceled: PL/pgSQL's WHEN OTHERS cannot catch a
    -- cancel (57014) — measured here first, see 224's note on the arm.
    raise exception 'league_weeks_to_close: permission denied for function league_week_scores_digest_internal' using errcode = '42501';
  end if;
  return query select gen_random_uuid(), 2091, 1, 'd'::text, 'never_closed'::text where current_setting('q174.close', true) = 'on';
end;
$$;
create or replace function public.stat_fix_targets(p_owed_only boolean default true, p_limit integer default 10, p_league_ids uuid[] default null)
returns table (fix_id uuid, league_id uuid, season integer, week integer, state text)
language sql as $$
  select gen_random_uuid(), gen_random_uuid(), 2091, 1, 'owed'::text where current_setting('q174.fix', true) = 'on';
$$;

-- Instants: SLOT = a 5-minute slot tick; OFF = any other tick.
--   slot  2091-10-01 12:05:10Z   off  2091-10-01 12:06:10Z
select is(public.score_week_wake_reason('2091-10-01 12:05:10+00'), null,
  'B1 nothing owed, no window ⇒ NULL even on a slot tick — score-week is not called');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00'), null,
  'B2 …and NULL off the slot');

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-g2', 2091, 5, 'DAL', 'NYG', '2091-10-01 12:00:00+00', 'live');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00'), 'game_window',
  'B3 a game window ⇒ every tick');
update nfl_games set status = 'final' where id = 'q174-g2';

insert into score_fanout (season, week, player_id, enqueued_at) values (2091, 5, 'q174-p1', '2091-10-01 12:06:00+00');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00'), 'queue',
  'B4 a FRESH queue row (never leased, never deferred) ⇒ every tick, outside any window — a stat fix''s rows or a late delta score within 30 s');
update score_fanout set claimed_at = '2091-10-01 12:04:10+00', claim_token = gen_random_uuid() where player_id = 'q174-p1';
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00'), null,
  'B5 a row leased EXACTLY 120 s ago is a live drain''s, not work (score_fanout_claim''s strict `<`, lease = SCORE_WEEK_LEASE_SECONDS)');
select is(public.score_week_wake_reason('2091-10-01 12:06:10.000001+00'), 'queue',
  'B6 …one microsecond past the lease it is claimable again ⇒ wake (a dead drain''s leftovers)');

update score_fanout set claimed_at = null, claim_token = null, deferred_until = '2091-10-01 12:04:40+00' where player_id = 'q174-p1';
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00'), null,
  'B7 a HELD row (deferred before, its hold elapsed) does NOT wake every tick — a hold can last all week');
select is(public.score_week_wake_reason('2091-10-01 12:05:10+00'), 'queue_held',
  'B8 …it wakes on the 5-minute slot');
update score_fanout set deferred_until = '2091-10-01 12:05:40+00' where player_id = 'q174-p1';
select is(public.score_week_wake_reason('2091-10-01 12:05:10+00'), null,
  'B9 a hold still ahead is not claimable ⇒ not even on the slot');
delete from score_fanout;

select is(public.score_week_wake_reason('2091-10-01 12:05:29.999999+00'), null,
  'B10 precondition for the slot edge: nothing owed');
set local q174.close = 'on';
select is(public.score_week_wake_reason('2091-10-01 12:05:29.999999+00'), 'close_owed',
  'B11 a week to close (216''s own read) ⇒ wake on the slot — 12:05:29.999999 is inside it');
select is(public.score_week_wake_reason('2091-10-01 12:05:30+00'), null,
  'B12 …12:05:30 is not (D146 at the slot''s edge: one tick per 5 minutes, not two)');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00'), null,
  'B13 …nor any minute not divisible by 5');
set local q174.close = 'off';
set local q174.fix = 'on';
select is(public.score_week_wake_reason('2091-10-01 12:10:00+00'), 'stat_fix_owed',
  'B14 a stat fix owed somewhere (222''s own read) ⇒ wake on the slot — applied within 5 minutes, platform-wide');
set local q174.fix = 'off';
set local q174.close = 'raise';
select is(public.score_week_wake_reason('2091-10-01 12:10:00+00'), 'check_failed',
  'B15 a pass read that RAISES wakes score-week anyway (fail open) — its own pass meets the error and alerts by name');
set local q174.close = 'off';
select throws_ok($$ select public.score_week_wake_reason(null) $$, '22023', null,
  'B16 p_now is required (the injected instant, D291)');

-- ---------------------------------------------------------------------------
-- C. The wakes, end to end (no network: the transaction never commits)
-- ---------------------------------------------------------------------------
do $$ begin
  perform vault.create_secret('https://fieldscout.gg', 'fieldscout_site_origin');
  perform vault.create_secret('q174-cron-secret', 'fieldscout_cron_secret');
end $$;
create temp table q174_base as select coalesce(max(id), 0) as id from net.http_request_queue;

select is((public.cron_wake_sync_live('2091-10-08 12:06:10+00') ->> 'woke')::boolean, false,
  'C1 no game window ⇒ sync-live is NOT woken…');
select is((select count(*)::int from net.http_request_queue where id > (select id from q174_base)), 0,
  'C2 …proven: nothing was queued — a non-game day costs Vercel nothing');

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-g3', 2091, 6, 'GB', 'CHI', '2091-10-08 17:00:00+00', 'live');
select is(public.cron_wake_sync_live('2091-10-08 18:30:00+00') - 'request_id',
  '{"woke": true, "reason": "game_window", "at": "2091-10-08T18:30:00+00:00"}'::jsonb,
  'C3 a live game ⇒ woken, and it says why');
select is((select string_agg(method::text || ' ' || url || ' ' || (headers ->> 'Authorization'), ' | ') from net.http_request_queue where id > (select id from q174_base)),
  'GET https://fieldscout.gg/api/cron/sync-live?sweep=none Bearer q174-cron-secret',
  'C4 …exactly ONE request: a GET to sync-live with `sweep=none` (a game-window poll never sweeps — the daily job does), carrying the secret');

update nfl_games set status = 'final' where id = 'q174-g3';
select is((public.cron_wake_sync_live('2091-10-08 18:30:30+00') ->> 'woke')::boolean, false,
  'C5 THE LAST GAME GOES FINAL ⇒ THE VERY NEXT TICK DOES NOT WAKE sync-live (Chris 2026-11-14: "we need to stop checking if a game is still on, once the score is final the game is over")');
select is((select count(*)::int from net.http_request_queue where id > (select id from q174_base)), 1,
  'C6 …proven: still exactly the one request from C4');

select is((public.cron_wake_score_week('2091-10-08 18:31:10+00') ->> 'woke')::boolean, false,
  'C7 score-week: nothing owed and no window ⇒ not woken, nothing queued');
insert into score_fanout (season, week, player_id, enqueued_at) values (2091, 6, 'q174-p2', '2091-10-08 18:30:05+00');
select is(public.cron_wake_score_week('2091-10-08 18:31:40+00') - 'request_id',
  '{"woke": true, "reason": "queue", "at": "2091-10-08T18:31:40+00:00"}'::jsonb,
  'C8 the final poll''s deltas are in the queue ⇒ score-week IS woken (the scores after the final whistle still land)');
select is((select url from net.http_request_queue where id > (select id from q174_base) order by id desc limit 1),
  'https://fieldscout.gg/api/cron/score-week',
  'C9 …to the score-week route');
select is((select count(*)::int from net.http_request_queue where id > (select id from q174_base)), 2,
  'C10 two requests in all: one sync-live (C4), one score-week (C8)');
delete from score_fanout;

select ok(not has_function_privilege('anon', 'public.cron_wake_sync_live(timestamptz)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.cron_wake_sync_live(timestamptz)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.cron_wake_sync_live(timestamptz)', 'EXECUTE'),
  'C11 nobody but the scheduler can make the database wake sync-live — service_role named explicitly (a PUBLIC-only revoke leaves it standing, 124)');
select ok(not has_function_privilege('anon', 'public.cron_wake_score_week(timestamptz)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.cron_wake_score_week(timestamptz)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.cron_wake_score_week(timestamptz)', 'EXECUTE'),
  'C12 …nor score-week');

-- ---------------------------------------------------------------------------
-- D. The jobs
-- ---------------------------------------------------------------------------
select is((select schedule || ' | ' || command from cron.job where jobname = 'sync-live-ping'),
  '30 seconds | SELECT public.cron_wake_sync_live()',
  'D1 sync-live-ping: every 30 SECONDS, and the database decides (Chris: "every 30 seconds during games")');
select is((select schedule || ' | ' || command from cron.job where jobname = 'score-week-ping'),
  '30 seconds | SELECT public.cron_wake_score_week()',
  'D2 score-week-ping: every 30 seconds, the database decides');
select is((select schedule || ' | ' || command from cron.job where jobname = 'sync-live-sweep'),
  '0 11 * * * | SELECT public.cron_ping_route(''/api/cron/sync-live?sweep=daily'')',
  'D3 sync-live-sweep: ONCE A DAY at 11:00Z (Chris: "once a day on none day games") — TD5''s re-poll hour, so it carries the final-week re-poll');
select is((select count(*)::int from cron.job where jobname in ('sync-live-ping', 'score-week-ping') and schedule = '* * * * *'), 0,
  'D4 the per-minute schedules are gone (124''s every-minute wakes replaced)');
select is((select schedule || ' | ' || command from cron.job where jobname = 'scoring-stall-check'),
  '* * * * * | SELECT public.scoring_stall_check()',
  'D5 the stall check keeps its own per-minute job — it calls nothing outside the database');

do $do$
begin
  for i in 1..2 loop
    if exists (select 1 from cron.job where jobname = 'sync-live-ping') then perform cron.unschedule('sync-live-ping'); end if;
    perform cron.schedule('sync-live-ping', '30 seconds', 'SELECT public.cron_wake_sync_live()');
    if exists (select 1 from cron.job where jobname = 'score-week-ping') then perform cron.unschedule('score-week-ping'); end if;
    perform cron.schedule('score-week-ping', '30 seconds', 'SELECT public.cron_wake_score_week()');
    if exists (select 1 from cron.job where jobname = 'sync-live-sweep') then perform cron.unschedule('sync-live-sweep'); end if;
    perform cron.schedule('sync-live-sweep', '0 11 * * *', 'SELECT public.cron_ping_route(''/api/cron/sync-live?sweep=daily'')');
  end loop;
end;
$do$;
select is((select count(*)::int from cron.job where jobname in ('sync-live-ping', 'score-week-ping', 'sync-live-sweep')), 3,
  'D6 224''s unschedule-first block re-applied TWICE leaves exactly one job per name');

select throws_ok($$ select public.op_job_check_internal('sync-live-sweep', 'pause') $$, '22023',
  'job "sync-live-sweep" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)',
  'D7 183''s knob list names the new job — refused BY NAME, like its siblings (Q98)');
select throws_ok($$ select public.op_job_check_internal('sync-live-ping', 'run') $$, '22023',
  'job "sync-live-ping" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)',
  'D8 …and the renamed-in-place pings still are');
select lives_ok($$ select public.op_job_check_internal('waivers', 'pause') $$,
  'D9 the knobbed jobs are untouched (183''s body otherwise verbatim)');

-- ---------------------------------------------------------------------------
-- E. The stall check's ingest arm, re-thresholded
-- ---------------------------------------------------------------------------
-- No window open in 2091 below until E7 (every 2091 game is final).
select is((select count(*)::int from nfl_games where season = 2091 and coalesce(status, 'scheduled') in ('scheduled', 'live')), 0,
  'E1 precondition: no open game — the non-game-day regime');

insert into system_flags (key, value, updated_at) values
  ('ingest_poll:2091:6', '{"completed_at": "2091-10-09T11:00:20+00:00", "provider": "sleeper+nflverse"}'::jsonb, '2091-10-09 11:00:20+00');
select is(public.scoring_stall_check('2091-10-10 10:59:00+00') - 'checked_at',
  '{"rows": 0, "reasons": [], "stalled": false, "ingest_stale": false, "last_ingest_at": "2091-10-09T11:00:20+00:00", "oldest_enqueued_at": null, "threshold_minutes": 10, "ingest_threshold_minutes": 2940}'::jsonb,
  'E2 THE FALSE ALARM THIS FIXES: a non-game day, the last ingest yesterday''s 11:00Z sweep (~24 h) ⇒ HEALTHY. 124''s 2 h arm would have lit "Live stats delayed" every non-game afternoon');
select is(public.scoring_stall_check('2091-10-11 12:00:20+00') -> 'stalled', 'false'::jsonb,
  'E3 EXACTLY 49 h (one missed daily sweep plus an hour) is still healthy (strict `<`) — a single provider blip at 11:00Z must not light a banner for a day');
select is(public.scoring_stall_check('2091-10-11 12:00:20.000001+00') -> 'ingest_stale', 'true'::jsonb,
  'E4 …one microsecond more IS a stall — the second missed sweep (D146, both sides)');
delete from system_flags where key like 'ingest_poll:%';
select is(public.scoring_stall_check('2091-10-20 12:00:00+00') -> 'stalled', 'false'::jsonb,
  'E5 no ingest_poll row at all is still NOT a stall (124''s narrow exemption, unchanged)');

-- A window: kickoff 2091-10-15 17:00Z ⇒ open since 16:45Z. Last ingest: the morning sweep.
insert into system_flags (key, value, updated_at) values
  ('ingest_poll:2091:6', '{"completed_at": "2091-10-15T11:00:20+00:00", "provider": "sleeper+nflverse"}'::jsonb, '2091-10-15 11:00:20+00');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-g4', 2091, 7, 'BUF', 'MIA', '2091-10-15 17:00:00+00', 'scheduled');
select is(public.scoring_stall_check('2091-10-15 17:00:00+00') -> 'stalled', 'false'::jsonb,
  'E6 the window has been open EXACTLY 15 minutes and the last ingest is the morning sweep ⇒ not yet a stall — the window''s own age guards its opening (strict `<`)');
select is(public.scoring_stall_check('2091-10-15 17:00:00.000001+00') - 'checked_at',
  '{"rows": 0, "reasons": ["ingest_stale"], "stalled": true, "ingest_stale": true, "last_ingest_at": "2091-10-15T11:00:20+00:00", "oldest_enqueued_at": null, "threshold_minutes": 10, "ingest_threshold_minutes": 15}'::jsonb,
  'E7 …one microsecond later, with nothing ingested since the window opened, it IS — inside a game window the 30-second wake should be polling, so 15 quiet minutes is a stall; the flag reports the 15-minute threshold it judged by');
update system_flags set updated_at = '2091-10-15 18:00:00+00' where key = 'ingest_poll:2091:6';
select is(public.scoring_stall_check('2091-10-15 18:15:00+00') -> 'stalled', 'false'::jsonb,
  'E8 in a window, a poll EXACTLY 15 minutes ago is healthy (strict `<`)');
select is(public.scoring_stall_check('2091-10-15 18:15:00.000001+00') -> 'ingest_stale', 'true'::jsonb,
  'E9 …one microsecond more is a stall (D146, both sides)');
update nfl_games set status = 'final' where id = 'q174-g4';
select is(public.scoring_stall_check('2091-10-15 18:15:00.000001+00') - 'checked_at',
  '{"rows": 0, "reasons": [], "stalled": false, "ingest_stale": false, "last_ingest_at": "2091-10-15T18:00:00+00:00", "oldest_enqueued_at": null, "threshold_minutes": 10, "ingest_threshold_minutes": 2940}'::jsonb,
  'E10 the game goes FINAL ⇒ back to the non-game-day regime at once (no window, 49 h) — the window''s end is the same observation that stops the wakes');

select * from finish();
rollback;
