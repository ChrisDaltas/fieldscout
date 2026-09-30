-- ============================================================================
-- pgTAP 106 — migration 158: STORED PER-PLAYER POINTS + THE STANDARD
-- STAT-CORRECTION WINDOW (M5 task L.D3.11, FULL rigour — scoring and
-- standings; PROGRESS F405 as RULED by Chris 2026-09-28 — "okay lets stay in
-- line with standard platforms"; F268's post-window part; D422; spec §7.3.3 /
-- §7.3.6 / §11.4 / §23.4 v2.16.68).
--
-- THE RULING: (1) store each starter's points when a week is scored, so a box
-- score always adds up to its team's score; (2) the stat-correction window
-- runs to the NEXT week's first kickoff; (3) after that the week locks — later
-- corrections update the players' stats, never a locked week's scores,
-- results or stored per-player points.
--
--   §A  form: the table (columns, PK, FKs, CHECKs), RLS + the one SELECT
--       policy, the triggers (ENABLE ALWAYS), the functions (DEFINER / plain,
--       search_path, REVOKEd), the replaced door as a STORED-LITERAL md5 and
--       its 158 hunks reversed = 119's md5 (D137), the per-player arm's own
--       override exclusion (3 in all), the nfl_weeks column.
--   §B  per role (anon, an outsider, a member, the commissioner): SELECT,
--       and NO write with RETURNING counts; the two doors refuse a JWT.
--   §C  THE DOOR: the rows go WITH the score (Σ = score; pending ⇔ NULL),
--       an identical re-send writes nothing, a removed slot is removed, the
--       overridden / row-less team gets no rows, an old-shape element gets
--       none, total_points keeps a pending team's last rows, every refusal
--       of a malformed or non-adding-up batch by name (and nothing written).
--   §D  THE LOCK: a final week's rows refuse INSERT / UPDATE / DELETE (as
--       postgres — the table itself, not just the door); the door refuses
--       the week (week_final); the cascade of a deleted week passes; an
--       upcoming week holds none.
--   §E  THE WINDOW: the next week's first kickoff moves the window, a cleared
--       one restores the default, a direct write is the new default (the rule
--       still wins), the last week keeps its default, a new season's rows
--       derive on INSERT; and through the REAL finalize_matchups at the
--       boundary: the OLD Thursday 06:00 ET close + 1 h does NOT finalize,
--       kickoff − 1 s does not, the kickoff does.
--   §F  THE BACKFILL DOOR: recoverable (Σ = stored) on a final week,
--       unrecoverable (Σ ≠ stored) marked, ONCE (a re-run stores nothing),
--       an open week's mismatch skipped by name, overridden / no-score
--       skipped, an upcoming week refused, the flag off afterwards — and the
--       GOLDEN: every stored score and result byte-identical before / after.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(79);

-- M6 L.E2.2 (migration 172 — additive, the R992 shape): 172's five fenced
-- hunks reversed on the live body (pgTAP 120 §A pins the 172 body itself).
create function pg_temp.un172(p_src text) returns text language sql as $un172$
  select regexp_replace(p_src, E'[ ]*-- @172\\{[^@]*-- @172\\}\\n', '', 'g');
$un172$;

-- 158's four substitutions reversed (innermost first) — the D137 pin.
create function pg_temp.un158(p_src text) returns text language sql as $un158$
  select replace(replace(replace(replace(p_src,
    E'    ''skipped'',   v_skipped,\n    -- 158 (F405): the per-player arm''s own count. Its ABSENCE is how the\n    -- worker knows it is talking to a pre-158 door (it names that).\n    ''player_points'', jsonb_build_object(\n      ''teams_sent'',    cardinality(v_pp_teams),\n      ''teams_written'', cardinality(v_pp_write),\n      ''rows_written'',  v_pp_rows,\n      ''rows_removed'',  v_pp_gone),\n',
    E'    ''skipped'',   v_skipped,\n'),
    substring(p_src from position(E'  -- 158 (F405): THE PER-PLAYER ROWS FOLLOW THE SCORE.' in p_src)
                     for position(E'  RETURN jsonb_build_object(' in p_src) - position(E'  -- 158 (F405): THE PER-PLAYER ROWS FOLLOW THE SCORE.' in p_src)),
    ''),
    E'    -- 158 (F405): the OPTIONAL per-player arm — each starter''s points,\n    -- checked to BE the team''s score (Σ = points; pending ⇔ null) before\n    -- anything is written. An element without `players` writes no rows.\n    IF v_e ? ''players'' THEN\n      PERFORM public.player_points_rows_check_internal(''score_write_week_batch'', v_i, v_tid, v_e -> ''points'', v_e -> ''players'');\n      v_pp_teams := v_pp_teams || v_tid;\n    END IF;\n',
    ''),
    E'  v_pp_teams  UUID[] := ''{}'';   -- 158 (F405): teams whose element carries `players`\n  v_pp_write  UUID[] := ''{}'';   -- 158: …and whose score this call may write (the rows follow the score)\n  v_pp_rows   INTEGER := 0;     -- 158: per-player rows inserted or changed\n  v_pp_gone   INTEGER := 0;     -- 158: per-player rows removed (a slot no longer started)\n',
    '');
$un158$;

-- The GOLDEN digest: every stored score / result / status of the three fixture leagues.
create function pg_temp.pp_digest() returns text language sql as $dg$
  select coalesce((select md5(string_agg(m.id::text || ':' || coalesce(m.home_score::text, 'N') || ':' || coalesce(m.away_score::text, 'N')
                                   || ':' || coalesce(m.result, 'N') || ':' || m.status || ':' || m.is_overridden::text, '|' order by m.id))
                   from public.matchups m where m.league_id::text like 'b9600000-%'), 'none')
      || coalesce((select md5(string_agg(r.team_id::text || ':' || r.week || ':' || r.points::text || ':' || coalesce(r.h2h_result, 'N')
                                   || ':' || coalesce(r.is_final::text, 'N'), '|' order by r.team_id, r.week))
                   from public.team_week_results r where r.league_id::text like 'b9600000-%'), 'none');
