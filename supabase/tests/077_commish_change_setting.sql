-- ============================================================================
-- pgTAP 077 — migration 129: `commish_change_setting`
-- (task L.E1.8 of M6A; tasks-M6A §6 "L.E1.8" PROOF, §4 rules 1-15, §11 Q64;
-- PROGRESS §3 standing rule (a)/(b)/(g)/(i), F345; `spec:1701`, §7.3,
-- §7.3.3.)
--
-- WHAT THIS SUITE IS ORGANISED TO PROVE, IN THE ORDER THE BREAKDOWN ASKS:
--   §A  form pins — the ledger (D350), the door, the internals, the policy
--       function; TRUNCATE asserted PER ROLE.
--   §B  fixtures and their PREMISES (§4 rule 14(c)). The F345 premise is
--       here: a seat whose `faab_balance` (37) differs from BOTH the old
--       budget (100) and the new (150), asserted BY VALUE before §F runs —
--       because `063:462-464` seeds every seat from the budget at creation
--       and `118:2617-2621` re-seeds them all on every prior budget change,
--       so "balances unchanged" is TRUE BY DEFAULT and §F would pass with
--       118's un-narrowed body pasted in.
--   §C  an in-season change to a PERMITTED key lands and writes ONE audit row
--       whose before/after name THAT KEY ALONE.
--   §D  the THREE-WAY no-op: the same value re-sent as a number, as a string
--       ("72"), and on a typed column ("100") writes NOTHING — no audit row,
--       no chat post — while the replay LEDGER row IS written. ***BREAK
--       PROBE 2's TARGET*** (make the no-op write an audit row ⇒ D reds).
--   §E  a REFUSED-in-season key refused BY NAME (the season window; the
--       bracket keys once the bracket exists), with a positive control.
--   §F  THE FAAB RE-SEED PROVEN NOT TO FIRE IN-SEASON, with its premise
--       (§4 rule 14(c) / F345), AND a pre-draft positive control proving the
--       statement still exists behind the status condition. ***BREAK PROBE
--       1's TARGET*** (reinstate 118's unconditional re-seed ⇒ F reds).
--   §G  a scoring change re-freezes the snapshot AND leaves final weeks'
--       stored scores untouched unless `rescore` was asked; `rescore` on a
--       final week is REFUSED BY NAME (Q64's recommendation); `rescore` on
--       a league with no final week re-queues every open week's starters,
--       stamped with the stat line's own updated_at, IR excluded, the
--       unqueueable NAMED.
--   §H  the reason gate, the shape gates, the value gates — one unit either
--       side where a bound exists.
--   §I  AUTH — one no-leak 42501 (071 §F).
--   §J  REPLAY — byte-identical, nothing re-written.
--   §K  NEVER-WEAKEN PINS (§4 rule 13): 118's `update_league_settings` is
--       byte-untouched (its gate string and its re-seed statement still in
--       prosrc, one overload); 104's two walls and 110's week guard are
--       still there — 129 rides them and edits nothing.
--   §L  THE POLICY TABLE, pinned as data.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(121);

-- ---------------------------------------------------------------------------
-- A. FORM PINS
-- ---------------------------------------------------------------------------
select has_table('public', 'commish_setting_actions',
  'A1 commish_setting_actions exists — this verb''s OWN replay ledger (D350)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'commish_setting_actions'),
  0, 'A2 …with ZERO policies: the DEFINER verb is its only reader and writer (123:333-335''s pre-planted-row attack is impossible here)');
select ok(
  exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
          where r.relname = 'commish_setting_actions' and c.contype = 'u'
            and pg_get_constraintdef(c.oid) = 'UNIQUE (league_id, action_id)'),
  'A3 …and UNIQUE (league_id, action_id) is the race backstop');
select ok(not has_table_privilege('anon', 'public.commish_setting_actions', 'TRUNCATE'),
  'A4 REVOKE TRUNCATE — anon holds no TRUNCATE on the ledger (RLS does not cover TRUNCATE; F348)');
