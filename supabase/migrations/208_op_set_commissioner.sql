-- ============================================================================
-- 208 — an operator replaces a missing commissioner (M8 follow-up; ledger
--       F750; spec §24.4 v2.16.106; §7.2 "exactly one commissioner";
--       PROGRESS D670–D673; FULL rigour — permissions)
-- ============================================================================
--
-- THE RULING (Chris, 2026-10-21, "okay" — relayed by the orchestrator): an
-- admin button that replaces a commissioner who has lost their account or
-- disappeared. Before this, only the sitting commissioner could hand the role
-- on (169:453-477), the commissioner cannot leave or be removed, and the
-- operator had no league power (F750; `docs/runbooks/commissioner-locked-out.md`
-- step 5 sent it to Chris).
--
-- WHAT THIS ADDS
--
--   `op_set_commissioner(league_id, new_member_id, action_id, reason)` — a
--   SECURITY DEFINER door, search_path '', the operator gate in-body
--   (`is_platform_operator()`, 182 / TD1 — never `league_members`), which
--   hands the database clock (`now()`) to the PLAIN, REVOKEd
--   `op_set_commissioner_internal(…, p_at)`. No identity swap (R1545):
--   nothing touches request.jwt.claims.
--
--   The internal opens with 184's `op_verb_prelude_internal` (the gate again,
--   action_id required, the optional reason's bound, the replay — a receipt
--   with this action_id returns its `after` and writes nothing — and the
--   league row lock FOR UPDATE, refusing a deleted or unknown league P0002).
--   A replay must name the SAME member (the R1549 rule), else 22023.
--
--   THE CHANGE — the same two-statement shape as the commissioner's own
--   transfer (169:453-465, set_member_role's newest definer, D137): DEMOTE
--   the sitting commissioner first, then PROMOTE the new one, so
--   `one_commissioner_per_league` (063:327) never sees two rows. The SAME
--   end state (F790, ruled by Chris 2026-10-21): the old commissioner
--   becomes a CO-COMMISSIONER and keeps his seat and team. A league with NO
--   commissioner row (his account was deleted: league_members.user_id →
--   profiles ON DELETE CASCADE, 052:66) skips the demote and just promotes.
--   set_member_role itself is NOT replaced.
--
--   REFUSED BY NAME: not an operator (42501); a deleted / unknown league
--   (P0002, the prelude); a member id that is not in THIS league (P0002); a
--   seat with no person — a placeholder or vacant seat (22023). THE NO-OP: a
--   member who is already the commissioner writes NOTHING and says why
--   (`changed: false`, §24.4 "a no-op writes nothing and says why").
--
--   THE RECORD: ONE `platform_operator_actions` receipt (scope 'league';
--   before / after name both member ids and user ids) and ONE "FieldScout"
--   league line through 183's `op_league_line_internal` (Q101 (a)):
--   "FieldScout made <new> the commissioner. <old> is now a co-commissioner."
--
--   NO `commissioner_actions` ROW (D671). The commissioner's own transfer
--   writes one (169's receipt, actor = auth.uid()). Here auth.uid() is the
--   operator, and the commissioner log is read by every member WITH the
--   actor's username (`commish-log-service.ts`, 123:333 — any member), so a
--   row would put the admin's username in front of the league, which §24.4
--   forbids ("never the admin's username"). The operator receipt + the
--   FieldScout line are the record, as for every other op_* verb (none of
--   182–193 writes commissioner_actions). pgTAP 118's census sees this
--   function as a commissioner-gated writer (it compares roles to
--   'commissioner') and allowlists it by name with that reason.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * No table, column, policy, trigger, cron row or realtime change. No
--     CREATE OR REPLACE of an existing function — D137 applies only as the
--     SOURCE of the transfer shape (169:453-465, read, not replaced);
--     `grep -l op_set_commissioner supabase/migrations` → this file only.
--   * One DEFINER door (in-body gate, search_path '', REVOKE PUBLIC / anon,
--     EXECUTE authenticated — the 184 / 185 door pattern) over one PLAIN
--     internal (search_path '', REVOKEd from PUBLIC / anon / authenticated).
--   * Time only through p_at (the door passes now()).
--   * Typegen: the door's signature (additive; alias block re-appended).
--   * WAIVERS: R6 — no staging clone; rehearsal evidence = applied to the
--     shared local DB with psql over 001–207 plus the targeted pgTAP run in
--     the PR (no reset: the local DB is shared — one-local-db rule). D38 —
--     nothing to backfill: no stored row changes meaning.
--   * Deploy-before-push safe: the new route answers 503 by name (PGRST202,
--     `op-write-response.ts`) until this is pushed; nothing else calls it.
--   * Rollback: DROP FUNCTION op_set_commissioner(UUID, UUID, UUID, TEXT);
--     DROP FUNCTION op_set_commissioner_internal(UUID, UUID, UUID, TEXT, TIMESTAMPTZ).
-- pgTAP 158_op_set_commissioner.sql.
-- ============================================================================

CREATE FUNCTION op_set_commissioner_internal(
  p_league_id UUID, p_new_member_id UUID, p_action_id UUID, p_reason TEXT, p_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_replay JSONB;
  v_actor  UUID := auth.uid();
  v_new    RECORD;
  v_old    RECORD;
  v_new_name TEXT;
  v_old_name TEXT;
  v_text   TEXT;
  v_before JSONB;
  v_after  JSONB;
BEGIN
  v_replay := public.op_verb_prelude_internal('set_commissioner', p_league_id, p_action_id, p_reason);
  IF v_replay IS NOT NULL THEN
    -- R1549's rule: a replay is the SAME request — the same member.
    IF v_replay ->> 'new_member_id' IS DISTINCT FROM p_new_member_id::text THEN
      RAISE EXCEPTION 'set_commissioner: action id % was already used for a different member', p_action_id
        USING ERRCODE = '22023';
    END IF;
    RETURN v_replay;
  END IF;
  IF p_new_member_id IS NULL THEN
    RAISE EXCEPTION 'set_commissioner: p_new_member_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'set_commissioner: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- The member must belong to THIS league (the 169 rule — R86).
  SELECT lm.id, lm.user_id, lm.team_id, lm.role, lm.is_placeholder, p.username
  INTO v_new
  FROM public.league_members lm
  LEFT JOIN public.profiles p ON p.id = lm.user_id
  WHERE lm.id = p_new_member_id AND lm.league_id = p_league_id
  FOR UPDATE OF lm;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_commissioner: member % is not in this league', p_new_member_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_new.user_id IS NULL OR COALESCE(v_new.is_placeholder, FALSE) THEN
    RAISE EXCEPTION 'set_commissioner: that seat has no person in it — only a member who has joined can be the commissioner'
      USING ERRCODE = '22023';
  END IF;

  -- THE NO-OP: nothing written (§24.4).
  IF v_new.role = 'commissioner' THEN
    RETURN jsonb_build_object('changed', FALSE,
      'why', 'already_commissioner — that member is already the commissioner',
      'new_member_id', p_new_member_id);
  END IF;

  -- The sitting commissioner, if there is one (none when his account was
  -- deleted — the row cascaded away).
  SELECT lm.id, lm.user_id, lm.team_id, p.username
  INTO v_old
  FROM public.league_members lm
  LEFT JOIN public.profiles p ON p.id = lm.user_id
  WHERE lm.league_id = p_league_id AND lm.role = 'commissioner'
  FOR UPDATE OF lm;

  v_new_name := COALESCE(v_new.username,
    (SELECT t.name FROM public.teams t WHERE t.id = v_new.team_id), 'a member');
  v_before := jsonb_build_object(
    'commissioner_member_id', v_old.id, 'commissioner_user_id', v_old.user_id,
    'new_member_id', p_new_member_id, 'new_member_role', v_new.role);

  -- 169:459-465's shape: demote FIRST, then promote — the unique index
  -- (063:327) never sees two commissioners. The old commissioner keeps his
  -- seat and team as a co-commissioner (F790, ruled 2026-10-21; D670).
  IF v_old.id IS NOT NULL THEN
    UPDATE public.league_members SET role = 'co_commissioner' WHERE id = v_old.id;
    v_old_name := COALESCE(v_old.username,
      (SELECT t.name FROM public.teams t WHERE t.id = v_old.team_id), 'The previous commissioner');
  END IF;
  UPDATE public.league_members SET role = 'commissioner' WHERE id = p_new_member_id;

  v_text := 'FieldScout made ' || v_new_name || ' the commissioner.'
    || CASE WHEN v_old.id IS NOT NULL THEN ' ' || v_old_name || ' is now a co-commissioner.' ELSE '' END;
  PERFORM public.op_league_line_internal(p_league_id, v_text);

  v_after := jsonb_build_object('changed', TRUE,
    'league_id', p_league_id,
    'new_member_id', p_new_member_id, 'new_user_id', v_new.user_id,
    'previous_member_id', v_old.id, 'previous_user_id', v_old.user_id,
    'previous_role_now', CASE WHEN v_old.id IS NOT NULL THEN 'co_commissioner' END,
    'set_at', p_at);
  PERFORM public.log_operator_action_internal(p_action_id, v_actor, 'set_commissioner',
    'league', p_league_id, p_reason, v_before, v_after);
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION op_set_commissioner_internal(UUID, UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION op_set_commissioner_internal(UUID, UUID, UUID, TEXT, TIMESTAMPTZ) IS
  'F750 (migration 208): the body of op_set_commissioner at an injected instant. PLAIN, REVOKEd — reached through the door and the tests only.';

CREATE FUNCTION op_set_commissioner(
  p_league_id UUID, p_new_member_id UUID, p_action_id UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'set_commissioner: only a platform operator can replace a commissioner (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_set_commissioner_internal(p_league_id, p_new_member_id, p_action_id, p_reason, now());
END;
$$;
REVOKE ALL ON FUNCTION op_set_commissioner(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_set_commissioner(UUID, UUID, UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION op_set_commissioner(UUID, UUID, UUID, TEXT) IS
  'F750 / spec §24.4 v2.16.106 (migration 208): make a league member (a person, not an empty seat) the commissioner when the sitting one is missing. Operators only (in-body gate); idempotent on p_action_id; already the commissioner = no-op, nothing written. The old commissioner becomes a co-commissioner and keeps his team. One league receipt in platform_operator_actions + a "FieldScout" league line; no commissioner_actions row (the admin is never named to the league).';
