-- ============================================================================
-- pgTAP 078 — migration 130: `commish_edit_schedule` (the lock-exempt
-- sibling) + `schedule_edit_matchup`'s receipt hunk
-- (task L.E1.9 of M6A; tasks-M6A §6 "L.E1.9" PROOF, §4 rules 1-15, D348 /
-- D350 / D353; PROGRESS standing rule (a)/(b)/(g)/(i), F225 / F339 / F341 /
-- F360 / F361; `spec:1700`, §11.7, §22.2, E41.)
--
-- WHAT THIS SUITE IS ORGANISED TO PROVE, IN THE ORDER THE BREAKDOWN ASKS:
--   §A  form pins — the ledger (D350), the door, the internal; TRUNCATE
--       asserted PER ROLE; 111's door grants unchanged by the CREATE OR
--       REPLACE.
--   §B  fixtures and their PREMISES (§4 rule 14(c)): the week/matchup/kickoff
--       states every contrast below depends on, asserted BY VALUE first.
--   §C  111's RECEIPT, post-kickoff arm: an edit writes EXACTLY ONE
--       commissioner_actions row with the right target and reason while the
--       existing schedule_actions row and league_chat post are STILL written.
--       ***BREAK PROBE 2's TARGET*** (delete the log call ⇒ C2 reds).
--   §D  111's RECEIPT, free-window arm (L2) — RE-CUT UNDER Q66 (Chris,
--       2026-09-16; spec v2.16.41): a reason-less free-window edit LANDS and
--       writes EXACTLY ONE receipt whose `reason` IS NULL; a whitespace-only
--       reason stores NULL, never ''; a non-empty reason is stored TRIMMED;
--       a NO-OP edit is still a REFUSAL and writes NONE of the three; a
--       501-character reason is refused. ***BREAK PROBE (i)'s TARGET*** (the
--       reason refusal re-added to the hunk ⇒ D1/D2/D7 red by name).
--   §E  THE PAIRED CONTRASTS, one per lifted refusal, ADJACENT cells at the
--       SAME fixture state: 111 refuses BY NAME, the sibling lands it and
--       names the bypass in `bypassed[]` — 111:887 (matchup status),
--       111:904 (week status, with the kickoff lock it implies), 111:913
--       (the week's own kickoff, R730 — the lock the sibling's name is
--       about), 111:993 (a sibling row's status).
--   §F  THE KEPT GATES, adjacent pairs: a scored cell, an overridden cell and
--       a bracket row are refused BY NAME by BOTH verbs (§22.2 / F360).
--   §G  the sibling's NO-OP: `no_changes: true`, no receipt, no post, ledger
--       row written, `commissioner_action_id` NULL, WHY named.
--   §H  the sibling's reason handling (OPTIONAL under Q66: blank / tabs /
--       NULL all LAND with a NULL-reason receipt; 501 refused) and its shape
--       gates. ***BREAK PROBE (iv)'s TARGET*** (the sibling's reason refusal
--       re-added ⇒ H1/H2/H3 red).
--   §M  Q66's SCHEMA CHANGE (130 §0): `commissioner_actions.reason` nullable,
--       its CHECK re-minted as `reason IS NULL OR <class + bound>` (a stored
--       literal), a NULL reason INSERTS, '' / tab-only / 501 are still 23514.
--   §I  AUTH — one no-leak 42501 (071 §F).
--   §J  REPLAY — byte-identical, nothing re-written.
--   §K  WHAT SCORING DID NOT DO on a live week (§4 rule 15), with the
--       team_week_results premise asserted.
--   §L  NEVER-WEAKEN PINS (§4 rule 13): 111's four refusal strings still in
--       `schedule_edit_matchup`'s prosrc; `is_league_commish` named exactly
--       once there; the receipt call present EXACTLY ONCE there and ZERO
--       times in `schedule_remix_confirm`; `schedule_remix_confirm`'s prosrc
--       md5 equal to its pre-130 literal (F341's wall); every function one
--       overload each. ***BREAK PROBE 1's TARGET*** (a commissioner arm on
--       111's verb ⇒ L2/L5 red, and E1's refusal cell with them).
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(129);

-- ---------------------------------------------------------------------------
-- A. FORM PINS
-- ---------------------------------------------------------------------------
select has_table('public', 'commish_schedule_actions',
  'A1 commish_schedule_actions exists — this verb''s OWN replay ledger (D350), never schedule_actions'' namespace (F326)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'commish_schedule_actions'),
  0, 'A2 …with ZERO policies: the DEFINER verb is its only reader and writer (123:333-335''s pre-planted-row attack is impossible here)');
select ok(
  exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
          where r.relname = 'commish_schedule_actions' and c.contype = 'u'
            and pg_get_constraintdef(c.oid) = 'UNIQUE (league_id, action_id)'),
  'A3 …and UNIQUE (league_id, action_id) is the race backstop');
select ok(not has_table_privilege('anon', 'public.commish_schedule_actions', 'TRUNCATE'),
  'A4 REVOKE TRUNCATE — anon holds no TRUNCATE on the ledger (RLS does not cover TRUNCATE; F348)');
