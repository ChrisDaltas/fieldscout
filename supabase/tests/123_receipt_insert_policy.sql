-- ============================================================================
-- 123 — a commissioner receipt is written ONLY by the server verbs: no client
--       INSERT route into the audit log (migration 175; M6 follow-up F555;
--       spec §12.12 — audit-log immutability, never weakened; §10.3;
--       PROGRESS F555, D465(7), D451, C70; D23 REVOKE rule)
-- ============================================================================
-- What this file proves:
--   A. the table as 175 leaves it: EXACTLY one policy (the member SELECT,
--      its predicate as a stored literal); no client write policy of any
--      command; RLS on; the per-role grant matrix as a stored literal
--      (anon / authenticated / PUBLIC hold no INSERT; service_role keeps
--      it); the two immutability triggers still ENABLE ALWAYS; the ONE
--      function body that inserts receipts is the INVOKER seam no client
--      can EXECUTE, and every SECURITY DEFINER caller of the seams runs as
--      the table owner (which RLS does not restrain — the table is not
--      FORCE RLS), so a verb never needed the dropped policy.
--   B. a WELL-FORMED receipt (the forged-row shape R1424 measured: a
--      replace_manager naming a manager) inserted by the client is refused
--      42501 BY NAME — for the commissioner (actor_id = himself, the old
--      policy exact WITH CHECK), a co-commissioner, a manager, a
--      non-member and anon; nothing is written. service_role still plants
--      a row (it bypasses RLS; the stack suites model legacy rows so).
--   C. a REAL verb still writes its receipt: commish_rename_team (128 /
--      170) called as the commissioner client lands with EXACTLY one
--      reassign_team receipt, acting for the team (D451); a no-op rename
--      writes none.
--   D. the SELECT policy is unchanged: members read the log, a non-member
--      and anon read nothing.
--   E. immutability unchanged: UPDATE / DELETE affect 0 rows for every
--      client role (RETURNING counts, per role) and are REFUSED for the
--      owner by trg_commish_actions_immutable; the rows are untouched.
--
-- Break probes (shown in the PR, reverted): P1 re-creates 123:333-335 and
-- re-grants INSERT (175 rolled back) ⇒ A1/A2/A3/A4 and every B refusal red
-- (the commissioner and co-commissioner inserts LAND; the others are refused
-- by RLS, not by the grant — the message differs); P2 re-grants INSERT only
-- ⇒ the B message cells red while the B count cells stay green (RLS alone
-- still holds: the layers are independent).
--
-- World (fabricated inside this rolled-back transaction):
--   L b123…01 in_season — u1 commissioner (t1), u2 co_commissioner (t2),
--              u3 manager (t3); u4 holds no seat in L (a non-member).
-- Descriptions carry no bare apostrophes (house rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

-- ---------------------------------------------------------------------------
-- A. The table as 175 leaves it (catalog, stored literals)
-- ---------------------------------------------------------------------------
select policies_are('public', 'commissioner_actions',
  array['Audit log readable by all league members'],
  'A1 EXACTLY one policy on the audit log — the member SELECT (175 dropped the client INSERT policy of 123:333-335)');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.polname, p.polcmd, p.polroles::regrole[],
                            pg_get_expr(p.polqual, p.polrelid), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                     ' | ' order by p.polname)
   from pg_policy p where p.polrelid = 'public.commissioner_actions'::regclass),
  'Audit log readable by all league members:r:{-}:is_league_member(league_id):',
  'A2 THE POLICY CENSUS (stored literal): one SELECT policy for every role, predicate is_league_member(league_id), no WITH CHECK — no INSERT, UPDATE, DELETE or ALL policy exists');
select is(
  (select format('%s|%s|%s', c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner))
   from pg_class c where c.oid = 'public.commissioner_actions'::regclass),
  't|f|postgres',
  'A3 RLS is on, not forced, and the table is owned by postgres — the role every SECURITY DEFINER verb runs as (so the verbs never consult a client policy)');
