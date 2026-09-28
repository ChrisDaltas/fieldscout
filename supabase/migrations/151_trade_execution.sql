-- ============================================================================
-- 151_trade_execution.sql — trades go through: execution, review (none /
-- commissioner), the trade deadline, the game-lock wait (E35), a manager
-- leaving (E47) and a per-minute tick (M5 task L.D3.3, FULL rigour — roster
-- exclusivity, FAAB, permissions).
-- Spec §13.3 (Execute / Deadline / review), §7.3.5 (trade_review,
-- trade_review_period_hours, trade_deadline_week, trade_lock_behavior),
-- §14 (`trade-review-expiry`), E8, E35, E36, E37, E47; CLAUDE.md rule 7.
-- Breakdown tasks-M5-transactions.md §6 L.D3.3, TD9–TD13 / TD16 (PROGRESS
-- D398–D401, D405), §4 rules. Rulings (Chris 2026-09-27, as recommended):
-- Q75 — a trade naming a player who already played this week waits and goes
-- through right after the week's last game ends (`defer`, the default), all
-- players together; `reject` fails it by name. Q76 — deadline week N: trades
-- can be proposed and accepted until week N+1 begins (its
-- `nfl_weeks.starts_at`); already-accepted trades still finish; offers still
-- pending then EXPIRE. Discharges PROGRESS F413 (the executor's checklist,
-- (a)–(f)) and F414 (the proposer's own roster growth).
--
-- Numbering: RESERVED by the orchestrator (151 / pgTAP 099; 150 / 098 belong
-- to the parallel L.D2.9 build). 151 does not depend on 150. NOT held:
-- reaches production by `npx supabase db push` only.
--
-- WHAT THIS MIGRATION DOES
--   1. `trade_execute_internal(trade, p_at, via)` — THE executor (F413):
--      locks the league row FIRST, re-reads the trade under it and requires
--      it still `accepted` / `in_review` (anything else is reported, never
--      moved — (b)); re-runs `trade_check_internal` with BOTH teams' drops
--      ENFORCED (two accepted trades can each fit today's rosters and
--      overflow together; two FAAB legs can together exceed a balance — (c));
--      refuses a retired party or a league out of season (E47's FAAB-only
--      side, (e)); any refusal turns the trade `invalid` WITH THE REASON and
--      tells both managers — never a silent failure at execute time (E37).
--      Then the game-day lock (TD11 / Q75, E35): a player in the trade — a
--      leg or a drop — who has kicked off in a week whose last game has not
--      ended locks the WHOLE trade: `defer` parks it `accepted` with
--      `execute_after` = the release instant (`infinity` while the week's
--      last game is not recorded) and both managers are told once; `reject`
--      makes it `invalid` by name. Otherwise it EXECUTES in this transaction:
--      `app.executing_trade_id` set transaction-locally before the first
--      roster write (a — 148's E37 trigger exempts this trade and still
--      invalidates every OTHER in-flight trade naming a player that moves),
--      the drops (pool per the waiver schedule, exactly as add/drop does —
--      TD13 / 149), the swap in `league_rosters` (UPDATE team_id — the player
--      never leaves the league, so exclusivity holds at every instant; lands
--      on the bench, TD10), the FAAB legs (debit the giver, credit the
--      receiver, each asserted one row; the ≥ 0 CHECK is the backstop), the
--      lineup interplay (TD10 — see the week note below), the trade
--      `complete` in the same transaction (d), ONE `transactions` row
--      (`type='trade'`, NO `add_player_id` — TD9: trades never count against
--      acquisition caps), the §10.3 system post and both managers told
--      (TD16). Exclusivity, pool mirror, roster counts and balances are
--      asserted after the writes (§4 rule 6).
--      THE WEEK NOTE (TD10 applied to Q75): lineup rows change from the
--      first week that is NOT FINISHED — the current week while its last
--      game has not ended, the next week once it has. A trade deferred by
--      Q75 executes right after the week's last game ends, and the players
--      were started by their old teams that week ("while it waits the
--      players stay with — and can be started by — their current teams"):
--      clearing them from the finished week's lineup would erase points they
--      scored for the old team on the next re-score. Before the week ends
--      nothing in the trade has kicked off (the lock), so the current week is
--      cleared exactly as add/drop clears it (149's loop, generalized to the
--      trade's players). The next week's auto-carry keeps only players still
--      on the roster (116's `lineup_carry_internal`), so a finished week's
--      stale entry never carries forward.
--   2. REVIEW (§13.3): `trade_respond('accept')` — `trade_review = none` ⇒
--      the trade is `accepted` and executed at once, in the accept's own
--      transaction (a lock wait or a failure is in the accept's result);
--      `commissioner` / `league_vote` ⇒ `in_review` with `review_deadline` =
--      acceptance + `trade_review_period_hours` (default 24). The tick
--      auto-approves at the deadline (§13.3 "elapses → auto-approve").
--      Commissioner approve / veto are L.D3.5's verb and league votes
--      L.D3.4's — both act on `in_review` before the deadline; until L.D3.4
--      lands a league-vote trade simply goes through at the deadline
--      (PROGRESS F-row).
--   3. THE DEADLINE (Q76): `trade_deadline_internal` places it at week
--      (trade_deadline_week + 1)'s `nfl_weeks.starts_at` (D288: a league week
--      IS an NFL week). `trade_propose` and `trade_respond` accept / counter
--      refuse AT and after it, by name, naming the instant in the league's
--      own zone; reject / cancel stay open. The tick expires every offer
--      still `proposed` at the deadline (status `expired`, both told) — F413
--      (f). `accepted` / `in_review` trades are untouched by it and finish.
--   4. E47 — `trg_trade_rescind_on_stint_close` on `team_managers` (AFTER
--      UPDATE OF ended_at, a stint closing): every in-flight trade of that
--      team — as proposer or receiver, any in-flight status — goes `invalid`
--      with the reason, both managers told. "Offer auto-rescinds on stint
--      close" read on every writer that closes a stint (remove / takeover /
--      vacate / leave / retire). `ENABLE ALWAYS` (R616).
--   5. `trade_tick(p_now, p_league_id)` on pg_cron every minute
--      (`trade-tick`): claims leagues with a trade in flight `FOR UPDATE SKIP
--      LOCKED` (the league row is the same serialization point every trade
--      and roster verb takes), each league in its own subtransaction
--      (a failing league is reported, siblings proceed — 116's shape), and
--      per league: (1) expire offers at the deadline, (2) the TD12 backstop
--      sweep — a retired party, a FAAB leg its giver can no longer afford,
--      the league out of season ⇒ `invalid` with the reason, (3) run every
--      `in_review` trade whose review period has ended, (4) run every
--      deferred trade (`accepted`, `execute_after` reached or not yet
--      known). A pass that does nothing says why.
--   6. F414 — `trade_check_internal`'s roster-overflow refusal is worded
--      for who can fix it: at acceptance, the PROPOSING team's overflow
--      (it added players since proposing) names the proposer and says it
--      must cancel and re-propose; at execution the words say the team has
--      added players since the trade was agreed.
--   7. `trade_view_internal` also reports `review_deadline` and
--      `execute_after` (the two instants this task introduces).
--
-- D137 REPLACEMENTS — each against 148's FILE TEXT (148 is the newest
-- definer of all four — `grep -n "FUNCTION <name>" supabase/migrations/*.sql
-- | tail -1`), derived by an exact-match script (every substitution asserted
-- to hit exactly once; the before/after diff is in the PR):
--   trade_view_internal     148:250-287   md5 f9699eba  1 substitution  (two keys)
--   trade_check_internal    148:427-624   md5 feb05eb7  1 substitution  (F414 wording)
--   trade_propose_internal  148:793-929   md5 f1e6f2b7  2 substitutions (DECLARE; the deadline)
--   trade_respond_internal  148:960-1238  md5 e77ea79c  6 substitutions (DECLARE; the
--                                          deadline; the accept arm's review; the
--                                          executor call; the result's review /
--                                          execution keys; settled_by) — difflib
--                                          measures 7 hunks (the accept arm splits)
-- 148's doors (`trade_propose`, `trade_respond`), the E37 trigger and the
-- broadcast are NOT touched. 115 / 149's add/drop and 127 / 149's
-- commissioner roster verbs are NOT touched (the executor copies 149's drop
-- destination and lineup loop; it calls neither verb).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   No new table (045's census unchanged). New functions: trade_close_
--   internal, trade_deadline_internal, trade_lock_internal, trade_execute_
--   internal, trade_tick (PLAIN, triple-REVOKEd — the cron runs as postgres)
--   and trade_rescind_on_stint_close (SECURITY DEFINER trigger function,
--   triple-REVOKEd); four replaced (REVOKEs restated). One trigger on
--   team_managers (ENABLE ALWAYS). One pg_cron entry (`trade-tick`, every
--   minute — §14's `trade-review-expiry` row says every 15 min; the defer
--   must fire at the release, TD6's cadence; spec v2.16.61 note).
--   RLS unchanged: no new client door (the executor and tick are not
--   callable by anon / authenticated). Realtime: `trades` status changes
--   already broadcast (148); the `transactions` row broadcasts through 119.
--   Backfill: an `accepted` trade left by 148 in a league that reviews
--   trades is moved into review (counted, said as a NOTICE — 148 is not in
--   production, so this is the local / preview case). WAIVERS: R6 — no
--   staging clone; the fresh local `db reset` 001–151 + the full pgTAP run
--   are the rehearsal. D38 — no new broadcast. Typegen: additive (the new
--   functions); the alias block re-appended.
--
-- DEPLOY ORDER: no app code calls anything new here (the trade API is
-- L.D3.6), so the app deploys safely ahead of `db push`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 148's accepted trades enter review under the league's setting (the
--    state 148 left them in meant "waiting for L.D3.3").
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE public.trades t
  SET status = 'in_review',
      review_deadline = now() + make_interval(hours => COALESCE((l.settings ->> 'trade_review_period_hours')::int, 24))
  FROM public.leagues l
  WHERE l.id = t.league_id AND t.status = 'accepted' AND t.execute_after IS NULL
    AND COALESCE(l.trade_review, 'commissioner') <> 'none';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '151: % accepted trade(s) moved into review (their league reviews trades — §13.3)', v_n;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. D137 — trade_view_internal (148:250), +review_deadline / execute_after
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_view_internal(p_trade_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',                t.id,
    'league_id',         t.league_id,
    'status',            t.status,
    'status_reason',     t.status_reason,
    'proposer_team_id',  t.proposer_team_id,
    'recipient_team_id', t.recipient_team_id,
    'note',              t.note,
    'countered_from',    t.countered_from,
    'created_at',        t.created_at,
    'accepted_at',       t.accepted_at,
    'resolved_at',       t.resolved_at,
    'review_deadline',   t.review_deadline,   -- 151 (L.D3.3): when the review period ends (§13.3)
    'execute_after',     t.execute_after,     -- 151: a deferred trade's release instant (Q75 / E35)
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'from_team_id', i.from_team_id,
                'to_team_id',   i.to_team_id,
                'player_id',    i.player_id,
                'player_name',  p.full_name,
                'faab_amount',  i.faab_amount)
              ORDER BY (i.from_team_id <> t.proposer_team_id), (i.faab_amount IS NOT NULL), i.player_id), '[]'::jsonb)
              FROM public.trade_items i LEFT JOIN public.players p ON p.id = i.player_id
              WHERE i.trade_id = t.id),
    'drops', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'team_id',     d.team_id,
                'player_id',   d.player_id,
                'player_name', p.full_name)
              ORDER BY (d.team_id <> t.proposer_team_id), d.player_id), '[]'::jsonb)
              FROM public.trade_drops d JOIN public.players p ON p.id = d.player_id
              WHERE d.trade_id = t.id))
  FROM public.trades t
  WHERE t.id = p_trade_id;
