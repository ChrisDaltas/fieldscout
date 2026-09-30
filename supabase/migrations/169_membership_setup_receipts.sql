-- ============================================================================
-- 169 — receipts for membership, invites and league setup (M6 L.E1.30; F32,
--       F514) (tasks-M6 §6 L.E1.30 + §2.3; spec §10.3, §12.12, §15.1;
--       PROGRESS D441 (TD9), D336, D449, D450; standing rule (b) "no receipt
--       if nothing is done")
-- ============================================================================
--
-- WHAT THIS IS. The membership, invite and pre-draft setup functions have
-- written league state with no `commissioner_actions` row since M1 (F32 —
-- §15.1's "audited" annotations had nowhere to land). This migration gives
-- each of them its receipt, and gives `set_lineup`'s commissioner arm the
-- receipt it never had (F514 — measured over 001–168: 157's body calls no
-- receipt helper). ONE row per real change, written in the same transaction
-- AFTER the state write, carrying the before / after of what moved; none
-- when nothing moved. Nothing else changes:
--   * every refusal, message, result shape and chat post is byte-identical
--     (the hunks below only ADD lines — derive_169.py asserts it);
--   * ONE new refusal, only for a direct RPC caller: a reason longer than
--     500 characters is refused BY NAME (22023, 131's sentence) — the seam's
--     rule (D449(8), R1321). Only `remove_manager` and `set_lineup` take a
--     reason; the members route bounds it at 500 already, and set_lineup's
--     own 500 check fires first (so set_lineup meets nothing new). The
--     other thirteen take no reason and store NULL (no signature changes —
--     the D449(5) precedent; a reason stays optional, Q66);
--   * no new chat posts (none of these functions posted before; the rows
--     reach League Home's activity list, §10.3 / Q66).
--
-- THE SEAM. Every receipt goes through L.E1.29's `draft_commish_receipt_
-- internal` (168:159) with p_is_mock FALSE — it already holds the whole rule:
-- the no-op DETECTED by value (`before IS NOT DISTINCT FROM after` ⇒ no
-- row), the reason normalised (blank ⇒ NULL) and bounded, exactly one
-- `log_commissioner_action_internal` row with `metadata.verb` + `bypassed:
-- []`, and a RAISE if the row was not written (D336 part 2). One hop from the
-- helper, as the draft room's (F513(a)).
--
-- TWO NEW HELPERS (PLAIN, search_path '', triple-REVOKEd — seams, not doors):
--   league_receipt_diff_internal(old, new, depth) — {before, after} holding
--     ONLY the keys that changed, by path ("base.receptions",
--     "positions.TE.receptions"); arrays and scalars are leaves; an absent
--     key reads as null; depth 1 compares top-level keys only. Top-level
--     inputs must be objects (a non-object is refused by name — never "no
--     change").
--   league_settings_doc_internal(league) — the league's §7.3 settings as ONE
--     flat document: the typed columns (TYPED_COLUMN_KEYS + scoring_system_id)
--     over the settings blob — commish_change_setting's key space (149).
--
-- WHAT EACH RECEIPT SAYS (action_type · target_type · before → after):
--   add_placeholder_seat   add_seat · team · ∅ → {team_id, team_name, placeholder}
--   set_member_role        promote_member | demote_member · member · {role} → {role}
--                          transfer_commissioner · member · {role, commissioner_user_id} → …
--   assign_manager         assign_manager · team · {manager_user_id: null, team_status} → {…}
--   remove_manager         replace_manager | retire_franchise | vacate_seat (the three
--                          §7.2.1 outcomes, NAMED) · team · {manager_user_id, team_status}
--                          → as read back (+ the successor for a retirement)
--   create_league_invite   create_invite · invite · ∅ → {target_team_id, team_name, kind,
--                          max_uses, expires_at};  resend_invite · invite · {last_sent_at} → …
--   revoke_league_invite   revoke_invite · invite · {revoked: false} → {revoked: true}
--   rotate_invite_code     rotate_invite_code · league · ∅ → {invite_code_rotated: true}
--   set_league_invite_slug set_invite_slug · league · {invite_slug} → {invite_slug}
--   update_league_settings change_settings · league · {settings: {changed keys}} → …
--   update_league_profile  edit_league_profile · league · {changed of name / avatar_url} → …
--   set_league_status      lifecycle_change · league · {status} → {status}
--   soft_delete_league     delete_league · league · {deleted: false} → {deleted: true}
--   scoring_fork_template  fork_scoring · league · {scoring_system_id} → {…}
--   scoring_update_rules   edit_scoring · league · {scoring_rules: {changed paths}} → …
--   set_lineup_internal    edit_lineup · team · {slot_map} → {slot_map (+ ir_moves)},
--                          acting_as_team_id = the team (F514; §10.3)
-- `acting_as_team_id` is set ONLY on the lineup receipt — the one call here
-- where the commissioner acts AS a team (a manager's verb, standing rule (a)).
-- Everything else acts on the league or the seat, so it is NULL and the team
-- rides in target_id / metadata (no FK pins a team — no teardown ripple).
--
-- PRIVACY (TD9 / D441; the log is member-readable, §10.3). An invite
-- receipt says "an invite for <team>" and its kind (email / username / link)
-- — NEVER the token, the email or the username. Neither invite code is
-- recorded on a rotation (the code is the league's join credential). The
-- slug IS recorded: like the code it is a join credential (062:970-980), but
-- every member can already read both on the league row (the SELECT policy +
-- column grants), so the receipt exposes nothing new; the code is left out as
-- the conservative choice (R1326). pgTAP 117 asserts by value over every row it
-- writes that no before / after / metadata contains a token, an
-- invited_email, an invited_username or an invite code.
--
-- WHAT IS NOT RECEIPTED, AND WHY. leave_league (a manager's own act, not a
-- commissioner's — the D338 reading: the log is the commissioner's);
-- create_league (the creator's act before the league exists — there is no
-- commissioner yet); claim / join (the joiner's act). A manager's own
-- set_lineup — the commissioner's own team included (he is its manager) —
-- is not an override. For L.E1.31's census: PROGRESS F515.
--
-- D137 — each replaced body is derived from its NEWEST definer's FILE TEXT
-- (measured by grep + md5 over 001–168: no later migration defines any of
-- them; for set_lineup_internal, 164 / 165 / 166 mention it and define it
-- not) by an exact-match script (derive_169.py — every substitution asserted
-- to hit exactly once, every hunk asserted additive, its reversal asserted
-- to reproduce the source byte for byte, on the block and on prosrc; pgTAP
-- 117's pg_temp.un169 is the same reversal in the database). The source
-- prosrc md5s equal the live ones on the 168 chain (measured):
--   add_placeholder_seat     063:380-475  prosrc md5 7a276be7… → c2c3b4df…  1 hunk  (+11 / -0)
--   set_member_role          063:482-616  prosrc md5 a97a6e5e… → 516483c5…  2 hunks (+20 / -0)
--   assign_manager           063:623-738  prosrc md5 58aa952e… → ddb16f49…  1 hunk  (+12 / -0)
--   remove_manager           150:1910-2419  prosrc md5 df2ab5c7… → 06921fe6…  1 hunk  (+23 / -0)
--   create_league_invite     062:298-438  prosrc md5 0285e16f… → 082f5674…  4 hunks (+28 / -0)
--   revoke_league_invite     062:479-516  prosrc md5 2cb43e5a… → cbc5db97…  1 hunk  (+14 / -0)
--   rotate_invite_code       062:523-566  prosrc md5 0f88dc74… → fc11ceb2…  1 hunk  (+9 / -0)
--   set_league_invite_slug   062:573-631  prosrc md5 fa7789b1… → 406d5039…  4 hunks (+18 / -0)
--   update_league_settings   118:2438-2623  prosrc md5 fa301876… → 0afb6fff…  3 hunks (+19 / -0)
--   update_league_profile    064:84-133  prosrc md5 a00e4578… → 034aff01…  3 hunks (+15 / -0)
--   set_league_status        059:247-326  prosrc md5 d2943892… → b94ac211…  1 hunk  (+8 / -0)
--   soft_delete_league       060:323-359  prosrc md5 cb7b208f… → cdcd5635…  1 hunk  (+8 / -0)
--   scoring_fork_template    105:277-424  prosrc md5 1626ee04… → 76fbb4d2…  1 hunk  (+9 / -0)
--   scoring_update_rules     105:461-555  prosrc md5 0ebe670e… → 2a737dd7…  3 hunks (+17 / -0)
--   set_lineup_internal      157:404-1079  prosrc md5 ca330741… → 36a62aed…  1 hunk  (+15 / -0)
-- Replaced with the REVOKE restated after each (the ACL is kept by CREATE OR
-- REPLACE; restating it is the 093 / 095 / 100 / 168 precedent). The older
-- suites that pin set_lineup_internal / remove_manager by md5 apply
-- pg_temp.un169 innermost, so they pin exactly what they pinned (additive,
-- the R992 shape).
--
-- DEPLOY BEFORE PUSH (TD15). No route, hook, page or type changes shape: the
-- functions' results are byte-identical, so merged code behaves the same on
-- a database at 168 (no receipts) and at 169 (receipts). League Home's
-- activity list already reads every commissioner_actions row; the new types
-- render through its fallback until L.E1.34 gives them words (F516), except
-- the lineup receipt ({slot_map} — "set <team>'s Week N lineup (acting for
-- <team>)") and a rename ({name} both sides — "renamed … to …"), which
-- already have copy.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: 2 functions (PLAIN, search_path '', REVOKEd from PUBLIC / anon /
--   authenticated). Replaced: 15 bodies (signatures, volatility, DEFINER and
--   search_path unchanged). No table, column, index, policy, trigger or cron
--   row. Time: now() only (no new clock read beyond the resend's
--   last_sent_at, which the body already writes with now()). Typegen: the two
--   new functions (additive). Realtime: none new (commissioner_actions stays
--   re-waived, §12.14 / F42).
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–169 and the full pgTAP run in the PR. D38 — no backfill:
--   the membership and setup changes made before 169 have no before / after
--   to reconstruct.
-- Rollback = re-apply the fifteen head bodies named above verbatim and DROP
-- the two helpers.
--
-- Proof: pgTAP 117 (form + D137 in the database; per function: change ⇒ one
-- row with its before / after as stored literals, no-op ⇒ none, manager ⇒
-- 42501 with nothing written; the privacy negative by value; members read
-- the rows, an outsider reads none; F514's four cells). Break probes shown
-- red then reverted in the PR.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. league_receipt_diff_internal — the changed keys, by path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_receipt_diff_internal(
  p_old    JSONB,
  p_new    JSONB,
  p_depth  INTEGER DEFAULT NULL,   -- NULL = every level; 1 = top-level keys only
  p_prefix TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_old    JSONB := COALESCE(p_old, 'null'::jsonb);   -- an absent key reads as null
  v_new    JSONB := COALESCE(p_new, 'null'::jsonb);
  v_key    TEXT;
  v_sub    JSONB;
  v_before JSONB := '{}'::jsonb;
  v_after  JSONB := '{}'::jsonb;
BEGIN
  -- Loud, never "no change": the documents compared must be objects.
  IF p_prefix = '' AND (jsonb_typeof(v_old) <> 'object' OR jsonb_typeof(v_new) <> 'object') THEN
    RAISE EXCEPTION 'league_receipt_diff_internal: both documents must be JSON objects (got % and %)',
      jsonb_typeof(v_old), jsonb_typeof(v_new)
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_old) = 'object' AND jsonb_typeof(v_new) = 'object'
     AND (p_depth IS NULL OR p_depth > 0) THEN
    FOR v_key IN
      SELECT x.k FROM (SELECT jsonb_object_keys(v_old) AS k
                       UNION SELECT jsonb_object_keys(v_new)) x
      ORDER BY x.k
    LOOP
      v_sub := public.league_receipt_diff_internal(
        v_old -> v_key, v_new -> v_key, p_depth - 1, p_prefix || v_key || '.');
      v_before := v_before || (v_sub -> 'before');
      v_after  := v_after  || (v_sub -> 'after');
    END LOOP;
    RETURN jsonb_build_object('before', v_before, 'after', v_after);
  END IF;
  IF v_old IS DISTINCT FROM v_new THEN
    RETURN jsonb_build_object(
      'before', jsonb_build_object(left(p_prefix, -1), v_old),
      'after',  jsonb_build_object(left(p_prefix, -1), v_new));
  END IF;
  RETURN jsonb_build_object('before', '{}'::jsonb, 'after', '{}'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_receipt_diff_internal(JSONB, JSONB, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. league_settings_doc_internal — §7.3's settings as one flat document
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_settings_doc_internal(p_league_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  -- The typed columns (league-settings.ts TYPED_COLUMN_KEYS, plus the
  -- scoring reference) over the blob; the split is disjoint by construction
  -- (split-merge.test.ts), so no blob key is shadowed.
  SELECT COALESCE(l.settings, '{}'::jsonb) || jsonb_build_object(
           'format',               l.format,
           'team_count',           l.team_count,
           'regular_season_weeks', l.regular_season_weeks,
           'playoff_teams',        l.playoff_teams,
           'playoff_start_week',   l.playoff_start_week,
           'waiver_type',          l.waiver_type,
           'faab_budget',          l.faab_budget,
           'trade_review',         l.trade_review,
           'trade_deadline_week',  l.trade_deadline_week,
           'lineup_lock',          l.lineup_lock,
           'roster_settings',      l.roster_settings,
           'scoring_system_id',    l.scoring_system_id)
  FROM public.leagues l
  WHERE l.id = p_league_id;
$$;
REVOKE EXECUTE ON FUNCTION league_settings_doc_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- add_placeholder_seat — 063:380-475's FILE TEXT (D137), 1 hunk (+11 / -0).
-- ---------------------------------------------------------------------------
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
  v_actor_role TEXT;
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

  -- RE-GATE UNDER THE LOCK (R90/R93 class). The pre-lock is_league_commish
  -- read above is a fast-fail that answers a STALE question: an actor demoted
  -- while this call blocked on the league row would otherwise complete one
  -- privileged write. Roles move ONLY under this same lock (set_member_role
  -- takes it first), so a read taken here is stable for the rest of the txn.
  -- Kept in addition to — not instead of — the pre-lock check, which is what
  -- keeps a nonexistent league answering 42501 rather than leaking P0002.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('commissioner', 'co_commissioner') THEN
    RAISE EXCEPTION 'add_placeholder_seat: not a commissioner of this league'
      USING ERRCODE = '42501';
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

  -- 169/L.E1.30 (F32) — THE RECEIPT: the seat just added, named. A new seat
  -- is always a change (every refusal above writes nothing).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'add_placeholder_seat', 'add_seat', 'team',
    v_team_id::text, NULL,
    NULL,
    jsonb_build_object('team_id', v_team_id, 'team_name', v_name, 'placeholder', TRUE),
    jsonb_build_object('member_id', v_member_id, 'seats_filled', v_seated + 1,
                       'team_count', v_league.team_count,
                       'affected_team_ids', jsonb_build_array(v_team_id)));

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

-- ---------------------------------------------------------------------------
-- set_member_role — 063:482-616's FILE TEXT (D137), 2 hunks (+20 / -0).
-- ---------------------------------------------------------------------------
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

  -- RE-GATE UNDER THE LOCK (R93) — see add_placeholder_seat. This read is
  -- also the ACTOR's exact role: is_league_commish cannot tell a commissioner
  -- from a co-commissioner, and three rules below depend on the difference.
  -- It must be taken here, not later: a stale actor reading 'manager' misses
  -- every co_commissioner-keyed guard below and is therefore strictly MORE
  -- powerful than a legitimate co-commissioner.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('commissioner', 'co_commissioner') THEN
    RAISE EXCEPTION 'set_member_role: not a commissioner of this league'
      USING ERRCODE = '42501';
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

  IF v_target.user_id IS NULL THEN
    RAISE EXCEPTION 'set_member_role: that seat has no manager yet — invite or assign someone first'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent REPLAY of a completed transfer (D63, R94/R100): the target
  -- already holds the role being requested, so there is nothing to do and
  -- nothing to refuse. Hoisted ABOVE the anti-coup guard (R100) — it performs
  -- no write and has no authz consequence, the same reasoning that already
  -- placed it ahead of the headless guard below. Without the hoist, replaying
  -- a completed transfer whose target is the league CREATOR (leagues.owner_id)
  -- hit the anti-coup guard and raised 42501 instead of returning
  -- transferred:false — the D63 break R94 closed for NON-creator targets only.
  -- A no-op cannot "remove the creator", so this never weakens §7.2: a REAL
  -- role change on the creator (p_role <> the held role) still falls through to
  -- the anti-coup guard below and 42501s.
  IF p_role = 'commissioner' AND v_target.role = 'commissioner' THEN
    RETURN jsonb_build_object(
      'member_id', p_member_id, 'role', 'commissioner', 'transferred', false);
  END IF;

  -- §7.2 anti-coup: "The original creator can never be removed by a
  -- co-commissioner." Keyed on leagues.owner_id (the CREATOR record), never
  -- on role — after a transfer the creator may hold any role. Sits AFTER the
  -- idempotent replay arm (R100) so an identical replay of a completed
  -- transfer to the creator is a no-op, not a 42501; a real role change on the
  -- creator by a co-commissioner still reaches this guard.
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
    -- 169/L.E1.30 (F32) — THE RECEIPT: the commissioner role handed over
    -- (the replay of a completed transfer returned above).
    PERFORM public.draft_commish_receipt_internal(
      p_league_id, FALSE, 'set_member_role', 'transfer_commissioner', 'member',
      p_member_id::text, NULL,
      jsonb_build_object('role', v_target.role, 'commissioner_user_id', v_uid),
      jsonb_build_object('role', 'commissioner', 'commissioner_user_id', v_target.user_id),
      jsonb_build_object('user_id', v_target.user_id,
                         'previous_commissioner_user_id', v_uid,
                         'previous_commissioner_role', 'co_commissioner'));
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

  -- 169/L.E1.30 (F32) — THE RECEIPT: the role change, named (manager ↔
  -- co-commissioner; the same-role no-op returned above).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'set_member_role',
    CASE WHEN p_role = 'co_commissioner' THEN 'promote_member' ELSE 'demote_member' END,
    'member', p_member_id::text, NULL,
    jsonb_build_object('role', v_target.role),
    jsonb_build_object('role', p_role),
    jsonb_build_object('user_id', v_target.user_id));

  RETURN jsonb_build_object(
    'member_id', p_member_id, 'role', p_role, 'transferred', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION set_member_role(UUID, UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- assign_manager — 063:623-738's FILE TEXT (D137), 1 hunk (+12 / -0).
-- ---------------------------------------------------------------------------
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
  v_actor_role TEXT;
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

  -- RE-GATE UNDER THE LOCK (R93) — see add_placeholder_seat.
  SELECT lm.role INTO v_actor_role
  FROM public.league_members lm
  WHERE lm.league_id = p_league_id AND lm.user_id = v_uid;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('commissioner', 'co_commissioner') THEN
    RAISE EXCEPTION 'assign_manager: not a commissioner of this league'
      USING ERRCODE = '42501';
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

  -- 169/L.E1.30 (F32) — THE RECEIPT: who now manages the franchise. `before`
  -- is the seat as the checks above proved it (no open stint — no manager).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'assign_manager', 'assign_manager', 'team',
    p_team_id::text, NULL,
    jsonb_build_object('manager_user_id', NULL, 'team_status', v_team.status),
    jsonb_build_object('manager_user_id', p_user_id,
                       'team_status', (SELECT t.status FROM public.teams t WHERE t.id = p_team_id)),
    jsonb_build_object('member_id', v_member_id,
                       'team_name', (SELECT t.name FROM public.teams t WHERE t.id = p_team_id),
                       'affected_team_ids', jsonb_build_array(p_team_id)));

  RETURN jsonb_build_object(
    'member_id', v_member_id, 'team_id', p_team_id, 'already_seated', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION assign_manager(UUID, UUID, UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- remove_manager — 150:1910-2419's FILE TEXT (D137), 1 hunk (+23 / -0).
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

  -- 120 (L.D1.10): retire-and-succeed is REAL now (§7.2.1(b) / D301 / F31).
  IF p_mode = 'retire' THEN
    -- (a) The status gate. Before the draft D42's refusal stands byte for
    --     byte (017 J pins it; a franchise has no roster or record to
    --     inherit). `in_season` (the LAW's "mid-season … audited override")
    --     and `complete` ("primarily an offseason action") proceed.
    --     `playoffs` REFUSES BY NAME: §7.2.1(b) / §11.5 print nothing about
    --     a retired franchise's bracket line (does the successor play it,
    --     or is it forfeited?) and 118's sync derives later rounds from the
    --     played rows' team ids — PROGRESS Q41 carries the question; this
    --     arm is a refusal, never a fold (R801).
    IF v_league.status IN ('setup', 'scheduled', 'drafting') THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise isn''t available before the draft — use takeover or vacate (§7.2.1; retire-and-succeed arrives with the in-season milestone)'
        USING ERRCODE = 'P0001';
    ELSIF v_league.status = 'playoffs' THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise during the playoffs is not defined yet — what the bracket does with a retired franchise''s line is PROGRESS Q41; use takeover or vacate now, or retire the franchise after the season (§7.2.1(b))'
        USING ERRCODE = 'P0001';
    ELSIF v_league.status NOT IN ('in_season', 'complete') THEN
      RAISE EXCEPTION 'remove_manager: league status % admits no retirement (§7.1)', v_league.status
        USING ERRCODE = 'P0001';
    END IF;
    -- (a′) R858: the actor's OWN seat. §7.2.1 gives the leaver no choice of
    --      outcome — leave_league is the voluntary path — and the route's
    --      self-DELETE dispatches there; a co-commissioner calling the RPC
    --      directly must not get the choice back. (A plain manager never
    --      reaches here: not a commissioner, 42501 above.)
    IF v_target.user_id = v_uid THEN
      RAISE EXCEPTION 'remove_manager: you cannot retire your own franchise — a leaver has no choice of outcome (§7.2.1); leave the league, or have the commissioner act on your seat'
        USING ERRCODE = '42501';
    END IF;
    -- (b) The audit stamp and the reason (E49 "audited override"; D290's
    --     interim posture: reason REQUIRED, stored on the ledger row).
    IF p_action_id IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retire requires action_id (idempotency key — one UUID per retirement, reused on retry; 113''s contract)'
        USING ERRCODE = '22023';
    END IF;
    v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise is an audited override — a reason is required (E49 / D290)'
        USING ERRCODE = '22023';
    END IF;
    -- (c) REPLAY by (league_id, action_id) — 113's contract (R732): the
    --     stored payload byte-identical; the same stamp on another verb or
    --     another member is a shape violation. Checked BEFORE the seat
    --     checks below: after a committed retirement the seat is an open
    --     placeholder and would otherwise refuse the retry by name.
    SELECT t.type, t.payload INTO v_replay
    FROM public.transactions t
    WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
    IF FOUND THEN
      IF v_replay.type <> 'commissioner_move'
         OR v_replay.payload ->> 'verb' IS DISTINCT FROM 'retire_franchise'
         OR (v_replay.payload ->> 'member_id')::uuid IS DISTINCT FROM p_member_id THEN
        RAISE EXCEPTION 'remove_manager: action_id % already names another action in this league — an action_id identifies ONE submit of ONE verb (R732)', p_action_id
          USING ERRCODE = '22023';
      END IF;
      RETURN v_replay.payload;
    END IF;
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
  ELSIF p_mode = 'retire' THEN
    -- (d) F1: the lineage this franchise sits in must be ACYCLIC before it
    --     is extended. The successor minted below is a NEW row (it cannot
    --     close a cycle by construction — said, D267), so the walk is over
    --     the PREDECESSOR chain as STORED: only privileged writes can
    --     corrupt it (D53: the column has no client writer), and a corrupt
    --     chain is refused BY NAME rather than misreported as "already
    --     sealed" (068 F; the DoD probe drops this block).
    WITH RECURSIVE lineage AS (
      SELECT t.id, 0 AS depth FROM public.teams t WHERE t.id = v_team.id
      UNION ALL
      SELECT p.id, l.depth + 1
      FROM lineage l JOIN public.teams p ON p.successor_team_id = l.id
      WHERE l.depth < 64
    ) CYCLE id SET is_cycle USING path
    SELECT l.is_cycle, array_length(l.path, 1) - 1 AS len INTO v_cycle
    FROM lineage l WHERE l.is_cycle
    ORDER BY array_length(l.path, 1) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'remove_manager: % sits in a succession CYCLE of length % (the successor_team_id chain revisits a franchise) — refused; repair the lineage before extending it (§12.22 / F1)', v_team_name, v_cycle.len
        USING ERRCODE = 'P0001';
    END IF;
    IF v_team.status = 'retired' OR v_team.successor_team_id IS NOT NULL THEN
      RAISE EXCEPTION 'remove_manager: % is already sealed (status %, successor %) — a retired franchise cannot be retired again (§7.2.1(b))', v_team_name, v_team.status, v_team.successor_team_id
        USING ERRCODE = 'P0001';
    END IF;
    -- (d′) R855: an UNMANAGED seat (vacated / left — 'orphaned', §7.2.1(c))
    --      is admitted when the franchise has a CLOSED stint: the seal
    --      names the LAST manager (History Mode reads the stints; nothing
    --      else is written under a name), no stint is open to close (the
    --      (h) UPDATE matches nothing — D63), no one is notified,
    --      removed_user_id is NULL in the payload. A franchise that has
    --      NEVER had a manager — 120's own successor until it is claimed,
    --      or a placeholder seat autopick-drafted and never claimed — has
    --      no name to seal under and refuses BY NAME.
    IF v_removed_user IS NULL THEN
      PERFORM 1 FROM public.team_managers tm
      WHERE tm.team_id = v_team.id AND tm.ended_at IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'remove_manager: % has never had a manager — there is no one to seal it under; use assign-manager to seat someone on it first (§7.2.1(b))', v_team_name
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (e) The founding week of the successor's book — the first week the
    --     league has NOT yet played: 1 + its last correction_window/final
    --     week (a reopened earlier week stays the predecessor's), else the
    --     first league week. NULL when that week does not exist (the
    --     season is over — `complete`, or every week played): nothing is
    --     re-pointed and History reads the whole book as the retired
    --     franchise's; retired_at_week / ended_week are NULL (§12.22's
    --     "NULL preseason" reading, extended to "outside the season").
    SELECT w.week INTO v_week
    FROM public.league_weeks w
    WHERE w.league_id = p_league_id AND w.season = v_league.season
      AND w.week = COALESCE(
        (SELECT max(x.week) + 1 FROM public.league_weeks x
         WHERE x.league_id = p_league_id AND x.season = v_league.season
           AND x.status IN ('correction_window', 'final')),
        (SELECT min(x.week) FROM public.league_weeks x
         WHERE x.league_id = p_league_id AND x.season = v_league.season));

    -- (f) The successor: a NEW franchise in the same slot (§7.2.1(b)),
    --     named by D74(5)'s series over the league's WHOLE franchise count
    --     (retired included — a retired franchise keeps its number, so the
    --     name cannot collide with a seat's default), owned by the acting
    --     commissioner like every placeholder (add_placeholder_seat),
    --     'orphaned': no manager until a takeover (§7.2.1(c)'s holding
    --     state; assign_manager / a seat claim return it to 'active' —
    --     D74(2)). It counts as seated in every capacity count.
    SELECT count(*)::int INTO v_franchises FROM public.teams t WHERE t.league_id = p_league_id;
    v_successor_name := 'Team ' || (v_franchises + 1)::text;
    INSERT INTO public.teams (owner_id, name, league_id, list_id, status)
    VALUES (v_uid, v_successor_name, p_league_id, NULL, 'orphaned')
    RETURNING id INTO v_successor_id;

    -- (g) SEAL the franchise: status, the partition week, the link. owner_id
    --     moves to the acting commissioner for the vacate arm's reason (the
    --     removed user's profile deletion would CASCADE the sealed franchise
    --     away — 001:495); name and record are frozen by the absence of any
    --     writer (§7.2.1(b)).
    UPDATE public.teams
    SET status = 'retired',
        retired_at_week = v_week,
        successor_team_id = v_successor_id,
        owner_id = v_uid,
        updated_at = now()
    WHERE id = v_team.id;

    -- (h) The stint closes `seat_retired` — the one §12.22 value M1 never
    --     wrote (D74(9)); the F3 close shape; a missing open stint is a
    --     no-op (D63). No stint opens: the successor has no manager yet.
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = v_week,
        end_reason = 'seat_retired',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- (i) The seat: ONE league_members row per seat, always (§12.2) — the
    --     cache row is re-pointed at the successor as an OPEN placeholder
    --     (assign_manager / a seat-targeted invite fill it). faab_balance is
    --     deliberately NOT re-seeded: (b)'s "inherits FAAB" is the seat's
    --     balance carrying, which the in-place UPDATE does for free (D301:
    --     vacuous until M5 makes the balance live; the transfer line M5 need
    --     not write is this one).
    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,
        role = 'manager',
        team_id = v_successor_id
    WHERE id = v_target.id;

    -- (j) THE INHERITANCE, every re-point COUNTED (rule 10). The roster
    --     whole (072's per-row trigger broadcasts each row on league:<id>);
    --     the CURRENT and future weeks' lineups, matchups and results — the
    --     successor's book opens at v_week; past weeks stay the
    --     predecessor's (History partitions at retired_at_week — E49).
    --     league_player_pool carries no team reference (109); transactions,
    --     lineup_actions and the draft rows are history under the
    --     predecessor. A game-day lock is per PLAYER, evaluated from
    --     nfl_games at call time (115/Q34(B)) — a re-point unlocks no one.
    UPDATE public.league_rosters SET team_id = v_successor_id
    WHERE league_id = p_league_id AND team_id = v_team.id;
    GET DIAGNOSTICS v_n_rosters = ROW_COUNT;
    IF v_week IS NOT NULL THEN
      UPDATE public.team_lineups SET team_id = v_successor_id
      WHERE team_id = v_team.id AND season = v_league.season AND week >= v_week;
      GET DIAGNOSTICS v_n_lineups = ROW_COUNT;
      UPDATE public.matchups SET home_team_id = v_successor_id, updated_at = now()
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND home_team_id = v_team.id;
      GET DIAGNOSTICS v_n_matchups = ROW_COUNT;
      UPDATE public.matchups SET away_team_id = v_successor_id, updated_at = now()
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND away_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_matchups := v_n_matchups + v_n;
      UPDATE public.team_week_results SET team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND team_id = v_team.id;
      GET DIAGNOSTICS v_n_results = ROW_COUNT;
      UPDATE public.team_week_results SET opponent_team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND opponent_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_results := v_n_results + v_n;
      UPDATE public.team_week_results SET second_opponent_team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND second_opponent_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_results := v_n_results + v_n;
    END IF;

    -- (k) The payload — also the LEDGER row's, so a replay is byte-identical.
    v_result := jsonb_build_object(
      'ok', true, 'mode', p_mode, 'verb', 'retire_franchise', 'action_id', p_action_id,
      'member_id', v_target.id, 'team_id', v_team.id,
      'removed_user_id', v_removed_user, 'successor_user_id', NULL, 'already_vacant', false,
      'retired_team_id', v_team.id, 'retired_team_name', v_team_name,
      'successor_team_id', v_successor_id, 'successor_team_name', v_successor_name,
      'season', v_league.season, 'retired_at_week', v_week, 'reason', v_reason,
      'repointed', jsonb_build_object(
        'rosters', v_n_rosters, 'lineups', v_n_lineups, 'matchups', v_n_matchups, 'results', v_n_results),
      'inherits', jsonb_build_object(
        'roster', true, 'record', 'seeding_only', 'h2h_history', false, 'faab', 'seat_balance_kept'));
    -- (l) The ledger (D290 interim; 113's shape): ONE transactions row of
    --     type commissioner_move, commissioner-initiated (no initiator team),
    --     stamped with p_action_id; 119's trigger carries it to the feed.
    INSERT INTO public.transactions
      (league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
    VALUES (p_league_id, 'commissioner_move', 'complete', NULL, v_uid, v_result, v_week, p_action_id);
    -- (m) The D97 in-transaction system post (111/113's shape).
    v_message := v_team_name || ' was retired by ' || public.draft_actor_name()
      || CASE WHEN v_removed_user IS NULL
           THEN ' — the vacant franchise is sealed under its last manager (§7.2.1(c)); '
           ELSE ' — the franchise is sealed under its final manager; ' END
      || v_successor_name
      || ' takes its slot' || CASE WHEN v_week IS NULL THEN ' after the season' ELSE ' from Week ' || v_week::text END
      || ' (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: ' || v_reason;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, v_uid, v_message, 'league', TRUE);
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

-- ---------------------------------------------------------------------------
-- create_league_invite — 062:298-438's FILE TEXT (D137), 4 hunks (+28 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_league_invite(
  p_league_id UUID,
  p_target_team_id UUID DEFAULT NULL,
  p_invited_email TEXT DEFAULT NULL,
  p_invited_username TEXT DEFAULT NULL,
  p_max_uses INTEGER DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_league RECORD;
  v_invitee_id UUID;
  v_canonical_username TEXT;
  v_team RECORD;
  v_team_name TEXT; -- NULL for general invites (v_team stays unassigned then)
  v_existing RECORD;
  v_invite RECORD;
  v_prev_sent TIMESTAMPTZ;  -- 169/L.E1.30: the re-sent invite's last send, for the receipt
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_league_invite: must be signed in'
      USING ERRCODE = '42501';
  END IF;
  -- In-body authorization (§12.0/§8.3): commissioner or co-commissioner.
  -- A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'create_league_invite: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.id, l.name INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_league_invite: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_max_uses IS NULL OR p_max_uses < 1 THEN
    RAISE EXCEPTION 'create_league_invite: max_uses must be at least 1'
      USING ERRCODE = '22023';
  END IF;
  IF p_invited_email IS NOT NULL AND p_invited_username IS NOT NULL THEN
    RAISE EXCEPTION 'create_league_invite: an invite targets an email OR a username, not both (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_max_uses > 1 AND (p_invited_email IS NOT NULL OR p_invited_username IS NOT NULL) THEN
    RAISE EXCEPTION 'create_league_invite: identity-restricted invites are single-use — max_uses must be 1 (§7.2)'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_invited_email IS NOT NULL AND position('@' IN p_invited_email) <= 1 THEN
    RAISE EXCEPTION 'create_league_invite: invited_email must be a valid email address'
      USING ERRCODE = 'P0001';
  END IF;

  -- §7.2 path 3: username invites require an existing account. Matched via
  -- lower(username) (D36); the CANONICAL handle is stored.
  IF p_invited_username IS NOT NULL THEN
    SELECT p.id, p.username INTO v_invitee_id, v_canonical_username
    FROM public.profiles p
    WHERE lower(p.username) = lower(btrim(p_invited_username));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_league_invite: no FieldScout account with the username "%" — username invites require an existing account (§7.2); use an email invite instead', btrim(p_invited_username)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Seat-targeted: the team must be one of THIS league's franchises and not
  -- a sealed (retired) one.
  IF p_target_team_id IS NOT NULL THEN
    SELECT t.id, t.name, t.status INTO v_team
    FROM public.teams t
    WHERE t.id = p_target_team_id AND t.league_id = p_league_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_league_invite: target_team_id is not a franchise of this league'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_team.status = 'retired' THEN
      RAISE EXCEPTION 'create_league_invite: that franchise is retired — its seat is sealed and cannot be invited (§7.2.1)'
        USING ERRCODE = 'P0001';
    END IF;
    v_team_name := v_team.name;
  END IF;

  -- RE-SEND (D46): an identical LIVE identity-targeted invite is re-sent,
  -- not duplicated — last_sent_at stamps the send; created_at remains the
  -- initial-send record.
  IF p_invited_email IS NOT NULL OR p_invited_username IS NOT NULL THEN
    SELECT i.id, i.token, i.expires_at INTO v_existing
    FROM public.league_invites i
    WHERE i.league_id = p_league_id
      AND i.target_team_id IS NOT DISTINCT FROM p_target_team_id
      AND lower(i.invited_email::text) IS NOT DISTINCT FROM lower(p_invited_email)
      AND lower(i.invited_username::text) IS NOT DISTINCT FROM lower(v_canonical_username)
      AND i.revoked_at IS NULL
      AND i.use_count < i.max_uses
      AND now() < i.expires_at
    ORDER BY i.created_at
    LIMIT 1
    FOR UPDATE OF i;
    IF FOUND THEN
      v_prev_sent := (SELECT i.last_sent_at FROM public.league_invites i WHERE i.id = v_existing.id);  -- 169/L.E1.30
      UPDATE public.league_invites
      SET last_sent_at = now()
      WHERE id = v_existing.id;
      -- 169/L.E1.30 (F32) — THE RECEIPT for a re-send (D46): the invite and
      -- its seat, never the token or who it was sent to (TD9).
      PERFORM public.draft_commish_receipt_internal(
        p_league_id, FALSE, 'create_league_invite', 'resend_invite', 'invite',
        v_existing.id::text, NULL,
        jsonb_build_object('last_sent_at', v_prev_sent),
        jsonb_build_object('last_sent_at', now()),
        jsonb_build_object('target_team_id', p_target_team_id, 'team_name', v_team_name,
                           'kind', CASE WHEN p_invited_email IS NOT NULL THEN 'email' ELSE 'username' END,
                           'affected_team_ids', CASE WHEN p_target_team_id IS NULL THEN '[]'::jsonb
                                                     ELSE jsonb_build_array(p_target_team_id) END));
      IF v_invitee_id IS NOT NULL THEN
        PERFORM public.notify_league_invite_internal(
          v_invitee_id, v_league.name, v_team_name, p_league_id, v_existing.token);
      END IF;
      RETURN jsonb_build_object(
        'invite_id', v_existing.id,
        'token', v_existing.token,
        'expires_at', v_existing.expires_at,
        'resent', true
      );
    END IF;
  END IF;

  INSERT INTO public.league_invites
    (league_id, target_team_id, invited_email, invited_username, created_by, max_uses)
  VALUES
    (p_league_id, p_target_team_id, p_invited_email, v_canonical_username, v_uid, p_max_uses)
  RETURNING id, token, expires_at INTO v_invite;

  -- 169/L.E1.30 (F32) — THE RECEIPT: "an invite for <team>" (or a league
  -- invite), its kind and its limits — never the token, the email or the
  -- username (TD9; the log is member-readable, §10.3).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'create_league_invite', 'create_invite', 'invite',
    v_invite.id::text, NULL,
    NULL,
    jsonb_build_object('target_team_id', p_target_team_id, 'team_name', v_team_name,
                       'kind', CASE WHEN p_invited_email IS NOT NULL THEN 'email'
                                    WHEN p_invited_username IS NOT NULL THEN 'username'
                                    ELSE 'link' END,
                       'max_uses', p_max_uses, 'expires_at', v_invite.expires_at),
    jsonb_build_object('affected_team_ids', CASE WHEN p_target_team_id IS NULL THEN '[]'::jsonb
                                                 ELSE jsonb_build_array(p_target_team_id) END));

  -- In-app notification for username invites (task item 3) — guarded so a
  -- notification failure can never break the invite write.
  IF v_invitee_id IS NOT NULL THEN
    PERFORM public.notify_league_invite_internal(
      v_invitee_id, v_league.name, v_team_name, p_league_id, v_invite.token);
  END IF;

  RETURN jsonb_build_object(
    'invite_id', v_invite.id,
    'token', v_invite.token,
    'expires_at', v_invite.expires_at,
    'resent', false
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION create_league_invite(UUID, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- revoke_league_invite — 062:479-516's FILE TEXT (D137), 1 hunk (+14 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revoke_league_invite(p_league_id UUID, p_invite_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'revoke_league_invite: must be signed in'
      USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.league_id, i.revoked_at INTO v_invite
  FROM public.league_invites i
  WHERE i.id = p_invite_id
  FOR UPDATE;
  -- Nonexistent invite, an invite belonging to a DIFFERENT league (R86 — the
  -- nested route's [id] segment is load-bearing), and non-commish all yield
  -- the SAME error (no existence leak — the soft_delete_league pattern).
  IF NOT FOUND
     OR v_invite.league_id IS DISTINCT FROM p_league_id
     OR NOT public.is_league_commish(v_invite.league_id) THEN
    RAISE EXCEPTION 'revoke_league_invite: not a commissioner of this invite''s league'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotent no-op (D63 retry doctrine).
  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.league_invites
  SET revoked_at = now()
  WHERE id = p_invite_id;

  -- 169/L.E1.30 (F32) — THE RECEIPT: the invite and its seat, never the
  -- token or who it was for (TD9).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'revoke_league_invite', 'revoke_invite', 'invite',
    p_invite_id::text, NULL,
    jsonb_build_object('revoked', FALSE),
    jsonb_build_object('revoked', TRUE),
    (SELECT jsonb_build_object(
       'target_team_id', i.target_team_id,
       'team_name', (SELECT t.name FROM public.teams t WHERE t.id = i.target_team_id),
       'affected_team_ids', CASE WHEN i.target_team_id IS NULL THEN '[]'::jsonb
                                 ELSE jsonb_build_array(i.target_team_id) END)
     FROM public.league_invites i WHERE i.id = p_invite_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION revoke_league_invite(UUID, UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- rotate_invite_code — 062:523-566's FILE TEXT (D137), 1 hunk (+9 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rotate_invite_code(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code TEXT;
  v_attempts INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'rotate_invite_code: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rotate_invite_code: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Same generator as create_league (10 hex chars; 001 UNIQUE backs it).
  -- invite_slug is DELIBERATELY untouched (§7.2 "rotatable" is the code).
  LOOP
    v_attempts := v_attempts + 1;
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    BEGIN
      UPDATE public.leagues
      SET invite_code = v_code,
          updated_at = now()
      WHERE id = p_league_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  -- 169/L.E1.30 (F32) — THE RECEIPT: the code was replaced. Neither code is
  -- recorded (a join credential — TD9).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'rotate_invite_code', 'rotate_invite_code', 'league',
    p_league_id::text, NULL,
    NULL,
    jsonb_build_object('invite_code_rotated', TRUE),
    NULL);

  RETURN jsonb_build_object('invite_code', v_code);
END;
$$;
REVOKE EXECUTE ON FUNCTION rotate_invite_code(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- set_league_invite_slug — 062:573-631's FILE TEXT (D137), 4 hunks (+18 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_league_invite_slug(p_league_id UUID, p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug TEXT;
  v_old_slug TEXT;  -- 169/L.E1.30: the slug as it stood, for the receipt
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'set_league_invite_slug: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_league_invite_slug: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  v_old_slug := (SELECT l.invite_slug::text FROM public.leagues l WHERE l.id = p_league_id);  -- 169/L.E1.30

  -- NULL clears the slug (§15.1 "set/clear"): joins fall back to the code.
  IF p_slug IS NULL THEN
    UPDATE public.leagues
    SET invite_slug = NULL,
        updated_at = now()
    WHERE id = p_league_id;
    -- 169/L.E1.30 (F32) — THE RECEIPT (none when there was no slug to clear).
    PERFORM public.draft_commish_receipt_internal(
      p_league_id, FALSE, 'set_league_invite_slug', 'set_invite_slug', 'league',
      p_league_id::text, NULL,
      jsonb_build_object('invite_slug', v_old_slug),
      jsonb_build_object('invite_slug', NULL),
      NULL);
    RETURN jsonb_build_object('invite_slug', NULL);
  END IF;

  -- Slug contract (D72): 3–40 chars, lowercase [a-z0-9-], alphanumeric at
  -- both ends; stored lowercased (CITEXT uniqueness is case-insensitive).
  v_slug := lower(btrim(p_slug));
  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN
    RAISE EXCEPTION 'set_league_invite_slug: invite_slug must be 3-40 characters of letters, numbers, and hyphens, starting and ending with a letter or number'
      USING ERRCODE = 'P0001';
  END IF;
  -- Code-shadow guard (D72): §16.1 resolves invite_code BEFORE invite_slug,
  -- so a slug with the exact generated-code shape (10 lowercase hex) could
  -- be shadowed by — or squat on — a share code. Refuse the shape outright.
  IF v_slug ~ '^[0-9a-f]{10}$' THEN
    RAISE EXCEPTION 'set_league_invite_slug: that invite_slug has the shape of a share code — use a different length or include a letter beyond a-f'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.leagues
    SET invite_slug = v_slug,
        updated_at = now()
    WHERE id = p_league_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'set_league_invite_slug: that invite_slug is already taken by another league'
      USING ERRCODE = 'P0001';
  END;

  -- 169/L.E1.30 (F32) — THE RECEIPT (none when the slug is the one it had).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'set_league_invite_slug', 'set_invite_slug', 'league',
    p_league_id::text, NULL,
    jsonb_build_object('invite_slug', v_old_slug),
    jsonb_build_object('invite_slug', v_slug),
    NULL);

  RETURN jsonb_build_object('invite_slug', v_slug);
END;
$$;
REVOKE EXECUTE ON FUNCTION set_league_invite_slug(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- update_league_settings — 118:2438-2623's FILE TEXT (D137), 3 hunks (+19 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_league_settings(
  p_league_id UUID,
  p_team_count INTEGER,
  p_settings JSONB,
  p_roster_settings JSONB,
  p_scoring_system_id UUID,  -- NULL = keep the current reference
  -- Remaining §12.1 typed columns, explicit and mandatory (splitSettings is
  -- the authority — the service maps every TYPED_COLUMN_KEY to p_<key>
  -- mechanically, exactly as create_league does. D68/D70).
  p_format TEXT,
  p_regular_season_weeks INTEGER,
  p_playoff_teams INTEGER,
  p_playoff_start_week INTEGER,
  p_waiver_type TEXT,
  p_faab_budget INTEGER,
  p_trade_review TEXT,
  p_trade_deadline_week INTEGER,
  p_lineup_lock TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_current_scoring UUID;
  v_current_faab_budget INTEGER;
  v_snapshot JSONB;
  v_new_scoring UUID;
  v_seated INTEGER;
  v_attach_rules JSONB;   -- D169 arm (b)
  v_prior JSONB;          -- 169/L.E1.30: the settings as they stood, for the receipt
  v_diff JSONB;           -- 169/L.E1.30: the keys that changed
BEGIN
  -- 1. In-body authorization (§12.0/§8.3): commissioner or co-commissioner.
  --    A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'update_league_settings: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Row lock (serializes with concurrent PATCHes and status transitions);
  --    soft-deleted leagues are not found.
  SELECT l.status, l.scoring_system_id, l.faab_budget, l.scoring_rules_snapshot
    INTO v_status, v_current_scoring, v_current_faab_budget, v_snapshot
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_league_settings: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. §7.3 header status gate: structural settings are editable only in
  --    setup/scheduled; the post-draft path is an audited commissioner
  --    override (M6). The route maps this to a clear 409.
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'update_league_settings: league % is in % — settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 3.5 F28 shrink floor: team_count >= franchises already seated (retired
  --     franchises don't count — their slot was freed, §7.2.1(b)). The
  --     league-row lock above serializes this count with 062's join/claim
  --     capacity checks.
  SELECT count(*)::int INTO v_seated
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF p_team_count < v_seated THEN
    RAISE EXCEPTION 'update_league_settings: team_count % is below the % franchises already seated in this league — remove a team first (§7.2 capacity; F28)',
      p_team_count, v_seated
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Q10 backstops (R75/D69 — same order + shape as create_league).
  IF p_playoff_start_week < 13 OR p_playoff_start_week > 16 THEN
    RAISE EXCEPTION 'update_league_settings: playoff_start_week must be between 13 and 16 (currently week %) (§7.3.1, Q10/v2.8.6)',
      p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;
  IF p_playoff_start_week <> p_regular_season_weeks + 1 THEN
    RAISE EXCEPTION 'update_league_settings: playoff_start_week must be the week after the regular season ends — week % for a %-week regular season (currently week %) (§7.3.8, Q10/v2.8.6)',
      p_regular_season_weeks + 1, p_regular_season_weeks, p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;

  -- 4b. Q39 (C) — spec v2.16.25 §7.3.1 / §11.7 (Chris 2026-09-07): a total-points
  -- league has NO playoff bracket — the season-long points race IS its
  -- playoff — so `playoff_teams > 0` with `schedule_mode = total_points` is
  -- refused at settings time with a plain message (the same backstop shape
  -- as Q10's: validateLeagueSettings catches it first on the API path; a
  -- direct caller meets it here). The message names `playoff_teams` and no
  -- other marker (the leagues-service field mapper is first-match).
  IF p_playoff_teams > 0 AND COALESCE(p_settings ->> 'schedule_mode', 'h2h') = 'total_points' THEN
    RAISE EXCEPTION 'update_league_settings: playoff_teams must be 0 for a total-points league — the season-long points race is its playoff and there is no bracket; set playoff teams to 0 or switch to head-to-head (§11.7, Q39 (C))'
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. ATTACHABLE SCOPE (§7.3.8 v2.11 via D169; was v1 templates-only). A
  --    template — 061's original predicate, both conjuncts, unchanged — OR the
  --    league's own currently-referenced row, which is what makes a settings
  --    PATCH that merely re-sends the current custom reference legal. Anything
  --    else (a personal research system, another league's fork) still refuses.
  IF p_scoring_system_id IS NOT NULL
     AND p_scoring_system_id IS DISTINCT FROM v_current_scoring
     AND NOT EXISTS (
    SELECT 1 FROM public.scoring_systems s
    WHERE s.id = p_scoring_system_id
      AND s.is_template = TRUE
      AND s.owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'update_league_settings: scoring_system_id must reference one of the scoring templates, or the league''s own forked custom scoring system — personal scoring systems and other leagues'' systems cannot be attached (§7.3.8 v2.11, §7.3.3.1)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 5b. D169's ATTACH-VALIDATION arm (spec §7.3.3.1(5): "the server write path
  --     (editor save + settings attach) MUST reject an invalid doc"). Defense
  --     in depth over D175's wall, and the ONLY check in this function on a
  --     same-row re-attach, because step 6's re-freeze does not fire there.
  IF p_scoring_system_id IS NOT NULL THEN
    SELECT s.rules INTO v_attach_rules
    FROM public.scoring_systems s WHERE s.id = p_scoring_system_id;
    -- SHADOWED, NOT UNREACHABLE — and it stays (R649). Step 5 above already
    -- refuses a nonexistent id that differs from the current reference, and the
    -- FK refuses the equal-to-current arm, so no probe reaches this RAISE
    -- today. But step 5's `NOT EXISTS` and this `SELECT … INTO` are SEPARATE
    -- STATEMENTS over separate snapshots under read committed, and step 5 takes
    -- no tuple lock — the same unlocked cross-table premise wall 3 bought a row
    -- lock for (R626). A template deleted and committed between the two lands
    -- here. Deleting it would also make the two walls disagree on an idiom 104
    -- carries byte-identically, and would downgrade an accurate message into
    -- `scoring_rules_validate(NULL)`'s "must be a JSON object; got nothing" —
    -- loud for the wrong reason, which is precisely what CLAUDE.md's
    -- assert-the-reason-for-emptiness rule points away from.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'update_league_settings: scoring system % does not exist (§7.3.8)',
        p_scoring_system_id
        USING ERRCODE = 'P0001';
    END IF;
    -- No catch, no wrap: 103's P0001 + MESSAGE/DETAIL/HINT propagates, which is
    -- the contract the settings route turns into a per-field error.
    PERFORM public.scoring_rules_validate(v_attach_rules);
  END IF;

  v_new_scoring := COALESCE(p_scoring_system_id, v_current_scoring);

  -- 6. §7.3.3 pre-draft re-freeze: a scoring change with an existing snapshot
  --    refreshes it from the NEW template's rules; a NULL snapshot stays NULL.
  IF v_new_scoring IS DISTINCT FROM v_current_scoring AND v_snapshot IS NOT NULL THEN
    SELECT s.rules INTO v_snapshot
    FROM public.scoring_systems s
    WHERE s.id = v_new_scoring;
  END IF;

  v_prior := public.league_settings_doc_internal(p_league_id);  -- 169/L.E1.30

  -- 7. The atomic write: every §12.1 typed column + blob as passed, and
  --    max_teams = p_team_count IN THE SAME STATEMENT (§12.1 NOTE — this is
  --    the sync rule's second writer, after create_league).
  UPDATE public.leagues
  SET format = p_format,
      team_count = p_team_count,
      max_teams = p_team_count,
      regular_season_weeks = p_regular_season_weeks,
      playoff_teams = p_playoff_teams,
      playoff_start_week = p_playoff_start_week,
      waiver_type = p_waiver_type,
      faab_budget = p_faab_budget,
      trade_review = p_trade_review,
      trade_deadline_week = p_trade_deadline_week,
      lineup_lock = p_lineup_lock,
      roster_settings = p_roster_settings,
      settings = p_settings,
      scoring_system_id = v_new_scoring,
      scoring_rules_snapshot = v_snapshot,
      updated_at = NOW()
  WHERE id = p_league_id;

  -- 8. §12.2 invariant maintenance: pre-draft (guaranteed by the status gate),
  --    faab_balance carries no history — re-seed every seat when the budget
  --    changes so all balances match the create/join/claim seeding (D70).
  IF p_faab_budget IS DISTINCT FROM v_current_faab_budget THEN
    UPDATE public.league_members
    SET faab_balance = p_faab_budget
    WHERE league_id = p_league_id;
  END IF;

  -- 169/L.E1.30 (F32) — THE RECEIPT: ONE row for the save, carrying exactly
  -- the settings that changed, each by its §7.3 key (the typed columns by
  -- name, each settings key, roster_settings whole — commish_change_setting's
  -- key space); a save that changes nothing writes nothing (by value).
  v_diff := public.league_receipt_diff_internal(
    v_prior, public.league_settings_doc_internal(p_league_id), 1);
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'update_league_settings', 'change_settings', 'league',
    p_league_id::text, NULL,
    jsonb_build_object('settings', v_diff -> 'before'),
    jsonb_build_object('settings', v_diff -> 'after'),
    jsonb_build_object('keys', (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
                                FROM jsonb_object_keys(v_diff -> 'after') k),
                       'league_status', v_status));
END;
$$;
REVOKE EXECUTE ON FUNCTION update_league_settings(
  UUID, INTEGER, JSONB, JSONB, UUID,
  TEXT, INTEGER, INTEGER, INTEGER, TEXT, INTEGER, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- update_league_profile — 064:84-133's FILE TEXT (D137), 3 hunks (+15 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_league_profile(
  p_league_id UUID,
  p_name TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL,
  p_clear_avatar BOOLEAN DEFAULT FALSE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
  v_prior JSONB;  -- 169/L.E1.30: the profile as it stood, for the receipt
  v_diff JSONB;   -- 169/L.E1.30
BEGIN
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'update_league_profile: commissioner only'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_league_profile: league % not found', p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object('name', l.name, 'avatar_url', l.avatar_url) INTO v_prior
  FROM public.leagues l WHERE l.id = p_league_id FOR UPDATE;  -- 169/L.E1.30

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) < 1 OR length(v_name) > 100 THEN
      -- Field-named message: the route maps it to a per-field 400.
      RAISE EXCEPTION 'name: League name must be between 1 and 100 characters'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.leagues
    SET name = v_name, updated_at = now()
    WHERE id = p_league_id;
  END IF;

  IF p_clear_avatar THEN
    UPDATE public.leagues
    SET avatar_url = NULL, updated_at = now()
    WHERE id = p_league_id;
  ELSIF p_avatar_url IS NOT NULL THEN
    UPDATE public.leagues
    SET avatar_url = p_avatar_url, updated_at = now()
    WHERE id = p_league_id;
  END IF;

  -- 169/L.E1.30 (F32) — THE RECEIPT: exactly what changed (name, avatar).
  v_diff := public.league_receipt_diff_internal(
    v_prior,
    (SELECT jsonb_build_object('name', l.name, 'avatar_url', l.avatar_url)
     FROM public.leagues l WHERE l.id = p_league_id));
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'update_league_profile', 'edit_league_profile', 'league',
    p_league_id::text, NULL,
    v_diff -> 'before', v_diff -> 'after', NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION update_league_profile(UUID, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- set_league_status — 059:247-326's FILE TEXT (D137), 1 hunk (+8 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_league_status(p_league_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_settings JSONB;
  v_draft_scheduled_at TIMESTAMPTZ;
BEGIN
  -- In-body authorization (§12.0/§8.3).
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'set_league_status: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR p_status NOT IN
     ('setup', 'scheduled', 'drafting', 'in_season', 'playoffs', 'complete') THEN
    RAISE EXCEPTION 'set_league_status: % is not a league status (§7.1)', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT l.status, l.settings INTO v_status, v_settings
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_league_status: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent no-op: a retried transition must not error (D63).
  IF v_status = p_status THEN
    RETURN;
  END IF;

  -- M1 refuses everything past `scheduled`; M2's draft_start is the
  -- sanctioned path into `drafting` (task item 1) and inherits the D43
  -- trigger mechanically.
  IF p_status IN ('drafting', 'in_season', 'playoffs', 'complete') THEN
    RAISE EXCEPTION
      'set_league_status: cannot move league % to % — the draft engine lands in M2; only setup ↔ scheduled are available',
      p_league_id, p_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Transitions FROM drafting+ (Reset Draft etc.) are §7.1 audited overrides
  -- owned by M2+/M6 — a league can only legitimately sit in setup/scheduled
  -- during M1.
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'set_league_status: league % is in % — transitions from draft/season states are managed by the draft engine (M2+)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- setup → scheduled: draft_scheduled_at must be present (missing key,
  -- jsonb null, and '' all refuse) and a real instant (cast raises loudly on
  -- garbage). Read at the D60(4) NESTED path settings.draft.draft_scheduled_at
  -- — the shape the sanctioned writers (L.A1.6 splitSettings via L.A1.12/13)
  -- actually produce; the pre-R67 top-level read could never succeed through
  -- them. SQL-native only — the full §7.3.8 validation runs in the L.A1.13
  -- Route Handler (task item 2).
  IF p_status = 'scheduled' THEN
    IF NULLIF(v_settings->'draft'->>'draft_scheduled_at', '') IS NULL THEN
      RAISE EXCEPTION
        'set_league_status: cannot schedule league % — settings.draft.draft_scheduled_at is not set (§7.1: scheduled means the draft has a date/time)',
        p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    v_draft_scheduled_at := (v_settings->'draft'->>'draft_scheduled_at')::timestamptz;
  END IF;

  UPDATE public.leagues
  SET status = p_status,
      updated_at = NOW()
  WHERE id = p_league_id;

  -- 169/L.E1.30 (F32) — THE RECEIPT: the lifecycle move.
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'set_league_status', 'lifecycle_change', 'league',
    p_league_id::text, NULL,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', p_status),
    NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION set_league_status(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- soft_delete_league — 060:323-359's FILE TEXT (D137), 1 hunk (+8 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_league(p_league_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ;
BEGIN
  -- In-body authorization (§12.0/§8.3): commissioner or co-commissioner.
  -- A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'soft_delete_league: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.deleted_at INTO v_deleted_at
  FROM public.leagues l
  WHERE l.id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Commish check passed but the row vanished (hard-delete race — not a
    -- sanctioned path): treat as already gone, idempotently.
    RETURN;
  END IF;

  -- Idempotent no-op: a retried delete must not error (D63 doctrine).
  IF v_deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.leagues
  SET deleted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_league_id;

  -- 169/L.E1.30 (F32) — THE RECEIPT: the league was deleted (soft — rule 8).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'soft_delete_league', 'delete_league', 'league',
    p_league_id::text, NULL,
    jsonb_build_object('deleted', FALSE),
    jsonb_build_object('deleted', TRUE),
    NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION soft_delete_league(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- scoring_fork_template — 105:277-424's FILE TEXT (D137), 1 hunk (+9 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scoring_fork_template(
  p_league_id   UUID,
  p_template_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status        TEXT;
  v_name          TEXT;
  v_current       UUID;
  v_template      JSONB;
  v_doc           JSONB;
  v_existing      UUID;
  v_new_id        UUID;
  v_rows          INT;
BEGIN
  -- 1. In-body authorization (§4.1/§12.0; 061's shape). A nonexistent league
  --    yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'scoring_fork_template: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- 2. The league row, LOCKED FIRST (the lock order stated in this file's
  --    banner: leagues before scoring_systems, every function, no exception).
  --    Soft-deleted leagues are not found.
  SELECT l.status, l.name, l.scoring_system_id
    INTO v_status, v_name, v_current
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scoring_fork_template: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. §7.3 header + §7.3.3.1's lifecycle bullet: the editor is a
  --    `setup`/`scheduled` surface. After draft start the doc is frozen
  --    verbatim in `scoring_rules_snapshot` and scoring changes are the
  --    existing commissioner-override law, which this surface does not expose.
  --    **This is the DoD break-probe target** (pgTAP 053 §B4/§B5).
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'scoring_fork_template: league % is in % — scoring can only be customized while the league is in setup or scheduled; once the draft starts the rules are frozen into the league''s snapshot (§7.3 header, §7.3.3.1 lifecycle)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. The starting point must be a TEMPLATE (060/061's predicate, both
  --    conjuncts so the guard survives a change to 058's CHECK). §7.3.3.1: "a
  --    fork always starts from a template"; pre-existing personal systems stay
  --    unattachable (D33's one-namespace rule).
  SELECT s.rules INTO v_template
  FROM public.scoring_systems s
  WHERE s.id = p_template_id
    AND s.is_template = TRUE
    AND s.owner_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'scoring_fork_template: p_template_id must reference one of the scoring templates — a custom scoring system is always forked FROM a template, and personal scoring systems cannot be attached to a league (§7.3.3.1 entry point, §7.3.3)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 4b. Templates are format 1 by construction, and this refuses rather than
  --     folds if that ever stops being true: folding a fork into a fork would
  --     quietly discard its overrides (`forkTemplateDoc`'s own refusal, mirrored).
  IF v_template ? 'format' THEN
    RAISE EXCEPTION
      'scoring_fork_template: template % already carries a "format" member — a fork always starts from a format-1 template document (§7.3.3.1)',
      p_template_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. The format-2 fork document (§7.3.3.1's printed shape). `base` is the
  --    template's flat map VERBATIM — which is what makes a fresh fork score
  --    identically to its template for every position (the fork-equivalence
  --    property). `positions` starts EMPTY: a fresh fork overrides nothing.
  --    `tier_cuts` is the inherited family, detected from the keys.
  v_doc := jsonb_build_object(
    'format',    2,
    'base',      v_template,
    'positions', '{}'::JSONB,
    'tier_cuts', public.scoring_detect_tier_cuts(v_template)
  );

  -- 6. IDEMPOTENCY, before any write (see this section's banner).
  SELECT s.id INTO v_existing
  FROM public.scoring_systems s
  WHERE s.id = v_current
    AND s.is_template = FALSE
    AND s.rules = v_doc
    AND EXISTS (
      SELECT 1 FROM public.league_members m
      WHERE m.league_id = p_league_id
        AND m.user_id = s.owner_id
        AND m.role IN ('commissioner', 'co_commissioner')
    );
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- 7. Defense in depth, not the guard: wall 1 refuses this document at the
  --    INSERT below whatever happens here. The RPC is the FRONT DOOR and this
  --    is where the error is raised with the caller's own action in view — the
  --    layered posture D175(1) describes. The contract is 103's, unwrapped:
  --    P0001 + MESSAGE (guardrail named) + DETAIL (dot path) + HINT (family).
  PERFORM public.scoring_rules_validate(v_doc);

  -- 8. The fork row. `is_template` is NOT settable by this RPC — it is written
  --    FALSE as a literal, so the fork can never mint a world-readable
  --    template (D59's ownerless CHECK is the second gate; pinned §D).
  --    `owner_id` is the CALLER, per §12.25 ("owner_id = commissioner").
  INSERT INTO public.scoring_systems (name, description, owner_id, is_template, rules)
  VALUES (
    v_name || ' Custom',
    'Custom scoring forked from a template for this league (§7.3.3.1).',
    (SELECT auth.uid()),
    FALSE,
    v_doc
  )
  RETURNING id INTO v_new_id;

  -- 9. The repoint, in the SAME transaction (§7.3.3.1: "which
  --    leagues.scoring_system_id then references"). This write goes through
  --    WALL 3, which re-resolves the row and re-validates its document — so the
  --    league's reference is checked by the same guard that checks every raw
  --    write, not by this function's say-so.
  UPDATE public.leagues
  SET scoring_system_id = v_new_id,
      updated_at = NOW()
  WHERE id = p_league_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- CLAUDE.md: never let "nothing happened" mean "it worked". The row is held
  -- FOR UPDATE above, so 0 rows here is impossible — which is exactly why a
  -- silent 0 would be the most dangerous outcome this function could produce.
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'scoring_fork_template: repointing league % at the new scoring system matched % rows, expected 1',
      p_league_id, v_rows
      USING ERRCODE = 'P0001';
  END IF;

  -- 169/L.E1.30 (F32) — THE RECEIPT: the league now scores by its own
  -- custom copy of the template.
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'scoring_fork_template', 'fork_scoring', 'league',
    p_league_id::text, NULL,
    jsonb_build_object('scoring_system_id', v_current),
    jsonb_build_object('scoring_system_id', v_new_id),
    jsonb_build_object('template_id', p_template_id, 'scoring_system_name', v_name || ' Custom'));

  RETURN v_new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.scoring_fork_template(UUID, UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- scoring_update_rules — 105:461-555's FILE TEXT (D137), 3 hunks (+17 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scoring_update_rules(
  p_league_id UUID,
  p_rules     JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status      TEXT;
  v_current     UUID;
  v_is_template BOOLEAN;
  v_owner       UUID;
  v_rows        INT;
  v_prior_rules JSONB;  -- 169/L.E1.30: the document as it stood, for the receipt
  v_diff        JSONB;  -- 169/L.E1.30
BEGIN
  -- 1. In-body authorization, 061's shape (no existence leak).
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'scoring_update_rules: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- 2. The league row, LOCKED FIRST (this file's lock order).
  SELECT l.status, l.scoring_system_id INTO v_status, v_current
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scoring_update_rules: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. The same §7.3/§7.3.3.1 window as the fork.
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'scoring_update_rules: league % is in % — scoring can only be edited while the league is in setup or scheduled; once the draft starts the rules are frozen into the league''s snapshot (§7.3 header, §7.3.3.1 lifecycle)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'scoring_update_rules: league % references no scoring system — fork a template first (§7.3.3.1 entry point)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT s.is_template, s.owner_id INTO v_is_template, v_owner
  FROM public.scoring_systems s WHERE s.id = v_current;

  -- 4. Templates are never edited (§7.3.3.1: "Templates themselves are never
  --    edited (the D59 ownerless CHECK stands)"). The message is the editor's
  --    instruction, not a diagnosis.
  IF v_is_template THEN
    RAISE EXCEPTION
      'scoring_update_rules: league % is on a shared template — fork first, templates are immutable (§7.3.3.1)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. …and the row must be the league's OWN fork, not some other row a
  --    privileged write left in front of the league. Same predicate as the
  --    fork RPC's idempotency clause (see §2's banner for why it is
  --    "a commissioner of this league" and not `= auth.uid()`).
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id
      AND m.user_id = v_owner
      AND m.role IN ('commissioner', 'co_commissioner')
  ) THEN
    RAISE EXCEPTION
      'scoring_update_rules: league % references scoring system %, which is not this league''s own forked custom row — only a system forked by this league''s commissioner can be edited here (§7.3.3.1, §12.25)',
      p_league_id, v_current
      USING ERRCODE = 'P0001';
  END IF;

  -- 6. The five guardrail families, INCLUDING normal form (see this section's
  --    banner). Front door; wall 1 is the law behind it.
  PERFORM public.scoring_rules_validate(p_rules);

  v_prior_rules := (SELECT s.rules FROM public.scoring_systems s WHERE s.id = v_current);  -- 169/L.E1.30
  UPDATE public.scoring_systems
  SET rules = p_rules,
      updated_at = NOW()
  WHERE id = v_current;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'scoring_update_rules: writing scoring system % matched % rows, expected 1',
      v_current, v_rows
      USING ERRCODE = 'P0001';
  END IF;

  -- 169/L.E1.30 (F32) — THE RECEIPT: ONE row for the save, carrying exactly
  -- the rules that changed, each by its path in the document
  -- ("base.receptions", "positions.TE.receptions"); an unchanged save writes
  -- nothing (by value).
  v_diff := public.league_receipt_diff_internal(v_prior_rules, p_rules);
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'scoring_update_rules', 'edit_scoring', 'league',
    p_league_id::text, NULL,
    jsonb_build_object('scoring_rules', v_diff -> 'before'),
    jsonb_build_object('scoring_rules', v_diff -> 'after'),
    jsonb_build_object('scoring_system_id', v_current,
                       'keys', (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
                                FROM jsonb_object_keys(v_diff -> 'after') k)));

  RETURN v_current;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.scoring_update_rules(UUID, JSONB) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- set_lineup_internal — 157:404-1079's FILE TEXT (D137), 1 hunk (+15 / -0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT DEFAULT NULL   -- REQUIRED (non-blank) when the actor is not the team's manager (R738 / D290)
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;   -- the CURRENT week's datum (IR moves are judged against it — R736)
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  v_stored_at   TEXT;
  v_locked      BOOLEAN;
  v_min_weeks   INTEGER;
  v_msg         TEXT;
  -- 152 / R1206: stored starters who PLAYED and have left this roster since
  -- (player_id → {kickoff_at, datum_arm, on_bye}) — fixed for the week.
  v_gone_kick   JSONB := '{}'::jsonb;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'set_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     One no-leak 42501 for "no such league", "not a member", "not this
  --     team's manager and not a commissioner".
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'set_lineup: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written.
  SELECT a.result INTO v_result
  FROM public.lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'set_lineup: league % is % — lineups are set only while in_season or in playoffs (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'set_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'set_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  IF p_week < v_current THEN
    RAISE EXCEPTION
      'set_lineup: week % is in the past (the current week is %) — a past week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, v_current
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    RAISE EXCEPTION
      'set_lineup: week % of league % is % — a closed week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, p_league_id, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- The COMMISSIONER ARM carries the D290 interim audit posture (R738 / F40):
  -- a real change by an actor who is not this team's manager posts the
  -- in-txn system message below. RE-READ UNDER Q66 (migration 131 / L.E1.15,
  -- F362; spec v2.16.41 §10.3 / §15.4 — a commissioner setting another
  -- team's lineup IS a commissioner action): the reason is OPTIONAL, so it is
  -- NORMALISED here and never refused. Blank = nothing but whitespace
  -- INCLUDING tabs/newlines (R745) ⇒ NULL; bounded at 500 characters below,
  -- the client chat policy's own bound, so the system post stays bounded
  -- (R746) — that check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'set_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'set_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- (4b) 152 / R1206 (Q32's amendment, verbatim: "if they are in the lineup
  --      they are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN
  --      AFTER HE LEAVES THE ROSTER. Once a week's last game has ended the
  --      lock releases (E32 / 115) and a starter who played can be dropped,
  --      claimed away or traded, while the week is still current (live)
  --      until the next week starts; 152 keeps his finished-week start (the
  --      week is scored and re-scored from this slot_map). A stored STARTING
  --      slot whose player is not on this roster and whose OWN game for
  --      p_week has kicked off is therefore FIXED: carried through unchanged
  --      (the editor never holds an unrostered player — placementFromStored
  --      — so an omitted key is carried, not read as "empty it"), and a
  --      submit that puts anyone else there, or moves him, is refused by
  --      name. He joins v_by_pid (never v_roster: no bench, no roster write)
  --      so steps 7–10 treat him as the locked starter he is. A stored
  --      unrostered player whose game has NOT kicked off (a bye) did not
  --      play: his slot opens, as before.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',          p.id,
             'name',               p.full_name,
             'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation',        public.lineup_designation_internal(p.status),
             'nfl_team',           p.team,
             'ir_placed_week',     NULL,
             'ir_lock_until_week', NULL,
             'slot_key',           NULL,
             'off_roster',         TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    -- 154 / F441 · F442 · F445: ONE judgment, shared with the commissioner's
    -- editor and autopilot (lineup_kept_starter_internal). He STAYS when he
    -- PLAYED — his current NFL team's game kicked off, this lineup's own
    -- record of the slot says so, or he has a stat line for the week (F442: a
    -- player released or traded after playing still reads as played) — or
    -- when the week CLOSED to moves (its lock release: the last game's end or
    -- the Wednesday ceiling) before he left and he has a game this week
    -- (D412(5) / F445: a player of the unplayed game stays in the lineup that
    -- started him). A bye, or a game gone from the week, scores nothing: his
    -- slot opens, as before (D411(7)).
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(v_league.season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;
    IF ((p_slot_map ? v_key) AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid)
       OR EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE x.key <> v_key AND (x.value #>> '{}') = v_pid) THEN
      IF v_k.why = 'kicked_off' THEN
        RAISE EXCEPTION
          'set_lineup: % already played this week — his start stays (slot "%": his game kicked off at % (%); he has left %''s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)',
          v_e ->> 'name', v_key, v_k.kickoff_at, v_k.datum_arm, v_team.name
          USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION
        'set_lineup: % is held in this week''s lineup — his start stays (slot "%": %; he has left %''s roster since, and no move changes the start he holds this week — §11.2, Q32, D412(5); the week is scored from this lineup, §7.3.3)',
        v_e ->> 'name', v_key, v_k.detail, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_gone_kick := v_gone_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    p_slot_map := p_slot_map || jsonb_build_object(v_key, v_pid);   -- carried
  END LOOP;

  -- (5) VALIDATE THE SUBMITTED MAP: keys are slot instances or IR spots,
  --     values are this team's rostered players, each player exactly once.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'set_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'set_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'set_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'set_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — for p_week (the
  --     starters) and for the current week (IR moves) when they differ.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  -- 157 / F447: each ROSTERED player's kickoff is judged per PLAYER — his
  -- current NFL team's game, or, when that is still ahead (or he has no
  -- team), a start this league recorded for a game that kicked off or his
  -- stat line for the week (lineup_player_kickoff_internal): a player the
  -- NFL released or traded AFTER he played is still locked for the week.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> 'player_id', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> 'player_id', p_at);   -- 157 / F447
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  v_kick := v_kick || v_gone_kick;   -- 152 / R1206: (4b)'s played, since-unrostered starters
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) LOCKED PLAYERS NEVER MOVE (per_player_kickoff — the ONLY lineup lock,
  --     Q34(A)). Evaluated BEFORE the fit so a locked stored starter is a
  --     FIXED vertex, and a played player can neither enter nor change slots.
  --     114: the mode test that used to guard this block is gone — it is
  --     unconditional.
    -- (a) every stored starter whose game has kicked off must sit at the
    --     same key in the submitted map.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN NOT (v_by_pid ? v_pid);                       -- off the roster and NOT played (a played one is in v_by_pid since (4b) — 152 / R1206)
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: slot % is locked — % kicked off at % (%) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
          v_key, v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm'
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    -- (b) a player whose game has kicked off never enters a slot he was not
    --     already stored at.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (v_stored ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: %''s game kicked off at % (%) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "%"',
          v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm', v_key
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

  -- (8) THE FIT (E16). Input order: fixed (locked) players first, then the
  --     rest in submitted-key order — deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     x.fixed) ORDER BY x.fixed DESC, x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord,
           -- fixed = locked: the player's OWN kickoff has passed (R737 — a
           -- locked placement is a fact; 114: the whole-week arm is gone).
           ((v_kick -> (e.value #>> '{}') ->> 'kickoff_at') IS NOT NULL
            AND (v_kick -> (e.value #>> '{}') ->> 'kickoff_at')::timestamptz <= p_at)
           OR v_gone_kick ? (e.value #>> '{}') AS fixed   -- 154 / F445: a kept off-roster starter is FIXED even while his (postponed) game is ahead
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'set_lineup: % (%) cannot be placed — no legal arrangement of the started players fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- 114 (Q34(A)): the whole-week refusal that stood here is RETIRED. After the
  -- week's first kickoff every UNLOCKED slot of the lineup stays editable;
  -- only a slot whose own player has kicked off is closed (step 7).

  -- (9) IR MOVES, against the CURRENT week (banner: IR LAW).
  --     Placements: under an IR key now, not on IR (or on a different spot) before.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      -- a NEW placement (or a spot change, which is removal + placement)
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        RAISE EXCEPTION
          'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
          v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'set_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        RAISE EXCEPTION
          'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
          v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
          USING ERRCODE = 'P0001';
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  --     Removals: on IR before, not under any IR key now.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      RAISE EXCEPTION
        'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
        v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      RAISE EXCEPTION
        'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
        v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
        USING ERRCODE = 'P0001';
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  v_locked_at := NULL;   -- 114: the earliest STARTED player's kickoff (below), never a week datum
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE: a bye/OUT starter in an
      -- UNLOCKED slot blocks the submit by name.
      -- (a locked slot's bye/OUT player is not the manager's to change:
      --  exempt when the stored player's own game has kicked off, R739.)
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT ((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) = v_pid)
         AND NOT (v_gone_kick ? v_pid) THEN   -- 154 / F445: a kept off-roster starter is not the manager's to change
        RAISE EXCEPTION
          'set_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him or start someone who plays',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- (11) NO-OP BY NAME (rule 10): the canonical map equals the stored map
  --      and no IR move — nothing is written but the ledger row.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = NOT v_is_manager,
        set_at            = now()
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'set_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- R738 / D290 / D97: a commissioner's change posts in-txn, reason in the
    -- text (the interim audit until commissioner_actions exists — F40).
    IF NOT v_is_manager THEN
      v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' set by '
        || public.draft_actor_name() || ' (commissioner)'
        || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional
      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
      VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
      -- 169/L.E1.30 (F514) — THE RECEIPT: a commissioner setting a team he
      -- does not manage is a commissioner action (D363(2)) — one row per
      -- changed lineup, the team acted for in acting_as_team_id (§10.3). The
      -- no-op re-save wrote nothing above; a manager's own save (the
      -- commissioner's own team included) is not this arm.
      PERFORM public.draft_commish_receipt_internal(
        p_league_id, FALSE, 'set_lineup', 'edit_lineup', 'team', p_team_id::text, v_reason,
        jsonb_build_object('slot_map', v_stored),
        jsonb_build_object('slot_map', v_canon)
          || CASE WHEN jsonb_array_length(v_ir_placed) + jsonb_array_length(v_ir_removed) > 0
                  THEN jsonb_build_object('ir_moves', jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed))
                  ELSE '{}'::jsonb END,
        jsonb_build_object('week', p_week, 'current_week', v_current, 'season', v_league.season,
                           'week_status', v_lw.status, 'team_name', v_team.name, 'action_id', p_action_id),
        p_team_id);
    END IF;

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week: starters → instance key, the rest
      -- (not on IR) → 'bn'. Counts asserted against the roster.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        CONTINUE WHEN v_gone_kick ? (v_val #>> '{}');   -- 152 / R1206: off this roster — no roster row of his to write
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick)) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key for % starters, expected %', v_expected,
          COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick))
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,   -- 114: the CHECK-constrained column value (only 'per_player_kickoff' exists)
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      NOT v_is_manager,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free)
  );

  INSERT INTO public.lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION set_lineup_internal(UUID, UUID, INTEGER, JSONB, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
