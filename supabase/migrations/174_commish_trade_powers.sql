-- ============================================================================
-- 174 — the commissioner's trade powers: an ACCEPTED trade only — veto it or
--       push it through (M6 L.D3.16 — an M5 trade rule changed by ruling;
--       FULL rigour: permissions, trades that move players)
--       (spec §10.1, §10.3, §13.3, §15.4; PROGRESS D416, D451, D463; M5 TD5)
-- ============================================================================
--
-- THE RULINGS (Chris, 2026-09-30, in chat — verbatim):
--   1. "A commissioner cannot do anything to a trade unless it's already been
--       accepted and the only option is veto or instantly push it through."
--   2. Asked whether the commissioner can still undo a completed trade:
--       "Remove reverse"
--   (3. "Locked once complete" — no post-season fixes; recorded, no build.)
--
-- WHAT CHANGES
--   A. `trade_propose_internal` / `trade_respond_internal` — M5 TD5's
--      commissioner arm (propose / accept / reject / counter / cancel FOR a
--      team) is REMOVED. A commissioner who manages neither the team (propose)
--      nor a party (respond) is refused BY NAME, P0001 (he is a member — the
--      no-leak 42501 stays for everyone else):
--        "A commissioner acts on a trade only after it's accepted: veto it or
--         push it through. …"
--      A commissioner who IS that team's (a party's) manager acts as that
--      manager, unchanged. No commissioner receipt is written by either verb
--      any more; the result keeps its keys (acted_as_commissioner FALSE,
--      commissioner_action_id / system_post / reason NULL).
--      `trade_rescind_on_stint_close` (E47): its called-off sentence said
--      "the commissioner can re-propose it acting for the team" — now "the
--      team's next manager can offer it again".
--   B. `commish_force_or_reverse_trade_internal`:
--      * `force` only on an ACCEPTED trade — `in_review` (the commissioner's
--        review or a league vote) or `accepted` (waiting for the week's last
--        game, deferred). `proposed` / `expired` offers are refused BY NAME;
--        156's accept-for-the-receiving-team arm (its roster-fit refusal and
--        its UPDATE) is gone. Force still stands outside the review, the vote
--        and the game-day lock ("instantly push it through"); an accepted
--        trade never met the deadline (Q76 — accepted before it, it completes
--        after it), so `trade_deadline` no longer appears in `bypassed`.
--      * `reverse` REMOVED: refused BY NAME (22023) AFTER the replay, so a
--        retry of a reversal made before 174 still replays its stored answer
--        and the ledger's CHECK keeps 'reverse' (old rows stay readable).
--        Receipts `reverse_trade`, the `commissioner_move` / `trade_reversal`
--        transactions rows and `trades.status = 'reversed'` rows written
--        before 174 are history and are untouched.
--      * `approve` / `veto` UNCHANGED in behaviour; four of their refusal
--        sentences pointed at the removed arms ("the commissioner can accept /
--        reject for it with trade_respond", "force puts it through", "reverse
--        it instead") and are re-worded (the ops, states and codes are the
--        same).
--   C. DROPPED — `commish_trade_reverse_internal` (reverse's writes; its only
--      caller was B's reverse arm) and `trade_receipt_internal` (the TD5
--      arm's receipt seam; its only callers were A's two arms). Measured:
--      `grep -n "trade_receipt_internal(\|commish_trade_reverse_internal("
--      supabase/migrations/*.sql` — 151:584 / 151:1463 / 156:1571 and their
--      148 predecessors only (157–173 call neither).
--   D. The three door COMMENTs (`trade_propose`, `trade_respond`,
--      `commish_force_or_reverse_trade`) say the ruled powers. The doors'
--      bodies, signatures and ACLs do not move.
--
-- D137 — each body is `CREATE OR REPLACE`d against its NEWEST defining
-- migration's FILE TEXT (never the deployed body — CLAUDE.md's 073 lesson),
-- extracted programmatically and changed by exact-match hunks (each old text
-- occurs once; the reversal reproduces the file text byte for byte — pgTAP
-- 122 A-cells pin it in the database through `pg_temp.un174`). Newest
-- definers MEASURED over 001–173 (`grep -n "FUNCTION[^(]*<name>"`):
--   trade_propose_internal                    148 → 151; source 151:475-619
--       (md5 of those lines 1abead9e91057c44f9429cf5cb492829) — 2 hunks
--       (+16 / -9): H1 the auth gate, H2 the arm's receipt removed.
--   trade_respond_internal                    148 → 151; source 151:1216-1535
--       (md5 63ce5d2fbf3c396e610d6985a7431546) — 2 hunks (+16 / -16): H1 the
--       commissioner refused by name ahead of the other-party sentence, H2
--       the arm's receipt removed.
--   commish_force_or_reverse_trade_internal   156 only; source 156:1284-1734
--       (md5 cf4c886df1c96c574d7739dab5227366) — 10 hunks (+38 / -99): H1
--       the shape gate's words, H2 / H3 approve's and veto's re-worded
--       refusals, H4 force's status filter + the accept-for arm removed, H5
--       the offer refused by name, H6 reverse refused by name, H7 the
--       reversal's re-score arm, H8 the reversal's transactions row, H9 / H10
--       the reversal's words in the post and the notification.
--   trade_rescind_on_stint_close              151 only; source 151:1545-1573
--       (md5 9bc1056acc6d6b37547e1be5db7a8ee7) — 1 hunk (+3 / -1): the E47 sentence.
-- 152–173 define none of the four (measured). Every other line of the four
-- bodies is byte-identical: the league lock first, the no-leak 42501s, the
-- R732 replays, the reason's normalisation, the deadline and state gates,
-- the executor calls (151 / 153 / 156's one hunk), the R1228 re-score of a
-- force, the receipts of approve / veto / force, the posts and notifications,
-- E47's loop.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Replaced: 4 bodies (signatures, volatility, SECURITY INVOKER internals /
--   the DEFINER trigger function, search_path '' and the ACLs unchanged — the
--   REVOKEs restated verbatim; the E47 trigger itself is untouched).
--   Dropped: 2 internal functions (no caller left; neither was ever
--   executable by anon / authenticated). No table, column, index, policy,
--   trigger or cron row. Time: no new clock read (p_at / now() as before).
--   Typegen: SUBTRACTIVE by exactly the two dropped internals (24 lines —
--   `commish_trade_reverse_internal`, `trade_receipt_internal`; nothing in
--   src/ names either); no signature moved; the hand-written alias block
--   kept. Realtime: nothing new (a trade's status change is broadcast by 148
--   as before).
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–174 and the full pgTAP run in the PR. D38 — no backfill:
--   nothing stored changes meaning (receipts, trades and transactions rows
--   written by the removed arms stay as history, as do E47 reasons already
--   stored).
--
-- DEPLOY ORDER (production at 173 when this merges; the app deploys at once):
--   the app stops OFFERING the removed acts first (no "answer for a team", no
--   Reverse, no force on an offer; the `/commish/trade` route's op enum drops
--   `reverse`), which is harmless against 173 — until 174 is pushed the
--   server would still accept those acts from another client, and after the
--   push it refuses them by name.
-- Rollback = re-apply 151:475-619, 151:1216-1535, 151:1545-1573 and
-- 156:1284-1734 verbatim and re-create the two dropped functions from
-- 148:353-417 / 156:880-1279.
--
-- Proof: pgTAP 122 (form + D137 in the database; the commissioner refused by
-- name on propose and on every respond op for a team he does not manage,
-- nothing written; a commissioner who manages a party acts as its manager
-- with no receipt; force refused on proposed / expired, accepted on in_review
-- / accepted (deferred) past the review, the vote, the lock and the deadline;
-- reverse refused by name, a pre-174 reverse action replayed; approve / veto
-- unchanged). 096 / 099 / 104 / 118 re-cut where they pinned the removed arms
-- (each cell named in PROGRESS D463). Break probes shown red then reverted in
-- the PR.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A1. trade_propose_internal — 151:475-619's FILE TEXT (D137), 2 hunks.
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

  -- (2) AUTH — the proposing team's manager. One no-leak 42501.
  --     174 (L.D3.16 — Chris 2026-09-30: "A commissioner cannot do anything
  --     to a trade unless it's already been accepted and the only option is
  --     veto or instantly push it through."):
  --     the TD5 commissioner arm is gone. A commissioner who does not manage
  --     this team is refused BY NAME (P0001 — he is a member, so there is
  --     nothing to leak); one who does manage it proposes as its manager.
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_from_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT v_is_manager THEN
    IF v_is_commish THEN
      RAISE EXCEPTION 'trade_propose: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only a team''s own manager offers a trade for it (§13.3)'
        USING ERRCODE = 'P0001';
    END IF;
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

  -- (7) 174 (L.D3.16): NO commissioner arm — only the team's manager gets
  --     here, so nothing is receipted: the result's acted_as_commissioner is
  --     FALSE and commissioner_action_id / system_post / reason are NULL (the
  --     keys kept for the wire shape).

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
-- A2. trade_respond_internal — 151:1216-1535's FILE TEXT (D137), 2 hunks.
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
  -- 174 (L.D3.16 — Chris 2026-09-30: "A commissioner cannot do anything to
  -- a trade unless it's already been accepted and the only option is veto or
  -- instantly push it through."): the TD5 commissioner arm is gone. A
  -- commissioner who manages neither team is refused BY NAME (P0001 — a
  -- member, nothing to leak); one who manages a party answers as its manager.
  IF NOT (v_is_manager OR v_is_other) THEN
    RAISE EXCEPTION 'trade_respond: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only the two teams in this trade answer the offer (§13.3)'
      USING ERRCODE = 'P0001';
  END IF;
  -- The OTHER party asked for this side's move — it is his trade too, so he
  -- is told by name which move is his.
  IF NOT v_is_manager THEN
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
REVOKE EXECUTE ON FUNCTION trade_respond_internal(UUID, UUID, TEXT, TEXT[], JSONB, TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A3. trade_rescind_on_stint_close (E47) — 151:1545-1573's FILE TEXT (D137),
--     1 hunk. The trigger (151's trg_trade_rescind_on_stint_close, ENABLE
--     ALWAYS) keeps pointing at it; nothing else moves.
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
    || COALESCE(NEW.end_reason, 'stint closed') || ') — a trade offered or agreed by the previous manager is called off (E47); the team''s next manager can offer it again';
    -- 174 (L.D3.16): the sentence no longer says the commissioner can
    -- re-propose it acting for the team — that arm is gone (ruled 2026-09-30).
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

-- ---------------------------------------------------------------------------
-- B. commish_force_or_reverse_trade_internal — 156:1284-1734's FILE TEXT
--    (D137), 10 hunks.
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
  v_score        JSONB := jsonb_build_object(
                   'score_week', NULL, 'score_week_status', NULL, 'score_rescore', '[]'::jsonb,
                   'score_enqueued', '[]'::jsonb, 'score_not_enqueued', '[]'::jsonb, 'score_reach_enqueued', '[]'::jsonb,
                   'score_reachable', NULL, 'score_stale', FALSE, 'score_stale_reason', NULL,
                   'edited_by_commish', FALSE, 'edited_lineup_rows', 0);   -- R1228: nothing moved ⇒ nothing to re-score
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
  -- 174 (L.D3.16): `reverse` passes this gate only to be refused BY NAME in
  -- (6) — after the replay, so a retry of a reversal made before 174 still
  -- replays its stored answer.
  IF p_op IS NULL OR p_op NOT IN ('approve', 'veto', 'force', 'reverse') THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: op % is not one of approve / veto / force (§10.1 / §13.3)', COALESCE(p_op, 'NULL')
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
      IF v_exec ->> 'outcome' = 'invalid' AND v_exec ? 'lock' THEN
        -- R1230: a TIMING cause (trade_lock_behavior = reject and a player
        -- has kicked off) — the tool that stands outside it is force.
        RAISE EXCEPTION
          'commish_force_or_reverse_trade: % already kicked off this week, and this league fails a locked trade instead of waiting (trade_lock_behavior = reject) — nothing was changed; force puts it through now (op force)',
          (SELECT string_agg(e ->> 'name', ', ' ORDER BY e ->> 'name') FROM jsonb_array_elements(v_exec #> '{lock,locked_players}') e)
          USING ERRCODE = 'P0001';
      ELSIF v_exec ->> 'outcome' = 'invalid' THEN
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
      -- 174 (L.D3.16): the words no longer point at the removed arms.
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is no review to approve — a commissioner acts on a trade only after it''s accepted: veto it or push it through; the receiving team accepts or turns down the offer (§13.3)'
        USING ERRCODE = 'P0001';
    ELSIF v_trade.status = 'expired' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this offer expired at the trade deadline before it was accepted, so there is no review to approve — a commissioner acts on a trade only after it''s accepted (§13.3)'
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
      -- 174 (L.D3.16): the words no longer point at the removed arms.
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is nothing to veto — a commissioner acts on a trade only after it''s accepted: veto it or push it through; the receiving team can turn the offer down, or the proposing team call it off (§13.3)'
        USING ERRCODE = 'P0001';
    ELSIF v_trade.status = 'complete' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade already went through, so it cannot be vetoed — a completed trade stands; to move a player use commish_move_player (§13.3)'
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade is not going through — it was % — so there is nothing to veto',
        public.commish_trade_closed_words_internal(v_trade)
        USING ERRCODE = 'P0001';
    END IF;

  ELSIF p_op = 'force' THEN
    -- 174 (L.D3.16 — Chris 2026-09-30: "A commissioner cannot do anything
    --     to a trade unless it's already been accepted and the only option is
    --     veto or instantly push it through."):
    --     force is for an ACCEPTED trade only — in review (the commissioner's
    --     review or a league vote) or accepted and waiting for the week's last
    --     game (deferred). An offer nobody accepted (`proposed`) or one the
    --     deadline closed (`expired`) is refused BY NAME below; 156's
    --     accept-for-the-receiving-team arm is gone, so accepted_for_team_id
    --     stays NULL. An accepted trade never met the deadline (Q76: accepted
    --     before it, it completes after it), so force still stands outside
    --     the review, the vote and the game-day lock — "instantly push it
    --     through".
    IF v_trade.status IN ('accepted', 'in_review') THEN
      -- What the force stands outside, NAMED (D336 part 7): the review, the
      -- game-day lock — TIMING rules (standing rule (i)).
      IF v_trade.status = 'in_review' THEN
        v_bypassed := v_bypassed || to_jsonb('review_period'::text);
        IF v_review = 'league_vote' THEN
          v_bypassed := v_bypassed || to_jsonb('league_vote'::text);
        END IF;
      END IF;
      v_lock := public.trade_lock_internal(p_trade_id, v_league, p_at);
      SELECT v_bypassed || COALESCE(jsonb_agg(to_jsonb('game_day_lock:' || (e ->> 'player_id')) ORDER BY e ->> 'player_id'), '[]'::jsonb)
      INTO v_bypassed
      FROM jsonb_array_elements(v_lock -> 'locked_players') e;

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
    ELSIF v_trade.status IN ('proposed', 'expired') THEN
      -- 174 (L.D3.16): an offer is the two teams' until it is accepted.
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: %, so it cannot be forced — a commissioner acts on a trade only after it''s accepted: veto it or push it through (§13.3)',
        CASE WHEN v_trade.status = 'proposed' THEN 'this offer has not been accepted yet'
             ELSE 'this offer expired at the trade deadline before it was accepted' END
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade cannot be forced — it was %; to move these players use commish_move_player',
        public.commish_trade_closed_words_internal(v_trade)
        USING ERRCODE = 'P0001';
    END IF;

  ELSE  -- reverse — 174 (L.D3.16): REMOVED (Chris 2026-09-30: "Remove reverse")
    RAISE EXCEPTION
      'commish_force_or_reverse_trade: reversing a trade is no longer a commissioner tool — a trade that went through stands; to move a player use commish_move_player (§13.3)'
      USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id;

  -- (7) R1228 — THE SCORE FOLLOWS (D346, §2c): when the trade's players
  --     moved (an approve / force that went through, or a reverse), every
  --     player who left a STARTING slot of the current week is re-scored
  --     while that week is being scored — so a played starter's points leave
  --     with him (F440). A deferred approve moved nothing.
  IF v_exec ->> 'outcome' = 'complete' THEN
    v_score := public.commish_trade_rescore_internal(
      v_league, (v_exec #>> '{payload,week}')::int,
      ARRAY[v_before.proposer_team_id, v_before.recipient_team_id], v_exec #> '{payload,lineups}');
  END IF;   -- 174 (L.D3.16): the reversal's arm went with reverse

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
        'bypassed',             v_bypassed) || v_score,
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_force_or_reverse_trade: the audit row was not written — refusing to let the override stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- 174 (L.D3.16): no reversal, so no `commissioner_move` transactions
    -- row here (the rows 156 wrote stay as history).

    -- (9) §10.3: the non-disableable system post, then BOTH managers told
    --     (TD16). An open seat notifies nobody; the actor is never notified
    --     of his own act.
    v_act_text := CASE v_outcome
      WHEN 'approved'          THEN 'approved a trade'
      WHEN 'approved_deferred' THEN 'approved a trade (it goes through right after this week''s last game ends)'
      WHEN 'vetoed'            THEN 'vetoed a trade'
      WHEN 'forced'            THEN 'forced a trade through'
    END;
    v_title := CASE v_outcome
      WHEN 'approved'          THEN 'The commissioner approved your trade'
      WHEN 'approved_deferred' THEN 'The commissioner approved your trade'
      WHEN 'vetoed'            THEN 'The commissioner vetoed your trade'
      WHEN 'forced'            THEN 'The commissioner put your trade through'
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
    'evaluated_at',           p_at) || v_score;

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266).
  INSERT INTO public.commish_trade_actions (league_id, trade_id, op, action_id, actor_id, result)
  VALUES (p_league_id, p_trade_id, p_op, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_force_or_reverse_trade_internal(UUID, UUID, TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C. The two functions with no caller left. Neither is reachable by a client
--    role (REVOKEd at birth — 148:416, 156:1279); DROP without CASCADE, so a
--    dependant nobody measured would stop this migration by name.
-- ---------------------------------------------------------------------------
DROP FUNCTION commish_trade_reverse_internal(UUID, public.leagues, TIMESTAMPTZ);
DROP FUNCTION trade_receipt_internal(UUID, public.teams, TEXT, TEXT, UUID, JSONB, JSONB, TEXT, UUID, TEXT, INTEGER);

-- ---------------------------------------------------------------------------
-- D. The doors say the ruled powers (bodies, signatures and ACLs unchanged).
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION trade_propose(UUID, UUID, UUID, JSONB, TEXT[], TEXT, UUID, TEXT) IS
  '§13.3 (migration 148, L.D3.2; 174, L.D3.16): propose a trade. p_items = [{"player_id": …, "from_team_id": …} | {"faab_amount": n, "from_team_id": …}]. The proposing team''s manager only — a commissioner who does not manage it is refused by name (Chris 2026-09-30: a commissioner acts on a trade only after it is accepted — veto it or push it through). Refuses by name: not in season / playoffs, a retired or foreign team, a player not on the team that gives him (exclusivity), the proposer''s roster over roster_size after the trade without enough drops (E36), FAAB legs when not allowed / above the balance, a one-sided trade without allow_future_considerations. Moves nothing; replay by action_id is byte-identical. p_reason is accepted and ignored (kept for the signature).';

COMMENT ON FUNCTION trade_respond(UUID, UUID, TEXT, TEXT[], JSONB, TEXT, UUID, TEXT) IS
  '§13.3 (migration 148, L.D3.2; 174, L.D3.16): answer a proposed trade — accept (the receiving team, naming the drops its roster needs, E36; everything re-validated under the lock), reject (the receiving team), cancel (the proposing team), counter (the receiving team: the offer is rejected and a new proposal the other way is created, linked by countered_from). The two teams'' managers only — a commissioner who manages neither is refused by name (Chris 2026-09-30: a commissioner acts on a trade only after it is accepted — veto it or push it through). Only a proposed trade can be answered; an accepted trade waits for review / execution (L.D3.3). Replay by action_id is byte-identical. p_reason is accepted and ignored (kept for the signature).';

COMMENT ON FUNCTION commish_force_or_reverse_trade(UUID, UUID, TEXT, TEXT, UUID) IS
  '§10.1 / §13.3 / §15.4 (migration 156, M5 L.D3.5; 174, L.D3.16 — Chris 2026-09-30: "A commissioner cannot do anything to a trade unless it''s already been accepted and the only option is veto or instantly push it through." / "Remove reverse"): the commissioner (or a co-commissioner) acts on one ACCEPTED trade. approve — a trade in review (commissioner review or a league vote) goes to the executor (it re-validates, waits for the game-day lock, records the trade); veto — a trade in review or accepted (incl. waiting for the lock) is closed vetoed; force — a trade in review or accepted goes through NOW, past the review, the vote and the game-day lock (validity still binds — refused by name); an offer not yet accepted, or one expired at the deadline, is refused by name. reverse is no longer an op — refused by name (a retry of a pre-174 reversal replays its stored answer). A no-op (the op''s state already holds) writes no receipt; otherwise ONE commissioner_actions row, a §10.3 chat post and both managers told. Own replay ledger (D350); reason optional (Q66).';
