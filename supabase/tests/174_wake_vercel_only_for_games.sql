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
--       15-minute lead and the 8-hour stuck-game cap (R1822) at the
--       microsecond (D146), live / scheduled / NULL open, FINAL and
--       postponed closed. THE SEASON (R1819): the season that started most
--       recently — a far-future season (the simulator's 2099, next year
--       loaded early) can never switch the window off, an older season's
--       stale row can never hold it open, and the start is the boundary.
--   §B  WHY SCORE-WEEK WAKES: game window and fresh queue work every tick;
--       a live drain's lease is not work (the 120 s boundary at the
--       microsecond); held rows, the close pass and stat fixes only on the
--       5-minute slot; a pass read that raises wakes it anyway (fail open).
--   §S  THE SLOT (R1824/R1825) is keyed on a STORED instant: due with no
--       stamp, spent by the wake that takes it, due again at 4 min 45 s (the
--       microsecond either side) — a late or early tick can't skip or double.
--   §C  THE WAKES, END TO END: no window ⇒ nothing queued; a live game ⇒
--       exactly one GET to `/api/cron/sync-live?sweep=none`; THE GAME GOES
--       FINAL ⇒ the very next tick queues nothing (Chris's rule); a game 8 h
--       past kickoff and never final stops waking it; score-week likewise.
--   §L  THE ROUND LEASE (R1823): taken, held against a second round, taken
--       again only once lapsed, released only by its own token.
--   §D  THE JOBS: the 30-second pings, the 11:00Z daily sweep, the per-minute
--       schedules gone, the DO block idempotent (run twice), and 183's knob
--       list refusing the new job BY NAME. Security posture of all nine.
--   §E  THE STALL CHECK'S INGEST ARM, re-thresholded: a day-old ingest on a
--       non-game day is HEALTHY; 49 h at the microsecond; inside a window 15
--       minutes once the window is itself 15 minutes old — both boundaries at
--       the microsecond; a stuck game no longer counts as a window.
--
-- THE BREAK PROBES (tasks-M1 §4.3), run and reverted in this PR:
--   (1) `final` added to the window's open statuses (first round, applied
--       live): red 24 of the then-59 cells BY NAME — A5 and C5 among them.
--   (2) `live_poll_season` reverted to `max(season)` (review round, applied
--       live on a USED stack — the simulator's 2099 calendar seeded): 174
--       red 14 of 81 BY NAME (2-5, 8-9, 13, 19, 40-41, 43, 48, 76, 78 — A3,
--       A4, the window cells, B3, C3/C4, E7/E9) and 072 red 6 of 59 (49, 52,
--       54, 56-58 — §G, the in-game stall arm switched off). Reverted: green.
--
-- Fixture season 2091 (weeks from 2091-09-05): every instant below is in
-- late 2091, after it started; the far-future season 2095 is seeded in §A
-- on purpose. Any real or simulator season present on a USED stack has
-- either started long before 2091 or (2099) not yet — neither can win.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';

select plan(81);

insert into nfl_weeks (season, week, starts_at) values
  (2091, 1, '2091-09-05 04:00:00+00'),
  (2091, 2, '2091-09-12 04:00:00+00');
insert into players (id, full_name, position, adp) values
  ('q174-p1', 'Q174 WR 1', 'WR', 0.001),
  ('q174-p2', 'Q174 WR 2', 'WR', 0.002);

-- The rows the arms read must be this file's alone.
delete from score_fanout;
delete from system_flags where key like 'ingest_poll:%' or key in ('score_week_slot', 'sync_live_lease');

-- ---------------------------------------------------------------------------
-- A. The window — planLivePoll's HOT rule, and its season
-- ---------------------------------------------------------------------------
select is(public.live_game_window_open('2091-09-09 00:20:00+00'), false,
  'A1 no game rows in the season ⇒ no window (nothing to wake for)');

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-g1', 2091, 1, 'SEA', 'NE', '2091-09-09 00:20:00+00', 'scheduled');
select is(public.live_game_window_open('2091-09-09 00:05:00+00'), true,
  'A2 OPEN exactly at kickoff − 15 minutes (POLL_LEAD_MS) — inactives land pre-game');

-- R1819: a FAR-FUTURE season present (next year's calendar loaded early;
-- the simulator's 2099) — its own open game in its own future.
insert into nfl_weeks (season, week, starts_at) values (2095, 1, '2095-09-05 04:00:00+00');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-future', 2095, 1, 'KC', 'BAL', '2095-09-08 00:20:00+00', 'scheduled');
select is(public.live_poll_season('2091-09-09 00:05:00+00'), 2091,
  'A3 THE SEASON is the one that started most recently — 2091, not the far-future 2095 that `max(season)` picked (R1819: a season that has not started never wins)');
select is(public.live_game_window_open('2091-09-09 00:05:00+00'), true,
  'A4 …so the 2091 window stays OPEN with 2095 on the calendar — under max(season) every wake and the in-game stall arm would have switched off');
select is(public.live_poll_season('2091-09-05 04:00:00+00'), 2091,
  'A5 2091 is the season from the instant its week 1 starts…');
select isnt(public.live_poll_season('2091-09-05 03:59:59.999999+00'), 2091,
  'A6 …and not one microsecond before (D146 — the start is the boundary)');
select is(public.live_game_window_open('2091-09-09 00:04:59.999999+00'), false,
  'A7 one microsecond before kickoff − 15 minutes the window is CLOSED (D146, both sides)');

update nfl_games set status = 'live' where id = 'q174-g1';
select is(public.live_game_window_open('2091-09-09 05:20:00+00'), true,
  'A8 a game five hours past kickoff and still `live` keeps the window open — it closes on OBSERVATION (R711)…');
select is(public.live_game_window_open('2091-09-09 08:20:00+00'), true,
  'A9 …up to EXACTLY 8 hours past kickoff…');
select is(public.live_game_window_open('2091-09-09 08:20:00.000001+00'), false,
  'A10 …and no further: a game 8 h past kickoff that never reads final stops holding it (R1822 — Chris: games last "a couple hours"; STUCK_GAME_CAP_MS). D146 at the cap');
update nfl_games set status = 'final' where id = 'q174-g1';
select is(public.live_game_window_open('2091-09-09 01:00:00+00'), false,
  'A11 a FINAL game never keeps a window open, however recent its kickoff — Chris 2026-11-14: "once the score is final the game is over"');
update nfl_games set status = 'postponed' where id = 'q174-g1';
select is(public.live_game_window_open('2091-09-09 01:00:00+00'), false,
  'A12 a postponed game has left the window (E43; OPEN_STATUSES is scheduled + live only)');
update nfl_games set status = null where id = 'q174-g1';
select is(public.live_game_window_open('2091-09-09 01:00:00+00'), true,
  'A13 a NULL status reads as scheduled (001''s nullable column; `statusOf` in live-poll.ts)');
update nfl_games set status = 'final' where id = 'q174-g1';

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-old', 2090, 17, 'KC', 'LV', '2091-09-09 00:00:00+00', 'scheduled');
select is(public.live_game_window_open('2091-09-09 01:00:00+00'), false,
  'A14 another season''s never-flipped row does NOT hold the window open — only the live season''s games count');
select is(public.live_game_window_open('2091-09-09 01:00:00+00', 2090), true,
  'A15 …it would, for its own season named explicitly (the season is the only thing that hid it)');
select is(public.live_game_window_since('2091-09-09 01:00:00+00', 2090), '2091-09-08 23:45:00+00'::timestamptz,
  'A16 live_game_window_since is the earliest open game''s kickoff − 15 min — the one body the wake and the stall check share');

-- ---------------------------------------------------------------------------
-- B. Why score-week wakes (the slot passed explicitly; §S derives it)
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

select is(public.score_week_wake_reason('2091-10-01 12:05:10+00', true), null,
  'B1 nothing owed, no window ⇒ NULL even on the slot — score-week is not called');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', false), null,
  'B2 …and NULL off it');

insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('q174-g2', 2091, 5, 'DAL', 'NYG', '2091-10-01 12:00:00+00', 'live');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', false), 'game_window',
  'B3 a game window ⇒ every tick');
