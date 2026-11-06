-- ============================================================================
-- pgTAP 166 — migration 216: a week must not close over a lost score (PROGRESS
-- F863 / Q105; F256(b), F257(a), F273, F859, F860; Chris 2026-11-05: "Games stay
-- blank until they've actually been scored." "Updates that were lost get scored
-- again." "A week can't close while it's still owed a score.").
--
--   §A  Form: the columns, DEFINER / search_path / REVOKE per function (the
--       one-time backfill closed to service_role too, R1795), refused callers,
--       no write policy per role with RETURNING counts (§4.1 / §4.2).
--   §B  THE BACKFILL on a fixture shaped like production: 1 league, 12 teams,
--       weeks 1–7 final, week 8 correction_window, week 9 live, weeks 10–14
--       upcoming. Never-scored 0s go blank; a written 0, a non-zero, an
--       overridden row, every final week and the final standings do not move.
--   §C  A row starts blank; the close stamp; finalize's scores_owed guard
--       (F859): never closed, lines moved, a line landing OUT OF ORDER, the
--       boundary instants of league_weeks_to_close.
--   §D  A starter with no line never holds a week; a week of nobody's lines
--       owes nothing; a blank holds a closed week.
--   §E  League-local (D790): a queue row, another league's stamp and another
--       league's hold move nothing.
--   §F  F256(b) end to end, THE PROBE'S OWN SCRIPT: the round can't be built, the
--       update is consumed, the round is built BLANK, the week holds, and the
--       re-score decides it on points. Before 216 this closed 0–0, higher seed.
--   §G  round_not_built; the F257(a) "played" reading (a real 0 is played).
--   §H  An overridden row's blank: filled, never its number or result.
--   §I  The ack's per-row hold (F860), with its boundary instants.
--   §J  A FINAL week stays re-scorable (admin_rescore_final_week; F870 / F871).
--
-- Break probes (§4.3), each shown red in the PR and reverted: see PROGRESS D827.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(80);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99166000-0000-4000-8000-00000000000' || i)::uuid, 'authenticated', 'authenticated',
       'pgtap-x166-u' || i || '@fieldscout.local', 'x', now(), '{"provider": "email", "providers": ["email"]}',
       json_build_object('username', 'x166_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

-- The calendar: week 3 over, week 4 over, week 5 has a game still open, week 6
-- over with no stat line for ANY player, week 7 over. Literals (D146's shape).
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
  ('x166-g3', 2026, 3, 'SEA', 'KC', '2026-09-28 00:00:00+00', 'final'),
  ('x166-g4', 2026, 4, 'SEA', 'KC', '2026-10-05 00:00:00+00', 'final'),
  ('x166-g5', 2026, 5, 'SEA', 'KC', '2026-10-12 00:00:00+00', 'scheduled'),
  ('x166-g6', 2026, 6, 'SEA', 'KC', '2026-10-19 00:00:00+00', 'final'),
  ('x166-g7', 2026, 7, 'SEA', 'KC', '2026-10-26 00:00:00+00', 'final')
on conflict (id) do nothing;
update nfl_weeks set last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set last_game_ends_at = '2026-10-06 04:00:00+00', correction_window_ends_at = '2026-10-08 10:00:00+00' where season = 2026 and week = 4;
update nfl_weeks set correction_window_ends_at = '2026-10-15 10:00:00+00' where season = 2026 and week = 5;
update nfl_weeks set last_game_ends_at = '2026-10-20 04:00:00+00', correction_window_ends_at = '2026-10-22 10:00:00+00' where season = 2026 and week = 6;
-- 2026's other in-week games, if a seed carries any, are out of this file's way.
delete from player_stats where season = 2026 and week in (3, 4, 5, 6, 7);
delete from score_fanout where season = 2026 and week in (3, 4, 5, 6, 7);

create function pg_temp.lg(p_name text) returns uuid language sql as $$
  select id from public.leagues where name = 'pgtap-x166-' || p_name
$$;
create function pg_temp.tm(p_name text, p_k int) returns uuid language sql as $$
  select t.id from public.teams t where t.name = 'x166 ' || p_name || ' ' || p_k
$$;
create function pg_temp.pl(p_name text, p_k int) returns text language sql as $$
  select 'x166-' || lower(p_name) || '-' || p_k
$$;
-- One league: two teams, each starting his own QB with a line (or none).
create function pg_temp.mk(p_name text, p_week int default 3, p_pt int default 0, p_rsw int default 1, p_lines boolean default true) returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.leagues (owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                              scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
  select '99166000-0000-4000-8000-000000000001', 'pgtap-x166-' || p_name, 2026, 'in_season', 8, p_rsw, p_pt, 15,
         s.id, s.rules, 'per_player_kickoff', '{"schedule_mode": "h2h"}', '{}'
  from public.scoring_systems s where s.is_template and s.name = 'ESPN Standard'
  returning id into v;
  insert into public.teams (owner_id, name, league_id, status) values
    ('99166000-0000-4000-8000-000000000001', 'x166 ' || p_name || ' 1', v, 'active'),
    ('99166000-0000-4000-8000-000000000002', 'x166 ' || p_name || ' 2', v, 'active');
  insert into public.players (id, full_name, position, team, status) values
    (pg_temp.pl(p_name, 1), 'x166 ' || p_name || ' QB1', 'QB', 'SEA', 'Active'),
    (pg_temp.pl(p_name, 2), 'x166 ' || p_name || ' QB2', 'QB', 'KC', 'Active');
  insert into public.league_weeks (league_id, season, week, status) values (v, 2026, p_week, 'correction_window');
  insert into public.team_lineups (team_id, season, week, starters, bench, slot_map) values
    (pg_temp.tm(p_name, 1), 2026, p_week, '[]', '[]', jsonb_build_object('QB:0', pg_temp.pl(p_name, 1))),
    (pg_temp.tm(p_name, 2), 2026, p_week, '[]', '[]', jsonb_build_object('QB:0', pg_temp.pl(p_name, 2)));
  if p_lines then
    insert into public.player_stats (player_id, season, week, stat_type, updated_at, pass_yards) values
      (pg_temp.pl(p_name, 1), 2026, p_week, 'weekly', '2026-09-29 03:00:00+00', 300),
      (pg_temp.pl(p_name, 2), 2026, p_week, 'weekly', '2026-09-29 03:00:00+00', 200);
    delete from public.score_fanout where player_id in (pg_temp.pl(p_name, 1), pg_temp.pl(p_name, 2));
  end if;
  return v;
end;
$$;
-- A pairing, blank unless scores are given (never a column default).
create function pg_temp.pair(p_name text, p_week int default 3) returns void language sql as $$
  insert into public.matchups (league_id, season, week, round_type, home_team_id, away_team_id, status)
  values (pg_temp.lg(p_name), 2026, p_week, 'regular', pg_temp.tm(p_name, 1), pg_temp.tm(p_name, 2), 'live');
$$;
create function pg_temp.score(p_name text, p_h numeric, p_a numeric, p_week int default 3) returns void language sql as $$
  select public.score_write_week_batch(pg_temp.lg(p_name), p_week, jsonb_build_array(
    jsonb_build_object('team_id', pg_temp.tm(p_name, 1), 'points', p_h),
    jsonb_build_object('team_id', pg_temp.tm(p_name, 2), 'points', p_a)));
  select null::void;
$$;
create function pg_temp.dg(p_name text, p_week int default 3) returns text language sql as $$
  select public.league_week_scores_digest_internal(pg_temp.lg(p_name), 2026, p_week)
$$;
create function pg_temp.stamp(p_name text, p_at timestamptz default '2026-09-30 00:00:00+00', p_week int default 3) returns jsonb language sql as $$
  select public.league_week_close_stamp(pg_temp.lg(p_name), p_week, pg_temp.dg(p_name, p_week), '[]'::jsonb, p_at)
$$;
-- finalize at the first hourly run past the window; the league's week + why not.
create function pg_temp.fin(p_name text, p_at timestamptz default '2026-10-01 11:05:00+00', p_week int default 3) returns text language plpgsql as $$
declare
  r jsonb := public.finalize_matchups(p_at, pg_temp.lg(p_name));
begin
  return (select status from public.league_weeks where league_id = pg_temp.lg(p_name) and week = p_week) || '|' ||
    coalesce((select string_agg(x ->> 'reason' || coalesce(':' || (x ->> 'why'), ''), ',') from jsonb_array_elements(r -> 'skipped') x where (x ->> 'week')::int = p_week), '-');
end;
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate;
end;
$$;
create function pg_temp.close_row(p_name text, p_at timestamptz, p_week int default 3) returns text language sql as $$
  select coalesce((select c.reason from public.league_weeks_to_close(p_at, 500, array[pg_temp.lg(p_name)]) c where c.week = p_week), 'not listed')
$$;

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(column_name || '=' || coalesce(column_default, 'none') || ':' || is_nullable, ' ' order by column_name)
   from information_schema.columns where table_schema = 'public' and table_name = 'matchups' and column_name in ('home_score', 'away_score')),
  'away_score=none:YES home_score=none:YES', 'A1 F273: both score columns are nullable with NO default');
select is(
  (select string_agg(column_name || ':' || data_type || ':' || coalesce(column_default, 'none'), ' ' order by column_name)
   from information_schema.columns where table_schema = 'public' and table_name = 'league_weeks' and column_name in ('scored_digest', 'scored_at')),
  'scored_at:timestamp with time zone:none scored_digest:text:none', 'A2 the close stamp''s two columns');
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('league_weeks_to_close', 'league_week_close_stamp', 'league_week_scores_digest_internal',
     'week_scores_owed_internal', 'matchups_blank_never_scored_internal', 'finalize_matchups', 'score_fanout_ack')),
  'finalize_matchups=t:search_path="":f:f league_week_close_stamp=t:search_path="":f:f league_week_scores_digest_internal=f:search_path="":f:f league_weeks_to_close=t:search_path="":f:f matchups_blank_never_scored_internal=f:search_path="":f:f score_fanout_ack=t:search_path="":f:f week_scores_owed_internal=f:search_path="":f:f',
  'A3 the worker''s doors DEFINER + search_path '''' + closed to anon and authenticated; helpers plain + closed');
-- R1795: the backfill ran once inside 216; a stray call later would re-blank an
-- empty-lineup team's real 0 in a non-final week. No API role may run it —
-- service_role included; the owner keeps it (§B runs the rule as the owner).
select is(
  (select string_agg(r || '=' || has_function_privilege(r, 'public.matchups_blank_never_scored_internal()', 'EXECUTE'), ' ' order by r)
   from unnest(array['anon', 'authenticated', 'public', 'service_role']) r),
  'anon=false authenticated=false public=false service_role=false',
  'A3b R1795: the one-time backfill is closed to every API role after its run, service_role included');
select pg_temp.mk('A');
select pg_temp.pair('A');
select set_config('request.jwt.claims', json_build_object('sub', '99166000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select is(pg_temp.err($$ select public.league_weeks_to_close('2026-10-01 00:00:00+00') $$), '42501', 'A4 a signed-in caller is refused by league_weeks_to_close, in the body');
select is(pg_temp.err(format($$ select public.league_week_close_stamp(%L, 3, 'x', '[]', '2026-10-01 00:00:00+00') $$, pg_temp.lg('A'))), '42501', 'A5 …and by league_week_close_stamp');
set local role authenticated;
with u as (update public.league_weeks set scored_digest = 'forged', scored_at = '2026-10-01 00:00:00+00' where league_id = pg_temp.lg('A') returning 1)
select is((select count(*)::int from u), 0, 'A6 no write policy: authenticated can''t stamp a week (RETURNING 0)');
with u as (update public.matchups set home_score = 99 where league_id = pg_temp.lg('A') returning 1)
select is((select count(*)::int from u), 0, 'A7 …or write a score (RETURNING 0)');
reset role;
set local role anon;
with u as (update public.league_weeks set scored_digest = 'forged' where league_id = pg_temp.lg('A') returning 1)
select is((select count(*)::int from u), 0, 'A8 …nor can anon (RETURNING 0)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select coalesce(scored_digest, 'unset') from league_weeks where league_id = pg_temp.lg('A')), 'unset', 'A9 …nothing moved');

-- ---------------------------------------------------------------------------
-- B. THE BACKFILL — production's shape, every old cell an explicit 0 (109's DEFAULT as it was).
-- ---------------------------------------------------------------------------
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select 'b1660000-0000-4000-8000-000000000001', '99166000-0000-4000-8000-000000000001', 'pgtap-x166-PROD', 2026, 'in_season', 12, 14, 6, 15,
       s.id, s.rules, 'per_player_kickoff', '{"schedule_mode": "h2h"}', '{}'
from scoring_systems s where s.is_template and s.name = 'ESPN Standard';
insert into teams (id, owner_id, name, league_id, status)
select ('c1660000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, '99166000-0000-4000-8000-000000000001', 'x166 PROD ' || i, 'b1660000-0000-4000-8000-000000000001', 'active'
from generate_series(1, 12) i;
create function pg_temp.pt(i int) returns uuid language sql as $$ select ('c1660000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid $$;
insert into league_weeks (league_id, season, week, status)
select 'b1660000-0000-4000-8000-000000000001', 2026, w, case when w <= 7 then 'final' when w = 8 then 'correction_window' when w = 9 then 'live' else 'upcoming' end
from generate_series(1, 14) w;
-- Weeks 1–7 final, real scores (home wins by the pair's number); week 1's last game a genuine 0–0 tie.
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status, result, home_score, away_score)
select 'b1660000-0000-4000-8000-000000000001', 2026, w, 'regular', pg_temp.pt(2 * i - 1), pg_temp.pt(2 * i), 'final',
       case when w = 1 and i = 6 then 'tie' else 'home' end,
       case when w = 1 and i = 6 then 0 else 100 + i end, case when w = 1 and i = 6 then 0 else 90 + i end
from generate_series(1, 7) w, generate_series(1, 6) i;
-- Week 8: all real, but T4 was never reached (0, no rows) and T1 v T2's T2 really scored 0 (its rows say so).
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status, home_score, away_score)
select 'b1660000-0000-4000-8000-000000000001', 2026, 8, 'regular', pg_temp.pt(2 * i - 1), pg_temp.pt(2 * i), 'live',
       100 + i, case when i in (1, 2) then 0 else 90 + i end
from generate_series(1, 6) i;
-- Week 9 live: all 0–0 but T5 (a written 0.00, its rows say so) and T7 (12.50); T11 v T12 overridden 0–0.
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status, home_score, away_score, is_overridden, result)
select 'b1660000-0000-4000-8000-000000000001', 2026, 9, 'regular', pg_temp.pt(2 * i - 1), pg_temp.pt(2 * i), 'live',
       case when i = 4 then 12.5 else 0 end, 0, i = 6, case when i = 6 then 'tie' end
from generate_series(1, 6) i;
-- Weeks 10–14 upcoming: 6 matchups each, 0–0.
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status, home_score, away_score)
select 'b1660000-0000-4000-8000-000000000001', 2026, w, 'regular', pg_temp.pt(2 * i - 1), pg_temp.pt(2 * i), 'scheduled', 0, 0
from generate_series(10, 14) w, generate_series(1, 6) i;
insert into players (id, full_name, position, team, status) values ('x166-prod', 'x166 PROD', 'QB', 'SEA', 'Active');
insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, pending, reason, source) values
 ('b1660000-0000-4000-8000-000000000001', 2026, 8, pg_temp.pt(2), 'QB:0', 'x166-prod', 0, '{}', 'scored', 'worker'),
 ('b1660000-0000-4000-8000-000000000001', 2026, 8, pg_temp.pt(1), 'QB:0', 'x166-prod', 101, '{}', 'scored', 'worker'),
 ('b1660000-0000-4000-8000-000000000001', 2026, 9, pg_temp.pt(5), 'QB:0', 'x166-prod', 0, '{}', 'scored', 'worker'),
 ('b1660000-0000-4000-8000-000000000001', 2026, 9, pg_temp.pt(7), 'QB:0', 'x166-prod', 12.5, '{}', 'scored', 'worker');
-- An archived league's future row: blank too, or it comes back from a restore as a plausible 0.
select pg_temp.mk('ARCH', 9);
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status, home_score, away_score)
values (pg_temp.lg('ARCH'), 2026, 9, 'regular', pg_temp.tm('ARCH', 1), pg_temp.tm('ARCH', 2), 'live', 0, 0);
update leagues set deleted_at = '2026-10-01 00:00:00+00' where id = pg_temp.lg('ARCH');

-- The final standings, before.
do $$
declare v int;
begin
  for v in 1 .. 7 loop perform public.week_results_write_internal('b1660000-0000-4000-8000-000000000001', 2026, v); end loop;
end;
$$;
create function pg_temp.prod_final() returns text language sql as $$
  select md5(coalesce((select string_agg(m.id::text || ':' || m.home_score || ':' || m.away_score || ':' || m.result || ':' || m.status || ':' || m.updated_at, '|' order by m.id)
                       from public.matchups m where m.league_id = 'b1660000-0000-4000-8000-000000000001' and m.week <= 7), ''))
$$;
create function pg_temp.prod_standings() returns text language sql as $$
  select string_agg(x ->> 'team_id' || '=' || (x ->> 'rank') || ':' || (x ->> 'points_for') || ':' || (x ->> 'wins'), ' ' order by (x ->> 'rank')::int)
  from jsonb_array_elements(public.league_standings_internal('b1660000-0000-4000-8000-000000000001', false) -> 'standings') x
$$;
select set_config('pgtap.final', pg_temp.prod_final(), true);
select set_config('pgtap.standings', pg_temp.prod_standings(), true);
select set_config('pgtap.w8', (select string_agg(home_score || '/' || away_score, ',' order by home_score) from matchups where league_id = 'b1660000-0000-4000-8000-000000000001' and week = 8), true);
select is(current_setting('pgtap.w8'), '101/0,102/0,103/93,104/94,105/95,106/96', 'B0 premise: week 8 as written, T2 and T4 at 0');

alter table matchups disable trigger tr_aa_league_archived_guard;
select public.matchups_blank_never_scored_internal();
alter table matchups enable trigger tr_aa_league_archived_guard;

create function pg_temp.cells(p_week int) returns text language sql as $$
  select string_agg(coalesce(home_score::text, 'B') || '/' || coalesce(away_score::text, 'B'), ',' order by home_team_id)
  from public.matchups where league_id = 'b1660000-0000-4000-8000-000000000001' and week = p_week
$$;
select is(pg_temp.prod_final(), current_setting('pgtap.final'), 'B1 weeks 1–7: not one byte moved, the genuine 0–0 final included (stored digest before = after)');
select is(pg_temp.prod_standings(), current_setting('pgtap.standings'), 'B2 the final standings are byte-identical');
select is((select count(*)::int from matchups where league_id = 'b1660000-0000-4000-8000-000000000001' and week <= 7 and (home_score is null or away_score is null)), 0, 'B3 no final-week cell went blank');
select is(pg_temp.cells(8), '101/0,102/B,103/93,104/94,105/95,106/96', 'B4 week 8 (correction_window): T2''s written 0 stays, it has rows; T4, never reached, goes blank; everything real stands');
select is(pg_temp.cells(9), 'B/B,B/B,0/B,12.5/B,B/B,0/0',
  'B5 week 9 (live): T7''s 12.50 and T5''s written 0 stand; every unreached side is blank; the overridden 0–0 is the commissioner''s, untouched');
select is((select string_agg(coalesce(m.home_score::text, 'B'), ',' order by right(t.name, 2)) from matchups m join teams t on t.id = m.home_team_id
           where m.league_id = 'b1660000-0000-4000-8000-000000000001' and m.week = 9), 'B,B,0,12.5,B,0', 'B5b …each home cell by team: T1, T3 blank; T5 0 (written); T7 12.5; T9 blank; T11 overridden 0');
select is((select count(*)::int from matchups where league_id = 'b1660000-0000-4000-8000-000000000001' and week between 10 and 14 and home_score is null and away_score is null), 30,
  'B6 weeks 10–14 (upcoming): all 30 rows blank');
select is((select format('%s|%s', m.home_score, (select deleted_at is not null from leagues l where l.id = m.league_id)) from matchups m where m.league_id = pg_temp.lg('ARCH')), '|t',
  'B7 an archived league''s open row went blank, and the league is still archived');
select is((select string_agg(tgname || ':' || tgenabled::text, ' ' order by tgname) from pg_trigger where tgrelid = 'matchups'::regclass and tgname = 'tr_aa_league_archived_guard'),
  'tr_aa_league_archived_guard:O', 'B8 the archive freeze is back on');
select is((select public.matchups_blank_never_scored_internal() >= 0 and (select pg_temp.cells(8)) = '101/0,102/B,103/93,104/94,105/95,106/96'), true, 'B9 running it again changes nothing that was real');

-- ---------------------------------------------------------------------------
-- C. A row starts blank; the stamp; finalize's guard (F859)
-- ---------------------------------------------------------------------------
select pg_temp.mk('N');
select pg_temp.pair('N');
select is((select format('%s/%s/%s', coalesce(home_score::text, 'B'), coalesce(away_score::text, 'B'), status) from matchups where league_id = pg_temp.lg('N')), 'B/B/live',
  'C1 F273: a row inserted without the columns is blank, not 0');
select is(pg_temp.fin('N'), 'correction_window|pending_scores', 'C2 a blank holds the week by name');
select pg_temp.score('N', 12, 8);
select is(pg_temp.fin('N'), 'correction_window|scores_owed:never_closed', 'C3 F859: scored but never closed — a line is in the league that the close pass has not read: held BY NAME');
select is(pg_temp.close_row('N', '2026-09-30 00:00:00+00'), 'never_closed', 'C4 …and league_weeks_to_close names it, days before its window ends');
select is(pg_temp.dg('N') ~ '^[0-9a-f]{32}$', true, 'C5 the digest is a hash');
select is((pg_temp.stamp('N') ->> 'stamped')::boolean, true, 'C6 the stamp lands');
select is(pg_temp.close_row('N', '2026-09-30 00:00:00+00'), 'not listed', 'C7 …and the week is no longer named');
select is(pg_temp.fin('N', '2026-10-01 10:05:00+00'), 'final|-', 'C8 closed and written: the week finalizes');
select is((select format('%s|%s', home_score, result) from matchups where league_id = pg_temp.lg('N')), '12|home', 'C8b …on its real scores');

select pg_temp.mk('M');
select pg_temp.pair('M');
select pg_temp.score('M', 12, 8);
select pg_temp.stamp('M');
update player_stats set pass_yards = 350, updated_at = '2026-10-01 09:00:00+00' where player_id = pg_temp.pl('M', 1) and week = 3;
select is(pg_temp.fin('M'), 'correction_window|scores_owed:lines_moved', 'C9 F859: a line moved after the close — held (a later write would have met a final week and changed nothing)');
select is(pg_temp.close_row('M', '2026-09-30 00:00:00+00'), 'not listed', 'C10 boundary: a moved line far from the window waits for the queue (no digest read)');
select is(pg_temp.close_row('M', '2026-10-01 09:44:59+00'), 'not listed', 'C10b one second before the last 15 minutes: not listed');
select is(pg_temp.close_row('M', '2026-10-01 09:45:00+00'), 'lines_moved', 'C10c at exactly window − 15:00: listed');
select is(pg_temp.close_row('M', '2026-10-01 11:05:00+00'), 'lines_moved', 'C10d past the window: still listed');
select is((public.league_week_close_stamp(pg_temp.lg('M'), 3, 'stale-digest', '[]', '2026-10-01 10:00:00+00')) ->> 'why', 'lines_moved', 'C11 a stale digest is refused by name — the lines moved under the pass');
select is((select coalesce(scored_at::text, 'unstamped') <> '2026-10-01 10:00:00+00' from league_weeks where league_id = pg_temp.lg('M')), true, 'C11b …and nothing was recorded');
select pg_temp.stamp('M', '2026-10-01 10:30:00+00');
select is(pg_temp.fin('M'), 'final|-', 'C12 re-closed: final');

-- A line landing OUT OF ORDER (an older poll committing late): a timestamp compare would miss it.
select pg_temp.mk('O');
select pg_temp.pair('O');
select pg_temp.score('O', 12, 8);
update player_stats set updated_at = '2026-09-29 05:00:00+00' where player_id = pg_temp.pl('O', 1) and week = 3;
select pg_temp.stamp('O');
update player_stats set pass_yards = 111, updated_at = '2026-09-29 04:30:00+00' where player_id = pg_temp.pl('O', 2) and week = 3;
select is(pg_temp.fin('O'), 'correction_window|scores_owed:lines_moved', 'C13 a line with a stamp OLDER than the newest read still holds the week: the digest has no clock in it');

-- ---------------------------------------------------------------------------
-- D. A starter with no line is a real 0, never a hold
-- ---------------------------------------------------------------------------
select pg_temp.mk('D');
select pg_temp.pair('D');
delete from player_stats where player_id = pg_temp.pl('D', 2) and week = 3;   -- a DNP
select pg_temp.score('D', 12, 0);
select pg_temp.stamp('D');
select is(pg_temp.fin('D'), 'final|-', 'D1 a starter with no line (a DNP) scores 0 and the week closes');
select is((select format('%s/%s/%s', home_score, away_score, result) from matchups where league_id = pg_temp.lg('D')), '12/0/home', 'D1b …0 is a real score');
select pg_temp.mk('E', 3, 0, 1, false);
select pg_temp.pair('E');
select is(pg_temp.dg('E'), null, 'D2 nobody in the league has a line: the digest is NULL');
select is(week_scores_owed_internal(pg_temp.lg('E'), 2026, 3), null, 'D3 …and nothing is owed');
select is(pg_temp.fin('E'), 'correction_window|pending_scores', 'D4 …but the blanks still hold it, until the close pass writes the 0s');
select pg_temp.score('E', 0, 0);
select pg_temp.stamp('E');
select is(pg_temp.fin('E'), 'final|-', 'D5 a real 0–0 between two teams with no lines closes');
select pg_temp.mk('F');
select pg_temp.pair('F');
select pg_temp.stamp('F');
select is(pg_temp.fin('F'), 'correction_window|pending_scores', 'D6 a closed week with a blank is still held: the stamp is no excuse');

-- league_weeks_to_close: what it does NOT name, each with its reason.
select pg_temp.mk('G5', 5);
select pg_temp.pair('G5', 5);
select is(pg_temp.close_row('G5', '2026-10-13 00:00:00+00', 5), 'not listed', 'D7 "once the games are final": a week with a game still open is not closed, so no 0 lands early');
select pg_temp.mk('NL', 6, 0, 1, false);
select pg_temp.pair('NL', 6);
select is(pg_temp.close_row('NL', '2026-10-21 00:00:00+00', 6), 'no_stat_lines', 'D8 a week with no stat line for ANY player is named, never zero-filled: the feed is out');
select pg_temp.mk('PA');
select pg_temp.pair('PA');
update league_weeks set status = 'final', finalized_at = '2026-10-01 00:00:00+00' where league_id = pg_temp.lg('PA');
select is(pg_temp.close_row('PA', '2026-09-30 00:00:00+00'), 'not listed', 'D9 a final week is never named');
select is(public.league_week_close_stamp(pg_temp.lg('PA'), 3, pg_temp.dg('PA'), '[]', '2026-10-01 00:00:00+00') ->> 'why', 'week_final', 'D10 …and never stamped');
select is((select count(*)::int from public.league_weeks_to_close('2026-09-30 00:00:00+00', 500, array[pg_temp.lg('ARCH')])), 0, 'D11 an archived league is never named');

-- ---------------------------------------------------------------------------
-- E. League-local (D790): nothing another league does moves this answer
-- ---------------------------------------------------------------------------
select pg_temp.mk('X');
select pg_temp.pair('X');
select pg_temp.score('X', 12, 8);
select pg_temp.stamp('X');
select pg_temp.mk('Y');
select pg_temp.pair('Y');
select pg_temp.score('Y', 12, 8);
-- Y starts X's player too, so one queue row is both leagues'.
update team_lineups set slot_map = jsonb_build_object('QB:0', pg_temp.pl('X', 1)) where team_id = pg_temp.tm('Y', 1);
insert into score_fanout (season, week, player_id, enqueued_at, deferred_until, claimed_at, claim_token)
values (2026, 3, pg_temp.pl('X', 1), '2026-09-29 03:00:00+00', '2026-12-01 00:00:00+00', '2026-10-01 11:00:00+00', gen_random_uuid());
select is(pg_temp.fin('X'), 'final|-', 'E1 X is closed: a queue row for its own player, deferred and leased by someone else, is not read (D790)');
select is((select count(*)::int from score_fanout where season = 2026 and week = 3 and player_id = pg_temp.pl('X', 1)), 1, 'E2 …and finalize left the shared row where it was');
select is(pg_temp.fin('Y'), 'correction_window|scores_owed:never_closed', 'E3 Y, on the same row, is held on its OWN stamp, not X''s');
select pg_temp.stamp('Y');
select is(pg_temp.fin('Y'), 'final|-', 'E4 Y closed: final');

-- ---------------------------------------------------------------------------
-- F. F256(b) end to end — the probe's own script (before 216: 0–0, higher seed)
-- ---------------------------------------------------------------------------
select pg_temp.mk('R', 3, 2, 1);
insert into league_weeks (league_id, season, week, status) values (pg_temp.lg('R'), 2026, 4, 'upcoming');
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status, home_score, away_score)
values (pg_temp.lg('R'), 2026, 3, 'regular', pg_temp.tm('R', 1), pg_temp.tm('R', 2), 'live', null, 90);
select is(playoff_bracket_sync_internal(pg_temp.lg('R'), '2026-09-30 05:00:00+00') ->> 'reason', 'bracket_waiting', 'F1 the prior week holds a blank: the round waits');
update league_weeks set status = 'live' where league_id = pg_temp.lg('R') and week = 4;
insert into team_lineups (team_id, season, week, starters, bench, slot_map) values
  (pg_temp.tm('R', 1), 2026, 4, '[]', '[]', jsonb_build_object('QB:0', pg_temp.pl('R', 1))),
  (pg_temp.tm('R', 2), 2026, 4, '[]', '[]', jsonb_build_object('QB:0', pg_temp.pl('R', 2)));
insert into player_stats (player_id, season, week, stat_type, updated_at, pass_yards) values
  (pg_temp.pl('R', 1), 2026, 4, 'weekly', '2026-10-05 04:00:00+00', 100),
  (pg_temp.pl('R', 2), 2026, 4, 'weekly', '2026-10-05 04:00:00+00', 400);
select is(score_write_week_batch(pg_temp.lg('R'), 4, jsonb_build_array(jsonb_build_object('team_id', pg_temp.tm('R', 2), 'points', 16))) #>> '{skipped,0,reason}', 'no_matchup_row',
  'F2 the update has no game to land on: consumed, as before');
update matchups set home_score = 100, status = 'final', result = 'home' where league_id = pg_temp.lg('R') and week = 3;
select public.week_results_write_internal(pg_temp.lg('R'), 2026, 3);
update league_weeks set status = 'final', finalized_at = '2026-10-01 11:00:00+00' where league_id = pg_temp.lg('R') and week = 3;
select is(playoff_bracket_sync_internal(pg_temp.lg('R'), '2026-10-06 05:00:00+00') ->> 'action', 'built', 'F3 the round is built late');
select is((select format('%s/%s:%s/%s:%s', home_seed, away_seed, coalesce(home_score::text, 'B'), coalesce(away_score::text, 'B'), status) from matchups where league_id = pg_temp.lg('R') and week = 4),
  '1/2:B/B:live', 'F4 …BLANK, not 0–0');
update league_weeks set status = 'correction_window' where league_id = pg_temp.lg('R') and week = 4;
select is(pg_temp.fin('R', '2026-10-08 11:05:00+00', 4), 'correction_window|pending_scores', 'F5 the week can''t close: it is owed its scores (before 216 it closed here, 0–0)');
select is(pg_temp.close_row('R', '2026-10-06 06:00:00+00', 4), 'never_closed', 'F6 the close pass is told to score it');
select pg_temp.score('R', 4, 16, 4);
select pg_temp.stamp('R', '2026-10-06 06:00:00+00', 4);
select is(pg_temp.fin('R', '2026-10-08 11:05:00+00', 4), 'final|-', 'F7 re-scored from the lines, closed');
select is((select format('%s/%s:%s', home_score, away_score, result) from matchups where league_id = pg_temp.lg('R') and week = 4), '4/16:away', 'F8 the game is decided on points');
select is((select format('%s:%s', l.status, t.name) from leagues l join teams t on t.id = l.champion_team_id where l.id = pg_temp.lg('R')), 'complete:x166 R 2', 'F9 …the LOWER seed wins it: before 216 the higher seed advanced on a 0–0 nobody played');

-- ---------------------------------------------------------------------------
-- G. round_not_built; the F257(a) "played" reading
-- ---------------------------------------------------------------------------
select pg_temp.mk('RB', 4, 2, 1);
insert into league_weeks (league_id, season, week, status) values (pg_temp.lg('RB'), 2026, 3, 'final');
update leagues set status = 'playoffs' where id = pg_temp.lg('RB');
select is(pg_temp.fin('RB', '2026-10-08 11:05:00+00', 4), 'correction_window|round_not_built', 'G1 a playoff week whose round was never built doesn''t close with no games');
select pg_temp.mk('NP', 4, 0, 1);
select is(pg_temp.close_row('NP', '2026-10-06 06:00:00+00', 4), 'never_closed', 'G2 control: a no-playoff league''s week with no rows is an ordinary week to the close pass');
select pg_temp.stamp('NP', '2026-10-06 06:00:00+00', 4);
select is(pg_temp.fin('NP', '2026-10-08 11:05:00+00', 4), 'final|-', 'G3 control: …and is not held for a round (bracket leagues only)');

select pg_temp.mk('V', 3, 2, 1);
insert into league_weeks (league_id, season, week, status) values (pg_temp.lg('V'), 2026, 4, 'upcoming');
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status, home_score, away_score)
values (pg_temp.lg('V'), 2026, 3, 'regular', pg_temp.tm('V', 1), pg_temp.tm('V', 2), 'live', 100, 90);
select is(playoff_bracket_sync_internal(pg_temp.lg('V'), '2026-09-30 05:00:00+00') ->> 'action', 'built', 'G4 the round is built from the provisional verdict');
update league_weeks set status = 'live' where league_id = pg_temp.lg('V') and week = 4;
update matchups set home_score = 80 where league_id = pg_temp.lg('V') and week = 3;   -- the verdict flips the seeds
savepoint g_played;
update matchups set away_score = 0 where league_id = pg_temp.lg('V') and week = 4;
select is((select format('%s:%s', r ->> 'reason', r ->> 'scored_rows') from (select playoff_bracket_sync_internal(pg_temp.lg('V'), '2026-10-01 05:00:00+00') r) x), 'rebuild_refused_round_played:1',
  'G5 F257(a): a REAL 0.00 is a played score — the rewrite is refused (it read as unplayed before 216)');
rollback to savepoint g_played;
select is(playoff_bracket_sync_internal(pg_temp.lg('V'), '2026-10-01 05:00:00+00') ->> 'action', 'rebuilt', 'G6 control: both blank, the same round is rewritten');

-- ---------------------------------------------------------------------------
-- H. An overridden row's blank: filled, never its number or result
-- ---------------------------------------------------------------------------
select pg_temp.mk('H');
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status, is_overridden, result, home_score, away_score)
values (pg_temp.lg('H'), 2026, 3, 'regular', pg_temp.tm('H', 1), pg_temp.tm('H', 2), 'live', true, 'home', null, 40);
select is(pg_temp.fin('H'), 'correction_window|pending_scores', 'H1 a declared winner over a team not yet scored is held: the door never writes an overridden row');
select is((public.league_week_close_stamp(pg_temp.lg('H'), 3, pg_temp.dg('H'), jsonb_build_array(
    jsonb_build_object('team_id', pg_temp.tm('H', 1), 'points', 12), jsonb_build_object('team_id', pg_temp.tm('H', 2), 'points', 77)), '2026-09-30 00:00:00+00')) ->> 'filled', '1',
  'H2 the close stamp fills the one blank');
select is((select format('%s/%s:%s:%s', home_score, away_score, result, is_overridden) from matchups where league_id = pg_temp.lg('H')), '12/40:home:t',
  'H3 …the commissioner''s number (40, not the pass''s 77) and result stand; the row stays overridden');
select is(pg_temp.fin('H'), 'final|-', 'H4 and the week closes');

-- ---------------------------------------------------------------------------
-- I. The ack's per-row hold (F860)
-- ---------------------------------------------------------------------------
delete from score_fanout where season = 2026 and week = 7;
insert into players (id, full_name, position, team, status) values ('x166-a1', 'x166 A1', 'QB', 'SEA', 'Active'), ('x166-a2', 'x166 A2', 'QB', 'SEA', 'Active');
insert into score_fanout (season, week, player_id, enqueued_at) values
  (2026, 7, 'x166-a1', '2026-10-27 01:00:00+00'), (2026, 7, 'x166-a2', '2026-10-27 01:00:00+00');
select set_config('pgtap.tok', (select claim_token::text from score_fanout_claim(1000, 120, '2026-10-27 02:00:00+00') where player_id = 'x166-a1'), true);
select is((score_fanout_ack(current_setting('pgtap.tok')::uuid, '[]'::jsonb,
    '[{"season": 2026, "week": 7, "player_id": "x166-a1", "enqueued_at": "2026-10-27 01:00:00+00", "defer_until": "2026-10-27 02:05:00+00"},
      {"season": 2026, "week": 7, "player_id": "x166-a2", "enqueued_at": "2026-10-27 01:00:00+00"}]'::jsonb,
    '2026-10-27 02:00:30+00') ->> 'deferred'), '2', 'I1 both rows deferred');
select is((select string_agg(player_id || '=' || deferred_until, ' ' order by player_id) from score_fanout where season = 2026 and week = 7),
  'x166-a1=2026-10-27 02:05:00+00 x166-a2=2026-10-27 02:00:30+00', 'I2 F860: a failed save''s row carries its own longer hold; the other keeps the call''s');
select is((select count(*)::int from score_fanout_claim(1000, 120, '2026-10-27 02:04:59+00') where player_id = 'x166-a1'), 0, 'I3 boundary: one second before the hold ends it isn''t claimed, so it can''t spin');
select is((select count(*)::int from score_fanout_claim(1000, 120, '2026-10-27 02:05:00+00') where player_id = 'x166-a1'), 1, 'I3b at the instant the hold ends it is retried');

-- ---------------------------------------------------------------------------
-- J. A FINAL week stays re-scorable, untouched by any of this (F870 / F871 rely on it)
-- ---------------------------------------------------------------------------
select pg_temp.mk('Z', 3, 0, 2);
select pg_temp.pair('Z');
select pg_temp.score('Z', 12, 8);
select pg_temp.stamp('Z');
select pg_temp.fin('Z');
select is((select r ->> 'error' from (select admin_rescore_final_week(pg_temp.lg('Z'), 3, jsonb_build_array(
    jsonb_build_object('team_id', pg_temp.tm('Z', 1), 'points', 20, 'players', jsonb_build_array(jsonb_build_object('slot', 'QB:0', 'player_id', pg_temp.pl('Z', 1), 'points', 20, 'pending', '[]'::jsonb, 'reason', 'scored'))),
    jsonb_build_object('team_id', pg_temp.tm('Z', 2), 'points', 8, 'players', jsonb_build_array(jsonb_build_object('slot', 'QB:0', 'player_id', pg_temp.pl('Z', 2), 'points', 8, 'pending', '[]'::jsonb, 'reason', 'scored')))),
    'pgtap', 'pgtap note', '99166000-0000-4000-8000-000000000001', gen_random_uuid(), false) r) x), null, 'J1 the re-score door applies on a final week');
select is((select format('%s/%s:%s', home_score, away_score, status) from matchups where league_id = pg_temp.lg('Z')), '20/8:final', 'J2 …and the score moves');

select * from finish();
rollback;
