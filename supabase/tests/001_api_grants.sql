-- ============================================================================
-- API-role grant surface — L.A0.5c (migration 037; resolves D18).
--
-- Production's grant model (verified 2026-07-19): anon/authenticated/
-- service_role hold table privileges everywhere and postgres-owned default
-- ACLs extend that to future objects — RLS is the effective gate for tables
-- (spec §12; SECURITY DEFINER routines need in-body auth instead — see 038
-- and test 002). Migration 037 versions that model; this test pins it so a
-- CLI behavior change (e.g. the 2026-10-30 always-revoke default) fails
-- loudly here instead of as confusing 42501s scattered through the policy
-- tests.
--
-- Strengthened per review findings R3/R4 (2026-07-19): full-privilege pins
-- (all 8 table privileges, arwdDxtm incl. PG17 MAINTAIN), sequence coverage
-- via an identity canary, an existing-routine catch-up witness, and a global
-- RLS backstop — under the default-ACL model a table that forgets ENABLE ROW
-- LEVEL SECURITY ships fail-open, so its absence must fail a machine check.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

-- R3 backstop: the 037 model grants broadly, so RLS-off = anon full access.
-- Every public table must have RLS enabled (spec §12) — no exceptions.
select is_empty(
  $$ select tablename from pg_tables
     where schemaname = 'public' and not rowsecurity $$,
  'every public table has RLS enabled — fail-open backstop under the 037 grant model (R3)'
);

-- Catch-up grants on the existing surface (player_stats as the D18 witness):
-- the FULL privilege set, all three API roles (R4 — not just a SELECT sample).
-- RE-CUT by migration 133 (L.E1.17 / F349): RLS does not gate TRUNCATE, so
-- anon/authenticated no longer hold it — the other SEVEN stand, service_role
-- keeps all EIGHT. pgTAP 081 owns the schema-wide TRUNCATE assertion; these
-- pins only keep the 037 model honest about what it still grants.
select ok(
  (select bool_and(has_table_privilege(r.rolename, 'public.player_stats', p.priv)
                   = not (p.priv = 'TRUNCATE' and r.rolename <> 'service_role'))
   from (values ('anon'), ('authenticated'), ('service_role')) r(rolename)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
               ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)),
  'player_stats: service_role holds all 8 table privileges; anon/authenticated hold exactly the 7 that are not TRUNCATE (037 catch-up, amended by 133)'
);
select ok(has_table_privilege('anon', 'public.player_stats', 'INSERT'),
  'anon holds INSERT on player_stats — RLS, not grants, is what denies writes');

-- Existing-routine catch-up witness (037 line: GRANT ALL ON ALL ROUTINES):
-- the 004 reorder RPC predates 037 and must carry EXECUTE (R4).
select ok(
  has_function_privilege('authenticated', 'public.reorder_list_players(uuid, jsonb)', 'EXECUTE'),
  'authenticated holds EXECUTE on pre-037 routine reorder_list_players (037 catch-up)'
);
-- Note: no sequence predates 037 (001–036 use uuid PKs), so the sequence
-- catch-up GRANT has no existing object to witness — it is defensive. The
-- default-ACL sequence path is pinned below via the identity canary.

-- Default ACLs fire for objects created AFTER 037 (the D18 failure mode:
-- without them, every new leagues table would 42501 on missing grants).
-- Identity column so the canary also creates a sequence (R4).
create table public._grants_canary (id int generated always as identity primary key);
alter table public._grants_canary enable row level security;
create function public._grants_canary_fn() returns int
  language sql as 'select 1';

select ok(
  (select bool_and(has_table_privilege(r.rolename, 'public._grants_canary', p.priv)
                   = not (p.priv = 'TRUNCATE' and r.rolename <> 'service_role'))
   from (values ('anon'), ('authenticated'), ('service_role')) r(rolename)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
               ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)),
  'future table auto-grants 8 privileges to service_role and the 7 non-TRUNCATE ones to anon/authenticated (037 table default ACL, amended by 133)'
);
select ok(
  (select bool_and(has_sequence_privilege(r.rolename, 'public._grants_canary_id_seq', p.priv))
   from (values ('anon'), ('authenticated'), ('service_role')) r(rolename)
   cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) p(priv)),
  'future sequence auto-grants USAGE/SELECT/UPDATE to all 3 API roles (037 sequence default ACL, R4)'
);
select ok(
  (select bool_and(has_function_privilege(r.rolename, 'public._grants_canary_fn()', 'EXECUTE'))
   from (values ('anon'), ('authenticated'), ('service_role')) r(rolename)),
  'future function auto-grants EXECUTE to all 3 API roles (037 routine default ACL)'
);

-- Grants are not access: RLS still gates the canary (no policies).
set local role anon;

select is(
  (select count(*)::int from public._grants_canary), 0,
  'RLS with no policy hides rows from anon despite the grant'
);
select throws_ok(
  $$ insert into public._grants_canary default values $$,
  '42501',
  null,
  'RLS with no policy denies anon INSERT despite the grant'
);

reset role;

-- The identity sequence really is usable by an API role once RLS admits the
-- table write path (sanity that sequence grants are functional, not just
-- catalog rows): postgres inserts, currval-style check via the role.
insert into public._grants_canary default values;
set local role authenticated;
select lives_ok(
  $$ select last_value from public._grants_canary_id_seq $$,
  'authenticated can read the canary identity sequence (037 sequence default ACL)'
);
reset role;

-- Redundant single-priv spot checks kept from the original suite (cheap, and
-- they localize a failure faster than the aggregated pins above).
select ok(has_table_privilege('anon', 'public._grants_canary', 'SELECT'),
  'future table auto-grants SELECT to anon (037 default ACL)');
select ok(has_function_privilege('authenticated', 'public._grants_canary_fn()', 'EXECUTE'),
  'future function auto-grants EXECUTE to authenticated (037 default ACL)');

select * from finish();

rollback;
