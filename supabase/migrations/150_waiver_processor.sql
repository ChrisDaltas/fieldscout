-- ============================================================================
-- 150_waiver_processor.sql — the `process-waivers` processor + `waiver_tick`
-- (M5 task L.D2.9, FULL rigour — it decides who gets players and spends
-- FAAB). Spec §13.2 / §14 `process-waivers` / §7.2.1(c) / §7.3.4 / E7 / E8 /
-- E13 / E33 (v2.16.60, this PR's fold-back of Chris's F422 rulings);
-- tasks-M5-transactions.md §6 L.D2.9, TD2 / TD3 / TD6 / TD7 / TD8 / TD9 /
-- TD10 / TD16; PROGRESS F407 / F408 / F411 / F416 / F417 / F421 / F422 /
-- F423, D389 (re-cut), D395–D399.
--
-- Numbering: RESERVED by the orchestrator (150 / pgTAP 098; 151 / 099 are a
-- parallel L.D3.3 builder's). `ls supabase/migrations | tail -1` →
-- 149_waiver_schedule.sql. NOT held: reaches production by `npx supabase db
-- push` only (push debt becomes 135–150).
--
-- THE RULES (Chris, F422, 2026-09-28 — folded into §13.2 in v2.16.60):
--   (a) "During waivers, you burn your order priority with each pick" —
--       every win sends the team to the back of the order at once, for the
--       rest of the run, in every waiver type (and the FAAB equal-bid
--       tiebreak); a reverse-standings league restarts from the standings at
--       its next run, a rolling one keeps the rolled order.
--   (b) "your top choice is the choice you put the most money on" — in a
--       FAAB league a team's claims rank by bid; its own claim_order only
--       orders equal bids.
--   The pure TS resolver `resolveWaiverRun` was re-cut to these rules FIRST
--   (this PR's first commit); section 3 is its SQL twin, proven byte-equal
--   on random claim sets (waivers-resolver-parity-db.test.ts).
--
-- WHAT THIS MIGRATION DOES
--   1. `waiver_claim_actions.verb` admits 'waiver_claim_edit' (F417).
--   2. `waiver_runs` — one row per (league, scheduled run): `settled` (the
--      run's input + the resolver's result + a summary) or `refused` (the
--      error, attempts counted). ZERO policies (it names every claim — blind
--      bids, E13 / TD3); written by the processor and the tick only. The
--      UNIQUE (league, run) is the exactly-once backstop.
--   3. `waiver_resolve_run_internal(jsonb)` — the resolver's SQL twin (pure).
--   4. `waiver_claim_notify_internal` — the owner's private notice (TD16);
--      a retired team's goes to its successor's manager (F408).
--   5. `process_waivers_internal(league, p_at)` — one league's run: gather
--      the input at p_at (F421(a)–(d),(h)), resolve, apply (roster, pool,
--      lineups, FAAB, ONE transactions row per won claim with F416's name
--      objects, claim statuses, notices; nothing league-visible for a lost
--      or invalid claim — TD3), assert the tables equal the result, advance
--      `waiver_next_run_at` (F423), log the run. `none_fcfs` closes claims
--      left pending (F421(e)); an untracked league is seeded (F423).
--   6. `waiver_tick(p_now, p_league_id)` — the per-minute job: the
--      `waivers_paused` kill switch; SKIP LOCKED batches; each league in its
--      own subtransaction, a refusing league rolled back ALONE and recorded
--      (F421(g)). pg_cron `process-waivers`, `* * * * *` (§10).
--   7. D137 replacements, each derived from the NEWEST definer's FILE TEXT by
--      an exact-match script (derive_150.py — every hunk asserted to hit
--      once; sources md5-asserted; hunks counted with difflib):
--        waiver_claim_submit_internal  145:277-548  md5 46d18877… → 4 hunks
--            F407: a player whose game has kicked off is refused by name
--            (the pickup lock's message); F422(b): the team's order derived
--            from the bids in a FAAB league; `settled_by` text re-worded.
--        waiver_claim_reorder_internal 145:757-913  md5 46d18877… → 2 hunks
--            F422(b): a FAAB order that puts a smaller bid above a bigger one
--            is refused by name (only equal bids reorder).
--        remove_manager                146:95-595   md5 3e9c1fe5… → 1 hunk
--            F411: the vacate arm cancels the team's pending claims
--            (`seat_vacated`, cancelled_by = the commissioner). The result
--            is untouched (pgTAP 068 I1/I3 pin 063's seven keys byte for
--            byte) — the record is on the claim rows.
--        leave_league                  146:603-747  md5 3e9c1fe5… → 1 hunk
--            F411: leaving cancels the leaver's pending claims
--            (`manager_left`, cancelled_by = the leaver); result untouched.
--        draft_reset                   147:396-559  md5 425af561… → 1 hunk
--            F423: back to pre-draft clears the pending waiver run.
--   8. NEW verb `waiver_claim_edit` (F417): bid and drop changed in place,
--      one transaction, 145's template.
--   9. One-time: every pending claim in a FAAB league renumbered to the bid
--      order (stable within a bid) — the stored order now always says what
--      the run does (F422(b)); counted.
--
-- THE REORDER CHOICE (F422(b), asked by the orchestrator — "enforce, or
-- derive the order from the bid; pick one and say why"): BOTH HALVES, and
-- neither alone works. Derive alone (sort at run time, ignore the stored
-- order) would silently overrule a manager's drag and show him an order the
-- run does not follow; enforce alone (refuse at reorder) would leave submit
-- appending a $50 claim below a $10 one, so the claims panel would show the
-- wrong order and L.D2.12's "move to place N" route would build lists the
-- verb then refuses. So: submit and edit keep the stored order bid-sorted,
-- and reorder refuses by name a list that breaks it (the route maps it to a
-- 409 with the text). The resolver ranks by bid regardless (the rule itself).
--
-- WHAT DOES NOT CHANGE: add/drop (149), the game-day lock helpers (115),
-- the schedule functions (149), `waiver_claim_cancel_internal` (145), the
-- E37 trade trigger (148 — it fires on the processor's roster deletes like
-- any writer's), the transactions broadcast (119).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Additive: one table (RLS on, zero policies, REVOKE TRUNCATE, in this
--   file), one CHECK re-stated wider, five new functions + the edit door,
--   five replaced (signatures unchanged ⇒ ACLs kept; REVOKEs restated).
--   SECURITY DEFINER + `search_path = ''` on every door (waiver_tick,
--   waiver_claim_edit, remove_manager, leave_league, draft_reset); in-body
--   auth in each (the tick refuses any JWT). Internals PLAIN, `search_path =
--   ''`, REVOKEd from PUBLIC, anon, authenticated. League row locked FIRST
--   in every writer. Time only through p_at / p_now (the doors pass now()).
--   Grants (D18 → D23 → 133): the table is born without TRUNCATE for anon /
--   authenticated; restated. Typegen: additive (waiver_runs, the new
--   functions); the 42-export alias block re-appended.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–150 and the full pgTAP run in the PR. D38 realtime —
--   nothing new is broadcast (waiver_claims / waiver_runs never are, §12.14;
--   the won claim's transactions row rides 119's existing trigger).
--   Backfill: section 9's renumber only (pending FAAB claims, counted).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. the replay ledger learns the edit verb (F417)
-- ---------------------------------------------------------------------------
ALTER TABLE waiver_claim_actions DROP CONSTRAINT waiver_claim_actions_verb_check;
ALTER TABLE waiver_claim_actions ADD CONSTRAINT waiver_claim_actions_verb_check
  CHECK (verb IN ('waiver_claim_submit', 'waiver_claim_cancel', 'waiver_claim_reorder', 'waiver_claim_edit'));

COMMENT ON COLUMN waiver_claims.result_reason IS
  'Why a claim did not go through, or how it closed (145 / 150): lost = outbid | lost_on_priority; invalid = team_retired | add_rostered | add_locked | drop_gone | drop_locked | roster_full | cap_reached | insufficient_faab | own_claim_won (the resolver''s vocabulary, FAIL_CHECK_ORDER) | no_waivers (the league switched to none_fcfs — F421(e)); cancelled = cancelled (the verb) | seat_vacated | manager_left (F411). NULL for a pending or won claim.';

-- ---------------------------------------------------------------------------
-- 2. waiver_runs — one row per (league, scheduled run). ZERO policies.
-- ---------------------------------------------------------------------------
CREATE TABLE waiver_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  run_at       TIMESTAMPTZ NOT NULL,      -- the scheduled run ('-infinity' = a refusal before any run was tracked)
  status       TEXT NOT NULL
               CONSTRAINT waiver_runs_status_check CHECK (status IN ('settled', 'refused')),
  processed_at TIMESTAMPTZ,               -- the settle's p_at; NULL while refused
  attempts     INTEGER NOT NULL DEFAULT 1
               CONSTRAINT waiver_runs_attempts_positive CHECK (attempts >= 1),
  input        JSONB,                     -- the resolver's input (settled)
  result       JSONB,                     -- the resolver's result (settled)
  summary      JSONB,                     -- the processor's report (settled)
  last_error   TEXT,                      -- the latest refusal, SQLSTATE: message (kept after a later settle)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT waiver_runs_league_run_unique UNIQUE (league_id, run_at),
  CONSTRAINT waiver_runs_settled_shape CHECK ((status = 'settled') = (processed_at IS NOT NULL AND result IS NOT NULL))
);
CREATE INDEX idx_waiver_runs_refused ON waiver_runs(league_id, updated_at) WHERE status = 'refused';

COMMENT ON TABLE waiver_runs IS
  'The waiver processor''s run log (migration 150, L.D2.9): one row per (league, scheduled run) — settled (input, result, summary) or refused (last_error, attempts). ZERO policies: it names every claim and bid (blind, E13 / TD3); written only by process_waivers_internal and waiver_tick. UNIQUE (league_id, run_at) backs "a run is settled exactly once".';

ALTER TABLE waiver_runs ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON TABLE waiver_runs FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. waiver_resolve_run_internal — THE SQL TWIN of `resolveWaiverRun`
--    (src/lib/leagues/waivers/resolve-waiver-run.ts, re-cut to F422 in this
--    PR's first commit). PURE: input JSONB in the TS `WaiverRunInput` shape
--    (camelCase keys), output JSONB in the `WaiverRunResult` shape. No table
--    is read, no clock is read (locks are an input). Proven equal to the TS
--    function byte for byte by `waivers-resolver-parity-db.test.ts` (both
--    answers mapped into one `WaiverRunResult` and compared through
--    `serializeWaiverRunResult`, F421(f)); bad input is refused with the SAME
--    message text as the TS `WaiverRunInputError` (F421(g)).
--    The mirror, rule by rule:
--      * validation in the TS order (settings → teams in input order →
--        claims in input order → FAAB balances → locks → the priority
--        source actually used);
--      * claims walked in claim-id order, ids compared COLLATE "C" (a UUID's
--        text is lower-case hex, so byte order = JS code-unit order);
--      * step 1: the checks in FAIL_CHECK_ORDER (team_retired, add_rostered,
--        add_locked, drop_gone, drop_locked, roster_full, cap_reached,
--        insufficient_faab) — the first failing one names the reason;
--      * step 2: the strongest pending claim — effective bid DESC, the team's
--        place in the CURRENT order ASC, claim_order ASC, claim id ASC;
--        its player's other claims decided strongest first against the order
--        as it stood for the award (own team → own_claim_won; lower bid →
--        outbid; equal → lost_on_priority);
--      * step 3 (F422(a)): the winner to the back of the order;
--      * teams out sorted by id, rosters sorted, priority {source, persists,
--        before, after}.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_resolve_run_internal(p_input JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  c_err      CONSTANT TEXT := 'resolveWaiverRun: ';   -- the TS WaiverRunInputError prefix, verbatim (parity of refusals)
  v_set      JSONB := p_input -> 'settings';
  v_type     TEXT;
  v_tb       TEXT;
  v_size     INTEGER;
  v_capw     INTEGER;
  v_caps     INTEGER;
  v_faab     BOOLEAN;
  v_persists BOOLEAN;
  v_x        JSONB;
  v_y        JSONB;
  v_s        TEXT;
  v_i        INTEGER;
  v_j        INTEGER;
  v_n        INTEGER;
  -- teams, sorted by id COLLATE "C"
  t_id       TEXT[] := '{}';
  t_bal      INTEGER[] := '{}';
  t_bal0     INTEGER[] := '{}';
  t_cnt      INTEGER[] := '{}';
  t_accw     INTEGER[] := '{}';
  t_accs     INTEGER[] := '{}';
  t_ret      BOOLEAN[] := '{}';
  v_owner    JSONB := '{}'::jsonb;      -- player id → team id (the live roster map)
  v_seen     JSONB := '{}'::jsonb;
  -- claims, sorted by id COLLATE "C"
  c_id       TEXT[] := '{}';
  c_team     TEXT[] := '{}';
  c_add      TEXT[] := '{}';
  c_drop     TEXT[] := '{}';
  c_bid      INTEGER[] := '{}';
  c_ord      INTEGER[] := '{}';
  c_done     BOOLEAN[] := '{}';
  v_locked   TEXT[] := '{}';
  v_active   TEXT[] := '{}';
  v_list     TEXT[];
  v_missing  TEXT;
  v_source   TEXT;
  v_before   TEXT[];
  v_order    TEXT[];
  v_pre      TEXT[];
  v_outcomes JSONB := '[]'::jsonb;
  v_dec      INTEGER := 0;
  v_reason   TEXT;
  v_ti       INTEGER;
  v_w        INTEGER;
  v_w_eb     INTEGER;
  v_w_ps     INTEGER;
  v_eb       INTEGER;
  v_ps       INTEGER;
  v_spent    INTEGER;
  v_team     TEXT;
  v_teams    JSONB;
BEGIN
  -- ── validate(): settings ───────────────────────────────────────────────
  v_type := v_set ->> 'waiverType';
  IF v_type = 'none_fcfs' THEN
    RAISE EXCEPTION '%waiver type "none_fcfs" has no waivers — there is nothing to resolve (§7.3.4); the caller decides what happens to claims left pending by a settings change', c_err
      USING ERRCODE = '22023';
  END IF;
  IF v_type IS NULL OR v_type NOT IN ('faab', 'rolling_priority', 'reverse_standings') THEN
    RAISE EXCEPTION '%unknown waiver type "%"', c_err, COALESCE(v_type, 'undefined') USING ERRCODE = '22023';
  END IF;
  v_tb := v_set ->> 'faabTiebreaker';
  IF v_tb IS NULL OR v_tb NOT IN ('reverse_standings', 'rolling_priority') THEN
    RAISE EXCEPTION '%unknown faab_tiebreaker "%"', c_err, COALESCE(v_tb, 'undefined') USING ERRCODE = '22023';
  END IF;
  v_x := v_set -> 'rosterSize';
  IF v_x IS NULL OR jsonb_typeof(v_x) <> 'number' OR (v_x #>> '{}')::numeric < 0 OR (v_x #>> '{}')::numeric <> trunc((v_x #>> '{}')::numeric) THEN
    RAISE EXCEPTION '%rosterSize must be a whole number ≥ 0 (got %)', c_err,
      CASE WHEN v_x IS NULL THEN 'undefined' WHEN jsonb_typeof(v_x) = 'string' THEN v_x #>> '{}' ELSE v_x::text END
      USING ERRCODE = '22023';
  END IF;
  v_size := (v_x #>> '{}')::numeric::int;
  FOREACH v_s IN ARRAY ARRAY['acquisitionsPerWeek', 'acquisitionsPerSeason'] LOOP
    v_x := v_set -> v_s;
    IF v_x IS NOT NULL AND jsonb_typeof(v_x) <> 'null'
       AND (jsonb_typeof(v_x) <> 'number' OR (v_x #>> '{}')::numeric < 0 OR (v_x #>> '{}')::numeric <> trunc((v_x #>> '{}')::numeric)) THEN
      RAISE EXCEPTION '%', c_err || v_s || ' must be null or a whole number ≥ 0 (got '
        || CASE WHEN jsonb_typeof(v_x) = 'string' THEN v_x #>> '{}' ELSE v_x::text END || ')'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_capw := CASE WHEN jsonb_typeof(v_set -> 'acquisitionsPerWeek') = 'number' THEN (v_set ->> 'acquisitionsPerWeek')::numeric::int END;
  v_caps := CASE WHEN jsonb_typeof(v_set -> 'acquisitionsPerSeason') = 'number' THEN (v_set ->> 'acquisitionsPerSeason')::numeric::int END;
  v_faab := v_type = 'faab';
  v_persists := v_type = 'rolling_priority' OR (v_faab AND v_tb = 'rolling_priority');

  -- ── validate(): teams, in INPUT order (the first defect named is the TS one) ──
  FOR v_x IN SELECT e FROM jsonb_array_elements(COALESCE(p_input -> 'teams', '[]'::jsonb)) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
    v_s := CASE WHEN jsonb_typeof(v_x -> 'teamId') = 'string' THEN v_x ->> 'teamId' END;
    IF v_s IS NULL OR v_s = '' THEN
      RAISE EXCEPTION '%a team has no id', c_err USING ERRCODE = '22023';
    END IF;
    IF v_seen ? ('t:' || v_s) THEN
      RAISE EXCEPTION '%team % is listed twice', c_err, v_s USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || jsonb_build_object('t:' || v_s, TRUE);
    v_y := v_x -> 'faabBalance';
    IF v_y IS NOT NULL AND jsonb_typeof(v_y) <> 'null'
       AND (jsonb_typeof(v_y) <> 'number' OR (v_y #>> '{}')::numeric < 0 OR (v_y #>> '{}')::numeric <> trunc((v_y #>> '{}')::numeric)) THEN
      RAISE EXCEPTION '%team % has FAAB balance % — a balance is a whole number ≥ 0 (TD2)', c_err, v_s,
        CASE WHEN jsonb_typeof(v_y) = 'string' THEN v_y #>> '{}' ELSE v_y::text END
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_x -> 'acquisitionsWeek') IS DISTINCT FROM 'number' OR jsonb_typeof(v_x -> 'acquisitionsSeason') IS DISTINCT FROM 'number'
       OR (v_x ->> 'acquisitionsWeek')::numeric < 0 OR (v_x ->> 'acquisitionsSeason')::numeric < 0
       OR (v_x ->> 'acquisitionsWeek')::numeric <> trunc((v_x ->> 'acquisitionsWeek')::numeric)
       OR (v_x ->> 'acquisitionsSeason')::numeric <> trunc((v_x ->> 'acquisitionsSeason')::numeric) THEN
      RAISE EXCEPTION '%team % has a non-whole acquisition count', c_err, v_s USING ERRCODE = '22023';
    END IF;
    FOR v_y IN SELECT e FROM jsonb_array_elements(COALESCE(v_x -> 'roster', '[]'::jsonb)) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
      IF v_owner ? (v_y #>> '{}') THEN
        RAISE EXCEPTION '%player % is on % — exclusivity is already broken; refusing to resolve on corrupt rosters', c_err, v_y #>> '{}',
          CASE WHEN (v_owner ->> (v_y #>> '{}')) = v_s THEN 'team ' || v_s || '''s roster twice'
               ELSE 'two rosters (' || (v_owner ->> (v_y #>> '{}')) || ' and ' || v_s || ')' END
          USING ERRCODE = '22023';
      END IF;
      v_owner := v_owner || jsonb_build_object(v_y #>> '{}', v_s);
    END LOOP;
  END LOOP;

  -- the team arrays, sorted by id (the output order and the lookup order)
  SELECT COALESCE(array_agg(e ->> 'teamId' ORDER BY (e ->> 'teamId') COLLATE "C"), '{}'),
         COALESCE(array_agg(CASE WHEN jsonb_typeof(e -> 'faabBalance') = 'number' THEN (e ->> 'faabBalance')::numeric::int END ORDER BY (e ->> 'teamId') COLLATE "C"), '{}'),
         COALESCE(array_agg(jsonb_array_length(COALESCE(e -> 'roster', '[]'::jsonb)) ORDER BY (e ->> 'teamId') COLLATE "C"), '{}'),
         COALESCE(array_agg((e ->> 'acquisitionsWeek')::numeric::int ORDER BY (e ->> 'teamId') COLLATE "C"), '{}'),
         COALESCE(array_agg((e ->> 'acquisitionsSeason')::numeric::int ORDER BY (e ->> 'teamId') COLLATE "C"), '{}'),
         COALESCE(array_agg(COALESCE((e ->> 'retired')::boolean, FALSE) ORDER BY (e ->> 'teamId') COLLATE "C"), '{}')
  INTO t_id, t_bal, t_cnt, t_accw, t_accs, t_ret
  FROM jsonb_array_elements(COALESCE(p_input -> 'teams', '[]'::jsonb)) e;
  t_bal0 := t_bal;

  -- ── validate(): claims, in INPUT order ─────────────────────────────────
  v_seen := '{}'::jsonb;
  FOR v_x IN SELECT e FROM jsonb_array_elements(COALESCE(p_input -> 'claims', '[]'::jsonb)) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
    v_s := CASE WHEN jsonb_typeof(v_x -> 'claimId') = 'string' THEN v_x ->> 'claimId' END;
    IF v_s IS NULL OR v_s = '' THEN
      RAISE EXCEPTION '%a claim has no id', c_err USING ERRCODE = '22023';
    END IF;
    IF v_seen ? v_s THEN
      RAISE EXCEPTION '%claim % is listed twice', c_err, v_s USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_s, TRUE);
    IF array_position(t_id, v_x ->> 'teamId') IS NULL THEN
      RAISE EXCEPTION '%claim % names team %, which is not in the run', c_err, v_s, COALESCE(v_x ->> 'teamId', 'undefined') USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_x -> 'addPlayerId') IS DISTINCT FROM 'string' OR (v_x ->> 'addPlayerId') = '' THEN
      RAISE EXCEPTION '%claim % has no add player', c_err, v_s USING ERRCODE = '22023';
    END IF;
    IF v_x -> 'dropPlayerId' IS NOT NULL AND jsonb_typeof(v_x -> 'dropPlayerId') <> 'null'
       AND (jsonb_typeof(v_x -> 'dropPlayerId') <> 'string' OR (v_x ->> 'dropPlayerId') = '') THEN
      RAISE EXCEPTION '%claim % has an empty drop player id (use null for no drop)', c_err, v_s USING ERRCODE = '22023';
    END IF;
    IF (v_x ->> 'dropPlayerId') = (v_x ->> 'addPlayerId') THEN
      RAISE EXCEPTION '%claim % adds and drops the same player', c_err, v_s USING ERRCODE = '22023';
    END IF;
    v_y := v_x -> 'faabBid';
    IF v_y IS NULL OR jsonb_typeof(v_y) <> 'number' OR (v_y #>> '{}')::numeric < 0 OR (v_y #>> '{}')::numeric <> trunc((v_y #>> '{}')::numeric) THEN
      RAISE EXCEPTION '%claim % has bid % — a bid is a whole number ≥ 0', c_err, v_s,
        CASE WHEN v_y IS NULL THEN 'undefined' WHEN jsonb_typeof(v_y) = 'string' THEN v_y #>> '{}' ELSE v_y::text END
        USING ERRCODE = '22023';
    END IF;
    v_y := v_x -> 'claimOrder';
    IF v_y IS NULL OR jsonb_typeof(v_y) <> 'number' OR (v_y #>> '{}')::numeric < 1 OR (v_y #>> '{}')::numeric <> trunc((v_y #>> '{}')::numeric) THEN
      RAISE EXCEPTION '%claim % has claim_order % — 1 or more', c_err, v_s,
        CASE WHEN v_y IS NULL THEN 'undefined' WHEN jsonb_typeof(v_y) = 'string' THEN v_y #>> '{}' ELSE v_y::text END
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(e ->> 'teamId') FILTER (WHERE NOT COALESCE((e ->> 'retired')::boolean, FALSE)), '{}')
  INTO v_active
  FROM jsonb_array_elements(COALESCE(p_input -> 'teams', '[]'::jsonb)) WITH ORDINALITY AS a(e, o);
  IF v_faab THEN
    FOR v_x IN SELECT e FROM jsonb_array_elements(COALESCE(p_input -> 'teams', '[]'::jsonb)) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
      IF NOT COALESCE((v_x ->> 'retired')::boolean, FALSE)
         AND COALESCE(jsonb_typeof(v_x -> 'faabBalance'), 'null') = 'null'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_input -> 'claims', '[]'::jsonb)) c WHERE c ->> 'teamId' = v_x ->> 'teamId') THEN
        RAISE EXCEPTION '%team % has claims in a FAAB league but no FAAB balance on record — refusing to settle bids against money that is not recorded (§12.2)', c_err, v_x ->> 'teamId'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  FOR v_x IN SELECT e FROM jsonb_array_elements(COALESCE(p_input -> 'lockedPlayerIds', '[]'::jsonb)) e LOOP
    IF jsonb_typeof(v_x) <> 'string' OR (v_x #>> '{}') = '' THEN
      RAISE EXCEPTION '%lockedPlayerIds holds an empty id', c_err USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT COALESCE(array_agg(DISTINCT e #>> '{}'), '{}') INTO v_locked
  FROM jsonb_array_elements(COALESCE(p_input -> 'lockedPlayerIds', '[]'::jsonb)) e;

  -- ── startOrder() — the priority source actually used, validated there ──
  IF v_persists AND COALESCE(jsonb_typeof(p_input #> '{priority,rolling}'), 'null') = 'object' THEN
    v_source := 'rolling';
    SELECT array_agg(k) INTO v_list FROM jsonb_object_keys(p_input #> '{priority,rolling}') k;
    v_list := COALESCE(v_list, '{}');
    -- assertPermutation(ids, active, 'the stored rolling priority')
    v_seen := '{}'::jsonb;
    FOREACH v_s IN ARRAY v_list LOOP
      IF NOT (v_s = ANY (v_active)) THEN
        RAISE EXCEPTION '%the stored rolling priority lists %, which is not an active (non-retired) team in the run', c_err, v_s USING ERRCODE = '22023';
      END IF;
      v_seen := v_seen || jsonb_build_object(v_s, TRUE);
    END LOOP;
    SELECT string_agg(a, ', ' ORDER BY a COLLATE "C") INTO v_missing FROM unnest(v_active) a WHERE NOT (v_seen ? a);
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION '%the stored rolling priority is missing active team(s) % — it must order exactly the active teams', c_err, v_missing USING ERRCODE = '22023';
    END IF;
    FOREACH v_s IN ARRAY v_list LOOP
      v_x := p_input #> ARRAY['priority', 'rolling', v_s];
      IF jsonb_typeof(v_x) <> 'number' OR (v_x #>> '{}')::numeric < 1 OR (v_x #>> '{}')::numeric <> trunc((v_x #>> '{}')::numeric) THEN
        RAISE EXCEPTION '%team % has waiver priority % — 1 or more', c_err, v_s,
          CASE WHEN jsonb_typeof(v_x) = 'string' THEN v_x #>> '{}' ELSE v_x::text END
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    SELECT min(v) INTO v_s FROM (
      SELECT (value #>> '{}') AS v FROM jsonb_each(p_input #> '{priority,rolling}')
      GROUP BY (value #>> '{}')::numeric, (value #>> '{}') HAVING count(*) > 1) d;
    IF v_s IS NOT NULL THEN
      RAISE EXCEPTION '%two teams hold waiver priority %', c_err, v_s USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(key ORDER BY (value #>> '{}')::numeric) INTO v_before
    FROM jsonb_each(p_input #> '{priority,rolling}');
  ELSIF NOT v_persists AND COALESCE(jsonb_typeof(p_input #> '{priority,standings}'), 'null') = 'array' THEN
    v_source := 'reverse_standings';
    SELECT COALESCE(array_agg(e #>> '{}' ORDER BY o), '{}') INTO v_list
    FROM jsonb_array_elements(p_input #> '{priority,standings}') WITH ORDINALITY AS a(e, o);
  ELSE
    v_source := 'reverse_draft_order';
    SELECT COALESCE(array_agg(e #>> '{}' ORDER BY o), '{}') INTO v_list
    FROM jsonb_array_elements(COALESCE(p_input #> '{priority,draftOrder}', '[]'::jsonb)) WITH ORDINALITY AS a(e, o);
  END IF;
  IF v_source <> 'rolling' THEN
    v_s := CASE v_source WHEN 'reverse_standings' THEN 'the standings' ELSE 'the draft order' END;
    v_seen := '{}'::jsonb;
    FOR v_i IN 1 .. COALESCE(array_length(v_list, 1), 0) LOOP
      IF NOT (v_list[v_i] = ANY (v_active)) THEN
        RAISE EXCEPTION '%', c_err || v_s || ' lists ' || v_list[v_i] || ', which is not an active (non-retired) team in the run' USING ERRCODE = '22023';
      END IF;
      IF v_seen ? v_list[v_i] THEN
        RAISE EXCEPTION '%', c_err || v_s || ' lists ' || v_list[v_i] || ' twice' USING ERRCODE = '22023';
      END IF;
      v_seen := v_seen || jsonb_build_object(v_list[v_i], TRUE);
    END LOOP;
    SELECT string_agg(a, ', ' ORDER BY a COLLATE "C") INTO v_missing FROM unnest(v_active) a WHERE NOT (v_seen ? a);
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION '%', c_err || v_s || ' is missing active team(s) ' || v_missing || ' — it must order exactly the active teams' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(x ORDER BY o DESC), '{}') INTO v_before FROM unnest(v_list) WITH ORDINALITY AS u(x, o);
  END IF;
  v_before := COALESCE(v_before, '{}');
  v_order := v_before;

  -- ── the claims, sorted by id ────────────────────────────────────────────
  SELECT COALESCE(array_agg(e ->> 'claimId' ORDER BY (e ->> 'claimId') COLLATE "C"), '{}'),
         COALESCE(array_agg(e ->> 'teamId' ORDER BY (e ->> 'claimId') COLLATE "C"), '{}'),
         COALESCE(array_agg(e ->> 'addPlayerId' ORDER BY (e ->> 'claimId') COLLATE "C"), '{}'),
         COALESCE(array_agg(e ->> 'dropPlayerId' ORDER BY (e ->> 'claimId') COLLATE "C"), '{}'),
         COALESCE(array_agg((e ->> 'faabBid')::numeric::int ORDER BY (e ->> 'claimId') COLLATE "C"), '{}'),
         COALESCE(array_agg((e ->> 'claimOrder')::numeric::int ORDER BY (e ->> 'claimId') COLLATE "C"), '{}'),
         COALESCE(array_agg(FALSE ORDER BY (e ->> 'claimId') COLLATE "C"), '{}')
  INTO c_id, c_team, c_add, c_drop, c_bid, c_ord, c_done
  FROM jsonb_array_elements(COALESCE(p_input -> 'claims', '[]'::jsonb)) e;
  v_n := COALESCE(array_length(c_id, 1), 0);

  -- ── the run ─────────────────────────────────────────────────────────────
  LOOP
    -- Step 1 — FAIL_CHECK_ORDER, claims in id order.
    FOR v_i IN 1 .. v_n LOOP
      CONTINUE WHEN c_done[v_i];
      v_ti := array_position(t_id, c_team[v_i]);
      v_reason := CASE
        WHEN t_ret[v_ti] THEN 'team_retired'
        WHEN v_owner ? c_add[v_i] THEN 'add_rostered'
        WHEN c_add[v_i] = ANY (v_locked) THEN 'add_locked'
        WHEN c_drop[v_i] IS NOT NULL AND (v_owner ->> c_drop[v_i]) IS DISTINCT FROM c_team[v_i] THEN 'drop_gone'
        WHEN c_drop[v_i] IS NOT NULL AND c_drop[v_i] = ANY (v_locked) THEN 'drop_locked'
        WHEN t_cnt[v_ti] + CASE WHEN c_drop[v_i] IS NULL THEN 1 ELSE 0 END > v_size THEN 'roster_full'
        WHEN (v_capw IS NOT NULL AND t_accw[v_ti] >= v_capw) OR (v_caps IS NOT NULL AND t_accs[v_ti] >= v_caps) THEN 'cap_reached'
        WHEN v_faab AND c_bid[v_i] > COALESCE(t_bal[v_ti], 0) THEN 'insufficient_faab'
      END;
      IF v_reason IS NOT NULL THEN
        c_done[v_i] := TRUE;
        v_dec := v_dec + 1;
        v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
          'decision', v_dec, 'claimId', c_id[v_i], 'teamId', c_team[v_i], 'addPlayerId', c_add[v_i],
          'dropPlayerId', c_drop[v_i], 'status', 'invalid', 'reason', v_reason, 'faabSpent', 0));
      END IF;
    END LOOP;

    -- Step 2 — the strongest pending claim (bid, place in the CURRENT order,
    -- the team's own order, id — the walk is in id order, so a strict `<`
    -- keeps the smaller id on a full tie).
    v_w := NULL;
    FOR v_i IN 1 .. v_n LOOP
      CONTINUE WHEN c_done[v_i];
      v_eb := CASE WHEN v_faab THEN c_bid[v_i] ELSE 0 END;
      v_ps := COALESCE(array_position(v_order, c_team[v_i]), 2147483647);
      IF v_w IS NULL
         OR v_eb > v_w_eb
         OR (v_eb = v_w_eb AND v_ps < v_w_ps)
         OR (v_eb = v_w_eb AND v_ps = v_w_ps AND c_ord[v_i] < c_ord[v_w]) THEN
        v_w := v_i; v_w_eb := v_eb; v_w_ps := v_ps;
      END IF;
    END LOOP;
    EXIT WHEN v_w IS NULL;

    -- Award.
    v_team := c_team[v_w];
    v_ti := array_position(t_id, v_team);
    v_spent := v_w_eb;
    IF v_faab THEN
      t_bal[v_ti] := COALESCE(t_bal[v_ti], 0) - v_spent;
    END IF;
    v_owner := v_owner || jsonb_build_object(c_add[v_w], v_team);
    IF c_drop[v_w] IS NOT NULL THEN
      v_owner := v_owner - c_drop[v_w];
    END IF;
    t_cnt[v_ti] := t_cnt[v_ti] + CASE WHEN c_drop[v_w] IS NULL THEN 1 ELSE 0 END;
    t_accw[v_ti] := t_accw[v_ti] + 1;
    t_accs[v_ti] := t_accs[v_ti] + 1;
    c_done[v_w] := TRUE;
    v_dec := v_dec + 1;
    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
      'decision', v_dec, 'claimId', c_id[v_w], 'teamId', v_team, 'addPlayerId', c_add[v_w],
      'dropPlayerId', c_drop[v_w], 'status', 'won', 'reason', NULL, 'faabSpent', v_spent));

    -- The player's other pending claims, strongest first, judged against the
    -- order as it stood for the award.
    v_pre := v_order;
    LOOP
      v_j := NULL;
      FOR v_i IN 1 .. v_n LOOP
        CONTINUE WHEN c_done[v_i] OR c_add[v_i] IS DISTINCT FROM c_add[v_w];
        v_eb := CASE WHEN v_faab THEN c_bid[v_i] ELSE 0 END;
        v_ps := COALESCE(array_position(v_pre, c_team[v_i]), 2147483647);
        IF v_j IS NULL
           OR v_eb > (CASE WHEN v_faab THEN c_bid[v_j] ELSE 0 END)
           OR (v_eb = (CASE WHEN v_faab THEN c_bid[v_j] ELSE 0 END)
               AND (v_ps < COALESCE(array_position(v_pre, c_team[v_j]), 2147483647)
                    OR (v_ps = COALESCE(array_position(v_pre, c_team[v_j]), 2147483647) AND c_ord[v_i] < c_ord[v_j]))) THEN
          v_j := v_i;
        END IF;
      END LOOP;
      EXIT WHEN v_j IS NULL;
      c_done[v_j] := TRUE;
      v_dec := v_dec + 1;
      v_eb := CASE WHEN v_faab THEN c_bid[v_j] ELSE 0 END;
      v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
        'decision', v_dec, 'claimId', c_id[v_j], 'teamId', c_team[v_j], 'addPlayerId', c_add[v_j],
        'dropPlayerId', c_drop[v_j],
        'status', CASE WHEN c_team[v_j] = v_team THEN 'invalid' ELSE 'lost' END,
        'reason', CASE WHEN c_team[v_j] = v_team THEN 'own_claim_won'
                       WHEN v_eb < v_spent THEN 'outbid' ELSE 'lost_on_priority' END,
        'faabSpent', 0));
    END LOOP;

    -- Step 3 — F422(a): the winner burns its priority for the rest of the run.
    v_order := array_remove(v_order, v_team) || v_team;
  END LOOP;

  -- ── the result ──────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'teamId',                  t_id[i],
           'faabBefore',              t_bal0[i],
           'faabAfter',               t_bal[i],
           'rosterAfter',             COALESCE((SELECT jsonb_agg(o.key ORDER BY o.key COLLATE "C")
                                                FROM jsonb_each_text(v_owner) o WHERE o.value = t_id[i]), '[]'::jsonb),
           'acquisitionsWeekAfter',   t_accw[i],
           'acquisitionsSeasonAfter', t_accs[i]) ORDER BY i), '[]'::jsonb)
  INTO v_teams
  FROM generate_subscripts(t_id, 1) i;

  RETURN jsonb_build_object(
    'outcomes', v_outcomes,
    'teams',    v_teams,
    'priority', jsonb_build_object(
      'source',   v_source,
      'persists', v_persists,
      'before',   to_jsonb(v_before),
      'after',    to_jsonb(v_order)));
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_resolve_run_internal(JSONB) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION waiver_resolve_run_internal(JSONB) IS
  '150 / L.D2.9 (TD7): the SQL twin of src/lib/leagues/waivers/resolve-waiver-run.ts (F422 as ruled) — pure, input/output in the TS WaiverRunInput / WaiverRunResult shapes; bad input refused with the TS WaiverRunInputError text. Proven byte-identical by waivers-resolver-parity-db.test.ts.';

-- ---------------------------------------------------------------------------
-- 4. waiver_claim_notify_internal — the owner's private notification for a
--    settled claim (TD3 / TD16). Blind-safe by construction: it is written to
--    ONE user (notifications are readable by their user alone — 001:898);
--    nothing league-visible is written here. A RETIRED team's claim goes to
--    the manager of the franchise that succeeded it (F408) — walked over
--    `successor_team_id`, at most 64 links (120's cycle bound); an open seat
--    notifies nobody (the commissioners see the claim row). Returns the
--    recipient (NULL = nobody).
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
  v_depth     INTEGER := 0;
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
  WHILE v_live.status = 'retired' AND v_live.successor_team_id IS NOT NULL AND v_depth < 64 LOOP
    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = v_live.successor_team_id;
    v_depth := v_depth + 1;
  END LOOP;
  SELECT m.user_id INTO v_user
  FROM public.league_members m
  WHERE m.league_id = p_league.id AND m.team_id = v_live.id AND m.user_id IS NOT NULL;
  IF v_user IS NULL OR v_live.status = 'retired' THEN
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
REVOKE EXECUTE ON FUNCTION waiver_claim_notify_internal(public.leagues, public.waiver_claims, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. process_waivers_internal(league, p_at) — ONE league's run (TD6 / TD7).
--    PLAIN, triple-REVOKEd; the tick is its only production caller.
--    (1) League row FOR UPDATE FIRST — the one serialization point shared
--        with add/drop (115:410-414 → 149) and the claim verbs (145), so a
--        claim-vs-add race on one player (E8) serializes here: whoever holds
--        the row first wins and the other refuses by name.
--    (2) Not in season → reported, nothing written. `none_fcfs` → F421(e):
--        pending claims close `invalid` / `no_waivers` (owner told, nothing
--        spent) and the pending run is cleared. Untracked (NULL next run) →
--        F423: seeded with the schedule's next run after p_at, nothing
--        decided. Not due → reported.
--    (3) THE INPUT, gathered at p_at in `WaiverRunInput`'s shape (F421(a)–
--        (d)): every franchise (retired ones flagged — their claims fail
--        `team_retired`); rosters; each seat's balance; 115's acquisition
--        counts (this team's `complete` transactions carrying
--        `add_player_id` — waiver rows included, F227(a)); pending claims;
--        the round-1 draft order mapped through retire-and-succeed (live
--        franchises only); the standings (only for an order that does not
--        persist, and only once a week is final — Q72); the stored rolling
--        order (only for one that persists; NULL until the first run seeds
--        it); the locked set = every claim player whose NFL team
--        `pool_game_lock_any_internal` locks at p_at (E32 / Q34(B)).
--    (4) `waiver_resolve_run_internal` decides (bad input raises by name —
--        the tick rolls this league back and records the refusal, F421(g)).
--    (5) APPLY in decision order: a won claim = roster (drop out, add in on
--        the bench as a `waiver` acquisition), pool (the drop on waivers
--        until the NEXT run, or back to free agency inside `fa_hold_hours`
--        — 149's rule; the add `rostered`), the lineup interplay (TD10 —
--        149's loop, copied), the balance debit, ONE `transactions` row
--        (TD9 + F416's names), the claim `won`, the owner told; every other
--        claim = status + reason, the owner told, NO transactions row (TD3).
--        Then the persisting order is written to `waiver_priority` (1-based,
--        the first run's lazy seed included — F421(d)).
--    (6) ASSERTED, NOT TRUSTED (rule 6): every team's roster and balance
--        equal the resolver's `teams[]`; the balance CHECK (145) holds.
--    (7) The pending run advances to the schedule's next run after p_at
--        (F423) and the run is logged in `waiver_runs` — a second settle of
--        the same run is refused by name (exactly once, E8 / TD6).
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
  v_depth       INTEGER;
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

  -- (3) THE INPUT.
  v_tb := COALESCE(v_league.settings ->> 'faab_tiebreaker', 'reverse_standings');
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
  -- every draft type — 098's draft_start writes it for an auction too),
  -- each franchise mapped to the live one its successor chain leads to.
  SELECT d.draft_order INTO v_draft_raw
  FROM public.drafts d
  WHERE d.league_id = p_league_id AND NOT d.is_mock AND d.status = 'complete'
  ORDER BY d.completed_at DESC NULLS LAST, d.id
  LIMIT 1;
  FOR v_x IN SELECT e FROM jsonb_array_elements(COALESCE(v_draft_raw, '[]'::jsonb)) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = (v_x #>> '{}')::uuid;
    v_depth := 0;
    WHILE FOUND AND v_live.status = 'retired' AND v_live.successor_team_id IS NOT NULL AND v_depth < 64 LOOP
      SELECT t.* INTO v_live FROM public.teams t WHERE t.id = v_live.successor_team_id;
      v_depth := v_depth + 1;
    END LOOP;
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
  ), nfl AS (
    SELECT DISTINCT p.team FROM public.players p JOIN claim_players cp ON cp.pid = p.id WHERE p.team IS NOT NULL
  ), locked_nfl AS (
    SELECT n.team FROM nfl n
    WHERE (public.pool_game_lock_any_internal(v_league.season, v_current, n.team, p_at) ->> 'locked')::boolean
  )
  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id COLLATE "C"), '[]'::jsonb) INTO v_locked
  FROM public.players p JOIN claim_players cp ON cp.pid = p.id JOIN locked_nfl ln ON ln.team = p.team;

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
    -- §THE LINEUP CONSEQUENCES), copied for this team, add and drop.
    FOR v_row IN
      SELECT tl.* FROM public.team_lineups tl
      WHERE tl.team_id = v_claim.team_id AND tl.season = v_league.season AND tl.week >= v_current
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
REVOKE EXECUTE ON FUNCTION process_waivers_internal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. waiver_tick(p_now, p_league_id) — the per-minute job (TD6, C78's in-DB
--    vehicle; the `draft_tick` / `lineup_lock_tick` batch shape). A job RPC:
--    a JWT-bearing caller is refused in-body. The `waivers_paused` kill switch
--    (system_flags, world-SELECT, written by service_role only — 122) is read
--    ONCE: while set, NOTHING is processed or seeded and the report says so
--    with the number of leagues waiting; the pending runs stay pending, so
--    the free-agency window stays shut on them (E8) until it is lifted.
--    Due leagues are claimed `FOR UPDATE SKIP LOCKED` in batches: a league
--    another tick is settling is skipped (processed exactly once); each
--    league runs in its OWN subtransaction — a league that raises (a
--    resolver refusal, a failed assertion) is rolled back ALONE, its claims
--    left pending and no FAAB moved, the refusal recorded by name in
--    `waiver_runs` (status `refused`, attempts counted) and in the report,
--    and the tick carries on (F421(g)). The pending run is not advanced, so
--    the next minute retries — loudly — until the data is repaired.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_tick(
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
  v_paused    BOOLEAN;
  v_seen      UUID[] := '{}';
  v_loops     INTEGER := 0;
  v_pass      INTEGER;
  v_lg        RECORD;
  v_r         JSONB;
  v_settled   JSONB := '[]'::jsonb;
  v_seeded    JSONB := '[]'::jsonb;
  v_closed    JSONB := '[]'::jsonb;
  v_other     JSONB := '[]'::jsonb;
  v_failures  JSONB := '[]'::jsonb;
  v_waiting   INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'waiver_tick: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'waiver_tick: p_now is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- THE KILL SWITCH, read once. An operator pauses waivers with a
  -- service_role write and nothing else:
  --     insert into system_flags (key, value) values ('waivers_paused', '{"paused": true}')
  --     on conflict (key) do update set value = excluded.value, updated_at = now();
  -- Deleting the row (or {"paused": false}) resumes at the next minute.
  SELECT COALESCE((f.value ->> 'paused')::boolean, FALSE) INTO v_paused
  FROM public.system_flags f WHERE f.key = 'waivers_paused';
  IF COALESCE(v_paused, FALSE) THEN
    SELECT count(*)::int INTO v_waiting
    FROM public.leagues l
    WHERE l.status IN ('in_season', 'playoffs') AND l.deleted_at IS NULL
      AND (p_league_id IS NULL OR l.id = p_league_id)
      AND l.waiver_next_run_at <= p_now;
    RETURN jsonb_build_object('at', p_now, 'scope', p_league_id, 'paused', TRUE,
      'why', 'paused_by_system_flag:waivers_paused — no league was processed or seeded; due runs stay pending (free agency stays shut on them) until the flag is lifted',
      'leagues_waiting', v_waiting);
  END IF;

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;
    FOR v_lg IN
      SELECT l.id, l.waiver_next_run_at
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
        AND (
          (COALESCE(l.waiver_type, 'faab') <> 'none_fcfs' AND (l.waiver_next_run_at IS NULL OR l.waiver_next_run_at <= p_now))
          OR (COALESCE(l.waiver_type, 'faab') = 'none_fcfs'
              AND (l.waiver_next_run_at IS NOT NULL
                   OR EXISTS (SELECT 1 FROM public.waiver_claims c WHERE c.league_id = l.id AND c.status = 'pending'))))
      ORDER BY l.waiver_next_run_at NULLS FIRST, l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      BEGIN
        v_r := public.process_waivers_internal(v_lg.id, p_now);
        CASE v_r ->> 'status'
          WHEN 'settled'    THEN v_settled := v_settled || jsonb_build_array(v_r);
          WHEN 'seeded'     THEN v_seeded  := v_seeded  || jsonb_build_array(v_r);
          WHEN 'no_waivers' THEN v_closed  := v_closed  || jsonb_build_array(v_r);
          ELSE                   v_other   := v_other   || jsonb_build_array(v_r);
        END CASE;
      EXCEPTION WHEN OTHERS THEN
        -- This league's writes are rolled back (the block is a
        -- subtransaction): claims stay pending, no FAAB moved, the run not
        -- advanced. Recorded LOUDLY, then the tick carries on.
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'run_at', v_lg.waiver_next_run_at, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'waiver_tick: league % refused at %: % (%)', v_lg.id, v_lg.waiver_next_run_at, SQLERRM, SQLSTATE;
        INSERT INTO public.waiver_runs AS w (league_id, run_at, status, processed_at, attempts, last_error, updated_at)
        VALUES (v_lg.id, COALESCE(v_lg.waiver_next_run_at, '-infinity'::timestamptz), 'refused', NULL, 1,
                SQLSTATE || ': ' || SQLERRM, p_now)
        ON CONFLICT (league_id, run_at) DO UPDATE
          SET attempts = w.attempts + 1, last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at
          WHERE w.status = 'refused';
      END;
    END LOOP;
    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',         p_now,
    'scope',      p_league_id,
    'paused',     FALSE,
    'leagues',    cardinality(v_seen),
    'settled',    v_settled,
    'seeded',     v_seeded,
    'no_waivers', v_closed,
    'other',      v_other,
    'failures',   v_failures,
    'why',        CASE WHEN cardinality(v_seen) = 0 THEN 'no_league_due — no in-season league had a waiver run due, an untracked schedule, or claims left under no waivers' END);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_tick(TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION waiver_tick(TIMESTAMPTZ, UUID) IS
  '§14 process-waivers (migration 150, L.D2.9; TD6 / C78): the per-minute in-database job. Honours system_flags.waivers_paused; claims due leagues FOR UPDATE SKIP LOCKED and settles each in its own subtransaction via process_waivers_internal (a refusing league rolls back alone and is recorded in waiver_runs); seeds an untracked league''s next run (F423); closes claims left pending under none_fcfs (F421(e)). pg_cron job ''process-waivers'', every minute.';

-- ---------------------------------------------------------------------------
-- 7a. waiver_claim_submit_internal — 145:277-548's FILE TEXT (D137), 4 hunks,
--     each marked `150 / F407` or `150 / F422(b)`.
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
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'waiver_claim_submit: % is retired — a sealed franchise makes no claims (§7.2.1)', v_team.name
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
      'waiver_claim_submit: league % has no league_weeks rows — no season calendar to evaluate the game-day lock against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at);
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
        'waiver_claim_submit: % has no FAAB balance on record (its league_members seat %) — refusing to accept a bid against money that is not recorded (§12.2)',
        v_team.name, CASE WHEN v_has_seat IS NULL THEN 'is missing' ELSE 'holds NULL' END
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
REVOKE EXECUTE ON FUNCTION waiver_claim_submit_internal(UUID, UUID, TEXT, TEXT, INTEGER, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7b. waiver_claim_reorder_internal — 145:757-913's FILE TEXT (D137), 2 hunks
--     (`150 / F422(b)`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_reorder_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_claim_ids UUID[],
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
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_ledger      public.waiver_claim_actions;
  v_team        public.teams;
  v_reason      TEXT;
  v_missing     TEXT;
  v_extra       TEXT;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_n           INTEGER;
  v_receipt     JSONB := NULL;
  v_result      JSONB;
  v_bad         RECORD;    -- 150 / F422(b)
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_team_id is required — a team orders its own claims'
      USING ERRCODE = '22023';
  END IF;
  IF p_claim_ids IS NULL OR cardinality(p_claim_ids) = 0 THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_claim_ids is required — the team''s pending claims, first to last'
      USING ERRCODE = '22023';
  END IF;
  IF array_position(p_claim_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_claim_ids holds a NULL — every entry names one claim'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_claim_ids) x) <> cardinality(p_claim_ids) THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_claim_ids names a claim more than once — each pending claim appears exactly once'
      USING ERRCODE = '22023';
  END IF;

  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'waiver_claim_reorder: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_ledger
  FROM public.waiver_claim_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'waiver_claim_reorder' OR v_ledger.team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION
        'waiver_claim_reorder: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'waiver_claim_reorder: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'waiver_claim_reorder: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock this team's pending claims, then require EXACTLY that set.
  PERFORM 1 FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending'
  FOR UPDATE;
  SELECT string_agg(c.id::text, ', ' ORDER BY c.claim_order) INTO v_missing
  FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending' AND NOT (c.id = ANY (p_claim_ids));
  SELECT string_agg(x::text, ', ' ORDER BY o) INTO v_extra
  FROM unnest(p_claim_ids) WITH ORDINALITY AS u(x, o)
  WHERE NOT EXISTS (SELECT 1 FROM public.waiver_claims c
                    WHERE c.id = u.x AND c.team_id = p_team_id AND c.status = 'pending');
  IF v_missing IS NOT NULL OR v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'waiver_claim_reorder: the new order must list exactly %''s pending claims, each once — missing: %; not a pending claim of this team: %',
      v_team.name, COALESCE(v_missing, 'none'), COALESCE(v_extra, 'none')
      USING ERRCODE = 'P0001';
  END IF;

  -- 150 / F422(b) — ENFORCED BY NAME: in a FAAB league a team's claims
  -- rank by bid ("you cannot have a $10 priority that is higher than $50"),
  -- so the new order may not put a smaller bid above a bigger one; only
  -- claims with EQUAL bids can be reordered. (Submit and edit keep the
  -- stored order bid-sorted, so a legal move is always expressible.)
  IF COALESCE(v_league.waiver_type, 'faab') = 'faab' THEN
    SELECT hi.o AS hi_o, hi.bid AS hi_bid, hi.name AS hi_name, lo.bid AS lo_bid, lo.name AS lo_name
    INTO v_bad
    FROM (SELECT u.o, c.faab_bid AS bid, COALESCE(p.full_name, c.add_player_id) AS name
          FROM unnest(p_claim_ids) WITH ORDINALITY AS u(x, o)
          JOIN public.waiver_claims c ON c.id = u.x
          LEFT JOIN public.players p ON p.id = c.add_player_id) hi
    JOIN (SELECT u.o, c.faab_bid AS bid, COALESCE(p.full_name, c.add_player_id) AS name
          FROM unnest(p_claim_ids) WITH ORDINALITY AS u(x, o)
          JOIN public.waiver_claims c ON c.id = u.x
          LEFT JOIN public.players p ON p.id = c.add_player_id) lo
      ON lo.o = hi.o + 1
    WHERE hi.bid < lo.bid
    ORDER BY hi.o
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION
        'waiver_claim_reorder: in a FAAB league your claims are ranked by bid — your top choice is the one you bid the most on, so the $% claim for % can''t go above the $% claim for %; only claims with the same bid can be reordered (§13.2)',
        v_bad.hi_bid, v_bad.hi_name, v_bad.lo_bid, v_bad.lo_name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_n := cardinality(p_claim_ids);
  v_no_changes := NOT EXISTS (
    SELECT 1 FROM unnest(p_claim_ids) WITH ORDINALITY AS u(x, o)
    JOIN public.waiver_claims c ON c.id = u.x
    WHERE c.claim_order <> u.o);

  IF NOT v_no_changes THEN
    UPDATE public.waiver_claims c
    SET claim_order = u.o
    FROM unnest(p_claim_ids) WITH ORDINALITY AS u(x, o)
    WHERE c.id = u.x AND c.team_id = p_team_id AND c.status = 'pending';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> v_n THEN
      RAISE EXCEPTION 'waiver_claim_reorder: the reorder touched % claim rows, expected % (team %)', v_cnt, v_n, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_is_manager THEN
      v_receipt := public.waiver_claim_receipt_internal(
        p_league_id, v_team, 'reorder_waiver_claims', 'reordered the waiver claims of',
        to_jsonb(p_claim_ids), v_reason, p_action_id, 'waiver_claim_reorder', v_league.season,
        'The commissioner reordered your team''s waiver claims',
        'Your pending claims have a new order'
          || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
        jsonb_build_object('claim_ids', to_jsonb(p_claim_ids)));
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'verb',                   'waiver_claim_reorder',
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    'action_id',              p_action_id,
    'pending_claims',         (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'claim_order', c.claim_order) ORDER BY c.claim_order), '[]'::jsonb)
                               FROM public.waiver_claims c WHERE c.team_id = p_team_id AND c.status = 'pending'),
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN 'same_order — the claims were already in this order, so nothing was written and no receipt was issued' END,
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'notified_user_id',       v_receipt ->> 'notified_user_id',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.waiver_claim_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, 'waiver_claim_reorder', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_reorder_internal(UUID, UUID, UUID[], UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7c. remove_manager — 146:95-595's FILE TEXT (D137), 3 hunks (`150 / F411`).
--     Same six-argument signature; the takeover and retire arms untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_manager(
  p_league_id UUID,
  p_member_id UUID,
  p_mode TEXT,
  p_successor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_action_id UUID DEFAULT NULL      -- 120: the retire arm's idempotency stamp (REQUIRED in-body for retire; ignored by takeover/vacate)
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
  -- 120 (L.D1.10): the retire arm.
  v_reason TEXT;
  v_replay RECORD;
  v_cycle RECORD;
  v_week INTEGER;
  v_franchises INTEGER;
  v_successor_id UUID;
  v_successor_name TEXT;
  v_n INTEGER;
  v_n_rosters INTEGER := 0;
  v_n_lineups INTEGER := 0;
  v_n_matchups INTEGER := 0;
  v_n_results INTEGER := 0;
  v_message TEXT;
  v_result JSONB;
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

  IF p_mode IS NULL OR p_mode NOT IN ('takeover', 'retire', 'vacate') THEN
    RAISE EXCEPTION 'remove_manager: mode must be takeover, retire, or vacate (§7.2.1)'
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

  -- 120 (L.D1.10): retire-and-succeed is REAL now (§7.2.1(b) / D301 / F31).
  IF p_mode = 'retire' THEN
    -- (a) The status gate. Before the draft D42's refusal stands byte for
    --     byte (017 J pins it; a franchise has no roster or record to
    --     inherit). `in_season` (the LAW's "mid-season … audited override")
    --     and `complete` ("primarily an offseason action") proceed.
    --     `playoffs` REFUSES BY NAME: §7.2.1(b) / §11.5 print nothing about
    --     a retired franchise's bracket line (does the successor play it,
    --     or is it forfeited?) and 118's sync derives later rounds from the
    --     played rows' team ids — PROGRESS Q41 carries the question; this
    --     arm is a refusal, never a fold (R801).
    IF v_league.status IN ('setup', 'scheduled', 'drafting') THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise isn''t available before the draft — use takeover or vacate (§7.2.1; retire-and-succeed arrives with the in-season milestone)'
        USING ERRCODE = 'P0001';
    ELSIF v_league.status = 'playoffs' THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise during the playoffs is not defined yet — what the bracket does with a retired franchise''s line is PROGRESS Q41; use takeover or vacate now, or retire the franchise after the season (§7.2.1(b))'
        USING ERRCODE = 'P0001';
    ELSIF v_league.status NOT IN ('in_season', 'complete') THEN
      RAISE EXCEPTION 'remove_manager: league status % admits no retirement (§7.1)', v_league.status
        USING ERRCODE = 'P0001';
    END IF;
    -- (a′) R858: the actor's OWN seat. §7.2.1 gives the leaver no choice of
    --      outcome — leave_league is the voluntary path — and the route's
    --      self-DELETE dispatches there; a co-commissioner calling the RPC
    --      directly must not get the choice back. (A plain manager never
    --      reaches here: not a commissioner, 42501 above.)
    IF v_target.user_id = v_uid THEN
      RAISE EXCEPTION 'remove_manager: you cannot retire your own franchise — a leaver has no choice of outcome (§7.2.1); leave the league, or have the commissioner act on your seat'
        USING ERRCODE = '42501';
    END IF;
    -- (b) The audit stamp and the reason (E49 "audited override"; D290's
    --     interim posture: reason REQUIRED, stored on the ledger row).
    IF p_action_id IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retire requires action_id (idempotency key — one UUID per retirement, reused on retry; 113''s contract)'
        USING ERRCODE = '22023';
    END IF;
    v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise is an audited override — a reason is required (E49 / D290)'
        USING ERRCODE = '22023';
    END IF;
    -- (c) REPLAY by (league_id, action_id) — 113's contract (R732): the
    --     stored payload byte-identical; the same stamp on another verb or
    --     another member is a shape violation. Checked BEFORE the seat
    --     checks below: after a committed retirement the seat is an open
    --     placeholder and would otherwise refuse the retry by name.
    SELECT t.type, t.payload INTO v_replay
    FROM public.transactions t
    WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
    IF FOUND THEN
      IF v_replay.type <> 'commissioner_move'
         OR v_replay.payload ->> 'verb' IS DISTINCT FROM 'retire_franchise'
         OR (v_replay.payload ->> 'member_id')::uuid IS DISTINCT FROM p_member_id THEN
        RAISE EXCEPTION 'remove_manager: action_id % already names another action in this league — an action_id identifies ONE submit of ONE verb (R732)', p_action_id
          USING ERRCODE = '22023';
      END IF;
      RETURN v_replay.payload;
    END IF;
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
  -- vacate stays idempotent; RETIRE passes through — §7.2.1(c) is LAW
  -- ("Orphaned is a holding state that resolves into (a) or (b)") and the
  -- retire arm's (d′) decides, by the franchise's stint history, whether
  -- there is a manager to seal it under.
  IF v_target.user_id IS NULL AND p_mode <> 'retire' THEN
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
  SELECT t.id, t.name, t.status, t.successor_team_id INTO v_team
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
  ELSIF p_mode = 'retire' THEN
    -- (d) F1: the lineage this franchise sits in must be ACYCLIC before it
    --     is extended. The successor minted below is a NEW row (it cannot
    --     close a cycle by construction — said, D267), so the walk is over
    --     the PREDECESSOR chain as STORED: only privileged writes can
    --     corrupt it (D53: the column has no client writer), and a corrupt
    --     chain is refused BY NAME rather than misreported as "already
    --     sealed" (068 F; the DoD probe drops this block).
    WITH RECURSIVE lineage AS (
      SELECT t.id, 0 AS depth FROM public.teams t WHERE t.id = v_team.id
      UNION ALL
      SELECT p.id, l.depth + 1
      FROM lineage l JOIN public.teams p ON p.successor_team_id = l.id
      WHERE l.depth < 64
    ) CYCLE id SET is_cycle USING path
    SELECT l.is_cycle, array_length(l.path, 1) - 1 AS len INTO v_cycle
    FROM lineage l WHERE l.is_cycle
    ORDER BY array_length(l.path, 1) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'remove_manager: % sits in a succession CYCLE of length % (the successor_team_id chain revisits a franchise) — refused; repair the lineage before extending it (§12.22 / F1)', v_team_name, v_cycle.len
        USING ERRCODE = 'P0001';
    END IF;
    IF v_team.status = 'retired' OR v_team.successor_team_id IS NOT NULL THEN
      RAISE EXCEPTION 'remove_manager: % is already sealed (status %, successor %) — a retired franchise cannot be retired again (§7.2.1(b))', v_team_name, v_team.status, v_team.successor_team_id
        USING ERRCODE = 'P0001';
    END IF;
    -- (d′) R855: an UNMANAGED seat (vacated / left — 'orphaned', §7.2.1(c))
    --      is admitted when the franchise has a CLOSED stint: the seal
    --      names the LAST manager (History Mode reads the stints; nothing
    --      else is written under a name), no stint is open to close (the
    --      (h) UPDATE matches nothing — D63), no one is notified,
    --      removed_user_id is NULL in the payload. A franchise that has
    --      NEVER had a manager — 120's own successor until it is claimed,
    --      or a placeholder seat autopick-drafted and never claimed — has
    --      no name to seal under and refuses BY NAME.
    IF v_removed_user IS NULL THEN
      PERFORM 1 FROM public.team_managers tm
      WHERE tm.team_id = v_team.id AND tm.ended_at IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'remove_manager: % has never had a manager — there is no one to seal it under; use assign-manager to seat someone on it first (§7.2.1(b))', v_team_name
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (e) The founding week of the successor's book — the first week the
    --     league has NOT yet played: 1 + its last correction_window/final
    --     week (a reopened earlier week stays the predecessor's), else the
    --     first league week. NULL when that week does not exist (the
    --     season is over — `complete`, or every week played): nothing is
    --     re-pointed and History reads the whole book as the retired
    --     franchise's; retired_at_week / ended_week are NULL (§12.22's
    --     "NULL preseason" reading, extended to "outside the season").
    SELECT w.week INTO v_week
    FROM public.league_weeks w
    WHERE w.league_id = p_league_id AND w.season = v_league.season
      AND w.week = COALESCE(
        (SELECT max(x.week) + 1 FROM public.league_weeks x
         WHERE x.league_id = p_league_id AND x.season = v_league.season
           AND x.status IN ('correction_window', 'final')),
        (SELECT min(x.week) FROM public.league_weeks x
         WHERE x.league_id = p_league_id AND x.season = v_league.season));

    -- (f) The successor: a NEW franchise in the same slot (§7.2.1(b)),
    --     named by D74(5)'s series over the league's WHOLE franchise count
    --     (retired included — a retired franchise keeps its number, so the
    --     name cannot collide with a seat's default), owned by the acting
    --     commissioner like every placeholder (add_placeholder_seat),
    --     'orphaned': no manager until a takeover (§7.2.1(c)'s holding
    --     state; assign_manager / a seat claim return it to 'active' —
    --     D74(2)). It counts as seated in every capacity count.
    SELECT count(*)::int INTO v_franchises FROM public.teams t WHERE t.league_id = p_league_id;
    v_successor_name := 'Team ' || (v_franchises + 1)::text;
    INSERT INTO public.teams (owner_id, name, league_id, list_id, status)
    VALUES (v_uid, v_successor_name, p_league_id, NULL, 'orphaned')
    RETURNING id INTO v_successor_id;

    -- (g) SEAL the franchise: status, the partition week, the link. owner_id
    --     moves to the acting commissioner for the vacate arm's reason (the
    --     removed user's profile deletion would CASCADE the sealed franchise
    --     away — 001:495); name and record are frozen by the absence of any
    --     writer (§7.2.1(b)).
    UPDATE public.teams
    SET status = 'retired',
        retired_at_week = v_week,
        successor_team_id = v_successor_id,
        owner_id = v_uid,
        updated_at = now()
    WHERE id = v_team.id;

    -- (h) The stint closes `seat_retired` — the one §12.22 value M1 never
    --     wrote (D74(9)); the F3 close shape; a missing open stint is a
    --     no-op (D63). No stint opens: the successor has no manager yet.
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = v_week,
        end_reason = 'seat_retired',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- (i) The seat: ONE league_members row per seat, always (§12.2) — the
    --     cache row is re-pointed at the successor as an OPEN placeholder
    --     (assign_manager / a seat-targeted invite fill it). faab_balance is
    --     deliberately NOT re-seeded: (b)'s "inherits FAAB" is the seat's
    --     balance carrying, which the in-place UPDATE does for free (D301:
    --     vacuous until M5 makes the balance live; the transfer line M5 need
    --     not write is this one).
    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,
        role = 'manager',
        team_id = v_successor_id
    WHERE id = v_target.id;

    -- (j) THE INHERITANCE, every re-point COUNTED (rule 10). The roster
    --     whole (072's per-row trigger broadcasts each row on league:<id>);
    --     the CURRENT and future weeks' lineups, matchups and results — the
    --     successor's book opens at v_week; past weeks stay the
    --     predecessor's (History partitions at retired_at_week — E49).
    --     league_player_pool carries no team reference (109); transactions,
    --     lineup_actions and the draft rows are history under the
    --     predecessor. A game-day lock is per PLAYER, evaluated from
    --     nfl_games at call time (115/Q34(B)) — a re-point unlocks no one.
    UPDATE public.league_rosters SET team_id = v_successor_id
    WHERE league_id = p_league_id AND team_id = v_team.id;
    GET DIAGNOSTICS v_n_rosters = ROW_COUNT;
    IF v_week IS NOT NULL THEN
      UPDATE public.team_lineups SET team_id = v_successor_id
      WHERE team_id = v_team.id AND season = v_league.season AND week >= v_week;
      GET DIAGNOSTICS v_n_lineups = ROW_COUNT;
      UPDATE public.matchups SET home_team_id = v_successor_id, updated_at = now()
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND home_team_id = v_team.id;
      GET DIAGNOSTICS v_n_matchups = ROW_COUNT;
      UPDATE public.matchups SET away_team_id = v_successor_id, updated_at = now()
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND away_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_matchups := v_n_matchups + v_n;
      UPDATE public.team_week_results SET team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND team_id = v_team.id;
      GET DIAGNOSTICS v_n_results = ROW_COUNT;
      UPDATE public.team_week_results SET opponent_team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND opponent_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_results := v_n_results + v_n;
      UPDATE public.team_week_results SET second_opponent_team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND second_opponent_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_results := v_n_results + v_n;
    END IF;

    -- (k) The payload — also the LEDGER row's, so a replay is byte-identical.
    v_result := jsonb_build_object(
      'ok', true, 'mode', p_mode, 'verb', 'retire_franchise', 'action_id', p_action_id,
      'member_id', v_target.id, 'team_id', v_team.id,
      'removed_user_id', v_removed_user, 'successor_user_id', NULL, 'already_vacant', false,
      'retired_team_id', v_team.id, 'retired_team_name', v_team_name,
      'successor_team_id', v_successor_id, 'successor_team_name', v_successor_name,
      'season', v_league.season, 'retired_at_week', v_week, 'reason', v_reason,
      'repointed', jsonb_build_object(
        'rosters', v_n_rosters, 'lineups', v_n_lineups, 'matchups', v_n_matchups, 'results', v_n_results),
      'inherits', jsonb_build_object(
        'roster', true, 'record', 'seeding_only', 'h2h_history', false, 'faab', 'seat_balance_kept'));
    -- (l) The ledger (D290 interim; 113's shape): ONE transactions row of
    --     type commissioner_move, commissioner-initiated (no initiator team),
    --     stamped with p_action_id; 119's trigger carries it to the feed.
    INSERT INTO public.transactions
      (league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
    VALUES (p_league_id, 'commissioner_move', 'complete', NULL, v_uid, v_result, v_week, p_action_id);
    -- (m) The D97 in-transaction system post (111/113's shape).
    v_message := v_team_name || ' was retired by ' || public.draft_actor_name()
      || CASE WHEN v_removed_user IS NULL
           THEN ' — the vacant franchise is sealed under its last manager (§7.2.1(c)); '
           ELSE ' — the franchise is sealed under its final manager; ' END
      || v_successor_name
      || ' takes its slot' || CASE WHEN v_week IS NULL THEN ' after the season' ELSE ' from Week ' || v_week::text END
      || ' (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: ' || v_reason;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, v_uid, v_message, 'league', TRUE);
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

    -- 'orphaned', never 'retired': every capacity count is
    -- `status <> 'retired'`, so retiring would silently free a seat.
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

  -- §7.2.1:190 — the removed user is notified with the outcome category.
  -- 120 (R855): an unmanaged seat's retirement has no one to notify (its
  -- last manager was notified when the seat closed — vacate / leave);
  -- takeover and vacate always carry a user here (refused above otherwise).
  IF v_removed_user IS NOT NULL THEN
  PERFORM public.notify_league_member_internal(
    v_removed_user,
    'league_member',
    'You were removed from ' || v_league.name,
    CASE WHEN p_mode = 'takeover'
      THEN v_team_name || ' has a new manager. Your record with the franchise stays in its history.'
      WHEN p_mode = 'retire'
      THEN v_team_name || ' was retired by the commissioner. The franchise is sealed under your name — its record and history stay yours.'
      ELSE 'Your seat in ' || v_league.name || ' (' || v_team_name || ') was closed by the commissioner.'
    END,
    jsonb_build_object(
      'league_id', p_league_id,
      'team_id', v_team.id,
      'event', CASE WHEN p_mode = 'takeover' THEN 'replaced' WHEN p_mode = 'retire' THEN 'retired' ELSE 'removed' END));
  END IF;

  IF p_mode = 'retire' THEN
    RETURN v_result;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'mode', p_mode, 'member_id', v_target.id,
    'team_id', v_team.id, 'removed_user_id', v_removed_user,
    'successor_user_id', CASE WHEN p_mode = 'takeover' THEN p_successor_user_id ELSE NULL END,
    'already_vacant', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_manager(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 7d. leave_league — 146:603-747's FILE TEXT (D137), 3 hunks (`150 / F411`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION leave_league(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_self RECORD;
  v_team RECORD;
  v_others INTEGER;
  v_commish UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'leave_league: must be signed in'
      USING ERRCODE = '42501';
  END IF;

  -- League row FIRST: reading the caller's role under the lock means a
  -- concurrent transfer cannot make them commissioner between check and
  -- write.
  SELECT l.id, l.name, l.faab_budget, l.status INTO v_league   -- 146: + status (the C72 gate)
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT lm.id, lm.user_id, lm.team_id, lm.role INTO v_self
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: not a member of this league'
      USING ERRCODE = '42501';
  END IF;

  IF v_self.role = 'commissioner' THEN
    SELECT count(*)::int INTO v_others
    FROM public.league_members lm
    WHERE lm.league_id = p_league_id AND lm.user_id IS NOT NULL AND lm.user_id <> v_uid;
    IF v_others = 0 THEN
      -- The sole member of a league IS its commissioner, with nobody to
      -- transfer to — point at deletion rather than stranding them.
      RAISE EXCEPTION 'leave_league: you are this league''s only manager — delete the league instead of leaving it (§15.1)'
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'leave_league: transfer the commissioner role to another member before leaving (§7.2.1)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_self.team_id IS NULL THEN
    RAISE EXCEPTION 'leave_league: your membership has no franchise to hand back'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.name INTO v_team
  FROM public.teams t
  WHERE t.id = v_self.team_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: your membership has no franchise to hand back'
      USING ERRCODE = 'P0001';
  END IF;

  -- Same flow as vacate (§7.2.1:192), with end_reason='left' and ended_by
  -- = self. The leaver does not choose the franchise's outcome — the spec
  -- names no chooser for the voluntary path.
  UPDATE public.team_managers
  SET ended_at = now(),
      ended_week = NULL,
      end_reason = 'left',
      ended_by = v_uid
  WHERE team_id = v_team.id AND ended_at IS NULL;

  -- 146 (L.D2.6 / C72): the open seat keeps the franchise's balance once
  -- the draft has started; before the draft it re-seeds from the CURRENT
  -- budget (v2.8.7).
  UPDATE public.league_members
  SET user_id = NULL,
      is_placeholder = TRUE,
      role = 'manager',
      faab_balance = CASE WHEN v_league.status IN ('setup', 'scheduled')
                          THEN v_league.faab_budget ELSE faab_balance END
  WHERE id = v_self.id;

  -- The franchise passes to the sitting commissioner (owner_id is NOT NULL).
  SELECT lm.user_id INTO v_commish
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.role = 'commissioner' AND lm.user_id IS NOT NULL;

  UPDATE public.teams
  SET status = 'orphaned',
      owner_id = COALESCE(v_commish, owner_id),
      updated_at = now()
  WHERE id = v_team.id;

  -- 150 / F411 — leave is the vacate flow (§7.2.1:192), and §7.2.1(c) says
  -- "pending waiver claims cancel": the leaver's claims close with him.
  UPDATE public.waiver_claims c
  SET status = 'cancelled', result_reason = 'manager_left', cancelled_at = now(), cancelled_by = v_uid
  WHERE c.team_id = v_team.id AND c.status = 'pending';

  -- Same league-wide sweep as remove_manager (R90): a leaver who holds — or
  -- once held — a commissioner OR co-commissioner role can still own the
  -- placeholder seats they minted (add_placeholder_seat, item 3, is open to
  -- both roles) or the franchises they orphaned by vacating someone. The
  -- precondition is "ever held commissioner powers", NOT "was the sitting
  -- commissioner and transferred it away" (R100/R90 correction): a
  -- co-commissioner needs no transfer to leave, yet can own such franchises.
  -- Left behind, those sit on an ON DELETE CASCADE owner FK held by a proven
  -- non-member.
  IF v_commish IS NOT NULL THEN
    UPDATE public.teams
    SET owner_id = v_commish,
        updated_at = now()
    WHERE league_id = p_league_id
      AND owner_id = v_uid
      AND id <> v_team.id;
  END IF;

  -- Q11 (RULED 2026-07-26, Chris): notify BOTH the departing user AND the
  -- sitting commissioner. §7.2.1:190 lists `left` among the categories the
  -- departed user is notified with; the commissioner-too notification is the
  -- ruling's explicit addition (spec erratum v2.8.9). F37 discharged.
  PERFORM public.notify_league_member_internal(
    v_uid,
    'league_member',
    'You left ' || v_league.name,
    'You left ' || v_league.name || ' (' || v_team.name || '). You can be re-invited to any team later.',
    jsonb_build_object(
      'league_id', p_league_id, 'team_id', v_team.id, 'event', 'left'));

  -- The commissioner is the party who needs to act on an open seat.
  PERFORM public.notify_league_member_internal(
    v_commish,
    'league_member',
    'A manager left ' || v_league.name,
    v_team.name || ' is open — invite a replacement or assign a manager.',
    jsonb_build_object(
      'league_id', p_league_id, 'team_id', v_team.id, 'event', 'left'));

  RETURN jsonb_build_object(
    'ok', true, 'league_id', p_league_id, 'team_id', v_team.id,
    'member_id', v_self.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_league(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 7e. draft_reset — 147:396-559's FILE TEXT (D137), 1 hunk (`150 / F423`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_reset(
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft  public.drafts;
  v_undone INTEGER;
  v_faab_reseeded INTEGER;  -- 147 / F412
BEGIN
  -- LOCK ORDER (banner item 10): the DRAFTS row FIRST — serializing with
  -- in-flight picks — then the LEAGUES row. Taking leagues first would
  -- recreate the R122 FK-KEY-SHARE cycle against a pick in flight.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- MS.2/100 — GATE ORDER (D217(5)/E75): member floor → (real draft ⇒
  -- commissioner) → (mock ⇒ launcher, the ONE gate helper). The
  -- real-draft refusal below is byte-identical to the pre-100 text (§4
  -- rule 13; 023/036 pin it): a member-but-not-commissioner, a non-member
  -- and a nonexistent draft all still answer this same 42501 (no-leak).
  -- The floor's standalone arm reuses D226(3)'s ONE ownership predicate
  -- via is_standalone_mock_launcher (095); is_league_member(NULL) and
  -- is_standalone_mock_launcher(NULL) are both FALSE — fail closed.
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id))
     OR (NOT v_draft.is_mock AND NOT public.is_league_commish(v_draft.league_id)) THEN
    RAISE EXCEPTION 'draft_reset: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_reset');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — the ONE live-proven §8.8 breach (writes leagues.status + settings, broadcasts league:<id>); MS.4/D220 owns the mock-safe-variant decision.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_reset: a practice cannot be reset — delete it and start a new one (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_reset: the draft is complete — a post-completion reset is an audited override that arrives with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_reset: the draft has not started — nothing to reset'
      USING ERRCODE = 'P0001';
  END IF;

  -- Now the league row (drafts → leagues — see the banner's lock-order
  -- analysis).
  PERFORM 1 FROM public.leagues l
  WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_reset: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Soft-undo every live pick (§12.4 audit trail; pool return is the
  -- partial index).
  UPDATE public.draft_picks
  SET is_undone = TRUE
  WHERE draft_id = p_draft_id AND is_undone = FALSE;
  GET DIAGNOSTICS v_undone = ROW_COUNT;

  -- 087/R379 — D162 situation (c): THIS RUN'S BID HISTORY ENDS HERE. The
  -- reset rewinds current_pick_number to 1 and draft_start re-issues the same
  -- sequence numbers over rows that are still `voided_at IS NULL`, so leaving
  -- them live merges two runs' nominations under one seq for every reader
  -- keyed on it — the same merge D143 creates within a run, at run scale.
  -- Rows are KEPT and STAMPED, never deleted: §12.5 is append-only and the
  -- previous run's history is audit (the draft_picks soft-undo above is the
  -- same posture, one table over). A direct sweep rather than
  -- draft_void_nomination_internal, because that helper voids the LIVE
  -- nomination only (by seq + player) and what ends here is the whole run.
  -- NOT restricted to auctions: a snake draft simply has no draft_bids rows,
  -- so the statement is a measured no-op there rather than a branch.
  UPDATE public.draft_bids SET voided_at = now()
  WHERE draft_id = p_draft_id AND voided_at IS NULL;

  -- The system post BEFORE the drafts-row context anchor changes nothing —
  -- same txn; written first so the room's transcript reads
  -- action-then-state.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Draft reset by ' || public.draft_actor_name() || ' — ' || v_undone
          || ' picks cleared; the draft is back to scheduled. Re-schedule it in Draft setup or start it manually when ready.',
          'draft:' || p_draft_id::text, TRUE);

  -- The drafts row back to pre-draft. draft_order KEPT (D101 — the shown
  -- order survives a reset; manual/custom orders are not lost).
  UPDATE public.drafts SET
    status                = 'scheduled',
    current_round         = 1,
    current_pick_number   = 1,
    on_clock_team_id      = NULL,
    current_deadline      = NULL,
    paused_at             = NULL,
    deadline_remaining_ms = NULL,
    started_at            = NULL,
    completed_at          = NULL,
    -- 087/L.C1.5 — R302, the auction-hygiene half. Without these two a reset
    -- mid-BIDDING resurrects a ghost nomination on restart (D126's phase rule
    -- reads current_nomination, and draft_start does not clear it), and the
    -- league restarts carrying live-draft budget corrections that belong to
    -- the draft they corrected. §8.7's own row says a reset returns to
    -- pre-draft; these are pre-draft's values. NULL/'{}' on a snake draft too
    -- — they are already that, so the snake path is unchanged.
    current_nomination    = NULL,
    budget_adjustments    = '{}'::jsonb,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- Fresh room state: this draft's heartbeats go too (the outage arm's
  -- "supervision established" memory starts clean on a re-run — D108).
  DELETE FROM public.draft_liveness WHERE draft_id = p_draft_id;

  -- League back to 'scheduled' (§8.7's own row; §7.1's re-open arrow; the
  -- D43 guard is indifferent — the snapshot survives) AND the stored
  -- auto-start instant REMOVED — the D107(5) seam closure: a PAST
  -- draft_scheduled_at would re-start this draft on the next 5s tick
  -- (D94). Auto-start re-arms only when the commissioner re-schedules
  -- through the settings picker; the Start button works without an
  -- instant (066 create-if-absent).
  UPDATE public.leagues SET
    status     = 'scheduled',
    settings   = settings #- '{draft,draft_scheduled_at}',
    waiver_next_run_at = NULL,   -- 150 / F423: back to pre-draft — no waiver run is pending until the league is back in season
    updated_at = now()
  WHERE id = v_draft.league_id;

  -- 147 / F412 — back to pre-draft, so balances track the budget again
  -- (§12.2 v2.8.7): every seat re-seeded to the CURRENT budget, the same
  -- statement shape as the pre-draft budget change (118:2617-2621 / 144's
  -- step 12b). Without it a budget changed during the draft (which leaves
  -- balances alone, 144) survives the reset as uneven starting FAAB.
  -- Counted: only seats whose balance actually differed are written.
  UPDATE public.league_members m
  SET faab_balance = l.faab_budget
  FROM public.leagues l
  WHERE l.id = v_draft.league_id
    AND m.league_id = l.id
    AND m.faab_balance IS DISTINCT FROM l.faab_budget;
  GET DIAGNOSTICS v_faab_reseeded = ROW_COUNT;

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'reset', TRUE,
    'picks_cleared', v_undone,
    'faab_reseeded_seats', v_faab_reseeded);  -- 147 / F412
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_reset(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 8. waiver_claim_edit_internal + waiver_claim_edit — F417: change a pending
--     claim's bid and drop IN PLACE, in ONE transaction (the three-call
--     cancel / resubmit / move-back of D387(5) could leave the old claim
--     cancelled between steps). The 145 verb template: shape → league row
--     FOR UPDATE → the claim under it → auth on its team (manager, or a
--     commissioner for any team — TD5; ONE no-leak 42501) → replay (its own
--     verb in the shared namespace, R732) → re-read → refuse by name →
--     write → receipt (commissioner only) → ledger.
--     The edit SETS both fields (p_bid NULL = $0, p_drop NULL = no drop).
--     Validity is submit's, re-checked under the lock: in season, the team
--     not retired, waivers on, the drop on THIS team, the bid within
--     [faab_min_bid, balance] in FAAB and $0 under a priority type, no OTHER
--     pending claim of the team for the same add + drop. A pending claim only
--     (cancelled / settled refused by name). The add is not editable — a
--     different player is a different claim. Same bid + same drop = a no-op
--     (no write, no receipt — standing rule (b)). The claim keeps its
--     identity, its created_at and — among equal bids — its place; in a FAAB
--     league the team's order is re-derived from the bids (F422(b): a new
--     bid can move it), exactly as submit does.
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
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'waiver_claim_edit: % is retired — a sealed franchise makes no claims (§7.2.1)', v_team.name
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
        'waiver_claim_edit: % has no FAAB balance on record (its league_members seat %) — refusing to accept a bid against money that is not recorded (§12.2)',
        v_team.name, CASE WHEN v_has_seat IS NULL THEN 'is missing' ELSE 'holds NULL' END
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
REVOKE EXECUTE ON FUNCTION waiver_claim_edit_internal(UUID, UUID, INTEGER, TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION waiver_claim_edit(
  p_league_id UUID,
  p_claim_id  UUID,
  p_bid       INTEGER DEFAULT NULL,   -- NULL = $0
  p_drop      TEXT DEFAULT NULL,      -- NULL = no drop
  p_action_id UUID DEFAULT NULL,      -- REQUIRED in-body (22023)
  p_reason    TEXT DEFAULT NULL       -- OPTIONAL (Q66); stored only on the commissioner arm
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.waiver_claim_edit_internal(p_league_id, p_claim_id, p_bid, p_drop, p_action_id, now(), p_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_edit(UUID, UUID, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION waiver_claim_edit(UUID, UUID, INTEGER, TEXT, UUID, TEXT) IS
  '§13.2 (migration 150, L.D2.9; F417): change a pending claim''s bid and drop in one transaction (sets both — p_bid NULL = $0, p_drop NULL = no drop). The team''s manager, or a commissioner for any team (one blind-safe commissioner_actions row). Submit''s validity rules re-checked; same bid + drop = no-op (no receipt); in a FAAB league the team''s order is re-derived from the bids (F422(b)); replay by action_id is byte-identical.';

-- ---------------------------------------------------------------------------
-- 9. ONE-TIME: pending FAAB claims renumbered to the bid order (F422(b)) —
--    biggest bid first, the manager's own order kept between equal bids.
--    The resolver ranks by bid regardless; this makes the stored order say
--    so. Counted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE waiver_claims c
  SET claim_order = o.rn
  FROM (SELECT c2.id, row_number() OVER (PARTITION BY c2.team_id
                                          ORDER BY c2.faab_bid DESC, c2.claim_order, c2.created_at, c2.id)::int AS rn
        FROM waiver_claims c2
        JOIN leagues l ON l.id = c2.league_id
        WHERE c2.status = 'pending' AND COALESCE(l.waiver_type, 'faab') = 'faab') o
  WHERE c.id = o.id AND c.claim_order <> o.rn;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '150: % pending FAAB claim row(s) renumbered to the bid order (F422(b))', v_n;
END $$;

-- ---------------------------------------------------------------------------
-- 10. pg_cron — `process-waivers`, every minute (TD6; the 116:1339 shape,
--     unschedule-first). The tick self-gates: nothing due ⇒ it says so.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-waivers') THEN
    PERFORM cron.unschedule('process-waivers');
  END IF;
  PERFORM cron.schedule('process-waivers', '* * * * *', 'SELECT public.waiver_tick()');
END;
$do$;
