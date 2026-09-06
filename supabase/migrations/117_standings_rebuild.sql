-- ============================================================================
-- Standings + the derived-results rebuild — migration 117 (task L.D1.7;
-- tasks-M4-inseason.md §6 L.D1.7 + §7 row "~~115~~ → +1"; spec
-- spec-redraft-leagues.md v2.16.22 → v2.16.23 by this PR's fold-back —
-- §7.3.7 (the chain; both skip rules; PA higher wins; entry (5) inert per
-- Q30 (d); the seeded coin flip), §11.5 (standings computed from final
-- matchups, one table — no division grouping), §11.7 (PF once per week;
-- median/second results), §12.17 (`median_score`), §12.18 (the precedence
-- note: `matchups` is the source of truth, `team_week_results` derived and
-- rebuildable through `rebuild_team_week_results`), §22.2 (never an
-- overridden cell), §22.4 (the standings scan), §23.2, E38 / E39 / E63 /
-- E64; PROGRESS D137 (helpers CALLED, never copied — the D297 results math
-- is factored OUT of 116's `finalize_matchups` into three plain helpers
-- that finalization and the rebuild both call by name), D288 (league week
-- = NFL week), D291, D295 (the correction-window split: the door owns
-- open weeks, the rebuild owns final ones), D297 (standings are a computed
-- read; results are derived and rebuildable), D305 / F221 (divisions cut),
-- D313 (116's contracts, honoured verbatim), F241 (the finalize contracts —
-- unchanged here), F244 (DISCHARGED — the report-after-rollback, taken with
-- this replacement), F245 / F246 (filed); tasks-M4 §4 standing rules 1–11;
-- D314 (build mechanics).
--
-- Numbering: migration head measured 116 at task time (ls supabase/
-- migrations/ | tail -1) ⇒ 117, pgTAP head 064 ⇒ 065 — confirmed with
-- `ls`, not inherited (D161/D166; the §7 reservation shifted by 114/115,
-- D311(1)/D312(1)).
--
-- D137 PROVENANCE: `finalize_matchups` is CREATE OR REPLACE'd against the
-- CURRENT FILE TEXT of 116_week_workers.sql (file md5
-- 3728ee39c2fb305baa974357150a9668 at authoring — the PR #258 fix-round
-- text) — NOT against `pg_get_functiondef` (CLAUDE.md, migration
-- discipline). 116 is merged and NOT edited. The replacement was DERIVED
-- mechanically (`derive_117.py`, in the PR body): the function's text
-- extracted verbatim from 116 and SIX exact-match substitutions applied,
-- each asserted to hit exactly once — (1) two DECLARE hunks (the results
-- math's variables leave; `v_pend` / `v_w` and the F244 per-league locals
-- join), (2) the per-league prelude (median/first-week reads leave with the
-- math; the F244 locals reset before the subtransaction), (3) THE RESULTS
-- BLOCK — 116's (b)/(c)/(d) (pending checks, shape guards, the matchup flip
-- loop, the `team_week_results` INSERT, the total_points UPDATE, the median)
-- becomes: `week_results_pending_internal` (skip by name) → the flip loop
-- VERBATIM with its derivation lifted into `matchup_result_internal` → 
-- `week_results_write_internal`; (4)/(5) F244 — the league's count/report
-- accumulate in locals, the handler discards them, the merge happens after
-- the subtransaction commits. The script asserts that the INSERT, the
-- median arrays and every retired variable survive NOWHERE in the derived
-- body and that the three helpers, the override branch (`COALESCE(
-- v_m.result, v_res)`) and the F244 merge each appear exactly once. Every
-- other byte is 116's: the claim loop, the §23.2 gate, the F238 loud state,
-- the E43 note, the cron rows (untouched — 116 §6 stands; this file adds no
-- cron), the signature `(p_now, p_league_id)`, the JWT refusal, the REVOKE.
-- pgTAP 064 (140) runs UNCHANGED against the replaced body — the fixture
-- goldens (the 10-team week, the override cell, the exact-median tie, the
-- 95.01/95.02 week, `pending_scores` on an override, `pending_results`
-- partial + all-absent, E43, idempotence) are the proof that the factoring
-- is behaviour-preserving.
--
-- WHAT THIS MIGRATION DOES
--   1. `matchup_result_internal(home, away, away_team_id)` — the ONE E38
--      derivation (two decimals; a two-decimal tie is a tie; NULL for a
--      bye). IMMUTABLE SQL; plain; triple-REVOKEd.
--   2. `week_results_pending_internal(league, season, week)` — ONE reading
--      of "pending" for a closed week: h2h — a NULL score on ANY matchup,
--      overridden or not (R792/E61); total_points — ANY seated team with no
--      row (R788). NULL when clear, else the NAMED shape (`reason`,
--      `pending`[, `missing`]) 116's `skipped` list carried. Plain; REVOKEd.
--   3. `week_results_write_internal(league, season, week)` — THE results
--      math, 116's (b)-guards/(b)-INSERT/(c)-UPDATE/(d)-median lifted
--      verbatim: the h2h rows from the matchups AS WRITTEN (the stored
--      `result` — the flip's E38 derivation or the commissioner's override
--      — never recomputed from scores here; PF once; the `secondary` row
--      → second result), the total_points rows flipped `is_final`, the
--      EXACT median compared (E39) and its cells written; RETURNS (results,
--      teams, median). The ONE writer of a closed week's rows. Plain;
--      REVOKEd.
--   4. `finalize_matchups` — REPLACED (above): identical behaviour and
--      payload, the math by name, F244 fixed (a league whose LATER week
--      raises now reports `finalized 0` / `weeks []` for that league while
--      `failures` carries the cause — 065 pins it).
--   5. `rebuild_team_week_results(league, week)` — §12.18's rebuild RPC: a
--      FINAL week's rows re-derived from `matchups` through helper 3 (so
--      byte-identical to finalization's — 065 pins finalize → corrupt →
--      rebuild ≡ the finalized digest AND ≡ the standings); overrides
--      honoured exactly (the override cell's stored result lands, never
--      the scores' — pinned where the two differ); refuses BY NAME:
--      `week_not_final` (an open week is the door's — D295), the pending
--      shapes (`pending_scores` / `pending_results` — R788 holds here too,
--      nothing is zero-filled), `matchup_not_final`, `result_drift` (a
--      non-overridden final matchup whose stored result is not its scores'
--      E38 result — the rebuild reads the source of truth and never
--      repairs it; F245 hands L.E2 the duty to write `result` with a
--      score correction); writes `league_weeks.median_score` (the rounded
--      store). SECURITY DEFINER + search_path='' + triple REVOKE + the
--      in-body JWT refusal (42501): a rebuild is called by the service
--      role / the harness / M6's audited verbs in-body, never by a user.
--      Lock order: `leagues` FOR UPDATE, then `league_weeks`. Idempotent
--      by digest; `changed = false` ⇒ `reason = 'already_consistent'`.
--   6. `league_standings(league)` — the §7.3.7 chain as a computed read
--      over `team_week_results` (D297): ONE materialized scan of the
--      league's FINAL regular-season rows on `idx_twr_league_season`;
--      the combined record (h2h + median + second — §11.7), Win % exact,
--      PF once, PA = the primary opponent's points once (Σ PF ≡ Σ PA — a
--      missing opponent row is COUNTED and named, never a silent 0);
--      the stored `tiebreakers` array applied IN ORDER (the catalog's
--      remainder appended so the chain is total; validated — an unknown or
--      duplicate entry raises); head-to-head for a CLEAN two-team tie only
--      (a 3+ group skips to the next entry and is NAMED — E63; a
--      `total_points` league skips the entry by schedule_mode — E64, never
--      by the absence of data); Points Against HIGHER first (deliberate,
--      §7.3.7); `division_record` INERT (Q30 (d) — one table, no
--      grouping); `coin_flip` seeded on the league's stored
--      `schedule_seed` (md5 → 60 bits; the league id when none was ever
--      minted, named in the payload) — deterministic, never random();
--      `separated_by` on every row names the entry that placed it. Member
--      READ: SECURITY DEFINER + search_path='' + REVOKE FROM PUBLIC, anon;
--      in-body `is_league_member` (42501 — a non-member is refused by
--      name, never handed an empty table); the service role reads any
--      league. STABLE.
--
-- WHY THE FACTORING (D137 over "do not touch a working job"): the task's
-- own equivalence — `standings ≡ rebuild-from-scratch` — is a claim that
-- the rebuild produces the rows finalization produced. Two copies of the
-- math can only be PINNED equal today; one implementation called by name
-- is equal by construction AND is pinned (065: the digest of finalize's
-- rows = the digest of the rebuilt rows; probe 3 perturbs the rebuild by
-- one rounding step and the equivalence cells red).
--
-- LOCK-ORDER LAW (rule 8): the rebuild claims the LEAGUE row first (`FOR
-- UPDATE`), then the `league_weeks` row, then writes `team_week_results`
-- — the same order 110–116 use. `league_standings` takes no locks.
--
-- NEVER-WEAKEN CHECK (rule 9): no score is computed here (the rebuild
-- consumes the stored `matchups` scores; the standings consume stored
-- results); no `final` matchup is written by the rebuild — a disagreeing
-- one is REFUSED by name, not repaired; no overridden cell is recomputed —
-- its stored result lands exactly (pinned where the scores disagree);
-- `finalize_matchups`'s gates, claims, skips, the F4 flip and the E43 note
-- are 116's bytes; 064 runs unchanged.
--
-- FALSIFIABILITY (rule 9 / §4.3): pgTAP 065 — form pins (DEFINER /
-- search_path / the REVOKE shapes per function; the prosrc pins: finalize
-- calls the three helpers by name and no longer carries the INSERT — one
-- implementation; the rebuild's body never writes `matchups`); the
-- authority cells (a member reads, a non-member 42501, a JWT caller of the
-- rebuild 42501); a hand-built 6-team season as STORED LITERALS — the E63
-- three-way cycle (A beat B, B beat C, C beat A; equal Win % and PF)
-- resolved by PA with the skip NAMED, the clean two-team tie resolved by
-- head-to-head, the PA-direction pair (the higher-PA team FIRST when the
-- chain is reordered PA-before-H2H, the SAME pair the H2H entry ordered
-- the other way), the coin-flip order pinned as a literal and equal on a
-- second call, the chain completion, the playoff-week exclusion, the
-- unknown-entry refusal; the 10-team week with median + second + the
-- override + the two-decimal tie as a combined-record golden; the
-- `total_points` league with the E64 pair whose rows WOULD separate under
-- H2H and do not; the equivalence — finalize (116/117) → digest + standings
-- → rows corrupted → rebuild → digest ≡ AND standings ≡, then `changed =
-- false` on the second run; the override cell after the rebuild (stored
-- 'loss' though the home side scored more); every refusal by name with its
-- one-unit-away twin (D146: week 3 final rebuilds, week 4 correction_window
-- refuses; the NULL score / the drifted result / the deleted total_points
-- row each refuse and rebuild again once restored); the F244 report (a
-- league whose later week raises reports finalized 0, and its earlier week
-- stays correction_window with zero rows). Break probes (PR body): (1) the
-- DoD's — H2H attempts a 3+ group (`gsize = 2` → `gsize >= 2`) → the E63
-- goldens red; (2) the rebuild recomputes the overridden cell from its
-- scores → the override golden red; (3) the rebuild's math perturbed by one
-- rounding step → the equivalence cells red.
--
-- Migration checklist (plan §8.1): five NEW functions (three plain
-- helpers, two RPCs) + ONE replaced (`finalize_matchups`, D137 provenance
-- above); no table, no column, no policy, no index (§22.4's standings scan
-- is 109's `idx_twr_league_season` — measured with EXPLAIN in D314), no
-- trigger, no cron. RLS unchanged (the member SELECT on
-- `team_week_results` stays; the RPCs are the read/write doors). Realtime:
-- no trigger — D296 lands `team_week_results` broadcasts in L.D1.9 (the
-- dated D38 disposition; the rebuild is a correction-path write with no
-- subscriber yet). Staging-clone rehearsal disposed via the R6 rule (fresh
-- local `db reset` 001–117). Typegen re-run in the same PR (five
-- `Functions` entries — the two RPCs and the three REVOKEd helpers, which
-- PostgREST still exposes by signature; EXECUTE is what gates them; the
-- alias block re-appended; additive-only). Grants doctrine (D18→D23): no
-- per-object GRANT; the REVOKEs are load-bearing on every fresh CREATE
-- (`league_standings` keeps `authenticated` — the member-read RPC shape of
-- 111's `schedule_preview`; the rebuild and the helpers lose it).
--
-- HELD-FROM-PRODUCTION: registered (range → 082-117) in the same PR. No
-- launch-surface table is touched: every write is on the leagues chain
-- (`team_week_results`, `league_weeks`, and — through the replaced
-- finalize — `matchups`, `league_chat`); reads outside it are 116's
-- SELECTs on `nfl_games` / `nfl_weeks` and this file's on `teams`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. matchup_result_internal — the ONE E38 derivation: a matchup's result
--    from its two scores ROUNDED TO TWO DECIMALS (a two-decimal tie is a
--    tie; no hidden precision); NULL for a bye (no away side). 116's
--    `round(v_m.home_score, 2) > round(v_m.away_score, 2)` expression,
--    lifted verbatim so finalization (the flip) and the rebuild (the drift
--    check) read the same rule. IMMUTABLE, plain, REVOKEd.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION matchup_result_internal(
  p_home         NUMERIC,
  p_away         NUMERIC,
  p_away_team_id UUID
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_away_team_id IS NULL THEN NULL
    WHEN round(p_home, 2) > round(p_away, 2) THEN 'home'
    WHEN round(p_home, 2) < round(p_away, 2) THEN 'away'
    ELSE 'tie' END;
$$;
REVOKE EXECUTE ON FUNCTION matchup_result_internal(NUMERIC, NUMERIC, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. week_results_pending_internal — ONE reading of "pending" for a closed
--    week (116 (b)/(c), lifted): h2h — a NULL `home_score` / `away_score`
--    on ANY matchup of the week, overridden or not (an override is not a
--    score — R792; the door's word for "not yet scored", E61);
--    total_points — ANY seated (non-retired) team without a
--    `team_week_results` row (absence is not a score — R788). Returns NULL
--    when nothing is pending, else the NAMED shape finalize appends to its
--    `skipped` list verbatim (`reason` + `pending`, plus `missing` for the
--    total_points arm) and the rebuild raises with. Plain, REVOKEd.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION week_results_pending_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_mode    TEXT;
  v_pending INTEGER;
  v_missing JSONB;
BEGIN
  SELECT COALESCE(COALESCE(l.settings, '{}'::jsonb) ->> 'schedule_mode', 'h2h') INTO v_mode
  FROM public.leagues l WHERE l.id = p_league_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'week_results_pending_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_mode = 'h2h' THEN
    SELECT count(*) INTO v_pending
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week
      AND (m.home_score IS NULL OR (m.away_team_id IS NOT NULL AND m.away_score IS NULL));
    IF v_pending > 0 THEN
      RETURN jsonb_build_object('reason', 'pending_scores', 'pending', v_pending);
    END IF;
    RETURN NULL;
  END IF;

  -- total_points: the worker's provisional rows; ANY seated team missing
  -- holds the week (F241(b) — a partial absence is the silent shape).
  SELECT COALESCE(jsonb_agg(t.id ORDER BY t.id), '[]'::jsonb) INTO v_missing
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired'
    AND NOT EXISTS (
      SELECT 1 FROM public.team_week_results r
      WHERE r.league_id = p_league_id AND r.team_id = t.id AND r.season = p_season AND r.week = p_week);
  IF jsonb_array_length(v_missing) > 0 THEN
    RETURN jsonb_build_object('reason', 'pending_results',
                              'pending', jsonb_array_length(v_missing), 'missing', v_missing);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION week_results_pending_internal(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. week_results_write_internal — THE results math for a closed week, the
--    ONE writer of `team_week_results` rows that are `is_final` (116's
--    (b)-shape-guards / (b)-INSERT / (c)-UPDATE / (d)-median, lifted
--    verbatim with the league/season/week bound to the arguments). It reads
--    `matchups` AS WRITTEN — `result` (the flip's derivation or the
--    commissioner's override, §22.2), `home_score` / `away_score` (once
--    per team, §11.7), the `secondary` row — and NEVER recomputes a result
--    from scores itself: an overridden cell's stored result is what lands
--    in `h2h_result`. Callers guarantee the pending shapes are clear
--    (finalize skips by name; the rebuild raises by name) and, for
--    finalization, that the flip has run (result written). Idempotent:
--    `ON CONFLICT … DO UPDATE` on the §12.18 unique — a second call with
--    the same inputs writes the same bytes. RETURNS (results, teams,
--    median): the rows written, the seated/paired team count they were
--    checked against, and the EXACT median (NULL when median_game is off
--    or the week is a playoff week). Plain, REVOKEd.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION week_results_write_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER
) RETURNS TABLE (results INTEGER, teams INTEGER, median NUMERIC)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_settings  JSONB;
  v_mode      TEXT;
  v_median_on BOOLEAN;
  v_first     INTEGER;
  v_dupes     INTEGER;
  v_orphans   INTEGER;
  v_twr       INTEGER;
  v_teams     INTEGER;
  v_arr       NUMERIC[];
  v_n         INTEGER;
  v_median    NUMERIC;
  v_cnt       INTEGER;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'week_results_write_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_settings  := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode      := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  v_median_on := COALESCE((v_settings ->> 'median_game')::boolean, FALSE);
  SELECT min(lw.week) INTO v_first
  FROM public.league_weeks lw WHERE lw.league_id = p_league_id AND lw.season = p_season;

  IF v_mode = 'h2h' THEN
    -- Shape guards: at most one primary row per team; no team only in
    -- a secondary row.
    SELECT count(*) - count(DISTINCT team_id) INTO v_dupes
    FROM (
      SELECT m.home_team_id AS team_id FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week AND m.round_type <> 'secondary'
      UNION ALL
      SELECT m.away_team_id FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week AND m.round_type <> 'secondary'
        AND m.away_team_id IS NOT NULL) x;
    IF v_dupes > 0 THEN
      RAISE EXCEPTION 'week_results_write_internal: league % week % has a team in more than one primary matchup — the schedule invariant (§11.7) is broken; refusing to write results', p_league_id, p_week
        USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO v_orphans
    FROM (
      SELECT m.home_team_id AS team_id FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week AND m.round_type = 'secondary'
      UNION
      SELECT m.away_team_id FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week AND m.round_type = 'secondary'
        AND m.away_team_id IS NOT NULL) s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week AND m.round_type <> 'secondary'
        AND (m.home_team_id = s.team_id OR m.away_team_id = s.team_id));
    IF v_orphans > 0 THEN
      RAISE EXCEPTION 'week_results_write_internal: league % week % has % team(s) in a secondary matchup with no primary matchup — the derangement (§11.7/E40) is broken; refusing to write results', p_league_id, p_week, v_orphans
        USING ERRCODE = 'P0001';
    END IF;

    -- team_week_results from the matchups AS WRITTEN (PF once, §11.7; the
    -- stored `result` — an override stands, §22.2).
    INSERT INTO public.team_week_results
      (league_id, team_id, season, week, points, opponent_team_id, h2h_result,
       second_opponent_team_id, second_result, is_final)
    SELECT p_league_id, p.team_id, p_season, p_week, p.points, p.opponent, p.h2h,
           s.opponent, s.res, TRUE
    FROM (
      SELECT m.home_team_id AS team_id, round(m.home_score, 2) AS points, m.away_team_id AS opponent,
             CASE WHEN m.away_team_id IS NULL THEN 'bye'
                  WHEN m.result = 'home' THEN 'win'
                  WHEN m.result = 'away' THEN 'loss'
                  WHEN m.result = 'tie'  THEN 'tie' END AS h2h
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week
        AND m.round_type <> 'secondary'
      UNION ALL
      SELECT m.away_team_id, round(m.away_score, 2), m.home_team_id,
             CASE WHEN m.result = 'away' THEN 'win'
                  WHEN m.result = 'home' THEN 'loss'
                  WHEN m.result = 'tie'  THEN 'tie' END
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week
        AND m.round_type <> 'secondary' AND m.away_team_id IS NOT NULL
    ) p
    LEFT JOIN (
      SELECT m.home_team_id AS team_id, m.away_team_id AS opponent,
             CASE WHEN m.result = 'home' THEN 'win' WHEN m.result = 'away' THEN 'loss'
                  WHEN m.result = 'tie' THEN 'tie' END AS res
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week
        AND m.round_type = 'secondary'
      UNION ALL
      SELECT m.away_team_id, m.home_team_id,
             CASE WHEN m.result = 'away' THEN 'win' WHEN m.result = 'home' THEN 'loss'
                  WHEN m.result = 'tie' THEN 'tie' END
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week
        AND m.round_type = 'secondary' AND m.away_team_id IS NOT NULL
    ) s ON s.team_id = p.team_id
    ON CONFLICT (league_id, team_id, season, week) DO UPDATE
    SET points                  = EXCLUDED.points,
        opponent_team_id        = EXCLUDED.opponent_team_id,
        h2h_result              = EXCLUDED.h2h_result,
        second_opponent_team_id = EXCLUDED.second_opponent_team_id,
        second_result           = EXCLUDED.second_result,
        median_result           = NULL,
        is_final                = TRUE;
    GET DIAGNOSTICS v_twr = ROW_COUNT;
    SELECT count(DISTINCT team_id) INTO v_teams
    FROM (
      SELECT m.home_team_id AS team_id FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week AND m.round_type <> 'secondary'
      UNION
      SELECT m.away_team_id FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week AND m.round_type <> 'secondary'
        AND m.away_team_id IS NOT NULL) x;
    IF v_twr <> v_teams THEN
      RAISE EXCEPTION 'week_results_write_internal: league % week % wrote % team_week_results rows for % teams', p_league_id, p_week, v_twr, v_teams
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- total_points: the worker's provisional rows go final (the caller has
    -- cleared `pending_results`); points are the worker's, untouched.
    UPDATE public.team_week_results r
    SET is_final = TRUE, median_result = NULL
    WHERE r.league_id = p_league_id AND r.season = p_season AND r.week = p_week;
    GET DIAGNOSTICS v_twr = ROW_COUNT;
    SELECT count(*) INTO v_teams FROM public.teams t WHERE t.league_id = p_league_id AND t.status <> 'retired';
    IF v_twr < v_teams THEN
      RAISE EXCEPTION 'week_results_write_internal: league % week % (total_points) finalized % rows for % seated teams', p_league_id, p_week, v_twr, v_teams
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- median_game — regular season only; the average of the two middle
  -- scores, compared EXACTLY (E39); the caller stores it rounded.
  v_median := NULL;
  IF v_median_on AND p_week < v_first + v_league.regular_season_weeks THEN
    SELECT array_agg(r.points ORDER BY r.points) INTO v_arr
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = p_season AND r.week = p_week;
    v_n := COALESCE(array_length(v_arr, 1), 0);
    IF v_n >= 2 THEN
      IF v_n % 2 = 0 THEN
        v_median := (v_arr[v_n / 2] + v_arr[v_n / 2 + 1]) / 2;
      ELSE
        v_median := v_arr[(v_n + 1) / 2];
      END IF;
      UPDATE public.team_week_results r
      SET median_result = CASE
        WHEN r.points > v_median THEN 'win'
        WHEN r.points < v_median THEN 'loss'
        ELSE 'tie' END
      WHERE r.league_id = p_league_id AND r.season = p_season AND r.week = p_week;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> v_n THEN
        RAISE EXCEPTION 'week_results_write_internal: league % week % median wrote % rows for % results', p_league_id, p_week, v_cnt, v_n
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT v_twr, v_teams, v_median;
END;
$$;
REVOKE EXECUTE ON FUNCTION week_results_write_internal(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. finalize_matchups — REPLACED against 116's FILE TEXT (D137; provenance
--    + the six asserted substitutions in the banner; derive_117.py in the PR
--    body). Every byte below not named there is 116's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finalize_matchups(
  p_now       TIMESTAMPTZ DEFAULT now(),
  p_league_id UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_seen         UUID[] := '{}';
  v_loops        INTEGER := 0;
  v_pass         INTEGER;
  v_lg           RECORD;
  v_league       public.leagues;
  v_settings     JSONB;
  v_mode         TEXT;
  v_lw           RECORD;
  v_g            RECORD;
  v_m            RECORD;
  v_res          TEXT;
  v_cnt          INTEGER;
  v_twr          INTEGER;
  v_median       NUMERIC;
  v_matchups     INTEGER;
  v_pend         JSONB;
  v_w            RECORD;
  v_finalized    INTEGER := 0;
  v_lg_finalized INTEGER := 0;
  v_lg_report    JSONB := '[]'::jsonb;
  v_leagues      INTEGER := 0;
  v_report       JSONB := '[]'::jsonb;
  v_skipped      JSONB := '[]'::jsonb;
  v_failures     JSONB := '[]'::jsonb;
  v_live_past    JSONB := '[]'::jsonb;
  v_weeks        INTEGER[];
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'finalize_matchups: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    -- Claim LEAGUES with a due week (rule 8: the league row first).
    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
        AND EXISTS (
          SELECT 1
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = l.id AND lw.season = l.season
            AND (   (lw.status = 'correction_window' AND w.correction_window_ends_at <= p_now)
                 OR (lw.status = 'live'              AND w.last_game_ends_at IS NULL
                                                    AND w.correction_window_ends_at <= p_now)))
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      -- F244: the league's count/report accumulate in LOCALS and merge only
      -- after the subtransaction COMMITS (a later week's raise rolls the
      -- league's writes back; PL/pgSQL keeps variables — the report must not).
      v_lg_finalized := 0;
      v_lg_report := '[]'::jsonb;
      BEGIN
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;
        v_settings  := COALESCE(v_league.settings, '{}'::jsonb);
        v_mode      := COALESCE(v_settings ->> 'schedule_mode', 'h2h');

        -- LOUD (F238, the other side): live weeks past their window are not
        -- finalizable — the advance job could not close them.
        SELECT array_agg(lw.week ORDER BY lw.week) INTO v_weeks
        FROM public.league_weeks lw
        JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
        WHERE lw.league_id = v_lg.id AND lw.season = v_league.season
          AND lw.status = 'live' AND w.last_game_ends_at IS NULL
          AND w.correction_window_ends_at <= p_now;
        IF v_weeks IS NOT NULL THEN
          v_live_past := v_live_past || jsonb_build_object('league_id', v_lg.id, 'weeks', to_jsonb(v_weeks));
        END IF;

        FOR v_lw IN
          SELECT lw.id, lw.week, w.correction_window_ends_at
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = v_lg.id
            AND lw.season = v_league.season
            AND lw.status = 'correction_window'
            AND w.correction_window_ends_at <= p_now
          ORDER BY lw.week
          FOR UPDATE OF lw
        LOOP
          -- (a) §23.2: every non-postponed game of the week final, at run time.
          SELECT * INTO v_g FROM public.week_games_state_internal(v_league.season, v_lw.week);
          IF NOT v_g.all_final THEN
            v_skipped := v_skipped || jsonb_build_object(
              'league_id', v_lg.id, 'week', v_lw.week, 'reason', 'games_not_final',
              'total', v_g.total_games, 'final', v_g.final_games,
              'postponed', v_g.postponed_games, 'open', v_g.open_games);
            RAISE NOTICE 'finalize_matchups: league % week % not finalized — % of % in-week games final (% postponed, % open); no league state advances on partial data (§23.2)',
              v_lg.id, v_lw.week, v_g.final_games, v_g.total_games - v_g.postponed_games, v_g.postponed_games, v_g.open_games;
            CONTINUE;
          END IF;

          v_matchups := 0;

          -- (b)/(c) THE PENDING SHAPES, BY NAME — 117's
          --     `week_results_pending_internal` (D137: ONE reading of
          --     "pending" for finalization AND the rebuild; called, never
          --     copied): h2h — a NULL score on ANY matchup, overridden or
          --     not (E61, R792); total_points — ANY seated team without a
          --     result row (R788). The week is SKIPPED BY NAME and stays
          --     `correction_window`; nothing is coerced to 0.00.
          v_pend := public.week_results_pending_internal(v_lg.id, v_league.season, v_lw.week);
          IF v_pend IS NOT NULL THEN
            v_skipped := v_skipped || (jsonb_build_object('league_id', v_lg.id, 'week', v_lw.week) || v_pend);
            RAISE NOTICE 'finalize_matchups: league % week % not finalized — % (pending; absence is not a score — E61/§23.2; never coerced to 0.00)',
              v_lg.id, v_lw.week, v_pend ->> 'reason';
            CONTINUE;
          END IF;

          IF v_mode = 'h2h' THEN
            -- Results per matchup (E38: two decimals, ties are ties — 117's
            -- `matchup_result_internal` is the ONE derivation, shared with
            -- the rebuild's drift check); an overridden cell is never
            -- touched (§22.2).
            FOR v_m IN
              SELECT m.* FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
              ORDER BY m.round_type, m.id
              FOR UPDATE
            LOOP
              v_res := public.matchup_result_internal(v_m.home_score, v_m.away_score, v_m.away_team_id);
              IF v_m.is_overridden THEN
                -- The cell stands: scores untouched, an overridden result
                -- untouched; a NULL result is read from the overridden scores.
                UPDATE public.matchups
                SET status = 'final', result = COALESCE(v_m.result, v_res), updated_at = p_now
                WHERE id = v_m.id;
              ELSE
                UPDATE public.matchups
                SET status = 'final', result = v_res, updated_at = p_now
                WHERE id = v_m.id;
              END IF;
              v_matchups := v_matchups + 1;
            END LOOP;
          END IF;

          -- (c)/(d) THE RESULTS MATH — 117's `week_results_write_internal`
          --     (D137: the ONE writer of `team_week_results` for a closed
          --     week; `rebuild_team_week_results` calls the same helper and
          --     pgTAP 065 pins the two byte-identical): the h2h rows from the
          --     now-final matchups (PF once; the primary + the `secondary`
          --     row; the shape guards), the total_points rows flipped
          --     `is_final`, the EXACT median (E39) compared and its cells
          --     written. `median` is NULL when median_game is off or the
          --     week is a playoff week.
          SELECT * INTO v_w FROM public.week_results_write_internal(v_lg.id, v_league.season, v_lw.week);
          v_twr := v_w.results;
          v_median := v_w.median;

          -- (e) the week → final (F4's last legal step).
          UPDATE public.league_weeks
          SET status = 'final', finalized_at = p_now, median_score = v_median
          WHERE id = v_lw.id;
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          IF v_cnt <> 1 THEN
            RAISE EXCEPTION 'finalize_matchups: finalizing week % of league % touched % rows, expected 1', v_lw.week, v_lg.id, v_cnt
              USING ERRCODE = 'P0001';
          END IF;

          -- E43: the system note when a postponed game was excluded.
          IF v_g.postponed_games > 0 THEN
            INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
            VALUES (v_lg.id, NULL,
              'Week ' || v_lw.week || ' was finalized without the postponed game' ||
              CASE WHEN v_g.postponed_games > 1 THEN 's ' ELSE ' ' END || v_g.postponed_list ||
              ' — players in a game postponed out of the week score 0 for the week (§23.3/E43); the commissioner may override.',
              'league', TRUE);
          END IF;

          v_lg_finalized := v_lg_finalized + 1;
          v_lg_report := v_lg_report || jsonb_build_object(
            'league_id', v_lg.id, 'week', v_lw.week, 'schedule_mode', v_mode,
            'matchups_final', v_matchups, 'results', v_twr,
            'median_score', v_median,
            'postponed_excluded', v_g.postponed_games);
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'finalize_matchups failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
        -- F244: everything this league reported ROLLED BACK with it.
        v_lg_finalized := 0;
        v_lg_report := '[]'::jsonb;
      END;
      -- F244: merge only what COMMITTED.
      v_finalized := v_finalized + v_lg_finalized;
      v_report := v_report || v_lg_report;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',               p_now,
    'scope',            p_league_id,
    'leagues',          v_leagues,
    'finalized',        v_finalized,
    'weeks',            v_report,
    'skipped',          v_skipped,
    'live_past_window', v_live_past,
    'failures',         v_failures,
    'loops',            v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'nothing_due'
      WHEN v_finalized = 0 THEN 'nothing_finalized'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION finalize_matchups(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. rebuild_team_week_results — the §12.18 rebuildability guarantee: a
--    FINAL week's derived rows re-derived from `matchups` AS WRITTEN
--    (scores + result + override — the pairing/score/override source of
--    truth) through THE SAME helper finalization uses, so the rebuilt rows
--    are byte-identical to what finalize wrote for the same inputs (pgTAP
--    065 pins it). The correction path's rebuild arm (D295/D297/§23.4):
--    M6's audited apply/override verbs change a `matchups` row of a final
--    week and then call this; the write door (L.D1.9) owns every NON-final
--    week and refuses final ones (D292/D295(b)) — the two are complementary
--    by week status, never both.
--
--    Contract:
--      * SECURITY DEFINER + search_path='' + triple REVOKE, and a
--        JWT-bearing caller is refused in-body (42501): a rebuild is not a
--        user verb — it is called by the service role, the harness/sim, and
--        (in-body) by M6's audited commissioner verbs.
--      * Lock order (rule 8): the `leagues` row FOR UPDATE first, then the
--        `league_weeks` row.
--      * The week's `league_weeks` row must be `final` — otherwise REFUSED
--        BY NAME (`week_not_final`): results for an open week are not
--        results (§11.5 "computed from final matchups"; §23.2).
--      * The pending shapes REFUSE BY NAME through the shared helper
--        (`pending_scores` / `pending_results` — a total_points week with
--        a seated team lacking a row stays pending here too: R788, nothing
--        is zero-filled); a `final` week can only carry them if something
--        outside this chain wrote them, so the refusal is loud, not a skip.
--      * h2h: every matchup of the week must be `final`
--        (`matchup_not_final`) and every NON-overridden row's stored
--        `result` must agree with its scores under the E38 rule
--        (`result_drift`) — otherwise REFUSED BY NAME. The rebuild NEVER
--        writes `matchups` (rule 9: a final matchup is never recomputed
--        here; the source of truth is read, not repaired) — a correction
--        that changes a score must write the row's `result` with it, or
--        the rebuild refuses (F245 hands L.E2 that duty).
--      * An `is_overridden` row's stored `result` lands in `h2h_result`
--        exactly (never recomputed from its scores — §12.18's precedence /
--        §22.2); 065 pins it with a cell whose scores say the opposite.
--      * Writes: `team_week_results` (the helper's upsert — points,
--        opponent, h2h/second/median results, `is_final`) and
--        `league_weeks.median_score` (the rounded store of the EXACT
--        median, D313(7)(d)); `finalized_at` / `status` untouched.
--      * Idempotent + loud emptiness (rule 10): the week's rows are
--        digested before and after; `changed = false` comes with
--        `reason = 'already_consistent'`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rebuild_team_week_results(
  p_league_id UUID,
  p_week      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league   public.leagues;
  v_lw       public.league_weeks;
  v_mode     TEXT;
  v_pend     JSONB;
  v_open     INTEGER;
  v_drift    JSONB;
  v_before   TEXT;
  v_after    TEXT;
  v_w        RECORD;
  v_median_b NUMERIC;
  v_cnt      INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'rebuild_team_week_results: the rebuild is run by the service role, the harness, or an audited commissioner verb in-body — never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 8: the league row first.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rebuild_team_week_results: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_mode := COALESCE(COALESCE(v_league.settings, '{}'::jsonb) ->> 'schedule_mode', 'h2h');

  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rebuild_team_week_results: league % has no league_weeks row for season % week %', p_league_id, v_league.season, p_week
      USING ERRCODE = 'P0002';
  END IF;
  IF v_lw.status <> 'final' THEN
    RAISE EXCEPTION 'rebuild_team_week_results: week_not_final — league % week % is % (results are derived from FINAL weeks only; an open week belongs to the write door — §11.5/§23.2/D295)',
      p_league_id, p_week, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;

  -- The pending shapes, by name (the shared reading).
  v_pend := public.week_results_pending_internal(p_league_id, v_league.season, p_week);
  IF v_pend IS NOT NULL THEN
    RAISE EXCEPTION 'rebuild_team_week_results: % — league % week % is final but carries a pending shape (%): absence is not a score; nothing is rebuilt (E61/§23.2/R788)',
      v_pend ->> 'reason', p_league_id, p_week, v_pend
      USING ERRCODE = 'P0001';
  END IF;

  IF v_mode = 'h2h' THEN
    SELECT count(*) INTO v_open
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND m.status <> 'final';
    IF v_open > 0 THEN
      RAISE EXCEPTION 'rebuild_team_week_results: matchup_not_final — league % week % is final but % matchup(s) are not; the source of truth disagrees with the week and is not repaired here',
        p_league_id, p_week, v_open
        USING ERRCODE = 'P0001';
    END IF;
    -- A NON-overridden row's stored result must be its scores' E38 result;
    -- the rebuild reads the source of truth and never repairs it.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('matchup_id', m.id, 'stored', m.result,
                      'derived', public.matchup_result_internal(m.home_score, m.away_score, m.away_team_id))
                    ORDER BY m.id), '[]'::jsonb) INTO v_drift
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND NOT m.is_overridden
      AND m.result IS DISTINCT FROM public.matchup_result_internal(m.home_score, m.away_score, m.away_team_id);
    IF jsonb_array_length(v_drift) > 0 THEN
      RAISE EXCEPTION 'rebuild_team_week_results: result_drift — league % week %: % non-overridden matchup(s) store a result that is not the E38 result of their own scores (%); a score correction must write the row''s result with it (F245) — nothing is rebuilt',
        p_league_id, p_week, jsonb_array_length(v_drift), v_drift
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Digest before (stable rendering; never the row id).
  SELECT md5(COALESCE(string_agg(
           r.team_id::text || '|' || r.points::text || '|' || COALESCE(r.opponent_team_id::text, '') || '|' ||
           COALESCE(r.h2h_result, '') || '|' || COALESCE(r.median_result, '') || '|' ||
           COALESCE(r.second_opponent_team_id::text, '') || '|' || COALESCE(r.second_result, '') || '|' || r.is_final::text,
           ';' ORDER BY r.team_id), ''))
  INTO v_before
  FROM public.team_week_results r
  WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
  v_median_b := v_lw.median_score;

  -- THE results math — the same helper finalization calls (D137).
  SELECT * INTO v_w FROM public.week_results_write_internal(p_league_id, v_league.season, p_week);

  -- The rounded store of the exact median (same-status UPDATE; the F4
  -- guard lets a median write through — 110).
  UPDATE public.league_weeks
  SET median_score = v_w.median
  WHERE id = v_lw.id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'rebuild_team_week_results: the median write touched % rows for league % week % (expected exactly 1)', v_cnt, p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;

  SELECT md5(COALESCE(string_agg(
           r.team_id::text || '|' || r.points::text || '|' || COALESCE(r.opponent_team_id::text, '') || '|' ||
           COALESCE(r.h2h_result, '') || '|' || COALESCE(r.median_result, '') || '|' ||
           COALESCE(r.second_opponent_team_id::text, '') || '|' || COALESCE(r.second_result, '') || '|' || r.is_final::text,
           ';' ORDER BY r.team_id), ''))
  INTO v_after
  FROM public.team_week_results r
  WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;

  RETURN jsonb_build_object(
    'league_id',            p_league_id,
    'season',               v_league.season,
    'week',                 p_week,
    'schedule_mode',        v_mode,
    'results',              v_w.results,
    'teams',                v_w.teams,
    'median_score',         (SELECT lw.median_score FROM public.league_weeks lw WHERE lw.id = v_lw.id),
    'median_score_changed', v_median_b IS DISTINCT FROM (SELECT lw.median_score FROM public.league_weeks lw WHERE lw.id = v_lw.id),
    'changed',              v_before IS DISTINCT FROM v_after,
    'digest_before',        v_before,
    'digest_after',         v_after,
    'reason',               CASE WHEN v_before IS NOT DISTINCT FROM v_after THEN 'already_consistent' ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION rebuild_team_week_results(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. league_standings — the §7.3.7 chain over `team_week_results`, ONE
--    ranking rule for the standings display and playoff seeding (§7.3.7's
--    own sentence; L.D1.8 seeds from this payload).
--
--    Reads (a single indexed scan of `team_week_results` on
--    `idx_twr_league_season` — the CTE is materialized once and every
--    later step reads it): the league's FINAL rows of the REGULAR SEASON
--    (`week < first week + regular_season_weeks`, NFL-week terms — D288;
--    playoff rows never move the table, §7.3.7 "at end of regular
--    season"); provisional rows (`is_final = false`) never count (§11.5
--    "computed from final matchups" — the live projection is the UI's).
--    Teams: every seated (non-retired) franchise of the league, with or
--    without rows (0-0-0 renders — loud: `weeks_final` says how many final
--    regular-season weeks exist and `reason = 'no_final_weeks'` when none).
--
--    Per team: the COMBINED record — h2h + median + second results
--    (§11.7 "standings and Win % include it"; `bye` is not a game); Win %
--    = (2W + T) / 2G as an exact NUMERIC (0 for no games; the display
--    field is rounded to 4 places, the sort key is not); Points For = Σ
--    points (counted ONCE per week — §11.7); Points Against = Σ the
--    PRIMARY opponent's points that week (the row `opponent_team_id`
--    names — once per week, the mirror of PF, so Σ PF ≡ Σ PA over the
--    league; a bye adds nothing; a missing opponent row is COUNTED and
--    named in `pa_gaps`, never silently 0 — D314(4)).
--
--    The chain: `settings.tiebreakers` (the §7.3.7 stored, reorderable
--    array — the TS catalog's six entries) applied IN THE STORED ORDER;
--    entries the stored array omits are appended in the catalog's default
--    order so the chain is always total (`coin_flip` ends every tie); the
--    effective chain is in the payload. Each entry yields ONE numeric key
--    per team ("higher first" on every key) and the table is `ORDER BY
--    keys DESC, team_id`:
--      win_pct         — the exact ratio.
--      points_for      — PF.
--      head_to_head    — ONLY for a CLEAN two-team tie: a group of exactly
--                        two teams equal on every PRECEDING key, in an
--                        `h2h` league. key = (wins − losses) between the
--                        two across their meetings (primary AND
--                        `secondary` rows; ties count for neither) — equal
--                        ⇒ unresolved, the chain continues. A group of 3+
--                        is SKIPPED (E63: records can cycle) and named in
--                        `skipped`; a `total_points` league skips the
--                        entry ENTIRELY (E64 — by schedule_mode, NEVER by
--                        the absence of data: 065 pins it with rows that
--                        would separate the pair if the entry ran).
--      points_against  — PA, HIGHER FIRST (deliberate — §7.3.7: the team
--                        that allowed more played the harder schedule).
--      division_record — INERT (key 0 for every team): divisions are pinned
--                        at 1 (Q30 (d), v2.16.12); the entry stays in the
--                        stored array (F221's return path) and never
--                        separates a tie.
--      coin_flip       — DETERMINISTIC and SEEDED: the low 60 bits of
--                        md5(seed || ':' || team_id), seed = the league's
--                        stored `schedule_seed` (§11.7 — the only seed a
--                        league owns; NEVER random()/setseed()), falling
--                        back to the league id (named in the payload) when
--                        no seed was ever minted. Same seed ⇒ same order,
--                        every time (065 pins it twice). A Remix re-mints
--                        `schedule_seed` and so may re-flip a coin-flip
--                        tie — F246 records the choice.
--    `separated_by` on each row = the FIRST chain entry whose key differs
--    from the row above (NULL for rank 1) — the falsifiable form of "which
--    rule placed this team".
--
--    Authority: SECURITY DEFINER + search_path='' + REVOKE FROM PUBLIC,
--    anon; in-body a signed-in caller must be a member of the league
--    (42501; `is_league_member` — the member READ every row here is RLS'd
--    to anyway); the service role / harness (auth.uid() NULL) reads any
--    league. DEFINER over a plain SECURITY INVOKER function so that a
--    non-member is REFUSED BY NAME rather than handed an empty table
--    (CLAUDE.md: never let "nothing" look like "it worked"). STABLE: no
--    writes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_standings(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_catalog  CONSTANT TEXT[] := ARRAY['win_pct', 'points_for', 'head_to_head', 'points_against', 'division_record', 'coin_flip'];
  v_league   public.leagues;
  v_settings JSONB;
  v_mode     TEXT;
  v_first    INTEGER;
  v_last     INTEGER;
  v_chain    TEXT[] := '{}';
  v_appended TEXT[] := '{}';
  v_entry    TEXT;
  v_seed     TEXT;
  v_seed_src TEXT;
  v_h2h_ord  INTEGER;
  v_h2h_on   BOOLEAN;
  v_weeks    INTEGER;
  v_rows     JSONB;
  v_skipped  JSONB;
  v_pa_gaps  JSONB;
  v_chain_js JSONB;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'league_standings: only a member of the league may read its standings'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_standings: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode     := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  IF v_mode NOT IN ('h2h', 'total_points') THEN
    RAISE EXCEPTION 'league_standings: league % has schedule_mode % — expected h2h or total_points (§7.3.1)', p_league_id, v_mode
      USING ERRCODE = 'P0001';
  END IF;

  -- The regular season in NFL-week terms (D288): first week … first +
  -- regular_season_weeks − 1. No league_weeks rows ⇒ no season ⇒ no rows.
  SELECT min(lw.week) INTO v_first
  FROM public.league_weeks lw WHERE lw.league_id = p_league_id AND lw.season = v_league.season;
  v_last := v_first + v_league.regular_season_weeks - 1;

  -- The chain: the stored order, validated; the catalog's remainder appended.
  IF jsonb_typeof(v_settings -> 'tiebreakers') = 'array' THEN
    FOR v_entry IN SELECT jsonb_array_elements_text(v_settings -> 'tiebreakers') LOOP
      IF NOT (v_entry = ANY (c_catalog)) THEN
        RAISE EXCEPTION 'league_standings: league % stores an unknown tiebreaker % (§7.3.7: win_pct, points_for, head_to_head, points_against, division_record, coin_flip)', p_league_id, v_entry
          USING ERRCODE = 'P0001';
      END IF;
      IF v_entry = ANY (v_chain) THEN
        RAISE EXCEPTION 'league_standings: league % stores the tiebreaker % twice (§7.3.7: entries are unique)', p_league_id, v_entry
          USING ERRCODE = 'P0001';
      END IF;
      v_chain := v_chain || v_entry;
    END LOOP;
  ELSIF v_settings ? 'tiebreakers' THEN
    RAISE EXCEPTION 'league_standings: league % stores tiebreakers that are not an array', p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOREACH v_entry IN ARRAY c_catalog LOOP
    IF NOT (v_entry = ANY (v_chain)) THEN
      v_chain := v_chain || v_entry;
      v_appended := v_appended || v_entry;
    END IF;
  END LOOP;
  v_h2h_ord := array_position(v_chain, 'head_to_head');
  v_h2h_on  := (v_mode = 'h2h');

  v_seed_src := CASE WHEN v_settings ? 'schedule_seed' AND jsonb_typeof(v_settings -> 'schedule_seed') <> 'null'
                     THEN 'schedule_seed' ELSE 'league_id' END;
  v_seed := CASE WHEN v_seed_src = 'schedule_seed' THEN v_settings ->> 'schedule_seed' ELSE p_league_id::text END;

  WITH chain AS (
    SELECT c.e AS entry, c.ord::int AS ord FROM unnest(v_chain) WITH ORDINALITY AS c(e, ord)
  ),
  seated AS (
    SELECT t.id, t.name FROM public.teams t WHERE t.league_id = p_league_id AND t.status <> 'retired'
  ),
  rows_ AS MATERIALIZED (   -- THE scan: idx_twr_league_season (league_id, season, week)
    SELECT r.team_id, r.week, r.points, r.opponent_team_id, r.h2h_result, r.median_result,
           r.second_opponent_team_id, r.second_result
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = v_league.season
      AND r.week >= v_first AND r.week <= v_last
      AND r.is_final
  ),
  agg AS (
    SELECT s.id AS team_id, s.name,
      count(*) FILTER (WHERE r.h2h_result = 'win')  ::int AS h2h_w,
      count(*) FILTER (WHERE r.h2h_result = 'loss') ::int AS h2h_l,
      count(*) FILTER (WHERE r.h2h_result = 'tie')  ::int AS h2h_t,
      count(*) FILTER (WHERE r.median_result = 'win')  ::int AS med_w,
      count(*) FILTER (WHERE r.median_result = 'loss') ::int AS med_l,
      count(*) FILTER (WHERE r.median_result = 'tie')  ::int AS med_t,
      count(*) FILTER (WHERE r.second_result = 'win')  ::int AS sec_w,
      count(*) FILTER (WHERE r.second_result = 'loss') ::int AS sec_l,
      count(*) FILTER (WHERE r.second_result = 'tie')  ::int AS sec_t,
      COALESCE(sum(r.points), 0)::numeric AS pf,
      COALESCE(sum(o.points), 0)::numeric AS pa,
      count(r.team_id)::int AS weeks,
      count(*) FILTER (WHERE r.opponent_team_id IS NOT NULL AND o.team_id IS NULL)::int AS pa_gap
    FROM seated s
    LEFT JOIN rows_ r ON r.team_id = s.id
    LEFT JOIN rows_ o ON o.team_id = r.opponent_team_id AND o.week = r.week
    GROUP BY s.id, s.name
  ),
  stats AS (
    SELECT a.*,
      (a.h2h_w + a.med_w + a.sec_w) AS w,
      (a.h2h_l + a.med_l + a.sec_l) AS l,
      (a.h2h_t + a.med_t + a.sec_t) AS t,
      (a.h2h_w + a.med_w + a.sec_w + a.h2h_l + a.med_l + a.sec_l + a.h2h_t + a.med_t + a.sec_t) AS g,
      (('x' || left(md5(v_seed || ':' || a.team_id::text), 15))::bit(60)::bigint)::numeric AS flip
    FROM agg a
  ),
  stats2 AS (
    SELECT s.*,
      CASE WHEN s.g = 0 THEN 0::numeric ELSE (2 * s.w + s.t)::numeric / (2 * s.g) END AS wp
    FROM stats s
  ),
  pre AS (   -- the keys of every entry BEFORE head_to_head: the group definition at that point
    SELECT s.*,
      COALESCE((SELECT array_agg(CASE c.entry
                                   WHEN 'win_pct'         THEN s.wp
                                   WHEN 'points_for'      THEN s.pf
                                   WHEN 'points_against'  THEN s.pa
                                   WHEN 'division_record' THEN 0::numeric
                                   WHEN 'coin_flip'       THEN s.flip END ORDER BY c.ord)
                FROM chain c WHERE v_h2h_ord IS NOT NULL AND c.ord < v_h2h_ord), '{}'::numeric[]) AS prekeys
    FROM stats2 s
  ),
  grp AS (
    SELECT p.*,
      count(*) OVER (PARTITION BY p.prekeys) AS gsize,
      (SELECT q.team_id FROM pre q WHERE q.prekeys = p.prekeys AND q.team_id <> p.team_id ORDER BY q.team_id LIMIT 1) AS other_id
    FROM pre p
  ),
  h2h AS (
    SELECT g.*,
      CASE WHEN v_h2h_on AND v_h2h_ord IS NOT NULL AND g.gsize = 2 THEN
        (SELECT (count(*) FILTER (WHERE r.opponent_team_id = g.other_id AND r.h2h_result = 'win')
               + count(*) FILTER (WHERE r.second_opponent_team_id = g.other_id AND r.second_result = 'win')
               - count(*) FILTER (WHERE r.opponent_team_id = g.other_id AND r.h2h_result = 'loss')
               - count(*) FILTER (WHERE r.second_opponent_team_id = g.other_id AND r.second_result = 'loss'))::numeric
         FROM rows_ r WHERE r.team_id = g.team_id)
      ELSE 0::numeric END AS h2h_key
    FROM grp g
  ),
  keyed AS (
    SELECT h.*,
      (SELECT array_agg(CASE c.entry
                          WHEN 'win_pct'         THEN h.wp
                          WHEN 'points_for'      THEN h.pf
                          WHEN 'head_to_head'    THEN h.h2h_key
                          WHEN 'points_against'  THEN h.pa
                          WHEN 'division_record' THEN 0::numeric
                          WHEN 'coin_flip'       THEN h.flip END ORDER BY c.ord)
       FROM chain c) AS keys
    FROM h2h h
  ),
  ranked AS (
    SELECT k.*,
      row_number() OVER (ORDER BY k.keys DESC, k.team_id) AS rank,
      lag(k.keys)  OVER (ORDER BY k.keys DESC, k.team_id) AS prev_keys
    FROM keyed k
  ),
  fin AS (
    SELECT r.*,
      CASE WHEN r.prev_keys IS NULL THEN NULL
           ELSE COALESCE(v_chain[(SELECT min(i) FROM generate_subscripts(r.keys, 1) i
                                  WHERE r.keys[i] IS DISTINCT FROM r.prev_keys[i])], 'unresolved') END AS separated_by
    FROM ranked r
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'rank',            f.rank,
        'team_id',         f.team_id,
        'name',            f.name,
        'wins',            f.w,
        'losses',          f.l,
        'ties',            f.t,
        'games',           f.g,
        'win_pct',         round(f.wp, 4),
        'points_for',      f.pf,
        'points_against',  f.pa,
        'weeks',           f.weeks,
        'h2h_record',      jsonb_build_object('wins', f.h2h_w, 'losses', f.h2h_l, 'ties', f.h2h_t),
        'median_record',   jsonb_build_object('wins', f.med_w, 'losses', f.med_l, 'ties', f.med_t),
        'second_record',   jsonb_build_object('wins', f.sec_w, 'losses', f.sec_l, 'ties', f.sec_t),
        'separated_by',    f.separated_by) ORDER BY f.rank), '[]'::jsonb) FROM fin f),
    (SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'teams'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('entry', 'head_to_head',
                 'reason', CASE WHEN v_h2h_on THEN 'group_of_3_or_more' ELSE 'total_points' END,
                 'teams', (SELECT jsonb_agg(g2.team_id ORDER BY g2.team_id) FROM grp g2 WHERE g2.prekeys = g.prekeys)) AS x
        FROM grp g
        WHERE v_h2h_ord IS NOT NULL
          AND ((v_h2h_on AND g.gsize >= 3) OR (NOT v_h2h_on AND g.gsize >= 2))
        GROUP BY g.prekeys, g.gsize) sk),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id', a.team_id, 'weeks_without_opponent_row', a.pa_gap) ORDER BY a.team_id), '[]'::jsonb)
     FROM agg a WHERE a.pa_gap > 0),
    (SELECT count(DISTINCT r.week)::int FROM rows_ r)
  INTO v_rows, v_skipped, v_pa_gaps, v_weeks;

  SELECT jsonb_agg(jsonb_build_object(
           'entry', c.entry,
           'status', CASE c.entry
                       WHEN 'division_record' THEN 'inert'
                       WHEN 'head_to_head'    THEN CASE WHEN v_h2h_on THEN 'applied' ELSE 'skipped' END
                       ELSE 'applied' END,
           'reason', CASE c.entry
                       WHEN 'division_record' THEN 'divisions_pinned_at_1'
                       WHEN 'head_to_head'    THEN CASE WHEN v_h2h_on THEN 'clean_two_team_ties_only' ELSE 'total_points' END
                       ELSE NULL END) ORDER BY c.ord)
  INTO v_chain_js
  FROM unnest(v_chain) WITH ORDINALITY AS c(entry, ord);

  RETURN jsonb_build_object(
    'league_id',        p_league_id,
    'season',           v_league.season,
    'schedule_mode',    v_mode,
    'regular_season',   jsonb_build_object('first_week', v_first, 'last_week', v_last),
    'weeks_final',      v_weeks,
    'chain',            v_chain_js,
    'chain_appended',   to_jsonb(v_appended),
    'coin_flip_seed',   v_seed,
    'coin_flip_seed_source', v_seed_src,
    'skipped',          v_skipped,
    'pa_gaps',          v_pa_gaps,
    'standings',        v_rows,
    'reason',           CASE WHEN v_weeks = 0 THEN 'no_final_weeks' ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_standings(UUID) FROM PUBLIC, anon;
