-- ============================================================================
-- 172_league_stat_corrections.sql — EACH LEAGUE'S RECORD OF A STAT
-- CORRECTION, THE ANNOUNCEMENT, F245's APPLY HALF, THE BRACKET RE-SYNC
-- (task L.E2.2, FULL rigour — scores, results, standings; tasks-M6 TD6 /
-- TD7 / TD8 as RULED by Q81 — PROGRESS D438 / D439 / D440; F510 lists the
-- breakdown sentences Q81 struck; D453 is this migration's as-built note).
-- Spec §23.4 (v2.16.83 — "the league corrections view lists only
-- corrections that changed a league score"; after the window a fix never
-- changes league scores — Q81, Chris 2026-09-29: "if the stat window has
-- closed I think we have to forget it"), §12.21 (the events, "filtered to
-- that league's starters"), §11.4 (in-window corrections recompute non-final
-- matchups; the league sees a system note), §16.4 ("stat correction changed
-- a result" — a notification), §12.12 (audit-log immutability — untouched:
-- a correction is not a commissioner action and writes no receipt).
--
-- Numbering: reserved by the orchestrator (172 / pgTAP 120) and measured at
-- build time (D161) — `ls supabase/migrations | tail -1` →
-- 171_commish_draft_doors.sql, `ls supabase/tests | tail -1` →
-- 119_commish_draft_doors.sql, main @ 8c07977. Production is at 171
-- (measured read-only 2026-09-30); push debt: 172.
--
-- WHAT Q81 LEFT TO BUILD (D438): a record for an OPEN week only — written
-- by the scoring door IN THE SAME TRANSACTION as the re-score, only for
-- teams that STARTED the player, none for a correction that moves no
-- points. NOT built (F510): `week_final` rows, would-be numbers,
-- `stat_correction_record_final_week`, any commissioner door. For a final
-- week the stat event and `player_stats` are the whole record (167) — the
-- door still refuses the week by name (158, unchanged here) and nothing
-- league-side moves.
--
-- WHAT THIS MIGRATION DOES
--   §1 `league_stat_corrections` — one row per (league, week, team, player,
--      event batch): the starter's slot, the team's primary matchup, the
--      events (`event_ids`) and their words (`stat_changes` — key, plain
--      label, old → new), his points before → after, the team's score
--      before → after, and — once every game of the week has ended — the
--      team's results before → after (h2h, second game, median — each as
--      DERIVED FROM THE SCORES, E38), `result_changed`. SELECT for league
--      members (`is_league_member`, the 158 shape); NO write policy for any
--      role — the scoring door (DEFINER, service role) is the only writer.
--   §2 `stat_key_label_internal(key)` — the plain words of a stat key
--      (generated from the registry's labels, `stat-correction-labels.ts`;
--      its census test fails if the two disagree). IMMUTABLE, REVOKEd.
--   §3 `stat_correction_week_state_internal(league, season, week)` — the
--      week as it stands: each team's stored score, its results "if the week
--      ended now" (118's projection — the same derivation finalization
--      writes from: `week_results_derive_internal` + `week_median_internal`,
--      called, never copied), each pairing's score-derived result, and the
--      stored per-player points. STABLE, REVOKEd. The door reads it before
--      and after it writes.
--   §4 `score_write_week_batch` — REPLACED (D137, below): an element MAY
--      carry `corrections` (the ids of the unapplied events of the team's
--      drained starters, sent WITH `players`). The door checks every id is
--      this week's, reads the week before writing, writes exactly as 158,
--      then — in the same transaction — the records (a)–(c), ONE league post
--      naming each correction and each changed team score (and, once the
--      games are over, every flipped result — the second-opponent rows and
--      the median included), and a notification ONLY to a manager whose
--      result changed. It never writes `matchups.result` (TD8 as measured —
--      below). The report gains `corrections` (its presence is how the
--      worker knows the door is 172's) and `bracket_resync_due` (F476).
--   §5 `stat_correction_mark_applied(p_event_ids, p_now)` — §12.21's
--      `applied_at`: stamped at the worker's instant, BEFORE its ack, for
--      the events of every queue row the drain consumes — delivered to every
--      league the row maps to (scored, recorded, or skipped by name), so no
--      event is ever sent twice (R1342). §5b stamps, once, every event
--      recorded before this migration whose row is already drained.
--   §6 `score_bracket_resync(p_league_id, p_now)` — F476: the worker's
--      immediate bracket sync after a re-score of the last regular-season
--      week or a playoff round (118 / 140's `playoff_bracket_sync_internal`,
--      called at the worker's injected instant — the jobs' own contract).
--
-- TD8 AS MEASURED (D453(3)) — WHY THE DOOR DOES NOT WRITE `matchups.result`.
-- TD8 reads "an in-window re-score writes `result` with the score in one
-- statement, so `rebuild_team_week_results` never sees `result_drift`".
-- Measured on 001–171: (i) `rebuild_team_week_results` refuses any week that
-- is not `final` (126:420-425) and this door refuses a `final` week (158) —
-- the two never meet; (ii) no writer sets a non-overridden open row's
-- `result` (the door never has, 119 / 158; `finalize_matchups` writes it
-- from the final scores, 118:2063-2078; the commissioner's arm sets
-- `is_overridden` with it, 126); (iii) a NULL `result` on an open row is
-- LOAD-BEARING: the bracket sync reads a written result as "decided"
-- (140:251), the schedule remix keeps only `result IS NULL` rows (111:698),
-- and the schedule / matchup views show a winner from it
-- (`schedule-view.tsx:267`, `matchup-view-ops.ts:349`). Writing it mid-week
-- would show a winner during a game, freeze a live playoff round, and move
-- every open cell's stored bytes. So "result with the score" is kept by
-- construction: the stored result is NULL until finalization derives it
-- from the final scores, and every result this migration RECORDS or
-- ANNOUNCES is `matchup_result_internal` of the scores the same statement
-- wrote (§3). pgTAP 120 §D drives a correction → finalize → rebuild with
-- no `result_drift`. F245's other half — "a stat correction arriving on a
-- final week" — has no apply path at all under Q81; the one change to a
-- final week stays `commish_edit_score` (126, already F245-safe).
--
-- THE F373 KNOCK-ON (D453(5)). A correction that moves one team's score can
-- flip its opponent's result and any team's median result. That is a
-- CORRECTION, not an override: no `commissioner_actions` row is written and
-- none is owed, `is_overridden` is never set, and D345's per-cell law
-- (which licenses an OVERRIDE's baseline change by its audit row) is
-- untouched. The record names the corrected team; the post names every
-- flipped pairing and median; each manager whose result flipped is
-- notified.
--
-- D137 — `score_write_week_batch` is derived from its NEWEST definer's FILE
-- TEXT, 158:409-720 (158 file md5 eb9526816f20d57e0137d55292289eb3; the
-- function text's md5 b3bc0597efff3d161eac90d8aad728fc; live prosrc md5
-- 548958d0a402c352c91c23fa924a2a0f = pgTAP 106 A7's stored literal), by
-- derive_172.py (PR body — every anchor asserted to hit once, the reversal
-- asserted to reproduce 158's text byte for byte): **5 hunks, +297 / −0**
-- (DECLARE · the shape loop's `corrections` check · the pre-write read ·
-- the records / post / notifications / bracket flag before the RETURN ·
-- the report's two keys). Each hunk is fenced `-- @172{` … `-- @172}` on
-- whole lines, so pgTAP's `pg_temp.un172` (one regexp) reverses them on the
-- LIVE prosrc: 120 §A pins md5(un172(prosrc)) = 158's 548958d0…, and the
-- older pins that named 158's body re-pin ADDITIVELY through it (106 A7 /
-- A8, 109 A10, 115 A8 — the R992 shape). The `NOT m.is_overridden` count is
-- unchanged (3 — 106 A9; 074 K1's two on its reversed body): the records
-- ride `v_pp_write`, the rows 158 already judged writable.
--
-- DEPLOY BEFORE PUSH (TD15; production is at 171; merged code deploys at
-- once). The worker (the one caller) works against a database WITHOUT this
-- migration, scoring exactly as today, by name:
--   * it reads the unapplied events of the drained players (167's table —
--     on production since 171); a 158 door IGNORES the `corrections` key
--     (it reads team_id / points / players only — 158:463-498) and its
--     report has no `corrections` key: the worker names that
--     (`corrections: not_recorded_pre_172`, a problem line) and everything
--     else is byte-identical to today's call;
--   * `stat_correction_mark_applied` / `score_bracket_resync` absent
--     (PGRST202, D426's `isDoorNotPushed`) ⇒ named on the drain, skipped
--     (the hourly beat syncs the bracket as today; `applied_at` stays NULL).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: one table (+ RLS, one SELECT policy, no write policy, PK, four FKs
--   — league / week / team / player CASCADE, matchup SET NULL — two CHECKs,
--   one index); two PLAIN helpers (IMMUTABLE / STABLE, search_path '',
--   REVOKEd); two new DEFINER doors (in-body JWT / anon refusal, search_path
--   '', REVOKEd from PUBLIC / anon / authenticated, EXECUTE to service_role);
--   one DEFINER body replaced (signature unchanged — ACLs kept; the REVOKE
--   restated). No trigger, no cron row, no column on an existing table.
--   Time: no clock is read for a decision — `applied_at` and the bracket
--   sync take the worker's `p_now`; `recorded_at DEFAULT now()` is a write
--   stamp (158's `updated_at = now()` precedent). Lock order: the door takes
--   the league row FOR UPDATE before any read or write (158, unchanged); the
--   bracket door takes it before the sync. Typegen: the table + three
--   functions (additive; the alias block re-appended). Realtime: none here
--   — the re-score's own `matchups` write already broadcasts
--   `scores_updated` (119); the records' own broadcast ships with its first
--   subscriber, the corrections view (D38 — PROGRESS F527).
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–172 and the full pgTAP run in the PR. D38 — ONE
--   backfill (§5b, R1342(a)): every stat_correction_events row recorded
--   between 167's push and this one whose queue row is already drained was
--   re-scored into every league by the pre-172 worker and is stamped
--   `applied_at = detected_at` (no clock read), so a later correction never
--   re-announces it; a row still queued stays unapplied and is delivered by
--   the next drain. No league record is made retroactively (a past
--   re-score's before / after cannot be recovered — the lines were
--   overwritten; 0 events on production at 2026-09-30 10:18Z).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. league_stat_corrections — each league's record of a correction (TD6 as ruled)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS league_stat_corrections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id            UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season               INTEGER NOT NULL,
  week                 INTEGER NOT NULL,
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id            TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot                 TEXT NOT NULL,                   -- the starting slot he scored in (158's key)
  matchup_id           UUID REFERENCES matchups(id) ON DELETE SET NULL,   -- the team's primary pairing row (NULL: total_points / no row)
  event_ids            UUID[] NOT NULL,                 -- the stat_correction_events behind it (167)
  stat_changes         JSONB NOT NULL,                  -- [{event_id, stat_key, label, old, new}] — the words the view reads
  player_points_before NUMERIC(8,2),                    -- his stored points before (NULL: none stored)
  player_points_after  NUMERIC(8,2) NOT NULL,
  team_score_before    NUMERIC(8,2),                    -- NULL = pending (E61)
  team_score_after     NUMERIC(8,2),
  result_before        JSONB,                           -- {h2h, second, median} as derived from the scores; NULL while the week's games are still being played
  result_after         JSONB,
  result_changed       BOOLEAN NOT NULL,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (league_id, season, week) REFERENCES league_weeks(league_id, season, week) ON DELETE CASCADE,
  CONSTRAINT league_stat_corrections_points_moved CHECK (player_points_before IS DISTINCT FROM player_points_after),
  CONSTRAINT league_stat_corrections_has_events CHECK (cardinality(event_ids) > 0 AND jsonb_typeof(stat_changes) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_league_stat_corrections_week ON league_stat_corrections(league_id, season, week);

COMMENT ON TABLE league_stat_corrections IS
  '172 (L.E2.2; spec §23.4 v2.16.83, tasks-M6 TD6 as ruled by Q81 — PROGRESS D438 / D453): one row per (league, week, team, player, event batch) for a stat correction that CHANGED this league''s score — written by score_write_week_batch in the SAME transaction as the re-score, only for a team that STARTED the player, never for a correction that moves no points, never for a final week (Q81: after the window a fix changes no league score; the event itself, stat_correction_events, is the whole record). Results are derived from the scores (E38) and recorded only once the week''s games are over. SELECT: league members; no write policy.';

ALTER TABLE league_stat_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Stat correction records viewable by league members" ON league_stat_corrections;
CREATE POLICY "Stat correction records viewable by league members"
  ON league_stat_corrections FOR SELECT USING (is_league_member(league_id));
-- No INSERT / UPDATE / DELETE policy for any role: the scoring door (DEFINER,
-- service role) is the only writer (pgTAP 120 §B — RETURNING counts per role).

-- ---------------------------------------------------------------------------
-- 2. stat_key_label_internal — a stat key in plain words (generated from the
--    registry by stat-correction-labels.ts; its census test pins this map)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stat_key_label_internal(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_key
    WHEN 'pass_yards' THEN 'passing yards'
    WHEN 'pass_tds' THEN 'passing TDs'
    WHEN 'interceptions' THEN 'interceptions thrown'
    WHEN 'pass_2pt' THEN '2-pt conversions (pass)'
    WHEN 'rush_yards' THEN 'rushing yards'
    WHEN 'rush_tds' THEN 'rushing TDs'
    WHEN 'rush_2pt' THEN '2-pt conversions (rush)'
    WHEN 'receptions' THEN 'receptions'
    WHEN 'receiving_yards' THEN 'receiving yards'
    WHEN 'receiving_tds' THEN 'receiving TDs'
    WHEN 'rec_2pt' THEN '2-pt conversions (rec)'
    WHEN 'fumbles_lost' THEN 'fumbles lost'
    WHEN 'fumble_recovery_td' THEN 'fumble recovery TD'
    WHEN 'return_td' THEN 'kick/punt return TD'
    WHEN 'fg_0_39' THEN 'FG made (0–39)'
    WHEN 'fg_40_49' THEN 'FG made (40–49)'
    WHEN 'fg_50_plus' THEN 'FG made (50+)'
    WHEN 'pat_made' THEN 'PAT made'
    WHEN 'fg_missed' THEN 'FG missed'
    WHEN 'pat_missed' THEN 'PAT missed'
    WHEN 'def_sack' THEN 'sack'
    WHEN 'def_int' THEN 'defensive interception'
    WHEN 'def_fumble_rec' THEN 'fumble recovery'
    WHEN 'def_td' THEN 'defensive TD'
    WHEN 'def_safety' THEN 'safety'
    WHEN 'def_block' THEN 'blocked kick'
    WHEN 'def_return_td' THEN 'return TD (D/ST)'
    WHEN 'pass_attempts' THEN 'pass attempts'
    WHEN 'pass_completions' THEN 'pass completions'
    WHEN 'qb_sack_taken' THEN 'sacks taken'
    WHEN 'rush_attempts' THEN 'rush attempts'
    WHEN 'targets' THEN 'targets'
    WHEN 'fg_made' THEN 'FG made (total)'
    WHEN 'fg_attempted' THEN 'FG attempted'
    WHEN 'pat_attempted' THEN 'PAT attempted'
    WHEN 'def_points_allowed' THEN 'points allowed'
    WHEN 'def_yards_allowed' THEN 'yards allowed'
    WHEN 'example_tracking_yards' THEN 'example tracking yards (placeholder)'
    WHEN 'example_charted_yards' THEN 'example charted yards (placeholder)'
    ELSE replace(p_key, '_', ' ') END;
$$;
REVOKE EXECUTE ON FUNCTION stat_key_label_internal(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. stat_correction_week_state_internal — the week as it stands (the door
--    reads it before and after it writes; TD6 / TD7 / TD8)
--    { teams:    { <team_id>: { score, matchup_id, opponent, h2h,
--                               second_opponent, second, median } },
--      matchups: { <matchup_id>: { round_type, home, away, home_name,
--                                  away_name, home_score, away_score,
--                                  is_overridden, result } },
--      points:   { <team_id>: { <player_id>: { slot, points } } },
--      median:   <the exact median "if the week ended now", or null> }
--    `score` is the STORED score (NULL = pending — E61). The results are
--    118's projection "if the week ended now" — `week_results_derive_internal`
--    (p_projected TRUE: a NULL result read from the scores through
--    `matchup_result_internal`, E38; an override's stored result stands) and
--    `week_median_internal` over the same points, regular season only when
--    `median_game` is on — exactly what `league_standings_projected` counts
--    and what finalization will write from the same scores. A pairing's
--    `result` is `matchup_result_internal` of its stored scores (NULL while
--    either side is pending; an overridden row's stored result).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stat_correction_week_state_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_first     INTEGER;
  v_median_on BOOLEAN;
  v_regular   BOOLEAN;
  v_med       NUMERIC;
  v_teams     JSONB;
  v_matchups  JSONB;
  v_points    JSONB;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stat_correction_week_state_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_median_on := COALESCE((COALESCE(v_league.settings, '{}'::jsonb) ->> 'median_game')::boolean, FALSE);
  SELECT min(lw.week) INTO v_first
  FROM public.league_weeks lw WHERE lw.league_id = p_league_id AND lw.season = p_season;
  v_regular := COALESCE(p_week <= v_first + v_league.regular_season_weeks - 1, FALSE);

  SELECT public.week_median_internal(array_agg(d.points ORDER BY d.points)) INTO v_med
  FROM public.week_results_derive_internal(p_league_id, p_season, p_week, TRUE) d;
  IF NOT (v_median_on AND v_regular) THEN
    v_med := NULL;
  END IF;

  SELECT COALESCE(jsonb_object_agg(d.team_id::text, jsonb_build_object(
           'score', s.points,
           'matchup_id', (SELECT m.id FROM public.matchups m
                          WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week
                            AND m.round_type <> 'secondary' AND (m.home_team_id = d.team_id OR m.away_team_id = d.team_id)
                          ORDER BY m.id LIMIT 1),
           'opponent', d.opponent_team_id,
           'h2h', d.h2h_result,
           'second_opponent', d.second_opponent_team_id,
           'second', d.second_result,
           'median', CASE WHEN v_med IS NULL THEN NULL
                          WHEN d.points > v_med THEN 'win'
                          WHEN d.points < v_med THEN 'loss'
                          ELSE 'tie' END)), '{}'::jsonb)
    INTO v_teams
  FROM public.week_results_derive_internal(p_league_id, p_season, p_week, TRUE) d
  LEFT JOIN public.week_results_derive_internal(p_league_id, p_season, p_week, FALSE) s ON s.team_id = d.team_id;

  SELECT COALESCE(jsonb_object_agg(m.id::text, jsonb_build_object(
           'round_type', m.round_type, 'home', m.home_team_id, 'away', m.away_team_id,
           'home_name', th.name, 'away_name', ta.name,
           'home_score', m.home_score, 'away_score', m.away_score,
           'is_overridden', m.is_overridden,
           'result', CASE WHEN m.is_overridden
                            THEN COALESCE(m.result, public.matchup_result_internal(m.home_score, m.away_score, m.away_team_id))
                          WHEN m.home_score IS NULL OR (m.away_team_id IS NOT NULL AND m.away_score IS NULL) THEN NULL
                          ELSE public.matchup_result_internal(m.home_score, m.away_score, m.away_team_id) END)), '{}'::jsonb)
    INTO v_matchups
  FROM public.matchups m
  JOIN public.teams th ON th.id = m.home_team_id
  LEFT JOIN public.teams ta ON ta.id = m.away_team_id
  WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week;

  SELECT COALESCE(jsonb_object_agg(x.team_id::text, x.players), '{}'::jsonb) INTO v_points
  FROM (SELECT p.team_id, jsonb_object_agg(p.player_id, jsonb_build_object('slot', p.slot, 'points', p.points)) AS players
        FROM public.league_week_player_points p
        WHERE p.league_id = p_league_id AND p.season = p_season AND p.week = p_week
        GROUP BY p.team_id) x;

  RETURN jsonb_build_object('teams', v_teams, 'matchups', v_matchups, 'points', v_points, 'median', v_med);
END;
$$;
REVOKE EXECUTE ON FUNCTION stat_correction_week_state_internal(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. score_write_week_batch — CREATE OR REPLACE against 158's FILE TEXT
--    (D137): derived by derive_172.py, 5 hunks, each fenced `-- @172{` …
--    `-- @172}` (DECLARE · the shape loop's `corrections` check · the
--    pre-write read · the records / post / notifications / bracket flag ·
--    the report's two keys). Every other byte 158's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION score_write_week_batch(
  p_league_id UUID,
  p_week      INTEGER,
  p_scores    JSONB     -- [{team_id: uuid, points: number|null}, …]; null = pending (E61)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_lw        public.league_weeks;
  v_mode      TEXT;
  v_e         JSONB;
  v_i         INTEGER := 0;
  v_n         INTEGER;
  v_tid       UUID;
  v_team_ids  UUID[] := '{}';
  v_m         RECORD;
  v_skipped   JSONB := '[]'::jsonb;
  v_written   INTEGER := 0;
  v_writable  INTEGER := 0;
  v_cnt       INTEGER;
  v_pp_teams  UUID[] := '{}';   -- 158 (F405): teams whose element carries `players`
  v_pp_write  UUID[] := '{}';   -- 158: …and whose score this call may write (the rows follow the score)
  v_pp_rows   INTEGER := 0;     -- 158: per-player rows inserted or changed
  v_pp_gone   INTEGER := 0;     -- 158: per-player rows removed (a slot no longer started)
  -- @172{ (L.E2.2, D453): the optional `corrections` element's state
  v_corr_teams UUID[] := '{}';          -- teams whose element names correction events
  v_corr_n     INTEGER := 0;            -- event ids named across the batch
  v_before     JSONB;                   -- the week as it stood BEFORE this call wrote
  v_after      JSONB;                   -- ...and after
  v_corr       JSONB;                   -- the report's `corrections` object
  v_rec        JSONB := '[]'::jsonb;    -- records written (one per team, player)
  v_cskip      JSONB := '[]'::jsonb;    -- named non-records (the starter filter, no points moved, ...)
  v_pl         RECORD;
  v_pp_after   JSONB;
  v_pp_before  NUMERIC;
  v_score_b    NUMERIC;
  v_score_a    NUMERIC;
  v_lines      TEXT[] := '{}';
  v_flips      TEXT[] := '{}';
  v_post       TEXT;
  v_notified   JSONB := '[]'::jsonb;
  v_not_notified JSONB := '[]'::jsonb;
  v_user       UUID;
  v_body       TEXT;
  v_results_final BOOLEAN := FALSE;
  v_bracket_due   BOOLEAN := FALSE;
  v_cid        UUID;
  v_tb         JSONB;
  v_ta         JSONB;
  v_tname      TEXT;
  v_oname      TEXT;
  -- @172}
BEGIN
  -- The worker's door, never a user verb: a JWT-bearing caller is refused
  -- in-body (rule 2 — the REVOKE below narrows EXECUTE; this says why).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'score_write_week_batch: the scoring write door is the worker''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;

  -- (1) The batch's SHAPE (22023 — a malformed argument, never a state
  --     conflict): an array of {team_id, points}; points a JSON number
  --     with at most two decimals (F22 — the worker rounds, the door
  --     never does) or null (E61 — pending); no duplicate team.
  IF p_league_id IS NULL OR p_week IS NULL OR p_scores IS NULL THEN
    RAISE EXCEPTION 'score_write_week_batch: p_league_id, p_week and p_scores are required'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_scores) <> 'array' THEN
    RAISE EXCEPTION 'score_write_week_batch: p_scores must be a JSON array of {team_id, points} (got %)', jsonb_typeof(p_scores)
      USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_scores);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'score_write_week_batch: p_scores is empty — a batch names at least one team'
      USING ERRCODE = '22023';
  END IF;
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_scores) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'score_write_week_batch: element % is not an object', v_i
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_tid := (v_e ->> 'team_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_tid := NULL;
    END;
    IF v_tid IS NULL THEN
      RAISE EXCEPTION 'score_write_week_batch: element % has no valid team_id', v_i
        USING ERRCODE = '22023';
    END IF;
    IF v_tid = ANY (v_team_ids) THEN
      RAISE EXCEPTION 'score_write_week_batch: team % appears twice in the batch', v_tid
        USING ERRCODE = '22023';
    END IF;
    v_team_ids := v_team_ids || v_tid;
    IF NOT (v_e ? 'points') THEN
      RAISE EXCEPTION 'score_write_week_batch: element % (team %) has no points key — send null for a pending score (E61), never omit it', v_i, v_tid
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'points') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'score_write_week_batch: element % (team %) points must be a JSON number or null (got %)', v_i, v_tid, jsonb_typeof(v_e -> 'points')
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'points') = 'number' AND scale((v_e ->> 'points')::numeric) > 2 THEN
      RAISE EXCEPTION 'score_write_week_batch: element % (team %) points % has more than two decimals — the worker rounds (F22); the door never does', v_i, v_tid, v_e ->> 'points'
        USING ERRCODE = '22023';
    END IF;
    -- 158 (F405): the OPTIONAL per-player arm — each starter's points,
    -- checked to BE the team's score (Σ = points; pending ⇔ null) before
    -- anything is written. An element without `players` writes no rows.
    IF v_e ? 'players' THEN
      PERFORM public.player_points_rows_check_internal('score_write_week_batch', v_i, v_tid, v_e -> 'points', v_e -> 'players');
      v_pp_teams := v_pp_teams || v_tid;
    END IF;
    -- @172{ (L.E2.2, D453): the OPTIONAL `corrections` element — the ids of
    -- the unapplied stat_correction_events of this team's drained starters.
    -- It rides WITH `players` (a record's before / after are those rows);
    -- an element without it is 158's behaviour, byte for byte.
    IF v_e ? 'corrections' THEN
      IF jsonb_typeof(v_e -> 'corrections') <> 'array' OR NOT (v_e ? 'players') THEN
        RAISE EXCEPTION 'score_write_week_batch: element % (team %) corrections must be a JSON array of event ids, sent WITH players (got % / players %)', v_i, v_tid, jsonb_typeof(v_e -> 'corrections'), CASE WHEN v_e ? 'players' THEN 'sent' ELSE 'absent' END
          USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'corrections') c
                 WHERE jsonb_typeof(c) <> 'string'
                    OR (c #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        RAISE EXCEPTION 'score_write_week_batch: element % (team %) corrections holds a value that is not an event id', v_i, v_tid
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_array_length(v_e -> 'corrections') > 0 THEN
        v_corr_teams := v_corr_teams || v_tid;
        v_corr_n := v_corr_n + jsonb_array_length(v_e -> 'corrections');
      END IF;
    END IF;
    -- @172}
  END LOOP;

  -- (2) The league row FIRST (rule 8 lock order), in season.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_write_week_batch: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION 'score_write_week_batch: league_not_in_season — league % is %, the door writes only an in_season/playoffs league (D292)', p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) Every team is THIS league's (a mapping bug is loud, never a skip).
  SELECT count(*) INTO v_cnt
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.id = ANY (v_team_ids);
  IF v_cnt <> cardinality(v_team_ids) THEN
    RAISE EXCEPTION 'score_write_week_batch: the batch names % team(s) that are not league %''s', cardinality(v_team_ids) - v_cnt, p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- (4) The week: scheduled, not final (D295(b)), open (F241(a)).
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_write_week_batch: week_not_scheduled — league % has no league_weeks row for season % week %', p_league_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status = 'final' THEN
    RAISE EXCEPTION 'score_write_week_batch: week_final — league % week % is final; a post-window delta changes no league cell (D295, §23.4)', p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status = 'upcoming' THEN
    RAISE EXCEPTION 'score_write_week_batch: week_not_open — league % week % is upcoming; the door writes only a live or correction_window week', p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;

  v_mode := COALESCE(v_league.settings ->> 'schedule_mode', 'h2h');
  -- @172{ (L.E2.2, D453): every named event is one of THIS week's stat
  -- corrections (a mismatch is a caller bug — loud, never skipped), and the
  -- week is read as it stands BEFORE this call writes anything.
  IF cardinality(v_corr_teams) > 0 THEN
    SELECT count(*) INTO v_cnt
    FROM (SELECT DISTINCT (c #>> '{}')::uuid AS id
          FROM jsonb_array_elements(p_scores) e, jsonb_array_elements(e -> 'corrections') c
          WHERE e ? 'corrections') x
    WHERE NOT EXISTS (SELECT 1 FROM public.stat_correction_events ev
                      WHERE ev.id = x.id AND ev.season = v_league.season AND ev.week = p_week);
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'score_write_week_batch: corrections names % event id(s) that are not season % week % stat corrections', v_cnt, v_league.season, p_week
        USING ERRCODE = '22023';
    END IF;
    v_before := public.stat_correction_week_state_internal(p_league_id, v_league.season, p_week);
  END IF;
  -- @172}

  IF v_mode = 'total_points' THEN
    -- (5t) No matchups: PROVISIONAL team_week_results rows (is_final FALSE).
    --      NULL points ⇒ no row (absence is this mode's pending word —
    --      F241(b)); a final row is never overwritten (a reopened week —
    --      M6's audited path).
    FOR v_e IN SELECT value FROM jsonb_array_elements(p_scores) LOOP
      IF jsonb_typeof(v_e -> 'points') = 'null' THEN
        v_skipped := v_skipped || jsonb_build_object('team_id', v_e ->> 'team_id', 'reason', 'pending_no_row');
      ELSIF EXISTS (
        SELECT 1 FROM public.team_week_results r
        WHERE r.league_id = p_league_id AND r.team_id = (v_e ->> 'team_id')::uuid
          AND r.season = v_league.season AND r.week = p_week AND r.is_final) THEN
        v_skipped := v_skipped || jsonb_build_object('team_id', v_e ->> 'team_id', 'reason', 'result_final');
      ELSE
        v_writable := v_writable + 1;
      END IF;
    END LOOP;

    INSERT INTO public.team_week_results (league_id, team_id, season, week, points, is_final)
    SELECT p_league_id, (e ->> 'team_id')::uuid, v_league.season, p_week, (e ->> 'points')::numeric, FALSE
    FROM jsonb_array_elements(p_scores) e
    WHERE jsonb_typeof(e -> 'points') = 'number'
    ON CONFLICT (league_id, team_id, season, week) DO UPDATE
    SET points = EXCLUDED.points
    WHERE team_week_results.is_final = FALSE
      AND team_week_results.points IS DISTINCT FROM EXCLUDED.points;
    GET DIAGNOSTICS v_written = ROW_COUNT;
  ELSE
    -- (5h) h2h: the week's pairing rows (regular / secondary / playoff —
    --      every round_type; a team's total lands on each row it sits in).
    FOREACH v_tid IN ARRAY v_team_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.matchups m
        WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
          AND (m.home_team_id = v_tid OR m.away_team_id = v_tid)) THEN
        v_skipped := v_skipped || jsonb_build_object('team_id', v_tid, 'reason', 'no_matchup_row');
      END IF;
    END LOOP;

    -- Protected rows the batch touches: NAMED, never written (§22.2/D292).
    FOR v_m IN
      SELECT m.id, m.round_type, m.status, m.is_overridden
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
        AND (m.home_team_id = ANY (v_team_ids) OR m.away_team_id = ANY (v_team_ids))
        AND (m.status = 'final' OR m.is_overridden)
      ORDER BY m.round_type, m.id
    LOOP
      v_skipped := v_skipped || jsonb_build_object(
        'matchup_id', v_m.id, 'round_type', v_m.round_type,
        'reason', CASE WHEN v_m.is_overridden THEN 'overridden' ELSE 'matchup_final' END);
    END LOOP;

    SELECT count(*) INTO v_writable
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND (m.home_team_id = ANY (v_team_ids) OR m.away_team_id = ANY (v_team_ids))
      AND m.status <> 'final' AND NOT m.is_overridden;

    -- THE ONE WRITE: one UPDATE statement, each writable row touched ONCE
    -- with both cells coalesced; a row whose cells would not change is
    -- left out (numeric equality — scale-blind), so the statement trigger
    -- sees exactly what changed and an identical re-send sends nothing.
    -- Rows are resolved by (league, season, week, SIDE TEAM) inside this
    -- statement — never by an id read earlier (F257(a′)). A cell whose team
    -- is not in the batch keeps its value; a `null` writes NULL (E61).
    WITH b AS (
      SELECT (e ->> 'team_id')::uuid AS team_id, (e ->> 'points')::numeric AS points
      FROM jsonb_array_elements(p_scores) e
    ), s AS (
      SELECT m.id,
             bh.team_id IS NOT NULL AS has_home, bh.points AS home_points,
             ba.team_id IS NOT NULL AS has_away, ba.points AS away_points
      FROM public.matchups m
      LEFT JOIN b bh ON bh.team_id = m.home_team_id
      LEFT JOIN b ba ON ba.team_id = m.away_team_id
      WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
        AND m.status <> 'final' AND NOT m.is_overridden
        AND (bh.team_id IS NOT NULL OR ba.team_id IS NOT NULL)
        AND (   (bh.team_id IS NOT NULL AND bh.points IS DISTINCT FROM m.home_score)
             OR (ba.team_id IS NOT NULL AND ba.points IS DISTINCT FROM m.away_score))
    )
    UPDATE public.matchups m
    SET home_score = CASE WHEN s.has_home THEN s.home_points ELSE m.home_score END,
        away_score = CASE WHEN s.has_away THEN s.away_points ELSE m.away_score END,
        updated_at = now()
    FROM s
    WHERE m.id = s.id;
    GET DIAGNOSTICS v_written = ROW_COUNT;
  END IF;

  -- 158 (F405): THE PER-PLAYER ROWS FOLLOW THE SCORE. A team's rows are
  -- written only where its score is this door's to write — h2h: it sits
  -- in a pairing row that is not final and not overridden; total_points:
  -- a number is sent and its row is not final — so the stored lines are
  -- always the lines of the stored score. The team's set is REPLACED: a
  -- slot it no longer starts is removed, a changed slot rewritten, an
  -- identical one left alone. A score written WITHOUT `players` (a
  -- pre-158 caller) takes the team's old rows with it, so no stale row
  -- outlives the score it added up to. A final week never reaches here
  -- (above); the table's own trigger refuses it besides.
  IF v_mode = 'total_points' THEN
    SELECT COALESCE(array_agg(t.id), '{}') INTO v_pp_write
    FROM unnest(v_team_ids) t(id)
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p_scores) e
                  WHERE (e ->> 'team_id')::uuid = t.id AND jsonb_typeof(e -> 'points') = 'number')
      AND NOT EXISTS (SELECT 1 FROM public.team_week_results r
                      WHERE r.league_id = p_league_id AND r.team_id = t.id
                        AND r.season = v_league.season AND r.week = p_week AND r.is_final);
  ELSE
    SELECT COALESCE(array_agg(t.id), '{}') INTO v_pp_write
    FROM unnest(v_team_ids) t(id)
    WHERE EXISTS (SELECT 1 FROM public.matchups m
                  WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
                    AND (m.home_team_id = t.id OR m.away_team_id = t.id)
                    AND m.status <> 'final' AND NOT m.is_overridden);
  END IF;

  DELETE FROM public.league_week_player_points p
  USING (SELECT (e ->> 'team_id')::uuid AS team_id,
                CASE WHEN e ? 'players'
                     THEN ARRAY(SELECT x ->> 'slot' FROM jsonb_array_elements(e -> 'players') x)
                     ELSE '{}'::text[] END AS slots
         FROM jsonb_array_elements(p_scores) e) b
  WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
    AND p.team_id = b.team_id AND b.team_id = ANY (v_pp_write)
    AND NOT (p.slot = ANY (b.slots));
  GET DIAGNOSTICS v_pp_gone = ROW_COUNT;
  SELECT COALESCE(array_agg(t.id), '{}') INTO v_pp_write
  FROM unnest(v_pp_write) t(id) WHERE t.id = ANY (v_pp_teams);

  IF cardinality(v_pp_write) > 0 THEN
    INSERT INTO public.league_week_player_points
      (league_id, season, week, team_id, slot, player_id, points, pending, reason, source)
    SELECT p_league_id, v_league.season, p_week, (e ->> 'team_id')::uuid, x ->> 'slot', x ->> 'player_id',
           (x ->> 'points')::numeric, ARRAY(SELECT jsonb_array_elements_text(x -> 'pending')), x ->> 'reason', 'worker'
    FROM jsonb_array_elements(p_scores) e, jsonb_array_elements(e -> 'players') x
    WHERE e ? 'players' AND (e ->> 'team_id')::uuid = ANY (v_pp_write)
    ON CONFLICT (league_id, season, week, team_id, slot) DO UPDATE
    SET player_id  = EXCLUDED.player_id,
        points     = EXCLUDED.points,
        pending    = EXCLUDED.pending,
        reason     = EXCLUDED.reason,
        source     = EXCLUDED.source,
        updated_at = now()
    WHERE (league_week_player_points.player_id, league_week_player_points.points, league_week_player_points.pending,
           league_week_player_points.reason, league_week_player_points.source)
          IS DISTINCT FROM (EXCLUDED.player_id, EXCLUDED.points, EXCLUDED.pending, EXCLUDED.reason, EXCLUDED.source);
    GET DIAGNOSTICS v_pp_rows = ROW_COUNT;
  END IF;

  -- @172{ (L.E2.2 — TD6 / TD7 / TD8 as ruled by Q81: D438 / D439 / D440;
  -- D453). EACH LEAGUE'S RECORD OF A STAT CORRECTION, written in THIS
  -- transaction with the re-score it caused, so a failure anywhere below
  -- rolls the scores, the stored per-player points, the records, the post
  -- and the notifications back together. One record per (team, player),
  -- and only where all three hold:
  --   (a) the team's score is this call's to write (it is in v_pp_write —
  --       not an overridden or final row; the commissioner's number stands);
  --   (b) the team STARTS the player this week: his row is in the element's
  --       `players` (the terms of its score). A bench player is not — THE
  --       STARTER FILTER (spec §12.21 / §23.4, "filtered to that league's
  --       starters");
  --   (c) his points MOVED (a stat the league does not score moves nothing
  --       and writes nothing — named, never silent);
  -- and an event THIS league has already recorded is never recorded again
  -- (`already_recorded` — R1342: an event still unapplied when a later
  -- correction to the same player-week drains is not re-announced).
  -- matchups.result is NOT written here (TD8 as measured, D453): an open
  -- week's rows carry NULL until finalize_matchups derives it from the
  -- final scores (118), so a stored result can never disagree with its
  -- score (F245 — rebuild_team_week_results never sees result_drift). The
  -- record carries each result AS DERIVED FROM THE SCORES before and after
  -- (matchup_result_internal, E38), and only once every game of the week has
  -- ended (correction_window): while games are still being played a result
  -- is not a result, so none is recorded and no result notification goes.
  IF cardinality(v_corr_teams) > 0 THEN
    v_after := public.stat_correction_week_state_internal(p_league_id, v_league.season, p_week);
    v_results_final := v_lw.status = 'correction_window';
    FOR v_e IN
      SELECT value FROM jsonb_array_elements(p_scores)
      WHERE value ? 'corrections' AND jsonb_array_length(value -> 'corrections') > 0
      ORDER BY value ->> 'team_id'
    LOOP
      v_tid := (v_e ->> 'team_id')::uuid;
      IF NOT (v_tid = ANY (v_pp_write)) THEN
        v_cskip := v_cskip || jsonb_build_object('team_id', v_tid, 'reason', 'score_not_written');
        CONTINUE;
      END IF;
      v_tb := v_before -> 'teams' -> (v_tid::text);
      v_ta := v_after  -> 'teams' -> (v_tid::text);
      SELECT t.name INTO v_tname FROM public.teams t WHERE t.id = v_tid;
      -- R1342: an event already named by one of this league's records is
      -- announced at most once — skipped by name, never re-worded.
      SELECT v_cskip || COALESCE(jsonb_agg(jsonb_build_object('team_id', v_tid, 'event_id', ev.id, 'player_id', ev.player_id, 'reason', 'already_recorded') ORDER BY ev.id), '[]'::jsonb)
        INTO v_cskip
      FROM public.stat_correction_events ev
      WHERE ev.id IN (SELECT (c #>> '{}')::uuid FROM jsonb_array_elements(v_e -> 'corrections') c)
        AND EXISTS (SELECT 1 FROM public.league_stat_corrections r
                    WHERE r.league_id = p_league_id AND ev.id = ANY (r.event_ids));
      FOR v_pl IN
        SELECT ev.player_id,
               array_agg(ev.id ORDER BY ev.stat_key, ev.id) AS ids,
               jsonb_agg(jsonb_build_object('event_id', ev.id, 'stat_key', ev.stat_key,
                                            'label', public.stat_key_label_internal(ev.stat_key),
                                            'old', ev.old_value, 'new', ev.new_value) ORDER BY ev.stat_key, ev.id) AS changes,
               string_agg(public.stat_key_label_internal(ev.stat_key) || ' '
                            || COALESCE(trim_scale(ev.old_value)::text, 'none') || ' → '
                            || COALESCE(trim_scale(ev.new_value)::text, 'none'), ', ' ORDER BY ev.stat_key, ev.id) AS words
        FROM public.stat_correction_events ev
        WHERE ev.id IN (SELECT (c #>> '{}')::uuid FROM jsonb_array_elements(v_e -> 'corrections') c)
          AND NOT EXISTS (SELECT 1 FROM public.league_stat_corrections r
                          WHERE r.league_id = p_league_id AND ev.id = ANY (r.event_ids))
        GROUP BY ev.player_id
        ORDER BY ev.player_id
      LOOP
        v_pp_after := NULL;
        SELECT x INTO v_pp_after FROM jsonb_array_elements(v_e -> 'players') x
        WHERE x ->> 'player_id' = v_pl.player_id LIMIT 1;
        IF v_pp_after IS NULL THEN
          v_cskip := v_cskip || jsonb_build_object('team_id', v_tid, 'player_id', v_pl.player_id, 'reason', 'not_started');
          CONTINUE;
        END IF;
        v_pp_before := (v_before #>> ARRAY['points', v_tid::text, v_pl.player_id, 'points'])::numeric;
        IF v_pp_before IS NOT DISTINCT FROM (v_pp_after ->> 'points')::numeric THEN
          v_cskip := v_cskip || jsonb_build_object('team_id', v_tid, 'player_id', v_pl.player_id, 'reason', 'no_points_moved');
          CONTINUE;
        END IF;
        v_score_b := (v_tb ->> 'score')::numeric;
        v_score_a := (v_ta ->> 'score')::numeric;
        INSERT INTO public.league_stat_corrections
          (league_id, season, week, team_id, player_id, slot, matchup_id, event_ids, stat_changes,
           player_points_before, player_points_after, team_score_before, team_score_after,
           result_before, result_after, result_changed)
        VALUES (p_league_id, v_league.season, p_week, v_tid, v_pl.player_id, v_pp_after ->> 'slot',
                (v_ta ->> 'matchup_id')::uuid, v_pl.ids, v_pl.changes,
                v_pp_before, (v_pp_after ->> 'points')::numeric, v_score_b, v_score_a,
                CASE WHEN v_results_final THEN jsonb_build_object('h2h', v_tb ->> 'h2h', 'second', v_tb ->> 'second', 'median', v_tb ->> 'median') END,
                CASE WHEN v_results_final THEN jsonb_build_object('h2h', v_ta ->> 'h2h', 'second', v_ta ->> 'second', 'median', v_ta ->> 'median') END,
                v_results_final AND ROW(v_tb ->> 'h2h', v_tb ->> 'second', v_tb ->> 'median')
                                    IS DISTINCT FROM ROW(v_ta ->> 'h2h', v_ta ->> 'second', v_ta ->> 'median'))
        RETURNING id INTO v_cid;
        v_rec := v_rec || jsonb_build_object(
          'id', v_cid, 'team_id', v_tid, 'player_id', v_pl.player_id, 'event_ids', to_jsonb(v_pl.ids),
          'player_points_before', v_pp_before, 'player_points_after', (v_pp_after ->> 'points')::numeric,
          'team_score_before', v_score_b, 'team_score_after', v_score_a);
        SELECT p.full_name INTO v_oname FROM public.players p WHERE p.id = v_pl.player_id;
        v_lines := v_lines || (COALESCE(v_oname, v_pl.player_id) || '''s ' || v_pl.words || ' — ' || v_tname || ' '
          || COALESCE(to_char(v_score_b, 'FM999999990.00'), 'pending') || ' → '
          || COALESCE(to_char(v_score_a, 'FM999999990.00'), 'pending'));
      END LOOP;
    END LOOP;

    IF jsonb_array_length(v_rec) > 0 THEN
      -- TD7 / D439 — ONE league post per re-score, in plain words: each
      -- correction and each changed team score; then, once the week's games
      -- are over, every pairing whose result it flipped (the second-opponent
      -- rows included) and every median game it flipped (the F373 knock-on —
      -- a correction, never an override: no commissioner_actions row, D345
      -- untouched).
      v_post := 'Stat correction (Week ' || p_week || '): ' || array_to_string(v_lines, '; ') || '.';
      IF v_results_final THEN
        SELECT COALESCE(array_agg(s.words ORDER BY s.round_type, s.id), '{}') INTO v_flips
        FROM (
          SELECT a.key AS id, a.value ->> 'round_type' AS round_type,
                 CASE a.value ->> 'result'
                   WHEN 'home' THEN (a.value ->> 'home_name') || ' now beats ' || (a.value ->> 'away_name') || ' '
                                    || to_char((a.value ->> 'home_score')::numeric, 'FM999999990.00') || '–' || to_char((a.value ->> 'away_score')::numeric, 'FM999999990.00')
                   WHEN 'away' THEN (a.value ->> 'away_name') || ' now beats ' || (a.value ->> 'home_name') || ' '
                                    || to_char((a.value ->> 'away_score')::numeric, 'FM999999990.00') || '–' || to_char((a.value ->> 'home_score')::numeric, 'FM999999990.00')
                   WHEN 'tie'  THEN (a.value ->> 'home_name') || ' and ' || (a.value ->> 'away_name') || ' now tie '
                                    || to_char((a.value ->> 'home_score')::numeric, 'FM999999990.00') || '–' || to_char((a.value ->> 'away_score')::numeric, 'FM999999990.00')
                   ELSE (a.value ->> 'home_name') || ' v ' || COALESCE(a.value ->> 'away_name', 'bye') || ' has no result yet' END
                 || CASE WHEN a.value ->> 'round_type' = 'secondary' THEN ' (second game)' ELSE '' END AS words
          FROM jsonb_each(v_after -> 'matchups') a
          JOIN jsonb_each(v_before -> 'matchups') b ON b.key = a.key
          WHERE (a.value ->> 'result') IS DISTINCT FROM (b.value ->> 'result')
        ) s;
        IF cardinality(v_flips) > 0 THEN
          v_post := v_post || ' Result changed: ' || array_to_string(v_flips, '; ') || '.';
        END IF;
        SELECT string_agg(t.name || ' now ' || CASE a.value ->> 'median' WHEN 'win' THEN 'wins' WHEN 'loss' THEN 'loses' ELSE 'ties' END
                          || ' the median game (it ' || CASE b.value ->> 'median' WHEN 'win' THEN 'was winning' WHEN 'loss' THEN 'was losing' WHEN 'tie' THEN 'was tied' ELSE 'had no result' END || ')',
                          '; ' ORDER BY t.name, t.id)
          INTO v_body
        FROM jsonb_each(v_after -> 'teams') a
        JOIN jsonb_each(v_before -> 'teams') b ON b.key = a.key
        JOIN public.teams t ON t.id = a.key::uuid
        WHERE (a.value ->> 'median') IS DISTINCT FROM (b.value ->> 'median');
        IF v_body IS NOT NULL THEN
          v_post := v_post || ' Median game: ' || v_body || '.';
        END IF;
      END IF;
      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
      VALUES (p_league_id, NULL, v_post, 'league', TRUE);

      -- TD7 / D439 — a notification ONLY to a manager whose result changed
      -- (h2h, second game or median; §16.4 "stat correction changed a
      -- result"); a score-only change is in the post and the corrections
      -- view. Once per seated manager; an unseated team is named.
      IF v_results_final THEN
        FOR v_pl IN
          SELECT a.key::uuid AS team_id, a.value AS aft, b.value AS bef
          FROM jsonb_each(v_after -> 'teams') a
          JOIN jsonb_each(v_before -> 'teams') b ON b.key = a.key
          WHERE ROW(a.value ->> 'h2h', a.value ->> 'second', a.value ->> 'median')
                IS DISTINCT FROM ROW(b.value ->> 'h2h', b.value ->> 'second', b.value ->> 'median')
          ORDER BY a.key
        LOOP
          v_user := NULL;
          SELECT m.user_id INTO v_user
          FROM public.league_members m
          WHERE m.league_id = p_league_id AND m.team_id = v_pl.team_id AND m.user_id IS NOT NULL;
          IF v_user IS NULL THEN
            v_not_notified := v_not_notified || jsonb_build_object('team_id', v_pl.team_id, 'why', 'no_seated_manager');
            CONTINUE;
          END IF;
          v_body := 'Stat correction (Week ' || p_week || '): ' || array_to_string(v_lines, '; ') || '.';
          IF (v_pl.aft ->> 'h2h') IS DISTINCT FROM (v_pl.bef ->> 'h2h') THEN
            SELECT t.name INTO v_oname FROM public.teams t WHERE t.id = (v_pl.aft ->> 'opponent')::uuid;
            v_body := v_body || ' ' || CASE v_pl.aft ->> 'h2h'
                WHEN 'win'  THEN 'You now beat ' || COALESCE(v_oname, 'your opponent') || ' '
                                 || to_char((v_pl.aft ->> 'score')::numeric, 'FM999999990.00') || '–' || to_char((v_after #>> ARRAY['teams', v_pl.aft ->> 'opponent', 'score'])::numeric, 'FM999999990.00')
                WHEN 'loss' THEN COALESCE(v_oname, 'Your opponent') || ' now beats you '
                                 || to_char((v_after #>> ARRAY['teams', v_pl.aft ->> 'opponent', 'score'])::numeric, 'FM999999990.00') || '–' || to_char((v_pl.aft ->> 'score')::numeric, 'FM999999990.00')
                WHEN 'tie'  THEN 'You and ' || COALESCE(v_oname, 'your opponent') || ' now tie '
                                 || to_char((v_pl.aft ->> 'score')::numeric, 'FM999999990.00') || '–' || to_char((v_after #>> ARRAY['teams', v_pl.aft ->> 'opponent', 'score'])::numeric, 'FM999999990.00')
                ELSE 'Your matchup has no result yet' END
              || ' (you were ' || CASE v_pl.bef ->> 'h2h' WHEN 'win' THEN 'winning' WHEN 'loss' THEN 'losing' WHEN 'tie' THEN 'tied' ELSE 'without a result' END || ').';
          END IF;
          IF (v_pl.aft ->> 'second') IS DISTINCT FROM (v_pl.bef ->> 'second') THEN
            SELECT t.name INTO v_oname FROM public.teams t WHERE t.id = (v_pl.aft ->> 'second_opponent')::uuid;
            v_body := v_body || ' In your second game ' || CASE v_pl.aft ->> 'second'
                WHEN 'win'  THEN 'you now beat ' || COALESCE(v_oname, 'your opponent')
                WHEN 'loss' THEN COALESCE(v_oname, 'your opponent') || ' now beats you'
                WHEN 'tie'  THEN 'you and ' || COALESCE(v_oname, 'your opponent') || ' now tie'
                ELSE 'there is no result yet' END
              || ' (you were ' || CASE v_pl.bef ->> 'second' WHEN 'win' THEN 'winning' WHEN 'loss' THEN 'losing' WHEN 'tie' THEN 'tied' ELSE 'without a result' END || ').';
          END IF;
          IF (v_pl.aft ->> 'median') IS DISTINCT FROM (v_pl.bef ->> 'median') THEN
            v_body := v_body || ' You now ' || CASE v_pl.aft ->> 'median' WHEN 'win' THEN 'win' WHEN 'loss' THEN 'lose' ELSE 'tie' END
              || ' the median game (you were ' || CASE v_pl.bef ->> 'median' WHEN 'win' THEN 'winning' WHEN 'loss' THEN 'losing' WHEN 'tie' THEN 'tied' ELSE 'without a result' END || ').';
          END IF;
          INSERT INTO public.notifications (user_id, type, title, body, data)
          VALUES (v_user, 'stat_correction_result', 'A stat correction changed your Week ' || p_week || ' result', v_body,
                  jsonb_build_object('league_id', p_league_id, 'team_id', v_pl.team_id, 'season', v_league.season, 'week', p_week,
                                     'correction_ids', (SELECT jsonb_agg(r -> 'id') FROM jsonb_array_elements(v_rec) r)));
          v_notified := v_notified || jsonb_build_object('team_id', v_pl.team_id, 'user_id', v_user, 'body', v_body);
        END LOOP;
      END IF;
    END IF;

    v_corr := jsonb_build_object(
      'teams_sent', cardinality(v_corr_teams), 'events_sent', v_corr_n,
      'recorded', jsonb_array_length(v_rec), 'records', v_rec, 'skipped', v_cskip,
      'results_final', v_results_final, 'post', v_post,
      'notified', v_notified, 'not_notified', v_not_notified,
      'reason', CASE WHEN jsonb_array_length(v_rec) > 0 THEN NULL ELSE 'nothing_recorded' END);
  ELSE
    v_corr := jsonb_build_object(
      'teams_sent', 0, 'events_sent', 0, 'recorded', 0, 'records', '[]'::jsonb, 'skipped', '[]'::jsonb,
      'results_final', v_lw.status = 'correction_window', 'post', NULL,
      'notified', '[]'::jsonb, 'not_notified', '[]'::jsonb, 'reason', 'none_sent');
  END IF;

  -- F476 (D440, D453): a re-score of the last regular-season week or a
  -- playoff round, once its games are over, owes the bracket its sync NOW
  -- rather than at the next hourly beat. The sync reads the caller's
  -- instant (p_now — the jobs' contract), which this door does not take:
  -- it SAYS the sync is due and the worker runs `score_bracket_resync` at
  -- its own injected instant right after this transaction commits.
  v_bracket_due := v_written > 0 AND v_mode = 'h2h' AND v_lw.status = 'correction_window'
    AND COALESCE(v_league.playoff_teams, 0) > 0
    AND p_week >= (SELECT min(lw.week) FROM public.league_weeks lw
                   WHERE lw.league_id = p_league_id AND lw.season = v_league.season) + v_league.regular_season_weeks - 1;
  -- @172}
  RETURN jsonb_build_object(
    'league_id', p_league_id,
    'season',    v_league.season,
    'week',      p_week,
    'mode',      v_mode,
    'received',  v_n,
    'writable',  v_writable,
    'written',   v_written,
    'unchanged', v_writable - v_written,
    'skipped',   v_skipped,
    -- 158 (F405): the per-player arm's own count. Its ABSENCE is how the
    -- worker knows it is talking to a pre-158 door (it names that).
    'player_points', jsonb_build_object(
      'teams_sent',    cardinality(v_pp_teams),
      'teams_written', cardinality(v_pp_write),
      'rows_written',  v_pp_rows,
      'rows_removed',  v_pp_gone),
    -- @172{ (L.E2.2): the corrections arm's report. Its PRESENCE is how the
    -- worker knows it is talking to a 172 door (a 158 door ignores the
    -- element and says nothing of it — named there, never silent).
    'corrections', v_corr,
    'bracket_resync_due', v_bracket_due,
    -- @172}
    'reason', CASE
      WHEN v_writable = 0 THEN 'nothing_writable'   -- every touched row protected / every team pending or row-less
      WHEN v_written = 0  THEN 'no_change'          -- the identical re-send: zero writes, zero events
      ELSE NULL END);
END;
$$;

REVOKE EXECUTE ON FUNCTION score_write_week_batch(UUID, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. stat_correction_mark_applied — §12.21's `applied_at` ("when the league
--    recompute fan-out completed"), at the worker's instant
--    The score worker calls it with the events it read for the queue rows
--    it is about to CONSUME, BEFORE its ack (R1342): those events were
--    delivered to every league the row maps to in this drain (scored,
--    recorded, or skipped by name — week_final, not scheduled, not
--    rostered, a quarantined league's D292 skip; PROGRESS D453(7) / F531),
--    so none is ever sent again. A stamp that fails fails the drain before
--    its ack: the rows stay queued and the next drain re-delivers the same
--    events against the same lines — no points move, nothing is recorded
--    twice (the door's `no_points_moved` / `already_recorded`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stat_correction_mark_applied(
  p_event_ids UUID[],
  p_now       TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_named   INTEGER;
  v_stamped INTEGER;
  v_already INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL OR coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'stat_correction_mark_applied: the score worker''s door (service role), never a signed-in or anonymous caller''s'
      USING ERRCODE = '42501';
  END IF;
  IF p_event_ids IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'stat_correction_mark_applied: p_event_ids and p_now are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT x) INTO v_named FROM unnest(p_event_ids) x;
  SELECT count(*) INTO v_already
  FROM public.stat_correction_events e
  WHERE e.id = ANY (p_event_ids) AND e.applied_at IS NOT NULL;

  UPDATE public.stat_correction_events e
  SET applied_at = p_now
  WHERE e.id = ANY (p_event_ids) AND e.applied_at IS NULL;
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  RETURN jsonb_build_object(
    'named', v_named, 'stamped', v_stamped, 'already_applied', v_already,
    'unknown', v_named - v_stamped - v_already,
    'reason', CASE WHEN v_named = 0 THEN 'none_named'
                   WHEN v_stamped = 0 THEN 'nothing_to_stamp' ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION stat_correction_mark_applied(UUID[], TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stat_correction_mark_applied(UUID[], TIMESTAMPTZ) TO service_role;

-- ---------------------------------------------------------------------------
-- 5b. stat_correction_backfill_applied_internal — the ONE-TIME stamp of the
--     events recorded before this migration (R1342(a), the D38 backfill).
--     Between 167's push and 172's, the stats poll records events and the
--     worker drains their queue rows, but nothing stamps `applied_at` (the
--     door above does not exist yet). Every such event whose player-week has
--     NO `score_fanout` row left was already re-scored into every league —
--     it is reflected, and a later correction must never re-announce it — so
--     it is stamped `applied_at = detected_at` (no clock read; the instant it
--     was seen is the latest it can have been applied from). An event whose
--     row is still queued is in flight: left unapplied, the next drain
--     delivers it. Plain, REVOKEd; run once below; pgTAP 120 §W drives it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stat_correction_backfill_applied_internal()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_cnt INTEGER;
BEGIN
  UPDATE public.stat_correction_events e
  SET applied_at = e.detected_at
  WHERE e.applied_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.score_fanout q
                    WHERE q.season = e.season AND q.week = e.week AND q.player_id = e.player_id);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN v_cnt;
END;
$$;
REVOKE EXECUTE ON FUNCTION stat_correction_backfill_applied_internal() FROM PUBLIC, anon, authenticated;

DO $bf$
DECLARE
  v_n INTEGER := public.stat_correction_backfill_applied_internal();
BEGIN
  RAISE NOTICE '172: % stat_correction_events recorded before this migration stamped applied (applied_at = detected_at — already re-scored, never re-announced; R1342)', v_n;
END $bf$;

-- ---------------------------------------------------------------------------
-- 6. score_bracket_resync — F476: the bracket sync at once after a re-score
--    of the last regular-season week or a playoff round (the door's
--    `bracket_resync_due`), at the worker's injected instant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION score_bracket_resync(
  p_league_id UUID,
  p_now       TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
BEGIN
  IF auth.uid() IS NOT NULL OR coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'score_bracket_resync: the score worker''s door (service role), never a signed-in or anonymous caller''s'
      USING ERRCODE = '42501';
  END IF;
  IF p_league_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'score_bracket_resync: p_league_id and p_now are required'
      USING ERRCODE = '22023';
  END IF;
  -- Rule 8: the league row first — the same order the hourly jobs take.
  SELECT l.* INTO v_league FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_bracket_resync: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'reason', 'league_not_in_season', 'status', v_league.status);
  END IF;
  -- The ONE bracket writer (118 / 140), exactly as league_week_advance and
  -- finalize_matchups call it — idempotent; a played round is refused by
  -- name inside it (R839), never rewritten here.
  RETURN jsonb_build_object('league_id', p_league_id) || public.playoff_bracket_sync_internal(p_league_id, p_now);
END;
$$;
REVOKE EXECUTE ON FUNCTION score_bracket_resync(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION score_bracket_resync(UUID, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION score_bracket_resync(UUID, TIMESTAMPTZ) IS
  '172 (L.E2.2, F476): the score worker''s immediate bracket sync after a re-score of the last regular-season week or a playoff round (score_write_week_batch reports bracket_resync_due) — playoff_bracket_sync_internal at the worker''s injected instant, the league row locked first. Service role only.';
COMMENT ON FUNCTION stat_correction_mark_applied(UUID[], TIMESTAMPTZ) IS
  '172 (L.E2.2, spec §12.21): stamps stat_correction_events.applied_at = p_now for each named, still-unapplied event — the score worker''s call, BEFORE its ack, with the events of the queue rows it consumes (delivered to every league they map to in that drain; R1342). Service role only.';
