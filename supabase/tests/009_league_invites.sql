-- ============================================================================
-- league_invites + invite_slug — migration 055 (spec §7.2/§12.23 + erratum
-- v2.7.1 D46/D48; plan §8.2; task L.A1.4; standing rules tasks-M1 §4).
--
-- Falsifiability notes (§4.3):
--   * league_invites has NO client write path for ANY role — including the
--     commissioner (team_managers/053 shape, not league_members/054's
--     placeholder-seat carve-out, because §12.23's task text names no
--     legitimate client-write shape here): INSERT expects 42501; UPDATE/
--     DELETE (RLS-filtered silently) use the RETURNING-count pattern
--     preceded by a same-role SELECT-sees-N pin (§4.2).
--   * SELECT scope is commish-only, not member-wide (unlike league_members/
--     team_managers) — a non-commish MEMBER counter-pin (u2) proves the
--     policy predicate is is_league_commish, not is_league_member: a
--     member-wide read implementation would fail this pin.
--   * Cross-league counter-pin: L1's commish sees only L1's invites, never
--     L2's, though both counts are nonzero — an is_commish-of-ANY-league
--     implementation (auth.uid() = created_by, or a missing league_id
--     filter) fails this pin.
--   * expires_at boundary: pinned as an exact 14-day offset from the same
--     row's own created_at (both NOW()-defaulted in the same INSERT
--     statement, so they share one snapshot) — a default drifted to 7 or
--     30 days fails this pin exactly.
--   * token/invite_slug UNIQUE run both sides: a duplicate value 23505s;
--     two independently-generated default tokens differ (collision would
--     silently corrude the claim-by-token RPC, L.A1.14).
--   * All privileged-context work (fixtures + constraint boundaries) runs
--     BEFORE any JWT claims are set — set_config(..., true) persists to txn
--     end (D49(7) lesson, 007 precedent).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(55);

-- ---------------------------------------------------------------------------
-- A. leagues.invite_slug (§7.2 path 1).
-- ---------------------------------------------------------------------------
select has_column('public', 'leagues', 'invite_slug', 'invite_slug column exists');
select col_type_is('public', 'leagues', 'invite_slug', 'citext', 'invite_slug is CITEXT');
select col_is_null('public', 'leagues', 'invite_slug', 'invite_slug nullable (falls back to invite_code)');
select col_is_unique('public', 'leagues', array['invite_slug'], 'invite_slug is UNIQUE');

-- ---------------------------------------------------------------------------
-- B. league_invites shape: §12.23 column-for-column + D46 additive pair.
-- ---------------------------------------------------------------------------
select has_table('public', 'league_invites', 'league_invites exists');
select columns_are('public', 'league_invites',
  array['id', 'league_id', 'token', 'target_team_id', 'invited_username',
        'invited_email', 'created_by', 'max_uses', 'use_count', 'expires_at',
        'revoked_at', 'claimed_by', 'claimed_at', 'created_at', 'last_sent_at'],
  'exact §12.23 column set + D46 created_at/last_sent_at');
