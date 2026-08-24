-- ============================================================================
-- Franchise columns + team_managers stints + teams RLS replacement —
-- migration 053 (spec §7.2.1/§12.22 + erratum v2.7.1 D35a/D35b; plan §8.2;
-- task L.A1.3; standing rules tasks-M1 §4).
--
-- Falsifiability notes (§4.3):
--   * one_open_stint_per_team boundaries run BOTH sides: a second OPEN stint
--     on the same team throws 23505, while closed stints coexist on that
--     team and a closed re-stint by the same user succeeds — a non-partial
--     UNIQUE(team_id) implementation fails the coexistence pins; dropping
--     the index fails the 23505 pin. The index PREDICATE is golden-pinned
--     from pg_indexes so a future migration can't silently widen it.
--   * D35b is pinned in both directions: a standalone-team owner still
--     UPDATEs/INSERTs (fails if the owner write path was dropped entirely),
--     and a league-team owner's UPDATE affects 0 rows (fails under 001's
--     unscoped "Users can manage own teams" — the exact policy this
--     migration replaces). Moving a standalone team INTO a league via
--     client UPDATE/INSERT throws 42501 (WITH CHECK) — server-authoritative
--     league membership (§8.1).
--   * team_managers has NO client write path for ANY role — including the
--     commissioner (unlike league_members' commish FOR ALL): INSERT expects
--     42501; UPDATE/DELETE (RLS-filtered silently) use the RETURNING-count
--     pattern preceded by a same-role SELECT-sees-N pin (§4.2).
--   * All privileged-context work (fixtures + constraint boundaries) runs
--     BEFORE any JWT claims are set — set_config(..., true) persists to txn
--     end (D49(7) lesson).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(67);

-- ---------------------------------------------------------------------------
-- A. teams shape: §12.22 franchise columns + D35a list_id nullability.
-- ---------------------------------------------------------------------------
select columns_are('public', 'teams',
  array['id', 'owner_id', 'list_id', 'name', 'scoring_system_id', 'league_id',
        'total_points', 'wins', 'losses', 'created_at', 'updated_at',
        'status', 'retired_at_week', 'successor_team_id'],
  'teams column set = 001 + exactly the three §12.22 franchise columns');
select col_type_is('public', 'teams', 'status', 'text', 'status is TEXT');
select col_not_null('public', 'teams', 'status', 'status NOT NULL');
select col_default_is('public', 'teams', 'status', 'active', $$status defaults to 'active'$$);
select col_type_is('public', 'teams', 'retired_at_week', 'integer', 'retired_at_week is INTEGER');
select col_is_null('public', 'teams', 'retired_at_week', 'retired_at_week nullable');
select col_type_is('public', 'teams', 'successor_team_id', 'uuid', 'successor_team_id is UUID');
select col_is_null('public', 'teams', 'successor_team_id', 'successor_team_id nullable');
select fk_ok('public', 'teams', 'successor_team_id', 'public', 'teams', 'id',
  'successor_team_id → teams (self-FK: retired franchise → its successor)');
select col_is_null('public', 'teams', 'list_id',
  'list_id is now nullable (D35a — league franchises carry no backing list)');

-- ---------------------------------------------------------------------------
-- B. teams RLS surface post-swap (D35b).
-- ---------------------------------------------------------------------------
select policies_are('public', 'teams',
  array['Teams are viewable by everyone', 'Users can delete own standalone teams',
        'Users can insert own standalone teams', 'Users can update own standalone teams'],
  'post-swap teams policy list — 001''s unscoped "Users can manage own teams" is gone, and 053''s ONE `FOR ALL` policy is now THREE (095/MP.3, D227(4)): the FOR ALL form could not narrow DELETE alone, and DELETE is the only verb whose meaning changed');
select policy_cmd_is('public', 'teams', 'Teams are viewable by everyone', 'SELECT',
  'world-readable SELECT stays (§17 public league summary)');
select policy_cmd_is('public', 'teams', 'Users can insert own standalone teams', 'INSERT',
  'owner-manage INSERT keeps 053''s predicate exactly (scoped league_id IS NULL)');
select policy_cmd_is('public', 'teams', 'Users can update own standalone teams', 'UPDATE',
  '…and UPDATE too — renaming your own standalone team, or your own CPU seat, is cosmetic and stays permitted (D227(4))');
select policy_cmd_is('public', 'teams', 'Users can delete own standalone teams', 'DELETE',
  '…and DELETE is its own policy now, because it is the one that had to be NARROWED: deleting a seat a live mock is drafting into wedges the draft with no in-product recovery (R473). 043 §F pins the refusal');

-- ---------------------------------------------------------------------------
-- C. team_managers shape: §12.22 column-for-column.
-- ---------------------------------------------------------------------------
select has_table('public', 'team_managers', 'team_managers exists');
select columns_are('public', 'team_managers',
  array['id', 'league_id', 'team_id', 'user_id', 'role', 'started_at',
        'started_week', 'ended_at', 'ended_week', 'end_reason', 'ended_by'],
  'exact §12.22 column set');
select col_is_pk('public', 'team_managers', 'id', 'PK id');
select col_not_null('public', 'team_managers', 'league_id', 'league_id NOT NULL');
select col_not_null('public', 'team_managers', 'team_id', 'team_id NOT NULL');
select col_not_null('public', 'team_managers', 'user_id', 'user_id NOT NULL');
select col_default_is('public', 'team_managers', 'role', 'manager', $$role defaults to 'manager'$$);
select col_not_null('public', 'team_managers', 'started_at', 'started_at NOT NULL');
select col_default_is('public', 'team_managers', 'started_at', 'now()', 'started_at defaults to now()');
select col_is_null('public', 'team_managers', 'started_week', 'started_week nullable (NULL preseason)');
select col_is_null('public', 'team_managers', 'ended_at', 'ended_at nullable (NULL = open stint)');
select col_is_null('public', 'team_managers', 'end_reason', 'end_reason nullable');
select fk_ok('public', 'team_managers', 'league_id', 'public', 'leagues', 'id', 'league_id → leagues');
select fk_ok('public', 'team_managers', 'team_id', 'public', 'teams', 'id', 'team_id → teams');
select fk_ok('public', 'team_managers', 'user_id', 'public', 'profiles', 'id', 'user_id → profiles');
select fk_ok('public', 'team_managers', 'ended_by', 'public', 'profiles', 'id', 'ended_by → profiles');
select has_index('public', 'team_managers', 'one_open_stint_per_team', 'one_open_stint_per_team exists');
select has_index('public', 'team_managers', 'idx_team_managers_user', 'user index exists');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'one_open_stint_per_team'),
  'CREATE UNIQUE INDEX one_open_stint_per_team ON public.team_managers USING btree (team_id) WHERE (ended_at IS NULL)',
  'one_open_stint_per_team is UNIQUE on team_id WHERE ended_at IS NULL (predicate golden-pinned)');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'team_managers'),
  'RLS enabled on team_managers');
