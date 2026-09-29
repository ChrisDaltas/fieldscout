-- ============================================================================
-- Trades core — the tables, propose / accept / reject / cancel / counter and
-- the E37 invalidation trigger — pgTAP 096 (M5 task L.D3.2; migration 148;
-- spec §13.3, §7.3.5, §12.11 (+ C74), §12.12 / §10.3, E36, E37, CLAUDE.md
-- rule 7; tasks-M5 TD4 / TD5 / TD12 / TD13 / TD16).
--
-- Numbering (D161, measured): heads 147 / 095 ⇒ migration 148 / pgTAP 096.
-- OWN FIXTURE: leagues b96…, teams c96…, users 996…, action ids a96…,
-- players tr-*.
--
-- Falsifiability (tasks-M1 §4.3):
--   * EXCLUSIVITY as stored literals: a leg naming another team's player, or
--     nobody's, is refused BY NAME (C11 / C12 / F5); acceptance re-checks it.
--   * E36 BOUNDARIES: 4 players into 3 spots refused naming "1 more drop"
--     (C13 / E5); the same trade with exactly one drop lands (D2 / E7).
--   * FAAB BOUNDARY: $40 against a $40 balance lands (D4), $41 refused (C17).
--   * E37: a DELETE through the real drop verb and an UPDATE through the real
--     commissioner move verb each invalidate EXACTLY the in-flight trades
--     naming that player leaving that team — resolved trades untouched, the
--     executing trade exempt (§G).
--   * PERMISSIONS PER ROLE (§E / §H): anon, a non-member, a non-party member,
--     the wrong party, the right party, the commissioner and the
--     co-commissioner — each a stored literal; RETURNING-counted writes for
--     every role on all four tables.
--   * BREAK PROBES shown red in the PR, then reverted: (1) drop the
--     exclusivity branch in trade_check_internal ⇒ C11 reds; (2) drop the
--     trade_drops arm of the E37 trigger ⇒ G1 reds; (3) let the OTHER party
--     through the respond gate ⇒ E3 reds.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(111);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', column_name, data_type, is_nullable), ' ' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'trades'),
  'id:uuid:NO league_id:uuid:NO proposer_team_id:uuid:NO recipient_team_id:uuid:NO status:text:NO status_reason:text:YES review_deadline:timestamp with time zone:YES execute_after:timestamp with time zone:YES note:text:YES countered_from:uuid:YES proposed_by:uuid:NO accepted_at:timestamp with time zone:YES accepted_by:uuid:YES resolved_at:timestamp with time zone:YES resolved_by:uuid:YES action_id:uuid:NO created_at:timestamp with time zone:NO',
  'A1 trades is spec 12.11 plus the C74 columns (status_reason, execute_after, countered_from, proposed_by, accepted_at/by, resolved_by, action_id)');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.trades'::regclass and c.conname = 'trades_status_check'),
  'CHECK ((status = ANY (ARRAY[''proposed''::text, ''accepted''::text, ''rejected''::text, ''cancelled''::text, ''in_review''::text, ''vetoed''::text, ''complete''::text, ''reversed''::text, ''invalid''::text, ''expired''::text])))',
  'A2 C74: the status vocabulary is spec 12.11 plus invalid and expired');
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c
   where c.oid in ('public.trades'::regclass, 'public.trade_items'::regclass, 'public.trade_drops'::regclass, 'public.trade_actions'::regclass)),
  'A3 RLS is ENABLED on all four new tables');
select is(
  (select string_agg(format('%s/%s/%s', tablename, cmd, array_to_string(roles, ',')), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'public' and tablename in ('trades', 'trade_items', 'trade_drops', 'trade_actions')),
  'trade_drops/SELECT/authenticated trade_items/SELECT/authenticated trades/SELECT/authenticated',
  'A4 exactly three policies, all SELECT for authenticated (spec 12.11 member read); NO write policy for any role (TD4) and ZERO on the ledger (D350)');
select ok(
  not exists (select 1 from unnest(array['trades', 'trade_items', 'trade_drops', 'trade_actions']) t
              where has_table_privilege('anon', 'public.' || t, 'TRUNCATE') or has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE'))
  and has_table_privilege('service_role', 'public.trades', 'TRUNCATE'),
  'A5 all four tables are born WITHOUT TRUNCATE for anon + authenticated (081 section A / 133); service_role keeps it');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'trade%' or p.proname = 'broadcast_trade_change')),
  'broadcast_trade_change:t:search_path="":f:f trade_broadcast_payload:f:search_path="":f:f trade_check_internal:f:search_path="":f:f trade_close_internal:f:search_path="":f:f trade_deadline:t:search_path="":f:t trade_deadline_internal:f:search_path="":f:f trade_deadline_read_internal:f:search_path="":f:f trade_deadline_view_internal:f:search_path="":f:f trade_execute_internal:f:search_path="":f:f trade_invalidate_on_roster_change:t:search_path="":f:f trade_lock_internal:f:search_path="":f:f trade_notify_team_internal:f:search_path="":f:f trade_preview:t:search_path="":f:t trade_preview_internal:f:search_path="":f:f trade_propose:t:search_path="":f:t trade_propose_core_internal:f:search_path="":f:f trade_propose_internal:f:search_path="":f:f trade_receipt_internal:f:search_path="":f:f trade_rescind_on_stint_close:t:search_path="":f:f trade_respond:t:search_path="":f:t trade_respond_internal:f:search_path="":f:f trade_summary_internal:f:search_path="":f:f trade_tick:f:search_path="":f:f trade_view_internal:f:search_path="":f:f trade_vote:t:search_path="":f:t trade_vote_internal:f:search_path="":f:f trade_vote_tally:t:search_path="":f:t trade_vote_tally_internal:f:search_path="":f:f trade_vote_veto_internal:f:search_path="":f:f trade_vote_view_internal:f:search_path="":f:f',
  'A6 thirty functions (148''s thirteen + 151''s six + 155''s six + 162''s five — re-cut by L.D3.3, L.D3.4 and L.D3.12), one overload each: six DEFINER doors (authenticated EXECUTE, the in-body gate authorizes), three DEFINER trigger functions and twenty-one PLAIN internals REVOKEd from anon and authenticated; all search_path empty');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and (p.proname like 'trade%' or p.proname = 'broadcast_trade_change')
      and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'A7 …and PUBLIC holds EXECUTE on none of them');
select is(
  (select string_agg(format('%s:%s', t.tgname, t.tgenabled), ' ' order by t.tgname)
   from pg_trigger t where t.tgrelid = 'public.league_rosters'::regclass and t.tgname like 'trg_trade%'),
  'trg_trade_invalidate_on_roster_delete:A trg_trade_invalidate_on_roster_move:A',
  'A8 E37: two triggers on league_rosters (DELETE; UPDATE OF team_id), both ENABLE ALWAYS (R616 — a replica-mode session cannot skip them)');
