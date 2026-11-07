-- ============================================================================
-- pgTAP 171 — migration 222: OUR OWN STAT FIXES RE-SCORE FINAL WEEKS,
-- AUTOMATICALLY AND QUIETLY, IN EVERY LEAGUE (F870 / F871 / F890 follow-on;
-- FULL rigour — scoring, results, standings, production writes; PROGRESS
-- D836–D839; spec v2.16.118).
--
-- THE RULINGS (Chris, verbatim): 2026-11-07 "the stats need to be correct.
-- that should be done automatically, we should not be doing this is as some
-- live code change."; "stat and scoring changes are all platform wide by the
-- way, they are not gated to users or leagues."; "fixing stats should not go
-- to some user, i'm not following"; "just update the points as they should be
-- so we can move on." Standing: F405 / Q81 — a provider's late correction
-- never changes a final week.
--
--   §A  form: three zero-policy tables, no client privilege, append-only
--       triggers ENABLE ALWAYS, the receipt frozen with its league (212); four
--       DEFINER functions, search_path '', EXECUTE for the owner and the
--       service role ONLY (exact ACLs); the source CHECK gains stat_fix; the
--       lock's prosrc a stored-literal md5 and 222's hunk + words reversed =
--       161's md5 (D137); the trigger still ENABLE ALWAYS.
--   §B  roles: anon / authenticated cannot run any of them; a JWT reaching
--       them as a privileged role is refused in-body.
--   §C  record_stat_fix / mark_stat_fix_written: every refusal by name; a
--       good fix stored line by line, NOT written; marked written once,
--       idempotently.
--   §D  stat_fix_targets: every state by name (applied, owed, league_archived,
--       league_not_in_season, bracket_built, week_not_final,
--       week_scored_after_fix); an unwritten fix targets nothing.
--   §E  the door's refusals, by name, and nothing written by any of them:
--       unwritten fix, a week the fix doesn't move, not in season, bracket,
--       week not final, last scored after the fix landed, batch incomplete,
--       lineup = the STORED rows (slot_map disagrees on purpose), plan_stale,
--       rows_drift, shape (no `stored`; an apply with no fix), and (round 6)
--       a row moving for a player the fix does not name (`row_not_in_fix`) —
--       (round 7) in THIS week: one it names only in another week, or one
--       only another written fix names, is refused too.
--   §F  the dry run: the apply's own document, NOTHING persists.
--   §G  the apply: score + E38 result in one statement (the flip), the
--       overridden matchup's score kept and ITS TEAM'S PLAYERS moved by the
--       fix all the same (Chris 2026-11-06), the rows `stat_fix`
--       (stored + the change), Σ rows = score, results + median rebuilt (a
--       median flips for a team the fix never touched), ONE receipt — and
--       QUIET: no commissioner_actions row, no league_chat post, no
--       notification.
--   §H  idempotent: a replay returns the document (replayed), no second
--       receipt; a fix that moves nothing writes its receipt (the pass never
--       asks again).
--   §I  THE LOCK: the exit opens only with THIS league-week's receipt in the
--       setting, for an UPDATE that keeps slot and starter and says
--       stat_fix; every other write to a final week is refused; the
--       provider's path (score_write_week_batch) still raises week_final.
--   §J  total_points: the results row re-scored, rows stored.
--   §K  append-only: every edit refused by name; an unapplied fix may be
--       withdrawn (its lines go with it), an applied one may not.
--   §L  round-5 fixes: the landing is required; ONE MOVE, PAID ONCE (a move a
--       written fix holds is refused by record_stat_fix and, under its lock,
--       by mark_stat_fix_written); p_supersedes (the fill finishing a run that
--       failed); week_scored_after_fix reads the CLOSE STAMP, not
--       finalization — a week closed before an engine fix landed and
--       finalized after it is owed, and (round 6) the door applies it. No
--       assertion sits in a rolled-back savepoint at the end (finish() counts
--       every one).
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(109);

-- 222's hunk and words reversed — the D137 pin (161's file text byte for byte).
create function pg_temp.un222(p_src text) returns text language sql as $un$
  select replace(
           replace(p_src,
             substring(p_src from position(E'    -- 222 (F870 follow-on' in p_src)
                              for position(E'    RAISE EXCEPTION ''league_week_player_points: week_locked' in p_src)
                                  - position(E'    -- 222 (F870 follow-on' in p_src)),
             ''),
           '(F405: a provider''''s later stat correction updates player_stats, never a locked week — only a stat fix of our own re-scores one, through apply_stat_fix_week, §11.4 / §23.4)',
           '(F405: a later stat correction updates player_stats, never a locked week — the commissioner''''s audited score override is the one change to a final week, §11.4)');
$un$;

-- Everything a stat fix could move, for the fixture leagues (the "nothing persisted" digest).
create function pg_temp.sf_digest() returns text language sql as $dg$
  select md5(
       coalesce((select string_agg(m.id::text || ':' || coalesce(m.home_score::text, 'N') || ':' || coalesce(m.away_score::text, 'N')
                                   || ':' || coalesce(m.result, 'N') || ':' || m.status, '|' order by m.id)
                 from public.matchups m where m.league_id::text like 'b9720000-%'), '')
    || '#' || coalesce((select string_agg(r.team_id::text || ':' || r.week || ':' || r.points::text || ':' || coalesce(r.h2h_result, 'N')
                                   || ':' || coalesce(r.median_result, 'N'), '|' order by r.team_id, r.week)
                 from public.team_week_results r where r.league_id::text like 'b9720000-%'), '')
    || '#' || coalesce((select string_agg(w.league_id::text || ':' || w.week || ':' || w.status || ':' || coalesce(w.median_score::text, 'N'), '|' order by w.league_id, w.week)
                 from public.league_weeks w where w.league_id::text like 'b9720000-%'), '')
    || '#' || coalesce((select string_agg(p.team_id::text || ':' || p.week || ':' || p.slot || ':' || p.points::text || ':' || p.source, '|' order by p.team_id, p.week, p.slot)
                 from public.league_week_player_points p where p.league_id::text like 'b9720000-%'), '')
    || '#' || (select count(*) from public.stat_fix_rescores x where x.league_id::text like 'b9720000-%')
    || '#' || (select count(*) from public.commissioner_actions a where a.league_id::text like 'b9720000-%')
    || '#' || (select count(*) from public.league_chat c where c.league_id::text like 'b9720000-%')
    || '#' || (select count(*) from public.notifications n where n.user_id::text like '9f720000-%'));
$dg$;

-- The week-1 batch of league A: every team, every STORED row, stored + the fix
-- (the pass computes it — T1's kicker +7.00, T4's quarterback +5.00: T4's
-- score is the commissioner's and stays, its quarterback's row moves).
create function pg_temp.batch_a() returns jsonb language sql as $b$
  select '[
    {"team_id": "c9720000-0000-4000-8000-000000000001", "points": 102, "players": [
       {"slot": "k:0",  "player_id": "pgtap-sfx-k1", "points": 47, "pending": [], "reason": "scored", "stored": 40},
       {"slot": "qb:0", "player_id": "pgtap-sfx-q1", "points": 55, "pending": [], "reason": "scored", "stored": 55}]},
    {"team_id": "c9720000-0000-4000-8000-000000000002", "points": 101, "players": [
       {"slot": "k:0",  "player_id": "pgtap-sfx-k2", "points": 40, "pending": [], "reason": "scored", "stored": 40},
       {"slot": "qb:0", "player_id": "pgtap-sfx-q2", "points": 61, "pending": [], "reason": "scored", "stored": 61}]},
    {"team_id": "c9720000-0000-4000-8000-000000000003", "points": 96, "players": [
       {"slot": "qb:0", "player_id": "pgtap-sfx-q3", "points": 96, "pending": [], "reason": "scored", "stored": 96}]},
    {"team_id": "c9720000-0000-4000-8000-000000000004", "points": 85, "players": [
       {"slot": "qb:0", "player_id": "pgtap-sfx-q4", "points": 85, "pending": [], "reason": "scored", "stored": 80}]}]'::jsonb;
$b$;

create function pg_temp.fix(p_fix uuid, p_league uuid, p_week int, p_teams jsonb, p_dry boolean)
  returns jsonb language sql as $r$
  select public.apply_stat_fix_week(p_fix, p_league, p_week, p_teams, p_dry);
$r$;

-- Every apply / dry run whose SUCCESS is asserted goes through this handler, so a
-- broken body reds cells BY NAME instead of aborting the file (the D378 shape).
create function pg_temp.try_fix(p_fix uuid, p_league uuid, p_week int, p_teams jsonb, p_dry boolean)
  returns jsonb language plpgsql as $t$
begin
  return pg_temp.fix(p_fix, p_league, p_week, p_teams, p_dry);
exception when others then
  return jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
