-- ============================================================================
-- player_stats box-score columns — M1 task L.A1.7 (tasks-M1-league-foundation.md
-- §6/§7: migration 057, was 045 — renumbered per the corrected §7 table);
-- spec-redraft-leagues.md §7.3.3 (one namespace) + §23.5 (core_box catalog,
-- Appendix B.1 + B.4) + PROGRESS D41 (evidence-gated storage completion) +
-- D20 (per-type 2-pt storage "is M1 work") + the Q3 ruling (def_ya_* family,
-- resolved 2026-07-19).
--
-- 1. Additive columns for the deferred core_box keys that are column-stored
--    from M1 on (D41's "final list from the registry audit"). Column names
--    equal their canonical registry keys exactly — no more misleadingly-named
--    columns (the fg_made_40_plus lesson, D20):
--      pass_2pt, rush_2pt, rec_2pt        (per-type 2-pt, D20; the writer's
--                                          summed two_point_conversions
--                                          derivation continues byte-identical
--                                          alongside — both are written)
--      fg_0_39, fg_missed, pat_missed     (kicking, App B.4)
--      def_block, def_return_td           (D/ST, App B.4)
--      fumble_recovery_td, return_td      (offense misc, App B.1)
--      def_yards_allowed                  (raw yards-allowed ingestion key —
--                                          the Q3/ESPN split-model feed; the
--                                          derived def_ya_* tier indicators
--                                          are NEVER stored, D44)
--    The def_pa_*/def_ya_* tier-indicator keys and the App B.4 bonuses get NO
--    columns: tier indicators are derived at scoring time from
--    def_points_allowed / def_yards_allowed (D44); bonuses stay deferred to
--    the v1.1 custom-scoring unlock.
--
-- 2. ESPN split-D/ST verification (Q3's build-time condition — the ruling
--    required the bucket boundaries confirmed against ESPN's PUBLISHED table,
--    not the spec's recollection). Verified 2026-07-20 from ESPN's official
--    support pages:
--      https://support.espn.com/hc/en-us/articles/360003914032-Scoring-Formats
--        Standard D/ST points-allowed: 0 → +5 · 1–6 → +4 · 7–13 → +3 ·
--        14–17 → +1 · 18–27 → 0 · 28–34 → −1 · 35–45 → −3 · 46+ → −5.
--        Yards-allowed buckets (complete list): <100 · 100–199 · 200–299 ·
--        300–349 · 350–399 · 400–449 · 450–499 · 500–549 · 550+.
--      https://support.espn.com/hc/en-us/articles/115003847231-Defense-and-Special-Teams-D-ST-Scoring
--        Split model confirmed: a D/ST starts each game at +10 in standard
--        scoring — 0 points allowed worth +5 and 0 yards allowed worth +5.
--    FINDING (spec erratum, recorded not silently corrected — PROGRESS D56 /
--    spec changelog v2.8.3): ESPN's published points-allowed buckets
--    (…14–17 / 18–27 / 28–34 / 35–45 / 46+) do NOT match D21's "industry-
--    standard boundaries all three platforms share" (…14–20 / 21–27 / 28–34 /
--    35+) — the shared def_pa family cannot express ESPN's published table.
--    The registry therefore seeds ESPN's own buckets additively
--    (def_pa_14_17, def_pa_18_27, def_pa_35_45, def_pa_46_plus) beside the
--    shared family, and the def_ya_* family lands on the nine published
--    yards-allowed buckets above. Note for L.A1.9: the support pages publish
--    the standard PA *values* and the YA *buckets*, but not the standard YA
--    values — the template task must pull those from ESPN's in-product
--    default scoring settings when it seeds the ESPN template rows.
--    [R50 addendum, 2026-07-20 — the published source is internally
--    inconsistent, recorded so L.A1.9 doesn't rediscover it cold: the SAME
--    Scoring-Formats article's custom-options list buckets points-allowed
--    as 0 / 2–6 / 7–13 / 14–17 / 18–21 / 22–27 / 28–34 / 35–45 / 46+ —
--    diverging from the standard-scoring list transcribed above (1–6;
--    18–27 as one bucket) on the same page. At standard values the
--    divergence is score-invisible (18–21 and 22–27 both sit in the
--    0-point range; PA=1 vs 2–6 differs only for a lone-safety 1-point
--    game), so the four keys seeded here stand; but if ESPN's PRODUCT
--    renders the finer bucketization, def_pa_1_6/def_pa_18_27 cannot
--    represent those rows one-for-one. Resolution is L.A1.9's, ledgered
--    as F19. Cross-check anchor for L.A1.9's in-product pull: the D/ST
--    article implicitly publishes one standard YA value — 0 yards allowed
--    is worth +5, i.e. def_ya_0_99's standard value.]
--
-- 3. pgTAP waiver (citable, per the L.A1.7 task text): NO pgTAP file ships
--    with this migration — additive columns on an already-tested table, no
--    policy/constraint changes; coverage is the registry golden-pin vitest
--    suite (stat-keys.test.ts, full key list as literals) + the upsert-
--    surface continuity pins (live-stats.test.ts), consistent with plan
--    §2.3's "pgTAP tests for policies/constraints" scoping.
--    [RETIRED per R52, 2026-07-20: the cited coverage pinned the WRITER
--    surface only — nothing executable touched the 11 columns in the
--    database (vitest opens no DB connection; type-check reads the
--    committed database.ts, regenerated only manually; no pgTAP file
--    referenced the columns — deleting this ALTER TABLE failed zero
--    tests). The "policies/constraints" scoping was also contradicted by
--    house precedent (005/009/010 all carry columns_are shape pins).
--    pgTAP 011_player_stats_box_columns.sql now pins the full column set
--    + per-column type/default for the 11.]
--
-- Standing rules (tasks-M1 §4): grants doctrine (D18→D23) — no per-object
-- GRANTs (037's default ACLs apply; RLS on player_stats is unchanged and
-- remains the gate; the table stays sync-script-written per CLAUDE.md).
-- No SECURITY DEFINER routines here → no REVOKE targets. Realtime: n/a
-- (no new table; D38). §8.1 staging-rehearsal waiver per the R6 go-forward
-- rule: no staging clone exists; the rehearsal evidence is a fresh local
-- `supabase db reset` over 001–057 plus the full test suite, shown in the
-- L.A1.7 session log. Typegen re-run (new column shapes) with the
-- database.ts hand-written alias block re-appended.
-- ============================================================================

ALTER TABLE player_stats
  ADD COLUMN IF NOT EXISTS pass_2pt INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rush_2pt INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rec_2pt INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fg_0_39 INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fg_missed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pat_missed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS def_block INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS def_return_td INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fumble_recovery_td INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_td INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS def_yards_allowed INTEGER DEFAULT 0;

COMMENT ON COLUMN player_stats.pass_2pt IS
  '2-pt conversions (pass) — per-type storage for the canonical pass_2pt key (D20); two_point_conversions keeps the summed writer-side derivation alongside.';
COMMENT ON COLUMN player_stats.rush_2pt IS
  '2-pt conversions (rush) — per-type storage for the canonical rush_2pt key (D20).';
COMMENT ON COLUMN player_stats.rec_2pt IS
  '2-pt conversions (reception) — per-type storage for the canonical rec_2pt key (D20).';
COMMENT ON COLUMN player_stats.fg_0_39 IS
  'FG made, 0–39 yards (canonical fg_0_39, App B.4). No Sleeper actuals mapping yet — see the registry audit note (L.A1.7).';
COMMENT ON COLUMN player_stats.fg_missed IS
  'FG missed, any distance (canonical fg_missed, App B.4). No Sleeper actuals mapping yet.';
COMMENT ON COLUMN player_stats.pat_missed IS
  'PAT missed (canonical pat_missed, App B.4; Sleeper xpmiss — evidenced in the real 2025-wk2 actuals fixture).';
COMMENT ON COLUMN player_stats.def_block IS
  'Blocked punt/PAT/FG (canonical def_block, App B.4). No Sleeper actuals mapping yet.';
COMMENT ON COLUMN player_stats.def_return_td IS
  'D/ST return TD (canonical def_return_td, App B.4). No Sleeper actuals mapping yet.';
COMMENT ON COLUMN player_stats.fumble_recovery_td IS
  'Offensive fumble recovered for TD (canonical fumble_recovery_td, App B.1). No Sleeper actuals mapping yet.';
COMMENT ON COLUMN player_stats.return_td IS
  'Offensive kick/punt return TD (canonical return_td, App B.1). No Sleeper actuals mapping yet.';
COMMENT ON COLUMN player_stats.def_yards_allowed IS
  'Raw total yards allowed (canonical def_yards_allowed) — feeds the derived def_ya_* tier indicators (D44/Q3); the indicators themselves are never stored. No Sleeper actuals mapping yet.';
