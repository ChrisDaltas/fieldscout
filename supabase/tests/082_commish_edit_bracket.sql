-- ============================================================================
-- pgTAP 082 — migration 134: `commish_edit_bracket` (hand-pick a playoff
-- matchup) + `playoff_bracket_sync_internal`'s STAND-DOWN hunk +
-- `playoff_bracket_state_internal`'s `hand_picked_action_id`
-- (task L.E1.16 of M6A; tasks-M6A §6 "L.E1.16 (proposed)" PROOF: *"a
-- hand-picked pairing SURVIVES a subsequent playoff_bracket_sync_internal run
-- (the cell that does not exist today); the subset re-validation refuses a
-- team from outside the round by name; 078's F3b pair stays as the
-- contrast"*; §4 rules 1-15, D336 / D350 / D353; PROGRESS F360 (RULED
-- WANTED, R1047), standing rule (a)/(b)/(g)/(i); spec §11.5, §10.3, §22.2.)
--
-- WHAT THIS SUITE IS ORGANISED TO PROVE:
--   §A  form pins — the mark column (an FK to the audit log), the ledger
--       (D350: zero policies, TRUNCATE denied per role), the door and the
--       internal (posture + grants), the two replaced functions carry their
--       hunks and only one overload each; `league_playoff_bracket` (the
--       read) pinned byte-identical by its md5.
--   §B  the fixture — 066's P1 walked through the JOBS (finalize, open,
--       rollover) to a BUILT provisional round 1 (week 7) and its PREMISES
--       (§4 rule 14(c)): the round string, the statuses, zero receipts.
--   §C  THE HAND-PICK (a pairing swap): the round rewritten with seeds
--       following their teams; ONE receipt, ONE post, the ledger row; the
--       stand-down NAMED in `bypassed[]`; every seeded row MARKED.
--   §D  ***SURVIVAL — the cell that does not exist today, and BREAK PROBE 1's
--       TARGET***: the sync at the rollover instant reports `round_hand_
--       picked` and rewrites nothing; the week opens; the CORRECTION CLOSE
--       (§11.5 (E) — the rebuild that overwrote a landed edit before 134)
--       finalizes week 6 and leaves the round as picked; the member read
--       carries the mark on each week entry.
--   §E  THE BYE ARM: a bye row given an opponent; the displaced pairing
--       normalised to a bye (home side, seed kept); the lifted TIMING gates
--       named now that the week is live; the mark RE-STAMPED.
--   §F  THE KEPT GATES, refused BY NAME: a team from OUTSIDE the round (the
--       task text's subset rule — ***BREAK PROBE 2's TARGET***), dropping a
--       team, emptying a pairing, a regular row, a seedless (foreign) row, a
--       league not in playoffs, a PLAYED pairing (target and sibling), the
--       shape errors, a foreign league's row.
--   §G  the NO-OP: `no_changes: true`, no receipt, no post, no re-stamp,
--       ledger row written.
--   §H  the reason (OPTIONAL — Q66): trimmed and posted when given, NULL when
--       whitespace; a home/away swap is a change (seeds follow).
--   §I  AUTH — one no-leak 42501.
--   §J  REPLAY — byte-identical, nothing re-written.
--   §K  DOWNSTREAM: the hand-picked round is PLAYED and rolls; round 2 is
--       built by the ENGINE from the hand-picked round's survivors (the
--       next round is never the commissioner's by inheritance).
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(115);

-- ---------------------------------------------------------------------------
-- A. FORM PINS
-- ---------------------------------------------------------------------------
select has_column('public', 'matchups', 'pairing_set_by_action_id', 'A1 matchups.pairing_set_by_action_id exists (134 §0)');
select col_is_null('public', 'matchups', 'pairing_set_by_action_id', 'A1b …nullable: NULL = the engine paired the round');
select fk_ok('public', 'matchups', 'pairing_set_by_action_id', 'public', 'commissioner_actions', 'id', 'A1c …an FK to the audit log (126:929''s posture for override_action_id)');
select is((select count(*)::int from matchups where pairing_set_by_action_id is not null), 0, 'A1d PREMISE: no row carries the mark on a fresh chain');

select has_table('public', 'commish_bracket_actions', 'A2 the ledger exists (D350)');
select is((select relrowsecurity from pg_class where oid = 'public.commish_bracket_actions'::regclass), true, 'A2b …RLS enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'commish_bracket_actions'), 0, 'A2c …ZERO policies');
select ok(not has_table_privilege('anon', 'public.commish_bracket_actions', 'TRUNCATE')
      and not has_table_privilege('authenticated', 'public.commish_bracket_actions', 'TRUNCATE'), 'A2d …TRUNCATE denied to anon AND authenticated (per role)');
select col_is_unique('public', 'commish_bracket_actions', array['league_id', 'action_id'], 'A2e …UNIQUE (league_id, action_id)');

select has_function('public', 'commish_edit_bracket', array['uuid', 'uuid', 'uuid', 'uuid', 'text', 'uuid'], 'A3 the door exists with 130:781''s argument order');
select is((select prosecdef from pg_proc where proname = 'commish_edit_bracket'), true, 'A3b …SECURITY DEFINER');
select ok(has_function_privilege('authenticated', 'public.commish_edit_bracket(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.commish_edit_bracket(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE'), 'A3c …authenticated may call it, anon may not');
select has_function('public', 'commish_edit_bracket_internal', array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'timestamptz', 'text'], 'A4 the internal exists, taking p_at');
select is((select prosecdef from pg_proc where proname = 'commish_edit_bracket_internal'), false, 'A4b …PLAIN (not DEFINER)');
select ok(not has_function_privilege('authenticated', 'public.commish_edit_bracket_internal(uuid,uuid,uuid,uuid,uuid,timestamptz,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.commish_edit_bracket_internal(uuid,uuid,uuid,uuid,uuid,timestamptz,text)', 'EXECUTE'), 'A4c …REVOKEd from anon and authenticated');
select is((select count(*)::int from pg_proc where proname in ('commish_edit_bracket', 'commish_edit_bracket_internal', 'playoff_bracket_sync_internal', 'playoff_bracket_state_internal', 'league_playoff_bracket')), 5,
  'A5 one overload each (five names, five functions)');
