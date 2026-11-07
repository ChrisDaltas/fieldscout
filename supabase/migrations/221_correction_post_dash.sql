-- ============================================================================
-- 221 — the stat-correction post and notification print a blank team score
--       as "—", never "pending" (PROGRESS F911, D847; D845's correction post;
--       spec §16.4 / §23.4, v2.16.117). COPY ONLY: no scoring, no NULL
--       semantics, no result or flip logic changes.
-- ============================================================================
--
-- THE RULING (Chris, 2026-11-06, verbatim, in chat):
--   "i've never heard of this pending thing before. been playing fantasy
--    football on multiple platforms for decades and i've never heard of
--    pending."
-- PR #588 (D845) took the word off every score the app draws. The one place
-- left (F911, filed by #588's review, R1809) is written by the database: the
-- stat-correction league post and each `stat_correction_result`
-- notification are built inside `score_write_week_batch`, whose per-player
-- line printed a blank (NULL, E61) team score as the word:
--   "… — Team One pending → 101.40"
-- It now prints the dash, the same as the read side's `scoreWords`
-- (`src/lib/leagues/api/corrections-service.ts`, D845 (6)):
--   "… — Team One — → 101.40"
-- The one line (`v_lines`) feeds BOTH the post and every notification body,
-- so the two COALESCE fallbacks are the whole change. No other text the
-- function writes into a post or a notification says "pending" (measured:
-- every other 'pending' in the body is a JSON key, a reason code or a
-- comment, never message text).
--
-- THE BODY (D137; CLAUDE.md's 073 lesson; R51): CREATE OR REPLACE against the
-- NEWEST defining migration's FILE TEXT, never the deployed body. Definers
-- MEASURED over 001–220 (grep 'FUNCTION[^(]*score_write_week_batch'):
-- 119 → 158 → 172 → 177. 178–220 do not define it (216 names it only in
-- comments, "NOT TOUCHED, ON PURPOSE"). Source = 177:222-879 verbatim, with
-- ONE hunk (+2 / -2), 177:673-674:
--     COALESCE(to_char(v_score_b, 'FM999999990.00'), 'pending')   →  '—'
--     COALESCE(to_char(v_score_a, 'FM999999990.00'), 'pending')   →  '—'
-- Both lines sit inside 172's `-- @172{ … -- @172}` fence, and the dash holds
-- no '@', so 109 / 115 / 106 / 120's fence-strip readings are unchanged.
-- pgTAP 173's pg_temp.un221 reverses the hunk on the live body to 177's text
-- byte for byte (125 A3's stored literal); 120 A6 and 125 A3 / A4 read
-- through it innermost (additive re-cut, the stored literals unchanged).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Replaced: 1 body. Signature, volatility, SECURITY DEFINER, search_path ''
--   and the ACL unchanged — the REVOKE is restated verbatim; the service
--   role's EXECUTE survives CREATE OR REPLACE (pgTAP 125 A1 / 173 A1).
--   No table, column, index, policy, trigger, helper, grant or cron row.
--   Time: none (no clock read). Typegen: no change (no signature moved).
--   Realtime: none. The door's REPORT shape is unchanged (its `post` string
--   carries the dash where it carried the word).
--   WAIVERS: R6 — no staging clone; rehearsal = a fresh local `db reset`
--   001–221 and the full pgTAP run in the PR. D38 — no backfill: posts and
--   notifications already written keep their words (a chat history is not
--   rewritten; the case is rare — 216's close pass writes a real 0).
--   DEGRADE-BEFORE-PUSH: no app code changes with 221; main on 218 keeps
--   177's wording until the push.
-- Rollback = re-apply 177:222-879 verbatim.
--
-- Proof: pgTAP 173 (form; D137 in the database; a correction onto a team
-- with a NULL score posts and notifies "—" and never "pending"; an ordinary
-- number → number correction posts and notifies exactly as before, stored
-- literals). Break probe shown red then reverted in the PR.
-- ============================================================================

-- Bounded wait (216 / 217's precedent, R1797): CREATE OR REPLACE takes a lock
-- on the function's catalog row; queued behind another session it fails fast
-- rather than stalling the push. SET LOCAL: this transaction only.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- score_write_week_batch — 177:222-879's FILE TEXT (D137) + the one hunk above.
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
  -- 177 (B12 / F557; R1446): the BUT-FOR week — the actual week without the correction
  v_moves      JSONB := '{}'::jsonb;    -- team -> its recorded players' points movement
  v_butfor     JSONB;                   -- v_after with ONLY those movements taken back out
  v_pend       JSONB := '[]'::jsonb;    -- this call's records, held until v_butfor is known
  v_pr         JSONB;
  v_tf         JSONB;                   -- a team in the but-for week
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
        -- 177 (B12 / F557): the record is HELD — its result is the one THIS
        -- call's corrections made, which needs every record of the call; the
        -- team's movement is the corrected players' own points, never the
        -- rest of its score.
        v_moves := jsonb_set(v_moves, ARRAY[v_tid::text],
          to_jsonb(COALESCE((v_moves ->> v_tid::text)::numeric, 0)
                   + COALESCE((v_pp_after ->> 'points')::numeric, 0) - COALESCE(v_pp_before, 0)));
        v_pend := v_pend || jsonb_build_object(
          'team_id', v_tid, 'player_id', v_pl.player_id, 'slot', v_pp_after ->> 'slot',
          'matchup_id', v_ta ->> 'matchup_id', 'event_ids', to_jsonb(v_pl.ids), 'changes', v_pl.changes,
          'pp_before', v_pp_before, 'pp_after', (v_pp_after ->> 'points')::numeric,
          'score_b', v_score_b, 'score_a', v_score_a);
        SELECT p.full_name INTO v_oname FROM public.players p WHERE p.id = v_pl.player_id;
        v_lines := v_lines || (COALESCE(v_oname, v_pl.player_id) || '''s ' || v_pl.words || ' — ' || v_tname || ' '
          || COALESCE(to_char(v_score_b, 'FM999999990.00'), '—') || ' → '
          || COALESCE(to_char(v_score_a, 'FM999999990.00'), '—'));
      END LOOP;
    END LOOP;

    -- 177 (B12 / F557; R1446 — ONE but-for test, ruled 2026-10-02): a result
    -- changed BY THE CORRECTION is one that changed (after <> before) AND
    -- that the correction caused: the actual after week differs from the
    -- BUT-FOR week (the after week with only this call's corrections taken
    -- back out, every other team at its actual after score) — per h2h,
    -- second game and median (§11.7) and per pairing. A flip another team's
    -- move made alone, or one it undid, is never the correction's; a flip
    -- that needs both the correction and another team's move IS. Every
    -- result and score recorded, posted or notified is the ACTUAL after
    -- week's. `result_changed` therefore means "changed by the correction":
    -- a record may honestly carry result_before <> result_after with
    -- result_changed false when another team's move alone changed it
    -- (pgTAP 125 O pins that meaning; the column comment below says it).
    v_butfor := public.stat_correction_week_state_but_for_internal(p_league_id, v_league.season, p_week, v_after, v_moves);
    FOR v_pr IN SELECT value FROM jsonb_array_elements(v_pend) WITH ORDINALITY ORDER BY ordinality LOOP
      v_tid := (v_pr ->> 'team_id')::uuid;
      v_tb := v_before -> 'teams' -> (v_tid::text);
      v_ta := v_after  -> 'teams' -> (v_tid::text);
      v_tf := v_butfor -> 'teams' -> (v_tid::text);
      INSERT INTO public.league_stat_corrections
        (league_id, season, week, team_id, player_id, slot, matchup_id, event_ids, stat_changes,
         player_points_before, player_points_after, team_score_before, team_score_after,
         result_before, result_after, result_changed)
      VALUES (p_league_id, v_league.season, p_week, v_tid, v_pr ->> 'player_id', v_pr ->> 'slot',
              (v_pr ->> 'matchup_id')::uuid,
              ARRAY(SELECT (x.value #>> '{}')::uuid FROM jsonb_array_elements(v_pr -> 'event_ids') WITH ORDINALITY x ORDER BY x.ordinality),
              v_pr -> 'changes',
              (v_pr ->> 'pp_before')::numeric, (v_pr ->> 'pp_after')::numeric, (v_pr ->> 'score_b')::numeric, (v_pr ->> 'score_a')::numeric,
              CASE WHEN v_results_final THEN jsonb_build_object('h2h', v_tb ->> 'h2h', 'second', v_tb ->> 'second', 'median', v_tb ->> 'median') END,
              CASE WHEN v_results_final THEN jsonb_build_object('h2h', v_ta ->> 'h2h', 'second', v_ta ->> 'second', 'median', v_ta ->> 'median') END,
              v_results_final AND (
                   ((v_ta ->> 'h2h') IS DISTINCT FROM (v_tb ->> 'h2h') AND (v_ta ->> 'h2h') IS DISTINCT FROM (v_tf ->> 'h2h'))
                OR ((v_ta ->> 'second') IS DISTINCT FROM (v_tb ->> 'second') AND (v_ta ->> 'second') IS DISTINCT FROM (v_tf ->> 'second'))
                OR ((v_ta ->> 'median') IS DISTINCT FROM (v_tb ->> 'median') AND (v_ta ->> 'median') IS DISTINCT FROM (v_tf ->> 'median'))))
      RETURNING id INTO v_cid;
      v_rec := v_rec || jsonb_build_object(
        'id', v_cid, 'team_id', v_tid, 'player_id', v_pr ->> 'player_id', 'event_ids', v_pr -> 'event_ids',
        'player_points_before', v_pr -> 'pp_before', 'player_points_after', v_pr -> 'pp_after',
        'team_score_before', v_pr -> 'score_b', 'team_score_after', v_pr -> 'score_a');
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
          JOIN jsonb_each(v_butfor -> 'matchups') c ON c.key = a.key
          WHERE (a.value ->> 'result') IS DISTINCT FROM (b.value ->> 'result')
            AND (a.value ->> 'result') IS DISTINCT FROM (c.value ->> 'result')
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
        JOIN jsonb_each(v_butfor -> 'teams') c ON c.key = a.key
        JOIN public.teams t ON t.id = a.key::uuid
        WHERE (a.value ->> 'median') IS DISTINCT FROM (b.value ->> 'median')
          AND (a.value ->> 'median') IS DISTINCT FROM (c.value ->> 'median');
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
          SELECT a.key::uuid AS team_id, a.value AS aft, b.value AS bef, c.value AS bf
          FROM jsonb_each(v_after -> 'teams') a
          JOIN jsonb_each(v_before -> 'teams') b ON b.key = a.key
          JOIN jsonb_each(v_butfor -> 'teams') c ON c.key = a.key
          WHERE ((a.value ->> 'h2h') IS DISTINCT FROM (b.value ->> 'h2h') AND (a.value ->> 'h2h') IS DISTINCT FROM (c.value ->> 'h2h'))
             OR ((a.value ->> 'second') IS DISTINCT FROM (b.value ->> 'second') AND (a.value ->> 'second') IS DISTINCT FROM (c.value ->> 'second'))
             OR ((a.value ->> 'median') IS DISTINCT FROM (b.value ->> 'median') AND (a.value ->> 'median') IS DISTINCT FROM (c.value ->> 'median'))
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
          IF (v_pl.aft ->> 'h2h') IS DISTINCT FROM (v_pl.bef ->> 'h2h') AND (v_pl.aft ->> 'h2h') IS DISTINCT FROM (v_pl.bf ->> 'h2h') THEN
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
          IF (v_pl.aft ->> 'second') IS DISTINCT FROM (v_pl.bef ->> 'second') AND (v_pl.aft ->> 'second') IS DISTINCT FROM (v_pl.bf ->> 'second') THEN
            SELECT t.name INTO v_oname FROM public.teams t WHERE t.id = (v_pl.aft ->> 'second_opponent')::uuid;
            v_body := v_body || ' In your second game ' || CASE v_pl.aft ->> 'second'
                WHEN 'win'  THEN 'you now beat ' || COALESCE(v_oname, 'your opponent')
                WHEN 'loss' THEN COALESCE(v_oname, 'your opponent') || ' now beats you'
                WHEN 'tie'  THEN 'you and ' || COALESCE(v_oname, 'your opponent') || ' now tie'
                ELSE 'there is no result yet' END
              || ' (you were ' || CASE v_pl.bef ->> 'second' WHEN 'win' THEN 'winning' WHEN 'loss' THEN 'losing' WHEN 'tie' THEN 'tied' ELSE 'without a result' END || ').';
          END IF;
          IF (v_pl.aft ->> 'median') IS DISTINCT FROM (v_pl.bef ->> 'median') AND (v_pl.aft ->> 'median') IS DISTINCT FROM (v_pl.bf ->> 'median') THEN
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
