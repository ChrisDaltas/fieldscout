-- ============================================================================
-- League invite RPCs — M1 task L.A1.14. Spec: §7.2 (all four invite paths;
-- E53/E54/E65), §12.23 (league_invites; claim path = SECURITY DEFINER RPC
-- keyed by token; pre-auth preview exposes ONLY league name + team label +
-- inviter display name — D48/erratum v2.7.1), §15.1 (invite/join/claim/slug
-- routes), §16.1 (/join/[token] resolves invite_code | custom slug | seat
-- token), §16.4 (identity display rule; invite funnel), §22.5 ("Invite codes
-- rotate on demand"), §12.2 (faab_balance seeded from leagues.faab_budget on
-- join; cache + stint written in the same txn — v2.1 note), §12.22 (stints),
-- §17 (join is free — Q6/v2.8: NO Pro gate anywhere on create/join).
-- PROGRESS: D36 (username matching via lower()), D37 (email seam — the RPCs
-- record send-intent on the row; the sender is app infra), D46
-- (created_at = initial send, last_sent_at on re-send), D47 (join at
-- capacity = friendly "league is full", NO unseated member rows), D48
-- (preview = three fields), D72 (this migration's mechanics). Ledger: F2
-- (preview field-exposure pin), F3 (never reuse a prior stint's started_at —
-- stint inserts use clock_timestamp()), F5 (join/claim carry no Pro gate),
-- F6 (claim algebra in-body), F28 (companion floor amendment in 061).
--
-- NUMBERING (D50(1) precedent): next free migration at task time is **062**
-- (061 = update_league_settings, landed); next free pgTAP file is **016**.
--
-- AMENDED IN PLACE 2026-07-26 by L.A1.15 (D74(1)(2)) — legal because this
-- migration is unreleased: prod's history still ends at 036 (F12), and 061
-- carries the same precedent (its F28 floor was amended in by L.A1.14).
-- The amendment is confined to `seat_league_member_internal` (new p_team_id
-- parameter + the placeholder FILL) and `claim_league_invite`'s seat-targeted
-- branch (now calls the helper instead of open-coding a blind INSERT). No
-- other behavior changes; pgTAP 016's helper-signature/ACL pins moved with
-- the signature. See item 1 below for the defect this fixes.
--
-- Contents (all SECURITY DEFINER, SET search_path = '', in-body auth,
-- REVOKE FROM PUBLIC, anon — §4.1 — EXCEPT get_join_preview's deliberate,
-- documented anon carve-out, §4.1's named exception):
--
--   1. `seat_league_member_internal(league, user, faab_budget, team_id)` — the
--      ONE seating implementation shared by join_league_by_code, the general
--      claim path, the seat-targeted claim path and (from 063) assign_manager
--      (copies would drift — CLAUDE.md's no-near-duplicate rule; D74(2)):
--      teams row (auto-named "<display name>'s Team", list_id NULL — D35a)
--      + league_members row (role 'manager', faab_balance := faab_budget —
--      §12.2) + OPEN stint, one txn (§12.2 v2.1 note).
--      **p_team_id (added 2026-07-26, L.A1.15 — amend-in-place, F12: prod
--      history still ends at 036):** NULL = create a new franchise (join /
--      general claim, unchanged). NON-NULL = seat onto an EXISTING franchise,
--      which is the placeholder-fill path. There the stint INSERT runs FIRST
--      (an occupied seat trips one_open_stint_per_team — E54's named
--      mechanism, preserved), then the league_members write is a **fill**:
--      UPDATE the placeholder row (user_id IS NULL) in place and only INSERT
--      when no row exists for that seat. The blind INSERT this replaces made
--      a §7.2:170-shaped placeholder seat UNCLAIMABLE — live-proven before
--      the fix: UNIQUE(league_id, team_id) raised 23505, the claim's
--      unique_violation arm swallowed it as `seat_filled`, EXPIRED the good
--      invite and notified the commissioner (D74(1)). Finally owner_id
--      follows the new manager and an 'orphaned' franchise (a vacated seat,
--      063) returns to 'active' — §7.2.1(c) "orphaned is a holding state that
--      resolves into (a) or (b)"; a claim IS resolution (a).
--      Stint started_at = clock_timestamp(), not
--      now(): now() is txn-frozen, so a remove→re-claim inside one txn would
--      reuse the prior stint's started_at and hit UNIQUE(team_id, user_id,
--      started_at) — the exact F3 failure; clock_timestamp() advances within
--      a txn, so a re-claim is always a NEW stint row (E51: two rows, no
--      merge). INTERNAL ONLY: plain (non-SECURITY-DEFINER — it executes in
--      the calling definer's context) with search_path = '' and EXECUTE
--      revoked from PUBLIC, anon AND authenticated — no client role can call
--      it; only the definer RPCs (running as the function owner) reach it.
--
--   2. `create_league_invite(league, target_team, email, username, max_uses)`
--      — commish-only in-body (42501). One RPC serves §7.2 paths 2–4:
--      invited_email set (path 2, v1 primary), invited_username set (path 3
--      — must reference an existing account, resolved via lower(username)
--      per D36; the CANONICAL profiles.username is stored), neither set
--      (path 4 open link / general multi-use link — max_uses may exceed 1).
--      Identity-restricted invites are single-use in-body (max_uses must be
--      1 — a multi-use invite locked to one identity is meaningless: claims
--      are idempotent per person). RE-SEND (D46): creating an invite whose
--      (league, target team, email/username) matches a LIVE outstanding row
--      (unrevoked, unexpired, uses remaining) does NOT mint a duplicate —
--      it stamps last_sent_at = now() on the existing row and returns it
--      with resent: true (created_at stays the initial-send record).
--      Username invites insert an in-app `notifications` row (type
--      'league_invite', deep-link data {league_id, token}) — guarded so a
--      notification failure can never break the invite write (D72).
--
--   3. `revoke_league_invite(league_id, invite_id)` — commish-only in-body (a
--      nonexistent invite yields the same 42501 — no existence leak, the
--      soft_delete_league pattern); sets revoked_at; already-revoked is an
--      idempotent no-op success (D63 retry doctrine). The league arg is
--      LOAD-BEARING (R86, batch 14): the route is doubly nested
--      (`/api/leagues/[id]/invites/[iid]`) and every other doubly-nested
--      route in the repo constrains its parent segment, so an invite whose
--      league_id <> p_league_id is refused with the SAME 42501 — a
--      mis-addressed URL can no longer revoke another league's invite and
--      report 200. Compared with IS DISTINCT FROM so a NULL league arg from
--      a direct-PostgREST caller refuses rather than passing the test.
--
--   4. `rotate_invite_code(league_id)` — commish-only; regenerates
--      leagues.invite_code (10-hex, collision-retried against the 001
--      UNIQUE, create_league's generator); invite_slug DELIBERATELY
--      untouched (§7.2 "rotatable" applies to the code; §22.5). Old code
--      stops resolving the instant the txn commits.
--
--   5. `set_league_invite_slug(league_id, slug)` — commish-only; §7.2 path 1
--      custom slug. NULL clears (§15.1 "set/clear"). Contract
--      (Builder-finalized, D72 — the spec prints no slug format): 3–40
--      chars, lowercase [a-z0-9-], must start/end alphanumeric; stored
--      lowercased (the column is CITEXT — uniqueness is case-insensitive via
--      the 055 UNIQUE index). An exact 10-lowercase-hex value is REFUSED:
--      that is precisely the generated invite-code shape, and §16.1's claim
--      route resolves code BEFORE slug, so such a slug could be shadowed by
--      (or shadow-squat on) another league's share code. Taken slug →
--      friendly P0001.
--
--   6. `get_join_preview(p_value)` — THE PRE-AUTH SURFACE (§16.1's claim
--      route contract): resolves seat token → invite_code → invite_slug (in
--      that order; code/slug matching via lower() — CITEXT semantics without
--      depending on operator resolution under search_path = ''). Returns a
--      jsonb with EXACTLY the keys {found, type, status, league_name,
--      team_label, inviter_name, seats_open} (or {found: false}) — NEVER
--      invited_email, invited_username, the token, league ids, or any other
--      internals (F2; §12.23 as amended by D48). status ∈ ok | revoked |
--      expired | spent | seat_filled | league_full | joins_closed so the
--      /join/[token] page can render the E53/E54/expired/revoked states
--      pre-auth. ANON CARVE-OUT (§4.1's named exception, documented here):
--      REVOKE FROM PUBLIC, then explicit GRANT EXECUTE to anon +
--      authenticated — the pre-auth claim page is the growth loop (§16.4)
--      and the F2 field-exposure pin is the compensating control.
--
--   7. `claim_league_invite(p_token)` — §5-sketch claim path. Signed-in only
--      (42501). OUTCOME-JSONB CONTRACT (D72): refusals return
--      {ok: false, reason, message} instead of raising, because E54's
--      refusal must PERSIST writes (invite marked expired + commissioner
--      notified) — a RAISE would roll them back — and because the claim
--      card's refusal states are designed UX (§16.5.2). reason ∈ not_found |
--      revoked | expired | spent | mismatch | seat_unavailable |
--      seat_filled | joins_closed | league_full. In-body algebra (F6),
--      checked in order against the FOR UPDATE-locked invite+league rows:
--      revoked_at set → revoked; now() >= expires_at → expired (the invite
--      expires AT the instant — exactly-at refuses; defined + pinned, F6);
--      use_count >= max_uses → spent (already-a-member is checked FIRST
--      — idempotent {ok: true, already_member: true}, NO bump, D63: a
--      claimer's own retry after a spending claim must still succeed).
--      Identity match (E53/E65): invited_email
--      vs the claimer's JWT email claim (auth.jwt()->>'email', auth.users
--      fallback), case-insensitive; invited_username vs the claimer's
--      profiles.username via lower() (D36) — mismatch refuses with a
--      friendly message and the invite INTACT (no use_count bump, no
--      writes). Seat-targeted claims
--      (target_team_id set): stint INSERT runs FIRST so an occupied seat
--      hits the one-open-stint unique index (E54's named mechanism); the
--      23505 handler marks the invite expired (expires_at = now()),
--      notifies the commissioner (guarded — notification failure never
--      breaks the claim), and returns seat_filled. General claims: league
--      status must be setup/scheduled (auto-creating a franchise mid-draft/
--      mid-season would corrupt M2/M4 schedule machinery; M1 leagues only
--      legitimately sit in setup/scheduled — D63(5) class, D72; seat-
--      targeted claims to EXISTING franchises stay unrestricted, §7.2.1's
--      replacement-GM path), then capacity: active franchises >= team_count
--      → friendly "league is full" with NO writes (D47 — no unseated member
--      rows in M1). The league row is FOR UPDATE-locked before the count, so
--      concurrent joins serialize and teams count can never exceed
--      team_count. Success: seat via the internal helper on BOTH paths
--      (p_team_id NULL = general/new franchise; p_team_id set = the
--      seat-targeted FILL — amended 2026-07-26 by L.A1.15, D74(1)(2)), then
--      use_count + 1,
--      claimed_by/claimed_at = the most recent claim (§12.23 prints single
--      columns; use_count is the aggregate record — D72).
--
--   8. `join_league_by_code(p_code_or_slug)` — §7.2 "Join with invite code
--      (free — v2.8)": resolves invite_code first, then invite_slug (both
--      lower()-matched, case-insensitive), NO Pro gate and NO is_pro read
--      anywhere (F5 join half; C1: spec wins over the old CLAUDE.md rule 5).
--      Same outcome-jsonb contract, status gate, FOR UPDATE + capacity
--      check, and internal-helper seating as the general claim path.
--
-- SQLSTATE convention for the three COMMISH RPCs (R87, batch 14 — aligned
-- with the three-deep 059/061 precedent, 059:165, 059:246, 061:159 and 061's
-- banner "→ P0002 not found"): a soft-deleted (or otherwise invisible)
-- league raises **P0002**, which the service maps to 404 — NOT P0001/400.
-- Before this alignment a MALFORMED league id 404'd at the route while a
-- soft-DELETED one 400'd on the same handler, and set_league_invite_slug's
-- blanket P0001 → fieldErrors arm surfaced "this league has been deleted" as
-- an `invite_slug` validation error. P0001 stays what it is everywhere else
-- here: a genuine refusal of a well-formed request against a live league.
--
-- Held-lock note (plan §8.3): claim/join hold the league (and invite/team)
-- row locks across at most one count + three single-row inserts + one
-- single-row update — the minimal window the capacity invariant requires
-- (the D68(5)/D70(7) shape); no lock spans external work. rotate/slug hold
-- the league row across exactly one UPDATE.
--
-- Grants doctrine (D18→D23/§4.1): no per-object GRANTs; every function gets
-- the explicit REVOKE narrowing; get_join_preview alone re-GRANTs anon
-- (item 6); the internal helper additionally revokes authenticated.
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–062 + the full pgTAP suite is the
-- rehearsal evidence. Realtime line waived per D38 (no live subscriber in
-- the M1 UI slice). Typegen RE-RUN (R68 lesson: new PostgREST-exposed
-- functions change the generated surface); alias block re-appended, diff
-- verified additive-only. Prod-safe: new functions only; no table/column/
-- policy changes (F28's floor lands as an in-place amendment of unreleased
-- 061 — prod history still ends at 036, F12).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. seat_league_member_internal — the one seating implementation (INTERNAL)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seat_league_member_internal(
  p_league_id UUID,
  p_user_id UUID,
  p_faab_budget INTEGER,
  p_team_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_team_id UUID;
  v_team_name TEXT;
  v_filled INTEGER;
BEGIN
  IF p_team_id IS NULL THEN
    -- ---------------------------------------------------------------------
    -- (a) NEW franchise: join_league_by_code / general claim (unchanged).
    -- ---------------------------------------------------------------------
    -- "<display name>'s Team" (create_league's naming; profile always exists
    -- via handle_new_user).
    SELECT COALESCE(NULLIF(p.display_name, ''), p.username, 'My') || '''s Team'
      INTO v_team_name
    FROM public.profiles p
    WHERE p.id = p_user_id;
    v_team_name := COALESCE(v_team_name, 'My Team');

    -- Franchise (§7.2 "On join, a teams row is created"; list_id NULL — D35a).
    INSERT INTO public.teams (owner_id, name, league_id, list_id)
    VALUES (p_user_id, v_team_name, p_league_id, NULL)
    RETURNING id INTO v_team_id;

    -- Current-state cache (§12.2; faab_balance seeded from faab_budget).
    INSERT INTO public.league_members (league_id, user_id, team_id, role, faab_balance)
    VALUES (p_league_id, p_user_id, v_team_id, 'manager', p_faab_budget);

    -- Open stint (§12.22 — same txn as the cache write; clock_timestamp so a
    -- same-txn re-seat never reuses a prior stint's started_at, F3).
    INSERT INTO public.team_managers (league_id, team_id, user_id, role, started_at)
    VALUES (p_league_id, v_team_id, p_user_id, 'manager', clock_timestamp());

    RETURN v_team_id;
  END IF;

  -- -----------------------------------------------------------------------
  -- (b) EXISTING franchise: seat-targeted claim / assign_manager (L.A1.15).
  --     The caller has already locked the league and the teams row.
  -- -----------------------------------------------------------------------
  v_team_id := p_team_id;

  -- Stint FIRST so an occupied seat hits one_open_stint_per_team (E54's
  -- named mechanism — the caller's unique_violation handler owns the copy).
  INSERT INTO public.team_managers (league_id, team_id, user_id, role, started_at)
  VALUES (p_league_id, v_team_id, p_user_id, 'manager', clock_timestamp());

  -- FILL the placeholder cache row if one exists (§7.2:170 seats carry
  -- team_id, so a blind INSERT would trip UNIQUE(league_id, team_id) —
  -- D74(1)); otherwise create the cache row. faab_balance is re-seeded from
  -- the CURRENT budget either way (§12.2/v2.8.7 — never trust a stored
  -- placeholder balance).
  UPDATE public.league_members
  SET user_id = p_user_id,
      is_placeholder = FALSE,
      faab_balance = p_faab_budget
  WHERE league_id = p_league_id AND team_id = v_team_id AND user_id IS NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;
  IF v_filled = 0 THEN
    INSERT INTO public.league_members (league_id, user_id, team_id, role, faab_balance)
    VALUES (p_league_id, p_user_id, v_team_id, 'manager', p_faab_budget);
  END IF;

  -- owner_id follows the current manager (informational on league teams —
  -- D35b removed all client write paths for league_id IS NOT NULL); an
  -- orphaned franchise is resolved by being re-managed (§7.2.1(c)).
  UPDATE public.teams
  SET owner_id = p_user_id,
      status = CASE WHEN status = 'orphaned' THEN 'active' ELSE status END,
      updated_at = now()
  WHERE id = v_team_id;

  RETURN v_team_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION seat_league_member_internal(UUID, UUID, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. create_league_invite — §7.2 paths 2–4 (§15.1 POST /api/leagues/[id]/invites)
-- ----------------------------------------------------------------------------
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
      UPDATE public.league_invites
      SET last_sent_at = now()
      WHERE id = v_existing.id;
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

-- Guarded notification insert (INTERNAL — the guard lives in one place so
-- both the initial-send and re-send paths share it). Failure is swallowed by
-- design: a notification must never break the invite/claim write (D72).
CREATE OR REPLACE FUNCTION notify_league_invite_internal(
  p_user_id UUID,
  p_league_name TEXT,
  p_team_name TEXT,
  p_league_id UUID,
  p_token TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_user_id,
    'league_invite',
    'League invite',
    CASE WHEN p_team_name IS NOT NULL
      THEN 'You''ve been invited to manage ' || p_team_name || ' in ' || p_league_name || '.'
      ELSE 'You''ve been invited to join ' || p_league_name || '.'
    END,
    jsonb_build_object('league_id', p_league_id, 'token', p_token, 'event', 'invited')
  );
EXCEPTION WHEN OTHERS THEN
  NULL; -- never break the parent write over a notification
END;
$$;

REVOKE EXECUTE ON FUNCTION notify_league_invite_internal(UUID, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. revoke_league_invite — §15.1 DELETE /api/leagues/[id]/invites/[iid]
-- ----------------------------------------------------------------------------
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
END;
$$;

REVOKE EXECUTE ON FUNCTION revoke_league_invite(UUID, UUID) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 4. rotate_invite_code — §15.1 POST /api/leagues/[id]/invite (§7.2/§22.5)
-- ----------------------------------------------------------------------------
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

  RETURN jsonb_build_object('invite_code', v_code);
END;
$$;

REVOKE EXECUTE ON FUNCTION rotate_invite_code(UUID) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 5. set_league_invite_slug — §15.1 PATCH /api/leagues/[id]/slug
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_league_invite_slug(p_league_id UUID, p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug TEXT;
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

  -- NULL clears the slug (§15.1 "set/clear"): joins fall back to the code.
  IF p_slug IS NULL THEN
    UPDATE public.leagues
    SET invite_slug = NULL,
        updated_at = now()
    WHERE id = p_league_id;
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

  RETURN jsonb_build_object('invite_slug', v_slug);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_league_invite_slug(UUID, TEXT) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 6. get_join_preview — PRE-AUTH (§16.1; §12.23/D48; F2). Anon carve-out.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_join_preview(p_value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_val TEXT;
  v_inv RECORD;
  v_league RECORD;
  v_status TEXT;
  v_team_label TEXT;
  v_inviter TEXT;
  v_active INTEGER;
  v_seats_open INTEGER;
BEGIN
  v_val := btrim(COALESCE(p_value, ''));
  IF v_val = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- 1. Seat/invite token (exact match — tokens are 32 lowercase hex).
  SELECT i.target_team_id, i.created_by, i.revoked_at, i.expires_at,
         i.use_count, i.max_uses,
         l.id AS league_id, l.name AS league_name, l.status AS league_status,
         l.team_count
    INTO v_inv
  FROM public.league_invites i
  JOIN public.leagues l ON l.id = i.league_id AND l.deleted_at IS NULL
  WHERE i.token = v_val;
  IF FOUND THEN
    SELECT t.name INTO v_team_label
    FROM public.teams t WHERE t.id = v_inv.target_team_id;
    SELECT COALESCE(NULLIF(p.display_name, ''), p.username) INTO v_inviter
    FROM public.profiles p WHERE p.id = v_inv.created_by;
    SELECT count(*)::int INTO v_active
    FROM public.teams t
    WHERE t.league_id = v_inv.league_id AND t.status <> 'retired';

    IF v_inv.revoked_at IS NOT NULL THEN
      v_status := 'revoked';
    ELSIF now() >= v_inv.expires_at THEN
      v_status := 'expired';
    ELSIF v_inv.use_count >= v_inv.max_uses THEN
      v_status := 'spent';
    ELSIF v_inv.target_team_id IS NOT NULL THEN
      -- Seat invite: the seat is filled iff the franchise has an OPEN stint.
      IF EXISTS (
        SELECT 1 FROM public.team_managers tm
        WHERE tm.team_id = v_inv.target_team_id AND tm.ended_at IS NULL
      ) THEN
        v_status := 'seat_filled';
      ELSE
        v_status := 'ok';
      END IF;
    ELSIF v_inv.league_status NOT IN ('setup', 'scheduled') THEN
      v_status := 'joins_closed';
    ELSIF v_active >= v_inv.team_count THEN
      v_status := 'league_full';
    ELSE
      v_status := 'ok';
    END IF;

    RETURN jsonb_build_object(
      'found', true,
      'type', 'invite',
      'status', v_status,
      'league_name', v_inv.league_name,
      'team_label', v_team_label,
      'inviter_name', v_inviter,
      'seats_open', CASE WHEN v_inv.target_team_id IS NULL
                         THEN greatest(v_inv.team_count - v_active, 0)
                         ELSE NULL END
    );
  END IF;

  -- 2. League share code, then 3. custom slug (§16.1 resolution order;
  --    lower() matching — case-insensitive without citext operator lookup).
  SELECT l.id, l.name AS league_name, l.status AS league_status, l.team_count,
         'code' AS rtype
    INTO v_league
  FROM public.leagues l
  WHERE l.deleted_at IS NULL AND lower(l.invite_code) = lower(v_val);
  IF NOT FOUND THEN
    SELECT l.id, l.name AS league_name, l.status AS league_status, l.team_count,
           'slug' AS rtype
      INTO v_league
    FROM public.leagues l
    WHERE l.deleted_at IS NULL AND lower(l.invite_slug::text) = lower(v_val);
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT count(*)::int INTO v_active
  FROM public.teams t
  WHERE t.league_id = v_league.id AND t.status <> 'retired';
  v_seats_open := greatest(v_league.team_count - v_active, 0);

  IF v_league.league_status NOT IN ('setup', 'scheduled') THEN
    v_status := 'joins_closed';
  ELSIF v_seats_open = 0 THEN
    v_status := 'league_full';
  ELSE
    v_status := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'type', v_league.rtype,
    'status', v_status,
    'league_name', v_league.league_name,
    'team_label', NULL,
    'inviter_name', NULL,
    'seats_open', v_seats_open
  );
END;
$$;

-- ANON CARVE-OUT (§4.1's named exception; F2 is the compensating control):
-- the pre-auth /join/[token] page calls this before sign-in.
REVOKE EXECUTE ON FUNCTION get_join_preview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_join_preview(TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. claim_league_invite — §15.1 POST /api/invites/claim (§5 sketch;
--    E53/E54/E65; F3/F6)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_league_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_inv RECORD;
  v_email TEXT;
  v_username TEXT;
  v_existing_team UUID;
  v_team RECORD;
  v_active INTEGER;
  v_team_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'claim_league_invite: must be signed in to claim an invite'
      USING ERRCODE = '42501';
  END IF;

  -- Lock invite + league together: the league lock serializes capacity
  -- checks with concurrent joins; the invite lock serializes double-claims
  -- of the SAME invite.
  SELECT i.id AS invite_id, i.league_id, i.target_team_id, i.invited_email,
         i.invited_username, i.max_uses, i.use_count, i.expires_at,
         i.revoked_at,
         l.name AS league_name, l.status AS league_status, l.team_count,
         l.faab_budget
    INTO v_inv
  FROM public.league_invites i
  JOIN public.leagues l ON l.id = i.league_id AND l.deleted_at IS NULL
  WHERE i.token = p_token
  FOR UPDATE OF i, l;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found',
      'message', 'This invite link isn''t valid — ask your commissioner for a new one.');
  END IF;

  -- Idempotent replay FIRST (D63 doctrine): an already-seated member
  -- re-claiming is a success with NO use_count bump — checked BEFORE the
  -- algebra because a successful single-use claim leaves the invite spent,
  -- and the claimer's own retry must still succeed.
  SELECT lm.team_id INTO v_existing_team
  FROM public.league_members lm
  WHERE lm.league_id = v_inv.league_id AND lm.user_id = v_uid;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_member', true,
      'league_id', v_inv.league_id, 'team_id', v_existing_team,
      'league_name', v_inv.league_name);
  END IF;

  -- F6 claim algebra, in order (each refusal leaves the invite untouched).
  IF v_inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked',
      'message', 'This invite was revoked by the commissioner.');
  END IF;
  -- Expiry semantics (F6, defined): the invite expires AT expires_at —
  -- a claim at exactly the instant is already expired.
  IF now() >= v_inv.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired',
      'message', 'This invite has expired — ask your commissioner to send a new one.');
  END IF;
  IF v_inv.use_count >= v_inv.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spent',
      'message', 'This invite has already been used the maximum number of times.');
  END IF;

  -- E53/E65 identity match. Email: the claimer's JWT email claim (E65),
  -- case-insensitive; auth.users fallback for tokens without the claim.
  IF v_inv.invited_email IS NOT NULL THEN
    v_email := COALESCE(
      auth.jwt() ->> 'email',
      (SELECT u.email::text FROM auth.users u WHERE u.id = v_uid)
    );
    IF v_email IS NULL OR lower(v_email) <> lower(v_inv.invited_email::text) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'mismatch',
        'message', 'This invite was sent to a different email address. Sign in with the invited account, or ask your commissioner to re-send the invite.');
    END IF;
  END IF;
  -- Username: lower(username) match (D36).
  IF v_inv.invited_username IS NOT NULL THEN
    SELECT p.username INTO v_username
    FROM public.profiles p WHERE p.id = v_uid;
    IF v_username IS NULL OR lower(v_username) <> lower(v_inv.invited_username::text) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'mismatch',
        'message', 'This invite was sent to a different FieldScout username. Sign in with the invited account, or ask your commissioner to re-send the invite.');
    END IF;
  END IF;

  IF v_inv.target_team_id IS NOT NULL THEN
    -- Seat-targeted claim: the franchise must still exist, unsealed. The
    -- team-row lock serializes competing claims across DIFFERENT invites.
    SELECT t.id, t.name, t.status INTO v_team
    FROM public.teams t
    WHERE t.id = v_inv.target_team_id AND t.league_id = v_inv.league_id
    FOR UPDATE;
    IF NOT FOUND OR v_team.status = 'retired' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'seat_unavailable',
        'message', 'That seat no longer exists in this league — ask your commissioner for a new invite.');
    END IF;

    BEGIN
      -- One seating implementation (D74(2)): stint FIRST (E54's named
      -- mechanism), then FILL the placeholder cache row or create one, then
      -- owner_id/orphan resolution. clock_timestamp: F3 — a re-claim never
      -- reuses a prior stint's started_at.
      PERFORM public.seat_league_member_internal(
        v_inv.league_id, v_uid, v_inv.faab_budget, v_inv.target_team_id);
    EXCEPTION WHEN unique_violation THEN
      -- E54: the seat filled first. Mark the invite expired (expires_at =
      -- now() — instantly expired under the F6 semantics), notify the
      -- commissioner (guarded), and refuse gracefully. These writes PERSIST
      -- — which is why claim refusals are outcome-jsonb, not raises (D72).
      UPDATE public.league_invites
      SET expires_at = now()
      WHERE id = v_inv.invite_id;
      BEGIN
        INSERT INTO public.notifications (user_id, type, title, body, data)
        SELECT lm.user_id, 'league_invite', 'Seat invite conflict',
               'Two invites for ' || v_team.name || ' in ' || v_inv.league_name
                 || ' were claimed — the later claim was turned away and its invite has expired.',
               jsonb_build_object('league_id', v_inv.league_id,
                                  'team_id', v_inv.target_team_id,
                                  'event', 'seat_conflict')
        FROM public.league_members lm
        WHERE lm.league_id = v_inv.league_id AND lm.role = 'commissioner';
      EXCEPTION WHEN OTHERS THEN
        NULL; -- notification failure never breaks the claim outcome
      END;
      RETURN jsonb_build_object('ok', false, 'reason', 'seat_filled',
        'message', 'That seat has already been filled — ask your commissioner for a new invite.');
    END;
    v_team_id := v_inv.target_team_id;
  ELSE
    -- General claim: auto-creates a franchise, so it is gated to pre-draft
    -- states (D72 — M1 leagues only legitimately sit in setup/scheduled;
    -- mid-draft/season franchise creation would corrupt M2/M4 machinery)
    -- and capacity-checked under the league-row lock (D47).
    IF v_inv.league_status NOT IN ('setup', 'scheduled') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'joins_closed',
        'message', 'This league''s draft has started — joining by link is closed. Ask the commissioner for a seat invite.');
    END IF;
    SELECT count(*)::int INTO v_active
    FROM public.teams t
    WHERE t.league_id = v_inv.league_id AND t.status <> 'retired';
    IF v_active >= v_inv.team_count THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'league_full',
        'message', 'This league is full — all ' || v_inv.team_count || ' seats are taken.');
    END IF;
    v_team_id := public.seat_league_member_internal(
      v_inv.league_id, v_uid, v_inv.faab_budget);
  END IF;

  -- Claim recorded (§7.2 "every send/claim/revoke is recorded"): use_count
  -- is the aggregate; claimed_by/claimed_at = the most recent claim (§12.23
  -- prints single columns — D72).
  UPDATE public.league_invites
  SET use_count = use_count + 1,
      claimed_by = v_uid,
      claimed_at = now()
  WHERE id = v_inv.invite_id;

  RETURN jsonb_build_object('ok', true, 'already_member', false,
    'league_id', v_inv.league_id, 'team_id', v_team_id,
    'league_name', v_inv.league_name);
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_league_invite(TEXT) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 8. join_league_by_code — §15.1 POST /api/leagues/join (§7.2; FREE — Q6/F5)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_league_by_code(p_code_or_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_val TEXT;
  v_league RECORD;
  v_existing_team UUID;
  v_active INTEGER;
  v_team_id UUID;
BEGIN
  -- Joining is FREE (Q6/v2.8; §17): any signed-in user, deliberately NO
  -- is_pro read anywhere in this path (F5 join half).
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'join_league_by_code: must be signed in to join a league'
      USING ERRCODE = '42501';
  END IF;

  v_val := btrim(COALESCE(p_code_or_slug, ''));
  IF v_val = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found',
      'message', 'That invite code doesn''t match any league — check it and try again.');
  END IF;

  -- §16.1 resolution order: invite_code first, then custom slug (both
  -- case-insensitive via lower(); FOR UPDATE serializes capacity checks).
  SELECT l.id, l.name, l.status, l.team_count, l.faab_budget INTO v_league
  FROM public.leagues l
  WHERE l.deleted_at IS NULL AND lower(l.invite_code) = lower(v_val)
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT l.id, l.name, l.status, l.team_count, l.faab_budget INTO v_league
    FROM public.leagues l
    WHERE l.deleted_at IS NULL AND lower(l.invite_slug::text) = lower(v_val)
    FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found',
      'message', 'That invite code doesn''t match any league — check it and try again.');
  END IF;

  -- Idempotent replay (D63): already a member → success, no new rows.
  SELECT lm.team_id INTO v_existing_team
  FROM public.league_members lm
  WHERE lm.league_id = v_league.id AND lm.user_id = v_uid;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_member', true,
      'league_id', v_league.id, 'team_id', v_existing_team,
      'league_name', v_league.name);
  END IF;

  -- Pre-draft gate + D47 capacity (same rules as the general claim path).
  IF v_league.status NOT IN ('setup', 'scheduled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'joins_closed',
      'message', 'This league''s draft has started — joining by link is closed. Ask the commissioner for a seat invite.');
  END IF;
  SELECT count(*)::int INTO v_active
  FROM public.teams t
  WHERE t.league_id = v_league.id AND t.status <> 'retired';
  IF v_active >= v_league.team_count THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'league_full',
      'message', 'This league is full — all ' || v_league.team_count || ' seats are taken.');
  END IF;

  v_team_id := public.seat_league_member_internal(
    v_league.id, v_uid, v_league.faab_budget);

  RETURN jsonb_build_object('ok', true, 'already_member', false,
    'league_id', v_league.id, 'team_id', v_team_id,
    'league_name', v_league.name);
END;
$$;

REVOKE EXECUTE ON FUNCTION join_league_by_code(TEXT) FROM PUBLIC, anon;
