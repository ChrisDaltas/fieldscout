-- ============================================================================
-- 216 — a week must not close over a lost score (PROGRESS F863 / Q105; rows
--       F256(b), F257(a), F273, F859, F860; spec §7.3.3, §11.4, §23.2, §23.4,
--       E61, D295(b); FULL rigour — scoring and finalize; D820–D829)
-- ============================================================================
--
-- THE RULING. Put to Chris by the orchestrator, 2026-11-05, in these words:
--   "Games stay blank until they've actually been scored." "A failed save gets
--   retried instead of thrown away." "Updates that were lost get scored again."
--   "A week can't close while it's still owed a score." "This needs a database
--   update that you'd push."
-- He answered: "merge and fix them now".
--
-- WHAT WAS MEASURED BEFORE THIS FILE (rolled-back probes on 215; PROGRESS D820):
--   F273 + F859 — a generated row reads 0 / 0; with a 300-yard starter's line
--     stored and his queue row still waiting, finalize closed the week 0–0
--     `tie`, status final, the queue row left behind.
--   F256(b) — with the prior week holding a blank the sync says
--     `bracket_waiting`; the door answers `no_matchup_row` for the update; the
--     round is built later at 0 / 0 and finalize decides it 0–0 `higher_seed`,
--     the league complete with that champion.
--   F860 — one door error: `failed` 1 AND `drained` 1, queue empty, the stored
--     score unmoved. (The worker half of this file's fix lives in
--     `score-week-worker.ts`.)
--
-- WHAT THIS FILE DOES
--   1. `matchups.home_score` / `away_score` lose 109's DEFAULT 0. Every path
--      that inserts a row without the columns (110's schedule, 111's remix,
--      130 / 131's schedule edits, 118 → 199's bracket) now starts it BLANK,
--      and `week_results_pending_internal` already holds a week on a blank.
--   2. THE BACKFILL (D821) — never-scored 0s become blank; see THE RULE below.
--   3. `league_weeks.scored_digest` / `scored_at` — THE CLOSE OF THE WEEK.
--      `league_week_scores_digest_internal` hashes what a league-week's scores
--      are computed from: every lineup slot of the week, each starter's stat
--      line stamp, the week's frozen rules and the week's zeroing game holds.
--      The worker's close pass (`runCloseScoring`, score-week-worker.ts) asks
--      `league_weeks_to_close` which correction-window weeks need closing,
--      recomputes EVERY team on a pairing from `player_stats` through the same
--      pipeline and the same door, and `league_week_close_stamp` records the
--      digest it read — only if the digest still stands. That one pass:
--        * writes the real 0 of a team no update ever reached (F273's closer),
--        * re-scores updates that were consumed before the round existed
--          (F256(b)) or thrown away by a failed save (F860),
--        * scores lines whose queue row has not drained (F859),
--      all per league-week, reading nothing of the shared queue (D790's rule:
--      no other league's queue state can move this answer).
--   4. `finalize_matchups` gains one guard (D137, marked `-- 216 / F863`):
--      after the blank check, a week whose lines no longer hash to the closed
--      digest is skipped BY NAME, `scores_owed`. No stat line of the week in any
--      lineup ⇒ nothing is owed and the digest is NULL.
--   5. `week_results_pending_internal` gains one guard: a bracket league's
--      playoff week with NO pairing row at all is `round_not_built`. Before, a
--      round the sync could not build closed its week with no games.
--   6. `playoff_bracket_sync_internal`: "played" is now simply a written score
--      (F257(a)'s closer) — a real 0.00 no longer reads as unplayed.
--   7. `score_fanout_ack`: a deferred row may carry its own `defer_until`, so a
--      league-week that keeps failing retries every few minutes, not at the
--      not-ready cadence, and stays loud (F860). Pre-216 the key is ignored.
--
-- NOT TOUCHED, ON PURPOSE: `score_write_week_batch` (it already takes a real 0
-- and a real NULL), `admin_rescore_final_week`, `league_week_player_points`'
-- lock, every `final` week. Nothing here reads or writes a final week, so
-- re-scoring one works exactly as before (the F870 / F871 work relies on it).
-- Standings, tiebreakers, median and seeding read FINAL rows, which hold no
-- blank by construction; the projected arm keeps its `COALESCE(…, 0)` ("a NULL
-- score is 0.00 so far", 118 / pgTAP 066).
--
-- A STARTER WITH NO LINE IS A REAL 0, NEVER A HOLD: the close pass scores him
-- 0 and names him `no_stat_row` (the worker's built reading, §23.3 / Q42 —
-- the 14 `starter_final_game_no_line` alerts on production's week 8 are this
-- shape). The digest counts him as "no line", so he can't block anything. The
-- ONE refusal to write 0s: a week with no stat line for ANY player at all
-- (`no_stat_lines` — the feed never arrived). That is an outage, not a week of
-- DNPs, and it stays blank and held, by name, until lines land.
--
-- THE BACKFILL RULE (D821): a cell becomes blank when ALL of —
--   the cell is exactly 0; the row is not overridden and not `final`; its week
--   is not `final`; and `league_week_player_points` holds NO row for that team
--   in that league-week.
-- WHY THAT TELLS THEM APART: since 158 the door writes a team's per-player rows
-- WITH its score in one transaction, so a score that was really written has its
-- rows. A team really scored 0.00 with starters keeps its rows and its 0. The
-- only real write with no rows is an EMPTY lineup's 0; it goes blank and the
-- close pass writes the same 0 back. Non-zero cells, overridden rows and final
-- weeks are never touched, whatever else is true.
--
-- SAFE TO PUSH MID-GAME. The file takes league_weeks' and matchups' ACCESS
-- EXCLUSIVE locks first, in the door's order (R1791), so no door call can
-- interleave with the backfill and none can deadlock with the file. A live team that was never scored goes
-- from "0.00" to pending; its next update writes the number. A team already
-- scored is untouched. `updated_at` is left alone (nothing was scored). The
-- archive freeze (212) is lifted for the one statement only: an archived
-- league's future rows go blank too, or they would come back from a restore as
-- plausible 0s; nothing else in the league moves.
--
-- DEPLOY BEFORE PUSH. The app reaching production first keeps working: the
-- close pass answers `available: false` by name (PGRST202) until this is
-- pushed, the ack's new key is ignored, and every reader already takes a NULL.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * New columns nullable with no default; no new table, no RLS change
--     (`league_weeks` keeps its member SELECT; the two columns are harmless to
--     read and no role may write them — it has no write policy).
--   * New doors `league_weeks_to_close`, `league_week_close_stamp`: SECURITY
--     DEFINER, search_path '', in-body refusal of any JWT-bearing caller,
--     REVOKE PUBLIC / anon / authenticated — the worker's, like 121's claim.
--     Helpers plain, search_path '', REVOKEd.
--   * Time only through p_now (the worker's injected instant).
--   * D137: finalize_matchups 212:2165-2445 (+6 / -0); week_results_pending_internal
--     199:467-513 (+5 / -0); playoff_bracket_sync_internal 199:4630-5036 (+1 / -2);
--     score_fanout_ack 122:209-354 (+2 / -2). Derived by script; every other byte
--     is the file text. Grants restated by the replaced bodies' REVOKE lines.
--   * Typegen: additive (two columns, five functions); alias block kept.
--   * WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh reset over the
--     full chain + pgTAP 166's fixture shaped like production. D38 — the backfill
--     is this file's own statement, proven there.
--   * Rollback: restore the four bodies from their files, DROP the five new
--     functions and two columns, `ALTER COLUMN … SET DEFAULT 0` on both scores.
--     Blank cells then stay blank until scored, which reads correctly.
--     THE APP CAN'T ROLL BACK ALONE (R1792): an app older than the F863 merge
--     has no close pass, so with this file in place nothing calls
--     league_week_close_stamp and every league's week holds as
--     scores_owed / never_closed. Roll the app back only with this rollback.
--   * FIRST PASS AFTER THE PUSH (R1792): it recomputes every team of an open
--     correction-window week from the stored stats, so a cell reconcile calls
--     `drift` moves on screen. Pre-push check: reconcile week 8, zero drift.
-- pgTAP 166_lost_scores.sql; stack vitest lost-scores-db.test.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns, under both tables' ACCESS EXCLUSIVE lock (nothing interleaves)
-- ---------------------------------------------------------------------------
-- R1791: every lock this file needs on the two tables, taken FIRST and at the
-- strongest mode its statements need (ALTER TABLE is ACCESS EXCLUSIVE), so no
-- statement below upgrades a lock it already holds. The order is the order the
-- write door and finalize touch them in: `score_write_week_batch` (177) reads
-- league_weeks (its step 4) before it writes matchups, and `finalize_matchups`
-- (below, 212's body) takes league_weeks FOR UPDATE before it reads or writes
-- matchups — so a door or finalize call in flight is waited out before this
-- file holds anything on matchups (one that already holds matchups holds
-- league_weeks too). Any other session that touches matchups BEFORE
-- league_weeks can still meet the file in a deadlock; Postgres aborts one side,
-- and if that is this file the whole push rolls back and is simply re-run.
-- Before this, 216 took SHARE ROW EXCLUSIVE on matchups
-- and then needed ACCESS EXCLUSIVE for the ALTER: a session that had read both
-- tables and then UPDATEd matchups deadlocked with it (the review's probe).
-- Both locks are held to the end of the file, so the backfill (§2) runs under
-- them; ACCESS EXCLUSIVE on both was already held from the ALTERs to COMMIT.
LOCK TABLE public.league_weeks, public.matchups IN ACCESS EXCLUSIVE MODE;

ALTER TABLE matchups ALTER COLUMN home_score DROP DEFAULT;
ALTER TABLE matchups ALTER COLUMN away_score DROP DEFAULT;
COMMENT ON COLUMN matchups.home_score IS
  'Migration 216 (F273, Chris 2026-11-05): BLANK until the team is scored — the write door''s word for pending (E61), and what holds a week from closing. A written 0 is a real 0.';
COMMENT ON COLUMN matchups.away_score IS
  'Migration 216 (F273): as home_score. NULL on a bye row always.';

ALTER TABLE league_weeks ADD COLUMN scored_digest TEXT;
ALTER TABLE league_weeks ADD COLUMN scored_at TIMESTAMPTZ;
COMMENT ON COLUMN league_weeks.scored_digest IS
  'Migration 216 (F863): the hash of the lines this week''s scores were last computed from (league_week_scores_digest_internal), recorded by the close pass. finalize_matchups holds the week (scores_owed) while the lines no longer hash to it. Never read the queue instead: D790.';
COMMENT ON COLUMN league_weeks.scored_at IS
  'Migration 216 (F863): when the close pass last closed this week''s scores; NULL if it never has.';

-- ---------------------------------------------------------------------------
-- 2. THE BACKFILL (D821 — the rule is in the banner)
-- ---------------------------------------------------------------------------
-- The rule lives in one function so pgTAP 166 can run it on a fixture shaped
-- like production; this file is its only production caller.
CREATE OR REPLACE FUNCTION matchups_blank_never_scored_internal()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_cnt INTEGER;
BEGIN
  UPDATE public.matchups m
  SET home_score = CASE
        WHEN m.home_score = 0
         AND NOT EXISTS (SELECT 1 FROM public.league_week_player_points p
                         WHERE p.league_id = m.league_id AND p.season = m.season AND p.week = m.week
                           AND p.team_id = m.home_team_id)
        THEN NULL ELSE m.home_score END,
      away_score = CASE
        WHEN m.away_score = 0
         AND NOT EXISTS (SELECT 1 FROM public.league_week_player_points p
                         WHERE p.league_id = m.league_id AND p.season = m.season AND p.week = m.week
                           AND p.team_id = m.away_team_id)
        THEN NULL ELSE m.away_score END
  WHERE m.status <> 'final'
    AND NOT m.is_overridden
    AND (m.home_score = 0 OR m.away_score = 0)
    AND NOT EXISTS (SELECT 1 FROM public.league_weeks lw
                    WHERE lw.league_id = m.league_id AND lw.season = m.season AND lw.week = m.week
                      AND lw.status = 'final');
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN v_cnt;
END;
$$;
REVOKE ALL ON FUNCTION matchups_blank_never_scored_internal() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION matchups_blank_never_scored_internal() IS
  'Migration 216 (F273, D821): the one-time backfill rule — a cell that is exactly 0 with no stored per-player row for its team-week, on a row not overridden and not final, in a week not final, becomes blank. Run once by migration 216, under the matchups lock; then REVOKEd from every API role, service_role included (R1795). Its return is the rows it touched.';

ALTER TABLE matchups DISABLE TRIGGER tr_aa_league_archived_guard;
SELECT public.matchups_blank_never_scored_internal();
ALTER TABLE matchups ENABLE TRIGGER tr_aa_league_archived_guard;
-- R1795: run once — then no API role may run it again. A stray call would
-- re-blank an empty-lineup team's real 0 in a week not yet final. REVOKEd from
-- service_role too (it keeps the owner's EXECUTE, so pgTAP 166 still runs the
-- rule on its fixture as the owner); 166 pins that no API role holds EXECUTE.
REVOKE ALL ON FUNCTION matchups_blank_never_scored_internal() FROM service_role;

-- ---------------------------------------------------------------------------
-- 3. The digest and the hold
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_week_scores_digest_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER
) RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH slots AS (
    SELECT tl.team_id, e.key AS slot, e.value AS player_id
    FROM public.team_lineups tl
    JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
    CROSS JOIN LATERAL jsonb_each_text(
      CASE WHEN jsonb_typeof(tl.slot_map) = 'object' THEN tl.slot_map ELSE '{}'::jsonb END) e
    WHERE tl.season = p_season AND tl.week = p_week
  ), lined AS (
    SELECT s.team_id, s.slot, s.player_id, ps.updated_at
    FROM slots s
    LEFT JOIN public.player_stats ps
      ON ps.player_id = s.player_id AND ps.season = p_season AND ps.week = p_week
  )
  SELECT CASE WHEN count(l.updated_at) = 0 THEN NULL ELSE md5(
           string_agg(l.team_id::text || ':' || l.slot || ':' || l.player_id || ':'
                        || COALESCE(extract(epoch FROM l.updated_at)::text, '-'),
                      '|' ORDER BY l.team_id, l.slot)
           || '#' || COALESCE((SELECT md5(lw.scoring_rules_snapshot::text) FROM public.league_weeks lw
                               WHERE lw.league_id = p_league_id AND lw.season = p_season AND lw.week = p_week), '-')
           || '#' || COALESCE((SELECT string_agg(g.id, ',' ORDER BY g.id) FROM public.nfl_games g
                               WHERE g.season = p_season AND g.week = p_week
                                 AND g.operator_hold IN ('out_of_week', 'cancelled')), '-')) END
  FROM lined l;
$$;
REVOKE ALL ON FUNCTION league_week_scores_digest_internal(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION league_week_scores_digest_internal(UUID, INTEGER, INTEGER) IS
  'Migration 216 (F863): a hash of what a league-week''s scores are computed from — every lineup slot, each starter''s stat line stamp, the week''s frozen rules, its zeroing game holds. NULL when no starter of the week has a line (nothing to owe). Order-free, so a line landing out of order still moves it; reads no queue (D790).';

CREATE OR REPLACE FUNCTION week_scores_owed_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_now    TEXT := public.league_week_scores_digest_internal(p_league_id, p_season, p_week);
  v_stored TEXT;
  v_at     TIMESTAMPTZ;
BEGIN
  SELECT lw.scored_digest, lw.scored_at INTO v_stored, v_at
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = p_season AND lw.week = p_week;
  IF v_now IS NULL OR v_now = v_stored THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('reason', 'scores_owed', 'closed_at', v_at,
    'why', CASE WHEN v_at IS NULL THEN 'never_closed' ELSE 'lines_moved' END);
END;
$$;
REVOKE ALL ON FUNCTION week_scores_owed_internal(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION week_scores_owed_internal(UUID, INTEGER, INTEGER) IS
  'Migration 216 (F863): finalize_matchups'' guard — NULL when the week''s lines still hash to the digest the close pass recorded (or no starter has a line); else {reason: scores_owed}. League-local: reads no queue and no other league (D790).';

-- ---------------------------------------------------------------------------
-- 4. The close pass's two doors (the worker's, like 121's claim)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_weeks_to_close(
  p_now        TIMESTAMPTZ,
  p_limit      INTEGER DEFAULT 25,
  p_league_ids UUID[]  DEFAULT NULL
) RETURNS TABLE (
  league_id UUID,
  season    INTEGER,
  week      INTEGER,
  digest    TEXT,
  reason    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'league_weeks_to_close: the close pass is the worker''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;
  IF p_now IS NULL OR p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'league_weeks_to_close: p_now and a positive p_limit are required (the injected instant, D291)'
      USING ERRCODE = '22023';
  END IF;

  -- A correction-window week needs closing when (a) it never has been, (b) it
  -- holds a blank and either a pairing was built after the close or its window
  -- is about to end (or has), (c) inside the last 15 minutes of its window, or
  -- past it, its lines no longer hash to the closed digest. Only (a) and (b)'s
  -- cheap arms run all season; the digest is computed for this set only.
  RETURN QUERY
    WITH due AS (
      SELECT lw.league_id AS lid, lw.season AS sn, lw.week AS wk, lw.scored_at, lw.scored_digest,
             w.correction_window_ends_at <= p_now + interval '15 minutes' AS near,
             EXISTS (SELECT 1 FROM public.matchups m
                     WHERE m.league_id = lw.league_id AND m.season = lw.season AND m.week = lw.week
                       AND m.status <> 'final'
                       AND (m.home_score IS NULL OR (m.away_team_id IS NOT NULL AND m.away_score IS NULL))
                       AND (lw.scored_at IS NULL OR m.created_at >= lw.scored_at
                            OR w.correction_window_ends_at <= p_now + interval '15 minutes')) AS blank
      FROM public.league_weeks lw
      JOIN public.leagues l ON l.id = lw.league_id AND l.season = lw.season
      JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
      WHERE lw.status = 'correction_window'
        AND l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_ids IS NULL OR l.id = ANY (p_league_ids))
    ), asked AS (
      SELECT d.*, public.league_week_scores_digest_internal(d.lid, d.sn, d.wk) AS now_digest
      FROM due d
      WHERE d.scored_at IS NULL OR d.blank OR d.near
    )
    SELECT a.lid, a.sn, a.wk, a.now_digest,
           CASE WHEN NOT EXISTS (SELECT 1 FROM public.player_stats ps WHERE ps.season = a.sn AND ps.week = a.wk) THEN 'no_stat_lines'
                WHEN a.scored_at IS NULL THEN 'never_closed'
                WHEN a.blank THEN 'blank'
                ELSE 'lines_moved' END
    FROM asked a
    CROSS JOIN LATERAL public.week_games_state_internal(a.sn, a.wk) g
    WHERE g.all_final   -- "once the games are final": a game moved within the week keeps its players open (§23.4)
      AND (a.scored_at IS NULL OR a.blank OR a.now_digest IS DISTINCT FROM a.scored_digest)
    ORDER BY random()   -- a week that keeps failing can't starve the rest of a capped pass
    LIMIT p_limit;
END;
$$;
REVOKE EXECUTE ON FUNCTION league_weeks_to_close(TIMESTAMPTZ, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION league_weeks_to_close(TIMESTAMPTZ, INTEGER, UUID[]) IS
  'Migration 216 (F863): the correction-window weeks whose scores the close pass must close now, each with the digest of its lines AS THIS CALL READ THEM (the worker hands it back to league_week_close_stamp) and why. A week with no stat line for any player answers no_stat_lines: nothing is zero-filled over an outage. Worker only.';

CREATE OR REPLACE FUNCTION league_week_close_stamp(
  p_league_id UUID,
  p_week      INTEGER,
  p_digest    TEXT,
  p_scores    JSONB,       -- [{team_id, points}], the close pass's numbers; used only to fill a BLANK cell on an overridden row
  p_now       TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
  v_status TEXT;
  v_now    TEXT;
  v_filled INTEGER := 0;
  v_cnt    INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'league_week_close_stamp: the close pass is the worker''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;
  IF p_league_id IS NULL OR p_week IS NULL OR p_now IS NULL
     OR p_scores IS NULL OR jsonb_typeof(p_scores) <> 'array' THEN
    RAISE EXCEPTION 'league_week_close_stamp: p_league_id, p_week, p_now and a JSON array p_scores are required'
      USING ERRCODE = '22023';
  END IF;

  -- The league row first (rule 8); the door's own order.
  SELECT l.* INTO v_league FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('stamped', FALSE, 'why', 'league_not_found_or_archived', 'filled', 0);
  END IF;
  SELECT lw.status INTO v_status FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF v_status IS DISTINCT FROM 'correction_window' THEN
    RETURN jsonb_build_object('stamped', FALSE, 'why', 'week_' || COALESCE(v_status, 'missing'), 'filled', 0);
  END IF;

  -- The lines moved since the pass read them: nothing recorded, so the next
  -- pass re-scores (this also heals a stale door write that raced a drain).
  v_now := public.league_week_scores_digest_internal(p_league_id, v_league.season, p_week);
  IF v_now IS DISTINCT FROM p_digest THEN
    RETURN jsonb_build_object('stamped', FALSE, 'why', 'lines_moved', 'filled', 0);
  END IF;

  -- A commissioner's "declare a winner" leaves the scores as they are, and the
  -- door never writes an overridden row (§22.2). On a team not yet scored that
  -- would leave a blank nothing can ever fill, and the week held for ever. A
  -- blank isn't the commissioner's number, so the close pass fills it; a number
  -- on that row, and its result, stand.
  WITH b AS (
    SELECT (e ->> 'team_id')::uuid AS team_id, (e ->> 'points')::numeric AS points
    FROM jsonb_array_elements(p_scores) e
    WHERE jsonb_typeof(e -> 'points') = 'number'
  )
  UPDATE public.matchups m
  SET home_score = COALESCE(m.home_score, bh.points),
      away_score = CASE WHEN m.away_team_id IS NULL THEN m.away_score ELSE COALESCE(m.away_score, ba.points) END,
      updated_at = p_now
  FROM public.matchups x
  LEFT JOIN b bh ON bh.team_id = x.home_team_id
  LEFT JOIN b ba ON ba.team_id = x.away_team_id
  WHERE x.id = m.id
    AND m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
    AND m.is_overridden AND m.status <> 'final'
    AND ((m.home_score IS NULL AND bh.points IS NOT NULL)
         OR (m.away_team_id IS NOT NULL AND m.away_score IS NULL AND ba.points IS NOT NULL));
  GET DIAGNOSTICS v_filled = ROW_COUNT;

  UPDATE public.league_weeks
  SET scored_digest = p_digest, scored_at = p_now
  WHERE league_id = p_league_id AND season = v_league.season AND week = p_week;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'league_week_close_stamp: stamping week % of league % touched % rows, expected 1', p_week, p_league_id, v_cnt
      USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('stamped', TRUE, 'why', NULL, 'filled', v_filled);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_week_close_stamp(UUID, INTEGER, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION league_week_close_stamp(UUID, INTEGER, TEXT, JSONB, TIMESTAMPTZ) IS
  'Migration 216 (F863): records that a correction-window week''s scores were computed from the lines hashing to p_digest — only if they still do. Fills a BLANK cell on an overridden row from the pass''s number (never a number, never a result). Worker only.';

-- ---------------------------------------------------------------------------
-- 5. D137 — the four replaced bodies, each its newest FILE TEXT + marked hunks
-- ---------------------------------------------------------------------------
-- week_results_pending_internal — 199_remove_retire_schema.sql:467-513 FILE TEXT, 1 hunk (+5 / -0).
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
    IF NOT EXISTS (SELECT 1 FROM public.matchups m WHERE m.league_id = p_league_id AND m.season = p_season AND m.week = p_week)   -- 216 / F863 (F256(b)): a playoff week whose round was never built is owed its games
       AND EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = p_league_id AND COALESCE(l.playoff_teams, 0) >= 2   -- 216 / F863
                     AND p_week >= (SELECT min(lw.week) FROM public.league_weeks lw WHERE lw.league_id = p_league_id AND lw.season = p_season) + l.regular_season_weeks) THEN   -- 216 / F863
      RETURN jsonb_build_object('reason', 'round_not_built', 'pending', 0);   -- 216 / F863
    END IF;   -- 216 / F863
    RETURN NULL;
  END IF;

  -- total_points: the worker's provisional rows; ANY seated team missing
  -- holds the week (F241(b) — a partial absence is the silent shape).
  SELECT COALESCE(jsonb_agg(t.id ORDER BY t.id), '[]'::jsonb) INTO v_missing
  FROM public.teams t
  WHERE t.league_id = p_league_id
    AND NOT EXISTS (
      SELECT 1 FROM public.team_week_results r
      WHERE r.league_id = p_league_id AND r.season = p_season AND r.week = p_week
        AND r.team_id = t.id);
  IF jsonb_array_length(v_missing) > 0 THEN
    RETURN jsonb_build_object('reason', 'pending_results',
                              'pending', jsonb_array_length(v_missing), 'missing', v_missing);
  END IF;
  RETURN NULL;
END;
$$;

-- finalize_matchups — 212_league_archive.sql:2165-2445 FILE TEXT, 1 hunk (+6 / -0).
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

  PERFORM public.job_pause_note_internal('week-finalize', p_league_id, p_now);   -- 183 / L.G1.3 (TD4)

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
        AND NOT public.job_paused_internal('week-finalize', l.id)   -- 183 / L.G1.3 (TD4)
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
          IF public.league_restore_hold_internal(v_lg.id, p_now) IS NOT NULL THEN   -- 212 / F716 (R1755): the RESTORE WINDOW — a league restored in the last 30 minutes waits, so its scoring catch-up lands first
            v_skipped := v_skipped || jsonb_build_object('league_id', v_lg.id, 'week', v_lw.week, 'reason', 'recently_restored', 'restored_at', v_league.restored_at, 'remaining_seconds', public.league_restore_hold_internal(v_lg.id, p_now));   -- 212 / F716 (R1755)
            RAISE NOTICE 'finalize_matchups: league % week % not finalized — the league was restored at % and waits out the 30-minute restore window (% s left), so the restore''s scoring catch-up lands first (R1755)', v_lg.id, v_lw.week, v_league.restored_at, public.league_restore_hold_internal(v_lg.id, p_now);   -- 212 / F716 (R1755)
            CONTINUE;   -- 212 / F716 (R1755)
          END IF;   -- 212 / F716 (R1755)

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
          v_pend := public.week_scores_owed_internal(v_lg.id, v_league.season, v_lw.week);   -- 216 / F863 (F859 / F860 / F256(b)): the week's lines moved since its scores were last closed
          IF v_pend IS NOT NULL THEN   -- 216 / F863
            v_skipped := v_skipped || (jsonb_build_object('league_id', v_lg.id, 'week', v_lw.week) || v_pend);   -- 216 / F863
            RAISE WARNING 'finalize_matchups: league % week % not finalized — a score is still owed (%): the close-of-week pass has not scored the lines as they stand; retried next run', v_lg.id, v_lw.week, v_pend ->> 'reason';   -- 216 / F863
            CONTINUE;   -- 216 / F863
          END IF;   -- 216 / F863

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
              'Week ' || v_lw.week || ' is final without the postponed game' ||
              CASE WHEN v_g.postponed_games > 1 THEN 's ' ELSE ' ' END || v_g.postponed_list ||
              ' — players in a game moved out of the week score 0 for the week. The commissioner can change a result.',
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

-- playoff_bracket_sync_internal — 199_remove_retire_schema.sql:4630-5036 FILE TEXT, 1 hunk (+1 / -2).
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

    -- L.E1.16 (migration 134, PROGRESS F360 — RULED WANTED, R1047): a round a
    -- COMMISSIONER HAND-PICKED is his, not the engine's. `commish_edit_bracket`
    -- stamps EVERY seeded row of the round with `pairing_set_by_action_id`
    -- (the commissioner_actions receipt), and this is the STAND-DOWN it
    -- named in its `bypassed[]`: the round is never compared against the
    -- prior stage's verdict, never DELETEd and re-INSERTed (the write below)
    -- and never refused as "played" — it stands as picked, its survivors
    -- feed the next round exactly as a decided round's do. An open
    -- hand-picked round returns by name (the `round_in_progress` shape); a
    -- rolled one CONTINUEs. Reused `v_cnt` on purpose: ONE hunk (D137).
    SELECT count(*)::int INTO v_cnt
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.week >= v_wk_first AND m.week <= v_wk_last
      AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
      AND m.pairing_set_by_action_id IS NOT NULL;
    IF v_cnt > 0 THEN
      IF NOT (v_round ->> 'rolled')::boolean THEN
        RETURN jsonb_build_object('reason', 'round_hand_picked', 'round', v_r,
                                  'source', CASE WHEN v_prev_final THEN 'final' ELSE 'provisional' END,
                                  'weeks', jsonb_build_array(v_wk_first, v_wk_last),
                                  'rows', v_cnt,
                                  'set_by_action_id',
                                    (SELECT max(m.pairing_set_by_action_id::text)
                                     FROM public.matchups m
                                     WHERE m.league_id = p_league_id AND m.season = v_league.season
                                       AND m.week >= v_wk_first AND m.week <= v_wk_last
                                       AND m.round_type = 'playoff' AND m.pairing_set_by_action_id IS NOT NULL));
      END IF;
      v_entrants     := v_round -> 'survivors';
      v_prev_rolled  := TRUE;
      v_prev_final   := (v_round ->> 'final')::boolean;
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
        RAISE EXCEPTION 'playoff_bracket_sync_internal: league % has % ranked teams for % playoff spots — the playoff bracket can''t be set (there can''t be more playoff teams than teams)', p_league_id, v_n, v_pt
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
        AND (m.home_score IS NOT NULL OR m.away_score IS NOT NULL);   -- 216 / F863 (F257(a)): no DEFAULT any more, so a written score is simply non-NULL — a real 0.00 is played
      IF (v_round ->> 'rolled')::boolean OR v_played > 0 THEN
        RAISE NOTICE 'playoff_bracket_sync_internal: league % round % is HISTORY (rolled %, % scored rows) but the prior stage''s verdict now says % (stored %) — the rewrite is REFUSED; the bracket stands as played (F377(a), ruled 2026-09-27)',
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

-- score_fanout_ack — 122_system_flags_and_deferral.sql:209-354 FILE TEXT, 1 hunk (+2 / -2).
CREATE OR REPLACE FUNCTION score_fanout_ack(
  p_claim_token UUID,
  p_consumed    JSONB,                          -- [{season, week, player_id, enqueued_at}] — the claim's OWN rows, the stamp verbatim
  p_deferred    JSONB       DEFAULT '[]'::jsonb, -- same shape: the HELD rows (not ready / week not open) — R872
  p_defer_until TIMESTAMPTZ DEFAULT NULL         -- REQUIRED when p_deferred is non-empty (the worker's injected instant + its window)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_e        JSONB;
  v_i        INTEGER := 0;
  v_stamp    TIMESTAMPTZ;
  v_deleted  INTEGER := 0;
  v_deferred INTEGER := 0;
  v_released INTEGER := 0;
  v_missed   JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'score_fanout_ack: the scoring queue is the worker''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;

  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'score_fanout_ack: p_claim_token is required — the token score_fanout_claim returned'
      USING ERRCODE = '22023';
  END IF;
  IF p_consumed IS NULL OR jsonb_typeof(p_consumed) <> 'array' THEN
    RAISE EXCEPTION 'score_fanout_ack: p_consumed must be a JSON array of {season, week, player_id, enqueued_at} (got %)',
      COALESCE(jsonb_typeof(p_consumed), 'null')
      USING ERRCODE = '22023';
  END IF;
  IF p_deferred IS NULL OR jsonb_typeof(p_deferred) <> 'array' THEN
    RAISE EXCEPTION 'score_fanout_ack: p_deferred must be a JSON array of {season, week, player_id, enqueued_at} (got %)',
      COALESCE(jsonb_typeof(p_deferred), 'null')
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_deferred) > 0 AND p_defer_until IS NULL THEN
    RAISE EXCEPTION 'score_fanout_ack: p_defer_until is required when p_deferred is non-empty (the injected instant + the defer window, D291)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) The batches' SHAPE (22023 — a malformed argument, never a state
  --     conflict): every element of BOTH arrays an object carrying the four
  --     keys, the stamp parseable as timestamptz.
  FOR v_e IN SELECT * FROM jsonb_array_elements(p_consumed || p_deferred) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'score_fanout_ack: element % is not an object', v_i USING ERRCODE = '22023';
    END IF;
    IF v_e ->> 'season' IS NULL OR v_e ->> 'week' IS NULL OR v_e ->> 'player_id' IS NULL OR v_e ->> 'enqueued_at' IS NULL THEN
      RAISE EXCEPTION 'score_fanout_ack: element % must carry season, week, player_id and enqueued_at', v_i USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'season') <> 'number' OR jsonb_typeof(v_e -> 'week') <> 'number' THEN
      RAISE EXCEPTION 'score_fanout_ack: element % season/week must be JSON numbers', v_i USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_stamp := (v_e ->> 'enqueued_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'score_fanout_ack: element % enqueued_at % is not a timestamp — send the claim''s own rendering verbatim', v_i, v_e ->> 'enqueued_at'
        USING ERRCODE = '22023';
    END;
  END LOOP;

  -- (2) DELETE what this token still holds at the stamp it was claimed at;
  --     classify the rest by what is measured (R869). The classification
  --     reads the pre-statement snapshot (a data-modifying CTE's effects are
  --     invisible to sibling CTEs), which is exactly the state of every row
  --     the DELETE did not touch.
  WITH c AS (
    SELECT (e ->> 'season')::integer   AS season,
           (e ->> 'week')::integer     AS week,
           (e ->> 'player_id')         AS player_id,
           (e ->> 'enqueued_at')::timestamptz AS enqueued_at
      FROM jsonb_array_elements(p_consumed) e
  ),
  del AS (
    DELETE FROM public.score_fanout q
     USING c
     WHERE q.season = c.season AND q.week = c.week AND q.player_id = c.player_id
       AND q.claim_token = p_claim_token
       AND q.enqueued_at = c.enqueued_at
    RETURNING q.season, q.week, q.player_id
  ),
  miss AS (
    SELECT c.season, c.week, c.player_id,
           CASE WHEN q.player_id IS NULL                THEN 'gone'
                WHEN q.claim_token = p_claim_token      THEN 'restamped'
                ELSE                                         'lease_lost' END AS reason
      FROM c
      LEFT JOIN public.score_fanout q
        ON q.season = c.season AND q.week = c.week AND q.player_id = c.player_id
     WHERE NOT EXISTS (SELECT 1 FROM del WHERE del.season = c.season AND del.week = c.week AND del.player_id = c.player_id)
  )
  SELECT (SELECT count(*) FROM del),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('season', miss.season, 'week', miss.week, 'player_id', miss.player_id, 'reason', miss.reason)
                                    ORDER BY miss.season, miss.week, miss.player_id), '[]'::jsonb)
            FROM miss)
    INTO v_deleted, v_missed;

  -- (2b — 122) DEFER the held rows this token still holds AT THE STAMP the
  --      claim returned (by-stamp, like the delete: a row whose stamp moved
  --      under the lease carries a newer delta and is ready — it is simply
  --      released below). The deferral and the release are one statement
  --      per row: unleased AND deferred, never leased-and-hidden.
  IF jsonb_array_length(p_deferred) > 0 THEN
    WITH d AS (
      SELECT (e ->> 'season')::integer   AS season,
             (e ->> 'week')::integer     AS week,
             (e ->> 'player_id')         AS player_id,
             (e ->> 'enqueued_at')::timestamptz AS enqueued_at,
             (e ->> 'defer_until')::timestamptz AS defer_until   -- 216 / F863 (F860)
        FROM jsonb_array_elements(p_deferred) e
    ),
    upd AS (
      UPDATE public.score_fanout q
         SET deferred_until = COALESCE(d.defer_until, p_defer_until), claimed_at = NULL, claim_token = NULL   -- 216 / F863 (F860): a row may carry its own longer hold
        FROM d
       WHERE q.season = d.season AND q.week = d.week AND q.player_id = d.player_id
         AND q.claim_token = p_claim_token
         AND q.enqueued_at = d.enqueued_at
      RETURNING 1
    )
    SELECT count(*) INTO v_deferred FROM upd;
  END IF;

  -- (3) RELEASE everything still under this token: the re-stamped survivors,
  --     the out-of-scope, and any held row the caller did not defer. Rows
  --     another claim took (a different token) are untouched — they are that
  --     drain's now.
  UPDATE public.score_fanout
     SET claimed_at = NULL, claim_token = NULL
   WHERE claim_token = p_claim_token;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted',  v_deleted,
    'deferred', v_deferred,
    'released', v_released + v_deferred,   -- every row handed back, deferred or not (121's meaning of `released`)
    'missed',   v_missed
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION score_fanout_ack(UUID, JSONB, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
