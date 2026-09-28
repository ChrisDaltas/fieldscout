-- ============================================================================
-- Blind waiver claims + the three claim verbs + the FAAB floor — pgTAP 093
-- (M5 task L.D2.5; migration 145; spec §12.10 (+ C73), §13.2, §7.3.4, §12.2,
-- §10.3 / §12.12, §12.14, E13; tasks-M5 TD2 / TD3 / TD4 / TD5 / TD8).
--
-- Numbering: RESERVED by the orchestrator (L.E1.27 holds 092) ⇒ 093.
-- OWN FIXTURE: leagues b93…, teams c93…, users 993…, players wc-*.
--
-- Falsifiability (tasks-M1 §4.3):
--   * E13 PER ROLE (§G): anon, a non-member, a member with no claims, another
--     member who owns claims (sees ONLY his own), the owner, the commissioner
--     and the co-commissioner — each a stored count literal, RETURNING-counted
--     writes for every role, the ledger included.
--   * BOUNDARIES as stored literals: bid = balance (40) lands, 41 refused;
--     bid = faab_min_bid (1) lands, 0 refused; balance 0 storable, -1 not.
--   * BLIND-SAFE RECEIPTS (§E): the league-visible audit row and chat post of
--     a commissioner-placed claim carry neither the player nor the bid.
--   * BREAK PROBES shown red in the PR, then reverted: widen the SELECT
--     policy to is_league_member (§G3 / G4 red); drop the bid ≤ balance guard
--     (C15 red); drop the rostered-in-league check (C11 red); drop the CHECK
--     (H1 red).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(94);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', column_name, data_type, is_nullable), ' ' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'waiver_claims'),
  'id:uuid:NO league_id:uuid:NO team_id:uuid:NO add_player_id:text:NO drop_player_id:text:YES faab_bid:integer:NO priority:integer:YES claim_order:integer:NO status:text:NO result_reason:text:YES process_at:timestamp with time zone:YES processed_at:timestamp with time zone:YES action_id:uuid:NO created_by:uuid:NO cancelled_at:timestamp with time zone:YES cancelled_by:uuid:YES created_at:timestamp with time zone:NO',
  'A1 waiver_claims is spec 12.10 plus action_id / result_reason / created_by / cancelled_at / cancelled_by (tasks-M5 section 5)');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.waiver_claims'::regclass)
  and (select c.relrowsecurity from pg_class c where c.oid = 'public.waiver_claim_actions'::regclass),
  'A2 RLS is ENABLED on both new tables');
select is(
  (select string_agg(format('%s/%s/%s', tablename, cmd, array_to_string(roles, ',')), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'public' and tablename in ('waiver_claims', 'waiver_claim_actions')),
  'waiver_claims/SELECT/authenticated',
  'A3 exactly ONE policy across the two tables: SELECT for authenticated on waiver_claims. NO write policy for any role (C73 / TD4 — spec 12.10 printed FOR ALL is not built) and ZERO policies on the ledger (D350)');
select ok(
  not has_table_privilege('anon', 'public.waiver_claims', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.waiver_claims', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.waiver_claim_actions', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.waiver_claim_actions', 'TRUNCATE')
  and has_table_privilege('service_role', 'public.waiver_claims', 'TRUNCATE'),
  'A4 both tables are born WITHOUT TRUNCATE for anon + authenticated (081 section A / 133); service_role keeps it');
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.waiver_claims'::regclass and not tgisinternal),
  0,
  'A5 waiver_claims carries NO trigger — never broadcast (12.14 / TD3: owners refetch)');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'waiver_claim%'),
  'waiver_claim_cancel:t:search_path="":f:t waiver_claim_cancel_internal:f:search_path="":f:f waiver_claim_receipt_internal:f:search_path="":f:f waiver_claim_reorder:t:search_path="":f:t waiver_claim_reorder_internal:f:search_path="":f:f waiver_claim_submit:t:search_path="":f:t waiver_claim_submit_internal:f:search_path="":f:f',
  'A6 seven functions, one overload each: three SECURITY DEFINER doors (anon revoked, authenticated EXECUTE — the in-body gate authorizes) and four PLAIN internals REVOKEd from anon and authenticated; all search_path empty');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname like 'waiver_claim%' and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'A7 …and PUBLIC holds EXECUTE on none of them');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.league_members'::regclass and c.conname = 'league_members_faab_balance_nonneg'),
  'CHECK (((faab_balance IS NULL) OR (faab_balance >= 0)))',
  'A8 league_members carries the FAAB floor CHECK (TD2)');
