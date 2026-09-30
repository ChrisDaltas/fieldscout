-- ============================================================================
-- 122 — the commissioner's trade powers: an ACCEPTED trade only — veto it or
--       push it through; reverse removed (migration 174; M6 L.D3.16 — an M5
--       trade rule changed by ruling, FULL rigour; spec §10.1, §10.3, §13.3,
--       §15.4; PROGRESS D416, D451, D463; M5 TD5)
-- ============================================================================
-- The rulings (Chris, 2026-09-30, verbatim): "A commissioner cannot do
-- anything to a trade unless it's already been accepted and the only option
-- is veto or instantly push it through." / "Remove reverse".
--
-- What this file proves, over REAL calls:
--   §A  form and D137 in the database — pg_temp.un174 reverses 174's
--       fifteen hunks to each body's newest definer (the pre-174 prosrc md5s,
--       stored literals); the live md5s; un174 an identity elsewhere; the two
--       dropped functions gone; the ledger still admits a stored 'reverse'.
--   §P  PROPOSE — the commissioner (and the co-commissioner) offering FOR a
--       team he does not manage is refused BY NAME (P0001), through the
--       internal and through the DEFINER door; a non-member and another
--       manager keep the no-leak 42501; nothing is written; as HIS OWN
--       team's manager the commissioner proposes and cancels like anyone,
--       with no receipt.
--   §R  RESPOND — accept / reject / counter / cancel FOR a team, refused BY
--       NAME for the commissioner and the co-commissioner (internal and
--       door); the other party still gets his own sentence; nothing written;
--       an offer TO the commissioner's own team he answers as its manager,
--       no receipt.
--   §F  FORCE — refused BY NAME on a proposed offer and on one the deadline
--       expired (nothing written); lands on an in-review trade (past the
--       review), a deferred accepted one (past the game-day lock), an
--       in-review one past the trade DEADLINE (the plain reading: "instantly
--       push it through"), and a league-vote one (past the vote).
--   §V  REVERSE — refused BY NAME on a completed trade (nothing written, no
--       commissioner_move row); a reversal answered BEFORE 174 still replays
--       byte-identically from the ledger, and its action id is still refused
--       for another op (R732).
--   §K  APPROVE / VETO unchanged — approve runs the executor, veto closes an
--       in-review trade; their refusals of an offer / a completed trade no
--       longer point at the removed arms.
--   §N  the whole file's receipts: approve / veto / force only, none acting
--       for a team, no arm post.
--
-- Calendar (2026, rewritten inside this transaction — 104's): weeks 1–6
-- over; week 7 starts Wed 2026-10-21 04:00Z, TXA kicks off Thu 10-23 00:15Z,
-- the week's last game ends Tue 10-27 03:30Z; week 8 starts Wed 10-28 04:00Z
-- (= the week-7 trade deadline). Every fixture player is on TXC (no game)
-- except K E Three (TXA).
--
-- Worlds (roster 1 QB + 2 bench = 3 spots):
--   L1 b1220…01 commissioner review (24 h), trade_deadline_week 7:
--      K Commish u1 (the COMMISSIONER, managing a team: k-c1 k-c2), K Alpha
--      u2 (k-a1 k-a2), K Bravo u3 (k-b1 k-b2), K Charlie u4 (k-h1 k-h2),
--      K Delta u5 (k-d1 k-d2), K Echo u6 (k-e1 k-e3); u7 a co-commissioner
--      with no team.
--   L2 b1220…02 league vote (trade_veto_votes 3): V Mike u2 (v-m1), V
--      November u3 (v-n1), V Oscar u4 (v-o1); u1 commissioner, no team.
--   u8 belongs to no league.
-- Descriptions carry no bare apostrophes (house rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(52);

-- pg_temp.un174 — 174's fifteen hunks reversed (derive_174.py; each
-- replacement text occurs once, in its own body only).
create function pg_temp.un174(s text) returns text language plpgsql as $un$
begin
  -- trade_propose_internal
  s := replace(s, $r$  -- (2) AUTH — the proposing team's manager. One no-leak 42501.
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
$r$, $o$  -- (2) AUTH — the proposing team's manager, or a commissioner acting for
  --     ANY team (TD5). One no-leak 42501.
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_from_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'trade_propose: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;
$o$);
  s := replace(s, $r$  -- (7) 174 (L.D3.16): NO commissioner arm — only the team's manager gets
  --     here, so nothing is receipted: the result's acted_as_commissioner is
  --     FALSE and commissioner_action_id / system_post / reason are NULL (the
  --     keys kept for the wire shape).
$r$, $o$  -- (7) THE COMMISSIONER ARM (TD5): ONE audit row acting as the proposer.
  IF NOT v_is_manager THEN
    v_receipt := public.trade_receipt_internal(
      p_league_id, v_from, 'propose_trade', 'proposed a trade for', v_trade_id,
      NULL, jsonb_build_object('status', 'proposed'), v_reason, p_action_id, 'trade_propose', v_league.season);
  END IF;
$o$);
  -- trade_respond_internal
  s := replace(s, $r$  -- 174 (L.D3.16 — Chris 2026-09-30: "A commissioner cannot do anything to
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
$r$, $o$  -- The OTHER party (not a commissioner) asked for this side's move — it is
  -- his trade too, so he is told by name which move is his.
  IF NOT (v_is_manager OR v_is_commish) THEN
$o$);
  s := replace(s, $r$  -- (7) 174 (L.D3.16): NO commissioner arm — only a party's manager gets
  --     here, so nothing is receipted: the result's acted_as_commissioner is
  --     FALSE and commissioner_action_id / system_post / reason are NULL (the
  --     keys kept for the wire shape).
$r$, $o$  -- (7) THE COMMISSIONER ARM: ONE audit row acting as the side he moved for.
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
$o$);
  -- commish_force_or_reverse_trade_internal
  s := replace(s, $r$  -- 174 (L.D3.16): `reverse` passes this gate only to be refused BY NAME in
  -- (6) — after the replay, so a retry of a reversal made before 174 still
  -- replays its stored answer.
  IF p_op IS NULL OR p_op NOT IN ('approve', 'veto', 'force', 'reverse') THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: op % is not one of approve / veto / force (§10.1 / §13.3)', COALESCE(p_op, 'NULL')
$r$, $o$  IF p_op IS NULL OR p_op NOT IN ('approve', 'veto', 'force', 'reverse') THEN
    RAISE EXCEPTION 'commish_force_or_reverse_trade: op % is not one of approve / veto / force / reverse (§10.1 / §13.3)', COALESCE(p_op, 'NULL')
$o$);
  s := replace(s, $r$    ELSIF v_trade.status = 'proposed' THEN
      -- 174 (L.D3.16): the words no longer point at the removed arms.
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is no review to approve — a commissioner acts on a trade only after it''s accepted: veto it or push it through; the receiving team accepts or turns down the offer (§13.3)'
        USING ERRCODE = 'P0001';
    ELSIF v_trade.status = 'expired' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this offer expired at the trade deadline before it was accepted, so there is no review to approve — a commissioner acts on a trade only after it''s accepted (§13.3)'
        USING ERRCODE = 'P0001';
$r$, $o$    ELSIF v_trade.status = 'proposed' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is no review to approve — the receiving team accepts it (the commissioner can accept for it with trade_respond), or force puts it through as it stands'
        USING ERRCODE = 'P0001';
    ELSIF v_trade.status = 'expired' THEN
      -- R1230: the deadline closed it — a timing rule; force stands outside it.
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this offer expired at the trade deadline before it was accepted, so there is no review to approve — force puts it through (op force)'
        USING ERRCODE = 'P0001';
$o$);
  s := replace(s, $r$    ELSIF v_trade.status = 'proposed' THEN
      -- 174 (L.D3.16): the words no longer point at the removed arms.
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is nothing to veto — a commissioner acts on a trade only after it''s accepted: veto it or push it through; the receiving team can turn the offer down, or the proposing team call it off (§13.3)'
        USING ERRCODE = 'P0001';
    ELSIF v_trade.status = 'complete' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade already went through, so it cannot be vetoed — a completed trade stands; to move a player use commish_move_player (§13.3)'
        USING ERRCODE = 'P0001';
$r$, $o$    ELSIF v_trade.status = 'proposed' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is nothing to veto — the receiving team can reject it (the commissioner can reject for it with trade_respond), or the proposing team can cancel it'
        USING ERRCODE = 'P0001';
    ELSIF v_trade.status = 'complete' THEN
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade already went through, so it cannot be vetoed — reverse it instead (op reverse)'
        USING ERRCODE = 'P0001';
$o$);
  s := replace(s, $r$  ELSIF p_op = 'force' THEN
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
$r$, $o$  ELSIF p_op = 'force' THEN
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
$o$);
  s := replace(s, $r$      v_outcome := 'forced';
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
$r$, $o$      v_outcome := 'forced';
    ELSE
      RAISE EXCEPTION
        'commish_force_or_reverse_trade: this trade cannot be forced — it was %; to move these players use commish_move_player',
$o$);
  s := replace(s, $r$  ELSE  -- reverse — 174 (L.D3.16): REMOVED (Chris 2026-09-30: "Remove reverse")
    RAISE EXCEPTION
      'commish_force_or_reverse_trade: reversing a trade is no longer a commissioner tool — a trade that went through stands; to move a player use commish_move_player (§13.3)'
      USING ERRCODE = '22023';
  END IF;
$r$, $o$  ELSE  -- reverse
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
$o$);
  s := replace(s, $r$  END IF;   -- 174 (L.D3.16): the reversal's arm went with reverse
$r$, $o$  ELSIF v_rev IS NOT NULL THEN
    v_score := public.commish_trade_rescore_internal(
      v_league, (v_rev ->> 'week')::int,
      ARRAY[v_before.proposer_team_id, v_before.recipient_team_id], v_rev -> 'lineups');
  END IF;
$o$);
  s := replace(s, $r$    -- 174 (L.D3.16): no reversal, so no `commissioner_move` transactions
    -- row here (the rows 156 wrote stay as history).

$r$, $o$    -- A reversal is a roster move: ONE transactions row, the commissioner's
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

$o$);
  s := replace(s, $r$      WHEN 'forced'            THEN 'forced a trade through'
    END;
$r$, $o$      WHEN 'forced'            THEN 'forced a trade through'
      WHEN 'reversed'          THEN 'reversed a trade — every player and any FAAB are back with the team that had them before it'
    END;
$o$);
  s := replace(s, $r$      WHEN 'forced'            THEN 'The commissioner put your trade through'
    END;
$r$, $o$      WHEN 'forced'            THEN 'The commissioner put your trade through'
      WHEN 'reversed'          THEN 'The commissioner reversed your trade'
    END;
$o$);
  -- trade_rescind_on_stint_close
  s := replace(s, $r$    || COALESCE(NEW.end_reason, 'stint closed') || ') — a trade offered or agreed by the previous manager is called off (E47); the team''s next manager can offer it again';
    -- 174 (L.D3.16): the sentence no longer says the commissioner can
    -- re-propose it acting for the team — that arm is gone (ruled 2026-09-30).
$r$, $o$    || COALESCE(NEW.end_reason, 'stint closed') || ') — a trade offered or agreed by the previous manager is called off (E47); the commissioner can re-propose it acting for the team';
$o$);
  return s;
end
$un$;

-- ---------------------------------------------------------------------------
-- A. Form, and D137 in the database
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s(%s):%s:%s:%s:%s', p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef,
                            array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('trade_propose_internal', 'trade_respond_internal', 'commish_force_or_reverse_trade_internal',
                       'trade_rescind_on_stint_close', 'trade_propose', 'trade_respond', 'commish_force_or_reverse_trade')),
  'commish_force_or_reverse_trade(p_league_id uuid, p_trade_id uuid, p_op text, p_reason text, p_action_id uuid):t:search_path="":f:t '
  || 'commish_force_or_reverse_trade_internal(p_league_id uuid, p_trade_id uuid, p_op text, p_action_id uuid, p_at timestamp with time zone, p_reason text):f:search_path="":f:f '
  || 'trade_propose(p_league_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_items jsonb, p_drops text[], p_note text, p_action_id uuid, p_reason text):t:search_path="":f:t '
  || 'trade_propose_internal(p_league_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_items jsonb, p_drops text[], p_note text, p_action_id uuid, p_at timestamp with time zone, p_reason text):f:search_path="":f:f '
  || 'trade_rescind_on_stint_close():t:search_path="":f:f '
  || 'trade_respond(p_league_id uuid, p_trade_id uuid, p_op text, p_drops text[], p_items jsonb, p_note text, p_action_id uuid, p_reason text):t:search_path="":f:t '
  || 'trade_respond_internal(p_league_id uuid, p_trade_id uuid, p_op text, p_drops text[], p_items jsonb, p_note text, p_action_id uuid, p_at timestamp with time zone, p_reason text):f:search_path="":f:f',
  'A1 the four replaced bodies and their three doors keep one overload, their signatures, DEFINER-ness and search_path; the doors open to authenticated only, the internals and the trigger function to nobody');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un174(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('trade_propose_internal', 'trade_respond_internal', 'commish_force_or_reverse_trade_internal', 'trade_rescind_on_stint_close')),
  'commish_force_or_reverse_trade_internal=71abff80878fc3e95f021f1bf1ef4c3a trade_propose_internal=b6f1b7e0224fa74568b554d76f2de102 '
  || 'trade_rescind_on_stint_close=2b76c1e12210c1187ffe03ef15408626 trade_respond_internal=3c2f02ebb3eb339dadc9226d0c83cb9f',
  'A2 D137: each live body with 174 reversed is its NEWEST definer FILE TEXT (156:1284 / 151:475 / 151:1545 / 151:1216 — the pre-174 prosrc md5s, stored literals)');
