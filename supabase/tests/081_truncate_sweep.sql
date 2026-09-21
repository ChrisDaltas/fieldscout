-- ============================================================================
-- THE TRUNCATE SWEEP — pgTAP 081 (migration 133; task L.E1.17; PROGRESS F349
-- / R998 / D350 / D367).
--
-- RLS does not gate TRUNCATE, so the GRANT is the only wall. This suite is
-- the standing enforcer: section A is COMPLETE BY CONSTRUCTION — it reads the
-- catalog for the whole schema, so it goes red, naming the table, the day a
-- table reaches `public` with the grant (by any owner, any path), whether or
-- not its author remembered D350's per-table REVOKE.
--
--   A. schema-wide: no ordinary/partitioned `public` table grants TRUNCATE to
--      anon / authenticated / PUBLIC (three independent readings).
--   B. the SOURCE: a table created NOW, as the migration-owner role, is born
--      without the grant (133's ALTER DEFAULT PRIVILEGES) — and born WITH the
--      other seven, and with service_role's eight. Plus the measured limit:
--      postgres may not alter supabase_admin's defaults.
--   C. positive controls — the revoke removed TRUNCATE and NOTHING else.
--   D. behaviour, not catalog: an actual TRUNCATE as each API role is 42501,
--      on named tables and then on EVERY table (F349's reachability count,
--      57 of 67 when filed, must be 0).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

-- ---------------------------------------------------------------------------
-- A. COMPLETE BY CONSTRUCTION.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select c.relname::text, r.rolname
       from pg_class c
       cross join (values ('anon'), ('authenticated')) r(rolname)
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p')
        and has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
      order by 1, 2 $$,
  'A1 NO public table grants TRUNCATE to anon or authenticated (effective privilege, whole schema — a new table without the revoke reds this BY NAME)'
);
-- F349's own query, verbatim in shape: pg_tables ⋈ role_table_grants.
select is_empty(
  $$ select t.tablename::text, g.grantee::text
       from pg_tables t
       join information_schema.role_table_grants g
         on g.table_schema = t.schemaname and g.table_name = t.tablename
      where t.schemaname = 'public'
        and g.privilege_type = 'TRUNCATE'
        and g.grantee in ('anon', 'authenticated')
      order by 1, 2 $$,
  'A2 F349''s measurement query returns ZERO rows (was 64 tables x 2 roles at the 132 head)'
);
select is_empty(
  $$ select c.relname::text
       from pg_class c, aclexplode(c.relacl) a
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p')
        and a.privilege_type = 'TRUNCATE' and a.grantee = 0 $$,
  'A3 no public table grants TRUNCATE to the PUBLIC pseudo-role either (has_table_privilege would hide nothing, but the ACL is read directly)'
);
-- Non-vacuity: the sweep is over a real schema, not an empty one.
select cmp_ok(
  (select count(*)::int from pg_tables where schemaname = 'public'), '>=', 72,
  'A4 the schema under test holds at least the 72 tables measured at the 132 head'
);

-- ---------------------------------------------------------------------------
-- B. THE SOURCE IS FIXED — a table born now does not carry the grant.
-- ---------------------------------------------------------------------------
select is(current_user::text, 'postgres',
  'B0 premise: this suite runs as postgres — the role that owns every public table and runs every migration');
select is_empty(
  $$ select tablename::text, tableowner::text from pg_tables
      where schemaname = 'public' and tableowner <> 'postgres' $$,
  'B1 premise: every public table is owned by postgres, so postgres'' default ACL is the one that matters'
);

create table public._truncate_canary (id int primary key);
alter table public._truncate_canary enable row level security;

select ok(
  not has_table_privilege('anon', 'public._truncate_canary', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public._truncate_canary', 'TRUNCATE'),
  'B2 a table created NOW by postgres grants TRUNCATE to NEITHER anon NOR authenticated (133''s ALTER DEFAULT PRIVILEGES)'
);
select ok(
  (select bool_and(has_table_privilege(r.rolname, 'public._truncate_canary', p.priv))
     from (values ('anon'), ('authenticated')) r(rolname)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                 ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)),
  'B3 ...and is still born with the other SEVEN privileges for both roles (the 037 model minus exactly one letter)'
);
select ok(
  has_table_privilege('service_role', 'public._truncate_canary', 'TRUNCATE'),
  'B4 ...and service_role is still born WITH TRUNCATE (the default for it is untouched)'
);
-- The measured limit, pinned so the PR's claim is evidence and not prose:
-- a migration cannot fix supabase_admin's identical default ACL.
select throws_ok(
  $$ alter default privileges for role supabase_admin in schema public
       revoke truncate on tables from anon, authenticated $$,
  '42501', null,
  'B5 LIMIT: postgres may NOT alter supabase_admin''s default privileges (42501) — section A, not the default, is what catches a supabase_admin-created table'
);

