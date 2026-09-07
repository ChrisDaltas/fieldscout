-- ============================================================================
-- Retire-and-succeed — pgTAP 068 (task L.D1.10; migration 120; spec v2.16.28
-- §7.2.1(b) / §12.22 / §11.5 / §12.2 / §12.9 / §15.1 / E49; PROGRESS D42 /
-- D53 / D74 / D137 / D290 / D301 / D314(6) / D320; F1 / F31 / F42 / F256(e);
-- tasks-M4 §4 rules 1–11).
--
-- Numbering: pgTAP head measured 067 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 068.
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * THE §7.2.1(b) GOLDEN (§C/§D) is a 4-team h2h season built on paper:
--     A and X both 2-1 / PF 300 after the three FINAL weeks; A beat X in
--     week 1, so head-to-head puts A FIRST (X's row separated_by
--     head_to_head — the BEFORE literal). A's PA 280 < X's PA 285 — chosen
--     so that once A retires into S (which inherits A's line for SEEDING),
--     the S–X tie has NO head-to-head (S never played X; X's loss was to A)
--     and falls to Points Against, where the HIGHER PA ranks first (065's
--     direction pin) — X FIRST, S second, separated_by points_against. The
--     ORDER FLIPS because the successor's H2H history does not inherit —
--     pinned from BOTH sides (S's key against X and X's key against S are
--     both 0). The PR's probe 3 folds the lineage into the h2h CTE and D2
--     / D2b go RED (the order reverts to S, X by head_to_head).
--   * HISTORY INTEGRITY (§C): the re-point is COUNTED and pinned per week —
--     weeks 1–4 (final / correction_window) keep A on every lineup, matchup
--     and result row; weeks 5–6 (live / upcoming) carry S. The PR's probe 2
--     lets the re-point touch week 4 and C7 / C8 / C9 go RED.
--   * THE LOCK (§E): a KC player on A's roster kicked off one second before
--     the retirement; after S is claimed, dropping him is refused by name
--     (E32) while the DAL player (three hours out) drops — the guard RUNS
--     and its sibling passes one unit away (D146). The PR's probe 4 clears
--     the lock on the re-pointed roster and E2 goes RED.
--   * F1 (§F): the cycle fixtures are PRIVILEGED corruption (the RPC's own
--     successor is always a fresh row, so no RPC sequence can build a cycle
--     — said, D267): A→B→A and A→B→C→A, each refused BY NAME with its
--     length; the linear chain A→S→S' is the sibling — it SUCCEEDS and S'
--     folds BOTH predecessors (depth 2). The DoD probe drops the cycle walk:
--     F1 / F2 go RED (the fixture is then misreported as "already sealed",
--     a different message).
--   * PENDING THROUGH THE LINEAGE (§G): a total_points league whose
--     correction_window week holds the predecessor's provisional row is NOT
--     pending after the retirement; a genuinely missing team still is. The
--     PR's probe 5 restores 117's read and G2 goes RED.
--   * REPLAY (§C10–C12): the same action_id returns the stored payload
--     byte-identical and mints no second successor; the same stamp on
--     another member is 22023.
--   * EVERY REFUSAL BY NAME beside its success twin (rule 9 / D272(20)):
--     playoffs (Q41) / setup (D42's text, byte-identical) / a manager on
--     his own seat / anon / no action_id / blank reason / already sealed.
--   * GOLDENS AS STORED LITERALS (D62): every count and rendering below is
--     a literal written before the first run.
--   * THE #266 FIX ROUND (R855–R862; 120 edited in place, its md5 moved):
--     (§J) R855 — a VACATED franchise (orphaned, a closed stint) retires:
--     sealed under its last manager, the closed stint untouched, no
--     notification, removed_user_id NULL, the successor + ledger + post
--     written; a franchise that NEVER had a manager (C13: 120's own
--     successor; J3: an autopick-drafted placeholder, active) refuses BY
--     NAME. The PR's probe (1) restores 063's early "no manager" refusal
--     and J2–J2h go RED. R858 — a co-commissioner retiring HIS OWN seat is
--     refused 42501 by name (J1); probe (3) drops the guard and J1/J1b go
--     RED. (§A/§C/§G/§J) R856 — the `teams` broadcast trigger: per
--     statement, diff-aware (OLD/NEW), ONE event per retirement carrying
--     the sealed row (C14–C14d), the h2h and total_points event censuses
--     as stored literals (C14 / G1c — R859), the other writers' shape (J0:
--     a takeover of a MANAGED franchise and an updated_at touch emit
--     nothing; a claim / vacate one each); probe (2) drops the trigger and
--     A11 / A11b / C14 / C14b–d / G1c / J0 / J2h go RED.
--
-- Fixture calendar: RELATIVE to now() (061's shape) — current week 5.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(108);

-- ---------------------------------------------------------------------------
-- A. Shape: the signature moved (DROP + CREATE, D137), ACLs, the wrappers
--    untouched by md5, the internals plain.
-- ---------------------------------------------------------------------------
select hasnt_function('public', 'remove_manager', array['uuid','uuid','text','uuid','text'],
  'A1 the 063 five-argument remove_manager is GONE (DROP + CREATE — no overload left behind)');
select has_function('public', 'remove_manager', array['uuid','uuid','text','uuid','text','uuid'],
  'A2 remove_manager carries p_action_id (sixth argument, DEFAULT NULL — every 3/4/5-argument call still resolves)');
select is_definer('public', 'remove_manager', array['uuid','uuid','text','uuid','text','uuid'],
  'A3 remove_manager is SECURITY DEFINER');
select is(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = 'public.remove_manager(uuid,uuid,text,uuid,text,uuid)'::regprocedure),
  'search_path=""', 'A4 remove_manager pins search_path='''' exactly (R70)');
select ok(
  not has_function_privilege('anon', 'public.remove_manager(uuid,uuid,text,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_manager(uuid,uuid,text,uuid,text,uuid)', 'EXECUTE'),
  'A5 anon holds NO EXECUTE; authenticated keeps it (the in-body commissioner check is the gate)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
   where p.oid = 'public.remove_manager(uuid,uuid,text,uuid,text,uuid)'::regprocedure),
  'p_league_id uuid, p_member_id uuid, p_mode text, p_successor_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_action_id uuid DEFAULT NULL::uuid',
  'A6 the argument list, exact (the route sends the first five by name)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('league_standings_internal', 'week_results_pending_internal')),
  'A7 the two replaced internals stay PLAIN, search_path='''', REVOKEd from every client role (117/118''s posture re-asserted)');
-- The two DEFINER wrappers are 118's, byte for byte (stored literals from
-- 118 as applied — a 120 that touched either reds here).
select is(
  md5((select p.prosrc from pg_proc p where p.oid = 'public.league_standings(uuid)'::regprocedure)),
  'ab1e6ff42b77ea37ab194b50627453e8',
  'A8 league_standings(uuid) is 118''s body (md5 literal) — the lineage lives in the internal only');
select is(
  md5((select p.prosrc from pg_proc p where p.oid = 'public.league_standings_projected(uuid)'::regprocedure)),
  '96e70a95be6aad7cce6f8042dea7b8e8',
  'A9 league_standings_projected(uuid) is 118''s body (md5 literal)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%CYCLE id SET is_cycle USING path%'),
  1, 'A10 exactly ONE function carries the F1 cycle walk (remove_manager)');
