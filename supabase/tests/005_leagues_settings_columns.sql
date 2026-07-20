-- ============================================================================
-- leagues settings columns + Q4/Q7 username contract — migration 040
-- (M1 task L.A1.1; spec §12.1 + v2.8/v2.8.1 rulings; standing rules §4.2/§4.3).
--
-- Falsifiability notes:
--   * Shape/default pins are literals (golden), not recomputed — the
--     roster_settings default is pinned by INSERTING a row and jsonb-equality
--     against the canonical §7.3.2 literal (jsonb normalizes key order, so a
--     DDL-string match would be fragile; the behavioral pin is exact).
--   * team_count and username CHECK boundaries are tested at the edge and one
--     past it, both directions (8/16 live; 7/9/18 throw · 5/20 live; 4/21
--     throw).
--   * RLS reads are asserted POSITIVELY under an owner JWT before the deny
--     tests (R7 lesson: a policy rewritten to USING(false) must fail here,
--     not just policy-name pins); writes are denied via RETURNING-count.
--   * Signup safety is behavioral: real auth.users inserts drive
--     handle_new_user — the no-metadata fallback passes the new CHECK, and
--     hostile metadata skips the profile WITHOUT breaking the auth insert.
--   * Ordering: every privileged-context (postgres) test runs BEFORE any
--     request.jwt.claims is set — set_config(..., true) persists to txn end,
--     and auth.role() would then read 'authenticated', flipping the
--     namespace guard on for what should be privileged writes.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(72);

-- ---------------------------------------------------------------------------
-- A. Extension + leagues shape (spec §12.1)
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_extension where extname = 'citext'),
  'citext extension installed (needed by 043)');

select columns_are('public', 'leagues',
  array['id', 'owner_id', 'name', 'description', 'max_teams',
        'scoring_system_id', 'roster_settings', 'invite_code', 'is_active',
        'season', 'created_at', 'updated_at',
        'status', 'format', 'team_count', 'regular_season_weeks',
        'playoff_teams', 'playoff_start_week', 'waiver_type', 'faab_budget',
        'trade_review', 'trade_deadline_week', 'lineup_lock', 'settings',
        'scoring_rules_snapshot', 'deleted_at'],
  'leagues = the 12 001 columns + the 14 §12.1 columns, exactly');

select col_default_is('public', 'leagues', 'status', 'setup', 'status defaults to setup');
select col_default_is('public', 'leagues', 'format', 'redraft', 'format defaults to redraft');
select col_default_is('public', 'leagues', 'team_count', '12', 'team_count defaults to 12');
select col_default_is('public', 'leagues', 'regular_season_weeks', '14', 'regular_season_weeks defaults to 14');
select col_default_is('public', 'leagues', 'playoff_teams', '6', 'playoff_teams defaults to 6');
select col_default_is('public', 'leagues', 'playoff_start_week', '15', 'playoff_start_week defaults to 15');
select col_default_is('public', 'leagues', 'waiver_type', 'faab', 'waiver_type defaults to faab');
select col_default_is('public', 'leagues', 'faab_budget', '100', 'faab_budget defaults to 100');
select col_default_is('public', 'leagues', 'trade_review', 'commissioner', 'trade_review defaults to commissioner');
select col_default_is('public', 'leagues', 'lineup_lock', 'per_player_kickoff', 'lineup_lock defaults to per_player_kickoff');
select col_default_is('public', 'leagues', 'settings', '{}', 'settings defaults to empty object');

select col_not_null('public', 'leagues', 'status', 'status NOT NULL');
select col_not_null('public', 'leagues', 'format', 'format NOT NULL');
select col_not_null('public', 'leagues', 'team_count', 'team_count NOT NULL');
select col_not_null('public', 'leagues', 'regular_season_weeks', 'regular_season_weeks NOT NULL');
select col_not_null('public', 'leagues', 'playoff_teams', 'playoff_teams NOT NULL');
select col_not_null('public', 'leagues', 'playoff_start_week', 'playoff_start_week NOT NULL');
select col_not_null('public', 'leagues', 'waiver_type', 'waiver_type NOT NULL');
select col_not_null('public', 'leagues', 'faab_budget', 'faab_budget NOT NULL');
select col_not_null('public', 'leagues', 'trade_review', 'trade_review NOT NULL');
select col_not_null('public', 'leagues', 'lineup_lock', 'lineup_lock NOT NULL');
select col_not_null('public', 'leagues', 'settings', 'settings NOT NULL');
select col_is_null('public', 'leagues', 'scoring_rules_snapshot', 'scoring_rules_snapshot nullable (pre-drafting, §7.3.8)');
select col_is_null('public', 'leagues', 'trade_deadline_week', 'trade_deadline_week nullable ("none" allowed)');
select col_is_null('public', 'leagues', 'deleted_at', 'deleted_at nullable (soft delete)');

