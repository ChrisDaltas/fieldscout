-- ============================================================================
-- scoring_systems.is_template + the 6 v1 parity template rows — M1 task
-- L.A1.9 (tasks-M1-league-foundation.md §6/§7: migration 058, was 046 —
-- renumbered per the corrected §7 table); spec-redraft-leagues.md §7.3.3
-- (templates-only v1, parity guarantee, scoring snapshot) + Appendix B.1/B.4
-- (+ the ⚠ re-verify rule) + PROGRESS D34 (additive is_template column,
-- owner_id NULL, world-readable SELECT) + D44 (dst_model = which tier-key
-- families a template's rules carry) + D59 (this task's mechanics).
--
-- The rules objects seeded below are the AUTHORED exports of
-- src/lib/leagues/scoring/templates.ts, transcribed value-for-value; the
-- TS↔DB equivalence test (templates-db.test.ts) deep-equals every seeded
-- row against those exports, and pgTAP 012 golden-pins the same literals —
-- a drifted transcription fails both.
--
-- ── Source evidence (App B "re-verify every cell at build time") ────────────
-- Every value was re-verified 2026-07-21 against official sources (the
-- L.A1.9 pre-halt source pass; full verbatim evidence, payloads, and
-- interpretation method: PROGRESS-leagues.md §3 Q9 — per the Q9 ruling this
-- migration seeds from that recorded evidence without refetching):
--   * ESPN Standard/Full PPR —
--       https://support.espn.com/hc/en-us/articles/360003914032-Scoring-Formats
--       https://support.espn.com/hc/en-us/articles/115003847231-Defense-and-Special-Teams-D-ST-Scoring
--       cross-checked value-for-value against ESPN's in-product default
--       payloads (the F19 pull, no auth):
--       https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/1?view=mSettings   (Standard)
--       https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=mSettings   (PPR — differs ONLY by receptions = 1)
--     Offense 0.04/4/−2/2 · 0.1/6/2 · 0.1/6/2 (+1 rec in PPR) · fumble −2 ·
--     KR/PR + fumble-recovery TD 6. Kicking 3/4/5 by distance, PAT 1, FG
--     miss −1, no PAT-miss penalty. D/ST events 1/2/2/6/2/2/6. PA (ESPN's
--     own buckets, v2.8.3): 0/1–6/7–13/14–17/18–27/28–34/35–45/46+ at
--     +5/+4/+3/+1/0/−1/−3/−5. YA (F19(a), the in-product pull, anchor
--     `def_ya_0_99 = +5` from the D/ST article): <100/100–199/200–299/
--     300–349/350–399/400–449/450–499/500–549/550+ at
--     +5/+3/+2/0/−1/−3/−5/−6/−7. Published 0-point rows (PA 18–27,
--     YA 300–349) are seeded as explicit 0 coefficients — the payloads omit
--     them (omitted-zero convention, proven in Q9); the published tables
--     print them.
--   * Yahoo Standard/Half PPR — https://help.yahoo.com/kb/SLN6489.html
--     (full defaults): 0.04/4/−1 · 0.1/6 · 0.1/6 (+0.5 rec in Half PPR —
--     Yahoo's platform default) · combined 2-pt category 2 (expressed as the
--     per-type 2/2/2 — score-equal) · fumble −2 · return/off-fum-ret TD 6.
--     Kicking: 0–19/20–29/30–39 all = 3 (score-equal, collapsed to
--     fg_0_39 = 3) · 40–49 = 4 · 50+ = 5 · PAT 1 · NO miss penalties in
--     defaults (keys omitted, not zero). D/ST events 1/2/2/6/2/2/6; single
--     PA model on the shared family: 0/1–6/7–13/14–20/21–27/28–34/35+ at
--     +10/+7/+4/+1/0/−1/−4.
--   * Sleeper Standard/Full PPR — categories verified at
--     https://support.sleeper.com/en/articles/3998131-scoring-settings
--     (shared PA family; FG buckets with no 60+ tier), but Sleeper publishes
--     NO default values and its in-product creation defaults sit behind
--     login (out of bounds). Per the house verification rule the VALUES ship
--     as App B.1/B.4 best-known, FLAGGED unverified — PROGRESS ledger F24
--     (September raw-feed/product verification); never silently trusted.
--
-- ── Named parity exceptions (Q9 RULED 2026-07-22, option (a)+(c); spec
--    erratum v2.8.5) ────────────────────────────────────────────────────────
-- ESPN's verified defaults score three categories the current data tier
-- cannot observe (no `fg_50_59`/`fg_60_plus`/PAT-play keys exist, no
-- columns, and — decisive — no provider signal: Sleeper's `fgm_50p`
-- aggregates everything ≥50):
--   1. FG made 60+ = 6 (seeded as fg_50_plus = 5 → −1 pt vs ESPN per make);
--   2. D/ST safety on a PAT try = +1 (unscored);
--   3. D/ST return score on a PAT try = +2 (unscored).
-- Order ~5–15 plays league-wide per NFL season combined. Ruling rationale:
-- keys with no feed signal would be PERMANENTLY pending — a standing E61
-- state manufactured on every ESPN league every week is strictly worse than
-- a documented exception. Ruling condition (enforced by pgTAP 012 + the
-- templates tests): the exceptions are USER-VISIBLE in the ESPN templates'
-- `description` — a plain-language line a commissioner can read — not only
-- in this banner. Lift path (ruling part (c)): the September F10
-- raw-endpoint inspection additionally checks for a Sleeper 60+ FG spelling
-- (e.g. fgm_60p) and PAT-play detail; a found signal makes the tier a
-- one-PR §23.5 data task and the exception shrinks or closes.
--
-- ── What this migration does ────────────────────────────────────────────────
-- 1. `is_template BOOLEAN NOT NULL DEFAULT FALSE` — additive (D34);
--    `is_system_default` keeps its research-surface meaning untouched.
-- 2. CHECK `scoring_systems_template_ownerless`: a template row is
--    owner-less (is_template ⇒ owner_id IS NULL). This single constraint is
--    what makes template rows CLIENT-IMMUTABLE under the existing 001
--    policies (the Q8 doctrine applied here — the anti-shadow guard): the
--    owner FOR ALL policy reaches only `auth.uid() = owner_id` rows, so
--    owner_id-NULL template rows are unreachable for UPDATE/DELETE, and any
--    attempt to MINT a shadow template (INSERT own-owned is_template row, or
--    UPDATE flipping is_template on an own row) violates the CHECK (23514).
--    Writes to real template rows are service-role/migration-only. All
--    probed per role in pgTAP 012.
-- 3. Partial UNIQUE index on (name) WHERE is_template — the seed's stable
--    natural key (task text item 3); template names are §7.3.3's table
--    verbatim. Non-template rows keep free naming.
-- 4. "Templates viewable by everyone" SELECT policy (is_template = TRUE) —
--    world-readable incl. anon (D34; the picker and pre-auth compare view).
-- 5. Idempotent seed of the 6 rows (`owner_id NULL`, `is_template TRUE`,
--    ON CONFLICT on the natural key DO UPDATE — re-application converges on
--    the authored values).
--
-- Standing rules (tasks-M1 §4): grants doctrine (D18→D23) — no per-object
-- GRANTs (037's default ACLs apply; RLS is the gate). No SECURITY DEFINER
-- routines here → no REVOKE targets. Realtime: n/a (no new table; D38).
-- §8.1 staging-rehearsal waiver per the R6 go-forward rule: no staging clone
-- exists; the rehearsal evidence is a fresh local `supabase db reset` over
-- 001–058 plus the full test suite, shown in the L.A1.9 session log.
-- Typegen re-run (new column shape) with the database.ts hand-written alias
-- block re-appended (+ new `ScoringSystem` alias).
-- ============================================================================

ALTER TABLE scoring_systems
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN scoring_systems.is_template IS
  'v1 parity template row (spec §7.3.3/App B; D34): owner_id NULL, world-readable, client-immutable (058 CHECK + pgTAP 012). is_system_default keeps its separate research-surface meaning.';

ALTER TABLE scoring_systems
  ADD CONSTRAINT scoring_systems_template_ownerless
  CHECK (is_template = FALSE OR owner_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scoring_systems_template_name
  ON scoring_systems (name) WHERE is_template;

CREATE POLICY "Templates viewable by everyone"
  ON scoring_systems FOR SELECT USING (is_template = TRUE);

-- ── The 6 parity template rows (§7.3.3 table order) ─────────────────────────
INSERT INTO scoring_systems (name, description, owner_id, is_system_default, is_template, rules)
VALUES
  (
    'ESPN Standard',
    'ESPN''s 2026 default scoring, 0 PPR — verified against ESPN''s published defaults (July 2026). Interceptions −2. Heads up on two tiny gaps our stat feed cannot see: ESPN awards 6 points for a 60+ yard field goal (scored here as a 50+ make, 5 points), and 1–2 points when a D/ST scores a safety or return on a PAT try (not scored here). Combined, that is roughly 5–15 plays across the entire NFL per season. Every other category matches ESPN to the cent.',
    NULL,
    FALSE,
    TRUE,
    '{
      "pass_yards": 0.04, "pass_tds": 4, "interceptions": -2, "pass_2pt": 2,
      "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
      "receptions": 0, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
      "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
      "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1, "fg_missed": -1,
      "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
      "def_safety": 2, "def_block": 2, "def_return_td": 6,
      "def_pa_0": 5, "def_pa_1_6": 4, "def_pa_7_13": 3, "def_pa_14_17": 1,
      "def_pa_18_27": 0, "def_pa_28_34": -1, "def_pa_35_45": -3, "def_pa_46_plus": -5,
      "def_ya_0_99": 5, "def_ya_100_199": 3, "def_ya_200_299": 2, "def_ya_300_349": 0,
      "def_ya_350_399": -1, "def_ya_400_449": -3, "def_ya_450_499": -5,
      "def_ya_500_549": -6, "def_ya_550_plus": -7
    }'::jsonb
  ),
  (
    'ESPN Full PPR',
    'ESPN''s 2026 default scoring with 1 point per reception — verified against ESPN''s published defaults (July 2026). Interceptions −2. Heads up on two tiny gaps our stat feed cannot see: ESPN awards 6 points for a 60+ yard field goal (scored here as a 50+ make, 5 points), and 1–2 points when a D/ST scores a safety or return on a PAT try (not scored here). Combined, that is roughly 5–15 plays across the entire NFL per season. Every other category matches ESPN to the cent.',
    NULL,
    FALSE,
    TRUE,
    '{
      "pass_yards": 0.04, "pass_tds": 4, "interceptions": -2, "pass_2pt": 2,
      "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
      "receptions": 1, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
      "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
      "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1, "fg_missed": -1,
      "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
      "def_safety": 2, "def_block": 2, "def_return_td": 6,
      "def_pa_0": 5, "def_pa_1_6": 4, "def_pa_7_13": 3, "def_pa_14_17": 1,
      "def_pa_18_27": 0, "def_pa_28_34": -1, "def_pa_35_45": -3, "def_pa_46_plus": -5,
      "def_ya_0_99": 5, "def_ya_100_199": 3, "def_ya_200_299": 2, "def_ya_300_349": 0,
      "def_ya_350_399": -1, "def_ya_400_449": -3, "def_ya_450_499": -5,
      "def_ya_500_549": -6, "def_ya_550_plus": -7
    }'::jsonb
  ),
  (
    'Yahoo Standard',
    'Yahoo''s 2026 default scoring, 0 PPR — verified against Yahoo''s published defaults (July 2026). Interceptions −1; no missed-kick penalties.',
    NULL,
    FALSE,
    TRUE,
    '{
      "pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
      "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
      "receptions": 0, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
      "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
      "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
      "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
      "def_safety": 2, "def_block": 2, "def_return_td": 6,
      "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
      "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4
    }'::jsonb
  ),
  (
    'Yahoo Half PPR',
    'Yahoo''s 2026 default scoring with 0.5 points per reception — Yahoo''s own platform default, verified against Yahoo''s published defaults (July 2026). Interceptions −1; no missed-kick penalties.',
    NULL,
    FALSE,
    TRUE,
    '{
      "pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
      "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
      "receptions": 0.5, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
      "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
      "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
      "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
      "def_safety": 2, "def_block": 2, "def_return_td": 6,
      "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
      "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4
    }'::jsonb
  ),
  (
    'Sleeper Standard',
    'Sleeper''s default scoring categories, 0 PPR. Sleeper does not publish its default point values; these are the industry-standard values Sleeper is known to use.',
    NULL,
    FALSE,
    TRUE,
    '{
      "pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
      "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
      "receptions": 0, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
      "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
      "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
      "fg_missed": -1, "pat_missed": -1,
      "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
      "def_safety": 2, "def_block": 2, "def_return_td": 6,
      "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
      "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4
    }'::jsonb
  ),
  (
    'Sleeper Full PPR',
    'Sleeper''s default scoring with 1 point per reception — Sleeper''s own platform default. Sleeper does not publish its default point values; these are the industry-standard values Sleeper is known to use.',
    NULL,
    FALSE,
    TRUE,
    '{
      "pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
      "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
      "receptions": 1, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
      "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
      "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
      "fg_missed": -1, "pat_missed": -1,
      "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
      "def_safety": 2, "def_block": 2, "def_return_td": 6,
      "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
      "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4
    }'::jsonb
  )
ON CONFLICT (name) WHERE is_template
DO UPDATE SET
  description = EXCLUDED.description,
  rules = EXCLUDED.rules,
  updated_at = NOW();
