-- ============================================================================
-- Migration 192 — the commissioner note (gap list #13; Chris 2026-10-15).
--
-- What is pinned:
--   A. form — three nullable columns on `leagues`, the FK (SET NULL), the
--      stored-shape CHECK, the door (DEFINER, search_path '', anon refused)
--      over a PLAIN triple-REVOKEd internal; the `leagues` policies are
--      unchanged (one SELECT policy, no write policy — never weakened).
--   B. who may write — the commissioner and a co-commissioner may; a
--      manager, a non-member, another league's commissioner and anon may not
--      (42501, nothing written).
--   C–F. set / update / same-again / clear — the stored row, ONE receipt per
--      real change (set_league_note, {note} before/after — a clear included),
--      none for a no-op; on a set or an edit, every OTHER member with an
--      account gets exactly one unread `league_commissioner_note` (an unread
--      one is replaced, a read one is not touched), the author and
--      placeholder seats get none. A clear notifies NOBODY (Chris
--      2026-10-16) and withdraws the league's still-unread note
--      notifications; read ones, and another league's, are left alone.
--   G. the length cap — 500 after trimming (501 → 22023), and the reason's.
--   H. reads — a member reads the note, a non-member and anon read no row;
--      nobody (the commissioner included) can write the columns directly.
--   I. a soft-deleted league is "no such league" (42501).
--
-- Determinism: fixed UUIDs and literals; the verb runs as each caller via
-- request.jwt.claims (auth.uid()); one transaction, so now() is one instant.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(64);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', column_name, data_type, is_nullable), ' ' order by column_name)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'leagues' and column_name like 'commissioner_note%'),
  'commissioner_note:text:YES commissioner_note_updated_at:timestamp with time zone:YES commissioner_note_updated_by:uuid:YES',
  'A1 leagues gains commissioner_note / _updated_at / _updated_by, all nullable (NULL = no note)');
select is(
  (select format('%s→%s:%s', a.attname, c.confrelid::regclass, c.confdeltype)
   from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.conname = 'leagues_commissioner_note_updated_by_fkey'),
  'commissioner_note_updated_by→profiles:n',
  'A2 _updated_by references profiles ON DELETE SET NULL');
select ok(
  exists (select 1 from pg_constraint where conname = 'leagues_commissioner_note_shape' and contype = 'c'),
  'A3 the stored-shape CHECK exists');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.oid = 'public.commish_set_league_note_internal(uuid,text,timestamptz,text)'::regprocedure)
  and not has_function_privilege('anon', 'public.commish_set_league_note_internal(uuid,text,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_set_league_note_internal(uuid,text,timestamptz,text)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.commish_set_league_note_internal(uuid,text,timestamptz,text)'::regprocedure
      and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'A4 the internal is PLAIN, search_path='''', REVOKEd from PUBLIC, anon and authenticated');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.oid = 'public.commish_set_league_note(uuid,text,text)'::regprocedure)
  and not has_function_privilege('anon', 'public.commish_set_league_note(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_set_league_note(uuid,text,text)', 'EXECUTE')
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('commish_set_league_note', 'commish_set_league_note_internal')) = 2,
  'A5 the door is SECURITY DEFINER with search_path='''', anon refused, authenticated may call (the in-body gate decides), one overload each');