select is(
  (select string_agg(t.tgname, ' ' order by t.tgname) from pg_trigger t where t.tgrelid = 'public.trades'::regclass and not t.tgisinternal),
  'tr_broadcast_trades_insert tr_broadcast_trades_status',
  'A9 trades is broadcast on INSERT and on a status change (D38), and carries no other trigger');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
--   L1 b96…01 in_season, faab, allow_faab_in_trades — roster_size 3 (1 QB + 2 bench)
--     TC  c96…01 u1 commissioner (100)  roster c1
--     TCO c96…02 u2 co_commissioner     roster —
--     TA  c96…03 u3 manager (40)        roster a1 a2 a3   (FULL)
--     TB  c96…04 u4 manager (100)       roster b1 b2 b3   (FULL)
--     TO  c96…05 OPEN seat (25)         roster o1
--     TR  c96…06 RETIRED                roster —
--     TD  c96…07 u6 manager (100)       roster d1
--     TE  c96…08 u7 manager            roster e1
--     TF  c96…09 u8 manager, NEVER a party to any trade — roster —
--   L2 b96…02 in_season rolling_priority, allow_faab_in_trades (u1 c96…20 x1, u3 c96…21 y1)
--   L3 b96…03 SETUP faab (u1 c96…30, u3 c96…31)
--   L4 b96…04 in_season faab, allow_faab_in_trades OFF, allow_future_considerations ON
--      (u1 c96…40 z1, u3 c96…41 z2)
--   u5 is a member of NO league. f1 is on no roster.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99600000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-tr' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'tr_user' || i)::jsonb, now(), now()
from generate_series(1, 8) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, settings, roster_settings)
select l.id, '99600000-0000-4000-8000-000000000001', l.nm, 2026, l.status, 12, 6, 0, 7,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.wt, 100, l.st,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
         "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b9600000-0000-4000-8000-000000000001'::uuid, 'pgtap-tr-L1', 'in_season', 'faab',             '{"allow_faab_in_trades": true}'::jsonb),
 ('b9600000-0000-4000-8000-000000000002'::uuid, 'pgtap-tr-L2', 'in_season', 'rolling_priority', '{"allow_faab_in_trades": true}'::jsonb),
 ('b9600000-0000-4000-8000-000000000003'::uuid, 'pgtap-tr-L3', 'setup',     'faab',             '{}'::jsonb),
 ('b9600000-0000-4000-8000-000000000004'::uuid, 'pgtap-tr-L4', 'in_season', 'faab',             '{"allow_faab_in_trades": false, "allow_future_considerations": true}'::jsonb)
) as l(id, nm, status, wt, st);

insert into teams (id, owner_id, name, league_id, status) values
 ('c9600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000001', 'TR Commish', 'b9600000-0000-4000-8000-000000000001', 'active'),
 ('c9600000-0000-4000-8000-000000000002', '99600000-0000-4000-8000-000000000002', 'TR Co',      'b9600000-0000-4000-8000-000000000001', 'active'),
 ('c9600000-0000-4000-8000-000000000003', '99600000-0000-4000-8000-000000000003', 'TR Alpha',   'b9600000-0000-4000-8000-000000000001', 'active'),
 ('c9600000-0000-4000-8000-000000000004', '99600000-0000-4000-8000-000000000004', 'TR Bravo',   'b9600000-0000-4000-8000-000000000001', 'active'),
 ('c9600000-0000-4000-8000-000000000005', '99600000-0000-4000-8000-000000000001', 'TR Open',    'b9600000-0000-4000-8000-000000000001', 'active'),
 ('c9600000-0000-4000-8000-000000000006', '99600000-0000-4000-8000-000000000001', 'TR Retired', 'b9600000-0000-4000-8000-000000000001', 'retired'),
 ('c9600000-0000-4000-8000-000000000007', '99600000-0000-4000-8000-000000000006', 'TR Delta',   'b9600000-0000-4000-8000-000000000001', 'active'),
 ('c9600000-0000-4000-8000-000000000008', '99600000-0000-4000-8000-000000000007', 'TR Echo',    'b9600000-0000-4000-8000-000000000001', 'active'),
 ('c9600000-0000-4000-8000-000000000009', '99600000-0000-4000-8000-000000000008', 'TR Foxtrot', 'b9600000-0000-4000-8000-000000000001', 'active'),
 ('c9600000-0000-4000-8000-000000000020', '99600000-0000-4000-8000-000000000001', 'TR L2 C',    'b9600000-0000-4000-8000-000000000002', 'active'),
 ('c9600000-0000-4000-8000-000000000021', '99600000-0000-4000-8000-000000000003', 'TR L2 A',    'b9600000-0000-4000-8000-000000000002', 'active'),
 ('c9600000-0000-4000-8000-000000000030', '99600000-0000-4000-8000-000000000001', 'TR L3 C',    'b9600000-0000-4000-8000-000000000003', 'active'),
 ('c9600000-0000-4000-8000-000000000031', '99600000-0000-4000-8000-000000000003', 'TR L3 A',    'b9600000-0000-4000-8000-000000000003', 'active'),
 ('c9600000-0000-4000-8000-000000000040', '99600000-0000-4000-8000-000000000001', 'TR L4 C',    'b9600000-0000-4000-8000-000000000004', 'active'),
 ('c9600000-0000-4000-8000-000000000041', '99600000-0000-4000-8000-000000000003', 'TR L4 A',    'b9600000-0000-4000-8000-000000000004', 'active');

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b9600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000001', 'commissioner',    false, 100),
 ('b9600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000002', 'c9600000-0000-4000-8000-000000000002', 'co_commissioner', false, 100),
 ('b9600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000003', 'manager',         false, 40),
 ('b9600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000004', 'c9600000-0000-4000-8000-000000000004', 'manager',         false, 100),
 ('b9600000-0000-4000-8000-000000000001', null,                                   'c9600000-0000-4000-8000-000000000005', 'manager',         true,  25),
 ('b9600000-0000-4000-8000-000000000001', null,                                   'c9600000-0000-4000-8000-000000000006', 'manager',         true,  100),
 ('b9600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000006', 'c9600000-0000-4000-8000-000000000007', 'manager',         false, 100),
 ('b9600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000007', 'c9600000-0000-4000-8000-000000000008', 'manager',         false, 100),
 ('b9600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000008', 'c9600000-0000-4000-8000-000000000009', 'manager',         false, 100),
 ('b9600000-0000-4000-8000-000000000002', '99600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000020', 'commissioner',    false, 100),
 ('b9600000-0000-4000-8000-000000000002', '99600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000021', 'manager',         false, 100),
 ('b9600000-0000-4000-8000-000000000003', '99600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000030', 'commissioner',    false, 100),
 ('b9600000-0000-4000-8000-000000000003', '99600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000031', 'manager',         false, 100),
 ('b9600000-0000-4000-8000-000000000004', '99600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000040', 'commissioner',    false, 100),
 ('b9600000-0000-4000-8000-000000000004', '99600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000041', 'manager',         false, 100);