select ok(not has_table_privilege('authenticated', 'public.commish_setting_actions', 'TRUNCATE'),
  'A5 …and neither does authenticated (asserted per role with has_table_privilege)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_change_setting', 'commish_change_setting_internal',
                       'commish_setting_policy', 'commish_setting_canon_internal',
                       'commish_setting_int_internal', 'commish_setting_bool_internal',
                       'commish_setting_enum_internal')),
  7, 'A6 the seven 129 functions exist, ONE overload each');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting'),
  'A7 the client door is SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_change_setting_internal', 'commish_setting_canon_internal',
                       'commish_setting_int_internal', 'commish_setting_bool_internal',
                       'commish_setting_enum_internal', 'commish_setting_policy')),
  'A8 every internal and the policy function are PLAIN with search_path='''' (123:498-505''s posture)');
select ok(
  not has_function_privilege('anon', 'public.commish_change_setting(uuid,text,jsonb,boolean,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_change_setting(uuid,text,jsonb,boolean,text,uuid)', 'EXECUTE'),
  'A9 commish_change_setting: anon holds no EXECUTE; authenticated may call — the commissioner check is IN-BODY');
select ok(
  not has_function_privilege('authenticated', 'public.commish_change_setting_internal(uuid,text,jsonb,boolean,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_change_setting_internal(uuid,text,jsonb,boolean,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_setting_canon_internal(text,jsonb,public.leagues)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_setting_int_internal(text,jsonb,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_setting_bool_internal(text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_setting_enum_internal(text,jsonb,text[])', 'EXECUTE'),
  'A10 the internals are triple-REVOKEd — no client can supply the instant (rule 10)');
select ok(
  has_function_privilege('authenticated', 'public.commish_setting_policy(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_setting_policy(text)', 'EXECUTE'),
  'A11 commish_setting_policy is readable by authenticated (L.E1.13 renders refusal copy from it) and not by anon — it is pure and reads no table');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting_internal'
     and p.prosrc like '%log_commissioner_action_internal%'),
  1, 'A12 the verb writes its receipt through the ONE shared logging helper (123:417-453)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting_internal'
     and p.prosrc like '%team_managers%'),
  0, 'A13 F35 re-affirmed: the body never names team_managers');

-- ---------------------------------------------------------------------------
-- B. FIXTURES (postgres context, JWT cleared) — AND THEIR PREMISES.
--    L1 (in_season, 2026): 4 franchises; budget 100. u1 commissioner (T1,
--       balance 100) · u2 manager (T2, balance **37** — SPENT, the F345
--       premise) · u3 manager (T3, balance 0) · T4 placeholder (balance 100).
--       u4 outsider · u5 member with no team. Weeks 3 FINAL (stored points),
--       4 LIVE (lineups + stat lines), 5-10 upcoming.
--    L2 (in_season, 2026): ONE franchise, week 4 LIVE and NO final week —
--       the league on which `rescore` CAN do something. Later walked to
--       `playoffs` for §E's bracket refusal.
--    L3 (SETUP, 2026): two seats at 100 — the pre-draft positive control for
--       the FAAB re-seed (§F).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9e000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-cs' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'cs_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings,
                     created_at, updated_at) values
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'pgtap-cs-L1', 2026,
  'in_season', 8, 10, 4, 11, 100,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "waiver_period_hours": 48, "bench_lock": true, "tiebreakers": ["win_pct", "points_for", "head_to_head", "points_against", "division_record", "coin_flip"]}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}], "bench": 3, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}',
  now() - interval '10 days', now() - interval '10 days'),
 ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 'pgtap-cs-L2', 2026,
  'in_season', 8, 10, 4, 11, 100,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}',
  now() - interval '10 days', now() - interval '10 days'),
 ('be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000001', 'pgtap-cs-L3', 2026,
  'setup', 8, 14, 6, 15, 100,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  null,
  'per_player_kickoff', '{}', '{"starting_slots": [], "bench": 3, "ir_slots": [], "swap_spots": 0}',
  now() - interval '10 days', now() - interval '10 days');

insert into teams (id, owner_id, name, league_id) values
 ('ce000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'CS T1', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000002', 'CS T2', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000003', 'CS T3', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000001', 'CS T4', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000005', '9e000000-0000-4000-8000-000000000001', 'CS T5', 'be000000-0000-4000-8000-000000000002'),
 ('ce000000-0000-4000-8000-000000000007', '9e000000-0000-4000-8000-000000000001', 'CS T7', 'be000000-0000-4000-8000-000000000003'),
 ('ce000000-0000-4000-8000-000000000008', '9e000000-0000-4000-8000-000000000001', 'CS T8', 'be000000-0000-4000-8000-000000000003');

-- faab_balance SEATED EXPLICITLY, and REVERSED against the budget for the
-- seat that matters (F345 / §4 rule 14(c)): T2 carries 37, not the 100 the
-- product would have seeded and not the 150 §F changes the budget to.
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'commissioner', false, 100),
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', 'manager',      false, 37),
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000003', 'manager',      false, 0),
 ('be000000-0000-4000-8000-000000000001', null,                                   'ce000000-0000-4000-8000-000000000004', 'manager',      true,  100),
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000005', null,                                   'manager',      false, null),
 ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000005', 'commissioner', false, 100),
 ('be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000007', 'commissioner', false, 100),
 ('be000000-0000-4000-8000-000000000003', null,                                   'ce000000-0000-4000-8000-000000000008', 'manager',      true,  100);

-- Weeks. The F4 guard (§12.17) permits only forward steps, so each week is
-- WALKED to its status. L1: 3 final, 4 live, 5-10 upcoming. L2: 4 live only.
insert into league_weeks (league_id, season, week)
select 'be000000-0000-4000-8000-000000000001', 2026, g from generate_series(3, 10) g;
update league_weeks set status = 'live'              where league_id = 'be000000-0000-4000-8000-000000000001' and week in (3, 4);
update league_weeks set status = 'correction_window' where league_id = 'be000000-0000-4000-8000-000000000001' and week = 3;
update league_weeks set status = 'final'             where league_id = 'be000000-0000-4000-8000-000000000001' and week = 3;
insert into league_weeks (league_id, season, week, status) values
 ('be000000-0000-4000-8000-000000000002', 2026, 4, 'live');

-- Week 3's STORED, FINAL scores — the rows a scoring change must not touch.
insert into team_week_results (league_id, team_id, season, week, points, is_final) values
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 2026, 3, 110.50, true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 2026, 3,  90.25, true);

-- Week 4 lineups and stat lines. cs-qb1 / cs-qb2: stamped lines (queueable).
-- cs-rb1: a line with a NULL stamp (R968's `stats_unstamped`). cs-rb2: NO
-- line at all (`no_stat_row`). cs-ir: a stamped line, but he sits on T1's IR
-- spot and must NOT be queued. L2's cs2-qb: stamped.
insert into players (id, full_name, position, team, status) values
 ('cs-qb1',  'CS QB One',  'QB', 'DAL', 'Active'),
 ('cs-rb1',  'CS RB One',  'RB', 'SF',  'Active'),
 ('cs-qb2',  'CS QB Two',  'QB', 'PHI', 'Active'),
 ('cs-rb2',  'CS RB Two',  'RB', 'NYG', 'Active'),
 ('cs-ir',   'CS IR Man',  'RB', 'LAC', 'IR'),
 ('cs2-qb',  'CS2 QB',     'QB', 'KC',  'Active');
insert into team_lineups (team_id, season, week, slot_map, starters, bench) values
 ('ce000000-0000-4000-8000-000000000001', 2026, 4, '{"qb:0": "cs-qb1", "rb:0": "cs-rb1", "ir1:0": "cs-ir"}', '[]', '[]'),
 ('ce000000-0000-4000-8000-000000000002', 2026, 4, '{"qb:0": "cs-qb2", "rb:0": "cs-rb2"}', '[]', '[]'),
 ('ce000000-0000-4000-8000-000000000005', 2026, 4, '{"qb:0": "cs2-qb"}', '[]', '[]');
insert into player_stats (player_id, season, week, stat_type, updated_at) values
 ('cs-qb1', 2026, 4, 'weekly', now() - interval '1 hour'),
 ('cs-rb1', 2026, 4, 'weekly', null),
 ('cs-qb2', 2026, 4, 'weekly', now() - interval '2 hours'),
 ('cs-ir',  2026, 4, 'weekly', now() - interval '1 hour'),
 ('cs2-qb', 2026, 4, 'weekly', now() - interval '90 minutes');
delete from score_fanout where season = 2026 and week = 4;

-- PREMISES.
select is((select faab_balance from league_members where team_id = 'ce000000-0000-4000-8000-000000000002'),
  37, 'B1 PREMISE (F345, §4 rule 14(c)): T2''s faab_balance is 37 — a SPENT balance that differs from BOTH the old budget (100) and the new one §F sets (150). 063:462-464 seeds every seat from the budget and 118:2617-2621 re-seeded them all, so without this seat "balances unchanged" is TRUE BY DEFAULT and §F would pass with 118''s un-narrowed body');
select is((select count(*)::int from league_members where league_id = 'be000000-0000-4000-8000-000000000001' and team_id is not null and faab_balance = 100),
  2, 'B2 PREMISE: two L1 seats (T1, T4) sit AT the old budget, so §F can also show they are not lifted to the new one');
select is((select count(*)::int from commissioner_actions where league_id in
           ('be000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000002', 'be000000-0000-4000-8000-000000000003')),
  0, 'B3 PREMISE: zero commissioner_actions rows across the three leagues, so every receipt counted below is one this suite caused');
select is((select status from league_weeks where league_id = 'be000000-0000-4000-8000-000000000001' and week = 3),
  'final', 'B4 PREMISE: L1 week 3 really is FINAL — §G''s "final weeks untouched" and the Q64 refusal are about a state that exists');
select is((select points::text from team_week_results where team_id = 'ce000000-0000-4000-8000-000000000001' and week = 3),
  '110.50', 'B5 PREMISE: week 3 carries a stored, final 110.50 for T1 — the literal §G compares against was really written');
select is((select scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Standard')
           from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  true, 'B6 PREMISE: L1''s snapshot IS ESPN Standard''s rules today, so §G''s re-freeze is a change of document and not a rewrite of the same bytes');
select is((select count(*)::int from league_weeks where league_id = 'be000000-0000-4000-8000-000000000002' and status = 'final'),
  0, 'B7 PREMISE: L2 has NO final week — the league on which rescore can reach every scored week');
select is((select count(*)::int from score_fanout where season = 2026 and week = 4),
  0, 'B8 PREMISE: the week-4 queue is EMPTY before any call, so every queue row counted below was written by this verb');
select is((select settings ->> 'waiver_period_hours' from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  '48', 'B9 PREMISE: L1 stores waiver_period_hours = 48 (the §C key''s before-value is a real stored value, not an absent key)');

-- ---------------------------------------------------------------------------
-- C. AN IN-SEASON CHANGE TO A PERMITTED KEY — the receipt names THAT KEY ALONE.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.cs_c1',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'waiver_period_hours', '72'::jsonb, false, 'waivers clear faster in-season',
     '0e000000-0000-4000-8000-000000000010'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);

select is((select settings -> 'waiver_period_hours' from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  '72'::jsonb, 'C1 THE LIFTED GATE: an in_season league''s setting is CHANGED — 118:2489-2497 would have refused this status by name; this verb is the override that message promised');
select is((select settings - 'waiver_period_hours' from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  '{"schedule_mode": "h2h", "bench_lock": true, "tiebreakers": ["win_pct", "points_for", "head_to_head", "points_against", "division_record", "coin_flip"]}'::jsonb,
  'C2 …and EVERY OTHER blob key is byte-untouched (per-key read-modify-write, D347 — not 118''s whole-document UPDATE)');
select is(current_setting('pgtap.cs_c1')::jsonb ->> 'no_changes', 'false',
  'C3 …the document says a change happened, by value');
select is((select count(*)::int from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001'),
  1, 'C4 EXACTLY ONE audit row (D336 part 2)');
select is((select action_type || '|' || target_type || '|' || target_id from commissioner_actions
           where league_id = 'be000000-0000-4000-8000-000000000001'),
  'change_setting|setting|waiver_period_hours', 'C5 …stamped change_setting / setting / <the key> — tasks-M6A §5''s contractual row');
select is((select before::text || ' -> ' || after::text from commissioner_actions
           where league_id = 'be000000-0000-4000-8000-000000000001'),
  '{"waiver_period_hours": 48} -> {"waiver_period_hours": 72}',
  'C6 …and before/after name THAT KEY ALONE — one key in, one key out; a whole-document receipt (118''s shape) would carry fifteen');
select is((select (metadata ->> 'rescore_requested') || '|' || (metadata ->> 'rescore_performed') || '|' || coalesce(metadata ->> 'rescore_not_performed_why', 'null')
           from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001'),
  'false|false|null', 'C7 …with §5''s three contractual metadata extras present: rescore_requested / rescore_performed / rescore_not_performed_why');
select is(current_setting('pgtap.cs_c1')::jsonb ->> 'commissioner_action_id',
  (select id::text from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001'),
  'C8 …and the document NAMES that receipt');
select is(current_setting('pgtap.cs_c1')::jsonb -> 'bypassed', '["settings_status_gate"]'::jsonb,
  'C9 `bypassed` names the ONE rule this write walked past — 118''s status gate — so the receipt says what was lifted (standing rule (g)''s shape, §4 rule 15)');
select is((select count(*)::int from league_chat where league_id = 'be000000-0000-4000-8000-000000000001' and is_system),
  1, 'C10 §10.3: ONE in-transaction league_chat system post, which cannot be disabled');
select ok((select message like 'Setting waiver_period_hours changed from 48 to 72 by %(commissioner override) — reason: waivers clear faster in-season'
           from league_chat where league_id = 'be000000-0000-4000-8000-000000000001' and is_system),
  'C11 …naming the key, both values, the override and the reason');
select is((select updated_at > created_at from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  true, 'C12 …and leagues.updated_at moved (the p_at seam, passed now() by the DEFINER door)');

-- A TYPED COLUMN goes the same way: trade_review is a column, not a blob key.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.cs_c13',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'trade_review', '"league_vote"'::jsonb, false, 'the league asked for votes',
     '0e000000-0000-4000-8000-000000000011'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select trade_review from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  'league_vote', 'C13 a TYPED COLUMN key (trade_review) is written to its column, not into the blob');
select is((select before::text || ' -> ' || after::text from commissioner_actions
           where league_id = 'be000000-0000-4000-8000-000000000001' and target_id = 'trade_review'),
  '{"trade_review": "commissioner"} -> {"trade_review": "league_vote"}',
  'C14 …with the same one-key receipt shape (storage is an implementation detail; the receipt is per key either way)');

-- ---------------------------------------------------------------------------
-- D. THE THREE-WAY NO-OP — Chris''s one condition. ***BREAK PROBE 2''s TARGET.***
-- ---------------------------------------------------------------------------
select set_config('pgtap.cs_a', (select count(*)::text from commissioner_actions
  where league_id = 'be000000-0000-4000-8000-000000000001'), true);
select set_config('pgtap.cs_c', (select count(*)::text from league_chat
  where league_id = 'be000000-0000-4000-8000-000000000001'), true);
select ok(current_setting('pgtap.cs_a')::int > 0 and current_setting('pgtap.cs_c')::int > 0,
  'D0 PREMISE: both tables are NON-EMPTY before the no-ops, so "UNCHANGED" is a real comparison');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- (i) the same value, the same JSON type
select set_config('pgtap.cs_d1',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'waiver_period_hours', '72'::jsonb, false, 'a second look',
     '0e000000-0000-4000-8000-000000000020'::uuid)::text), true);
-- (ii) the same value as a STRING — item 4: `2` and `"2"` are the same value
select set_config('pgtap.cs_d2',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'waiver_period_hours', '"72"'::jsonb, false, 'a third look, typed differently',
     '0e000000-0000-4000-8000-000000000021'::uuid)::text), true);
-- (iii) a TYPED COLUMN re-sent as a string
select set_config('pgtap.cs_d3',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'faab_budget', '"100"'::jsonb, false, 'the budget it already has',
     '0e000000-0000-4000-8000-000000000022'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);

select is(current_setting('pgtap.cs_d1')::jsonb ->> 'no_changes', 'true',
  'D1 (i) re-sending 72 as a number: no_changes = true, DETECTED by canonical jsonb equality (123:1016''s model)');
select is(current_setting('pgtap.cs_d2')::jsonb ->> 'no_changes', 'true',
  'D2 (ii) re-sending "72" as a STRING is the SAME value — canonicalised before comparison, so a client that serialises numbers as strings cannot manufacture a receipt (item 4)');
select is(current_setting('pgtap.cs_d3')::jsonb ->> 'no_changes', 'true',
  'D3 (iii) a typed column (faab_budget) re-sent as "100" is a no-op too');
select is((select count(*)::int from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001'),
  current_setting('pgtap.cs_a')::int,
  'D4 NO RECEIPT for any of the three: the commissioner_actions count is UNCHANGED');
select is((select count(*)::int from league_chat where league_id = 'be000000-0000-4000-8000-000000000001'),
  current_setting('pgtap.cs_c')::int,
  'D5 …the league_chat count is UNCHANGED');
select is((select count(*)::int from commish_setting_actions where action_id in
           ('0e000000-0000-4000-8000-000000000020', '0e000000-0000-4000-8000-000000000021', '0e000000-0000-4000-8000-000000000022')),
  3, 'D6 …but all THREE replay-ledger rows ARE written: an action_id is consumed by its submit whether or not anything moved (§12.26)');
select is(current_setting('pgtap.cs_d2')::jsonb ->> 'commissioner_action_id', null,
  'D7 …commissioner_action_id is NULL on the no-op, and that is the point');
select ok(current_setting('pgtap.cs_d2')::jsonb ->> 'no_changes_why' like 'value_already_set%2 and "2" are the same value%',
  'D8 …and the reason is NAMED, including the type-blindness, so "nothing happened" can never be read as "it worked"');
select is((select faab_balance from league_members where team_id = 'ce000000-0000-4000-8000-000000000002'),
  37, 'D9 …and the faab_budget no-op touched NO balance: the re-seed branch sits inside the guard');

-- ---------------------------------------------------------------------------
-- E. A REFUSED-IN-SEASON KEY, REFUSED BY NAME — and a bracket key both ways.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'regular_season_weeks', '12'::jsonb, false, 'a longer season, please',
       '0e000000-0000-4000-8000-000000000030'::uuid) $$,
  '%regular_season_weeks cannot be changed through this verb%SEASON WINDOW%league_weeks and matchups were generated for the stored plan%Q10%',
  'E1 THE SEASON WINDOW IS REFUSED BY NAME: regular_season_weeks defines rows that already exist (league_weeks + matchups, 111:346/:422) and is Q10-coupled to playoff_start_week — the message names the key, the reason and the coupling');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'team_count', '10'::jsonb, false, 'two more teams',
       '0e000000-0000-4000-8000-000000000031'::uuid) $$,
  '%team_count cannot be changed through this verb%seats%schedule already exist%',
  'E2 …team_count likewise: seats and a schedule exist for the stored count');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'schedule_mode', '"total_points"'::jsonb, false, 'no more matchups',
       '0e000000-0000-4000-8000-000000000032'::uuid) $$,
  '%schedule_mode cannot be changed through this verb%SCHEDULE SHAPE%',
  'E3 …and the schedule SHAPE keys: rows were generated from them');
select is((select regular_season_weeks || '|' || team_count || '|' || (settings ->> 'schedule_mode') from leagues
           where id = 'be000000-0000-4000-8000-000000000001'),
  '10|8|h2h', 'E4 …and none of the three refusals wrote anything');
select is((select count(*)::int from commish_setting_actions where action_id in
           ('0e000000-0000-4000-8000-000000000030', '0e000000-0000-4000-8000-000000000031', '0e000000-0000-4000-8000-000000000032')),
  0, 'E5 …and a refusal consumes NO ledger row: the statement rolled back whole, so the action_id is still usable once the request is lawful');
-- The BRACKET class: allowed while in_season (no bracket yet)…
select is(
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'playoff_teams', '6'::jsonb, false, 'six make it',
     '0e000000-0000-4000-8000-000000000033'::uuid) ->> 'no_changes'),
  'false', 'E6 POSITIVE CONTROL for the bracket class: playoff_teams moves in_season, because the bracket does not exist yet — a per-key refusal is by CLASS AND STATUS, not by "this section cannot change anything"');
select is((select playoff_teams from leagues where id = 'be000000-0000-4000-8000-000000000001'), 6,
  'E7 …and the column reads 6');
reset role;
select set_config('request.jwt.claims', '', true);
-- …and refused by name once the bracket exists. L2 is walked to `playoffs`
-- (a direct status write as postgres — its snapshot is non-NULL, so 059''s
-- guard passes; no schedule rows are needed for this pin).
update leagues set status = 'playoffs' where id = 'be000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000002',
       'playoff_teams', '2'::jsonb, false, 'shrink the bracket mid-bracket',
       '0e000000-0000-4000-8000-000000000034'::uuid) $$,
  '%playoff_teams is REFUSED in-season once the bracket exists%is playoffs%SEEDED from this key (118:1075-1077%',
  'E8 …and in `playoffs` the SAME key is refused BY NAME: the bracket has been seeded from it (118:1075-1077, :1338-1340) and no verb re-seeds a bracket under played rounds');
-- An UNKNOWN key is refused by name too — this verb writes nothing the
-- catalog does not define.
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'player_game_lock', 'true'::jsonb, false, 'bring it back',
       '0e000000-0000-4000-8000-000000000035'::uuid) $$,
  '%player_game_lock is not a league setting this verb knows%',
  'E9 an UNKNOWN key (here the RETIRED player_game_lock, which 115''s CHECK also refuses on the table) is refused by name — no undefined key is ever written into the blob');
reset role;
select set_config('request.jwt.claims', '', true);
update leagues set status = 'in_season' where id = 'be000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- F. THE FAAB RE-SEED PROVEN NOT TO FIRE IN-SEASON — WITH ITS PREMISE (§4
--    rule 14(c) / F345) — AND STILL FIRING PRE-DRAFT. ***BREAK PROBE 1''s
--    TARGET.***
-- ---------------------------------------------------------------------------
select is((select faab_balance from league_members where team_id = 'ce000000-0000-4000-8000-000000000002'),
  37, 'F0 PREMISE, re-asserted at the moment it matters: T2 = 37 ≠ 100 (old) ≠ 150 (new). A cell that only checked "balances unchanged" over seats seeded AT the budget passes with 118''s unconditional re-seed pasted in');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.cs_f1',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'faab_budget', '150'::jsonb, false, 'bigger budget for the stretch run',
     '0e000000-0000-4000-8000-000000000040'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select faab_budget from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  150, 'F1 THE IN-SEASON BUDGET CHANGE LANDS — the per-key table says faab_budget is FREE in-season (re-decision 1: refusing it would be a reachability defect under standing rule (a))');
select is((select faab_balance from league_members where team_id = 'ce000000-0000-4000-8000-000000000002'),
  37, 'F2 …AND THE SPENT BALANCE IS BYTE-UNCHANGED: T2 still carries 37. 118:2617-2621 would have written 150 here — the statement that in-season wipes every team''s spend does NOT fire (re-decision 1)');
select is((select string_agg(coalesce(faab_balance::text, 'null'), ',' order by team_id) from league_members
           where league_id = 'be000000-0000-4000-8000-000000000001' and team_id is not null),
  '100,37,0,100', 'F3 …and EVERY seat is as it was — the two at the old budget were not lifted to 150 either: a budget change in-season moves the number and nothing else');
select is(current_setting('pgtap.cs_f1')::jsonb -> 'consequences' ->> 'faab_reseeded', 'false',
  'F4 …and the document SAYS the re-seed did not fire (§4 rule 15)');
select ok(current_setting('pgtap.cs_f1')::jsonb -> 'consequences' ->> 'faab_reseed_why' like '%in-season%BYTE-UNCHANGED%4 seat(s) now carry a balance that differs from the new budget%commish_edit_faab%',
  'F5 …with WHY, a MEASURED count (all four seats differ from 150), and the per-team route that does exist (commish_edit_faab, §15.4:1698 — M5/F340)');
select is((select before::text || ' -> ' || after::text from commissioner_actions
           where league_id = 'be000000-0000-4000-8000-000000000001' and target_id = 'faab_budget'),
  '{"faab_budget": 100} -> {"faab_budget": 150}', 'F6 …and the receipt names faab_budget alone');
select ok((select message like '%faab_budget changed from 100 to 150%team balances unchanged%'
           from league_chat where league_id = 'be000000-0000-4000-8000-000000000001' and is_system and message like '%faab_budget%'),
  'F7 …and the chat post carries the consequence — "team balances unchanged" — not a bare "changed"');
-- THE PRE-DRAFT POSITIVE CONTROL: the statement still EXISTS behind the
-- status condition. Without this, F2/F3 cannot distinguish "narrowed" from
-- "deleted".
select is((select string_agg(faab_balance::text, ',' order by team_id) from league_members
           where league_id = 'be000000-0000-4000-8000-000000000003'),
  '100,100', 'F8 PREMISE for the control: L3 (setup) seats both sit at 100');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.cs_f9',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000003',
     'faab_budget', '150'::jsonb, false, 'pre-draft budget bump',
     '0e000000-0000-4000-8000-000000000041'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select string_agg(faab_balance::text, ',' order by team_id) from league_members
           where league_id = 'be000000-0000-4000-8000-000000000003'),
  '150,150', 'F9 POSITIVE CONTROL: in a SETUP league the re-seed FIRES and every seat reads the new budget (§12.2/D70 — 118:2617-2621''s rule kept for exactly the state its own comment names). So F2''s 37 is the STATUS condition at work, not a deleted statement');
select is(current_setting('pgtap.cs_f9')::jsonb -> 'consequences' ->> 'faab_reseeded', 'true',
  'F10 …and the document says so');
select is(current_setting('pgtap.cs_f9')::jsonb -> 'bypassed', '[]'::jsonb,
  'F11 …and pre-draft `bypassed` is EMPTY — nothing was lifted, and the document says why (the document path admits this key too)');

-- ---------------------------------------------------------------------------
-- G. THE SCORING CHANGE: re-freeze, final weeks untouched, `rescore`.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.cs_g1',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'scoring_system_id', to_jsonb((select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')),
     false, 'PPR from here on',
     '0e000000-0000-4000-8000-000000000050'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select scoring_system_id from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  (select id from scoring_systems where is_template and name = 'ESPN Full PPR'),
  'G1 the scoring reference moves to the new template');
select is((select scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Full PPR')
           from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  true, 'G2 THE SNAPSHOT IS RE-FROZEN from the NEW rules in the same statement (§7.3.3 "on any commissioner scoring change" — never-weaken; re-decision 2 keeps 118:2585-2590''s rule)');
select is((select points::text from team_week_results where team_id = 'ce000000-0000-4000-8000-000000000001' and week = 3),
  '110.50', 'G3 …AND FINAL WEEK 3''S STORED SCORE IS UNTOUCHED (110.50, B5''s literal): a re-frozen snapshot rewrites no stored score');
select is((select status from league_weeks where league_id = 'be000000-0000-4000-8000-000000000001' and week = 3),
  'final', 'G4 …and week 3 is still final — nothing reopened it');
select is((select count(*)::int from score_fanout where season = 2026 and week = 4), 0,
  'G5 …and with rescore = false NOTHING was queued for the open week 4 either');
select is(current_setting('pgtap.cs_g1')::jsonb ->> 'rescore_performed', 'false',
  'G6 the document says rescore was NOT performed…');
select ok(current_setting('pgtap.cs_g1')::jsonb ->> 'rescore_not_performed_why' like 'not_requested%1 final week(s) [3] keep their stored scores%1 open week(s) [4] keep the points already computed under the PREVIOUS snapshot',
  'G7 …WHY, naming the final week left as it was AND the open week now carrying points computed under the previous snapshot');
select is(current_setting('pgtap.cs_g1')::jsonb -> 'consequences' ->> 'score_stale' || '|' || (current_setting('pgtap.cs_g1')::jsonb -> 'consequences' ->> 'score_stale_reason'),
  'true|snapshot_changed_without_rescore',
  'G8 …and it flags the open week as STALE by name — a re-frozen snapshot over an already-scored live week is a MIXED week, and the one thing this verb must never report as clean (§4 rule 15)');
select is((select metadata ->> 'rescore_requested' || '|' || (metadata ->> 'rescore_performed') from commissioner_actions
           where league_id = 'be000000-0000-4000-8000-000000000001' and target_id = 'scoring_system_id'),
  'false|false', 'G9 …and the receipt carries the same two facts');

-- THE Q64 REFUSAL: rescore = true on a league with a FINAL week.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'scoring_system_id', to_jsonb((select id::text from scoring_systems where is_template and name = 'Sleeper Standard')),
       true, 'rescore everything',
       '0e000000-0000-4000-8000-000000000051'::uuid) $$,
  '%rescore = true cannot reach FINAL week(s) [3] of league%NO VERB REOPENS A WEEK TODAY (Q64%zero writers)%resubmit with rescore = false%wait for reopen_week%',
  'G10 `rescore` ON A FINAL WEEK IS REFUSED BY NAME (Q64''s recommendation, task item 3): the message names the week, says why (no reopen_week exists; reopened_by_action_id has zero writers) and names both routes. Silently accepting the flag was the one option §4 rule 15 forbade');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select scoring_system_id from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  (select id from scoring_systems where is_template and name = 'ESPN Full PPR'),
  'G11 …and the refusal wrote NOTHING: the reference is still Full PPR — a commissioner who asked for a rescored season gets a rescored season or nothing, never half');
select is((select count(*)::int from commish_setting_actions where action_id = '0e000000-0000-4000-8000-000000000051'), 0,
  'G12 …and consumed no ledger row');
select is((select count(*)::int from score_fanout where season = 2026 and week = 4), 0,
  'G13 …and queued nothing');
-- THE Q64 SEAM, pinned as a position in the text so a future reopen_week
-- task finds exactly one block to replace.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting_internal'
     and p.prosrc like '%Q64 SEAM%'),
  1, 'G14 the seam is ONE marked block in the body (`-- Q64 SEAM`): the RAISE a future reopen_week replaces with a per-week reopen call, and nothing else');

-- `rescore` WHERE IT CAN DO SOMETHING: L2 has no final week and a live week 4.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.cs_g15',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000002',
     'scoring_system_id', to_jsonb((select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')),
     true, 'PPR, and re-score the live week',
     '0e000000-0000-4000-8000-000000000052'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(current_setting('pgtap.cs_g15')::jsonb ->> 'rescore_performed', 'true',
  'G15 with NO final week, rescore = true is PERFORMED');
select is((select string_agg(player_id || '@' || (enqueued_at = (select updated_at from player_stats where player_id = 'cs2-qb' and week = 4))::text, ',')
           from score_fanout where season = 2026 and week = 4),
  'cs2-qb@true', 'G16 …ONE score_fanout row per starter of the open week (L2''s cs2-qb), stamped with the player''s OWN stat-line updated_at — never now() (123''s SCORING rule: a now() stamp is not_ready for ever)');
select is(current_setting('pgtap.cs_g15')::jsonb -> 'consequences' -> 'rescored_weeks',
  '[{"week": 4, "status": "live", "starters_enqueued": 1, "score_not_enqueued": []}]'::jsonb,
  'G17 …and the document names the week, its status and the count');
select is((select scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Full PPR')
           from leagues where id = 'be000000-0000-4000-8000-000000000002'),
  true, 'G18 …with the snapshot re-frozen here too');
-- The IR exclusion and the unqueueable, NAMED — on L1, which now has to lose
-- its final week to be rescorable at all. Walk it there the honest way: this
-- is NOT a reopen (110 refuses final → anything without an audit id); a
-- fresh L1-shaped league would be scenery, so instead L2 gains a second team
-- carrying L1''s week-4 shape (IR man + unstamped + missing lines).
insert into teams (id, owner_id, name, league_id) values
 ('ce000000-0000-4000-8000-000000000006', '9e000000-0000-4000-8000-000000000002', 'CS T6', 'be000000-0000-4000-8000-000000000002');
update leagues set roster_settings = '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}], "bench": 3, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'
where id = 'be000000-0000-4000-8000-000000000002';
insert into team_lineups (team_id, season, week, slot_map, starters, bench) values
 ('ce000000-0000-4000-8000-000000000006', 2026, 4, '{"qb:0": "cs-qb1", "rb:0": "cs-rb1", "ir1:0": "cs-ir"}', '[]', '[]');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.cs_g19',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000002',
     'scoring_system_id', to_jsonb((select id::text from scoring_systems where is_template and name = 'Sleeper Standard')),
     true, 'and again, with a harder roster',
     '0e000000-0000-4000-8000-000000000053'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select string_agg(player_id, ',' order by player_id) from score_fanout where season = 2026 and week = 4),
  'cs-qb1,cs2-qb', 'G19 the IR man (cs-ir, on ir1:0 with a healthy stamp) is NOT queued — starters are derived the way the worker derives them (startersOf: IR keys excluded) — and cs-rb1''s NULL-stamped line could not be queued');
select is(current_setting('pgtap.cs_g19')::jsonb -> 'consequences' -> 'rescored_weeks' -> 0 -> 'score_not_enqueued',
  '[{"why": "stats_unstamped", "player_id": "cs-rb1"}]'::jsonb,
  'G20 …and the starter the INSERT could NOT queue is NAMED with why (R968''s arm) — never folded into silence');
-- `rescore` on a key with no score to recompute is a MALFORMED CALL.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'bench_lock', 'false'::jsonb, true, 'rescore a boolean?',
       '0e000000-0000-4000-8000-000000000054'::uuid) $$,
  '%rescore applies only to scoring_system_id%bench_lock has no stored score to recompute%',
  'G21 `rescore` on any other key is refused by name — the flag has no subject there, and a success document for a flag that meant nothing is 126''s rule against');
-- A personal / non-template system cannot be attached (118 step 5''s scope).
insert into scoring_systems (id, name, owner_id, is_template, rules)
values ('ee000000-0000-4000-8000-000000000001', 'cs personal', '9e000000-0000-4000-8000-000000000001', false, '{"pass_yards": 0.04}');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'scoring_system_id', '"ee000000-0000-4000-8000-000000000001"'::jsonb, false, 'my own system',
       '0e000000-0000-4000-8000-000000000055'::uuid) $$,
  '%must reference one of the scoring templates%118 step 5%',
  'G22 a PERSONAL scoring system is refused by name — 118 step 5''s attachable scope, kept (§7.3.8 v2.11 / §7.3.3.1)');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- H. THE REASON GATE, THE SHAPE GATES, THE VALUE GATES.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'bench_lock', 'false'::jsonb, false, E' \t\r\n ', '0e000000-0000-4000-8000-000000000060'::uuid) $$,
  '22023', null, 'H1 a reason of nothing but whitespace INCLUDING TABS AND NEWLINES is refused (R745: plain btrim strips spaces only)');
select throws_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'bench_lock', 'false'::jsonb, false, repeat('x', 501), '0e000000-0000-4000-8000-000000000061'::uuid) $$,
  '22023', null, 'H2 a 501-character reason is refused (the league_chat bound)');
select throws_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'bench_lock', 'false'::jsonb, false, 'no key', null) $$,
  '22023', null, 'H3 a missing action_id is refused: the idempotency key is not optional');
select throws_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       E' \t', 'false'::jsonb, false, 'no key at all', '0e000000-0000-4000-8000-000000000062'::uuid) $$,
  '22023', null, 'H4 LOUD EMPTINESS: a call naming no key is a MALFORMED CALL refused by name — never no_changes: true');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'waiver_period_hours', '"lots"'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000063'::uuid) $$,
  '%waiver_period_hours requires an integer between 0 and 168 — got lots%',
  'H5 a value of the wrong TYPE is refused by name, with the range');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'waiver_period_hours', '169'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000064'::uuid) $$,
  '%waiver_period_hours must be between 0 and 168%got 169%',
  'H6 …169 is refused (one over §7.3.4''s 0-168)…');
select lives_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'waiver_period_hours', '168'::jsonb, false, 'the boundary', '0e000000-0000-4000-8000-000000000065'::uuid) $$,
  'H7 …and 168 lives — the boundary, one unit either side');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'waiver_type', '"faab_plus"'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000066'::uuid) $$,
  '%waiver_type must be one of faab, rolling_priority, reverse_standings, none_fcfs — got faab_plus%',
  'H8 an enum outside its options is refused, naming the options');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'tiebreakers', '["win_pct", "points_for", "win_pct"]'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000067'::uuid) $$,
  '%tiebreakers carries a duplicated entry%',
  'H9 a duplicated tiebreaker entry is refused (league_standings would refuse the stored array, 117:1020-1033 — refused HERE so it is never stored)');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'playoff_teams', '10'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000068'::uuid) $$,
  '%playoff_teams 10 exceeds team_count 8%',
  'H10 a cross-field bound (playoff_teams ≤ team_count, §7.3.1) is read from the LOCKED row');
select throws_like(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'roster_settings', '{"starting_slots": [{"key": "qb", "eligible": [], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000069'::uuid) $$,
  '%every roster_settings.starting_slots entry needs a key, a non-empty eligible[]%',
  'H11 a roster_settings object with a slot that admits no position is refused by name (§7.3.2''s floor)');
-- roster_settings LANDS in-season (§7.3 header: override-only, "allowed but
-- logged and warned") and the warning is a NUMBER.
select set_config('pgtap.cs_h12',
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'roster_settings', '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}], "bench": 3, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb,
     false, 'a second RB slot', '0e000000-0000-4000-8000-000000000070'::uuid)::text), true);
select is(current_setting('pgtap.cs_h12')::jsonb -> 'consequences' ->> 'lineups_not_refit', '2',
  'H12 roster_settings lands in-season (§7.3 header) and the document COUNTS the lineup rows nothing re-fit — L1''s two week-4 lineups — so "warned" is a number, not a mood');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- I. AUTH — one no-leak 42501 (071 §F).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'bench_lock', 'false'::jsonb, false, 'not mine', '0e000000-0000-4000-8000-000000000080'::uuid) $$,
  '42501', 'commish_change_setting: not a commissioner of this league',
  'I1 a seated MANAGER is refused with the one no-leak 42501');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'bench_lock', 'false'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000081'::uuid) $$,
  '42501', 'commish_change_setting: not a commissioner of this league', 'I2 an OUTSIDER is refused the same way');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'bench_lock', 'false'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000082'::uuid) $$,
  '42501', 'commish_change_setting: not a commissioner of this league', 'I3 a MEMBER WITH NO TEAM is refused the same way');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_change_setting('00000000-0000-4000-8000-0000000000aa',
       'bench_lock', 'false'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000083'::uuid) $$,
  '42501', 'commish_change_setting: not a commissioner of this league',
  'I4 NO LEAK: a league that does not exist gets the IDENTICAL message (D336 part 5)');
select set_config('request.jwt.claims', '', true);
reset role;
set local role anon;
select throws_ok(
  $$ select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
       'bench_lock', 'false'::jsonb, false, 'x', '0e000000-0000-4000-8000-000000000084'::uuid) $$,
  '42501', null, 'I5 anon cannot reach the door at all (the REVOKE, not the body)');
reset role;
select is((select settings ->> 'bench_lock' from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  'true', 'I6 …and none of the five refusals wrote anything');

-- ---------------------------------------------------------------------------
-- J. REPLAY — byte-identical, nothing re-written.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select public.commish_change_setting('be000000-0000-4000-8000-000000000001',
     'bench_lock', 'false'::jsonb, false, 'a completely different request',
     '0e000000-0000-4000-8000-000000000010'::uuid)::text),
  current_setting('pgtap.cs_c1'),
  'J1 REPLAY (E2/D68): §C''s action_id returns §C''s document BYTE-identically — with a different KEY, value and reason. The lookup sits AFTER auth but BEFORE every business gate');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select settings ->> 'bench_lock' from leagues where id = 'be000000-0000-4000-8000-000000000001'),
  'true', 'J2 …and NOTHING was written on the replay: the returned document is a record, not an instruction');

-- ---------------------------------------------------------------------------
-- K. NEVER-WEAKEN PINS (§4 rule 13). 129 replaces NOTHING; these cells are
--    what makes the claim falsifiable.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_league_settings'),
  1, 'K1 update_league_settings is still ONE overload — 129 added a sibling verb, never a second signature');
select ok(
  (select p.prosrc like '%settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_league_settings'),
  'K2 …and 118''s status gate (118:2489-2497) is still in its prosrc, byte for byte — the document path is unchanged; this verb LIFTS the gate as a property of the NEW verb, never by relaxing 118');
select ok(
  (select p.prosrc like '%SET faab_balance = p_faab_budget%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_league_settings'),
  'K3 …and 118''s FAAB re-seed statement (118:2617-2621) is still there for the pre-draft document path — re-decision 1 narrows THIS verb''s copy, not 118''s');
select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.leagues'::regclass and tgname = 'trg_leagues_scoring_rules_valid' and tgenabled = 'A')
  and exists (select 1 from pg_trigger where tgrelid = 'public.leagues'::regclass and tgname = 'trg_leagues_scoring_reference_guard'),
  'K4 104''s two walls on leagues (the snapshot validator, ENABLE ALWAYS; the reference guard) are still there — the re-freeze RIDES them and does not bypass them');
select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.league_weeks'::regclass and tgname = 'trg_league_weeks_transition'),
  'K5 110''s week-status guard is still there: a final week cannot be reopened without a NEW reopened_by_action_id (110:285-296) — which is exactly why the Q64 seam refuses rather than flips');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'reopen_week%'),
  0, 'K6 and NO reopen_week exists after 129 (the split seam, migration 132 / pgTAP 080, was NOT taken) — G10''s refusal is honest');

-- ---------------------------------------------------------------------------
-- L. THE POLICY TABLE, PINNED AS DATA (the banner''s table = this function).
-- ---------------------------------------------------------------------------
select is((select string_agg(k || ':' || (commish_setting_policy(k) ->> 'class'), ',' order by k)
           from unnest(array['faab_budget', 'waiver_type', 'trade_review', 'trade_deadline_week', 'roster_settings',
                             'waiver_period_hours', 'tiebreakers', 'playoff_reseed', 'allow_illegal_lineups']) k),
  'allow_illegal_lineups:free,faab_budget:free,playoff_reseed:free,roster_settings:free,tiebreakers:free,trade_deadline_week:free,trade_review:free,waiver_period_hours:free,waiver_type:free',
  'L1 FREE keys');
select is(commish_setting_policy('scoring_system_id') ->> 'class', 'rescore', 'L2 scoring_system_id is the ONE rescore key');
select is((select string_agg(k || ':' || (commish_setting_policy(k) ->> 'class'), ',' order by k)
           from unnest(array['playoff_teams', 'playoff_weeks_per_round', 'consolation_bracket', 'third_place_game']) k),
  'consolation_bracket:bracket,playoff_teams:bracket,playoff_weeks_per_round:bracket,third_place_game:bracket',
  'L3 BRACKET keys — changeable until the bracket exists');
select is((select string_agg(k || ':' || (commish_setting_policy(k) ->> 'class'), ',' order by k)
           from unnest(array['regular_season_weeks', 'playoff_start_week', 'team_count', 'schedule_mode', 'median_game',
                             'second_opponent', 'format', 'lineup_lock', 'divisions', 'playoff_byes', 'schedule_seed', 'draft']) k),
  'divisions:refused,draft:refused,format:refused,lineup_lock:refused,median_game:refused,playoff_byes:refused,playoff_start_week:refused,regular_season_weeks:refused,schedule_mode:refused,schedule_seed:refused,second_opponent:refused,team_count:refused',
  'L4 REFUSED keys — each carries its own refused_why');
select ok((select bool_and(commish_setting_policy(k) ->> 'refused_why' is not null)
           from unnest(array['regular_season_weeks', 'team_count', 'schedule_mode', 'format', 'lineup_lock', 'divisions', 'playoff_byes', 'schedule_seed', 'draft', 'playoff_teams']) k),
  'L5 …every refused and bracket key carries a non-null refused_why (L.E1.13 renders it verbatim)');
select is(commish_setting_policy('player_game_lock'), null, 'L6 a retired / unknown key has NO policy row — and the verb refuses it by name (E9)');

select * from finish();
rollback;
