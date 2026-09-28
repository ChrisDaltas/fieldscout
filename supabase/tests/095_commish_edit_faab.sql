-- ============================================================================
-- commish_edit_faab + the draft reset FAAB re-seed — pgTAP 095
-- (M5 task L.D2.11, FULL rigour — money + permissions; migration 147;
-- spec §10.1 / §15.4 / §12.12 / §10.3 / §12.2 v2.8.7; PROGRESS D336, D350,
-- D352 / F340, F412, D385).
--
-- Numbering: pgTAP head measured 094 at task time (ls supabase/tests |
-- tail -1) ⇒ 095. OWN FIXTURE: users 95…, leagues b95…, teams c95…,
-- seats d95…, drafts e95…, action ids a95….
--
-- Falsifiability (tasks-M1 §4.3):
--   * PER ROLE (§C): anon, a commissioner of ANOTHER league, the manager of
--     the very team, another manager, a league that does not exist — each
--     refused, the four signed-in ones with the ONE no-leak 42501 text; and
--     §C6 proves nothing at all was written by them (balances as one stored
--     literal, audit / chat / notification / ledger counts 0).
--   * MONEY AS STORED LITERALS: every balance of league 1 after each act is
--     one string (B1, C6, D8, F2, G2); the boundary is $0 (E1 lands on 0,
--     G1 refuses −1); above the budget is allowed (D2 lands on 250 > 100).
--   * THE NO-OP (§F): audit, chat, notification counts unchanged as a
--     literal; the ledger count moves (an action_id is consumed by a no-op).
--   * REPLAY (§H): byte-identical to the stored first answer, even with
--     different arguments (the requested_balance echo is the F65(b) guard's
--     input), and nothing re-written.
--   * F412 (§L): a budget changed mid-draft (144 leaves balances alone —
--     premise L1) is followed by a reset; every seat reads the new budget
--     (L3), and a reset with nothing to re-seed reports 0 (L5 control).
--   * BREAK PROBES shown red in the PR, then reverted: auth widened to
--     is_league_member (C3 / C4 red); the in-body negative gate removed (G1
--     red — 23514 from 145's CHECK instead of the by-name 22023: the CHECK is
--     the backstop); the no-op guard removed (F1 / F2 red); the draft_reset
--     re-seed removed (L2 / L3 red).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(50);

-- ---------------------------------------------------------------------------
-- A. Posture
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_edit_faab', 'commish_edit_faab_internal')),
  2,
  'A1 exactly two functions named commish_edit_faab[_internal] — one overload each');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and has_function_privilege('authenticated', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'public.commish_edit_faab(uuid,uuid,integer,text,uuid)'::regprocedure),
  'A2 the door: SECURITY DEFINER, search_path empty, anon no EXECUTE, authenticated EXECUTE (the in-body gate authorizes)');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'public.commish_edit_faab_internal(uuid,uuid,integer,uuid,timestamptz,text)'::regprocedure),
  'A3 the internal: PLAIN, search_path empty, REVOKEd from anon and authenticated');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.commish_faab_actions'::regclass)
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'commish_faab_actions') = 0,
  'A4 the replay ledger: RLS on, ZERO policies (D350 — the verb is its only reader and writer)');
select ok(
  not has_table_privilege('anon', 'public.commish_faab_actions', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.commish_faab_actions', 'TRUNCATE'),
  'A5 the replay ledger has no TRUNCATE for anon or authenticated');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and has_function_privilege('authenticated', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'public.draft_reset(uuid,text)'::regprocedure)
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'draft_reset') = 1,
  'A6 draft_reset keeps its one signature and its posture after the replace');
select ok(
  (select p.prosrc ~ 'SET faab_balance = l\.faab_budget'
          and p.prosrc ~ 'faab_reseeded_seats'
   from pg_proc p where p.oid = 'public.draft_reset(uuid,text)'::regprocedure),
  'A7 draft_reset carries the F412 re-seed and reports it');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context).
