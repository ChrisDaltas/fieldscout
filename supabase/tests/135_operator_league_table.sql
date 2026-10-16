-- ============================================================================
-- 135 — the operator's every-league table (migration 187; M8 follow-up;
--       F599; PROGRESS D521)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — both doors DEFINER + search_path '' + EXECUTE authenticated
--       only; every internal plain, search_path '', closed; no body writes
--       or touches the JWT claims; the gates never read league_members.
--   §K  REFUSALS — anon / a plain user / a league's own commissioner get
--       42501 from both doors (never a list scoped to "his" leagues).
--   §L  LIST — the operator sees EVERY league (none of which he is in),
--       deleted only when asked; the total is the true count while the page
--       is cut; paging walks every league exactly once; sort + search; the
--       plain-words row (golden); bad paging is 22023 by name.
--   §D  DETAIL — every seat with role / vacancy / autopilot / record, full
--       settings; a deleted league opens with its record_error stated;
--       an unknown league is P0002.
-- Break probe (§4.3): drop the in-body gate from op_list_leagues ⇒ K2/K3
-- red (shown in the PR, reverted).
-- World (season 2098): u1 commissioner of L1, u2 manager of L1, u3 commissioner
-- of L2, u4 OPERATOR (in no league), u5 plain user. Names prefixed x135 so the
-- search pins only this file's leagues.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

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
   where n.nspname = 'public' and p.proname in ('op_list_leagues', 'op_list_leagues_internal',
     'op_league_detail', 'op_league_detail_internal', 'op_league_row_internal')),
  'op_league_detail=t:search_path="":f:t op_league_detail_internal=f:search_path="":f:f op_league_row_internal=f:search_path="":f:f op_list_leagues=t:search_path="":f:t op_list_leagues_internal=f:search_path="":f:f',
  'A1 doors DEFINER + search_path '''' + authenticated only; internals plain and closed');
select ok(
  (select bool_and(p.prosrc !~* '\m(insert|update|delete)\M' and p.prosrc !~* 'request\.jwt')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_list_leagues', 'op_list_leagues_internal',
     'op_league_detail', 'op_league_detail_internal', 'op_league_row_internal')),
  'A2 R1545: no body writes or touches the JWT claims');
select ok(
  (select bool_and(p.prosrc ~ 'public\.is_platform_operator\(\)' and p.prosrc !~* 'league_members')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_list_leagues', 'op_league_detail')),
  'A3 TD1: each door gates on is_platform_operator() and never on league_members');

-- ---------------------------------------------------------------------------
-- World
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, ('99135000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x135-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, json_build_object('username', 'x135_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;
update profiles set is_admin = true where id = '99135000-0000-4000-8000-000000000004';

-- L1 live (h2h, faab), L2 setup, L3..L7 filler, LD deleted.
insert into leagues (id, owner_id, name, season, status, team_count, waiver_type, faab_budget, trade_review,
                     playoff_teams, playoff_start_week, regular_season_weeks, settings, roster_settings, created_at, deleted_at,
                     scoring_system_id, scoring_rules_snapshot)
select v.id::uuid, v.owner::uuid, v.nm, 2098, v.st, 8, v.wt, 200, v.tr, 4, 15, 14, '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}], "bench": 4, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT"]}], "swap_spots": 0}',
  v.ca::timestamptz, v.del::timestamptz,
  case when v.st = 'in_season' then (select id from scoring_systems where is_template and name = 'ESPN Standard') end,
  case when v.st = 'in_season' then '{}'::jsonb end
from (values
  ('b1350000-0000-4000-8000-000000000001', '99135000-0000-4000-8000-000000000001', 'x135 Alpha', 'in_season', 'faab', 'commissioner', '2098-01-07 00:00+00', null),
  ('b1350000-0000-4000-8000-000000000002', '99135000-0000-4000-8000-000000000003', 'x135 Bravo', 'setup', 'rolling_priority', 'league_vote', '2098-01-06 00:00+00', null),
  ('b1350000-0000-4000-8000-000000000003', '99135000-0000-4000-8000-000000000003', 'x135 Charlie', 'setup', 'faab', 'none', '2098-01-05 00:00+00', null),
  ('b1350000-0000-4000-8000-000000000004', '99135000-0000-4000-8000-000000000003', 'x135 Delta', 'setup', 'faab', 'none', '2098-01-04 00:00+00', null),
  ('b1350000-0000-4000-8000-000000000005', '99135000-0000-4000-8000-000000000003', 'x135 Echo', 'setup', 'faab', 'none', '2098-01-03 00:00+00', null),
  ('b1350000-0000-4000-8000-000000000006', '99135000-0000-4000-8000-000000000003', 'x135 Foxtrot', 'setup', 'faab', 'none', '2098-01-02 00:00+00', null),
  ('b1350000-0000-4000-8000-000000000007', '99135000-0000-4000-8000-000000000003', 'x135 Golf', 'setup', 'faab', 'none', '2098-01-01 00:00+00', null),
  ('b1350000-0000-4000-8000-0000000000dd', '99135000-0000-4000-8000-000000000003', 'x135 Zulu (deleted)', 'setup', 'faab', 'none', '2098-01-08 00:00+00', '2098-02-01 00:00+00')
) v(id, owner, nm, st, wt, tr, ca, del);

insert into teams (id, owner_id, name, league_id) values
  ('c1350000-0000-4000-8000-000000000001', '99135000-0000-4000-8000-000000000001', 'Aces', 'b1350000-0000-4000-8000-000000000001'),
  ('c1350000-0000-4000-8000-000000000002', '99135000-0000-4000-8000-000000000002', 'Bees', 'b1350000-0000-4000-8000-000000000001'),
  ('c1350000-0000-4000-8000-000000000003', '99135000-0000-4000-8000-000000000001', 'Open Seat', 'b1350000-0000-4000-8000-000000000001');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, joined_at) values
 ('b1350000-0000-4000-8000-000000000001', '99135000-0000-4000-8000-000000000001', 'c1350000-0000-4000-8000-000000000001', 'commissioner', false, '2098-01-07 01:00+00'),
 ('b1350000-0000-4000-8000-000000000001', '99135000-0000-4000-8000-000000000002', 'c1350000-0000-4000-8000-000000000002', 'manager', false, '2098-01-07 02:00+00'),
 ('b1350000-0000-4000-8000-000000000001', null, 'c1350000-0000-4000-8000-000000000003', 'manager', true, '2098-01-07 03:00+00'),
 ('b1350000-0000-4000-8000-000000000002', '99135000-0000-4000-8000-000000000003', null, 'commissioner', false, '2098-01-06 01:00+00');
insert into team_autopilot (team_id, is_on, set_at) values ('c1350000-0000-4000-8000-000000000002', true, '2098-01-08 00:00+00');
insert into nfl_weeks (season, week, starts_at) values (2098, 1, '2098-09-08 07:00+00'), (2098, 2, '2098-09-15 07:00+00')
  on conflict do nothing;
insert into league_weeks (league_id, season, week, status) values
 ('b1350000-0000-4000-8000-000000000001', 2098, 1, 'final'),
 ('b1350000-0000-4000-8000-000000000001', 2098, 2, 'live');

create temp table r135 (tag text primary key, r jsonb);
grant all on r135 to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- K. Refusals
-- ---------------------------------------------------------------------------
set local role anon;
select alike(pg_temp.err($$select op_list_leagues()$$), '42501:%', 'K1 anon refused (list)');
select alike(pg_temp.err($$select op_league_detail('b1350000-0000-4000-8000-000000000001')$$), '42501:%', 'K1b anon refused (detail)');
reset role;

select set_config('request.jwt.claims', '{"sub": "99135000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
select alike(pg_temp.err($$select op_list_leagues()$$), '42501:%only a platform operator%', 'K2 a plain user is refused (list)');
select alike(pg_temp.err($$select op_league_detail('b1350000-0000-4000-8000-000000000001')$$), '42501:%only a platform operator%', 'K2b a plain user is refused (detail)');
reset role;

select set_config('request.jwt.claims', '{"sub": "99135000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select alike(pg_temp.err($$select op_list_leagues('x135')$$), '42501:%only a platform operator%', 'K3 a commissioner is refused — not handed a list of his own leagues');
select alike(pg_temp.err($$select op_league_detail('b1350000-0000-4000-8000-000000000001')$$), '42501:%only a platform operator%', 'K3b the league''s own commissioner is refused (detail)');
reset role;

-- The operator (in NO league) through the real doors.
select set_config('request.jwt.claims', '{"sub": "99135000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
insert into r135 values
  ('all',   op_list_leagues('x135', 'name', false, 100, 0, false)),
  ('del',   op_list_leagues('x135', 'name', false, 100, 0, true)),
  ('p1',    op_list_leagues('x135', 'created', true, 3, 0, false)),
  ('p2',    op_list_leagues('x135', 'created', true, 3, 3, false)),
  ('p3',    op_list_leagues('x135', 'created', true, 3, 6, false)),
  ('mem',   op_list_leagues('x135', 'members', true, 2, 0, false)),
  ('who',   op_list_leagues('x135_user1', 'name', false, 100, 0, false)),
  ('pct',   op_list_leagues('x135%', 'name', false, 100, 0, false)),
  ('D',     op_league_detail('b1350000-0000-4000-8000-000000000001')),
  ('DD',    op_league_detail('b1350000-0000-4000-8000-0000000000dd'));
select alike(pg_temp.err($$select op_league_detail('b1350000-0000-4000-8000-0000000000ee')$$), 'P0002:%no such league%', 'D0 an unknown league is P0002, never an empty answer');
select alike(pg_temp.err($$select op_list_leagues('', 'owner')$$), '22023:%sort must be%', 'L0 an unknown sort is refused by name');
select alike(pg_temp.err($$select op_list_leagues('', 'name', true, 101)$$), '22023:%1 to 100%', 'L0b a page over 100 is refused (boundary 101)');
select is(pg_temp.err($$select op_list_leagues('', 'name', true, 100)$$), 'no error', 'L0c a page of exactly 100 is allowed (boundary)');
select alike(pg_temp.err($$select op_list_leagues('', 'name', true, 10, -1)$$), '22023:%negative%', 'L0d a negative page start is refused');
reset role;

-- ---------------------------------------------------------------------------
-- L. The list
-- ---------------------------------------------------------------------------
select is((select jsonb_agg(e ->> 'name') from r135, jsonb_array_elements(r -> 'leagues') e where tag = 'all'),
  '["x135 Alpha", "x135 Bravo", "x135 Charlie", "x135 Delta", "x135 Echo", "x135 Foxtrot", "x135 Golf"]'::jsonb,
  'L1 the operator sees EVERY league though he is in none; deleted left out by default');
select is((select r -> 'total' from r135 where tag = 'all'), '7'::jsonb, 'L1b the total is 7');
select is((select (r ->> 'total') || ':' || jsonb_array_length(r -> 'leagues') || ':' || (r -> 'leagues' -> 7 ->> 'name') || ':' || (r -> 'leagues' -> 7 ->> 'deleted_at')
           from r135 where tag = 'del'),
  '8:8:x135 Zulu (deleted):2098-02-01T00:00:00+00:00', 'L2 deleted leagues appear only when asked, carrying deleted_at');
select is((select (r ->> 'total') || ':' || (r ->> 'limit') || ':' || jsonb_array_length(r -> 'leagues') || ':' || (r ->> 'more') from r135 where tag = 'p1'),
  '7:3:3:true', 'L3 a cut page states the TRUE total and more=true (never a silent cap)');
select is((select (r ->> 'more') || ':' || jsonb_array_length(r -> 'leagues') from r135 where tag = 'p3'),
  'false:1', 'L3b the last page says more=false');
select is(
  (select jsonb_agg(e ->> 'name' order by t.tag, o) from r135 t, jsonb_array_elements(t.r -> 'leagues') with ordinality x(e, o)
   where t.tag in ('p1', 'p2', 'p3')),
  '["x135 Alpha", "x135 Bravo", "x135 Charlie", "x135 Delta", "x135 Echo", "x135 Foxtrot", "x135 Golf"]'::jsonb,
  'L4 paging newest-first walks every league exactly once, in order');
select is((select r -> 'leagues' -> 0 ->> 'name' from r135 where tag = 'mem'), 'x135 Alpha', 'L5 sort by members, most first');
select is((select jsonb_agg(e ->> 'name') from r135, jsonb_array_elements(r -> 'leagues') e where tag = 'who'),
  '["x135 Alpha"]'::jsonb, 'L6 search finds a league by its commissioner''s username');
select is((select r -> 'total' from r135 where tag = 'pct'), '0'::jsonb, 'L7 a % in the search is matched literally, not as a wildcard');
select is(
  (select e - 'id' - 'created_at' - 'commissioner_id' - 'draft' from r135, jsonb_array_elements(r -> 'leagues') e
   where tag = 'all' and e ->> 'name' = 'x135 Alpha'),
  '{"name": "x135 Alpha", "phase": "In season", "teams": 3, "season": 2098, "status": "in_season", "members": 2,
    "deleted_at": null, "open_seats": 6, "team_count": 8, "commissioner": "x135_user1", "vacant_seats": 1,
    "current_week": {"week": 2, "status": "live", "summary": "Week 2 — being played"},
    "settings_summary": {"roster": "3 starters, 4 bench, 1 IR", "scoring": "Preset: ESPN Standard",
      "waivers": "FAAB ($200 budget)", "playoffs": "4 teams from week 15", "schedule": "Head to head",
      "roster_size": 8, "trade_review": "Commissioner reviews", "season_length": "14 regular-season weeks",
      "trade_deadline": "No deadline"}}'::jsonb,
  'L8 golden: the row in plain words (open seats = 8 seats - 2 managers; current week = the first not-final week)');
select is((select e -> 'settings_summary' ->> 'scoring' || ' / ' || (e -> 'settings_summary' ->> 'waivers') || ' / ' || (e -> 'settings_summary' ->> 'trade_review') || ' / ' || (e ->> 'phase')
           from r135, jsonb_array_elements(r -> 'leagues') e where tag = 'all' and e ->> 'name' = 'x135 Bravo'),
  'Custom (league''s own rules) / Rolling priority / League vote / Setting up', 'L9 plain words for own scoring, rolling waivers, a league vote and setup');

-- ---------------------------------------------------------------------------
-- D. Detail
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_agg(jsonb_build_object('team', m ->> 'team_name', 'user', m ->> 'username', 'role', m ->> 'role',
            'vacant', m -> 'vacant', 'autopilot', m -> 'autopilot', 'joined', m ->> 'joined_at') order by o)
   from r135, jsonb_array_elements(r -> 'members') with ordinality x(m, o) where tag = 'D'),
  '[{"team": "Aces", "user": "x135_user1", "role": "commissioner", "vacant": false, "autopilot": false, "joined": "2098-01-07T01:00:00+00:00"},
    {"team": "Bees", "user": "x135_user2", "role": "manager", "vacant": false, "autopilot": true, "joined": "2098-01-07T02:00:00+00:00"},
    {"team": "Open Seat", "user": null, "role": "manager", "vacant": true, "autopilot": false, "joined": "2098-01-07T03:00:00+00:00"}]'::jsonb,
  'D1 golden: every seat — commissioner first, the vacant seat with no username, autopilot from team_autopilot');
select is((select (r ->> 'record_error') is null and jsonb_typeof(r -> 'members' -> 0 -> 'record') = 'object' from r135 where tag = 'D'),
  true, 'D2 a live league''s records come from its standings read (no error)');
select is((select r -> 'settings' ->> 'waiver_type' || ':' || (r -> 'settings' -> 'roster_settings' ->> 'bench') || ':' || (r -> 'league' ->> 'name') from r135 where tag = 'D'),
  'faab:4:x135 Alpha', 'D3 the full settings ride beside the row');
select is((select (r ->> 'record_error') || ' | ' || (r -> 'league' ->> 'deleted_at') from r135 where tag = 'DD'),
  'The league is deleted, so it has no standings. | 2098-02-01T00:00:00+00:00', 'D4 a deleted league opens, its missing record stated');

select * from finish();
rollback;