select is(
  (select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('trade_propose_internal', 'trade_respond_internal', 'commish_force_or_reverse_trade_internal', 'trade_rescind_on_stint_close')),
  'commish_force_or_reverse_trade_internal=457f949db92b1f4d2d28812d7ea1ddc1 trade_propose_internal=23893078572cd3495d21a61570145937 '
  || 'trade_rescind_on_stint_close=6208b2fb96b446cccf49267b2a8823ae trade_respond_internal=05ae76c9ee0ef69b6e37974d26604f95',
  'A3 the four live prosrc md5s — 174 as written (stored literals)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in ('trade_propose_internal', 'trade_respond_internal', 'commish_force_or_reverse_trade_internal', 'trade_rescind_on_stint_close')
     and pg_temp.un174(p.prosrc) <> p.prosrc),
  0,
  'A4 un174 is an identity on every other body in the schema (additive, R992)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_trade_reverse_internal', 'trade_receipt_internal')),
  0,
  'A5 the reversal internal and the TD5 arm receipt seam are DROPPED — no caller was left');
select ok(
  (select bool_and(obj_description(p.oid, 'pg_proc') like '%174%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('trade_propose', 'trade_respond', 'commish_force_or_reverse_trade'))
  and (select obj_description('public.commish_force_or_reverse_trade(uuid, uuid, text, text, uuid)'::regprocedure, 'pg_proc')) like '%reverse is no longer an op%',
  'A6 the three door comments say the ruled powers (174), and the commissioner door says reverse is no longer an op');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'commish_trade_actions_op_check'),
  'CHECK ((op = ANY (ARRAY[''approve''::text, ''veto''::text, ''force''::text, ''reverse''::text])))',
  'A7 the ledger CHECK still admits reverse, so a reversal answered before 174 stays a readable, replayable row');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 6 then w.starts_at + interval '6 days'
                             when w.week = 7 then '2026-10-27 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'kx-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 12;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('kx-g7a', 2026, 7, 'TXA', 'TXZ', '2026-10-23 00:15:00+00'), ('kx-g8a', 2026, 8, 'TXA', 'TXZ', '2026-10-30 00:15:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91220000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-kx' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'kx_user' || i)::jsonb, now(), now()
