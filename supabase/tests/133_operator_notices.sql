-- ============================================================================
-- 133 — hand-written notices: op_send_notification (migration 185; M8 L.G1.2;
--       spec §24.4 "Notices"; tasks-M8 TD10 / TD11; Q97 / Q101; PROGRESS D516)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — the door DEFINER + search_path '' + EXECUTE for authenticated
--       only; both internals plain and closed; the gate path never reads
--       league_members (TD1).
--   §K  REFUSALS — anon / a plain user / a commissioner (42501); a channel
--       other than in_app, no channel, a bad audience, a league with the
--       wrong audience, an outside link, a blank title, no action id, an
--       unknown league, and ZERO recipients (P0002, loud) — none writes a
--       notification, a receipt or a league line.
--   §P  PAGING BOUNDARY — exactly 1000 recipients = 1 page; 1001 = 2 pages,
--       every row written (never silently capped at 1000).
--   §S  ONE LEAGUE — the exact member set, the row shape (type, data, link,
--       instant), ONE receipt with the recipient count, ONE "FieldScout" line;
--       a replay sends nothing twice; a reused action id for another audience
--       is refused.
--   §U  EVERY APP USER — baseline + 1006 fixture users exactly; the reserved
--       "-ai" account excluded; platform receipt; no league line.
--   §L  EVERYONE IN ANY LEAGUE — baseline + 1003 exactly; a member of two
--       leagues gets ONE; a member of only a deleted league, the operator and
--       a league-less user get none.
--   §R  READS / WRITES per role on notifications (RETURNING counts).
-- Break probe (§4.3): cap the page loop at one page (and drop its total
-- check) ⇒ P2 / P3 red (shown in the PR, reverted).
-- World: u1 commissioner, u2 / u3 managers, u4 OPERATOR, u5 plain user,
--        u6 member of a DELETED league only, 1000 bulk users, one "-ai".
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(54);

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
   where n.nspname = 'public' and p.proname in ('op_send_notification', 'op_send_notification_internal',
     'op_notice_recipients_internal')),
  'op_notice_recipients_internal=f:search_path="":f:f op_send_notification=t:search_path="":f:t op_send_notification_internal=f:search_path="":f:f',
  'A1 the door DEFINER + search_path '''' + authenticated only; both internals plain and closed to anon / authenticated');
select ok(
  (select bool_and(p.prosrc !~* 'public\.league_members') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_send_notification', 'op_send_notification_internal')),
  'A2 TD1: the door and the verb body never read league_members (only the recipient list does, for the audience)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'notifications' and cmd in ('INSERT', 'ALL')),
  0, 'A3 notifications still has no INSERT policy — every notice is the DEFINER verb''s write');

-- ---------------------------------------------------------------------------
-- World
-- ---------------------------------------------------------------------------
create temp table b133 (k text primary key, n int);
grant all on b133 to anon, authenticated, service_role;
insert into b133 values
  ('users', (select count(*) from profiles p where p.username !~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$')),
  ('members', (select count(distinct m.user_id) from league_members m join leagues l on l.id = m.league_id
               where l.deleted_at is null and m.user_id is not null));

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, ('99133000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x133-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, json_build_object('username', 'x133_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i
union all
select '00000000-0000-0000-0000-000000000000'::uuid, ('99133000-0000-4000-8001-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-x133-b' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, json_build_object('username', 'x133_b' || lpad(i::text, 4, '0'))::jsonb, now(), now()
from generate_series(1, 1000) i
union all
select '00000000-0000-0000-0000-000000000000'::uuid, '99133000-0000-4000-8000-0000000000a1'::uuid,
  'authenticated', 'authenticated', 'pgtap-x133-ai@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"username": "x133-scout-ai"}'::jsonb, now(), now();
update profiles set is_admin = true where id = '99133000-0000-4000-8000-000000000004';
-- The reserved AI-account form is service-only (025) — set it as the owner, the way the persona seed does.
update profiles set username = 'x133-scout-ai' where id = '99133000-0000-4000-8000-0000000000a1';

insert into leagues (id, owner_id, name, season, status, team_count, settings, roster_settings, deleted_at)
select v.id::uuid, '99133000-0000-4000-8000-000000000001', v.nm, 2026, 'setup', 8, '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}',
  v.del::timestamptz
from (values
  ('b1330000-0000-4000-8000-000000000001', 'pgtap-x133-L1', null),     -- u1 commish, u2, u3, a placeholder
  ('b1330000-0000-4000-8000-000000000002', 'pgtap-x133-LK', null),     -- exactly 1000 bulk
  ('b1330000-0000-4000-8000-000000000003', 'pgtap-x133-LB', null),     -- 1000 bulk + u2 = 1001
  ('b1330000-0000-4000-8000-000000000004', 'pgtap-x133-L0', null),     -- nobody
  ('b1330000-0000-4000-8000-000000000005', 'pgtap-x133-LD', null)  -- deleted: u6 (stamped below, after its member row — 212)
) v(id, nm, del);
insert into league_members (league_id, user_id, role, is_placeholder) values
 ('b1330000-0000-4000-8000-000000000001', '99133000-0000-4000-8000-000000000001', 'commissioner', false),
 ('b1330000-0000-4000-8000-000000000001', '99133000-0000-4000-8000-000000000002', 'manager', false),
 ('b1330000-0000-4000-8000-000000000001', '99133000-0000-4000-8000-000000000003', 'manager', false),
 ('b1330000-0000-4000-8000-000000000001', null, 'manager', true),
 ('b1330000-0000-4000-8000-000000000003', '99133000-0000-4000-8000-000000000002', 'manager', false),
 ('b1330000-0000-4000-8000-000000000005', '99133000-0000-4000-8000-000000000006', 'manager', false);
insert into league_members (league_id, user_id, role, is_placeholder)
select l, ('99133000-0000-4000-8001-' || lpad(i::text, 12, '0'))::uuid, 'manager', false
from generate_series(1, 1000) i,
     unnest(array['b1330000-0000-4000-8000-000000000002', 'b1330000-0000-4000-8000-000000000003']::uuid[]) l;
-- RE-CUT BY 212 (F716): a soft-deleted league is now an ARCHIVED one, and an
-- archived league's rows refuse every write (league_archived_guard_internal),
-- so the fixture builds the league's rows FIRST and stamps deleted_at LAST —
-- the same end state the cells below read.
update leagues set deleted_at = '2026-10-01 00:00:00+00' where id = 'b1330000-0000-4000-8000-000000000005';

create temp table r133 (tag text primary key, r jsonb);
grant all on r133 to anon, authenticated, service_role;
create or replace function pg_temp.as_op() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "99133000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
$$;
create or replace function pg_temp.notices(p_action text) returns int language sql as $$
  select count(*)::int from notifications n where n.type = 'operator_notice' and n.data ->> 'action_id' = p_action
$$;
create or replace function pg_temp.all_notices() returns int language sql as $$
  select count(*)::int from notifications n where n.type = 'operator_notice'
$$;
create or replace function pg_temp.receipts() returns int language sql as $$
  select count(*)::int from platform_operator_actions a where a.actor_id = '99133000-0000-4000-8000-000000000004'
$$;
create or replace function pg_temp.lines() returns int language sql as $$
  select count(*)::int from league_chat c where c.league_id::text like 'b1330000-%' and c.message like 'FieldScout %'
$$;

-- ---------------------------------------------------------------------------
-- K. Refusals
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select alike(pg_temp.err($$ select op_send_notification('all_users', 'Hi', null, null, null, array['in_app'], gen_random_uuid()) $$),
  '42501:%', 'K1 anon cannot execute the door');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99133000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select alike(pg_temp.err($$ select op_send_notification('all_users', 'Hi', null, null, null, array['in_app'], gen_random_uuid()) $$),
  '42501: send_notification: only a platform operator%', 'K2 a plain signed-in user is refused (the in-body gate)');
select set_config('request.jwt.claims', '{"sub": "99133000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select alike(pg_temp.err($$ select op_send_notification('league', 'Hi', null, null, 'b1330000-0000-4000-8000-000000000001', array['in_app'], gen_random_uuid()) $$),
  '42501:%', 'K3 the league''s own commissioner is refused — no commissioner power (TD1)');
select pg_temp.as_op();
select alike(pg_temp.err($$ select op_send_notification('all_users', 'Hi', null, null, null, array['in_app', 'email'], gen_random_uuid()) $$),
  '22023: %channel "email" is not available%', 'K4 a channel other than in_app is refused by name (Q97 — email / push not built)');
select alike(pg_temp.err($$ select op_send_notification('all_users', 'Hi', null, null, null, array['push'], gen_random_uuid()) $$),
  '22023: %channel "push"%', 'K5 …push too');
select alike(pg_temp.err($$ select op_send_notification('all_users', 'Hi', null, null, null, array[]::text[], gen_random_uuid()) $$),
  '22023: %at least one channel%', 'K6 no channel is refused');
select alike(pg_temp.err($$ select op_send_notification('everyone', 'Hi', null, null, null, array['in_app'], gen_random_uuid()) $$),
  '22023: %audience must be%', 'K7 an unknown audience is refused');
select alike(pg_temp.err($$ select op_send_notification('league', 'Hi', null, null, null, array['in_app'], gen_random_uuid()) $$),
  '22023: %a league is named exactly when%', 'K8 a league audience with no league is refused');
select alike(pg_temp.err($$ select op_send_notification('all_users', 'Hi', null, null, 'b1330000-0000-4000-8000-000000000001', array['in_app'], gen_random_uuid()) $$),
  '22023: %a league is named exactly when%', 'K9 a league named with a platform audience is refused');
select is(
  (select string_agg(left(pg_temp.err(format($f$ select op_send_notification('all_users', 'Hi', null, %L, null, array['in_app'], gen_random_uuid()) $f$, x)), 5), ',' order by x)
   from unnest(array['https://evil.example', '//evil.example', 'app/leagues', '/app/x y', '/app\x', 'javascript:alert(1)']) x),
  '22023,22023,22023,22023,22023,22023',
  'K10 a link outside the app (scheme, //host, relative, whitespace, backslash) is refused');
select alike(pg_temp.err($$ select op_send_notification('all_users', '   ', null, null, null, array['in_app'], gen_random_uuid()) $$),
  '22023: %a title is required%', 'K11 a blank title is refused');
select alike(pg_temp.err($$ select op_send_notification('all_users', 'Hi', null, null, null, array['in_app'], null) $$),
  '22023: %p_action_id is required%', 'K12 no action id is refused');
select alike(pg_temp.err($$ select op_send_notification('league', 'Hi', null, null, 'b1330000-0000-4000-8000-0000000000ff', array['in_app'], gen_random_uuid()) $$),
  'P0002: %does not exist%', 'K13 an unknown league is refused');
select alike(pg_temp.err($$ select op_send_notification('league', 'Hi', null, null, 'b1330000-0000-4000-8000-000000000005', array['in_app'], gen_random_uuid()) $$),
  'P0002: %does not exist%', 'K14 a deleted league is refused');
select alike(pg_temp.err($$ select op_send_notification('league', 'Hi', null, null, 'b1330000-0000-4000-8000-000000000004', array['in_app'], gen_random_uuid()) $$),
  'P0002: send_notification: this audience has no recipients — nothing was sent', 'K15 ZERO recipients refuses loudly (§24.4)');
reset role;
select is(format('%s|%s|%s', pg_temp.all_notices(), pg_temp.receipts(), pg_temp.lines()), '0|0|0',
  'K16 no refusal wrote a notification, a receipt or a league line');

-- ---------------------------------------------------------------------------
-- P. The 1000-row page boundary
-- ---------------------------------------------------------------------------
select pg_temp.as_op();
insert into r133 select 'P1', op_send_notification_internal('league', 'b1330000-0000-4000-8000-000000000002', 'Exactly a thousand',
  null, null, array['in_app'], 'a1330000-0000-4000-8000-000000000001', null, '2026-10-12 15:00:00+00');
select is(format('%s|%s|%s', r ->> 'recipients', r ->> 'pages', pg_temp.notices('a1330000-0000-4000-8000-000000000001')),
  '1000|1|1000', 'P1 exactly 1000 recipients = one page of 1000 rows')
from r133 where tag = 'P1';
insert into r133 select 'P2', op_send_notification_internal('league', 'b1330000-0000-4000-8000-000000000003', 'One past a thousand',
  'Week 7 waivers run Thursday.', '/app/leagues/b1330000-0000-4000-8000-000000000003', array['in_app', 'in_app'],
  'a1330000-0000-4000-8000-000000000002', 'postponed game', '2026-10-12 15:00:00+00');
select is(format('%s|%s', r ->> 'recipients', r ->> 'pages'), '1001|2',
  'P2 1001 recipients = two pages (the result says so)') from r133 where tag = 'P2';
select is(pg_temp.notices('a1330000-0000-4000-8000-000000000002'), 1001,
  'P3 …and all 1001 rows are written — never silently capped at 1000');

-- ---------------------------------------------------------------------------
-- S. One league (P2's send)
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from (
     (select m.user_id from league_members m where m.league_id = 'b1330000-0000-4000-8000-000000000003'
      except select n.user_id from notifications n where n.data ->> 'action_id' = 'a1330000-0000-4000-8000-000000000002')
     union all
     (select n.user_id from notifications n where n.data ->> 'action_id' = 'a1330000-0000-4000-8000-000000000002'
      except select m.user_id from league_members m where m.league_id = 'b1330000-0000-4000-8000-000000000003')) d),
  0, 'S1 the recipients are EXACTLY the league''s members (set difference both ways is empty)');
select is(
  (select count(distinct n.user_id)::int from notifications n where n.data ->> 'action_id' = 'a1330000-0000-4000-8000-000000000002'),
  1001, 'S2 one notice per member, no duplicates (the duplicated in_app channel sends once)');
select is(
  (select string_agg(distinct format('%s|%s|%s|%s|%s|%s', n.type, n.title, n.body, n.read,
      to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), n.data - 'action_id'), ' ; ')
   from notifications n where n.data ->> 'action_id' = 'a1330000-0000-4000-8000-000000000002'),
  'operator_notice|One past a thousand|Week 7 waivers run Thursday.|f|2026-10-12T15:00:00Z|{"from": "fieldscout", "link": "/app/leagues/b1330000-0000-4000-8000-000000000003", "channel": "in_app", "audience": "league", "league_id": "b1330000-0000-4000-8000-000000000003"}',
  'S3 every row: type operator_notice, the text, unread, the injected instant, data {from fieldscout, in-app link, channel, audience, league}');
select is(
  (select format('%s|%s|%s|%s|%s|%s', a.verb, a.scope, a.league_id, a.reason, a.after ->> 'recipients', a.after -> 'channels')
   from platform_operator_actions a where a.action_id = 'a1330000-0000-4000-8000-000000000002'),
  'send_notification|league|b1330000-0000-4000-8000-000000000003|postponed game|1001|["in_app"]',
  'S4 ONE receipt — league scope, the reason, the recipient count, the channel set');
select is(
  (select string_agg(format('%s|%s|%s', c.message, coalesce(c.user_id::text, '-'), c.is_system), ' ; ')
   from league_chat c where c.league_id = 'b1330000-0000-4000-8000-000000000003' and c.message like 'FieldScout %'),
  'FieldScout sent this league a notice: "One past a thousand"|-|t',
  'S5 ONE league line, signed "FieldScout", no actor (never the operator''s username — Q101 (a))');
insert into r133 select 'S6', op_send_notification_internal('league', 'b1330000-0000-4000-8000-000000000003', 'One past a thousand',
  'Week 7 waivers run Thursday.', '/app/leagues/b1330000-0000-4000-8000-000000000003', array['in_app'],
  'a1330000-0000-4000-8000-000000000002', 'postponed game', '2026-10-12 16:00:00+00');
select is(format('%s|%s', r ->> 'replayed', r ->> 'recipients'), 'true|1001',
  'S6 a replayed action id returns the earlier receipt') from r133 where tag = 'S6';
select is(format('%s|%s|%s', pg_temp.notices('a1330000-0000-4000-8000-000000000002'), pg_temp.receipts(), pg_temp.lines()),
  '1001|2|2', 'S7 …and sends nothing twice: still 1001 notices, 2 receipts (P1, P2), 2 lines');
select alike(pg_temp.err($$ select op_send_notification_internal('all_users', null, 'x', null, null, array['in_app'],
  'a1330000-0000-4000-8000-000000000002', null, now()) $$),
  '22023: %already used for a different operator action%', 'S8 the same action id for another audience is refused');

-- ---------------------------------------------------------------------------
-- U. Every app user
-- ---------------------------------------------------------------------------
insert into r133 select 'U1', op_send_notification_internal('all_users', null, 'FieldScout maintenance tonight',
  null, null, array['in_app'], 'a1330000-0000-4000-8000-000000000003', null, '2026-10-12 17:00:00+00');
select is((select (r ->> 'recipients')::int from r133 where tag = 'U1') - (select n from b133 where k = 'users'), 1006,
  'U1 every app user = the baseline + the 1006 fixture users (u1–u6 + 1000), exactly');
select is(pg_temp.notices('a1330000-0000-4000-8000-000000000003'), (select (r ->> 'recipients')::int from r133 where tag = 'U1'),
  'U2 one row per recipient');
select is((select (r ->> 'pages')::int from r133 where tag = 'U1'),
  (select ((r ->> 'recipients')::int + 999) / 1000 from r133 where tag = 'U1'), 'U3 pages = ceil(recipients / 1000)');
select is(
  (select string_agg(format('%s=%s', u.k, (select count(*) from notifications n where n.user_id = u.id
           and n.data ->> 'action_id' = 'a1330000-0000-4000-8000-000000000003')), ' ' order by u.k)
   from (values ('ai', '99133000-0000-4000-8000-0000000000a1'::uuid), ('op', '99133000-0000-4000-8000-000000000004'::uuid),
                ('u5', '99133000-0000-4000-8000-000000000005'::uuid), ('u6', '99133000-0000-4000-8000-000000000006'::uuid)) u(k, id)),
  'ai=0 op=1 u5=1 u6=1', 'U4 the reserved "-ai" account gets none; league-less users and the operator get one');
select is(
  (select format('%s|%s|%s', a.scope, coalesce(a.league_id::text, '-'), a.after ->> 'audience')
   from platform_operator_actions a where a.action_id = 'a1330000-0000-4000-8000-000000000003'),
  'platform|-|all_users', 'U5 ONE platform-scoped receipt');
select is(format('%s|%s', pg_temp.lines(),
  (select count(*) from notifications n where n.data ->> 'action_id' = 'a1330000-0000-4000-8000-000000000003' and n.data ? 'league_id')),
  '2|0', 'U6 a platform notice posts no league line and carries no league id');

select alike(pg_temp.err($$ select op_send_notification_internal('all_users', null, 'FieldScout maintenance tonight',
  'A different message.', null, array['in_app'], 'a1330000-0000-4000-8000-000000000003', null, now()) $$),
  '22023: %already used for a different notice%', 'U7 R1557: the same action id for another platform notice (different body) is refused');
select is(format('%s|%s', pg_temp.notices('a1330000-0000-4000-8000-000000000003') - (select (r ->> 'recipients')::int from r133 where tag = 'U1'),
  pg_temp.receipts()), '0|3', 'U8 …and sent nothing: no extra rows, no extra receipt');

-- ---------------------------------------------------------------------------
-- L. Everyone in any league
-- ---------------------------------------------------------------------------
insert into r133 select 'L1', op_send_notification_internal('all_league_members', null, 'Waivers are paused this week',
  'A game was postponed.', null, array['in_app'], 'a1330000-0000-4000-8000-000000000004', null, '2026-10-12 18:00:00+00');
select is((select (r ->> 'recipients')::int from r133 where tag = 'L1') - (select n from b133 where k = 'members'), 1003,
  'L1 everyone in any league = the baseline + 1003 (u1, u2, u3 + 1000 bulk), exactly');
select is(pg_temp.notices('a1330000-0000-4000-8000-000000000004'), (select (r ->> 'recipients')::int from r133 where tag = 'L1'),
  'L2 one row per recipient');
select is(
  (select string_agg(format('%s=%s', u.k, (select count(*) from notifications n where n.user_id = u.id
           and n.data ->> 'action_id' = 'a1330000-0000-4000-8000-000000000004')), ' ' order by u.k)
   from (values ('op', '99133000-0000-4000-8000-000000000004'::uuid), ('u2', '99133000-0000-4000-8000-000000000002'::uuid),
                ('u5', '99133000-0000-4000-8000-000000000005'::uuid), ('u6', '99133000-0000-4000-8000-000000000006'::uuid),
                ('b1', '99133000-0000-4000-8001-000000000001'::uuid)) u(k, id)),
  'b1=1 op=0 u2=1 u5=0 u6=0',
  'L3 a member of two leagues gets ONE; the operator, a league-less user and a deleted league''s only member get none');
select is(
  (select format('%s|%s', a.scope, a.after ->> 'recipients') from platform_operator_actions a
   where a.action_id = 'a1330000-0000-4000-8000-000000000004'),
  'platform|' || (select r ->> 'recipients' from r133 where tag = 'L1'), 'L4 ONE platform receipt recording the count');
select is(format('%s|%s', pg_temp.receipts(), pg_temp.lines()), '4|2', 'L5 four sends, four receipts; only the two league sends posted lines');

-- ---------------------------------------------------------------------------
-- D. The door at the database clock (R1545: the door hands now() over)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_op();
insert into r133 select 'D1', op_send_notification('league', 'Door send', null, '/app', 'b1330000-0000-4000-8000-000000000001',
  array['in_app'], 'a1330000-0000-4000-8000-000000000005');
reset role;
select is((select r ->> 'recipients' from r133 where tag = 'D1'), '3', 'D1 the door sends to L1''s three members (the placeholder has no user)');
select is((select count(*)::int from notifications n where n.data ->> 'action_id' = 'a1330000-0000-4000-8000-000000000005'
           and n.created_at = now()), 3, 'D2 …stamped with the database clock (now())');
select is((select a.actor_id::text from platform_operator_actions a where a.action_id = 'a1330000-0000-4000-8000-000000000005'),
  '99133000-0000-4000-8000-000000000004', 'D3 …and the receipt names the operator (no identity swap)');

-- ---------------------------------------------------------------------------
-- R. Reads / writes per role on notifications
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99133000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*)::int from notifications n where n.type = 'operator_notice'), 4,
  'R1 u2 reads only their own notices (LB, all users, any league, L1)');
select alike(pg_temp.err($$ insert into notifications (user_id, type, title) values ('99133000-0000-4000-8000-000000000003', 'operator_notice', 'fake') $$),
  '42501:%', 'R2 a user cannot write a notice for someone else (no INSERT policy)');
select alike(pg_temp.err($$ update notifications set type = 'operator_notice', data = '{"from": "fieldscout"}' where user_id = '99133000-0000-4000-8000-000000000002' $$),
  '42501: permission denied%', 'R3 R1558: a user cannot relabel their OWN rows (type / data) as From FieldScout — UPDATE is read-only-column');
select alike(pg_temp.err($$ update notifications set title = 'x' $$),
  '42501: permission denied%', 'R3b …nor rewrite a title');
with u as (update notifications set read = true where type = 'operator_notice' returning 1)
insert into r133 select 'R3c', to_jsonb(count(*)) from u;
select is((select r::int from r133 where tag = 'R3c'), 4, 'R3c …but marking their own notices read still works (RETURNING count)');
select pg_temp.as_op();
select is((select count(*)::int from notifications n where n.type = 'operator_notice'), 1,
  'R4 the operator reads only their own inbox (one: every app user) — the verb is not a read door');
with d as (delete from notifications returning 1) insert into r133 select 'R5', to_jsonb(count(*)) from d;
select is((select r::int from r133 where tag = 'R5'), 0, 'R5 the operator cannot delete notices directly (RETURNING count)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from notifications), 0, 'R6 anon reads none');
reset role;

select * from finish();
rollback;