select ok(not has_table_privilege('authenticated', 'public.commish_schedule_actions', 'TRUNCATE'),
  'A5 …and neither does authenticated (asserted per role with has_table_privilege)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_edit_schedule', 'commish_edit_schedule_internal')),
  2, 'A6 the two 130 functions exist, ONE overload each');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_edit_schedule'),
  'A7 the client door is SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_edit_schedule_internal'),
  'A8 the internal is PLAIN with search_path='''' (123:498-505''s posture)');
select ok(
  not has_function_privilege('anon', 'public.commish_edit_schedule(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_edit_schedule(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'A9 commish_edit_schedule: anon holds no EXECUTE; authenticated may call — the commissioner check is IN-BODY');
select ok(
  not has_function_privilege('authenticated', 'public.commish_edit_schedule_internal(uuid,uuid,uuid,uuid,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_edit_schedule_internal(uuid,uuid,uuid,uuid,uuid,timestamptz,text)', 'EXECUTE'),
  'A10 the internal is triple-REVOKEd — no client can supply the instant (rule 10)');
select ok(
  not has_function_privilege('anon', 'public.schedule_edit_matchup(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.schedule_edit_matchup(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'A11 111''s door keeps 111:1155''s grants through the CREATE OR REPLACE — anon revoked, authenticated may call');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_edit_schedule_internal'
     and p.prosrc like '%log_commissioner_action_internal%'),
  1, 'A12 the sibling writes its receipt through the ONE shared logging helper (123:417-453)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_edit_schedule_internal'
     and p.prosrc like '%team_managers%'),
  0, 'A13 F35 re-affirmed: the body never names team_managers');

-- ---------------------------------------------------------------------------
-- B. FIXTURES (postgres context, JWT cleared) — AND THEIR PREMISES.
--    L1 (in_season, 2026, 8 franchises T1-T8; u1 commissioner, u2/u3
--       managers, T4-T8 placeholders; u4 outsider). Weeks 1-3, four
--       regular rows each (the rows not named below pair T5-T8 and are
--       never edited — they exist so the every-team-once re-validation is a
--       real 8-team check):
--         week 1  status LIVE, its game kicked off 1h ago; M11 (T1,T2)
--                 scheduled/unscored; M12 (T3,T4) scheduled but OVERRIDDEN
--         week 2  status upcoming, its game 7 days ahead; M21 (T1,T3) status
--                 LIVE but unscored; M22 (T2,T4) scheduled; M23 a PLAYOFF row
--         week 3  status upcoming BUT its game kicked off 30 min ago (R730);
--                 M31 (T1,T4) scheduled; M32 (T2,T3) scheduled and SCORED
--    L2 (in_season, 2026, 8 franchises T11-T18; u1 commissioner): league weeks
--       4-5, both upcoming, both games weeks ahead — the league whose FIRST
--       week has not kicked off, i.e. E41's FREE window for 111's verb.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9f000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-es' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'es_user' || i)::jsonb, now(), now()
from generate_series(1, 4) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, settings, created_at, updated_at) values
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'pgtap-es-L1', 2026,
  'in_season', 8, 10, 2, 11,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h", "second_opponent": false}',
  now() - interval '10 days', now() - interval '10 days'),
 ('bf000000-0000-4000-8000-000000000002', '9f000000-0000-4000-8000-000000000001', 'pgtap-es-L2', 2026,
  'in_season', 8, 10, 2, 11,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h", "second_opponent": false}',
  now() - interval '10 days', now() - interval '10 days');

insert into teams (id, owner_id, name, league_id) values
 ('cf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'ES T1', 'bf000000-0000-4000-8000-000000000001'),
 ('cf000000-0000-4000-8000-000000000002', '9f000000-0000-4000-8000-000000000002', 'ES T2', 'bf000000-0000-4000-8000-000000000001'),
 ('cf000000-0000-4000-8000-000000000003', '9f000000-0000-4000-8000-000000000003', 'ES T3', 'bf000000-0000-4000-8000-000000000001'),
 ('cf000000-0000-4000-8000-000000000004', '9f000000-0000-4000-8000-000000000001', 'ES T4', 'bf000000-0000-4000-8000-000000000001'),
 ('cf000000-0000-4000-8000-000000000005', '9f000000-0000-4000-8000-000000000001', 'ES T5', 'bf000000-0000-4000-8000-000000000001'),
 ('cf000000-0000-4000-8000-000000000006', '9f000000-0000-4000-8000-000000000001', 'ES T6', 'bf000000-0000-4000-8000-000000000001'),
 ('cf000000-0000-4000-8000-000000000007', '9f000000-0000-4000-8000-000000000001', 'ES T7', 'bf000000-0000-4000-8000-000000000001'),
 ('cf000000-0000-4000-8000-000000000008', '9f000000-0000-4000-8000-000000000001', 'ES T8', 'bf000000-0000-4000-8000-000000000001'),
 ('cf000000-0000-4000-8000-00000000000b', '9f000000-0000-4000-8000-000000000001', 'ES T11', 'bf000000-0000-4000-8000-000000000002'),
 ('cf000000-0000-4000-8000-00000000000c', '9f000000-0000-4000-8000-000000000001', 'ES T12', 'bf000000-0000-4000-8000-000000000002'),
 ('cf000000-0000-4000-8000-00000000000d', '9f000000-0000-4000-8000-000000000001', 'ES T13', 'bf000000-0000-4000-8000-000000000002'),
 ('cf000000-0000-4000-8000-00000000000e', '9f000000-0000-4000-8000-000000000001', 'ES T14', 'bf000000-0000-4000-8000-000000000002'),
 ('cf000000-0000-4000-8000-00000000000f', '9f000000-0000-4000-8000-000000000001', 'ES T15', 'bf000000-0000-4000-8000-000000000002'),
 ('cf000000-0000-4000-8000-000000000010', '9f000000-0000-4000-8000-000000000001', 'ES T16', 'bf000000-0000-4000-8000-000000000002'),
 ('cf000000-0000-4000-8000-000000000011', '9f000000-0000-4000-8000-000000000001', 'ES T17', 'bf000000-0000-4000-8000-000000000002'),
 ('cf000000-0000-4000-8000-000000000012', '9f000000-0000-4000-8000-000000000001', 'ES T18', 'bf000000-0000-4000-8000-000000000002');

insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'commissioner', false),
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000002', 'manager', false),
 ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000003', 'manager', false),
 ('bf000000-0000-4000-8000-000000000001', null, 'cf000000-0000-4000-8000-000000000004', 'manager', true),
 ('bf000000-0000-4000-8000-000000000001', null, 'cf000000-0000-4000-8000-000000000005', 'manager', true),
 ('bf000000-0000-4000-8000-000000000001', null, 'cf000000-0000-4000-8000-000000000006', 'manager', true),
 ('bf000000-0000-4000-8000-000000000001', null, 'cf000000-0000-4000-8000-000000000007', 'manager', true),
 ('bf000000-0000-4000-8000-000000000001', null, 'cf000000-0000-4000-8000-000000000008', 'manager', true),
 ('bf000000-0000-4000-8000-000000000002', '9f000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-00000000000b', 'commissioner', false),
 ('bf000000-0000-4000-8000-000000000002', null, 'cf000000-0000-4000-8000-00000000000c', 'manager', true),
 ('bf000000-0000-4000-8000-000000000002', null, 'cf000000-0000-4000-8000-00000000000d', 'manager', true),
 ('bf000000-0000-4000-8000-000000000002', null, 'cf000000-0000-4000-8000-00000000000e', 'manager', true),
 ('bf000000-0000-4000-8000-000000000002', null, 'cf000000-0000-4000-8000-00000000000f', 'manager', true),
 ('bf000000-0000-4000-8000-000000000002', null, 'cf000000-0000-4000-8000-000000000010', 'manager', true),
 ('bf000000-0000-4000-8000-000000000002', null, 'cf000000-0000-4000-8000-000000000011', 'manager', true),
 ('bf000000-0000-4000-8000-000000000002', null, 'cf000000-0000-4000-8000-000000000012', 'manager', true);

-- Weeks. The F4 guard (§12.17) permits only forward steps; L1 week 1 is
-- WALKED to live. L2's weeks are 4-5 so its FIRST league week is ahead.
insert into league_weeks (league_id, season, week)
select 'bf000000-0000-4000-8000-000000000001', 2026, g from generate_series(1, 3) g;
update league_weeks set status = 'live' where league_id = 'bf000000-0000-4000-8000-000000000001' and week = 1;
insert into league_weeks (league_id, season, week)
select 'bf000000-0000-4000-8000-000000000002', 2026, g from generate_series(4, 5) g;

-- The calendar (059's shape): every 2026 nfl_weeks datum ahead, no stray
-- games, then ONE game per week whose kickoff is the week's datum.
update nfl_weeks w
set starts_at = now() + (w.week * interval '7 days'), first_kickoff_at = null, last_game_ends_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
  ('es-w1', 2026, 1, 'KC',  'BUF', now() - interval '1 hour'),      -- kicked off (week 1 LIVE)
  ('es-w2', 2026, 2, 'DAL', 'PHI', now() + interval '7 days'),      -- ahead
  ('es-w3', 2026, 3, 'SF',  'SEA', now() - interval '30 minutes'),  -- kicked off while the status row still says upcoming (R730)
  ('es-w4', 2026, 4, 'GB',  'DET', now() + interval '21 days'),     -- ahead (L2's first week)
  ('es-w5', 2026, 5, 'MIA', 'NYJ', now() + interval '28 days');

insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, status) values
 ('df000000-0000-4000-8000-000000000011', 'bf000000-0000-4000-8000-000000000001', 2026, 1, 'regular', 'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000002', 'scheduled'),
 ('df000000-0000-4000-8000-000000000012', 'bf000000-0000-4000-8000-000000000001', 2026, 1, 'regular', 'cf000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000004', 'scheduled'),
 ('df000000-0000-4000-8000-000000000013', 'bf000000-0000-4000-8000-000000000001', 2026, 1, 'regular', 'cf000000-0000-4000-8000-000000000005', 'cf000000-0000-4000-8000-000000000006', 'scheduled'),
 ('df000000-0000-4000-8000-000000000014', 'bf000000-0000-4000-8000-000000000001', 2026, 1, 'regular', 'cf000000-0000-4000-8000-000000000007', 'cf000000-0000-4000-8000-000000000008', 'scheduled'),
 ('df000000-0000-4000-8000-000000000021', 'bf000000-0000-4000-8000-000000000001', 2026, 2, 'regular', 'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000003', 'live'),
 ('df000000-0000-4000-8000-000000000022', 'bf000000-0000-4000-8000-000000000001', 2026, 2, 'regular', 'cf000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000004', 'scheduled'),
 ('df000000-0000-4000-8000-000000000023', 'bf000000-0000-4000-8000-000000000001', 2026, 2, 'playoff', 'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000002', 'scheduled'),
 ('df000000-0000-4000-8000-000000000024', 'bf000000-0000-4000-8000-000000000001', 2026, 2, 'regular', 'cf000000-0000-4000-8000-000000000005', 'cf000000-0000-4000-8000-000000000007', 'scheduled'),
 ('df000000-0000-4000-8000-000000000025', 'bf000000-0000-4000-8000-000000000001', 2026, 2, 'regular', 'cf000000-0000-4000-8000-000000000006', 'cf000000-0000-4000-8000-000000000008', 'scheduled'),
 ('df000000-0000-4000-8000-000000000031', 'bf000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004', 'scheduled'),
 ('df000000-0000-4000-8000-000000000032', 'bf000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'cf000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000003', 'scheduled'),
 ('df000000-0000-4000-8000-000000000033', 'bf000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'cf000000-0000-4000-8000-000000000005', 'cf000000-0000-4000-8000-000000000008', 'scheduled'),
 ('df000000-0000-4000-8000-000000000034', 'bf000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'cf000000-0000-4000-8000-000000000006', 'cf000000-0000-4000-8000-000000000007', 'scheduled'),
 ('df000000-0000-4000-8000-000000000041', 'bf000000-0000-4000-8000-000000000002', 2026, 4, 'regular', 'cf000000-0000-4000-8000-00000000000b', 'cf000000-0000-4000-8000-00000000000c', 'scheduled'),
 ('df000000-0000-4000-8000-000000000042', 'bf000000-0000-4000-8000-000000000002', 2026, 4, 'regular', 'cf000000-0000-4000-8000-00000000000d', 'cf000000-0000-4000-8000-00000000000e', 'scheduled'),
 ('df000000-0000-4000-8000-000000000043', 'bf000000-0000-4000-8000-000000000002', 2026, 4, 'regular', 'cf000000-0000-4000-8000-00000000000f', 'cf000000-0000-4000-8000-000000000010', 'scheduled'),
 ('df000000-0000-4000-8000-000000000044', 'bf000000-0000-4000-8000-000000000002', 2026, 4, 'regular', 'cf000000-0000-4000-8000-000000000011', 'cf000000-0000-4000-8000-000000000012', 'scheduled'),
 ('df000000-0000-4000-8000-000000000051', 'bf000000-0000-4000-8000-000000000002', 2026, 5, 'regular', 'cf000000-0000-4000-8000-00000000000b', 'cf000000-0000-4000-8000-00000000000d', 'scheduled'),
 ('df000000-0000-4000-8000-000000000052', 'bf000000-0000-4000-8000-000000000002', 2026, 5, 'regular', 'cf000000-0000-4000-8000-00000000000c', 'cf000000-0000-4000-8000-00000000000e', 'scheduled'),
 ('df000000-0000-4000-8000-000000000053', 'bf000000-0000-4000-8000-000000000002', 2026, 5, 'regular', 'cf000000-0000-4000-8000-00000000000f', 'cf000000-0000-4000-8000-000000000011', 'scheduled'),
 ('df000000-0000-4000-8000-000000000054', 'bf000000-0000-4000-8000-000000000002', 2026, 5, 'regular', 'cf000000-0000-4000-8000-000000000010', 'cf000000-0000-4000-8000-000000000012', 'scheduled');
-- M32 SCORED (a live-scoring write, no flag). M12 OVERRIDDEN — 126's backstop
-- demands the GUC for a flag move (059 §F5's precedent): armed, written,
-- cleared, so no later cell inherits it.
update matchups set home_score = 12.5 where id = 'df000000-0000-4000-8000-000000000032';
select set_config('app.commish_action_id', '00000000-0000-4000-8000-0000000000e9', true);
update matchups set is_overridden = true where id = 'df000000-0000-4000-8000-000000000012';
select set_config('app.commish_action_id', '', true);
-- Week 1's per-team points (§K's premise): the rows scoring will NOT touch.
insert into team_week_results (league_id, team_id, season, week, points, is_final) values
 ('bf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 2026, 1, 10.50, false),
 ('bf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000002', 2026, 1, 20.25, false);

-- PREMISES.
select is((select status || '|' || (select status from matchups where id = 'df000000-0000-4000-8000-000000000011')
           from league_weeks where league_id = 'bf000000-0000-4000-8000-000000000001' and week = 1),
  'live|scheduled', 'B1 PREMISE: L1 week 1 is LIVE and M11 is a scheduled, unscored cell in it — E2''s contrast is about a state that exists');
select is((select free from public.schedule_window_internal(2026, 1, now())), false,
  'B2 PREMISE: week 1''s own kickoff (es-w1) is in the past — the kickoff lock is engaged for week 1 (R730''s datum, read the way both verbs read it)');
select is((select status || '|' || (select status from matchups where id = 'df000000-0000-4000-8000-000000000021')
           from league_weeks where league_id = 'bf000000-0000-4000-8000-000000000001' and week = 2),
  'upcoming|live', 'B3 PREMISE: L1 week 2 is UPCOMING (and ahead) while M21 is a LIVE, unscored cell — so E1 isolates 111:887 alone');
select is((select free from public.schedule_window_internal(2026, 2, now())), true,
  'B4 PREMISE: week 2''s own kickoff is 7 days ahead — neither 111:904 nor 111:913 fires on a week-2 row');
select is((select status from league_weeks where league_id = 'bf000000-0000-4000-8000-000000000001' and week = 3) || '|'
          || (select free from public.schedule_window_internal(2026, 3, now()))::text,
  'upcoming|false', 'B5 PREMISE (R730): L1 week 3''s status row says UPCOMING but its game kicked off 30 minutes ago — so E3 isolates 111:913 alone');
select is((select home_score::text || '|' || coalesce(result, 'null') || '|' || is_overridden::text from matchups where id = 'df000000-0000-4000-8000-000000000032'),
  '12.5|null|false', 'B6 PREMISE: M32 carries a SCORE (12.5), no result, no flag — §F''s scored cell');
select is((select is_overridden from matchups where id = 'df000000-0000-4000-8000-000000000012'), true,
  'B7 PREMISE: M12 is OVERRIDDEN — §F''s overridden cell (written under the GUC 126''s backstop demands, then cleared)');
select is(coalesce(current_setting('app.commish_action_id', true), ''), '',
  'B8 PREMISE: the GUC is CLEARED again, so no receipt below is mistaken for the fixture''s');
select is((select free from public.schedule_window_internal(2026, 4, now())), true,
  'B9 PREMISE: L2''s FIRST league week (4) has not kicked off — E41''s FREE window for 111''s verb (§D)');
select is((select count(*)::int from commissioner_actions where league_id in
           ('bf000000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000002')),
  0, 'B10 PREMISE: zero commissioner_actions rows across both leagues, so every receipt counted below is one this suite caused');
select is((select count(*)::int from league_chat where league_id in
           ('bf000000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000002')),
  0, 'B11 PREMISE: zero league_chat rows across both leagues');
select is((select count(*)::int from team_week_results where league_id = 'bf000000-0000-4000-8000-000000000001' and week = 1),
  2, 'B12 PREMISE: two week-1 team_week_results rows exist (T1 10.50, T2 20.25) — §K''s count is over rows that are really there');

-- ---------------------------------------------------------------------------
-- C. 111's RECEIPT — post-kickoff arm (L1 week 2: the league's Week 1 has
--    kicked off, so 111's own E41 gate already required a reason here).
--    ***BREAK PROBE 2's TARGET.***
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.es_c1',
  (select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000001',
     'df000000-0000-4000-8000-000000000022',
     'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000002',
     'home-field swap', '0f000000-0000-4000-8000-000000000001'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select home_team_id::text || '|' || away_team_id::text from matchups where id = 'df000000-0000-4000-8000-000000000022'),
  'cf000000-0000-4000-8000-000000000004|cf000000-0000-4000-8000-000000000002',
  'C1 111''s verb still edits: M22 is flipped (T4 home, T2 away)');
select is((select count(*)::int from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  1, 'C2 THE RECEIPT: EXACTLY ONE commissioner_actions row — the row 111:785-1152 never wrote (F339; §15.4:1700)');
select is((select action_type || '|' || target_type || '|' || target_id || '|' || reason from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'edit_schedule|schedule|df000000-0000-4000-8000-000000000022|home-field swap',
  'C3 …stamped edit_schedule / schedule / <matchup_id> with THE reason — tasks-M6A §5''s contractual row');
select is((select before::text || ' -> ' || after::text from commissioner_actions
           where league_id = 'bf000000-0000-4000-8000-000000000001'),
  '{"away_team_id": "cf000000-0000-4000-8000-000000000004", "home_team_id": "cf000000-0000-4000-8000-000000000002"} -> {"away_team_id": "cf000000-0000-4000-8000-000000000002", "home_team_id": "cf000000-0000-4000-8000-000000000004"}',
  'C4 …before/after = the pairing, read from the v_result 111 already built (111:1126-1146)');
select is((select metadata ->> 'verb' || '|' || (metadata ->> 'week') || '|' || (metadata ->> 'week_status') || '|' || (metadata -> 'bypassed')::text
           from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'schedule_edit_matchup|2|upcoming|[]', 'C5 …metadata names the verb, the week, the week status and an EMPTY bypassed[] — 111''s verb lifts nothing');
select is((select metadata -> 'affected_team_ids' from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  '["cf000000-0000-4000-8000-000000000002", "cf000000-0000-4000-8000-000000000004"]'::jsonb,
  'C6 …and affected_team_ids[] (D353) names both teams of the flipped pairing');
select is((select count(*)::int from schedule_actions where league_id = 'bf000000-0000-4000-8000-000000000001' and kind = 'edit_matchup'),
  1, 'C7 THE EXISTING LEDGER ROW IS STILL WRITTEN — schedule_actions is NOT folded into commissioner_actions (F326; 111:227-229)');
select is((select result ->> 'commissioner_action_id' from schedule_actions where action_id = '0f000000-0000-4000-8000-000000000001'),
  (select id::text from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'C8 …and the ledger''s stored document carries the receipt''s id (the hunk folds it into v_result before the INSERT)');
select is(current_setting('pgtap.es_c1')::jsonb ->> 'commissioner_action_id',
  (select id::text from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  'C9 …as does the returned document');
select is((select count(*)::int from league_chat where league_id = 'bf000000-0000-4000-8000-000000000001' and is_system),
  1, 'C10 THE EXISTING IN-TXN league_chat POST IS STILL WRITTEN (D97 / §10.3)');
select ok((select message like 'Week 2 matchup edited by es_user1: ES T4 vs ES T2 (was ES T2 vs ES T4) — after Week 1 kickoff (commissioner override) — reason: home-field swap'
           from league_chat where league_id = 'bf000000-0000-4000-8000-000000000001' and is_system),
  'C11 …with 111''s own text, byte for byte — the override tail because the league''s Week 1 has kicked off');
select is(current_setting('pgtap.es_c1')::jsonb ->> 'reason_required' || '|' || (current_setting('pgtap.es_c1')::jsonb -> 'window' ->> 'reason_required'),
  'false|false', 'C12 …reason_required is FALSE at the top level AND in E41''s window — FLIPPED BY MIGRATION 131 (L.E1.15 / F362, the sweep this cell was written to red on): 111''s post-kickoff gate (111:952-957) is gone, so the gate''s own report field says so; the field is kept for the panel (F361)');

-- ---------------------------------------------------------------------------
-- D. 111's RECEIPT — the FREE-WINDOW arm (L2), UNDER Q66 (Chris, 2026-09-16;
--    spec v2.16.41): a reason is OPTIONAL; the receipt is ALWAYS written.
--    ***BREAK PROBE (i)'s TARGET*** (re-add the refusal ⇒ D1/D2/D7 red).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select set_config('pgtap.es_d1',
       (select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000002',
          'df000000-0000-4000-8000-000000000041',
          'cf000000-0000-4000-8000-00000000000c', 'cf000000-0000-4000-8000-00000000000b',
          null, '0f000000-0000-4000-8000-000000000010'::uuid)::text), true) $$,
  'D1 A FREE-WINDOW EDIT WITH NO REASON LANDS (Q66: "we should not require a reason for anything") — the first cut refused this by name (R1046), and re-adding that refusal reds here');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000002'),
  1, 'D2 …and writes EXACTLY ONE receipt — the audit row is what Q66 REQUIRES ("what is required is storing the transaction")');
select is((select target_id || '|' || coalesce(reason, '<NULL>') from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000002'),
  'df000000-0000-4000-8000-000000000041|<NULL>', 'D3 …targeting M41 with reason IS NULL — stored as NULL, not as '''' (130 §0 made the column nullable)');