--   u1 commissioner (L1, L2, L3, L5) · u2 co-commissioner of L1 · u3 the
--   target manager · u4 another manager · u5 commissioner of ANOTHER league
--   (L4) and nothing in L1.
--   L1 in_season, budget 100: K1 commish 100 · K2 co 100 · K3 target 40
--   (spent 60) · K4 other 100 · K5 open seat (no manager) 70 · K6 retired
--   (its seat went to K5) · K7 no seat row at all.
--   L2 scheduled · L3 drafting (live draft) · L4 in_season (u5's) ·
--   L5 drafting (live draft, the F412 control).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('95000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-fe' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'fe_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;

insert into leagues (id, owner_id, name, season, status, faab_budget, scoring_system_id, scoring_rules_snapshot)
select ('b9500000-0000-4000-8000-00000000000' || s.n)::uuid,
       ('95000000-0000-4000-8000-0000000000' || lpad(s.owner::text, 2, '0'))::uuid,
       'pgtap-fe-L' || s.n, 2026, s.status, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard')
from (values (1, 'in_season', 1), (2, 'scheduled', 1), (3, 'drafting', 1), (4, 'in_season', 5), (5, 'drafting', 1)) s(n, status, owner);

create temp table _fx (n int, k int, label text, uid int, role text, bal int, seat boolean);
insert into _fx values
 (1,1,'Commish',1,'commissioner',100,true), (1,2,'Co',2,'co_commissioner',100,true),
 (1,3,'Target',3,'manager',40,true), (1,4,'Other',4,'manager',100,true),
 (1,5,'Open',null,'manager',70,true), (1,6,'Retired',null,null,null,false), (1,7,'Bare',null,null,null,false),
 (2,1,'Commish',1,'commissioner',100,true), (2,2,'Target',3,'manager',100,true),
 (3,1,'Commish',1,'commissioner',100,true), (3,2,'Target',3,'manager',100,true), (3,3,'Open',null,'manager',100,true),
 (4,1,'Commish',5,'commissioner',100,true),
 (5,1,'Commish',1,'commissioner',100,true), (5,2,'Other',4,'manager',100,true);

insert into teams (id, owner_id, name, league_id)
select ('c9500000-0000-4000-8000-0000000000' || f.n || f.k)::uuid,
       '95000000-0000-4000-8000-000000000001',
       'FE' || f.n || ' ' || f.label,
       ('b9500000-0000-4000-8000-00000000000' || f.n)::uuid
from _fx f;
update teams set status = 'retired', retired_at_week = 2,
                 successor_team_id = 'c9500000-0000-4000-8000-000000000015'
where id = 'c9500000-0000-4000-8000-000000000016';
insert into league_members (id, league_id, user_id, team_id, role, is_placeholder, faab_balance)
select ('d9500000-0000-4000-8000-0000000000' || f.n || f.k)::uuid,
       ('b9500000-0000-4000-8000-00000000000' || f.n)::uuid,
       case when f.uid is null then null else ('95000000-0000-4000-8000-0000000000' || lpad(f.uid::text, 2, '0'))::uuid end,
       ('c9500000-0000-4000-8000-0000000000' || f.n || f.k)::uuid,
       f.role, f.uid is null, f.bal
from _fx f where f.seat;

insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, total_rounds, current_round, current_pick_number) values
  ('e9500000-0000-4000-8000-000000000003', 'b9500000-0000-4000-8000-000000000003',
   'snake', 'live', false, '{"pick_timer_seconds": 0}',
   to_jsonb(array['c9500000-0000-4000-8000-000000000031', 'c9500000-0000-4000-8000-000000000032',
                  'c9500000-0000-4000-8000-000000000033']), 1, 1, 1),
  ('e9500000-0000-4000-8000-000000000005', 'b9500000-0000-4000-8000-000000000005',
   'snake', 'live', false, '{"pick_timer_seconds": 0}',
   to_jsonb(array['c9500000-0000-4000-8000-000000000051', 'c9500000-0000-4000-8000-000000000052']), 1, 1, 1);

-- L1's seats as ONE string, in seat order: label=balance.
create or replace function pg_temp.l1_money() returns text language sql as $$
  select string_agg(split_part(t.name, ' ', 2) || '=' || coalesce(m.faab_balance::text, 'null'), ',' order by t.name)
  from public.league_members m join public.teams t on t.id = m.team_id
  where m.league_id = 'b9500000-0000-4000-8000-000000000001';
$$;
create or replace function pg_temp.l1_counts() returns text language sql as $$
  select (select count(*) from public.commissioner_actions where league_id = 'b9500000-0000-4000-8000-000000000001')
    || '|' || (select count(*) from public.league_chat where league_id = 'b9500000-0000-4000-8000-000000000001' and is_system)
    || '|' || (select count(*) from public.notifications where type = 'league_faab_commissioner')
    || '|' || (select count(*) from public.commish_faab_actions where league_id = 'b9500000-0000-4000-8000-000000000001');
$$;

select is(pg_temp.l1_money(), 'Co=100,Commish=100,Open=70,Other=100,Target=40',
  'B1 premise: league 1''s five seats and their balances (Target spent 60 of 100; Retired and Bare have NO seat row)');

-- ---------------------------------------------------------------------------
-- C. Refusals per role — nobody but a commissioner of THIS league
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 999, null, 'a9500000-0000-4000-8000-000000000001') $$,
  '42501', null, 'C1 ANON cannot even execute the door (EXECUTE revoked)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 999, null, 'a9500000-0000-4000-8000-000000000002') $$,
  '42501', 'commish_edit_faab: not a commissioner of this league',
  'C2 a commissioner of ANOTHER league (not a member here) gets the one no-leak 42501');
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 999, null, 'a9500000-0000-4000-8000-000000000003') $$,
  '42501', 'commish_edit_faab: not a commissioner of this league',
  'C3 the MANAGER of the very team cannot set his own balance — same 42501');
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 999, null, 'a9500000-0000-4000-8000-000000000004') $$,
  '42501', 'commish_edit_faab: not a commissioner of this league',
  'C4 another manager of the league — same 42501');
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-0000000000ff', 'c9500000-0000-4000-8000-000000000013', 999, null, 'a9500000-0000-4000-8000-000000000005') $$,
  '42501', 'commish_edit_faab: not a commissioner of this league',
  'C5 a league that does not exist answers the same 42501 (no existence leak)');