update nfl_games set status = 'final' where id = 'q174-g2';

insert into score_fanout (season, week, player_id, enqueued_at) values (2091, 5, 'q174-p1', '2091-10-01 12:06:00+00');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', false), 'queue',
  'B4 a FRESH queue row (never leased, never deferred) ⇒ every tick, outside any window — a stat fix''s rows or a late delta score within 30 s');
update score_fanout set claimed_at = '2091-10-01 12:04:10+00', claim_token = gen_random_uuid() where player_id = 'q174-p1';
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', false), null,
  'B5 a row leased EXACTLY 120 s ago is a live drain''s, not work (score_fanout_claim''s strict `<`, lease = SCORE_WEEK_LEASE_SECONDS)');
select is(public.score_week_wake_reason('2091-10-01 12:06:10.000001+00', false), 'queue',
  'B6 …one microsecond past the lease it is claimable again ⇒ wake (a dead drain''s leftovers)');

update score_fanout set claimed_at = null, claim_token = null, deferred_until = '2091-10-01 12:04:40+00' where player_id = 'q174-p1';
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', false), null,
  'B7 a HELD row (deferred before, its hold elapsed) does NOT wake every tick — a hold can last all week');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', true), 'queue_held',
  'B8 …it wakes on the slot');
update score_fanout set deferred_until = '2091-10-01 12:06:40+00' where player_id = 'q174-p1';
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', true), null,
  'B9 a hold still ahead is not claimable ⇒ not even on the slot');
