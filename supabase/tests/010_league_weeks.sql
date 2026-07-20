-- ============================================================================
-- league_weeks — migration 056 (spec §12.17/§23.4; plan §8.2; task L.A1.5;
-- standing rules tasks-M1 §4).
--
-- Numbering note: tasks-M1's task text names this "pgTAP 009" — stale by
-- the time this task ran, since 009 was already taken by league_invites
-- (L.A1.4, landed same session). Next free pgTAP number at task time is
-- 010, same class of drift already flagged elsewhere in that doc for
-- migration numbers ("task-text mentions ... read through this table").
--
-- Falsifiability notes (§4.3):
--   * league_weeks has NO client write path for ANY role — including the
--     commissioner (team_managers/053, league_invites/055 shape, not
--     league_members/054's placeholder-seat carve-out): INSERT expects
--     42501; UPDATE/DELETE (RLS-filtered silently) use the RETURNING-count
--     pattern preceded by a same-role SELECT-sees-N pin (§4.2).
--   * status CHECK boundary runs all four legal values (each inserted
--     live) plus one past the edge ('banana', the exact R43 counter-
--     example) rejected 23514 — a comment-only "constraint" (§12.17's
--     printed form) would accept the fifth value silently.
--   * (season, week) → nfl_weeks FK boundary runs both sides: a real
--     seeded (2026, 1) succeeds; a nonexistent (2026, 97) throws 23503 —
--     an unconstrained season/week pair (§12.17's printed form) would
--     accept the bogus pair silently.
--   * Cross-league counter-pin: L1's member sees only L1's weeks, never
--     L2's, though both counts are nonzero.
--   * All privileged-context work (fixtures + constraint boundaries) runs
--     BEFORE any JWT claims are set — set_config(..., true) persists to
--     txn end (D49(7) lesson, 007/009 precedent).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(44);

-- ---------------------------------------------------------------------------
-- A. league_weeks shape: §12.17 column-for-column + the two additive pins.
-- ---------------------------------------------------------------------------
select has_table('public', 'league_weeks', 'league_weeks exists');
select columns_are('public', 'league_weeks',
  array['id', 'league_id', 'season', 'week', 'status', 'median_score',
        'waivers_processed_at', 'finalized_at', 'reopened_by_action_id'],
  'exact §12.17 column set');
select col_is_pk('public', 'league_weeks', 'id', 'PK id');
select col_not_null('public', 'league_weeks', 'league_id', 'league_id NOT NULL');
select fk_ok('public', 'league_weeks', 'league_id', 'public', 'leagues', 'id', 'league_id → leagues');
select col_not_null('public', 'league_weeks', 'season', 'season NOT NULL');
select col_not_null('public', 'league_weeks', 'week', 'week NOT NULL');
select col_not_null('public', 'league_weeks', 'status', 'status NOT NULL');
select col_default_is('public', 'league_weeks', 'status', 'upcoming', $$status defaults to 'upcoming'$$);
select col_type_is('public', 'league_weeks', 'median_score', 'numeric(8,2)', 'median_score is NUMERIC(8,2)');
select col_is_null('public', 'league_weeks', 'median_score', 'median_score nullable (set at finalization)');
select col_is_null('public', 'league_weeks', 'waivers_processed_at', 'waivers_processed_at nullable');
select col_is_null('public', 'league_weeks', 'finalized_at', 'finalized_at nullable');
select col_type_is('public', 'league_weeks', 'reopened_by_action_id', 'uuid', 'reopened_by_action_id is UUID');
select col_is_null('public', 'league_weeks', 'reopened_by_action_id', 'reopened_by_action_id nullable');
select col_is_unique('public', 'league_weeks', array['league_id', 'season', 'week'],
  'UNIQUE(league_id, season, week)');
select has_index('public', 'league_weeks', 'idx_league_weeks_league', 'league index exists');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'league_weeks'),
  'RLS enabled on league_weeks');
select policies_are('public', 'league_weeks',
  array['League weeks viewable by members'],
  'exactly ONE policy — member SELECT; no client write path for any role (writes via cron jobs only)');
select policy_cmd_is('public', 'league_weeks', 'League weeks viewable by members', 'SELECT',
  'league_weeks policy is SELECT-only');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims).
--    L1: u1 commish, u2 manager (member, not commish). L2: u3 commish —
--    cross-league counter-pin. Both leagues get real nfl_weeks rows.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-lw1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lw_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-lw2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lw_manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-lw3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lw_commish2"}', now(), now());

insert into leagues (id, owner_id, name, season) values
  ('a3000000-0000-4000-8000-00000000000a', '73000000-0000-4000-8000-000000000001', 'pgtap-lw-1', 2026),
  ('a3000000-0000-4000-8000-00000000000b', '73000000-0000-4000-8000-000000000003', 'pgtap-lw-2', 2026);

insert into league_members (league_id, user_id, team_id, role) values
  ('a3000000-0000-4000-8000-00000000000a', '73000000-0000-4000-8000-000000000001', null, 'commissioner'),
  ('a3000000-0000-4000-8000-00000000000a', '73000000-0000-4000-8000-000000000002', null, 'manager'),
  ('a3000000-0000-4000-8000-00000000000b', '73000000-0000-4000-8000-000000000003', null, 'commissioner');

-- L1: weeks 1 and 2 (real nfl_weeks rows per the 039 2026 seed). L2: week 1.
insert into league_weeks (league_id, season, week) values
  ('a3000000-0000-4000-8000-00000000000a', 2026, 1),
  ('a3000000-0000-4000-8000-00000000000a', 2026, 2);
insert into league_weeks (league_id, season, week) values
  ('a3000000-0000-4000-8000-00000000000b', 2026, 1);