select is(
  (select string_agg(format('%s:%s', r.rolname,
                            (select string_agg(case when has_table_privilege(r.rolname, 'public.commissioner_actions', p.priv)
                                                    then p.priv else lower(p.priv) end, ',' order by p.ord)
                             from (values (1, 'SELECT'), (2, 'INSERT'), (3, 'UPDATE'), (4, 'DELETE'), (5, 'TRUNCATE')) p(ord, priv))),
                     ' | ' order by r.ord)
   from (values (1, 'public'), (2, 'anon'), (3, 'authenticated'), (4, 'service_role')) r(ord, rolname)),
  'public:select,insert,update,delete,truncate | anon:SELECT,insert,UPDATE,DELETE,truncate | '
  || 'authenticated:SELECT,insert,UPDATE,DELETE,truncate | service_role:SELECT,INSERT,UPDATE,DELETE,TRUNCATE',
  'A4 THE GRANT MATRIX (stored literal; upper = held): no INSERT for PUBLIC / anon / authenticated (175, D23 explicit REVOKE); UPDATE / DELETE held but policed to 0 rows by RLS (section E); TRUNCATE revoked (123:410); service_role unchanged');
select is(
  (select string_agg(format('%s:%s', tgname, tgenabled), ' ' order by tgname)
   from pg_trigger where tgrelid = 'public.commissioner_actions'::regclass and not tgisinternal),
  'trg_commish_actions_immutable:A trg_commish_actions_no_truncate:A trg_zz_reverts_action_id_league_check:A',
  'A5 immutability backstops unchanged: both triggers ENABLE ALWAYS (123; section E exercises them) — plus 179''s reverts_action_id guard (F520), also ENABLE ALWAYS');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef,
                            has_function_privilege('public', p.oid, 'EXECUTE'),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc ~* 'insert\s+into\s+(public\.)?commissioner_actions'),
  'log_commissioner_action_internal:f:f:f:f',
  'A6 the ONE function body in the database that INSERTs a receipt is the INVOKER seam log_commissioner_action_internal, and no client role can EXECUTE it');