insert into players (id, full_name, position, team, status) values
 ('tr-a1', 'TR A One',   'QB', 'TRA', 'Active'), ('tr-a2', 'TR A Two',   'QB', 'TRA', 'Active'), ('tr-a3', 'TR A Three', 'QB', 'TRA', 'Active'),
 ('tr-b1', 'TR B One',   'QB', 'TRB', 'Active'), ('tr-b2', 'TR B Two',   'QB', 'TRB', 'Active'), ('tr-b3', 'TR B Three', 'QB', 'TRB', 'Active'),
 ('tr-c1', 'TR C One',   'QB', 'TRC', 'Active'), ('tr-o1', 'TR O One',   'QB', 'TRO', 'Active'), ('tr-d1', 'TR D One',   'QB', 'TRD', 'Active'),
 ('tr-e1', 'TR E One',   'QB', 'TRE', 'Active'), ('tr-f1', 'TR Free One', 'QB', 'TRF', 'Active'),
 ('tr-x1', 'TR X One',   'QB', 'TRX', 'Active'), ('tr-y1', 'TR Y One',   'QB', 'TRX', 'Active'),
 ('tr-z1', 'TR Z One',   'QB', 'TRZ', 'Active'), ('tr-z2', 'TR Z Two',   'QB', 'TRZ', 'Active');

insert into league_rosters (league_id, team_id, player_id, slot_key) values
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000001', 'tr-c1', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'tr-a1', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'tr-a2', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'tr-a3', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000004', 'tr-b1', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000004', 'tr-b2', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000004', 'tr-b3', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000005', 'tr-o1', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000007', 'tr-d1', 'bn'),
 ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000008', 'tr-e1', 'bn'),
 ('b9600000-0000-4000-8000-000000000002', 'c9600000-0000-4000-8000-000000000020', 'tr-x1', 'bn'),
 ('b9600000-0000-4000-8000-000000000002', 'c9600000-0000-4000-8000-000000000021', 'tr-y1', 'bn'),
 ('b9600000-0000-4000-8000-000000000004', 'c9600000-0000-4000-8000-000000000040', 'tr-z1', 'bn'),
 ('b9600000-0000-4000-8000-000000000004', 'c9600000-0000-4000-8000-000000000041', 'tr-z2', 'bn');
-- The real drop verb (§G) needs the season calendar (lineup_current_week_internal).
insert into league_weeks (league_id, season, week)
select 'b9600000-0000-4000-8000-000000000001', 2026, w from generate_series(1, 6) w;

-- Post-reset race guard (067's): today's + tomorrow's realtime.messages partitions.
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'realtime' and c.relname = part_name) then
      execute format('create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
                     part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;

create temp table r96 (tag text primary key, r jsonb not null);
grant select, insert on r96 to authenticated;
create function pg_temp.tid(p_tag text) returns uuid language sql as $$
  select coalesce((select (r #>> '{counter_trade,id}')::uuid from r96 where tag = p_tag),
                  (select (r #>> '{trade,id}')::uuid from r96 where tag = p_tag)) $$;
create temp table audit0 as select count(*)::int as n from commissioner_actions where league_id = 'b9600000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- C. trade_propose refusals — auth first, then shape, then each rule BY NAME
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000001') $$,
  '42501', null, 'C1 ANON cannot even execute the door (EXECUTE revoked)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000002') $$,
  '42501', 'trade_propose: not a manager of this team', 'C2 a NON-member gets the one no-leak 42501');
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000003') $$,
  '42501', 'trade_propose: not a manager of this team', 'C3 another MANAGER cannot propose for a team he does not manage — same 42501');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-0000000000ff', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[]', null, null, 'a9600000-0000-4000-8000-000000000004') $$,
  '42501', 'trade_propose: not a manager of this team', 'C4 …and so does a league that does not exist (no existence leak)');

select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}]', null, null, null) $$,
  '22023', null, 'C5 no action_id is refused BY NAME (22023)');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[]', null, null, 'a9600000-0000-4000-8000-000000000006') $$,
  '22023', null, 'C6 an empty trade is refused BY NAME (22023)');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "faab_amount": 5, "from_team_id": "c9600000-0000-4000-8000-000000000003"}]', null, null, 'a9600000-0000-4000-8000-000000000007') $$,
  '22023', null, 'C7 a leg that is both a player and FAAB is refused BY NAME (22023)');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003", "pick": 1}]', null, null, 'a9600000-0000-4000-8000-000000000008') $$,
  '22023', null, 'C8 an unknown leg key (no draft picks in redraft) is refused BY NAME (22023)');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-d1", "from_team_id": "c9600000-0000-4000-8000-000000000007"}]', null, null, 'a9600000-0000-4000-8000-000000000009') $$,
  '22023', null, 'C9 a leg from a team that is not in the trade is refused BY NAME (22023)');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000010') $$,
  '22023', 'trade_propose: the trade names tr-a1 more than once — each player is one leg', 'C10 the same player twice is refused BY NAME (22023)');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000011') $$,
  'P0001', 'trade_propose: TR B One (tr-b1) is on TR Bravo''s roster, not TR Alpha''s — a trade can only move a player from the team that has him (player exclusivity, §13.3 / CLAUDE.md rule 7)',
  'C11 EXCLUSIVITY: offering another team''s player as your own is refused BY NAME, naming who has him');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-f1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000012') $$,
  'P0001', 'trade_propose: TR Free One (tr-f1) is not on any roster in this league — only a rostered player can be traded (§13.3)',
  'C12 EXCLUSIVITY: a player nobody rosters cannot be traded');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}, {"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000013') $$,
  'P0001', 'trade_propose: TR Alpha''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)',
  'C13 E36 BOUNDARY: a 1-for-2 into a full roster (4 players, 3 spots) is refused naming ONE more drop');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}, {"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', array['tr-b3'], null, 'a9600000-0000-4000-8000-000000000014') $$,
  'P0001', 'trade_propose: TR B Three (tr-b3) is not on TR Alpha''s roster — a team can only drop its own players to make room (E36)',
  'C14 a drop of another team''s player is refused by name');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}, {"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', array['tr-a1'], null, 'a9600000-0000-4000-8000-000000000015') $$,
  'P0001', 'trade_propose: TR A One (tr-a1) is already leaving TR Alpha in this trade — he cannot also be one of its drops',
  'C15 a player already leaving in the trade cannot also be a drop');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}]', null, null, 'a9600000-0000-4000-8000-000000000016') $$,
  'P0001', 'trade_propose: TR Bravo gives nothing in this trade — this league does not allow future considerations (allow_future_considerations is off, §7.3.5), so each team gives at least one player or FAAB',
  'C16 a one-sided trade is refused when allow_future_considerations is off');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"faab_amount": 41, "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', array['tr-a3'], null, 'a9600000-0000-4000-8000-000000000017') $$,
  'P0001', 'trade_propose: TR Alpha cannot give $41 of FAAB — its balance is $40 (§13.3)',
  'C17 FAAB BOUNDARY: $41 against a $40 balance is refused (and $40 lands, D4)');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000002', 'c9600000-0000-4000-8000-000000000021', 'c9600000-0000-4000-8000-000000000020',
       '[{"faab_amount": 5, "from_team_id": "c9600000-0000-4000-8000-000000000021"}, {"player_id": "tr-x1", "from_team_id": "c9600000-0000-4000-8000-000000000020"}]', null, null, 'a9600000-0000-4000-8000-000000000018') $$,
  'P0001', 'trade_propose: this league decides waivers by priority (rolling_priority), not FAAB — there is no FAAB to trade (§7.3.4)',
  'C18 a FAAB leg in a priority-waiver league is refused by name');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000004', 'c9600000-0000-4000-8000-000000000041', 'c9600000-0000-4000-8000-000000000040',
       '[{"faab_amount": 5, "from_team_id": "c9600000-0000-4000-8000-000000000041"}, {"player_id": "tr-z1", "from_team_id": "c9600000-0000-4000-8000-000000000040"}]', null, null, 'a9600000-0000-4000-8000-000000000019') $$,
  'P0001', 'trade_propose: FAAB cannot be traded in this league (allow_faab_in_trades is off, §7.3.5)',
  'C19 a FAAB leg is refused when allow_faab_in_trades is off');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000031', 'c9600000-0000-4000-8000-000000000030',
       '[{"player_id": "tr-f1", "from_team_id": "c9600000-0000-4000-8000-000000000031"}]', null, null, 'a9600000-0000-4000-8000-000000000020') $$,
  'P0001', 'trade_propose: league b9600000-0000-4000-8000-000000000003 is setup — trades are made only while the league is in season or in the playoffs (§7.1 / §13.3)',
  'C20 a league not in season / playoffs is refused by name');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000006',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}]', null, null, 'a9600000-0000-4000-8000-000000000021') $$,
  'P0001', 'trade_propose: TR Retired is retired — a sealed franchise makes no trades (§7.2.1)',
  'C21 a retired franchise cannot be traded with');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000003',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}]', null, null, 'a9600000-0000-4000-8000-000000000022') $$,
  'P0001', 'trade_propose: TR Alpha cannot trade with itself — a trade is between two different teams',
  'C22 a team cannot trade with itself');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000020',
       '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}]', null, null, 'a9600000-0000-4000-8000-000000000023') $$,
  'P0001', 'trade_propose: team c9600000-0000-4000-8000-000000000020 is not a franchise of league b9600000-0000-4000-8000-000000000001',
  'C23 a team of ANOTHER league is refused by name');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"faab_amount": 1.5, "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000024') $$,
  '22023', null, 'C24 a fractional FAAB amount is refused BY NAME (22023)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s|%s', (select count(*) from trades), (select count(*) from trade_actions),
                 (select count(*) from notifications where type like 'league_trade%'))),
  '0|0|0',
  'C25 every refusal above wrote NOTHING — no trade, no ledger row, no notification');

