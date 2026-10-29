-- ============================================================================
-- 164 — content reports (migration 214; Community launch plan C9;
--       readiness S3)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — report_content, mark_content_report_reviewed and
--       remove_list_comment DEFINER + search_path '' + EXECUTE authenticated
--       only; the write-once trigger function PLAIN, search_path '', closed;
--       content_reports: RLS on with ZERO policies, TRUNCATE closed to anon /
--       authenticated (the seven other grants stay — RLS is the gate), its
--       columns, constraints (no FK on list_id) and indexes (golden), its
--       one BEFORE UPDATE trigger ENABLE ALWAYS.
--   §C  NO CLIENT ACCESS — the reporter, an admin's browser and anon read no
--       row; a direct INSERT is refused by RLS; UPDATE / DELETE touch nothing;
--       TRUNCATE is refused; the seeded row is byte-unchanged.
--   §G  THE GATE — anon cannot run either RPC; a JWT with no user is refused
--       by name.
--   §V  INPUT — an unknown type, a bad reason, a 501-character note and a
--       missing id are refused by name; nothing written, nothing spent.
--   §O  OWN — your own list (also when soft-deleted), comment and question are
--       refused by name.
--   §S  SEE — what the caller can't see gets ONE answer (P0002): a missing /
--       private / soft-deleted list, a private list in a league he isn't in
--       or not shared with his league, a missing / removed comment, a comment
--       on a private / comments-off / deleted list, a missing question, an id
--       under the wrong type; nothing written, nothing spent. What he can see
--       is reported: a public list, a private list shared with his league, a
--       comment (reason + trimmed note), a question, and — as a list's owner —
--       someone else's comment on his own private list. Stored rows golden.
--   §N  THE ALERT — each admin gets one unread "New reports to review" (golden
--       title / body / data); non-admins get none; a new report refreshes an
--       unread alert instead of adding one; once read, the next report is a
--       new alert; never the reporter-admin's own bell.
--   §D  REPEATS — a second report of the same thing answers already_reported
--       with the first report's id: no second row, the first reason kept, no
--       allowance spent, no alert.
--   §L  THE LIMIT — 10 reports in an hour land; the 11th is refused with
--       SQLSTATE PGRST + PostgREST's 429 / Retry-After envelope (golden),
--       nothing written; a repeat still answers already_reported at the
--       limit; another person is unaffected; the allowance is the person's own.
--   §R  REVIEW — anon and non-admins are refused (an unknown id too — nothing
--       leaks); a missing report is P0002; an admin stamps (who + now) and the
--       operator audit gets one row (ids, no note); a second review is
--       already_reviewed and keeps the first stamp; nobody — server included —
--       can edit a report, un-review it or re-stamp it; the stamp is a pair.
--   §M  REMOVE — an admin's remove_list_comment stamps every OPEN report on
--       that comment with him and the removal's instant (an already-reviewed
--       one keeps its stamp), answers reports_reviewed and records it in the
--       audit row's metadata; the author's and a non-admin list owner's
--       removals stamp none (213's answer, golden); an admin removing a
--       comment on his own list stamps too (and writes no audit row, 213).
--   §K  KEPT — a list its owner hard-deletes (still possible from a client
--       today) takes its comments with it, but every report about it and its
--       comments stays, unchanged: the record outlives what it reports.
-- Break probes (shown in the PR, each in a rolled-back transaction): (1) the
-- comment branch's `c.deleted_at IS NULL` dropped ⇒ S3 + S7 red; (2) the
-- repeat check removed ⇒ D1 red (23505); (3) the reporter left in the admin
-- loop ⇒ N4 + D4 + N7 red; (4) the operator gate in
-- mark_content_report_reviewed removed ⇒ R1 + R2 red; (5) the operator's
-- report stamp in remove_list_comment removed ⇒ M3–M7 red.
-- World: u1 owns L1 (public), L2 (private), L3 (public, comments off), L4
-- (public, soft-deleted), L5 (private, shared with league G1), L6 (private,
-- shared with G2), L7 (private, in G1 but not shared) and the flood lists
-- L10–L20, and posted question Q1. u2 comments; u3 reports and is in G1; u4
-- and u6 are platform operators (u4 owns L8); u5 reports; u7 floods.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(84);

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

-- Each test person's report-bell state: "unread/total" (content_report alerts only).
create function pg_temp.bell() returns text language sql stable as $$
  select string_agg(format('u%s=%s/%s', i,
           (select count(*) from notifications n where n.user_id = ('99164000-0000-4000-8000-00000000000' || i)::uuid
              and n.type = 'content_report' and not n.read),
           (select count(*) from notifications n where n.user_id = ('99164000-0000-4000-8000-00000000000' || i)::uuid
              and n.type = 'content_report')), ' ' order by i)
  from generate_series(1, 7) i
$$;

-- The 'report' allowance a person has spent (-1 = never touched).
create function pg_temp.spent(p_user uuid) returns integer language sql stable as $$
  select coalesce((select cardinality(hits) from public.rate_limit_hits
                   where user_id = p_user and bucket = 'report' and scope = p_user), -1)
$$;

-- Answers of the calls that land, kept for comparison (written as the caller).
create temp table _answers (label text primary key, answer jsonb);
grant select, insert on _answers to authenticated;

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('report_content', 'mark_content_report_reviewed', 'remove_list_comment',
                       'content_reports_write_once_internal')),
  'content_reports_write_once_internal=f:search_path="":f:f mark_content_report_reviewed=t:search_path="":f:t '
  || 'remove_list_comment=t:search_path="":f:t report_content=t:search_path="":f:t',
  'A1 the three RPCs DEFINER + search_path '''' + authenticated only; the trigger function PLAIN, closed');
select is(
  (select format('rls=%s policies=%s', c.relrowsecurity::text,
                 (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'content_reports'))
   from pg_class c where c.oid = 'public.content_reports'::regclass),
  'rls=true policies=0',
  'A2 content_reports: RLS on, and NO policy — no client reads or writes a report');
select is(
  (select string_agg(format('%s=%s', r, (
     select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
     where has_table_privilege(r, 'public.content_reports', p))), ' ' order by r)
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon=DELETE,INSERT,SELECT,UPDATE authenticated=DELETE,INSERT,SELECT,UPDATE service_role=DELETE,INSERT,SELECT,TRUNCATE,UPDATE',
  'A3 grants: TRUNCATE closed to anon / authenticated (RLS does not gate it); the rest stay — RLS is the gate (D23)');
select is(
  (select string_agg(format('%s:%s:%s', attname, format_type(atttypid, atttypmod), attnotnull), ' ' order by attnum)
   from pg_attribute where attrelid = 'public.content_reports'::regclass and attnum > 0 and not attisdropped),
  'id:uuid:t reporter_id:uuid:t target_type:text:t target_id:uuid:t list_id:uuid:f reason:text:f note:text:f '
  || 'created_at:timestamp with time zone:t reviewed_at:timestamp with time zone:f reviewed_by:uuid:f',
  'A4 the columns, golden');
select is(
  (select string_agg(format('%s=%s', conname, pg_get_constraintdef(oid)), ' | ' order by conname)
   from pg_constraint where conrelid = 'public.content_reports'::regclass and conname <> 'content_reports_note_shape'),
  'content_reports_list_matches_target=CHECK ((((target_type = ''start_sit''::text) = (list_id IS NULL)) AND ((target_type <> ''list''::text) OR (list_id = target_id))))'
  || ' | content_reports_once_per_target=UNIQUE (reporter_id, target_type, target_id)'
  || ' | content_reports_pkey=PRIMARY KEY (id)'
  || ' | content_reports_reason_known=CHECK (((reason IS NULL) OR (reason = ANY (ARRAY[''spam''::text, ''abusive''::text, ''other''::text]))))'
  || ' | content_reports_reporter_id_fkey=FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE CASCADE'
  || ' | content_reports_review_pair=CHECK (((reviewed_at IS NULL) = (reviewed_by IS NULL)))'
  || ' | content_reports_reviewed_by_fkey=FOREIGN KEY (reviewed_by) REFERENCES profiles(id)'
  || ' | content_reports_target_type_known=CHECK ((target_type = ANY (ARRAY[''list''::text, ''comment''::text, ''start_sit''::text])))',
  'A5 the constraints, golden: once per (reporter, target); the three types; the three reasons; the list matches the target; the review is a pair; NO foreign key on list_id (a report outlives its list)');
select is(
  (select string_agg(indexname, ' ' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'content_reports'),
  'content_reports_once_per_target content_reports_pkey idx_content_reports_created idx_content_reports_list '
  || 'idx_content_reports_reviewer idx_content_reports_target',
  'A6 the indexes (the UNIQUE leads with reporter_id; list_id and reviewed_by have their own)');
select is(
  (select string_agg(format('%s:%s:%s:%s', t.tgname, t.tgtype, t.tgenabled, p.proname), ' ')
   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.content_reports'::regclass and not t.tgisinternal),
  'trg_content_reports_write_once:19:A:content_reports_write_once_internal',
  'A7 one trigger: BEFORE UPDATE ROW (19), ENABLE ALWAYS — replica mode cannot skip it (R616)');

-- ---------------------------------------------------------------------------
-- World (seeded as the table owner: no uid)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, ('99164000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x164-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, json_build_object('username', 'x164_user' || i)::jsonb, now(), now()
from generate_series(1, 7) i;
update profiles set is_admin = true
 where id in ('99164000-0000-4000-8000-000000000004', '99164000-0000-4000-8000-000000000006');

insert into lists (id, owner_id, title, slug, is_private, comments_enabled, deleted_at) values
  ('a1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000001', 'x164 Public',   'x164-public',   false, true,  null),
  ('a1640000-0000-4000-8000-000000000002', '99164000-0000-4000-8000-000000000001', 'x164 Private',  'x164-private',  true,  true,  null),
  ('a1640000-0000-4000-8000-000000000003', '99164000-0000-4000-8000-000000000001', 'x164 Off',      'x164-off',      false, false, null),
  ('a1640000-0000-4000-8000-000000000004', '99164000-0000-4000-8000-000000000001', 'x164 Deleted',  'x164-deleted',  false, true,  '2096-01-01 00:00:00+00'),
  ('a1640000-0000-4000-8000-000000000005', '99164000-0000-4000-8000-000000000001', 'x164 Shared',   'x164-shared',   true,  true,  null),
  ('a1640000-0000-4000-8000-000000000006', '99164000-0000-4000-8000-000000000001', 'x164 Other lg', 'x164-other-lg', true,  true,  null),
  ('a1640000-0000-4000-8000-000000000007', '99164000-0000-4000-8000-000000000001', 'x164 Unshared', 'x164-unshared', true,  true,  null),
  ('a1640000-0000-4000-8000-000000000008', '99164000-0000-4000-8000-000000000004', 'x164 Admin''s', 'x164-admins',   false, true,  null);
insert into lists (id, owner_id, title, slug, is_private, comments_enabled)
select ('a1640000-0000-4000-8000-0000000000' || i)::uuid, '99164000-0000-4000-8000-000000000001',
       'x164 Flood ' || i, 'x164-flood-' || i, false, true
from generate_series(10, 20) i;

insert into leagues (id, owner_id, name, season) values
  ('b1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000001', 'x164 G1', 2026),
  ('b1640000-0000-4000-8000-000000000002', '99164000-0000-4000-8000-000000000001', 'x164 G2', 2026);
insert into league_members (league_id, user_id, role) values
  ('b1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000001', 'commissioner'),
  ('b1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000003', 'manager'),
  ('b1640000-0000-4000-8000-000000000002', '99164000-0000-4000-8000-000000000001', 'commissioner');
insert into league_lists (league_id, list_id, owner_id, shared_with_league) values
  ('b1640000-0000-4000-8000-000000000001', 'a1640000-0000-4000-8000-000000000005', '99164000-0000-4000-8000-000000000001', true),
  ('b1640000-0000-4000-8000-000000000002', 'a1640000-0000-4000-8000-000000000006', '99164000-0000-4000-8000-000000000001', true),
  ('b1640000-0000-4000-8000-000000000001', 'a1640000-0000-4000-8000-000000000007', '99164000-0000-4000-8000-000000000001', false);

insert into list_comments (id, list_id, author_id, body, deleted_at) values
  ('c1640000-0000-4000-8000-0000000000a1', 'a1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000002', 'x164 a', null),
  ('c1640000-0000-4000-8000-0000000000a2', 'a1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000002', 'x164 removed', '2096-01-01 00:00:00+00'),
  ('c1640000-0000-4000-8000-0000000000a3', 'a1640000-0000-4000-8000-000000000002', '99164000-0000-4000-8000-000000000002', 'x164 on private', null),
  ('c1640000-0000-4000-8000-0000000000a4', 'a1640000-0000-4000-8000-000000000003', '99164000-0000-4000-8000-000000000002', 'x164 on off', null),
  ('c1640000-0000-4000-8000-0000000000a5', 'a1640000-0000-4000-8000-000000000004', '99164000-0000-4000-8000-000000000002', 'x164 on deleted', null),
  ('c1640000-0000-4000-8000-0000000000a7', 'a1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000002', 'x164 h', null),
  ('c1640000-0000-4000-8000-0000000000a8', 'a1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000005', 'x164 i', null),
  ('c1640000-0000-4000-8000-0000000000a9', 'a1640000-0000-4000-8000-000000000008', '99164000-0000-4000-8000-000000000002', 'x164 j', null);

insert into players (id, full_name, position) values
  ('x164-p1', 'X164 One', 'WR'), ('x164-p2', 'X164 Two', 'WR');
insert into start_sit_questions (id, poster_id, player_a_id, player_b_id, season, week, voting_closes_at) values
  ('d1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000001', 'x164-p1', 'x164-p2', 2026, 9, now() + interval '2 days');

-- One report written by the server, for §C's premise (u2 reported Q1).
insert into content_reports (id, reporter_id, target_type, target_id, list_id, reason, note, created_at) values
  ('e1640000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000002', 'start_sit',
   'd1640000-0000-4000-8000-000000000001', null, 'other', 'x164 seed note', '2096-01-01 00:00:00+00');
create temp table _seed as select * from content_reports where id = 'e1640000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- C. No client reads or writes a report
-- ---------------------------------------------------------------------------
select is((select count(*)::int from content_reports where id = 'e1640000-0000-4000-8000-000000000001'), 1,
  'C0 premise: the table owner sees the seeded report');
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select count(*) from content_reports$$), '0', 'C1 the reporter cannot read even his own report');
select is(pg_temp.err($$insert into content_reports (reporter_id, target_type, target_id, list_id)
                        values ('99164000-0000-4000-8000-000000000002', 'list', 'a1640000-0000-4000-8000-000000000001', 'a1640000-0000-4000-8000-000000000001')$$),
  '42501: new row violates row-level security policy for table "content_reports"', 'C2 …nor write one directly (RLS refuses the INSERT)');
select is(pg_temp.val($$with x as (update content_reports set note = 'edited' returning 1) select count(*) from x$$),
  '0', 'C3 …nor edit one (UPDATE touches nothing)');
select is(pg_temp.val($$with x as (delete from content_reports returning 1) select count(*) from x$$),
  '0', 'C4 …nor delete one');
select is(pg_temp.err($$truncate content_reports$$),
  '42501: permission denied for table content_reports', 'C5 …and TRUNCATE is refused outright');
reset role;
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select count(*) from content_reports$$), '0',
  'C6 an admin''s browser reads none either (Admin › Reports reads with the service role)');
select is(pg_temp.val($$with x as (update content_reports set reviewed_at = now(), reviewed_by = '99164000-0000-4000-8000-000000000004' returning 1) select count(*) from x$$),
  '0', 'C7 …and cannot stamp a review by hand — only through the RPC');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select is(pg_temp.val($$select count(*) from content_reports$$), '0', 'C8 anon reads none');
select is(pg_temp.err($$insert into content_reports (reporter_id, target_type, target_id) values ('99164000-0000-4000-8000-000000000002', 'start_sit', 'd1640000-0000-4000-8000-000000000001')$$),
  '42501: new row violates row-level security policy for table "content_reports"', 'C9 …and writes none');
select is(pg_temp.val($$with x as (delete from content_reports returning 1) select count(*) from x$$),
  '0', 'C10 …nor deletes any');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*)::int from content_reports c join _seed s using (id)
   where (c.reporter_id, c.target_type, c.target_id, c.list_id, c.reason, c.note, c.created_at, c.reviewed_at, c.reviewed_by)
         is not distinct from (s.reporter_id, s.target_type, s.target_id, s.list_id, s.reason, s.note, s.created_at, s.reviewed_at, s.reviewed_by)),
  1, 'C11 the seeded report is byte-unchanged, and it is the only row');

-- ---------------------------------------------------------------------------
-- G. The gate
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select alike(pg_temp.err($$select report_content('list', 'a1640000-0000-4000-8000-000000000001')$$),
  '42501: permission denied for function report_content%', 'G1 anon cannot report');
select alike(pg_temp.err($$select mark_content_report_reviewed('e1640000-0000-4000-8000-000000000001')$$),
  '42501: permission denied for function mark_content_report_reviewed%', 'G2 …nor review');
reset role;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select report_content('list', 'a1640000-0000-4000-8000-000000000001')$$),
  '42501: Sign in to report something.', 'G3 a JWT with no user is refused by name');
reset role;

-- ---------------------------------------------------------------------------
-- V. Input
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select report_content('profile', 'a1640000-0000-4000-8000-000000000001')$$),
  '22023: Only lists, comments and start/sit questions can be reported.', 'V1 an unknown kind of thing is refused by name');
select is(pg_temp.err($$select report_content(null, 'a1640000-0000-4000-8000-000000000001')$$),
  '22023: Only lists, comments and start/sit questions can be reported.', 'V2 …and so is no kind at all');
select is(pg_temp.err($$select report_content('list', 'a1640000-0000-4000-8000-000000000001', 'rude')$$),
  '22023: Pick Spam, Abusive or Something else — or leave the reason out.', 'V3 a reason outside the three is refused');
select is(pg_temp.err(format($f$select report_content('list', 'a1640000-0000-4000-8000-000000000001', 'spam', %L)$f$, repeat('x', 501))),
  '22001: Keep the note to 500 characters or fewer.', 'V4 a 501-character note is refused');
select is(pg_temp.err($$select report_content('list', null)$$),
  'P0002: That isn''t there to report — it may have been removed.', 'V5 no id: nothing there to report');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('rows=%s spent=%s', count(*), pg_temp.spent('99164000-0000-4000-8000-000000000003'))
   from content_reports where reporter_id = '99164000-0000-4000-8000-000000000003'),
  'rows=0 spent=-1', 'V6 the refused calls wrote nothing and spent no allowance');

-- ---------------------------------------------------------------------------
-- O. Your own things
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select report_content('list', 'a1640000-0000-4000-8000-000000000001')$$),
  '42501: You can''t report your own list.', 'O1 your own list is refused by name');
select is(pg_temp.err($$select report_content('list', 'a1640000-0000-4000-8000-000000000004')$$),
  '42501: You can''t report your own list.', 'O2 …also when you soft-deleted it (you can still see it)');
select is(pg_temp.err($$select report_content('start_sit', 'd1640000-0000-4000-8000-000000000001', 'spam')$$),
  '42501: You can''t report your own question.', 'O3 your own start/sit question');
reset role;
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select report_content('comment', 'c1640000-0000-4000-8000-0000000000a1')$$),
  '42501: You can''t report your own comment.', 'O4 your own comment');
reset role;

-- ---------------------------------------------------------------------------
-- S. Only what you can see — one answer for everything else
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select string_agg(pg_temp.err(format('select report_content(%L, %L)', t.kind, t.id)), ' | ' order by t.n)
   from (values
     (1, 'list', 'a1640000-0000-4000-8000-0000000000ff'),     -- no such list
     (2, 'list', 'a1640000-0000-4000-8000-000000000002'),     -- private
     (3, 'list', 'a1640000-0000-4000-8000-000000000004'),     -- soft-deleted
     (4, 'list', 'a1640000-0000-4000-8000-000000000007'),     -- private, in his league but not shared
     (5, 'list', 'a1640000-0000-4000-8000-000000000006')      -- private, shared with a league he isn't in
   ) t(n, kind, id)),
  'P0002: That isn''t there to report — it may have been removed. | P0002: That isn''t there to report — it may have been removed. | '
  || 'P0002: That isn''t there to report — it may have been removed. | P0002: That isn''t there to report — it may have been removed. | '
  || 'P0002: That isn''t there to report — it may have been removed.',
  'S1 lists he can''t see — missing, private, soft-deleted, unshared, another league''s — all get the same P0002');
select is(pg_temp.err($$select report_content('comment', 'c1640000-0000-4000-8000-0000000000ff')$$),
  'P0002: That isn''t there to report — it may have been removed.', 'S2 a comment that doesn''t exist');
select is(pg_temp.err($$select report_content('comment', 'c1640000-0000-4000-8000-0000000000a2')$$),
  'P0002: That isn''t there to report — it may have been removed.', 'S3 a removed comment (hidden from every reader, 213)');
select is(
  (select string_agg(pg_temp.err(format('select report_content(''comment'', %L)', id)), ' | ' order by id)
   from unnest(array['c1640000-0000-4000-8000-0000000000a3', 'c1640000-0000-4000-8000-0000000000a4',
                     'c1640000-0000-4000-8000-0000000000a5']::text[]) id),
  'P0002: That isn''t there to report — it may have been removed. | P0002: That isn''t there to report — it may have been removed. | '
  || 'P0002: That isn''t there to report — it may have been removed.',
  'S4 comments on a private list, a comments-off list and a deleted list — same answer');
select is(pg_temp.err($$select report_content('start_sit', 'd1640000-0000-4000-8000-0000000000ff')$$),
  'P0002: That isn''t there to report — it may have been removed.', 'S5 a question that doesn''t exist');
select is(pg_temp.err($$select report_content('comment', 'a1640000-0000-4000-8000-000000000001')$$),
  'P0002: That isn''t there to report — it may have been removed.', 'S6 a list''s id under the comment kind is not a comment');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('rows=%s spent=%s', count(*), pg_temp.spent('99164000-0000-4000-8000-000000000003'))
   from content_reports where reporter_id = '99164000-0000-4000-8000-000000000003'),
  'rows=0 spent=-1', 'S7 none of that wrote a report or spent allowance');

-- What he can see is reported.
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
insert into _answers select 'S8', report_content('list', 'a1640000-0000-4000-8000-000000000001');
insert into _answers select 'S9', report_content('list', 'a1640000-0000-4000-8000-000000000005', null, '   ');
insert into _answers select 'S10', report_content('comment', 'c1640000-0000-4000-8000-0000000000a1', 'abusive', '  x164 rude  ');
insert into _answers select 'S11', report_content('start_sit', 'd1640000-0000-4000-8000-000000000001', 'spam');
reset role;
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
insert into _answers select 'S12', report_content('comment', 'c1640000-0000-4000-8000-0000000000a3', 'other');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select string_agg(format('%s:%s', label, answer - 'report_id' - 'reported_at'), ' | ' order by label)
   from _answers where label in ('S8', 'S9', 'S10', 'S11', 'S12')),
  'S10:{"status": "reported", "target_id": "c1640000-0000-4000-8000-0000000000a1", "target_type": "comment"}'
  || ' | S11:{"status": "reported", "target_id": "d1640000-0000-4000-8000-000000000001", "target_type": "start_sit"}'
  || ' | S12:{"status": "reported", "target_id": "c1640000-0000-4000-8000-0000000000a3", "target_type": "comment"}'
  || ' | S8:{"status": "reported", "target_id": "a1640000-0000-4000-8000-000000000001", "target_type": "list"}'
  || ' | S9:{"status": "reported", "target_id": "a1640000-0000-4000-8000-000000000005", "target_type": "list"}',
  'S8–S12 reported (golden): a public list, a private list shared with his league, a comment, a question — and, as a list''s owner, someone else''s comment on his own private list');
select is(
  (select string_agg(format('%s|%s|%s|%s|%s|%s', r.target_type, r.target_id, coalesce(r.list_id::text, '-'),
                            coalesce(r.reason, '-'), coalesce(r.note, '-'), (r.reviewed_at is null and r.reviewed_by is null)::text), ' || '
                     order by r.reporter_id, r.target_type, r.target_id)
   from content_reports r
   where r.reporter_id in ('99164000-0000-4000-8000-000000000001', '99164000-0000-4000-8000-000000000003')),
  'comment|c1640000-0000-4000-8000-0000000000a3|a1640000-0000-4000-8000-000000000002|other|-|true || '
  || 'comment|c1640000-0000-4000-8000-0000000000a1|a1640000-0000-4000-8000-000000000001|abusive|x164 rude|true || '
  || 'list|a1640000-0000-4000-8000-000000000001|a1640000-0000-4000-8000-000000000001|-|-|true || '
  || 'list|a1640000-0000-4000-8000-000000000005|a1640000-0000-4000-8000-000000000005|-|-|true || '
  || 'start_sit|d1640000-0000-4000-8000-000000000001|-|spam|-|true',
  'S13 the stored rows (golden): the comment''s list filled in by the server, the note trimmed, a blank note is no note, all open');
select is(
  (select format('%s|%s', bool_and(r.id = (a.answer ->> 'report_id')::uuid)::text, bool_and(r.created_at = (a.answer ->> 'reported_at')::timestamptz)::text)
   from _answers a join content_reports r on r.id = (a.answer ->> 'report_id')::uuid
   where a.label in ('S8', 'S9', 'S10', 'S11', 'S12')),
  'true|true', 'S14 each answer names its own report and when it was made');
select is(pg_temp.spent('99164000-0000-4000-8000-000000000003'), 4,
  'S15 u3''s four reports spent four of his ten hourly reports');

-- ---------------------------------------------------------------------------
-- N. The admins' bell
-- ---------------------------------------------------------------------------
select is(pg_temp.bell(), 'u1=0/0 u2=0/0 u3=0/0 u4=1/1 u5=0/0 u6=1/1 u7=0/0',
  'N1 five reports, ONE unread alert for each admin (u4, u6) and none for anyone else');
select is(
  (select string_agg(format('%s|%s|%s', title, coalesce(body, '-'), data), ' || ' order by user_id)
   from notifications where type = 'content_report'
     and user_id in ('99164000-0000-4000-8000-000000000004', '99164000-0000-4000-8000-000000000006')),
  'New reports to review|-|{"link": "/app/admin/reports"} || New reports to review|-|{"link": "/app/admin/reports"}',
  'N2 the alert, golden: "New reports to review", no body, a link to Admin › Reports — nothing from the report itself');
update notifications set read = true
 where type = 'content_report' and user_id = '99164000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
insert into _answers select 'N3', report_content('list', 'a1640000-0000-4000-8000-000000000001', 'spam');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.bell(), 'u1=0/0 u2=0/0 u3=0/0 u4=1/2 u5=0/0 u6=1/1 u7=0/0',
  'N3 u4 had read his: the next report is a NEW unread alert; u6''s unread one is refreshed, not doubled');
update notifications set read = true
 where type = 'content_report' and user_id = '99164000-0000-4000-8000-000000000006';
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
insert into _answers select 'N4', report_content('list', 'a1640000-0000-4000-8000-000000000001');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.bell(), 'u1=0/0 u2=0/0 u3=0/0 u4=1/2 u5=0/0 u6=0/1 u7=0/0',
  'N4 an admin''s own report never rings his own bell (u6 stays read); the other admin''s unread alert is refreshed');
select is(
  (select format('%s|%s', count(*), bool_and(created_at = now())::text)
   from notifications where type = 'content_report' and not read
     and user_id = '99164000-0000-4000-8000-000000000004'),
  '1|true', 'N5 …refreshed to the newest report''s time');

-- ---------------------------------------------------------------------------
-- D. A repeat report does nothing, and says so
-- ---------------------------------------------------------------------------
update notifications set read = true
 where type = 'content_report' and user_id in (select ('99164000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 7) i);
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select (report_content('list', 'a1640000-0000-4000-8000-000000000001', 'abusive', 'x164 again') - 'reported_at')::text$$),
  format('{"status": "already_reported", "report_id": "%s", "target_id": "a1640000-0000-4000-8000-000000000001", "target_type": "list"}',
         (select answer ->> 'report_id' from _answers where label = 'S8')),
  'D1 the same person reporting the same list again: already_reported, naming the FIRST report — not an error (golden)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('rows=%s reason=%s note=%s', count(*), coalesce(min(reason), '-'), coalesce(min(note), '-'))
   from content_reports where reporter_id = '99164000-0000-4000-8000-000000000003'
     and target_type = 'list' and target_id = 'a1640000-0000-4000-8000-000000000001'),
  'rows=1 reason=- note=-', 'D2 still one row, and the first report''s (empty) reason and note are kept');
select is(pg_temp.spent('99164000-0000-4000-8000-000000000003'), 4, 'D3 the repeat spent no allowance');
select is(pg_temp.bell(), 'u1=0/0 u2=0/0 u3=0/0 u4=0/2 u5=0/0 u6=0/1 u7=0/0', 'D4 …and rang no bell');

-- ---------------------------------------------------------------------------
-- L. Ten reports an hour
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000007", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select string_agg(pg_temp.val(format('select report_content(''list'', %L) ->> ''status''',
                                        'a1640000-0000-4000-8000-0000000000' || i)), ',' order by i)
   from generate_series(10, 19) i),
  'reported,reported,reported,reported,reported,reported,reported,reported,reported,reported',
  'L1 u7 reports ten lists in the hour');