select is(
  (select format('%s|%s',
                 count(*) filter (where p.prosecdef),
                 count(*) filter (where p.prosecdef and p.proowner <> (select relowner from pg_class where oid = 'public.commissioner_actions'::regclass)))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ '(log_commissioner_action_internal|draft_commish_receipt_internal)\s*\('),
  (select format('%s|0', count(*)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.prosrc ~ '(log_commissioner_action_internal|draft_commish_receipt_internal)\s*\('),
  'A7 every SECURITY DEFINER function that calls a receipt seam is owned by the table owner (0 others) — each verb writes its receipt as the owner');
select ok(
  (select count(*) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.prosrc ~ '(log_commissioner_action_internal|draft_commish_receipt_internal)\s*\('),
  'A8 the A7 premise: there ARE DEFINER callers of the seams (the census is not vacuous)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not p.prosecdef
     and (p.prosrc ~ '(log_commissioner_action_internal|draft_commish_receipt_internal)\s*\('
          or p.proname in ('log_commissioner_action_internal', 'draft_commish_receipt_internal'))
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'A9 no INVOKER seam or INVOKER caller of one is EXECUTE-able by anon or authenticated — no path writes a receipt AS the client');

-- ---------------------------------------------------------------------------
-- Fixtures (privileged, before any JWT claims — D49(7))
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('97123000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-f555-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "f555_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 4) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams,
                     playoff_start_week, scoring_system_id, scoring_rules_snapshot, faab_budget, settings)
values ('b1230000-0000-4000-8000-000000000001', '97123000-0000-4000-8000-000000000001',
        'pgtap-f555-L', 2026, 'in_season', 8, 14, 0, 15,
        (select id from scoring_systems where is_template and name = 'ESPN Standard'),
        (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
        100, '{}'::jsonb);
insert into teams (id, owner_id, name, league_id)
select ('c1230000-0000-4000-8000-00000000000' || i)::uuid,
       ('97123000-0000-4000-8000-00000000000' || i)::uuid,
       'f555-t' || i, 'b1230000-0000-4000-8000-000000000001'
from generate_series(1, 3) i;
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case t.owner_id when '97123000-0000-4000-8000-000000000001' then 'commissioner'
                       when '97123000-0000-4000-8000-000000000002' then 'co_commissioner'
                       else 'manager' end, false, 100
from teams t where t.league_id = 'b1230000-0000-4000-8000-000000000001';
insert into team_managers (league_id, team_id, user_id, role)
select t.league_id, t.id, t.owner_id, 'manager' from teams t where t.league_id = 'b1230000-0000-4000-8000-000000000001';

-- One receipt written as the OWNER (a verb-shaped legacy row), so the
-- read and immutability cells start from a known count of 1.
insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, target_id, reason, before, after)
values ('a1230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-000000000001',
        '97123000-0000-4000-8000-000000000001', 'edit_score', 'matchup', 'seed', 'seed row', '{}', '{}');

-- The well-formed receipt a client would forge (the R1424 shape, minus the
-- stuffing): a takeover of t3 that never happened, attributed to the caller.
create function pg_temp.forge(p_actor text) returns text language sql as $$
  select format($f$ insert into public.commissioner_actions
      (league_id, actor_id, action_type, target_type, target_id, before, after, metadata)
    values ('b1230000-0000-4000-8000-000000000001', %L, 'replace_manager', 'team',
            'c1230000-0000-4000-8000-000000000003',
            '{"manager_user_id": "97123000-0000-4000-8000-000000000003"}',
            '{"manager_user_id": "97123000-0000-4000-8000-000000000004"}',
            '{"team_name": "f555-t3"}') $f$, p_actor)
$$;
grant execute on function pg_temp.forge(text) to public;
create temp table _n (who text, op text, n int);
grant select, insert on _n to public;

-- ---------------------------------------------------------------------------
-- B. A client INSERT of a well-formed receipt is refused, for every role
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select ok(public.is_league_commish('b1230000-0000-4000-8000-000000000001'),
  'B1 premise: u1 IS a commissioner of L (the old policy USING half would pass)');
select throws_ok(pg_temp.forge('97123000-0000-4000-8000-000000000001'),
  '42501', 'permission denied for table commissioner_actions',
  'B2 the COMMISSIONER client inserting a well-formed receipt as himself (actor_id = auth.uid() — the dropped policy exact WITH CHECK) is REFUSED 42501');
select throws_ok(pg_temp.forge('97123000-0000-4000-8000-000000000003'),
  '42501', 'permission denied for table commissioner_actions',
  'B3 …and naming another actor is refused the same way');
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(pg_temp.forge('97123000-0000-4000-8000-000000000002'),
  '42501', 'permission denied for table commissioner_actions',
  'B4 a CO-COMMISSIONER client (is_league_commish true) is refused 42501');
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(pg_temp.forge('97123000-0000-4000-8000-000000000003'),
  '42501', 'permission denied for table commissioner_actions',
  'B5 a MANAGER (member) client is refused 42501');
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(pg_temp.forge('97123000-0000-4000-8000-000000000004'),
  '42501', 'permission denied for table commissioner_actions',
  'B6 a NON-MEMBER client is refused 42501');
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(pg_temp.forge('97123000-0000-4000-8000-000000000001'),
  '42501', 'permission denied for table commissioner_actions',
  'B7 ANON is refused 42501');
reset role;
select is((select count(*)::int from commissioner_actions where league_id = 'b1230000-0000-4000-8000-000000000001'), 1,
  'B8 nothing was written by any of the five refused inserts (the seed row only)');
set local role service_role;
select lives_ok(
  $$ insert into public.commissioner_actions (id, league_id, actor_id, action_type, target_type, target_id)
     values ('a1230000-0000-4000-8000-000000000002', 'b1230000-0000-4000-8000-000000000001',
             '97123000-0000-4000-8000-000000000001', 'edit_score', 'matchup', 'service-plant') $$,
  'B9 service_role still inserts (it bypasses RLS and keeps INSERT — the stack suites plant legacy-shaped rows this way)');
reset role;
select is((select count(*)::int from commissioner_actions where league_id = 'b1230000-0000-4000-8000-000000000001'), 2,
  'B10 …and that row is there (2)');

-- ---------------------------------------------------------------------------
-- C. A real verb still writes exactly one receipt (as the owner)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_rename_team('b1230000-0000-4000-8000-000000000001', 'c1230000-0000-4000-8000-000000000003',
                                        'f555 renamed', null, 'e5550000-0000-4000-8000-000000000001') $$,
  'C1 the commissioner client calls commish_rename_team on t3 (a SECURITY DEFINER verb) and it lands');