select is(current_setting('pgtap.es_d1')::jsonb ->> 'reason_required' || '|' || (current_setting('pgtap.es_d1')::jsonb -> 'window' ->> 'reason_required') || '|' || (current_setting('pgtap.es_d1')::jsonb -> 'window' ->> 'free'),
  'false|false|true', 'D4 …reason_required is FALSE at the top level and in E41''s window (free window — 111''s own NOT v_free, untouched by the hunk), free = true');
select ok((select message like 'Week 4 matchup edited by es_user1: ES T12 vs ES T11 (was ES T11 vs ES T12).'
           from league_chat where league_id = 'bf000000-0000-4000-8000-000000000002' and is_system),
  'D5 …and the post is 111''s free-window text, ending in "." with NO override tail and NO reason clause');
select is((select count(*)::int from schedule_actions where league_id = 'bf000000-0000-4000-8000-000000000002') || '|'
          || (select (result ->> 'commissioner_action_id' = (select id::text from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000002'))::text
              from schedule_actions where action_id = '0f000000-0000-4000-8000-000000000010'),
  '1|true', 'D6 …and the schedule_actions row is written too, carrying the receipt''s id');
-- WHITESPACE-ONLY ⇒ NULL, never ''; NON-EMPTY ⇒ TRIMMED.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000002',
       'df000000-0000-4000-8000-000000000042',
       'cf000000-0000-4000-8000-00000000000e', 'cf000000-0000-4000-8000-00000000000d',
       E' \t\r\n ', '0f000000-0000-4000-8000-000000000012'::uuid) $$,
  'D7 a reason of nothing but whitespace INCLUDING TABS AND NEWLINES is treated as NO reason and LANDS (Q66) — 111:951''s plain btrim would have passed the tabs through as text; the hunk''s explicit class does not');
