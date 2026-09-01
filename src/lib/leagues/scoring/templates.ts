/**
 * SCORING_TEMPLATES — the 7 shipped templates (spec §7.3.3 / Appendix B;
 * M1 task L.A1.9; PROGRESS D34/D44/D59): the 6 v1 parity templates plus
 * Scout Scoring, FieldScout's house template and the system default for new
 * leagues (App B.5, marked up by Chris 2026-08-31; SC.1/F186/D279).
 *
 * This module is the AUTHORED source of truth for the template rules objects.
 * Migrations 058 (the parity six) and 106 (Scout Scoring) seed these exact
 * objects into `scoring_systems` rows
 * (`is_template = TRUE`, `owner_id NULL`); the TS↔DB equivalence test
 * (templates-db.test.ts) deep-equals every seeded row against these exports,
 * so the rules the parity gate tests in TS (L.A1.10) are provably the rules
 * production snapshots read from the DB (§7.3.3 scoring snapshot).
 *
 * Rules objects use CANONICAL REGISTRY KEYS ONLY (§7.3.3 one namespace —
 * mechanically enforced by templates.test.ts against STAT_KEYS). ESPN
 * templates carry both `def_pa_*` (ESPN buckets, v2.8.3) and `def_ya_*`
 * (`dst_model` split, D44); Yahoo/Sleeper carry the shared `def_pa_*`
 * family only (single model).
 *
 * ── Source evidence (App B "re-verify every cell at build time") ──────────
 * Every value below was verified 2026-07-21 against the platforms' official
 * sources; the full retrieval record (URLs, verbatim payloads, interpretation
 * method) is PROGRESS-leagues.md §3 Q9 — per the Q9 ruling this module seeds
 * from that recorded evidence without refetching:
 *  - ESPN: Scoring-Formats article 360003914032 + D/ST article 115003847231
 *    (support.espn.com), cross-checked value-for-value against ESPN's own
 *    in-product default payloads (lm-api-reads.fantasy.espn.com …
 *    /seasons/2026/segments/0/leaguedefaults/1 and /3, view=mSettings).
 *    Zero-valued published rows (PA 18–27, YA 300–349) are included as
 *    explicit 0 coefficients — the payloads omit them (omitted-zero
 *    convention, proven in Q9); the published tables print them.
 *  - Yahoo: help.yahoo.com/kb/SLN6489.html (full defaults; INT −1, platform
 *    default Half PPR, no missed-kick penalties, single PA model). Yahoo's
 *    finer sub-40 FG buckets (0–19/20–29/30–39, all 3 pts) are score-equal
 *    to `fg_0_39 = 3` and collapse losslessly.
 *  - Sleeper: support.sleeper.com article 3998131 verifies the CATEGORIES
 *    (shared PA family; FG buckets with no 60+ tier) but publishes NO
 *    default values; in-product defaults sit behind login (out of bounds).
 *    Sleeper VALUES ship as App B best-known, FLAGGED unverified (house
 *    rule; PROGRESS ledger F24 — September raw-feed/product verification).
 *
 * ── Named parity exceptions (Q9 ruling, 2026-07-22 — spec v2.8.5) ─────────
 * ESPN's verified defaults score three categories the current data tier
 * cannot observe (no provider signal exists, so keys would be permanently
 * pending — a standing E61 state worse than a documented exception):
 *  1. FG made 60+ = 6 (we score it as `fg_50_plus` = 5; Sleeper's feed
 *     aggregates everything ≥50 into one bucket) — −1 pt vs ESPN per make.
 *  2. D/ST safety on a PAT try = +1 (unscored).
 *  3. D/ST return score on a PAT try = +2 (unscored).
 * Order ~5–15 plays league-wide per NFL season, combined. These are NAMED
 * EXCEPTIONS, not pending categories, and MUST stay user-visible in the ESPN
 * templates' `description` (enforced by test). Lift path: if the September
 * F10 raw-endpoint inspection finds a Sleeper 60+ FG spelling (e.g.
 * `fgm_60p`) or PAT-play detail, expressing the tier becomes a one-PR §23.5
 * data task and the exception shrinks or closes.
 */

