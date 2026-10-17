-- ============================================================================
-- 193 — the operator's every-league table (M8 follow-up, Chris 2026-10-15:
--       "in admin i should have a table of all leagues, their members, their
--       settings etc"; discharges F599; PROGRESS D521; read-only, writes
--       nothing)
-- ============================================================================
--
-- WHAT THIS ADDS (two read-only doors, three PLAIN internals):
--
--   op_list_leagues(p_q, p_sort, p_desc, p_limit, p_offset, p_include_deleted)
--     EVERY league on the platform (deleted ones only when asked), one page
--     at a time, with the TRUE total beside the page — never a silent cap.
--     Per league: name, phase in plain words, season, created, commissioner
--     (username), members / teams / open seats, draft type + status, current
--     week, and the key settings in plain words (scoring preset or custom,
--     roster size, waiver type, trade review, playoff teams, FAAB budget,
--     schedule).
--   op_league_detail(p_league_id)
--     one league (deleted too — the operator may need to look at one): the
--     same row, the FULL settings (columns + the settings blob + roster
--     shape, raw beside the plain words), and every seat: team name, manager
--     username, role, joined date, autopilot on/off, vacant, record (from
--     the league's own standings read, 120 `league_standings_internal`).
--
-- WHY AN RPC (F599): `leagues` RLS (052) shows a member only his own leagues,
-- so the console's name search could not reach any other league. The doors
-- are SECURITY DEFINER (owner reads every league), search_path '', and gate
-- IN-BODY on `is_platform_operator()` (182, TD1 — never league_members).
-- NO identity swap (R1545): nothing touches request.jwt.claims; the
-- internals take no caller identity. Each answer is ONE jsonb value, so
-- PostgREST's 1000-row cap cannot truncate it; the list is LIMITed to at
-- most 100 per page with `total` stated, the member list is bounded by the
-- league's seats (≤ 16 teams).
--
-- FAIL LOUD: an unknown league is P0002; a bad sort / page / limit is 22023
-- by name, never a quietly-defaulted page. A standings read that fails is
-- reported as `record_error` with its words, never as 0-0.
--
-- CHECKLIST (tasks-M* §4.4): no table, no policy, no write. Doors DEFINER +
-- search_path '' + in-body gate, EXECUTE authenticated only; internals PLAIN,
-- search_path '', REVOKEd from PUBLIC / anon / authenticated. No R6 / D38
-- waiver needed. DEPLOY BEFORE PUSH (TD9): the GET routes answer a named 503
-- (PGRST202) until this is pushed. pgTAP 141_operator_league_table.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- One league's row, in plain words (shared by the list and the detail).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_league_row_internal(l public.leagues)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH m AS (
    SELECT count(*) FILTER (WHERE lm.user_id IS NOT NULL)::int AS members,
           count(*) FILTER (WHERE lm.user_id IS NULL)::int AS vacant_seats
    FROM public.league_members lm WHERE lm.league_id = l.id
  ),
  t AS (
    SELECT count(*)::int AS teams FROM public.teams tm
    WHERE tm.league_id = l.id AND tm.status <> 'retired'
  ),
  c AS (
    SELECT lm.user_id, p.username FROM public.league_members lm
    LEFT JOIN public.profiles p ON p.id = lm.user_id
    WHERE lm.league_id = l.id AND lm.role = 'commissioner'
    ORDER BY lm.joined_at NULLS LAST, lm.id LIMIT 1
  ),
  d AS (
    SELECT dr.id, dr.draft_type, dr.status FROM public.drafts dr
    WHERE dr.league_id = l.id AND dr.is_mock IS NOT TRUE
    ORDER BY dr.created_at DESC NULLS LAST, dr.id DESC LIMIT 1
  ),
  w AS (
    SELECT lw.week, lw.status FROM public.league_weeks lw
    WHERE lw.league_id = l.id AND lw.season = l.season AND lw.status <> 'final'
    ORDER BY lw.week LIMIT 1
  ),
  s AS (
    SELECT ss.name, (ss.is_system_default OR ss.is_template) AS is_preset
    FROM public.scoring_systems ss WHERE ss.id = l.scoring_system_id
  ),
  r AS (
    SELECT COALESCE((SELECT sum(COALESCE((x ->> 'count')::int, 0))
                     FROM jsonb_array_elements(COALESCE(l.roster_settings -> 'starting_slots', '[]')) x), 0)::int AS starters,
           COALESCE((l.roster_settings ->> 'bench')::int, 0) AS bench,
           COALESCE(jsonb_array_length(COALESCE(l.roster_settings -> 'ir_slots', '[]')), 0) AS ir
  )
  SELECT jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'status', l.status,
    'phase', CASE l.status WHEN 'setup' THEN 'Setting up' WHEN 'scheduled' THEN 'Draft scheduled'
                           WHEN 'drafting' THEN 'Drafting' WHEN 'in_season' THEN 'In season'
                           WHEN 'playoffs' THEN 'Playoffs' WHEN 'complete' THEN 'Season over'
                           ELSE l.status END,
    'season', l.season,
    'created_at', l.created_at,
    'deleted_at', l.deleted_at,
    'commissioner_id', (SELECT c.user_id FROM c),
    'commissioner', (SELECT c.username FROM c),
    'team_count', l.team_count,
    'members', (SELECT m.members FROM m),
    'teams', (SELECT t.teams FROM t),
    'vacant_seats', (SELECT m.vacant_seats FROM m),
    'open_seats', GREATEST(l.team_count - (SELECT m.members FROM m), 0),
    'draft', (SELECT jsonb_build_object('id', d.id, 'type', d.draft_type, 'status', d.status,
                'summary', initcap(d.draft_type) || ' draft — ' ||
                  CASE d.status WHEN 'scheduled' THEN 'not started' WHEN 'live' THEN 'live now'
                                WHEN 'paused' THEN 'paused' WHEN 'complete' THEN 'done' ELSE d.status END)
              FROM d),
    'current_week', (SELECT jsonb_build_object('week', w.week, 'status', w.status,
                       'summary', 'Week ' || w.week || ' — ' ||
                         CASE w.status WHEN 'upcoming' THEN 'not started' WHEN 'live' THEN 'being played'
                                       WHEN 'correction_window' THEN 'games over, stat fixes still count'
                                       ELSE w.status END)
                     FROM w),
    'settings_summary', jsonb_build_object(
      'scoring', COALESCE((SELECT CASE WHEN s.is_preset THEN 'Preset: ' ELSE 'Custom: ' END || s.name FROM s),
                          CASE WHEN l.scoring_system_id IS NULL THEN 'Custom (league''s own rules)'
                               ELSE 'Scoring system missing' END),
      'roster_size', (SELECT r.starters + r.bench + r.ir FROM r),
      'roster', (SELECT r.starters || ' starters, ' || r.bench || ' bench, ' || r.ir || ' IR' FROM r),
      'waivers', CASE l.waiver_type WHEN 'faab' THEN 'FAAB ($' || l.faab_budget || ' budget)'
                                    WHEN 'rolling_priority' THEN 'Rolling priority'
                                    WHEN 'reverse_standings' THEN 'Reverse standings'
                                    ELSE l.waiver_type END,
      'trade_review', CASE l.trade_review WHEN 'none' THEN 'No review'
                                          WHEN 'commissioner' THEN 'Commissioner reviews'
                                          WHEN 'league_vote' THEN 'League vote'
                                          ELSE l.trade_review END,
      'trade_deadline', CASE WHEN l.trade_deadline_week IS NULL THEN 'No deadline'
                             ELSE 'After week ' || l.trade_deadline_week END,
      'playoffs', CASE WHEN l.playoff_teams = 0 THEN 'No playoffs'
                       ELSE l.playoff_teams || ' teams from week ' || l.playoff_start_week END,
      'season_length', l.regular_season_weeks || ' regular-season weeks',
      'schedule', CASE COALESCE(l.settings ->> 'schedule_mode', 'h2h')
                    WHEN 'h2h' THEN 'Head to head' WHEN 'total_points' THEN 'Total points'
                    ELSE l.settings ->> 'schedule_mode' END
                  || CASE WHEN COALESCE((l.settings ->> 'median_game')::boolean, FALSE)
                          THEN ' + median game' ELSE '' END));
