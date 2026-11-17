-- ============================================================================
-- 225_daily_pings_pregame_refresh.sql — NEWS, PROJECTIONS AND PLAYER VALUES
-- WAKE VERCEL ONCE A DAY, PLUS ONE REFRESH AN HOUR BEFORE EACH KICKOFF;
-- AUTOPILOT USES VALUES UP TO 30 HOURS OLD.
--
-- Numbering: migration head measured 224 on origin/main (`ls supabase/
-- migrations/ | tail -1`), no 225 on any open PR (#598 / #528 / #180 carry no
-- migration in that range) ⇒ 225; pgTAP head 174 ⇒ 175.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- The Vercel Hobby pause of 2026-11-11 (224's banner; PROGRESS D850). After
-- 224, three pings still woke Vercel around the clock (F917(b)):
-- `ingest-player-news-ping` every 30 min (198), `sync-weekly-projections-
-- ping` hourly at :40 (136), `league-player-values-ping` hourly at :50 (137).
--
-- CHRIS'S RULINGS (2026-11-17, verbatim, in the orchestrator session):
--   * F917(b): "yes move those to once a day too".
--   * Q109 (options A = news daily; projections + values daily PLUS one extra
--     update about an hour before each kickoff slot / B / C): "do the hour
--     before each kickoff one".
--   * Q110 (autopilot chooses the minute a starting spot opens, not at
--     kickoff, so with that schedule some of its picks come more than 6 h
--     after an update and would go by draft position; option 1 = "Let
--     autopilot use projections up to about a day old. Your schedule stays
--     exactly as you ruled it, and autopilot works from the latest numbers
--     we have."): "go with option 1".
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
-- 1. THE DAILY SCHEDULES (names kept — 183's knob list names them):
--      ingest-player-news-ping        '30 13 * * *'  (was '*/30 * * * *')
--      sync-weekly-projections-ping   '40 12 * * *'  (was '40 * * * *')
--      league-player-values-ping      '50 12 * * *'  (was '50 * * * *')
--    Staggered off the 11:00Z `sync-live-sweep` (224), the 11:15Z reconcile
--    and the 15:00Z player sync (`vercel.json`), and off each other. Values
--    keeps its ten minutes after projections (137 reads 136's lines; the
--    compute half treats a line older than 6 h as absent — F387 — so values
--    must run soon after projections, and does).
-- 2. THE PRE-KICKOFF REFRESH. A new job `pregame-refresh-ping`, every 5
--    minutes ('*/5 * * * *' — free: it runs in the database), calls
--    `cron_wake_pregame_refresh()`, which pings Vercel ONLY when
--    `pregame_refresh_step(now)` names a step:
--      * THE SLOT: the earliest DISTINCT `nfl_games.kickoff_at` of the live
--        season (`live_poll_season`, 224) among games still `scheduled` (or
--        NULL status — 001's default; `final`, `live` and `postponed` never
--        start a refresh) with p_now < kickoff_at <= p_now + 60 minutes.
--        Derived from the schedule — no day or hour is hard-coded, so a
--        Thursday, Saturday, London or Monday game gets its refresh too.
--      * 'projections' — the slot has no stamp yet (`system_flags` key
--        `pregame_refresh`, value {kickoff_at, projections_at, values_at},
--        names a different kickoff or is absent): ping
--        `/api/cron/sync-weekly-projections` and stamp the slot. That run
--        also refreshes injury tags (D592) — the Out tags are fresh about an
--        hour before each slot.
--      * 'values' — the slot's projections ping is at least 10 minutes old
--        and its values ping has not been sent: ping
--        `/api/cron/league-player-values` (137 reads 136's lines — the same
--        ten-minute order as the daily pair) and stamp `values_at`.
--      * otherwise NULL: nothing is sent.
--    Once per slot: the stamp is keyed on the KICKOFF instant, so a tick
--    that comes late or early can neither skip nor repeat a slot; two
--    distinct kickoffs inside one hour (21:05Z / 21:25Z) each get their own
--    refresh, the second once the first has kicked off. A ping that raises
--    (a missing Vault secret) rolls the stamp back with it, so the next tick
--    retries. About 5–8 slots a week, two short calls each — instead of 168
--    hourly pairs.
-- 3. AUTOPILOT'S READ-SIDE BOUND: `lineup_autopilot_internal`'s `c_max_age`
--    6 h → 30 h (Q110). A values row or projection older than 30 h at the
--    tick instant is absent (F387's read half) — a day between daily runs
--    plus room for one late run. The compute half (`PROJECTION_MAX_AGE_MS`,
--    6 h, the values job's own read of the projection lines) is UNCHANGED:
--    values runs ten minutes after projections. The TypeScript twin is
--    `AUTOPILOT_VALUE_MAX_AGE_MS` (`player-values.ts`), pinned equal by V9a.
--    D137: CREATE OR REPLACE against the newest defining FILE TEXT,
--    201:1637-2273 (definers 125 / 138 / 139 / 142 / 152 / 154 / 157 / 201
--    — `grep -ln "FUNCTION lineup_autopilot_internal" supabase/migrations/*`
--    — 201 newest), ONE hunk: the four lines of the bound (its comment and
--    the constant) replaced by six, each ending `-- 225 / Q110`; not one
--    other byte. pgTAP 175's `pg_temp.un225` reverses it.
-- 4. 183's job-knob list (`op_job_check_internal`, 224's body verbatim —
--    HEAD of the chain) gains `ingest-player-news-ping` (refused as an
--    "unknown job" until now — noticed in the Q110 halt) and the new
--    `pregame-refresh-ping`: no operator knobs (Q98's stat-sync rule).
--
-- WHAT CHANGES FOR A LEAGUE MEMBER: player news arrives once a day (13:30Z,
-- 8:30 / 9:30 am ET) instead of every half hour. Weekly projections and the
-- league values autopilot sorts by refresh once a day (12:40Z / 12:50Z) and
-- again about an hour before each kickoff; injury tags from that feed are
-- fresh about an hour before each game (the 15:00Z full player sync is
-- unchanged). An autopilot team picks from the latest numbers whenever it
-- acts — at worst yesterday's — never from draft position on a normal day.
--
-- ---------------------------------------------------------------------------
-- MERGE BEFORE PUSH (main deploys at once, the DB only on Chris's push)
-- ---------------------------------------------------------------------------
-- The TypeScript in this PR is comments and one new constant (the sim's
-- mirror of the read bound); the routes are unchanged. Until the push the
-- old hourly schedules keep running against the same routes, and the
-- deployed autopilot keeps its 6 h bound — exactly today's behaviour.
--
-- SECURITY. `cron_wake_pregame_refresh` is SECURITY INVOKER for 124's / 224's
-- reason (the caller is pg_cron's `postgres`, which reads Vault; INVOKER
-- fails CLOSED for every API role), EXECUTE revoked from PUBLIC, anon,
-- authenticated AND service_role. The read-only predicate
-- `pregame_refresh_step` carries no secret and issues no request: REVOKEd
-- from PUBLIC/anon/authenticated, service_role keeps EXECUTE (the D291
-- harness door, as 224's predicates). search_path = '' on both. New
-- `system_flags` key `pregame_refresh` (world-readable like the rest, no
-- client write policy — 122 unchanged). `lineup_autopilot_internal` keeps
-- its posture (no SECURITY DEFINER, search_path '', the triple REVOKE
-- restated).
--
-- Staging rehearsal: R6 waiver — no staging clone; rehearsal evidence = the
-- fresh local `db reset` 001–225 + pgTAP 175 (and 084 / 085 / 086 / 148 /
-- the md5-pinning autopilot suites re-pinned) + `npm run test:db`.
-- No table is created or altered: two new functions, two replaced
-- (`lineup_autopilot_internal`, `op_job_check_internal`), four cron rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The pre-kickoff refresh — which step is due, if any
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pregame_refresh_step(p_now TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  c_lead   CONSTANT INTERVAL := interval '60 minutes';   -- "about an hour before each kickoff slot" (Q109)
  c_gap    CONSTANT INTERVAL := interval '10 minutes';   -- values after projections (137 reads 136)
  v_kick   TIMESTAMPTZ;
  v_flag   JSONB;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'pregame_refresh_step: p_now is required (the injected instant, D291)'
      USING ERRCODE = '22023';
  END IF;

  -- THE SLOT: the earliest distinct kickoff of the live season still to come
  -- within the hour, among games that have not started and are not
  -- postponed (NULL status reads as scheduled — 001's default).
  SELECT min(g.kickoff_at) INTO v_kick
    FROM public.nfl_games g
   WHERE g.season = public.live_poll_season(p_now)
     AND COALESCE(g.status, 'scheduled') = 'scheduled'
     AND g.kickoff_at >  p_now
     AND g.kickoff_at <= p_now + c_lead;

  IF v_kick IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT f.value INTO v_flag FROM public.system_flags f WHERE f.key = 'pregame_refresh';

  IF v_flag IS NULL OR (v_flag ->> 'kickoff_at')::TIMESTAMPTZ IS DISTINCT FROM v_kick THEN
    RETURN jsonb_build_object('step', 'projections', 'kickoff_at', v_kick);
  END IF;

  IF v_flag ->> 'values_at' IS NULL
     AND (v_flag ->> 'projections_at')::TIMESTAMPTZ <= p_now - c_gap THEN
    RETURN jsonb_build_object('step', 'values', 'kickoff_at', v_kick);
  END IF;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.pregame_refresh_step(TIMESTAMPTZ) IS
  'Migration 225 (Q109): which pre-kickoff refresh step is due at p_now, or NULL. The slot is the earliest distinct nfl_games.kickoff_at of live_poll_season(p_now) among games still scheduled (NULL status reads as scheduled; final / live / postponed never start one) with p_now < kickoff_at <= p_now + 60 min. {step: projections} when system_flags.pregame_refresh names another kickoff or is absent; {step: values} when that slot''s projections ping is at least 10 minutes old and its values ping not yet sent. Read-only; carries no secret.';
REVOKE EXECUTE ON FUNCTION public.pregame_refresh_step(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pregame_refresh_step(TIMESTAMPTZ) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The job body — decide, stamp, and ping only on a yes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_wake_pregame_refresh(p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER          -- 124's reason; see the banner
SET search_path = ''
AS $fn$
DECLARE
  v_due        JSONB := public.pregame_refresh_step(p_now);
  v_step       TEXT  := v_due ->> 'step';
  v_request_id BIGINT;
BEGIN
  IF v_step = 'projections' THEN
    INSERT INTO public.system_flags (key, value, updated_at)
    VALUES ('pregame_refresh',
            jsonb_build_object('kickoff_at', v_due -> 'kickoff_at', 'projections_at', p_now, 'values_at', NULL),
            p_now)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
    v_request_id := public.cron_ping_route('/api/cron/sync-weekly-projections');
  ELSIF v_step = 'values' THEN
    UPDATE public.system_flags f
       SET value = jsonb_set(f.value, '{values_at}', to_jsonb(p_now)), updated_at = p_now
     WHERE f.key = 'pregame_refresh';
    v_request_id := public.cron_ping_route('/api/cron/league-player-values');
  END IF;
  -- A ping that RAISES (a missing Vault secret) rolls the stamp back with
  -- it: the slot stays due and the next tick retries.
  RETURN jsonb_build_object('woke', v_step IS NOT NULL, 'step', v_step,
                            'kickoff_at', v_due -> 'kickoff_at',
                            'request_id', v_request_id, 'at', p_now);
END;
$fn$;

COMMENT ON FUNCTION public.cron_wake_pregame_refresh(TIMESTAMPTZ) IS
  'Migration 225 (Q109): the pregame-refresh-ping job body (every 5 minutes). When pregame_refresh_step(p_now) names a step it stamps system_flags.pregame_refresh and calls /api/cron/sync-weekly-projections (step projections) or /api/cron/league-player-values (step values) through cron_ping_route; otherwise sends nothing. Once per kickoff slot. Returns {woke, step, kickoff_at, request_id, at}. SECURITY INVOKER like cron_ping_route; EXECUTE revoked from every API role.';
REVOKE EXECUTE ON FUNCTION public.cron_wake_pregame_refresh(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. lineup_autopilot_internal — CREATE OR REPLACE against 201:1637-2273's
--    FILE TEXT (D137; definers 125 / 138 / 139 / 142 / 152 / 154 / 157 /
--    201 — 201 newest), 1 hunk (+6 / -4): the read-side bound is 30 hours.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_autopilot_internal(
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
  v_league      public.leagues;
  v_row         public.team_lineups;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_by_pid      JSONB := '{}'::jsonb;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_kick        JSONB := '{}'::jsonb;
  v_map         JSONB := '{}'::jsonb;
  v_ir_held     TEXT[] := ARRAY[]::text[];
  v_seated      TEXT[] := ARRAY[]::text[];   -- players staying where they are
  v_fixed       JSONB := '[]'::jsonb;        -- fit input: those same players
  v_free        JSONB := '[]'::jsonb;        -- fit input: HEALTHY unlocked candidates
  v_tail        JSONB := '[]'::jsonb;        -- fit input: the unhealthy tail (allow = TRUE)
  v_displace    JSONB := '{}'::jsonb;        -- slot key → vacated unhealthy starter
  v_restored    JSONB := '[]'::jsonb;
  v_locked_out  JSONB := '[]'::jsonb;        -- skipped_locked[]
  -- (v_filtered — the allow = FALSE hard filter's refusals — is gone with the setting)   -- 201 / D591
  v_fit_a       JSONB;
  v_fit_b       JSONB;
  v_players_b   JSONB := '[]'::jsonb;
  v_assign      JSONB;
  v_filled      JSONB := '[]'::jsonb;
  v_subbed      JSONB := '[]'::jsonb;
  v_unfill      JSONB := '[]'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_locked_at   TIMESTAMPTZ;
  v_pflags      JSONB;
  v_empties     INTEGER := 0;
  v_sick        INTEGER := 0;               -- unhealthy UNLOCKED seated starters
  v_e           JSONB;
  v_p           JSONB;
  v_k           RECORD;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_elig        JSONB;
  v_locked      BOOLEAN;
  v_unhealthy   BOOLEAN;
  v_changed     BOOLEAN;
  v_reason      TEXT;
  -- 225 (Q110, Chris 2026-11-17: "go with option 1"): the read-side bound   -- 225 / Q110
  -- (F387's read half / F389(c)) is 30 HOURS. Projections and values run once   -- 225 / Q110
  -- a day plus an hour before each kickoff (225), so a day-old row is the   -- 225 / Q110
  -- healthy case; 30 h = a day plus room for one late run. Pinned equal to   -- 225 / Q110
  -- AUTOPILOT_VALUE_MAX_AGE_MS (`player-values.ts`) by V9a.   -- 225 / Q110
  c_max_age     CONSTANT INTERVAL := interval '30 hours';   -- 225 / Q110
  v_tail_d      JSONB := '[]'::jsonb;        -- fit input: the DOUBTFUL tail — ahead of v_tail, under BOTH settings
  v_blocked     BOOLEAN;                     -- bye or a §7.3.6 blocking designation (Doubtful is NOT one)
  v_basis       JSONB;                       -- order_basis: what ordered this pass, and why a key was absent
  -- 142 (L.E1.25, Q68 RULED): pass 1b — a Doubtful replacement for a BLOCKED
  -- starter nobody healthy replaced.
  v_defer       JSONB := '{}'::jsonb;        -- slot key → vacated BLOCKED starter with no healthy replacement
  v_dslots      JSONB;                       -- pass 1b's slots: exactly those keys
  v_players_d   JSONB := '[]'::jsonb;        -- pass 1b's candidates: the unseated Doubtful tail
  v_fit_d       JSONB;
  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)
  -- 154 / F441 · F445: stored off-roster starters KEPT for the week, and the
  -- team (if any) that already starts a candidate this league-week.
  v_kept        TEXT[] := ARRAY[]::text[];
  v_else        JSONB;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lineup_autopilot_internal: league % not found', p_league_id USING ERRCODE = 'P0002';
  END IF;

  -- The row must EXIST. D354 puts materialization in the caller, under the
  -- league lock, through the unchanged carry — so an absent row here is a
  -- caller bug and must be loud, never a silently invented lineup.
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = p_season AND tl.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'lineup_autopilot_internal: no team_lineups row for team % season % week % — the caller materializes through lineup_carry_internal first (D354); refusing to invent one',
      p_team_id, p_season, p_week
      USING ERRCODE = 'P0002';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- §7.3.6's "Allow illegal lineups" is RETIRED (Chris 2026-10-20): the stored value is   -- 201 / D591
  -- ignored. A blocked man (bye / OUT / IR / PUP / NFI / Suspended) is always the TAIL —   -- 201 / D591
  -- seated LAST, behind every healthy and Doubtful candidate, never filtered out — and   -- 201 / D591
  -- the result's allow_illegal_lineups key stays for its readers, always TRUE.   -- 201 / D591
  v_allow := TRUE;   -- 201 / D591

  -- THE ROSTER, in 114/116's shape (positions normalised DEF → DST;
  -- designations bridged through `lineup_designation_internal`, 112:337),
  -- plus the four keys of the one sort below and an `order` object that says
  -- which key ordered each player and why an earlier key was absent.
  --
  -- Q62's SORT, AS RULED (Chris 2026-09-27; 138, L.E1.21), AND IT IS STILL
  -- THE WHOLE SELECTION POLICY. Placement is free (D340 — the matcher
  -- CHOOSES, and greedy-by-input-order over a transversal matroid is
  -- optimal), so "which players start" is this ORDER BY and nothing else:
  -- (1) THIS week's projected points, (2) season-to-date points, (3) preseason
  -- projected points — each under the league's scoring (§12.28, 137) — then
  -- (4) ADP, then player_id. POINTS, never ranks: across positions (a FLEX
  -- slot) Chris ruled "total scored points", and within a position points
  -- order exactly as positional rank does. ONE LEXICOGRAPHIC ORDER BY, PER
  -- PLAYER (the task's READING, flagged): a player with a key outranks every
  -- player without it; the later keys order only what the earlier leave NULL.
  --
  -- F389's JOIN CONTRACT. (a) A LEFT JOIN — a rostered player with no values
  -- row (acquired since the last hourly run; a league-week the job failed)
  -- stays in the pool with all three keys NULL and is NAMED in order_basis;
  -- (b) only the POINTS columns are sort keys — `*_missing` / `*_unscored`
  -- never are; (c) F387's READ HALF — a row whose `computed_at` is older than
  -- `c_max_age` at `p_at` is ABSENT (the values job has died), and a
  -- projection whose `projection_fetched_at` is older than `c_max_age` at
  -- `p_at` is ABSENT (the projections sync has died) ⇒ the next key orders.
  -- ALL FOUR JOIN PREDICATES ARE LOAD-BEARING (R1120, #316's fix round).
  -- The job writes the CURRENT and the NEXT week for every rostered player of
  -- every league, and one real player is rostered in many leagues: without
  -- `v.week = p_week` (or the season) he joins TWICE — two roster entries, and
  -- the matcher could seat one man in two slots — and without the league
  -- predicate he is ordered by ANOTHER league's scoring. pgTAP 086 gives a
  -- §C1 player a reversing row in each of those three places.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',      r.player_id,
           'name',           p.full_name,
           'position',       CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',    public.lineup_designation_internal(p.status),
           'nfl_team',       p.team,
           'adp',            p.adp,
           'ir_placed_week', r.ir_placed_week,
           'slot_key',       r.slot_key,
           'order',          jsonb_build_object(
             'ordered_by',       CASE WHEN k.projected_points IS NOT NULL THEN 'projected_points'
                                      WHEN k.season_points    IS NOT NULL THEN 'season_points'
                                      WHEN k.preseason_points IS NOT NULL THEN 'preseason_points'
                                      WHEN p.adp              IS NOT NULL THEN 'adp'
                                      ELSE 'player_id' END,
             'projected_points', k.projected_points,
             'season_points',    k.season_points,
             'preseason_points', k.preseason_points,
             'adp',              p.adp,
             'value_row',        f.value_row,
             'projected_why',    CASE WHEN k.projected_points IS NOT NULL THEN NULL
                                      WHEN f.value_row <> 'fresh' THEN f.value_row
                                      WHEN v.projected_points IS NULL THEN v.projected_missing
                                      ELSE 'stale_line_at_read' END))
           ORDER BY k.projected_points DESC NULLS LAST, k.season_points DESC NULLS LAST,
                    k.preseason_points DESC NULLS LAST, p.adp ASC NULLS LAST, r.player_id ASC), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  LEFT JOIN public.league_player_values v
    ON v.league_id = r.league_id AND v.season = p_season AND v.week = p_week AND v.player_id = r.player_id
  CROSS JOIN LATERAL (SELECT CASE WHEN v.player_id IS NULL THEN 'no_value_row'
                                  WHEN v.computed_at < p_at - c_max_age THEN 'stale_row'
                                  ELSE 'fresh' END AS value_row) f
  CROSS JOIN LATERAL (SELECT
           CASE WHEN f.value_row = 'fresh' AND v.projection_fetched_at >= p_at - c_max_age
                THEN v.projected_points END AS projected_points,
           CASE WHEN f.value_row = 'fresh' THEN v.season_points END AS season_points,
           CASE WHEN f.value_row = 'fresh' THEN v.preseason_points END AS preseason_points) k
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order WITH their eligibility (the matcher's
  -- input, `114:355-362`), and the IR spots by key.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', (s ->> 'key') || ':0', 'spot', s ->> 'key') ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- A team with no roster has nothing to seat. Reported, never raised: one
  -- empty roster must not fail a league's whole tick.
  IF jsonb_array_length(v_roster) = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'empty_roster', 'evaluated_at', p_at);
  END IF;

  -- THE PER-PLAYER LOCK DATUM, read NOW from `nfl_games` at the injected
  -- instant (E42/§23.3) — the same helper and the same rendering 114 and 116
  -- use, so arm (b) finds nothing to change next minute.
  -- 157 / F447: judged per PLAYER (set_lineup's step (6) helper) — a player
  -- the NFL released or traded after he played is locked, never OPEN.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, p_season, p_week, v_e ->> 'player_id', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- 152 / R1206 (Q32's amendment, verbatim: "if they are in the lineup they
  -- are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN AFTER HE
  -- LEAVES THE ROSTER. After a week's last game a starter who played can be
  -- dropped, claimed away or traded while the week is still current, and 152
  -- keeps his start in that week's slot_map (the week is scored from it). A
  -- stored STARTING slot whose player is off this roster and whose OWN game
  -- for p_week has kicked off is his, not OPEN: he joins v_by_pid / v_kick
  -- (never v_roster — he is nobody's candidate and on no bench), so the
  -- classification below seats him as the locked starter he is (D338) and the
  -- fit keeps him fixed at his key. One whose game has not kicked off (a bye)
  -- did not play: his slot is OPEN, as before.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',   p.id,
             'name',        p.full_name,
             'position',    CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation', public.lineup_designation_internal(p.status),
             'nfl_team',    p.team,
             'off_roster',  TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    -- 154 / F441 · F442 · F445: the ONE shared judgment (set_lineup (4b)'s and
    -- the commissioner's editor's): he played (his current team's game, this
    -- lineup's record of the slot, or a stat line for the week), or the week
    -- closed to moves before he left and he has a game this week. A KEPT
    -- starter is seated whatever his health or kickoff (the classification
    -- below) — his start is the week's record, never autopilot's to change.
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(p_season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;   -- a bye / a game gone from the week: the slot stays OPEN
    v_kept := v_kept || v_pid;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_kick := v_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- IR KEYS ARE CARRIED VERBATIM. IR occupancy is ROSTER-level state
  -- (D308/§11.2) and autopilot never moves it; its occupants are not
  -- candidates for a starting slot.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_pid := v_val #>> '{}';
      v_map := v_map || jsonb_build_object(v_key, v_pid);
      v_ir_held := v_ir_held || v_pid;
    END IF;
  END LOOP;

  -- CLASSIFY EVERY STARTING SLOT.
  --   · empty (or holding a player who has since left the roster WITHOUT
  --     having played — 152 / R1206: a played one is in v_by_pid, locked) ⇒ OPEN;
  --   · holding a LOCKED player ⇒ he stays, unconditionally (D338 — the lock
  --     binds autopilot exactly as it binds a manager);
  --   · holding a HEALTHY unlocked player ⇒ he stays (D340 — a carried or
  --     manager-set placement is NEVER overridden on value);
  --   · holding an UNLOCKED player who is on bye or carries a blocking
  --     designation ⇒ VACATED for the substitution pass, and restored below
  --     if no healthy replacement takes the key (Q63).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_stored ->> v_key;
    IF v_pid IS NULL OR NOT (v_by_pid ? v_pid) THEN
      v_empties := v_empties + 1;
      CONTINUE;
    END IF;
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    -- THE `COALESCE` AROUND THE `IN` IS LOAD-BEARING, AND IT WAS MISSING UNTIL
    -- #295's fix round CAUGHT IT WITH §J. `lineup_designation_internal`
    -- returns NULL for a healthy player (112:337 — measured: 'Active' ⇒ NULL),
    -- and `NULL IN (…)` is NULL, not FALSE. Unguarded, `v_unhealthy` was NULL
    -- for EVERY healthy seated starter, `NOT NULL` is NULL, and the `IF` fell
    -- to the ELSE: a healthy, manager-set or carried starter was DISPLACED and
    -- re-contested on value — a D340 violation — and, because such a man also
    -- re-entered the candidate pool below, `v_restored` could seat him at his
    -- old key while pass 1 had already placed him elsewhere, writing ONE PLAYER
    -- INTO TWO SLOTS. Invisible to every other cell in 073 because no other
    -- fixture ran the pass over a map with a HEALTHY SEATED STARTER in it; §J
    -- is that fixture, and it reds on the unguarded form.
    -- 138 (L.E1.21, Q62 RULED): `Doubtful` SITS — an unlocked Doubtful
    -- starter is VACATED here like a bye/OUT man, and pass 1 below either
    -- gives his key to a HEALTHY replacement or the restore clause puts him
    -- back ("yes start the doubtful"). He is NOT in the `out` starter flag
    -- further down: a Doubtful start is legal for a manager (114:596).
    v_unhealthy := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                   OR COALESCE((v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended', 'Doubtful'), FALSE);
    IF v_locked OR NOT v_unhealthy OR v_pid = ANY (v_kept) THEN   -- 154: a kept off-roster starter stays, unconditionally
      v_seated := v_seated || v_pid;
      v_fixed := v_fixed || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_displace := v_displace || jsonb_build_object(v_key, v_pid);
      v_sick := v_sick + 1;
    END IF;
  END LOOP;

  -- THE SHORT-CIRCUIT (tasks-M6A L.E1.4 item 2), BEFORE ANY FIT CALL. Nothing
  -- to fill and nobody to substitute ⇒ no matcher runs and the caller writes
  -- nothing. It lives HERE, in the one place that holds both halves of the
  -- predicate, rather than being half-duplicated in the tick where the
  -- designations and kickoffs are not in scope — the load mitigation is the
  -- predicate, not the cadence.
  IF v_empties = 0 AND v_sick = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'no_empty_slot_and_no_unhealthy_unlocked_starter', 'evaluated_at', p_at);
  END IF;

  -- THE CANDIDATE POOLS, in the roster's Q62 order.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_held);
    CONTINUE WHEN v_pid = ANY (v_seated);
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    IF v_locked THEN
      -- D338: never lifted, and never silently dropped.
      v_locked_out := v_locked_out || jsonb_build_object(
        'player_id', v_pid, 'name', v_e ->> 'name', 'position', v_e ->> 'position',
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'reason', 'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner''s exemption (D338)');
      CONTINUE;
    END IF;
    -- 154 / F441 · F445: ONE START PER PLAYER PER LEAGUE-WEEK. A candidate
    -- another team of this league already STARTS this week (a start kept
    -- after he left that team — D411 / D412(5)) is never offered: the write
    -- would be refused by name (team_lineups' trigger) and fail the league's
    -- tick. Named in skipped_locked[] (the tick reports it), never silently
    -- dropped (§4 rule 15).
    v_else := public.lineup_started_elsewhere_internal(p_league_id, p_team_id, p_season, p_week, v_pid);
    IF v_else IS NOT NULL THEN
      v_locked_out := v_locked_out || jsonb_build_object(
        'player_id', v_pid, 'name', v_e ->> 'name', 'position', v_e ->> 'position',
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'started_by', v_else ->> 'team_id',
        'reason', 'already in ' || (v_else ->> 'team_name') || '''s starting lineup for week ' || p_week
                  || ' — a player starts for at most one team per league-week (F441 / F445)');
      CONTINUE;
    END IF;
    -- Same `COALESCE` as the classification loop above, for the same reason and
    -- stated once there. Benign on this side (`IF NULL THEN` does not fire, so a
    -- healthy man landed in `v_free` anyway) and written explicitly regardless:
    -- the two loops must classify one player identically or the pools disagree.
    -- 138 (L.E1.21): the SAME unhealthy test as the classification loop
    -- (Doubtful included), split in two because the two halves take different
    -- paths. A BLOCKED man (bye / OUT / IR / PUP / NFI / Suspended) keeps
    -- 125's item-4c split exactly. A DOUBTFUL man is a PREFERENCE under BOTH
    -- settings — never the hard filter, since a Doubtful start is legal
    -- (114:596) — and his tail is offered AHEAD of the blocked tail, which is
    -- where he stood before this migration (he was healthy then): Doubtful
    -- now sits behind every healthy candidate and nothing else changed.
    v_blocked := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                 OR COALESCE((v_e ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended'), FALSE);
    v_unhealthy := v_blocked OR COALESCE((v_e ->> 'designation') = 'Doubtful', FALSE);
    IF v_unhealthy THEN
      IF NOT v_blocked THEN
        v_tail_d := v_tail_d || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSE   -- a blocked man is always the tail: the allow = FALSE hard filter is retired   -- 201 / D591
        -- A PREFERENCE, not a filter: seated LAST, never left out, because an
        -- empty slot is the zero this task exists to remove (item 4c).
        v_tail := v_tail || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      END IF;
      CONTINUE;
    END IF;
    v_free := v_free || jsonb_build_object(
      'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
  END LOOP;

  -- PASS 1 — the HEALTHY pass. Seated players are `fixed` at their own key;
  -- every vacated slot and every empty slot is contested by the healthy
  -- candidates in priority order. This is the pass that decides whether a
  -- substitution happens at all.
  v_fit_a := public.lineup_fit_internal(v_slots, v_fixed || v_free);

  -- Q63's RESTORE. A vacated unhealthy starter whose key nobody healthy took
  -- goes straight back where he was: autopilot substitutes only when a
  -- healthy, unlocked, eligible replacement ACTUALLY takes the slot, and it
  -- never turns an occupied slot into an empty one.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_displace) LOOP
    v_pid := v_val #>> '{}';
    IF (v_fit_a -> 'assignment' ->> v_key) IS NULL THEN
      -- 142 (L.E1.25, Q68 RULED 2026-09-27 — "yes, swap in the doubtful"): a
      -- vacated starter who is BLOCKED (on bye, or OUT / IR / PUP / NFI /
      -- Suspended) and whose key nobody healthy took is NOT restored yet — pass
      -- 1b below offers his key to the Doubtful tail first. A vacated DOUBTFUL
      -- starter is restored here as before: never one Doubtful for another.
      IF COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
         OR COALESCE((v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended'), FALSE) THEN
        v_defer := v_defer || jsonb_build_object(v_key, v_pid);
        CONTINUE;
      END IF;
      v_restored := v_restored || jsonb_build_object(
        'slot', v_key, 'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'reason', 'no healthy, unlocked, eligible replacement existed — left exactly as he was (Q63)');
      v_seated := v_seated || v_pid;
      v_players_b := v_players_b || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_subbed := v_subbed || jsonb_build_object(
        'slot', v_key, 'out', v_pid, 'out_name', v_by_pid -> v_pid ->> 'name',
        'in', v_fit_a -> 'assignment' ->> v_key,
        'in_name', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) ->> 'name',
        'reason', CASE WHEN COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                       THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END,
        -- 138: which Q62 key ordered the man who came IN, and why an earlier
        -- key was absent (§4 rule 15) — rides through the tick's autopiloted[].
        'order', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) -> 'order');
    END IF;
  END LOOP;

  -- PASS 1b — 142 (L.E1.25, Q68 RULED 2026-09-27: "yes, swap in the
  -- doubtful"). When no healthy, unlocked, eligible replacement exists, a
  -- DOUBTFUL one replaces a starter who is OUT / on bye. The contest is
  -- exactly the deferred BLOCKED keys (never an empty slot — pass 2 owns
  -- those, unchanged) and its candidates are the Doubtful tail in Q62 order,
  -- minus every man already staying where he is — so a restored Doubtful
  -- starter is never moved to another key (never one Doubtful for another).
  -- A locked man is never a candidate (the pool loop sent him to
  -- skipped_locked[]) and a locked starter was never vacated (D338). The
  -- Doubtful tail is a preference under BOTH `allow_illegal_lineups` values
  -- (a Doubtful start is legal, 114:596), so this runs under both — which is
  -- what restores production's (125) swap in a league that forbids illegal
  -- lineups (R1123). A deferred key no Doubtful man takes is restored exactly
  -- as Q63's clause restores it.
  IF v_defer <> '{}'::jsonb THEN
    SELECT COALESCE(jsonb_agg(t.s ORDER BY t.ord), '[]'::jsonb)
    INTO v_dslots
    FROM jsonb_array_elements(v_slots) WITH ORDINALITY AS t(s, ord)
    WHERE v_defer ? (t.s ->> 'key');
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d) LOOP
      CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_seated);
      v_players_d := v_players_d || v_e;
    END LOOP;
    v_fit_d := public.lineup_fit_internal(v_dslots, v_players_d);
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_defer) LOOP
      v_pid := v_val #>> '{}';
      IF (v_fit_d -> 'assignment' ->> v_key) IS NULL THEN
        v_restored := v_restored || jsonb_build_object(
          'slot', v_key, 'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
          'reason', 'no healthy or Doubtful, unlocked, eligible replacement existed — left exactly as he was (Q63; Q68)');
        v_seated := v_seated || v_pid;
        v_players_b := v_players_b || jsonb_build_object(
          'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
          'wanted', v_key, 'fixed', TRUE);
      ELSE
        v_d_in := v_d_in || (v_fit_d -> 'assignment' ->> v_key);
        v_players_b := v_players_b || jsonb_build_object(
          'player_id', v_fit_d -> 'assignment' ->> v_key,
          'position', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) ->> 'position',
          'wanted', v_key, 'fixed', TRUE);
        v_subbed := v_subbed || jsonb_build_object(
          'slot', v_key, 'out', v_pid, 'out_name', v_by_pid -> v_pid ->> 'name',
          'in', v_fit_d -> 'assignment' ->> v_key,
          'in_name', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) ->> 'name',
          'reason', CASE WHEN COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                         THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END,
          'why', 'no healthy, unlocked, eligible replacement existed — a Doubtful one replaces a starter who cannot play (Q68, ruled 2026-09-27)',
          'order', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) -> 'order');
      END IF;
    END LOOP;
  END IF;

  -- PASS 2 — the TAIL pass. Pass 1's whole assignment is re-seeded `fixed`
  -- (112:501-505 seeds a fixed player at his wanted key unconditionally, so
  -- pass 1's result is reproduced exactly), the restored men with it, and the
  -- remaining slots are offered to the unhealthy tail — the Doubtful men first, then   -- 201 / D591
  -- the blocked men — so a slot any unlocked eligible man could take is filled.   -- 201 / D591
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit_a -> 'assignment') LOOP
    v_players_b := v_players_b || jsonb_build_object(
      'player_id', v_val #>> '{}',
      'position', v_by_pid -> (v_val #>> '{}') ->> 'position',
      'wanted', v_key, 'fixed', TRUE);
  END LOOP;
  -- 138: the Doubtful tail FIRST, then the blocked tail (see the pool loop).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d || v_tail) LOOP
    CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_seated);
    -- 142 (Q68): a Doubtful man pass 1b seated is already fixed above.
    CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_d_in);
    v_players_b := v_players_b || v_e;
  END LOOP;
  v_fit_b := public.lineup_fit_internal(v_slots, v_players_b);
  v_assign := v_fit_b -> 'assignment';
  v_map := v_map || v_assign;

  -- WHAT WAS FILLED, AND WHAT COULD NOT BE — with the slot KEY and a REASON
  -- string, never merely a short map (§4 rule 15).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_elig := v_e -> 'eligible';
    v_pid := v_assign ->> v_key;
    IF v_pid IS NULL THEN
      v_unfill := v_unfill || jsonb_build_object('slot', v_key, 'slot_key', v_e ->> 'slot',
        'reason', CASE
          -- (the "league forbids illegal lineups" reason is retired with the setting)   -- 201 / D591
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> 'position') AND x ? 'started_by')
            THEN 'no eligible player at ' || upper(v_e ->> 'slot') || ' free to start — another team of the league already starts him this week (F441 / F445)'
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no unlocked eligible player at ' || upper(v_e ->> 'slot') || '; every candidate''s game had kicked off'
          ELSE 'no eligible player at ' || upper(v_e ->> 'slot') || ' on the roster' END);
    ELSIF (v_stored ->> v_key) IS DISTINCT FROM v_pid AND NOT (v_displace ? v_key) THEN
      v_filled := v_filled || jsonb_build_object('slot', v_key, 'player_id', v_pid,
        'name', v_by_pid -> v_pid ->> 'name', 'position', v_by_pid -> v_pid ->> 'position',
        'order', v_by_pid -> v_pid -> 'order');
    END IF;
  END LOOP;

  -- STARTERS + flags + `locked_at`, 114 (10)'s shape byte-for-byte
  -- (`114:618-624` / `116:528-533`). `bench` = roster − starters − IR.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_map ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
    ELSE
      v_p := v_by_pid -> v_pid;
      v_started := v_started || v_pid;
      IF COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE) THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
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
    AND NOT ((e ->> 'player_id') = ANY (v_ir_held));

  -- THE NO-OP, BY VALUE. jsonb equality over the map — the same test
  -- `set_lineup` uses (`114:633`); the other three columns are projections of
  -- it, and arm (b) owns the kickoff refresh of an unchanged row.
  v_changed := (v_map IS DISTINCT FROM v_stored);
  v_reason := CASE
    WHEN v_changed THEN NULL
    WHEN jsonb_array_length(v_unfill) > 0 THEN 'nothing_fillable'
    ELSE 'no_change' END;

  -- 138 (L.E1.21): WHAT ORDERED THIS PASS, AND WHY A KEY WAS ABSENT (§4 rule
  -- 15; F389(a)). Over this pass's CANDIDATES: how many players each Q62 key
  -- ordered, every candidate with NO values row and every candidate whose row
  -- was STALE at `p_at` by name, and — when no candidate had any points key at
  -- all — that the pass FELL BACK TO ADP and the measured reason, never a
  -- quiet ADP order that looks like a projection order.
  -- THE CANDIDATES, NOT THE ROSTER (R1125, #316's fix round): only the men the
  -- pass actually OFFERED to the matcher un-fixed — `v_free`, `v_tail_d`,
  -- `v_tail`. An IR-held man, a seated (fixed) starter and a locked man are   -- 201 / D591
  -- never ordered by this pass, so they   -- 201 / D591
  -- are never counted: one valued IR man must not report "ordered by
  -- projection" for a pass whose every real candidate was ordered by ADP. A
  -- pass with NO candidate (an empty slot and nobody left to offer) says
  -- `candidates = 0` and did not fall back — nothing was ordered.
  SELECT jsonb_build_object(
           'candidates',        count(*),
           'by_key',            jsonb_build_object(
             'projected_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'projected_points'),
             'season_points',    count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'season_points'),
             'preseason_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'preseason_points'),
             'adp',              count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'adp'),
             'player_id',        count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'player_id')),
           'no_value_row',      COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row'), '[]'::jsonb),
           'stale_value_row',   COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row'), '[]'::jsonb),
           'max_age',           c_max_age::text,
           'fell_back_to_adp',  count(*) > 0 AND count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                                  IN ('projected_points', 'season_points', 'preseason_points')) = 0,
           'fallback_why',      CASE
             WHEN count(*) = 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                    IN ('projected_points', 'season_points', 'preseason_points')) > 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row') = count(*)
               THEN 'no_value_rows: league_player_values holds no row for any of this pass''s candidates for this league-week — the league-player-values job has not valued them; every candidate was ordered by ADP, then player_id (Q62 key 4)'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row') = count(*)
               THEN 'all_value_rows_stale: every one of this pass''s candidates'' league_player_values rows for this league-week was computed more than ' || c_max_age::text || ' before the tick instant — the job has stopped landing, so the rows were treated as absent (F387) and every candidate was ordered by ADP, then player_id'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'fresh') = 0
               THEN 'no_fresh_value_row: every candidate''s values row was absent or stale at the tick instant; every candidate was ordered by ADP, then player_id'
             ELSE 'no_points_in_any_value_row: fresh values rows exist but none carries a usable projected, season-to-date or preseason value (see each player''s order.projected_why); every candidate was ordered by ADP, then player_id' END)
  INTO v_basis
  FROM jsonb_array_elements(v_roster) e
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_free || v_tail_d || v_tail) c
                WHERE c ->> 'player_id' = e ->> 'player_id')
    -- 139 (L.E1.22, F392 / R1126): a vacated-then-RESTORED starter is back in
    -- `v_seated` and pass 2 skips him as seated, so the pass never ORDERED him —
    -- he is not a candidate, and counting him let one valued restored man
    -- report "ordered by projection" for a pass whose every real candidate
    -- was ordered by ADP (spec §7.2.1(c): "counted over the pass's candidates
    -- only").
    AND NOT ((e ->> 'player_id') = ANY (v_seated));

  RETURN jsonb_build_object(
    'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
    'source', 'autopilot',
    'slot_map', v_map, 'starters', v_starters, 'bench', v_bench, 'locked_at', v_locked_at,
    'filled', v_filled, 'substituted', v_subbed, 'unfillable', v_unfill,
    'skipped_locked', v_locked_out, 'restored', v_restored,
    'allow_illegal_lineups', v_allow,
    'order_basis', v_basis,
    'changed', v_changed, 'reason', v_reason, 'evaluated_at', p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ) IS
  '§7.2.1(c) autopilot (125, L.E1.4 — D337/D338/D339/D340/D354; 138, L.E1.21 — Q62/Q63 RULED, D375; 201, D591; 225, Q110). PURE: reads the roster, the slots, the designations, the per-player kickoffs and the league-scored values (137) at p_at and RETURNS the 114-shaped row it would write (slot_map/starters/bench/locked_at) plus filled[]/substituted[] (each with its `order`)/unfillable[]/skipped_locked[]/restored[]/order_basis/changed/reason. Writes nothing — lineup_lock_tick arm (c) is the writer. Places exclusively through lineup_fit_internal (D340); candidate order is ONE lexicographic clause (Q62: this week''s projected points DESC, season-to-date points DESC, preseason points DESC — each NULLS LAST, a values row or projection older than 30h at p_at treated as absent (F387/F389; 225 / Q110 — was 6h) — then adp ASC NULLS LAST, player_id ASC); never lifts the per-player kickoff lock (D338); substitutes only an unlocked bye/blocked/Doubtful starter and only when a HEALTHY replacement takes the key, else restores him (Q63; "yes start the doubtful"); Doubtful is a preference, never the out flag; a blocked man (bye / OUT / IR / PUP / NFI / Suspended) is always seated LAST, behind every healthy and Doubtful candidate, and never filtered out — the allow_illegal_lineups setting is retired (201, Chris 2026-10-20).';

-- ---------------------------------------------------------------------------
-- 4. 183's job-knob list — `ingest-player-news-ping` and
--    `pregame-refresh-ping` named (no knobs, Q98)
-- ---------------------------------------------------------------------------
-- 224's body verbatim (HEAD of the chain — 183 / 224 the only definers) with
-- two names added, so an operator asking for knobs on either is refused BY
-- NAME like its siblings, not as an "unknown job".
CREATE OR REPLACE FUNCTION public.op_job_check_internal(p_job TEXT, p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_job IN ('waivers', 'week-advance', 'week-finalize') THEN
    RETURN;
  END IF;
  IF p_job = 'lineup-lock' THEN
    IF p_kind = 'run' THEN RETURN; END IF;
    RAISE EXCEPTION 'lineup locking can never be paused or resumed — pausing would let people move players after kickoff (Q98); it has "run now" only'
      USING ERRCODE = '22023';
  END IF;
  IF p_job IN ('draft-tick', 'mock-expiry', 'trade-tick', 'sync-live-ping', 'score-week-ping', 'sync-live-sweep',
               'scoring-stall-check', 'sync-weekly-projections-ping', 'league-player-values-ping',
               'ingest-player-news-ping', 'pregame-refresh-ping') THEN
    RAISE EXCEPTION 'job "%" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)', p_job
      USING ERRCODE = '22023';
  END IF;
  RAISE EXCEPTION 'unknown job "%" — the operator knobs cover waivers, week-advance, week-finalize (and run-now for lineup-lock)', p_job
    USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.op_job_check_internal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The jobs — unschedule-first (124 / 224), idempotent
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  -- Chris 2026-11-17: "yes move those to once a day too".
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-player-news-ping') THEN
    PERFORM cron.unschedule('ingest-player-news-ping');
  END IF;
  PERFORM cron.schedule('ingest-player-news-ping', '30 13 * * *',
    'SELECT public.cron_ping_route(''/api/cron/ingest-player-news'')');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-weekly-projections-ping') THEN
    PERFORM cron.unschedule('sync-weekly-projections-ping');
  END IF;
  PERFORM cron.schedule('sync-weekly-projections-ping', '40 12 * * *',
    'SELECT public.cron_ping_route(''/api/cron/sync-weekly-projections'')');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'league-player-values-ping') THEN
    PERFORM cron.unschedule('league-player-values-ping');
  END IF;
  PERFORM cron.schedule('league-player-values-ping', '50 12 * * *',
    'SELECT public.cron_ping_route(''/api/cron/league-player-values'')');

  -- Q109: "do the hour before each kickoff one".
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pregame-refresh-ping') THEN
    PERFORM cron.unschedule('pregame-refresh-ping');
  END IF;
  PERFORM cron.schedule('pregame-refresh-ping', '*/5 * * * *',
    'SELECT public.cron_wake_pregame_refresh()');
END;
$do$;