/** One v1 template: the row seeded by migration 058. */
export interface ScoringTemplateDef {
  /** Row `name` — §7.3.3's table, verbatim; the seed's natural key. */
  name: string
  /** Row `description` — commissioner-readable; ESPN rows MUST carry the
   *  plain-language parity-exception line (Q9 ruling condition). */
  description: string
  /** Row `rules` — coefficients over canonical registry keys ONLY. This is
   *  what `snapshot_league_scoring` freezes; no metadata ever lives here. */
  rules: Record<string, number>
  /** TRUE = the values match their AUTHORITATIVE SOURCE. For a platform
   *  parity row that source is the platform's published defaults (FALSE =
   *  App B best-known, not source-verified — Sleeper, ledger F24). For the
   *  house template (Scout Scoring) the values are DEFINITIONAL: the source
   *  is Chris's ruling folded into spec App B.5 (marked up 2026-08-31), so
   *  the row is verified BY the ruling itself — there is no external page it
   *  could drift from (D278(7), resolved here by SC.1: `true`, with this
   *  widened description; no new flag). Categories are verified for all
   *  seven. */
  valuesVerified: boolean
}

/** The plain-language ESPN parity-exception sentence (Q9 ruling: must be a
 *  line a commissioner can read, in the template's own description — not
 *  only in migration banners). Shared verbatim by both ESPN templates and
 *  pinned by test + pgTAP. */
export const ESPN_PARITY_EXCEPTION_NOTE =
  'Heads up on two tiny gaps our stat feed cannot see: ESPN awards 6 points ' +
  'for a 60+ yard field goal (scored here as a 50+ make, 5 points), and 1–2 ' +
  'points when a D/ST scores a safety or return on a PAT try (not scored ' +
  'here). Combined, that is roughly 5–15 plays across the entire NFL per ' +
  'season. Every other category matches ESPN to the cent.'

/* ── Shared building blocks (spelled out per template below via spreads so
 *    each template's full object is still reviewable in one place; the
 *    golden-pin test stores every template as a flat literal). ──────────── */

/** App B.1 core offense shared by the six parity templates (INT and
 *  receptions vary; Scout authors its own offense block — B.5). */
const CORE_OFFENSE = {
  pass_yards: 0.04,
  pass_tds: 4,
  pass_2pt: 2,
  rush_yards: 0.1,
  rush_tds: 6,
  rush_2pt: 2,
  receiving_yards: 0.1,
  receiving_tds: 6,
  rec_2pt: 2,
  fumbles_lost: -2,
  fumble_recovery_td: 6,
  return_td: 6,
} as const

/** D/ST event scoring — identical across all three platforms' tables. */
const DST_EVENTS = {
  def_sack: 1,
  def_int: 2,
  def_fumble_rec: 2,
  def_td: 6,
  def_safety: 2,
  def_block: 2,
  def_return_td: 6,
} as const

/** ESPN standard PA table on ESPN's own published buckets (v2.8.3 erratum;
 *  Q9-verified values). 18–27 is a published 0-point row — explicit 0. */
const ESPN_DEF_PA = {
  def_pa_0: 5,
  def_pa_1_6: 4,
  def_pa_7_13: 3,
  def_pa_14_17: 1,
  def_pa_18_27: 0,
  def_pa_28_34: -1,
  def_pa_35_45: -3,
  def_pa_46_plus: -5,
} as const

/** ESPN standard YA values — F19(a), pulled from the in-product default
 *  payloads (Q9), anchor-confirmed by the D/ST article (`def_ya_0_99` +5).
 *  300–349 is the published 0-point row — explicit 0. */