-- R856 (the #266 fix round): the `teams` trigger ships — F42 DISCHARGED for
-- teams (a trigger ships with its first subscriber: the standings page and
-- the league detail, whose first in-season writer is this retirement).
select has_trigger('public', 'teams', 'tr_broadcast_teams',
  'A11 teams: the broadcast trigger EXISTS (120 §4 / R856 — F42 discharged for teams; 067 B5c and 024 amended in place)');
select is(
  (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid = 'public.teams'::regclass and t.tgname = 'tr_broadcast_teams'),
  'CREATE TRIGGER tr_broadcast_teams AFTER UPDATE ON public.teams REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION broadcast_teams_statement()',
  'A11b …per STATEMENT with BOTH transition tables (the diff-aware shape: a row counts only when name / status / retired_at_week / successor_team_id CHANGED — PG 17 refuses UPDATE OF <cols> with a transition table); no INSERT / DELETE trigger');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'broadcast_teams_statement')
  and
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'team_broadcast_payload'),
  'A11d the trigger function is DEFINER + search_path='''' + REVOKEd from every client role; the payload function plain + REVOKEd (119''s shape)');
select has_trigger('public', 'league_rosters', 'tr_broadcast_league_rosters',
  'A12 league_rosters keeps 072''s per-row trigger — the roster re-point rides it');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims are set, D49(7)).
--    u1 commissioner everywhere (manages X); u2 the retiree (A / P / A3 /
--    the L4–L6 targets); u3 Y / B3; u4 Z / C3; u5 the later takeover
--    target (a member of nothing at first).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9e000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-rs' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'rs_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;

-- The calendar, RELATIVE to now(): current week 5 (week w starts at
-- now() + (w−5)·7d − 1d); weeks ≤ 5 have a last-game instant; no kickoff
-- datum on the week (first_kickoff_at NULL) — the game rows decide.
update nfl_weeks w
set starts_at = now() + ((w.week - 5) * interval '7 days') - interval '1 day',
    last_game_ends_at = case when w.week <= 4 then now() + ((w.week - 5) * interval '7 days') - interval '1 day' + interval '6 days' end,
    correction_window_ends_at = now() + ((w.week - 5) * interval '7 days') - interval '1 day' + interval '8 days',
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('rs-w5-a', 2026, 5, 'KC',  'BUF', now() - interval '1 second'),   -- kicked off: the lock binds
 ('rs-w5-b', 2026, 5, 'DAL', 'PHI', now() + interval '3 hours');    -- not yet: drops freely

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 -- L1: the golden (h2h, 4 teams, weeks 1–6 regular, 7 playoff)
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'pgtap-rs-L1', 2026, 'in_season', 8, 6, 2, 7,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "schedule_seed": 1,
    "tiebreakers": ["win_pct", "points_for", "head_to_head", "points_against", "division_record", "coin_flip"],
    "allow_illegal_lineups": true, "acquisitions_per_week": "unlimited", "acquisitions_per_season": "unlimited",
    "waiver_period_hours": 48, "free_agency": "immediate_after_waivers", "fa_hold_hours": 0}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}'),
 -- L2: total_points (the pending-through-lineage pin)
 ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 'pgtap-rs-L2', 2026, 'in_season', 8, 4, 0, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "total_points", "median_game": false, "second_opponent": false, "schedule_seed": 2}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 -- L3: the F1 cycle fixtures + the linear lineage sibling
 ('be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000001', 'pgtap-rs-L3', 2026, 'in_season', 8, 4, 0, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "schedule_seed": 3}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 -- L4 playoffs (Q41 refusal) · L5 complete (offseason) · L6 setup (D42)
 ('be000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000001', 'pgtap-rs-L4', 2026, 'playoffs', 8, 4, 2, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('be000000-0000-4000-8000-000000000005', '9e000000-0000-4000-8000-000000000001', 'pgtap-rs-L5', 2026, 'complete', 8, 4, 0, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('be000000-0000-4000-8000-000000000006', '9e000000-0000-4000-8000-000000000001', 'pgtap-rs-L6', 2026, 'setup', 8, 4, 0, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

-- Franchises. L1: A(01,u2) X(02,u1) Y(03,u3) Z(04,u4). L2: P(11,u2) Q(12,u1)
-- R(13,u3). L3: A3(21,u2) B3(22,u3) C3(23,u4) D3(24,u1). L4/L5/L6: one
-- target (u2) + the commissioner's own seat (u1).
insert into teams (id, owner_id, name, league_id) values
 ('ce000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000002', 'RS A', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 'RS X', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000003', 'RS Y', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000004', 'RS Z', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000011', '9e000000-0000-4000-8000-000000000002', 'RS P', 'be000000-0000-4000-8000-000000000002'),
 ('ce000000-0000-4000-8000-000000000012', '9e000000-0000-4000-8000-000000000001', 'RS Q', 'be000000-0000-4000-8000-000000000002'),
 ('ce000000-0000-4000-8000-000000000013', '9e000000-0000-4000-8000-000000000003', 'RS R', 'be000000-0000-4000-8000-000000000002'),
 ('ce000000-0000-4000-8000-000000000021', '9e000000-0000-4000-8000-000000000002', 'RS A3', 'be000000-0000-4000-8000-000000000003'),
 ('ce000000-0000-4000-8000-000000000022', '9e000000-0000-4000-8000-000000000003', 'RS B3', 'be000000-0000-4000-8000-000000000003'),
 ('ce000000-0000-4000-8000-000000000023', '9e000000-0000-4000-8000-000000000004', 'RS C3', 'be000000-0000-4000-8000-000000000003'),
 ('ce000000-0000-4000-8000-000000000024', '9e000000-0000-4000-8000-000000000001', 'RS D3', 'be000000-0000-4000-8000-000000000003'),
 ('ce000000-0000-4000-8000-000000000041', '9e000000-0000-4000-8000-000000000002', 'RS T4', 'be000000-0000-4000-8000-000000000004'),
 ('ce000000-0000-4000-8000-000000000042', '9e000000-0000-4000-8000-000000000001', 'RS C4', 'be000000-0000-4000-8000-000000000004'),
 ('ce000000-0000-4000-8000-000000000051', '9e000000-0000-4000-8000-000000000002', 'RS T5', 'be000000-0000-4000-8000-000000000005'),
 ('ce000000-0000-4000-8000-000000000052', '9e000000-0000-4000-8000-000000000001', 'RS C5', 'be000000-0000-4000-8000-000000000005'),
 ('ce000000-0000-4000-8000-000000000061', '9e000000-0000-4000-8000-000000000002', 'RS T6', 'be000000-0000-4000-8000-000000000006'),
 ('ce000000-0000-4000-8000-000000000062', '9e000000-0000-4000-8000-000000000001', 'RS C6', 'be000000-0000-4000-8000-000000000006');
insert into league_members (id, league_id, user_id, team_id, role, faab_balance) values
 ('de000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', 'manager', 77),
 ('de000000-0000-4000-8000-000000000002', 'be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'commissioner', 100),
 ('de000000-0000-4000-8000-000000000003', 'be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000003', 'manager', 100),
 ('de000000-0000-4000-8000-000000000004', 'be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000004', 'ce000000-0000-4000-8000-000000000004', 'manager', 100),
 ('de000000-0000-4000-8000-000000000011', 'be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000011', 'manager', 100),
 ('de000000-0000-4000-8000-000000000012', 'be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000012', 'commissioner', 100),
 ('de000000-0000-4000-8000-000000000013', 'be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000013', 'manager', 100),
 ('de000000-0000-4000-8000-000000000021', 'be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000021', 'manager', 100),
 ('de000000-0000-4000-8000-000000000022', 'be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000022', 'manager', 100),
 ('de000000-0000-4000-8000-000000000023', 'be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000004', 'ce000000-0000-4000-8000-000000000023', 'manager', 100),
 ('de000000-0000-4000-8000-000000000024', 'be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000024', 'commissioner', 100),
 ('de000000-0000-4000-8000-000000000041', 'be000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000041', 'manager', 100),
 ('de000000-0000-4000-8000-000000000042', 'be000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000042', 'commissioner', 100),
 ('de000000-0000-4000-8000-000000000051', 'be000000-0000-4000-8000-000000000005', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000051', 'manager', 100),
 ('de000000-0000-4000-8000-000000000052', 'be000000-0000-4000-8000-000000000005', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000052', 'commissioner', 100),
 ('de000000-0000-4000-8000-000000000061', 'be000000-0000-4000-8000-000000000006', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000061', 'manager', 100),
 ('de000000-0000-4000-8000-000000000062', 'be000000-0000-4000-8000-000000000006', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000062', 'commissioner', 100);
-- Open stints for every seated manager (started 30 days ago).
insert into team_managers (league_id, team_id, user_id, role, started_at, started_week)
select lm.league_id, lm.team_id, lm.user_id, 'manager', now() - interval '30 days', 1
from league_members lm where lm.league_id in (
  'be000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000002', 'be000000-0000-4000-8000-000000000003',
  'be000000-0000-4000-8000-000000000004', 'be000000-0000-4000-8000-000000000005', 'be000000-0000-4000-8000-000000000006');

-- Weeks. L1 1–7 (1–3 final · 4 correction_window · 5 live · 6–7 upcoming);
-- L2 1–4 (1 final · 2 correction_window · 3 live · 4 upcoming); L3 1–3
-- (1 final · 2 live · 3 upcoming); L4 1–6 (1–4 final, 5 live: the playoff
-- week); L5 1–4 all final. The F4 guard walks one legal step at a time.
insert into league_weeks (league_id, season, week)
select 'be000000-0000-4000-8000-000000000001', 2026, g from generate_series(1, 7) g;
insert into league_weeks (league_id, season, week)
select 'be000000-0000-4000-8000-000000000002', 2026, g from generate_series(1, 4) g;
insert into league_weeks (league_id, season, week)
select 'be000000-0000-4000-8000-000000000003', 2026, g from generate_series(1, 3) g;
insert into league_weeks (league_id, season, week)
select 'be000000-0000-4000-8000-000000000004', 2026, g from generate_series(1, 6) g;
insert into league_weeks (league_id, season, week)
select 'be000000-0000-4000-8000-000000000005', 2026, g from generate_series(1, 4) g;
update league_weeks set status = 'live'              where league_id = 'be000000-0000-4000-8000-000000000001' and week between 1 and 5;
update league_weeks set status = 'correction_window' where league_id = 'be000000-0000-4000-8000-000000000001' and week between 1 and 4;
update league_weeks set status = 'final'             where league_id = 'be000000-0000-4000-8000-000000000001' and week between 1 and 3;
update league_weeks set status = 'live'              where league_id = 'be000000-0000-4000-8000-000000000002' and week between 1 and 3;
update league_weeks set status = 'correction_window' where league_id = 'be000000-0000-4000-8000-000000000002' and week between 1 and 2;
update league_weeks set status = 'final'             where league_id = 'be000000-0000-4000-8000-000000000002' and week = 1;
update league_weeks set status = 'live'              where league_id = 'be000000-0000-4000-8000-000000000003' and week between 1 and 2;
update league_weeks set status = 'correction_window' where league_id = 'be000000-0000-4000-8000-000000000003' and week = 1;
update league_weeks set status = 'final'             where league_id = 'be000000-0000-4000-8000-000000000003' and week = 1;
update league_weeks set status = 'live'              where league_id = 'be000000-0000-4000-8000-000000000004' and week between 1 and 5;
update league_weeks set status = 'correction_window' where league_id = 'be000000-0000-4000-8000-000000000004' and week between 1 and 4;
update league_weeks set status = 'final'             where league_id = 'be000000-0000-4000-8000-000000000004' and week between 1 and 4;
update league_weeks set status = 'live'              where league_id = 'be000000-0000-4000-8000-000000000005';
update league_weeks set status = 'correction_window' where league_id = 'be000000-0000-4000-8000-000000000005';
update league_weeks set status = 'final'             where league_id = 'be000000-0000-4000-8000-000000000005';

-- L1 matchups (A=01 X=02 Y=03 Z=04). Weeks 1–3 final (results written);
-- week 4 played (correction_window, scores, no results yet); week 5 live
-- (provisional scores); week 6 scheduled (A is the AWAY side — both
-- columns re-point). Week 7 has no rows (in_season: no bracket yet, 118).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result) values
 ('ee000000-0000-4000-8000-000000000011', 'be000000-0000-4000-8000-000000000001', 2026, 1, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 100.00,  90.00, 'final', 'home'),
 ('ee000000-0000-4000-8000-000000000012', 'be000000-0000-4000-8000-000000000001', 2026, 1, 'regular', 'ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000004',  80.00,  70.00, 'final', 'home'),
 ('ee000000-0000-4000-8000-000000000021', 'be000000-0000-4000-8000-000000000001', 2026, 2, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 100.00, 110.00, 'final', 'away'),
 ('ee000000-0000-4000-8000-000000000022', 'be000000-0000-4000-8000-000000000001', 2026, 2, 'regular', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000004', 100.00,  95.00, 'final', 'home'),
 ('ee000000-0000-4000-8000-000000000031', 'be000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004', 100.00,  80.00, 'final', 'home'),
 ('ee000000-0000-4000-8000-000000000032', 'be000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003', 110.00,  90.00, 'final', 'home'),
 ('ee000000-0000-4000-8000-000000000041', 'be000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 120.00, 100.00, 'live', null),
 ('ee000000-0000-4000-8000-000000000042', 'be000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000004', 100.00,  90.00, 'live', null),
 ('ee000000-0000-4000-8000-000000000051', 'be000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004',  50.00,  40.00, 'live', null),
 ('ee000000-0000-4000-8000-000000000052', 'be000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003',  60.00,  70.00, 'live', null),
 ('ee000000-0000-4000-8000-000000000061', 'be000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001',   0.00,   0.00, 'scheduled', null),
 ('ee000000-0000-4000-8000-000000000062', 'be000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000004',   0.00,   0.00, 'scheduled', null);
-- L1 final results, weeks 1–3 (the standings scan): A 2-1 PF 300 PA 280 ·
-- X 2-1 PF 300 PA 285 · Y 1-2 PF 280 PA 280 · Z 0-3 PF 245 PA 280.
insert into team_week_results (league_id, team_id, season, week, points, opponent_team_id, h2h_result, is_final) values
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 2026, 1, 100.00, 'ce000000-0000-4000-8000-000000000002', 'win',  true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 2026, 1,  90.00, 'ce000000-0000-4000-8000-000000000001', 'loss', true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 2026, 1,  80.00, 'ce000000-0000-4000-8000-000000000004', 'win',  true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004', 2026, 1,  70.00, 'ce000000-0000-4000-8000-000000000003', 'loss', true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 2026, 2, 100.00, 'ce000000-0000-4000-8000-000000000003', 'loss', true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 2026, 2, 110.00, 'ce000000-0000-4000-8000-000000000001', 'win',  true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 2026, 2, 100.00, 'ce000000-0000-4000-8000-000000000004', 'win',  true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004', 2026, 2,  95.00, 'ce000000-0000-4000-8000-000000000002', 'loss', true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 2026, 3, 100.00, 'ce000000-0000-4000-8000-000000000004', 'win',  true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004', 2026, 3,  80.00, 'ce000000-0000-4000-8000-000000000001', 'loss', true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 2026, 3, 110.00, 'ce000000-0000-4000-8000-000000000003', 'win',  true),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 2026, 3,  90.00, 'ce000000-0000-4000-8000-000000000002', 'loss', true);

-- L1 players, rosters, lineups. A: QB1 (KC — kicked off), RB1 (DAL — three
-- hours out), WR1 (MIA — bye). X: X1.
insert into players (id, full_name, position, team, status) values
 ('rs-qb1', 'RS QB1', 'QB', 'KC',  'Active'),
 ('rs-rb1', 'RS RB1', 'RB', 'DAL', 'Active'),
 ('rs-wr1', 'RS WR1', 'WR', 'MIA', 'Active'),
 ('rs-x1',  'RS X1',  'QB', 'BUF', 'Active'),
 ('rs-p1',  'RS P1',  'QB', 'MIA', 'Active'),
 ('rs-a31', 'RS A31', 'QB', 'MIA', 'Active');
insert into league_rosters (league_id, team_id, player_id) values
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'rs-qb1'),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'rs-rb1'),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'rs-wr1'),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'rs-x1'),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000011', 'rs-p1'),
 ('be000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000021', 'rs-a31');
insert into team_lineups (team_id, season, week, starters, bench, slot_map)
select 'ce000000-0000-4000-8000-000000000001', 2026, g, '["rs-qb1"]'::jsonb, '["rs-rb1", "rs-wr1"]'::jsonb, '{"qb:0": "rs-qb1"}'::jsonb
from generate_series(1, 6) g;

-- L2 (total_points, P=11 Q=12 R=13): week 1 final rows; week 2 provisional
-- rows for all three (the correction_window week); week 3 provisional rows
-- for all three (the live week — P's re-points).
insert into team_week_results (league_id, team_id, season, week, points, is_final) values
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000011', 2026, 1, 40.00, true),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000012', 2026, 1, 30.00, true),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000013', 2026, 1, 20.00, true),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000011', 2026, 2, 41.00, false),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000012', 2026, 2, 31.00, false),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000013', 2026, 2, 21.00, false),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000011', 2026, 3, 42.00, false),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000012', 2026, 3, 32.00, false),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000013', 2026, 3, 22.00, false);

-- L3 (A3=21 B3=22 C3=23 D3=24): week 1 final — A3 beat D3 50–40, B3 beat
-- C3 45–35 (the depth-2 lineage fold reads A3's row through two seals).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result) values
 ('ee000000-0000-4000-8000-000000000311', 'be000000-0000-4000-8000-000000000003', 2026, 1, 'regular', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000024', 50.00, 40.00, 'final', 'home'),
 ('ee000000-0000-4000-8000-000000000312', 'be000000-0000-4000-8000-000000000003', 2026, 1, 'regular', 'ce000000-0000-4000-8000-000000000022', 'ce000000-0000-4000-8000-000000000023', 45.00, 35.00, 'final', 'home'),
 ('ee000000-0000-4000-8000-000000000321', 'be000000-0000-4000-8000-000000000003', 2026, 2, 'regular', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000022', 10.00, 10.00, 'live', null),
 ('ee000000-0000-4000-8000-000000000322', 'be000000-0000-4000-8000-000000000003', 2026, 2, 'regular', 'ce000000-0000-4000-8000-000000000023', 'ce000000-0000-4000-8000-000000000024', 10.00, 10.00, 'live', null);
insert into team_week_results (league_id, team_id, season, week, points, opponent_team_id, h2h_result, is_final) values
 ('be000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000021', 2026, 1, 50.00, 'ce000000-0000-4000-8000-000000000024', 'win',  true),
 ('be000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000024', 2026, 1, 40.00, 'ce000000-0000-4000-8000-000000000021', 'loss', true),
 ('be000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000022', 2026, 1, 45.00, 'ce000000-0000-4000-8000-000000000023', 'win',  true),
 ('be000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000023', 2026, 1, 35.00, 'ce000000-0000-4000-8000-000000000022', 'loss', true);

-- Standings rendering: name:W-L-T:PF:PA:separated_by, in rank order.
create or replace function pg_temp.rs_order(p_league uuid, p_projected boolean default false) returns text language sql as $$
  select string_agg(
           (x ->> 'name') || ':' || (x ->> 'wins') || '-' || (x ->> 'losses') || '-' || (x ->> 'ties') || ':' ||
           (x ->> 'points_for') || ':' || (x ->> 'points_against') || ':' || coalesce(x ->> 'separated_by', '-'),
           ',' order by (x ->> 'rank')::int)
  from jsonb_array_elements(
    case when p_projected then public.league_standings_projected(p_league) else public.league_standings(p_league) end -> 'standings') x
$$;
-- The realtime harness (067's, R856): today's + tomorrow's realtime.messages
-- partitions (024's post-reset race guard), THIS transaction's messages
-- only (`inserted_at >= now()`), ordered by command id within the
-- transaction; a per-topic census as `event:count` from a baseline taken
-- right before the subject statement (the fixtures' own INSERTs on
-- matchups / results and the league_weeks flips are events too).
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'realtime' and c.relname = part_name
    ) then
      execute format(
        'create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
        part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;
create temp view rs_msgs as
  select m.cmin::text::bigint as cmd, m.ctid as tid, m.id, m.topic, m.event, m.payload, m.private
  from realtime.messages m
  where m.topic like 'league:be000000-0000-4000-8000-00000000000%'
    and m.inserted_at >= now();
create function pg_temp.rs_census(p_league text) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(x.event, x.n), '{}'::jsonb)
  from (select event, count(*) as n from rs_msgs where topic = 'league:' || p_league group by 1) x
$$;
-- The delta since a baseline census, rendered `event:count,…` (events with a zero delta omitted).
create function pg_temp.rs_delta(p_league text, p_base jsonb) returns text language sql as $$
  select coalesce(string_agg(x.event || ':' || x.d::text, ',' order by x.event), '')
  from (select c.key as event, (c.value)::bigint - coalesce((p_base ->> c.key)::bigint, 0) as d
        from jsonb_each_text(pg_temp.rs_census(p_league)) c) x
  where x.d > 0
$$;
create function pg_temp.rs_last(p_league text, p_event text) returns jsonb language sql as $$
  select payload from rs_msgs where topic = 'league:' || p_league and event = p_event order by cmd desc, tid desc limit 1
$$;
create function pg_temp.rs_teams_events(p_league text) returns bigint language sql as $$
  select count(*) from rs_msgs where topic = 'league:' || p_league and event = 'teams'
$$;

-- The BEFORE literals (118's chain, no lineage): A first by head-to-head.
select is(pg_temp.rs_order('be000000-0000-4000-8000-000000000001'),
  'RS A:2-1-0:300.00:280.00:-,RS X:2-1-0:300.00:285.00:head_to_head,RS Y:2-1-0:280.00:280.00:points_for,RS Z:0-3-0:245.00:280.00:win_pct',
  'B1 BEFORE: A, X and Y all 2-1 — Points For leaves A and X (300) as the clean two-team group, and A is FIRST by head-to-head (A beat X in week 1); Y (280) third; a league with no retired franchise reads 118''s rows exactly');
select is(pg_temp.rs_order('be000000-0000-4000-8000-000000000001', true),
  'RS A:4-1-0:470.00:420.00:-,RS X:3-2-0:460.00:445.00:win_pct,RS Y:3-2-0:450.00:460.00:points_for,RS Z:0-5-0:375.00:430.00:win_pct',
  'B2 BEFORE (projected): weeks 4 and 5 derived as if ended now — A 4-1 / 470');

-- ---------------------------------------------------------------------------
-- C. The §7.2.1(b) golden — the retirement, every write pinned.
-- ---------------------------------------------------------------------------
-- C0 refusals first, each beside the success that follows (rule 9).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'retire', null, 'leaving', 'ae000000-0000-4000-8000-000000000001') $$,
  '42501', 'remove_manager: not a commissioner of this league',
  'C0a a manager retiring HIS OWN seat is refused by name — remove_manager is the commissioner''s verb');
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'retire', null, 'x', 'ae000000-0000-4000-8000-000000000001') $$,
  '42501', 'remove_manager: must be signed in', 'C0b anon is refused');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'retire', null, 'a reason') $$,
  '22023', null, 'C0c retire without action_id is an argument-shape violation (113''s contract)');
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'retire', null, '   ', 'ae000000-0000-4000-8000-000000000001') $$,
  '22023', null, 'C0d a blank reason is refused — an audited override carries its reason (E49 / D290)');
reset role;
select is((select count(*)::int from teams where league_id = 'be000000-0000-4000-8000-000000000001'), 4,
  'C0e the four refusals wrote NOTHING (no successor minted)');

-- The retirement (u1, the commissioner; action_id …01). The realtime
-- baseline is taken HERE (the four refusals above wrote nothing).
select set_config('pgtap.rs_c0', pg_temp.rs_census('be000000-0000-4000-8000-000000000001')::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _r1 as
select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'retire', null,
  'manager moved abroad', 'ae000000-0000-4000-8000-000000000001') as r;
reset role;
create temp table _s as select ((select r from _r1) ->> 'successor_team_id')::uuid as id;
select set_config('pgtap.rs_s', (select id::text from _s), true);   -- readable under `set local role authenticated`

select is((select r - 'successor_team_id' - 'member_id' - 'team_id' - 'retired_team_id' - 'removed_user_id' from _r1),
  '{"ok": true, "mode": "retire", "verb": "retire_franchise", "action_id": "ae000000-0000-4000-8000-000000000001",
    "successor_user_id": null, "already_vacant": false, "retired_team_name": "RS A", "successor_team_name": "Team 5",
    "season": 2026, "retired_at_week": 5, "reason": "manager moved abroad",
    "repointed": {"rosters": 3, "lineups": 2, "matchups": 2, "results": 0},
    "inherits": {"roster": true, "record": "seeding_only", "h2h_history": false, "faab": "seat_balance_kept"}}'::jsonb,
  'C1 THE PAYLOAD (stored literal): retired_at_week 5 (1 + the last correction_window week), the successor "Team 5" (D74(5) over the whole franchise series), the COUNTS — 3 roster rows, 2 lineups (weeks 5–6), 2 matchups (week 5 home + week 6 away), 0 results (h2h writes none before final)');
select is((select r ->> 'member_id' from _r1), 'de000000-0000-4000-8000-000000000001', 'C1b member_id is the acted-on seat');
select is((select r ->> 'team_id' from _r1), 'ce000000-0000-4000-8000-000000000001', 'C1c team_id is the RETIRED franchise (the 063 key the service reads), = retired_team_id');
select is((select r ->> 'retired_team_id' from _r1), 'ce000000-0000-4000-8000-000000000001', 'C1d retired_team_id');
select is((select r ->> 'removed_user_id' from _r1), '9e000000-0000-4000-8000-000000000002', 'C1e removed_user_id is the retiree');

-- The seal.
select is(
  (select t.status || ':' || t.retired_at_week::text || ':' || (t.successor_team_id = (select id from _s))::text || ':' || t.owner_id::text || ':' || t.name
   from teams t where t.id = 'ce000000-0000-4000-8000-000000000001'),
  'retired:5:true:9e000000-0000-4000-8000-000000000001:RS A',
  'C2 A is SEALED: status retired, retired_at_week 5, successor_team_id = S, owner_id = the acting commissioner, name frozen');
select is(
  (select t.status || ':' || t.name || ':' || t.owner_id::text || ':' || coalesce(t.successor_team_id::text, 'null') || ':' || coalesce(t.retired_at_week::text, 'null')
   from teams t where t.id = (select id from _s)),
  'orphaned:Team 5:9e000000-0000-4000-8000-000000000001:null:null',
  'C3 S is a NEW franchise in the slot: orphaned (no manager yet), "Team 5", owned by the commissioner, no successor, no seal');
select is((select count(*)::int from teams where league_id = 'be000000-0000-4000-8000-000000000001' and status <> 'retired'), 4,
  'C3b the league still seats FOUR (every capacity count is status <> retired — the seat continues)');
-- The stint.
select is(
  (select tm.end_reason || ':' || tm.ended_week::text || ':' || tm.ended_by::text || ':' || (tm.ended_at is not null)::text
   from team_managers tm where tm.team_id = 'ce000000-0000-4000-8000-000000000001' and tm.user_id = '9e000000-0000-4000-8000-000000000002'),
  'seat_retired:5:9e000000-0000-4000-8000-000000000001:true',
  'C4 the stint closed end_reason = seat_retired (the §12.22 value M1 never wrote — D74(9)), ended_week 5, ended_by the commissioner');
select is((select count(*)::int from team_managers where team_id = (select id from _s)), 0,
  'C4b NO stint opened on S (no manager until a takeover)');
-- The seat.
select is(
  (select (lm.user_id is null)::text || ':' || lm.is_placeholder::text || ':' || lm.role || ':' || (lm.team_id = (select id from _s))::text || ':' || lm.faab_balance::text
   from league_members lm where lm.id = 'de000000-0000-4000-8000-000000000001'),
  'true:true:manager:true:77',
  'C5 the SEAT (one league_members row, §12.2) fronts S as an open placeholder; faab_balance 77 LEFT AS IS — the FAAB inheritance (D301: the one line M5 need not write)');
select is((select count(*)::int from league_members where league_id = 'be000000-0000-4000-8000-000000000001'), 4,
  'C5b still four seats — no row minted, none deleted');
-- The roster.
select is(
  (select count(*) filter (where team_id = (select id from _s))::text || ':' || count(*) filter (where team_id = 'ce000000-0000-4000-8000-000000000001')::text
   from league_rosters where league_id = 'be000000-0000-4000-8000-000000000001'),
  '3:0', 'C6 the roster moved WHOLE: S holds A''s three players, A holds none (UNIQUE(league_id, player_id) untouched)');
-- History integrity — per week (the PR's probe 2 target).
select is(
  (select string_agg(tl.week::text || case when tl.team_id = (select id from _s) then 'S' else 'A' end, ',' order by tl.week)
   from team_lineups tl where tl.season = 2026 and tl.team_id in ('ce000000-0000-4000-8000-000000000001', (select id from _s))),
  '1A,2A,3A,4A,5S,6S',
  'C7 LINEUPS: weeks 1–4 (final / correction_window) stay A''s; weeks 5–6 (live / upcoming) are S''s');
select is(
  (select string_agg(m.week::text || case when m.home_team_id = (select id from _s) or m.away_team_id = (select id from _s) then 'S' else 'A' end
                     || case when m.away_team_id in ('ce000000-0000-4000-8000-000000000001', (select id from _s)) then '(away)' else '(home)' end, ',' order by m.week)
   from matchups m where m.league_id = 'be000000-0000-4000-8000-000000000001'
     and (m.home_team_id in ('ce000000-0000-4000-8000-000000000001', (select id from _s)) or m.away_team_id in ('ce000000-0000-4000-8000-000000000001', (select id from _s)))),
  '1A(home),2A(home),3A(home),4A(home),5S(home),6S(away)',
  'C8 MATCHUPS: weeks 1–4 keep A on the row; week 5 (home) and week 6 (AWAY — the other column) carry S; the week-5 provisional 50–40 stays on the row');
select is(
  (select string_agg(r.week::text || case when r.team_id = (select id from _s) then 'S' else 'A' end, ',' order by r.week)
   from team_week_results r where r.league_id = 'be000000-0000-4000-8000-000000000001'
     and r.team_id in ('ce000000-0000-4000-8000-000000000001', (select id from _s))),
  '1A,2A,3A',
  'C9 RESULTS: the three final rows stay A''s (history); S has none yet (its book opens at week 5)');
select is((select count(*)::int from team_week_results where league_id = 'be000000-0000-4000-8000-000000000001' and opponent_team_id = (select id from _s)), 0,
  'C9b no past opponent column was rewritten to S (weeks < 5 are history on BOTH sides)');
-- The ledger + the post + the notification.
select is(
  (select t.type || ':' || t.status || ':' || coalesce(t.initiator_team_id::text, 'null') || ':' || t.initiated_by::text || ':' || t.week::text || ':' || (t.payload = (select r from _r1))::text
   from transactions t where t.league_id = 'be000000-0000-4000-8000-000000000001' and t.action_id = 'ae000000-0000-4000-8000-000000000001'),
  'commissioner_move:complete:null:9e000000-0000-4000-8000-000000000001:5:true',
  'C10 THE LEDGER ROW (D290 interim, 113''s shape): one commissioner_move, commissioner-initiated, week 5, payload = the return value byte for byte');
select is((select count(*)::int from transactions where league_id = 'be000000-0000-4000-8000-000000000001'), 1, 'C10b exactly one ledger row');
select is(
  (select c.message from league_chat c where c.league_id = 'be000000-0000-4000-8000-000000000001' and c.is_system order by c.created_at desc limit 1),
  'RS A was retired by rs_user1 — the franchise is sealed under its final manager; Team 5 takes its slot from Week 5 (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: manager moved abroad',
  'C10c the D97 system post, in-transaction, names both franchises, the week, the inheritance rule and the reason');
select is(
  (select n.data ->> 'event' from notifications n where n.user_id = '9e000000-0000-4000-8000-000000000002' and n.data ->> 'league_id' = 'be000000-0000-4000-8000-000000000001' order by n.created_at desc limit 1),
  'retired', 'C10d the retiree is notified with the "franchise retired" category (§7.2.1:190)');
-- The realtime census of ONE h2h retirement (R856 / R859 — a stored literal;
-- measured 2026-09-07 on this fixture): the roster's three per-row events
-- (072), the two matchup re-point statements (119), the ledger row, the
-- post, and — new — exactly ONE `teams` event: the seal statement. The
-- successor's INSERT emits nothing (no INSERT trigger), the R90 owner
-- sweep changes none of the four rendered columns, and the three results
-- statements matched no row (h2h writes no result before final).
select is(pg_temp.rs_delta('be000000-0000-4000-8000-000000000001', current_setting('pgtap.rs_c0')::jsonb),
  'league_chat:1,league_rosters:3,matchups:2,teams:1,transactions:1',
  'C14 THE h2h RETIREMENT''S EVENT CENSUS (stored literal): rosters ×3, matchups ×2, transactions ×1, chat ×1, teams ×1 — probe (2) drops the trigger and the teams term disappears');
select is(pg_temp.rs_last('be000000-0000-4000-8000-000000000001', 'teams') - 'id',
  jsonb_build_object('operation', 'UPDATE', 'table', 'teams', 'schema', 'public',
    'record', jsonb_build_object('count', 1, 'teams', jsonb_build_array(jsonb_build_object(
      'id', 'ce000000-0000-4000-8000-000000000001', 'name', 'RS A', 'status', 'retired', 'retired_at_week', 5, 'successor_team_id', (select id from _s))))),
  'C14b the teams event is 070''s envelope carrying the SEALED row exactly — status retired, retired_at_week 5, successor_team_id = S (a client can follow the lineage from the wire)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rs_last('be000000-0000-4000-8000-000000000001', 'teams') -> 'record' -> 'teams' -> 0) k),
  array['id', 'name', 'retired_at_week', 'status', 'successor_team_id'],
  'C14c …exactly the five rendered columns — no owner_id (manager identity stays off this wire), no list_id / scoring_system_id / legacy cells');
select is(
  (select m.private::text || ':' || m.topic from rs_msgs m where m.event = 'teams' and m.topic = 'league:be000000-0000-4000-8000-000000000001' order by m.cmd desc, m.tid desc limit 1),
  'true:league:be000000-0000-4000-8000-000000000001',
  'C14d …on the PRIVATE league topic (070''s policies gate it — no publication change)');
-- Replay (113's contract).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'retire', null,
    'a different reason on the retry', 'ae000000-0000-4000-8000-000000000001'),
  (select r from _r1),
  'C11 REPLAY: the same action_id returns the STORED payload byte-identical (the retry''s reason is ignored — the ledger row is the truth)');
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000003', 'retire', null, 'x', 'ae000000-0000-4000-8000-000000000001') $$,
  '22023', null, 'C12 the same action_id on ANOTHER member is a shape violation (R732: one stamp, one submit)');
reset role;
select is((select count(*)::int from teams where league_id = 'be000000-0000-4000-8000-000000000001'), 5,
  'C11b the replay minted NO second successor (five franchises: four seated + the sealed one)');
select is((select count(*)::int from transactions where league_id = 'be000000-0000-4000-8000-000000000001'), 1, 'C11c and wrote no second ledger row');
-- Already sealed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- R855: the retire arm now ADMITS an unmanaged seat — but only one with a
-- manager to seal it under (a closed stint: vacated / left, §J). S has
-- NEVER had a manager: refused BY NAME, nothing written.
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'retire', null, 'again', 'ae000000-0000-4000-8000-000000000002') $$,
  'P0001', 'remove_manager: Team 5 has never had a manager — there is no one to seal it under; use assign-manager to seat someone on it first (§7.2.1(b))',
  'C13 a fresh stamp on the now-open seat: S has NEVER had a manager — refused BY NAME (R855 admits a VACATED franchise, §J; a seal names a manager)');
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'takeover', '9e000000-0000-4000-8000-000000000005', 'x') $$,
  'P0001', 'remove_manager: that seat has no manager — use assign-manager to seat someone on it',
  'C13b …and a TAKEOVER of the open seat keeps 063''s "no manager" refusal byte for byte (only retire passes the early check)');
reset role;

-- ---------------------------------------------------------------------------
-- D. The standings — record for SEEDING inherits, H2H history does NOT,
--    pinned from both sides; the projected arm the same.
-- ---------------------------------------------------------------------------
select is(pg_temp.rs_order('be000000-0000-4000-8000-000000000001'),
  'RS X:2-1-0:300.00:285.00:-,Team 5:2-1-0:300.00:280.00:points_against,RS Y:2-1-0:280.00:280.00:points_for,RS Z:0-3-0:245.00:280.00:win_pct',
  'D1 AFTER: S carries A''s 2-1 / 300 / 280 for seeding — and the ORDER FLIPS: the S–X tie has no head-to-head (S never played X) and falls to Points Against, X 285 first');
select is(
  (select x ->> 'separated_by' from jsonb_array_elements(public.league_standings('be000000-0000-4000-8000-000000000001') -> 'standings') x
   where x ->> 'name' = 'Team 5'),
  'points_against',
  'D2 S''s row is separated from X by points_against, NOT head_to_head — the successor''s H2H history does not inherit (S''s side)');
select is(
  (select string_agg(x ->> 'name', ',' order by (x ->> 'rank')::int)
   from jsonb_array_elements(public.league_standings('be000000-0000-4000-8000-000000000001') -> 'standings') x where (x ->> 'rank')::int <= 2),
  'RS X,Team 5',
  'D2b X ranks ABOVE S: X''s week-1 loss was to A, not to S — no head-to-head key against S either (X''s side)');
select is((select count(*)::int from jsonb_array_elements(public.league_standings('be000000-0000-4000-8000-000000000001') -> 'standings') x where x ->> 'name' = 'RS A'), 0,
  'D3 the retired franchise has NO standings row (117''s seated CTE — D314(6))');
select is((select public.league_standings('be000000-0000-4000-8000-000000000001') -> 'skipped'), '[]'::jsonb,
  'D3b nothing skipped — the S–X tie is a clean two-team group, resolved down the chain');
select is(pg_temp.rs_order('be000000-0000-4000-8000-000000000001', true),
  'Team 5:4-1-0:470.00:420.00:-,RS X:3-2-0:460.00:445.00:win_pct,RS Y:3-2-0:450.00:460.00:points_for,RS Z:0-5-0:375.00:430.00:win_pct',
  'D4 PROJECTED: S folds A''s three final rows + A''s week 4 (correction_window, derived on A''s id through the lineage) + its OWN week 5 (the re-pointed live matchup) — 4-1 / 470, the same line A projected before');

-- ---------------------------------------------------------------------------
-- E. The lock rides the player, not the seat: after S is claimed, the KC
--    starter (kicked off one second before the retirement) cannot be
--    dropped; the DAL player (three hours out) drops.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.assign_manager('be000000-0000-4000-8000-000000000001', current_setting('pgtap.rs_s')::uuid, '9e000000-0000-4000-8000-000000000005') $$,
  'E0 the successor seat is claimable through the existing takeover path (assign_manager on the placeholder — D74(2))');
reset role;
select is(
  (select t.status from teams t where t.id = (select id from _s)) || ':' ||
  (select lm.user_id::text from league_members lm where lm.id = 'de000000-0000-4000-8000-000000000001') || ':' ||
  (select count(*)::text from team_managers tm where tm.team_id = (select id from _s) and tm.ended_at is null),
  'active:9e000000-0000-4000-8000-000000000005:1',
  'E0b S returns to active with u5 seated and ONE open stint — the same seat row, filled');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_like(
  $$ select public.roster_add_drop_internal('be000000-0000-4000-8000-000000000001', current_setting('pgtap.rs_s')::uuid, null, 'rs-qb1',
       'ae000000-0000-4000-8000-000000000031', now()) $$,
  '%RS QB1 (rs-qb1) is locked for drops — kicked off at %',
  'E1 a player who kicked off BEFORE the succession stays locked on the successor''s roster (E32 — per player, evaluated from nfl_games; the re-point unlocked no one)');
select lives_ok(
  $$ select public.roster_add_drop_internal('be000000-0000-4000-8000-000000000001', current_setting('pgtap.rs_s')::uuid, null, 'rs-rb1',
       'ae000000-0000-4000-8000-000000000032', now()) $$,
  'E2 the sibling one unit away: the DAL player (three hours out) drops from S — the guard RUNS, it is not a dead seat');
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from league_rosters where team_id = (select id from _s)), 2, 'E2b S holds two after the drop');

-- ---------------------------------------------------------------------------
-- F. F1 — succession cycles refused BY NAME at length 2 and 3 (privileged
--    corruption: the RPC's successor is always fresh); the linear chain is
--    the sibling and folds depth 2.
-- ---------------------------------------------------------------------------
-- length 2: A3 → B3 → A3 (both still 'active' — only the column is corrupt).
update teams set successor_team_id = 'ce000000-0000-4000-8000-000000000022' where id = 'ce000000-0000-4000-8000-000000000021';
update teams set successor_team_id = 'ce000000-0000-4000-8000-000000000021' where id = 'ce000000-0000-4000-8000-000000000022';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000003', 'de000000-0000-4000-8000-000000000022', 'retire', null, 'cycle', 'ae000000-0000-4000-8000-000000000041') $$,
  'P0001', 'remove_manager: RS B3 sits in a succession CYCLE of length 2 (the successor_team_id chain revisits a franchise) — refused; repair the lineage before extending it (§12.22 / F1)',
  'F1 A→B→A: retiring B3 is refused BY NAME as a cycle of length 2 (the DoD probe drops the walk and this reads "already sealed" instead)');
reset role;
select is((select count(*)::int from teams where league_id = 'be000000-0000-4000-8000-000000000003'), 4, 'F1b nothing minted');
-- length 3: A3 → B3 → C3 → A3.
update teams set successor_team_id = 'ce000000-0000-4000-8000-000000000023' where id = 'ce000000-0000-4000-8000-000000000022';
update teams set successor_team_id = 'ce000000-0000-4000-8000-000000000021' where id = 'ce000000-0000-4000-8000-000000000023';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000003', 'de000000-0000-4000-8000-000000000023', 'retire', null, 'cycle', 'ae000000-0000-4000-8000-000000000042') $$,
  'P0001', 'remove_manager: RS C3 sits in a succession CYCLE of length 3 (the successor_team_id chain revisits a franchise) — refused; repair the lineage before extending it (§12.22 / F1)',
  'F2 A→B→C→A: retiring C3 is refused as a cycle of length 3');
-- a franchise OUTSIDE the cycle is not affected: D3 (u1's own seat — the
-- commissioner cannot be removed) — use B3 after repairing its link? No:
-- repair the whole chain first; the self-succession CHECK is 053's.
reset role;
update teams set successor_team_id = null where league_id = 'be000000-0000-4000-8000-000000000003';
select throws_ok(
  $$ update teams set successor_team_id = id where id = 'ce000000-0000-4000-8000-000000000021' $$,
  '23514', null, 'F3 self-succession stays the 053 DB CHECK (teams_successor_not_self) — D53''s split: the CHECK for length 1, the RPC for longer');
-- the sibling: A3 → S3a (fresh) succeeds; S3a claimed by u5; S3a → S3b; S3b
-- folds A3's week-1 win through TWO seals.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _r3a as
select public.remove_manager('be000000-0000-4000-8000-000000000003', 'de000000-0000-4000-8000-000000000021', 'retire', null, 'first seal', 'ae000000-0000-4000-8000-000000000043') as r;
select lives_ok(
  $$ select public.assign_manager('be000000-0000-4000-8000-000000000003', ((select r from _r3a) ->> 'successor_team_id')::uuid, '9e000000-0000-4000-8000-000000000005') $$,
  'F4 the linear chain: A3 sealed into S3a, S3a claimed');
create temp table _r3b as
select public.remove_manager('be000000-0000-4000-8000-000000000003', 'de000000-0000-4000-8000-000000000021', 'retire', null, 'second seal', 'ae000000-0000-4000-8000-000000000044') as r;
reset role;
select is((select r ->> 'successor_team_name' from _r3a) || ',' || (select r ->> 'successor_team_name' from _r3b), 'Team 5,Team 6',
  'F4b the series continues over the whole franchise count (retired included): Team 5, then Team 6');
select is(
  (select string_agg(t.name || '→' || coalesce((select s.name from teams s where s.id = t.successor_team_id), '∅'), ',' order by t.name)
   from teams t where t.league_id = 'be000000-0000-4000-8000-000000000003' and t.status = 'retired'),
  'RS A3→Team 5,Team 5→Team 6',
  'F4c the lineage as stored: A3 → Team 5 → Team 6 (two sealed, one live)');
select is(pg_temp.rs_order('be000000-0000-4000-8000-000000000003'),
  'Team 6:1-0-0:50.00:40.00:-,RS B3:1-0-0:45.00:35.00:points_for,RS D3:0-1-0:40.00:50.00:win_pct,RS C3:0-1-0:35.00:45.00:points_for',
  'F5 DEPTH-2 FOLD: Team 6''s line is A3''s week-1 win (1-0 / 50 / 40) read through TWO seals — it ranks FIRST over B3 (1-0 / 45) by Points For');
select is(
  (select string_agg((x ->> 'name') || ':' || (x ->> 'points_for'), ',' order by (x ->> 'rank')::int)
   from jsonb_array_elements(public.league_standings('be000000-0000-4000-8000-000000000003') -> 'standings') x where (x ->> 'wins')::int = 1),
  'Team 6:50.00,RS B3:45.00',
  'F5b among the 1-0 teams Team 6 (50, A3''s points) ranks above B3 (45) by Points For — the inherited PF is live for seeding');

-- ---------------------------------------------------------------------------
-- G. Pending through the lineage (total_points, L2): the correction_window
--    week holds P's provisional row; after P → S2 the week is NOT pending;
--    a genuinely missing team still is.
-- ---------------------------------------------------------------------------
select is(public.week_results_pending_internal('be000000-0000-4000-8000-000000000002', 2026, 2), null,
  'G0 BEFORE: week 2 holds a row for every seated team — not pending');
select set_config('pgtap.rs_g0', pg_temp.rs_census('be000000-0000-4000-8000-000000000002')::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _r2 as
select public.remove_manager('be000000-0000-4000-8000-000000000002', 'de000000-0000-4000-8000-000000000011', 'retire', null, 'points league', 'ae000000-0000-4000-8000-000000000021') as r;
reset role;
select is((select r -> 'repointed' from _r2), '{"rosters": 1, "lineups": 0, "matchups": 0, "results": 1}'::jsonb,
  'G1 total_points: retired_at_week 3 (week 2 is correction_window) — the ONE re-pointed result row is P''s week-3 provisional row; week 2''s stays P''s');
select is((select r ->> 'retired_at_week' from _r2), '3', 'G1b retired_at_week 3');
-- R859: the total_points arm's event set differs from the h2h one — no
-- matchups; the ONE re-pointed provisional result row rides 119's
-- per-statement results trigger (which, incidentally, is a standings
-- invalidator on its own); the teams event is the seal, as in C14.
select is(pg_temp.rs_delta('be000000-0000-4000-8000-000000000002', current_setting('pgtap.rs_g0')::jsonb),
  'league_chat:1,league_rosters:1,team_week_results:1,teams:1,transactions:1',
  'G1c THE total_points RETIREMENT''S EVENT CENSUS (stored literal): rosters ×1, team_week_results ×1 (the week-3 re-point), transactions ×1, chat ×1, teams ×1 — no matchups');
select is(public.week_results_pending_internal('be000000-0000-4000-8000-000000000002', 2026, 2), null,
  'G2 AFTER: week 2 is NOT pending — the successor is covered by P''s own row through the lineage (117''s read alone would hold the week forever; probe 5)');
delete from team_week_results where league_id = 'be000000-0000-4000-8000-000000000002' and team_id = 'ce000000-0000-4000-8000-000000000013' and week = 2;
select is(public.week_results_pending_internal('be000000-0000-4000-8000-000000000002', 2026, 2),
  '{"reason": "pending_results", "pending": 1, "missing": ["ce000000-0000-4000-8000-000000000013"]}'::jsonb,
  'G3 the sibling: a genuinely missing seated team (R) still holds the week by name — the guard runs');
select is(
  (select string_agg(r.week::text || case when r.team_id = ((select r from _r2) ->> 'successor_team_id')::uuid then 'S' else 'P' end, ',' order by r.week)
   from team_week_results r where r.league_id = 'be000000-0000-4000-8000-000000000002'
     and r.team_id in ('ce000000-0000-4000-8000-000000000011', ((select r from _r2) ->> 'successor_team_id')::uuid)),
  '1P,2P,3S', 'G4 P''s rows: weeks 1–2 stay P''s, the live week-3 row is S2''s');
select is(pg_temp.rs_order('be000000-0000-4000-8000-000000000002'),
  'Team 4:0-0-0:40.00:0:-,RS Q:0-0-0:30.00:0:points_for,RS R:0-0-0:20.00:0:points_for',
  'G5 total_points standings: S2 ("Team 4") carries P''s final week-1 40.00 for seeding');

-- ---------------------------------------------------------------------------
-- H. The status gates: playoffs refuses by name (Q41) and writes nothing;
--    complete (the offseason) succeeds with no partition week; setup keeps
--    D42's text byte for byte.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000004', 'de000000-0000-4000-8000-000000000041', 'retire', null, 'mid-playoffs', 'ae000000-0000-4000-8000-000000000051') $$,
  'P0001', 'remove_manager: retiring a franchise during the playoffs is not defined yet — what the bracket does with a retired franchise''s line is PROGRESS Q41; use takeover or vacate now, or retire the franchise after the season (§7.2.1(b))',
  'H1 PLAYOFFS: refused BY NAME pending Q41 — never a fold');
reset role;
select is(
  (select count(*)::text from teams where league_id = 'be000000-0000-4000-8000-000000000004') || ':' ||
  (select count(*)::text from transactions where league_id = 'be000000-0000-4000-8000-000000000004') || ':' ||
  (select end_reason is null from team_managers where team_id = 'ce000000-0000-4000-8000-000000000041')::text,
  '2:0:true', 'H1b the playoffs refusal wrote NOTHING (no successor, no ledger row, the stint open)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _r5 as
select public.remove_manager('be000000-0000-4000-8000-000000000005', 'de000000-0000-4000-8000-000000000051', 'retire', null, 'offseason', 'ae000000-0000-4000-8000-000000000052') as r;
reset role;
select is((select (r ->> 'retired_at_week') is null from _r5), true,
  'H2 COMPLETE (the offseason — "primarily an offseason action"): retired_at_week NULL — nothing left to partition');
select is((select r -> 'repointed' from _r5), '{"rosters": 0, "lineups": 0, "matchups": 0, "results": 0}'::jsonb,
  'H2b zero week rows re-pointed (every week is final) and this fixture holds no roster');
select is(
  (select t.status || ':' || coalesce(t.retired_at_week::text, 'null') || ':' || (t.successor_team_id is not null)::text from teams t where t.id = 'ce000000-0000-4000-8000-000000000051') || '|' ||
  (select tm.end_reason || ':' || coalesce(tm.ended_week::text, 'null') from team_managers tm where tm.team_id = 'ce000000-0000-4000-8000-000000000051'),
  'retired:null:true|seat_retired:null', 'H2c sealed with no week; the stint closed seat_retired with ended_week NULL (§12.22''s "NULL preseason" reading, outside the season)');
select is(
  (select c.message from league_chat c where c.league_id = 'be000000-0000-4000-8000-000000000005' and c.is_system order by c.created_at desc limit 1),
  'RS T5 was retired by rs_user1 — the franchise is sealed under its final manager; Team 3 takes its slot after the season (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: offseason',
  'H2d the post says "after the season"');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000006', 'de000000-0000-4000-8000-000000000061', 'retire') $$,
  'P0001', 'remove_manager: retiring a franchise isn''t available before the draft — use takeover or vacate (§7.2.1; retire-and-succeed arrives with the in-season milestone)',
  'H3 SETUP: D42''s refusal, byte for byte (017 J''s pin still holds; the status gate runs BEFORE the action_id requirement so a 3-argument pre-draft call refuses P0001, not 22023)');
reset role;
select is((select count(*)::int from teams where league_id = 'be000000-0000-4000-8000-000000000006'), 2, 'H3b nothing minted');

-- ---------------------------------------------------------------------------
-- I. The vacate and takeover arms are 063's, unchanged (regression pins on
--    L1's Y and Z; 017 is the full suite).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _rv as
select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000003', 'vacate') as r;
reset role;
select is((select r from _rv),
  '{"ok": true, "mode": "vacate", "member_id": "de000000-0000-4000-8000-000000000003", "team_id": "ce000000-0000-4000-8000-000000000003",
    "removed_user_id": "9e000000-0000-4000-8000-000000000003", "successor_user_id": null, "already_vacant": false}'::jsonb,
  'I1 VACATE: 063''s seven-key payload, byte for byte (no verb, no stamp, no counts)');
select is(
  (select t.status || ':' || coalesce(t.successor_team_id::text, 'null') from teams t where t.id = 'ce000000-0000-4000-8000-000000000003') || '|' ||
  (select tm.end_reason from team_managers tm where tm.team_id = 'ce000000-0000-4000-8000-000000000003' and tm.user_id = '9e000000-0000-4000-8000-000000000003') || '|' ||
  (select lm.is_placeholder::text || ':' || (lm.team_id = 'ce000000-0000-4000-8000-000000000003')::text || ':' || lm.faab_balance::text from league_members lm where lm.id = 'de000000-0000-4000-8000-000000000003'),
  'orphaned:null|kicked|true:true:100',
  'I2 vacate: orphaned (never retired), no successor, end_reason kicked, the seat keeps its franchise, faab re-seeded from the budget (063''s semantics untouched)');
select is(
  (select count(*) filter (where type = 'commissioner_move')::text || ':' || count(*)::text from transactions where league_id = 'be000000-0000-4000-8000-000000000001'),
  '1:2', 'I2b vacate wrote NO ledger row — still ONE commissioner_move (the retirement) beside E2''s add_drop row');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _rt as
select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000004', 'takeover', '9e000000-0000-4000-8000-000000000003', 'swap', 'ae000000-0000-4000-8000-000000000099') as r;
reset role;
select is((select r from _rt),
  '{"ok": true, "mode": "takeover", "member_id": "de000000-0000-4000-8000-000000000004", "team_id": "ce000000-0000-4000-8000-000000000004",
    "removed_user_id": "9e000000-0000-4000-8000-000000000004", "successor_user_id": "9e000000-0000-4000-8000-000000000003", "already_vacant": false}'::jsonb,
  'I3 TAKEOVER (with a stamp passed — ignored): 063''s payload, byte for byte');
select is(
  (select string_agg(tm.user_id::text || ':' || coalesce(tm.end_reason, 'open'), ',' order by tm.started_at)
   from team_managers tm where tm.team_id = 'ce000000-0000-4000-8000-000000000004'),
  '9e000000-0000-4000-8000-000000000004:replaced,9e000000-0000-4000-8000-000000000003:open',
  'I4 takeover: the old stint replaced, the successor''s open — the franchise (Z) continues whole');
select is(
  (select count(*) filter (where type = 'commissioner_move')::text || ':' || count(*)::text from transactions where league_id = 'be000000-0000-4000-8000-000000000001'),
  '1:2', 'I4b takeover wrote NO ledger row either');

-- ---------------------------------------------------------------------------
-- J. The #266 fix round on L1 as §I left it: Y ORPHANED (I1 — u3's stint
--    closed 'kicked'), Z managed by u3 (I3), S managed by u5 (E0).
--    R856's other writers (J0), R858 (J1), R855 (J2 / J3).
-- ---------------------------------------------------------------------------
-- J0: the teams census so far — the diff-aware trigger. C's seal (1), E0's
-- claim of the orphaned S (orphaned → active: 1), I1's vacate (1); I3's
-- takeover of the MANAGED Z listed `status` but changed nothing rendered
-- — SILENT (the F260(b) shape closed, not said).
select is(pg_temp.rs_teams_events('be000000-0000-4000-8000-000000000001'), 3::bigint,
  'J0 three teams events on L1 so far: the seal (C), the claim of the orphaned S (E0), the vacate (I1) — the takeover of a MANAGED franchise (I3) emitted NOTHING (its CASE left status unchanged)');
update teams set updated_at = now() where league_id = 'be000000-0000-4000-8000-000000000001';
select is(pg_temp.rs_teams_events('be000000-0000-4000-8000-000000000001'), 3::bigint,
  'J0b an updated_at-only statement over every L1 franchise emits NOTHING (none of the four rendered columns changed)');

-- J1 (R858): a co-commissioner retiring HIS OWN seat — the leaver has no
-- choice of outcome (§7.2.1; leave_league is the voluntary path).
update league_members set role = 'co_commissioner' where id = 'de000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000004', 'retire', null, 'I quit', 'ae000000-0000-4000-8000-000000000062') $$,
  '42501', 'remove_manager: you cannot retire your own franchise — a leaver has no choice of outcome (§7.2.1); leave the league, or have the commissioner act on your seat',
  'J1 a CO-COMMISSIONER retiring his own seat is refused 42501 BY NAME (the route''s self-DELETE dispatches to leave_league; the direct RPC must not hand the choice back — R858; probe (3) drops the guard)');
reset role;
select is(
  (select count(*)::text from teams where league_id = 'be000000-0000-4000-8000-000000000001') || ':' ||
  (select t.status from teams t where t.id = 'ce000000-0000-4000-8000-000000000004') || ':' ||
  (select count(*)::text from team_managers tm where tm.team_id = 'ce000000-0000-4000-8000-000000000004' and tm.ended_at is null),
  '5:active:1', 'J1b nothing written: five franchises, Z active with u3''s stint open');

-- J2 (R855): Y — vacated in I1 (orphaned; u3's stint closed 'kicked') —
-- is retired by the commissioner: §7.2.1(c) "Orphaned is a holding state
-- that resolves into (a) or (b)". The seal names the last manager
-- (History Mode reads the stints); no stint closes; no one is notified;
-- removed_user_id NULL; successor, ledger row and post as for a managed
-- seat. Probe (1) restores 063's early "no manager" refusal here.
select set_config('pgtap.rs_j0', (select count(*) from notifications n where n.user_id = '9e000000-0000-4000-8000-000000000003' and n.data ->> 'league_id' = 'be000000-0000-4000-8000-000000000001')::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _rj as
select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000003', 'retire', null,
  'the seat stayed empty', 'ae000000-0000-4000-8000-000000000061') as r;
reset role;
select is((select r - 'successor_team_id' - 'member_id' - 'team_id' - 'retired_team_id' from _rj),
  '{"ok": true, "mode": "retire", "verb": "retire_franchise", "action_id": "ae000000-0000-4000-8000-000000000061",
    "removed_user_id": null, "successor_user_id": null, "already_vacant": false, "retired_team_name": "RS Y", "successor_team_name": "Team 6",
    "season": 2026, "retired_at_week": 5, "reason": "the seat stayed empty",
    "repointed": {"rosters": 0, "lineups": 0, "matchups": 2, "results": 0},
    "inherits": {"roster": true, "record": "seeding_only", "h2h_history": false, "faab": "seat_balance_kept"}}'::jsonb,
  'J2 A VACATED FRANCHISE RETIRES (stored literal): removed_user_id NULL (no one was removed), "Team 6" (the series over six franchises), retired_at_week 5, Y''s two matchup rows (week 5 away, week 6 home) re-pointed, no roster / lineups / results');
select is(
  (select t.status || ':' || t.retired_at_week::text || ':' || (t.successor_team_id = ((select r from _rj) ->> 'successor_team_id')::uuid)::text || ':' || t.owner_id::text
   from teams t where t.id = 'ce000000-0000-4000-8000-000000000003'),
  'retired:5:true:9e000000-0000-4000-8000-000000000001',
  'J2b Y is SEALED (retired, week 5, → Team 6, owned by the commissioner) — the same seal as a managed retirement');
select is(
  (select count(*)::text || ':' || min(tm.end_reason) || ':' || min(tm.user_id::text) from team_managers tm where tm.team_id = 'ce000000-0000-4000-8000-000000000003'),
  '1:kicked:9e000000-0000-4000-8000-000000000003',
  'J2c the ONE stint Y ever had stays CLOSED AS VACATE LEFT IT (kicked, u3) — nothing to close, nothing rewritten to seat_retired: History seals Y under u3');
select is(
  (select count(*)::text from notifications n where n.user_id = '9e000000-0000-4000-8000-000000000003' and n.data ->> 'league_id' = 'be000000-0000-4000-8000-000000000001')
    || ':' || current_setting('pgtap.rs_j0'),
  '1:1', 'J2d NO notification: u3''s one L1 notification is the vacate''s ("removed"); the retirement of his former seat sends nothing');
select is(
  (select t.type || ':' || t.initiated_by::text || ':' || (t.payload = (select r from _rj))::text from transactions t where t.action_id = 'ae000000-0000-4000-8000-000000000061'),
  'commissioner_move:9e000000-0000-4000-8000-000000000001:true',
  'J2e the ledger row is written as for a managed seat (payload = the return value)');
select is(
  -- R863 (#266 final re-review): both L1 system posts carry the transaction's one now(), so
  -- "latest by created_at" was a coin flip (red 4 of 5 runs). Select J2's post by its own text.
  (select c.message from league_chat c where c.league_id = 'be000000-0000-4000-8000-000000000001' and c.is_system and c.message like 'RS Y was retired%' order by c.id limit 1),
  'RS Y was retired by rs_user1 — the vacant franchise is sealed under its last manager (§7.2.1(c)); Team 6 takes its slot from Week 5 (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: the seat stayed empty',
  'J2f the post says the seat was vacant and cites §7.2.1(c)');
select is(
  (select (lm.user_id is null)::text || ':' || lm.is_placeholder::text || ':' || (lm.team_id = ((select r from _rj) ->> 'successor_team_id')::uuid)::text
   from league_members lm where lm.id = 'de000000-0000-4000-8000-000000000003'),
  'true:true:true', 'J2g the seat fronts Team 6 as an open placeholder (the same one league_members row)');
select is(pg_temp.rs_teams_events('be000000-0000-4000-8000-000000000001'), 4::bigint,
  'J2h ONE more teams event — the seal (probe (2) reds this with C14)');

-- J3 (R855's other edge): a placeholder seat that reached in_season
-- WITHOUT ever being claimed (draft_start admits placeholders — 084; the
-- draft autopicks for it) is `active` and unmanaged — no manager to seal
-- it under: refused BY NAME.
insert into teams (id, owner_id, name, league_id) values
 ('ce000000-0000-4000-8000-000000000005', '9e000000-0000-4000-8000-000000000001', 'RS PH', 'be000000-0000-4000-8000-000000000001');
insert into league_members (id, league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('de000000-0000-4000-8000-000000000005', 'be000000-0000-4000-8000-000000000001', null, 'ce000000-0000-4000-8000-000000000005', 'manager', true, 100);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.remove_manager('be000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000005', 'retire', null, 'tidy', 'ae000000-0000-4000-8000-000000000063') $$,
  'P0001', 'remove_manager: RS PH has never had a manager — there is no one to seal it under; use assign-manager to seat someone on it first (§7.2.1(b))',
  'J3 a never-claimed placeholder (active, unmanaged, no stint ever) refuses BY NAME — the admission key is a CLOSED STINT, not the status word');
reset role;
select is(
  (select count(*)::text from teams where league_id = 'be000000-0000-4000-8000-000000000001') || ':' ||
  (select count(*) filter (where type = 'commissioner_move')::text from transactions where league_id = 'be000000-0000-4000-8000-000000000001'),
  '7:2', 'J3b nothing minted: seven franchises (A, X, Y, Z, S, Team 6, PH), still two commissioner_move rows (C and J2)');

select * from finish();
rollback;