select is(
  (select string_agg(format('%s/%s', policyname, cmd), ' ' order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'leagues'),
  'Leagues viewable by members/SELECT',
  'A6 leagues policies unchanged — ONE SELECT policy for members, NO write policy (§12.1 v2.8.2, never weakened)');

-- ---------------------------------------------------------------------------
-- Fixtures: users n1..n6, league L1 (n1 commissioner, n2 co-commissioner,
-- n3 / n4 managers, one placeholder seat), league L2 (n5 its commissioner),
-- league L3 soft-deleted (n1 commissioner). n6 is in no league.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('d9200000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-cnote' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'cnote_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i;

insert into leagues (id, owner_id, name, season, status) values
  ('e9200000-0000-4000-8000-000000000001', 'd9200000-0000-4000-8000-000000000001', 'pgtap-cnote-L1', 2026, 'setup'),
  ('e9200000-0000-4000-8000-000000000002', 'd9200000-0000-4000-8000-000000000005', 'pgtap-cnote-L2', 2026, 'setup'),
  ('e9200000-0000-4000-8000-000000000003', 'd9200000-0000-4000-8000-000000000001', 'pgtap-cnote-L3', 2026, 'setup');

insert into league_members (league_id, user_id, role, is_placeholder) values
  ('e9200000-0000-4000-8000-000000000001', 'd9200000-0000-4000-8000-000000000001', 'commissioner', false),
  ('e9200000-0000-4000-8000-000000000001', 'd9200000-0000-4000-8000-000000000002', 'co_commissioner', false),
  ('e9200000-0000-4000-8000-000000000001', 'd9200000-0000-4000-8000-000000000003', 'manager', false),
  ('e9200000-0000-4000-8000-000000000001', 'd9200000-0000-4000-8000-000000000004', 'manager', false),
  ('e9200000-0000-4000-8000-000000000001', null, 'manager', true),
  ('e9200000-0000-4000-8000-000000000002', 'd9200000-0000-4000-8000-000000000005', 'commissioner', false),
  ('e9200000-0000-4000-8000-000000000003', 'd9200000-0000-4000-8000-000000000001', 'commissioner', false);

update leagues set deleted_at = now() where id = 'e9200000-0000-4000-8000-000000000003';

-- How many note notifications / receipts this suite's league holds.
create function pg_temp.note_rows(p_user uuid) returns int language sql as $f$
  select count(*)::int from public.notifications
  where user_id = p_user and type = 'league_commissioner_note' and data ->> 'league_id' = 'e9200000-0000-4000-8000-000000000001'
$f$;
create function pg_temp.receipts() returns int language sql as $f$
  select count(*)::int from public.commissioner_actions
  where league_id = 'e9200000-0000-4000-8000-000000000001' and action_type = 'set_league_note'
$f$;

-- ---------------------------------------------------------------------------
-- B. Who may NOT write (42501, nothing written)
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select commish_set_league_note('e9200000-0000-4000-8000-000000000001', 'anon note') $$,
  '42501', null, 'B1 anon cannot call the door (42501 — no EXECUTE)');
reset role;

select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok($$ select commish_set_league_note('e9200000-0000-4000-8000-000000000001', 'manager note') $$,
  '42501', 'commish_set_league_note: only this league''s commissioner or a co-commissioner can change the commissioner note',
  'B2 a MANAGER of the league is refused (42501, by name)');
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_ok($$ select commish_set_league_note('e9200000-0000-4000-8000-000000000001', 'stranger note') $$,
  '42501', null, 'B3 a NON-member is refused (42501)');
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok($$ select commish_set_league_note('e9200000-0000-4000-8000-000000000001', 'other commish note') $$,
  '42501', null, 'B4 ANOTHER league''s commissioner is refused (42501)');
select throws_ok($$ select commish_set_league_note('e9200000-0000-4000-8000-0000000000ff', 'no league') $$,
  '42501', null, 'B5 a league that does not exist reads the same no-leak 42501');
select set_config('request.jwt.claims', '', true);
select ok(
  (select commissioner_note is null and commissioner_note_updated_at is null and commissioner_note_updated_by is null
   from leagues where id = 'e9200000-0000-4000-8000-000000000001'),
  'B6 the refused calls wrote nothing — no note, no who, no when');
select is(
  (select pg_temp.receipts() + (select count(*)::int from notifications where type = 'league_commissioner_note'
     and data ->> 'league_id' = 'e9200000-0000-4000-8000-000000000001')),
  0, 'B7 …and no receipt and no notification');

-- ---------------------------------------------------------------------------
-- C. The commissioner sets it
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table cn_c as
  select commish_set_league_note('e9200000-0000-4000-8000-000000000001', E'  \n Trade deadline is Nov 24\t ') as r;
select set_config('request.jwt.claims', '', true);

select is((select r ->> 'note' from cn_c), 'Trade deadline is Nov 24', 'C1 the result carries the TRIMMED note');
select is((select format('%s|%s|%s', r ->> 'no_changes', r ->> 'cleared', r ->> 'notified') from cn_c), 'false|false|3',
  'C2 a real change, not a clear, three members notified (n2, n3, n4)');
select is(
  (select format('%s|%s|%s', commissioner_note, commissioner_note_updated_by, commissioner_note_updated_at = now())
   from leagues where id = 'e9200000-0000-4000-8000-000000000001'),
  'Trade deadline is Nov 24|d9200000-0000-4000-8000-000000000001|t',
  'C3 stored: the trimmed note, who set it, when (the transaction instant)');
select is(pg_temp.receipts(), 1, 'C4 exactly ONE receipt');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', actor_id, target_type, target_id, before, after, reason is null, metadata ->> 'cleared')
   from commissioner_actions where league_id = 'e9200000-0000-4000-8000-000000000001' and action_type = 'set_league_note'),
  'd9200000-0000-4000-8000-000000000001|league|e9200000-0000-4000-8000-000000000001|{"note": null}|{"note": "Trade deadline is Nov 24"}|t|false',
  'C5 the receipt: the actor, the league as target, {note} before/after, no reason (optional, Q66)');