select is(
  (select format('%s:%s', data_type, is_nullable) from information_schema.columns
   where table_schema = 'public' and table_name = 'league_members' and column_name = 'waiver_priority'),
  'integer:YES',
  'A9 league_members.waiver_priority is a nullable INTEGER on the seat (TD8 — seeded lazily by the processor)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
--   L1 b93…01 faab, faab_min_bid 1, in_season — the main league.
--     TC  c93…01 u1 commissioner (100)   TCO c93…02 u2 co_commissioner (100)
--     TA  c93…03 u3 manager (40)         TB  c93…04 u4 manager (100)
--     TU  c93…05 UNMANAGED seat (25)     TR  c93…06 RETIRED (100)
--     TD  c93…07 u6 manager, never claims (100)
--   L2 b93…02 rolling_priority, in_season (u1 c93…20, u3 c93…21)
--   L3 b93…03 none_fcfs, in_season       (u1 c93…30, u3 c93…31)
--   L4 b93…04 faab, SETUP                (u1 c93…40)
--   u5 is a member of NO league.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99300000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-wc' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'wc_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, settings, roster_settings)
select l.id, '99300000-0000-4000-8000-000000000001', l.nm, 2026, l.status, 12, 6, 0, 7,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.wt, 100, l.st,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
         "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b9300000-0000-4000-8000-000000000001'::uuid, 'pgtap-wc-L1', 'in_season', 'faab',             '{"faab_min_bid": 1}'::jsonb),
 ('b9300000-0000-4000-8000-000000000002'::uuid, 'pgtap-wc-L2', 'in_season', 'rolling_priority', '{}'::jsonb),
 ('b9300000-0000-4000-8000-000000000003'::uuid, 'pgtap-wc-L3', 'in_season', 'none_fcfs',        '{}'::jsonb),
 ('b9300000-0000-4000-8000-000000000004'::uuid, 'pgtap-wc-L4', 'setup',     'faab',             '{}'::jsonb)
) as l(id, nm, status, wt, st);

insert into teams (id, owner_id, name, league_id, status) values
 ('c9300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001', 'WC Commish',  'b9300000-0000-4000-8000-000000000001', 'active'),
 ('c9300000-0000-4000-8000-000000000002', '99300000-0000-4000-8000-000000000002', 'WC Co',       'b9300000-0000-4000-8000-000000000001', 'active'),
 ('c9300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000003', 'WC Alpha',    'b9300000-0000-4000-8000-000000000001', 'active'),
 ('c9300000-0000-4000-8000-000000000004', '99300000-0000-4000-8000-000000000004', 'WC Bravo',    'b9300000-0000-4000-8000-000000000001', 'active'),
 ('c9300000-0000-4000-8000-000000000005', '99300000-0000-4000-8000-000000000001', 'WC Open Seat','b9300000-0000-4000-8000-000000000001', 'active'),
 ('c9300000-0000-4000-8000-000000000006', '99300000-0000-4000-8000-000000000001', 'WC Retired',  'b9300000-0000-4000-8000-000000000001', 'retired'),
 ('c9300000-0000-4000-8000-000000000007', '99300000-0000-4000-8000-000000000006', 'WC Delta',    'b9300000-0000-4000-8000-000000000001', 'active'),
 ('c9300000-0000-4000-8000-000000000020', '99300000-0000-4000-8000-000000000001', 'WC L2 C',     'b9300000-0000-4000-8000-000000000002', 'active'),
 ('c9300000-0000-4000-8000-000000000021', '99300000-0000-4000-8000-000000000003', 'WC L2 A',     'b9300000-0000-4000-8000-000000000002', 'active'),
 ('c9300000-0000-4000-8000-000000000030', '99300000-0000-4000-8000-000000000001', 'WC L3 C',     'b9300000-0000-4000-8000-000000000003', 'active'),
 ('c9300000-0000-4000-8000-000000000031', '99300000-0000-4000-8000-000000000003', 'WC L3 A',     'b9300000-0000-4000-8000-000000000003', 'active'),
 ('c9300000-0000-4000-8000-000000000040', '99300000-0000-4000-8000-000000000001', 'WC L4 C',     'b9300000-0000-4000-8000-000000000004', 'active');

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b9300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000001', 'commissioner',    false, 100),
 ('b9300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000002', 'c9300000-0000-4000-8000-000000000002', 'co_commissioner', false, 100),
 ('b9300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000003', 'c9300000-0000-4000-8000-000000000003', 'manager',         false, 40),
 ('b9300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000004', 'c9300000-0000-4000-8000-000000000004', 'manager',         false, 100),
 ('b9300000-0000-4000-8000-000000000001', null,                                   'c9300000-0000-4000-8000-000000000005', 'manager',         true,  25),
 ('b9300000-0000-4000-8000-000000000001', null,                                   'c9300000-0000-4000-8000-000000000006', 'manager',         true,  100),
 ('b9300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000006', 'c9300000-0000-4000-8000-000000000007', 'manager',         false, 100),
 ('b9300000-0000-4000-8000-000000000002', '99300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000020', 'commissioner',    false, 100),
 ('b9300000-0000-4000-8000-000000000002', '99300000-0000-4000-8000-000000000003', 'c9300000-0000-4000-8000-000000000021', 'manager',         false, 100),
 ('b9300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000030', 'commissioner',    false, 100),
 ('b9300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000003', 'c9300000-0000-4000-8000-000000000031', 'manager',         false, 100),
 ('b9300000-0000-4000-8000-000000000004', '99300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000040', 'commissioner',    false, 100);

insert into players (id, full_name, position, team, status) values
 ('wc-a1', 'WC Alpha One',  'QB', 'WCA', 'Active'),
 ('wc-a2', 'WC Alpha Two',  'QB', 'WCA', 'Active'),
 ('wc-b1', 'WC Bravo One',  'QB', 'WCB', 'Active'),
 ('wc-f1', 'WC Free One',   'QB', 'WCF', 'Active'),
 ('wc-f2', 'WC Free Two',   'QB', 'WCF', 'Active'),
 ('wc-f3', 'WC Free Three', 'QB', 'WCF', 'Active');