select is(pg_temp.err($$select report_content('list', 'a1640000-0000-4000-8000-000000000020')$$),
  'PGRST: {"code" : "rate_limited", "message" : "You''ve sent a lot of reports — you can report again in 60 minutes.", "details" : "retry_after_seconds=3600", "hint" : null}',
  'L2 the 11th is refused: SQLSTATE PGRST, plain words, the wait named and machine-readable (golden)');
select is(pg_temp.detail_of($$select report_content('list', 'a1640000-0000-4000-8000-000000000020', 'spam')$$),
  '{"status" : 429, "status_text" : "Too Many Requests", "headers" : {"Retry-After" : "3600"}}',
  'L3 the envelope: HTTP 429 + Retry-After (golden)');
select is(pg_temp.val($$select report_content('list', 'a1640000-0000-4000-8000-000000000010') ->> 'status'$$),
  'already_reported', 'L4 at the limit, a repeat still answers already_reported — it costs nothing');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('rows=%s spent=%s l20=%s', count(*), pg_temp.spent('99164000-0000-4000-8000-000000000007'),
                 count(*) filter (where target_id = 'a1640000-0000-4000-8000-000000000020'))
   from content_reports where reporter_id = '99164000-0000-4000-8000-000000000007'),
  'rows=10 spent=10 l20=0', 'L5 what landed: the ten, not the refused one; the allowance holds exactly ten hits');
