-- ============================================================================
-- pgTAP 079 — migration 131: THE REASON-OPTIONAL SWEEP (task L.E1.15 of M6A;
-- tasks-M6A §6's approved amendment note; PROGRESS F362 / F341 / F343; §4
-- rules 1-15; Q66 — Chris, 2026-09-16; spec v2.16.41 §10 / §10.3 / §11.7 /
-- §15.4 / E41).
--
-- WHAT THIS SUITE PROVES, and what it deliberately leaves to its neighbours:
--   §A  PER FUNCTION (all eight bodies 131 replaced), the SOURCE shape of the
--       sweep, pinned so a `CREATE OR REPLACE` that re-adds a refusal, drops
--       the bound, or un-conditions the post reds BY NAME: (i) the old
--       "reason is required" refusal text is GONE from prosrc; (ii) the
--       chat post's "— reason:" clause is CONDITIONAL; (iii) the 500-bound
--       refusal text is STILL there (never-weaken — only the presence gate
--       went); (iv) in 111's two verbs the plain-`btrim` normalisation is
--       gone and the explicit E' \t\r\n' class is what remains (R1048's
--       other half; F225's R745 remainder), and `reason_required` is the
--       literal FALSE.
--   §B  NO GATE WAS REORDERED: in every replaced body the `leagues … FOR
--       UPDATE` lock still precedes the reason normalisation (rule 8 — the
--       sweep removed a gate, it did not move one). The two-session TOCTOU
--       re-run on 128's retired guard is a MANUAL probe whose transcript is in
--       the PR (a committed fixture is needed for a second session to see it,
--       and a pgTAP transaction cannot provide one — 076 §F's note).
--   §C  SIGNATURES: nothing changed shape — every replaced internal and its
--       DEFINER door is still ONE overload each (typegen: a 0-line diff,
--       measured in the PR).
--   §D  THE TABLE still refuses what the verbs never send: '' and a 501-char
--       reason are 23514 under 130 §0's CHECK; NULL lives.
--
-- The BEHAVIOURAL proofs (a no-reason call LANDS with a NULL-reason receipt;
-- whitespace ⇒ NULL not ''; a real reason stored TRIMMED; 501 refused; the
-- post carries no clause) live per verb, on each verb's OWN fixture, in the
-- suites that already own them: 071 §Q (123), 074 §Q (126), 075 §Q (127),
-- 076 §Q (128), 077 §Q (129), 078 §C/§D (130 — C12 flipped), 059 §F3 and the
-- post-kickoff EDIT cells (111's two verbs, incl. the Remix receipt), 060 §H
-- (114's commissioner arm). 078 L7/L8 were re-derived in the same PR.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

-- ---------------------------------------------------------------------------
-- A. THE SOURCE SHAPE, per replaced function.
-- ---------------------------------------------------------------------------
create temp table _sweep (fn text, refusal text, bound text) on commit drop;
insert into _sweep values
  ('commish_edit_lineup_internal',       'commish_edit_lineup: a reason is required',                 'commish_edit_lineup: the reason is % characters — at most 500'),
  ('commish_matchup_override_internal',  ': a reason is required — this verb writes an audited',     ': the reason is % characters — at most 500'),
  ('commish_roster_override_internal',   ': a reason is required — this verb writes an audited',     ': the reason is % characters — at most 500'),
  ('commish_rename_team_internal',       'commish_rename_team: a reason is required',                 'commish_rename_team: the reason is % characters — at most 500'),
  ('commish_change_setting_internal',    'commish_change_setting: a reason is required',              'commish_change_setting: the reason is % characters — at most 500'),
  ('schedule_edit_matchup',              'a matchup edit after the first kickoff is a commissioner override and requires a reason', 'schedule_edit_matchup: the reason is % characters — at most 500'),
  ('schedule_remix_confirm',             'a Remix after the first kickoff is a commissioner override and requires a reason',       'schedule_remix_confirm: the reason is % characters — at most 500'),
  ('set_lineup_internal',                'must give a reason',                                        'set_lineup: the reason is % characters — at most 500');

select is(
  (select count(*)::int from _sweep s
   join pg_proc p on p.proname = s.fn
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'),
  8, 'A0 PREMISE: all eight replaced functions exist under public — the rows below are about bodies that are really there');

-- A1-A8: the refusal is GONE. ***THE L.E1.15 BREAK PROBE'S TARGETS*** (one
-- per verb — re-add the gate and that verb's cell reds by name).
select ok(
  (select p.prosrc not like '%' || s.refusal || '%'
   from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and s.fn = 'commish_edit_lineup_internal'),
  'A1 commish_edit_lineup_internal (123, IN PRODUCTION): 123:668''s "a reason is required" refusal is GONE');
select ok(
  (select p.prosrc not like '%' || s.refusal || '%'
   from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and s.fn = 'commish_matchup_override_internal'),
  'A2 commish_matchup_override_internal (126): 126:723''s refusal is GONE');
select ok(
  (select p.prosrc not like '%' || s.refusal || '%'
   from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and s.fn = 'commish_roster_override_internal'),
  'A3 commish_roster_override_internal (127): 127:762''s refusal is GONE');
select ok(
  (select p.prosrc not like '%' || s.refusal || '%'
   from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and s.fn = 'commish_rename_team_internal'),
  'A4 commish_rename_team_internal (128, the COMMISSIONER arm only): 128:464''s refusal is GONE');
select ok(
  (select p.prosrc not like '%' || s.refusal || '%'
   from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and s.fn = 'commish_change_setting_internal'),
  'A5 commish_change_setting_internal (129): 129:735''s refusal is GONE');
select ok(
  (select p.prosrc not like '%' || s.refusal || '%'
   from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and s.fn = 'schedule_edit_matchup'),
  'A6 schedule_edit_matchup (130''s text, D137): 111:952-957''s post-kickoff gate is GONE');
select ok(
  (select p.prosrc not like '%' || s.refusal || '%'
   from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and s.fn = 'schedule_remix_confirm'),
  'A7 schedule_remix_confirm (111): 111:671-675''s post-kickoff gate is GONE (F341''s reason half)');
select ok(
  (select p.prosrc not like '%' || s.refusal || '%'
   from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and s.fn = 'set_lineup_internal'),
  'A8 set_lineup_internal (114''s text, D137 — the COMMISSIONER arm, ruled IN): 114:317-321''s "must give a reason" is GONE; the manager arm is untouched (071 §I)');

-- A9: the conditional clause is present in every one of the eight.
select is(
  (select count(*)::int from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc like '%CASE WHEN v_reason IS NOT NULL THEN '' — reason: '' || v_reason ELSE '''' END%'),
  8, 'A9 ALL EIGHT chat posts carry the CONDITIONAL "— reason:" clause in the source — never "reason: <NULL>" (which would have nulled the whole post) and never "reason: " with nothing after it');
-- A10: the 500 bound is still refused by name in every one of the eight
-- (schedule_remix_confirm gained its bound WITH its receipt in 131).
select is(
  (select count(*)::int from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%' || s.bound || '%'),
  8, 'A10 NEVER-WEAKEN: all eight still refuse a 501-character reason BY NAME (the league_chat bound, §12.13) — only the PRESENCE gate went');
-- A11-A14: 111's two verbs — the explicit class replaced the plain btrim.
select ok(
  (select position('NULLIF(btrim(COALESCE(p_reason, '''')), '''')' in p.prosrc) = 0
      and position('NULLIF(btrim(COALESCE(p_reason, ''''), E'' \t\r\n''), '''')' in p.prosrc) > 0
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'),
  'A11 schedule_edit_matchup: 111:951''s PLAIN btrim is gone and the explicit E'' \t\r\n'' class is the normalisation — the post and the receipt read ONE value (R1048)');
select ok(
  (select position('NULLIF(btrim(COALESCE(p_reason, '''')), '''')' in p.prosrc) = 0
      and position('NULLIF(btrim(COALESCE(p_reason, ''''), E'' \t\r\n''), '''')' in p.prosrc) > 0
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_remix_confirm'),
  'A12 schedule_remix_confirm: 111:670''s PLAIN btrim is gone (F225''s R745 remainder closed) and the explicit class is the normalisation');
select ok(
  (select p.prosrc like '%''reason_required'', FALSE%' and p.prosrc not like '%''reason_required'', NOT v_free%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'),
  'A13 schedule_edit_matchup: `reason_required` is the literal FALSE at both levels — the field reported the gate 131 removed (078 C12 flipped with it; kept for the panel, F361)');
select ok(
  (select p.prosrc like '%''reason_required'',      FALSE%' and p.prosrc not like '%''reason_required'',      NOT v_free%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_remix_confirm'),
  'A14 schedule_remix_confirm: `reason_required` is the literal FALSE too');
-- A15-A16: the Remix receipt (F341's park discharged) — the helper once, the
-- audit-row guard present, the park comment gone.
select is(
  (select count(*)::int from regexp_matches(
     (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'schedule_remix_confirm'), 'log_commissioner_action_internal', 'g')),
  1, 'A15 schedule_remix_confirm calls the ONE logging helper EXACTLY ONCE (F341 discharged; 078 L7 re-derived to the same number)');
select ok(
  (select p.prosrc like '%schedule_remix_confirm: the audit row was not written — refusing to let the remix stand without its receipt (§10.3)%'
      and p.prosrc not like '%The reason lives%here until commissioner_actions exists (D290)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_remix_confirm'),
  'A16 …guarded by the "audit row was not written" P0001 (D336 part 2), and the D290 park comment at 111:738-740 is gone');

-- ---------------------------------------------------------------------------
-- B. NO REORDER: the lock still precedes the reason normalisation in EVERY
--    replaced body (rule 8). The sweep removed a gate; it moved none.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from _sweep s join pg_proc p on p.proname = s.fn join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and strpos(p.prosrc, 'FOR UPDATE') > 0
     and strpos(p.prosrc, 'FOR UPDATE') < strpos(p.prosrc, 'v_reason := NULLIF(btrim(COALESCE(p_reason, '''')')),
  8, 'B1 in ALL EIGHT bodies the first `FOR UPDATE` (the leagues lock, rule 8) still precedes the reason normalisation — the normalisation runs under the lock, exactly where the gate ran');
-- The retired guard (128) and the scored-cell guard (126) — the two the
-- manual TOCTOU re-run exercises — still sit AFTER their locks (076 F13's
-- shape).
select ok(
  (select strpos(p.prosrc, 'WHERE t.id = p_team_id FOR UPDATE') > 0
      and strpos(p.prosrc, 'v_team.status = ''retired''') > strpos(p.prosrc, 'WHERE t.id = p_team_id FOR UPDATE')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_rename_team_internal'),
  'B2 commish_rename_team_internal: the retired guard still reads the row LOCKED by `teams … FOR UPDATE` (R1036''s order, byte-preserved by the extraction)');
select ok(
  (select strpos(p.prosrc, 'FOR UPDATE') > 0
      and strpos(p.prosrc, 'is_overridden') > strpos(p.prosrc, 'FOR UPDATE')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_matchup_override_internal'),
  'B3 commish_matchup_override_internal: the first `is_overridden` read still sits after the lock');

-- ---------------------------------------------------------------------------
-- C. SIGNATURES — nothing changed shape.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_edit_lineup_internal', 'commish_edit_lineup',
                       'commish_matchup_override_internal', 'commish_edit_score', 'commish_set_result',
                       'commish_roster_override_internal', 'commish_move_player', 'commish_force_add_drop',
                       'commish_rename_team_internal', 'commish_rename_team',
                       'commish_change_setting_internal', 'commish_change_setting',
                       'schedule_edit_matchup', 'schedule_remix_confirm',
                       'set_lineup_internal', 'set_lineup')),
  16, 'C1 the eight replaced bodies and their eight DEFINER doors are still ONE overload each (16 rows) — 131 replaced bodies in place and re-authored nothing; typegen is a 0-line diff');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('schedule_edit_matchup', 'schedule_remix_confirm', 'set_lineup')),
  'C2 the three DEFINER bodies 131 replaced directly (111''s two, 114''s door is untouched but pinned) keep SECURITY DEFINER + search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_edit_lineup_internal', 'commish_matchup_override_internal', 'commish_roster_override_internal',
                       'commish_rename_team_internal', 'commish_change_setting_internal', 'set_lineup_internal')),
  'C3 the six replaced INTERNALS are still PLAIN with search_path='''' (123:498-505''s posture)');
select ok(
  not has_function_privilege('anon', 'public.schedule_remix_confirm(uuid,bigint,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_edit_matchup(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.schedule_remix_confirm(uuid,bigint,text,uuid)', 'EXECUTE'),
  'C4 grants survived CREATE OR REPLACE on 111''s two doors: anon still holds no EXECUTE, authenticated still may call (the commissioner check is in-body)');
select ok(
  not has_function_privilege('authenticated', 'public.commish_edit_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_edit_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)', 'EXECUTE'),
  'C5 …and the triple-REVOKE on 123''s internal survived too');

-- ---------------------------------------------------------------------------
-- D. THE TABLE (130 §0's CHECK, unchanged by 131) still refuses what the
--    verbs never send.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '9c000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-sw1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "sw_user1"}'::jsonb, now(), now());
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, settings, roster_settings) values
 ('bc000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'pgtap-sw-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{}'::jsonb, '{}'::jsonb);
select lives_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('bc000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'edit_lineup', null) $$,
  'D1 reason NULL LIVES at the table (130 §0 — what every verb now stores for "none given")');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('bc000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'edit_lineup', '') $$,
  '23514', null, 'D2 reason '''' is STILL refused by the CHECK — the verbs normalise blank to NULL precisely because the table will not take ''''');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('bc000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'edit_lineup', E'\t\n') $$,
  '23514', null, 'D3 reason of TABS+NEWLINE is STILL refused by the CHECK (the explicit class at the table, 123:295-296 / 130 §0)');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('bc000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'edit_lineup', repeat('r', 501)) $$,
  '23514', null, 'D4 501 characters is STILL refused by the CHECK — the bound at all three layers survives Q66');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c join pg_class t on t.oid = c.conrelid
   where t.relname = 'commissioner_actions' and c.conname = 'commissioner_actions_reason_check'),
  E'CHECK (((reason IS NULL) OR ((length(btrim(reason, \' \t\r\n\'::text)) > 0) AND (length(reason) <= 500))))',
  'D5 …and the CHECK''s text is 130 §0''s, byte for byte — 131 touched no DDL');

-- ---------------------------------------------------------------------------
-- E. THE POLICY SURFACE is untouched: commissioner_actions still has no
--    UPDATE / DELETE policy (§4 rule 12; §12.12).
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'commissioner_actions' and cmd in ('UPDATE', 'DELETE')),
  0, 'E1 commissioner_actions carries NO UPDATE or DELETE policy — 131 added none');
select is(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'commissioner_actions' and not t.tgisinternal and t.tgenabled = 'A'),
  2, 'E2 …and both ENABLE ALWAYS triggers (immutability, no-truncate) are still there');

select * from finish();
rollback;