$$;
REVOKE EXECUTE ON FUNCTION trade_view_internal(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. D137 — trade_check_internal (148:427), F414's wording
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
        '%: % (%) is not on any roster in this league — only a rostered player can be traded (§13.3)',
        p_verb, v_player.full_name, v_item.player_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_holder.team_id <> v_item.from_team_id THEN
      SELECT t.* INTO v_holder_team FROM public.teams t WHERE t.id = v_holder.team_id;
      RAISE EXCEPTION
        '%: % (%) is on %''s roster, not %''s — a trade can only move a player from the team that has him (player exclusivity, §13.3 / CLAUDE.md rule 7)',
        p_verb, v_player.full_name, v_item.player_id, v_holder_team.name,
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
      '%: % gives nothing in this trade — this league does not allow future considerations (allow_future_considerations is off, §7.3.5), so each team gives at least one player or FAAB',
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
      RAISE EXCEPTION '%: FAAB cannot be traded in this league (allow_faab_in_trades is off, §7.3.5)', p_verb
        USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(p_league.waiver_type, 'faab') <> 'faab' THEN
      RAISE EXCEPTION
        '%: this league decides waivers by priority (%), not FAAB — there is no FAAB to trade (§7.3.4)',
        p_verb, p_league.waiver_type
        USING ERRCODE = 'P0001';
    END IF;
    v_has_seat := NULL;
    v_balance := NULL;
    SELECT TRUE, m.faab_balance INTO v_has_seat, v_balance
    FROM public.league_members m
    WHERE m.league_id = p_league.id AND m.team_id = v_item.from_team_id;
    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        '%: % has no FAAB balance on record (its league_members seat %) — refusing to trade money that is not recorded (§12.2)',
        p_verb, CASE WHEN v_item.from_team_id = p_proposer.id THEN p_proposer.name ELSE p_recipient.name END,
        CASE WHEN v_has_seat IS NULL THEN 'is missing' ELSE 'holds NULL' END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_item.faab_amount > v_balance THEN
      RAISE EXCEPTION '%: % cannot give $% of FAAB — its balance is $% (§13.3)',
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
          '%: % (%) is not on %''s roster — a team can only drop its own players to make room (E36)',
          p_verb, v_player.full_name, v_drop, v_side.team_name
          USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
                 WHERE i.player_id = v_drop) THEN
        RAISE EXCEPTION
          '%: % (%) is already leaving % in this trade — he cannot also be one of its drops',
          p_verb, v_player.full_name, v_drop, v_side.team_name
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

    IF v_side.enforce AND v_after > v_roster_size THEN
      -- 151 (F414): the words name who can fix it. At execution nobody can
      -- name drops any more; at acceptance the PROPOSING team's overflow (it
      -- added players after proposing) is the proposer's to fix — the
      -- receiving manager cannot name drops for another team.
      IF p_verb = 'trade_execute' THEN
        RAISE EXCEPTION
          '%: %''s roster would hold % players after this trade — % more than its % spots (§7.3.2 roster_size): it has added players since the trade was agreed, so the trade cannot go through as agreed (E36)',
          p_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size
          USING ERRCODE = 'P0001';
      ELSIF v_side.role = 'proposer' AND p_recipient_drops IS NOT NULL THEN
        RAISE EXCEPTION
          '%: %''s roster no longer fits this offer — it would hold % players after the trade, % more than its % spots (§7.3.2 roster_size), because it has added players since proposing; only % can fix that, so ask them to cancel and re-propose with drops (E36)',
          p_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size, v_side.team_name
          USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION
        '%: %''s roster would hold % players after this trade — % more than its % spots (§7.3.2 roster_size): name % more drop(s) as part of the trade (E36)',
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
REVOKE EXECUTE ON FUNCTION trade_check_internal(TEXT, public.leagues, public.teams, public.teams, JSONB, TEXT[], TEXT[])
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. trade_deadline_internal — Q76: deadline week N ends when week N+1
--    begins (nfl_weeks.starts_at). NULL setting = no deadline. A week past
--    the calendar's last = no instant (the season ends first). A GAP in the
--    calendar refuses loudly — never "no deadline" by accident.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_deadline_internal(p_league public.leagues)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_week INTEGER := p_league.trade_deadline_week;
  v_at   TIMESTAMPTZ;
  v_max  INTEGER;
  v_zone TEXT;