select is(
  (select string_agg(format('%s:%s', bucket, (scope = user_id)::text), ',') from rate_limit_hits
   where user_id = '99164000-0000-4000-8000-000000000007'),
  'report:true', 'L6 the allowance is the person''s own (scope = his id), in the report bucket only');
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select report_content('list', 'a1640000-0000-4000-8000-000000000020') ->> 'status'$$),
  'reported', 'L7 another person reporting the same list is unaffected');
reset role;

-- ---------------------------------------------------------------------------
-- R. Mark reviewed — admins only, once
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err(format('select mark_content_report_reviewed(%L)', (select answer ->> 'report_id' from _answers where label = 'S8'))),
  '42501: Only FieldScout admins can review reports.', 'R1 a non-admin cannot review — not even his own report');
select is(pg_temp.err($$select mark_content_report_reviewed('e1640000-0000-4000-8000-0000000000ff')$$),
  '42501: Only FieldScout admins can review reports.', 'R2 …and an unknown id gets the same answer (nothing leaks)');
reset role;
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select mark_content_report_reviewed('e1640000-0000-4000-8000-0000000000ff')$$),
  'P0002: That report isn''t there.', 'R3 an admin asking about a missing report: P0002, never "done"');
insert into _answers select 'R4', mark_content_report_reviewed((select (answer ->> 'report_id')::uuid from _answers where label = 'S8'));
reset role;
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
insert into _answers select 'R5', mark_content_report_reviewed((select (answer ->> 'report_id')::uuid from _answers where label = 'S8'));
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select string_agg(format('%s:%s', label, answer - 'report_id' - 'reviewed_at'), ' | ' order by label)
   from _answers where label in ('R4', 'R5')),
  'R4:{"status": "reviewed", "reviewed_by": "99164000-0000-4000-8000-000000000004"} | '
  || 'R5:{"status": "already_reviewed", "reviewed_by": "99164000-0000-4000-8000-000000000004"}',
  'R4/R5 u4 reviews it; u6 a moment later is told it was already reviewed — by u4 (golden)');