end;
$t$;

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(c.relname || ':' || c.relrowsecurity || ':' || (select count(*) from pg_policies p where p.tablename = c.relname), ' ' order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('stat_fixes', 'stat_fix_lines', 'stat_fix_rescores')),
  'stat_fix_lines:true:0 stat_fix_rescores:true:0 stat_fixes:true:0',
  'A1 the three tables: RLS on, ZERO policies');
select is(
  (select string_agg(c.relname || '=' || c.relacl::text, ' ' order by c.relname) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname in ('stat_fixes', 'stat_fix_lines', 'stat_fix_rescores')),
  'stat_fix_lines={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres} stat_fix_rescores={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres} stat_fixes={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}',
  'A2 …and EXACTLY the owner and the service role hold privileges (no anon, no authenticated — not even TRUNCATE)');
select is(
  (select string_agg(p.proname || '=' || p.prosecdef || ':' || array_to_string(p.proconfig, ',') || ':' || p.proacl::text, ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('apply_stat_fix_week', 'record_stat_fix', 'mark_stat_fix_written', 'stat_fix_targets')),
  'apply_stat_fix_week=true:search_path="":{postgres=X/postgres,service_role=X/postgres} '
  'mark_stat_fix_written=true:search_path="":{postgres=X/postgres,service_role=X/postgres} '
  'record_stat_fix=true:search_path="":{postgres=X/postgres,service_role=X/postgres} '
  'stat_fix_targets=true:search_path="":{postgres=X/postgres,service_role=X/postgres}',
  'A3 the four functions: SECURITY DEFINER, search_path '''', EXECUTE for the owner and the service role ONLY (exact ACLs)');
select is(
  (select string_agg(t.tgname || ':' || t.tgenabled::text, ' ' order by t.tgname) from pg_trigger t
   where not t.tgisinternal and t.tgrelid in ('public.stat_fixes'::regclass, 'public.stat_fix_lines'::regclass, 'public.stat_fix_rescores'::regclass)),
  'tr_aa_league_archived_guard:O trg_stat_fix_lines_guard:A trg_stat_fix_lines_no_truncate:A trg_stat_fix_rescores_guard:A trg_stat_fix_rescores_no_truncate:A trg_stat_fixes_guard:A trg_stat_fixes_no_truncate:A',
  'A4 append-only triggers ENABLE ALWAYS (R616) on all three; the receipt carries 212''s archive freeze (162 A3''s census)');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'league_week_player_points_source_check'),
  'CHECK ((source = ANY (ARRAY[''worker''::text, ''backfill''::text, ''backfill_unrecoverable''::text, ''rescore''::text, ''stat_fix''::text])))',
  'A5 the source CHECK gains stat_fix (every earlier value kept)');
select is(md5((select prosrc from pg_proc where proname = 'league_week_player_points_lock')),
  'bd4f53b8e4b4e4870f9b2be642a54fdf', 'A6 the lock''s prosrc is 222''s (stored literal)');
select is(md5(pg_temp.un222((select prosrc from pg_proc where proname = 'league_week_player_points_lock'))),
  'bc1ac0492d7b05c75aa212d7e9e0d990', 'A7 D137: 222''s one hunk and its words reversed on the LIVE body = 161''s prosrc byte for byte');
select is((select tgenabled::text from pg_trigger where tgname = 'trg_league_week_player_points_lock'),
  'A', 'A8 the lock trigger is still ENABLE ALWAYS');

-- ---------------------------------------------------------------------------
-- FIXTURES (postgres, JWT cleared). Season 2097 (no other test names it).
--   LA h2h, median game ON, ESPN Standard, in season. Week 1 FINAL
--   (finalized 2097-09-20): T1 95.00 v T2 101.00 (Two wins); T3 v T4
--   OVERRIDDEN 96–80. Stored rows: T1 qb q1 55 + k k1 40; T2 qb q2 61 + k k2
--   40; T3 q3 96; T4 q4 80. T1's slot_map says k9 kicks — a commissioner's
--   edit after the week was final (201): the score did not follow, and a fix
--   must not make it count. Week 2 FINAL but finalized 2097-10-05 (after the
--   fix landed); week 3 correction_window.
--   LB in the playoffs, LC in season with a bracket, LD total_points (week 1
--   final: T7 p7 30, T8 p8 20), LE archived — each holding week 1.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9f720000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'authenticated', 'authenticated', 'pgtap-sfx' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'sfx_user' || i)::jsonb, now(), now()
from generate_series(1, 3) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id::uuid, '9f720000-0000-4000-8000-000000000001', l.name, 2097, l.status, 8, 10, 4, 11, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.settings::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "k", "label": "K", "eligible": ["K"], "count": 1}], "bench": 3, "ir_slots": [{"key": "ir", "label": "IR", "count": 1}], "swap_spots": 0}'
from (values ('b9720000-0000-4000-8000-00000000000a', 'pgtap-sfx-LA', 'in_season', '{"schedule_mode": "h2h", "median_game": true}'),
             ('b9720000-0000-4000-8000-00000000000b', 'pgtap-sfx-LB', 'playoffs',  '{"schedule_mode": "h2h"}'),
             ('b9720000-0000-4000-8000-00000000000c', 'pgtap-sfx-LC', 'in_season', '{"schedule_mode": "h2h"}'),
             ('b9720000-0000-4000-8000-00000000000d', 'pgtap-sfx-LD', 'in_season', '{"schedule_mode": "total_points"}'),
             ('b9720000-0000-4000-8000-00000000000e', 'pgtap-sfx-LE', 'in_season', '{"schedule_mode": "h2h"}')) l(id, name, status, settings);

insert into teams (id, owner_id, name, league_id) values
 ('c9720000-0000-4000-8000-000000000001', '9f720000-0000-4000-8000-000000000001', 'SF One',   'b9720000-0000-4000-8000-00000000000a'),
 ('c9720000-0000-4000-8000-000000000002', '9f720000-0000-4000-8000-000000000002', 'SF Two',   'b9720000-0000-4000-8000-00000000000a'),
 ('c9720000-0000-4000-8000-000000000003', '9f720000-0000-4000-8000-000000000001', 'SF Three', 'b9720000-0000-4000-8000-00000000000a'),
 ('c9720000-0000-4000-8000-000000000004', '9f720000-0000-4000-8000-000000000003', 'SF Four',  'b9720000-0000-4000-8000-00000000000a'),
 ('c9720000-0000-4000-8000-000000000007', '9f720000-0000-4000-8000-000000000001', 'SF Seven', 'b9720000-0000-4000-8000-00000000000d'),
 ('c9720000-0000-4000-8000-000000000008', '9f720000-0000-4000-8000-000000000001', 'SF Eight', 'b9720000-0000-4000-8000-00000000000d'),
 ('c9720000-0000-4000-8000-000000000009', '9f720000-0000-4000-8000-000000000001', 'SF Nine',  'b9720000-0000-4000-8000-00000000000c'),
 ('c9720000-0000-4000-8000-00000000000a', '9f720000-0000-4000-8000-000000000001', 'SF Ten',   'b9720000-0000-4000-8000-00000000000c');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b9720000-0000-4000-8000-00000000000a', '9f720000-0000-4000-8000-000000000001', 'c9720000-0000-4000-8000-000000000001', 'commissioner', false, 100),
 ('b9720000-0000-4000-8000-00000000000a', '9f720000-0000-4000-8000-000000000002', 'c9720000-0000-4000-8000-000000000002', 'manager',      false, 100),
 ('b9720000-0000-4000-8000-00000000000a', '9f720000-0000-4000-8000-000000000003', 'c9720000-0000-4000-8000-000000000004', 'manager',      false, 100);

insert into players (id, full_name, position, team, status) values
 ('pgtap-sfx-q1', 'SFX QB One', 'QB', 'KC', 'Active'),  ('pgtap-sfx-k1', 'SFX K One', 'K', 'KC', 'Active'),
 ('pgtap-sfx-q2', 'SFX QB Two', 'QB', 'BUF', 'Active'), ('pgtap-sfx-k2', 'SFX K Two', 'K', 'BUF', 'Active'),
 ('pgtap-sfx-q3', 'SFX QB Three', 'QB', 'DAL', 'Active'), ('pgtap-sfx-q4', 'SFX QB Four', 'QB', 'PHI', 'Active'),
 ('pgtap-sfx-k9', 'SFX K Bench', 'K', 'PHI', 'Active'),
 ('pgtap-sfx-p7', 'SFX RB Seven', 'RB', 'SF', 'Active'), ('pgtap-sfx-p8', 'SFX RB Eight', 'RB', 'SEA', 'Active');

insert into nfl_weeks (season, week, starts_at, first_kickoff_at, last_game_ends_at, correction_window_ends_at) values
 (2097, 1, '2097-09-08T04:00:00Z', '2097-09-10T00:15:00Z', '2097-09-14T04:00:00Z', '2097-09-17T00:15:00Z'),
 (2097, 2, '2097-09-15T04:00:00Z', '2097-09-17T00:15:00Z', '2097-09-21T04:00:00Z', '2097-09-24T00:15:00Z'),
 (2097, 3, '2097-09-22T04:00:00Z', '2097-09-24T00:15:00Z', '2097-09-28T04:00:00Z', '2097-10-01T00:15:00Z');
insert into league_weeks (league_id, season, week, status) values
 ('b9720000-0000-4000-8000-00000000000a', 2097, 1, 'correction_window'),
 ('b9720000-0000-4000-8000-00000000000a', 2097, 2, 'correction_window'),
 ('b9720000-0000-4000-8000-00000000000a', 2097, 3, 'correction_window'),
 ('b9720000-0000-4000-8000-00000000000b', 2097, 1, 'correction_window'),
 ('b9720000-0000-4000-8000-00000000000c', 2097, 1, 'correction_window'),
 ('b9720000-0000-4000-8000-00000000000d', 2097, 1, 'correction_window'),
 ('b9720000-0000-4000-8000-00000000000e', 2097, 1, 'correction_window');

insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden) values
 ('d9720000-0000-4000-8000-000000000011', 'b9720000-0000-4000-8000-00000000000a', 2097, 1, 'regular', 'c9720000-0000-4000-8000-000000000001', 'c9720000-0000-4000-8000-000000000002', 95.00, 101.00, 'final', 'away', false),
 ('d9720000-0000-4000-8000-000000000012', 'b9720000-0000-4000-8000-00000000000a', 2097, 1, 'regular', 'c9720000-0000-4000-8000-000000000003', 'c9720000-0000-4000-8000-000000000004', 96.00, 80.00, 'final', 'home', true);
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, home_seed, away_seed, status) values
 ('b9720000-0000-4000-8000-00000000000c', 2097, 1, 'playoff', 'c9720000-0000-4000-8000-000000000009', 'c9720000-0000-4000-8000-00000000000a', 1, 2, 'scheduled');
insert into team_week_results (league_id, team_id, season, week, points, is_final) values
 ('b9720000-0000-4000-8000-00000000000d', 'c9720000-0000-4000-8000-000000000007', 2097, 1, 30.00, false),
 ('b9720000-0000-4000-8000-00000000000d', 'c9720000-0000-4000-8000-000000000008', 2097, 1, 20.00, false);

insert into team_lineups (team_id, season, week, starters, bench, slot_map) values
 ('c9720000-0000-4000-8000-000000000001', 2097, 1, '[]', '[]', '{"qb:0": "pgtap-sfx-q1", "k:0": "pgtap-sfx-k9"}'),
 ('c9720000-0000-4000-8000-000000000002', 2097, 1, '[]', '[]', '{"qb:0": "pgtap-sfx-q2", "k:0": "pgtap-sfx-k2"}'),
 ('c9720000-0000-4000-8000-000000000003', 2097, 1, '[]', '[]', '{"qb:0": "pgtap-sfx-q3"}'),
 ('c9720000-0000-4000-8000-000000000004', 2097, 1, '[]', '[]', '{"qb:0": "pgtap-sfx-q4"}');

-- The rows the worker stored with the scores (an open week takes them).
insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source) values
 ('b9720000-0000-4000-8000-00000000000a', 2097, 1, 'c9720000-0000-4000-8000-000000000001', 'qb:0', 'pgtap-sfx-q1', 55, 'scored', 'worker'),
 ('b9720000-0000-4000-8000-00000000000a', 2097, 1, 'c9720000-0000-4000-8000-000000000001', 'k:0',  'pgtap-sfx-k1', 40, 'scored', 'worker'),
 ('b9720000-0000-4000-8000-00000000000a', 2097, 1, 'c9720000-0000-4000-8000-000000000002', 'qb:0', 'pgtap-sfx-q2', 61, 'scored', 'worker'),
 ('b9720000-0000-4000-8000-00000000000a', 2097, 1, 'c9720000-0000-4000-8000-000000000002', 'k:0',  'pgtap-sfx-k2', 40, 'scored', 'worker'),
 ('b9720000-0000-4000-8000-00000000000a', 2097, 1, 'c9720000-0000-4000-8000-000000000003', 'qb:0', 'pgtap-sfx-q3', 96, 'scored', 'worker'),
 ('b9720000-0000-4000-8000-00000000000a', 2097, 1, 'c9720000-0000-4000-8000-000000000004', 'qb:0', 'pgtap-sfx-q4', 80, 'scored', 'worker'),
 ('b9720000-0000-4000-8000-00000000000d', 2097, 1, 'c9720000-0000-4000-8000-000000000007', 'rb:0', 'pgtap-sfx-p7', 30, 'scored', 'worker'),
 ('b9720000-0000-4000-8000-00000000000d', 2097, 1, 'c9720000-0000-4000-8000-000000000008', 'rb:0', 'pgtap-sfx-p8', 20, 'scored', 'worker');

update league_weeks set status = 'final', finalized_at = '2097-09-20T12:00:00Z'
 where league_id::text like 'b9720000-%' and week = 1;
update league_weeks set status = 'final', finalized_at = '2097-10-05T12:00:00Z'
 where league_id = 'b9720000-0000-4000-8000-00000000000a' and week = 2;
-- The results as finalization writes them (the rebuild — the SAME helper).
select public.rebuild_team_week_results('b9720000-0000-4000-8000-00000000000a', 1);
select public.rebuild_team_week_results('b9720000-0000-4000-8000-00000000000d', 1);
update leagues set deleted_at = now() where id = 'b9720000-0000-4000-8000-00000000000e';

select is(
  (select string_agg(r.team_id::text || '=' || r.points::text || ':' || r.h2h_result || ':' || r.median_result, ' ' order by r.team_id)
   from team_week_results r where r.league_id = 'b9720000-0000-4000-8000-00000000000a' and r.week = 1)
  || ' median ' || (select median_score::text from league_weeks where league_id = 'b9720000-0000-4000-8000-00000000000a' and week = 1),
  'c9720000-0000-4000-8000-000000000001=95.00:loss:loss c9720000-0000-4000-8000-000000000002=101.00:win:win '
  'c9720000-0000-4000-8000-000000000003=96.00:win:win c9720000-0000-4000-8000-000000000004=80.00:loss:loss median 95.50',
  'P1 PREMISE — week 1 as scored: Two 101 beats One 95; the median (95.50) has Two and Three winning');

-- ---------------------------------------------------------------------------
-- B. ROLES
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[]', null) $$, '42501', null, 'B1 anon cannot record a fix (REVOKEd)');
select throws_ok($$ select public.apply_stat_fix_week(null, 'b9720000-0000-4000-8000-00000000000a', 1, '[]', true) $$, '42501', null, 'B2 …nor run the door');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f720000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select * from public.stat_fix_targets(false, 1, null) $$, '42501', null, 'B3 the COMMISSIONER cannot read what is owed (REVOKEd)');
select throws_ok($$ select public.mark_stat_fix_written(gen_random_uuid()) $$, '42501', null, 'B4 …nor mark a fix written');
select throws_ok($$ select public.apply_stat_fix_week(null, 'b9720000-0000-4000-8000-00000000000a', 1, '[]', true) $$, '42501', null, 'B5 …nor run the door');
select throws_ok($$ select count(*) from stat_fixes $$, '42501', null, 'B6 …and a client cannot read a fix at all (no privilege; zero policies behind it)');
reset role;
select set_config('request.jwt.claims', '{"sub": "9f720000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.apply_stat_fix_week(null, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), true) $$,
  '42501', 'apply_stat_fix_week: a stat fix is the platform''s (service role), never a signed-in user''s',
  'B7 a JWT reaching the door as a privileged role is refused IN-BODY');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 0, "after": 1}]', null) $$,
  '42501', 'record_stat_fix: a stat fix is the platform''s (service role), never a signed-in user''s',
  'B8 …and so is one reaching record_stat_fix');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- C. RECORDING A FIX
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.record_stat_fix(2097, E' \t', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 0, "after": 1}]', null) $$,
  '22023', 'record_stat_fix: the reason (plain words — what we fixed and why) is required and at most 500 characters (got 0)', 'C1 a blank reason is refused');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[]', null) $$,
  '22023', 'record_stat_fix: p_lines must be a non-empty JSON array of {week, player_id, stat_key, before, after}', 'C2 a fix with no line is refused');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "updated_at", "before": 0, "after": 1}]', null) $$,
  '22023', 'record_stat_fix: line 1 stat_key updated_at is not a numeric player_stats stat column', 'C3 a key that is not a numeric stat column is refused BY NAME');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "season", "before": 0, "after": 1}]', null) $$,
  '22023', 'record_stat_fix: line 1 stat_key season is not a numeric player_stats stat column', 'C4 …and so is the line''s own key column');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-nobody", "stat_key": "fg_0_39", "before": 0, "after": 1}]', null) $$,
  '22023', 'record_stat_fix: line 1 names player pgtap-sfx-nobody, whom players does not know', 'C5 an unknown player is refused');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 1, "after": 1}]', null) $$,
  '22023', 'record_stat_fix: line 1 (week 1, pgtap-sfx-k1, fg_0_39) does not move (1 → 1) — a fix names only what it changed', 'C6 a line that does not move is refused');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 0, "after": 1}, {"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 0, "after": 2}]', null) $$,
  '22023', 'record_stat_fix: week 1 player pgtap-sfx-k1 stat fg_0_39 appears twice', 'C7 the same (week, player, stat) twice is refused');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 0, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 0, "after": 1}]', null) $$,
  '22023', 'record_stat_fix: line 1 week must be a whole number 1–22 (got 0)', 'C8 a week outside 1–22 is refused');

-- F1: the fix this file applies. F0: recorded, never written.
select set_config('pgtap.f1', public.record_stat_fix(2097, '  the ruled kicking plays the feed map left empty  ', '[
  {"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 0, "after": 2},
  {"week": 1, "player_id": "pgtap-sfx-q4", "stat_key": "pass_tds", "before": 1, "after": 2},
  {"week": 1, "player_id": "pgtap-sfx-p7", "stat_key": "rush_tds", "before": 0, "after": 1},
  {"week": 2, "player_id": "pgtap-sfx-q1", "stat_key": "pass_tds", "before": 0, "after": 1},
  {"week": 3, "player_id": "pgtap-sfx-q1", "stat_key": "pass_tds", "before": 0, "after": 1}]', '2097-10-01T12:00:00Z')::text, true);
select set_config('pgtap.f0', public.record_stat_fix(2097, 'never confirmed', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_missed", "before": 0, "after": 1}]', '2097-10-01T12:00:00Z')::text, true);
select is(
  (select f.season || '|' || f.reason || '|' || f.landed_at::text || '|' || (f.written_at is null)::text from stat_fixes f where f.id = current_setting('pgtap.f1')::uuid)
  || ' ' || (select string_agg(l.week || ':' || l.player_id || ':' || l.stat_key || ':' || l.before_value || '→' || l.after_value, ',' order by l.week, l.player_id)
             from stat_fix_lines l where l.fix_id = current_setting('pgtap.f1')::uuid),
  '2097|the ruled kicking plays the feed map left empty|2097-10-01 12:00:00+00|true 1:pgtap-sfx-k1:fg_0_39:0→2,1:pgtap-sfx-p7:rush_tds:0→1,1:pgtap-sfx-q4:pass_tds:1→2,2:pgtap-sfx-q1:pass_tds:0→1,3:pgtap-sfx-q1:pass_tds:0→1',
  'C9 a good fix is stored line by line (the reason trimmed, the landing as given) — and NOT written');
select is((public.mark_stat_fix_written(current_setting('pgtap.f1')::uuid) ->> 'already_written'), 'false', 'C10 mark_stat_fix_written writes it');
select is((public.mark_stat_fix_written(current_setting('pgtap.f1')::uuid) ->> 'already_written'), 'true', 'C11 …idempotently, and says so');
select throws_ok($$ select public.mark_stat_fix_written('f9720000-0000-4000-8000-0000000000ff') $$,
  'P0002', 'mark_stat_fix_written: stat fix f9720000-0000-4000-8000-0000000000ff not found', 'C12 an unknown fix is refused (P0002)');

-- ---------------------------------------------------------------------------
-- D. WHAT IS OWED
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(t.league_id::text || ':' || t.week || ':' || t.state, ' ' order by t.league_id, t.week)
   from public.stat_fix_targets(false, 1, array['b9720000-0000-4000-8000-00000000000a', 'b9720000-0000-4000-8000-00000000000b',
        'b9720000-0000-4000-8000-00000000000c', 'b9720000-0000-4000-8000-00000000000d', 'b9720000-0000-4000-8000-00000000000e']::uuid[]) t
   where t.fix_id = current_setting('pgtap.f1')::uuid),
  'b9720000-0000-4000-8000-00000000000a:1:owed b9720000-0000-4000-8000-00000000000a:2:week_scored_after_fix b9720000-0000-4000-8000-00000000000a:3:week_not_final '
  'b9720000-0000-4000-8000-00000000000b:1:league_not_in_season b9720000-0000-4000-8000-00000000000c:1:bracket_built '
  'b9720000-0000-4000-8000-00000000000d:1:owed b9720000-0000-4000-8000-00000000000e:1:league_archived',
  'D1 every (fix, league, week) and its state, by name — only an in-season, unbracketed league''s week, final and last scored BEFORE the fix landed, is owed');
select is(
  (select count(*)::int from public.stat_fix_targets(false, 1, array['b9720000-0000-4000-8000-00000000000a']::uuid[]) t where t.fix_id = current_setting('pgtap.f0')::uuid),
  0, 'D2 an UNWRITTEN fix targets nothing');
select is(
  (select string_agg(t.league_id::text || ':' || t.week, ' ' order by t.league_id) from public.stat_fix_targets(true, 10, array['b9720000-0000-4000-8000-00000000000a', 'b9720000-0000-4000-8000-00000000000d']::uuid[]) t),
  'b9720000-0000-4000-8000-00000000000a:1 b9720000-0000-4000-8000-00000000000d:1', 'D3 the pass''s read: the owed ones only');
select throws_ok($$ select * from public.stat_fix_targets(true, 0, null) $$, '22023', null, 'D4 the pass''s read needs a positive limit');

-- ---------------------------------------------------------------------------
-- E. THE DOOR'S REFUSALS — by name, and nothing written by any of them
-- ---------------------------------------------------------------------------
select set_config('pgtap.g0', pg_temp.sf_digest(), true);
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), false) $$, current_setting('pgtap.f0')),
  'P0001', format('apply_stat_fix_week: fix_not_written — stat fix %s is recorded but not confirmed written; nothing is applied from it', current_setting('pgtap.f0')),
  'E1 an UNWRITTEN fix applies nowhere');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 4, pg_temp.batch_a(), false) $$, current_setting('pgtap.f1')),
  'P0001', format('apply_stat_fix_week: week_not_in_fix — stat fix %s moves nothing in week 4', current_setting('pgtap.f1')),
  'E2 a week the fix does not move is refused');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000b', 1, pg_temp.batch_a(), false) $$, current_setting('pgtap.f1')),
  'P0001', 'apply_stat_fix_week: league_not_in_season — league b9720000-0000-4000-8000-00000000000b is playoffs (a bracket or a champion already reads these results)',
  'E3 a league in the playoffs is refused by name');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000c', 1, pg_temp.batch_a(), false) $$, current_setting('pgtap.f1')),
  'P0001', 'apply_stat_fix_week: bracket_built — league b9720000-0000-4000-8000-00000000000c already has playoff rows for season 2097; they were seeded from the standings this would change',
  'E4 a league whose bracket is built is refused by name');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000e', 1, pg_temp.batch_a(), false) $$, current_setting('pgtap.f1')),
  'P0002', 'apply_stat_fix_week: league b9720000-0000-4000-8000-00000000000e not found', 'E5 an ARCHIVED league is not found');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 3, pg_temp.batch_a(), false) $$, current_setting('pgtap.f1')),
  'P0001', 'apply_stat_fix_week: week_not_final — league b9720000-0000-4000-8000-00000000000a week 3 is correction_window; an open week is the score worker''s',
  'E6 a week still open is the worker''s');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 2, pg_temp.batch_a(), false) $$, current_setting('pgtap.f1')),
  'P0001', format('apply_stat_fix_week: week_scored_after_fix — league b9720000-0000-4000-8000-00000000000a week 2 was last scored 2097-10-05 12:00:00+00, after stat fix %s landed (2097-10-01 12:00:00+00): it was scored with the fix already', current_setting('pgtap.f1')),
  'E7 a week last scored AFTER the fix landed (no close stamp: a pre-216 week, so its finalization) was scored with it already — never paid twice');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, (select jsonb_agg(e) from jsonb_array_elements(pg_temp.batch_a()) e where e ->> 'team_id' <> 'c9720000-0000-4000-8000-000000000004'), false) $$, current_setting('pgtap.f1')),
  'P0001', 'apply_stat_fix_week: batch_incomplete — league b9720000-0000-4000-8000-00000000000a week 1 has 1 team(s) the batch does not name ({c9720000-0000-4000-8000-000000000004}); a week is fixed whole or not at all',
  'E8 a PARTIAL week is refused by name');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, jsonb_set(pg_temp.batch_a(), '{0,players,0}', '{"slot": "k:0", "player_id": "pgtap-sfx-k9", "points": 47, "pending": [], "reason": "scored", "stored": 40}'), false) $$, current_setting('pgtap.f1')),
  'P0001', 'apply_stat_fix_week: lineup_mismatch — team c9720000-0000-4000-8000-000000000001 week 1: the stored rows score [k:0=pgtap-sfx-k1,qb:0=pgtap-sfx-q1] but the batch scores [k:0=pgtap-sfx-k9,qb:0=pgtap-sfx-q1]',
  'E9 the lineup is what was SCORED: a batch built from slot_map (the commissioner''s after-the-fact edit, k9) is refused by name');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, jsonb_set(pg_temp.batch_a(), '{0,players,0,stored}', '39'), false) $$, current_setting('pgtap.f1')),
  'P0001', 'apply_stat_fix_week: plan_stale — league b9720000-0000-4000-8000-00000000000a week 1: 1 stored row(s) moved since the plan read them ([{"slot": "k:0", "stored": 40.00, "team_id": "c9720000-0000-4000-8000-000000000001", "planned_from": 39}]); plan again',
  'E10 a plan read from rows that have moved since is refused — a fix is never written over another');
savepoint e11;
update matchups set home_score = 96.00 where id = 'd9720000-0000-4000-8000-000000000011';
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), false) $$, current_setting('pgtap.f1')),
  'P0001', 'apply_stat_fix_week: rows_drift — league b9720000-0000-4000-8000-00000000000a week 1: 1 stored score(s) are not the sum of their stored rows ([{"cell": 96.00, "team_id": "c9720000-0000-4000-8000-000000000001", "rows_sum": 95.00}]); a stat fix adds our change to what was scored and cannot here',
  'E11 a stored score its rows do not add up to (unrecoverable, never backfilled) is refused by name — never "fixed" silently');
rollback to savepoint e11;
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a() #- '{0,players,0,stored}', false) $$, current_setting('pgtap.f1')),
  '22023', 'apply_stat_fix_week: element 1 (team c9720000-0000-4000-8000-000000000001) slot k:0 has no stored number — every row names the points the plan read',
  'E12 a row without the points it was planned from is refused');
select throws_ok($$ select pg_temp.fix(null, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), false) $$,
  '22023', 'apply_stat_fix_week: p_fix_id is required to apply (only a dry run plans lines not yet recorded)', 'E13 an apply needs a recorded fix');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, jsonb_set(pg_temp.batch_a(), '{0,points}', '103'), false) $$, current_setting('pgtap.f1')),
  '22023', 'apply_stat_fix_week: element 1 (team c9720000-0000-4000-8000-000000000001) players add up to 102 but points is 103 — the stored lines must add up to the stored score (F405, §7.3.3)',
  'E14 rows that do not add up to the score are refused (158''s one check, called)');
-- Round 6: Two's kicker (k2) is in no line of F1's week 1 — a batch that moves his row anyway (40 → 43, Two's score with it,
-- so every earlier check passes) is not our change. G1 is the normal apply: every row it moves is a player F1 names.
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, jsonb_set(jsonb_set(pg_temp.batch_a(), '{1,players,0,points}', '43'), '{1,points}', '104'), false) $$, current_setting('pgtap.f1')),
  'P0001', format('apply_stat_fix_week: row_not_in_fix — league b9720000-0000-4000-8000-00000000000a week 1: 1 row(s) move for a player stat fix %s does not name in this week ([{"slot": "k:0", "points": 43, "stored": 40.00, "team_id": "c9720000-0000-4000-8000-000000000002", "player_id": "pgtap-sfx-k2"}]); a stat fix moves only the players it names', current_setting('pgtap.f1')),
  'E15 a batch moving a starter the fix does not name is refused BY NAME — the door''s own backstop, not only the planner''s (a provider''s correction is never paid, F405)');
-- Round 7: the backstop names THIS fix's players in THIS week only. One's quarterback (q1) is in F1 — in weeks 2 and 3,
-- never week 1 — so a batch moving his week-1 row (55 → 60, One's score with it) is not F1's change in week 1.
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, jsonb_set(jsonb_set(pg_temp.batch_a(), '{0,players,1,points}', '60'), '{0,points}', '107'), false) $$, current_setting('pgtap.f1')),
  'P0001', format('apply_stat_fix_week: row_not_in_fix — league b9720000-0000-4000-8000-00000000000a week 1: 1 row(s) move for a player stat fix %s does not name in this week ([{"slot": "qb:0", "points": 60, "stored": 55.00, "team_id": "c9720000-0000-4000-8000-000000000001", "player_id": "pgtap-sfx-q1"}]); a stat fix moves only the players it names', current_setting('pgtap.f1')),
  'E16 …and a player the fix names in ANOTHER week is refused in this one (q1: F1''s weeks 2 and 3, not 1)');
-- …and Two's quarterback (q2) is named in week 1 by ANOTHER written fix (fx), never by F1: fx's line is not F1's.
select set_config('pgtap.fx', public.record_stat_fix(2097, 'another fix of week 1', '[{"week": 1, "player_id": "pgtap-sfx-q2", "stat_key": "rush_yards", "before": 0, "after": 20}]', '2097-10-01T12:00:00Z')::text, true);
select public.mark_stat_fix_written(current_setting('pgtap.fx')::uuid);
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 1, jsonb_set(jsonb_set(pg_temp.batch_a(), '{1,players,1,points}', '63'), '{1,points}', '103'), false) $$, current_setting('pgtap.f1')),
  'P0001', format('apply_stat_fix_week: row_not_in_fix — league b9720000-0000-4000-8000-00000000000a week 1: 1 row(s) move for a player stat fix %s does not name in this week ([{"slot": "qb:0", "points": 63, "stored": 61.00, "team_id": "c9720000-0000-4000-8000-000000000002", "player_id": "pgtap-sfx-q2"}]); a stat fix moves only the players it names', current_setting('pgtap.f1')),
  'E17 …and so is a player only ANOTHER written fix names in this week (q2: fx''s, not F1''s) — each fix pays only its own lines');
select is(pg_temp.sf_digest(), current_setting('pgtap.g0'),
  'E18 NOTHING was written by any refusal — scores, results, medians, rows, receipts, audit rows, posts, notifications');

-- ---------------------------------------------------------------------------
-- F. THE DRY RUN — the apply's own document, and NOTHING persists
-- ---------------------------------------------------------------------------
select set_config('pgtap.d', pg_temp.try_fix(current_setting('pgtap.f1')::uuid, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), true)::text, true);
select is(
  (current_setting('pgtap.d')::jsonb ->> 'dry_run') || ' ' || (current_setting('pgtap.d')::jsonb ->> 'no_changes') || ' '
  || coalesce(current_setting('pgtap.d')::jsonb ->> 'receipt_id', 'null') || ' ' || (current_setting('pgtap.d')::jsonb ->> 'scores_changed')
  || ' ' || (current_setting('pgtap.d')::jsonb ->> 'players_changed'),
  'true false null 1 2', 'F1 the dry run: one team score, two player rows (the overridden team''s quarterback too) — NO receipt handed out');
select is((select jsonb_agg(f ->> 'matchup_id') from jsonb_array_elements(current_setting('pgtap.d')::jsonb -> 'flips') f),
  '["d9720000-0000-4000-8000-000000000011"]'::jsonb, 'F2 …it names the ONE result that flips (One v Two)');
select is(current_setting('pgtap.d')::jsonb ->> 'median_score_after', '98.50', 'F3 …and the median it WOULD store');
select is(pg_temp.sf_digest(), current_setting('pgtap.g0'), 'F4 NOTHING persisted — the dry run is the apply ROLLED BACK');
select is(coalesce(current_setting('fieldscout.stat_fix_rescore', true), ''), '', 'F5 …and the lock''s setting did not survive the rolled-back block');
select set_config('pgtap.d0', pg_temp.try_fix(null, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), true)::text, true);
select is((current_setting('pgtap.d0')::jsonb ->> 'players_changed') || ' ' || (current_setting('pgtap.d0')::jsonb ->> 'scores_changed') || ' ' || coalesce(current_setting('pgtap.d0')::jsonb ->> 'fix_id', 'null'),
  '2 1 null', 'F6 a dry run of lines not yet recorded (the CLI''s plan) plans the same week');
select is(pg_temp.sf_digest(), current_setting('pgtap.g0'), 'F7 …and persists nothing either');

-- ---------------------------------------------------------------------------
-- G. THE APPLY — written, and QUIET
-- ---------------------------------------------------------------------------
select set_config('pgtap.a', pg_temp.try_fix(current_setting('pgtap.f1')::uuid, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), false)::text, true);
select ok(current_setting('pgtap.a')::jsonb ->> 'receipt_id' is not null and current_setting('pgtap.a')::jsonb ->> 'error' is null,
  'G1 the apply succeeds and hands out its receipt');
select is(
  (select string_agg(m.id::text || '=' || m.home_score::text || '-' || m.away_score::text || ':' || m.result || ':' || m.is_overridden, ' ' order by m.id)
   from matchups m where m.league_id = 'b9720000-0000-4000-8000-00000000000a' and m.week = 1),
  'd9720000-0000-4000-8000-000000000011=102-101:home:false d9720000-0000-4000-8000-000000000012=96.00-80.00:home:true',
  'G2 One''s score is stored + the fix, and the result goes with it (One now wins) — the OVERRIDDEN matchup is the commissioner''s number, untouched');
select is(
  (select string_agg(p.team_id::text || '/' || p.slot || '=' || p.points::text || ':' || p.source, ' ' order by p.team_id, p.slot)
   from league_week_player_points p where p.league_id = 'b9720000-0000-4000-8000-00000000000a' and p.week = 1),
  'c9720000-0000-4000-8000-000000000001/k:0=47.00:stat_fix c9720000-0000-4000-8000-000000000001/qb:0=55.00:worker '
  'c9720000-0000-4000-8000-000000000002/k:0=40.00:worker c9720000-0000-4000-8000-000000000002/qb:0=61.00:worker '
  'c9720000-0000-4000-8000-000000000003/qb:0=96.00:worker c9720000-0000-4000-8000-000000000004/qb:0=85.00:stat_fix',
  'G3 the moved rows are stored + the fix, marked stat_fix — the OVERRIDDEN team''s quarterback too (its score stays the commissioner''s, G2; Chris 2026-11-06: "as long as all the players have the right stats and scores"); every other row is as scored, the slot_map''s k9 nowhere');
select is(
  (select sum(p.points)::text from league_week_player_points p where p.team_id = 'c9720000-0000-4000-8000-000000000001' and p.week = 1)
  || '=' || (select home_score::text from matchups where id = 'd9720000-0000-4000-8000-000000000011'),
  '102.00=102', 'G4 the rows ARE the score (Σ = the stored score)');
select is(
  (select string_agg(r.team_id::text || '=' || r.points::text || ':' || r.h2h_result || ':' || r.median_result, ' ' order by r.team_id)
   from team_week_results r where r.league_id = 'b9720000-0000-4000-8000-00000000000a' and r.week = 1)
  || ' median ' || (select median_score::text from league_weeks where league_id = 'b9720000-0000-4000-8000-00000000000a' and week = 1),
  'c9720000-0000-4000-8000-000000000001=102.00:win:win c9720000-0000-4000-8000-000000000002=101.00:loss:win '
  'c9720000-0000-4000-8000-000000000003=96.00:win:loss c9720000-0000-4000-8000-000000000004=80.00:loss:loss median 98.50',
  'G5 the results rebuilt through finalization''s own math: One wins, the median 98.50 — and Three''s median game FLIPS though the fix never touched Three (the whole week is rebuilt)');
select is(
  (select r.fix_id::text || '|' || r.season || '|' || r.week || '|' || r.players_changed || '|' || r.scores_changed || '|' || (r.id::text = current_setting('pgtap.a')::jsonb ->> 'receipt_id')
   from stat_fix_rescores r where r.league_id = 'b9720000-0000-4000-8000-00000000000a'),
  current_setting('pgtap.f1') || '|2097|1|2|1|true', 'G6 ONE system receipt: the fix, the league-week, what moved (two rows, one score) — no actor anywhere');
select is(
  (select count(*) from commissioner_actions a where a.league_id = 'b9720000-0000-4000-8000-00000000000a')::text || ' '
  || (select count(*) from league_chat c where c.league_id = 'b9720000-0000-4000-8000-00000000000a')::text || ' '
  || (select count(*) from notifications n where n.user_id::text like '9f720000-%')::text,
  '0 0 0', 'G7 QUIET: no commissioner-log row, no league post, no notification ("fixing stats should not go to some user")');
select is((select count(*)::int from league_week_player_points p where p.league_id = 'b9720000-0000-4000-8000-00000000000a' and p.week = 1 and p.source = 'stat_fix'),
  (current_setting('pgtap.a')::jsonb ->> 'players_changed')::int, 'G8 the document''s count is the rows written');
select is(coalesce(current_setting('fieldscout.stat_fix_rescore', true), ''), '', 'G9 the lock''s setting is cleared after the write');

-- ---------------------------------------------------------------------------
-- H. IDEMPOTENT
-- ---------------------------------------------------------------------------
select set_config('pgtap.g1', pg_temp.sf_digest(), true);
select is(
  (pg_temp.fix(current_setting('pgtap.f1')::uuid, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), false) - 'replayed'),
  (select (r.result - 'replayed') || jsonb_build_object('receipt_id', r.id) from stat_fix_rescores r where r.league_id = 'b9720000-0000-4000-8000-00000000000a'),
  'H1 a second apply REPLAYS the receipt''s document');
select is(
  (pg_temp.fix(current_setting('pgtap.f1')::uuid, 'b9720000-0000-4000-8000-00000000000a', 1, pg_temp.batch_a(), true) ->> 'replayed'),
  'true', 'H2 …and says so (a dry run too)');
select is(pg_temp.sf_digest(), current_setting('pgtap.g1'), 'H3 …and writes NOTHING (no second receipt, nothing paid twice)');
select is(
  (select count(*)::int from public.stat_fix_targets(false, 1, array['b9720000-0000-4000-8000-00000000000a']::uuid[]) t
   where t.fix_id = current_setting('pgtap.f1')::uuid and t.week = 1 and t.state = 'applied'),
  1, 'H4 the league-week reads applied — the pass never asks again');
-- F2: a fix that moves only a BENCH kicker — nothing in the week moves.
select set_config('pgtap.f2', public.record_stat_fix(2097, 'a bench kicker', '[{"week": 1, "player_id": "pgtap-sfx-k9", "stat_key": "fg_0_39", "before": 0, "after": 1}]', '2097-10-01T12:00:00Z')::text, true);
select public.mark_stat_fix_written(current_setting('pgtap.f2')::uuid);
select set_config('pgtap.n', pg_temp.try_fix(current_setting('pgtap.f2')::uuid, 'b9720000-0000-4000-8000-00000000000a', 1, (
  select jsonb_agg(jsonb_build_object('team_id', t.team_id, 'points', t.pts, 'players', t.players) order by t.team_id)
  from (select p.team_id, sum(p.points) as pts,
               jsonb_agg(jsonb_build_object('slot', p.slot, 'player_id', p.player_id, 'points', p.points, 'pending', '[]'::jsonb, 'reason', p.reason, 'stored', p.points) order by p.slot) as players
        from league_week_player_points p where p.league_id = 'b9720000-0000-4000-8000-00000000000a' and p.week = 1 group by p.team_id) t), false)::text, true);
select is(
  (current_setting('pgtap.n')::jsonb ->> 'no_changes') || ' ' || ((current_setting('pgtap.n')::jsonb ->> 'receipt_id') is not null)::text || ' '
  || (select r.players_changed || '/' || r.scores_changed from stat_fix_rescores r where r.fix_id = current_setting('pgtap.f2')::uuid),
  'true true 0/0', 'H5 a fix that moves nothing in the week writes its receipt even so (0 / 0) — done, never asked again');
select is(
  (select string_agg(p.slot || '=' || p.points::text || ':' || p.source, ' ' order by p.team_id, p.slot) from league_week_player_points p where p.league_id = 'b9720000-0000-4000-8000-00000000000a' and p.week = 1),
  'k:0=47.00:stat_fix qb:0=55.00:worker k:0=40.00:worker qb:0=61.00:worker qb:0=96.00:worker qb:0=85.00:stat_fix', 'H6 …and no row moved');

-- ---------------------------------------------------------------------------
-- I. THE LOCK — the exit is exactly THIS league-week's receipt + a stat_fix UPDATE
-- ---------------------------------------------------------------------------
select throws_ok($$ update league_week_player_points set points = 1, source = 'stat_fix' where team_id = 'c9720000-0000-4000-8000-000000000002' and week = 1 and slot = 'k:0' $$,
  'P0001', 'league_week_player_points: week_locked — league b9720000-0000-4000-8000-00000000000a week 1 is final; its stored per-player points never change (F405: a provider''s later stat correction updates player_stats, never a locked week — only a stat fix of our own re-scores one, through apply_stat_fix_week, §11.4 / §23.4)',
  'I1 a hand UPDATE as postgres, marked stat_fix, with NO setting: refused by name — the exit needs the receipt');
select set_config('fieldscout.stat_fix_rescore', gen_random_uuid()::text, true);
select throws_ok($$ update league_week_player_points set points = 1, source = 'stat_fix' where team_id = 'c9720000-0000-4000-8000-000000000002' and week = 1 and slot = 'k:0' $$,
  'P0001', null, 'I2 a setting that names no receipt is refused');
select set_config('fieldscout.stat_fix_rescore', current_setting('pgtap.a')::jsonb ->> 'receipt_id', true);
select throws_ok($$ update league_week_player_points set points = 1, source = 'stat_fix' where team_id = 'c9720000-0000-4000-8000-000000000007' and week = 1 $$,
  'P0001', null, 'I3 league A''s receipt does not open league D''s week');
select throws_ok($$ update league_week_player_points set points = 1, source = 'worker' where team_id = 'c9720000-0000-4000-8000-000000000002' and week = 1 and slot = 'k:0' $$,
  'P0001', null, 'I4 …nor a row not marked stat_fix');
select throws_ok($$ update league_week_player_points set player_id = 'pgtap-sfx-k9', source = 'stat_fix' where team_id = 'c9720000-0000-4000-8000-000000000002' and week = 1 and slot = 'k:0' $$,
  'P0001', null, 'I5 …nor a change of starter (the lineup is what was scored)');
select throws_ok($$ delete from league_week_player_points where team_id = 'c9720000-0000-4000-8000-000000000002' and week = 1 and slot = 'k:0' $$,
  'P0001', null, 'I6 …nor a DELETE');
select throws_ok($$ insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
  values ('b9720000-0000-4000-8000-00000000000a', 2097, 1, 'c9720000-0000-4000-8000-000000000002', 'k:1', 'pgtap-sfx-k9', 1, 'scored', 'stat_fix') $$,
  'P0001', null, 'I7 …nor an INSERT');
savepoint i8;
select lives_ok($$ update league_week_player_points set points = 41, source = 'stat_fix' where team_id = 'c9720000-0000-4000-8000-000000000002' and week = 1 and slot = 'k:0' $$,
  'I8 POSITIVE CONTROL: THIS league-week''s receipt + a stat_fix UPDATE keeping slot and starter passes — the exit is real, and only that wide');
rollback to savepoint i8;
select set_config('fieldscout.stat_fix_rescore', '', true);
select throws_ok($$ select public.score_write_week_batch('b9720000-0000-4000-8000-00000000000a', 1, '[{"team_id": "c9720000-0000-4000-8000-000000000002", "points": 120, "players": [{"slot": "qb:0", "player_id": "pgtap-sfx-q2", "points": 80, "pending": [], "reason": "scored"}, {"slot": "k:0", "player_id": "pgtap-sfx-k2", "points": 40, "pending": [], "reason": "scored"}]}]') $$,
  'P0001', 'score_write_week_batch: week_final — league b9720000-0000-4000-8000-00000000000a week 1 is final; a post-window delta changes no league cell (D295, §23.4)',
  'I9 the PROVIDER''S path is unchanged: the worker''s door still refuses a final week (F405 / Q81)');

-- ---------------------------------------------------------------------------
-- J. total_points
-- ---------------------------------------------------------------------------
select set_config('pgtap.j', pg_temp.try_fix(current_setting('pgtap.f1')::uuid, 'b9720000-0000-4000-8000-00000000000d', 1, '[
  {"team_id": "c9720000-0000-4000-8000-000000000007", "points": 36, "players": [{"slot": "rb:0", "player_id": "pgtap-sfx-p7", "points": 36, "pending": [], "reason": "scored", "stored": 30}]},
  {"team_id": "c9720000-0000-4000-8000-000000000008", "points": 20, "players": [{"slot": "rb:0", "player_id": "pgtap-sfx-p8", "points": 20, "pending": [], "reason": "scored", "stored": 20}]}]', false)::text, true);
select is(
  (select string_agg(r.team_id::text || '=' || r.points::text || ':' || r.is_final, ' ' order by r.team_id) from team_week_results r where r.league_id = 'b9720000-0000-4000-8000-00000000000d' and r.week = 1)
  || ' ' || (select string_agg(p.slot || '=' || p.points::text || ':' || p.source, ' ' order by p.team_id) from league_week_player_points p where p.league_id = 'b9720000-0000-4000-8000-00000000000d'),
  'c9720000-0000-4000-8000-000000000007=36.00:true c9720000-0000-4000-8000-000000000008=20.00:true rb:0=36.00:stat_fix rb:0=20.00:worker',
  'J1 a total_points week: the results row is stored + the fix, and the row with it');
select is((current_setting('pgtap.j')::jsonb ->> 'scores_changed') || ' ' || (current_setting('pgtap.j')::jsonb ->> 'players_changed'), '1 1', 'J2 …one score, one row');

-- ---------------------------------------------------------------------------
-- K. APPEND-ONLY
-- ---------------------------------------------------------------------------
select throws_ok(format($$ update stat_fixes set reason = 'edited' where id = %L $$, current_setting('pgtap.f1')),
  'P0001', 'stat_fixes is append-only: a fix''s one change is written_at, once (NULL → set) — a wrong fix is answered by a NEW fix, never an edit',
  'K1 a fix is never edited');
select throws_ok(format($$ update stat_fixes set written_at = null where id = %L $$, current_setting('pgtap.f1')),
  'P0001', null, 'K2 …nor un-written');
select throws_ok(format($$ delete from stat_fixes where id = %L $$, current_setting('pgtap.f1')),
  'P0001', format('stat_fixes is append-only: fix %s has been applied to a league-week and can never be removed — a correction is a NEW fix', current_setting('pgtap.f1')),
  'K3 an APPLIED fix can never be removed');
select throws_ok(format($$ update stat_fix_lines set after_value = 9 where fix_id = %L $$, current_setting('pgtap.f1')),
  'P0001', 'stat_fix_lines is append-only: a UPDATE on a fix''s line is refused — a line goes only with its fix', 'K4 a line is never edited');
select throws_ok(format($$ delete from stat_fix_lines where fix_id = %L $$, current_setting('pgtap.f1')),
  'P0001', null, 'K5 …nor removed on its own');
select throws_ok($$ update stat_fix_rescores set players_changed = 9 where league_id = 'b9720000-0000-4000-8000-00000000000a' $$,
  'P0001', 'stat_fix_rescores is append-only: a UPDATE on a stat-fix receipt is refused — removing one would make the pass apply its fix a second time', 'K6 a receipt is never edited');
select throws_ok($$ delete from stat_fix_rescores where league_id = 'b9720000-0000-4000-8000-00000000000a' $$,
  'P0001', null, 'K7 …nor removed (its fix would be paid twice)');
select throws_ok($$ truncate stat_fix_rescores $$, 'P0001', 'stat_fix_rescores is append-only: a TRUNCATE is refused (a row trigger never sees it)', 'K8 TRUNCATE is refused');
select lives_ok(format($$ delete from stat_fixes where id = %L $$, current_setting('pgtap.f0')),
  'K9 an UNAPPLIED fix may be withdrawn…');
select is((select count(*)::int from stat_fix_lines where fix_id = current_setting('pgtap.f0')::uuid), 0, 'K10 …and its lines go with it (the cascade the guard lets through)');

-- ---------------------------------------------------------------------------
-- L. ROUND 5: THE LANDING, ONE MOVE PAID ONCE, SUPERSEDING, THE CLOSE STAMP
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-q2", "stat_key": "pass_tds", "before": 0, "after": 1}]', null) $$,
  '22023', 'record_stat_fix: p_landed_at is required — when our change reached the stats (the fill run''s instant) or the engine (the deploy); a week last scored after it is not paid again, so it is never assumed',
  'L1 the landing is REQUIRED — never assumed "now" (which pays every week finalized in between)');
select throws_ok($$ select public.record_stat_fix(2097, 'again', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 0, "after": 2}]', '2097-10-01T12:00:00Z') $$,
  'P0001', format('record_stat_fix: already_recorded — week 1 player pgtap-sfx-k1 stat fg_0_39 from 0 is already a move of written stat fix %s (0 → 2); recorded again it would be paid twice', current_setting('pgtap.f1')),
  'L2 a move a WRITTEN fix already holds is refused by name (a lost reply''s re-run, a backlog repeating a fill) — never paid twice');
select throws_ok($$ select public.record_stat_fix(2097, 'overlap', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 0, "after": 3}]', '2097-10-01T12:00:00Z') $$,
  'P0001', format('record_stat_fix: already_recorded — week 1 player pgtap-sfx-k1 stat fg_0_39 from 0 is already a move of written stat fix %s (0 → 2); recorded again it would be paid twice', current_setting('pgtap.f1')),
  'L3 …and so is an overlapping one from the same value (0 → 3 over a written 0 → 2 would pay 0 → 2 again)');
select lives_ok($$ select public.record_stat_fix(2097, 'onwards', '[{"week": 1, "player_id": "pgtap-sfx-k1", "stat_key": "fg_0_39", "before": 2, "after": 3}]', '2097-10-02T12:00:00Z') $$,
  'L4 a move ON from the written value (2 → 3) is not a repeat: recorded');
select set_config('pgtap.fa', public.record_stat_fix(2097, 'lost reply', '[{"week": 1, "player_id": "pgtap-sfx-q2", "stat_key": "pass_tds", "before": 0, "after": 1}]', '2097-10-01T12:00:00Z')::text, true);
select set_config('pgtap.fb', public.record_stat_fix(2097, 'lost reply, again', '[{"week": 1, "player_id": "pgtap-sfx-q2", "stat_key": "pass_tds", "before": 0, "after": 1}]', '2097-10-01T12:00:00Z')::text, true);
select is((public.mark_stat_fix_written(current_setting('pgtap.fa')::uuid) ->> 'already_written'), 'false',
  'L5 two UNWRITTEN fixes may hold one move (nothing applies from either); the first is written');
select throws_ok(format($$ select public.mark_stat_fix_written(%L) $$, current_setting('pgtap.fb')),
  'P0001', format('mark_stat_fix_written: already_recorded — stat fix %s moves week 1 player pgtap-sfx-q2 stat pass_tds from 0, which written stat fix %s already moves (0 → 1); written too it would be paid twice', current_setting('pgtap.fb'), current_setting('pgtap.fa')),
  'L6 …the second can NEVER be written: the gate itself, under its lock');
select set_config('pgtap.fc', public.record_stat_fix(2097, 'a fill whose write failed', '[{"week": 1, "player_id": "pgtap-sfx-q3", "stat_key": "rush_yards", "before": 0, "after": 10}]', '2097-10-01T12:00:00Z')::text, true);
select set_config('pgtap.fd', public.record_stat_fix(2097, 'its re-run', '[{"week": 1, "player_id": "pgtap-sfx-q3", "stat_key": "rush_yards", "before": 0, "after": 10}, {"week": 1, "player_id": "pgtap-sfx-q3", "stat_key": "rush_tds", "before": 0, "after": 1}]', '2097-10-01T12:00:00Z', current_setting('pgtap.fc')::uuid)::text, true);
select is(
  (select count(*) from stat_fixes where id = current_setting('pgtap.fc')::uuid)::text || ' '
  || (select count(*) from stat_fix_lines where fix_id = current_setting('pgtap.fc')::uuid)::text || ' '
  || (select string_agg(l.stat_key || ':' || l.before_value || '→' || l.after_value, ',' order by l.stat_key) from stat_fix_lines l where l.fix_id = current_setting('pgtap.fd')::uuid),
  '0 0 rush_tds:0→1,rush_yards:0→10', 'L7 p_supersedes: the new fix holds every move and the unwritten one it replaces is withdrawn in the SAME transaction (its lines with it)');
select throws_ok(format($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-q3", "stat_key": "pass_tds", "before": 0, "after": 1}]', '2097-10-01T12:00:00Z', %L) $$, current_setting('pgtap.fa')),
  'P0001', format('record_stat_fix: stat fix %s can''t be superseded — only an unwritten fix of season 2097 can (it is written for season 2097)', current_setting('pgtap.fa')),
  'L8 a WRITTEN fix is never superseded');
select throws_ok($$ select public.record_stat_fix(2097, 'r', '[{"week": 1, "player_id": "pgtap-sfx-q3", "stat_key": "pass_tds", "before": 0, "after": 1}]', '2097-10-01T12:00:00Z', 'f9720000-0000-4000-8000-0000000000fe') $$,
  'P0002', 'record_stat_fix: stat fix f9720000-0000-4000-8000-0000000000fe (to supersede) not found', 'L9 …nor an unknown one');
-- No savepoint from here on: a rolled-back savepoint takes pgTAP's own count with it, and at the end of the file no later
-- assertion restores it (finish() then reads "planned N but ran N-3", round 6). Nothing after this block reads A's week 2.
-- An ENGINE fix's week: closed (216's stamp) before the fix landed, finalized after it — no line moved, so never re-scored with it.
update league_weeks set scored_at = '2097-09-23T00:15:00Z' where league_id = 'b9720000-0000-4000-8000-00000000000a' and week = 2;
select is(
  (select t.state from public.stat_fix_targets(false, 1, array['b9720000-0000-4000-8000-00000000000a']::uuid[]) t where t.fix_id = current_setting('pgtap.f1')::uuid and t.week = 2),
  'owed', 'L10 a week CLOSED before the fix landed and finalized after it is OWED — finalization alone never says it was scored with an engine fix');
update league_weeks set scored_at = '2097-10-03T00:15:00Z' where league_id = 'b9720000-0000-4000-8000-00000000000a' and week = 2;
select is(
  (select t.state from public.stat_fix_targets(false, 1, array['b9720000-0000-4000-8000-00000000000a']::uuid[]) t where t.fix_id = current_setting('pgtap.f1')::uuid and t.week = 2),
  'week_scored_after_fix', 'L11 …and one whose close stamp is after the landing was scored with it: not owed');
select throws_ok(format($$ select pg_temp.fix(%L, 'b9720000-0000-4000-8000-00000000000a', 2, pg_temp.batch_a(), false) $$, current_setting('pgtap.f1')),
  'P0001', format('apply_stat_fix_week: week_scored_after_fix — league b9720000-0000-4000-8000-00000000000a week 2 was last scored 2097-10-03 00:15:00+00, after stat fix %s landed (2097-10-01 12:00:00+00): it was scored with the fix already', current_setting('pgtap.f1')),
  'L12 the door reads the same instant, by name');
-- L13–L15 (round 6): the predicate where it must NOT refuse, through the DOOR — L12 is a refusal a finalized_at-only
-- predicate would raise as well. League D's week 1 was finalized 2097-09-20; give it a close stamp of 09-15 and an
-- engine fix landed on 09-18, in between: closed under the old engine, finalized after the deploy — owed, and applied.
update league_weeks set scored_at = '2097-09-15T00:15:00Z' where league_id = 'b9720000-0000-4000-8000-00000000000d' and week = 1;
select set_config('pgtap.fe', public.record_stat_fix(2097, 'an engine fix landed between the week''s close and its finalization', '[{"week": 1, "player_id": "pgtap-sfx-p8", "stat_key": "rush_tds", "before": 0, "after": 1}]', '2097-09-18T00:00:00Z')::text, true);
select public.mark_stat_fix_written(current_setting('pgtap.fe')::uuid);
select is(
  (select lw.scored_at::text || ' < landed 2097-09-18 < ' || lw.finalized_at::text from league_weeks lw where lw.league_id = 'b9720000-0000-4000-8000-00000000000d' and lw.week = 1)
  || ' ' || (select t.state from public.stat_fix_targets(false, 1, array['b9720000-0000-4000-8000-00000000000d']::uuid[]) t where t.fix_id = current_setting('pgtap.fe')::uuid and t.week = 1),
  '2097-09-15 00:15:00+00 < landed 2097-09-18 < 2097-09-20 12:00:00+00 owed',
  'L13 a week CLOSED before the fix landed and FINALIZED after it is owed');
select set_config('pgtap.le', pg_temp.try_fix(current_setting('pgtap.fe')::uuid, 'b9720000-0000-4000-8000-00000000000d', 1, '[
  {"team_id": "c9720000-0000-4000-8000-000000000007", "points": 36, "players": [{"slot": "rb:0", "player_id": "pgtap-sfx-p7", "points": 36, "pending": [], "reason": "scored", "stored": 36}]},
  {"team_id": "c9720000-0000-4000-8000-000000000008", "points": 26, "players": [{"slot": "rb:0", "player_id": "pgtap-sfx-p8", "points": 26, "pending": [], "reason": "scored", "stored": 20}]}]', false)::text, true);
select is(
  coalesce(current_setting('pgtap.le')::jsonb ->> 'error', 'applied') || ' ' || coalesce(current_setting('pgtap.le')::jsonb ->> 'players_changed', '-') || ' '
  || coalesce(current_setting('pgtap.le')::jsonb ->> 'scores_changed', '-') || ' ' || ((current_setting('pgtap.le')::jsonb ->> 'receipt_id') is not null)::text,
  'applied 1 1 true', 'L14 …and the DOOR applies it, not refuses: the same instant as the read (a finalized_at-only door would refuse it week_scored_after_fix)');
select is(
  (select string_agg(p.player_id || '=' || p.points::text || ':' || p.source, ' ' order by p.team_id) from league_week_player_points p where p.league_id = 'b9720000-0000-4000-8000-00000000000d' and p.week = 1)
  || ' ' || (select string_agg(r.points::text, ' ' order by r.team_id) from team_week_results r where r.league_id = 'b9720000-0000-4000-8000-00000000000d' and r.week = 1),
  'pgtap-sfx-p7=36.00:stat_fix pgtap-sfx-p8=26.00:stat_fix 36.00 26.00',
  'L15 …the fixed starter''s row and his team''s score are stored + the fix (J1''s row untouched)');

select * from finish();
rollback;
