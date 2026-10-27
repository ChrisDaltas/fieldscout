-- ============================================================================
-- 132 — game status: an operator marks an NFL game (migration 184; M8 L.G1.4;
--       spec §24.4 "Game status", §23.4, E43; tasks-M8 TD6 / TD7; Q99 (a) /
--       Q100; F243 / Q37; PROGRESS D513)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — the three columns and their CHECKs; the door DEFINER +
--       search_path '' + EXECUTE for authenticated only; the internal plain
--       and closed; D137 — with 184's marked lines removed, the two replaced
--       predicates are their newest definers' FILE TEXT (stored md5s of
--       116:317-359 and 142:156-450), and nothing else carries a 184 line.
--   §K  REFUSALS — anon / a plain user / the league's own commissioner
--       (42501, TD1); a bad status, a missing action id, an unknown game, a
--       FINAL game — each by name, none writes a receipt or the row.
--   §M  MOVED LATER THIS WEEK (week 7) — the week is held before the mark
--       (a postponed game with an in-week kickoff is OPEN); the mark writes
--       status 'scheduled' + the hold + ONE receipt + ONE line per league
--       still playing the week; finalize STILL holds it (Q100 "the week
--       waits"); a replay and the same mark again write nothing.
--   §N  BACK TO NORMAL — clears the hold and restores the provider status
--       ('postponed'), one receipt; the week is still held.
--   §C  CANCELLED — status 'postponed' + hold; the game LEFT the week in
--       week_games_state_internal; the NORMAL finalize (cron path, no
--       operator verb) closes week 7 with the scores it has; the results and
--       standings follow; after that the game can never be re-marked (§23.4).
--   §E  WEEK 18 / MOVED OUT (the F243 case — no later calendar row): the
--       game holds the week before the mark even though it is postponed
--       (nothing can leave week 18 by kickoff); out_of_week makes it leave
--       — in week_games_state_internal AND the correction lock's (A) — and
--       the normal finalize closes week 18.
--   §R  The receipt trail is exactly the changes (no row per no-op); the
--       lines are signed "FieldScout", never the operator's username.
-- Break probe (§4.3): drop the 184 arm from week_games_state_internal ⇒
-- §C's C3/C4 and §E's E2/E4 red (shown in the PR, reverted).
-- World: u1 commissioner, u2 / u3 managers, u4 OPERATOR, u5 plain user.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(65);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', column_name, data_type, is_nullable), ' ' order by column_name)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'nfl_games' and column_name like 'operator\_hold%'),
  'operator_hold:text:YES operator_hold_at:timestamp with time zone:YES operator_hold_prior_status:text:YES',
  'A1 nfl_games gains operator_hold / operator_hold_at / operator_hold_prior_status, all nullable (NULL = no mark)');
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.err(text) to anon, authenticated;
select is(pg_temp.err($$ insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, operator_hold, operator_hold_at)
                         values ('x132-bad', 2026, 7, 'A', 'B', now(), 'postponed', now()) $$)::text like '23514:%', true,
  'A2 the CHECK refuses a mark outside in_week / out_of_week / cancelled');
