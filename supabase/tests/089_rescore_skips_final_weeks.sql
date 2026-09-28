-- ============================================================================
-- pgTAP 089 — migration 141: Q64 AS RULED — `rescore = true` re-scores every
-- OPEN week and SKIPS final weeks, naming them, instead of refusing
-- (task L.E1.24 of M6A; tasks-M6A §6's 2026-09-27 amendment, L.E1.24 PROOF +
-- BREAK PROBES; §4 rules 11-15; PROGRESS Q64 (ruled 2026-09-27), F382, F359,
-- D378; spec §10.1 v2.16.42 "a scoring change applies to open and future
-- weeks; a final week is never re-scored" / §15.4 / §7.3.3.)
--
-- THE RULING (Chris, 2026-09-27): option 1, going forward only — "The new
-- rule applies to this week and later. Finished weeks keep their original
-- scores and results." 129/131 step (11b) refused the WHOLE call whenever
-- any week was final; 141 replaces that block (pgTAP 077 G10-G14 re-cut).
--
-- WHAT THIS SUITE PROVES, IN ORDER:
--   §A  form pins — the post-141 body as a STORED-LITERAL md5; the refusal
--       and the seam marker gone; one overload; plain + search_path; REVOKE;
--       no reopen_week.
--   §B  fixtures and their PREMISES BY VALUE (§4 rule 14(c)): LA has week 1
--       FINAL (its matchups / team_week_results rows asserted as STORED
--       LITERALS), week 2 LIVE, week 3 upcoming; LB week 1 final, week 2
--       CORRECTION_WINDOW, week 3 live; LC week 1 final, week 2 upcoming (no
--       open week); LD week 1 live, NO final week.
--   §C  THE CORE: on LA the scoring change with rescore = true LANDS; week 2
--       is queued under the new rules; week 1 is BYTE-IDENTICAL (its matchup
--       row, its two result rows, the standings, and NOTHING queued for it);
--       the document names week 1 as skipped, in plain words; ONE receipt,
--       ONE post. ***BREAK PROBES P1 (restore the RAISE ⇒ C1/C3 red), P2 (let
--       the loop include final weeks ⇒ C5/C6 red), P3 (drop the skipped
--       field ⇒ C9 red).***
--   §D  rescore = false is UNCHANGED (LC), and rescore = true with a final
--       week and NO open week lands and says so (LC, the no_open_week arm).
--   §E  a CORRECTION_WINDOW week IS re-scored (LB) — the task reading: open is
--       131 v_open_weeks = live + correction_window; only final is kept.
--       ***BREAK PROBE P4 (skip correction_window too ⇒ E2/E3 red).***
--   §F  no final week at all (LD) ⇒ behaviour as before, the new fields say
--       nothing was skipped.
--   §G  REPLAY — the landed action replays byte-identically.
--
-- Break probes are applied to a SCRATCHPAD copy of the body inside this
-- suite transaction (the working tree never holds a broken body); the PR
-- shows each one red by name.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(43);

-- ---------------------------------------------------------------------------
-- A. FORM PINS
-- ---------------------------------------------------------------------------
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting_internal'),
  '05d2c7e4ae83506c113f7168d262a8b3',
  'A1 the post-141 body, as a STORED LITERAL md5 (measured on the local chain 001-141; pre-141 it was 497b5fbc33dd6c7fc0b9da41f9f212f2 — 131 text, nine hunks apart)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting_internal'
     and (p.prosrc like '%Q64 SEAM%' or p.prosrc like '%cannot reach FINAL week%' or p.prosrc like '%wait for reopen_week%')),
  0, 'A2 the whole-call refusal is GONE from the body: no Q64 SEAM marker, no "cannot reach FINAL week" RAISE, no "wait for reopen_week" route');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'Q64 AS RULED', ''))) / length('Q64 AS RULED')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting_internal'),
  1, 'A3 …and the ruled block is marked ONCE (Q64 AS RULED), so the next reader finds exactly one place');