reset role;
select is(pg_temp.l1_money() || ' / ' || pg_temp.l1_counts(),
  'Co=100,Commish=100,Open=70,Other=100,Target=40 / 0|0|0|0',
  'C6 the five refusals wrote NOTHING: every balance, and no audit row, post, notification or ledger row');

-- ---------------------------------------------------------------------------
-- D. The commissioner sets Target 40 → 250 (above the budget), no reason
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('fe.d',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 250, null,
                           'a9500000-0000-4000-8000-000000000010')::text, true);
reset role;

select is(
  (select concat_ws('|', d->>'verb', d->>'action_type', d->>'team_id', d->>'faab_balance', d->>'previous_balance',
                    d->>'requested_balance', d->>'delta', d->>'faab_budget', d->>'no_changes', d->>'reseed_can_overwrite',
                    d->>'pending_bids_above_balance', d->>'bypassed', coalesce(d->>'reason', 'NULL'))
   from (select current_setting('fe.d')::jsonb d) x),
  'commish_edit_faab|edit_faab|c9500000-0000-4000-8000-000000000013|250|40|250|210|100|false|false|0|[]|NULL',
  'D1 the result: 40 → 250, the echo (verb / action_type / team / requested) for the F65(b) guard, no re-seed in season, no reason');
select is(pg_temp.l1_money(), 'Co=100,Commish=100,Open=70,Other=100,Target=250',
  'D2 Target now holds $250 — ABOVE the $100 budget (a repair tool) — and no other seat moved');
select is(
  (select concat_ws('|', c.action_type, c.target_type, c.target_id, c.before::text, c.after::text, c.actor_id::text,
                    coalesce(c.reason, 'NULL'), coalesce(c.acting_as_team_id::text, 'NULL'), c.metadata->>'verb', c.metadata->>'team_name')
   from commissioner_actions c where c.league_id = 'b9500000-0000-4000-8000-000000000001'),
  'edit_faab|team|c9500000-0000-4000-8000-000000000013|{"faab_balance": 40}|{"faab_balance": 250}|95000000-0000-4000-8000-000000000001|NULL|NULL|commish_edit_faab|FE1 Target',
  'D3 EXACTLY ONE audit row: edit_faab on the team, {faab_balance} before / after, the actor, reason absent');
select is(
  (select c.id::text from commissioner_actions c where c.league_id = 'b9500000-0000-4000-8000-000000000001'),
  current_setting('fe.d')::jsonb->>'commissioner_action_id',
  'D4 the result names that audit row');
select is(
  (select string_agg(message, ' / ') from league_chat
   where league_id = 'b9500000-0000-4000-8000-000000000001' and is_system and context = 'league'),
  'FE1 Target''s FAAB balance is now $250 (was $40) — set by fe_user1 (commissioner override)',
  'D5 ONE non-disableable system post (§10.3), amounts shown, no reason clause');
