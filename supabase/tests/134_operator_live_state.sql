-- ============================================================================
-- 134 — the operator's live-state reads (migration 186; M8 L.G1.5; spec §24.4
--       "Live-state view"; PROGRESS D518)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — both doors DEFINER + search_path '' + EXECUTE authenticated
--       only; every internal plain, search_path '', closed; nothing reads
--       league_members (TD1); nothing writes (no INSERT/UPDATE/DELETE text).
--   §K  REFUSALS — anon / a plain user / the league's commissioner get
--       42501 from both doors; the operator gets P0002 for an unknown or a
--       deleted league (loud, never an empty state).
--   §S  ONE LEAGUE — golden: weeks, the open week's games with the exact
--       plain-words reason per game (boundary: kickoff AT the instant is
--       "passed", one microsecond later is "not started"), operator marks,
--       pending counts, only the pauses that apply, cron = every job,
--       receipts capped at 20 newest-first with the true limit stated.
--   §P  PLATFORM — every open pause, the marked games, live weeks, cron.
-- Break probe (§4.3): drop the in-body gate from op_league_state ⇒ K2/K3
-- red (shown in the PR, reverted).
-- World (season 2099): u1 commissioner, u4 OPERATOR, u5 plain user.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.err(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_league_state', 'op_league_state_internal',
     'op_platform_state', 'op_platform_state_internal', 'op_cron_last_runs_internal',
     'op_pause_json_internal', 'op_week_games_internal')),
  'op_cron_last_runs_internal=f:search_path="":f:f op_league_state=t:search_path="":f:t op_league_state_internal=f:search_path="":f:f op_pause_json_internal=f:search_path="":f:f op_platform_state=t:search_path="":f:t op_platform_state_internal=f:search_path="":f:f op_week_games_internal=f:search_path="":f:f',
  'A1 doors DEFINER + search_path '''' + authenticated only; internals plain and closed');
select ok(
  (select bool_and(p.prosrc !~* 'league_members' and p.prosrc !~* '\m(insert|update|delete)\M'
                   and p.prosrc !~* 'request\.jwt')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'op\_%state%' or p.proname in ('op_cron_last_runs_internal',
     'op_pause_json_internal', 'op_week_games_internal'))),
  'A2 TD1 / R1545: no body reads league_members, writes, or touches the JWT claims');

-- ---------------------------------------------------------------------------
-- World
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, ('99134000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x134-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, json_build_object('username', 'x134_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;
update profiles set is_admin = true where id = '99134000-0000-4000-8000-000000000004';

insert into nfl_weeks (season, week, starts_at) values
  (2099, 1, '2099-09-08 07:00+00'), (2099, 2, '2099-09-15 07:00+00'), (2099, 3, '2099-09-22 07:00+00');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status, operator_hold, operator_hold_at, operator_hold_prior_status) values
  ('x134-g1', 2099, 2, 'KC', 'BUF', '2099-09-18 00:00+00', 'final',       null, null, null),
  ('x134-g2', 2099, 2, 'DAL', 'NYG', '2099-09-20 17:00+00', 'in_progress', null, null, null),
  ('x134-g3', 2099, 2, 'SF',  'LAR', '2099-09-20 20:00+00', 'scheduled',  null, null, null),   -- kickoff == the instant
  ('x134-g4', 2099, 2, 'GB',  'CHI', '2099-09-20 20:00:00.000001+00', 'scheduled', null, null, null),
  ('x134-g5', 2099, 2, 'MIA', 'NYJ', '2099-09-21 00:00+00', 'postponed',  null, null, null),   -- still in week
  ('x134-g6', 2099, 2, 'SEA', 'ARI', '2099-09-23 00:00+00', 'postponed',  null, null, null),   -- left the week
  ('x134-g7', 2099, 2, 'DEN', 'LV',  '2099-09-20 17:00+00', 'scheduled', 'in_week', '2099-09-19 00:00+00', 'scheduled'),
  ('x134-g8', 2099, 2, 'NE',  'TEN', '2099-09-20 17:00+00', 'postponed', 'cancelled', '2099-09-19 00:00+00', 'scheduled');

insert into leagues (id, owner_id, name, season, status, team_count, settings, roster_settings, deleted_at)
select v.id::uuid, '99134000-0000-4000-8000-000000000001', v.nm, 2099, 'setup', 8, '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}',
  v.del::timestamptz
from (values
  ('b1340000-0000-4000-8000-000000000001', 'pgtap-x134-L1', null),
  ('b1340000-0000-4000-8000-000000000002', 'pgtap-x134-L2', null),
  ('b1340000-0000-4000-8000-000000000003', 'pgtap-x134-LD', '2099-01-01 00:00:00+00')
) v(id, nm, del);
insert into league_members (league_id, user_id, role, is_placeholder) values
 ('b1340000-0000-4000-8000-000000000001', '99134000-0000-4000-8000-000000000001', 'commissioner', false);
insert into league_weeks (league_id, season, week, status) values
 ('b1340000-0000-4000-8000-000000000001', 2099, 1, 'final'),
 ('b1340000-0000-4000-8000-000000000001', 2099, 2, 'live');

insert into job_pauses (job, league_id, paused_at, paused_by, pause_action_id) values
 ('waivers', 'b1340000-0000-4000-8000-000000000001', '2099-09-19 00:00+00', '99134000-0000-4000-8000-000000000004', gen_random_uuid()),
 ('week-finalize', null, '2099-09-19 01:00+00', '99134000-0000-4000-8000-000000000004', gen_random_uuid()),
 ('waivers', 'b1340000-0000-4000-8000-000000000002', '2099-09-19 02:00+00', '99134000-0000-4000-8000-000000000004', gen_random_uuid());

insert into commissioner_actions (league_id, actor_id, action_type, reason, created_at)
select 'b1340000-0000-4000-8000-000000000001', '99134000-0000-4000-8000-000000000001', 'edit_score',
       'c' || i, '2099-09-01 00:00+00'::timestamptz + make_interval(mins => i)
from generate_series(1, 25) i;
insert into platform_operator_actions (action_id, actor_id, verb, scope, league_id, created_at)
select gen_random_uuid(), '99134000-0000-4000-8000-000000000004', 'op_pause_job', 'league',
       'b1340000-0000-4000-8000-000000000001', '2099-09-01 00:00+00'::timestamptz + make_interval(mins => i)
from generate_series(1, 3) i;

create temp table r134 (tag text primary key, r jsonb);
grant all on r134 to anon, authenticated, service_role;
insert into r134 values
  ('L', op_league_state_internal('b1340000-0000-4000-8000-000000000001', '2099-09-20 20:00+00')),
  ('P', op_platform_state_internal('2099-09-20 20:00+00'));

-- ---------------------------------------------------------------------------
-- K. Refusals
-- ---------------------------------------------------------------------------
set local role anon;
select alike(pg_temp.err($$select op_league_state('b1340000-0000-4000-8000-000000000001')$$), '42501:%', 'K1 anon refused (league)');
select alike(pg_temp.err($$select op_platform_state()$$), '42501:%', 'K1b anon refused (platform)');
reset role;

select set_config('request.jwt.claims', '{"sub": "99134000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
select alike(pg_temp.err($$select op_league_state('b1340000-0000-4000-8000-000000000001')$$), '42501:%only a platform operator%', 'K2 a plain user is refused (league)');
select alike(pg_temp.err($$select op_platform_state()$$), '42501:%only a platform operator%', 'K2b a plain user is refused (platform)');
reset role;

select set_config('request.jwt.claims', '{"sub": "99134000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select alike(pg_temp.err($$select op_league_state('b1340000-0000-4000-8000-000000000001')$$), '42501:%only a platform operator%', 'K3 the league''s own commissioner is refused (no league power reaches it)');
select alike(pg_temp.err($$select op_platform_state()$$), '42501:%only a platform operator%', 'K3b the commissioner is refused (platform)');
reset role;

select set_config('request.jwt.claims', '{"sub": "99134000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
select alike(pg_temp.err($$select op_league_state('b1340000-0000-4000-8000-0000000000ff')$$), 'P0002:%no such league%', 'K4 operator: an unknown league is P0002, not an empty state');
select alike(pg_temp.err($$select op_league_state('b1340000-0000-4000-8000-000000000003')$$), 'P0002:%no such league%', 'K5 operator: a deleted league is P0002');
select is((op_league_state('b1340000-0000-4000-8000-000000000001') -> 'league' ->> 'name'), 'pgtap-x134-L1', 'K6 the operator reads the league through the door');
select ok((op_platform_state() ? 'cron'), 'K7 the operator reads the platform view through the door');
reset role;

-- ---------------------------------------------------------------------------
-- S. One league (golden, stored literals)
-- ---------------------------------------------------------------------------
select is((select jsonb_agg(w ->> 'week' || ':' || (w ->> 'status') || ':' || (w ->> 'summary') order by (w ->> 'week')::int)
           from r134, jsonb_array_elements(r -> 'weeks') w where tag = 'L')::text,
  '["1:final:Final", "2:live:Being played"]', 'S1 weeks and their status, in plain words');
select is((select jsonb_array_length(r -> 'open_weeks') from r134 where tag = 'L'), 1, 'S2 one open week');
select is((select jsonb_agg(g ->> 'game_id' || '|' || (g ->> 'holds_week') || '|' || (g ->> 'reason') order by g ->> 'game_id')
           from r134, jsonb_array_elements(r -> 'open_weeks' -> 0 -> 'games') g where tag = 'L')::text,
  '["x134-g2|true|Being played now", "x134-g3|true|Kickoff has passed but there is no final score yet", "x134-g4|true|Not started yet", "x134-g5|true|Postponed, but its new kickoff is still this week — the week waits for it", "x134-g6|false|Postponed past this week — players score 0, not holding the week", "x134-g7|true|Marked by FieldScout: moved later this week — the week waits for it", "x134-g8|false|Marked by FieldScout: cancelled — players score 0, not holding the week"]',
  'S3 every game holding the week (final g1 omitted) with its reason; boundary g3 (kickoff == instant) passed vs g4 (+1µs) not started; marks shown with holds_week');
select is((select g ->> 'operator_hold' from r134, jsonb_array_elements(r -> 'open_weeks' -> 0 -> 'games') g
           where tag = 'L' and g ->> 'game_id' = 'x134-g8'), 'cancelled', 'S4 the operator_hold mark is carried');
select is((select (r -> 'pending' ->> 'waiver_claims')::int from r134 where tag = 'L'), 0, 'S5 pending waiver claims counted (0 here, never omitted)');
select ok((select r -> 'pending' ? 'next_waiver_run_at' from r134 where tag = 'L'), 'S6 the next waiver run is stated');
select is((select jsonb_agg(p ->> 'summary' order by p ->> 'paused_at') from r134, jsonb_array_elements(r -> 'pauses') p where tag = 'L')::text,
  '["Waivers paused by FieldScout for this league", "Week finalize paused by FieldScout for every league"]',
  'S7 only the pauses that apply: its own and every-league; another league''s pause is not shown');
select is((select jsonb_array_length(r -> 'cron') from r134 where tag = 'L'), (select count(*)::int from cron.job),
  'S8 one cron entry per scheduled job — a job that never ran is still listed');
select ok((select bool_and(c ->> 'last_status' is not null and c ->> 'summary' is not null)
           from r134, jsonb_array_elements(r -> 'cron') c where tag = 'L'), 'S9 every job has a status and plain-words summary ("never run" when empty)');
select is((select jsonb_array_length(r -> 'commissioner_receipts') from r134 where tag = 'L'), 20, 'S10 commissioner receipts capped at 20 of 25');
select is((select r -> 'commissioner_receipts' -> 0 ->> 'reason' || ',' || (r -> 'commissioner_receipts' -> 19 ->> 'reason') from r134 where tag = 'L'),
  'c25,c6', 'S11 newest first: c25 … c6');
select is((select (r ->> 'receipts_limit')::int from r134 where tag = 'L'), 20, 'S12 the cap is stated beside the list');
select is((select jsonb_array_length(r -> 'operator_receipts') from r134 where tag = 'L'), 3, 'S13 the league''s operator receipts');
select is((select r -> 'commissioner_receipts' -> 0 ->> 'actor' from r134 where tag = 'L'), 'x134_user1', 'S14 the commissioner is named');

-- ---------------------------------------------------------------------------
-- P. Platform
-- ---------------------------------------------------------------------------
select ok((select count(*) = 3 from r134, jsonb_array_elements(r -> 'pauses') p where tag = 'P'
           and p ->> 'paused_by' = '99134000-0000-4000-8000-000000000004'), 'P1 every open pause across leagues');
select ok((select bool_and(g ->> 'game_id' in ('x134-g2', 'x134-g3', 'x134-g4', 'x134-g5', 'x134-g7', 'x134-g8'))
              and count(*) = 6
           from r134, jsonb_array_elements(r -> 'games') g where tag = 'P' and g ->> 'game_id' like 'x134-%'),
  'P2 held games and marked games across leagues (the left-week unmarked g6 and the final g1 are not alerts)');
select ok((select (r ->> 'games_total')::int >= 6 and (r ->> 'games_limit')::int = 200 from r134 where tag = 'P'), 'P3 true total + cap stated');
select ok((select r -> 'live_weeks' @> '[{"season": 2099, "week": 2, "leagues": 1}]' from r134 where tag = 'P'), 'P4 live weeks with the league count');
select is((select jsonb_array_length(r -> 'cron') from r134 where tag = 'P'), (select count(*)::int from cron.job), 'P5 the last run of every job');

select * from finish();
rollback;