select col_type_is('public', 'leagues', 'status', 'text', 'status is TEXT');
select col_type_is('public', 'leagues', 'format', 'text', 'format is TEXT');
select col_type_is('public', 'leagues', 'team_count', 'integer', 'team_count is INTEGER');
select col_type_is('public', 'leagues', 'regular_season_weeks', 'integer', 'regular_season_weeks is INTEGER');
select col_type_is('public', 'leagues', 'playoff_teams', 'integer', 'playoff_teams is INTEGER');
select col_type_is('public', 'leagues', 'playoff_start_week', 'integer', 'playoff_start_week is INTEGER');
select col_type_is('public', 'leagues', 'waiver_type', 'text', 'waiver_type is TEXT');
select col_type_is('public', 'leagues', 'faab_budget', 'integer', 'faab_budget is INTEGER');
select col_type_is('public', 'leagues', 'trade_review', 'text', 'trade_review is TEXT');
select col_type_is('public', 'leagues', 'trade_deadline_week', 'integer', 'trade_deadline_week is INTEGER');
select col_type_is('public', 'leagues', 'lineup_lock', 'text', 'lineup_lock is TEXT');
select col_type_is('public', 'leagues', 'settings', 'jsonb', 'settings is JSONB');
select col_type_is('public', 'leagues', 'scoring_rules_snapshot', 'jsonb', 'scoring_rules_snapshot is JSONB');
select col_type_is('public', 'leagues', 'deleted_at', 'timestamp with time zone', 'deleted_at is TIMESTAMPTZ');

-- ---------------------------------------------------------------------------
-- B. Seed real auth users → handle_new_user drives profiles (signup safety)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-u1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "seed_owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-u2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "other_user"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-u3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'pgtap-u4@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "Bad"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'pgtap-u5@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "evil-ai"}', now(), now());

select is(
  (select count(*) from profiles
   where username in ('seed_owner', 'other_user')),
  2::bigint,
  'handle_new_user created both metadata-named profiles (5–20 charset OK)');

select ok(
  (select username ~ '^user_[0-9a-f]{8}$' from profiles
   where id = '30000000-0000-4000-8000-000000000003'),
  'no-metadata signup gets the user_<8hex> fallback — passes the new CHECK');

select ok(
  (select username = 'user_40000000' from profiles
   where id = '40000000-0000-4000-8000-000000000004'),
  'contract-violating metadata username: signup survives, profile gets the FALLBACK (049 — was profile-skipped pre-fix)');

-- The Q7.1 critical pin (review-found bypass): the signup trigger runs with
-- auth.role() NULL, so the 040 namespace guard cannot fire — 049's in-trigger
-- validation is the only thing between public signup metadata and a minted
-- '*-ai' handle. Reverting 049 to 048's body fails this test.
select ok(
  (select username = 'user_50000000' from profiles
   where id = '50000000-0000-4000-8000-000000000005'),
  'persona-pattern signup metadata (evil-ai) gets the FALLBACK — an anonymous signup can never mint a *-ai handle (Q7.1, 049)');

-- ---------------------------------------------------------------------------
-- C. team_count CHECK boundaries + roster_settings default golden pin
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into leagues (owner_id, name, season, team_count)
     values ('10000000-0000-4000-8000-000000000001', 'pgtap-8', 2026, 8) $$,
  'team_count 8 accepted (lower edge)');
select lives_ok(
  $$ insert into leagues (owner_id, name, season, team_count)
     values ('10000000-0000-4000-8000-000000000001', 'pgtap-16', 2026, 16) $$,
  'team_count 16 accepted (upper edge)');
select throws_ok(
  $$ insert into leagues (owner_id, name, season, team_count)
     values ('10000000-0000-4000-8000-000000000001', 'pgtap-7', 2026, 7) $$,
  '23514', null, 'team_count 7 rejected (one past the lower edge)');
select throws_ok(
  $$ insert into leagues (owner_id, name, season, team_count)
     values ('10000000-0000-4000-8000-000000000001', 'pgtap-9', 2026, 9) $$,
  '23514', null, 'team_count 9 rejected (odd counts are v1.1)');
select throws_ok(
  $$ insert into leagues (owner_id, name, season, team_count)
     values ('10000000-0000-4000-8000-000000000001', 'pgtap-18', 2026, 18) $$,
  '23514', null, 'team_count 18 rejected (18/20 are v1.1)');

insert into leagues (owner_id, name, season)
values ('10000000-0000-4000-8000-000000000001', 'pgtap-default', 2026);
select is(
  (select roster_settings from leagues where name = 'pgtap-default'),
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 2}, {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1}, {"key": "flex", "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"], "count": 1}, {"key": "k", "label": "K", "eligible": ["K"], "count": 1}, {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}], "bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb,
  'roster_settings default = the §7.3.2 canonical 12-team shape (golden pin, C9)');

