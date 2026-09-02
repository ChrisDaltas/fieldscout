-- ============================================================================
-- The schedule engine + `league_weeks` population + completion wiring —
-- migration 110 (task L.D1.2, the M4 schema lane's second task;
-- tasks-M4-inseason.md §6 L.D1.2 as amended 2026-09-02 + §7 row 110; spec
-- spec-redraft-leagues.md v2.16.12 §7.3.1 (the amended `divisions` /
-- `regular_season_weeks` / `playoff_start_week` rows), §7.3.8 (the ≤ 18
-- bullet's league-week scope + the schedule-invariants bullet), §11.4 (the
-- generation trigger), §11.7 **Generation** + **Mid-season entry** (the
-- normative Q29/Q31 block), §12.8, §12.17, §12.20; PROGRESS §3 Q29 / Q30 (d)
-- / Q31 (b); D288 (a league week IS an NFL week), D289 (the engine lives in
-- SQL, one implementation), D291 (`p_now` injection), D305 (the ruling
-- application + the one-step playoff-drop derivation); ledger F4, F130,
-- F143, F213, F214 (R703/R704), F215; D306 (this task's build mechanics).
--
-- Numbering: migration head measured `109_inseason_tables.sql` at task time
-- (`ls supabase/migrations/ | tail -1`) ⇒ **110**; pgTAP head
-- `057_inseason_tables.sql` ⇒ **058** — the tasks-M4 §7 reservations
-- CONFIRMED, not inherited (D161/D166).
--
-- WHAT SHIPS HERE (in file order):
--
--   1. F213 — TAKEN. `matchups` and `team_week_results` gain a composite
--      FK `(league_id, season, week) → league_weeks(league_id, season, week)`
--      (056's UNIQUE is the target). "Every matchup week has a league_weeks
--      row" becomes schema-enforced, and the engine's write order (weeks
--      BEFORE matchups) is enforced by the schema rather than by discipline.
--      Transitively (056:70), every matchup week is an NFL week — R704's
--      week-range hole (`week 0 / 99`) closes with it. Both tables are EMPTY
--      on every chain-built database (109 created them; nothing wrote them),
--      so the constraint is additive. R704's SAME-LEAGUE team FK and the
--      `on_waivers ⇒ waivers_until` CHECK are NOT taken here: the engine
--      generates from the league's own `teams` rows (same-league by
--      construction, pinned in 058), and the first path that could seat a
--      foreign team or write a pool row is a WRITER RPC (111's manual
--      matchup edit / 113's pool writers) — routed to those tasks by ledger
--      F222, with the refusal to be pinned where the writer lands.
--
--   2. F4 — DISCHARGED. `league_weeks` gets its first writer here (item 4
--      below), so the legal-transition guard lands here too (056:24–29's
--      own scope-cut): `league_weeks_transition_guard()` + trigger
--      `trg_league_weeks_transition` (BEFORE UPDATE OF status). Legal steps,
--      one per UPDATE: upcoming → live → correction_window → final, plus
--      the AUDITED REOPEN arm final → correction_window, which requires a
--      NEW `reopened_by_action_id` (non-NULL and distinct from the previous
--      one — every reopen carries its own audit id; M6's
--      `commissioner_actions` FK lands with that table, the 056 precedent).
--      Every other jump refuses by name (P0001). Same-status UPDATEs and
--      non-status UPDATEs pass; INSERTs are not constrained (a row is BORN
--      in a state — the engine births `upcoming`; a fixture may birth any
--      legal value). Plain trigger fn, `search_path = ''` (059's D49(3)
--      shape); fires for every role including service_role/postgres.
--
--   3. The engine's PURE core — plain functions, `search_path = ''`, triple
--      REVOKE (no client caller exists or will; the sweep and pgTAP reach
--      them as service_role/postgres):
--        * `schedule_lcg_next(bigint)` — Park–Miller minimal standard
--          (state × 48271 mod 2^31−1): an EXPLICIT integer LCG whose every
--          draw is a pure function of the previous state. Never `setseed()`
--          / `random()` (session-scoped, D289).
--        * `schedule_playoff_rounds(int)` — ⌈log2(playoff_teams)⌉ by an
--          integer doubling loop (no float log): 0→0, 2→1, 4→2, 6→3, 8→3,
--          10→4, 12→4 (= `derivePlayoffRounds`, league-settings.ts).
--        * `schedule_playoff_drop(int)` — D305(5)'s one-step derivation: the
--          LARGEST catalog value {0,2,4,6,8,10,12} with one fewer round:
--          12→8, 10→8, 8→4, 6→4, 4→2, 2→0.
--        * `schedule_fit_internal(first, rsw, pt, wpr)` — the §11.7 fit check
--          + SHRINK CHAIN, pure: while `first + rsw + rounds(pt) × wpr − 1 >
--          18`, shrink `rsw` first down to the FLOOR OF 4, then drop playoff
--          rounds one at a time via `schedule_playoff_drop`, and report
--          `fits = false` only when the floor + 0 playoffs still cannot end
--          by week 18 (NFL week 16+). Returns the effective plan + `shrunk`.
--        * `schedule_first_week_internal(season, p_now)` — Q29's mapping
--          through Q31 rider (2)'s datum: the smallest NFL week whose
--          `COALESCE(nfl_weeks.first_kickoff_at, min(nfl_games.kickoff_at) for
--          that week, nfl_weeks.starts_at)` is STRICTLY AHEAD of `p_now`
--          (at the datum instant itself the week is under way). NULL when no
--          week is ahead (the season is spent, or the calendar has no rows).
--        * `schedule_build_internal(team_ids[], seed, first_week, rsw,
--          second_opponent)` — §11.7 Generation, IMMUTABLE: sorts the ids
--          (input-order independence), Fisher–Yates over the LCG stream
--          (the seeded permutation), then the CIRCLE METHOD: team 1 fixed,
--          the other n−1 rotate; round r pairs positions (k, n+1−k). One
--          cycle = n−1 rounds is a 1-factorization of K_n (every pair exactly
--          once), so cycling the rotation gives balanced repeats (spread ≤ 1
--          — the first `rsw mod (n−1)` rounds of the next cycle repeat) with
--          every repeat exactly n−1 ≥ 7 weeks after the first meeting (≥ 3
--          holds by construction — pinned as a MEASURED minimum, not
--          assumed). Home/away: a pair's base side is decided by (round,
--          position) parity — stable per pair — and FLIPS on every later
--          meeting of that pair in that round_type (alternation within a
--          pairing, tracked per (pair, round_type) in a jsonb counter).
--          `second_opponent`: per week the LCG draws an offset 1..n−2 and the
--          `secondary` rows are ROUND (r + offset) mod (n−1) of the same
--          factorization — a different round of a 1-factorization shares no
--          edge with the primary round, so the derangement never pairs a
--          team with itself or its primary opponent (E40), and every team
--          appears exactly once per week per game type. NO DIVISIONS ARM
--          (Q30 (d)): the function has no divisions parameter and the engine
--          never reads the setting — pinned as IGNORED in 058.
--
--   4. `league_generate_schedule(p_league_id, p_now DEFAULT now())` — the
--      writer (D289/C60): league row locked FIRST (the house lock order),
--      status must be `in_season` (generation IS the in_season entry —
--      draft completion — and Remix/111 is the only regeneration path),
--      refuses a second run for the same season by name, reads the seated
--      franchises (`teams.status <> 'retired'`, ORDER BY id) and REQUIRES
--      exactly `team_count` of them, even (odd counts/byes are v1.1 — §7.3.1
--      / §11.7 "v1: even counts, no byes"), reads `schedule_mode` /
--      `second_opponent` / `playoff_weeks_per_round` / `schedule_seed` from
--      `leagues.settings` (`schedule_seed` joins the TS catalog in this PR;
--      a league without one — every pre-110 row — gets one MINTED here from
--      `gen_random_uuid()` bits and WRITTEN BACK so the schedule stays
--      auditable/reproducible), maps the first week, runs the fit chain, and
--      then in ONE transaction: writes the EFFECTIVE `regular_season_weeks` /
--      `playoff_teams` / `playoff_start_week = rsw + 1` back to `leagues`
--      when the plan shrank (Q31 rider (3); the UPDATE asserts exactly 1 row
--      — rule 10's loud emptiness), inserts the season's `league_weeks` rows
--      (`upcoming`, weeks first..last INCLUDING the playoff weeks — the plan
--      materialized, D288), and inserts the regular-season `matchups`
--      (`scheduled`; playoff rows are 116's at `playoff_start_week`). Row
--      counts are asserted against the arithmetic; `total_points` writes
--      ZERO matchup rows and says so BY NAME in the returned jsonb
--      (`matchups_reason = 'total_points'`) — never a silent empty.
--      Plain function, `search_path = ''`, triple REVOKE — callable only from
--      `draft_complete_internal` (and 111's Remix confirm when it lands).
--      `schedule_preview` (§5 sketch / §7 row 110) is NOT shipped here: its
--      diff semantics are Remix's (D289 — "the same generator run WITHOUT
--      writing"), and `schedule_build_internal` IS that generator; 111 wraps
--      it with the diff (ledger F222).
--
--   5. `draft_complete_internal` — DROP + CREATE from **086:394–454** (D137
--      head rule; the file text, never `pg_get_functiondef`). The signature
--      gains `p_now TIMESTAMPTZ DEFAULT now()` LAST and DEFAULTED (D291's
--      front door for the sim/harness — F215; DROP because CREATE OR REPLACE
--      cannot append a parameter, the 102/D201(2) shape — the REVOKE after
--      is therefore load-bearing again). THREE hunks over 086's text:
--      (a) the signature; (b) after the roster INSERT + status flip, inside
--      the NON-mock arm: `PERFORM public.league_generate_schedule(
--      v_draft.league_id, p_now)` — the C60 wiring; a mock still writes no
--      rosters, no transition, no schedule (§8.8); (c) the REVOKE on the new
--      signature. Q31 rider (1): completion SHRINKS silently (the engine's
--      chain) and refuses only when the plan cannot fit at all — which,
--      given `draft_start`'s pre-flight passed, means the draft itself
--      crossed NFL week 16's kickoff between start and completion (rare,
--      named in the engine's refusal, in-txn — the last pick aborts and the
--      board stands). Every 1-argument caller (`draft_apply_pick_internal`,
--      the auction award, `draft_end`) binds unchanged to `now()`. Audit
--      stamps (`completed_at`) keep `now()`: `p_now` is the CALENDAR datum
--      (the mapping instant), not a clock for bookkeeping columns.
--
--   6. `draft_start_internal` — DROP + CREATE from **098:164–438** (its
--      newest defining migration — `git grep` shows 066 → 084 → 092 → 098;
--      the file text). Q31 rider (1)'s loud PRE-FLIGHT. FOUR hunks over
--      098's text: (a) the signature gains `p_now TIMESTAMPTZ DEFAULT now()`
--      LAST and DEFAULTED (the wrapper `draft_start(uuid)` — 066:518, the
--      client-facing RPC — is UNTOUCHED and binds to the default: clients
--      never inject time; 068's tick arm and every other 2-argument call
--      bind unchanged); (b) two DECLARE lines; (c) the pre-flight block after
--      the capacity gate and before order resolution: map the first week at
--      `p_now`, run `schedule_fit_internal` on the STORED plan, and refuse
--      to START — by name, remedy in the message — a draft whose season
--      cannot fit even at the floor (NFL week 16+, or a season with no
--      calendar). Real drafts only (this internal already filters
--      `is_mock = FALSE`; mocks never generate). The block adds NO `FOR
--      UPDATE` and sits BELOW the 'schedule the draft first' gate, so 020's
--      R122 lock-count pin holds; (d) the REVOKE on the new signature. The
--      clock/deadline `now()` reads stay: the pre-flight is the only place
--      the CALENDAR enters this function.
--
--   7. F130 — DISCHARGED. `draft_resolve_order_internal` CREATE OR REPLACE
--      from **102:65–178** (the file text; same signature). ONE hunk: at the
--      head of the `IF p_pin_slot IS NOT NULL` branch, `p_pin_team IS NULL`
--      RAISES 22023 by name — a slot with no team was silently ignored (a
--      control that lies; R557). The mirror case (a team with no slot) is
--      unchanged: it is already ignored BY DESIGN (the pin applies only when
--      BOTH arrive — 102's contract; `create_mock_draft` passes both or
--      neither) and F130 names only the slot-without-team hole.
--
--   8. F143 — DISCHARGED. `leagues_snapshot_guard()` CREATE OR REPLACE from
--      **059:126–142** (its only definition; the file text). ONE hunk: a
--      second arm refuses `scoring_system_id IS NULL` while `status ∈
--      drafting|in_season|playoffs|complete` — §7.3.8's "exactly one scoring
--      system referenced" half, a LIFECYCLE rule that belongs with the guard
--      that already owns `status` (not with 104's document walls, which
--      return early on NULL by design). The trigger
--      `trg_leagues_snapshot_guard` (BEFORE INSERT OR UPDATE) is NOT
--      recreated — 013's definition pin holds byte-for-byte.
--
-- WHAT IS DELIBERATELY NOT CHANGED — the 060/077 `create_league` and 105
-- `update_league_settings` range checks (§7.3.1's "the SQL range checks
-- accept engine-written effective rows"). MEASURED, not assumed: both are
-- checks on RPC PARAMETERS at creation / pre-draft edit — neither ever reads
-- a stored row — and `update_league_settings` is STATUS-GATED to
-- `setup|scheduled` (105:895–900), so an engine-written row (which exists
-- only at `in_season`+) can never reach either check. They therefore already
-- "accept" engine-written rows (vacuously) while creation and settings edits
-- keep 12–15 / 13–16 exactly as the ruling requires; relaxing a parameter
-- check that no engine-written row can reach would weaken creation for
-- nothing (never-weaken). Pinned in 058 §M: a stored rsw-4 / psw-5 row lives
-- (no table CHECK bounds the columns — 040 added none), and a settings PATCH
-- against that league refuses by the STATUS gate. M6's post-draft override
-- path inherits the effective ranges when it is built (F222). The TS half —
-- `mergeSettings`' Zod `min(12)` / `min(13)`, which DOES read stored rows and
-- WOULD throw on a shrunk league (Q31's measured hazard) — is relaxed in this
-- PR to `min(4)` / `min(5)`, with the 12–15 / 13–16 creation-and-edit ranges
-- moved to `validateLeagueSettings` (the validator every create/PATCH runs).
--
-- F215 — DISCHARGED across this PR: `draft_complete_internal` gains `p_now`
-- (above); every pgTAP fixture that completes a REAL draft pins the calendar
-- it lands on inside its own rolled-back transaction (one UPDATE moving
-- `nfl_weeks` season 2026 far-future — banner-noted per file: 020/026/035/
-- 036/041); the stack suites that reach `in_season` create their leagues on
-- a SYNTHETIC season seeded into `nfl_weeks` by a shared helper; the sim
-- runner and the e2e harness do the same. No fixture depends on the wall
-- clock. The measurement (which of F215's 18 files actually REACH
-- completion) is recorded in PROGRESS D306.
--
-- R694/F202 guard-arm note: n/a — nothing here copies 107's column-DEFAULT
-- drift guard; every replaced function is authored against its head FILE
-- TEXT with the provenance + hunk count above (D137).
--
-- Migration checklist (§8.1; tasks-M4 §4 rule 5): additive — two FKs on
-- empty tables, one trigger, seven new functions, four replaced functions;
-- RLS unchanged (no new table; `league_weeks`/`matchups` keep their member
-- SELECT and NO client write policy — the engine writes as a plain function
-- inside the SECURITY DEFINER completion RPCs; R6 waiver: function bodies +
-- constraints only); grants doctrine (D18→D23): no per-object GRANT on any
-- table; every new function triple-REVOKEd (`FROM PUBLIC, anon,
-- authenticated`) and every DROP+CREATE re-REVOKEd; realtime: NO trigger
-- added — D296 lands `league_weeks`' broadcast in 117 with the write door it
-- serves (the D38 shape, landing named), and `matchups`' `scores_updated`
-- carrier is 117's too; typegen RE-RUN (new/changed function signatures +
-- the two FK relationships) with the hand-written alias block re-appended,
-- additive-only diff attested in the PR. §8.1 staging-rehearsal waiver (R6
-- go-forward rule): no staging clone exists; the rehearsal evidence is the
-- fresh local `npx supabase db reset` replay of 001–110 + the full pgTAP
-- suite (000–058) + the stack-backed vitest suites incl. the ≥ 200-draw
-- property sweep, recorded in this PR's session-log row, plus CI's
-- from-scratch replay. Prod-safe: nothing here touches a launch-surface
-- table (`lists`, `list_players`, `players`, `player_stats`, `profiles`).
-- Registered in supabase/HELD-FROM-PRODUCTION.txt (range → 082-110) in the
-- same PR (the closed-range rule).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. F213 — composite week FKs (matchups / team_week_results → league_weeks)
-- ---------------------------------------------------------------------------
ALTER TABLE matchups
  ADD CONSTRAINT matchups_league_week_fkey
  FOREIGN KEY (league_id, season, week)
  REFERENCES league_weeks (league_id, season, week);

ALTER TABLE team_week_results
  ADD CONSTRAINT team_week_results_league_week_fkey
  FOREIGN KEY (league_id, season, week)
  REFERENCES league_weeks (league_id, season, week);

-- ---------------------------------------------------------------------------
-- 2. F4 — league_weeks legal-transition guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_weeks_transition_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Same-status UPDATE (a re-stamp, a median write) is not a transition.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- The forward chain, one step per UPDATE (F4; §12.17; §23.4).
  IF (OLD.status = 'upcoming'          AND NEW.status = 'live')
  OR (OLD.status = 'live'              AND NEW.status = 'correction_window')
  OR (OLD.status = 'correction_window' AND NEW.status = 'final') THEN
    RETURN NEW;
  END IF;

  -- The audited reopen (§11.4 "a final matchup is only changed via a
  -- commissioner override", §12.17 reopened_by_action_id): final →
  -- correction_window, and ONLY with a NEW audit id on the same UPDATE.
  IF OLD.status = 'final' AND NEW.status = 'correction_window' THEN
    IF NEW.reopened_by_action_id IS NULL
       OR NEW.reopened_by_action_id IS NOT DISTINCT FROM OLD.reopened_by_action_id THEN
      RAISE EXCEPTION
        'league_weeks %: reopening a final week (season % week %) requires a NEW reopened_by_action_id on the same UPDATE — a reopen is an audited commissioner action (§12.17/F4)',
        NEW.id, NEW.season, NEW.week
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'league_weeks %: illegal status transition % → % (season % week %) — legal steps are upcoming → live → correction_window → final, plus the audited reopen final → correction_window (§12.17/F4)',
    NEW.id, OLD.status, NEW.status, NEW.season, NEW.week
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE EXECUTE ON FUNCTION league_weeks_transition_guard()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_league_weeks_transition
  BEFORE UPDATE OF status ON league_weeks
  FOR EACH ROW
  EXECUTE FUNCTION league_weeks_transition_guard();

-- ---------------------------------------------------------------------------
-- 3. The pure core
-- ---------------------------------------------------------------------------

-- 3a. Park–Miller minimal-standard LCG: the ONE randomness source of the
--     engine. State ∈ [1, 2^31−2]; the product fits a bigint (48271 × 2^31 ≪
--     2^63). Pure — the same state always yields the same next state.
CREATE OR REPLACE FUNCTION schedule_lcg_next(p_state BIGINT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (p_state * 48271) % 2147483647;
$$;

REVOKE EXECUTE ON FUNCTION schedule_lcg_next(BIGINT)
  FROM PUBLIC, anon, authenticated;

-- 3b. ⌈log2(playoff_teams)⌉ by integer doubling (no float log). Mirrors
--     league-settings.ts `derivePlayoffRounds` value-for-value.
CREATE OR REPLACE FUNCTION schedule_playoff_rounds(p_playoff_teams INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_rounds INTEGER := 0;
  v_size   INTEGER := 1;
BEGIN
  IF p_playoff_teams IS NULL OR p_playoff_teams < 2 THEN
    RETURN 0;
  END IF;
  WHILE v_size < p_playoff_teams LOOP
    v_size := v_size * 2;
    v_rounds := v_rounds + 1;
  END LOOP;
  RETURN v_rounds;
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_playoff_rounds(INTEGER)
  FROM PUBLIC, anon, authenticated;

-- 3c. One playoff-round drop (D305(5)): the LARGEST §7.3.1 catalog value
--     with exactly one fewer round. 12→8, 10→8, 8→4, 6→4, 4→2, 2→0.
--     NULL for 0 (nothing left to drop — the caller refuses before asking).
CREATE OR REPLACE FUNCTION schedule_playoff_drop(p_playoff_teams INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT max(v)::int
  FROM unnest(ARRAY[0, 2, 4, 6, 8, 10, 12]) AS v
  WHERE public.schedule_playoff_rounds(v) = public.schedule_playoff_rounds(p_playoff_teams) - 1
    AND public.schedule_playoff_rounds(p_playoff_teams) >= 1;
$$;

REVOKE EXECUTE ON FUNCTION schedule_playoff_drop(INTEGER)
  FROM PUBLIC, anon, authenticated;

-- 3d. The §11.7 Mid-season entry fit check + shrink chain, pure.
--     last = first + rsw + rounds(pt) × wpr − 1 must be ≤ 18.
--     (1) rsw shrinks first, to the FLOOR of 4; (2) then playoff rounds drop
--     one at a time; (3) fits = false only when 4 + 0 still cannot end by 18.
CREATE OR REPLACE FUNCTION schedule_fit_internal(
  p_first_week INTEGER,
  p_regular_season_weeks INTEGER,
  p_playoff_teams INTEGER,
  p_playoff_weeks_per_round INTEGER
) RETURNS TABLE (
  regular_season_weeks INTEGER,
  playoff_teams INTEGER,
  playoff_rounds INTEGER,
  last_week INTEGER,
  fits BOOLEAN,
  shrunk BOOLEAN
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_rsw  INTEGER := p_regular_season_weeks;
  v_pt   INTEGER := p_playoff_teams;
  v_wpr  INTEGER := p_playoff_weeks_per_round;
  v_last INTEGER;
  v_fits BOOLEAN := TRUE;
BEGIN
  IF p_first_week IS NULL OR p_first_week < 1 OR p_first_week > 18 THEN
    RAISE EXCEPTION 'schedule_fit_internal: first week % is not an NFL week (1–18)', p_first_week
      USING ERRCODE = '22023';
  END IF;
  IF v_rsw IS NULL OR v_rsw < 1 THEN
    RAISE EXCEPTION 'schedule_fit_internal: regular_season_weeks % must be ≥ 1', v_rsw
      USING ERRCODE = '22023';
  END IF;
  IF v_pt IS NULL OR v_pt < 0 THEN
    RAISE EXCEPTION 'schedule_fit_internal: playoff_teams % must be ≥ 0', v_pt
      USING ERRCODE = '22023';
  END IF;
  IF v_wpr IS NULL OR v_wpr NOT IN (1, 2) THEN
    RAISE EXCEPTION 'schedule_fit_internal: playoff_weeks_per_round % must be 1 or 2 (§7.3.1)', v_wpr
      USING ERRCODE = '22023';
  END IF;

  LOOP
    v_last := p_first_week + v_rsw + public.schedule_playoff_rounds(v_pt) * v_wpr - 1;
    EXIT WHEN v_last <= 18;
    IF v_rsw > 4 THEN
      v_rsw := v_rsw - 1;                       -- (1) the regular season, down to the floor
    ELSIF v_pt > 0 THEN
      v_pt := public.schedule_playoff_drop(v_pt); -- (2) one playoff round at a time
    ELSE
      v_fits := FALSE;                          -- (3) 4 + 0 cannot fit: refuse
      EXIT;
    END IF;
  END LOOP;

  regular_season_weeks := v_rsw;
  playoff_teams        := v_pt;
  playoff_rounds       := public.schedule_playoff_rounds(v_pt);
  last_week            := v_last;
  fits                 := v_fits;
  shrunk               := (v_rsw <> p_regular_season_weeks OR v_pt <> p_playoff_teams);
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_fit_internal(INTEGER, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- 3e. Q29's mapping through Q31 rider (2)'s datum: the next NFL week whose
--     first kickoff is STILL AHEAD of p_now. Each COALESCE arm is a distinct
--     datum (first_kickoff_at → min nfl_games.kickoff_at → starts_at); the
--     last is the conservative Wednesday-00:00 fallback (a league can map
--     one week LATER than the letter, never to a week already under way).
--     NULL ⇒ no week ahead.
CREATE OR REPLACE FUNCTION schedule_first_week_internal(
  p_season INTEGER,
  p_now TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT min(w.week)::int
  FROM public.nfl_weeks w
  WHERE w.season = p_season
    AND COALESCE(
          w.first_kickoff_at,
          (SELECT min(g.kickoff_at) FROM public.nfl_games g
            WHERE g.season = w.season AND g.week = w.week),
          w.starts_at
        ) > p_now;
$$;

REVOKE EXECUTE ON FUNCTION schedule_first_week_internal(INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- 3f. §11.7 Generation — the pure round-robin builder (no writes, no reads).
CREATE OR REPLACE FUNCTION schedule_build_internal(
  p_team_ids UUID[],
  p_seed BIGINT,
  p_first_week INTEGER,
  p_regular_season_weeks INTEGER,
  p_second_opponent BOOLEAN
) RETURNS TABLE (
  week INTEGER,
  round_type TEXT,
  home_team_id UUID,
  away_team_id UUID
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_ids    UUID[];
  v_n      INTEGER;
  v_m      INTEGER;                 -- rounds per cycle = n − 1
  v_state  BIGINT;
  v_i      INTEGER;
  v_j      INTEGER;
  v_tmp    UUID;
  v_w      INTEGER;
  v_r      INTEGER;
  v_r2     INTEGER;
  v_off    INTEGER;
  v_k      INTEGER;
  v_a      UUID;
  v_b      UUID;
  v_rt     TEXT;
  v_key    TEXT;
  v_cnt    INTEGER;
  v_base_a BOOLEAN;
  v_meet   JSONB := '{}'::jsonb;    -- "<min>|<max>|<round_type>" → prior meetings
  v_rounds INTEGER[];
  v_types  TEXT[];
  v_q      INTEGER;
BEGIN
  -- Input-order independence: the SORTED id list is the input the seed
  -- permutes, so two callers passing the same set in different orders get
  -- the same schedule (pinned).
  SELECT array_agg(t ORDER BY t) INTO v_ids FROM unnest(p_team_ids) AS t;
  v_n := COALESCE(array_length(v_ids, 1), 0);

  IF v_n < 2 OR v_n % 2 <> 0 THEN
    RAISE EXCEPTION
      'schedule_build_internal: % teams — v1 schedules even counts only (8/10/12/14/16 — §7.3.1; byes are v1.1)',
      v_n
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT t) FROM unnest(v_ids) AS t) <> v_n THEN
    RAISE EXCEPTION 'schedule_build_internal: duplicate team id in the input'
      USING ERRCODE = '22023';
  END IF;
  IF p_regular_season_weeks IS NULL OR p_regular_season_weeks < 1 THEN
    RAISE EXCEPTION 'schedule_build_internal: regular_season_weeks % must be ≥ 1', p_regular_season_weeks
      USING ERRCODE = '22023';
  END IF;
  IF p_first_week IS NULL OR p_first_week < 1 THEN
    RAISE EXCEPTION 'schedule_build_internal: first week % must be ≥ 1', p_first_week
      USING ERRCODE = '22023';
  END IF;
  IF p_second_opponent AND v_n < 4 THEN
    RAISE EXCEPTION
      'schedule_build_internal: second_opponent needs at least 4 teams (a %-team week has no second pairing that avoids the primary opponent — E40)',
      v_n
      USING ERRCODE = '22023';
  END IF;

  v_m := v_n - 1;

  -- Seed → LCG state in [1, 2^31−2] (negative seeds fold in; 0 maps to 1).
  v_state := ((p_seed % 2147483646) + 2147483646) % 2147483646 + 1;

  -- The seeded permutation: Fisher–Yates over the LCG stream (D289).
  FOR v_i IN REVERSE v_n..2 LOOP
    v_state := public.schedule_lcg_next(v_state);
    v_j := (v_state % v_i)::int + 1;
    v_tmp := v_ids[v_i];
    v_ids[v_i] := v_ids[v_j];
    v_ids[v_j] := v_tmp;
  END LOOP;

  FOR v_w IN 0..p_regular_season_weeks - 1 LOOP
    v_r := v_w % v_m;
    v_rounds := ARRAY[v_r];
    v_types  := ARRAY['regular'];

    IF p_second_opponent THEN
      -- A different round of the same 1-factorization: offset 1..n−2 keeps
      -- r2 ≠ r, so no edge of the primary round recurs (E40 by construction,
      -- pinned by measurement in 058 / the sweep).
      v_state := public.schedule_lcg_next(v_state);
      v_off := (v_state % (v_n - 2))::int + 1;
      v_r2 := (v_r + v_off) % v_m;
      v_rounds := array_append(v_rounds, v_r2);
      v_types  := array_append(v_types, 'secondary');
    END IF;

    FOR v_q IN 1..array_length(v_rounds, 1) LOOP
      v_r  := v_rounds[v_q];
      v_rt := v_types[v_q];
      -- Circle method: position 1 fixed (v_ids[1]); positions 2..n hold the
      -- other n−1 teams rotated by r. Pair k = (position k, position n+1−k).
      FOR v_k IN 1..(v_n / 2) LOOP
        v_a := CASE WHEN v_k = 1 THEN v_ids[1]
                    ELSE v_ids[((v_k - 2 + v_r) % v_m) + 2] END;
        v_b := v_ids[((v_n + 1 - v_k - 2 + v_r) % v_m) + 2];

        -- Base side by (round, position) parity — stable per pair, since a
        -- pair meets at exactly one (round, position) of the factorization —
        -- flipped on every later meeting of the pair in this round_type.
        v_base_a := ((v_r + v_k) % 2 = 0);
        v_key := least(v_a::text, v_b::text) || '|' || greatest(v_a::text, v_b::text) || '|' || v_rt;
        v_cnt := COALESCE((v_meet ->> v_key)::int, 0);
        v_meet := jsonb_set(v_meet, ARRAY[v_key], to_jsonb(v_cnt + 1), TRUE);
        IF (v_cnt % 2 = 1) THEN
          v_base_a := NOT v_base_a;
        END IF;

        week         := p_first_week + v_w;
        round_type   := v_rt;
        home_team_id := CASE WHEN v_base_a THEN v_a ELSE v_b END;
        away_team_id := CASE WHEN v_base_a THEN v_b ELSE v_a END;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_build_internal(UUID[], BIGINT, INTEGER, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. league_generate_schedule — the writer (D289/C60; §11.4; §11.7)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_generate_schedule(
  p_league_id UUID,
  p_now TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_ids         UUID[];
  v_n           INTEGER;
  v_settings    JSONB;
  v_mode        TEXT;
  v_second      BOOLEAN;
  v_wpr         INTEGER;
  v_seed        BIGINT;
  v_seed_minted BOOLEAN := FALSE;
  v_first       INTEGER;
  v_fit         RECORD;
  v_cnt         INTEGER;
  v_weeks       INTEGER;
  v_rows        INTEGER := 0;
  v_expected    INTEGER;
BEGIN
  -- Lock order: the league row FIRST (tasks-M4 §4 rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_generate_schedule: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Generation IS the in_season entry (§11.4 "on draft completion"); the
  -- caller (draft_complete_internal) flips status first. Remix (111) is the
  -- only regeneration path.
  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION
      'league_generate_schedule: league % is % — the schedule is generated once, at in_season entry (draft completion, §11.4/§11.7); regeneration is Remix''s (L.D1.3)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_weeks w
             WHERE w.league_id = p_league_id AND w.season = v_league.season) THEN
    RAISE EXCEPTION
      'league_generate_schedule: league % already has league_weeks rows for season % — generation runs once; regeneration is Remix''s (L.D1.3)',
      p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;

  -- The seated franchises (same-league by construction — this is the only
  -- team source; ORDER BY id so the input is stable before the seed acts).
  SELECT array_agg(t.id ORDER BY t.id), count(*)::int
    INTO v_ids, v_n
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_n <> v_league.team_count THEN
    RAISE EXCEPTION
      'league_generate_schedule: league % has % of % franchises seated — every seat must exist before a schedule can be generated (§7.2/D96)',
      p_league_id, v_n, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;
  IF v_n < 2 OR v_n % 2 <> 0 THEN
    RAISE EXCEPTION
      'league_generate_schedule: league % has % franchises — v1 schedules even counts only (8/10/12/14/16 — §7.3.1; byes are v1.1)',
      p_league_id, v_n
      USING ERRCODE = 'P0001';
  END IF;

  -- Settings (long-tail JSONB — §12.1). `divisions` is deliberately NOT read
  -- (Q30 (d): pinned at 1; the engine ignores the value — F221).
  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  IF v_mode NOT IN ('h2h', 'total_points') THEN
    RAISE EXCEPTION
      'league_generate_schedule: league % has schedule_mode % — expected h2h or total_points (§7.3.1)',
      p_league_id, v_mode
      USING ERRCODE = 'P0001';
  END IF;
  v_second := COALESCE((v_settings ->> 'second_opponent')::boolean, FALSE);
  v_wpr := COALESCE((v_settings ->> 'playoff_weeks_per_round')::int, 1);
  v_seed := (v_settings ->> 'schedule_seed')::bigint;
  IF v_seed IS NULL THEN
    -- Mint (31 bits from gen_random_uuid — never random()/setseed(), D289)
    -- and write it back below so the schedule stays reproducible/auditable.
    v_seed := (('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::int)::bigint & 2147483647;
    v_seed_minted := TRUE;
  END IF;

  -- Q29: the first week, at the injected instant (D291).
  v_first := public.schedule_first_week_internal(v_league.season, p_now);
  IF v_first IS NULL THEN
    RAISE EXCEPTION
      'league_generate_schedule: league % — no NFL week of season % has a first kickoff still ahead of % (the season is over, or nfl_weeks carries no rows for it); the season cannot be scheduled (§11.7 Mid-season entry, Q29)',
      p_league_id, v_league.season, p_now
      USING ERRCODE = 'P0001';
  END IF;

  -- Q31: the fit check + shrink chain on the STORED plan.
  SELECT f.* INTO v_fit
  FROM public.schedule_fit_internal(
         v_first, v_league.regular_season_weeks, v_league.playoff_teams, v_wpr) f;
  IF NOT v_fit.fits THEN
    RAISE EXCEPTION
      'league_generate_schedule: league % would enter the season at NFL week % — even the 4-week floor with no playoffs ends at week % (> 18). The draft started while the season still fit and completed after NFL week 16''s kickoff, so the season cannot be scheduled (§11.7 Mid-season entry, Q31 rider (1)); create the league for next season',
      p_league_id, v_first, v_fit.last_week
      USING ERRCODE = 'P0001';
  END IF;

  -- Q31 rider (3): the typed columns hold the EFFECTIVE plan; continuity
  -- (playoff_start_week = rsw + 1, Q10) kept in league-week terms. The seed
  -- is written back when minted. Exactly one row, asserted (rule 10).
  IF v_fit.shrunk OR v_seed_minted THEN
    UPDATE public.leagues
    SET regular_season_weeks = v_fit.regular_season_weeks,
        playoff_teams        = v_fit.playoff_teams,
        playoff_start_week   = v_fit.regular_season_weeks + 1,
        settings             = CASE WHEN v_seed_minted
                                 THEN jsonb_set(v_settings, ARRAY['schedule_seed'], to_jsonb(v_seed), TRUE)
                                 ELSE settings END,
        updated_at           = now()
    WHERE id = p_league_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION
        'league_generate_schedule: the effective-plan write-back touched % rows for league % (expected exactly 1)',
        v_cnt, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The season's league_weeks rows — the table's FIRST writer (§12.17; F4's
  -- guard above). Regular AND playoff weeks: the plan, materialized (D288).
  INSERT INTO public.league_weeks (league_id, season, week, status)
  SELECT p_league_id, v_league.season, g, 'upcoming'
  FROM generate_series(v_first, v_fit.last_week) AS g;
  GET DIAGNOSTICS v_weeks = ROW_COUNT;
  v_expected := v_fit.last_week - v_first + 1;
  IF v_weeks <> v_expected THEN
    RAISE EXCEPTION
      'league_generate_schedule: wrote % league_weeks rows for league %, expected % (weeks %..%)',
      v_weeks, p_league_id, v_expected, v_first, v_fit.last_week
      USING ERRCODE = 'P0001';
  END IF;

  -- Regular-season matchups (§11.7 Generation). total_points: none, BY NAME.
  IF v_mode = 'h2h' THEN
    INSERT INTO public.matchups
      (league_id, season, week, round_type, home_team_id, away_team_id, status)
    SELECT p_league_id, v_league.season, b.week, b.round_type,
           b.home_team_id, b.away_team_id, 'scheduled'
    FROM public.schedule_build_internal(
           v_ids, v_seed, v_first, v_fit.regular_season_weeks, v_second) AS b;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_expected := v_fit.regular_season_weeks * (v_n / 2) * (CASE WHEN v_second THEN 2 ELSE 1 END);
    IF v_rows <> v_expected THEN
      RAISE EXCEPTION
        'league_generate_schedule: wrote % matchup rows for league %, expected % (% weeks × % pairings × % game types)',
        v_rows, p_league_id, v_expected, v_fit.regular_season_weeks, v_n / 2,
        CASE WHEN v_second THEN 2 ELSE 1 END
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'league_id',               p_league_id,
    'season',                  v_league.season,
    'first_week',              v_first,
    'last_week',               v_fit.last_week,
    'regular_season_weeks',    v_fit.regular_season_weeks,
    'playoff_teams',           v_fit.playoff_teams,
    'playoff_start_week',      v_fit.regular_season_weeks + 1,
    'playoff_rounds',          v_fit.playoff_rounds,
    'playoff_weeks_per_round', v_wpr,
    'shrunk',                  v_fit.shrunk,
    'schedule_seed',           v_seed,
    'seed_minted',             v_seed_minted,
    'schedule_mode',           v_mode,
    'second_opponent',         v_second,
    'league_weeks',            v_weeks,
    'matchups',                v_rows,
    'matchups_reason',         CASE WHEN v_mode = 'total_points' THEN 'total_points' ELSE NULL END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION league_generate_schedule(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. draft_complete_internal — DROP + CREATE from 086:394–454 (D137).
--    Hunks: (a) + p_now; (b) the PERFORM after the status flip; (c) REVOKE.
-- ---------------------------------------------------------------------------
DROP FUNCTION draft_complete_internal(UUID);

CREATE FUNCTION draft_complete_internal(
  p_draft_id UUID,
  -- 110/L.D1.2 (D291/F215): the calendar datum for the in_season entry —
  -- production callers pass nothing (now()); the sim/harness/pgTAP drive
  -- completion at a virtual instant. LAST and DEFAULTED so every 1-argument
  -- call text still binds.
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS public.drafts
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
BEGIN
  -- CALLER CONTRACT: the drafts row is held FOR UPDATE and the caller has
  -- already decided that the draft is finished. This helper asserts NOTHING
  -- about roster fullness — a PARTIAL board is a legal input (C41's
  -- end-as-is; L.C1.5's draft_end is the one sanctioned partial caller).
  UPDATE public.drafts SET
    status             = 'complete',
    completed_at       = now(),
    on_clock_team_id   = NULL,
    current_deadline   = NULL,
    current_nomination = NULL,     -- no-op for snake; hygiene for an auction
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_complete_internal: draft % not found', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- THE COMPLETION ARM (066's text, D111(3)-priced). NON-mock only: the
  -- §8.8 zero-side-effect contract keeps a mock at drafts.complete + recap
  -- — no rosters, no league transition (pinned from this side in 025/026).
  -- In THIS txn, under the caller's drafts-row lock (drafts → leagues —
  -- see 072's banner lock analysis):
  --   * league_rosters from the draft's non-undone picks
  --     (acquisition_type='draft'; **acquisition_cost = p.price** — D111(3)
  --     /§12.7: the auction's winning bid, and NULL on every snake row
  --     because draft_picks.price is NULL there, which is the literal NULL
  --     066 wrote. ONE expression, both engines). slot_key/IR columns stay
  --     NULL (M4's). The §12.7 UNIQUE(league_id, player_id) is the
  --     exclusivity backstop — a duplicate here means engine corruption and
  --     the 23505 aborts the completion LOUDLY (nothing to convert:
  --     uniq_draft_player_live makes it unreachable via any RPC path).
  --   * leagues.status = 'in_season' (§8.5 step 6 / §8.6.6). The D43
  --     snapshot guard fires on this UPDATE and holds — the snapshot has
  --     existed since draft_start (pinned in 026). 070's status-column
  --     trigger broadcasts the flip on league:<id> (home hero / draft bar).
  IF NOT v_draft.is_mock THEN
    INSERT INTO public.league_rosters
      (league_id, team_id, player_id, acquisition_type, acquisition_cost)
    SELECT p.league_id, p.team_id, p.player_id, 'draft', p.price
    FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id
      AND p.is_undone = FALSE;

    UPDATE public.leagues
    SET status = 'in_season', updated_at = now()
    WHERE id = v_draft.league_id;

    -- 110/L.D1.2 (C60/D289; §11.4 "on draft completion"): the schedule +
    -- the season's league_weeks rows, in THIS txn, at the injected instant.
    -- Q31 rider (1): the engine SHRINKS silently to fit; it refuses only
    -- when even the floor cannot fit — the draft crossed NFL week 16's
    -- kickoff between start (pre-flighted) and completion — and that
    -- refusal aborts this transaction: the last pick fails by name and the
    -- board stands. Mocks never reach here (§8.8).
    PERFORM public.league_generate_schedule(v_draft.league_id, p_now);
  END IF;

  RETURN v_draft;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_complete_internal(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. draft_start_internal — DROP + CREATE from 098:164–438 (D137).
--    Hunks: (a) + p_now; (b) two DECLAREs; (c) the pre-flight; (d) REVOKE.
-- ---------------------------------------------------------------------------
DROP FUNCTION draft_start_internal(UUID, BOOLEAN);

CREATE FUNCTION draft_start_internal(
  p_league_id UUID,
  p_require_commish BOOLEAN,
  -- 110/L.D1.2 (Q31 rider (1), D291): the instant the pre-flight evaluates
  -- the NFL calendar at. LAST and DEFAULTED — the draft_start wrapper and
  -- 068's tick arm bind unchanged to now(); pgTAP drives boundary instants.
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_draft        public.drafts;
  v_config       JSONB;
  v_order        JSONB;
  v_active_count INTEGER;
  v_total_rounds INTEGER;
  v_timer        INTEGER;
  v_first        UUID;
  -- 084 (L.C1.2) additions:
  v_type         TEXT;
  v_nom_order    JSONB;
  v_deadline     TIMESTAMPTZ;
  v_budget       INTEGER;
  v_reserve      INTEGER;
  v_bad_team     TEXT;
  v_bad_remaining INTEGER;
  v_bad_open     INTEGER;
  -- 110 (L.D1.2) additions — the §11.7 pre-flight:
  v_first_week   INTEGER;
  v_fit          RECORD;
BEGIN
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_start: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Re-gate under the league lock (R93); skipped for the system caller
  -- (068's tick — see draft_create_internal's note).
  IF p_require_commish AND NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'draft_start: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- PLAIN read for the idempotent arm — deliberately NOT locked (R122):
  -- taking the drafts-row lock here, while holding the leagues lock, races
  -- an in-flight draft_make_pick into a deadlock cycle — the pick holds the
  -- drafts row (its step 1) and its draft_picks INSERT takes an RI FOR KEY
  -- SHARE on the leagues row (the league_id FK, 065:152), which conflicts
  -- with our leagues lock. Live-proven 40P01 (the batch-2 R122 probe). The
  -- plain read is safe for the no-op arm: creates and starts serialize on
  -- the league lock held above, and the already-started shape's status
  -- truth is the LEAGUE row ('drafting'), read under its own lock.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused');

  -- Idempotent re-start (the D63 same-status class): a double-clicked
  -- Start must not error — even while a pick is mid-flight holding the
  -- drafts-row lock (R122: this arm returns without ever touching it). A
  -- started draft and its league move in ONE txn, so live/paused +
  -- 'drafting' is the only reachable already-started shape.
  IF FOUND AND v_draft.status IN ('live', 'paused') AND v_league.status = 'drafting' THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'started', FALSE);
  END IF;

  IF v_league.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'draft_start: league % is in % — schedule the draft first (League settings → Draft setup), then start it',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- CREATE-IF-ABSENT (the D94 no-dead-end principle on the manual path): a
  -- league scheduled purely through the settings surface has no drafts row;
  -- the idempotent create-internal supplies it. Same txn — the league lock
  -- is already held and simply re-entered. p_require_commish FALSE: this
  -- caller's authorization is already established (wrapper fast-fail + the
  -- re-gate above when required).
  IF v_draft.id IS NULL THEN
    PERFORM public.draft_create_internal(p_league_id, FALSE);
  END IF;

  -- NOW lock the draft row — BELOW the 'scheduled' gate (R122): with the
  -- league locked at 'scheduled', no pick's INSERT can be in flight on this
  -- draft (picks require 'live', and start moves draft + league in one txn
  -- under the league lock), so this lock can never complete the
  -- FK-KEY-SHARE cycle described above.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused')
  FOR UPDATE;

  -- Defensive: a live/paused draft under a non-'drafting' league is
  -- unreachable (start moves both in one txn) — refuse LOUDLY rather than
  -- silently resetting a live board to pick 1. (Also catches the
  -- can't-happen empty re-read after create-if-absent.)
  IF v_draft.id IS NULL OR v_draft.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'draft_start: draft % is % while league % is scheduled — inconsistent state; contact support',
      COALESCE(v_draft.id::text, '(missing)'), COALESCE(v_draft.status, '(missing)'), p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D95: RE-HYDRATE from live settings — the fidelity moment.
  v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);
  v_type   := COALESCE(v_config->>'draft_type', 'snake');

  -- 084 (L.C1.2): the M2 seam refusal that stood here (066:640–644 —
  -- "the auction engine lands in M3") is GONE; §8.6's engine begins with
  -- this migration. The gates below are shared by both draft types and are
  -- unchanged from 066 — an auction is capacity-gated, snapshot-gated and
  -- rounds-gated exactly like a snake draft.

  -- Capacity (§7.2/D96): every franchise must exist before the draft.
  -- Orphaned seats count (they draft on autopilot — E48); retired do not.
  -- The audited "draft short" override is M6's (F45).
  SELECT count(*) INTO v_active_count
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_active_count <> v_league.team_count THEN
    RAISE EXCEPTION
      'draft_start: league % has % of % franchises seated — every seat must exist before the draft starts; add placeholder seats for the empty slots (League home → Invite) or invite managers (§7.2/D96)',
      p_league_id, v_active_count, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  -- 110/L.D1.2 — THE §11.7 MID-SEASON PRE-FLIGHT (Q31 rider (1)). A draft
  -- whose season cannot fit AT START TIME is refused HERE, loudly, before
  -- any manager is on the clock — never at the last pick. Same datum, same
  -- chain as the engine (schedule_first_week_internal +
  -- schedule_fit_internal on the STORED plan), evaluated at p_now (D291).
  -- Only the cannot-fit-at-all case refuses; a plan that merely SHRINKS
  -- starts, and completion shrinks it silently (the engine's chain).
  v_first_week := public.schedule_first_week_internal(v_league.season, p_now);
  IF v_first_week IS NULL THEN
    RAISE EXCEPTION
      'draft_start: league % cannot start — no NFL week of season % has a first kickoff still ahead (the season is over, or the NFL calendar has no rows for it); create the league for next season (§11.7 Mid-season entry)',
      p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;
  SELECT f.* INTO v_fit
  FROM public.schedule_fit_internal(
         v_first_week, v_league.regular_season_weeks, v_league.playoff_teams,
         COALESCE((v_league.settings ->> 'playoff_weeks_per_round')::int, 1)) f;
  IF NOT v_fit.fits THEN
    RAISE EXCEPTION
      'draft_start: league % cannot start — the season would begin at NFL week %, and even a 4-week regular season with no playoffs would end at week % (> 18); the NFL season is too far along for this league (§11.7 Mid-season entry, Q31) — create the league for next season',
      p_league_id, v_first_week, v_fit.last_week
      USING ERRCODE = 'P0001';
  END IF;

  -- Order resolution (D101/D105/R123/R126) via the ONE implementation
  -- (draft_resolve_order_internal — extracted at L.B1.6 amendment (e),
  -- logic verbatim; 071's create_mock_draft is the second consumer):
  -- candidate = the draft row's stored order (a pre-start randomize/order
  -- edit — it wins so the order the lobby displayed is the order that
  -- drafts), config fallback manual/custom-only, seed = the draft row's
  -- own id, label 'draft_start' (every pinned message unchanged).
  -- An auction resolves it too: `same_as_draft_order` feeds from it, and
  -- the commissioner's pre-draft order surface is one surface (§8.3).
  v_order := public.draft_resolve_order_internal(
    p_league_id,
    v_league.team_count,
    COALESCE(v_config->>'draft_order_mode', 'random'),
    v_draft.draft_order,
    v_config->'draft_order',
    v_draft.id,
    'draft_start');

  -- 084: nomination order (§8.3/§7.3.8) — auction only; snake/linear leave
  -- the column NULL. 098/AP.5 (F80): the settings-catalog fallback rides in
  -- as the LAST argument — `manual` resolves candidate-then-settings, the
  -- exact shape the draft-order call above already has (D101/D201(1)).
  IF v_type = 'auction' THEN
    v_nom_order := public.draft_nomination_order_internal(
      p_league_id,
      v_league.team_count,
      COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order'),
      v_draft.nomination_order,
      v_order,
      v_draft.id,
      'draft_start',
      v_config->'nomination_order');
  END IF;

  -- D91: rounds = starters + bench (IR excluded). For an auction this is
  -- the per-team roster CAPACITY the open-slots math counts down (D126).
  v_total_rounds := public.draft_rounds_from_roster(v_league.roster_settings);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    RAISE EXCEPTION
      'draft_start: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Clock + first seat, per draft type.
  IF v_type = 'auction' THEN
    -- §7.3.8's own clocks. An untimed pick_timer_seconds = 0 (§8.2's soft
    -- timer) does NOT null this one — see the banner, item 3(c).
    v_deadline := now() + make_interval(
      secs => COALESCE((v_config->>'auction_nomination_seconds')::int, 30));
    v_first    := (v_nom_order->>0)::uuid;        -- the first NOMINATOR (D126)
  ELSE
    v_timer    := COALESCE((v_config->>'pick_timer_seconds')::int, 90);
    v_deadline := CASE WHEN v_timer > 0
                       THEN now() + make_interval(secs => v_timer)
                       ELSE NULL END;             -- §8.2 soft timer: 0 ⇒ no clock
    v_first    := public.draft_team_for_pick(
      v_order, v_type,
      COALESCE((v_config->>'snake_reversal')::boolean, FALSE), 1);
  END IF;

  -- Snapshot BEFORE the transition (D43/D64(2)): we are in 'scheduled' —
  -- exactly 059's sanctioned window. A league that cannot snapshot (no
  -- scoring reference) fails LOUDLY here and nothing below runs; the D43
  -- trigger on the leagues UPDATE is the backstop either way. The INTERNAL
  -- (059, amended alongside 068): the wrapper's commissioner gate would
  -- refuse the cron auto-start caller (no JWT) — this caller's
  -- authorization is already established (see the re-gate above).
  PERFORM public.snapshot_league_scoring_internal(p_league_id);

  UPDATE public.drafts SET
    status               = 'live',
    draft_type           = v_type,
    config               = v_config,
    draft_order          = v_order,
    nomination_order     = v_nom_order,  -- auction only; NULL for snake/linear
    current_nomination   = NULL,         -- D126: NULL ⇒ NOMINATING phase
    total_rounds         = v_total_rounds,
    current_round        = 1,
    current_pick_number  = 1,            -- doubles as nomination seq 1 (D126)
    on_clock_team_id     = v_first,
    current_deadline     = v_deadline,
    paused_at            = NULL,
    deadline_remaining_ms = NULL,
    started_at           = now(),
    completed_at         = NULL,
    updated_at           = now()
  WHERE id = v_draft.id
  RETURNING * INTO v_draft;

  -- 084: the §8.6.8 start-time backstop (banner item 4) — read through the
  -- ONE derivation family, on the LIVE row, before the league transitions.
  -- TWO messages, because there are two causes and one of them is not the
  -- settings knobs (R318). The derivation reads budget_adjustments (line
  -- 263), so a per-team §8.7 delta can make a settings-LEGAL league
  -- insolvent — and printing "a $200 budget cannot fill 15 roster spots at
  -- a $1 per-slot reserve" about a league whose budget clears that floor by
  -- $185 is arithmetically false and sends the commissioner to the wrong
  -- knob. The unit is named too: these are D91 DRAFTABLE slots (starters +
  -- bench), which is not the settings validator's roster size (it counts
  -- IR as well — league-settings.ts:539), so the two layers print two
  -- numbers for one league unless each says which it means.
  IF v_type = 'auction' AND NOT public.draft_auction_solvent(v_draft.id) THEN
    v_budget  := COALESCE((v_config->>'auction_budget')::int, 200);
    -- 092/AP.1: the reserve, through the ONE authority (D198(1)). With
    -- auction_zero_dollar_nominations ON this arm reads 0 and can no longer
    -- fire — correct, and NOT a reason to delete it (§8.6.8/D198(4)).
    v_reserve := public.draft_auction_reserve(v_config);
    IF v_budget < v_total_rounds * v_reserve THEN
      RAISE EXCEPTION
        'draft_start: league % cannot start an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
        p_league_id, v_budget, v_total_rounds, v_reserve
        USING ERRCODE = 'P0001';
    ELSE
      -- The settings floor HOLDS, so the shortfall is one franchise's own
      -- (a §8.7 budget adjustment; priced picks cannot exist on a
      -- 'scheduled' draft). Name the seat and its real numbers.
      SELECT t.name, b.remaining, b.open_slots
        INTO v_bad_team, v_bad_remaining, v_bad_open
      FROM public.teams t
      CROSS JOIN LATERAL public.draft_team_budget(v_draft.id, t.id) b
      WHERE t.league_id = p_league_id
        AND t.status <> 'retired'
        AND b.remaining < b.open_slots * v_reserve
      ORDER BY t.name, t.id
      LIMIT 1;
      RAISE EXCEPTION
        'draft_start: league % cannot start an auction — % has $% for % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency). The league''s $% auction budget clears that floor, so the shortfall is this franchise''s own: clear its commissioner budget adjustment (§8.7), or allow $0 nominations in League settings → Draft setup',
        p_league_id, v_bad_team, v_bad_remaining, v_bad_open, v_reserve, v_budget
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- draft_start's OWN transition under the D43 guard (059's banner: M2
  -- removes the M1 refusal only via this path — set_league_status is NOT
  -- widened).
  UPDATE public.leagues
  SET status = 'drafting', updated_at = now()
  WHERE id = p_league_id;

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'started', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_start_internal(UUID, BOOLEAN, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. F130 — draft_resolve_order_internal, CREATE OR REPLACE from 102:65–178
--    (D137; same signature). ONE hunk: the slot-without-team RAISE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_resolve_order_internal(
  p_league_id UUID,
  p_team_count INTEGER,
  p_mode TEXT,
  p_candidate JSONB,
  p_config_order JSONB,
  p_seed UUID,
  p_label TEXT,
  -- 102/MS.8 (D223): the launch-time slot pin — the human's franchise
  -- (p_pin_team) lands at exactly index p_pin_slot-1 and the OTHER seats
  -- keep the same md5(seed || id) shuffle around it. A CONSTRAINT on the
  -- one seeded shuffle, never a second randomizer (D223(5)). LAST and
  -- DEFAULTED so every 7-argument call text still binds — to NULL, which
  -- is exactly the pre-102 behaviour (the AP.5/D201(2) shape).
  p_pin_team UUID DEFAULT NULL,
  p_pin_slot INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_stored JSONB;
  v_valid  BOOLEAN;
  v_order  JSONB;
BEGIN
  -- Draft-row value wins over the settings field (D101); `random`
  -- considers ONLY the draft-row candidate (R123/R126 — the config
  -- fallback is manual/custom-only).
  v_stored := CASE
    WHEN jsonb_typeof(p_candidate) = 'array' THEN p_candidate
    WHEN p_mode IN ('manual', 'custom')
     AND jsonb_typeof(p_config_order) = 'array' THEN p_config_order
    ELSE NULL
  END;
  -- Permutation check, compared as TEXT (malformed entries fail
  -- validation, never a ::uuid cast — the R117 lesson).
  v_valid := v_stored IS NOT NULL AND (
    SELECT count(*) = p_team_count
       AND count(DISTINCT e.val) = p_team_count
       AND bool_and(EXISTS (
             SELECT 1 FROM public.teams t
             WHERE t.league_id = p_league_id
               AND t.status <> 'retired'
               AND t.id::text = e.val))
    FROM jsonb_array_elements_text(v_stored) AS e(val)
  );

  -- 102/MS.8: a slot pin is a constraint on a FRESH shuffle and nothing
  -- else. When a stored order would win — a drawn lobby order (D101) or a
  -- manual/custom settings order — the mock INHERITS it (§8.8 fidelity),
  -- so a requested slot is refused by name rather than silently ignored.
  -- Order-neutral wording on purpose: the nomination arm routes here too.
  IF p_pin_slot IS NOT NULL THEN
    -- 110/L.D1.2 (F130, R557): a slot with no team to pin is a control that
    -- lies — the branch below would silently ignore it. Refuse by name.
    IF p_pin_team IS NULL THEN
      RAISE EXCEPTION '%: pin slot % was given without a team to pin (p_pin_team is NULL)',
        p_label, p_pin_slot
        USING ERRCODE = '22023';
    END IF;
    IF p_pin_slot < 1 OR p_pin_slot > p_team_count THEN
      RAISE EXCEPTION '%: pin slot % is out of range for % teams',
        p_label, p_pin_slot, p_team_count
        USING ERRCODE = '22023';
    END IF;
    IF v_valid THEN
      RAISE EXCEPTION
        '%: a stored order already covers this league — a practice draft inherits it (§8.8/D223); launch without a slot to practice from the stored order',
        p_label
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_mode IN ('manual', 'custom') THEN
    IF NOT v_valid THEN
      RAISE EXCEPTION
        '%: league % has draft_order_mode=% but the stored draft order does not cover every active franchise exactly once — re-save the order in Draft setup (§8.3)',
        p_label, p_league_id, p_mode
        USING ERRCODE = 'P0001';
    END IF;
    v_order := v_stored;
  ELSE
    IF v_valid THEN
      -- D101: a pre-start randomize already wrote (and the lobby already
      -- showed) this order — honor it.
      v_order := v_stored;
    ELSE
      -- Deterministic seeded shuffle (D105): seed = the caller's draft id.
      IF p_pin_slot IS NULL THEN
        SELECT jsonb_agg(to_jsonb(t.id) ORDER BY md5(p_seed::text || t.id::text))
          INTO v_order
        FROM public.teams t
        WHERE t.league_id = p_league_id AND t.status <> 'retired';
      ELSE
        -- 102/MS.8 (D223(5)): the SAME shuffle over the other seats, then
        -- the pinned seat spliced in at its slot. Deterministic per
        -- (seed, slot): the md5 keys of the other seats do not change.
        SELECT COALESCE(
                 jsonb_agg(to_jsonb(t.id) ORDER BY md5(p_seed::text || t.id::text)),
                 '[]'::jsonb)
          INTO v_order
        FROM public.teams t
        WHERE t.league_id = p_league_id
          AND t.status <> 'retired'
          AND t.id <> p_pin_team;
        -- jsonb_insert places before index slot-1; index = array length
        -- (slot = N) appends — measured, both boundaries pinned (pgTAP 050).
        v_order := jsonb_insert(v_order, ARRAY[(p_pin_slot - 1)::text],
                                to_jsonb(p_pin_team));
      END IF;
    END IF;
  END IF;

  RETURN v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_resolve_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. F143 — leagues_snapshot_guard, CREATE OR REPLACE from 059:126–142
--    (D137). ONE hunk: the scoring_system_id detach arm. The trigger is
--    NOT recreated (013's definition pin).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION leagues_snapshot_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- §7.3.8: a league in drafting+ must ALWAYS have a non-null snapshot.
  -- Checked on the NEW row for INSERT and UPDATE alike — covers the forced
  -- transition, the born-in-drafting INSERT, and the snapshot-nulling UPDATE
  -- (D43: holds even against privileged paths; triggers ignore BYPASSRLS).
  IF NEW.status IN ('drafting', 'in_season', 'playoffs', 'complete')
     AND NEW.scoring_rules_snapshot IS NULL THEN
    RAISE EXCEPTION
      'league %: cannot be in status % without scoring_rules_snapshot — call snapshot_league_scoring first (spec §7.3.8/D43)',
      NEW.id, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  -- 110/L.D1.2 (F143, R619): §7.3.8's OTHER half — "exactly one scoring
  -- system referenced" — a league in drafting+ can never be DETACHED from
  -- its scoring system. A lifecycle rule, so it lives with the guard that
  -- owns status (not with 104's document walls, which return early on NULL
  -- by design).
  IF NEW.status IN ('drafting', 'in_season', 'playoffs', 'complete')
     AND NEW.scoring_system_id IS NULL THEN
    RAISE EXCEPTION
      'league %: cannot be in status % without a scoring system reference (scoring_system_id is NULL) — a drafting+ league always references exactly one scoring system (spec §7.3.8/F143)',
      NEW.id, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