from generate_series(1, 8) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review, trade_deadline_week,
                     settings, roster_settings)
select l.id, '91220000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 8, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', 'faab', 100, l.review, l.dl, l.st,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b1220000-0000-4000-8000-000000000001'::uuid, 'pgtap-kx-L1', 'commissioner', 7, '{}'::jsonb),
 ('b1220000-0000-4000-8000-000000000002'::uuid, 'pgtap-kx-L2', 'league_vote', null, '{"trade_veto_votes": 3}'::jsonb)
) as l(id, nm, review, dl, st);

insert into teams (id, owner_id, name, league_id, status)
select ('c1220000-0000-4000-8000-' || lpad(t.n::text, 12, '0'))::uuid, ('91220000-0000-4000-8000-' || lpad(t.u::text, 12, '0'))::uuid,
       t.nm, ('b1220000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 (11, 1, 'K Commish', 1), (12, 2, 'K Alpha', 1), (13, 3, 'K Bravo', 1), (14, 4, 'K Charlie', 1), (15, 5, 'K Delta', 1), (16, 6, 'K Echo', 1),
 (21, 2, 'V Mike', 2), (22, 3, 'V November', 2), (23, 4, 'V Oscar', 2)
) as t(n, u, nm, lg);
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '91220000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c1220000-%';
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b1220000-0000-4000-8000-000000000001', '91220000-0000-4000-8000-000000000007', null, 'co_commissioner', false, null),
 ('b1220000-0000-4000-8000-000000000002', '91220000-0000-4000-8000-000000000001', null, 'commissioner', false, null);
insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 12) w where l.id::text like 'b1220000-%';