select is(
  (select format('%s|%s|%s', r.reviewed_by, (r.reviewed_at = now())::text,
                 (select ((answer ->> 'reviewed_at')::timestamptz = r.reviewed_at)::text from _answers where label = 'R5'))
   from content_reports r where r.id = (select (answer ->> 'report_id')::uuid from _answers where label = 'S8')),
  '99164000-0000-4000-8000-000000000004|true|true', 'R6 the stamp: who (u4) and when (now) — the second review did not move it');
select is(
  (select string_agg(format('%s|%s|%s|%s|%s', a.actor_id, a.scope, coalesce(a.league_id::text, '-'), a.before,
                            a.after - 'reviewed_at'), ' || ')
   from platform_operator_actions a where a.verb = 'review_content_report'
     and a.after ->> 'report_id' = (select answer ->> 'report_id' from _answers where label = 'S8')),
  format('99164000-0000-4000-8000-000000000004|platform|-|{"list_id": "a1640000-0000-4000-8000-000000000001", "report_id": "%s", "target_id": "a1640000-0000-4000-8000-000000000001", "reviewed_at": null, "reviewed_by": null, "target_type": "list"}|'
         || '{"list_id": "a1640000-0000-4000-8000-000000000001", "report_id": "%s", "target_id": "a1640000-0000-4000-8000-000000000001", "reviewed_by": "99164000-0000-4000-8000-000000000004", "target_type": "list"}',
         (select answer ->> 'report_id' from _answers where label = 'S8'), (select answer ->> 'report_id' from _answers where label = 'S8')),
  'R7 one operator-audit row for the review (none for the already-reviewed call), ids and the stamp only (golden)');
