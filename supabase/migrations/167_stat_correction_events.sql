-- ============================================================================
-- 167_stat_correction_events.sql — STAT-CORRECTION EVENTS + THE ONE-
-- TRANSACTION INGEST DOOR (task L.E2.1, FULL rigour — scoring inputs and the
-- production stats poll; tasks-M6 TD2 / TD3 / TD5; PROGRESS F267 (taken),
-- F268's `stat_correction_events` half (the table), F269(a)'s after-grace gap
-- (a late-filled line for a final game is a correction), F218(b)).
-- Spec §12.21 (the table — C80's shape: + game_id, week_state, source, the
-- natural key, RLS), §23.2 (idempotent, diff-aware writes; the fan-out queue
-- only sees real deltas), §23.4 ("ingestion diff after a game is `final` ⇒
-- `stat_correction_events` rows"), §7.3.3 / 158 (a final week is locked —
-- nothing here writes a league table).
--
-- Numbering: reserved by the orchestrator (167 / pgTAP 115) and measured at
-- build time (D161) — `ls supabase/migrations | tail -1` →
-- 166_lineup_batch.sql, `ls supabase/tests | tail -1` → 114_lineup_batch.sql,
-- main @ 51de708. Reaches production by `npx supabase db push` only
-- (production is at 166; push debt: 167).
--
-- WHAT A CORRECTION IS (TD2). A change to a scoring stat of a player's line
-- for a game that was already `final` BEFORE the poll that saw it, or a first
-- line for such a game (a provider gap filled late — F269(a)). A metadata-only
-- rewrite (`is_live` / `game_id` / `source`) is never one (F268). The
-- CLASSIFICATION is the TypeScript diff's (`ingestWeek`, TD3: "TS stays the
-- one diff") — it alone holds the stored game state from BEFORE this poll
-- (the poll writes `nfl_games` before it calls this door, so the door would
-- only ever see the new state). The door records what it is told is a
-- correction, but computes each event's OLD value itself, from the stored
-- line under the week's lock, and its NEW value from the line it writes —
-- so an event is always the transition this transaction performed, never a
-- number the caller asserted. A key whose stored value already equals the
-- new one (a concurrent poll landed it first) is counted and not recorded.
--
-- WHAT THIS MIGRATION DOES
--   §1 `stat_correction_events` — one row per (season, week, player, stat
--      key) change, in the ONE canonical stat namespace (D33 — `rec_yd`-style
--      registry keys, never a column name): old → new, the game, the WEEK'S
--      state at detection (`open` / `final`, below), the provider, the
--      detection instant (the door's `p_now` — no DEFAULT: a writer that
--      forgot the instant fails, it never reads the wall clock), and
--      `applied_at` (§12.21 — L.E2.2 stamps it when no league still has an
--      undrained re-score for it; NULL here). Natural key UNIQUE (season,
--      week, player_id, stat_key, detected_at): a replayed batch can never
--      record twice. FK player → `players` ON DELETE CASCADE, as the line it
--      annotates (`player_stats`, 001:118); `game_id` is plain TEXT — a
--      record of what the provider said must not block or follow a schedule
--      rewrite. NFL data, not league data: SELECT for `authenticated` (the
--      `player_stats` shape, 001:611); NO write policy for any role.
--   §2 `ingest_write_batch(p_rows, p_now)` — the service role's door (F267,
--      TD3): ONE transaction writes a batch's `player_stats` lines, their
--      correction events and their `score_fanout` enqueue, so the readiness
--      predicate (F218, `player_stats.updated_at >= score_fanout.enqueued_at`)
--      is true by construction and a crash can no longer land half a poll.
--      SECURITY DEFINER, search_path '', a signed-in / anon caller refused
--      in-body (42501), REVOKEd from PUBLIC / anon / authenticated.
--
-- THE WEEK'S STATE AT DETECTION (TD2 / TD4 — "finality governs, not the
-- clock"). `final` iff, at `p_now`: the NFL week's correction window has
-- closed (`nfl_weeks.correction_window_ends_at <= p_now`) AND every game
-- still in the week is final by `finalize_matchups`' OWN test
-- (`week_games_state_internal(season, week).all_final`, 116 — a game has
-- left its week only once postponed past the next week's start; a week held
-- past its window by an unplayed game is open — spec §23.4's held-week
-- bullet, Q82 / E43; a week with no stored games is open) AND no in-season /
-- playoff league still
-- has that week open (`league_weeks.status <> 'final'` — a week held on
-- `pending_scores`, or not yet reached by the hourly finalize). Otherwise
-- `open`. It is the NFL-level label: `final` means NO league can re-score
-- the correction (158's lock + the worker's `week_final`); `open` means at
-- least one still may. Which league a correction actually changed is each
-- league's own record (L.E2.2's `league_stat_corrections.state`, TD6) — the
-- event carries the id that record points at.
--
-- A FINAL WEEK IS NEVER RE-SCORED HERE. This door writes `player_stats`
-- (research stays right — Q81, Chris 2026-09-29: "if the stat window has
-- closed I think we have to forget it") and the queue; the score-week worker
-- consumes a `final` league week's queue rows as `week_final` (D295(b)) and
-- `score_write_week_batch` refuses the week by name (158) — both unchanged.
--
-- D137: NO existing function is replaced (nothing CREATE OR REPLACEd; every
-- older md5 pin stands). The enqueue repeats `ingestWeek`'s PostgREST upsert
-- exactly — `ON CONFLICT (season, week, player_id) DO UPDATE SET
-- enqueued_at, deferred_until = NULL` (D321(2) the re-stamp; 122 the cleared
-- deferral; the lease pair untouched, 121) — and the stat write repeats its
-- upsert (`ON CONFLICT (player_id, season, week)`, SETting exactly the
-- columns the caller sends — PostgREST's own semantics), so the door and the
-- pre-167 path write byte-identical lines.
--
-- DEPLOY BEFORE PUSH (TD15). Merged code reaches fieldscout.gg at once;
-- this migration waits for Chris's push. Until then `ingestWeek` calls the
-- door, gets PostgREST's PGRST202 for it (measured on the 166 stack
-- 2026-09-29: `Could not find the function public.ingest_write_batch(p_now,
-- p_rows) in the schema cache`, hint null) and writes through TODAY's
-- two-call path (queue, then stats — R706), saying so in its report and in
-- the live poll's problems; no event is recorded pre-push. A PGRST202 whose
-- hint offers the door under another signature (argument drift) is NOT
-- "missing" and throws (D426's `isDoorNotPushed`).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: 1 table (+ 2 indexes via its UNIQUE / §12.21's week index, RLS on,
--   1 SELECT policy, no write policy), 1 function (DEFINER, search_path '',
--   REVOKEd; service_role keeps EXECUTE). No trigger, cron row, column on an
--   existing table, or replaced body. Time only through p_now (no clock
--   read). Locks: one transaction-scoped advisory lock per (season, week),
--   so two concurrent polls of a week serialize (the second sees the first's
--   line and records nothing twice); the stored lines are read FOR UPDATE.
--   Typegen: the new table + function (additive). Realtime: none (L.E2.2's
--   league records broadcast; the events are not league data).
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–167 and the full pgTAP run in the PR. D38 — no backfill:
--   the past is not re-classified (no pre-167 history exists to diff; a
--   final week's later correction is caught by TD5's daily re-poll from the
--   push on).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. stat_correction_events (§12.21 + C80)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stat_correction_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season      INTEGER NOT NULL,
  week        INTEGER NOT NULL CHECK (week BETWEEN 1 AND 22),
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  stat_key    TEXT NOT NULL CHECK (stat_key ~ '^[a-z0-9_]{1,64}$'),
  old_value   NUMERIC,
  new_value   NUMERIC,
  detected_at TIMESTAMPTZ NOT NULL,
  applied_at  TIMESTAMPTZ,
  game_id     TEXT,
  week_state  TEXT NOT NULL CHECK (week_state IN ('open', 'final')),
  source      TEXT NOT NULL CHECK (btrim(source) <> ''),
  CONSTRAINT stat_correction_events_moved CHECK (old_value IS DISTINCT FROM new_value),
  CONSTRAINT stat_correction_events_natural_key UNIQUE (season, week, player_id, stat_key, detected_at)
);

