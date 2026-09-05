-- ============================================================================
-- The week workers — migration 116 (task L.D1.6; tasks-M4-inseason.md §6
-- L.D1.6 + §7 row "116+"; spec spec-redraft-leagues.md v2.16.21 §14 (the
-- `lineup-lock`, `league-week-advance`, `finalize-matchups` rows), §11.2
-- (auto-carry; `locked_at` is the RECORD, never the decider), §11.4
-- (finalization), §11.7 (median / second-opponent results; PF counted once),
-- §12.13, §12.17, §12.18, §12.19 (`locked_until` is the pool VIEW), §12.20,
-- §13.1 (the game-day lock is a RULE), §22.2 (never an overridden cell),
-- §22.3 (one cron per job; SKIP LOCKED batches), §23.2 (no league state
-- advances on partial data), §23.3 (kickoff-derived locks are evaluated
-- from `nfl_games.kickoff_at` at run time; week advancement on `nfl_weeks`
-- boundaries; never wall-clock math), §23.4 (the correction window is the
-- SCORING boundary), E38 / E39 / E42 / E43; PROGRESS D291 (p_now
-- injection), D293 (auto-carry materialized at week open), D295 (the
-- correction-window split), D297 (results math), D311 / D312 (the number
-- shift), F4 (the 110 transition guard — every flip here is one legal step),
-- F50 (the batch ceiling, inherited), F227(e) (the tick owns `locked_until`
-- / `locked_in_game`), F232 (column half — DISCHARGED here), F238 (the tick
-- AGREES with `last_game_ends_at`, never decides), F240 (NOT taken — the
-- seam is not replaced here); tasks-M4 §4 standing rules 1–11; D313 (build
-- mechanics); R788–R795 (the PR #258 fix round, D313(13) — this UNMERGED,
-- HELD file was edited IN PLACE: no 117, no CREATE OR REPLACE of a merged
-- body; the D137 rule is for merged text).
--
-- Numbering: migration head measured 115 at task time (ls supabase/
-- migrations/ | tail -1) ⇒ 116, pgTAP head 063 ⇒ 064 — the reservation
-- shifted twice by the ruling-driven 114/115 (D311(1)/D312(1)); confirmed
-- with `ls`, not inherited (D161/D166).
--
-- WHAT THIS MIGRATION DOES — three in-database job RPCs on pg_cron (the
-- D87/draft_tick vehicle — no Edge Function), each `(p_now timestamptz
-- DEFAULT now(), p_league_id uuid DEFAULT NULL)`: production cron passes
-- nothing; the harness/sim passes the virtual instant (D291) and, when it
-- must, ONE league (the scope seam — parallel stack suites share one stack,
-- and a job that walks every in-season league would flip other suites'
-- weeks; the cron never passes it, so §22.3's "never one cron per league"
-- stands). All three are SECURITY DEFINER + search_path='' + REVOKEd from
-- PUBLIC/anon/authenticated (rule 2), refuse a JWT-bearing caller in-body
-- (a job is not a user verb — the draft_tick authority model, said in the
-- body this time), claim due LEAGUES with `FOR UPDATE SKIP LOCKED` in
-- batches of 25 with the ARM-2 `v_seen` rotation (068:961–978; F50's ceiling
-- is inherited: a league whose body fails every run stays in the candidate
-- set and is re-claimed every run — recorded, not solved), process each
-- league in its own subtransaction (a failure is a recorded row + WARNING,
-- never a scan abort), and are IDEMPOTENT — every write is guarded by "the
-- value would change" or by the status the F4 chain leaves behind, so a
-- re-run at the same instant writes ZERO rows and SAYS SO (rule 10's loud
-- emptiness: every report carries counts and a `reason` when nothing was
-- due).
--
--   1. `lineup_lock_tick(p_now, p_league_id)` — every minute. Per in-season
--      league, at the league's CURRENT week (`lineup_current_week_internal`
--      — the §23.3 boundary, 112):
--      (a) THE POOL VIEW (§12.19 / §13.1 / F227(e) / F232 / F238): for every
--          EXISTING `league_player_pool` row (rows are lazy — D294; the tick
--          creates none) the game-day lock is read through 115's
--          `pool_game_lock_any_internal(season, current_week, nfl_team,
--          p_now)` — THE SAME helper `roster_add_drop` enforces E32 with —
--          and `locked_until` is written to what the helper says: locked ⇒
--          the week's `last_game_ends_at` when recorded, or `'infinity'`
--          when the week's last game end is NOT YET RECORDED (NULL — 115's
--          "not over = still locked"; a NULL `locked_until` would READ as
--          unlocked and lie, and computing a release the helper did not
--          (the correction window, say) would DISAGREE with enforcement —
--          F238's loud state is left loud: the view says "locked until an
--          instant not yet recorded"); unlocked ⇒ NULL. `state` flips
--          `free_agent` ⇔ `locked_in_game` with the lock (an unowned,
--          unclaimed player in a game); `on_waivers` and `rostered` rows
--          KEEP their state (the F222(a) CHECK and the D294 mirror both
--          forbid anything else) and carry the view in `locked_until` only.
--          The tick NEVER decides a lock: 113/115's verb reads the games
--          table at transaction time and never this column (pinned 061/063);
--          064 pins AGREEMENT — at kickoff−1s / +1s / release−1s / AT, the
--          stamped column equals what the helper returns.
--      (b) THE LINEUP RECORD (§11.2 / §12.13 / E42): for every lineup row of
--          the league's teams for weeks ≤ the current week whose
--          `league_weeks` row is not `final`, `locked_at` is re-evaluated
--          as 114 defines it — the EARLIEST kickoff among the STARTED
--          players (starting slots only; IR spots never), NULL for a
--          bye-only or empty lineup — from `nfl_games.kickoff_at` through
--          112's `lineup_kickoff_internal` at run time, and each starter's
--          rendered `kickoff_at` (the per-slot lock state the row carries)
--          is refreshed to the same datum. A moved kickoff (flex, E42)
--          therefore MOVES the record; a game postponed out of the week
--          (E43: ingestion writes `status = 'postponed'` AND moves the
--          kickoff beyond the week — `synthetic/scenario.ts:59`,
--          `ingest-week.ts:167`) releases the player's lock the same way,
--          because the helper reads the moved instant. Nothing here is a
--          stored decider: `set_lineup` (112/114) evaluates every lock from
--          the games table itself; these columns are the RECORD.
--      A JSON report: leagues claimed, pool rows scanned/updated, lineups
--      scanned/updated, skipped (no calendar), failures, `reason` when idle.
--   2. `league_week_advance(p_now, p_league_id)` — hourly. Per in-season
--      league, the `league_weeks` status machine on the `nfl_weeks`
--      boundaries and NOTHING else (§23.3 — no wall-clock inference
--      anywhere; three columns, three transitions):
--      (a) `upcoming → live` at `nfl_weeks.starts_at ≤ p_now` (Wednesday
--          00:00 ET — the boundary 112's `lineup_current_week_internal`
--          already flips the CURRENT week on, so the two never disagree).
--          Opening a week: every `scheduled` matchup of the week flips to
--          `live` (the week is live, so its games are — 111's Remix reads
--          `scheduled` as regenerable, and an open week is not), and
--          AUTO-CARRY is MATERIALIZED (D293 / §11.2): every seated
--          (non-retired) franchise without a lineup row for the week gets
--          one through `lineup_carry_internal` — the team's latest EARLIER
--          row's `slot_map` filtered to players STILL ROSTERED (a player
--          dropped since cannot be carried — he is not the team's; the
--          emptied slot and the player are NAMED in the report, never
--          silently dropped), IR keys read from the ROSTER (league_rosters'
--          IR columns are the truth — D308; a first open with no earlier
--          row still seats the IR player), invalid (OUT / IR / PUP / NFI / Suspended) and BYE
--          players KEPT AND FLAGGED in the same `starters` shape 114
--          writes (`flags: ["bye"]` / `["out"]` / `["empty"]`), `locked_at`
--          = the earliest started kickoff, `set_at = p_now`,
--          `edited_by_commish = FALSE`. A team with NO earlier row gets an
--          EXPLICIT empty row (`slot_map = '{}'`, every slot `empty`, the
--          whole roster on the bench) — so lock, scoring and UI always read
--          a row and never infer "which week does this row mean". The row
--          is 114's shape exactly: `set_lineup` finds it on first touch
--          (`INSERT … ON CONFLICT DO NOTHING` then `FOR UPDATE`, 114:374)
--          and edits it under the same law.
--      (b) `live → correction_window` at `nfl_weeks.last_game_ends_at ≤
--          p_now` — the week's LAST GAME ENDING, the EVENT datum 115's pool
--          lock releases on (Q34(B)), written by ingestion at the all-final
--          instant (`ingest-week.ts:282–290`; F238). NULL = not over = the
--          week STAYS `live` — and when the correction window has ALREADY
--          passed for such a week, the report NAMES it (`unstamped_weeks`)
--          with a WARNING: that is F238's loud state (a Monday-night poll
--          outage; a backfill without the stamp), left loud, never papered
--          over by computing a release from another column.
--      (c) `correction_window → final` is finalize_matchups's (below); the
--          audited reopen is M6's. The 110 transition guard fires on every
--          UPDATE here — each flip is exactly one legal step (F4).
--      Playoff flips (`leagues.status → playoffs / complete`, the bracket at
--      `playoff_start_week`) are L.D1.8's — it CREATE OR REPLACEs this
--      function against THIS file's text (D137) when it lands.
--   3. `finalize_matchups(p_now, p_league_id)` — hourly, after the week
--      advance. Per in-season league, every `league_weeks` row in
--      `correction_window` whose `nfl_weeks.correction_window_ends_at ≤
--      p_now` (the §23.4 SCORING boundary — deliberately NOT the
--      transaction lock's instant, D312/F227(c) superseded; the per-league
--      `stat_correction_window` catalog value has exactly one option,
--      `thu_06_00_et`, which IS 039's column — F241 records the reading):
--      (a) §23.2's NO-PARTIAL-DATA LAW, read from the games table at run
--          time: every game of the week that is not `postponed` must be
--          `final`, and there must be at least one such game; otherwise the
--          week is SKIPPED BY NAME (`games_not_final`, with the counts) and
--          stays `correction_window` for the next run. A `postponed` game
--          is EXCLUDED only when it has LEFT the week (E43) — its kickoff
--          now lies at or beyond the next calendar week's `nfl_weeks.
--          starts_at` (R791: a game marked postponed whose kickoff is still
--          inside the week — rescheduled within it, or not yet rescheduled
--          — is an OPEN game and HOLDS the week by name; ingestion's
--          `IN_WEEK_STATUSES` (`ingest-week.ts:169`) drops every postponed
--          game from the week's bounds regardless of kickoff, and this
--          gate deliberately does NOT inherit that reading — §23.2 wins) —
--          and the finalization posts the D97 system note to league chat
--          (`user_id NULL` — the 069 tick-actor precedent; `is_system =
--          TRUE`) naming the game(s).
--      (b) h2h leagues: a `home_score`/`away_score` that is NULL on ANY
--          matchup — overridden or not; an override is not a score (R792)
--          — is the write door's word for "not yet scored" (109's nullable
--          columns are E61's room; the door — L.D1.9 — owns the
--          representation) and the week is SKIPPED BY NAME
--          (`pending_scores`) — never coerced to 0.00, never a raw 23502
--          from the results INSERT. Every matchup of the
--          week (all round types) flips to `final`; a NON-overridden row's
--          `result` is computed from its own scores ROUNDED TO TWO DECIMALS
--          — a two-decimal tie is a tie (E38; no hidden precision) — and an
--          OVERRIDDEN row's scores and result are NOT TOUCHED (§22.2 /
--          §11.4: only its status flips; a NULL result on an overridden row
--          is derived from its overridden scores, which is reading the
--          override, not recomputing it). `team_week_results` rows are
--          written from the now-final matchups: the PRIMARY row (any
--          `round_type` but `secondary`) gives `points` (counted ONCE per
--          week, §11.7), `opponent_team_id`, `h2h_result` (`bye` when the
--          away side is NULL); the `secondary` row gives
--          `second_opponent_team_id` / `second_result` (E40 rows, §11.7).
--          A team in a `secondary` row but no primary row is a schedule
--          defect and refuses loudly.
--      (c) total_points leagues (no matchups, §11.7): the week's provisional
--          `team_week_results` rows (the worker's, §12.18) go `is_final`. A
--          SEATED team with NO row is the worker's ABSENCE, not a score
--          (R788 — the first cut zero-filled and finalized; the identical
--          outage on the h2h side blocks by name, and §23.2 does not vary
--          by schedule_mode): the week is SKIPPED BY NAME
--          (`pending_results`, the missing teams listed — the mirror of
--          `pending_scores`) and stays `correction_window`. ANY missing
--          row holds the week, not only all of them: F241(b) has the worker
--          write an explicit provisional row per seated team at its first
--          batch, so one missing row means the worker never observed that
--          team, and a partial absence is the silent shape (seven rows
--          present, an eighth team scored 0 by omission).
--      (d) `median_game` (§11.7, REGULAR SEASON ONLY — `week < first week +
--          regular_season_weeks` in NFL-week terms, D288): the median is the
--          AVERAGE OF THE TWO MIDDLE team scores (even counts — v1's sizes;
--          the odd-count arm takes the middle score), compared EXACTLY:
--          above = win, below = loss, EXACTLY the median = tie (E39).
--          `league_weeks.median_score` stores it in NUMERIC(8,2) — the
--          assignment rounds half away from zero (D57(2)); the comparison
--          is against the exact value, never the stored one (pinned where
--          the two differ: middle scores 95.01 / 95.02 ⇒ exact 95.015,
--          stored 95.02, and the 95.02 team WINS — R789).
--      (e) the week → `final` (`finalized_at = p_now`) — the F4 chain's last
--          legal step. A week that is `live` past its window (the F238
--          unstamped state) is NOT finalizable and is NAMED in the report
--          (`live_past_window`) — the advance job's warning and this
--          report say the same thing from both sides.
--      Playoff-round consequences (bracket advancement, champion) are
--      L.D1.8's; results for `playoff` rows are written here generically.
--   4. pg_cron: three entries, one per job (§22.3), unschedule-first (the
--      068:1263 idempotent pattern): `lineup-lock` every minute
--      (`* * * * *` — self-gating by COST, not by calendar inference: an
--      idle minute WRITES nothing, but it scans every `league_player_pool`
--      row and every current-week lineup row of every in-season league
--      with a helper call each — the 064 fixture's idle tick reports
--      `pool_rows: 3, lineups: 18, pool_updates: 0` — and every claimed
--      league row stays `FOR UPDATE` until the function RETURNS (one
--      transaction across every batch, not §22.3's per-league
--      transaction), so `set_lineup` / `roster_add_drop` on a claimed
--      league wait for the whole tick. Cohort-scale trivial and the
--      draft_tick shape; the per-tick scan cost and the held-lock duration
--      are §22.6 (M7) MEASUREMENTS, not a claim made here — R793),
--      `league-week-advance` hourly at :00, `finalize-matchups` hourly at
--      :05 (after the advance — a soft ordering; both are idempotent, so
--      the next hour corrects any overlap).
--   5. F232's COLUMN HALF: `COMMENT ON COLUMN league_player_pool.
--      locked_until` — 109:274's inline comment ("game-day add lock
--      (player_game_lock=on)") is a merged file and is NOT edited; the live
--      column comment is the record and now says VIEW / RULE / infinity.
--
-- LOCK-ORDER LAW (rule 8): every job claims the LEAGUE row first (`FOR
-- UPDATE SKIP LOCKED`), then `league_weeks` (`FOR UPDATE OF lw`), then
-- writes `matchups` / `team_week_results` / `team_lineups` /
-- `league_player_pool` — the same order 110–115 use.
--
-- NEVER-WEAKEN CHECK (rule 9): no lock is decided here (the tick writes what
-- 115's helper says); no overridden cell is written; no `final` matchup is
-- recomputed (finalize claims only `correction_window` weeks; a `final`
-- week is not claimed, so a re-run is a no-op by construction AND by pin);
-- the F4 guard is left in force on every flip; the frozen-snapshot law is
-- untouched (nothing here computes a score — finalize CONSUMES what the
-- door left in `matchups` / `team_week_results` at the window close).
--
-- FALSIFIABILITY (rule 9 / §4.3): pgTAP 064 — form pins (DEFINER +
-- search_path + the triple REVOKE on the new signatures; the JWT refusal;
-- the three cron rows by name/schedule/command; the column comment);
-- advance at `starts_at` −1s / AT (D146) with the carry golden (empty
-- explicit rows at the first open; a hand-set week-3 row carried to week 4
-- with a BYE starter flagged `bye`, an OUT starter flagged `out`, a
-- since-dropped starter's slot emptied and NAMED); `last_game_ends_at` −1s
-- / AT; the NULL-stamp week staying live and NAMED; tick agreement at
-- kickoff −1s / +1s / release −1s / AT against the helper's own document,
-- the infinity arm, `on_waivers`/`rostered` states preserved, `locked_at`
-- stamped / moved (E42) / released by a postponement (E43); finalize's four
-- cells (close −1s / AT × all-final / one-open, D146); the 10-team median
-- golden with the exact-median tie (stored literals), E38's two-decimal
-- tie, second-result attribution, the overridden cell preserved, the
-- `pending_scores` refusal (a NULL under an OVERRIDE too — R792),
-- E43's exclusion + system note AND the in-week postponed game that
-- HOLDS the week with −1s / AT twins on the bound (R791), the
-- total_points arm HELD BY NAME (`pending_results`) for a partial
-- (7 of 8) and an all-absent (0 of 8) week and finalized only once
-- the row exists (R788), the 0.01-apart median — exact 95.015
-- compared, 95.02 stored, the 95.02 team wins, not ties (R789) — the
-- E42 flex at the flexed kickoff +1s (locked again — R790);
-- idempotence for all three (re-run ⇒ zero writes, asserted by counts
-- and by digests). Stack vitest `week-workers-db.test.ts` drives a full
-- virtual week open → lock → finalize over the real stack by `p_now`
-- injection. Break probes (PR body): (1) the all-final gate removed →
-- the no-partial-data cells red; (2) the tick computing its own release
-- (`correction_window_ends_at`) → the agreement cells red; (3) the pool
-- `IS DISTINCT FROM` guard removed → the zero-writes cells red; (4) the
-- `pending_results` skip removed (with the row-count guard) → the
-- all-absent cells red and the week FLIPS final; (5) the median
-- compared as `round(v_median, 2)` → the 0.01 cell red (the 95.02 team
-- ties).
--
-- Migration checklist (plan §8.1): five new functions, zero replaced (D137
-- n/a — every function is NEW; L.D1.8 replaces `league_week_advance`
-- against THIS text), one COMMENT ON COLUMN, three cron rows; no table, no
-- column, no policy, no index (`idx_matchups_league_week_open` and
-- `idx_league_weeks_league` (056) serve the claims; `league_weeks(league_id,
-- season, week)` is 056's UNIQUE). RLS unchanged. Realtime: no trigger —
-- D296 lands `league_weeks` / `matchups` / `team_week_results` broadcasts
-- in L.D1.9 with the write door (the dated D38 disposition; an hourly flip
-- with no subscriber has nothing to broadcast yet). Staging-clone rehearsal
-- disposed via the R6 rule (fresh local `db reset` 001–116). Typegen
-- re-run in the same PR (three PostgREST-exposed functions gain `Functions`
-- entries; the plain helpers are REVOKEd and appear too — additive; the
-- alias block re-appended). Grants doctrine (D18→D23): no per-object GRANT;
-- the REVOKEs are load-bearing on every fresh CREATE.
--
-- HELD-FROM-PRODUCTION: registered (range → 082-116) in the same PR. No
-- launch-surface table is touched: every write is on the leagues chain
-- (`league_weeks`, `matchups`, `team_week_results`, `team_lineups` (league
-- rows only — the F18 swap), `league_player_pool`, `league_chat`); reads
-- outside it are SELECTs on `nfl_games`, `nfl_weeks`, `players`, `teams`.
-- pg_cron gains three rows (the 068/071 mechanism).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. F232's column half — the live comment is the record (109:274 is merged
--    text and stays as it was written)
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN league_player_pool.locked_until IS
  'Game-day lock VIEW (spec v2.16.21 §12.19/§13.1; migration 116, L.D1.6 — F232 column half). The lock is a RULE (a player locks for adds AND drops at his own kickoff, releases at the week''s last game end, `nfl_weeks.last_game_ends_at`); it is ENFORCED by roster_add_drop from nfl_games.kickoff_at at transaction time (113/115) and NEVER read from this column. lineup_lock_tick refreshes this column every run to what 115''s pool_game_lock_any_internal returns: NULL = not locked; the week''s last_game_ends_at = locked until then; ''infinity'' = locked, and the week''s last game end is NOT YET RECORDED (F238 — never NULL, which would read as unlocked).';

-- ---------------------------------------------------------------------------
-- 1. week_games_state_internal — §23.2's gate, read from the games table at
--    run time. A `postponed` game has LEFT the week (E43) only when its
--    kickoff now lies at or beyond the next calendar week's
--    `nfl_weeks.starts_at` (R791); a postponed game whose kickoff is still
--    inside the week is an OPEN game — never excluded. With no later
--    calendar row nothing can leave the week (the loud reading).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION week_games_state_internal(
  p_season INTEGER,
  p_week   INTEGER
) RETURNS TABLE (
  total_games     INTEGER,
  final_games     INTEGER,
  postponed_games INTEGER,
  open_games      INTEGER,
  all_final       BOOLEAN,
  postponed_list  TEXT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH bound AS (
    -- The week ends where the next calendar week starts (§23.3's datum).
    SELECT min(w.starts_at) AS next_starts_at
    FROM public.nfl_weeks w
    WHERE w.season = p_season AND w.week > p_week
  ),
  g AS (
    SELECT g.id, g.status, g.kickoff_at, g.home_team, g.away_team,
           (g.status = 'postponed'
              AND b.next_starts_at IS NOT NULL
              AND g.kickoff_at >= b.next_starts_at) AS left_week
    FROM public.nfl_games g
    CROSS JOIN bound b
    WHERE g.season = p_season AND g.week = p_week
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE g.status = 'final')::int,
    count(*) FILTER (WHERE g.left_week)::int,
    count(*) FILTER (WHERE NOT g.left_week AND g.status <> 'final')::int,
    -- At least one in-week game, and every in-week game final. Zero rows is
    -- the emptiest partial data there is (§23.2) — never finalizable.
    (count(*) FILTER (WHERE NOT g.left_week)) > 0
      AND (count(*) FILTER (WHERE NOT g.left_week AND g.status <> 'final')) = 0,
    string_agg(g.away_team || ' @ ' || g.home_team, ', ' ORDER BY g.kickoff_at, g.id)
      FILTER (WHERE g.left_week)
  FROM g;
$$;
REVOKE EXECUTE ON FUNCTION week_games_state_internal(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. lineup_carry_internal — D293's auto-carry, materialized at week open in
--    114's row shape (starters elements: slot / slot_key / label /
--    player_id / position / kickoff_at / flags; bench = roster − starters −
--    IR; locked_at = the earliest started kickoff)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_carry_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_prev      public.team_lineups;
  v_from      INTEGER;
  v_roster    JSONB;
  v_by_pid    JSONB := '{}'::jsonb;
  v_slots     JSONB;
  v_ir_spots  JSONB;
  v_map       JSONB := '{}'::jsonb;
  v_key       TEXT;
  v_val       JSONB;
  v_pid       TEXT;
  v_e         JSONB;
  v_p         JSONB;
  v_k         RECORD;
  v_kick      JSONB := '{}'::jsonb;
  v_starters  JSONB := '[]'::jsonb;
  v_bench     JSONB;
  v_started   TEXT[] := '{}';
  v_ir_now    TEXT[] := '{}';
  v_dropped   JSONB := '[]'::jsonb;
  v_pflags    JSONB;
  v_f_bye     JSONB := '[]'::jsonb;
  v_f_out     JSONB := '[]'::jsonb;
  v_f_empty   JSONB := '[]'::jsonb;
  v_locked_at TIMESTAMPTZ;
  v_cnt       INTEGER;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lineup_carry_internal: league % not found', p_league_id USING ERRCODE = 'P0002';
  END IF;

  -- The team's latest EARLIER row with a canonical map (114's shape; a
  -- 001-era row without slot_map carries nothing).
  SELECT tl.* INTO v_prev
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = p_season AND tl.week < p_week
    AND tl.slot_map IS NOT NULL
  ORDER BY tl.week DESC
  LIMIT 1;
  IF FOUND THEN
    v_from := v_prev.week;
  END IF;

  -- The roster (114 (3): positions normalized DEF → DST; designations bridged).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',      r.player_id,
           'name',           p.full_name,
           'position',       CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',    public.lineup_designation_internal(p.status),
           'nfl_team',       p.team,
           'ir_placed_week', r.ir_placed_week,
           'slot_key',       r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots (114 (3)).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',   (s ->> 'key') || ':' || i,
           'slot',  s ->> 'key',
           'label', s ->> 'label') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', (s ->> 'key') || ':0', 'spot', s ->> 'key') ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- The carried map: last week's placements for players STILL rostered; IR
  -- keys kept while the player is still on an IR spot; everything else
  -- emptied and NAMED (never silently dropped — D293).
  IF v_from IS NOT NULL THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_prev.slot_map) LOOP
      v_pid := v_val #>> '{}';
      IF NOT (v_by_pid ? v_pid) THEN
        v_dropped := v_dropped || jsonb_build_object('slot', v_key, 'player_id', v_pid, 'reason', 'not_rostered');
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
        -- IR spots are ROSTER-level state (D308/§11.2): the roster decides
        -- below; a previous IR key whose player has left IR is NAMED.
        IF (v_by_pid -> v_pid ->> 'ir_placed_week') IS NULL
           OR (v_by_pid -> v_pid ->> 'slot_key') IS DISTINCT FROM split_part(v_key, ':', 1) THEN
          v_dropped := v_dropped || jsonb_build_object('slot', v_key, 'player_id', v_pid, 'reason', 'not_on_ir');
        END IF;
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key) THEN
        v_dropped := v_dropped || jsonb_build_object('slot', v_key, 'player_id', v_pid, 'reason', 'slot_gone');
        CONTINUE;
      END IF;
      v_map := v_map || jsonb_build_object(v_key, v_pid);
      v_started := v_started || v_pid;
    END LOOP;
  END IF;

  -- IR keys from the ROSTER (league_rosters.slot_key on an IR spot with
  -- ir_placed_week set — the roster is the IR truth, D308), whether or not
  -- an earlier row existed.
  FOR v_e IN
    SELECT s FROM jsonb_array_elements(v_ir_spots) s
  LOOP
    FOR v_p IN
      SELECT r FROM jsonb_array_elements(v_roster) r
      WHERE r ->> 'slot_key' = v_e ->> 'spot' AND (r ->> 'ir_placed_week') IS NOT NULL
      ORDER BY r ->> 'player_id'
      LIMIT 1
    LOOP
      v_ir_now := v_ir_now || (v_p ->> 'player_id');
      v_map := v_map || jsonb_build_object(v_e ->> 'key', v_p ->> 'player_id');
    END LOOP;
  END LOOP;

  -- Per-starter kickoff at the injected instant (112's datum, E42/§23.3).
  FOREACH v_pid IN ARRAY v_started LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_by_pid -> v_pid ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- STARTERS (114 (10)'s shape) + flags; locked_at = the earliest started kickoff.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_map ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_f_empty := v_f_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_f_bye := v_f_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_f_out := v_f_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- The EXPLICIT row. No ON CONFLICT: the caller asserted absence under the
  -- league lock; a collision is a bug and must be loud (23505).
  INSERT INTO public.team_lineups
    (team_id, season, week, starters, bench, slot_map, locked_at, edited_by_commish, set_at)
  VALUES
    (p_team_id, p_season, p_week, v_starters, v_bench, v_map, v_locked_at, FALSE, p_at);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'lineup_carry_internal: wrote % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'team_id',           p_team_id,
    'week',              p_week,
    'carried_from_week', v_from,
    'slot_map',          v_map,
    'dropped',           v_dropped,
    'flags', jsonb_build_object(
      'illegal', jsonb_array_length(v_f_bye) + jsonb_array_length(v_f_out) > 0,
      'bye',     v_f_bye,
      'out',     v_f_out,
      'empty',   v_f_empty),
    'locked_at',         v_locked_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_carry_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. lineup_lock_tick — the pool VIEW + the lineup RECORD, refreshed from the
--    games table every run (never the decider)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_lock_tick(
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
  v_seen           UUID[] := '{}';
  v_loops          INTEGER := 0;
  v_pass           INTEGER;
  v_lg             RECORD;
  v_league         public.leagues;
  v_current        INTEGER;
  v_pool           RECORD;
  v_lock           JSONB;
  v_new_until      TIMESTAMPTZ;
  v_new_state      TEXT;
  v_row            RECORD;
  v_e              JSONB;
  v_pid            TEXT;
  v_team           TEXT;
  v_k              RECORD;
  v_new_locked_at  TIMESTAMPTZ;
  v_new_starters   JSONB;
  v_changed        BOOLEAN;
  v_cnt            INTEGER;
  v_leagues        INTEGER := 0;
  v_pool_rows      INTEGER := 0;
  v_pool_updates   INTEGER := 0;
  v_lineups        INTEGER := 0;
  v_lineup_updates INTEGER := 0;
  v_skipped        JSONB := '[]'::jsonb;
  v_failures       JSONB := '[]'::jsonb;
BEGIN
  -- A job, not a user verb: a JWT-bearing caller is refused in-body (rule 2
  -- — the REVOKE below narrows EXECUTE; this says why in the body).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'lineup_lock_tick: a job RPC is run by pg_cron or the service role, never by a signed-in user'
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
        v_current := public.lineup_current_week_internal(v_lg.id, p_now);
        IF v_current IS NULL THEN
          v_skipped := v_skipped || jsonb_build_object('league_id', v_lg.id, 'reason', 'no_league_weeks');
          CONTINUE;
        END IF;

        -- (a) THE POOL VIEW — what 115's helper says, and nothing else.
        FOR v_pool IN
          SELECT pp.player_id, pp.state, pp.locked_until, p.team AS nfl_team
          FROM public.league_player_pool pp
          JOIN public.players p ON p.id = pp.player_id
          WHERE pp.league_id = v_lg.id
          ORDER BY pp.player_id
        LOOP
          v_pool_rows := v_pool_rows + 1;
          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);
          IF (v_lock ->> 'locked')::boolean THEN
            -- Locked: until the week's recorded last game end — or 'infinity'
            -- while that end is NOT YET RECORDED (F238's loud state; never a
            -- NULL that reads as unlocked, never a release the helper did
            -- not compute).
            v_new_until := COALESCE((v_lock ->> 'window_ends_at')::timestamptz, 'infinity'::timestamptz);
          ELSE
            v_new_until := NULL;
          END IF;
          v_new_state := CASE
            WHEN v_pool.state = 'free_agent'     AND v_new_until IS NOT NULL THEN 'locked_in_game'
            WHEN v_pool.state = 'locked_in_game' AND v_new_until IS NULL     THEN 'free_agent'
            ELSE v_pool.state END;   -- on_waivers / rostered keep their state (F222(a) CHECK; D294 mirror)
          IF v_new_until IS DISTINCT FROM v_pool.locked_until
             OR v_new_state IS DISTINCT FROM v_pool.state THEN
            UPDATE public.league_player_pool pp
            SET locked_until = v_new_until, state = v_new_state, updated_at = p_now
            WHERE pp.league_id = v_lg.id AND pp.player_id = v_pool.player_id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: pool refresh for % touched % rows, expected 1', v_pool.player_id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_pool_updates := v_pool_updates + 1;
          END IF;
        END LOOP;

        -- (b) THE LINEUP RECORD — locked_at + each starter's kickoff_at,
        --     re-evaluated from nfl_games at p_now (E42: a moved kickoff
        --     moves the record; E43: a postponed-out kickoff releases it).
        FOR v_row IN
          SELECT tl.id, tl.week, tl.starters, tl.locked_at
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id
          JOIN public.league_weeks lw
            ON lw.league_id = t.league_id AND lw.season = tl.season AND lw.week = tl.week
          WHERE t.league_id = v_lg.id
            AND tl.season = v_league.season
            AND tl.week <= v_current
            AND lw.status <> 'final'
            AND tl.slot_map IS NOT NULL
          ORDER BY tl.week, tl.team_id
        LOOP
          v_lineups := v_lineups + 1;
          v_new_locked_at := NULL;
          v_new_starters := '[]'::jsonb;
          v_changed := FALSE;
          FOR v_e IN SELECT * FROM jsonb_array_elements(v_row.starters) LOOP
            v_pid := v_e ->> 'player_id';
            IF v_pid IS NULL THEN
              v_new_starters := v_new_starters || v_e;
              CONTINUE;
            END IF;
            SELECT p.team INTO v_team FROM public.players p WHERE p.id = v_pid;
            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);
            -- Compare INSTANTS, not rendered text (a session TimeZone renders
            -- the same instant differently — idempotence must not depend on it).
            IF (v_e ->> 'kickoff_at')::timestamptz IS DISTINCT FROM v_k.kickoff_at THEN
              v_changed := TRUE;
              v_new_starters := v_new_starters || (v_e || jsonb_build_object('kickoff_at', v_k.kickoff_at));
            ELSE
              v_new_starters := v_new_starters || v_e;
            END IF;
            IF v_k.kickoff_at IS NOT NULL THEN
              v_new_locked_at := LEAST(v_new_locked_at, v_k.kickoff_at);
            END IF;
          END LOOP;
          IF v_changed OR v_new_locked_at IS DISTINCT FROM v_row.locked_at THEN
            UPDATE public.team_lineups tl
            SET locked_at = v_new_locked_at,
                starters  = CASE WHEN v_changed THEN v_new_starters ELSE tl.starters END
            WHERE tl.id = v_row.id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: lineup record refresh for % touched % rows, expected 1', v_row.id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_lineup_updates := v_lineup_updates + 1;
          END IF;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'lineup_lock_tick failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',             p_now,
    'scope',          p_league_id,
    'leagues',        v_leagues,
    'pool_rows',      v_pool_rows,
    'pool_updates',   v_pool_updates,
    'lineups',        v_lineups,
    'lineup_updates', v_lineup_updates,
    'skipped',        v_skipped,
    'failures',       v_failures,
    'loops',          v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'no_in_season_leagues'
      WHEN v_pool_updates + v_lineup_updates = 0 THEN 'no_changes'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_lock_tick(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. league_week_advance — the league_weeks status machine on the nfl_weeks
--    boundaries (§23.3); auto-carry materialized at open (D293)
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
    'failures',        v_failures,
    'loops',           v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'no_in_season_leagues'
      WHEN v_opened + v_closed = 0 THEN 'nothing_due'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_week_advance(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. finalize_matchups — after the correction window, all games final:
--    results + median / second (§11.7) → team_week_results; the week → final
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
  v_median_on    BOOLEAN;
  v_first        INTEGER;
  v_lw           RECORD;
  v_g            RECORD;
  v_m            RECORD;
  v_home         NUMERIC;
  v_away         NUMERIC;
  v_res          TEXT;
  v_pending      INTEGER;
  v_dupes        INTEGER;
  v_orphans      INTEGER;
  v_cnt          INTEGER;
  v_teams        INTEGER;
  v_twr          INTEGER;
  v_missing      JSONB;
  v_arr          NUMERIC[];
  v_n            INTEGER;
  v_median       NUMERIC;
  v_matchups     INTEGER;
  v_finalized    INTEGER := 0;
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

      BEGIN
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;
        v_settings  := COALESCE(v_league.settings, '{}'::jsonb);
        v_mode      := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
        v_median_on := COALESCE((v_settings ->> 'median_game')::boolean, FALSE);
        SELECT min(lw.week) INTO v_first
        FROM public.league_weeks lw WHERE lw.league_id = v_lg.id AND lw.season = v_league.season;

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

          IF v_mode = 'h2h' THEN
            -- (b) pending scores (the door's NULL) block the week by name —
            --     on EVERY row, overridden or not: an override is not a
            --     score, and a NULL under one would otherwise reach the
            --     results INSERT as a raw 23502 every hour (R792).
            SELECT count(*) INTO v_pending
            FROM public.matchups m
            WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
              AND (m.home_score IS NULL OR (m.away_team_id IS NOT NULL AND m.away_score IS NULL));
            IF v_pending > 0 THEN
              v_skipped := v_skipped || jsonb_build_object(
                'league_id', v_lg.id, 'week', v_lw.week, 'reason', 'pending_scores', 'pending', v_pending);
              RAISE NOTICE 'finalize_matchups: league % week % not finalized — % matchup(s) carry a NULL score (pending, E61); never coerced to 0.00',
                v_lg.id, v_lw.week, v_pending;
              CONTINUE;
            END IF;

            -- Shape guards: at most one primary row per team; no team only in
            -- a secondary row.
            SELECT count(*) - count(DISTINCT team_id) INTO v_dupes
            FROM (
              SELECT m.home_team_id AS team_id FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week AND m.round_type <> 'secondary'
              UNION ALL
              SELECT m.away_team_id FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week AND m.round_type <> 'secondary'
                AND m.away_team_id IS NOT NULL) x;
            IF v_dupes > 0 THEN
              RAISE EXCEPTION 'finalize_matchups: league % week % has a team in more than one primary matchup — the schedule invariant (§11.7) is broken; refusing to finalize', v_lg.id, v_lw.week
                USING ERRCODE = 'P0001';
            END IF;
            SELECT count(*) INTO v_orphans
            FROM (
              SELECT m.home_team_id AS team_id FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week AND m.round_type = 'secondary'
              UNION
              SELECT m.away_team_id FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week AND m.round_type = 'secondary'
                AND m.away_team_id IS NOT NULL) s
            WHERE NOT EXISTS (
              SELECT 1 FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week AND m.round_type <> 'secondary'
                AND (m.home_team_id = s.team_id OR m.away_team_id = s.team_id));
            IF v_orphans > 0 THEN
              RAISE EXCEPTION 'finalize_matchups: league % week % has % team(s) in a secondary matchup with no primary matchup — the derangement (§11.7/E40) is broken; refusing to finalize', v_lg.id, v_lw.week, v_orphans
                USING ERRCODE = 'P0001';
            END IF;

            -- Results per matchup (E38: two decimals, ties are ties); an
            -- overridden cell is never touched (§22.2).
            FOR v_m IN
              SELECT m.* FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
              ORDER BY m.round_type, m.id
              FOR UPDATE
            LOOP
              v_home := round(v_m.home_score, 2);
              v_away := round(v_m.away_score, 2);
              v_res := CASE
                WHEN v_m.away_team_id IS NULL THEN NULL
                WHEN v_home > v_away THEN 'home'
                WHEN v_home < v_away THEN 'away'
                ELSE 'tie' END;
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

            -- team_week_results from the now-final rows (PF once, §11.7).
            INSERT INTO public.team_week_results
              (league_id, team_id, season, week, points, opponent_team_id, h2h_result,
               second_opponent_team_id, second_result, is_final)
            SELECT v_lg.id, p.team_id, v_league.season, v_lw.week, p.points, p.opponent, p.h2h,
                   s.opponent, s.res, TRUE
            FROM (
              SELECT m.home_team_id AS team_id, round(m.home_score, 2) AS points, m.away_team_id AS opponent,
                     CASE WHEN m.away_team_id IS NULL THEN 'bye'
                          WHEN m.result = 'home' THEN 'win'
                          WHEN m.result = 'away' THEN 'loss'
                          WHEN m.result = 'tie'  THEN 'tie' END AS h2h
              FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
                AND m.round_type <> 'secondary'
              UNION ALL
              SELECT m.away_team_id, round(m.away_score, 2), m.home_team_id,
                     CASE WHEN m.result = 'away' THEN 'win'
                          WHEN m.result = 'home' THEN 'loss'
                          WHEN m.result = 'tie'  THEN 'tie' END
              FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
                AND m.round_type <> 'secondary' AND m.away_team_id IS NOT NULL
            ) p
            LEFT JOIN (
              SELECT m.home_team_id AS team_id, m.away_team_id AS opponent,
                     CASE WHEN m.result = 'home' THEN 'win' WHEN m.result = 'away' THEN 'loss'
                          WHEN m.result = 'tie' THEN 'tie' END AS res
              FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
                AND m.round_type = 'secondary'
              UNION ALL
              SELECT m.away_team_id, m.home_team_id,
                     CASE WHEN m.result = 'away' THEN 'win' WHEN m.result = 'home' THEN 'loss'
                          WHEN m.result = 'tie' THEN 'tie' END
              FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
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
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week AND m.round_type <> 'secondary'
              UNION
              SELECT m.away_team_id FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week AND m.round_type <> 'secondary'
                AND m.away_team_id IS NOT NULL) x;
            IF v_twr <> v_teams THEN
              RAISE EXCEPTION 'finalize_matchups: league % week % wrote % team_week_results rows for % teams', v_lg.id, v_lw.week, v_twr, v_teams
                USING ERRCODE = 'P0001';
            END IF;
          ELSE
            -- (c) total_points: the worker's provisional rows go final. A
            --     SEATED team with NO row is the worker's absence, not a
            --     score (R788): the week is SKIPPED BY NAME
            --     (`pending_results`, the missing teams listed — the mirror
            --     of `pending_scores`) and stays `correction_window`. ANY
            --     missing row holds the week (F241(b): the worker writes a
            --     row per seated team at its first batch, so a missing row
            --     is a team the worker never observed; a partial absence is
            --     the silent shape — seven rows present, an eighth team
            --     scored 0 by omission).
            SELECT COALESCE(jsonb_agg(t.id ORDER BY t.id), '[]'::jsonb) INTO v_missing
            FROM public.teams t
            WHERE t.league_id = v_lg.id AND t.status <> 'retired'
              AND NOT EXISTS (
                SELECT 1 FROM public.team_week_results r
                WHERE r.league_id = v_lg.id AND r.team_id = t.id AND r.season = v_league.season AND r.week = v_lw.week);
            IF jsonb_array_length(v_missing) > 0 THEN
              v_skipped := v_skipped || jsonb_build_object(
                'league_id', v_lg.id, 'week', v_lw.week, 'reason', 'pending_results',
                'pending', jsonb_array_length(v_missing), 'missing', v_missing);
              RAISE NOTICE 'finalize_matchups: league % week % (total_points) not finalized — % seated team(s) have no result row (pending; absence is not a score, §23.2): %',
                v_lg.id, v_lw.week, jsonb_array_length(v_missing), v_missing;
              CONTINUE;
            END IF;
            UPDATE public.team_week_results r
            SET is_final = TRUE, median_result = NULL
            WHERE r.league_id = v_lg.id AND r.season = v_league.season AND r.week = v_lw.week;
            GET DIAGNOSTICS v_twr = ROW_COUNT;
            SELECT count(*) INTO v_teams FROM public.teams t WHERE t.league_id = v_lg.id AND t.status <> 'retired';
            IF v_twr < v_teams THEN
              RAISE EXCEPTION 'finalize_matchups: league % week % (total_points) finalized % rows for % seated teams', v_lg.id, v_lw.week, v_twr, v_teams
                USING ERRCODE = 'P0001';
            END IF;
          END IF;

          -- (d) median_game — regular season only; the average of the two
          --     middle scores, compared EXACTLY (E39).
          v_median := NULL;
          IF v_median_on AND v_lw.week < v_first + v_league.regular_season_weeks THEN
            SELECT array_agg(r.points ORDER BY r.points) INTO v_arr
            FROM public.team_week_results r
            WHERE r.league_id = v_lg.id AND r.season = v_league.season AND r.week = v_lw.week;
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
              WHERE r.league_id = v_lg.id AND r.season = v_league.season AND r.week = v_lw.week;
              GET DIAGNOSTICS v_cnt = ROW_COUNT;
              IF v_cnt <> v_n THEN
                RAISE EXCEPTION 'finalize_matchups: league % week % median wrote % rows for % results', v_lg.id, v_lw.week, v_cnt, v_n
                  USING ERRCODE = 'P0001';
              END IF;
            END IF;
          END IF;

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

          v_finalized := v_finalized + 1;
          v_report := v_report || jsonb_build_object(
            'league_id', v_lg.id, 'week', v_lw.week, 'schedule_mode', v_mode,
            'matchups_final', v_matchups, 'results', v_twr,
            'median_score', v_median,
            'postponed_excluded', v_g.postponed_games);
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'finalize_matchups failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
      END;
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
-- 6. pg_cron — one entry per job (§22.3), unschedule-first (068:1263)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lineup-lock') THEN
    PERFORM cron.unschedule('lineup-lock');
  END IF;
  PERFORM cron.schedule('lineup-lock', '* * * * *', 'SELECT public.lineup_lock_tick()');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'league-week-advance') THEN
    PERFORM cron.unschedule('league-week-advance');
  END IF;
  PERFORM cron.schedule('league-week-advance', '0 * * * *', 'SELECT public.league_week_advance()');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finalize-matchups') THEN
    PERFORM cron.unschedule('finalize-matchups');
  END IF;
  PERFORM cron.schedule('finalize-matchups', '5 * * * *', 'SELECT public.finalize_matchups()');
END;
$do$;
