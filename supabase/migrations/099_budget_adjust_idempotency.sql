-- ============================================================================
-- 099 — `draft_adjust_budget` joins the E2 contract
--       (AP task AP.6; ledger F82; spec v2.16.4 E69, §8.1's idempotency
--       bullet, §8.7's budget row; D203. Erratum v2.16.5 rides this PR:
--       §12.26 records the spec-absent store, the D102/v2.10.2 precedent.)
-- ============================================================================
--
-- WHAT THIS FIXES (F82, R438's engine residual). `draft_adjust_budget` is the
-- one §8.7 money verb whose write is CUMULATIVE (`v_after := v_before +
-- p_delta`) and which carried no dedupe key — the other three self-guard on
-- replay (a second `reverse-bid` meets "pick % is not a live pick", a second
-- `cancel-nomination` meets "no player is nominated right now", a second
-- `end` meets "already complete"). So the same POST twice — a double-click, a
-- React Query retry, a proxy replaying a request whose response was lost —
-- moved twice the money, and no client guard can close that (the L.C3.2
-- guard is mount-scoped and a lost response has no client-side answer at
-- all). E69 (spec v2.13 fold) rules the fix: E2's mechanism, the pick path's
-- select-then-insert under the draft-row lock, and **the replay returns the
-- ORIGINAL result** (D203 — a retry that reported a different
-- `adjustment_after` than the first call would be a second lie on top of the
-- first).
--
-- THE STORE. E2's replay needs a per-action record to look up, and the
-- adjustment had none — `drafts.budget_adjustments` is one cumulative number
-- per team (D127) and the D97 chat post is prose. So this migration adds
-- `draft_budget_adjustments`: one row per LANDED edit, carrying the original
-- return payload verbatim, deduped by a partial unique in the
-- `uniq_draft_bid_action` pattern (083/C39 — NULL action_id rows coexist
-- freely; the partial unique still dedupes every stamped retry). The
-- cumulative map on `drafts` stays THE stored input the D127 derivation
-- family reads — this table is never read by any budget arithmetic, only by
-- the replay lookup. **An `action_id` is an idempotency key, NOT an audit
-- record** — `commissioner_actions` is still M6 (F32/F40), and every AP verb
-- that accepts a `reason` still validates it and stores it nowhere.
--
-- ONE FUNCTION MOVES, authored against its chain HEAD's file text (D137 /
-- CLAUDE.md), re-derived at task time with
-- `grep -n "FUNCTION draft_adjust_budget(" supabase/migrations/*.sql`:
--
--   * `draft_adjust_budget` — head **092:676-848** (087:650-818 was its only
--     prior definition; 092 replaced it whole for AP.1's reserve read; 093-098
--     mention it in comments only). **DROP + CREATE**, because CREATE OR
--     REPLACE cannot add a parameter and a defaulted overload BESIDE the old
--     signature is the ambiguity trap 087 hit twice and 098 named (D201(2)
--     precedent). `p_action_id` is LAST and `DEFAULT NULL`, so any 3- or
--     4-argument call text binds to NULL — the pre-099 behaviour exactly
--     (pgTAP 036 §F's positional calls pass untouched); NULL skips the
--     replay and simply records an un-deduped row. FOUR hunks against 092's
--     text: (1) the signature + its comment, (2) the DECLARE gains
--     `v_result`, (3) the E2 replay short-circuit after the auth gate and
--     BEFORE the status checks (066:915's placement — a replay answers its
--     original even if the draft has since paused or completed), (4) the
--     RETURN is built into `v_result`, the store row is inserted, and
--     `v_result` is returned. E28's three arms, the D138 mock refusal, the
--     D97 chat post and the write-first-then-re-derive shape are 092's text
--     byte-for-byte.
--
-- **Behaviour on every existing path:** an unstamped call (pgTAP's positional
-- calls, psql) composes cumulatively exactly as before — the only new
-- observable is one record row per landed edit. The ONLY behaviour change is
-- that a STAMPED retry now returns its original payload and moves nothing.
--
-- **§4.1 posture:** SECURITY DEFINER + in-body auth (is_league_commish) +
-- `search_path = ''`; REVOKE re-emitted for the new signature (PUBLIC/anon
-- out, authenticated keeps EXECUTE — in-body auth is the gate, 036 §A's
-- pins move to the 5-arg signature in this PR). The new table: RLS enabled,
-- SELECT for league members (the 083 `draft_bids` pattern — league_id stored
-- for the simple policy), NO write policy for any role — rows are appended
-- only by this DEFINER verb (§8.1). No standalone-mock arm in the policy:
-- `draft_adjust_budget` refuses every mock by name (D138) before any write,
-- so no mock row can exist here.
--
-- Proof: pgTAP 047 (the replay pins — same action twice ⇒ ONE movement and
-- the byte-identical ORIGINAL payload, even after the draft moved on; a
-- different action composes; NULL composes as today; the store's posture and
-- partial-unique arbiter; the signature is ONE function), 036 §A's grant
-- pins moved to the new signature, and the route/hook stamping in the same
-- PR (D68 pattern). Break probe (shown RED in the PR, then reverted): the
-- replay lookup removed from the installed body ⇒ 047's replay pins fail.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_budget_adjustments — the E69 store: one row per landed edit,
--    the original return payload verbatim, deduped by the C39-pattern
--    partial unique. Read ONLY by the replay lookup — budgets stay derived
--    from drafts.budget_adjustments through the ONE family (D127).
-- ---------------------------------------------------------------------------

CREATE TABLE draft_budget_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,  -- stored for a simple RLS policy (083 pattern); NOT NULL: mocks are refused before any write (D138), so only real-league rows exist
  team_id UUID REFERENCES teams(id) NOT NULL,
  delta INTEGER NOT NULL,
  adjustment_after INTEGER NOT NULL,               -- the cumulative total this edit left behind (v_after)
  result JSONB NOT NULL,                           -- the ORIGINAL return payload, replayed verbatim (E69/D203)
  action_id UUID,                                  -- client-minted; dedupes retries; NULL for unstamped callers (C39)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT draft_budget_adjustments_delta_check
    CHECK (delta <> 0)                             -- the RPC's own 22023 refusal, mirrored at the store (R43 lesson: CHECKs at creation)
);