-- ---------------------------------------------------------------------------
-- D. The manager proposes (TR Alpha, u3)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
-- P1: a1 for b1, straight swap
insert into r96 select 'P1', public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
  '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, '  straight swap  ', 'a9600000-0000-4000-8000-000000000101');
-- P2: a1 for b1 + b2 WITH one drop (E36 proposer side lands)
insert into r96 select 'P2', public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
  '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}, {"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', array['tr-a2'], null, 'a9600000-0000-4000-8000-000000000102');
-- P3: a1 + a2 for b1 (the RECEIVING team overflows — reported, not enforced)
insert into r96 select 'P3', public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
  '[{"player_id": "tr-a1", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-a2", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b1", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000103');
-- P4: a3 + $40 (the WHOLE balance) for b2
insert into r96 select 'P4', public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
  '[{"player_id": "tr-a3", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"faab_amount": 40, "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000104');
-- replay of P1 (same action_id)
insert into r96 select 'P1r', public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
  '[{"player_id": "tr-a2", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b3", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000101');
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', t.status, t.proposer_team_id, t.recipient_team_id, t.note, t.proposed_by, t.resolved_at is null, t.countered_from is null)
   from trades t where t.id = pg_temp.tid('P1')),
  'proposed|c9600000-0000-4000-8000-000000000003|c9600000-0000-4000-8000-000000000004|straight swap|99600000-0000-4000-8000-000000000003|t|t',
  'D1 the manager proposes: status proposed, the two teams, the note trimmed, proposed_by him, unresolved');
select is(
  (select string_agg(format('%s>%s:%s', i.from_team_id, i.to_team_id, coalesce(i.player_id, '$' || i.faab_amount)), ' ' order by i.player_id nulls last)
   from trade_items i where i.trade_id = pg_temp.tid('P4')),
  'c9600000-0000-4000-8000-000000000003>c9600000-0000-4000-8000-000000000004:tr-a3 c9600000-0000-4000-8000-000000000004>c9600000-0000-4000-8000-000000000003:tr-b2 c9600000-0000-4000-8000-000000000003>c9600000-0000-4000-8000-000000000004:$40',
  'D2 legs are stored with both directions derived from from_team_id; the $40 leg (= the whole balance, boundary) lands');