select is((select (prosrc like '%round_hand_picked%')::text || ':' || (prosrc like '%rebuild_refused_round_played%')::text || ':' || (prosrc like '%DELETE FROM public.matchups m%')::text
           from pg_proc where proname = 'playoff_bracket_sync_internal'), 'true:true:true',
  'A6 the sync carries the stand-down hunk AND still carries R839''s refusal and 118''s DELETE (one hunk added, nothing removed)');
select is((select prosrc like '%''hand_picked_action_id'', m.pairing_set_by_action_id%' from pg_proc where proname = 'playoff_bracket_state_internal'), true,
  'A7 the state carries hand_picked_action_id on each week entry');
select is((select md5(prosrc) from pg_proc where proname = 'league_playoff_bracket'), 'f1ee89320e303eb67314cad303549b0e',
  'A8 league_playoff_bracket (the member read) is BYTE-IDENTICAL to its pre-134 self (stored literal)');
select is((select count(*)::int from pg_proc where proname = 'commish_edit_schedule_internal' and prosrc like '%Hand-picking playoff matchups is a planned commissioner feature%'), 1,
  'A9 130''s bracket refusal in commish_edit_schedule is UNTOUCHED (078 F3b stays as the contrast — the regular-season verb still refuses a bracket row by name)');

-- ---------------------------------------------------------------------------
-- B. FIXTURES — 066's P1 (8 franchises A-H, H retired, playoff_teams 6,
--    one-week rounds, reseed on), walked through the jobs to a BUILT
--    provisional round 1 in week 7. u1 commissioner (team A), u2 manager
--    (team B), u3 an outsider. L2 is a second league still in_season with a
--    hand-inserted SEEDED playoff row (for §F's status refusal).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9e000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-eb' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'eb_user' || i)::jsonb, now(), now()
from generate_series(1, 3) i;

update nfl_weeks set first_kickoff_at = null, last_game_ends_at = null where season = 2026;
update nfl_weeks set last_game_ends_at = starts_at + interval '6 days' where season = 2026 and week in (1, 2);
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00', last_game_ends_at = '2026-10-06 04:00:00+00', correction_window_ends_at = '2026-10-08 10:00:00+00' where season = 2026 and week = 4;
update nfl_weeks set starts_at = '2026-10-07 04:00:00+00', last_game_ends_at = '2026-10-13 04:00:00+00', correction_window_ends_at = '2026-10-15 10:00:00+00' where season = 2026 and week = 5;
update nfl_weeks set starts_at = '2026-10-14 04:00:00+00', last_game_ends_at = '2026-10-20 04:00:00+00', correction_window_ends_at = '2026-10-22 10:00:00+00' where season = 2026 and week = 6;
update nfl_weeks set starts_at = '2026-10-21 04:00:00+00', last_game_ends_at = '2026-10-27 04:00:00+00', correction_window_ends_at = '2026-10-29 10:00:00+00' where season = 2026 and week = 7;
update nfl_weeks set starts_at = '2026-10-28 04:00:00+00', last_game_ends_at = '2026-11-03 04:00:00+00', correction_window_ends_at = '2026-11-05 10:00:00+00' where season = 2026 and week = 8;
update nfl_weeks set starts_at = '2026-11-04 04:00:00+00', last_game_ends_at = '2026-11-10 04:00:00+00', correction_window_ends_at = '2026-11-12 10:00:00+00' where season = 2026 and week = 9;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status)
select 'eb-w' || w, 2026, w, 'BUF', 'KC', (select starts_at + interval '2 days' from nfl_weeks where season = 2026 and week = w), 'final'
from generate_series(3, 9) w;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'pgtap-eb-L1', 2026, 'in_season', 8, 4, 6, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "schedule_seed": 134134, "playoff_weeks_per_round": 1, "playoff_reseed": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 'pgtap-eb-L2', 2026, 'in_season', 8, 10, 2, 13,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "schedule_seed": 2}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id)
select ('ce000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, '9e000000-0000-4000-8000-000000000001', 'EB ' || chr(64 + i), 'be000000-0000-4000-8000-000000000001'
from generate_series(1, 8) i;
update teams set status = 'retired' where id = 'ce000000-0000-4000-8000-000000000008';
insert into teams (id, owner_id, name, league_id) values
 ('ce000000-0000-4000-8000-000000000021', '9e000000-0000-4000-8000-000000000001', 'EB W', 'be000000-0000-4000-8000-000000000002'),
 ('ce000000-0000-4000-8000-000000000022', '9e000000-0000-4000-8000-000000000001', 'EB X', 'be000000-0000-4000-8000-000000000002');

insert into league_members (league_id, user_id, team_id, role) values
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'commissioner'),
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', 'manager'),
 ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000021', 'commissioner');

insert into league_weeks (league_id, season, week) select 'be000000-0000-4000-8000-000000000001', 2026, g from generate_series(3, 9) g;
update league_weeks set status = 'live'              where league_id = 'be000000-0000-4000-8000-000000000001' and week between 3 and 5;
update league_weeks set status = 'correction_window' where league_id = 'be000000-0000-4000-8000-000000000001' and week between 3 and 5;
insert into league_weeks (league_id, season, week) select 'be000000-0000-4000-8000-000000000002', 2026, g from generate_series(3, 13) g;

