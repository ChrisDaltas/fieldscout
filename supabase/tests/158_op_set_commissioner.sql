-- ============================================================================
-- 158 — an operator replaces a missing commissioner (migration 208; F750;
--       spec §24.4 v2.16.106; PROGRESS D670–D673)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — the door DEFINER + search_path '' + EXECUTE authenticated only;
--       the internal plain, search_path '', closed; the door gates on
--       is_platform_operator() and never reads league_members; no body
--       touches the JWT claims (R1545).
--   §K  THE GATE — anon, a plain user, the league's own commissioner and its
--       co-commissioner are all refused 42501 (a co-commissioner cannot take
--       the role); nothing moved. The internal is closed to authenticated.
--   §T  THE TRANSFER — the operator makes a manager the commissioner: the
--       old commissioner is a CO-COMMISSIONER with his seat and team (F790); exactly one
--       commissioner; ONE league receipt (golden after); ONE "FieldScout" line
--       with no actor (golden text); NO commissioner_actions row. The new
--       commissioner holds the power (set_member_role works for him; the old
--       one cannot transfer the role).
--   §R  REPLAY — the same action id returns the receipt and writes nothing; the
--       same action id for a different member is 22023.
--   §N  NO-OP + REFUSALS — already the commissioner: changed false, nothing
--       written; a deleted league / another league's member / an unknown id
--       P0002; a placeholder seat 22023; no action id / a blank reason 22023.
--   §H  A HEADLESS LEAGUE (the commissioner's account was deleted) — the
--       operator promotes a co-commissioner; the line has no "is now a
--       co-commissioner" clause.
-- Break probes (§4.3, shown in the PR, reverted): (1) drop the door's in-body
-- gate ⇒ K2–K4 red; (2) demote to 'manager' instead of 'co_commissioner' ⇒
-- T2 red.
-- World (season 2097): u1 commissioner of L1, u2 manager of L1, u3
-- co-commissioner of L1, u4 OPERATOR (in no league), u5 plain user, u6
-- commissioner of L2 (u6 is NOT in L1). L1 also has a placeholder seat. LD is
-- deleted (u1 commissioner, u2 manager). LH has no commissioner row (u7
-- co-commissioner, u8 manager).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(47);

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.err(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'op\_set\_commissioner%'),
  'op_set_commissioner=t:search_path="":f:t op_set_commissioner_internal=f:search_path="":f:f',
  'A1 the door DEFINER + search_path '''' + authenticated only; the internal plain and closed');
select ok(
  (select p.prosrc ~ 'public\.is_platform_operator\(\)' and p.prosrc !~* 'league_members'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'op_set_commissioner'),
  'A2 TD1: the door gates on is_platform_operator() and never on league_members');
select ok(
  (select bool_and(p.prosrc !~* 'request\.jwt' and p.prosrc !~* 'set_config')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'op\_set\_commissioner%'),
  'A3 R1545: neither body touches the JWT claims');
select ok(
  (select p.prosrc ~ 'op_verb_prelude_internal\(''set_commissioner'', p_league_id'
          and p.prosrc ~ 'log_operator_action_internal' and p.prosrc ~ 'op_league_line_internal'
          and p.prosrc !~ 'log_commissioner_action_internal' and p.prosrc !~ 'commish_receipt_internal'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'op_set_commissioner_internal'),
  'A4 the internal uses 184''s prelude, the operator receipt and the FieldScout line — and no commissioner_actions writer (D671)');

-- ---------------------------------------------------------------------------
-- World
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, ('99158000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x158-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, json_build_object('username', 'x158_user' || i)::jsonb, now(), now()
from generate_series(1, 8) i;
update profiles set is_admin = true where id = '99158000-0000-4000-8000-000000000004';

insert into leagues (id, owner_id, name, season, status, team_count, settings, roster_settings, deleted_at)
select v.id::uuid, v.owner::uuid, v.nm, 2097, 'setup', 8, '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}',
  v.del::timestamptz
from (values
  ('b1580000-0000-4000-8000-000000000001', '99158000-0000-4000-8000-000000000001', 'x158 One', null),
  ('b1580000-0000-4000-8000-000000000002', '99158000-0000-4000-8000-000000000006', 'x158 Two', null),
  ('b1580000-0000-4000-8000-0000000000dd', '99158000-0000-4000-8000-000000000001', 'x158 Deleted', null),   -- stamped below, after its member rows (212)
  ('b1580000-0000-4000-8000-0000000000ee', '99158000-0000-4000-8000-000000000007', 'x158 Headless', null)
) v(id, owner, nm, del);

insert into teams (id, owner_id, name, league_id) values
  ('c1580000-0000-4000-8000-000000000001', '99158000-0000-4000-8000-000000000001', 'Aces', 'b1580000-0000-4000-8000-000000000001'),
  ('c1580000-0000-4000-8000-000000000002', '99158000-0000-4000-8000-000000000002', 'Bees', 'b1580000-0000-4000-8000-000000000001'),
  ('c1580000-0000-4000-8000-000000000003', '99158000-0000-4000-8000-000000000003', 'Cats', 'b1580000-0000-4000-8000-000000000001'),
  ('c1580000-0000-4000-8000-000000000004', '99158000-0000-4000-8000-000000000001', 'Open Seat', 'b1580000-0000-4000-8000-000000000001'),
  ('c1580000-0000-4000-8000-000000000006', '99158000-0000-4000-8000-000000000006', 'Sixes', 'b1580000-0000-4000-8000-000000000002'),
  ('c1580000-0000-4000-8000-000000000007', '99158000-0000-4000-8000-000000000007', 'Sevens', 'b1580000-0000-4000-8000-0000000000ee'),
  ('c1580000-0000-4000-8000-000000000008', '99158000-0000-4000-8000-000000000008', 'Eights', 'b1580000-0000-4000-8000-0000000000ee');
insert into league_members (id, league_id, user_id, team_id, role, is_placeholder) values
 ('d1580000-0000-4000-8000-000000000001', 'b1580000-0000-4000-8000-000000000001', '99158000-0000-4000-8000-000000000001', 'c1580000-0000-4000-8000-000000000001', 'commissioner', false),
 ('d1580000-0000-4000-8000-000000000002', 'b1580000-0000-4000-8000-000000000001', '99158000-0000-4000-8000-000000000002', 'c1580000-0000-4000-8000-000000000002', 'manager', false),
 ('d1580000-0000-4000-8000-000000000003', 'b1580000-0000-4000-8000-000000000001', '99158000-0000-4000-8000-000000000003', 'c1580000-0000-4000-8000-000000000003', 'co_commissioner', false),
 ('d1580000-0000-4000-8000-000000000004', 'b1580000-0000-4000-8000-000000000001', null, 'c1580000-0000-4000-8000-000000000004', 'manager', true),
 ('d1580000-0000-4000-8000-000000000006', 'b1580000-0000-4000-8000-000000000002', '99158000-0000-4000-8000-000000000006', 'c1580000-0000-4000-8000-000000000006', 'commissioner', false),
 -- R1677: a seat flagged placeholder that nonetheless carries a user_id.
 ('d1580000-0000-4000-8000-000000000009', 'b1580000-0000-4000-8000-000000000002', '99158000-0000-4000-8000-000000000005', null, 'manager', true),
 ('d1580000-0000-4000-8000-0000000000d1', 'b1580000-0000-4000-8000-0000000000dd', '99158000-0000-4000-8000-000000000001', null, 'commissioner', false),
 ('d1580000-0000-4000-8000-0000000000d2', 'b1580000-0000-4000-8000-0000000000dd', '99158000-0000-4000-8000-000000000002', null, 'manager', false),
 ('d1580000-0000-4000-8000-000000000007', 'b1580000-0000-4000-8000-0000000000ee', '99158000-0000-4000-8000-000000000007', 'c1580000-0000-4000-8000-000000000007', 'co_commissioner', false),
 ('d1580000-0000-4000-8000-000000000008', 'b1580000-0000-4000-8000-0000000000ee', '99158000-0000-4000-8000-000000000008', 'c1580000-0000-4000-8000-000000000008', 'manager', false);
-- RE-CUT BY 212 (F716): a soft-deleted league is now an ARCHIVED one, and an
-- archived league's rows refuse every write (league_archived_guard_internal),
-- so the fixture builds the league's rows FIRST and stamps deleted_at LAST —
-- the same end state the cells below read.
update leagues set deleted_at = '2097-02-01 00:00+00' where id = 'b1580000-0000-4000-8000-0000000000dd';

create temp table r158 (tag text primary key, r jsonb);
grant all on r158 to anon, authenticated, service_role;

-- The league's roles, as one comparable string.
create function pg_temp.roles(p_league uuid) returns text language sql stable as $$
  select string_agg(right(lm.id::text, 2) || '=' || lm.role || ':' || coalesce(right(lm.team_id::text, 2), '-'), ' ' order by lm.id)
  from public.league_members lm where lm.league_id = p_league
$$;
grant execute on function pg_temp.roles(uuid) to anon, authenticated;
create function pg_temp.writes() returns text language sql stable as $$
  select format('ops=%s lines=%s commish=%s',
    (select count(*) from public.platform_operator_actions a where a.league_id in
       ('b1580000-0000-4000-8000-000000000001', 'b1580000-0000-4000-8000-0000000000ee')),
    (select count(*) from public.league_chat c where c.league_id in
       ('b1580000-0000-4000-8000-000000000001', 'b1580000-0000-4000-8000-0000000000ee')),
    -- the operator's rows, or any transfer receipt (T12's own set_member_role
    -- writes a promote receipt as the new commissioner — his, not ours)
    (select count(*) from public.commissioner_actions c where c.league_id in
       ('b1580000-0000-4000-8000-000000000001', 'b1580000-0000-4000-8000-0000000000ee')
       and (c.actor_id = '99158000-0000-4000-8000-000000000004' or c.action_type = 'transfer_commissioner')))
$$;

select is(pg_temp.roles('b1580000-0000-4000-8000-000000000001'),
  '01=commissioner:01 02=manager:02 03=co_commissioner:03 04=manager:04',
  'W1 the world: u1 commissioner, u2 manager, u3 co-commissioner, a placeholder seat');

-- ---------------------------------------------------------------------------
-- K. The gate
-- ---------------------------------------------------------------------------
set local role anon;
select alike(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000002', 'a1580000-0000-4000-8000-0000000000a1')$$),
  '42501:%', 'K1 anon is refused');
reset role;

select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000002', 'a1580000-0000-4000-8000-0000000000a2')$$),
  '42501: set_commissioner: only a platform operator can replace a commissioner (M8 TD1)', 'K2 a plain user is refused by name');
reset role;

select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000002', 'a1580000-0000-4000-8000-0000000000a3')$$),
  '42501: set_commissioner: only a platform operator can replace a commissioner (M8 TD1)', 'K3 the league''s own commissioner is refused (his tool is Make commissioner on the members page)');
reset role;

select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000003', 'a1580000-0000-4000-8000-0000000000a4')$$),
  '42501: set_commissioner: only a platform operator can replace a commissioner (M8 TD1)', 'K4 a co-commissioner cannot take the role through this door');
select alike(pg_temp.err($$select op_set_commissioner_internal('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000003', 'a1580000-0000-4000-8000-0000000000a5', null, now())$$),
  '42501: permission denied for function op_set_commissioner_internal%', 'K5 the internal is closed to authenticated');
reset role;

select is(pg_temp.roles('b1580000-0000-4000-8000-000000000001'),
  '01=commissioner:01 02=manager:02 03=co_commissioner:03 04=manager:04', 'K6 nothing moved');
select is(pg_temp.writes(), 'ops=0 lines=0 commish=0', 'K7 nothing written');

-- ---------------------------------------------------------------------------
-- T. The transfer — the operator makes u2 (a manager) the commissioner
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
insert into r158 select 'T', op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000002',
  'a1580000-0000-4000-8000-000000000001', 'Commissioner lost his email');
reset role;

select is((select r - 'set_at' from r158 where tag = 'T'),
  '{"changed": true, "league_id": "b1580000-0000-4000-8000-000000000001", "new_member_id": "d1580000-0000-4000-8000-000000000002", "new_user_id": "99158000-0000-4000-8000-000000000002", "previous_member_id": "d1580000-0000-4000-8000-000000000001", "previous_user_id": "99158000-0000-4000-8000-000000000001", "previous_role_now": "co_commissioner"}'::jsonb,
  'T1 the result (golden)');
select is(pg_temp.roles('b1580000-0000-4000-8000-000000000001'),
  '01=co_commissioner:01 02=commissioner:02 03=co_commissioner:03 04=manager:04',
  'T2 u2 is the commissioner; u1 is a CO-COMMISSIONER (F790) and keeps his seat and team; the other co-commissioner and the placeholder are untouched');
select is((select owner_id from teams where id = 'c1580000-0000-4000-8000-000000000001'),
  '99158000-0000-4000-8000-000000000001'::uuid, 'T3 u1 still owns his team');
select is((select count(*)::int from league_members where league_id = 'b1580000-0000-4000-8000-000000000001' and role = 'commissioner'),
  1, 'T4 exactly one commissioner');
select is((select owner_id from leagues where id = 'b1580000-0000-4000-8000-000000000001'),
  '99158000-0000-4000-8000-000000000001'::uuid, 'T5 the league creator record is unchanged (the 169 transfer leaves it too)');
select is(
  (select format('%s|%s|%s|%s|%s', a.verb, a.scope, a.actor_id, a.reason, a.before)
   from platform_operator_actions a where a.action_id = 'a1580000-0000-4000-8000-000000000001'),
  'set_commissioner|league|99158000-0000-4000-8000-000000000004|Commissioner lost his email|{"new_member_id": "d1580000-0000-4000-8000-000000000002", "new_member_role": "manager", "commissioner_user_id": "99158000-0000-4000-8000-000000000001", "commissioner_member_id": "d1580000-0000-4000-8000-000000000001"}',
  'T6 ONE league receipt — the operator, the reason, before (golden)');
select is((select (after - 'set_at') = (select r - 'set_at' from r158 where tag = 'T') from platform_operator_actions where action_id = 'a1580000-0000-4000-8000-000000000001'),
  true, 'T7 the receipt''s after is the result');
select is(
  (select string_agg(format('%s|%s|%s|%s', c.message, c.user_id, c.is_system, c.context), ' / ')
   from league_chat c where c.league_id = 'b1580000-0000-4000-8000-000000000001'),
  'FieldScout made x158_user2 the commissioner. x158_user1 is now a co-commissioner.||t|league',
  'T8 ONE league line, signed FieldScout, no actor (golden)');
select is(pg_temp.writes(), 'ops=1 lines=1 commish=0', 'T9 one receipt, one line, NO commissioner_actions row (the admin is never named to the league — D671)');
select is((select (r ->> 'set_at')::timestamptz <= now() + interval '1 second' and (r ->> 'set_at')::timestamptz >= now() - interval '1 minute' from r158 where tag = 'T'),
  true, 'T10 the door handed the database clock to the internal');

-- The new commissioner holds the power; the old one does not.
select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select alike(pg_temp.err($$select set_member_role('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000003', 'commissioner')$$),
  '42501:%only the sitting commissioner can transfer the commissioner role%', 'T11 the old commissioner can no longer transfer the role (he is a co-commissioner)');
reset role;
select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is((select (set_member_role('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000001', 'manager')) ->> 'role'),
  'manager', 'T12 the new commissioner can use his own tools (makes u1 a manager)');
reset role;
select is(pg_temp.roles('b1580000-0000-4000-8000-000000000001'),
  '01=manager:01 02=commissioner:02 03=co_commissioner:03 04=manager:04', 'T13 his change landed');

-- ---------------------------------------------------------------------------
-- R. Replay
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
insert into r158 select 'R', op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000002',
  'a1580000-0000-4000-8000-000000000001', 'Commissioner lost his email');
select alike(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000003', 'a1580000-0000-4000-8000-000000000001')$$),
  '22023: set_commissioner: action id a1580000-0000-4000-8000-000000000001 was already used for a different member', 'R1 the same action id for a different member is refused by name');
reset role;
select is((select (r ->> 'replayed')::boolean and r ->> 'new_member_id' = 'd1580000-0000-4000-8000-000000000002' from r158 where tag = 'R'),
  true, 'R2 a replay returns the receipt, marked replayed');
select is(pg_temp.writes(), 'ops=1 lines=1 commish=0', 'R3 the replay wrote nothing');
select is(pg_temp.roles('b1580000-0000-4000-8000-000000000001'),
  '01=manager:01 02=commissioner:02 03=co_commissioner:03 04=manager:04', 'R4 the replay moved nothing (it did not re-demote u1)');

-- ---------------------------------------------------------------------------
-- N. No-op and refusals
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
insert into r158 select 'N', op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000002',
  'a1580000-0000-4000-8000-000000000002');
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-0000000000dd', 'd1580000-0000-4000-8000-0000000000d2', 'a1580000-0000-4000-8000-000000000003')$$),
  'P0002: set_commissioner: league b1580000-0000-4000-8000-0000000000dd is archived — restore it first (the admin league page''s Restore)', 'N2 a deleted league is refused — RE-CUT BY 212 (R1733): named as archived, not "does not exist"');
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000006', 'a1580000-0000-4000-8000-000000000004')$$),
  'P0002: set_commissioner: member d1580000-0000-4000-8000-000000000006 is not in this league', 'N3 another league''s member is refused');
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-0000000000ff', 'a1580000-0000-4000-8000-000000000005')$$),
  'P0002: set_commissioner: member d1580000-0000-4000-8000-0000000000ff is not in this league', 'N4 an unknown member id is refused');
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000004', 'a1580000-0000-4000-8000-000000000006')$$),
  '22023: set_commissioner: that seat has no person in it — only a member who has joined can be the commissioner', 'N5 a placeholder seat is refused');
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000002', 'd1580000-0000-4000-8000-000000000009', 'a1580000-0000-4000-8000-00000000000a')$$),
  '22023: set_commissioner: that seat has no person in it — only a member who has joined can be the commissioner', 'N5b a seat flagged placeholder is refused even with a user_id on it (R1677)');
select alike(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000003')$$),
  '22023: set_commissioner: p_action_id is required%', 'N6 no action id is refused');
select alike(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000001', 'd1580000-0000-4000-8000-000000000003', 'a1580000-0000-4000-8000-000000000007', E' \t')$$),
  '22023: set_commissioner: a reason is optional, but when given it is non-blank%', 'N7 a blank reason is refused');
select is(pg_temp.err($$select op_set_commissioner('b1580000-0000-4000-8000-000000000099', 'd1580000-0000-4000-8000-000000000003', 'a1580000-0000-4000-8000-000000000008')$$),
  'P0002: set_commissioner: league b1580000-0000-4000-8000-000000000099 does not exist', 'N8 an unknown league is refused');
reset role;
select is((select r from r158 where tag = 'N'),
  '{"why": "already_commissioner — that member is already the commissioner", "changed": false, "new_member_id": "d1580000-0000-4000-8000-000000000002"}'::jsonb,
  'N1 already the commissioner: changed false, and it says why (golden)');
select is(pg_temp.writes(), 'ops=1 lines=1 commish=0', 'N9 the no-op and every refusal wrote nothing');
select is(pg_temp.roles('b1580000-0000-4000-8000-0000000000dd'),
  'd1=commissioner:- d2=manager:-', 'N10 the deleted league''s roles did not move');
select is(pg_temp.roles('b1580000-0000-4000-8000-000000000001'),
  '01=manager:01 02=commissioner:02 03=co_commissioner:03 04=manager:04', 'N11 L1 did not move');

-- ---------------------------------------------------------------------------
-- H. A headless league — the operator promotes a co-commissioner
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99158000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
insert into r158 select 'H', op_set_commissioner('b1580000-0000-4000-8000-0000000000ee', 'd1580000-0000-4000-8000-000000000007',
  'a1580000-0000-4000-8000-000000000009');
reset role;
select is(pg_temp.roles('b1580000-0000-4000-8000-0000000000ee'),
  '07=commissioner:07 08=manager:08', 'H1 the co-commissioner is the commissioner; the manager untouched');
select is((select format('%s|%s|%s', r ->> 'previous_member_id', r ->> 'previous_role_now', r ->> 'changed') from r158 where tag = 'H'),
  '||true', 'H2 no previous commissioner is named');
select is((select string_agg(c.message, ' / ') from league_chat c where c.league_id = 'b1580000-0000-4000-8000-0000000000ee'),
  'FieldScout made x158_user7 the commissioner.', 'H3 the line has no "is now a co-commissioner" clause (golden)');
select is((select reason is null from platform_operator_actions where action_id = 'a1580000-0000-4000-8000-000000000009'),
  true, 'H4 no reason given = NULL reason (optional)');
select is(pg_temp.writes(), 'ops=2 lines=2 commish=0', 'H5 one more receipt and line; still no commissioner_actions row');
select is(
  (select count(*)::int from (select league_id from league_members
     where league_id in ('b1580000-0000-4000-8000-000000000001', 'b1580000-0000-4000-8000-000000000002', 'b1580000-0000-4000-8000-0000000000ee')
       and role = 'commissioner' group by league_id having count(*) = 1) x),
  3, 'H6 every league ends with exactly one commissioner');

select * from finish();
rollback;