BEGIN
  IF v_week IS NULL THEN
    RETURN jsonb_build_object('deadline_week', NULL, 'deadline_at', NULL, 'why', 'no_deadline', 'label', NULL);
  END IF;
  SELECT w.starts_at INTO v_at
  FROM public.nfl_weeks w
  WHERE w.season = p_league.season AND w.week = v_week + 1;
  IF NOT FOUND THEN
    SELECT max(w.week) INTO v_max FROM public.nfl_weeks w WHERE w.season = p_league.season;
    IF v_max IS NULL OR v_max > v_week + 1 THEN
      RAISE EXCEPTION
        'trade deadline: week % of season % is not on the NFL calendar (nfl_weeks) — the deadline (trade_deadline_week %) cannot be placed; refusing rather than reading it as "no deadline"',
        v_week + 1, p_league.season, v_week
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('deadline_week', v_week, 'deadline_at', NULL, 'why', 'after_last_calendar_week', 'label', NULL);
  END IF;
  v_zone := COALESCE(NULLIF(p_league.settings ->> 'waiver_time_zone', ''), 'America/New_York');
  RETURN jsonb_build_object(
    'deadline_week', v_week,
    'deadline_at',   v_at,
    'why',           'next_week_starts',
    'label',         to_char(v_at AT TIME ZONE v_zone, 'Dy YYYY-MM-DD HH24:MI') || ' ' || v_zone);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_deadline_internal(public.leagues) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. D137 — trade_propose_internal (148:793), the deadline
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_propose_internal(
  p_league_id    UUID,
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_items        JSONB,
  p_drops        TEXT[],
  p_note         TEXT,
  p_action_id    UUID,
  p_at           TIMESTAMPTZ,
  p_reason       TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_is_manager BOOLEAN;
  v_is_commish BOOLEAN;
  v_ledger     public.trade_actions;
  v_reason     TEXT;
  v_core       JSONB;
  v_trade_id   UUID;
  v_trade      public.trades;
  v_from       public.teams;
  v_to         public.teams;
  v_summary    TEXT;
  v_notified   UUID;
  v_receipt    JSONB := NULL;
  v_result     JSONB;
  v_deadline   JSONB;          -- 151 (Q76)
BEGIN
  -- (0) SHAPE.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'trade_propose: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_from_team_id IS NULL THEN
    RAISE EXCEPTION 'trade_propose: p_from_team_id is required — the team making the offer'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — the proposing team's manager, or a commissioner acting for
  --     ANY team (TD5). One no-leak 42501.
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_from_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'trade_propose: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY — after auth, before every business gate (R732 scoping).
  SELECT a.* INTO v_ledger
  FROM public.trade_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'trade_propose' OR v_ledger.team_id IS DISTINCT FROM p_from_team_id THEN
      RAISE EXCEPTION
        'trade_propose: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66 / 131). Stored only on the commissioner arm.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'trade_propose: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) LEAGUE STATE, under the lock.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'trade_propose: league % is % — trades are made only while the league is in season or in the playoffs (§7.1 / §13.3)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  -- 151 (Q76): deadline week N — offers can be made until week N+1 begins
  -- (its nfl_weeks.starts_at); AT that instant they cannot.
  v_deadline := public.trade_deadline_internal(v_league);
  IF (v_deadline ->> 'deadline_at')::timestamptz <= p_at THEN
    RAISE EXCEPTION
      'trade_propose: the trade deadline has passed — trades could be proposed until week % began (%; trade_deadline_week %, §13.3 / Q76)',
      (v_deadline ->> 'deadline_week')::int + 1, v_deadline ->> 'label', v_deadline ->> 'deadline_week'
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) VALIDATE + WRITE.
  v_core := public.trade_propose_core_internal(
    'trade_propose', v_league, p_from_team_id, p_to_team_id, p_items, p_drops, p_note, p_action_id, p_at, NULL);
  v_trade_id := (v_core ->> 'trade_id')::uuid;
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = v_trade_id;
  SELECT t.* INTO v_from FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
  SELECT t.* INTO v_to FROM public.teams t WHERE t.id = v_trade.recipient_team_id;
  v_summary := public.trade_summary_internal(v_trade_id);

  -- (7) THE COMMISSIONER ARM (TD5): ONE audit row acting as the proposer.
  IF NOT v_is_manager THEN
    v_receipt := public.trade_receipt_internal(
      p_league_id, v_from, 'propose_trade', 'proposed a trade for', v_trade_id,
      NULL, jsonb_build_object('status', 'proposed'), v_reason, p_action_id, 'trade_propose', v_league.season);
  END IF;

  -- (8) THE RECEIVING TEAM IS TOLD (TD16).
  v_notified := public.trade_notify_team_internal(
    p_league_id, v_to.id, 'league_trade_proposed',
    v_from.name || ' sent you a trade offer',
    v_summary || CASE WHEN v_trade.note IS NOT NULL THEN ' — "' || v_trade.note || '"' ELSE '' END,
    jsonb_build_object('trade_id', v_trade_id, 'proposer_team_id', v_from.id, 'recipient_team_id', v_to.id),
    TRUE);

  v_result := jsonb_build_object(
    'verb',                   'trade_propose',
    'league_id',              p_league_id,
    'team_id',                p_from_team_id,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'trade',                  public.trade_view_internal(v_trade_id),
    'summary',                v_summary,
    'rosters',                v_core -> 'check',
    'settled_by',             'the receiving team accepts (naming any drops its roster needs — E36), rejects or counters (§13.3); an accepted trade then waits for review and execution (L.D3.3). Nothing moves until it executes.',
    'notified_user_ids',      CASE WHEN v_notified IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_notified) END,
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.trade_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, p_from_team_id, 'trade_propose', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_propose_internal(UUID, UUID, UUID, JSONB, TEXT[], TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. trade_close_internal — a trade in flight leaves flight WITH A REASON
--    (invalid / expired) and BOTH managers are told (E37: "never fails
--    silently"). The caller holds the league lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_close_internal(
  p_trade_id UUID,
  p_status   TEXT,
  p_reason   TEXT,
  p_at       TIMESTAMPTZ,
  p_type     TEXT,
  p_title    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trade    public.trades;
  v_summary  TEXT;
  v_n        UUID;
  v_notified JSONB := '[]'::jsonb;
  v_team     UUID;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('invalid', 'expired') THEN
    RAISE EXCEPTION 'trade_close_internal: status % is not invalid / expired', COALESCE(p_status, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR p_at IS NULL THEN
    RAISE EXCEPTION 'trade_close_internal: a reason and an instant are required — a trade never leaves flight without saying why (C74)'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.trades t
  SET status = p_status, status_reason = p_reason, resolved_at = p_at, resolved_by = auth.uid()
  WHERE t.id = p_trade_id AND t.status IN ('proposed', 'accepted', 'in_review')
  RETURNING t.* INTO v_trade;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_close_internal: trade % is not in flight — refusing to close it again', p_trade_id
      USING ERRCODE = 'P0001';
  END IF;
  v_summary := public.trade_summary_internal(p_trade_id);
  FOREACH v_team IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
    v_n := public.trade_notify_team_internal(
      v_trade.league_id, v_team, p_type, p_title,
      COALESCE(v_summary, 'a trade') || ' — ' || p_reason,
      jsonb_build_object('trade_id', p_trade_id, 'status', p_status), FALSE);
    IF v_n IS NOT NULL THEN
      v_notified := v_notified || jsonb_build_array(v_n);
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'trade_id',          p_trade_id,
    'status',            p_status,
    'status_reason',     p_reason,
    'notified_user_ids', v_notified);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_close_internal(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. trade_lock_internal — TD11 / Q75 / E35: is any player in the trade (a
--    leg OR a drop — both change rosters) inside the §13.1 game-day lock?
--    Read through 115's pool_game_lock_any_internal (the add/drop verb's own
--    reader — ONE lock law). release_at = the latest release among the
--    locked players; `infinity` while a locking week's last game is not
--    recorded (NULL = the week is not over — never read as free).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_lock_internal(p_trade_id UUID, p_league public.leagues, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_current INTEGER;
  v_p       RECORD;
  v_lock    JSONB;
  v_locked  JSONB := '[]'::jsonb;
  v_release TIMESTAMPTZ := NULL;
  v_unknown BOOLEAN := FALSE;
BEGIN
  v_current := public.lineup_current_week_internal(p_league.id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'trade_execute: league % has no league_weeks rows — no season calendar to evaluate the game-day lock against (§12.17)',
      p_league.id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_p IN
    SELECT q.player_id, p.full_name, p.team AS nfl_team
    FROM (SELECT i.player_id FROM public.trade_items i WHERE i.trade_id = p_trade_id AND i.player_id IS NOT NULL
          UNION
          SELECT d.player_id FROM public.trade_drops d WHERE d.trade_id = p_trade_id) q
    JOIN public.players p ON p.id = q.player_id
    ORDER BY q.player_id
  LOOP
    v_lock := public.pool_game_lock_any_internal(p_league.season, v_current, v_p.nfl_team, p_at);
    IF (v_lock ->> 'locked')::boolean THEN
      v_locked := v_locked || jsonb_build_array(jsonb_build_object(
        'player_id',      v_p.player_id,
        'name',           v_p.full_name,
        'week',           (v_lock ->> 'week')::int,
        'kickoff_at',     v_lock -> 'kickoff_at',
        'window_ends_at', v_lock -> 'window_ends_at'));
      IF (v_lock ->> 'window_ends_at') IS NULL THEN
        v_unknown := TRUE;
      ELSE
        v_release := GREATEST(v_release, (v_lock ->> 'window_ends_at')::timestamptz);
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'locked',         jsonb_array_length(v_locked) > 0,
    'current_week',   v_current,
    'locked_players', v_locked,
    'release_at',     CASE WHEN jsonb_array_length(v_locked) = 0 THEN NULL
                           WHEN v_unknown THEN 'infinity'::timestamptz
                           ELSE v_release END,
    'evaluated_at',   p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_lock_internal(UUID, public.leagues, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. trade_execute_internal — THE executor (banner §1; F413 (a)–(e)).
--    Returns a document with `outcome`:
--      complete | deferred | invalid | not_in_flight
--    `invalid` and `deferred` are business outcomes (the trade row says why,
--    both managers are told), never exceptions. Exceptions are reserved for
--    broken invariants (a roster write that touched the wrong number of
--    rows, a mirror that disagrees) — loud, and they roll the whole
--    execution back.
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
  IF (v_lock ->> 'locked')::boolean THEN
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
  SELECT w.last_game_ends_at INTO v_week_end FROM public.nfl_weeks w
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
-- 8. D137 — trade_respond_internal (148:960): the deadline, review, and the
--    executor at acceptance under trade_review = none.
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
    IF v_proposer.status = 'retired' OR v_recipient.status = 'retired' THEN
      RAISE EXCEPTION 'trade_respond: % is retired — a sealed franchise makes no trades (§7.2.1)',
        CASE WHEN v_proposer.status = 'retired' THEN v_proposer.name ELSE v_recipient.name END
        USING ERRCODE = 'P0001';
    END IF;
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

  -- (7) THE COMMISSIONER ARM: ONE audit row acting as the side he moved for.
  IF NOT v_is_manager THEN
    v_receipt := public.trade_receipt_internal(
      p_league_id, v_side, p_op || '_trade',
      CASE p_op WHEN 'accept' THEN 'accepted a trade for' WHEN 'reject' THEN 'rejected a trade for'
                WHEN 'cancel' THEN 'cancelled a trade for' ELSE 'countered a trade for' END,
      COALESCE(v_new_id, p_trade_id),
      jsonb_build_object('status', 'proposed')
        || CASE WHEN v_new_id IS NOT NULL THEN jsonb_build_object('trade_id', p_trade_id) ELSE '{}'::jsonb END,
      jsonb_build_object('status', CASE WHEN v_new_id IS NOT NULL THEN 'proposed' ELSE v_status END)
        || CASE WHEN v_new_id IS NOT NULL THEN jsonb_build_object('trade_id', v_new_id, 'countered_from', p_trade_id) ELSE '{}'::jsonb END,
      v_reason, p_action_id, v_verb, v_league.season);
  END IF;

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
REVOKE EXECUTE ON FUNCTION trade_respond_internal(UUID, UUID, TEXT, TEXT[], JSONB, TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. E47 — a stint closing rescinds the team's trades in flight.
--    SECURITY DEFINER: it runs under whichever verb closed the stint and its
--    writes (trades, notifications) are its own business. Time: now() — a
--    trigger has no p_at; it is the closing transaction's own instant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_rescind_on_stint_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team     TEXT;
  v_sentence TEXT;
  v_t        RECORD;
BEGIN
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN
    RETURN NULL;   -- only a stint CLOSING (the WHEN clause says so too)
  END IF;
  SELECT t.name INTO v_team FROM public.teams t WHERE t.id = NEW.team_id;
  v_sentence := COALESCE(v_team, 'a team') || '''s manager is no longer managing it ('
    || COALESCE(NEW.end_reason, 'stint closed') || ') — a trade offered or agreed by the previous manager is called off (E47); the commissioner can re-propose it acting for the team';
  FOR v_t IN
    SELECT t.id FROM public.trades t
    WHERE t.league_id = NEW.league_id
      AND t.status IN ('proposed', 'accepted', 'in_review')
      AND (t.proposer_team_id = NEW.team_id OR t.recipient_team_id = NEW.team_id)
    ORDER BY t.created_at, t.id
  LOOP
    PERFORM public.trade_close_internal(v_t.id, 'invalid', v_sentence, now(), 'league_trade_invalid', 'A trade was called off');
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_rescind_on_stint_close() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_trade_rescind_on_stint_close
  AFTER UPDATE OF ended_at ON team_managers
  FOR EACH ROW
  WHEN (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL)
  EXECUTE FUNCTION trade_rescind_on_stint_close();
-- R616: a replica-mode session must not skip it.
ALTER TABLE team_managers ENABLE ALWAYS TRIGGER trg_trade_rescind_on_stint_close;

-- ---------------------------------------------------------------------------
-- 10. trade_tick — every minute (banner §5).
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
              || ' began (' || (v_deadline ->> 'label') || '; trade_deadline_week ' || (v_deadline ->> 'deadline_week') || ', §13.3 / Q76)',
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
          v_reason := 'the league is ' || CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' ELSE v_league.status END
                      || ' — a trade goes through only while the league is in season or in the playoffs (§7.1 / §13.3)';
        ELSE
          SELECT tm.name || ' is retired — a sealed franchise makes no trades (§7.2.1)' INTO v_reason
          FROM public.teams tm
          WHERE tm.id IN (v_t.proposer_team_id, v_t.recipient_team_id) AND tm.status = 'retired'
          ORDER BY tm.name LIMIT 1;
          IF v_reason IS NULL THEN
            SELECT tm.name || ' can no longer give $' || i.faab_amount || ' of FAAB — its balance is '
                   || COALESCE('$' || m.faab_balance, 'not recorded') || ' (§13.3)'
            INTO v_reason
            FROM public.trade_items i
            JOIN public.teams tm ON tm.id = i.from_team_id
            LEFT JOIN public.league_members m ON m.league_id = v_league.id AND m.team_id = i.from_team_id
            WHERE i.trade_id = v_t.id AND i.faab_amount IS NOT NULL
              AND (m.faab_balance IS NULL OR m.faab_balance < i.faab_amount)
            ORDER BY tm.name LIMIT 1;
          END IF;
        END IF;
        IF v_reason IS NOT NULL THEN
          v_res := public.trade_close_internal(v_t.id, 'invalid', 'the trade can no longer go through: ' || v_reason, p_now,
                                               'league_trade_invalid', 'A trade can no longer go through');
          v_swept := v_swept + 1;
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'invalid', 'reason', v_reason));
        END IF;
      END LOOP;

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
    'actions',     v_actions,
    'failures',    v_failures,
    'reason', CASE
      WHEN v_candidates = 0 THEN 'no_trades_in_flight'
      WHEN v_leagues = 0 THEN 'every_league_busy'
      WHEN jsonb_array_length(v_actions) = 0 AND jsonb_array_length(v_failures) = 0 THEN 'nothing_due'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_tick(TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION trade_tick(TIMESTAMPTZ, UUID) IS
  '§13.3 / §14 trade-review-expiry (migration 151, L.D3.3): every minute on pg_cron. Per league with a trade in flight (claimed FOR UPDATE SKIP LOCKED): expire offers at the deadline (Q76), invalidate trades a retired party / an unaffordable FAAB leg / an out-of-season league can no longer complete (TD12), run in_review trades whose review period ended (auto-approve) and deferred trades whose game-lock wait is over (Q75 / E35). Reports what it did and, when nothing, why.';

-- ---------------------------------------------------------------------------
-- 11. pg_cron — `trade-tick` every minute, unschedule-first (116:1333).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trade-tick') THEN
    PERFORM cron.unschedule('trade-tick');
  END IF;
  PERFORM cron.schedule('trade-tick', '* * * * *', 'SELECT public.trade_tick()');
END;
$do$;
