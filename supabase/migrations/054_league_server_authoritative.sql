-- ============================================================================
-- League state is server-authoritative — R37/R38 ruling + R39/R40/R43 —
-- M1 batch-2 review remediation (PROGRESS "Review findings — 2026-07-20
-- (M1 batch 2)"; Q8 ruling 2026-07-20; spec erratum v2.8.2; plan §8.1–8.2).
--
-- NUMBERING: next free at task time is 054 per the tasks-M1 §7 rule; this
-- shifts league_invites and the rest of the schema lane to 055–059 (the §7
-- table is corrected in the same change).
--
-- 1. R37 (Q8 ruling): once created, league state is server-authoritative —
--    no direct client DML. 001's "League owners can manage" FOR ALL policy
--    is DROPped with NO write replacement: the review live-proved a client
--    forging `scoring_rules_snapshot` + `status='drafting'` through it, and
--    hard-DELETEing the league (rule-8 soft-delete bypass, cascading
--    league_members/team_managers). Owner SELECT persists via the §12.1
--    policy's `owner_id = auth.uid()` branch (052) — no replacement policy
--    needed. League creation is already the create_league RPC's job
--    (L.A1.12); deletion is the §15.1 soft delete (commish route → RPC), so
--    no client DELETE verb is retained. The spec's §12.1 "keep 'League
--    owners can manage'" instruction is SUPERSEDED (erratum v2.8.2) — it
--    predates 040's protected columns (scoring_rules_snapshot, status,
--    settings), which turned a benign legacy policy into a forgery surface.
-- 2. R38 (same ruling): seating is written only via the L.A1.12–15 RPCs.
--    "Commish manages members" (FOR ALL) is replaced by a placeholder-seat
--    surface with NO UPDATE policy: RLS cannot scope columns, so "no client
--    UPDATE on seating fields" is implemented as no client UPDATE at all —
--    nothing in M1 client flows updates league_members directly (autodraft
--    toggle is M2, roles/kicks are L.A1.15 RPCs). INSERT/DELETE stay for
--    the one legitimate client-shaped act (§12.2's placeholder seats) but
--    are pinned to it by WITH CHECK/USING: user_id NULL + team_id NULL +
--    role 'manager' + is_placeholder — a commish can no longer client-mint
--    a seated/role-bearing cache row with no team_managers stint behind it
--    (the cache⇄history divergence R38 proved). Kicking a REAL member is
--    remove_manager (L.A1.15), which closes the stint in the same txn.
-- 3. R43: teams.status constrained to the §12.22 enum (active | orphaned |
--    retired) — 'banana' was accepted, live-proven in review.
-- 4. R40: self-succession rejected at the DB layer (CHECK — free now, and
--    the retire RPC is M4-deferred so the gap had no scheduled owner).
--    Longer cycles (A→B→A) are NOT trigger-guarded here: §12.22 prints no
--    constraint, walking the chain needs a recursive trigger out of
--    proportion to a column only SECURITY DEFINER RPCs may write — cycle
--    rejection is recorded as retire_franchise's in-body duty (D53), with
--    a pin due when that RPC lands (M4/D42).
-- 5. R39 (plan §8.1 — indexes for every FK used in policies/joins):
--    team_managers.league_id (SELECT-policy argument + history queries),
--    team_managers.team_id full (the partial one_open_stint_per_team only
--    covers ended_at IS NULL — closed-stint reads and the teams ON DELETE
--    CASCADE check scanned), league_members.team_id (teams ON DELETE SET
--    NULL scanned; UNIQUE(league_id, team_id) doesn't serve it). §12.2/
--    §12.22 verbatim named only the shipped indexes — spec silence, not
--    prohibition; erratum v2.8.2 records these three.
--
-- Grants: none — 037 default-ACL model (D23); no new functions, so the
-- §4.1 REVOKE discipline has no target. The 052 helpers' EXECUTE posture is
-- unchanged (D50, with the R42 PUBLIC-grant correction pinned in pgTAP 006).
-- No realtime triggers (D38 waiver: no live subscriber in the M1 UI slice).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–054 + the pgTAP suite is the rehearsal
-- evidence. Prod-safe: policy swaps on tables with zero league-scoped rows
-- in prod, additive CHECKs on empty/new columns, additive indexes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leagues: no client write path (R37 / Q8 ruling)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "League owners can manage" ON leagues;
-- Owner SELECT persists via "Leagues viewable by members"
-- (is_league_member(id) OR owner_id = auth.uid(), 052). All writes via
-- SECURITY DEFINER RPCs (create_league L.A1.12; settings/lifecycle L.A1.13;
-- soft delete per §15.1).

-- ----------------------------------------------------------------------------
-- 2. league_members: placeholder-seat surface only; NO client UPDATE (R38)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Commish manages members" ON league_members;

CREATE POLICY "Commish adds placeholder seats"
  ON league_members FOR INSERT
  WITH CHECK (
    is_league_commish(league_id)
    AND user_id IS NULL
    AND team_id IS NULL
    AND role = 'manager'
    AND is_placeholder
  );

CREATE POLICY "Commish removes placeholder seats"
  ON league_members FOR DELETE
  USING (
    is_league_commish(league_id)
    AND user_id IS NULL
    AND team_id IS NULL
    AND is_placeholder
  );
-- No UPDATE policy: seating (team_id), roles, and membership of real users
-- move only through the L.A1.12–15 RPCs, which write team_managers stints
-- in the same transaction (§12.2 v2.1 note).

-- ----------------------------------------------------------------------------
-- 3. teams integrity CHECKs (R43 status enum; R40 self-succession)
-- ----------------------------------------------------------------------------
ALTER TABLE teams
  ADD CONSTRAINT teams_status_valid
    CHECK (status IN ('active', 'orphaned', 'retired'));

ALTER TABLE teams
  ADD CONSTRAINT teams_successor_not_self
    CHECK (successor_team_id IS NULL OR successor_team_id <> id);
-- Longer succession cycles are rejected in-body by retire_franchise (D53).

-- ----------------------------------------------------------------------------
-- 4. FK indexes (R39, plan §8.1)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_team_managers_league ON team_managers(league_id);
CREATE INDEX IF NOT EXISTS idx_team_managers_team ON team_managers(team_id);
CREATE INDEX IF NOT EXISTS idx_league_members_team ON league_members(team_id);
