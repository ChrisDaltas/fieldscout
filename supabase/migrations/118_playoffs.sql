-- ============================================================================
-- Playoffs — bracket generation, the season-long projection, the status
-- flips and the champion — migration 118 (task L.D1.8; tasks-M4-inseason.md
-- §6 L.D1.8 as AMENDED at the Q39 application + §7 row "~~116~~ → +1"; spec
-- spec-redraft-leagues.md v2.16.24 → v2.16.25 by this PR's fold-back —
-- §11.5 (Playoffs: the five Q39 rulings + the season-long "if the playoffs
-- started today" projection), §11.7 (the total_points playoff rule — Q39
-- (C)), §7.3.1 (`playoff_teams` × `schedule_mode` — Q39 (C); `playoff_byes`,
-- `playoff_reseed`, `playoff_weeks_per_round`), §7.3.7 (seeding = the ONE
-- ranking rule), §7.1 (in_season → playoffs → complete, forward), §11.4
-- (finalization), §16.2 (`playoff-bracket.tsx` / the standings page), §22.2,
-- §23.4, E38 / E43 / E64; PROGRESS §3 **Q39 (A)–(E), RULED by Chris
-- 2026-09-07** (applied here — blocker B9 CLEARS), D137 (every replaced
-- function authored against its newest defining migration's FILE TEXT —
-- `derive_118.py` in the PR body, six asserted derivations), D288 (a league
-- week IS an NFL week), D291 (`p_now` injection), D297 (standings are a
-- computed read), D313 (116's job contracts, honoured verbatim), D314 (117's
-- standings contract — the chain byte-for-byte; the `seated` CTE is the
-- retired-team seam — D314(6)/R806), F212 (consolation + third-place
-- DEFERRED — cited, not built), F241, F242 (DISCHARGED — pinned in 066),
-- F253(a) (DISCHARGED — the projected standings arm lands here); tasks-M4 §4
-- standing rules 1–11; D318 (build mechanics); the PR #264 fix round —
-- R839 (a PLAYED round is history: a moved prior verdict is REFUSED by
-- name, never a wipe), R840 (§23.2 / E61: a provisional build waits on a
-- pending score — never a 0.00 seed, never a status flip), R841 (the jobs'
-- `bracket_blocked` / `bracket_waiting` payload keys + WARNING).
--
-- Numbering: migration head measured 117 at task time (ls supabase/
-- migrations/ | tail -1) ⇒ 118, pgTAP head 065 ⇒ 066 — confirmed with `ls`,
-- not inherited (D161/D166).
--
-- THE RULINGS, APPLIED (each one sentence of spec, one hunk of code, one
-- 066 golden):
--   (A) a playoff game tied at two decimals (E38) advances the HIGHER SEED;
--       the row's `result` stays 'tie'; only the ADVANCEMENT reads the seed
--       (`playoff_bracket_state_internal`: `decided_by = 'higher_seed'`).
--   (B) a two-week round is decided by the SUM of both weeks' scores; each
--       week's row keeps its own W/L/T; an exactly equal sum falls to (A) —
--       the RECORDED READING (offered, pinned so it reds if ruled otherwise).
--   (C) NO bracket for `schedule_mode = total_points` — the points race IS
--       the playoff. `playoff_teams > 0` + total_points is REFUSED at
--       settings time (`create_league` 077 / `update_league_settings` 105,
--       a plain message naming `playoff_teams`; the Zod validator and the
--       settings panel on the TS side). The engine never enters the bracket
--       path for the mode WHATEVER `playoff_teams` stores (pinned) — a
--       table CHECK on the pair was authored and WITHDRAWN: pgTAP 058 L8 and
--       059 LT (merged fixtures) store total_points on a playoff_teams-6 row
--       to pin the engine's mode arm, and the mode is what the engine reads.
--   (D) `playoff_teams = 0` (and, by (C), every total_points league): the
--       champion is standings RANK 1 THROUGH THE FULL CHAIN (117's
--       `league_standings`, final arm) and the league flips in_season →
--       complete at the instant its LAST regular-season week goes `final`
--       (inside `finalize_matchups`, via the sync). `leagues.champion_team_id`
--       (a typed column — below) is written at the flip.
--   (E) the bracket is (re)built at the week's ROLLOVER — `nfl_weeks.
--       last_game_ends_at` (Tuesday ≈ 00:00 PT, the end of Monday night's
--       game — the SAME instant Q34(B) ruled for the lock's release, and the
--       instant 116's `league_week_advance` (b) closes the week on; recorded
--       as the EVENT, never a clock) from that week's PROVISIONAL scores
--       (the projected standings / the provisional round verdicts), then
--       REBUILT at `correction_window_ends_at` (inside `finalize_matchups`)
--       when a correction moved a seed. The same for every round. NOT
--       Wednesday's `starts_at` (the task text's "when the advance job opens
--       playoff_start_week" is superseded — the §6 row is amended). PLUS
--       Chris's framing: the bracket is a SEASON-LONG PROJECTED VIEW ("what
--       the bracket would be if the playoffs started today") —
--       `league_playoff_bracket` computes round 1 from the PROJECTED
--       standings all season, and the same pairing code materialises the real
--       one at the last regular-season week's rollover. ONE absolute instant
--       per league (a `timestamptz` in the payload — `rollover_at`), rendered
--       in each viewer's zone by the UI (never "midnight" as copy — L.D5.5).
--   NOT built (offered readings, filed not assumed): moving the "current
--   week" boundary (110/116's `starts_at`) to the rollover — untouched; the
--   sync reads the rollover from `league_weeks.status` (which 116 flips ON
--   `last_game_ends_at`), never from a clock of its own.
--
-- THE RIDERS, PINNED AS MECHANICS (Q39's (i)–(vii); 066):
--   (i)   bracket B = 2^rounds (`schedule_playoff_rounds`, 110); byes =
--         B − playoff_teams to seeds 1..byes; round 1 pairs the rest
--         OUTSIDE-IN — 2 → 1v2 · 4 → 1v4, 2v3 · 6 → 1–2 bye, 3v6, 4v5 ·
--         8 → 1v8, 2v7, 3v6, 4v5 · 10 → 1–6 bye, 7v10, 8v9 · 12 → 1–4 bye,
--         5v12, 6v11, 7v10, 8v9 — stored-literal goldens over the pure
--         `playoff_round_pairs_internal`.
--   (ii)  `playoff_reseed = false` = a FIXED bracket: a survivor carries its
--         LINE (the smaller seed of the game it won; a bye's line = its
--         seed) and the next round pairs lines outside-in (6 teams: the 3v6
--         winner meets seed 2, the 4v5 winner meets seed 1); `true` =
--         survivors re-ranked by ORIGINAL seed, best v worst. Divergence
--         pinned pure AND on the 6-team fixture (the 4v5 winner meets seed 1
--         under fixed, seed 2 under reseed).
--   (iii) seeds FROZEN on the rows — `matchups.home_seed` / `away_seed`
--         SMALLINT (below; bracket rows only; a bye row is `away_team_id
--         NULL` with `home_seed` — 109's bye shape, so the bye team's seed
--         is stored too). A round holding a `final` / overridden / decided
--         row is HISTORY: the sync never recomputes it (a later reopen of the
--         regular season never reseeds a written round — pinned); so is a
--         round that has ROLLED (every week correction_window / final) or
--         carries a WRITTEN score (non-NULL, not 109's DEFAULT 0) — its
--         games have been played: a prior verdict that moves after that is
--         REFUSED BY NAME (`rebuild_refused_round_played` + WARNING; the
--         commissioner's M6 edit or the round's own finalization lifts it —
--         R839, 066 L); a round that is still open with the default scores
--         is rewritten when the prior stage's verdict moved (that is (E)'s
--         rebuild — the correction close precedes any playoff kickoff).
--   (iv)  `leagues.champion_team_id UUID REFERENCES teams(id)` — a typed
--         column, not a settings key: §11.5 "Champion recorded on
--         `complete`" is a lifecycle fact the `complete` hero (§16.5.1) and
--         History (§11.6) read; a settings key would be a JSONB write no
--         CHECK guards and no FK binds to a franchise. Written in the
--         `complete` transaction, never before.
--   (v)   a retired team is never seeded — the seeds come from
--         `league_standings_internal`, whose `seated` CTE excludes
--         `status = 'retired'` (117; L.D1.10's lineage seam — D314(6), R806
--         — untouched here).
--   (vi)  status flips FORWARD ONLY — in_season → playoffs at the round-1
--         write, playoffs → complete at the champion; each an UPDATE whose
--         WHERE names the FROM status with ROW_COUNT asserted; a `complete`
--         league is never claimed (`not_in_play`); `playoffs → in_season` is
--         §7.1's audited commissioner override (M6), no job path exists.
--   (vii) the HOME side of a bracket game is the higher seed (§11.7's
--         home/away alternation is the regular season's).
--
-- D137 PROVENANCE (`derive_118.py`, PR body — re-runnable; `verify` mode
-- asserts this file carries each derived body byte-for-byte): SIX replaced
-- functions, each extracted verbatim from the CURRENT FILE TEXT of its newest
-- defining migration (md5-asserted at derivation: 116
-- 3728ee39c2fb305baa974357150a9668 · 117 6198b88139d063e922997c8c8272a740 ·
-- 077 9560e204f05d69922cc834b42076a555 · 105
-- 23f7b3e467240e813ed283487c706882), NOT from `pg_get_functiondef`
-- (CLAUDE.md); no source file is edited.
--   1. `week_results_write_internal` (117): TWO hunks — the h2h INSERT's
--      p/s SELECT becomes a read of `week_results_derive_internal(…, FALSE)`
--      (the SELECT lifted THERE verbatim), the median arithmetic becomes
--      `week_median_internal(v_arr)`. Every other byte 117's (the shape
--      guards, the ON CONFLICT, the total_points arm, the row-count checks).
--   2. `league_standings` (117) → `league_standings_internal(uuid, boolean)`
--      (a PLAIN, REVOKEd helper; the chain byte-for-byte): the `rows_` scan
--      becomes `final_` (117's scan) ∪ the PROJECTED arm (open regular-season
--      weeks through the derive helper + the median helper); the payload
--      gains `projected` / `weeks_projected`; `reason` counts both. The
--      member check moves to two thin DEFINER wrappers — `league_standings
--      (uuid)` (its 117 signature and output for the default arm, so 065's
--      A3/A6 and every consumer hold) and `league_standings_projected(uuid)`.
--   3. `league_week_advance` (116): the sync after the F238 block — inside
--      the league's subtransaction, in its OWN guarded block; four payload
--      keys (`brackets`, `bracket_failures`, and — R841 — `bracket_blocked`
--      for a seedless row / a refused rewrite, `bracket_waiting` for a
--      pending prior stage, each + WARNING); `nothing_due` counts a bracket
--      action. The claim loop, (a)/(b), the auto-carry, F238: 116's bytes.
--   4. `finalize_matchups` (117): the sync after the league's weeks loop
--      (same guard shape); the same four payload keys; `nothing_finalized`
--      counts a bracket action. Gates, claims, skips, the F4 flip, the E43 note, the
--      F244 locals: 117's bytes (the F244 fix is NOT regressed — the merge
--      after the subtransaction is byte-identical; 065 C1–C1d green).
--   5. `create_league` (077): ONE hunk after the Q10 backstops — the (C)
--      refusal. 6. `update_league_settings` (105): the same hunk. Both keep
--      their signatures (CREATE OR REPLACE keeps the ACLs; 060/061's REVOKEs
--      stand).
--
-- WHAT THIS MIGRATION DOES
--   1. Columns: `leagues.champion_team_id` (iv), `matchups.home_seed` /
--      `away_seed` + their CHECKs (iii).
--   2. `week_median_internal(numeric[])` — the ONE median arithmetic (117's
--      block lifted; a SORTED array in; NULL under two scores). IMMUTABLE.
--   3. `week_results_derive_internal(league, season, week, projected)` — the
--      ONE row derivation: h2h from the matchups AS WRITTEN (117's p/s SELECT
--      lifted verbatim over a `mm` CTE); `projected = TRUE` reads a NULL
--      `result` from the scores through `matchup_result_internal` (E38) and
--      a NULL score as 0.00 so far; total_points from the worker's rows.
--   4. `week_results_write_internal` — REPLACED (above).
--   5. `league_standings_internal` + the two wrappers — REPLACED / NEW
--      (above). The §22.4 single-scan claim holds for the default arm
--      (`final_` is the one `team_week_results` read; every later reference
--      a CTE scan); the projected arm adds one `matchups` read per open week.
--   6. `playoff_bracket_size_internal(pt)` — 2^rounds (0 under 2).
--      `playoff_round_pairs_internal(entrants, bracket, key)` — the pure
--      pairing rule ((i)/(ii)): byes to the top, the rest outside-in by
--      `seed` (reseed) or `line` (fixed); refuses an impossible shape.
--   7. `playoff_bracket_state_internal(league)` — the READ MODEL, computed
--      from the stored rows: per round its weeks (status, `rollover_at`,
--      `corrections_close_at`), its games with seeds / per-week rows /
--      the two-week totals (B) / the verdict ((A): `decided_by` points ·
--      higher_seed · bye) / `final`, the survivors it hands the next round
--      (seed + line), `foreign_rows` (a playoff row with NO seed — not the
--      engine's; named, never touched), `next_round`, the projected
--      champion. STABLE, plain, REVOKEd.
--   8. `playoff_bracket_sync_internal(league, p_now)` — the ONE writer
--      (called by both jobs, idempotent): forward-only claim; (C)/(D) for
--      the no-bracket shapes; else round by round — a round whose prior
--      stage has ROLLED is built (`scheduled` into an upcoming week, `live`
--      into an open one — the advance job's (a) flips the former at open)
--      or, when open and different from what the prior stage's verdict now
--      says, REWRITTEN (delete + insert, seeds re-frozen); a decided round is
--      history, and so is a rolled or scored one — a moved verdict under it
--      is REFUSED by name (R839); a PROVISIONAL build/rebuild first asks the
--      prior stage's non-final weeks finalization's ONE pending question
--      (`week_results_pending_internal`) and WAITS by name on any pending
--      score — never a 0.00 seed, never a status flip (R840; "provisional"
--      = every score written, none yet final); the champion + `complete`
--      when the last round is `final`. Every no-op says why (`reason`),
--      every write says what (`action`).
--   9. `league_playoff_bracket(league)` — the member READ (DEFINER, in-body
--      `is_league_member` — a non-member is refused by name; REVOKE FROM
--      PUBLIC, anon): the state (7) plus, while the league is `in_season`,
--      the PROJECTED round 1 from `league_standings_internal(…, TRUE)` — "if
--      the playoffs started today" — and the instant the real one
--      materialises (`rollover_week` / `rollover_at` — NULL until ingestion
--      records the last game's end, F238's posture: named, never inferred —
--      and `corrections_close_at`). For a no-bracket league: `kind`
--      points_race / no_playoffs and the champion.
--  10. `league_week_advance` / `finalize_matchups` — REPLACED (above).
--  11. `create_league` / `update_league_settings` — REPLACED (above).
--
-- WHAT IS DELIBERATELY NOT BUILT (each an F-row or a citation): consolation
-- + third-place brackets (F212 — the columns admit the round types, nothing
-- writes them); the per-week mode that would let a total_points regular
-- season end in an H2H bracket (Q39 (C)'s RECORDED RETURN PATH — F255);
-- Q36 / Q37 / Q38 / Q40 (OPEN — Q37's cancelled week-18 game bites the last
-- round exactly as it bites any week: the R791 bound holds it by name, and
-- the sync waits); the bracket VIEW (`playoff-bracket.tsx`, the "Playoffs"
-- tab, the rollover rendered in the viewer's zone — L.D5.5, filed with this
-- PR); a system chat post at the champion (unspecced; the hero reads the
-- column); commissioner bracket edits (§10, M6 — a row they write with seeds
-- is the engine's, one without is foreign and named).
--
-- LOCK-ORDER LAW (rule 8): the sync re-takes the LEAGUE row `FOR UPDATE`
-- (the jobs already hold it — free) before any `matchups` write; the reads
-- take no locks.
--
-- NEVER-WEAKEN CHECK (rule 9): no score is computed here (verdicts read
-- stored scores, the projection reads stored scores); no `final` or
-- overridden `matchups` row is ever written by the sync (a decided round is
-- history — pinned); 116's gates/claims/skips and 117's F244 fix are their
-- own bytes (the derivation asserts it; 064 = 140 and 065 = 108 unchanged
-- and green); the F4 week guard is untouched; `league_standings(uuid)`'s
-- default output is byte-identical (065 D-cells).
--
-- FALSIFIABILITY (rule 9 / §4.3): pgTAP 066 — form pins (DEFINER /
-- search_path / REVOKE shapes; the prosrc pins: both jobs call the sync by
-- name, the write helper reads the derive helper and the median helper and
-- carries no median arithmetic, the standings chain lives in exactly one
-- prosrc); the pure goldens ((i) per size, (ii) pure); a four-league season
-- as STORED LITERALS on the 2026 calendar driven through the REAL jobs at
-- literal instants (−1s twins on the rollover and the close — D146): the
-- projected standings (a live week counts, an upcoming one never, a NULL
-- score is 0.00 so far, the median re-derived ≡ finalization's), the
-- season-long projected bracket read, the provisional round 1 at the
-- rollover (from a table the final arm orders differently — the DoD's tie
-- fixture: a clean two-team tie seeded by head-to-head), the status flip,
-- the correction that moves seed 6 and the rebuild at the close, the
-- foreign-row skip and its retry, the (A) tie, the reseed on/off divergence
-- through the rewrite path, the (B) two-week sum (the week-1 loser wins the
-- aggregate; the equal-sum arm), the (D) champion where rank 1 and the PF
-- leader DIFFER, the total_points league that never enters the bracket
-- path, the (C) refusals with their one-unit twins + the stored pair read
-- as a points race (and the sync's no-bracket arm on an IN-SEASON stored
-- pair — waiting as a points race, then (D)'s completion), the frozen
-- round under a corrupted regular season, forward-only (a complete league
-- untouched), F242's no-later-row cell; the fix round's cells — a NULL
-- score at the rollover ⇒ no build, in_season, `bracket_waiting` on both
-- jobs' payloads (R840/R841), a seedless row ⇒ `bracket_blocked` (R841),
-- and the PLAYED round under a moved prior verdict (a held last regular
-- week outliving round 1's games) ⇒ REFUSED by name, rounds 1 and 2
-- byte-identical, the block lifting at the played round's own finalize
-- (R839, 066 L). Break probes (PR body): (1) the
-- DoD's — seed from raw Win % instead of the standings → the tie-fixture
-- golden red; (2) reseed ignored → the divergence cell red; (3) F242's
-- clause deleted → the new cell red; (4) the lower seed advances a tie →
-- red; (5) the bracket built at `starts_at` → the rollover cell red; (6)
-- the (C) refusal dropped → red; (7) the R839 history guard removed → the
-- byte-identical cell red and the played rows wiped; (8) the R840 pending
-- gate removed → a 0.00 seed and a status flip (red).
--
-- Migration checklist (plan §8.1): three columns (`leagues.champion_team_id`,
-- `matchups.home_seed` / `away_seed`) + the seed CHECKs on `matchups`
-- (additive; nullable; no backfill — no row carries a bracket or a champion
-- on any chain); SEVEN new functions (two IMMUTABLE/STABLE
-- helpers, two pure playoff helpers, the state reader, the sync, the read
-- RPC) + SIX replaced (D137 provenance above); no policy, no index (the
-- bracket reads ride 109's `idx_matchups_league_week`), no trigger, no cron
-- (116's three rows stand — the sync rides the two existing jobs). RLS
-- unchanged (no client write on `matchups` / `leagues`; the read RPC is the
-- member door). Realtime: no trigger — D296 lands `matchups` broadcasts in
-- L.D1.9 (the dated D38 disposition; a bracket write has no subscriber yet).
-- Staging-clone rehearsal disposed via the R6 rule (fresh local `db reset`
-- 001–118). Typegen re-run in the same PR (the two columns; the new
-- `Functions` entries — PostgREST exposes REVOKEd helpers by signature,
-- EXECUTE gates them; the alias block re-appended; additive-only). Grants
-- doctrine (D18→D23): no per-object GRANT; every fresh CREATE REVOKEd
-- (helpers triple; the two member reads FROM PUBLIC, anon).
--
-- HELD-FROM-PRODUCTION: registered (range → 082-118) in the same PR. No
-- launch-surface table is touched: every write is on the leagues chain
-- (`leagues`, `matchups`, and through the replaced jobs `league_weeks` /
-- `team_week_results` / `team_lineups` / `league_chat`); reads outside it
-- are 116/117's SELECTs on `nfl_games` / `nfl_weeks` / `teams`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns — the champion (iv), the (C) backstop, the frozen seeds (iii)
-- ---------------------------------------------------------------------------
ALTER TABLE leagues
  ADD COLUMN champion_team_id UUID REFERENCES teams(id);
COMMENT ON COLUMN leagues.champion_team_id IS
  'Spec §11.5 "Champion recorded on complete" (v2.16.25, Q39 (D) — migration 118). Written ONLY in the transaction that flips status → complete (`playoff_bracket_sync_internal`): the winner of the last playoff round, or — with playoff_teams = 0 and for every total_points league — standings rank 1 through the FULL tiebreaker chain at the last regular-season week''s finalization. NULL until then.';

ALTER TABLE matchups
  ADD COLUMN home_seed SMALLINT CHECK (home_seed BETWEEN 1 AND 16),
  ADD COLUMN away_seed SMALLINT CHECK (away_seed BETWEEN 1 AND 16);
-- Seeds live on bracket rows only (a regular / secondary row never carries
-- one), and an away seed needs an away team (a bye row carries home_seed
-- alone — 109's `away_team_id NULL` = bye).
ALTER TABLE matchups
  ADD CONSTRAINT matchups_seeds_on_bracket_rows_only
  CHECK ((home_seed IS NULL AND away_seed IS NULL)
         OR round_type IN ('playoff', 'consolation', 'third_place'));
ALTER TABLE matchups
  ADD CONSTRAINT matchups_away_seed_needs_away_team
  CHECK (away_seed IS NULL OR away_team_id IS NOT NULL);
COMMENT ON COLUMN matchups.home_seed IS
  'Spec §11.5 / §16.2 (v2.16.25, Q39 rider (iii) — migration 118): the ORIGINAL playoff seed of the home side, FROZEN when the engine writes the round (the higher seed is home — rider (vii)); a bracket row with NO seed is not the engine''s (`foreign_rows` — named by the sync, never touched). NULL on every regular / secondary row (CHECK).';
COMMENT ON COLUMN matchups.away_seed IS
  'The away side''s ORIGINAL playoff seed (see home_seed); NULL on a bye row (`away_team_id NULL`).';

-- ---------------------------------------------------------------------------
-- 2. week_median_internal — the ONE median arithmetic (117's block lifted:
--    the EXACT average of the two middle values of a SORTED array, the middle
--    value when odd, NULL under two). IMMUTABLE, plain, REVOKEd.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION week_median_internal(p_points NUMERIC[])
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(array_length(p_points, 1), 0) < 2 THEN NULL
    WHEN array_length(p_points, 1) % 2 = 0
      THEN (p_points[array_length(p_points, 1) / 2] + p_points[array_length(p_points, 1) / 2 + 1]) / 2
    ELSE p_points[(array_length(p_points, 1) + 1) / 2] END;
$$;
REVOKE EXECUTE ON FUNCTION week_median_internal(NUMERIC[])
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. week_results_derive_internal — the ONE row derivation (117's INSERT
--    SELECT lifted verbatim over the `mm` CTE). `p_projected = FALSE`: the
--    matchups AS WRITTEN — `result` the flip's derivation or the override,
--    `home_score` / `away_score` as stored — exactly the rows 117 inserted.
--    `p_projected = TRUE` ("if the week ended now"): a NULL `result` is read
--    from the scores through `matchup_result_internal` (E38; an override's
--    stored result still stands), a NULL score is 0.00 SO FAR. total_points:
--    the worker's rows for the week AS WRITTEN (the projection's arm; the
--    write helper's total_points arm flips them and never reads this).
--    STABLE, plain, REVOKEd.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION week_results_derive_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_projected BOOLEAN
) RETURNS TABLE (
  team_id                 UUID,
  points                  NUMERIC,
  opponent_team_id        UUID,
  h2h_result              TEXT,
  second_opponent_team_id UUID,
  second_result           TEXT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH lg AS (
    SELECT COALESCE(COALESCE(l.settings, '{}'::jsonb) ->> 'schedule_mode', 'h2h') AS mode
    FROM public.leagues l WHERE l.id = p_league_id
  ),
  mm AS (
    SELECT m.round_type, m.home_team_id, m.away_team_id,
           CASE WHEN p_projected THEN COALESCE(m.home_score, 0) ELSE m.home_score END AS home_score,
           CASE WHEN p_projected THEN COALESCE(m.away_score, 0) ELSE m.away_score END AS away_score,
           CASE WHEN p_projected
                THEN COALESCE(m.result, public.matchup_result_internal(
                       COALESCE(m.home_score, 0), COALESCE(m.away_score, 0), m.away_team_id))
                ELSE m.result END AS result
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week
  ),
  h2h AS (
    SELECT p.team_id, p.points, p.opponent, p.h2h, s.opponent AS second_opponent, s.res AS second_result
    FROM (
      SELECT m.home_team_id AS team_id, round(m.home_score, 2) AS points, m.away_team_id AS opponent,
             CASE WHEN m.away_team_id IS NULL THEN 'bye'
                  WHEN m.result = 'home' THEN 'win'
                  WHEN m.result = 'away' THEN 'loss'
                  WHEN m.result = 'tie'  THEN 'tie' END AS h2h
      FROM mm m
      WHERE m.round_type <> 'secondary'
      UNION ALL
      SELECT m.away_team_id, round(m.away_score, 2), m.home_team_id,
             CASE WHEN m.result = 'away' THEN 'win'
                  WHEN m.result = 'home' THEN 'loss'
                  WHEN m.result = 'tie'  THEN 'tie' END
      FROM mm m
      WHERE m.round_type <> 'secondary' AND m.away_team_id IS NOT NULL
    ) p
    LEFT JOIN (
      SELECT m.home_team_id AS team_id, m.away_team_id AS opponent,
             CASE WHEN m.result = 'home' THEN 'win' WHEN m.result = 'away' THEN 'loss'
                  WHEN m.result = 'tie' THEN 'tie' END AS res
      FROM mm m
      WHERE m.round_type = 'secondary'
      UNION ALL
      SELECT m.away_team_id, m.home_team_id,
             CASE WHEN m.result = 'away' THEN 'win' WHEN m.result = 'home' THEN 'loss'
                  WHEN m.result = 'tie' THEN 'tie' END
      FROM mm m
      WHERE m.round_type = 'secondary' AND m.away_team_id IS NOT NULL
    ) s ON s.team_id = p.team_id
  ),
  tp AS (
    SELECT r.team_id, r.points, r.opponent_team_id, r.h2h_result, r.second_opponent_team_id, r.second_result
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = p_season AND r.week = p_week
  )
  SELECT h.team_id, h.points, h.opponent, h.h2h, h.second_opponent, h.second_result
  FROM h2h h, lg WHERE lg.mode = 'h2h'
  UNION ALL
  SELECT t.team_id, t.points, t.opponent_team_id, t.h2h_result, t.second_opponent_team_id, t.second_result
  FROM tp t, lg WHERE lg.mode <> 'h2h';
$$;
REVOKE EXECUTE ON FUNCTION week_results_derive_internal(UUID, INTEGER, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. week_results_write_internal — REPLACED against 117's FILE TEXT (D137;
--    two asserted hunks — the banner). Every byte not named there is 117's.
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
    -- 118 (D137): the row derivation is `week_results_derive_internal`
    -- (117's p/s SELECT lifted there verbatim; `p_projected = FALSE` reads
    -- `matchups.result` AS WRITTEN exactly as this INSERT did) — ONE
    -- derivation for finalization, the rebuild AND the projected standings.
    SELECT p_league_id, d.team_id, p_season, p_week, d.points, d.opponent_team_id, d.h2h_result,
           d.second_opponent_team_id, d.second_result, TRUE
    FROM public.week_results_derive_internal(p_league_id, p_season, p_week, FALSE) d
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
      -- 118 (D137): the ONE median arithmetic, shared with the projection.
      v_median := public.week_median_internal(v_arr);
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
-- 5. league_standings_internal — 117's `league_standings` REPLACED as a
--    PLAIN helper with the projected arm (D137; the asserted hunks in the
--    banner; the chain byte-for-byte). Then the two thin DEFINER wrappers:
--    `league_standings(uuid)` keeps 117's signature, authority and default
--    output (065 A1/A3/A6 and every consumer hold); `league_standings_
--    projected(uuid)` is the F253(a) arm — "if the season ended now".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_standings_internal(p_league_id UUID, p_projected BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
  v_median_on BOOLEAN;
  v_weeks_proj INTEGER;
BEGIN
  -- 118: the member check lives in the two DEFINER wrappers
  -- (`league_standings` / `league_standings_projected`); this helper is
  -- REVOKEd and reached through them, the jobs and the harness only.
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_standings: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode     := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  v_median_on := COALESCE((v_settings ->> 'median_game')::boolean, FALSE);
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
  final_ AS MATERIALIZED (   -- THE scan: idx_twr_league_season (league_id, season, week)
    SELECT r.team_id, r.week, r.points, r.opponent_team_id, r.h2h_result, r.median_result,
           r.second_opponent_team_id, r.second_result
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = v_league.season
      AND r.week >= v_first AND r.week <= v_last
      AND r.is_final
  ),
  -- 118 (F253(a) / Q39(E)): the PROJECTED arm — "if the season ended now".
  -- An OPEN regular-season week (live / correction_window) holding no final
  -- row is derived through the SAME helper finalization writes from
  -- (`week_results_derive_internal`, D137): h2h from the matchups AS
  -- WRITTEN with a NULL result read from the scores (E38) and a NULL score
  -- read as 0.00 SO FAR (a projection is not a finalization — E61's
  -- pending word is finalize's); total_points from the worker's provisional
  -- rows; the median re-derived per week through `week_median_internal`.
  -- An `upcoming` week NEVER counts (unplayed); a reopened week (final rows
  -- present) reads its final rows. Empty when p_projected is FALSE — the
  -- default arm is 117's scan, byte for byte.
  proj_weeks AS (
    SELECT lw.week
    FROM public.league_weeks lw
    WHERE p_projected
      AND lw.league_id = p_league_id AND lw.season = v_league.season
      AND lw.week >= v_first AND lw.week <= v_last
      AND lw.status IN ('live', 'correction_window')
      AND NOT EXISTS (SELECT 1 FROM final_ f WHERE f.week = lw.week)
  ),
  proj_raw AS (
    SELECT pw.week, d.team_id, d.points, d.opponent_team_id, d.h2h_result,
           d.second_opponent_team_id, d.second_result
    FROM proj_weeks pw
    CROSS JOIN LATERAL public.week_results_derive_internal(p_league_id, v_league.season, pw.week, TRUE) d
  ),
  proj_med AS (
    SELECT pr.week, public.week_median_internal(array_agg(pr.points ORDER BY pr.points)) AS med
    FROM proj_raw pr GROUP BY pr.week
  ),
  rows_ AS MATERIALIZED (
    SELECT f.team_id, f.week, f.points, f.opponent_team_id, f.h2h_result, f.median_result,
           f.second_opponent_team_id, f.second_result
    FROM final_ f
    UNION ALL
    SELECT pr.team_id, pr.week, pr.points, pr.opponent_team_id, pr.h2h_result,
           CASE WHEN v_median_on AND pm.med IS NOT NULL THEN
             CASE WHEN pr.points > pm.med THEN 'win' WHEN pr.points < pm.med THEN 'loss' ELSE 'tie' END
           END,
           pr.second_opponent_team_id, pr.second_result
    FROM proj_raw pr JOIN proj_med pm ON pm.week = pr.week
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
    (SELECT count(DISTINCT f.week)::int FROM final_ f),
    (SELECT count(*)::int FROM proj_weeks)
  INTO v_rows, v_skipped, v_pa_gaps, v_weeks, v_weeks_proj;

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
    'projected',        p_projected,
    'weeks_projected',  v_weeks_proj,
    'chain',            v_chain_js,
    'chain_appended',   to_jsonb(v_appended),
    'coin_flip_seed',   v_seed,
    'coin_flip_seed_source', v_seed_src,
    'skipped',          v_skipped,
    'pa_gaps',          v_pa_gaps,
    'standings',        v_rows,
    'reason',           CASE WHEN v_weeks = 0 AND v_weeks_proj = 0 THEN 'no_final_weeks' ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_standings_internal(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION league_standings(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'league_standings: only a member of the league may read its standings'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.league_standings_internal(p_league_id, FALSE);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_standings(UUID) FROM PUBLIC, anon;

-- The projected arm (F253(a) / Q39 (E)): the same chain over the final rows
-- PLUS every OPEN regular-season week derived "as if it ended now". A member
-- READ with 117's authority shape; the payload says `projected: true` and
-- how many weeks are projected — a consumer must label it provisional.
CREATE OR REPLACE FUNCTION league_standings_projected(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'league_standings_projected: only a member of the league may read its standings'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.league_standings_internal(p_league_id, TRUE);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_standings_projected(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 6. The pure playoff helpers — rider (i) / (ii)
-- ---------------------------------------------------------------------------

-- 6a. The bracket: 2^rounds (110's `schedule_playoff_rounds`); 0 under two
--     playoff teams (no bracket — (D)).
CREATE OR REPLACE FUNCTION playoff_bracket_size_internal(p_playoff_teams INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_playoff_teams IS NULL OR p_playoff_teams < 2 THEN 0
              ELSE (2 ^ public.schedule_playoff_rounds(p_playoff_teams))::int END;
$$;
REVOKE EXECUTE ON FUNCTION playoff_bracket_size_internal(INTEGER)
  FROM PUBLIC, anon, authenticated;

-- 6b. One round's pairings from its entrants. `p_entrants` is a JSON array of
--     `{team_id, seed, line}`; `p_key` is 'seed' (reseed: survivors re-ranked
--     by ORIGINAL seed, best v worst) or 'line' (fixed bracket: survivors
--     keep the LINE of the game they won — the smaller seed in it — and
--     lines pair outside-in). Byes = p_bracket − entrants, to the best keys
--     (round 1 only in practice — a later round's entrant count IS its
--     bracket). Returns `[{home, away}]`, byes first (`away` null), then the
--     games outside-in; home = the better key (rider (vii)). Refuses an
--     impossible shape by name — a bracket smaller than its entrants, byes
--     that outnumber games, an odd game count, a duplicate key.
CREATE OR REPLACE FUNCTION playoff_round_pairs_internal(
  p_entrants JSONB,
  p_bracket  INTEGER,
  p_key      TEXT
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_sorted JSONB;
  v_n      INTEGER;
  v_keys   INTEGER;
  v_byes   INTEGER;
  v_games  INTEGER;
  v_out    JSONB := '[]'::jsonb;
  i        INTEGER;
BEGIN
  IF p_key NOT IN ('seed', 'line') THEN
    RAISE EXCEPTION 'playoff_round_pairs_internal: key % — expected seed (reseed) or line (fixed bracket)', p_key
      USING ERRCODE = '22023';
  END IF;
  IF p_entrants IS NULL OR jsonb_typeof(p_entrants) <> 'array' THEN
    RAISE EXCEPTION 'playoff_round_pairs_internal: entrants must be a JSON array'
      USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(e ORDER BY (e ->> p_key)::int, e ->> 'team_id'), '[]'::jsonb),
         count(*)::int, count(DISTINCT (e ->> p_key)::int)::int
    INTO v_sorted, v_n, v_keys
  FROM jsonb_array_elements(p_entrants) e;
  IF v_n = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF v_keys <> v_n THEN
    RAISE EXCEPTION 'playoff_round_pairs_internal: % entrants carry only % distinct % keys — a seed is unique by construction (§7.3.7)', v_n, v_keys, p_key
      USING ERRCODE = 'P0001';
  END IF;
  IF p_bracket IS NULL OR p_bracket < v_n THEN
    RAISE EXCEPTION 'playoff_round_pairs_internal: bracket % is smaller than its % entrants', p_bracket, v_n
      USING ERRCODE = 'P0001';
  END IF;
  v_byes  := p_bracket - v_n;
  v_games := v_n - v_byes;
  IF v_games < 0 OR v_games % 2 <> 0 OR (v_byes > 0 AND v_byes >= v_n) THEN
    RAISE EXCEPTION 'playoff_round_pairs_internal: bracket % with % entrants gives % byes and % game slots — not a bracket (§7.3.1 playoff_byes: byes = bracket − playoff_teams to the top seeds)', p_bracket, v_n, v_byes, v_games
      USING ERRCODE = 'P0001';
  END IF;
  FOR i IN 0 .. v_byes - 1 LOOP
    v_out := v_out || jsonb_build_object('home', v_sorted -> i, 'away', NULL);
  END LOOP;
  FOR i IN 0 .. v_games / 2 - 1 LOOP
    v_out := v_out || jsonb_build_object('home', v_sorted -> (v_byes + i), 'away', v_sorted -> (v_n - 1 - i));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION playoff_round_pairs_internal(JSONB, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. playoff_bracket_state_internal — the READ MODEL from the stored rows.
--    Nothing here is computed from a clock: a week's "rolled" is its
--    `league_weeks.status` (116 flips it on `last_game_ends_at`), a game's
--    verdict is read from its stored scores ((A)/(B): the sum over the
--    round's weeks rounded to two decimals per week; equal ⇒ the higher
--    seed; a bye ⇒ the home side), and `final` means every row of the game
--    is `final`. The survivors it hands the next round carry `seed` (the
--    ORIGINAL seed) and `line` (the smaller seed of the game won; a bye's
--    own seed). A playoff row with NO seed is not the engine's — counted as
--    `foreign_rows`, never read. STABLE, plain, REVOKEd.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION playoff_bracket_state_internal(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_settings   JSONB;
  v_mode       TEXT;
  v_pt         INTEGER;
  v_wpr        INTEGER;
  v_reseed     BOOLEAN;
  v_b          INTEGER;
  v_rounds     INTEGER;
  v_first      INTEGER;
  v_last_reg   INTEGER;
  v_pstart     INTEGER;
  v_reg_rolled BOOLEAN;
  v_reg_final  BOOLEAN;
  v_reg_weeks  INTEGER;
  v_reg_roll_at TIMESTAMPTZ;
  v_reg_close  TIMESTAMPTZ;
  v_r          INTEGER;
  v_wk_first   INTEGER;
  v_wk_last    INTEGER;
  v_weeks      JSONB;
  v_wcount     INTEGER;
  v_rolled     BOOLEAN;
  v_roll_at    TIMESTAMPTZ;
  v_close_at   TIMESTAMPTZ;
  v_foreign    INTEGER;
  v_pair       RECORD;
  v_rows       JSONB;
  v_home_total NUMERIC;
  v_away_total NUMERIC;
  v_pair_final BOOLEAN;
  v_pair_weeks INTEGER;
  v_winner     UUID;
  v_winner_seed INTEGER;
  v_decided    TEXT;
  v_games      JSONB;
  v_all_final  BOOLEAN;
  v_survivors  JSONB;
  v_round_list JSONB := '[]'::jsonb;
  v_built      BOOLEAN;
  v_next_round INTEGER := NULL;
  v_prev_rolled BOOLEAN;
  v_prev_final BOOLEAN;
  v_entrants   JSONB := NULL;
  v_champion   UUID := NULL;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'playoff_bracket_state_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode     := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  v_pt       := COALESCE(v_league.playoff_teams, 0);
  v_wpr      := COALESCE((v_settings ->> 'playoff_weeks_per_round')::int, 1);
  v_reseed   := COALESCE((v_settings ->> 'playoff_reseed')::boolean, TRUE);
  v_b        := public.playoff_bracket_size_internal(v_pt);
  v_rounds   := public.schedule_playoff_rounds(v_pt);

  -- The season in NFL-week terms (D288): first week … first + rsw − 1 is
  -- the regular season; the bracket starts the week after.
  SELECT min(lw.week) INTO v_first
  FROM public.league_weeks lw WHERE lw.league_id = p_league_id AND lw.season = v_league.season;
  v_last_reg := v_first + v_league.regular_season_weeks - 1;
  v_pstart   := v_last_reg + 1;

  -- The regular season's stage: ROLLED when every regular week has closed
  -- (correction_window / final — 116's (b) at last_game_ends_at); FINAL when
  -- every one is final. The instants are the LAST regular week's.
  SELECT bool_and(lw.status IN ('correction_window', 'final')), bool_and(lw.status = 'final'), count(*)::int
    INTO v_reg_rolled, v_reg_final, v_reg_weeks
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season
    AND lw.week >= v_first AND lw.week <= v_last_reg;
  SELECT w.last_game_ends_at, w.correction_window_ends_at INTO v_reg_roll_at, v_reg_close
  FROM public.nfl_weeks w WHERE w.season = v_league.season AND w.week = v_last_reg;
  v_reg_rolled := COALESCE(v_reg_rolled, FALSE) AND v_reg_weeks = v_league.regular_season_weeks;
  v_reg_final  := COALESCE(v_reg_final, FALSE)  AND v_reg_weeks = v_league.regular_season_weeks;

  -- (C)/(D): no bracket — the points race / the standings are the playoff.
  IF v_mode <> 'h2h' OR v_pt < 2 THEN
    RETURN jsonb_build_object(
      'league_id',              p_league_id,
      'season',                 v_league.season,
      'kind',                   CASE WHEN v_mode <> 'h2h' THEN 'points_race' ELSE 'no_playoffs' END,
      'status',                 v_league.status,
      'schedule_mode',          v_mode,
      'playoff_teams',          v_pt,
      'regular_season',         jsonb_build_object('first_week', v_first, 'last_week', v_last_reg),
      'regular_season_rolled',  v_reg_rolled,
      'regular_season_final',   v_reg_final,
      'rollover_week',          v_last_reg,
      'rollover_at',            v_reg_roll_at,
      'corrections_close_at',   v_reg_close,
      'champion_team_id',       v_league.champion_team_id);
  END IF;

  v_prev_rolled := v_reg_rolled;
  v_prev_final  := v_reg_final;

  FOR v_r IN 1 .. v_rounds LOOP
    v_wk_first := v_pstart + (v_r - 1) * v_wpr;
    v_wk_last  := v_wk_first + v_wpr - 1;

    SELECT jsonb_agg(jsonb_build_object(
             'week', lw.week, 'status', lw.status,
             'rollover_at', w.last_game_ends_at, 'corrections_close_at', w.correction_window_ends_at)
             ORDER BY lw.week),
           count(*)::int,
           bool_and(lw.status IN ('correction_window', 'final'))
      INTO v_weeks, v_wcount, v_rolled
    FROM public.league_weeks lw
    JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season
      AND lw.week >= v_wk_first AND lw.week <= v_wk_last;
    IF v_wcount <> v_wpr THEN
      RAISE EXCEPTION 'playoff_bracket_state_internal: league % round % spans NFL weeks %..% but league_weeks holds % of % rows — the plan (110) is defective', p_league_id, v_r, v_wk_first, v_wk_last, v_wcount, v_wpr
        USING ERRCODE = 'P0001';
    END IF;
    v_rolled := COALESCE(v_rolled, FALSE);
    SELECT w.last_game_ends_at, w.correction_window_ends_at INTO v_roll_at, v_close_at
    FROM public.nfl_weeks w WHERE w.season = v_league.season AND w.week = v_wk_last;

    SELECT count(*)::int INTO v_foreign
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.week >= v_wk_first AND m.week <= v_wk_last
      AND m.round_type = 'playoff' AND m.home_seed IS NULL;

    v_games := '[]'::jsonb;
    v_survivors := '[]'::jsonb;
    v_all_final := TRUE;
    FOR v_pair IN
      SELECT m.home_team_id, m.away_team_id, m.home_seed, m.away_seed
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season
        AND m.week >= v_wk_first AND m.week <= v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
      GROUP BY m.home_team_id, m.away_team_id, m.home_seed, m.away_seed
      ORDER BY m.home_seed, m.away_seed NULLS FIRST
    LOOP
      SELECT jsonb_agg(jsonb_build_object(
               'week', m.week, 'matchup_id', m.id,
               'home_score', m.home_score, 'away_score', m.away_score,
               'status', m.status, 'result', m.result, 'is_overridden', m.is_overridden)
               ORDER BY m.week),
             sum(round(COALESCE(m.home_score, 0), 2)),
             sum(round(COALESCE(m.away_score, 0), 2)),
             bool_and(m.status = 'final'),
             count(*)::int
        INTO v_rows, v_home_total, v_away_total, v_pair_final, v_pair_weeks
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season
        AND m.week >= v_wk_first AND m.week <= v_wk_last
        AND m.round_type = 'playoff'
        AND m.home_team_id = v_pair.home_team_id
        AND m.away_team_id IS NOT DISTINCT FROM v_pair.away_team_id;

      -- The verdict — (B) the sum; (A) equal ⇒ the higher seed (the smaller
      -- number); a bye ⇒ the home side. The stored `result` is NOT consulted
      -- and never rewritten: each week's row keeps its own W/L/T (E38).
      IF v_pair.away_team_id IS NULL THEN
        v_winner := v_pair.home_team_id; v_winner_seed := v_pair.home_seed; v_decided := 'bye';
      ELSIF v_home_total > v_away_total THEN
        v_winner := v_pair.home_team_id; v_winner_seed := v_pair.home_seed; v_decided := 'points';
      ELSIF v_home_total < v_away_total THEN
        v_winner := v_pair.away_team_id; v_winner_seed := v_pair.away_seed; v_decided := 'points';
      ELSIF v_pair.home_seed < v_pair.away_seed THEN
        v_winner := v_pair.home_team_id; v_winner_seed := v_pair.home_seed; v_decided := 'higher_seed';
      ELSE
        v_winner := v_pair.away_team_id; v_winner_seed := v_pair.away_seed; v_decided := 'higher_seed';
      END IF;
      v_pair_final := v_pair_final AND v_pair_weeks = v_wpr;

      v_games := v_games || jsonb_build_object(
        'home_team_id',   v_pair.home_team_id,
        'home_seed',      v_pair.home_seed,
        'away_team_id',   v_pair.away_team_id,
        'away_seed',      v_pair.away_seed,
        'weeks',          v_rows,
        'home_total',     v_home_total,
        'away_total',     v_away_total,
        'winner_team_id', v_winner,
        'decided_by',     v_decided,
        'final',          v_pair_final);
      v_all_final := v_all_final AND v_pair_final;
      v_survivors := v_survivors || jsonb_build_object(
        'team_id', v_winner,
        'seed',    v_winner_seed,
        'line',    LEAST(v_pair.home_seed, COALESCE(v_pair.away_seed, v_pair.home_seed)));
    END LOOP;

    v_built := jsonb_array_length(v_games) > 0;
    IF v_next_round IS NULL AND NOT v_built THEN
      v_next_round := v_r;
    END IF;
    v_round_list := v_round_list || jsonb_build_object(
      'round',                v_r,
      'weeks',                v_weeks,
      'rollover_at',          v_roll_at,
      'corrections_close_at', v_close_at,
      'rolled',               v_rolled,
      'built',                v_built,
      'final',                v_built AND v_all_final,
      'source',               CASE WHEN NOT v_built THEN NULL WHEN v_prev_final THEN 'final' ELSE 'provisional' END,
      'prior_stage_rolled',   v_prev_rolled,
      'prior_stage_final',    v_prev_final,
      'expected_games',       v_b / (2 ^ v_r)::int,
      'foreign_rows',         v_foreign,
      'games',                v_games,
      'survivors',            v_survivors);
    IF v_built THEN
      v_entrants := v_survivors;
    END IF;
    IF v_r = v_rounds AND v_built AND v_all_final AND jsonb_array_length(v_games) = 1 THEN
      v_champion := (v_games -> 0 ->> 'winner_team_id')::uuid;
    END IF;
    v_prev_rolled := v_built AND v_rolled;
    v_prev_final  := v_built AND v_all_final;
  END LOOP;

  RETURN jsonb_build_object(
    'league_id',              p_league_id,
    'season',                 v_league.season,
    'kind',                   'bracket',
    'status',                 v_league.status,
    'schedule_mode',          v_mode,
    'playoff_teams',          v_pt,
    'bracket_size',           v_b,
    'rounds',                 v_rounds,
    'weeks_per_round',        v_wpr,
    'reseed',                 v_reseed,
    'playoff_start_week',     v_pstart,
    'regular_season',         jsonb_build_object('first_week', v_first, 'last_week', v_last_reg),
    'regular_season_rolled',  v_reg_rolled,
    'regular_season_final',   v_reg_final,
    'rollover_week',          v_last_reg,
    'rollover_at',            v_reg_roll_at,
    'corrections_close_at',   v_reg_close,
    'round_list',             v_round_list,
    'next_round',             v_next_round,
    'entrants_next',          v_entrants,
    'champion_team_id',       v_league.champion_team_id,
    'bracket_champion_team_id', v_champion);
END;
$$;
REVOKE EXECUTE ON FUNCTION playoff_bracket_state_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. playoff_bracket_sync_internal — the ONE writer of bracket rows, the
--    status flips and the champion. Called by `league_week_advance` (the
--    rollover) and `finalize_matchups` (the correction close) for every
--    claimed league, every run; idempotent — every no-op names its reason,
--    every write names its action. Plain, REVOKEd (reached through the two
--    DEFINER jobs and the harness).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION playoff_bracket_sync_internal(
  p_league_id UUID,
  p_now       TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_settings  JSONB;
  v_mode      TEXT;
  v_pt        INTEGER;
  v_wpr       INTEGER;
  v_reseed    BOOLEAN;
  v_key       TEXT;
  v_b         INTEGER;
  v_rounds    INTEGER;
  v_state     JSONB;
  v_st        JSONB;
  v_round     JSONB;
  v_r         INTEGER;
  v_prev_rolled BOOLEAN;
  v_prev_final  BOOLEAN;
  v_prev_roll_at TIMESTAMPTZ;
  v_entrants  JSONB;
  v_desired   JSONB;
  v_desired_txt TEXT;
  v_stored_txt  TEXT;
  v_decided   INTEGER;
  v_cnt       INTEGER;
  v_expected  INTEGER;
  v_wk_first  INTEGER;
  v_wk_last   INTEGER;
  v_champion  UUID;
  v_n         INTEGER;
  v_open      JSONB;
  v_played    INTEGER;
  v_pending   JSONB;
  v_pend      JSONB;
  v_w         RECORD;
  v_prev_wk_first INTEGER;
  v_prev_wk_last  INTEGER;
BEGIN
  -- Rule 8: the league row first (the jobs hold it already — free).
  SELECT l.* INTO v_league FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'playoff_bracket_sync_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  -- (vi) forward only: a complete league is never claimed; a pre-season one
  -- has nothing to sync.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RETURN jsonb_build_object('reason', 'not_in_play', 'status', v_league.status);
  END IF;

  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode     := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  v_pt       := COALESCE(v_league.playoff_teams, 0);
  v_wpr      := COALESCE((v_settings ->> 'playoff_weeks_per_round')::int, 1);
  v_reseed   := COALESCE((v_settings ->> 'playoff_reseed')::boolean, TRUE);
  v_key      := CASE WHEN v_reseed THEN 'seed' ELSE 'line' END;
  v_b        := public.playoff_bracket_size_internal(v_pt);
  v_rounds   := public.schedule_playoff_rounds(v_pt);

  v_state := public.playoff_bracket_state_internal(p_league_id);
  IF (v_state -> 'regular_season' ->> 'first_week') IS NULL THEN
    RETURN jsonb_build_object('reason', 'no_season');
  END IF;

  -- (C)/(D): NO bracket. The champion is standings rank 1 through the FULL
  -- chain (117's final arm — never the projection) at the instant the LAST
  -- regular-season week is `final` — every regular week final, so a held
  -- earlier week (a named finalize skip) still waits; in_season → complete
  -- in this transaction.
  IF v_mode <> 'h2h' OR v_pt < 2 THEN
    IF v_league.status <> 'in_season' THEN
      -- A total_points / no-playoff league is never `playoffs` by any job
      -- path; if one is, say so rather than crown anybody.
      RETURN jsonb_build_object('reason', 'no_bracket_league_not_in_season', 'status', v_league.status,
                                'kind', v_state ->> 'kind');
    END IF;
    IF NOT (v_state ->> 'regular_season_final')::boolean THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb)
        INTO v_open
      FROM public.league_weeks lw
      WHERE lw.league_id = p_league_id AND lw.season = v_league.season
        AND lw.week >= (v_state -> 'regular_season' ->> 'first_week')::int
        AND lw.week <= (v_state -> 'regular_season' ->> 'last_week')::int
        AND lw.status <> 'final';
      RETURN jsonb_build_object('reason', 'waiting_regular_season', 'kind', v_state ->> 'kind', 'open_weeks', v_open);
    END IF;
    v_st := public.league_standings_internal(p_league_id, FALSE);
    v_champion := (v_st -> 'standings' -> 0 ->> 'team_id')::uuid;
    IF v_champion IS NULL THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: league % — the regular season is final but the standings hold no row (no seated team?)', p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.leagues
    SET status = 'complete', champion_team_id = v_champion, updated_at = p_now
    WHERE id = p_league_id AND status = 'in_season';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: completing league % touched % rows, expected 1', p_league_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'action', 'complete', 'kind', v_state ->> 'kind', 'basis', 'standings_rank_1',
      'champion_team_id', v_champion, 'from_status', 'in_season',
      'separated_by', v_st -> 'standings' -> 0 -> 'separated_by');
  END IF;

  -- The bracket. Round r is due the moment its prior stage (the regular
  -- season for r = 1, round r − 1 after) has ROLLED — every week closed at
  -- last_game_ends_at; built from the PROVISIONAL verdict then and REBUILT
  -- from the FINAL one at the close if the pairing moved. A round holding a
  -- decided row (final / overridden / a written result) is history.
  IF NOT (v_state ->> 'regular_season_rolled')::boolean THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb)
      INTO v_open
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season
      AND lw.week >= (v_state -> 'regular_season' ->> 'first_week')::int
      AND lw.week <= (v_state -> 'regular_season' ->> 'last_week')::int
      AND lw.status NOT IN ('correction_window', 'final');
    RETURN jsonb_build_object('reason', 'waiting_regular_season', 'kind', 'bracket', 'open_weeks', v_open);
  END IF;

  v_prev_rolled  := TRUE;
  v_prev_final   := (v_state ->> 'regular_season_final')::boolean;
  v_prev_roll_at := (v_state ->> 'rollover_at')::timestamptz;
  v_entrants     := NULL;

  FOR v_r IN 1 .. v_rounds LOOP
    v_round    := v_state -> 'round_list' -> (v_r - 1);
    v_wk_first := (v_state ->> 'playoff_start_week')::int + (v_r - 1) * v_wpr;
    v_wk_last  := v_wk_first + v_wpr - 1;

    -- A playoff row the engine did not write (no seed) — named, never
    -- touched; the round is left alone until a human removes or seeds it.
    IF (v_round ->> 'foreign_rows')::int > 0 THEN
      RETURN jsonb_build_object('reason', 'bracket_foreign_rows', 'round', v_r,
                                'rows', (v_round ->> 'foreign_rows')::int,
                                'weeks', jsonb_build_array(v_wk_first, v_wk_last));
    END IF;

    IF NOT v_prev_rolled THEN
      RETURN jsonb_build_object('reason', 'waiting_round', 'round', v_r - 1);
    END IF;

    -- A decided round is history (rider (iii)): never recomputed, never
    -- compared — its survivors feed the next round.
    SELECT count(*)::int INTO v_decided
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.week >= v_wk_first AND m.week <= v_wk_last
      AND m.round_type = 'playoff'
      AND (m.status = 'final' OR m.is_overridden OR m.result IS NOT NULL);
    IF v_decided > 0 THEN
      IF v_r = v_rounds AND (v_round ->> 'final')::boolean THEN
        EXIT;   -- the champion, below
      END IF;
      v_entrants    := v_round -> 'survivors';
      v_prev_rolled := (v_round ->> 'rolled')::boolean;
      v_prev_final  := (v_round ->> 'final')::boolean;
      v_prev_roll_at := (v_round ->> 'rollover_at')::timestamptz;
      CONTINUE;
    END IF;

    -- R840 (§23.2 / E61): a PROVISIONAL build or rebuild is never seeded
    -- from an ABSENT score. "Provisional" means every score of the prior
    -- stage is WRITTEN and none is yet final — so before either write the
    -- prior stage's non-final weeks are asked the ONE pending question
    -- finalization asks (`week_results_pending_internal`, D137: a NULL
    -- score on any matchup / a seated team without a result row); any
    -- pending ⇒ the bracket WAITS by name — nothing written, no status
    -- flip, retried next run. (The projected READ still shows 0.00 so far —
    -- a view, never a write.) A FINAL prior stage passed this gate when it
    -- finalized.
    IF NOT v_prev_final THEN
      IF v_r = 1 THEN
        v_prev_wk_first := (v_state -> 'regular_season' ->> 'first_week')::int;
        v_prev_wk_last  := (v_state -> 'regular_season' ->> 'last_week')::int;
      ELSE
        v_prev_wk_first := v_wk_first - v_wpr;
        v_prev_wk_last  := v_wk_first - 1;
      END IF;
      v_pending := '[]'::jsonb;
      FOR v_w IN
        SELECT lw.week
        FROM public.league_weeks lw
        WHERE lw.league_id = p_league_id AND lw.season = v_league.season
          AND lw.week >= v_prev_wk_first AND lw.week <= v_prev_wk_last
          AND lw.status <> 'final'
        ORDER BY lw.week
      LOOP
        v_pend := public.week_results_pending_internal(p_league_id, v_league.season, v_w.week);
        IF v_pend IS NOT NULL THEN
          v_pending := v_pending || (jsonb_build_object('week', v_w.week) || v_pend);
        END IF;
      END LOOP;
      IF jsonb_array_length(v_pending) > 0 THEN
        RETURN jsonb_build_object('reason', 'bracket_waiting', 'round', v_r, 'source', 'provisional',
                                  'weeks', jsonb_build_array(v_wk_first, v_wk_last),
                                  'pending', v_pending);
      END IF;
    END IF;

    -- The entrants: round 1 from the standings (the FINAL arm once the
    -- regular season is final, the PROJECTED arm while it is in its
    -- correction window — (E)); a later round from the prior round's
    -- survivors (provisional or final by its rows).
    IF v_r = 1 THEN
      v_st := public.league_standings_internal(p_league_id, NOT v_prev_final);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'team_id', x ->> 'team_id', 'seed', (x ->> 'rank')::int, 'line', (x ->> 'rank')::int)
               ORDER BY (x ->> 'rank')::int), '[]'::jsonb), count(*)::int
        INTO v_entrants, v_n
      FROM jsonb_array_elements(v_st -> 'standings') x
      WHERE (x ->> 'rank')::int <= v_pt;
      IF v_n <> v_pt THEN
        RAISE EXCEPTION 'playoff_bracket_sync_internal: league % seats % ranked teams for % playoff spots — a bracket cannot be seeded (§7.3.1 playoff_teams ≤ team_count; a retired seat is never seeded)', p_league_id, v_n, v_pt
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      v_entrants := v_state -> 'round_list' -> (v_r - 2) -> 'survivors';
    END IF;

    v_desired := public.playoff_round_pairs_internal(v_entrants, v_b / (2 ^ (v_r - 1))::int, v_key);
    SELECT string_agg(
             (g -> 'home' ->> 'seed') || ':' || (g -> 'home' ->> 'team_id') || 'v' ||
             COALESCE((g -> 'away' ->> 'seed') || ':' || (g -> 'away' ->> 'team_id'), 'bye'),
             ',' ORDER BY (g -> 'home' ->> 'seed')::int)
      INTO v_desired_txt
    FROM jsonb_array_elements(v_desired) g;
    SELECT string_agg(
             (g ->> 'home_seed') || ':' || (g ->> 'home_team_id') || 'v' ||
             COALESCE((g ->> 'away_seed') || ':' || (g ->> 'away_team_id'), 'bye'),
             ',' ORDER BY (g ->> 'home_seed')::int)
      INTO v_stored_txt
    FROM jsonb_array_elements(v_round -> 'games') g;

    IF v_stored_txt IS NOT NULL AND v_stored_txt = v_desired_txt THEN
      -- Built as the prior stage now says; nothing to write.
      IF NOT (v_round ->> 'rolled')::boolean THEN
        RETURN jsonb_build_object('reason', 'round_in_progress', 'round', v_r,
                                  'source', CASE WHEN v_prev_final THEN 'final' ELSE 'provisional' END);
      END IF;
      v_prev_rolled := TRUE;
      v_prev_final  := (v_round ->> 'final')::boolean;
      v_prev_roll_at := (v_round ->> 'rollover_at')::timestamptz;
      CONTINUE;
    END IF;

    -- R839: a round is HISTORY once it has ROLLED (every week of it
    -- `correction_window` / `final`) OR any of its rows carries a WRITTEN
    -- score (non-NULL and not 109's untouched DEFAULT 0) — its games have
    -- been played. A prior verdict that moves AFTER that (the F238 / Q37
    -- family: a held finalization on the last regular week outliving the
    -- round's kickoff) is REFUSED BY NAME: nothing deleted, nothing
    -- re-paired, later rounds not revisited — the bracket stands as played
    -- until a commissioner acts (M6 §10: a row written with seeds is the
    -- engine's) or the round finalizes (then it is decided, above, and its
    -- survivors feed the next). The ruled rebuild ((E): the correction
    -- close, Thursday 06:00 ET, before any playoff kickoff) meets neither
    -- arm — an open week with the default scores is rewritable.
    IF v_stored_txt IS NOT NULL THEN
      SELECT count(*)::int INTO v_played
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season
        AND m.week >= v_wk_first AND m.week <= v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
        AND (   (m.home_score IS NOT NULL AND m.home_score <> 0)
             OR (m.away_score IS NOT NULL AND m.away_score <> 0));
      IF (v_round ->> 'rolled')::boolean OR v_played > 0 THEN
        RAISE WARNING 'playoff_bracket_sync_internal: league % round % is HISTORY (rolled %, % scored rows) but the prior stage''s verdict now says % (stored %) — the rewrite is REFUSED; the bracket stands as played until a commissioner acts (M6 §10) or the round finalizes',
          p_league_id, v_r, (v_round ->> 'rolled')::boolean, v_played, v_desired_txt, v_stored_txt;
        RETURN jsonb_build_object(
          'reason',      'rebuild_refused_round_played',
          'round',       v_r,
          'source',      CASE WHEN v_prev_final THEN 'final' ELSE 'provisional' END,
          'weeks',       jsonb_build_array(v_wk_first, v_wk_last),
          'rolled',      (v_round ->> 'rolled')::boolean,
          'scored_rows', v_played,
          'stored',      v_stored_txt,
          'desired',     v_desired_txt);
      END IF;
    END IF;

    -- Write (round empty) or REWRITE (open round, the verdict moved): the
    -- rows per week, seeds frozen, `scheduled` into an upcoming week and
    -- `live` into an open one (116's (a) flips the former at open).
    IF v_stored_txt IS NOT NULL THEN
      DELETE FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season
        AND m.week >= v_wk_first AND m.week <= v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL;
    END IF;
    INSERT INTO public.matchups
      (league_id, season, week, round_type, home_team_id, away_team_id, home_seed, away_seed, status, created_at, updated_at)
    SELECT p_league_id, v_league.season, lw.week, 'playoff',
           (g -> 'home' ->> 'team_id')::uuid,
           (g -> 'away' ->> 'team_id')::uuid,
           (g -> 'home' ->> 'seed')::smallint,
           (g -> 'away' ->> 'seed')::smallint,
           CASE WHEN lw.status = 'upcoming' THEN 'scheduled' ELSE 'live' END,
           p_now, p_now
    FROM jsonb_array_elements(v_desired) g
    CROSS JOIN public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season
      AND lw.week >= v_wk_first AND lw.week <= v_wk_last;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_expected := jsonb_array_length(v_desired) * v_wpr;
    IF v_cnt <> v_expected THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: league % round % wrote % rows, expected % (% pairings × % weeks)', p_league_id, v_r, v_cnt, v_expected, jsonb_array_length(v_desired), v_wpr
        USING ERRCODE = 'P0001';
    END IF;

    -- (vi) in_season → playoffs with the FIRST bracket write, one legal step.
    IF v_r = 1 AND v_league.status = 'in_season' THEN
      UPDATE public.leagues SET status = 'playoffs', updated_at = p_now
      WHERE id = p_league_id AND status = 'in_season';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'playoff_bracket_sync_internal: flipping league % to playoffs touched % rows, expected 1', p_league_id, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'action',         CASE WHEN v_stored_txt IS NULL THEN 'built' ELSE 'rebuilt' END,
      'round',          v_r,
      'source',         CASE WHEN v_prev_final THEN 'final' ELSE 'provisional' END,
      'key',            v_key,
      'weeks',          jsonb_build_array(v_wk_first, v_wk_last),
      'pairings',       jsonb_array_length(v_desired),
      'rows',           v_expected,
      'status_flipped', (v_r = 1 AND v_league.status = 'in_season'),
      'rollover_at',    v_prev_roll_at,
      'games',          v_desired_txt,
      'replaced',       v_stored_txt);
  END LOOP;

  -- The champion: the last round FINAL — playoffs → complete.
  v_round := v_state -> 'round_list' -> (v_rounds - 1);
  IF (v_round ->> 'final')::boolean THEN
    v_champion := (v_state ->> 'bracket_champion_team_id')::uuid;
    IF v_champion IS NULL THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: league % — the last round is final but no winner was read (%)', p_league_id, v_round -> 'games'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_league.status <> 'playoffs' THEN
      RETURN jsonb_build_object('reason', 'champion_decided_but_status_not_playoffs', 'status', v_league.status);
    END IF;
    UPDATE public.leagues
    SET status = 'complete', champion_team_id = v_champion, updated_at = p_now
    WHERE id = p_league_id AND status = 'playoffs';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: completing league % touched % rows, expected 1', p_league_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'action', 'complete', 'kind', 'bracket', 'basis', 'bracket',
      'champion_team_id', v_champion, 'from_status', 'playoffs',
      'decided_by', v_round -> 'games' -> 0 ->> 'decided_by');
  END IF;
  RETURN jsonb_build_object('reason', 'awaiting_final_round', 'round', v_rounds);
END;
$$;
REVOKE EXECUTE ON FUNCTION playoff_bracket_sync_internal(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. league_playoff_bracket — the member READ. The state (7) plus, while the
--    league is `in_season`, the PROJECTED round 1 — "what the bracket would
--    be if the playoffs started today" — seeded from
--    `league_standings_internal(…, TRUE)`; and the instant the real one
--    materialises: `rollover_week` / `rollover_at` (the last regular-season
--    week's `nfl_weeks.last_game_ends_at` — NULL until ingestion records the
--    last game's end; F238's posture, never inferred) and
--    `corrections_close_at`. ONE absolute instant per league — the UI
--    renders it in each viewer's zone (L.D5.5). DEFINER + in-body member
--    check (a non-member is refused by name); REVOKE FROM PUBLIC, anon.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_playoff_bracket(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state    JSONB;
  v_st       JSONB;
  v_entrants JSONB;
  v_n        INTEGER;
  v_proj     JSONB := NULL;
  v_basis    JSONB := NULL;
  v_view     TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'league_playoff_bracket: only a member of the league may read its bracket'
      USING ERRCODE = '42501';
  END IF;
  v_state := public.playoff_bracket_state_internal(p_league_id);

  IF v_state ->> 'kind' <> 'bracket' THEN
    RETURN v_state || jsonb_build_object('view', v_state ->> 'kind');
  END IF;

  IF (v_state ->> 'next_round')::int = 1 AND (v_state ->> 'status') = 'in_season' THEN
    v_st := public.league_standings_internal(p_league_id, TRUE);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'team_id', x ->> 'team_id', 'seed', (x ->> 'rank')::int, 'line', (x ->> 'rank')::int)
             ORDER BY (x ->> 'rank')::int), '[]'::jsonb), count(*)::int
      INTO v_entrants, v_n
    FROM jsonb_array_elements(v_st -> 'standings') x
    WHERE (x ->> 'rank')::int <= (v_state ->> 'playoff_teams')::int;
    IF v_n = (v_state ->> 'playoff_teams')::int THEN
      v_proj := public.playoff_round_pairs_internal(v_entrants, (v_state ->> 'bracket_size')::int, 'seed');
    END IF;
    v_basis := jsonb_build_object(
      'projected',       TRUE,
      'weeks_final',     v_st -> 'weeks_final',
      'weeks_projected', v_st -> 'weeks_projected',
      'seeded',          v_n,
      'reason',          v_st -> 'reason');
    v_view := 'projected';
  ELSE
    v_view := 'bracket';
  END IF;

  RETURN v_state || jsonb_build_object(
    'view',              v_view,
    'projected_round_1', v_proj,
    'projection_basis',  v_basis);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_playoff_bracket(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 10. league_week_advance — REPLACED against 116's FILE TEXT (D137; the
--     asserted hunks in the banner). Every byte not named there is 116's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_week_advance(
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
  v_seen        UUID[] := '{}';
  v_loops       INTEGER := 0;
  v_pass        INTEGER;
  v_lg          RECORD;
  v_league      public.leagues;
  v_lw          RECORD;
  v_team        RECORD;
  v_carry       JSONB;
  v_cnt         INTEGER;
  v_leagues     INTEGER := 0;
  v_opened      INTEGER := 0;
  v_closed      INTEGER := 0;
  v_carried     INTEGER := 0;
  v_matchups    INTEGER := 0;
  v_unstamped   JSONB := '[]'::jsonb;
  v_carries     JSONB := '[]'::jsonb;
  v_failures    JSONB := '[]'::jsonb;
  v_weeks       INTEGER[];
  v_bracket     JSONB;
  v_brackets    JSONB := '[]'::jsonb;
  v_bracket_failures JSONB := '[]'::jsonb;
  v_bracket_blocked  JSONB := '[]'::jsonb;
  v_bracket_waiting  JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'league_week_advance: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      BEGIN
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;

        -- (a) upcoming → live at starts_at (the CURRENT-week boundary, 112).
        FOR v_lw IN
          SELECT lw.id, lw.week
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = v_lg.id
            AND lw.season = v_league.season
            AND lw.status = 'upcoming'
            AND w.starts_at <= p_now
          ORDER BY lw.week
          FOR UPDATE OF lw
        LOOP
          UPDATE public.league_weeks SET status = 'live' WHERE id = v_lw.id;   -- F4 guard: one legal step
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          IF v_cnt <> 1 THEN
            RAISE EXCEPTION 'league_week_advance: opening week % of league % touched % rows, expected 1', v_lw.week, v_lg.id, v_cnt
              USING ERRCODE = 'P0001';
          END IF;
          v_opened := v_opened + 1;

          UPDATE public.matchups m
          SET status = 'live', updated_at = p_now
          WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
            AND m.status = 'scheduled';
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          v_matchups := v_matchups + v_cnt;

          -- AUTO-CARRY (D293): an explicit row for every seated franchise
          -- that has none for the week.
          FOR v_team IN
            SELECT t.id
            FROM public.teams t
            WHERE t.league_id = v_lg.id AND t.status <> 'retired'
              AND NOT EXISTS (
                SELECT 1 FROM public.team_lineups tl
                WHERE tl.team_id = t.id AND tl.season = v_league.season AND tl.week = v_lw.week)
            ORDER BY t.id
          LOOP
            v_carry := public.lineup_carry_internal(v_lg.id, v_team.id, v_league.season, v_lw.week, p_now);
            v_carried := v_carried + 1;
            v_carries := v_carries || jsonb_build_object(
              'league_id', v_lg.id,
              'team_id', v_team.id,
              'week', v_lw.week,
              'carried_from_week', v_carry -> 'carried_from_week',
              'dropped', v_carry -> 'dropped',
              'illegal', v_carry -> 'flags' -> 'illegal');
          END LOOP;
        END LOOP;

        -- (b) live → correction_window at last_game_ends_at (the games-over
        --     EVENT — the datum 115's lock releases on; NULL = not over).
        FOR v_lw IN
          SELECT lw.id, lw.week
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = v_lg.id
            AND lw.season = v_league.season
            AND lw.status = 'live'
            AND w.last_game_ends_at IS NOT NULL
            AND w.last_game_ends_at <= p_now
          ORDER BY lw.week
          FOR UPDATE OF lw
        LOOP
          UPDATE public.league_weeks SET status = 'correction_window' WHERE id = v_lw.id;   -- F4: one legal step
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          IF v_cnt <> 1 THEN
            RAISE EXCEPTION 'league_week_advance: closing week % of league % touched % rows, expected 1', v_lw.week, v_lg.id, v_cnt
              USING ERRCODE = 'P0001';
          END IF;
          v_closed := v_closed + 1;
        END LOOP;

        -- LOUD (F238): a live week whose correction window has passed but
        -- whose last game end is unrecorded is NAMED, never inferred.
        SELECT array_agg(lw.week ORDER BY lw.week) INTO v_weeks
        FROM public.league_weeks lw
        JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
        WHERE lw.league_id = v_lg.id AND lw.season = v_league.season
          AND lw.status = 'live'
          AND w.last_game_ends_at IS NULL
          AND w.correction_window_ends_at <= p_now;
        IF v_weeks IS NOT NULL THEN
          v_unstamped := v_unstamped || jsonb_build_object('league_id', v_lg.id, 'weeks', to_jsonb(v_weeks));
          RAISE WARNING 'league_week_advance: league % week(s) % are past their correction window but nfl_weeks.last_game_ends_at is NOT RECORDED — the week stays live until ingestion records the last game end (F238; §23.3)',
            v_lg.id, v_weeks;
        END IF;

        -- 118 (Q39 (E), the ROLLOVER): the bracket / champion consequences —
        -- every run, idempotent. A round becomes due the moment the prior
        -- stage's last week has CLOSED at `nfl_weeks.last_game_ends_at` (the
        -- (b) instant above — the same event Q34(B) ruled for the lock's
        -- release), provisional from that week's scores; finalize rebuilds it
        -- from the final results. Guarded so a bracket problem is LOUD
        -- (`bracket_failures` + WARNING) and RETRIED next run — never a
        -- block on the week machine.
        BEGIN
          v_bracket := public.playoff_bracket_sync_internal(v_lg.id, p_now);
          IF v_bracket ? 'action' THEN
            v_brackets := v_brackets || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
          -- R841: a bracket a HUMAN must unblock (a seedless playoff row; a
          -- played round the prior verdict moved under — R839) is named on
          -- the hourly payload + WARNING; one WAITING on pending scores
          -- (R840, §23.2/E61) likewise — retried next run. The calendar
          -- `waiting_*` states (the prior stage not yet rolled) are the
          -- every-hour normal and stay out of the payload.
          ELSIF v_bracket ->> 'reason' IN ('bracket_foreign_rows', 'rebuild_refused_round_played') THEN
            v_bracket_blocked := v_bracket_blocked || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'league_week_advance: league % playoff bracket BLOCKED at round % — % (a commissioner must act — M6 §10; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket ->> 'reason';
          ELSIF v_bracket ->> 'reason' = 'bracket_waiting' THEN
            v_bracket_waiting := v_bracket_waiting || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'league_week_advance: league % playoff bracket round % WAITING — the prior stage holds pending scores % (§23.2/E61: never seeded from an absent score; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket -> 'pending';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_bracket_failures := v_bracket_failures || jsonb_build_object(
            'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
          RAISE WARNING 'league_week_advance: playoff bracket sync failed for league %: % (%) — retried next run', v_lg.id, SQLERRM, SQLSTATE;
        END;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'league_week_advance failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',              p_now,
    'scope',           p_league_id,
    'leagues',         v_leagues,
    'opened',          v_opened,
    'closed',          v_closed,
    'matchups_live',   v_matchups,
    'carried',         v_carried,
    'carries',         v_carries,
    'unstamped_weeks', v_unstamped,
    'brackets',        v_brackets,
    'bracket_failures', v_bracket_failures,
    'bracket_blocked', v_bracket_blocked,
    'bracket_waiting', v_bracket_waiting,
    'failures',        v_failures,
    'loops',           v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'no_in_season_leagues'
      WHEN v_opened + v_closed + jsonb_array_length(v_brackets) = 0 THEN 'nothing_due'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_week_advance(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. finalize_matchups — REPLACED against 117's FILE TEXT (D137; the
--     asserted hunks in the banner; F244's locals + merge untouched). Every
--     byte not named there is 117's.
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
  v_bracket      JSONB;
  v_brackets     JSONB := '[]'::jsonb;
  v_bracket_failures JSONB := '[]'::jsonb;
  v_bracket_blocked  JSONB := '[]'::jsonb;
  v_bracket_waiting  JSONB := '[]'::jsonb;
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

        -- 118 (Q39 (D)/(E), the CORRECTION CLOSE): the bracket / champion
        -- consequences after this league's weeks — every claim, idempotent:
        -- the round rebuilt from FINAL results when a correction moved a
        -- seed; the champion + `complete` at the last week's final (rank 1
        -- through the full chain when there is no bracket — (C)/(D)). Guarded
        -- so a bracket problem is LOUD (`bracket_failures` + WARNING) and
        -- RETRIED next run — never a rollback of the week's finalization.
        BEGIN
          v_bracket := public.playoff_bracket_sync_internal(v_lg.id, p_now);
          IF v_bracket ? 'action' THEN
            v_brackets := v_brackets || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
          -- R841: a bracket a HUMAN must unblock (a seedless playoff row; a
          -- played round the prior verdict moved under — R839) is named on
          -- the hourly payload + WARNING; one WAITING on pending scores
          -- (R840, §23.2/E61) likewise — retried next run. The calendar
          -- `waiting_*` states (the prior stage not yet rolled) are the
          -- every-hour normal and stay out of the payload.
          ELSIF v_bracket ->> 'reason' IN ('bracket_foreign_rows', 'rebuild_refused_round_played') THEN
            v_bracket_blocked := v_bracket_blocked || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'finalize_matchups: league % playoff bracket BLOCKED at round % — % (a commissioner must act — M6 §10; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket ->> 'reason';
          ELSIF v_bracket ->> 'reason' = 'bracket_waiting' THEN
            v_bracket_waiting := v_bracket_waiting || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'finalize_matchups: league % playoff bracket round % WAITING — the prior stage holds pending scores % (§23.2/E61: never seeded from an absent score; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket -> 'pending';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_bracket_failures := v_bracket_failures || jsonb_build_object(
            'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
          RAISE WARNING 'finalize_matchups: playoff bracket sync failed for league %: % (%) — retried next run', v_lg.id, SQLERRM, SQLSTATE;
        END;
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
    'brackets',         v_brackets,
    'bracket_failures', v_bracket_failures,
    'bracket_blocked',  v_bracket_blocked,
    'bracket_waiting',  v_bracket_waiting,
    'failures',         v_failures,
    'loops',            v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'nothing_due'
      WHEN v_finalized = 0 AND jsonb_array_length(v_brackets) = 0 THEN 'nothing_finalized'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION finalize_matchups(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. create_league — REPLACED against 077's FILE TEXT (D137; ONE hunk — the
--     Q39 (C) refusal after the Q10 backstops). 060/077's grants stand
--     (CREATE OR REPLACE keeps the ACL).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_league(
  p_name TEXT,
  p_season INTEGER,
  p_team_count INTEGER,
  p_settings JSONB,
  p_roster_settings JSONB,
  p_scoring_system_id UUID,
  p_team_name TEXT,
  p_action_id UUID,
  p_format TEXT,
  p_regular_season_weeks INTEGER,
  p_playoff_teams INTEGER,
  p_playoff_start_week INTEGER,
  p_waiver_type TEXT,
  p_faab_budget INTEGER,
  p_trade_review TEXT,
  p_trade_deadline_week INTEGER,
  p_lineup_lock TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_existing RECORD;
  v_league_id UUID;
  v_team_id UUID;
  v_invite_code TEXT;
  v_default_team_name TEXT;
  v_constraint TEXT;
  v_attempts INTEGER := 0;
BEGIN
  -- In-body authorization (§12.0/§8.3): any signed-in user — creation is
  -- FREE (Q6 ruling, v2.8; §17). Deliberately NO is_pro read.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_league: must be signed in to create a league'
      USING ERRCODE = '42501';
  END IF;

  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'create_league: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotent replay (D68): a retry of an already-committed create returns
  -- the original result instead of a second league.
  SELECT l.id, l.owner_id, l.invite_code, l.deleted_at INTO v_existing
  FROM public.leagues l
  WHERE l.creation_action_id = p_action_id;
  IF FOUND THEN
    IF v_existing.owner_id <> v_uid THEN
      RAISE EXCEPTION 'create_league: this action_id was already used by another account'
        USING ERRCODE = 'P0001';
    END IF;
    -- R76: a soft-deleted league must NOT replay as success (the route would
    -- 200 while GET detail 404s) — refuse with a friendly, terminal message.
    IF v_existing.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_league: this create was already completed and the league has since been deleted — start a new league with a fresh submit'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT lm.team_id INTO v_team_id
    FROM public.league_members lm
    WHERE lm.league_id = v_existing.id AND lm.user_id = v_uid;
    RETURN jsonb_build_object(
      'league_id', v_existing.id,
      'team_id', v_team_id,
      'invite_code', v_existing.invite_code,
      'replayed', true
    );
  END IF;

  -- v1 templates-only (§7.3.3; §7.3.8 "exactly one scoring system referenced
  -- and readable"): the reference must be a template row — is_template AND
  -- ownerless (the 058 CHECK makes those inseparable, but both are checked
  -- so this guard survives a CHECK change). Friendly, field-named message —
  -- the route maps it to a per-field 400.
  IF p_scoring_system_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.scoring_systems s
    WHERE s.id = p_scoring_system_id
      AND s.is_template = TRUE
      AND s.owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'create_league: scoring_system_id must reference one of the v1 scoring templates — personal scoring systems cannot be attached to a league in v1 (§7.3.3)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Q10 strict-continuity backstop (R75; §7.3.8 "enforced in API + DB
  -- constraints"; ruling v2.8.6): a direct-PostgREST caller never runs
  -- validateLeagueSettings, so the seam invariant is re-checked at the ONE
  -- sanctioned writer. Range first (13–16, §7.3.1 R column) so a
  -- seam-consistent-but-out-of-range pair (e.g. 16+17) names the range;
  -- then strict continuity. Blob-shape validation stays API-side (D68(3)/
  -- D69 boundary). Friendly field-named messages — the route maps them to
  -- per-field 400s.
  IF p_playoff_start_week < 13 OR p_playoff_start_week > 16 THEN
    RAISE EXCEPTION 'create_league: playoff_start_week must be between 13 and 16 (currently week %) (§7.3.1, Q10/v2.8.6)',
      p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;
  IF p_playoff_start_week <> p_regular_season_weeks + 1 THEN
    RAISE EXCEPTION 'create_league: playoff_start_week must be the week after the regular season ends — week % for a %-week regular season (currently week %) (§7.3.8, Q10/v2.8.6)',
      p_regular_season_weeks + 1, p_regular_season_weeks, p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;

  -- Q39 (C) — spec v2.16.25 §7.3.1 / §11.7 (Chris 2026-09-07): a total-points
  -- league has NO playoff bracket — the season-long points race IS its
  -- playoff — so `playoff_teams > 0` with `schedule_mode = total_points` is
  -- refused at settings time with a plain message (the same backstop shape
  -- as Q10's: validateLeagueSettings catches it first on the API path; a
  -- direct caller meets it here). The message names `playoff_teams` and no
  -- other marker (the leagues-service field mapper is first-match).
  IF p_playoff_teams > 0 AND COALESCE(p_settings ->> 'schedule_mode', 'h2h') = 'total_points' THEN
    RAISE EXCEPTION 'create_league: playoff_teams must be 0 for a total-points league — the season-long points race is its playoff and there is no bracket; set playoff teams to 0 or switch to head-to-head (§11.7, Q39 (C))'
      USING ERRCODE = 'P0001';
  END IF;

  -- Default team name: "<username>'s Team" (falls back to 'My' — profile
  -- always exists via handle_new_user). 077: the handle is the only source.
  SELECT COALESCE(p.username, 'My') || '''s Team'
    INTO v_default_team_name
  FROM public.profiles p
  WHERE p.id = v_uid;
  v_default_team_name := COALESCE(v_default_team_name, 'My Team');

  -- League insert, invite-code collision-retried (10 hex chars from
  -- gen_random_uuid — pg_catalog, no extension dependency; the 001 UNIQUE
  -- backs uniqueness). A creation_action_id unique_violation here is the
  -- CONCURRENT double-submit race: the other txn won — replay its result.
  LOOP
    v_attempts := v_attempts + 1;
    v_invite_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    BEGIN
      INSERT INTO public.leagues (
        owner_id, name, season, scoring_system_id, invite_code,
        creation_action_id,
        format, team_count, max_teams, regular_season_weeks, playoff_teams,
        playoff_start_week, waiver_type, faab_budget, trade_review,
        trade_deadline_week, lineup_lock, roster_settings, settings
      ) VALUES (
        v_uid, p_name, p_season, p_scoring_system_id, v_invite_code,
        p_action_id,
        p_format, p_team_count, p_team_count, -- max_teams := team_count (§12.1 sync)
        p_regular_season_weeks, p_playoff_teams,
        p_playoff_start_week, p_waiver_type, p_faab_budget, p_trade_review,
        p_trade_deadline_week, p_lineup_lock, p_roster_settings, p_settings
      ) RETURNING id INTO v_league_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'leagues_creation_action_id_key' THEN
        -- Concurrent same-action_id create committed first: replay it.
        SELECT l.id, l.invite_code, l.deleted_at INTO v_existing
        FROM public.leagues l
        WHERE l.creation_action_id = p_action_id AND l.owner_id = v_uid;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'create_league: this action_id was already used by another account'
            USING ERRCODE = 'P0001';
        END IF;
        -- R76 (same guard as the primary replay path): never replay a
        -- since-soft-deleted league as success.
        IF v_existing.deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'create_league: this create was already completed and the league has since been deleted — start a new league with a fresh submit'
            USING ERRCODE = 'P0001';
        END IF;
        SELECT lm.team_id INTO v_team_id
        FROM public.league_members lm
        WHERE lm.league_id = v_existing.id AND lm.user_id = v_uid;
        RETURN jsonb_build_object(
          'league_id', v_existing.id,
          'team_id', v_team_id,
          'invite_code', v_existing.invite_code,
          'replayed', true
        );
      ELSIF v_constraint = 'leagues_invite_code_key' AND v_attempts < 5 THEN
        CONTINUE; -- astronomically rare 10-hex collision: regenerate
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  -- Creator's franchise (§7.2 "Creator becomes commissioner and gets a
  -- team"): a league team carries no backing list (D35a).
  INSERT INTO public.teams (owner_id, name, league_id, list_id)
  VALUES (v_uid, COALESCE(NULLIF(btrim(p_team_name), ''), v_default_team_name), v_league_id, NULL)
  RETURNING id INTO v_team_id;

  -- Commissioner membership (current-state cache) — faab_balance seeded from
  -- the league's faab_budget (§12.2).
  INSERT INTO public.league_members (league_id, user_id, team_id, role, faab_balance)
  VALUES (v_league_id, v_uid, v_team_id, 'commissioner', p_faab_budget);

  -- First manager stint (historical truth — §12.22/v2.1: same txn as the
  -- cache write). started_week NULL = preseason.
  INSERT INTO public.team_managers (league_id, team_id, user_id, role)
  VALUES (v_league_id, v_team_id, v_uid, 'manager');

  RETURN jsonb_build_object(
    'league_id', v_league_id,
    'team_id', v_team_id,
    'invite_code', v_invite_code,
    'replayed', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. update_league_settings — REPLACED against 105's FILE TEXT (D137; the
--     same ONE hunk after its Q10 backstops). 105's REVOKE + COMMENT stand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_league_settings(
  p_league_id UUID,
  p_team_count INTEGER,
  p_settings JSONB,
  p_roster_settings JSONB,
  p_scoring_system_id UUID,  -- NULL = keep the current reference
  -- Remaining §12.1 typed columns, explicit and mandatory (splitSettings is
  -- the authority — the service maps every TYPED_COLUMN_KEY to p_<key>
  -- mechanically, exactly as create_league does. D68/D70).
  p_format TEXT,
  p_regular_season_weeks INTEGER,
  p_playoff_teams INTEGER,
  p_playoff_start_week INTEGER,
  p_waiver_type TEXT,
  p_faab_budget INTEGER,
  p_trade_review TEXT,
  p_trade_deadline_week INTEGER,
  p_lineup_lock TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_current_scoring UUID;
  v_current_faab_budget INTEGER;
  v_snapshot JSONB;
  v_new_scoring UUID;
  v_seated INTEGER;
  v_attach_rules JSONB;   -- D169 arm (b)
BEGIN
  -- 1. In-body authorization (§12.0/§8.3): commissioner or co-commissioner.
  --    A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'update_league_settings: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Row lock (serializes with concurrent PATCHes and status transitions);
  --    soft-deleted leagues are not found.
  SELECT l.status, l.scoring_system_id, l.faab_budget, l.scoring_rules_snapshot
    INTO v_status, v_current_scoring, v_current_faab_budget, v_snapshot
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_league_settings: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. §7.3 header status gate: structural settings are editable only in
  --    setup/scheduled; the post-draft path is an audited commissioner
  --    override (M6). The route maps this to a clear 409.
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'update_league_settings: league % is in % — settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 3.5 F28 shrink floor: team_count >= franchises already seated (retired
  --     franchises don't count — their slot was freed, §7.2.1(b)). The
  --     league-row lock above serializes this count with 062's join/claim
  --     capacity checks.
  SELECT count(*)::int INTO v_seated
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF p_team_count < v_seated THEN
    RAISE EXCEPTION 'update_league_settings: team_count % is below the % franchises already seated in this league — remove a team first (§7.2 capacity; F28)',
      p_team_count, v_seated
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Q10 backstops (R75/D69 — same order + shape as create_league).
  IF p_playoff_start_week < 13 OR p_playoff_start_week > 16 THEN
    RAISE EXCEPTION 'update_league_settings: playoff_start_week must be between 13 and 16 (currently week %) (§7.3.1, Q10/v2.8.6)',
      p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;
  IF p_playoff_start_week <> p_regular_season_weeks + 1 THEN
    RAISE EXCEPTION 'update_league_settings: playoff_start_week must be the week after the regular season ends — week % for a %-week regular season (currently week %) (§7.3.8, Q10/v2.8.6)',
      p_regular_season_weeks + 1, p_regular_season_weeks, p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;

  -- 4b. Q39 (C) — spec v2.16.25 §7.3.1 / §11.7 (Chris 2026-09-07): a total-points
  -- league has NO playoff bracket — the season-long points race IS its
  -- playoff — so `playoff_teams > 0` with `schedule_mode = total_points` is
  -- refused at settings time with a plain message (the same backstop shape
  -- as Q10's: validateLeagueSettings catches it first on the API path; a
  -- direct caller meets it here). The message names `playoff_teams` and no
  -- other marker (the leagues-service field mapper is first-match).
  IF p_playoff_teams > 0 AND COALESCE(p_settings ->> 'schedule_mode', 'h2h') = 'total_points' THEN
    RAISE EXCEPTION 'update_league_settings: playoff_teams must be 0 for a total-points league — the season-long points race is its playoff and there is no bracket; set playoff teams to 0 or switch to head-to-head (§11.7, Q39 (C))'
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. ATTACHABLE SCOPE (§7.3.8 v2.11 via D169; was v1 templates-only). A
  --    template — 061's original predicate, both conjuncts, unchanged — OR the
  --    league's own currently-referenced row, which is what makes a settings
  --    PATCH that merely re-sends the current custom reference legal. Anything
  --    else (a personal research system, another league's fork) still refuses.
  IF p_scoring_system_id IS NOT NULL
     AND p_scoring_system_id IS DISTINCT FROM v_current_scoring
     AND NOT EXISTS (
    SELECT 1 FROM public.scoring_systems s
    WHERE s.id = p_scoring_system_id
      AND s.is_template = TRUE
      AND s.owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'update_league_settings: scoring_system_id must reference one of the scoring templates, or the league''s own forked custom scoring system — personal scoring systems and other leagues'' systems cannot be attached (§7.3.8 v2.11, §7.3.3.1)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 5b. D169's ATTACH-VALIDATION arm (spec §7.3.3.1(5): "the server write path
  --     (editor save + settings attach) MUST reject an invalid doc"). Defense
  --     in depth over D175's wall, and the ONLY check in this function on a
  --     same-row re-attach, because step 6's re-freeze does not fire there.
  IF p_scoring_system_id IS NOT NULL THEN
    SELECT s.rules INTO v_attach_rules
    FROM public.scoring_systems s WHERE s.id = p_scoring_system_id;
    -- SHADOWED, NOT UNREACHABLE — and it stays (R649). Step 5 above already
    -- refuses a nonexistent id that differs from the current reference, and the
    -- FK refuses the equal-to-current arm, so no probe reaches this RAISE
    -- today. But step 5's `NOT EXISTS` and this `SELECT … INTO` are SEPARATE
    -- STATEMENTS over separate snapshots under read committed, and step 5 takes
    -- no tuple lock — the same unlocked cross-table premise wall 3 bought a row
    -- lock for (R626). A template deleted and committed between the two lands
    -- here. Deleting it would also make the two walls disagree on an idiom 104
    -- carries byte-identically, and would downgrade an accurate message into
    -- `scoring_rules_validate(NULL)`'s "must be a JSON object; got nothing" —
    -- loud for the wrong reason, which is precisely what CLAUDE.md's
    -- assert-the-reason-for-emptiness rule points away from.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'update_league_settings: scoring system % does not exist (§7.3.8)',
        p_scoring_system_id
        USING ERRCODE = 'P0001';
    END IF;
    -- No catch, no wrap: 103's P0001 + MESSAGE/DETAIL/HINT propagates, which is
    -- the contract the settings route turns into a per-field error.
    PERFORM public.scoring_rules_validate(v_attach_rules);
  END IF;

  v_new_scoring := COALESCE(p_scoring_system_id, v_current_scoring);

  -- 6. §7.3.3 pre-draft re-freeze: a scoring change with an existing snapshot
  --    refreshes it from the NEW template's rules; a NULL snapshot stays NULL.
  IF v_new_scoring IS DISTINCT FROM v_current_scoring AND v_snapshot IS NOT NULL THEN
    SELECT s.rules INTO v_snapshot
    FROM public.scoring_systems s
    WHERE s.id = v_new_scoring;
  END IF;

  -- 7. The atomic write: every §12.1 typed column + blob as passed, and
  --    max_teams = p_team_count IN THE SAME STATEMENT (§12.1 NOTE — this is
  --    the sync rule's second writer, after create_league).
  UPDATE public.leagues
  SET format = p_format,
      team_count = p_team_count,
      max_teams = p_team_count,
      regular_season_weeks = p_regular_season_weeks,
      playoff_teams = p_playoff_teams,
      playoff_start_week = p_playoff_start_week,
      waiver_type = p_waiver_type,
      faab_budget = p_faab_budget,
      trade_review = p_trade_review,
      trade_deadline_week = p_trade_deadline_week,
      lineup_lock = p_lineup_lock,
      roster_settings = p_roster_settings,
      settings = p_settings,
      scoring_system_id = v_new_scoring,
      scoring_rules_snapshot = v_snapshot,
      updated_at = NOW()
  WHERE id = p_league_id;

  -- 8. §12.2 invariant maintenance: pre-draft (guaranteed by the status gate),
  --    faab_balance carries no history — re-seed every seat when the budget
  --    changes so all balances match the create/join/claim seeding (D70).
  IF p_faab_budget IS DISTINCT FROM v_current_faab_budget THEN
    UPDATE public.league_members
    SET faab_balance = p_faab_budget
    WHERE league_id = p_league_id;
  END IF;
END;
$$;
