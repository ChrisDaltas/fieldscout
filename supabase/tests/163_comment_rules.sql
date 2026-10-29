-- ============================================================================
-- 163 — comment rules (migration 213; Community launch plan C2; readiness
--       S2, S4, S15)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — remove_list_comment DEFINER + search_path '' + EXECUTE
--       authenticated only; the two trigger functions DEFINER, search_path
--       '', closed to anon / authenticated; the triggers are BEFORE / AFTER
--       INSERT ROW on list_comments; anon / authenticated hold no UPDATE on
--       list_comments (table or any column) and keep SELECT / INSERT; the
--       three new buckets' numbers (golden) and the CHECK's six.
--   §U  NO CLIENT UPDATE — author, list owner and anon cannot edit,
--       backdate, move or restore a comment; the row is byte-unchanged.
--   §R  REMOVE — anon cannot run it; no uid / a stranger / a missing, moved
--       or already-removed comment are refused by name (P0002 / 42501), never
--       answered done; the author, the list's owner and a platform operator
--       each remove (removed_as golden); only deleted_at / updated_at change.
--   §S  READS — a removed comment is hidden from anon, the list's owner and
--       its author alike; private and comments-off lists keep their rules;
--       the service role still reads removed rows.
--   §N  THE ALERT — the owner gets one list_comment alert (golden title and
--       data); a newer comment refreshes the unread one; never for his own
--       comment; once read, the next comment is a new alert; one per list;
--       the commenter gets none; a comment born removed (server write)
--       raises none.
--   §L  THE LIMIT — a person's 6th comment in 60 s is refused with SQLSTATE
--       PGRST + PostgREST's 429 / Retry-After envelope (golden), nothing
--       posted, no alert; the allowance is the person's across lists; the
--       window frees a slot at 60 s exactly; another person is unaffected;
--       a comment RLS refuses spends nothing; service-role writes are never
--       limited nor stamped; a client comment is stamped now and live; the
--       client door still refuses the new buckets by name (159 K6b's rule).
-- Break probes (shown in the PR, reverted): (1) `deleted_at IS NULL`
-- dropped from the SELECT policy ⇒ S red; (2) GRANT UPDATE back to
-- authenticated ⇒ U red; (3) the notify trigger's own-comment clause removed
-- ⇒ N red.
-- World: u1 owns L1 (public, comments on), L2 (private), L3 (public,
-- comments off), L4 (public, comments on). u2 and u5 comment; u3 is a
-- stranger (and the flooder in §L); u4 is a platform operator.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(67);

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.err(text) to anon, authenticated, service_role;

-- A statement's result (first column of the first row) as text, or its error.
create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.val(text) to anon, authenticated, service_role;

create function pg_temp.detail_of(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v;
end;
$$;
grant execute on function pg_temp.detail_of(text) to authenticated;

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('remove_list_comment', 'list_comment_insert_guard_internal', 'list_comment_notify_owner_internal')),
  'list_comment_insert_guard_internal=t:search_path="":f:f list_comment_notify_owner_internal=t:search_path="":f:f '
  || 'remove_list_comment=t:search_path="":f:t',
  'A1 the RPC DEFINER + search_path '''' + authenticated only; both trigger functions DEFINER, closed');
select is(
  (select string_agg(format('%s:%s:%s', t.tgname, t.tgtype, p.proname), ' ' order by t.tgname)
   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.list_comments'::regclass and not t.tgisinternal),
  'tr_list_comments_insert_guard:7:list_comment_insert_guard_internal tr_list_comments_notify_owner:5:list_comment_notify_owner_internal',
  'A2 exactly two triggers: the guard BEFORE INSERT ROW (7), the alert AFTER INSERT ROW (5)');
select is(
  (select string_agg(format('%s=update:%s,anycol:%s,select:%s,insert:%s', r,
            has_table_privilege(r, 'public.list_comments', 'UPDATE')::text,
            has_any_column_privilege(r, 'public.list_comments', 'UPDATE')::text,
            has_table_privilege(r, 'public.list_comments', 'SELECT')::text,
            has_table_privilege(r, 'public.list_comments', 'INSERT')::text), ' ' order by r)
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon=update:false,anycol:false,select:true,insert:true '
  || 'authenticated=update:false,anycol:false,select:true,insert:true '
  || 'service_role=update:true,anycol:true,select:true,insert:true',
  'A3 no client UPDATE on list_comments, table or column; SELECT / INSERT stay (RLS is the gate); the service role keeps UPDATE');
select is(
  (select string_agg(format('%s=%s/%s', b, r.max_hits, r.window_ms), ' ' order by b)
   from unnest(array['ask', 'bid', 'chat', 'comment', 'mutation', 'report']) b, lateral public.rate_limit_rule_internal(b) r),
  'ask=10/3600000 bid=5/1000 chat=5/10000 comment=5/60000 mutation=10/10000 report=10/3600000',
  'A4 the numbers, golden: comment 5 a minute, report and ask 10 an hour; 209''s three unchanged');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.rate_limit_hits'::regclass and c.conname = 'rate_limit_hits_bucket_known'),
  'CHECK ((bucket = ANY (ARRAY[''chat''::text, ''mutation''::text, ''bid''::text, ''comment''::text, ''report''::text, ''ask''::text])))',
  'A5 the bucket CHECK names exactly the six buckets');

-- ---------------------------------------------------------------------------
-- World (seeded as the table owner: no uid, so no limit and no stamping)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, ('99163000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x163-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, json_build_object('username', 'x163_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;
update profiles set is_admin = true where id = '99163000-0000-4000-8000-000000000004';

insert into lists (id, owner_id, title, slug, is_private, comments_enabled) values
  ('a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000001', 'x163 Public',  'x163-public',  false, true),
  ('a1630000-0000-4000-8000-000000000002', '99163000-0000-4000-8000-000000000001', 'x163 Private', 'x163-private', true,  true),
  ('a1630000-0000-4000-8000-000000000003', '99163000-0000-4000-8000-000000000001', 'x163 Off',     'x163-off',     false, false),
  ('a1630000-0000-4000-8000-000000000004', '99163000-0000-4000-8000-000000000001', 'x163 Second',  'x163-second',  false, true);

insert into list_comments (id, list_id, author_id, body, created_at, deleted_at) values
  ('c1630000-0000-4000-8000-0000000000a1', 'a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000002', 'seed a', '2096-01-01 00:00:00+00', null),
  ('c1630000-0000-4000-8000-0000000000a2', 'a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000005', 'seed b', '2096-01-01 00:01:00+00', null),
  ('c1630000-0000-4000-8000-0000000000a3', 'a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000002', 'seed c', '2096-01-01 00:02:00+00', null),
  ('c1630000-0000-4000-8000-0000000000a4', 'a1630000-0000-4000-8000-000000000002', '99163000-0000-4000-8000-000000000001', 'private own', '2096-01-01 00:03:00+00', null),
  ('c1630000-0000-4000-8000-0000000000a5', 'a1630000-0000-4000-8000-000000000003', '99163000-0000-4000-8000-000000000002', 'off list', '2096-01-01 00:04:00+00', null),
  ('c1630000-0000-4000-8000-0000000000a6', 'a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000005', 'seed f', '2096-01-01 00:05:00+00', null),
  ('c1630000-0000-4000-8000-0000000000a7', 'a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000002', 'pre-removed', '2096-01-01 00:06:00+00', '2096-01-02 00:00:00+00');

select is(
  (select string_agg(format('%s:%s:%s', body, created_at, deleted_at is not null), ' | ' order by id)
   from list_comments where id in ('c1630000-0000-4000-8000-0000000000a1', 'c1630000-0000-4000-8000-0000000000a7')),
  'seed a:2096-01-01 00:00:00+00:f | pre-removed:2096-01-01 00:06:00+00:t',
  'L0 a write with no uid (the server) is neither limited nor stamped: its created_at and deleted_at stand');
select is(
  (select format('owner=%s writer=%s', count(*) filter (where user_id = '99163000-0000-4000-8000-000000000001'),
                 count(*) filter (where user_id <> '99163000-0000-4000-8000-000000000001'))
   from notifications where type = 'list_comment'
     and user_id in (select ('99163000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 5) i)),
  'owner=2 writer=0',
  'N0 the seeds alerted the owner once per list with comments by others (L1 and L3; the pre-removed comment and his own on L2 raise none)');
-- Start §N from a clean slate.
delete from notifications where user_id in (select ('99163000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 5) i);

-- ---------------------------------------------------------------------------
-- U. No client UPDATE — nobody edits, backdates, moves or restores
-- ---------------------------------------------------------------------------
create temp table _before as select * from list_comments where id::text like 'c1630000-%';
grant select on _before to authenticated;

select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$update list_comments set body = 'edited' where id = 'c1630000-0000-4000-8000-0000000000a1'$$),
  '42501: permission denied for table list_comments', 'U1 the author cannot edit his comment');
select is(pg_temp.err($$update list_comments set created_at = '2000-01-01' where id = 'c1630000-0000-4000-8000-0000000000a1'$$),
  '42501: permission denied for table list_comments', 'U2 …nor backdate it');
select is(pg_temp.err($$update list_comments set list_id = 'a1630000-0000-4000-8000-000000000003' where id = 'c1630000-0000-4000-8000-0000000000a1'$$),
  '42501: permission denied for table list_comments', 'U3 …nor move it to another list');
select is(pg_temp.err($$update list_comments set deleted_at = null where id = 'c1630000-0000-4000-8000-0000000000a7'$$),
  '42501: permission denied for table list_comments', 'U4 …nor bring back a removed one');
reset role;
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$update list_comments set author_id = '99163000-0000-4000-8000-000000000003', body = 'rewritten'
                        where id = 'c1630000-0000-4000-8000-0000000000a2'$$),
  '42501: permission denied for table list_comments', 'U5 the list''s owner cannot rewrite a comment on his list (or who it is from)');
select is(pg_temp.err($$update list_comments set deleted_at = now() where id = 'c1630000-0000-4000-8000-0000000000a2'$$),
  '42501: permission denied for table list_comments', 'U6 …and even a soft-delete by UPDATE is gone — removal is the RPC''s alone');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select is(pg_temp.err($$update list_comments set body = 'x' where id = 'c1630000-0000-4000-8000-0000000000a1'$$),
  '42501: permission denied for table list_comments', 'U7 anon cannot UPDATE either');
select is(pg_temp.val($$with x as (delete from list_comments where id = 'c1630000-0000-4000-8000-0000000000a1' returning 1) select count(*) from x$$),
  '0', 'U8 …and a hard DELETE removes nothing (no DELETE policy; 001 unchanged)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*)::int from list_comments c join _before b using (id)
   where (c.list_id, c.author_id, c.body, c.parent_id, c.deleted_at, c.created_at, c.updated_at)
         is not distinct from (b.list_id, b.author_id, b.body, b.parent_id, b.deleted_at, b.created_at, b.updated_at)),
  7, 'U9 all seven comments are byte-unchanged');

-- ---------------------------------------------------------------------------
-- R. remove_list_comment
-- ---------------------------------------------------------------------------
set local role anon;
select alike(pg_temp.err($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000a1')$$),
  '42501: permission denied for function remove_list_comment%', 'R1 anon cannot run the RPC');
reset role;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000a1')$$),
  '42501: Sign in to remove a comment.', 'R2 a JWT with no user is refused by name');
reset role;
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000a1')$$),
  '42501: You can only remove your own comments, or comments on your own list.', 'R3 a stranger is refused by name');
select is(pg_temp.err($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000ff')$$),
  'P0002: That comment isn''t there — it may already have been removed.', 'R4 a comment that does not exist: P0002, never "done"');
reset role;
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select remove_list_comment('a1630000-0000-4000-8000-000000000004', 'c1630000-0000-4000-8000-0000000000a1')$$),
  'P0002: That comment isn''t there — it may already have been removed.', 'R5 the right comment under the wrong list: P0002');
select is(pg_temp.err($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000a7')$$),
  'P0002: That comment isn''t there — it may already have been removed.', 'R6 an already-removed comment: P0002');
select is(pg_temp.val($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000a1') - 'removed_at'$$),
  '{"list_id": "a1630000-0000-4000-8000-000000000001", "comment_id": "c1630000-0000-4000-8000-0000000000a1", "removed_as": "author"}',
  'R7 the author removes his own comment (golden answer)');
select is(pg_temp.err($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000a1')$$),
  'P0002: That comment isn''t there — it may already have been removed.', 'R8 …and a second try says so — no silent OK');
select is(pg_temp.val($$select remove_list_comment('a1630000-0000-4000-8000-000000000003', 'c1630000-0000-4000-8000-0000000000a5') ->> 'removed_as'$$),
  'author', 'R9 an author can remove his comment on a list whose comments are now off');
reset role;
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000a2') ->> 'removed_as'$$),
  'list_owner', 'R10 the list''s owner removes someone else''s comment on his list');
reset role;
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select remove_list_comment('a1630000-0000-4000-8000-000000000001', 'c1630000-0000-4000-8000-0000000000a6') ->> 'removed_as'$$),
  'operator', 'R11 a platform operator removes a comment that is neither his nor on his list');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select string_agg(format('%s:%s', (c.id = b.id)::text, (c.deleted_at is not null)::text), ' ' order by c.id)
   from list_comments c join _before b using (id)
   where (c.list_id, c.author_id, c.body, c.parent_id, c.created_at) is not distinct from (b.list_id, b.author_id, b.body, b.parent_id, b.created_at)
     and c.id in ('c1630000-0000-4000-8000-0000000000a1', 'c1630000-0000-4000-8000-0000000000a2',
                  'c1630000-0000-4000-8000-0000000000a5', 'c1630000-0000-4000-8000-0000000000a6')),
  'true:true true:true true:true true:true',
  'R12 the four removals set deleted_at and changed nothing else (list, author, body, parent, created_at)');
select is(
  (select count(*)::int from list_comments where id::text like 'c1630000-%' and deleted_at is not null and updated_at = deleted_at),
  4, 'R13 …and stamped updated_at with the removal (the pre-removed seed keeps its own)');
select is(
  (select string_agg(id::text, ' ' order by id) from list_comments where id::text like 'c1630000-%' and deleted_at is null),
  'c1630000-0000-4000-8000-0000000000a3 c1630000-0000-4000-8000-0000000000a4',
  'R14 the refused calls removed nothing: the two comments nobody removed are still live');

-- ---------------------------------------------------------------------------
-- S. Reads — a removed comment is hidden from every reader
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select is(pg_temp.val($$select string_agg(body, ',' order by body) from list_comments where list_id = 'a1630000-0000-4000-8000-000000000001'$$),
  'seed c', 'S1 anon sees only the live comment on a public list');
select is(pg_temp.val($$select count(*) from list_comments where list_id in ('a1630000-0000-4000-8000-000000000002', 'a1630000-0000-4000-8000-000000000003')$$),
  '0', 'S2 …and nothing on the private list or the comments-off list (001''s rules hold)');
reset role;
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select string_agg(body, ',' order by body) from list_comments where list_id::text like 'a1630000-%'$$),
  'private own,seed c', 'S3 the list''s owner sees his lists'' live comments only — not the three removed on L1 nor the one on L3');
reset role;
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select string_agg(body, ',' order by body) from list_comments where author_id = '99163000-0000-4000-8000-000000000002'$$),
  'seed c', 'S4 the author no longer sees his own removed comments (seed a, pre-removed, off list)');
select is(pg_temp.val($$select count(*) from lists l, lateral (select count(*) c from list_comments lc where lc.list_id = l.id) x
                       where l.id = 'a1630000-0000-4000-8000-000000000001' and x.c = 1$$),
  '1', 'S5 a count over a list''s comments counts live comments only');
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(pg_temp.val($$select count(*) from list_comments where id::text like 'c1630000-%' and deleted_at is not null$$),
  '5', 'S6 the service role (admin pages) still reads removed comments');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- N. The new-comment alert
-- ---------------------------------------------------------------------------
create function pg_temp.alerts(p_user uuid) returns text language sql stable as $$
  select coalesce(string_agg(format('%s|%s|%s|%s', n.title, n.data ->> 'list_id', n.data ->> 'actor_id', n.read::text),
                             ' || ' order by n.read, n.data ->> 'list_id', n.title), '<none>')
  from notifications n where n.user_id = p_user and n.type = 'list_comment'
$$;
grant execute on function pg_temp.alerts(uuid) to authenticated;

select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000002', 'n1')$$),
  'no error', 'N1 u2 comments on u1''s list');
reset role;
select is(pg_temp.alerts('99163000-0000-4000-8000-000000000001'),
  '@x163_user2 commented on x163 Public|a1630000-0000-4000-8000-000000000001|99163000-0000-4000-8000-000000000002|false',
  'N2 the owner has one unread alert: who, which list (golden; no comment text copied)');
select is(
  (select format('%s|%s', type, (body is null)::text) from notifications where user_id = '99163000-0000-4000-8000-000000000001'),
  'list_comment|true', 'N3 its type is list_comment and its body is empty');
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000005', 'n2')$$),
  'no error', 'N4 u5 comments on the same list');
reset role;
select is(pg_temp.alerts('99163000-0000-4000-8000-000000000001'),
  '@x163_user5 commented on x163 Public|a1630000-0000-4000-8000-000000000001|99163000-0000-4000-8000-000000000005|false',
  'N5 still ONE unread alert for the list, refreshed to the newest commenter');
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000001', 'my own')$$),
  'no error', 'N6 the owner comments on his own list');
reset role;
select is(pg_temp.alerts('99163000-0000-4000-8000-000000000001'),
  '@x163_user5 commented on x163 Public|a1630000-0000-4000-8000-000000000001|99163000-0000-4000-8000-000000000005|false',
  'N7 …which neither alerts him nor refreshes the alert');
update notifications set read = true where user_id = '99163000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000002', 'n3')$$),
  'no error', 'N8 after he reads it, u2 comments again');
select is(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000004', '99163000-0000-4000-8000-000000000002', 'n4')$$),
  'no error', 'N9 …and on u1''s second list');
reset role;
select is(pg_temp.alerts('99163000-0000-4000-8000-000000000001'),
  '@x163_user2 commented on x163 Public|a1630000-0000-4000-8000-000000000001|99163000-0000-4000-8000-000000000002|false || '
  || '@x163_user2 commented on x163 Second|a1630000-0000-4000-8000-000000000004|99163000-0000-4000-8000-000000000002|false || '
  || '@x163_user5 commented on x163 Public|a1630000-0000-4000-8000-000000000001|99163000-0000-4000-8000-000000000005|true',
  'N10 a new unread alert once the old one is read, and one per list');
select is(
  (select count(*)::int from notifications where user_id in ('99163000-0000-4000-8000-000000000002', '99163000-0000-4000-8000-000000000005')),
  0, 'N11 the commenters get no alert of their own');
insert into list_comments (list_id, author_id, body, deleted_at)
values ('a1630000-0000-4000-8000-000000000004', '99163000-0000-4000-8000-000000000005', 'born removed', now());
select is(pg_temp.alerts('99163000-0000-4000-8000-000000000001'),
  '@x163_user2 commented on x163 Public|a1630000-0000-4000-8000-000000000001|99163000-0000-4000-8000-000000000002|false || '
  || '@x163_user2 commented on x163 Second|a1630000-0000-4000-8000-000000000004|99163000-0000-4000-8000-000000000002|false || '
  || '@x163_user5 commented on x163 Public|a1630000-0000-4000-8000-000000000001|99163000-0000-4000-8000-000000000005|true',
  'N12 a comment written already removed (a server write) raises no alert');
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select count(*) from notifications where type = 'list_comment' and read = false$$),
  '2', 'N13 the owner reads his two unread alerts through RLS (the bell''s query)');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- L. The limit — 5 comments a minute, per person
-- ---------------------------------------------------------------------------
create function pg_temp.stored(p_user uuid) returns integer language sql stable as $$
  select coalesce((select cardinality(hits) from public.rate_limit_hits
                   where user_id = p_user and bucket = 'comment' and scope = p_user), -1)
$$;
delete from notifications where user_id = '99163000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select string_agg(pg_temp.err(format($f$insert into list_comments (list_id, author_id, body)
     values (%L, '99163000-0000-4000-8000-000000000003', 'flood %s')$f$,
     case when i % 2 = 0 then 'a1630000-0000-4000-8000-000000000004' else 'a1630000-0000-4000-8000-000000000001' end, i)), ' | ' order by i)
   from generate_series(1, 5) i),
  'no error | no error | no error | no error | no error',
  'L1 u3 posts five comments in a minute, across two lists');
select is(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000001', '99163000-0000-4000-8000-000000000003', 'flood 6')$$),
  'PGRST: {"code" : "rate_limited", "message" : "You''re commenting too fast — you can comment again in 60 seconds.", "details" : "retry_after_seconds=60", "hint" : null}',
  'L2 the 6th is refused: SQLSTATE PGRST, plain words, the wait named and machine-readable (golden)');
select is(pg_temp.detail_of($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000004', '99163000-0000-4000-8000-000000000003', 'flood 7')$$),
  '{"status" : 429, "status_text" : "Too Many Requests", "headers" : {"Retry-After" : "60"}}',
  'L3 the envelope: HTTP 429 + Retry-After 60 — on another list too (the allowance is the person''s, golden)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('posted=%s stored=%s', count(*), pg_temp.stored('99163000-0000-4000-8000-000000000003'))
   from list_comments where author_id = '99163000-0000-4000-8000-000000000003'),
  'posted=5 stored=5', 'L4 what landed: the five, not the refused ones; the allowance holds exactly five hits');
select is(pg_temp.alerts('99163000-0000-4000-8000-000000000001'),
  '@x163_user3 commented on x163 Public|a1630000-0000-4000-8000-000000000001|99163000-0000-4000-8000-000000000003|false || '
  || '@x163_user3 commented on x163 Second|a1630000-0000-4000-8000-000000000004|99163000-0000-4000-8000-000000000003|false',
  'L5 five comments, two alerts (one per list); the refused ones alerted nobody');
select is(
  (select format('%s|%s', count(*) filter (where created_at = now() and updated_at = now() and deleted_at is null), count(*))
   from list_comments where author_id = '99163000-0000-4000-8000-000000000003'),
  '5|5', 'L6 every client comment is stamped now and live');

-- The window: 209's strict sliding window, at injected instants.
select is(
  (select format('%s:%s', r ->> 'allowed', r ->> 'retry_after_ms')
   from (select public.rate_limit_take_internal('99163000-0000-4000-8000-000000000003', 'comment',
           '99163000-0000-4000-8000-000000000003', now() + interval '59.999 seconds') r) x),
  'false:1', 'L7 one millisecond before the minute is up, still refused (retry 1 ms)');
select is(
  (select r ->> 'allowed'
   from (select public.rate_limit_take_internal('99163000-0000-4000-8000-000000000003', 'comment',
           '99163000-0000-4000-8000-000000000003', now() + interval '60 seconds') r) x),
  'true', 'L8 at the minute, a slot is free again');

-- Backdating and pre-removing on insert are stamped away (u5, who has room).
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$insert into list_comments (id, list_id, author_id, body, created_at, updated_at, deleted_at)
                        values ('c1630000-0000-4000-8000-0000000000b1', 'a1630000-0000-4000-8000-000000000004',
                                '99163000-0000-4000-8000-000000000005', 'backdated', '2000-01-01', '2000-01-01', '2000-01-02')$$),
  'no error', 'L9 another person (u5) is unaffected by u3''s limit');
reset role;
select is(
  (select format('%s|%s|%s', (created_at = now())::text, (updated_at = now())::text, (deleted_at is null)::text)
   from list_comments where id = 'c1630000-0000-4000-8000-0000000000b1'),
  'true|true|true', 'L10 …and his backdated, pre-removed insert landed stamped now and live');

-- A comment RLS refuses spends nothing.
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
select alike(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000002', '99163000-0000-4000-8000-000000000005', 'not my private list')$$),
  '42501: new row violates row-level security policy%', 'L11 u5 cannot comment on someone''s private list (RLS)');
select alike(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000003', '99163000-0000-4000-8000-000000000005', 'comments off')$$),
  '42501: new row violates row-level security policy%', 'L12 …nor on a list with comments off');
select alike(pg_temp.err($$insert into list_comments (list_id, author_id, body) values ('a1630000-0000-4000-8000-000000000004', '99163000-0000-4000-8000-000000000002', 'as someone else')$$),
  '42501: new row violates row-level security policy%', 'L13 …nor post as someone else');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('u5=%s u2=%s', pg_temp.stored('99163000-0000-4000-8000-000000000005'), pg_temp.stored('99163000-0000-4000-8000-000000000002'))),
  'u5=2 u2=3', 'L14 the refused comments spent nothing: u5 holds his two (N4, L9), u2 his three (N1, N8, N9)');

-- The client door is unchanged: the new buckets are not the door's.
select set_config('request.jwt.claims', '{"sub": "99163000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select string_agg(pg_temp.err(format('select rate_limit_take(%L, %L)', b, '99163000-0000-4000-8000-000000000003')), ' | ' order by b)
   from unnest(array['ask', 'comment', 'report']) b),
  '22023: rate_limit: unknown bucket ask | 22023: rate_limit: unknown bucket comment | 22023: rate_limit: unknown bucket report',
  'L15 the client door still spends only mutation | bid: nobody drains a person''s comment, report or ask allowance from outside');
select alike(pg_temp.err($$select rate_limit_take_internal('99163000-0000-4000-8000-000000000005', 'comment', '99163000-0000-4000-8000-000000000005', now())$$),
  '42501: permission denied for function rate_limit_take_internal%', 'L16 …and the internal stays closed to authenticated');
select is(pg_temp.val($$select count(*) from rate_limit_hits$$), '0', 'L17 nobody reads the ledger (RLS, no policy)');
reset role;
select set_config('request.jwt.claims', '', true);

-- The CHECK holds: an unknown bucket cannot be written even by the owner.
select is(pg_temp.err($$insert into rate_limit_hits (user_id, bucket, scope) values ('99163000-0000-4000-8000-000000000001', 'pick', '99163000-0000-4000-8000-000000000001')$$),
  '23514: new row for relation "rate_limit_hits" violates check constraint "rate_limit_hits_bucket_known"',
  'L18 the bucket CHECK refuses an unknown bucket');

select * from finish();
rollback;
