-- ============================================================================
-- 145_waiver_claims.sql — blind waiver claims + the three claim verbs + the
-- FAAB floor (M5 task L.D2.5, FULL rigour — permissions, blind bids, money).
-- Spec §12.10 (+ erratum C73, folded in v2.16.54), §13.2, §7.3.4, §12.2,
-- §10.3 / §12.12, §9.2 / §12.14 (never broadcast), E13. Breakdown
-- tasks-M5-transactions.md §6 L.D2.5, TD2 / TD3 / TD4 / TD5 / TD8, §4 rules;
-- Q70–Q79 RULED as recommended (Chris 2026-09-27).
--
-- Numbering: RESERVED by the orchestrator — L.E1.27 (building in parallel)
-- holds 144 / pgTAP 092; this task holds **145 / pgTAP 093**. Built on main
-- @ 1874185 (heads 143 / 091); the gap at 144 is expected until L.E1.27
-- merges and nothing here depends on it (145 replaces no function).
--
-- WHAT THIS MIGRATION DOES
--   1. `league_members` — `CHECK (faab_balance IS NULL OR faab_balance >= 0)`
--      (TD2), asserted against every existing row FIRST (a loud RAISE naming
--      any violator, never a failed ALTER with no context); + the seat's
--      `waiver_priority INTEGER` (TD8; 1 = first; NULL until the processor,
--      L.D2.9, seeds it lazily from Q72's order).
--   2. `waiver_claims` — §12.10 as printed, PLUS `action_id` (UNIQUE per
--      league), `result_reason`, `created_by`, `cancelled_at` / `cancelled_by`;
--      NOT NULL + CHECKs on status / bid / order / add≠drop. RLS: ONE SELECT
--      policy, keyed on MEMBERSHIP TRUTH (`league_members.team_id` — the
--      caller manages the claim's team) OR commissioner / co-commissioner.
--      §12.10's owner-keyed `FOR ALL` write policy is NOT built (C73 / TD4 —
--      the F18 precedent, 112:305-308): writes go through the verbs only.
--      NO broadcast trigger (§9.2 / §12.14 / TD3 — owners refetch).
--   3. `waiver_claim_actions` — the three verbs' replay ledger (D350 shape:
--      ZERO policies; one (league, action_id) namespace across the three
--      verbs, the stored `verb` refusing a cross-verb reuse — R732).
--   4. `waiver_claim_receipt_internal` — the commissioner arm's receipt
--      (TD5 / D336): ONE `commissioner_actions` row with `acting_as_team_id`,
--      the §10.3 system post, the seated manager's notification (TD16).
--      BLIND-SAFE: the audit row and the post are league-visible, so they
--      carry the ACT and the TEAM only — never the player, never the bid
--      (E13 / TD3). The player and bid reach the team's own manager through
--      his notification and his own claim rows.
--   5. `waiver_claim_submit` / `_cancel` / `_reorder` — DEFINER doors over
--      PLAIN triple-REVOKEd internals taking `p_at` (the TimeProvider rule).
--      Every internal: shape → league row FOR UPDATE (the one serialization
--      point, shared with add/drop 115:410-414) → in-body auth (manager of
--      the team, or commissioner acting for ANY team; ONE no-leak 42501) →
--      replay → re-read everything under the lock → refuse by name →
--      write → exactly-one-row assertions → receipt (commissioner arm only)
--      → ledger row.
--      Submit refuses BY NAME: league not in_season / playoffs; retired team;
--      `waiver_type = none_fcfs` (and an unknown type); add player unknown or
--      ALREADY ROSTERED in this league (friendly, naming the team — never a
--      raw 23505); drop player unknown or not on THIS team; a bid below
--      `faab_min_bid`, above the seat's CURRENT balance, or non-zero under a
--      priority type; an identical pending claim (same add + same drop —
--      the bid is not part of identity: cancel and resubmit to change it).
--      Lock and schedule checks are the processor's (L.D2.9) — submit does
--      not guess them (task text). Submit SPENDS NOTHING: a bid is checked
--      against the balance, never debited (TD2 — the won claim debits).
--      The commissioner is bound by every validity rule here (standing rule
--      (i)): his bid is checked against the team's balance like anyone's.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Additive: one column + one CHECK on league_members; two new tables with
--   RLS enabled in the same file; seven new functions (three DEFINER doors,
--   four PLAIN internals). Replaces NO existing function (no D137 hunks).
--   Grants (D18 → D23 → 133): tables are born WITHOUT TRUNCATE for anon /
--   authenticated (133's default-privilege revoke); the explicit per-table
--   REVOKE below is the D350 house form, kept (081 §A enforces schema-wide).
--   Doors: SECURITY DEFINER, `search_path = ''`, REVOKEd from PUBLIC + anon,
--   EXECUTE for authenticated (the in-body gate is the authorization).
--   Internals: PLAIN, `search_path = ''`, REVOKEd from PUBLIC, anon,
--   authenticated. Typegen: additive (two tables, one column, seven
--   functions); the 42-export alias block re-appended.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–143 + 145 and the full pgTAP run in the PR. D38 realtime —
--   nothing new is broadcast (and must not be: §12.14 lists `waiver_claims`
--   under "never broadcast"). No backfill: no claim exists before this file.
--   NOT held: reaches production by `npx supabase db push` only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. league_members — the FAAB floor (TD2) and the seat's waiver priority (TD8)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(format('%s (league %s, balance %s)', m.id, m.league_id, m.faab_balance), ', ' ORDER BY m.id)
  INTO v_bad
  FROM public.league_members m
  WHERE m.faab_balance < 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '145: refusing to add the FAAB floor — these league_members rows already hold a NEGATIVE faab_balance: %. Repair them first (a balance below zero is money that does not exist — TD2).',
      v_bad
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

ALTER TABLE league_members
  ADD CONSTRAINT league_members_faab_balance_nonneg
  CHECK (faab_balance IS NULL OR faab_balance >= 0);

ALTER TABLE league_members
  ADD COLUMN waiver_priority INTEGER
  CONSTRAINT league_members_waiver_priority_positive
  CHECK (waiver_priority IS NULL OR waiver_priority >= 1);

COMMENT ON COLUMN league_members.faab_balance IS
  'In-season FAAB remaining for this SEAT (§12.2; TD2 — carried with the seat, never re-created). NULL-or-≥0 by CHECK league_members_faab_balance_nonneg (migration 145): no path, the owner role included, can store a negative balance.';
COMMENT ON COLUMN league_members.waiver_priority IS
  'This seat''s waiver priority (1 = first; TD8, migration 145). NULL until the waiver processor (L.D2.9) seeds it lazily from Q72''s order; carried with the seat like faab_balance.';

-- ---------------------------------------------------------------------------
-- 2. waiver_claims — §12.10 + the C73 erratum (SELECT only, membership-keyed)
-- ---------------------------------------------------------------------------
CREATE TABLE waiver_claims (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id        UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  add_player_id  TEXT REFERENCES players(id) NOT NULL,
  drop_player_id TEXT REFERENCES players(id),              -- optional corresponding drop
  faab_bid       INTEGER NOT NULL DEFAULT 0
                 CONSTRAINT waiver_claims_faab_bid_nonneg CHECK (faab_bid >= 0),   -- blind bid
  priority       INTEGER,                                  -- §12.10 as printed; unused (TD8 keeps priority on the seat)
  claim_order    INTEGER NOT NULL DEFAULT 1
                 CONSTRAINT waiver_claims_claim_order_positive CHECK (claim_order >= 1),  -- this team's own ranking (1 = try first)
  status         TEXT NOT NULL DEFAULT 'pending'
                 CONSTRAINT waiver_claims_status_check
                 CHECK (status IN ('pending', 'won', 'lost', 'invalid', 'cancelled')),
  result_reason  TEXT,                                     -- outbid / drop_locked / add_locked / roster_full / insufficient_faab / cap_reached / cancelled …
  process_at     TIMESTAMPTZ,                              -- the run that will settle it (NULL until L.D2.7's schedule)
  processed_at   TIMESTAMPTZ,
  action_id      UUID NOT NULL,                            -- the submit's idempotency stamp
  created_by     UUID REFERENCES profiles(id) NOT NULL,    -- the manager, or the commissioner acting for the team
  cancelled_at   TIMESTAMPTZ,
  cancelled_by   UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT waiver_claims_add_is_not_drop CHECK (drop_player_id IS NULL OR drop_player_id <> add_player_id),
  CONSTRAINT waiver_claims_cancelled_shape CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  CONSTRAINT waiver_claims_action_unique UNIQUE (league_id, action_id)
);

CREATE INDEX idx_waiver_claims_proc ON waiver_claims(league_id, process_at) WHERE status = 'pending';  -- §12.10 as printed
CREATE INDEX idx_waiver_claims_team ON waiver_claims(team_id, status, claim_order);                    -- the policy + the verbs' reads
CREATE INDEX idx_waiver_claims_add_player ON waiver_claims(add_player_id);
CREATE INDEX idx_waiver_claims_drop_player ON waiver_claims(drop_player_id) WHERE drop_player_id IS NOT NULL;
-- The race backstop behind the verb's by-name "identical pending claim"
-- refusal (the league-row lock serializes submits, so this is unreachable
-- through the verb — it exists for every OTHER writer).
CREATE UNIQUE INDEX uq_waiver_claims_pending_identical
  ON waiver_claims(team_id, add_player_id, COALESCE(drop_player_id, ''))
  WHERE status = 'pending';

COMMENT ON TABLE waiver_claims IS
  'Blind waiver claims (§12.10 / §13.2; migration 145). PRIVATE: readable only by the manager of the claim''s team (membership truth — league_members.team_id, never teams.owner_id) and the league''s commissioners; other members see NO row, not even a count (E13). NO write policy for any role (C73 / TD4): written only by waiver_claim_submit / _cancel / _reorder and the waiver processor. NEVER broadcast (§12.14 / TD3). Lost / invalid / cancelled claims stay here; only a WON claim becomes a (member-visible) transactions row.';

ALTER TABLE waiver_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own team or commish claims read" ON waiver_claims FOR SELECT TO authenticated
  USING (
    public.is_league_commish(league_id)
    OR EXISTS (
      SELECT 1 FROM public.league_members m
      WHERE m.league_id = waiver_claims.league_id
        AND m.team_id = waiver_claims.team_id
        AND m.user_id = auth.uid()));
-- No INSERT / UPDATE / DELETE policy for ANY role (C73 / TD4). pgTAP 093 §G
-- walks anon, a non-member, another member, the owner and the commissioner
-- with RETURNING counts.
REVOKE TRUNCATE ON TABLE waiver_claims FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. waiver_claim_actions — the three verbs' replay ledger (D350). ZERO policies.
-- ---------------------------------------------------------------------------
CREATE TABLE waiver_claim_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  verb       TEXT NOT NULL
             CONSTRAINT waiver_claim_actions_verb_check
             CHECK (verb IN ('waiver_claim_submit', 'waiver_claim_cancel', 'waiver_claim_reorder')),
  action_id  UUID NOT NULL,                      -- client-minted; dedupes retries (E2 / D68)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                     -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT waiver_claim_actions_unique UNIQUE (league_id, action_id)
);
CREATE INDEX idx_waiver_claim_actions_team ON waiver_claim_actions(team_id);

COMMENT ON TABLE waiver_claim_actions IS
  'Idempotency ledger for waiver_claim_submit / _cancel / _reorder (migration 145, D350). ZERO policies: the verbs are its only reader and writer, and its results carry blind bids. One (league, action_id) namespace across the three verbs; the stored verb refuses a cross-verb reuse (R732). Not the audit log (§12.26).';

ALTER TABLE waiver_claim_actions ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON TABLE waiver_claim_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. waiver_claim_receipt_internal — the commissioner arm's receipt (TD5)
-- ---------------------------------------------------------------------------
-- Called ONLY when the actor is not the team's manager (a commissioner acting
-- for the team). Writes, in the caller's transaction: ONE commissioner_actions
-- row (target team, acting_as_team_id = the team), the §10.3 system post, and
-- the seated manager's notification. BLIND-SAFE by construction: the two
-- league-visible writes are built from p_act_text + the team name + the
-- reason ONLY — the function never receives a player or a bid. The private
-- details travel only in p_owner_body / p_owner_data (the manager's own
-- notification, readable by him alone — 001:898).
CREATE OR REPLACE FUNCTION waiver_claim_receipt_internal(
  p_league_id    UUID,
  p_team         public.teams,
  p_action_type  TEXT,
  p_act_text     TEXT,       -- e.g. 'submitted a waiver claim for' — league-visible
  p_claim_ids    JSONB,      -- opaque ids only
  p_reason       TEXT,
  p_action_id    UUID,
  p_verb         TEXT,
  p_season       INTEGER,
  p_owner_title  TEXT,
  p_owner_body   TEXT,       -- PRIVATE: may name the player and the bid
  p_owner_data   JSONB       -- PRIVATE
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_audit_id  UUID;
  v_message   TEXT;
  v_manager   UUID;
BEGIN
  v_audit_id := public.log_commissioner_action_internal(
    p_league_id, auth.uid(), p_action_type, 'team', p_team.id::text, p_reason,
    NULL,
    jsonb_build_object('claim_ids', p_claim_ids),
    jsonb_build_object(
      'verb',              p_verb,
      'season',            p_season,
      'action_id',         p_action_id,
      'team_name',         p_team.name,
      'affected_team_ids', jsonb_build_array(p_team.id),
      'blind',             'the claim''s player and bid are private until waivers run (§13.2, E13) — they are on the claim row, readable by the team''s manager and the commissioners only',
      'bypassed',          '[]'::jsonb),
    p_team.id);
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION '%: the audit row was not written — refusing to let a commissioner act without its receipt (§10.3)', p_verb
      USING ERRCODE = 'P0001';
  END IF;

  v_message := public.draft_actor_name() || ' (commissioner) ' || p_act_text || ' ' || p_team.name
    || ' — its details stay private until waivers run'
    || CASE WHEN p_reason IS NOT NULL THEN ' — reason: ' || p_reason ELSE '' END;
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

  SELECT m.user_id INTO v_manager
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = p_team.id AND m.user_id IS NOT NULL;
  IF v_manager IS NOT NULL AND v_manager IS DISTINCT FROM auth.uid() THEN
    PERFORM public.notify_league_member_internal(
      v_manager, 'league_waiver_claim_commissioner', p_owner_title, p_owner_body,
      p_owner_data || jsonb_build_object('league_id', p_league_id, 'team_id', p_team.id,
                                         'commissioner_action_id', v_audit_id));
  ELSE
    v_manager := NULL;
  END IF;

  RETURN jsonb_build_object(
    'commissioner_action_id', v_audit_id,
    'system_post',            v_message,
    'notified_user_id',       v_manager);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_receipt_internal(
  UUID, public.teams, TEXT, TEXT, JSONB, TEXT, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5a. waiver_claim_submit_internal + waiver_claim_submit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_submit_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT,
  p_drop      TEXT,
  p_bid       INTEGER,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_found        BOOLEAN;
  v_is_manager   BOOLEAN;
  v_is_commish   BOOLEAN;
  v_ledger       public.waiver_claim_actions;
  v_team         public.teams;
  v_reason       TEXT;
  v_waiver_type  TEXT;
  v_min_bid      INTEGER;
  v_bid          INTEGER;
  v_balance      INTEGER;
  v_has_seat     BOOLEAN;
  v_add_p        public.players;
  v_drop_p       public.players;
  v_owner        public.league_rosters;
  v_owner_team   public.teams;
  v_dup          public.waiver_claims;
  v_order        INTEGER;
  v_claim        public.waiver_claims;
  v_receipt      JSONB := NULL;
  v_result       JSONB;
BEGIN
  -- (0) SHAPE — refused by name (22023), never answered as a no-op.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_team_id is required — a claim is made for one team'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_submit: p_add is required — a claim names the player to add (§13.2)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add = p_drop THEN
    RAISE EXCEPTION 'waiver_claim_submit: add and drop name the same player (%) — a claim changes the roster (§13.2)', p_add
      USING ERRCODE = '22023';
  END IF;
  IF p_bid IS NOT NULL AND p_bid < 0 THEN
    RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is negative — bids are whole dollars from $0 up (§7.3.4)', p_bid
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST — the one serialization point shared with
  --     add/drop (115:410-414) and, from L.D2.9, the processor.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     The team's manager, or a commissioner / co-commissioner acting for
  --     ANY team (TD5). One no-leak 42501 for no league / not a member / not
  --     this team's manager and not a commissioner.
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'waiver_claim_submit: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099 / E2), after auth, before every business gate: the same
  --     action_id returns the stored result byte-identically, even if the
  --     league has moved on since. Verb- and team-scoped (R732).
  SELECT a.* INTO v_ledger
  FROM public.waiver_claim_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'waiver_claim_submit' OR v_ledger.team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION
        'waiver_claim_submit: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66; 131's normalisation verbatim). Only the
  --     commissioner arm stores it.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'waiver_claim_submit: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) LEAGUE STATE, re-read under the lock.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % is % — waiver claims are made only while the league is in season or in the playoffs (§13.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'waiver_claim_submit: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'waiver_claim_submit: % is retired — a sealed franchise makes no claims (§7.2.1)', v_team.name
      USING ERRCODE = 'P0001';
  END IF;

  v_waiver_type := COALESCE(v_league.waiver_type, 'faab');
  IF v_waiver_type = 'none_fcfs' THEN
    RAISE EXCEPTION
      'waiver_claim_submit: this league has no waivers (waiver type "none_fcfs") — every unowned player is first come, first served: add him directly (§7.3.4)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_waiver_type NOT IN ('faab', 'rolling_priority', 'reverse_standings') THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % has waiver type "%", which is not one of faab / rolling_priority / reverse_standings / none_fcfs (§7.3.4) — refusing rather than guessing how its claims are decided',
      p_league_id, v_waiver_type
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE ADD — known, and on NO roster in this league (exclusivity, the
  --     friendly refusal naming the team — never a raw 23505).
  SELECT p.* INTO v_add_p FROM public.players p WHERE p.id = p_add;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'waiver_claim_submit: no player with id % (add)', p_add USING ERRCODE = 'P0001';
  END IF;
  SELECT r.* INTO v_owner FROM public.league_rosters r
  WHERE r.league_id = p_league_id AND r.player_id = p_add;
  IF FOUND THEN
    SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_owner.team_id;
    RAISE EXCEPTION
      'waiver_claim_submit: % (%) is already on % — a player is on ONE roster per league (player exclusivity, §13.2); only an unowned player can be claimed',
      v_add_p.full_name, p_add,
      CASE WHEN v_owner.team_id = p_team_id THEN v_team.name || '''s own roster'
           ELSE COALESCE(v_owner_team.name, 'another team') || '''s roster' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE DROP — known, and on THIS team.
  IF p_drop IS NOT NULL THEN
    SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'waiver_claim_submit: no player with id % (drop)', p_drop USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_owner FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_drop;
    IF NOT FOUND OR v_owner.team_id <> p_team_id THEN
      RAISE EXCEPTION
        'waiver_claim_submit: % (%) is not on %''s roster — a claim can only drop one of the team''s own players (§13.2)',
        v_drop_p.full_name, p_drop, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (8) THE BID. FAAB: at least faab_min_bid, at most the seat's CURRENT
  --     balance (checked, never debited — TD2). Priority types: no money.
  v_bid := COALESCE(p_bid, 0);
  v_min_bid := COALESCE((v_league.settings ->> 'faab_min_bid')::int, 0);
  SELECT TRUE, m.faab_balance INTO v_has_seat, v_balance
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = p_team_id;
  IF v_waiver_type = 'faab' THEN
    IF v_bid < v_min_bid THEN
      RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is below this league''s minimum bid of $% (faab_min_bid, §7.3.4)', v_bid, v_min_bid
        USING ERRCODE = 'P0001';
    END IF;
    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        'waiver_claim_submit: % has no FAAB balance on record (its league_members seat %) — refusing to accept a bid against money that is not recorded (§12.2)',
        v_team.name, CASE WHEN v_has_seat IS NULL THEN 'is missing' ELSE 'holds NULL' END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_bid > v_balance THEN
      RAISE EXCEPTION 'waiver_claim_submit: a bid of $% is more than %''s FAAB balance of $% (§13.2)', v_bid, v_team.name, v_balance
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_bid <> 0 THEN
    RAISE EXCEPTION
      'waiver_claim_submit: this league decides claims by waiver priority (%), not by bids — a claim carries no money here, so the bid must be $0 (got $%) (§13.2)',
      v_waiver_type, v_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- (9) AN IDENTICAL PENDING CLAIM — same team, same add, same drop.
  SELECT c.* INTO v_dup FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending'
    AND c.add_player_id = p_add AND c.drop_player_id IS NOT DISTINCT FROM p_drop;
  IF FOUND THEN
    RAISE EXCEPTION
      'waiver_claim_submit: % already has a pending claim for % (%)% — cancel it to change the bid or the order',
      v_team.name, v_add_p.full_name, p_add,
      CASE WHEN p_drop IS NULL THEN ' with no drop' ELSE ' dropping ' || v_drop_p.full_name || ' (' || p_drop || ')' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (10) WRITE — the claim at the back of this team's own order.
  SELECT COALESCE(max(c.claim_order), 0) + 1 INTO v_order
  FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending';

  INSERT INTO public.waiver_claims (
    league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order,
    status, action_id, created_by, created_at)
  VALUES (
    p_league_id, p_team_id, p_add, p_drop, v_bid, v_order,
    'pending', p_action_id, auth.uid(), p_at)
  RETURNING * INTO v_claim;

  -- (11) THE COMMISSIONER ARM (TD5): ONE audit row, the system post, the
  --      manager's notification — blind-safe (no player, no bid, league-side).
  IF NOT v_is_manager THEN
    v_receipt := public.waiver_claim_receipt_internal(
      p_league_id, v_team, 'submit_waiver_claim', 'submitted a waiver claim for',
      jsonb_build_array(v_claim.id), v_reason, p_action_id, 'waiver_claim_submit', v_league.season,
      'The commissioner placed a waiver claim for your team',
      'Claim: add ' || v_add_p.full_name
        || CASE WHEN p_drop IS NULL THEN '' ELSE ', drop ' || v_drop_p.full_name END
        || CASE WHEN v_waiver_type = 'faab' THEN ', bid $' || v_bid ELSE '' END
        || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
      jsonb_build_object('claim_id', v_claim.id, 'add_player_id', p_add, 'drop_player_id', p_drop, 'faab_bid', v_bid));
  END IF;

  v_result := jsonb_build_object(
    'verb',                   'waiver_claim_submit',
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'claim', jsonb_build_object(
      'id',             v_claim.id,
      'add_player_id',  v_claim.add_player_id,
      'drop_player_id', v_claim.drop_player_id,
      'faab_bid',       v_claim.faab_bid,
      'claim_order',    v_claim.claim_order,
      'status',         v_claim.status,
      'process_at',     v_claim.process_at,
      'created_at',     v_claim.created_at),
    'add_player_name',        v_add_p.full_name,
    'drop_player_name',       v_drop_p.full_name,
    'waiver_type',            v_waiver_type,
    'faab_min_bid',           CASE WHEN v_waiver_type = 'faab' THEN v_min_bid END,
    'faab_balance',           CASE WHEN v_waiver_type = 'faab' THEN v_balance END,
    'faab_spent',             0,
    'faab_spent_why',         'a claim spends nothing when it is placed — the bid is checked against the balance now and debited only if the claim WINS at the waiver run (TD2)',
    'settled_by',             'the next waiver run — locks, roster room and competing bids are decided there, not here (L.D2.9)',
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'notified_user_id',       v_receipt ->> 'notified_user_id',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.waiver_claim_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, 'waiver_claim_submit', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_submit_internal(UUID, UUID, TEXT, TEXT, INTEGER, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION waiver_claim_submit(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT,
  p_drop      TEXT DEFAULT NULL,
  p_bid       INTEGER DEFAULT NULL,   -- NULL = $0
  p_action_id UUID DEFAULT NULL,      -- REQUIRED in-body (22023)
  p_reason    TEXT DEFAULT NULL       -- OPTIONAL (Q66); stored only on the commissioner arm
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.waiver_claim_submit_internal(
    p_league_id, p_team_id, p_add, p_drop, p_bid, p_action_id, now(), p_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_submit(UUID, UUID, TEXT, TEXT, INTEGER, UUID, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION waiver_claim_submit(UUID, UUID, TEXT, TEXT, INTEGER, UUID, TEXT) IS
  '§13.2 (migration 145, L.D2.5): place a blind waiver claim (add + optional drop + bid) for a team. The team''s manager, or a commissioner acting for any team (one blind-safe commissioner_actions row). Refuses by name: not in season / playoffs, retired team, none_fcfs, add already rostered, drop not on this team, bid below faab_min_bid / above the balance / non-zero under priority, identical pending claim. Spends nothing; replay by action_id is byte-identical.';

-- ---------------------------------------------------------------------------
-- 5b. waiver_claim_cancel_internal + waiver_claim_cancel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_cancel_internal(
  p_league_id UUID,
  p_claim_id  UUID,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_found       BOOLEAN;
  v_claim       public.waiver_claims;
  v_claim_found BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_ledger      public.waiver_claim_actions;
  v_team        public.teams;
  v_reason      TEXT;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_add_name    TEXT;
  v_receipt     JSONB := NULL;
  v_result      JSONB;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_cancel: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_claim_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_cancel: p_claim_id is required — name the claim to cancel'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) THE CLAIM, under the league lock; AUTH on its team. A claim that does
  --     not exist and a claim of another team answer a plain member the SAME
  --     42501 (no existence oracle).
  IF v_found THEN
    SELECT c.* INTO v_claim FROM public.waiver_claims c
    WHERE c.id = p_claim_id AND c.league_id = p_league_id
    FOR UPDATE;
    v_claim_found := FOUND;
  ELSE
    v_claim_found := FALSE;
  END IF;
  v_is_manager := v_claim_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = v_claim.team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'waiver_claim_cancel: not a manager of this claim''s team'
      USING ERRCODE = '42501';
  END IF;
  IF NOT v_claim_found THEN
    RAISE EXCEPTION 'waiver_claim_cancel: no waiver claim % in league %', p_claim_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) REPLAY.
  SELECT a.* INTO v_ledger
  FROM public.waiver_claim_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'waiver_claim_cancel' OR v_ledger.team_id IS DISTINCT FROM v_claim.team_id
       OR (v_ledger.result ->> 'claim_id') IS DISTINCT FROM p_claim_id::text THEN
      RAISE EXCEPTION
        'waiver_claim_cancel: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'waiver_claim_cancel: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = v_claim.team_id;
  SELECT p.full_name INTO v_add_name FROM public.players p WHERE p.id = v_claim.add_player_id;

  -- (4) STATE. Pending → cancel. Already cancelled → a NO-OP by value (no
  --     write, no receipt — standing rule (b)). Settled (won / lost /
  --     invalid) → refused by name: the run already decided it.
  IF v_claim.status IN ('won', 'lost', 'invalid') THEN
    RAISE EXCEPTION
      'waiver_claim_cancel: the claim for % was already settled by a waiver run (%) — only a pending claim can be cancelled',
      v_add_name, v_claim.status
      USING ERRCODE = 'P0001';
  END IF;
  v_no_changes := (v_claim.status = 'cancelled');

  IF NOT v_no_changes THEN
    UPDATE public.waiver_claims c
    SET status = 'cancelled', result_reason = 'cancelled', cancelled_at = p_at, cancelled_by = auth.uid()
    WHERE c.id = p_claim_id AND c.status = 'pending';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'waiver_claim_cancel: the cancel touched % claim rows, expected exactly 1 (claim %)', v_cnt, p_claim_id
        USING ERRCODE = 'P0001';
    END IF;
    -- Keep the team's own order dense (1..n), in the order it had.
    UPDATE public.waiver_claims c
    SET claim_order = o.rn
    FROM (SELECT c2.id, row_number() OVER (ORDER BY c2.claim_order, c2.created_at, c2.id)::int AS rn
          FROM public.waiver_claims c2
          WHERE c2.team_id = v_claim.team_id AND c2.status = 'pending') o
    WHERE c.id = o.id AND c.claim_order <> o.rn;

    IF NOT v_is_manager THEN
      v_receipt := public.waiver_claim_receipt_internal(
        p_league_id, v_team, 'cancel_waiver_claim', 'cancelled a waiver claim for',
        jsonb_build_array(p_claim_id), v_reason, p_action_id, 'waiver_claim_cancel', v_league.season,
        'The commissioner cancelled a waiver claim for your team',
        'Cancelled: add ' || COALESCE(v_add_name, v_claim.add_player_id)
          || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
        jsonb_build_object('claim_id', p_claim_id, 'add_player_id', v_claim.add_player_id));
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'verb',                   'waiver_claim_cancel',
    'league_id',              p_league_id,
    'team_id',                v_claim.team_id,
    'team_name',              v_team.name,
    'action_id',              p_action_id,
    'claim_id',               p_claim_id,
    'add_player_id',          v_claim.add_player_id,
    'add_player_name',        v_add_name,
    'status',                 'cancelled',
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN 'already_cancelled — the claim was cancelled earlier, so nothing was written and no receipt was issued' END,
    'pending_claims',         (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'claim_order', c.claim_order) ORDER BY c.claim_order), '[]'::jsonb)
                               FROM public.waiver_claims c WHERE c.team_id = v_claim.team_id AND c.status = 'pending'),
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'notified_user_id',       v_receipt ->> 'notified_user_id',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.waiver_claim_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, v_claim.team_id, 'waiver_claim_cancel', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_cancel_internal(UUID, UUID, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION waiver_claim_cancel(
  p_league_id UUID,
  p_claim_id  UUID,
  p_action_id UUID DEFAULT NULL,   -- REQUIRED in-body (22023)
  p_reason    TEXT DEFAULT NULL    -- OPTIONAL (Q66)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.waiver_claim_cancel_internal(p_league_id, p_claim_id, p_action_id, now(), p_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_cancel(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION waiver_claim_cancel(UUID, UUID, UUID, TEXT) IS
  '§13.2 (migration 145, L.D2.5): cancel a pending waiver claim. The team''s manager, or a commissioner for any team (one blind-safe commissioner_actions row). Already cancelled = no-op (no receipt); settled claims refused by name. The team''s remaining order stays dense; replay by action_id is byte-identical.';

-- ---------------------------------------------------------------------------
-- 5c. waiver_claim_reorder_internal + waiver_claim_reorder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_claim_reorder_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_claim_ids UUID[],
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_found       BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_ledger      public.waiver_claim_actions;
  v_team        public.teams;
  v_reason      TEXT;
  v_missing     TEXT;
  v_extra       TEXT;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_n           INTEGER;
  v_receipt     JSONB := NULL;
  v_result      JSONB;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_team_id is required — a team orders its own claims'
      USING ERRCODE = '22023';
  END IF;
  IF p_claim_ids IS NULL OR cardinality(p_claim_ids) = 0 THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_claim_ids is required — the team''s pending claims, first to last'
      USING ERRCODE = '22023';
  END IF;
  IF array_position(p_claim_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_claim_ids holds a NULL — every entry names one claim'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_claim_ids) x) <> cardinality(p_claim_ids) THEN
    RAISE EXCEPTION 'waiver_claim_reorder: p_claim_ids names a claim more than once — each pending claim appears exactly once'
      USING ERRCODE = '22023';
  END IF;

  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'waiver_claim_reorder: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_ledger
  FROM public.waiver_claim_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'waiver_claim_reorder' OR v_ledger.team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION
        'waiver_claim_reorder: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'waiver_claim_reorder: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'waiver_claim_reorder: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock this team's pending claims, then require EXACTLY that set.
  PERFORM 1 FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending'
  FOR UPDATE;
  SELECT string_agg(c.id::text, ', ' ORDER BY c.claim_order) INTO v_missing
  FROM public.waiver_claims c
  WHERE c.team_id = p_team_id AND c.status = 'pending' AND NOT (c.id = ANY (p_claim_ids));
  SELECT string_agg(x::text, ', ' ORDER BY o) INTO v_extra
  FROM unnest(p_claim_ids) WITH ORDINALITY AS u(x, o)
  WHERE NOT EXISTS (SELECT 1 FROM public.waiver_claims c
                    WHERE c.id = u.x AND c.team_id = p_team_id AND c.status = 'pending');
  IF v_missing IS NOT NULL OR v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'waiver_claim_reorder: the new order must list exactly %''s pending claims, each once — missing: %; not a pending claim of this team: %',
      v_team.name, COALESCE(v_missing, 'none'), COALESCE(v_extra, 'none')
      USING ERRCODE = 'P0001';
  END IF;

  v_n := cardinality(p_claim_ids);
  v_no_changes := NOT EXISTS (
    SELECT 1 FROM unnest(p_claim_ids) WITH ORDINALITY AS u(x, o)
    JOIN public.waiver_claims c ON c.id = u.x
    WHERE c.claim_order <> u.o);

  IF NOT v_no_changes THEN
    UPDATE public.waiver_claims c
    SET claim_order = u.o
    FROM unnest(p_claim_ids) WITH ORDINALITY AS u(x, o)
    WHERE c.id = u.x AND c.team_id = p_team_id AND c.status = 'pending';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> v_n THEN
      RAISE EXCEPTION 'waiver_claim_reorder: the reorder touched % claim rows, expected % (team %)', v_cnt, v_n, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_is_manager THEN
      v_receipt := public.waiver_claim_receipt_internal(
        p_league_id, v_team, 'reorder_waiver_claims', 'reordered the waiver claims of',
        to_jsonb(p_claim_ids), v_reason, p_action_id, 'waiver_claim_reorder', v_league.season,
        'The commissioner reordered your team''s waiver claims',
        'Your pending claims have a new order'
          || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END,
        jsonb_build_object('claim_ids', to_jsonb(p_claim_ids)));
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'verb',                   'waiver_claim_reorder',
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    'action_id',              p_action_id,
    'pending_claims',         (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'claim_order', c.claim_order) ORDER BY c.claim_order), '[]'::jsonb)
                               FROM public.waiver_claims c WHERE c.team_id = p_team_id AND c.status = 'pending'),
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN 'same_order — the claims were already in this order, so nothing was written and no receipt was issued' END,
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'notified_user_id',       v_receipt ->> 'notified_user_id',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.waiver_claim_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, 'waiver_claim_reorder', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_reorder_internal(UUID, UUID, UUID[], UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION waiver_claim_reorder(
  p_league_id UUID,
  p_team_id   UUID,
  p_claim_ids UUID[],
  p_action_id UUID DEFAULT NULL,   -- REQUIRED in-body (22023)
  p_reason    TEXT DEFAULT NULL    -- OPTIONAL (Q66)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.waiver_claim_reorder_internal(p_league_id, p_team_id, p_claim_ids, p_action_id, now(), p_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_claim_reorder(UUID, UUID, UUID[], UUID, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION waiver_claim_reorder(UUID, UUID, UUID[], UUID, TEXT) IS
  '§13.2 (migration 145, L.D2.5): set a team''s own claim order (claim_order 1..n) — the list must be exactly the team''s pending claims, each once. The team''s manager, or a commissioner for any team (one blind-safe commissioner_actions row). Same order = no-op (no receipt); replay by action_id is byte-identical.';