select is(
  (select count(*)::int from platform_operator_actions a
   where a.verb = 'review_content_report'
     and position('x164' in a.before::text || a.after::text || coalesce(a.metadata::text, '')) > 0),
  0, 'R8 no audit row carries a report''s note');
-- Nobody — the server and the table owner included — edits a report or moves its review.
select is(pg_temp.err($$update content_reports set note = 'x164 edited' where id = 'e1640000-0000-4000-8000-000000000001'$$),
  'P0001: A report is never edited — only its review is stamped, once.', 'R9 a report''s words never change');
select is(pg_temp.err($$update content_reports set target_id = 'a1640000-0000-4000-8000-000000000003' where id = 'e1640000-0000-4000-8000-000000000001'$$),
  'P0001: A report is never edited — only its review is stamped, once.', 'R10 …nor what it is about');
select is(pg_temp.err(format($f$update content_reports set reviewed_at = null, reviewed_by = null where id = %L$f$,
                             (select answer ->> 'report_id' from _answers where label = 'S8'))),
  'P0001: This report was already reviewed — its review is never changed.', 'R11 a review cannot be undone');
select is(pg_temp.err(format($f$update content_reports set reviewed_by = '99164000-0000-4000-8000-000000000006' where id = %L$f$,
                             (select answer ->> 'report_id' from _answers where label = 'S8'))),
  'P0001: This report was already reviewed — its review is never changed.', 'R12 …nor handed to someone else');
