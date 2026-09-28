-- ============================================================================
-- pgTAP 092 — migration 144: F397 + Q69 AS RULED — every league week stores
-- the scoring rules it is played with, and a scoring change never re-scores a
-- week in its stat-correction window (M6A task L.E1.27; tasks-M6A §6's
-- L.E1.27 amendment note, PROOF + BREAK PROBES; §4 rules 11-15; PROGRESS
-- F397, F404, Q69, Q64, D382; spec §7.3.3 / §10.1 / §15.4 v2.16.53).
--
-- THE RULINGS (Chris, 2026-09-27): F397 "F397 yes build it" — each league
-- week stores its rules and the scorers read THEM; Q69 "Q69 keep last week's
-- scores" — a week in its correction window keeps its scores like a final
-- one; the live week is re-scored ("this week and later", Q64).
--
--   §A  form: the four columns, the four CHECKs, the two FKs, the four
--       triggers (BEFORE ROW, ENABLE ALWAYS, the valid pair on 104's wall-2
--       function), the helper functions PLAIN + search_path + REVOKEd, the
--       replaced body as a STORED-LITERAL md5, the words helper by value.
--   §B  NO client write, per role, with RETURNING counts (anon, a member,
--       the commissioner); no TRUNCATE; a member can READ the week's rules.
--   §C  THE WEEK-OPEN WRITE: league_week_advance at the boundary instant
--       (03:59:59 nothing; 04:00:00 the week opens with the league's rules —
--       a stored-literal md5 of ESPN Standard's document).
--   §D  THE GUARD: an upcoming week holds none; a final / correction-window
--       week's rules never change; a live week's never clear; 104's wall-2
--       validator refuses a broken document on the new column.
--   §E  THE Q69 ARM: week 1 FINAL, week 2 CORRECTION_WINDOW, week 3 LIVE,
--       week 4 upcoming, premise BY VALUE. rescore = true ⇒ week 3 queued and
--       its stored rules = the new ones (with the receipt); weeks 1 and 2
--       BYTE-IDENTICAL (league_weeks, matchups, team_week_results) and named
--       as kept with their status; week 4 opens under the new rules.
--       rescore = false ⇒ NO opened week's rules change.
--   §F  THE BACKFILL over a pre-144-shaped fixture: each week's rules as
--       literals (via md5 + system id), the mixed week named AMBIGUOUS, an
--       unreadable one UNRECOVERABLE, a planted receipt ignored, dry run
--       writes nothing, a re-run finds nothing.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(46);

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'league_weeks'
     and column_name in ('scoring_rules_snapshot', 'scoring_system_id', 'scoring_rules_source', 'scoring_rules_action_id')),
  'scoring_rules_action_id:uuid:YES,scoring_rules_snapshot:jsonb:YES,scoring_rules_source:text:YES,scoring_system_id:uuid:YES',
  'A1 league_weeks gains the week rules (jsonb) and their provenance (system, source, receipt), all nullable (an upcoming week holds none)');
select is(
  (select string_agg(conname, ',' order by conname) from pg_constraint
   where conrelid = 'public.league_weeks'::regclass and contype = 'c'),
  'league_weeks_rescore_names_its_receipt,league_weeks_rules_source_check,league_weeks_rules_source_matches_rules,league_weeks_status_check,league_weeks_upcoming_holds_no_rules',
  'A2 the four new CHECKs beside 056 status check: the source vocabulary, source iff rules, an upcoming week holds no rules, a rescore names its receipt');
select is(
  (select string_agg(a.attname || '->' || f.relname, ',' order by a.attname)
   from pg_constraint c join pg_class f on f.oid = c.confrelid
   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.conrelid = 'public.league_weeks'::regclass and c.contype = 'f'
     and a.attname in ('scoring_system_id', 'scoring_rules_action_id')),
  'scoring_rules_action_id->commissioner_actions,scoring_system_id->scoring_systems',
  'A3 provenance FKs: the system the rules came from and the receipt of the change that set them');
select is(
  (select string_agg(t.tgname || ':' || p.proname || ':' || t.tgenabled::text || ':' || ((t.tgtype & 2) = 2)::text || ':' || ((t.tgtype & 1) = 1)::text, ',' order by t.tgname)
   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.league_weeks'::regclass and not t.tgisinternal and t.tgname like 'trg_league_weeks_rules%'),
  'trg_league_weeks_rules_1_open:league_weeks_rules_on_open:A:true:true,'
  'trg_league_weeks_rules_2_guard:league_weeks_rules_guard:A:true:true,'
  'trg_league_weeks_rules_3_valid_ins:leagues_scoring_rules_valid:A:true:true,'
  'trg_league_weeks_rules_3_valid_upd:leagues_scoring_rules_valid:A:true:true',
  'A4 four BEFORE ROW triggers, ENABLE ALWAYS (R616), the validation pair running 104 WALL-2 function itself (extended, not copied), named to fire open -> guard -> validate -> 110 transition');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          and count(*) = 4
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('league_weeks_rules_on_open', 'league_weeks_rules_guard', 'league_week_list_words_internal', 'league_weeks_rules_backfill_internal')),
  'A5 the four new functions are PLAIN, search_path empty, and REVOKEd from anon and authenticated');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting_internal'),
  'fe71e96772a9584f62d6728067d0b0ff',
  'A6 commish_change_setting_internal is 144 body, a STORED LITERAL md5 (141 text 05d2c7e4ae83506c113f7168d262a8b3, nine hunks apart — D137)');