select is((select r ->> 'commissioner_action_id' from cn_c),
  (select id::text from commissioner_actions where league_id = 'e9200000-0000-4000-8000-000000000001' and action_type = 'set_league_note'),
  'C6 the result names its receipt');
select is(
  (select string_agg(format('%s:%s', u.raw_user_meta_data ->> 'username', pg_temp.note_rows(u.id)), ' ' order by u.id)
   from auth.users u where u.id::text like 'd9200000-%'),
  'cnote_user1:0 cnote_user2:1 cnote_user3:1 cnote_user4:1 cnote_user5:0 cnote_user6:0',
  'C7 one notification each for the OTHER members (n2, n3, n4); none for the author, another league''s commissioner or a stranger');
select is(
  (select format('%s|%s|%s|%s|%s', title, body, read, data ->> 'actor_id', created_at = now())
   from notifications where user_id = 'd9200000-0000-4000-8000-000000000003' and type = 'league_commissioner_note'),
  'Commissioner note updated|Trade deadline is Nov 24|f|d9200000-0000-4000-8000-000000000001|t',
  'C8 the row: "Commissioner note updated", the note as the body, unread, who wrote it');
select is(
  (select data ->> 'league_id' from notifications where user_id = 'd9200000-0000-4000-8000-000000000003' and type = 'league_commissioner_note'),
  'e9200000-0000-4000-8000-000000000001',
  'C9 data.league_id is the league — the link to the league home');

-- ---------------------------------------------------------------------------
-- D. The co-commissioner updates it; an unread notification is replaced
-- ---------------------------------------------------------------------------
-- n4 has read the first one: a read row is history and is never rewritten.
update notifications set read = true
 where user_id = 'd9200000-0000-4000-8000-000000000004' and type = 'league_commissioner_note';

select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
create temp table cn_d as
  select commish_set_league_note('e9200000-0000-4000-8000-000000000001', E'Dues by Friday.\nVenmo @chris', 'typo fix') as r;
select set_config('request.jwt.claims', '', true);

select is((select format('%s|%s', r ->> 'note', r ->> 'previous_note') from cn_d),
  E'Dues by Friday.\nVenmo @chris|Trade deadline is Nov 24',
  'D1 a CO-COMMISSIONER can change it (same powers, §4) — inner line breaks kept');
select is((select commissioner_note_updated_by::text from leagues where id = 'e9200000-0000-4000-8000-000000000001'),
  'd9200000-0000-4000-8000-000000000002', 'D2 …and is recorded as the one who did');
