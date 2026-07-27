-- ============================================================================
-- League state server-authoritative — migration 054 (Q8 ruling / R37–R40,
-- R43, R46; spec erratum v2.8.2; plan §8.2; standing rules tasks-M1 §4).
--
-- Falsifiability notes (§4.3):
--   * The two review break-ins are reproduced VERBATIM as denial pins: the
--     R37 forged-snapshot probe (client INSERT leagues; owner UPDATE of
--     scoring_rules_snapshot + status='drafting'; owner hard DELETE) and
--     the R38 reseat probe (commish UPDATE of league_members.team_id).
--     Re-creating 001's "League owners can manage" or 052's "Commish
--     manages members" FOR ALL policies fails these exactly.
--   * Legitimate paths pinned positive: owner still SELECTs their league
--     (the swap policy's owner branch — fails if 054 over-dropped);
--     until the L.A1.12–15 RPCs exist, NO path writes team_id — pinned
--     across every client role and both verbs (INSERT shape + UPDATE).
--   * New CHECKs boundary-tested both sides: teams.status accepts all
--     three §12.22 values and rejects others (23514); self-succession
--     rejected, a REAL successor accepted (a CHECK that rejects all
--     non-NULL successors fails the positive pin). Longer cycles are
--     deliberately NOT DB-guarded — retire_franchise's in-body duty (D53).
--   * R46: the one_open_stint_per_team UPDATE path pinned — reopening a
--     closed stint while another is open throws 23505 (an INSERT-only
--     trigger reimplementation of the invariant fails here).
--   * All privileged-context work runs BEFORE any JWT claims are set
--     (D49(7) lesson).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

-- ---------------------------------------------------------------------------
-- A. Constraint + index shape (054).
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_constraint
          where conname = 'teams_status_valid' and conrelid = 'public.teams'::regclass),
  'teams_status_valid CHECK exists (R43)');
select ok(
  exists (select 1 from pg_constraint
          where conname = 'teams_successor_not_self' and conrelid = 'public.teams'::regclass),
  'teams_successor_not_self CHECK exists (R40)');
select has_index('public', 'team_managers', 'idx_team_managers_league',
  'team_managers.league_id indexed (R39 — SELECT-policy argument + history queries)');
select has_index('public', 'team_managers', 'idx_team_managers_team',
  'team_managers.team_id fully indexed (R39 — the partial index only covers open stints)');
select has_index('public', 'league_members', 'idx_league_members_team',
  'league_members.team_id indexed (R39 — teams ON DELETE SET NULL path)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims).
--    u1 commish+owner L1 (open stint on T2) · u2 manager L1 (team T1, closed
--    u1 stint + open u2 stint) · u3 outsider.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-sa1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "sa_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-sa2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "sa_manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-sa3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "sa_outsider"}', now(), now());

insert into leagues (id, owner_id, name, season, scoring_rules_snapshot) values
  ('a4000000-0000-4000-8000-00000000000a', '74000000-0000-4000-8000-000000000001',
   'pgtap-sa-1', 2026, null);

insert into teams (id, owner_id, list_id, name, league_id) values
  ('c4000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000002',
   null, 'pgtap-sa-team-1', 'a4000000-0000-4000-8000-00000000000a'),
  ('c4000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000001',
   null, 'pgtap-sa-team-2', 'a4000000-0000-4000-8000-00000000000a');

insert into league_members (id, league_id, user_id, team_id, role) values
  ('d4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000000a',
   '74000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 'commissioner'),
  ('d4000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-00000000000a',
   '74000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000001', 'manager');

insert into team_managers (league_id, team_id, user_id, started_at, ended_at, end_reason, ended_by) values
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000001',
   '74000000-0000-4000-8000-000000000001',
   '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z', 'replaced', '74000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000001',
   '74000000-0000-4000-8000-000000000002', '2026-07-10T00:00:00Z', null, null, null),
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000002',
   '74000000-0000-4000-8000-000000000001', '2026-07-01T00:00:00Z', null, null, null);

-- ---------------------------------------------------------------------------
-- C. CHECK boundaries (postgres context — constraints bind every role).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update teams set status = 'orphaned'
     where id = 'c4000000-0000-4000-8000-000000000001' $$,
  $$status 'orphaned' accepted$$);
select lives_ok(
  $$ update teams set status = 'retired', retired_at_week = 3,
       successor_team_id = 'c4000000-0000-4000-8000-000000000002'
     where id = 'c4000000-0000-4000-8000-000000000001' $$,
  $$status 'retired' + a REAL successor accepted — a CHECK rejecting all non-NULL successors fails here$$);
select lives_ok(
  $$ update teams set status = 'active', retired_at_week = null,
       successor_team_id = null
     where id = 'c4000000-0000-4000-8000-000000000001' $$,
  $$status 'active' accepted (fixture restored)$$);