reset role;
select is(
  (select string_agg(format('%s|%s|%s|%s|%s|%s', ca.actor_id, ca.target_type, ca.target_id, ca.acting_as_team_id,
                            ca.before ->> 'name', ca.after ->> 'name'), ' ; ')
   from commissioner_actions ca
   where ca.league_id = 'b1230000-0000-4000-8000-000000000001' and ca.action_type = 'reassign_team'),
  '97123000-0000-4000-8000-000000000001|team|c1230000-0000-4000-8000-000000000003|c1230000-0000-4000-8000-000000000003|f555-t3|f555 renamed',
  'C2 EXACTLY one reassign_team receipt: actor u1, the team, acting for the team (D451), old name to new');
select is((select name from teams where id = 'c1230000-0000-4000-8000-000000000003'), 'f555 renamed',
  'C3 …and the state change it records is real');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_rename_team('b1230000-0000-4000-8000-000000000001', 'c1230000-0000-4000-8000-000000000003',
                                        'f555 renamed', null, 'e5550000-0000-4000-8000-000000000002') $$,
  'C4 the same name again under a new action_id lands as a no-op');
reset role;
select is((select count(*)::int from commissioner_actions
           where league_id = 'b1230000-0000-4000-8000-000000000001' and action_type = 'reassign_team'), 1,
  'C5 …and writes NO receipt (still exactly one — standing rule (b))');
select is((select count(*)::int from commissioner_actions where league_id = 'b1230000-0000-4000-8000-000000000001'), 3,
  'C6 the log holds three rows: the seed, the service plant, the rename (the count sections D and E read)');

-- ---------------------------------------------------------------------------
-- D. The SELECT policy is unchanged
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from commissioner_actions), 3, 'D1 the commissioner reads all three rows');
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is((select count(*)::int from commissioner_actions), 3, 'D2 a manager reads all three rows (member transparency, §10.3)');
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is((select count(*)::int from commissioner_actions), 0, 'D3 a non-member reads nothing');
set local role anon;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from commissioner_actions), 0, 'D4 anon reads nothing');
reset role;