select ok(
  (select count(*) = 1 and bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_change_setting_internal'),
  'A4 ONE overload, still PLAIN with search_path empty (the DEFINER door 129 is not replaced)');
select ok(
  not has_function_privilege('authenticated', 'public.commish_change_setting_internal(uuid,text,jsonb,boolean,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_change_setting_internal(uuid,text,jsonb,boolean,uuid,timestamptz,text)', 'EXECUTE'),
  'A5 the internal is still REVOKEd from anon and authenticated — no client supplies the instant');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'reopen_week%'),
  0, 'A6 NO reopen_week exists (Q64: not wanted) — a final week is skipped, never reopened');

-- ---------------------------------------------------------------------------
-- B. FIXTURES (postgres context, JWT cleared) — AND THEIR PREMISES.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('8e900000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-rs' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'rs_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings,
                     created_at, updated_at)
select l.id::uuid, '8e900000-0000-4000-8000-000000000001', l.name, 2026,
       'in_season', 8, 10, 4, 11, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', '{"schedule_mode": "h2h"}',
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}',
       now() - interval '10 days', now() - interval '10 days'
from (values ('b8900000-0000-4000-8000-00000000000a', 'pgtap-rs-LA'),
             ('b8900000-0000-4000-8000-00000000000b', 'pgtap-rs-LB'),
             ('b8900000-0000-4000-8000-00000000000c', 'pgtap-rs-LC'),
             ('b8900000-0000-4000-8000-00000000000d', 'pgtap-rs-LD')) l(id, name);

insert into teams (id, owner_id, name, league_id) values
 ('c8900000-0000-4000-8000-000000000001', '8e900000-0000-4000-8000-000000000001', 'RS T1', 'b8900000-0000-4000-8000-00000000000a'),
 ('c8900000-0000-4000-8000-000000000002', '8e900000-0000-4000-8000-000000000002', 'RS T2', 'b8900000-0000-4000-8000-00000000000a'),
 ('c8900000-0000-4000-8000-000000000003', '8e900000-0000-4000-8000-000000000001', 'RS T3', 'b8900000-0000-4000-8000-00000000000b'),
 ('c8900000-0000-4000-8000-000000000005', '8e900000-0000-4000-8000-000000000001', 'RS T5', 'b8900000-0000-4000-8000-00000000000c'),
 ('c8900000-0000-4000-8000-000000000006', '8e900000-0000-4000-8000-000000000001', 'RS T6', 'b8900000-0000-4000-8000-00000000000d');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b8900000-0000-4000-8000-00000000000a', '8e900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000001', 'commissioner', false, 100),
 ('b8900000-0000-4000-8000-00000000000a', '8e900000-0000-4000-8000-000000000002', 'c8900000-0000-4000-8000-000000000002', 'manager',      false, 100),
 ('b8900000-0000-4000-8000-00000000000b', '8e900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000003', 'commissioner', false, 100),
 ('b8900000-0000-4000-8000-00000000000c', '8e900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000005', 'commissioner', false, 100),
 ('b8900000-0000-4000-8000-00000000000d', '8e900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000006', 'commissioner', false, 100);

-- Weeks, WALKED forward one legal step per UPDATE (110 guard, §12.17).
insert into league_weeks (league_id, season, week)
select l.id, 2026, g
from (values ('b8900000-0000-4000-8000-00000000000a'::uuid), ('b8900000-0000-4000-8000-00000000000b'::uuid),
             ('b8900000-0000-4000-8000-00000000000c'::uuid), ('b8900000-0000-4000-8000-00000000000d'::uuid)) l(id),
     generate_series(1, 3) g;
-- LA: 1 final, 2 live, 3 upcoming. LB: 1 final, 2 correction_window, 3 live.
-- LC: 1 final, 2-3 upcoming. LD: 1 live, 2-3 upcoming.
update league_weeks set status = 'live' where season = 2026 and week = 1
  and league_id in ('b8900000-0000-4000-8000-00000000000a', 'b8900000-0000-4000-8000-00000000000b', 'b8900000-0000-4000-8000-00000000000c', 'b8900000-0000-4000-8000-00000000000d');
update league_weeks set status = 'correction_window' where season = 2026 and week = 1
  and league_id in ('b8900000-0000-4000-8000-00000000000a', 'b8900000-0000-4000-8000-00000000000b', 'b8900000-0000-4000-8000-00000000000c');
