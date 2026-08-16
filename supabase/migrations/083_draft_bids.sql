-- ============================================================================
-- Auction schema opener: draft_bids + drafts.budget_adjustments +
-- draft_dnd_marks — migration 083 (task L.C1.1; spec §12.5, §12.24 (v2.10),
-- §12.3 seam columns, §8.6.8 solvency context, §9.2 broadcast rules;
-- tasks-M3 §2–§4 standing rules, D126/D127/D139, C39).
-- Schema lane opener for M3 (Phase C — auction draft engine).
--
-- NO RPCs in this migration — tables, constraints, indexes, RLS, columns
-- only (the derivation family lands in 084/L.C1.2; draft_nominate /
-- draft_place_bid land in 085/L.C1.3; the draft_bids broadcast trigger
-- lands at 088/L.C1.6 per the tasks-M3 §7 plan — deliberately NOT at
-- creation: no subscriber exists until the auction room, and F42's rule is
-- creation-adjacent within the milestone, the 072-3b precedent honored by
-- the schema lane's own realtime task).
--
--   1. `draft_bids` — §12.5 DDL verbatim with TWO recorded deltas (C39):
--        * action_id is NULLABLE and the printed inline
--          UNIQUE(draft_id, action_id) becomes the partial unique index
--          uniq_draft_bid_action ... WHERE action_id IS NOT NULL — the 065
--          `uniq_draft_action` pattern exactly. WHY (C39, tasks-M3 §9):
--          system rows need NULL — the tick's system-nomination opening
--          bid (D129(2)/D130) has no client action; §12.5's printed
--          NOT NULL would make every system nomination unrecordable while
--          the partial unique still dedupes every client retry (E2).
--          Spec erratum rides this PR (changelog v2.10.2).
--          **ARBITER CONSTRAINT for 085's E2 path (R310) — partial and
--          non-partial ARE behaviorally distinguishable here:** a bare
--          `ON CONFLICT (draft_id, action_id)` does NOT match a PARTIAL
--          index and raises **42P10** at runtime ("no unique or exclusion
--          constraint matching the ON CONFLICT specification"); proven
--          under savepoints on this exact schema. `draft_place_bid` /
--          `draft_nominate` must therefore either repeat the predicate —
--          `ON CONFLICT (draft_id, action_id) WHERE action_id IS NOT NULL`
--          (INSERT 0 1) — or follow the house E2 pattern, which is the
--          select-then-insert replay lookup under the draft lock
--          (066:917), not an upsert. The indexdef golden in pgTAP 032 is
--          what keeps this predicate honest.
--        * the R43-lesson CHECKs at creation (printed semantics become
--          constraints): amount >= 0 (bids are non-negative dollars;
--          $0 is legal when auction_min_bid = 0 — C38) and
--          nomination_seq >= 1 (§12.4's "sequence # (auction)" is 1-based
--          per D126: current_pick_number doubles as the nomination seq).
--      Member SELECT via is_league_member(league_id) — bids are PUBLIC in
--      an open auction (§12.5's printed policy; the §12.6-class privacy
--      question does not arise — tasks-M3 §10's F48 note). NO client write
--      policy: bids are APPEND-ONLY VIA RPC only (draft_place_bid, 085);
--      no UPDATE/DELETE policy for anyone — bid history is immutable
--      (D131(2): undo voids nominations, bids stand as history).
--      idx_draft_bids_nom (draft_id, nomination_seq, amount DESC) per
--      §12.5 — the high-bid-per-nomination read the award path (D130) and
--      the room's bid feed both ride.
--
--   2. `drafts.budget_adjustments` — D127's storage half: commissioner
--      budget edits (§8.7 "Adjust auction budget") need storage while
--      budgets themselves stay DERIVED, never counters:
--        remaining(team) = config auction_budget
--                          + COALESCE((budget_adjustments->>team_id), 0)
--                          − Σ price of non-undone picks   (084's family)
--      Shape: JSONB map team_id → integer delta, NOT NULL DEFAULT '{}'.
--      Additive column with IF NOT EXISTS (plan §8.1). Spec §12.3 does not
--      print this column — the spec-absent-schema erratum rides this PR
--      (D127, the D102 precedent; changelog v2.10.2). Validation is E28's
--      (084+/087) — no CHECK here: the map's legality is solvency-relative,
--      a per-state judgment no static constraint can express (the
--      derivation fns + pgTAP own it, §4.7 solvency doctrine).
--      NOTE: pgTAP 019's exact columns_are pin on drafts is updated in the
--      same PR (tests are edited in place — D137 note).
--
--   3. `draft_dnd_marks` — §12.24 DDL VERBATIM (v2.10; D139): per-user,
--      per-DRAFT Do-Not-Draft labels set from the auction player table.
--      Own-rows FOR ALL policy (USING + WITH CHECK on user_id =
--      auth.uid()) — the `draft_queues` client-write precedent; plan
--      §8.2's allowance via the spec's own printed policy. Unique triple
--      (draft_id, user_id, player_id); idx_draft_dnd_user. NEVER broadcast
--      (§9.2's blind-data rule — private prep, the draft_queues class).
--      DISPLAY-ONLY, RULED (C42/OQ 20, 2026-08-16, offered-and-declined):
--      THE ENGINE NEVER READS THIS TABLE — no RPC, trigger, or worker may
--      join against it; the 068 resolve chain is untouched in this and
--      every M3 migration. The table's whole job is persisting the UI
--      label across sessions/devices.
--      RECORDED residual (the R120 class, record-only): the printed policy
--      validates USER ownership only — a user can insert marks against ANY
--      draft_id (including another league's). Harmless by construction:
--      rows are visible only to their author (own-rows both directions),
--      the engine never reads them (C42), and they are never broadcast —
--      a mark on a foreign draft is self-inflicted clutter, not a leak.
--      Marks survive draft_reset (prep, not draft state — the R302 clear
--      list deliberately excludes them; 087's business).
--
-- Grants doctrine (tasks-M1 §4.1, D18→D23; M3 §4 rule 1): no per-object
-- GRANTs — 037's default ACLs already expose the tables and RLS is the
-- only effective gate; no SECURITY DEFINER routine is created here, so no
-- REVOKE is owed.
--
-- Migration checklist (plan §8.1 / tasks-M3 §4.4): additive-only (two new
-- tables + one new column; no data change, no policy change on existing
-- tables) · IF NOT EXISTS on the column add · indexes cover every FK used
-- in policies/joins that the read paths hit (league_id rides
-- is_league_member's league_members index; draft-scoped reads ride the two
-- new indexes) · broadcast trigger deliberately deferred to 088 (L.C1.6,
-- the tasks-M3 §7 plan — recorded above) · staging rehearsal: R6 waiver —
-- no staging clone exists (environments are local + prod only); the
-- recorded rehearsal evidence is the fresh local `npx supabase db reset`
-- replay of the full 001–083 chain in this task's PR, plus pgTAP 032 in
-- the same PR · typegen re-run with the hand-written alias block
-- re-appended (additive-only diff verified in the PR; DraftBid +
-- DraftDndMark aliases added).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_bids (§12.5 + the C39 action_id delta + the R43-lesson CHECKs)
-- ---------------------------------------------------------------------------

CREATE TABLE draft_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,  -- stored for a simple RLS policy
  nomination_seq INTEGER NOT NULL,                 -- which nomination this bid belongs to
  player_id TEXT REFERENCES players(id) NOT NULL,
  team_id UUID REFERENCES teams(id) NOT NULL,
  amount INTEGER NOT NULL,
  action_id UUID,                                  -- client-generated; dedupes retries (NULL for system rows — C39)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT draft_bids_amount_check
    CHECK (amount >= 0),                           -- non-negative dollars ($0 legal at min_bid 0 — C38)
  CONSTRAINT draft_bids_nomination_seq_check
    CHECK (nomination_seq >= 1)                    -- 1-based nomination sequence (D126)
);

ALTER TABLE draft_bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bids viewable by league members"
  ON draft_bids FOR SELECT USING (is_league_member(league_id));
-- No client write policy: bids are appended only by draft_place_bid /
-- the tick's system rows (085/086) — SECURITY DEFINER RPCs (§8.1).
-- No UPDATE/DELETE policy for anyone: bid history is append-only (D131(2)).

-- E2 idempotency for client bids; system rows carry NULL and coexist
-- freely (C39 — the 065 uniq_draft_action pattern). NOTE (R310): a bare
-- ON CONFLICT (draft_id, action_id) arbiter cannot match this PARTIAL index
-- (42P10 at runtime) — 085 repeats the predicate or uses the select-then-
-- insert replay lookup under the draft lock (066:917). See the banner.
CREATE UNIQUE INDEX uniq_draft_bid_action
  ON draft_bids(draft_id, action_id) WHERE action_id IS NOT NULL;
-- §12.5: high-bid-per-nomination scan (award path D130 + the room's feed):
CREATE INDEX idx_draft_bids_nom ON draft_bids(draft_id, nomination_seq, amount DESC);

-- ---------------------------------------------------------------------------
-- 2. drafts.budget_adjustments (D127 — the commissioner-edit storage half;
--    spec-absent-schema erratum rides this PR, changelog v2.10.2)
-- ---------------------------------------------------------------------------

ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS budget_adjustments JSONB NOT NULL DEFAULT '{}';
-- team_id → integer delta; read ONLY through 084's derivation family
-- (budgets are derived, never stored counters — D127); written ONLY by
-- draft_adjust_budget (087) under E28 validation; cleared by draft_reset
-- (R302, 087); room-visible via the 088 payload extension (D134).

-- ---------------------------------------------------------------------------
-- 3. draft_dnd_marks (§12.24 VERBATIM — v2.10/D139; display-only per C42:
--    the engine NEVER reads this table)
-- ---------------------------------------------------------------------------

CREATE TABLE draft_dnd_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draft_id, user_id, player_id)
);

ALTER TABLE draft_dnd_marks ENABLE ROW LEVEL SECURITY;

-- Own rows only, read and write (the draft_queues client-write precedent — §12.6):
CREATE POLICY "Own DND marks" ON draft_dnd_marks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_draft_dnd_user ON draft_dnd_marks(draft_id, user_id);
-- NEVER broadcast (§9.2 blind-data rule); never joined by any RPC/trigger/
-- worker (C42 — display-only, ruled; skip was offered and declined).