select col_is_pk('public', 'league_invites', 'id', 'PK id');
select col_not_null('public', 'league_invites', 'league_id', 'league_id NOT NULL');
select fk_ok('public', 'league_invites', 'league_id', 'public', 'leagues', 'id', 'league_id → leagues');
select col_not_null('public', 'league_invites', 'token', 'token NOT NULL');
select col_is_unique('public', 'league_invites', array['token'], 'token is UNIQUE');
select col_type_is('public', 'league_invites', 'target_team_id', 'uuid', 'target_team_id is UUID');
select col_is_null('public', 'league_invites', 'target_team_id', 'target_team_id nullable (NULL = general invite)');
select fk_ok('public', 'league_invites', 'target_team_id', 'public', 'teams', 'id', 'target_team_id → teams');
select col_type_is('public', 'league_invites', 'invited_username', 'citext', 'invited_username is CITEXT');
select col_is_null('public', 'league_invites', 'invited_username', 'invited_username nullable');
select col_type_is('public', 'league_invites', 'invited_email', 'citext', 'invited_email is CITEXT');
select col_is_null('public', 'league_invites', 'invited_email', 'invited_email nullable');
select col_not_null('public', 'league_invites', 'created_by', 'created_by NOT NULL');
select fk_ok('public', 'league_invites', 'created_by', 'public', 'profiles', 'id', 'created_by → profiles');
select col_default_is('public', 'league_invites', 'max_uses', '1', 'max_uses defaults to 1');
select col_default_is('public', 'league_invites', 'use_count', '0', 'use_count defaults to 0');
select col_not_null('public', 'league_invites', 'expires_at', 'expires_at NOT NULL');
select col_is_null('public', 'league_invites', 'revoked_at', 'revoked_at nullable (NULL = live)');
select fk_ok('public', 'league_invites', 'claimed_by', 'public', 'profiles', 'id', 'claimed_by → profiles');
select col_is_null('public', 'league_invites', 'claimed_at', 'claimed_at nullable');
select col_not_null('public', 'league_invites', 'created_at', 'created_at NOT NULL (D46)');
select col_default_is('public', 'league_invites', 'created_at', 'now()', 'created_at defaults to now() (D46)');
select col_is_null('public', 'league_invites', 'last_sent_at', 'last_sent_at nullable (D46 — set on re-send)');
select has_index('public', 'league_invites', 'idx_league_invites_league', 'league index exists');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'league_invites'),
  'RLS enabled on league_invites');
select policies_are('public', 'league_invites',
  array['Invites viewable by commish'],
  'exactly ONE policy — commish SELECT; no client write path for any role (writes via RPCs only)');
select policy_cmd_is('public', 'league_invites', 'Invites viewable by commish', 'SELECT',
  'invite policy is SELECT-only');

-- ---------------------------------------------------------------------------
-- C. Fixtures (postgres context — before any JWT claims).
--    L1: u1 commish, u2 manager (member, NOT commish), u3 non-member.
--    L2: u4 commish — cross-league counter-pin.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-li1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "li_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-li2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "li_manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-li3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "li_nonmember"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'pgtap-li4@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "li_commish2"}', now(), now());

insert into leagues (id, owner_id, name, season) values
  ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001', 'pgtap-li-1', 2026),
  ('a2000000-0000-4000-8000-00000000000b', '72000000-0000-4000-8000-000000000004', 'pgtap-li-2', 2026);

insert into teams (id, owner_id, list_id, name, league_id) values
  ('c2000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002',
   null, 'pgtap-li-team-1', 'a2000000-0000-4000-8000-00000000000a');

insert into league_members (league_id, user_id, team_id, role) values
  ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001',
   null, 'commissioner'),
  ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000002',
   'c2000000-0000-4000-8000-000000000001', 'manager'),
  ('a2000000-0000-4000-8000-00000000000b', '72000000-0000-4000-8000-000000000004',
   null, 'commissioner');

-- L1: one general link invite, one seat-targeted (email), one revoked, one
-- claimed — 4 rows. L2: one invite — the cross-league counter-pin fixture.
insert into league_invites (league_id, target_team_id, invited_email, created_by, max_uses) values
  ('a2000000-0000-4000-8000-00000000000a', null, null,
   '72000000-0000-4000-8000-000000000001', 5),
  ('a2000000-0000-4000-8000-00000000000a', 'c2000000-0000-4000-8000-000000000001',
   'invitee@example.com', '72000000-0000-4000-8000-000000000001', 1);
insert into league_invites (league_id, created_by, revoked_at) values
  ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001', now());
insert into league_invites (league_id, created_by, claimed_by, claimed_at) values
  ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001',
   '72000000-0000-4000-8000-000000000003', now());
insert into league_invites (league_id, created_by) values
  ('a2000000-0000-4000-8000-00000000000b', '72000000-0000-4000-8000-000000000004');

-- ---------------------------------------------------------------------------
-- D. Boundary + uniqueness pins (postgres context).
-- ---------------------------------------------------------------------------
select is(
  (select expires_at - created_at from league_invites
   where league_id = 'a2000000-0000-4000-8000-00000000000a' and max_uses = 5),
  interval '14 days',
  'default expires_at is exactly 14 days past the same row''s created_at (D46 boundary pin)');
select throws_ok(
  $$ insert into league_invites (league_id, created_by, token) values
     ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001',
      (select token from league_invites where league_id = 'a2000000-0000-4000-8000-00000000000a' limit 1)) $$,
  '23505', null,
  'duplicate token rejected (UNIQUE — the claim-by-token RPC depends on this)');