-- ---------------------------------------------------------------------------
-- C. POSITIVE CONTROLS — TRUNCATE and nothing else.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and has_table_privilege('service_role', format('%I.%I', t.schemaname, t.tablename), 'TRUNCATE')),
  (select count(*)::int from pg_tables where schemaname = 'public'),
  'C1 service_role still holds TRUNCATE on EVERY public table'
);
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and has_table_privilege('postgres', format('%I.%I', t.schemaname, t.tablename), 'TRUNCATE')),
  (select count(*)::int from pg_tables where schemaname = 'public'),
  'C2 postgres (seeds, db reset, sync) still holds TRUNCATE on EVERY public table'
);
-- Before the sweep both roles held each of these seven on 72 of 72 tables
-- (measured, PR body). After it, any missing triple is named here.
select is_empty(
  $$ select t.tablename::text, r.rolname, p.priv
       from pg_tables t
       cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)
      where t.schemaname = 'public'
        and not has_table_privilege(r.rolname, format('%I.%I', t.schemaname, t.tablename), p.priv)
      order by 1, 2, 3 $$,
  'C3 every one of the SEVEN non-TRUNCATE privileges is still held by all three API roles on EVERY public table — the revoke removed nothing else'
);

-- ---------------------------------------------------------------------------
-- D. BEHAVIOUR. A helper that attempts TRUNCATE ... CASCADE on every public
--    table AS THE CALLER (SECURITY INVOKER), each in its own subtransaction.
--    A TRUNCATE that SUCCEEDS is counted and then undone by a sentinel raise,
--    so a red run cannot empty the tables the later cells read.
-- ---------------------------------------------------------------------------
create function public._truncate_sweep_attempt()
returns table (refused int, succeeded int, other int, succeeded_on text)
language plpgsql security invoker set search_path = '' as $fn$
declare
  v_t record;
begin
  refused := 0; succeeded := 0; other := 0; succeeded_on := '';
  for v_t in
    select tablename from pg_catalog.pg_tables where schemaname = 'public' order by 1
  loop
    begin
      execute pg_catalog.format('truncate table public.%I cascade', v_t.tablename);
      raise exception 'sentinel' using errcode = 'XTRNC';
    exception
      when insufficient_privilege then refused := refused + 1;
      when sqlstate 'XTRNC' then
        succeeded := succeeded + 1;
        succeeded_on := succeeded_on || v_t.tablename || ' ';
      when others then other := other + 1;
    end;
  end loop;
  return next;
end;
$fn$;

set local role authenticated;
select throws_ok($$ truncate table public.players $$, '42501', null,
  'D1 authenticated: TRUNCATE players is refused 42501');
select throws_ok($$ truncate table public.leagues cascade $$, '42501', null,
  'D2 authenticated: TRUNCATE leagues CASCADE is refused 42501');
select throws_ok($$ truncate table public.lists cascade $$, '42501', null,
  'D3 authenticated: TRUNCATE lists CASCADE is refused 42501 — on its OWN grant now, not by the accident of a CASCADE reaching commissioner_actions (F349)');
select is(
  (select row(a.refused, a.succeeded, a.other, a.succeeded_on)::text
     from public._truncate_sweep_attempt() a),
  (select row(count(*)::int, 0, 0, '')::text from pg_catalog.pg_tables where schemaname = 'public'),
  'D4 authenticated: TRUNCATE ... CASCADE attempted on EVERY public table — all refused 42501, zero succeed (F349 measured 57 of 67 succeeding)'
);
reset role;

set local role anon;
select throws_ok($$ truncate table public.profiles cascade $$, '42501', null,
  'D5 anon: TRUNCATE profiles CASCADE is refused 42501');
select is(
  (select row(a.refused, a.succeeded, a.other, a.succeeded_on)::text
     from public._truncate_sweep_attempt() a),
  (select row(count(*)::int, 0, 0, '')::text from pg_catalog.pg_tables where schemaname = 'public'),
  'D6 anon: TRUNCATE ... CASCADE attempted on EVERY public table — all refused 42501, zero succeed'
);
reset role;

select * from finish();

rollback;
