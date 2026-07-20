-- ============================================================================
-- Leagues settings columns + Q4/Q7 username contract — M1 task L.A1.1
-- (tasks-M1-league-foundation.md §6/§7; spec-redraft-leagues.md v2.8.1).
--
-- 1. citext extension — required by migration 043's CITEXT columns (§12.23);
--    shipped here per the task plan.
-- 2. Spec §12.1 ALTER TABLE leagues, verbatim: the v2.0 settings catalog's
--    typed columns + settings JSONB + scoring_rules_snapshot + deleted_at.
-- 3. roster_settings DEFAULT swap (spec erratum v2.7.1 / conflict report C9):
--    001's legacy flat shape is replaced with the §7.3.2 preset-table Default
--    counts rendered in the canonical starting_slots[] shape. Guarded by a
--    rows-must-not-exist pre-check — nothing has ever written a leagues row
--    (verified locally at reset; the guard makes the prod precondition loud).
-- 4. Q4/Q7 username contract (rulings, Chris 2026-07-20 — spec v2.8/v2.8.1):
--    usernames are 5–20 chars [a-z0-9_], PERMANENT after explicit selection,
--    case-insensitively unique. AI persona/system accounts are exempt with
--    hyphenated '*-ai' handles (Q7.1) that only privileged roles may write:
--      a. pre-checks: any existing row violating the contract, or any
--         case-insensitive duplicate, aborts the migration loudly (no
--         production users exist per the Q4 ruling; personas match the
--         exempt pattern) — actionable failure, never a half-applied state.
--      b. CHECK profiles_username_format_check:
--            human    ^[a-z0-9_]{5,20}$
--         OR persona  ^[a-z0-9]+(-[a-z0-9]+)*-ai$
--      c. UNIQUE INDEX profiles_username_lower_key ON (lower(username)) —
--         ruled ("lower() unique index if not already present"). With the
--         lowercase-only charset this is redundant with 001's plain unique
--         index BY CONSTRUCTION today; it is kept as ruled defense-in-depth
--         (protects case-insensitive uniqueness if the charset ever widens).
--      d. guard trigger (025/026 pattern): authenticated/anon can never
--         INSERT/UPDATE a persona-pattern username — the CHECK alone cannot
--         tell a persona seed from a hostile PostgREST rename to 'evil-ai'.
--         Combined with the hyphen-free human charset, the '*-ai' suffix is
--         DB-enforced namespace separation for the AI-transparency rule.
--    Deliberately NOT here (Q7.2): a DB-level permanence guard — the
--    /username selection flow is a client-side UPDATE today; permanence is
--    app-enforced (settings field display-only) until selection moves
--    server-side. Documented residual: direct-API renames to *valid human*
--    names remain possible until then.
--    handle_new_user is hardened in migration 049 (NOT here — 048 re-replaces
--    the function after this file runs, so the fix must post-date 048): the
--    signup trigger runs with auth.role() NULL, so WITHOUT 049 an anonymous
--    GoTrue signup carrying user_metadata.username = 'evil-ai' would mint a
--    persona-pattern handle past this guard (found + reproduced in review).
--    049 makes the trigger honor metadata usernames only when they match the
--    human pattern, falling back to 'user_' || 8 hex otherwise (pinned in
--    pgTAP 005).
--
-- Grants: none — per the 037 default-ACL model (D23) grants are uniform and
-- RLS is the gate; no policy changes in this migration (041 owns the §12.1
-- policy swap, after league_members exists). No realtime triggers (D38
-- waiver: no live subscriber in the M1 UI slice).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–048 + pgTAP suite is the rehearsal
-- evidence. Prod-push preconditions the pre-checks enforce: zero leagues
-- rows, zero contract-violating usernames (personas pass the exempt
-- pattern; longest live handle is 17 chars).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. citext (needed by 043's CITEXT columns). Installed WITH SCHEMA extensions
--    per platform convention — Supabase's advisor WARNs on extension_in_public
--    (deliberate divergence from 001's schema-less pgcrypto form; the
--    extensions schema exists on local and hosted, and the default
--    search_path includes it, so CITEXT columns resolve unqualified).
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 2. Spec §12.1 ALTER TABLE leagues (verbatim)
-- ----------------------------------------------------------------------------
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'setup',
    -- setup | scheduled | drafting | in_season | playoffs | complete
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'redraft',
  ADD COLUMN IF NOT EXISTS team_count INTEGER NOT NULL DEFAULT 12
    CHECK (team_count IN (8, 10, 12, 14, 16)),  -- v1; widen in v1.1 (OQ 12)
  ADD COLUMN IF NOT EXISTS regular_season_weeks INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS playoff_teams INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS playoff_start_week INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS waiver_type TEXT NOT NULL DEFAULT 'faab',
  ADD COLUMN IF NOT EXISTS faab_budget INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS trade_review TEXT NOT NULL DEFAULT 'commissioner',
  ADD COLUMN IF NOT EXISTS trade_deadline_week INTEGER,
  ADD COLUMN IF NOT EXISTS lineup_lock TEXT NOT NULL DEFAULT 'per_player_kickoff',
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scoring_rules_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 3. roster_settings DEFAULT → §7.3.2 canonical shape (C9; erratum v2.7.1)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count bigint;
  v_current_default text;
BEGIN
  -- Re-application safety (drift repair / migration-repair re-push): if the
  -- canonical default is already in place, this whole section is a no-op —
  -- don't fail the rows-must-not-exist gate for a swap that already happened
  -- (ALTER ... SET DEFAULT never touches existing rows anyway).
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_current_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.leagues'::regclass AND a.attname = 'roster_settings';
  IF v_current_default LIKE '%starting_slots%' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_count FROM leagues;
  IF v_count > 0 THEN
    RAISE EXCEPTION
      '040: the roster_settings DEFAULT swap assumes an empty leagues table; found % row(s) — migrate their roster_settings to the §7.3.2 canonical shape first (C9)',
      v_count;
  END IF;
END $$;

ALTER TABLE leagues ALTER COLUMN roster_settings SET DEFAULT
  '{"starting_slots":[{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 2}, {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1}, {"key": "flex", "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"], "count": 1}, {"key": "k", "label": "K", "eligible": ["K"], "count": 1}, {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}], "bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb;

-- ----------------------------------------------------------------------------
-- 4a. Username contract pre-checks (loud, actionable — never half-applied)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(quote_literal(username), ', ') INTO v_bad
  FROM profiles
  WHERE username !~ '^[a-z0-9_]{5,20}$'
    AND username !~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '040: username(s) violating the v2.8/v2.8.1 contract: % — resolve before applying (Q4/Q7)',
      v_bad;
  END IF;

  SELECT string_agg(quote_literal(u), ', ') INTO v_bad
  FROM (
    SELECT lower(username) AS u FROM profiles GROUP BY 1 HAVING count(*) > 1
  ) dups;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '040: case-insensitive username duplicate(s): % — resolve before applying (Q4)',
      v_bad;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4b. The contract CHECK (human OR persona)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_username_format_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_username_format_check
      CHECK (
        username ~ '^[a-z0-9_]{5,20}$'
        OR username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$'
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4c. Case-insensitive uniqueness (ruled; see banner for the redundancy note)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key
  ON profiles (lower(username));

-- ----------------------------------------------------------------------------
-- 4d. Namespace guard: '*-ai' handles are reserved for privileged writers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_username_namespace()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- 025's defensive TG_OP form: PostgreSQL does not guarantee OR evaluation
  -- order, so OLD is never referenced in a branch that can run on INSERT.
  IF auth.role() IN ('authenticated', 'anon') THEN
    IF (TG_OP = 'INSERT' AND NEW.username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$')
       OR (TG_OP = 'UPDATE'
           AND NEW.username IS DISTINCT FROM OLD.username
           AND NEW.username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$') THEN
      RAISE EXCEPTION '"-ai" usernames are reserved for FieldScout AI accounts.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_username_namespace ON profiles;
CREATE TRIGGER trg_guard_username_namespace
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_username_namespace();