insert into league_rosters (league_id, team_id, player_id, slot_key) values
 ('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-a1', 'bn'),
 ('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-a2', 'bn'),
 ('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000004', 'wc-b1', 'bn');

create temp table r93 (tag text primary key, r jsonb not null);
grant select, insert on r93 to authenticated;
create temp table audit0 as select count(*)::int as n from commissioner_actions where league_id = 'b9300000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- C. Refusals — auth first, then shape, then every business rule BY NAME
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', null, 5, 'a9300000-0000-4000-8000-000000000001') $$,
  '42501', null, 'C1 ANON cannot even execute the door (EXECUTE revoked)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', null, 5, 'a9300000-0000-4000-8000-000000000002') $$,
  '42501', 'waiver_claim_submit: not a manager of this team', 'C2 a NON-member gets the one no-leak 42501');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-0000000000ff', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', null, 5, 'a9300000-0000-4000-8000-000000000003') $$,
  '42501', 'waiver_claim_submit: not a manager of this team', 'C3 …and so does a league that does not exist (no existence leak)');
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', null, 5, 'a9300000-0000-4000-8000-000000000004') $$,
  '42501', 'waiver_claim_submit: not a manager of this team', 'C4 another MANAGER of the league cannot claim for a team he does not manage — same 42501');

select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', null, 5, null) $$,
  '22023', null, 'C5 no action_id is refused BY NAME (22023)');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', null, null, 5, 'a9300000-0000-4000-8000-000000000005') $$,
  '22023', null, 'C6 no add player is refused BY NAME (22023)');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-a1', 'wc-a1', 5, 'a9300000-0000-4000-8000-000000000006') $$,
  '22023', null, 'C7 add = drop is refused BY NAME (22023)');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', null, -1, 'a9300000-0000-4000-8000-000000000007') $$,
  '22023', 'waiver_claim_submit: a bid of $-1 is negative — bids are whole dollars from $0 up (§7.3.4)', 'C8 a negative bid is refused BY NAME (22023)');

select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000003', 'c9300000-0000-4000-8000-000000000031', 'wc-f1', null, 0, 'a9300000-0000-4000-8000-000000000008') $$,
  'P0001', 'waiver_claim_submit: this league has no waivers (waiver type "none_fcfs") — every unowned player is first come, first served: add him directly (§7.3.4)',
  'C9 waiver_type none_fcfs is refused BY NAME');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-b1', null, 5, 'a9300000-0000-4000-8000-000000000009') $$,
  'P0001', 'waiver_claim_submit: WC Bravo One (wc-b1) is already on WC Bravo''s roster — a player is on ONE roster per league (player exclusivity, §13.2); only an unowned player can be claimed',
  'C10 EXCLUSIVITY: an add already rostered by another team is refused by name, naming that team — never a raw 23505');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-a2', null, 5, 'a9300000-0000-4000-8000-000000000010') $$,
  'P0001', 'waiver_claim_submit: WC Alpha Two (wc-a2) is already on WC Alpha''s own roster — a player is on ONE roster per league (player exclusivity, §13.2); only an unowned player can be claimed',
  'C11 EXCLUSIVITY: an add already on the claiming team is refused by name');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', 'wc-b1', 5, 'a9300000-0000-4000-8000-000000000011') $$,
  'P0001', 'waiver_claim_submit: WC Bravo One (wc-b1) is not on WC Alpha''s roster — a claim can only drop one of the team''s own players (§13.2)',
  'C12 a drop on ANOTHER team is refused by name');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', 'wc-f2', 5, 'a9300000-0000-4000-8000-000000000012') $$,
  'P0001', 'waiver_claim_submit: WC Free Two (wc-f2) is not on WC Alpha''s roster — a claim can only drop one of the team''s own players (§13.2)',
  'C13 a drop nobody rosters is refused by name');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', null, 0, 'a9300000-0000-4000-8000-000000000013') $$,
  'P0001', 'waiver_claim_submit: a bid of $0 is below this league''s minimum bid of $1 (faab_min_bid, §7.3.4)',
  'C14 MIN-BID BOUNDARY: $0 under faab_min_bid 1 is refused (and $1 lands, D6)');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', null, 41, 'a9300000-0000-4000-8000-000000000014') $$,
  'P0001', 'waiver_claim_submit: a bid of $41 is more than WC Alpha''s FAAB balance of $40 (§13.2)',
  'C15 BALANCE BOUNDARY: $41 against a $40 balance is refused (and $40 lands, D1)');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000002', 'c9300000-0000-4000-8000-000000000021', 'wc-f1', null, 3, 'a9300000-0000-4000-8000-000000000015') $$,
  'P0001', 'waiver_claim_submit: this league decides claims by waiver priority (rolling_priority), not by bids — a claim carries no money here, so the bid must be $0 (got $3) (§13.2)',
  'C16 a non-zero bid under a PRIORITY type is refused by name');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-nobody', null, 5, 'a9300000-0000-4000-8000-000000000016') $$,
  'P0001', 'waiver_claim_submit: no player with id wc-nobody (add)', 'C17 an unknown player is refused by name');
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000004', 'c9300000-0000-4000-8000-000000000040', 'wc-f1', null, 5, 'a9300000-0000-4000-8000-000000000017') $$,
  'P0001', 'waiver_claim_submit: league b9300000-0000-4000-8000-000000000004 is setup — waiver claims are made only while the league is in season or in the playoffs (§13.2)',
  'C18 a league not in season / playoffs is refused by name');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000006', 'wc-f1', null, 5, 'a9300000-0000-4000-8000-000000000018') $$,
  'P0001', 'waiver_claim_submit: WC Retired is retired — a sealed franchise makes no claims (§7.2.1)',
  'C19 a retired franchise is refused by name — even for the commissioner');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000005', 'wc-f1', null, 26, 'a9300000-0000-4000-8000-000000000019') $$,
  'P0001', 'waiver_claim_submit: a bid of $26 is more than WC Open Seat''s FAAB balance of $25 (§13.2)',
  'C20 the COMMISSIONER is bound by the balance too (validity rules bind him — standing rule (i))');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from waiver_claims), 0, 'C21 every refusal above wrote NOTHING — zero claims exist');