insert into players (id, full_name, position, team, status)
select p.id, p.nm, 'QB', p.tm, 'Active'
from (values
 ('k-c1', 'K C One', 'TXC'), ('k-c2', 'K C Two', 'TXC'), ('k-a1', 'K A One', 'TXC'), ('k-a2', 'K A Two', 'TXC'),
 ('k-b1', 'K B One', 'TXC'), ('k-b2', 'K B Two', 'TXC'), ('k-h1', 'K H One', 'TXC'), ('k-h2', 'K H Two', 'TXC'),
 ('k-d1', 'K D One', 'TXC'), ('k-d2', 'K D Two', 'TXC'), ('k-e1', 'K E One', 'TXC'), ('k-e3', 'K E Three', 'TXA'),
 ('v-m1', 'V M One', 'TXC'), ('v-n1', 'V N One', 'TXC'), ('v-o1', 'V O One', 'TXC')
) as p(id, nm, tm);
insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('K Commish', 'k-c1'), ('K Commish', 'k-c2'), ('K Alpha', 'k-a1'), ('K Alpha', 'k-a2'), ('K Bravo', 'k-b1'), ('K Bravo', 'k-b2'),
 ('K Charlie', 'k-h1'), ('K Charlie', 'k-h2'), ('K Delta', 'k-d1'), ('K Delta', 'k-d2'), ('K Echo', 'k-e1'), ('K Echo', 'k-e3'),
 ('V Mike', 'v-m1'), ('V November', 'v-n1'), ('V Oscar', 'v-o1')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c1220000-%';
insert into league_player_pool (league_id, player_id, state, waivers_until, updated_at)
select r.league_id, r.player_id, 'rostered', null, '2026-10-01 00:00:00+00' from league_rosters r where r.player_id like 'k-%' or r.player_id like 'v-%';

-- Post-reset race guard (067's): today's + tomorrow's realtime.messages partitions.
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'realtime' and c.relname = part_name) then
      execute format('create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
                     part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;

create temp table r122 (tag text primary key, r jsonb not null);
grant select, insert on r122 to authenticated, anon;
create function pg_temp.uid(p_n int) returns uuid language sql as $$ select ('91220000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p_n), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c1220000-%' $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b1220000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a1220000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.swap(p_give text, p_from text, p_get text, p_to text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('player_id', p_give, 'from_team_id', pg_temp.team(p_from)),
                           jsonb_build_object('player_id', p_get, 'from_team_id', pg_temp.team(p_to))) $$;
create function pg_temp.tid(p_tag text) returns uuid language sql as $$ select (r #>> '{trade,id}')::uuid from r122 where tag = p_tag $$;
-- prop(tag, league, actor, from, to, legs, at, action) — trade_propose_internal as the actor, kept under tag.
create function pg_temp.prop(p_tag text, p_lg int, p_user int, p_from text, p_to text, p_items jsonb, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r122 select p_tag, public.trade_propose_internal(pg_temp.lg(p_lg), pg_temp.team(p_from), pg_temp.team(p_to), p_items, null, null, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r122 where tag = p_tag);
end $$;
-- a propose whose refusal is asserted (nothing kept)
create function pg_temp.try_prop(p_lg int, p_user int, p_from text, p_to text, p_items jsonb, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.trade_propose_internal(pg_temp.lg(p_lg), pg_temp.team(p_from), pg_temp.team(p_to), p_items, null, null, pg_temp.act(p_act), p_at, 'for them');
end $$;
-- resp(tag, league, actor, trade tag, op, at, action) — trade_respond_internal as the actor.
create function pg_temp.resp(p_tag text, p_lg int, p_user int, p_trade text, p_op text, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r122 select p_tag, public.trade_respond_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), p_op, null, null, null, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r122 where tag = p_tag);
end $$;
create function pg_temp.try_resp(p_lg int, p_user int, p_trade text, p_op text, p_items jsonb, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.trade_respond_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), p_op, null, p_items, null, pg_temp.act(p_act), p_at, 'for them');
end $$;
-- cx(tag, league, actor, trade tag, op, at, action) — the commissioner verb, kept under tag.
create function pg_temp.cx(p_tag text, p_lg int, p_user int, p_trade text, p_op text, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r122 select p_tag, public.commish_force_or_reverse_trade_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), p_op, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r122 where tag = p_tag);
end $$;
create function pg_temp.try_cx(p_lg int, p_user int, p_trade text, p_op text, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.commish_force_or_reverse_trade_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), p_op, pg_temp.act(p_act), p_at, null);
end $$;
create function pg_temp.st(p_tag text) returns text language sql as $$ select t.status from trades t where t.id = pg_temp.tid(p_tag) $$;
create function pg_temp.roster(p_team text) returns text language sql as $$
  select coalesce(string_agg(r.player_id, ',' order by r.player_id), '') from league_rosters r where r.team_id = pg_temp.team(p_team) $$;
-- the footprint of a league: trades | trade ledger rows | commissioner receipts | commissioner ledger rows | commissioner posts | notifications
create function pg_temp.fp(p_lg int) returns text language sql as $$
  select concat_ws('|',
    (select count(*) from trades where league_id = pg_temp.lg(p_lg)),
    (select count(*) from trade_actions where league_id = pg_temp.lg(p_lg)),
    (select count(*) from commissioner_actions where league_id = pg_temp.lg(p_lg)),
    (select count(*) from commish_trade_actions where league_id = pg_temp.lg(p_lg)),
    (select count(*) from league_chat where league_id = pg_temp.lg(p_lg) and is_system and message like '%(commissioner)%'),
    (select count(*) from notifications where data ->> 'league_id' = pg_temp.lg(p_lg)::text)) $$;

select is(pg_temp.fp(1) || ' / ' || pg_temp.fp(2), '0|0|0|0|0|0 / 0|0|0|0|0|0', 'B1 PREMISE: two empty leagues — no trade, ledger row, receipt, post or notification');

-- ---------------------------------------------------------------------------
-- P. PROPOSE — the commissioner does not offer a trade for a team he does
--    not manage (ruled 2026-09-30).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select pg_temp.try_prop(1, 1, 'K Alpha', 'K Bravo', pg_temp.swap('k-a2', 'K Alpha', 'k-b1', 'K Bravo'), '2026-10-21 10:00:00+00', 1) $$,
  'P0001', 'trade_propose: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only a team''s own manager offers a trade for it (§13.3)',
  'P1 THE RULING: the commissioner offering a trade FOR K Alpha (not his team) is refused BY NAME');
