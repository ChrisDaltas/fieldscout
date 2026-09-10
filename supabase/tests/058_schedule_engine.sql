-- ============================================================================
-- The schedule engine + league_weeks population + completion wiring —
-- migration 110 (task L.D1.2; spec v2.16.12 §7.3.1 / §7.3.8 / §11.4 / §11.7
-- Generation + Mid-season entry / §12.8 / §12.17 / §12.20; tasks-M4 §4
-- standing rules 9–11; D288 / D289 / D291 / D305; PROGRESS Q29 / Q30 (d) /
-- Q31 (b); ledger F4, F130, F143, F213, F214 (R703/R704), F215; D306).
--
-- Numbering: pgTAP head measured 057 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 058, the tasks-M4 §7 reservation confirmed, not inherited
-- (D161/D166).
--
-- AMENDED IN PLACE 2026-09-07 (L.D1.9 / migration 119 — tests are tests,
-- the D137 note): the forward-looking "league_weeks still carries NO
-- broadcast trigger — D296 lands it" pin FLIPS — 119 landed
-- `tr_broadcast_league_weeks` (row, UPDATE OF status) with its first
-- subscriber (L.D4.1 / L.D5.3); the cell now asserts the trigger is present
-- (its shape is pgTAP 067's). Shown RED against 119 before the edit: exactly
-- 1 of 177 (cell 27).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * EVERY GOLDEN IS A STORED LITERAL AT A BOUNDARY INSTANT. The mid-season
--     goldens run the REAL writer (`league_generate_schedule`) at injected
--     `p_now` instants against 039's real 2026 seed (D291's front door —
--     never a column hack): week 10 → 6 + 3; week 12 → 4 + 3 (the floor
--     exactly); week 13 → 4 + 2 (`playoff_teams` 6 → 4 — the floor−1 vs
--     floor cell: rsw 3 WOULD fit and the chain refuses to go below 4);
--     week 14 → 4 + 1 (→ 2); week 15 → 4 + 0 (→ 0); week 16 → REFUSED by
--     name. The entry instant has one-unit twins: 2026-12-15 23:59:59 ET
--     enters week 15 and fits, 2026-12-16 00:00:00 ET enters week 16 and
--     refuses. Every non-default `playoff_teams` drop step is pinned on a
--     league that can hold it (12 → 8 → 4 on the 12-team league; 8 → 4 → 2
--     on the 8-team). The fit chain is ALSO pinned pure, at every first
--     week 1..18, as an 18-row literal table.
--   * THE DATUM'S THREE ARMS ARE PINNED SEPARATELY on a synthetic season
--     (2077) seeded in this txn: week 1 carries first_kickoff_at (arm 1),
--     week 2 carries NULL + nfl_games rows (arm 2), week 3 carries NULL and
--     no games (arm 3 — starts_at). Each arm has a −1s / +0s twin, and each
--     arm's instant sits AFTER that week's starts_at, so a COALESCE that
--     lost the arm would map one week later and red the cell by name.
--   * THE INVARIANT MATRIX IS EXHAUSTIVE over the closed v1 set (D289): every
--     size 8/10/12/14/16 × rsw {4, 12, 15} × second_opponent {off, on} —
--     30 builds, ~4,000 rows — through the pure builder, plus the same
--     invariants on the WRITTEN rows of the writer. R703's CROSS-side case
--     is the pin's shape: a team's appearances per (week, round_type) are
--     counted over home AND away together, so home-in-A + away-in-B in one
--     week reds. Repeat gap and spread are MEASURED (min gap per size is a
--     stored literal n−1; spread ≤ 1), never assumed from the construction.
--   * DETERMINISM three ways: the pure builder twice (byte-equal text), the
--     writer twice under savepoints (byte-equal), and a STORED seed
--     reproduced by the pure builder over the league's own team ids (the
--     one-implementation pin: the writer's rows ≡ the builder's rows).
--     Input-order independence (a shuffled id array ⇒ identical output) and
--     seed sensitivity (seed+1 ⇒ different output) are both pinned.
--   * DIVISIONS ARE IGNORED (Q30 (d)/F221): the same league with
--     `divisions` 1 and then 2 generates byte-identical rows; the engine's
--     prosrc contains no read of the key.
--   * COMPLETION IS ONE TXN: `draft_complete_internal(draft, p_now)` lands
--     rosters + status + league_weeks + matchups + the written-back plan
--     together; the boundary-crossed refusal (Q31 rider (1)) leaves the
--     league at `drafting` with ZERO rows in every table; the one-unit
--     positive one second earlier completes at 4 + 0. The last pick is also
--     driven through the REAL `draft_make_pick` on a calendar the fixture
--     pins far-future (the F215 shape) — the wall clock never decides.
--   * `draft_start_internal`'s PRE-FLIGHT refuses by name at the week-16
--     instant and starts one second earlier (same twins); a season with no
--     calendar refuses by name.
--   * F4: every legal step succeeds with RETURNING count 1; every illegal
--     jump refuses by name; the audited reopen needs a NEW action id (the
--     same id twice refuses; NULL refuses); same-status and non-status
--     UPDATEs pass.
--   * F143: the detach refuses at `drafting`; the one-step-away positive
--     detaches at `scheduled`. F130: slot-without-team 22023; slot+team
--     lands the team at the slot. F213: a matchup / result on a week with
--     no league_weeks row 23503s (this closes R704's week-range hole
--     transitively); a league DELETE cascades all three tables.
--   * §M (the SQL range checks, measured): a stored rsw-4 / psw-5 row LIVES
--     (no table CHECK), and a settings PATCH on that league refuses by the
--     STATUS gate — the 105 range check is unreachable for an engine-written
--     row, which is why 110 leaves it unchanged.
--   * All privileged-context work (fixtures, boundaries, engine calls) runs
--     BEFORE any JWT claims are set — set_config(..., true) persists to txn
--     end (D49(7)); the RLS cells set claims last.
--   * The DoD break probe (PR body): the derangement offset is skewed to
--     allow offset 0 (the secondary round = the primary round) → the E40
--     cells here and in the sweep red by name; reverted.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(177);