-- L1 (A=01 … H=08) — 066 P1's regular season, verbatim in shape.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status) values
 ('de000000-0000-4000-8000-000000000131', 'be000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 100.00,  90.00, 'live'),
 ('de000000-0000-4000-8000-000000000132', 'be000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000004', 100.00,  80.00, 'live'),
 ('de000000-0000-4000-8000-000000000133', 'be000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006',  95.00,  85.00, 'live'),
 ('de000000-0000-4000-8000-000000000134', 'be000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'ce000000-0000-4000-8000-000000000007', 'ce000000-0000-4000-8000-000000000008',  70.00, 110.00, 'live'),
 ('de000000-0000-4000-8000-000000000141', 'be000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 100.00,  90.00, 'live'),
 ('de000000-0000-4000-8000-000000000142', 'be000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000004', 100.00,  70.00, 'live'),
 ('de000000-0000-4000-8000-000000000143', 'be000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000007', 100.00,  80.00, 'live'),
 ('de000000-0000-4000-8000-000000000144', 'be000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000008',  90.00, 120.00, 'live'),
 ('de000000-0000-4000-8000-000000000151', 'be000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004', 110.00, 100.00, 'live'),
 ('de000000-0000-4000-8000-000000000152', 'be000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003',  80.00, 100.00, 'live'),
 ('de000000-0000-4000-8000-000000000153', 'be000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000008',  90.00, 130.00, 'live'),
 ('de000000-0000-4000-8000-000000000154', 'be000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000007', 100.00,  95.00, 'live'),
 ('de000000-0000-4000-8000-000000000161', 'be000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000005', 100.00,  90.00, 'scheduled'),
 ('de000000-0000-4000-8000-000000000162', 'be000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000006', 100.00,  70.00, 'scheduled'),
 ('de000000-0000-4000-8000-000000000163', 'be000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000007',  90.00,  95.00, 'scheduled'),
 ('de000000-0000-4000-8000-000000000164', 'be000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'ce000000-0000-4000-8000-000000000004', 'ce000000-0000-4000-8000-000000000008', 100.00, 105.00, 'scheduled');
-- L2: a SEEDED playoff row in a league that is still in_season (§F6).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_seed, away_seed, status) values
 ('de000000-0000-4000-8000-000000000271', 'be000000-0000-4000-8000-000000000002', 2026, 13, 'playoff', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000022', 1, 2, 'scheduled');

-- Renderers (066's).
create or replace function pg_temp.eb_round(p_first int, p_last int) returns text language sql as $$
  select string_agg(g, ',' order by seed)
  from (select distinct m.home_seed as seed,
               m.home_seed || ':' || right(m.home_team_id::text, 2) || 'v' ||
               coalesce(m.away_seed || ':' || right(m.away_team_id::text, 2), 'bye') as g
        from matchups m
        where m.league_id = 'be000000-0000-4000-8000-000000000001' and m.season = 2026 and m.week between p_first and p_last and m.round_type = 'playoff') r
$$;
create or replace function pg_temp.eb_marks(p_first int, p_last int) returns text language sql as $$
  select coalesce(string_agg(coalesce(right(m.pairing_set_by_action_id::text, 4), 'none'), ',' order by m.week, m.home_seed), '')
  from matchups m
  where m.league_id = 'be000000-0000-4000-8000-000000000001' and m.season = 2026 and m.week between p_first and p_last and m.round_type = 'playoff'
$$;
create or replace function pg_temp.eb_brackets(p_league uuid) returns jsonb language sql as $$
  select coalesce((select x from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'brackets') x where x ->> 'league_id' = p_league::text limit 1), '{}'::jsonb)
$$;
create or replace function pg_temp.eb_m(p_seed int) returns uuid language sql as $$
  select id from matchups where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7 and round_type = 'playoff' and home_seed = p_seed
$$;
create or replace function pg_temp.eb_ca() returns int language sql as $$
  select count(*)::int from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001'
$$;
create or replace function pg_temp.eb_chat() returns int language sql as $$
  select count(*)::int from league_chat where league_id = 'be000000-0000-4000-8000-000000000001'
$$;

-- The jobs walk L1 to a built round 1 (066 §E-§G's instants).
select set_config('pgtap.r', public.finalize_matchups('2026-10-15 10:00:00+00')::text, true);
select set_config('pgtap.r', public.league_week_advance('2026-10-14 04:00:00+00')::text, true);
select set_config('pgtap.r', public.league_week_advance('2026-10-20 04:00:00+00')::text, true);

-- PREMISES.
select is((pg_temp.eb_brackets('be000000-0000-4000-8000-000000000001') ->> 'action') || ':' || (pg_temp.eb_brackets('be000000-0000-4000-8000-000000000001') ->> 'round') || ':' || (pg_temp.eb_brackets('be000000-0000-4000-8000-000000000001') ->> 'source'),
  'built:1:provisional', 'B1 PREMISE: L1 round 1 BUILT provisional at week 6''s rollover (the engine''s own write, 118)');
select is(pg_temp.eb_round(7, 7), '1:01vbye,2:03vbye,3:05v6:07,4:02v5:06',
  'B2 PREMISE: the engine''s round 1 — A, C bye; E(3) v G(6); B(4) v F(5) (066 G4b''s shape)');
select is((select status from leagues where id = 'be000000-0000-4000-8000-000000000001'), 'playoffs', 'B3 PREMISE: L1 is in playoffs');
select is((select string_agg(status, ',' order by home_seed) || '|' || (select status from league_weeks where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7) from matchups where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7),
  'scheduled,scheduled,scheduled,scheduled|upcoming', 'B4 PREMISE: four scheduled rows in an upcoming week 7 (no timing gate engaged yet)');
select is((select free from public.schedule_window_internal(2026, 7, '2026-10-20 05:00:00+00')), true, 'B5 PREMISE: week 7 has not kicked off at 2026-10-20 05:00 (eb-w7 kicks off 10-23)');
select is(pg_temp.eb_ca() || ':' || pg_temp.eb_chat() || ':' || (select count(*)::int from commish_bracket_actions), '0:0:0',
  'B6 PREMISE: zero receipts, zero posts, zero ledger rows — every row counted below is this suite''s');
select is(pg_temp.eb_marks(7, 7), 'none,none,none,none', 'B7 PREMISE: no row of round 1 is marked');
select is(public.playoff_bracket_sync_internal('be000000-0000-4000-8000-000000000001', '2026-10-20 04:00:00+00'), '{"round": 1, "reason": "round_in_progress", "source": "provisional"}'::jsonb,
  'B8 PREMISE: the sync reads the engine''s round as in progress (stored = desired) — the state §D contrasts against');

-- ---------------------------------------------------------------------------
-- C. THE HAND-PICK — E(3) v G(6) becomes E v F; F''s pairing takes G.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.c1', public.commish_edit_bracket(
  'be000000-0000-4000-8000-000000000001', pg_temp.eb_m(3),
  'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006',
  null, 'a1000000-0000-4000-8000-000000000001')::text, true);
select set_config('request.jwt.claims', '', true);
select is(pg_temp.eb_round(7, 7), '1:01vbye,2:03vbye,3:05v5:06,4:02v6:07',
  'C1 THE PAIRING: E(3) v F(5), B(4) v G(6) — the displaced G took the slot F vacated; every seed followed its team (rider (iii))');
select is((current_setting('pgtap.c1')::jsonb ->> 'no_changes') || ':' || (current_setting('pgtap.c1')::jsonb ->> 'rows_changed') || ':' || (current_setting('pgtap.c1')::jsonb ->> 'rows_marked') || ':' || (current_setting('pgtap.c1')::jsonb ->> 'round'),
  'false:2:4:1', 'C2 the document: a change, 2 rows rewritten (target + one sibling), 4 rows marked (the whole round), round 1');
select is(current_setting('pgtap.c1')::jsonb -> 'bypassed', '["bracket_sync_rebuild:stood_down"]'::jsonb,
  'C3 bypassed[] names the re-seed it told to stand down — and nothing else (no timing gate was engaged: B4/B5)');
select is(current_setting('pgtap.c1')::jsonb -> 'matchup' -> 'after', '{"away_seed": 5, "home_seed": 3, "away_team_id": "ce000000-0000-4000-8000-000000000006", "home_team_id": "ce000000-0000-4000-8000-000000000005"}'::jsonb,
  'C4 matchup.after echoes the request with the teams'' own seeds (the F65(b) identity the route compares)');
select is((select string_agg(e #>> '{}', ',' order by e #>> '{}') from jsonb_array_elements(current_setting('pgtap.c1')::jsonb -> 'affected_team_ids') e),
  'ce000000-0000-4000-8000-000000000002,ce000000-0000-4000-8000-000000000005,ce000000-0000-4000-8000-000000000006,ce000000-0000-4000-8000-000000000007',
  'C5 affected_team_ids (D353): B, E, F, G — both pairings, before and after');
select is(pg_temp.eb_ca() || ':' || pg_temp.eb_chat() || ':' || (select count(*)::int from commish_bracket_actions), '1:1:1',
  'C6 EXACTLY ONE receipt, ONE post, ONE ledger row');
select is((select action_type || ':' || target_type || ':' || target_id || ':' || coalesce(reason, 'NULL') || ':' || (metadata ->> 'verb') || ':' || (metadata ->> 'round') || ':' || (metadata -> 'bypassed')::text
           from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001'),
  'edit_bracket:bracket:' || pg_temp.eb_m(3)::text || ':NULL:commish_edit_bracket:1:["bracket_sync_rebuild:stood_down"]',
  'C7 the receipt: edit_bracket / bracket / the matchup / NULL reason (Q66) / the stand-down in metadata.bypassed');
select is((select before || after from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001') - 'home_seed' - 'away_seed',
  '{"away_team_id": "ce000000-0000-4000-8000-000000000006", "home_team_id": "ce000000-0000-4000-8000-000000000005"}'::jsonb,
  'C7b …after = the request (before carried G; the merge shows after''s away)');
select is((select before ->> 'away_team_id' from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001'), 'ce000000-0000-4000-8000-000000000007',
  'C7c …before carried G at away');
select is((select id from commissioner_actions where league_id = 'be000000-0000-4000-8000-000000000001'), (current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id')::uuid,
  'C8 commissioner_action_id IS the receipt');
select is(pg_temp.eb_marks(7, 7), repeat(right((current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id'), 4) || ',', 3) || right((current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id'), 4),
  'C9 EVERY seeded row of the round carries the mark = the receipt''s id (the two untouched bye rows too — the round is his as a whole)');
select is((select message from league_chat where league_id = 'be000000-0000-4000-8000-000000000001'),
  'Playoff round 1 (week 7) matchup hand-picked by eb_user1 (commissioner override): EB E vs EB F (was EB E vs EB G); EB B vs EB G (was EB B vs EB F) — lifted: bracket_sync_rebuild:stood_down',
  'C10 the §10.3 post: before/after for the target AND the sibling, the stand-down named, NO reason clause (none given)');
select is((select is_system || ':' || context from league_chat where league_id = 'be000000-0000-4000-8000-000000000001'), 'true:league', 'C10b …a system post in the league context');
select is((current_setting('pgtap.c1')::jsonb -> 'scoring' ->> 'stored_cells_rewritten') || ':' || (current_setting('pgtap.c1')::jsonb ->> 'reason_required'), '0:false',
  'C11 scoring names 0 stored cells rewritten (the kept gate is the premise); reason_required false (Q66)');
select is((select string_agg(status, ',' order by home_seed) || '|' || string_agg(coalesce(home_score::text, 'null') || '/' || coalesce(away_score::text, 'null'), ',' order by home_seed) from matchups where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7),
  'scheduled,scheduled,scheduled,scheduled|0/0,0/0,0/0,0/0', 'C12 the rows keep their status and their untouched default scores — the verb writes teams, seeds and the mark only');

-- ---------------------------------------------------------------------------
-- D. SURVIVAL — the cell that does not exist today. ***BREAK PROBE 1***
-- ---------------------------------------------------------------------------
select is(public.playoff_bracket_sync_internal('be000000-0000-4000-8000-000000000001', '2026-10-20 04:00:00+00') - 'set_by_action_id',
  '{"round": 1, "reason": "round_hand_picked", "source": "provisional", "weeks": [7, 7], "rows": 4}'::jsonb,
  'D1 THE SURVIVAL CELL: the sync at the rollover instant — where B8 said stored = desired and where a differing pairing was DELETEd and re-INSERTed before 134 (118:1573-1594) — now reports round_hand_picked and writes NOTHING');
select is(public.playoff_bracket_sync_internal('be000000-0000-4000-8000-000000000001', '2026-10-20 04:00:00+00') ->> 'set_by_action_id', current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id',
  'D1b …and names the receipt that set it');
select is(pg_temp.eb_round(7, 7) || '|' || (select count(*)::int from matchups where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7), '1:01vbye,2:03vbye,3:05v5:06,4:02v6:07|4',
  'D2 the hand-picked pairing STANDS — same four rows, same pairing');
select is(pg_temp.eb_marks(7, 7), repeat(right((current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id'), 4) || ',', 3) || right((current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id'), 4),
  'D2b …marks intact (no row was re-INSERTed)');
-- Week 7 opens (Wednesday): the rows go live with the week (116 (a)).
select set_config('pgtap.r', public.league_week_advance('2026-10-21 04:00:00+00')::text, true);
select is((select status from league_weeks where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7) || ':' || (select string_agg(status, ',' order by home_seed) from matchups where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7),
  'live:live,live,live,live', 'D3 week 7 opens for L1; the four hand-picked rows go live with it');
select is(current_setting('pgtap.r')::jsonb -> 'brackets' || (current_setting('pgtap.r')::jsonb -> 'bracket_blocked') || (current_setting('pgtap.r')::jsonb -> 'bracket_waiting') || (current_setting('pgtap.r')::jsonb -> 'bracket_failures'), '[]'::jsonb,
  'D3b …the advance payload carries NO bracket action, block, wait or failure for it — round_hand_picked is the every-hour normal, like round_in_progress');
-- THE CORRECTION CLOSE (§11.5 (E)) — the rebuild that rewrote a landed edit
-- before 134 (066 §H3). Week 6 finalizes; the round is left as picked.
select set_config('pgtap.r', public.finalize_matchups('2026-10-22 10:00:00+00')::text, true);
select is((select status from league_weeks where league_id = 'be000000-0000-4000-8000-000000000001' and week = 6), 'final', 'D4 the close AT: L1''s week 6 finalizes');
select is(pg_temp.eb_brackets('be000000-0000-4000-8000-000000000001'), '{}'::jsonb, 'D4b …NO bracket action for L1 at the close (066 H3''s `rebuilt:1:final` is exactly what a hand-picked round must not get)');
select is(pg_temp.eb_round(7, 7), '1:01vbye,2:03vbye,3:05v5:06,4:02v6:07', 'D4c …the pairing STANDS through the correction close');
select is((select status from leagues where id = 'be000000-0000-4000-8000-000000000001'), 'playoffs', 'D4d …league still in playoffs');
select is(public.playoff_bracket_sync_internal('be000000-0000-4000-8000-000000000001', '2026-10-22 10:00:00+00') ->> 'source', 'final',
  'D4e …the sync now reads the prior stage as FINAL and STILL stands down (source final, reason round_hand_picked)');
-- The member read carries the mark.
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select string_agg(coalesce(w ->> 'hand_picked_action_id', 'none'), ',' order by (g ->> 'home_seed')::int)
           from jsonb_array_elements(public.league_playoff_bracket('be000000-0000-4000-8000-000000000001') -> 'round_list' -> 0 -> 'games') g,
                jsonb_array_elements(g -> 'weeks') w),
  repeat((current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id') || ',', 3) || (current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id'),
  'D5 the member read (a MANAGER reading): every game''s week entry carries hand_picked_action_id = the receipt');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- E. THE BYE ARM — A(1)''s bye becomes A v B; B''s pairing (B v G) loses its
--    home side and is normalised to G''s bye. The week is LIVE now, so the
--    timing gates are engaged — lifted and NAMED.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.e1', public.commish_edit_bracket(
  'be000000-0000-4000-8000-000000000001', pg_temp.eb_m(1),
  'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
  null, 'a1000000-0000-4000-8000-000000000002')::text, true);
select set_config('request.jwt.claims', '', true);
select is(pg_temp.eb_round(7, 7), '1:01v4:02,2:03vbye,3:05v5:06,6:07vbye',
  'E1 A(1) v B(4); G(6) now holds the bye on the HOME side with its seed — two byes still, four pairings still');
select is((select string_agg(coalesce(away_seed::text, '-'), ',' order by home_seed) from matchups where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7 and round_type = 'playoff'), '4,-,5,-',
  'E1b …away_seed NULL on both bye rows (matchups_away_seed_needs_away_team holds)');
select is((select s ->> 'bye_normalised' || ':' || (s ->> 'home_after') || ':' || coalesce(s ->> 'away_after', 'null') || ':' || (s -> 'vacated_sides')::text
           from jsonb_array_elements(current_setting('pgtap.e1')::jsonb -> 'siblings') s),
  'true:ce000000-0000-4000-8000-000000000007:null:["home"]', 'E2 the sibling entry says the bye was normalised: G moved to home, away null, the home side vacated');
select is(current_setting('pgtap.e1')::jsonb -> 'bypassed', '["matchup_status_gate:live", "week_status_gate:7:live", "bracket_sync_rebuild:stood_down"]'::jsonb,
  'E3 bypassed[] names the LIVE row, the LIVE week (both TIMING gates — standing rule (i)) and the stand-down; the kickoff has not passed (the door reads now())');
select is(pg_temp.eb_marks(7, 7), repeat(right((current_setting('pgtap.e1')::jsonb ->> 'commissioner_action_id'), 4) || ',', 3) || right((current_setting('pgtap.e1')::jsonb ->> 'commissioner_action_id'), 4),
  'E4 every row RE-STAMPED with the newer receipt');
select isnt(current_setting('pgtap.e1')::jsonb ->> 'commissioner_action_id', current_setting('pgtap.c1')::jsonb ->> 'commissioner_action_id', 'E4b …a different receipt from §C''s');
select is(pg_temp.eb_ca() || ':' || pg_temp.eb_chat(), '2:2', 'E5 a second receipt and a second post');
select is((current_setting('pgtap.e1')::jsonb ->> 'system_post') || '|' || (select count(*)::int from league_chat where league_id = 'be000000-0000-4000-8000-000000000001' and message = current_setting('pgtap.e1')::jsonb ->> 'system_post'),
  'Playoff round 1 (week 7) matchup hand-picked by eb_user1 (commissioner override): EB A vs EB B (was EB A vs bye); EB G vs bye (was EB B vs EB G) — lifted: matchup_status_gate:live, week_status_gate:7:live, bracket_sync_rebuild:stood_down|1',
  'E6 the post says "bye" on both sides of the change (the document''s system_post, found exactly once in league_chat)');
-- The kickoff lock, through the internal at an instant AFTER eb-w7''s kickoff
-- (2026-10-23 04:00): named, not refused (standing rule (g)). A swap of the
-- two bye rows'' teams is the change (C(2) bye ↔ G(6) bye ⇒ C v G? no — that
-- would empty a pairing; instead E v F becomes F v E, a sides swap).
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.e7', public.commish_edit_bracket_internal(
  'be000000-0000-4000-8000-000000000001', pg_temp.eb_m(3),
  'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000005',
  'a1000000-0000-4000-8000-000000000003', '2026-10-24 12:00:00+00', null)::text, true);
select set_config('request.jwt.claims', '', true);
select is(current_setting('pgtap.e7')::jsonb -> 'bypassed', '["matchup_status_gate:live", "week_status_gate:7:live", "kickoff_lock:7", "bracket_sync_rebuild:stood_down"]'::jsonb,
  'E7 at an instant after week 7''s kickoff the lock is NAMED (kickoff_lock:7), never refused — the game-day lock does not bind the commissioner (standing rule (g), D335)');
select is(pg_temp.eb_round(7, 7), '1:01v4:02,2:03vbye,5:06v3:05,6:07vbye', 'E7b the sides swap: F(5) home, E(3) away — seeds followed (a home/away swap IS a change)');
select is((current_setting('pgtap.e7')::jsonb -> 'siblings')::text || ':' || (current_setting('pgtap.e7')::jsonb ->> 'rows_changed'), '[]:1', 'E7c …no sibling moved, one row rewritten');

-- ---------------------------------------------------------------------------
-- F. THE KEPT GATES — refused BY NAME. State: A v B, C bye, F v E, G bye.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.fa', pg_temp.eb_ca()::text, true);
-- F1 ***BREAK PROBE 2's TARGET*** — a team from OUTSIDE the round (D, rank 7).
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000004', null, 'a1000000-0000-4000-8000-0000000000f1') $$,
  '%team ce000000-0000-4000-8000-000000000004 is not in round 1 of league%the round''s entrants are the 6 teams seeded on its rows%',
  'F1 THE SUBSET RULE: a team not seeded in the round is refused BY NAME, naming the entrants — who qualifies is the standings'', not the commissioner''s here');
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000008', null, 'a1000000-0000-4000-8000-0000000000f2') $$,
  '%team ce000000-0000-4000-8000-000000000008 is not in round 1%', 'F1b …a RETIRED franchise likewise (never seeded — 117''s seated CTE)');
-- F2 dropping a team: F v E → F bye leaves E nowhere.
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000006', null, null, 'a1000000-0000-4000-8000-0000000000f3') $$,
  '%would drop ce000000-0000-4000-8000-000000000005 from round 1 — every entrant plays (or holds a bye) exactly once%',
  'F2 SHAPE: turning a pairing into a bye with nowhere for the displaced team is refused BY NAME (bracket arithmetic binds the commissioner too)');
-- F3 emptying a pairing: C's bye → C v G takes G off the only other bye row.
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(2), 'ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000007', null, 'a1000000-0000-4000-8000-0000000000f4') $$,
  '%would leave a round-1 pairing with NOBODY in it%a round keeps its 4 pairings%',
  'F3 SHAPE: pairing the two bye teams together would empty a slot — refused BY NAME');
-- F4 a regular-season row.
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000161', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000005', null, 'a1000000-0000-4000-8000-0000000000f5') $$,
  '%is a regular row — only playoff bracket rows are hand-picked here; a regular-season pairing is commish_edit_schedule''s (130)%',
  'F4 a regular row is 130''s — refused BY NAME pointing at the right verb (the mirror of 078 F3b)');
