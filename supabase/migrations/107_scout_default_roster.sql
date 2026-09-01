-- ============================================================================
-- Scout default roster — WR 2 → 3 in `leagues.roster_settings` column DEFAULT.
-- Task SC.2 (PROGRESS F186/D283); spec-redraft-leagues.md v2.16.9 §7.3.2 as
-- amended by the Scout entry (Chris's 2026-08-26 ruled roster, verbatim:
-- 1 QB / 2 RB / 3 WR / 1 TE / 1 FLEX W-R-T / 1 K / 1 D/ST · bench 6 · 1 IR).
--
-- SC.1 measured (and this task re-measured before editing) that the delta
-- between the shipped default and the ruled roster is EXACTLY ONE NUMBER:
-- the wr slot's count, 2 → 3. `DEFAULT_ROSTER_SETTINGS`
-- (src/lib/leagues/settings/league-settings.ts), migration 040's column
-- DEFAULT, and §7.3.2's preset table already agreed on every other value.
--
-- ── FUTURE ROWS ONLY — NO BACKFILL (F186's own text) ────────────────────────
-- An `ALTER COLUMN ... SET DEFAULT` touches no stored row by definition, and
-- that is the PRODUCT intent, not just the mechanism: existing leagues keep
-- their chosen roster — a default is not a retrofit. This migration therefore
-- deliberately contains NO UPDATE statement, and (unlike 040 §3) NO
-- rows-must-not-exist gate: rows existing is the expected, supported case.
-- pgTAP 055 §B proves the property on a live row (an explicit wr-2 roster
-- survives the operative statement byte-identically).
--
-- ── Authored against 040's shape read from the FILE (D137) ──────────────────
-- The DEFAULT expression below is 040's own literal (040 line 120, read from
-- the file — never from `pg_get_expr` of whatever happens to be deployed;
-- the migration-073 lesson) with the single wr count changed. 040 itself is
-- NEVER edited.
--
-- ── Drift guard (loud failure, CLAUDE.md "nothing happened" rule) ───────────
-- Before swapping, the DO block evaluates the CURRENT column default and
-- requires it to be one of exactly two known values: 040's canonical shape
-- (the normal path) or this migration's Scout shape (re-application safety —
-- drift repair / migration-repair re-push, the 040 §3 precedent). Anything
-- else means the database and the repo have diverged, and the swap RAISES
-- rather than silently papering over an unknown default.
--
-- ── Checklist (§8.1; the 106-banner pattern) ────────────────────────────────
-- No new column, table, index, policy, function or trigger — one column
-- DEFAULT swap. Therefore: no typegen (measured, not assumed: a regen diff
-- against src/types/database.ts is empty — DEFAULT presence already made
-- roster_settings optional on Insert since 001), grants doctrine D18→D23 n/a
-- (no new objects), no SECURITY DEFINER routines → no REVOKE targets,
-- realtime n/a (D38 — no new table). §8.1 staging-rehearsal waiver per the
-- R6 go-forward rule: no staging clone exists; rehearsal evidence is
-- `npx supabase migration up` over the applied local chain (001–106 → 107)
-- plus the full pgTAP + stack-backed suites, and CI's from-scratch replay of
-- the whole chain (the Database lane). Registered in
-- supabase/HELD-FROM-PRODUCTION.txt in the same PR (the closed-range rule —
-- a new migration reds the drift check until declared).
-- ============================================================================

DO $$
DECLARE
  v_current jsonb;
  v_040_canonical constant jsonb :=
    '{"starting_slots":[{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 2}, {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1}, {"key": "flex", "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"], "count": 1}, {"key": "k", "label": "K", "eligible": ["K"], "count": 1}, {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}], "bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb;
  v_scout constant jsonb :=
    '{"starting_slots":[{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 3}, {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1}, {"key": "flex", "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"], "count": 1}, {"key": "k", "label": "K", "eligible": ["K"], "count": 1}, {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}], "bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb;
BEGIN
  -- Evaluate the CURRENT default expression to a jsonb value (structural,
  -- so jsonb's key-order normalization can't fake a mismatch).
  EXECUTE 'SELECT ' || (
    SELECT pg_get_expr(d.adbin, d.adrelid)
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.leagues'::regclass AND a.attname = 'roster_settings'
  ) INTO v_current;

  IF v_current IS NULL OR (v_current <> v_040_canonical AND v_current <> v_scout) THEN
    RAISE EXCEPTION
      '107: leagues.roster_settings carries an UNRECOGNIZED default (%) — neither 040''s canonical shape nor the Scout shape. The database and the repo have diverged; reconcile before applying (see docs/specs/runbook-hosted-migration-reconciliation.md).',
      v_current;
  END IF;
END $$;

-- The operative statement (pgTAP 055 §B replays this byte-for-byte over a
-- live wr-2 row to prove no stored row moves). Idempotent: re-setting the
-- same DEFAULT is a no-op.
ALTER TABLE leagues ALTER COLUMN roster_settings SET DEFAULT
  '{"starting_slots":[{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 3}, {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1}, {"key": "flex", "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"], "count": 1}, {"key": "k", "label": "K", "eligible": ["K"], "count": 1}, {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}], "bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb;
