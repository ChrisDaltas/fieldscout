-- ============================================================================
-- league_members + §12.0 RLS helpers + §12.1 leagues policy swap — M1 task
-- L.A1.2 (tasks-M1-league-foundation.md §6/§7; spec-redraft-leagues.md v2.8.1).
--
-- NUMBERING: tasks-M1 §7 reserved 041 for this task; the chain moved past the
-- reservation (048 C15 hardening; 049–051 L.A1.1 review fixes). Next free
-- number at task time is 052 — taken per the §7 rule "Builders confirm the
-- next free numbers at task time". The §7 table is corrected in the same
-- change so later tasks inherit reality (052–058), not the stale reservation.
--
-- 1. league_members per spec §12.2 verbatim: columns, UNIQUE(league_id,
--    user_id), UNIQUE(league_id, team_id), RLS + the two §12.2 policies,
--    both indexes. The commish FOR ALL policy carries an explicit
--    WITH CHECK (task item 2 — clarity/pinning only; Postgres applies the
--    USING expression to new rows when WITH CHECK is omitted, so §12.2's
--    printed form already denies non-commish INSERTs; behaviorally a no-op).
--    No client write path beyond the commish policy — membership writes
--    happen via SECURITY DEFINER RPCs (create_league / join / claim,
--    L.A1.12+), which update league_members and team_managers in the same
--    transaction (§12.2 v2.1 note).
-- 2. is_league_member / is_league_commish per §12.0 WITH the v2.0 hardening
--    the printed bodies omit (the hardening note is normative): SECURITY
--    DEFINER + SET search_path = '' + schema-qualified references. SECURITY
--    DEFINER is load-bearing: league_members' own SELECT policy calls
--    is_league_member, which reads league_members — definer rights bypass
--    RLS inside the helper, avoiding policy recursion.
--    DELIBERATE DEVIATION from standing rule §4.1's REVOKE discipline
--    (documented, not silent): NO "REVOKE EXECUTE ... FROM anon" on these
--    two. They are RLS policy predicates, not RPCs — §12.0's REVOKE rule
--    says "on all league RPCs". Any anon/authenticated query that touches a
--    policied table whose policy calls a helper evaluates that helper as the
--    querying role; revoking anon EXECUTE would turn every anon SELECT on
--    leagues into a 42501 error instead of an empty result. Exposure is nil:
--    both return caller-scoped booleans (membership of auth.uid() only —
--    NULL for anon, so always FALSE; nothing about other users leaks).
--    In-body authorization (§8.3) is satisfied trivially: these ARE the
--    authorization primitives, keyed to auth.uid() internally — there is no
--    caller-supplied principal.
-- 3. §12.1 policy swap on leagues: DROP the 001 policy "Leagues are viewable
--    by members" (keyed off teams.league_id — exactly what §12.1 replaces);
--    CREATE "Leagues viewable by members" USING (is_league_member(id) OR
--    owner_id = auth.uid()). "League owners can manage" (001) is kept.
--    Semantics deliberately change both ways, pinned in pgTAP 006:
--      * a league_members row with no teams row now grants SELECT
--        (old policy: no) — members see their league before teams exist;
--      * a teams row with no league_members row no longer grants SELECT
--        (old policy: yes) — the roster cache is not the membership truth.
--
-- Grants: none — per the 037 default-ACL model (D23) grants are uniform and
-- RLS is the gate (the §2 helper deviation above is the one grant-adjacent
-- call, and it is a keep-the-default, not a narrowing). No realtime
-- triggers (D38 waiver: no live subscriber in the M1 UI slice).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–052 + the pgTAP suite is the rehearsal
-- evidence. Prod-safe: additive table + two new functions + a policy swap on
-- a table with zero rows in prod (verified precondition of 040's C9 gate).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. league_members (§12.2 verbatim)
-- ----------------------------------------------------------------------------
CREATE TABLE league_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,   -- NULL for an unclaimed placeholder seat
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,     -- the manager's roster in this league
  role TEXT NOT NULL DEFAULT 'manager',                     -- commissioner | co_commissioner | manager
  is_placeholder BOOLEAN DEFAULT FALSE,
  is_autodraft BOOLEAN DEFAULT FALSE,
  faab_balance INTEGER,                                    -- in-season FAAB remaining; seeded from leagues.faab_budget on join
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, user_id),
  UNIQUE(league_id, team_id)
);

ALTER TABLE league_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_league_members_league ON league_members(league_id);
CREATE INDEX idx_league_members_user ON league_members(user_id);

-- ----------------------------------------------------------------------------
-- 2. §12.0 shared RLS helpers, v2.0-hardened (must exist before the policies
--    that reference them)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_league_member(p_league_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION is_league_commish(p_league_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid()
      AND m.role IN ('commissioner','co_commissioner')
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. league_members policies (§12.2, + explicit WITH CHECK on the commish
--    FOR ALL policy)
-- ----------------------------------------------------------------------------
CREATE POLICY "Members viewable by league members"
  ON league_members FOR SELECT USING (is_league_member(league_id));

CREATE POLICY "Commish manages members"
  ON league_members FOR ALL
  USING (is_league_commish(league_id))
  WITH CHECK (is_league_commish(league_id));

-- ----------------------------------------------------------------------------
-- 4. §12.1 leagues policy swap (membership truth moves off teams.league_id)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Leagues are viewable by members" ON leagues;

CREATE POLICY "Leagues viewable by members"
  ON leagues FOR SELECT
  USING (is_league_member(id) OR owner_id = auth.uid());
-- "League owners can manage" (001) is deliberately kept; co-commish
-- management arrives via SECURITY DEFINER RPCs (L.A1.12+), not policies.