-- F5 a seedless (foreign) playoff row.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, status)
values ('de000000-0000-4000-8000-000000000179', 'be000000-0000-4000-8000-000000000001', 2026, 7, 'playoff', 'ce000000-0000-4000-8000-000000000004', null, 'scheduled');
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000179', 'ce000000-0000-4000-8000-000000000004', null, null, 'a1000000-0000-4000-8000-0000000000f6') $$,
  '%is a playoff row with NO seed — not the engine''s (a foreign row%',
  'F5 a seedless playoff row (foreign, D318(5)) is refused BY NAME — this verb never adopts one');
delete from matchups where id = 'de000000-0000-4000-8000-000000000179';
-- F6 a league not in playoffs (L2, in_season, with a seeded row).
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000002', 'de000000-0000-4000-8000-000000000271', 'ce000000-0000-4000-8000-000000000022', 'ce000000-0000-4000-8000-000000000021', null, 'a1000000-0000-4000-8000-0000000000f7') $$,
  '%league be000000-0000-4000-8000-000000000002 is in_season — playoff matchups can be hand-picked only while the league is in playoffs%',
  'F6 a league not in playoffs is refused BY NAME (standing rule (a): a state where the action is meaningful)');
-- F7 a PLAYED pairing — the target, then a sibling.
update matchups set home_score = 12.5 where id = pg_temp.eb_m(5);
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006', null, 'a1000000-0000-4000-8000-0000000000f8') $$,
  '%carries a result or score on 1 of its 1 row(s) — a played pairing is never re-paired (§22.2/rule 9)%',
  'F7 a pairing with a WRITTEN score is never re-paired — refused BY NAME pointing at 126 (the same wall 130 keeps at 111:894)');
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(1), 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000005', null, 'a1000000-0000-4000-8000-0000000000f9') $$,
  '%ce000000-0000-4000-8000-000000000005''s current round-1 pairing carries a result or score — a played pairing is never re-paired%',
  'F7b …and a SIBLING pairing that has been played is the same wall (E would have to leave the scored F v E)');
