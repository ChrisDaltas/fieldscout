-- ============================================================================
-- The Scout PAIR — golden pins for migration 108 (task SC.4; spec v2.16.11
-- §7.3.3 + Appendix B.5.1 AS MARKED UP by Chris 2026-09-01; PROGRESS
-- F203/D284/D285).
--
-- The 054 pattern, applied to 108's two halves:
--   §A THE RENAME CENSUS — the 'Scout Scoring' → 'Scout Standard' rename
--     proved at the table, not assumed from the migration's shape (the
--     CLAUDE.md "nothing happened" rule): exactly ONE 'Scout Standard',
--     ZERO 'Scout Scoring' (the old natural key is gone), 'Scout PPR'
--     present, and the template census at EIGHT.
--   §B SCOUT PPR GOLDEN PINS — the COMPLETE seeded row (description, all
--     43 coefficients) as stored literals (R23), the same literals
--     templates.ts authors and templates-db.test.ts deep-equals; PLUS the
--     pair pin — Scout PPR's body minus `receptions` byte-equals Scout
--     Standard's minus `receptions`, proven at the STORED rows (B.5.1:
--     "the same 43 keys, one value apart"), with the one divergent value
--     pinned by its raw text rendering (`->>`), so a stored 0.20 — jsonb-
--     equal but not the authored literal — still reds (the D283(5) scale
--     lesson).
--
-- Falsifiability notes (§4.3):
--   * §A3 (Scout PPR exists) is this task's deliberate-break target for
--     probe (a): with 108's seed dropped (transactional DELETE — the F145
--     harness, nothing persisted) it reds at 0 and §A4 at 7.
--   * §A1/§A2 are the rename probe's targets (probe (b)): with the rename
--     reverted (transactional UPDATE back to 'Scout Scoring') §A1 reds at
--     0 and §A2 at 1.
--   * The two GATE pins are killing cells, not prose (D276): return_yards
--     ABSENT (RULED 0.05 but F71-gated — the pair annotation: the future
--     seed-update covers BOTH rows) and pat_missed ABSENT (the fg_missed
--     −1 ruling was FG-specific; B.5 states the two are not a pair).
--   * is_system_default FALSE at the row: D34's research-surface meaning
--     untouched — §7.3.3's "system default" is the UI preselection (per
--     family since v2.16.11), never a DB flag.
--   * The split-model D/ST is pinned via scoring_detect_tier_cuts (the
--     published ESPN 8-cut PA / 9-cut YA lists — 053 §B2's family), and
--     the pair pin (§B6) already forces the D/ST subset byte-equal to
--     Scout Standard's, which 054 §B6 pins byte-equal to ESPN Standard's.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

-- ---------------------------------------------------------------------------
-- A. The rename census + the pair's flags (postgres context).
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from scoring_systems where is_template and name = 'Scout Standard'),
  1::bigint,
  'A1: exactly one Scout Standard template row — 108''s rename landed (probe (b)''s target: a reverted rename reds this at 0)');

select is(
  (select count(*) from scoring_systems where is_template and name = 'Scout Scoring'),
  0::bigint,
  'A2: ZERO rows still carry the seed-time name Scout Scoring — the natural key MOVED, it was not duplicated (the rename census''s killing cell)');

select is(
  (select count(*) from scoring_systems where is_template and name = 'Scout PPR'),
  1::bigint,
  'A3: the Scout PPR template row is seeded (108 — probe (a)''s deliberate-break target)');

select is(
  (select count(*) from scoring_systems where is_template),
  8::bigint,
  'A4: the template census is EIGHT — 058''s parity six plus the Scout pair');

select is(
  (select owner_id is null and not is_system_default from scoring_systems where is_template and name = 'Scout PPR'),
  true,
  'A5: Scout PPR is owner-less and is_system_default FALSE (D59 CHECK; D34''s research-surface meaning untouched — the §7.3.3 default is the per-family UI preselection, never a DB flag)');