select is(pg_temp.err($$update content_reports set reviewed_at = now() where id = 'e1640000-0000-4000-8000-000000000001'$$),
  '23514: new row for relation "content_reports" violates check constraint "content_reports_review_pair"',
  'R13 a review is a pair: when without who is refused');

-- ---------------------------------------------------------------------------
-- M. An admin's Remove marks the comment's reports reviewed
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
insert into _answers select 'M0a', report_content('comment', 'c1640000-0000-4000-8000-0000000000a1', 'spam');
reset role;
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
insert into _answers select 'M0b', report_content('comment', 'c1640000-0000-4000-8000-0000000000a7');
insert into _answers select 'M0c', report_content('comment', 'c1640000-0000-4000-8000-0000000000a8');
insert into _answers select 'M0d', report_content('comment', 'c1640000-0000-4000-8000-0000000000a9');
reset role;
-- u6 reviews u5's report on comment a1 before anyone removes it.
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
insert into _answers select 'M0e', mark_content_report_reviewed((select (answer ->> 'report_id')::uuid from _answers where label = 'M0a'));
reset role;

select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select remove_list_comment('a1640000-0000-4000-8000-000000000001', 'c1640000-0000-4000-8000-0000000000a7') - 'removed_at'$$),
  '{"list_id": "a1640000-0000-4000-8000-000000000001", "comment_id": "c1640000-0000-4000-8000-0000000000a7", "removed_as": "author"}',
  'M1 the author removes his reported comment: 213''s answer, golden (no reports_reviewed)');