select is((select count(*)::int from waiver_claim_actions), 0, 'C22 …and no ledger row (a refusal is not an action)');

-- ---------------------------------------------------------------------------
-- D. The manager arm
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
insert into r93 select 'D1', public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', 'wc-a1', 40, 'a9300000-0000-4000-8000-000000000101');
insert into r93 select 'D5', public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f2', null, 1, 'a9300000-0000-4000-8000-000000000102');
insert into r93 select 'D6', public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', 'wc-a2', 7, 'a9300000-0000-4000-8000-000000000103');
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f1', 'wc-a1', 12, 'a9300000-0000-4000-8000-000000000104') $$,
  'P0001', 'waiver_claim_submit: WC Alpha already has a pending claim for WC Free One (wc-f1) dropping WC Alpha One (wc-a1) — cancel it to change the bid or the order',
  'D2 an IDENTICAL pending claim (same add, same drop — any bid) is refused by name, never a raw 23505');
insert into r93 select 'D7', public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f3', null, 9, 'a9300000-0000-4000-8000-000000000101');
select throws_ok(
  $$ select public.waiver_claim_cancel('b9300000-0000-4000-8000-000000000001', ((select r from r93 where tag = 'D1') #>> '{claim,id}')::uuid, 'a9300000-0000-4000-8000-000000000102') $$,
  'P0001', 'waiver_claim_cancel: action_id a9300000-0000-4000-8000-000000000102 already names a waiver_claim_submit for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
  'D8 an action_id is ONE submit of ONE verb: a submit''s id reused for a cancel is refused (R732)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', r #>> '{claim,claim_order}', r #>> '{claim,status}', r #>> '{claim,faab_bid}',
                 r ->> 'acted_as_commissioner', coalesce(r ->> 'commissioner_action_id', 'null'), r ->> 'faab_balance', r ->> 'faab_spent')
   from r93 where tag = 'D1'),
  '1|pending|40|false|null|40|0',
  'D1 BALANCE BOUNDARY: a $40 bid on a $40 balance LANDS — order 1, pending, no commissioner receipt, and nothing spent');
select is(
  (select string_agg(format('%s>%s:%s:%s:%s', c.add_player_id, coalesce(c.drop_player_id, '-'), c.faab_bid, c.claim_order, c.created_by), ' ' order by c.claim_order)
   from waiver_claims c where c.team_id = 'c9300000-0000-4000-8000-000000000003'),
  'wc-f1>wc-a1:40:1:99300000-0000-4000-8000-000000000003 wc-f2>-:1:2:99300000-0000-4000-8000-000000000003 wc-f1>wc-a2:7:3:99300000-0000-4000-8000-000000000003',
  'D3 three claims at the back of the order (1, 2, 3); $1 = faab_min_bid LANDS; the same add with a DIFFERENT drop is not identical');
select is(
  (select faab_balance from league_members where team_id = 'c9300000-0000-4000-8000-000000000003'),
  40,
  'D4 a claim SPENDS NOTHING — WC Alpha still holds $40 after $48 of pending bids (TD2: only a won claim debits)');
select is(
  (select format('txns=%s audit=%s chat=%s',
     (select count(*) from transactions where league_id = 'b9300000-0000-4000-8000-000000000001'),
     (select count(*) from commissioner_actions where league_id = 'b9300000-0000-4000-8000-000000000001') - (select n from audit0),
     (select count(*) from league_chat where league_id = 'b9300000-0000-4000-8000-000000000001'))),
  'txns=0 audit=0 chat=0',
  'D5 the manager arm writes NO transactions row (TD3: only a WON claim does), NO audit row and NO chat post');
select is(
  (select (select r from r93 where tag = 'D7')::text = (select r from r93 where tag = 'D1')::text),
  true,
  'D6 REPLAY: D1''s action_id re-sent with a DIFFERENT player and bid returns D1''s result byte for byte');
select is(
  (select count(*)::int from waiver_claims where team_id = 'c9300000-0000-4000-8000-000000000003' and add_player_id = 'wc-f3'),
  0,
  'D7 …and wrote nothing (no claim for the replayed request''s player)');
select is(
  (select count(*)::int from waiver_claim_actions where league_id = 'b9300000-0000-4000-8000-000000000001'),
  3,
  'D8b one ledger row per landed submit (three), none for the replay or the refusals');