select is(pg_temp.receipts(), 2, 'D3 a second receipt');
select is(
  (select format('%s|%s|%s', before ->> 'note', after ->> 'note', reason) from commissioner_actions
   where league_id = 'e9200000-0000-4000-8000-000000000001' and action_type = 'set_league_note' and actor_id = 'd9200000-0000-4000-8000-000000000002'),
  E'Trade deadline is Nov 24|Dues by Friday.\nVenmo @chris|typo fix',
  'D4 …before/after the two notes, with the reason given');
select is((select r ->> 'notified' from cn_d), '3', 'D5 three notified (n1, n3, n4 — the author n2 is not)');
select is(
  (select string_agg(format('%s:%s/%s', u.raw_user_meta_data ->> 'username', pg_temp.note_rows(u.id),
     (select count(*) from notifications n where n.user_id = u.id and n.type = 'league_commissioner_note' and not n.read)), ' ' order by u.id)
   from auth.users u where u.id::text like 'd9200000-%' and u.id::text < 'd9200000-0000-4000-8000-000000000005'),
  'cnote_user1:1/1 cnote_user2:1/1 cnote_user3:1/1 cnote_user4:2/1',
  'D6 rows/unread: n1 gets its first; n3''s unread one is REPLACED (still one); n4 read the old one, so gets a new one; the author n2''s old one is left alone');
select is(
  (select body from notifications where user_id = 'd9200000-0000-4000-8000-000000000003' and type = 'league_commissioner_note'),
  'Dues by Friday. Venmo @chris',
  'D7 n3''s replaced row carries the new note, line breaks folded to spaces for the bell');
select is(
  (select body from notifications where user_id = 'd9200000-0000-4000-8000-000000000004' and type = 'league_commissioner_note' and read),
  'Trade deadline is Nov 24',
  'D8 n4''s READ row is untouched');

-- ---------------------------------------------------------------------------
-- E. The same note again is a no-op
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table cn_e as
  select commish_set_league_note('e9200000-0000-4000-8000-000000000001', E' Dues by Friday.\nVenmo @chris \n') as r;
select set_config('request.jwt.claims', '', true);
select is((select format('%s|%s|%s', r ->> 'no_changes', r ->> 'no_changes_why', coalesce(r ->> 'commissioner_action_id', 'none')) from cn_e),
  'true|the note already says exactly this|none', 'E1 the same note (after trimming) is a no-op, and says why');
select is(pg_temp.receipts(), 2, 'E2 …no receipt');
select is((select count(*)::int from notifications where type = 'league_commissioner_note'
   and data ->> 'league_id' = 'e9200000-0000-4000-8000-000000000001'), 5, 'E3 …no notification');
select is((select commissioner_note_updated_by::text from leagues where id = 'e9200000-0000-4000-8000-000000000001'),
  'd9200000-0000-4000-8000-000000000002', 'E4 …and the note still reads as the co-commissioner''s');

-- ---------------------------------------------------------------------------
-- F. Clearing it — a receipt, no notification, the unread ones withdrawn
-- ---------------------------------------------------------------------------
-- Rows going in (D): n1, n2, n3 each one unread; n4 one read + one unread.
-- And n3 holds an unread note notification from ANOTHER league, which a
-- clear here must not touch.
insert into notifications (user_id, type, title, body, data, read)
values ('d9200000-0000-4000-8000-000000000003', 'league_commissioner_note', 'Commissioner note updated', 'Other league note',
  '{"league_id": "e9200000-0000-4000-8000-000000000002"}', false);

select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table cn_f as
  select commish_set_league_note('e9200000-0000-4000-8000-000000000001', E' \t\n ') as r;
select set_config('request.jwt.claims', '', true);
select is((select format('%s|%s|%s|%s|%s', coalesce(r ->> 'note', 'none'), r ->> 'cleared', r ->> 'notified', r ->> 'notified_why', r ->> 'withdrawn') from cn_f),
  'none|true|0|clearing the note notifies nobody|4',
  'F1 a blank note CLEARS it — and notifies NOBODY (Chris 2026-10-16); the league''s four unread note notifications are withdrawn');