const ESPN_DEF_YA = {
  def_ya_0_99: 5,
  def_ya_100_199: 3,
  def_ya_200_299: 2,
  def_ya_300_349: 0,
  def_ya_350_399: -1,
  def_ya_400_449: -3,
  def_ya_450_499: -5,
  def_ya_500_549: -6,
  def_ya_550_plus: -7,
} as const

/** Shared single-model PA family (Yahoo verified; Sleeper best-known —
 *  App B.4's `def_pa_0` 10 … `def_pa_35_plus` −4). 21–27 = published 0. */
const SHARED_DEF_PA = {
  def_pa_0: 10,
  def_pa_1_6: 7,
  def_pa_7_13: 4,
  def_pa_14_20: 1,
  def_pa_21_27: 0,
  def_pa_28_34: -1,
  def_pa_35_plus: -4,
} as const

/** ESPN kicking (Q9-verified; the 60+ = 6 tier is the named exception —
 *  `fg_50_plus` carries the 50–59 value 5). ESPN has no PAT-miss penalty. */
const ESPN_KICKING = {
  fg_0_39: 3,
  fg_40_49: 4,
  fg_50_plus: 5,
  pat_made: 1,
  fg_missed: -1,
} as const

/** Yahoo kicking (verified): finer sub-40 buckets all score 3 (collapse to
 *  `fg_0_39`); NO miss penalties in Yahoo's defaults — keys omitted, not 0. */
const YAHOO_KICKING = {
  fg_0_39: 3,
  fg_40_49: 4,
  fg_50_plus: 5,
  pat_made: 1,
} as const

/** Sleeper kicking (categories verified, values best-known per App B.4 —
 *  incl. the ⚠ miss penalties; F24). */
const SLEEPER_KICKING = {
  fg_0_39: 3,
  fg_40_49: 4,
  fg_50_plus: 5,
  pat_made: 1,
  fg_missed: -1,
  pat_missed: -1,
} as const

const ESPN_STANDARD_RULES: Record<string, number> = {
  ...CORE_OFFENSE,
  interceptions: -2,
  receptions: 0,
  ...ESPN_KICKING,
  ...DST_EVENTS,
  ...ESPN_DEF_PA,
  ...ESPN_DEF_YA,
}

const YAHOO_STANDARD_RULES: Record<string, number> = {
  ...CORE_OFFENSE,
  interceptions: -1,
  receptions: 0,
  ...YAHOO_KICKING,
  ...DST_EVENTS,
  ...SHARED_DEF_PA,
}

const SLEEPER_STANDARD_RULES: Record<string, number> = {
  ...CORE_OFFENSE,
  interceptions: -1,
  receptions: 0,
  ...SLEEPER_KICKING,
  ...DST_EVENTS,
  ...SHARED_DEF_PA,
}

/** Scout Scoring — FieldScout's house template (spec App B.5, marked up by
 *  Chris 2026-08-31; SC.1). Offense and kicking are authored here per B.5's
 *  ruled values; D/ST events are the unanimity inherit and PA/YA are the
 *  RULED ESPN split model, spread from the same Q9-verified consts the two
 *  ESPN rows use — never retyped. `return_yards` 0.05 is RULED but GATED:
 *  no registry key exists (Q13/D173/F71), so the key is OMITTED until F71's
 *  data task lands (F71's checklist carries the Scout seed-update step). */