-- A pinned instant through the internal (the TimeProvider seam, p_at).
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
insert into r93 select 'D9', public.waiver_claim_submit_internal('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000004', 'wc-f2', null, 100, 'a9300000-0000-4000-8000-000000000105', '2026-10-07 09:00:00+00', null);
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s|%s', c.created_at, c.faab_bid, (select r ->> 'evaluated_at' from r93 where tag = 'D9'))
   from waiver_claims c where c.action_id = 'a9300000-0000-4000-8000-000000000105'),
  '2026-10-07 09:00:00+00|100|2026-10-07T09:00:00+00:00',
  'D9 time only through p_at: created_at is the injected instant; WC Bravo bids its whole $100 balance (boundary)');

-- ---------------------------------------------------------------------------
-- E. The commissioner arm (TD5) — one audit row, blind-safe receipts
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into r93 select 'E1', public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000004', 'wc-f3', 'wc-b1', 60, 'a9300000-0000-4000-8000-000000000201', E' \t ');
insert into r93 select 'E7', public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000001', 'wc-f3', null, 2, 'a9300000-0000-4000-8000-000000000202');
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
insert into r93 select 'E6', public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000005', 'wc-f1', null, 25, 'a9300000-0000-4000-8000-000000000203', 'open seat, keeping it competitive');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s|%s', r ->> 'acted_as_commissioner', coalesce(r ->> 'reason', 'null'), r ->> 'notified_user_id')
   from r93 where tag = 'E1'),
  'true|null|99300000-0000-4000-8000-000000000004',
  'E1 the commissioner claims for WC Bravo: acted_as_commissioner, a whitespace-only reason normalised to NULL (Q66), the manager notified');
select is(
  (select created_by from waiver_claims where action_id = 'a9300000-0000-4000-8000-000000000201'),
  '99300000-0000-4000-8000-000000000001'::uuid,
  'E1b the claim row records WHO placed it (created_by = the commissioner) — visible to the owner and commissioners only');
select is(
  (select string_agg(format('%s|%s|%s|%s|%s|%s', a.action_type, a.target_type, a.target_id, a.acting_as_team_id, a.actor_id, coalesce(a.reason, 'null')), ' ' order by a.created_at, a.action_type, a.target_id)
   from commissioner_actions a where a.league_id = 'b9300000-0000-4000-8000-000000000001'),
  'submit_waiver_claim|team|c9300000-0000-4000-8000-000000000004|c9300000-0000-4000-8000-000000000004|99300000-0000-4000-8000-000000000001|null submit_waiver_claim|team|c9300000-0000-4000-8000-000000000005|c9300000-0000-4000-8000-000000000005|99300000-0000-4000-8000-000000000002|open seat, keeping it competitive',
  'E2 exactly ONE audit row per commissioner act (acting_as_team_id = the team, reason optional); the commissioner claiming for HIS OWN team (E7) is the manager arm and writes none');
select ok(
  (select bool_and(
     coalesce(a.before::text, '') || a.after::text || a.metadata::text not like '%wc-f%'
     and coalesce(a.before::text, '') || a.after::text || a.metadata::text not like '%WC Free%'
     and not (a.after ? 'faab_bid') and not (a.metadata ? 'faab_bid')
     and not (a.metadata ? 'add_player_id'))
   from commissioner_actions a where a.league_id = 'b9300000-0000-4000-8000-000000000001'),
  'E3 BLIND-SAFE AUDIT (E13 / TD3): the league-visible audit rows name neither the claimed player nor the bid');
select is(
  (select string_agg(c.message, ' || ' order by c.created_at, c.message) from league_chat c
   where c.league_id = 'b9300000-0000-4000-8000-000000000001' and c.is_system),
  'wc_user1 (commissioner) submitted a waiver claim for WC Bravo — its details stay private until waivers run || wc_user2 (commissioner) submitted a waiver claim for WC Open Seat — its details stay private until waivers run — reason: open seat, keeping it competitive',
  'E4 BLIND-SAFE POST (10.3): the system line names the act and the team — no player, no bid');
select is(
  (select string_agg(format('%s|%s|%s', n.user_id, n.type, n.body), ' ' order by n.created_at)
   from notifications n where n.data ->> 'league_id' = 'b9300000-0000-4000-8000-000000000001'),
  '99300000-0000-4000-8000-000000000004|league_waiver_claim_commissioner|Claim: add WC Free Three, drop WC Bravo One, bid $60',
  'E5 the team''s OWN manager (and only he) is notified WITH the details — the unmanaged seat (E6) notifies nobody');
select is(
  (select format('%s|%s', r ->> 'acted_as_commissioner', coalesce(r ->> 'notified_user_id', 'null')) from r93 where tag = 'E6'),
  'true|null',
  'E6 the CO-commissioner may act for an UNMANAGED seat; nobody to notify, said as null');
select is(
  (select format('%s|%s', r ->> 'acted_as_commissioner', coalesce(r ->> 'commissioner_action_id', 'null')) from r93 where tag = 'E7'),
  'false|null',
  'E7 a commissioner claiming for his OWN team is its manager — no receipt');