update matchups set home_score = 0 where id = pg_temp.eb_m(5);
select set_config('app.commish_action_id', current_setting('pgtap.e1')::jsonb ->> 'commissioner_action_id', true);
update matchups set is_overridden = true where id = pg_temp.eb_m(5);
select set_config('app.commish_action_id', '', true);
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006', null, 'a1000000-0000-4000-8000-0000000000fa') $$,
  '%carries a result or score on 1 of its 1 row(s)%', 'F7c …an OVERRIDDEN row likewise (is_overridden, no score)');
select set_config('app.commish_action_id', current_setting('pgtap.e1')::jsonb ->> 'commissioner_action_id', true);
update matchups set is_overridden = false where id = pg_temp.eb_m(5);
select set_config('app.commish_action_id', '', true);
-- F8-F10 shape.
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000006', null, 'a1000000-0000-4000-8000-0000000000fb') $$,
  '22023', 'commish_edit_bracket: a team cannot play itself (§11.7 "no self-matchups")', 'F8 self-pairing is 22023');
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), null, 'ce000000-0000-4000-8000-000000000006', null, 'a1000000-0000-4000-8000-0000000000fc') $$,
  '22023', null, 'F9 a NULL home is 22023 (a bye is p_away NULL, never p_home)');
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000005', null, null) $$,
  '22023', 'commish_edit_bracket: p_action_id is required (idempotency key — one UUID per submit, reused on retry)', 'F9b a NULL action_id is 22023');
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', null, 'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000005', null, 'a1000000-0000-4000-8000-0000000000fd') $$,
  '22023', 'commish_edit_bracket: p_matchup_id is required', 'F9c a NULL matchup_id is 22023');
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006', repeat('x', 501), 'a1000000-0000-4000-8000-0000000000fe') $$,
  '22023', 'commish_edit_bracket: the reason is 501 characters — at most 500 (the league_chat bound; §12.13)', 'F10 a 501-character reason is 22023 (the 500 bound stands under Q66)');