select is(
  coalesce(public.league_week_list_words_internal('[]'), 'null') || '|' || public.league_week_list_words_internal('[3]')
  || '|' || public.league_week_list_words_internal('[1, 2]') || '|' || public.league_week_list_words_internal('[1, 2, 3]'),
  'null|week 3|weeks 1 and 2|weeks 1, 2 and 3',
  'A7 the words helper: nothing, one week, two weeks, three weeks');

-- ---------------------------------------------------------------------------
-- FIXTURES (postgres context, JWT cleared).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9f200000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-pw' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'pw_user' || i)::jsonb, now(), now()
from generate_series(1, 3) i;

-- LA week-open / no-write / guard; LB the Q69 rescore; LC rescore off — all
-- in_season on ESPN Standard. LD / LE / LF the backfill (below).
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings,
                     created_at, updated_at)
select l.id::uuid, '9f200000-0000-4000-8000-000000000001', l.name, 2026,
       'in_season', 8, 10, 4, 11, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', '{"schedule_mode": "h2h"}',
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}',
       now() - interval '10 days', now() - interval '10 days'
from (values ('b9200000-0000-4000-8000-00000000000a', 'pgtap-pw-LA'),
             ('b9200000-0000-4000-8000-00000000000b', 'pgtap-pw-LB'),
             ('b9200000-0000-4000-8000-00000000000c', 'pgtap-pw-LC')) l(id, name);

insert into teams (id, owner_id, name, league_id) values
 ('c9200000-0000-4000-8000-000000000001', '9f200000-0000-4000-8000-000000000001', 'PW T1', 'b9200000-0000-4000-8000-00000000000a'),
 ('c9200000-0000-4000-8000-000000000002', '9f200000-0000-4000-8000-000000000002', 'PW T2', 'b9200000-0000-4000-8000-00000000000a'),
 ('c9200000-0000-4000-8000-000000000003', '9f200000-0000-4000-8000-000000000001', 'PW T3', 'b9200000-0000-4000-8000-00000000000b'),
 ('c9200000-0000-4000-8000-000000000004', '9f200000-0000-4000-8000-000000000002', 'PW T4', 'b9200000-0000-4000-8000-00000000000b'),
 ('c9200000-0000-4000-8000-000000000005', '9f200000-0000-4000-8000-000000000001', 'PW T5', 'b9200000-0000-4000-8000-00000000000c');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b9200000-0000-4000-8000-00000000000a', '9f200000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000001', 'commissioner', false, 100),
 ('b9200000-0000-4000-8000-00000000000a', '9f200000-0000-4000-8000-000000000002', 'c9200000-0000-4000-8000-000000000002', 'manager',      false, 100),
 ('b9200000-0000-4000-8000-00000000000b', '9f200000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000003', 'commissioner', false, 100),
 ('b9200000-0000-4000-8000-00000000000b', '9f200000-0000-4000-8000-000000000002', 'c9200000-0000-4000-8000-000000000004', 'manager',      false, 100),
 ('b9200000-0000-4000-8000-00000000000c', '9f200000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000005', 'commissioner', false, 100);

-- LA: ONLY week 4 (upcoming), so league_week_advance at 2026-09-30 04:00
-- (week 4 starts_at) opens exactly one week. LB / LC: weeks 1-4, WALKED
-- (110 guard) to 1 final, 2 correction_window, 3 live, 4 upcoming — each
-- opened while the league was on ESPN Standard, so stamped with it.
insert into league_weeks (league_id, season, week) values ('b9200000-0000-4000-8000-00000000000a', 2026, 4);
insert into league_weeks (league_id, season, week)
select l, 2026, g
from unnest(array['b9200000-0000-4000-8000-00000000000b', 'b9200000-0000-4000-8000-00000000000c']::uuid[]) l,
     generate_series(1, 4) g;
update league_weeks set status = 'live' where league_id in ('b9200000-0000-4000-8000-00000000000b', 'b9200000-0000-4000-8000-00000000000c') and week in (1, 2, 3);
update league_weeks set status = 'correction_window' where league_id in ('b9200000-0000-4000-8000-00000000000b', 'b9200000-0000-4000-8000-00000000000c') and week in (1, 2);
update league_weeks set status = 'final' where league_id in ('b9200000-0000-4000-8000-00000000000b', 'b9200000-0000-4000-8000-00000000000c') and week = 1;

-- LB: stored scores for weeks 1-3; a starter with a STAMPED line in every
-- week (so an empty queue for weeks 1-2 is the verb keeping them, never
-- missing data).
insert into matchups (id, league_id, season, week, home_team_id, away_team_id, home_score, away_score, status, result) values
 ('d9200000-0000-4000-8000-000000000001', 'b9200000-0000-4000-8000-00000000000b', 2026, 1, 'c9200000-0000-4000-8000-000000000003', 'c9200000-0000-4000-8000-000000000004', 101.50, 88.25, 'final', 'home'),
 ('d9200000-0000-4000-8000-000000000002', 'b9200000-0000-4000-8000-00000000000b', 2026, 2, 'c9200000-0000-4000-8000-000000000003', 'c9200000-0000-4000-8000-000000000004', 77.00, 79.50, 'final', null),
 ('d9200000-0000-4000-8000-000000000003', 'b9200000-0000-4000-8000-00000000000b', 2026, 3, 'c9200000-0000-4000-8000-000000000003', 'c9200000-0000-4000-8000-000000000004', 40.00, 35.00, 'live', null);
