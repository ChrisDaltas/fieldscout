-- ============================================================================
-- 107_faab_budget_range.sql — migration 159 (PROGRESS F409 / R1165; task
-- L.D3.10). A league's FAAB budget is 0–1000 (spec §7.3.4) in the database,
-- refused BY NAME from both setup verbs and from any other writer.
--
-- Falsifiability (§4.3): the boundary pair is walked BOTH sides — 0 and 1000
-- are stored, -1 and 1001 are refused — through `create_league` AND
-- `update_league_settings` as the signed-in commissioner (the verbs a route
-- calls), and once as the service role straight at the table. Every refusal
-- is matched on the EXACT message, which names `leagues_faab_budget_range`
-- (a refusal by any other constraint — e.g. the seat balance's
-- `league_members_faab_balance_nonneg`, which is what a negative budget hit
-- before 159 — fails the match). No-write is asserted after each refusal.
-- The break probe (the constraint dropped ⇒ 1001 stored, -1 refused by the
-- OTHER name) is shown in the PR.
-- §4.2: no table, no policy, no RPC — the no-write-policy pattern has no new
-- target here.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

-- ---------------------------------------------------------------------------
-- A. Shape — the constraint, exactly.
-- ---------------------------------------------------------------------------
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conname = 'leagues_faab_budget_range' and c.conrelid = 'public.leagues'::regclass),
  'CHECK (((faab_budget >= 0) AND (faab_budget <= 1000)))',
  'A1: leagues_faab_budget_range is CHECK (faab_budget BETWEEN 0 AND 1000) (§7.3.4)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims, D49(7)).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'f4090000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-f409@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "f409_commish"}', now(), now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "f4090000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- C. create_league — one past each end refused by name; both ends stored.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.create_league('pgtap-f409-over', 2026, 12, '{}'::jsonb, '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'), 'Over',
       'f4090000-0000-4000-8000-0000000000c1',
       'redraft', 14, 6, 15, 'faab', 1001, 'commissioner', null, 'per_player_kickoff') $$,
  '23514', 'new row for relation "leagues" violates check constraint "leagues_faab_budget_range"',
  'C1: create_league with a $1001 budget is refused by name');
select throws_ok(
  $$ select public.create_league('pgtap-f409-under', 2026, 12, '{}'::jsonb, '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'), 'Under',
       'f4090000-0000-4000-8000-0000000000c2',
       'redraft', 14, 6, 15, 'faab', -1, 'commissioner', null, 'per_player_kickoff') $$,
  '23514', 'new row for relation "leagues" violates check constraint "leagues_faab_budget_range"',
  'C2: create_league with a -$1 budget is refused by THIS name (before 159: the seat balance''s constraint)');
select lives_ok(
  $$ select public.create_league('pgtap-f409-zero', 2026, 12, '{}'::jsonb, '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'), 'Zero',
       'f4090000-0000-4000-8000-0000000000c3',
       'redraft', 14, 6, 15, 'faab', 0, 'commissioner', null, 'per_player_kickoff') $$,
  'C3: create_league with a $0 budget is stored (the lower end)');
select lives_ok(
  $$ select public.create_league('pgtap-f409-max', 2026, 12, '{}'::jsonb, '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'), 'Max',
       'f4090000-0000-4000-8000-0000000000c4',
       'redraft', 14, 6, 15, 'faab', 1000, 'commissioner', null, 'per_player_kickoff') $$,
  'C4: create_league with a $1000 budget is stored (the upper end)');

reset role;
select results_eq(
  $$ select creation_action_id::text, faab_budget from leagues
     where creation_action_id::text like 'f4090000-0000-4000-8000-0000000000c%' order by 1 $$,
  $$ values ('f4090000-0000-4000-8000-0000000000c3', 0), ('f4090000-0000-4000-8000-0000000000c4', 1000) $$,
  'C5: only the two in-range leagues exist, at exactly $0 and $1000 — the refusals wrote nothing');

-- ---------------------------------------------------------------------------
-- D. update_league_settings on the $1000 league — the same boundary.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "f4090000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.update_league_settings(
       (select id from public.leagues where creation_action_id = 'f4090000-0000-4000-8000-0000000000c4'), 12,
       '{}'::jsonb, '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb, null,
       'redraft', 14, 6, 15, 'faab', 1001, 'commissioner', null, 'per_player_kickoff') $$,
  '23514', 'new row for relation "leagues" violates check constraint "leagues_faab_budget_range"',
  'D1: update_league_settings to $1001 is refused by name');
select throws_ok(
  $$ select public.update_league_settings(
       (select id from public.leagues where creation_action_id = 'f4090000-0000-4000-8000-0000000000c4'), 12,
       '{}'::jsonb, '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb, null,
       'redraft', 14, 6, 15, 'faab', -1, 'commissioner', null, 'per_player_kickoff') $$,
  '23514', 'new row for relation "leagues" violates check constraint "leagues_faab_budget_range"',
  'D2: update_league_settings to -$1 is refused by name');

reset role;
select is(
  (select faab_budget from leagues where creation_action_id = 'f4090000-0000-4000-8000-0000000000c4'),
  1000,
  'D3: after both refusals the budget is still $1000 (nothing written)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "f4090000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.update_league_settings(
       (select id from public.leagues where creation_action_id = 'f4090000-0000-4000-8000-0000000000c4'), 12,
       '{}'::jsonb, '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb, null,
       'redraft', 14, 6, 15, 'faab', 0, 'commissioner', null, 'per_player_kickoff') $$,
  'D4: update_league_settings to $0 is stored (the lower end)');

reset role;
select results_eq(
  $$ select l.faab_budget, m.faab_balance from leagues l
     join league_members m on m.league_id = l.id
     where l.creation_action_id = 'f4090000-0000-4000-8000-0000000000c4' $$,
  $$ values (0, 0) $$,
  'D5: the $0 budget stored and the seat re-seeded to it (§12.2 v2.8.7 — unchanged by 159)');

-- ---------------------------------------------------------------------------
-- E. Every writer — the service role straight at the table.
-- ---------------------------------------------------------------------------
set local role service_role;
select throws_ok(
  $$ update public.leagues set faab_budget = 1001
     where creation_action_id = 'f4090000-0000-4000-8000-0000000000c3' $$,
  '23514', 'new row for relation "leagues" violates check constraint "leagues_faab_budget_range"',
  'E1: the service role cannot store $1001 either — the constraint binds every writer');
reset role;
select is(
  (select faab_budget from leagues where creation_action_id = 'f4090000-0000-4000-8000-0000000000c3'),
  0,
  'E2: the refused service write left the budget at $0');

select * from finish();
rollback;