select lives_ok(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000002',
       'df000000-0000-4000-8000-000000000043',
       'cf000000-0000-4000-8000-000000000010', 'cf000000-0000-4000-8000-00000000000f',
       E'\t seed correction \n', '0f000000-0000-4000-8000-000000000014'::uuid) $$,
  'D8 a non-empty reason wrapped in tabs and newlines lands…');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select string_agg(target_id || '=' || coalesce(reason, '<NULL>'), ' ' order by target_id) from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000002'),
  'df000000-0000-4000-8000-000000000041=<NULL> df000000-0000-4000-8000-000000000042=<NULL> df000000-0000-4000-8000-000000000043=seed correction',
  'D9 …THE THREE RECEIPTS: no reason ⇒ NULL, whitespace-only ⇒ NULL (not '''' — the table CHECK still refuses ''''), tab-wrapped ⇒ stored TRIMMED as "seed correction"');
-- THE NO-OP STAYS A REFUSAL (D348); the 500 bound stays; neither writes.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000002',
       'df000000-0000-4000-8000-000000000041',
       'cf000000-0000-4000-8000-00000000000c', 'cf000000-0000-4000-8000-00000000000b',
       'again', '0f000000-0000-4000-8000-000000000011'::uuid) $$,
  '%nothing to change%', 'D10a a NO-OP edit on 111''s verb is STILL A REFUSAL by name (D348: user-visible behaviour, unchanged; it fires before the hunk)');