insert into team_week_results (league_id, team_id, season, week, points, h2h_result, is_final) values
 ('b9200000-0000-4000-8000-00000000000b', 'c9200000-0000-4000-8000-000000000003', 2026, 1, 101.50, 'win',  true),
 ('b9200000-0000-4000-8000-00000000000b', 'c9200000-0000-4000-8000-000000000004', 2026, 1,  88.25, 'loss', true),
 ('b9200000-0000-4000-8000-00000000000b', 'c9200000-0000-4000-8000-000000000003', 2026, 2,  77.00, null,   false),
 ('b9200000-0000-4000-8000-00000000000b', 'c9200000-0000-4000-8000-000000000004', 2026, 2,  79.50, null,   false);
insert into players (id, full_name, position, team, status) values
 ('pw-qb3', 'PW QB Three', 'QB', 'KC',  'Active'),
 ('pw-qb4', 'PW QB Four',  'QB', 'BUF', 'Active'),
 ('pw-qb5', 'PW QB Five',  'QB', 'DAL', 'Active');
insert into team_lineups (team_id, season, week, slot_map, starters, bench)
select t.team_id::uuid, 2026, w, t.slot_map::jsonb, '[]', '[]'
from (values ('c9200000-0000-4000-8000-000000000003', '{"qb:0": "pw-qb3"}'),
             ('c9200000-0000-4000-8000-000000000004', '{"qb:0": "pw-qb4"}'),
             ('c9200000-0000-4000-8000-000000000005', '{"qb:0": "pw-qb5"}')) t(team_id, slot_map),
     generate_series(1, 3) w;
insert into player_stats (player_id, season, week, stat_type, updated_at)
select p, 2026, w, 'weekly', timestamptz '2026-09-10 20:00:00+00' + (w || ' minutes')::interval
from unnest(array['pw-qb3', 'pw-qb4', 'pw-qb5']) p, generate_series(1, 3) w;
delete from score_fanout where season = 2026 and week between 1 and 4;

-- ---------------------------------------------------------------------------
-- B. NO CLIENT WRITE, per role, RETURNING counts (§4.2). LA week 4 is given
--    its rules through the real open first (§C), so B runs after C.
-- ---------------------------------------------------------------------------
-- C. THE WEEK-OPEN WRITE — the real job, at the boundary instant.
-- ---------------------------------------------------------------------------
select is(
  (select status || '|' || coalesce(scoring_rules_snapshot::text, 'null') from league_weeks
   where league_id = 'b9200000-0000-4000-8000-00000000000a' and week = 4)
  || '|' || (select md5(scoring_rules_snapshot::text) from leagues where id = 'b9200000-0000-4000-8000-00000000000a'),
  'upcoming|null|924bff8a8c664badf14685a236c2274e',
  'C1 PREMISE: LA week 4 is upcoming and holds NO rules; the league holds ESPN Standard (md5 stored literal)');
select set_config('pgtap.pw_c2', public.league_week_advance('2026-09-30 03:59:59+00', 'b9200000-0000-4000-8000-00000000000a')::text, true);
select is(
  (select status || '|' || coalesce(scoring_rules_snapshot::text, 'null') from league_weeks
   where league_id = 'b9200000-0000-4000-8000-00000000000a' and week = 4),
  'upcoming|null', 'C2 BOUNDARY: one second before week 4 starts_at the job opens nothing, and the week still holds no rules');
select set_config('pgtap.pw_c3', public.league_week_advance('2026-09-30 04:00:00+00', 'b9200000-0000-4000-8000-00000000000a')::text, true);
select is(
  (select status || '|' || md5(scoring_rules_snapshot::text) || '|'
          || (scoring_system_id = (select id from scoring_systems where is_template and name = 'ESPN Standard'))::text
          || '|' || scoring_rules_source || '|' || coalesce(scoring_rules_action_id::text, 'null')
   from league_weeks where league_id = 'b9200000-0000-4000-8000-00000000000a' and week = 4),
  'live|924bff8a8c664badf14685a236c2274e|true|week_open|null',
  'C3 THE WEEK-OPEN WRITE: at starts_at league_week_advance opens week 4 AND it now stores ESPN Standard (md5 stored literal), its system, source week_open (probe W: drop the open stamp ⇒ red)');
select is((current_setting('pgtap.pw_c3')::jsonb ->> 'opened'), '1', 'C4 …and the job opened exactly that one week');
insert into league_weeks (league_id, season, week, status) values ('b9200000-0000-4000-8000-00000000000a', 2026, 5, 'live');
select is(
  (select md5(scoring_rules_snapshot::text) || '|' || scoring_rules_source from league_weeks
   where league_id = 'b9200000-0000-4000-8000-00000000000a' and week = 5),
  '924bff8a8c664badf14685a236c2274e|week_open',
  'C5 a week INSERTED already opened takes the league rules too — no road to an opened week skips the stamp');
select is(
  (select string_agg(week || ':' || coalesce(md5(scoring_rules_snapshot::text), '') || ':' || coalesce(scoring_rules_source, ''), ',' order by week) from league_weeks
   where league_id = 'b9200000-0000-4000-8000-00000000000b'),
  '1:924bff8a8c664badf14685a236c2274e:week_open,2:924bff8a8c664badf14685a236c2274e:week_open,3:924bff8a8c664badf14685a236c2274e:week_open,4::',
  'C6 LB weeks 1-3 were stamped with ESPN Standard as they opened (the plain status UPDATE, 110 steps); upcoming week 4 holds none');