-- ---------------------------------------------------------------------------
-- B. Scout PPR golden pins — the complete row as stored literals (R23).
-- ---------------------------------------------------------------------------
select is(
  (select description from scoring_systems where is_template and name = 'Scout PPR'),
  'Scout PPR is the same clean rule set with one addition: 0.2 points per reception. The catch earns something — it''s how production starts — but a fifth of a point can''t outscore the yards and touchdowns it''s supposed to lead to. Full PPR pays a full point for volume alone and lets catch counts inflate scores; 0.2 rewards the catch without inflating it.',
  'B1: description is B.5.1''s APPROVED "why it''s better" copy, byte-equal to the authored literal (templates.ts)');

select is(
  (select rules from scoring_systems where is_template and name = 'Scout PPR'),
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
  }'::jsonb,
  'B2: the COMPLETE rules object — all 43 B.5.1 coefficients as a stored literal (Scout Standard''s body, receptions 0.2)');

select is(
  (select count(*) from jsonb_object_keys((select rules from scoring_systems where is_template and name = 'Scout PPR')) k),
  43::bigint,
  'B3: exactly 43 coefficients — the SAME 43 keys as Scout Standard (B.5.1)');

select is(
  (select rules ? 'return_yards' from scoring_systems where is_template and name = 'Scout PPR'),
  false,
  'B4 (killing cell for the F71 gate): return_yards is ABSENT — RULED 0.05 but no registry key exists (Q13/D173); F71''s future seed-update covers BOTH Scout rows (the 2026-09-01 pair annotation)');

select is(
  (select rules ? 'pat_missed' from scoring_systems where is_template and name = 'Scout PPR'),
  false,
  'B5 (killing cell): pat_missed is ABSENT — the fg_missed −1 markup ruling was FG-SPECIFIC; B.5 states the two are not a pair, and the pair inherits that');

select is(
  (select rules - 'receptions' from scoring_systems where is_template and name = 'Scout PPR'),
  (select rules - 'receptions' from scoring_systems where is_template and name = 'Scout Standard'),
  'B6 (THE PAIR PIN): Scout PPR''s rules minus receptions EQUAL Scout Standard''s minus receptions, at the STORED rows — "the same 43 keys, one value apart" proven in the table, not claimed from the seed''s shape (B.5.1)');

select is(
  (select rules ->> 'receptions' from scoring_systems where is_template and name = 'Scout PPR'),
  '0.2',
  'B7: the ONE divergence — Scout PPR receptions renders as exactly ''0.2'' (raw text via ->>, so a jsonb-equal-but-rescaled 0.20 still reds — the D283(5) scale lesson)');

select is(
  (select rules ->> 'receptions' from scoring_systems where is_template and name = 'Scout Standard'),
  '0',
  'B8: …and Scout Standard''s stays the explicit 0 (the Standard-row convention; the rename moved the name, never a value)');

select is(
  (select (public.scoring_detect_tier_cuts(rules) -> 'def_pa')::text from scoring_systems where is_template and name = 'Scout PPR'),
  '[0, 1, 7, 14, 18, 28, 35, 46]',
  'B9: scoring_detect_tier_cuts resolves Scout PPR to the published ESPN 8-cut PA list (053 §B2''s family — the pair rides the ESPN split families)');

select is(
  (select (public.scoring_detect_tier_cuts(rules) -> 'def_ya')::text from scoring_systems where is_template and name = 'Scout PPR'),
  '[0, 100, 200, 300, 350, 400, 450, 500, 550]',
  'B10: …and to the published 9-cut YA list (dst_model split — never a shared-only subset)');

select lives_ok(
  $$ select public.scoring_rules_validate((select rules from public.scoring_systems where is_template and name = 'Scout PPR')) $$,
  'B11: the stored Scout PPR rules pass the SE.4 validator — read from the table, never re-authored (the 051 §C2 premise extended to the 8th row; 0.2 is 2dp, guardrail 5)');

-- ---------------------------------------------------------------------------
-- C. RLS — the pre-auth picker surface reaches BOTH halves of the pair.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(
  (select count(*) from scoring_systems where is_template and name in ('Scout Standard', 'Scout PPR')),
  2::bigint,
  'C1: anon sees both Scout rows (058''s world-readable template policy — the picker''s pre-auth surface, where each family preselects its own half)');

select * from finish();
rollback;
