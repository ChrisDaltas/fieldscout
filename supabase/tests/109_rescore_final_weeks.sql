-- ============================================================================
-- pgTAP 109 — migration 161: THE ONE-TIME, RULED, AUDITED RE-SCORE OF FINAL
-- LEAGUE-WEEKS (M5 task L.D3.13, FULL rigour — scoring, results, standings,
-- production data; PROGRESS D425; spec §11.4 / §23.4 v2.16.70).
--
-- THE RULING (Chris 2026-09-29, verbatim): "re-score weeks 1 and 2 with the
-- actual yards". F405's lock stays for every ordinary path; this door is the
-- one sanctioned way past it.
--
--   §A  form: the door (DEFINER, search_path '', REVOKEd), the ledger (RLS,
--       zero policies, no TRUNCATE), the widened source CHECK, the lock's
--       prosrc as a STORED-LITERAL md5 and its 161 hunk reversed = 158's md5
--       (D137), the trigger still ENABLE ALWAYS, the scoring door untouched.
--   §B  per role: nobody but the service role runs the door; the ledger is
--       unreadable / unwritable (RETURNING counts); a JWT is refused in-body.
--       (L.D3.14: B2 / B4 / B5 run after E18, on a ledger that holds a row —
--       R1277; and since 164 the service role no longer holds the door — A3.)
--   §C  every refusal BY NAME, and nothing written by any of them.
--   §D  THE DRY RUN: the apply's own document, and NOTHING persists.
--   §E  THE APPLY: the flip, the overridden cell kept, the results rebuilt
--       (h2h + median), the median, the standings follow, the per-player rows
--       (`rescore`, Σ = score, a stale slot removed), ONE audit row, ONE post
--       (stored literal), the notifications (exactly the managers whose result
--       changed; an open seat named), the ledger row.
--   §F  IDEMPOTENT: a replay is byte-identical; the same id for another week
--       is refused; a NEW id finds nothing to change — detected by value (no
--       audit row, no post, no notification).
--   §G  THE LOCK STAYS: the worker's door still refuses the final week; every
--       hand-written change is refused; the exit needs THIS league-week's
--       audit row AND a `rescore` row; the backfill finds the week stored.
--   §H  total_points: the results rows' points re-scored, rows stored.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(81);

-- 161's one hunk reversed — the D137 pin (the block between the two markers).
create function pg_temp.un161(p_src text) returns text language sql as $un$
  select replace(p_src,
    substring(p_src from position(E'    -- 161 (M5 L.D3.13 — Chris 2026-09-29' in p_src)
                     for position(E'    RAISE EXCEPTION ''league_week_player_points: week_locked' in p_src)
                         - position(E'    -- 161 (M5 L.D3.13 — Chris 2026-09-29' in p_src)),
    '');
$un$;

-- Everything a re-score could move, for the fixture leagues (the "nothing persisted" digest).
create function pg_temp.rs_digest() returns text language sql as $dg$
  select md5(
       coalesce((select string_agg(m.id::text || ':' || coalesce(m.home_score::text, 'N') || ':' || coalesce(m.away_score::text, 'N')
                                   || ':' || coalesce(m.result, 'N') || ':' || m.status || ':' || m.is_overridden::text, '|' order by m.id)
                 from public.matchups m where m.league_id::text like 'b9710000-%'), '')
    || '#' || coalesce((select string_agg(r.team_id::text || ':' || r.week || ':' || r.points::text || ':' || coalesce(r.h2h_result, 'N')
                                   || ':' || coalesce(r.median_result, 'N') || ':' || coalesce(r.is_final::text, 'N'), '|' order by r.team_id, r.week)
                 from public.team_week_results r where r.league_id::text like 'b9710000-%'), '')
    || '#' || coalesce((select string_agg(w.league_id::text || ':' || w.week || ':' || w.status || ':' || coalesce(w.median_score::text, 'N'), '|' order by w.league_id, w.week)
                 from public.league_weeks w where w.league_id::text like 'b9710000-%'), '')
    || '#' || coalesce((select string_agg(p.team_id::text || ':' || p.week || ':' || p.slot || ':' || p.points::text || ':' || p.source, '|' order by p.team_id, p.week, p.slot)
                 from public.league_week_player_points p where p.league_id::text like 'b9710000-%'), '')
    || '#' || (select count(*) from public.commissioner_actions a where a.league_id::text like 'b9710000-%')
    || '#' || (select count(*) from public.league_chat c where c.league_id::text like 'b9710000-%')
    || '#' || (select count(*) from public.notifications n where n.user_id::text like '9f710000-%')
    || '#' || (select count(*) from public.admin_rescore_actions x where x.league_id::text like 'b9710000-%'));
$dg$;

-- The week-1 batch: every team of the week, recomputed (T3 / T4 sit only in the overridden row).
create function pg_temp.batch1() returns jsonb language sql as $b$
  select '[
    {"team_id": "c9710000-0000-4000-8000-000000000001", "points": 85.75, "players": [
       {"slot": "qb:0", "player_id": "pgtap-rsf-q1", "points": 50, "pending": [], "reason": "scored"},
       {"slot": "wr:0", "player_id": "pgtap-rsf-w1", "points": 35.75, "pending": [], "reason": "scored"}]},
    {"team_id": "c9710000-0000-4000-8000-000000000002", "points": 95.9, "players": [
       {"slot": "qb:0", "player_id": "pgtap-rsf-q2", "points": 55.9, "pending": [], "reason": "scored"},
       {"slot": "wr:0", "player_id": "pgtap-rsf-w2", "points": 40, "pending": [], "reason": "scored"}]},
    {"team_id": "c9710000-0000-4000-8000-000000000003", "points": 50, "players": [
       {"slot": "qb:0", "player_id": "pgtap-rsf-q3", "points": 50, "pending": [], "reason": "scored"}]},
    {"team_id": "c9710000-0000-4000-8000-000000000004", "points": 30, "players": [
       {"slot": "qb:0", "player_id": "pgtap-rsf-w4", "points": 30, "pending": [], "reason": "scored"}]}]'::jsonb;
$b$;

create function pg_temp.rescore(p_week int, p_teams jsonb, p_action uuid, p_dry boolean,
                                p_reason text default 'Chris (product owner), 2026-09-29: "re-score weeks 1 and 2 with the actual yards"',
                                p_note text default 'defense yards allowed were missing when it was first scored',
                                p_actor uuid default '9f710000-0000-4000-8000-000000000004',
                                p_league uuid default 'b9710000-0000-4000-8000-00000000000a')
  returns jsonb language sql as $r$
  select public.admin_rescore_final_week(p_league, p_week, p_teams, p_reason, p_note, p_actor, p_action, p_dry);