update league_weeks set status = 'final' where season = 2026 and week = 1
  and league_id in ('b8900000-0000-4000-8000-00000000000a', 'b8900000-0000-4000-8000-00000000000b', 'b8900000-0000-4000-8000-00000000000c');
update league_weeks set status = 'live' where season = 2026 and week = 2
  and league_id in ('b8900000-0000-4000-8000-00000000000a', 'b8900000-0000-4000-8000-00000000000b');
update league_weeks set status = 'correction_window' where season = 2026 and week = 2
  and league_id = 'b8900000-0000-4000-8000-00000000000b';
update league_weeks set status = 'live' where season = 2026 and week = 3
  and league_id = 'b8900000-0000-4000-8000-00000000000b';

-- LA: week 1 FINAL h2h matchup + its results (the rows the change must not
-- touch), and week 2 LIVE with provisional scores.
insert into matchups (id, league_id, season, week, home_team_id, away_team_id, home_score, away_score, status, result) values
 ('d8900000-0000-4000-8000-000000000001', 'b8900000-0000-4000-8000-00000000000a', 2026, 1,
  'c8900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000002', 101.50, 88.25, 'final', 'home'),
 ('d8900000-0000-4000-8000-000000000002', 'b8900000-0000-4000-8000-00000000000a', 2026, 2,
  'c8900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000002', 40.00, 35.00, 'live', null);
insert into team_week_results (league_id, team_id, season, week, points, h2h_result, is_final) values
 ('b8900000-0000-4000-8000-00000000000a', 'c8900000-0000-4000-8000-000000000001', 2026, 1, 101.50, 'win',  true),
 ('b8900000-0000-4000-8000-00000000000a', 'c8900000-0000-4000-8000-000000000002', 2026, 1,  88.25, 'loss', true),
 ('b8900000-0000-4000-8000-00000000000a', 'c8900000-0000-4000-8000-000000000001', 2026, 2,  40.00, null,   false),
 ('b8900000-0000-4000-8000-00000000000a', 'c8900000-0000-4000-8000-000000000002', 2026, 2,  35.00, null,   false);

-- Players: LA starts rs-qb1 / rs-rb1 (T1) and rs-qb2 (T2) in weeks 1 AND 2;
-- LB starts rs-qb3 in weeks 1, 2 and 3; LD starts rs-qb6 in week 1. Every
-- line is STAMPED (queueable), so a missing queue row is the verb, never the
-- data.
insert into players (id, full_name, position, team, status) values
 ('rs-qb1', 'RS QB One',   'QB', 'DAL', 'Active'),
 ('rs-rb1', 'RS RB One',   'RB', 'SF',  'Active'),
 ('rs-qb2', 'RS QB Two',   'QB', 'PHI', 'Active'),
 ('rs-qb3', 'RS QB Three', 'QB', 'KC',  'Active'),
 ('rs-qb6', 'RS QB Six',   'QB', 'BUF', 'Active');
insert into team_lineups (team_id, season, week, slot_map, starters, bench)
select t.team_id::uuid, 2026, w, t.slot_map::jsonb, '[]', '[]'
from (values ('c8900000-0000-4000-8000-000000000001', '{"qb:0": "rs-qb1", "rb:0": "rs-rb1"}'),
             ('c8900000-0000-4000-8000-000000000002', '{"qb:0": "rs-qb2"}')) t(team_id, slot_map),
     generate_series(1, 2) w;
insert into team_lineups (team_id, season, week, slot_map, starters, bench)
select 'c8900000-0000-4000-8000-000000000003', 2026, w, '{"qb:0": "rs-qb3"}', '[]', '[]' from generate_series(1, 3) w;
insert into team_lineups (team_id, season, week, slot_map, starters, bench) values
 ('c8900000-0000-4000-8000-000000000006', 2026, 1, '{"qb:0": "rs-qb6"}', '[]', '[]');