-- ---------------------------------------------------------------------------
-- A. Form pins — the seven engine functions, the two DROP+CREATEs, the two
--    one-hunk replacements, F213's FKs, F4's trigger (D137; §4.1 grants)
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('schedule_lcg_next', 'schedule_playoff_rounds', 'schedule_playoff_drop',
                       'schedule_fit_internal', 'schedule_first_week_internal',
                       'schedule_build_internal', 'league_generate_schedule')),
  7,
  'the seven engine functions exist (lcg / rounds / drop / fit / first_week / build / generate)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('schedule_lcg_next', 'schedule_playoff_rounds', 'schedule_playoff_drop',
                       'schedule_fit_internal', 'schedule_first_week_internal',
                       'schedule_build_internal', 'league_generate_schedule')),
  'all seven are PLAIN (non-SECURITY-DEFINER) with search_path='''' — callable only from the DEFINER completion RPCs');
select ok(
  not has_function_privilege('anon', 'public.league_generate_schedule(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.league_generate_schedule(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_build_internal(uuid[],bigint,integer,integer,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_build_internal(uuid[],bigint,integer,integer,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_fit_internal(integer,integer,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_fit_internal(integer,integer,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_first_week_internal(integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_first_week_internal(integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_lcg_next(bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_lcg_next(bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_playoff_rounds(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_playoff_rounds(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_playoff_drop(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_playoff_drop(integer)', 'EXECUTE'),
  'every engine function is REVOKEd from anon AND authenticated (no client caller exists or will)');
select ok(
  (select bool_and(p.provolatile = 'i')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('schedule_lcg_next', 'schedule_playoff_rounds', 'schedule_playoff_drop',
                       'schedule_fit_internal', 'schedule_build_internal')),
  'the pure core (lcg / rounds / drop / fit / build) is IMMUTABLE — no table, no clock, no random()');
select ok(
  (select p.provolatile = 's'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_first_week_internal'),
  'schedule_first_week_internal is STABLE (reads nfl_weeks/nfl_games at the injected instant)');

-- The DROP+CREATEs: the new signatures exist, the old ones are gone.
select has_function('public', 'draft_complete_internal', array['uuid', 'timestamp with time zone'],
  'draft_complete_internal(uuid, timestamptz) — 086''s writer + p_now (D291/F215)');
select hasnt_function('public', 'draft_complete_internal', array['uuid'],
  '…and the 1-argument signature is GONE (DROP + CREATE — no ambiguous overload, the 102/D201(2) shape)');
select ok(
  not has_function_privilege('anon', 'public.draft_complete_internal(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_complete_internal(uuid,timestamptz)', 'EXECUTE'),
  'draft_complete_internal(uuid, timestamptz) is triple-REVOKEd (re-asserted after the DROP)');
select has_function('public', 'draft_start_internal', array['uuid', 'boolean', 'timestamp with time zone'],
  'draft_start_internal(uuid, boolean, timestamptz) — 098''s body + p_now for the pre-flight');
select hasnt_function('public', 'draft_start_internal', array['uuid', 'boolean'],
  '…and the 2-argument signature is GONE');
select ok(
  not has_function_privilege('anon', 'public.draft_start_internal(uuid,boolean,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_start_internal(uuid,boolean,timestamptz)', 'EXECUTE'),
  'draft_start_internal(uuid, boolean, timestamptz) is triple-REVOKEd (re-asserted after the DROP)');
select has_function('public', 'draft_start', array['uuid'],
  'the client-facing draft_start(uuid) wrapper is UNTOUCHED — clients never inject time');
select ok(
  (select p.prosrc like '%public.draft_start_internal(p_league_id, TRUE)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_start'),
  '…and it still calls the internal with two arguments (p_now binds to its now() default)');

-- One implementation, wired where the spec says (C60/D289; §11.4).
select ok(
  (select p.prosrc like '%public.league_generate_schedule(v_draft.league_id, p_now)%'
     and p.prosrc like '%IF NOT v_draft.is_mock THEN%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_complete_internal'),
  'draft_complete_internal PERFORMs league_generate_schedule(league, p_now) inside the NON-mock arm (C60; §8.8 mocks never generate)');
select ok(
  (select p.prosrc like '%public.schedule_build_internal(%'
     and p.prosrc like '%public.schedule_fit_internal(%'
     and p.prosrc like '%public.schedule_first_week_internal(%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_generate_schedule'),
  'league_generate_schedule composes the pure core (build + fit + first_week) — ONE implementation, no second generator');
select ok(
  (select p.prosrc like '%public.schedule_fit_internal(%'
     and p.prosrc like '%public.schedule_first_week_internal(%'
     and p.prosrc not like '%schedule_build_internal%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_start_internal'),
  'draft_start_internal pre-flights with the SAME fit + datum functions and never builds a schedule (rider (1): start refuses, completion writes)');
select ok(
  (select p.prosrc not like '%>> ''divisions''%' and p.prosrc not like '%-> ''divisions''%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_generate_schedule')
  and (select p.prosrc not like '%division%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'schedule_build_internal'),
  'Q30 (d): the engine never READS settings.divisions (no ->>/-> access in the writer; the word is absent from the builder)');
select ok(
  (select p.prosrc not like '%setseed%' and p.prosrc not like '%random()%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_build_internal'),
  'D289: the builder uses the explicit LCG — never setseed()/random()');

-- The two one-hunk replacements carry their hunks.
select ok(
  (select p.prosrc like '%NEW.scoring_system_id IS NULL%'
     and p.prosrc like '%NEW.scoring_rules_snapshot IS NULL%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'leagues_snapshot_guard'),
  'F143: leagues_snapshot_guard carries BOTH arms — 059''s snapshot arm and 110''s scoring_system_id detach arm');
select is(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where tgrelid = 'public.leagues'::regclass and tgname = 'trg_leagues_snapshot_guard'),
  'CREATE TRIGGER trg_leagues_snapshot_guard BEFORE INSERT OR UPDATE ON public.leagues FOR EACH ROW EXECUTE FUNCTION leagues_snapshot_guard()',
  '…on the UNCHANGED 059 trigger (BEFORE INSERT OR UPDATE, every column — not recreated)');
select ok(
  (select p.prosrc like '%without a team to pin%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_resolve_order_internal'),
  'F130: draft_resolve_order_internal carries the slot-without-team RAISE at the pin branch head');

-- F213: the composite week FKs, by column set and target.
select ok(
  exists (select 1 from pg_constraint c
          where c.conrelid = 'public.matchups'::regclass and c.contype = 'f'
            and c.confrelid = 'public.league_weeks'::regclass
            and (select array_agg(a.attname::text order by k.ord)
                 from unnest(c.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                = array['league_id', 'season', 'week']),
  'F213: matchups(league_id, season, week) → league_weeks — the composite FK exists');
select ok(
  exists (select 1 from pg_constraint c
          where c.conrelid = 'public.team_week_results'::regclass and c.contype = 'f'
            and c.confrelid = 'public.league_weeks'::regclass
            and (select array_agg(a.attname::text order by k.ord)
                 from unnest(c.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                = array['league_id', 'season', 'week']),
  'F213: team_week_results(league_id, season, week) → league_weeks — the composite FK exists');

-- F4: the transition guard.
select has_trigger('public', 'league_weeks', 'trg_league_weeks_transition',
  'F4: league_weeks carries its transition guard trigger');
select is(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where tgrelid = 'public.league_weeks'::regclass and tgname = 'trg_league_weeks_transition'),
  'CREATE TRIGGER trg_league_weeks_transition BEFORE UPDATE OF status ON public.league_weeks FOR EACH ROW EXECUTE FUNCTION league_weeks_transition_guard()',
  '…BEFORE UPDATE OF status, every row');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_weeks_transition_guard')
  and not has_function_privilege('anon', 'public.league_weeks_transition_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.league_weeks_transition_guard()', 'EXECUTE'),
  'league_weeks_transition_guard is a plain trigger fn with search_path='''' (D49(3)) and is REVOKEd');
select is(
  (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.league_weeks'::regclass and p.proname like 'broadcast%'),
  1::bigint,
  'league_weeks carries EXACTLY ONE broadcast trigger since 119 (L.D1.9 / D296 — tr_broadcast_league_weeks, UPDATE OF status; the transition guard above is not a broadcast; 067 pins its shape)');

-- ---------------------------------------------------------------------------
-- B. The pure core — stored-literal goldens
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select v, public.schedule_playoff_rounds(v) from unnest(array[0, 2, 4, 6, 8, 10, 12]) v $$,
  $$ values (0, 0), (2, 1), (4, 2), (6, 3), (8, 3), (10, 4), (12, 4) $$,
  'schedule_playoff_rounds = ⌈log2⌉ over the catalog: 0→0, 2→1, 4→2, 6→3, 8→3, 10→4, 12→4 (= derivePlayoffRounds)');
select results_eq(
  $$ select v, public.schedule_playoff_drop(v) from unnest(array[2, 4, 6, 8, 10, 12]) v $$,
  $$ values (2, 0), (4, 2), (6, 4), (8, 4), (10, 8), (12, 8) $$,
  'schedule_playoff_drop (D305(5)): one round fewer, largest catalog value — 12→8, 10→8, 8→4, 6→4, 4→2, 2→0');
select is(public.schedule_playoff_drop(0), null,
  'schedule_playoff_drop(0) is NULL — nothing left to drop (the chain refuses before asking)');
select is(public.schedule_lcg_next(1), 48271::bigint,
  'schedule_lcg_next(1) = 48271 — Park–Miller minimal standard, first state');
select is(public.schedule_lcg_next(48271), 182605794::bigint,
  'schedule_lcg_next(48271) = 182605794 — the published second value (48271² mod 2^31−1)');
select is(public.schedule_lcg_next(2147483646), 2147435376::bigint,
  'schedule_lcg_next at the top of the state range stays in range (2^31−2 → 2147435376)');
-- R727: the seed fold. Seeds 0 and 1 share a state (the one unavoidable
-- collision of a 2^31-seed space onto 2^31−2 states, said out loud); every
-- other pair of catalog seeds is distinct — pinned at the top of the space.
select is(
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal((select array_agg(('d0000000-0000-4000-8000-0008' || lpad(i::text, 8, '0'))::uuid) from generate_series(1, 8) i), 0, 1, 14, false) b),
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal((select array_agg(('d0000000-0000-4000-8000-0008' || lpad(i::text, 8, '0'))::uuid) from generate_series(1, 8) i), 1, 1, 14, false) b),
  'seed 0 ≡ seed 1 (the 0 → 1 map — the one stated collision)');
select isnt(
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal((select array_agg(('d0000000-0000-4000-8000-0008' || lpad(i::text, 8, '0'))::uuid) from generate_series(1, 8) i), 0, 1, 14, false) b),
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal((select array_agg(('d0000000-0000-4000-8000-0008' || lpad(i::text, 8, '0'))::uuid) from generate_series(1, 8) i), 2147483646, 1, 14, false) b),
  'seed 0 ≠ seed 2147483646 (the fold is mod 2^31−1, not 2^31−2 — R727)');

-- The fit chain at EVERY first week, defaults (14 + 6 teams, 1-week rounds):
-- the ruling's worked examples as an 18-row literal (spec §11.7 Mid-season entry).
select results_eq(
  $$ select w, f.regular_season_weeks, f.playoff_teams, f.playoff_rounds, f.last_week, f.fits, f.shrunk
     from generate_series(1, 18) w, lateral public.schedule_fit_internal(w, 14, 6, 1) f order by w $$,
  $$ values
     (1, 14, 6, 3, 17, true, false), (2, 14, 6, 3, 18, true, false),
     (3, 13, 6, 3, 18, true, true),  (4, 12, 6, 3, 18, true, true),
     (5, 11, 6, 3, 18, true, true),  (6, 10, 6, 3, 18, true, true),
     (7, 9, 6, 3, 18, true, true),   (8, 8, 6, 3, 18, true, true),
     (9, 7, 6, 3, 18, true, true),   (10, 6, 6, 3, 18, true, true),
     (11, 5, 6, 3, 18, true, true),  (12, 4, 6, 3, 18, true, true),
     (13, 4, 4, 2, 18, true, true),  (14, 4, 2, 1, 18, true, true),
     (15, 4, 0, 0, 18, true, true),  (16, 4, 0, 0, 19, false, true),
     (17, 4, 0, 0, 20, false, true), (18, 4, 0, 0, 21, false, true) $$,
  'THE SHRINK CHAIN at every first week 1..18 (defaults): rsw shrinks 14→4 through week 12, then 6→4→2→0 at 13/14/15, week 16+ refuses — the ruling''s worked examples as a stored literal');
select results_eq(
  $$ select f.regular_season_weeks, f.playoff_teams from public.schedule_fit_internal(13, 14, 6, 1) f $$,
  $$ values (4, 4) $$,
  'floor−1 vs floor: at week 13 an rsw of 3 WOULD fit 6 teams (13 + 3 + 3 − 1 = 18) — the chain keeps rsw 4 and drops a round instead');
select results_eq(
  $$ select f.regular_season_weeks, f.playoff_teams, f.last_week from public.schedule_fit_internal(13, 14, 12, 1) f $$,
  $$ values (4, 4, 18) $$,
  'non-default 12 playoff teams at week 13: 12 → 8 → 4 (two drops, D305(5))');
select results_eq(
  $$ select f.regular_season_weeks, f.playoff_teams, f.last_week from public.schedule_fit_internal(13, 14, 10, 1) f $$,
  $$ values (4, 4, 18) $$,
  'non-default 10 at week 13: 10 → 8 → 4');
select results_eq(
  $$ select f.regular_season_weeks, f.playoff_teams, f.last_week from public.schedule_fit_internal(14, 14, 8, 1) f $$,
  $$ values (4, 2, 18) $$,
  'non-default 8 at week 14: 8 → 4 → 2');