delete from score_fanout;

set local q174.close = 'on';
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', true), 'close_owed',
  'B10 a week to close (216''s own read) ⇒ wake on the slot');
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', false), null,
  'B11 …not off it');
set local q174.close = 'off';
set local q174.fix = 'on';
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', true), 'stat_fix_owed',
  'B12 a stat fix owed somewhere (222''s own read) ⇒ wake on the slot — applied within 5 minutes, platform-wide');
set local q174.fix = 'off';
set local q174.close = 'raise';
select is(public.score_week_wake_reason('2091-10-01 12:06:10+00', true), 'check_failed',
  'B13 a pass read that RAISES wakes score-week anyway (fail open) — its own pass meets the error and alerts by name');
set local q174.close = 'off';
select throws_ok($$ select public.score_week_wake_reason(null) $$, '22023', null,
  'B14 p_now is required (the injected instant, D291)');

-- ---------------------------------------------------------------------------
-- S. The slot, keyed on a stored instant (R1824 / R1825)
-- ---------------------------------------------------------------------------
select is(public.score_week_slot_due('2091-10-01 12:00:07+00'), true,
  'S1 no stamp yet ⇒ the slot is due');
select is(public.cron_wake_score_week('2091-10-01 12:00:07+00') - 'request_id',
  '{"woke": false, "reason": null, "slot": true, "at": "2091-10-01T12:00:07+00:00"}'::jsonb,
  'S2 the wake takes the slot (nothing owed ⇒ no call)…');
select is((select updated_at from system_flags where key = 'score_week_slot'), '2091-10-01 12:00:07+00'::timestamptz,
  'S3 …and stamps it at its own instant');
select is((public.cron_wake_score_week('2091-10-01 12:00:37+00') ->> 'slot')::boolean, false,
  'S4 the next tick (30 s later) does NOT take a second slot');
select is(public.score_week_slot_due('2091-10-01 12:04:51.999999+00'), false,
  'S5 4 min 45 s minus a microsecond after the stamp: not due…');
select is(public.score_week_slot_due('2091-10-01 12:04:52+00'), true,
  'S6 …at 4 min 45 s it is (D146) — so a 30 s tick that drifts a few seconds still lands one slot per 5 minutes, never zero, never two (the first build keyed on the wall-clock second, which jitter could miss or double)');