-- B, now that LA week 4 holds rules.
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select results_eq(
  $$ with w as (update league_weeks set scoring_rules_snapshot = '{}' where league_id = 'b9200000-0000-4000-8000-00000000000a' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'B1 anon: UPDATE of a week rules touches 0 rows (no write policy)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f200000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update league_weeks set scoring_rules_snapshot = '{}' where league_id = 'b9200000-0000-4000-8000-00000000000a' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'B2 a league MEMBER: UPDATE of a week rules touches 0 rows');
select is((select md5(scoring_rules_snapshot::text) from league_weeks where league_id = 'b9200000-0000-4000-8000-00000000000a' and week = 4),
  '924bff8a8c664badf14685a236c2274e', 'B3 …but a member CAN read the week rules (056 SELECT policy — league scoring is shown to members, §12.25)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update league_weeks set scoring_rules_snapshot = '{}', scoring_rules_source = 'rescore' where league_id = 'b9200000-0000-4000-8000-00000000000a' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'B4 the COMMISSIONER: UPDATE of a week rules touches 0 rows — only the verb (DEFINER) moves them');
select throws_ok(
  $$ insert into league_weeks (league_id, season, week, status) values ('b9200000-0000-4000-8000-00000000000a', 2026, 6, 'live') $$,
  '42501', null, 'B5 the COMMISSIONER cannot INSERT a week (RLS, 42501)');
reset role;
select set_config('request.jwt.claims', '', true);
select ok(not has_table_privilege('anon', 'public.league_weeks', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.league_weeks', 'TRUNCATE'),
  'B6 no TRUNCATE on league_weeks for anon or authenticated (133 sweep holds)');
select is((select md5(scoring_rules_snapshot::text) from league_weeks where league_id = 'b9200000-0000-4000-8000-00000000000a' and week = 4),
  '924bff8a8c664badf14685a236c2274e', 'B7 …and after all three attempts the stored rules are unchanged');

-- ---------------------------------------------------------------------------
-- D. THE GUARD (postgres context — the service role / a job is the only writer)
-- ---------------------------------------------------------------------------
select throws_like(
  $$ update league_weeks set scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Full PPR'), scoring_rules_source = 'backfill'
     where league_id = 'b9200000-0000-4000-8000-00000000000b' and week = 4 $$,
  '%is upcoming and holds no scoring rules%', 'D1 an UPCOMING week cannot be given rules — it takes the league rules when it opens');
select throws_like(
  $$ update league_weeks set scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Full PPR')
     where league_id = 'b9200000-0000-4000-8000-00000000000b' and week = 1 $$,
  '%is final%never change%', 'D2 a FINAL week rules never change (Q64)');
select throws_like(
  $$ update league_weeks set scoring_system_id = (select id from scoring_systems where is_template and name = 'ESPN Full PPR')
     where league_id = 'b9200000-0000-4000-8000-00000000000b' and week = 2 $$,
  '%is correction_window%never change%', 'D3 a CORRECTION-WINDOW week rules (even their provenance) never change (Q69)');
select throws_like(
  $$ update league_weeks set scoring_rules_snapshot = null, scoring_rules_source = null
     where league_id = 'b9200000-0000-4000-8000-00000000000a' and week = 4 $$,
  '%cannot lose its scoring rules%', 'D4 a LIVE week rules are never cleared');
select throws_like(
  $$ update league_weeks set scoring_rules_snapshot = '{"pass_yards": "corrupt"}'
     where league_id = 'b9200000-0000-4000-8000-00000000000a' and week = 4 $$,
  '%"pass_yards" must be a finite number%', 'D5 104 wall-2 validator refuses a broken document on the NEW column (extended, not bypassed)');

-- ---------------------------------------------------------------------------
-- E. THE Q69 ARM. LB: 1 final, 2 correction_window, 3 live, 4 upcoming.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(week || ':' || status, ',' order by week) from league_weeks where league_id = 'b9200000-0000-4000-8000-00000000000b')
  || ' ' || (select string_agg(week || '=' || home_score || '-' || away_score, ',' order by week) from matchups where league_id = 'b9200000-0000-4000-8000-00000000000b')
  || ' ' || (select count(*) from score_fanout where season = 2026 and week between 1 and 4),
  '1:final,2:correction_window,3:live,4:upcoming 1=101.50-88.25,2=77.00-79.50,3=40.00-35.00 0',
  'E0 PREMISE BY VALUE: the four statuses, the stored scores of weeks 1-3, an empty queue');
select set_config('pgtap.pw_before',
  (select string_agg(row_to_json(lw)::text, ' ; ' order by lw.week) from league_weeks lw
   where lw.league_id = 'b9200000-0000-4000-8000-00000000000b' and lw.week in (1, 2))
  || ' || ' || (select string_agg(row_to_json(m)::text, ' ; ' order by m.week) from matchups m
                where m.league_id = 'b9200000-0000-4000-8000-00000000000b' and m.week in (1, 2))
  || ' || ' || (select string_agg(row_to_json(r)::text, ' ; ' order by r.week, r.team_id) from team_week_results r
                where r.league_id = 'b9200000-0000-4000-8000-00000000000b' and r.week in (1, 2)), true);
select ok(current_setting('pgtap.pw_before') like '%week_open%101.50%77.00%79.50%',
  'E0b PREMISE: the weeks 1-2 capture is real — their stored rules rows, both matchups, all four result rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.pw_e',
  (select public.commish_change_setting('b9200000-0000-4000-8000-00000000000b',
     'scoring_system_id', to_jsonb((select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')),
     true, null, '09200000-0000-4000-8000-000000000001'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);

select is(current_setting('pgtap.pw_e')::jsonb -> 'consequences' -> 'rescored_weeks',
  '[{"week": 3, "status": "live", "starters_enqueued": 2, "score_not_enqueued": []}]'::jsonb,
  'E1 ONLY the live week 3 is re-scored (Q64 this week and later)');
select is((select string_agg(week || ':' || player_id, ',' order by week, player_id) from score_fanout where season = 2026 and week between 1 and 4),
  '3:pw-qb3,3:pw-qb4',
  'E2 the queue holds week 3 starters ONLY — nothing for correction-window week 2 nor final week 1, although their starters carry stamped lines (probe Q: put correction_window back ⇒ red)');
select is(
  (select md5(lw.scoring_rules_snapshot::text) || '|' || (lw.scoring_system_id = (select id from scoring_systems where is_template and name = 'ESPN Full PPR'))::text
          || '|' || lw.scoring_rules_source || '|' || (lw.scoring_rules_action_id::text = current_setting('pgtap.pw_e')::jsonb ->> 'commissioner_action_id')::text
   from league_weeks lw where lw.league_id = 'b9200000-0000-4000-8000-00000000000b' and lw.week = 3),
  '7a448a2aaa6997cc8e734a52b6231e17|true|rescore|true',
  'E3 week 3 now STORES Full PPR (md5 stored literal), source rescore, stamped with THIS receipt — the worker re-scores it under them');
select is(
  (select string_agg(row_to_json(lw)::text, ' ; ' order by lw.week) from league_weeks lw
   where lw.league_id = 'b9200000-0000-4000-8000-00000000000b' and lw.week in (1, 2))
  || ' || ' || (select string_agg(row_to_json(m)::text, ' ; ' order by m.week) from matchups m
                where m.league_id = 'b9200000-0000-4000-8000-00000000000b' and m.week in (1, 2))
  || ' || ' || (select string_agg(row_to_json(r)::text, ' ; ' order by r.week, r.team_id) from team_week_results r
                where r.league_id = 'b9200000-0000-4000-8000-00000000000b' and r.week in (1, 2)),
  current_setting('pgtap.pw_before'),
  'E4 WEEKS 1 AND 2 ARE BYTE-IDENTICAL: their league_weeks rows (stored ESPN Standard rules included), matchups and results, compared whole (probe Q ⇒ red)');
select is(
  (current_setting('pgtap.pw_e')::jsonb -> 'rescore_skipped_final_weeks')::text || '|'
  || (current_setting('pgtap.pw_e')::jsonb -> 'rescore_skipped_correction_window_weeks')::text || '|'
  || (current_setting('pgtap.pw_e')::jsonb ->> 'rescore_skipped_final_weeks_why'),
  '[1]|[2]|finished_weeks_not_rescored — week 1 (final) and week 2 (final, pending stat corrections) keep their scores and results; the new scoring applies to week 3 (being played now — re-scored under it) and to every later week (scored under it when it opens)',
  'E5 the kept weeks are NAMED, each with its status, in plain words');
select is(
  (current_setting('pgtap.pw_e')::jsonb -> 'consequences' -> 'week_rules_rewritten')::text || '|'
  || (current_setting('pgtap.pw_e')::jsonb -> 'consequences' -> 'rescore_skipped_correction_window_weeks')::text || '|'
  || (select (metadata -> 'rescore_skipped_correction_window_weeks')::text from commissioner_actions where league_id = 'b9200000-0000-4000-8000-00000000000b'),
  '[3]|[2]|[2]', 'E6 consequences name the week whose rules moved and the kept correction-window week; so does the ONE receipt');
select is((select message from league_chat where league_id = 'b9200000-0000-4000-8000-00000000000b' and is_system),
  'Setting scoring_system_id changed from "' || (select id::text from scoring_systems where is_template and name = 'ESPN Standard')
    || '" to "' || (select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')
    || '" by pw_user1 (commissioner override) — week 3 (being played now) will be re-scored under the new rules; week 1 (final) and week 2 (final, pending stat corrections) keep their scores and results',
  'E7 the league post says in plain words that the final week AND last week (still in its correction window) keep their scores');
select is(
  (select coalesce(scoring_rules_snapshot::text, 'null') from league_weeks where league_id = 'b9200000-0000-4000-8000-00000000000b' and week = 4)
  || '|' || (select md5(scoring_rules_snapshot::text) from leagues where id = 'b9200000-0000-4000-8000-00000000000b'),
  'null|7a448a2aaa6997cc8e734a52b6231e17', 'E8 upcoming week 4 still holds nothing, and the league (the rules the next week takes) is Full PPR');
update league_weeks set status = 'live' where league_id = 'b9200000-0000-4000-8000-00000000000b' and week = 4;
select is((select md5(scoring_rules_snapshot::text) || '|' || scoring_rules_source from league_weeks where league_id = 'b9200000-0000-4000-8000-00000000000b' and week = 4),
  '7a448a2aaa6997cc8e734a52b6231e17|week_open', 'E9 …and when week 4 opens it takes Full PPR — the new rules start with the coming week');

-- rescore = FALSE (LC): no opened week's rules change.
select set_config('pgtap.pw_lc_before',
  (select string_agg(row_to_json(lw)::text, ' ; ' order by lw.week) from league_weeks lw
   where lw.league_id = 'b9200000-0000-4000-8000-00000000000c'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f200000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.pw_f',
  (select public.commish_change_setting('b9200000-0000-4000-8000-00000000000c',
     'scoring_system_id', to_jsonb((select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')),
     false, null, '09200000-0000-4000-8000-000000000002'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select string_agg(row_to_json(lw)::text, ' ; ' order by lw.week) from league_weeks lw
   where lw.league_id = 'b9200000-0000-4000-8000-00000000000c'),
  current_setting('pgtap.pw_lc_before'),
  'E10 rescore OFF: EVERY week row of LC is byte-identical — final, correction-window AND live week keep ESPN Standard; upcoming week 4 still holds none');
select is(
  (current_setting('pgtap.pw_f')::jsonb -> 'consequences' -> 'week_rules_rewritten')::text || '|'
  || (current_setting('pgtap.pw_f')::jsonb -> 'consequences' ->> 'score_stale') || '|'
  || (select count(*) from score_fanout where season = 2026 and player_id = 'pw-qb5'),
  '[]|false|0', 'E11 …nothing re-written, nothing stale (no week is mixed), nothing queued');
update league_weeks set status = 'live' where league_id = 'b9200000-0000-4000-8000-00000000000c' and week = 4;
select is((select md5(scoring_rules_snapshot::text) from league_weeks where league_id = 'b9200000-0000-4000-8000-00000000000c' and week = 4),
  '7a448a2aaa6997cc8e734a52b6231e17', 'E12 …and the next week to open takes Full PPR');

-- ---------------------------------------------------------------------------
-- F. THE BACKFILL over a pre-144 shape. Weeks opened while the league held
--    NO snapshot copy NULL (the stamp copies what the league has), which is
--    exactly a pre-144 opened week; then the league is frozen on its CURRENT
--    rules and the verb ledger is planted as 129/131/141 wrote it.
--    LD: C1 (t1) ESPN Standard -> Yahoo Half PPR, rescore OFF, week 1 final,
--        week 2 live, weeks 3+ upcoming; C2 (t2) Yahoo Half -> Full PPR,
--        rescore ON, weeks 1-2 final, week 3 live (re-scored); a NO-OP row
--        (t3) and a PLANTED commissioner_actions row with no ledger twin.
--        Now: 1-2 final, 3 correction_window, 4 live, 5 upcoming.
--    LE: no change ever; 1 final, 2 live; frozen on ESPN Standard.
--    LF: the first change names a system that does not exist; 1 final.
-- ---------------------------------------------------------------------------
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings,
                     created_at, updated_at)
select l.id::uuid, '9f200000-0000-4000-8000-000000000001', l.name, 2026,
       'scheduled', 8, 10, 4, 11, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'), null,
       'per_player_kickoff', '{"schedule_mode": "h2h"}',
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}',
       now() - interval '10 days', now() - interval '10 days'
from (values ('b9200000-0000-4000-8000-00000000000d', 'pgtap-pw-LD'),
             ('b9200000-0000-4000-8000-00000000000e', 'pgtap-pw-LE'),
             ('b9200000-0000-4000-8000-00000000000f', 'pgtap-pw-LF')) l(id, name);
insert into league_weeks (league_id, season, week)
select 'b9200000-0000-4000-8000-00000000000d'::uuid, 2026, g from generate_series(1, 5) g
union all select 'b9200000-0000-4000-8000-00000000000e'::uuid, 2026, g from generate_series(1, 2) g
union all select 'b9200000-0000-4000-8000-00000000000f'::uuid, 2026, 1;
update league_weeks set status = 'live' where league_id in ('b9200000-0000-4000-8000-00000000000d', 'b9200000-0000-4000-8000-00000000000e', 'b9200000-0000-4000-8000-00000000000f') and week between 1 and 4
  and not (league_id = 'b9200000-0000-4000-8000-00000000000e' and week > 2) and not (league_id = 'b9200000-0000-4000-8000-00000000000f' and week > 1);
update league_weeks set status = 'correction_window' where (league_id = 'b9200000-0000-4000-8000-00000000000d' and week between 1 and 3)
  or (league_id in ('b9200000-0000-4000-8000-00000000000e', 'b9200000-0000-4000-8000-00000000000f') and week = 1);
update league_weeks set status = 'final' where (league_id = 'b9200000-0000-4000-8000-00000000000d' and week between 1 and 2)
  or (league_id in ('b9200000-0000-4000-8000-00000000000e', 'b9200000-0000-4000-8000-00000000000f') and week = 1);
update leagues set status = 'in_season',
  scoring_system_id = (select id from scoring_systems where is_template and name = 'ESPN Full PPR'),
  scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Full PPR')
where id = 'b9200000-0000-4000-8000-00000000000d';
update leagues set status = 'in_season',
  scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Standard')
where id in ('b9200000-0000-4000-8000-00000000000e', 'b9200000-0000-4000-8000-00000000000f');

insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, target_id, reason, before, after, metadata, created_at) values
 ('a9200000-0000-4000-8000-000000000001', 'b9200000-0000-4000-8000-00000000000d', '9f200000-0000-4000-8000-000000000001', 'change_setting', 'setting', 'scoring_system_id', null,
  jsonb_build_object('scoring_system_id', (select id from scoring_systems where is_template and name = 'ESPN Standard')),
  jsonb_build_object('scoring_system_id', (select id from scoring_systems where is_template and name = 'Yahoo Half PPR')), '{}', '2026-09-15 12:00:00+00'),
 ('a9200000-0000-4000-8000-000000000002', 'b9200000-0000-4000-8000-00000000000d', '9f200000-0000-4000-8000-000000000001', 'change_setting', 'setting', 'scoring_system_id', null,
  jsonb_build_object('scoring_system_id', (select id from scoring_systems where is_template and name = 'Yahoo Half PPR')),
  jsonb_build_object('scoring_system_id', (select id from scoring_systems where is_template and name = 'ESPN Full PPR')), '{}', '2026-09-24 12:00:00+00'),
 -- PLANTED: a commissioner may INSERT here directly (123:333-335) — no ledger twin; the backfill must never read it.
 ('a9200000-0000-4000-8000-000000000003', 'b9200000-0000-4000-8000-00000000000d', '9f200000-0000-4000-8000-000000000001', 'change_setting', 'setting', 'scoring_system_id', 'planted',
  jsonb_build_object('scoring_system_id', (select id from scoring_systems where is_template and name = 'ESPN Full PPR')),
  jsonb_build_object('scoring_system_id', (select id from scoring_systems where is_template and name = 'Sleeper Standard')), '{}', '2026-09-26 12:00:00+00'),
 ('a9200000-0000-4000-8000-000000000004', 'b9200000-0000-4000-8000-00000000000f', '9f200000-0000-4000-8000-000000000001', 'change_setting', 'setting', 'scoring_system_id', null,
  '{"scoring_system_id": "00000000-0000-4000-8000-00000000dead"}',
  jsonb_build_object('scoring_system_id', (select id from scoring_systems where is_template and name = 'ESPN Standard')), '{}', '2026-09-15 12:00:00+00');
insert into commish_setting_actions (league_id, setting_key, action_id, actor_id, result, created_at) values
 ('b9200000-0000-4000-8000-00000000000d', 'scoring_system_id', '09200000-0000-4000-8000-0000000000d1', '9f200000-0000-4000-8000-000000000001',
  jsonb_build_object('season', 2026, 'no_changes', false, 'rescore_requested', false, 'evaluated_at', '2026-09-15T12:00:00+00:00',
    'commissioner_action_id', 'a9200000-0000-4000-8000-000000000001',
    'previous_value', (select id from scoring_systems where is_template and name = 'ESPN Standard'),
    'value', (select id from scoring_systems where is_template and name = 'Yahoo Half PPR'),
    'consequences', '{"final_weeks": [1], "open_weeks": [{"week": 2, "status": "live"}], "rescored_weeks": []}'::jsonb), '2026-09-15 12:00:00+00'),
 ('b9200000-0000-4000-8000-00000000000d', 'scoring_system_id', '09200000-0000-4000-8000-0000000000d2', '9f200000-0000-4000-8000-000000000001',
  jsonb_build_object('season', 2026, 'no_changes', false, 'rescore_requested', true, 'evaluated_at', '2026-09-24T12:00:00+00:00',
    'commissioner_action_id', 'a9200000-0000-4000-8000-000000000002',
    'previous_value', (select id from scoring_systems where is_template and name = 'Yahoo Half PPR'),
    'value', (select id from scoring_systems where is_template and name = 'ESPN Full PPR'),
    'consequences', '{"final_weeks": [1, 2], "open_weeks": [{"week": 3, "status": "live"}], "rescored_weeks": [{"week": 3, "status": "live"}]}'::jsonb), '2026-09-24 12:00:00+00'),
 ('b9200000-0000-4000-8000-00000000000d', 'scoring_system_id', '09200000-0000-4000-8000-0000000000d3', '9f200000-0000-4000-8000-000000000001',
  jsonb_build_object('season', 2026, 'no_changes', true, 'rescore_requested', false, 'evaluated_at', '2026-09-25T12:00:00+00:00',
    'commissioner_action_id', null,
    'previous_value', (select id from scoring_systems where is_template and name = 'ESPN Full PPR'),
    'value', (select id from scoring_systems where is_template and name = 'ESPN Full PPR'), 'consequences', null), '2026-09-25 12:00:00+00'),
 ('b9200000-0000-4000-8000-00000000000f', 'scoring_system_id', '09200000-0000-4000-8000-0000000000f1', '9f200000-0000-4000-8000-000000000001',
  jsonb_build_object('season', 2026, 'no_changes', false, 'rescore_requested', false, 'evaluated_at', '2026-09-15T12:00:00+00:00',
    'commissioner_action_id', 'a9200000-0000-4000-8000-000000000004',
    'previous_value', '00000000-0000-4000-8000-00000000dead',
    'value', (select id from scoring_systems where is_template and name = 'ESPN Standard'),
    'consequences', '{"final_weeks": [1], "open_weeks": [], "rescored_weeks": []}'::jsonb), '2026-09-15 12:00:00+00');

select is(
  (select string_agg(league_id::text || ':' || week || ':' || status || ':' || coalesce(scoring_rules_snapshot::text, 'null'), ',' order by league_id, week) from league_weeks
   where league_id in ('b9200000-0000-4000-8000-00000000000d', 'b9200000-0000-4000-8000-00000000000e', 'b9200000-0000-4000-8000-00000000000f')),
  'b9200000-0000-4000-8000-00000000000d:1:final:null,b9200000-0000-4000-8000-00000000000d:2:final:null,b9200000-0000-4000-8000-00000000000d:3:correction_window:null,'
  'b9200000-0000-4000-8000-00000000000d:4:live:null,b9200000-0000-4000-8000-00000000000d:5:upcoming:null,'
  'b9200000-0000-4000-8000-00000000000e:1:final:null,b9200000-0000-4000-8000-00000000000e:2:live:null,'
  'b9200000-0000-4000-8000-00000000000f:1:final:null',
  'F0 PREMISE BY VALUE: the pre-144 shape — every opened week holds NO rules, and the statuses are as described');

-- Dry run first: reports, writes nothing.
select set_config('pgtap.pw_dry', public.league_weeks_rules_backfill_internal(false)::text, true);
select is(
  (select count(*)::int from league_weeks where scoring_rules_snapshot is not null
   and league_id in ('b9200000-0000-4000-8000-00000000000d', 'b9200000-0000-4000-8000-00000000000e', 'b9200000-0000-4000-8000-00000000000f'))
  || '|' || (current_setting('pgtap.pw_dry')::jsonb ->> 'applied'),
  '0|false', 'F1 a DRY RUN writes nothing and says so');
select set_config('pgtap.pw_bf', public.league_weeks_rules_backfill_internal(true)::text, true);
select is(
  (select string_agg(lw.league_id::text || ':' || lw.week || ':' || coalesce(s.name, 'null') || ':' || coalesce(lw.scoring_rules_source, 'null')
                     || ':' || coalesce(lw.scoring_rules_action_id::text, 'null'), ',' order by lw.league_id, lw.week)
   from league_weeks lw left join scoring_systems s on s.id = lw.scoring_system_id
   where lw.league_id in ('b9200000-0000-4000-8000-00000000000d', 'b9200000-0000-4000-8000-00000000000e', 'b9200000-0000-4000-8000-00000000000f')),
  'b9200000-0000-4000-8000-00000000000d:1:ESPN Standard:backfill:null,'
  'b9200000-0000-4000-8000-00000000000d:2:Yahoo Half PPR:backfill_ambiguous:a9200000-0000-4000-8000-000000000001,'
  'b9200000-0000-4000-8000-00000000000d:3:ESPN Full PPR:backfill:a9200000-0000-4000-8000-000000000002,'
  'b9200000-0000-4000-8000-00000000000d:4:ESPN Full PPR:backfill:a9200000-0000-4000-8000-000000000002,'
  'b9200000-0000-4000-8000-00000000000d:5:null:null:null,'
  'b9200000-0000-4000-8000-00000000000e:1:ESPN Standard:backfill:null,'
  'b9200000-0000-4000-8000-00000000000e:2:ESPN Standard:backfill:null,'
  'b9200000-0000-4000-8000-00000000000f:1:null:null:null',
  'F2 EACH WEEK GETS THE RULES IT WAS SCORED WITH: LD w1 ESPN Std (final before any change), w2 Yahoo Half (live at C1 without rescore: MIXED, named), w3 Full PPR (re-scored by C2), w4 Full PPR (opened after C2), w5 upcoming none; LE both weeks the draft freeze; LF unrecoverable, left NULL. The planted receipt and the no-op were never read (w4 is not Sleeper)');
select is(
  (select string_agg(lw.week || ':' || md5(lw.scoring_rules_snapshot::text), ',' order by lw.week) from league_weeks lw
   where lw.league_id = 'b9200000-0000-4000-8000-00000000000d' and lw.scoring_rules_snapshot is not null),
  '1:924bff8a8c664badf14685a236c2274e,2:f6a10e87490bde3f85204213d1c18b47,3:7a448a2aaa6997cc8e734a52b6231e17,4:7a448a2aaa6997cc8e734a52b6231e17',
  'F3 …the rules DOCUMENTS as stored literals (md5): ESPN Standard, Yahoo Half PPR, Full PPR, Full PPR');
select is(
  (select jsonb_agg(x -> 'week' order by x ->> 'league_id', (x ->> 'week')::int)
   from jsonb_array_elements(current_setting('pgtap.pw_bf')::jsonb -> 'ambiguous') x
   where x ->> 'league_id' like 'b9200000-%')::text
  || '|' || ((select x ->> 'why' from jsonb_array_elements(current_setting('pgtap.pw_bf')::jsonb -> 'ambiguous') x
              where x ->> 'league_id' = 'b9200000-0000-4000-8000-00000000000d' and (x ->> 'week')::int = 2)
             like 'week 2 was live when scoring change a9200000-0000-4000-8000-000000000001%landed without re-scoring it%NEWER rules%')::text,
  '[2]|true', 'F4 the report NAMES the mixed week — and only it — with why, never silently');
select is(
  (select string_agg((x ->> 'league_id') || ':' || (x ->> 'week') || ':' || (x ->> 'why'), ',')
   from jsonb_array_elements(current_setting('pgtap.pw_bf')::jsonb -> 'unrecoverable') x
   where x ->> 'league_id' like 'b9200000-%'),
  'b9200000-0000-4000-8000-00000000000f:1:the scoring system in force before the first change (00000000-0000-4000-8000-00000000dead) cannot be read, and the week was scored under it',
  'F5 …and the UNRECOVERABLE week by name, with why (it stays without rules; every reader refuses it by name)');
select is(
  (select count(*)::int from jsonb_array_elements(public.league_weeks_rules_backfill_internal(true) -> 'weeks') x
   where x ->> 'league_id' like 'b9200000-%'),
  0, 'F6 a RE-RUN writes nothing new for these leagues: every opened week it could recover already has rules');

select * from finish();
rollback;
