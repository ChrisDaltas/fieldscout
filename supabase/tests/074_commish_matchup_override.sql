-- ============================================================================
-- `commish_edit_score` / `commish_set_result`, F325's `matchups` backstop, and
-- the rebuild's GUC narrowing — pgTAP 074 (migration 126; task L.E1.5 of M6A;
-- spec §15.4:1692-1693, §22.2, §12.12, §10.3, §11.2; tasks-M6A §3
-- D341/D342/D343/D344/D350/D353 and §4 rules 1-15).
--
-- Numbering: pgTAP head measured 073 by `ls supabase/tests/ | tail -1` ⇒ 074.
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rules 9 + 14):
--   * **THE SECURITY CLAIM IS §A AND IT IS FIRST.** D344 narrows
--     `rebuild_team_week_results`' JWT guard, and a narrowing that had
--     accidentally become a lift would be invisible in every propagation
--     cell — they would simply pass. So §A asserts, before anything else,
--     that a SIGNED-IN caller with NO GUC is still refused 42501 BY MESSAGE.
--     **It is not vacuous through the grant**: `authenticated` holds no
--     EXECUTE on the rebuild at all, so a cell that merely called it as
--     `authenticated` would be asserting the REVOKE and not the body. §A1
--     therefore runs as the OWNER — the role every SECURITY DEFINER writer
--     runs as — with a JWT claim set, which is exactly the shape of a verb
--     calling it in-body. §A4 then runs the SAME call with NO claim and
--     shows it gets PAST the guard (it raises P0002 for an unknown league,
--     not 42501), so §A1's refusal is the JWT arm and not a blanket one.
--   * **THE GUC IS TRANSACTION-LOCAL AND THIS WHOLE SUITE IS ONE
--     TRANSACTION (D49(7)).** `log_commissioner_action_internal` sets
--     `app.commish_action_id` with `set_config(..., true)`, so the FIRST
--     successful verb call arms it for every cell that follows — and every
--     backstop cell would then pass with the trigger deleted. Each §H cell
--     therefore CLEARS the GUC and **asserts it is empty first** (rule
--     14(c)): §H0 before the direct-UPDATE cells, §H7 before finalize, §J2
--     before the in-body rebuild. Without those three the whole of §H would
--     pass with the trigger dropped — the exact class of vacuous proof rule
--     14 exists to forbid.
--   * **THE `finalize_matchups` CELL IS THE REASON D343 EXISTS, AND ITS
--     FIXTURE IS THE CELL.** §12.12 prints `IF (NEW.is_overridden AND guc =
--     '')`, which refuses finalization's status-only flip on an
--     ALREADY-OVERRIDDEN row (118:2098-2100, pg_cron, no GUC). The fixture
--     therefore CONTAINS such a row: §H6 overrides week 5's `d5…51` through
--     the REAL verb, and §H8 asserts that premise — `(true, 'live', 'home')`
--     — before §H10 calls finalize. Over a fixture with no overridden row the
--     cell would pass against either predicate. `finalize_matchups` swallows
--     a per-league raise into `failures[]` (118's subtransaction), so the
--     cells assert the OUTCOME — `failures = []`, `finalized = 1`, the row
--     `final`, the week `final`, the derived `h2h_result` — never merely that
--     the call lived.
--   * **THE WRITE-DOOR CELL IS ON A REAL ROW, BOTH SIDES OF THE OVERRIDE
--     (R972).** §C4/§C5 assert the door CAN write `d5…41` (one written, the
--     number in the row) BEFORE the override; §I1-§I4 then assert zero
--     writable rows, `reason = 'nothing_writable'`, the row NAMED in
--     `skipped[]` with reason `overridden`, and the commissioner's number
--     unmoved by a drain that wanted to write 99. A count over an empty
--     table, or a post-override assertion with no pre-override premise, is
--     satisfiable by a door that never worked.
--   * **THE NO-OP IS ASSERTED FOUR WAYS** (§G, Chris's one condition): the
--     document says `no_changes = true` and `commissioner_action_id` null,
--     the `commissioner_actions` count is UNCHANGED, the `league_chat`
--     count is UNCHANGED, and `matchups.updated_at` has not moved. Plus a
--     byte-identical replay on a reused `action_id`.
--   * **`is_overridden` IS IN THE NO-OP COMPARISON, and §D4 + §F6 are what
--     prove it.** §D4 sends `d5…53` the scores it ALREADY HAS (88/77) on a
--     row that is not yet overridden. That is NOT a no-op — it freezes the
--     cell out of live scoring — so the verb must treat it as a change, and
--     §F6 asserts it wrote the table's only audit row. A comparison over the
--     scores alone would have answered it `no_changes: true` and written no
--     receipt for a freeze.
--   * REASON, one unit either side; both arms' refusals BY NAME; the bye
--     row's result refusal BY NAME; the winner-not-a-side refusal naming the
--     tie route (F351).
--   * ROLES (§F): the edited team's own manager, an outsider, a non-managing
--     member and anon all get the same no-leak 42501.
--   * NEVER-WEAKEN PINS (§K): `score_write_week_batch`'s two
--     `NOT m.is_overridden` exclusions and `finalize_matchups`' overridden
--     branch are still present in `prosrc`. This verb RIDES both; a PR that
--     "simplified" either would silently un-freeze the override.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(125);

-- ---------------------------------------------------------------------------
-- A. THE SECURITY CLAIM, FIRST (D344). Read the banner note before touching
--    these four cells — three of the four obvious ways to write them are
--    vacuous.
-- ---------------------------------------------------------------------------
select is(coalesce(current_setting('app.commish_action_id', true), ''), '',
  'A0 PREMISE: app.commish_action_id is UNSET at the top of this transaction — every §A cell below is about the guard, not about a GUC left over from a verb');

-- `auth.uid()` reads the claim, not a row: the subject need not exist yet.
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.rebuild_team_week_results('00000000-0000-4000-8000-0000000000aa'::uuid, 1) $$,
  '42501',
  'rebuild_team_week_results: the rebuild is run by the service role, the harness, or an audited commissioner verb in-body — never by a signed-in user',
  'A1 THE SECURITY CLAIM: a SIGNED-IN caller with NO app.commish_action_id GUC is still refused 42501 BY MESSAGE — D344 NARROWED the guard, it did not lift it. Run as the OWNER (the role every SECURITY DEFINER writer runs as) with a JWT claim, because a cell run as `authenticated` would be asserting the REVOKE instead of the body');

select ok(
  not has_function_privilege('anon',          'public.rebuild_team_week_results(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.rebuild_team_week_results(uuid, integer)', 'EXECUTE'),
  'A2 …and the REVOKE is still in place too: neither anon nor authenticated holds EXECUTE on the rebuild (the narrowing touched the BODY, never the grants)');
select ok(
  has_function_privilege('service_role', 'public.rebuild_team_week_results(uuid, integer)', 'EXECUTE'),
  'A3 …while service_role keeps it (the worker/harness door is unchanged)');

select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select public.rebuild_team_week_results('00000000-0000-4000-8000-0000000000aa'::uuid, 1) $$,
  'P0002', null,
  'A4 NOT A BLANKET REFUSAL: the SAME call with NO JWT claim gets PAST the guard and fails on the league lookup instead (P0002) — so A1''s 42501 is the auth.uid() arm firing, not a function that refuses everything');