select is(
  (select format('%s|%s|%s', (select string_agg(d.team_id || ':' || d.player_id, ',') from trade_drops d where d.trade_id = pg_temp.tid('P2')),
                 r #>> '{rosters,proposer,count_after}', r #>> '{rosters,proposer,must_drop}')
   from r96 where tag = 'P2'),
  'c9600000-0000-4000-8000-000000000003:tr-a2|3|0',
  'D3 E36: the same 1-for-2 WITH one drop lands — the drop is stored on the trade and the roster fits (3 of 3)');
select is(
  (select format('%s|%s|%s|%s', r #>> '{rosters,recipient,count_after}', r #>> '{rosters,recipient,must_drop}', r #>> '{rosters,recipient,enforced}', r #>> '{rosters,proposer,count_after}')
   from r96 where tag = 'P3'),
  '4|1|false|2',
  'D4 E36: at PROPOSAL the receiving team''s overflow is REPORTED (must_drop 1), not enforced — it names its drops when it accepts');
select is(
  (select (select r from r96 where tag = 'P1r')::text = (select r from r96 where tag = 'P1')::text),
  true,
  'D5 REPLAY of P1 (same action_id, different body) returns the stored result byte-identically');
select is(
  (select format('%s|%s', (select count(*) from trades where league_id = 'b9600000-0000-4000-8000-000000000001'), (select count(*) from trade_actions))),
  '4|4',
  'D6 …and wrote nothing: four trades, four ledger rows');
select is(
  (select format('%s|%s|%s', r ->> 'acted_as_commissioner', coalesce(r ->> 'commissioner_action_id', 'null'), r ->> 'notified_user_ids') from r96 where tag = 'P1'),
  'false|null|["99600000-0000-4000-8000-000000000004"]',
  'D7 the manager arm: no commissioner receipt; the receiving manager is notified');
select is(
  (select count(*)::int from notifications where user_id = '99600000-0000-4000-8000-000000000004' and type = 'league_trade_proposed'),
  4,
  'D8 TR Bravo''s manager got one league_trade_proposed notification per offer (TD16)');
select is(
  (select r ->> 'summary' from r96 where tag = 'P4'),
  'TR Alpha gives TR A Three, $40 FAAB; TR Bravo gives TR B Two',
  'D9 the summary names both sides, FAAB included');
select is(
  (select format('%s|%s|%s',
     (select string_agg(r.player_id, ',' order by r.player_id) from league_rosters r where r.team_id = 'c9600000-0000-4000-8000-000000000003'),
     (select string_agg(r.player_id, ',' order by r.player_id) from league_rosters r where r.team_id = 'c9600000-0000-4000-8000-000000000004'),
     (select faab_balance from league_members where team_id = 'c9600000-0000-4000-8000-000000000003'))),
  'tr-a1,tr-a2,tr-a3|tr-b1,tr-b2,tr-b3|40',
  'D10 a proposal MOVES NOTHING — both rosters and the FAAB balance are unchanged');
select is(
  (select count(*)::int from commissioner_actions where league_id = 'b9600000-0000-4000-8000-000000000001') - (select n from audit0),
  0,
  'D11 the manager''s proposals wrote NO audit row');

-- ---------------------------------------------------------------------------
-- E. trade_respond — who may answer, and each op
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'accept', null, null, null, 'a9600000-0000-4000-8000-000000000201') $$, pg_temp.tid('P1')),
  '42501', 'trade_respond: not a party to this trade', 'E1 a NON-PARTY member cannot accept (the no-leak 42501)');
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'reject', null, null, null, 'a9600000-0000-4000-8000-000000000202') $$, pg_temp.tid('P1')),
  '42501', 'trade_respond: not a party to this trade', 'E2 a NON-member cannot answer either');
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'accept', null, null, null, 'a9600000-0000-4000-8000-000000000203') $$, pg_temp.tid('P1')),
  'P0001', 'trade_respond: only the team that received a trade can accept it — you proposed this one, so cancel it instead (§13.3)',
  'E3 the PROPOSER cannot accept his own offer — refused by name, naming his move');
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'cancel', null, null, null, 'a9600000-0000-4000-8000-000000000204') $$, pg_temp.tid('P1')),
  'P0001', 'trade_respond: only the team that proposed a trade can cancel it — you received this offer, so reject it instead (§13.3)',
  'E4 the RECEIVING team cannot cancel — refused by name, naming its move');
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'accept', null, null, null, 'a9600000-0000-4000-8000-000000000205') $$, pg_temp.tid('P3')),
  'P0001', 'trade_respond: TR Bravo''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)',
  'E5 E36: accepting a 2-for-1 into a full roster WITHOUT a drop is refused, naming one more drop');
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'accept', array['tr-b1'], null, null, 'a9600000-0000-4000-8000-000000000206') $$, pg_temp.tid('P3')),
  'P0001', 'trade_respond: TR B One (tr-b1) is already leaving TR Bravo in this trade — he cannot also be one of its drops',
  'E6 …and a drop of a player already leaving in the trade does not count');
insert into r96 select 'E7', public.trade_respond('b9600000-0000-4000-8000-000000000001', pg_temp.tid('P3'), 'accept', array['tr-b3'], null, null, 'a9600000-0000-4000-8000-000000000207');
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'accept', array['tr-b3'], null, null, 'a9600000-0000-4000-8000-000000000208') $$, pg_temp.tid('P3')),
  'P0001', 'trade_respond: this trade is already in_review (no reason recorded) — only a proposed trade can be accepted',
  'E8 a SECOND accept (new action_id) is refused by name — never a silent no-op');
insert into r96 select 'E9', public.trade_respond('b9600000-0000-4000-8000-000000000001', pg_temp.tid('P3'), 'accept', null, null, null, 'a9600000-0000-4000-8000-000000000207');
insert into r96 select 'E10', public.trade_respond('b9600000-0000-4000-8000-000000000001', pg_temp.tid('P1'), 'reject', null, null, null, 'a9600000-0000-4000-8000-000000000210');
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'reject', array['tr-b3'], null, null, 'a9600000-0000-4000-8000-000000000211') $$, pg_temp.tid('P2')),
  '22023', null, 'E11 drops on a reject are refused BY NAME (22023)');
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'accept', null, '[]', null, 'a9600000-0000-4000-8000-000000000212') $$, pg_temp.tid('P2')),
  '22023', null, 'E12 legs on an accept are refused BY NAME (22023)');
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'veto', null, null, null, 'a9600000-0000-4000-8000-000000000213') $$, pg_temp.tid('P2')),
  '22023', null, 'E13 an unknown op is refused BY NAME (22023) — veto is the commissioner''s (L.D3.5)');
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'reject', null, null, null, 'a9600000-0000-4000-8000-000000000101') $$, pg_temp.tid('P1')),
  'P0001', 'trade_respond: action_id a9600000-0000-4000-8000-000000000101 already names a trade_propose for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
  'E14 an action_id already spent by trade_propose is refused (R732)');