$r$;

-- Every dry run / apply whose SUCCESS is asserted goes through this handler, so a
-- broken body reds cells BY NAME instead of aborting the file (the D378 shape).
create function pg_temp.try_rescore(p_week int, p_teams jsonb, p_action uuid, p_dry boolean,
                                    p_league uuid default 'b9710000-0000-4000-8000-00000000000a')
  returns jsonb language plpgsql as $t$
begin
  return pg_temp.rescore(p_week, p_teams, p_action, p_dry, p_league => p_league);
exception when others then
  return jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
end;
$t$;

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select ok((select prosecdef from pg_proc where oid = 'public.admin_rescore_final_week(uuid, integer, jsonb, text, text, uuid, uuid, boolean)'::regprocedure),
  'A1 admin_rescore_final_week is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.admin_rescore_final_week(uuid, integer, jsonb, text, text, uuid, uuid, boolean)'::regprocedure),
  array['search_path=""'], 'A2 …with search_path pinned to ''''');
select ok(not has_function_privilege('anon', 'public.admin_rescore_final_week(uuid, integer, jsonb, text, text, uuid, uuid, boolean)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.admin_rescore_final_week(uuid, integer, jsonb, text, text, uuid, uuid, boolean)', 'EXECUTE')
          and not has_function_privilege('service_role', 'public.admin_rescore_final_week(uuid, integer, jsonb, text, text, uuid, uuid, boolean)', 'EXECUTE'),
  'A3 REVOKEd from anon and authenticated; the service role held EXECUTE until migration 164 retired the door (F489 — used once, 2026-09-29; pgTAP 112 R1 to R6). This suite runs the door as its owner');
select is((select relrowsecurity::text || ':' || (select count(*) from pg_policies where tablename = 'admin_rescore_actions')::text
           from pg_class where oid = 'public.admin_rescore_actions'::regclass),
  'true:0', 'A4 the replay ledger: RLS on, ZERO policies');
select ok(not has_table_privilege('anon', 'public.admin_rescore_actions', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.admin_rescore_actions', 'TRUNCATE'),
  'A5 …and no TRUNCATE for anon or authenticated');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'league_week_player_points_source_check'),
  'CHECK ((source = ANY (ARRAY[''worker''::text, ''backfill''::text, ''backfill_unrecoverable''::text, ''rescore''::text])))',
  'A6 the source CHECK gains rescore (every 158 value kept)');
select is(md5((select prosrc from pg_proc where proname = 'league_week_player_points_lock')),
  'bc1ac0492d7b05c75aa212d7e9e0d990', 'A7 the lock''s prosrc is 161''s (stored literal)');
select is(md5(pg_temp.un161((select prosrc from pg_proc where proname = 'league_week_player_points_lock'))),
  '3b032dac03f1ba65174684c57cfae3fe', 'A8 D137: 161''s one hunk reversed on the LIVE body = 158''s prosrc byte for byte');
select is((select tgenabled::text from pg_trigger where tgname = 'trg_league_week_player_points_lock'),
  'A', 'A9 the lock trigger is still ENABLE ALWAYS');
-- M6 L.E2.2 (172) re-pin, additive (the R992 shape): read under 172's five fenced hunks reversed.
select is(md5(regexp_replace((select prosrc from pg_proc where proname = 'score_write_week_batch'), E'[ ]*-- @172\\{[^@]*-- @172\\}\\n', '', 'g')),
  '548958d0a402c352c91c23fa924a2a0f', 'A10 the scoring door is 158''s, untouched by this migration — the worker still refuses a final week (172''s correction hunks reversed; 120 A6 pins them)');

-- ---------------------------------------------------------------------------
-- FIXTURES (postgres, JWT cleared).
--   u1 commissioner of LA (T1), u2 manages T2, u3 manages T4, u4 the ruling's
--   author (in no league), u5 an outsider. T3 is an OPEN seat; T5 is LA's but
--   plays no week-1 game.
--   LA h2h, median game ON, ESPN Standard: week 1 FINAL (T1 101.75 v T2 98.90
--   home; T3 v T4 OVERRIDDEN 90–80 home), week 2 FINAL (T1 80 v T3 70, T2 60
--   v T4 50), week 3 correction_window, week 4 upcoming. IR key "ir".
--   LB total_points: week 1 FINAL, T6 30.00, T7 20.00.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9f710000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-rsf' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'rsf_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id::uuid, '9f710000-0000-4000-8000-000000000001', l.name, 2026, 'in_season', 8, 10, 4, 11, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.settings::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1}], "bench": 3, "ir_slots": [{"key": "ir", "label": "IR", "count": 1}], "swap_spots": 0}'
from (values ('b9710000-0000-4000-8000-00000000000a', 'pgtap-rsf-LA', '{"schedule_mode": "h2h", "median_game": true}'),
             ('b9710000-0000-4000-8000-00000000000b', 'pgtap-rsf-LB', '{"schedule_mode": "total_points"}')) l(id, name, settings);

insert into teams (id, owner_id, name, league_id) values
 ('c9710000-0000-4000-8000-000000000001', '9f710000-0000-4000-8000-000000000001', 'RS One',   'b9710000-0000-4000-8000-00000000000a'),
 ('c9710000-0000-4000-8000-000000000002', '9f710000-0000-4000-8000-000000000002', 'RS Two',   'b9710000-0000-4000-8000-00000000000a'),
 ('c9710000-0000-4000-8000-000000000003', '9f710000-0000-4000-8000-000000000001', 'RS Three', 'b9710000-0000-4000-8000-00000000000a'),
 ('c9710000-0000-4000-8000-000000000004', '9f710000-0000-4000-8000-000000000003', 'RS Four',  'b9710000-0000-4000-8000-00000000000a'),
 ('c9710000-0000-4000-8000-000000000005', '9f710000-0000-4000-8000-000000000001', 'RS Five',  'b9710000-0000-4000-8000-00000000000a'),
 ('c9710000-0000-4000-8000-000000000006', '9f710000-0000-4000-8000-000000000001', 'RS Six',   'b9710000-0000-4000-8000-00000000000b'),
 ('c9710000-0000-4000-8000-000000000007', '9f710000-0000-4000-8000-000000000001', 'RS Seven', 'b9710000-0000-4000-8000-00000000000b');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b9710000-0000-4000-8000-00000000000a', '9f710000-0000-4000-8000-000000000001', 'c9710000-0000-4000-8000-000000000001', 'commissioner', false, 100),
 ('b9710000-0000-4000-8000-00000000000a', '9f710000-0000-4000-8000-000000000002', 'c9710000-0000-4000-8000-000000000002', 'manager',      false, 100),
 ('b9710000-0000-4000-8000-00000000000a', '9f710000-0000-4000-8000-000000000003', 'c9710000-0000-4000-8000-000000000004', 'manager',      false, 100);

insert into players (id, full_name, position, team, status) values
 ('pgtap-rsf-q1', 'RSF QB One', 'QB', 'KC', 'Active'),   ('pgtap-rsf-w1', 'RSF WR One', 'WR', 'KC', 'Active'),
 ('pgtap-rsf-q2', 'RSF QB Two', 'QB', 'BUF', 'Active'),  ('pgtap-rsf-w2', 'RSF WR Two', 'WR', 'BUF', 'Active'),
 ('pgtap-rsf-w3', 'RSF WR Three', 'WR', 'DAL', 'Active'), ('pgtap-rsf-q3', 'RSF QB Three', 'QB', 'DAL', 'Active'),
 ('pgtap-rsf-w4', 'RSF WR Four', 'WR', 'PHI', 'Active'),  ('pgtap-rsf-q9', 'RSF QB Hurt', 'QB', 'PHI', 'Active');

insert into league_weeks (league_id, season, week, status) values
 ('b9710000-0000-4000-8000-00000000000a', 2026, 1, 'final'),
 ('b9710000-0000-4000-8000-00000000000a', 2026, 2, 'final'),
 ('b9710000-0000-4000-8000-00000000000a', 2026, 3, 'correction_window'),
 ('b9710000-0000-4000-8000-00000000000a', 2026, 4, 'upcoming'),
 ('b9710000-0000-4000-8000-00000000000b', 2026, 1, 'final');

insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden) values
 ('d9710000-0000-4000-8000-000000000011', 'b9710000-0000-4000-8000-00000000000a', 2026, 1, 'regular', 'c9710000-0000-4000-8000-000000000001', 'c9710000-0000-4000-8000-000000000002', 101.75, 98.90, 'final', 'home', false),
 ('d9710000-0000-4000-8000-000000000012', 'b9710000-0000-4000-8000-00000000000a', 2026, 1, 'regular', 'c9710000-0000-4000-8000-000000000003', 'c9710000-0000-4000-8000-000000000004', 90.00, 80.00, 'final', 'home', true),
 ('d9710000-0000-4000-8000-000000000021', 'b9710000-0000-4000-8000-00000000000a', 2026, 2, 'regular', 'c9710000-0000-4000-8000-000000000001', 'c9710000-0000-4000-8000-000000000003', 80.00, 70.00, 'final', 'home', false),
 ('d9710000-0000-4000-8000-000000000022', 'b9710000-0000-4000-8000-00000000000a', 2026, 2, 'regular', 'c9710000-0000-4000-8000-000000000002', 'c9710000-0000-4000-8000-000000000004', 60.00, 50.00, 'final', 'home', false),
 ('d9710000-0000-4000-8000-000000000031', 'b9710000-0000-4000-8000-00000000000a', 2026, 3, 'regular', 'c9710000-0000-4000-8000-000000000001', 'c9710000-0000-4000-8000-000000000004', 10.00, 9.00, 'live', null, false);

insert into team_lineups (team_id, season, week, starters, bench, slot_map) values
 ('c9710000-0000-4000-8000-000000000001', 2026, 1, '[]', '[]', '{"qb:0": "pgtap-rsf-q1", "wr:0": "pgtap-rsf-w1", "ir:0": "pgtap-rsf-q9"}'),
 ('c9710000-0000-4000-8000-000000000002', 2026, 1, '[]', '[]', '{"qb:0": "pgtap-rsf-q2", "wr:0": "pgtap-rsf-w2"}'),
 ('c9710000-0000-4000-8000-000000000003', 2026, 1, '[]', '[]', '{"qb:0": "pgtap-rsf-q3"}'),
 ('c9710000-0000-4000-8000-000000000004', 2026, 1, '[]', '[]', '{"qb:0": "pgtap-rsf-w4", "wr:0": ""}'),
 ('c9710000-0000-4000-8000-000000000001', 2026, 3, '[]', '[]', '{"qb:0": "pgtap-rsf-q1"}'),
 ('c9710000-0000-4000-8000-000000000006', 2026, 1, '[]', '[]', '{"qb:0": "pgtap-rsf-q2"}'),
 ('c9710000-0000-4000-8000-000000000007', 2026, 1, '[]', '[]', '{"qb:0": "pgtap-rsf-w3"}');
insert into team_week_results (league_id, team_id, season, week, points, is_final) values
 ('b9710000-0000-4000-8000-00000000000b', 'c9710000-0000-4000-8000-000000000006', 2026, 1, 30.00, false),
 ('b9710000-0000-4000-8000-00000000000b', 'c9710000-0000-4000-8000-000000000007', 2026, 1, 20.00, false);

-- The results as finalization writes them (the rebuild — the SAME helper), then the 158 backfill's
-- unrecoverable rows for week 1 (the production state: stored lines ≠ stored score).
select public.rebuild_team_week_results('b9710000-0000-4000-8000-00000000000a', 1);
select public.rebuild_team_week_results('b9710000-0000-4000-8000-00000000000a', 2);
select public.rebuild_team_week_results('b9710000-0000-4000-8000-00000000000b', 1);
select public.score_backfill_player_points('b9710000-0000-4000-8000-00000000000a', 1, '[
  {"team_id": "c9710000-0000-4000-8000-000000000001", "points": 85.75, "players": [
     {"slot": "qb:0", "player_id": "pgtap-rsf-q1", "points": 50, "pending": [], "reason": "scored"},
     {"slot": "wr:0", "player_id": "pgtap-rsf-w1", "points": 35.75, "pending": [], "reason": "scored"}]},
  {"team_id": "c9710000-0000-4000-8000-000000000002", "points": 95.9, "players": [
     {"slot": "qb:0", "player_id": "pgtap-rsf-q2", "points": 55.9, "pending": [], "reason": "scored"},
     {"slot": "wr:0", "player_id": "pgtap-rsf-w2", "points": 40, "pending": [], "reason": "scored"},
     {"slot": "wr:1", "player_id": "pgtap-rsf-w3", "points": 0, "pending": [], "reason": "no_stat_row"}]}]');

-- PREMISE, by value (stored literals).
select is(
  (select string_agg(r.team_id::text || '=' || r.points::text || ':' || r.h2h_result || ':' || r.median_result, ' ' order by r.team_id)
   from team_week_results r where r.league_id = 'b9710000-0000-4000-8000-00000000000a' and r.week = 1)
  || ' median ' || (select median_score::text from league_weeks where league_id = 'b9710000-0000-4000-8000-00000000000a' and week = 1),
  'c9710000-0000-4000-8000-000000000001=101.75:win:win c9710000-0000-4000-8000-000000000002=98.90:loss:win '
  'c9710000-0000-4000-8000-000000000003=90.00:win:loss c9710000-0000-4000-8000-000000000004=80.00:loss:loss median 94.45',
  'P1 PREMISE — week 1 as first scored: One 101.75 beats Two 98.90; the median (94.45) has One and Two winning, Three and Four losing');
select is(
  (select string_agg(p.team_id::text || '/' || p.slot || '=' || p.points::text || ':' || p.source, ' ' order by p.team_id, p.slot)
   from league_week_player_points p where p.league_id = 'b9710000-0000-4000-8000-00000000000a' and p.week = 1),
  'c9710000-0000-4000-8000-000000000001/qb:0=50.00:backfill_unrecoverable c9710000-0000-4000-8000-000000000001/wr:0=35.75:backfill_unrecoverable '
  'c9710000-0000-4000-8000-000000000002/qb:0=55.90:backfill_unrecoverable c9710000-0000-4000-8000-000000000002/wr:0=40.00:backfill_unrecoverable '
  'c9710000-0000-4000-8000-000000000002/wr:1=0.00:backfill_unrecoverable',
  'P2 PREMISE — the 158 backfill stored week 1''s lines as UNRECOVERABLE (they do not add up to 101.75 / 98.90): the production state');

-- ---------------------------------------------------------------------------
-- B. ROLES
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.admin_rescore_final_week('b9710000-0000-4000-8000-00000000000a', 1, '[]', 'r', 'n', '9f710000-0000-4000-8000-000000000004', null, true) $$,
  '42501', null, 'B1 anon cannot run the door (REVOKEd)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f710000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.admin_rescore_final_week('b9710000-0000-4000-8000-00000000000a', 1, '[]', 'r', 'n', '9f710000-0000-4000-8000-000000000001', null, true) $$,
  '42501', null, 'B3 the COMMISSIONER cannot run the door (REVOKEd) — his tool is the audited override');
select throws_ok($$ insert into admin_rescore_actions (league_id, season, week, action_id, actor_id, result)
  values ('b9710000-0000-4000-8000-00000000000a', 2026, 1, gen_random_uuid(), '9f710000-0000-4000-8000-000000000001', '{}') $$,
  '42501', null, 'B6 …INSERT is refused (RLS, 42501) — a pre-planted replay row is impossible');
reset role;
select set_config('request.jwt.claims', '{"sub": "9f710000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1(), null, true) $$,
  '42501', 'admin_rescore_final_week: the re-score door is the operator''s (service role) on a recorded ruling, never a signed-in user''s',
  'B7 a JWT reaching the door as a privileged role is refused IN-BODY');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- C. REFUSALS BY NAME — and nothing written by any of them
-- ---------------------------------------------------------------------------
select set_config('pgtap.g0', pg_temp.rs_digest(), true);
select throws_ok($$ select pg_temp.rescore(3, '[{"team_id": "c9710000-0000-4000-8000-000000000001", "points": 10, "players": [{"slot": "qb:0", "player_id": "pgtap-rsf-q1", "points": 10, "pending": [], "reason": "scored"}]}]', gen_random_uuid(), false) $$,
  'P0001', 'admin_rescore_final_week: week_not_final — league b9710000-0000-4000-8000-00000000000a week 3 is correction_window; an open week is the score worker''s (it re-scores on every correction) — this door re-scores a FINAL week only',
  'C1 a CORRECTION-WINDOW week is refused by name — it is the worker''s');
select throws_ok($$ select pg_temp.rescore(4, '[{"team_id": "c9710000-0000-4000-8000-000000000001", "points": 0, "players": []}]', gen_random_uuid(), false) $$,
  'P0001', 'admin_rescore_final_week: week_not_final — league b9710000-0000-4000-8000-00000000000a week 4 is upcoming; an open week is the score worker''s (it re-scores on every correction) — this door re-scores a FINAL week only',
  'C2 an UPCOMING week is refused by name');
select throws_ok($$ select pg_temp.rescore(1, (select jsonb_agg(e) from jsonb_array_elements(pg_temp.batch1()) e where e ->> 'team_id' <> 'c9710000-0000-4000-8000-000000000004'), gen_random_uuid(), false) $$,
  'P0001', 'admin_rescore_final_week: batch_incomplete — league b9710000-0000-4000-8000-00000000000a week 1 has 1 team(s) the batch does not name ({c9710000-0000-4000-8000-000000000004}); a week is re-scored whole or not at all',
  'C3 a PARTIAL week (one team left out) is refused by name');
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1() || '[{"team_id": "c9710000-0000-4000-8000-000000000005", "points": 1, "players": [{"slot": "qb:0", "player_id": "pgtap-rsf-q1", "points": 1, "pending": [], "reason": "scored"}]}]'::jsonb, gen_random_uuid(), false) $$,
  'P0001', 'admin_rescore_final_week: team_not_in_week — team(s) {c9710000-0000-4000-8000-000000000005} have no stored score in league b9710000-0000-4000-8000-00000000000a week 1',
  'C4 a team of the league that did not play the week is refused by name');
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1() || '[{"team_id": "c9710000-0000-4000-8000-000000000006", "points": 1, "players": [{"slot": "qb:0", "player_id": "pgtap-rsf-q1", "points": 1, "pending": [], "reason": "scored"}]}]'::jsonb, gen_random_uuid(), false) $$,
  'P0002', 'admin_rescore_final_week: the batch names 1 team(s) that are not league b9710000-0000-4000-8000-00000000000a''s',
  'C5 another league''s team is refused (P0002)');
select throws_ok($$ select pg_temp.rescore(1, jsonb_set(pg_temp.batch1(), '{0}', '{"team_id": "c9710000-0000-4000-8000-000000000001", "points": 95.75, "players": [
       {"slot": "qb:0", "player_id": "pgtap-rsf-q1", "points": 50, "pending": [], "reason": "scored"},
       {"slot": "wr:0", "player_id": "pgtap-rsf-w1", "points": 35.75, "pending": [], "reason": "scored"},
       {"slot": "ir:0", "player_id": "pgtap-rsf-q9", "points": 10, "pending": [], "reason": "scored"}]}'), gen_random_uuid(), false) $$,
  'P0001', 'admin_rescore_final_week: lineup_mismatch — team c9710000-0000-4000-8000-000000000001 week 1: the stored lineup starts [qb:0=pgtap-rsf-q1,wr:0=pgtap-rsf-w1] but the batch scores [ir:0=pgtap-rsf-q9,qb:0=pgtap-rsf-q1,wr:0=pgtap-rsf-w1]',
  'C6 rows that are not the stored lineup''s starters (an IR player scored) are refused by name — the worker''s own reading');
select throws_ok($$ select pg_temp.rescore(1, jsonb_set(pg_temp.batch1(), '{0,points}', 'null'), gen_random_uuid(), false) $$,
  '22023', 'admin_rescore_final_week: element 1 (team c9710000-0000-4000-8000-000000000001) points must be a JSON number — a final week is re-scored to a number; a recompute with a starter still pending (E61) cannot be written to a locked week',
  'C7 a PENDING recompute cannot be written to a final week');
select throws_ok($$ select pg_temp.rescore(1, jsonb_set(pg_temp.batch1(), '{0,points}', '86'), gen_random_uuid(), false) $$,
  '22023', 'admin_rescore_final_week: element 1 (team c9710000-0000-4000-8000-000000000001) players add up to 85.75 but points is 86 — the stored lines must add up to the stored score (F405, §7.3.3)',
  'C8 rows that do not add up to the score are refused (158''s one check, called)');
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1(), gen_random_uuid(), false, E' \t') $$,
  '22023', null, 'C9 a blank reason is refused — the ruling is the audit row''s reason');
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1(), gen_random_uuid(), false, 'r', '...') $$,
  '22023', null, 'C10 a blank member note is refused — the league is told why in plain words');
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1(), gen_random_uuid(), false, 'r', 'n', '9f710000-0000-4000-8000-0000000000ff') $$,
  '22023', 'admin_rescore_final_week: actor 9f710000-0000-4000-8000-0000000000ff is not a profile — the audit row names the person whose ruling this is',
  'C11 an actor who is not a profile is refused');
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1(), null, false) $$,
  '22023', 'admin_rescore_final_week: p_action_id is required to apply (the idempotency key — one per league-week per run, reused on a retry)',
  'C12 an apply without an action_id is refused');
savepoint c13;
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, home_seed, away_seed, status)
values ('b9710000-0000-4000-8000-00000000000a', 2026, 4, 'playoff', 'c9710000-0000-4000-8000-000000000001', 'c9710000-0000-4000-8000-000000000002', 1, 2, 'scheduled');
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1(), gen_random_uuid(), false) $$,
  'P0001', 'admin_rescore_final_week: bracket_built — league b9710000-0000-4000-8000-00000000000a already has playoff rows for season 2026; they were seeded from the standings this would change',
  'C13 a league whose bracket is built is refused by name');
rollback to savepoint c13;
savepoint c14;
update leagues set status = 'playoffs' where id = 'b9710000-0000-4000-8000-00000000000a';
select throws_ok($$ select pg_temp.rescore(1, pg_temp.batch1(), gen_random_uuid(), false) $$,
  'P0001', 'admin_rescore_final_week: league_not_in_season — league b9710000-0000-4000-8000-00000000000a is playoffs (a bracket or a champion already reads these results; this door re-scores an in-season league only)',
  'C14 a league past the regular season is refused by name');
rollback to savepoint c14;
select is(pg_temp.rs_digest(), current_setting('pgtap.g0'),
  'C15 NOTHING was written by any refusal — scores, results, medians, rows, audit rows, posts, notifications, ledger');

-- ---------------------------------------------------------------------------
-- D. THE DRY RUN — the apply's own document, and NOTHING persists
-- ---------------------------------------------------------------------------
select set_config('pgtap.d', pg_temp.try_rescore(1, pg_temp.batch1(), null, true)::text, true);
select is(
  (current_setting('pgtap.d')::jsonb ->> 'dry_run') || ' ' || (current_setting('pgtap.d')::jsonb ->> 'no_changes') || ' '
  || coalesce(current_setting('pgtap.d')::jsonb ->> 'commissioner_action_id', 'null') || ' ' || (current_setting('pgtap.d')::jsonb ->> 'scores_changed'),
  'true false null 2', 'D1 the dry run: a change (2 team scores), NO audit id handed out');
select is(
  (select jsonb_agg(f ->> 'matchup_id') from jsonb_array_elements(current_setting('pgtap.d')::jsonb -> 'flips') f),
  '["d9710000-0000-4000-8000-000000000011"]'::jsonb, 'D2 …it names the ONE result that flips (One v Two)');
select is(
  current_setting('pgtap.d')::jsonb ->> 'system_post',
  'Week 1 was re-scored: defense yards allowed were missing when it was first scored. Result changed: RS Two beat RS One 95.90–85.75 (first scored RS One 101.75–98.90). Median game: RS One now a loss (was a win); RS Three now a win (was a loss). The commissioner-set score was kept for RS Three vs RS Four. 2 team scores changed; standings are updated.',
  'D3 …the league post it WOULD write (stored literal — plain words)');
select is(
  (select jsonb_agg(n ->> 'team_id' order by n ->> 'team_id') from jsonb_array_elements(current_setting('pgtap.d')::jsonb -> 'notified') n)
  || (current_setting('pgtap.d')::jsonb -> 'not_notified'),
  '["c9710000-0000-4000-8000-000000000001", "c9710000-0000-4000-8000-000000000002", {"why": "no_seated_manager", "team_id": "c9710000-0000-4000-8000-000000000003"}]'::jsonb,
  'D4 …the managers it WOULD notify (One, Two) and the open seat it names (Three)');
select is(current_setting('pgtap.d')::jsonb ->> 'median_score_after', '87.88', 'D5 …and the new median it WOULD store (87.875 exact → 87.88)');
select is(pg_temp.rs_digest(), current_setting('pgtap.g0'),
  'D6 NOTHING persisted: scores, results, median, rows, audit rows, posts, notifications, ledger — the dry run is the apply ROLLED BACK');
select is(coalesce(current_setting('fieldscout.final_week_rescore', true), ''), '', 'D7 …and the lock''s setting did not survive the rolled-back block');

-- ---------------------------------------------------------------------------
-- E. THE APPLY
-- ---------------------------------------------------------------------------
select set_config('pgtap.e', pg_temp.try_rescore(1, pg_temp.batch1(), '3c100000-0000-4000-8000-0000000000a1', false)::text, true);
select is(
  (current_setting('pgtap.e')::jsonb ->> 'dry_run') || ' ' || (current_setting('pgtap.e')::jsonb ->> 'no_changes') || ' '
  || ((current_setting('pgtap.e')::jsonb ->> 'commissioner_action_id') is not null)::text,
  'false false true', 'E1 the apply: a change, WITH its audit row');
select is(
  (select home_score::text || '|' || away_score::text || '|' || result || '|' || status || '|' || is_overridden::text from matchups where id = 'd9710000-0000-4000-8000-000000000011'),
  '85.75|95.9|away|final|false', 'E2 One v Two: 85.75–95.9 and the result that goes with it — AWAY (the flip), still final, not overridden');
select is(
  (select home_score::text || '|' || away_score::text || '|' || result || '|' || status || '|' || is_overridden::text from matchups where id = 'd9710000-0000-4000-8000-000000000012'),
  '90.00|80.00|home|final|true', 'E3 the OVERRIDDEN row (Three v Four) is the commissioner''s number — byte-identical, although the recompute says 50–30');
select is(
  (select jsonb_agg(o ->> 'matchup_id') from jsonb_array_elements(current_setting('pgtap.e')::jsonb -> 'overridden') o),
  '["d9710000-0000-4000-8000-000000000012"]'::jsonb, 'E4 …and the result NAMES it as kept');
select is(
  (select string_agg(r.team_id::text || '=' || r.points::text || ':' || r.h2h_result || ':' || r.median_result, ' ' order by r.team_id)
   from team_week_results r where r.league_id = 'b9710000-0000-4000-8000-00000000000a' and r.week = 1),
  'c9710000-0000-4000-8000-000000000001=85.75:loss:loss c9710000-0000-4000-8000-000000000002=95.90:win:win '
  'c9710000-0000-4000-8000-000000000003=90.00:win:win c9710000-0000-4000-8000-000000000004=80.00:loss:loss',
  'E5 the RESULTS rebuilt by finalization''s own math: One loses (h2h + median), Two wins, THREE now wins the median (87.875) without being re-scored');
select is((select median_score::text from league_weeks where league_id = 'b9710000-0000-4000-8000-00000000000a' and week = 1), '87.88',
  'E6 the stored median follows (94.45 → 87.88)');
select is(
  (select string_agg(r.team_id::text || '=' || r.points::text || ':' || r.h2h_result || ':' || r.median_result, ' ' order by r.team_id)
   from team_week_results r where r.league_id = 'b9710000-0000-4000-8000-00000000000a' and r.week = 2),
  'c9710000-0000-4000-8000-000000000001=80.00:win:win c9710000-0000-4000-8000-000000000002=60.00:win:loss '
  'c9710000-0000-4000-8000-000000000003=70.00:loss:win c9710000-0000-4000-8000-000000000004=50.00:loss:loss',
  'E7 week 2 (not re-scored) is untouched');
select is(
  (select string_agg((s ->> 'team_id') || ':' || (s #>> '{h2h_record,wins}') || '-' || (s #>> '{h2h_record,losses}') || '/' || (s #>> '{median_record,wins}') || '-' || (s #>> '{median_record,losses}') || ':' || (s ->> 'points_for'), ' ' order by s ->> 'team_id')
   from jsonb_array_elements(public.league_standings_internal('b9710000-0000-4000-8000-00000000000a', false) -> 'standings') s
   where s ->> 'team_id' <> 'c9710000-0000-4000-8000-000000000005'),
  'c9710000-0000-4000-8000-000000000001:1-1/1-1:165.75 c9710000-0000-4000-8000-000000000002:2-0/1-1:155.90 '
  'c9710000-0000-4000-8000-000000000003:1-1/2-0:160.00 c9710000-0000-4000-8000-000000000004:0-2/0-2:130.00',
  'E8 THE STANDINGS FOLLOW (read, never patched): One 1-1 / 1-1 (was 2-0 / 2-0), Two 2-0, Three''s median 2-0, points for re-summed');
select is(
  (select string_agg(p.team_id::text || '/' || p.slot || '=' || p.points::text || ':' || p.source, ' ' order by p.team_id, p.slot)
   from league_week_player_points p where p.league_id = 'b9710000-0000-4000-8000-00000000000a' and p.week = 1),
  'c9710000-0000-4000-8000-000000000001/qb:0=50.00:rescore c9710000-0000-4000-8000-000000000001/wr:0=35.75:rescore '
  'c9710000-0000-4000-8000-000000000002/qb:0=55.90:rescore c9710000-0000-4000-8000-000000000002/wr:0=40.00:rescore',
  'E9 the per-player rows: rewritten as rescore (no longer "unrecoverable"), Two''s stale wr:1 removed; Three / Four (overridden only) get none');
select is(
  (select string_agg(t.id::text || '=' || (select sum(p.points) from league_week_player_points p where p.team_id = t.id and p.week = 1)::text
                     || '/' || (select case when m.home_team_id = t.id then m.home_score else m.away_score end from matchups m where m.id = 'd9710000-0000-4000-8000-000000000011')::text, ' ' order by t.id)
   from teams t where t.id in ('c9710000-0000-4000-8000-000000000001', 'c9710000-0000-4000-8000-000000000002')),
  'c9710000-0000-4000-8000-000000000001=85.75/85.75 c9710000-0000-4000-8000-000000000002=95.90/95.9',
  'E10 …and they ADD UP to the stored scores (the box score adds up)');
select is(
  (select count(*)::int || '|' || min(a.actor_id::text) || '|' || min(a.action_type) || '|' || min(a.target_type) || '|' || min(a.target_id) || '|' || min(a.reason)
   from commissioner_actions a where a.league_id = 'b9710000-0000-4000-8000-00000000000a'),
  '1|9f710000-0000-4000-8000-000000000004|rescore_final_week|week|2026:1|Chris (product owner), 2026-09-29: "re-score weeks 1 and 2 with the actual yards"',
  'E11 ONE audit row: the ruling''s author, rescore_final_week, the week, the ruling as the reason');
select is(
  (select a.before::text || ' ' || a.after::text from commissioner_actions a where a.league_id = 'b9710000-0000-4000-8000-00000000000a'),
  '{"week_scores": [{"result": "home", "away_score": 98.90, "home_score": 101.75, "matchup_id": "d9710000-0000-4000-8000-000000000011"}]} '
  '{"week_scores": [{"result": "away", "away_score": 95.9, "home_score": 85.75, "matchup_id": "d9710000-0000-4000-8000-000000000011"}]}',
  'E12 …recording exactly the cells it changed, before and after');
select is(
  (select (a.metadata ->> 'week') || ' ' || (a.metadata ->> 'season') || ' ' || (a.metadata ->> 'verb') || ' ' || (a.metadata ->> 'scores_changed') || ' ' || jsonb_array_length(a.metadata -> 'overridden_kept')
   from commissioner_actions a where a.league_id = 'b9710000-0000-4000-8000-00000000000a'),
  '1 2026 admin_rescore_final_week 2 1', 'E13 …its metadata carries the week (what the lock''s exit checks), the verb, the count, the kept override');
select is(
  (select string_agg(coalesce(c.user_id::text, 'NULL') || ' ' || c.is_system::text || ' ' || c.context || ' ' || c.message, ' || ')
   from league_chat c where c.league_id = 'b9710000-0000-4000-8000-00000000000a'),
  'NULL true league Week 1 was re-scored: defense yards allowed were missing when it was first scored. Result changed: RS Two beat RS One 95.90–85.75 (first scored RS One 101.75–98.90). Median game: RS One now a loss (was a win); RS Three now a win (was a loss). The commissioner-set score was kept for RS Three vs RS Four. 2 team scores changed; standings are updated.',
  'E14 ONE league post, from nobody (the "system" chip), in plain words — exactly the dry run''s');
select is(
  (select string_agg(n.user_id::text || ' ' || n.type || ' ' || n.title, ' || ' order by n.user_id) from notifications n where n.user_id::text like '9f710000-%'),
  '9f710000-0000-4000-8000-000000000001 league_week_rescored Week 1 was re-scored — your result changed || 9f710000-0000-4000-8000-000000000002 league_week_rescored Week 1 was re-scored — your result changed',
  'E15 a notification to EXACTLY the managers whose result changed (One, Two); Four''s manager (unchanged) gets none');
select is(
  (select n.body from notifications n where n.user_id = '9f710000-0000-4000-8000-000000000001'),
  'Week 1 was re-scored: defense yards allowed were missing when it was first scored. Your score: 101.75 → 85.75. Your matchup vs RS Two is now a loss (it was a win). Your median game is now a loss (it was a win). Standings are updated.',
  'E16 …in plain words (stored literal)');
select is((current_setting('pgtap.e')::jsonb -> 'not_notified'), '[{"why": "no_seated_manager", "team_id": "c9710000-0000-4000-8000-000000000003"}]'::jsonb,
  'E17 …and the open seat whose median changed is NAMED, not silently skipped');
select is((select count(*)::int from admin_rescore_actions where league_id = 'b9710000-0000-4000-8000-00000000000a'), 1, 'E18 the ledger row');
select is(coalesce(current_setting('fieldscout.final_week_rescore', true), '') || '|' || (select status from league_weeks where league_id = 'b9710000-0000-4000-8000-00000000000a' and week = 1),
  '|final', 'E19 the lock''s setting is cleared behind the door; the week is still FINAL');
select is(current_setting('pgtap.e')::jsonb -> 'player_points', '{"rows_removed": 1, "rows_written": 4, "teams_written": 2}'::jsonb,
  'E20 the door''s own count of the rows (4 written, 1 removed, 2 teams)');

-- R1277 (L.D3.14): B2 / B4 / B5 run HERE, after E18 wrote the ledger row — in
-- §B the ledger was EMPTY, so "reads nothing" and "touches 0 rows" could not
-- fail. Now a row exists for them to leak or change.
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from admin_rescore_actions), 0, 'B2 anon reads nothing from the ledger (a row exists — E18; R1277)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f710000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq($$ with w as (update admin_rescore_actions set week = 9 returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B4 the commissioner: UPDATE of the ledger touches 0 rows (a row exists — E18; R1277)');
select results_eq($$ with w as (delete from admin_rescore_actions returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B5 …DELETE touches 0 rows (R1277)');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- F. IDEMPOTENT
-- ---------------------------------------------------------------------------
select set_config('pgtap.g1', pg_temp.rs_digest(), true);
select is(pg_temp.try_rescore(1, pg_temp.batch1(), '3c100000-0000-4000-8000-0000000000a1', false), current_setting('pgtap.e')::jsonb,
  'F1 a RETRY with the same action_id replays the document byte for byte');
select is(pg_temp.rs_digest(), current_setting('pgtap.g1'), 'F2 …and writes nothing (no second audit row, post, notification or ledger row)');
select throws_ok($$ select pg_temp.rescore(2, '[{"team_id": "c9710000-0000-4000-8000-000000000001", "points": 80, "players": []}]', '3c100000-0000-4000-8000-0000000000a1', false) $$,
  '22023', null, 'F3 the same action_id for ANOTHER week is refused (F65(b) — a different request)');
select set_config('pgtap.f', pg_temp.try_rescore(1, pg_temp.batch1(), '3c100000-0000-4000-8000-0000000000a2', false)::text, true);
select is(
  (current_setting('pgtap.f')::jsonb ->> 'no_changes') || ' ' || coalesce(current_setting('pgtap.f')::jsonb ->> 'commissioner_action_id', 'null') || ' '
  || jsonb_array_length(current_setting('pgtap.f')::jsonb -> 'prior_rescores'),
  'true null 1', 'F4 a SECOND apply (a new id) finds nothing to change — no_changes, no audit id — and names the earlier re-score');
select ok((current_setting('pgtap.f')::jsonb ->> 'reason') like 'no_changes — every score, result and stored player line of the week already equals the recompute%',
  'F5 …saying WHY, by value');
select is(
  (select count(*)::int from commissioner_actions where league_id = 'b9710000-0000-4000-8000-00000000000a') || ' '
  || (select count(*)::int from league_chat where league_id = 'b9710000-0000-4000-8000-00000000000a') || ' '
  || (select count(*)::int from notifications where user_id::text like '9f710000-%') || ' '
  || (select count(*)::int from admin_rescore_actions where league_id = 'b9710000-0000-4000-8000-00000000000a'),
  '1 1 2 2', 'F6 …so still ONE audit row, ONE post, TWO notifications; the new id is consumed (ledger 2)');
select set_config('pgtap.d2', pg_temp.try_rescore(1, pg_temp.batch1(), null, true)::text, true);
select is(current_setting('pgtap.d2')::jsonb ->> 'no_changes', 'true', 'F7 …and a dry run now says the same');

-- ---------------------------------------------------------------------------
-- G. THE LOCK STAYS — the door is the ONLY way past it
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.score_write_week_batch('b9710000-0000-4000-8000-00000000000a', 1, '[{"team_id": "c9710000-0000-4000-8000-000000000001", "points": 99, "players": [{"slot": "qb:0", "player_id": "pgtap-rsf-q1", "points": 99, "pending": [], "reason": "scored"}]}]') $$,
  'P0001', 'score_write_week_batch: week_final — league b9710000-0000-4000-8000-00000000000a week 1 is final; a post-window delta changes no league cell (D295, §23.4)',
  'G1 the ORDINARY worker still cannot touch the final week (119''s week_final, unchanged)');
select throws_ok($$ update league_week_player_points set points = 1 where team_id = 'c9710000-0000-4000-8000-000000000001' and week = 1 $$,
  'P0001', null, 'G2 a hand-written UPDATE of the re-scored rows is refused (as postgres — the table itself)');
select throws_ok($$ delete from league_week_player_points where team_id = 'c9710000-0000-4000-8000-000000000001' and week = 1 $$,
  'P0001', null, 'G3 …and a DELETE');
select throws_ok($$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
     values ('b9710000-0000-4000-8000-00000000000a', 2026, 1, 'c9710000-0000-4000-8000-000000000001', 'wr:9', 'pgtap-rsf-w3', 0, 'no_stat_row', 'rescore') $$,
  'P0001', null, 'G4 …and a rescore-source INSERT with no setting');
select throws_ok($$ select set_config('fieldscout.final_week_rescore', gen_random_uuid()::text, true);
     insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
     values ('b9710000-0000-4000-8000-00000000000a', 2026, 1, 'c9710000-0000-4000-8000-000000000001', 'wr:9', 'pgtap-rsf-w3', 0, 'no_stat_row', 'rescore') $$,
  'P0001', null, 'G5 …a setting that names no audit row is refused (the exit needs the receipt)');
select set_config('fieldscout.final_week_rescore', (select id::text from commissioner_actions where league_id = 'b9710000-0000-4000-8000-00000000000a' and action_type = 'rescore_final_week'), true);
select throws_ok($$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
     values ('b9710000-0000-4000-8000-00000000000a', 2026, 2, 'c9710000-0000-4000-8000-000000000001', 'qb:0', 'pgtap-rsf-q1', 0, 'no_stat_row', 'rescore') $$,
  'P0001', null, 'G6 …week 1''s real audit row does not open WEEK 2 (the exit is per league-week)');
select throws_ok($$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
     values ('b9710000-0000-4000-8000-00000000000a', 2026, 1, 'c9710000-0000-4000-8000-000000000001', 'wr:9', 'pgtap-rsf-w3', 0, 'no_stat_row', 'worker') $$,
  'P0001', null, 'G7 …nor a row of any other source');
savepoint g8;
insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
values ('b9710000-0000-4000-8000-00000000000a', 2026, 1, 'c9710000-0000-4000-8000-000000000001', 'wr:9', 'pgtap-rsf-w3', 0, 'no_stat_row', 'rescore');
select is((select count(*)::int from league_week_player_points where slot = 'wr:9'), 1,
  'G8 the exit''s shape, exactly: THIS league-week''s audit row + a rescore row (a convention for the ordinary paths — R1262 — not a boundary against the service role)');
rollback to savepoint g8;
select set_config('fieldscout.final_week_rescore', '', true);
select set_config('pgtap.bf', public.score_backfill_player_points('b9710000-0000-4000-8000-00000000000a', 1, (select jsonb_agg(e) from jsonb_array_elements(pg_temp.batch1()) e where e ->> 'team_id' in ('c9710000-0000-4000-8000-000000000001', 'c9710000-0000-4000-8000-000000000002')))::text, true);
select is(current_setting('pgtap.bf')::jsonb -> 'skipped',
  '[{"reason": "already_stored", "team_id": "c9710000-0000-4000-8000-000000000001"}, {"reason": "already_stored", "team_id": "c9710000-0000-4000-8000-000000000002"}]'::jsonb,
  'G9 the ordinary backfill run afterwards finds the re-scored week already stored');

-- ---------------------------------------------------------------------------
-- H. total_points — the results rows' points
-- ---------------------------------------------------------------------------
select set_config('pgtap.h', pg_temp.try_rescore(1, '[
  {"team_id": "c9710000-0000-4000-8000-000000000006", "points": 25, "players": [{"slot": "qb:0", "player_id": "pgtap-rsf-q2", "points": 25, "pending": [], "reason": "scored"}]},
  {"team_id": "c9710000-0000-4000-8000-000000000007", "points": 22.5, "players": [{"slot": "qb:0", "player_id": "pgtap-rsf-w3", "points": 22.5, "pending": [], "reason": "scored"}]}]',
  '3c100000-0000-4000-8000-0000000000b1', false, p_league => 'b9710000-0000-4000-8000-00000000000b')::text, true);
select is(
  (select string_agg(r.team_id::text || '=' || r.points::text || ':' || r.is_final::text, ' ' order by r.team_id)
   from team_week_results r where r.league_id = 'b9710000-0000-4000-8000-00000000000b'),
  'c9710000-0000-4000-8000-000000000006=25.00:true c9710000-0000-4000-8000-000000000007=22.50:true',
  'H1 total_points: the final results rows carry the re-scored points (30 → 25, 20 → 22.50), still final');
select is(
  (select string_agg(p.team_id::text || '=' || p.points::text || ':' || p.source, ' ' order by p.team_id)
   from league_week_player_points p where p.league_id = 'b9710000-0000-4000-8000-00000000000b'),
  'c9710000-0000-4000-8000-000000000006=25.00:rescore c9710000-0000-4000-8000-000000000007=22.50:rescore',
  'H2 …and the per-player rows are stored with them');
select is(current_setting('pgtap.h')::jsonb ->> 'system_post',
  'Week 1 was re-scored: defense yards allowed were missing when it was first scored. No matchup result changed. 2 team scores changed; standings are updated.',
  'H3 …and the league is told, in plain words');
select is((select count(*)::int from commissioner_actions where league_id = 'b9710000-0000-4000-8000-00000000000b' and action_type = 'rescore_final_week'), 1,
  'H4 …with its ONE audit row');

select * from finish();
rollback;