select is(
  (select format('%s|%s', coalesce(commissioner_note, 'none'), commissioner_note_updated_by) from leagues where id = 'e9200000-0000-4000-8000-000000000001'),
  'none|d9200000-0000-4000-8000-000000000001', 'F2 stored: no note, cleared by the commissioner');
select is(pg_temp.receipts(), 3, 'F3 a clear is still a real change — one receipt');
select is(
  (select format('%s|%s|%s', before ->> 'note', coalesce(after ->> 'note', 'null'), metadata ->> 'cleared') from commissioner_actions
   where league_id = 'e9200000-0000-4000-8000-000000000001' and action_type = 'set_league_note' and metadata ->> 'cleared' = 'true'),
  E'Dues by Friday.\nVenmo @chris|null|true', 'F4 …recording what was cleared');
select is(
  (select string_agg(format('%s:%s/%s', u.raw_user_meta_data ->> 'username', pg_temp.note_rows(u.id),
     (select count(*) from notifications n where n.user_id = u.id and n.type = 'league_commissioner_note' and not n.read
        and n.data ->> 'league_id' = 'e9200000-0000-4000-8000-000000000001')), ' ' order by u.id)
   from auth.users u where u.id::text like 'd9200000-%' and u.id::text < 'd9200000-0000-4000-8000-000000000005'),
  'cnote_user1:0/0 cnote_user2:0/0 cnote_user3:0/0 cnote_user4:1/0',
  'F5 rows/unread: no new row for anyone, and every still-UNREAD note notification for the league is gone (the author n1''s too) — only n4''s READ one is left');
select is(
  (select format('%s|%s|%s', title, body, read) from notifications
   where user_id = 'd9200000-0000-4000-8000-000000000004' and type = 'league_commissioner_note'
     and data ->> 'league_id' = 'e9200000-0000-4000-8000-000000000001'),
  'Commissioner note updated|Trade deadline is Nov 24|t',
  'F6 n4''s READ row is untouched — a read notification is history');
select is(
  (select format('%s|%s', body, read) from notifications
   where user_id = 'd9200000-0000-4000-8000-000000000003' and type = 'league_commissioner_note'
     and data ->> 'league_id' = 'e9200000-0000-4000-8000-000000000002'),
  'Other league note|f',
  'F7 n3''s unread note notification from ANOTHER league is untouched — the withdrawal is this league''s only');
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select format('%s|%s|%s|%s', r ->> 'no_changes', r ->> 'no_changes_why', r ->> 'notified', r ->> 'withdrawn')
   from (select commish_set_league_note('e9200000-0000-4000-8000-000000000001', null) r) x),
  'true|there was no note to clear|0|0', 'F8 clearing an empty note is a no-op, and says why');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.receipts(), 3, 'F9 …no receipt');
select is(
  (select count(*)::int from notifications where type = 'league_commissioner_note'
     and data ->> 'league_id' = 'e9200000-0000-4000-8000-000000000001'),
  1, 'F10 …and no notification — the league still holds only n4''s read row');

-- ---------------------------------------------------------------------------
-- G. The length cap
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(format($$ select commish_set_league_note('e9200000-0000-4000-8000-000000000001', %L) $$, repeat('x', 501)),
  '22023', 'commish_set_league_note: the note is 501 characters — keep it to 500 or fewer',
  'G1 501 characters is refused (22023, by name)');
select throws_ok(format($$ select commish_set_league_note('e9200000-0000-4000-8000-000000000001', 'ok', %L) $$, repeat('r', 501)),
  '22023', null, 'G2 a 501-character reason is refused (22023)');
select is(pg_temp.receipts(), 3, 'G3 the refusals wrote no receipt');
select is(
  (select r ->> 'cleared' from (select commish_set_league_note('e9200000-0000-4000-8000-000000000001', '  ' || repeat('y', 500) || E'\n') r) x),
  'false', 'G4 exactly 500 characters (whitespace around it trimmed first) is accepted');
