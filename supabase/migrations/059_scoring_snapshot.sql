-- ============================================================================
-- Scoring snapshot RPC + league lifecycle guard — M1 task L.A1.11 (the Phase A
-- gate's item 2). Spec: §7.3.3 (scoring snapshot — freeze scoring_systems.rules
-- into leagues.scoring_rules_snapshot), §7.3.8 final validation bullet ("a
-- league in `drafting`+ must always have a non-null scoring_rules_snapshot"),
-- §7.1 (status machine), §12.0 (v2.0 SECURITY DEFINER hardening). PROGRESS D43
-- (snapshot mechanism), D63 (this migration's mechanics).
--
-- NUMBERING (D50(1) precedent — state the correction in the banner): the task
-- text says "047_scoring_snapshot.sql" and "pgTAP 011"; both predate the
-- renumberings recorded in tasks-M1 §7 (048–051 review/hardening chips, 054
-- batch-2 fixes) and the pgTAP drift (008/011 taken by review-fix batches, 012
-- by L.A1.9). Next free at task time, confirmed against the repo: migration
-- **059**, pgTAP **013**.
--
-- Contents:
--   1. `leagues_status_valid` CHECK — the §7.1 six-state enum, printed by
--      §12.1 only as a SQL comment: the exact R43 gap class (unconstrained
--      TEXT accepted 'banana' on teams.status until 054). Same fix-at-the-
--      task precedent as 056/league_weeks (D55(2a)); this is the task that
--      installs the lifecycle machine, so the enum closes here. Additive,
--      validates existing rows on ADD (zero league rows exist pre-launch —
--      040's C9 gate verified; a violating environment fails loudly).
--   2. `leagues_snapshot_guard()` + trigger `trg_leagues_snapshot_guard` —
--      D43: raises on any row that would be in `drafting`/`in_season`/
--      `playoffs`/`complete` with `scoring_rules_snapshot IS NULL`. Fires
--      BEFORE **INSERT OR UPDATE** and checks the NEW row unconditionally
--      (not just OLD→NEW status changes): §7.3.8's invariant is "must ALWAYS
--      have", and D43's purpose is a DB guarantee "even against privileged
--      paths" — an update-only, transition-only trigger would still admit a
--      privileged INSERT born in 'drafting' and an UPDATE nulling the
--      snapshot while drafting. Plain (non-SECURITY-DEFINER) trigger fn with
--      SET search_path = '' (D49(3) pattern — touches only NEW, needs no
--      table access, narrower privileges). Triggers fire for every role
--      including service_role/postgres (BYPASSRLS does not bypass triggers)
--      — that is the point. M2's draft_start inherits the guarantee
--      mechanically (D43).
--   3. `snapshot_league_scoring(p_league_id)` — SECURITY DEFINER, SET
--      search_path = '', in-body commish check (42501), REVOKE FROM PUBLIC,
--      anon (038 precedent; standing rule §4.1). Copies the referenced
--      scoring_systems.rules into scoring_rules_snapshot. LOUD failure —
--      never a silent NULL snapshot — when scoring_system_id IS NULL or the
--      referenced row is missing (the FK makes dangling unreachable today;
--      the guard is defense-in-depth per the task pointer). Restricted to
--      status IN ('setup','scheduled') (R69 — supersedes the shipped
--      no-restriction reading): §7.3.3's freeze moments are draft start
--      (M2's draft_start snapshots BEFORE transitioning, i.e. calls from
--      'scheduled') and the audited commissioner scoring change (M6). Until
--      the audited path exists, an unrestricted RPC lets a commissioner
--      silently re-freeze scoring MID-DRAFT/mid-season from M2 on — the DB
--      now refuses that instead of relying on future audit prose. M6
--      loosens this alongside the audit log; the restriction fails LOUDLY
--      there (P0001 naming M6), so no ledger row is needed — nothing is
--      left silently unprotected.
--      Row-locked (FOR UPDATE) to serialize with concurrent transitions.
--   4. `set_league_status(p_league_id, p_status)` — same SECURITY DEFINER
--      form + REVOKE. Validates the §7.1 transitions available in M1,
--      checked in-body, SQL-native only (task item 2):
--        * commish auth (42501);
--        * `setup → scheduled` requires settings->'draft'->>
--          'draft_scheduled_at' present (jsonb null / '' / missing all
--          refuse) AND castable to timestamptz (a 'scheduled' league with
--          an unparseable draft instant is corrupt state the DB can
--          trivially refuse; the cast raises 22007/22008 loudly). The path
--          is the D60(4) NESTED draft block — the shape splitSettings
--          (L.A1.6) actually writes; the task text's top-level
--          `settings->>'draft_scheduled_at'` sketch predated D60(4) and is
--          deliberately NOT read (R67 — pgTAP pins the old shape refusing);
--        * `scheduled → setup` allowed (§7.1 backward move, pre-draft);
--        * same-status is an idempotent no-op success (client retries must
--          not error — the L.A1.12 double-submit concern, D63);
--        * anything → `drafting`+ refused: "the draft engine lands in M2" —
--          M2's draft_start RPC is the sanctioned path and will hit the D43
--          trigger mechanically;
--        * transitions FROM `drafting`+ refused (M2+ owns them — §7.1's
--          backward moves are audited overrides, audit log lands M6).
--      Full §7.3.8 settings validation is deliberately NOT re-implemented in
--      SQL: L.A1.13's Route Handler (`validateLeagueSettings`) is the named
--      enforcement point per §7.3.8's "enforced in API + DB constraints"
--      split; the DB-level backstops are 040's CHECKs, the §1 status CHECK,
--      and the D43 trigger. No §7.3.8 bullet is named for SQL
--      reimplementation in M1 (task item 2).
--
-- Grants doctrine (D18→D23/§4.1): no per-object GRANTs; the two RPCs get the
-- explicit REVOKE narrowing below (authenticated + service_role keep EXECUTE
-- via the 037 default ACLs; the in-body checks are the effective gate).
-- Soft-deleted leagues (deleted_at IS NOT NULL) are treated as not found by
-- both RPCs.
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the fresh
-- local `db reset` over 001–059 + the full pgTAP suite is the rehearsal
-- evidence. Realtime line waived per D38 (no live subscriber in the M1 UI
-- slice). Typegen RE-RUN (R68 — corrects this banner's original claim): the
-- two RPCs are new PostgREST-exposed functions, so the generated Functions
-- surface DOES change (the 048/054 no-regen precedents covered altered
-- bodies/config of existing functions, not new ones); database.ts
-- regenerated per standing rule §4.4 with the hand-written alias block
-- re-appended, diff verified additive-only.
-- Prod-safe: additive constraint on a zero-row table + new functions/trigger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. §7.1 status enum CHECK (closes the R43 gap class on leagues.status)
-- ----------------------------------------------------------------------------
ALTER TABLE leagues
  ADD CONSTRAINT leagues_status_valid
    CHECK (status IN ('setup', 'scheduled', 'drafting', 'in_season', 'playoffs', 'complete'));

-- ----------------------------------------------------------------------------
-- 2. D43 lifecycle guard trigger (§7.3.8 final bullet as a DB guarantee)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION leagues_snapshot_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- §7.3.8: a league in drafting+ must ALWAYS have a non-null snapshot.
  -- Checked on the NEW row for INSERT and UPDATE alike — covers the forced
  -- transition, the born-in-drafting INSERT, and the snapshot-nulling UPDATE
  -- (D43: holds even against privileged paths; triggers ignore BYPASSRLS).
  IF NEW.status IN ('drafting', 'in_season', 'playoffs', 'complete')
     AND NEW.scoring_rules_snapshot IS NULL THEN
    RAISE EXCEPTION
      'league %: cannot be in status % without scoring_rules_snapshot — call snapshot_league_scoring first (spec §7.3.8/D43)',
      NEW.id, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leagues_snapshot_guard
  BEFORE INSERT OR UPDATE ON leagues
  FOR EACH ROW
  EXECUTE FUNCTION leagues_snapshot_guard();

-- ----------------------------------------------------------------------------
-- 3. snapshot_league_scoring — freeze the referenced rules (§7.3.3)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION snapshot_league_scoring(p_league_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scoring_system_id UUID;
  v_status TEXT;
  v_rules JSONB;
BEGIN
  -- In-body authorization (§12.0/§8.3): commissioner or co-commissioner only.
  -- A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'snapshot_league_scoring: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.scoring_system_id, l.status INTO v_scoring_system_id, v_status
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'snapshot_league_scoring: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- R69: pre-draft statuses only. §7.3.3's freeze moments are draft start
  -- (M2's draft_start snapshots from 'scheduled', before its transition) and
  -- the AUDITED commissioner scoring change — which is M6 work. Until the
  -- audited path exists, refusing drafting+ closes the silent mid-draft/
  -- mid-season re-freeze at the DB; M6 loosens this loudly alongside the
  -- audit log (this raise names it).
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'snapshot_league_scoring: league % is in % — scoring is frozen once the draft starts; in-season changes land with the audited path (M6)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- LOUD, never silent (task pointer): a league with no scoring reference
  -- cannot produce a snapshot — refuse, do not write NULL.
  IF v_scoring_system_id IS NULL THEN
    RAISE EXCEPTION
      'snapshot_league_scoring: league % has no scoring_system_id — nothing to snapshot (§7.3.8: exactly one scoring system referenced)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT s.rules INTO v_rules
  FROM public.scoring_systems s
  WHERE s.id = v_scoring_system_id;
  IF NOT FOUND THEN
    -- Unreachable while the leagues.scoring_system_id FK holds; kept as
    -- defense-in-depth so a future FK change can never silently NULL a
    -- snapshot.
    RAISE EXCEPTION
      'snapshot_league_scoring: scoring system % referenced by league % does not exist',
      v_scoring_system_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Re-snapshot overwrites (§7.3.3: re-freeze on any commissioner scoring
  -- change; pgTAP 013 boundary probe).
  UPDATE public.leagues
  SET scoring_rules_snapshot = v_rules,
      updated_at = NOW()
  WHERE id = p_league_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION snapshot_league_scoring(UUID) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 4. set_league_status — §7.1 transitions available in M1
-- ----------------------------------------------------------------------------
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
END;
$$;

REVOKE EXECUTE ON FUNCTION set_league_status(UUID, TEXT) FROM PUBLIC, anon;
