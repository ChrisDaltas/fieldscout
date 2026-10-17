-- ============================================================================
-- 142 — M8 follow-up batch A (migration 194; PROGRESS D524; F600 / F593 /
--       F589; spec §24.4 "Game status" / "Live-state view", §23.4, §11.2)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — player_stats.team (text, nullable); the two replaced bodies
--       at 194's md5s; D137 — with 194's three hunks reversed each is its
--       only definer's FILE TEXT (184:654-829, 186:236-287); internals
--       plain / closed, doors unchanged.
--   §B  F593 — mark B cancelled, then C (C records the release), then clear
--       B: the release is taken back and C forgets it (184 left the week
--       released over a re-opened game); re-cancel B re-records; the other
--       order (clear the non-owner C) takes B's back; ingestion's stamp is
--       never touched (control).
--   §C  F589 — a zeroing mark re-queues the players whose LINE was played
--       for that team (traded out, released), not the one traded in after
--       playing elsewhere; a line with no stored team falls back to his
--       current team.
--   §D  F600 — op_platform_state's overdue_weeks: a live week at / past its
--       Wednesday ceiling that a game still holds (boundary instants:
--       ceiling − 1 s, the ceiling, eight days on); a live week nothing
--       holds is not listed; the door returns the key.
-- Break probes (§4.3, shown in the PR, reverted): 184's take-back condition
-- ⇒ A2 B3 B4 B5 red; 184's p.team re-queue ⇒ A2 C1 C2 red.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

create function pg_temp.un194(p_src text) returns text language sql as $un194$
  select replace(replace(replace(replace(p_src, $h$  -- Matched by game_id, or — a NULL game_id line (F468(a)) — by the team
  -- the LINE was played for (194, F589), else (no stored team) his current team.$h$, $h$  -- Matched by game_id, or — a NULL game_id line (F468(a)) — by his team.$h$), $h$           OR (ps.game_id IS NULL AND COALESCE(ps.team, p.team) IN (v_g.home_team, v_g.away_team)))$h$, $h$           OR (ps.game_id IS NULL AND p.team IN (v_g.home_team, v_g.away_team)))$h$), $h$  -- R1552 / F593 (194): clearing (or softening to in_week) a zeroing mark
  -- that leaves the week NOT all-final takes back a release a MARK recorded
  -- — this game's, or (F593: mark B, mark C — C records — clear B) any
  -- other zeroing-marked game's of the week — and never one ingestion wrote.
  -- The games that recorded that release forget it (it is no longer the week's).
  IF v_wk.season IS NOT NULL AND v_g.operator_hold IN ('out_of_week', 'cancelled')
     AND v_hold IS DISTINCT FROM 'out_of_week' AND v_hold IS DISTINCT FROM 'cancelled' THEN
    SELECT * INTO v_state FROM public.week_games_state_internal(v_g.season, v_g.week);
    IF NOT v_state.all_final AND v_wk.last_game_ends_at IS NOT NULL
       AND (v_wk.last_game_ends_at IS NOT DISTINCT FROM v_g.operator_release_at
            OR EXISTS (SELECT 1 FROM public.nfl_games o
                       WHERE o.season = v_g.season AND o.week = v_g.week AND o.id <> p_game_id
                         AND o.operator_hold IN ('out_of_week', 'cancelled')
                         AND o.operator_release_at = v_wk.last_game_ends_at)) THEN
      UPDATE public.nfl_weeks SET last_game_ends_at = NULL
      WHERE season = v_g.season AND week = v_g.week;
      UPDATE public.nfl_games SET operator_release_at = NULL
      WHERE season = v_g.season AND week = v_g.week AND operator_release_at = v_wk.last_game_ends_at;
      v_unstamped := TRUE;
    END IF;
  END IF;$h$, $h$  -- R1552: clearing (or softening to in_week) a zeroing mark that leaves the
  -- week NOT all-final takes back the release THIS mark recorded — and only
  -- that one (a stamp ingestion wrote, or another mark's, is never touched).
  IF v_wk.season IS NOT NULL AND v_g.operator_hold IN ('out_of_week', 'cancelled')
     AND v_hold IS DISTINCT FROM 'out_of_week' AND v_hold IS DISTINCT FROM 'cancelled' THEN
    SELECT * INTO v_state FROM public.week_games_state_internal(v_g.season, v_g.week);
    IF NOT v_state.all_final AND v_g.operator_release_at IS NOT NULL
       AND v_wk.last_game_ends_at IS NOT DISTINCT FROM v_g.operator_release_at THEN
      UPDATE public.nfl_weeks SET last_game_ends_at = NULL
      WHERE season = v_g.season AND week = v_g.week;
      v_unstamped := TRUE;
    END IF;
  END IF;$h$), $h$    'games_limit', 200,
    -- F600 (194): a live week at or past its Wednesday release ceiling (153)
    -- that games still hold — "stuck past Wednesday". Bounded by live weeks.
    'overdue_weeks', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'season', o.season, 'week', o.week, 'ceiling_at', o.ceiling_at,
                         'hours_past_ceiling', floor(extract(epoch FROM (p_at - o.ceiling_at)) / 3600)::int,
                         'holding_games', o.holding) ORDER BY o.season, o.week), '[]'::jsonb)
                      FROM (SELECT lw.season, lw.week,
                                   public.week_release_ceiling_internal(nw.starts_at) AS ceiling_at,
                                   (SELECT jsonb_agg(gg.g ->> 'matchup' ORDER BY gg.g ->> 'kickoff_at')
                                    FROM games gg WHERE gg.season = lw.season AND gg.week = lw.week
                                      AND (gg.g ->> 'holds_week')::boolean) AS holding
                            FROM live_weeks lw
                            JOIN public.nfl_weeks nw ON nw.season = lw.season AND nw.week = lw.week) o
                      WHERE p_at >= o.ceiling_at AND o.holding IS NOT NULL),