const SCOUT_SCORING_RULES: Record<string, number> = {
  // B.5 offense — the ruled departures: passing 0.05/yd (all six incumbents
  // 0.04), EVERY TD 6 including passing (the headline — ESPN/Yahoo/Sleeper
  // pay 4), receptions 0 as a STATED difference, −2 for all turnovers.
  pass_yards: 0.05,
  pass_tds: 6,
  interceptions: -2,
  pass_2pt: 2,
  rush_yards: 0.1,
  rush_tds: 6,
  rush_2pt: 2,
  receptions: 0,
  receiving_yards: 0.1,
  receiving_tds: 6,
  rec_2pt: 2,
  fumbles_lost: -2,
  fumble_recovery_td: 6,
  return_td: 6,
  // B.5 kicking — every FG flat 3 (RULED; all six incumbents tier 3/4/5);
  // fg_missed −1 RULED 2026-08-31 (the incumbent majority — FG-specific:
  // pat_missed deliberately stays omitted under the blanket approval).
  fg_0_39: 3,
  fg_40_49: 3,
  fg_50_plus: 3,
  pat_made: 1,
  fg_missed: -1,
  // D/ST — events by unanimity inherit; PA + YA are the RULED ESPN split
  // model on the shipped Q9-verified values (dst_model 'split').
  ...DST_EVENTS,
  ...ESPN_DEF_PA,
  ...ESPN_DEF_YA,
}

/**
 * The 7 shipped templates, in §7.3.3 table order (also the picker order) —
 * Scout Scoring first per the amended v2.16.9 table, then the 6 parity
 * templates. PPR variants differ from their Standard sibling in EXACTLY the
 * `receptions` coefficient (pinned by test).
 */
export const SCORING_TEMPLATES: readonly ScoringTemplateDef[] = [
  {
    name: 'Scout Scoring',
    description:
      "FieldScout's own default scoring — one clean rule set instead of a " +
      'pile of inherited quirks. Six points for every touchdown, whoever ' +
      "scores it. Three points for every field goal, wherever it's kicked " +
      'from. No PPR. 10 rushing or receiving yards to the point, 20 passing ' +
      "yards. −2 for all turnovers. D/ST scored on ESPN's published " +
      'points-allowed and yards-allowed tables. Defined by FieldScout ' +
      "(August 2026), not copied from another platform's defaults.",
    rules: SCOUT_SCORING_RULES,
    valuesVerified: true,
  },
  {
    name: 'ESPN Standard',
    description:
      "ESPN's 2026 default scoring, 0 PPR — verified against ESPN's " +
      'published defaults (July 2026). Interceptions −2. ' +
      ESPN_PARITY_EXCEPTION_NOTE,
    rules: ESPN_STANDARD_RULES,
    valuesVerified: true,
  },
  {
    name: 'ESPN Full PPR',
    description:
      "ESPN's 2026 default scoring with 1 point per reception — verified " +
      "against ESPN's published defaults (July 2026). Interceptions −2. " +
      ESPN_PARITY_EXCEPTION_NOTE,
    rules: { ...ESPN_STANDARD_RULES, receptions: 1 },
    valuesVerified: true,
  },
  {
    name: 'Yahoo Standard',
    description:
      "Yahoo's 2026 default scoring, 0 PPR — verified against Yahoo's " +
      'published defaults (July 2026). Interceptions −1; no missed-kick ' +
      'penalties.',
    rules: YAHOO_STANDARD_RULES,
    valuesVerified: true,
  },
  {
    name: 'Yahoo Half PPR',
    description:
      "Yahoo's 2026 default scoring with 0.5 points per reception — " +
      "Yahoo's own platform default, verified against Yahoo's published " +
      'defaults (July 2026). Interceptions −1; no missed-kick penalties.',
    rules: { ...YAHOO_STANDARD_RULES, receptions: 0.5 },
    valuesVerified: true,
  },
  {
    name: 'Sleeper Standard',
    description:
      "Sleeper's default scoring categories, 0 PPR. Sleeper does not " +
      'publish its default point values; these are the industry-standard ' +
      'values Sleeper is known to use.',
    rules: SLEEPER_STANDARD_RULES,
    valuesVerified: false,
  },
  {
    name: 'Sleeper Full PPR',
    description:
      "Sleeper's default scoring with 1 point per reception — Sleeper's " +
      'own platform default. Sleeper does not publish its default point ' +
      'values; these are the industry-standard values Sleeper is known to ' +
      'use.',
    rules: { ...SLEEPER_STANDARD_RULES, receptions: 1 },
    valuesVerified: false,
  },
]