-- ---------------------------------------------------------------------------
-- B. FORM PINS — the ledger (D350), the doors, the backstop trigger, and the
--    D137 pin on the replaced rebuild (§4.1 grants doctrine).
-- ---------------------------------------------------------------------------
select has_table('public', 'commish_matchup_actions',
  'B1 commish_matchup_actions exists — this verb family''s OWN replay ledger (D350: no two verbs share a (league_id, action_id) namespace)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'commish_matchup_actions'),
  0, 'B2 …with ZERO policies: the DEFINER verbs are its only reader and writer, so no client can pre-plant a replay row (the attack commissioner_actions'' printed INSERT policy makes possible — 123:333-335)');
select ok(
  exists (select 1 from pg_constraint c
          where c.conrelid = 'public.commish_matchup_actions'::regclass
            and c.contype = 'u'
            and (select array_agg(a.attname::text order by a.attname)
                 from unnest(c.conkey) k join pg_attribute a
                   on a.attrelid = c.conrelid and a.attnum = k) = array['action_id', 'league_id']),
  'B3 …and UNIQUE (league_id, action_id) is the race backstop behind the select-then-insert');
-- R998's shape: a pg_policies assertion structurally CANNOT see a TRUNCATE
-- grant, and Supabase's default hands TRUNCATE on a new public table to anon
-- and authenticated. Measured per role, plus PUBLIC (grantee 0).
select ok(
  not has_table_privilege('anon',          'public.commish_matchup_actions', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.commish_matchup_actions', 'TRUNCATE')
  and not exists (
    select 1 from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.commish_matchup_actions'::regclass
      and a.privilege_type = 'TRUNCATE' and a.grantee = 0),
  'B4 REVOKE TRUNCATE holds per role AND for PUBLIC — RLS does not cover TRUNCATE (D350, 123:485-491), so without this a client could empty a ledger it cannot read one row of. F349''s deferred app-wide sweep is not widened by this table');
select ok(
  has_table_privilege('service_role', 'public.commish_matchup_actions', 'TRUNCATE')
  and has_table_privilege('postgres', 'public.commish_matchup_actions', 'TRUNCATE'),
  'B5 …and the operator still can: the REVOKE narrowed the door without locking the recovery path out of it (123:491''s shape — this is an idempotency ledger, not the audit log, so no BEFORE TRUNCATE trigger)');

select has_function('public', 'commish_edit_score',
  array['uuid', 'uuid', 'numeric', 'numeric', 'text', 'uuid'],
  'B6 commish_edit_score(league, matchup, home, away, reason, action_id) — spec:1692''s route');
select has_function('public', 'commish_set_result',
  array['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'B7 commish_set_result(league, matchup, winner, reason, action_id) — spec:1693''s route');
select has_function('public', 'commish_matchup_override_internal',
  array['uuid', 'uuid', 'numeric', 'numeric', 'uuid', 'uuid', 'timestamptz', 'text', 'text'],
  'B8 …both over ONE internal (D341): two routes, one verb family, one replay namespace');

select ok(
  (select prosecdef from pg_proc where oid = 'public.commish_edit_score(uuid,uuid,numeric,numeric,text,uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'public.commish_set_result(uuid,uuid,uuid,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc
           where oid = 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)'::regprocedure),
  'B9 THE POSTURE PAIR (D336 part 5): both doors are SECURITY DEFINER, the internal is PLAIN — a seam, not a door');
select ok(
  (select bool_and('search_path=""' = any(coalesce(proconfig, '{}')))
   from pg_proc
   where oid in ('public.commish_edit_score(uuid,uuid,numeric,numeric,text,uuid)'::regprocedure,
                 'public.commish_set_result(uuid,uuid,uuid,text,uuid)'::regprocedure,
                 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)'::regprocedure,
                 'public.matchups_override_guard_internal()'::regprocedure,
                 'public.commish_override_freeze_internal(boolean,boolean,boolean,boolean)'::regprocedure,
                 'public.rebuild_team_week_results(uuid,integer)'::regprocedure)),
  'B10 every function this migration writes or replaces pins search_path='''' (§4.1) — all SIX, the pure freeze chooser included');
select ok(
  has_function_privilege('authenticated', 'public.commish_edit_score(uuid,uuid,numeric,numeric,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_set_result(uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_edit_score(uuid,uuid,numeric,numeric,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_set_result(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'B11 the client doors keep EXECUTE for authenticated and none for anon; the commissioner gate is IN-BODY (112:1237''s posture)');
select ok(
  not has_function_privilege('anon', 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.matchups_override_guard_internal()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.matchups_override_guard_internal()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_override_freeze_internal(boolean,boolean,boolean,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_override_freeze_internal(boolean,boolean,boolean,boolean)', 'EXECUTE'),
  'B12 …and the internal, the trigger function and the freeze chooser are all triple-REVOKEd (no client reaches the instant-taking seam, and none reaches the chooser either)');

-- THE BACKSTOP'S FORM (F325 / D343).
select ok(
  exists (select 1 from pg_trigger t
          where t.tgrelid = 'public.matchups'::regclass
            and t.tgname = 'trg_matchups_override_guard'
            and t.tgtype & 2 = 2      -- BEFORE
            and t.tgtype & 16 = 16    -- UPDATE
            and t.tgtype & 1 = 1),    -- FOR EACH ROW
  'B13 trg_matchups_override_guard is a BEFORE UPDATE FOR EACH ROW trigger on matchups — §12.12''s backstop, landed (F325)');
select is(
  (select t.tgenabled::text from pg_trigger t
   where t.tgrelid = 'public.matchups'::regclass and t.tgname = 'trg_matchups_override_guard'),
  'A',
  'B14 …and it is ENABLE ALWAYS. A default tgenabled=''O'' trigger is skipped ENTIRELY under session_replication_role=''replica'' — the mode `supabase db push` itself runs in (R616, 123:381-382). ALWAYS or it is not a backstop');
select ok(
  (select pg_get_triggerdef(t.oid) like '%IS DISTINCT FROM%'
   from pg_trigger t
   where t.tgrelid = 'public.matchups'::regclass and t.tgname = 'trg_matchups_override_guard')
  and (select prosrc like '%IS DISTINCT FROM OLD.is_overridden%'
       from pg_proc where oid = 'public.matchups_override_guard_internal()'::regprocedure),
  'B15 D343''S CORRECTED PREDICATE, in the WHEN clause AND in the body: `NEW.is_overridden IS DISTINCT FROM OLD.is_overridden`, NOT §12.12''s printed `NEW.is_overridden AND guc = ''''`. The printed form refuses finalize_matchups'' status-only flip on an already-overridden row (§H5) and misses a TRUE→FALSE un-override entirely (§H3)');

-- THE D137 PIN on the one replaced function.
select ok(
  (select prosrc like '%app.commish_action_id%'
   from pg_proc where oid = 'public.rebuild_team_week_results(uuid,integer)'::regprocedure),
  'B16 D137: rebuild_team_week_results carries the NARROWED guard — one hunk against 117:779-782''s file text, and 117:722-728''s header promise ("called ... in-body by M6''s audited commissioner verbs") is true for the first time');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rebuild_team_week_results'),
  1, 'B17 …and it is still exactly ONE overload with 117''s (uuid, integer) signature — a replacement, never a sibling');
select ok(
  (select prosrc like '%result_drift%' and prosrc like '%matchup_not_final%'
      and prosrc like '%week_not_final%' and prosrc like '%already_consistent%'
   from pg_proc where oid = 'public.rebuild_team_week_results(uuid,integer)'::regprocedure),
  'B18 …and every one of 117''s named refusals survived the replacement verbatim (the "one hunk" claim, asserted rather than promised)');

-- ---------------------------------------------------------------------------
-- C. FIXTURES (postgres context, JWT cleared — before any claims).
--    L1: 4 franchises, h2h. u1 commissioner (T1) · u2 manager (T2) ·
--    u3 outsider · u4 member with no team.
--    Weeks, and what each one is FOR:
--      3  final             → §J, the in-body rebuild (D344 through the real path)
--      4  live              → §C/§E/§G/§I, the score arm, the freeze, the write door
--      5  correction_window → §H5, the pg_cron finalize case
--    The calendar is RELATIVE to now() with current week = 8, so weeks 3-5
--    are all in the past and week 5's correction window has closed.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('95000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-mo' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'mo_user' || i)::jsonb, now(), now()
from generate_series(1, 4) i;

update nfl_weeks w
set starts_at                 = now() + ((w.week - 8) * interval '7 days') - interval '1 day',
    last_game_ends_at         = case when w.week <= 7 then now() + ((w.week - 8) * interval '7 days') + interval '5 days' end,
    correction_window_ends_at = now() + ((w.week - 8) * interval '7 days') + interval '6 days'
where w.season = 2026;
delete from nfl_games where season = 2026;
-- Week 5's games are ALL FINAL: §23.2's precondition for finalize_matchups.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('mo-w5-a', 2026, 5, 'KC',  'BUF', now() - interval '22 days', 'final'),
 ('mo-w5-b', 2026, 5, 'DAL', 'PHI', now() - interval '21 days', 'final');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 ('b5000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'pgtap-mo-L1', 2026,
  'in_season', 8, 10, 0, 11,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "allow_illegal_lineups": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '95000000-0000-4000-8000-000000000001', 'MO T' || i, 'b5000000-0000-4000-8000-000000000001'
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role) values
 ('b5000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'commissioner'),
 ('b5000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000002', 'manager'),
 ('b5000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000004', null, 'manager');

insert into league_weeks (league_id, season, week)
select 'b5000000-0000-4000-8000-000000000001', 2026, g from generate_series(3, 10) g;
-- The F4 guard (§12.17) refuses a skipped step, so each week is WALKED to its
-- status rather than assigned one: upcoming → live → correction_window → final.
update league_weeks set status = 'live'              where league_id = 'b5000000-0000-4000-8000-000000000001' and week in (3, 4, 5);
update league_weeks set status = 'correction_window' where league_id = 'b5000000-0000-4000-8000-000000000001' and week in (3, 5);
update league_weeks set status = 'final'             where league_id = 'b5000000-0000-4000-8000-000000000001' and week = 3;

-- Week 3 (FINAL) — both rows final, scores present, results CONSISTENT with
-- them. `d5…31` is §J's subject; `d5…32` must stay drift-free or the rebuild
-- would refuse the week for a reason that has nothing to do with this verb.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id,
                      home_score, away_score, status, result) values
 ('d5000000-0000-4000-8000-000000000031', 'b5000000-0000-4000-8000-000000000001', 2026, 3, 'regular',
  'c5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', 110.50, 90.25, 'final', 'home'),
 ('d5000000-0000-4000-8000-000000000032', 'b5000000-0000-4000-8000-000000000001', 2026, 3, 'regular',
  'c5000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000004',  80.00, 95.00, 'final', 'away'),
 ('d5000000-0000-4000-8000-000000000033', 'b5000000-0000-4000-8000-000000000001', 2026, 3, 'regular',
  'c5000000-0000-4000-8000-000000000005', 'c5000000-0000-4000-8000-000000000006',  70.00, 70.00, 'final', 'tie'),
 ('d5000000-0000-4000-8000-000000000034', 'b5000000-0000-4000-8000-000000000001', 2026, 3, 'regular',
  'c5000000-0000-4000-8000-000000000007', 'c5000000-0000-4000-8000-000000000008', 100.00, 60.00, 'final', 'home'),
-- Week 4 (LIVE) — `d5...41` is the score arm's subject, the freeze's subject and
-- the write door's subject. `d5...42` is a BYE (away_team_id NULL).
 ('d5000000-0000-4000-8000-000000000041', 'b5000000-0000-4000-8000-000000000001', 2026, 4, 'regular',
  'c5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', 50.00, 40.00, 'live', null),
 ('d5000000-0000-4000-8000-000000000042', 'b5000000-0000-4000-8000-000000000001', 2026, 4, 'regular',
  'c5000000-0000-4000-8000-000000000003', null, 33.00, null, 'live', null),
-- Week 5 (CORRECTION_WINDOW) — `d5...51` becomes the ALREADY-OVERRIDDEN row
-- H8 needs; the other three stay ordinary so finalize has both shapes to walk.
 ('d5000000-0000-4000-8000-000000000051', 'b5000000-0000-4000-8000-000000000001', 2026, 5, 'regular',
  'c5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', 61.00, 72.00, 'live', null),
 ('d5000000-0000-4000-8000-000000000052', 'b5000000-0000-4000-8000-000000000001', 2026, 5, 'regular',
  'c5000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000004', 45.00, 44.00, 'live', null),
 ('d5000000-0000-4000-8000-000000000053', 'b5000000-0000-4000-8000-000000000001', 2026, 5, 'regular',
  'c5000000-0000-4000-8000-000000000005', 'c5000000-0000-4000-8000-000000000006', 88.00, 77.00, 'live', null),
 ('d5000000-0000-4000-8000-000000000054', 'b5000000-0000-4000-8000-000000000001', 2026, 5, 'regular',
  'c5000000-0000-4000-8000-000000000007', 'c5000000-0000-4000-8000-000000000008', 30.00, 31.00, 'live', null);

-- PREMISES, asserted rather than assumed (rule 14(c)).
select is(public.lineup_current_week_internal('b5000000-0000-4000-8000-000000000001', now()), 8,
  'C1 PREMISE: the current week is 8 by the nfl_weeks.starts_at boundary, so weeks 3-5 are all PAST — every `bypassed` array below should carry past_week');
select is((select count(*)::int from matchups where is_overridden), 0,
  'C2 PREMISE — THE FIRST WRITER: NOT ONE ROW in the whole matchups table carries is_overridden = TRUE before this suite runs. 109:168 declares it DEFAULT FALSE and migrations 109-125 write it NOWHERE (123:163-167 said so in advance and named this verb as the successor), so every flag assertion below is about THIS verb');
select is((select count(*)::int from matchups where override_action_id is not null), 0,
  'C3 …and override_action_id is likewise unwritten anywhere (109:169; its FK landed at 123:459-460 with zero writers)');

-- THE WRITE DOOR'S PREMISE (R972). The door must be shown able to write this
-- REAL row BEFORE the override, or §I's "it now skips it" proves nothing.
select is(
  (public.score_write_week_batch('b5000000-0000-4000-8000-000000000001', 4,
     '[{"team_id": "c5000000-0000-4000-8000-000000000001", "points": 55}]') ->> 'written')::int,
  1,
  'C4 WRITE-DOOR PREMISE: score_write_week_batch CAN write matchup d5…41 today — one writable row, one written. §I asserts the same call is refused after the override, and without this cell that refusal is indistinguishable from a door that never worked (R972)');
select is((select home_score from matchups where id = 'd5000000-0000-4000-8000-000000000041'), 55.00,
  'C5 …and the door''s number is in the row (55.00), which is the number §I will watch NOT move');

-- ---------------------------------------------------------------------------
-- D. THE REASON GATE AND THE ARM REFUSALS — every one BY NAME.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- D1/D2 RE-CUT BY MIGRATION 131 (L.E1.15 / F362, Q66): the reason is
-- OPTIONAL. The two refusals become SOURCE pins here (count-neutral for §E-§G's
-- premises, which watch d5…41); the BEHAVIOURAL landings are §Q at the end.
-- ***THE L.E1.15 BREAK PROBE'S TARGET*** for this verb: re-add 126:721-725's
-- gate and D1 reds by name.
select ok(
  (select p.prosrc not like '%: a reason is required — this verb writes an audited commissioner_actions row%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_matchup_override_internal'),
  'D1 Q66 (131): commish_matchup_override_internal no longer carries 126:723''s "a reason is required" refusal — the gate is a NORMALISATION now');
select ok(
  (select p.prosrc like '%CASE WHEN v_reason IS NOT NULL THEN '' — reason: '' || v_reason ELSE '''' END%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_matchup_override_internal'),
  'D2 Q66 (131): …and its chat post''s "— reason:" clause is CONDITIONAL in the source');
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       70, 40, repeat('x', 501), 'e5000000-0000-4000-8000-000000000003'::uuid) $$,
  '22023', null, 'D3 a 501-character reason is refused in-body, one unit past the 500 bound (the league_chat bound; 123:295-296''s CHECK)');
-- Deliberately aimed at week 5's `d5...53` and NOT at `d5...41`: this call is
-- ACCEPTED, and an accepted call writes a receipt and sets the flag, which
-- would contaminate §E's `before` document and §F5's zero-receipt premise.
select lives_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000053',
       88, 77, repeat('x', 500), 'e5000000-0000-4000-8000-000000000004'::uuid) $$,
  'D4 …and exactly 500 characters lives — one unit the other side');
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       70, 40, 'no action id', null) $$,
  '22023', null, 'D5 a missing action_id is refused — the idempotency key is not optional');

-- THE ARMS (D341/D342).
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       null, null, 'nothing to say', 'e5000000-0000-4000-8000-000000000005'::uuid) $$,
  '22023', null, 'D6 NEITHER ARM SUPPLIED is refused BY NAME through the score route — a submit that names no new value is a malformed call, not a no-op, and answering it with `no_changes: true` would be a success document for a request that never said what it wanted');
select throws_ok(
  $$ select commish_set_result('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       null, 'nothing to say', 'e5000000-0000-4000-8000-000000000006'::uuid) $$,
  '22023', null, 'D7 …and the same refusal through the result route');
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       70, null, 'half a correction', 'e5000000-0000-4000-8000-000000000007'::uuid) $$,
  '22023', null, 'D8 ONE SCORE ALONE is refused BY NAME (D342 / §22.2''s v2.16.39 erratum): is_overridden is one flag on the whole ROW, so half a correction would freeze the other team''s stale number in place');
select throws_ok(
  $$ select commish_set_result('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000042',
       'c5000000-0000-4000-8000-000000000003'::uuid, 'a bye has a winner?', 'e5000000-0000-4000-8000-000000000008'::uuid) $$,
  'P0001', null, 'D9 A BYE ROW REFUSES THE RESULT ARM BY NAME (D341) — matchup_result_internal returns NULL for a NULL away side (117:211) and every derive maps a bye before consulting `result` at all, so a result there writes a column nothing reads: a no-op wearing a success''s clothes');
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000042',
       40, 10, 'a bye has an away score?', 'e5000000-0000-4000-8000-000000000009'::uuid) $$,
  '22023', null, 'D10 …and a bye refuses a non-null p_away too — there is no away side to score');
select throws_ok(
  $$ select commish_set_result('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       'c5000000-0000-4000-8000-000000000003'::uuid, 'a third team won', 'e5000000-0000-4000-8000-00000000000a'::uuid) $$,
  'P0001', null, 'D11 a winner who is not a SIDE of the matchup is refused — and the message names the tie route, because a winner uuid cannot express a tie and the commissioner should not have to discover that (F351)');
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000bb'::uuid,
       70, 40, 'no such matchup', 'e5000000-0000-4000-8000-00000000000b'::uuid) $$,
  'P0001', null, 'D12 a matchup that is not this league''s is refused by name');

-- ---------------------------------------------------------------------------
-- F. AUTH — the override is commissioner-only, and every refusal is the SAME
--    no-leak 42501 (D336 part 5). (Lettered F to match 071''s families.)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       99, 1, 'I am this team''''s manager', 'e5000000-0000-4000-8000-00000000000c'::uuid) $$,
  '42501', 'commish_edit_score: not a commissioner of this league',
  'F1 THE EDITED TEAM''S OWN MANAGER is refused — a manager has no door onto his own score at all, let alone this one');
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_set_result('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       'c5000000-0000-4000-8000-000000000001'::uuid, 'outsider', 'e5000000-0000-4000-8000-00000000000d'::uuid) $$,
  '42501', 'commish_set_result: not a commissioner of this league',
  'F2 an OUTSIDER gets the same no-leak 42501 — "no such league" and "not a commissioner" are indistinguishable from outside');
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       99, 1, 'a member, not a commish', 'e5000000-0000-4000-8000-00000000000e'::uuid) $$,
  '42501', 'commish_edit_score: not a commissioner of this league', 'F3 a non-managing MEMBER gets the same 42501');
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
       99, 1, 'anon', 'e5000000-0000-4000-8000-00000000000f'::uuid) $$,
  '42501', null, 'F4 anon holds no EXECUTE on the verb at all');
