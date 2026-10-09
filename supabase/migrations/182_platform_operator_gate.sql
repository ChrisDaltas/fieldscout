-- ============================================================================
-- 182 — the platform operator gate + `platform_operator_actions`
--       (M8 L.G1.1; tasks-M8-admin-console.md §6 / TD1 / TD2 / TD3;
--       Q95 ruled 2026-10-08: the existing `profiles.is_admin` switch;
--       PROGRESS D511; FULL rigour — permissions, audit)
-- ============================================================================
--
-- WHAT THIS ADDS — the two pieces every later M8 verb stands on. No verb is
-- built here (L.G1.2 – L.G1.4 add them), so this migration changes no
-- behaviour any user can reach today.
--
--   1. `is_platform_operator()` — THE gate (TD1). True only for a signed-in
--      user whose own profile row has `is_admin` (Q95 (a)). It reads
--      `profiles` and NOTHING ELSE: it never reads `league_members`, so a
--      commissioner gets nothing from it and an operator gets no league power
--      from it. `is_admin` is service-role-write-only (026's trigger refuses
--      an anon / authenticated change; `profiles` has no INSERT or DELETE
--      policy, 001:580-584), so the column is trustworthy. pgTAP 130 re-proves
--      both self-grant routes are closed.
--      SECURITY DEFINER + search_path '' so it can be an RLS predicate whose
--      answer does not depend on the caller's view of `profiles`. EXECUTE is
--      held by `authenticated` and `service_role` only: it is an RLS policy
--      predicate (the 052:28-39 exception — like is_league_member it is
--      evaluated AS the calling role), and a TO-authenticated policy means
--      anon never needs it. It answers a yes/no about the caller only, so it
--      leaks nothing.
--
--   2. `platform_operator_actions` — the operator audit (TD2), mirroring
--      §12.12's `commissioner_actions` (123) and its TRUNCATE close (133):
--        • one row per operator change, none per no-op (standing rule 7) —
--          that discipline is each verb's; this table only records;
--        • `action_id` UNIQUE NOT NULL — TD3's idempotency key is ON the audit
--          row, so a replayed verb finds its earlier receipt instead of
--          writing a second one (a duplicate insert fails loudly, 23505);
--        • `scope` 'platform' | 'league', with `league_id` required exactly
--          when scope = 'league' (CHECK);
--        • `league_id` carries NO foreign key, on purpose: the operator log
--          is the platform's record and must OUTLIVE a deleted league. An FK
--          would need ON DELETE CASCADE (the log dies with the league — the
--          opposite of the point) or SET NULL (an UPDATE, which the
--          immutability trigger refuses — so the league would become
--          undeletable, 123's R966). The id stays as a historical fact;
--        • `reason` OPTIONAL (Chris 2026-09-16: never require a reason), but a
--          supplied one must be non-blank and ≤ 500 chars (123's CHECK shape,
--          R745 class);
--        • readable by operators ONLY (RLS SELECT TO authenticated USING the
--          gate); NO INSERT / UPDATE / DELETE policy — every write comes from
--          a DEFINER verb through the helper below;
--        • immutable: BEFORE UPDATE OR DELETE row trigger + BEFORE TRUNCATE
--          statement trigger, both ENABLE ALWAYS (R616 — a plain trigger is
--          skipped under session_replication_role = replica), and TRUNCATE
--          revoked from PUBLIC / anon / authenticated (133 / pgTAP 081). No
--          exemption arm is needed (contrast 123's cascade arm) because no FK
--          cascades into this table. The table OWNER is refused too — the
--          trigger, not policy absence, is the backstop.
--
--   3. `log_operator_action_internal(...)` — the one insert seam. PLAIN (not
--      DEFINER): every caller is an operator DEFINER verb already running as
--      the owner (the 123 / 112:1213 posture). EXECUTE revoked from PUBLIC,
--      anon, authenticated. It re-checks in-body that the named actor IS an
--      operator, so a future verb that forgets its gate still cannot write an
--      audit row in a non-operator's name.
--
-- TD11's league-activity line ("FieldScout" signs it) is posted by each
-- league-scoped VERB (L.G1.2 – L.G1.4), not here — there is no verb yet.
--
-- CHECKLIST (tasks-M* §4.4): one new table, RLS enabled (pgTAP 001's
-- backstop), TRUNCATE revoked; two new functions, search_path '' on both,
-- DEFINER only on the gate with in-body auth (auth.uid()); REVOKEs stated.
-- No existing function, table, policy or trigger is altered — nothing is
-- CREATE OR REPLACE'd from an older chain head. No R6 / D38 waiver needed.
-- DEPLOY BEFORE PUSH: no client code calls either object yet (TD9), so merged
-- code is unaffected by the older schema. pgTAP 130_platform_operator_gate.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The gate (TD1, Q95 (a))
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_platform_operator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.is_admin
     );
$$;

COMMENT ON FUNCTION is_platform_operator() IS
  'M8 operator gate (migration 182, TD1 / Q95 (a)): true only for a signed-in user whose own profiles.is_admin is set. Reads profiles only — never league_members — so commissioner status neither grants nor is granted by it. Every op_* verb re-checks it in-body.';

REVOKE ALL ON FUNCTION is_platform_operator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_platform_operator() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The operator audit (TD2)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_operator_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id  UUID NOT NULL UNIQUE,                 -- TD3 idempotency key
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  verb       TEXT NOT NULL
    CHECK (length(btrim(verb, E' \t\r\n')) > 0 AND length(verb) <= 64),
    -- Deliberately not an enumerating CHECK: the op_* verb list grows task by
    -- task (L.G1.2 – L.G1.4), the 123 reasoning.
  scope      TEXT NOT NULL CHECK (scope IN ('platform', 'league')),
  league_id  UUID,                                 -- NO FK, see banner
  reason     TEXT
    CHECK (reason IS NULL
           OR (length(btrim(reason, E' \t\r\n')) > 0 AND length(reason) <= 500)),
  before     JSONB,
  after      JSONB,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_operator_actions_scope_league
    CHECK ((scope = 'league') = (league_id IS NOT NULL))
);