reset role;
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select remove_list_comment('a1640000-0000-4000-8000-000000000001', 'c1640000-0000-4000-8000-0000000000a8') - 'removed_at'$$),
  '{"list_id": "a1640000-0000-4000-8000-000000000001", "comment_id": "c1640000-0000-4000-8000-0000000000a8", "removed_as": "list_owner"}',
  'M2 a (non-admin) list owner removes one: 213''s answer, golden');
reset role;
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select remove_list_comment('a1640000-0000-4000-8000-000000000001', 'c1640000-0000-4000-8000-0000000000a1') - 'removed_at'$$),
  '{"list_id": "a1640000-0000-4000-8000-000000000001", "comment_id": "c1640000-0000-4000-8000-0000000000a1", "removed_as": "operator", "reports_reviewed": 1}',
  'M3 an admin removes a comment reported twice: one report was already reviewed, so ONE is stamped now (golden)');
select is(pg_temp.val($$select remove_list_comment('a1640000-0000-4000-8000-000000000008', 'c1640000-0000-4000-8000-0000000000a9') - 'removed_at'$$),
  '{"list_id": "a1640000-0000-4000-8000-000000000008", "comment_id": "c1640000-0000-4000-8000-0000000000a9", "removed_as": "list_owner", "reports_reviewed": 1}',
  'M4 an admin removing a reported comment on his OWN list stamps its report too (golden)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select string_agg(format('%s|%s|%s', r.reporter_id, coalesce(r.reviewed_by::text, 'open'),
                            case when r.reviewed_at is null then '-' when r.reviewed_at = c.deleted_at then 'at-removal' else 'earlier' end), ' || '
                     order by r.target_id, r.reporter_id)
   from content_reports r join list_comments c on c.id = r.target_id
   where r.target_type = 'comment'
     and r.target_id in ('c1640000-0000-4000-8000-0000000000a1', 'c1640000-0000-4000-8000-0000000000a7',
                         'c1640000-0000-4000-8000-0000000000a8', 'c1640000-0000-4000-8000-0000000000a9')),
  '99164000-0000-4000-8000-000000000003|99164000-0000-4000-8000-000000000004|at-removal || '
  || '99164000-0000-4000-8000-000000000005|99164000-0000-4000-8000-000000000006|at-removal || '
  || '99164000-0000-4000-8000-000000000003|open|- || '
  || '99164000-0000-4000-8000-000000000003|open|- || '
  || '99164000-0000-4000-8000-000000000003|99164000-0000-4000-8000-000000000004|at-removal',
  'M5 the stamps: u4''s removals stamped the open reports with him at the removal''s instant; u6''s earlier review kept its stamp; the author''s and the list owner''s removals stamped none');