CREATE INDEX IF NOT EXISTS idx_stat_corrections_week ON stat_correction_events(season, week);

COMMENT ON TABLE stat_correction_events IS
  '167 (L.E2.1, spec §12.21 / §23.4, tasks-M6 TD2): one row per (season, week, player, stat key) change the ingestion diff classified as a CORRECTION — a scoring stat of a line whose game was already final before the poll that saw it, or a first line for such a game. old_value = the stored value the door replaced (NULL = none stored — no line, or not delivered), new_value = what it wrote. Keys are the canonical registry namespace (D33). Written ONLY by ingest_write_batch (service role), in the same transaction as the line and its score_fanout enqueue. NFL data: SELECT for authenticated, no write policy.';
COMMENT ON COLUMN stat_correction_events.week_state IS
  '167: the NFL week''s state at detection — final iff its correction window has closed at p_now, every game still in the week is final by finalize_matchups'' own test (week_games_state_internal), and no in-season/playoff league still has the week open; else open. final ⇒ no league can re-score it (158''s lock); which league a correction changed is L.E2.2''s per-league record.';
COMMENT ON COLUMN stat_correction_events.applied_at IS
  '§12.21: when the league recompute fan-out for this event completed — stamped by L.E2.2 (M6). NULL until then.';
COMMENT ON COLUMN stat_correction_events.detected_at IS
  '167: the ingest door''s p_now (the poll''s injected instant) — no DEFAULT, never the wall clock. Part of the natural key: a replayed batch records nothing twice.';

