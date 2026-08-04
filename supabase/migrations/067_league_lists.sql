-- ============================================================================
-- league_lists — attach ranking lists to a league (spec §7.4, §12.15, §15.5;
-- tasks-M2 task L.B4.1; PROGRESS D32/D106). The list ↔ league tie-in: a
-- member attaches their own ranking lists to a league, optionally marks ONE
-- as their primary draft board (feeds queue/autopick — §8.4/§8.9, consumed
-- by 068's resolution chain), and optionally shares an attachment with the
-- whole league (§7.4 "Share"). Non-destructive: detaching deletes only the
-- association, never the list.
--
-- Standing rules (tasks-M2 §4, all six cited):
--   1. Grants doctrine (D18→D23): no per-object GRANTs — 037's default ACLs
--      + RLS are the model. NO SECURITY DEFINER routine is created by this
--      migration (the 065/D104 shape), so no REVOKE is owed under §4.1.
--   2. No-write-policy pgTAP pattern: per-role deny-by-default proven in
--      pgTAP 021 (same PR) with policies_are pins + RETURNING-count writes.
--   3. Falsifiability floor: golden indexdef/policy pins, the one-primary
--      boundary at the index, both directions of every privacy read, break
--      probe on the privacy pin shown + reverted in the session log.
--   4. Migration checklist (plan §8.1): additive-only; RLS + policies in
--      the same migration as the table; indexes for every FK used in
--      policies/joins (idx_league_lists_list added for exactly that — the
--      printed DDL indexes (league_id, owner_id) but the shared-read
--      policies probe by list_id); R6 staging-rehearsal waiver — no staging
--      env exists, the fresh local `db reset` replay is the recorded
--      rehearsal evidence; typegen committed in the same PR.
--   5. Realtime doctrine: league_lists has NO live subscriber anywhere in
--      M2 — the L.B4.2 panel reads are React-Query-invalidated and the
--      draft room's live updates ride the draft:<id> picks channel (E17,
--      tasks-M2 §5 channel inventory, which deliberately omits
--      league_lists) — so rule 5 owes no broadcast trigger here. Recorded
--      in ledger row F42 (appended by this PR) so a future subscriber's
--      milestone finds the obligation.
--   6. Draft-row lock discipline: N/A — no draft RPC, no draft-row access.
--
-- CLIENT-WRITE EXCEPTION (deliberate, spec-sanctioned): the owner-scoped
-- FOR ALL policy below is printed verbatim in §12.15 — league_lists joins
-- `league_chat` and `draft_queues` as a spec-named client-writable table
-- (plan §8.2's allowance: "no client INSERT/UPDATE/DELETE unless the spec
-- names it"). The §15.5 routes (same PR) are thin friendly-4xx handlers
-- over this table; RLS remains the enforcement backstop, not the API.
--
-- BEYOND-THE-PRINT hardening (D106; the R43 lesson — a spec comment stating
-- an invariant becomes a constraint at creation):
--   * §12.15's owner_id comment says "matches lists.owner_id", but nothing
--     printed enforces it: a member could INSERT a row with owner_id =
--     themselves (passing the FOR ALL WITH CHECK) but list_id = SOMEONE
--     ELSE'S list, and with shared_with_league = TRUE that would expose the
--     victim's PRIVATE list to the whole league via the shared-read policy
--     below — a forced-share privacy hole. Closed declaratively: a
--     composite FK (list_id, owner_id) → lists (id, owner_id), backed by a
--     (trivially satisfied — id is the PK) UNIQUE constraint on lists.
--     Attaching a list you don't own now fails 23503 at the DB no matter
--     the path. pgTAP 021 pins it; spec erratum folded as v2.8.12.
--   * The §12.15 note's shared-private read is shipped for `lists` AND for
--     `list_players` (D106): the note prints only the `lists` policy, but
--     its own stated purpose — "let members OPEN a list that is shared but
--     private in the draft room" — is unreachable without the list's rows
--     (001's list_players policy re-states list visibility inline, so it
--     does NOT follow the new lists policy automatically). Both policies
--     are ADDITIVE — the four 001 lists/list_players policies are untouched
--     — and both carry `deleted_at IS NULL`, mirroring 001's public-read
--     arm: a soft-deleted list is readable by its owner only. Erratum
--     v2.8.12 records both. Defense in depth (probed live, D106): the
--     EXISTS subqueries run under league_lists's OWN RLS, so the content
--     policies' `shared_with_league = TRUE` conjunct and the league_lists
--     SELECT policy's shared arm each independently block a non-shared
--     leak — content reaches a fellow member only if BOTH layers loosen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table + indexes (§12.15 DDL verbatim)
-- ---------------------------------------------------------------------------

CREATE TABLE league_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE NOT NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,  -- member who attached it (matches lists.owner_id — ENFORCED below, D106)
  is_primary_board BOOLEAN DEFAULT FALSE,        -- feeds this member's queue/autopick for the league
  shared_with_league BOOLEAN DEFAULT FALSE,      -- visible to all members (else owner-only)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, list_id, owner_id)
);

-- at most one primary board per member per league:
CREATE UNIQUE INDEX uniq_primary_board_per_member
  ON league_lists(league_id, owner_id) WHERE is_primary_board = TRUE;
CREATE INDEX idx_league_lists_member ON league_lists(league_id, owner_id);

-- §8.1 checklist: index the FK the shared-read policies probe by (the two
-- policies below EXISTS on league_lists.list_id; the printed index covers
-- (league_id, owner_id) only).
CREATE INDEX idx_league_lists_list ON league_lists(list_id);

-- ---------------------------------------------------------------------------
-- 2. Ownership invariant (D106 — the R43 comment-becomes-constraint class)
-- ---------------------------------------------------------------------------

-- (id, owner_id) is trivially unique (id is the PK); the constraint exists
-- solely so the composite FK below can reference it.
ALTER TABLE lists ADD CONSTRAINT lists_id_owner_unique UNIQUE (id, owner_id);

ALTER TABLE league_lists
  ADD CONSTRAINT league_lists_list_owner_fkey
  FOREIGN KEY (list_id, owner_id) REFERENCES lists (id, owner_id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. RLS (§12.15 policies verbatim)
-- ---------------------------------------------------------------------------

ALTER TABLE league_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own or shared league-list links readable"
  ON league_lists FOR SELECT USING (
    owner_id = auth.uid()
    OR (shared_with_league = TRUE AND is_league_member(league_id))
  );

CREATE POLICY "Members manage their own attachments"
  ON league_lists FOR ALL USING (owner_id = auth.uid() AND is_league_member(league_id));

-- ---------------------------------------------------------------------------
-- 4. Shared-private reads (§12.15 note + D106) — ADDITIVE policies only;
--    the existing 001 lists/list_players policies are untouched.
-- ---------------------------------------------------------------------------

-- Public lists are already readable by everyone (001), so these two matter
-- only for PRIVATE lists a member deliberately shared with the league.
CREATE POLICY "League-shared lists readable by league members"
  ON lists FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM league_lists ll
      WHERE ll.list_id = lists.id
        AND ll.shared_with_league = TRUE
        AND is_league_member(ll.league_id)
    )
  );

-- The companion (D106): "opening" a shared list means reading its rows.
CREATE POLICY "League-shared list players readable by league members"
  ON list_players FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM league_lists ll
      JOIN lists l ON l.id = ll.list_id
      WHERE ll.list_id = list_players.list_id
        AND ll.shared_with_league = TRUE
        AND l.deleted_at IS NULL
        AND is_league_member(ll.league_id)
    )
  );
