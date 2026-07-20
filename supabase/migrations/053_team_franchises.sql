-- ============================================================================
-- Franchise columns + team_managers stints + teams RLS replacement — M1 task
-- L.A1.3 (tasks-M1-league-foundation.md §6/§7 table: 053, renumbered from the
-- stale 042 reservation; spec-redraft-leagues.md v2.8.1 §7.2.1/§12.22 +
-- erratum v2.7.1 gap fixes D35a/D35b).
--
-- 1. teams franchise-lifecycle columns per §12.22 verbatim:
--      status TEXT NOT NULL DEFAULT 'active'   -- active | orphaned | retired
--      retired_at_week INTEGER                 -- league week the franchise was sealed
--      successor_team_id UUID REFERENCES teams(id)  -- retired team → its successor
--    plus the v2.7.1 gap fix D35a: list_id DROPs NOT NULL — a league
--    franchise carries no backing list (001's constraint made §7.2's
--    auto-created join/placeholder teams uninsertable, conflict C3);
--    standalone team-lists are unaffected.
-- 2. teams RLS replacement (D35b, conflict C4): 001's "Users can manage own
--    teams" FOR ALL (client-writable incl. wins/losses/league_id) is DROPped
--    and replaced by an owner-manage policy scoped league_id IS NULL — legacy
--    standalone teams keep working; league teams have NO client write path
--    (server-authoritative, §8.1: writes only via SECURITY DEFINER RPCs,
--    L.A1.12+). The explicit WITH CHECK mirrors the USING expression (052
--    precedent — behavioral no-op vs the implicit form, pinned for clarity);
--    it also blocks an owner UPDATE that would move a standalone team INTO a
--    league (league_id must be set by the server path only). World-readable
--    SELECT ("Teams are viewable by everyone") stays — public league summary,
--    §17.
-- 3. team_managers per §12.22 verbatim: columns, UNIQUE(team_id, user_id,
--    started_at), the one_open_stint_per_team partial unique index (a team's
--    current manager = the row with ended_at IS NULL — the index converts
--    the E54 double-claim race into a 23505), idx_team_managers_user, RLS
--    with the single "Stints viewable by league members" SELECT policy and
--    NO write policies for any client role — stints are written only via
--    SECURITY DEFINER RPCs (assign_manager / remove_manager(mode) / claim,
--    L.A1.14/L.A1.15), in the same transaction as the league_members
--    current-state cache update (§12.2 v2.1 note).
-- 4. §12.22's backfill note ("open a stint for every currently seated
--    league_members row") is VACUOUS today: league_members is empty in every
--    environment pre-launch (created in 052, no writer exists until
--    L.A1.12), so no backfill statement ships — stints are written from day
--    one by the RPCs instead (task text item 3).
--
-- Grants: none — 037 default-ACL model (D23): grants are uniform, RLS is the
-- gate. No new functions in this migration, so the §4.1 REVOKE discipline
-- has no target here (the SELECT policy's is_league_member is 052's
-- policy-predicate helper, whose EXECUTE posture is documented in D50).
-- No realtime triggers (D38 waiver: no live subscriber in the M1 UI slice).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–053 + the pgTAP suite is the rehearsal
-- evidence. Prod-safe: additive columns + one NOT NULL drop + a policy swap
-- on a table whose league-scoped rows are zero in prod (no app code writes
-- teams — M1 survey §2; the product's "teams" are lists.is_team rows).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. teams franchise columns (§12.22) + D35a list_id NOT NULL drop
-- ----------------------------------------------------------------------------
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',      -- active | orphaned | retired
  ADD COLUMN IF NOT EXISTS retired_at_week INTEGER,                     -- league week the franchise was sealed
  ADD COLUMN IF NOT EXISTS successor_team_id UUID REFERENCES teams(id); -- set on the RETIRED team → its successor

ALTER TABLE teams ALTER COLUMN list_id DROP NOT NULL;  -- D35a: league franchises carry no backing list

-- ----------------------------------------------------------------------------
-- 2. teams RLS replacement (D35b): league teams are server-authoritative-only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own teams" ON teams;

CREATE POLICY "Users can manage own standalone teams"
  ON teams FOR ALL
  USING (auth.uid() = owner_id AND league_id IS NULL)
  WITH CHECK (auth.uid() = owner_id AND league_id IS NULL);
-- "Teams are viewable by everyone" (001) is deliberately kept (§17).

-- ----------------------------------------------------------------------------
-- 3. team_managers (§12.22 verbatim)
-- ----------------------------------------------------------------------------
CREATE TABLE team_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager',        -- manager (co_manager reserved post-v1)
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_week INTEGER,                        -- league-week granularity for history splits (NULL preseason)
  ended_at TIMESTAMPTZ,
  ended_week INTEGER,
  end_reason TEXT,                             -- kicked | left | seat_retired | replaced
  ended_by UUID REFERENCES profiles(id),       -- commissioner, or self
  UNIQUE (team_id, user_id, started_at)
);

CREATE UNIQUE INDEX one_open_stint_per_team ON team_managers(team_id) WHERE ended_at IS NULL;
CREATE INDEX idx_team_managers_user ON team_managers(user_id);

ALTER TABLE team_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stints viewable by league members"
  ON team_managers FOR SELECT USING (is_league_member(league_id));
-- writes only via SECURITY DEFINER RPCs: assign_manager / remove_manager(mode) / retire_franchise
