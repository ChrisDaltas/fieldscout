-- ============================================================================
-- 140_bracket_played_round_notice.sql — the played-round refusal's hourly
-- WARNING quieted to a NOTICE, its copy corrected (M6A task L.E1.23, added by
-- ruling 2026-09-27; PROGRESS F377 (this task's remainder), D370, D371(6),
-- D377; spec §11.5 R839; tasks-M6A §6's 2026-09-27 amendment, L.E1.23;
-- tasks-M6A §4 rules 11-15).
--
-- Numbering (D161 — measured at task time, not trusted from any plan):
-- `ls supabase/migrations | tail -1` → 139_autopilot_switch.sql ⇒ 140;
-- `ls supabase/tests | tail -1` → 087_autopilot_switch.sql ⇒ pgTAP 088.
-- NOT held: reaches production by `npx supabase db push` like any other
-- migration. Production is at 134 — push debt becomes 135–140.
--
-- ---------------------------------------------------------------------------
-- THE RULING (Chris, 2026-09-27 — PROGRESS F377)
-- ---------------------------------------------------------------------------
-- (a) "bracket stands as played" — a played round keeps its pairings even if
-- a later correction changes seeding; there is NO "confirm as played" act.
-- (b) "re-pairing by hand is fine" — no revert-to-engine act. Neither is
-- built. The remainder (c) — the bracket's "Edit a result" door becoming a
-- link to the game's matchup page — is UI only (`playoff-bracket-ops.ts` /
-- `playoff-bracket.tsx`, same PR).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES — ONE LINE OF ONE FUNCTION
-- ---------------------------------------------------------------------------
-- `playoff_bracket_sync_internal`'s R839 arm (`rebuild_refused_round_played`,
-- `134:1134`) raised a WARNING on EVERY hourly run for the rest of the round,
-- and its copy promised "until a commissioner acts (M6 §10)" — an act the
-- ruling rules out. The shape was chosen by the rulings session (D371(6)):
-- DOWNGRADE TO `RAISE NOTICE` with corrected copy, NOT emit-once — emit-once
-- needs new state (a marker row or column) to remember it has warned, for
-- log noise no user ever sees; a NOTICE sits below the server's default
-- `log_min_messages` (WARNING), so the hourly line leaves the logs. The copy
-- now reads "the bracket stands as played (F377(a), ruled 2026-09-27)".
--
-- THE RETURN DOCUMENT IS BYTE-UNCHANGED: `reason:
-- rebuild_refused_round_played` and every field (round, source, weeks,
-- rolled, scored_rows, stored, desired) are the lines AFTER the RAISE and are
-- not in the hunk — the machine-readable signal, `league_week_advance`'s
-- report and pgTAP 066 L6e / L6f and 082 A6 survive unmodified.
--
-- WHO READ THE WARNING TEXT (measured before building, as the task requires):
-- a grep of src/, scripts/, supabase/tests/, supabase/functions/ and the CI
-- workflows for "is HISTORY", "rewrite is REFUSED", "until a commissioner
-- acts" and "RAISE WARNING" finds ZERO readers of the message text: no log
-- alert, no drain filter, no test. The only test readers of the function
-- read the RETURN document (066 L6e / L6f) or `prosrc` substrings this line
-- does not carry (082 A6's `rebuild_refused_round_played` /
-- `round_hand_picked` / the DELETE). No test pins the function's md5.
--
-- ---------------------------------------------------------------------------
-- D137 PROVENANCE
-- ---------------------------------------------------------------------------
-- `playoff_bracket_sync_internal`: authored against
-- `supabase/migrations/134_commish_edit_bracket.sql` lines 822-1230 (the
-- NEWEST defining migration — `grep -ln "FUNCTION playoff_bracket_sync_
-- internal" supabase/migrations/*` → 118, 134; 129 / 130 only cite it; 135-
-- 139 never mention it). The text below is the EXTRACTION (`sed -n
-- 822,1230p`), not a re-typing, with ONE line replaced. Pre-140
-- `md5(prosrc)` on the local chain 001-139: `78ff08b46ff8004e8a7a1127f70726a6`
-- (19969 chars) — pinned as a stored literal in pgTAP 088 A6 against the
-- post-140 body with the one line reversed. Post-140 `md5(prosrc)`:
-- `6ea667003195c7b2d45eb5e4e40ca9c4` (19938 chars) — pgTAP 088 A7.
-- **HUNK COUNT: 1** — `diff -u` of 134:822-1230 against the function below
-- → ONE `@@`, ONE `-` line, ONE `+` line: `RAISE WARNING` → `RAISE NOTICE`
-- and the message's tail. The format arguments (the next line) are
-- untouched, so the message still names league, round, rolled, the scored-
-- row count, desired and stored.
-- DELIBERATELY NOT TOUCHED (the one-hunk rule): the R839 COMMENT block above
-- the arm (`134:1113-1124`, carried verbatim) still says "stands as played
-- until a commissioner acts (M6 §10 …) or the round finalizes". It is a
-- comment describing the 118-era intent; the ruling supersedes it and this
-- banner says so. Editing it would be a second hunk ten lines away.
-- The REVOKE (`134:1229-1230`) survives CREATE OR REPLACE and is re-stated.
-- The signature is unchanged ⇒ typegen 0-line.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): one `CREATE OR REPLACE` of an
-- existing PLAIN (not DEFINER) internal, `search_path = ''` kept, grants
-- re-stated (REVOKE from PUBLIC, anon, authenticated — only the jobs call
-- it). No table, column, policy, trigger or signature changed.
-- WAIVERS: none. R6 / D38 not engaged (nothing backfilled, no CHECK
-- tightened, no realtime surface touched).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- playoff_bracket_sync_internal — CREATE OR REPLACE against 134:822-1230's
-- FILE TEXT, EXACTLY ONE HUNK (the R839 arm's RAISE: WARNING → NOTICE, the
-- copy corrected). See the banner's D137 PROVENANCE.
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
REVOKE EXECUTE ON FUNCTION playoff_bracket_sync_internal(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
