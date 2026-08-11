/**
 * Scout trait model — composite grades built from the metric registry.
 *
 * WHY THIS LOOKS DIFFERENT FROM THE ORIGINAL BRIEF
 * -------------------------------------------------
 * The originating concept graded scouting traits: Route Running, Hands,
 * Separation, Contested, YAC, Explosiveness. Mapped against real data:
 *
 *   Route Running  → needs routes run.        NOT AVAILABLE at any price we pay today.
 *   Hands          → drop rate (r 0.14), contested catch rate (r 0.02), catch rate (R² 0.098)
 *   Separation     → NGS separation. Available at Tier 2. Near-zero fantasy signal.
 *   YAC            → YAC over expected. Tier 2, repeats at about r² 0.17.
 *   Contested      → contested catch rate. Paid, and r 0.02 — the weakest number we found.
 *   Explosiveness  → breakaway rate + combine. Partly available, weak.
 *
 * So every one of those traits is either unbuildable or assembled from the
 * WORST-predicting metrics in the registry. A "Hands: 97" built on r 0.14 and
 * r 0.02 inputs would contradict every other page in Scout.
 *
 * THE MODEL WE CAN DEFEND
 * -----------------------
 * Grade the axes that actually move fantasy points, and let the evidence set
 * the weights. Three rules make this honest rather than another black box:
 *
 *   1. DEFAULT WEIGHTS ARE DERIVED, NOT CHOSEN. A metric's weight inside its
 *      trait comes from its published year-over-year stability. The model's
 *      opinion is "trust what repeats" — which is testable, and is the same
 *      argument the whole guide makes.
 *   2. EVERY GRADE SHOWS ITS INPUTS. Clicking a trait lists the metrics, their
 *      weights and their percentiles. No unfalsifiable number.
 *   3. FLAGS ARE NOT GRADES. Finishing luck and availability are reported, but
 *      never scored into the composite — a player in the 95th percentile of
 *      touchdown luck is not better, he is more expensive. Grading him higher
 *      for it would invert the advice.
 *
 * NAMING
 * -------
 * "Opportunity" is deliberate: it is the word the registry already uses for
 * these metrics (type: 'opportunity') and the word the guide's thesis uses
 * ("Opportunity is a skill"). One concept, one name, everywhere.
 *
 * The second trait is "Target quality" for pass catchers and "Scoring chances"
 * for backs — the same idea (is the volume the valuable kind?) measured by
 * different things at each position, so it earns different names.
 *
 * WHY WEIGHTS NEST INSTEAD OF GOING FLAT
 * --------------------------------------
 * Per-metric sliders over a flat list look like more control and deliver less.
 * Target share, targets per game and snap share are near-proxies for one
 * another. Three sliders at 100% is not "I value volume" — it is "volume
 * counts three times", and the user cannot see it happening. Zeroing two
 * efficiency metrics silently pushes opportunity from 33% to 43% of the grade
 * without the user touching it.
 *
 * So: TRAIT weights set share-of-grade. METRIC weights are tunable INSIDE a
 * trait and renormalise, so tuning within a trait can never change that
 * trait's total influence. Same power, no invisible double-counting.
 *
 * Spec: docs/specs/spec-scout.md §10 lists composite grades as a v1 non-goal.
 * This file is the proposal to lift that, with the scope narrowed to what the
 * data supports.
 */

import type { Position } from './types'

export interface TraitMetric {
  /** Registry slug. Must resolve, and must be status: 'live'. */
  slug: string
  /**
   * Relative weight inside the trait. DERIVED from the metric's stability
   * (year-over-year R², or r² where only r is published), then normalised
   * across the trait. Hand-tuning these needs a written reason.
   */
  weight: number
}

export interface Trait {
  id: string
  /** Sentence case. Fantasy language, not scouting language. */
  name: string
  /** ≤90 chars. What this trait answers, as a question. */
  question: string
  /**
   * 'grade'  — scored into the composite. Higher is genuinely better.
   * 'flag'   — reported, never scored. Higher may be WORSE (see luck).
   */
  kind: 'grade' | 'flag'
  /**
   * Confidence in the trait as a projection, from its inputs' stability.
   * A 'low' trait is shown with a caveat and weighted down by default.
   */
  confidence: 'high' | 'medium' | 'low'
  /** ≤120 chars. Shown when confidence is low, or when kind is 'flag'. */
  caveat: string | null
  metrics: TraitMetric[]
  /** Default share of the composite. Grades only; must sum to 1 per position. */
  defaultWeight: number
}

export interface PositionTraitModel {
  position: Position
  traits: Trait[]
}