select set_config('request.jwt.claims', '', true);
select is((select char_length(commissioner_note) from leagues where id = 'e9200000-0000-4000-8000-000000000001'), 500,
  'G5 …and stored at 500');
select is(
  (select body from notifications where user_id = 'd9200000-0000-4000-8000-000000000003' and type = 'league_commissioner_note' and not read
     and data ->> 'league_id' = 'e9200000-0000-4000-8000-000000000001'),
  repeat('y', 159) || '…', 'G6 the bell shows the first 159 characters and an ellipsis');
select throws_ok($$ update leagues set commissioner_note = ' padded' where id = 'e9200000-0000-4000-8000-000000000002' $$,
  '23514', null, 'G7 the CHECK refuses an untrimmed note on any path (even the table owner)');
select throws_ok(format($$ update leagues set commissioner_note = %L where id = 'e9200000-0000-4000-8000-000000000002' $$, repeat('z', 501)),
  '23514', null, 'G8 …and one over 500');

-- ---------------------------------------------------------------------------
-- H. Reads and direct writes, per role
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is((select char_length(commissioner_note) from leagues where id = 'e9200000-0000-4000-8000-000000000001'), 500,
  'H1 a MEMBER (manager) reads the note');
select is((select count(*)::int from commissioner_actions where league_id = 'e9200000-0000-4000-8000-000000000001' and action_type = 'set_league_note'), 4,
  'H2 …and every receipt (the league activity read — member-readable, §12.12)');
select results_eq($$ with u as (update leagues set commissioner_note = 'hijack' where id = 'e9200000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'H3 …but cannot write the note directly (0 rows — no UPDATE policy)');
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq($$ with u as (update leagues set commissioner_note = 'direct', commissioner_note_updated_by = null where id = 'e9200000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'H4 the COMMISSIONER cannot write it directly either (0 rows) — the audited door is the only way');
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select is((select count(*)::int from leagues where id = 'e9200000-0000-4000-8000-000000000001'), 0,
  'H5 a NON-member reads no row — so no note');
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is((select count(*)::int from leagues where id = 'e9200000-0000-4000-8000-000000000001'), 0,
  'H6 another league''s commissioner reads no row');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from leagues where id = 'e9200000-0000-4000-8000-000000000001'), 0, 'H7 anon reads no row');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select char_length(commissioner_note) from leagues where id = 'e9200000-0000-4000-8000-000000000001'), 500,
  'H8 the direct-write attempts changed nothing');

-- The audit log stays immutable (123's trigger) — a note receipt is no exception.
select throws_ok($$ update commissioner_actions set reason = 'rewritten'
                    where league_id = 'e9200000-0000-4000-8000-000000000001' and action_type = 'set_league_note' $$,
  null, null, 'H9 a note receipt cannot be rewritten (the audit log''s immutability trigger)');

-- ---------------------------------------------------------------------------
-- I. A soft-deleted league
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "d9200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select commish_set_league_note('e9200000-0000-4000-8000-000000000003', 'too late') $$,
  '42501', null, 'I1 a soft-deleted league is "no such league" — its own commissioner is refused (42501)');
select set_config('request.jwt.claims', '', true);
select is((select commissioner_note from leagues where id = 'e9200000-0000-4000-8000-000000000003'), null,
  'I2 …and nothing was written');

-- The receipts read as the activity line's words expect: one per real change.
select is(
  (select string_agg(coalesce(after ->> 'note', '(cleared)'), ' | ' order by coalesce(after ->> 'note', '(cleared)') collate "C")
   from commissioner_actions
   where league_id = 'e9200000-0000-4000-8000-000000000001' and action_type = 'set_league_note' and after ->> 'note' is distinct from repeat('y', 500)),
  E'(cleared) | Dues by Friday.\nVenmo @chris | Trade deadline is Nov 24',
  'J1 one receipt per real change — the set, the update and the clear (beside the 500-character set); none for the no-ops or refusals');

select * from finish();
rollback;