select isnt(
  (select token from league_invites where league_id = 'a2000000-0000-4000-8000-00000000000a' and max_uses = 5),
  (select token from league_invites where league_id = 'a2000000-0000-4000-8000-00000000000a' and target_team_id is not null),
  'two default-generated tokens differ (no accidental collision across fixture rows)');
select throws_ok(
  $$ update leagues set invite_slug = 'pgtap-li-slug'
     where id = 'a2000000-0000-4000-8000-00000000000a';
     update leagues set invite_slug = 'pgtap-li-slug'
     where id = 'a2000000-0000-4000-8000-00000000000b' $$,
  '23505', null,
  'duplicate invite_slug across leagues rejected (UNIQUE)');

-- ---------------------------------------------------------------------------
-- E. RLS per role (§4.2 pattern — commish-only SELECT, no write path).
-- ---------------------------------------------------------------------------
set local role authenticated;

-- commissioner u1: sees exactly L1's 4 invites, never L2's; no writes.
select set_config('request.jwt.claims',
  '{"sub": "72000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*) from league_invites where league_id = 'a2000000-0000-4000-8000-00000000000a'),
  4::bigint,
  'commish sees all 4 of L1''s invites (SELECT-sees-N pin for the counts below)');
select is(
  (select count(*) from league_invites where league_id = 'a2000000-0000-4000-8000-00000000000b'),
  0::bigint,
  'L1 commish sees ZERO of L2''s invites — cross-league counter-pin (rules out an is-commish-of-ANY-league bug)');
select throws_ok(
  $$ insert into league_invites (league_id, created_by)
     values ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'COMMISSIONER INSERT denied — no client write path even for the commish (writes via RPCs only)');
select results_eq(
  $$ with w as (update league_invites set revoked_at = now()
                where league_id = 'a2000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE affects 0 rows (revocation is not client-writable)');
select results_eq(
  $$ with d as (delete from league_invites
                where league_id = 'a2000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE affects 0 rows');

-- manager u2: a MEMBER, but not commish — sees zero (SELECT scope is
-- commish-only, unlike league_members/team_managers' member-wide read).
select set_config('request.jwt.claims',
  '{"sub": "72000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from league_invites where league_id = 'a2000000-0000-4000-8000-00000000000a'),
  0::bigint,
  'non-commish MEMBER sees ZERO invites — counter-pin ruling out a member-wide (is_league_member) SELECT policy');
select throws_ok(
  $$ insert into league_invites (league_id, created_by)
     values ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'manager INSERT denied');
select results_eq(
  $$ with w as (update league_invites set revoked_at = now()
                where league_id = 'a2000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from league_invites
                where league_id = 'a2000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'manager DELETE affects 0 rows');

-- non-member u3: sees nothing anywhere, writes nothing.
select set_config('request.jwt.claims',
  '{"sub": "72000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (select count(*) from league_invites), 0::bigint,
  'non-member sees zero invite rows across every league');
select throws_ok(
  $$ insert into league_invites (league_id, created_by)
     values ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'non-member INSERT denied');
select results_eq(
  $$ with w as (update league_invites set revoked_at = now() returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'non-member UPDATE affects 0 rows');

-- commissioner u4 (L2): sees only L2's 1 invite, never L1's.
select set_config('request.jwt.claims',
  '{"sub": "72000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select count(*) from league_invites where league_id = 'a2000000-0000-4000-8000-00000000000b'),
  1::bigint,
  'L2 commish sees L2''s own invite');
select is(
  (select count(*) from league_invites where league_id = 'a2000000-0000-4000-8000-00000000000a'),
  0::bigint,
  'L2 commish sees ZERO of L1''s invites');

-- anon: sees nothing, writes nothing (is_league_commish is FALSE — auth.uid() NULL).
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*) from league_invites), 0::bigint, 'anon sees zero invite rows');
select throws_ok(
  $$ insert into league_invites (league_id, created_by)
     values ('a2000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon INSERT denied');
select results_eq(
  $$ with w as (update league_invites set revoked_at = now() returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from league_invites returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE affects 0 rows');
reset role;

select * from finish();
rollback;