$h$, $h$    'games_limit', 200,
$h$)
$un194$;

select is(
  (select format('%s:%s', data_type, is_nullable) from information_schema.columns
   where table_schema = 'public' and table_name = 'player_stats' and column_name = 'team'),
  'text:YES', 'A1 F589: player_stats.team exists, text, nullable (NULL = the line''s team is not known)');
select is(
  (select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_set_game_status_internal', 'op_platform_state_internal')),
  'op_platform_state_internal=7b5fb6e5d19475fe8b4008be2c1bc31d op_set_game_status_internal=1a1b1eaae23e6e6dc32757d661b21263',
  'A2 the two replaced bodies'' live prosrc md5s — 194 as written (stored literals)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un194(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_set_game_status_internal', 'op_platform_state_internal')),
  'op_platform_state_internal=f48937abfb7f54bd6fdb790e6e97477f op_set_game_status_internal=3b185e440c0281d9af35e685e68f09eb',
  'A3 D137: with 194''s three hunks reversed each body is its only definer''s FILE TEXT (184:654-829, 186:236-287 — md5 of the file text)');
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_set_game_status_internal', 'op_platform_state_internal',
     'op_set_game_status', 'op_platform_state')),
  'op_platform_state=t:search_path="":f:t op_platform_state_internal=f:search_path="":f:f op_set_game_status=t:search_path="":f:t op_set_game_status_internal=f:search_path="":f:f',
  'A4 the internals stay PLAIN, search_path '''', closed to anon / authenticated; the doors (unchanged) DEFINER + authenticated');

-- ---------------------------------------------------------------------------
-- World
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99142000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x142-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'x142_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;
update profiles set is_admin = true where id = '99142000-0000-4000-8000-000000000002';
create temp table r142 (tag text primary key, r jsonb);
grant all on r142 to anon, authenticated, service_role;
create or replace function pg_temp.as_op() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "99142000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
$$;
create or replace function pg_temp.release(p_week int) returns text language sql as $$
  select coalesce(to_char(w.last_game_ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), 'NULL') from nfl_weeks w where w.season = 2026 and w.week = p_week
$$;
create or replace function pg_temp.rel_at(p_id text) returns text language sql as $$
  select coalesce(to_char(g.operator_release_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), 'NULL') from nfl_games g where g.id = p_id
$$;
select pg_temp.as_op();

-- ---------------------------------------------------------------------------
-- B. F593 — week 14: mark B, then C (C records the release), then clear B
-- ---------------------------------------------------------------------------
delete from nfl_games where season = 2026 and week in (14, 15);
update nfl_weeks set last_game_ends_at = null where season = 2026 and week in (14, 15);
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('x142-a', 2026, 14, 'GB',  'CHI', '2026-12-13 18:00:00+00', 'final'),
 ('x142-b', 2026, 14, 'DEN', 'LV',  '2026-12-13 21:05:00+00', 'scheduled'),
 ('x142-c', 2026, 14, 'SEA', 'SF',  '2026-12-14 01:20:00+00', 'scheduled');
insert into r142 select 'B1', op_set_game_status_internal('x142-b', 'cancelled', 'a1420000-0000-4000-8000-000000000001', null, '2026-12-14 02:00:00+00');
select is(format('%s|%s|%s', pg_temp.release(14), coalesce((select r ->> 'release_recorded_at' from r142 where tag = 'B1'), 'none'), pg_temp.rel_at('x142-b')),
  'NULL|none|NULL', 'B1 B cancelled while C is still to play: the week is not over — nothing recorded');
insert into r142 select 'B2', op_set_game_status_internal('x142-c', 'cancelled', 'a1420000-0000-4000-8000-000000000002', null, '2026-12-14 03:00:00+00');
select is(format('%s|%s|%s', pg_temp.release(14), pg_temp.rel_at('x142-c'), pg_temp.rel_at('x142-b')),
  '2026-12-15T08:00Z|2026-12-15T08:00Z|NULL', 'B2 C cancelled: every in-week game final — C records the release at the Tuesday floor (C owns the stamp, not B)');
insert into r142 select 'B3', op_set_game_status_internal('x142-b', 'normal', 'a1420000-0000-4000-8000-000000000003', null, '2026-12-14 04:00:00+00');
select is(format('%s|%s|%s', pg_temp.release(14), (select r ->> 'release_taken_back' from r142 where tag = 'B3'),
                 (select s.all_final from week_games_state_internal(2026, 14) s)),
  'NULL|true|f', 'B3 F593: B cleared — B is open again, so C''s release is taken back (184 left the week released over B)');
select is(pg_temp.rel_at('x142-c'), 'NULL', 'B4 …and C forgets it (it is no longer the week''s release)');
insert into r142 select 'B5', op_set_game_status_internal('x142-b', 'cancelled', 'a1420000-0000-4000-8000-000000000005', null, '2026-12-16 09:00:00+00');
select is(format('%s|%s', pg_temp.release(14), pg_temp.rel_at('x142-b')),
  '2026-12-16T09:00Z|2026-12-16T09:00Z', 'B5 B re-cancelled after the floor: every game final again — B records the release at now (the week can close)');
insert into r142 select 'B6', op_set_game_status_internal('x142-c', 'normal', 'a1420000-0000-4000-8000-000000000006', null, '2026-12-16 10:00:00+00');
select is(format('%s|%s|%s', pg_temp.release(14), (select r ->> 'release_taken_back' from r142 where tag = 'B6'), pg_temp.rel_at('x142-b')),
  'NULL|true|NULL', 'B6 the other order: C (not the owner) cleared — B''s release is taken back too');
-- A stamp INGESTION wrote is never taken back, whichever mark is cleared.
update nfl_weeks set last_game_ends_at = '2026-12-16 11:00:00+00' where season = 2026 and week = 14;
insert into r142 select 'B7a', op_set_game_status_internal('x142-c', 'cancelled', 'a1420000-0000-4000-8000-000000000007', null, '2026-12-16 12:00:00+00');
insert into r142 select 'B7', op_set_game_status_internal('x142-b', 'normal', 'a1420000-0000-4000-8000-000000000008', null, '2026-12-16 13:00:00+00');
select is(format('%s|%s|%s', pg_temp.release(14), coalesce((select r ->> 'release_recorded_at' from r142 where tag = 'B7a'), 'none'),
                 (select r ->> 'release_taken_back' from r142 where tag = 'B7')),
  '2026-12-16T11:00Z|none|false', 'B7 control: ingestion''s stamp stays (C recorded none; clearing B took none back)');

-- ---------------------------------------------------------------------------
-- C. F589 — week 15: the re-queue reads the team the LINE was played for
-- ---------------------------------------------------------------------------
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('x142-kc',  2026, 15, 'KC',  'BUF', '2026-12-20 18:00:00+00', 'scheduled'),
 ('x142-mia', 2026, 15, 'MIA', 'NYJ', '2026-12-20 18:00:00+00', 'final');
insert into players (id, full_name, position, team, status) values
 ('x142-trd', 'X142 Traded Out', 'WR', 'MIA', 'Active'),   -- played for KC, then traded to MIA
 ('x142-rel', 'X142 Released',   'WR', null,  'Active'),   -- played for KC, then released
 ('x142-new', 'X142 Traded In',  'WR', 'KC',  'Active'),   -- played for MIA, then traded to KC
 ('x142-leg', 'X142 Legacy',     'WR', 'KC',  'Active'),   -- a pre-194 line: no stored team
 ('x142-oth', 'X142 Other',      'WR', 'NYJ', 'Active');   -- played for NYJ, unmoved
insert into player_stats (player_id, season, week, stat_type, updated_at, receiving_yards, team) values
 ('x142-trd', 2026, 15, 'weekly', '2026-12-20 22:00:00+00', 50, 'KC'),
 ('x142-rel', 2026, 15, 'weekly', '2026-12-20 22:00:00+00', 50, 'KC'),
 ('x142-new', 2026, 15, 'weekly', '2026-12-20 22:00:00+00', 50, 'MIA'),
 ('x142-leg', 2026, 15, 'weekly', '2026-12-20 22:00:00+00', 50, null),
 ('x142-oth', 2026, 15, 'weekly', '2026-12-20 22:00:00+00', 50, 'NYJ');
delete from score_fanout where season = 2026 and week = 15;
insert into r142 select 'C', op_set_game_status_internal('x142-kc', 'cancelled', 'a1420000-0000-4000-8000-000000000009', null, '2026-12-21 02:00:00+00');
select is(
  (select string_agg(f.player_id, ' ' order by f.player_id) from score_fanout f where f.season = 2026 and f.week = 15),
  'x142-leg x142-rel x142-trd',
  'C1 F589: KC cancelled re-queues the players whose LINE is KC''s — traded out and released included; the one traded IN after playing for MIA is not; a pre-194 line falls back to his current team (184: x142-leg x142-new)');
select is((select (r ->> 'players_rescored')::int from r142 where tag = 'C'), 3, 'C2 the receipt counts the three re-queued players');

-- ---------------------------------------------------------------------------
-- D. F600 — a live week held past its Wednesday ceiling (2097 week 5)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into nfl_weeks (season, week, starts_at) values
  (2097, 5, '2097-10-09 04:00+00'), (2097, 6, '2097-10-16 04:00+00');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status, operator_hold, operator_hold_at, operator_hold_prior_status) values
  ('x142-d1', 2097, 5, 'KC',  'BUF', '2097-10-11 17:00+00', 'scheduled', null, null, null),          -- still to play: holds
  ('x142-d2', 2097, 5, 'DAL', 'NYG', '2097-10-11 17:00+00', 'final',     null, null, null),
  ('x142-d3', 2097, 5, 'NE',  'TEN', '2097-10-11 17:00+00', 'postponed', 'cancelled', '2097-10-12 00:00+00', 'scheduled'),  -- marked: not holding
  ('x142-d4', 2097, 6, 'SF',  'LAR', '2097-10-18 17:00+00', 'final',     null, null, null);
insert into leagues (id, owner_id, name, season, status, team_count, settings, roster_settings)
values ('b1420000-0000-4000-8000-000000000001', '99142000-0000-4000-8000-000000000001', 'pgtap-x142-L', 2097, 'setup', 8, '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}');
insert into league_weeks (league_id, season, week, status) values
 ('b1420000-0000-4000-8000-000000000001', 2097, 5, 'live'),
 ('b1420000-0000-4000-8000-000000000001', 2097, 6, 'live');
create or replace function pg_temp.overdue(p_at timestamptz) returns jsonb language sql as $$
  select coalesce(jsonb_agg(e order by (e ->> 'week')::int), '[]'::jsonb)
  from jsonb_array_elements(op_platform_state_internal(p_at) -> 'overdue_weeks') e where (e ->> 'season')::int = 2097
$$;
select is(pg_temp.overdue('2097-10-16 06:59:59+00'), '[]'::jsonb,
  'D1 a second before week 5''s ceiling (Wednesday 00:00 Pacific = 07:00Z): not overdue');
select is(pg_temp.overdue('2097-10-16 07:00:00+00'),
  '[{"week": 5, "season": 2097, "ceiling_at": "2097-10-16T07:00:00+00:00", "holding_games": ["BUF @ KC"], "hours_past_ceiling": 0}]'::jsonb,
  'D2 AT the ceiling: week 5 is stuck past Wednesday, held by the game still to play (the final and the cancelled game do not hold it)');
select is(pg_temp.overdue('2097-10-24 10:00:00+00'),
  '[{"week": 5, "season": 2097, "ceiling_at": "2097-10-16T07:00:00+00:00", "holding_games": ["BUF @ KC"], "hours_past_ceiling": 195}]'::jsonb,
  'D3 eight days on: 195 hours past; week 6 (past its own ceiling, every game final) is not listed — nothing holds it');
select pg_temp.as_op();
select ok(op_platform_state() ? 'overdue_weeks', 'D4 the operator reads overdue_weeks through the unchanged door');

select * from finish();
rollback;