// ---------------------------------------------------------------------------
// Pass catchers
// ---------------------------------------------------------------------------
const RECEIVER_TRAITS: Trait[] = [
  {
    id: 'opportunity',
    name: 'Opportunity',
    question: 'How much of this offense is his?',
    kind: 'grade',
    confidence: 'high',
    caveat: null,
    metrics: [
      { slug: 'target-share', weight: 0.4 },
      { slug: 'targets-per-game', weight: 0.4 },
      { slug: 'snap-share', weight: 0.2 },
    ],
    defaultWeight: 0.5,
  },
  {
    id: 'target-quality',
    name: 'Target quality',
    question: 'Is it the valuable kind of volume?',
    kind: 'grade',
    confidence: 'high',
    caveat: null,
    metrics: [
      { slug: 'air-yards-share', weight: 0.45 },
      { slug: 'red-zone-target-share', weight: 0.35 },
      { slug: 'adot', weight: 0.2 },
    ],
    defaultWeight: 0.35,
  },
  {
    id: 'efficiency',
    name: 'Efficiency',
    question: 'What does he do with the chances?',
    kind: 'grade',
    confidence: 'low',
    caveat:
      'Efficiency barely repeats year to year. Weighted low on purpose — raise it only if you know why.',
    metrics: [
      { slug: 'racr', weight: 0.4 },
      { slug: 'yards-per-target', weight: 0.3 },
      { slug: 'receiving-epa', weight: 0.3 },
    ],
    defaultWeight: 0.15,
  },
  {
    id: 'finishing-luck',
    name: 'Finishing luck',
    question: 'Did the scoring match the chances?',
    kind: 'flag',
    confidence: 'medium',
    caveat:
      'Not a grade. High means he scored above his chances — that makes him expensive, not good. Low is a buy signal.',
    metrics: [
      { slug: 'expected-touchdowns', weight: 0.5 },
      { slug: 'points-over-expected', weight: 0.5 },
    ],
    defaultWeight: 0,
  },
  {
    id: 'availability',
    name: 'Availability',
    question: 'Did he stay on the field?',
    kind: 'flag',
    confidence: 'low',
    caveat:
      'Reported only. Games played barely repeats (R² 0.022) — last year’s health does not forecast next year’s.',
    metrics: [{ slug: 'games-played', weight: 1 }],
    defaultWeight: 0,
  },
]

// ---------------------------------------------------------------------------
// Running backs
// ---------------------------------------------------------------------------
const RB_TRAITS: Trait[] = [
  {
    id: 'opportunity',
    name: 'Opportunity',
    question: 'How often does he touch the ball?',
    kind: 'grade',
    confidence: 'high',
    caveat: null,
    metrics: [
      { slug: 'touches-per-game', weight: 0.5 },
      { slug: 'carries-per-game', weight: 0.3 },
      { slug: 'snap-share', weight: 0.2 },
    ],
    defaultWeight: 0.55,
  },
  {
    id: 'scoring-chances',
    name: 'Scoring chances',
    question: 'Does he get the ball where it scores?',
    kind: 'grade',
    confidence: 'medium',
    caveat: null,
    metrics: [
      { slug: 'goal-line-carry-share', weight: 0.55 },
      { slug: 'target-share', weight: 0.45 },
    ],
    defaultWeight: 0.35,
  },
  {
    id: 'efficiency',
    name: 'Efficiency',
    question: 'What does he do with a carry?',
    kind: 'grade',
    confidence: 'low',
    caveat:
      'Running back efficiency is close to random year to year. This is the least trustworthy trait in the model.',
    metrics: [{ slug: 'yards-per-carry', weight: 1 }],
    defaultWeight: 0.1,
  },
  {
    id: 'finishing-luck',
    name: 'Finishing luck',
    question: 'Did the scoring match the chances?',
    kind: 'flag',
    confidence: 'medium',
    caveat:
      'Not a grade. High means he outscored his chances — expensive, not good. Low is where the value is.',
    metrics: [{ slug: 'points-over-expected', weight: 1 }],
    defaultWeight: 0,
  },
  {
    id: 'availability',
    name: 'Availability',
    question: 'Did he stay on the field?',
    kind: 'flag',
    confidence: 'low',
    caveat: 'Reported only. Availability does not forecast forward.',
    metrics: [{ slug: 'games-played', weight: 1 }],
    defaultWeight: 0,
  },
]

// ---------------------------------------------------------------------------
// Quarterbacks
// ---------------------------------------------------------------------------
const QB_TRAITS: Trait[] = [
  {
    id: 'rushing',
    name: 'Rushing',
    question: 'Does he run?',
    kind: 'grade',
    confidence: 'high',
    caveat: null,
    metrics: [
      { slug: 'qb-rushing-yards', weight: 0.6 },
      { slug: 'carries-per-game', weight: 0.4 },
    ],
    defaultWeight: 0.45,
  },
  {
    id: 'opportunity',
    name: 'Passing volume',
    question: 'Does his offense throw?',
    kind: 'grade',
    confidence: 'high',
    caveat: null,
    metrics: [{ slug: 'passing-yards', weight: 1 }],
    defaultWeight: 0.35,
  },
  {
    id: 'accuracy',
    name: 'Accuracy',
    question: 'Is he actually good at throwing?',
    kind: 'grade',
    confidence: 'medium',
    caveat:
      'The most reliable passing number there is — but accuracy alone does not score fantasy points. Volume and legs do.',
    metrics: [{ slug: 'cpoe', weight: 1 }],
    defaultWeight: 0.2,
  },
  {
    id: 'availability',
    name: 'Availability',
    question: 'Did he stay on the field?',
    kind: 'flag',
    confidence: 'low',
    caveat: 'Reported only.',
    metrics: [{ slug: 'games-played', weight: 1 }],
    defaultWeight: 0,
  },
]