select is(pg_temp.err($$ insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, operator_hold)
                         values ('x132-bad', 2026, 7, 'A', 'B', now(), 'cancelled') $$)::text like '23514:%', true,
  'A3 …and a mark without its instant (the whole-mark CHECK)');
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_set_game_status', 'op_set_game_status_internal',
     'week_games_state_internal', 'commish_matchup_edit_lock_internal', 'lineup_kickoff_internal',
     'op_verb_prelude_internal', 'week_release_floor_internal')),
  'commish_matchup_edit_lock_internal=f:search_path="":f:f lineup_kickoff_internal=f:search_path="":f:f op_set_game_status=t:search_path="":f:t op_set_game_status_internal=f:search_path="":f:f op_verb_prelude_internal=f:search_path="":f:f week_games_state_internal=f:search_path="":f:f week_release_floor_internal=f:search_path="":f:f',
  'A4 the door DEFINER + search_path '''' + authenticated only; every other 184 body plain and closed to anon / authenticated');
-- pg_temp.un212 — migration 212's inserted lines removed (each ends
-- `-- 212 / F716…`; pgTAP 162 A9 pins them); an identity on every body
-- without them.
create function pg_temp.un212(p_src text) returns text language sql as $un212$
  select regexp_replace(p_src, E'\n[^\n]*-- 212 / F716[^\n]*', '', 'g')
$un212$;
create function pg_temp.un184(p_src text) returns text language sql as $un184$
  select regexp_replace(p_src, E'\n[^\n]*   -- 184 / L\\.G1\\.4 \\(TD7\\)', '', 'g')
$un184$;
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un212(p.prosrc)), ' ' order by p.proname)   -- 212 (R1733): the prelude's archived line removed first
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('week_games_state_internal', 'commish_matchup_edit_lock_internal',
     'lineup_kickoff_internal', 'op_verb_prelude_internal')),
  'commish_matchup_edit_lock_internal=054c34712af523200f05d64da22b0ca4 lineup_kickoff_internal=b30c5ba957cfc5f0f72009b18ac28c33 op_verb_prelude_internal=69e0a040fd961551a792fd486c107f58 week_games_state_internal=baba7674522c7a6150b67913b87051b0',
  'A5 the four replaced bodies'' live prosrc md5s — 184 as written (stored literals)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un184(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('week_games_state_internal', 'commish_matchup_edit_lock_internal', 'lineup_kickoff_internal')),
  'commish_matchup_edit_lock_internal=22e166d7b568e70ae6a24153d0f564fe lineup_kickoff_internal=80b9c63efa3cb5bbef7b79863e9801a7 week_games_state_internal=00910b5cb8e851d10cbaf1fd710d5d86',
  'A6 D137: with 184''s lines removed each body is its newest definer''s FILE TEXT (142:156-450 = pgTAP 090 A1''s pin; 116:317-359; 112:380-428 — md5 of the file text)');
select is(
  (select md5(replace(pg_temp.un212(p.prosrc), 'can use the operator tools (M8 TD1)', 'can use the job knobs (M8 TD1)'))
   from pg_proc p where p.oid = 'public.op_verb_prelude_internal(text,uuid,uuid,text)'::regprocedure),
  '57867ee5196cce4ed433866fe02f009c',
  'A6b R1548: the prelude''s ONE change is its gate wording — reversed, it is 183:239-283''s FILE TEXT');
select is(
  (select string_agg(format('%s=%s', w.week, to_char(week_release_floor_internal(w.starts_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')), ' ' order by w.week)
   from nfl_weeks w where w.season = 2026 and w.week in (2, 7, 8, 18)),
  '2=2026-09-22T07:00Z 7=2026-10-27T07:00Z 8=2026-11-03T08:00Z 18=2027-01-12T08:00Z',
  'A6c the SQL floor = release-floor.ts weekReleaseFloor (Tuesday 00:00 Pacific: PDT 07:00Z, PST 08:00Z across the Nov 1 fall-back)');
select is(
  (select string_agg(p.proname || ':' || (length(p.prosrc) - length(pg_temp.un184(p.prosrc)) > 0)::text || ':' ||
      (select count(*) from regexp_matches(p.prosrc, '-- 184 / L\.G1\.4 \(TD7\)', 'g'))::text, ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '-- 184 / L\.G1\.4 \(TD7\)'),
  'commish_matchup_edit_lock_internal:true:2 lineup_kickoff_internal:true:1 week_games_state_internal:true:1',
  'A7 exactly three bodies carry 184 lines — the correction lock two, the finalize gate one, the kickoff read one (D137 hunk count)');
select ok(
  (select pg_get_functiondef(p.oid) !~* 'league_members' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'op_set_game_status_internal'),
  'A8 TD1: the verb never reads league_members');

-- ---------------------------------------------------------------------------
-- World
-- ---------------------------------------------------------------------------
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 -- week 7: one played game, one the provider postponed with no new date (its
 -- kickoff still inside week 7 — an OPEN game, it holds the week).
 ('x132-g7a', 2026, 7, 'KC',  'BUF', '2026-10-25 17:00:00+00', 'final'),
 ('x132-g7b', 2026, 7, 'MIA', 'NYJ', '2026-10-25 20:00:00+00', 'postponed'),
 -- week 18 (the calendar's last row — no later week to move a kickoff past):
 ('x132-g18a', 2026, 18, 'DAL', 'PHI', '2027-01-10 18:00:00+00', 'final'),
 ('x132-g18b', 2026, 18, 'SEA', 'SF',  '2027-01-10 21:25:00+00', 'postponed');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99132000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x132-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'x132_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;
update profiles set is_admin = true where id = '99132000-0000-4000-8000-000000000004';

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, settings, roster_settings)
select v.id::uuid, '99132000-0000-4000-8000-000000000001', v.nm, 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}'
from (values
  ('b1320000-0000-4000-8000-000000000007', 'pgtap-x132-L7'),
  ('b1320000-0000-4000-8000-000000000018', 'pgtap-x132-L18')
) v(id, nm);
insert into teams (id, owner_id, name, league_id, status) values
 ('c1320000-0000-4000-8000-000000000071', '99132000-0000-4000-8000-000000000002', 'X132 7A', 'b1320000-0000-4000-8000-000000000007', 'active'),
 ('c1320000-0000-4000-8000-000000000072', '99132000-0000-4000-8000-000000000003', 'X132 7B', 'b1320000-0000-4000-8000-000000000007', 'active'),
 ('c1320000-0000-4000-8000-000000000181', '99132000-0000-4000-8000-000000000002', 'X132 18A', 'b1320000-0000-4000-8000-000000000018', 'active'),
 ('c1320000-0000-4000-8000-000000000182', '99132000-0000-4000-8000-000000000003', 'X132 18B', 'b1320000-0000-4000-8000-000000000018', 'active');
insert into league_members (league_id, user_id, team_id, role, is_placeholder)
select l.id, '99132000-0000-4000-8000-000000000001', null, 'commissioner', false
from leagues l where l.name like 'pgtap-x132-%';
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 ('b1320000-0000-4000-8000-000000000007', '99132000-0000-4000-8000-000000000002', 'c1320000-0000-4000-8000-000000000071', 'manager', false),
 ('b1320000-0000-4000-8000-000000000007', '99132000-0000-4000-8000-000000000003', 'c1320000-0000-4000-8000-000000000072', 'manager', false),
 ('b1320000-0000-4000-8000-000000000018', '99132000-0000-4000-8000-000000000002', 'c1320000-0000-4000-8000-000000000181', 'manager', false),
 ('b1320000-0000-4000-8000-000000000018', '99132000-0000-4000-8000-000000000003', 'c1320000-0000-4000-8000-000000000182', 'manager', false);
-- Each league's one week, in its correction window, with one scored matchup
-- (the worker's scores — the unplayed game's players have no stat line, so
-- they score 0 there: score-week-worker.ts "NO STAT LINE … scores 0").
insert into league_weeks (league_id, season, week, status) values
 ('b1320000-0000-4000-8000-000000000007', 2026, 7, 'correction_window'),
 ('b1320000-0000-4000-8000-000000000018', 2026, 18, 'live');
insert into matchups (id, league_id, season, week, home_team_id, away_team_id, home_score, away_score, status) values
 ('e1320000-0000-4000-8000-000000000007', 'b1320000-0000-4000-8000-000000000007', 2026, 7,
  'c1320000-0000-4000-8000-000000000071', 'c1320000-0000-4000-8000-000000000072', 101.50, 88.25, 'live'),
 ('e1320000-0000-4000-8000-000000000018', 'b1320000-0000-4000-8000-000000000018', 2026, 18,
  'c1320000-0000-4000-8000-000000000181', 'c1320000-0000-4000-8000-000000000182', 70.00, 92.10, 'live');

-- A MIA player with a week-7 line and NO game_id (production's shape, F468(a)).
insert into players (id, full_name, position, team, status) values ('x132-mia', 'X132 Mia', 'WR', 'MIA', 'Active');
insert into player_stats (player_id, season, week, stat_type, updated_at, receiving_yards)
values ('x132-mia', 2026, 7, 'weekly', '2026-10-25 23:00:00+00', 50);
delete from score_fanout where season = 2026 and week = 7;

create temp table r132 (tag text primary key, r jsonb);
grant all on r132 to anon, authenticated, service_role;
create or replace function pg_temp.as_op() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "99132000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
$$;
create or replace function pg_temp.receipts() returns int language sql as $$
  select count(*)::int from platform_operator_actions a where a.actor_id = '99132000-0000-4000-8000-000000000004'
$$;
create or replace function pg_temp.game(p_id text) returns text language sql as $$
  select format('%s|%s|%s|%s', g.status, coalesce(g.operator_hold, '-'), coalesce(g.operator_hold_prior_status, '-'),
                (g.operator_hold_at is not null)) from nfl_games g where g.id = p_id
$$;
create or replace function pg_temp.state(p_week int) returns text language sql as $$
  select format('in_week=%s left=%s open=%s all_final=%s left_list=%s', s.total_games - s.postponed_games, s.postponed_games,
                s.open_games, s.all_final, coalesce(s.postponed_list, '-'))
  from week_games_state_internal(2026, p_week) s
$$;
create or replace function pg_temp.lock(p_team text, p_at timestamptz) returns text language sql as $$
  select format('%s|%s', k.on_bye, (select l.locked from pool_game_lock_internal(2026, 7, p_team, p_at) l))
  from lineup_kickoff_internal(2026, 7, p_team, p_at) k
$$;
create or replace function pg_temp.release(p_week int) returns text language sql as $$
  select coalesce(to_char(w.last_game_ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), 'NULL') from nfl_weeks w where w.season = 2026 and w.week = p_week
$$;
create or replace function pg_temp.lw(p_league uuid) returns text language sql as $$
  select lw.status from league_weeks lw where lw.league_id = p_league
$$;
create or replace function pg_temp.lines(p_league uuid) returns text language sql as $$
  select coalesce(string_agg(message, ' || ' order by message), '-') from league_chat
  where league_id = p_league and is_system and user_id is null and message like 'FieldScout %'
$$;

-- ---------------------------------------------------------------------------
-- K. Refusals
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select alike(pg_temp.err($$ select op_set_game_status('x132-g7b', 'cancelled', gen_random_uuid()) $$), '42501:%', 'K1 anon cannot execute the door');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99132000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is(pg_temp.err($$ select op_set_game_status('x132-g7b', 'cancelled', gen_random_uuid()) $$),
  '42501: set_game_status: only a platform operator can mark a game (M8 TD1)', 'K2 a plain user is refused by name');
select set_config('request.jwt.claims', '{"sub": "99132000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(pg_temp.err($$ select op_set_game_status('x132-g7b', 'cancelled', gen_random_uuid()) $$),
  '42501: set_game_status: only a platform operator can mark a game (M8 TD1)', 'K3 the league''s own commissioner is refused (a platform role, never a league role)');
select pg_temp.as_op();
select is(pg_temp.err($$ select op_set_game_status('x132-g7b', 'postponed', gen_random_uuid()) $$),
  '22023: set_game_status: status must be in_week (moved later this week), out_of_week (moved out of the week), cancelled, or normal (back to normal) — got postponed',
  'K4 a status outside the four is refused by name');
select is(pg_temp.err($$ select op_set_game_status('x132-g7b', 'cancelled', null) $$),
  '22023: set_game_status: p_action_id is required — it makes a retry safe (M8 TD3)', 'K5 a missing action id is refused');
select is(pg_temp.err($$ select op_set_game_status('x132-nope', 'cancelled', gen_random_uuid()) $$),
  'P0002: set_game_status: game x132-nope does not exist', 'K6 an unknown game is refused');
select is(pg_temp.err($$ select op_set_game_status('x132-g7a', 'cancelled', gen_random_uuid()) $$),
  '22023: set_game_status: the BUF @ KC game (week 7) is final — it was played, so it cannot be marked moved or cancelled',
  'K7 a FINAL game cannot be marked (its players'' points are real)');
reset role;
select is(format('%s|%s|%s', pg_temp.receipts(), pg_temp.game('x132-g7a'), pg_temp.game('x132-g7b')),
  '0|final|-|-|f|postponed|-|-|f', 'K8 no refusal wrote a receipt or touched a game');

-- ---------------------------------------------------------------------------
-- M. Moved later this week (week 7)
-- ---------------------------------------------------------------------------
select is(pg_temp.state(7), 'in_week=2 left=0 open=1 all_final=f left_list=-',
  'M1 premise: the provider-postponed game with an in-week kickoff is OPEN — it holds week 7');
select set_config('request.jwt.claims', '', true);
insert into r132 select 'M0', finalize_matchups('2026-10-29 11:05:00+00', null);
select is((select r -> 'skipped' -> 0 ->> 'reason' from r132 where tag = 'M0') || '|' || pg_temp.lw('b1320000-0000-4000-8000-000000000007'),
  'games_not_final|correction_window', 'M2 premise: the normal finalize holds week 7 by name');
select pg_temp.as_op();
insert into r132 select 'M1', op_set_game_status_internal('x132-g7b', 'in_week', 'a1320000-0000-4000-8000-000000000001', null, '2026-10-26 15:00:00+00');
select is(format('%s|%s|%s', (select r ->> 'changed' from r132 where tag = 'M1'), (select r ->> 'leagues_told' from r132 where tag = 'M1'), pg_temp.game('x132-g7b')),
  'true|1|scheduled|in_week|postponed|t', 'M3 in_week: status scheduled, the hold, the provider status kept for switch-back; one league told');
select is(pg_temp.state(7), 'in_week=2 left=0 open=1 all_final=f left_list=-', 'M4 the game is IN the week and open — the week waits (Q100)');
select is(pg_temp.lock('MIA', '2026-10-25 20:01:00+00'), 'f|t',
  'M4b R1546: an in_week game is still his game — its players lock at its kickoff (+1 min: locked)');
select is(format('%s|%s', pg_temp.release(7), coalesce((select r ->> 'players_rescored' from r132 where tag = 'M1'), '?')), 'NULL|0',
  'M4c an in_week mark records no release and re-scores nobody (the week waits; its players still score)');
select set_config('request.jwt.claims', '', true);
insert into r132 select 'M2', finalize_matchups('2026-10-29 11:10:00+00', null);
select is((select r -> 'skipped' -> 0 ->> 'reason' from r132 where tag = 'M2') || '|' || pg_temp.lw('b1320000-0000-4000-8000-000000000007'),
  'games_not_final|correction_window', 'M5 the normal finalize STILL holds week 7 — no operator path finalizes a held week (Q99 (a))');
select pg_temp.as_op();
insert into r132 select 'M3', op_set_game_status_internal('x132-g7b', 'in_week', 'a1320000-0000-4000-8000-000000000001', null, '2026-10-26 16:00:00+00');
insert into r132 select 'M4', op_set_game_status_internal('x132-g7b', 'in_week', 'a1320000-0000-4000-8000-000000000002', null, '2026-10-26 16:00:00+00');
select is(format('%s|%s|%s', (select r ->> 'replayed' from r132 where tag = 'M3'), (select r ->> 'changed' from r132 where tag = 'M4'),
                 (select r ->> 'why' from r132 where tag = 'M4')),
  'true|false|already_marked — the game already carries this mark; nothing was written',
  'M6 a replay returns the receipt; the same mark again is a named no-op');
select is(format('%s|%s', pg_temp.receipts(), (select count(*) from league_chat where league_id = 'b1320000-0000-4000-8000-000000000007' and is_system)),
  '1|1', 'M7 …and neither wrote a receipt or a line (RETURNING-free count of both tables)');
select is(pg_temp.err($$ select op_set_game_status_internal('x132-g18b', 'in_week', 'a1320000-0000-4000-8000-000000000001', null, now()) $$),
  '22023: set_game_status: action id a1320000-0000-4000-8000-000000000001 was already used for a different game or status',
  'M8 an action id reused for another game is refused');
select is(pg_temp.err($$ select op_set_game_status_internal('x132-g7b', 'cancelled', 'a1320000-0000-4000-8000-000000000001', null, now()) $$),
  '22023: set_game_status: action id a1320000-0000-4000-8000-000000000001 was already used for a different game or status',
  'M8b R1549: …and so is the same game with a DIFFERENT mark — a replay must be the same request');
select set_config('request.jwt.claims', '{"sub": "99132000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is(pg_temp.err($$ select op_verb_prelude_internal('set_game_status', null, gen_random_uuid(), null) $$),
  '42501: set_game_status: only a platform operator can use the operator tools (M8 TD1)',
  'M8c R1548: the shared prelude''s refusal is verb-neutral (a plain user reaching it directly)');
select pg_temp.as_op();

-- ---------------------------------------------------------------------------
-- N. Back to normal
-- ---------------------------------------------------------------------------
insert into r132 select 'N1', op_set_game_status_internal('x132-g7b', 'normal', 'a1320000-0000-4000-8000-000000000003', null, '2026-10-26 17:00:00+00');
select is(format('%s|%s', (select r ->> 'status' from r132 where tag = 'N1'), pg_temp.game('x132-g7b')),
  'postponed|postponed|-|-|f', 'N1 normal clears the hold and restores the provider''s status');
select is(pg_temp.state(7), 'in_week=2 left=0 open=1 all_final=f left_list=-', 'N2 the week is held exactly as before the mark');
insert into r132 select 'N2', op_set_game_status_internal('x132-g7b', 'normal', 'a1320000-0000-4000-8000-000000000004', null, '2026-10-26 17:00:00+00');
select is(format('%s|%s|%s', (select r ->> 'changed' from r132 where tag = 'N2'), (select r ->> 'why' from r132 where tag = 'N2'), pg_temp.receipts()),
  'false|not_marked — the game has no operator mark; nothing was written|2', 'N3 normal on an unmarked game is a named no-op (2 receipts so far: M1, N1)');

-- ---------------------------------------------------------------------------
-- C. Cancelled — the normal finalize closes the week
-- ---------------------------------------------------------------------------
insert into r132 select 'C1', op_set_game_status_internal('x132-g7b', 'cancelled', 'a1320000-0000-4000-8000-000000000005', 'Hurricane — NFL cancelled the game', '2026-10-27 15:00:00+00');
select is(pg_temp.game('x132-g7b'), 'postponed|cancelled|postponed|t', 'C1 cancelled: status postponed (E43''s vocabulary) + the hold');
select is(pg_temp.lock('MIA', '2026-10-25 20:01:00+00'), 't|f',
  'C1b R1546: a cancelled game is not his game this week — at its old kickoff + 1 min his players are NOT locked (no game: the bye arm)');
select is(pg_temp.lock('NYJ', '2026-10-25 20:01:00+00'), 't|f', 'C1c …the other side too');
select is(
  format('%s|%s', (select r ->> 'players_rescored' from r132 where tag = 'C1'),
         (select string_agg(f.player_id || '@' || to_char(f.enqueued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), ',')
          from score_fanout f where f.season = 2026 and f.week = 7)),
  '1|x132-mia@2026-10-25T23:00Z',
  'C1d R1547: the player with a line on the cancelled game is re-queued (matched by team — a NULL game_id), stamped at his line (ready at once)');
select is(format('%s|%s', pg_temp.release(7), (select r ->> 'release_recorded_at' from r132 where tag = 'C1')),
  '2026-10-27T15:00Z|2026-10-27T15:00:00+00:00',
  'C1e the stuck week: the mark left every in-week game final with no release recorded, so it records one — the LATER of now and the Tuesday floor (07:00Z)');
select is(pg_temp.state(7), 'in_week=1 left=1 open=0 all_final=t left_list=NYJ @ MIA',
  'C2 the cancelled game has LEFT week 7 — though its kickoff never moved');
select set_config('request.jwt.claims', '', true);
insert into r132 select 'C2', finalize_matchups('2026-10-29 11:15:00+00', null);
select is(format('%s|%s', (select r ->> 'finalized' from r132 where tag = 'C2'), pg_temp.lw('b1320000-0000-4000-8000-000000000007')),
  '1|final', 'C3 the NORMAL finalize (the cron path — no operator verb) closes week 7');
select is(
  (select string_agg(format('%s:%s:%s:%s', right(t.name, 2), r.points, r.h2h_result, r.is_final), ' ' order by t.name)
   from team_week_results r join teams t on t.id = r.team_id where r.league_id = 'b1320000-0000-4000-8000-000000000007'),
  '7A:101.50:win:t 7B:88.25:loss:t', 'C4 the results are written from the scores (stored literals)');
select is(
  (select string_agg(format('%s:%s-%s', e ->> 'name', e ->> 'wins', e ->> 'losses'), ' ' order by e ->> 'name')
   from jsonb_array_elements(league_standings_internal('b1320000-0000-4000-8000-000000000007', false) -> 'standings') e),
  'X132 7A:1-0 X132 7B:0-1', 'C5 standings follow through the existing chain');
select pg_temp.as_op();
select is(pg_temp.err($$ select op_set_game_status_internal('x132-g7b', 'normal', gen_random_uuid(), null, now()) $$),
  '22023: set_game_status: week 7 of 2026 is already final in 1 league(s) — a final week never changes (§23.4), so the NYJ @ MIA game (week 7) cannot be re-marked',
  'C6 once a league made the week final, the game can never be switched back');
select is((select r ->> 'leagues_told' from r132 where tag = 'C1'), '1', 'C7 the cancel told the one league still playing week 7');

-- ---------------------------------------------------------------------------
-- E. Week 18 — moved out of the week (F243: no later calendar row)
-- ---------------------------------------------------------------------------
select is(pg_temp.state(18), 'in_week=2 left=0 open=1 all_final=f left_list=-',
  'E1 premise: in week 18 even a POSTPONED game can never leave by kickoff — it holds the week (the F243 trap)');
select is((commish_matchup_edit_lock_internal('b1320000-0000-4000-8000-000000000018', 'e1320000-0000-4000-8000-000000000018') ->> 'week_games_over'),
  'false', 'E2 premise: the correction lock''s (A) agrees — week 18''s games are not over');
insert into r132 select 'E1', op_set_game_status_internal('x132-g18b', 'out_of_week', 'a1320000-0000-4000-8000-000000000006', null, '2027-01-12 03:00:00+00');
select is(pg_temp.game('x132-g18b'), 'postponed|out_of_week|postponed|t', 'E3 out_of_week: the hold');
select is(pg_temp.state(18), 'in_week=1 left=1 open=0 all_final=t left_list=SF @ SEA', 'E4 the marked game has LEFT week 18');
select is((commish_matchup_edit_lock_internal('b1320000-0000-4000-8000-000000000018', 'e1320000-0000-4000-8000-000000000018') ->> 'week_games_over'),
  'true', 'E5 …and the correction lock''s (A) reads week 18''s games over');
select is((select to_char(w.last_game_ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') from nfl_weeks w where w.season = 2026 and w.week = 18),
  '2027-01-12T08:00Z', 'E5b the stuck week, marked BEFORE the floor: the release recorded is the floor (Tue 00:00 PST), never earlier (Q50)');
select set_config('request.jwt.claims', '', true);
insert into r132 select 'E1a', league_week_advance('2027-01-12 07:59:59+00', 'b1320000-0000-4000-8000-000000000018');
select is(pg_temp.lw('b1320000-0000-4000-8000-000000000018'), 'live', 'E5c one second before the release the NORMAL advance leaves week 18 live');
insert into r132 select 'E1b', league_week_advance('2027-01-12 08:00:00+00', 'b1320000-0000-4000-8000-000000000018');
select is(pg_temp.lw('b1320000-0000-4000-8000-000000000018'), 'correction_window', 'E5d …at the release it moves week 18 to its correction window — no operator verb');
insert into r132 select 'E2', finalize_matchups('2027-01-14 12:00:00+00', null);
select is(format('%s|%s', (select r ->> 'finalized' from r132 where tag = 'E2'), pg_temp.lw('b1320000-0000-4000-8000-000000000018')),
  '1|final', 'E6 the normal finalize closes week 18');
select is(
  (select string_agg(format('%s:%s:%s', right(t.name, 3), r.points, r.h2h_result), ' ' order by t.name)
   from team_week_results r join teams t on t.id = r.team_id where r.league_id = 'b1320000-0000-4000-8000-000000000018'),
  '18A:70.00:loss 18B:92.10:win', 'E7 week 18''s results (stored literals)');

-- ---------------------------------------------------------------------------
-- R. The trail
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s->%s', a.verb, a.scope, coalesce(a.league_id::text, 'null'),
                            a.before ->> 'operator_hold', a.after ->> 'operator_hold'), ' ' order by a.created_at, a.action_id)
   from platform_operator_actions a where a.actor_id = '99132000-0000-4000-8000-000000000004'),
  'set_game_status:platform:null:->in_week set_game_status:platform:null:in_week-> set_game_status:platform:null:->cancelled set_game_status:platform:null:->out_of_week',
  'R1 exactly four receipts — one per change, none per no-op, platform-scoped (an NFL edit)');
select is((select reason from platform_operator_actions where action_id = 'a1320000-0000-4000-8000-000000000005'),
  'Hurricane — NFL cancelled the game', 'R2 the optional reason is kept');
select is(pg_temp.lines('b1320000-0000-4000-8000-000000000007'),
  'FieldScout marked the NYJ @ MIA game (week 7) as cancelled. Its players score 0 this week and the week finishes without it. || FieldScout marked the NYJ @ MIA game (week 7) as moved later this week. The week waits for it before it finishes. || FieldScout marked the NYJ @ MIA game (week 7) back to normal. It counts in its week as usual.',
  'R3 league 7 read three plain FieldScout lines (one per change; sorted by text — one transaction, one created_at)');
select is(pg_temp.lines('b1320000-0000-4000-8000-000000000018'),
  'FieldScout marked the SF @ SEA game (week 18) as moved out of the week. Its players score 0 this week and the week finishes without it.',
  'R4 league 18 read one — a league not playing the marked week hears nothing');
select is((select count(*)::int from league_chat where message like '%x132_user%'), 0, 'R5 no line names the operator');
select is(pg_temp.err($$ update platform_operator_actions set reason = 'x' where action_id = 'a1320000-0000-4000-8000-000000000005' $$)::text like 'P0001:%'
          or pg_temp.err($$ update platform_operator_actions set reason = 'x' where action_id = 'a1320000-0000-4000-8000-000000000005' $$)::text like '42501:%', true,
  'R6 the receipts are immutable (182''s trigger)');

-- ---------------------------------------------------------------------------
-- U. R1552 / R1554 — week 9 (no league plays it: no lines, no receipts above)
-- ---------------------------------------------------------------------------
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('x132-g9a', 2026, 9, 'GB',  'CHI', '2026-11-08 18:00:00+00', 'final'),
 ('x132-g9b', 2026, 9, 'DEN', 'LV',  '2026-11-08 21:05:00+00', 'scheduled');
insert into players (id, full_name, position, team, status) values ('x132-den', 'X132 Den', 'RB', 'DEN', 'Active');
insert into player_stats (player_id, season, week, stat_type, updated_at, rush_yards)
values ('x132-den', 2026, 9, 'weekly', '2026-11-08 23:00:00.000005+00', 40);
-- A drain has CLAIMED his row (in flight, scoring the line before the mark).
insert into score_fanout (season, week, player_id, enqueued_at, claim_token, claimed_at)
values (2026, 9, 'x132-den', '2026-11-08 23:00:00.000005+00', gen_random_uuid(), '2026-11-09 01:00:00+00');
select pg_temp.as_op();
insert into r132 select 'U1', op_set_game_status_internal('x132-g9b', 'cancelled', 'a1320000-0000-4000-8000-000000000091', null, '2026-11-09 02:00:00+00');
select is(
  (select to_char(f.enqueued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') from score_fanout f where f.season = 2026 and f.week = 9 and f.player_id = 'x132-den'),
  '2026-11-08T23:00:00.000004',
  'U1 R1554: the CLAIMED row moves 1µs earlier — the in-flight drain''s (token, stamp) ack misses and the next drain re-scores it (still ready: line ≥ stamp)');
select is(format('%s|%s', pg_temp.release(9), (select r ->> 'release_recorded_at' from r132 where tag = 'U1')),
  '2026-11-10T08:00Z|2026-11-10T08:00:00+00:00', 'U2 the mark recorded week 9''s release at its Tuesday floor (PST)');
insert into r132 select 'U2', op_set_game_status_internal('x132-g9b', 'normal', 'a1320000-0000-4000-8000-000000000092', null, '2026-11-09 03:00:00+00');
select is(format('%s|%s|%s', pg_temp.release(9), (select r ->> 'release_taken_back' from r132 where tag = 'U2'), pg_temp.game('x132-g9b')),
  'NULL|true|scheduled|-|-|f',
  'U3 R1552: switched back, the game is open again — the release THIS mark recorded is taken back (the week is not over)');
-- A stamp the mark did NOT write (ingestion's) is never taken back.
update nfl_weeks set last_game_ends_at = '2026-11-10 09:00:00+00' where season = 2026 and week = 9;
insert into r132 select 'U3', op_set_game_status_internal('x132-g9b', 'cancelled', 'a1320000-0000-4000-8000-000000000093', null, '2026-11-09 04:00:00+00');
insert into r132 select 'U4', op_set_game_status_internal('x132-g9b', 'normal', 'a1320000-0000-4000-8000-000000000094', null, '2026-11-09 05:00:00+00');
select is(format('%s|%s|%s', pg_temp.release(9), coalesce((select r ->> 'release_recorded_at' from r132 where tag = 'U3'), 'none'), (select r ->> 'release_taken_back' from r132 where tag = 'U4')),
  '2026-11-10T09:00Z|none|false',
  'U4 …a release the mark did not record stays where it is (recorded none; took none back)');
select is((select count(*)::int from platform_operator_actions where action_id::text like 'a1320000-0000-4000-8000-00000000009%'), 4,
  'U5 four changes, four receipts');

select * from finish();
rollback;