select is(
  (select string_agg(format('%s|%s', a.after ->> 'comment_id', a.metadata), ' || ' order by a.after ->> 'comment_id')
   from platform_operator_actions a where a.verb = 'remove_list_comment'
     and a.after ->> 'list_id' in ('a1640000-0000-4000-8000-000000000001', 'a1640000-0000-4000-8000-000000000008')),
  'c1640000-0000-4000-8000-0000000000a1|{"reports_reviewed": 1}',
  'M6 the operator removal''s audit row records the reports it reviewed; the admin''s own-list removal writes none (213)');
select is(
  (select count(*)::int from content_reports
   where reviewed_at is null and reporter_id in (select ('99164000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 7) i)
     and not (target_type = 'list' and reporter_id = '99164000-0000-4000-8000-000000000007')),
  9, 'M7 every other report is still open — the seed, u3''s shared-list, question and two removed-by-others comments, u1''s, u5''s and u6''s list reports');

-- ---------------------------------------------------------------------------
-- The bell after all of it: still one unread at most per admin.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from (
     select user_id from notifications where type = 'content_report' and not read
       and user_id in (select ('99164000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 7) i)
     group by user_id having count(*) > 1) x),
  0, 'N6 after every report in this file, no admin has more than one unread report alert');
select is(pg_temp.bell(), 'u1=0/0 u2=0/0 u3=0/0 u4=1/3 u5=0/0 u6=1/2 u7=0/0',
  'N7 …and only admins were ever alerted (u4 and u6, one unread each)');

-- ---------------------------------------------------------------------------
-- K. A report outlives what it reports
-- ---------------------------------------------------------------------------
create temp table _kept as select * from content_reports where list_id = 'a1640000-0000-4000-8000-000000000001';
select is((select count(*)::int from _kept), 7,
  'K0 premise: seven reports are about list L1 or its comments (u3''s, u5''s and u6''s on the list; four on three of its comments)');
select set_config('request.jwt.claims', '{"sub": "99164000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$with x as (delete from lists where id = 'a1640000-0000-4000-8000-000000000001' returning 1) select count(*) from x$$),
  '1', 'K1 premise: its owner can still hard-delete his own list from the browser (001''s FOR ALL policy)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('list=%s comments=%s', (select count(*) from lists where id = 'a1640000-0000-4000-8000-000000000001'),
                 (select count(*) from list_comments where list_id = 'a1640000-0000-4000-8000-000000000001'))),
  'list=0 comments=0', 'K2 the list and its comments are gone');
select is(
  (select count(*)::int from content_reports c join _kept k using (id)
   where (c.reporter_id, c.target_type, c.target_id, c.list_id, c.reason, c.note, c.created_at, c.reviewed_at, c.reviewed_by)
         is not distinct from (k.reporter_id, k.target_type, k.target_id, k.list_id, k.reason, k.note, k.created_at, k.reviewed_at, k.reviewed_by)),
  7, 'K3 …and all seven reports about them are still there, byte-unchanged (no cascade)');

select * from finish();
rollback;