select policies_are('public', 'team_managers',
  array['Stints viewable by league members'],
  'exactly ONE policy — member SELECT; no client write path for any role (writes via RPCs only)');
select policy_cmd_is('public', 'team_managers', 'Stints viewable by league members', 'SELECT',
  'stint policy is SELECT-only');

-- ---------------------------------------------------------------------------
-- D. Fixtures (postgres context — before any JWT claims).
--    u1 commish+owner L1 (open stint on T2) · u2 manager L1 (league team T1,
--    open stint) · u3 standalone-team owner, NOT a member · u4 outsider.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-tf1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "tf_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-tf2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "tf_manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-tf3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "tf_standalone"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'pgtap-tf4@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "tf_outsider"}', now(), now());

insert into leagues (id, owner_id, name, season) values
  ('a1000000-0000-4000-8000-00000000000a', '71000000-0000-4000-8000-000000000001', 'pgtap-tf-1', 2026);

-- League teams with list_id NULL (D35a proven at insert time) + a standalone.
insert into teams (id, owner_id, list_id, name, league_id) values
  ('c1000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002',
   null, 'pgtap-tf-team-1', 'a1000000-0000-4000-8000-00000000000a'),
  ('c1000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001',
   null, 'pgtap-tf-team-2', 'a1000000-0000-4000-8000-00000000000a'),
  ('c1000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003',
   null, 'pgtap-tf-solo', null);