$dg$;

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'league_week_player_points'),
  'league_id:uuid:NO,season:integer:NO,week:integer:NO,team_id:uuid:NO,slot:text:NO,player_id:text:NO,points:numeric:NO,pending:ARRAY:NO,reason:text:NO,source:text:NO,updated_at:timestamp with time zone:NO',
  'A1 league_week_player_points: one row per league / season / week / team / SLOT — the starter, his points, his pending keys, why, where from');
-- 161 (M5 L.D3.13, D425) re-pin, additive: the source CHECK gains `rescore` — every 158 value kept.
select is(
  (select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.contype, c.conname) from pg_constraint c
   where c.conrelid = 'public.league_week_player_points'::regclass),
  'CHECK (((reason <> ''no_stat_row''::text) OR ((points = (0)::numeric) AND (cardinality(pending) = 0)))) | '
  'CHECK ((reason = ANY (ARRAY[''scored''::text, ''no_stat_row''::text]))) | '
  'CHECK ((btrim(slot) <> ''''::text)) | '
  'CHECK ((source = ANY (ARRAY[''worker''::text, ''backfill''::text, ''backfill_unrecoverable''::text, ''rescore''::text]))) | '
  'FOREIGN KEY (league_id, season, week) REFERENCES league_weeks(league_id, season, week) ON DELETE CASCADE | '
  'FOREIGN KEY (player_id) REFERENCES players(id) | '
  'FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE | '
  'PRIMARY KEY (league_id, season, week, team_id, slot)',
  'A2 the four CHECKs (no_stat_row scores 0 and is never pending — Q42), the week / player / team FKs, keyed by SLOT (the terms of the team''s sum)');
select is(
  (select relrowsecurity::text || ':' || (select string_agg(polname || '=' || polcmd::text, ',') from pg_policy where polrelid = c.oid)
   from pg_class c where c.oid = 'public.league_week_player_points'::regclass),
  'true:Player points viewable by league members=r',
  'A3 RLS on, exactly ONE policy and it is SELECT (members) — no write policy for any role');
select is(
  (select string_agg(t.tgname || ':' || p.proname || ':' || t.tgenabled::text, ',' order by t.tgname)
   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and t.tgrelid in ('public.league_week_player_points'::regclass, 'public.nfl_weeks'::regclass)),
  'trg_league_week_player_points_lock:league_week_player_points_lock:A,trg_nfl_weeks_window_follow:nfl_weeks_window_follow:A,trg_nfl_weeks_window_row:nfl_weeks_window_row:A',
  'A4 three triggers, ENABLE ALWAYS (R616): the lock on the rows, the window row + follow pair on nfl_weeks');
select ok(
  (select bool_and(p.prosecdef = (p.proname in ('score_write_week_batch', 'score_backfill_player_points', 'league_week_player_points_lock'))
                   and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          and count(*) = 6
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('score_write_week_batch', 'score_backfill_player_points', 'player_points_rows_check_internal',
                       'league_week_player_points_lock', 'nfl_weeks_window_row', 'nfl_weeks_window_follow')),
  'A5 the two doors and the lock are SECURITY DEFINER (the lock reads the week as it IS, whoever writes — RLS stays the gate for a client), the three others plain; all six search_path empty and REVOKEd from anon and authenticated');
select ok(
  has_function_privilege('service_role', 'public.score_write_week_batch(uuid, integer, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.score_backfill_player_points(uuid, integer, jsonb)', 'EXECUTE'),
  'A6 …and the service role (the worker, the backfill CLI) can run both doors');
select is(
  (select md5(pg_temp.un172(prosrc)) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '548958d0a402c352c91c23fa924a2a0f',
  'A7 score_write_week_batch is 158''s body — a STORED LITERAL md5 (derive_158.py, 119:453-683 plus four hunks) — read under 172''s five fenced hunks reversed (pg_temp.un172; 120 A6 pins 172''s own)');
select is(
  (select md5(pg_temp.un158(pg_temp.un172(prosrc))) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  'ebacf6a5485b1883781fab7bcd26a19c',
  'A8 …and with 158''s four hunks reversed it is 119''s body BYTE FOR BYTE (D137 — every other byte is 119''s)');
select is(
  (select (length(prosrc) - length(replace(prosrc, 'NOT m.is_overridden', ''))) / length('NOT m.is_overridden')
   from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  3, 'A9 THREE `NOT m.is_overridden` exclusions now: 119''s two (the writable count, the one UPDATE — pgTAP 074 K1 on the reversed body) + the per-player arm''s own (an overridden team gets no rows)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'score_write_week_batch'),
  1, 'A10 …still ONE overload (074 K3): the per-player rows ride the same signature');
select is(
  (select data_type || ':' || is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'nfl_weeks' and column_name = 'correction_window_default_ends_at'),
  'timestamp with time zone:YES',
  'A11 nfl_weeks.correction_window_default_ends_at — the week''s Thursday 06:00 ET default, kept for when the next week''s kickoff is not known');
select is_empty(
  $$ select w.week from nfl_weeks w left join nfl_weeks n on n.season = w.season and n.week = w.week + 1
     where w.season = 2026
       and w.correction_window_ends_at is distinct from coalesce(n.first_kickoff_at, w.correction_window_default_ends_at) $$,
  'A12 THE RULE holds on every 2026 week as stored: its window = the next week''s first kickoff when recorded, else its default');
select results_eq(
  $$ select correction_window_default_ends_at from nfl_weeks where season = 2026 and week in (1, 8, 9) order by week $$,
  $$ values ('2026-09-17 06:00:00-04'::timestamptz), ('2026-11-05 06:00:00-05'::timestamptz), ('2026-11-12 06:00:00-05'::timestamptz) $$,
  'A13 …and the default is 039''s seed: Thursday 06:00 ET after the week (week 8 crosses the DST fall-back)');

-- ---------------------------------------------------------------------------
-- FIXTURES (postgres context, JWT cleared).
--   u1 commissioner of LA, u2 a manager in LA, u3 in no league.
--   LA h2h (ESPN Standard): week 1 FINAL, 2 CORRECTION_WINDOW, 3 LIVE, 4 upcoming.
--   LB total_points: week 3 LIVE.
--   LC h2h: week 5 CORRECTION_WINDOW, for the finalize boundary.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9f600000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-pp' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'pp_user' || i)::jsonb, now(), now()
from generate_series(1, 3) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id::uuid, '9f600000-0000-4000-8000-000000000001', l.name, 2026, 'in_season', 8, 10,
       case when l.name = 'pgtap-pp-LC' then 0 else 4 end, 11, 100,   -- LC: no bracket (its finalize runs the sync)
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.settings::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 2}], "bench": 3, "ir_slots": [], "swap_spots": 0}'
from (values ('b9600000-0000-4000-8000-00000000000a', 'pgtap-pp-LA', '{"schedule_mode": "h2h"}'),
             ('b9600000-0000-4000-8000-00000000000b', 'pgtap-pp-LB', '{"schedule_mode": "total_points"}'),
             ('b9600000-0000-4000-8000-00000000000c', 'pgtap-pp-LC', '{"schedule_mode": "h2h"}')) l(id, name, settings);

insert into teams (id, owner_id, name, league_id) values
 ('c9600000-0000-4000-8000-000000000001', '9f600000-0000-4000-8000-000000000001', 'PP T1', 'b9600000-0000-4000-8000-00000000000a'),
 ('c9600000-0000-4000-8000-000000000002', '9f600000-0000-4000-8000-000000000002', 'PP T2', 'b9600000-0000-4000-8000-00000000000a'),
 ('c9600000-0000-4000-8000-000000000003', '9f600000-0000-4000-8000-000000000001', 'PP T3', 'b9600000-0000-4000-8000-00000000000a'),
 ('c9600000-0000-4000-8000-000000000004', '9f600000-0000-4000-8000-000000000001', 'PP T4', 'b9600000-0000-4000-8000-00000000000a'),
 ('c9600000-0000-4000-8000-000000000005', '9f600000-0000-4000-8000-000000000001', 'PP T5', 'b9600000-0000-4000-8000-00000000000b'),
 ('c9600000-0000-4000-8000-000000000006', '9f600000-0000-4000-8000-000000000001', 'PP T6', 'b9600000-0000-4000-8000-00000000000b'),
 ('c9600000-0000-4000-8000-000000000007', '9f600000-0000-4000-8000-000000000001', 'PP T7', 'b9600000-0000-4000-8000-00000000000c'),
 ('c9600000-0000-4000-8000-000000000008', '9f600000-0000-4000-8000-000000000001', 'PP T8', 'b9600000-0000-4000-8000-00000000000c');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b9600000-0000-4000-8000-00000000000a', '9f600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000001', 'commissioner', false, 100),
 ('b9600000-0000-4000-8000-00000000000a', '9f600000-0000-4000-8000-000000000002', 'c9600000-0000-4000-8000-000000000002', 'manager',      false, 100);

insert into players (id, full_name, position, team, status) values
 ('pgtap-pp-q1', 'PP QB One', 'QB', 'KC', 'Active'),
 ('pgtap-pp-w1', 'PP WR One', 'WR', 'KC', 'Active'),
 ('pgtap-pp-w2', 'PP WR Two', 'WR', 'BUF', 'Active'),
 ('pgtap-pp-q2', 'PP QB Two', 'QB', 'BUF', 'Active'),
 ('pgtap-pp-w3', 'PP WR Three', 'WR', 'DAL', 'Active'),
 ('pgtap-pp-w4', 'PP WR Four', 'WR', 'PHI', 'Active');

insert into league_weeks (league_id, season, week, status) values
 ('b9600000-0000-4000-8000-00000000000a', 2026, 1, 'final'),
 ('b9600000-0000-4000-8000-00000000000a', 2026, 2, 'correction_window'),
 ('b9600000-0000-4000-8000-00000000000a', 2026, 3, 'live'),
 ('b9600000-0000-4000-8000-00000000000a', 2026, 4, 'upcoming'),
 ('b9600000-0000-4000-8000-00000000000b', 2026, 3, 'live'),
 ('b9600000-0000-4000-8000-00000000000c', 2026, 5, 'correction_window');

insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden) values
 -- LA week 1 (FINAL): T1 20.00 v T2 7.50; T3 v T4 overridden by the commissioner
 ('d9600000-0000-4000-8000-000000000011', 'b9600000-0000-4000-8000-00000000000a', 2026, 1, 'regular', 'c9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000002', 20.00, 7.50, 'final', 'home', false),
 ('d9600000-0000-4000-8000-000000000012', 'b9600000-0000-4000-8000-00000000000a', 2026, 1, 'regular', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004', 40.00, 41.00, 'final', 'away', true),
 -- LA week 2 (CORRECTION_WINDOW): T1 12.00 v T2 9.00; T3 v T4 live, T4 not yet stored
 ('d9600000-0000-4000-8000-000000000021', 'b9600000-0000-4000-8000-00000000000a', 2026, 2, 'regular', 'c9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000002', 12.00, 9.00, 'live', null, false),
 ('d9600000-0000-4000-8000-000000000022', 'b9600000-0000-4000-8000-00000000000a', 2026, 2, 'regular', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004', 6.00, 6.50, 'live', null, false),
 -- LA week 3 (LIVE): T1 v T2 unscored; T3 v T4 overridden
 ('d9600000-0000-4000-8000-000000000031', 'b9600000-0000-4000-8000-00000000000a', 2026, 3, 'regular', 'c9600000-0000-4000-8000-000000000001', 'c9600000-0000-4000-8000-000000000002', default, default, 'live', null, false),
 ('d9600000-0000-4000-8000-000000000032', 'b9600000-0000-4000-8000-00000000000a', 2026, 3, 'regular', 'c9600000-0000-4000-8000-000000000003', 'c9600000-0000-4000-8000-000000000004', 50.00, 51.00, 'live', 'away', true),
 -- LC week 5 (CORRECTION_WINDOW): scored, waiting for its window
 ('d9600000-0000-4000-8000-000000000051', 'b9600000-0000-4000-8000-00000000000c', 2026, 5, 'regular', 'c9600000-0000-4000-8000-000000000007', 'c9600000-0000-4000-8000-000000000008', 10.00, 9.00, 'live', null, false);
-- LB week 3: T6 already holds a FINAL total_points row (the door's result_final arm).
insert into team_week_results (league_id, team_id, season, week, points, is_final) values
 ('b9600000-0000-4000-8000-00000000000b', 'c9600000-0000-4000-8000-000000000006', 2026, 3, 33.00, true);

-- ---------------------------------------------------------------------------
-- C. THE DOOR — the rows go WITH the score
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[
  {"team_id": "c9600000-0000-4000-8000-000000000001", "points": 14.75, "players": [
     {"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 10.5, "pending": [], "reason": "scored"},
     {"slot": "wr:0", "player_id": "pgtap-pp-w1", "points": 4.25, "pending": [], "reason": "scored"},
     {"slot": "wr:1", "player_id": "pgtap-pp-w2", "points": 0, "pending": [], "reason": "no_stat_row"}]},
  {"team_id": "c9600000-0000-4000-8000-000000000002", "points": null, "players": [
     {"slot": "qb:0", "player_id": "pgtap-pp-q2", "points": 3.1, "pending": ["charted_placeholder"], "reason": "scored"},
     {"slot": "wr:0", "player_id": "pgtap-pp-w3", "points": 6, "pending": [], "reason": "scored"}]},
  {"team_id": "c9600000-0000-4000-8000-000000000003", "points": 8, "players": [
     {"slot": "qb:0", "player_id": "pgtap-pp-w4", "points": 8, "pending": [], "reason": "scored"}]}]')::text, true);
select is(current_setting('pgtap.r')::jsonb -> 'player_points',
  '{"teams_sent": 3, "teams_written": 2, "rows_written": 5, "rows_removed": 0}'::jsonb,
  'C1 the report''s player_points: 3 teams sent, 2 written (T1, T2) — T3''s only row this week is OVERRIDDEN, so its rows are not the door''s to write — 5 rows');
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 1,
  'C1b …and the scores as 119 wrote them: the one writable pairing row (T1 v T2)');
select is(
  (select string_agg(team_id::text || '/' || slot || '=' || player_id || ':' || points::text || ':' || array_to_string(pending, '+') || ':' || reason || ':' || source, ' ' order by team_id, slot)
   from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000a' and week = 3),
  'c9600000-0000-4000-8000-000000000001/qb:0=pgtap-pp-q1:10.50::scored:worker c9600000-0000-4000-8000-000000000001/wr:0=pgtap-pp-w1:4.25::scored:worker c9600000-0000-4000-8000-000000000001/wr:1=pgtap-pp-w2:0.00::no_stat_row:worker '
  'c9600000-0000-4000-8000-000000000002/qb:0=pgtap-pp-q2:3.10:charted_placeholder:scored:worker c9600000-0000-4000-8000-000000000002/wr:0=pgtap-pp-w3:6.00::scored:worker',
  'C2 GOLDEN (stored literal): T1''s three slots, T2''s two (the pending QB with his points so far and his key); nothing for the overridden T3');
select is(
  (select home_score::text || '/' || coalesce(away_score::text, 'NULL') from matchups where id = 'd9600000-0000-4000-8000-000000000031'),
  '14.75/NULL',
  'C3 …the stored score is their sum (10.50 + 4.25 + 0.00 = 14.75) and T2 is pending (NULL, E61) exactly as its rows say');
select set_config('pgtap.r', public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[
  {"team_id": "c9600000-0000-4000-8000-000000000001", "points": 14.75, "players": [
     {"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 10.5, "pending": [], "reason": "scored"},
     {"slot": "wr:0", "player_id": "pgtap-pp-w1", "points": 4.25, "pending": [], "reason": "scored"},
     {"slot": "wr:1", "player_id": "pgtap-pp-w2", "points": 0, "pending": [], "reason": "no_stat_row"}]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb ->> 'reason') || ' ' || (current_setting('pgtap.r')::jsonb -> 'player_points')::text,
  'no_change {"teams_sent": 1, "rows_removed": 0, "rows_written": 0, "teams_written": 1}',
  'C4 an IDENTICAL re-send writes nothing — no score (no_change) and no row (rows_written 0)');
select set_config('pgtap.r', public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[
  {"team_id": "c9600000-0000-4000-8000-000000000001", "points": 12.5, "players": [
     {"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 12.5, "pending": [], "reason": "scored"}]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb -> 'player_points')::text
  || ' ' || (select string_agg(slot || '=' || points::text, ',' order by slot) from league_week_player_points
             where team_id = 'c9600000-0000-4000-8000-000000000001' and week = 3)
  || ' ' || (select home_score::text from matchups where id = 'd9600000-0000-4000-8000-000000000031'),
  '{"teams_sent": 1, "rows_removed": 2, "rows_written": 1, "teams_written": 1} qb:0=12.50 12.5',
  'C5 a slot the team no longer starts is REMOVED (2), a changed one rewritten (1) — the rows stay exactly the terms of the stored 12.50');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 13, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 12.5, "pending": [], "reason": "scored"}]}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c9600000-0000-4000-8000-000000000001) players add up to 12.5 but points is 13 — the stored lines must add up to the stored score (F405, §7.3.3)',
  'C6 THE ROWS ARE THE SCORE: players that do not add up to the points are REFUSED by name');
select is(
  (select home_score::text || ':' || (select string_agg(points::text, ',') from league_week_player_points where team_id = 'c9600000-0000-4000-8000-000000000001' and week = 3)
   from matchups where id = 'd9600000-0000-4000-8000-000000000031'),
  '12.5:12.50', 'C6b …and NOTHING was written: the score (as the door stored it) and its row as they were');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": null, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 12.5, "pending": [], "reason": "scored"}]}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c9600000-0000-4000-8000-000000000001) is sent pending (points null) but no player is pending — the stored lines must BE the score (E61)',
  'C7 a pending team with no pending player is refused');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 12.5, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 12.5, "pending": ["charted_placeholder"], "reason": "scored"}]}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c9600000-0000-4000-8000-000000000001) carries a number but a player is pending — a pending player makes the team pending (E61)',
  'C8 …and a number with a pending player is refused');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 12.505, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 12.505, "pending": [], "reason": "scored"}]}]') $$,
  '22023', null, 'C9 three decimals refused (F22 — the worker rounds each player; the door never does)');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 12, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 6, "pending": [], "reason": "scored"}, {"slot": "qb:0", "player_id": "pgtap-pp-w1", "points": 6, "pending": [], "reason": "scored"}]}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c9600000-0000-4000-8000-000000000001) slot qb:0 appears twice',
  'C10 a slot twice refused');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 2, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 2, "pending": [], "reason": "no_stat_row"}]}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c9600000-0000-4000-8000-000000000001) slot qb:0 has no stat line, so it scores 0 and is never pending (Q42)',
  'C11 a no-line starter with points refused (Q42: 0 by name)');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 2, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 2, "pending": [], "reason": "bonus"}]}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c9600000-0000-4000-8000-000000000001) slot qb:0 reason must be scored or no_stat_row (got bonus)',
  'C12 an unknown reason refused');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 2, "players": {"slot": "qb:0"}}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c9600000-0000-4000-8000-000000000001) players must be a JSON array of {slot, player_id, points, pending, reason} (got object)',
  'C13 players that is not an array refused');
select set_config('pgtap.r', public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3,
  '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 11}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb -> 'player_points')::text || ' ' || (current_setting('pgtap.r')::jsonb ->> 'written')
  || ' ' || coalesce((select string_agg(slot || '=' || points::text, ',') from league_week_player_points where team_id = 'c9600000-0000-4000-8000-000000000001' and week = 3), 'none'),
  '{"teams_sent": 0, "rows_removed": 1, "rows_written": 0, "teams_written": 0} 1 none',
  'C14 an OLD-SHAPE element ({team_id, points} — every pre-158 fixture) writes the score as 119 did, and takes the team''s old rows WITH it: no stale row outlives the score it added up to');
-- total_points: a number ⇒ rows; the final row ⇒ none; pending ⇒ the door keeps the last value AND its rows.
select set_config('pgtap.r', public.score_write_week_batch('b9600000-0000-4000-8000-00000000000b', 3, '[
  {"team_id": "c9600000-0000-4000-8000-000000000005", "points": 7, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 7, "pending": [], "reason": "scored"}]},
  {"team_id": "c9600000-0000-4000-8000-000000000006", "points": 9, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q2", "points": 9, "pending": [], "reason": "scored"}]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb -> 'player_points')::text || ' '
  || (select string_agg(team_id::text || '=' || points::text, ',' order by team_id) from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000b'),
  '{"teams_sent": 2, "rows_removed": 0, "rows_written": 1, "teams_written": 1} c9600000-0000-4000-8000-000000000005=7.00',
  'C15 total_points: T5''s provisional row gets its rows; T6 holds a FINAL row, so neither its score nor its rows are written');
select set_config('pgtap.r', public.score_write_week_batch('b9600000-0000-4000-8000-00000000000b', 3, '[
  {"team_id": "c9600000-0000-4000-8000-000000000005", "points": null, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 7, "pending": ["charted_placeholder"], "reason": "scored"}]}]')::text, true);
select is(
  (select points::text from team_week_results where team_id = 'c9600000-0000-4000-8000-000000000005' and week = 3)
  || ' ' || (select points::text || ':' || cardinality(pending) from league_week_player_points where team_id = 'c9600000-0000-4000-8000-000000000005'),
  '7.00 7.00:0',
  'C16 …a pending total_points team: the door keeps the provisional 7.00 (F259(d)) and the rows stay the ones that ADD UP to it');

-- ---------------------------------------------------------------------------
-- D. THE LOCK — a final week's rows never change
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
     values ('b9600000-0000-4000-8000-00000000000a', 2026, 1, 'c9600000-0000-4000-8000-000000000001', 'qb:0', 'pgtap-pp-q1', 20, 'scored', 'worker') $$,
  'P0001', null, 'D1 an INSERT into a FINAL week is refused even as postgres (week_locked) — the table itself, not just the door');
select throws_ok(
  $$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
     values ('b9600000-0000-4000-8000-00000000000a', 2026, 4, 'c9600000-0000-4000-8000-000000000001', 'qb:0', 'pgtap-pp-q1', 1, 'scored', 'worker') $$,
  'P0001', 'league_week_player_points: week_not_open — league b9600000-0000-4000-8000-00000000000a week 4 is upcoming; nothing has been scored',
  'D2 an UPCOMING week holds no rows');
-- Week 2 (correction window) is scored through the door, then walks to final.
select set_config('pgtap.r', public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 2, '[
  {"team_id": "c9600000-0000-4000-8000-000000000001", "points": 12, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 12, "pending": [], "reason": "scored"}]}]')::text, true);
select is((select count(*)::int from league_week_player_points where week = 2 and team_id = 'c9600000-0000-4000-8000-000000000001'), 1,
  'D3 a CORRECTION-WINDOW week is open: the door stores its rows (a correction inside the window re-scores, unchanged)');
update league_weeks set status = 'final' where league_id = 'b9600000-0000-4000-8000-00000000000a' and week = 2;
select throws_ok(
  $$ update league_week_player_points set points = 15 where team_id = 'c9600000-0000-4000-8000-000000000001' and week = 2 $$,
  'P0001', 'league_week_player_points: week_locked — league b9600000-0000-4000-8000-00000000000a week 2 is final; its stored per-player points never change (F405: a later stat correction updates player_stats, never a locked week — the commissioner''s audited score override is the one change to a final week, §11.4)',
  'D4 once the week is FINAL its rows refuse an UPDATE (as postgres) — by name');
select throws_ok(
  $$ delete from league_week_player_points where team_id = 'c9600000-0000-4000-8000-000000000001' and week = 2 $$,
  'P0001', null, 'D5 …and a DELETE');
select throws_ok(
  $$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 2, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 15, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 15, "pending": [], "reason": "scored"}]}]') $$,
  'P0001', 'score_write_week_batch: week_final — league b9600000-0000-4000-8000-00000000000a week 2 is final; a post-window delta changes no league cell (D295, §23.4)',
  'D6 …and the door refuses the week (119''s week_final, unchanged): a late correction reaches no league cell');
select is(
  (select points::text || '|' || (select home_score::text from matchups where id = 'd9600000-0000-4000-8000-000000000021')
   from league_week_player_points where team_id = 'c9600000-0000-4000-8000-000000000001' and week = 2),
  '12.00|12.00', 'D7 …so the locked week''s stored row and score are byte-identical');
select throws_ok(
  $$ select set_config('fieldscout.player_points_backfill', 'on', true);
     update league_week_player_points set points = 15 where team_id = 'c9600000-0000-4000-8000-000000000001' and week = 2 $$,
  'P0001', null, 'D8 the backfill flag opens INSERT only — never an UPDATE of a locked row');
select set_config('fieldscout.player_points_backfill', 'off', true);
-- The cascade of a deleted final week passes the lock (a deleted league takes its rows).
savepoint d10;
delete from matchups where league_id = 'b9600000-0000-4000-8000-00000000000a' and week = 2;
delete from league_weeks where league_id = 'b9600000-0000-4000-8000-00000000000a' and week = 2;
select is((select count(*)::int from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000a' and week = 2), 0,
  'D10 deleting the FINAL week row cascades its rows — the lock guards rows whose week still stands');
rollback to savepoint d10;
select is((select count(*)::int from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000a' and week = 2), 1,
  'D10b …(rolled back: the row is still there for §F)');

-- ---------------------------------------------------------------------------
-- B. ROLES — members read, nobody writes (RETURNING counts), JWT refused
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from league_week_player_points), 0, 'B1 anon reads no rows');
select results_eq($$ with w as (update league_week_player_points set points = 0 returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B2 anon: UPDATE touches 0 rows');
select throws_ok($$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
  values ('b9600000-0000-4000-8000-00000000000a', 2026, 3, 'c9600000-0000-4000-8000-000000000001', 'x:0', 'pgtap-pp-q1', 1, 'scored', 'worker') $$,
  '42501', null, 'B3 anon: INSERT refused (RLS, 42501)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f600000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is((select count(*)::int from league_week_player_points), 0, 'B4 a signed-in OUTSIDER reads no rows (not a member of any league)');
select results_eq($$ with w as (delete from league_week_player_points returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B5 the outsider: DELETE touches 0 rows');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f600000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*)::int from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000a'), 3,
  'B6 a league MEMBER reads his league''s rows (the box score''s read — week 3''s T1 + T2 rows and week 2''s)');
select is((select count(*)::int from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000b'), 0,
  'B7 …and none of a league he is not in');
select results_eq($$ with w as (update league_week_player_points set points = 99 where team_id = 'c9600000-0000-4000-8000-000000000002' returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B8 the member: UPDATE of his own team''s rows touches 0 rows');
select throws_ok($$ select public.score_write_week_batch('b9600000-0000-4000-8000-00000000000a', 3, '[{"team_id": "c9600000-0000-4000-8000-000000000002", "points": 1}]') $$,
  '42501', null, 'B9 the member cannot run the scoring door (REVOKEd)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq($$ with w as (delete from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000a' returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B10 the COMMISSIONER: DELETE touches 0 rows — his audited override is the only change he makes to a score, and it never writes these');
select throws_ok($$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
  values ('b9600000-0000-4000-8000-00000000000a', 2026, 3, 'c9600000-0000-4000-8000-000000000001', 'x:0', 'pgtap-pp-q1', 1, 'scored', 'worker') $$,
  '42501', null, 'B11 the COMMISSIONER cannot INSERT (RLS, 42501)');
select throws_ok($$ select public.score_backfill_player_points('b9600000-0000-4000-8000-00000000000a', 1, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 1, "players": []}]') $$,
  '42501', null, 'B12 …nor run the backfill door (REVOKEd)');
reset role;
-- The in-body refusal (rule 2): a JWT reaching either door as a privileged role.
select set_config('request.jwt.claims', '{"sub": "9f600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.score_backfill_player_points('b9600000-0000-4000-8000-00000000000a', 1, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 0, "players": []}]') $$,
  '42501', 'score_backfill_player_points: the backfill door is the operator''s (service role), never a signed-in user''s',
  'B13 the backfill door refuses a signed-in caller IN-BODY');
select set_config('request.jwt.claims', '', true);
select ok(not has_table_privilege('anon', 'public.league_week_player_points', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.league_week_player_points', 'TRUNCATE'),
  'B14 no TRUNCATE for anon or authenticated (133''s default ACL)');

-- ---------------------------------------------------------------------------
-- F. THE BACKFILL DOOR (and the GOLDEN: no stored score moves)
-- ---------------------------------------------------------------------------
select set_config('pgtap.g0', pg_temp.pp_digest(), true);
-- Week 1 (FINAL): T1 recomputes to its stored 20.00 (recoverable); T2 to 8.00 against a stored 7.50
-- (a correction after the week was scored — unrecoverable); T3 is overridden-only.
select set_config('pgtap.r', public.score_backfill_player_points('b9600000-0000-4000-8000-00000000000a', 1, '[
  {"team_id": "c9600000-0000-4000-8000-000000000001", "points": 20, "players": [
     {"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 14, "pending": [], "reason": "scored"},
     {"slot": "wr:0", "player_id": "pgtap-pp-w1", "points": 6, "pending": [], "reason": "scored"}]},
  {"team_id": "c9600000-0000-4000-8000-000000000002", "points": 8, "players": [
     {"slot": "qb:0", "player_id": "pgtap-pp-q2", "points": 8, "pending": [], "reason": "scored"}]},
  {"team_id": "c9600000-0000-4000-8000-000000000003", "points": 40, "players": [
     {"slot": "qb:0", "player_id": "pgtap-pp-w4", "points": 40, "pending": [], "reason": "scored"}]}]')::text, true);
select is(current_setting('pgtap.r')::jsonb -> 'written',
  '[{"rows": 2, "source": "backfill", "stored": [20.00], "team_id": "c9600000-0000-4000-8000-000000000001", "recomputed": 20},
    {"rows": 1, "source": "backfill_unrecoverable", "stored": [7.50], "team_id": "c9600000-0000-4000-8000-000000000002", "recomputed": 8}]'::jsonb,
  'F1 a FINAL week: T1 adds up to its stored 20.00 ⇒ backfill (RECOVERABLE); T2 recomputes to 8 against a stored 7.50 ⇒ stored once, marked backfill_unrecoverable');
select is(current_setting('pgtap.r')::jsonb -> 'skipped',
  '[{"reason": "overridden", "team_id": "c9600000-0000-4000-8000-000000000003"}]'::jsonb,
  'F2 …T3''s only pairing row is the commissioner''s number: skipped by name');
select is(
  (select string_agg(team_id::text || '/' || slot || '=' || points::text || ':' || source, ' ' order by team_id, slot)
   from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000a' and week = 1),
  'c9600000-0000-4000-8000-000000000001/qb:0=14.00:backfill c9600000-0000-4000-8000-000000000001/wr:0=6.00:backfill c9600000-0000-4000-8000-000000000002/qb:0=8.00:backfill_unrecoverable',
  'F3 GOLDEN (stored literal): the rows landed on the FINAL week — the lock''s one INSERT exit, the backfill''s own flag');
select is(current_setting('fieldscout.player_points_backfill', true), 'off', 'F4 …and the door turned the flag OFF behind it');
select throws_ok(
  $$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
     values ('b9600000-0000-4000-8000-00000000000a', 2026, 1, 'c9600000-0000-4000-8000-000000000004', 'qb:0', 'pgtap-pp-q1', 41, 'scored', 'backfill') $$,
  'P0001', null, 'F5 …so a later hand-written backfill-source INSERT on the final week is refused again');
select set_config('pgtap.r', public.score_backfill_player_points('b9600000-0000-4000-8000-00000000000a', 1, '[
  {"team_id": "c9600000-0000-4000-8000-000000000001", "points": 21, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 21, "pending": [], "reason": "scored"}]},
  {"team_id": "c9600000-0000-4000-8000-000000000002", "points": 7.5, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q2", "points": 7.5, "pending": [], "reason": "scored"}]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb -> 'skipped')::text || ' ' || (current_setting('pgtap.r')::jsonb ->> 'reason')
  || ' ' || (select string_agg(points::text, ',' order by team_id, slot) from league_week_player_points where league_id = 'b9600000-0000-4000-8000-00000000000a' and week = 1),
  '[{"reason": "already_stored", "team_id": "c9600000-0000-4000-8000-000000000001"}, {"reason": "already_stored", "team_id": "c9600000-0000-4000-8000-000000000002"}] nothing_written 14.00,6.00,8.00',
  'F6 ONCE: a second backfill of a stored team-week stores nothing (already_stored) — the rows are byte-identical');
-- Week 2 is FINAL (§D) and T1 is stored; LA week 3 is LIVE: T2 has rows (worker), T4 has none and a live score.
select set_config('pgtap.r', public.score_backfill_player_points('b9600000-0000-4000-8000-00000000000c', 5, '[
  {"team_id": "c9600000-0000-4000-8000-000000000007", "points": 10, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 10, "pending": [], "reason": "scored"}]},
  {"team_id": "c9600000-0000-4000-8000-000000000008", "points": 9.5, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q2", "points": 9.5, "pending": [], "reason": "scored"}]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb -> 'written')::text || ' ' || (current_setting('pgtap.r')::jsonb -> 'skipped')::text,
  '[{"rows": 1, "source": "backfill", "stored": [10.00], "team_id": "c9600000-0000-4000-8000-000000000007", "recomputed": 10}] '
  '[{"reason": "open_week_mismatch", "stored": [9.00], "team_id": "c9600000-0000-4000-8000-000000000008", "recomputed": 9.5}]',
  'F7 an OPEN (correction-window) week: T7 adds up ⇒ stored; T8 does not ⇒ SKIPPED by name (open_week_mismatch — the worker re-scores an open week and stores its rows with the score)');
select throws_ok(
  $$ select public.score_backfill_player_points('b9600000-0000-4000-8000-00000000000a', 4, '[{"team_id": "c9600000-0000-4000-8000-000000000001", "points": 0, "players": []}]') $$,
  'P0001', 'score_backfill_player_points: week_not_open — league b9600000-0000-4000-8000-00000000000a week 4 is upcoming; nothing has been scored',
  'F8 an UPCOMING week is refused');
select set_config('pgtap.r', public.score_backfill_player_points('b9600000-0000-4000-8000-00000000000b', 3, '[
  {"team_id": "c9600000-0000-4000-8000-000000000006", "points": 33, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q2", "points": 33, "pending": [], "reason": "scored"}]}]')::text, true);
select is((current_setting('pgtap.r')::jsonb -> 'written' -> 0 ->> 'source'), 'backfill',
  'F9 total_points: T6''s stored 33.00 (its final row) matches ⇒ stored');
select throws_ok(
  $$ select public.score_backfill_player_points('b9600000-0000-4000-8000-00000000000a', 1, '[{"team_id": "c9600000-0000-4000-8000-000000000004", "points": 41, "players": [{"slot": "qb:0", "player_id": "pgtap-pp-q1", "points": 40, "pending": [], "reason": "scored"}]}]') $$,
  '22023', 'score_backfill_player_points: element 1 (team c9600000-0000-4000-8000-000000000004) players add up to 40 but points is 41 — the stored lines must add up to the stored score (F405, §7.3.3)',
  'F10 the backfill runs the SAME check: rows that do not add up to the sent total are refused');
select is(
  pg_temp.pp_digest(),
  current_setting('pgtap.g0'),
  'F11 THE GOLDEN: every stored score, result and status (matchups) and every results row is byte-identical before and after the backfill — including the unrecoverable T2 (7.50 stays 7.50)');

-- ---------------------------------------------------------------------------
-- E. THE WINDOW — the next week's first kickoff
-- ---------------------------------------------------------------------------
update nfl_weeks set first_kickoff_at = '2026-09-18 00:15:00+00' where season = 2026 and week = 2;
select is(
  (select correction_window_ends_at::text || ' | ' || correction_window_default_ends_at::text from nfl_weeks where season = 2026 and week = 1),
  '2026-09-18 00:15:00+00 | 2026-09-17 10:00:00+00',
  'E1 week 2''s first kickoff (Thu 20:15 ET) IS week 1''s window end — later than the old Thursday 06:00 ET, which stays as the default');
update nfl_weeks set first_kickoff_at = null where season = 2026 and week = 2;
select is((select correction_window_ends_at::text from nfl_weeks where season = 2026 and week = 1), '2026-09-17 10:00:00+00',
  'E2 a cleared kickoff restores the default (a suite that stamps and clears leaves the calendar as it found it)');
update nfl_weeks set correction_window_ends_at = '2026-09-17 12:00:00+00' where season = 2026 and week = 1;
select is(
  (select correction_window_ends_at::text || ' | ' || correction_window_default_ends_at::text from nfl_weeks where season = 2026 and week = 1),
  '2026-09-17 12:00:00+00 | 2026-09-17 12:00:00+00',
  'E3 a direct write of the window (no next-week kickoff known) is honoured and becomes the default');
update nfl_weeks set first_kickoff_at = '2026-09-18 00:15:00+00' where season = 2026 and week = 2;
update nfl_weeks set correction_window_ends_at = '2026-09-17 11:00:00+00' where season = 2026 and week = 1;
select is(
  (select correction_window_ends_at::text || ' | ' || correction_window_default_ends_at::text from nfl_weeks where season = 2026 and week = 1),
  '2026-09-18 00:15:00+00 | 2026-09-17 11:00:00+00',
  'E4 …but with the next week''s kickoff known the RULE wins: the write is the new default, the window stays the kickoff');
update nfl_weeks set correction_window_ends_at = correction_window_ends_at where season = 2026 and week = 1;
update nfl_weeks set correction_window_ends_at = '2026-09-18 00:15:00+00' where season = 2026 and week = 1;
select is(
  (select correction_window_ends_at::text || ' | ' || correction_window_default_ends_at::text from nfl_weeks where season = 2026 and week = 1),
  '2026-09-18 00:15:00+00 | 2026-09-17 11:00:00+00',
  'E4b (R1261) a write of the value the window already holds, or of the next week''s kickoff, is NOT a new default — the Thursday default survives');
update nfl_weeks set first_kickoff_at = '2027-01-09 21:30:00+00' where season = 2026 and week = 18;
select is(
  (select string_agg(week || '=' || correction_window_ends_at::text, ',' order by week) from nfl_weeks where season = 2026 and week in (17, 18)),
  '17=2027-01-09 21:30:00+00,18=2027-01-14 11:00:00+00',
  'E5 week 18''s kickoff moves week 17''s window; week 18 (no week 19 on the calendar) keeps its default');
insert into nfl_weeks (season, week, starts_at, first_kickoff_at, correction_window_ends_at) values
  (2031, 2, '2031-09-17 04:00:00+00', '2031-09-19 00:15:00+00', '2031-09-25 10:00:00+00');
insert into nfl_weeks (season, week, starts_at, correction_window_ends_at) values
  (2031, 1, '2031-09-10 04:00:00+00', '2031-09-18 10:00:00+00');
insert into nfl_weeks (season, week, starts_at, first_kickoff_at, correction_window_ends_at) values
  (2031, 3, '2031-09-24 04:00:00+00', '2031-09-26 00:15:00+00', '2031-10-02 10:00:00+00');
select is(
  (select string_agg(week || '=' || correction_window_ends_at::text || '/' || correction_window_default_ends_at::text, ',' order by week) from nfl_weeks where season = 2031),
  '1=2031-09-19 00:15:00+00/2031-09-18 10:00:00+00,2=2031-09-26 00:15:00+00/2031-09-25 10:00:00+00,3=2031-10-02 10:00:00+00/2031-10-02 10:00:00+00',
  'E6 a new season''s rows derive in ANY insert order: week 1 (inserted after week 2) takes week 2''s kickoff at INSERT; week 2 takes week 3''s when week 3 arrives; the given windows are the defaults');
-- THE BOUNDARY through the REAL finalize_matchups (LC week 5; every game final).
update nfl_weeks set first_kickoff_at = null, last_game_ends_at = '2026-10-13 04:00:00+00' where season = 2026 and week = 5;
delete from nfl_games where season = 2026 and week = 5;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('pp-w5-a', 2026, 5, 'KC', 'BUF', '2026-10-09 00:15:00+00', 'final'),
 ('pp-w5-b', 2026, 5, 'DAL', 'PHI', '2026-10-12 00:20:00+00', 'final');
update nfl_weeks set first_kickoff_at = '2026-10-16 00:15:00+00' where season = 2026 and week = 6;
select is(
  (select correction_window_ends_at::text || ' | ' || correction_window_default_ends_at::text from nfl_weeks where season = 2026 and week = 5),
  '2026-10-16 00:15:00+00 | 2026-10-15 10:00:00+00',
  'E7 (premise) week 5''s window = week 6''s first kickoff, Thu 2026-10-15 20:15 ET; the old close was 06:00 ET that morning');
select set_config('pgtap.r', public.finalize_matchups('2026-10-15 11:00:00+00', 'b9600000-0000-4000-8000-00000000000c')::text, true);
select is((select status from league_weeks where league_id = 'b9600000-0000-4000-8000-00000000000c' and week = 5), 'correction_window',
  'E8 at the OLD close + 1 h (Thu 07:00 ET) the week is NOT final — the window now runs to the next week''s kickoff (F405)');
select set_config('pgtap.r', public.finalize_matchups('2026-10-16 00:14:59+00', 'b9600000-0000-4000-8000-00000000000c')::text, true);
select is((select status from league_weeks where league_id = 'b9600000-0000-4000-8000-00000000000c' and week = 5), 'correction_window',
  'E9 one second before week 6''s first kickoff: still in its window');
select set_config('pgtap.r', public.finalize_matchups('2026-10-16 00:15:00+00', 'b9600000-0000-4000-8000-00000000000c')::text, true);
select is(
  (select lw.status || ':' || m.status || ':' || m.result from league_weeks lw join matchups m on m.league_id = lw.league_id and m.week = lw.week
   where lw.league_id = 'b9600000-0000-4000-8000-00000000000c' and lw.week = 5),
  'final:final:home',
  'E10 AT the kickoff the week is FINAL (10.00 v 9.00 — the home side) and locked');
select is(
  (select points::text from league_week_player_points where team_id = 'c9600000-0000-4000-8000-000000000007' and week = 5),
  '10.00', 'E11 …and T7''s stored row (§F) is now a locked week''s row');
select throws_ok(
  $$ update league_week_player_points set points = 11 where team_id = 'c9600000-0000-4000-8000-000000000007' and week = 5 $$,
  'P0001', null, 'E12 …which refuses a change');

select * from finish();
rollback;