select is(
  (select string_agg(concat_ws('|', n.user_id::text, n.title, n.body, n.data->>'faab_before', n.data->>'faab_after',
                               (n.data->>'commissioner_action_id' = current_setting('fe.d')::jsonb->>'commissioner_action_id')::text), ' / ')
   from notifications n where n.type = 'league_faab_commissioner'),
  '95000000-0000-4000-8000-000000000003|The commissioner changed your FAAB balance|FE1 Target: $250 (was $40)|40|250|true',
  'D6 the team''s manager — and only he — is notified (TD16)');
select is(
  (select a.result::text from commish_faab_actions a where a.action_id = 'a9500000-0000-4000-8000-000000000010'),
  current_setting('fe.d'),
  'D7 the ledger row holds the returned document');
select is(pg_temp.l1_counts(), '1|1|1|1', 'D8 counts: one audit row, one post, one notification, one ledger row');

-- ---------------------------------------------------------------------------
-- E. A CO-commissioner sets Target 250 → 0 (the floor), with a padded reason
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select set_config('fe.e',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 0,
                           E'  wrong bid refunded twice \n', 'a9500000-0000-4000-8000-000000000011')::text, true);
reset role;
select is(
  (select concat_ws('|', d->>'faab_balance', d->>'previous_balance', d->>'delta', d->>'reason', d->>'notified_user_id')
   from (select current_setting('fe.e')::jsonb d) x) || ' / ' || pg_temp.l1_money(),
  '0|250|-250|wrong bid refunded twice|95000000-0000-4000-8000-000000000003 / Co=100,Commish=100,Open=70,Other=100,Target=0',
  'E1 a co-commissioner may edit: 250 → 0 lands on exactly $0; the reason is trimmed');
select is(
  (select concat_ws('|', c.actor_id::text, c.reason, c.before::text, c.after::text)
   from commissioner_actions c
   where c.id = (current_setting('fe.e')::jsonb->>'commissioner_action_id')::uuid),
  '95000000-0000-4000-8000-000000000002|wrong bid refunded twice|{"faab_balance": 250}|{"faab_balance": 0}',
  'E2 the audit row names the CO-commissioner and carries the reason');
select is(
  (select message from league_chat
   where league_id = 'b9500000-0000-4000-8000-000000000001' and is_system
     and message = current_setting('fe.e')::jsonb->>'system_post'),
  'FE1 Target''s FAAB balance is now $0 (was $250) — set by fe_user2 (commissioner override) — reason: wrong bid refunded twice',
  'E3 the post carries the reason clause when one is given');

-- ---------------------------------------------------------------------------
-- F. The no-op — Target is already at $0
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('fe.f',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 0, 'again',
                           'a9500000-0000-4000-8000-000000000012')::text, true);
reset role;
select is(
  (select concat_ws('|', d->>'no_changes', coalesce(d->>'commissioner_action_id', 'NULL'), coalesce(d->>'system_post', 'NULL'),
                    coalesce(d->>'notified_user_id', 'NULL'), d->>'faab_balance', split_part(d->>'no_changes_why', ' ', 1))
   from (select current_setting('fe.f')::jsonb d) x),
  'true|NULL|NULL|NULL|0|balance_already_set',
  'F1 same value ⇒ no_changes, and NO receipt: no audit id, no post, nobody notified');
select is(pg_temp.l1_counts(), '2|2|2|3',
  'F2 audit / post / notification counts UNCHANGED (2|2|2) — only the ledger moved (a no-op consumes its action_id)');

-- ---------------------------------------------------------------------------
-- G. Negative money — refused by name, and by 145's CHECK behind it
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', -1, null, 'a9500000-0000-4000-8000-000000000013') $$,
  '22023', 'commish_edit_faab: a FAAB balance cannot be negative (asked for $-1) — the lowest a team can hold is $0 (TD2; CHECK league_members_faab_balance_nonneg)',
  'G1 −1 is refused BY NAME — validity binds the commissioner too');
reset role;
select is(pg_temp.l1_money() || ' / ' || pg_temp.l1_counts(),
  'Co=100,Commish=100,Open=70,Other=100,Target=0 / 2|2|2|3',
  'G2 …and nothing moved');
select throws_ok(
  $$ update league_members set faab_balance = -1 where id = 'd9500000-0000-4000-8000-000000000013' $$,
  '23514', null,
  'G3 the table OWNER cannot store −1 either (145''s CHECK — the backstop for every path)');

-- ---------------------------------------------------------------------------
-- H. Replay — byte-identical, even with different arguments, nothing re-written
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('fe.h1',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 250, null,
                           'a9500000-0000-4000-8000-000000000010')::text, true);
