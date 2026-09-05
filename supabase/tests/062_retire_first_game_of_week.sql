-- ============================================================================
-- Retire `lineup_lock = first_game_of_week` — pgTAP 062 (task L.D1.5b, the
-- Q34(A) erratum; migration 114; spec v2.16.20 §7.3.6 / §11.2 / §13.1 / App
-- A.1; PROGRESS §3 Q34(A) RULED (a) by Chris 2026-09-05; ledger F230
-- discharged; tasks-M4 §4 rules 1–11; D137 / D311).
--
-- Numbering: pgTAP head measured 061 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 062 — the tasks-M4 §7 reservations shift by one (D161/D166).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * THE CHECK, both directions and through BOTH unvalidating RPCs: the
--     retired value is refused 23514 on a raw INSERT, a raw UPDATE, through
--     `create_league` (077 — writes `p_lineup_lock` straight to the column)
--     and through `update_league_settings` (105 — same); the kept value
--     inserts and updates; the column DEFAULT is the kept value and an
--     INSERT omitting the column reads it back. The constraint's definition
--     is pinned as a stored literal. (The PR's second break probe drops the
--     CHECK → the 23514 cells red.)
--   * THE LIVE-REFERENCE SWEEP: ZERO public function bodies name the retired
--     mode — `pg_proc.prosrc` carries comments, so this also proves 113's
--     comment-only correction reached the stack (a stack that applied the
--     OLD 113 and then 114 alone would fail this cell: the fresh-chain
--     `db reset` is the recorded rehearsal).
--   * THE REPLACEMENT'S SHAPE: `set_lineup_internal` is still PLAIN (not
--     DEFINER) with search_path='' and triple-REVOKEd, exactly one overload
--     beside exactly one `set_lineup` (CREATE OR REPLACE against 112's file
--     text kept the signature — no accidental overload); its body no longer
--     names `v_week_locked` and still carries the per-player refusal text
--     (060's throws_like patterns are the behavioural half of that).
--   * PER-PLAYER-ONLY BEHAVIOUR on an INDEPENDENT fixture (060 §I is the
--     other half, re-cut on L2): the week's FIRST game (KC) kicked off one
--     second ago and the datum SAYS so in the result — and a lineup of
--     unstarted players is SET, then EDITED, then BENCHED ENTIRELY after
--     that kickoff (the retired mode refused all three; the PR's first
--     break probe re-introduces the branch and reds them); `locked_at` is
--     the earliest STARTED player's kickoff (DAL/PHI at now+1h, never KC's)
--     and NULL for a bye-only lineup; flags as literals. NEVER-WEAKEN
--     CONTROL on the same fixture: the kicked-off KC QB still cannot ENTER a
--     slot — his OWN kickoff binds, by name.
--   * All privileged-context work runs as postgres before any role switch;
--     `set_config(..., true)` persists to txn end (D49(7)); the RPC arm runs
--     as `authenticated` with a JWT claim, the seam arm as postgres with the
--     claim set (the body's in-body auth reads auth.uid()). The 2026
--     calendar is re-asserted RELATIVE to now() inside this rolled-back txn
--     (the 060 shape): the CURRENT week is 3 by `nfl_weeks.starts_at`; all
--     2026 `nfl_games` rows are the fixture's own.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

-- ---------------------------------------------------------------------------
-- A. Form pins — the CHECK's definition, the live-reference sweep, the
--    replaced function's shape (§4.1)
-- ---------------------------------------------------------------------------
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c join pg_class r on r.oid = c.conrelid
   where r.relname = 'leagues' and c.conname = 'leagues_lineup_lock_per_player_only'),
  'CHECK ((lineup_lock = ''per_player_kickoff''::text))',
  'leagues_lineup_lock_per_player_only exists and is exactly CHECK (lineup_lock = ''per_player_kickoff'') — the backstop behind create_league (077) and update_league_settings (105), neither of which validates the value');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%first\_game\_of\_week%'),
  0, 'THE LIVE-REFERENCE SWEEP: no public function body names first_game_of_week (prosrc carries comments — 113''s comment correction is on the stack, 112''s replaced body is 114''s)');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_lineup_internal'),
  'set_lineup_internal is still PLAIN (not DEFINER) with search_path='''' after the CREATE OR REPLACE (rule 2 / rule 10: the seam stays postgres-only)');
select ok(
  not has_function_privilege('authenticated', 'public.set_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)', 'EXECUTE'),
  'set_lineup_internal stays triple-REVOKEd — no client can supply the instant');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup', 'set_lineup_internal')),
  2, 'exactly ONE overload each of set_lineup / set_lineup_internal — the replacement kept 112''s signature (R747: no shape left beside the new one)');
select ok(
  (select p.prosrc not like '%v\_week\_locked%'
      and p.prosrc like '%(§11.2, lineup_lock = per_player_kickoff)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_lineup_internal'),
  'the body no longer declares or reads v_week_locked and still carries the per-player refusal text 060 matches on');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims) + the CHECK at the
--    table
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-rf' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'rf_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

-- The calendar, RELATIVE to now(): current week 3. first_kickoff_at NULL
-- (the game rows below are the datum).
update nfl_weeks w
set starts_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day',
    first_kickoff_at = null, last_game_ends_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, settings, roster_settings) values
 ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'pgtap-rf-LX', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"allow_illegal_lineups": true}',
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1},
      {"key": "flex", "label": "W/R/T", "eligible": ["WR", "RB", "TE"], "count": 1}],
    "bench": 4, "ir_slots": [], "swap_spots": 0}');

select throws_ok(
  $$ insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                          lineup_lock, settings, roster_settings) values
     ('b4000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', 'pgtap-rf-LY', 2026, 'setup', 8,
      (select id from scoring_systems where is_template and name = 'ESPN Standard'),
      (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
      'first_game_of_week', '{}', '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}') $$,
  '23514', null, 'the CHECK: INSERT with the RETIRED value is refused 23514');
select throws_ok(
  $$ update leagues set lineup_lock = 'first_game_of_week' where id = 'b4000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'the CHECK: UPDATE to the RETIRED value is refused 23514');
select lives_ok(
  $$ insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                          lineup_lock, settings, roster_settings) values
     ('b4000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', 'pgtap-rf-LY', 2026, 'setup', 8,
      (select id from scoring_systems where is_template and name = 'ESPN Standard'),
      (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
      'per_player_kickoff', '{}', '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}') $$,
  'the CHECK: the kept value inserts (the one-unit positive)');
select col_default_is('public', 'leagues', 'lineup_lock', 'per_player_kickoff',
  'leagues.lineup_lock DEFAULT is the kept value (040:86 — unchanged by 114)');
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     settings, roster_settings) values
 ('b4000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000001', 'pgtap-rf-LZ', 2026, 'setup', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  '{}', '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');
select is((select lineup_lock from leagues where id = 'b4000000-0000-4000-8000-000000000003'), 'per_player_kickoff',
  '…an INSERT omitting the column reads the kept value back');

-- LX's team, membership, calendar, roster and games (the §D fixture).
insert into teams (id, owner_id, name, league_id) values
 ('c4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'RF X1', 'b4000000-0000-4000-8000-000000000001');
insert into league_members (league_id, user_id, team_id, role) values
 ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'commissioner');
insert into league_weeks (league_id, season, week)
select 'b4000000-0000-4000-8000-000000000001', 2026, g from generate_series(1, 8) g;
insert into players (id, full_name, position, team, status) values
 ('rf-qb-a',   'RF QB A',   'QB', 'KC',  'Active'),   -- KC: the week's FIRST game — kicked off one second ago
 ('rf-qb-b',   'RF QB B',   'QB', 'DAL', 'Active'),   -- DAL/PHI: kick off in one hour
 ('rf-rb-b',   'RF RB B',   'RB', 'DAL', 'Active'),
 ('rf-wr-b',   'RF WR B',   'WR', 'PHI', 'Active'),
 ('rf-wr-bye', 'RF WR BYE', 'WR', 'MIA', 'Active'),   -- MIA has no week-3 game: bye
 ('rf-te-c',   'RF TE C',   'TE', 'NYG', 'Active');   -- NYG/SF: three hours out
insert into league_rosters (league_id, team_id, player_id)
select 'b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', id
from players where id like 'rf-%';
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('rf-w3-a', 2026, 3, 'KC',  'BUF', now() - interval '1 second'),
 ('rf-w3-b', 2026, 3, 'DAL', 'PHI', now() + interval '1 hour'),
 ('rf-w3-c', 2026, 3, 'NYG', 'SF',  now() + interval '3 hours');

-- ---------------------------------------------------------------------------
-- C. Through BOTH unvalidating RPCs (as authenticated u2): the retired value
--    is refused 23514 at the table; the kept value lands.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_league(
       'pgtap-rf-create-retired', 2026, 12,
       '{"divisions": 1, "median_game": false}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       'RF Creators', 'ad400000-0000-4000-8000-000000000001',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'first_game_of_week') $$,
  '23514', null,
  'create_league with the RETIRED value is refused 23514 by the CHECK — 077 validates nothing in-body, the table does');
create temp table _rf_cl as
select public.create_league(
  'pgtap-rf-create-kept', 2026, 12,
  '{"divisions": 1, "median_game": false}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'RF Creators', 'ad400000-0000-4000-8000-000000000002',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff'
) as r;
select is((select l.lineup_lock from public.leagues l where l.id = (select (r->>'league_id')::uuid from _rf_cl)),
  'per_player_kickoff', 'create_league with the kept value lands (the one-unit positive)');
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _rf_cl), 12,
       '{"divisions": 1, "median_game": false}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'first_game_of_week') $$,
  '23514', null,
  'update_league_settings with the RETIRED value is refused 23514 by the CHECK — 105 validates nothing in-body either');
select lives_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _rf_cl), 12,
       '{"divisions": 1, "median_game": false}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'update_league_settings with the kept value lives');
reset role;

-- ---------------------------------------------------------------------------
-- D. Per-player-only behaviour (postgres + u1's claim, through the seam at
--    now()): the week's first game has kicked off; nothing but a player's
--    OWN kickoff locks anything.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.rf_d1', public.set_lineup_internal(
       'b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 3,
       '{"qb:0": "rf-qb-b", "rb:0": "rf-rb-b", "wr:0": "rf-wr-b", "flex:0": "rf-te-c"}',
       'a4000000-0000-4000-8000-000000000001', now())::text, true);
select is((select slot_map from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000001' and week = 3),
  '{"qb:0": "rf-qb-b", "rb:0": "rf-rb-b", "wr:0": "rf-wr-b", "flex:0": "rf-te-c"}'::jsonb,
  'D1 Q34(A)/114: the week''s FIRST game (KC) kicked off one second ago — a lineup of unstarted players is SET (the retired mode refused this)');
select is((current_setting('pgtap.rf_d1')::jsonb -> 'week_datum' ->> 'first_kickoff_at')::timestamptz, now() - interval '1 second',
  'D1 …and the result''s week datum IS that kickoff (now−1s, nfl_games) — returned, decides nothing');
select is((current_setting('pgtap.rf_d1')::jsonb -> 'week_datum' ->> 'kicked_off')::boolean, true,
  'D1 …reported as kicked off');
select is((select locked_at from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000001' and week = 3),
  now() + interval '1 hour',
  'D1 locked_at = the earliest STARTED player''s kickoff (DAL/PHI at now+1h) — never the week''s first kickoff');
select is(current_setting('pgtap.rf_d1')::jsonb ->> 'lineup_lock', 'per_player_kickoff',
  'D1 the result echoes the only lineup lock (the CHECK-constrained column)');
-- D2. EDIT after the week's first kickoff (TE out, the bye WR in), then bench
--     EVERYONE — both succeed; flags as literals.
select set_config('pgtap.rf_d2', public.set_lineup_internal(
       'b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 3,
       '{"qb:0": "rf-qb-b", "rb:0": "rf-rb-b", "wr:0": "rf-wr-b", "flex:0": "rf-wr-bye"}',
       'a4000000-0000-4000-8000-000000000002', now())::text, true);
select is(current_setting('pgtap.rf_d2')::jsonb -> 'flags',
  '{"illegal": true, "bye": ["rf-wr-bye"], "out": [], "empty": [], "ir_ineligible": []}'::jsonb,
  'D2 an EDIT after the week''s first kickoff succeeds (TE → the bye WR at flex:0; allow_illegal TRUE flags the bye) — every unlocked slot stays editable');
select set_config('pgtap.rf_d3', public.set_lineup_internal(
       'b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 3,
       '{}', 'a4000000-0000-4000-8000-000000000003', now())::text, true);
select is((select slot_map from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000001' and week = 3), '{}'::jsonb,
  'D2 BENCHING EVERY starter after the week''s first kickoff succeeds — the stored map is empty (nothing but a player''s own kickoff locks a slot)');
select is(current_setting('pgtap.rf_d3')::jsonb -> 'flags',
  '{"illegal": false, "bye": [], "out": [], "empty": ["qb:0", "rb:0", "wr:0", "flex:0"], "ir_ineligible": []}'::jsonb,
  'D2 …every slot flagged empty (a vacancy is legal under both settings; it scores 0)');
-- D3. A bye-only lineup has NO lock instant to record.
select lives_ok(
  $$ select public.set_lineup_internal('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 3,
       '{"flex:0": "rf-wr-bye"}', 'a4000000-0000-4000-8000-000000000004', now()) $$,
  'D3 a bye-only lineup sets');
select is((select locked_at from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000001' and week = 3), null::timestamptz,
  'D3 …and locked_at is NULL — no started player has a kickoff; 112''s week-datum fallback for locked_at is gone with the mode');
-- D4. NEVER-WEAKEN CONTROL: the KC QB's OWN kickoff still binds him.
select throws_like(
  $$ select public.set_lineup_internal('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 3,
       '{"qb:0": "rf-qb-a", "flex:0": "rf-wr-bye"}', 'a4000000-0000-4000-8000-000000000005', now()) $$,
  '%RF QB A''s game kicked off at % (nfl_games) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff)%',
  'D4 never-weaken: the kicked-off KC QB still cannot ENTER a slot — his OWN kickoff is the lock, by name');

select * from finish();
rollback;