COMMENT ON TABLE platform_operator_actions IS
  'M8 operator audit (migration 182, TD2): one row per operator change, none per no-op; append-only and immutable (trg_op_actions_immutable / trg_op_actions_no_truncate, ENABLE ALWAYS); readable by platform operators only; written only through log_operator_action_internal by op_* DEFINER verbs. league_id has no FK so the record outlives a deleted league.';

CREATE INDEX idx_op_actions_created ON platform_operator_actions (created_at DESC, id DESC);
CREATE INDEX idx_op_actions_league  ON platform_operator_actions (league_id, created_at DESC)
  WHERE league_id IS NOT NULL;

ALTER TABLE platform_operator_actions ENABLE ROW LEVEL SECURITY;
-- Operators read; nobody writes through RLS. The ABSENCE of INSERT / UPDATE /
-- DELETE policies is deliberate — do not add one.
CREATE POLICY "Operator audit readable by platform operators"
  ON platform_operator_actions FOR SELECT TO authenticated
  USING (is_platform_operator());

CREATE OR REPLACE FUNCTION op_actions_immutable_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'platform_operator_actions is append-only: a % on the operator audit is refused (M8 TD2 — an operator undo is a NEW row, never an edit to an old one)',
    TG_OP
    USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER trg_op_actions_immutable
  BEFORE UPDATE OR DELETE ON platform_operator_actions
  FOR EACH ROW EXECUTE FUNCTION op_actions_immutable_internal();
ALTER TABLE platform_operator_actions
  ENABLE ALWAYS TRIGGER trg_op_actions_immutable;

CREATE OR REPLACE FUNCTION op_actions_no_truncate_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'platform_operator_actions is append-only: a TRUNCATE on the operator audit is refused (M8 TD2; a row trigger never sees TRUNCATE and RLS does not apply to it)'
    USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER trg_op_actions_no_truncate
  BEFORE TRUNCATE ON platform_operator_actions
  FOR EACH STATEMENT EXECUTE FUNCTION op_actions_no_truncate_internal();
ALTER TABLE platform_operator_actions
  ENABLE ALWAYS TRIGGER trg_op_actions_no_truncate;
REVOKE TRUNCATE ON TABLE platform_operator_actions FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION op_actions_immutable_internal()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION op_actions_no_truncate_internal() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The insert seam (TD2 / TD3) — PLAIN, REVOKEd
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_operator_action_internal(
  p_action_id UUID,
  p_actor_id  UUID,
  p_verb      TEXT,
  p_scope     TEXT,
  p_league_id UUID,
  p_reason    TEXT,
  p_before    JSONB,
  p_after     JSONB,
  p_metadata  JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.id = p_actor_id AND p.is_admin) THEN
    RAISE EXCEPTION
      'log_operator_action_internal: actor % is not a platform operator — only an operator''s change is written to the operator audit (M8 TD1 / TD2)',
      p_actor_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.platform_operator_actions (
    action_id, actor_id, verb, scope, league_id, reason, before, after, metadata)
  VALUES (
    p_action_id, p_actor_id, p_verb, p_scope, p_league_id, p_reason, p_before, p_after, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION log_operator_action_internal(UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