-- F11 a foreign league's row.
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000271', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000022', null, 'a1000000-0000-4000-8000-0000000000ff') $$,
  'P0002', null, 'F11 another league''s matchup is P0002');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.eb_ca()::text || ':' || pg_temp.eb_chat()::text, current_setting('pgtap.fa') || ':' || current_setting('pgtap.fa'),
  'F12 no refusal wrote a receipt or a post');
select is((select count(*)::int from commish_bracket_actions where action_id::text like 'a1000000-0000-4000-8000-0000000000f%'), 0, 'F12b …nor a ledger row (a refusal consumes no action_id)');
select is(pg_temp.eb_round(7, 7), '1:01v4:02,2:03vbye,5:06v3:05,6:07vbye', 'F12c …and the round is exactly as §E left it');

-- ---------------------------------------------------------------------------
-- G. THE NO-OP — Chris''s one condition (standing rule (b)).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.g1', public.commish_edit_bracket(
  'be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5),
  'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000005',
  'a reason on a no-op changes nothing', 'a1000000-0000-4000-8000-000000000004')::text, true);
select set_config('request.jwt.claims', '', true);
select is((current_setting('pgtap.g1')::jsonb ->> 'no_changes') || ':' || coalesce(current_setting('pgtap.g1')::jsonb ->> 'commissioner_action_id', 'NULL') || ':' || (current_setting('pgtap.g1')::jsonb ->> 'rows_changed') || ':' || (current_setting('pgtap.g1')::jsonb ->> 'rows_marked') || ':' || coalesce(current_setting('pgtap.g1')::jsonb ->> 'system_post', 'NULL'),
  'true:NULL:0:0:NULL', 'G1 no_changes true, commissioner_action_id NULL, 0 rows changed, 0 marked, no post');