select throws_ok(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000002',
       'df000000-0000-4000-8000-000000000044',
       'cf000000-0000-4000-8000-000000000012', 'cf000000-0000-4000-8000-000000000011',
       repeat('x', 501), '0f000000-0000-4000-8000-000000000013'::uuid) $$,
  '22023', null, 'D10b a 501-character reason is refused (the league_chat bound, F225''s R746 half — the bound survives Q66; only the presence gate went)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000002') || '|'
          || (select count(*)::int from league_chat where league_id = 'bf000000-0000-4000-8000-000000000002') || '|'
          || (select count(*)::int from schedule_actions where league_id = 'bf000000-0000-4000-8000-000000000002') || '|'
          || (select home_team_id::text from matchups where id = 'df000000-0000-4000-8000-000000000044'),
  '3|3|3|cf000000-0000-4000-8000-000000000011', 'D11 …and the two refusals wrote NONE of the three rows (still exactly three each) and M44 is untouched');

-- ---------------------------------------------------------------------------
-- E. THE PAIRED CONTRASTS — one per lifted refusal, ADJACENT, SAME state.
-- ---------------------------------------------------------------------------
select set_config('pgtap.es_ca', (select count(*)::text from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- E1 — 111:887, matchup status. M21 (T1,T3) is LIVE in an upcoming, unkicked week.
select throws_like(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000021',
       'cf000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000001',
       'flip the live cell', '0f000000-0000-4000-8000-000000000020'::uuid) $$,
  '%(week 2) is live — only scheduled matchups may change; live/final never regenerate (§11.7/E41)%',
  'E1a 111:887 — schedule_edit_matchup REFUSES a live matchup BY NAME (its own string, verbatim)');
select set_config('pgtap.es_e1',
  (select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
     'df000000-0000-4000-8000-000000000021',
     'cf000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000001',
     'flip the live cell', '0f000000-0000-4000-8000-000000000020'::uuid)::text), true);
select is(current_setting('pgtap.es_e1')::jsonb -> 'bypassed', '["matchup_status_gate:live"]'::jsonb,
  'E1b …and at the SAME state the sibling LANDS it, naming exactly the one gate it walked past: matchup_status_gate:live');
select is((select home_team_id::text || '|' || away_team_id::text || '|' || status from matchups where id = 'df000000-0000-4000-8000-000000000021'),
  'cf000000-0000-4000-8000-000000000003|cf000000-0000-4000-8000-000000000001|live',
  'E1c …M21 is flipped and its status is untouched (the verb re-pairs; it never moves status)');
-- E2 — 111:904, week status. M11 (T1,T2) is scheduled in LIVE week 1 (kicked off).
select throws_like(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000011',
       'cf000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000001',
       'flip week 1', '0f000000-0000-4000-8000-000000000021'::uuid) $$,
  '%week 1 of league % is live — only an upcoming week''s matchups may change (§11.7/§12.17)%',
  'E2a 111:904 — schedule_edit_matchup REFUSES a live week BY NAME');
select set_config('pgtap.es_e2',
  (select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
     'df000000-0000-4000-8000-000000000011',
     'cf000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000001',
     'flip week 1', '0f000000-0000-4000-8000-000000000021'::uuid)::text), true);
select is(current_setting('pgtap.es_e2')::jsonb -> 'bypassed', '["week_status_gate:live", "kickoff_lock"]'::jsonb,
  'E2b …the sibling lands it naming BOTH gates a live week carries — week_status_gate:live AND kickoff_lock (standing rule (g): a live week has kicked off by definition, so lifting 111:904 without 111:913 lands nothing)');
select ok(current_setting('pgtap.es_e2')::jsonb -> 'bypassed_why' ->> 'kickoff_lock' like 'week 1 kicked off at %(nfl_games); schedule_edit_matchup refuses it by name (111:913-918%standing rule (g), D335)',
  'E2c …and bypassed_why names the kickoff instant, the datum arm, 111''s line and the rule (§4 rule 15)');
select is((select home_team_id::text from matchups where id = 'df000000-0000-4000-8000-000000000011'),
  'cf000000-0000-4000-8000-000000000002', 'E2d …M11 is flipped');
-- E3 — 111:913 (R730), the week's OWN kickoff with the status row still upcoming.
select throws_like(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000001',
       'flip week 3', '0f000000-0000-4000-8000-000000000022'::uuid) $$,
  '%week 3 of league % kicked off at %(nfl_games) — only future weeks may change (§11.7/E41/E42)%',
  'E3a 111:913 — schedule_edit_matchup REFUSES a kicked-off week BY NAME even though its status row says upcoming (R730: the datum decides)');
select set_config('pgtap.es_e3',
  (select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
     'df000000-0000-4000-8000-000000000031',
     'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000001',
     'flip week 3', '0f000000-0000-4000-8000-000000000022'::uuid)::text), true);
select is(current_setting('pgtap.es_e3')::jsonb -> 'bypassed', '["kickoff_lock"]'::jsonb,
  'E3b …the sibling lands it naming kickoff_lock ALONE — the game-day lock is the ONE thing between this edit and 111, and it does not bind the commissioner (standing rule (g), D335)');
select is((select home_team_id::text from matchups where id = 'df000000-0000-4000-8000-000000000031'),
  'cf000000-0000-4000-8000-000000000004', 'E3c …M31 is flipped');
-- E4 — 111:993, a SIBLING row's status. M22 is now (T4,T2); pull T1 out of
-- LIVE M21 (T3,T1) into M22: M22 → (T4,T1), M21 → (T3,T2).
select throws_like(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000022',
       'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000001',
       'pull T1 from the live cell', '0f000000-0000-4000-8000-000000000023'::uuid) $$,
  '%(week 2, %''s current game) is live — the edit would have to re-seat a team into it; only scheduled matchups may change (§11.7/E41)%',
  'E4a 111:993 — schedule_edit_matchup REFUSES to re-seat a team into a live SIBLING BY NAME (the target itself is scheduled)');
select set_config('pgtap.es_e4',
  (select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
     'df000000-0000-4000-8000-000000000022',
     'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000001',
     'pull T1 from the live cell', '0f000000-0000-4000-8000-000000000023'::uuid)::text), true);
select is(current_setting('pgtap.es_e4')::jsonb -> 'bypassed', '["sibling_status_gate:df000000-0000-4000-8000-000000000021:live"]'::jsonb,
  'E4b …the sibling lands it naming the SIBLING gate with the sibling''s id and status');
select is((select string_agg(id::text || '=' || home_team_id::text || ',' || away_team_id::text, ' ' order by id) from matchups
           where id in ('df000000-0000-4000-8000-000000000021', 'df000000-0000-4000-8000-000000000022')),
  'df000000-0000-4000-8000-000000000021=cf000000-0000-4000-8000-000000000003,cf000000-0000-4000-8000-000000000002 df000000-0000-4000-8000-000000000022=cf000000-0000-4000-8000-000000000004,cf000000-0000-4000-8000-000000000001',
  'E4c …M22 = (T4,T1) and the live sibling M21 = (T3,T2) with the displaced T2 seated where T1 left — 111''s permutation (the re-validation counted all 8 teams once, or this call would have refused)');
