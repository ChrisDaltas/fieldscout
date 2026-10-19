-- ============================================================================
-- 199 — the retire schema is removed, and more league refusals in plain words
--       (F562; F569 part 3; Chris's go 2026-10-19; FULL rigour — schema
--       removal + 29 function bodies; PROGRESS D560–D561; spec v2.16.100)
-- ============================================================================
--
-- THE RULING (Chris, 2026-10-01): a team is never retired — a manager change
-- is a takeover or a vacancy, and the team lives on. 176 removed the verb;
-- this removes what was left of it (F562), and, while those bodies are open,
-- rewrites the refusals a member or commissioner can meet in plain fantasy
-- language (F569 part 3 — text only).
--
-- PRODUCTION, measured read-only before writing this (2026-10-19, head 198):
-- 0 teams with status 'retired' (of 12), 0 with retired_at_week, 0 with
-- successor_team_id, 0 team_managers stints ending 'seat_retired', 0
-- commissioner_actions of a retire type, 0 trades / waiver claims whose
-- reason mentions a retirement. No data is migrated; §0 below refuses LOUDLY
-- if any such row exists where this runs.
--
-- §1 — 29 bodies, each `CREATE OR REPLACE` against its NEWEST defining
-- migration's FILE TEXT over 001–198 (D137; CLAUDE.md's 073 lesson),
-- extracted programmatically (derive_199.py, which also checks the file text
-- md5 equals the live body before editing); signature, volatility, SECURITY
-- DEFINER / INVOKER, search_path '' and the ACL unchanged (CREATE OR REPLACE
-- keeps the grants; pgTAP 149 A pins them). Every body names its source and
-- hunk count above it. pgTAP 149's pg_temp.un199 reverses all 81 hunks to
-- the 198 text byte for byte (A3), and is an identity on every other body.
--   Retire remnants removed (F562):
--     * the lineage reads — league_standings_internal's seeding fold and
--       week_results_pending_internal's walk over successor_team_id read
--       118's plain `r.team_id = s.id` / 117's `r.team_id = t.id` again;
--       process_waivers_internal / waiver_priority_seed_internal /
--       waiver_claim_notify_internal lose the successor-chain loop;
--     * the teams broadcast diff and payload drop retired_at_week /
--       successor_team_id (record = {id, name, status});
--     * remove_manager: 'retire' is no longer a mode (the generic "mode must
--       be takeover or vacate", 22023), the pre-176 replay, the retire arms of
--       the receipt / notification / return, and the retire-only DECLAREs go;
--       p_action_id stays in the signature (unused) so no caller moves;
--     * every "this franchise is retired / sealed" refusal: assign_manager,
--       create_league_invite, commish_edit_faab, commish_edit_lineup,
--       commish_rename_team, commish_roster_override, commish_set_autopilot,
--       rename_own_team, roster_add_drop, set_lineup, trade_execute,
--       trade_preview, trade_propose_core, trade_respond (both the accept
--       guard and the counter's `status <> 'retired'`), trade_tick's sweep
--       ("… is retired and can't make trades"), trade_vote,
--       waiver_claim_edit, waiver_claim_submit; draft_team_budget's and
--       playoff_bracket_sync_internal's retired wording; the `status <>
--       'retired'` filters inside these bodies.
--   Plain words (F569 part 3) — every refusal of trade_check_internal (its
--   text is STORED after "the trade could not go through: " when a trade
--   fails at execution), and in the bodies opened above: the FAAB-on-record
--   refusals, the "no season schedule yet" family, the off-calendar week,
--   the autopilot no-seat refusal, the invite refusals, the commissioner
--   roster tools' verb names / standing-rule cites, the illegal-lineup
--   refusal, the standalone-team rename. Codes, `§` marks, setting / column
--   names and player ids leave the sentence; meaning, values and order stay.
--   Kept on purpose, so the client reads both texts: dropsNeeded's shape
--   ("<team>'s roster would hold N players after this trade — K more than
--   its M spots…: name K more drop") and every phrase-map fragment of the
--   reworded trade_check sentences. Activity-feed post prefixes are not
--   touched (no post text is in these bodies' hunks).
--   LEFT, with reasons (filed F671 / F672):
--     * the waiver resolver pair's `retired` input flag and its
--       'team_retired' outcome (waiver_resolve_run_internal + its TS twin
--       resolve-waiver-run.ts + the property suite, and the input / notice
--       arms in process_waivers_internal / waiver_claim_notify_internal) —
--       one side of a twin pair alone would let them disagree (F556's rule);
--       after §2 the flag is always false;
--     * `status <> 'retired'` filters in ~45 bodies this migration does not
--       otherwise open (draft, schedule, trade-vote tallies …): with §2's
--       CHECK they can never exclude a row — removed when each body is next
--       opened;
--     * comments that narrate the retire history inside kept bodies.
--
-- §2 — the schema: teams.successor_team_id (with its FK and the not-self
-- CHECK) and teams.retired_at_week are DROPPED; teams.status CHECK becomes
-- ('active', 'orphaned'); team_managers.end_reason CHECK loses
-- 'seat_retired'. After §1, so nothing live reads a dropped column; §3
-- asserts that from the catalog.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Tables: teams −2 columns, −1 FK, −1 CHECK, 1 CHECK narrowed;
--   team_managers 1 CHECK narrowed. No new table, index, policy, trigger or
--   cron row. RLS unchanged. Functions: 29 bodies replaced, no signature
--   moved, no new function. Time: none new. Realtime: the `teams` broadcast
--   record loses two keys (the client reads name / status by key; no reducer
--   reads the two — pinned by Vitest). Typegen: teams Row/Insert/Update −2,
--   one relationship gone; alias block untouched.
--   WAIVERS: R6 — no staging clone; rehearsal = the local apply + the full
--   pgTAP run in the PR. D38 — no backfill: production holds no row in any
--   removed state (measured above; §0 re-proves it where it runs).
--   DEGRADE-BEFORE-PUSH: main deploys before this is pushed. The app reads
--   neither column after this PR (the score worker's lineage walk is gone),
--   so new code runs on the 198 schema; the reworded refusals reach the
--   client through the same cleaner, which keeps reading the old text.
-- Rollback = re-apply each body from the source named above it, re-add the
--   two columns NULL and the two CHECK arms (no data to restore).
--
-- Proof: pgTAP 149 (form + ACLs, md5 stored literals before / after, un199
-- reversal, schema gone, the reworded sentences raised over real fixtures,
-- removed refusals no longer reachable). Re-cut: 068, 121, 124 and the md5
-- pins that read these bodies (un199 innermost). Break probe in the PR.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §0 — loud if any row is in a removed state (production holds none).
-- ---------------------------------------------------------------------------
DO $chk$
DECLARE
  v_n INTEGER;
BEGIN
  SELECT count(*)::int INTO v_n FROM public.teams
  WHERE status = 'retired' OR successor_team_id IS NOT NULL OR retired_at_week IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '199: % team row(s) are retired or carry a successor — refusing to drop the retire schema over data', v_n;
  END IF;
  SELECT count(*)::int INTO v_n FROM public.team_managers WHERE end_reason = 'seat_retired';
  IF v_n > 0 THEN
    RAISE EXCEPTION '199: % stint(s) end in seat_retired — refusing to narrow the CHECK over data', v_n;
  END IF;
END
$chk$;

-- ---------------------------------------------------------------------------
-- broadcast_teams_statement — 120:1122-1154 FILE TEXT (D137), 1 hunk (+1 / -3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION broadcast_teams_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lg RECORD;
BEGIN
  FOR v_lg IN
    SELECT c.league_id,
           count(*)::int                                                     AS n,
           jsonb_agg(public.team_broadcast_payload(c) ORDER BY c.name, c.id) AS rows_
    FROM new_rows c
    JOIN old_rows o ON o.id = c.id
    WHERE c.league_id IS NOT NULL
      AND (c.name              IS DISTINCT FROM o.name
        OR c.status            IS DISTINCT FROM o.status)
    GROUP BY c.league_id
    ORDER BY c.league_id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'operation', TG_OP,
        'table',     TG_TABLE_NAME,
        'schema',    TG_TABLE_SCHEMA,
        'record',    jsonb_build_object(
          'count', v_lg.n,
          'teams', v_lg.rows_)),
      'teams',
      'league:' || v_lg.league_id::text,
      true);
  END LOOP;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- team_broadcast_payload — 120:1105-1117 FILE TEXT (D137), 1 hunk (+1 / -3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION team_broadcast_payload(t teams)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',                t.id,
    'name',              t.name,
    'status',            t.status);
$$;

-- ---------------------------------------------------------------------------
-- league_standings_internal — 120:721-1020 FILE TEXT (D137), 2 hunks (+2 / -17).
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

  WITH RECURSIVE chain AS (
    SELECT c.e AS entry, c.ord::int AS ord FROM unnest(v_chain) WITH ORDINALITY AS c(e, ord)
  ),
  seated AS (
    SELECT t.id, t.name FROM public.teams t WHERE t.league_id = p_league_id
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

-- ---------------------------------------------------------------------------
-- week_results_pending_internal — 120:1028-1087 FILE TEXT (D137), 2 hunks (+2 / -15).
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

-- ---------------------------------------------------------------------------
-- commish_edit_faab_internal — 147:130-358 FILE TEXT (D137), 2 hunks (+2 / -9).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_faab_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_balance   INTEGER,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_team       public.teams;
  v_seat       public.league_members;
  v_reason     TEXT;
  v_before     INTEGER;
  v_no_changes BOOLEAN;
  v_pending    INTEGER;
  v_reseed     BOOLEAN;
  v_reseed_why TEXT;
  v_audit_id   UUID;
  v_message    TEXT;
  v_manager    UUID;
  v_result     JSONB;
  v_cnt        INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule).
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_faab: p_team_id is required — an edit that names no team is not an edit'
      USING ERRCODE = '22023';
  END IF;
  IF p_balance IS NULL THEN
    RAISE EXCEPTION 'commish_edit_faab: p_balance is required — the whole-dollar FAAB balance the team should have (0 or more)'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_faab: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST — the one serialization point every
  --     money-moving verb takes (145's claim verbs, 115's add/drop, the
  --     waiver processor L.D2.9), so an edit never interleaves with a run
  --     that debits the same balance.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner OR co-commissioner, in-body, as ONE no-leak 42501
  --     covering "no such league", "not a member" and "a manager, even of
  --     this very team" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_edit_faab: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (123:602-609's placement): a retry replays byte-identically even when
  --     the balance has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_faab_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66; 131's normalisation verbatim).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_edit_faab: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) VALIDITY — money that does not exist (standing rule (i): binds the
  --     commissioner too). 145's CHECK is the backstop for every other path.
  IF p_balance < 0 THEN
    RAISE EXCEPTION
      'commish_edit_faab: a FAAB balance cannot be negative (asked for $%) — the lowest a team can hold is $0 (TD2; CHECK league_members_faab_balance_nonneg)', p_balance
      USING ERRCODE = '22023';
  END IF;

  -- (6) THE FRANCHISE, read under the league lock.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_edit_faab: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE SEAT — the balance's home (TD2), re-read and locked. A franchise
  --     with no seat row has no balance at all: refused BY NAME, and
  --     nothing is minted.
  SELECT m.* INTO v_seat
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'commish_edit_faab: team % has no seat in league % — a FAAB balance lives on the team''s seat (league_members), and this team has none, so there is no balance to edit',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_before := v_seat.faab_balance;

  -- (8) THE NO-OP, BY VALUE (D336 part 3).
  v_no_changes := (v_before IS NOT DISTINCT FROM p_balance);

  -- What can still overwrite the balance, stated (choice (a)).
  v_reseed := v_league.status IN ('setup', 'scheduled', 'drafting');
  v_reseed_why := CASE
    WHEN v_league.status IN ('setup', 'scheduled') THEN
      'league is ' || v_league.status || ' — before the draft starts balances track the budget (§12.2 v2.8.7): a faab_budget change re-seeds every seat; filling this seat or its manager leaving or being removed re-seeds it (146); and a draft reset after the draft starts re-seeds every seat (147, F412)'
    WHEN v_league.status = 'drafting' THEN
      'league is drafting — a draft reset returns the league to scheduled and re-seeds every seat to the budget (147, F412)'
    ELSE
      'league is ' || v_league.status || ' — from the draft on the balance is the team''s own ledger and nothing re-seeds it (D384; a budget change leaves it alone, 144)' END;

  IF NOT v_no_changes THEN
    -- (8b) THE STATE WRITE, with the loud ROW_COUNT assertion (119:882-886).
    UPDATE public.league_members
    SET faab_balance = p_balance
    WHERE id = v_seat.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_edit_faab: the balance write touched % rows, expected exactly 1 (team %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (9) D336 part 2 — EXACTLY ONE audit row, AFTER the state write.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_faab', 'team', p_team_id::text, v_reason,
      jsonb_build_object('faab_balance', v_before),
      jsonb_build_object('faab_balance', p_balance),
      jsonb_build_object(
        'verb',              'commish_edit_faab',
        'season',            v_league.season,
        'action_id',         p_action_id,
        'team_name',         v_team.name,
        'league_status',     v_league.status,
        'faab_budget',       v_league.faab_budget,
        'affected_team_ids', jsonb_build_array(p_team_id),
        'bypassed',          '[]'::jsonb),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_edit_faab: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) §10.3: the non-disableable system post, then the seated manager's
    --      notification (TD16). An unmanaged seat notifies nobody; the actor
    --      is never notified of his own act.
    v_message := v_team.name || '''s FAAB balance is now $' || p_balance
      || ' (was ' || COALESCE('$' || v_before, 'unset') || ')'
      || ' — set by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    v_manager := v_seat.user_id;
    IF v_manager IS NOT NULL AND v_manager IS DISTINCT FROM auth.uid() THEN
      PERFORM public.notify_league_member_internal(
        v_manager, 'league_faab_commissioner',
        'The commissioner changed your FAAB balance',
        v_team.name || ': $' || p_balance || ' (was ' || COALESCE('$' || v_before, 'unset') || ')'
          || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
        jsonb_build_object('league_id', p_league_id, 'team_id', p_team_id,
                           'faab_before', v_before, 'faab_after', p_balance,
                           'commissioner_action_id', v_audit_id));
    ELSE
      v_manager := NULL;
    END IF;
  END IF;

  -- (e) Pending bids now above the balance — counted, never touched.
  SELECT count(*)::int INTO v_pending
  FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending'
    AND c.faab_bid > p_balance;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_edit_faab',
    'action_type',            'edit_faab',
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'league_status',          v_league.status,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    -- The balance AFTER this call, what it was, and what was asked — the
    -- route's F65(b) guard compares `requested_balance` with its body.
    'faab_balance',           p_balance,
    'previous_balance',       v_before,
    'requested_balance',      p_balance,
    'delta',                  CASE WHEN v_before IS NULL THEN NULL ELSE p_balance - v_before END,
    'faab_budget',            v_league.faab_budget,
    'waiver_type',            v_league.waiver_type,
    'pending_bids_above_balance', v_pending,
    'reseed_can_overwrite',   v_reseed,
    'reseed_why',             v_reseed_why,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'balance_already_set — the team already held exactly this balance, so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,              -- NULL on a no-op, and that is the point
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — no timing rule governs a balance edit (no lock, no week gate, no waiver schedule); the only gate is validity (a balance is never negative), which binds the commissioner too (standing rule (i))',
    'reason',                 v_reason,
    'system_post',            v_message,               -- NULL on a no-op
    'notified_user_id',       v_manager,               -- NULL on a no-op, an unmanaged seat, or the actor's own seat
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266).
  INSERT INTO public.commish_faab_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- commish_rename_team_internal — 170:2227-2473 FILE TEXT (D137), 2 hunks (+1 / -16).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_rename_team_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_name      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_team       public.teams;
  v_reason     TEXT;
  v_new_name   TEXT;
  v_old_name   TEXT;
  v_no_changes BOOLEAN;
  v_collides   JSONB;
  v_frozen     INTEGER;
  v_audit_id   UUID;
  v_message    TEXT;
  v_result     JSONB;
  v_cnt        INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and is never answered with
  --     `no_changes: true` — a success document for a request that never said
  --     what it wanted is 126's rule, and it is this verb's too.
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'commish_rename_team: p_team_id is required — an override that names no franchise is not an override'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_rename_team: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8 — the same
  --     serialization point every in-season verb takes). A rename is a
  --     read-then-write over `teams.name`, so without it two concurrent
  --     renames could each observe a change and each write one, and the
  --     LOSER's audit row would claim a `before` that was never the row's
  --     value by the time it landed. The receipt has to be true.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — COMMISSIONER ONLY, in-body, as ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5). The
  --     manager's door is §4's `rename_own_team`, which this verb does not
  --     widen and does not replace.
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_rename_team: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), placed AFTER auth but BEFORE every business gate
  --     (`123:602-609`'s placement), so a retry replays byte-identically even
  --     when the league has since moved on — including after the franchise
  --     has been renamed again by someone else.
  SELECT a.result INTO v_result
  FROM public.commish_team_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused. Absent or
  --     whitespace-only in the explicit E' \t\r\n' class (R745) ⇒ NULL
  --     (130 §0 stores it); otherwise trimmed, bounded at 500 below (the
  --     league_chat bound and the commissioner_actions CHECK). PROGRESS
  --     (h)/F343 as amended by 131: the client may send NOTHING; the label
  --     was a workaround for 123:295's NOT NULL, which 130 §0 removed.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_rename_team: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (4b) THE NAME, through the shared gate (§2).
  v_new_name := public.team_rename_normalize_internal(p_name, 'commish_rename_team');

  -- (5) THE FRANCHISE. Locked in its own right so the before/after pair the
  --     receipt carries is the value this statement actually replaced.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_rename_team: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_old_name := v_team.name;

  -- (7) THE COLLISION REPORT — measured, never a refusal. There is no UNIQUE
  --     index and no CHECK on `teams.name` anywhere in 001-127, and inventing
  --     one inside a verb that exists to REMOVE a restriction would be new
  --     product. So the other franchises already using this name are named
  --     and the caller decides (§4 rule 15: say what is true out loud).
  SELECT COALESCE(jsonb_agg(t.id ORDER BY t.name, t.id), '[]'::jsonb) INTO v_collides
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.id <> p_team_id
    AND lower(t.name) = lower(v_new_name);

  -- (8) THE NO-OP, DETECTED BY VALUE across every dimension this verb can
  --     change — which is exactly ONE, `name` (D336 part 3, §4 rule 15).
  --     Never inferred from an empty write: the UPDATE below sits INSIDE the
  --     guard, so `updated_at` does not move for a no-op either.
  v_no_changes := (v_old_name = v_new_name);

  IF NOT v_no_changes THEN
    -- (8b) THE STATE WRITE, with the loud ROW_COUNT assertion the house uses
    --      (`119:882-886`'s shape). The row is already locked by (5), so a
    --      count other than 1 means the row vanished under us, not a race we
    --      can paper over.
    UPDATE public.teams
    SET name = v_new_name,
        updated_at = p_at
    WHERE id = p_team_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_rename_team: the rename touched % rows, expected exactly 1 (franchise %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (8c) THE FROZEN COPIES, COUNTED BEFORE THIS ACT'S OWN RECEIPT IS
    --      WRITTEN. Receipts already issued in this league that carry the OLD
    --      name keep carrying it — a receipt records what was true (§18,
    --      §12.12), and `123:339-410`'s ENABLE ALWAYS trigger refuses an
    --      UPDATE of one anyway. Counted, not asserted, so the number in the
    --      document is measured (§4 rule 15).
    --
    --      SCOPE, STATED so the number is readable: receipts already issued
    --      ABOUT THIS FRANCHISE (`target_type = 'team'`, `target_id` = this
    --      id) whose recorded `metadata.team_name` is not the name the
    --      franchise carries after this statement. Those are exactly the rows
    --      a reader might expect a propagation pass to have rewritten, and
    --      exactly the rows that must not be.
    SELECT count(*)::int INTO v_frozen
    FROM public.commissioner_actions c
    WHERE c.league_id = p_league_id
      AND c.target_type = 'team'
      AND c.target_id = p_team_id::text
      AND c.metadata ->> 'team_name' IS NOT NULL
      AND c.metadata ->> 'team_name' IS DISTINCT FROM v_new_name;

    -- (9) D336 part 2 — EXACTLY ONE audit row, through the ONE shared logging
    --     helper (`123:417-453`), INSIDE the no-op guard and AFTER the state
    --     write. tasks-M6A §5's contractual shape for this verb.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'reassign_team', 'team', p_team_id::text, v_reason,
      jsonb_build_object('name', v_old_name),
      jsonb_build_object('name', v_new_name),
      jsonb_build_object(
        'verb',                'commish_rename_team',
        'season',              v_league.season,
        'action_id',           p_action_id,
        -- §5's contractual extra: the OLD name, which is also the value this
        -- receipt freezes for ever.
        'team_name',           v_old_name,
        'new_team_name',       v_new_name,
        'team_status',         v_team.status,
        'name_collides_with',  v_collides,
        'bypassed',            '[]'::jsonb,
        'frozen_receipts_for_this_team', v_frozen),
      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM: the commissioner
      -- renamed it, the act rename_own_team gives its manager (§10.3:711;
      -- TD16 — the manager verb's commissioner door is this override). His
      -- OWN team is his own act: NULL (R1334).
      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m
                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)
           THEN NULL ELSE p_team_id END);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_rename_team: the audit row was not written — refusing to let the rename stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) §10.3: override system messages auto-post to league chat and CANNOT
    --      be disabled. D97/D290's in-txn post, worded as the rename.
    v_message := v_old_name || ' is now ' || v_new_name
      || ' — renamed by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_rename_team',
    'action_type',            'reassign_team',       -- tasks-M6A §5's contractual string; F355
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'team_id',                p_team_id,
    'team_status',            v_team.status,
    'name',                   CASE WHEN v_no_changes THEN v_old_name ELSE v_new_name END,
    'previous_name',          v_old_name,
    'requested_name',         v_new_name,
    'name_collides_with',     v_collides,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'name_already_set — the franchise already carried this exact name (compared after the same trim), so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op, and that is the point
    -- Standing rule (g) exempts the commissioner from the game-day lock for
    -- every verb in this slice — but a NAME touches no lock, no week gate and
    -- no scoring door, so there is nothing here to walk past. The empty array
    -- is EXPLAINED rather than left to be guessed at (§4 rule 15).
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — a franchise name is not gated by the per-player kickoff lock (114:449-476), the week status, or the scoring snapshot',
    'propagation', jsonb_build_object(
      -- Item 4's finding, in the document as well as the banner.
      'live',                     TRUE,
      'live_why',                 'teams.name is read LIVE at every call site (123:1155 and 127:1413-1416 stamp it by joining teams at write time; standings and box scores join per read), so no propagation pass is written and none is needed',
      'frozen_receipts_for_this_team', CASE WHEN v_no_changes THEN 0 ELSE v_frozen END,
      'history_rewritten',        FALSE,
      'history_not_rewritten_why','already-written league_chat system posts and commissioner_actions.metadata.team_name KEEP THE OLD NAME on purpose — a receipt records what was true (§18, §12.12), and 123:339-410''s ENABLE ALWAYS trigger refuses an UPDATE of one in any case'),
    'reason',                 v_reason,
    'system_post',            v_message,             -- NULL on a no-op: no receipt if nothing is done
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`'s
  -- posture): an action_id is consumed by its submit whether or not anything
  -- moved, so a retry replays instead of re-evaluating. This is the OPPOSITE
  -- rule from the audit row above, and deliberately so — §12.26: "an action_id
  -- is an idempotency key, not an audit record".
  INSERT INTO public.commish_team_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- commish_set_autopilot_internal — 139:273-491 FILE TEXT (D137), 2 hunks (+2 / -8).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_set_autopilot_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_on        BOOLEAN,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_team       public.teams;
  v_reason     TEXT;
  v_has_member BOOLEAN;
  v_managed    BOOLEAN;
  v_seat       TEXT;
  v_seat_why   TEXT;
  v_before     BOOLEAN;
  v_no_changes BOOLEAN;
  v_audit_id   UUID;
  v_message    TEXT;
  v_result     JSONB;
  v_cnt        INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule — a success document for a request
  --     that never said what it wanted).
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'commish_set_autopilot: p_team_id is required — a switch that names no franchise is not a switch'
      USING ERRCODE = '22023';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'commish_set_autopilot: p_on is required — TRUE puts the team on autopilot, FALSE takes it off'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_set_autopilot: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8 — the same
  --     serialization point `lineup_lock_tick` takes per league, `FOR UPDATE
  --     SKIP LOCKED`), so a switch flip and a tick pass over the same league
  --     never interleave: the tick either sees the switch before this call
  --     or after it, never half of it.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner OR co-commissioner (`is_league_commish`,
  --     052:96-105), in-body, as ONE no-leak 42501 covering "no such league"
  --     and "not a commissioner" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_set_autopilot: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (`123:602-609`'s placement): a retry replays byte-identically even
  --     when the seat or the switch has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_autopilot_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66; 131's normalisation verbatim): absent or
  --     whitespace-only in the explicit E' \t\r\n' class ⇒ NULL; otherwise
  --     trimmed and bounded at 500 (the league_chat bound).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_set_autopilot: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) THE FRANCHISE, re-read under the league lock.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_set_autopilot: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE SEAT, read the way arm (c) reads it (D339 — `league_members`,
  --     never `teams.status` and never `is_placeholder`).
  v_has_member := EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = p_team_id);
  v_managed := EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = p_team_id AND m.user_id IS NOT NULL);
  v_seat := CASE WHEN v_managed THEN 'managed'
                 WHEN v_has_member THEN 'unmanaged'
                 ELSE 'no_league_members_row' END;
  v_seat_why := CASE v_seat
    WHEN 'managed' THEN 'a manager is seated (a league_members row carries a user_id) — autopilot never runs for a managed seat (arm (c), D339)'
    WHEN 'unmanaged' THEN 'no manager is seated (the seat''s league_members row carries no user_id) — arm (c) runs for this seat exactly when the switch is ON'
    ELSE 'this team has NO league_members row at all — not proven unmanaged, so arm (c) declines it by name (D339)' END;

  -- (7) ON: TWO REFUSALS, EACH BY NAME. OFF has none (see the banner).
  IF p_on THEN
    IF v_seat = 'managed' THEN
      RAISE EXCEPTION
        'commish_set_autopilot: team % has a manager — autopilot is for a seat with NO manager (§7.2.1(c)); to set this team''s lineup, use the lineup override',
        p_team_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seat = 'no_league_members_row' THEN
      RAISE EXCEPTION
        'commish_set_autopilot: team % has no seat in this league, so autopilot can''t be sure nobody manages it — seat it first',
        p_team_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (8) THE NO-OP, BY VALUE (D336 part 3): the stored switch — NO ROW IS
  --     OFF — already equals the request. Nothing written, no receipt, no
  --     post; the ledger row below is written anyway.
  SELECT sw.is_on INTO v_before FROM public.team_autopilot sw WHERE sw.team_id = p_team_id FOR UPDATE;
  v_before := COALESCE(v_before, FALSE);
  v_no_changes := (v_before = p_on);

  IF NOT v_no_changes THEN
    -- (9) THE STATE WRITE, with the loud ROW_COUNT assertion (`119:882-886`).
    INSERT INTO public.team_autopilot (team_id, is_on, set_at)
    VALUES (p_team_id, p_on, p_at)
    ON CONFLICT (team_id) DO UPDATE SET is_on = EXCLUDED.is_on, set_at = EXCLUDED.set_at;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_set_autopilot: the switch write touched % rows, expected exactly 1 (team %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) D336 part 2 — EXACTLY ONE audit row, AFTER the state write.
    --      `before` / `after` carry the ONE key this verb changes, so the
    --      activity feed reads the act from the key set (F355).
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'set_autopilot', 'team', p_team_id::text, v_reason,
      jsonb_build_object('autopilot', v_before),
      jsonb_build_object('autopilot', p_on),
      jsonb_build_object(
        'verb',              'commish_set_autopilot',
        'season',            v_league.season,
        'action_id',         p_action_id,
        'team_name',         v_team.name,
        'team_status',       v_team.status,
        'seat',              v_seat,
        'affected_team_ids', jsonb_build_array(p_team_id),
        'bypassed',          '[]'::jsonb),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_set_autopilot: the audit row was not written — refusing to let the switch stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (11) §10.3: override system messages auto-post to league chat and
    --      CANNOT be disabled. No other notification — Q63: "we don't need
    --      any additional reminders for this exception case".
    v_message := v_team.name
      || CASE WHEN p_on THEN ' is now on autopilot' ELSE ' is off autopilot — the commissioner manages its lineup' END
      || ' — set by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_set_autopilot',
    'action_type',            'set_autopilot',
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    'team_status',            v_team.status,
    -- The switch AFTER this call, what it was, and what was asked — the
    -- route's F65(b) guard compares `requested` with the body it sent.
    'autopilot',              CASE WHEN v_no_changes THEN v_before ELSE p_on END,
    'previous',               v_before,
    'requested',              p_on,
    'seat',                   v_seat,
    'seat_why',               v_seat_why,
    -- What the switch DOES, said once so no caller has to infer it (rule 15).
    'effect',                 CASE
      WHEN NOT (CASE WHEN v_no_changes THEN v_before ELSE p_on END) THEN
        'off — the commissioner manages this team: lineup_lock_tick never fills or substitutes it; it plays the lineup it has and an empty slot scores zero (Q63)'
      WHEN v_seat = 'unmanaged' THEN
        'on — from the next lineup-lock tick (every minute on game days) autopilot fills empty starting slots and substitutes a starter who cannot play, while the seat has no manager and its week is live (§7.2.1(c))'
      ELSE
        'on, and INERT while a manager is seated — arm (c) runs only for an unmanaged seat; it resumes if the seat is vacated (the stored switch is left untouched by a claim)' END,
    'affected_team_ids',      jsonb_build_array(p_team_id),
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                CASE WHEN v_before THEN 'already_on — the team was already on autopilot, so nothing was written and no receipt was issued'
                                     ELSE 'already_off — the team was already off autopilot (a team never switched has no row, which is OFF — the ruled default), so nothing was written and no receipt was issued' END END,
    'commissioner_action_id', v_audit_id,             -- NULL on a no-op, and that is the point
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — the switch is not gated by the per-player kickoff lock, the week status or the scoring snapshot; it changes what the NEXT tick does, never a lineup already written',
    'reason',                 v_reason,
    'system_post',            v_message,              -- NULL on a no-op
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`'s
  -- posture) — §12.26: "an action_id is an idempotency key, not an audit
  -- record".
  INSERT INTO public.commish_autopilot_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rename_own_team_internal — 128:696-857 FILE TEXT (D137), 4 hunks (+6 / -24).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rename_own_team_internal(
  p_team_id UUID,
  p_name    TEXT,
  p_at      TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_team       public.teams;
  v_new_name   TEXT;
  v_old_name   TEXT;
  v_no_changes BOOLEAN;
  v_collides   JSONB;
  v_cnt        INTEGER;
BEGIN
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'rename_own_team: p_team_id is required'
      USING ERRCODE = '22023';
  END IF;

  -- (1) THE FRANCHISE, read UNLOCKED first because the caller supplies no
  --     league id and the house lock order (rule 8) is `leagues` FIRST — so
  --     this read exists only to learn WHICH league row to lock, and to route
  --     a standalone team. NOTHING BELOW IS DECIDED ON THIS ROW: every gate
  --     (auth) reads the locked re-read at step (3) — R1036/R1037.
  --     A team that does not exist is answered with the SAME no-leak 42501 as
  --     one the caller does not manage.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rename_own_team: not the manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (2) STANDALONE TEAMS ARE ROUTED, not handled twice. Authorize as the
  --     owner first so a stranger still gets the no-leak 42501 and learns
  --     nothing about which teams exist. (`teams.league_id` has NO writer
  --     anywhere in 001-128 — the eleven `UPDATE … teams` statements in the
  --     banner write only `owner_id` / `status` / `updated_at` (and two
  --     columns 199 dropped) — so the league this row names
  --     cannot change between this read and the lock below.)
  IF v_team.league_id IS NULL THEN
    IF v_team.owner_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'rename_own_team: not the manager of this team'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION
      'rename_own_team: team % is not a league team, so it is not renamed here', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) LOCK, THEN RE-READ — BEFORE any gate is evaluated. The LEAGUE row is
  --     locked first, in the house order (rule 8), so this verb,
  --     `commish_rename_team` and `remove_manager` (`120:271` — its retire
  --     and vacate arms lock the same league row first) all serialize on ONE
  --     point and cannot deadlock against each other. Then the franchise row
  --     itself, so the reported `previous_name` is the value this statement
  --     actually replaced.
  --
  --     WHY THE GATES SIT AFTER THIS AND NOT BEFORE IT (R1036, the second fix
  --     round of PR #298, by Chris's ruling of 2026-09-15): the first fix
  --     round put the retired guard at the OLD step (3b), reading step (1)'s
  --     UNLOCKED row. A retire committed while this call was blocked on the
  --     league lock was therefore never seen — the Reviewer held the league
  --     lock in one session, retired the franchise, slept, committed; a
  --     manager's rename in a second session waited ~4.5 s on that lock and
  --     then LANDED on the freshly sealed franchise (`Raced Past The Seal |
  --     retired`). The commissioner arm was never exposed, because its guard
  --     (step 6) already read its locked re-read (step 5). The manager arm now
  --     has the SAME shape: lock, re-read, THEN decide. R1037 rides along —
  --     the AUTH predicate is evaluated here too, against the seat as it is
  --     AFTER the lock, so a manager `remove_manager` has just ousted (the
  --     vacate arm NULLs `user_id` on the row at `120:565-570`'s sibling,
  --     `:645`) cannot land a rename that was in flight when he lost the
  --     seat. That is `spec:187`'s own promise — *"Access ends the instant
  --     the stint closes … no race window"* — kept at the only place it can
  --     be, after the lock. pgTAP 076 F13/F14 pin BOTH orders in `prosrc`.
  PERFORM 1 FROM public.leagues l WHERE l.id = v_team.league_id FOR UPDATE;
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Deleted between (1) and the lock: the same no-leak answer as (1).
    RAISE EXCEPTION 'rename_own_team: not the manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (4) AUTH — the exact complement of `set_lineup_internal`'s own manager
  --     check (`114:240-243`, under the F35 doctrine comment at `114:237`:
  --     league_members' cache column, NEVER a stint). One no-leak 42501
  --     covering "no such team" and "not your seat" alike. Evaluated UNDER
  --     the league lock (step 3), never on the pre-lock read — R1037.
  IF NOT EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.team_id = p_team_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'rename_own_team: not the manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (6) THE NAME, through the SAME shared gate the commissioner's verb uses
  --     (§2) — one bound, one trim class, one message shape.
  v_new_name := public.team_rename_normalize_internal(p_name, 'rename_own_team');
  v_old_name := v_team.name;

  SELECT COALESCE(jsonb_agg(t.id ORDER BY t.name, t.id), '[]'::jsonb) INTO v_collides
  FROM public.teams t
  WHERE t.league_id = v_team.league_id AND t.id <> p_team_id
    AND lower(t.name) = lower(v_new_name);

  -- (6) THE NO-OP, detected by value over the one dimension this verb can
  --     change. The UPDATE sits inside the guard, so `updated_at` does not
  --     move either.
  v_no_changes := (v_old_name = v_new_name);
  IF NOT v_no_changes THEN
    UPDATE public.teams
    SET name = v_new_name,
        updated_at = p_at
    WHERE id = p_team_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'rename_own_team: the rename touched % rows, expected exactly 1 (franchise %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'verb',               'rename_own_team',
    'team_id',            p_team_id,
    'league_id',          v_team.league_id,
    'name',               CASE WHEN v_no_changes THEN v_old_name ELSE v_new_name END,
    'previous_name',      v_old_name,
    'requested_name',     v_new_name,
    'name_collides_with', v_collides,
    'no_changes',         v_no_changes,
    'no_changes_why',     CASE WHEN v_no_changes THEN
                            'name_already_set — your franchise already carried this exact name (compared after the same trim), so nothing was written' END,
    -- Every piece of commissioner apparatus this verb deliberately does NOT
    -- carry, named in the response rather than only in a comment (§4 rule 15).
    'audited',            FALSE,
    'audited_why',        'a manager renaming his OWN franchise is not exercising a §10.1 commissioner power, so no commissioner_actions row is written, no reason is required and no action_id is consumed. The commissioner''s equivalent is commish_rename_team, which is audited, reason-required and replay-keyed',
    'system_post',        NULL,
    'system_post_why',    '§10.3''s non-disableable league_chat post is for OVERRIDE messages; an ordinary manager action does not write one',
    'evaluated_at',       p_at);
END;
$$;

-- ---------------------------------------------------------------------------
-- process_waivers_internal — 160:165-720 FILE TEXT (D137), 3 hunks (+1 / -8).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_waivers_internal(p_league_id UUID, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_type        TEXT;
  v_sched       JSONB;
  v_run_at      TIMESTAMPTZ;
  v_next        TIMESTAMPTZ;
  v_current     INTEGER;
  v_week_end    TIMESTAMPTZ;   -- 152 / F437: the current week's end (153: its lock release — Q78's ceiling)
  v_from_week   INTEGER;       -- 152 / F437: the first unfinished week
  v_tb          TEXT;
  v_size        INTEGER;
  v_capw_txt    TEXT;
  v_caps_txt    TEXT;
  v_hold_hours  INTEGER;
  v_persists    BOOLEAN;
  v_teams       JSONB;
  v_claims      JSONB;
  v_draft_raw   JSONB;
  v_draft       JSONB := '[]'::jsonb;
  v_st          JSONB;
  v_standings   JSONB := 'null'::jsonb;
  v_rolling     JSONB := 'null'::jsonb;
  v_locked      JSONB;
  v_input       JSONB;
  v_result      JSONB;
  v_o           JSONB;
  v_t           JSONB;
  v_x           JSONB;
  v_live        public.teams;
  v_claim       public.waiver_claims;
  v_winners     JSONB := '{}'::jsonb;
  v_spent       INTEGER;
  v_before      INTEGER;
  v_after       INTEGER;
  v_drop_row    public.league_rosters;
  v_drop_p      public.players;
  v_add_p       public.players;
  v_pool        public.league_player_pool;
  v_pool_from   TEXT;
  v_drop_state  TEXT;
  v_drop_until  TIMESTAMPTZ;
  v_hold_early  BOOLEAN;
  v_txn_id      UUID;
  v_lineups     JSONB;
  v_row         public.team_lineups;
  v_map         JSONB;
  v_key         TEXT;
  v_starters    JSONB;
  v_bench       JSONB;
  v_changed     BOOLEAN;
  v_cnt         INTEGER;
  v_n           INTEGER := 0;
  v_won         INTEGER := 0;
  v_lost        INTEGER := 0;
  v_invalid     INTEGER := 0;
  v_faab_spent  INTEGER := 0;
  v_notified    INTEGER := 0;
  v_run_id      UUID;
  v_summary     JSONB;
BEGIN
  IF p_league_id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'process_waivers: p_league_id and p_at are required (p_at is the TimeProvider seam — no clock is read here)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) THE LEAGUE ROW FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_waivers: league % not found', p_league_id USING ERRCODE = 'P0002';
  END IF;

  -- (2) WHY NOTHING MIGHT HAPPEN — each answered by name (rule 5).
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'skipped',
      'why', 'league_not_in_season — the league is ' || v_league.status || '; waivers run only in season or in the playoffs (§13.2)',
      'evaluated_at', p_at);
  END IF;
  v_type := COALESCE(v_league.waiver_type, 'faab');

  IF v_type = 'none_fcfs' THEN
    -- F421(e) — DECIDED HERE: a claim left pending by a switch to "no
    -- waivers" can never be settled (there is no run), and every unowned
    -- player is now an instant pickup, so the claim CLOSES: `invalid` /
    -- `no_waivers`, nothing spent, its owner told; the pending run is
    -- cleared (149's setting verb clears it too — this is the backstop for
    -- every other writer of waiver_type).
    FOR v_claim IN
      SELECT c.* FROM public.waiver_claims c
      WHERE c.league_id = p_league_id AND c.status = 'pending'
      ORDER BY c.id
      FOR UPDATE
    LOOP
      UPDATE public.waiver_claims c
      SET status = 'invalid', result_reason = 'no_waivers', processed_at = p_at
      WHERE c.id = v_claim.id AND c.status = 'pending';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'process_waivers: closing claim % touched % rows, expected 1', v_claim.id, v_cnt USING ERRCODE = 'P0001';
      END IF;
      v_invalid := v_invalid + 1;
      IF public.waiver_claim_notify_internal(v_league, v_claim, 'invalid', 'no_waivers', '{}'::jsonb) IS NOT NULL THEN
        v_notified := v_notified + 1;
      END IF;
    END LOOP;
    UPDATE public.leagues SET waiver_next_run_at = NULL
    WHERE id = p_league_id AND waiver_next_run_at IS NOT NULL;
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'no_waivers',
      'claims_closed', v_invalid, 'notified', v_notified,
      'why', CASE WHEN v_invalid = 0 THEN 'no_waivers — the league has no waivers and no claim was pending'
                  ELSE 'no_waivers — the league switched to no waivers; its pending claims closed as no_waivers (F421(e))' END,
      'evaluated_at', p_at);
  END IF;

  v_sched := public.waiver_schedule_internal(v_league.settings, v_type);
  IF v_league.waiver_next_run_at IS NULL THEN
    -- F423: the first tick TRACKS the league from its next scheduled run;
    -- nothing is decided now (claims placed before it settle at that run).
    v_next := public.waiver_next_run_internal(v_sched, p_at);
    UPDATE public.leagues SET waiver_next_run_at = v_next WHERE id = p_league_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 OR v_next IS NULL THEN
      RAISE EXCEPTION 'process_waivers: seeding league %''s next run wrote % rows (next run %) — expected one row and an instant', p_league_id, v_cnt, v_next
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'seeded', 'next_run_at', v_next,
      'why', 'untracked — the processor now tracks this league from its next scheduled run (F423); nothing was decided',
      'evaluated_at', p_at);
  END IF;
  IF v_league.waiver_next_run_at > p_at THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'not_due', 'next_run_at', v_league.waiver_next_run_at,
      'why', 'not_due — the next waiver run is still ahead', 'evaluated_at', p_at);
  END IF;
  v_run_at := v_league.waiver_next_run_at;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'process_waivers: league % has no league_weeks rows — no season calendar to evaluate locks and caps against (§12.17)', p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  -- F437: the first UNFINISHED week is the current week while its last
  -- game has not ended, the next one once it has (151's trade executor's
  -- rule, D410(5)). A finished week's lineup is
  -- the record the score worker and the nightly reconcile score it from
  -- (score-week-worker.ts step 5 reads THE WEEK's slot_map), and stat
  -- corrections re-score it until its window closes — clearing a played
  -- starter from it would erase his points from the team that played him.
  -- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,
  -- or its Wednesday 00:00 Pacific ceiling when that comes first. The
  -- ceiling releases a played starter, so it must finish the week for
  -- lineups too: otherwise, in a league's LAST week (no week N+1 row to
  -- flip the current week), a move at the ceiling would clear his start.
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
  WHERE w.season = v_league.season AND w.week = v_current;
  v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;

  -- (3) THE INPUT.
  v_tb := COALESCE(v_league.settings ->> 'faab_tiebreaker', 'rolling_priority');   -- 160 / L.D2.17: no stored key => the rolling order (Chris 2026-09-29)
  v_persists := v_type = 'rolling_priority' OR (v_type = 'faab' AND v_tb = 'rolling_priority');
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_size;                                                   -- 115's capacity, exactly
  v_capw_txt := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_caps_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_hold_hours := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);

  PERFORM 1 FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending' FOR UPDATE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'teamId', t.id::text,
           'roster', COALESCE((SELECT jsonb_agg(r.player_id ORDER BY r.player_id COLLATE "C")
                               FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = t.id), '[]'::jsonb),
           'faabBalance', (SELECT m.faab_balance FROM public.league_members m WHERE m.league_id = p_league_id AND m.team_id = t.id),
           'acquisitionsWeek', (SELECT count(*)::int FROM public.transactions x
                                WHERE x.league_id = p_league_id AND x.initiator_team_id = t.id AND x.status = 'complete'
                                  AND x.week = v_current AND (x.payload ->> 'add_player_id') IS NOT NULL),
           'acquisitionsSeason', (SELECT count(*)::int FROM public.transactions x
                                  WHERE x.league_id = p_league_id AND x.initiator_team_id = t.id AND x.status = 'complete'
                                    AND (x.payload ->> 'add_player_id') IS NOT NULL),
           'retired', t.status = 'retired') ORDER BY t.id::text COLLATE "C"), '[]'::jsonb)
  INTO v_teams
  FROM public.teams t WHERE t.league_id = p_league_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'claimId', c.id::text, 'teamId', c.team_id::text, 'addPlayerId', c.add_player_id,
           'dropPlayerId', c.drop_player_id, 'faabBid', c.faab_bid, 'claimOrder', c.claim_order)
           ORDER BY c.id::text COLLATE "C"), '[]'::jsonb)
  INTO v_claims
  FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending';

  -- The round-1 order as drafted (draft_order is the resolved order for
  -- every draft type — 098's draft_start writes it for an auction too).
  SELECT d.draft_order INTO v_draft_raw
  FROM public.drafts d
  WHERE d.league_id = p_league_id AND NOT d.is_mock AND d.status = 'complete'
  ORDER BY d.completed_at DESC NULLS LAST, d.id
  LIMIT 1;
  FOR v_x IN SELECT e FROM jsonb_array_elements(COALESCE(v_draft_raw, '[]'::jsonb)) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = (v_x #>> '{}')::uuid;
    v_draft := v_draft || jsonb_build_array(COALESCE(v_live.id::text, v_x #>> '{}'));
  END LOOP;

  IF NOT v_persists THEN
    v_st := public.league_standings_internal(p_league_id, FALSE);
    IF COALESCE((v_st ->> 'weeks_final')::int, 0) > 0 THEN
      SELECT COALESCE(jsonb_agg(s -> 'team_id' ORDER BY (s ->> 'rank')::int, s ->> 'team_id'), '[]'::jsonb)
      INTO v_standings
      FROM jsonb_array_elements(v_st -> 'standings') s;
    END IF;
  ELSE
    SELECT jsonb_object_agg(m.team_id::text, m.waiver_priority) INTO v_rolling
    FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.team_id IS NOT NULL AND m.waiver_priority IS NOT NULL;
    v_rolling := COALESCE(v_rolling, 'null'::jsonb);
  END IF;

  WITH claim_players AS (
    SELECT c.add_player_id AS pid FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending'
    UNION
    SELECT c.drop_player_id FROM public.waiver_claims c WHERE c.league_id = p_league_id AND c.status = 'pending' AND c.drop_player_id IS NOT NULL
  )
  -- 157 / F447: judged per PLAYER — a player the NFL released or traded
  -- after he played this week is locked at the run (Q73 / Q74).
  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id COLLATE "C"), '[]'::jsonb) INTO v_locked
  FROM public.players p JOIN claim_players cp ON cp.pid = p.id
  WHERE (public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p.id, p_at) ->> 'locked')::boolean;

  v_input := jsonb_build_object(
    'settings', jsonb_build_object(
      'waiverType',            v_type,
      'faabTiebreaker',        v_tb,
      'rosterSize',            v_size,
      'acquisitionsPerWeek',   CASE WHEN v_capw_txt = 'unlimited' THEN NULL ELSE v_capw_txt::int END,
      'acquisitionsPerSeason', CASE WHEN v_caps_txt = 'unlimited' THEN NULL ELSE v_caps_txt::int END),
    'teams',           v_teams,
    'claims',          v_claims,
    'priority',        jsonb_build_object('draftOrder', v_draft, 'standings', v_standings, 'rolling', v_rolling),
    'lockedPlayerIds', v_locked);

  -- (4) DECIDE.
  v_result := public.waiver_resolve_run_internal(v_input);
  FOR v_o IN SELECT e FROM jsonb_array_elements(v_result -> 'outcomes') e WHERE e ->> 'status' = 'won' LOOP
    v_winners := v_winners || jsonb_build_object(v_o ->> 'addPlayerId',
      jsonb_build_object('winner_team_id', v_o ->> 'teamId', 'winning_bid', (v_o ->> 'faabSpent')::int));
  END LOOP;

  -- (5) APPLY, in decision order.
  FOR v_o IN SELECT e FROM jsonb_array_elements(v_result -> 'outcomes') e ORDER BY (e ->> 'decision')::int LOOP
    v_n := v_n + 1;
    SELECT c.* INTO v_claim
    FROM public.waiver_claims c
    WHERE c.id = (v_o ->> 'claimId')::uuid AND c.league_id = p_league_id AND c.status = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'process_waivers: the run decided claim %, which is not a pending claim of league % — refusing', v_o ->> 'claimId', p_league_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_o ->> 'status' <> 'won' THEN
      UPDATE public.waiver_claims c
      SET status = v_o ->> 'status', result_reason = v_o ->> 'reason', processed_at = p_at, process_at = v_run_at
      WHERE c.id = v_claim.id AND c.status = 'pending';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'process_waivers: settling claim % touched % rows, expected 1', v_claim.id, v_cnt USING ERRCODE = 'P0001';
      END IF;
      IF v_o ->> 'status' = 'lost' THEN v_lost := v_lost + 1; ELSE v_invalid := v_invalid + 1; END IF;
      IF public.waiver_claim_notify_internal(v_league, v_claim, v_o ->> 'status', v_o ->> 'reason',
           COALESCE(v_winners -> v_claim.add_player_id, '{}'::jsonb)
           || jsonb_build_object('run_at', v_run_at,
                                 'faab_before', (SELECT m.faab_balance FROM public.league_members m
                                                 WHERE m.league_id = p_league_id AND m.team_id = v_claim.team_id))) IS NOT NULL THEN
        v_notified := v_notified + 1;
      END IF;
      CONTINUE;
    END IF;

    -- A WON claim.
    v_won := v_won + 1;
    v_spent := (v_o ->> 'faabSpent')::int;
    v_txn_id := gen_random_uuid();
    v_lineups := '[]'::jsonb;
    SELECT p.* INTO v_add_p FROM public.players p WHERE p.id = v_claim.add_player_id;
    SELECT pp.* INTO v_pool FROM public.league_player_pool pp WHERE pp.league_id = p_league_id AND pp.player_id = v_claim.add_player_id;
    v_pool_from := CASE WHEN NOT FOUND THEN 'free_agent' ELSE v_pool.state END;

    -- the drop (149's destination rule: on waivers until the NEXT run, or
    -- back to free agency inside fa_hold_hours of a free-agent pickup)
    v_drop_state := NULL;
    v_drop_until := NULL;
    v_hold_early := FALSE;
    IF v_claim.drop_player_id IS NOT NULL THEN
      SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = v_claim.drop_player_id;
      SELECT r.* INTO v_drop_row FROM public.league_rosters r
      WHERE r.league_id = p_league_id AND r.player_id = v_claim.drop_player_id AND r.team_id = v_claim.team_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'process_waivers: claim % drops %, who is not on the team''s roster — the resolver said he was; refusing', v_claim.id, v_claim.drop_player_id
          USING ERRCODE = 'P0001';
      END IF;
      v_hold_early := v_drop_row.acquisition_type = 'free_agent'
                      AND v_hold_hours > 0
                      AND v_drop_row.acquired_at IS NOT NULL
                      AND p_at < v_drop_row.acquired_at + make_interval(hours => v_hold_hours);
      IF v_hold_early THEN
        v_drop_state := 'free_agent';
      ELSE
        v_drop_state := 'on_waivers';
        v_drop_until := public.waiver_next_run_internal(v_sched, p_at);
      END IF;
      DELETE FROM public.league_rosters r
      WHERE r.league_id = p_league_id AND r.team_id = v_claim.team_id AND r.player_id = v_claim.drop_player_id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'process_waivers: the drop of % deleted % roster rows, expected 1', v_claim.drop_player_id, v_cnt USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
      VALUES (p_league_id, v_claim.drop_player_id, v_drop_state, v_drop_until, p_at)
      ON CONFLICT (league_id, player_id) DO UPDATE
        SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
    END IF;

    -- the add — the bench, a waiver acquisition at the price paid
    BEGIN
      INSERT INTO public.league_rosters
        (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
      VALUES (p_league_id, v_claim.team_id, v_claim.add_player_id, 'bn', 'waiver', v_spent, p_at);
    EXCEPTION WHEN unique_violation THEN
      -- Unreachable while the league row lock is held (the resolver saw him
      -- unowned under it); kept so a raw 23505 never escapes.
      RAISE EXCEPTION 'process_waivers: % (%) is already rostered in league % — a player is on ONE roster per league (player exclusivity, §12.7); refusing',
        COALESCE(v_add_p.full_name, v_claim.add_player_id), v_claim.add_player_id, p_league_id
        USING ERRCODE = 'P0001';
    END;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league_id, v_claim.add_player_id, 'rostered', NULL, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;

    -- THE LINEUP INTERPLAY (TD10) — 149's loop (roster_add_drop_internal
    -- §THE LINEUP CONSEQUENCES), copied for this team, add and drop; from
    -- the first UNFINISHED week (152 / F437 — a Tuesday run lands exactly
    -- between a week's last game and the next week's start).
    FOR v_row IN
      SELECT tl.* FROM public.team_lineups tl
      WHERE tl.team_id = v_claim.team_id AND tl.season = v_league.season AND tl.week >= v_from_week
      ORDER BY tl.week
      FOR UPDATE
    LOOP
      v_map := COALESCE(v_row.slot_map, '{}'::jsonb);
      v_starters := COALESCE(v_row.starters, '[]'::jsonb);
      v_bench := COALESCE(v_row.bench, '[]'::jsonb);
      v_changed := FALSE;
      v_key := NULL;
      IF v_claim.drop_player_id IS NOT NULL THEN
        SELECT e.key INTO v_key FROM jsonb_each_text(v_map) e WHERE e.value = v_claim.drop_player_id LIMIT 1;
        IF v_key IS NOT NULL THEN
          v_map := v_map - v_key;
          SELECT COALESCE(jsonb_agg(
                   CASE WHEN s ->> 'slot' = v_key
                        THEN s || jsonb_build_object('player_id', NULL, 'position', NULL, 'kickoff_at', NULL, 'flags', '["empty"]'::jsonb)
                        ELSE s END ORDER BY ord), '[]'::jsonb)
          INTO v_starters
          FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord);
          v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', v_key);
          v_changed := TRUE;
        END IF;
        IF v_bench ? v_claim.drop_player_id THEN
          SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
          FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') <> v_claim.drop_player_id;
          IF v_key IS NULL THEN
            v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', NULL);
          END IF;
          v_changed := TRUE;
        END IF;
      END IF;
      IF NOT (v_bench ? v_claim.add_player_id) THEN
        SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
        FROM jsonb_array_elements(v_bench || to_jsonb(v_claim.add_player_id)) x;
        v_changed := TRUE;
      END IF;
      IF v_changed THEN
        UPDATE public.team_lineups SET slot_map = v_map, starters = v_starters, bench = v_bench
        WHERE id = v_row.id;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION 'process_waivers: lineup sync for week % touched % rows, expected 1', v_row.week, v_cnt USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;

    -- the money (FAAB only — a priority league spends nothing, §13.2)
    v_before := NULL;
    v_after := NULL;
    IF v_type = 'faab' THEN
      UPDATE public.league_members m
      SET faab_balance = m.faab_balance - v_spent
      WHERE m.league_id = p_league_id AND m.team_id = v_claim.team_id
      RETURNING m.faab_balance + v_spent, m.faab_balance INTO v_before, v_after;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 OR v_after IS NULL OR v_after < 0 THEN
        RAISE EXCEPTION 'process_waivers: debiting $% from team %''s seat touched % rows (balance after %) — refusing (TD2)', v_spent, v_claim.team_id, v_cnt, v_after
          USING ERRCODE = 'P0001';
      END IF;
      v_faab_spent := v_faab_spent + v_spent;
    END IF;

    -- ONE transactions row (TD9; F416: 113's add / drop name objects)
    INSERT INTO public.transactions (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
    VALUES (v_txn_id, p_league_id, 'waiver_claim', 'complete', v_claim.team_id, v_claim.created_by,
      jsonb_build_object(
        'transaction_id', v_txn_id,
        'league_id',      p_league_id,
        'team_id',        v_claim.team_id,
        'season',         v_league.season,
        'week',           v_current,
        'type',           'waiver_claim',
        'claim_id',       v_claim.id,
        'run_at',         v_run_at,
        'decision',       (v_o ->> 'decision')::int,
        'waiver_type',    v_type,
        'add_player_id',  v_claim.add_player_id,
        'drop_player_id', v_claim.drop_player_id,
        'faab_bid',       v_spent,
        'faab_before',    v_before,
        'faab_after',     v_after,
        'add', jsonb_build_object(
          'player_id',        v_claim.add_player_id,
          'name',             v_add_p.full_name,
          'position',         v_add_p.position,
          'nfl_team',         v_add_p.team,
          'from_state',       v_pool_from,
          'to_state',         'rostered',
          'acquisition_type', 'waiver',
          'slot_key',         'bn',
          'acquired_at',      p_at),
        'drop', CASE WHEN v_claim.drop_player_id IS NULL THEN NULL ELSE jsonb_build_object(
          'player_id',     v_claim.drop_player_id,
          'name',          v_drop_p.full_name,
          'position',      v_drop_p.position,
          'nfl_team',      v_drop_p.team,
          'from_slot_key', v_drop_row.slot_key,
          'to_state',      v_drop_state,
          'waivers_until', v_drop_until,
          'fa_hold', jsonb_build_object(
            'hours',            v_hold_hours,
            'acquisition_type', v_drop_row.acquisition_type,
            'acquired_at',      v_drop_row.acquired_at,
            'early',            v_hold_early),
          'lineups',       v_lineups) END,
        'evaluated_at',   p_at),
      v_current, NULL);

    UPDATE public.waiver_claims c
    SET status = 'won', result_reason = NULL, processed_at = p_at, process_at = v_run_at
    WHERE c.id = v_claim.id AND c.status = 'pending';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'process_waivers: settling won claim % touched % rows, expected 1', v_claim.id, v_cnt USING ERRCODE = 'P0001';
    END IF;
    IF public.waiver_claim_notify_internal(v_league, v_claim, 'won', NULL,
         jsonb_build_object('run_at', v_run_at, 'transaction_id', v_txn_id, 'faab_before', v_before, 'faab_after', v_after,
                            'winner_team_id', v_claim.team_id, 'winning_bid', v_spent)) IS NOT NULL THEN
      v_notified := v_notified + 1;
    END IF;
  END LOOP;

  IF v_n <> jsonb_array_length(v_claims) THEN
    RAISE EXCEPTION 'process_waivers: the run decided % of % pending claims — every claim is decided exactly once; refusing', v_n, jsonb_array_length(v_claims)
      USING ERRCODE = 'P0001';
  END IF;

  -- the persisting order (F421(d)): 1-based, every active seat
  IF (v_result #>> '{priority,persists}')::boolean THEN
    UPDATE public.league_members m
    SET waiver_priority = a.o::int
    FROM jsonb_array_elements_text(v_result #> '{priority,after}') WITH ORDINALITY AS a(t, o)
    WHERE m.league_id = p_league_id AND m.team_id = a.t::uuid AND m.waiver_priority IS DISTINCT FROM a.o::int;
    SELECT count(*)::int INTO v_cnt
    FROM jsonb_array_elements_text(v_result #> '{priority,after}') WITH ORDINALITY AS a(t, o)
    JOIN public.league_members m ON m.league_id = p_league_id AND m.team_id = a.t::uuid AND m.waiver_priority = a.o::int;
    IF v_cnt <> jsonb_array_length(v_result #> '{priority,after}') THEN
      RAISE EXCEPTION 'process_waivers: writing the rolling order left % of % seats at their place — a franchise in the order has no seat; refusing', v_cnt, jsonb_array_length(v_result #> '{priority,after}')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (6) ASSERTED, NOT TRUSTED — the tables now say what the resolver said.
  FOR v_t IN SELECT e FROM jsonb_array_elements(v_result -> 'teams') e LOOP
    IF COALESCE((SELECT jsonb_agg(r.player_id ORDER BY r.player_id COLLATE "C") FROM public.league_rosters r
                 WHERE r.league_id = p_league_id AND r.team_id = (v_t ->> 'teamId')::uuid), '[]'::jsonb) <> v_t -> 'rosterAfter' THEN
      RAISE EXCEPTION 'process_waivers: team %''s roster after the run is not the one the run decided (%) — refusing', v_t ->> 'teamId', v_t -> 'rosterAfter'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_type = 'faab' AND jsonb_typeof(v_t -> 'faabAfter') = 'number'
       AND (SELECT m.faab_balance FROM public.league_members m
            WHERE m.league_id = p_league_id AND m.team_id = (v_t ->> 'teamId')::uuid) IS DISTINCT FROM (v_t ->> 'faabAfter')::int THEN
      RAISE EXCEPTION 'process_waivers: team %''s FAAB after the run is not the $% the run decided — refusing (TD2)', v_t ->> 'teamId', v_t ->> 'faabAfter'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (7) THE NEXT RUN, and the run log (exactly once).
  v_next := public.waiver_next_run_internal(v_sched, p_at);
  UPDATE public.leagues SET waiver_next_run_at = v_next WHERE id = p_league_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'process_waivers: advancing league %''s next run touched % rows, expected 1', p_league_id, v_cnt USING ERRCODE = 'P0001';
  END IF;

  v_summary := jsonb_build_object(
    'league_id',    p_league_id,
    'status',       'settled',
    'run_at',       v_run_at,
    'processed_at', p_at,
    'next_run_at',  v_next,
    'week',         v_current,
    'waiver_type',  v_type,
    'claims',       v_n,
    'won',          v_won,
    'lost',         v_lost,
    'invalid',      v_invalid,
    'faab_spent',   v_faab_spent,
    'notified',     v_notified,
    'priority',     jsonb_build_object('source', v_result #> '{priority,source}', 'persists', v_result #> '{priority,persists}'),
    'why',          CASE WHEN v_n = 0 THEN 'no_pending_claims — the run was due and settled with nothing to decide' END,
    'evaluated_at', p_at);

  INSERT INTO public.waiver_runs AS w (league_id, run_at, status, processed_at, attempts, input, result, summary, last_error, updated_at)
  VALUES (p_league_id, v_run_at, 'settled', p_at, 1, v_input, v_result, v_summary, NULL, p_at)
  ON CONFLICT (league_id, run_at) DO UPDATE
    SET status = 'settled', processed_at = EXCLUDED.processed_at, attempts = w.attempts + 1,
        input = EXCLUDED.input, result = EXCLUDED.result, summary = EXCLUDED.summary, updated_at = EXCLUDED.updated_at
    WHERE w.status = 'refused'
  RETURNING w.id INTO v_run_id;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'process_waivers: the waiver run at % for league % was already settled — a run is settled exactly once (TD6); refusing', v_run_at, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_summary || jsonb_build_object('run_id', v_run_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- waiver_claim_notify_internal — 150:583-677 FILE TEXT (D137), 3 hunks (+1 / -6).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_notify_internal(
  p_league public.leagues,
  p_claim  public.waiver_claims,
  p_status TEXT,
  p_reason TEXT,
  p_extra  JSONB    -- {winner_team_id, winning_bid, faab_before, faab_after, transaction_id, run_at}
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_team      public.teams;
  v_live      public.teams;
  v_user      UUID;
  v_add       TEXT;
  v_drop      TEXT;
  v_winner    TEXT;
  v_faab      BOOLEAN := COALESCE(p_league.waiver_type, 'faab') = 'faab';
  v_title     TEXT;
  v_body      TEXT;
BEGIN
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_claim.team_id;
  v_live := v_team;
  SELECT m.user_id INTO v_user
  FROM public.league_members m
  WHERE m.league_id = p_league.id AND m.team_id = v_live.id AND m.user_id IS NOT NULL;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.full_name INTO v_add FROM public.players p WHERE p.id = p_claim.add_player_id;
  v_add := COALESCE(v_add, p_claim.add_player_id);
  IF p_claim.drop_player_id IS NOT NULL THEN
    SELECT p.full_name INTO v_drop FROM public.players p WHERE p.id = p_claim.drop_player_id;
    v_drop := COALESCE(v_drop, p_claim.drop_player_id);
  END IF;
  SELECT t.name INTO v_winner FROM public.teams t WHERE t.id = (p_extra ->> 'winner_team_id')::uuid;

  IF p_status = 'won' THEN
    v_title := 'Waiver claim won: ' || v_add;
    v_body := 'You claimed ' || v_add
      || CASE WHEN v_faab THEN ' for $' || p_claim.faab_bid ELSE '' END
      || CASE WHEN v_drop IS NOT NULL THEN ', dropping ' || v_drop ELSE '' END
      || '. He is on your bench.'
      || CASE WHEN v_faab THEN ' FAAB left: $' || (p_extra ->> 'faab_after') || '.' ELSE '' END;
  ELSIF p_status = 'lost' THEN
    v_title := 'Waiver claim lost: ' || v_add;
    v_body := v_add || ' went to ' || COALESCE(v_winner, 'another team')
      || CASE WHEN p_reason = 'outbid' THEN
                CASE WHEN v_faab THEN ' for $' || (p_extra ->> 'winning_bid') || ' — you bid $' || p_claim.faab_bid ELSE '' END
              ELSE CASE WHEN v_faab THEN ' at the same bid of $' || p_claim.faab_bid || ', on waiver priority' ELSE ' on waiver priority' END
         END
      || '. Nothing was spent.';
  ELSE
    v_title := 'Waiver claim didn''t go through: ' || v_add;
    v_body := CASE p_reason
      WHEN 'team_retired'      THEN v_team.name || ' was retired before waivers ran, so its claim for ' || v_add
                                    || ' was dropped. Put in a new claim for ' || v_live.name || ' if you still want him.'
      WHEN 'add_rostered'      THEN v_add || ' was already on a roster when waivers ran.'
      WHEN 'add_locked'        THEN v_add || '''s game had already started when waivers ran — a player is locked from kickoff until the week''s last game ends.'
      WHEN 'drop_gone'         THEN v_drop || ' was no longer on your roster when waivers ran, so the claim for ' || v_add || ' could not drop him.'
      WHEN 'drop_locked'       THEN v_drop || '''s game had already started when waivers ran — a player who has kicked off can''t be dropped, so the claim for ' || v_add || ' failed.'
      WHEN 'roster_full'       THEN 'Your roster was full when the claim for ' || v_add || ' came up — add a drop to the claim next time.'
      WHEN 'cap_reached'       THEN 'You had used all your pickups allowed (the league''s acquisition limit) when the claim for ' || v_add || ' came up.'
      WHEN 'insufficient_faab' THEN 'Your bid of $' || p_claim.faab_bid || ' for ' || v_add || ' was more than the FAAB you had left when it came up ($'
                                    || COALESCE(p_extra ->> 'faab_before', '?') || ').'
      WHEN 'own_claim_won'     THEN 'You won ' || v_add || ' with another of your claims, so this one wasn''t needed.'
      WHEN 'no_waivers'        THEN 'This league switched to no waivers, so pending claims were closed. ' || v_add || ' can be added directly if he is still available.'
      ELSE 'The claim for ' || v_add || ' could not go through (' || COALESCE(p_reason, 'unknown') || ').'
    END || ' Nothing was spent.';
  END IF;

  PERFORM public.notify_league_member_internal(
    v_user, 'league_waiver_claim', v_title, v_body,
    jsonb_build_object(
      'league_id',      p_league.id,
      'team_id',        p_claim.team_id,
      'claim_id',       p_claim.id,
      'status',         p_status,
      'reason',         p_reason,
      'add_player_id',  p_claim.add_player_id,
      'drop_player_id', p_claim.drop_player_id,
      'faab_bid',       CASE WHEN v_faab THEN p_claim.faab_bid END,
      'run_at',         p_extra -> 'run_at',
      'transaction_id', p_extra -> 'transaction_id',
      'winner_team_id', p_extra -> 'winner_team_id',
      'winning_bid',    CASE WHEN v_faab THEN p_extra -> 'winning_bid' END));
  RETURN v_user;
END;
$$;

-- ---------------------------------------------------------------------------
-- waiver_priority_seed_internal — 163:149-263 FILE TEXT (D137), 3 hunks (+1 / -7).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_priority_seed_internal(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_type      TEXT;
  v_tb        TEXT;
  v_draft_raw JSONB;
  v_x         JSONB;
  v_live      public.teams;
  v_mapped    TEXT[] := '{}';
  v_order     TEXT[];
  v_active    TEXT[];
  v_seated    INTEGER;
  v_cnt       INTEGER;
BEGIN
  IF p_league_id IS NULL THEN
    RAISE EXCEPTION 'waiver_priority_seed: p_league_id is required' USING ERRCODE = '22023';
  END IF;

  -- the league row first (the processor's lock order)
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'skipped',
      'why', 'league_not_found — no live league has this id');
  END IF;

  -- (a) the statuses the processor runs in
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'not_in_season',
      'why', 'not_in_season — the league is ' || v_league.status || '; the order is stored when the draft completes');
  END IF;

  -- (b) the processor's own v_persists (160:330-331), the same fallback
  v_type := COALESCE(v_league.waiver_type, 'faab');
  v_tb := COALESCE(v_league.settings ->> 'faab_tiebreaker', 'rolling_priority');
  IF NOT (v_type = 'rolling_priority' OR (v_type = 'faab' AND v_tb = 'rolling_priority')) THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'not_rolling',
      'why', 'not_rolling — waiver type ' || v_type
             || CASE WHEN v_type = 'faab' THEN ' with tiebreaker ' || v_tb ELSE '' END
             || ' decides by the standings (or has no waivers); no order is stored');
  END IF;

  -- (c) never re-seed over a stored order
  SELECT count(*)::int INTO v_cnt
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.waiver_priority IS NOT NULL;
  IF v_cnt > 0 THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'kept',
      'why', 'kept — ' || v_cnt || ' seat(s) already store the order; it rolls with each waiver run and is never re-seeded');
  END IF;

  -- (d) the round-1 order as drafted — 160:367-380's selection, exactly
  SELECT d.draft_order INTO v_draft_raw
  FROM public.drafts d
  WHERE d.league_id = p_league_id AND NOT d.is_mock AND d.status = 'complete'
  ORDER BY d.completed_at DESC NULLS LAST, d.id
  LIMIT 1;
  IF NOT FOUND OR v_draft_raw IS NULL OR jsonb_typeof(v_draft_raw) <> 'array' THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'no_draft',
      'why', 'no_draft — the league has no complete draft with a draft order; its first waiver run decides the order');
  END IF;
  FOR v_x IN SELECT e FROM jsonb_array_elements(v_draft_raw) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = (v_x #>> '{}')::uuid;
    v_mapped := v_mapped || COALESCE(v_live.id::text, v_x #>> '{}');
  END LOOP;
  SELECT COALESCE(array_agg(u.t ORDER BY u.o DESC), '{}') INTO v_order
  FROM unnest(v_mapped) WITH ORDINALITY AS u(t, o);          -- REVERSE draft order

  -- (e) exactly the active franchises, each with its seat (assertPermutation)
  SELECT COALESCE(array_agg(t.id::text ORDER BY t.id::text COLLATE "C"), '{}') INTO v_active
  FROM public.teams t WHERE t.league_id = p_league_id;
  IF cardinality(v_order) <> (SELECT count(DISTINCT u) FROM unnest(v_order) u)
     OR (SELECT array_agg(u ORDER BY u COLLATE "C") FROM unnest(v_order) u) IS DISTINCT FROM v_active
     OR cardinality(v_active) = 0 THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'unseedable',
      'why', 'unseedable — the draft order (' || cardinality(v_order) || ' entries) does not list exactly the league''s '
             || cardinality(v_active) || ' active franchises; nothing stored, the first waiver run judges it',
      'draft_order', to_jsonb(v_order), 'active', to_jsonb(v_active));
  END IF;
  SELECT count(*)::int INTO v_seated
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id::text = ANY (v_active);
  IF v_seated <> cardinality(v_active) THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'unseedable',
      'why', 'unseedable — ' || v_seated || ' of ' || cardinality(v_active)
             || ' active franchises have a seat row; nothing stored, the first waiver run judges it');
  END IF;

  UPDATE public.league_members m
  SET waiver_priority = a.o::int
  FROM unnest(v_order) WITH ORDINALITY AS a(t, o)
  WHERE m.league_id = p_league_id AND m.team_id = a.t::uuid;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> cardinality(v_order) THEN
    RAISE EXCEPTION 'waiver_priority_seed: storing league %''s order wrote % of % seats — refusing', p_league_id, v_cnt, cardinality(v_order)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('league_id', p_league_id, 'status', 'seeded',
    'source', 'reverse_draft_order', 'order', to_jsonb(v_order),
    'why', 'seeded — the order is reverse draft order from the draft''s end (Q72); a team moves to the back only when it wins a claim');
END;
$$;

-- ---------------------------------------------------------------------------
-- remove_manager — 176:87-407 FILE TEXT (D137), 10 hunks (+11 / -71).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_manager(
  p_league_id UUID,
  p_member_id UUID,
  p_mode TEXT,
  p_successor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_action_id UUID DEFAULT NULL      -- 199: unused (it was the retire arm's stamp); kept so the signature and every caller stay
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_target RECORD;
  v_actor_role TEXT;
  v_team RECORD;
  v_removed_user UUID;
  v_team_name TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'remove_manager: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'remove_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.id, l.name, l.owner_id, l.faab_budget, l.status, l.season INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- RE-GATE UNDER THE LOCK (R93) — see add_placeholder_seat. Also the ACTOR's
  -- exact role, which the creator anti-coup guard below keys on: a stale
  -- actor reading 'manager' would sail past a guard written for
  -- 'co_commissioner'.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('commissioner', 'co_commissioner') THEN
    RAISE EXCEPTION 'remove_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('takeover', 'vacate') THEN
    RAISE EXCEPTION 'remove_manager: mode must be takeover or vacate (§7.2.1)'
      USING ERRCODE = '22023';
  END IF;

  SELECT lm.id, lm.user_id, lm.team_id, lm.role INTO v_target
  FROM public.league_members lm
  WHERE lm.id = p_member_id AND lm.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: no such member in this league'
      USING ERRCODE = '42501';
  END IF;

  -- §7.2 anti-coup (keyed on the CREATOR, not on role).
  IF v_actor_role = 'co_commissioner'
     AND v_target.user_id IS NOT NULL
     AND v_target.user_id = v_league.owner_id THEN
    RAISE EXCEPTION 'remove_manager: only the commissioner can remove the league creator (§7.2)'
      USING ERRCODE = '42501';
  END IF;

  -- Never leave the league headless (§7.2 "Exactly one commissioner").
  IF v_target.role = 'commissioner' THEN
    RAISE EXCEPTION 'remove_manager: transfer the commissioner role to another member before removing this manager (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 120 (R855): an UNMANAGED seat refuses takeover here as 063 wrote it and
  -- vacate stays idempotent.
  IF v_target.user_id IS NULL THEN
    IF p_mode = 'vacate' THEN
      -- Idempotent (D63): the seat is already an open placeholder.
      RETURN jsonb_build_object(
        'ok', true, 'mode', p_mode, 'member_id', v_target.id,
        'team_id', v_target.team_id, 'already_vacant', true);
    END IF;
    RAISE EXCEPTION 'remove_manager: that seat has no manager — use assign-manager to seat someone on it'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_target.team_id IS NULL THEN
    RAISE EXCEPTION 'remove_manager: that membership has no franchise to act on'
      USING ERRCODE = 'P0001';
  END IF;

  -- teams AFTER leagues (lock order).
  SELECT t.id, t.name, t.status INTO v_team
  FROM public.teams t
  WHERE t.id = v_target.team_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: that membership has no franchise to act on'
      USING ERRCODE = 'P0001';
  END IF;

  v_removed_user := v_target.user_id;
  v_team_name := v_team.name;

  IF p_mode = 'takeover' THEN
    IF p_successor_user_id IS NULL THEN
      RAISE EXCEPTION 'remove_manager: takeover requires successor_user_id (§15.1)'
        USING ERRCODE = '22023';
    END IF;
    IF p_successor_user_id = v_removed_user THEN
      RAISE EXCEPTION 'remove_manager: the successor must be a different manager — use vacate to open the seat'
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM public.profiles p WHERE p.id = p_successor_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'remove_manager: no such FieldScout account for the successor'
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM public.league_members lm
    WHERE lm.league_id = p_league_id AND lm.user_id = p_successor_user_id;
    IF FOUND THEN
      RAISE EXCEPTION 'remove_manager: the successor already has a team in this league'
        USING ERRCODE = 'P0001';
    END IF;

    -- CLOSE BEFORE OPEN, same txn (F3). A missing open stint is a no-op,
    -- not an error (D63 — a retry after a partially-observed removal).
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = NULL,            -- preseason (§12.22)
        end_reason = 'replaced',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- The cache row is UPDATEd IN PLACE — one league_members row per seat,
    -- always (§12.2). 146 (L.D2.6 / C72): faab re-seeded from the CURRENT
    -- budget only BEFORE the draft starts (v2.8.7 — balances track the
    -- budget until then); from `drafting` on the balance belongs to the
    -- franchise and the successor inherits it (§7.2.1(a) "inherits the
    -- franchise whole: … FAAB balance").
    UPDATE public.league_members
    SET user_id = p_successor_user_id,
        is_placeholder = FALSE,
        role = 'manager',             -- powers never inherit with a seat
        faab_balance = CASE WHEN v_league.status IN ('setup', 'scheduled')
                            THEN v_league.faab_budget ELSE faab_balance END
    WHERE id = v_target.id;

    -- Successor's stint (clock_timestamp — F3: never reuses a started_at).
    INSERT INTO public.team_managers (league_id, team_id, user_id, role, started_at)
    VALUES (p_league_id, v_team.id, p_successor_user_id, 'manager', clock_timestamp());

    UPDATE public.teams
    SET owner_id = p_successor_user_id,
        status = CASE WHEN status = 'orphaned' THEN 'active' ELSE status END,
        updated_at = now()
    WHERE id = v_team.id;
  ELSE
    -- vacate (§7.2.1(c)) — the stint closes with no successor.
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = NULL,
        end_reason = 'kicked',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- 146 (L.D2.6 / C72): the open seat keeps the franchise's balance once
    -- the draft has started (the next manager inherits it through the seat
    -- fill); before the draft it re-seeds from the CURRENT budget (v2.8.7).
    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,        -- back to an open seat, team_id KEPT
        role = 'manager',
        faab_balance = CASE WHEN v_league.status IN ('setup', 'scheduled')
                            THEN v_league.faab_budget ELSE faab_balance END
    WHERE id = v_target.id;

    -- 'orphaned': the team lives on with no manager.
    -- owner_id moves to the acting commissioner (NOT NULL; leaving it on the
    -- removed user would let their profile deletion CASCADE the franchise).
    UPDATE public.teams
    SET status = 'orphaned',
        owner_id = v_uid,
        updated_at = now()
    WHERE id = v_team.id;

    -- 150 / F411 — §7.2.1(c): "pending waiver claims cancel". The removed
    -- manager's claims do not wait for whoever fills the seat next; the
    -- commissioner (who runs the orphaned team) can place new ones.
    -- (063's seven-key result is pinned byte for byte by pgTAP 068 I1/I3 —
    -- the cancellations are recorded on the claim rows, not in the result.)
    UPDATE public.waiver_claims c
    SET status = 'cancelled', result_reason = 'seat_vacated', cancelled_at = now(), cancelled_by = v_uid
    WHERE c.team_id = v_team.id AND c.status = 'pending';
  END IF;

  -- BOTH arms (R90): the removed user may own OTHER franchises in this league
  -- — every placeholder seat they minted while holding a commissioner role
  -- carries `owner_id = <them>` (add_placeholder_seat, item 3), as does every
  -- franchise they orphaned by vacating someone. Moving only THEIR OWN seat
  -- above would leave those owned by a proven non-member on
  -- `teams.owner_id REFERENCES profiles(id) ON DELETE CASCADE` (001:495):
  -- deleting that account would destroy the franchises outright AND — because
  -- `league_members.team_id` is ON DELETE SET NULL (052:67) — leave their
  -- cache rows with `team_id` NULL, a seat with no franchise, invisible to
  -- EVERY capacity count in the build. That is the exact shape the S2 policy
  -- removal / erratum v2.8.8 / D74(3) exists to make unrepresentable. The
  -- acting commissioner is the same recipient the vacate arm already uses.
  UPDATE public.teams
  SET owner_id = v_uid,
      updated_at = now()
  WHERE league_id = p_league_id
    AND owner_id = v_removed_user
    AND id <> v_team.id;

  -- 169/L.E1.30 (F32) — THE RECEIPT, one per removal, the outcome NAMED
  -- (§7.2.1: takeover / vacate). before / after are the seat as it stood
  -- and as it stands now (read back, never inferred).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'remove_manager',
    CASE p_mode WHEN 'takeover' THEN 'replace_manager'
                ELSE 'vacate_seat' END,
    'team', v_team.id::text, p_reason,
    jsonb_build_object('manager_user_id', v_removed_user, 'team_status', v_team.status),
    jsonb_build_object(
      'manager_user_id', (SELECT lm.user_id FROM public.league_members lm WHERE lm.id = v_target.id),
      'team_status',     (SELECT t.status FROM public.teams t WHERE t.id = v_team.id)),
    jsonb_build_object('mode', p_mode, 'member_id', v_target.id, 'team_name', v_team_name,
                       'affected_team_ids', jsonb_build_array(v_team.id)));

  -- §7.2.1:190 — the removed user is notified with the outcome category.
  -- Takeover and vacate always carry a user here (refused above otherwise).
  IF v_removed_user IS NOT NULL THEN
  PERFORM public.notify_league_member_internal(
    v_removed_user,
    'league_member',
    'You were removed from ' || v_league.name,
    CASE WHEN p_mode = 'takeover'
      THEN v_team_name || ' has a new manager. Your record with the franchise stays in its history.'
      ELSE 'Your seat in ' || v_league.name || ' (' || v_team_name || ') was closed by the commissioner.'
    END,
    jsonb_build_object(
      'league_id', p_league_id,
      'team_id', v_team.id,
      'event', CASE WHEN p_mode = 'takeover' THEN 'replaced' ELSE 'removed' END));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'mode', p_mode, 'member_id', v_target.id,
    'team_id', v_team.id, 'removed_user_id', v_removed_user,
    'successor_user_id', CASE WHEN p_mode = 'takeover' THEN p_successor_user_id ELSE NULL END,
    'already_vacant', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- assign_manager — 169:509-636 FILE TEXT (D137), 1 hunk (+0 / -4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_manager(
  p_league_id UUID,
  p_team_id UUID,
  p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_actor_role TEXT;
  v_team RECORD;
  v_open_stint UUID;
  v_existing RECORD;
  v_member_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'assign_manager: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'assign_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.id, l.faab_budget INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_manager: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- RE-GATE UNDER THE LOCK (R93) — see add_placeholder_seat.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('commissioner', 'co_commissioner') THEN
    RAISE EXCEPTION 'assign_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'assign_manager: user_id is required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_manager: no such FieldScout account'
      USING ERRCODE = 'P0001';
  END IF;

  -- teams AFTER leagues (lock order), scoped to this league (R86).
  SELECT t.id, t.status INTO v_team
  FROM public.teams t
  WHERE t.id = p_team_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_manager: that franchise is not part of this league'
      USING ERRCODE = 'P0001';
  END IF;

  -- Already seated somewhere in this league? UNIQUE(league_id, user_id)
  -- would otherwise surface as an opaque 23505.
  SELECT lm.id, lm.team_id INTO v_existing
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = p_user_id;
  IF FOUND THEN
    IF v_existing.team_id = p_team_id THEN
      -- Idempotent (D63): already this franchise's manager.
      RETURN jsonb_build_object(
        'member_id', v_existing.id, 'team_id', p_team_id, 'already_seated', true);
    END IF;
    RAISE EXCEPTION 'assign_manager: that manager already has a team in this league — remove them from it first'
      USING ERRCODE = 'P0001';
  END IF;

  -- An occupied seat is never silently taken over: that would close the
  -- incumbent's stint with no outcome category and no notification.
  SELECT tm.id INTO v_open_stint
  FROM public.team_managers tm
  WHERE tm.team_id = p_team_id AND tm.ended_at IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'assign_manager: that franchise already has a manager — remove them first (§7.2.1 takeover/vacate)'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    -- The ONE seating implementation (062, p_team_id path): stint first,
    -- placeholder FILL, owner_id + orphan resolution, faab re-seeded from
    -- the CURRENT budget.
    PERFORM public.seat_league_member_internal(
      p_league_id, p_user_id, v_league.faab_budget, p_team_id);
  EXCEPTION WHEN unique_violation THEN
    -- Lost the race against an in-flight claim on the same franchise (I6):
    -- friendly, never a raw 23505 → 500.
    RAISE EXCEPTION 'assign_manager: that seat was just claimed by someone else — refresh and try again'
      USING ERRCODE = 'P0001';
  END;

  SELECT lm.id INTO v_member_id
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = p_user_id;

  -- 169/L.E1.30 (F32) — THE RECEIPT: who now manages the franchise. `before`
  -- is the seat as the checks above proved it (no open stint — no manager).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'assign_manager', 'assign_manager', 'team',
    p_team_id::text, NULL,
    jsonb_build_object('manager_user_id', NULL, 'team_status', v_team.status),
    jsonb_build_object('manager_user_id', p_user_id,
                       'team_status', (SELECT t.status FROM public.teams t WHERE t.id = p_team_id)),
    jsonb_build_object('member_id', v_member_id,
                       'team_name', (SELECT t.name FROM public.teams t WHERE t.id = p_team_id),
                       'affected_team_ids', jsonb_build_array(p_team_id)));

  RETURN jsonb_build_object(
    'member_id', v_member_id, 'team_id', p_team_id, 'already_seated', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- commish_edit_lineup_internal — 170:341-1209 FILE TEXT (D137), 3 hunks (+3 / -7).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week (165 / F497: per PLAYER — 157's lineup_player_kickoff_internal; 164's receipt map folded in)
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  -- NEW in 123 (the differences)
  v_audit_id    UUID;
  v_bypassed    JSONB := '[]'::jsonb;   -- every lock/stint gate this edit walked past, NAMED
  v_moved_lock  JSONB := '[]'::jsonb;   -- the players a manager could not have moved
  v_old_start   TEXT[] := ARRAY[]::text[];
  v_rescore     TEXT[] := ARRAY[]::text[];
  v_enqueued    JSONB := '[]'::jsonb;
  v_not_enq     JSONB := '[]'::jsonb;   -- rescore players with NO queue row, each with its reason
  v_unstamped   TEXT[] := ARRAY[]::text[];
  v_score_stale BOOLEAN;
  v_stale_why   TEXT;
  v_before      JSONB;
  -- 154 / F441 (R1209): stored STARTERS off this roster whom the week keeps
  -- (player_id → {kickoff_at, datum_arm, on_bye}).
  v_gone_kick   JSONB := '{}'::jsonb;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'commish_edit_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every other
  --     row lock in this body comes after it — reversing them would invert the
  --     lock order against every other league RPC.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH — COMMISSIONER ONLY (difference (C)). A manager, including this
  --     team's own manager, uses `set_lineup`; this verb is the exception
  --     path and it is audited. One no-leak 42501 for "no such league" and
  --     "not a commissioner" alike.
  v_found := FOUND;
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_edit_lineup: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written. Placed BEFORE every
  -- business gate exactly as 114:250-257 places it, so a retry replays even
  -- when the league or the week has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % is % — a lineup has no meaning outside a season (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_edit_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % has no season schedule yet, so there is no week to set a lineup in',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'commish_edit_lineup: week % is not on league %''s schedule for season % (it runs weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  -- DIFFERENCE (B): 114:293-305's past-week and closed-week refusals are NOT
  -- copied. Both of them say, in their own text, that the change goes
  -- "through the audited commissioner override (§11.2, M6)". This is it.
  -- §11.2:730: "Commissioner can edit any lineup, including retroactively and
  -- past lock (audited)."
  IF p_week < v_current THEN
    v_bypassed := v_bypassed || to_jsonb('past_week'::text);
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    v_bypassed := v_bypassed || to_jsonb(('closed_week:' || v_lw.status)::text);
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- DIFFERENCE (D), RE-READ UNDER Q66 (migration 131 / L.E1.15, PROGRESS
  -- F362; spec v2.16.41 §10.3 / §15.4): the reason is OPTIONAL. It is
  -- NORMALISED here, never refused — absent or nothing but whitespace in the
  -- explicit E' \t\r\n' class (R745) ⇒ NULL, which 130 §0's column change
  -- stores; otherwise trimmed and bounded at 500 below (the league_chat
  -- bound, R746, and the table CHECK's). The 500 check is NULL-safe as
  -- written (char_length(NULL) > 500 is NULL, and IF NULL does not fire).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_edit_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged). Verbatim 114:329-349 — the DST
  --     normalisation is what `lineup_fit_internal`'s eligibility test matches
  --     on, so a defense is unplaceable without it.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'commish_edit_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots (verbatim 114:350-370). The
  -- canonical order of v_slots IS the order starters[] is emitted in.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commish_edit_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);
  -- The `before` image the audit row carries — captured before anything moves.
  v_before := jsonb_build_object(
    'slot_map', v_stored, 'starters', COALESCE(v_row.starters, '[]'::jsonb),
    'bench', COALESCE(v_row.bench, '[]'::jsonb), 'locked_at', v_row.locked_at,
    'edited_by_commish', v_row.edited_by_commish, 'set_at', v_row.set_at);

  -- (4b) 154 / F441 (R1209) — A START THE WEEK KEEPS IS NOT ERASED BY A FIX.
  --      A stored STARTING slot whose player has left this roster since — a
  --      player who played, or whose week closed to moves before he left
  --      (lineup_kept_starter_internal: the ONE judgment set_lineup (4b) and
  --      autopilot share — F442 / F445) — is the week's record: 152 / 153
  --      keep it there, and the week is scored from it. The editor never
  --      holds an unrostered player (placementFromStored), so an OMITTED key
  --      is CARRIED, never read as "empty it", and a submit that names him at
  --      his key is accepted (131's roster check refused it — so any
  --      commissioner fix to that week silently dropped his points). The
  --      commissioner still walks past the lock (difference (A)): a submit
  --      that gives his key to someone else, or seats him at another key,
  --      does exactly that and is recorded in locked_players_moved. An IR
  --      spot is roster state, so it is refused for him. He joins v_by_pid
  --      (never v_roster: no bench, no roster write).
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',          p.id,
             'name',               p.full_name,
             'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation',        public.lineup_designation_internal(p.status),
             'nfl_team',           p.team,
             'ir_placed_week',     NULL,
             'ir_lock_until_week', NULL,
             'slot_key',           NULL,
             'off_roster',         TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(v_league.season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;   -- a bye / a game gone from the week: the slot opens, as before
    IF EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x
               WHERE (x.value #>> '{}') = v_pid
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = x.key)) THEN
      RAISE EXCEPTION
        'commish_edit_lineup: % has left %''s roster — an IR spot holds only a rostered player (§11.2); his week-% start at "%" can stay, move or be removed, never go to IR',
        v_e ->> 'name', v_team.name, p_week, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_gone_kick := v_gone_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF NOT (p_slot_map ? v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE (x.value #>> '{}') = v_pid) THEN
      p_slot_map := p_slot_map || jsonb_build_object(v_key, v_pid);   -- carried
    END IF;
  END LOOP;

  -- (5) VALIDATE THE SUBMITTED MAP (verbatim 114:388-422): keys are slot
  --     instances or IR spots, values are this team's rostered players, each
  --     player exactly once. These are SHAPE and OWNERSHIP gates, not timing
  --     gates — they bind the commissioner (see WHAT IS NOT LIFTED).
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'commish_edit_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'commish_edit_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'commish_edit_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'commish_edit_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — verbatim
  --     114:424-442. Still needed in full even though the lock is lifted:
  --     v_kick feeds locked_at, starters[].kickoff_at and the bye flag.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  -- 165 / F497: each player's kickoff is judged per PLAYER, exactly as
  -- set_lineup has recorded it since 157 (lineup_player_kickoff_internal —
  -- his current NFL team's game, or, when that is still ahead or he has no
  -- team, the kickoff he PLAYED in this week: a start this league recorded
  -- for a real, passed kickoff, or his stat line). A player the NFL released
  -- or traded after he played keeps his kickoff record, his place in
  -- locked_at and no bye flag through a commissioner edit (164 read his
  -- current team here: NULL + "bye" for a release, the new team's later
  -- game for a trade). The receipt reads the same map (164's parallel
  -- v_lock_kick / v_lock_kick_cur, folded in). Nothing here refuses.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> 'player_id', p_at);   -- 165 / F497
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> 'player_id', p_at);   -- 165 / F497
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  v_kick := v_kick || v_gone_kick;   -- 154 / F441: (4b)'s kept, since-unrostered starters
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) THE LOCK — DIFFERENCE (A1)/(A2). 114:444-476's two arms are NOT here.
  --     A stored starter whose game kicked off MAY leave his key, and a
  --     player whose game has started MAY enter or move slots. That is the
  --     entire purpose of this verb (PROGRESS §3 clause (g), Chris: "an LM
  --     should be able to set the lineup even after the games have started").
  --     The arms stay byte-identical in `set_lineup_internal` for every
  --     caller, commissioner included — never weaken the rule, add the
  --     exception path.
  --     What replaces them is a RECORD, not a refusal: every player this edit
  --     moved whose game had already kicked off is named, and rides into the
  --     audit row's metadata so the league can see exactly what the override
  --     did that a manager could not have.
  --     164 / F467: judged per PLAYER — the lock a manager faces since 157 —
  --     so the record names every player a manager could not have moved
  --     (165 / F497: that datum is v_kick itself now; 164's parallel map
  --     is folded into it).
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN NOT (v_by_pid ? v_pid);
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at)
        OR v_gone_kick ? v_pid)   -- 154 / F441: a kept off-roster starter moved or removed is recorded too
       AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'from', v_key, 'to', v_seen ->> v_pid,
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
       AND (v_stored ->> v_key) IS DISTINCT FROM v_pid
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_moved_lock) m WHERE m ->> 'player_id' = v_pid) THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        -- His PRIOR slot, or NULL when he was on the bench. (R970: this was
        -- wrapped in `CASE WHEN v_stored ? v_pid THEN NULL ELSE …` — a
        -- key-existence test against a slot_map keyed by SLOT, so it asked
        -- whether a PLAYER ID was a slot key and was dead by construction.
        -- The subquery alone was always the whole computation; the guard only
        -- misled, in the permanent record of what the override did.)
        'from', (SELECT e.key FROM jsonb_each(v_stored) e WHERE e.value #>> '{}' = v_pid LIMIT 1),
        'to', v_key,
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  IF jsonb_array_length(v_moved_lock) > 0 THEN
    v_bypassed := v_bypassed || to_jsonb('per_player_kickoff_lock'::text);
  END IF;

  -- (8) THE FIT (E16) — 114:479-496 with DIFFERENCE (A3): every player is
  --     passed `fixed = FALSE`. THIS IS LOAD-BEARING, not cosmetic. In
  --     `lineup_fit_internal` a fixed player is seeded at his `wanted` slot
  --     UNCONDITIONALLY (112:498-505) and a fixed-owned slot is never
  --     traversed by the BFS (112:518) — `fixed` IS the matcher's own copy of
  --     the lock. Carrying 114's computation here would silently re-pin every
  --     kicked-off player at his stored slot, and the verb would look like it
  --     worked while refusing to move the one player it exists to move.
  --     With FALSE throughout, `lineup_fit_internal` is reused BYTE-UNCHANGED
  --     and still enforces position eligibility.
  --     Input order is then just submitted-key ordinality — still deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     FALSE) ORDER BY x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  -- E16 is NOT lifted — see WHAT IS NOT LIFTED in the banner (season gate
  -- invariant 2 reds on any stored lineup the fit cannot seat, F324).
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'commish_edit_lineup: % (%) cannot be placed — no legal arrangement fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- (9) IR MOVES, against the CURRENT week — 114:514-579 with DIFFERENCE (A4):
  --     the two Restricted-IR STINT refusals and the two IR LOCK-TIMING
  --     refusals are NOT copied. §11.2:727 names the stint override in so many
  --     words ("Restricted stint still applies; commissioner can override");
  --     the timing gates are the IR analogue of the two lock arms. The
  --     DESIGNATION eligibility gate IS kept — it is a legality rule, and the
  --     already-placed-but-ineligible case stays a FLAG exactly as 114 has it.
  --     Every gate walked past is recorded in v_bypassed.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        v_bypassed := v_bypassed || to_jsonb(('ir_restricted_stint:' || v_pid)::text);
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'commish_edit_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        v_bypassed := v_bypassed || to_jsonb(('ir_lock_timing:' || v_pid)::text);
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      v_bypassed := v_bypassed || to_jsonb(('ir_restricted_stint:' || v_pid)::text);
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      v_bypassed := v_bypassed || to_jsonb(('ir_lock_timing:' || v_pid)::text);
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  --      Verbatim 114:581-631. The starters[] element shape
  --      {slot, slot_key, label, player_id, position, kickoff_at, flags} is a
  --      HARD cross-file contract: `lineup_lock_tick` walks each element,
  --      reads `player_id`, compares `kickoff_at` as an INSTANT and rewrites
  --      it in place (116:701-726). A different shape either crashes that
  --      league's arm of the hourly job — whose handler swallows it into a
  --      WARNING (116:734-738), so the failure would be SILENT — or churns the
  --      row every hour.
  --      `locked_at` is the LEAST over EVERY occupied starting slot whose
  --      player has a non-NULL kickoff — NOT only those already kicked off.
  --      The tick recomputes it the same way (116:718-720) and would overwrite
  --      any other value.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).
      -- 166 / F500: R739's exemption, carried exactly as set_lineup_internal
      -- step (10) has it (157): a STORED starter whose own game has kicked
      -- off (his per-player datum, step (6)) and who stays at his stored key
      -- is not blocked — his game is under way or over, so keeping him where
      -- he stands is the week as it happened, not a submit. 123 dropped the
      -- clause as meaningless for a verb with no lock; without it a starter
      -- who played Thursday and was put on IR before Sunday refused every
      -- commissioner fix to that week unless he benched him (changing the
      -- score) — a save the manager may make: a TIMING refusal of the
      -- commissioner (standing rule (g)). Putting a bye / OUT player at any
      -- key he is not stored at (moving him, or starting one from the
      -- bench) is still refused by name, as it is for the manager. The
      -- stored-occupant test is spelled NULL-SAFE here: set_lineup's `=`
      -- yields NULL for a key that was empty, which cannot reach its gate
      -- (step (7b) refuses a kicked-off player entering a slot first) but
      -- would reach this one (no lock) and let a moved OUT starter through.
      -- The kept-start clause below (154 / F441) is spelled the same way
      -- (F503): its `=` let a kept OFF-ROSTER starter, now OUT, be moved
      -- into an empty key without the refusal.
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT ((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid)   -- 166 / F500: R739, as set_lineup (null-safe)
         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid) THEN   -- 154 / F441: a kept start where it stands is the week's record, not a submit (166 / F503: null-safe too — an empty key must not exempt a moved kept start)
        RAISE EXCEPTION
          'commish_edit_lineup: % is % for week % and this league doesn''t allow illegal lineups — slot "%" can''t be saved like this; bench him, start someone who plays, or turn on illegal lineups in the league settings',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
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

  -- (11) NO-OP BY NAME (rule 10, and Chris's one condition). DETECTED, never
  --      inferred from an empty write: the canonical map equals the stored map
  --      and no IR move. jsonb equality, so key order is irrelevant.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  -- Which starters changed — the enqueue set (see SCORING). Computed here so
  -- the result can report it whether or not the write happens.
  SELECT COALESCE(array_agg(e.value #>> '{}'), ARRAY[]::text[])
  INTO v_old_start
  FROM jsonb_each(v_stored) e
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key);
  v_rescore := ARRAY(
    SELECT x FROM unnest(v_old_start) x WHERE NOT (x = ANY (v_started))
    UNION
    SELECT x FROM unnest(v_started) x WHERE NOT (x = ANY (v_old_start)));

  v_score_stale := FALSE;
  v_stale_why   := NULL;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    --       DIFFERENCE (E): edited_by_commish is the literal TRUE.
    --       DIFFERENCE (G): set_at rides the seam.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = TRUE,
        set_at            = p_at
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_edit_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- (12b) THE SCORE. A lineup edit enqueues nothing on its own and the
    --       worker only notices a team through a STARTER's stat delta, so
    --       without this a post-kickoff edit moves the lineup and never moves
    --       the score. Read SCORING in the banner before touching the stamp.
    IF v_lw.status IN ('live', 'correction_window') AND array_length(v_rescore, 1) > 0 THEN
      INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
      SELECT v_league.season, p_week, ps.player_id, min(ps.updated_at)
      FROM public.player_stats ps
      WHERE ps.season = v_league.season AND ps.week = p_week
        AND ps.player_id = ANY (v_rescore)
        AND ps.updated_at IS NOT NULL
      GROUP BY ps.player_id
      ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row
      -- WHAT THIS FIELD MEANS, because a receipt that over-claims is the bug
      -- this whole banner is about: "a claimable queue row EXISTS for him",
      -- not "this statement inserted one". An untouched healthy row left by
      -- ON CONFLICT drains just as well, so it counts — but a player the
      -- INSERT could not queue is NEVER folded into silence.
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_enqueued
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                    WHERE f.season = v_league.season AND f.week = p_week AND f.player_id = x);
      -- R968 — THE OMISSION, NAMED. `player_stats.updated_at` is NULLABLE
      -- (measured: information_schema.columns → is_nullable = YES), so a
      -- partial ingestion can leave a scoreable line the enqueue cannot stamp.
      -- That player is dropped from the queue silently unless we say so.
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_unstamped
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.season = v_league.season AND ps.week = p_week AND ps.player_id = x)
        AND NOT EXISTS (SELECT 1 FROM public.player_stats ps
                        WHERE ps.season = v_league.season AND ps.week = p_week AND ps.player_id = x
                          AND ps.updated_at IS NOT NULL);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'player_id', x,
               'why', CASE WHEN x = ANY (v_unstamped) THEN 'stats_unstamped' ELSE 'no_stat_row' END) ORDER BY x), '[]'::jsonb)
      INTO v_not_enq
      FROM unnest(v_rescore) x
      WHERE NOT EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = p_week AND f.player_id = x);
      IF array_length(v_unstamped, 1) > 0 THEN
        -- A line exists and may carry points; we could not give it a
        -- claimable stamp. That is a lineup that moved and a score that may
        -- not follow — the one thing this verb must never report as success.
        v_score_stale := TRUE;
        v_stale_why   := 'stats_unstamped';
      END IF;
      -- A rescore player with NO stat line at all is NOT stale: the worker
      -- scores an absent line as 0 (`no_stat_row`), so adding or removing him
      -- moves no points. He is still named in `score_not_enqueued` rather
      -- than inferred from an empty array.
    ELSIF v_lw.status = 'final' AND array_length(v_rescore, 1) > 0 THEN
      -- The write door raises `week_final` (119:566-568) and the worker
      -- consumes the queue row with no cell changed (:892-895) — an enqueue
      -- here would delete itself having done nothing. Say so instead.
      -- R969: gated on v_rescore like the other two arms. A pure slot
      -- rearrangement or an IR-only move on a final week changes NO starter
      -- set, so there is no score to chase and a `score_stale` there is a
      -- false alarm in the one field whose whole job is to be believed.
      v_score_stale := TRUE;
      v_stale_why   := 'week_final';
    ELSIF array_length(v_rescore, 1) > 0 THEN
      -- `upcoming`: nothing has been scored yet, so there is nothing stale.
      v_stale_why := NULL;
    END IF;

    -- (12c) THE RECEIPT (§10.3, §15.4:1689). Exactly one audit row, in THIS
    --       transaction, INSIDE the no-op guard — Chris's one condition:
    --       "no receipt if nothing is done. only when something is done."
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_lineup', 'team', p_team_id::text, v_reason,
      v_before,
      jsonb_build_object(
        'slot_map', v_canon, 'starters', v_starters, 'bench', v_bench,
        'locked_at', v_locked_at, 'edited_by_commish', TRUE, 'set_at', p_at),
      jsonb_build_object(
        'week',                p_week,
        'current_week',        v_current,
        'season',              v_league.season,
        'week_status',         v_lw.status,
        'team_name',           v_team.name,
        'action_id',           p_action_id,
        -- The whole point of the verb, made legible: every rule this edit
        -- walked past, and every kicked-off player it moved.
        'bypassed',            v_bypassed,
        'locked_players_moved', v_moved_lock,
        'ir_moves',            jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
        'flags',               jsonb_build_object('bye', v_flags_bye, 'out', v_flags_out,
                                                  'empty', v_flags_empty, 'ir_ineligible', v_flags_irin),
        'score_enqueued',      v_enqueued,
        'score_not_enqueued',  v_not_enq,
        'score_stale',         v_score_stale,
        'score_stale_reason',  v_stale_why),
      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM. The commissioner
      -- set this team's lineup: a manager's act done for the team (§10.3:711
      -- "set when the commissioner acts on behalf of any team, most commonly
      -- an orphaned one"). set_lineup's commissioner arm has written the same
      -- action_type with it since 169; one action_type, one shape. His OWN
      -- team is his own act, not one on its behalf: NULL (169's arm, R1334).
      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m
                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)
           THEN NULL ELSE p_team_id END);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_edit_lineup: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- §10.3: override system messages auto-post to league chat and CANNOT be
    -- disabled. D97/D290's in-txn post, reworded as the override post.
    v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' edited by '
      || public.draft_actor_name() || ' (commissioner override'
      || CASE WHEN jsonb_array_length(v_moved_lock) > 0
              THEN ', ' || jsonb_array_length(v_moved_lock) || ' player'
                   || CASE WHEN jsonb_array_length(v_moved_lock) = 1 THEN '' ELSE 's' END
                   || ' moved after kickoff'
              ELSE '' END
      || ')' || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week only, so a RETROACTIVE edit
      -- correctly leaves it alone — 114's guard is right as written.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        CONTINUE WHEN v_gone_kick ? (v_val #>> '{}');   -- 154 / F441: off this roster — no roster row of his to write
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0)
                       - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick) g WHERE g = ANY (v_started)) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key for % starters, expected %', v_expected,
          COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick) g WHERE g = ANY (v_started))
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      TRUE,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free),
    -- 123's own keys. The receipt, what the override walked past, and whether
    -- the SCORE followed — said by name, never left to be inferred.
    'commissioner_action_id', v_audit_id,      -- NULL on a no-op, and that is the point
    'week_status',            v_lw.status,
    'bypassed',               v_bypassed,
    'locked_players_moved',   v_moved_lock,
    'score_enqueued',         v_enqueued,
    'score_not_enqueued',     v_not_enq,
    'score_stale',            v_score_stale,
    'score_stale_reason',     v_stale_why
  );

  -- The idempotency ledger row is written for a NO-OP TOO (114:748's posture):
  -- an action_id is consumed by its submit whether or not anything moved, so a
  -- retry replays instead of re-evaluating. This is the OPPOSITE rule from the
  -- audit row above, and deliberately so — §12.26: "an action_id is an
  -- idempotency key, not an audit record".
  INSERT INTO public.commish_lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- commish_roster_override_internal — 170:1213-2223 FILE TEXT (D137), 7 hunks (+10 / -37).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_roster_override_internal(
  p_league_id    UUID,
  p_team_id      UUID,          -- force_add_drop's team (NULL for a move)
  p_add          TEXT,
  p_drop         TEXT,
  p_player_id    TEXT,          -- move's player (NULL for add/drop)
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_action_id    UUID,
  p_at           TIMESTAMPTZ,
  p_reason       TEXT,
  p_verb         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_found         BOOLEAN;
  v_is_move       BOOLEAN;
  v_result        JSONB;
  v_reason        TEXT;
  v_current       INTEGER;
  v_lw            public.league_weeks;
  v_week_status   TEXT;
  v_roster_size   INTEGER;
  v_hold_hours    INTEGER;
  v_sched         JSONB;         -- 149 (Q70): the league's waiver schedule
  v_fa_window     JSONB;         -- 149 (Q70): the free-agency window at p_at
  v_waiver_type   TEXT;
  v_cap_week_txt  TEXT;
  v_cap_season_txt TEXT;
  v_cap_week      INTEGER;
  v_cap_season    INTEGER;
  v_used_week     INTEGER;
  v_used_season   INTEGER;
  -- the normalized plan: who loses a player, who gains one
  v_lose_team     UUID;
  v_gain_team     UUID;
  v_lose_player   TEXT;
  v_gain_player   TEXT;
  v_lose_row      public.league_rosters;
  v_lose_p        public.players;
  v_gain_p        public.players;
  v_owner_team    public.teams;
  v_team_a        public.teams;         -- the move's FROM team / the add-drop team
  v_team_b        public.teams;         -- the move's TO team
  v_pool          public.league_player_pool;
  v_pool_from     TEXT;
  v_drop_to_state TEXT;
  v_drop_until    TIMESTAMPTZ;
  v_hold_early    BOOLEAN := FALSE;
  v_lose_lock     JSONB;
  v_gain_lock     JSONB;
  v_no_changes    BOOLEAN;
  v_audit_id      UUID;
  v_action_type   TEXT;
  v_arm           TEXT;
  v_bypassed      JSONB := '[]'::jsonb;
  v_affected      JSONB := '[]'::jsonb;
  v_lineups       JSONB := '[]'::jsonb;
  v_sync          JSONB;
  v_vacated       TEXT := NULL;
  v_ir_keys       TEXT[] := ARRAY[]::text[];   -- R1018: the league's BARE ir_slots keys
  v_txn_type      TEXT;                        -- R1017: the verb that already owns this action_id
  v_cap_team      UUID;                        -- R1022: the team the acquisition counts are ABOUT
  v_before        JSONB;
  v_before_drop   JSONB;
  v_after         JSONB;
  v_rescore       TEXT[] := ARRAY[]::text[];
  v_enqueued      JSONB := '[]'::jsonb;
  v_not_enq       JSONB := '[]'::jsonb;
  v_reach         TEXT[] := ARRAY[]::text[];
  v_reach_enq     JSONB := '[]'::jsonb;
  v_reachable     BOOLEAN := FALSE;
  v_unstamped     TEXT[] := ARRAY[]::text[];
  v_score_stale   BOOLEAN := FALSE;
  v_stale_why     TEXT := NULL;
  v_txn_id        UUID := gen_random_uuid();
  v_message       TEXT;
  v_cnt           INTEGER;
  v_count_a       INTEGER;
  v_count_b       INTEGER;
  v_exp_a         INTEGER;
  v_exp_b         INTEGER;
  v_week_end      TIMESTAMPTZ;   -- 152 / F437: the current week's end (153: its lock release — Q78's ceiling)
  v_from_week     INTEGER;       -- 152 / F437: the first unfinished week
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and is never answered with
  --     `no_changes: true` — a success document for a request that never said
  --     what it wanted is 126's rule, and it is this family's too.
  IF p_verb IS NULL OR p_verb NOT IN ('commish_move_player', 'commish_force_add_drop') THEN
    RAISE EXCEPTION
      'commish_roster_override_internal: p_verb must be commish_move_player or commish_force_add_drop (got %) — the internal is not a client door', COALESCE(p_verb, 'null')
      USING ERRCODE = '22023';
  END IF;
  v_is_move := (p_verb = 'commish_move_player');

  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      '%: p_action_id is required (idempotency key — one UUID per submit, reused on retry)', p_verb
      USING ERRCODE = '22023';
  END IF;

  IF v_is_move THEN
    IF p_player_id IS NULL OR p_from_team_id IS NULL OR p_to_team_id IS NULL THEN
      RAISE EXCEPTION
        '%: p_player_id, p_from_team_id and p_to_team_id are all required (§15.4:1694 — commish_move_player(player_id, from, to, reason))', p_verb
        USING ERRCODE = '22023';
    END IF;
    IF p_from_team_id = p_to_team_id THEN
      RAISE EXCEPTION
        '%: from and to name the same franchise (%) — a move changes which roster holds the player (§13.1)', p_verb, p_from_team_id
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_team_id IS NULL THEN
      RAISE EXCEPTION '%: p_team_id is required', p_verb USING ERRCODE = '22023';
    END IF;
    IF p_add IS NULL AND p_drop IS NULL THEN
      RAISE EXCEPTION
        '%: nothing to do — give a player to add, a player to drop, or both (§13.1); an override that names no player is not an override', p_verb
        USING ERRCODE = '22023';
    END IF;
    IF p_add IS NOT NULL AND p_add = p_drop THEN
      RAISE EXCEPTION '%: add and drop name the same player (%) — a move changes the roster (§13.1)', p_verb, p_add
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8; D294's one
  --     serialization point — the same one the manager's verb takes).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — COMMISSIONER ONLY, in-body, as ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5). This
  --     REPLACES the manager-only check at `115:416-426`; 115 keeps its own.
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION '%: not a commissioner of this league', p_verb
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), placed AFTER auth but BEFORE every business gate
  --     (123:602-609's placement), so a retry replays byte-identically even
  --     when the league has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_roster_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (3b) THE SECOND REPLAY KEY, GUARDED BY NAME (R1017; 115's R732 check at
  --      `115:429-443` is the mirror of this one, and it guards only its own
  --      direction). `uniq_transactions_league_action` (`113:283-285`) is a
  --      SHARED `(league_id, action_id)` namespace across the manager's verb
  --      and this one, so an action_id already spent on a `roster_add_drop`
  --      submit would otherwise reach (17)'s INSERT and escape as a raw 23505
  --      — a 500 at the client, because `mapInSeasonRpcError` has no 23505
  --      arm. This family's OWN ledger (step 3) has already answered every
  --      retry of THIS verb, so reaching here means a DIFFERENT verb owns the
  --      key: refuse by name and say which.
  SELECT t.type INTO v_txn_type
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
  IF FOUND THEN
    RAISE EXCEPTION
      '%: action_id % already names a "%" transaction in this league — an action_id identifies ONE submit of ONE verb (R732/R1017). Mint a new action_id for this override, or retry the verb that owns that one',
      p_verb, p_action_id, v_txn_type
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused. Absent or
  --     whitespace-only in the explicit E' \t\r\n' class (R745) ⇒ NULL
  --     (130 §0 stores it); otherwise trimmed, bounded at 500 below (the
  --     league_chat bound and the commissioner_actions CHECK). The 500
  --     check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      '%: the reason is % characters — at most 500 (the league_chat bound; §12.13)', p_verb, char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) LEAGUE / TEAMS / CALENDAR. Rosters do not exist before draft
  --     completion, which is what flips the status (066:823 / 086:448 /
  --     110:882), so the manager verb's season gate (115:449-453) binds here
  --     too — it is not a timing constraint on WHO may act, it is the absence
  --     of a subject.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      '%: league % is % — rosters change only while in_season or in playoffs (§13.1)', p_verb, p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team_a FROM public.teams t
  WHERE t.id = CASE WHEN v_is_move THEN p_from_team_id ELSE p_team_id END;
  IF NOT FOUND OR v_team_a.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb,
      CASE WHEN v_is_move THEN p_from_team_id ELSE p_team_id END, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_is_move THEN
    SELECT t.* INTO v_team_b FROM public.teams t WHERE t.id = p_to_team_id;
    IF NOT FOUND OR v_team_b.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb, p_to_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      '%: league % has no season schedule yet, so there is no week to place the move in', p_verb, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = v_current;
  IF NOT FOUND THEN
    -- LOUD, never a silent skip (§4 rule 15). `lineup_current_week_internal`
    -- derives the week FROM `league_weeks`, so its absence one statement later
    -- means the calendar changed under us — and a NULL status would make the
    -- whole scoring arm below fall through both its IFs and report nothing.
    RAISE EXCEPTION
      '%: league % has no schedule row for season % week % — the schedule changed while this move was being made; try again', p_verb, p_league_id, v_league.season, v_current
      USING ERRCODE = 'P0001';
  END IF;
  v_week_status := v_lw.status;

  -- Settings read exactly as 115:472-485 reads them.
  v_waiver_type  := COALESCE(v_league.waiver_type, 'faab');
  v_sched        := public.waiver_schedule_internal(v_league.settings, v_waiver_type);   -- 149: replaces the retired waiver_period_hours
  v_hold_hours   := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);
  v_cap_week_txt   := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_cap_season_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_cap_week   := CASE WHEN v_cap_week_txt   = 'unlimited' THEN NULL ELSE v_cap_week_txt::int   END;
  v_cap_season := CASE WHEN v_cap_season_txt = 'unlimited' THEN NULL ELSE v_cap_season_txt::int END;
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;
  -- R1018: the league's BARE `ir_slots` keys, in the scoring worker's own
  -- shape (`irKeysOf`, `score-week-worker.ts:397-407`). Passed to the lineup
  -- sync so an IR spot can never be mistaken for a vacated starting slot.
  SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[])
  INTO v_ir_keys
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) s
  WHERE COALESCE(s ->> 'key', '') <> '';

  -- The acquisition counts, hoisted here and assigned for EVERY call (R763 —
  -- 115:489-506 had to hoist them for exactly this reason: a branch that left
  -- them unassigned reported NULL to a capped league). They are read twice
  -- below — to decide whether a cap WOULD have refused (so `bypassed[]` names
  -- a real refusal and not a hypothetical one) and to report the league's own
  -- numbers back unchanged.
  --
  -- **THEY ARE COUNTED FOR THE TEAM THAT ACQUIRES, AND THE RECEIPT SAYS WHICH
  -- TEAM THAT IS (R1022).** An acquisition cap throttles the team a player
  -- ARRIVES on; the first cut counted `v_team_a`, which on a MOVE is the team
  -- the player LEAVES — so `caps.used_week_before` reported the wrong
  -- franchise's budget in a field the league is invited to read. On a move
  -- that is `v_team_b`; on an add/drop it is the one team named. `caps.team_id`
  -- is on the receipt so the number can never again be read against the wrong
  -- roster.
  v_cap_team := CASE WHEN v_is_move THEN v_team_b.id ELSE v_team_a.id END;
  SELECT count(*)::int INTO v_used_week
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = v_cap_team
    AND t.status = 'complete' AND t.week = v_current
    AND (t.payload ->> 'add_player_id') IS NOT NULL;
  SELECT count(*)::int INTO v_used_season
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = v_cap_team
    AND t.status = 'complete'
    AND (t.payload ->> 'add_player_id') IS NOT NULL;

  -- (6) THE PLAN, NORMALIZED. Both verbs reduce to "this team loses a player"
  --     and/or "that team gains one"; the writes below are then uniform.
  IF v_is_move THEN
    SELECT p.* INTO v_lose_p FROM public.players p WHERE p.id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: no player with id %', p_verb, p_player_id USING ERRCODE = 'P0001';
    END IF;
    v_gain_p := v_lose_p;
    SELECT r.* INTO v_lose_row FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % isn''t on any roster in this league — a move needs a team to move him from; to bring in a free agent, add him to a roster instead',
        p_verb, v_lose_p.full_name
        USING ERRCODE = 'P0001';
    END IF;
    IF v_lose_row.team_id = p_to_team_id THEN
      -- THE NO-OP (see the banner): the requested END STATE already holds.
      v_lose_team := NULL; v_gain_team := NULL;
      v_lose_player := NULL; v_gain_player := NULL;
    ELSIF v_lose_row.team_id <> p_from_team_id THEN
      SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
      RAISE EXCEPTION
        '%: % (%) is on %''s roster, not %''s — neither the source nor the destination you named. Re-read the roster and send the move again with the right `from`',
        p_verb, v_lose_p.full_name, p_player_id, v_owner_team.name, v_team_a.name
        USING ERRCODE = 'P0001';
    ELSE
      v_lose_team   := p_from_team_id;
      v_gain_team   := p_to_team_id;
      v_lose_player := p_player_id;
      v_gain_player := p_player_id;
    END IF;
  ELSE
    -- ── force add / drop ────────────────────────────────────────────────────
    IF p_drop IS NOT NULL THEN
      SELECT p.* INTO v_lose_p FROM public.players p WHERE p.id = p_drop;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (drop)', p_verb, p_drop USING ERRCODE = 'P0001';
      END IF;
      SELECT r.* INTO v_lose_row FROM public.league_rosters r
      WHERE r.league_id = p_league_id AND r.player_id = p_drop;
      IF FOUND THEN
        IF v_lose_row.team_id <> p_team_id THEN
          SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
          RAISE EXCEPTION
            '%: % is on %''s roster, not %''s — pick the team he is actually on, or move him from there',
            p_verb, v_lose_p.full_name, v_owner_team.name, v_team_a.name
            USING ERRCODE = 'P0001';
        END IF;
        v_lose_team   := p_team_id;
        v_lose_player := p_drop;
      END IF;
      -- NOT FOUND ⇒ he is already on no roster in this league: the drop side's
      -- requested end state already holds (the banner's no-op rule).
    END IF;
    IF p_add IS NOT NULL THEN
      SELECT p.* INTO v_gain_p FROM public.players p WHERE p.id = p_add;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (add)', p_verb, p_add USING ERRCODE = 'P0001';
      END IF;
      -- EXCLUSIVITY (072:147's UNIQUE, CLAUDE.md business rule 7, §12.7) —
      -- A LEGALITY GATE, AND IT BINDS THE COMMISSIONER (standing rule (i)).
      -- Refused BY NAME and never silently converted into a move: the verb the
      -- commissioner wanted is the one the message names.
      SELECT t.* INTO v_owner_team
      FROM public.league_rosters r JOIN public.teams t ON t.id = r.team_id
      WHERE r.league_id = p_league_id AND r.player_id = p_add;
      IF FOUND AND v_owner_team.id <> p_team_id THEN
        RAISE EXCEPTION
          '%: % is already on %''s roster — a player can be on only one team in a league, and that applies to the commissioner too. To take him off % and put him on %, move him instead',
          p_verb, v_gain_p.full_name, v_owner_team.name, v_owner_team.name, v_team_a.name
          USING ERRCODE = 'P0001';
      END IF;
      IF NOT FOUND THEN
        v_gain_team   := p_team_id;
        v_gain_player := p_add;
      END IF;
      -- FOUND and already on THIS team ⇒ the add side's end state holds.
    END IF;
  END IF;

  -- (7) THE NO-OP, DETECTED BY VALUE across every dimension this verb can
  --     change — which roster row exists and which team it names (D336 part 3,
  --     §4 rule 15). Never inferred from an empty write.
  v_no_changes := (v_lose_player IS NULL AND v_gain_player IS NULL);

  v_affected := CASE
    WHEN v_is_move THEN jsonb_build_array(p_from_team_id, p_to_team_id)
    ELSE jsonb_build_array(p_team_id) END;                       -- D353
  -- R1019 — THE AUDIT ROW DESCRIBES THE PLAN THAT EXECUTED, NEVER THE
  -- PARAMETERS THAT WERE SENT. The first cut keyed both on `p_add IS NOT
  -- NULL`, so a call whose ADD arm was a no-op (he is already on this roster)
  -- and whose DROP arm executed was stamped `action_type = 'force_add'` with
  -- `added_player_id` NULL — and tasks-M6A §5 calls this shape contractual
  -- *"so the activity feed can render them without a special case"*, which
  -- means the feed would render a pure drop as an add. Keyed on the NORMALIZED
  -- plan (`v_gain_player` / `v_lose_player`) the stamp is what happened.
  --
  -- The one place the PARAMETERS are still the honest answer is a total no-op:
  -- nothing executed, no audit row is written at all, and the returned
  -- document's job there is to say what was ASKED and that it changed nothing
  -- (`no_changes` + `no_changes_why` carry the rest).
  v_action_type := CASE
    WHEN v_is_move                 THEN 'move_player'
    WHEN v_no_changes              THEN CASE WHEN p_add IS NOT NULL THEN 'force_add' ELSE 'force_drop' END
    WHEN v_gain_player IS NOT NULL THEN 'force_add'
    ELSE 'force_drop' END;
  v_arm := CASE
    WHEN v_is_move    THEN 'move'
    WHEN v_no_changes THEN CASE
                             WHEN p_add IS NOT NULL AND p_drop IS NOT NULL THEN 'add+drop'
                             WHEN p_add IS NOT NULL THEN 'add'
                             ELSE 'drop' END
    WHEN v_gain_player IS NOT NULL AND v_lose_player IS NOT NULL THEN 'add+drop'
    WHEN v_gain_player IS NOT NULL THEN 'add'
    ELSE 'drop' END;

  IF NOT v_no_changes THEN
    -- (8) WHAT THIS OVERRIDE WALKS PAST, made legible (D336 part 7). Standing
    --     rule (g): the timing rules do not bind a commissioner. None of these
    --     is a refusal here — each is a receipt line, and each one is
    --     EVALUATED (not assumed) so the receipt is true as measured.
    IF v_lose_player IS NOT NULL THEN
      v_lose_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, v_lose_player, p_at);   -- 164 / F467: the receipt judges the lock per player (played this week), as 157's writers do
      IF (v_lose_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_drop_lock:' || v_lose_player)::text);
      END IF;
    END IF;
    IF v_gain_player IS NOT NULL AND NOT v_is_move THEN
      v_gain_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, v_gain_player, p_at);   -- 164 / F467: the receipt judges the lock per player (played this week), as 157's writers do
      IF (v_gain_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_add_lock:' || v_gain_player)::text);
      END IF;
      -- The waiver period (115:576-582) — a `when`, not a `what`.
      SELECT pp.* INTO v_pool FROM public.league_player_pool pp
      WHERE pp.league_id = p_league_id AND pp.player_id = v_gain_player;
      IF NOT FOUND THEN
        v_pool_from := 'free_agent';
      ELSE
        v_pool_from := v_pool.state;
        -- 149: a hold whose run is due but not yet settled is still a hold (E8).
        IF v_pool.state = 'on_waivers'
           AND (v_pool.waivers_until > p_at
                OR (v_league.waiver_next_run_at IS NOT NULL AND v_pool.waivers_until >= v_league.waiver_next_run_at)) THEN
          v_bypassed := v_bypassed || to_jsonb(('waiver_period:' || v_gain_player)::text);
        END IF;
        IF v_pool.state = 'rostered' THEN
          -- D294's BROKEN-MIRROR REFUSAL (115:589-595), carried verbatim: no
          -- roster row (checked above) but a `rostered` pool row means the
          -- mirror is broken. Asserted, not trusted — and it binds the
          -- commissioner because it is an integrity claim about the data, not
          -- a rule about who may act.
          RAISE EXCEPTION
            '%: league_player_pool says % (%) is rostered in league % but league_rosters has no row — the pool mirror is broken; refusing until reconciliation (L.D2.3) repairs it (D294)',
            p_verb, v_gain_p.full_name, v_gain_player, p_league_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      -- 149 (Q70): the league's free-agency window is a `when` too — outside
      -- it every unowned player is claim-only for a MANAGER; the commissioner
      -- walks past it (TD5) and the receipt NAMES it under the same
      -- `waiver_period:<player>` entry (one name for "not an instant pickup").
      v_fa_window := public.waiver_window_internal(v_league, p_at);
      IF NOT (v_fa_window ->> 'free_agency_open')::boolean
         AND NOT (v_bypassed @> to_jsonb(ARRAY['waiver_period:' || v_gain_player])) THEN
        v_bypassed := v_bypassed || to_jsonb(('waiver_period:' || v_gain_player)::text);
      END IF;
      -- The acquisition caps (115:621-632) — a league throttle. The counts
      -- were taken above (R763); only an ADD could ever have been refused by
      -- them, so only this branch reads them.
      IF v_cap_week IS NOT NULL AND v_used_week >= v_cap_week THEN
        v_bypassed := v_bypassed || to_jsonb('acquisitions_per_week'::text);
      END IF;
      IF v_cap_season IS NOT NULL AND v_used_season >= v_cap_season THEN
        v_bypassed := v_bypassed || to_jsonb('acquisitions_per_season'::text);
      END IF;
    ELSIF v_is_move AND v_gain_player IS NOT NULL THEN
      v_pool_from := 'rostered';
    END IF;

    -- (9) CAPACITY (§7.3.2 roster_size) — A LEGALITY GATE, and it binds the
    --     commissioner. The refusal names the remedy.
    SELECT count(*)::int INTO v_count_a
    FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_a.id;
    v_exp_a := v_count_a
             - CASE WHEN v_lose_team = v_team_a.id THEN 1 ELSE 0 END
             + CASE WHEN v_gain_team = v_team_a.id THEN 1 ELSE 0 END;
    IF v_is_move THEN
      SELECT count(*)::int INTO v_count_b
      FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_b.id;
      v_exp_b := v_count_b
               - CASE WHEN v_lose_team = v_team_b.id THEN 1 ELSE 0 END
               + CASE WHEN v_gain_team = v_team_b.id THEN 1 ELSE 0 END;
      IF v_exp_b > v_roster_size THEN
        RAISE EXCEPTION
          '%: %''s roster is full (% of %) — drop a player from it first. A roster can''t go over the league''s roster size, and that applies to the commissioner too',
          p_verb, v_team_b.name, v_count_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_exp_a > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster is full (% of %) — include a drop in the same move. A roster can''t go over the league''s roster size, and that applies to the commissioner too',
        p_verb, v_team_a.name, v_count_a, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) THE BEFORE DOCUMENT, read before the writes (D353: `before`/`after`
    --      mirror each other key-for-key over THE ROW THAT CHANGED).
    --      `target_id` is the added or moved player when there is one, else
    --      the dropped one, and these two documents describe THAT player's
    --      `league_rosters` row. A combined add+drop's drop side is fully
    --      described in `metadata` (`drop_player_id`, `drop_before`,
    --      `drop_to_state`) rather than crammed into a shape that has room for
    --      one row — the audit row's headline is the row that arrived.
    v_before_drop := CASE WHEN v_lose_player IS NULL THEN NULL ELSE jsonb_build_object(
      'team_id',          v_lose_row.team_id,
      'slot_key',         v_lose_row.slot_key,
      'acquisition_type', v_lose_row.acquisition_type) END;
    v_before := CASE
      WHEN v_is_move                 THEN v_before_drop
      WHEN v_gain_player IS NOT NULL THEN jsonb_build_object('team_id', NULL, 'slot_key', NULL, 'acquisition_type', NULL)
      ELSE v_before_drop END;

    -- (11) THE WRITES.
    IF v_is_move THEN
      -- A MOVE is an UPDATE of the ONE roster row, so exclusivity is preserved
      -- BY CONSTRUCTION — there is never a second row to collide with
      -- (072:147). The IR stint is a property of the franchise the player is
      -- leaving, so it is cleared with him; acquisition_cost is 0 because a
      -- commissioner move is not a purchase (FAAB is M5's, F340).
      UPDATE public.league_rosters r
      SET team_id            = p_to_team_id,
          slot_key           = 'bn',
          acquisition_type   = 'commissioner',
          acquisition_cost   = 0,
          ir_placed_week     = NULL,
          ir_lock_until_week = NULL,
          acquired_at        = p_at
      WHERE r.league_id = p_league_id AND r.player_id = p_player_id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION '%: the move updated % roster rows for %, expected exactly 1', p_verb, v_cnt, p_player_id
          USING ERRCODE = 'P0001';
      END IF;
      -- The pool mirror stays `rostered` (he never left a roster); the stamp
      -- moves so the mirror's own freshness is not silently stale.
      INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
      VALUES (p_league_id, p_player_id, 'rostered', NULL, p_at)
      ON CONFLICT (league_id, player_id) DO UPDATE
        SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
    ELSE
      IF v_lose_player IS NOT NULL THEN
        -- fa_hold_hours (§7.3.4), 115:540-552 verbatim: an early drop of a
        -- free-agent add returns him to FA, not waivers. held >= hold ⇒
        -- waivers (the boundary is inclusive).
        v_hold_early := v_lose_row.acquisition_type = 'free_agent'
                        AND v_hold_hours > 0
                        AND v_lose_row.acquired_at IS NOT NULL
                        AND p_at < v_lose_row.acquired_at + make_interval(hours => v_hold_hours);
        IF v_hold_early OR v_waiver_type = 'none_fcfs' THEN
          v_drop_to_state := 'free_agent';
          v_drop_until := NULL;
        ELSE
          v_drop_to_state := 'on_waivers';
          v_drop_until := public.waiver_next_run_internal(v_sched, p_at);   -- 149 (Q70): until the next run
        END IF;
        DELETE FROM public.league_rosters r
        WHERE r.league_id = p_league_id AND r.team_id = v_lose_team AND r.player_id = v_lose_player;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION '%: the drop of % deleted % roster rows, expected 1', p_verb, v_lose_player, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
        VALUES (p_league_id, v_lose_player, v_drop_to_state, v_drop_until, p_at)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
      END IF;
      IF v_gain_player IS NOT NULL THEN
        BEGIN
          INSERT INTO public.league_rosters
            (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
          VALUES (p_league_id, v_gain_team, v_gain_player, 'bn', 'commissioner', 0, p_at);
        EXCEPTION WHEN unique_violation THEN
          -- 072's UNIQUE, kept as an UNPINNABLE backstop (R757/D276, 115's
          -- posture): the league row lock in (1) serializes every racer behind
          -- the exclusivity pre-check, so this branch is unreachable in
          -- practice — it exists so a raw 23505 can never reach the wire if
          -- that lock is ever weakened.
          RAISE EXCEPTION
            '%: % (%) was rostered by another team in this league a moment ago — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
            p_verb, v_gain_p.full_name, v_gain_player
            USING ERRCODE = 'P0001';
        END;
        INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
        VALUES (p_league_id, v_gain_player, 'rostered', NULL, p_at)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
      END IF;
    END IF;

    -- (12) THE LINEUP CONSEQUENCE, and the eviction that carries the score
    --      signal with it (D346). Every week from the first UNFINISHED one on
    --      (152 / F437), for both sides of a move. `p_current` stays the
    --      current week: once it is finished the sync never visits it, so
    --      nothing is vacated and nothing re-scores a finished week.
    -- F437: the first UNFINISHED week is the current week while its last
    -- game has not ended, the next one once it has (151's trade executor's
    -- rule, D410(5)). A finished week's lineup is
    -- the record the score worker and the nightly reconcile score it from
    -- (score-week-worker.ts step 5 reads THE WEEK's slot_map), and stat
    -- corrections re-score it until its window closes — clearing a played
    -- starter from it would erase his points from the team that played him.
    -- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,
    -- or its Wednesday 00:00 Pacific ceiling when that comes first. The
    -- ceiling releases a played starter, so it must finish the week for
    -- lineups too: otherwise, in a league's LAST week (no week N+1 row to
    -- flip the current week), a move at the ceiling would clear his start.
    SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
    WHERE w.season = v_league.season AND w.week = v_current;
    v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;
    v_sync := public.commish_roster_lineup_sync_internal(
      p_league_id, v_team_a.id, v_league.season, v_from_week, v_current,
      CASE WHEN v_lose_team = v_team_a.id THEN v_lose_player END,
      CASE WHEN v_gain_team = v_team_a.id THEN v_gain_player END,
      v_ir_keys);
    v_lineups := v_lineups || jsonb_build_object('team_id', v_team_a.id, 'rows', v_sync -> 'rows');
    v_vacated := v_sync ->> 'vacated_current_slot';
    IF v_is_move THEN
      v_sync := public.commish_roster_lineup_sync_internal(
        p_league_id, v_team_b.id, v_league.season, v_from_week, v_current,
        CASE WHEN v_lose_team = v_team_b.id THEN v_lose_player END,
        CASE WHEN v_gain_team = v_team_b.id THEN v_gain_player END,
        v_ir_keys);
      v_lineups := v_lineups || jsonb_build_object('team_id', v_team_b.id, 'rows', v_sync -> 'rows');
      v_vacated := COALESCE(v_vacated, v_sync ->> 'vacated_current_slot');
    END IF;

    -- (13) POST-WRITE ASSERTIONS (R703-class; D294's mirror asserted —
    --      115:732-753's shape, extended to both sides of a move).
    IF v_gain_player IS NOT NULL THEN
      IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = v_gain_player) <> 1
         OR NOT EXISTS (SELECT 1 FROM public.league_rosters r
                        WHERE r.league_id = p_league_id AND r.team_id = v_gain_team AND r.player_id = v_gain_player) THEN
        RAISE EXCEPTION '%: after the write, % is not exactly once on the destination roster in league % — refusing', p_verb, v_gain_player, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      IF (SELECT pp.state FROM public.league_player_pool pp
          WHERE pp.league_id = p_league_id AND pp.player_id = v_gain_player) IS DISTINCT FROM 'rostered' THEN
        RAISE EXCEPTION '%: the pool mirror for % is not rostered after the write (D294) — refusing', p_verb, v_gain_player
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_lose_player IS NOT NULL AND NOT v_is_move THEN
      IF EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = v_lose_player) THEN
        RAISE EXCEPTION '%: after the drop, % is still rostered in league % — refusing', p_verb, v_lose_player, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      IF (SELECT pp.state FROM public.league_player_pool pp
          WHERE pp.league_id = p_league_id AND pp.player_id = v_lose_player) IS DISTINCT FROM v_drop_to_state THEN
        RAISE EXCEPTION '%: the pool mirror for % is not % after the drop (D294) — refusing', p_verb, v_lose_player, v_drop_to_state
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    SELECT count(*)::int INTO v_cnt
    FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_a.id;
    IF v_cnt <> v_exp_a OR v_cnt > v_roster_size THEN
      RAISE EXCEPTION '%: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
        p_verb, v_team_a.name, v_cnt, v_exp_a, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
    IF v_is_move THEN
      SELECT count(*)::int INTO v_cnt
      FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_b.id;
      IF v_cnt <> v_exp_b OR v_cnt > v_roster_size THEN
        RAISE EXCEPTION '%: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
          p_verb, v_team_b.name, v_cnt, v_exp_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (14) THE SCORE (D346). The starter set of the CURRENT week changed
    --      exactly when the losing side's player occupied a slot in it — which
    --      is MEASURED by the sync helper and returned, not assumed. An added
    --      player lands on the BENCH and so is never in the symmetric
    --      difference; the assertion that keeps that true is (12)'s own
    --      post-write check. Read SCORING in the banner before touching the
    --      stamp.
    IF v_vacated IS NOT NULL THEN
      v_rescore := ARRAY[v_lose_player];
    END IF;
    IF array_length(v_rescore, 1) > 0 AND v_week_status IN ('live', 'correction_window') THEN
      -- A CHANGED STARTER IS QUEUED ONLY IF THIS LEAGUE STILL ROSTERS HIM
      -- (F353). The worker maps a queued player to leagues through
      -- `league_rosters`, so a row for a player nobody rosters is consumed with
      -- `report.unmapped += 1` and deleted having done nothing — it is not a
      -- queue poison (measured: `toDelete.push(row)`), but it is a row that
      -- claims to chase a score it cannot reach, and `score_enqueued` would
      -- then mean less than it says. He is NAMED `unrostered` below instead.
      INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
      SELECT v_league.season, v_current, ps.player_id, min(ps.updated_at)
      FROM public.player_stats ps
      WHERE ps.season = v_league.season AND ps.week = v_current
        AND ps.player_id = ANY (v_rescore)
        AND ps.updated_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.league_rosters r
                    WHERE r.league_id = p_league_id AND r.player_id = ps.player_id)
      GROUP BY ps.player_id
      ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row

      -- (14b) THE REACH SET — AND THE REASON IT HAS TO EXIST IS A DIFFERENCE
      --       BETWEEN THIS VERB AND 123's, MEASURED RATHER THAN ASSUMED
      --       (F353). The worker maps a queued player to LEAGUES through the
      --       roster index — its own docblock, step 3: *"ready players →
      --       leagues through `idx_league_rosters_player` … The LEAGUE comes
      --       from the roster index"* — and the query behind it is
      --       `readRosterLeagues`, a read of `league_rosters` filtered to the
      --       season's `in_season|playoffs` leagues.
      --
      --       `commish_edit_lineup` never hits this, because the player it
      --       benches STAYS ON THE ROSTER: he maps to the league, the drain
      --       visits the league-week, and `edited_by_commish` then forces the
      --       team. **A force-DROP deletes the roster row**, so the very row
      --       this verb queues maps to NO league and the drain never arrives —
      --       the enqueue is consumed having reached nothing and the stored
      --       points keep the dropped player, for ever. That is 123's own
      --       failure one layer out, and D346 did not anticipate it because it
      --       was written from the lineup verb's case.
      --
      --       So the verb ALSO queues players the league STILL rosters, drawn
      --       from the affected teams' remaining rosters. They are not there to
      --       be re-scored for their own sake — the drain recomputes every
      --       starter of an affected team through `extraStats` anyway — they
      --       are there to make the drain VISIT this league-week at all. Each
      --       carries its OWN stamp and `ON CONFLICT DO NOTHING`, so a healthy
      --       existing row is never re-stamped and the set costs at most
      --       `roster_size` rows per touched team — plus the CROSS-LEAGUE
      --       fan-out named in the banner (R1023): the queue is keyed
      --       `(season, week, player_id)` with no league column, so these rows
      --       re-drain these players for every other in-season league that
      --       rosters them. Idempotent, and deliberately not narrowed here.
      SELECT COALESCE(array_agg(DISTINCT r.player_id), ARRAY[]::text[]) INTO v_reach
      FROM public.league_rosters r
      WHERE r.league_id = p_league_id
        AND r.team_id IN (v_team_a.id, COALESCE(v_team_b.id, v_team_a.id))
        AND NOT (r.player_id = ANY (v_rescore));
      IF array_length(v_reach, 1) > 0 THEN
        INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
        SELECT v_league.season, v_current, ps.player_id, min(ps.updated_at)
        FROM public.player_stats ps
        WHERE ps.season = v_league.season AND ps.week = v_current
          AND ps.player_id = ANY (v_reach)
          AND ps.updated_at IS NOT NULL
        GROUP BY ps.player_id
        ON CONFLICT (season, week, player_id) DO NOTHING;
        SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_reach_enq
        FROM unnest(v_reach) x
        WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                      WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      END IF;
      -- WHAT THIS FIELD MEANS (123:1088-1092): "a claimable queue row EXISTS
      -- for him", not "this statement inserted one". An untouched healthy row
      -- left by ON CONFLICT drains just as well — but a player the INSERT
      -- could not queue is NEVER folded into silence.
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_enqueued
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                    WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      -- R968 — `player_stats.updated_at` is NULLABLE, so a partial ingestion
      -- can leave a scoreable line the enqueue cannot stamp. Named, never
      -- dropped silently.
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_unstamped
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.season = v_league.season AND ps.week = v_current AND ps.player_id = x)
        AND NOT EXISTS (SELECT 1 FROM public.player_stats ps
                        WHERE ps.season = v_league.season AND ps.week = v_current AND ps.player_id = x
                          AND ps.updated_at IS NOT NULL);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'player_id', x,
               'why', CASE
                 WHEN NOT EXISTS (SELECT 1 FROM public.league_rosters r
                                  WHERE r.league_id = p_league_id AND r.player_id = x)
                   THEN 'unrostered'
                 WHEN x = ANY (v_unstamped) THEN 'stats_unstamped'
                 ELSE 'no_stat_row' END) ORDER BY x), '[]'::jsonb)
      INTO v_not_enq
      FROM unnest(v_rescore) x
      WHERE NOT EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      -- (14c) REACHABILITY, MEASURED AFTER THE WRITES AND NEVER INFERRED: is
      --       there a queued player for this season-week that THIS league
      --       still rosters? That is the exact predicate the worker's map
      --       evaluates, asked of the state this transaction is about to
      --       commit. If the answer is no, the lineup moved and the score
      --       CANNOT follow — the one thing this verb must never report as
      --       success (F353).
      SELECT EXISTS (
        SELECT 1 FROM public.score_fanout f
        JOIN public.league_rosters r
          ON r.player_id = f.player_id AND r.league_id = p_league_id
        WHERE f.season = v_league.season AND f.week = v_current)
      INTO v_reachable;

      -- An `unrostered` changed starter is NOT stale, and the reason is the
      -- mechanism rather than an opinion: the drop's score does not follow
      -- from HIS queue row at all — it follows from the team being recomputed
      -- (reachable + `edited_by_commish`) against the CURRENT lineup, which no
      -- longer contains him. What WOULD be stale is a league-week the drain
      -- cannot reach, and that is the arm below.
      IF NOT v_reachable THEN
        v_score_stale := TRUE;
        v_stale_why   := 'unreachable';
      ELSIF array_length(v_unstamped, 1) > 0 THEN
        v_score_stale := TRUE;
        v_stale_why   := 'stats_unstamped';
      END IF;
    ELSIF array_length(v_rescore, 1) > 0 AND v_week_status = 'final' THEN
      -- The write door raises `week_final` (119:566-568) and the worker
      -- consumes the queue row with no cell changed — an enqueue here would
      -- delete itself having done nothing. Say so instead.
      v_score_stale := TRUE;
      v_stale_why   := 'week_final';
    END IF;
    -- `upcoming`: nothing has been scored yet, so there is nothing stale. A
    -- move that vacated no CURRENT-week slot changes no starter set at all, so
    -- there is no score to chase and a `score_stale` there would be a false
    -- alarm in the one field whose whole job is to be believed (R969).

    -- (15) THE RECEIPT (§10.3, §15.4:1690). Exactly one audit row, in THIS
    --      transaction, INSIDE the no-op guard and AFTER the state write —
    --      D336 part (2) in its plain order, because nothing here forces
    --      126's inversion: no trigger guards these tables and the only FK to
    --      `commissioner_actions` is the `transactions` row written BELOW.
    v_after := CASE
      WHEN v_gain_player IS NOT NULL THEN jsonb_build_object(
        'team_id', v_gain_team, 'slot_key', 'bn', 'acquisition_type', 'commissioner')
      ELSE jsonb_build_object('team_id', NULL, 'slot_key', NULL, 'acquisition_type', NULL) END;
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), v_action_type, 'player',
      COALESCE(v_gain_player, v_lose_player), v_reason,
      v_before, v_after,
      jsonb_build_object(
        'verb',                p_verb,
        'arm',                 v_arm,
        'season',              v_league.season,
        'current_week',        v_current,
        'week_status',         v_week_status,
        'action_id',           p_action_id,
        'affected_team_ids',   v_affected,                 -- D353
        'from_team_id',        v_lose_team,
        'to_team_id',          v_gain_team,
        'from_team_name',      CASE WHEN v_lose_team = v_team_a.id THEN v_team_a.name
                                    WHEN v_is_move AND v_lose_team = v_team_b.id THEN v_team_b.name END,
        'to_team_name',        CASE WHEN v_gain_team = v_team_a.id THEN v_team_a.name
                                    WHEN v_is_move AND v_gain_team = v_team_b.id THEN v_team_b.name END,
        'add_player_id',       v_gain_player,
        'drop_player_id',      v_lose_player,
        'drop_before',         v_before_drop,
        'drop_to_state',       v_drop_to_state,
        'player_name',         COALESCE(v_gain_p.full_name, v_lose_p.full_name),
        'transaction_id',      v_txn_id,
        -- The whole point of the verb, made legible: every rule this override
        -- walked past, with the lock documents that prove each claim.
        'bypassed',            v_bypassed,
        'drop_game_lock',      v_lose_lock,
        'add_game_lock',       v_gain_lock,
        'lineups',             v_lineups,
        'score_enqueued',      v_enqueued,
        'score_not_enqueued',  v_not_enq,
        'score_reach_enqueued', v_reach_enq,
        'score_reachable',     v_reachable,
        'score_stale',         v_score_stale,
        'score_stale_reason',  v_stale_why),
      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM on the force
      -- add / drop arm: the commissioner made this team's roster move, the
      -- act roster_add_drop gives its manager (§10.3:711; TD16 — the manager
      -- verb's commissioner door is this override, standing rule (h)). A MOVE
      -- acts on two teams and for neither: NULL, both ride in
      -- affected_team_ids (D353). His OWN team is his own act: NULL (R1334).
      CASE WHEN v_is_move OR EXISTS (SELECT 1 FROM public.league_members m
                                     WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)
           THEN NULL ELSE p_team_id END);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION '%: the audit row was not written — refusing to let the roster move stand without its receipt (§10.3)', p_verb
        USING ERRCODE = 'P0001';
    END IF;

    -- (16) §10.3: override system messages auto-post to league chat and CANNOT
    --      be disabled. D97/D290's in-txn post, worded as the roster override.
    v_message := CASE WHEN v_is_move
      THEN v_lose_p.full_name || ' moved from ' || v_team_a.name || ' to ' || v_team_b.name
      ELSE v_team_a.name || ': '
           || CASE WHEN v_gain_player IS NOT NULL THEN 'added ' || v_gain_p.full_name ELSE '' END
           || CASE WHEN v_gain_player IS NOT NULL AND v_lose_player IS NOT NULL THEN ', ' ELSE '' END
           || CASE WHEN v_lose_player IS NOT NULL THEN 'dropped ' || v_lose_p.full_name ELSE '' END
      END
      || ' by ' || public.draft_actor_name() || ' (commissioner override'
      || CASE WHEN jsonb_array_length(v_bypassed) > 0
              THEN ', ' || jsonb_array_length(v_bypassed) || ' rule'
                   || CASE WHEN jsonb_array_length(v_bypassed) = 1 THEN '' ELSE 's' END || ' bypassed'
              ELSE '' END
      || ')'
      || CASE WHEN v_vacated IS NOT NULL
              THEN ' — a week-' || v_current || ' starting slot was emptied'
              ELSE '' END
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   p_verb,
    'action_type',            v_action_type,
    'arm',                    v_arm,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'week',                   v_current,
    'week_status',            v_week_status,
    'team_id',                CASE WHEN v_is_move THEN p_to_team_id ELSE p_team_id END,
    'from_team_id',           CASE WHEN v_is_move THEN p_from_team_id ELSE NULL END,
    'to_team_id',             CASE WHEN v_is_move THEN p_to_team_id ELSE NULL END,
    'player_id',              p_player_id,
    'add_player_id',          CASE WHEN v_is_move THEN NULL ELSE p_add END,
    'drop_player_id',         CASE WHEN v_is_move THEN NULL ELSE p_drop END,
    'moved_player_id',        CASE WHEN v_is_move THEN v_gain_player ELSE NULL END,
    'added_player_id',        CASE WHEN v_is_move THEN NULL ELSE v_gain_player END,
    'dropped_player_id',      CASE WHEN v_is_move THEN NULL ELSE v_lose_player END,
    'drop_to_state',          v_drop_to_state,
    'drop_waivers_until',     v_drop_until,
    'pool_from_state',        v_pool_from,
    'acquisition_type',       CASE WHEN v_gain_player IS NULL THEN NULL ELSE 'commissioner' END,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                CASE WHEN v_is_move
                                  THEN 'already_on_destination — the requested end state already held, so nothing was written and no receipt was issued (PROGRESS standing rule (b))'
                                  ELSE 'end_state_already_held — the add is already on this roster and/or the drop is already on none, so nothing was written and no receipt was issued (PROGRESS standing rule (b))'
                                END END,
    'commissioner_action_id', v_audit_id,      -- NULL on a no-op, and that is the point
    'transaction_id',         CASE WHEN v_no_changes THEN NULL ELSE v_txn_id END,
    'affected_team_ids',      v_affected,      -- D353
    'bypassed',               v_bypassed,
    'drop_game_lock',         v_lose_lock,
    'add_game_lock',          v_gain_lock,
    'lineups',                v_lineups,
    'vacated_current_slot',   v_vacated,
    'roster', jsonb_build_object(
      'roster_size',   v_roster_size,
      'count_after_a', CASE WHEN v_no_changes THEN NULL ELSE v_exp_a END,
      'count_after_b', CASE WHEN v_no_changes OR NOT v_is_move THEN NULL ELSE v_exp_b END),
    'caps', jsonb_build_object(
      'acquisitions_per_week',   v_cap_week_txt,
      'acquisitions_per_season', v_cap_season_txt,
      -- STATED, NOT DISCOVERED (§4 rule 15): 115:497-506 counts a team's
      -- acquisitions by `initiator_team_id`, and D353's shape writes that
      -- column NULL — so a commissioner force-add neither obeys the cap nor
      -- consumes it. Said here so a league reading its own budget is not
      -- surprised by a number that did not move.
      'commissioner_move_not_counted', TRUE,
      -- R1022: WHOSE counts these are, said in the document. A cap throttles
      -- the ACQUIRING team, which on a move is the destination — not v_team_a.
      'team_id',            v_cap_team,
      'used_week_before',   v_used_week,
      'used_season_before', v_used_season),
    'score_enqueued',         v_enqueued,
    'score_not_enqueued',     v_not_enq,
    -- F353: the players queued ONLY so the drain REACHES this league-week,
    -- because the worker maps a queued player to leagues through
    -- `league_rosters` and a DROPPED player maps to none. `score_reachable` is
    -- the measured answer to that question, not an inference from the above.
    'score_reach_enqueued',   v_reach_enq,
    'score_reachable',        v_reachable,
    'score_stale',            v_score_stale,
    'score_stale_reason',     v_stale_why,
    'edited_by_commish',      NOT v_no_changes,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at);

  IF NOT v_no_changes THEN
    -- (17) THE TRANSACTIONS ROW — §12.9's unified in-season activity log, and
    --      the FIRST writer of `related_action_id` (109:239-250; the FK landed
    --      at 123:461-462). `initiator_team_id` is NULL because no TEAM
    --      initiated this, which is the column's documented meaning and is
    --      also what keeps the move out of the team's acquisition count.
    --      Written after the receipt because it REFERENCES it.
    INSERT INTO public.transactions
      (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id, related_action_id)
    VALUES (v_txn_id, p_league_id, 'commissioner_move', 'complete', NULL, auth.uid(), v_result, v_current, p_action_id, v_audit_id);
  END IF;

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266's
  -- posture): an action_id is consumed by its submit whether or not anything
  -- moved, so a retry replays instead of re-evaluating. This is the OPPOSITE
  -- rule from the audit row above, and deliberately so — §12.26: "an action_id
  -- is an idempotency key, not an audit record".
  INSERT INTO public.commish_roster_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, CASE WHEN v_is_move THEN p_to_team_id ELSE p_team_id END, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- create_league_invite — 169:1180-1348 FILE TEXT (D137), 4 hunks (+4 / -9).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_league_invite(
  p_league_id UUID,
  p_target_team_id UUID DEFAULT NULL,
  p_invited_email TEXT DEFAULT NULL,
  p_invited_username TEXT DEFAULT NULL,
  p_max_uses INTEGER DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_invitee_id UUID;
  v_canonical_username TEXT;
  v_team RECORD;
  v_team_name TEXT; -- NULL for general invites (v_team stays unassigned then)
  v_existing RECORD;
  v_invite RECORD;
  v_prev_sent TIMESTAMPTZ;  -- 169/L.E1.30: the re-sent invite's last send, for the receipt
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_league_invite: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  -- In-body authorization (§12.0/§8.3): commissioner or co-commissioner.
  -- A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'create_league_invite: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.id, l.name INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_league_invite: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_max_uses IS NULL OR p_max_uses < 1 THEN
    RAISE EXCEPTION 'create_league_invite: max_uses must be at least 1'
      USING ERRCODE = '22023';
  END IF;
  IF p_invited_email IS NOT NULL AND p_invited_username IS NOT NULL THEN
    RAISE EXCEPTION 'create_league_invite: an invite targets an email OR a username, not both (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_max_uses > 1 AND (p_invited_email IS NOT NULL OR p_invited_username IS NOT NULL) THEN
    RAISE EXCEPTION 'create_league_invite: an invite for a named person or email can be used once — set its uses to 1'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_invited_email IS NOT NULL AND position('@' IN p_invited_email) <= 1 THEN
    RAISE EXCEPTION 'create_league_invite: that email address doesn''t look right'
      USING ERRCODE = 'P0001';
  END IF;

  -- §7.2 path 3: username invites require an existing account. Matched via
  -- lower(username) (D36); the CANONICAL handle is stored.
  IF p_invited_username IS NOT NULL THEN
    SELECT p.id, p.username INTO v_invitee_id, v_canonical_username
    FROM public.profiles p
    WHERE lower(p.username) = lower(btrim(p_invited_username));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_league_invite: no FieldScout account with the username "%" — username invites require an existing account (§7.2); use an email invite instead', btrim(p_invited_username)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Seat-targeted: the team must be one of THIS league's franchises.
  IF p_target_team_id IS NOT NULL THEN
    SELECT t.id, t.name, t.status INTO v_team
    FROM public.teams t
    WHERE t.id = p_target_team_id AND t.league_id = p_league_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_league_invite: that team isn''t in this league'
        USING ERRCODE = 'P0001';
    END IF;
    v_team_name := v_team.name;
  END IF;

  -- RE-SEND (D46): an identical LIVE identity-targeted invite is re-sent,
  -- not duplicated — last_sent_at stamps the send; created_at remains the
  -- initial-send record.
  IF p_invited_email IS NOT NULL OR p_invited_username IS NOT NULL THEN
    SELECT i.id, i.token, i.expires_at INTO v_existing
    FROM public.league_invites i
    WHERE i.league_id = p_league_id
      AND i.target_team_id IS NOT DISTINCT FROM p_target_team_id
      AND lower(i.invited_email::text) IS NOT DISTINCT FROM lower(p_invited_email)
      AND lower(i.invited_username::text) IS NOT DISTINCT FROM lower(v_canonical_username)
      AND i.revoked_at IS NULL
      AND i.use_count < i.max_uses
      AND now() < i.expires_at
    ORDER BY i.created_at
    LIMIT 1
    FOR UPDATE OF i;
    IF FOUND THEN
      v_prev_sent := (SELECT i.last_sent_at FROM public.league_invites i WHERE i.id = v_existing.id);  -- 169/L.E1.30
      UPDATE public.league_invites
      SET last_sent_at = now()
      WHERE id = v_existing.id;
      -- 169/L.E1.30 (F32) — THE RECEIPT for a re-send (D46): the invite and
      -- its seat, never the token or who it was sent to (TD9).
      PERFORM public.draft_commish_receipt_internal(
        p_league_id, FALSE, 'create_league_invite', 'resend_invite', 'invite',
        v_existing.id::text, NULL,
        jsonb_build_object('last_sent_at', v_prev_sent),
        jsonb_build_object('last_sent_at', now()),
        jsonb_build_object('target_team_id', p_target_team_id, 'team_name', v_team_name,
                           'kind', CASE WHEN p_invited_email IS NOT NULL THEN 'email' ELSE 'username' END,
                           'affected_team_ids', CASE WHEN p_target_team_id IS NULL THEN '[]'::jsonb
                                                     ELSE jsonb_build_array(p_target_team_id) END));
      IF v_invitee_id IS NOT NULL THEN
        PERFORM public.notify_league_invite_internal(
          v_invitee_id, v_league.name, v_team_name, p_league_id, v_existing.token);
      END IF;
      RETURN jsonb_build_object(
        'invite_id', v_existing.id,
        'token', v_existing.token,
        'expires_at', v_existing.expires_at,
        'resent', true
      );
    END IF;
  END IF;

  INSERT INTO public.league_invites
    (league_id, target_team_id, invited_email, invited_username, created_by, max_uses)
  VALUES
    (p_league_id, p_target_team_id, p_invited_email, v_canonical_username, v_uid, p_max_uses)
  RETURNING id, token, expires_at INTO v_invite;

  -- 169/L.E1.30 (F32) — THE RECEIPT: "an invite for <team>" (or a league
  -- invite), its kind and its limits — never the token, the email or the
  -- username (TD9; the log is member-readable, §10.3).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'create_league_invite', 'create_invite', 'invite',
    v_invite.id::text, NULL,
    NULL,
    jsonb_build_object('target_team_id', p_target_team_id, 'team_name', v_team_name,
                       'kind', CASE WHEN p_invited_email IS NOT NULL THEN 'email'
                                    WHEN p_invited_username IS NOT NULL THEN 'username'
                                    ELSE 'link' END,
                       'max_uses', p_max_uses, 'expires_at', v_invite.expires_at),
    jsonb_build_object('affected_team_ids', CASE WHEN p_target_team_id IS NULL THEN '[]'::jsonb
                                                 ELSE jsonb_build_array(p_target_team_id) END));

  -- In-app notification for username invites (task item 3) — guarded so a
  -- notification failure can never break the invite write.
  IF v_invitee_id IS NOT NULL THEN
    PERFORM public.notify_league_invite_internal(
      v_invitee_id, v_league.name, v_team_name, p_league_id, v_invite.token);
  END IF;

  RETURN jsonb_build_object(
    'invite_id', v_invite.id,
    'token', v_invite.token,
    'expires_at', v_invite.expires_at,
    'resent', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- draft_team_budget — 095:3503-3607 FILE TEXT (D137), 2 hunks (+5 / -7).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_team_budget(
  p_draft_id UUID,
  p_team_id UUID
)
RETURNS TABLE (remaining INTEGER, open_slots INTEGER, max_bid INTEGER, committed INTEGER)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_budget     INTEGER;
  v_reserve    INTEGER;
  v_adjustment INTEGER;
  v_committed  INTEGER;
  v_filled     INTEGER;
  v_open       INTEGER;
  v_remaining  INTEGER;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_team_budget: draft % not found (or not visible)', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Budgets are an auction concept: a snake board writes no price, so any
  -- number produced here for one would be a plausible-looking fiction.
  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_team_budget: draft % is a % draft — budgets apply to auctions only (§8.6)',
      p_draft_id, v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  -- The membership guard uses the SAME team set the invariant checks —
  -- the league's franchises. A team outside it has no budget, and
  -- answering a plausible full one would be exactly the "nothing happened
  -- means it worked" trap this family raises on everywhere else: the
  -- answer is unknown, so it is LOUD (R321).
  -- 095/MP.3 — a STANDALONE mock has no league, so "active franchise of the
  -- league" is not a question that can be asked of it. Its team set is the
  -- seat map it was launched with: `drafts.draft_order`, which
  -- create_mock_draft validated as a permutation of the seats it minted.
  -- Same loudness, same shape, a different authority for the set — and the
  -- league branch below is 092's text unchanged (tasks-MP §4 rule 11).
  IF v_draft.league_id IS NULL THEN
    IF NOT (COALESCE(v_draft.draft_order, '[]'::jsonb) ? p_team_id::text) THEN
      RAISE EXCEPTION
        'draft_team_budget: team % is not a seat in standalone mock % (the draft order IS the team set)',
        p_team_id, p_draft_id
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = p_team_id
      AND t.league_id = v_draft.league_id
  ) THEN
    RAISE EXCEPTION
      'draft_team_budget: team % is not a team in draft %''s league',
      p_team_id, p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- total_rounds IS the auction's per-team roster capacity (D91/D126); an
  -- unset one would make open_slots NULL and every downstream comparison
  -- silently unknown.
  IF v_draft.total_rounds IS NULL OR v_draft.total_rounds < 1 THEN
    RAISE EXCEPTION
      'draft_team_budget: draft % has no roster capacity (total_rounds is %) — budgets are underivable',
      p_draft_id, COALESCE(v_draft.total_rounds::text, 'unset')
      USING ERRCODE = 'P0001';
  END IF;

  v_budget     := COALESCE((v_draft.config->>'auction_budget')::int, 200);   -- §7.3.8 defaults
  -- 092/AP.1: the per-slot RESERVE, through the ONE authority (D198(1);
  -- §7.3.8's auction_zero_dollar_nominations row). $1 with the toggle OFF,
  -- $0 with it ON — never a private COALESCE, and never the bid increment,
  -- which is the fixed $1 of §8.6.3 and lives nowhere near this line.
  v_reserve    := public.draft_auction_reserve(v_draft.config);
  v_adjustment := COALESCE((v_draft.budget_adjustments->>p_team_id::text)::int, 0);  -- D127

  SELECT COALESCE(SUM(p.price), 0)::int, COUNT(*)::int
    INTO v_committed, v_filled
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id
    AND p.team_id = p_team_id
    AND p.is_undone = FALSE;                     -- undone picks refund by derivation (D131)

  v_remaining := v_budget + v_adjustment - v_committed;
  v_open      := v_draft.total_rounds - v_filled;

  RETURN QUERY SELECT
    v_remaining,
    v_open,
    -- §8.6.1: max_bid = remaining − (open_slots − 1) × reserve. A complete
    -- roster bids nothing at all (E27) — that is the ONLY special case;
    -- the formula is otherwise unclamped so an insolvent state stays
    -- visible to draft_auction_solvent instead of being rounded away.
    CASE WHEN v_open <= 0 THEN 0
         ELSE v_remaining - ((v_open - 1) * v_reserve) END,
    v_committed;
END;
$$;

-- ---------------------------------------------------------------------------
-- playoff_bracket_sync_internal — 140:93-499 FILE TEXT (D137), 1 hunk (+1 / -1).
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

-- ---------------------------------------------------------------------------
-- roster_add_drop_internal — 157:1738-2278 FILE TEXT (D137), 1 hunk (+1 / -5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roster_add_drop_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT,
  p_drop      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_team          public.teams;
  v_txn           public.transactions;
  v_found         BOOLEAN;
  v_is_manager    BOOLEAN;
  v_current       INTEGER;
  v_mode          TEXT;
  v_waiver_type   TEXT;
  v_sched         JSONB;      -- 149 (Q70): the league's waiver schedule, parsed by name
  v_fa_window     JSONB;      -- 149 (Q70): the free-agency window at p_at
  v_cap_week_txt  TEXT;
  v_cap_season_txt TEXT;
  v_cap_week      INTEGER;    -- NULL = unlimited
  v_cap_season    INTEGER;    -- NULL = unlimited
  v_hold_hours    INTEGER;
  v_roster_size   INTEGER;
  v_roster_count  INTEGER;
  v_after_count   INTEGER;
  v_used_week     INTEGER;
  v_used_season   INTEGER;
  v_drop_row      public.league_rosters;
  v_drop_p        public.players;
  v_add_p         public.players;
  v_owner_team    public.teams;
  v_pool          public.league_player_pool;
  v_pool_add_from TEXT;
  v_drop_to_state TEXT;
  v_drop_until    TIMESTAMPTZ;
  v_hold_early    BOOLEAN := FALSE;
  v_drop_lock     JSONB;
  v_add_lock      JSONB;
  v_txn_id        UUID := gen_random_uuid();
  v_result        JSONB;
  v_lineups       JSONB := '[]'::jsonb;
  v_row           public.team_lineups;
  v_map           JSONB;
  v_key           TEXT;
  v_locked        BOOLEAN;
  v_window        RECORD;
  v_k             RECORD;
  v_starters      JSONB;
  v_bench         JSONB;
  v_cnt           INTEGER;
  v_changed       BOOLEAN;
  v_week_end      TIMESTAMPTZ;   -- 152 / F437: the current week's end (153: its lock release — Q78's ceiling)
  v_from_week     INTEGER;       -- 152 / F437: the first unfinished week
BEGIN
  -- (0) shape
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: p_action_id is required (idempotency key — one UUID per move, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NULL AND p_drop IS NULL THEN
    RAISE EXCEPTION 'roster_add_drop: nothing to do — give a player to add, a player to drop, or both (§13.1)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NOT NULL AND p_add = p_drop THEN
    RAISE EXCEPTION 'roster_add_drop: add and drop name the same player (%) — a move changes the roster (§13.1)', p_add
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (rule 8; D294's one serialization point).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35): the manager of THIS team, never a stint. One
  --     no-leak 42501; a commissioner acting on another team is refused the
  --     same way (his roster move is M6's commissioner_move — banner §(2)).
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  IF NOT v_found OR NOT v_is_manager THEN
    RAISE EXCEPTION 'roster_add_drop: not the manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2; kind- and team-scoped — R732).
  SELECT t.* INTO v_txn
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
  IF FOUND THEN
    IF v_txn.type <> 'add_drop' THEN
      RAISE EXCEPTION
        'roster_add_drop: action_id % already names a % transaction in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_txn.type
        USING ERRCODE = 'P0001';
    END IF;
    IF v_txn.initiator_team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION
        'roster_add_drop: action_id % belongs to another team''s move in this league — an action_id identifies ONE submit (R732)',
        p_action_id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_txn.payload;
  END IF;

  -- (4) league / team / calendar
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'roster_add_drop: league % is % — rosters change through add/drop only while in_season or in playoffs (§13.1)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'roster_add_drop: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: league % has no season schedule yet, so there is no week to check game-day locks and pickup limits against',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- settings (§7.3.4; typed column for waiver_type + lineup_lock, the blob for the rest)
  v_mode         := COALESCE(v_league.lineup_lock, 'per_player_kickoff');
  v_waiver_type  := COALESCE(v_league.waiver_type, 'faab');
  -- 149 (Q70 as ruled): the waiver SCHEDULE replaces the retired
  -- waiver_period_hours / free_agency pair (149's CHECK refuses both keys);
  -- parsed and validated by name, defaults = the §7.3.4 catalog's.
  v_sched        := public.waiver_schedule_internal(v_league.settings, v_waiver_type);
  v_hold_hours   := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);
  v_cap_week_txt   := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_cap_season_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_cap_week   := CASE WHEN v_cap_week_txt   = 'unlimited' THEN NULL ELSE v_cap_week_txt::int   END;
  v_cap_season := CASE WHEN v_cap_season_txt = 'unlimited' THEN NULL ELSE v_cap_season_txt::int END;
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;
  SELECT count(*)::int INTO v_roster_count
  FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id;

  -- CAPS, COUNTED BEFORE EITHER SIDE (§7.3.4; R763): this team's `complete`
  -- rows whose payload carries `add_player_id` (a drop-only move never counts
  -- — it is not an acquisition). These run here rather than inside the add
  -- branch because the RESULT reports `caps.used_week_after` /
  -- `used_season_after` on EVERY move: a drop-only call read them unassigned
  -- and reported NULL to a capped league, which L.D4.2 would render as
  -- "null of 3" (F227(f)). The enforcement below is still the add side's
  -- alone.
  SELECT count(*)::int INTO v_used_week
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = p_team_id
    AND t.status = 'complete' AND t.week = v_current
    AND (t.payload ->> 'add_player_id') IS NOT NULL;
  SELECT count(*)::int INTO v_used_season
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = p_team_id
    AND t.status = 'complete'
    AND (t.payload ->> 'add_player_id') IS NOT NULL;

  -- (5) THE DROP
  IF p_drop IS NOT NULL THEN
    SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: no player with id % (drop)', p_drop USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_drop_row
    FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: % (%) is not on %''s roster — nobody in league % rosters him (§13.1)',
        v_drop_p.full_name, p_drop, v_team.name, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_drop_row.team_id <> p_team_id THEN
      SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_drop_row.team_id;
      RAISE EXCEPTION 'roster_add_drop: % (%) is on %''s roster, not %''s — a manager drops only his own players (§13.1)',
        v_drop_p.full_name, p_drop, v_owner_team.name, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    -- E32, the DROP side (independent of the add side — the DoD probe).
    -- Q34(B) (Chris, 2026-09-05; migration 115): UNCONDITIONAL — no setting
    -- turns it off (the toggle is RETIRED entirely, Q35 (a)); the release is
    -- the week's `last_game_ends_at` (NULL = still locked, said in the text).
    v_drop_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_drop, p_at);   -- 157 / F447: judged per player (played this week)
    IF (v_drop_lock ->> 'locked')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is locked for drops — kicked off at % (%); week % clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
        v_drop_p.full_name, p_drop, v_drop_lock ->> 'kickoff_at', v_drop_lock ->> 'datum_arm',
        v_drop_lock ->> 'week', COALESCE(v_drop_lock ->> 'window_ends_at', 'an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked')
        USING ERRCODE = 'P0001';
    END IF;
    -- fa_hold_hours (§7.3.4): an early drop of a free-agent add returns him
    -- to FA, not waivers. held ≥ hold ⇒ waivers (the boundary is inclusive).
    v_hold_early := v_drop_row.acquisition_type = 'free_agent'
                    AND v_hold_hours > 0
                    AND v_drop_row.acquired_at IS NOT NULL
                    AND p_at < v_drop_row.acquired_at + make_interval(hours => v_hold_hours);
    IF v_hold_early OR v_waiver_type = 'none_fcfs' THEN
      v_drop_to_state := 'free_agent';
      v_drop_until := NULL;
    ELSE
      -- 149 (Q70 as ruled): a dropped player is on waivers until the NEXT
      -- scheduled waiver run (strictly after this instant) — never a fixed
      -- number of hours.
      v_drop_to_state := 'on_waivers';
      v_drop_until := public.waiver_next_run_internal(v_sched, p_at);
    END IF;
  END IF;

  -- (6) THE ADD
  IF p_add IS NOT NULL THEN
    SELECT p.* INTO v_add_p FROM public.players p WHERE p.id = p_add;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: no player with id % (add)', p_add USING ERRCODE = 'P0001';
    END IF;
    -- EXCLUSIVITY (business rule 7 / §12.7) — friendly, never a raw 23505.
    SELECT t.* INTO v_owner_team
    FROM public.league_rosters r JOIN public.teams t ON t.id = r.team_id
    WHERE r.league_id = p_league_id AND r.player_id = p_add;
    IF FOUND THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is already on %''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
        v_add_p.full_name, p_add, v_owner_team.name
        USING ERRCODE = 'P0001';
    END IF;
    -- POOL STATE (lazy rows: no row = free_agent, D294).
    SELECT pp.* INTO v_pool FROM public.league_player_pool pp
    WHERE pp.league_id = p_league_id AND pp.player_id = p_add;
    IF NOT FOUND THEN
      v_pool_add_from := 'free_agent';
    ELSIF v_pool.state = 'on_waivers' THEN
      -- 149: whether his waiver hold is still running is decided BELOW, after
      -- the game-day lock (Q74 — a kicked-off player is refused as locked,
      -- never offered a claim). The M4 interim (Q33 — FCFS at the lapse
      -- under both free_agency values) is REPLACED by the schedule.
      v_pool_add_from := 'on_waivers_lapsed';
    ELSIF v_pool.state = 'rostered' THEN
      -- No roster row (checked above) but a rostered pool row: the mirror is
      -- broken — asserted, not trusted (D294); reconciliation (L.D2.3) fixes.
      RAISE EXCEPTION
        'roster_add_drop: league_player_pool says % (%) is rostered in league % but league_rosters has no row — the pool mirror is broken; refusing until reconciliation (L.D2.3) repairs it (D294)',
        v_add_p.full_name, p_add, p_league_id
        USING ERRCODE = 'P0001';
    ELSE
      -- free_agent, or L.D1.6's locked_in_game (the games table decides below —
      -- never the stored state, rule 9).
      v_pool_add_from := v_pool.state;
    END IF;
    -- E32, the ADD side. Q34(B) + Q35 (a) (115): UNCONDITIONAL too —
    -- "picking up a player mid-game makes no sense" (Chris, 2026-09-05).
    v_add_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_add, p_at);   -- 157 / F447: judged per player (played this week)
    IF (v_add_lock ->> 'locked')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is locked for adds — kicked off at % (%); week % clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
        v_add_p.full_name, p_add, v_add_lock ->> 'kickoff_at', v_add_lock ->> 'datum_arm',
        v_add_lock ->> 'week', COALESCE(v_add_lock ->> 'window_ends_at', 'an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked')
        USING ERRCODE = 'P0001';
    END IF;
    -- 149 (Q70 as ruled; Q74): THE WAIVER STATE — checked AFTER the lock, so
    -- a player whose game has started is refused as locked (the same message
    -- as always), never told to put in a claim the claim verb will refuse.
    --  (a) his own waiver hold: a dropped player is on waivers until the next
    --      run — and, once the processor tracks the league
    --      (`waiver_next_run_at` set), until that run is SETTLED: a hold whose
    --      run is due but unprocessed still refuses, so no instant add beats
    --      the claims the run is settling (E8).
    --  (b) the league's free-agency window: outside it every unowned player
    --      is claim-only until the next run (after the draft, until the first
    --      run after it; after the week's last game, until the next run).
    v_fa_window := public.waiver_window_internal(v_league, p_at);
    IF v_pool_add_from = 'on_waivers_lapsed'
       AND (v_pool.waivers_until > p_at
            OR (v_league.waiver_next_run_at IS NOT NULL AND v_pool.waivers_until >= v_league.waiver_next_run_at)) THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is on waivers until the waiver run at % (%) — put in a waiver claim; he is not an instant pickup until that run has been processed (§7.3.4/§13.1)',
        v_add_p.full_name, p_add, v_pool.waivers_until,
        to_char(v_pool.waivers_until AT TIME ZONE (v_sched ->> 'time_zone'), 'Dy YYYY-MM-DD HH24:MI') || ' ' || (v_sched ->> 'time_zone')
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT (v_fa_window ->> 'free_agency_open')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is claim-only right now — %; put in a waiver claim instead: claims settle at the next waiver run, % (%) (§7.3.4/§13.1)',
        v_add_p.full_name, p_add,
        CASE v_fa_window ->> 'why'
          WHEN 'awaiting_run' THEN 'no waiver run has happened since '
               || CASE v_fa_window ->> 'reset_kind' WHEN 'draft' THEN 'the draft' ELSE 'the week''s last game ended' END
          WHEN 'run_pending' THEN 'the waiver run at '   -- R1190: in the league's zone, like the next run
               || to_char((v_fa_window ->> 'scheduled_last_run_at')::timestamptz AT TIME ZONE (v_sched ->> 'time_zone'), 'Dy YYYY-MM-DD HH24:MI')
               || ' ' || (v_sched ->> 'time_zone') || ' is still being processed'
          WHEN 'before_opening_time' THEN 'free agency opens ' || initcap(v_sched ->> 'free_agency_open_day') || ' '
               || (v_sched ->> 'free_agency_open_time') || ' ' || (v_sched ->> 'time_zone')
          WHEN 'claims_only' THEN 'this league has no free agency — every pickup is a waiver claim'
          ELSE COALESCE(v_fa_window ->> 'why', 'unknown') END,
        v_fa_window ->> 'next_run_at',
        to_char((v_fa_window ->> 'next_run_at')::timestamptz AT TIME ZONE (v_sched ->> 'time_zone'), 'Dy YYYY-MM-DD HH24:MI') || ' ' || (v_sched ->> 'time_zone')
        USING ERRCODE = 'P0001';
    END IF;
    -- CAPACITY (§7.3.2 roster_size; §13.1 "drop one to stay within roster_size").
    v_after_count := v_roster_count + 1 - CASE WHEN p_drop IS NOT NULL THEN 1 ELSE 0 END;
    IF v_after_count > v_roster_size THEN
      RAISE EXCEPTION
        'roster_add_drop: %''s roster is full (% of % — §7.3.2 roster_size) — include a drop in the same move (§13.1)',
        v_team.name, v_roster_count, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
    -- CAPS (§7.3.4) — the counts were taken above (R763); only the ADD side
    -- enforces them.
    IF v_cap_week IS NOT NULL AND v_used_week >= v_cap_week THEN
      RAISE EXCEPTION
        'roster_add_drop: % has used % of % acquisitions in week % (acquisitions_per_week, §7.3.4) — no more adds this week',
        v_team.name, v_used_week, v_cap_week, v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF v_cap_season IS NOT NULL AND v_used_season >= v_cap_season THEN
      RAISE EXCEPTION
        'roster_add_drop: % has used % of % acquisitions this season (acquisitions_per_season, §7.3.4) — no more adds this season',
        v_team.name, v_used_season, v_cap_season
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_after_count := v_roster_count - 1;
  END IF;

  -- (7) WRITES
  IF p_drop IS NOT NULL THEN
    DELETE FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = p_drop;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'roster_add_drop: the drop of % deleted % roster rows, expected 1', p_drop, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league_id, p_drop, v_drop_to_state, v_drop_until, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
  END IF;

  IF p_add IS NOT NULL THEN
    BEGIN
      INSERT INTO public.league_rosters
        (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
      VALUES (p_league_id, p_team_id, p_add, 'bn', 'free_agent', 0, p_at);
    EXCEPTION WHEN unique_violation THEN
      -- 072's UNIQUE, kept as an UNPINNABLE backstop (R757/D276): the league
      -- row lock in (1) serializes every racer behind the exclusivity
      -- pre-check, so this branch is unreachable in practice — it exists so
      -- a raw 23505 can never reach the wire if that lock is ever weakened.
      RAISE EXCEPTION
        'roster_add_drop: % (%) was rostered by another team in this league a moment ago — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
        v_add_p.full_name, p_add
        USING ERRCODE = 'P0001';
    END;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league_id, p_add, 'rostered', NULL, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
  END IF;

  -- THE LINEUP CONSEQUENCES (banner: THE LINEUP INTERPLAY; F224(i)) — every
  -- row of this team from the first UNFINISHED week on (152 / F437).
  -- F437: the first UNFINISHED week is the current week while its last
  -- game has not ended, the next one once it has (151's trade executor's
  -- rule, D410(5)). A finished week's lineup is
  -- the record the score worker and the nightly reconcile score it from
  -- (score-week-worker.ts step 5 reads THE WEEK's slot_map), and stat
  -- corrections re-score it until its window closes — clearing a played
  -- starter from it would erase his points from the team that played him.
  -- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,
  -- or its Wednesday 00:00 Pacific ceiling when that comes first. The
  -- ceiling releases a played starter, so it must finish the week for
  -- lineups too: otherwise, in a league's LAST week (no week N+1 row to
  -- flip the current week), a move at the ceiling would clear his start.
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
  WHERE w.season = v_league.season AND w.week = v_current;
  v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;
  FOR v_row IN
    SELECT tl.* FROM public.team_lineups tl
    WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week >= v_from_week
    ORDER BY tl.week
    FOR UPDATE
  LOOP
    v_map := COALESCE(v_row.slot_map, '{}'::jsonb);
    v_starters := COALESCE(v_row.starters, '[]'::jsonb);
    v_bench := COALESCE(v_row.bench, '[]'::jsonb);
    v_changed := FALSE;
    IF p_drop IS NOT NULL THEN
      SELECT e.key INTO v_key FROM jsonb_each_text(v_map) e WHERE e.value = p_drop LIMIT 1;
      IF v_key IS NOT NULL THEN
        -- Q32 (Chris, 2026-09-03): droppability keys on the PLAYER's own
        -- kickoff (E32), never on his slot's lock state — so a droppable
        -- player has not played in any week this loop touches (a
        -- finished week is never touched — 152 / F437) and there is
        -- nothing to keep: the entry is ALWAYS cleared (the slot reads empty; 112 lets a player whose own
        -- kickoff is ahead take the empty slot — 114 retired the whole-week
        -- lock, so that is the only rule).
        -- IR keys are roster-level spots — cleared the same way.
        v_map := v_map - v_key;
        SELECT COALESCE(jsonb_agg(
                 CASE WHEN s ->> 'slot' = v_key
                      THEN s || jsonb_build_object('player_id', NULL, 'position', NULL, 'kickoff_at', NULL, 'flags', '["empty"]'::jsonb)
                      ELSE s END ORDER BY ord), '[]'::jsonb)
        INTO v_starters
        FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord);
        v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', v_key);
        v_changed := TRUE;
      END IF;
      IF v_bench ? p_drop THEN
        SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
        FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') <> p_drop;
        -- R758: a bench-only drop reports its row too (slot NULL) — the
        -- result never under-reports which lineup rows the move touched.
        IF v_key IS NULL THEN
          v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', NULL);
        END IF;
        v_changed := TRUE;
      END IF;
    END IF;
    IF p_add IS NOT NULL AND NOT (v_bench ? p_add) THEN
      SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
      FROM jsonb_array_elements(v_bench || to_jsonb(p_add)) x;
      v_changed := TRUE;
    END IF;
    IF v_changed THEN
      UPDATE public.team_lineups SET slot_map = v_map, starters = v_starters, bench = v_bench
      WHERE id = v_row.id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'roster_add_drop: lineup sync for week % touched % rows, expected 1', v_row.week, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  -- (8) POST-WRITE ASSERTIONS (R703-class; D294's mirror asserted).
  IF p_add IS NOT NULL THEN
    IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = p_add) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = p_add) THEN
      RAISE EXCEPTION 'roster_add_drop: after the add, % is not exactly once on %''s roster in league % — refusing', p_add, v_team.name, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = p_league_id AND pp.player_id = p_add) IS DISTINCT FROM 'rostered' THEN
      RAISE EXCEPTION 'roster_add_drop: the pool mirror for % is not rostered after the add (D294) — refusing', p_add
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_drop IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = p_drop) THEN
      RAISE EXCEPTION 'roster_add_drop: after the drop, % is still rostered in league % — refusing', p_drop, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = p_league_id AND pp.player_id = p_drop) IS DISTINCT FROM v_drop_to_state THEN
      RAISE EXCEPTION 'roster_add_drop: the pool mirror for % is not % after the drop (D294) — refusing', p_drop, v_drop_to_state
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  SELECT count(*)::int INTO v_cnt
  FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF v_cnt <> v_after_count OR v_cnt > v_roster_size THEN
    RAISE EXCEPTION 'roster_add_drop: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
      v_team.name, v_cnt, v_after_count, v_roster_size
      USING ERRCODE = 'P0001';
  END IF;

  -- THE RESULT = the transactions payload (returned byte-identically on replay).
  v_result := jsonb_build_object(
    'transaction_id',        v_txn_id,
    'action_id',             p_action_id,
    'league_id',             p_league_id,
    'team_id',               p_team_id,
    'season',                v_league.season,
    'week',                  v_current,
    'type',                  'add_drop',
    'add_player_id',         p_add,
    'drop_player_id',        p_drop,
    'add', CASE WHEN p_add IS NULL THEN NULL ELSE jsonb_build_object(
      'player_id',        p_add,
      'name',             v_add_p.full_name,
      'position',         v_add_p.position,
      'nfl_team',         v_add_p.team,
      'from_state',       v_pool_add_from,
      'to_state',         'rostered',
      'acquisition_type', 'free_agent',
      'slot_key',         'bn',
      'acquired_at',      p_at,
      'game_lock',        v_add_lock,
      'free_agency',      v_fa_window) END,
    'drop', CASE WHEN p_drop IS NULL THEN NULL ELSE jsonb_build_object(
      'player_id',        p_drop,
      'name',             v_drop_p.full_name,
      'position',         v_drop_p.position,
      'nfl_team',         v_drop_p.team,
      'from_slot_key',    v_drop_row.slot_key,
      'to_state',         v_drop_to_state,
      'waivers_until',    v_drop_until,
      'fa_hold', jsonb_build_object(
        'hours',            v_hold_hours,
        'acquisition_type', v_drop_row.acquisition_type,
        'acquired_at',      v_drop_row.acquired_at,
        'early',            v_hold_early),
      'lineups',          v_lineups,
      'game_lock',        v_drop_lock) END,
    'roster', jsonb_build_object(
      'count_after', v_after_count,
      'roster_size', v_roster_size),
    'caps', jsonb_build_object(
      'acquisitions_per_week',   v_cap_week_txt,
      'acquisitions_per_season', v_cap_season_txt,
      -- both counts are assigned for EVERY move (R763) — a drop-only reports
      -- the unchanged totals, never NULL.
      'used_week_after',   v_used_week   + CASE WHEN p_add IS NULL THEN 0 ELSE 1 END,
      'used_season_after', v_used_season + CASE WHEN p_add IS NULL THEN 0 ELSE 1 END),
    'settings', jsonb_build_object(
      'lineup_lock',         v_mode,
      'waiver_type',         v_waiver_type,
      'waiver_schedule',     v_sched,
      'fa_hold_hours',       v_hold_hours),
    'evaluated_at',          p_at
  );

  INSERT INTO public.transactions (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
  VALUES (v_txn_id, p_league_id, 'add_drop', 'complete', p_team_id, auth.uid(), v_result, v_current, p_action_id);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- set_lineup_internal — 169:2258-2948 FILE TEXT (D137), 2 hunks (+2 / -6).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT DEFAULT NULL   -- REQUIRED (non-blank) when the actor is not the team's manager (R738 / D290)
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;   -- the CURRENT week's datum (IR moves are judged against it — R736)
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  v_stored_at   TEXT;
  v_locked      BOOLEAN;
  v_min_weeks   INTEGER;
  v_msg         TEXT;
  -- 152 / R1206: stored starters who PLAYED and have left this roster since
  -- (player_id → {kickoff_at, datum_arm, on_bye}) — fixed for the week.
  v_gone_kick   JSONB := '{}'::jsonb;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'set_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     One no-leak 42501 for "no such league", "not a member", "not this
  --     team's manager and not a commissioner".
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'set_lineup: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written.
  SELECT a.result INTO v_result
  FROM public.lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'set_lineup: league % is % — lineups are set only while in_season or in playoffs (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'set_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no season schedule yet, so there is no week to set a lineup in',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s schedule for season % (it runs weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  IF p_week < v_current THEN
    RAISE EXCEPTION
      'set_lineup: week % is in the past (the current week is %) — a past week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, v_current
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    RAISE EXCEPTION
      'set_lineup: week % of league % is % — a closed week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, p_league_id, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- The COMMISSIONER ARM carries the D290 interim audit posture (R738 / F40):
  -- a real change by an actor who is not this team's manager posts the
  -- in-txn system message below. RE-READ UNDER Q66 (migration 131 / L.E1.15,
  -- F362; spec v2.16.41 §10.3 / §15.4 — a commissioner setting another
  -- team's lineup IS a commissioner action): the reason is OPTIONAL, so it is
  -- NORMALISED here and never refused. Blank = nothing but whitespace
  -- INCLUDING tabs/newlines (R745) ⇒ NULL; bounded at 500 characters below,
  -- the client chat policy's own bound, so the system post stays bounded
  -- (R746) — that check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'set_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'set_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- (4b) 152 / R1206 (Q32's amendment, verbatim: "if they are in the lineup
  --      they are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN
  --      AFTER HE LEAVES THE ROSTER. Once a week's last game has ended the
  --      lock releases (E32 / 115) and a starter who played can be dropped,
  --      claimed away or traded, while the week is still current (live)
  --      until the next week starts; 152 keeps his finished-week start (the
  --      week is scored and re-scored from this slot_map). A stored STARTING
  --      slot whose player is not on this roster and whose OWN game for
  --      p_week has kicked off is therefore FIXED: carried through unchanged
  --      (the editor never holds an unrostered player — placementFromStored
  --      — so an omitted key is carried, not read as "empty it"), and a
  --      submit that puts anyone else there, or moves him, is refused by
  --      name. He joins v_by_pid (never v_roster: no bench, no roster write)
  --      so steps 7–10 treat him as the locked starter he is. A stored
  --      unrostered player whose game has NOT kicked off (a bye) did not
  --      play: his slot opens, as before.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',          p.id,
             'name',               p.full_name,
             'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation',        public.lineup_designation_internal(p.status),
             'nfl_team',           p.team,
             'ir_placed_week',     NULL,
             'ir_lock_until_week', NULL,
             'slot_key',           NULL,
             'off_roster',         TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    -- 154 / F441 · F442 · F445: ONE judgment, shared with the commissioner's
    -- editor and autopilot (lineup_kept_starter_internal). He STAYS when he
    -- PLAYED — his current NFL team's game kicked off, this lineup's own
    -- record of the slot says so, or he has a stat line for the week (F442: a
    -- player released or traded after playing still reads as played) — or
    -- when the week CLOSED to moves (its lock release: the last game's end or
    -- the Wednesday ceiling) before he left and he has a game this week
    -- (D412(5) / F445: a player of the unplayed game stays in the lineup that
    -- started him). A bye, or a game gone from the week, scores nothing: his
    -- slot opens, as before (D411(7)).
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(v_league.season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;
    IF ((p_slot_map ? v_key) AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid)
       OR EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE x.key <> v_key AND (x.value #>> '{}') = v_pid) THEN
      IF v_k.why = 'kicked_off' THEN
        RAISE EXCEPTION
          'set_lineup: % already played this week — his start stays (slot "%": his game kicked off at % (%); he has left %''s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)',
          v_e ->> 'name', v_key, v_k.kickoff_at, v_k.datum_arm, v_team.name
          USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION
        'set_lineup: % is held in this week''s lineup — his start stays (slot "%": %; he has left %''s roster since, and no move changes the start he holds this week — §11.2, Q32, D412(5); the week is scored from this lineup, §7.3.3)',
        v_e ->> 'name', v_key, v_k.detail, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_gone_kick := v_gone_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    p_slot_map := p_slot_map || jsonb_build_object(v_key, v_pid);   -- carried
  END LOOP;

  -- (5) VALIDATE THE SUBMITTED MAP: keys are slot instances or IR spots,
  --     values are this team's rostered players, each player exactly once.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'set_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'set_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'set_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'set_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — for p_week (the
  --     starters) and for the current week (IR moves) when they differ.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  -- 157 / F447: each ROSTERED player's kickoff is judged per PLAYER — his
  -- current NFL team's game, or, when that is still ahead (or he has no
  -- team), a start this league recorded for a game that kicked off or his
  -- stat line for the week (lineup_player_kickoff_internal): a player the
  -- NFL released or traded AFTER he played is still locked for the week.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> 'player_id', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> 'player_id', p_at);   -- 157 / F447
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  v_kick := v_kick || v_gone_kick;   -- 152 / R1206: (4b)'s played, since-unrostered starters
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) LOCKED PLAYERS NEVER MOVE (per_player_kickoff — the ONLY lineup lock,
  --     Q34(A)). Evaluated BEFORE the fit so a locked stored starter is a
  --     FIXED vertex, and a played player can neither enter nor change slots.
  --     114: the mode test that used to guard this block is gone — it is
  --     unconditional.
    -- (a) every stored starter whose game has kicked off must sit at the
    --     same key in the submitted map.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN NOT (v_by_pid ? v_pid);                       -- off the roster and NOT played (a played one is in v_by_pid since (4b) — 152 / R1206)
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: slot % is locked — % kicked off at % (%) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
          v_key, v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm'
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    -- (b) a player whose game has kicked off never enters a slot he was not
    --     already stored at.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (v_stored ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: %''s game kicked off at % (%) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "%"',
          v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm', v_key
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

  -- (8) THE FIT (E16). Input order: fixed (locked) players first, then the
  --     rest in submitted-key order — deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     x.fixed) ORDER BY x.fixed DESC, x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord,
           -- fixed = locked: the player's OWN kickoff has passed (R737 — a
           -- locked placement is a fact; 114: the whole-week arm is gone).
           ((v_kick -> (e.value #>> '{}') ->> 'kickoff_at') IS NOT NULL
            AND (v_kick -> (e.value #>> '{}') ->> 'kickoff_at')::timestamptz <= p_at)
           OR v_gone_kick ? (e.value #>> '{}') AS fixed   -- 154 / F445: a kept off-roster starter is FIXED even while his (postponed) game is ahead
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'set_lineup: % (%) cannot be placed — no legal arrangement of the started players fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- 114 (Q34(A)): the whole-week refusal that stood here is RETIRED. After the
  -- week's first kickoff every UNLOCKED slot of the lineup stays editable;
  -- only a slot whose own player has kicked off is closed (step 7).

  -- (9) IR MOVES, against the CURRENT week (banner: IR LAW).
  --     Placements: under an IR key now, not on IR (or on a different spot) before.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      -- a NEW placement (or a spot change, which is removal + placement)
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        RAISE EXCEPTION
          'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
          v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'set_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        RAISE EXCEPTION
          'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
          v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
          USING ERRCODE = 'P0001';
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  --     Removals: on IR before, not under any IR key now.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      RAISE EXCEPTION
        'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
        v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      RAISE EXCEPTION
        'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
        v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
        USING ERRCODE = 'P0001';
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  v_locked_at := NULL;   -- 114: the earliest STARTED player's kickoff (below), never a week datum
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE: a bye/OUT starter in an
      -- UNLOCKED slot blocks the submit by name.
      -- (a locked slot's bye/OUT player is not the manager's to change:
      --  exempt when the stored player's own game has kicked off, R739.)
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT ((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) = v_pid)
         AND NOT (v_gone_kick ? v_pid) THEN   -- 154 / F445: a kept off-roster starter is not the manager's to change
        RAISE EXCEPTION
          'set_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him or start someone who plays',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
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

  -- (11) NO-OP BY NAME (rule 10): the canonical map equals the stored map
  --      and no IR move — nothing is written but the ledger row.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = NOT v_is_manager,
        set_at            = now()
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'set_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- R738 / D290 / D97: a commissioner's change posts in-txn, reason in the
    -- text (the interim audit until commissioner_actions exists — F40).
    IF NOT v_is_manager THEN
      v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' set by '
        || public.draft_actor_name() || ' (commissioner)'
        || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional
      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
      VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
      -- 169/L.E1.30 (F514) — THE RECEIPT: a commissioner setting a team he
      -- does not manage is a commissioner action (D363(2)) — one row per
      -- changed lineup, the team acted for in acting_as_team_id (§10.3). The
      -- no-op re-save wrote nothing above; a manager's own save (the
      -- commissioner's own team included) is not this arm.
      PERFORM public.draft_commish_receipt_internal(
        p_league_id, FALSE, 'set_lineup', 'edit_lineup', 'team', p_team_id::text, v_reason,
        jsonb_build_object('slot_map', v_stored),
        jsonb_build_object('slot_map', v_canon)
          || CASE WHEN jsonb_array_length(v_ir_placed) + jsonb_array_length(v_ir_removed) > 0
                  THEN jsonb_build_object('ir_moves', jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed))
                  ELSE '{}'::jsonb END,
        jsonb_build_object('week', p_week, 'current_week', v_current, 'season', v_league.season,
                           'week_status', v_lw.status, 'team_name', v_team.name, 'action_id', p_action_id),
        p_team_id);
    END IF;

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week: starters → instance key, the rest
      -- (not on IR) → 'bn'. Counts asserted against the roster.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        CONTINUE WHEN v_gone_kick ? (v_val #>> '{}');   -- 152 / R1206: off this roster — no roster row of his to write
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick)) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key for % starters, expected %', v_expected,
          COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick))
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,   -- 114: the CHECK-constrained column value (only 'per_player_kickoff' exists)
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      NOT v_is_manager,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free)
  );

  INSERT INTO public.lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- trade_execute_internal — 180:645-1107 FILE TEXT (D137), 1 hunk (+0 / -5).
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

-- ---------------------------------------------------------------------------
-- trade_preview_internal — 162:389-584 FILE TEXT (D137), 1 hunk (+0 / -6).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_preview_internal(
  p_league_id    UUID,
  p_trade_id     UUID,
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_items        JSONB,
  p_drops        TEXT[],
  p_at           TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_trade     public.trades;
  v_from      public.teams;
  v_to        public.teams;
  v_mode      TEXT;
  v_items     JSONB := '[]'::jsonb;
  v_pdrops    TEXT[];
  v_rdrops    TEXT[];
  v_elem      JSONB;
  v_bad       TEXT;
  v_leg_from  UUID;
  v_amount    NUMERIC;
  v_in_season BOOLEAN;
  v_deadline  JSONB;
  v_refusal   TEXT := NULL;
  v_facts     JSONB := NULL;
  v_ok        BOOLEAN;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'trade_preview: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- (1) MEMBERSHIP — any member (every roster, balance and trade this reads
  --     is member-visible, §12.11). ONE no-leak 42501: no league, a deleted
  --     league, not a member.
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.league_members m WHERE m.league_id = p_league_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'trade_preview: not a member of this league' USING ERRCODE = '42501';
  END IF;

  -- (2) THE OFFER.
  IF p_trade_id IS NOT NULL THEN
    -- ACCEPT — 151's accept arm in shape: the stored legs (id order), the
    -- proposer's stored drops, the receiving team's drops as given; both
    -- sides ENFORCED.
    IF p_from_team_id IS NOT NULL OR p_to_team_id IS NOT NULL OR p_items IS NOT NULL THEN
      RAISE EXCEPTION 'trade_preview: an accept preview names the trade only — its teams and legs are the offer''s'
        USING ERRCODE = '22023';
    END IF;
    v_mode := 'accept';
    SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id AND t.league_id = p_league_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'trade_preview: no trade % in league %', p_trade_id, p_league_id USING ERRCODE = 'P0001';
    END IF;
    SELECT t.* INTO v_from FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
    SELECT t.* INTO v_to FROM public.teams t WHERE t.id = v_trade.recipient_team_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'player_id', i.player_id, 'faab_amount', i.faab_amount,
             'from_team_id', i.from_team_id, 'to_team_id', i.to_team_id) ORDER BY i.id), '[]'::jsonb)
    INTO v_items
    FROM public.trade_items i WHERE i.trade_id = p_trade_id;
    SELECT COALESCE(array_agg(d.player_id ORDER BY d.player_id), ARRAY[]::text[]) INTO v_pdrops
    FROM public.trade_drops d WHERE d.trade_id = p_trade_id AND d.team_id = v_trade.proposer_team_id;
    v_rdrops := COALESCE(p_drops, ARRAY[]::text[]);
    IF v_trade.status <> 'proposed' THEN
      v_refusal := format('trade_preview: this trade is already %s — only an offer still waiting for an answer can be accepted', v_trade.status);
    END IF;
  ELSE
    -- OFFER — what trade_propose (or a counter-offer) checks: the offering
    -- team's drops ENFORCED; the receiving team's side REPORTED (it names
    -- its drops when it accepts — E36).
    v_mode := 'offer';
    IF p_from_team_id IS NULL OR p_to_team_id IS NULL THEN
      RAISE EXCEPTION 'trade_preview: an offer preview names both teams — the offering team and the team it trades with'
        USING ERRCODE = '22023';
    END IF;
    SELECT t.* INTO v_from FROM public.teams t WHERE t.id = p_from_team_id;
    IF NOT FOUND OR v_from.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION 'trade_preview: team % is not a franchise of league %', p_from_team_id, p_league_id USING ERRCODE = 'P0001';
    END IF;
    SELECT t.* INTO v_to FROM public.teams t WHERE t.id = p_to_team_id;
    IF NOT FOUND OR v_to.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION 'trade_preview: team % is not a franchise of league %', p_to_team_id, p_league_id USING ERRCODE = 'P0001';
    END IF;
    IF v_from.id = v_to.id THEN
      RAISE EXCEPTION 'trade_preview: % cannot trade with itself — a trade is between two different teams', v_from.name
        USING ERRCODE = 'P0001';
    END IF;
    -- The legs, in 148's shape (trade_propose_core_internal's normalization:
    -- a malformed leg is a 22023, never a business refusal).
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'trade_preview: p_items is required — a JSON array of legs, each {"player_id": …} or {"faab_amount": …} with its "from_team_id"'
        USING ERRCODE = '22023';
    END IF;
    FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS x(e) LOOP
      IF jsonb_typeof(v_elem) <> 'object'
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_elem) AS k WHERE k NOT IN ('player_id', 'faab_amount', 'from_team_id'))
         OR jsonb_typeof(v_elem -> 'from_team_id') IS DISTINCT FROM 'string'
         OR (COALESCE(jsonb_typeof(v_elem -> 'player_id'), 'null') <> 'null') = (COALESCE(jsonb_typeof(v_elem -> 'faab_amount'), 'null') <> 'null') THEN
        RAISE EXCEPTION 'trade_preview: trade leg % must be {"player_id": …} or {"faab_amount": …} with its "from_team_id"', v_elem
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_leg_from := (v_elem ->> 'from_team_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'trade_preview: from_team_id % is not a team id', v_elem ->> 'from_team_id' USING ERRCODE = '22023';
      END;
      IF v_leg_from NOT IN (v_from.id, v_to.id) THEN
        RAISE EXCEPTION 'trade_preview: trade leg % comes from a team that is not in this trade (% or %)', v_elem, v_from.name, v_to.name
          USING ERRCODE = '22023';
      END IF;
      IF COALESCE(jsonb_typeof(v_elem -> 'player_id'), 'null') <> 'null' THEN
        IF jsonb_typeof(v_elem -> 'player_id') <> 'string' OR btrim(v_elem ->> 'player_id') = '' THEN
          RAISE EXCEPTION 'trade_preview: trade leg % has a player_id that is not a player id', v_elem USING ERRCODE = '22023';
        END IF;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'player_id', v_elem ->> 'player_id', 'faab_amount', NULL,
          'from_team_id', v_leg_from, 'to_team_id', CASE WHEN v_leg_from = v_from.id THEN v_to.id ELSE v_from.id END));
      ELSE
        IF jsonb_typeof(v_elem -> 'faab_amount') <> 'number' THEN
          RAISE EXCEPTION 'trade_preview: trade leg % has a faab_amount that is not a number', v_elem USING ERRCODE = '22023';
        END IF;
        v_amount := (v_elem ->> 'faab_amount')::numeric;
        IF v_amount <> trunc(v_amount) OR v_amount < 1 OR v_amount > 2147483647 THEN
          RAISE EXCEPTION 'trade_preview: a FAAB leg of % is not a whole number of dollars from $1 up', v_elem ->> 'faab_amount'
            USING ERRCODE = '22023';
        END IF;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'player_id', NULL, 'faab_amount', v_amount::int,
          'from_team_id', v_leg_from, 'to_team_id', CASE WHEN v_leg_from = v_from.id THEN v_to.id ELSE v_from.id END));
      END IF;
    END LOOP;
    SELECT string_agg(DISTINCT i.player_id, ', ') INTO v_bad
    FROM jsonb_to_recordset(v_items) AS i(player_id TEXT)
    WHERE i.player_id IS NOT NULL
      AND (SELECT count(*) FROM jsonb_to_recordset(v_items) AS j(player_id TEXT) WHERE j.player_id = i.player_id) > 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'trade_preview: the trade names % more than once — each player is one leg', v_bad USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_items) AS i(faab_amount INTEGER, from_team_id UUID)
               WHERE i.faab_amount IS NOT NULL GROUP BY i.from_team_id HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'trade_preview: a team gives FAAB in more than one leg — give one amount per team' USING ERRCODE = '22023';
    END IF;
    v_pdrops := COALESCE(p_drops, ARRAY[]::text[]);
    v_rdrops := NULL;
  END IF;

  -- (4) THE GATES THE VERBS REFUSE BY FIRST — the season, the deadline.
  v_in_season := v_league.status IN ('in_season', 'playoffs');
  v_deadline := public.trade_deadline_view_internal(v_league, p_at);

  -- (5) THE ONE VALIDATOR. Under 'trade_preview' an E36 overflow is the
  --     side's `must_drop` (the substitution in §1); every other refusal is
  --     the validator's own sentence.
  IF v_refusal IS NULL THEN
    BEGIN
      v_facts := public.trade_check_internal('trade_preview', v_league, v_from, v_to, v_items, v_pdrops, v_rdrops);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      v_refusal := SQLERRM;
    END;
  END IF;

  v_ok := v_in_season
          AND NOT (v_deadline ->> 'passed')::boolean
          AND v_refusal IS NULL
          AND v_facts IS NOT NULL
          AND (v_facts #>> '{proposer,must_drop}')::int = 0
          AND (v_mode = 'offer' OR (v_facts #>> '{recipient,must_drop}')::int = 0);

  RETURN jsonb_build_object(
    'mode',              v_mode,
    'league_id',         p_league_id,
    'trade_id',          p_trade_id,
    'proposer_team_id',  v_from.id,
    'recipient_team_id', v_to.id,
    'ok',                v_ok,
    'league_status',     v_league.status,
    'in_season',         v_in_season,
    'deadline',          v_deadline,
    'refusal',           v_refusal,
    'rosters',           CASE WHEN v_facts IS NULL THEN NULL
                              ELSE jsonb_build_object('proposer', v_facts -> 'proposer', 'recipient', v_facts -> 'recipient') END,
    'evaluated_at',      p_at);
END;
$$;

-- ---------------------------------------------------------------------------
-- trade_propose_core_internal — 148:631-786 FILE TEXT (D137), 1 hunk (+0 / -5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_propose_core_internal(
  p_verb           TEXT,
  p_league         public.leagues,
  p_from_team_id   UUID,
  p_to_team_id     UUID,
  p_items          JSONB,
  p_drops          TEXT[],
  p_note           TEXT,
  p_action_id      UUID,
  p_at             TIMESTAMPTZ,
  p_countered_from UUID
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_from     public.teams;
  v_to       public.teams;
  v_note     TEXT;
  v_elem     JSONB;
  v_bad      TEXT;
  v_leg_from UUID;
  v_norm     JSONB := '[]'::jsonb;
  v_amount   NUMERIC;
  v_check    JSONB;
  v_trade    public.trades;
  v_cnt      INTEGER;
BEGIN
  -- THE TWO TEAMS — franchises of this league, active, different.
  IF p_to_team_id IS NULL THEN
    RAISE EXCEPTION '%: the receiving team is required — a trade is between two teams', p_verb
      USING ERRCODE = '22023';
  END IF;
  SELECT t.* INTO v_from FROM public.teams t WHERE t.id = p_from_team_id;
  IF NOT FOUND OR v_from.league_id IS DISTINCT FROM p_league.id THEN
    RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb, p_from_team_id, p_league.id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_to FROM public.teams t WHERE t.id = p_to_team_id;
  IF NOT FOUND OR v_to.league_id IS DISTINCT FROM p_league.id THEN
    RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb, p_to_team_id, p_league.id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_from.id = v_to.id THEN
    RAISE EXCEPTION '%: % cannot trade with itself — a trade is between two different teams', p_verb, v_from.name
      USING ERRCODE = 'P0001';
  END IF;

  -- THE NOTE — optional, trimmed, ≤ 500 (the league_chat bound).
  v_note := NULLIF(btrim(COALESCE(p_note, ''), E' \t\r\n'), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION '%: the note is % characters — at most 500', p_verb, char_length(v_note)
      USING ERRCODE = '22023';
  END IF;

  -- THE LEGS — shape-checked into the normalized list (22023 = a malformed
  -- request, never a business refusal).
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '%: p_items is required — a JSON array of legs, each {"player_id": …} or {"faab_amount": …} with its "from_team_id"; a trade moves at least one player or FAAB', p_verb
      USING ERRCODE = '22023';
  END IF;
  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS x(e) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION '%: every trade leg is a JSON object (got %)', p_verb, v_elem USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
    FROM jsonb_object_keys(v_elem) AS k WHERE k NOT IN ('player_id', 'faab_amount', 'from_team_id');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '%: unknown key(s) % in trade leg % — a leg has player_id or faab_amount, and from_team_id', p_verb, v_bad, v_elem
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_elem -> 'from_team_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION '%: trade leg % has no from_team_id — every leg names the team that gives it', p_verb, v_elem
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_leg_from := (v_elem ->> 'from_team_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION '%: from_team_id % is not a team id', p_verb, v_elem ->> 'from_team_id' USING ERRCODE = '22023';
    END;
    IF v_leg_from NOT IN (v_from.id, v_to.id) THEN
      RAISE EXCEPTION '%: trade leg % comes from a team that is not in this trade (% or %)', p_verb, v_elem, v_from.name, v_to.name
        USING ERRCODE = '22023';
    END IF;
    IF (COALESCE(jsonb_typeof(v_elem -> 'player_id'), 'null') <> 'null') = (COALESCE(jsonb_typeof(v_elem -> 'faab_amount'), 'null') <> 'null') THEN
      RAISE EXCEPTION '%: trade leg % must be a player OR a FAAB amount — exactly one of player_id / faab_amount', p_verb, v_elem
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(jsonb_typeof(v_elem -> 'player_id'), 'null') <> 'null' THEN
      IF jsonb_typeof(v_elem -> 'player_id') <> 'string' OR btrim(v_elem ->> 'player_id') = '' THEN
        RAISE EXCEPTION '%: trade leg % has a player_id that is not a player id', p_verb, v_elem USING ERRCODE = '22023';
      END IF;
      v_norm := v_norm || jsonb_build_array(jsonb_build_object(
        'player_id', v_elem ->> 'player_id', 'faab_amount', NULL,
        'from_team_id', v_leg_from, 'to_team_id', CASE WHEN v_leg_from = v_from.id THEN v_to.id ELSE v_from.id END));
    ELSE
      IF jsonb_typeof(v_elem -> 'faab_amount') <> 'number' THEN
        RAISE EXCEPTION '%: trade leg % has a faab_amount that is not a number', p_verb, v_elem USING ERRCODE = '22023';
      END IF;
      v_amount := (v_elem ->> 'faab_amount')::numeric;
      IF v_amount <> trunc(v_amount) OR v_amount < 1 OR v_amount > 2147483647 THEN
        RAISE EXCEPTION '%: a FAAB leg of % is not a whole number of dollars from $1 up', p_verb, v_elem ->> 'faab_amount'
          USING ERRCODE = '22023';
      END IF;
      v_norm := v_norm || jsonb_build_array(jsonb_build_object(
        'player_id', NULL, 'faab_amount', v_amount::int,
        'from_team_id', v_leg_from, 'to_team_id', CASE WHEN v_leg_from = v_from.id THEN v_to.id ELSE v_from.id END));
    END IF;
  END LOOP;
  SELECT string_agg(DISTINCT i.player_id, ', ') INTO v_bad
  FROM jsonb_to_recordset(v_norm) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
  WHERE i.player_id IS NOT NULL
    AND (SELECT count(*) FROM jsonb_to_recordset(v_norm) AS j(player_id TEXT) WHERE j.player_id = i.player_id) > 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%: the trade names % more than once — each player is one leg', p_verb, v_bad USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_norm) AS i(faab_amount INTEGER, from_team_id UUID)
             WHERE i.faab_amount IS NOT NULL GROUP BY i.from_team_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION '%: a team gives FAAB in more than one leg — give one amount per team', p_verb USING ERRCODE = '22023';
  END IF;

  -- VALIDATE (the one validator; the receiving team's drops come at acceptance).
  v_check := public.trade_check_internal(p_verb, p_league, v_from, v_to, v_norm, COALESCE(p_drops, ARRAY[]::text[]), NULL);

  -- WRITE — the trade, its legs, the proposer's drops.
  INSERT INTO public.trades (
    league_id, proposer_team_id, recipient_team_id, status, note, countered_from,
    proposed_by, action_id, created_at)
  VALUES (
    p_league.id, v_from.id, v_to.id, 'proposed', v_note, p_countered_from,
    auth.uid(), p_action_id, p_at)
  RETURNING * INTO v_trade;

  INSERT INTO public.trade_items (trade_id, from_team_id, to_team_id, player_id, faab_amount)
  SELECT v_trade.id, i.from_team_id, i.to_team_id, i.player_id, i.faab_amount
  FROM jsonb_to_recordset(v_norm) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> jsonb_array_length(v_norm) THEN
    RAISE EXCEPTION '%: wrote % trade legs, expected %', p_verb, v_cnt, jsonb_array_length(v_norm) USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.trade_drops (trade_id, team_id, player_id, created_at)
  SELECT v_trade.id, v_from.id, d, p_at FROM unnest(COALESCE(p_drops, ARRAY[]::text[])) AS d;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> COALESCE(cardinality(p_drops), 0) THEN
    RAISE EXCEPTION '%: wrote % trade drops, expected %', p_verb, v_cnt, COALESCE(cardinality(p_drops), 0) USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('trade_id', v_trade.id, 'check', v_check);
END;
$$;

-- ---------------------------------------------------------------------------
-- trade_respond_internal — 174:345-689 FILE TEXT (D137), 2 hunks (+2 / -9).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_respond_internal(
  p_league_id UUID,
  p_trade_id  UUID,
  p_op        TEXT,
  p_drops     TEXT[],
  p_items     JSONB,
  p_note      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_verb        CONSTANT TEXT := 'trade_respond';
  v_league      public.leagues;
  v_found       BOOLEAN;
  v_trade       public.trades;
  v_trade_found BOOLEAN;
  v_side_id     UUID;       -- the team whose move this op is
  v_other_id    UUID;
  v_is_manager  BOOLEAN;
  v_is_other    BOOLEAN;
  v_is_commish  BOOLEAN;
  v_ledger      public.trade_actions;
  v_reason      TEXT;
  v_side        public.teams;
  v_proposer    public.teams;
  v_recipient   public.teams;
  v_items       JSONB;
  v_pdrops      TEXT[];
  v_check       JSONB := NULL;
  v_core        JSONB := NULL;
  v_new_id      UUID := NULL;
  v_cnt         INTEGER;
  v_summary     TEXT;
  v_status      TEXT;
  v_notified    JSONB := '[]'::jsonb;
  v_n           UUID;
  v_receipt     JSONB := NULL;
  v_result      JSONB;
  v_review      TEXT;           -- 151: the league's trade_review (§7.3.5)
  v_period      INTEGER;        -- 151: trade_review_period_hours
  v_deadline    JSONB;          -- 151 (Q76)
  v_exec        JSONB := NULL;  -- 151: the executor's answer (review none)
BEGIN
  -- (0) SHAPE.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'trade_respond: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_trade_id IS NULL THEN
    RAISE EXCEPTION 'trade_respond: p_trade_id is required — name the trade to answer'
      USING ERRCODE = '22023';
  END IF;
  IF p_op IS NULL OR p_op NOT IN ('accept', 'reject', 'cancel', 'counter') THEN
    RAISE EXCEPTION 'trade_respond: op % is not one of accept / reject / cancel / counter (§13.3)', COALESCE(p_op, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_drops IS NOT NULL AND p_op NOT IN ('accept', 'counter') THEN
    RAISE EXCEPTION 'trade_respond: drops are named when accepting or countering, not when you % (E36)', p_op
      USING ERRCODE = '22023';
  END IF;
  IF p_op <> 'counter' AND (p_items IS NOT NULL OR p_note IS NOT NULL) THEN
    RAISE EXCEPTION 'trade_respond: players, FAAB and a note belong to a counter-offer — op % takes none', p_op
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) THE TRADE, under the league lock; AUTH on the side whose move it is.
  IF v_found THEN
    SELECT t.* INTO v_trade FROM public.trades t
    WHERE t.id = p_trade_id AND t.league_id = p_league_id
    FOR UPDATE;
    v_trade_found := FOUND;
  ELSE
    v_trade_found := FALSE;
  END IF;
  IF v_trade_found THEN
    v_side_id  := CASE WHEN p_op = 'cancel' THEN v_trade.proposer_team_id ELSE v_trade.recipient_team_id END;
    v_other_id := CASE WHEN p_op = 'cancel' THEN v_trade.recipient_team_id ELSE v_trade.proposer_team_id END;
  END IF;
  v_is_manager := v_trade_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = v_side_id);
  v_is_other := v_trade_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = v_other_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish OR v_is_other) THEN
    RAISE EXCEPTION 'trade_respond: not a party to this trade'
      USING ERRCODE = '42501';
  END IF;
  IF NOT v_trade_found THEN
    RAISE EXCEPTION 'trade_respond: no trade % in league %', p_trade_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  -- The OTHER party (not a commissioner) asked for this side's move — it is
  -- his trade too, so he is told by name which move is his.
  IF NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION '%',
      CASE WHEN p_op = 'cancel'
           THEN 'trade_respond: only the team that proposed a trade can cancel it — you received this offer, so reject it instead (§13.3)'
           ELSE 'trade_respond: only the team that received a trade can ' || p_op || ' it — you proposed this one, so cancel it instead (§13.3)' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) REPLAY — verb, team, trade and op scoped (R732).
  SELECT a.* INTO v_ledger
  FROM public.trade_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> v_verb OR v_ledger.team_id IS DISTINCT FROM v_side_id
       OR (v_ledger.result ->> 'trade_id') IS DISTINCT FROM p_trade_id::text
       OR (v_ledger.result ->> 'op') IS DISTINCT FROM p_op THEN
      RAISE EXCEPTION
        'trade_respond: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- 174 (L.D3.16 — Chris 2026-09-30: "A commissioner cannot do anything to
  -- a trade unless it's already been accepted and the only option is veto or
  -- instantly push it through."): the TD5 commissioner arm is gone. AFTER the
  -- replay (R1412, as reverse's), so a retry of an answer he gave for a team
  -- before 174 replays its stored answer. A commissioner who manages the
  -- OTHER party is that party's manager and hears the other party's sentence;
  -- one who manages neither team is refused BY NAME (P0001 — a member,
  -- nothing to leak). One who manages this side answers as its manager.
  IF NOT v_is_manager THEN
    IF v_is_other THEN
      RAISE EXCEPTION '%',
        CASE WHEN p_op = 'cancel'
             THEN 'trade_respond: only the team that proposed a trade can cancel it — you received this offer, so reject it instead (§13.3)'
             ELSE 'trade_respond: only the team that received a trade can ' || p_op || ' it — you proposed this one, so cancel it instead (§13.3)' END
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'trade_respond: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only the two teams in this trade answer the offer (§13.3)'
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) THE REASON, OPTIONAL.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'trade_respond: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_side FROM public.teams t WHERE t.id = v_side_id;
  SELECT t.* INTO v_proposer FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
  SELECT t.* INTO v_recipient FROM public.teams t WHERE t.id = v_trade.recipient_team_id;

  -- (5) STATE — every op answers a trade still in `proposed`. Anything else
  --     is refused by name, with the reason it left (loud: a second accept
  --     never passes silently as a no-op — its drops would be ignored).
  IF v_trade.status <> 'proposed' THEN
    RAISE EXCEPTION 'trade_respond: this trade is already % (%) — only a proposed trade can be %',
      v_trade.status, COALESCE(v_trade.status_reason, 'no reason recorded'),
      CASE p_op WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected' WHEN 'cancel' THEN 'cancelled' ELSE 'countered' END
      USING ERRCODE = 'P0001';
  END IF;
  IF p_op IN ('accept', 'counter') AND v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'trade_respond: league % is % — a trade is accepted or countered only while the league is in season or in the playoffs (§7.1 / §13.3)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  -- 151 (Q76): an offer can be accepted (or countered) until week N+1
  -- begins; AT that instant it cannot. Reject / cancel stay open.
  IF p_op IN ('accept', 'counter') THEN
    v_deadline := public.trade_deadline_internal(v_league);
    IF (v_deadline ->> 'deadline_at')::timestamptz <= p_at THEN
      RAISE EXCEPTION
        'trade_respond: the trade deadline has passed — trades could be accepted until week % began (%; trade_deadline_week %, §13.3 / Q76); this offer can no longer be %',
        (v_deadline ->> 'deadline_week')::int + 1, v_deadline ->> 'label', v_deadline ->> 'deadline_week',
        CASE p_op WHEN 'accept' THEN 'accepted' ELSE 'countered' END
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (6) THE OP.
  IF p_op = 'accept' THEN
    -- RE-VALIDATE EVERYTHING under the lock, the receiving team's drops
    -- now ENFORCED (E36).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'player_id', i.player_id, 'faab_amount', i.faab_amount,
             'from_team_id', i.from_team_id, 'to_team_id', i.to_team_id) ORDER BY i.id), '[]'::jsonb)
    INTO v_items
    FROM public.trade_items i WHERE i.trade_id = p_trade_id;
    SELECT COALESCE(array_agg(d.player_id ORDER BY d.player_id), ARRAY[]::text[]) INTO v_pdrops
    FROM public.trade_drops d WHERE d.trade_id = p_trade_id AND d.team_id = v_trade.proposer_team_id;
    v_check := public.trade_check_internal(v_verb, v_league, v_proposer, v_recipient, v_items,
                                           v_pdrops, COALESCE(p_drops, ARRAY[]::text[]));

    INSERT INTO public.trade_drops (trade_id, team_id, player_id, created_at)
    SELECT p_trade_id, v_recipient.id, d, p_at FROM unnest(COALESCE(p_drops, ARRAY[]::text[])) AS d;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> COALESCE(cardinality(p_drops), 0) THEN
      RAISE EXCEPTION 'trade_respond: wrote % trade drops, expected %', v_cnt, COALESCE(cardinality(p_drops), 0) USING ERRCODE = 'P0001';
    END IF;

    -- 151 (§13.3 review, L.D3.3): `none` ⇒ `accepted`, executed below in
    -- this same transaction; `commissioner` / `league_vote` ⇒ `in_review`
    -- until trade_review_period_hours have passed (the tick auto-approves)
    -- unless the commissioner / the league decides first (L.D3.5 / L.D3.4).
    v_review := COALESCE(v_league.trade_review, 'commissioner');
    IF v_review NOT IN ('none', 'commissioner', 'league_vote') THEN
      RAISE EXCEPTION 'trade_respond: trade_review % is not none / commissioner / league_vote (§7.3.5)', v_review
        USING ERRCODE = '22023';
    END IF;
    v_period := COALESCE((v_league.settings ->> 'trade_review_period_hours')::int, 24);
    v_status := CASE WHEN v_review = 'none' THEN 'accepted' ELSE 'in_review' END;
    UPDATE public.trades t
    SET status = v_status, accepted_at = p_at, accepted_by = auth.uid(),
        review_deadline = CASE WHEN v_status = 'in_review' THEN p_at + make_interval(hours => v_period) END
    WHERE t.id = p_trade_id AND t.status = 'proposed';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  ELSIF p_op = 'reject' THEN
    v_status := 'rejected';
    UPDATE public.trades t
    SET status = 'rejected', status_reason = 'rejected by ' || v_recipient.name, resolved_at = p_at, resolved_by = auth.uid()
    WHERE t.id = p_trade_id AND t.status = 'proposed';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  ELSIF p_op = 'cancel' THEN
    v_status := 'cancelled';
    UPDATE public.trades t
    SET status = 'cancelled', status_reason = 'cancelled by ' || v_proposer.name, resolved_at = p_at, resolved_by = auth.uid()
    WHERE t.id = p_trade_id AND t.status = 'proposed';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  ELSE
    -- COUNTER = reject + a new proposal the other way, linked (task text).
    -- 174 (L.D3.16, R1413 — R1410's rule for the counter): a counter-offer
    -- is a new offer TO the proposing team, and only a team's own manager
    -- answers an offer now, so a counter to a proposing team with NO manager
    -- (an offer the commissioner made for it before 174) could never be
    -- answered. Refused BY NAME before any write — D339's predicate, as
    -- trade_propose's; the offer itself can still be turned down.
    IF NOT EXISTS (SELECT 1 FROM public.league_members m
                       WHERE m.league_id = p_league_id AND m.team_id = v_proposer.id AND m.user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'trade_respond: % has no manager to answer a counter-offer right now — only a team''s own manager accepts or turns down an offer, so turn this one down instead (§13.3)',
        v_proposer.name
        USING ERRCODE = 'P0001';
    END IF;
    v_status := 'rejected';
    UPDATE public.trades t
    SET status = 'rejected', status_reason = 'countered by ' || v_recipient.name, resolved_at = p_at, resolved_by = auth.uid()
    WHERE t.id = p_trade_id AND t.status = 'proposed';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  END IF;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'trade_respond: the % touched % trade rows, expected exactly 1 (trade %)', p_op, v_cnt, p_trade_id
      USING ERRCODE = 'P0001';
  END IF;

  IF p_op = 'counter' THEN
    v_core := public.trade_propose_core_internal(
      v_verb, v_league, v_recipient.id, v_proposer.id, p_items, p_drops, p_note, p_action_id, p_at, p_trade_id);
    v_new_id := (v_core ->> 'trade_id')::uuid;
    v_check := v_core -> 'check';
  END IF;

  v_summary := public.trade_summary_internal(COALESCE(v_new_id, p_trade_id));

  -- (7) 174 (L.D3.16): NO commissioner arm — only a party's manager gets
  --     here, so nothing is receipted: the result's acted_as_commissioner is
  --     FALSE and commissioner_action_id / system_post / reason are NULL (the
  --     keys kept for the wire shape).

  -- (8) THE OTHER PARTY IS TOLD (TD16).
  v_n := public.trade_notify_team_internal(
    p_league_id, v_other_id,
    'league_trade_' || CASE p_op WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected'
                                 WHEN 'cancel' THEN 'cancelled' ELSE 'countered' END,
    v_side.name || ' ' || CASE p_op WHEN 'accept' THEN 'accepted your trade'
                                    WHEN 'reject' THEN 'rejected your trade'
                                    WHEN 'cancel' THEN 'cancelled its trade offer'
                                    ELSE 'countered your trade offer' END,
    v_summary,
    jsonb_build_object('trade_id', COALESCE(v_new_id, p_trade_id), 'answered_trade_id', p_trade_id, 'op', p_op),
    TRUE);
  IF v_n IS NOT NULL THEN
    v_notified := v_notified || jsonb_build_array(v_n);
  END IF;

  -- 151: under trade_review = none the accepted trade EXECUTES now (§13.3
  -- "none → execute immediately") — or waits for the week's last game
  -- (Q75), or fails with its reason; the outcome is part of this answer.
  IF p_op = 'accept' AND v_status = 'accepted' THEN
    v_exec := public.trade_execute_internal(p_trade_id, p_at, 'accept');
  END IF;

  v_result := jsonb_build_object(
    'verb',                   v_verb,
    'op',                     p_op,
    'league_id',              p_league_id,
    'team_id',                v_side_id,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'trade_id',               p_trade_id,
    'trade',                  public.trade_view_internal(p_trade_id),
    'counter_trade',          CASE WHEN v_new_id IS NOT NULL THEN public.trade_view_internal(v_new_id) END,
    'summary',                v_summary,
    'rosters',                v_check,
    'review',                 CASE WHEN p_op = 'accept' THEN jsonb_build_object(
                                'mode',            v_review,
                                'period_hours',    CASE WHEN v_review <> 'none' THEN v_period END,
                                'review_deadline', (SELECT t.review_deadline FROM public.trades t WHERE t.id = p_trade_id)) END,
    'execution',              v_exec,
    'settled_by',             CASE p_op
                                WHEN 'accept'  THEN CASE v_exec ->> 'outcome'
                                  WHEN 'complete' THEN 'the trade went through (trade_review none — §13.3)'
                                  WHEN 'deferred' THEN 'accepted; a player in it already played this week, so the whole trade goes through right after the week''s last game ends (Q75 / E35)'
                                  WHEN 'invalid'  THEN 'accepted, but it could not go through: ' || (v_exec ->> 'status_reason')
                                  ELSE 'in review (' || v_review || ') until review_deadline, when it goes through unless it is vetoed first (§13.3); nothing moves until then, and it goes invalid if a player in it leaves his roster first (E37)' END
                                WHEN 'counter' THEN 'the original offer is rejected; the counter-offer is a new proposal the other team answers (§13.3)'
                                ELSE 'closed — nothing moved' END,
    'notified_user_ids',      v_notified,
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.trade_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, v_side_id, v_verb, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- trade_tick — 180:466-638 FILE TEXT (D137), 1 hunk (+8 / -14).
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

-- ---------------------------------------------------------------------------
-- trade_vote_internal — 155:262-441 FILE TEXT (D137), 2 hunks (+0 / -6).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_vote_internal(
  p_league_id UUID,
  p_trade_id  UUID,
  p_vote      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_verb      CONSTANT TEXT := 'trade_vote';
  v_league    public.leagues;
  v_found     BOOLEAN;
  v_member    public.league_members;
  v_is_member BOOLEAN := FALSE;
  v_trade     public.trades;
  v_ledger    public.trade_actions;
  v_zone      TEXT;
  v_prev      TEXT;
  v_veto      JSONB;
  v_tally     JSONB;
  v_result    JSONB;
BEGIN
  -- (0) SHAPE.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'trade_vote: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_trade_id IS NULL THEN
    RAISE EXCEPTION 'trade_vote: p_trade_id is required — name the trade you are voting on'
      USING ERRCODE = '22023';
  END IF;
  IF p_vote IS NULL OR p_vote NOT IN ('veto', 'approve') THEN
    RAISE EXCEPTION 'trade_vote: vote % is not veto / approve — a manager votes to veto a trade or to let it through (§13.3 / Q77)', COALESCE(p_vote, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'trade_vote: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the one serialization point every trade
  --     verb and the tick take — a vote and the tick's approval cannot
  --     interleave).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — league members only; anyone else learns nothing (42501).
  IF v_found AND auth.uid() IS NOT NULL THEN
    SELECT m.* INTO v_member
    FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid();
    v_is_member := FOUND;
  END IF;
  IF NOT v_is_member THEN
    RAISE EXCEPTION 'trade_vote: not a member of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) THE TRADE, under the league lock.
  SELECT t.* INTO v_trade FROM public.trades t
  WHERE t.id = p_trade_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_vote: no trade % in league %', p_trade_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) A VOTE IS A TEAM MANAGER'S (Q77).
  IF v_member.team_id IS NULL THEN
    RAISE EXCEPTION '%',
      'trade_vote: only a team''s manager votes on a trade, and you do not manage a team in this league (§13.3 / Q77)'
      || CASE WHEN public.is_league_commish(p_league_id)
              THEN ' — the commissioner''s own approve / veto is a separate commissioner tool, not a vote' ELSE '' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (5) REPLAY — verb, team, trade and vote scoped (R732). Before the state
  --     checks: a retry after the vote that vetoed the trade replays its
  --     answer instead of reporting "not under review".
  SELECT a.* INTO v_ledger
  FROM public.trade_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> v_verb OR v_ledger.team_id IS DISTINCT FROM v_member.team_id
       OR (v_ledger.result ->> 'trade_id') IS DISTINCT FROM p_trade_id::text
       OR (v_ledger.result ->> 'vote') IS DISTINCT FROM p_vote THEN
      RAISE EXCEPTION
        'trade_vote: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (6) WHO MAY VOTE ON THIS TRADE (Q77): not the two teams in it.
  IF v_member.team_id IN (v_trade.proposer_team_id, v_trade.recipient_team_id) THEN
    RAISE EXCEPTION 'trade_vote: your team is in this trade — the two teams in a trade do not vote on it; every other manager may (§13.3 / Q77)'
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) STATE: the league reviews trades by vote, the trade is in review,
  --     and its review period has not ended (the tick approves AT the
  --     deadline — 151 — so a vote at or after it is too late).
  IF COALESCE(v_league.trade_review, 'commissioner') <> 'league_vote' THEN
    RAISE EXCEPTION 'trade_vote: this league''s trades are %, not by a league vote (trade_review %, §7.3.5)',
      CASE COALESCE(v_league.trade_review, 'commissioner')
        WHEN 'commissioner' THEN 'reviewed by the commissioner'
        WHEN 'none' THEN 'not reviewed (they go through when accepted)'
        ELSE 'reviewed another way' END,
      COALESCE(v_league.trade_review, 'commissioner')
      USING ERRCODE = 'P0001';
  END IF;
  IF v_trade.status <> 'in_review' THEN
    RAISE EXCEPTION 'trade_vote: this trade is not up for a vote — %',
      CASE v_trade.status
        WHEN 'proposed'  THEN 'it has not been accepted yet; voting opens when it is'
        WHEN 'accepted'  THEN 'its review period is over and it is waiting to go through'
        WHEN 'complete'  THEN 'it already went through'
        WHEN 'vetoed'    THEN 'it was already vetoed'
        WHEN 'rejected'  THEN 'it was rejected'
        WHEN 'cancelled' THEN 'it was cancelled'
        WHEN 'invalid'   THEN 'it can no longer go through (' || COALESCE(v_trade.status_reason, 'no reason recorded') || ')'
        WHEN 'expired'   THEN 'it expired at the trade deadline'
        ELSE 'it is ' || v_trade.status END || ' (§13.3)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_trade.review_deadline IS NULL OR p_at >= v_trade.review_deadline THEN
    v_zone := COALESCE(NULLIF(v_league.settings ->> 'waiver_time_zone', ''), 'America/New_York');
    RAISE EXCEPTION 'trade_vote: voting on this trade closed at % — the review period is over (§13.3 / Q77)',
      COALESCE(to_char(v_trade.review_deadline AT TIME ZONE v_zone, 'Dy YYYY-MM-DD HH24:MI') || ' ' || v_zone, 'an unrecorded instant')
      USING ERRCODE = 'P0001';
  END IF;

  -- (8) CAST OR CHANGE THE VOTE (one per team; the manager who cast it).
  SELECT v.vote INTO v_prev FROM public.trade_votes v
  WHERE v.trade_id = p_trade_id AND v.team_id = v_member.team_id AND v.voter_id = auth.uid();
  INSERT INTO public.trade_votes (trade_id, team_id, voter_id, vote, created_at, updated_at)
  VALUES (p_trade_id, v_member.team_id, auth.uid(), p_vote, p_at, p_at)
  ON CONFLICT (trade_id, team_id) DO UPDATE
    SET vote = EXCLUDED.vote, voter_id = EXCLUDED.voter_id, updated_at = EXCLUDED.updated_at,
        created_at = CASE WHEN public.trade_votes.voter_id = EXCLUDED.voter_id
                          THEN public.trade_votes.created_at ELSE EXCLUDED.created_at END;

  -- (9) THE VOTE THAT REACHES THE NUMBER VETOES THE TRADE, here (F435).
  v_veto := public.trade_vote_veto_internal(p_trade_id, v_league, p_at);
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id;
  v_tally := COALESCE(v_veto -> 'tally', public.trade_vote_tally_internal(v_trade, v_league));

  v_result := jsonb_build_object(
    'trade_id',      p_trade_id,
    'op',            'vote',
    'vote',          p_vote,
    'previous_vote', v_prev,
    'team_id',       v_member.team_id,
    'outcome',       CASE WHEN v_veto IS NOT NULL THEN 'vetoed' ELSE 'recorded' END,
    'tally',         jsonb_build_object(
                       'veto_votes',      (v_tally -> 'veto_votes'),
                       'eligible_voters', (v_tally -> 'eligible_voters'),
                       'setting',         (v_tally -> 'setting'),
                       'veto_number',     (v_tally -> 'veto_number'),
                       'capped',          (v_tally -> 'capped')),
    'trade',         public.trade_view_internal(p_trade_id),
    'veto',          v_veto,
    'evaluated_at',  p_at);

  INSERT INTO public.trade_actions (league_id, team_id, verb, action_id, actor_id, result, created_at)
  VALUES (p_league_id, v_member.team_id, v_verb, p_action_id, auth.uid(), v_result, p_at);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- waiver_claim_edit_internal — 150:2772-3036 FILE TEXT (D137), 2 hunks (+2 / -6).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_edit_internal(
  p_league_id UUID,
  p_claim_id  UUID,
  p_bid       INTEGER,
  p_drop      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_found       BOOLEAN;
  v_claim       public.waiver_claims;
  v_claim_found BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_ledger      public.waiver_claim_actions;
  v_team        public.teams;
  v_reason      TEXT;
  v_waiver_type TEXT;
  v_min_bid     INTEGER;
  v_bid         INTEGER;
  v_balance     INTEGER;
  v_has_seat    BOOLEAN;
  v_add_name    TEXT;
  v_drop_p      public.players;
  v_owner       public.league_rosters;
  v_dup         public.waiver_claims;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_before      JSONB;
  v_receipt     JSONB := NULL;
  v_result      JSONB;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_edit: p_action_id is required (idempotency key — one UUID per edit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_claim_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_edit: p_claim_id is required — name the claim to change'
      USING ERRCODE = '22023';
  END IF;
  IF p_bid IS NOT NULL AND p_bid < 0 THEN
    RAISE EXCEPTION 'waiver_claim_edit: a bid of $% is negative — bids are whole dollars from $0 up (§7.3.4)', p_bid
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) THE CLAIM, under the league lock; AUTH on its team (no existence oracle).
  IF v_found THEN
    SELECT c.* INTO v_claim FROM public.waiver_claims c
    WHERE c.id = p_claim_id AND c.league_id = p_league_id
    FOR UPDATE;
    v_claim_found := FOUND;
  ELSE
    v_claim_found := FALSE;
  END IF;
  v_is_manager := v_claim_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = v_claim.team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'waiver_claim_edit: not a manager of this claim''s team'
      USING ERRCODE = '42501';
  END IF;
  IF NOT v_claim_found THEN
    RAISE EXCEPTION 'waiver_claim_edit: no waiver claim % in league %', p_claim_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) REPLAY — verb-, team- and claim-scoped (R732).
  SELECT a.* INTO v_ledger
  FROM public.waiver_claim_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'waiver_claim_edit' OR v_ledger.team_id IS DISTINCT FROM v_claim.team_id
       OR (v_ledger.result ->> 'claim_id') IS DISTINCT FROM p_claim_id::text THEN
      RAISE EXCEPTION
        'waiver_claim_edit: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'waiver_claim_edit: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = v_claim.team_id;
  SELECT p.full_name INTO v_add_name FROM public.players p WHERE p.id = v_claim.add_player_id;

  -- (4) STATE, re-read under the lock.
  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION
      'waiver_claim_edit: the claim for % is % — only a pending claim can be changed (put in a new claim instead)',
      COALESCE(v_add_name, v_claim.add_player_id),
      CASE v_claim.status WHEN 'cancelled' THEN 'cancelled' ELSE 'already settled by a waiver run (' || v_claim.status || ')' END
      USING ERRCODE = 'P0001';
  END IF;
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'waiver_claim_edit: league % is % — waiver claims are changed only while the league is in season or in the playoffs (§13.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  v_waiver_type := COALESCE(v_league.waiver_type, 'faab');
  IF v_waiver_type = 'none_fcfs' THEN
    RAISE EXCEPTION
      'waiver_claim_edit: this league has no waivers (waiver type "none_fcfs") — every unowned player is first come, first served: add him directly (§7.3.4)'
      USING ERRCODE = 'P0001';
  END IF;

  -- (5) THE DROP — known, and on THIS team.
  IF p_drop IS NOT NULL THEN
    IF p_drop = v_claim.add_player_id THEN
      RAISE EXCEPTION 'waiver_claim_edit: add and drop name the same player (%) — a claim changes the roster (§13.2)', p_drop
        USING ERRCODE = '22023';
    END IF;
    SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'waiver_claim_edit: no player with id % (drop)', p_drop USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_owner FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_drop;
    IF NOT FOUND OR v_owner.team_id <> v_claim.team_id THEN
      RAISE EXCEPTION
        'waiver_claim_edit: % (%) is not on %''s roster — a claim can only drop one of the team''s own players (§13.2)',
        v_drop_p.full_name, p_drop, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (6) THE BID — submit's rule (145 (8)).
  v_bid := COALESCE(p_bid, 0);
  v_min_bid := COALESCE((v_league.settings ->> 'faab_min_bid')::int, 0);
  SELECT TRUE, m.faab_balance INTO v_has_seat, v_balance
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = v_claim.team_id;
  IF v_waiver_type = 'faab' THEN
    IF v_bid < v_min_bid THEN
      RAISE EXCEPTION 'waiver_claim_edit: a bid of $% is below this league''s minimum bid of $% (faab_min_bid, §7.3.4)', v_bid, v_min_bid
        USING ERRCODE = 'P0001';
    END IF;
    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        'waiver_claim_edit: % has no FAAB balance on record, so it can''t bid — ask the commissioner to set the team''s FAAB',
        v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    IF v_bid > v_balance THEN
      RAISE EXCEPTION 'waiver_claim_edit: a bid of $% is more than %''s FAAB balance of $% (§13.2)', v_bid, v_team.name, v_balance
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_bid <> 0 THEN
    RAISE EXCEPTION
      'waiver_claim_edit: this league decides claims by waiver priority (%), not by bids — a claim carries no money here, so the bid must be $0 (got $%) (§13.2)',
      v_waiver_type, v_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) ANOTHER pending claim of this team for the same add + the new drop.
  SELECT c.* INTO v_dup FROM public.waiver_claims c
  WHERE c.team_id = v_claim.team_id AND c.status = 'pending' AND c.id <> v_claim.id
    AND c.add_player_id = v_claim.add_player_id AND c.drop_player_id IS NOT DISTINCT FROM p_drop;
  IF FOUND THEN
    RAISE EXCEPTION
      'waiver_claim_edit: % already has another pending claim for % (%)% — change or cancel that one instead',
      v_team.name, COALESCE(v_add_name, v_claim.add_player_id), v_claim.add_player_id,
      CASE WHEN p_drop IS NULL THEN ' with no drop' ELSE ' dropping ' || v_drop_p.full_name || ' (' || p_drop || ')' END
      USING ERRCODE = 'P0001';
  END IF;

  v_before := jsonb_build_object('faab_bid', v_claim.faab_bid, 'drop_player_id', v_claim.drop_player_id, 'claim_order', v_claim.claim_order);
  v_no_changes := v_claim.faab_bid = v_bid AND v_claim.drop_player_id IS NOT DISTINCT FROM p_drop;

  IF NOT v_no_changes THEN
    UPDATE public.waiver_claims c
    SET faab_bid = v_bid, drop_player_id = p_drop
    WHERE c.id = v_claim.id AND c.status = 'pending';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'waiver_claim_edit: the edit touched % claim rows, expected exactly 1 (claim %)', v_cnt, p_claim_id
        USING ERRCODE = 'P0001';
    END IF;
    -- F422(b): in a FAAB league the team's order follows the bids (biggest
    -- first; the manager's own order only between equal bids) — re-derived,
    -- dense 1..n, stable within a bid.
    IF v_waiver_type = 'faab' THEN
      UPDATE public.waiver_claims c
      SET claim_order = o.rn
      FROM (SELECT c2.id, row_number() OVER (ORDER BY c2.faab_bid DESC, c2.claim_order, c2.created_at, c2.id)::int AS rn
            FROM public.waiver_claims c2
            WHERE c2.team_id = v_claim.team_id AND c2.status = 'pending') o
      WHERE c.id = o.id AND c.claim_order <> o.rn;
    END IF;
    SELECT c.* INTO v_claim FROM public.waiver_claims c WHERE c.id = p_claim_id;

    IF NOT v_is_manager THEN
      v_receipt := public.waiver_claim_receipt_internal(
        p_league_id, v_team, 'edit_waiver_claim', 'changed a waiver claim for',
        jsonb_build_array(p_claim_id), v_reason, p_action_id, 'waiver_claim_edit', v_league.season,
        'The commissioner changed a waiver claim for your team',
        'Claim: add ' || COALESCE(v_add_name, v_claim.add_player_id)
          || CASE WHEN p_drop IS NULL THEN ', no drop' ELSE ', drop ' || v_drop_p.full_name END
          || CASE WHEN v_waiver_type = 'faab' THEN ', bid $' || v_bid ELSE '' END
          || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
        jsonb_build_object('claim_id', p_claim_id, 'add_player_id', v_claim.add_player_id, 'drop_player_id', p_drop, 'faab_bid', v_bid));
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'verb',                   'waiver_claim_edit',
    'league_id',              p_league_id,
    'team_id',                v_claim.team_id,
    'team_name',              v_team.name,
    'action_id',              p_action_id,
    'claim_id',               p_claim_id,
    'claim', jsonb_build_object(
      'id',             v_claim.id,
      'add_player_id',  v_claim.add_player_id,
      'drop_player_id', v_claim.drop_player_id,
      'faab_bid',       v_claim.faab_bid,
      'claim_order',    v_claim.claim_order,
      'status',         v_claim.status,
      'process_at',     v_claim.process_at,
      'created_at',     v_claim.created_at),
    'before',                 v_before,
    'add_player_name',        v_add_name,
    'drop_player_name',       v_drop_p.full_name,
    'waiver_type',            v_waiver_type,
    'faab_balance',           CASE WHEN v_waiver_type = 'faab' THEN v_balance END,
    'faab_spent',             0,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN 'same_claim — the bid and the drop were already these, so nothing was written and no receipt was issued' END,
    'pending_claims',         (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'claim_order', c.claim_order) ORDER BY c.claim_order), '[]'::jsonb)
                               FROM public.waiver_claims c WHERE c.team_id = v_claim.team_id AND c.status = 'pending'),
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'notified_user_id',       v_receipt ->> 'notified_user_id',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.waiver_claim_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, v_claim.team_id, 'waiver_claim_edit', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- waiver_claim_submit_internal — 157:2287-2599 FILE TEXT (D137), 3 hunks (+3 / -7).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_submit_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT,
  p_drop      TEXT,
  p_bid       INTEGER,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_found        BOOLEAN;
  v_is_manager   BOOLEAN;
  v_is_commish   BOOLEAN;
  v_ledger       public.waiver_claim_actions;
  v_team         public.teams;
  v_reason       TEXT;
  v_waiver_type  TEXT;
  v_min_bid      INTEGER;
  v_bid          INTEGER;
  v_balance      INTEGER;
  v_has_seat     BOOLEAN;
  v_add_p        public.players;
  v_drop_p       public.players;
  v_owner        public.league_rosters;
  v_owner_team   public.teams;
  v_dup          public.waiver_claims;
  v_order        INTEGER;
  v_claim        public.waiver_claims;
  v_receipt      JSONB := NULL;
  v_result       JSONB;
  v_current      INTEGER;   -- 150 / F407
  v_add_lock     JSONB;     -- 150 / F407
BEGIN
  -- (0) SHAPE — refused by name (22023), never answered as a no-op.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_team_id is required — a claim is made for one team'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_add is required — a claim names the player to add (§13.2)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add = p_drop THEN
    RAISE EXCEPTION 'waiver_claim_submit: add and drop name the same player (%) — a claim changes the roster (§13.2)', p_add
      USING ERRCODE = '22023';
  END IF;
  IF p_bid IS NOT NULL AND p_bid < 0 THEN
    RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is negative — bids are whole dollars from $0 up (§7.3.4)', p_bid
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST — the one serialization point shared with
  --     add/drop (115:410-414) and, from L.D2.9, the processor.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     The team's manager, or a commissioner / co-commissioner acting for
  --     ANY team (TD5). One no-leak 42501 for no league / not a member / not
  --     this team's manager and not a commissioner.
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'waiver_claim_submit: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099 / E2), after auth, before every business gate: the same
  --     action_id returns the stored result byte-identically, even if the
  --     league has moved on since. Verb- and team-scoped (R732).
  SELECT a.* INTO v_ledger
  FROM public.waiver_claim_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'waiver_claim_submit' OR v_ledger.team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION
        'waiver_claim_submit: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66; 131's normalisation verbatim). Only the
  --     commissioner arm stores it.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'waiver_claim_submit: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) LEAGUE STATE, re-read under the lock.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % is % — waiver claims are made only while the league is in season or in the playoffs (§13.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'waiver_claim_submit: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  v_waiver_type := COALESCE(v_league.waiver_type, 'faab');
  IF v_waiver_type = 'none_fcfs' THEN
    RAISE EXCEPTION
      'waiver_claim_submit: this league has no waivers (waiver type "none_fcfs") — every unowned player is first come, first served: add him directly (§7.3.4)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_waiver_type NOT IN ('faab', 'rolling_priority', 'reverse_standings') THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % has waiver type "%", which is not one of faab / rolling_priority / reverse_standings / none_fcfs (§7.3.4) — refusing rather than guessing how its claims are decided',
      p_league_id, v_waiver_type
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE ADD — known, and on NO roster in this league (exclusivity, the
  --     friendly refusal naming the team — never a raw 23505).
  SELECT p.* INTO v_add_p FROM public.players p WHERE p.id = p_add;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'waiver_claim_submit: no player with id % (add)', p_add USING ERRCODE = 'P0001';
  END IF;
  SELECT r.* INTO v_owner FROM public.league_rosters r
  WHERE r.league_id = p_league_id AND r.player_id = p_add;
  IF FOUND THEN
    SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_owner.team_id;
    RAISE EXCEPTION
      'waiver_claim_submit: % (%) is already on % — a player is on ONE roster per league (player exclusivity, §13.2); only an unowned player can be claimed',
      v_add_p.full_name, p_add,
      CASE WHEN v_owner.team_id = p_team_id THEN v_team.name || '''s own roster'
           ELSE COALESCE(v_owner_team.name, 'another team') || '''s roster' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (6b) 150 / F407 — Q74 AS RULED: "the app won't accept a new claim on a
  --      player whose game has kicked off". The add/drop helper at p_at
  --      (E32 / Q34(B)): locked from his own kickoff until the week's last
  --      game ends. Refused by name with the PICKUP LOCK'S message (149's
  --      add arm, verb-prefixed) — the manager reads one rule, whichever
  --      door he tried. (A claim already pending on him fails at the run —
  --      `add_locked`, the processor.)
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % has no season schedule yet, so there is no week to check the game-day lock against',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_add_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_add, p_at);   -- 157 / F447: judged per player (played this week)
  IF (v_add_lock ->> 'locked')::boolean THEN
    RAISE EXCEPTION
      'waiver_claim_submit: % (%) is locked for adds — kicked off at % (%); week % clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
      v_add_p.full_name, p_add, v_add_lock ->> 'kickoff_at', v_add_lock ->> 'datum_arm',
      v_add_lock ->> 'week', COALESCE(v_add_lock ->> 'window_ends_at', 'an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked')
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE DROP — known, and on THIS team.
  IF p_drop IS NOT NULL THEN
    SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'waiver_claim_submit: no player with id % (drop)', p_drop USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_owner FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_drop;
    IF NOT FOUND OR v_owner.team_id <> p_team_id THEN
      RAISE EXCEPTION
        'waiver_claim_submit: % (%) is not on %''s roster — a claim can only drop one of the team''s own players (§13.2)',
        v_drop_p.full_name, p_drop, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (8) THE BID. FAAB: at least faab_min_bid, at most the seat's CURRENT
  --     balance (checked, never debited — TD2). Priority types: no money.
  v_bid := COALESCE(p_bid, 0);
  v_min_bid := COALESCE((v_league.settings ->> 'faab_min_bid')::int, 0);
  SELECT TRUE, m.faab_balance INTO v_has_seat, v_balance
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = p_team_id;
  IF v_waiver_type = 'faab' THEN
    IF v_bid < v_min_bid THEN
      RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is below this league''s minimum bid of $% (faab_min_bid, §7.3.4)', v_bid, v_min_bid
        USING ERRCODE = 'P0001';
    END IF;
    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        'waiver_claim_submit: % has no FAAB balance on record, so it can''t bid — ask the commissioner to set the team''s FAAB',
        v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    IF v_bid > v_balance THEN
      RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is more than %''s FAAB balance of $% (§13.2)', v_bid, v_team.name, v_balance
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_bid <> 0 THEN
    RAISE EXCEPTION
      'waiver_claim_submit: this league decides claims by waiver priority (%), not by bids — a claim carries no money here, so the bid must be $0 (got $%) (§13.2)',
      v_waiver_type, v_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- (9) AN IDENTICAL PENDING CLAIM — same team, same add, same drop.
  SELECT c.* INTO v_dup FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending'
    AND c.add_player_id = p_add AND c.drop_player_id IS NOT DISTINCT FROM p_drop;
  IF FOUND THEN
    RAISE EXCEPTION
      'waiver_claim_submit: % already has a pending claim for % (%)% — cancel it to change the bid or the order',
      v_team.name, v_add_p.full_name, p_add,
      CASE WHEN p_drop IS NULL THEN ' with no drop' ELSE ' dropping ' || v_drop_p.full_name || ' (' || p_drop || ')' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (10) WRITE — the claim at the back of this team's own order.
  SELECT COALESCE(max(c.claim_order), 0) + 1 INTO v_order
  FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending';

  INSERT INTO public.waiver_claims (
    league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order,
    status, action_id, created_by, created_at)
  VALUES (
    p_league_id, p_team_id, p_add, p_drop, v_bid, v_order,
    'pending', p_action_id, auth.uid(), p_at)
  RETURNING * INTO v_claim;

  -- (10b) 150 / F422(b): in a FAAB league a team's claims rank by BID —
  --       "your top choice is the choice you put the most money on"; its own
  --       order only settles EQUAL bids. The stored order is DERIVED from the
  --       bids (dense 1..n, stable within a bid — the new claim goes after
  --       the claims bidding as much or more), so what the manager sees is
  --       what the run does; the reorder verb refuses to break it.
  IF v_waiver_type = 'faab' THEN
    UPDATE public.waiver_claims c
    SET claim_order = o.rn
    FROM (SELECT c2.id, row_number() OVER (ORDER BY c2.faab_bid DESC, c2.claim_order, c2.created_at, c2.id)::int AS rn
          FROM public.waiver_claims c2
          WHERE c2.team_id = p_team_id AND c2.status = 'pending') o
    WHERE c.id = o.id AND c.claim_order <> o.rn;
    SELECT c.* INTO v_claim FROM public.waiver_claims c WHERE c.id = v_claim.id;
  END IF;

  -- (11) THE COMMISSIONER ARM (TD5): ONE audit row, the system post, the
  --      manager's notification — blind-safe (no player, no bid, league-side).
  IF NOT v_is_manager THEN
    v_receipt := public.waiver_claim_receipt_internal(
      p_league_id, v_team, 'submit_waiver_claim', 'submitted a waiver claim for',
      jsonb_build_array(v_claim.id), v_reason, p_action_id, 'waiver_claim_submit', v_league.season,
      'The commissioner placed a waiver claim for your team',
      'Claim: add ' || v_add_p.full_name
        || CASE WHEN p_drop IS NULL THEN '' ELSE ', drop ' || v_drop_p.full_name END
        || CASE WHEN v_waiver_type = 'faab' THEN ', bid $' || v_bid ELSE '' END
        || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
      jsonb_build_object('claim_id', v_claim.id, 'add_player_id', p_add, 'drop_player_id', p_drop, 'faab_bid', v_bid));
  END IF;

  v_result := jsonb_build_object(
    'verb',                   'waiver_claim_submit',
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'claim', jsonb_build_object(
      'id',             v_claim.id,
      'add_player_id',  v_claim.add_player_id,
      'drop_player_id', v_claim.drop_player_id,
      'faab_bid',       v_claim.faab_bid,
      'claim_order',    v_claim.claim_order,
      'status',         v_claim.status,
      'process_at',     v_claim.process_at,
      'created_at',     v_claim.created_at),
    'add_player_name',        v_add_p.full_name,
    'drop_player_name',       v_drop_p.full_name,
    'waiver_type',            v_waiver_type,
    'faab_min_bid',           CASE WHEN v_waiver_type = 'faab' THEN v_min_bid END,
    'faab_balance',           CASE WHEN v_waiver_type = 'faab' THEN v_balance END,
    'faab_spent',             0,
    'faab_spent_why',         'a claim spends nothing when it is placed — the bid is checked against the balance now and debited only if the claim WINS at the waiver run (TD2)',
    'settled_by',             'the next waiver run — the drop''s lock, roster room, caps and competing bids are decided there; a player whose game has started is refused here (F407)',
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'notified_user_id',       v_receipt ->> 'notified_user_id',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.waiver_claim_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, 'waiver_claim_submit', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- trade_check_internal — 162:103-313 FILE TEXT (D137), 12 hunks (+18 / -19).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_check_internal(
  p_verb            TEXT,
  p_league          public.leagues,
  p_proposer        public.teams,
  p_recipient       public.teams,
  p_items           JSONB,
  p_proposer_drops  TEXT[],
  p_recipient_drops TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_roster_size   INTEGER;
  v_item          RECORD;
  v_player        public.players;
  v_holder        public.league_rosters;
  v_holder_team   public.teams;
  v_allow_faab    BOOLEAN;
  v_allow_future  BOOLEAN;
  v_gives_p       INTEGER;
  v_gives_r       INTEGER;
  v_side          RECORD;
  v_drop          TEXT;
  v_seen          TEXT[];
  v_has_seat      BOOLEAN;
  v_balance       INTEGER;
  v_before        INTEGER;
  v_out           INTEGER;
  v_in            INTEGER;
  v_ndrops        INTEGER;
  v_after         INTEGER;
  v_facts         JSONB := '{}'::jsonb;
BEGIN
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(p_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((p_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(p_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;

  -- (a) EXCLUSIVITY (rule 7 / §12.7): every player leg is on the roster of
  --     the team the trade says gives him — never another team's, never
  --     nobody's.
  FOR v_item IN
    SELECT i.player_id, i.from_team_id
    FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
    WHERE i.player_id IS NOT NULL
    ORDER BY i.player_id
  LOOP
    SELECT p.* INTO v_player FROM public.players p WHERE p.id = v_item.player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: no player with id % (trade leg)', p_verb, v_item.player_id USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_holder FROM public.league_rosters r
    WHERE r.league_id = p_league.id AND r.player_id = v_item.player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % isn''t on any team in this league — only a player on a roster can be traded',
        p_verb, v_player.full_name
        USING ERRCODE = 'P0001';
    END IF;
    IF v_holder.team_id <> v_item.from_team_id THEN
      SELECT t.* INTO v_holder_team FROM public.teams t WHERE t.id = v_holder.team_id;
      RAISE EXCEPTION
        '%: % is on %''s roster, not %''s — a trade can only move a player from the team that has him',
        p_verb, v_player.full_name, v_holder_team.name,
        CASE WHEN v_item.from_team_id = p_proposer.id THEN p_proposer.name ELSE p_recipient.name END
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (b) BOTH SIDES GIVE SOMETHING — unless the league allows future
  --     considerations (§7.3.5: "notes-only gentleman's trades").
  v_allow_faab   := COALESCE((p_league.settings ->> 'allow_faab_in_trades')::boolean, FALSE);
  v_allow_future := COALESCE((p_league.settings ->> 'allow_future_considerations')::boolean, FALSE);
  SELECT count(*) FILTER (WHERE i.from_team_id = p_proposer.id)::int,
         count(*) FILTER (WHERE i.from_team_id = p_recipient.id)::int
  INTO v_gives_p, v_gives_r
  FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID);
  IF (v_gives_p = 0 OR v_gives_r = 0) AND NOT v_allow_future THEN
    RAISE EXCEPTION
      '%: % gives nothing in this trade — this league doesn''t allow future considerations, so each team gives at least one player or FAAB',
      p_verb, CASE WHEN v_gives_p = 0 THEN p_proposer.name ELSE p_recipient.name END
      USING ERRCODE = 'P0001';
  END IF;

  -- (c) FAAB LEGS — only when allowed, only in a FAAB league, never above
  --     the giver's CURRENT balance (checked here, moved at execution).
  FOR v_item IN
    SELECT i.faab_amount, i.from_team_id
    FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
    WHERE i.faab_amount IS NOT NULL
    ORDER BY i.from_team_id
  LOOP
    IF NOT v_allow_faab THEN
      RAISE EXCEPTION '%: FAAB can''t be traded in this league', p_verb
        USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(p_league.waiver_type, 'faab') <> 'faab' THEN
      RAISE EXCEPTION
        '%: this league doesn''t use FAAB for waivers, so there is no FAAB to trade',
        p_verb
        USING ERRCODE = 'P0001';
    END IF;
    v_has_seat := NULL;
    v_balance := NULL;
    SELECT TRUE, m.faab_balance INTO v_has_seat, v_balance
    FROM public.league_members m
    WHERE m.league_id = p_league.id AND m.team_id = v_item.from_team_id;
    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        '%: % has no FAAB balance on record, so it can''t trade FAAB',
        p_verb, CASE WHEN v_item.from_team_id = p_proposer.id THEN p_proposer.name ELSE p_recipient.name END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_item.faab_amount > v_balance THEN
      RAISE EXCEPTION '%: % cannot give $% of FAAB — its balance is $%',
        p_verb, CASE WHEN v_item.from_team_id = p_proposer.id THEN p_proposer.name ELSE p_recipient.name END,
        v_item.faab_amount, v_balance
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (d) EACH SIDE: its drops are its own, distinct, not already leaving in
  --     the trade; its roster fits after the trade (E36).
  FOR v_side IN
    SELECT * FROM (VALUES
      ('proposer'::text,  p_proposer.id,  p_proposer.name,  p_proposer_drops,  TRUE),
      ('recipient'::text, p_recipient.id, p_recipient.name, p_recipient_drops, p_recipient_drops IS NOT NULL)
    ) AS s(role, team_id, team_name, drops, enforce)
  LOOP
    v_seen := ARRAY[]::text[];
    FOREACH v_drop IN ARRAY COALESCE(v_side.drops, ARRAY[]::text[]) LOOP
      IF v_drop IS NULL THEN
        RAISE EXCEPTION '%: a drop for % is NULL — every drop names one player', p_verb, v_side.team_name
          USING ERRCODE = '22023';
      END IF;
      IF v_drop = ANY (v_seen) THEN
        RAISE EXCEPTION '%: % names the drop % twice — each player is dropped once', p_verb, v_side.team_name, v_drop
          USING ERRCODE = '22023';
      END IF;
      v_seen := v_seen || v_drop;
      SELECT p.* INTO v_player FROM public.players p WHERE p.id = v_drop;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (drop)', p_verb, v_drop USING ERRCODE = 'P0001';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.league_rosters r
                     WHERE r.league_id = p_league.id AND r.team_id = v_side.team_id AND r.player_id = v_drop) THEN
        RAISE EXCEPTION
          '%: % is not on %''s roster — a team can only drop its own players to make room',
          p_verb, v_player.full_name, v_side.team_name
          USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
                 WHERE i.player_id = v_drop) THEN
        RAISE EXCEPTION
          '%: % is already leaving % in this trade, so he can''t also be one of its drops',
          p_verb, v_player.full_name, v_side.team_name
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    SELECT count(*)::int INTO v_before
    FROM public.league_rosters r WHERE r.league_id = p_league.id AND r.team_id = v_side.team_id;
    SELECT count(*) FILTER (WHERE i.from_team_id = v_side.team_id)::int,
           count(*) FILTER (WHERE i.to_team_id = v_side.team_id)::int
    INTO v_out, v_in
    FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
    WHERE i.player_id IS NOT NULL;
    v_ndrops := COALESCE(cardinality(v_side.drops), 0);
    v_after := v_before - v_out + v_in - v_ndrops;

    IF v_side.enforce AND v_after > v_roster_size AND p_verb IS DISTINCT FROM 'trade_preview' THEN
      -- 151 (F414): the words name who can fix it. At execution nobody can
      -- name drops any more; at acceptance the PROPOSING team's overflow (it
      -- added players after proposing) is the proposer's to fix — the
      -- receiving manager cannot name drops for another team.
      IF p_verb = 'trade_execute' THEN
        RAISE EXCEPTION
          '%: %''s roster would hold % players after this trade — % more than its % spots: it has added players since the trade was agreed, so the trade can''t go through as agreed',
          p_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size
          USING ERRCODE = 'P0001';
      ELSIF v_side.role = 'proposer' AND p_recipient_drops IS NOT NULL THEN
        RAISE EXCEPTION
          '%: %''s roster no longer fits this offer — it would hold % players after the trade, % more than its % spots, because it has added players since proposing; only % can fix that, so ask them to cancel and send it again with drops',
          p_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size, v_side.team_name
          USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION
        '%: %''s roster would hold % players after this trade — % more than its % spots: name % more drop(s) as part of the trade',
        p_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size, v_after - v_roster_size
        USING ERRCODE = 'P0001';
    END IF;

    v_facts := v_facts || jsonb_build_object(v_side.role, jsonb_build_object(
      'team_id',      v_side.team_id,
      'count_before', v_before,
      'players_out',  v_out,
      'players_in',   v_in,
      'drops',        v_ndrops,
      'count_after',  v_after,
      'roster_size',  v_roster_size,
      'must_drop',    GREATEST(v_after - v_roster_size, 0),
      'enforced',     v_side.enforce));
  END LOOP;

  RETURN v_facts || jsonb_build_object(
    'allow_faab_in_trades',        v_allow_faab,
    'allow_future_considerations', v_allow_future);
END;
$$;

-- ---------------------------------------------------------------------------
-- §2 — the schema remnants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams DROP CONSTRAINT teams_successor_not_self;
ALTER TABLE public.teams DROP COLUMN successor_team_id;   -- teams_successor_team_id_fkey goes with it
ALTER TABLE public.teams DROP COLUMN retired_at_week;
ALTER TABLE public.teams
  DROP CONSTRAINT teams_status_valid,
  ADD CONSTRAINT teams_status_valid CHECK (status IN ('active', 'orphaned'));
ALTER TABLE public.team_managers
  DROP CONSTRAINT team_managers_end_reason_valid,
  ADD CONSTRAINT team_managers_end_reason_valid
    CHECK (end_reason IS NULL OR end_reason IN ('kicked', 'left', 'replaced'));

-- ---------------------------------------------------------------------------
-- §3 — loud if any live function still names a dropped column.
-- ---------------------------------------------------------------------------
DO $chk$
DECLARE
  v_fns TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_fns
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosrc ~ '(retired_at_week|successor_team_id)';
  IF v_fns IS NOT NULL THEN
    RAISE EXCEPTION '199: these functions still read a dropped column: %', v_fns;
  END IF;
END
$chk$;