insert into league_members (league_id, user_id, team_id, role) values
  ('a1000000-0000-4000-8000-00000000000a', '71000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000002', 'commissioner'),
  ('a1000000-0000-4000-8000-00000000000a', '71000000-0000-4000-8000-000000000002',
   'c1000000-0000-4000-8000-000000000001', 'manager');

-- Stints: T1 has a CLOSED u1 stint + the OPEN u2 stint (history: u1 ran the
-- team, was replaced by u2); T2 has u1's open stint.
insert into team_managers (league_id, team_id, user_id, started_at, ended_at, end_reason, ended_by) values
  ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000001',
   '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z', 'replaced', '71000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000002', '2026-07-10T00:00:00Z', null, null, null),
  ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000002',
   '71000000-0000-4000-8000-000000000001', '2026-07-01T00:00:00Z', null, null, null);

-- ---------------------------------------------------------------------------
-- E. one_open_stint_per_team boundaries (postgres context).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into team_managers (league_id, team_id, user_id)
     values ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001',
             '71000000-0000-4000-8000-000000000003') $$,
  '23505', null,
  'a second OPEN stint on the same team is rejected (one_open_stint_per_team — the E54 double-claim race)');
select lives_ok(
  $$ insert into team_managers (league_id, team_id, user_id, started_at, ended_at, end_reason) values
     ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      '2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z', 'left') $$,
  'a second CLOSED stint on the same team+user coexists — a non-partial UNIQUE(team_id) OR a UNIQUE(team_id, user_id) implementation fails here (E51 re-stint = new row, no merge)');
select throws_ok(
  $$ insert into team_managers (league_id, team_id, user_id, started_at, ended_at) values
     ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      '2026-06-01T00:00:00Z', '2026-06-20T00:00:00Z') $$,
  '23505', null,
  'duplicate (team_id, user_id, started_at) rejected');
select is(
  (select count(*) from team_managers
   where team_id = 'c1000000-0000-4000-8000-000000000001'),
  3::bigint,
  'T1 stint history: 3 rows (two closed + one open) — history accretes, never merges');
select is(
  (select count(*) from team_managers
   where team_id = 'c1000000-0000-4000-8000-000000000001' and ended_at is null),
  1::bigint,
  'T1 has exactly one open stint (the current manager)');

-- ---------------------------------------------------------------------------
-- F. teams RLS both directions (D35b; JWT claims from here on).
-- ---------------------------------------------------------------------------
set local role authenticated;

-- u3: standalone-team owner keeps full self-service.
select set_config('request.jwt.claims',
  '{"sub": "71000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update teams set name = 'pgtap-tf-solo-renamed'
                where id = 'c1000000-0000-4000-8000-000000000003' returning 1)
     select count(*) from w $$,
  $$ values (1::bigint) $$,
  'standalone owner UPDATE affects own row (count 1) — fails if the owner write path was dropped entirely');
select lives_ok(
  $$ insert into teams (owner_id, list_id, name, league_id)
     values ('71000000-0000-4000-8000-000000000003', null, 'pgtap-tf-solo-2', null) $$,
  'standalone owner INSERT (league_id NULL, list_id NULL) succeeds through the client path');