insert into player_stats (player_id, season, week, stat_type, updated_at)
select p, 2026, w, 'weekly', timestamptz '2026-09-10 20:00:00+00' + (w || ' minutes')::interval
from unnest(array['rs-qb1', 'rs-rb1', 'rs-qb2', 'rs-qb3']) p, generate_series(1, 3) w;
insert into player_stats (player_id, season, week, stat_type, updated_at) values
 ('rs-qb6', 2026, 1, 'weekly', timestamptz '2026-09-10 20:01:00+00');
delete from score_fanout where season = 2026 and week between 1 and 3;

-- PREMISES, BY VALUE.
select is((select string_agg(league_id::text || ':' || week || ':' || status, ',' order by league_id, week) from league_weeks
           where league_id in ('b8900000-0000-4000-8000-00000000000a', 'b8900000-0000-4000-8000-00000000000b',
                               'b8900000-0000-4000-8000-00000000000c', 'b8900000-0000-4000-8000-00000000000d')),
  'b8900000-0000-4000-8000-00000000000a:1:final,b8900000-0000-4000-8000-00000000000a:2:live,b8900000-0000-4000-8000-00000000000a:3:upcoming,'
  'b8900000-0000-4000-8000-00000000000b:1:final,b8900000-0000-4000-8000-00000000000b:2:correction_window,b8900000-0000-4000-8000-00000000000b:3:live,'
  'b8900000-0000-4000-8000-00000000000c:1:final,b8900000-0000-4000-8000-00000000000c:2:upcoming,b8900000-0000-4000-8000-00000000000c:3:upcoming,'
  'b8900000-0000-4000-8000-00000000000d:1:live,b8900000-0000-4000-8000-00000000000d:2:upcoming,b8900000-0000-4000-8000-00000000000d:3:upcoming',
  'B1 PREMISE: every week status as the suite needs it — LA final/live/upcoming, LB final/correction_window/live, LC final/upcoming/upcoming, LD live with NO final week');
select is((select home_score || '|' || away_score || '|' || result || '|' || status || '|' || is_overridden from matchups
           where id = 'd8900000-0000-4000-8000-000000000001'),
  '101.50|88.25|home|final|false', 'B2 PREMISE (stored literal): LA week 1 final matchup is 101.50 - 88.25, home won, not overridden');
select is((select string_agg(team_id::text || '=' || points || '/' || h2h_result || '/' || is_final, ',' order by team_id) from team_week_results
           where league_id = 'b8900000-0000-4000-8000-00000000000a' and week = 1),
  'c8900000-0000-4000-8000-000000000001=101.50/win/true,c8900000-0000-4000-8000-000000000002=88.25/loss/true',
  'B3 PREMISE (stored literal): LA week 1 results — T1 101.50 win, T2 88.25 loss, both final');
select is((select scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Standard')
           from leagues where id = 'b8900000-0000-4000-8000-00000000000a'),
  true, 'B4 PREMISE: LA is frozen on ESPN Standard today, so the change to Full PPR is a change of rules document');
select is((select count(*)::int from score_fanout where season = 2026 and week between 1 and 3),
  0, 'B5 PREMISE: the queue is EMPTY for weeks 1-3 before any call, so every queue row counted below was written by the verb');
select is((select count(*)::int from commissioner_actions where league_id in
           ('b8900000-0000-4000-8000-00000000000a', 'b8900000-0000-4000-8000-00000000000b',
            'b8900000-0000-4000-8000-00000000000c', 'b8900000-0000-4000-8000-00000000000d')),
  0, 'B6 PREMISE: zero receipts across the four leagues');
-- The week-1 state captured WHOLE (matchup row, both result rows, the queue
-- for week 1) and the standings, so C6/C7 are byte comparisons.
select set_config('pgtap.rs_w1_before',
  (select (select row_to_json(m)::text from matchups m where m.id = 'd8900000-0000-4000-8000-000000000001')
     || ' || ' || (select string_agg(row_to_json(r)::text, ' ; ' order by r.team_id) from team_week_results r
                   where r.league_id = 'b8900000-0000-4000-8000-00000000000a' and r.week = 1)
     || ' || queued=' || (select count(*) from score_fanout where season = 2026 and week = 1)), true);
select set_config('pgtap.rs_standings_before',
  public.league_standings_internal('b8900000-0000-4000-8000-00000000000a', false)::text, true);