select alike(current_setting('pgtap.g1')::jsonb ->> 'no_changes_why', 'pairing_already_as_asked — matchup % already pairs %', 'G1b …WHY is named');
select is(pg_temp.eb_ca() || ':' || pg_temp.eb_chat(), '3:3', 'G2 no receipt, no post (still §C/§E/§E7''s three)');
select is((select count(*)::int from commish_bracket_actions where action_id = 'a1000000-0000-4000-8000-000000000004'), 1, 'G3 the ledger row IS written for a no-op (an action_id is consumed by its submit)');
select is(pg_temp.eb_marks(7, 7), repeat(right((current_setting('pgtap.e7')::jsonb ->> 'commissioner_action_id'), 4) || ',', 3) || right((current_setting('pgtap.e7')::jsonb ->> 'commissioner_action_id'), 4),
  'G4 the marks are NOT re-stamped by a no-op (still E7''s receipt)');
select is(current_setting('pgtap.g1')::jsonb -> 'bypassed', '["matchup_status_gate:live", "week_status_gate:7:live"]'::jsonb,
  'G5 the gates that WOULD have been lifted are still named; the stand-down is NOT (nothing was written for the engine to respect)');

-- ---------------------------------------------------------------------------
-- H. THE REASON — OPTIONAL (Q66): stored trimmed and posted when given; NULL
--    when whitespace. F v E → E v F (a sides swap) and back.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.h1', public.commish_edit_bracket(
  'be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5),
  'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006',
  E'  keep the higher seed at home \t', 'a1000000-0000-4000-8000-000000000005')::text, true);
select is((current_setting('pgtap.h1')::jsonb ->> 'reason') || '|' || (select reason from commissioner_actions where id = (current_setting('pgtap.h1')::jsonb ->> 'commissioner_action_id')::uuid),
  'keep the higher seed at home|keep the higher seed at home', 'H1 a given reason is stored TRIMMED (the explicit class) in the document and the receipt');
select alike(current_setting('pgtap.h1')::jsonb ->> 'system_post',
  '%EB E vs EB F (was EB F vs EB E) — lifted: matchup_status_gate:live, week_status_gate:7:live, bracket_sync_rebuild:stood_down — reason: keep the higher seed at home',
  'H1b …and posted LAST, after the lifted gates');
select is((select count(*)::int from league_chat where league_id = 'be000000-0000-4000-8000-000000000001' and message = current_setting('pgtap.h1')::jsonb ->> 'system_post'), 1, 'H1c …that post is in league_chat exactly once');
select set_config('pgtap.h2', public.commish_edit_bracket(
  'be000000-0000-4000-8000-000000000001', pg_temp.eb_m(3),
  'ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000005',
  E' \t\r\n ', 'a1000000-0000-4000-8000-000000000006')::text, true);
