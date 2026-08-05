-- ============================================================================
-- Draft completion → `league_rosters` + `in_season` + the real autodraft
-- toggle — migration 072 (task L.B1.7; spec §8.5 step 6, §12.7, §12.2
-- (`is_autodraft`), §12.14 (the league_rosters trigger row), §8.4
-- ("Commissioner can toggle it for any team") / §8.7 ("Toggle autopick for
-- any team"), §15.1 members-PATCH + §15.2 autodraft, E48; tasks-M2 §3
-- D88/D96/D97 + §4 standing rules; PROGRESS D88/D97/D102/F33/F40/F42).
--
-- What ships here:
--   1. `league_rosters` — §12.7 VERBATIM (D88: §18 Phase B's gate wins the
--      Phase B/D sequencing contradiction — table + the COMPLETION writer
--      ship in M2; every in-season writer (add/drop/trade/commish move,
--      `slot_key` management, IR tenure) is M4+'s). `slot_key` /
--      `ir_placed_week` / `ir_lock_until_week` ship as printed and stay
--      NULL in M2. The `UNIQUE(league_id, player_id)` exclusivity
--      constraint, the member SELECT policy, NO client write policy, and
--      BOTH printed indexes — exactly the §12.7 block.
--   2. THE COMPLETION PATH — amended into 066's
--      `draft_apply_pick_internal` IN PLACE (F12 unreleased-chain
--      precedent; 066's completion block carries the matching
--      cross-reference). The final live pick of a NON-mock draft now, in
--      ONE transaction: `drafts.status='complete'` → `league_rosters`
--      populated from the draft's non-undone picks
--      (`acquisition_type='draft'`, `acquisition_cost` NULL for snake —
--      D88; the auction engine writes `price` here in M3) →
--      `leagues.status='in_season'` (§8.5 step 6). Because the tick's
--      autopick, the commissioner force path, and manual picks ALL write
--      through that one internal, the completion arm is the same for every
--      finisher (D90 — one advance path). The D43 snapshot guard on
--      `leagues` fires on the 'in_season' UPDATE and HOLDS: the snapshot
--      has existed since `draft_start` (059's sanctioned window) — pinned
--      in pgTAP 026, not merely asserted. THE MOCK BRANCH BYPASSES ALL OF
--      IT (`is_mock` guard): a completed mock is `drafts.complete` + recap
--      retention only — no rosters, no league transition (§8.8's
--      zero-side-effect contract, re-pinned here FROM THE COMPLETION SIDE
--      in 026 §E and re-pinned in 025's diff cell, amended in place).
--      Function-order note: 066 (re)creates the amended internal BEFORE
--      this migration creates `league_rosters` — legal because plpgsql
--      resolves table references at execution, and nothing executes the
--      internal during the migration chain.
--      Lock/deadlock note (§4.6 + the 066 R122 analysis): the completion
--      arm updates the LEAGUES row while holding the drafts-row lock
--      (drafts → leagues — the same order draft_reset takes, 069). No
--      cycle with draft_start's leagues → drafts order: under a live
--      draft, draft_start's idempotent arm returns off a PLAIN drafts read
--      without ever taking the drafts lock (066's R122 block), and every
--      other draft RPC locks drafts first. The RI FOR KEY SHARE the picks
--      INSERT takes on leagues does not conflict with FOR NO KEY UPDATE
--      (the UPDATE's lock class).
--      Broadcast burst residual (recorded): completion emits one
--      `league_rosters` INSERT event per roster row (teams × rounds; ≤ 240
--      at v1 max) inside the completion txn — a once-per-league-lifetime
--      burst of sub-ms realtime.send() calls; clients treat events as
--      cache hints and refetch (§9). The leagues UPDATE also fires 070's
--      status-column trigger — the home hero / draft bar flip rides the
--      existing `league:<id>` event, nothing new owed.
--   3. (task item 3b) The `league_rosters` BROADCAST TRIGGER — §12.14's
--      inventory row ("at table creation … migration 072") — so F42 never
--      needs to carry this table: one column-selected payload fn + one
--      §9.2-pattern trigger fn (SECURITY DEFINER, search_path='') on
--      AFTER INSERT OR UPDATE, topic `league:<league_id>` (070's
--      draft_picks shape; the 070 engineering adaptation applies —
--      realtime.send() with the {operation, table, schema, record}
--      envelope and a COLUMN-SELECTED record). Payload = what the M2/M4
--      roster surfaces render: id (list key), team_id, player_id,
--      slot_key, acquisition_type, acquired_at. NOT broadcast: league_id
--      (topic-derivable), acquisition_cost (auction — M3 extends when it
--      writes price), ir_placed_week/ir_lock_until_week (M4 extends when
--      its IR surface renders them — recorded, not forgotten). DELETE
--      events: no M2/M3 writer deletes roster rows; M4's drop/trade
--      writers extend the trigger when they land (their milestone owns its
--      own surface — the D109 class, not an F-row).
--   4. `set_team_autodraft(p_league_id, p_team_id, p_on, p_reason)` — the
--      REAL toggle behind §12.2's `is_autodraft` (052's column was always
--      real; nothing DB-side is replaced). Callable by the seat's own
--      manager (§8.4 "Managers can toggle 'Auto-draft me'" — the
--      league_members current-state cache IS the open-stint truth, §12.2
--      v2.1) or by a commissioner/co-commissioner for ANY team (§8.4 /
--      §8.7 "Toggle autopick for any team"). The COMMISSIONER path is a
--      §8.7 control and gets the full D97 treatment: `p_reason` accepted +
--      stored nowhere (F32/F40 — the audit row is M6's), and an in-txn
--      `league_chat` system post WHEN A LIVE (live/paused, non-mock) DRAFT
--      EXISTS — the room sees the override happen (§16.3). The SELF path
--      posts nothing (toggling yourself is not an override). D63 no-op:
--      re-setting the current value returns changed=false and posts
--      nothing. Lock discipline (§4.6): when a live/paused non-mock draft
--      exists it is locked FOR UPDATE before the member write — the flag
--      flip and its post serialize against the tick's ARM-2 is_autodraft
--      read and every in-flight pick (drafts → league_members, the same
--      order the tick reads in). Mocks are irrelevant here by
--      construction: 068's mock seat-derivation hard-codes
--      is_autodraft=FALSE, and the toggle looks only at non-mock drafts.
--      SQLSTATE per the 063 convention: 42501 auth/no-leak (nonexistent
--      league == non-member == neither-self-nor-commish) · P0002 → 404
--      (soft-deleted league, unknown team) · 22023 arg shape.
--      F33: THIS is the RPC half; the service/route half (members-service
--      PATCH + POST …/draft/autodraft) lands in L.B2.2, which flips F33.
--   5. E48 end-to-end: NO new code — 026 §F proves the composition this
--      task owns: 063's `remove_manager(vacate)` mid-draft (permitted —
--      the league lock, not a status gate) leaves the seat with no user →
--      068's ARM 2 classifies it a no-user seat and autopicks AT the
--      deadline, no grace hold (D102/§8.5.5 — the hold is for humans);
--      062's seat-targeted `create_league_invite` + `claim_league_invite`
--      is STATUS-UNRESTRICTED (the §7.2.1 replacement-GM path) → the
--      claimer is seated mid-draft and `draft_make_pick` accepts them
--      (manual control restored, E48/E3).
--
-- RLS/grants doctrine (tasks-M1 §4.1, D18→D23): `league_rosters` rides
-- 037's schema-wide SELECT grants — RLS is the gate; NO client write
-- policy exists (writes only via SECURITY DEFINER RPCs, §12.7's comment).
-- `set_team_autodraft` keeps EXECUTE for authenticated (in-body auth is
-- the gate), REVOKEd from PUBLIC/anon; the payload fn is a plain internal
-- under the 062-form triple REVOKE; the trigger fn fires as owner and is
-- triple-REVOKEd as hygiene (070's form).
--
-- Amended in place alongside this migration (F12, unreleased chain):
--   * 066 `draft_apply_pick_internal` — the completion arm (item 2).
--   * pgTAP 020 — the "league deliberately STAYS drafting" pin FLIPS to
--     'in_season' (the pin 020's own text promised 072 would flip).
--   * pgTAP 025 — the zero-side-effect league_rosters cell upgrades from
--     "table does not exist" to a real row-count-still-zero pin (the
--     re-pin 025's own text scheduled for this task).
--
-- Staging rehearsal: R6 waiver — no staging clone exists (local + prod
-- only); rehearsal evidence = the fresh local `npx supabase db reset`
-- replay of 001–072 + pgTAP 019–026 in this PR's session log.
-- Typegen: RE-RUN (new table + one new PostgREST-exposed function); the
-- hand-written alias block re-appended byte-identical + `LeagueRoster`
-- added (additive-only diff attested in the PR).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `league_rosters` — §12.7 verbatim (D88)
-- ---------------------------------------------------------------------------

CREATE TABLE league_rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  slot_key TEXT,                                   -- current slot assignment for the active week (qb, rb, flex, bn, ir, ...) — M4 manages
  acquisition_type TEXT DEFAULT 'draft',           -- draft | waiver | free_agent | trade | commissioner
  acquisition_cost INTEGER DEFAULT 0,              -- FAAB/auction spend if applicable (NULL for snake draft rows — D88)
  ir_placed_week INTEGER,                          -- NFL week the player entered an IR spot (NULL if not on IR) — M4 manages
  ir_lock_until_week INTEGER,                      -- restricted IR: earliest week the manager may remove them (NULL = unrestricted / not on IR) — M4 manages
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, player_id)                     -- ENFORCES player exclusivity within a league
);
ALTER TABLE league_rosters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rosters viewable by league members"
  ON league_rosters FOR SELECT USING (is_league_member(league_id));
-- Writes via RPCs (M2: the completion arm; M4+: add/drop/trade/commish
-- move) so exclusivity + caps are enforced atomically — NO client write
-- policy (§12.7).
CREATE INDEX idx_league_rosters_team ON league_rosters(team_id);
CREATE INDEX idx_league_rosters_league ON league_rosters(league_id);

-- ---------------------------------------------------------------------------
-- 2. Broadcast-from-DB (§12.14 row / task item 3b; the 070 pattern)
-- ---------------------------------------------------------------------------

-- Column-selected payload (§9.2 "nothing blind" — the exact key set +
-- named negatives are pinned in 026 §B; see the banner for what is
-- deliberately excluded and which milestone extends it).
CREATE OR REPLACE FUNCTION league_roster_broadcast_payload(r league_rosters)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',               r.id,
    'team_id',          r.team_id,
    'player_id',        r.player_id,
    'slot_key',         r.slot_key,
    'acquisition_type', r.acquisition_type,
    'acquired_at',      r.acquired_at);
$$;

REVOKE EXECUTE ON FUNCTION league_roster_broadcast_payload(league_rosters)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION broadcast_league_roster_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.league_roster_broadcast_payload(NEW)),
    'league_rosters',
    'league:' || NEW.league_id::text,
    true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_league_roster_change()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_league_rosters
  AFTER INSERT OR UPDATE ON league_rosters
  FOR EACH ROW EXECUTE FUNCTION broadcast_league_roster_change();

-- ---------------------------------------------------------------------------
-- 3. The completion path — see 066's `draft_apply_pick_internal`, amended
--    in place (F12; banner item 2). Nothing to execute here: the amended
--    internal references this table late-bound.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. set_team_autodraft — §8.4/§8.7's toggle over §12.2's is_autodraft
--    (F33's RPC half; the D97 commissioner path)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_team_autodraft(
  p_league_id UUID,
  p_team_id UUID,
  p_on BOOLEAN,
  p_reason TEXT DEFAULT NULL   -- accepted, stored nowhere (F32/F40 — audit rows are M6's)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       UUID;
  v_draft     public.drafts;
  v_seat      public.league_members;
  v_is_self   BOOLEAN;
  v_team_name TEXT;
  v_posted    BOOLEAN := FALSE;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_league_id IS NULL OR p_team_id IS NULL OR p_on IS NULL THEN
    RAISE EXCEPTION 'set_team_autodraft: league_id, team_id, and on are required'
      USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();

  -- No-leak floor: nonexistent league and non-member answer the same 42501
  -- (is_league_member(unknown) is FALSE).
  IF v_uid IS NULL OR NOT public.is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'set_team_autodraft: not a member of this league'
      USING ERRCODE = '42501';
  END IF;

  -- A soft-deleted league answers 404 for a legitimate member (063 rule).
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = p_league_id AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'set_team_autodraft: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- §4.6: when a live/paused NON-mock draft exists, take ITS row lock
  -- FIRST — the flag flip (and the D97 post) serialize against the tick's
  -- ARM-2 is_autodraft read and any in-flight pick. drafts →
  -- league_members is the tick's own read order (no cycle; see the
  -- banner). Mocks never read is_autodraft (068 hard-codes FALSE) and are
  -- excluded here.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('live', 'paused')
  FOR UPDATE;

  -- The seat = the league_members row carrying this franchise (§12.2's
  -- current-state cache — the open-stint truth, v2.1). Read AFTER the
  -- draft lock so the no-op decision is serialized too.
  SELECT m.* INTO v_seat
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_team_autodraft: team % has no seat in league %',
      p_team_id, p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Authorization: the seat's own manager (§8.4 "Auto-draft me") or a
  -- commissioner/co-commissioner for any team (§8.4/§8.7). A commissioner
  -- toggling their OWN seat is the self path (no override, no post).
  v_is_self := (v_seat.user_id IS NOT NULL AND v_seat.user_id = v_uid);
  IF NOT v_is_self AND NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION
      'set_team_autodraft: only that seat''s manager or a commissioner can toggle autodraft (§8.4)'
      USING ERRCODE = '42501';
  END IF;

  -- D63 no-op: re-setting the current value changes nothing and posts
  -- nothing (a double-tapped toggle must not spam the room).
  IF COALESCE(v_seat.is_autodraft, FALSE) = p_on THEN
    RETURN jsonb_build_object(
      'member_id', v_seat.id, 'team_id', p_team_id,
      'is_autodraft', p_on, 'changed', FALSE, 'posted', FALSE);
  END IF;

  UPDATE public.league_members
  SET is_autodraft = p_on
  WHERE id = v_seat.id;

  -- The D97 commissioner-path system post — in-txn, only when the room
  -- exists to see it (a live/paused non-mock draft; locked above). The
  -- self path posts nothing.
  IF NOT v_is_self AND v_draft.id IS NOT NULL THEN
    SELECT t.name INTO v_team_name
    FROM public.teams t WHERE t.id = p_team_id;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (
      p_league_id, v_uid,
      'Autopick turned ' || CASE WHEN p_on THEN 'on' ELSE 'off' END
        || ' for ' || COALESCE(v_team_name, 'a team')
        || ' by ' || public.draft_actor_name() || '.',
      'draft:' || v_draft.id::text, TRUE);
    v_posted := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'member_id', v_seat.id, 'team_id', p_team_id,
    'is_autodraft', p_on, 'changed', TRUE, 'posted', v_posted);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_team_autodraft(UUID, UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