select ok(current_setting('pgtap.rs_w1_before') like '%101.50%88.25%queued=0'
          and current_setting('pgtap.rs_standings_before') like '%c8900000-0000-4000-8000-000000000001%',
  'B7 PREMISE: the before-captures are real — the week-1 capture carries both stored scores and an empty queue, and the standings carry T1');

-- ---------------------------------------------------------------------------
-- C. THE CORE — LA: week 1 FINAL, week 2 LIVE; Full PPR with rescore = true.
--    Every rescore = true call against a league with a final week (C, D2, E,
--    G1) is captured through a handler, so a probe that restores the refusal
--    reds the cells BY NAME instead of aborting the suite.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "8e900000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
do $$
begin
  perform set_config('pgtap.rs_c',
    (select public.commish_change_setting('b8900000-0000-4000-8000-00000000000a',
       'scoring_system_id', to_jsonb((select id::text from public.scoring_systems where is_template and name = 'ESPN Full PPR')),
       true, 'PPR from this week on',
       '08900000-0000-4000-8000-000000000001'::uuid)::text), true);
exception when others then
  perform set_config('pgtap.rs_c', jsonb_build_object('error', sqlerrm)::text, true);
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

select is((current_setting('pgtap.rs_c')::jsonb ->> 'no_changes') || '|' || coalesce(current_setting('pgtap.rs_c')::jsonb ->> 'error', 'no error'),
  'false|no error',
  'C1 THE SCORING CHANGE WITH rescore = true LANDS although week 1 is FINAL — under 129/131 this call was refused whole (probe P1: restore the RAISE ⇒ red)');