select throws_ok(
  $$ select pg_temp.try_prop(1, 7, 'K Alpha', 'K Bravo', pg_temp.swap('k-a2', 'K Alpha', 'k-b1', 'K Bravo'), '2026-10-21 10:00:00+00', 2) $$,
  'P0001', 'trade_propose: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only a team''s own manager offers a trade for it (§13.3)',
  'P2 …and so is the CO-commissioner (identical powers)');
create temp table q122 (tag text primary key, q text not null);
grant select on q122 to authenticated;
insert into q122 select 'P3', format($$ select public.trade_propose(%L, %L, %L, %L::jsonb, null, null, %L, 'for them') $$,
  pg_temp.lg(1), pg_temp.team('K Alpha'), pg_temp.team('K Bravo'), pg_temp.swap('k-a2', 'K Alpha', 'k-b1', 'K Bravo'), pg_temp.act(3));
set local role authenticated;
select pg_temp.as_user(1);
select throws_ok(
  (select q from q122 where tag = 'P3'),
  'P0001', 'trade_propose: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only a team''s own manager offers a trade for it (§13.3)',
  'P3 …through the DEFINER door as the authenticated role too (the gate is in the body)');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select pg_temp.try_prop(1, 8, 'K Alpha', 'K Bravo', pg_temp.swap('k-a2', 'K Alpha', 'k-b1', 'K Bravo'), '2026-10-21 10:00:00+00', 4) $$,
  '42501', 'trade_propose: not a manager of this team',
  'P4 a NON-member keeps the one no-leak 42501');
select throws_ok(
  $$ select pg_temp.try_prop(1, 3, 'K Alpha', 'K Bravo', pg_temp.swap('k-a2', 'K Alpha', 'k-b1', 'K Bravo'), '2026-10-21 10:00:00+00', 5) $$,
  '42501', 'trade_propose: not a manager of this team',
  'P5 another MANAGER of the league offering for K Alpha keeps the no-leak 42501 (unchanged)');
select is(pg_temp.fp(1), '0|0|0|0|0|0', 'P6 the refusals wrote NOTHING: no trade, ledger row, receipt, post or notification');
-- The commissioner AS HIS OWN TEAM'S MANAGER: K Commish offers k-c1 for k-a1.
select pg_temp.prop('OWN', 1, 1, 'K Commish', 'K Alpha', pg_temp.swap('k-c1', 'K Commish', 'k-a1', 'K Alpha'), '2026-10-21 10:30:00+00', 6);
select is(
  (select concat_ws('|', r #>> '{trade,status}', r ->> 'acted_as_commissioner', coalesce(r ->> 'commissioner_action_id', 'NULL'),
                    coalesce(r ->> 'system_post', 'NULL'), coalesce(r ->> 'reason', 'NULL'), r ->> 'notified_user_ids') from r122 where tag = 'OWN')
    || ' / ' || pg_temp.fp(1),
  'proposed|false|NULL|NULL|NULL|["91220000-0000-4000-8000-000000000002"] / 1|1|0|0|0|1',
  'P7 as the manager of HIS OWN team the commissioner offers a trade like anyone: proposed, no receipt, no post, the receiving manager told');