select results_eq(
  $$ select f.regular_season_weeks, f.playoff_teams, f.playoff_rounds, f.last_week from public.schedule_fit_internal(10, 14, 6, 2) f $$,
  $$ values (4, 4, 2, 17) $$,
  'two-week rounds at week 10: 14 + 6 → 4 + (2 rounds × 2 weeks) ends at 17 — rsw is NEVER re-grown after a drop (5 + 2 rounds would also fit at 18; the ruling''s letter, R726)');
select results_eq(
  $$ select f.regular_season_weeks, f.playoff_teams, f.fits, f.shrunk from public.schedule_fit_internal(1, 12, 0, 1) f $$,
  $$ values (12, 0, true, false) $$,
  'a plan that already fits is returned UNCHANGED (shrunk = false)');
select throws_ok(
  $$ select * from public.schedule_fit_internal(0, 14, 6, 1) $$, '22023',
  'schedule_fit_internal: first week 0 is not an NFL week (1–18)',
  'first week 0 refuses 22023 (one below the calendar)');
select throws_ok(
  $$ select * from public.schedule_fit_internal(10, 14, 6, 3) $$, '22023',
  'schedule_fit_internal: playoff_weeks_per_round 3 must be 1 or 2 (§7.3.1)',
  'playoff_weeks_per_round 3 refuses 22023 (one above the catalog)');

-- ---------------------------------------------------------------------------
-- C. The invariant matrix — every v1 size × rsw {4, 12, 15} × second_opponent
--    (30 builds through the pure builder; R703's cross-side shape throughout)
-- ---------------------------------------------------------------------------
create temp table s_ids (n int primary key, ids uuid[] not null);
insert into s_ids
select n, (select array_agg(('d0000000-0000-4000-8000-' || lpad(n::text, 4, '0') || lpad(i::text, 8, '0'))::uuid order by i)
           from generate_series(1, n) i)
from unnest(array[8, 10, 12, 14, 16]) n;

create temp table s_build as
select i.n, r.rsw, so.so, b.week, b.round_type, b.home_team_id, b.away_team_id
from s_ids i
cross join unnest(array[4, 12, 15]) r(rsw)
cross join unnest(array[false, true]) so(so)
cross join lateral public.schedule_build_internal(i.ids, 20260902, 1, r.rsw, so.so) b;

select is(
  (select count(*)::int from (select distinct n, rsw, so from s_build) x), 30,
  'the matrix built: 5 sizes × 3 season lengths × 2 second_opponent settings = 30 schedules');
select is_empty(
  $$ select n, rsw, so, count(*) from s_build group by 1, 2, 3
     having count(*) <> rsw * (n / 2) * (case when so then 2 else 1 end) $$,
  'row count = weeks × n/2 pairings × game types for EVERY build');
select is_empty(
  $$ select n, rsw, so, week, round_type, t, count(*)
     from (select n, rsw, so, week, round_type, home_team_id t from s_build
           union all select n, rsw, so, week, round_type, away_team_id from s_build) app
     group by 1, 2, 3, 4, 5, 6 having count(*) <> 1 $$,
  'EVERY team appears EXACTLY ONCE per week per game type — counted over home AND away together (R703''s cross-side shape) — in every build');
select is_empty(
  $$ select n, rsw, so, week, round_type, count(distinct t)
     from (select n, rsw, so, week, round_type, home_team_id t from s_build
           union all select n, rsw, so, week, round_type, away_team_id from s_build) app
     group by 1, 2, 3, 4, 5 having count(distinct t) <> n $$,
  '…and every week of every game type covers ALL n teams (no team ever sits out — v1 has no byes)');
select is_empty(
  $$ select 1 from s_build where home_team_id = away_team_id $$,
  'no self-matchups in any build');
select is_empty(
  $$ select p.n, p.rsw, p.week
     from s_build p join s_build s
       on s.n = p.n and s.rsw = p.rsw and s.so = p.so and s.week = p.week
      and p.round_type = 'regular' and s.round_type = 'secondary'
     where least(s.home_team_id, s.away_team_id) = least(p.home_team_id, p.away_team_id)
       and greatest(s.home_team_id, s.away_team_id) = greatest(p.home_team_id, p.away_team_id) $$,
  'E40: the second_opponent derangement NEVER pairs a team with its primary opponent (no secondary row repeats a primary pair in the same week) — every size');
select is_empty(
  $$ select 1 from s_build where so and round_type = 'secondary' and home_team_id = away_team_id $$,
  '…and never with itself');
select results_eq(
  $$ select n, min(gap)::int from (
       select n, week - lag(week) over (partition by n, least(home_team_id, away_team_id), greatest(home_team_id, away_team_id) order by week) gap
       from s_build where rsw = 15 and so = false and round_type = 'regular') g
     where gap is not null group by n order by n $$,
  $$ values (8, 7), (10, 9), (12, 11), (14, 13) $$,
  'MEASURED repeat gap at rsw 15: the minimum weeks between two meetings of a pair is exactly n − 1 (7/9/11/13) — ≥ 3 with room to spare (16 teams have no repeat inside 15 weeks)');
select is_empty(
  $$ select n, rsw, so from (
       select n, rsw, so, count(*) c from s_build where round_type = 'regular'
       group by n, rsw, so, least(home_team_id, away_team_id), greatest(home_team_id, away_team_id)) x
     group by 1, 2, 3 having max(c) - min(c) > 1 $$,
  'balanced repeats: the spread of meeting counts across pairings is ≤ 1 in every build');
select results_eq(
  $$ select n, count(distinct (least(home_team_id, away_team_id), greatest(home_team_id, away_team_id)))::int
     from s_build where rsw = 15 and so = false and round_type = 'regular' and week <= n - 1
     group by n order by n $$,
  $$ values (8, 28), (10, 45), (12, 66), (14, 91), (16, 120) $$,
  'the first n − 1 weeks are a 1-factorization: every one of the n(n−1)/2 pairs meets exactly once (28/45/66/91/120)');
select is_empty(
  $$ select 1 from (
       select home_team_id <> lag(home_team_id) over (
                partition by n, rsw, so, round_type, least(home_team_id, away_team_id), greatest(home_team_id, away_team_id)
                order by week) alt
       from s_build) a where alt = false $$,
  'home/away ALTERNATES within a pairing (per game type) in every build — a repeat meeting flips the sides');
select is(
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from s_ids i, lateral public.schedule_build_internal(i.ids, 777, 1, 15, true) b where i.n = 12),
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from s_ids i, lateral public.schedule_build_internal(i.ids, 777, 1, 15, true) b where i.n = 12),
  'DETERMINISM: the same (ids, seed, weeks, second_opponent) twice ⇒ byte-equal schedules');
select is(
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from s_ids i, lateral public.schedule_build_internal(i.ids, 777, 1, 15, true) b where i.n = 12),
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from s_ids i, lateral public.schedule_build_internal(
          (select array_agg(x order by md5(x::text)) from unnest(i.ids) x), 777, 1, 15, true) b where i.n = 12),
  'INPUT-ORDER INDEPENDENCE: the same ids in a different order ⇒ the same schedule (the seed alone decides)');
select isnt(
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from s_ids i, lateral public.schedule_build_internal(i.ids, 777, 1, 15, true) b where i.n = 12),
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from s_ids i, lateral public.schedule_build_internal(i.ids, 778, 1, 15, true) b where i.n = 12),
  'SEED SENSITIVITY: seed + 1 ⇒ a different schedule');
select is(
  (select count(*)::int from s_ids i, lateral public.schedule_build_internal(i.ids, 1, 7, 4, false) b where i.n = 8
   and b.week between 7 and 10), 16,
  'the first-week parameter places the rows: first week 7, four weeks ⇒ weeks 7..10 (16 rows for 8 teams)');
select throws_ok(
  $$ select * from public.schedule_build_internal(
       (select array_agg(('d0000000-0000-4000-8000-0007' || lpad(i::text, 8, '0'))::uuid) from generate_series(1, 7) i),
       1, 1, 4, false) $$,
  '22023',
  'schedule_build_internal: 7 teams — v1 schedules even counts only (8/10/12/14/16 — §7.3.1; byes are v1.1)',
  'an ODD count refuses 22023 by name (byes are v1.1); the writer''s own odd arm is shadowed by 040''s team_count CHECK — pinned here at the builder, where it is reachable');
select lives_ok(
  $$ select * from public.schedule_build_internal(
       (select array_agg(('d0000000-0000-4000-8000-0006' || lpad(i::text, 8, '0'))::uuid) from generate_series(1, 6) i),
       1, 1, 4, false) $$,
  '…one unit away (6 teams) builds');
select throws_ok(
  $$ select * from public.schedule_build_internal(
       (select array_agg(('d0000000-0000-4000-8000-0008' || lpad(i::text, 8, '0'))::uuid) from generate_series(1, 7) i)
         || 'd0000000-0000-4000-8000-000800000001'::uuid, 1, 1, 4, false) $$,
  '22023',
  'schedule_build_internal: duplicate team id in the input',
  'a duplicate id refuses 22023 by name');

-- ---------------------------------------------------------------------------
-- D. Fixtures (postgres context — before any JWT claims)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('91000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-se' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'se_user' || i)::jsonb, now(), now()
from generate_series(1, 11) i;
-- u01 = commissioner/owner of every fixture league; u02 = manager in L8;
-- u03 = an OUTSIDER (member of nothing); u04..u11 = the eight LC managers.

