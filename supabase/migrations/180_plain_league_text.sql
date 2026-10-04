-- ============================================================================
-- 180 — league posts and notices in plain English (F569 part 2, F573;
--       PROGRESS D490; Chris "go" 2026-10-04)
-- ============================================================================
--
-- THE GAP. D482 cleans refusals at render time, but five SQL bodies STORE or
-- SEND text that members read later — league posts, trade notifications,
-- trades.status_reason, and the in-season settings panel's refused_why —
-- and that text carried spec marks, ledger codes and setting names
-- ("(§23.3/E43)", "(trade_lock_behavior = reject, E35)", "team_count is
-- PRE-DRAFT ONLY (§7.3, erratum v2.16.40 — Q65 …)").
--
-- THE CHANGE — WORDING ONLY. Each function is CREATE OR REPLACE against the
-- NEWEST file that defines it (D137), with the hunks below and not one other
-- byte (derive_180.py asserts each old string occurs exactly once and each
-- new string once):
--   commish_setting_policy   149:1924-1987  13 hunks — every refused_why
--   finalize_matchups        118:1945-2218   2 hunks — the postponed-game post
--   trade_vote_veto_internal 155:190-257     2 hunks — the veto reason
--   trade_tick               155:551-724     4 hunks — expiry / sweep reasons
--   trade_execute_internal   156:205-668     5 hunks — invalid / deferred text
-- The two "the league is %" sentences now say "over for the season" /
-- "not in its season" instead of printing the raw status value: a CASE arm
-- inside the message expression, no branch of the function changes.
-- Logs (RAISE NOTICE / WARNING) and the post prefixes clients match
-- ("Trade vetoed by league vote: ", "Trade completed: ") are untouched.
-- Text that comes FROM another function (trade_check_internal's refusals,
-- which trade_execute_internal quotes as "the trade could not go through:
-- …") is F569 part 3.
--
-- CHECKLIST (tasks-M* §4.4): no table / column / policy / grant change;
-- each body keeps its own SECURITY / search_path '' / volatility lines
-- (finalize_matchups SECURITY DEFINER; the rest as their newest file);
-- REVOKEs restated (CREATE OR REPLACE keeps the ACL anyway). No backfill —
-- rows already written keep their old wording. Deploy-before-push safe: no
-- client parses any of these strings (the trade card prints status_reason,
-- the settings panel prints refused_why). No R6 / D38 waiver needed.
-- pgTAP: 128_plain_league_text.sql pins the new text and md5s; earlier
-- pins read the live bodies through pg_temp.un180.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- commish_setting_policy — CREATE OR REPLACE against 149:1924-1987's FILE TEXT
--   (D137), 13 wording hunk(s) and nothing else (derive_180.py).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_setting_policy(p_key TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    -- FREE, typed columns
    WHEN p_key IN ('waiver_type')          THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('faab_budget')          THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('trade_review')         THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('trade_deadline_week')  THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('roster_settings')      THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    -- FREE, blob
    WHEN p_key IN ('faab_min_bid', 'faab_tiebreaker',
         'waiver_run_days', 'waiver_run_time', 'waiver_time_zone',            -- 149 (Q70)
         'free_agency_opens', 'free_agency_open_day', 'free_agency_open_time', -- 149 (Q70)
         'acquisitions_per_week', 'acquisitions_per_season',
         'fa_hold_hours',
         'trade_veto_votes', 'trade_review_period_hours', 'allow_faab_in_trades',
         'allow_future_considerations', 'trade_lock_behavior',
         'allow_illegal_lineups', 'auto_sub_inactives', 'stat_correction_window',
         'tiebreakers', 'playoff_reseed')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'free', 'refused_why', NULL)
    -- RESCORE
    WHEN p_key IN ('scoring_system_id')    THEN jsonb_build_object('storage', 'column', 'class', 'rescore', 'refused_why', NULL)
    -- BRACKET (refused once the bracket exists — the verb decides by status)
    WHEN p_key IN ('playoff_teams')        THEN jsonb_build_object('storage', 'column', 'class', 'bracket', 'refused_why',
                                  'The playoff bracket has already been set from this, so it can''t change once the playoffs start.')
    WHEN p_key IN ('playoff_weeks_per_round', 'consolation_bracket', 'third_place_game')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'bracket', 'refused_why',
                                  'The playoff bracket has already been set from this, so it can''t change once the playoffs start.')
    -- REFUSED, always through this verb
    WHEN p_key IN ('regular_season_weeks', 'playoff_start_week')
                                THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'The season''s weeks and matchups are already set, so the length of the regular season and when the playoffs start can only change before the draft.')
    WHEN p_key IN ('team_count')           THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'The number of teams can only change before the draft — every team already has its place and its schedule.')
    WHEN p_key IN ('schedule_mode', 'median_game', 'second_opponent')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'The schedule has already been made from this, so it can only change before the draft.')
    WHEN p_key IN ('format')               THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'Leagues are redraft only for now — there''s nothing else to switch to.')
    WHEN p_key IN ('lineup_lock')          THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'Each player''s lineup spot always locks when his own game kicks off — this can''t be changed.')
    WHEN p_key IN ('divisions')            THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'Divisions aren''t available yet — the whole league plays as one group.')
    WHEN p_key IN ('playoff_byes')         THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'Playoff byes come from the number of playoff teams — change that instead.')
    WHEN p_key IN ('schedule_seed')        THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'This is set automatically when the schedule is made or reshuffled.')
    -- 149: RETIRED keys, refused BY NAME with their replacement (the table's
    -- CHECK refuses them too — leagues_settings_no_retired_waiver_keys).
    WHEN p_key IN ('waiver_process_day', 'waiver_process_time', 'waiver_period_hours', 'free_agency')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'This setting has been replaced: pick the days and time waivers run, and when free agency opens, instead. A dropped player stays on waivers until the next waiver run.')
    WHEN p_key IN ('bench_lock')           THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'This setting has been retired: a waiver claim always fails if the player you''d drop has already played this week, just like a regular drop.')
    WHEN p_key IN ('draft')                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'The draft is over, so its settings can''t change now.')
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_policy(TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- finalize_matchups — CREATE OR REPLACE against 118:1945-2218's FILE TEXT
--   (D137), 2 wording hunk(s) and nothing else (derive_180.py).
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


-- ---------------------------------------------------------------------------
-- trade_vote_veto_internal — CREATE OR REPLACE against 155:190-257's FILE TEXT
--   (D137), 2 wording hunk(s) and nothing else (derive_180.py).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_vote_veto_internal(p_trade_id UUID, p_league public.leagues, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trade    public.trades;
  v_tally    JSONB;
  v_reason   TEXT;
  v_summary  TEXT;
  v_post     TEXT;
  v_team     UUID;
  v_n        UUID;
  v_notified JSONB := '[]'::jsonb;
BEGIN
  IF p_trade_id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'trade_vote_veto: the trade and the instant (p_at — the TimeProvider seam) are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id AND t.league_id = p_league.id FOR UPDATE;
  IF NOT FOUND OR v_trade.status <> 'in_review' OR COALESCE(p_league.trade_review, 'commissioner') <> 'league_vote' THEN
    RETURN NULL;
  END IF;
  v_tally := public.trade_vote_tally_internal(v_trade, p_league);
  IF NOT (v_tally ->> 'reached')::boolean THEN
    RETURN NULL;
  END IF;

  v_reason := 'vetoed by league vote — ' || (v_tally ->> 'veto_votes') || ' of the '
    || (v_tally ->> 'eligible_voters') || ' managers who can vote voted to veto, and the league needs '
    || (v_tally ->> 'veto_number')
    || CASE WHEN (v_tally ->> 'capped')::boolean
            THEN ' (its setting of ' || (v_tally ->> 'setting') || ' is more than the managers who can vote)'
            ELSE '' END;
  UPDATE public.trades t
  SET status = 'vetoed', status_reason = v_reason, resolved_at = p_at, resolved_by = NULL
  WHERE t.id = p_trade_id AND t.status = 'in_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_vote_veto: trade % left review under the league lock — refusing to veto it twice', p_trade_id
      USING ERRCODE = 'P0001';
  END IF;

  v_summary := COALESCE(public.trade_summary_internal(p_trade_id), 'a trade');
  v_post := 'Trade vetoed by league vote: ' || v_summary;
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league.id, NULL, v_post, 'league', TRUE);
  FOREACH v_team IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
    v_n := public.trade_notify_team_internal(
      p_league.id, v_team, 'league_trade_vetoed', 'Your trade was vetoed by league vote',
      v_summary || ' — ' || v_reason,
      jsonb_build_object('trade_id', p_trade_id, 'status', 'vetoed'), FALSE);
    IF v_n IS NOT NULL THEN
      v_notified := v_notified || jsonb_build_array(v_n);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'trade_id',          p_trade_id,
    'status',            'vetoed',
    'status_reason',     v_reason,
    'tally',             v_tally,
    'system_post',       v_post,
    'notified_user_ids', v_notified,
    'evaluated_at',      p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_vote_veto_internal(UUID, public.leagues, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- trade_tick — CREATE OR REPLACE against 155:551-724's FILE TEXT
--   (D137), 4 wording hunk(s) and nothing else (derive_180.py).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_tick(p_now TIMESTAMPTZ DEFAULT now(), p_league_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_candidates INTEGER;
  v_lg         RECORD;
  v_league     public.leagues;
  v_deadline   JSONB;
  v_t          RECORD;
  v_reason     TEXT;
  v_res        JSONB;
  v_leagues    INTEGER := 0;
  v_expired    INTEGER := 0;
  v_swept      INTEGER := 0;
  v_executed   INTEGER := 0;
  v_deferred   INTEGER := 0;
  v_failed     INTEGER := 0;
  v_vetoed     INTEGER := 0;   -- 155 (L.D3.4): league-vote vetoes found by step (2b)
  v_actions    JSONB := '[]'::jsonb;
  v_failures   JSONB := '[]'::jsonb;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'trade_tick: p_now is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT t.league_id)::int INTO v_candidates
  FROM public.trades t
  WHERE t.status IN ('proposed', 'accepted', 'in_review')
    AND (p_league_id IS NULL OR t.league_id = p_league_id);

  FOR v_lg IN
    SELECT l.id FROM public.leagues l
    WHERE (p_league_id IS NULL OR l.id = p_league_id)
      AND EXISTS (SELECT 1 FROM public.trades t
                  WHERE t.league_id = l.id AND t.status IN ('proposed', 'accepted', 'in_review'))
    ORDER BY l.id
    FOR UPDATE OF l SKIP LOCKED
  LOOP
    v_leagues := v_leagues + 1;
    BEGIN
      SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;

      -- (1) Q76: every offer still pending at the deadline expires.
      v_deadline := public.trade_deadline_internal(v_league);
      IF (v_deadline ->> 'deadline_at')::timestamptz <= p_now THEN
        FOR v_t IN
          SELECT t.id FROM public.trades t
          WHERE t.league_id = v_league.id AND t.status = 'proposed'
          ORDER BY t.created_at, t.id
        LOOP
          v_res := public.trade_close_internal(
            v_t.id, 'expired',
            'the trade deadline passed — offers could be accepted until week ' || ((v_deadline ->> 'deadline_week')::int + 1)
              || ' began (' || (v_deadline ->> 'label') || ')',
            p_now, 'league_trade_expired', 'A trade offer expired at the deadline');
          v_expired := v_expired + 1;
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'expired'));
        END LOOP;
      END IF;

      -- (2) THE BACKSTOP SWEEP (TD12): what the triggers cannot see.
      FOR v_t IN
        SELECT t.* FROM public.trades t
        WHERE t.league_id = v_league.id AND t.status IN ('proposed', 'accepted', 'in_review')
        ORDER BY t.created_at, t.id
      LOOP
        v_reason := NULL;
        IF v_league.deleted_at IS NOT NULL OR v_league.status NOT IN ('in_season', 'playoffs') THEN
          v_reason := 'the league is ' || CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' WHEN v_league.status = 'complete' THEN 'over for the season' ELSE 'not in its season' END
                      || ' — trades only go through during the season and the playoffs';
        ELSE
          SELECT tm.name || ' is retired and can''t make trades' INTO v_reason
          FROM public.teams tm
          WHERE tm.id IN (v_t.proposer_team_id, v_t.recipient_team_id) AND tm.status = 'retired'
          ORDER BY tm.name LIMIT 1;
          IF v_reason IS NULL THEN
            SELECT tm.name || ' can no longer give $' || i.faab_amount || ' of FAAB — its balance is '
                   || COALESCE('$' || m.faab_balance, 'not set')
            INTO v_reason
            FROM public.trade_items i
            JOIN public.teams tm ON tm.id = i.from_team_id
            LEFT JOIN public.league_members m ON m.league_id = v_league.id AND m.team_id = i.from_team_id
            WHERE i.trade_id = v_t.id AND i.faab_amount IS NOT NULL
              AND (m.faab_balance IS NULL OR m.faab_balance < i.faab_amount)
            ORDER BY tm.name LIMIT 1;
          END IF;
        END IF;
        IF v_reason IS NOT NULL THEN
          v_res := public.trade_close_internal(v_t.id, 'invalid', 'the trade can no longer go through: ' || v_reason, p_now,
                                               'league_trade_invalid', 'A trade can no longer go through');
          v_swept := v_swept + 1;
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'invalid', 'reason', v_reason));
        END IF;
      END LOOP;

      -- (2b) 155 (L.D3.4, F430 / F435): a LEAGUE-VOTE trade in review whose
      --      counted veto votes already reach the league's number is
      --      vetoed here, before (3) could run it. A vote that reaches the
      --      number vetoes at the vote (trade_vote); this catches the number
      --      falling with no vote cast — it is capped at the managers who
      --      can vote, and that falls when a seat empties. Only BEFORE the
      --      review period ends (R1227): at or after `review_deadline` the
      --      vote is over and the trade goes through in (3) — a seat that
      --      empties after the deadline (or a league the tick skipped as
      --      busy) never vetoes a trade Q77 has already let through.
      IF COALESCE(v_league.trade_review, 'commissioner') = 'league_vote' THEN
        FOR v_t IN
          SELECT t.id FROM public.trades t
          WHERE t.league_id = v_league.id AND t.status = 'in_review'
            AND t.review_deadline > p_now
          ORDER BY t.created_at, t.id
        LOOP
          v_res := public.trade_vote_veto_internal(v_t.id, v_league, p_now);
          IF v_res IS NOT NULL THEN
            v_vetoed := v_vetoed + 1;
            v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'vetoed', 'reason', v_res ->> 'status_reason'));
          END IF;
        END LOOP;
      END IF;

      -- (3) + (4) DUE EXECUTIONS: review period over; a deferred trade
      --     whose release has come (or is not yet recorded — re-read each
      --     minute; the executor re-parks it if still locked).
      FOR v_t IN
        SELECT t.id,
               CASE WHEN t.status = 'in_review' THEN 'review_elapsed' ELSE 'deferred_release' END AS via
        FROM public.trades t
        WHERE t.league_id = v_league.id
          AND ((t.status = 'in_review' AND t.review_deadline <= p_now)
            OR (t.status = 'accepted' AND (t.execute_after IS NULL OR t.execute_after <= p_now OR t.execute_after = 'infinity')))
        ORDER BY COALESCE(t.accepted_at, t.created_at), t.id
      LOOP
        v_res := public.trade_execute_internal(v_t.id, p_now, v_t.via);
        CASE v_res ->> 'outcome'
          WHEN 'complete' THEN v_executed := v_executed + 1;
          WHEN 'deferred' THEN v_deferred := v_deferred + 1;
          WHEN 'invalid'  THEN v_failed := v_failed + 1;
          ELSE NULL;
        END CASE;
        v_actions := v_actions || jsonb_build_array(jsonb_build_object(
          'league_id', v_league.id, 'trade_id', v_t.id, 'action', v_res ->> 'outcome', 'via', v_t.via,
          'execute_after', v_res -> 'execute_after', 'reason', v_res -> 'status_reason'));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
      RAISE WARNING 'trade_tick failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'at',          p_now,
    'scope',       p_league_id,
    'candidates',  v_candidates,
    'leagues',     v_leagues,
    'skipped_locked', GREATEST(v_candidates - v_leagues, 0),
    'expired',     v_expired,
    'invalidated', v_swept,
    'executed',    v_executed,
    'deferred',    v_deferred,
    'failed_at_execution', v_failed,
    'vetoed',      v_vetoed,
    'actions',     v_actions,
    'failures',    v_failures,
    'reason', CASE
      WHEN v_candidates = 0 THEN 'no_trades_in_flight'
      WHEN v_leagues = 0 THEN 'every_league_busy'
      WHEN jsonb_array_length(v_actions) = 0 AND jsonb_array_length(v_failures) = 0 THEN 'nothing_due'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_tick(TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- trade_execute_internal — CREATE OR REPLACE against 156:205-668's FILE TEXT
--   (D137), 5 wording hunk(s) and nothing else (derive_180.py).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_execute_internal(p_trade_id UUID, p_at TIMESTAMPTZ, p_via TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league_id   UUID;
  v_league      public.leagues;
  v_trade       public.trades;
  v_proposer    public.teams;
  v_recipient   public.teams;
  v_items       JSONB;
  v_pdrops      TEXT[];
  v_rdrops      TEXT[];
  v_check       JSONB;
  v_invalid     TEXT := NULL;
  v_close       JSONB;
  v_lock        JSONB;
  v_behavior    TEXT;
  v_names       TEXT;
  v_first_wait  BOOLEAN;
  v_release     TIMESTAMPTZ;
  v_current     INTEGER;
  v_from_week   INTEGER;
  v_week_end    TIMESTAMPTZ;
  v_sched       JSONB;
  v_waiver_type TEXT;
  v_hold_hours  INTEGER;
  v_roster_size INTEGER;
  v_leg         RECORD;
  v_drop        RECORD;
  v_drop_row    public.league_rosters;
  v_to_state    TEXT;
  v_until       TIMESTAMPTZ;
  v_early       BOOLEAN;
  v_cnt         INTEGER;
  v_after       INTEGER;
  v_recv_after  INTEGER;
  v_moves       JSONB := '[]'::jsonb;
  v_drops_out   JSONB := '[]'::jsonb;
  v_faab        JSONB := '[]'::jsonb;
  v_lineups     JSONB := '[]'::jsonb;
  v_side        UUID;
  v_out         TEXT[];
  v_in          TEXT[];
  v_pid         TEXT;
  v_row         public.team_lineups;
  v_map         JSONB;
  v_starters    JSONB;
  v_bench       JSONB;
  v_key         TEXT;
  v_changed     BOOLEAN;
  v_txn_id      UUID := gen_random_uuid();
  v_summary     TEXT;
  v_payload     JSONB;
  v_post        TEXT;
  v_n           UUID;
  v_notified    JSONB := '[]'::jsonb;
BEGIN
  IF p_trade_id IS NULL OR p_at IS NULL OR NULLIF(btrim(COALESCE(p_via, '')), '') IS NULL THEN
    RAISE EXCEPTION 'trade_execute: the trade, the instant (p_at — the TimeProvider seam) and what triggered the execution are required'
      USING ERRCODE = '22023';
  END IF;

  -- (1) THE LEAGUE ROW FIRST (the one serialization point — 115:410, 148),
  --     then the trade RE-READ under it (F413 (b)).
  SELECT t.league_id INTO v_league_id FROM public.trades t WHERE t.id = p_trade_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_execute: no trade %', p_trade_id USING ERRCODE = 'P0001';
  END IF;
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_league_id FOR UPDATE;
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id FOR UPDATE;
  IF v_trade.status NOT IN ('accepted', 'in_review') THEN
    -- Not an error: another path settled it first (E37's trigger, a veto,
    -- an earlier tick). Reported, never moved.
    RETURN jsonb_build_object(
      'trade_id', p_trade_id, 'outcome', 'not_in_flight', 'status', v_trade.status,
      'status_reason', v_trade.status_reason, 'via', p_via, 'evaluated_at', p_at);
  END IF;
  SELECT t.* INTO v_proposer FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
  SELECT t.* INTO v_recipient FROM public.teams t WHERE t.id = v_trade.recipient_team_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', i.player_id, 'faab_amount', i.faab_amount,
           'from_team_id', i.from_team_id, 'to_team_id', i.to_team_id) ORDER BY i.id), '[]'::jsonb)
  INTO v_items
  FROM public.trade_items i WHERE i.trade_id = p_trade_id;
  SELECT COALESCE(array_agg(d.player_id ORDER BY d.player_id) FILTER (WHERE d.team_id = v_trade.proposer_team_id), ARRAY[]::text[]),
         COALESCE(array_agg(d.player_id ORDER BY d.player_id) FILTER (WHERE d.team_id = v_trade.recipient_team_id), ARRAY[]::text[])
  INTO v_pdrops, v_rdrops
  FROM public.trade_drops d WHERE d.trade_id = p_trade_id;

  -- (2) RE-VALIDATE EVERYTHING (F413 (c) / (e)). A business refusal is
  --     caught and becomes the trade's reason; no write happens inside.
  BEGIN
    IF v_league.deleted_at IS NOT NULL OR v_league.status NOT IN ('in_season', 'playoffs') THEN
      RAISE EXCEPTION 'trade_execute: the league is % — trades only go through during the season and the playoffs',
        CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' WHEN v_league.status = 'complete' THEN 'over for the season' ELSE 'not in its season' END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_proposer.status = 'retired' OR v_recipient.status = 'retired' THEN
      RAISE EXCEPTION 'trade_execute: % is retired and can''t make trades',
        CASE WHEN v_proposer.status = 'retired' THEN v_proposer.name ELSE v_recipient.name END
        USING ERRCODE = 'P0001';
    END IF;
    -- BOTH teams' drops ENFORCED (the receiving team's named at acceptance).
    v_check := public.trade_check_internal('trade_execute', v_league, v_proposer, v_recipient, v_items, v_pdrops, v_rdrops);
    -- A FAAB leg needs a balance to land in, too (check_internal reads the giver's).
    FOR v_leg IN
      SELECT i.to_team_id, i.faab_amount FROM public.trade_items i
      WHERE i.trade_id = p_trade_id AND i.faab_amount IS NOT NULL ORDER BY i.to_team_id
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.league_members m
                     WHERE m.league_id = v_league.id AND m.team_id = v_leg.to_team_id AND m.faab_balance IS NOT NULL) THEN
        RAISE EXCEPTION 'trade_execute: % has no FAAB budget to receive $% into',
          CASE WHEN v_leg.to_team_id = v_proposer.id THEN v_proposer.name ELSE v_recipient.name END, v_leg.faab_amount
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_invalid := regexp_replace(SQLERRM, '^trade_execute: ', '');
  END;
  IF v_invalid IS NOT NULL THEN
    v_close := public.trade_close_internal(
      p_trade_id, 'invalid', 'the trade could not go through: ' || v_invalid, p_at,
      'league_trade_invalid', 'A trade could not go through');
    RETURN v_close || jsonb_build_object('outcome', 'invalid', 'via', p_via, 'evaluated_at', p_at);
  END IF;

  -- (3) THE GAME-DAY LOCK (TD11 / Q75 / E35) — the whole trade or nothing.
  v_lock := public.trade_lock_internal(p_trade_id, v_league, p_at);
  -- 156 / L.D3.5: the commissioner's FORCE stands outside the game-day lock
  -- (a timing rule — tasks-M5 L.D3.5, standing rule (i)); it executes now.
  -- Every validity check above still binds it.
  IF (v_lock ->> 'locked')::boolean AND p_via IS DISTINCT FROM 'commissioner_force' THEN
    v_behavior := COALESCE(v_league.settings ->> 'trade_lock_behavior', 'defer');
    IF v_behavior NOT IN ('defer', 'reject') THEN
      RAISE EXCEPTION 'trade_execute: trade_lock_behavior % is not defer / reject (§7.3.5)', v_behavior
        USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(e ->> 'name', ', ' ORDER BY e ->> 'name') INTO v_names
    FROM jsonb_array_elements(v_lock -> 'locked_players') e;
    IF v_behavior = 'reject' THEN
      v_close := public.trade_close_internal(
        p_trade_id, 'invalid',
        'the trade could not go through: ' || v_names || ' already played this week, and this league cancels a trade like that instead of waiting for the week''s last game to end',
        p_at, 'league_trade_invalid', 'A trade could not go through');
      RETURN v_close || jsonb_build_object('outcome', 'invalid', 'lock', v_lock, 'via', p_via, 'evaluated_at', p_at);
    END IF;
    -- defer: parked `accepted` (review, if any, is over — the caller decided
    -- execution is due) until the release; both told the FIRST time only.
    v_first_wait := v_trade.execute_after IS NULL OR v_trade.status = 'in_review';
    v_release := (v_lock ->> 'release_at')::timestamptz;
    UPDATE public.trades t
    SET status = 'accepted', execute_after = v_release
    WHERE t.id = p_trade_id AND t.status IN ('accepted', 'in_review');
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'trade_execute: parking trade % touched % rows, expected 1', p_trade_id, v_cnt USING ERRCODE = 'P0001';
    END IF;
    IF v_first_wait THEN
      v_summary := public.trade_summary_internal(p_trade_id);
      FOREACH v_side IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
        v_n := public.trade_notify_team_internal(
          v_league.id, v_side, 'league_trade_deferred',
          'A trade will go through after this week''s games',
          v_summary || ' — ' || v_names || ' already played this week, so the whole trade goes through right after the week''s last game ends. Until then every player stays with his team.',
          jsonb_build_object('trade_id', p_trade_id, 'execute_after', v_release), FALSE);
        IF v_n IS NOT NULL THEN
          v_notified := v_notified || jsonb_build_array(v_n);
        END IF;
      END LOOP;
    END IF;
    RETURN jsonb_build_object(
      'trade_id', p_trade_id, 'outcome', 'deferred', 'status', 'accepted', 'execute_after', v_release,
      'lock', v_lock, 'notified_user_ids', v_notified, 'via', p_via, 'evaluated_at', p_at);
  END IF;

  -- (4) EXECUTE. F413 (a): this trade is exempt from 148's E37 trigger for
  --     the rest of this transaction; every OTHER in-flight trade naming a
  --     player that moves (or a drop) still goes invalid through it.
  PERFORM set_config('app.executing_trade_id', p_trade_id::text, true);

  v_current := (v_lock ->> 'current_week')::int;
  -- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,
  -- or its Wednesday 00:00 Pacific ceiling when that comes first. The
  -- ceiling releases a played starter, so it must finish the week for
  -- lineups too: otherwise, in a league's LAST week (no week N+1 row to
  -- flip the current week), a move at the ceiling would clear his start.
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
  WHERE w.season = v_league.season AND w.week = v_current;
  -- The first week NOT FINISHED (banner: THE WEEK NOTE).
  v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;
  v_waiver_type := COALESCE(v_league.waiver_type, 'faab');
  v_sched := public.waiver_schedule_internal(v_league.settings, v_waiver_type);
  v_hold_hours := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);
  v_roster_size := (v_check #>> '{proposer,roster_size}')::int;

  -- (4a) THE DROPS (TD13) — each exactly as add/drop drops (149:601-616):
  --      free agency when fa_hold says so or under none_fcfs, else waivers
  --      until the next scheduled run.
  FOR v_drop IN
    SELECT d.team_id, d.player_id, p.full_name
    FROM public.trade_drops d JOIN public.players p ON p.id = d.player_id
    WHERE d.trade_id = p_trade_id
    ORDER BY (d.team_id <> v_trade.proposer_team_id), d.player_id
  LOOP
    DELETE FROM public.league_rosters r
    WHERE r.league_id = v_league.id AND r.team_id = v_drop.team_id AND r.player_id = v_drop.player_id
    RETURNING r.* INTO v_drop_row;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'trade_execute: the drop of % deleted % roster rows, expected 1', v_drop.player_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    v_early := v_drop_row.acquisition_type = 'free_agent'
               AND v_hold_hours > 0
               AND v_drop_row.acquired_at IS NOT NULL
               AND p_at < v_drop_row.acquired_at + make_interval(hours => v_hold_hours);
    IF v_early OR v_waiver_type = 'none_fcfs' THEN
      v_to_state := 'free_agent';
      v_until := NULL;
    ELSE
      v_to_state := 'on_waivers';
      v_until := public.waiver_next_run_internal(v_sched, p_at);
    END IF;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (v_league.id, v_drop.player_id, v_to_state, v_until, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
    v_drops_out := v_drops_out || jsonb_build_array(jsonb_build_object(
      'team_id',       v_drop.team_id,
      'player_id',     v_drop.player_id,
      'name',          v_drop.full_name,
      'from_slot_key', v_drop_row.slot_key,
      'to_state',      v_to_state,
      'waivers_until', v_until,
      'fa_hold_early', v_early));
  END LOOP;

  -- (4b) THE SWAP — the roster row changes team (it never leaves the
  --      league, so the (league, player) UNIQUE holds at every instant);
  --      the player lands on the bench (TD10), any IR stint ends with the
  --      old team's spot.
  FOR v_leg IN
    SELECT i.player_id, i.from_team_id, i.to_team_id, p.full_name
    FROM public.trade_items i JOIN public.players p ON p.id = i.player_id
    WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL
    ORDER BY i.player_id
  LOOP
    UPDATE public.league_rosters r
    SET team_id = v_leg.to_team_id, slot_key = 'bn', acquisition_type = 'trade', acquired_at = p_at,
        ir_placed_week = NULL, ir_lock_until_week = NULL
    WHERE r.league_id = v_league.id AND r.player_id = v_leg.player_id AND r.team_id = v_leg.from_team_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'trade_execute: moving % from % touched % roster rows, expected 1', v_leg.player_id, v_leg.from_team_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (v_league.id, v_leg.player_id, 'rostered', NULL, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
    v_moves := v_moves || jsonb_build_array(jsonb_build_object(
      'player_id', v_leg.player_id, 'name', v_leg.full_name,
      'from_team_id', v_leg.from_team_id, 'to_team_id', v_leg.to_team_id));
  END LOOP;

  -- (4c) THE FAAB LEGS — debit the giver (never below zero: the WHERE and
  --      the 145 CHECK), credit the receiver; each exactly one row.
  FOR v_leg IN
    SELECT i.faab_amount, i.from_team_id, i.to_team_id FROM public.trade_items i
    WHERE i.trade_id = p_trade_id AND i.faab_amount IS NOT NULL
    ORDER BY i.from_team_id
  LOOP
    UPDATE public.league_members m
    SET faab_balance = m.faab_balance - v_leg.faab_amount
    WHERE m.league_id = v_league.id AND m.team_id = v_leg.from_team_id AND m.faab_balance >= v_leg.faab_amount
    RETURNING m.faab_balance INTO v_after;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'trade_execute: debiting $% from % touched % seat rows, expected 1 (the balance was re-checked a moment ago)',
        v_leg.faab_amount, v_leg.from_team_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.league_members m
    SET faab_balance = m.faab_balance + v_leg.faab_amount
    WHERE m.league_id = v_league.id AND m.team_id = v_leg.to_team_id AND m.faab_balance IS NOT NULL
    RETURNING m.faab_balance INTO v_recv_after;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'trade_execute: crediting $% to % touched % seat rows, expected 1', v_leg.faab_amount, v_leg.to_team_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    v_faab := v_faab || jsonb_build_array(jsonb_build_object(
      'amount',       v_leg.faab_amount,
      'from_team_id', v_leg.from_team_id, 'from_before', v_after + v_leg.faab_amount, 'from_after', v_after,
      'to_team_id',   v_leg.to_team_id,   'to_before',   v_recv_after - v_leg.faab_amount, 'to_after', v_recv_after));
  END LOOP;

  -- (4d) THE LINEUP INTERPLAY (TD10; 149:771-826's loop, generalized): per
  --      team, from the first unfinished week on, every player leaving it
  --      (legs out + its drops) is cleared from the slot map / starters /
  --      bench, and every player arriving goes on the bench.
  FOREACH v_side IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
    SELECT COALESCE(array_agg(q.pid ORDER BY q.pid), ARRAY[]::text[]) INTO v_out
    FROM (SELECT i.player_id AS pid FROM public.trade_items i
          WHERE i.trade_id = p_trade_id AND i.from_team_id = v_side AND i.player_id IS NOT NULL
          UNION
          SELECT d.player_id FROM public.trade_drops d WHERE d.trade_id = p_trade_id AND d.team_id = v_side) q;
    SELECT COALESCE(array_agg(i.player_id ORDER BY i.player_id), ARRAY[]::text[]) INTO v_in
    FROM public.trade_items i
    WHERE i.trade_id = p_trade_id AND i.to_team_id = v_side AND i.player_id IS NOT NULL;
    FOR v_row IN
      SELECT tl.* FROM public.team_lineups tl
      WHERE tl.team_id = v_side AND tl.season = v_league.season AND tl.week >= v_from_week
      ORDER BY tl.week
      FOR UPDATE
    LOOP
      v_map := COALESCE(v_row.slot_map, '{}'::jsonb);
      v_starters := COALESCE(v_row.starters, '[]'::jsonb);
      v_bench := COALESCE(v_row.bench, '[]'::jsonb);
      v_changed := FALSE;
      FOREACH v_pid IN ARRAY v_out LOOP
        SELECT e.key INTO v_key FROM jsonb_each_text(v_map) e WHERE e.value = v_pid LIMIT 1;
        IF v_key IS NOT NULL THEN
          v_map := v_map - v_key;
          SELECT COALESCE(jsonb_agg(
                   CASE WHEN s ->> 'slot' = v_key
                        THEN s || jsonb_build_object('player_id', NULL, 'position', NULL, 'kickoff_at', NULL, 'flags', '["empty"]'::jsonb)
                        ELSE s END ORDER BY ord), '[]'::jsonb)
          INTO v_starters
          FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord);
          v_lineups := v_lineups || jsonb_build_array(jsonb_build_object('team_id', v_side, 'week', v_row.week, 'player_id', v_pid, 'slot', v_key, 'change', 'removed'));
          v_changed := TRUE;
        END IF;
        IF v_bench ? v_pid THEN
          SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
          FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') <> v_pid;
          IF v_key IS NULL THEN
            v_lineups := v_lineups || jsonb_build_array(jsonb_build_object('team_id', v_side, 'week', v_row.week, 'player_id', v_pid, 'slot', NULL, 'change', 'removed'));
          END IF;
          v_changed := TRUE;
        END IF;
      END LOOP;
      FOREACH v_pid IN ARRAY v_in LOOP
        IF NOT (v_bench ? v_pid) THEN
          SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
          FROM jsonb_array_elements(v_bench || to_jsonb(v_pid)) x;
          v_lineups := v_lineups || jsonb_build_array(jsonb_build_object('team_id', v_side, 'week', v_row.week, 'player_id', v_pid, 'slot', 'bn', 'change', 'added'));
          v_changed := TRUE;
        END IF;
      END LOOP;
      IF v_changed THEN
        UPDATE public.team_lineups SET slot_map = v_map, starters = v_starters, bench = v_bench
        WHERE id = v_row.id;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION 'trade_execute: lineup sync for team % week % touched % rows, expected 1', v_side, v_row.week, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- (4e) THE TRADE IS COMPLETE in this same transaction (F413 (d)).
  UPDATE public.trades t
  SET status = 'complete', resolved_at = p_at, resolved_by = auth.uid()
  WHERE t.id = p_trade_id AND t.status IN ('accepted', 'in_review');
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'trade_execute: completing trade % touched % rows, expected 1', p_trade_id, v_cnt USING ERRCODE = 'P0001';
  END IF;

  -- (5) POST-WRITE ASSERTIONS (§4 rule 6 — asserted, not trusted).
  FOR v_leg IN
    SELECT i.player_id, i.to_team_id FROM public.trade_items i
    WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL
  LOOP
    IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = v_league.id AND r.player_id = v_leg.player_id) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.league_rosters r
                      WHERE r.league_id = v_league.id AND r.player_id = v_leg.player_id AND r.team_id = v_leg.to_team_id) THEN
      RAISE EXCEPTION 'trade_execute: after the trade, % is not exactly once on the receiving roster in league % — refusing (exclusivity, rule 7)',
        v_leg.player_id, v_league.id
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = v_league.id AND pp.player_id = v_leg.player_id)
       IS DISTINCT FROM 'rostered' THEN
      RAISE EXCEPTION 'trade_execute: the pool mirror for % is not rostered after the trade (D294) — refusing', v_leg.player_id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR v_drop IN SELECT (e ->> 'player_id') AS player_id, (e ->> 'to_state') AS to_state FROM jsonb_array_elements(v_drops_out) e LOOP
    IF EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = v_league.id AND r.player_id = v_drop.player_id)
       OR (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = v_league.id AND pp.player_id = v_drop.player_id)
          IS DISTINCT FROM v_drop.to_state THEN
      RAISE EXCEPTION 'trade_execute: after the trade, dropped player % is still rostered or his pool mirror is not % — refusing',
        v_drop.player_id, v_drop.to_state
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_side IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
    SELECT count(*)::int INTO v_cnt FROM public.league_rosters r WHERE r.league_id = v_league.id AND r.team_id = v_side;
    IF v_cnt <> (v_check #>> CASE WHEN v_side = v_trade.proposer_team_id THEN '{proposer,count_after}' ELSE '{recipient,count_after}' END::text[])::int
       OR v_cnt > v_roster_size THEN
      RAISE EXCEPTION 'trade_execute: team % holds % players after the trade, expected % (roster_size %) — refusing',
        v_side, v_cnt,
        v_check #>> CASE WHEN v_side = v_trade.proposer_team_id THEN '{proposer,count_after}' ELSE '{recipient,count_after}' END::text[],
        v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  PERFORM set_config('app.executing_trade_id', '', true);

  -- (6) THE RECORD — ONE transactions row (TD9: no add_player_id key).
  v_summary := public.trade_summary_internal(p_trade_id);
  v_payload := jsonb_build_object(
    'transaction_id',    v_txn_id,
    'type',              'trade',
    'trade_id',          p_trade_id,
    'league_id',         v_league.id,
    'season',            v_league.season,
    'week',              v_current,
    'proposer_team_id',  v_trade.proposer_team_id,
    'recipient_team_id', v_trade.recipient_team_id,
    'summary',           v_summary,
    'players',           v_moves,
    'drops',             v_drops_out,
    'faab',              v_faab,
    'lineups',           v_lineups,
    'lineup_from_week',  v_from_week,
    'accepted_at',       v_trade.accepted_at,
    'review_deadline',   v_trade.review_deadline,
    'execute_after',     v_trade.execute_after,
    'via',               p_via,
    'evaluated_at',      p_at);
  INSERT INTO public.transactions (id, league_id, type, status, initiator_team_id, initiated_by, payload, week)
  VALUES (v_txn_id, v_league.id, 'trade', 'complete', v_trade.proposer_team_id, v_trade.proposed_by, v_payload, v_current);

  -- (7) THE SYSTEM POST (§10.3 — TD16) AND BOTH MANAGERS TOLD.
  v_post := 'Trade completed: ' || v_summary;
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_league.id, NULL, v_post, 'league', TRUE);
  FOREACH v_side IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
    v_n := public.trade_notify_team_internal(
      v_league.id, v_side, 'league_trade_executed', 'Your trade went through', v_summary,
      jsonb_build_object('trade_id', p_trade_id, 'transaction_id', v_txn_id), FALSE);
    IF v_n IS NOT NULL THEN
      v_notified := v_notified || jsonb_build_array(v_n);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'trade_id',          p_trade_id,
    'outcome',           'complete',
    'status',            'complete',
    'transaction_id',    v_txn_id,
    'payload',           v_payload,
    'system_post',       v_post,
    'notified_user_ids', v_notified,
    'via',               p_via,
    'evaluated_at',      p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_execute_internal(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;