reset role;
select is((select count(*)::int from commissioner_actions where target_id = 'd5000000-0000-4000-8000-000000000041'), 0,
  'F5 …and NOT ONE of D1-F4''s refusals against d5…41 wrote an audit row — a refused override leaves no receipt behind');
select is((select count(*)::int from commissioner_actions), 1,
  'F6 …and the ONLY audit row in the table is D4''s accepted call on d5…53: every other cell from D1 to F4 was refused before it could write one');
select is((select count(*)::int from commish_matchup_actions), 1,
  'F7 …while the ledger likewise holds exactly ONE row — an action_id is consumed by its SUBMIT, D5''s call never had one, and a refusal before the ledger write consumes nothing');

-- ---------------------------------------------------------------------------
-- E. THE SCORE ARM LANDS — the flag and the result written in ONE statement,
--    and the freeze REPORTED (Q61's recommendation, §4 rule 15).
--    (Lettered E after F only because §F''s refusals must run before any
--     successful write, so the audit-count premise in F5 is a clean zero.)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

create temp table _e as
select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
  77, 41, 'the provider double-counted a touchdown', 'e5000000-0000-4000-8000-000000000010'::uuid) as r;

select is((select r ->> 'no_changes' from _e), 'false',
  'E1 the score arm reports a real change');
