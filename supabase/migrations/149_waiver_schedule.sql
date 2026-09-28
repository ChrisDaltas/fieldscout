-- ============================================================================
-- 149_waiver_schedule.sql — the waiver schedule (F229 / Q70 as ruled) and the
-- changes it forces on add / drop; `bench_lock` retired (Q73)
-- (M5 task L.D2.7, FULL rigour — who may add a player, and when).
-- Spec §7.3.4 / §13.1 / §13.2 / §14 / §16.4 / E33–E34 (v2.16.59, this PR's
-- fold-back); tasks-M5-transactions.md §6 L.D2.7, TD6 / TD14, §4 rules;
-- PROGRESS Q70 / Q73 / Q74 / Q78 (ruled 2026-09-27, "approve M5, all
-- recommendations"), F229 / F239 / F240, D388.
--
-- Numbering: RESERVED by the orchestrator (149 / pgTAP 097) and confirmed by
-- `ls supabase/migrations | tail -1` → 148_trades_core.sql. NOT held: reaches
-- production by `npx supabase db push` only (push debt becomes 135–149).
--
-- THE RULING (Q70, in league terms)
--   A league sets WHEN WAIVERS RUN — one or more weekdays at one local time,
--   in its own IANA zone — and WHEN INSTANT-PICKUP FREE AGENCY IS OPEN: from
--   the waiver run, or from a weekday + time, until the week's last game ends
--   (or never). Outside free agency every unowned player is claim-only until
--   the next run. A dropped player is on waivers until the next run. After
--   the draft every undrafted player is on waivers until the first run after
--   it. When the week ends everyone goes back to claim-only until the next
--   run. Chris's two leagues are presets (TS: `WAIVER_PRESETS`). Q73: a claim
--   whose drop already played always fails — `bench_lock` is retired. Q74:
--   a kicked-off player is refused as LOCKED (the add path checks the lock
--   before the waiver state). Q78: runs are wall-clock scheduled, and a run
--   AT the week's close counts.
--
-- WHAT THIS MIGRATION DOES
--   1. Every `leagues.settings` blob is mapped onto the six new keys
--      (`waiver_schedule_from_legacy_internal`) — the old run day and time
--      KEPT, in America/New_York (D60's "ET"), free agency after the run
--      (both old `free_agency` values behaved alike under M4's Q33 interim) —
--      and the four retired keys + `bench_lock` are stripped. Counted and
--      said as NOTICEs. Then `leagues_settings_no_retired_waiver_keys`
--      refuses them for good (115's `player_game_lock` precedent: the JSONB
--      analogue of DROP COLUMN).
--   2. `leagues.waiver_next_run_at` — the next UNPROCESSED scheduled run.
--      NULL = the processor does not track the league yet (it is L.D2.9's to
--      seed and advance — F423); while NULL the schedule itself is the
--      record. Once set, a run counts only after it has been SETTLED, so no
--      instant add can beat the claims a due run is settling (E8).
--   3. The schedule functions — `waiver_schedule_internal` (parse + validate
--      by name), `waiver_next_run_internal` / `waiver_last_run_internal` /
--      `waiver_last_open_internal` (wall-clock arithmetic through
--      PostgreSQL's own `AT TIME ZONE` — the TS twin `zoned-time.ts`
--      reproduces its DST rule: a wall time that does not exist reads with
--      the offset before the jump, one that happens twice reads as the
--      LATER instant) and `waiver_window_internal` (the free-agency window at
--      an instant; the TS twin is `waiver-schedule.ts` `freeAgencyWindow`).
--   4. D137 replacements, each against the NEWEST definer's FILE TEXT,
--      derived by an exact-match script (every substitution asserted to hit
--      exactly as often as expected; hunks measured with difflib):
--        roster_add_drop_internal         115:338-823   md5 eb766be8… →  9 hunks
--        commish_roster_override_internal 131:1328-2298 md5 264b6b48… →  5 hunks
--        commish_setting_policy           129:300-353   md5 3778a695… →  2 hunks
--        commish_setting_canon_internal   129:440-629   md5 2446bce7… →  4 hunks
--        commish_change_setting_internal  144:552-1111  md5 1790b1a1… →  3 hunks
--      roster_add_drop_internal: the schedule replaces waiver_period_hours /
--      free_agency; a drop goes on waivers until the NEXT run; the add path
--      refuses (a) a player whose waiver hold is running (or whose run is due
--      but unsettled) and (b) any unowned player outside the free-agency
--      window, BY NAME, naming the next run in the league's zone — both AFTER
--      the game-day lock (Q74); F240's refusal text fixed in both lock arms;
--      the result carries the window and the schedule. commish_roster_
--      override_internal: the commissioner walks past both (TD5), NAMED as
--      `waiver_period:<player>` in `bypassed`, and a force-drop waits for the
--      next run too (without this it would have silently read the retired
--      key's 48-hour default). The setting verb: the six keys are FREE blob
--      keys with value gates; the five retired keys refuse BY NAME; a change
--      to when waivers run moves a TRACKED pending run to the new schedule.
--
-- WHAT DOES NOT CHANGE: the game-day lock (E32 — both sides, release at the
-- week's last game, never weakened), exclusivity, capacity, caps, the lineup
-- interplay, the transactions row, replay, `fa_hold_hours` (an early drop of a
-- free-agent add still returns him to free agency — where the window decides
-- whether he is an instant pickup), `none_fcfs` (always free agency; drops go
-- straight to it). The claim verbs (145) are untouched: Q74(i) at submit is
-- F407 (L.D2.9).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): one blob rewrite of `leagues` (every
-- row, counted), one CHECK, one nullable column + one partial index, six new
-- functions (all triple-REVOKEd), five replaced (REVOKEs restated). RLS
-- unchanged (leagues keeps its policies; the new column rides them — when the
-- next run is due is not a secret). No new table. Realtime: none (the league
-- broadcast payload is column-selected). Waivers: R6 — no staging clone; the
-- fresh local `db reset` 001–149 is the rehearsal. D38 — the constraint is
-- added AFTER the rewrite in the same transaction, so no existing row can
-- violate it. Typegen: the new column and functions appear in
-- `Database['public']`; the alias block re-appended (additive diff).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE BLOB MAPPING — old keys onto the schedule, then refused for good
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_schedule_from_legacy_internal(p_settings JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- A key already in the new vocabulary wins; an old key is carried over when
  -- it is valid; anything else takes the §7.3.4 catalog default. The five
  -- retired keys are stripped. NULL in, NULL out (a NULL blob is not ours to
  -- invent).
  SELECT CASE WHEN p_settings IS NULL THEN NULL ELSE
    (p_settings - ARRAY['waiver_process_day', 'waiver_process_time', 'waiver_period_hours', 'free_agency', 'bench_lock'])
    || jsonb_build_object(
         'waiver_run_days', COALESCE(p_settings -> 'waiver_run_days',
            jsonb_build_array(CASE WHEN p_settings ->> 'waiver_process_day' IN ('tue', 'wed', 'thu')
                                   THEN p_settings ->> 'waiver_process_day' ELSE 'wed' END)),
         'waiver_run_time', COALESCE(p_settings -> 'waiver_run_time',
            to_jsonb(CASE WHEN p_settings ->> 'waiver_process_time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                          THEN p_settings ->> 'waiver_process_time' ELSE '03:00' END)),
         'waiver_time_zone',      COALESCE(p_settings -> 'waiver_time_zone', to_jsonb('America/New_York'::text)),
         'free_agency_opens',     COALESCE(p_settings -> 'free_agency_opens', to_jsonb('after_waiver_run'::text)),
         'free_agency_open_day',  COALESCE(p_settings -> 'free_agency_open_day', to_jsonb('sun'::text)),
         'free_agency_open_time', COALESCE(p_settings -> 'free_agency_open_time', to_jsonb('06:00'::text)))
  END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_schedule_from_legacy_internal(JSONB) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_total INTEGER;
  v_old   INTEGER;
  v_bench INTEGER;
  v_n     INTEGER;
BEGIN
  SELECT count(*)::int,
         count(*) FILTER (WHERE settings ?| ARRAY['waiver_process_day', 'waiver_process_time', 'waiver_period_hours', 'free_agency'])::int,
         count(*) FILTER (WHERE settings ? 'bench_lock')::int
  INTO v_total, v_old, v_bench
  FROM leagues;
  UPDATE leagues
  SET settings = public.waiver_schedule_from_legacy_internal(settings)
  WHERE settings IS DISTINCT FROM public.waiver_schedule_from_legacy_internal(settings);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '149: % league row(s); % carried a retired schedule key, % carried bench_lock; % rewritten onto the waiver schedule (every row now names its schedule explicitly — a row already in the new vocabulary is left alone)',
    v_total, v_old, v_bench, v_n;
END $$;

ALTER TABLE leagues
  ADD CONSTRAINT leagues_settings_no_retired_waiver_keys
  CHECK (NOT (settings ?| ARRAY['waiver_process_day', 'waiver_process_time', 'waiver_period_hours', 'free_agency', 'bench_lock']));

COMMENT ON CONSTRAINT leagues_settings_no_retired_waiver_keys ON leagues IS
  '149 / L.D2.7: waiver_process_day, waiver_process_time, waiver_period_hours and free_agency are RETIRED by the waiver schedule (Q70 — waiver_run_days / waiver_run_time / waiver_time_zone / free_agency_opens / free_agency_open_day / free_agency_open_time), and bench_lock by Q73 (a claim whose drop already played always fails); none of them can be stored.';

-- ---------------------------------------------------------------------------
-- 2. leagues.waiver_next_run_at — the next UNPROCESSED run (NULL = untracked)
-- ---------------------------------------------------------------------------
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS waiver_next_run_at TIMESTAMPTZ;

COMMENT ON COLUMN leagues.waiver_next_run_at IS
  '149 / L.D2.7 (TD6): the next scheduled waiver run the processor has NOT yet settled. NULL = the processor does not track this league yet (L.D2.9 seeds and advances it); while NULL the schedule itself is the record. Once set, a run counts toward the free-agency window only after it has been settled (waiver_window_internal), so no instant add beats the claims a due run is settling (E8). Moved by commish_change_setting when the schedule changes.';

CREATE INDEX IF NOT EXISTS idx_leagues_waiver_next_run_at
  ON leagues (waiver_next_run_at)
  WHERE waiver_next_run_at IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. THE SCHEDULE — parsed by name, and its wall-clock arithmetic
-- ---------------------------------------------------------------------------
-- waiver_schedule_internal(settings, waiver_type) → the schedule document:
--   {waivers, run_days[], run_dows[], run_time, time_zone, free_agency_opens,
--    free_agency_open_day, open_dow, free_agency_open_time}
-- Absent keys take the §7.3.4 catalog defaults (a pre-149 fixture blob); a
-- malformed value is refused BY NAME (22023) — never a silent default.
CREATE OR REPLACE FUNCTION waiver_schedule_internal(p_settings JSONB, p_waiver_type TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  c_days CONSTANT TEXT[] := ARRAY['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  v_s        JSONB := COALESCE(p_settings, '{}'::jsonb);
  v_days_j   JSONB := COALESCE(v_s -> 'waiver_run_days', '["wed"]'::jsonb);
  v_days     TEXT[];
  v_time     TEXT := COALESCE(v_s ->> 'waiver_run_time', '03:00');
  v_zone     TEXT := COALESCE(v_s ->> 'waiver_time_zone', 'America/New_York');
  v_opens    TEXT := COALESCE(v_s ->> 'free_agency_opens', 'after_waiver_run');
  v_open_day TEXT := COALESCE(v_s ->> 'free_agency_open_day', 'sun');
  v_open_t   TEXT := COALESCE(v_s ->> 'free_agency_open_time', '06:00');
BEGIN
  IF jsonb_typeof(v_days_j) <> 'array' OR jsonb_array_length(v_days_j) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_days_j) x
                WHERE jsonb_typeof(x) <> 'string' OR NOT ((x #>> '{}') = ANY (c_days))) THEN
    RAISE EXCEPTION 'waiver schedule: waiver_run_days must be a non-empty list of sun, mon, tue, wed, thu, fri, sat — the league stores % (§7.3.4)', v_days_j::text
      USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT d ORDER BY d) INTO v_days
  FROM (SELECT x #>> '{}' AS d FROM jsonb_array_elements(v_days_j) x) s;
  v_days := ARRAY(SELECT d FROM unnest(c_days) WITH ORDINALITY AS c(d, i) WHERE d = ANY (v_days) ORDER BY i);
  IF v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'waiver schedule: waiver_run_time must be HH:MM (24h) — the league stores % (§7.3.4)', v_time
      USING ERRCODE = '22023';
  END IF;
  IF v_open_t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'waiver schedule: free_agency_open_time must be HH:MM (24h) — the league stores % (§7.3.4)', v_open_t
      USING ERRCODE = '22023';
  END IF;
  IF v_opens NOT IN ('after_waiver_run', 'day_and_time', 'never') THEN
    RAISE EXCEPTION 'waiver schedule: free_agency_opens must be after_waiver_run, day_and_time or never — the league stores % (§7.3.4)', v_opens
      USING ERRCODE = '22023';
  END IF;
  IF NOT (v_open_day = ANY (c_days)) THEN
    RAISE EXCEPTION 'waiver schedule: free_agency_open_day must be one of sun … sat — the league stores % (§7.3.4)', v_open_day
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    PERFORM ('2026-01-01 00:00'::timestamp AT TIME ZONE v_zone);
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'waiver schedule: waiver_time_zone % is not a time zone the database knows (an IANA name such as America/Los_Angeles, §16.4)', v_zone
      USING ERRCODE = '22023';
  END;
  RETURN jsonb_build_object(
    'waivers',               COALESCE(p_waiver_type, 'faab') <> 'none_fcfs',
    'run_days',              to_jsonb(v_days),
    'run_dows',              (SELECT jsonb_agg(array_position(c_days, d) - 1 ORDER BY array_position(c_days, d)) FROM unnest(v_days) d),
    'run_time',              v_time,
    'time_zone',             v_zone,
    'free_agency_opens',     v_opens,
    'free_agency_open_day',  v_open_day,
    'open_dow',              array_position(c_days, v_open_day) - 1,
    'free_agency_open_time', v_open_t);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_schedule_internal(JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- The first scheduled run STRICTLY AFTER p_after. Local calendar dates from the
-- day before p_after's local date to eight days after it (every weekday twice
-- over); `(date + time) AT TIME ZONE zone` is PostgreSQL's own DST rule.
CREATE OR REPLACE FUNCTION waiver_next_run_internal(p_sched JSONB, p_after TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT min(t)
  FROM (
    SELECT ((b.d + k) + (p_sched ->> 'run_time')::time) AT TIME ZONE (p_sched ->> 'time_zone') AS t
    FROM (SELECT (p_after AT TIME ZONE (p_sched ->> 'time_zone'))::date AS d) b
    CROSS JOIN generate_series(-1, 8) AS k
    WHERE extract(dow FROM (b.d + k))::int IN (SELECT (x #>> '{}')::int FROM jsonb_array_elements(p_sched -> 'run_dows') x)
  ) c
  WHERE c.t > p_after;
$$;
REVOKE EXECUTE ON FUNCTION waiver_next_run_internal(JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- The latest scheduled run AT OR BEFORE p_at.
CREATE OR REPLACE FUNCTION waiver_last_run_internal(p_sched JSONB, p_at TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT max(t)
  FROM (
    SELECT ((b.d + k) + (p_sched ->> 'run_time')::time) AT TIME ZONE (p_sched ->> 'time_zone') AS t
    FROM (SELECT (p_at AT TIME ZONE (p_sched ->> 'time_zone'))::date AS d) b
    CROSS JOIN generate_series(-8, 1) AS k
    WHERE extract(dow FROM (b.d + k))::int IN (SELECT (x #>> '{}')::int FROM jsonb_array_elements(p_sched -> 'run_dows') x)
  ) c
  WHERE c.t <= p_at;
$$;
REVOKE EXECUTE ON FUNCTION waiver_last_run_internal(JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- The latest weekly free-agency opening (day_and_time) AT OR BEFORE p_at.
CREATE OR REPLACE FUNCTION waiver_last_open_internal(p_sched JSONB, p_at TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT max(t)
  FROM (
    SELECT ((b.d + k) + (p_sched ->> 'free_agency_open_time')::time) AT TIME ZONE (p_sched ->> 'time_zone') AS t
    FROM (SELECT (p_at AT TIME ZONE (p_sched ->> 'time_zone'))::date AS d) b
    CROSS JOIN generate_series(-8, 1) AS k
    WHERE extract(dow FROM (b.d + k))::int = (p_sched ->> 'open_dow')::int
  ) c
  WHERE c.t <= p_at;
$$;
REVOKE EXECUTE ON FUNCTION waiver_last_open_internal(JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. waiver_window_internal(league row, at) — IS FREE AGENCY OPEN?
--    reset = the latest of the league's draft completing and the end of any
--    NFL week of its season (`nfl_weeks.last_game_ends_at`), not after `at`.
--    A run counts when scheduled ≤ at — and, once tracked, strictly before
--    the pending (unsettled) run. after_waiver_run: open ⇔ a counted run ≥
--    reset. day_and_time: that AND the weekly opening > reset. never: never.
--    none_fcfs: always. `why` is the TS twin's vocabulary exactly.
--    The caller holds the league row lock (the add path locks it first); this
--    reads, never writes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_window_internal(p_league public.leagues, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_sched      JSONB;
  v_draft_at   TIMESTAMPTZ;
  v_week_end   TIMESTAMPTZ;
  v_reset      TIMESTAMPTZ;
  v_reset_kind TEXT;
  v_sched_last TIMESTAMPTZ;
  v_counted    TIMESTAMPTZ;
  v_next       TIMESTAMPTZ;
  v_last_open  TIMESTAMPTZ;
  v_run_since  BOOLEAN;
  v_run_why    TEXT;
  v_open       BOOLEAN;
  v_why        TEXT;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'waiver_window_internal: p_at is required (the TimeProvider seam — no clock is read here)'
      USING ERRCODE = '22023';
  END IF;
  v_sched := public.waiver_schedule_internal(p_league.settings, p_league.waiver_type);
  IF NOT (v_sched ->> 'waivers')::boolean THEN
    RETURN jsonb_build_object(
      'waivers', FALSE, 'free_agency_open', TRUE, 'why', 'no_waivers',
      'free_agency_opens', v_sched ->> 'free_agency_opens', 'time_zone', v_sched ->> 'time_zone',
      'reset_at', NULL, 'reset_kind', NULL, 'last_run_at', NULL, 'scheduled_last_run_at', NULL,
      'last_open_at', NULL, 'next_run_at', NULL, 'pending_run_at', p_league.waiver_next_run_at,
      'evaluated_at', p_at);
  END IF;

  SELECT max(d.completed_at) INTO v_draft_at
  FROM public.drafts d
  WHERE d.league_id = p_league.id AND NOT d.is_mock AND d.status = 'complete' AND d.completed_at <= p_at;
  SELECT max(w.last_game_ends_at) INTO v_week_end
  FROM public.nfl_weeks w
  WHERE w.season = p_league.season AND w.last_game_ends_at <= p_at;
  v_reset := GREATEST(v_draft_at, v_week_end);           -- GREATEST ignores NULLs
  v_reset_kind := CASE WHEN v_reset IS NULL THEN 'none'
                       WHEN v_reset = v_week_end THEN 'week_end'
                       ELSE 'draft' END;

  v_sched_last := public.waiver_last_run_internal(v_sched, p_at);
  IF p_league.waiver_next_run_at IS NOT NULL AND v_sched_last >= p_league.waiver_next_run_at THEN
    v_counted := public.waiver_last_run_internal(v_sched, p_league.waiver_next_run_at - interval '1 microsecond');
  ELSE
    v_counted := v_sched_last;
  END IF;
  v_next := public.waiver_next_run_internal(v_sched, p_at);
  v_run_since := v_reset IS NULL OR v_counted >= v_reset;          -- a run AT the reset counts (Q78)
  v_run_why := CASE WHEN v_reset IS NULL OR v_sched_last >= v_reset THEN 'run_pending' ELSE 'awaiting_run' END;

  IF v_sched ->> 'free_agency_opens' = 'never' THEN
    v_open := FALSE;
    v_why  := 'claims_only';
  ELSIF v_sched ->> 'free_agency_opens' = 'after_waiver_run' THEN
    v_open := v_run_since;
    v_why  := CASE WHEN v_open THEN 'open' ELSE v_run_why END;
  ELSE
    v_last_open := public.waiver_last_open_internal(v_sched, p_at);
    v_open := v_run_since AND (v_reset IS NULL OR v_last_open > v_reset);  -- an opening AT the reset opens nothing
    v_why  := CASE WHEN v_open THEN 'open' WHEN NOT v_run_since THEN v_run_why ELSE 'before_opening_time' END;
  END IF;

  RETURN jsonb_build_object(
    'waivers',               TRUE,
    'free_agency_open',      v_open,
    'why',                   v_why,
    'free_agency_opens',     v_sched ->> 'free_agency_opens',
    'time_zone',             v_sched ->> 'time_zone',
    'reset_at',              v_reset,
    'reset_kind',            v_reset_kind,
    'last_run_at',           v_counted,
    'scheduled_last_run_at', v_sched_last,
    'last_open_at',          v_last_open,
    'next_run_at',           v_next,
    'pending_run_at',        p_league.waiver_next_run_at,
    'evaluated_at',          p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_window_internal(public.leagues, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. roster_add_drop_internal — CREATE OR REPLACE against 115:338-823's FILE
--    TEXT (D137), 9 hunks (banner §4). The public verb roster_add_drop (113)
--    is untouched and still calls this seam.
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
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'roster_add_drop: team % is retired — a sealed franchise makes no moves (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: league % has no league_weeks rows — no season calendar to evaluate locks and caps against (§12.17)',
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
    v_drop_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_drop_p.team, p_at);
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
    v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at);
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
          WHEN 'run_pending' THEN 'the waiver run at ' || (v_fa_window ->> 'scheduled_last_run_at') || ' is still being processed'
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
  -- row of this team from the current week on.
  FOR v_row IN
    SELECT tl.* FROM public.team_lineups tl
    WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week >= v_current
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
        -- player has not played and there is nothing to keep: the entry is
        -- ALWAYS cleared (the slot reads empty; 112 lets a player whose own
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
REVOKE EXECUTE ON FUNCTION roster_add_drop_internal(UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. commish_roster_override_internal — CREATE OR REPLACE against
--    131:1328-2298's FILE TEXT (D137), 5 hunks: the schedule replaces the
--    retired waiver_period_hours; a force-drop waits for the next run; the
--    free-agency window (and a due-but-unsettled hold) is walked past and
--    NAMED `waiver_period:<player>` (TD5 — a timing rule; standing rule (i)).
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
  -- A `retired` franchise is SEALED (spec:183 — "name/record frozen";
  -- §7.2.1). Under standing rule (i) this is a LEGALITY gate, not a timing
  -- one: a sealed franchise is not a place a roster move can land. F352.
  --
  -- R1020 — THE MESSAGE NAMES A DOOR THAT EXISTS, OR IT SAYS THAT NONE DOES.
  -- The first cut said *"Un-retire the franchise first"*. Measured by
  -- exhausting every `UPDATE … teams` in migrations 001-127 (eleven of them,
  -- `grep -n 'UPDATE public\.teams'`): the column's CHECK is
  -- `('active','orphaned','retired')`; **four statements across two functions
  -- write `'active'` and all four are guarded by the same
  -- `CASE WHEN status = 'orphaned' THEN 'active' ELSE status END`** — `seat_league_member_internal` (`062:282-285`, newest
  -- body `077:442-445`) and `remove_manager`'s successor arm (`063:903-906`,
  -- newest body `120:454-457`). **NOT ONE SITE READS `'retired'` AND WRITES
  -- ANYTHING ELSE.** So an ORPHANED franchise can be re-activated by a new
  -- owner claiming the seat, and a RETIRED one cannot be un-retired by any
  -- verb that exists — the remedy the first message named was a route to
  -- nowhere, which is the F351 posture ("route it, don't leave it") failing in
  -- its worst direction. The message now says the capability is missing rather
  -- than implying it exists, and offers the route that DOES exist. **F354**
  -- owns the gap; building the verb is not this task's scope.
  IF v_team_a.status = 'retired'
     OR (v_is_move AND v_team_b.status = 'retired') THEN
    RAISE EXCEPTION
      '%: a retired franchise is sealed — its roster and record are frozen (§7.2.1, spec:183). This is a legality gate and it binds the commissioner too (PROGRESS standing rule (i), F352). The franchise would have to be un-retired first, and NO VERB DOES THAT TODAY — every site that writes teams.status = active is guarded "WHEN status = orphaned", so nothing un-retires a franchise (F354). Until one exists, move these players to another franchise instead', p_verb
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      '%: league % has no league_weeks rows — no season calendar to place the move on (§12.17)', p_verb, p_league_id
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
      '%: league % has no league_weeks row for season % week % — the calendar moved under this transaction (§12.17)', p_verb, p_league_id, v_league.season, v_current
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
        '%: % (%) is on no roster in league % — a move needs a source roster; to bring a free agent in, use commish_force_add_drop (§15.4:1695)',
        p_verb, v_lose_p.full_name, p_player_id, p_league_id
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
            '%: % (%) is on %''s roster, not %''s — name the roster he is actually on, or move him with commish_move_player (§15.4:1694)',
            p_verb, v_lose_p.full_name, p_drop, v_owner_team.name, v_team_a.name
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
          '%: % (%) is already on %''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7), and that binds a commissioner too: it is the shape of the game, not its timing (PROGRESS standing rule (i)). To take him off % and put him on %, use commish_move_player (§15.4:1694)',
          p_verb, v_gain_p.full_name, p_add, v_owner_team.name, v_owner_team.name, v_team_a.name
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
      v_lose_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_lose_p.team, p_at);
      IF (v_lose_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_drop_lock:' || v_lose_player)::text);
      END IF;
    END IF;
    IF v_gain_player IS NOT NULL AND NOT v_is_move THEN
      v_gain_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_gain_p.team, p_at);
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
          '%: %''s roster is full (% of % — §7.3.2 roster_size) — free a spot with commish_force_add_drop first. A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
          p_verb, v_team_b.name, v_count_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_exp_a > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster is full (% of % — §7.3.2 roster_size) — include a drop in the same move (§13.1). A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
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
    --      signal with it (D346). Every week from the current one on, for both
    --      sides of a move.
    v_sync := public.commish_roster_lineup_sync_internal(
      p_league_id, v_team_a.id, v_league.season, v_current, v_current,
      CASE WHEN v_lose_team = v_team_a.id THEN v_lose_player END,
      CASE WHEN v_gain_team = v_team_a.id THEN v_gain_player END,
      v_ir_keys);
    v_lineups := v_lineups || jsonb_build_object('team_id', v_team_a.id, 'rows', v_sync -> 'rows');
    v_vacated := v_sync ->> 'vacated_current_slot';
    IF v_is_move THEN
      v_sync := public.commish_roster_lineup_sync_internal(
        p_league_id, v_team_b.id, v_league.season, v_current, v_current,
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
      NULL);
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
REVOKE EXECUTE ON FUNCTION commish_roster_override_internal(UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. commish_setting_policy — CREATE OR REPLACE against 129:300-353's FILE
--    TEXT (D137), 2 hunks: the six schedule keys join the FREE blob class;
--    the five retired keys are REFUSED BY NAME with their replacement.
--    Grants unchanged from 129: `authenticated` may read it (the panel
--    renders refusal copy from it).
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
                                  'once the league is in playoffs (or complete) the bracket has been SEEDED from this key (118:1075-1077, :1338-1340); no verb re-seeds a bracket under played rounds')
    WHEN p_key IN ('playoff_weeks_per_round', 'consolation_bracket', 'third_place_game')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'bracket', 'refused_why',
                                  'once the league is in playoffs (or complete) the bracket has been SEEDED from this key (118:1075-1077, :1338-1340); no verb re-seeds a bracket under played rounds')
    -- REFUSED, always through this verb
    WHEN p_key IN ('regular_season_weeks', 'playoff_start_week')
                                THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'this key defines the SEASON WINDOW: league_weeks and matchups were generated for the stored plan (111:346, :422) and the standings cutoff reads it (D288), so moving it under rows that already exist re-plans nothing and re-cuts the standings; it is also coupled to its partner by Q10 (playoff_start_week = regular_season_weeks + 1), which one key at a time cannot keep. Pre-draft the route is update_league_settings, which validates the pair; post-draft no verb re-plans a season')
    WHEN p_key IN ('team_count')           THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'team_count is PRE-DRAFT ONLY (§7.3, erratum v2.16.40 — Q65 ruled (b) by Chris 2026-09-15): seats (teams / league_members) and a schedule already exist for the stored count; pre-draft the route is update_league_settings (F28''s seat floor lives there, 118:2499-2510); post-draft there is NO route — no verb raises this number in-season, and a placeholder seat cannot be added past the stored ceiling')
    WHEN p_key IN ('schedule_mode', 'median_game', 'second_opponent')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'this key defines the SCHEDULE SHAPE: primary, secondary and median rows are generated by the schedule engine (110/111) from it, and flipping it under rows that already exist leaves rows nothing reads or removes. Pre-draft the route is update_league_settings; post-draft no verb re-plans a schedule')
    WHEN p_key IN ('format')               THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'pinned to redraft in v1 (§7.3.1) — there is no other value to change it to')
    WHEN p_key IN ('lineup_lock')          THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'pinned to per_player_kickoff by 114''s CHECK (Q34(A)) — any other value is a constraint violation')
    WHEN p_key IN ('divisions')            THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'pinned to 1 (Q30 (d), v2.16.12) — the engine ignores the value')
    WHEN p_key IN ('playoff_byes')         THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'derived from the bracket size (§7.3.1: the literal ''auto'') — not independently settable')
    WHEN p_key IN ('schedule_seed')        THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'minted by the schedule engine and re-minted by a remix (F246) — never set by hand')
    -- 149: RETIRED keys, refused BY NAME with their replacement (the table's
    -- CHECK refuses them too — leagues_settings_no_retired_waiver_keys).
    WHEN p_key IN ('waiver_process_day', 'waiver_process_time', 'waiver_period_hours', 'free_agency')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'RETIRED by the waiver schedule (Q70, ruled 2026-09-27; spec §7.3.4 v2.16.59): when waivers run is waiver_run_days + waiver_run_time in waiver_time_zone, and when free agency is open is free_agency_opens (+ free_agency_open_day / free_agency_open_time); a dropped player is on waivers until the next run, so there is no waiver period to set')
    WHEN p_key IN ('bench_lock')           THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'RETIRED (Q73, ruled 2026-09-27; spec §7.3.4 v2.16.59): a waiver claim whose drop has already played this week always fails at the waiver run — the same rule as a manual drop — so there is nothing to switch')
    WHEN p_key IN ('draft')                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'the §7.3.8 draft block: pre-draft it belongs to the wizard / update_league_settings; post-draft the draft has happened and the block has no subject')
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_policy(TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 8. commish_setting_canon_internal — CREATE OR REPLACE against 129:440-629's
--    FILE TEXT (D137), 4 hunks: value gates for the six schedule keys
--    (days canonicalised Sunday-first, HH:MM, an IANA zone the database
--    knows, the two enums); the retired keys' gates removed (the policy
--    refuses them before any gate runs).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_setting_canon_internal(
  p_key TEXT, p_value JSONB, p_league public.leagues
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_txt   TEXT;
  v_arr   TEXT[];
  v_n     INTEGER;
  v_pt    INTEGER;
  v_slot  JSONB;
BEGIN
  CASE p_key
    -- ── FREE columns ──────────────────────────────────────────────────────
    WHEN 'waiver_type' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value,
        ARRAY['faab', 'rolling_priority', 'reverse_standings', 'none_fcfs']);
    WHEN 'faab_budget' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 1000);
    WHEN 'trade_review' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value,
        ARRAY['none', 'commissioner', 'league_vote']);
    WHEN 'trade_deadline_week' THEN
      -- nullable: null / "none" = no deadline; else 1..regular_season_weeks
      IF p_value IS NULL OR jsonb_typeof(p_value) = 'null'
         OR (jsonb_typeof(p_value) = 'string' AND lower(btrim(p_value #>> '{}')) = 'none') THEN
        RETURN 'null'::jsonb;
      END IF;
      RETURN public.commish_setting_int_internal(p_key, p_value, 1, p_league.regular_season_weeks);
    WHEN 'roster_settings' THEN
      -- The §7.3.2 canonical object: starting_slots[] (key/label/eligible/count),
      -- bench 0..20, ir_slots[] ≤ 6, swap_spots 0|1. The Zod schema is the
      -- full authority (L.E1.11's route); this is the server floor.
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings must be the §7.3.2 object {starting_slots, bench, ir_slots, swap_spots} — got %', COALESCE(jsonb_typeof(p_value), 'null')
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_value -> 'starting_slots') <> 'array'
         OR jsonb_typeof(p_value -> 'ir_slots') <> 'array'
         OR jsonb_typeof(p_value -> 'bench') <> 'number'
         OR jsonb_typeof(p_value -> 'swap_spots') <> 'number' THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings must carry starting_slots (array), ir_slots (array), bench (integer) and swap_spots (0 or 1) (§7.3.2)'
          USING ERRCODE = '22023';
      END IF;
      IF (p_value ->> 'bench')::numeric NOT BETWEEN 0 AND 20 OR (p_value ->> 'bench')::numeric <> floor((p_value ->> 'bench')::numeric) THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings.bench must be an integer 0..20 (§7.3.2) — got %', p_value ->> 'bench'
          USING ERRCODE = '22023';
      END IF;
      IF (p_value ->> 'swap_spots')::numeric NOT IN (0, 1) THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings.swap_spots must be 0 or 1 (§7.3.2) — got %', p_value ->> 'swap_spots'
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_array_length(p_value -> 'ir_slots') > 6 THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings.ir_slots may hold at most 6 spots (§7.3.2) — got %', jsonb_array_length(p_value -> 'ir_slots')
          USING ERRCODE = '22023';
      END IF;
      FOR v_slot IN SELECT * FROM jsonb_array_elements(p_value -> 'starting_slots') LOOP
        IF jsonb_typeof(v_slot) <> 'object'
           OR NULLIF(btrim(COALESCE(v_slot ->> 'key', ''), E' \t\r\n'), '') IS NULL
           OR jsonb_typeof(v_slot -> 'eligible') <> 'array' OR jsonb_array_length(v_slot -> 'eligible') < 1
           OR jsonb_typeof(v_slot -> 'count') <> 'number'
           OR (v_slot ->> 'count')::numeric NOT BETWEEN 0 AND 10 THEN
          RAISE EXCEPTION 'commish_change_setting: every roster_settings.starting_slots entry needs a key, a non-empty eligible[] and an integer count 0..10 (§7.3.2) — offending entry: %', v_slot::text
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
      -- R1040: the STORED value is REBUILT from the known keys, never
      -- `p_value` verbatim — an unknown top-level key or an unknown key
      -- inside a slot is dropped here, not left for L.E1.11's Zod mirror to
      -- be the only thing that strips it. Each slot is rebuilt from
      -- key/label/eligible/count (`label` carried through when present —
      -- the §7.3.2 shape has it; whether it is REQUIRED is the Zod
      -- schema's call, L.E1.11). `ir_slots` entries pass through unchanged:
      -- this floor validates only their count (≤ 6), and their element
      -- shape (§7.3.2's key/type/eligible_designations) is L.E1.11's too.
      RETURN jsonb_build_object(
        'starting_slots', COALESCE((
          SELECT jsonb_agg(
                   jsonb_strip_nulls(jsonb_build_object(
                     'key',      s.slot -> 'key',
                     'label',    s.slot -> 'label',
                     'eligible', s.slot -> 'eligible',
                     'count',    s.slot -> 'count'))
                   ORDER BY s.ord)
            FROM jsonb_array_elements(p_value -> 'starting_slots') WITH ORDINALITY AS s(slot, ord)),
          '[]'::jsonb),
        'bench',      p_value -> 'bench',
        'ir_slots',   p_value -> 'ir_slots',
        'swap_spots', p_value -> 'swap_spots');
    -- ── RESCORE ───────────────────────────────────────────────────────────
    WHEN 'scoring_system_id' THEN
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'commish_change_setting: scoring_system_id must be a scoring_systems id (uuid string) — got %', COALESCE(p_value::text, 'null')
          USING ERRCODE = '22023';
      END IF;
      v_txt := btrim(p_value #>> '{}');
      IF v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'commish_change_setting: scoring_system_id must be a uuid — got %', v_txt
          USING ERRCODE = '22023';
      END IF;
      RETURN to_jsonb(lower(v_txt));
    -- ── BRACKET ───────────────────────────────────────────────────────────
    WHEN 'playoff_teams' THEN
      v_pt := (public.commish_setting_int_internal(p_key, p_value, 0, 12) #>> '{}')::int;
      IF v_pt NOT IN (0, 2, 4, 6, 8, 10, 12) THEN
        RAISE EXCEPTION 'commish_change_setting: playoff_teams must be one of 0, 2, 4, 6, 8, 10, 12 (§7.3.1) — got %', v_pt
          USING ERRCODE = '22023';
      END IF;
      IF v_pt > p_league.team_count THEN
        RAISE EXCEPTION 'commish_change_setting: playoff_teams % exceeds team_count % (§7.3.1)', v_pt, p_league.team_count
          USING ERRCODE = '22023';
      END IF;
      -- Q39 (C), 118:2531-2534's backstop, mirrored: a total-points league
      -- has no bracket.
      IF v_pt > 0 AND COALESCE(p_league.settings ->> 'schedule_mode', 'h2h') = 'total_points' THEN
        RAISE EXCEPTION 'commish_change_setting: playoff_teams must be 0 for a total-points league — the season-long points race is its playoff and there is no bracket (§11.7, Q39 (C))'
          USING ERRCODE = '22023';
      END IF;
      RETURN to_jsonb(v_pt);
    WHEN 'playoff_weeks_per_round' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 1, 2);
    WHEN 'consolation_bracket', 'third_place_game', 'playoff_reseed',
         'allow_faab_in_trades', 'allow_future_considerations',
         'allow_illegal_lineups', 'auto_sub_inactives' THEN
      RETURN public.commish_setting_bool_internal(p_key, p_value);
    -- ── FREE blob ─────────────────────────────────────────────────────────
    WHEN 'faab_min_bid' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 10);
    WHEN 'faab_tiebreaker' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value, ARRAY['reverse_standings', 'rolling_priority']);
    -- 149 (Q70): the waiver schedule — six blob keys replacing the four
    -- retired ones (which the policy table now refuses by name).
    WHEN 'waiver_run_days' THEN
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'commish_change_setting: waiver_run_days must be a list of weekdays (sun, mon, tue, wed, thu, fri, sat) — got %', COALESCE(p_value::text, 'null')
          USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) x
                 WHERE jsonb_typeof(x) <> 'string'
                    OR btrim(x #>> '{}') NOT IN ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat')) THEN
        RAISE EXCEPTION 'commish_change_setting: waiver_run_days may hold only sun, mon, tue, wed, thu, fri, sat — got %', p_value::text
          USING ERRCODE = '22023';
      END IF;
      SELECT count(*) - count(DISTINCT btrim(x #>> '{}')) INTO v_n FROM jsonb_array_elements(p_value) x;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'commish_change_setting: waiver_run_days lists a day more than once — got %', p_value::text
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_array_length(p_value) < 1 THEN
        RAISE EXCEPTION 'commish_change_setting: waiver_run_days needs at least one day for waivers to run (a league with no waivers is waiver_type none_fcfs)'
          USING ERRCODE = '22023';
      END IF;
      -- canonical: Sunday-first, the stored form the Zod schema produces
      RETURN (SELECT jsonb_agg(d ORDER BY array_position(ARRAY['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], d))
              FROM (SELECT btrim(x #>> '{}') AS d FROM jsonb_array_elements(p_value) x) s);
    WHEN 'waiver_run_time', 'free_agency_open_time' THEN
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string'
         OR btrim(p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'commish_change_setting: % must be HH:MM (24h, in the league''s waiver time zone) — got %', p_key, COALESCE(p_value::text, 'null')
          USING ERRCODE = '22023';
      END IF;
      RETURN to_jsonb(btrim(p_value #>> '{}'));
    WHEN 'waiver_time_zone' THEN
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string'
         OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = btrim(p_value #>> '{}'))
         OR (btrim(p_value #>> '{}') NOT IN ('UTC', 'GMT') AND position('/' IN btrim(p_value #>> '{}')) = 0) THEN
        RAISE EXCEPTION 'commish_change_setting: waiver_time_zone must be an IANA time zone name such as America/Los_Angeles (§16.4) — got %', COALESCE(p_value::text, 'null')
          USING ERRCODE = '22023';
      END IF;
      RETURN to_jsonb(btrim(p_value #>> '{}'));
    WHEN 'free_agency_opens' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value, ARRAY['after_waiver_run', 'day_and_time', 'never']);
    WHEN 'free_agency_open_day' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value, ARRAY['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    WHEN 'acquisitions_per_week' THEN
      IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'string' AND lower(btrim(p_value #>> '{}')) = 'unlimited' THEN
        RETURN to_jsonb('unlimited'::text);
      END IF;
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 50);
    WHEN 'acquisitions_per_season' THEN
      IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'string' AND lower(btrim(p_value #>> '{}')) = 'unlimited' THEN
        RETURN to_jsonb('unlimited'::text);
      END IF;
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 500);
    WHEN 'fa_hold_hours' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 48);
    WHEN 'trade_veto_votes' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 1, p_league.team_count);
    WHEN 'trade_review_period_hours' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 96);
    WHEN 'trade_lock_behavior' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value, ARRAY['defer', 'reject']);
    WHEN 'stat_correction_window' THEN
      IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'string' AND btrim(p_value #>> '{}') = 'thu_06_00_et' THEN
        RETURN to_jsonb('thu_06_00_et'::text);
      END IF;
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 168);
    WHEN 'tiebreakers' THEN
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'commish_change_setting: tiebreakers must be an ordered array of win_pct, points_for, head_to_head, points_against, division_record, coin_flip (§7.3.7) — got %', COALESCE(jsonb_typeof(p_value), 'null')
          USING ERRCODE = '22023';
      END IF;
      v_arr := ARRAY(SELECT jsonb_array_elements_text(p_value));
      IF EXISTS (SELECT 1 FROM unnest(v_arr) x
                 WHERE x NOT IN ('win_pct', 'points_for', 'head_to_head', 'points_against', 'division_record', 'coin_flip')) THEN
        RAISE EXCEPTION 'commish_change_setting: tiebreakers carries an unknown entry — allowed: win_pct, points_for, head_to_head, points_against, division_record, coin_flip (§7.3.7); got %', p_value::text
          USING ERRCODE = '22023';
      END IF;
      SELECT count(*) - count(DISTINCT x) INTO v_n FROM unnest(v_arr) x;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'commish_change_setting: tiebreakers carries a duplicated entry (§7.3.7; league_standings refuses a duplicate) — got %', p_value::text
          USING ERRCODE = '22023';
      END IF;
      RETURN p_value;
    ELSE
      RAISE EXCEPTION 'commish_change_setting: no value gate for key % (this is a migration-129 defect: every key the policy table admits must have one)', p_key
        USING ERRCODE = 'P0001';
  END CASE;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_canon_internal(TEXT, JSONB, public.leagues)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. commish_change_setting_internal — CREATE OR REPLACE against
--    144:552-1111's FILE TEXT (D137), 3 hunks: a change to WHEN waivers run
--    (days / time / zone / waiver_type) moves a TRACKED pending run to the new
--    schedule and says so in `consequences`; every other key's document is
--    byte-identical to 144's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_change_setting_internal(
  p_league_id UUID,
  p_key       TEXT,
  p_value     JSONB,
  p_rescore   BOOLEAN,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_found         BOOLEAN;
  v_reason        TEXT;
  v_key           TEXT;
  v_policy        JSONB;
  v_class         TEXT;
  v_storage       TEXT;
  v_rescore       BOOLEAN := COALESCE(p_rescore, FALSE);
  v_in_season     BOOLEAN;
  v_before        JSONB;
  v_canon         JSONB;
  v_no_changes    BOOLEAN;
  v_bypassed      JSONB;
  v_bypassed_why  TEXT;
  v_audit_id      UUID;
  v_message       TEXT;
  v_result        JSONB;
  v_cnt           INTEGER;
  -- scoring
  v_new_scoring   UUID;
  v_new_rules     JSONB;
  v_snapshot_refrozen BOOLEAN := FALSE;
  v_snapshot_why  TEXT;
  v_final_weeks   JSONB := '[]'::jsonb;
  v_open_weeks    JSONB := '[]'::jsonb;
  v_rescored      JSONB := '[]'::jsonb;
  v_rescore_done  BOOLEAN := FALSE;
  v_rescore_why   TEXT;
  v_skipped_final JSONB := '[]'::jsonb;   -- 141 / Q64 as ruled: the final weeks rescore left alone, NAMED
  v_skipped_why   TEXT;
  -- 144 / Q69 as ruled (L.E1.27): the correction-window weeks are kept too,
  -- and a week's stored rules (F397) move only for the LIVE week a rescore re-queues.
  v_cw_weeks      JSONB := '[]'::jsonb;
  v_live_weeks    JSONB := '[]'::jsonb;
  v_skipped_cw    JSONB := '[]'::jsonb;
  v_kept_words    TEXT;
  v_kept_count    INTEGER := 0;
  v_rules_rewritten JSONB := '[]'::jsonb;
  v_score_stale   BOOLEAN := FALSE;
  v_stale_why     TEXT;
  v_wk            RECORD;
  v_enq           INTEGER;
  v_not_enq       JSONB;
  v_ir_keys       TEXT[];
  -- faab
  v_faab_reseeded BOOLEAN := FALSE;
  v_faab_why      TEXT;
  v_faab_off      INTEGER := 0;
  -- roster
  v_not_refit     INTEGER := 0;
  v_consequences  JSONB;
  -- 149 (Q70): the pending waiver run follows a schedule change
  v_after_row     public.leagues;
  v_sched         JSONB;
  v_next_before   TIMESTAMPTZ;
  v_next_after    TIMESTAMPTZ;
  v_next_why      TEXT;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule; §4 rule 15).
  IF NULLIF(btrim(COALESCE(p_key, ''), E' \t\r\n'), '') IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: p_key is required — an override that names no setting is not an override'
      USING ERRCODE = '22023';
  END IF;
  v_key := btrim(p_key, E' \t\r\n');
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every gate
  --     below reads THIS row, never a pre-lock read (R1036's lesson).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner only, in-body, ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_change_setting: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (`123:602-609`), so a retry replays byte-identically even when the
  --     league has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_setting_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused — absent or
  --     whitespace-only in the explicit class (R745) ⇒ NULL (130 §0 stores
  --     it); otherwise trimmed, bounded at 500 below (NULL-safe as written).
  --     F343 as amended by 131: the client may send nothing.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'commish_change_setting: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) THE KEY, against the policy table. An unknown key is refused BY NAME:
  --     this verb writes no key the catalog does not define.
  v_policy := public.commish_setting_policy(v_key);
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: % is not a league setting this verb knows — the catalog is leagueSettingsSchema (§7.3); no undefined key is ever written into leagues.settings', v_key
      USING ERRCODE = '22023';
  END IF;
  v_class   := v_policy ->> 'class';
  v_storage := v_policy ->> 'storage';
  v_in_season := v_league.status NOT IN ('setup', 'scheduled');

  -- (6) THE PER-KEY POLICY — refused-by-name classes (the banner's table).
  IF v_class = 'refused' THEN
    RAISE EXCEPTION 'commish_change_setting: % cannot be changed through this verb (league % is %). WHY: %',
      v_key, p_league_id, v_league.status, v_policy ->> 'refused_why'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_class = 'bracket' AND v_league.status IN ('playoffs', 'complete') THEN
    RAISE EXCEPTION 'commish_change_setting: % is REFUSED in-season once the bracket exists (league % is %). WHY: %',
      v_key, p_league_id, v_league.status, v_policy ->> 'refused_why'
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) `rescore` has exactly one subject. On any other key the flag is a
  --     malformed call, refused by name — never accepted and ignored.
  IF v_rescore AND v_key <> 'scoring_system_id' THEN
    RAISE EXCEPTION 'commish_change_setting: rescore applies only to scoring_system_id — % has no stored score to recompute; resubmit without rescore',
      v_key
      USING ERRCODE = '22023';
  END IF;

  -- (8) THE VALUE, canonicalised (item 4) and range-checked against the
  --     LOCKED row; the CURRENT value read from the same row in the same
  --     canonical form.
  v_canon := public.commish_setting_canon_internal(v_key, p_value, v_league);
  IF v_storage = 'column' THEN
    v_before := to_jsonb(v_league) -> v_key;          -- typed column; uuid renders as a string
  ELSE
    v_before := COALESCE(v_league.settings -> v_key, 'null'::jsonb);  -- absent blob key = null
  END IF;

  -- (8b) scoring_system_id: 118 step 5's attachable scope, in meaning — a
  --      TEMPLATE, or the league's own currently-referenced row (the no-op).
  --      104's wall 3 (`trg_leagues_scoring_reference_guard`) additionally
  --      validates the referenced rules at the UPDATE; it is ridden, not
  --      duplicated.
  IF v_key = 'scoring_system_id' THEN
    v_new_scoring := (v_canon #>> '{}')::uuid;
    IF v_new_scoring IS DISTINCT FROM v_league.scoring_system_id THEN
      SELECT s.rules INTO v_new_rules
      FROM public.scoring_systems s
      WHERE s.id = v_new_scoring AND s.is_template = TRUE AND s.owner_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'commish_change_setting: scoring_system_id % must reference one of the scoring templates, or the league''s own current custom scoring system — personal scoring systems and other leagues'' systems cannot be attached (§7.3.8 v2.11, §7.3.3.1; 118 step 5''s scope)',
          v_new_scoring
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- (9) THE NO-OP, DETECTED BY VALUE — jsonb equality over the canonical
  --     form of the ONE dimension this verb changes (D336 part 3; `123:1016`).
  --     `2` and `"2"` both canonicalise to `2`, so a re-send in a different
  --     JSON type is a no-op too.
  v_no_changes := (v_canon = v_before);

  -- (10) THE LIFTED GATE, NAMED. Past `scheduled`, 118 step 3 would have
  --      refused this write (`118:2489-2497`); that is the rule this verb
  --      walks past, and the receipt says so (standing rule (g)'s shape).
  IF v_in_season THEN
    v_bypassed     := jsonb_build_array('settings_status_gate');
    v_bypassed_why := 'update_league_settings refuses every status past scheduled (118:2489-2497, "settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)"); this verb IS that override (§7.3 header: "commissioner-override-only … allowed but logged and warned")';
  ELSE
    v_bypassed     := '[]'::jsonb;
    v_bypassed_why := 'nothing to bypass — in setup/scheduled the document path (update_league_settings) admits this key too; this verb was used for its per-key receipt';
  END IF;

  -- (11) THE SCORING CONSEQUENCES are computed BEFORE the write so the
  --      report at (12c) describes the weeks as they were.
  IF v_key = 'scoring_system_id' AND NOT v_no_changes THEN
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_final_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'final';
    SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb) INTO v_open_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status IN ('live', 'correction_window');
    -- 144 / Q69: the two halves of "open", split — a CORRECTION-WINDOW week
    -- (members see it as "Final (pending corrections)") is KEPT like a final
    -- one; only the LIVE week is re-scored ("this week and later", Q64).
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_cw_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'correction_window';
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_live_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'live';
    -- Every week already under way, in plain words ("week 1 (final) and
    -- week 2 (final, pending stat corrections)") — the post and the whys.
    v_kept_count := jsonb_array_length(v_final_weeks) + jsonb_array_length(v_cw_weeks);
    v_kept_words := NULLIF(concat_ws(' and ',
      public.league_week_list_words_internal(v_final_weeks) || ' (final)',
      public.league_week_list_words_internal(v_cw_weeks) || ' (final, pending stat corrections)'), '');

    -- (11b) ── Q64 AS RULED ── (Chris, 2026-09-27, option 1, going forward
    --       only: "The new rule applies to this week and later. Finished
    --       weeks keep their original scores and results."; spec §10.1
    --       v2.16.42: "a scoring change applies to open and future weeks; a
    --       final week is never re-scored"). Migration 141 (L.E1.24, F382)
    --       REPLACED the whole-call refusal that stood here: a FINAL week is
    --       SKIPPED and NAMED, never refused, and the change lands. Nothing
    --       below writes a final week — (12c)'s loop reads live /
    --       correction_window only, and the scoring worker refuses a final
    --       week at its door (`score_write_week_batch` → week_final,
    --       119:566-568). `reopen_week` is NOT built (Q64: not wanted).
    -- ── Q69 AS RULED ── (Chris, 2026-09-27, option (b): "Q69 keep last
    --       week's scores"). Migration 144 (L.E1.27, F404) widens the kept
    --       set from FINAL weeks to every FINISHED week — final AND in its
    --       stat-correction window — and names each with its status. Only the
    --       LIVE week is re-scored (12c); each kept week goes on being scored
    --       under ITS OWN stored rules by every later stat correction (F397,
    --       `league_weeks.scoring_rules_snapshot`), so keeping it is honest.
    IF v_rescore AND v_kept_count > 0 THEN
      v_skipped_final := v_final_weeks;
      v_skipped_cw    := v_cw_weeks;
      v_skipped_why   := 'finished_weeks_not_rescored — ' || v_kept_words
        || CASE WHEN v_kept_count = 1 THEN ' keeps its scores and results' ELSE ' keep their scores and results' END
        || '; the new scoring applies to '
        || CASE WHEN v_live_weeks <> '[]'::jsonb
             THEN public.league_week_list_words_internal(v_live_weeks)
                  || ' (being played now — re-scored under it) and to every later week (scored under it when it opens)'
             ELSE 'every later week (scored under it when it opens) — no week is being played right now' END;
    END IF;
  END IF;

  IF NOT v_no_changes THEN
    -- (12a) THE STATE WRITE — ONE key, read-modify-write (D347). Typed
    --       columns each by name; blob keys through `settings || {key: v}`
    --       so every OTHER key is byte-untouched. `updated_at = p_at`.
    CASE v_key
      WHEN 'waiver_type' THEN
        UPDATE public.leagues SET waiver_type = v_canon #>> '{}', updated_at = p_at WHERE id = p_league_id;
      WHEN 'faab_budget' THEN
        UPDATE public.leagues SET faab_budget = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'trade_review' THEN
        UPDATE public.leagues SET trade_review = v_canon #>> '{}', updated_at = p_at WHERE id = p_league_id;
      WHEN 'trade_deadline_week' THEN
        UPDATE public.leagues SET trade_deadline_week = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'roster_settings' THEN
        UPDATE public.leagues SET roster_settings = v_canon, updated_at = p_at WHERE id = p_league_id;
      WHEN 'playoff_teams' THEN
        UPDATE public.leagues SET playoff_teams = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'scoring_system_id' THEN
        -- RE-DECISION 2: the reference and the re-frozen snapshot move in ONE
        -- statement (§7.3.3 — "on any commissioner scoring change"); a NULL
        -- snapshot stays NULL, exactly as 118:2586-2590 leaves it (draft_start
        -- is the freezer pre-draft). 104's two walls fire on this UPDATE.
        UPDATE public.leagues
        SET scoring_system_id      = v_new_scoring,
            scoring_rules_snapshot = CASE WHEN scoring_rules_snapshot IS NOT NULL THEN v_new_rules ELSE scoring_rules_snapshot END,
            updated_at             = p_at
        WHERE id = p_league_id;
        v_snapshot_refrozen := (v_league.scoring_rules_snapshot IS NOT NULL);
        v_snapshot_why := CASE WHEN v_snapshot_refrozen
          THEN 'scoring_rules_snapshot re-frozen from the new system''s rules in the same statement as the reference (§7.3.3, never-weaken; 118:2585-2590''s rule kept)'
          ELSE 'scoring_rules_snapshot is NULL (pre-draft) and stays NULL — draft_start freezes it (059/110), exactly as 118:2586 leaves it' END;
      ELSE
        UPDATE public.leagues
        SET settings   = settings || jsonb_build_object(v_key, v_canon),
            updated_at = p_at
        WHERE id = p_league_id;
    END CASE;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_change_setting: the write touched % rows, expected exactly 1 (league %)', v_cnt, p_league_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (12a') 149 (Q70): THE PENDING WAIVER RUN FOLLOWS THE SCHEDULE. Once the
    --        processor tracks a league (`waiver_next_run_at` set — L.D2.9's
    --        tick), a change to WHEN waivers run (the days, the time, the zone)
    --        or to whether there are waivers at all moves that pending run to
    --        the new schedule's next run after this instant (NULL under
    --        none_fcfs); an untracked league (NULL) stays untracked — the
    --        schedule itself is the record until the processor seeds it. The
    --        new schedule is re-parsed from the WRITTEN row, so a combination
    --        that cannot run is refused by name here, inside this transaction.
    IF v_key IN ('waiver_type', 'waiver_run_days', 'waiver_run_time', 'waiver_time_zone') THEN
      SELECT l.* INTO v_after_row FROM public.leagues l WHERE l.id = p_league_id;
      v_sched := public.waiver_schedule_internal(v_after_row.settings, v_after_row.waiver_type);
      v_next_before := v_league.waiver_next_run_at;
      IF v_next_before IS NULL THEN
        v_next_after := NULL;
        v_next_why := 'untracked — no waiver run is pending for this league yet (the processor starts tracking it at its first run), so there was nothing to move; the add path reads the new schedule from now on';
      ELSE
        v_next_after := CASE WHEN (v_sched ->> 'waivers')::boolean THEN public.waiver_next_run_internal(v_sched, p_at) END;
        UPDATE public.leagues SET waiver_next_run_at = v_next_after WHERE id = p_league_id;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION 'commish_change_setting: moving the pending waiver run touched % rows, expected exactly 1 (league %)', v_cnt, p_league_id
            USING ERRCODE = 'P0001';
        END IF;
        v_next_why := CASE WHEN v_next_after IS NULL
          THEN 'no_waivers — the league now has no waivers, so no run is pending; claims still pending are the processor''s to settle'
          ELSE 'moved — the pending waiver run is now the new schedule''s next run after this change' END;
      END IF;
    END IF;

    -- (12b) RE-DECISION 1 — THE FAAB RE-SEED, narrowed to the precondition
    --       118's own comment names: pre-draft ONLY. In-season every balance
    --       is byte-unchanged and the document says so with a MEASURED count.
    IF v_key = 'faab_budget' THEN
      IF NOT v_in_season THEN
        UPDATE public.league_members
        SET faab_balance = (v_canon #>> '{}')::int
        WHERE league_id = p_league_id;
        v_faab_reseeded := TRUE;
        v_faab_why := 'league is ' || v_league.status || ' (pre-draft): every seat re-seeded to the new budget so all balances match the create/join/claim seeding (§12.2 / D70 — 118:2617-2621''s rule, kept for the state it was written for)';
      ELSE
        SELECT count(*)::int INTO v_faab_off
        FROM public.league_members m
        WHERE m.league_id = p_league_id AND m.team_id IS NOT NULL
          AND m.faab_balance IS DISTINCT FROM (v_canon #>> '{}')::int;
        v_faab_why := 'league is ' || v_league.status || ' (in-season): faab_balance is the ledger of each team''s spend and is BYTE-UNCHANGED for every seat — re-seeding would wipe every team''s spend (118:2617-2621 was safe only behind the status gate this verb lifts). ' || v_faab_off || ' seat(s) now carry a balance that differs from the new budget; adjusting ONE team''s balance is commish_edit_faab (§15.4:1698 — M5, F340)';
      END IF;
    END IF;

    -- (12c) THE RESCORE — the LIVE week re-queued when asked (144 / Q69: a
    --       correction-window week is kept like a final one); the stored
    --       scores of every week left alone when not, and NAMED either way.
    IF v_key = 'scoring_system_id' THEN
      IF v_rescore THEN
        -- A FINAL week is never in this loop: (11b) skipped it by name (141).
        -- Nor, from 144 (Q69), a CORRECTION-WINDOW week: the LIVE week only.
        SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[]) INTO v_ir_keys
        FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) s;
        FOR v_wk IN
          SELECT lw.week, lw.status
          FROM public.league_weeks lw
          WHERE lw.league_id = p_league_id AND lw.season = v_league.season
            AND lw.status = 'live'
          ORDER BY lw.week
        LOOP
          -- Starters of every team-week, derived from slot_map the way the
          -- worker derives them (`startersOf`: every non-empty value whose
          -- slot key's base is not an IR key), stamped with the player's own
          -- MIN(player_stats.updated_at) — never now() (123's SCORING rule).
          INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
          SELECT v_league.season, v_wk.week, ps.player_id, min(ps.updated_at)
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
          JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
          JOIN public.player_stats ps
            ON ps.season = v_league.season AND ps.week = v_wk.week AND ps.player_id = sm.pid
           AND ps.updated_at IS NOT NULL
          WHERE tl.season = v_league.season AND tl.week = v_wk.week
            AND sm.pid IS NOT NULL AND sm.pid <> ''
            AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
          GROUP BY ps.player_id
          ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row
          -- "a claimable queue row EXISTS for him" (123:1088-1092's meaning),
          -- and the starters the INSERT could NOT queue, named (R968).
          SELECT count(DISTINCT sm.pid)::int INTO v_enq
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
          JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
          WHERE tl.season = v_league.season AND tl.week = v_wk.week
            AND sm.pid IS NOT NULL AND sm.pid <> ''
            AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
            AND EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = v_wk.week AND f.player_id = sm.pid);
          SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', x.pid, 'why',
                   CASE WHEN EXISTS (SELECT 1 FROM public.player_stats ps
                                     WHERE ps.season = v_league.season AND ps.week = v_wk.week AND ps.player_id = x.pid)
                        THEN 'stats_unstamped' ELSE 'no_stat_row' END) ORDER BY x.pid), '[]'::jsonb)
          INTO v_not_enq
          FROM (SELECT DISTINCT sm.pid
                FROM public.team_lineups tl
                JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
                JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
                WHERE tl.season = v_league.season AND tl.week = v_wk.week
                  AND sm.pid IS NOT NULL AND sm.pid <> ''
                  AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
                  AND NOT EXISTS (SELECT 1 FROM public.score_fanout f
                                  WHERE f.season = v_league.season AND f.week = v_wk.week AND f.player_id = sm.pid)) x;
          v_rescored := v_rescored || jsonb_build_object(
            'week', v_wk.week, 'status', v_wk.status,
            'starters_enqueued', v_enq, 'score_not_enqueued', v_not_enq);
        END LOOP;
        IF jsonb_array_length(v_rescored) > 0 THEN
          v_rescore_done := TRUE;
          v_rescore_why  := NULL;
          -- 144 / F397: exactly these LIVE weeks take the new rules — written
          -- at (13b), stamped with this change's receipt (the count asserted).
          v_rules_rewritten := v_live_weeks;
        ELSE
          v_rescore_done := FALSE;
          v_rescore_why  := CASE WHEN v_kept_count > 0
            THEN 'no_live_week — no week is being played right now, so nothing is re-scored: ' || v_kept_words
                 || CASE WHEN v_kept_count = 1 THEN ' keeps its scores and results' ELSE ' keep their scores and results' END
                 || ', and every later week is scored under the new scoring when it opens'
            ELSE 'nothing_scored_yet — this season has no live or correction_window week and no final week, so there is no stored score to recompute; the re-frozen snapshot governs every week from here' END;
        END IF;
      ELSE
        -- 144 / F397: with rescore NOT asked for, no started week's stored
        -- rules change — each goes on being scored (live polls AND stat
        -- corrections) under the rules it opened with, and the new rules
        -- start with the next week to open. So there is no MIXED week any
        -- more: 141's `score_stale` / 'snapshot_changed_without_rescore'
        -- described the worker reading the league's re-frozen column for an
        -- already-scored week, which it no longer does. `score_stale` stays
        -- FALSE (the field is kept — a replayed pre-144 document carries it).
        v_rescore_done := FALSE;
        v_rescore_why  := 'not_requested — rescore was not asked for, so no week already under way changes: '
          || COALESCE(NULLIF(concat_ws(' and ', v_kept_words,
               public.league_week_list_words_internal(v_live_weeks) || ' (being played now)'), ''), 'no week has started yet')
          || CASE WHEN v_kept_count + jsonb_array_length(v_live_weeks) = 0 THEN ''
                  WHEN v_kept_count + jsonb_array_length(v_live_weeks) = 1 THEN ' keeps the scoring it started with'
                  ELSE ' keep the scoring they started with' END
          || ', and the new scoring starts with the next week to open';
      END IF;
    END IF;

    -- (12d) ROSTER SHAPE: nothing re-fits a stored slot_map. Counted, so the
    --       §7.3 header's "warned" is a number.
    IF v_key = 'roster_settings' THEN
      SELECT count(*)::int INTO v_not_refit
      FROM public.team_lineups tl
      JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
      JOIN public.league_weeks lw ON lw.league_id = p_league_id AND lw.season = tl.season AND lw.week = tl.week
      WHERE tl.season = v_league.season AND lw.status IN ('upcoming', 'live');
    END IF;

    v_consequences := jsonb_build_object(
      'snapshot_refrozen',         v_snapshot_refrozen,
      'snapshot_why',              v_snapshot_why,
      'final_weeks',               v_final_weeks,
      'open_weeks',                v_open_weeks,
      'rescore_requested',         v_rescore,
      'rescore_performed',         v_rescore_done,
      'rescore_not_performed_why', v_rescore_why,
      'rescored_weeks',            v_rescored,
      'rescore_skipped_final_weeks',     v_skipped_final,   -- 141 / Q64 as ruled
      'rescore_skipped_correction_window_weeks', v_skipped_cw,  -- 144 / Q69 as ruled
      'rescore_skipped_final_weeks_why', v_skipped_why,     -- 144: names BOTH kept kinds
      'week_rules_rewritten',      v_rules_rewritten,       -- 144 / F397: the live week(s) whose stored rules are now the new ones
      'week_rules_why',            CASE WHEN v_key = 'scoring_system_id' THEN
                                     CASE WHEN v_rules_rewritten <> '[]'::jsonb
                                       THEN 'the week being played now takes the new rules (its league_weeks.scoring_rules_snapshot is re-written with this receipt); every week already finished keeps the rules it was played with, and every later week takes the new rules when it opens (F397)'
                                       ELSE 'no started week''s rules changed — each keeps the rules it was played with (league_weeks.scoring_rules_snapshot), and the next week to open takes the new rules (F397)' END END,
      'rescore_upcoming_weeks_why', CASE WHEN v_rescore THEN
                                     'upcoming weeks are not queued — nothing has been scored for them; each is scored under the new scoring when it opens' END,
      'score_stale',               v_score_stale,
      'score_stale_reason',        v_stale_why,
      'faab_reseeded',             v_faab_reseeded,
      'faab_reseed_why',           v_faab_why,
      'faab_seats_off_budget',     v_faab_off,
      'lineups_not_refit',         v_not_refit,
      'lineups_not_refit_why',     CASE WHEN v_key = 'roster_settings' THEN
                                     'no stored team_lineups.slot_map is re-fit by a roster change; the next set_lineup / autopilot pass fits against the new shape (§7.3 header: "allowed but logged and warned") — the count is the open/upcoming lineup rows of this season' END)
      -- 149 (Q70): only a change to WHEN waivers run carries these keys, so
      -- every other key's consequences document is byte-identical to 144's.
      || CASE WHEN v_key IN ('waiver_type', 'waiver_run_days', 'waiver_run_time', 'waiver_time_zone') THEN
           jsonb_build_object(
             'waiver_next_run_at_before', v_next_before,
             'waiver_next_run_at',        CASE WHEN v_next_before IS NULL THEN NULL ELSE v_next_after END,
             'waiver_next_run_why',       v_next_why)
         ELSE '{}'::jsonb END;

    -- (13) D336 part 2 — EXACTLY ONE audit row, through the ONE shared
    --      logging helper, INSIDE the no-op guard and AFTER the state write.
    --      §5's contractual shape: target_type 'setting', target_id = the
    --      key, before/after = {<key>: value} — THAT KEY ALONE.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'change_setting', 'setting', v_key, v_reason,
      jsonb_build_object(v_key, v_before),
      jsonb_build_object(v_key, v_canon),
      jsonb_build_object(
        'verb',                      'commish_change_setting',
        'season',                    v_league.season,
        'action_id',                 p_action_id,
        'league_status',             v_league.status,
        'storage',                   v_storage,
        'policy_class',              v_class,
        'bypassed',                  v_bypassed,
        -- §5's three contractual extras for this verb:
        'rescore_requested',         v_rescore,
        'rescore_performed',         v_rescore_done,
        'rescore_not_performed_why', v_rescore_why,
        'rescore_skipped_final_weeks', v_skipped_final,        -- 141 / Q64 as ruled
        'rescore_skipped_correction_window_weeks', v_skipped_cw,  -- 144 / Q69 as ruled
        'consequences',              v_consequences),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_change_setting: the audit row was not written — refusing to let the change stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (13b) 144 / F397 — THE LIVE WEEK'S STORED RULES. A rescore re-queued
    --       the live week(s) at (12c); in the same transaction, under the
    --       same league lock (league_week_advance takes it first, so no week
    --       changes status in between), those weeks' stored rules become the
    --       new ones, stamped with THIS receipt. Written after (13) only so
    --       the row can carry the receipt id; nothing can observe the queue
    --       rows without the rules — both commit together. With rescore off,
    --       or with no live week, NO opened week's rules move (144's guard
    --       trigger would refuse a finished week's anyway).
    IF v_rules_rewritten <> '[]'::jsonb THEN
      UPDATE public.league_weeks lw
      SET scoring_rules_snapshot  = v_new_rules,
          scoring_system_id       = v_new_scoring,
          scoring_rules_source    = 'rescore',
          scoring_rules_action_id = v_audit_id
      WHERE lw.league_id = p_league_id AND lw.season = v_league.season
        AND lw.status = 'live'
        AND lw.week IN (SELECT (x #>> '{}')::int FROM jsonb_array_elements(v_rules_rewritten) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_rules_rewritten) THEN
        RAISE EXCEPTION 'commish_change_setting: re-writing the live week(s) % rules touched % row(s), expected % — refusing to re-score a week that would go on being scored under its old rules (F397)',
          v_rules_rewritten, v_cnt, jsonb_array_length(v_rules_rewritten)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (14) §10.3: override system messages auto-post to league chat and
    --      CANNOT be disabled. The consequence is in the post, not only in
    --      the document (R971's shape).
    v_message := 'Setting ' || v_key || ' changed from ' || v_before::text || ' to ' || v_canon::text
      || ' by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_rescore_done THEN ' — ' || public.league_week_list_words_internal(v_live_weeks)
                                         || ' (being played now) will be re-scored under the new rules'
              WHEN v_score_stale THEN ' — stored scores were NOT recomputed'
              WHEN v_key = 'faab_budget' AND NOT v_faab_reseeded THEN ' — team balances unchanged'
              WHEN v_key = 'scoring_system_id' AND NOT v_rescore   -- 144 / F397: said in plain words
                   AND v_kept_count + jsonb_array_length(v_live_weeks) > 0
                THEN ' — weeks already started keep the scoring they started with; the new scoring starts with the next week'
              ELSE '' END
      || CASE WHEN v_skipped_final <> '[]'::jsonb OR v_skipped_cw <> '[]'::jsonb   -- 141 / 144: never a quiet partial
              THEN CASE WHEN v_rescore_done THEN '; ' ELSE ' — ' END
                   || v_kept_words
                   || CASE WHEN v_kept_count = 1 THEN ' keeps its scores and results' ELSE ' keep their scores and results' END
              ELSE '' END
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_change_setting',
    'action_type',            'change_setting',
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'league_status',          v_league.status,
    'key',                    v_key,
    'storage',                v_storage,
    'policy_class',           v_class,
    'value',                  CASE WHEN v_no_changes THEN v_before ELSE v_canon END,
    'previous_value',         v_before,
    'requested_value',        v_canon,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'value_already_set — the league already stored this exact value for ' || v_key || ' (compared as canonical jsonb, so 2 and "2" are the same value), so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op, and that is the point
    'bypassed',               v_bypassed,
    'bypassed_why',           v_bypassed_why,
    'rescore_requested',      v_rescore,
    'rescore_performed',      v_rescore_done,
    'rescore_not_performed_why', CASE WHEN v_no_changes AND v_rescore THEN
                                'no_changes — the scoring reference is already this system, so there is nothing to re-score'
                                ELSE v_rescore_why END,
    'rescore_skipped_final_weeks',     v_skipped_final,      -- 141 / Q64 as ruled: [] unless rescore skipped a final week
    'rescore_skipped_correction_window_weeks', v_skipped_cw, -- 144 / Q69 as ruled: [] unless rescore skipped a correction-window week
    'rescore_skipped_final_weeks_why', v_skipped_why,        -- NULL exactly when BOTH lists are []
    'consequences',           CASE WHEN v_no_changes THEN NULL ELSE v_consequences END,
    'reason',                 v_reason,
    'system_post',            v_message,             -- NULL on a no-op
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`):
  -- an action_id is consumed by its submit whether or not anything moved.
  INSERT INTO public.commish_setting_actions (league_id, setting_key, action_id, actor_id, result)
  VALUES (p_league_id, v_key, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION commish_change_setting_internal(UUID, TEXT, JSONB, BOOLEAN, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