-- ---------------------------------------------------------------------------
-- F. Reorder and cancel
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
insert into r93 select 'F1', public.waiver_claim_reorder('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003',
  array[((select r from r93 where tag = 'D6') #>> '{claim,id}')::uuid, ((select r from r93 where tag = 'D1') #>> '{claim,id}')::uuid, ((select r from r93 where tag = 'D5') #>> '{claim,id}')::uuid],
  'a9300000-0000-4000-8000-000000000301');
insert into r93 select 'F2', public.waiver_claim_reorder('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003',
  array[((select r from r93 where tag = 'D6') #>> '{claim,id}')::uuid, ((select r from r93 where tag = 'D1') #>> '{claim,id}')::uuid, ((select r from r93 where tag = 'D5') #>> '{claim,id}')::uuid],
  'a9300000-0000-4000-8000-000000000302');
select throws_like(
  format($$ select public.waiver_claim_reorder('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', array['%s', '%s']::uuid[], 'a9300000-0000-4000-8000-000000000303') $$,
    (select r #>> '{claim,id}' from r93 where tag = 'D6'), (select r #>> '{claim,id}' from r93 where tag = 'D1')),
  'waiver_claim_reorder: the new order must list exactly WC Alpha''s pending claims, each once — missing: %; not a pending claim of this team: none',
  'F3 a reorder that leaves a pending claim out is refused, naming it');
select throws_like(
  format($$ select public.waiver_claim_reorder('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', array['%s', '%s', '%s', '%s']::uuid[], 'a9300000-0000-4000-8000-000000000304') $$,
    (select r #>> '{claim,id}' from r93 where tag = 'D6'), (select r #>> '{claim,id}' from r93 where tag = 'D1'),
    (select r #>> '{claim,id}' from r93 where tag = 'D5'), (select r #>> '{claim,id}' from r93 where tag = 'D9')),
  'waiver_claim_reorder: the new order must list exactly WC Alpha''s pending claims, each once — missing: none; not a pending claim of this team: %',
  'F4 a reorder naming ANOTHER team''s claim is refused, naming it');
select throws_ok(
  format($$ select public.waiver_claim_reorder('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', array['%s', '%s']::uuid[], 'a9300000-0000-4000-8000-000000000305') $$,
    (select r #>> '{claim,id}' from r93 where tag = 'D6'), (select r #>> '{claim,id}' from r93 where tag = 'D6')),
  '22023', null, 'F5 a claim listed twice is refused BY NAME (22023)');
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.waiver_claim_reorder('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', array['%s']::uuid[], 'a9300000-0000-4000-8000-000000000306') $$,
    (select r #>> '{claim,id}' from r93 where tag = 'D6')),
  '42501', 'waiver_claim_reorder: not a manager of this team', 'F6 another manager cannot reorder WC Alpha (the no-leak 42501)');
select throws_ok(
  format($$ select public.waiver_claim_cancel('b9300000-0000-4000-8000-000000000001', '%s', 'a9300000-0000-4000-8000-000000000307') $$,
    (select r #>> '{claim,id}' from r93 where tag = 'D1')),
  '42501', 'waiver_claim_cancel: not a manager of this claim''s team', 'F7 another manager cannot cancel WC Alpha''s claim…');
select throws_ok(
  $$ select public.waiver_claim_cancel('b9300000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-0000000000ff', 'a9300000-0000-4000-8000-000000000308') $$,
  '42501', 'waiver_claim_cancel: not a manager of this claim''s team', 'F8 …and a claim id that does not exist answers him the SAME 42501 (no existence oracle)');
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
insert into r93 select 'F9', public.waiver_claim_cancel('b9300000-0000-4000-8000-000000000001', ((select r from r93 where tag = 'D6') #>> '{claim,id}')::uuid, 'a9300000-0000-4000-8000-000000000309');
insert into r93 select 'F10', public.waiver_claim_cancel('b9300000-0000-4000-8000-000000000001', ((select r from r93 where tag = 'D6') #>> '{claim,id}')::uuid, 'a9300000-0000-4000-8000-000000000310');
insert into r93 select 'F11', public.waiver_claim_cancel('b9300000-0000-4000-8000-000000000001', ((select r from r93 where tag = 'D6') #>> '{claim,id}')::uuid, 'a9300000-0000-4000-8000-000000000309');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s', r ->> 'no_changes', (select string_agg(c.add_player_id || '>' || coalesce(c.drop_player_id, '-') || ':' || (e ->> 'claim_order'), ' ' order by (e ->> 'claim_order')::int)
                                              from jsonb_array_elements(r -> 'pending_claims') e join waiver_claims c on c.id = (e ->> 'id')::uuid))
   from r93 where tag = 'F1'),
  'false|wc-f1>wc-a2:1 wc-f1>wc-a1:2 wc-f2>-:3',
  'F1 the manager reorders his own claims (1..3 in the order he sent)');
select is(
  (select format('%s|%s', r ->> 'no_changes', r ->> 'no_changes_why') from r93 where tag = 'F2'),
  'true|same_order — the claims were already in this order, so nothing was written and no receipt was issued',
  'F2 the same order again is a NO-OP by value, said by name');
select is(
  (select format('%s|%s|%s|%s', c.status, c.result_reason, c.cancelled_by, (select r ->> 'no_changes' from r93 where tag = 'F9'))
   from waiver_claims c where c.id = ((select r from r93 where tag = 'D6') #>> '{claim,id}')::uuid),
  'cancelled|cancelled|99300000-0000-4000-8000-000000000003|false',
  'F9 the manager cancels his claim: cancelled, by him');
select is(
  (select string_agg(c.add_player_id || '>' || coalesce(c.drop_player_id, '-') || ':' || c.claim_order, ' ' order by c.claim_order)
   from waiver_claims c where c.team_id = 'c9300000-0000-4000-8000-000000000003' and c.status = 'pending'),
  'wc-f1>wc-a1:1 wc-f2>-:2',
  'F9b …and the remaining order stays dense (1, 2) in the order it had');
select is(
  (select format('%s|%s', r ->> 'no_changes', r ->> 'no_changes_why') from r93 where tag = 'F10'),
  'true|already_cancelled — the claim was cancelled earlier, so nothing was written and no receipt was issued',
  'F10 cancelling a cancelled claim under a NEW action_id is a no-op by value, said by name');
select is(
  (select (select r from r93 where tag = 'F11')::text = (select r from r93 where tag = 'F9')::text),
  true,
  'F11 REPLAY of the cancel is byte-identical to the original (not the later no-op)');
select is(
  (select count(*)::int from commissioner_actions where league_id = 'b9300000-0000-4000-8000-000000000001') - (select n from audit0),
  2,
  'F12 the manager''s reorders and cancels wrote NO audit row (still the two commissioner submits)');

-- the commissioner reorders then cancels for WC Alpha
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into r93 select 'F13', public.waiver_claim_reorder('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003',
  array[((select r from r93 where tag = 'D5') #>> '{claim,id}')::uuid, ((select r from r93 where tag = 'D1') #>> '{claim,id}')::uuid],
  'a9300000-0000-4000-8000-000000000311');
insert into r93 select 'F14', public.waiver_claim_cancel('b9300000-0000-4000-8000-000000000001', ((select r from r93 where tag = 'D5') #>> '{claim,id}')::uuid, 'a9300000-0000-4000-8000-000000000312', 'duplicate of a trade');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select string_agg(format('%s|%s|%s', a.action_type, a.acting_as_team_id, coalesce(a.reason, 'null')), ' ' order by a.created_at, a.action_type)
   from commissioner_actions a where a.league_id = 'b9300000-0000-4000-8000-000000000001' and a.acting_as_team_id = 'c9300000-0000-4000-8000-000000000003'),
  'cancel_waiver_claim|c9300000-0000-4000-8000-000000000003|duplicate of a trade reorder_waiver_claims|c9300000-0000-4000-8000-000000000003|null',
  'F13 the commissioner''s reorder and cancel for WC Alpha each write ONE audit row acting as that team');
select is(
  (select count(*)::int from notifications where user_id = '99300000-0000-4000-8000-000000000003' and type = 'league_waiver_claim_commissioner'),
  2,
  'F14 …and WC Alpha''s manager is notified of each');
select is(
  (select format('%s|%s', c.status, c.cancelled_by) from waiver_claims c where c.id = ((select r from r93 where tag = 'D5') #>> '{claim,id}')::uuid),
  'cancelled|99300000-0000-4000-8000-000000000001',
  'F15 the cancelled claim records the commissioner as the canceller');
-- a SETTLED claim cannot be cancelled (fixture: the run is L.D2.9's — stand it in)
update waiver_claims set status = 'lost', result_reason = 'outbid', processed_at = '2026-10-08 10:00:00+00'
 where id = ((select r from r93 where tag = 'D1') #>> '{claim,id}')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.waiver_claim_cancel('b9300000-0000-4000-8000-000000000001', '%s', 'a9300000-0000-4000-8000-000000000313') $$,
    (select r #>> '{claim,id}' from r93 where tag = 'D1')),
  'P0001', 'waiver_claim_cancel: the claim for WC Free One was already settled by a waiver run (lost) — only a pending claim can be cancelled',
  'F16 a settled claim is refused by name');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- G. E13 PER ROLE — who can read a blind claim; nobody writes one directly
--    (state here: WC Alpha 3 rows (lost, cancelled, cancelled), WC Bravo 2
--    (D9, E1), WC Commish 1 (E7), WC Open Seat 1 (E6) — 7 in L1.)
-- ---------------------------------------------------------------------------
create temp table q93_before as select * from waiver_claims;
select is((select count(*)::int from waiver_claims where league_id = 'b9300000-0000-4000-8000-000000000001'), 7,
  'G0 PREMISE: seven claims exist in L1 across four teams (so every zero below is privacy, not emptiness)');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from waiver_claims), 0, 'G1 ANON reads ZERO claims');
select throws_ok($$ insert into waiver_claims (league_id, team_id, add_player_id, action_id, created_by) values ('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f3', gen_random_uuid(), '99300000-0000-4000-8000-000000000003') $$,
  '42501', null, 'G1b ANON cannot INSERT (42501)');
select results_eq($$ with u as (update waiver_claims set faab_bid = 0 returning 1) select count(*)::int from u $$, $$ values (0) $$, 'G1c ANON UPDATE touches 0 rows');
select results_eq($$ with d as (delete from waiver_claims returning 1) select count(*)::int from d $$, $$ values (0) $$, 'G1d ANON DELETE touches 0 rows');
reset role;
set local role authenticated;
-- a NON-member
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is((select count(*)::int from waiver_claims), 0, 'G2 a NON-member reads ZERO claims');
select throws_ok($$ insert into waiver_claims (league_id, team_id, add_player_id, action_id, created_by) values ('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f3', gen_random_uuid(), '99300000-0000-4000-8000-000000000005') $$,
  '42501', null, 'G2b …cannot INSERT (42501)');
-- a MEMBER who owns no claim
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select is((select count(*)::int from waiver_claims), 0,
  'G3 E13: a league MEMBER with no claims of his own reads ZERO — not another team''s claim, not even a count');
select results_eq($$ with u as (update waiver_claims set faab_bid = 0 returning 1) select count(*)::int from u $$, $$ values (0) $$, 'G3b …UPDATE touches 0 rows');
-- ANOTHER member who owns claims — sees ONLY his own
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select string_agg(distinct team_id::text, ',') || '|' || count(*) from waiver_claims),
  'c9300000-0000-4000-8000-000000000004|2',
  'G4 E13: WC Bravo''s manager reads exactly his two claims — none of WC Alpha''s, WC Commish''s or the open seat''s');
select results_eq($$ with d as (delete from waiver_claims returning 1) select count(*)::int from d $$, $$ values (0) $$, 'G4b …DELETE touches 0 rows, his own included');
-- the OWNER (WC Alpha) — sees his own, writes nothing directly (C73)
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (select string_agg(distinct team_id::text, ',') || '|' || count(*) from waiver_claims),
  'c9300000-0000-4000-8000-000000000003|3',
  'G5 the OWNER reads his three claims (settled and cancelled included) and nothing else');
select throws_ok($$ insert into waiver_claims (league_id, team_id, add_player_id, action_id, created_by) values ('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'wc-f3', gen_random_uuid(), '99300000-0000-4000-8000-000000000003') $$,
  '42501', null, 'G5c C73: the OWNER cannot INSERT his own claim directly (42501 — spec 12.10 printed FOR ALL is not built)');
select results_eq($$ with u as (update waiver_claims set faab_bid = 0, status = 'won' returning 1) select count(*)::int from u $$, $$ values (0) $$, 'G5d …UPDATE of his own claims touches 0 rows');
select results_eq($$ with d as (delete from waiver_claims returning 1) select count(*)::int from d $$, $$ values (0) $$, 'G5e …DELETE touches 0 rows');
select is((select count(*)::int from waiver_claim_actions), 0, 'G5f …and reads ZERO ledger rows (zero policies — it holds bids)');
select throws_ok($$ insert into waiver_claim_actions (league_id, team_id, verb, action_id, actor_id, result) values ('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000003', 'waiver_claim_submit', gen_random_uuid(), '99300000-0000-4000-8000-000000000003', '{}') $$,
  '42501', null, 'G5g …and cannot PRE-PLANT a ledger row (a forged replay)');
-- the COMMISSIONER and the CO-commissioner see every claim of THEIR league
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from waiver_claims where league_id = 'b9300000-0000-4000-8000-000000000001'), 7,
  'G6 the COMMISSIONER reads all seven claims of his league');
select throws_ok($$ insert into waiver_claims (league_id, team_id, add_player_id, action_id, created_by) values ('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000004', 'wc-f3', gen_random_uuid(), '99300000-0000-4000-8000-000000000001') $$,
  '42501', null, 'G6b …but cannot INSERT directly (42501) — the audited verb is the only door');
select results_eq($$ with u as (update waiver_claims set faab_bid = 0 returning 1) select count(*)::int from u $$, $$ values (0) $$, 'G6c …UPDATE touches 0 rows');
select is((select count(*)::int from waiver_claim_actions), 0, 'G6d …and reads ZERO ledger rows');
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*)::int from waiver_claims where league_id = 'b9300000-0000-4000-8000-000000000001'), 7,
  'G7 the CO-commissioner reads all seven too (is_league_commish)');
reset role;
select set_config('request.jwt.claims', '', true);
select set_eq($$ select * from waiver_claims $$, $$ select * from q93_before $$,
  'G8 the claims are BYTE-IDENTICAL after every client walk');

-- ---------------------------------------------------------------------------
-- H. The FAAB floor (TD2) — no path stores a negative balance
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update league_members set faab_balance = -1 where team_id = 'c9300000-0000-4000-8000-000000000003' $$,
  '23514', null,
  'H1 as the OWNER role (postgres, the role every DEFINER writer runs as) a -1 balance is refused by the CHECK');
select lives_ok(
  $$ update league_members set faab_balance = 0 where team_id = 'c9300000-0000-4000-8000-000000000005' $$,
  'H2 BOUNDARY: a balance of exactly $0 is storable');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select results_eq($$ with u as (update league_members set faab_balance = 999 where team_id = 'c9300000-0000-4000-8000-000000000003' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'H3 a manager cannot write his own balance (league_members has no client write policy, 063)');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000005', 'wc-f2', null, 1, 'a9300000-0000-4000-8000-000000000402') $$,
  'P0001', 'waiver_claim_submit: a bid of $1 is more than WC Open Seat''s FAAB balance of $0 (§13.2)',
  'H4 a $0 balance takes no bid above $0 — the verb guard reads the CURRENT balance under the lock');
reset role;
select set_config('request.jwt.claims', '', true);
update league_members set faab_balance = null where team_id = 'c9300000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99300000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.waiver_claim_submit('b9300000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000007', 'wc-f2', null, 1, 'a9300000-0000-4000-8000-000000000403') $$,
  'P0001', 'waiver_claim_submit: WC Delta has no FAAB balance on record (its league_members seat holds NULL) — refusing to accept a bid against money that is not recorded (§12.2)',
  'H5 LOUD, never "nothing happened": a FAAB bid against a NULL balance is refused by name, never read as $0 or as unlimited');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