select pg_temp.resp('OWNc', 1, 1, 'OWN', 'cancel', '2026-10-21 10:40:00+00', 7);
select is(
  (select concat_ws('|', r #>> '{trade,status}', r ->> 'acted_as_commissioner', coalesce(r ->> 'commissioner_action_id', 'NULL')) from r122 where tag = 'OWNc')
    || ' / ' || (select status_reason from trades where id = pg_temp.tid('OWN')) || ' / ' || pg_temp.fp(1),
  'cancelled|false|NULL / cancelled by K Commish / 1|2|0|0|0|2',
  'P8 …and calls his own offer off as its manager: cancelled by K Commish, no receipt');

-- ---------------------------------------------------------------------------
-- R. RESPOND — accepting, turning down, countering or calling off an offer
--    is the two teams own.
-- ---------------------------------------------------------------------------
select pg_temp.prop('TA', 1, 2, 'K Alpha', 'K Bravo', pg_temp.swap('k-a2', 'K Alpha', 'k-b1', 'K Bravo'), '2026-10-21 11:00:00+00', 10);
select throws_ok($$ select pg_temp.try_resp(1, 1, 'TA', 'accept', null, '2026-10-21 11:10:00+00', 11) $$,
  'P0001', 'trade_respond: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only the two teams in this trade answer the offer (§13.3)',
  'R1 THE RULING: the commissioner accepting FOR K Bravo is refused BY NAME');
select throws_ok($$ select pg_temp.try_resp(1, 1, 'TA', 'reject', null, '2026-10-21 11:10:00+00', 12) $$,
  'P0001', 'trade_respond: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only the two teams in this trade answer the offer (§13.3)',
  'R2 …turning it down FOR K Bravo, the same');
select throws_ok(
  $$ select pg_temp.try_resp(1, 1, 'TA', 'counter', pg_temp.swap('k-b2', 'K Bravo', 'k-a1', 'K Alpha'), '2026-10-21 11:10:00+00', 13) $$,
  'P0001', 'trade_respond: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only the two teams in this trade answer the offer (§13.3)',
  'R3 …countering FOR K Bravo, the same');
select throws_ok($$ select pg_temp.try_resp(1, 1, 'TA', 'cancel', null, '2026-10-21 11:10:00+00', 14) $$,
  'P0001', 'trade_respond: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only the two teams in this trade answer the offer (§13.3)',
  'R4 …calling it off FOR K Alpha (the proposer), the same');
select throws_ok($$ select pg_temp.try_resp(1, 7, 'TA', 'accept', null, '2026-10-21 11:10:00+00', 15) $$,
  'P0001', 'trade_respond: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only the two teams in this trade answer the offer (§13.3)',
  'R5 …and the CO-commissioner accepting FOR K Bravo, the same');
insert into q122 select 'R6', format($$ select public.trade_respond(%L, %L, 'accept', null, null, null, %L, 'for them') $$,
  pg_temp.lg(1), pg_temp.tid('TA'), pg_temp.act(16));
set local role authenticated;
select pg_temp.as_user(1);
select throws_ok(
  (select q from q122 where tag = 'R6'),
  'P0001', 'trade_respond: A commissioner acts on a trade only after it''s accepted: veto it or push it through. Only the two teams in this trade answer the offer (§13.3)',
  'R6 …through the DEFINER door as the authenticated role too');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select pg_temp.try_resp(1, 8, 'TA', 'accept', null, '2026-10-21 11:10:00+00', 17) $$,
  '42501', 'trade_respond: not a party to this trade',
  'R7 a NON-member keeps the one no-leak 42501');
select throws_ok($$ select pg_temp.try_resp(1, 4, 'TA', 'accept', null, '2026-10-21 11:10:00+00', 18) $$,
  '42501', 'trade_respond: not a party to this trade',
  'R8 a manager of a team NOT in the trade keeps the no-leak 42501 (unchanged)');
select throws_ok($$ select pg_temp.try_resp(1, 2, 'TA', 'accept', null, '2026-10-21 11:10:00+00', 19) $$,
  'P0001', 'trade_respond: only the team that received a trade can accept it — you proposed this one, so cancel it instead (§13.3)',
  'R9 the OTHER party still gets his own sentence (unchanged)');
select is(pg_temp.st('TA') || ' / ' || pg_temp.fp(1), 'proposed / 2|3|0|0|0|3',
  'R10 the refusals wrote NOTHING: the offer still proposed, one ledger row for it, no receipt, post or notification beyond the offer');
-- An offer TO the commissioner's own team: he answers as its manager.
select pg_temp.prop('TK', 1, 4, 'K Charlie', 'K Commish', pg_temp.swap('k-h1', 'K Charlie', 'k-c2', 'K Commish'), '2026-10-21 11:30:00+00', 20);
select pg_temp.resp('TKa', 1, 1, 'TK', 'accept', '2026-10-21 12:30:00+00', 21);
select is(
  (select concat_ws('|', r #>> '{trade,status}', r ->> 'acted_as_commissioner', coalesce(r ->> 'commissioner_action_id', 'NULL'),
                    coalesce(r ->> 'system_post', 'NULL'), r #>> '{review,mode}') from r122 where tag = 'TKa')
    || ' / ' || (select (accepted_by = pg_temp.uid(1))::text from trades where id = pg_temp.tid('TK'))
    || ' / ' || (select count(*) from commissioner_actions where league_id = pg_temp.lg(1)),
  'in_review|false|NULL|NULL|commissioner / true / 0',
  'R11 an offer TO the team of the commissioner: he accepts it as its manager — in review (commissioner review), no receipt');
-- (K1 runs here, before the deadline tick below would approve TK on its own.)
select pg_temp.cx('K1', 1, 1, 'TK', 'approve', '2026-10-21 14:00:00+00', 60);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status', r #>> '{execution,via}') from r122 where tag = 'K1')
    || ' / ' || pg_temp.roster('K Commish') || ' ' || pg_temp.roster('K Charlie'),
  'approved|complete|commissioner_approve / k-c1,k-h1 k-c2,k-h2',
  'K1 approve of a trade in review runs the executor (via commissioner_approve) — unchanged');

-- ---------------------------------------------------------------------------
-- F. FORCE — an accepted trade only; "instantly push it through".
-- ---------------------------------------------------------------------------
select pg_temp.resp('TAa', 1, 3, 'TA', 'accept', '2026-10-21 12:00:00+00', 22);
select pg_temp.prop('TB', 1, 4, 'K Charlie', 'K Delta', pg_temp.swap('k-h2', 'K Charlie', 'k-d1', 'K Delta'), '2026-10-21 11:40:00+00', 23);
create temp table f122_before as
select (select count(*) from commish_trade_actions where league_id = pg_temp.lg(1)) as ledger,
       (select count(*) from commissioner_actions where league_id = pg_temp.lg(1)) as receipts;
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TB', 'force', '2026-10-21 12:10:00+00', 24) $$,
  'P0001', 'commish_force_or_reverse_trade: this offer has not been accepted yet, so it cannot be forced — a commissioner acts on a trade only after it''s accepted: veto it or push it through (§13.3)',
  'F1 THE RULING: forcing an offer nobody accepted is refused BY NAME (156 accepted it for the receiving team)');
select is(
  pg_temp.st('TB') || ' / ' || (select (accepted_by is null)::text from trades where id = pg_temp.tid('TB'))
    || ' / ' || pg_temp.roster('K Charlie') || ' ' || pg_temp.roster('K Delta')
    || ' / ' || ((select count(*) from commish_trade_actions where league_id = pg_temp.lg(1)) - (select ledger from f122_before))
    || '|' || ((select count(*) from commissioner_actions where league_id = pg_temp.lg(1)) - (select receipts from f122_before)),
  'proposed / true / k-c2,k-h2 k-d1,k-d2 / 0|0',
  'F2 …and nothing was written: still proposed, accepted by nobody, both rosters as they were, no ledger row, no receipt');
select pg_temp.cx('F3', 1, 1, 'TA', 'force', '2026-10-21 13:00:00+00', 25);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status_before', r ->> 'status', r #>> '{execution,via}', r ->> 'bypassed',
                    coalesce(r ->> 'accepted_for_team_id', 'NULL'), (r ->> 'commissioner_action_id') is not null) from r122 where tag = 'F3')
    || ' / ' || pg_temp.roster('K Alpha') || ' ' || pg_temp.roster('K Bravo'),
  'forced|in_review|complete|commissioner_force|["review_period"]|NULL|t / k-a1,k-b1 k-a2,k-b2',
  'F3 an IN-REVIEW trade is pushed through at once, past the rest of the review — one receipt, nobody accepted for');