-- R724: THE 2026 CALENDAR THIS FILE'S GOLDENS ARE WRITTEN AGAINST, re-asserted
-- inside this rolled-back txn from 039's literals — so the goldens below are a
-- function of this FILE, never of whatever the running stack's nfl_weeks rows
-- happen to hold (a shifted or spent seed cannot move them; 003 pins the seed
-- itself). first_kickoff_at/last_game_ends_at NULL: the starts_at arm decides.
update nfl_weeks w
set starts_at = v.starts_at, first_kickoff_at = null, last_game_ends_at = null
from (values
  (1, '2026-09-09 00:00:00-04'::timestamptz), (2, '2026-09-16 00:00:00-04'), (3, '2026-09-23 00:00:00-04'),
  (4, '2026-09-30 00:00:00-04'), (5, '2026-10-07 00:00:00-04'), (6, '2026-10-14 00:00:00-04'),
  (7, '2026-10-21 00:00:00-04'), (8, '2026-10-28 00:00:00-04'), (9, '2026-11-04 00:00:00-05'),
  (10, '2026-11-11 00:00:00-05'), (11, '2026-11-18 00:00:00-05'), (12, '2026-11-25 00:00:00-05'),
  (13, '2026-12-02 00:00:00-05'), (14, '2026-12-09 00:00:00-05'), (15, '2026-12-16 00:00:00-05'),
  (16, '2026-12-23 00:00:00-05'), (17, '2026-12-30 00:00:00-05'), (18, '2027-01-06 00:00:00-05')
) as v(week, starts_at)
where w.season = 2026 and w.week = v.week;
delete from nfl_games where season = 2026;

-- The synthetic 2077 season for the datum arms (never the real 2026 rows).
insert into nfl_weeks (season, week, starts_at, first_kickoff_at, last_game_ends_at, correction_window_ends_at) values
  (2077, 1, '2077-09-08 00:00:00-04', '2077-09-09 20:20:00-04', null, '2077-09-16 06:00:00-04'),
  (2077, 2, '2077-09-15 00:00:00-04', null,                    null, '2077-09-23 06:00:00-04'),
  (2077, 3, '2077-09-22 00:00:00-04', null,                    null, '2077-09-30 06:00:00-04');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
  ('se-2077-w2-a', 2077, 2, 'KC', 'BUF', '2077-09-19 13:00:00-04'),
  ('se-2077-w2-b', 2077, 2, 'DAL', 'PHI', '2077-09-16 20:15:00-04');   -- the week's FIRST kickoff

-- Five in_season leagues, one per v1 size (L8/L10/L12/L14/L16): the writer
-- at every size. Snapshot + reference present (059/F143 guards).
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot, settings)
select ('b1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '91000000-0000-4000-8000-000000000001', 'pgtap-se-L' || n, 2026, 'in_season', n,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       '{}'::jsonb
from unnest(array[8, 10, 12, 14, 16]) n;
insert into teams (id, owner_id, name, league_id)
select ('c1000000-0000-4000-8000-00' || lpad(n::text, 2, '0') || '000000' || lpad(i::text, 2, '0'))::uuid,
       '91000000-0000-4000-8000-000000000001',
       'pgtap-se-L' || n || '-t' || i,
       ('b1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
from unnest(array[8, 10, 12, 14, 16]) n, generate_series(1, 16) i
where i <= n;
insert into league_members (league_id, user_id, team_id, role) values
  ('b1000000-0000-4000-8000-000000000008', '91000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000800000001', 'commissioner'),
  ('b1000000-0000-4000-8000-000000000008', '91000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000800000002', 'manager');

-- LC: a 'drafting' league with a LIVE non-mock snake draft at its LAST pick
-- (1 round — {QB:1}, bench 0 — 7 of 8 picks made; the 026 shape). Eight
-- managers so the last pick can be driven through the REAL draft_make_pick.
insert into players (id, full_name, position, adp)
select 'se-p' || lpad(i::text, 2, '0'), 'SE QB ' || i, 'QB', i / 1000.0 from generate_series(1, 8) i;
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot, settings, roster_settings)
values ('b1000000-0000-4000-8000-0000000000c0', '91000000-0000-4000-8000-000000000004',
        'pgtap-se-LC', 2026, 'drafting', 8,
        (select id from scoring_systems where is_template and name = 'ESPN Standard'),
        (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
        '{"draft": {"draft_type": "snake", "pick_timer_seconds": 90, "disconnect_grace_seconds": 30}}',
        '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 0, "ir_slots": [], "swap_spots": 0}');
insert into teams (id, owner_id, name, league_id)
select ('c1000000-0000-4000-8000-00c0000000' || lpad(i::text, 2, '0'))::uuid,
       ('91000000-0000-4000-8000-0000000000' || lpad((i + 3)::text, 2, '0'))::uuid,
       'pgtap-se-LC-t' || i, 'b1000000-0000-4000-8000-0000000000c0'
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b1000000-0000-4000-8000-0000000000c0',
       ('91000000-0000-4000-8000-0000000000' || lpad((i + 3)::text, 2, '0'))::uuid,
       ('c1000000-0000-4000-8000-00c0000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;
insert into drafts (id, league_id, draft_type, status, is_mock, config, draft_order,
                    total_rounds, current_round, current_pick_number, on_clock_team_id,
                    current_deadline, started_at) values
  ('e1000000-0000-4000-8000-0000000000c0', 'b1000000-0000-4000-8000-0000000000c0',
   'snake', 'live', false, '{"pick_timer_seconds": 90}',
   (select jsonb_agg(to_jsonb(('c1000000-0000-4000-8000-00c0000000' || lpad(i::text, 2, '0'))) order by i) from generate_series(1, 8) i),
   1, 1, 8, 'c1000000-0000-4000-8000-00c000000008', now() + interval '90 seconds', now());
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via)
select 'e1000000-0000-4000-8000-0000000000c0', 'b1000000-0000-4000-8000-0000000000c0',
       i, 1, ('c1000000-0000-4000-8000-00c0000000' || lpad(i::text, 2, '0'))::uuid,
       'se-p' || lpad(i::text, 2, '0'), false, 'manager'
from generate_series(1, 7) i;

-- LS: a 'scheduled' league (8 seats, reference set, no snapshot yet) for the
-- draft_start pre-flight; LD: a 'drafting' league (with snapshot) for F143.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot, settings)
values
  ('b1000000-0000-4000-8000-0000000000e0', '91000000-0000-4000-8000-000000000001', 'pgtap-se-LS', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), null,
   '{"draft": {"draft_type": "snake", "draft_order_mode": "random", "pick_timer_seconds": 90}}'),
  ('b1000000-0000-4000-8000-0000000000d0', '91000000-0000-4000-8000-000000000001', 'pgtap-se-LD', 2026, 'drafting', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   (select rules from scoring_systems where is_template and name = 'ESPN Standard'), '{}');
insert into teams (id, owner_id, name, league_id)
select ('c1000000-0000-4000-8000-00e0000000' || lpad(i::text, 2, '0'))::uuid,
       '91000000-0000-4000-8000-000000000001', 'pgtap-se-LS-t' || i, 'b1000000-0000-4000-8000-0000000000e0'
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('b1000000-0000-4000-8000-0000000000e0', '91000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-00e000000001', 'commissioner');

-- Post-reset race guard (the 024/026 pattern): the completion's leagues
-- status flip broadcasts into realtime.messages — today's + tomorrow's
-- partitions must exist.
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

-- ---------------------------------------------------------------------------
-- E. The datum's three arms (Q31 rider (2)) — synthetic 2077, −1s / +0s twins
-- ---------------------------------------------------------------------------
select is(public.schedule_first_week_internal(2077, '2077-09-09 20:19:59-04'), 1,
  'ARM 1 (first_kickoff_at): one second before week 1''s stored first kickoff ⇒ week 1 — even though starts_at (Wed 00:00) is already past');
select is(public.schedule_first_week_internal(2077, '2077-09-09 20:20:00-04'), 2,
  '…AT the kickoff instant week 1 is under way ⇒ week 2 (strictly ahead, never a week already kicked off)');
select is(public.schedule_first_week_internal(2077, '2077-09-16 20:14:59-04'), 2,
  'ARM 2 (min nfl_games.kickoff_at — first_kickoff_at NULL): one second before week 2''s EARLIEST game ⇒ week 2 (the Thursday game, not the Sunday one)');
select is(public.schedule_first_week_internal(2077, '2077-09-16 20:15:00-04'), 3,
  '…at that kickoff ⇒ week 3');
select is(public.schedule_first_week_internal(2077, '2077-09-21 23:59:59-04'), 3,
  'ARM 3 (starts_at — no kickoff, no games): one second before week 3''s Wednesday 00:00 ⇒ week 3 (the conservative fallback)');
select is(public.schedule_first_week_internal(2077, '2077-09-22 00:00:00-04'), null,
  '…at week 3''s starts_at nothing is ahead ⇒ NULL (the season is spent)');
select is(public.schedule_first_week_internal(2075, '2026-01-01 00:00:00-05'), null,
  'a season with no calendar rows ⇒ NULL');
-- The real 2026 seed (039), the instants the goldens below use:
select is(public.schedule_first_week_internal(2026, '2026-09-08 23:59:59-04'), 1,
  '2026: the second before week 1''s starts_at ⇒ week 1');
select is(public.schedule_first_week_internal(2026, '2026-09-09 00:00:00-04'), 2,
  '2026: AT week 1''s starts_at ⇒ week 2 (the seed has no kickoffs — the starts_at arm decides)');
select is(public.schedule_first_week_internal(2026, '2026-11-05 12:00:00-05'), 10,
  '2026: 2026-11-05 noon ET (week 9 under way, week 10 starts 11-11) ⇒ week 10');
select is(public.schedule_first_week_internal(2026, '2027-01-06 00:00:00-05'), null,
  '2026: AT week 18''s starts_at ⇒ NULL — the season is over');

-- ---------------------------------------------------------------------------
-- F. The writer at every size, at week 1 (no shrink) — the same invariants on
--    the WRITTEN rows, one league per size (savepoint-scoped)
-- ---------------------------------------------------------------------------
create temp table s_written as
select l.n, m.week, m.round_type, m.home_team_id, m.away_team_id, m.status
from (select 0 as n, null::int as week, null::text as round_type, null::uuid as home_team_id, null::uuid as away_team_id, null::text as status) m
cross join (select 0 as n) l where false;

