-- ============================================================================
-- list_player_drafted — migration 079 (Lists v2 delivery plan v3.3 §2.2, design
-- decision **D2**, task **LV.1.2**). pgTAP file is **028** (027 = drop
-- profiles.display_name; next free confirmed at task time).
--
-- What this file has to make impossible to break silently:
--   * **Isolation, both directions.** Every 0-count / 0-affected pin here is
--     preceded (or followed, in the privileged epilogue) by a positive
--     control proving the row it failed to touch actually EXISTS. A policy
--     that "blocks" an empty table proves nothing — CLAUDE.md's "never let
--     'nothing happened' mean 'it worked'" applied to the test suite itself.
--   * **The D2 per-user scope.** Two different users hold marks for the SAME
--     (list, player) simultaneously and neither can see the other's. That is
--     the whole reason the table carries `user_id` instead of `list_players`
--     carrying a `drafted` column, so it gets an explicit positive control.
--   * **The Saved-list case.** A user CAN mark drafted on a list they do not
--     own (u1 on u2's public list, u2 on u1's public list) — D2's stated
--     reason for existing. If a future "tighten it to owners" edit lands,
--     these two lives_ok pins go red.
--   * **The RLS-deferring INSERT policy.** 079's `EXISTS (SELECT 1 FROM
--     lists ...)` has no visibility conjunct: it runs under `lists`'s OWN
--     RLS, so "any list you can read" is the rule. Pinned in both directions
--     — u2 CAN insert on u1's public list, CANNOT on u1's private one.
--   * **UPDATE is denied to EVERYONE, including the row's own user.** 079
--     ships no UPDATE policy because row presence is the state. The pin uses
--     the RETURNING-count pattern from the row's owner, not from a stranger
--     — a stranger being blocked would not prove immutability.
--   * **The composite FK.** A mark for a player not on that list is 23503
--     even privileged, and removing the player from the list cascades every
--     user's mark away.
--   * **Grants.** `authenticated` needs SELECT/INSERT/DELETE via 037's
--     default privileges (D18→D23: no per-object GRANT). The whole feature
--     500s without them and RLS pins would not notice, so they are pinned
--     directly.
--   * **Additivity.** 079 touches no other table: the 001+067 policy sets on
--     `lists` and `list_players` are pinned unchanged.
--
-- Falsifiability map (probed live — see the LV.1.2 PR / PROGRESS session log):
--   dropping `user_id = auth.uid()` from the SELECT policy fails the
--   cross-user read pins (u1-sees-u2, u2-sees-u1, anon); dropping the whole
--   `EXISTS` from the INSERT policy fails the private-list and soft-deleted
--   pins; ADDING an UPDATE policy fails the immutability pins; dropping the
--   composite FK fails the 23503 and cascade pins.
--
-- Determinism: fixed UUIDs, fixed player ids, fixed `drafted_at` literals.
-- All privileged fixture work runs BEFORE any JWT claims are set (set_config
-- persists to txn end — D49(7)). Fixture owners are is_pro: the pre-leagues
-- free-account cap trigger (one private list) fires for every role.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(47);

-- ---------------------------------------------------------------------------
-- A. Shape, policy set, grants (D2's printed DDL + 079's two hardenings)
-- ---------------------------------------------------------------------------
select has_table('public', 'list_player_drafted', 'list_player_drafted exists');
select columns_are('public', 'list_player_drafted',
  array['user_id', 'list_id', 'player_id', 'drafted_at'],
  'exact D2 column set — NO season column (per-list scoping already separates one draft from the next), no mutable payload');
select col_is_pk('public', 'list_player_drafted',
  array['user_id', 'list_id', 'player_id'],
  'PK (user_id, list_id, player_id) — D2 verbatim; row presence IS the state');
select col_not_null('public', 'list_player_drafted', 'drafted_at',
  'drafted_at NOT NULL');
select col_default_is('public', 'list_player_drafted', 'drafted_at', 'now()',
  'drafted_at defaults now() — write-once, never updated');
select fk_ok('public', 'list_player_drafted', 'user_id', 'public', 'profiles', 'id',
  'user_id → profiles (marks die with the account)');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.list_player_drafted'::regclass
     and conname = 'list_player_drafted_list_player_fkey'),
  'FOREIGN KEY (list_id, player_id) REFERENCES list_players(list_id, player_id) ON DELETE CASCADE',
  'composite FK golden-pinned — a mark for a player NOT on that list is impossible on any path, and the mark dies when he leaves the list (079 hardening 1)');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'idx_list_player_drafted_list_player'),
  'CREATE INDEX idx_list_player_drafted_list_player ON public.list_player_drafted USING btree (list_id, player_id)',
  'idx_list_player_drafted_list_player golden-pinned — the composite FK''s cascade lookup is not a PK prefix (§8.1)');
select ok(
  (select rowsecurity from pg_tables
   where schemaname = 'public' and tablename = 'list_player_drafted'),
  'RLS enabled on list_player_drafted');
select policies_are('public', 'list_player_drafted',
  array['list_player_drafted self delete',
        'list_player_drafted self insert',
        'list_player_drafted self read'],
  'exactly THREE policies — NO UPDATE policy (§8.2: an immutable row has none; un-marking is a DELETE)');
select policy_cmd_is('public', 'list_player_drafted',
  'list_player_drafted self read', 'SELECT', 'the read policy is SELECT');
select policy_cmd_is('public', 'list_player_drafted',
  'list_player_drafted self insert', 'INSERT', 'the insert policy is INSERT');
select policy_cmd_is('public', 'list_player_drafted',
  'list_player_drafted self delete', 'DELETE', 'the delete policy is DELETE');

-- Grants: D18→D23 says 037's default privileges cover new tables with no
-- per-object GRANT. Pinned because RLS pins cannot see a missing grant — the
-- feature would 500 for every user with every policy still "passing".
select ok(has_table_privilege('authenticated', 'public.list_player_drafted', 'SELECT'),
  'authenticated has SELECT (037 default privileges, no per-object GRANT — D18→D23)');
select ok(has_table_privilege('authenticated', 'public.list_player_drafted', 'INSERT'),
  'authenticated has INSERT');
select ok(has_table_privilege('authenticated', 'public.list_player_drafted', 'DELETE'),
  'authenticated has DELETE');

-- Additivity (§8.1 "additive-first"): 079 adds a table and NOTHING else.
select policies_are('public', 'lists',
  array['League-shared lists readable by league members',
        'Public lists are viewable by everyone',
        'Users can manage own lists'],
  'lists policy set UNTOUCHED by 079 (001''s two + 067''s one)');
select policies_are('public', 'list_players',
  array['League-shared list players readable by league members',
        'List players follow list visibility',
        'Users can manage players in own lists'],
  'list_players policy set UNTOUCHED by 079 (001''s two + 067''s one)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims, D49(7)).
--    u1 owns: lp1 PUBLIC · lp2 PRIVATE · lp3 PRIVATE soft-DELETED
--    u2 owns: lp4 PUBLIC        u3 = a third signed-in user with no marks
--    players p1, p2 on every list (p2 is the cascade probe's victim).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '84000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-lpd1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lpd_owner_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-lpd2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lpd_other_two"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-lpd3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lpd_third_three"}', now(), now());

update profiles set is_pro = true
where id in ('84000000-0000-4000-8000-000000000001',
             '84000000-0000-4000-8000-000000000002',
             '84000000-0000-4000-8000-000000000003');

insert into players (id, full_name, position) values
  ('pgtap-lpd-p1', 'PgTap LPD RB', 'RB'),
  ('pgtap-lpd-p2', 'PgTap LPD WR', 'WR');

insert into lists (id, owner_id, title, slug, is_private, deleted_at) values
  ('94000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001',
   'lpd u1 public', 'lpd-u1-pub', false, null),
  ('94000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000001',
   'lpd u1 private', 'lpd-u1-priv', true, null),
  ('94000000-0000-4000-8000-000000000003', '84000000-0000-4000-8000-000000000001',
   'lpd u1 private deleted', 'lpd-u1-del', true, now()),
  ('94000000-0000-4000-8000-000000000004', '84000000-0000-4000-8000-000000000002',
   'lpd u2 public', 'lpd-u2-pub', false, null);

insert into list_players (list_id, player_id, position, overall_rank) values
  ('94000000-0000-4000-8000-000000000001', 'pgtap-lpd-p1', 1, 1),
  ('94000000-0000-4000-8000-000000000001', 'pgtap-lpd-p2', 2, 2),
  ('94000000-0000-4000-8000-000000000002', 'pgtap-lpd-p1', 1, 1),
  ('94000000-0000-4000-8000-000000000003', 'pgtap-lpd-p1', 1, 1),
  ('94000000-0000-4000-8000-000000000004', 'pgtap-lpd-p1', 1, 1);

-- u1 and u2 BOTH mark p1 on u1's public list — the D2 per-user scope in one
-- row pair. `drafted_at` is a fixed literal so the immutability epilogue can
-- pin it exactly.
insert into list_player_drafted (user_id, list_id, player_id, drafted_at) values
  ('84000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
   'pgtap-lpd-p1', '2026-08-09T12:00:00Z'),
  ('84000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001',
   'pgtap-lpd-p1', '2026-08-09T12:00:00Z');

-- ---------------------------------------------------------------------------
-- C. Constraint proofs (privileged — at the FK/PK, role-independent).
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from list_player_drafted
   where list_id = '94000000-0000-4000-8000-000000000001'
     and player_id = 'pgtap-lpd-p1'),
  2::bigint,
  'D2 per-user scope: TWO users hold a mark for the SAME (list, player) at once — the reason user_id exists instead of a list_players.drafted column');
select throws_ok(
  $$ insert into list_player_drafted (user_id, list_id, player_id)
     values ('84000000-0000-4000-8000-000000000001',
             '94000000-0000-4000-8000-000000000002',
             'pgtap-lpd-p2') $$,
  '23503', null,
  'a mark for a player NOT on that list is 23503 even PRIVILEGED — the composite FK, not the route, makes an unrenderable mark impossible');
select throws_ok(
  $$ insert into list_player_drafted (user_id, list_id, player_id)
     values ('84000000-0000-4000-8000-000000000001',
             '94000000-0000-4000-8000-000000000001',
             'pgtap-lpd-p1') $$,
  '23505', null,
  're-marking an already-marked player is 23505 — the service maps it to an idempotent no-op, never a duplicate');

-- Cascade: a mark seeded on (lp1, p2), then p2 is removed from the list.
insert into list_player_drafted (user_id, list_id, player_id) values
  ('84000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001',
   'pgtap-lpd-p2');
select is(
  (select count(*) from list_player_drafted where player_id = 'pgtap-lpd-p2'),
  1::bigint,
  'cascade positive control: the (lp1, p2) mark exists before the player is removed');
delete from list_players
where list_id = '94000000-0000-4000-8000-000000000001'
  and player_id = 'pgtap-lpd-p2';
select is(
  (select count(*) from list_player_drafted where player_id = 'pgtap-lpd-p2'),
  0::bigint,
  'removing a player from the list cascades EVERY user''s mark for him on it — no orphan marks survive (079 hardening 1)');
select is(
  (select count(*) from list_player_drafted), 2::bigint,
  'privileged total-rows pin: 2 marks exist — the row-exists guard behind every 0-affected RETURNING-count below');

-- ---------------------------------------------------------------------------
-- D. u1 — own-row reads, the sanctioned writes, and immutability.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "84000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  (select count(*) from list_player_drafted), 1::bigint,
  'u1 sees exactly their OWN 1 mark — u2''s mark on the very same (list, player) is invisible');
select is(
  (select count(*) from list_player_drafted
   where user_id = '84000000-0000-4000-8000-000000000002'),
  0::bigint,
  'u1 reading u2''s marks explicitly returns 0 (not an error, not a leak)');
select lives_ok(
  $$ insert into list_player_drafted (user_id, list_id, player_id)
     values ('84000000-0000-4000-8000-000000000001',
             '94000000-0000-4000-8000-000000000002',
             'pgtap-lpd-p1') $$,
  'u1 marks drafted on their OWN private list');
select lives_ok(
  $$ insert into list_player_drafted (user_id, list_id, player_id)
     values ('84000000-0000-4000-8000-000000000001',
             '94000000-0000-4000-8000-000000000004',
             'pgtap-lpd-p1') $$,
  'THE SAVED-LIST CASE (D2''s reason for existing): u1 marks drafted on u2''s list, recording u1''s marks without editing u2''s list');
select throws_ok(
  $$ insert into list_player_drafted (user_id, list_id, player_id)
     values ('84000000-0000-4000-8000-000000000002',
             '94000000-0000-4000-8000-000000000004',
             'pgtap-lpd-p1') $$,
  '42501', null,
  'user_id spoof (u1 writing a mark AS u2) is 42501 — WITH CHECK pins user_id = auth.uid()');
select throws_ok(
  $$ insert into list_player_drafted (user_id, list_id, player_id)
     values ('84000000-0000-4000-8000-000000000001',
             '94000000-0000-4000-8000-000000000003',
             'pgtap-lpd-p1') $$,
  '42501', null,
  'marking on a SOFT-DELETED list is 42501 even for its owner (who can still SELECT it under 001''s owner arm) — the INSERT policy''s deleted_at conjunct');
select is(
  (select count(*) from list_player_drafted
   where list_id = '94000000-0000-4000-8000-000000000001'),
  1::bigint,
  'SELECT-sees-1 guard: u1''s own mark on lp1 is visible to u1 immediately before the UPDATE probe below');
select results_eq(
  $$ with u as (update list_player_drafted
                set drafted_at = '2030-01-01T00:00:00Z'
                where list_id = '94000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'IMMUTABILITY: u1 updating u1''s OWN visible mark affects 0 rows — 079 ships no UPDATE policy, so row presence is the only state (RETURNING-count; sees 1, changes none)');
select results_eq(
  $$ with d as (delete from list_player_drafted
                where list_id = '94000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from d $$,
  $$ values (1::bigint) $$,
  'u1 un-marks their own mark (RETURNING 1) — the same DELETE policy LV.3.9''s "Clear drafted" uses');

-- ---------------------------------------------------------------------------
-- E. u2 — the other side of every isolation pin.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "84000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  (select count(*) from list_player_drafted
   where list_id = '94000000-0000-4000-8000-000000000001'),
  1::bigint,
  'u2 sees exactly their OWN mark on lp1 — the positive control for u1''s 0-count above, on the identical (list, player)');
select is(
  (select count(*) from list_player_drafted
   where user_id = '84000000-0000-4000-8000-000000000001'),
  0::bigint,
  'u2 reading u1''s marks returns 0 — isolation proven in BOTH directions, not just one');
select throws_ok(
  $$ insert into list_player_drafted (user_id, list_id, player_id)
     values ('84000000-0000-4000-8000-000000000002',
             '94000000-0000-4000-8000-000000000002',
             'pgtap-lpd-p1') $$,
  '42501', null,
  'u2 marking on u1''s PRIVATE list is 42501 — 079''s EXISTS runs under lists'' OWN RLS, so "any list you can read" is the rule and an invisible list is unmarkable');
select results_eq(
  $$ with u as (update list_player_drafted set drafted_at = '2030-01-01T00:00:00Z' returning 1)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'u2 UPDATE across ALL marks affects 0 rows (RETURNING-count over the privileged 2 + u1''s inserts)');
select results_eq(
  $$ with d as (delete from list_player_drafted
                where user_id = '84000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'u2 deleting u1''s marks affects 0 rows — the epilogue proves those rows were there to delete');

-- ---------------------------------------------------------------------------
-- F. u3 (signed in, no marks) and anon — deny-by-default per role (§4.2/§8.2).
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "84000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);

select is(
  (select count(*) from list_player_drafted), 0::bigint,
  'u3 (signed in, no marks of their own) sees ZERO marks — everyone else''s are invisible');
select results_eq(
  $$ with d as (delete from list_player_drafted returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'u3 DELETE across the whole table affects 0 rows');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(
  (select count(*) from list_player_drafted), 0::bigint,
  'anon sees ZERO marks (auth.uid() is NULL — deny-by-default)');
-- Deliberately a row that is otherwise VALID (u3 holds no mark, (lp1, p1) is
-- on the list, lp1 is public) so the 42501 can only be RLS — not the PK and
-- not the composite FK wearing a policy's clothes.
select throws_ok(
  $$ insert into list_player_drafted (user_id, list_id, player_id)
     values ('84000000-0000-4000-8000-000000000003',
             '94000000-0000-4000-8000-000000000001',
             'pgtap-lpd-p1') $$,
  '42501', null,
  'anon INSERT is 42501');
select results_eq(
  $$ with u as (update list_player_drafted set drafted_at = now() returning 1)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'anon UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from list_player_drafted returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE affects 0 rows');

-- ---------------------------------------------------------------------------
-- G. Privileged epilogue — every 0-affected pin above failed against rows
--    that REALLY EXIST, and nothing above mutated anything.
-- ---------------------------------------------------------------------------
reset role;

select is(
  (select count(*) from list_player_drafted), 3::bigint,
  'total rows: u1''s lp1 mark + u2''s lp1 mark + u1''s new lp4 (saved-list) mark — u1''s lp2 mark was self-deleted; every stranger UPDATE/DELETE above was a genuine no-op, not a hit on an empty table');
select is(
  (select count(*) from list_player_drafted
   where user_id = '84000000-0000-4000-8000-000000000001'
     and list_id = '94000000-0000-4000-8000-000000000001'),
  1::bigint,
  'u1''s mark SURVIVED u2''s targeted DELETE — the 0-affected pin in section E was isolation, not absence');
select is(
  (select drafted_at from list_player_drafted
   where user_id = '84000000-0000-4000-8000-000000000001'
     and list_id = '94000000-0000-4000-8000-000000000001'
     and player_id = 'pgtap-lpd-p1'),
  '2026-08-09T12:00:00Z'::timestamptz,
  'drafted_at is byte-identical to the seeded literal — the owner''s own UPDATE and both stranger UPDATEs changed nothing (write-once, D2)');

select * from finish();
rollback;
