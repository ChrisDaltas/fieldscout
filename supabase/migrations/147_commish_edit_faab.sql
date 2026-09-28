-- ============================================================================
-- 147_commish_edit_faab.sql — the commissioner sets any team's FAAB balance
-- (`commish_edit_faab`), and a draft reset re-seeds every seat to the budget
-- (M5 task L.D2.11, FULL rigour — money + permissions).
-- Spec §10.1 Transactions ("edit any team's FAAB balance"), §15.4
-- (`POST /commish/faab → commish_edit_faab(team_id, balance, reason)`),
-- §12.12 (`action_type = edit_faab`), §10.3 (non-disableable system post),
-- §12.2 v2.8.7 (+ v2.16.55) — balances track the budget until the draft
-- starts. Breakdown tasks-M5-transactions.md §6 L.D2.11, TD2 / TD16, §4
-- rules; PROGRESS D336 (the template), D350 (own ledger), D352 / F340 (this
-- verb, deferred to M5 for want of a subject), D384, F412 (taken here).
--
-- Numbering (D161 — measured at task time): `ls supabase/migrations | tail -1`
-- → 146_faab_carries_with_seat.sql ⇒ 147; `ls supabase/tests | tail -1` →
-- 094_faab_carries_with_seat.sql ⇒ pgTAP 095. NOT held: reaches production
-- by `npx supabase db push` only (push debt becomes 135–147).
--
-- WHAT THIS MIGRATION DOES
--   1. `commish_faab_actions` — this verb's OWN zero-policy replay ledger
--      (D350 / D336 part 1), `UNIQUE (league_id, action_id)` + REVOKE TRUNCATE.
--   2. `commish_edit_faab_internal` + `commish_edit_faab` — D336's seven
--      parts (mapped below). Sets ONE seat's `faab_balance` to any integer
--      ≥ 0 — ABOVE the budget allowed (a repair tool, task text). Commissioner
--      or co-commissioner (`is_league_commish`, 052:96); everyone else gets
--      ONE no-leak 42501. A no-op (same value) writes no receipt, no post and
--      no notification — but the ledger row, so a retry replays.
--   3. `draft_reset` — CREATE OR REPLACE against 100:2314-2461's FILE TEXT
--      (D137; md5 of those lines 03d71421694e247bac382d41ab12cdee at task
--      time). THREE hunks (a DECLARE line, one statement, one result key):
--      when the reset returns the league to `scheduled`, every seat's
--      `faab_balance` is re-seeded to `leagues.faab_budget` (F412). Nothing
--      else in the body moves; its chat post is byte-identical.
--
-- ---------------------------------------------------------------------------
-- THE CHOICES, SAID ONCE (PROGRESS D385)
-- ---------------------------------------------------------------------------
-- (a) NO STATUS GATE. §10.1 grants "edit any team's FAAB balance" with no
--     timing qualifier, and a refusal of the commissioner on timing is a
--     defect (standing rule (a)). What the status CHANGES is stated, not
--     refused: before the draft starts balances track the budget (§12.2
--     v2.8.7), so in `setup` / `scheduled` a later budget change or seat fill
--     re-seeds the seat, and in `drafting` a draft reset re-seeds it (§3
--     below). The result names this (`reseed_can_overwrite` + its why).
-- (b) VALIDITY BINDS HIM TOO (standing rule (i)). A negative balance is money
--     that does not exist: refused BY NAME in-body (22023), and behind that
--     by 145's CHECK `league_members_faab_balance_nonneg` (23514) for every
--     path, the owner role included. No upper bound beyond INTEGER — the task
--     text allows a balance above the budget.
-- (c) THE SUBJECT IS THE SEAT. `faab_balance` lives on `league_members`
--     (TD2), `UNIQUE (league_id, team_id)` (052:74). A franchise with no seat
--     row has no balance to edit and refuses BY NAME; a RETIRED franchise's
--     seat was re-pointed at its successor (120:560-569), so the refusal
--     names the successor. Nothing is minted.
-- (d) THE RECEIPT IS PUBLIC, BECAUSE THE BALANCE IS. `league_members` is
--     member-readable (the balance is not blind — only bids are, E13), so
--     the audit row, the chat post and the manager's notification all carry
--     the before / after amounts. `acting_as_team_id` is NULL: an override
--     of a team, not the commissioner acting AS its manager (the 139 shape).
-- (e) PENDING BIDS ARE COUNTED, NOT TOUCHED. Submit reserves nothing (D383(3));
--     a lowered balance can leave pending bids above it, which the processor
--     settles (`insufficient_faab`, L.D2.9). The count is in the result.
--
-- D336's SEVEN PARTS, AND WHERE EACH ONE IS
--   (1) the ledger      → §1, `commish_faab_actions` (its own namespace)
--   (2) ONE audit row   → step (9), `log_commissioner_action_internal`
--                         (123:417-453) INSIDE the no-op guard, AFTER the
--                         write, `IF v_audit_id IS NULL THEN RAISE`;
--                         `edit_faab` / `team` / `{faab_balance}` both sides
--   (3) the no-op       → step (8), DETECTED by value on the one dimension
--                         the verb changes (`IS NOT DISTINCT FROM` — a NULL
--                         balance is a value too); ledger row written anyway
--   (4) the chat post   → step (10), in-txn, non-disableable (§10.3);
--                         + the seated manager's notification (TD16)
--   (5) the posture     → PLAIN `search_path=''` internal taking `p_at`,
--                         triple-REVOKEd, under a SECURITY DEFINER wrapper
--                         passing `now()` (D307(3)); `leagues FOR UPDATE`
--                         FIRST, then the seat re-read `FOR UPDATE`; in-body
--                         auth as ONE no-leak 42501; replay AFTER auth,
--                         BEFORE every business gate
--   (6) the reason      → OPTIONAL (Q66 / 131): normalised in the explicit
--                         E' \t\r\n' class, ≤ 500, never required
--   (7) the result      → echoes `verb` / `action_id` / `team_id` /
--                         `requested_balance` (the route's F65(b) identity
--                         guard compares them with the body it sent), the
--                         balance before / after, `bypassed = []` WITH its
--                         why, and `commissioner_action_id` — NULL on a no-op
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Additive: one new table (RLS on, ZERO policies, TRUNCATE revoked), two
--   new functions; ONE function replaced (`draft_reset`, 3 hunks vs 100's
--   file text — no later migration defines it: `grep -n "FUNCTION
--   draft_reset" supabase/migrations/*.sql` → 069:1350, 087:2481,
--   100:2314). Signatures unchanged for `draft_reset`; typegen additive.
--   Grants (D18 → D23 → 133): the door REVOKEd from PUBLIC + anon, EXECUTE
--   for authenticated (the in-body gate is the authorization); the internal
--   REVOKEd from PUBLIC, anon, authenticated; `draft_reset`'s posture
--   restated after the replace.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–147 and the full pgTAP run in the PR. D38 realtime —
--   nothing new is broadcast. No backfill.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_faab_actions — this verb's OWN replay ledger (D350). Never
--    shared with another commish_* ledger and never commissioner_actions
--    (§12.12 ships a client INSERT policy, 123:333-335, so a pre-planted row
--    carrying a to-be-sent action_id would replay as an edit nobody made).
-- ---------------------------------------------------------------------------
CREATE TABLE commish_faab_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                   -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_commish_faab_actions_team ON commish_faab_actions(team_id);