ALTER TABLE stat_correction_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Stat corrections viewable by signed-in users" ON stat_correction_events;
CREATE POLICY "Stat corrections viewable by signed-in users"
  ON stat_correction_events FOR SELECT USING (auth.role() = 'authenticated');
-- No write policy for any role: ingest_write_batch (DEFINER, service role)
-- is the only writer. pgTAP 115 §B pins it per role with RETURNING counts.

-- ---------------------------------------------------------------------------
-- 2. ingest_write_batch — the one-transaction ingest door (F267, TD3)
--
-- p_rows: a JSON array, one element per player line of ONE (season, week):
--   { "stat":        { player_id, season, week, stat_type: "weekly", game_id,
--                      is_live, source, advanced, <every box column> },
--     "enqueue":     true | false,   -- a scoring delta (insert / update)
--     "corrections": [ {"stat_key": k, "column": c} | {"stat_key": k, "advanced": true}, … ] }
-- `stat` is `ingestWeek`'s upsert payload minus `updated_at` (the door stamps
-- p_now). Every element carries the SAME key set (the ingest surface), each
-- key a real `player_stats` column. `corrections` names the keys the caller
-- classified (TD2); only an enqueued element may carry any.
-- Returns {season, week, received, stats_written, enqueued, restamped,
--          events_written, events_replayed, events_unchanged, week_state}.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ingest_write_batch(
  p_rows JSONB,
  p_now  TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_meta      CONSTANT TEXT[] := ARRAY['advanced', 'game_id', 'is_live', 'player_id', 'season', 'source', 'stat_type', 'week'];
  v_n         INTEGER;
  v_i         INTEGER := 0;
  v_e         JSONB;
  v_stat      JSONB;
  v_cols      TEXT[];
  v_keys      TEXT[];
  v_bad       TEXT;
  v_season    INTEGER;
  v_week      INTEGER;
  v_pid       TEXT;
  v_players   TEXT[] := '{}';
  v_enqueue   TEXT[] := '{}';
  v_stats     JSONB;
  v_ncorr     INTEGER := 0;
  v_c         JSONB;
  v_ckeys     TEXT[];
  v_key       TEXT;
  v_col       TEXT;
  v_stored    JSONB;
  v_old       NUMERIC;
  v_new       NUMERIC;
  v_state     TEXT := NULL;
  v_sql       TEXT;
  v_cnt       INTEGER;
  v_written   INTEGER := 0;
  v_ev_new    INTEGER := 0;
  v_ev_dup    INTEGER := 0;
  v_ev_same   INTEGER := 0;
  v_fresh     INTEGER := 0;
  v_restamp   INTEGER := 0;
BEGIN
  -- The ingestion's door, never a user verb: a JWT-bearing or anon caller is
  -- refused in-body (rule 2 — the REVOKE below narrows EXECUTE; this says why).
  IF auth.uid() IS NOT NULL OR coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'ingest_write_batch: the ingest write door is the stats poll''s (service role), never a signed-in or anonymous caller''s'
      USING ERRCODE = '42501';
  END IF;

  -- (1) SHAPE (22023 — a malformed argument; nothing is written).
  IF p_rows IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'ingest_write_batch: p_rows and p_now are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'ingest_write_batch: p_rows must be a JSON array of {stat, enqueue, corrections} (got %)', jsonb_typeof(p_rows)
      USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_rows);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'ingest_write_batch: p_rows is empty — a batch carries at least one line' USING ERRCODE = '22023';
  END IF;

  FOR v_e IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' OR jsonb_typeof(v_e -> 'stat') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_e -> 'enqueue') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_e -> 'corrections') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'ingest_write_batch: element % must be {stat: object, enqueue: boolean, corrections: array}', v_i
        USING ERRCODE = '22023';
    END IF;
    v_stat := v_e -> 'stat';
    v_keys := ARRAY(SELECT k FROM jsonb_object_keys(v_stat) k ORDER BY k);
    IF v_i = 1 THEN
      -- The surface: every key a real player_stats column; id / updated_at
      -- are the table's and the door's; the ingest metadata all present.
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM unnest(v_keys) k
       WHERE k IN ('id', 'updated_at')
          OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                          WHERE a.attrelid = 'public.player_stats'::regclass AND a.attname = k
                            AND a.attnum > 0 AND NOT a.attisdropped);
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ingest_write_batch: element 1 carries key(s) the door does not write: % (id and updated_at are the table''s and the door''s; every other key must be a player_stats column)', v_bad
          USING ERRCODE = '22023';
      END IF;
      SELECT string_agg(m, ', ' ORDER BY m) INTO v_bad FROM unnest(c_meta) m WHERE m <> ALL (v_keys);
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ingest_write_batch: element 1 lacks the ingest metadata: %', v_bad USING ERRCODE = '22023';
      END IF;
      v_cols := v_keys;
      BEGIN
        v_season := (v_stat ->> 'season')::integer;
        v_week   := (v_stat ->> 'week')::integer;
      EXCEPTION WHEN invalid_text_representation THEN
        v_season := NULL;
      END;
      IF v_season IS NULL OR v_week IS NULL THEN
        RAISE EXCEPTION 'ingest_write_batch: element 1 has no integer season / week' USING ERRCODE = '22023';
      END IF;
    ELSIF v_keys IS DISTINCT FROM v_cols THEN
      RAISE EXCEPTION 'ingest_write_batch: element % carries a different key set from element 1 — every line of a batch carries the same surface', v_i
        USING ERRCODE = '22023';
    END IF;
    IF (v_stat ->> 'season') IS DISTINCT FROM v_season::text OR (v_stat ->> 'week') IS DISTINCT FROM v_week::text THEN
      RAISE EXCEPTION 'ingest_write_batch: element % is not season % week % — a batch is one (season, week)', v_i, v_season, v_week
        USING ERRCODE = '22023';
    END IF;
    IF (v_stat ->> 'stat_type') IS DISTINCT FROM 'weekly' THEN
      RAISE EXCEPTION 'ingest_write_batch: element % stat_type must be weekly', v_i USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_stat -> 'advanced') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'ingest_write_batch: element % advanced must be a JSON object', v_i USING ERRCODE = '22023';
    END IF;
    v_pid := v_stat ->> 'player_id';
    IF v_pid IS NULL OR btrim(v_pid) = '' THEN
      RAISE EXCEPTION 'ingest_write_batch: element % has no player_id', v_i USING ERRCODE = '22023';
    END IF;
    IF v_pid = ANY (v_players) THEN
      RAISE EXCEPTION 'ingest_write_batch: player % appears twice in the batch', v_pid USING ERRCODE = '22023';
    END IF;
    v_players := v_players || v_pid;
    IF (v_e ->> 'enqueue')::boolean THEN
      v_enqueue := v_enqueue || v_pid;
    ELSIF jsonb_array_length(v_e -> 'corrections') > 0 THEN
      RAISE EXCEPTION 'ingest_write_batch: element % (%) carries corrections but is not enqueued — a correction is a scoring delta', v_i, v_pid
        USING ERRCODE = '22023';
    END IF;
    -- Each correction names a canonical key and WHERE it is stored (a box
    -- column of this surface, or the advanced JSONB), once per element.
    v_ckeys := '{}';
    FOR v_c IN SELECT value FROM jsonb_array_elements(v_e -> 'corrections') LOOP
      v_key := v_c ->> 'stat_key';
      IF jsonb_typeof(v_c) <> 'object' OR v_key IS NULL OR v_key !~ '^[a-z0-9_]{1,64}$' THEN
        RAISE EXCEPTION 'ingest_write_batch: element % (%) has a correction without a canonical stat_key', v_i, v_pid USING ERRCODE = '22023';
      END IF;
      IF v_key = ANY (v_ckeys) THEN
        RAISE EXCEPTION 'ingest_write_batch: element % (%) names correction % twice', v_i, v_pid, v_key USING ERRCODE = '22023';
      END IF;
      v_ckeys := v_ckeys || v_key;
      IF (v_c ? 'column') = (coalesce(v_c ->> 'advanced', 'false') = 'true') THEN
        RAISE EXCEPTION 'ingest_write_batch: element % (%) correction % must name exactly one of column / advanced', v_i, v_pid, v_key USING ERRCODE = '22023';
      END IF;
      IF v_c ? 'column' AND ((v_c ->> 'column') = ANY (c_meta) OR (v_c ->> 'column') <> ALL (v_cols)) THEN
        RAISE EXCEPTION 'ingest_write_batch: element % (%) correction % names column % — not a stat column of this batch', v_i, v_pid, v_key, v_c ->> 'column'
          USING ERRCODE = '22023';
      END IF;
      v_ncorr := v_ncorr + 1;
    END LOOP;
  END LOOP;
  v_stats := (SELECT jsonb_agg(value -> 'stat' ORDER BY ordinality) FROM jsonb_array_elements(p_rows) WITH ORDINALITY);

  -- (2) THE WEEK'S LOCK: two polls of one week serialize here, so the second
  --     reads the first's lines and records nothing twice.
  PERFORM pg_advisory_xact_lock(hashtextextended('ingest_write_batch:' || v_season || ':' || v_week, 0));

  -- (3) THE EVENTS — old from the stored line (read FOR UPDATE, before the
  --     write), new from the line being written. Only when any are named.
  IF v_ncorr > 0 THEN
    v_state := CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.nfl_weeks w
                        WHERE w.season = v_season AND w.week = v_week
                          AND w.correction_window_ends_at IS NOT NULL AND w.correction_window_ends_at <= p_now)
        OR NOT coalesce((SELECT s.all_final FROM public.week_games_state_internal(v_season, v_week) s), false)
        OR EXISTS (SELECT 1 FROM public.league_weeks lw JOIN public.leagues l ON l.id = lw.league_id
                    WHERE lw.season = v_season AND lw.week = v_week AND lw.status <> 'final'
                      AND l.status IN ('in_season', 'playoffs') AND l.deleted_at IS NULL)
      THEN 'open' ELSE 'final' END;

    FOR v_e IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      CONTINUE WHEN jsonb_array_length(v_e -> 'corrections') = 0;
      v_stat := v_e -> 'stat';
      v_pid  := v_stat ->> 'player_id';
      SELECT to_jsonb(ps) INTO v_stored FROM public.player_stats ps
       WHERE ps.player_id = v_pid AND ps.season = v_season AND ps.week = v_week
       FOR UPDATE;
      FOR v_c IN SELECT value FROM jsonb_array_elements(v_e -> 'corrections') LOOP
        v_key := v_c ->> 'stat_key';
        v_col := v_c ->> 'column';
        BEGIN
          IF v_col IS NOT NULL THEN
            v_old := (v_stored ->> v_col)::numeric;
            -- R1317: a STORED line's NULL box column reads as the column's
            -- DEFAULT (0) — what the scorer and ingestWeek's `readStats`
            -- read — except a column with NO default (143's
            -- `def_yards_allowed`: NULL is "not delivered", F390), which
            -- stays NULL. No stored line at all (a gap filled late) stays NULL.
            IF v_old IS NULL AND v_stored IS NOT NULL THEN
              v_old := (SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
                          FROM pg_catalog.pg_attrdef d
                          JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                         WHERE d.adrelid = 'public.player_stats'::regclass AND a.attname = v_col)::numeric;
            END IF;
            v_new := (v_stat ->> v_col)::numeric;
          ELSE
            v_old := (v_stored -> 'advanced' ->> v_key)::numeric;
            v_new := (v_stat -> 'advanced' ->> v_key)::numeric;
          END IF;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'ingest_write_batch: %''s % is not a number', v_pid, v_key USING ERRCODE = '22023';
        END;
        IF v_old IS NOT DISTINCT FROM v_new THEN
          v_ev_same := v_ev_same + 1;   -- the stored line already says it (a concurrent poll landed it first)
          CONTINUE;
        END IF;
        INSERT INTO public.stat_correction_events
          (season, week, player_id, stat_key, old_value, new_value, detected_at, game_id, week_state, source)
        VALUES
          (v_season, v_week, v_pid, v_key, v_old, v_new, p_now, v_stat ->> 'game_id', v_state, v_stat ->> 'source')
        ON CONFLICT ON CONSTRAINT stat_correction_events_natural_key DO NOTHING;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt = 1 THEN v_ev_new := v_ev_new + 1; ELSE v_ev_dup := v_ev_dup + 1; END IF;
      END LOOP;
    END LOOP;
  END IF;

  -- (4) THE LINES — ingestWeek's upsert, SETting exactly the columns sent
  --     (PostgREST's semantics), stamped p_now (the readiness predicate).
  --     Every identifier was checked against pg_attribute above and is %I-quoted.
  v_sql := format(
    'INSERT INTO public.player_stats (%s, updated_at) SELECT %s, $2 FROM jsonb_populate_recordset(NULL::public.player_stats, $1) '
    || 'ON CONFLICT (player_id, season, week) DO UPDATE SET %s, updated_at = EXCLUDED.updated_at',
    (SELECT string_agg(format('%I', k), ', ' ORDER BY k) FROM unnest(v_cols) k),
    (SELECT string_agg(format('%I', k), ', ' ORDER BY k) FROM unnest(v_cols) k),
    (SELECT string_agg(format('%1$I = EXCLUDED.%1$I', k), ', ' ORDER BY k) FROM unnest(v_cols) k
      WHERE k NOT IN ('player_id', 'season', 'week')));
  EXECUTE v_sql USING v_stats, p_now;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  IF v_written <> v_n THEN
    RAISE EXCEPTION 'ingest_write_batch: wrote % of % lines — refusing to call that success', v_written, v_n;
  END IF;

  -- (5) THE QUEUE — ingestWeek's enqueue: one row per (season, week, player)
  --     (D292), re-stamped to this instant (D321(2)), the deferral cleared
  --     (122); the lease pair untouched (121).
  IF cardinality(v_enqueue) > 0 THEN
    WITH w AS (
      INSERT INTO public.score_fanout AS q (season, week, player_id, enqueued_at, deferred_until)
      SELECT v_season, v_week, x.pid, p_now, NULL FROM unnest(v_enqueue) AS x(pid)
      ON CONFLICT (season, week, player_id) DO UPDATE SET enqueued_at = EXCLUDED.enqueued_at, deferred_until = NULL
      RETURNING (q.xmax = 0) AS fresh
    )
    SELECT count(*) FILTER (WHERE fresh), count(*) FILTER (WHERE NOT fresh) INTO v_fresh, v_restamp FROM w;
    IF v_fresh + v_restamp <> cardinality(v_enqueue) THEN
      RAISE EXCEPTION 'ingest_write_batch: enqueued % of % deltas — refusing to call that success', v_fresh + v_restamp, cardinality(v_enqueue);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'season',           v_season,
    'week',             v_week,
    'received',         v_n,
    'stats_written',    v_written,
    'enqueued',         v_fresh,
    'restamped',        v_restamp,
    'events_written',   v_ev_new,
    'events_replayed',  v_ev_dup,
    'events_unchanged', v_ev_same,
    'week_state',       v_state);
END;
$$;

REVOKE EXECUTE ON FUNCTION ingest_write_batch(JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_write_batch(JSONB, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION ingest_write_batch(JSONB, TIMESTAMPTZ) IS
  '167 (L.E2.1, F267, tasks-M6 TD3): the stats poll''s one-transaction write — a batch''s player_stats lines, their stat_correction_events (old from the stored line under the week''s advisory lock, new from the line written) and their score_fanout enqueue (re-stamp + cleared deferral), all stamped p_now. Service role only (in-body 42501 + REVOKE). Writes no league table: a final week is never re-scored here (the worker''s week_final, 158''s lock).';