select is((select r ->> 'is_overridden' from _e), 'true',
  'E2 …and is_overridden = true in the returned document — THE FIRST WRITE OF THIS COLUMN ANYWHERE (C2 asserted the premise)');
select is((select r ->> 'result' from _e), 'home',
  'E3 …and `result` was DERIVED with the score through matchup_result_internal (117:201) — F245''s whole point: a score correction that left `result` behind makes rebuild_team_week_results refuse the week for ever (117:836-839)');
select is((select r ->> 'arm' from _e), 'score', 'E4 …and the document names which arm drove it');

select row_eq(
  $$ select home_score, away_score, result, is_overridden from matchups
     where id = 'd5000000-0000-4000-8000-000000000041' $$,
  row(77.00::numeric, 41.00::numeric, 'home'::text, true)::record,
  'E5 ONE STATEMENT (D341): the two scores, the result that goes with them AND the flag all moved together on the row');
select is(
  (select m.override_action_id::text from matchups m where m.id = 'd5000000-0000-4000-8000-000000000041'),
  (select r ->> 'commissioner_action_id' from _e),
  'E6 …and override_action_id is the audit row''s own id — 123:459-460''s parked FK, written by its first writer');
select is(
  (select count(*)::int from commissioner_actions
   where action_type = 'edit_score' and target_type = 'matchup'
     and target_id = 'd5000000-0000-4000-8000-000000000041'),
  1, 'E7 EXACTLY ONE audit row, action_type edit_score, target_type matchup (both already in §12.12''s printed vocabulary — no new column, D336)');