-- counter P4: TR Bravo offers b2 for a3, no FAAB
insert into r96 select 'E15', public.trade_respond('b9600000-0000-4000-8000-000000000001', pg_temp.tid('P4'), 'counter', null,
  '[{"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}, {"player_id": "tr-a3", "from_team_id": "c9600000-0000-4000-8000-000000000003"}]',
  'no FAAB, just the swap', 'a9600000-0000-4000-8000-000000000215');
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
insert into r96 select 'E16', public.trade_respond('b9600000-0000-4000-8000-000000000001', pg_temp.tid('P2'), 'cancel', null, null, null, 'a9600000-0000-4000-8000-000000000216');
select throws_ok(
  format($$ select public.trade_respond('b9600000-0000-4000-8000-000000000001', '%s', 'cancel', null, null, null, 'a9600000-0000-4000-8000-000000000217') $$, pg_temp.tid('P1')),
  'P0001', 'trade_respond: this trade is already rejected (rejected by TR Bravo) — only a proposed trade can be cancelled',
  'E17 a resolved trade cannot be answered again — refused by name, with the reason it closed');
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select format('%s|%s|%s|%s', t.status, t.accepted_by, t.accepted_at is not null, t.resolved_at is null) from trades t where t.id = pg_temp.tid('P3')),
  'in_review|99600000-0000-4000-8000-000000000004|t|t',
  'E7a the receiving manager accepts WITH a drop: accepted by him and IN REVIEW (the league''s default commissioner review, §13.3 — re-cut by L.D3.3), still in flight');
select is(
  (select format('%s|%s|%s', (select string_agg(d.team_id || ':' || d.player_id, ',' order by d.player_id) from trade_drops d where d.trade_id = pg_temp.tid('P3')),
                 r #>> '{rosters,recipient,count_after}', r #>> '{rosters,recipient,enforced}')
   from r96 where tag = 'E7'),
  'c9600000-0000-4000-8000-000000000004:tr-b3|3|true',
  'E7b E36: his drop is stored on the trade and his roster fits (3 of 3), now ENFORCED');
select is(
  (select string_agg(r.player_id, ',' order by r.player_id) from league_rosters r where r.team_id = 'c9600000-0000-4000-8000-000000000004'),
  'tr-b1,tr-b2,tr-b3',
  'E7c a trade in review MOVES NOTHING yet — it executes when review ends (L.D3.3; b3 is still on TR Bravo)');
select is(
  (select (select r from r96 where tag = 'E9')::text = (select r from r96 where tag = 'E7')::text),
  true,
  'E9 REPLAY of the accept (same action_id, no drops sent) is byte-identical to the original');
select is(
  (select format('%s|%s|%s', t.status, t.status_reason, t.resolved_by) from trades t where t.id = pg_temp.tid('P1')),
  'rejected|rejected by TR Bravo|99600000-0000-4000-8000-000000000004',
  'E10 reject: rejected, with its reason and who');
select is(
  (select format('%s|%s|%s', t.status, t.status_reason, t.resolved_by) from trades t where t.id = pg_temp.tid('P2')),
  'cancelled|cancelled by TR Alpha|99600000-0000-4000-8000-000000000003',
  'E16 cancel: the proposer withdraws — cancelled, with its reason and who');
select is(
  (select format('%s|%s', t.status, t.status_reason) from trades t where t.id = (select (r #>> '{trade,id}')::uuid from r96 where tag = 'E15')),
  'rejected|countered by TR Bravo',
  'E15a COUNTER = the original offer is rejected, reason "countered"');
select is(
  (select format('%s|%s|%s|%s|%s', t.status, t.proposer_team_id, t.recipient_team_id, t.countered_from = pg_temp.tid('P4'), t.note)
   from trades t where t.id = pg_temp.tid('E15')),
  'proposed|c9600000-0000-4000-8000-000000000004|c9600000-0000-4000-8000-000000000003|t|no FAAB, just the swap',
  'E15b …and a NEW proposal the other way, linked by countered_from, carrying the counter''s note');
select is(
  (select string_agg(n.type, ',' order by n.type) from notifications n where n.user_id = '99600000-0000-4000-8000-000000000003' and n.type like 'league_trade%'),
  'league_trade_accepted,league_trade_countered,league_trade_rejected',
  'E18 TD16: the proposer was told of the accept, the reject and the counter (and nothing else)');
select is(
  (select (n.data ->> 'trade_id')::uuid = pg_temp.tid('E15') from notifications n where n.user_id = '99600000-0000-4000-8000-000000000003' and n.type = 'league_trade_countered'),
  true,
  'E19 …the counter notification points at the NEW proposal');
select is(
  (select count(*)::int from notifications where user_id = '99600000-0000-4000-8000-000000000004' and type = 'league_trade_cancelled'),
  1,
  'E20 the receiving manager was told of the cancel');
select is(
  (select count(*)::int from commissioner_actions where league_id = 'b9600000-0000-4000-8000-000000000001') - (select n from audit0),
  0,
  'E21 no manager answer wrote an audit row');

-- ---------------------------------------------------------------------------
-- F. The commissioner arm (TD5) — either side, one audit row each
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- F1: the commissioner proposes FOR TR Delta, to the OPEN seat
insert into r96 select 'F1', public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000007', 'c9600000-0000-4000-8000-000000000005',
  '[{"player_id": "tr-d1", "from_team_id": "c9600000-0000-4000-8000-000000000007"}, {"player_id": "tr-o1", "from_team_id": "c9600000-0000-4000-8000-000000000005"}]', null, null, 'a9600000-0000-4000-8000-000000000301', 'manager away');
-- F2: …and accepts it FOR the open seat
insert into r96 select 'F2', public.trade_respond('b9600000-0000-4000-8000-000000000001', pg_temp.tid('F1'), 'accept', null, null, null, 'a9600000-0000-4000-8000-000000000302');
select throws_ok(
  $$ select public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
       '[{"player_id": "tr-b3", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000303') $$,
  'P0001', 'trade_propose: TR B Three (tr-b3) is on TR Bravo''s roster, not TR Alpha''s — a trade can only move a player from the team that has him (player exclusivity, §13.3 / CLAUDE.md rule 7)',
  'F3 the commissioner is BOUND by exclusivity (standing rule (i)) — refused by name like anyone');
-- F4: the CO-commissioner cancels TR Bravo''s counter (E15) for TR Bravo (the proposer)
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
insert into r96 select 'F4', public.trade_respond('b9600000-0000-4000-8000-000000000001', pg_temp.tid('E15'), 'cancel', null, null, null, 'a9600000-0000-4000-8000-000000000304');
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select string_agg(format('%s|%s|%s|%s|%s', a.action_type, a.target_type, a.acting_as_team_id, coalesce(a.reason, 'null'), a.actor_id), ' ' order by a.action_type)
   from commissioner_actions a where a.league_id = 'b9600000-0000-4000-8000-000000000001'),
  'accept_trade|trade|c9600000-0000-4000-8000-000000000005|null|99600000-0000-4000-8000-000000000001 cancel_trade|trade|c9600000-0000-4000-8000-000000000004|null|99600000-0000-4000-8000-000000000002 propose_trade|trade|c9600000-0000-4000-8000-000000000007|manager away|99600000-0000-4000-8000-000000000001',
  'F5 exactly THREE audit rows — one per commissioner act, each acting as the side he moved for, the reason kept when given');
