/**
 * Scout metric registry — types.
 * Spec: docs/specs/spec-scout.md §4. This file is LAW-adjacent: the copy
 * ceilings below are enforced by registry.test.ts and a build that exceeds
 * them fails.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'

export type MetricCategory =
  | 'opportunity'
  | 'efficiency'
  | 'volume'
  | 'expected'
  | 'situational'
  | 'athletic'
  | 'passing'
  | 'rushing'
  | 'receiving'

export type MetricType =
  | 'volume'
  | 'opportunity'
  | 'efficiency'
  | 'expected'
  | 'composite'
  | 'tracking'
  | 'athletic'
  | 'situational'

/**
 * Where the number comes from. Adding a paid vendor later adds a member here
 * and rows in player_metrics — never a migration (spec §5.1).
 */
export type DataSource =
  | 'nflverse-stats'      // stats_player — nflfastR computed
  | 'nflverse-pbp'        // derived from load_pbp
  | 'ff-opportunity'      // load_ff_opportunity — expected points
  | 'nflverse-ngs'        // Next Gen Stats (Tier 2)
  | 'nflverse-pfr'        // Pro Football Reference advanced (Tier 2)
  | 'nflverse-snaps'      // load_snap_counts (Tier 2)
  | 'ftn'                 // FTN charting (Tier 3 — share-alike, isolate)
  | 'paid'                // PFF / Fantasy Points Data (Tier 4)
  | 'sleeper'             // existing Sleeper pipeline

/**
 * 1 — CC-BY, nflfastR-computed. Ship freely.
 * 2 — NGS / PFR. nflverse redistributes, but the underlying rights aren't
 *     theirs to license. Needs a legal read (spec §2.2, open question #1).
 * 3 — FTN. CC-BY-SA share-alike. Physically isolated tables only.
 * 4 — Paid vendor. Contract required.
 */
export type LicenseTier = 1 | 2 | 3 | 4

/** Named traps, each mapping to one reusable explainer. Closed union. */
export type TrapId =
  | 'small-sample'
  | 'td-regression'
  | 'garbage-time'
  | 'empty-air-yards'
  | 'snap-share-proxy'
  | 'season-totals'
  | 'rb-efficiency'
  | 'role-change'

export interface StabilityEvidence {
  /** Never mix these on one axis. R² 0.40 ≈ r 0.63 (spec §3.1). */
  statistic: 'r' | 'r2'
  value: number
  /** e.g. '2017–2023, WR, 30+ targets' */
  sampleWindow: string
  sourceName: string
  sourceUrl: string
  /** True where the analytics community genuinely disagrees. */
  contested: boolean
}

export interface MetricDefinition {
  /** URL segment. Kebab-case, permanent — it's a public URL (spec §11.7). */
  slug: string
  /** player_metrics.metric_key. Snake_case, permanent. */
  key: string
  /** Sentence case, always. */
  name: string
  /** The ONLY place caps are allowed. */
  abbr: string
  category: MetricCategory
  /** Empty = applies to all positions. */
  positions: Position[]
  unit: 'percent' | 'yards' | 'count' | 'rate' | 'points' | 'index' | 'seconds'
  precision: number
  higherIsBetter: boolean

  /** Renders small, on the full page only. Never in the rail panel's lead. */
  formula: string

  // ---- Copy. Hard ceilings, enforced by test (spec §4.4 #7, §4.5). ----
  /** ≤110 chars. What it is, plainly. */
  plain: string
  /** ≤160 chars. What it means for YOUR team. A consequence, never a definition. */
  impact: string
  /** The "this, not that" pairing. `because` ≤180 chars. */
  insteadOf: { metric: string; because: string } | null
  /** 0–2 items, ≤140 chars each. */
  watchOut: string[]

  stability: 'sticky' | 'moderate' | 'noisy' | 'unknown'
  stabilityEvidence: StabilityEvidence | null
  predictiveness: 1 | 2 | 3 | 4 | 5
  type: MetricType

  source: DataSource
  licenseTier: LicenseTier
  /** 'planned' renders an explicit "not yet, and here's why" page and stays
   *  out of the sitemap (spec §8.3). */
  status: 'live' | 'planned'
  seasonsFrom: number | null

  /** Below `min`, suppress the value entirely — never show a small-sample number. */
  qualification: { field: string; min: number; label: string } | null
  /** Slugs. Must resolve, and must be symmetric (spec §4.4 #3). */
  related: string[]
  traps: TrapId[]
}

/** Plain-language chip labels. Never statistical vocabulary (spec §4.5). */
export const STABILITY_LABEL: Record<MetricDefinition['stability'], string> = {
  sticky: 'Repeats',
  moderate: 'Some signal',
  noisy: 'Coin flip',
  unknown: 'Unproven',
}