select set_config('request.jwt.claims', '', true);
select is(coalesce(current_setting('pgtap.h2')::jsonb ->> 'reason', 'NULL') || '|' || coalesce((select reason from commissioner_actions where id = (current_setting('pgtap.h2')::jsonb ->> 'commissioner_action_id')::uuid), 'NULL') || '|' || (current_setting('pgtap.h2')::jsonb ->> 'no_changes'),
  'NULL|NULL|false', 'H2 a whitespace-only reason is stored as NULL (never ''''), and the swap LANDED with its receipt');
select unalike(current_setting('pgtap.h2')::jsonb ->> 'system_post', '%reason:%', 'H2b …no reason clause in the post');
select is((select count(*)::int from league_chat where league_id = 'be000000-0000-4000-8000-000000000001' and message = current_setting('pgtap.h2')::jsonb ->> 'system_post'), 1, 'H2c …that post is in league_chat exactly once');
select is(pg_temp.eb_round(7, 7), '1:01v4:02,2:03vbye,5:06v3:05,6:07vbye', 'H3 the round is back to F(5) home v E(3)');

-- ---------------------------------------------------------------------------
-- I. AUTH — one no-leak 42501.
-- ---------------------------------------------------------------------------
select set_config('pgtap.ia', pg_temp.eb_ca()::text, true);
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006', null, 'a1000000-0000-4000-8000-0000000000a1') $$,
  '42501', 'commish_edit_bracket: not a commissioner of this league', 'I1 a MANAGER is refused (42501, no leak)');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006', null, 'a1000000-0000-4000-8000-0000000000a2') $$,
  '42501', 'commish_edit_bracket: not a commissioner of this league', 'I2 an OUTSIDER is refused with the SAME string');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-0000000000ee', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006', null, 'a1000000-0000-4000-8000-0000000000a3') $$,
  '42501', 'commish_edit_bracket: not a commissioner of this league', 'I3 a league that does not exist is the SAME string (no existence leak)');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.eb_ca()::text, current_setting('pgtap.ia'), 'I4 no refusal wrote a receipt');

-- ---------------------------------------------------------------------------
-- J. REPLAY — byte-identical, nothing re-written (§C''s action_id, which
--    named a pairing that no longer exists — the ledger answers, not the row).
-- ---------------------------------------------------------------------------
select set_config('pgtap.ja', pg_temp.eb_ca() || ':' || pg_temp.eb_chat() || ':' || (select count(*)::int from commish_bracket_actions), true);
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(public.commish_edit_bracket(
  'be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5),
  'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006',
  null, 'a1000000-0000-4000-8000-000000000001'), current_setting('pgtap.c1')::jsonb,
  'J1 the same action_id replays §C''s document byte-identically (the ledger answers on (league, action_id) alone — even naming another row; the route''s F65(b) guard is what refuses THAT as a 409)');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.eb_ca() || ':' || pg_temp.eb_chat() || ':' || (select count(*)::int from commish_bracket_actions), current_setting('pgtap.ja'), 'J2 …and writes nothing');
select is(pg_temp.eb_round(7, 7), '1:01v4:02,2:03vbye,5:06v3:05,6:07vbye', 'J3 …the round untouched by the replay');

-- ---------------------------------------------------------------------------
-- K. DOWNSTREAM — the hand-picked round PLAYS and ROLLS; the ENGINE builds
--    round 2 from ITS survivors. State: A(1) v B(4), C(2) bye, F(5) v E(3),
--    G(6) bye. A beats B; E beats F. Survivors A(1), C(2), E(3), G(6);
--    reseed on ⇒ 1 v 6, 2 v 3.
-- ---------------------------------------------------------------------------
update matchups set home_score = 100.00, away_score =  90.00 where id = pg_temp.eb_m(1);
update matchups set home_score =  95.00, away_score = 105.00 where id = pg_temp.eb_m(5);
select set_config('pgtap.r', public.league_week_advance('2026-10-27 04:00:00+00')::text, true);
select is((select status from league_weeks where league_id = 'be000000-0000-4000-8000-000000000001' and week = 7), 'correction_window', 'K1 L1''s week 7 closes at its rollover');
select is((pg_temp.eb_brackets('be000000-0000-4000-8000-000000000001') ->> 'action') || ':' || (pg_temp.eb_brackets('be000000-0000-4000-8000-000000000001') ->> 'round') || ':' || (pg_temp.eb_brackets('be000000-0000-4000-8000-000000000001') ->> 'source') || ':' || (pg_temp.eb_brackets('be000000-0000-4000-8000-000000000001') ->> 'key'),
  'built:2:provisional:seed', 'K2 round 2 BUILT by the engine at the hand-picked round''s rollover (the stand-down CONTINUEs a rolled round to its survivors)');
select is(pg_temp.eb_round(8, 8), '1:01v6:07,2:03v3:05',
  'K2b A(1) v G(6), C(2) v E(3) — the survivors of the HAND-PICKED pairings (E beat F; A beat B), re-ranked by seed');
select is(pg_temp.eb_marks(8, 8), 'none,none', 'K3 round 2 is the ENGINE''s — unmarked (the mark is per round, never inherited)');
select is(pg_temp.eb_marks(7, 7), repeat(right((current_setting('pgtap.h2')::jsonb ->> 'commissioner_action_id'), 4) || ',', 3) || right((current_setting('pgtap.h2')::jsonb ->> 'commissioner_action_id'), 4),
  'K3b …round 1 still carries §H2''s receipt');
select is(public.playoff_bracket_sync_internal('be000000-0000-4000-8000-000000000001', '2026-10-27 04:00:00+00'), '{"round": 2, "reason": "round_in_progress", "source": "provisional"}'::jsonb,
  'K4 the sync now reports round 2 in progress — round 1 (hand-picked, rolled) is walked past by name');
-- A hand-picked round that has ROLLED is history to the verb too: scored.
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_edit_bracket('be000000-0000-4000-8000-000000000001', pg_temp.eb_m(5), 'ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000006', null, 'a1000000-0000-4000-8000-0000000000b1') $$,
  '%a played pairing is never re-paired%', 'K5 a played, rolled pairing is refused by the same wall (the numbers belong to the teams that played it)');
-- Round 2 (the engine''s, unplayed) CAN be hand-picked: C v E ↔ G.
select set_config('pgtap.k6', public.commish_edit_bracket(
  'be000000-0000-4000-8000-000000000001', (select id from matchups where league_id = 'be000000-0000-4000-8000-000000000001' and week = 8 and home_seed = 2),
  'ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000007',
  null, 'a1000000-0000-4000-8000-000000000007')::text, true);
select set_config('request.jwt.claims', '', true);
select is(pg_temp.eb_round(8, 8) || '|' || (current_setting('pgtap.k6')::jsonb ->> 'round') || '|' || (current_setting('pgtap.k6')::jsonb -> 'weeks')::text, '1:01v3:05,2:03v6:07|2|[8, 8]',
  'K6 round 2 hand-picked: C(2) v G(6), A(1) v E(3) — the verb found round 2 from the row''s week');
select is(pg_temp.eb_marks(8, 8), repeat(right((current_setting('pgtap.k6')::jsonb ->> 'commissioner_action_id'), 4) || ',', 1) || right((current_setting('pgtap.k6')::jsonb ->> 'commissioner_action_id'), 4),
  'K6b …round 2 marked with its own receipt');
select is(public.playoff_bracket_sync_internal('be000000-0000-4000-8000-000000000001', '2026-10-27 04:00:00+00') ->> 'reason', 'round_hand_picked',
  'K6c …and the sync stands down on round 2 now');

select * from finish();
rollback;
