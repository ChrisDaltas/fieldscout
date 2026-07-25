-- ============================================================================
-- create_league + soft_delete_league — migration 060 (spec §15.1/§7.2/
-- §7.3.3/§12.1–12.2/§12.22/§17; task L.A1.12; PROGRESS D68; standing rules
-- tasks-M1 §4). pgTAP file is **014** (013 = scoring snapshot; next free
-- confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * The FREE-CREATE pin (ledger F5, create half — Q6/v2.8): the creator
--     fixture's profiles.is_pro is pinned FALSE before the create, and the
--     create succeeds — a reintroduced Pro gate fails here first.
--   * Row pins after the create are GOLDEN: settings/roster_settings byte-
--     equal the passed literals (the RPC must store the blob EXACTLY as
--     given — a re-splitting/reshaping implementation fails); faab_budget is
--     passed as a NON-default 250 and faab_balance is pinned to that same
--     literal (a seed-from-default implementation fails); max_teams is
--     pinned to team_count (the §12.1 sync's first writer).
--   * Idempotency is pinned on BOTH sides: same action_id → same league_id,
--     replayed=true, count still 1; DIFFERENT action_id → a second league
--     (counter-pin: a natural-key dedupe on name/season would wrongly
--     collapse it); a foreign action_id → refused (exact message).
--   * Template-check negatives pin NO-WRITE: after the personal-scoring-id
--     rejection, zero leagues rows carry that action_id.
--   * Error messages exact-matched (golden) where the route maps on them.
--   * Boundary: team_count 9 (inside the 8–16 range but not in the v1 set)
--     surfaces 040's CHECK (23514) through the RPC; 8/16 edge sizes and the
--     full 8..16 sweep live in the stack vitest suite (leagues-api-db).
--   * R75 regression traps (batch-12 review): the EXACT live-proven
--     direct-RPC bypass (overlap pair 15+14) is refused in-body with a
--     no-write pin, and the 13–16 range is probed one-past BOTH directions
--     (12 and 17, seam-consistent so the RANGE half refuses) — these run as
--     `authenticated` through the RPC with no API layer in the loop, which
--     is the hole class they trap.
--   * R76: replaying the action_id of a since-soft-deleted league refuses
--     with the friendly terminal message instead of replaying a dead league
--     (the happy replay is pinned BEFORE the delete in section D).
--   * All privileged fixture work runs BEFORE any JWT claims are set
--     (set_config persists to txn end — D49(7)); mid-test privileged reads
--     use `reset role` (013 pattern).
--   * §4.2 note: this task creates NO new table (creation_action_id is a
--     column on leagues; leagues policies unchanged since 054) — the
--     no-write-policy pattern has no new target here.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(53);

-- ---------------------------------------------------------------------------
-- A. Shape: functions, SECURITY DEFINER + search_path, ACLs, column, UNIQUE.
-- ---------------------------------------------------------------------------
select has_function('public', 'create_league',
  array['text','integer','integer','jsonb','jsonb','uuid','text','uuid',
        'text','integer','integer','integer','text','integer','text','integer','text'],
  'create_league(17 args — name/season + splitSettings columns + blob + action_id) exists');
select has_function('public', 'soft_delete_league', array['uuid'],
  'soft_delete_league(uuid) exists');

select is_definer('public', 'create_league',
  array['text','integer','integer','jsonb','jsonb','uuid','text','uuid',
        'text','integer','integer','integer','text','integer','text','integer','text'],
  'create_league is SECURITY DEFINER');
select is_definer('public', 'soft_delete_league', array['uuid'],
  'soft_delete_league is SECURITY DEFINER');

-- Exact proconfig pins (R70 form — `SET search_path = ''` stores as
-- `search_path=""`; a rebuild pinning search_path=public fails these).
select is(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = ('public.create_league(text,integer,integer,jsonb,jsonb,uuid,text,uuid,'
     || 'text,integer,integer,integer,text,integer,text,integer,text)')::regprocedure),
  'search_path=""',
  'create_league pins search_path='''' exactly (§12.0; R70 form)');
select is(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = 'public.soft_delete_league(uuid)'::regprocedure),
  'search_path=""',
  'soft_delete_league pins search_path='''' exactly');

select ok(
  not has_function_privilege('anon',
    ('public.create_league(text,integer,integer,jsonb,jsonb,uuid,text,uuid,'
     || 'text,integer,integer,integer,text,integer,text,integer,text)')::regprocedure, 'EXECUTE'),
  'anon holds no EXECUTE on create_league (060 REVOKE — §4.1)');
select ok(
  not has_function_privilege('anon', 'public.soft_delete_league(uuid)', 'EXECUTE'),
  'anon holds no EXECUTE on soft_delete_league');
select ok(
  has_function_privilege('authenticated',
    ('public.create_league(text,integer,integer,jsonb,jsonb,uuid,text,uuid,'
     || 'text,integer,integer,integer,text,integer,text,integer,text)')::regprocedure, 'EXECUTE')
  and has_function_privilege('service_role',
    ('public.create_league(text,integer,integer,jsonb,jsonb,uuid,text,uuid,'
     || 'text,integer,integer,integer,text,integer,text,integer,text)')::regprocedure, 'EXECUTE'),
  'authenticated + service_role keep EXECUTE on create_league (in-body checks are the gate)');
select ok(
  has_function_privilege('authenticated', 'public.soft_delete_league(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.soft_delete_league(uuid)', 'EXECUTE'),
  'authenticated + service_role keep EXECUTE on soft_delete_league');

select has_column('public', 'leagues', 'creation_action_id', 'leagues.creation_action_id exists (idempotency key — D68)');
select col_type_is('public', 'leagues', 'creation_action_id', 'uuid', 'creation_action_id is uuid');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.leagues'::regclass and conname = 'leagues_creation_action_id_key'),
  'UNIQUE (creation_action_id)',
  'creation_action_id UNIQUE pinned verbatim (the double-submit race settles here, not on a lock)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims, D49(7)).
--    u1 = free creator; u2 = second user + owner of a PERSONAL scoring
--    system (the v1 templates-only negative).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-cl1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "cl_creator_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-cl2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "cl_second_two"}', now(), now());

insert into scoring_systems (id, owner_id, name, rules) values
  ('5c000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000002',
   'pgtap-personal-system', '{"passing_yards": 0.05}'::jsonb);

-- F5 (create half) fixture pin: the creator is a FREE user.
select is(
  (select is_pro from profiles where id = '77000000-0000-4000-8000-000000000001'),
  false,
  'creator fixture is a FREE (non-Pro) user — the Q6/v2.8 free-create pin is real (F5)');

-- ---------------------------------------------------------------------------
-- C. anon: EXECUTE revoked (behavioral half of the ACL pins).
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select throws_ok(
  $$ select create_league('X', 2026, 12, '{}'::jsonb, '{}'::jsonb,
       null, null, gen_random_uuid(),
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '42501', null,
  'anon cannot even EXECUTE create_league (060 REVOKE)');
select throws_ok(
  $$ select soft_delete_league('ea000000-0000-4000-8000-0000000000aa') $$,
  '42501', null,
  'anon cannot even EXECUTE soft_delete_league');

-- ---------------------------------------------------------------------------
-- D. u1 (authenticated, FREE): the create — golden row pins across all four
--    tables, then idempotency both ways, then the negatives.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "77000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- Distinctive non-default inputs so every pin is falsifiable: faab_budget
-- 250 (default 100), team_count 12, a recognizable blob.
create temp table _r1 as
select public.create_league(
  'pgtap-created-league', 2026, 12,
  '{"divisions": 0, "median_game": true, "draft": {"draft_type": "snake"}}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Commish Crushers',
  'ac000000-0000-4000-8000-000000000001',
  'redraft', 14, 6, 15, 'faab', 250, 'commissioner', null, 'per_player_kickoff'
) as r;

select is((select r->>'replayed' from _r1), 'false', 'a FREE user creates a league successfully (Q6/v2.8 — F5 create half); replayed=false');

-- Golden league-row pins (keyed by the action_id).
select results_eq(
  $$ select name, season, team_count, max_teams, status, format,
            regular_season_weeks, playoff_teams, playoff_start_week,
            waiver_type, faab_budget, trade_review, trade_deadline_week, lineup_lock
     from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001' $$,
  $$ values ('pgtap-created-league', 2026, 12, 12, 'setup', 'redraft',
             14, 6, 15, 'faab', 250, 'commissioner', null::integer, 'per_player_kickoff') $$,
  'league row: every §12.1 typed column stored as passed; max_teams = team_count (the sync''s first writer); status setup');

select is(
  (select settings from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  '{"divisions": 0, "median_game": true, "draft": {"draft_type": "snake"}}'::jsonb,
  'settings blob stored EXACTLY as passed — the RPC never re-splits or reshapes (splitSettings authority, D68)');
select is(
  (select roster_settings from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  'roster_settings stored exactly as passed');
select ok(
  (select scoring_rules_snapshot from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001') is null,
  'created league has a NULL snapshot in setup — legitimate pre-draft state (D43 guard untouched)');
select is(
  (select owner_id from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  '77000000-0000-4000-8000-000000000001'::uuid,
  'owner_id is the creator');
select is(
  (select invite_code from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  (select r->>'invite_code' from _r1),
  'returned invite_code matches the stored one');
select is(
  (select length(invite_code) from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  10,
  'invite_code generated (10 hex chars)');
select is(
  (select id::text from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  (select r->>'league_id' from _r1),
  'returned league_id is the created row');

-- Commissioner membership pins (§12.2).
select results_eq(
  $$ select lm.role, lm.user_id, lm.faab_balance, lm.is_placeholder, (lm.team_id is not null)
     from league_members lm
     join leagues l on l.id = lm.league_id
     where l.creation_action_id = 'ac000000-0000-4000-8000-000000000001' $$,
  $$ values ('commissioner', '77000000-0000-4000-8000-000000000001'::uuid, 250, false, true) $$,
  'exactly one member row: creator seated as commissioner with a team; faab_balance = faab_budget (250 — the NON-default literal, §12.2)');
select is(
  (select lm.team_id::text from league_members lm
   join leagues l on l.id = lm.league_id
   where l.creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  (select r->>'team_id' from _r1),
  'returned team_id is the seated team');

-- Franchise pins (§7.2 "gets a team"; D35a).
select results_eq(
  $$ select t.name, t.owner_id, (t.list_id is null), t.status
     from teams t
     join leagues l on l.id = t.league_id
     where l.creation_action_id = 'ac000000-0000-4000-8000-000000000001' $$,
  $$ values ('Commish Crushers', '77000000-0000-4000-8000-000000000001'::uuid, true, 'active') $$,
  'team row: named as passed, owned by creator, list_id NULL (D35a), active');

-- Open-stint pins (§12.22 — stint asserted directly, task item 4).
select results_eq(
  $$ select tm.user_id, tm.role, (tm.ended_at is null), tm.started_week
     from team_managers tm
     join leagues l on l.id = tm.league_id
     where l.creation_action_id = 'ac000000-0000-4000-8000-000000000001' $$,
  $$ values ('77000000-0000-4000-8000-000000000001'::uuid, 'manager', true, null::integer) $$,
  'exactly one OPEN stint for the creator on the new franchise (started_week NULL — preseason)');

-- Idempotent replay: same action_id → same league, no second row.
create temp table _r2 as
select public.create_league(
  'pgtap-created-league', 2026, 12,
  '{"divisions": 0, "median_game": true, "draft": {"draft_type": "snake"}}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Commish Crushers',
  'ac000000-0000-4000-8000-000000000001',
  'redraft', 14, 6, 15, 'faab', 250, 'commissioner', null, 'per_player_kickoff'
) as r;
select is((select r->>'replayed' from _r2), 'true', 'double-submit with the same action_id REPLAYS (replayed=true)');
select is(
  (select r->>'league_id' from _r2), (select r->>'league_id' from _r1),
  'replay returns the SAME league_id');
select is(
  (select count(*) from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  1::bigint,
  'still exactly one league for that action_id');

-- Counter-pin: a DIFFERENT action_id creates a second league — idempotency
-- is action-scoped, not a natural-key dedupe on name/season.
select lives_ok(
  $$ select public.create_league(
       'pgtap-created-league', 2026, 12,
       '{"divisions": 0}'::jsonb, '{"bench": 6}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       null, 'ac000000-0000-4000-8000-000000000002',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'same name+season with a NEW action_id creates a second league (no natural-key collapse)');
select is(
  (select count(*) from leagues where owner_id = '77000000-0000-4000-8000-000000000001' and name = 'pgtap-created-league'),
  2::bigint,
  'two same-named leagues exist — the duplicate was action-scoped only');

-- NULL team_name falls back to the profile-derived default.
select is(
  (select t.name from teams t join leagues l on l.id = t.league_id
   where l.creation_action_id = 'ac000000-0000-4000-8000-000000000002'),
  'cl_creator_one''s Team',
  'omitted team_name falls back to "<display name>''s Team" (profile-derived)');

-- Boundary: team_count 9 (even-range interior, not in the v1 set) surfaces
-- 040's CHECK through the RPC.
select throws_ok(
  $$ select public.create_league(
       'pgtap-nine', 2026, 9, '{}'::jsonb, '{"bench": 6}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       null, 'ac000000-0000-4000-8000-000000000003',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '23514', null,
  'team_count 9 violates the v1 {8,10,12,14,16} CHECK (23514) through the RPC');

-- R75 regression traps: the Q10 seam has a DB backstop at the sanctioned
-- writer — these calls run the RPC DIRECTLY as authenticated (no
-- validateLeagueSettings anywhere in the loop), which is the exact
-- live-proven bypass from the batch-12 review.
select throws_ok(
  $$ select public.create_league(
       'pgtap-overlap', 2026, 12, '{}'::jsonb, '{"bench": 6}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       null, 'ac000000-0000-4000-8000-000000000007',
       'redraft', 15, 6, 14, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001',
  'create_league: playoff_start_week must be the week after the regular season ends — week 16 for a 15-week regular season (currently week 14) (§7.3.8, Q10/v2.8.6)',
  'direct-RPC overlap pair (15+14 — the live-proven R75 bypass) is refused in-body with the friendly field-named message');
select is(
  (select count(*) from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000007'),
  0::bigint,
  'NO league row persisted on the refused overlap pair — the poisoned-blob detail-500 class is unreachable through the sanctioned writer');

-- Range one-past both directions (12 and 17), with SEAM-CONSISTENT regular
-- seasons (11+12, 16+17) so the RANGE backstop — not the seam — is what
-- refuses (each check discriminated independently).
select throws_ok(
  $$ select public.create_league(
       'pgtap-range-low', 2026, 12, '{}'::jsonb, '{"bench": 6}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       null, 'ac000000-0000-4000-8000-000000000008',
       'redraft', 11, 6, 12, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001',
  'create_league: playoff_start_week must be between 13 and 16 (currently week 12) (§7.3.1, Q10/v2.8.6)',
  'playoff_start_week 12 (one past the low edge, seam-consistent 11+12) hits the range backstop');
select throws_ok(
  $$ select public.create_league(
       'pgtap-range-high', 2026, 12, '{}'::jsonb, '{"bench": 6}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       null, 'ac000000-0000-4000-8000-000000000009',
       'redraft', 16, 6, 17, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001',
  'create_league: playoff_start_week must be between 13 and 16 (currently week 17) (§7.3.1, Q10/v2.8.6)',
  'playoff_start_week 17 (one past the high edge, seam-consistent 16+17) hits the range backstop');

-- v1 templates-only negatives (§7.3.3): personal system, then NULL.
select throws_ok(
  $$ select public.create_league(
       'pgtap-personal', 2026, 12, '{}'::jsonb, '{"bench": 6}'::jsonb,
       '5c000000-0000-4000-8000-000000000001',
       null, 'ac000000-0000-4000-8000-000000000004',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001',
  'create_league: scoring_system_id must reference one of the v1 scoring templates — personal scoring systems cannot be attached to a league in v1 (§7.3.3)',
  'a personal (owner-scoped, non-template) scoring_systems id is rejected with the friendly field-named message');
select is(
  (select count(*) from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000004'),
  0::bigint,
  'NO league row was written on the rejected personal-scoring create (task item 4 negative)');
select throws_ok(
  $$ select public.create_league(
       'pgtap-nullscoring', 2026, 12, '{}'::jsonb, '{"bench": 6}'::jsonb,
       null, null, 'ac000000-0000-4000-8000-000000000005',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001', null,
  'a NULL scoring_system_id is rejected too (§7.3.8: exactly one scoring system referenced)');

-- ---------------------------------------------------------------------------
-- E. u2: a foreign action_id is refused; own create works; soft delete is
--    commish-gated.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "77000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.create_league(
       'pgtap-hijack', 2026, 12, '{}'::jsonb, '{"bench": 6}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       null, 'ac000000-0000-4000-8000-000000000001',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001',
  'create_league: this action_id was already used by another account',
  'another user replaying u1''s action_id is refused (exact message)');

select lives_ok(
  $$ select public.create_league(
       'pgtap-u2-league', 2026, 8, '{}'::jsonb, '{"bench": 6}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'Yahoo Half PPR'),
       null, 'ac000000-0000-4000-8000-000000000006',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'u2 creates their own league (team_count 8 — the low edge size)');
select is(
  (select team_count from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000006'),
  8,
  'edge size 8 stored');

-- u2 is not a member of u1's league: soft delete refused (42501), and a
-- NONEXISTENT league id yields the same error — no existence leak.
select throws_ok(
  $$ select public.soft_delete_league(
       (select id from public.leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001')) $$,
  '42501',
  'soft_delete_league: not a commissioner of this league',
  'a non-member cannot soft-delete (42501, exact message)');
select throws_ok(
  $$ select public.soft_delete_league('ea000000-0000-4000-8000-00000000dead') $$,
  '42501',
  'soft_delete_league: not a commissioner of this league',
  'nonexistent league yields the SAME 42501 — no existence leak');

-- ---------------------------------------------------------------------------
-- F. u1 soft-deletes own league; idempotent on retry.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "77000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select lives_ok(
  $$ select public.soft_delete_league(
       (select id from public.leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001')) $$,
  'the commissioner soft-deletes their league');
select ok(
  (select deleted_at from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001') is not null,
  'deleted_at is set (soft delete — the row survives, CLAUDE.md rule 8)');
select lives_ok(
  $$ select public.soft_delete_league(
       (select id from public.leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001')) $$,
  'a retried delete is an idempotent no-op (D63 doctrine)');

-- R76: retrying the ORIGINAL create against the now soft-deleted league must
-- NOT replay success (a route 200 whose league 404s on detail) — friendly
-- terminal refusal instead. (The HAPPY replay was pinned in section D,
-- before the delete — both sides of the deleted_at line are covered.)
select throws_ok(
  $$ select public.create_league(
       'pgtap-created-league', 2026, 12,
       '{"divisions": 0, "median_game": true, "draft": {"draft_type": "snake"}}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       'Commish Crushers',
       'ac000000-0000-4000-8000-000000000001',
       'redraft', 14, 6, 15, 'faab', 250, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001',
  'create_league: this create was already completed and the league has since been deleted — start a new league with a fresh submit',
  'replaying the action_id of a since-soft-deleted league REFUSES (R76) instead of replaying a dead league');
select is(
  (select count(*) from leagues where creation_action_id = 'ac000000-0000-4000-8000-000000000001'),
  1::bigint,
  'the R76 refusal wrote nothing — still exactly the one (soft-deleted) league on that action_id');

select * from finish();
rollback;
