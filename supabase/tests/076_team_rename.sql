-- ============================================================================
-- pgTAP 076 — migration 128: `commish_rename_team` + `rename_own_team`
-- (task L.E1.7 of M6A; tasks-M6A §6 "L.E1.7" PROOF, §4 rules 1-15;
-- PROGRESS §3 standing rule (b)/(d)/(i) + Q53(e)(i); `spec:183`.)
--
-- WHAT THIS SUITE IS ORGANISED TO PROVE, IN THE ORDER THE BREAKDOWN ASKS FOR
-- IT:
--   §C  THE GAP, ASSERTED BEFORE THE VERB CLOSES IT — WITH ITS PREMISE AND A
--       POSITIVE CONTROL (§4 rules 14(c) and 15: a 0-row UPDATE asserts WHY,
--       never merely THAT). (i) the row exists, is readable under the owner's
--       own JWT, and is a LEAGUE team; (ii) that role's `UPDATE teams SET
--       name … RETURNING id` touches ZERO rows, because `095:636-639`'s only
--       UPDATE policy on the table is `USING (auth.uid() = owner_id AND
--       league_id IS NULL)` and the second conjunct excludes this row;
--       (iii) THE POSITIVE CONTROL — the same role, in the same transaction,
--       renaming a STANDALONE team it owns touches exactly ONE row. Without
--       (i) and (iii) the zero in (ii) is unattributable: an empty fixture, a
--       wrong id, or a `set role` that never took would all produce it.
--   §E  the verb renaming, and its receipt.
--   §F  the MANAGER's own rename — THE DROP SEAM's cells. If the manager arm
--       is dropped, delete §F (F1-F9) whole, drop `rename_own_team` /
--       `rename_own_team_internal` from A6's expected count (5 → 3) and from
--       the name lists in A7, A8, A11, A12, delete A10 and A14, and take
--       `plan(89)` down to 78.
--   §G  Chris's one condition: a SECOND identical call writes NO audit row and
--       NO chat post while the replay LEDGER row IS written; plus the
--       byte-identical replay on a real change.
--   §H  THE PROPAGATION FINDING — an already-written receipt and an
--       already-written chat post keep the OLD name (item 4).
--   §D  the reason gate and the NAME gate, one unit either side (071 §D).
--       It sits AFTER §E-§H, not before them, for a measured reason: D5 (the
--       100-character boundary that must LIVE) writes a real receipt, and
--       `commissioner_actions` is append-only — 123:339-410's ENABLE ALWAYS
--       trigger refuses the DELETE that would have tidied it away (proven the
--       hard way while writing this suite). So the gate cells run where their
--       one successful call cannot move a count another section asserts.
--   §I  THE SEALED FRANCHISE refused BY NAME (`spec:183`) — the BREAK PROBE's
--       target.
--   §J  AUTH — one no-leak 42501 for every caller who is not a commissioner
--       of this league (071 §F).
--   §K  NEVER-WEAKEN PINS (§4 rule 13): 095's policy and `set_lineup_internal`
--       are not touched by this migration, and these cells are what makes
--       that claim falsifiable.
--
-- NO CALENDAR IS SEEDED ON PURPOSE. A franchise name is not gated by the
-- week, the per-player kickoff lock or the scoring snapshot (migration 128's
-- `bypassed_why` says so in the document), so a fixture that seeded
-- `nfl_weeks` / `league_weeks` would be scenery. If either verb ever grows a
-- calendar dependency, it fails here loudly rather than passing on scenery.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(89);

-- ---------------------------------------------------------------------------
-- A. FORM PINS — the ledger (D350), the two doors, the shared normalizer and
--    the two internals (§4.1 grants doctrine; §4 rule 12).
-- ---------------------------------------------------------------------------
select has_table('public', 'commish_team_actions',
  'A1 commish_team_actions exists — this verb family''s OWN replay ledger (D350: no two verbs share a (league_id, action_id) namespace, or a retry would replay the WRONG verb''s result)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'commish_team_actions'),
  0, 'A2 …with ZERO policies: the DEFINER verb is its only reader and writer, so no client can pre-plant a replay row (the attack commissioner_actions'' printed INSERT policy makes possible — 123:333-335)');
select ok(
  exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
          where r.relname = 'commish_team_actions' and c.contype = 'u'
            and pg_get_constraintdef(c.oid) = 'UNIQUE (league_id, action_id)'),
  'A3 …and UNIQUE (league_id, action_id) is the race backstop behind the select-then-insert');
-- D350 / F348's lesson: RLS does NOT cover TRUNCATE and a pg_policies cell
-- structurally cannot see the grant, so this is asserted PER ROLE.
select ok(
  not has_table_privilege('anon', 'public.commish_team_actions', 'TRUNCATE'),
  'A4 REVOKE TRUNCATE — anon holds no TRUNCATE on the ledger (RLS does not cover TRUNCATE and the Supabase default grants it; F348 is the table that proved it)');
select ok(
  not has_table_privilege('authenticated', 'public.commish_team_actions', 'TRUNCATE'),
  'A5 …and neither does authenticated (asserted per role with has_table_privilege — a pg_policies cell cannot see a TRUNCATE grant at all)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_rename_team', 'commish_rename_team_internal',
                       'rename_own_team', 'rename_own_team_internal',
                       'team_rename_normalize_internal')),
  5, 'A6 the five 128 functions exist, ONE overload each');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_rename_team', 'rename_own_team')),
  'A7 both client doors are SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_rename_team_internal', 'rename_own_team_internal',
                       'team_rename_normalize_internal')),
  'A8 all three internals are PLAIN with search_path='''' — a seam, not a door (123:498-505''s posture)');
select ok(
  not has_function_privilege('anon', 'public.commish_rename_team(uuid,uuid,text,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_rename_team(uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'A9 commish_rename_team: anon holds no EXECUTE (REVOKE FROM PUBLIC, anon); authenticated may call — the commissioner check is IN-BODY');
select ok(
  not has_function_privilege('anon', 'public.rename_own_team(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.rename_own_team(uuid,text)', 'EXECUTE'),
  'A10 rename_own_team: the same posture — the manager gate is IN-BODY');
select ok(
  not has_function_privilege('authenticated', 'public.commish_rename_team_internal(uuid,uuid,text,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_rename_team_internal(uuid,uuid,text,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.rename_own_team_internal(uuid,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.rename_own_team_internal(uuid,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.team_rename_normalize_internal(text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.team_rename_normalize_internal(text,text)', 'EXECUTE'),
  'A11 all three internals are triple-REVOKEd — no client can supply the instant (rule 10: the p_at seam is postgres-only)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_rename_team_internal', 'rename_own_team_internal')
     and p.prosrc like '%team_managers%'),
  0, 'A12 F35 re-affirmed: NO 128 function body names team_managers — access derives from league_members, never a stint');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_rename_team_internal'
     and p.prosrc like '%log_commissioner_action_internal%'),
  1, 'A13 the commissioner verb writes its receipt through the ONE shared logging helper (123:417-453), never a second INSERT into commissioner_actions');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rename_own_team_internal'
     and p.prosrc like '%log_commissioner_action_internal%'),
  0, 'A14 …and the MANAGER''s verb writes NONE: renaming his own franchise is not a §10.1 commissioner power, so it consumes no audit row (and the response says so in `audited_why`)');

-- ---------------------------------------------------------------------------
-- B. FIXTURES (postgres context — before any JWT claims), and their PREMISES.
--    L1 (in_season): T1 'CR Commish' u1 (commissioner) · T2 'CR Alpha' u2 ·
--    T3 'CR Bravo' u3 · T4 'CR Sealed' RETIRED with successor T5 'CR
--    Successor' (orphaned, an unclaimed placeholder seat). u5 is a member of
--    L1 with NO team; u4 is an outsider. S1 'Solo Squad' is u2's STANDALONE
--    team (league_id IS NULL) and exists ONLY to be §C's positive control.
--
--    T4 carries NO league_members row, and that is not an oversight — it is
--    what `remove_manager`'s retire arm produces: `120:565-570` re-points the
--    seat's row at the SUCCESSOR with `user_id = NULL`. §F7 depends on it.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9f000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-tr' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'tr_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id,
                     scoring_rules_snapshot, lineup_lock, waiver_type, settings, roster_settings) values
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'pgtap-tr-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab', '{}'::jsonb, '{}'::jsonb);

-- created_at / updated_at are stamped TEN DAYS AGO on purpose. pgTAP runs
-- inside ONE transaction, so `now()` is frozen for the whole suite: a fixture
-- taking the DEFAULT now() would make "updated_at moved" (E4) and "updated_at
-- did NOT move" (G11) both compare now() with now(), and both cells would pass
-- whatever the code did (§4 rule 14 — no cell may pass on a fixture that
-- cannot distinguish the outcomes).
insert into teams (id, owner_id, name, league_id, list_id, status, successor_team_id, created_at, updated_at) values
 ('cf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'CR Commish',   'bf000000-0000-4000-8000-000000000001', null, 'active',   null, now() - interval '10 days', now() - interval '10 days'),
 ('cf000000-0000-4000-8000-000000000002', '9f000000-0000-4000-8000-000000000002', 'CR Alpha',     'bf000000-0000-4000-8000-000000000001', null, 'active',   null, now() - interval '10 days', now() - interval '10 days'),
 ('cf000000-0000-4000-8000-000000000003', '9f000000-0000-4000-8000-000000000003', 'CR Bravo',     'bf000000-0000-4000-8000-000000000001', null, 'active',   null, now() - interval '10 days', now() - interval '10 days'),
 ('cf000000-0000-4000-8000-000000000005', '9f000000-0000-4000-8000-000000000001', 'CR Successor', 'bf000000-0000-4000-8000-000000000001', null, 'orphaned', null, now() - interval '10 days', now() - interval '10 days'),
 ('cf000000-0000-4000-8000-000000000004', '9f000000-0000-4000-8000-000000000001', 'CR Sealed',    'bf000000-0000-4000-8000-000000000001', null, 'retired',  'cf000000-0000-4000-8000-000000000005', now() - interval '10 days', now() - interval '10 days'),
 -- u2's STANDALONE team: league_id IS NULL, so 095:636-639's UPDATE policy
 -- DOES match it. §C3's positive control and nothing else.
 ('cf000000-0000-4000-8000-000000000006', '9f000000-0000-4000-8000-000000000002', 'Solo Squad',   null, null, 'active', null, now() - interval '10 days', now() - interval '10 days');

insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'commissioner', false),
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000002', 'manager',      false),
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000003', 'manager',      false),
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000005', null,                                   'manager',      false),
 -- The retired franchise's seat, re-pointed at the SUCCESSOR with user_id
 -- NULL — 120:564-570's shape, reproduced exactly. T4 gets no row.
 ('bf000000-0000-4000-8000-000000000001', null, 'cf000000-0000-4000-8000-000000000005', 'manager', true);

select is((select count(*)::int from league_members
           where league_id = 'bf000000-0000-4000-8000-000000000001'
             and team_id = 'cf000000-0000-4000-8000-000000000004'),
  0, 'B1 PREMISE for §F7: the RETIRED franchise carries NO league_members row at all — 120:564-570 re-points the seat at the successor with user_id NULL, which is why rename_own_team needs no retired guard (§4 rule 14(b): a guard an outer gate has already excluded is replaced by the assertion that it is excluded)');
select is((select status from teams where id = 'cf000000-0000-4000-8000-000000000004'),
  'retired', 'B2 PREMISE for §I: T4 really is `retired` — the §I refusal is about a state that exists in the fixture, not a spelling');
select is((select count(*)::int from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  0, 'B3 PREMISE: this league starts with ZERO commissioner_actions rows, so every "a receipt was written" cell below counts something this suite caused');

-- ---------------------------------------------------------------------------
-- C. THE GAP, ASSERTED BEFORE THE VERB CLOSES IT — F338, with its premise and
--    a positive control. This is the cell the breakdown rewrote after finding
--    the first draft's version vacuous: a 0-row UPDATE must assert WHY.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  (select count(*)::int from teams
   where id = 'cf000000-0000-4000-8000-000000000002' and league_id is not null),
  1, 'C1 (i) PREMISE — under `set role authenticated` with T2''s OWNER''s own JWT the row is readable, exists exactly once, AND has a non-NULL league_id: it is a LEAGUE franchise. Without this the zero in C2 could just be an empty fixture or a wrong id');
-- A data-modifying CTE is legal only at the TOP LEVEL of a statement, so the
-- affected-row counts go into a scratch table rather than a scalar subquery
-- (071 §C's pattern — the house no-write-policy shape, RETURNING-counted).
create temp table _rename_probe (op text, n int);
with u as (update teams set name = 'HAND-EDITED' where id = 'cf000000-0000-4000-8000-000000000002' returning id)
insert into _rename_probe select 'league_team', count(*)::int from u;
with u as (update teams set name = 'Solo Squad Renamed' where id = 'cf000000-0000-4000-8000-000000000006' returning id)
insert into _rename_probe select 'standalone', count(*)::int from u;

select is((select n from _rename_probe where op = 'league_team'),
  0, 'C2 (ii) THE GAP: that same role''s UPDATE … RETURNING id touches ZERO rows. THE REASON, NAMED: the only UPDATE policy on `teams` in the whole chain is 095:636-639, `USING (auth.uid() = owner_id AND league_id IS NULL)`, and the SECOND conjunct excludes every league franchise — so a league team''s name is written once at INSERT and is thereafter unchangeable by any role short of the table owner (F338)');
select is((select n from _rename_probe where op = 'standalone'),
  1, 'C3 (iii) THE POSITIVE CONTROL: the SAME role, in the SAME transaction, renaming a STANDALONE team it owns (league_id IS NULL) touches exactly ONE row. So C2''s zero is attributable to the policy predicate — not to a wrong id, a missing fixture, or a `set role` that never took');
select is((select name from teams where id = 'cf000000-0000-4000-8000-000000000002'),
  'CR Alpha', 'C4 …and C2 really wrote nothing: T2 still reads its INSERT-time name');

reset role;
select set_config('request.jwt.claims', '', true);
-- Undo C3's control write so no later cell reads a name this section changed.
update teams set name = 'Solo Squad' where id = 'cf000000-0000-4000-8000-000000000006';

-- ---------------------------------------------------------------------------
-- E. THE VERB RENAMES, AND ITS RECEIPT. The gap §C measured is closed here.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.tr_e1',
  (select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
     'cf000000-0000-4000-8000-000000000002', '  Alpha Reborn  ', 'paper draft: the owner picked a name',
     '0f000000-0000-4000-8000-000000000010'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);

select is((select name from teams where id = 'cf000000-0000-4000-8000-000000000002'),
  'Alpha Reborn', 'E1 THE GAP IS CLOSED: the franchise §C could not rename is renamed — and the stored value is TRIMMED, so a leading/trailing space in the request is not a different name');
select is(current_setting('pgtap.tr_e1')::jsonb ->> 'no_changes', 'false',
  'E2 …the document says a change happened, by value');
select is(current_setting('pgtap.tr_e1')::jsonb ->> 'previous_name', 'CR Alpha',
  'E3 …and carries the name it replaced, so the caller can show "X is now Y" without a second read');
select is((select updated_at > created_at from teams where id = 'cf000000-0000-4000-8000-000000000002'),
  true, 'E4 …and `updated_at` moved with it (the p_at seam, passed now() by the DEFINER door — D307(3))');
select is((select count(*)::int from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  1, 'E5 EXACTLY ONE audit row — written INSIDE the no-op guard and AFTER the state write (D336 part 2)');
select is((select action_type from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'reassign_team', 'E6 …stamped `reassign_team`: tasks-M6A §5''s contractual string, and the only one §12.12''s printed vocabulary offers (123:280-286 has no `rename_team`). F355 carries the rendering consequence to L.E1.11/L.E1.13');
select is((select target_type || '/' || target_id from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'team/cf000000-0000-4000-8000-000000000002', 'E7 …with target_type `team` and target_id the team id as TEXT (123:288-289''s column)');
select is((select (before ->> 'name') || ' -> ' || (after ->> 'name') from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'CR Alpha -> Alpha Reborn', 'E8 …and before/after mirror each other key-for-key over the ONE column that changed (D353''s shape, D336 part 3)');
select is((select metadata ->> 'team_name' from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'CR Alpha', 'E9 …with §5''s contractual metadata extra: `team_name` is the OLD name — the value this receipt freezes for ever');
select is((select metadata ->> 'action_id' from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  '0f000000-0000-4000-8000-000000000010', 'E10 …and the action_id, §5''s other contractual extra');
select is(current_setting('pgtap.tr_e1')::jsonb ->> 'commissioner_action_id',
  (select id::text from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'E11 …and the returned document NAMES that receipt, so the caller never has to guess which row is his');
select is((select count(*)::int from league_chat
           where league_id = 'bf000000-0000-4000-8000-000000000001' and is_system),
  1, 'E12 §10.3: ONE in-transaction league_chat system post, which cannot be disabled');
select ok((select message like 'CR Alpha is now Alpha Reborn%commissioner override%reason: paper draft: the owner picked a name'
           from league_chat where league_id = 'bf000000-0000-4000-8000-000000000001' and is_system),
  'E13 …and it names BOTH names, the override, and the reason — pinned tightly enough that a reworded post reds this cell rather than passing on a substring');
select is(current_setting('pgtap.tr_e1')::jsonb -> 'bypassed', '[]'::jsonb,
  'E14 `bypassed` is EMPTY — a franchise name is gated by no lock, no week status and no scoring door, so standing rule (g) has nothing to exempt here');
select ok(current_setting('pgtap.tr_e1')::jsonb ->> 'bypassed_why' like '%not gated by the per-player kickoff lock%',
  'E15 …and the empty array is EXPLAINED rather than left to be guessed at (§4 rule 15: an empty result states its reason)');
select is(current_setting('pgtap.tr_e1')::jsonb -> 'propagation' ->> 'history_rewritten', 'false',
  'E16 THE PROPAGATION FINDING, in the document: no history was rewritten');
select ok(current_setting('pgtap.tr_e1')::jsonb -> 'propagation' ->> 'live_why' like '%read LIVE at every call site%',
  'E17 …because teams.name is read LIVE everywhere (123:1155, 127:1413-1416), so no propagation pass exists and none is needed — §H proves the frozen half');
select is(current_setting('pgtap.tr_e1')::jsonb -> 'name_collides_with', '[]'::jsonb,
  'E18 `name_collides_with` is empty here — and it is a REPORT, never a refusal: there is no UNIQUE index or CHECK on teams.name anywhere in 001-128, and inventing one inside a verb that exists to remove a restriction would be new product');

-- The collision report, with a real collision.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
     'cf000000-0000-4000-8000-000000000003', 'alpha reborn', 'deliberate duplicate',
     '0f000000-0000-4000-8000-000000000011'::uuid) -> 'name_collides_with'),
  jsonb_build_array('cf000000-0000-4000-8000-000000000002'),
  'E19 …and a name another franchise already carries is ALLOWED and REPORTED, case-insensitively, naming the franchise it collides with — the caller decides');
reset role;
select set_config('request.jwt.claims', '', true);
update teams set name = 'CR Bravo' where id = 'cf000000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- F. THE MANAGER'S OWN RENAME — ***THE DROP SEAM***. If Chris wants only the
--    commissioner's half: delete this whole section (F1-F9) together with §4
--    of migration 128, adjust §A as the header note says, and take plan(90)
--    down to 79. No other section reads these cells or the manager verb.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select set_config('pgtap.tr_f1',
  (select public.rename_own_team('cf000000-0000-4000-8000-000000000003', '  Bravo Company  ')::text), true);
select is((select name from teams where id = 'cf000000-0000-4000-8000-000000000003'),
  'Bravo Company', 'F1 a MANAGER can now name his own franchise — the other half of F338''s total gap, trimmed by the same shared gate the commissioner''s verb uses');
select is(current_setting('pgtap.tr_f1')::jsonb ->> 'previous_name', 'CR Bravo',
  'F2 …and the response names what it replaced');
select is(current_setting('pgtap.tr_f1')::jsonb ->> 'audited', 'false',
  'F3 …AND SAYS WHAT IT DID NOT DO: no commissioner_actions row, because a manager renaming his OWN franchise is not exercising a §10.1 power (§4 rule 15 — the absence is in the response, not only in a comment)');
select is((select count(*)::int from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  2, 'F4 …and the receipt count is UNCHANGED by it — still only §E''s two commissioner receipts');
select is(current_setting('pgtap.tr_f1')::jsonb ->> 'system_post', null,
  'F5 …no league_chat post either: §10.3''s non-disableable post is for OVERRIDE messages, and the response carries `system_post_why` saying so');
-- The manager door refuses everything that is not his own league franchise.
select throws_ok(
  $$ select public.rename_own_team('cf000000-0000-4000-8000-000000000002', 'Not Mine') $$,
  '42501', 'rename_own_team: not the manager of this team',
  'F6 another manager''s franchise is refused with the ONE no-leak 42501 — the auth predicate is the exact complement of set_lineup_internal''s own (114:240-243, F35: league_members'' cache column, never a stint)');
select throws_ok(
  $$ select public.rename_own_team('cf000000-0000-4000-8000-000000000004', 'Unseal Me') $$,
  '42501', 'rename_own_team: not the manager of this team',
  'F7 THE RETIRED FRANCHISE IS UNREACHABLE THROUGH THIS DOOR, and that is WHY there is no retired guard in it (§4 rule 14(b)): 120:540 is the only writer of status=retired and the same arm re-points the seat''s league_members row at the SUCCESSOR with user_id NULL (120:564-570), so no user ever matches. B1 asserts that premise; if a future migration leaves a seated row on a retired franchise, THIS cell is what notices');
select throws_ok(
  $$ select public.rename_own_team('00000000-0000-4000-8000-0000000000bb', 'Ghost') $$,
  '42501', 'rename_own_team: not the manager of this team',
  'F8 …and a team that does not exist gets the IDENTICAL message: "no such team" and "not your seat" are indistinguishable from outside');
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_like(
  $$ select public.rename_own_team('cf000000-0000-4000-8000-000000000006', 'Solo Renamed') $$,
  '%STANDALONE team%095:636-639%',
  'F9 a STANDALONE team the caller owns is ROUTED, not handled twice: it already has a working door (095:636-639''s UPDATE policy, proven live by C3), so this verb refuses by name and says which one — rather than becoming a second writer for a surface that is not broken');
reset role;
select set_config('request.jwt.claims', '', true);
update teams set name = 'CR Bravo' where id = 'cf000000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- G. CHRIS'S ONE CONDITION — "no receipt if nothing is done. only when
--    something is done." The counts are captured as literals FIRST.
-- ---------------------------------------------------------------------------
select set_config('pgtap.tr_a', (select count(*)::text from commissioner_actions
  where league_id = 'bf000000-0000-4000-8000-000000000001'), true);
select set_config('pgtap.tr_c', (select count(*)::text from league_chat
  where league_id = 'bf000000-0000-4000-8000-000000000001'), true);
select ok(current_setting('pgtap.tr_a')::int > 0 and current_setting('pgtap.tr_c')::int > 0,
  'G0 PREMISE: both tables are NON-EMPTY before the no-op, so "UNCHANGED" below is a real comparison and not a count over nothing');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000002', 'Alpha Reborn', 'a second look at the same fix',
       '0f000000-0000-4000-8000-000000000020'::uuid) $$,
  'G1 A SECOND IDENTICAL CALL (a NEW action_id, the same name) returns 200 — it does not raise. A fallback verb that refused its own completed outcome would be non-idempotent in the one direction it most needs not to be');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('pgtap.tr_noop', (select result::text from commish_team_actions
  where action_id = '0f000000-0000-4000-8000-000000000020'), true);
select is(current_setting('pgtap.tr_noop')::jsonb ->> 'no_changes', 'true',
  'G2 …and says so BY VALUE: no_changes = true, DETECTED by comparing the stored name with the normalized request — never inferred from an empty write (the UPDATE sits INSIDE the guard, so updated_at does not move either)');
select is(current_setting('pgtap.tr_noop')::jsonb ->> 'commissioner_action_id', null,
  'G3 …with commissioner_action_id NULL, and that is the point');
select ok(current_setting('pgtap.tr_noop')::jsonb ->> 'no_changes_why' like 'name_already_set%',
  'G4 …and the reason is NAMED, so "nothing happened" can never be read as "it worked"');
select is((select count(*)::int from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'), current_setting('pgtap.tr_a')::int,
  'G5 NO RECEIPT: the commissioner_actions count is UNCHANGED');
select is((select count(*)::int from league_chat
           where league_id = 'bf000000-0000-4000-8000-000000000001'), current_setting('pgtap.tr_c')::int,
  'G6 …the league_chat count is UNCHANGED');
select is((select count(*)::int from commish_team_actions
           where action_id = '0f000000-0000-4000-8000-000000000020'), 1,
  'G7 …but the REPLAY LEDGER row IS written: an action_id is consumed by its submit whether or not anything moved (§12.26 — "an action_id is an idempotency key, not an audit record"), which is the OPPOSITE rule from the audit row and deliberately so');
select is(current_setting('pgtap.tr_noop')::jsonb ->> 'system_post', null,
  'G8 …and `system_post` is NULL in the document too — the no-op reports the post it did not write');

-- THE NO-OP WROTE NOTHING AT ALL, PROVEN ON THE ROW ITSELF. T1 has never been
-- renamed, so its updated_at still carries the fixture's ten-days-ago stamp —
-- which is what makes this measurable at all inside pgTAP's single frozen
-- transaction (a no-op on T2 would compare now() with now()).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
     'cf000000-0000-4000-8000-000000000001', '  CR Commish  ', 'renaming it to what it already is',
     '0f000000-0000-4000-8000-000000000021'::uuid) ->> 'no_changes'),
  'true', 'G9 a name that differs only by surrounding whitespace is STILL a no-op — the comparison happens after the same trim both doors use, so a stray space cannot manufacture a receipt');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select updated_at < now() - interval '9 days' from teams
           where id = 'cf000000-0000-4000-8000-000000000001'),
  true, 'G10 …and the ROW is untouched: `updated_at` still carries the fixture''s ten-days-ago stamp, so the UPDATE really does sit INSIDE the no-op guard rather than running and writing the same string back');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
     'cf000000-0000-4000-8000-000000000003', 'A Completely Different Name', 'a completely different reason',
     '0f000000-0000-4000-8000-000000000010'::uuid)::text),
  current_setting('pgtap.tr_e1'),
  'G11 REPLAY (E2/D68): the same action_id returns §E1''s stored document BYTE-identically — with a different TEAM, a different name and a different reason. The lookup sits AFTER auth but BEFORE every business gate (123:602-609), so a retry replays even when the league has moved on');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select name from teams where id = 'cf000000-0000-4000-8000-000000000003'),
  'CR Bravo', 'G12 …and NOTHING was renamed on the replay: the returned document is a record, not an instruction');

-- ---------------------------------------------------------------------------
-- H. THE PROPAGATION FINDING (tasks-M6A §6 L.E1.7 item 4) — a receipt records
--    what was TRUE. The frozen copies keep the OLD name.
-- ---------------------------------------------------------------------------
select is((select metadata ->> 'team_name' from commissioner_actions
           where target_id = 'cf000000-0000-4000-8000-000000000002'
             and metadata ->> 'action_id' = '0f000000-0000-4000-8000-000000000010'),
  'CR Alpha', 'H0 PREMISE: §E''s receipt exists and records `CR Alpha` — so H2 below is a comparison against a value that was really written, not against a NULL');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.tr_h',
  (select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
     'cf000000-0000-4000-8000-000000000002', 'Third Identity', 'renamed again',
     '0f000000-0000-4000-8000-000000000030'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select name from teams where id = 'cf000000-0000-4000-8000-000000000002'),
  'Third Identity', 'H1 the franchise is renamed a SECOND time — the live value moves');
select is((select metadata ->> 'team_name' from commissioner_actions
           where target_id = 'cf000000-0000-4000-8000-000000000002'
             and metadata ->> 'action_id' = '0f000000-0000-4000-8000-000000000010'),
  'CR Alpha', 'H2 …and §E''s ALREADY-WRITTEN receipt still reads `CR Alpha`. A receipt records what was true (§18, §12.12) — this migration writes NO propagation pass, and 123:339-410''s ENABLE ALWAYS trigger would refuse one anyway');
select ok((select message like 'CR Alpha is now Alpha Reborn%'
           from league_chat
           where league_id = 'bf000000-0000-4000-8000-000000000001' and is_system
           order by created_at limit 1),
  'H3 …and the ALREADY-WRITTEN chat post still says `CR Alpha is now Alpha Reborn`: the league''s conversation is history, not a view');
select is(current_setting('pgtap.tr_h')::jsonb -> 'propagation' ->> 'frozen_receipts_for_this_team', '1',
  'H4 …and the number is MEASURED, not asserted: exactly ONE receipt about this franchise records a name it no longer carries (§E''s), and the document says so rather than implying it (§4 rule 15)');

-- ---------------------------------------------------------------------------
-- D. THE REASON GATE AND THE NAME GATE — one unit either side (071 §D).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000002', 'Any Name', E' \t\r\n ',
       '0f000000-0000-4000-8000-000000000001'::uuid) $$,
  '22023', null,
  'D1 a reason of nothing but whitespace INCLUDING TABS AND NEWLINES is refused — plain btrim strips SPACES ONLY, the exact hole R745 had to fix twice; the explicit E'' \t\r\n'' class is used at every layer (123:295-296)');
select throws_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000002', 'Any Name', repeat('x', 501),
       '0f000000-0000-4000-8000-000000000002'::uuid) $$,
  '22023', null, 'D2 a 501-character reason is refused (the league_chat bound, §12.13)');
select throws_like(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000002', E' \t\r\n ', 'a real reason',
       '0f000000-0000-4000-8000-000000000003'::uuid) $$,
  '%a team name is required%whitespace%',
  'D3 THE NAME GATE, same class: a name of nothing but whitespace is refused BY NAME — a franchise called E''\t'' is what a naive NULLIF(btrim(x), '''') ships');
select throws_like(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000002', repeat('N', 101), 'a real reason',
       '0f000000-0000-4000-8000-000000000004'::uuid) $$,
  '%is 101 characters — at most 100%',
  'D4 …101 characters is refused, and the message SAYS 101 (the league-rename bound, createLeagueInputSchema.name)');
select lives_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000003', repeat('N', 100), 'the boundary',
       '0f000000-0000-4000-8000-000000000005'::uuid) $$,
  'D5 …and 100 lives — the boundary, one unit either side');
select throws_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000002', 'No Key', 'a real reason', null) $$,
  '22023', null,
  'D6 a missing action_id is refused: the idempotency key is not optional (the DEFAULT NULL exists only to keep tasks-M6A §5''s printed argument order)');
select throws_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       null, 'No Team', 'a real reason', '0f000000-0000-4000-8000-000000000006'::uuid) $$,
  '22023', null,
  'D7 LOUD EMPTINESS: a call naming no franchise is a MALFORMED CALL refused BY NAME — never answered with no_changes: true, which would be a success document for a request that never said what it wanted');
select throws_like(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000006', 'Not Yours', 'a real reason',
       '0f000000-0000-4000-8000-000000000007'::uuid) $$,
  '%is not a franchise of league%',
  'D8 …and a team that is not in THIS league (u2''s standalone team) is refused by name, after auth — a commissioner''s power is scoped to his own league');
-- D5 renamed T3; put it back so later sections read a stable fixture.
reset role;
select set_config('request.jwt.claims', '', true);
update teams set name = 'CR Bravo' where id = 'cf000000-0000-4000-8000-000000000003';
-- ---------------------------------------------------------------------------
-- I. THE SEALED FRANCHISE — the one refusal, and it is the spec's own.
--    ***THE BREAK PROBE'S TARGET.***
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000004', 'Unsealed', 'the commissioner tries anyway',
       '0f000000-0000-4000-8000-000000000040'::uuid) $$,
  '%its name is FROZEN%NO VERB UN-RETIRES A FRANCHISE TODAY (F354)%rename the SUCCESSOR franchise (cf000000-0000-4000-8000-000000000005)%',
  'I1 A RETIRED FRANCHISE''S NAME IS FROZEN (spec:183, §7.2.1(b)) and the refusal binds the COMMISSIONER too — a sealed franchise is the record History Mode shows under its last manager, so this is a LEGALITY gate, not a timing one (PROGRESS standing rule (i)). The pattern pins the FROZEN wording, the F354 honesty (no "un-retire first", which R1020 had to correct once in 127) AND the successor it offers instead, so a reworded or softened refusal reds this cell rather than passing on a substring');
select is((select name from teams where id = 'cf000000-0000-4000-8000-000000000004'),
  'CR Sealed', 'I2 …and the sealed franchise still carries its sealed name');
select is((select count(*)::int from commish_team_actions
           where action_id = '0f000000-0000-4000-8000-000000000040'), 0,
  'I3 …and a refusal consumes NO ledger row: the whole statement rolled back, so the same action_id is still usable once the request is lawful');
-- The SUCCESSOR is renameable, which is what makes I1's offer a real route.
select is(
  (select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
     'cf000000-0000-4000-8000-000000000005', 'Phoenix', 'the successor gets a real name',
     '0f000000-0000-4000-8000-000000000041'::uuid) ->> 'name'),
  'Phoenix', 'I4 POSITIVE CONTROL for I1: the SUCCESSOR franchise (orphaned, unclaimed) renames fine — so I1''s zero is the `retired` predicate and not "this suite cannot rename anything in §I"');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- J. AUTH — one no-leak 42501 for every caller who is not a commissioner of
--    THIS league, and the same one for a league that does not exist (071 §F).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000003', 'Hostile Rename', 'not mine to give',
       '0f000000-0000-4000-8000-000000000050'::uuid) $$,
  '42501', 'commish_rename_team: not a commissioner of this league',
  'J1 A NON-COMMISSIONER RENAMING ANOTHER TEAM is refused with the one no-leak 42501 — a seated manager is still not a commissioner, and his own door is rename_own_team');
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000003', 'Hostile Rename', 'x',
       '0f000000-0000-4000-8000-000000000051'::uuid) $$,
  '42501', 'commish_rename_team: not a commissioner of this league', 'J2 an OUTSIDER is refused the same way');
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000003', 'Hostile Rename', 'x',
       '0f000000-0000-4000-8000-000000000052'::uuid) $$,
  '42501', 'commish_rename_team: not a commissioner of this league', 'J3 a MEMBER WITH NO TEAM is refused the same way');
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_rename_team('00000000-0000-4000-8000-0000000000aa',
       'cf000000-0000-4000-8000-000000000003', 'Hostile Rename', 'x',
       '0f000000-0000-4000-8000-000000000053'::uuid) $$,
  '42501', 'commish_rename_team: not a commissioner of this league',
  'J4 NO LEAK: a league that does not exist gets the IDENTICAL message — "no such league" and "not a commissioner" are indistinguishable from outside (D336 part 5)');
select set_config('request.jwt.claims', '', true);
reset role;
set local role anon;
select throws_ok(
  $$ select public.commish_rename_team('bf000000-0000-4000-8000-000000000001',
       'cf000000-0000-4000-8000-000000000003', 'Hostile Rename', 'x',
       '0f000000-0000-4000-8000-000000000054'::uuid) $$,
  '42501', null, 'J5 anon cannot reach the commissioner door at all (the REVOKE, not the body)');
select throws_ok(
  $$ select public.rename_own_team('cf000000-0000-4000-8000-000000000003', 'Hostile Rename') $$,
  '42501', null, 'J6 …nor the manager door');
reset role;

-- ---------------------------------------------------------------------------
-- K. NEVER-WEAKEN PINS (§4 rule 13). 128 replaces no function and adds no
--    policy; these cells are what makes that claim falsifiable.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'teams' and cmd = 'UPDATE'),
  1, 'K1 `teams` still has EXACTLY ONE UPDATE policy after 128 — the verb is a DEFINER door, not a widened policy, so §C2''s gap is still shut for direct client writes');
select is(
  (select qual from pg_policies
   where schemaname = 'public' and tablename = 'teams' and cmd = 'UPDATE'),
  '((auth.uid() = owner_id) AND (league_id IS NULL))',
  'K2 …and it is still 095:636-639''s predicate, byte for byte: a league franchise matches no UPDATE policy at all');
select ok(
  (select p.prosrc like '%set_lineup: not a manager of this team%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_lineup_internal'),
  'K3 114''s set_lineup_internal still carries its own auth refusal — this migration copied its league_members predicate, it did not edit it (the 071:835-867 shape)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'set_lineup')),
  2, 'K4 …and both are still ONE overload each — no second signature crept in beside them');

select * from finish();
rollback;
