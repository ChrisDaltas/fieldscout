-- ============================================================================
-- 156_commish_force_or_reverse_trade.sql — the commissioner approves, vetoes,
-- forces or reverses a trade (`commish_force_or_reverse_trade`) (M5 task
-- L.D3.5, FULL rigour — roster exclusivity, FAAB, permissions).
-- Spec §10.1 Transactions ("Approve/veto/force a pending trade; reverse a
-- completed trade"), §13.3 ("Commissioner overrides: force-approve, veto, or
-- reverse a completed trade (restores both rosters atomically) — each
-- audited"), §15.4 (`POST /commish/trade → commish_force_or_reverse_trade(
-- trade_id, op, reason)`), §10.3 (the receipt + the non-disableable post),
-- E11 ("Both rosters restored atomically; exclusivity preserved; audited").
-- Breakdown tasks-M5-transactions.md §6 L.D3.5, TD5 / TD9 / TD10 / TD16, §4
-- rules; PROGRESS D336 (the template, seven parts), D350 (own ledger), D352 /
-- F340 (this verb, deferred to M5 for want of a subject — discharged here),
-- F436 (approve goes through the executor — discharged here), D410 (151's
-- executor), D415 (a league-vote trade: the commissioner decides, votes stop
-- mattering), standing rules (a) / (b) / (i), Q66 (reason optional), F440
-- (a commissioner's deliberate move is not second-guessed).
--
-- Numbering: RESERVED by the orchestrator (156 / pgTAP 104). NOT held:
-- reaches production by `npx supabase db push` only (push debt 135–156).
--
-- WHAT THIS MIGRATION DOES
--   1. `commish_trade_actions` — this verb's OWN zero-policy replay ledger
--      (D350 / D336 part 1), `UNIQUE (league_id, action_id)` + REVOKE
--      TRUNCATE. It stores the op and the trade, so an action_id re-sent
--      with another op or trade is refused by name (R732), never replayed.
--   2. `trade_execute_internal` — CREATE OR REPLACE against 153:2546-3005's
--      FILE TEXT (D137; md5 of those lines 78ea81dd627942efcbc1f391d2b50250
--      at task time — 153 is the newest definer: `grep -n "FUNCTION
--      trade_execute_internal" supabase/migrations/*.sql | tail -1`). ONE
--      hunk, the game-day lock's IF: a call whose `p_via` is
--      'commissioner_force' goes past the lock (it executes now instead of
--      deferring or failing). Every VALIDITY check above it is unchanged and
--      still binds the force. Nothing else in the body moves.
--   3. `commish_trade_reverse_internal` — E11's writes: every player back to the
--      team that gave him (the one roster row changes team — exclusivity
--      holds at every instant), every player dropped as part of the trade
--      back on the team that dropped him, every FAAB leg returned, the
--      lineups of the first UNFINISHED week on (past weeks untouched), the
--      trade `reversed`. Refuses BY NAME, before any write, when the trade
--      cannot be undone as a whole (below).
--   4. `commish_force_or_reverse_trade_internal` + the DEFINER door
--      `commish_force_or_reverse_trade` — D336's seven parts (mapped below);
--      `commish_trade_closed_words_internal` words a closed trade's state
--      for the refusals.
--
-- ---------------------------------------------------------------------------
-- THE FOUR OPS, SAID ONCE (PROGRESS D416)
-- ---------------------------------------------------------------------------
-- approve  A trade IN REVIEW (commissioner review OR a league vote — D415:
--          the commissioner decides; votes stop mattering) goes to 151's
--          executor as `trade_execute_internal(trade, p_at,
--          'commissioner_approve')` (F436): it re-validates everything, waits
--          for the game-day lock (Q75 — deferred, `accepted` with
--          `execute_after`) and records the trade. This verb never moves a
--          roster for an approve. An `accepted` trade (review already over,
--          waiting for the week's last game) or a `complete` one is a NO-OP
--          (already approved). A trade not yet accepted, or closed, is
--          refused by name with the route that does apply.
-- veto     A trade IN REVIEW or ACCEPTED (incl. deferred — F436) is closed
--          `vetoed` with the reason ("vetoed by the commissioner" + his
--          reason when he gave one); both managers told. A `vetoed` trade is
--          a NO-OP (the task's own example). An offer not yet accepted is
--          refused (§12.11's shape: `vetoed` carries an acceptance — the
--          receiving team rejects it, and the commissioner can reject for
--          it through `trade_respond`); a `complete` one is refused pointing
--          at `reverse`.
-- force    Execute NOW, standing outside the TIMING rules (task text,
--          standing rule (i)): the review period (and a league vote), the
--          trade deadline, and the game-day lock. Applies to a trade in
--          flight (`proposed` / `accepted` / `in_review` — §10.1 "a pending
--          trade") and to an offer that EXPIRED at the deadline (the only
--          thing that closed it was the deadline — a timing rule). For a
--          `proposed` / `expired` offer the commissioner accepts it FOR the
--          receiving team (standing rule (a); the TD5 arm's power), with no
--          drops named for it — its roster must fit without them, refused
--          in the force's own words first. Then the same executor runs, via
--          'commissioner_force' (§2's hunk). VALIDITY still binds (rule
--          (i)): every player on the team that gives him, both rosters
--          within roster_size, each FAAB leg within its giver's balance,
--          neither team retired, the league in season. A trade the executor
--          finds invalid is REFUSED BY NAME and nothing is written — the
--          trade stays as it was, so he can make room (commish_force_add_
--          drop) and force again. A trade a party closed (rejected /
--          cancelled), a veto, an invalid, a reversed or a complete trade is
--          refused by name — those are decisions or validity, not timing.
-- reverse  A `complete` trade is undone as a whole (E11) — or refused BY NAME
--          before any write when it cannot be: a player it moved is no
--          longer on the roster it put him on (exclusivity is a validity
--          rule — it binds the commissioner too; the refusal names the
--          player and points at `commish_move_player`); a player it dropped
--          is now on ANOTHER team's roster (same); the team that received a
--          FAAB leg no longer holds that much (a balance is never negative
--          — `commish_edit_faab`); a roster would go over roster_size
--          (`commish_force_add_drop`); a party is retired (sealed, §7.2.1).
--          PAST WEEKS' LINEUPS AND SCORES ARE UNTOUCHED (task text): lineups
--          change from the first week that is not finished — the executor's
--          own week rule (151 / 153) — and nothing is re-scored. A player
--          who already played in a week still being played leaves that
--          week's lineup with the rest (the F440 ruling: a commissioner's
--          deliberate move is not second-guessed). Returned players land on
--          the bench as `commissioner` acquisitions. A `reversed` trade is a
--          NO-OP; anything that never went through is refused by name.
--
-- D336's SEVEN PARTS, AND WHERE EACH ONE IS
--   (1) the ledger      → §1, `commish_trade_actions` (its own namespace)
--   (2) ONE audit row   → step (8), `log_commissioner_action_internal`
--                         (123:417-453) INSIDE the no-op guard, AFTER the
--                         state write, `IF v_audit_id IS NULL THEN RAISE`;
--                         action_type approve_trade / veto_trade /
--                         force_trade / reverse_trade, target `trade`,
--                         `{status}` before / after (148's trade receipts'
--                         key set), acting_as_team_id NULL (an override,
--                         not acting as a manager — 139 / 147's shape)
--   (3) the no-op       → step (6), DETECTED from the trade's stored status
--                         (the state each op aims at already holds); the
--                         ledger row is written anyway, the audit row not
--   (4) the chat post   → step (9), in-txn, non-disableable (§10.3), and
--                         both managers told (TD16) — never the actor
--   (5) the posture     → PLAIN `search_path=''` internals taking `p_at`,
--                         triple-REVOKEd, under a SECURITY DEFINER door
--                         passing `now()` (D307(3)); `leagues FOR UPDATE`
--                         FIRST, then the trade `FOR UPDATE`; in-body auth
--                         as ONE no-leak 42501; replay AFTER auth, BEFORE
--                         every business gate
--   (6) the reason      → OPTIONAL (Q66 / 131): normalised in the explicit
--                         E' \t\r\n' class, ≤ 500, never required
--   (7) the result      → echoes `verb` / `op` / `action_id` / `trade_id`
--                         (the route's F65(b) identity guard), the status
--                         before / after, what the executor or the reversal
--                         did, `bypassed` WITH its why, and
--                         `commissioner_action_id` — NULL on a no-op
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Additive: one new table (RLS on, ZERO policies, TRUNCATE revoked; 045's
--   census 86 → 87), four new functions; ONE function replaced
--   (`trade_execute_internal`, 1 hunk vs 153's file text — signature
--   unchanged, REVOKE restated). Typegen additive (the table, the door).
--   Grants (D18 → D23 → 133): the door REVOKEd from PUBLIC + anon, EXECUTE
--   for authenticated (the in-body gate is the authorization); the internals
--   REVOKEd from PUBLIC, anon, authenticated.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–156 and the full pgTAP run in the PR. D38 realtime —
--   nothing new is broadcast (a trade's status change already is, 148; a
--   reversal's roster moves through 072's roster broadcast; its
--   transactions row through 119). No backfill.
--
-- DEPLOY ORDER: no app code calls anything new here (the commissioner trade
-- route is L.D3.6), so the app deploys safely ahead of `db push`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_trade_actions — this verb's OWN replay ledger (D350). Never
--    shared with another ledger and never commissioner_actions (§12.12 ships
--    a client INSERT policy, 123:333-335, so a pre-planted row carrying a
--    to-be-sent action_id would replay as an act nobody performed).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commish_trade_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  trade_id   UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  op         TEXT NOT NULL
             CONSTRAINT commish_trade_actions_op_check CHECK (op IN ('approve', 'veto', 'force', 'reverse')),
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commish_trade_actions_unique UNIQUE (league_id, action_id)   -- the race backstop behind the select-then-insert
);
CREATE INDEX IF NOT EXISTS idx_commish_trade_actions_trade ON commish_trade_actions(trade_id);

COMMENT ON TABLE commish_trade_actions IS
  'Idempotency ledger for commish_force_or_reverse_trade (migration 156, D350). ZERO policies: the DEFINER verb is the only reader and writer. NOT the audit log — §12.26: "an action_id is an idempotency key, not an audit record" — so a row is written for a NO-OP too, while commissioner_actions is not. The stored op + trade refuse a cross-request reuse of an action_id (R732).';

ALTER TABLE commish_trade_actions ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON TABLE commish_trade_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. trade_execute_internal — CREATE OR REPLACE against 153:2546-3005's FILE
--    TEXT (D137). ONE hunk, marked `156 / L.D3.5`: the game-day lock's IF
--    lets a 'commissioner_force' call through. Everything else verbatim.
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
      RAISE EXCEPTION 'trade_execute: the league is % — a trade goes through only while the league is in season or in the playoffs (§7.1 / §13.3)',
        CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' ELSE v_league.status END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_proposer.status = 'retired' OR v_recipient.status = 'retired' THEN
      RAISE EXCEPTION 'trade_execute: % is retired — a sealed franchise makes no trades (§7.2.1)',
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
        RAISE EXCEPTION 'trade_execute: % has no FAAB balance on record to receive $% into (§12.2)',
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
        'the trade could not go through: ' || v_names || ' already kicked off this week and cannot change teams until the week''s last game ends — this league fails such a trade instead of waiting (trade_lock_behavior = reject, E35)',
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
          v_summary || ' — ' || v_names || ' already played this week, so the whole trade goes through right after the week''s last game ends (E35); until then every player stays with his team',
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

-- ---------------------------------------------------------------------------
-- 2b. commish_trade_closed_words_internal — a closed trade's state in words,
--     for the refusals (every refusal names what the trade is and why).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_trade_closed_words_internal(p_trade public.trades)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE p_trade.status
    WHEN 'complete' THEN 'completed'
    WHEN 'invalid'  THEN 'called off (' || COALESCE(p_trade.status_reason, 'no reason recorded') || ')'
    ELSE p_trade.status || ' (' || COALESCE(p_trade.status_reason, 'no reason recorded') || ')' END;
$$;
REVOKE EXECUTE ON FUNCTION commish_trade_closed_words_internal(public.trades) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. commish_trade_reverse_internal — E11: undo a COMPLETE trade as a whole. The
--    caller holds the league lock and the trade row. Every refusal is a
--    P0001 BY NAME raised BEFORE the first write (validity binds the
--    commissioner too — standing rule (i)); a broken invariant after the
--    writes raises and rolls everything back. Returns what moved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_trade_reverse_internal(p_trade_id UUID, p_league public.leagues, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_verb        CONSTANT TEXT := 'commish_force_or_reverse_trade';
  v_trade       public.trades;
  v_proposer    public.teams;
  v_recipient   public.teams;
  v_roster_size INTEGER;
  v_current     INTEGER;
  v_week_end    TIMESTAMPTZ;
  v_from_week   INTEGER;
  v_leg         RECORD;
  v_drop        RECORD;
  v_holder      public.league_rosters;
  v_holder_team public.teams;
  v_side        RECORD;
  v_bal         INTEGER;
  v_count       INTEGER;
  v_after       INTEGER;
  v_recv_after  INTEGER;
  v_cnt         INTEGER;
  v_expected    JSONB := '{}'::jsonb;
  v_restore     TEXT[] := ARRAY[]::text[];     -- drops going back (team_id|player_id)
  v_back        JSONB := '[]'::jsonb;          -- drops already back on their team
  v_moves       JSONB := '[]'::jsonb;
  v_drops_in    JSONB := '[]'::jsonb;
  v_faab        JSONB := '[]'::jsonb;
  v_lineups     JSONB := '[]'::jsonb;
  v_team        UUID;
  v_out         TEXT[];
  v_in          TEXT[];
  v_pid         TEXT;
  v_row         public.team_lineups;
  v_map         JSONB;
  v_starters    JSONB;
  v_bench       JSONB;
  v_key         TEXT;
  v_changed     BOOLEAN;
BEGIN
  IF p_trade_id IS NULL OR p_league.id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'commish_trade_reverse: the trade, the league and the instant (p_at — the TimeProvider seam) are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id AND t.league_id = p_league.id FOR UPDATE;
  IF NOT FOUND OR v_trade.status <> 'complete' THEN
    RAISE EXCEPTION 'commish_trade_reverse: trade % is not a complete trade of league % — only a trade that went through can be reversed',
      p_trade_id, p_league.id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_proposer FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
  SELECT t.* INTO v_recipient FROM public.teams t WHERE t.id = v_trade.recipient_team_id;

  -- ---- VALIDATE (no write above this line) --------------------------------
  -- (a) A retired franchise is SEALED (§7.2.1, spec:183) — its roster is
  --     frozen and its seat moved to its successor. A legality gate.
  IF v_proposer.status = 'retired' OR v_recipient.status = 'retired' THEN
    RAISE EXCEPTION
      '%: % is retired — a sealed franchise''s roster is frozen (§7.2.1), so this trade cannot be reversed; move players one at a time with commish_move_player instead',
      v_verb, CASE WHEN v_proposer.status = 'retired' THEN v_proposer.name ELSE v_recipient.name END
      USING ERRCODE = 'P0001';
  END IF;

  -- (b) EXCLUSIVITY (rule 7): every player the trade moved is still on the
  --     roster it put him on. A validity rule — it binds the commissioner.
  FOR v_leg IN
    SELECT i.player_id, i.from_team_id, i.to_team_id, p.full_name
    FROM public.trade_items i JOIN public.players p ON p.id = i.player_id
    WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL
    ORDER BY p.full_name, i.player_id
  LOOP
    SELECT r.* INTO v_holder FROM public.league_rosters r
    WHERE r.league_id = p_league.id AND r.player_id = v_leg.player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % is no longer on %''s roster — he is on no roster in this league now — so the trade cannot be reversed as a whole (player exclusivity binds the commissioner too); move players one at a time with commish_move_player instead',
        v_verb, v_leg.full_name,
        CASE WHEN v_leg.to_team_id = v_proposer.id THEN v_proposer.name ELSE v_recipient.name END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_holder.team_id <> v_leg.to_team_id THEN
      SELECT t.* INTO v_holder_team FROM public.teams t WHERE t.id = v_holder.team_id;
      RAISE EXCEPTION
        '%: % is no longer on %''s roster — he is on %''s now — so the trade cannot be reversed as a whole (player exclusivity binds the commissioner too); move players one at a time with commish_move_player instead',
        v_verb, v_leg.full_name,
        CASE WHEN v_leg.to_team_id = v_proposer.id THEN v_proposer.name ELSE v_recipient.name END,
        v_holder_team.name
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (c) THE DROPS (E36 / TD13): each goes back to the team that dropped him
  --     — unless he is already there (nothing to do). If another team has
  --     him now he cannot come back (exclusivity), and the refusal says so.
  FOR v_drop IN
    SELECT d.team_id, d.player_id, p.full_name
    FROM public.trade_drops d JOIN public.players p ON p.id = d.player_id
    WHERE d.trade_id = p_trade_id
    ORDER BY p.full_name, d.player_id
  LOOP
    SELECT r.* INTO v_holder FROM public.league_rosters r
    WHERE r.league_id = p_league.id AND r.player_id = v_drop.player_id;
    IF NOT FOUND THEN
      v_restore := v_restore || (v_drop.team_id::text || '|' || v_drop.player_id);
    ELSIF v_holder.team_id = v_drop.team_id THEN
      v_back := v_back || jsonb_build_array(jsonb_build_object('team_id', v_drop.team_id, 'player_id', v_drop.player_id, 'name', v_drop.full_name));
    ELSE
      SELECT t.* INTO v_holder_team FROM public.teams t WHERE t.id = v_holder.team_id;
      RAISE EXCEPTION
        '%: % was dropped by % as part of this trade and is on %''s roster now, so he cannot go back and the trade cannot be reversed as a whole (player exclusivity binds the commissioner too); move players one at a time with commish_move_player instead',
        v_verb, v_drop.full_name,
        CASE WHEN v_drop.team_id = v_proposer.id THEN v_proposer.name ELSE v_recipient.name END,
        v_holder_team.name
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (d) THE FAAB LEGS: the team that received the money gives it back — it
  --     must still hold it (a balance is never negative, 145's CHECK), and
  --     the team it returns to must have a balance to land in.
  FOR v_leg IN
    SELECT i.faab_amount, i.from_team_id, i.to_team_id FROM public.trade_items i
    WHERE i.trade_id = p_trade_id AND i.faab_amount IS NOT NULL
    ORDER BY i.from_team_id
  LOOP
    v_bal := NULL;
    SELECT m.faab_balance INTO v_bal FROM public.league_members m
    WHERE m.league_id = p_league.id AND m.team_id = v_leg.to_team_id;
    IF v_bal IS NULL OR v_bal < v_leg.faab_amount THEN
      RAISE EXCEPTION
        '%: % received $% of FAAB in this trade and holds % now, so it cannot give it back (a FAAB balance is never negative) — set the balances with commish_edit_faab first, or move players one at a time with commish_move_player',
        v_verb, CASE WHEN v_leg.to_team_id = v_proposer.id THEN v_proposer.name ELSE v_recipient.name END,
        v_leg.faab_amount, COALESCE('$' || v_bal, 'no recorded balance')
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.league_members m
                   WHERE m.league_id = p_league.id AND m.team_id = v_leg.from_team_id AND m.faab_balance IS NOT NULL) THEN
      RAISE EXCEPTION '%: % has no FAAB balance on record to take back the $% it gave (§12.2)',
        v_verb, CASE WHEN v_leg.from_team_id = v_proposer.id THEN v_proposer.name ELSE v_recipient.name END, v_leg.faab_amount
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (e) ROSTER SIZE (§7.3.2): each roster fits after the reversal — a team
  --     that added players since may not have room to take its players back.
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(p_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((p_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(p_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;
  FOR v_side IN
    SELECT * FROM (VALUES (v_proposer.id, v_proposer.name), (v_recipient.id, v_recipient.name)) AS s(team_id, team_name)
  LOOP
    SELECT count(*)::int INTO v_count FROM public.league_rosters r
    WHERE r.league_id = p_league.id AND r.team_id = v_side.team_id;
    v_after := v_count
      - (SELECT count(*)::int FROM public.trade_items i WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL AND i.to_team_id = v_side.team_id)
      + (SELECT count(*)::int FROM public.trade_items i WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL AND i.from_team_id = v_side.team_id)
      + (SELECT count(*)::int FROM unnest(v_restore) x WHERE split_part(x, '|', 1) = v_side.team_id::text);
    IF v_after > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster would hold % players after the reversal — % more than its % spots (§7.3.2 roster_size); free room first with commish_force_add_drop (a roster over its league''s size binds the commissioner too)',
        v_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
    v_expected := v_expected || jsonb_build_object(v_side.team_id::text, v_after);
  END LOOP;

  -- The first week NOT FINISHED (151 / 153's executor rule — past weeks'
  -- lineups and scores are untouched).
  v_current := public.lineup_current_week_internal(p_league.id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION '%: league % has no league_weeks rows — no season calendar to place the reversal in (§12.17)', v_verb, p_league.id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
  WHERE w.season = p_league.season AND w.week = v_current;
  v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;

  -- ---- WRITE ---------------------------------------------------------------
  -- (1) THE PLAYERS BACK — the ONE roster row changes team (it never leaves
  --     the league, so the (league, player) UNIQUE holds at every instant);
  --     on the bench, as a commissioner acquisition, any IR stint ended with
  --     the team he leaves (127's move shape). 148's E37 trigger invalidates
  --     any OTHER in-flight trade still naming him from the team he leaves.
  FOR v_leg IN
    SELECT i.player_id, i.from_team_id, i.to_team_id, p.full_name
    FROM public.trade_items i JOIN public.players p ON p.id = i.player_id
    WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL
    ORDER BY i.player_id
  LOOP
    UPDATE public.league_rosters r
    SET team_id = v_leg.from_team_id, slot_key = 'bn', acquisition_type = 'commissioner', acquisition_cost = 0,
        ir_placed_week = NULL, ir_lock_until_week = NULL, acquired_at = p_at
    WHERE r.league_id = p_league.id AND r.player_id = v_leg.player_id AND r.team_id = v_leg.to_team_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '%: moving % back from % touched % roster rows, expected 1', v_verb, v_leg.player_id, v_leg.to_team_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league.id, v_leg.player_id, 'rostered', NULL, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
    v_moves := v_moves || jsonb_build_array(jsonb_build_object(
      'player_id', v_leg.player_id, 'name', v_leg.full_name,
      'from_team_id', v_leg.to_team_id, 'to_team_id', v_leg.from_team_id));
  END LOOP;

  -- (2) THE DROPS BACK — a fresh roster row on the team that dropped him
  --     (nobody holds him: checked above, under the league lock).
  FOR v_drop IN
    SELECT split_part(x, '|', 1)::uuid AS team_id, split_part(x, '|', 2) AS player_id, p.full_name
    FROM unnest(v_restore) x JOIN public.players p ON p.id = split_part(x, '|', 2)
    ORDER BY 2
  LOOP
    INSERT INTO public.league_rosters (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
    VALUES (p_league.id, v_drop.team_id, v_drop.player_id, 'bn', 'commissioner', 0, p_at);
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league.id, v_drop.player_id, 'rostered', NULL, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
    v_drops_in := v_drops_in || jsonb_build_array(jsonb_build_object(
      'team_id', v_drop.team_id, 'player_id', v_drop.player_id, 'name', v_drop.full_name));
  END LOOP;

  -- (3) THE FAAB LEGS BACK — debit the team that received (never below zero:
  --     the WHERE and 145's CHECK), credit the team that gave; one row each.
  FOR v_leg IN
    SELECT i.faab_amount, i.from_team_id, i.to_team_id FROM public.trade_items i
    WHERE i.trade_id = p_trade_id AND i.faab_amount IS NOT NULL
    ORDER BY i.from_team_id
  LOOP
    UPDATE public.league_members m
    SET faab_balance = m.faab_balance - v_leg.faab_amount
    WHERE m.league_id = p_league.id AND m.team_id = v_leg.to_team_id AND m.faab_balance >= v_leg.faab_amount
    RETURNING m.faab_balance INTO v_after;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '%: taking back $% from % touched % seat rows, expected 1 (the balance was checked a moment ago)',
        v_verb, v_leg.faab_amount, v_leg.to_team_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.league_members m
    SET faab_balance = m.faab_balance + v_leg.faab_amount
    WHERE m.league_id = p_league.id AND m.team_id = v_leg.from_team_id AND m.faab_balance IS NOT NULL
    RETURNING m.faab_balance INTO v_recv_after;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '%: returning $% to % touched % seat rows, expected 1', v_verb, v_leg.faab_amount, v_leg.from_team_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    v_faab := v_faab || jsonb_build_array(jsonb_build_object(
      'amount',       v_leg.faab_amount,
      'from_team_id', v_leg.to_team_id,   'from_before', v_after + v_leg.faab_amount, 'from_after', v_after,
      'to_team_id',   v_leg.from_team_id, 'to_before',   v_recv_after - v_leg.faab_amount, 'to_after', v_recv_after));
  END LOOP;

  -- (4) THE LINEUPS (TD10; the executor's loop, 151 / 153, with the sides
  --     swapped): per team, from the first unfinished week on, every player
  --     leaving it is cleared from the slot map / starters / bench and every
  --     player arriving goes on the bench. Weeks before v_from_week are not
  --     read and not written — past lineups and scores are untouched.
  FOREACH v_team IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
    SELECT COALESCE(array_agg(i.player_id ORDER BY i.player_id), ARRAY[]::text[]) INTO v_out
    FROM public.trade_items i
    WHERE i.trade_id = p_trade_id AND i.to_team_id = v_team AND i.player_id IS NOT NULL;
    SELECT COALESCE(array_agg(q.pid ORDER BY q.pid), ARRAY[]::text[]) INTO v_in
    FROM (SELECT i.player_id AS pid FROM public.trade_items i
          WHERE i.trade_id = p_trade_id AND i.from_team_id = v_team AND i.player_id IS NOT NULL
          UNION
          SELECT split_part(x, '|', 2) FROM unnest(v_restore) x WHERE split_part(x, '|', 1) = v_team::text) q;
    FOR v_row IN
      SELECT tl.* FROM public.team_lineups tl
      WHERE tl.team_id = v_team AND tl.season = p_league.season AND tl.week >= v_from_week
      ORDER BY tl.week
      FOR UPDATE
    LOOP
      v_map := COALESCE(v_row.slot_map, '{}'::jsonb);
      v_starters := COALESCE(v_row.starters, '[]'::jsonb);
      v_bench := COALESCE(v_row.bench, '[]'::jsonb);
      v_changed := FALSE;
      FOREACH v_pid IN ARRAY v_out LOOP
        v_key := NULL;
        SELECT e.key INTO v_key FROM jsonb_each_text(v_map) e WHERE e.value = v_pid LIMIT 1;
        IF v_key IS NOT NULL THEN
          v_map := v_map - v_key;
          SELECT COALESCE(jsonb_agg(
                   CASE WHEN s ->> 'slot' = v_key
                        THEN s || jsonb_build_object('player_id', NULL, 'position', NULL, 'kickoff_at', NULL, 'flags', '["empty"]'::jsonb)
                        ELSE s END ORDER BY ord), '[]'::jsonb)
          INTO v_starters
          FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord);
          v_lineups := v_lineups || jsonb_build_array(jsonb_build_object('team_id', v_team, 'week', v_row.week, 'player_id', v_pid, 'slot', v_key, 'change', 'removed'));
          v_changed := TRUE;
        END IF;
        IF v_bench ? v_pid THEN
          SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
          FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') <> v_pid;
          IF v_key IS NULL THEN
            v_lineups := v_lineups || jsonb_build_array(jsonb_build_object('team_id', v_team, 'week', v_row.week, 'player_id', v_pid, 'slot', NULL, 'change', 'removed'));
          END IF;
          v_changed := TRUE;
        END IF;
      END LOOP;
      FOREACH v_pid IN ARRAY v_in LOOP
        IF NOT (v_bench ? v_pid) AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(v_map) e WHERE e.value = v_pid) THEN
          SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
          FROM jsonb_array_elements(v_bench || to_jsonb(v_pid)) x;
          v_lineups := v_lineups || jsonb_build_array(jsonb_build_object('team_id', v_team, 'week', v_row.week, 'player_id', v_pid, 'slot', 'bn', 'change', 'added'));
          v_changed := TRUE;
        END IF;
      END LOOP;
      IF v_changed THEN
        UPDATE public.team_lineups SET slot_map = v_map, starters = v_starters, bench = v_bench
        WHERE id = v_row.id;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION '%: lineup sync for team % week % touched % rows, expected 1', v_verb, v_team, v_row.week, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- (5) THE TRADE IS REVERSED (§12.11's status) in the same transaction.
  UPDATE public.trades t
  SET status = 'reversed', status_reason = 'reversed by the commissioner', resolved_at = p_at, resolved_by = auth.uid()
  WHERE t.id = p_trade_id AND t.status = 'complete';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '%: marking trade % reversed touched % rows, expected 1', v_verb, p_trade_id, v_cnt USING ERRCODE = 'P0001';
  END IF;

  -- (6) POST-WRITE ASSERTIONS (§4 rule 6 — asserted, not trusted).
  FOR v_leg IN
    SELECT i.player_id, i.from_team_id FROM public.trade_items i
    WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL
  LOOP
    IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league.id AND r.player_id = v_leg.player_id) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.league_rosters r
                      WHERE r.league_id = p_league.id AND r.player_id = v_leg.player_id AND r.team_id = v_leg.from_team_id) THEN
      RAISE EXCEPTION '%: after the reversal, % is not exactly once on the roster of the team that gave him in league % — refusing (exclusivity, rule 7)',
        v_verb, v_leg.player_id, p_league.id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR v_drop IN SELECT (e ->> 'player_id') AS player_id, (e ->> 'team_id')::uuid AS team_id FROM jsonb_array_elements(v_drops_in) e LOOP
    IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league.id AND r.player_id = v_drop.player_id) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.league_rosters r
                      WHERE r.league_id = p_league.id AND r.player_id = v_drop.player_id AND r.team_id = v_drop.team_id)
       OR (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = p_league.id AND pp.player_id = v_drop.player_id)
          IS DISTINCT FROM 'rostered' THEN
      RAISE EXCEPTION '%: after the reversal, restored drop % is not exactly once on its team with a rostered pool mirror — refusing',
        v_verb, v_drop.player_id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_team IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
    SELECT count(*)::int INTO v_cnt FROM public.league_rosters r WHERE r.league_id = p_league.id AND r.team_id = v_team;
    IF v_cnt <> (v_expected ->> v_team::text)::int OR v_cnt > v_roster_size THEN
      RAISE EXCEPTION '%: team % holds % players after the reversal, expected % (roster_size %) — refusing',
        v_verb, v_team, v_cnt, v_expected ->> v_team::text, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'players',            v_moves,
    'drops_restored',     v_drops_in,
    'drops_already_back', v_back,
    'faab',               v_faab,
    'lineups',            v_lineups,
    'lineup_from_week',   v_from_week,
    'week',               v_current,
    'roster_counts',      v_expected,
    'roster_size',        v_roster_size);
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_trade_reverse_internal(UUID, public.leagues, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. commish_force_or_reverse_trade_internal + commish_force_or_reverse_trade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_force_or_reverse_trade_internal(
  p_league_id UUID,
  p_trade_id  UUID,
  p_op        TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_verb         CONSTANT TEXT := 'commish_force_or_reverse_trade';
  v_league       public.leagues;
  v_found        BOOLEAN;
  v_ledger       public.commish_trade_actions;
  v_reason       TEXT;
  v_trade        public.trades;
  v_before       public.trades;
  v_proposer     public.teams;
  v_recipient    public.teams;
  v_review       TEXT;
  v_no_changes   BOOLEAN := FALSE;
  v_no_why       TEXT := NULL;
  v_exec         JSONB := NULL;
  v_rev          JSONB := NULL;
  v_lock         JSONB := NULL;
  v_deadline     JSONB;
  v_bypassed     JSONB := '[]'::jsonb;
  v_accepted_for UUID := NULL;
  v_outcome      TEXT;
  v_action_type  TEXT;
  v_act_text     TEXT;
  v_title        TEXT;
  v_audit_id     UUID := NULL;
  v_summary      TEXT;
  v_message      TEXT := NULL;
  v_notified     JSONB := '[]'::jsonb;
  v_n            UUID;
  v_team         UUID;
  v_txn_id       UUID := NULL;
  v_cnt          INTEGER;
  v_count        INTEGER;
  v_roster_size  INTEGER;
  v_result       JSONB;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule).
  IF p_trade_id IS NULL THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: p_trade_id is required — name the trade to act on'
      USING ERRCODE = '22023';
  END IF;
  IF p_op IS NULL OR p_op NOT IN ('approve', 'veto', 'force', 'reverse') THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: op % is not one of approve / veto / force / reverse (§10.1 / §13.3)', COALESCE(p_op, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: p_at is required (the TimeProvider seam)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST — the one serialization point every trade
  --     and roster verb and the trade tick take (148 / 151 / 155), so an
  --     override never interleaves with an execution, a vote or a move.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner OR co-commissioner, in-body, as ONE no-leak
  --     42501 covering "no such league", "not a member" and "a manager, even
  --     one of this trade's teams" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (E2), AFTER auth and BEFORE every business gate: a retry
  --     replays byte-identically even when the trade has since moved on. An
  --     action_id already used for ANOTHER op or trade is refused (R732).
  SELECT a.* INTO v_ledger
  FROM public.commish_trade_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.trade_id IS DISTINCT FROM p_trade_id OR v_ledger.op IS DISTINCT FROM p_op THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: action_id % already names a % of another trade or another op in this league — an action_id identifies ONE submit (R732)',
        p_action_id, v_ledger.op
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66; 131's normalisation verbatim).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_force_or_reverse_trade: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) THE TRADE, under the league lock.
  SELECT t.* INTO v_trade FROM public.trades t
  WHERE t.id = p_trade_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: no trade % in league %', p_trade_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_before := v_trade;
  SELECT t.* INTO v_proposer FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
  SELECT t.* INTO v_recipient FROM public.teams t WHERE t.id = v_trade.recipient_team_id;
  v_summary := COALESCE(public.trade_summary_internal(p_trade_id), 'a trade');
  v_review := COALESCE(v_league.trade_review, 'commissioner');

  -- (6) THE OP. Each arm either DETECTS the no-op (the state the op aims at
  --     already holds — D336 part 3), refuses BY NAME, or writes.
  IF p_op = 'approve' THEN
    IF v_trade.status = 'in_review' THEN
      -- F436: THE EXECUTOR decides — it re-validates, waits for the
      -- game-day lock (Q75) and records the trade. This verb moves nothing.
      v_exec := public.trade_execute_internal(p_trade_id, p_at, 'commissioner_approve');
      IF v_exec ->> 'outcome' = 'invalid' THEN
        RAISE EXCEPTION
          'commish_force_or_reverse_trade: the trade cannot go through as agreed — % — nothing was changed; a trade must leave both rosters legal, which binds the commissioner too (standing rule (i)): make room with commish_force_add_drop or move players with commish_move_player',
          regexp_replace(COALESCE(v_exec ->> 'status_reason', 'no reason recorded'), '^the trade could not go through: ', '')
          USING ERRCODE = 'P0001';
      ELSIF v_exec ->> 'outcome' NOT IN ('complete', 'deferred') THEN
        RAISE EXCEPTION 'commish_force_or_reverse_trade: the executor answered % for an in-review trade held under the league lock — refusing', v_exec ->> 'outcome'
          USING ERRCODE = 'P0001';
      END IF;
      v_outcome := CASE WHEN v_exec ->> 'outcome' = 'complete' THEN 'approved' ELSE 'approved_deferred' END;
      IF v_review = 'league_vote' THEN
        v_bypassed := jsonb_build_array('league_vote');
      END IF;
    ELSIF v_trade.status = 'accepted' THEN
      v_no_changes := TRUE;
      v_no_why := 'already_approved — its review is over and it is waiting to go through'
        || CASE WHEN v_trade.execute_after IS NOT NULL
                THEN ' right after the week''s last game ends (Q75 / E35); force puts it through now' ELSE '' END;
    ELSIF v_trade.status = 'complete' THEN
      v_no_changes := TRUE;
      v_no_why := 'already_complete — the trade already went through';
    ELSIF v_trade.status = 'proposed' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is no review to approve — the receiving team accepts it (the commissioner can accept for it with trade_respond), or force puts it through as it stands'
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade cannot be approved — it was %; to move these players use commish_move_player',
        public.commish_trade_closed_words_internal(v_trade)
        USING ERRCODE = 'P0001';
    END IF;

  ELSIF p_op = 'veto' THEN
    IF v_trade.status IN ('in_review', 'accepted') THEN
      UPDATE public.trades t
      SET status = 'vetoed',
          status_reason = 'vetoed by the commissioner' || CASE WHEN v_reason IS NOT NULL THEN ' — ' || v_reason ELSE '' END,
          resolved_at = p_at, resolved_by = auth.uid()
      WHERE t.id = p_trade_id AND t.status IN ('in_review', 'accepted');
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_force_or_reverse_trade: vetoing trade % touched % rows, expected 1', p_trade_id, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
      v_outcome := 'vetoed';
      IF v_trade.status = 'in_review' AND v_review = 'league_vote' THEN
        v_bypassed := jsonb_build_array('league_vote');
      END IF;
    ELSIF v_trade.status = 'vetoed' THEN
      v_no_changes := TRUE;
      v_no_why := 'already_vetoed — the trade was already vetoed';
    ELSIF v_trade.status = 'proposed' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is nothing to veto — the receiving team can reject it (the commissioner can reject for it with trade_respond), or the proposing team can cancel it'
        USING ERRCODE = 'P0001';
    ELSIF v_trade.status = 'complete' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade already went through, so it cannot be vetoed — reverse it instead (op reverse)'
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade is not going through — it was % — so there is nothing to veto',
        public.commish_trade_closed_words_internal(v_trade)
        USING ERRCODE = 'P0001';
    END IF;

  ELSIF p_op = 'force' THEN
    IF v_trade.status IN ('proposed', 'expired', 'accepted', 'in_review') THEN
      -- What the force stands outside, NAMED (D336 part 7): the review, the
      -- deadline, the game-day lock — all TIMING rules (standing rule (i)).
      IF v_trade.status = 'in_review' THEN
        v_bypassed := v_bypassed || to_jsonb('review_period'::text);
        IF v_review = 'league_vote' THEN
          v_bypassed := v_bypassed || to_jsonb('league_vote'::text);
        END IF;
      END IF;
      IF v_trade.status IN ('proposed', 'expired') THEN
        v_deadline := public.trade_deadline_internal(v_league);
        IF v_trade.status = 'expired' OR (v_deadline ->> 'deadline_at')::timestamptz <= p_at THEN
          v_bypassed := v_bypassed || to_jsonb('trade_deadline'::text);
        END IF;
      END IF;
      v_lock := public.trade_lock_internal(p_trade_id, v_league, p_at);
      SELECT v_bypassed || COALESCE(jsonb_agg(to_jsonb('game_day_lock:' || (e ->> 'player_id')) ORDER BY e ->> 'player_id'), '[]'::jsonb)
      INTO v_bypassed
      FROM jsonb_array_elements(v_lock -> 'locked_players') e;

      -- An offer nobody accepted yet (or one the deadline expired): the
      -- commissioner accepts it FOR the receiving team (standing rule (a) —
      -- the TD5 arm's power), with no drops named for it. Its roster must fit
      -- without drops — said in the force's own words here (the executor's
      -- overflow sentence speaks of a team that ADDED players since agreeing,
      -- which is not this case).
      IF v_trade.status IN ('proposed', 'expired') THEN
        SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
             + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
             + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
        INTO v_roster_size;
        SELECT count(*)::int INTO v_count FROM public.league_rosters r
        WHERE r.league_id = p_league_id AND r.team_id = v_trade.recipient_team_id;
        v_count := v_count
          - (SELECT count(*)::int FROM public.trade_items i
             WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL AND i.from_team_id = v_trade.recipient_team_id)
          + (SELECT count(*)::int FROM public.trade_items i
             WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL AND i.to_team_id = v_trade.recipient_team_id);
        IF v_count > v_roster_size THEN
          RAISE EXCEPTION
            'commish_force_or_reverse_trade: %''s roster would hold % players after this trade — % more than its % spots (§7.3.2 roster_size) — and nobody has named its drops; nothing was changed: free room first with commish_force_add_drop, then force it again (a roster over its league''s size binds the commissioner too)',
            v_recipient.name, v_count, v_count - v_roster_size, v_roster_size
            USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.trades t
        SET status = 'accepted', status_reason = NULL, accepted_at = p_at, accepted_by = auth.uid(),
            execute_after = NULL, resolved_at = NULL, resolved_by = NULL
        WHERE t.id = p_trade_id AND t.status IN ('proposed', 'expired');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION 'commish_force_or_reverse_trade: accepting trade % for the receiving team touched % rows, expected 1', p_trade_id, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
        v_accepted_for := v_trade.recipient_team_id;
      END IF;

      v_exec := public.trade_execute_internal(p_trade_id, p_at, 'commissioner_force');
      IF v_exec ->> 'outcome' = 'invalid' THEN
        RAISE EXCEPTION
          'commish_force_or_reverse_trade: the trade cannot go through as it stands — % — nothing was changed; a trade must leave both rosters legal, which binds the commissioner too (standing rule (i)): make room with commish_force_add_drop or move players with commish_move_player',
          regexp_replace(COALESCE(v_exec ->> 'status_reason', 'no reason recorded'), '^the trade could not go through: ', '')
          USING ERRCODE = 'P0001';
      ELSIF v_exec ->> 'outcome' IS DISTINCT FROM 'complete' THEN
        RAISE EXCEPTION 'commish_force_or_reverse_trade: a forced trade must go through now, and the executor answered % — refusing', COALESCE(v_exec ->> 'outcome', 'nothing')
          USING ERRCODE = 'P0001';
      END IF;
      v_outcome := 'forced';
    ELSE
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade cannot be forced — it was %; to move these players use commish_move_player',
        public.commish_trade_closed_words_internal(v_trade)
        USING ERRCODE = 'P0001';
    END IF;

  ELSE  -- reverse
    IF v_trade.status = 'complete' THEN
      v_rev := public.commish_trade_reverse_internal(p_trade_id, v_league, p_at);
      v_outcome := 'reversed';
    ELSIF v_trade.status = 'reversed' THEN
      v_no_changes := TRUE;
      v_no_why := 'already_reversed — the trade was already reversed';
    ELSIF v_trade.status IN ('proposed', 'accepted', 'in_review') THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not gone through yet, so there is nothing to reverse — % instead',
        CASE WHEN v_trade.status = 'proposed' THEN 'the receiving team can reject it or the proposing team cancel it'
             ELSE 'veto it (op veto)' END
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade never went through — it was % — so there is nothing to reverse',
        public.commish_trade_closed_words_internal(v_trade)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id;

  IF NOT v_no_changes THEN
    v_action_type := p_op || '_trade';     -- approve_trade | veto_trade | force_trade | reverse_trade (§12.12)
    -- (8) D336 part 2 — EXACTLY ONE audit row, AFTER the state write.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), v_action_type, 'trade', p_trade_id::text, v_reason,
      jsonb_build_object('status', v_before.status),
      jsonb_build_object('status', v_trade.status),
      jsonb_build_object(
        'verb',                 v_verb,
        'op',                   p_op,
        'outcome',              v_outcome,
        'season',               v_league.season,
        'action_id',            p_action_id,
        'trade_id',             p_trade_id,
        'summary',              v_summary,
        'trade_review',         v_review,
        'proposer_team_id',     v_before.proposer_team_id,
        'recipient_team_id',    v_before.recipient_team_id,
        'accepted_for_team_id', v_accepted_for,
        'execute_after',        v_trade.execute_after,
        'transaction_id',       v_exec ->> 'transaction_id',
        'reversal',             v_rev,
        'affected_team_ids',    jsonb_build_array(v_before.proposer_team_id, v_before.recipient_team_id),
        'bypassed',             v_bypassed),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_force_or_reverse_trade: the audit row was not written — refusing to let the override stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- A reversal is a roster move: ONE transactions row, the commissioner's
    -- (127's `commissioner_move` shape, `related_action_id` = the receipt).
    -- No `add_player_id` key: it never counts against acquisition caps (TD9).
    IF p_op = 'reverse' THEN
      v_txn_id := gen_random_uuid();
      INSERT INTO public.transactions
        (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id, related_action_id)
      VALUES (v_txn_id, p_league_id, 'commissioner_move', 'complete', NULL, auth.uid(),
              jsonb_build_object(
                'transaction_id',    v_txn_id,
                'kind',              'trade_reversal',
                'trade_id',          p_trade_id,
                'league_id',         p_league_id,
                'season',            v_league.season,
                'week',              v_rev -> 'week',
                'proposer_team_id',  v_before.proposer_team_id,
                'recipient_team_id', v_before.recipient_team_id,
                'summary',           v_summary,
                'reversal',          v_rev,
                'commissioner_action_id', v_audit_id,
                'evaluated_at',      p_at),
              (v_rev ->> 'week')::int, p_action_id, v_audit_id);
    END IF;

    -- (9) §10.3: the non-disableable system post, then BOTH managers told
    --     (TD16). An open seat notifies nobody; the actor is never notified
    --     of his own act.
    v_act_text := CASE v_outcome
      WHEN 'approved'          THEN 'approved a trade'
      WHEN 'approved_deferred' THEN 'approved a trade (it goes through right after this week''s last game ends — E35)'
      WHEN 'vetoed'            THEN 'vetoed a trade'
      WHEN 'forced'            THEN 'forced a trade through'
      WHEN 'reversed'          THEN 'reversed a trade — every player and any FAAB are back with the team that had them before it'
    END;
    v_title := CASE v_outcome
      WHEN 'approved'          THEN 'The commissioner approved your trade'
      WHEN 'approved_deferred' THEN 'The commissioner approved your trade'
      WHEN 'vetoed'            THEN 'The commissioner vetoed your trade'
      WHEN 'forced'            THEN 'The commissioner put your trade through'
      WHEN 'reversed'          THEN 'The commissioner reversed your trade'
    END;
    v_message := public.draft_actor_name() || ' (commissioner) ' || v_act_text || ': ' || v_summary
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    FOREACH v_team IN ARRAY ARRAY[v_before.proposer_team_id, v_before.recipient_team_id] LOOP
      v_n := public.trade_notify_team_internal(
        p_league_id, v_team, 'league_trade_commissioner', v_title,
        v_summary || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
        jsonb_build_object('trade_id', p_trade_id, 'op', p_op, 'status', v_trade.status,
                           'commissioner_action_id', v_audit_id),
        TRUE);
      IF v_n IS NOT NULL THEN
        v_notified := v_notified || jsonb_build_array(v_n);
      END IF;
    END LOOP;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   v_verb,
    'op',                     p_op,
    'action_type',            p_op || '_trade',
    'action_id',              p_action_id,
    'trade_id',               p_trade_id,
    'season',                 v_league.season,
    'trade_review',           v_review,
    'status_before',          v_before.status,
    'status',                 v_trade.status,
    'outcome',                CASE WHEN v_no_changes THEN 'no_change' ELSE v_outcome END,
    'trade',                  public.trade_view_internal(p_trade_id),
    'summary',                v_summary,
    'accepted_for_team_id',   v_accepted_for,
    'execution',              v_exec,
    'reversal',               v_rev,
    'transaction_id',         COALESCE(v_txn_id::text, v_exec ->> 'transaction_id'),
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                v_no_why || ', so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,              -- NULL on a no-op, and that is the point
    'bypassed',               v_bypassed,
    'bypassed_why',           CASE
      WHEN v_no_changes THEN 'nothing was done, so nothing was bypassed'
      WHEN jsonb_array_length(v_bypassed) = 0 THEN 'nothing to bypass — the commissioner decides a commissioner-reviewed trade, and validity (exclusivity, roster size, FAAB, a sealed franchise) binds him too (standing rule (i))'
      ELSE 'timing and review rules the commissioner stands outside (standing rule (i)): review_period = the rest of the review period; league_vote = the league''s vote stopped counting; trade_deadline = the trade deadline; game_day_lock:<player> = that player had kicked off this week. Validity (exclusivity, roster size, FAAB, a sealed franchise) still bound him' END,
    'reason',                 v_reason,
    'system_post',            v_message,               -- NULL on a no-op
    'notified_user_ids',      v_notified,
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266).
  INSERT INTO public.commish_trade_actions (league_id, trade_id, op, action_id, actor_id, result)
  VALUES (p_league_id, p_trade_id, p_op, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_force_or_reverse_trade_internal(UUID, UUID, TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The client door. Transaction `now()`, never a caller-supplied instant
-- (D307(3)); SECURITY DEFINER; in-body auth is the internal's step (2). The
-- tail arguments carry DEFAULT NULL and the required ones are refused in-body
-- (22023) — 147's shape, §15.4's order (trade, op, reason).
CREATE OR REPLACE FUNCTION commish_force_or_reverse_trade(
  p_league_id UUID,
  p_trade_id  UUID,
  p_op        TEXT DEFAULT NULL,   -- REQUIRED in-body (22023): approve | veto | force | reverse
  p_reason    TEXT DEFAULT NULL,   -- OPTIONAL (Q66)
  p_action_id UUID DEFAULT NULL    -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_force_or_reverse_trade_internal(
    p_league_id, p_trade_id, p_op, p_action_id, now(), p_reason);
END;
$$;
-- `authenticated` keeps EXECUTE; the in-body commissioner gate is the
-- authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_force_or_reverse_trade(UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;

COMMENT ON FUNCTION commish_force_or_reverse_trade(UUID, UUID, TEXT, TEXT, UUID) IS
  '§10.1 / §13.3 / §15.4 / E11 (migration 156, M5 L.D3.5; D352 / F340, F436): the commissioner (or a co-commissioner) acts on one trade. approve — a trade in review (commissioner review or a league vote) goes to the executor (it re-validates, waits for the game-day lock, records the trade); veto — a trade in review or accepted (incl. waiting for the lock) is closed vetoed; force — a trade in flight or expired at the deadline goes through NOW, past the review, the deadline and the game-day lock (validity still binds — refused by name); reverse — a complete trade is undone as a whole (players, drops, FAAB; lineups from the first unfinished week; past weeks untouched), refused by name when a player it moved is no longer where it put him. A no-op (the op''s state already holds) writes no receipt; otherwise ONE commissioner_actions row, a §10.3 chat post and both managers told. Own replay ledger (D350); reason optional (Q66).';