select is(
  (select a.metadata -> 'affected_team_ids' from commissioner_actions a
   where a.id = (select (r ->> 'commissioner_action_id')::uuid from _e)),
  '["c5000000-0000-4000-8000-000000000001", "c5000000-0000-4000-8000-000000000002"]'::jsonb,
  'E8 D353: metadata.affected_team_ids names BOTH franchises — the activity feed filters by team, and deriving the pair from an untyped blob at read time is the shape that rots');
select is(
  (select array_agg(k order by k) from commissioner_actions a,
     lateral jsonb_object_keys(a.before) k where a.id = (select (r ->> 'commissioner_action_id')::uuid from _e)),
  (select array_agg(k order by k) from commissioner_actions a,
     lateral jsonb_object_keys(a.after) k where a.id = (select (r ->> 'commissioner_action_id')::uuid from _e)),
  'E9 `before` and `after` MIRROR each other key-for-key over the row that changed (D353) — four value dimensions; override_action_id lives in metadata because its "after" value IS this row''s own id');
select is(
  (select a.before from commissioner_actions a where a.id = (select (r ->> 'commissioner_action_id')::uuid from _e)),
  '{"result": null, "away_score": 40.00, "home_score": 55.00, "is_overridden": false}'::jsonb,
  'E10 …and `before` is the row AS IT WAS, including the write door''s own 55.00 from C4 — so the receipt says what the override displaced');

-- Q61's freeze, REPORTED rather than discovered (§4 rule 15).
select is((select r ->> 'live_scoring_frozen' from _e), 'true',
  'E11 Q61: the verb SET the flag on a LIVE week and SAYS SO — live_scoring_frozen = true. (The recommendation on file; the swap is one line in the migration, grep `Q61 SWAP LINE`)');
select alike((select r ->> 'live_scoring_frozen_why' from _e), 'frozen_by_this_override%',
  'E12 …and names the mechanism, not just the fact: score_write_week_batch will skip this matchup for the rest of the week (119:634/:654)');
select alike(
  (select message from league_chat
   where league_id = 'b5000000-0000-4000-8000-000000000001' and is_system order by created_at desc limit 1),
  '%live scoring has STOPPED for this matchup%',
  'E13 …and THE CHAT POST SAYS IT TOO (§10.3: override posts auto-post and cannot be disabled). A freeze the league learns about from a silent scoreboard is exactly the "nothing happened" shape rule 15 forbids');
select is((select r ->> 'standings_rebuilt' from _e), 'false',
  'E14 an OPEN week is NOT rebuilt in-body — there are no final derived rows yet');
select alike((select r ->> 'standings_not_rebuilt_why' from _e), 'week_live%',
  'E15 …and the document says WHY, naming finalization as what carries it (118:2098-2100) — never a silent false');
select is((select r -> 'bypassed' from _e), '["past_week"]'::jsonb,
  'E16 …and the receipt NAMES what the override walked past: week 4 is behind the league''s current week 8, and standing rule (g) means that is a receipt line and not a refusal — the commissioner''s timing rules do not bind him (§11.2:730)');

-- ---------------------------------------------------------------------------
-- G. CHRIS'S ONE CONDITION — "no receipt if nothing is done. only when
--    something is done." Asserted FOUR ways, and DETECTED, never inferred.
-- ---------------------------------------------------------------------------
-- The counts are captured TABLE-WIDE and compared against themselves, so the
-- cells below say "nothing moved anywhere" rather than "nothing moved in the
-- slice I chose to look at".
create temp table _g0 as
select (select updated_at from matchups where id = 'd5000000-0000-4000-8000-000000000041') as upd,
       (select count(*)::int from commissioner_actions) as audits,
       (select count(*)::int from league_chat
        where league_id = 'b5000000-0000-4000-8000-000000000001' and is_system) as posts;

select is(
  (select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
     77, 41, 'the identical numbers again', 'e5000000-0000-4000-8000-000000000011'::uuid) ->> 'no_changes'),
  'true',
  'G1 an IDENTICAL submit reports no_changes = true BY NAME — DETECTED by value across every dimension the verb can change (D336 part 3), never inferred from an empty write');
select is(
  (select count(*)::int from commissioner_actions), (select audits from _g0),
  'G2 CHRIS''S CONDITION: the no-op wrote NO audit row — the TABLE-WIDE commissioner_actions count is unchanged');
select is(
  (select count(*)::int from league_chat
   where league_id = 'b5000000-0000-4000-8000-000000000001' and is_system),
  (select posts from _g0), 'G3 …and NO system post');
select is(
  (select updated_at from matchups where id = 'd5000000-0000-4000-8000-000000000041'),
  (select upd from _g0),
  'G4 …and matchups.updated_at has NOT MOVED — the row was not written at all, which is the difference between "detected the no-op" and "wrote the same values back"');
select is(
  (select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
     77.00, 41.000, 'scale-blind', 'e5000000-0000-4000-8000-000000000012'::uuid) -> 'commissioner_action_id'),
  'null'::jsonb,
  'G5 …and 77.00 over a stored 77 is the SAME no-op (scale-blind numeric equality, the write door''s own comparison at 119:653-654): commissioner_action_id is null, so the caller reads the absence rather than guessing at it');

-- REPLAY: the same action_id with different values returns the stored result
-- byte-identically and writes nothing.
create temp table _replay as
select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000041',
  1, 2, 'a completely different correction', 'e5000000-0000-4000-8000-000000000010'::uuid)::text as got;
select is((select home_score from matchups where id = 'd5000000-0000-4000-8000-000000000041'), 77.00,
  'G6 the replay wrote nothing — the row still carries the original override');
