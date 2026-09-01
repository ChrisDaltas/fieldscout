-- ============================================================================
-- Scout Scoring — the 7th template row: FieldScout's house template and the
-- system default for new leagues. Task SC.1 (PROGRESS F186/D279);
-- spec-redraft-leagues.md v2.16.9 §7.3.3 (amended table + system-default
-- bullet) + Appendix B.5 (the stat-by-stat table, MARKED UP by Chris
-- 2026-08-31 — every value RULED or APPROVED; the two markup overrides are
-- fg_missed −1 and the ESPN-style SPLIT D/ST model).
--
-- The rules object below is the AUTHORED export of
-- src/lib/leagues/scoring/templates.ts (SCOUT_SCORING_RULES), transcribed
-- value-for-value — 43 coefficients (14 offense/turnover/return + 5 kicking
-- + 7 D/ST events + 8 ESPN PA tiers + 9 YA tiers). The TS↔DB equivalence
-- test (templates-db.test.ts) deep-equals the seeded row against that
-- export, and pgTAP 054 golden-pins the same literals — a drifted
-- transcription fails both. The D/ST PA/YA values are the shipped
-- Q9-verified ESPN tables (byte-equal to 058's two ESPN rows — B.5's split
-- ruling reads them from the shipped bodies, never from memory).
--
-- `return_yards` 0.05 is RULED and GATED (Q13/D173/ledger F71): no registry
-- key exists, so the seed OMITS it until F71's data task lands. Nothing
-- here un-gates it.
--
-- ── is_system_default = FALSE, measured, not assumed (task SC.1's finding) ──
-- The column does NOT mean "the default league template". Measured 2026-08-31:
--   * D34 + 058's banner/column comment reserve it for its separate
--     RESEARCH-SURFACE meaning ("untouched");
--   * its only reader anywhere is 001's world-readable SELECT policy
--     ("System defaults are viewable by everyone") — redundant for template
--     rows, which 058's `is_template` policy already exposes;
--   * no application code queries it (`grep -rn is_system_default src/` →
--     the generated types + templates-db.test.ts only), and no seed
--     anywhere sets it TRUE;
--   * two pins ASSERT it FALSE on every template row (pgTAP 012 §B's D34
--     cell; templates-db.test.ts:79) — neither is in D278(4)'s measured
--     blast radius, i.e. they were measured NOT to move.
-- §7.3.3's "system default" is a UI PRESELECTION (never a silent write;
-- D170's birth predicate untouched) landing in TS at task SC.3
-- (league-create-wizard-ops / mock-launch-ops) — no DB flag is involved.
-- So this row seeds is_system_default = FALSE exactly like 058's six, and
-- 058's rows are untouched (no "exactly one default" semantics exist).
--
-- ── What this migration does ────────────────────────────────────────────────
-- ONE idempotent seed row on 058's natural-key pattern (partial UNIQUE on
-- (name) WHERE is_template; ON CONFLICT DO UPDATE converges on the authored
-- values). NEVER an edit to 058 — the SE.4 chain pins 058's seeds at a
-- 0-line diff. No schema change: no new column, table, index, policy,
-- function or trigger (058's CHECK, policies and index already govern the
-- row). Therefore: no typegen (the generated types are shape-derived and no
-- shape moved), grants doctrine D18→D23 n/a (no new objects), no SECURITY
-- DEFINER routines → no REVOKE targets, realtime n/a (D38 — no new table).
-- §8.1 staging-rehearsal waiver per the R6 go-forward rule: no staging clone
-- exists; rehearsal evidence is `npx supabase migration up` over the applied
-- local chain (001–105 → 106) plus the full pgTAP + stack-backed suites,
-- and CI's from-scratch replay of the whole chain (the Database lane).
-- Registered in supabase/HELD-FROM-PRODUCTION.txt in the same PR (the
-- closed-range rule — a new migration reds the drift check until declared).
-- ============================================================================

INSERT INTO scoring_systems (name, description, owner_id, is_system_default, is_template, rules)
VALUES
  (
    'Scout Scoring',
    'FieldScout''s own default scoring — one clean rule set instead of a pile of inherited quirks. Six points for every touchdown, whoever scores it. Three points for every field goal, wherever it''s kicked from. No PPR. 10 rushing or receiving yards to the point, 20 passing yards. −2 for all turnovers. D/ST scored on ESPN''s published points-allowed and yards-allowed tables. Defined by FieldScout (August 2026), not copied from another platform''s defaults.',
    NULL,
    FALSE,
    TRUE,
    '{
      "pass_yards": 0.05, "pass_tds": 6, "interceptions": -2, "pass_2pt": 2,
      "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
      "receptions": 0, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
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