COMMENT ON TABLE commish_faab_actions IS
  'Idempotency ledger for commish_edit_faab (migration 147, D350). ZERO policies: the DEFINER verb is the only reader and writer. NOT the audit log — §12.26: "an action_id is an idempotency key, not an audit record" — so a row is written for a NO-OP too, while commissioner_actions is not.';

ALTER TABLE commish_faab_actions ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON TABLE commish_faab_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_edit_faab_internal + commish_edit_faab
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_faab_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_balance   INTEGER,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_team       public.teams;
  v_seat       public.league_members;
  v_reason     TEXT;
  v_before     INTEGER;
  v_no_changes BOOLEAN;
  v_pending    INTEGER;
  v_reseed     BOOLEAN;
  v_reseed_why TEXT;
  v_audit_id   UUID;
  v_message    TEXT;
  v_manager    UUID;
  v_result     JSONB;
  v_cnt        INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule).
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_faab: p_team_id is required — an edit that names no team is not an edit'
      USING ERRCODE = '22023';
  END IF;
  IF p_balance IS NULL THEN
    RAISE EXCEPTION 'commish_edit_faab: p_balance is required — the whole-dollar FAAB balance the team should have (0 or more)'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_faab: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST — the one serialization point every
  --     money-moving verb takes (145's claim verbs, 115's add/drop, the
  --     waiver processor L.D2.9), so an edit never interleaves with a run
  --     that debits the same balance.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner OR co-commissioner, in-body, as ONE no-leak 42501
  --     covering "no such league", "not a member" and "a manager, even of
  --     this very team" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_edit_faab: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (123:602-609's placement): a retry replays byte-identically even when
  --     the balance has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_faab_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66; 131's normalisation verbatim).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_edit_faab: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) VALIDITY — money that does not exist (standing rule (i): binds the
  --     commissioner too). 145's CHECK is the backstop for every other path.
  IF p_balance < 0 THEN
    RAISE EXCEPTION
      'commish_edit_faab: a FAAB balance cannot be negative (asked for $%) — the lowest a team can hold is $0 (TD2; CHECK league_members_faab_balance_nonneg)', p_balance
      USING ERRCODE = '22023';
  END IF;

  -- (6) THE FRANCHISE, read under the league lock.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_edit_faab: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE SEAT — the balance's home (TD2), re-read and locked. A retired
  --     franchise's seat moved to its successor (120:560-569); a franchise
  --     with no seat row has no balance at all. Both refuse BY NAME, and
  --     nothing is minted.
  SELECT m.* INTO v_seat
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF v_team.status = 'retired' THEN
      RAISE EXCEPTION
        'commish_edit_faab: franchise % is RETIRED — its seat, and the FAAB balance with it, carried to its successor (%) (§7.2.1(b)); edit that team''s balance instead',
        p_team_id, COALESCE(v_team.successor_team_id::text, 'none recorded')
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION
      'commish_edit_faab: team % has no seat in league % — a FAAB balance lives on the team''s seat (league_members), and this team has none, so there is no balance to edit',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_before := v_seat.faab_balance;

  -- (8) THE NO-OP, BY VALUE (D336 part 3).
  v_no_changes := (v_before IS NOT DISTINCT FROM p_balance);

  -- What can still overwrite the balance, stated (choice (a)).
  v_reseed := v_league.status IN ('setup', 'scheduled', 'drafting');
  v_reseed_why := CASE
    WHEN v_league.status IN ('setup', 'scheduled') THEN
      'league is ' || v_league.status || ' — before the draft starts balances track the budget (§12.2 v2.8.7): a faab_budget change re-seeds every seat, and filling this seat re-seeds it (146)'
    WHEN v_league.status = 'drafting' THEN
      'league is drafting — a draft reset returns the league to scheduled and re-seeds every seat to the budget (147, F412)'
    ELSE
      'league is ' || v_league.status || ' — from the draft on the balance is the team''s own ledger and nothing re-seeds it (D384; a budget change leaves it alone, 144)' END;

  IF NOT v_no_changes THEN
    -- (8b) THE STATE WRITE, with the loud ROW_COUNT assertion (119:882-886).
    UPDATE public.league_members
    SET faab_balance = p_balance
    WHERE id = v_seat.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_edit_faab: the balance write touched % rows, expected exactly 1 (team %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (9) D336 part 2 — EXACTLY ONE audit row, AFTER the state write.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_faab', 'team', p_team_id::text, v_reason,
      jsonb_build_object('faab_balance', v_before),
      jsonb_build_object('faab_balance', p_balance),
      jsonb_build_object(
        'verb',              'commish_edit_faab',
        'season',            v_league.season,
        'action_id',         p_action_id,
        'team_name',         v_team.name,
        'league_status',     v_league.status,
        'faab_budget',       v_league.faab_budget,
        'affected_team_ids', jsonb_build_array(p_team_id),
        'bypassed',          '[]'::jsonb),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_edit_faab: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) §10.3: the non-disableable system post, then the seated manager's
    --      notification (TD16). An unmanaged seat notifies nobody; the actor
    --      is never notified of his own act.
    v_message := v_team.name || '''s FAAB balance is now $' || p_balance
      || ' (was ' || COALESCE('$' || v_before, 'unset') || ')'
      || ' — set by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    v_manager := v_seat.user_id;
    IF v_manager IS NOT NULL AND v_manager IS DISTINCT FROM auth.uid() THEN
      PERFORM public.notify_league_member_internal(
        v_manager, 'league_faab_commissioner',
        'The commissioner changed your FAAB balance',
        v_team.name || ': $' || p_balance || ' (was ' || COALESCE('$' || v_before, 'unset') || ')'
          || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
        jsonb_build_object('league_id', p_league_id, 'team_id', p_team_id,
                           'faab_before', v_before, 'faab_after', p_balance,
                           'commissioner_action_id', v_audit_id));
    ELSE
      v_manager := NULL;
    END IF;
  END IF;

  -- (e) Pending bids now above the balance — counted, never touched.
  SELECT count(*)::int INTO v_pending
  FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending'
    AND c.faab_bid > p_balance;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_edit_faab',
    'action_type',            'edit_faab',
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'league_status',          v_league.status,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    -- The balance AFTER this call, what it was, and what was asked — the
    -- route's F65(b) guard compares `requested_balance` with its body.
    'faab_balance',           p_balance,
    'previous_balance',       v_before,
    'requested_balance',      p_balance,
    'delta',                  CASE WHEN v_before IS NULL THEN NULL ELSE p_balance - v_before END,
    'faab_budget',            v_league.faab_budget,
    'waiver_type',            v_league.waiver_type,
    'pending_bids_above_balance', v_pending,
    'reseed_can_overwrite',   v_reseed,
    'reseed_why',             v_reseed_why,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'balance_already_set — the team already held exactly this balance, so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,              -- NULL on a no-op, and that is the point
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — no timing rule governs a balance edit (no lock, no week gate, no waiver schedule); the only gate is validity (a balance is never negative), which binds the commissioner too (standing rule (i))',
    'reason',                 v_reason,
    'system_post',            v_message,               -- NULL on a no-op
    'notified_user_id',       v_manager,               -- NULL on a no-op, an unmanaged seat, or the actor's own seat
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266).
  INSERT INTO public.commish_faab_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_edit_faab_internal(UUID, UUID, INTEGER, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The client door. Transaction `now()`, never a caller-supplied instant
-- (D307(3)); SECURITY DEFINER; in-body auth is the internal's step (2). The
-- tail arguments carry DEFAULT NULL and the required ones are refused in-body
-- (22023) — 128 / 139's shape, §15.4's order (team, balance, reason).
CREATE OR REPLACE FUNCTION commish_edit_faab(
  p_league_id UUID,
  p_team_id   UUID,
  p_balance   INTEGER DEFAULT NULL,  -- REQUIRED in-body (22023)
  p_reason    TEXT DEFAULT NULL,     -- OPTIONAL (Q66)
  p_action_id UUID DEFAULT NULL      -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_edit_faab_internal(
    p_league_id, p_team_id, p_balance, p_action_id, now(), p_reason);
END;
$$;
-- `authenticated` keeps EXECUTE; the in-body commissioner gate is the
-- authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_edit_faab(UUID, UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon;

COMMENT ON FUNCTION commish_edit_faab(UUID, UUID, INTEGER, TEXT, UUID) IS
  '§10.1 / §15.4 (migration 147, M5 L.D2.11; D352 / F340): the commissioner (or a co-commissioner) sets one team''s FAAB balance to any whole number ≥ 0, above the budget allowed. Any league status; negative refused by name (and by 145''s CHECK); a retired or seatless franchise refused by name. No-op by value writes no receipt; otherwise one commissioner_actions row (edit_faab, {faab_balance} before/after), a §10.3 chat post and the seated manager''s notification. Own replay ledger (D350); reason optional (Q66).';

-- ---------------------------------------------------------------------------
-- 3. draft_reset — CREATE OR REPLACE against 100:2314-2461's FILE TEXT (D137).
--    THREE hunks, each marked `147 / F412`: (i) DECLARE v_faab_reseeded;
--    (ii) the re-seed statement after the league returns to `scheduled`;
--    (iii) `faab_reseeded_seats` in the result. Everything else verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_reset(
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft  public.drafts;
  v_undone INTEGER;
  v_faab_reseeded INTEGER;  -- 147 / F412
BEGIN
  -- LOCK ORDER (banner item 10): the DRAFTS row FIRST — serializing with
  -- in-flight picks — then the LEAGUES row. Taking leagues first would
  -- recreate the R122 FK-KEY-SHARE cycle against a pick in flight.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- MS.2/100 — GATE ORDER (D217(5)/E75): member floor → (real draft ⇒
  -- commissioner) → (mock ⇒ launcher, the ONE gate helper). The
  -- real-draft refusal below is byte-identical to the pre-100 text (§4
  -- rule 13; 023/036 pin it): a member-but-not-commissioner, a non-member
  -- and a nonexistent draft all still answer this same 42501 (no-leak).
  -- The floor's standalone arm reuses D226(3)'s ONE ownership predicate
  -- via is_standalone_mock_launcher (095); is_league_member(NULL) and
  -- is_standalone_mock_launcher(NULL) are both FALSE — fail closed.
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id))
     OR (NOT v_draft.is_mock AND NOT public.is_league_commish(v_draft.league_id)) THEN
    RAISE EXCEPTION 'draft_reset: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_reset');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — the ONE live-proven §8.8 breach (writes leagues.status + settings, broadcasts league:<id>); MS.4/D220 owns the mock-safe-variant decision.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_reset: a practice cannot be reset — delete it and start a new one (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_reset: the draft is complete — a post-completion reset is an audited override that arrives with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_reset: the draft has not started — nothing to reset'
      USING ERRCODE = 'P0001';
  END IF;

  -- Now the league row (drafts → leagues — see the banner's lock-order
  -- analysis).
  PERFORM 1 FROM public.leagues l
  WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_reset: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Soft-undo every live pick (§12.4 audit trail; pool return is the
  -- partial index).
  UPDATE public.draft_picks
  SET is_undone = TRUE
  WHERE draft_id = p_draft_id AND is_undone = FALSE;
  GET DIAGNOSTICS v_undone = ROW_COUNT;

  -- 087/R379 — D162 situation (c): THIS RUN'S BID HISTORY ENDS HERE. The
  -- reset rewinds current_pick_number to 1 and draft_start re-issues the same
  -- sequence numbers over rows that are still `voided_at IS NULL`, so leaving
  -- them live merges two runs' nominations under one seq for every reader
  -- keyed on it — the same merge D143 creates within a run, at run scale.
  -- Rows are KEPT and STAMPED, never deleted: §12.5 is append-only and the
  -- previous run's history is audit (the draft_picks soft-undo above is the
  -- same posture, one table over). A direct sweep rather than
  -- draft_void_nomination_internal, because that helper voids the LIVE
  -- nomination only (by seq + player) and what ends here is the whole run.
  -- NOT restricted to auctions: a snake draft simply has no draft_bids rows,
  -- so the statement is a measured no-op there rather than a branch.
  UPDATE public.draft_bids SET voided_at = now()
  WHERE draft_id = p_draft_id AND voided_at IS NULL;

  -- The system post BEFORE the drafts-row context anchor changes nothing —
  -- same txn; written first so the room's transcript reads
  -- action-then-state.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Draft reset by ' || public.draft_actor_name() || ' — ' || v_undone
          || ' picks cleared; the draft is back to scheduled. Re-schedule it in Draft setup or start it manually when ready.',
          'draft:' || p_draft_id::text, TRUE);

  -- The drafts row back to pre-draft. draft_order KEPT (D101 — the shown
  -- order survives a reset; manual/custom orders are not lost).
  UPDATE public.drafts SET
    status                = 'scheduled',
    current_round         = 1,
    current_pick_number   = 1,
    on_clock_team_id      = NULL,
    current_deadline      = NULL,
    paused_at             = NULL,
    deadline_remaining_ms = NULL,
    started_at            = NULL,
    completed_at          = NULL,
    -- 087/L.C1.5 — R302, the auction-hygiene half. Without these two a reset
    -- mid-BIDDING resurrects a ghost nomination on restart (D126's phase rule
    -- reads current_nomination, and draft_start does not clear it), and the
    -- league restarts carrying live-draft budget corrections that belong to
    -- the draft they corrected. §8.7's own row says a reset returns to
    -- pre-draft; these are pre-draft's values. NULL/'{}' on a snake draft too
    -- — they are already that, so the snake path is unchanged.
    current_nomination    = NULL,
    budget_adjustments    = '{}'::jsonb,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- Fresh room state: this draft's heartbeats go too (the outage arm's
  -- "supervision established" memory starts clean on a re-run — D108).
  DELETE FROM public.draft_liveness WHERE draft_id = p_draft_id;

  -- League back to 'scheduled' (§8.7's own row; §7.1's re-open arrow; the
  -- D43 guard is indifferent — the snapshot survives) AND the stored
  -- auto-start instant REMOVED — the D107(5) seam closure: a PAST
  -- draft_scheduled_at would re-start this draft on the next 5s tick
  -- (D94). Auto-start re-arms only when the commissioner re-schedules
  -- through the settings picker; the Start button works without an
  -- instant (066 create-if-absent).
  UPDATE public.leagues SET
    status     = 'scheduled',
    settings   = settings #- '{draft,draft_scheduled_at}',
    updated_at = now()
  WHERE id = v_draft.league_id;

  -- 147 / F412 — back to pre-draft, so balances track the budget again
  -- (§12.2 v2.8.7): every seat re-seeded to the CURRENT budget, the same
  -- statement shape as the pre-draft budget change (118:2617-2621 / 144's
  -- step 12b). Without it a budget changed during the draft (which leaves
  -- balances alone, 144) survives the reset as uneven starting FAAB.
  -- Counted: only seats whose balance actually differed are written.
  UPDATE public.league_members m
  SET faab_balance = l.faab_budget
  FROM public.leagues l
  WHERE l.id = v_draft.league_id
    AND m.league_id = l.id
    AND m.faab_balance IS DISTINCT FROM l.faab_budget;
  GET DIAGNOSTICS v_faab_reseeded = ROW_COUNT;

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'reset', TRUE,
    'picks_cleared', v_undone,
    'faab_reseeded_seats', v_faab_reseeded);  -- 147 / F412
END;
$$;

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_reset(UUID, TEXT) FROM PUBLIC, anon;