select is((public.cron_wake_score_week('2091-10-01 12:05:09+00') ->> 'slot')::boolean, true,
  'S7 the tick at +5 min 2 s (late by two seconds) takes the slot');

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
  'C4 …exactly ONE request: a GET to sync-live with `sweep=none`, carrying the secret');

update nfl_games set status = 'final' where id = 'q174-g3';
select is((public.cron_wake_sync_live('2091-10-08 18:30:30+00') ->> 'woke')::boolean, false,
  'C5 THE LAST GAME GOES FINAL ⇒ THE VERY NEXT TICK DOES NOT WAKE sync-live (Chris 2026-11-14: "we need to stop checking if a game is still on, once the score is final the game is over")');
select is((select count(*)::int from net.http_request_queue where id > (select id from q174_base)), 1,
  'C6 …proven: still exactly the one request from C4');

update nfl_games set status = 'live' where id = 'q174-g3';
select is((public.cron_wake_sync_live('2091-10-09 01:00:00.000001+00') ->> 'woke')::boolean, false,
  'C7 a game 8 h past kickoff that never reads final no longer wakes sync-live every 30 s (R1822) — the route ALERTS on it and the daily sweep keeps polling its week');
update nfl_games set status = 'final' where id = 'q174-g3';

select is((public.cron_wake_score_week('2091-10-08 18:31:10+00') ->> 'woke')::boolean, false,
  'C8 score-week: nothing owed and no window ⇒ not woken, nothing queued');
insert into score_fanout (season, week, player_id, enqueued_at) values (2091, 6, 'q174-p2', '2091-10-08 18:30:05+00');
select is(public.cron_wake_score_week('2091-10-08 18:31:40+00') - 'request_id',
  '{"woke": true, "reason": "queue", "slot": false, "at": "2091-10-08T18:31:40+00:00"}'::jsonb,
  'C9 the final poll''s deltas are in the queue ⇒ score-week IS woken at once, off the slot (the scores after the final whistle still land)');
select is((select url from net.http_request_queue where id > (select id from q174_base) order by id desc limit 1),
  'https://fieldscout.gg/api/cron/score-week',
  'C10 …to the score-week route');
select is((select count(*)::int from net.http_request_queue where id > (select id from q174_base)), 2,
  'C11 two requests in all: one sync-live (C4), one score-week (C9)');
delete from score_fanout;

-- ---------------------------------------------------------------------------
-- L. The sync-live round lease (R1823)
-- ---------------------------------------------------------------------------
create temp table q174_tok as select public.sync_live_lease_take('2091-10-08 18:00:00+00', 60) as t;
select ok((select t from q174_tok) is not null,
  'L1 the first game-window round takes the lease (a token)');
select is(public.sync_live_lease_take('2091-10-08 18:00:30+00', 60), null,
  'L2 a second round 30 s later is REFUSED (NULL) — it skips its poll instead of overlapping');
select is(public.sync_live_lease_release(gen_random_uuid(), '2091-10-08 18:00:40+00'), false,
  'L3 a stranger''s token releases nothing');
select is(public.sync_live_lease_release((select t from q174_tok), '2091-10-08 18:00:45+00'), true,
  'L4 the holder releases it on the way out…');
select ok(public.sync_live_lease_take('2091-10-08 18:00:45+00', 60) is not null,
  'L5 …and the next round takes it at once');
select is(public.sync_live_lease_take('2091-10-08 18:01:44.999999+00', 60), null,
  'L6 an UNRELEASED lease (a hard-killed round) holds until its 60 s are up…');
select ok(public.sync_live_lease_take('2091-10-08 18:01:45+00', 60) is not null,
  'L7 …and lapses on its own at 60 s (D146) — SYNC_LIVE_LEASE_SECONDS = maxDuration');
select throws_ok($$ select public.sync_live_lease_take('2091-10-08 18:00:00+00', 0) $$, '22023', null,
  'L8 a lease needs a positive length');