select set_config('fe.h2',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000014', 999, 'x',
                           'a9500000-0000-4000-8000-000000000010')::text, true);
reset role;
select is(current_setting('fe.h1'), current_setting('fe.d'),
  'H1 a retry of D''s action_id returns D''s document BYTE-IDENTICALLY (the balance has moved on since)');
select is(current_setting('fe.h2'), current_setting('fe.d'),
  'H2 the same action_id with DIFFERENT arguments still returns the stored document…');
select is(
  (current_setting('fe.h2')::jsonb->>'requested_balance') || '|' || (current_setting('fe.h2')::jsonb->>'team_id'),
  '250|c9500000-0000-4000-8000-000000000013',
  'H3 …whose echo (requested_balance / team_id) differs from what was sent — the F65(b) route guard''s input');
select is(pg_temp.l1_money() || ' / ' || pg_temp.l1_counts(),
  'Co=100,Commish=100,Open=70,Other=100,Target=0 / 2|2|2|3',
  'H4 the replays wrote nothing: no balance, no receipt, no ledger row');

-- ---------------------------------------------------------------------------
-- I. The reason's bounds
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000014', 90, %L, 'a9500000-0000-4000-8000-000000000020') $$, repeat('r', 501)),
  '22023', 'commish_edit_faab: the reason is 501 characters — at most 500 (the league_chat bound; §12.13)',
  'I1 a 501-character reason is refused by name');
select set_config('fe.i',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000014', 90, E' \t\n ',
                           'a9500000-0000-4000-8000-000000000021')::text, true);
reset role;
select is(
  (select coalesce(c.reason, 'NULL') || ' / ' || (current_setting('fe.i')::jsonb->>'system_post')
   from commissioner_actions c where c.id = (current_setting('fe.i')::jsonb->>'commissioner_action_id')::uuid),
  'NULL / FE1 Other''s FAAB balance is now $90 (was $100) — set by fe_user1 (commissioner override)',
  'I2 a whitespace-only reason (tabs, newlines) is stored as NO reason, and the post has no reason clause');

-- ---------------------------------------------------------------------------
-- J. Shape and subject
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', null, 5, null, 'a9500000-0000-4000-8000-000000000030') $$,
  '22023', 'commish_edit_faab: p_team_id is required — an edit that names no team is not an edit', 'J1 no team → 22023 by name');
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', null, null, 'a9500000-0000-4000-8000-000000000031') $$,
  '22023', 'commish_edit_faab: p_balance is required — the whole-dollar FAAB balance the team should have (0 or more)', 'J2 no balance → 22023 by name');
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000013', 5) $$,
  '22023', 'commish_edit_faab: p_action_id is required (idempotency key — one UUID per submit, reused on retry)', 'J3 no action_id → 22023 by name');
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000021', 5, null, 'a9500000-0000-4000-8000-000000000032') $$,
  'P0001', 'commish_edit_faab: team c9500000-0000-4000-8000-000000000021 is not a franchise of league b9500000-0000-4000-8000-000000000001',
  'J4 a team of ANOTHER league is refused by name');
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000016', 5, null, 'a9500000-0000-4000-8000-000000000033') $$,
  'P0001', 'commish_edit_faab: franchise c9500000-0000-4000-8000-000000000016 is RETIRED — its seat, and the FAAB balance with it, carried to its successor (c9500000-0000-4000-8000-000000000015) (§7.2.1(b)); edit that team''s balance instead',
  'J5 a RETIRED franchise is refused by name, naming its successor');
select throws_ok(
  $$ select public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000017', 5, null, 'a9500000-0000-4000-8000-000000000034') $$,
  'P0001', 'commish_edit_faab: team c9500000-0000-4000-8000-000000000017 has no seat in league b9500000-0000-4000-8000-000000000001 — a FAAB balance lives on the team''s seat (league_members), and this team has none, so there is no balance to edit',
  'J6 a franchise with NO seat row is refused by name — no balance is minted');
select set_config('fe.j7',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000015', 75, null,
                           'a9500000-0000-4000-8000-000000000035')::text, true);
select set_config('fe.j8',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000001', 'c9500000-0000-4000-8000-000000000011', 120, null,
                           'a9500000-0000-4000-8000-000000000036')::text, true);