$$;
REVOKE ALL ON FUNCTION op_league_row_internal(public.leagues) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- op_list_leagues
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_list_leagues_internal(
  p_q TEXT, p_sort TEXT, p_desc BOOLEAN, p_limit INTEGER, p_offset INTEGER, p_include_deleted BOOLEAN, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_q TEXT := btrim(COALESCE(p_q, ''));
  v_total INTEGER;
  v_rows JSONB;
BEGIN
  IF p_sort IS NULL OR p_sort NOT IN ('name', 'created', 'season', 'status', 'members', 'commissioner') THEN
    RAISE EXCEPTION 'list_leagues: sort must be name, created, season, status, members or commissioner (got %)', p_sort
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'list_leagues: a page is 1 to 100 leagues (got %)', p_limit USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'list_leagues: the page start cannot be negative (got %)', p_offset USING ERRCODE = '22023';
  END IF;
  IF length(v_q) > 80 THEN
    RAISE EXCEPTION 'list_leagues: search is at most 80 characters' USING ERRCODE = '22023';
  END IF;

  WITH hit AS (
    SELECT l.id, l.name, l.status, l.season, l.created_at,
           (SELECT p.username FROM public.league_members lm JOIN public.profiles p ON p.id = lm.user_id
            WHERE lm.league_id = l.id AND lm.role = 'commissioner'
            ORDER BY lm.joined_at NULLS LAST, lm.id LIMIT 1) AS commish,
           (SELECT count(*) FROM public.league_members lm
            WHERE lm.league_id = l.id AND lm.user_id IS NOT NULL)::int AS n_members
    FROM public.leagues l
    WHERE (COALESCE(p_include_deleted, FALSE) OR l.deleted_at IS NULL)
      -- the search text is matched literally (no LIKE wildcards), on the
      -- league name or the commissioner's username.
      AND (v_q = '' OR strpos(lower(l.name), lower(v_q)) > 0
           OR EXISTS (SELECT 1 FROM public.league_members lm JOIN public.profiles p ON p.id = lm.user_id
                      WHERE lm.league_id = l.id AND lm.role = 'commissioner'
                        AND strpos(lower(p.username), lower(v_q)) > 0))
  ),
  page AS (
    SELECT h.id, row_number() OVER (ORDER BY
      CASE WHEN NOT p_desc THEN CASE p_sort WHEN 'name' THEN lower(h.name) WHEN 'status' THEN h.status
                                            WHEN 'commissioner' THEN lower(h.commish) END END ASC NULLS LAST,
      CASE WHEN p_desc THEN CASE p_sort WHEN 'name' THEN lower(h.name) WHEN 'status' THEN h.status
                                        WHEN 'commissioner' THEN lower(h.commish) END END DESC NULLS LAST,
      CASE WHEN NOT p_desc THEN CASE p_sort WHEN 'created' THEN extract(epoch FROM h.created_at)
                                            WHEN 'season' THEN h.season WHEN 'members' THEN h.n_members END END ASC NULLS LAST,
      CASE WHEN p_desc THEN CASE p_sort WHEN 'created' THEN extract(epoch FROM h.created_at)
                                        WHEN 'season' THEN h.season WHEN 'members' THEN h.n_members END END DESC NULLS LAST,
      h.created_at DESC NULLS LAST, h.id) AS ord
    FROM hit h
  )
  SELECT (SELECT count(*)::int FROM hit),
         COALESCE((SELECT jsonb_agg(public.op_league_row_internal(l) ORDER BY pg.ord)
                   FROM (SELECT * FROM page ORDER BY ord LIMIT p_limit OFFSET p_offset) pg
                   JOIN public.leagues l ON l.id = pg.id), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'as_of', p_at, 'q', v_q, 'sort', p_sort, 'desc', p_desc,
    'include_deleted', COALESCE(p_include_deleted, FALSE),
    'total', v_total, 'limit', p_limit, 'offset', p_offset,
    'more', p_offset + jsonb_array_length(v_rows) < v_total,
    'leagues', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION op_list_leagues_internal(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, BOOLEAN, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION op_list_leagues(
  p_q TEXT DEFAULT '', p_sort TEXT DEFAULT 'created', p_desc BOOLEAN DEFAULT TRUE,
  p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0, p_include_deleted BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'list_leagues: only a platform operator can read this (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_list_leagues_internal(p_q, p_sort, p_desc, p_limit, p_offset, p_include_deleted, now());
END;
$$;
REVOKE ALL ON FUNCTION op_list_leagues(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_list_leagues(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, BOOLEAN) TO authenticated;
COMMENT ON FUNCTION op_list_leagues(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, BOOLEAN) IS
  'M8 admin league table (migration 193, F599): every league on the platform (deleted only when asked), searched by name or commissioner, sorted, one page of at most 100 with the true total. Read-only; operators only (in-body gate).';

-- ---------------------------------------------------------------------------
-- op_league_detail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_league_detail_internal(p_league_id UUID, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league public.leagues%ROWTYPE;
  v_standings JSONB;
  v_record_error TEXT;
BEGIN
  SELECT * INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_detail: no such league %', p_league_id USING ERRCODE = 'P0002';
  END IF;

  IF v_league.deleted_at IS NOT NULL THEN
    v_record_error := 'The league is deleted, so it has no standings.';
  ELSE
    BEGIN
      v_standings := public.league_standings_internal(p_league_id, FALSE) -> 'standings';
    EXCEPTION WHEN OTHERS THEN
      v_record_error := 'Standings could not be read: ' || SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'as_of', p_at,
    'league', public.op_league_row_internal(v_league),
    'settings', jsonb_build_object(
      'format', v_league.format,
      'team_count', v_league.team_count,
      'regular_season_weeks', v_league.regular_season_weeks,
      'playoff_teams', v_league.playoff_teams,
      'playoff_start_week', v_league.playoff_start_week,
      'waiver_type', v_league.waiver_type,
      'faab_budget', v_league.faab_budget,
      'trade_review', v_league.trade_review,
      'trade_deadline_week', v_league.trade_deadline_week,
      'lineup_lock', v_league.lineup_lock,
      'scoring_system_id', v_league.scoring_system_id,
      'roster_settings', v_league.roster_settings,
      'settings', v_league.settings),
    'record_error', v_record_error,
    'members', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'member_id', lm.id,
               'team_id', lm.team_id,
               'team_name', t.name,
               'team_status', t.status,
               'user_id', lm.user_id,
               'username', p.username,
               'role', lm.role,
               'joined_at', lm.joined_at,
               'vacant', lm.user_id IS NULL,
               'autopilot', COALESCE(ap.is_on, FALSE),
               'record', (SELECT jsonb_build_object('wins', (s ->> 'wins')::int, 'losses', (s ->> 'losses')::int,
                                                    'ties', (s ->> 'ties')::int, 'rank', (s ->> 'rank')::int,
                                                    'points_for', s -> 'points_for')
                          FROM jsonb_array_elements(COALESCE(v_standings, '[]'::jsonb)) s
                          WHERE (s ->> 'team_id')::uuid = lm.team_id LIMIT 1))
             ORDER BY CASE lm.role WHEN 'commissioner' THEN 0 WHEN 'co_commissioner' THEN 1 ELSE 2 END,
                      lower(t.name) NULLS LAST, lm.id), '[]'::jsonb)
      FROM public.league_members lm
      LEFT JOIN public.teams t ON t.id = lm.team_id
      LEFT JOIN public.profiles p ON p.id = lm.user_id
      LEFT JOIN public.team_autopilot ap ON ap.team_id = lm.team_id
      WHERE lm.league_id = p_league_id));
END;
$$;
REVOKE ALL ON FUNCTION op_league_detail_internal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION op_league_detail(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'league_detail: only a platform operator can read this (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_league_detail_internal(p_league_id, now());
END;
$$;
REVOKE ALL ON FUNCTION op_league_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_league_detail(UUID) TO authenticated;
COMMENT ON FUNCTION op_league_detail(UUID) IS
  'M8 admin league table (migration 193): one league (deleted too) — its row, full settings, and every seat with manager, role, joined date, autopilot, vacancy and record. Read-only; operators only (in-body gate); P0002 for an unknown league.';