reset role;
select is(
  (select got from _replay),
  (select result::text from commish_matchup_actions where action_id = 'e5000000-0000-4000-8000-000000000010'),
  'G7 REPLAY (E2/D68): the same action_id returns the stored result BYTE-identically, even with different values — placed after auth but BEFORE every business gate (123:602-609), so a retry replays even when the week has moved on');
select is((select count(*)::int from commissioner_actions), (select audits from _g0),
  'G8 …and no second receipt for a replayed action — the table-wide count has not moved since before G1');
select is((select count(*)::int from commish_matchup_actions), 4,
  'G9 the LEDGER row is written for a NO-OP TOO (123:1259-1266''s posture) — D4, the real edit, and the two no-ops; the replay added none. This is the OPPOSITE rule from the audit row, deliberately (§12.26: "an action_id is an idempotency key, not an audit record")');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'commish_matchup_actions'), 0,
  'G10 …in a table no client can read one row of');

-- ---------------------------------------------------------------------------
-- I. THE WRITE DOOR, AFTER THE OVERRIDE, ON THE SAME REAL ROW (R972).
--    C4/C5 established the door CAN write d5…41. Now it must not.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
create temp table _door as
select public.score_write_week_batch('b5000000-0000-4000-8000-000000000001', 4,
  '[{"team_id": "c5000000-0000-4000-8000-000000000001", "points": 99}]') as r;
select is((select (r ->> 'writable')::int from _door), 0,
  'I1 THE FREEZE, BEHAVIOURALLY: the write door now counts ZERO writable rows for this team-week — 119:632-634''s `AND m.status <> ''final'' AND NOT m.is_overridden` excludes the overridden row from the writable count');
select is((select r ->> 'reason' from _door), 'nothing_writable',
  'I2 …and says so by name rather than reporting a quiet success');
select is((select r -> 'skipped' -> 0 ->> 'reason' from _door), 'overridden',
  'I3 …and NAMES the protected row with reason `overridden` (119:626-628) — the door''s own loud-emptiness contract, now carrying this verb''s consequence');
select is((select home_score from matchups where id = 'd5000000-0000-4000-8000-000000000041'), 77.00,
  'I4 …and the commissioner''s 77.00 SURVIVED a drain that wanted to write 99 — which is the whole of Q61''s recommendation, proven on a real row rather than asserted in a comment');

-- ---------------------------------------------------------------------------
-- H. THE BACKSTOP (F325 / D343). **Every cell here clears the GUC and asserts
--    it is empty first** — `log_commissioner_action_internal` set it during
--    §E and `set_config(..., true)` lasts to the end of THIS transaction
--    (D49(7)), so without the clear every cell below would pass with the
--    trigger dropped.
-- ---------------------------------------------------------------------------
select set_config('app.commish_action_id', '', true);
select is(coalesce(current_setting('app.commish_action_id', true), ''), '',
  'H0 PREMISE: app.commish_action_id is cleared. §E armed it and it is transaction-local, so this assertion is what keeps every cell below from being vacuous (rule 14(c))');

select throws_ok(
  $$ update matchups set is_overridden = true where id = 'd5000000-0000-4000-8000-000000000052' $$,
  'P0001', null,
  'H1 F325 DISCHARGED: a DIRECT `UPDATE matchups SET is_overridden = TRUE` with no `app.commish_action_id` SET is REFUSED — executed AS THE OWNER, which is the role every SECURITY DEFINER writer runs as and the one RLS cannot restrain (123:339-410''s measurement, one table over). The guard checks the GUC and nothing else; it does NOT verify that an audit row exists, and R1010 corrected its message to say so');
select is((select is_overridden from matchups where id = 'd5000000-0000-4000-8000-000000000052'), false,
  'H2 …and the row is still FALSE: the trigger PREVENTED the write, it did not merely complain about it');