reset role;
select is(
  coalesce(current_setting('fe.j7')::jsonb->>'notified_user_id', 'NULL') || '|'
    || coalesce(current_setting('fe.j8')::jsonb->>'notified_user_id', 'NULL') || '|'
    || ((current_setting('fe.j8')::jsonb->>'commissioner_action_id') is not null)::text
    || ' / ' || pg_temp.l1_money() || ' / ' || pg_temp.l1_counts(),
  'NULL|NULL|true / Co=100,Commish=120,Open=75,Other=90,Target=0 / 5|5|3|6',
  'J7 an open seat (no manager) and the commissioner''s own team are edited and audited, but nobody is notified (no manager; never the actor)');

-- ---------------------------------------------------------------------------
-- K. Before the draft: allowed, and the result says a re-seed can overwrite it
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('fe.k',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000002', 'c9500000-0000-4000-8000-000000000022', 130, null,
                           'a9500000-0000-4000-8000-000000000040')::text, true);
reset role;
select is(
  (select concat_ws('|', d->>'faab_balance', d->>'league_status', d->>'reseed_can_overwrite', d->>'reseed_why')
   from (select current_setting('fe.k')::jsonb d) x)
    || ' / ' || (select faab_balance::text from league_members where id = 'd9500000-0000-4000-8000-000000000022'),
  '130|scheduled|true|league is scheduled — before the draft starts balances track the budget (§12.2 v2.8.7): a faab_budget change re-seeds every seat, and filling this seat re-seeds it (146) / 130',
  'K1 a scheduled league: the edit lands (no timing refusal) and the result names what can re-seed it');

-- ---------------------------------------------------------------------------
-- L. F412 — a budget changed mid-draft, then a draft reset
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.commish_change_setting('b9500000-0000-4000-8000-000000000003', 'faab_budget', '200'::jsonb, false, null,
                                     'a9500000-0000-4000-8000-000000000050');
select set_config('fe.l0',
  public.commish_edit_faab('b9500000-0000-4000-8000-000000000003', 'c9500000-0000-4000-8000-000000000032', 55, null,
                           'a9500000-0000-4000-8000-000000000051')::text, true);
reset role;
select is(
  (select l.status || '|' || l.faab_budget || ' / ' || string_agg(m.faab_balance::text, ',' order by m.id)
   from leagues l join league_members m on m.league_id = l.id
   where l.id = 'b9500000-0000-4000-8000-000000000003' group by l.status, l.faab_budget)
    || ' / ' || (current_setting('fe.l0')::jsonb->>'reseed_why'),
  'drafting|200 / 100,55,100 / league is drafting — a draft reset returns the league to scheduled and re-seeds every seat to the budget (147, F412)',
  'L1 premise: mid-draft the budget moved to 200 and balances did NOT follow (144); one seat was edited to 55');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('fe.l2', public.draft_reset('e9500000-0000-4000-8000-000000000003')::text, true);
select set_config('fe.l5', public.draft_reset('e9500000-0000-4000-8000-000000000005')::text, true);
reset role;
select is(
  (current_setting('fe.l2')::jsonb->>'reset') || '|' || (current_setting('fe.l2')::jsonb->>'faab_reseeded_seats'),
  'true|3',
  'L2 the reset reports THREE seats re-seeded');
select is(
  (select l.status || '|' || l.faab_budget || ' / ' || string_agg(m.faab_balance::text, ',' order by m.id)
   from leagues l join league_members m on m.league_id = l.id
   where l.id = 'b9500000-0000-4000-8000-000000000003' group by l.status, l.faab_budget),
  'scheduled|200 / 200,200,200',
  'L3 F412: back at scheduled, EVERY seat starts from the same $200 — no uneven starting FAAB');
select is(
  (select string_agg(message, ' / ') from league_chat
   where league_id = 'b9500000-0000-4000-8000-000000000003' and is_system and context like 'draft:%'),
  'Draft reset by fe_user1 — 0 picks cleared; the draft is back to scheduled. Re-schedule it in Draft setup or start it manually when ready.',
  'L4 the reset''s own chat post is byte-identical to 100''s');
select is(
  (current_setting('fe.l5')::jsonb->>'faab_reseeded_seats')
    || ' / ' || (select string_agg(m.faab_balance::text, ',' order by m.id) from league_members m
                 where m.league_id = 'b9500000-0000-4000-8000-000000000005'),
  '0 / 100,100',
  'L5 control: a reset where every seat already matches the budget re-seeds nothing and says 0');
select is(pg_temp.l1_money(), 'Co=100,Commish=120,Open=75,Other=90,Target=0',
  'L6 another league''s balances are untouched by both resets');

select * from finish();
rollback;
