-- ============================================================================
-- 176 — a team is never retired: "retire & succeed" is removed (M6 L.E1.42;
--       FULL rigour — standings, history, commissioner permissions)
--       (spec §7.2.1, §12.22, §15.1; PROGRESS D461 (retire parts superseded),
--        D467, F548 (moot), Q41 (moot); standing rules (a), (f))
-- ============================================================================
--
-- THE RULING (Chris, 2026-10-01, in chat — verbatim):
--   "you can't simply retire a Team, you can change the manager but the Team
--    lives. … Just like a sports franchise can change owners, it can change
--    names, but the underlying franchise survives."
--   "No you can't reset records mid season due to a team manager change,
--    thats not something that works functionally for the rest of the league."
--   Asked whether to drop retire: "yes drop it"
-- So when a manager goes there are exactly two outcomes — TAKEOVER (a new
-- manager inherits the team whole) and VACATE (the team stays; the
-- commissioner manages it). No retire, no successor team, in any state.
--
-- THE CHANGE — `remove_manager` only, `CREATE OR REPLACE` against its NEWEST
-- defining migration's FILE TEXT (D137; CLAUDE.md's 073 lesson). Newest
-- definer MEASURED over 001–175 (grep `FUNCTION[^(]*remove_manager`):
-- 063 → 120 → 146 → 150 → 169 → 173; 174 / 175 do not define it. Source is
-- 173:77-614, extracted programmatically (derive_176.py); three hunks applied
-- by exact-match replacement (each hits once; pgTAP 124's pg_temp.un176
-- reverses them to 173's text byte for byte — A2 pins it in the database):
--   H1 (+1 / -1)   — the bad-mode sentence names the two outcomes.
--   H2 (+24 / -60) — the retire pre-block (status gate, own-seat guard,
--       action_id requirement, reason normalisation, replay) becomes: the
--       REPLAY of a retirement committed before 176 (same lookup, same
--       byte-identical stored payload — L.D3.16's "refusal after the replay"
--       shape), then a refusal BY NAME in every league state, P0001:
--         "remove_manager: a team can't be retired — seat a new manager or
--          leave it vacant (§7.2.1)"
--       'retire' stays in the accepted mode list ON PURPOSE so it reaches
--       this sentence instead of the generic bad-mode refusal.
--   H3 (+0 / -180) — the retire ARM (the lineage walk, the seal, the minted
--       successor team, the roster / lineup / matchup / result re-point, the
--       ledger row, the post) is deleted. It was the ONE writer of
--       `teams.status = 'retired'` and `teams.successor_team_id` in the
--       chain (grep of 120+ for both assignments: 120 / 146 / 150 / 169 /
--       173, all remove_manager bodies; no script, no sim, no route writes
--       either — D53: the columns have no client writer).
-- Left byte-identical, now unreachable for 'retire' (H2 returns or raises
-- first): the `p_mode <> 'retire'` in the unmanaged-seat guard and the
-- `retire` branches of the receipt / notification CASEs and the final
-- `IF p_mode = 'retire' THEN RETURN v_result`. Deleting them changes no
-- behaviour any test could observe — an unfalsifiable hunk — so they stay
-- (and keep the reversal small). The retire-only DECLAREs stay for the same
-- reason.
--
-- LEFT IN PLACE, ON PURPOSE (the schema stays additive-safe — production
-- measured 2026-10-01 by the orchestrator, read-only: 0 teams with
-- status = 'retired', 0 with successor_team_id):
--   * teams.status CHECK keeps 'retired'; teams.retired_at_week and
--     teams.successor_team_id stay (an old row could hold them; the history
--     reads, the scoring worker's lineage walk and `status <> 'retired'`
--     capacity counts read them and are harmless on rows that never hold
--     them).
--   * team_managers.end_reason CHECK keeps 'seat_retired'.
--   * `commissioner_actions.action_type` 'retire_franchise' and the
--     `transactions` commissioner_move payload verb 'retire_franchise' —
--     receipts are immutable (§12.12) and still render readably.
--   * The signature (p_action_id included — the replay key) and the ACL.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Replaced: 1 body (signature, volatility, SECURITY DEFINER, search_path ''
--   and the ACL unchanged — the REVOKE is restated verbatim). No table,
--   column, index, policy, trigger or cron row. Time: none new. Typegen: no
--   change (no signature moved). Realtime: none new.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–176 and the full pgTAP run in the PR. D38 — no backfill:
--   production holds no retired team and no successor (measured).
--   DEGRADE-BEFORE-PUSH: main deploys before 176 is pushed; the app stops
--   offering retire and its route refuses mode 'retire' with a 400 itself,
--   so the pre-176 body is never asked to retire.
-- Rollback = re-apply 173:77-614 verbatim.
--
-- Proof: pgTAP 124 (form; D137 in the database; retire refused by name in
-- every league state with nothing written; a pre-176 retirement replays;
-- takeover / vacate unchanged). 068 / 117 / 121 / 118 re-cut (cells named
-- in the PR). Break probes shown red then reverted in the PR.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- remove_manager — 173:77-614's FILE TEXT (D137), 3 hunks (+25 / -241).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_manager(
  p_league_id UUID,
  p_member_id UUID,
  p_mode TEXT,
  p_successor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_action_id UUID DEFAULT NULL      -- 120: the retire arm's idempotency stamp (REQUIRED in-body for retire; ignored by takeover/vacate)
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
  -- 120 (L.D1.10): the retire arm.
  v_reason TEXT;
  v_replay RECORD;
  v_cycle RECORD;
  v_week INTEGER;
  v_franchises INTEGER;
  v_successor_id UUID;
  v_successor_name TEXT;
  v_n INTEGER;
  v_n_rosters INTEGER := 0;
  v_n_lineups INTEGER := 0;
  v_n_matchups INTEGER := 0;
  v_n_results INTEGER := 0;
  v_message TEXT;
  v_result JSONB;
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

  SELECT l.id, l.name, l.owner_id, l.faab_budget, l.status, l.season INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_manager: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- RE-GATE UNDER THE LOCK (R93) — see add_placeholder_seat. Also the ACTOR's
  -- exact role, which the creator anti-coup guard below keys on: a stale
  -- actor reading 'manager' would sail past a guard written for
  -- 'co_commissioner'.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('commissioner', 'co_commissioner') THEN
    RAISE EXCEPTION 'remove_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('takeover', 'retire', 'vacate') THEN
    RAISE EXCEPTION 'remove_manager: mode must be takeover or vacate (§7.2.1)'
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

  -- 176 (L.E1.42 — Chris 2026-10-01): a team is NEVER retired. "you can't
  -- simply retire a Team, you can change the manager but the Team lives."
  -- When a manager goes there are two outcomes: takeover (a new manager
  -- inherits the team whole) or vacate (the team stays; the commissioner
  -- runs it). 'retire' stays a NAMED mode so it is refused in plain words,
  -- in every league state. The refusal sits AFTER the replay (L.D3.16's
  -- shape): a retry of a retirement committed before 176 still returns its
  -- stored payload byte-identical (none exist in production — measured
  -- 2026-10-01). Nothing below this block can see p_mode = 'retire'.
  IF p_mode = 'retire' THEN
    IF p_action_id IS NOT NULL THEN
      SELECT t.type, t.payload INTO v_replay
      FROM public.transactions t
      WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
      IF FOUND
         AND v_replay.type = 'commissioner_move'
         AND v_replay.payload ->> 'verb' = 'retire_franchise'
         AND (v_replay.payload ->> 'member_id')::uuid = p_member_id THEN
        RETURN v_replay.payload;
      END IF;
    END IF;
    RAISE EXCEPTION 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)'
      USING ERRCODE = 'P0001';
  END IF;

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

  -- 120 (R855): an UNMANAGED seat refuses takeover here as 063 wrote it and
  -- vacate stays idempotent; RETIRE passes through — §7.2.1(c) is LAW
  -- ("Orphaned is a holding state that resolves into (a) or (b)") and the
  -- retire arm's (d′) decides, by the franchise's stint history, whether
  -- there is a manager to seal it under.
  IF v_target.user_id IS NULL AND p_mode <> 'retire' THEN
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
  SELECT t.id, t.name, t.status, t.successor_team_id INTO v_team
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
    -- always (§12.2). 146 (L.D2.6 / C72): faab re-seeded from the CURRENT
    -- budget only BEFORE the draft starts (v2.8.7 — balances track the
    -- budget until then); from `drafting` on the balance belongs to the
    -- franchise and the successor inherits it (§7.2.1(a) "inherits the
    -- franchise whole: … FAAB balance").
    UPDATE public.league_members
    SET user_id = p_successor_user_id,
        is_placeholder = FALSE,
        role = 'manager',             -- powers never inherit with a seat
        faab_balance = CASE WHEN v_league.status IN ('setup', 'scheduled')
                            THEN v_league.faab_budget ELSE faab_balance END
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

    -- 146 (L.D2.6 / C72): the open seat keeps the franchise's balance once
    -- the draft has started (the next manager inherits it through the seat
    -- fill); before the draft it re-seeds from the CURRENT budget (v2.8.7).
    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,        -- back to an open seat, team_id KEPT
        role = 'manager',
        faab_balance = CASE WHEN v_league.status IN ('setup', 'scheduled')
                            THEN v_league.faab_budget ELSE faab_balance END
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

    -- 150 / F411 — §7.2.1(c): "pending waiver claims cancel". The removed
    -- manager's claims do not wait for whoever fills the seat next; the
    -- commissioner (who runs the orphaned team) can place new ones.
    -- (063's seven-key result is pinned byte for byte by pgTAP 068 I1/I3 —
    -- the cancellations are recorded on the claim rows, not in the result.)
    UPDATE public.waiver_claims c
    SET status = 'cancelled', result_reason = 'seat_vacated', cancelled_at = now(), cancelled_by = v_uid
    WHERE c.team_id = v_team.id AND c.status = 'pending';
  END IF;

  -- BOTH arms (R90): the removed user may own OTHER franchises in this league
  -- — every placeholder seat they minted while holding a commissioner role
  -- carries `owner_id = <them>` (add_placeholder_seat, item 3), as does every
  -- franchise they orphaned by vacating someone. Moving only THEIR OWN seat
  -- above would leave those owned by a proven non-member on
  -- `teams.owner_id REFERENCES profiles(id) ON DELETE CASCADE` (001:495):
  -- deleting that account would destroy the franchises outright AND — because
  -- `league_members.team_id` is ON DELETE SET NULL (052:67) — leave their
  -- cache rows with `team_id` NULL, a seat with no franchise, invisible to
  -- EVERY capacity count in the build. That is the exact shape the S2 policy
  -- removal / erratum v2.8.8 / D74(3) exists to make unrepresentable. The
  -- acting commissioner is the same recipient the vacate arm already uses.
  UPDATE public.teams
  SET owner_id = v_uid,
      updated_at = now()
  WHERE league_id = p_league_id
    AND owner_id = v_removed_user
    AND id <> v_team.id;

  -- 169/L.E1.30 (F32) — THE RECEIPT, one per removal, the outcome NAMED
  -- (§7.2.1: takeover / retire / vacate). before / after are the seat as
  -- it stood and as it stands now (read back, never inferred).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'remove_manager',
    CASE p_mode WHEN 'takeover' THEN 'replace_manager'
                WHEN 'retire'   THEN 'retire_franchise'
                ELSE 'vacate_seat' END,
    'team', v_team.id::text, p_reason,
    jsonb_build_object('manager_user_id', v_removed_user, 'team_status', v_team.status),
    jsonb_build_object(
      'manager_user_id', (SELECT lm.user_id FROM public.league_members lm WHERE lm.id = v_target.id),
      'team_status',     (SELECT t.status FROM public.teams t WHERE t.id = v_team.id))
    || CASE WHEN p_mode = 'retire' THEN jsonb_build_object(
         'successor_team_id', v_successor_id, 'successor_team_name', v_successor_name,
         'retired_at_week', v_week) ELSE '{}'::jsonb END,
    jsonb_build_object('mode', p_mode, 'member_id', v_target.id, 'team_name', v_team_name,
                       'affected_team_ids', CASE WHEN p_mode = 'retire'
                                                 THEN jsonb_build_array(v_team.id, v_successor_id)
                                                 ELSE jsonb_build_array(v_team.id) END)
    || CASE WHEN p_mode = 'retire' THEN jsonb_build_object(
         'action_id', p_action_id, 'repointed', v_result -> 'repointed') ELSE '{}'::jsonb END);

  -- §7.2.1:190 — the removed user is notified with the outcome category.
  -- 120 (R855): an unmanaged seat's retirement has no one to notify (its
  -- last manager was notified when the seat closed — vacate / leave);
  -- takeover and vacate always carry a user here (refused above otherwise).
  IF v_removed_user IS NOT NULL THEN
  PERFORM public.notify_league_member_internal(
    v_removed_user,
    'league_member',
    'You were removed from ' || v_league.name,
    CASE WHEN p_mode = 'takeover'
      THEN v_team_name || ' has a new manager. Your record with the franchise stays in its history.'
      WHEN p_mode = 'retire'
      THEN v_team_name || ' was retired by the commissioner. The franchise is sealed under your name — its record and history stay yours.'
      ELSE 'Your seat in ' || v_league.name || ' (' || v_team_name || ') was closed by the commissioner.'
    END,
    jsonb_build_object(
      'league_id', p_league_id,
      'team_id', v_team.id,
      'event', CASE WHEN p_mode = 'takeover' THEN 'replaced' WHEN p_mode = 'retire' THEN 'retired' ELSE 'removed' END));
  END IF;

  IF p_mode = 'retire' THEN
    RETURN v_result;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'mode', p_mode, 'member_id', v_target.id,
    'team_id', v_team.id, 'removed_user_id', v_removed_user,
    'successor_user_id', CASE WHEN p_mode = 'takeover' THEN p_successor_user_id ELSE NULL END,
    'already_vacant', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION remove_manager(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;
