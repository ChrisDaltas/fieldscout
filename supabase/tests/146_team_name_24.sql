-- ============================================================================
-- pgTAP 146 — migration 196: a team name is at most 24 characters, on every
-- door that writes one (Chris 2026-10-18: "team names ≤ 24 everywhere";
-- spec v2.16.94 §7.2; PROGRESS D545).
--
--   §A  FORM — the new helper is a PLAIN, REVOKEd internal; the four
--       replaced functions keep their security context and search_path; no
--       table CHECK was added on teams.name.
--   §C  create_league — a given team name: 25 refused (nothing written), a
--       space-padded 24 lands trimmed.
--   §D  THE AUTOMATIC NAME — "<username>'s Team" where it fits in 24 (a
--       17-character username: exactly 24), the username alone past that
--       (18 and 20), 'My Team' with no profile.
--   §E  join_league_by_code — the joiner's team takes the same rule.
--   §F  add_placeholder_seat — 25 refused, 24 lands, none → "Team N".
--   §G  rename_own_team and §H commish_rename_team — 25 refused BY NAME,
--       24 lands (both through the one shared gate).
--   §I  A NAME SET BEFORE THE RULE (30 characters) still reads verbatim, a
--       takeover of that team (assign_manager → seat_league_member_internal,
--       which UPDATEs the row without writing the name) is not refused and
--       keeps the name, and its manager can rename it to a legal name.
--   §J  League names are NOT part of the rule: a 100-character league name
--       still lands through update_league_profile.
--
-- Fixtures come from the RPCs themselves (one league created by u1), so no
-- cell passes on a hand-built row a real door could not produce — except
-- §I's 30-character name, which no door can write any more and is set the
-- way pre-196 data exists: as stored state.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""' and p.provolatile = 's'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'team_default_name_internal'),
  'A1 team_default_name_internal is PLAIN, STABLE, search_path='''' — a seam, not a door');
select ok(
  not has_function_privilege('anon', 'public.team_default_name_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.team_default_name_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.team_rename_normalize_internal(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.team_rename_normalize_internal(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.seat_league_member_internal(uuid,uuid,integer,uuid)', 'EXECUTE'),
  'A2 the helper, the shared rename gate and the seating internal are REVOKEd from anon and authenticated');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('create_league', 'add_placeholder_seat'))
  and has_function_privilege('authenticated', 'public.add_placeholder_seat(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.add_placeholder_seat(uuid,text)', 'EXECUTE'),
  'A3 create_league and add_placeholder_seat are still SECURITY DEFINER with search_path='''', and the seat door keeps its grants');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seat_league_member_internal'),
  'A4 seat_league_member_internal stays SECURITY INVOKER with search_path='''' (062/077/146''s posture)');
select is(
  (select count(*)::int from pg_constraint c
   where c.conrelid = 'public.teams'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ~* '\mname\M'),
  0, 'A5 NO table CHECK on teams.name — a name set before the rule keeps working; the limit binds the doors that write one');

-- ---------------------------------------------------------------------------
-- B. FIXTURES (postgres). Six accounts; the usernames' lengths are the point
--    of §D/§E, so B1 pins them.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  'pgtap-tn24-' || u.n || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', u.username)::jsonb, now(), now()
from (values
  (1, 'e6240000-0000-4000-8000-000000000001'::uuid, 'tn24_commish'),
  (2, 'e6240000-0000-4000-8000-000000000002'::uuid, 'tn24_manager'),
  (3, 'e6240000-0000-4000-8000-000000000003'::uuid, 'tn24_seventeen_17'),
  (4, 'e6240000-0000-4000-8000-000000000004'::uuid, 'tn24_eighteen_ch18'),
  (5, 'e6240000-0000-4000-8000-000000000005'::uuid, 'tn24_twenty_chars_20'),
  (6, 'e6240000-0000-4000-8000-000000000006'::uuid, 'tn24_assignee')
) as u(n, id, username);

select results_eq(
  $$ select username, char_length(username) from profiles
     where id::text like 'e6240000-%' order by id $$,
  $$ values ('tn24_commish'::text, 12), ('tn24_manager', 12), ('tn24_seventeen_17', 17),
            ('tn24_eighteen_ch18', 18), ('tn24_twenty_chars_20', 20), ('tn24_assignee', 13) $$,
  'B1 premise: the six handles exist with the lengths §D/§E depend on (17 → "<handle>''s Team" is exactly 24)');

-- ---------------------------------------------------------------------------
-- C. create_league — the creator's given team name (u1).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.create_league('pgtap-tn24-refused', 2026, 12, '{}'::jsonb, '{}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       repeat('x', 25), 'e6240000-0000-4000-8000-0000000000c0',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001', 'create_league: the team name is 25 characters — team names can be up to 24 characters',
  'C1 a 25-character team name is refused BY NAME, with the count (P0001 → leagues-service''s team_name field)');
select is(
  (select count(*)::int from public.leagues where creation_action_id = 'e6240000-0000-4000-8000-0000000000c0'),
  0, 'C2 …and nothing was written: no league exists for that submit');

create temp table _c1 as
select public.create_league('pgtap-tn24-league', 2026, 12, '{}'::jsonb, '{}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  '  ' || repeat('A', 24) || '  ', 'e6240000-0000-4000-8000-0000000000c1',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;

select is((select r->>'replayed' from _c1), 'false', 'C3 a space-padded 24-character team name lands (counted after the trim the INSERT applies)');
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _c1)),
  repeat('A', 24), 'C4 …and the creator''s team carries the TRIMMED 24-character name');

-- ---------------------------------------------------------------------------
-- D. THE AUTOMATIC NAME — create_league with no team name.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
create temp table _d17 as
select public.create_league('pgtap-tn24-d17', 2026, 8, '{}'::jsonb, '{}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  '', 'e6240000-0000-4000-8000-0000000000d1',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _d17)),
  'tn24_seventeen_17''s Team',
  'D1 a 17-character handle keeps 077''s "<handle>''s Team" — exactly 24, so nothing changes where the name fits');

select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
create temp table _d18 as
select public.create_league('pgtap-tn24-d18', 2026, 8, '{}'::jsonb, '{}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  null, 'e6240000-0000-4000-8000-0000000000d2',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _d18)),
  'tn24_eighteen_ch18',
  'D2 an 18-character handle would make 25 — the team is named after the handle alone');

reset role;
select set_config('request.jwt.claims', '', true);
select is(public.team_default_name_internal('e6240000-0000-4000-8000-000000000005'), 'tn24_twenty_chars_20',
  'D3 the longest human handle (20) → the handle alone, 20 characters');
select is(public.team_default_name_internal('e6240000-0000-4000-8000-0000000000ff'), 'My Team',
  'D4 no profile → 077''s own fallback, ''My Team''');