select throws_ok(
  $$ update teams set status = 'banana'
     where id = 'c4000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  $$status outside the §12.22 enum rejected (R43 — 'banana' was accepted pre-054, live-proven in review)$$);
select throws_ok(
  $$ update teams set successor_team_id = id
     where id = 'c4000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'a team as its OWN successor rejected (R40 — accepted pre-054, live-proven in review)');

-- R46: the one-open-stint invariant on the UPDATE path — reopening the
-- closed u1 stint on T1 while u2's stint is open throws (the partial unique
-- index covers UPDATE; an INSERT-only trigger reimplementation fails here).
select throws_ok(
  $$ update team_managers set ended_at = null
     where team_id = 'c4000000-0000-4000-8000-000000000001'
       and user_id = '74000000-0000-4000-8000-000000000001' $$,
  '23505', null,
  'reopening a closed stint while another is open throws 23505 (R46 — UPDATE path of one_open_stint_per_team)');

-- ---------------------------------------------------------------------------
-- D. R37 reproduced as denial pins (JWT claims from here on).
--    The exact review break-in: INSERT a league, forge snapshot + status.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "74000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  (select count(*) from leagues where name = 'pgtap-sa-1'), 1::bigint,
  'owner still SELECTs their league (the swap policy''s owner branch — 054 dropped only the write surface)');
select throws_ok(
  $$ insert into leagues (owner_id, name, season)
     values ('74000000-0000-4000-8000-000000000001', 'pgtap-sa-forged', 2026) $$,
  '42501', null,
  'client INSERT of a leagues row denied — league creation is create_league RPC only (R37 step 1 now fails)');
select results_eq(
  $$ with w as (update leagues
                set scoring_rules_snapshot = '{"forged": true}', status = 'drafting'
                where name = 'pgtap-sa-1' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'owner UPDATE forging scoring_rules_snapshot + status affects 0 rows (R37 step 2 — the exact review probe — now fails)');
select results_eq(
  $$ with w as (update leagues set name = 'pgtap-sa-renamed'
                where name = 'pgtap-sa-1' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'owner UPDATE of ANY league column affects 0 rows (no client write path at all, not a column carve-out)');
select results_eq(
  $$ with d as (delete from leagues where name = 'pgtap-sa-1' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'owner hard DELETE affects 0 rows (rule-8 soft delete via the §15.1 RPC; no cascade wipe of members/stints)');

-- ---------------------------------------------------------------------------
-- E. R38 reproduced: NO client path writes league_members.team_id, any role.
-- ---------------------------------------------------------------------------
-- commish (also the leagues owner):
select results_eq(
  $$ with w as (update league_members
                set team_id = 'c4000000-0000-4000-8000-000000000002'
                where id = 'd4000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commish UPDATE reseating a member affects 0 rows (the exact R38 review probe — no stint-less cache writes)');
select results_eq(
  $$ with w as (update league_members set role = 'co_commissioner'
                where id = 'd4000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commish UPDATE of a member role affects 0 rows (role grants go through set_member_role — 063/L.A1.15)');
select throws_ok(
  $$ insert into league_members (league_id, user_id, team_id, is_placeholder)
     values ('a4000000-0000-4000-8000-00000000000a', null,
             'c4000000-0000-4000-8000-000000000002', true) $$,
  '42501', null,
  'commish INSERT with team_id set denied (seating via INSERT closed too)');

-- member u2 (self-serve angle):
select set_config('request.jwt.claims',
  '{"sub": "74000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update league_members set team_id = null
                where user_id = '74000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'member UPDATE of own seat affects 0 rows');

-- outsider u3:
select set_config('request.jwt.claims',
  '{"sub": "74000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update league_members
                set team_id = 'c4000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'outsider UPDATE affects 0 rows');
select throws_ok(
  $$ insert into leagues (owner_id, name, season)
     values ('74000000-0000-4000-8000-000000000003', 'pgtap-sa-outsider', 2026) $$,
  '42501', null,
  'non-owner league INSERT denied too (no INSERT policy for any client role)');

-- anon:
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ insert into leagues (owner_id, name, season)
     values ('74000000-0000-4000-8000-000000000001', 'pgtap-sa-anon', 2026) $$,
  '42501', null, 'anon league INSERT denied');
select results_eq(
  $$ with w as (update leagues set status = 'drafting' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon leagues UPDATE affects 0 rows');
select results_eq(
  $$ with w as (update league_members
                set team_id = 'c4000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon league_members UPDATE affects 0 rows');
reset role;

-- ---------------------------------------------------------------------------
-- F. Server path unharmed: privileged (RPC-context) writes still work.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update leagues set status = 'scheduled'
     where id = 'a4000000-0000-4000-8000-00000000000a' $$,
  'privileged UPDATE of leagues still works (the SECURITY DEFINER RPC path is unaffected)');
-- Reconciled 2026-07-26 (L.A1.15 landed): the shape below is the one
-- remove_manager(vacate)/leave_league actually write — user_id NULL,
-- is_placeholder TRUE, **team_id KEPT** (the franchise stays attached to the
-- seat; the old `team_id = null` shape was the 054 client carve-out's, which
-- 063 dropped — D74(3)). Pins the RPC path is unaffected by the client
-- denials above.
select lives_ok(
  $$ update league_members set is_placeholder = true, user_id = null
     where id = 'd4000000-0000-4000-8000-000000000002' $$,
  'privileged vacate of league_members still works (the shape remove_manager(vacate) writes: seat opened, team_id kept)');
select is(
  (select team_id from league_members where id = 'd4000000-0000-4000-8000-000000000002'),
  'c4000000-0000-4000-8000-000000000001'::uuid,
  'and the franchise is still attached to the vacated seat (a seat with no team is invisible to every capacity check — the reason 063 dropped the carve-out policies)');

select * from finish();
rollback;
