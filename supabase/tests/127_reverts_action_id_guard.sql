-- ============================================================================
-- 127 — commissioner_actions.reverts_action_id's guard (migration 179;
--       M6 follow-up F520; spec §10.3, §10.4, §12.12; PROGRESS D451(5), D475)
-- ============================================================================
-- What this file proves, over REAL inserts in one rolled-back transaction:
--   §A  FORM — the guard is a plain trigger body (not DEFINER), search_path
--       '', EXECUTE held by no client role; one BEFORE INSERT row trigger
--       with its WHEN clause, ENABLE ALWAYS (R616); 170's ten pointer guards
--       (118 A6 / A7's census) are untouched.
--   §G  THE RULE — a revert naming an earlier receipt of its OWN league
--       lands (RETURNING 1); one naming another league's receipt, the
--       receipt itself, or no receipt at all is refused P0001 by name; a
--       receipt with no pointer is unchanged; an UPDATE that sets the
--       pointer on an existing receipt is still refused by 123's
--       immutability trigger.
-- Break probe (§4.3): drop the league comparison in 179 ⇒ G2 reds (shown in
-- the PR, reverted).
-- World: league L b1270000…01 (u1), league LO b1270000…02 (u2); receipts
-- R1 (L) and R2 (LO).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select format('%s:%s:%s', p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_action_reverts_guard_internal'),
  'f:search_path="":f',
  'A1 the guard is a plain trigger body, search_path '''', EXECUTE revoked from anon / authenticated');
select is(
  (select format('%s|%s', t.tgenabled, pg_get_triggerdef(t.oid))
   from pg_trigger t where t.tgname = 'trg_zz_reverts_action_id_league_check' and not t.tgisinternal),
  'A|CREATE TRIGGER trg_zz_reverts_action_id_league_check BEFORE INSERT ON public.commissioner_actions FOR EACH ROW WHEN ((new.reverts_action_id IS NOT NULL)) EXECUTE FUNCTION commish_action_reverts_guard_internal()',
  'A2 one BEFORE INSERT row trigger on the log, WHEN the pointer is set, ENABLE ALWAYS');
select is(
  (select count(*)::int from pg_trigger t where t.tgname like 'trg\_zz\_%\_guard\_%' and not t.tgisinternal),
  10,
  'A3 170''s ten pointer guards untouched — 118 A6 / A7''s census still counts ten');

-- ---------------------------------------------------------------------------
-- B. The world
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('99127000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-x127-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "x127_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 2) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings, scoring_rules_snapshot) values
  ('b1270000-0000-4000-8000-000000000001', '99127000-0000-4000-8000-000000000001', 'pgtap-x127-L', 2026, 'drafting', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), '{}', '{}'),
  ('b1270000-0000-4000-8000-000000000002', '99127000-0000-4000-8000-000000000002', 'pgtap-x127-LO', 2026, 'drafting', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), '{}', '{}');

insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, reason) values
  ('a1270000-0000-4000-8000-000000000001', 'b1270000-0000-4000-8000-000000000001', '99127000-0000-4000-8000-000000000001', 'edit_score', 'matchup', 'x127 R1'),
  ('a1270000-0000-4000-8000-000000000002', 'b1270000-0000-4000-8000-000000000002', '99127000-0000-4000-8000-000000000002', 'edit_score', 'matchup', 'x127 R2');

create temp table r127 (tag text, n int);

-- ---------------------------------------------------------------------------
-- G. The rule
-- ---------------------------------------------------------------------------
with ins as (
  insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, reason, reverts_action_id)
  values ('a1270000-0000-4000-8000-000000000011', 'b1270000-0000-4000-8000-000000000001', '99127000-0000-4000-8000-000000000001',
          'edit_score', 'matchup', 'x127 undo R1', 'a1270000-0000-4000-8000-000000000001')
  returning 1)
insert into r127 select 'G1', count(*)::int from ins;
select is((select n from r127 where tag = 'G1'), 1, 'G1 a revert of an earlier receipt of its OWN league lands (RETURNING 1)');

select throws_ok(
  $$ insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, reason, reverts_action_id)
     values ('a1270000-0000-4000-8000-000000000012', 'b1270000-0000-4000-8000-000000000001', '99127000-0000-4000-8000-000000000001',
             'edit_score', 'matchup', 'x127 cross', 'a1270000-0000-4000-8000-000000000002') $$,
  'P0001',
  'commissioner_actions.reverts_action_id on receipt a1270000-0000-4000-8000-000000000012 names a1270000-0000-4000-8000-000000000002 (league b1270000-0000-4000-8000-000000000002), not a receipt of league b1270000-0000-4000-8000-000000000001: a revert points back only at a receipt of its own league (F520; §10.4, §12.12)',
  'G2 a revert naming ANOTHER league''s receipt is refused by name');
select throws_ok(
  $$ insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, reason, reverts_action_id)
     values ('a1270000-0000-4000-8000-000000000013', 'b1270000-0000-4000-8000-000000000001', '99127000-0000-4000-8000-000000000001',
             'edit_score', 'matchup', 'x127 self', 'a1270000-0000-4000-8000-000000000013') $$,
  'P0001',
  'commissioner_actions.reverts_action_id on receipt a1270000-0000-4000-8000-000000000013 names the receipt itself: a revert points back at an EARLIER receipt of its own league (F520; §10.4, §12.12)',
  'G3 a receipt that "reverts" itself is refused by name (the FK alone would accept it)');
select throws_ok(
  $$ insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, reason, reverts_action_id)
     values ('a1270000-0000-4000-8000-000000000014', 'b1270000-0000-4000-8000-000000000001', '99127000-0000-4000-8000-000000000001',
             'edit_score', 'matchup', 'x127 ghost', 'a1270000-0000-4000-8000-0000000000ff') $$,
  'P0001',
  'commissioner_actions.reverts_action_id on receipt a1270000-0000-4000-8000-000000000014 names a1270000-0000-4000-8000-0000000000ff (league none — no such receipt), not a receipt of league b1270000-0000-4000-8000-000000000001: a revert points back only at a receipt of its own league (F520; §10.4, §12.12)',
  'G4 a revert naming no receipt at all is refused by name (before the FK)');
select is(
  (select count(*)::int from commissioner_actions where id in ('a1270000-0000-4000-8000-000000000012', 'a1270000-0000-4000-8000-000000000013', 'a1270000-0000-4000-8000-000000000014')),
  0,
  'G5 …and none of the three refused receipts was written');

with ins as (
  insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, reason)
  values ('a1270000-0000-4000-8000-000000000015', 'b1270000-0000-4000-8000-000000000002', '99127000-0000-4000-8000-000000000002',
          'edit_score', 'matchup', 'x127 plain')
  returning 1)
insert into r127 select 'G6', count(*)::int from ins;
select is((select n from r127 where tag = 'G6'), 1, 'G6 a receipt with no pointer is unchanged (RETURNING 1) — the WHEN clause skips it');

select throws_ok(
  $$ update commissioner_actions set reverts_action_id = 'a1270000-0000-4000-8000-000000000001'
     where id = 'a1270000-0000-4000-8000-000000000015' $$,
  'P0001',
  null,
  'G7 setting the pointer on an existing receipt is still refused — 123''s immutability trigger (no UPDATE twin needed)');
select is(
  (select reverts_action_id from commissioner_actions where id = 'a1270000-0000-4000-8000-000000000015'),
  null,
  'G8 …and the receipt is unchanged');

select * from finish();
rollback;
