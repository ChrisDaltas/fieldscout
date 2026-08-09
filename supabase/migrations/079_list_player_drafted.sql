-- ============================================================================
-- list_player_drafted — the ONE schema change in the whole Lists v2 build
-- (delivery-plan-lists-v2.md v3.3 §1/§2.2, design decision **D2**, task
-- **LV.1.2**). Design LAW is docs/design/lists/README.md; D2 is the one
-- deliberate deviation from it (§2.1 — the handoff's GLOBAL drafted flag is
-- overridden; drafted is per user, per list).
--
-- What it is, and the ceiling on it (D2, Chris 2026-08-09): *"marking as
-- drafted should be nothing more than telling the UI to display that player
-- differently in that list."* Row presence IS the state. It does not reorder,
-- filter, cascade to other lists, affect rank, or feed anything downstream.
-- It earns a table for exactly one reason — the marks must follow you between
-- devices mid-draft, because a board that forgets who is gone the moment you
-- pick up your phone is useless on draft night.
--
-- Why `user_id` when a list already has an owner (D2): so that marking
-- drafted on a SAVED list (someone else's, per the handoff's Saved tab)
-- records YOUR marks rather than editing THEIR list. A `drafted` column on
-- `list_players` would be simpler, but two people using the same shared board
-- on draft night would overwrite each other. The extra column is the cheaper
-- bug.
--
-- NO season column (D2). Per-list scoping already separates one draft from
-- the next — a 2026 auction list is a different row set from next year's.
-- Reusing a list next season means clearing it, which is what the manual
-- "Clear drafted" (LV.3.9, served by this migration's DELETE policy) is for.
--
-- Migration checklist (delivery-plan-redraft-leagues.md §8.1 — the house
-- standard, applied here per the LV.1.2 DoD):
--   * ADDITIVE ONLY — one new table. `lists` and `list_players` are not
--     touched: no column added, no policy added, no policy altered. The
--     existing 001/067 policy sets on both survive byte-for-byte (pinned by
--     pgTAP 028 with `policies_are`).
--   * RLS enabled + all policies in the SAME migration as the table (below).
--   * Indexes for every FK used in policies or joins — see the index note.
--   * `IF NOT EXISTS` guards on the table and index; policies use the house
--     `DROP POLICY IF EXISTS` + `CREATE POLICY` form (Postgres has no
--     `CREATE POLICY IF NOT EXISTS`), so the whole file is re-runnable.
--   * Staging-clone rehearsal: **R6 waiver cited** — no staging environment
--     exists for this project. The recorded rehearsal evidence is a fresh
--     `npx supabase db reset` replaying the full 001→079 chain plus
--     `supabase test db`, both shown in the LV.1.2 PR.
--   * Typegen (`src/types/database.ts`) regenerated and committed in the
--     same PR, with the hand-written alias block preserved.
--   * Realtime broadcast trigger: **not owed**. These rows have no live
--     subscriber anywhere in Lists v2 — LV.1.3 reads them through
--     React Query on mount, and D2 caps the feature at a per-user display
--     treatment, so there is nothing to broadcast and nobody to broadcast
--     to. A second device picks the marks up on its next fetch, which is
--     exactly the cross-device story D2 asks for. If a future task ever
--     wants live drafted marks, it adds the trigger then.
--   * Reaches production via `npx supabase db push` — NEVER by hand, never
--     through the dashboard or the database API (CLAUDE.md migration
--     discipline; the 36-unapplied-migrations lesson).
--
-- RLS checklist (§8.2):
--   * SELECT scoped by ownership — `user_id = auth.uid()`, full stop. These
--     rows are private scratch marks; nobody else ever reads them, not even
--     the owner of the list they are about.
--   * Client INSERT/DELETE are DELIBERATE and named here, the same
--     spec-sanctioned shape `list_favorites` (013) already uses for the
--     analogous "my row about a list that may not be mine" table: D2 prints
--     `RLS: every operation requires auth.uid() = user_id`.
--   * **NO UPDATE policy** — deny-by-default, and deliberately so: this is
--     an immutable row. There is no mutable payload; `drafted_at` is
--     write-once and un-marking is a DELETE. pgTAP 028 proves UPDATE is
--     0-affected for the row's OWN user, not merely for strangers.
--   * No inline subquery on a hot path: the SELECT and DELETE policies are
--     bare column comparisons. The single EXISTS lives on INSERT only —
--     one row per checkbox tap.
--
-- BEYOND-THE-PRINT hardening (the D106/R43 class — a stated invariant that
-- nothing enforces becomes a constraint at creation time). Two, both aimed
-- at CLAUDE.md's "never let 'nothing happened' mean 'it worked'":
--
--   1. **Composite FK (list_id, player_id) → list_players(list_id,
--      player_id) ON DELETE CASCADE**, in place of separate list_id→lists
--      and player_id→players FKs (which it subsumes transitively). A drafted
--      mark for a player who is not on that list is now impossible on ANY
--      path — the DB rejects it 23503 rather than storing a mark that no
--      view will ever render. It also self-cleans: when a player leaves the
--      list, every user's mark for him on that list goes with him. Verified
--      safe against the existing writers before choosing it — nothing in the
--      app delete-and-reinserts `list_players` for a list. `reorder_list_players`
--      (004) is UPDATE-only, and `/api/big-board/save` diffs (it deletes only
--      players genuinely removed), so no reorder or board save can wipe a
--      mark. The referenced key is 001's `list_players_list_id_player_id_key`.
--   2. **`deleted_at IS NULL` on the INSERT policy**, so a trashed list
--      cannot accept new marks even from its owner (who can still SELECT it
--      under 001's owner arm). Mirrors `list_favorites` and every
--      `/api/lists` route.
--
-- The INSERT policy's `EXISTS (SELECT 1 FROM lists ...)` carries NO explicit
-- visibility conjunct ON PURPOSE. Policy expressions are evaluated as the
-- invoking role, so that subquery runs under `lists`'s OWN RLS (the same
-- mechanism 067's D106 note documents and probed live). The rule it
-- therefore encodes is: **you may mark drafted on any list you can read** —
-- your own, anyone's public list (the Saved-tab case D2 exists for), and a
-- private list shared with your league under 067 — and it stays correct for
-- free if `lists` visibility ever changes again. Spelling the visibility out
-- inline, as 013 does, would have silently excluded the 067 shared-private
-- case. Both directions are pinned in pgTAP 028 and in the stack suite.
--
-- The DELETE policy is `user_id = auth.uid()` ALONE, with no list check: you
-- must always be able to clean up your own rows, including on a list that
-- has since gone private or into the trash.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table (D2's printed DDL + the two hardening constraints)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS list_player_drafted (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  list_id UUID NOT NULL,
  player_id TEXT NOT NULL,
  drafted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, list_id, player_id),

  -- Hardening 1: the mark can only exist for a player actually on that list,
  -- and dies with him when he is removed from it.
  CONSTRAINT list_player_drafted_list_player_fkey
    FOREIGN KEY (list_id, player_id)
    REFERENCES list_players (list_id, player_id)
    ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (§8.1)
-- ---------------------------------------------------------------------------
-- The PK (user_id, list_id, player_id) already serves every read path this
-- feature has — "my marks on this list" is a (user_id, list_id) prefix scan,
-- and it indexes the user_id→profiles FK by its leading column. What the PK
-- does NOT cover is the composite FK above: cascading a `list_players`
-- deletion has to find dependent rows by (list_id, player_id), which is not
-- a PK prefix. Without this index that cascade degrades to a seq scan of the
-- whole table on every player removal.
CREATE INDEX IF NOT EXISTS idx_list_player_drafted_list_player
  ON list_player_drafted(list_id, player_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — D2: "every operation requires auth.uid() = user_id"
-- ---------------------------------------------------------------------------

ALTER TABLE list_player_drafted ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "list_player_drafted self read" ON list_player_drafted;
DROP POLICY IF EXISTS "list_player_drafted self insert" ON list_player_drafted;
DROP POLICY IF EXISTS "list_player_drafted self delete" ON list_player_drafted;

-- Read: mine only. Not the list owner's business, not the league's.
CREATE POLICY "list_player_drafted self read"
  ON list_player_drafted FOR SELECT
  USING (user_id = auth.uid());

-- Insert: mine only, on a live list I can read (see the banner — the EXISTS
-- defers to `lists` RLS deliberately, which is what makes the Saved-list case
-- work without hardcoding visibility here).
CREATE POLICY "list_player_drafted self insert"
  ON list_player_drafted FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_player_drafted.list_id
        AND lists.deleted_at IS NULL
    )
  );

-- Delete: mine only, unconditionally — un-marking one player, and LV.3.9's
-- "Clear drafted" for the whole list, are the same policy.
CREATE POLICY "list_player_drafted self delete"
  ON list_player_drafted FOR DELETE
  USING (user_id = auth.uid());

-- No UPDATE policy, on purpose: the row is immutable and row presence is the
-- entire state (§8.2 "immutable tables have no UPDATE policy").

COMMENT ON TABLE list_player_drafted IS
  'Per-user, per-list "already drafted" display marks (Lists v2 D2/LV.1.2). Row presence is the state; drafted_at is write-once. Purely a strikethrough/dim treatment — never reorders, filters, cascades to other lists, or affects rank.';