select throws_ok(
  $$ insert into teams (owner_id, list_id, name, league_id)
     values ('71000000-0000-4000-8000-000000000003', null, 'pgtap-tf-sneak',
             'a1000000-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'client INSERT of a LEAGUE team is denied (42501) — league teams exist only via SECURITY DEFINER RPCs (§8.1)');
select throws_ok(
  $$ update teams set league_id = 'a1000000-0000-4000-8000-00000000000a'
     where id = 'c1000000-0000-4000-8000-000000000003' $$,
  '42501', null,
  'client UPDATE moving a standalone team INTO a league is denied (42501, WITH CHECK)');

-- u2: league-team owner — world-readable SELECT, zero write power.
select set_config('request.jwt.claims',
  '{"sub": "71000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from teams where id = 'c1000000-0000-4000-8000-000000000001'),
  1::bigint,
  'league-team owner SEES own team (SELECT-sees-it pin for the counts below)');
select results_eq(
  $$ with w as (update teams set wins = 9
                where id = 'c1000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'league-team owner UPDATE affects 0 rows — 001''s unscoped owner-manage policy would grant this (the C4 hole)');
select results_eq(
  $$ with d as (delete from teams
                where id = 'c1000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'league-team owner DELETE affects 0 rows');

-- u4: outsider — reads (world-readable), no writes anywhere.
select set_config('request.jwt.claims',
  '{"sub": "71000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select count(*) from teams where name like 'pgtap-tf-%'), 4::bigint,
  'outsider sees all 4 fixture teams (world-readable SELECT stays, §17)');
select results_eq(
  $$ with w as (update teams set wins = 9 where name like 'pgtap-tf-%' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'outsider UPDATE affects 0 rows');

-- ---------------------------------------------------------------------------
-- G. team_managers RLS per role (§4.2 pattern — no write path for ANY role).
-- ---------------------------------------------------------------------------
-- member u2: reads own league's stints; writes nothing.
select set_config('request.jwt.claims',
  '{"sub": "71000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from team_managers
   where league_id = 'a1000000-0000-4000-8000-00000000000a'),
  4::bigint,
  'member sees all 4 stint rows of own league (SELECT-sees-N pin for the counts below)');
select throws_ok(
  $$ insert into team_managers (league_id, team_id, user_id)
     values ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000002',
             '71000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'member INSERT denied (no write policy)');
select results_eq(
  $$ with w as (update team_managers set ended_at = now()
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'member UPDATE affects 0 rows (sees 4, changes none — a member cannot close stints)');
select results_eq(
  $$ with d as (delete from team_managers
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'member DELETE affects 0 rows');

-- commissioner u1: reads, but STILL no writes — unlike league_members, stints
-- have no commish policy (immutable history; writes only via RPCs).
select set_config('request.jwt.claims',
  '{"sub": "71000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*) from team_managers
   where league_id = 'a1000000-0000-4000-8000-00000000000a'),
  4::bigint,
  'commissioner sees all 4 stint rows (SELECT-sees-N pin)');
select throws_ok(
  $$ insert into team_managers (league_id, team_id, user_id)
     values ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000002',
             '71000000-0000-4000-8000-000000000004') $$,
  '42501', null,
  'COMMISSIONER INSERT denied — stints have no client write path even for the commish (writes via RPCs only)');
select results_eq(
  $$ with w as (update team_managers set end_reason = 'kicked'
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE affects 0 rows (history is not client-rewritable)');
select results_eq(
  $$ with d as (delete from team_managers
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE affects 0 rows');

-- non-member u3: sees nothing.
select set_config('request.jwt.claims',
  '{"sub": "71000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (select count(*) from team_managers), 0::bigint,
  'non-member sees zero stint rows (SELECT scoped by is_league_member)');
select results_eq(
  $$ with w as (update team_managers set end_reason = 'kicked' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'non-member UPDATE affects 0 rows');

-- anon: sees nothing on stints, world-readable teams, writes nothing.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*) from team_managers), 0::bigint, 'anon sees zero stint rows');
select is(
  (select count(*) from teams where name like 'pgtap-tf-%'), 4::bigint,
  'anon teams SELECT is the full world-readable set, NOT an error (is_league_member stays executable as a policy predicate — 052 §4.1 deviation)');
select throws_ok(
  $$ insert into team_managers (league_id, team_id, user_id)
     values ('a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000002',
             '71000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'anon stint INSERT denied');
select throws_ok(
  $$ insert into teams (owner_id, list_id, name, league_id)
     values ('71000000-0000-4000-8000-000000000004', null, 'pgtap-tf-anon', null) $$,
  '42501', null, 'anon teams INSERT denied (auth.uid() NULL fails the owner check)');
select results_eq(
  $$ with w as (update teams set wins = 9 where name like 'pgtap-tf-%' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon teams UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from team_managers returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon stint DELETE affects 0 rows');
reset role;

select * from finish();
rollback;