-- ---------------------------------------------------------------------------
-- D. leagues RLS surface unchanged by 040 (041 owns the policy swap)
-- ---------------------------------------------------------------------------
select policies_are('public', 'leagues',
  array['Leagues are viewable by members', 'League owners can manage'],
  '040 changes NO leagues policies — the 001 pair is intact for 041 to swap');

select is((select count(*) from leagues where name like 'pgtap-%'), 3::bigint,
  'service view: 3 seeded fixture leagues exist (SELECT-sees pin before deny tests; scoped so real local rows never false-red this)');

-- ---------------------------------------------------------------------------
-- E. Username contract: constraint, index, boundaries (privileged context)
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_constraint
          where conname = 'profiles_username_format_check'
            and conrelid = 'public.profiles'::regclass),
  'profiles_username_format_check exists');
select has_index('public', 'profiles', 'profiles_username_lower_key',
  'lower(username) index exists (Q4: case-insensitive uniqueness)');
select index_is_unique('public', 'profiles', 'profiles_username_lower_key',
  'lower(username) index is UNIQUE');
select ok(
  (select pg_get_indexdef(indexrelid) from pg_index
   where indexrelid = 'public.profiles_username_lower_key'::regclass)
    ~ 'lower\(',
  'the index expression really is lower(username) — a plain (username) index under the same name fails here (review-proven gap)');

select throws_ok(
  $$ update profiles set username = 'abcd'
     where id = '30000000-0000-4000-8000-000000000003' $$,
  '23514', null, '4-char username rejected (one past the 5 minimum)');
select throws_ok(
  $$ update profiles set username = 'aaaaaaaaaaaaaaaaaaaaa'
     where id = '30000000-0000-4000-8000-000000000003' $$,
  '23514', null, '21-char username rejected (one past the 20 maximum)');
select throws_ok(
  $$ update profiles set username = 'Abcde'
     where id = '30000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'uppercase rejected (charset is [a-z0-9_])');
select throws_ok(
  $$ update profiles set username = 'my-name'
     where id = '30000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'hyphen without the -ai suffix rejected (human charset is hyphen-free)');
select throws_ok(
  $$ update profiles set username = 'bad--name-ai'
     where id = '30000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'malformed persona handle (empty segment) rejected');
select lives_ok(
  $$ update profiles set username = 'abcde'
     where id = '30000000-0000-4000-8000-000000000003' $$,
  '5-char username accepted (lower edge)');
select lives_ok(
  $$ update profiles set username = 'aaaaaaaaaaaaaaaaaaaa'
     where id = '30000000-0000-4000-8000-000000000003' $$,
  '20-char username accepted (upper edge)');
select lives_ok(
  $$ update profiles set username = 'pgtap-test-ai'
     where id = '30000000-0000-4000-8000-000000000003' $$,
  'persona-pattern handle accepted for a PRIVILEGED writer (Q7.1 exemption)');

select has_trigger('public', 'profiles', 'trg_guard_username_namespace',
  'namespace guard trigger installed');

-- ---------------------------------------------------------------------------
-- F. Client-context behavior (JWT claims set from here on — LAST section)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is((select count(*) from leagues where name like 'pgtap-%'), 3::bigint,
  'owner sees own fixture leagues (positive read — falsifiable against USING(false))');

select set_config('request.jwt.claims',
  '{"sub": "20000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is((select count(*) from leagues where name like 'pgtap-%'), 0::bigint,
  'non-owner non-member sees no fixture leagues (001 policy still gates the new columns)');
select results_eq(
  $$ with w as (update leagues set name = 'hijacked' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'non-owner UPDATE affects 0 rows (RETURNING-count deny pattern)');

select throws_ok(
  $$ update profiles set username = 'evil-ai'
     where id = '20000000-0000-4000-8000-000000000002' $$,
  '23514', null,
  'authenticated user cannot take a *-ai handle (namespace guard, Q7.1)');
select throws_ok(
  $$ update profiles set username = 'evil-twin-ai'
     where id = '20000000-0000-4000-8000-000000000002' $$,
  '23514', null,
  'multi-segment persona handle also blocked — the shape every live persona uses; a guard regex missing the (-segment)* group fails here (review-proven gap)');
select results_eq(
  $$ with w as (update profiles set username = 'renamed_user'
                where id = '20000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from w $$,
  $$ values (1::bigint) $$,
  'authenticated rename to a VALID human name still succeeds at the DB layer (Q7.2 documented residual — permanence is app-enforced until selection moves server-side)');

select * from finish();
rollback;