ALTER TABLE draft_budget_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Budget adjustment records viewable by league members"
  ON draft_budget_adjustments FOR SELECT USING (is_league_member(league_id));
-- No client write policy: rows are appended only by draft_adjust_budget —
-- a SECURITY DEFINER RPC (§8.1). No UPDATE/DELETE policy for anyone: the
-- record of a landed edit is append-only, like bid history (D131(2)).

-- E2 idempotency for stamped edits; unstamped rows carry NULL and coexist
-- freely (C39 — the 065 uniq_draft_action / 083 uniq_draft_bid_action
-- pattern). NOTE (R310): a bare ON CONFLICT (draft_id, action_id) arbiter
-- cannot match this PARTIAL index (42P10 at runtime) — the RPC uses the
-- select-then-insert replay lookup under the draft lock (066:917's form),
-- with this index as the race backstop.
CREATE UNIQUE INDEX uniq_draft_budget_adjust_action
  ON draft_budget_adjustments(draft_id, action_id) WHERE action_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. draft_adjust_budget — DROP + CREATE (the D201(2) signature trap):
--    + p_action_id (LAST, DEFAULT NULL); the E2 replay short-circuit; the
--    store insert. REPLACED FROM 092:676-848 (D137 head rule); E28's arms,
--    the D138 mock refusal and the D97 post are 092's text verbatim.
-- ---------------------------------------------------------------------------

DROP FUNCTION draft_adjust_budget(UUID, UUID, INTEGER, TEXT);

CREATE FUNCTION draft_adjust_budget(
  p_draft_id  UUID,
  p_team_id   UUID,
  p_delta     INTEGER,
  p_reason    TEXT DEFAULT NULL,
  p_action_id UUID DEFAULT NULL   -- 099/AP.6 (E69): client-minted dedupe key; NULL = unstamped caller, composes as before
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_team_name  TEXT;
  v_reserve    INTEGER;
  v_before     INTEGER;
  v_after      INTEGER;
  v_remaining  INTEGER;
  v_open       INTEGER;
  v_max_bid    INTEGER;
  v_committed  INTEGER;
  v_result     JSONB;            -- 099/AP.6: the return payload, built once, stored verbatim
BEGIN
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'draft_adjust_budget: team_id is required'
      USING ERRCODE = '22023';
  END IF;
  -- A zero delta is refused rather than treated as a D63-class no-op: the
  -- D63 convention is for a REPEATED command (double-tapped Pause), and a
  -- commissioner who typed 0 made a mistake we should not post about.
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION
      'draft_adjust_budget: delta must be a non-zero integer — say how many dollars to add or remove'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_adjust_budget: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  -- 099/AP.6 — E69/E2 replay short-circuit, after the auth gate and BEFORE
  -- the status checks (066:915's placement): a retried adjustment is a
  -- no-op returning its ORIGINAL stored payload (D203 — a retry that
  -- reported a different adjustment_after than the first call would be a
  -- second lie on top of the first), even if the draft has since paused,
  -- completed or moved on. The draft-row lock above serializes the normal
  -- path; uniq_draft_budget_adjust_action is the race backstop (R310: a
  -- bare ON CONFLICT arbiter cannot match a partial index — this is the
  -- select-then-insert form on purpose).
  IF p_action_id IS NOT NULL THEN
    SELECT a.result INTO v_result
    FROM public.draft_budget_adjustments a
    WHERE a.draft_id = p_draft_id AND a.action_id = p_action_id;
    IF FOUND THEN
      RETURN v_result;
    END IF;
  END IF;

  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_adjust_budget: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_adjust_budget: this is a % draft — budgets apply to auctions only (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_adjust_budget: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_adjust_budget: the draft has not started yet — set the budget in League settings'
      USING ERRCODE = 'P0001';
  END IF;
  -- NOT pause-gated: D141's ruling names undo, Manual Edit Mode, current-
  -- nomination edits and timer edits. Budget adjust is deliberately absent
  -- from that list (banner item 4), and E28's arms below are what make it
  -- safe to run live.

  SELECT t.name INTO v_team_name
  FROM public.teams t
  WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
    AND t.status <> 'retired';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_adjust_budget: team % is not an active franchise of this league', p_team_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 092/AP.1: the reserve, through the ONE authority (D198(1)).
  v_reserve := public.draft_auction_reserve(v_draft.config);
  v_before  := COALESCE((v_draft.budget_adjustments->>p_team_id::text)::int, 0);
  v_after   := v_before + p_delta;   -- CUMULATIVE: successive corrections compose.

  -- (3) WRITE FIRST, THEN RE-DERIVE. The ONE family (D127/§4.7) reads
  -- budget_adjustments, so the only way to validate the POST-edit world
  -- without re-implementing the arithmetic is to make the edit and ask.
  -- Every refusal below RAISEs, which rolls this write back inside the
  -- caller's transaction — the 084 start-backstop pattern (assert AFTER the
  -- transition write), and the reason no compensating math exists here.
  UPDATE public.drafts SET
    budget_adjustments = jsonb_set(budget_adjustments,
                                   ARRAY[p_team_id::text], to_jsonb(v_after), TRUE),
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  SELECT b.remaining, b.open_slots, b.max_bid, b.committed
    INTO v_remaining, v_open, v_max_bid, v_committed
  FROM public.draft_team_budget(p_draft_id, p_team_id) b;

  -- E28 ARM 1 — below committed spend. Strictly a special case of arm 2, and
  -- kept separate ON PURPOSE: it is the arm with a different remedy, and a
  -- commissioner told "you are $12 under the solvency floor" when the real
  -- problem is that they cut a team below what it has already SPENT will fix
  -- the wrong thing.
  IF v_remaining < 0 THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that leaves % $% short of the $% already spent — reverse a won bid instead, or make the adjustment smaller (E28)',
      v_team_name, -v_remaining, v_committed
      USING ERRCODE = 'P0001';
  END IF;

  -- E28 ARM 2 — below the §8.6.8 solvency floor. open_slots * reserve is the
  -- money the team must still be able to spend to finish a legal roster.
  IF v_remaining < v_open * v_reserve THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that leaves % with $% for % open roster spots at a $% per-slot reserve — §8.6.8 needs at least $%; reverse a won bid to free a spot, or make the adjustment smaller (E28)',
      v_team_name, v_remaining, v_open, v_reserve, v_open * v_reserve
      USING ERRCODE = 'P0001';
  END IF;

  -- E28 ARM 3 (D131(4)) — insolvent against the LIVE high bid. A bid holds no
  -- money (D131(2)); the AWARD spends it. So an edit that is fine right now
  -- can still make the close unaffordable, and the close is a tick away.
  -- Same algebra as the award: price <= max_bid.
  --
  -- 087/R367: the comparison MOVED into draft_auction_high_bid_gate_internal
  -- (section 3b) because the two priced Manual Edit paths need the identical
  -- arm and had shipped without it. The rendered message is BYTE-IDENTICAL to
  -- the inline version this replaced — 036 §F's exact-message pins are
  -- unchanged, which is the check that the move was lossless.
  PERFORM public.draft_auction_high_bid_gate_internal(
    v_draft, p_team_id, 'draft_adjust_budget',
    'Void the nomination (pause, then Edit current nomination) or reverse a won bid first');

  -- Cross-team backstop (§4 rule 7): the arms above check the EDITED team;
  -- this proves the edit did not disturb anyone else's floor. It cannot fire
  -- today — budget_adjustments is per team and no other team's derivation
  -- reads this key — so it is a guard against a future edit to the family,
  -- not a live branch. Stated plainly rather than left to look like coverage.
  IF NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that adjustment left auction % insolvent (§8.6.8) — refusing',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97: the in-txn post, with the before/after numbers the task asks for.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Budget adjusted by ' || public.draft_actor_name() || ': '
          || v_team_name || ' '
          || CASE WHEN p_delta > 0 THEN '+$' || p_delta ELSE '-$' || (-p_delta) END
          || ' (total adjustment '
          || CASE WHEN v_after >= 0 THEN '+$' || v_after ELSE '-$' || (-v_after) END
          || '; now $' || v_remaining || ' remaining for ' || v_open
          || ' open spots, max bid $' || v_max_bid || ').',
          'draft:' || p_draft_id::text, TRUE);

  v_result := jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'team_id', p_team_id,
    'adjustment_before', v_before,
    'adjustment_after', v_after,
    'remaining', v_remaining,
    'open_slots', v_open,
    'max_bid', v_max_bid);

  -- 099/AP.6 (E69): the adjustment's own record — one row per landed edit,
  -- carrying the ORIGINAL return payload verbatim so a replay answers
  -- byte-identically. NULL action_id rows (unstamped callers) are recorded
  -- too and simply have no dedupe key — the C39 shape.
  INSERT INTO public.draft_budget_adjustments
    (draft_id, league_id, team_id, delta, adjustment_after, action_id, result)
  VALUES
    (p_draft_id, v_draft.league_id, p_team_id, p_delta, v_after, p_action_id, v_result);

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_adjust_budget(UUID, UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon;