-- ---------------------------------------------------------------------------
-- E. Immutability unchanged: UPDATE / DELETE per role (RETURNING counts)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
with u as (update commissioner_actions set reason = 'tampered' returning 1) insert into _n select 'commish', 'update', count(*) from u;
with d as (delete from commissioner_actions returning 1) insert into _n select 'commish', 'delete', count(*) from d;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
with u as (update commissioner_actions set reason = 'tampered' returning 1) insert into _n select 'co', 'update', count(*) from u;
with d as (delete from commissioner_actions returning 1) insert into _n select 'co', 'delete', count(*) from d;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
with u as (update commissioner_actions set reason = 'tampered' returning 1) insert into _n select 'member', 'update', count(*) from u;
with d as (delete from commissioner_actions returning 1) insert into _n select 'member', 'delete', count(*) from d;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
with u as (update commissioner_actions set reason = 'tampered' returning 1) insert into _n select 'outsider', 'update', count(*) from u;
with d as (delete from commissioner_actions returning 1) insert into _n select 'outsider', 'delete', count(*) from d;
set local role anon;
select set_config('request.jwt.claims', '', true);
with u as (update commissioner_actions set reason = 'tampered' returning 1) insert into _n select 'anon', 'update', count(*) from u;
with d as (delete from commissioner_actions returning 1) insert into _n select 'anon', 'delete', count(*) from d;
reset role;
select is(
  (select string_agg(format('%s:%s=%s', who, op, n), ' ' order by who, op) from _n),
  'anon:delete=0 anon:update=0 co:delete=0 co:update=0 commish:delete=0 commish:update=0 member:delete=0 member:update=0 outsider:delete=0 outsider:update=0',
  'E1 THE RLS HALF (stored literal): UPDATE and DELETE affect 0 rows for the commissioner, co-commissioner, manager, non-member and anon — there is still no UPDATE or DELETE policy');
select is(
  (select count(*)::int from _n), 10,
  'E2 the E1 premise: all ten statements ran (none errored out of the census)');
select throws_ok(
  $$ update commissioner_actions set reason = 'tampered by the owner' where id = 'a1230000-0000-4000-8000-000000000001' $$,
  'P0001', null,
  'E3 THE OWNER HALF: an UPDATE as the table owner is REFUSED by trg_commish_actions_immutable');
select throws_ok(
  $$ delete from commissioner_actions where id = 'a1230000-0000-4000-8000-000000000001' $$,
  'P0001', null,
  'E4 …and a DELETE as the table owner is refused too');
select is((select count(*)::int from commissioner_actions where league_id = 'b1230000-0000-4000-8000-000000000001'), 3,
  'E5 none of the three rows is gone');
select is((select reason from commissioner_actions where id = 'a1230000-0000-4000-8000-000000000001'), 'seed row',
  'E6 …the seed row keeps its reason');
select is((select count(*)::int from commissioner_actions where reason = 'tampered' or reason = 'tampered by the owner'), 0,
  'E7 no row anywhere reads tampered');

-- ---------------------------------------------------------------------------
-- F. The route is closed for a data-modifying CTE and an upsert too
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97123000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ with i as (insert into public.commissioner_actions (league_id, actor_id, action_type)
                values ('b1230000-0000-4000-8000-000000000001', '97123000-0000-4000-8000-000000000001', 'edit_score') returning 1)
     select count(*) from i $$,
  '42501', 'permission denied for table commissioner_actions',
  'F1 a commissioner client INSERT inside a data-modifying CTE is refused 42501');
select throws_ok(
  $$ insert into public.commissioner_actions (id, league_id, actor_id, action_type)
     values ('a1230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-000000000001', '97123000-0000-4000-8000-000000000001', 'edit_score')
     on conflict (id) do nothing $$,
  '42501', 'permission denied for table commissioner_actions',
  'F2 a commissioner client upsert (the PostgREST upsert shape, ON CONFLICT DO NOTHING) is refused 42501');
select throws_ok(
  $$ insert into public.commissioner_actions (id, league_id, actor_id, action_type)
     values ('a1230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-000000000001', '97123000-0000-4000-8000-000000000001', 'edit_score')
     on conflict (id) do update set reason = 'tampered' $$,
  '42501', 'permission denied for table commissioner_actions',
  'F3 …and ON CONFLICT DO UPDATE (an insert-shaped edit of an existing receipt) is refused 42501');
reset role;
select is((select count(*)::int from commissioner_actions where league_id = 'b1230000-0000-4000-8000-000000000001'), 3,
  'F4 still exactly three rows');

select * from finish();
rollback;