-- TD: K Echo gives K E Three (TXA, kicked off Thu 00:15Z) for K D Two.
select pg_temp.prop('TD', 1, 6, 'K Echo', 'K Delta', pg_temp.swap('k-e3', 'K Echo', 'k-d2', 'K Delta'), '2026-10-22 11:00:00+00', 26);
select pg_temp.resp('TDa', 1, 5, 'TD', 'accept', '2026-10-22 12:00:00+00', 27);
select pg_temp.cx('TDap', 1, 1, 'TD', 'approve', '2026-10-23 06:00:00+00', 28);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status', (r #>> '{trade,execute_after}')::timestamptz = '2026-10-27 03:30:00+00') from r122 where tag = 'TDap'),
  'approved_deferred|accepted|t',
  'F4 PREMISE: the approve of a trade whose player already played waits for the last game of the week (accepted, deferred — Q75)');
select pg_temp.cx('F5', 1, 1, 'TD', 'force', '2026-10-23 07:00:00+00', 29);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status_before', r ->> 'status', r ->> 'bypassed') from r122 where tag = 'F5')
    || ' / ' || pg_temp.roster('K Echo') || ' ' || pg_temp.roster('K Delta'),
  'forced|accepted|complete|["game_day_lock:k-e3"] / k-d2,k-e1 k-d1,k-e3',
  'F5 an ACCEPTED trade waiting for the lock is pushed through now, past the game-day lock');
-- TE: accepted BEFORE the deadline (week 8 starts Wed 10-28 04:00Z), its
-- 24-hour review running past it; TC: an offer the deadline expires.
select pg_temp.prop('TE', 1, 2, 'K Alpha', 'K Echo', pg_temp.swap('k-b1', 'K Alpha', 'k-e1', 'K Echo'), '2026-10-27 11:00:00+00', 30);
select pg_temp.resp('TEa', 1, 6, 'TE', 'accept', '2026-10-27 12:00:00+00', 31);
select pg_temp.prop('TC', 1, 3, 'K Bravo', 'K Charlie', pg_temp.swap('k-a2', 'K Bravo', 'k-h2', 'K Charlie'), '2026-10-27 12:05:00+00', 32);
insert into r122 select 'tick', public.trade_tick('2026-10-28 04:00:00+00', pg_temp.lg(1));
select is(pg_temp.st('TE') || ' ' || pg_temp.st('TC') || ' ' || pg_temp.st('TB'), 'in_review expired expired',
  'F6 PREMISE: at the deadline the tick expires the two offers still pending; the accepted trade stays in review');
select pg_temp.cx('F7', 1, 1, 'TE', 'force', '2026-10-28 05:00:00+00', 33);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status_before', r ->> 'status', r ->> 'bypassed') from r122 where tag = 'F7')
    || ' / ' || pg_temp.roster('K Alpha') || ' ' || pg_temp.roster('K Echo'),
  'forced|in_review|complete|["review_period"] / k-a1,k-e1 k-b1,k-d2',
  'F7 THE PLAIN READING: a trade accepted before the deadline and still in review AFTER it is pushed through instantly (the deadline never bound an accepted trade — Q76)');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TC', 'force', '2026-10-28 05:30:00+00', 34) $$,
  'P0001', 'commish_force_or_reverse_trade: this offer expired at the trade deadline before it was accepted, so it cannot be forced — a commissioner acts on a trade only after it''s accepted: veto it or push it through (§13.3)',
  'F8 THE RULING: an offer the DEADLINE expired is not forced — refused BY NAME');
select is(
  pg_temp.st('TC') || ' / ' || (select (accepted_by is null)::text from trades where id = pg_temp.tid('TC'))
    || ' / ' || pg_temp.roster('K Bravo') || ' ' || pg_temp.roster('K Charlie'),
  'expired / true / k-a2,k-b2 k-c2,k-h2',
  'F9 …and nothing was written: still expired, accepted by nobody, rosters as they were');
-- L2: a league-vote trade in review.
select pg_temp.prop('W1', 2, 2, 'V Mike', 'V November', pg_temp.swap('v-m1', 'V Mike', 'v-n1', 'V November'), '2026-10-21 11:00:00+00', 40);
select pg_temp.resp('W1a', 2, 3, 'W1', 'accept', '2026-10-21 12:00:00+00', 41);
select pg_temp.cx('F10', 2, 1, 'W1', 'force', '2026-10-21 13:00:00+00', 42);
select is(
  (select concat_ws('|', r ->> 'trade_review', r ->> 'outcome', r ->> 'status', r ->> 'bypassed') from r122 where tag = 'F10')
    || ' / ' || pg_temp.roster('V Mike') || ' ' || pg_temp.roster('V November'),
  'league_vote|forced|complete|["review_period", "league_vote"] / v-n1 v-m1',
  'F10 a LEAGUE-VOTE trade in review is pushed through, past the review and the vote');

-- ---------------------------------------------------------------------------
-- V. REVERSE — removed ("Remove reverse"); history stays readable.
-- ---------------------------------------------------------------------------
create temp table v122_before as
select (select count(*) from commish_trade_actions where league_id = pg_temp.lg(1)) as ledger,
       (select count(*) from commissioner_actions where league_id = pg_temp.lg(1)) as receipts;
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TA', 'reverse', '2026-10-28 06:00:00+00', 50) $$,
  '22023', 'commish_force_or_reverse_trade: reversing a trade is no longer a commissioner tool — a trade that went through stands; to move a player use commish_move_player (§13.3)',
  'V1 THE RULING: reversing a COMPLETED trade is refused BY NAME');
