-- ============================================================================
-- Scout Scoring — golden pins for migration 106's seeded row (task SC.1;
-- spec v2.16.9 §7.3.3 + Appendix B.5 AS MARKED UP by Chris 2026-08-31;
-- PROGRESS F186/D278/D279).
--
-- The 012 pattern, applied to the 7th template: the COMPLETE seeded row —
-- name, flags, description, and every coefficient — as stored literals
-- (R23), the same literals templates.ts authors and templates-db.test.ts
-- deep-equals, so a drifted 106 transcription fails here AND in vitest.
-- Deliberately a NEW file rather than a retrofit into 012 (D278(4): 012
-- keeps its plan(41); its three census cells move 6 → 7 in place).
--
-- Falsifiability notes (§4.3):
--   * The existence cell (§A1) is the task's deliberate-break target: with
--     the Scout row absent (probe: transactional DELETE — the F145 harness,
--     nothing persisted) it reds at 0, and the census cell (§A4) at 6.
--   * The two GATE pins are killing cells, not prose (D276): return_yards
--     ABSENT (RULED 0.05 but F71-gated — no registry key exists) and
--     pat_missed ABSENT (the fg_missed −1 ruling was FG-specific; B.5
--     states the two are not a pair).
--   * is_system_default FALSE is pinned AT THE ROW: the column keeps its
--     D34 research-surface meaning (measured in 106's banner — §7.3.3's
--     "system default" is SC.3's UI preselection, not a DB flag).
--   * The split-model D/ST is pinned twice: the def_pa_*/def_ya_* subset
--     BYTE-EQUALS ESPN Standard's (B.5's markup ruling reads the values
--     from the shipped ESPN bodies), and scoring_detect_tier_cuts resolves
--     Scout to the published ESPN 8-cut PA / 9-cut YA lists (the 053 §B2
--     entry, pinned at the source row too).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- A. The row and its flags (postgres context).
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from scoring_systems where is_template and name = 'Scout Scoring'),
  1::bigint,
  'A1: the Scout Scoring template row is seeded (106 — the deliberate-break target)');

select is(
  (select owner_id is null from scoring_systems where is_template and name = 'Scout Scoring'),
  true,
  'A2: Scout Scoring is owner-less (D59 CHECK: is_template => owner_id IS NULL)');

select is(
  (select is_system_default from scoring_systems where is_template and name = 'Scout Scoring'),
  false,
  'A3: is_system_default is FALSE — the column keeps its D34 research-surface meaning; the §7.3.3 system default is SC.3''s UI preselection, never a DB flag (SC.1''s measured finding, 106 banner)');

select is(
  (select count(*) from scoring_systems where is_template),
  7::bigint,
  'A4: the template census is now SEVEN — 058''s parity six plus Scout Scoring');

-- ---------------------------------------------------------------------------
-- B. Golden pins — the complete row as stored literals (R23).
-- ---------------------------------------------------------------------------
select is(
  (select description from scoring_systems where is_template and name = 'Scout Scoring'),
  'FieldScout''s own default scoring — one clean rule set instead of a pile of inherited quirks. Six points for every touchdown, whoever scores it. Three points for every field goal, wherever it''s kicked from. No PPR. 10 rushing or receiving yards to the point, 20 passing yards. −2 for all turnovers. D/ST scored on ESPN''s published points-allowed and yards-allowed tables. Defined by FieldScout (August 2026), not copied from another platform''s defaults.',
  'B1: description is the authored literal (templates.ts, byte-equal)');

select is(
  (select rules from scoring_systems where is_template and name = 'Scout Scoring'),
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
  }'::jsonb,
  'B2: the COMPLETE rules object — all 43 App B.5 coefficients as a stored literal (every TD 6 incl. passing; flat FG 3; pass 0.05/yd; receptions explicit 0; fg_missed −1 RULED 2026-08-31; ESPN split D/ST)');

select is(
  (select count(*) from jsonb_object_keys((select rules from scoring_systems where is_template and name = 'Scout Scoring')) k),
  43::bigint,
  'B3: exactly 43 coefficients (B.5''s recount: 14 + 5 + 7 + 8 + 9)');

select is(
  (select rules ? 'return_yards' from scoring_systems where is_template and name = 'Scout Scoring'),
  false,
  'B4 (killing cell for the F71 gate): return_yards is ABSENT — RULED 0.05 in B.5''s table but no registry key exists (Q13/D173); the seed omits it until F71''s data task lands');

select is(
  (select rules ? 'pat_missed' from scoring_systems where is_template and name = 'Scout Scoring'),
  false,
  'B5 (killing cell): pat_missed is ABSENT — the fg_missed −1 markup ruling was FG-SPECIFIC and pat_missed omitted is blanket-approved; B.5 states the two are not a pair');

select is(
  (select jsonb_object_agg(key, value) from jsonb_each((select rules from scoring_systems where is_template and name = 'Scout Scoring')) e
    where key like 'def!_pa!_%' escape '!' or key like 'def!_ya!_%' escape '!'),
  (select jsonb_object_agg(key, value) from jsonb_each((select rules from scoring_systems where is_template and name = 'ESPN Standard')) e
    where key like 'def!_pa!_%' escape '!' or key like 'def!_ya!_%' escape '!'),
  'B6: Scout''s ENTIRE def_pa_*/def_ya_* table byte-equals ESPN Standard''s — B.5''s split ruling reads the values from the shipped Q9-verified ESPN bodies, never from memory');

select is(
  (select (public.scoring_detect_tier_cuts(rules) -> 'def_pa')::text from scoring_systems where is_template and name = 'Scout Scoring'),
  '[0, 1, 7, 14, 18, 28, 35, 46]',
  'B7: scoring_detect_tier_cuts resolves Scout to the published ESPN 8-cut PA list (the 053 §B2 entry, pinned at the source row)');

select is(
  (select (public.scoring_detect_tier_cuts(rules) -> 'def_ya')::text from scoring_systems where is_template and name = 'Scout Scoring'),
  '[0, 100, 200, 300, 350, 400, 450, 500, 550]',
  'B8: …and to the published 9-cut YA list (dst_model split — never a shared-only subset, which 053 §B4 would refuse as ambiguous)');

select lives_ok(
  $$ select public.scoring_rules_validate((select rules from public.scoring_systems where is_template and name = 'Scout Scoring')) $$,
  'B9: the stored Scout rules pass the SE.4 validator — read from the table, never re-authored (the 051 §C2 premise extended to the 7th row)');

-- ---------------------------------------------------------------------------
-- C. RLS — the pre-auth picker surface reaches the row.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(
  (select count(*) from scoring_systems where is_template and name = 'Scout Scoring'),
  1::bigint,
  'C1: anon sees the Scout row (058''s world-readable template policy — the picker''s pre-auth surface, where SC.3 will preselect it)');

select * from finish();
rollback;