savepoint f_sizes;
update leagues set settings = '{"second_opponent": true, "schedule_seed": 20260902}'
where id in ('b1000000-0000-4000-8000-000000000008', 'b1000000-0000-4000-8000-000000000010',
             'b1000000-0000-4000-8000-000000000012', 'b1000000-0000-4000-8000-000000000014',
             'b1000000-0000-4000-8000-000000000016');
select results_eq(
  $$ select n,
            (r ->> 'first_week')::int, (r ->> 'last_week')::int, (r ->> 'regular_season_weeks')::int,
            (r ->> 'playoff_teams')::int, (r ->> 'shrunk')::boolean, (r ->> 'league_weeks')::int, (r ->> 'matchups')::int,
            (r ->> 'seed_minted')::boolean, (r ->> 'schedule_seed')::bigint
     from unnest(array[8, 10, 12, 14, 16]) n,
     lateral public.league_generate_schedule(('b1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
                                             '2026-09-08 12:00:00-04') r
     order by n $$,
  $$ values (8, 1, 17, 14, 6, false, 17, 112, false, 20260902::bigint),
            (10, 1, 17, 14, 6, false, 17, 140, false, 20260902::bigint),
            (12, 1, 17, 14, 6, false, 17, 168, false, 20260902::bigint),
            (14, 1, 17, 14, 6, false, 17, 196, false, 20260902::bigint),
            (16, 1, 17, 14, 6, false, 17, 224, false, 20260902::bigint) $$,
  'THE WRITER AT EVERY SIZE (pre-season instant, second_opponent on, stored seed): first week 1, last 17, 14 + 6 unshrunk, 17 league_weeks, 14 × n/2 × 2 matchups, the stored seed honored');
insert into s_written
select l.team_count, m.week, m.round_type, m.home_team_id, m.away_team_id, m.status
from matchups m join leagues l on l.id = m.league_id
where l.name like 'pgtap-se-L%' and l.status = 'in_season';
select is_empty(
  $$ select n, week, round_type, t, count(*)
     from (select n, week, round_type, home_team_id t from s_written
           union all select n, week, round_type, away_team_id from s_written) app
     group by 1, 2, 3, 4 having count(*) <> 1 $$,
  'WRITTEN rows: every team exactly once per week per game type, cross-side (R703), at every size');
select is_empty(
  $$ select p.n, p.week
     from s_written p join s_written s on s.n = p.n and s.week = p.week
      and p.round_type = 'regular' and s.round_type = 'secondary'
     where least(s.home_team_id, s.away_team_id) = least(p.home_team_id, p.away_team_id)
       and greatest(s.home_team_id, s.away_team_id) = greatest(p.home_team_id, p.away_team_id) $$,
  'WRITTEN rows: E40 holds — no secondary row repeats the primary pair');
select is(
  (select bool_and(status = 'scheduled') from s_written), true,
  'WRITTEN rows are born scheduled');
select is_empty(
  $$ select 1 from matchups m
     left join league_weeks w on w.league_id = m.league_id and w.season = m.season and w.week = m.week
     where w.id is null $$,
  'F213 in practice: every written matchup week has its league_weeks row (the FK is not the only proof — the join is empty)');
select is(
  (select count(*)::int from league_weeks w join leagues l on l.id = w.league_id
   where l.name like 'pgtap-se-L%' and l.status = 'in_season' and w.status = 'upcoming'), 85,
  'league_weeks: 5 leagues × 17 weeks (1..17 = 14 regular + 3 playoff), all upcoming — the plan materialized incl. the playoff weeks');
select is(
  (select string_agg((m.week, m.round_type, m.home_team_id, m.away_team_id)::text, ',' order by m.week, m.round_type, m.home_team_id)
   from matchups m where m.league_id = 'b1000000-0000-4000-8000-000000000012'),
  (select string_agg((b.week, b.round_type, b.home_team_id, b.away_team_id)::text, ',' order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal(
          (select array_agg(t.id) from teams t where t.league_id = 'b1000000-0000-4000-8000-000000000012'),
          20260902, 1, 14, true) b),
  'ONE IMPLEMENTATION: the writer''s rows for the 12-team league ≡ the pure builder over the league''s own team ids with the stored seed');
select is_empty(
  $$ select 1 from matchups m join teams h on h.id = m.home_team_id join teams a on a.id = m.away_team_id
     where h.league_id <> m.league_id or a.league_id <> m.league_id $$,
  'same-league by construction: every written pairing''s teams belong to the matchup''s league (R704''s team-FK case, pinned on the engine''s output)');
-- The parent side of F213: a planned week that matchups reference cannot
-- be deleted from under them (NO ACTION). (A league DELETE is blocked by
-- teams_league_id_fkey regardless — leagues with seats are never hard-deleted;
-- CLAUDE.md soft-deletes — so the cascade path is not probed.)
select throws_ok(
  $$ delete from league_weeks where league_id = 'b1000000-0000-4000-8000-000000000016' and week = 1 $$,
  '23503', null,
  'F213 parent side: deleting a league_weeks row that matchups reference refuses 23503');
select results_eq(
  $$ with r as (delete from league_weeks
     where league_id = 'b1000000-0000-4000-8000-000000000016' and week = 17 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  '…a planned week with NO matchups yet (playoff week 17) deletes (1 row) — the sibling');
rollback to savepoint f_sizes;

-- ---------------------------------------------------------------------------
-- G. Mid-season goldens through the writer (L8, defaults 14 + 6, real 2026
--    seed) — each a stored literal at a boundary instant (savepoint-scoped)
-- ---------------------------------------------------------------------------
savepoint g_week10;
select results_eq(
  $$ select (r ->> 'first_week')::int, (r ->> 'last_week')::int, (r ->> 'regular_season_weeks')::int,
            (r ->> 'playoff_teams')::int, (r ->> 'playoff_start_week')::int, (r ->> 'playoff_rounds')::int,
            (r ->> 'shrunk')::boolean, (r ->> 'league_weeks')::int, (r ->> 'matchups')::int,
            (r ->> 'seed_minted')::boolean, r ->> 'matchups_reason'
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') r $$,
  $$ values (10, 18, 6, 6, 7, 3, true, 9, 24, true, null::text) $$,
  'ENTER AT WEEK 10 (2026-11-05 noon ET): 6 regular + 3 playoff weeks, playoff_start_week 7, shrunk, 9 league_weeks (10..18), 24 matchups (6 × 4), a seed MINTED');
select results_eq(
  $$ select regular_season_weeks, playoff_teams, playoff_start_week from leagues where id = 'b1000000-0000-4000-8000-000000000008' $$,
  $$ values (6, 6, 7) $$,
  'Q31 rider (3): the EFFECTIVE plan is written back to the typed columns — (6, 6, 7), continuity kept in league-week terms');
select is(
  (select (settings ->> 'schedule_seed')::bigint from leagues where id = 'b1000000-0000-4000-8000-000000000008'),
  (select (settings ->> 'schedule_seed')::bigint from leagues where id = 'b1000000-0000-4000-8000-000000000008'),
  'the minted seed is WRITTEN to settings (auditable/reproducible)');
select ok(
  (select (settings ->> 'schedule_seed')::bigint between 0 and 2147483647 from leagues where id = 'b1000000-0000-4000-8000-000000000008'),
  '…and it is a 31-bit non-negative integer (the LCG state space; the Zod catalog range)');
select results_eq(
  $$ select week, status from league_weeks where league_id = 'b1000000-0000-4000-8000-000000000008' order by week $$,
  $$ values (10, 'upcoming'), (11, 'upcoming'), (12, 'upcoming'), (13, 'upcoming'), (14, 'upcoming'),
            (15, 'upcoming'), (16, 'upcoming'), (17, 'upcoming'), (18, 'upcoming') $$,
  'league_weeks 10..18 all upcoming — NFL week = first week + league week − 1 (D288/Q29)');
select results_eq(
  $$ select week, count(*)::int from matchups where league_id = 'b1000000-0000-4000-8000-000000000008' group by week order by week $$,
  $$ values (10, 4), (11, 4), (12, 4), (13, 4), (14, 4), (15, 4) $$,
  'matchups on NFL weeks 10..15 (the 6 regular league weeks), 4 pairings each; playoff weeks 16..18 carry NO rows (116 generates the bracket)');
-- Reproducibility of a MINTED seed: the builder over the same ids reproduces the written rows.
select is(
  (select string_agg((m.week, m.round_type, m.home_team_id, m.away_team_id)::text, ',' order by m.week, m.round_type, m.home_team_id)
   from matchups m where m.league_id = 'b1000000-0000-4000-8000-000000000008'),
  (select string_agg((b.week, b.round_type, b.home_team_id, b.away_team_id)::text, ',' order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal(
          (select array_agg(t.id) from teams t where t.league_id = 'b1000000-0000-4000-8000-000000000008'),
          (select (settings ->> 'schedule_seed')::bigint from leagues where id = 'b1000000-0000-4000-8000-000000000008'),
          10, 6, false) b),
  'the MINTED seed reproduces the written schedule through the pure builder (audit trail closed)');
select throws_like(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') $$,
  '%already has league_weeks rows for season 2026 — generation runs once%',
  'a SECOND generation refuses by name (idempotency is a refusal, not a silent rewrite — Remix is 111''s)');
rollback to savepoint g_week10;

savepoint g_week12;
select results_eq(
  $$ select (r ->> 'regular_season_weeks')::int, (r ->> 'playoff_teams')::int, (r ->> 'playoff_start_week')::int, (r ->> 'last_week')::int
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-19 12:00:00-05') r $$,
  $$ values (4, 6, 5, 18) $$,
  'ENTER AT WEEK 12 (2026-11-19 noon ET — week 11 under way, week 12 starts 11-25): the FLOOR exactly — 4 + 3, playoff_teams still 6, psw 5, ends at 18');
select results_eq(
  $$ select regular_season_weeks, playoff_start_week from leagues where id = 'b1000000-0000-4000-8000-000000000008' $$,
  $$ values (4, 5) $$,
  '§M: a stored rsw-4 / psw-5 row LIVES — no table CHECK bounds the columns (040 added none); the effective plan is storable');
rollback to savepoint g_week12;

savepoint g_week13;
select results_eq(
  $$ select (r ->> 'regular_season_weeks')::int, (r ->> 'playoff_teams')::int, (r ->> 'playoff_rounds')::int, (r ->> 'last_week')::int, (r ->> 'league_weeks')::int
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-26 12:00:00-05') r $$,
  $$ values (4, 4, 2, 18, 6) $$,
  'ENTER AT WEEK 13 (2026-11-26 noon ET; floor−1 vs floor): rsw 3 would fit — the chain keeps 4 and drops 6 → 4 (2 rounds); 6 league_weeks (13..18)');
select results_eq(
  $$ select regular_season_weeks, playoff_teams, playoff_start_week from leagues where id = 'b1000000-0000-4000-8000-000000000008' $$,
  $$ values (4, 4, 5) $$,
  '…written back as (4, 4, 5)');
rollback to savepoint g_week13;

savepoint g_week14;
select results_eq(
  $$ select (r ->> 'regular_season_weeks')::int, (r ->> 'playoff_teams')::int, (r ->> 'playoff_rounds')::int, (r ->> 'last_week')::int
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-12-03 12:00:00-05') r $$,
  $$ values (4, 2, 1, 18) $$,
  'ENTER AT WEEK 14 (2026-12-03 noon ET): 4 + 1, playoff_teams 6 → 4 → 2');
rollback to savepoint g_week14;

savepoint g_week15;
select results_eq(
  $$ select (r ->> 'regular_season_weeks')::int, (r ->> 'playoff_teams')::int, (r ->> 'playoff_rounds')::int, (r ->> 'last_week')::int, (r ->> 'league_weeks')::int, (r ->> 'matchups')::int
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-12-15 23:59:59-05') r $$,
  $$ values (4, 0, 0, 18, 4, 16) $$,
  'ENTER AT WEEK 15 (one second before week 15''s starts_at — the LAST fitting instant): 4 + 0, playoff_teams → 0, 4 league_weeks (15..18), 16 matchups');
select results_eq(
  $$ select regular_season_weeks, playoff_teams, playoff_start_week from leagues where id = 'b1000000-0000-4000-8000-000000000008' $$,
  $$ values (4, 0, 5) $$,
  '…written back as (4, 0, 5) — a points-only season keeps continuity (Q10: psw = rsw + 1 regardless of playoff_teams)');
rollback to savepoint g_week15;

select throws_like(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-12-16 00:00:00-05') $$,
  '%would enter the season at NFL week 16 — even the 4-week floor with no playoffs ends at week 19 (> 18)%',
  'ENTER AT WEEK 16 (one second later: AT week 15''s starts_at ⇒ week 16): REFUSED by name — the one-unit twin of the week-15 positive');
select is(
  (select count(*)::int from league_weeks where league_id = 'b1000000-0000-4000-8000-000000000008')
  + (select count(*)::int from matchups where league_id = 'b1000000-0000-4000-8000-000000000008'), 0,
  '…and the refusal wrote NOTHING');
select throws_like(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2027-01-06 00:00:00-05') $$,
  '%no NFL week of season 2026 has a first kickoff still ahead%',
  'past week 18''s start: the season is spent — refused by name (the NULL-datum arm)');

-- Non-default playoff_teams drop steps through the writer (D305(5)).
savepoint g_pt12;
update leagues set playoff_teams = 12 where id = 'b1000000-0000-4000-8000-000000000012';
select results_eq(
  $$ select (r ->> 'regular_season_weeks')::int, (r ->> 'playoff_teams')::int, (r ->> 'playoff_rounds')::int
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000012', '2026-11-26 12:00:00-05') r $$,
  $$ values (4, 4, 2) $$,
  '12 playoff teams entering at week 13: 12 → 8 → 4 through the writer, written back');
select is((select playoff_teams from leagues where id = 'b1000000-0000-4000-8000-000000000012'), 4, '…playoff_teams column reads 4');
rollback to savepoint g_pt12;
savepoint g_pt8;
update leagues set playoff_teams = 8 where id = 'b1000000-0000-4000-8000-000000000008';
select results_eq(
  $$ select (r ->> 'regular_season_weeks')::int, (r ->> 'playoff_teams')::int
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-12-03 12:00:00-05') r $$,
  $$ values (4, 2) $$,
  '8 playoff teams entering at week 14: 8 → 4 → 2');
rollback to savepoint g_pt8;
savepoint g_pt10;
update leagues set playoff_teams = 10 where id = 'b1000000-0000-4000-8000-000000000010';
select results_eq(
  $$ select (r ->> 'regular_season_weeks')::int, (r ->> 'playoff_teams')::int
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000010', '2026-11-26 12:00:00-05') r $$,
  $$ values (4, 4) $$,
  '10 playoff teams entering at week 13: 10 → 8 → 4');
rollback to savepoint g_pt10;

-- Determinism over the WRITER; divisions ignored; a stored seed honored.
savepoint g_det1;
update leagues set settings = '{"schedule_seed": 424242, "divisions": 1}' where id = 'b1000000-0000-4000-8000-000000000008';
select is(
  (select r ->> 'seed_minted' from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') r),
  'false',
  'a STORED seed is honored (seed_minted = false)');
-- Captured into a psql variable: a temp table created here would roll back
-- with the savepoint; the variable survives it (the smoke-test idiom).
select string_agg((week, round_type, home_team_id, away_team_id)::text, ',' order by week, round_type, home_team_id) as det1
from matchups where league_id = 'b1000000-0000-4000-8000-000000000008' \gset
rollback to savepoint g_det1;
savepoint g_det2;
update leagues set settings = '{"schedule_seed": 424242, "divisions": 2}' where id = 'b1000000-0000-4000-8000-000000000008';
select lives_ok(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') $$,
  'the same league with divisions = 2 generates');
select is(
  (select string_agg((week, round_type, home_team_id, away_team_id)::text, ',' order by week, round_type, home_team_id) from matchups where league_id = 'b1000000-0000-4000-8000-000000000008'),
  :'det1',
  'Q30 (d): divisions = 2 ⇒ the IDENTICAL schedule to divisions = 1 (same seed) — the value is IGNORED');
rollback to savepoint g_det2;
savepoint g_det3;
update leagues set settings = '{"schedule_seed": 424242, "divisions": 1}' where id = 'b1000000-0000-4000-8000-000000000008';
select lives_ok(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') $$,
  'the writer runs again on the rolled-back league');
select is(
  (select string_agg((week, round_type, home_team_id, away_team_id)::text, ',' order by week, round_type, home_team_id) from matchups where league_id = 'b1000000-0000-4000-8000-000000000008'),
  :'det1',
  'DETERMINISM over the writer: the same league + seed + instant twice ⇒ byte-equal rows');
select is(
  (select count(*)::int from matchups where league_id = 'b1000000-0000-4000-8000-000000000008' and round_type = 'secondary'), 0,
  'second_opponent off ⇒ zero secondary rows');
rollback to savepoint g_det3;

-- second_opponent on the writer; total_points by name.
savepoint g_second;
update leagues set settings = '{"second_opponent": true}' where id = 'b1000000-0000-4000-8000-000000000008';
select results_eq(
  $$ select (r ->> 'matchups')::int, (r ->> 'second_opponent')::boolean
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') r $$,
  $$ values (48, true) $$,
  'second_opponent on at week 10: 48 rows (6 weeks × 4 pairings × 2 game types)');
select is(
  (select count(*)::int from matchups where league_id = 'b1000000-0000-4000-8000-000000000008' and round_type = 'secondary'), 24,
  '…24 of them secondary');
select is_empty(
  $$ select p.week from matchups p join matchups s on s.league_id = p.league_id and s.week = p.week
       and p.round_type = 'regular' and s.round_type = 'secondary'
     where p.league_id = 'b1000000-0000-4000-8000-000000000008'
       and least(s.home_team_id, s.away_team_id) = least(p.home_team_id, p.away_team_id)
       and greatest(s.home_team_id, s.away_team_id) = greatest(p.home_team_id, p.away_team_id) $$,
  'E40 on the WRITTEN secondary rows: no week pairs a team with its primary opponent');
select is_empty(
  $$ select week, round_type, t, count(*)
     from (select week, round_type, home_team_id t from matchups where league_id = 'b1000000-0000-4000-8000-000000000008'
           union all select week, round_type, away_team_id from matchups where league_id = 'b1000000-0000-4000-8000-000000000008') app
     group by 1, 2, 3 having count(*) <> 1 $$,
  'R703 on the WRITTEN rows: once per week per game type, home and away counted together');
rollback to savepoint g_second;

savepoint g_total;
update leagues set settings = '{"schedule_mode": "total_points", "second_opponent": true}' where id = 'b1000000-0000-4000-8000-000000000008';
select results_eq(
  $$ select (r ->> 'matchups')::int, r ->> 'matchups_reason', (r ->> 'league_weeks')::int, r ->> 'schedule_mode'
     from public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') r $$,
  $$ values (0, 'total_points', 9, 'total_points') $$,
  'total_points: ZERO matchup rows, said BY NAME (matchups_reason) — never a silent empty; the league_weeks plan is still written (9 rows)');
select is((select count(*)::int from matchups where league_id = 'b1000000-0000-4000-8000-000000000008'), 0,
  '…and the table agrees: no rows (second_opponent is moot without matchups)');
rollback to savepoint g_total;

-- Refusals by name (each with its positive above or below).
select throws_like(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-0000000000e0', '2026-11-05 12:00:00-05') $$,
  '%is scheduled — the schedule is generated once, at in_season entry%',
  'a league that is not in_season refuses by name (generation IS the in_season entry)');
savepoint g_seats;
delete from teams where id = 'c1000000-0000-4000-8000-000800000008';
select throws_like(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') $$,
  '%has 7 of 8 franchises seated%',
  'a league missing a seat refuses by name (7 of 8)');
rollback to savepoint g_seats;
savepoint g_mode;
update leagues set settings = '{"schedule_mode": "banana"}' where id = 'b1000000-0000-4000-8000-000000000008';
select throws_like(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') $$,
  '%schedule_mode banana — expected h2h or total_points%',
  'an unknown schedule_mode refuses by name');
rollback to savepoint g_mode;
select throws_ok(
  $$ select public.league_generate_schedule('00000000-0000-4000-8000-000000000000', '2026-11-05 12:00:00-05') $$,
  'P0002',
  'league_generate_schedule: league 00000000-0000-4000-8000-000000000000 not found',
  'an unknown league is P0002');

-- ---------------------------------------------------------------------------
-- H. Completion goldens — draft_complete_internal(draft, p_now) on LC
--    (F215/D291: the instant is INJECTED; one transaction)
-- ---------------------------------------------------------------------------
savepoint h_complete;
select is(
  (select (public.draft_complete_internal('e1000000-0000-4000-8000-0000000000c0', '2026-11-05 12:00:00-05')).status),
  'complete',
  'COMPLETION GOLDEN: draft_complete_internal(draft, 2026-11-05 noon ET) completes the draft');
select results_eq(
  $$ select l.status, l.regular_season_weeks, l.playoff_teams, l.playoff_start_week,
            (select count(*)::int from league_rosters where league_id = l.id),
            (select count(*)::int from league_weeks where league_id = l.id),
            (select min(week) from league_weeks where league_id = l.id),
            (select max(week) from league_weeks where league_id = l.id),
            (select count(*)::int from matchups where league_id = l.id),
            (l.settings ->> 'schedule_seed') is not null
     from leagues l where l.id = 'b1000000-0000-4000-8000-0000000000c0' $$,
  $$ values ('in_season', 6, 6, 7, 7, 9, 10, 18, 24, true) $$,
  '…and in ONE txn the league is in_season with 7 rosters (the non-undone picks), the plan written back (6, 6, 7), league_weeks 10..18 (9), 24 matchups, a seed minted — its first NFL week is the STORED LITERAL 10');
rollback to savepoint h_complete;

select throws_like(
  $$ select public.draft_complete_internal('e1000000-0000-4000-8000-0000000000c0', '2026-12-16 00:00:00-05') $$,
  '%The draft started while the season still fit and completed after NFL week 16''s kickoff%',
  'THE BOUNDARY-CROSSED REFUSAL (Q31 rider (1)): completing AT week 15''s starts_at (⇒ week 16) refuses by name, in-txn');
select results_eq(
  $$ select l.status, (select status from drafts where id = 'e1000000-0000-4000-8000-0000000000c0'),
            (select count(*)::int from league_rosters where league_id = l.id),
            (select count(*)::int from league_weeks where league_id = l.id),
            (select count(*)::int from matchups where league_id = l.id)
     from leagues l where l.id = 'b1000000-0000-4000-8000-0000000000c0' $$,
  $$ values ('drafting', 'live', 0, 0, 0) $$,
  '…and NOTHING landed: the league stays drafting, the draft stays live, zero rosters/weeks/matchups (the aborted txn is the atomicity)');
savepoint h_edge;
select lives_ok(
  $$ select public.draft_complete_internal('e1000000-0000-4000-8000-0000000000c0', '2026-12-15 23:59:59-05') $$,
  '…its one-unit positive: one second EARLIER the same draft completes');
select results_eq(
  $$ select regular_season_weeks, playoff_teams, playoff_start_week, status
     from leagues where id = 'b1000000-0000-4000-8000-0000000000c0' $$,
  $$ values (4, 0, 5, 'in_season') $$,
  '…at 4 + 0 (the silent shrink, rider (1)): (4, 0, 5) written back, in_season');
select is(
  (select count(*)::int from league_weeks where league_id = 'b1000000-0000-4000-8000-0000000000c0'), 4,
  '…with league_weeks 15..18');
rollback to savepoint h_edge;

-- The REAL RPC: the last pick through draft_make_pick as the on-clock
-- manager, on a calendar THIS FIXTURE pins far-future (the F215 shape — the
-- wall clock never decides). Inside its own savepoint so the 2026 literals
-- above stay meaningful.
savepoint h_real;
update nfl_weeks
set starts_at = starts_at + interval '73 years',
    correction_window_ends_at = correction_window_ends_at + interval '73 years'
where season = 2026;
select set_config('request.jwt.claims',
  json_build_object('sub', '91000000-0000-4000-8000-000000000011', 'role', 'authenticated')::text, true);
select lives_ok(
  $$ select public.draft_make_pick('e1000000-0000-4000-8000-0000000000c0', 'se-p08', gen_random_uuid()) $$,
  'THE REAL ROUTE: the on-clock manager (u11, team 8) makes the LAST pick through draft_make_pick');
select set_config('request.jwt.claims', '', true);
select results_eq(
  $$ select l.status, l.regular_season_weeks, l.playoff_teams, l.playoff_start_week,
            (select status from drafts where id = 'e1000000-0000-4000-8000-0000000000c0'),
            (select count(*)::int from league_rosters where league_id = l.id),
            (select count(*)::int from league_weeks where league_id = l.id),
            (select min(week) from league_weeks where league_id = l.id),
            (select count(*)::int from matchups where league_id = l.id)
     from leagues l where l.id = 'b1000000-0000-4000-8000-0000000000c0' $$,
  $$ values ('in_season', 14, 6, 15, 'complete', 8, 17, 1, 56) $$,
  '…and the pick completed the draft: in_season, plan UNSHRUNK (14, 6, 15) because the pinned calendar puts week 1 ahead of any wall clock, 8 rosters, league_weeks 1..17, 56 matchups (14 × 4)');
rollback to savepoint h_real;

-- ---------------------------------------------------------------------------
-- I. draft_start_internal's PRE-FLIGHT (Q31 rider (1)) on LS
-- ---------------------------------------------------------------------------
select throws_like(
  $$ select public.draft_start_internal('b1000000-0000-4000-8000-0000000000e0', false, '2026-12-16 00:00:00-05') $$,
  '%cannot start — the season would begin at NFL week 16, and even a 4-week regular season with no playoffs would end at week 19 (> 18)%',
  'PRE-FLIGHT: starting a draft AT week 15''s starts_at (⇒ week 16) refuses by name, remedy in the message');
select results_eq(
  $$ select status, scoring_rules_snapshot is null from leagues where id = 'b1000000-0000-4000-8000-0000000000e0' $$,
  $$ values ('scheduled', true) $$,
  '…and nothing ran: the league stays scheduled with no snapshot (the refusal precedes the snapshot and the transition)');
savepoint i_start;
select is(
  (select r ->> 'started' from public.draft_start_internal('b1000000-0000-4000-8000-0000000000e0', false, '2026-12-15 23:59:59-05') r),
  'true',
  '…its one-unit positive: one second EARLIER the same league STARTS (the plan will shrink at completion, not here)');
select is((select status from leagues where id = 'b1000000-0000-4000-8000-0000000000e0'), 'drafting',
  '…league drafting');
rollback to savepoint i_start;
savepoint i_nocal;
update leagues set season = 2075 where id = 'b1000000-0000-4000-8000-0000000000e0';
select throws_like(
  $$ select public.draft_start_internal('b1000000-0000-4000-8000-0000000000e0', false, '2026-09-01 12:00:00-04') $$,
  '%no NFL week of season 2075 has a first kickoff still ahead%',
  'a season with no calendar refuses to start by name');
rollback to savepoint i_nocal;
savepoint i_default;
-- R724: the default-p_now call reads the WALL CLOCK — so this cell pins the
-- calendar first (the F215 shape), never trusting the date it runs on.
update nfl_weeks
set starts_at = starts_at + interval '73 years',
    correction_window_ends_at = correction_window_ends_at + interval '73 years'
where season = 2026;
select is(
  (select r ->> 'started' from public.draft_start_internal('b1000000-0000-4000-8000-0000000000e0', false) r),
  'true',
  'the 2-argument call still binds (p_now defaults to now()) — on a calendar this cell pins far-future, so the wall clock never decides');
rollback to savepoint i_default;

-- ---------------------------------------------------------------------------
-- J. F4 — the league_weeks transition guard, on a KEPT generation of L8
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.league_generate_schedule('b1000000-0000-4000-8000-000000000008', '2026-11-05 12:00:00-05') $$,
  'L8 generated (kept) for the F4 / RLS / §M cells: weeks 10..18');
select results_eq(
  $$ with r as (update league_weeks set status = 'live'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'F4 legal: upcoming → live (1 row)');
select results_eq(
  $$ with r as (update league_weeks set status = 'correction_window'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'F4 legal: live → correction_window (1 row)');
select results_eq(
  $$ with r as (update league_weeks set status = 'final', finalized_at = now()
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'F4 legal: correction_window → final (1 row)');
select results_eq(
  $$ with r as (update league_weeks set status = 'final'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'a same-status UPDATE (final → final) passes — not a transition');
select results_eq(
  $$ with r as (update league_weeks set median_score = 101.25
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'a non-status UPDATE on a final week passes (the guard fires on status only)');
-- 123: `reopened_by_action_id` now carries the FK 056:68 parked for
-- "M6 adds the FK with the table", so the audited-reopen cells need REAL audit
-- rows to point at. The ids below are the ones the F4 cells already used.
insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, reason) values
 ('a0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000008',
  '91000000-0000-4000-8000-000000000001', 'reopen_week', 'schedule', 'pgtap F4 reopen #1'),
 ('a0000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000008',
  '91000000-0000-4000-8000-000000000001', 'reopen_week', 'schedule', 'pgtap F4 reopen #2'),
 ('a0000000-0000-4000-8000-000000000009', 'b1000000-0000-4000-8000-000000000008',
  '91000000-0000-4000-8000-000000000001', 'reopen_week', 'schedule', 'pgtap F4 reopen #9');

select throws_like(
  $$ update league_weeks set status = 'correction_window'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 $$,
  '%reopening a final week (season 2026 week 10) requires a NEW reopened_by_action_id%',
  'F4 reopen: final → correction_window WITHOUT an action id refuses by name');
select results_eq(
  $$ with r as (update league_weeks set status = 'correction_window', reopened_by_action_id = 'a0000000-0000-4000-8000-000000000001'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'F4 reopen: final → correction_window WITH a new action id passes (the audited reopen)');
select results_eq(
  $$ with r as (update league_weeks set status = 'final'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  '…and the reopened week re-finalizes');
select throws_like(
  $$ update league_weeks set status = 'correction_window', reopened_by_action_id = 'a0000000-0000-4000-8000-000000000001'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 $$,
  '%requires a NEW reopened_by_action_id%',
  'F4 reopen: the SAME action id a second time refuses — every reopen carries its own audit id');
select results_eq(
  $$ with r as (update league_weeks set status = 'correction_window', reopened_by_action_id = 'a0000000-0000-4000-8000-000000000002'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 10 returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  '…a DIFFERENT id reopens again (the one-unit sibling)');
-- Illegal jumps, each from a fresh row, each by name.
select throws_like(
  $$ update league_weeks set status = 'correction_window' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 11 $$,
  '%illegal status transition upcoming → correction_window%', 'F4 illegal: upcoming → correction_window');
select throws_like(
  $$ update league_weeks set status = 'final' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 11 $$,
  '%illegal status transition upcoming → final%', 'F4 illegal: upcoming → final');
update league_weeks set status = 'live' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12;
select throws_like(
  $$ update league_weeks set status = 'final' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12 $$,
  '%illegal status transition live → final%', 'F4 illegal: live → final (skipping the correction window)');
select throws_like(
  $$ update league_weeks set status = 'upcoming' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12 $$,
  '%illegal status transition live → upcoming%', 'F4 illegal: live → upcoming');
update league_weeks set status = 'correction_window' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12;
select throws_like(
  $$ update league_weeks set status = 'live' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12 $$,
  '%illegal status transition correction_window → live%', 'F4 illegal: correction_window → live');
select throws_like(
  $$ update league_weeks set status = 'upcoming' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12 $$,
  '%illegal status transition correction_window → upcoming%', 'F4 illegal: correction_window → upcoming');
update league_weeks set status = 'final' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12;
select throws_like(
  $$ update league_weeks set status = 'upcoming' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12 $$,
  '%illegal status transition final → upcoming%', 'F4 illegal: final → upcoming');
select throws_like(
  $$ update league_weeks set status = 'live', reopened_by_action_id = 'a0000000-0000-4000-8000-000000000009'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 12 $$,
  '%illegal status transition final → live%', 'F4 illegal: final → live, even with an action id (the reopen lands in the correction window)');
select throws_like(
  $$ update league_weeks set status = 'banana' where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 13 $$,
  '%illegal status transition upcoming → banana%',
  'an out-of-vocabulary UPDATE is refused by the guard first (a BEFORE trigger precedes the CHECK); the 056 CHECK itself is pinned on INSERT in 010');
select results_eq(
  $$ with r as (insert into league_weeks (league_id, season, week, status)
     values ('b1000000-0000-4000-8000-000000000010', 2026, 1, 'live') returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'an INSERT is not a transition — a row may be BORN live (the guard is UPDATE OF status)');

-- ---------------------------------------------------------------------------
-- K. F213 negatives; F143; F130; §M — all privileged, before the JWT cells
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into matchups (league_id, season, week, home_team_id, away_team_id)
     values ('b1000000-0000-4000-8000-000000000008', 2026, 9,
             'c1000000-0000-4000-8000-000800000001', 'c1000000-0000-4000-8000-000800000002') $$,
  '23503', null,
  'F213: a matchup on a week with no league_weeks row (week 9 — one below the plan) refuses 23503');
select throws_ok(
  $$ insert into matchups (league_id, season, week, home_team_id, away_team_id)
     values ('b1000000-0000-4000-8000-000000000008', 2026, 99,
             'c1000000-0000-4000-8000-000800000001', 'c1000000-0000-4000-8000-000800000002') $$,
  '23503', null,
  'F213 closes R704''s week range transitively: week 99 refuses 23503');
select lives_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id)
     values ('b1000000-0000-4000-8000-000000000008', 2026, 16, 'playoff',
             'c1000000-0000-4000-8000-000800000001', 'c1000000-0000-4000-8000-000800000002') $$,
  '…one unit inside the plan (week 16, a playoff row) lives — 116''s bracket has its rows');
select throws_ok(
  $$ insert into team_week_results (league_id, team_id, season, week, points)
     values ('b1000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000800000001', 2026, 9, 1) $$,
  '23503', null,
  'F213: a result on a week with no league_weeks row refuses 23503');
select lives_ok(
  $$ insert into team_week_results (league_id, team_id, season, week, points)
     values ('b1000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000800000001', 2026, 10, 1) $$,
  '…and on a planned week lives');

-- F143
select throws_like(
  $$ update leagues set scoring_system_id = null where id = 'b1000000-0000-4000-8000-0000000000d0' $$,
  '%cannot be in status drafting without a scoring system reference%',
  'F143: DETACHING a drafting league from its scoring system refuses by name (§7.3.8''s "exactly one referenced")');
select is((select scoring_system_id is not null from leagues where id = 'b1000000-0000-4000-8000-0000000000d0'), true,
  '…the reference stands');
select results_eq(
  $$ with r as (update leagues set name = 'pgtap-se-LD-renamed' where id = 'b1000000-0000-4000-8000-0000000000d0' returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'an unrelated UPDATE on the drafting league passes (the arm fires on the reference only)');
savepoint k_detach;
select results_eq(
  $$ with r as (update leagues set scoring_system_id = null where id = 'b1000000-0000-4000-8000-0000000000e0' returning 1) select count(*) from r $$,
  $$ values (1::bigint) $$,
  'F143 one step away: the SAME detach on a scheduled league passes (pre-draft, §7.3.3''s window)');
rollback to savepoint k_detach;

-- F130
select throws_ok(
  $$ select public.draft_resolve_order_internal('b1000000-0000-4000-8000-000000000008', 8, 'random', null, null,
       'e1000000-0000-4000-8000-0000000000f1', 'pgtap', null, 3) $$,
  '22023',
  'pgtap: pin slot 3 was given without a team to pin (p_pin_team is NULL)',
  'F130: p_pin_slot WITHOUT p_pin_team refuses 22023 by name (a control that lied)');
select is(
  (select r ->> 2 from public.draft_resolve_order_internal('b1000000-0000-4000-8000-000000000008', 8, 'random', null, null,
       'e1000000-0000-4000-8000-0000000000f1', 'pgtap', 'c1000000-0000-4000-8000-000800000005', 3) r),
  'c1000000-0000-4000-8000-000800000005',
  '…the sibling: slot 3 WITH a team lands that team at index 2');
select is(
  (select jsonb_array_length(public.draft_resolve_order_internal('b1000000-0000-4000-8000-000000000008', 8, 'random', null, null,
       'e1000000-0000-4000-8000-0000000000f1', 'pgtap'))),
  8,
  '…and the 7-argument call (no pin) still resolves all 8 seats');

-- ---------------------------------------------------------------------------
-- L. RLS on the generated rows + §M's status gate (JWT cells — LAST)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "91000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from league_weeks where league_id = 'b1000000-0000-4000-8000-000000000008'), 9,
  'a MEMBER (manager u2) sees L8''s 9 generated league_weeks rows (056''s member SELECT)');
select is((select count(*)::int from matchups where league_id = 'b1000000-0000-4000-8000-000000000008'), 25,
  '…and its 25 matchups (24 generated + the playoff row inserted above)');
select results_eq(
  $$ with r as (update league_weeks set status = 'live'
     where league_id = 'b1000000-0000-4000-8000-000000000008' and week = 14 returning 1) select count(*) from r $$,
  $$ values (0::bigint) $$,
  '…but cannot UPDATE a week (RLS: no write policy — 0 rows, with the SELECT-sees-9 pin above so 0 is a refusal)');
reset role;
select set_config('request.jwt.claims',
  '{"sub": "91000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from league_weeks where league_id = 'b1000000-0000-4000-8000-000000000008'), 0,
  'a NON-member (u3) sees 0 league_weeks rows');
select is((select count(*)::int from matchups where league_id = 'b1000000-0000-4000-8000-000000000008'), 0,
  '…and 0 matchups');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select is((select count(*)::int from matchups where league_id = 'b1000000-0000-4000-8000-000000000008'), 0,
  'anon sees 0 matchups');
reset role;

-- §M: the settings PATCH on an engine-shrunk league refuses by the STATUS gate.
select set_config('request.jwt.claims',
  '{"sub": "91000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select regular_season_weeks, playoff_start_week, status from leagues where id = 'b1000000-0000-4000-8000-000000000008' $$,
  $$ values (6, 7, 'in_season') $$,
  '§M: the commissioner reads the engine-written row (6, 7) at in_season');
select throws_like(
  $$ select public.update_league_settings(
       'b1000000-0000-4000-8000-000000000008', 8,
       (select settings from leagues where id = 'b1000000-0000-4000-8000-000000000008'),
       (select roster_settings from leagues where id = 'b1000000-0000-4000-8000-000000000008'),
       null, 'redraft', 6, 6, 7, 'faab', 100, 'commissioner', 6, 'per_player_kickoff') $$,
  '%is in in_season — settings are locked once the draft starts%',
  '§M MEASURED: a settings PATCH carrying the effective row (6/7 — outside 13–16) refuses by the STATUS gate, never reaching the 105 range check — which is why 110 leaves that check unchanged (creation/edit keep 12–15 / 13–16)');
reset role;

select * from finish();
rollback;
