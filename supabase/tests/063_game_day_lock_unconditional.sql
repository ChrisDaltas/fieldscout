-- ============================================================================
-- The game-day lock is a RULE — pgTAP 063 (task L.D1.5c, the Q34(B) + Q35
-- application; migration 115; spec v2.16.21 §13.1 / §7.3.4 / §12.19 / E32 /
-- E34; PROGRESS §3 Q34(B) RULED by Chris 2026-09-05 + Q35 RULED (a) by
-- Chris 2026-09-05; ledger F231 discharged (folded by deletion in 061 —
-- the structural half lives here), F232's spec half discharged, F236
-- applied; tasks-M4 §4 rules 1–11; D137 / D312).
--
-- Numbering: pgTAP head measured 062 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 063 — the tasks-M4 §7 reservations shift again (D161/D166;
-- D311(1); D312(1)).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * THE RETIRED SETTING CANNOT BE STORED: `leagues_settings_no_player_
--     game_lock` refuses the JSONB key 23514 on a raw INSERT, a raw UPDATE
--     (`settings || key`), through `create_league` (077 — writes
--     `p_settings` straight to the column) and through
--     `update_league_settings` (105 — same); the key-free twin lands each
--     time; the constraint's definition is pinned as a stored literal.
--   * THE SHAPE: exactly ONE overload each of `pool_game_lock_internal` /
--     `pool_game_lock_any_internal`, the 4-argument identity as a literal
--     through `pg_get_function_arguments` (which DOES carry defaults — the
--     F231 lesson: `pg_get_function_identity_arguments` does not), the
--     5-argument signatures gone BY NAME (`to_regprocedure` NULL), both
--     still PLAIN with search_path='' and triple-REVOKEd on the NEW
--     signatures (a fresh CREATE has PUBLIC EXECUTE by default — the
--     REVOKE is load-bearing, and this cell would red without it).
--   * THE LIVE-REFERENCE SWEEP: ZERO public function bodies name
--     `player_game_lock` or `p_enforced` (`pg_proc.prosrc` carries comments,
--     so 113's bodies — which named both in comments and messages — are
--     proven REPLACED on the fresh chain); neither helper nor the seam
--     names the correction-window column; both helpers name
--     `last_game_ends_at`.
--   * BEHAVIOUR on an INDEPENDENT fixture (061 is the other half, re-cut):
--     kickoff −1s free / AT and +1s locked for the ADD of a free agent AND
--     the DROP of a starter (D146 one-unit pairs on the datum inside the
--     frozen txn); a SET `last_game_ends_at` releases at EXACTLY that
--     instant (−1s refused / AT lives, both sides); NULL `last_game_ends_at`
--     = the week is not over = LOCKED on both sides with NO raise (the text
--     says "not yet recorded … still locked") while the unstarted twins
--     live under the same NULL; the helper's own document reads `locked:
--     true, window_ends_at: null`. THE WRONG-COLUMN CONTROLS: with the
--     correction window CLOSED a day ago and the last game still ahead the
--     lock still binds, and with the correction window a week out and the
--     last game ended a second ago it releases — the release is
--     `last_game_ends_at` and nothing else (the PR's first break probe
--     swaps the read back and reds these).
--   * All privileged-context work runs as postgres before any role switch;
--     `set_config(..., true)` persists to txn end (D49(7)); the RPC arm
--     runs as `authenticated` with a JWT claim, the seam arm as postgres
--     with the claim set (the body's in-body auth reads auth.uid()). The
--     2026 calendar is re-asserted RELATIVE to now() inside this rolled-
--     back txn (the 061 shape): current week 3; weeks ≤ 3 carry a
--     `last_game_ends_at` six days after they start, weeks ahead NULL; the
--     correction window sits eight days after each start (populated,
--     later than the release); all 2026 `nfl_games` rows are the fixture's
--     own.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

-- ---------------------------------------------------------------------------
-- A. Form pins — the CHECK's definition, the helpers' shape, the sweep
-- ---------------------------------------------------------------------------
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c join pg_class r on r.oid = c.conrelid
   where r.relname = 'leagues' and c.conname = 'leagues_settings_no_player_game_lock'),
  'CHECK ((NOT (settings ? ''player_game_lock''::text)))',
  'leagues_settings_no_player_game_lock exists and is exactly CHECK (NOT (settings ? ''player_game_lock'')) — the JSONB analogue of DROP COLUMN for a key that never had a typed column');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pool_game_lock_internal'),
  'p_season integer, p_week integer, p_nfl_team text, p_at timestamp with time zone',
  'pool_game_lock_internal takes exactly (season, week, nfl_team, at) — no enforced flag, no DEFAULT (pg_get_function_arguments carries defaults: the F231 instrument)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pool_game_lock_any_internal'),
  'p_season integer, p_current_week integer, p_nfl_team text, p_at timestamp with time zone',
  'pool_game_lock_any_internal takes exactly (season, current_week, nfl_team, at)');
select ok(
  to_regprocedure('public.pool_game_lock_internal(integer,integer,text,timestamptz,boolean)') is null
  and to_regprocedure('public.pool_game_lock_any_internal(integer,integer,text,timestamptz,boolean)') is null,
  'the 5-argument overloads are GONE by name (to_regprocedure NULL for both) — no second reading of the lock survives beside the new one');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal')),
  2, 'exactly ONE overload each of the two helpers');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal', 'roster_add_drop_internal')),
  'the two helpers and the seam are still PLAIN (not DEFINER) with search_path='''' (rule 2 / rule 10)');
select ok(
  not has_function_privilege('authenticated', 'public.pool_game_lock_internal(integer,integer,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.pool_game_lock_internal(integer,integer,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.pool_game_lock_any_internal(integer,integer,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.pool_game_lock_any_internal(integer,integer,text,timestamptz)', 'EXECUTE'),
  'the NEW 4-arg signatures are triple-REVOKEd — a fresh CREATE grants PUBLIC EXECUTE by default, so this REVOKE is load-bearing');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.prosrc like '%player\_game\_lock%' or p.prosrc like '%p\_enforced%')),
  0, 'THE LIVE-REFERENCE SWEEP: no public function body names player_game_lock or p_enforced (prosrc carries comments — 113''s bodies, which named both, are REPLACED on the fresh chain)');
select ok(
  (select bool_and(p.prosrc not like '%correction\_window\_ends\_at%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal', 'roster_add_drop_internal'))
  and (select bool_and(p.prosrc like '%last\_game\_ends\_at%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal')),
  'neither helper nor the seam names the correction-window column; both helpers name last_game_ends_at — the release moved (Q34(B))');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims) + the CHECK at the
--    table
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('95000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-gl' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'gl_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

-- The calendar, RELATIVE to now(): current week 3; weeks ≤ 3 carry their
-- last game's end six days after they start (week 2 ended two days ago,
-- week 3 ends in five days), weeks ahead NULL; the correction window sits
-- eight days after each start — populated and LATER than the release.
update nfl_weeks w
set starts_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day',
    last_game_ends_at = case when w.week <= 3 then now() + ((w.week - 3) * interval '7 days') - interval '1 day' + interval '6 days' end,
    correction_window_ends_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day' + interval '8 days',
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, settings, roster_settings) values
 ('b5000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'pgtap-gl-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab',
  '{"waiver_period_hours": 48, "free_agency": "immediate_after_waivers", "fa_hold_hours": 0, "allow_illegal_lineups": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

select throws_ok(
  $$ insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot, settings, roster_settings)
     values ('b5000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000001', 'pgtap-gl-L2', 2026, 'setup', 8,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       '{"player_game_lock": true}',
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}') $$,
  '23514', null, 'the CHECK: an INSERT whose settings carry player_game_lock (even TRUE — the value is irrelevant, the KEY is retired) is refused 23514');
select throws_ok(
  $$ update leagues set settings = settings || '{"player_game_lock": false}' where id = 'b5000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'the CHECK: an UPDATE adding the key is refused 23514');
select lives_ok(
  $$ update leagues set settings = settings || '{"bench_lock": false}' where id = 'b5000000-0000-4000-8000-000000000001' $$,
  'the CHECK: an UPDATE adding a LIVE §7.3.4 key (bench_lock) lands — only the retired key is refused');
select is((select settings ? 'player_game_lock' from leagues where id = 'b5000000-0000-4000-8000-000000000001'), false,
  'the fixture league carries no player_game_lock key (the strip is the migration''s; here the key never existed)');

insert into teams (id, owner_id, name, league_id) values
 ('c5000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'GL T1', 'b5000000-0000-4000-8000-000000000001');
insert into league_members (league_id, user_id, team_id, role) values
 ('b5000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'commissioner');
insert into league_weeks (league_id, season, week)
select 'b5000000-0000-4000-8000-000000000001', 2026, g from generate_series(1, 8) g;
insert into players (id, full_name, position, team, status) values
 ('gl-qb',     'GL QB',     'QB', 'KC',  'Active'),   -- T1 starter; KC kicked off ONE SECOND AGO
 ('gl-rb',     'GL RB',     'RB', 'DAL', 'Active'),   -- T1 bench; DAL kicks off in one second
 ('gl-fa-kc',  'GL FA KC',  'WR', 'KC',  'Active'),   -- free agent, KC: kicked off
 ('gl-fa-dal', 'GL FA DAL', 'WR', 'DAL', 'Active');   -- free agent, DAL: one second ahead
insert into league_rosters (league_id, team_id, player_id) values
 ('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-qb'),
 ('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-rb');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('gl-w3-a', 2026, 3, 'KC',  'BUF', now() - interval '1 second'),
 ('gl-w3-b', 2026, 3, 'DAL', 'PHI', now() + interval '1 second');

select is(public.lineup_current_week_internal('b5000000-0000-4000-8000-000000000001', now()), 3,
  'the current week is 3 by the nfl_weeks.starts_at boundary');

-- Fixture helpers (postgres): undo an add / a drop so every cell starts from
-- the same roster.
create function pg_temp.gl_undo_add(p_player text, p_action uuid) returns void language plpgsql as $$
begin
  delete from public.league_rosters where league_id = 'b5000000-0000-4000-8000-000000000001' and player_id = p_player;
  delete from public.league_player_pool where league_id = 'b5000000-0000-4000-8000-000000000001' and player_id = p_player;
  delete from public.transactions where action_id = p_action;
end $$;
create function pg_temp.gl_undo_drop(p_player text, p_action uuid) returns void language plpgsql as $$
begin
  insert into public.league_rosters (league_id, team_id, player_id)
  values ('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', p_player);
  delete from public.league_player_pool where league_id = 'b5000000-0000-4000-8000-000000000001' and player_id = p_player;
  delete from public.transactions where action_id = p_action;
end $$;

-- ---------------------------------------------------------------------------
-- C. Through BOTH unvalidating RPCs (as authenticated u2): the key is refused
--    23514 at the table; the key-free twin lands.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_league(
       'pgtap-gl-create-retired', 2026, 12,
       '{"divisions": 1, "median_game": false, "player_game_lock": true}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       'GL Creators', 'ad500000-0000-4000-8000-000000000001',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '23514', null,
  'create_league with p_settings carrying the retired key is refused 23514 by the CHECK — 077 validates nothing in-body, the table does');
create temp table _gl_cl as
select public.create_league(
  'pgtap-gl-create-kept', 2026, 12,
  '{"divisions": 1, "median_game": false}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'GL Creators', 'ad500000-0000-4000-8000-000000000002',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff'
) as r;
select is((select l.settings ? 'player_game_lock' from public.leagues l where l.id = (select (r->>'league_id')::uuid from _gl_cl)),
  false, 'create_league without the key lands (the one-unit positive)');
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _gl_cl), 12,
       '{"divisions": 1, "median_game": false, "player_game_lock": false}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '23514', null,
  'update_league_settings with p_settings carrying the retired key is refused 23514 by the CHECK — 105 validates nothing in-body either');
select lives_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _gl_cl), 12,
       '{"divisions": 1, "median_game": true}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'update_league_settings without the key lands');
reset role;

-- ---------------------------------------------------------------------------
-- D. Behaviour through the seam (as postgres with u1's claim — the body's
--    in-body auth reads auth.uid()): the lock is a RULE on both sides
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- D1. kickoff, the ADD side (FA KC kicked off at now−1s).
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-kc', null,
       'ab500000-0000-4000-8000-000000000001', now()) $$,
  '%GL FA KC (gl-fa-kc) is locked for adds — kicked off at % (nfl_games); week 3 clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups%',
  'D1 ADD at kickoff+1s: refused by name — the text names the last game''s end as the release and says the lock binds regardless of settings');
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-kc', null,
       'ab500000-0000-4000-8000-000000000001', now() - interval '1 second') $$,
  '%GL FA KC (gl-fa-kc) is locked for adds%',
  'D1 ADD AT the kickoff: refused (closed at the instant)');
select lives_ok(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-kc', null,
       'ab500000-0000-4000-8000-000000000001', now() - interval '2 seconds') $$,
  'D1 ADD at kickoff−1s: LIVES (the one-unit positive)');
select pg_temp.gl_undo_add('gl-fa-kc', 'ab500000-0000-4000-8000-000000000001');
-- D2. kickoff, the DROP side (QB, KC).
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', null, 'gl-qb',
       'ab500000-0000-4000-8000-000000000002', now()) $$,
  '%GL QB (gl-qb) is locked for drops — kicked off at % (nfl_games); week 3 clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game%',
  'D2 DROP at kickoff+1s: refused by name (the drop side is guarded independently — 061 §F''s probe)');
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', null, 'gl-qb',
       'ab500000-0000-4000-8000-000000000002', now() - interval '1 second') $$,
  '%GL QB (gl-qb) is locked for drops%',
  'D2 DROP AT the kickoff: refused');
select lives_ok(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', null, 'gl-qb',
       'ab500000-0000-4000-8000-000000000002', now() - interval '2 seconds') $$,
  'D2 DROP at kickoff−1s: LIVES');
select pg_temp.gl_undo_drop('gl-qb', 'ab500000-0000-4000-8000-000000000002');

-- D3. THE RELEASE IS EXACTLY last_game_ends_at (D146 −1s / AT), both sides.
--     KC kicked off a day ago; the correction window stays at now+7d.
update nfl_games set kickoff_at = now() - interval '1 day' where id = 'gl-w3-a';
update nfl_weeks set last_game_ends_at = now() + interval '1 second' where season = 2026 and week = 3;
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-kc', null,
       'ab500000-0000-4000-8000-000000000003', now()) $$,
  '%GL FA KC (gl-fa-kc) is locked for adds%', 'D3 ADD at last-game-end−1s: refused');
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', null, 'gl-qb',
       'ab500000-0000-4000-8000-000000000004', now()) $$,
  '%GL QB (gl-qb) is locked for drops%', 'D3 DROP at last-game-end−1s: refused');
update nfl_weeks set last_game_ends_at = now() where season = 2026 and week = 3;
select lives_ok(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-kc', null,
       'ab500000-0000-4000-8000-000000000003', now()) $$,
  'D3 ADD AT last_game_ends_at: LIVES — the release is exactly the instant the week''s last game ended (Q34(B): "players unlock after the last game has finished")');
select pg_temp.gl_undo_add('gl-fa-kc', 'ab500000-0000-4000-8000-000000000003');
select lives_ok(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', null, 'gl-qb',
       'ab500000-0000-4000-8000-000000000004', now()) $$,
  'D3 DROP AT last_game_ends_at: LIVES');
select pg_temp.gl_undo_drop('gl-qb', 'ab500000-0000-4000-8000-000000000004');
select is((select correction_window_ends_at > now() + interval '6 days' from nfl_weeks where season = 2026 and week = 3), true,
  'D3 …while the correction window is still a week out — it did not govern the release (the wrong-column control, one half)');

-- D4. THE WRONG-COLUMN CONTROL, the other half: the correction window CLOSED
--     a day ago, the last game still five days out → still locked.
update nfl_weeks set last_game_ends_at = now() + interval '5 days', correction_window_ends_at = now() - interval '1 day'
where season = 2026 and week = 3;
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-kc', null,
       'ab500000-0000-4000-8000-000000000005', now()) $$,
  '%GL FA KC (gl-fa-kc) is locked for adds%',
  'D4 the correction window closed a day ago but the last game is five days out: STILL locked — a scoring boundary never releases a transaction lock');
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', null, 'gl-qb',
       'ab500000-0000-4000-8000-000000000005', now()) $$,
  '%GL QB (gl-qb) is locked for drops%', 'D4 …the drop side agrees');
update nfl_weeks set correction_window_ends_at = now() + interval '7 days' where season = 2026 and week = 3;   -- restore

-- D5. NULL last_game_ends_at = the week is NOT over = LOCKED, both sides, no
--     raise; the unstarted twins live; the helpers' documents say so.
update nfl_weeks set last_game_ends_at = null where season = 2026 and week = 3;
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-kc', null,
       'ab500000-0000-4000-8000-000000000006', now()) $$,
  '%GL FA KC (gl-fa-kc) is locked for adds — kicked off at % (nfl_games); week 3 clears at an instant not yet recorded — nfl_weeks.last_game_ends_at is NULL until every game of the week is final, so he stays locked%',
  'D5 NULL last_game_ends_at, the ADD: refused as LOCKED with the text naming the unrecorded end — never a raise, never read as free');
select throws_like(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', null, 'gl-qb',
       'ab500000-0000-4000-8000-000000000007', now()) $$,
  '%GL QB (gl-qb) is locked for drops — kicked off at % (nfl_games); week 3 clears at an instant not yet recorded%',
  'D5 NULL last_game_ends_at, the DROP: refused as LOCKED the same way');
select lives_ok(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-dal', null,
       'ab500000-0000-4000-8000-000000000008', now()) $$,
  'D5 …the UNSTARTED free agent (DAL +1s) adds under the same NULL (NULL locks only the kicked-off)');
select pg_temp.gl_undo_add('gl-fa-dal', 'ab500000-0000-4000-8000-000000000008');
select lives_ok(
  $$ select public.roster_add_drop_internal('b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', null, 'gl-rb',
       'ab500000-0000-4000-8000-000000000009', now()) $$,
  'D5 …and the UNSTARTED bench player (DAL +1s) drops under the same NULL');
select pg_temp.gl_undo_drop('gl-rb', 'ab500000-0000-4000-8000-000000000009');
select is(
  (select jsonb_build_object('locked', locked, 'window_ends_at', window_ends_at, 'datum_arm', datum_arm, 'on_bye', on_bye)
   from public.pool_game_lock_internal(2026, 3, 'KC', now())),
  '{"locked": true, "window_ends_at": null, "datum_arm": "nfl_games", "on_bye": false}'::jsonb,
  'D5 pool_game_lock_internal under a NULL end: locked true, window_ends_at null — returned, not raised (the loud reading)');
select is(
  (public.pool_game_lock_any_internal(2026, 3, 'KC', now())) - 'kickoff_at',
  '{"locked": true, "week": 3, "window_ends_at": null, "datum_arm": "nfl_games", "on_bye": false}'::jsonb,
  'D5 pool_game_lock_any_internal under a NULL end: the current week binds with a NULL window_ends_at');
select is(
  (public.pool_game_lock_any_internal(2026, 3, 'DAL', now())) - 'kickoff_at',
  '{"locked": false, "week": 3, "window_ends_at": null, "datum_arm": "nfl_games", "on_bye": false}'::jsonb,
  'D5 …and an unstarted team reads locked false under the same NULL');
update nfl_weeks set last_game_ends_at = now() + interval '5 days' where season = 2026 and week = 3;   -- restore

-- D6. The result payload no longer echoes the retired setting; window_ends_at
--     in the lock document IS the week's last_game_ends_at.
select set_config('pgtap.gl_r', public.roster_add_drop_internal(
  'b5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'gl-fa-dal', null,
  'ab500000-0000-4000-8000-000000000010', now())::text, true);
select is(current_setting('pgtap.gl_r')::jsonb -> 'settings',
  '{"lineup_lock": "per_player_kickoff", "waiver_type": "faab", "waiver_period_hours": 48, "free_agency": "immediate_after_waivers", "fa_hold_hours": 0}'::jsonb,
  'D6 the result''s settings echo is exactly the five live keys — no player_game_lock (retired)');
select is((current_setting('pgtap.gl_r')::jsonb -> 'add' -> 'game_lock' ->> 'window_ends_at')::timestamptz, now() + interval '5 days',
  'D6 the lock document''s window_ends_at IS week 3''s last_game_ends_at (now + 5 days), not its correction window (now + 7 days)');
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