select is(current_setting('pgtap.es_e4')::jsonb -> 'affected_team_ids',
  '["cf000000-0000-4000-8000-000000000001", "cf000000-0000-4000-8000-000000000002", "cf000000-0000-4000-8000-000000000003", "cf000000-0000-4000-8000-000000000004"]'::jsonb,
  'E4d …and affected_team_ids[] (D353) names all four teams the permutation touched');
select is((select count(*)::int from matchups where league_id = 'bf000000-0000-4000-8000-000000000001' and round_type = 'third_place'), 0,
  'E4e …and no row is left on the parking game type');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  current_setting('pgtap.es_ca')::int + 4,
  'E5 the four landings wrote EXACTLY FOUR receipts (D336 part 2 — one per change)');
select is((select string_agg(action_type || '|' || target_type || '|' || (metadata ->> 'verb'), ',' order by created_at, id)
           from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001' and metadata ->> 'verb' = 'commish_edit_schedule'),
  'edit_schedule|schedule|commish_edit_schedule,edit_schedule|schedule|commish_edit_schedule,edit_schedule|schedule|commish_edit_schedule,edit_schedule|schedule|commish_edit_schedule',
  'E6 …each stamped edit_schedule / schedule (§5''s row) and naming the sibling as the verb');
select is((select metadata -> 'bypassed' from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'
           and metadata ->> 'action_id' = '0f000000-0000-4000-8000-000000000022'),
  '["kickoff_lock"]'::jsonb, 'E7 …and the receipt carries bypassed[] too — the audit row says what was lifted, not only the response');
select is((select count(*)::int from league_chat where league_id = 'bf000000-0000-4000-8000-000000000001' and is_system
           and message like '% (commissioner override): %'),
  4, 'E8 four in-txn system posts carrying the override marker (§10.3)');
select ok((select message like 'Week 3 matchup edited by es_user1 (commissioner override): ES T4 vs ES T1 (was ES T1 vs ES T4) — lifted: kickoff_lock — reason: flip week 3'
           from league_chat where league_id = 'bf000000-0000-4000-8000-000000000001' and is_system and message like 'Week 3 %'),
  'E9 …naming before/after, the lifted gate and the reason (R971''s shape: the consequence is in the post)');

-- ---------------------------------------------------------------------------
-- F. THE KEPT GATES — adjacent pairs, both verbs refuse BY NAME.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000032',
       'cf000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000002',
       'x', '0f000000-0000-4000-8000-000000000030'::uuid) $$,
  '%carries a result or score (overridden: f) — a scored or overridden cell is never rewritten (§22.2/rule 9)%',
  'F1a a SCORED cell (M32, 12.5): 111 refuses by name…');
select throws_like(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000032',
       'cf000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000002',
       'x', '0f000000-0000-4000-8000-000000000030'::uuid) $$,
  '%carries a result or score (overridden: f)%LEGALITY boundary, not a timing one%commish_edit_score / commish_set_result (migration 126)%',
  'F1b …and so does the sibling, naming it a LEGALITY boundary (§22.2) and the verb that owns it — the never-weaken line the task draws');
select throws_like(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000012',
       'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000003',
       'x', '0f000000-0000-4000-8000-000000000031'::uuid) $$,
  '%carries a result or score (overridden: t)%',
  'F2a an OVERRIDDEN cell (M12): 111 refuses by name… (111:904 would also have fired — the cell gate is checked first, 111:894)');
select throws_like(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000012',
       'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000003',
       'x', '0f000000-0000-4000-8000-000000000031'::uuid) $$,
  '%carries a result or score (overridden: t)%',
  'F2b …and so does the sibling: the flag is a legality boundary too');
select throws_like(
  $$ select public.schedule_edit_matchup('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000023',
       'cf000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000001',
       'x', '0f000000-0000-4000-8000-000000000032'::uuid) $$,
  '%is a playoff row — only regular-season pairings (regular / secondary) are edited here; brackets are the playoffs engine''s (§11.5)%',
  'F3a a BRACKET row (M23, playoff): 111 refuses by name…');
select throws_like(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000023',
       'cf000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000001',
       'x', '0f000000-0000-4000-8000-000000000032'::uuid) $$,
  '%is a playoff row%Playoff matchups are set automatically today%re-seeds them at each sync (§11.5, 118:1573-1594)%every-team-once re-validation (§11.7) cannot hold over a bracket subset%Hand-picking playoff matchups is a planned commissioner feature with its own verb (PROGRESS F360, ruled 2026-09-16)%',
  'F3b …and so does the sibling, BY NAME, saying that playoff matchups are set automatically TODAY and that hand-picking them is a PLANNED commissioner feature (F360, ruled 2026-09-16 — R1047), with the two mechanisms the bracket verb must respect (the kept re-validation, 118:1573-1594''s re-seed) — never a permanent legality wall. ***BREAK PROBE (iii)*** : the first cut''s wording ("No verb hand-edits a bracket today", cite 118:1075-1077) reds this pattern');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from commish_schedule_actions where action_id in
           ('0f000000-0000-4000-8000-000000000030', '0f000000-0000-4000-8000-000000000031', '0f000000-0000-4000-8000-000000000032')),
  0, 'F4 …and a refusal consumes NO ledger row: the statement rolled back whole');

