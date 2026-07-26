-- ============================================================================
-- League member management — M1 task L.A1.15. Spec: §7.2 (roles: exactly one
-- commissioner, multiple co-commissioners, the creator is never removable by
-- a co-commissioner; placeholder seats = "a teams row owned by the
-- commissioner, flagged is_placeholder"; capacity), §7.2.1 (franchise ≠
-- manager; the three removal outcomes takeover / retire-and-succeed /
-- vacate; "voluntary leave uses the same flow with end_reason='left'; a
-- commissioner cannot leave without first transferring the commissioner
-- role"; "the removed user is notified with the outcome category"), §12.2
-- (league_members = the current-state cache, written in the SAME txn as the
-- stint; faab_balance seeded from leagues.faab_budget — v2.8.7), §12.22
-- (team_managers stints; end_reason ∈ kicked | left | seat_retired |
-- replaced; teams.status ∈ active | orphaned | retired), §15.1 (POST
-- /api/leagues/[id]/members · PATCH|DELETE .../members/[mid] · POST
-- .../teams/[tid]/assign-manager), §17 (membership is free).
-- PROGRESS: D42 (M1 ships the full three-outcome signature with PRE-DRAFT
-- semantics only — retire is a friendly refusal until M4), D47 (capacity =
-- friendly refusal, no unseated member rows), D63 (retry/idempotency
-- doctrine), D74 (this migration's mechanics). Ledger: **F3 discharged**
-- (close-before-open + clock_timestamp at every stint insert, assign/remove
-- half), F28 (the shrink floor's third writer — same predicate, same lock),
-- F31/F32/F33/F34/F35/F36 filed by this task.
--
-- NUMBERING (D50(1) precedent; re-confirmed on disk at task time): next free
-- migration is **063** (062 = league invite RPCs, landed); next free pgTAP
-- file is **017** (016 = invite RPCs); next free decision **D74**; next free
-- forward-obligation **F31**; next free review finding **R90**.
--
-- ----------------------------------------------------------------------------
-- Contents
-- ----------------------------------------------------------------------------
--   0. INTEGRITY (R43 class, taken now — D55(2a): fix at the moment a writer
--      appears, not at the next review pass; D69: a sanctioned writer is not
--      a backstop, PostgREST reaches every RPC directly).
--      (a) league_members.role CHECK to the §12.2 enum — the column was bare
--          TEXT with a comment (052:68) and this task is the first thing that
--          ever CHANGES a role after creation.
--      (b) UNIQUE INDEX one_commissioner_per_league (partial, role =
--          'commissioner') — §7.2's "Exactly one commissioner" had ZERO DB
--          backing; the API refusal was the only thing standing between the
--          data and a two-commissioner league.
--      (c) team_managers.end_reason CHECK to §12.22's four values — L.A1.15
--          is the FIRST writer of the column in the repo, and 'left' is a
--          literal string in three places, so a typo would be permanently
--          invisible.
--      (d) team_managers.role CHECK ('manager') — §12.22's "co_manager
--          reserved post-v1".
--
--   1. POLICY REMOVAL (S2 of the pre-build hazard brief; Q8/v2.8.2 applied
--      consistently): 054's two client carve-out policies — "Commish adds
--      placeholder seats" / "Commish removes placeholder seats" — are
--      DROPped. league_members is now SELECT-only on the client, with every
--      write in the L.A1.12–15 SECURITY DEFINER RPCs. Reason: those policies
--      require `team_id IS NULL`, i.e. a seat with NO franchise, which (i)
--      contradicts §7.2:170's placeholder shape ("a `teams` row owned by the
--      commissioner, flagged is_placeholder"), (ii) is invisible to EVERY
--      capacity check in the build (all three count `teams WHERE league_id =
--      X AND status <> 'retired'` — 061, 062 ×2, and add_placeholder_seat
--      below), so a commissioner could POST directly to
--      /rest/v1/league_members and over-subscribe past team_count, defeating
--      D47 and the F28 floor, and (iii) is unreachable by assign_manager
--      (nothing links the seat to a franchise). D52(3) called this surface
--      "the one client-shaped act with no stint implications" — that
--      rationale is falsified now that a placeholder seat carries a
--      franchise. Ruled under the EXISTING Q8 ruling ("once created, league
--      state is server-authoritative — no direct client DML"), recorded as
--      D74(3) + spec erratum §12.2 (v2.8.8).
--
--   2. `notify_league_member_internal(user, type, title, body, data)` —
--      INTERNAL guarded notification insert (§7.2.1:191 "the removed user is
--      notified with the outcome category"). Plain (non-SECURITY-DEFINER, it
--      runs in the calling definer's context), search_path = '', EXECUTE
--      revoked from PUBLIC, anon AND authenticated. Failure is swallowed by
--      design (the 062:397 pattern): a notification must never break a
--      membership write.
--
--   3. `add_placeholder_seat(league, team_name?)` — §15.1 POST
--      /api/leagues/[id]/members. Commish-only in-body (42501). Writes the
--      §7.2:170 shape: a `teams` row owned by the ACTING commissioner
--      (list_id NULL — D35a; status default 'active') + a `league_members`
--      row with user_id NULL, **team_id SET**, role 'manager', is_placeholder
--      TRUE **explicitly** (the column is nullable with DEFAULT FALSE — a
--      NULL fails every `AND is_placeholder` predicate) and faab_balance
--      seeded from the CURRENT leagues.faab_budget (§12.2 — the task text's
--      "every league_members insert here seeds faab_balance"). Deliberately
--      NO team_managers stint: team_managers.user_id is NOT NULL (053:82),
--      which is exactly why a claim on a placeholder passes the one-open-
--      stint index and only ever tripped the league_members UNIQUE (the 062
--      defect this task fixes). Franchise name (Builder-finalized contract,
--      D72 slug precedent — the spec prints none): the caller may name the
--      seat; otherwise `Team N` where N = the non-retired franchise count + 1,
--      matching §7.2:167's own invite copy ("You've been invited to manage
--      Team 4"). Gated to setup/scheduled (D72's class: creating a franchise
--      mid-draft would corrupt M2/M4 machinery) and capacity-capped at
--      team_count under the league-row lock.
--
--   4. `set_member_role(league, member, role)` — §15.1 PATCH
--      .../members/[mid] (role half; the autodraft half is M2 — F33).
--      p_role ∈ commissioner | co_commissioner | manager. Setting
--      'commissioner' is an ATOMIC TRANSFER — demote the incumbent to
--      co_commissioner, promote the target, both under the league-row FOR
--      UPDATE, demote-first so the new partial unique index never sees two
--      (D74(4)). **Only the sitting commissioner may transfer** (a
--      co-commissioner promoting themselves is a coup → 42501). Why a
--      transfer verb exists at all: §7.2 names the "exactly one
--      commissioner" invariant but no transfer, while §7.2.1:193 REQUIRES
--      one ("a commissioner cannot leave without first transferring the
--      commissioner role") — without it leave_league is unsatisfiable and no
--      commissioner could ever leave. Recorded as D74(4) so it can be
--      overturned in one line if read differently. Other rules: the sitting
--      commissioner's own row changes ONLY by transfer (so a league can
--      never go headless); a co-commissioner may never act on the league
--      CREATOR (§7.2's anti-coup rule — keyed on leagues.owner_id read off
--      the locked row, NOT on role, because after a transfer the creator may
--      be a co-commissioner or a plain manager); a placeholder seat has no
--      role to change; setting the role a member already holds is an
--      idempotent success (D63).
--
--   5. `assign_manager(league, team, user)` — §15.1 POST
--      .../teams/[tid]/assign-manager. Commish-only. Seats a user on an
--      EXISTING franchise via the ONE seating implementation
--      (seat_league_member_internal with p_team_id — 062, amended in place;
--      C9/no-near-duplicate) so faab seeding, stint ordering and
--      clock_timestamp can never drift from the claim path. Races
--      claim_league_invite on the same franchise and takes the SAME
--      teams-row lock after the league row, so the loser of a race gets a
--      friendly "that seat was just claimed" instead of a raw 23505/500.
--      Refuses: a franchise of another league (the doubly-nested route's
--      parent segment is load-bearing — R86), a retired franchise, a seat
--      that already has an OPEN stint (pointing at remove_manager — silently
--      closing an incumbent's stint would be an unaudited kick), and a user
--      already seated in this league on ANOTHER franchise (UNIQUE(league_id,
--      user_id) would otherwise raise an opaque 23505). Re-assigning the
--      manager already seated on that franchise is an idempotent success
--      (D63).
--
--   6. `remove_manager(league, member, mode, successor?, reason?)` — §15.1
--      DELETE .../members/[mid], body { mode, successor_user_id?, reason }.
--      Commish-only. D42 pre-draft semantics, three outcomes:
--        * takeover — successor_user_id REQUIRED (§15.1's body shape is a
--          DIRECT reseat of a named user; the "invite a replacement" journey
--          is `vacate` + create_league_invite(target_team_id), which is what
--          L.A2.5 composes — D74(6)). Closes the open stint with
--          end_reason='replaced', UPDATEs the league_members row IN PLACE
--          (one row per seat, always), opens the successor's stint, and
--          points teams.owner_id at the successor.
--        * vacate — closes the open stint with end_reason='kicked', reverts
--          the cache row to a placeholder (user_id NULL, is_placeholder TRUE,
--          **team_id kept**), re-seeds faab, and sets teams.status =
--          'orphaned' per §7.2.1(c) with owner_id moving to the acting
--          commissioner (owner_id is NOT NULL and leaving it on the removed
--          user would let their profile deletion CASCADE the franchise away).
--          teams.status is NEVER set to 'retired' here: every capacity count
--          is `status <> 'retired'`, so retiring would silently free a seat.
--        * retire — friendly P0001, NO writes (D42: retire-and-succeed needs
--          the successor-franchise machinery, which lands M4 — F31).
--      Never hard-DELETEs a teams row (team_managers.team_id is ON DELETE
--      CASCADE — 053:81 — so deleting a franchise erases every stint ever
--      recorded on it, the one thing §7.2.1 exists to prevent; CLAUDE.md
--      rule 8 forbids it independently) and never writes
--      leagues.successor_team_id (retire_franchise is its only writer —
--      D53/F1). Refuses to remove the sitting commissioner (transfer first —
--      otherwise the league goes headless) and refuses a co-commissioner
--      acting on the creator (§7.2).
--
--   7. `leave_league(league)` — §7.2.1:193 voluntary leave. NO p_user_id
--      argument at all: it acts on auth.uid(), so it can never be an
--      unauthorized kick path. Takes the league row FOR UPDATE **before**
--      reading the caller's role, so a concurrent transfer cannot make them
--      commissioner between check and write. A commissioner is refused with
--      a friendly P0001 that points at the transfer — or, when they are the
--      league's only remaining manager (day one of every new league), at
--      deleting the league instead of stranding them. Otherwise: stint
--      closed with end_reason='left' and ended_by = self, and the SAME
--      vacate semantics as above applied to the franchise (§7.2.1:193 "uses
--      the same flow"; the leaver does not get to choose an outcome on the
--      commissioner's behalf — the spec names no chooser).
--
-- ----------------------------------------------------------------------------
-- Access revocation — what actually revokes it in M1 (I10 of the hazard
-- brief; the review-finding class R84/R89 exists because prose attested
-- behavior the code did not have)
-- ----------------------------------------------------------------------------
-- §7.2.1:190 says "league write access derives from the OPEN STINT in
-- RLS/RPC checks". The shipped code does NOT do that and this migration does
-- not change it: is_league_member (052:86) and is_league_commish (052:96)
-- read `league_members` ONLY, and team_managers' own SELECT policy (053:98)
-- is itself gated on is_league_member. **Closing a stint revokes nothing.**
-- What revokes access here is that the departing user's league_members row
-- loses its user_id (vacate / leave) or gains a different one (takeover) —
-- and because the cache write and the stint close happen in the SAME
-- transaction (§12.2 v2.1 note), history and access can never diverge. If a
-- future milestone moves an RLS predicate onto team_managers, is_league_member
-- must be revisited — filed as ledger row **F35**.
--
-- ----------------------------------------------------------------------------
-- SQLSTATE convention (062:150-159; three-deep precedent 059:165, 059:246,
-- 061:159)
-- ----------------------------------------------------------------------------
-- 42501 = not signed in · not a commissioner · target does not exist and we
--         refuse to leak that it doesn't · a co-commissioner reaching for a
--         power reserved to the sitting commissioner.
-- P0002 = the league is soft-deleted or invisible → the service maps 404.
--         is_league_commish IGNORES deleted_at, so authz never short-circuits
--         this branch — every RPC here carries its own explicit P0002 arm
--         (R87's lesson: a malformed league id 404'd while a soft-deleted one
--         400'd on the same handler).
-- P0001 = a genuine refusal of a well-formed request against a live league
--         (capacity, retire-before-draft, headless-league guards).
-- 22023 = argument-shape violation (unknown mode/role, takeover with no
--         successor).
-- Refusals RAISE rather than returning outcome jsonb (the 060/061 style):
-- unlike claim_league_invite, no refusal here has side effects to preserve,
-- and L.A2.5 renders `retire` as a DISABLED control with an "after the draft"
-- note rather than as a submitted state (D74(7)). One style per route family.
--
-- ----------------------------------------------------------------------------
-- Held-lock note (plan §8.3)
-- ----------------------------------------------------------------------------
-- Lock ORDER is leagues → teams, always, matching every shipped RPC
-- (claim_league_invite takes invites+leagues together at 062:722 then teams
-- at 062:790; join/settings/status/soft-delete take leagues alone). These
-- five RPCs take the league row FOR UPDATE first (which is also what
-- produces the P0002 arm), then the single teams row, then write
-- league_members/team_managers unlocked — reachable only through the
-- serialized league row. **None of them locks or updates a league_invites
-- row**, so they cannot deadlock against an in-flight claim. Each holds its
-- locks across at most one count + a handful of single-row writes; no lock
-- spans external work.
--
-- ----------------------------------------------------------------------------
-- Grants doctrine (D18 → D23 / tasks-M1 §4.1)
-- ----------------------------------------------------------------------------
-- No per-object GRANTs (037's default ACLs already expose new functions —
-- which is exactly why a missing REVOKE would hand anon EXECUTE on
-- remove_manager). Every function below: SECURITY DEFINER + SET search_path =
-- '' (the spec form — D45) + fully schema-qualified references + in-body
-- authorization (SECURITY DEFINER bypasses RLS entirely — D23/R5) + an
-- explicit REVOKE EXECUTE FROM PUBLIC, anon immediately after it. The
-- internal notification helper additionally revokes `authenticated`. No
-- pre-auth carve-out is needed here (nothing in this file is a pre-auth
-- surface).
--
-- ----------------------------------------------------------------------------
-- §8.1 checklist waivers
-- ----------------------------------------------------------------------------
-- Staging-rehearsal line waived per the R6 go-forward rule: no staging clone
-- exists; a fresh local `db reset` over **001–063** plus the full pgTAP suite
-- is the recorded rehearsal evidence. Realtime Broadcast-from-DB line waived
-- per D38 (no live subscriber in the M1 UI slice — F8). Typegen RE-RUN (R68:
-- five new PostgREST-exposed functions change the generated surface) with the
-- hand-written alias block re-appended and the diff verified additive-only.
-- Prod-safety (F12): prod's migration history still ends at 036, so nothing
-- here can reach production ahead of the whole league chain; within the chain
-- this migration is additive (new functions, two CHECKs and one partial
-- unique index on tables holding only league rows created by 060+, two policy
-- DROPs on a table with no client writers left).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Integrity constraints (R43 class — see Contents 0)
-- ----------------------------------------------------------------------------
ALTER TABLE league_members
  ADD CONSTRAINT league_members_role_valid
    CHECK (role IN ('commissioner', 'co_commissioner', 'manager'));

-- §7.2 "Exactly one commissioner" — the DB half. set_member_role's transfer
-- is ordered demote-then-promote so this never trips on the sanctioned path.
CREATE UNIQUE INDEX one_commissioner_per_league
  ON league_members (league_id)
  WHERE role = 'commissioner';

ALTER TABLE team_managers
  ADD CONSTRAINT team_managers_end_reason_valid
    CHECK (end_reason IS NULL
           OR end_reason IN ('kicked', 'left', 'seat_retired', 'replaced'));

ALTER TABLE team_managers
  ADD CONSTRAINT team_managers_role_valid
    CHECK (role IN ('manager'));

-- ----------------------------------------------------------------------------
-- 1. league_members is SELECT-only on the client (see Contents 1; Q8/D74(3))
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Commish adds placeholder seats" ON league_members;
DROP POLICY IF EXISTS "Commish removes placeholder seats" ON league_members;
-- Remaining policy: "Members viewable by league members" (SELECT). Seats are
-- added by add_placeholder_seat and removed/vacated by remove_manager —
-- both of which keep the franchise, the capacity count and the stint history
-- coherent in one transaction.

-- ----------------------------------------------------------------------------
-- 2. notify_league_member_internal — guarded notification insert (INTERNAL)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_league_member_internal(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_data JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (p_user_id, p_type, p_title, p_body, p_data);
EXCEPTION WHEN OTHERS THEN
  NULL; -- never break a membership write over a notification (062:397)
END;
$$;

REVOKE EXECUTE ON FUNCTION notify_league_member_internal(UUID, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. add_placeholder_seat — §15.1 POST /api/leagues/[id]/members
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_placeholder_seat(
  p_league_id UUID,
  p_team_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_seated INTEGER;
  v_team_id UUID;
  v_member_id UUID;
  v_name TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'add_placeholder_seat: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  -- In-body authorization (§12.0/§8.3). A nonexistent league yields FALSE
  -- here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'add_placeholder_seat: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the league row FIRST (lock order leagues → teams) — this is also
  -- what serializes the capacity check against concurrent joins/claims.
  SELECT l.id, l.status, l.team_count, l.faab_budget INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'add_placeholder_seat: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_league.status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION 'add_placeholder_seat: seats can only be added before the draft starts (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Capacity (D47/F28): the ONE predicate, byte-for-byte identical to
  -- 061's shrink floor and 062's join/claim checks, evaluated under the lock.
  SELECT count(*)::int INTO v_seated
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_seated >= v_league.team_count THEN
    RAISE EXCEPTION 'add_placeholder_seat: this league already has all % seats — raise team_count first', v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  -- Franchise name contract (D74(5)): caller-supplied, else "Team N".
  v_name := COALESCE(NULLIF(btrim(p_team_name), ''), 'Team ' || (v_seated + 1)::text);

  -- §7.2:170 shape: a teams row owned by the commissioner (list_id NULL —
  -- D35a), NO stint (team_managers.user_id is NOT NULL by design).
  INSERT INTO public.teams (owner_id, name, league_id, list_id)
  VALUES (v_uid, v_name, p_league_id, NULL)
  RETURNING id INTO v_team_id;

  -- Cache row: team_id SET (the seat IS a franchise), is_placeholder set
  -- EXPLICITLY, faab seeded from the current budget (§12.2).
  INSERT INTO public.league_members
    (league_id, user_id, team_id, role, is_placeholder, faab_balance)
  VALUES
    (p_league_id, NULL, v_team_id, 'manager', TRUE, v_league.faab_budget)
  RETURNING id INTO v_member_id;

  RETURN jsonb_build_object(
    'member_id', v_member_id,
    'team_id', v_team_id,
    'team_name', v_name,
    'seats_filled', v_seated + 1,
    'team_count', v_league.team_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION add_placeholder_seat(UUID, TEXT) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 4. set_member_role — §15.1 PATCH /api/leagues/[id]/members/[mid]
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_member_role(
  p_league_id UUID,
  p_member_id UUID,
  p_role TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_target RECORD;
  v_actor_role TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'set_member_role: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'set_member_role: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.id, l.owner_id INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_member_role: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('commissioner', 'co_commissioner', 'manager') THEN
    RAISE EXCEPTION 'set_member_role: role must be commissioner, co_commissioner, or manager'
      USING ERRCODE = '22023';
  END IF;

  -- The member must belong to THIS league (the nested route's [id] segment
  -- is load-bearing — R86); a member of another league is indistinguishable
  -- from a nonexistent one.
  SELECT lm.id, lm.user_id, lm.role INTO v_target
  FROM public.league_members lm
  WHERE lm.id = p_member_id AND lm.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_member_role: no such member in this league'
      USING ERRCODE = '42501';
  END IF;

  -- The ACTOR's exact role: is_league_commish cannot tell a commissioner
  -- from a co-commissioner, and three rules below depend on the difference.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;

  IF v_target.user_id IS NULL THEN
    RAISE EXCEPTION 'set_member_role: that seat has no manager yet — invite or assign someone first'
      USING ERRCODE = 'P0001';
  END IF;

  -- §7.2 anti-coup: "The original creator can never be removed by a
  -- co-commissioner." Keyed on leagues.owner_id (the CREATOR record), never
  -- on role — after a transfer the creator may hold any role.
  IF v_actor_role = 'co_commissioner' AND v_target.user_id = v_league.owner_id THEN
    RAISE EXCEPTION 'set_member_role: only the commissioner can change the league creator''s role (§7.2)'
      USING ERRCODE = '42501';
  END IF;

  -- The sitting commissioner's row moves ONLY by transfer — a demote would
  -- leave the league headless and break "exactly one commissioner".
  IF v_target.role = 'commissioner' THEN
    RAISE EXCEPTION 'set_member_role: the commissioner role moves by transferring it — promote another member to commissioner instead (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_role = 'commissioner' THEN
    -- ATOMIC TRANSFER (D74(4)), sitting commissioner only. Demote first so
    -- one_commissioner_per_league never sees two rows.
    IF v_actor_role IS DISTINCT FROM 'commissioner' THEN
      RAISE EXCEPTION 'set_member_role: only the sitting commissioner can transfer the commissioner role (§7.2)'
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.league_members
    SET role = 'co_commissioner'
    WHERE league_id = p_league_id AND user_id = v_uid;
    UPDATE public.league_members
    SET role = 'commissioner'
    WHERE id = p_member_id;
    RETURN jsonb_build_object(
      'member_id', p_member_id, 'role', 'commissioner', 'transferred', true);
  END IF;

  -- Idempotent no-op (D63): setting the role a member already holds.
  IF v_target.role = p_role THEN
    RETURN jsonb_build_object(
      'member_id', p_member_id, 'role', p_role, 'transferred', false);
  END IF;

  UPDATE public.league_members
  SET role = p_role
  WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'member_id', p_member_id, 'role', p_role, 'transferred', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_member_role(UUID, UUID, TEXT) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 5. assign_manager — §15.1 POST /api/leagues/[id]/teams/[tid]/assign-manager
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_manager(
  p_league_id UUID,
  p_team_id UUID,
  p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_team RECORD;
  v_open_stint UUID;
  v_existing RECORD;
  v_member_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'assign_manager: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'assign_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.id, l.faab_budget INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_manager: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'assign_manager: user_id is required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_manager: no such FieldScout account'
      USING ERRCODE = 'P0001';
  END IF;

  -- teams AFTER leagues (lock order), scoped to this league (R86).
  SELECT t.id, t.status INTO v_team
  FROM public.teams t
  WHERE t.id = p_team_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_manager: that franchise is not part of this league'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'assign_manager: that franchise is retired — its seat is sealed (§7.2.1)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Already seated somewhere in this league? UNIQUE(league_id, user_id)
  -- would otherwise surface as an opaque 23505.
  SELECT lm.id, lm.team_id INTO v_existing
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = p_user_id;
  IF FOUND THEN
    IF v_existing.team_id = p_team_id THEN
      -- Idempotent (D63): already this franchise's manager.
      RETURN jsonb_build_object(
        'member_id', v_existing.id, 'team_id', p_team_id, 'already_seated', true);
    END IF;
    RAISE EXCEPTION 'assign_manager: that manager already has a team in this league — remove them from it first'
      USING ERRCODE = 'P0001';
  END IF;

  -- An occupied seat is never silently taken over: that would close the
  -- incumbent's stint with no outcome category and no notification.
  SELECT tm.id INTO v_open_stint
  FROM public.team_managers tm
  WHERE tm.team_id = p_team_id AND tm.ended_at IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'assign_manager: that franchise already has a manager — remove them first (§7.2.1 takeover/vacate)'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    -- The ONE seating implementation (062, p_team_id path): stint first,
    -- placeholder FILL, owner_id + orphan resolution, faab re-seeded from
    -- the CURRENT budget.
    PERFORM public.seat_league_member_internal(
      p_league_id, p_user_id, v_league.faab_budget, p_team_id);
  EXCEPTION WHEN unique_violation THEN
    -- Lost the race against an in-flight claim on the same franchise (I6):
    -- friendly, never a raw 23505 → 500.
    RAISE EXCEPTION 'assign_manager: that seat was just claimed by someone else — refresh and try again'
      USING ERRCODE = 'P0001';
  END;

  SELECT lm.id INTO v_member_id
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = p_user_id;

  RETURN jsonb_build_object(
    'member_id', v_member_id, 'team_id', p_team_id, 'already_seated', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION assign_manager(UUID, UUID, UUID) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 6. remove_manager — §15.1 DELETE /api/leagues/[id]/members/[mid]
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_manager(
  p_league_id UUID,
  p_member_id UUID,
  p_mode TEXT,
  p_successor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_target RECORD;
  v_actor_role TEXT;
  v_team RECORD;
  v_removed_user UUID;
  v_team_name TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'remove_manager: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'remove_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.id, l.name, l.owner_id, l.faab_budget INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('takeover', 'retire', 'vacate') THEN
    RAISE EXCEPTION 'remove_manager: mode must be takeover, retire, or vacate (§7.2.1)'
      USING ERRCODE = '22023';
  END IF;

  SELECT lm.id, lm.user_id, lm.team_id, lm.role INTO v_target
  FROM public.league_members lm
  WHERE lm.id = p_member_id AND lm.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: no such member in this league'
      USING ERRCODE = '42501';
  END IF;

  -- D42: retire-and-succeed needs the successor-franchise machinery (M4).
  -- Refuse BEFORE any write — this mode writes nothing in M1 (F31).
  IF p_mode = 'retire' THEN
    RAISE EXCEPTION 'remove_manager: retiring a franchise isn''t available before the draft — use takeover or vacate (§7.2.1; retire-and-succeed arrives with the in-season milestone)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;

  -- §7.2 anti-coup (keyed on the CREATOR, not on role).
  IF v_actor_role = 'co_commissioner'
     AND v_target.user_id IS NOT NULL
     AND v_target.user_id = v_league.owner_id THEN
    RAISE EXCEPTION 'remove_manager: only the commissioner can remove the league creator (§7.2)'
      USING ERRCODE = '42501';
  END IF;

  -- Never leave the league headless (§7.2 "Exactly one commissioner").
  IF v_target.role = 'commissioner' THEN
    RAISE EXCEPTION 'remove_manager: transfer the commissioner role to another member before removing this manager (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_target.user_id IS NULL THEN
    IF p_mode = 'vacate' THEN
      -- Idempotent (D63): the seat is already an open placeholder.
      RETURN jsonb_build_object(
        'ok', true, 'mode', p_mode, 'member_id', v_target.id,
        'team_id', v_target.team_id, 'already_vacant', true);
    END IF;
    RAISE EXCEPTION 'remove_manager: that seat has no manager — use assign-manager to seat someone on it'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_target.team_id IS NULL THEN
    RAISE EXCEPTION 'remove_manager: that membership has no franchise to act on'
      USING ERRCODE = 'P0001';
  END IF;

  -- teams AFTER leagues (lock order).
  SELECT t.id, t.name, t.status INTO v_team
  FROM public.teams t
  WHERE t.id = v_target.team_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: that membership has no franchise to act on'
      USING ERRCODE = 'P0001';
  END IF;

  v_removed_user := v_target.user_id;
  v_team_name := v_team.name;

  IF p_mode = 'takeover' THEN
    IF p_successor_user_id IS NULL THEN
      RAISE EXCEPTION 'remove_manager: takeover requires successor_user_id (§15.1)'
        USING ERRCODE = '22023';
    END IF;
    IF p_successor_user_id = v_removed_user THEN
      RAISE EXCEPTION 'remove_manager: the successor must be a different manager — use vacate to open the seat'
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM public.profiles p WHERE p.id = p_successor_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'remove_manager: no such FieldScout account for the successor'
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM public.league_members lm
    WHERE lm.league_id = p_league_id AND lm.user_id = p_successor_user_id;
    IF FOUND THEN
      RAISE EXCEPTION 'remove_manager: the successor already has a team in this league'
        USING ERRCODE = 'P0001';
    END IF;

    -- CLOSE BEFORE OPEN, same txn (F3). A missing open stint is a no-op,
    -- not an error (D63 — a retry after a partially-observed removal).
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = NULL,            -- preseason (§12.22)
        end_reason = 'replaced',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- The cache row is UPDATEd IN PLACE — one league_members row per seat,
    -- always (§12.2). faab re-seeded from the CURRENT budget (v2.8.7).
    UPDATE public.league_members
    SET user_id = p_successor_user_id,
        is_placeholder = FALSE,
        role = 'manager',             -- powers never inherit with a seat
        faab_balance = v_league.faab_budget
    WHERE id = v_target.id;

    -- Successor's stint (clock_timestamp — F3: never reuses a started_at).
    INSERT INTO public.team_managers (league_id, team_id, user_id, role, started_at)
    VALUES (p_league_id, v_team.id, p_successor_user_id, 'manager', clock_timestamp());

    UPDATE public.teams
    SET owner_id = p_successor_user_id,
        status = CASE WHEN status = 'orphaned' THEN 'active' ELSE status END,
        updated_at = now()
    WHERE id = v_team.id;
  ELSE
    -- vacate (§7.2.1(c)) — the stint closes with no successor.
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = NULL,
        end_reason = 'kicked',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,        -- back to an open seat, team_id KEPT
        role = 'manager',
        faab_balance = v_league.faab_budget
    WHERE id = v_target.id;

    -- 'orphaned', never 'retired': every capacity count is
    -- `status <> 'retired'`, so retiring would silently free a seat.
    -- owner_id moves to the acting commissioner (NOT NULL; leaving it on the
    -- removed user would let their profile deletion CASCADE the franchise).
    UPDATE public.teams
    SET status = 'orphaned',
        owner_id = v_uid,
        updated_at = now()
    WHERE id = v_team.id;
  END IF;

  -- §7.2.1:191 — the removed user is notified with the outcome category.
  PERFORM public.notify_league_member_internal(
    v_removed_user,
    'league_member',
    'You were removed from ' || v_league.name,
    CASE WHEN p_mode = 'takeover'
      THEN v_team_name || ' has a new manager. Your record with the franchise stays in its history.'
      ELSE 'Your seat in ' || v_league.name || ' (' || v_team_name || ') was closed by the commissioner.'
    END,
    jsonb_build_object(
      'league_id', p_league_id,
      'team_id', v_team.id,
      'event', CASE WHEN p_mode = 'takeover' THEN 'replaced' ELSE 'removed' END));

  RETURN jsonb_build_object(
    'ok', true, 'mode', p_mode, 'member_id', v_target.id,
    'team_id', v_team.id, 'removed_user_id', v_removed_user,
    'successor_user_id', CASE WHEN p_mode = 'takeover' THEN p_successor_user_id ELSE NULL END,
    'already_vacant', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_manager(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 7. leave_league — §7.2.1:193 (routed through DELETE .../members/[mid] when
--    [mid] is the caller's own membership — D74(8); §15.1 prints no /leave)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION leave_league(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_self RECORD;
  v_team RECORD;
  v_others INTEGER;
  v_commish UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'leave_league: must be signed in'
      USING ERRCODE = '42501';
  END IF;

  -- League row FIRST: reading the caller's role under the lock means a
  -- concurrent transfer cannot make them commissioner between check and
  -- write.
  SELECT l.id, l.name, l.faab_budget INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT lm.id, lm.user_id, lm.team_id, lm.role INTO v_self
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: not a member of this league'
      USING ERRCODE = '42501';
  END IF;

  IF v_self.role = 'commissioner' THEN
    SELECT count(*)::int INTO v_others
    FROM public.league_members lm
    WHERE lm.league_id = p_league_id AND lm.user_id IS NOT NULL AND lm.user_id <> v_uid;
    IF v_others = 0 THEN
      -- The sole member of a league IS its commissioner, with nobody to
      -- transfer to — point at deletion rather than stranding them.
      RAISE EXCEPTION 'leave_league: you are this league''s only manager — delete the league instead of leaving it (§15.1)'
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'leave_league: transfer the commissioner role to another member before leaving (§7.2.1)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_self.team_id IS NULL THEN
    RAISE EXCEPTION 'leave_league: your membership has no franchise to hand back'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.name INTO v_team
  FROM public.teams t
  WHERE t.id = v_self.team_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_league: your membership has no franchise to hand back'
      USING ERRCODE = 'P0001';
  END IF;

  -- Same flow as vacate (§7.2.1:193), with end_reason='left' and ended_by
  -- = self. The leaver does not choose the franchise's outcome — the spec
  -- names no chooser for the voluntary path.
  UPDATE public.team_managers
  SET ended_at = now(),
      ended_week = NULL,
      end_reason = 'left',
      ended_by = v_uid
  WHERE team_id = v_team.id AND ended_at IS NULL;

  UPDATE public.league_members
  SET user_id = NULL,
      is_placeholder = TRUE,
      role = 'manager',
      faab_balance = v_league.faab_budget
  WHERE id = v_self.id;

  -- The franchise passes to the sitting commissioner (owner_id is NOT NULL).
  SELECT lm.user_id INTO v_commish
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.role = 'commissioner' AND lm.user_id IS NOT NULL;

  UPDATE public.teams
  SET status = 'orphaned',
      owner_id = COALESCE(v_commish, owner_id),
      updated_at = now()
  WHERE id = v_team.id;

  -- The commissioner is the party who needs to act on an open seat.
  PERFORM public.notify_league_member_internal(
    v_commish,
    'league_member',
    'A manager left ' || v_league.name,
    v_team.name || ' is open — invite a replacement or assign a manager.',
    jsonb_build_object(
      'league_id', p_league_id, 'team_id', v_team.id, 'event', 'left'));

  RETURN jsonb_build_object(
    'ok', true, 'league_id', p_league_id, 'team_id', v_team.id,
    'member_id', v_self.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_league(UUID) FROM PUBLIC, anon;