-- ---------------------------------------------------------------------------
-- E. join_league_by_code — u5 joins u1's league.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
create temp table _e1 as
select public.join_league_by_code((select r->>'invite_code' from _c1)) as r;
select is((select r->>'ok' from _e1), 'true', 'E1 u5 joins by code');
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _e1)),
  'tn24_twenty_chars_20',
  'E2 …and the joiner''s new team takes the same rule: "<handle>''s Team" would be 27, so it is the handle alone');

-- ---------------------------------------------------------------------------
-- F. add_placeholder_seat — the commissioner's added seat (u1).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.add_placeholder_seat((select (r->>'league_id')::uuid from _c1), repeat('S', 25)) $$,
  '22023', 'add_placeholder_seat: the team name is 25 characters — team names can be up to 24 characters',
  'F1 a 25-character seat name is refused BY NAME');
select is(
  (select count(*)::int from public.teams t where t.league_id = (select (r->>'league_id')::uuid from _c1)),
  2, 'F2 …and no seat was added (the creator''s team and u5''s only)');
create temp table _f1 as
select public.add_placeholder_seat((select (r->>'league_id')::uuid from _c1), repeat('S', 24)) as r;
select is((select r->>'team_name' from _f1), repeat('S', 24), 'F3 a 24-character seat name lands, and the result says it');
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _f1)),
  repeat('S', 24), 'F4 …stored as given');
create temp table _f2 as
select public.add_placeholder_seat((select (r->>'league_id')::uuid from _c1), null) as r;
select is((select r->>'team_name' from _f2), 'Team 4', 'F5 no name → the deterministic "Team N" (D74(5)), unchanged');

-- ---------------------------------------------------------------------------
-- G. rename_own_team — u5 renames his own team.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.rename_own_team((select (r->>'team_id')::uuid from _e1), repeat('R', 25)) $$,
  '22023', 'rename_own_team: the team name is 25 characters — team names can be up to 24 characters',
  'G1 a manager''s own rename to 25 characters is refused BY NAME (the shared gate, 100 → 24)');