-- ---------------------------------------------------------------------------
-- G. THE SIBLING's NO-OP — Chris''s one condition (standing rule (b)).
-- ---------------------------------------------------------------------------
select set_config('pgtap.es_ga', (select count(*)::text from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'), true);
select set_config('pgtap.es_gc', (select count(*)::text from league_chat where league_id = 'bf000000-0000-4000-8000-000000000001'), true);
select ok(current_setting('pgtap.es_ga')::int > 0 and current_setting('pgtap.es_gc')::int > 0,
  'G0 PREMISE: both tables are NON-EMPTY before the no-op, so "UNCHANGED" is a real comparison');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.es_g1',
  (select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
     'df000000-0000-4000-8000-000000000031',
     'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000001',
     'the pairing it already has', '0f000000-0000-4000-8000-000000000040'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(current_setting('pgtap.es_g1')::jsonb ->> 'no_changes', 'true',
  'G1 re-sending M31''s pairing: no_changes = true, RETURNED not raised (D336 part 3 — the 123 contract governs the NEW verb; 111''s refusal stays 111''s)');
select is((select count(*)::int from commissioner_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  current_setting('pgtap.es_ga')::int, 'G2 NO RECEIPT: the commissioner_actions count is UNCHANGED');
select is((select count(*)::int from league_chat where league_id = 'bf000000-0000-4000-8000-000000000001'),
  current_setting('pgtap.es_gc')::int, 'G3 …the league_chat count is UNCHANGED');
select is((select count(*)::int from commish_schedule_actions where action_id = '0f000000-0000-4000-8000-000000000040'),
  1, 'G4 …but the replay-ledger row IS written: an action_id is consumed by its submit whether or not anything moved (§12.26)');
select is(current_setting('pgtap.es_g1')::jsonb ->> 'commissioner_action_id', null,
  'G5 …commissioner_action_id is NULL on the no-op, and that is the point');
select ok(current_setting('pgtap.es_g1')::jsonb ->> 'no_changes_why' like 'pairing_already_as_asked%nothing was written and no receipt was issued%',
  'G6 …and the reason is NAMED, so "nothing happened" can never be read as "it worked"');
select is(current_setting('pgtap.es_g1')::jsonb -> 'bypassed', '["kickoff_lock"]'::jsonb,
  'G7 …while bypassed[] still names the gate the evaluation walked past — honesty about the state, not a claim of a change');
select is(current_setting('pgtap.es_g1')::jsonb ->> 'rows_changed' || '|' || coalesce(current_setting('pgtap.es_g1')::jsonb ->> 'system_post', 'null'),
  '0|null', 'G8 …rows_changed 0 and no system_post');

-- ---------------------------------------------------------------------------
-- H. THE SIBLING''s REASON HANDLING (OPTIONAL — Q66) AND SHAPE GATES.
--    ***BREAK PROBE (iv)''s TARGET*** (re-add the sibling''s refusal ⇒ H1-H3).
--    M31 is (T4,T1) after E3; H1 flips it to (T1,T4), H2 flips it back, so
--    the later cells that read "M31 still T4 home" stay true.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select set_config('pgtap.es_h1',
       (select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
          'df000000-0000-4000-8000-000000000031',
          'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
          '   ', '0f000000-0000-4000-8000-000000000050'::uuid)::text), true) $$,
  'H1 a BLANK reason LANDS (Q66: optional everywhere) — this week is upcoming-but-kicked-off, so E41 alone would once have demanded one; the first cut refused this (22023) and re-adding that refusal reds here');
select is((select coalesce(reason, '<NULL>') from commissioner_actions where metadata ->> 'action_id' = '0f000000-0000-4000-8000-000000000050'),
  '<NULL>', 'H1b …its receipt IS written, with reason NULL — not ''''');
select ok((select message not like '% — reason: %' and message like 'Week 3 matchup edited by es_user1 (commissioner override): ES T1 vs ES T4 (was ES T4 vs ES T1) — lifted: kickoff_lock'
           from league_chat where league_id = 'bf000000-0000-4000-8000-000000000001' and is_system
             and message like 'Week 3 matchup edited by es_user1 (commissioner override): ES T1 vs ES T4%'),
  'H1c …and its post carries the override marker and the lifted gate but NO "— reason:" clause (the clause is conditional, never "reason: <NULL>")');
select lives_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000004', 'cf000000-0000-4000-8000-000000000001',
       E' \t\r\n ', '0f000000-0000-4000-8000-000000000051'::uuid) $$,
  'H2 a reason of nothing but whitespace INCLUDING TABS AND NEWLINES is treated as no reason and LANDS (the explicit class, R745 — still the class that decides "blank")');
select is((select coalesce(reason, '<NULL>') from commissioner_actions where metadata ->> 'action_id' = '0f000000-0000-4000-8000-000000000051'),
  '<NULL>', 'H2b …stored as NULL, never as the tabs themselves');
select lives_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000002',
       'df000000-0000-4000-8000-000000000051',
       'cf000000-0000-4000-8000-00000000000d', 'cf000000-0000-4000-8000-00000000000b',
       null, '0f000000-0000-4000-8000-000000000052'::uuid) $$,
  'H3 a NULL reason in the FREE window (L2, Week 1 ahead) lands too — no window requires one');
select is((select coalesce(reason, '<NULL>') || '|' || (current_setting('pgtap.es_h1')::jsonb ->> 'reason_required') || '|' || (current_setting('pgtap.es_h1')::jsonb -> 'window' ->> 'reason_required')
           from commissioner_actions where metadata ->> 'action_id' = '0f000000-0000-4000-8000-000000000052'),
  '<NULL>|false|false', 'H3b …with a NULL-reason receipt; and the sibling''s document says reason_required = false at both levels (nothing requires one — the field stays for the panel, F361)');
select throws_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
       repeat('x', 501), '0f000000-0000-4000-8000-000000000053'::uuid) $$,
  '22023', null, 'H4 a 501-character reason is refused (the league_chat bound)');
select throws_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
       'no key', null) $$,
  '22023', null, 'H5 a missing action_id is refused: the idempotency key is not optional');
select throws_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001',
       'self', '0f000000-0000-4000-8000-000000000054'::uuid) $$,
  '22023', null, 'H6 a team cannot play itself');
select throws_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-0000000000aa',
       'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
       'x', '0f000000-0000-4000-8000-000000000055'::uuid) $$,
  'P0002', null, 'H7 a matchup that is not this league''s is P0002 (the family mapper''s 404)');
select throws_like(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-00000000000b', 'cf000000-0000-4000-8000-000000000004',
       'x', '0f000000-0000-4000-8000-000000000056'::uuid) $$,
  '%is not a seated franchise of league%', 'H8 a FOREIGN team (L2''s T11) is refused by name (F222(a) — kept)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select home_team_id::text from matchups where id = 'df000000-0000-4000-8000-000000000031'),
  'cf000000-0000-4000-8000-000000000004', 'H9 …and none of the five refusals (H4-H8) wrote anything (M31 is T4 home again after H1/H2''s round trip)');

-- ---------------------------------------------------------------------------
-- I. AUTH — one no-leak 42501 (071 §F).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
       'not mine', '0f000000-0000-4000-8000-000000000060'::uuid) $$,
  '42501', 'commish_edit_schedule: not a commissioner of this league',
  'I1 a seated MANAGER is refused with the one no-leak 42501');
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
       'x', '0f000000-0000-4000-8000-000000000061'::uuid) $$,
  '42501', 'commish_edit_schedule: not a commissioner of this league', 'I2 an OUTSIDER is refused the same way');
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_schedule('00000000-0000-4000-8000-0000000000aa',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
       'x', '0f000000-0000-4000-8000-000000000062'::uuid) $$,
  '42501', 'commish_edit_schedule: not a commissioner of this league',
  'I3 NO LEAK: a league that does not exist gets the IDENTICAL message (D336 part 5)');
select set_config('request.jwt.claims', '', true);
reset role;
set local role anon;
select throws_ok(
  $$ select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
       'df000000-0000-4000-8000-000000000031',
       'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
       'x', '0f000000-0000-4000-8000-000000000063'::uuid) $$,
  '42501', null, 'I4 anon cannot reach the door at all (the REVOKE, not the body)');
reset role;
select is((select home_team_id::text from matchups where id = 'df000000-0000-4000-8000-000000000031'),
  'cf000000-0000-4000-8000-000000000004', 'I5 …and none of the four refusals wrote anything');

-- ---------------------------------------------------------------------------
-- J. REPLAY — byte-identical, nothing re-written.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select public.commish_edit_schedule('bf000000-0000-4000-8000-000000000001',
     'df000000-0000-4000-8000-000000000031',
     'cf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004',
     'a completely different request', '0f000000-0000-4000-8000-000000000022'::uuid)::text),
  current_setting('pgtap.es_e3'),
  'J1 REPLAY (E2/D68): E3''s action_id returns E3''s document BYTE-identically — with a different pairing and reason. The lookup sits AFTER auth but BEFORE every business gate');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select home_team_id::text from matchups where id = 'df000000-0000-4000-8000-000000000031'),
  'cf000000-0000-4000-8000-000000000004', 'J2 …and NOTHING was written on the replay: the returned document is a record, not an instruction');
select is((select count(*)::int from commish_schedule_actions where league_id = 'bf000000-0000-4000-8000-000000000001'),
  7, 'J3 …the ledger holds exactly the seven submits (E1-E4 + G''s no-op + H1/H2); the replay added none');

-- ---------------------------------------------------------------------------
-- K. WHAT SCORING DID NOT DO on the LIVE week (E2), with its premise (B12).
-- ---------------------------------------------------------------------------
select is(current_setting('pgtap.es_e2')::jsonb -> 'scoring' ->> 'week_status' || '|'
          || (current_setting('pgtap.es_e2')::jsonb -> 'scoring' ->> 'stored_cells_rewritten') || '|'
          || (current_setting('pgtap.es_e2')::jsonb -> 'scoring' ->> 'team_week_results_rows'),
  'live|0|2', 'K1 the live-week edit''s document says: week live, ZERO stored cells rewritten, and COUNTS the 2 team_week_results rows the affected teams already carry (B12''s premise — a count over rows that exist)');
select ok(current_setting('pgtap.es_e2')::jsonb -> 'scoring' ->> 'why' like 'every re-paired cell carried no score and no result (the §22.2 gate this verb KEEPS%the week is live — the next score drain / finalize scores the NEW pairing; the 2 team_week_results row(s)%are per-team points, not pairings, and are untouched',
  'K2 …and WHY: the kept §22.2 gate is the premise of "nothing is stale", and the downstream that will read the new pairing is named (§4 rule 15)');
select is((select string_agg(points::text, ',' order by team_id) from team_week_results where league_id = 'bf000000-0000-4000-8000-000000000001' and week = 1),
  '10.50,20.25', 'K3 …and the two rows are byte-unchanged');
select is((select string_agg(coalesce(result, 'null') || ':' || is_overridden::text, ',' order by id) from matchups
           where league_id = 'bf000000-0000-4000-8000-000000000001' and id in ('df000000-0000-4000-8000-000000000011', 'df000000-0000-4000-8000-000000000021', 'df000000-0000-4000-8000-000000000022', 'df000000-0000-4000-8000-000000000031')),
  'null:false,null:false,null:false,null:false', 'K4 …and no landed edit wrote a result or moved is_overridden (126''s backstop was never engaged — this verb re-pairs, it never overrides a cell)');
select is(current_setting('pgtap.es_e3')::jsonb -> 'scoring' ->> 'why',
  'every re-paired cell carried no score and no result (the §22.2 gate this verb KEEPS — step 9 / 15a), so no stored score is stale; the week''s status row is still upcoming although it kicked off (kickoff_lock lifted) — it opens at the next league_week_advance and every score read from then on is of the NEW pairing; the 0 team_week_results row(s) for the affected teams this week are per-team points, not pairings, and are untouched',
  'K5 the upcoming-but-kicked-off week (E3) is described with its OWN arm, as a stored literal — not "has not opened" (the status row) and not "live" (the datum): both facts, because R730 says they can disagree');
select is(current_setting('pgtap.es_e1')::jsonb -> 'scoring' ->> 'why',
  'every re-paired cell carried no score and no result (the §22.2 gate this verb KEEPS — step 9 / 15a), so no stored score is stale; the week has not opened and has not kicked off — nothing downstream has read the pairing',
  'K6 …and the genuinely-ahead week (E1: upcoming AND free) says so, as a stored literal');

-- ---------------------------------------------------------------------------
-- L. NEVER-WEAKEN PINS (§4 rule 13; 071:835-867''s form). These are what make
--    "derived, not rewritten" falsifiable — and F341''s wall.
--    ***BREAK PROBE 1''s TARGET.***
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosrc like '%is a % row — only regular-season pairings (regular / secondary) are edited here; brackets are the playoffs engine''''s (§11.5)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'),
  'L1 NEVER-WEAKEN: schedule_edit_matchup still carries 111:881''s refusal verbatim');
select ok(
  (select p.prosrc like '%is % — only scheduled matchups may change; live/final never regenerate (§11.7/E41)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'),
  'L2 NEVER-WEAKEN: …and 111:887''s');
select ok(
  (select p.prosrc like '%carries a result or score (overridden: %) — a scored or overridden cell is never rewritten (§22.2/rule 9)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'),
  'L3 NEVER-WEAKEN: …and 111:894''s');
select ok(
  (select p.prosrc like '%is % — only an upcoming week''''s matchups may change (§11.7/§12.17)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'),
  'L4 NEVER-WEAKEN: …and 111:904''s — all four refusal strings are still in prosrc');
select is(
  (select count(*)::int from regexp_matches(
     (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'), 'is_league_commish', 'g')),
  1, 'L5 schedule_edit_matchup names is_league_commish EXACTLY ONCE — at the auth gate (111:848), never inside a state gate (a commissioner arm added to a gate reds here)');
select is(
  (select count(*)::int from regexp_matches(
     (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'), 'log_commissioner_action_internal', 'g')),
  1, 'L6 schedule_edit_matchup calls the logging helper EXACTLY ONCE — the one hunk, and no second receipt');
select is(
  (select count(*)::int from regexp_matches(
     (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'schedule_remix_confirm'), 'log_commissioner_action_internal', 'g')),
  1, 'L7 schedule_remix_confirm calls it EXACTLY ONCE — RE-DERIVED BY MIGRATION 131 (L.E1.15 / F362): F341''s park at 111:738-740 is discharged, the Remix verb writes its own receipt through the ONE helper (130 kept it at zero; 131 is the migration that landed the hunk there, deliberately)');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_remix_confirm'),
  '37f7a113fb12437b7019ca9eb242bc92',
  'L8 F341''s WALL, MOVED ON PURPOSE: schedule_remix_confirm''s prosrc md5 equals its post-131 literal (MEASURED on the fresh 001-131 chain, not copied — the pre-130 literal was d6fdf4664703904554356009a30a1fc2, and 131 is the only migration since that touches this body: four hunks, listed in 131''s section 7 header)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('schedule_edit_matchup', 'schedule_remix_confirm')),
  2, 'L9 schedule_edit_matchup / schedule_remix_confirm are still ONE overload each — 130 replaced one body in place and re-authored nothing');
select ok(
  (select p.prosrc like '%''schedule_edit_matchup: matchup % already pairs % (home) vs % (away) — nothing to change''%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_edit_matchup'),
  'L10 …and 111:938-943''s no-op REFUSAL is still there (D348: the 123 contract governs NEW verbs only)');
select is(
  (select count(*)::int from regexp_matches(
     (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'commish_edit_schedule_internal'), 'is_league_commish', 'g')),
  1, 'L11 the sibling names is_league_commish exactly once too — its lifts are the ABSENCE of gates, never an arm inside one');

-- ---------------------------------------------------------------------------
-- M. Q66''s SCHEMA CHANGE (130 §0) — pinned LAST, because the direct INSERTs
--    below add rows the count cells above must not see (and the append-only
--    trigger, 123:375, forbids deleting them again).
-- ---------------------------------------------------------------------------
select col_is_null('public', 'commissioner_actions', 'reason',
  'M1 commissioner_actions.reason is NULLABLE (130 §0 dropped 123:295''s NOT NULL — the first writer under Q66 lands the column change once, for F362''s sweep to build on)');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.commissioner_actions'::regclass and c.conname = 'commissioner_actions_reason_check'),
  E'CHECK (((reason IS NULL) OR ((length(btrim(reason, \' \t\r\n\'::text)) > 0) AND (length(reason) <= 500))))',
  'M2 …and its CHECK, as a stored literal, is `reason IS NULL OR <123''s explicit class AND the 500 bound>` — the class and the bound SURVIVE Q66 for a non-NULL reason');
select lives_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, target_type, target_id, reason)
     values ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'edit_schedule', 'schedule', 'm3', null) $$,
  'M3 a NULL reason INSERTS at the table (the column change is real, not only the verbs'' normalisation)');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, target_type, target_id, reason)
     values ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'edit_schedule', 'schedule', 'm4', '') $$,
  '23514', null, 'M4 …while '''' is STILL refused by the CHECK — "no reason" is NULL, never the empty string');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, target_type, target_id, reason)
     values ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'edit_schedule', 'schedule', 'm5', E'\t\n') $$,
  '23514', null, 'M5 …and a tab/newline-only string is still refused (the explicit class, R745)');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, target_type, target_id, reason)
     values ('bf000000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-000000000001', 'edit_schedule', 'schedule', 'm6', repeat('x', 501)) $$,
  '23514', null, 'M6 …and 501 characters are still refused (the 500 bound, F40/R746)');

select * from finish();
rollback;