select is((select (scoring_system_id = (select id from scoring_systems where is_template and name = 'ESPN Full PPR'))::text
                  || '|' || (scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Full PPR'))::text
           from leagues where id = 'b8900000-0000-4000-8000-00000000000a'),
  'true|true', 'C2 …the reference AND the frozen snapshot are Full PPR now (§7.3.3 re-freeze, one statement) — the new rules govern the open week and every later week');
select is((select string_agg(f.player_id || '@' || (f.enqueued_at = ps.updated_at)::text, ',' order by f.player_id)
           from score_fanout f join player_stats ps on ps.player_id = f.player_id and ps.season = f.season and ps.week = f.week
           where f.season = 2026 and f.week = 2),
  'rs-qb1@true,rs-qb2@true,rs-rb1@true',
  'C3 WEEK 2 (the open week) IS QUEUED FOR RE-SCORING under the new rules: one score_fanout row per starter, each stamped with his OWN stat-line updated_at (probe P1 ⇒ red)');
select is(current_setting('pgtap.rs_c')::jsonb -> 'consequences' -> 'rescored_weeks',
  '[{"week": 2, "status": "live", "starters_enqueued": 3, "score_not_enqueued": []}]'::jsonb,
  'C4 …and the document names exactly week 2 as re-scored, its status and the count — week 1 is not in it (probe P2 ⇒ red)');
select is((select count(*)::int from score_fanout where season = 2026 and week = 1),
  0, 'C5 NOTHING IS QUEUED FOR FINAL WEEK 1 — the starters of week 1 carry stamped lines, so an empty queue is the verb skipping the week, not missing data (probe P2 ⇒ red)');
select is(
  (select (select row_to_json(m)::text from matchups m where m.id = 'd8900000-0000-4000-8000-000000000001')
     || ' || ' || (select string_agg(row_to_json(r)::text, ' ; ' order by r.team_id) from team_week_results r
                   where r.league_id = 'b8900000-0000-4000-8000-00000000000a' and r.week = 1)
     || ' || queued=' || (select count(*) from score_fanout where season = 2026 and week = 1)),
  current_setting('pgtap.rs_w1_before'),
  'C6 WEEK 1 IS BYTE-IDENTICAL: its matchup row, both result rows and its (empty) queue, compared whole against the pre-call capture — finished weeks keep their original scores and results (probe P2 ⇒ red)');
select is((select home_score || '|' || away_score || '|' || result || '|' || status from matchups where id = 'd8900000-0000-4000-8000-000000000001')
          || ' ' || (select string_agg(points || '/' || h2h_result, ',' order by team_id) from team_week_results
                     where league_id = 'b8900000-0000-4000-8000-00000000000a' and week = 1)
          || ' ' || (select status from league_weeks where league_id = 'b8900000-0000-4000-8000-00000000000a' and week = 1),
  '101.50|88.25|home|final 101.50/win,88.25/loss final',
  'C7 …and against the STORED LITERALS of B2/B3: 101.50 - 88.25, home won, 101.50 win / 88.25 loss, and the week is still final');
select is(public.league_standings_internal('b8900000-0000-4000-8000-00000000000a', false)::text,
  current_setting('pgtap.rs_standings_before'),
  'C8 …and the STANDINGS are byte-identical to the pre-call read');
select is(current_setting('pgtap.rs_c')::jsonb -> 'rescore_skipped_final_weeks',
  '[1]'::jsonb, 'C9 THE DOCUMENT NAMES WEEK 1 AS SKIPPED, at the top level (rescore_skipped_final_weeks) — never a quiet partial (probe P3 ⇒ red)');
select is(current_setting('pgtap.rs_c')::jsonb ->> 'rescore_skipped_final_weeks_why',
  'final_weeks_not_rescored — final week(s) [1] keep their original scores and results; the new scoring applies to open week(s) [2] (queued for re-scoring now) and to every later week (scored under it when it opens)',
  'C10 …with WHY in plain words, naming the kept week and the re-scored one');
select is((current_setting('pgtap.rs_c')::jsonb ->> 'rescore_performed') || '|' || coalesce(current_setting('pgtap.rs_c')::jsonb ->> 'rescore_not_performed_why', 'null'),
  'true|null', 'C11 …rescore_performed = true and NO not-performed reason: the open week WAS re-queued');
select is(
  (current_setting('pgtap.rs_c')::jsonb -> 'consequences' -> 'rescore_skipped_final_weeks')::text || '|'
  || (current_setting('pgtap.rs_c')::jsonb -> 'consequences' ->> 'rescore_upcoming_weeks_why'),
  '[1]|upcoming weeks are not queued — nothing has been scored for them; each is scored under the new scoring when it opens',
  'C12 …consequences repeats the skipped week, and SAYS why upcoming week 3 was not queued (the task: say so in the result)');
select is((select count(*)::int || '|' || string_agg((metadata -> 'rescore_skipped_final_weeks')::text || '|' || (metadata ->> 'rescore_performed'), ',')
           from commissioner_actions where league_id = 'b8900000-0000-4000-8000-00000000000a'),
  '1|[1]|true', 'C13 ONE commissioner_actions row, and the receipt carries the skipped week and the performed rescore');
select is((select count(*)::int || '|' || string_agg(message, '') from league_chat
           where league_id = 'b8900000-0000-4000-8000-00000000000a' and is_system),
  '1|Setting scoring_system_id changed from "' || (select id::text from scoring_systems where is_template and name = 'ESPN Standard')
    || '" to "' || (select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')
    || '" by rs_user1 (commissioner override) — open weeks will be re-scored under the new rules; final week(s) [1] keep their original scores and results — reason: PPR from this week on',
  'C14 ONE §10.3 post, and it tells the league the final week keeps its scores');
select is((select count(*)::int from commish_setting_actions where action_id = '08900000-0000-4000-8000-000000000001'),
  1, 'C15 …and ONE ledger row');

-- ---------------------------------------------------------------------------
-- D. rescore = false UNCHANGED, and the NO-OPEN-WEEK arm (LC: 1 final, 2 upcoming).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "8e900000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.rs_d1',
  (select public.commish_change_setting('b8900000-0000-4000-8000-00000000000c',
     'scoring_system_id', to_jsonb((select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')),
     false, null, '08900000-0000-4000-8000-000000000002'::uuid)::text), true);
do $$
begin
  perform set_config('pgtap.rs_d2',
    (select public.commish_change_setting('b8900000-0000-4000-8000-00000000000c',
       'scoring_system_id', to_jsonb((select id::text from public.scoring_systems where is_template and name = 'Sleeper Standard')),
       true, null, '08900000-0000-4000-8000-000000000003'::uuid)::text), true);
exception when others then
  perform set_config('pgtap.rs_d2', jsonb_build_object('error', sqlerrm)::text, true);
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (current_setting('pgtap.rs_d1')::jsonb ->> 'rescore_performed') || '|' || (current_setting('pgtap.rs_d1')::jsonb ->> 'rescore_not_performed_why'),
  'false|not_requested — rescore was not asked for: 1 final week(s) [1] keep their stored scores, and 0 open week(s) [] keep the points already computed under the PREVIOUS snapshot',
  'D1 rescore = false is UNCHANGED: not performed, and 131 wording for why is kept byte-for-byte');
select is(
  (current_setting('pgtap.rs_d1')::jsonb -> 'rescore_skipped_final_weeks')::text || '|' || coalesce(current_setting('pgtap.rs_d1')::jsonb ->> 'rescore_skipped_final_weeks_why', 'null'),
  '[]|null', 'D2 …and with rescore NOT asked for, nothing is reported as SKIPPED (the list is empty, the why NULL) — a skip is the answer to a rescore request only');
select is(
  (current_setting('pgtap.rs_d2')::jsonb ->> 'no_changes') || '|' || (current_setting('pgtap.rs_d2')::jsonb ->> 'rescore_performed')
  || '|' || (current_setting('pgtap.rs_d2')::jsonb -> 'rescore_skipped_final_weeks')::text,
  'false|false|[1]',
  'D3 THE NO-OPEN-WEEK ARM: rescore = true with final week 1 and nothing open LANDS (under 131: refused whole), performs nothing, and names week 1 as skipped');
select is(current_setting('pgtap.rs_d2')::jsonb ->> 'rescore_not_performed_why',
  'no_open_week — no week is open right now, so there is no score to re-score: final week(s) [1] keep their original scores and results, and every later week is scored under the new scoring when it opens',
  'D4 …and SAYS why nothing was re-scored — never the nothing_scored_yet text, which claims there is no final week');
select is(current_setting('pgtap.rs_d2')::jsonb ->> 'rescore_skipped_final_weeks_why',
  'final_weeks_not_rescored — final week(s) [1] keep their original scores and results; the new scoring applies to every later week (scored under it when it opens) — no week is open right now',
  'D5 …and the skipped-week why does not claim an open week was queued');
select is((select message from league_chat where league_id = 'b8900000-0000-4000-8000-00000000000c' and is_system
             and message like '% to "' || (select id::text from scoring_systems where is_template and name = 'Sleeper Standard') || '" %'),
  'Setting scoring_system_id changed from "' || (select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')
    || '" to "' || (select id::text from scoring_systems where is_template and name = 'Sleeper Standard')
    || '" by rs_user1 (commissioner override) — final week(s) [1] keep their original scores and results',
  'D6 …and its post names the kept final week (no reason given ⇒ no reason clause, Q66)');
select is((select string_agg(action_type || ':' || (metadata ->> 'rescore_requested'), ',' order by created_at, metadata ->> 'action_id')
           from commissioner_actions where league_id = 'b8900000-0000-4000-8000-00000000000c'),
  'change_setting:false,change_setting:true', 'D7 …two landings, two receipts');

-- ---------------------------------------------------------------------------
-- E. A CORRECTION_WINDOW WEEK IS RE-SCORED (LB: 1 final, 2 correction_window,
--    3 live). The reading flagged for the reviewer: open = live +
--    correction_window; only FINAL is kept.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "8e900000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
do $$
begin
  perform set_config('pgtap.rs_e',
    (select public.commish_change_setting('b8900000-0000-4000-8000-00000000000b',
       'scoring_system_id', to_jsonb((select id::text from public.scoring_systems where is_template and name = 'ESPN Full PPR')),
       true, null, '08900000-0000-4000-8000-000000000004'::uuid)::text), true);
exception when others then
  perform set_config('pgtap.rs_e', jsonb_build_object('error', sqlerrm)::text, true);
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
select is(current_setting('pgtap.rs_e')::jsonb -> 'consequences' -> 'rescored_weeks',
  '[{"week": 2, "status": "correction_window", "starters_enqueued": 1, "score_not_enqueued": []}, {"week": 3, "status": "live", "starters_enqueued": 1, "score_not_enqueued": []}]'::jsonb,
  'E1 BOTH open weeks are re-scored — the CORRECTION_WINDOW week 2 and the live week 3 (probe P4: skip correction_window ⇒ red)');
select is((select string_agg(week || ':' || player_id, ',' order by week) from score_fanout where season = 2026 and player_id = 'rs-qb3'),
  '2:rs-qb3,3:rs-qb3', 'E2 …the queue holds rs-qb3 for weeks 2 and 3, and NOT for final week 1 (his week-1 line is stamped) (probe P4 ⇒ red)');
select is((current_setting('pgtap.rs_e')::jsonb -> 'rescore_skipped_final_weeks')::text || '|' || (current_setting('pgtap.rs_e')::jsonb ->> 'rescore_skipped_final_weeks_why'),
  '[1]|final_weeks_not_rescored — final week(s) [1] keep their original scores and results; the new scoring applies to open week(s) [2, 3] (queued for re-scoring now) and to every later week (scored under it when it opens)',
  'E3 …and only week 1 — the one FINAL week — is named as skipped; the correction_window week is named among the open ones');

-- ---------------------------------------------------------------------------
-- F. NO FINAL WEEK AT ALL (LD) — behaviour as before; nothing reported skipped.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "8e900000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.rs_f',
  (select public.commish_change_setting('b8900000-0000-4000-8000-00000000000d',
     'scoring_system_id', to_jsonb((select id::text from scoring_systems where is_template and name = 'ESPN Full PPR')),
     true, null, '08900000-0000-4000-8000-000000000005'::uuid)::text), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (current_setting('pgtap.rs_f')::jsonb ->> 'rescore_performed') || '|' || (current_setting('pgtap.rs_f')::jsonb -> 'consequences' -> 'rescored_weeks')::text,
  'true|[{"week": 1, "status": "live", "starters_enqueued": 1, "score_not_enqueued": []}]',
  'F1 with no final week the rescore is performed exactly as before 141 (077 G15-G20 pin the rest)');
select is(
  (current_setting('pgtap.rs_f')::jsonb -> 'rescore_skipped_final_weeks')::text || '|' || coalesce(current_setting('pgtap.rs_f')::jsonb ->> 'rescore_skipped_final_weeks_why', 'null')
  || '|' || (select message not like '%final week%' from league_chat where league_id = 'b8900000-0000-4000-8000-00000000000d' and is_system)::text,
  '[]|null|true', 'F2 …nothing is reported as skipped, and the post says nothing about final weeks');
select is((select string_agg(week || ':' || player_id, ',') from score_fanout where season = 2026 and player_id = 'rs-qb6'),
  '1:rs-qb6', 'F3 …and the live week 1 starter is queued');

-- ---------------------------------------------------------------------------
-- G. REPLAY — the landed action returns its document byte-identically, with a
--    different request, and writes nothing.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "8e900000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
do $$
begin
  perform set_config('pgtap.rs_g',
    (select public.commish_change_setting('b8900000-0000-4000-8000-00000000000a',
       'scoring_system_id', to_jsonb((select id::text from public.scoring_systems where is_template and name = 'Sleeper Standard')),
       true, 'a different request', '08900000-0000-4000-8000-000000000001'::uuid)::text), true);
exception when others then
  perform set_config('pgtap.rs_g', jsonb_build_object('error', sqlerrm)::text, true);
end $$;
select is(current_setting('pgtap.rs_g'),
  current_setting('pgtap.rs_c'),
  'G1 REPLAY: the action id of section C returns its document byte-identically, skipped week included');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select (scoring_system_id = (select id from scoring_systems where is_template and name = 'ESPN Full PPR'))::text
                  || '|' || (select count(*) from commissioner_actions where league_id = 'b8900000-0000-4000-8000-00000000000a')
           from leagues where id = 'b8900000-0000-4000-8000-00000000000a'),
  'true|1', 'G2 …and wrote nothing: still Full PPR, still one receipt');

select * from finish();
rollback;