select is(
  (select count(*)::int from league_chat where league_id = 'b9600000-0000-4000-8000-000000000001' and is_system
     and message = 'tr_user1 (commissioner) proposed a trade for TR Delta: TR Delta gives TR D One; TR Open gives TR O One — reason: manager away'),
  1,
  'F6 the non-disableable system post names the act, the team and the deal (§10.3)');
select is(
  (select format('%s|%s|%s', r ->> 'acted_as_commissioner', r ->> 'notified_user_ids', (select status from trades where id = pg_temp.tid('F1')))
   from r96 where tag = 'F2'),
  'true|["99600000-0000-4000-8000-000000000006"]|in_review',
  'F7 the commissioner''s accept for the OPEN seat: accepted (in review — §13.3), and TR Delta''s manager is told');
select is(
  (select string_agg(n.type, ',' order by n.type) from notifications n where n.user_id = '99600000-0000-4000-8000-000000000006' and n.type like 'league_trade%'),
  'league_trade_accepted,league_trade_commissioner',
  'F8 TR Delta''s manager: told the commissioner proposed for his team, and that it was accepted');
select is(
  (select format('%s|%s|%s', t.status, t.status_reason, t.resolved_by) from trades t where t.id = pg_temp.tid('E15')),
  'cancelled|cancelled by TR Bravo|99600000-0000-4000-8000-000000000002',
  'F9 the CO-commissioner cancels for the proposer: cancelled, recorded as him');
select is(
  (select count(*)::int from notifications where user_id = '99600000-0000-4000-8000-000000000004' and type = 'league_trade_commissioner'),
  1,
  'F10 …and TR Bravo''s manager is told the commissioner acted for his team');

-- ---------------------------------------------------------------------------
-- G. E37 — a trade in flight goes invalid the moment one of its players
--    leaves the team it takes him from; every roster writer; both told.
--    In flight now: P3 (accepted; a1 a2 ↔ b1, TR Bravo drops b3), F1
--    (accepted; d1 ↔ o1). New for this section: G0a (a3 ↔ b2, proposed),
--    G0b (e1 ↔ d1, proposed by TR Echo).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
insert into r96 select 'G0a', public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004',
  '[{"player_id": "tr-a3", "from_team_id": "c9600000-0000-4000-8000-000000000003"}, {"player_id": "tr-b2", "from_team_id": "c9600000-0000-4000-8000-000000000004"}]', null, null, 'a9600000-0000-4000-8000-000000000401');
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000007", "role": "authenticated"}', true);
insert into r96 select 'G0b', public.trade_propose('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000008', 'c9600000-0000-4000-8000-000000000007',
  '[{"player_id": "tr-e1", "from_team_id": "c9600000-0000-4000-8000-000000000008"}, {"player_id": "tr-d1", "from_team_id": "c9600000-0000-4000-8000-000000000007"}]', null, null, 'a9600000-0000-4000-8000-000000000402');
-- G1: the commissioner force-DROPS b3 from TR Bravo through the real verb
-- (127 — a DELETE on league_rosters; the manager's own drop racing an accept
-- is the stack suite's, trades-db.test.ts) — b3 is one of P3's drops
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_force_add_drop('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000004', null, 'tr-b3', 'roster cleanup', 'a9600000-0000-4000-8000-000000000403') $$,
  'G1 PREMISE: TR B Three is dropped from TR Bravo through commish_force_add_drop (a real roster writer, 127)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s|%s', t.status, t.status_reason, t.resolved_at is not null) from trades t where t.id = pg_temp.tid('P3')),
  'invalid|TR B Three (tr-b3) is no longer on TR Bravo''s roster — he was dropped (E37)|t',
  'G2 E37 (drops arm): the ACCEPTED trade that listed b3 as a drop goes invalid in the same transaction, with the reason');
select is(
  (select format('%s|%s|%s', (select status from trades where id = pg_temp.tid('G0a')), (select status from trades where id = pg_temp.tid('F1')),
                 (select status from trades where id = pg_temp.tid('G0b')))),
  'proposed|in_review|proposed',
  'G3 …and ONLY that one: trades not naming b3 are untouched');
select is(
  (select string_agg(n.user_id::text, ',' order by n.user_id) from notifications n
   where n.type = 'league_trade_invalid' and (n.data ->> 'trade_id')::uuid = pg_temp.tid('P3')),
  '99600000-0000-4000-8000-000000000003,99600000-0000-4000-8000-000000000004',
  'G4 BOTH managers are told (E37: never fails silently)');
-- G5: the commissioner MOVES a3 from TR Alpha to TR Commish (127, UPDATE OF team_id)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_move_player('b9600000-0000-4000-8000-000000000001', 'tr-a3', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000001', null, 'a9600000-0000-4000-8000-000000000404') $$,
  'G5 PREMISE: the commissioner moves TR A Three to his own team through commish_move_player (127)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s', t.status, t.status_reason) from trades t where t.id = pg_temp.tid('G0a')),
  'invalid|TR A Three (tr-a3) is no longer on TR Alpha''s roster — he moved to TR Commish (E37)',
  'G6 E37 (legs arm, UPDATE OF team_id): the proposal offering a3 from TR Alpha goes invalid, naming where he went');
select is(
  (select format('%s|%s', t.status, t.status_reason) from trades t where t.id = pg_temp.tid('P4')),
  'rejected|countered by TR Bravo',
  'G7 a RESOLVED trade that named a3 keeps its own status and reason');
-- G8: the executor exemption — F1 is "executing" (L.D3.3 sets the GUC); d1 moves
select set_config('app.executing_trade_id', pg_temp.tid('F1')::text, true);
update league_rosters set team_id = 'c9600000-0000-4000-8000-000000000005' where league_id = 'b9600000-0000-4000-8000-000000000001' and player_id = 'tr-d1';
select set_config('app.executing_trade_id', '', true);
select is(
  (select format('%s|%s', (select status from trades where id = pg_temp.tid('F1')), (select status from trades where id = pg_temp.tid('G0b')))),
  'in_review|invalid',
  'G8 the EXECUTING trade (app.executing_trade_id) is exempt from its own moves; another trade naming d1 from TR Delta still goes invalid');
-- G9: an UPDATE that keeps the team (a slot change) invalidates nothing
create temp table g9_before as select id, status from trades;
update league_rosters set slot_key = 'qb:0' where league_id = 'b9600000-0000-4000-8000-000000000001' and player_id in ('tr-o1', 'tr-e1', 'tr-b1');
select set_eq($$ select id, status from trades $$, $$ select id, status from g9_before $$,
  'G9 a roster UPDATE that leaves team_id alone (a slot change) touches NO trade');
select is(
  (select string_agg(status, ',' order by status) from trades where league_id = 'b9600000-0000-4000-8000-000000000001'),
  'cancelled,cancelled,in_review,invalid,invalid,invalid,rejected,rejected',
  'G10 the ledger of outcomes: three invalid (one per E37 event), one still in review, the manual closures untouched');