-- ---------------------------------------------------------------------------
-- D. The jobs, and the security posture
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

select is(
  (select string_agg(p.proname || '=' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('live_poll_season', 'live_game_window_since', 'live_game_window_open', 'score_week_slot_due',
      'score_week_wake_reason', 'cron_wake_sync_live', 'cron_wake_score_week', 'sync_live_lease_take', 'sync_live_lease_release')),
  'cron_wake_score_week=false:search_path="" cron_wake_sync_live=false:search_path="" live_game_window_open=false:search_path="" live_game_window_since=false:search_path="" live_poll_season=false:search_path="" score_week_slot_due=false:search_path="" score_week_wake_reason=false:search_path="" sync_live_lease_release=false:search_path="" sync_live_lease_take=false:search_path=""',
  'D10 all nine are SECURITY INVOKER with search_path='''' (124''s reason for the ping path: the caller is pg_cron''s postgres; INVOKER fails closed for every API role), one overload each');
select is(
  (select count(*)::int from unnest(array['live_poll_season(timestamptz)', 'live_game_window_since(timestamptz, integer)', 'live_game_window_open(timestamptz, integer)',
      'score_week_slot_due(timestamptz)', 'score_week_wake_reason(timestamptz, boolean)', 'sync_live_lease_take(timestamptz, integer)',
      'sync_live_lease_release(uuid, timestamptz)', 'cron_wake_sync_live(timestamptz)', 'cron_wake_score_week(timestamptz)']) f,
     unnest(array['anon', 'authenticated']) r
   where has_function_privilege(r, 'public.' || f, 'EXECUTE')),
  0, 'D11 anon and authenticated can execute NONE of the nine');
select ok(has_function_privilege('service_role', 'public.live_game_window_open(timestamptz, integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.sync_live_lease_take(timestamptz, integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.sync_live_lease_release(uuid, timestamptz)', 'EXECUTE'),
  'D12 service_role keeps the window (the equivalence suite''s D291 door) and the lease (the route''s)');
select ok(not has_function_privilege('service_role', 'public.cron_wake_sync_live(timestamptz)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.cron_wake_score_week(timestamptz)', 'EXECUTE'),
  'D13 …but NOT the two wakes: nobody but the scheduler can make the database call our cron routes — service_role named explicitly (a PUBLIC-only revoke leaves it standing, 124)');

-- ---------------------------------------------------------------------------
-- E. The stall check's ingest arm, re-thresholded
-- ---------------------------------------------------------------------------
select is((select count(*)::int from nfl_games where season = 2091 and coalesce(status, 'scheduled') in ('scheduled', 'live')), 0,
  'E1 precondition: no open game in the live season — the non-game-day regime');

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
select is(public.scoring_stall_check('2091-10-16 01:00:00.000001+00') -> 'ingest_threshold_minutes', '2940'::jsonb,
  'E10 the same game 8 h past kickoff and still not final no longer counts as a window — the stall check and the wake read ONE body (live_game_window_since), so they cannot disagree (R1822)');
update nfl_games set status = 'final' where id = 'q174-g4';
select is(public.scoring_stall_check('2091-10-15 18:15:00.000001+00') - 'checked_at',
  '{"rows": 0, "reasons": [], "stalled": false, "ingest_stale": false, "last_ingest_at": "2091-10-15T18:00:00+00:00", "oldest_enqueued_at": null, "threshold_minutes": 10, "ingest_threshold_minutes": 2940}'::jsonb,
  'E11 the game goes FINAL ⇒ back to the non-game-day regime at once (no window, 49 h) — the window''s end is the same observation that stops the wakes');
select is(public.scoring_stall_check('2091-10-15 18:15:00.000001+00') -> 'ingest_threshold_minutes', '2940'::jsonb,
  'E12 …and the far-future 2095 season on the calendar (§A) never turned the in-game arm off: E7 and E9 judged 2091''s window by 15 minutes with it present (R1819)');

select * from finish();
rollback;