-- ---------------------------------------------------------------------------
-- C. Boundary pins (postgres context).
-- ---------------------------------------------------------------------------
-- status CHECK: all four legal values live; one past the edge rejected.
select lives_ok(
  $$ update league_weeks set status = 'live'
     where league_id = 'a3000000-0000-4000-8000-00000000000a' and week = 1 $$,
  $$status = 'live' accepted$$);
select lives_ok(
  $$ update league_weeks set status = 'correction_window'
     where league_id = 'a3000000-0000-4000-8000-00000000000a' and week = 1 $$,
  $$status = 'correction_window' accepted$$);
select lives_ok(
  $$ update league_weeks set status = 'final'
     where league_id = 'a3000000-0000-4000-8000-00000000000a' and week = 1 $$,
  $$status = 'final' accepted$$);
select lives_ok(
  $$ update league_weeks set status = 'upcoming'
     where league_id = 'a3000000-0000-4000-8000-00000000000a' and week = 1 $$,
  $$status = 'upcoming' accepted (back to default)$$);
select throws_ok(
  $$ update league_weeks set status = 'banana'
     where league_id = 'a3000000-0000-4000-8000-00000000000a' and week = 1 $$,
  '23514', null,
  $$status = 'banana' rejected (R43 counter-example — the comment-only enum in §12.17's printed DDL would accept this)$$);

-- (season, week) → nfl_weeks FK: real pair succeeds, bogus pair 23503s.
select lives_ok(
  $$ insert into league_weeks (league_id, season, week) values
     ('a3000000-0000-4000-8000-00000000000a', 2026, 3) $$,
  'a real seeded (season, week) pair (2026, 3) is accepted');
select throws_ok(
  $$ insert into league_weeks (league_id, season, week) values
     ('a3000000-0000-4000-8000-00000000000a', 2026, 97) $$,
  '23503', null,
  'a nonexistent NFL week (2026, 97) is rejected — league_weeks cannot reference a week nfl_weeks has no record of');

-- UNIQUE(league_id, season, week): duplicate triple rejected; same week
-- different league coexists (already true from the L2 fixture above).
select throws_ok(
  $$ insert into league_weeks (league_id, season, week) values
     ('a3000000-0000-4000-8000-00000000000a', 2026, 1) $$,
  '23505', null,
  'duplicate (league_id, season, week) rejected');
select is(
  (select count(*) from league_weeks
   where league_id = 'a3000000-0000-4000-8000-00000000000b' and week = 1),
  1::bigint,
  'a different league can independently have week 1 (UNIQUE is per-league, not global)');

-- ---------------------------------------------------------------------------
-- D. RLS per role (§4.2 pattern — member SELECT, no write path for ANY role).
-- ---------------------------------------------------------------------------
set local role authenticated;

-- commissioner u1: sees exactly L1's 3 weeks (1,2,3), never L2's; no writes.
select set_config('request.jwt.claims',
  '{"sub": "73000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*) from league_weeks where league_id = 'a3000000-0000-4000-8000-00000000000a'),
  3::bigint,
  'commish sees all 3 of L1''s weeks (SELECT-sees-N pin for the counts below)');
select is(
  (select count(*) from league_weeks where league_id = 'a3000000-0000-4000-8000-00000000000b'),
  0::bigint,
  'L1 commish sees ZERO of L2''s weeks — cross-league counter-pin');
select throws_ok(
  $$ insert into league_weeks (league_id, season, week) values
     ('a3000000-0000-4000-8000-00000000000a', 2026, 4) $$,
  '42501', null,
  'COMMISSIONER INSERT denied — no client write path even for the commish (writes via cron jobs only)');
select results_eq(
  $$ with w as (update league_weeks set status = 'live'
                where league_id = 'a3000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE affects 0 rows (finalization state is not client-writable)');
select results_eq(
  $$ with d as (delete from league_weeks
                where league_id = 'a3000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE affects 0 rows');

-- manager u2: a MEMBER, not commish — still sees the league's weeks
-- (unlike league_invites, this SELECT scope is member-wide per §12.17).
select set_config('request.jwt.claims',
  '{"sub": "73000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from league_weeks where league_id = 'a3000000-0000-4000-8000-00000000000a'),
  3::bigint,
  'member sees all 3 of L1''s weeks (is_league_member, not is_league_commish)');
select throws_ok(
  $$ insert into league_weeks (league_id, season, week) values
     ('a3000000-0000-4000-8000-00000000000a', 2026, 4) $$,
  '42501', null, 'manager INSERT denied');
select results_eq(
  $$ with w as (update league_weeks set status = 'live'
                where league_id = 'a3000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from league_weeks
                where league_id = 'a3000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'manager DELETE affects 0 rows');

-- commissioner u3 (L2): sees only L2's 1 week, never L1's.
select set_config('request.jwt.claims',
  '{"sub": "73000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (select count(*) from league_weeks where league_id = 'a3000000-0000-4000-8000-00000000000b'),
  1::bigint,
  'L2 commish sees L2''s own week');
select is(
  (select count(*) from league_weeks where league_id = 'a3000000-0000-4000-8000-00000000000a'),
  0::bigint,
  'L2 commish sees ZERO of L1''s weeks');

-- anon: sees nothing, writes nothing (is_league_member is FALSE — auth.uid() NULL).
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*) from league_weeks), 0::bigint, 'anon sees zero league_weeks rows');
select throws_ok(
  $$ insert into league_weeks (league_id, season, week) values
     ('a3000000-0000-4000-8000-00000000000a', 2026, 4) $$,
  '42501', null, 'anon INSERT denied');
select results_eq(
  $$ with w as (update league_weeks set status = 'live' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from league_weeks returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE affects 0 rows');
reset role;

select * from finish();
rollback;
