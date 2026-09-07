-- ============================================================================
-- In-season realtime + the scoring write door — migration 119 (task L.D1.9;
-- spec v2.16.27 §9 (the v2.0 transport rule, §9.1 "one compact
-- scores_updated event per league per batch", §9.2 pattern + "nothing
-- blind", §9.3), §11.4 (live scoring, server-materialized), §12.14 (the
-- trigger inventory — this migration's rows), §22.2 (single UPDATE per
-- matchup ⇒ one event per league; overridden cells never auto-recomputed),
-- §23.2/§23.4 (D295's window semantics), E61 (pending is NULL, never 0);
-- PROGRESS D292 / D295 / D296 / D298 / D313 / D318 / D319; ledger F9, F42,
-- F224(d), F233(c), F241(a), F248(a)/(c), F252(a), F254(a), F257(a)/(a′),
-- F258; tasks-M4 §4 rules 1–11 (rule 7 — Broadcast-from-DB via
-- realtime.send, private topics, NO Postgres Changes — binds hardest here).
--
-- Numbering: migration head measured 118 at task time (`ls
-- supabase/migrations | tail -1`) ⇒ 119; pgTAP head 066 ⇒ 067 (D161/D166 —
-- §7's "~~117~~ → +1" was a reservation; D319(1)).
--
-- What ships here:
--   1. Column-select payload functions (070's form — plain, STABLE,
--      triple-REVOKEd, one per broadcast table, exact key sets pinned in
--      067 with NAMED negatives): matchups / team_week_results /
--      transactions / league_weeks. Nothing blind (§9.2): no
--      scoring snapshot, no per-player lines (§9.1: box scores are REST,
--      re-fetched on the event), no override/related action ids, no raw
--      transaction payload (claim/bid amounts — M5 — can never leak through
--      a column-select that never forwards the blob), no league_id (the
--      topic identifies the league).
--   2. The D296 triggers on `league:<league_id>` (070's envelope
--      {operation, table, schema, record}; event = the table name — the
--      client's dispatch key, `LEAGUE_CHANNEL_EVENTS`):
--        * matchups — per-STATEMENT, three single-event triggers (INSERT /
--          UPDATE / DELETE — PostgreSQL refuses transition tables on a
--          multi-event trigger, measured on the local 17.6) sharing one
--          function: ONE event per league per statement, `record` = the
--          statement's column-selected rows (+ season / week / count).
--          THIS is the `scores_updated` carrier (§9.1): the door below
--          writes a league-week batch in ONE UPDATE statement, so a batch
--          is one event however many matchups it moved (§22.2's coalesce
--          rule; the 088 per-STATEMENT summary precedent). An UPDATE that
--          changes nothing has an EMPTY transition table and sends NOTHING
--          (the idempotent re-send is silent — pinned). INSERT/DELETE ride
--          the same function so a Remix (111: DELETE + INSERT) and a
--          bracket (re)build (118: DELETE + INSERT) reach an open schedule
--          page — the reason F254(a)'s `league_chat` stand-in can retire.
--          A `week` is carried only when the statement touched ONE week
--          (a whole-season INSERT carries NULL — the client's reducer
--          refetches conservatively on a missing week, R773).
--        * team_week_results — per-STATEMENT INSERT + UPDATE (finalization
--          writes a week's rows in one INSERT … ON CONFLICT and one median
--          UPDATE — 117/118; the rebuild the same; the door's total_points
--          provisional rows one INSERT … ON CONFLICT): one event per
--          league per statement, `record` = the rows + `is_final`.
--        * transactions — per-ROW AFTER INSERT (append-only; one move is
--          one row is one event — the activity feed's carrier, D310(4)).
--        * league_weeks — per-ROW AFTER UPDATE OF status (the "week is
--          final" moment; a `median_score`-only write emits nothing —
--          the 070 leagues discriminator, pinned).
--      Channel auth: 070's `realtime.messages` READ policy already covers
--      the `league:%` family — no policy change; 067 pins member-reads /
--      non-member-zero on the new events and the vitest proves it at the
--      wire. The supabase_realtime publication carries none of the four
--      (D89 — pinned).
--   3. F42 dispositioned PER TABLE (D296): `league_weeks` gains its
--      subscriber here (L.D4.1's matchups/standings hooks, L.D5.3's
--      schedule) and `transactions` its feed (L.D4.2) — both get triggers.
--      `league_members` / `team_managers` / `teams` / `league_invites` /
--      `league_lists` still have NO subscriber and are RE-WAIVED per table
--      on the D38 rationale (a trigger ships with its first subscriber);
--      pgTAP 024's F42 pin shrinks to that set (edited in place, the
--      "tests are tests" D137 note) and 067 pins it again beside the new
--      inventory. F9 DECIDED (D296): `nfl_weeks` stays TRIGGER-LESS — it is
--      global reference data with zero subscribers; clients learn week
--      state through `league_weeks` (which now broadcasts) and every lock
--      is server-evaluated (D291) — pinned with the reason. F224(d)/
--      F248(c) DECIDED: `team_lineups` stays trigger-less in M4 — the
--      editor renders the server's canonical map after its own submit
--      (L.D5.1) and the matchup view's opponent lineup (L.D5.2, unbuilt)
--      is the only would-be subscriber; the trigger ships with it if it
--      wants live lineup changes (pinned trigger-less with the reason).
--   4. F252(a) DECIDED — `league_player_pool` broadcasts, as ONE coalesced
--      per-league SUMMARY from `lineup_lock_tick` (below), NOT a row
--      trigger: the tick's pool UPDATE is diff-aware (116: `IS DISTINCT
--      FROM`), so the send fires only on a pass that changed ≥ 1 row (a
--      kickoff or a release instant) and never on a quiet minute; a row
--      trigger would be one event per locked player per league at every
--      slate kickoff — the storm §22.2 coalesces away. Event name = the
--      table's (the 088 summary precedent; `operation` UPDATE; `record`
--      {season, week, changed, at}). The client's rosters predicate gains
--      it (D319(6)); L.D5.1's 60 s poll can retire — F259(a), L.D5.4's.
--      `league_player_pool` has NO table trigger (pinned).
--   5. `score_write_week_batch(p_league_id, p_week, p_scores)` — THE ONE
--      scoring write door (D292/§5; the worker's — L.D2.2 — sole path to
--      `matchups` / `team_week_results`). SECURITY DEFINER, search_path
--      '', service-role only (the 116 shape: REVOKE from PUBLIC / anon /
--      authenticated + the in-body JWT refusal — no manager path, ever).
--      Revalidates IN-BODY, refusing by name: league `in_season` /
--      `playoffs` (P0001 `league_not_in_season`); the week's `league_weeks`
--      row exists (P0001 `week_not_scheduled`), is not `final` (P0001
--      `week_final` — D295(b): after finalization a post-window delta
--      changes NO league cell) and is OPEN (P0001 `week_not_open` for
--      `upcoming` — a score for a week that has not opened is a mapping
--      error, and §23.3 forbids inferring "current week": the week's own
--      status is the datum); every team is this league's (P0002); the
--      batch is well-formed (22023: an array of {team_id, points} —
--      `points` a JSON number with AT MOST TWO DECIMALS or null; the
--      worker rounds (F22), the DB never does — a 3-dp value is refused,
--      never rounded; no duplicate team). PER-ROW protections SKIP BY
--      NAME rather than refuse the batch (D319(3)): a `final` matchup
--      (`matchup_final`) and an `is_overridden` row (`overridden` —
--      §22.2; THE DoD PROBE TARGET) are never written while their siblings
--      are; a team with no row this week (an eliminated playoff seat, a
--      bye-less week — `no_matchup_row`) is named, not an error. Rows are
--      resolved by (league, season, week, side team) IN THE WRITE
--      STATEMENT — never by a cached `matchups.id` (F257(a′): a bracket
--      rebuild mints new ids; the door addresses the pairing). The write
--      is ONE UPDATE statement per batch touching each writable row ONCE
--      with both cells coalesced (a row whose cells would not change is
--      left out — numeric equality, scale-blind), so the statement trigger
--      emits ONE `matchups` event per league per batch, and an identical
--      re-send writes ZERO rows and emits NOTHING (rule 10 — the reason
--      named: `no_change`; a batch whose every row is protected says
--      `nothing_writable`). E61: `points: null` writes NULL — the ONLY
--      pending word (F241(a)); a cell of a team NOT in the batch is never
--      touched (109's `DEFAULT 0` on an unscored bracket cell stays what
--      it is — the door never writes 0 for "no data" and never turns a
--      written score into 0; the sentinel's READING is 118's sync's,
--      F257(a) — not replaced here, F258's owner). `status` / `result` are
--      never written (the advance job flips `scheduled → live` at open,
--      finalize writes `result` — F241(a)). `total_points` leagues have no
--      matchups: the door writes PROVISIONAL `team_week_results` rows
--      (`is_final = FALSE`, `points`) — one INSERT … ON CONFLICT DO UPDATE
--      (changed rows only; a final row never overwritten — a reopened
--      week, M6); `points: null` writes NO row there (the row's ABSENCE is
--      that mode's pending word — F241(b); named `pending_no_row`).
--      `updated_at = now()` is the transaction instant (the 111/113
--      precedent: a writer verb, not a job — no `p_now`; the door
--      evaluates no calendar).
--   6. `lineup_lock_tick` CREATE OR REPLACE'd against 116's FILE TEXT
--      (D137 — 116 is its only defining migration; md5 3728ee39… asserted
--      by `derive_119.py` in the PR body; five exact hunks each hit once;
--      `verify` mode asserts this file carries the body byte-for-byte):
--      the per-league `v_pool_changed` counter, the ONE `realtime.send`
--      after the pool loop, `pool_events` on the report. Behaviour
--      otherwise byte-identical — pgTAP 064 ran unchanged and green
--      against the replaced body BEFORE 067 was written (the D314(2)
--      precedent).
--
-- Engineering notes:
--   * realtime.send() traps its own errors (070 banner) — a realtime
--     outage can never fail a score write or a tick; it injects an 'id'
--     key into the payload when absent (067's stored-payload pins account
--     for it, as 024's do).
--   * The statement-level triggers group the transition table BY
--     league_id — one send per league even if a statement ever spans
--     leagues (no writer does today; the grouping makes the claim true
--     rather than assumed, D276).
--   * Finalization (118's `finalize_matchups`) flips matchup `status`
--     per row in a loop — N single-row UPDATE statements ⇒ N `matchups`
--     events at that moment, once per week per league; recorded, not
--     coalesced here (F259(b)) — the D292 ONE-event claim is the DOOR's
--     (the every-few-seconds path), pinned by count.
--   * Lock discipline (rule 8): the door takes the league row FOR UPDATE
--     first (lock order `leagues` first), which serializes it with the
--     jobs (they SKIP LOCKED a held league and retry) — held < 50 ms,
--     asserted in 067.
--
-- Grants doctrine (tasks-M1 §4.1, D18→D23): no per-object GRANT; every
-- function REVOKEd from PUBLIC/anon/authenticated (service_role keeps the
-- platform default EXECUTE — 067 pins it positively). No table grant
-- changes; no RLS change (the four tables keep 109's member SELECT + no
-- client write policy). Staging rehearsal: R6 waiver — no staging clone;
-- rehearsal evidence = the fresh local `db reset` 001–119 + pgTAP 067 +
-- the stack vitest `inseason-realtime-db.test.ts` in the same PR.
-- HELD-FROM-PRODUCTION: 082-118 → 082-119 (same PR).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column-select payload functions (§9.2 "nothing blind"; 070's form).
--    STABLE (timestamptz encoding reads the TimeZone GUC); plain internals,
--    triple-REVOKEd; called only by the trigger functions below and pgTAP.
-- ---------------------------------------------------------------------------

-- matchups → what a matchup card / schedule grid / bracket renders: the
-- pairing (ids, seeds), the two cells, status/result, the override flag,
-- `updated_at` (the §9.3 version hint). NOT: override_action_id (audit),
-- league_id (the topic), created_at, and — by construction — nothing per
-- player (§9.1: lines are REST).
CREATE OR REPLACE FUNCTION matchup_broadcast_payload(m matchups)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',            m.id,
    'season',        m.season,
    'week',          m.week,
    'round_type',    m.round_type,
    'home_team_id',  m.home_team_id,
    'away_team_id',  m.away_team_id,
    'home_seed',     m.home_seed,
    'away_seed',     m.away_seed,
    'home_score',    m.home_score,
    'away_score',    m.away_score,
    'status',        m.status,
    'result',        m.result,
    'is_overridden', m.is_overridden,
    'updated_at',    m.updated_at);
$$;

REVOKE EXECUTE ON FUNCTION matchup_broadcast_payload(matchups)
  FROM PUBLIC, anon, authenticated;

-- team_week_results → the standings-row inputs (§12.18). NOT: id (the
-- (team, week) pair identifies the row), league_id.
CREATE OR REPLACE FUNCTION team_week_result_broadcast_payload(r team_week_results)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'team_id',                 r.team_id,
    'season',                  r.season,
    'week',                    r.week,
    'points',                  r.points,
    'opponent_team_id',        r.opponent_team_id,
    'h2h_result',              r.h2h_result,
    'median_result',           r.median_result,
    'second_opponent_team_id', r.second_opponent_team_id,
    'second_result',           r.second_result,
    'is_final',                r.is_final);
$$;

REVOKE EXECUTE ON FUNCTION team_week_result_broadcast_payload(team_week_results)
  FROM PUBLIC, anon, authenticated;

-- transactions → §5/D296's "type, teams, players — never claim/bid
-- amounts": id (the feed's list key), type, status, the initiating team,
-- week, timestamp, and the two player ids lifted from 113's normalized
-- payload. The payload BLOB itself is never forwarded (M5's waiver/FAAB
-- rows will carry amounts there; a column-select that never reads the
-- blob cannot leak them). NOT: action_id (another client's idempotency
-- key), related_action_id (audit), initiated_by, league_id.
CREATE OR REPLACE FUNCTION transaction_broadcast_payload(t transactions)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',                t.id,
    'type',              t.type,
    'status',            t.status,
    'initiator_team_id', t.initiator_team_id,
    'week',              t.week,
    'add_player_id',     t.payload ->> 'add_player_id',
    'drop_player_id',    t.payload ->> 'drop_player_id',
    'created_at',        t.created_at);
$$;

REVOKE EXECUTE ON FUNCTION transaction_broadcast_payload(transactions)
  FROM PUBLIC, anon, authenticated;

-- league_weeks → the status ladder the schedule/matchup views render, the
-- median line, the finalization instant. NOT: reopened_by_action_id
-- (audit), waivers_processed_at (M5's), id, league_id.
CREATE OR REPLACE FUNCTION league_week_broadcast_payload(w league_weeks)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'season',       w.season,
    'week',         w.week,
    'status',       w.status,
    'median_score', w.median_score,
    'finalized_at', w.finalized_at);
$$;

REVOKE EXECUTE ON FUNCTION league_week_broadcast_payload(league_weeks)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions (§9.2 pattern: SECURITY DEFINER, search_path = '',
--    RETURN NULL) + triggers
-- ---------------------------------------------------------------------------

-- matchups — per-STATEMENT summary, one send per league in the transition
-- table (empty ⇒ nothing). The transition table's name is fixed per
-- trigger (`changed_rows` on all three) and read by TG_OP.
CREATE OR REPLACE FUNCTION broadcast_matchups_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lg RECORD;
BEGIN
  FOR v_lg IN
    SELECT c.league_id,
           min(c.season)                                              AS season,
           CASE WHEN count(DISTINCT c.week) = 1 THEN min(c.week) END  AS week,
           count(*)::int                                              AS n,
           jsonb_agg(public.matchup_broadcast_payload(c)
                     ORDER BY c.week, c.round_type, c.id)             AS rows_
    FROM changed_rows c
    GROUP BY c.league_id
    ORDER BY c.league_id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'operation', TG_OP,
        'table',     TG_TABLE_NAME,
        'schema',    TG_TABLE_SCHEMA,
        'record',    jsonb_build_object(
          'season',   v_lg.season,
          'week',     v_lg.week,
          'count',    v_lg.n,
          'matchups', v_lg.rows_)),
      'matchups',
      'league:' || v_lg.league_id::text,
      true);
  END LOOP;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_matchups_statement()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_matchups_insert
  AFTER INSERT ON matchups
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION broadcast_matchups_statement();

CREATE TRIGGER tr_broadcast_matchups_update
  AFTER UPDATE ON matchups
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION broadcast_matchups_statement();

CREATE TRIGGER tr_broadcast_matchups_delete
  AFTER DELETE ON matchups
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION broadcast_matchups_statement();

-- team_week_results — per-STATEMENT summary (finalization / rebuild /
-- the door's provisional rows), one send per league; `is_final` = every
-- row of the statement is final (the standings' refetch cue).
CREATE OR REPLACE FUNCTION broadcast_team_week_results_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lg RECORD;
BEGIN
  FOR v_lg IN
    SELECT c.league_id,
           min(c.season)                                              AS season,
           CASE WHEN count(DISTINCT c.week) = 1 THEN min(c.week) END  AS week,
           count(*)::int                                              AS n,
           bool_and(c.is_final)                                       AS all_final,
           jsonb_agg(public.team_week_result_broadcast_payload(c)
                     ORDER BY c.week, c.team_id)                      AS rows_
    FROM changed_rows c
    GROUP BY c.league_id
    ORDER BY c.league_id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'operation', TG_OP,
        'table',     TG_TABLE_NAME,
        'schema',    TG_TABLE_SCHEMA,
        'record',    jsonb_build_object(
          'season',   v_lg.season,
          'week',     v_lg.week,
          'count',    v_lg.n,
          'is_final', v_lg.all_final,
          'results',  v_lg.rows_)),
      'team_week_results',
      'league:' || v_lg.league_id::text,
      true);
  END LOOP;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_team_week_results_statement()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_team_week_results_insert
  AFTER INSERT ON team_week_results
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION broadcast_team_week_results_statement();

CREATE TRIGGER tr_broadcast_team_week_results_update
  AFTER UPDATE ON team_week_results
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION broadcast_team_week_results_statement();

-- transactions — per-ROW INSERT (append-only, 113; one move = one event).
CREATE OR REPLACE FUNCTION broadcast_transaction_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.transaction_broadcast_payload(NEW)),
    'transactions',
    'league:' || NEW.league_id::text,
    true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_transaction_insert()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_transactions
  AFTER INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION broadcast_transaction_insert();

-- league_weeks — per-ROW, column-triggered on `status` ONLY (a
-- median_score / finalized_at / waivers_processed_at write that leaves the
-- status alone emits nothing — 070's leagues discriminator).
CREATE OR REPLACE FUNCTION broadcast_league_week_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.league_week_broadcast_payload(NEW)),
    'league_weeks',
    'league:' || NEW.league_id::text,
    true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_league_week_status()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_league_weeks
  AFTER UPDATE OF status ON league_weeks
  FOR EACH ROW EXECUTE FUNCTION broadcast_league_week_status();

-- F42 re-waived per table (D296): league_members / team_managers / teams /
-- league_invites / league_lists — no trigger (no subscriber; pinned 024 +
-- 067). F9 decided: nfl_weeks — no trigger, ever in M4 (global reference
-- data; pinned with the reason in 067). F224(d)/F248(c) decided:
-- team_lineups — no trigger in M4 (pinned). league_player_pool — no TABLE
-- trigger; its one coalesced broadcast is the tick's (§4 below; pinned).

-- ---------------------------------------------------------------------------
-- 3. score_write_week_batch — THE ONE scoring write door (D292/§5)
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
    'reason', CASE
      WHEN v_writable = 0 THEN 'nothing_writable'   -- every touched row protected / every team pending or row-less
      WHEN v_written = 0  THEN 'no_change'          -- the identical re-send: zero writes, zero events
      ELSE NULL END);
END;
$$;

REVOKE EXECUTE ON FUNCTION score_write_week_batch(UUID, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. lineup_lock_tick — CREATE OR REPLACE against 116's FILE TEXT (D137):
--    the one coalesced league_player_pool broadcast per league per pass.
--    Derived by derive_119.py (PR body): 116 md5 3728ee39c2fb305baa974357150a9668,
--    five hunks (DECLARE · per-league reset · the changed counter · the
--    send after the pool loop · `pool_events` on the report), each asserted
--    to hit exactly once; `verify` asserts the body below byte-for-byte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_lock_tick(
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
  v_seen           UUID[] := '{}';
  v_loops          INTEGER := 0;
  v_pass           INTEGER;
  v_lg             RECORD;
  v_league         public.leagues;
  v_current        INTEGER;
  v_pool           RECORD;
  v_lock           JSONB;
  v_new_until      TIMESTAMPTZ;
  v_new_state      TEXT;
  v_row            RECORD;
  v_e              JSONB;
  v_pid            TEXT;
  v_team           TEXT;
  v_k              RECORD;
  v_new_locked_at  TIMESTAMPTZ;
  v_new_starters   JSONB;
  v_changed        BOOLEAN;
  v_cnt            INTEGER;
  v_leagues        INTEGER := 0;
  v_pool_rows      INTEGER := 0;
  v_pool_updates   INTEGER := 0;
  v_lineups        INTEGER := 0;
  v_lineup_updates INTEGER := 0;
  v_pool_changed   INTEGER := 0;   -- 119: THIS league's pool rows changed this pass — the coalescing key (D296/F252(a))
  v_pool_events    INTEGER := 0;   -- 119: pool broadcasts sent this run (one per league per pass that changed ≥ 1 row)
  v_skipped        JSONB := '[]'::jsonb;
  v_failures       JSONB := '[]'::jsonb;
BEGIN
  -- A job, not a user verb: a JWT-bearing caller is refused in-body (rule 2
  -- — the REVOKE below narrows EXECUTE; this says why in the body).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'lineup_lock_tick: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      BEGIN
        v_pool_changed := 0;
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;
        v_current := public.lineup_current_week_internal(v_lg.id, p_now);
        IF v_current IS NULL THEN
          v_skipped := v_skipped || jsonb_build_object('league_id', v_lg.id, 'reason', 'no_league_weeks');
          CONTINUE;
        END IF;

        -- (a) THE POOL VIEW — what 115's helper says, and nothing else.
        FOR v_pool IN
          SELECT pp.player_id, pp.state, pp.locked_until, p.team AS nfl_team
          FROM public.league_player_pool pp
          JOIN public.players p ON p.id = pp.player_id
          WHERE pp.league_id = v_lg.id
          ORDER BY pp.player_id
        LOOP
          v_pool_rows := v_pool_rows + 1;
          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);
          IF (v_lock ->> 'locked')::boolean THEN
            -- Locked: until the week's recorded last game end — or 'infinity'
            -- while that end is NOT YET RECORDED (F238's loud state; never a
            -- NULL that reads as unlocked, never a release the helper did
            -- not compute).
            v_new_until := COALESCE((v_lock ->> 'window_ends_at')::timestamptz, 'infinity'::timestamptz);
          ELSE
            v_new_until := NULL;
          END IF;
          v_new_state := CASE
            WHEN v_pool.state = 'free_agent'     AND v_new_until IS NOT NULL THEN 'locked_in_game'
            WHEN v_pool.state = 'locked_in_game' AND v_new_until IS NULL     THEN 'free_agent'
            ELSE v_pool.state END;   -- on_waivers / rostered keep their state (F222(a) CHECK; D294 mirror)
          IF v_new_until IS DISTINCT FROM v_pool.locked_until
             OR v_new_state IS DISTINCT FROM v_pool.state THEN
            UPDATE public.league_player_pool pp
            SET locked_until = v_new_until, state = v_new_state, updated_at = p_now
            WHERE pp.league_id = v_lg.id AND pp.player_id = v_pool.player_id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: pool refresh for % touched % rows, expected 1', v_pool.player_id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_pool_updates := v_pool_updates + 1;
            v_pool_changed := v_pool_changed + 1;
          END IF;
        END LOOP;

        -- 119 (D296 / F252(a)): the pool's ONE broadcast — a per-league
        -- SUMMARY sent once per pass, only when this pass changed at least
        -- one pool row (a kickoff or a release instant; the guarded UPDATE
        -- above is diff-aware, so a quiet minute sends nothing). Never a
        -- row trigger (a slate kickoff would be one event per locked
        -- player per league — the broadcast storm §22.2 coalesces away),
        -- never per-player lines: the client refetches the rosters route.
        -- The 088 per-STATEMENT summary precedent: event = the table's
        -- name, `operation` UPDATE, `record` = the summary. realtime.send
        -- traps its own errors (070 banner) — an outage never fails a tick.
        IF v_pool_changed > 0 THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'operation', 'UPDATE',
              'table',     'league_player_pool',
              'schema',    'public',
              'record',    jsonb_build_object(
                'season',  v_league.season,
                'week',    v_current,
                'changed', v_pool_changed,
                'at',      p_now)),
            'league_player_pool',
            'league:' || v_lg.id::text,
            true);
          v_pool_events := v_pool_events + 1;
        END IF;

        -- (b) THE LINEUP RECORD — locked_at + each starter's kickoff_at,
        --     re-evaluated from nfl_games at p_now (E42: a moved kickoff
        --     moves the record; E43: a postponed-out kickoff releases it).
        FOR v_row IN
          SELECT tl.id, tl.week, tl.starters, tl.locked_at
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id
          JOIN public.league_weeks lw
            ON lw.league_id = t.league_id AND lw.season = tl.season AND lw.week = tl.week
          WHERE t.league_id = v_lg.id
            AND tl.season = v_league.season
            AND tl.week <= v_current
            AND lw.status <> 'final'
            AND tl.slot_map IS NOT NULL
          ORDER BY tl.week, tl.team_id
        LOOP
          v_lineups := v_lineups + 1;
          v_new_locked_at := NULL;
          v_new_starters := '[]'::jsonb;
          v_changed := FALSE;
          FOR v_e IN SELECT * FROM jsonb_array_elements(v_row.starters) LOOP
            v_pid := v_e ->> 'player_id';
            IF v_pid IS NULL THEN
              v_new_starters := v_new_starters || v_e;
              CONTINUE;
            END IF;
            SELECT p.team INTO v_team FROM public.players p WHERE p.id = v_pid;
            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);
            -- Compare INSTANTS, not rendered text (a session TimeZone renders
            -- the same instant differently — idempotence must not depend on it).
            IF (v_e ->> 'kickoff_at')::timestamptz IS DISTINCT FROM v_k.kickoff_at THEN
              v_changed := TRUE;
              v_new_starters := v_new_starters || (v_e || jsonb_build_object('kickoff_at', v_k.kickoff_at));
            ELSE
              v_new_starters := v_new_starters || v_e;
            END IF;
            IF v_k.kickoff_at IS NOT NULL THEN
              v_new_locked_at := LEAST(v_new_locked_at, v_k.kickoff_at);
            END IF;
          END LOOP;
          IF v_changed OR v_new_locked_at IS DISTINCT FROM v_row.locked_at THEN
            UPDATE public.team_lineups tl
            SET locked_at = v_new_locked_at,
                starters  = CASE WHEN v_changed THEN v_new_starters ELSE tl.starters END
            WHERE tl.id = v_row.id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: lineup record refresh for % touched % rows, expected 1', v_row.id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_lineup_updates := v_lineup_updates + 1;
          END IF;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'lineup_lock_tick failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',             p_now,
    'scope',          p_league_id,
    'leagues',        v_leagues,
    'pool_rows',      v_pool_rows,
    'pool_updates',   v_pool_updates,
    'pool_events',    v_pool_events,
    'lineups',        v_lineups,
    'lineup_updates', v_lineup_updates,
    'skipped',        v_skipped,
    'failures',       v_failures,
    'loops',          v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'no_in_season_leagues'
      WHEN v_pool_updates + v_lineup_updates = 0 THEN 'no_changes'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_lock_tick(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;