select lives_ok(
  $$ select public.rename_own_team((select (r->>'team_id')::uuid from _e1), repeat('R', 24)) $$,
  'G2 …and 24 lives — the boundary, one unit either side');
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _e1)),
  repeat('R', 24), 'G3 …stored');

-- ---------------------------------------------------------------------------
-- H. commish_rename_team — u1 renames the 24-character seat.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_rename_team((select (r->>'league_id')::uuid from _c1),
       (select (r->>'team_id')::uuid from _f1), repeat('C', 25), null,
       'e6240000-0000-4000-8000-0000000000a1'::uuid) $$,
  '22023', 'commish_rename_team: the team name is 25 characters — team names can be up to 24 characters',
  'H1 the commissioner''s rename to 25 characters is refused BY NAME — the rule binds him too');
select lives_ok(
  $$ select public.commish_rename_team((select (r->>'league_id')::uuid from _c1),
       (select (r->>'team_id')::uuid from _f1), repeat('C', 24), null,
       'e6240000-0000-4000-8000-0000000000a2'::uuid) $$,
  'H2 …and 24 lives');
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _f1)),
  repeat('C', 24), 'H3 …stored');

-- ---------------------------------------------------------------------------
-- I. A NAME SET BEFORE THE RULE. The "Team 4" seat is given a 30-character
--    name as stored state (postgres) — the shape of pre-196 data.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
update public.teams set name = 'The Christian McCaffrey Fanboy'
where id = (select (r->>'team_id')::uuid from _f2);
select is(char_length('The Christian McCaffrey Fanboy'), 30, 'I1 premise: the legacy name is 30 characters');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _f2)),
  'The Christian McCaffrey Fanboy',
  'I2 it still reads verbatim — here for another signed-in user (teams are world-readable)');

select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.assign_manager((select (r->>'league_id')::uuid from _c1),
       (select (r->>'team_id')::uuid from _f2), 'e6240000-0000-4000-8000-000000000006') $$,
  'I3 a takeover of that team (assign_manager → seat_league_member_internal''s UPDATE of the row) is NOT refused');
select results_eq(
  $$ select t.name, t.owner_id from public.teams t where t.id = (select (r->>'team_id')::uuid from _f2) $$,
  $$ values ('The Christian McCaffrey Fanboy'::text, 'e6240000-0000-4000-8000-000000000006'::uuid) $$,
  'I4 …and the team keeps its 30-character name under its new manager — the rule binds a name being written, never one being kept');
select is(
  (select a.metadata->>'team_name' from public.commissioner_actions a
   where a.league_id = (select (r->>'league_id')::uuid from _c1) and a.action_type = 'assign_manager'
     and a.target_id = (select r->>'team_id' from _f2)),
  'The Christian McCaffrey Fanboy',
  'I5 …and the takeover''s receipt names the team by its whole name');

select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
create temp table _i1 as
select public.rename_own_team((select (r->>'team_id')::uuid from _f2), 'McCaffrey Fanboys') as r;
select is((select r->>'previous_name' from _i1), 'The Christian McCaffrey Fanboy',
  'I6 its new manager renames it to a legal name; the result''s previous_name is the 30-character one');
select is(
  (select t.name from public.teams t where t.id = (select (r->>'team_id')::uuid from _f2)),
  'McCaffrey Fanboys', 'I7 …stored');

-- ---------------------------------------------------------------------------
-- J. League names are not part of the rule.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "e6240000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.update_league_profile((select (r->>'league_id')::uuid from _c1), repeat('L', 100)) $$,
  'J1 a 100-character LEAGUE name still lands (update_league_profile''s own bound, untouched)');
select is(
  (select char_length(l.name) from public.leagues l where l.id = (select (r->>'league_id')::uuid from _c1)),
  100, 'J2 …stored at 100');

-- ---------------------------------------------------------------------------
-- K. 196's text is the head of each chain, hunks only (comment-stripped
--    source pins, so a decoy comment cannot satisfy them).
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select ok(
  (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'char_length\(v_name\) > 24'
      and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') !~ '> 100'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'team_rename_normalize_internal'),
  'K1 the shared rename gate bounds at 24 and no longer at 100');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_league', 'seat_league_member_internal')
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'team_default_name_internal'
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') !~ '''''s Team'''),
  2, 'K2 create_league and seat_league_member_internal both name a team through the ONE helper, and neither builds "<handle>''s Team" itself any more');

select * from finish();
rollback;