-- ---------------------------------------------------------------------------
-- H. PER ROLE — who reads a trade; nobody writes one directly
--    (state: eight trades in L1)
-- ---------------------------------------------------------------------------
create temp table t96_before as select * from trades;
create temp table i96_before as select * from trade_items;
create temp table d96_before as select * from trade_drops;
-- The client walks below read these snapshots; granted so a 42501 can only
-- ever come from the table under test, never from the snapshot.
grant select on t96_before, i96_before, d96_before to authenticated;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from trades) + (select count(*)::int from trade_items) + (select count(*)::int from trade_drops), 0, 'H1 ANON reads ZERO trades, legs or drops');
select throws_ok($$ insert into trades (league_id, proposer_team_id, recipient_team_id, proposed_by, action_id) values ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004', '99600000-0000-4000-8000-000000000003', gen_random_uuid()) $$,
  '42501', null, 'H1b ANON cannot INSERT (42501)');
select results_eq($$ with u as (update trades set status = 'complete' returning 1) select count(*)::int from u $$, $$ values (0) $$, 'H1c ANON UPDATE touches 0 rows');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is((select count(*)::int from trades) + (select count(*)::int from trade_items) + (select count(*)::int from trade_drops), 0, 'H2 a NON-member reads ZERO trades, legs or drops');
select throws_ok($$ insert into trade_items (trade_id, from_team_id, to_team_id, player_id) select id, proposer_team_id, recipient_team_id, 'tr-f1' from t96_before limit 1 $$,
  '42501', null, 'H2b …cannot INSERT a leg (42501)');
-- a NON-PARTY member (TR Foxtrot, u8: a party to no trade at all)
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000008", "role": "authenticated"}', true);
select is(
  (select format('%s|%s|%s', (select count(*) from trades), (select count(*) from trade_items), (select count(*) from trade_drops))),
  (select format('%s|%s|%s', (select count(*) from t96_before where league_id = 'b9600000-0000-4000-8000-000000000001'),
                 (select count(*) from i96_before), (select count(*) from d96_before))),
  'H3 a league MEMBER reads EVERY trade of his league, its legs and its drops (spec 12.11 — a trade is not blind)');
select results_eq($$ with u as (update trades set status = 'complete' returning 1) select count(*)::int from u $$, $$ values (0) $$, 'H3b …UPDATE touches 0 rows');
select results_eq($$ with d as (delete from trade_drops returning 1) select count(*)::int from d $$, $$ values (0) $$, 'H3c …DELETE of drops touches 0 rows');
select throws_ok($$ insert into trade_drops (trade_id, team_id, player_id) select id, recipient_team_id, 'tr-e1' from t96_before limit 1 $$,
  '42501', null, 'H3d …cannot INSERT a drop (42501)');
-- a PARTY (TR Alpha)
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select results_eq($$ with u as (update trades set status = 'accepted' where proposer_team_id = 'c9600000-0000-4000-8000-000000000003' returning 1) select count(*)::int from u $$, $$ values (0) $$,
  'H4 a PARTY cannot UPDATE his own trade directly (0 rows — the verb is the only door)');
select results_eq($$ with d as (delete from trades returning 1) select count(*)::int from d $$, $$ values (0) $$, 'H4b …DELETE touches 0 rows');
select results_eq($$ with u as (update trade_items set faab_amount = 1 returning 1) select count(*)::int from u $$, $$ values (0) $$, 'H4c …UPDATE of legs touches 0 rows');
select is((select count(*)::int from trade_actions), 0, 'H4d …and reads ZERO ledger rows (zero policies)');
select throws_ok($$ insert into trade_actions (league_id, team_id, verb, action_id, actor_id, result) values ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'trade_propose', gen_random_uuid(), '99600000-0000-4000-8000-000000000003', '{}') $$,
  '42501', null, 'H4e …and cannot PRE-PLANT a ledger row (a forged replay)');
-- the COMMISSIONER
select set_config('request.jwt.claims', '{"sub": "99600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from trades where league_id = 'b9600000-0000-4000-8000-000000000001'), 8, 'H5 the COMMISSIONER reads all eight trades');
select throws_ok($$ insert into trades (league_id, proposer_team_id, recipient_team_id, proposed_by, action_id) values ('b9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004', '99600000-0000-4000-8000-000000000001', gen_random_uuid()) $$,
  '42501', null, 'H5b …but cannot INSERT directly (42501) — the audited verb is the only door');
select results_eq($$ with u as (update trades set status = 'vetoed' returning 1) select count(*)::int from u $$, $$ values (0) $$, 'H5c …UPDATE touches 0 rows (a veto is a verb, L.D3.5)');
select is((select count(*)::int from trade_actions), 0, 'H5d …and reads ZERO ledger rows');
reset role;
select set_config('request.jwt.claims', '', true);
select set_eq($$ select * from trades $$, $$ select * from t96_before $$, 'H6 trades are BYTE-IDENTICAL after every client walk');
select set_eq($$ select * from trade_items $$, $$ select * from i96_before $$, 'H7 …and so are the legs');
select set_eq($$ select * from trade_drops $$, $$ select * from d96_before $$, 'H8 …and the drops');

-- ---------------------------------------------------------------------------
-- I. Broadcast (D38) — member topic, column-selected
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(m.payload #>> '{record,status}', ',' order by m.inserted_at, m.cmin::text::bigint)
   from realtime.messages m
   where m.topic = 'league:b9600000-0000-4000-8000-000000000001' and m.event = 'trades'
     and m.inserted_at >= now() and (m.payload #>> '{record,id}')::uuid = pg_temp.tid('P3')),
  'proposed,in_review,invalid',
  'I1 P3''s life on league:<id> (event trades): one event per status — proposed, in_review, invalid');
select ok(
  (select bool_and(m.private and not (m.payload -> 'record' ? 'action_id') and not (m.payload -> 'record' ? 'proposed_by') and not (m.payload -> 'record' ? 'note'))
   from realtime.messages m
   where m.topic = 'league:b9600000-0000-4000-8000-000000000001' and m.event = 'trades' and m.inserted_at >= now()),
  'I2 every trades event is PRIVATE (member-authorized topic) and carries no action_id, proposed_by or note');

-- ---------------------------------------------------------------------------
-- J. The view helpers read what they say
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_array_length(public.trade_view_internal(pg_temp.tid('P3')) -> 'items')),
  3,
  'J1 trade_view_internal lists every leg');
select is(
  public.trade_summary_internal(pg_temp.tid('F1')),
  'TR Delta gives TR D One; TR Open gives TR O One',
  'J2 trade_summary_internal names each side in order (proposer first)');

select * from finish();
rollback;