select throws_ok(
  $$ update matchups set is_overridden = false where id = 'd5000000-0000-4000-8000-000000000041' $$,
  'P0001', null,
  'H3 …and a TRUE→FALSE UN-OVERRIDE is refused too. §12.12''s printed `IF (NEW.is_overridden AND guc = '''')` misses this entirely — it only ever looks at NEW, so clearing the flag (releasing a frozen cell back to the scoring drain) would have been an unaudited act. D343''s predicate is WIDER here as well as narrower at H5');
select is((select is_overridden from matchups where id = 'd5000000-0000-4000-8000-000000000041'), true,
  'H4 …and the override stands');

-- H5 aims at `d5…42`, whose status ACTUALLY MOVES (`live` → `final`). It used
-- to aim at `d5…32`, which the fixture inserts as `'final'` already
-- (`:292-293`): the WHEN clause was correctly false either way, so the cell
-- proved what it claimed while exercising a zero-change UPDATE (R1011). Week 4
-- is `live` and is never finalized by this suite, so moving one of its
-- matchups to `final` here disturbs no later cell; §I has already run.
select is((select status from matchups where id = 'd5000000-0000-4000-8000-000000000042'), 'live',
  'H5a PREMISE: d5…42 is `live`, so the UPDATE below is a REAL status transition and not a no-op wearing a lives_ok''s clothes');
select lives_ok(
  $$ update matchups set status = 'final' where id = 'd5000000-0000-4000-8000-000000000042' $$,
  'H5 A REAL STATUS-ONLY TRANSITION (live → final) on a NON-overridden row passes untouched — the WHEN clause means the scoring door''s per-row UPDATEs never enter the trigger function at all (the hot-path cost 123 deferred this trigger for). H12 carries the same transition on an ALREADY-OVERRIDDEN row, which is the half §12.12''s printed predicate breaks');
select is((select status from matchups where id = 'd5000000-0000-4000-8000-000000000042'), 'final',
  'H5b …and the transition LANDED: the trigger let a real move through, it did not merely decline to complain about a write that changed nothing');

-- H6 — THE pg_cron CASE. This is the cell the printed predicate breaks, and
-- the fixture is the cell: d5…51 must ALREADY be overridden when finalize
-- runs, or the assertion passes against either predicate.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select commish_set_result('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000051',
     'c5000000-0000-4000-8000-000000000001'::uuid, 'the correction window found a scoring error',
     'e5000000-0000-4000-8000-000000000020'::uuid) ->> 'result'),
  'home',
  'H6 the RESULT arm lands on week 5''s d5…51 — the scores say away (61 v 72) and the commissioner says home, which is precisely what an override IS');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('app.commish_action_id', '', true);

select is(coalesce(current_setting('app.commish_action_id', true), ''), '',
  'H7 PREMISE: the GUC is cleared again — pg_cron sets none, and finalize_matchups must reach d5…51 without one');
select row_eq(
  $$ select is_overridden, status, result from matchups where id = 'd5000000-0000-4000-8000-000000000051' $$,
  row(true, 'live'::text, 'home'::text)::record,
  'H8 PREMISE: d5…51 is ALREADY OVERRIDDEN and still `live`. **Without this row the H9 cell is vacuous** — §12.12''s printed predicate only misfires on a row whose is_overridden is TRUE, so a fixture of ordinary rows passes against either form');
select is((select status from league_weeks where league_id = 'b5000000-0000-4000-8000-000000000001' and week = 5), 'correction_window',
  'H9 PREMISE: week 5 is in its correction window and its window has closed, so finalize_matchups is due');

create temp table _fin as select public.finalize_matchups(now(), 'b5000000-0000-4000-8000-000000000001') as r;
select is((select r -> 'failures' from _fin), '[]'::jsonb,
  'H10 THE pg_cron CASE, AND THE REASON D343 EXISTS: finalize_matchups ran with NO failures. Under §12.12''s printed predicate its overridden branch (118:2098-2100 — a status-only flip from a job that sets no GUC) RAISES, 118''s per-league subtransaction catches it into failures[] and rolls the whole league back, so this cell reds BY NAME');
select is((select (r ->> 'finalized')::int from _fin), 1,
  'H11 …and the week WAS finalized (the raise would have rolled the count back to 0 — F244''s locals)');
select row_eq(
  $$ select is_overridden, status, result from matchups where id = 'd5000000-0000-4000-8000-000000000051' $$,
  row(true, 'final'::text, 'home'::text)::record,
  'H12 …and the overridden row was flipped to `final` with its OVERRIDDEN result intact — 118''s branch never touches an overridden cell''s scores or result (§22.2), and the backstop let the status-only flip through because the FLAG did not move');
select is((select status from league_weeks where league_id = 'b5000000-0000-4000-8000-000000000001' and week = 5), 'final',
  'H13 …and the week closed. A commissioner override on a correction-window week is carried forward by finalization exactly as E15 promised the caller it would be');
select is(
  (select h2h_result from team_week_results
   where league_id = 'b5000000-0000-4000-8000-000000000001' and week = 5
     and team_id = 'c5000000-0000-4000-8000-000000000001'),
  'win',
  'H14 …into the DERIVED rows: T1 is credited the win the commissioner awarded, not the loss its 61-72 scoreline says. This is the end of the OPEN-week promise — the override reached the standings source without anybody calling a rebuild');

-- ---------------------------------------------------------------------------
-- J. PROPAGATION ON A FINAL WEEK — the in-body rebuild, which is the ONLY
--    thing D344's narrowing buys and the cell its break probe reds.
-- ---------------------------------------------------------------------------
select is((select status from league_weeks where league_id = 'b5000000-0000-4000-8000-000000000001' and week = 3), 'final',
  'J1 PREMISE: week 3 is FINAL, so its standings are derived rows — league_standings takes W/L/T from team_week_results (117:1065) and never reads matchups');
select set_config('app.commish_action_id', '', true);
select is(coalesce(current_setting('app.commish_action_id', true), ''), '',
  'J2 PREMISE: the GUC is cleared, so the in-body rebuild below has to be armed by THIS call''s own audit write and not by a leftover');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _j as
select commish_set_result('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000031',
  'c5000000-0000-4000-8000-000000000002'::uuid, 'the protest was upheld — the week 3 result is reversed',
  'e5000000-0000-4000-8000-000000000030'::uuid) as r;

select is((select r ->> 'standings_rebuilt' from _j), 'true',
  'J3 **D344, THROUGH THE REAL PATH**: a FINAL week rebuilds IN-BODY and the document SAYS it propagated. This is the cell the narrowing exists for — under 117''s original `IF auth.uid() IS NOT NULL THEN RAISE` the commissioner''s own JWT refuses his own verb, and 117:722-728''s header promise was false');
select is((select r -> 'standings_rebuild' ->> 'changed' from _j), 'true',
  'J4 …and the rebuild actually moved rows (`changed`), not merely ran — an `already_consistent` here would mean the override never reached the derived table');
select is((select r ->> 'live_scoring_frozen' from _j), 'false',
  'J5 …and live_scoring_frozen is FALSE on a final week — with `week_final` named as the reason, because rule 15''s point is that a false is as much a claim as a true');
select is(
  (select h2h_result from team_week_results
   where league_id = 'b5000000-0000-4000-8000-000000000001' and week = 3
     and team_id = 'c5000000-0000-4000-8000-000000000002'),
  'win',
  'J6 THE OVERRIDE IS IN THE STANDINGS: T2 now carries the WIN, over a 90.25-110.50 scoreline that says it lost. An is_overridden row''s stored result lands in h2h_result exactly (§12.18/§22.2), and without J3''s in-body call this cell would still read `loss` while the matchup page showed the reversal');
select is(
  (select h2h_result from team_week_results
   where league_id = 'b5000000-0000-4000-8000-000000000001' and week = 3
     and team_id = 'c5000000-0000-4000-8000-000000000001'),
  'loss',
  'J7 …and T1 the loss: the pair moved together, because is_overridden is ROW-scoped (D342)');
select is((select r ->> 'result' from _j), 'away',
  'J8 THE FLAG AND THE RESULT WENT IN ONE STATEMENT (D341/F245), and the proof is that J3 LIVED: the in-body rebuild computes result_drift over NON-overridden rows (117:829-835) and refuses the whole week permanently when one disagrees with its own scores. Drop `is_overridden` from the write and this row becomes non-overridden with result `away` over scores that say `home` — result_drift, and J3 reds');
select is(
  (select count(*)::int from commissioner_actions where action_type = 'set_result'),
  2, 'J9 two result overrides, two receipts (H6''s and J3''s) — and still exactly one for the score arm');

-- ---------------------------------------------------------------------------
-- K. NEVER-WEAKEN PINS (§4 rule 13). This verb RIDES two surfaces it must
--    never edit; a PR that "simplified" either would silently un-freeze every
--    override, and nothing that exists today would red.
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select (length(prosrc) - length(replace(prosrc, 'NOT m.is_overridden', ''))) / length('NOT m.is_overridden')
   from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  2, 'K1 score_write_week_batch still carries BOTH `NOT m.is_overridden` exclusions — the writable count (119:634) AND the one UPDATE (119:654). Relaxing either would let the next drain overwrite the commissioner within a minute, which is exactly what Q61 chose against');
select ok(
  (select prosrc like '%IF v_m.is_overridden THEN%'
      and prosrc like '%result = COALESCE(v_m.result, v_res)%'
   from pg_proc where oid = 'public.finalize_matchups(timestamptz,uuid)'::regprocedure),
  'K2 finalize_matchups still carries its overridden branch verbatim (118:2095-2100) — the branch H10-H14 depend on, and the one §12.12''s printed predicate would have made unreachable');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('score_write_week_batch', 'finalize_matchups')),
  2, 'K3 …and both are still ONE overload each — neither gained a commissioner-exempt sibling (the 071:835-867 shape, applied to this verb''s two neighbours)');

-- ---------------------------------------------------------------------------
-- L. THE FREEZE CHOOSER — **BOTH OF Q61'S RULINGS, PROVEN (R1007).**
--    Q61 is open and is Chris's. The shipped swap line is `v_set_over := TRUE`,
--    so §E and §J only ever walk the TRUE arms — which is exactly why a lie on
--    the FALSE branch survived to review: under the documented one-line swap,
--    on a LIVE week with a LIVE matchup, the old inline CASE fell through every
--    WHEN to an ELSE reading `week_final — live scoring for this week is over`
--    **while the week was live**, and the chat post said NOTHING about the
--    drain about to overwrite the commissioner's number (§4 rule 15's
--    discovered consequence, on the one branch no cell walked).
--    `commish_override_freeze_internal` is PURE and takes the decision as an
--    ARGUMENT, so the cells below reach the other ruling WITHOUT editing the
--    swap line — the `lineup_autopilot_internal` pure-chooser shape (125/D356).
-- ---------------------------------------------------------------------------
reset role;
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.commish_override_freeze_internal(boolean,boolean,boolean,boolean)'::regprocedure)
  and (select provolatile = 'i' from pg_proc
       where oid = 'public.commish_override_freeze_internal(boolean,boolean,boolean,boolean)'::regprocedure),
  'L1 the chooser is PLAIN (not DEFINER) and IMMUTABLE — it reads no table, no GUC and no clock, which is what makes every state below reachable from a test instead of only from a fixture that cannot exist');

-- The SHIPPED ruling, re-derived — and it agrees with what E11/E12 actually
-- got out of the verb, so this section is about the same code the verb runs.
select is(
  public.commish_override_freeze_internal(true, false, false, false) ->> 'why',
  (select r ->> 'live_scoring_frozen_why' from _e),
  'L2 WIRE-UP: the chooser''s answer for (flag set, live week, live matchup, not previously overridden) is BYTE-IDENTICAL to the `live_scoring_frozen_why` the real verb returned in E12 — so §L is exercising the verb''s own copy, not a parallel table of strings');

-- ── THE OTHER RULING (`v_set_over := v_week_final;`) ON A LIVE WEEK ──────────
select is(
  (public.commish_override_freeze_internal(false, false, false, false) ->> 'frozen')::boolean,
  false,
  'L3 Q61''s OTHER RULING, live week, live matchup: the flag is NOT set, so nothing is frozen — correct, and the only part the old inline CASE got right');
select alike(
  public.commish_override_freeze_internal(false, false, false, false) ->> 'why',
  'not_frozen%',
  'L4 **THE R1007 CELL**: …and the reason is `not_frozen`, NOT `week_final`. The old ELSE arm silently assumed "not frozen AND the matchup is not final ⇒ the week is final", which holds only while the swap line is the literal TRUE — flip it and the verb told the league the week was over while it was live');
select alike(
  public.commish_override_freeze_internal(false, false, false, false) ->> 'why',
  '%overwrite this number on its next drain%',
  'L5 …and it NAMES THE CONSEQUENCE (§4 rule 15): score_write_week_batch will overwrite the commissioner''s number on its next drain (119:654). A commissioner who is told "week_final" has been told the opposite of what is about to happen to his edit');
select alike(
  public.commish_override_freeze_internal(false, false, false, false) ->> 'chat_clause',
  '%the next scoring drain will overwrite this number%',
  'L6 …and THE LEAGUE IS TOLD TOO. The chat post''s clause was a bare `CASE WHEN v_frozen … ELSE '''' END`, so under the other ruling §10.3''s undisableable post would have said nothing at all about the overwrite — the half of R1007 the league, not the commissioner, would have paid for');