select is(
  pg_temp.st('TA') || ' / ' || pg_temp.roster('K Alpha') || ' ' || pg_temp.roster('K Bravo')
    || ' / ' || ((select count(*) from commish_trade_actions where league_id = pg_temp.lg(1)) - (select ledger from v122_before))
    || '|' || ((select count(*) from commissioner_actions where league_id = pg_temp.lg(1)) - (select receipts from v122_before))
    || '|' || (select count(*) from transactions where league_id = pg_temp.lg(1) and type = 'commissioner_move'),
  'complete / k-a1,k-e1 k-a2,k-b2 / 0|0|0',
  'V2 …and nothing was written: the trade still complete, rosters as they stand, no ledger row, no receipt, no commissioner_move row');
-- A reversal answered BEFORE 174 (its ledger row, as 156 stored it).
insert into commish_trade_actions (league_id, trade_id, op, action_id, actor_id, result)
values (pg_temp.lg(1), pg_temp.tid('TA'), 'reverse', pg_temp.act(51), pg_temp.uid(1),
        '{"op": "reverse", "outcome": "reversed", "answered": "before 174"}'::jsonb);
select pg_temp.cx('V3', 1, 1, 'TA', 'reverse', '2026-10-28 06:10:00+00', 51);
select is(
  (select r::text from r122 where tag = 'V3'),
  '{"op": "reverse", "outcome": "reversed", "answered": "before 174"}',
  'V3 a retry of a reversal answered BEFORE 174 still replays its stored answer byte-identically (the refusal sits after the replay)');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TA', 'veto', '2026-10-28 06:20:00+00', 51) $$,
  'P0001', 'commish_force_or_reverse_trade: action_id a1220000-0000-4000-8000-000000000051 already names a reverse of another trade or another op in this league — an action_id identifies ONE submit (R732)',
  'V4 …and its action id is still refused for another op (R732)');

-- ---------------------------------------------------------------------------
-- K. APPROVE / VETO — unchanged in behaviour; their refusals re-worded.
-- ---------------------------------------------------------------------------
select pg_temp.prop('TG', 1, 5, 'K Delta', 'K Alpha', pg_temp.swap('k-d1', 'K Delta', 'k-a1', 'K Alpha'), '2026-10-21 15:00:00+00', 61);
select pg_temp.resp('TGa', 1, 2, 'TG', 'accept', '2026-10-21 15:30:00+00', 62);
select pg_temp.cx('K2', 1, 1, 'TG', 'veto', '2026-10-21 16:00:00+00', 63);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status_before', r ->> 'status') from r122 where tag = 'K2')
    || ' / ' || (select status_reason from trades where id = pg_temp.tid('TG')),
  'vetoed|in_review|vetoed / vetoed by the commissioner',
  'K2 veto of a trade in review closes it — unchanged');
select pg_temp.prop('TH', 1, 3, 'K Bravo', 'K Delta', pg_temp.swap('k-b2', 'K Bravo', 'k-d1', 'K Delta'), '2026-10-28 03:00:00+00', 64);
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TH', 'approve', '2026-10-28 03:10:00+00', 65) $$,
  'P0001', 'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is no review to approve — a commissioner acts on a trade only after it''s accepted: veto it or push it through; the receiving team accepts or turns down the offer (§13.3)',
  'K3 approve of an OFFER is refused by name — no longer pointing at trade_respond or force');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TH', 'veto', '2026-10-28 03:10:00+00', 66) $$,
  'P0001', 'commish_force_or_reverse_trade: this trade has not been accepted yet, so there is nothing to veto — a commissioner acts on a trade only after it''s accepted: veto it or push it through; the receiving team can turn the offer down, or the proposing team call it off (§13.3)',
  'K4 veto of an OFFER is refused by name — no longer pointing at trade_respond');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TA', 'veto', '2026-10-28 06:30:00+00', 67) $$,
  'P0001', 'commish_force_or_reverse_trade: this trade already went through, so it cannot be vetoed — a completed trade stands; to move a player use commish_move_player (§13.3)',
  'K5 veto of a COMPLETED trade: it stands — no longer pointing at reverse');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TC', 'approve', '2026-10-28 06:40:00+00', 68) $$,
  'P0001', 'commish_force_or_reverse_trade: this offer expired at the trade deadline before it was accepted, so there is no review to approve — a commissioner acts on a trade only after it''s accepted (§13.3)',
  'K6 approve of an EXPIRED offer is refused by name — no longer pointing at force');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'TA', 'undo', '2026-10-28 06:50:00+00', 69) $$,
  '22023', 'commish_force_or_reverse_trade: op undo is not one of approve / veto / force (§10.1 / §13.3)',
  'K7 an unknown op is refused by name (22023) — the list no longer names reverse');

-- ---------------------------------------------------------------------------
-- N. THE WHOLE FILE — only the commissioner tools on an accepted trade wrote
--    receipts, none acting for a team, and the arm never posted.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s', action_type, n), ' ' order by action_type)
   from (select action_type, count(*) n from commissioner_actions where league_id::text like 'b1220000-%' group by action_type) x),
  'approve_trade=2 force_trade=4 veto_trade=1',
  'N1 the receipts of the file: approve TD / TK, force TA / TD / TE / W1, veto TG — no propose / accept / reject / counter / cancel receipt, no reverse');
select is(
  (select count(*)::int from commissioner_actions where league_id::text like 'b1220000-%' and acting_as_team_id is not null),
  0,
  'N2 none of them acts for a team (the tools act on the trade, D451)');
select is(
  (select count(*)::int from league_chat where league_id::text like 'b1220000-%' and is_system and message like '% a trade for %'),
  0,
  'N3 no post of the old arm (proposed / accepted / rejected / cancelled / countered a trade FOR a team) anywhere');
select is(
  (select count(*)::int from trades where league_id::text like 'b1220000-%' and accepted_by = pg_temp.uid(1)
     and recipient_team_id <> pg_temp.team('K Commish')),
  0,
  'N4 the commissioner accepted no trade for a team he does not manage (accepted_by is him only on the offer to K Commish)');

select * from finish();
rollback;
