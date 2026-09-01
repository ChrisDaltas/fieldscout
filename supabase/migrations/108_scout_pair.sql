-- ============================================================================
-- The Scout PAIR — "Scout Standard" + "Scout PPR". Task SC.4 (PROGRESS
-- F203/D284/D285); spec-redraft-leagues.md v2.16.11 §7.3.3 (amended table +
-- system-default bullet) + Appendix B.5.1 (MARKED UP by Chris 2026-09-01 —
-- the rename and the opening side RULED, both copy marks APPROVED).
--
-- BOTH halves in ONE transaction (the Supabase CLI wraps each migration
-- file in a transaction; the DO block below additionally refuses to let the
-- rename half-succeed silently):
--
--   (1) THE RENAME — 106's seeded row 'Scout Scoring' → 'Scout Standard'
--       (RULED at the 2026-09-01 markup, D284(7)(a)). NEVER an edit to 106:
--       the name is the row's NATURAL KEY under the (name) WHERE is_template
--       partial UNIQUE (058), so the rename is the row's identity moving —
--       an UPDATE here, with 106 left byte-identical (the SE.4-chain
--       0-line-diff pins hold for 106 exactly as for 058). The partial
--       UNIQUE makes the rename atomic and collision-checked: a pre-existing
--       'Scout Standard' template row would abort this transaction loudly.
--       Row count asserted EXACTLY 1 (the CLAUDE.md "nothing happened"
--       rule): 0 means the Scout row is missing or was renamed out-of-band
--       — reconcile per docs/specs/runbook-hosted-migration-reconciliation.md
--       before re-running; 2+ is impossible under the partial UNIQUE but is
--       refused anyway rather than assumed away.
--
--   (2) THE SCOUT PPR SEED — Scout Standard's 43-key body with EXACTLY ONE
--       value changed, `receptions: 0.2` (B.5.1: "the same 43 keys, one
--       value apart"; 0.2 is 2dp — §7.3.3.1 guardrail 5 holds). Same
--       natural-key idempotent pattern as 058/106 (ON CONFLICT converges on
--       the authored values). The rules object is the AUTHORED export of
--       src/lib/leagues/scoring/templates.ts (the Scout PPR entry — a
--       one-key spread of Scout Standard's body in TS, transcribed here
--       value-for-value); templates-db.test.ts deep-equals the seeded row
--       against that export and pgTAP 056 golden-pins the same literals, so
--       a drifted transcription fails both.
--
-- ORDER inside the transaction: rename FIRST, then seed — so at no point
-- does the table hold 'Scout Scoring' beside 'Scout PPR' (an asymmetric
-- pair B.5.1 explicitly costed and Chris did not take).
--
-- `return_yards` 0.05 is RULED and GATED for BOTH rows (Q13/D173/F71 — the
-- pair annotation of 2026-09-01): no registry key exists, so this seed
-- OMITS it exactly as 106 did. Nothing here un-gates it.
--
-- `is_system_default` seeds FALSE — the column keeps its D34
-- research-surface meaning (measured at SC.1, 106's banner); §7.3.3's
-- "system default" is a UI PRESELECTION (SC.3/SC.4 — per family since
-- v2.16.11: No-PPR view → Scout Standard, PPR view → Scout PPR, unfiltered
-- mock launcher → the system default Scout Standard), never a DB flag.
--
-- ── What this migration does NOT do ─────────────────────────────────────────
-- No schema change: no new column, table, index, policy, function or
-- trigger (058's CHECK, policies and index already govern both rows).
-- Therefore: no typegen (shape-derived types, no shape moved), grants
-- doctrine D18→D23 n/a (no new objects), no SECURITY DEFINER routines → no
-- REVOKE targets, realtime n/a (D38 — no new table). §8.1
-- staging-rehearsal waiver per the R6 go-forward rule: no staging clone
-- exists; rehearsal evidence is `npx supabase migration up` over the
-- applied local chain (001–107 → 108) plus the full pgTAP + stack-backed
-- suites, and CI's from-scratch replay of the whole chain (the Database
-- lane). Registered in supabase/HELD-FROM-PRODUCTION.txt in the same PR
-- (the closed-range rule — a new migration reds the drift check until
-- declared).
-- ============================================================================

-- ── (1) The rename: 'Scout Scoring' → 'Scout Standard', exactly one row ────
DO $$
DECLARE
  v_renamed integer;
BEGIN
  UPDATE public.scoring_systems
     SET name = 'Scout Standard',
         updated_at = NOW()
   WHERE is_template
     AND name = 'Scout Scoring';

  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  IF v_renamed <> 1 THEN
    RAISE EXCEPTION
      'Scout rename touched % rows, expected exactly 1: the ''Scout Scoring'' '
      'template row (migration 106) is missing or was already renamed '
      'out-of-band. Never let "nothing happened" mean "it worked" — '
      'reconcile per docs/specs/runbook-hosted-migration-reconciliation.md '
      'before re-running.', v_renamed;
  END IF;
END
$$;

-- ── (2) The Scout PPR seed: Scout Standard's body, receptions 0.2 ──────────
INSERT INTO scoring_systems (name, description, owner_id, is_system_default, is_template, rules)
VALUES
  (
    'Scout PPR',
    'Scout PPR is the same clean rule set with one addition: 0.2 points per reception. The catch earns something — it''s how production starts — but a fifth of a point can''t outscore the yards and touchdowns it''s supposed to lead to. Full PPR pays a full point for volume alone and lets catch counts inflate scores; 0.2 rewards the catch without inflating it.',
    NULL,
    FALSE,
    TRUE,
    '{
      "pass_yards": 0.05, "pass_tds": 6, "interceptions": -2, "pass_2pt": 2,
      "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
      "receptions": 0.2, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
      "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
      "fg_0_39": 3, "fg_40_49": 3, "fg_50_plus": 3, "pat_made": 1, "fg_missed": -1,
      "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
      "def_safety": 2, "def_block": 2, "def_return_td": 6,
      "def_pa_0": 5, "def_pa_1_6": 4, "def_pa_7_13": 3, "def_pa_14_17": 1,
      "def_pa_18_27": 0, "def_pa_28_34": -1, "def_pa_35_45": -3, "def_pa_46_plus": -5,
      "def_ya_0_99": 5, "def_ya_100_199": 3, "def_ya_200_299": 2, "def_ya_300_349": 0,
      "def_ya_350_399": -1, "def_ya_400_449": -3, "def_ya_450_499": -5,
      "def_ya_500_549": -6, "def_ya_550_plus": -7
    }'::jsonb
  )
ON CONFLICT (name) WHERE is_template
DO UPDATE SET
  description = EXCLUDED.description,
  rules = EXCLUDED.rules,
  updated_at = NOW();