-- ── THE ARMS THAT MUST **NOT** PROMISE AN OVERWRITE ─────────────────────────
select is(
  public.commish_override_freeze_internal(false, false, true, false) ->> 'why',
  'matchup_already_final — the write door skips a final row regardless of the flag (119:634)',
  'L7 flag NOT set but the MATCHUP is already final: still `matchup_already_final`, because the write door skips a final row whatever the flag says (119:634) — promising an overwrite here would be the mirror-image lie');
select is(
  public.commish_override_freeze_internal(false, false, true, false) ->> 'chat_clause',
  '',
  'L8 …and the chat post stays SILENT on that row, because there is no consequence to name');
select alike(
  public.commish_override_freeze_internal(false, true, false, false) ->> 'why',
  'week_final%',
  'L9 flag NOT set on a FINAL week: `week_final` — the old ELSE''s text, now reached only when it is actually TRUE');
select alike(
  public.commish_override_freeze_internal(true, false, false, true) ->> 'why',
  'already_frozen%',
  'L10 …and the already-overridden arm still wins over the generic freeze arm, in the order the migration prints it');

select ok(
  (select prosrc like '%commish_override_freeze_internal%'
   from pg_proc where oid = 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)'::regprocedure)
  and (select prosrc not like '%frozen_by_this_override%'
          and prosrc not like '%refuses a final week outright%'
       from pg_proc where oid = 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)'::regprocedure),
  'L11 …and the verb DELEGATES: it calls the chooser and carries NO second copy of the freeze strings in its own body. Without this cell someone could re-inline the CASE, leave §L green against a function nothing calls, and reintroduce R1007 whole');

-- ---------------------------------------------------------------------------
-- Q. THE REASON IS OPTIONAL — Q66 (spec v2.16.41 §10.3 / §15.4), landed for
--    126's two doors by migration 131 (L.E1.15 / F362). The sweep's proof
--    shape, on d5…54 (week 5, 30.00–31.00 in the fixture, watched by no
--    earlier cell). Runs LAST so no earlier count premise moves.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000054',
       35, 36, null, 'e5000000-0000-4000-8000-000000000090'::uuid) $$,
  'Q1 a NO-reason score correction LANDS through the score door (Q66). Re-adding 126:721-725''s refusal reds here');
select lives_ok(
  $$ select commish_set_result('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000054',
       'c5000000-0000-4000-8000-000000000007'::uuid, E' \t\r\n ', 'e5000000-0000-4000-8000-000000000091'::uuid) $$,
  'Q2 a reason of SPACE+TAB+CR+NEWLINE is treated as NO reason and LANDS through the result door (the explicit class still decides "blank", R745)');
select lives_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000054',
       37, 38, E'\t stat correction \n', 'e5000000-0000-4000-8000-000000000092'::uuid) $$,
  'Q3 a real reason wrapped in tabs and newlines lands…');
select throws_ok(
  $$ select commish_edit_score('b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000054',
       39, 40, repeat('x', 501), 'e5000000-0000-4000-8000-000000000093'::uuid) $$,
  '22023', null, 'Q4 a 501-character reason is STILL refused in-body (the bound survives Q66; only the presence gate went)');
reset role;
select is(
  (select string_agg(action_type || '=' || coalesce(reason, '<NULL>'), ' ' order by metadata ->> 'action_id')
   from commissioner_actions where target_id = 'd5000000-0000-4000-8000-000000000054'),
  'edit_score=<NULL> set_result=<NULL> edit_score=stat correction',
  'Q5 THE RECEIPTS on d5…54: no reason ⇒ NULL, whitespace-only ⇒ NULL (not ''''), tab-wrapped ⇒ stored TRIMMED; the 501 refusal wrote none — one receipt per landing, through both doors');
select is(
  (select count(*)::int from league_chat where league_id = 'b5000000-0000-4000-8000-000000000001' and is_system
     and message like 'Week 5 — % vs %: % by mo_user1 (commissioner override)%' and message not like '% — reason: %'),
  2, 'Q6 …and EXACTLY the two no-reason landings posted with the override marker and NO "— reason:" clause (every earlier post in this file carried one)');
select is(
  (select count(*)::int from league_chat where league_id = 'b5000000-0000-4000-8000-000000000001' and is_system
     and message like 'Week 5 — % vs %: score set to 37–38 by mo_user1 (commissioner override)% — reason: stat correction'),
  1, 'Q7 …while the reasoned landing''s post carries the TRIMMED reason after the freeze clause');
select is((select home_score || '|' || away_score || '|' || result from matchups where id = 'd5000000-0000-4000-8000-000000000054'),
  '37|38|away', 'Q8 …and the row holds Q3''s numbers (the derived result re-read): the three landings wrote, the refusal did not');

select * from finish();
rollback;
