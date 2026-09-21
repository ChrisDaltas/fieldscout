-- ============================================================================
-- THE REMIX PREVIEW STOPS SAYING A REASON IS REQUIRED — migration 132
-- (task L.E1.13 of M6A — tasks-M6A §6 L.E1.13 + its AS-BUILT note; PROGRESS
-- F363(c) / F361's remainder / R1056; Q66, ruled by Chris 2026-09-16, spec
-- v2.16.41 §10 / §11.7 / E41: a reason is OPTIONAL on every commissioner
-- action, the audit row is always written.)
--
-- WHAT WAS WRONG. Since migration 131 `schedule_remix_confirm` lands with no
-- reason in every window and answers `reason_required = false`; but the
-- PREVIEW of the very same Remix — `schedule_preview` → this function —
-- still answered `window.reason_required = NOT free` (111:508). One API,
-- one league, one window, two answers (R1056), and the Remix modal's
-- `confirmGate` client-blocked Confirm on the stale one. 131 left it out by
-- name (131:78 — "a READ function, not a commissioner verb"); F363(c) routed
-- it to L.E1.13 to flip TOGETHER with the modal's gate. This is that flip.
--
-- MECHANISM — `CREATE OR REPLACE` against FILE TEXT (D137; CLAUDE.md
-- "Migration discipline"). The NEWEST definer of
-- `schedule_remix_plan_internal` is 111 (measured: `grep -ln` over
-- supabase/migrations — 130 and 131 re-define `schedule_edit_matchup` and
-- `schedule_remix_confirm`, never this function). The body below is a
-- programmatic EXTRACTION of 111:290-522 (the function through its own
-- REVOKE) with EXACTLY ONE hunk applied by exact-match replacement (asserted
-- to match once):
--
--     -      'reason_required',  NOT v_window.free),
--     +      'reason_required',  FALSE),   -- 132 / Q66 …
--
-- `window.free` is UNTOUCHED — it is E41's datum and still decides the
-- post's wording ("override" clause) and the modal's copy. The field
-- `reason_required` is KEPT (the panel's type reads it; 131 kept it in both
-- verbs for the same reason) and is now the literal FALSE at every site that
-- reports it. `schedule_window_internal` (111:234) is byte-untouched: it
-- never carried the field — R1056 / F363(c)'s "schedule_window_internal
-- (111:508)" names the line, and the line is in THIS function.
--
-- CHECKLIST (tasks-M* §4.4). No table, column, policy, trigger, index or
-- grant change: one function body, same signature (UUID, BIGINT,
-- TIMESTAMPTZ), same LANGUAGE / SECURITY posture / `search_path = ''`, and
-- its REVOKE from PUBLIC, anon, authenticated re-issued verbatim (CREATE OR
-- REPLACE preserves grants; re-issuing is the house hygiene). R6/D38 waivers
-- not needed (no DDL beyond CREATE OR REPLACE). Typegen: no signature moved —
-- `src/types/database.ts` regenerated and measured byte-identical. 045's
-- function census does not move (no new function).
--
-- PROOF. pgTAP 059's two preview pins re-cut (the free-window cell already
-- said false; the post-kickoff cell at 059:557 pinned TRUE "until L.E1.13"
-- and now pins FALSE) and pgTAP 080 (this migration's own): the preview and
-- the confirm AGREE in both windows, `free` still flips at kickoff, the body
-- carries no `NOT v_window.free`, one overload, EXECUTE still revoked.
--
-- PRODUCTION: Chris owes a `npx supabase db push` for this file — never applied
-- by hand (CLAUDE.md "Migration discipline"). Until it is pushed the hosted
-- preview keeps answering `NOT free`; the modal no longer reads it as a gate.
-- ============================================================================

CREATE OR REPLACE FUNCTION schedule_remix_plan_internal(
  p_league_id UUID,
  p_seed      BIGINT,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league   public.leagues;
  v_ids      UUID[];
  v_n        INTEGER;
  v_settings JSONB;
  v_mode     TEXT;
  v_second   BOOLEAN;
  v_first    INTEGER;
  v_last     INTEGER;
  v_window   RECORD;
  v_frozen   JSONB;
  v_regen    INTEGER[];
  v_proposed JSONB;
  v_diff     JSONB;
  v_changes  INTEGER;
  v_current  INTEGER;
  v_regen_rows INTEGER;
BEGIN
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schedule_remix_plan_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  IF v_mode <> 'h2h' THEN
    RAISE EXCEPTION
      'schedule_remix: league % is a % league — it has no matchups to remix (§11.7 "Total-points leagues generate no matchups")',
      p_league_id, v_mode
      USING ERRCODE = 'P0001';
  END IF;
  v_second := COALESCE((v_settings ->> 'second_opponent')::boolean, FALSE);

  -- The league's first week (league Week 1 — for a mid-season league an NFL
  -- week > 1, Q29/D288): the plan 110 materialized.
  SELECT min(w.week) INTO v_first
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_league.season;
  IF v_first IS NULL THEN
    RAISE EXCEPTION
      'schedule_remix: league % has no league_weeks rows for season % — no schedule was generated (§11.4 generation is draft completion''s); nothing to remix',
      p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;
  v_last := v_first + v_league.regular_season_weeks - 1;

  -- The seated franchises — the engine's own source (110:663–678), so the
  -- proposed set is same-league by construction (pinned in 059).
  SELECT array_agg(t.id ORDER BY t.id), count(*)::int
    INTO v_ids, v_n
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_n <> v_league.team_count THEN
    RAISE EXCEPTION
      'schedule_remix: league % has % of % franchises seated — a schedule needs every seat (§7.2/D96)',
      p_league_id, v_n, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::int INTO v_current
  FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_league.season
    AND m.round_type IN ('regular', 'secondary');
  IF v_current = 0 THEN
    RAISE EXCEPTION
      'schedule_remix: league % has no regular-season matchup rows for season % — nothing to remix',
      p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;

  -- E41: the window, evaluated at p_at against the FIRST week's kickoff.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, v_first, p_at);

  -- Week classification: REGENERABLE iff the league_weeks row is `upcoming`
  -- AND every matchup row of the week is `scheduled`; otherwise FROZEN, whole,
  -- with the reason named (§11.7: live/final never regenerate; a mixed week
  -- cannot be part-replaced without double-booking the kept rows' teams).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'week', c.week, 'week_status', c.week_status, 'reason', c.reason)
           ORDER BY c.week) FILTER (WHERE c.reason IS NOT NULL), '[]'::jsonb),
         COALESCE(array_agg(c.week ORDER BY c.week) FILTER (WHERE c.reason IS NULL), ARRAY[]::int[])
    INTO v_frozen, v_regen
  FROM (
    SELECT w.week, w.status AS week_status,
           CASE
             WHEN w.status <> 'upcoming' THEN 'week_' || w.status
             -- R730: the week's OWN first kickoff, from nfl_games at call time
             -- (E42/§23.3/D291) — never a status column's opinion of the future.
             WHEN NOT (SELECT k.free FROM public.schedule_window_internal(v_league.season, w.week, p_at) k)
               THEN 'week_kicked_off'
             WHEN EXISTS (SELECT 1 FROM public.matchups m
                          WHERE m.league_id = p_league_id AND m.season = v_league.season
                            AND m.week = w.week AND m.status <> 'scheduled')
               THEN 'matchup_not_scheduled'
             -- R733: an overridden or scored cell is never regenerated (rule 9),
             -- whatever its status says. Scores DEFAULT 0 (109) — non-zero, not
             -- non-NULL, is the tell.
             WHEN EXISTS (SELECT 1 FROM public.matchups m
                          WHERE m.league_id = p_league_id AND m.season = v_league.season
                            AND m.week = w.week
                            AND (m.is_overridden OR m.result IS NOT NULL
                                 OR COALESCE(m.home_score, 0) <> 0 OR COALESCE(m.away_score, 0) <> 0))
               THEN 'matchup_overridden_or_scored'
             ELSE NULL
           END AS reason
    FROM public.league_weeks w
    WHERE w.league_id = p_league_id AND w.season = v_league.season
      AND w.week BETWEEN v_first AND v_last
  ) c;

  SELECT count(*)::int INTO v_regen_rows
  FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_league.season
    AND m.round_type IN ('regular', 'secondary')
    AND m.week = ANY (v_regen);

  -- The proposed set: the pure builder over the whole regular season
  -- (D289 — the same generator, not writing), kept rows for frozen weeks.
  WITH built AS (
    SELECT b.week, b.round_type, b.home_team_id, b.away_team_id
    FROM public.schedule_build_internal(v_ids, p_seed, v_first, v_league.regular_season_weeks, v_second) b
  ),
  proposed AS (
    SELECT b.week, b.round_type, b.home_team_id, b.away_team_id, TRUE AS regenerated
    FROM built b WHERE b.week = ANY (v_regen)
    UNION ALL
    SELECT m.week, m.round_type, m.home_team_id, m.away_team_id, FALSE
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.round_type IN ('regular', 'secondary')
      AND NOT (m.week = ANY (v_regen))
  ),
  current_app AS (   -- one row per (week, type, team): opponent + side, today
    SELECT m.week, m.round_type, m.home_team_id AS team_id, m.away_team_id AS opp_id, 'home' AS side
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.round_type IN ('regular', 'secondary') AND m.week = ANY (v_regen)
    UNION ALL
    SELECT m.week, m.round_type, m.away_team_id, m.home_team_id, 'away'
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.round_type IN ('regular', 'secondary') AND m.week = ANY (v_regen)
  ),
  proposed_app AS (
    SELECT p.week, p.round_type, p.home_team_id AS team_id, p.away_team_id AS opp_id, 'home' AS side
    FROM proposed p WHERE p.regenerated
    UNION ALL
    SELECT p.week, p.round_type, p.away_team_id, p.home_team_id, 'away'
    FROM proposed p WHERE p.regenerated
  ),
  diff AS (
    SELECT c.week, c.round_type, c.team_id,
           tn.name AS team_name,
           c.opp_id AS old_opponent_id, o1.name AS old_opponent_name,
           n.opp_id AS new_opponent_id, o2.name AS new_opponent_name,
           c.side AS old_side, n.side AS new_side,
           CASE
             WHEN c.opp_id IS DISTINCT FROM n.opp_id THEN
               'Week ' || c.week || CASE WHEN c.round_type = 'secondary' THEN ' (second game)' ELSE '' END
               || ': ' || tn.name || ' now plays ' || o2.name || ' instead of ' || o1.name
             ELSE
               'Week ' || c.week || CASE WHEN c.round_type = 'secondary' THEN ' (second game)' ELSE '' END
               || ': ' || tn.name || ' now ' || CASE WHEN n.side = 'home' THEN 'hosts ' ELSE 'visits ' END
               || o2.name || ' (was ' || c.side || ')'
           END AS text
    FROM current_app c
    JOIN proposed_app n ON n.week = c.week AND n.round_type = c.round_type AND n.team_id = c.team_id
    JOIN public.teams tn ON tn.id = c.team_id
    JOIN public.teams o1 ON o1.id = c.opp_id
    JOIN public.teams o2 ON o2.id = n.opp_id
    WHERE c.opp_id IS DISTINCT FROM n.opp_id OR c.side <> n.side
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'week', p.week, 'round_type', p.round_type,
              'home_team_id', p.home_team_id, 'away_team_id', p.away_team_id,
              'regenerated', p.regenerated)
              ORDER BY p.week, p.round_type, p.home_team_id), '[]'::jsonb)
     FROM proposed p),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'week', d.week, 'round_type', d.round_type,
              'team_id', d.team_id, 'team_name', d.team_name,
              'old_opponent_id', d.old_opponent_id, 'old_opponent_name', d.old_opponent_name,
              'new_opponent_id', d.new_opponent_id, 'new_opponent_name', d.new_opponent_name,
              'old_side', d.old_side, 'new_side', d.new_side,
              'text', d.text)
              ORDER BY d.week, d.round_type, d.team_name, d.team_id), '[]'::jsonb)
     FROM diff d),
    (SELECT count(*)::int FROM diff d)
  INTO v_proposed, v_diff, v_changes;

  RETURN jsonb_build_object(
    'league_id',            p_league_id,
    'season',               v_league.season,
    'seed',                 p_seed,
    'current_seed',         (v_settings ->> 'schedule_seed')::bigint,
    'first_week',           v_first,
    'last_regular_week',    v_last,
    'regular_season_weeks', v_league.regular_season_weeks,
    'second_opponent',      v_second,
    'team_count',           v_n,
    'window', jsonb_build_object(
      'evaluated_at',     p_at,
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'free',             v_window.free,
      'reason_required',  FALSE),   -- 132 / Q66: nothing requires a reason; the field is kept for the panel's type and says so (F363(c), R1056)
    'weeks_regenerable',    to_jsonb(v_regen),
    'weeks_frozen',         v_frozen,
    'matchups_current',     v_current,
    'matchups_regenerable', v_regen_rows,
    'proposed',             v_proposed,
    'diff',                 v_diff,
    'change_count',         v_changes,
    'no_changes',           (v_changes = 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_remix_plan_internal(UUID, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