export const TRAIT_MODELS: Record<string, PositionTraitModel> = {
  WR: { position: 'WR', traits: RECEIVER_TRAITS },
  TE: { position: 'TE', traits: RECEIVER_TRAITS },
  RB: { position: 'RB', traits: RB_TRAITS },
  QB: { position: 'QB', traits: QB_TRAITS },
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** A player's percentile (0–100) for each metric slug, within position+season. */
export type PercentileMap = Record<string, number | null>

export interface TraitScore {
  trait: Trait
  /** 0–100, or null when too few inputs qualified. */
  score: number | null
  /** Which metrics actually contributed — the receipts for the grade. */
  contributions: { slug: string; percentile: number; weight: number }[]
  /** Inputs missing because the player didn't qualify or the metric isn't live. */
  missing: string[]
}

/**
 * Score one trait. Weights renormalise over the metrics that actually have a
 * percentile, so a player missing one input isn't silently penalised.
 *
 * Returns null rather than a number when fewer than half the trait's weight is
 * present — a grade built on one of three inputs is not a grade (spec §9).
 */
export function scoreTrait(trait: Trait, pct: PercentileMap): TraitScore {
  const present = trait.metrics
    .map((m) => ({ ...m, percentile: pct[m.slug] }))
    .filter((m): m is TraitMetric & { percentile: number } => m.percentile != null)

  const presentWeight = present.reduce((s, m) => s + m.weight, 0)
  const totalWeight = trait.metrics.reduce((s, m) => s + m.weight, 0)
  const missing = trait.metrics.filter((m) => pct[m.slug] == null).map((m) => m.slug)

  if (presentWeight < totalWeight / 2) {
    return { trait, score: null, contributions: [], missing }
  }

  const score =
    present.reduce((s, m) => s + m.percentile * m.weight, 0) / presentWeight

  return {
    trait,
    score: Math.round(score),
    contributions: present.map((m) => ({
      slug: m.slug,
      percentile: m.percentile,
      weight: m.weight / presentWeight,
    })),
    missing,
  }
}

/**
 * The composite. GRADES ONLY — flags never contribute (§ rule 3 above).
 *
 * `weights` lets a user override the defaults (the build-your-own-model
 * sliders). Pass nothing for the evidence-derived defaults.
 */
export function scoutGrade(
  position: string,
  pct: PercentileMap,
  weights?: Record<string, number>,
): { grade: number | null; traits: TraitScore[] } {
  const model = TRAIT_MODELS[position]
  if (!model) return { grade: null, traits: [] }

  const traits = model.traits.map((t) => scoreTrait(t, pct))
  const graded = traits.filter((t) => t.trait.kind === 'grade' && t.score != null)
  if (graded.length === 0) return { grade: null, traits }

  const w = (t: TraitScore) => weights?.[t.trait.id] ?? t.trait.defaultWeight
  const totalW = graded.reduce((s, t) => s + w(t), 0)
  if (totalW <= 0) return { grade: null, traits }

  const grade = graded.reduce((s, t) => s + (t.score as number) * w(t), 0) / totalW
  return { grade: Math.round(grade), traits }
}

/**
 * Default weights sum to 1 across each position's graded traits. Enforced by
 * test — a model that sums to 0.9 silently deflates every grade at that
 * position and the bug is invisible until someone compares positions.
 */
export function validateModels(): string[] {
  const errors: string[] = []
  for (const [pos, model] of Object.entries(TRAIT_MODELS)) {
    const sum = model.traits
      .filter((t) => t.kind === 'grade')
      .reduce((s, t) => s + t.defaultWeight, 0)
    if (Math.abs(sum - 1) > 0.001) {
      errors.push(`${pos}: graded defaultWeight sums to ${sum.toFixed(3)}, expected 1`)
    }
    for (const t of model.traits) {
      if (t.kind === 'flag' && t.defaultWeight !== 0) {
        errors.push(`${pos}.${t.id}: flags must have defaultWeight 0`)
      }
      if (t.confidence === 'low' && !t.caveat) {
        errors.push(`${pos}.${t.id}: low-confidence traits require a caveat`)
      }
      const inner = t.metrics.reduce((s, m) => s + m.weight, 0)
      if (Math.abs(inner - 1) > 0.001) {
        errors.push(`${pos}.${t.id}: metric weights sum to ${inner.toFixed(3)}, expected 1`)
      }
    }
  }
  return errors
}
