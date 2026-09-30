-- ============================================================================
-- 171 — the commissioner's doors on the two draft-room manager verbs that
--       refused him (M6 L.E1.38; F521)
--       (spec §8.4, §8.6.3, §8.7, §10.3, §12.12; tasks-M6 TD9, TD16;
--        PROGRESS D449, D451, D452; standing rules (a), (b), (i))
-- ============================================================================
--
-- THE DEFECT (F521, measured by pgTAP 118 T8 / T9). Two manager acts in the
-- draft room could not be done by the commissioner for another team:
--   * draft_place_bid took no team — a bid was always the caller's own seat
--     (league_members.team_id), so in a live auction he could not bid for an
--     absent manager's team (draft_force_pick's auction arm only nominates,
--     and refuses while bidding is live);
--   * draft_queue_replace refused him with 42501 "You do not manage this
--     queue." on any team whose teams.owner_id is not his.
-- A manager verb that refuses the commissioner is a defect (standing rule
-- (a)); the rules of a valid bid and a valid queue bind him too (rule (i)).
--
-- THE MECHANISM — ONE door per act: the manager's own verb gains the
-- commissioner's arm (TD16: no second mechanism). Why the verb and not a thin
-- commissioner door: every validity rule of a bid lives in draft_place_bid
-- (the phase, the E2 replay, the nomination identity R330, the status) and in
-- the one validator it calls (the self-raise, the complete roster E27, the
-- $1 increment, the max bid E5, the anti-snipe floor D128); a second door
-- would have to copy the first half and could drift from it. So:
--   * draft_place_bid(…, p_team_id UUID DEFAULT NULL). NULL, or the caller's
--     own seat, is the manager's bid, byte-identical in behaviour (the same
--     checks in the same order, the same messages, no receipt, no post).
--     Another team is a bid FOR that team and requires is_league_commish of
--     the draft's league (42501 by name otherwise) and an active franchise of
--     that league (P0002 by name); the bid then runs through every check
--     above and the one validator with THAT team — its budget, its roster,
--     its max bid. A mock has no commissioner (§8.8): naming any seat but the
--     launcher's is refused (P0001) and nothing is written. The new argument
--     is a DROP + CREATE (a defaulted parameter added by CREATE OR REPLACE
--     would be a second overload, and every 3–5 argument call would become
--     ambiguous); the ACL is restated exactly as it stood (authenticated and
--     service_role EXECUTE; PUBLIC and anon none — pgTAP 119 A-cells).
--   * draft_queue_replace — p_team_id already exists. A commissioner (or
--     co-commissioner) may replace the queue of any active franchise of a
--     REAL draft's league that is not his own seat. The receipt seam is
--     REVOKEd from clients, so the function becomes SECURITY DEFINER; its
--     in-body guard (082) already re-derived 065's two policy arms exactly
--     (stricter by the league-consistency conjunct, 031), so a manager and a
--     mock launcher are admitted precisely as before, and the guard is now
--     the whole auth law for this door (065's policies still govern every
--     direct table read and write). The same shape rules run first for him.
--
-- WHOSE TEAM IS "HIS OWN". The seat he manages: league_members.user_id =
-- him on that team (set_team_autodraft's v_is_self, 168; D451's "seated
-- member", R1334). On his own seat the verbs are his manager act and write
-- no receipt (the set_lineup / set_team_autodraft arm precedent — an arm
-- writes none for the manager's own team, a twin writes NULL). So every
-- receipt these two verbs write carries acting_as_team_id = the team. A team
-- whose teams.owner_id is his but whose seat is not (a placeholder or a
-- vacated franchise — 150 / 169 stamp the acting commissioner as owner) was
-- already admitted by the queue's owner arm and wrote nothing; it is now a
-- commissioner act for that team and writes its receipt.
--
-- WHAT A RECEIPT SAYS (D336 through the draft seam, D449 — one row per real
-- change, none for a no-op, none for a mock; the reason is NULL: neither verb
-- takes one, Q66 makes it optional). And the room's post (§10.3 — override
-- messages cannot be disabled), on the commissioner arm only:
--   * draft_bid (target draft): before / after = the live nomination
--     {player_id, high_bid, high_bidder_team_id} — a bid that lands always
--     moves the high bid, so it is always a change; metadata {draft_id,
--     nomination_seq, bid_id, for_team_id, affected_team_ids}. A replay of
--     the same action_id returns before the arm and writes none. Nothing
--     private: an auction bid is open (draft_bids is member-readable, 083).
--     Post: "Bid of $N on <player> placed by commissioner <name> for <team>."
--   * draft_set_queue (target team): the log is member-readable, so the
--     receipt NEVER carries the queue (TD9): before {targets: n}, after
--     {targets: n, added, removed, reordered}. The no-op — the same players in
--     the same order — is detected by value (the stored queue read under the
--     seat lock against the new one) and writes nothing, posts nothing.
--     Post: "Targets for <team> updated by commissioner <name>."
-- VOCABULARY (§12.12's comment, extended in the spec in this PR, v2.16.82):
-- draft_bid | draft_set_queue.
--
-- D137 — each body is derived from its NEWEST definer's FILE TEXT (measured
-- by grep over 001–170: no later migration defines either) by an exact-match
-- script (derive_171.py — every substitution asserted to hit once, the
-- reversal asserted to reproduce the source byte for byte, on the block and
-- on prosrc; pgTAP 119's pg_temp.un171 is the same reversal in the database).
-- The source prosrc md5s equal the live ones on the 170 chain (measured):
--   draft_place_bid      095:2892-3078  prosrc md5 21900792… → 7e95f5ec…  6 hunks (+79 / -2)
--                        (the header hunk adds p_team_id; prosrc: 5 hunks, +77 / -1 —
--                         the one removed line is `RETURN public.draft_place_bid_internal(`
--                         → `v_result := …`, D449's draft_pause shape)
--   draft_queue_replace  082:64-172     prosrc md5 c844590b… → d219e899…  5 hunks (+81 / -2)
--                        (the header hunk is INVOKER → DEFINER; prosrc: 4 hunks, +80 / -1 —
--                         the one changed line is the guard's `IF NOT (` → `IF NOT v_commish AND NOT (`)
-- draft_place_bid_internal (092:1982, the one validator the tick's CPU arm
-- shares) is NOT touched. Older suites re-cut because they pin what changed,
-- each NAMED in the PR: 031 A2 (prosecdef false → true) and 031 E "the
-- commissioner is NOT special here" (now: the commissioner's arm lands);
-- 034 section A (has_function + the anon / authenticated EXECUTE pins) and
-- 038 section A (the ACL pin) — the signature they name gains p_team_id;
-- 118 C4 / M0 / M1 / T1 / T8 / T9 (the census gains the two verbs as
-- receipt writers, the matrix gains their rows, T8 / T9 flip from the
-- defect to the doors). 038's call-form pin (the validator called exactly
-- once) and its no-draft_bids-INSERT pin hold unchanged.
--
-- HELD LOCK (§8.3 "< 50 ms"). The commissioner arm adds one indexed team
-- read, one chat INSERT and one receipt INSERT inside the draft-row lock;
-- the manager path adds nothing but a NULL test. pgTAP 119 re-measures
-- draft_place_bid on both paths (min RTT of three, the 060 K shape). The
-- queue verb holds no draft-row lock (its per-seat advisory lock is
-- unchanged). Realtime: unchanged — the bid's draft_bids INSERT and drafts
-- UPDATE are the ones every bid makes; queues never broadcast (§9.2).
--
-- DEPLOY BEFORE PUSH (TD15). No route, hook, page or type the app reads
-- changes shape: the manager's calls send the five named arguments they
-- always sent (PostgREST resolves them to the 5-argument function at 170 and
-- to this one, with p_team_id defaulted, at 171), and no app path sends
-- p_team_id yet — the commissioner's "acting as" controls in the room are
-- F524. Merged code behaves identically at 170 and 171.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Replaced: draft_place_bid (DROP + CREATE — one new defaulted argument;
--   SECURITY DEFINER, search_path '' unchanged; ACL restated) and
--   draft_queue_replace (CREATE OR REPLACE — INVOKER → DEFINER, search_path
--   '' unchanged, ACL kept and the REVOKEs restated). No table, column,
--   index, policy, trigger or cron row. Time: now() only through the existing
--   bodies. Typegen: draft_place_bid's Args gain p_team_id (optional).
--   Realtime: none new (commissioner_actions stays re-waived, §12.14 / F42).
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–171 and the full pgTAP run in the PR. D38 — no backfill:
--   no commissioner bid or queue edit existed before 171.
-- Rollback = DROP draft_place_bid(UUID, INTEGER, UUID, INTEGER, TEXT, UUID),
-- re-apply 095:2892-3078 and 082:64-172 verbatim with their grants.
--
-- Proof: pgTAP 119 (form + D137 in the database; per verb: the commissioner
-- for another team ⇒ one receipt acting for it + one post, the no-op / replay
-- ⇒ none, a mock ⇒ refused / none, a manager naming another team ⇒ 42501
-- with nothing written, the manager's own bid / queue ⇒ no receipt and the
-- same result; validity binding him — the self-raise, the complete roster,
-- the increment, the max bid, the stale nomination, the paused draft, the
-- anti-snipe floor, the queue's shape rules; the held-lock re-measure) and
-- pgTAP 118's census / matrix / manager-verb census. Break probes shown red
-- then reverted in the PR.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_place_bid — 095:2892-3078's FILE TEXT (D137), 6 hunks (+79 / -2).
--    DROP + CREATE: the new trailing argument (see the banner).
-- ---------------------------------------------------------------------------
DROP FUNCTION draft_place_bid(UUID, INTEGER, UUID, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION draft_place_bid(
  p_draft_id UUID,
  p_amount INTEGER,
  p_action_id UUID,
  p_nomination_seq INTEGER DEFAULT NULL,
  p_player_id TEXT DEFAULT NULL,
  p_team_id UUID DEFAULT NULL   -- 171/L.E1.38 (F521): the team to bid FOR; only a commissioner may name another team
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_bid           public.draft_bids;
  v_my_team       UUID;
  v_on_clock_name TEXT;
  v_high_bid      INTEGER;
  v_player_id     TEXT;
  v_live_name     TEXT;
  v_stale_name    TEXT;
  v_acting        BOOLEAN := FALSE;  -- 171: the commissioner bids for a team he does not manage
  v_team_name     TEXT;
  v_before        JSONB;
  v_result        JSONB;
BEGIN
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'draft_place_bid: amount is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'draft_place_bid: action_id is required — client bids are idempotent (§8.1/E2)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK — the serializer for the hottest path in the app (§22.1's
  -- burst row; D136: no route-layer limiter in M3, the lock is the
  -- answer).
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE.
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id)) THEN
    RAISE EXCEPTION 'draft_place_bid: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.draft_league_alive(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_place_bid: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E2 replay short-circuit (identical mechanism to draft_nominate's —
  -- banner item 3): the double-tapped bid returns its own row, never a
  -- second raise. This is THE reason a flaky network cannot bid twice.
  SELECT b.* INTO v_bid
  FROM public.draft_bids b
  WHERE b.draft_id = p_draft_id AND b.action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
  END IF;

  -- THE D103(2) MOCK BRANCH (089/L.C1.7 — F61 DISCHARGED: 085's seam
  -- refusal, built to flip the day 071's create refusal lifted): on a mock
  -- the ONLY legal human bidder is the launcher (config.mock.launched_by,
  -- TEXT-compared — R117); every other member — the human seat's REAL
  -- manager, the commissioner — is refused (D138 extends D103(2) to bids:
  -- nobody bids inside another member's solo practice). CPU seats bid
  -- through the tick (ARM 2.6(c), D132), never through this RPC. A
  -- config-less mock (launched_by NULL) stays tick-only (D110(9)).
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_place_bid: this mock draft is another member''s solo practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_place_bid: this is a % draft — only auction drafts take bids (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'scheduled' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft has not started yet'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'paused' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft is paused'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;

  -- PHASE (D126): no live nomination ⇒ nothing to bid on.
  IF v_draft.current_nomination IS NULL THEN
    SELECT t.name INTO v_on_clock_name
    FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;
    RAISE EXCEPTION
      'draft_place_bid: no player is up for bid right now — % is on the clock to nominate (§8.6.2)',
      COALESCE(v_on_clock_name, 'another team')
      USING ERRCODE = 'P0001';
  END IF;

  v_player_id := v_draft.current_nomination->>'player_id';
  v_high_bid  := COALESCE((v_draft.current_nomination->>'high_bid')::int, 0);

  -- NOMINATION IDENTITY (R330) — OPTIONAL arguments, and the reason they
  -- exist: a bid names an AMOUNT and nothing else, so without them a bid in
  -- flight across a nomination boundary is applied to whatever player is
  -- live when it EXECUTES, and a manager can become high bidder on a player
  -- they never saw. The insert below takes `player_id` from
  -- `current_nomination` and `nomination_seq` from `current_pick_number`,
  -- both read fresh under the lock — the RPC cannot otherwise know what the
  -- caller was looking at, and E2 does not help (a first-time submit carries
  -- a fresh action_id). This is the server-authoritative boundary, so the
  -- guard lives HERE rather than in a route: the sim, the tests and every
  -- future caller are covered, not only HTTP ones.
  --   * BOTH arguments are checked, and neither subsumes the other:
  --     `p_player_id` catches the ordinary case (the nomination moved on to
  --     a different player), and `p_nomination_seq` catches the two cases
  --     where the SAME player is live under a DIFFERENT nomination — D143's
  --     cancel-and-renominate (the sequence number is NOT consumed, so a
  --     re-nomination reuses it with a possibly different player) and an
  --     undone award returning a player to the pool at a later sequence.
  --   * When OMITTED (both NULL) behavior is exactly as shipped — no
  --     existing caller breaks. L.C2.1's route MUST always send them; that
  --     is where the guard becomes mandatory in practice (ledger row F64,
  --     and the read-list line in tasks-M3 §6 L.C2.1).
  --   * Checked the moment the live nomination is known and BEFORE the
  --     franchise/self-raise/raise/max-bid clauses, so a stale bid gets the
  --     TRUE reason (§16.3's "just went off the board" family) instead of
  --     "you are already the high bidder" or "outbid at $N" about a player
  --     the caller never named.
  IF p_player_id IS NOT NULL AND p_player_id IS DISTINCT FROM v_player_id THEN
    SELECT pl.full_name INTO v_stale_name
    FROM public.players pl WHERE pl.id = p_player_id;
    SELECT pl.full_name INTO v_live_name
    FROM public.players pl WHERE pl.id = v_player_id;
    RAISE EXCEPTION
      'draft_place_bid: % just went off the board — % is up for bid now at $% (§16.3)',
      COALESCE(v_stale_name, 'that player'),
      COALESCE(v_live_name, 'another player'),
      v_high_bid
      USING ERRCODE = 'P0001';
  END IF;
  IF p_nomination_seq IS NOT NULL
     AND p_nomination_seq IS DISTINCT FROM v_draft.current_pick_number THEN
    SELECT pl.full_name INTO v_live_name
    FROM public.players pl WHERE pl.id = v_player_id;
    RAISE EXCEPTION
      'draft_place_bid: that nomination just went off the board — % is up for bid now at $% (§16.3)',
      COALESCE(v_live_name, 'another player'),
      v_high_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- The caller's franchise. Bidding has no turn (§8.6.3: ANY manager with
  -- sufficient max bid raises) — but it does require a franchise to bid
  -- FOR: a member without a seat has no budget and no roster. Mock branch
  -- (089 — D103(2)/D138): the launcher — already verified above — bids FOR
  -- the HUMAN seat, whoever owns it; league_members is never consulted
  -- inside a practice room.
  IF v_draft.is_mock THEN
    v_my_team := (v_draft.config->'mock'->>'human_team_id')::uuid;
    -- 171/L.E1.38 (F521): a mock has no commissioner (§8.8) — the launcher
    -- bids only for the seat he practises from, so naming any other team is
    -- refused and nothing is written.
    IF p_team_id IS NOT NULL AND p_team_id IS DISTINCT FROM v_my_team THEN
      RAISE EXCEPTION
        'draft_place_bid: in a practice draft you bid only for your own seat (§8.8)'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT m.team_id INTO v_my_team
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.user_id = auth.uid();
    -- 171/L.E1.38 (F521; standing rule (a); spec §8.7, §10.3) — THE
    -- COMMISSIONER'S DOOR. A named team that is not the caller's own seat is
    -- a bid FOR that team, and only a commissioner or co-commissioner may
    -- make it. He stands outside nothing but "whose team": every check above
    -- (the phase, the nomination identity, the status) has run, and every
    -- validity rule below — the self-raise, the complete roster, the $1
    -- increment, the max bid, the anti-snipe floor — binds him exactly as
    -- it binds the team's manager, because the named team is the one the
    -- one validator reads. The caller's own seat named (or no team named)
    -- is the manager's own bid, unchanged, and writes no receipt.
    IF p_team_id IS NOT NULL AND p_team_id IS DISTINCT FROM v_my_team THEN
      IF NOT public.is_league_commish(v_draft.league_id) THEN
        RAISE EXCEPTION
          'draft_place_bid: only a commissioner can bid for another team (§8.7)'
          USING ERRCODE = '42501';
      END IF;
      SELECT t.name INTO v_team_name
      FROM public.teams t
      WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
        AND t.status <> 'retired';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'draft_place_bid: team % is not an active franchise of this league', p_team_id
          USING ERRCODE = 'P0002';
      END IF;
      v_my_team := p_team_id;
      v_acting  := TRUE;
      v_before  := jsonb_build_object(
                     'player_id', v_player_id,
                     'high_bid', v_high_bid,
                     'high_bidder_team_id', v_draft.current_nomination->>'high_bidder_team_id');
    END IF;
    IF v_my_team IS NULL THEN
      RAISE EXCEPTION
        'draft_place_bid: you do not manage a franchise in this league — only franchise managers can bid (§8.6.3)'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (3)–(5) THE ONE BID VALIDATOR + WRITER (089 — draft_place_bid_internal,
  -- extracted from this body because the tick's CPU sub-arm is the second
  -- consumer): the self-raise refusal, the ONE-family budget read (E27 /
  -- the integer-raise floor / the E5 max-bid clause), the draft_bids
  -- INSERT and the D128 anti-snipe floor — every refusal message
  -- byte-identical to what this RPC raised before the extraction (the
  -- internal prefixes them with this label; 034 pins them verbatim).
  v_result := public.draft_place_bid_internal(
    p_draft_id, v_my_team, p_amount, p_action_id, 'draft_place_bid');

  -- 171/L.E1.38 (F521) — THE RECEIPT AND THE POST, on the commissioner arm
  -- only (§8.7 "every one writes a commissioner_actions audit entry"; §10.3
  -- the post cannot be disabled). A bid that lands always moves the high
  -- bid, so it is always a real change; a replay returned above and writes
  -- none; a refusal raised inside the validator and wrote nothing. The
  -- after-image is the stored bid row the validator returned.
  IF v_acting THEN
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, auth.uid(),
            'Bid of $' || (v_result->'bid'->>'amount') || ' on '
            || COALESCE((SELECT pl.full_name FROM public.players pl WHERE pl.id = v_player_id), 'the player up for bid')
            || ' placed by commissioner ' || public.draft_actor_name()
            || ' for ' || COALESCE(v_team_name, 'a team') || '.',
            'draft:' || p_draft_id::text, TRUE);
    PERFORM public.draft_commish_receipt_internal(
      v_draft.league_id, v_draft.is_mock, 'draft_place_bid', 'draft_bid', 'draft',
      p_draft_id::text, NULL,
      v_before,
      jsonb_build_object(
        'player_id', v_result->'bid'->>'player_id',
        'high_bid', (v_result->'bid'->>'amount')::int,
        'high_bidder_team_id', v_result->'bid'->>'team_id'),
      jsonb_build_object(
        'draft_id', p_draft_id,
        'nomination_seq', (v_result->'bid'->>'nomination_seq')::int,
        'bid_id', v_result->'bid'->>'id',
        'for_team_id', p_team_id,
        'affected_team_ids', jsonb_build_array(p_team_id)),
      p_team_id);  -- acting_as: the team he bid for (§10.3, D451)
  END IF;

  RETURN v_result;
END;
$$;

-- §4.1 posture restated after the replace (the ACL as it stood on 170:
-- postgres, authenticated, service_role EXECUTE; PUBLIC and anon none).
REVOKE EXECUTE ON FUNCTION draft_place_bid(UUID, INTEGER, UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION draft_place_bid(UUID, INTEGER, UUID, INTEGER, TEXT, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. draft_queue_replace — 082:64-172's FILE TEXT (D137), 5 hunks (+81 / -2).
--    INVOKER → DEFINER (see the banner); signature unchanged, ACL kept.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_queue_replace(
  p_draft_id UUID,
  p_team_id UUID,
  p_players TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER   -- 171/L.E1.38: was INVOKER — the guard below is now the whole auth law (the receipt seam is not a client's to call)
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
  v_result JSONB;
  v_draft     public.drafts;       -- 171
  v_commish   BOOLEAN := FALSE;    -- 171: the commissioner edits a team he does not manage
  v_old       TEXT[];              -- 171: the queue before, for the no-op test (never recorded)
  v_team_name TEXT;                -- 171
BEGIN
  -- Shape (22023 — friendly, surfaced as a 400 by the service).
  IF p_draft_id IS NULL OR p_team_id IS NULL OR p_players IS NULL THEN
    RAISE EXCEPTION 'draft_id, team_id and players are required.'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(array_length(p_players, 1), 0) > 500 THEN
    RAISE EXCEPTION 'A queue can hold at most 500 players.'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT COUNT(*) FROM unnest(p_players) AS p(id))
     <> (SELECT COUNT(DISTINCT id) FROM unnest(p_players) AS p(id)) THEN
    RAISE EXCEPTION 'A player can appear in the queue only once.'
      USING ERRCODE = '22023';
  END IF;

  -- Auth guard — the SAME two admit arms as 065's "Own queue write" policy
  -- (real-draft owner with the F51 NOT is_mock exclusion, OR the D103(3)
  -- mock launcher writing the human seat). 42501 keeps the no-leak
  -- convention: forged seat, wrong draft, and nonexistent ids all answer
  -- identically. The RLS policies remain the backstop on the actual
  -- DELETE/INSERT below (SECURITY INVOKER).
  --
  -- 171/L.E1.38 (F521; standing rule (a); spec §8.4, §8.7, §10.3) — THE
  -- COMMISSIONER'S ARM, and the posture it forces. A commissioner or
  -- co-commissioner may replace the queue of any active franchise of the
  -- draft's league that is not his own seat — the act §8.4 gives its
  -- manager, done for the team (an absent manager's Targets are what his
  -- timeouts draft from). A real draft only: a mock has no commissioner
  -- (§8.8), so its one admit stays the launcher's. The arm writes a receipt
  -- and a room post, and the receipt seam is not a client's to call, so the
  -- function now runs SECURITY DEFINER: THIS guard is the whole auth law.
  -- The two arms below are 065's two policies re-derived exactly (the owner
  -- arm here is stricter — the league-consistency conjunct, 031), so a
  -- manager or a mock launcher is admitted precisely as before, and the
  -- comments below that say "invoker" / "RLS-checked" describe the pre-171
  -- posture; 065's policies still govern every direct table read and write.
  -- Validity is unchanged for him: the same shape rules (500 players, no
  -- duplicate, known ids) run before anything is touched.
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  v_commish := COALESCE(
    v_draft.id IS NOT NULL
    AND NOT v_draft.is_mock
    AND public.is_league_commish(v_draft.league_id)
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
        AND t.status <> 'retired'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.league_members m
      WHERE m.league_id = v_draft.league_id AND m.user_id = v_uid
        AND m.team_id = p_team_id
    ), FALSE);
  IF NOT v_commish AND NOT (
    EXISTS (
      SELECT 1
      FROM public.teams t
      JOIN public.drafts d ON d.id = p_draft_id
      WHERE t.id = p_team_id
        AND t.league_id = d.league_id
        AND t.owner_id = v_uid
        AND NOT d.is_mock
    )
    OR EXISTS (
      SELECT 1
      FROM public.drafts d
      WHERE d.id = p_draft_id
        AND d.is_mock
        AND d.config->'mock'->>'launched_by' = v_uid::text
        AND d.config->'mock'->>'human_team_id' = p_team_id::text
    )
  ) THEN
    RAISE EXCEPTION 'You do not manage this queue.' USING ERRCODE = '42501';
  END IF;

  -- Per-seat serialization (the concurrency face): concurrent replaces for
  -- the SAME (draft, team) queue take this xact-scoped advisory lock in
  -- turn — the second waits for the first's COMMIT, then sees its rows and
  -- replaces them. Different seats never contend. Taken only AFTER the auth
  -- guard: only a seat's own manager (or mock launcher) can ever hold that
  -- seat's lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('draft_queue_replace:' || p_draft_id::text || ':' || p_team_id::text, 0)
  );

  -- Unknown ids are a friendly 22023 BEFORE the destructive replace (the
  -- players FK would abort the txn anyway — this just names the ids; queue
  -- rows are advisory, so already-DRAFTED players stay legal, §8.4).
  IF COALESCE(array_length(p_players, 1), 0) > 0 THEN
    SELECT COUNT(*) INTO v_count
    FROM unnest(p_players) AS wanted(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.players pl WHERE pl.id = wanted.id);
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Unknown player id(s): %',
        (SELECT string_agg(wanted.id, ', ')
         FROM unnest(p_players) AS wanted(id)
         WHERE NOT EXISTS (SELECT 1 FROM public.players pl WHERE pl.id = wanted.id))
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The replace — ONE transaction, RLS-checked row by row (invoker):
  -- a failure anywhere rolls back the delete (the partial-failure face).
  -- 171: the commissioner arm reads the queue it replaces, under the seat
  -- lock, to tell a real change from the same queue again (D336 part 3).
  IF v_commish THEN
    SELECT COALESCE(array_agg(q.player_id ORDER BY q.rank, q.id), '{}'::text[])
    INTO v_old
    FROM public.draft_queues q
    WHERE q.draft_id = p_draft_id AND q.team_id = p_team_id;
  END IF;

  DELETE FROM public.draft_queues
  WHERE draft_id = p_draft_id AND team_id = p_team_id;

  IF COALESCE(array_length(p_players, 1), 0) > 0 THEN
    INSERT INTO public.draft_queues (draft_id, team_id, player_id, rank)
    SELECT p_draft_id, p_team_id, p.id, p.ord
    FROM unnest(p_players) WITH ORDINALITY AS p(id, ord);
  END IF;

  -- THIS call's outcome (not a later writer's): the response truth the
  -- service returns.
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('player_id', q.player_id, 'rank', q.rank)
              ORDER BY q.rank),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.draft_queues q
  WHERE q.draft_id = p_draft_id AND q.team_id = p_team_id;

  -- 171/L.E1.38 (F521) — THE RECEIPT AND THE POST, on the commissioner arm
  -- only, and only when the queue changed (the same players in the same
  -- order is a no-op: nothing posted, nothing receipted — standing rule
  -- (b)). The log is member-readable, so a receipt NEVER carries the queue
  -- (TD9): only how many Targets there were and are, how many were added
  -- and removed, and whether the kept ones were re-ordered.
  IF v_commish AND v_old IS DISTINCT FROM p_players THEN
    SELECT t.name INTO v_team_name FROM public.teams t WHERE t.id = p_team_id;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, v_uid,
            'Targets for ' || COALESCE(v_team_name, 'a team') || ' updated by commissioner '
            || public.draft_actor_name() || '.',
            'draft:' || p_draft_id::text, TRUE);
    PERFORM public.draft_commish_receipt_internal(
      v_draft.league_id, v_draft.is_mock, 'draft_queue_replace', 'draft_set_queue', 'team',
      p_team_id::text, NULL,
      jsonb_build_object('targets', COALESCE(array_length(v_old, 1), 0)),
      jsonb_build_object(
        'targets', COALESCE(array_length(p_players, 1), 0),
        'added', (SELECT count(*)::int FROM unnest(p_players) AS n(id) WHERE NOT (n.id = ANY (v_old))),
        'removed', (SELECT count(*)::int FROM unnest(v_old) AS o(id) WHERE NOT (o.id = ANY (p_players))),
        'reordered',
          (SELECT COALESCE(array_agg(n.id ORDER BY n.ord), '{}'::text[])
           FROM unnest(p_players) WITH ORDINALITY AS n(id, ord) WHERE n.id = ANY (v_old))
          IS DISTINCT FROM
          (SELECT COALESCE(array_agg(o.id ORDER BY o.ord), '{}'::text[])
           FROM unnest(v_old) WITH ORDINALITY AS o(id, ord) WHERE o.id = ANY (p_players))),
      jsonb_build_object(
        'draft_id', p_draft_id,
        'team_name', v_team_name,
        'affected_team_ids', jsonb_build_array(p_team_id)),
      p_team_id);  -- acting_as: the team whose Targets he set (§10.3, D451)
  END IF;

  RETURN v_result;
END;
$$;

-- The 082 grants restated (CREATE OR REPLACE kept the ACL: authenticated and
-- service_role EXECUTE; PUBLIC and anon none).
REVOKE ALL ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) TO service_role;
