-- ============================================================================
-- 129 — every rostered player is in the lock view (migration 181; the live
--       bug of 2026-10-05; PROGRESS D496)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM and D137 — the tick is still the one SECURITY DEFINER body,
--       search_path '', closed to anon / authenticated; its live prosrc md5
--       is a stored literal; with 181's one hunk removed (pg_temp.un181) it
--       is 157's FILE TEXT (the literal 105 A5 / 113 A7 / 114 A6 pin).
--   §B  THE BUG, REPRODUCED — a DRAFTED player (a league_rosters row and no
--       pool row, exactly as 072's draft leaves him) whose game has kicked
--       off: before 181 the tick never judged him (no row ⇒ the rosters
--       route reads `unlocked`), while the lock every writer enforces
--       (157's pool_game_lock_player_internal) says LOCKED. After 181 the
--       view and the enforcement agree for EVERY rostered player, at the
--       kickoff boundary (−1 s / AT) of both games and on a bye.
--   §C  NOTHING ELSE MOVES — an existing pool row of any state keeps its
--       state and waivers_until; an unowned player still gets no row.
-- Break probe (§4.3): delete 181's INSERT from the tick ⇒ B2–B8 red
-- (shown in the PR, reverted).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

-- pg_temp.un181 — migration 181's one hunk removed; an identity on every
-- other body.
create function pg_temp.un181(p_src text) returns text language sql as $un181$
  select replace(p_src, $h$        -- 181 (D496): every ROSTERED player has a pool row before the view
        -- runs. A drafted player never passed through the pool (072's draft
        -- writes league_rosters only; pool rows are lazy, D294), so the view
        -- below never judged him and My Team showed him unlocked while
        -- set_lineup refused him. The row is the D294 mirror's own shape
        -- ('rostered'); an existing row of any state is left alone.
        INSERT INTO public.league_player_pool (league_id, player_id, state, updated_at)
        SELECT r.league_id, r.player_id, 'rostered', p_now
        FROM public.league_rosters r
        WHERE r.league_id = v_lg.id
        ON CONFLICT (league_id, player_id) DO NOTHING;

$h$, '')
$un181$;

-- ---------------------------------------------------------------------------
-- §A FORM
-- ---------------------------------------------------------------------------
select is(
  (select format('%s:%s:%s:%s:%s', count(*), bool_and(p.prosecdef), max(array_to_string(p.proconfig, ',')),
                 bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  '1:t:search_path="":f:f',
  'A1 the tick: one overload, SECURITY DEFINER, search_path empty, closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname = 'lineup_lock_tick' and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'A2 PUBLIC holds no EXECUTE on the tick (REVOKE restated)');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'e20a3e92283c5daeb3741665726d29ca',
  'A3 the live tick md5 — 181 as written (stored literal)');
select is(
  (select md5(pg_temp.un181(p.prosrc)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'bcc10f9a40e99f7a1cf83e1c94f813f0',
  'A4 D137: with 181''s hunk removed the tick is 157:3238-3718''s FILE TEXT (the literal 105 A5 pins)');

-- ---------------------------------------------------------------------------
-- FIXTURE — week 6 of 2026: PA @ PZ Thu 10-16 00:15Z, PB @ PY Sun 10-18
-- 17:00Z, PC on bye; the week's last game recorded ending 10-20 03:30Z.
-- Every other week carries a dummy game (no week falls to the no-game-rows
-- datum, which locks everyone).
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 5 then w.starts_at + interval '6 days'
                             when w.week = 6 then '2026-10-20 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'rl-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 14 and w.week <> 6;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('rl-g6a', 2026, 6, 'PZ', 'PA', '2026-10-16 00:15:00+00'), ('rl-g6b', 2026, 6, 'PY', 'PB', '2026-10-18 17:00:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91810000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-rl' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'rl_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings)
values ('b1810000-0000-4000-8000-000000000001', '91810000-0000-4000-8000-000000000001', 'pgtap-rl', 2026, 'in_season', 12, 14, 0, 15,
        (select id from scoring_systems where is_template and name = 'ESPN Standard'),
        (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
        'per_player_kickoff', 'none_fcfs', 100, 'none', '{}'::jsonb,
        '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 2}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb);

insert into teams (id, owner_id, name, league_id, status) values
 ('c1810000-0000-4000-8000-000000000001', '91810000-0000-4000-8000-000000000001', 'RL One', 'b1810000-0000-4000-8000-000000000001', 'active'),
 ('c1810000-0000-4000-8000-000000000002', '91810000-0000-4000-8000-000000000002', 'RL Two', 'b1810000-0000-4000-8000-000000000001', 'active');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '91810000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c1810000-%';

insert into league_weeks (league_id, season, week)
select 'b1810000-0000-4000-8000-000000000001', 2026, w from generate_series(1, 14) w;
update league_weeks set status = 'live'              where league_id = 'b1810000-0000-4000-8000-000000000001' and week <= 6;
update league_weeks set status = 'correction_window' where league_id = 'b1810000-0000-4000-8000-000000000001' and week <= 5;
update league_weeks set status = 'final'             where league_id = 'b1810000-0000-4000-8000-000000000001' and week <= 5;

insert into drafts (league_id, status, completed_at, draft_order)
values ('b1810000-0000-4000-8000-000000000001', 'complete', '2026-09-06 06:00:00+00',
        '["c1810000-0000-4000-8000-000000000001", "c1810000-0000-4000-8000-000000000002"]'::jsonb);

insert into players (id, full_name, position, team, status, adp) values
 ('rl-d-thu', 'RL Drafted Thu', 'QB', 'PA', 'Active', 100),
 ('rl-d-sun', 'RL Drafted Sun', 'QB', 'PB', 'Active', 100),
 ('rl-d-bye', 'RL Drafted Bye', 'QB', 'PC', 'Active', 100),
 ('rl-o-thu', 'RL Other Drafted Thu', 'QB', 'PZ', 'Active', 100),
 ('rl-f-sun', 'RL Picked Up Sun', 'QB', 'PY', 'Active', 100),
 ('rl-w-thu', 'RL Waivers Thu', 'QB', 'PA', 'Active', 100),
 ('rl-u-sun', 'RL Unowned Sun', 'QB', 'PB', 'Active', 100);

-- The draft's shape (072): roster rows, NO pool rows. One free-agent pickup
-- carries the row 113's add leaves ('rostered'); one unowned player sits on
-- waivers; one unowned player has no row at all.
insert into league_rosters (league_id, team_id, player_id, slot_key, acquisition_type) values
 ('b1810000-0000-4000-8000-000000000001', 'c1810000-0000-4000-8000-000000000001', 'rl-d-thu', 'bn', 'draft'),
 ('b1810000-0000-4000-8000-000000000001', 'c1810000-0000-4000-8000-000000000001', 'rl-d-sun', 'bn', 'draft'),
 ('b1810000-0000-4000-8000-000000000001', 'c1810000-0000-4000-8000-000000000001', 'rl-d-bye', 'bn', 'draft'),
 ('b1810000-0000-4000-8000-000000000001', 'c1810000-0000-4000-8000-000000000002', 'rl-o-thu', 'bn', 'draft'),
 ('b1810000-0000-4000-8000-000000000001', 'c1810000-0000-4000-8000-000000000002', 'rl-f-sun', 'bn', 'free_agent');
insert into league_player_pool (league_id, player_id, state, waivers_until) values
 ('b1810000-0000-4000-8000-000000000001', 'rl-f-sun', 'rostered', null),
 ('b1810000-0000-4000-8000-000000000001', 'rl-w-thu', 'on_waivers', '2026-10-21 16:00:00+00');

-- The lock as the rosters route shows it (`gameLockView`: no row / NULL ⇒
-- unlocked), per rostered player, beside the lock every writer enforces.
create function pg_temp.lg() returns uuid language sql as $$ select 'b1810000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.view_at() returns text language sql as $$
  select string_agg(r.player_id || '=' || coalesce(pp.locked_until::text, 'unlocked'), ' ' order by r.player_id)
  from league_rosters r
  left join league_player_pool pp on pp.league_id = r.league_id and pp.player_id = r.player_id
  where r.league_id = pg_temp.lg()
$$;
create function pg_temp.enforced_at(p_at timestamptz) returns text language sql as $$
  select string_agg(r.player_id || '=' || case when (public.pool_game_lock_player_internal(r.league_id, 2026, 6, r.player_id, p_at) ->> 'locked')::boolean
                                          then coalesce(public.pool_game_lock_player_internal(r.league_id, 2026, 6, r.player_id, p_at) ->> 'window_ends_at', 'infinity')::timestamptz::text
                                          else 'unlocked' end, ' ' order by r.player_id)
  from league_rosters r where r.league_id = pg_temp.lg()
$$;

-- ---------------------------------------------------------------------------
-- §B THE BUG, REPRODUCED AND CLOSED
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from league_rosters r
   where r.league_id = pg_temp.lg()
     and not exists (select 1 from league_player_pool pp where pp.league_id = r.league_id and pp.player_id = r.player_id)),
  4,
  'B1 precondition: the four drafted players have no pool row (the live league: 188 of 193)');

-- Thursday kickoff − 1 s: nobody has played.
select set_config('pgtap.t0', public.lineup_lock_tick('2026-10-16 00:14:59+00', pg_temp.lg())::text, true);
select is(pg_temp.view_at(),
  'rl-d-bye=unlocked rl-d-sun=unlocked rl-d-thu=unlocked rl-f-sun=unlocked rl-o-thu=unlocked',
  'B2 kickoff − 1 s: every rostered player unlocked in the view');
select is(
  (select string_agg(pp.player_id || ':' || pp.state, ' ' order by pp.player_id) from league_player_pool pp
   where pp.league_id = pg_temp.lg() and pp.player_id in (select player_id from league_rosters where league_id = pg_temp.lg())),
  'rl-d-bye:rostered rl-d-sun:rostered rl-d-thu:rostered rl-f-sun:rostered rl-o-thu:rostered',
  'B3 the tick gave every rostered player the D294 mirror row (state rostered)');

-- AT the Thursday kickoff: both sides of the Thursday game lock — the
-- drafted ones included (before 181: rl-d-thu / rl-o-thu read unlocked).
select set_config('pgtap.t1', public.lineup_lock_tick('2026-10-16 00:15:00+00', pg_temp.lg())::text, true);
select is(pg_temp.view_at(),
  'rl-d-bye=unlocked rl-d-sun=unlocked rl-d-thu=2026-10-20 03:30:00+00 rl-f-sun=unlocked rl-o-thu=2026-10-20 03:30:00+00',
  'B4 AT the Thursday kickoff: the two DRAFTED Thursday players lock in the view, until the week''s release');
select is(pg_temp.view_at(), pg_temp.enforced_at('2026-10-16 00:15:00+00'),
  'B5 the view = the enforced lock for every rostered player at the Thursday kickoff');
select is((current_setting('pgtap.t1')::jsonb ->> 'pool_updates')::int, 3,
  'B6 the pass counted three lock changes — the two drafted Thursday players and the Thursday player on waivers (so the league''s one broadcast fires and an open page refetches)');

-- Sunday kickoff − 1 s, then AT it.
select set_config('pgtap.t2', public.lineup_lock_tick('2026-10-18 16:59:59+00', pg_temp.lg())::text, true);
select is(pg_temp.view_at(), pg_temp.enforced_at('2026-10-18 16:59:59+00'),
  'B7 Sunday kickoff − 1 s: view = enforcement (the Sunday players still free)');
select set_config('pgtap.t3', public.lineup_lock_tick('2026-10-18 17:00:00+00', pg_temp.lg())::text, true);
select is(pg_temp.view_at(),
  'rl-d-bye=unlocked rl-d-sun=2026-10-20 03:30:00+00 rl-d-thu=2026-10-20 03:30:00+00 rl-f-sun=2026-10-20 03:30:00+00 rl-o-thu=2026-10-20 03:30:00+00',
  'B8 AT the Sunday kickoff: the drafted Sunday player locks beside the picked-up one (Chris''s screenshot: Otton vs Watson, one game); the bye player never locks');
select is(pg_temp.view_at(), pg_temp.enforced_at('2026-10-18 17:00:00+00'),
  'B9 the view = the enforced lock for every rostered player at the Sunday kickoff');

-- The release instant: everyone unlocks together.
select set_config('pgtap.t4', public.lineup_lock_tick('2026-10-20 03:30:00+00', pg_temp.lg())::text, true);
select is(pg_temp.view_at(), pg_temp.enforced_at('2026-10-20 03:30:00+00'),
  'B10 AT the week''s release: view = enforcement (release unchanged by 181)');

-- ---------------------------------------------------------------------------
-- §C NOTHING ELSE MOVES
-- ---------------------------------------------------------------------------
select is(
  (select pp.state || ':' || pp.waivers_until::text from league_player_pool pp where pp.league_id = pg_temp.lg() and pp.player_id = 'rl-w-thu'),
  'on_waivers:2026-10-21 16:00:00+00',
  'C1 an existing on_waivers row keeps its state and waivers_until');
select ok(
  not exists (select 1 from league_player_pool pp where pp.league_id = pg_temp.lg() and pp.player_id = 'rl-u-sun'),
  'C2 an unowned player with no row still gets none (pool rows stay lazy for the unowned)');
select is(
  (select count(*)::int from league_player_pool pp where pp.league_id = pg_temp.lg()),
  6,
  'C3 the pool holds exactly the five rostered rows plus the waivers row — the tick inserted once, not per pass');

select * from finish();
rollback;
