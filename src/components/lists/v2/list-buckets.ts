import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import type { ListTier } from '@/types/database'
import {
  DEFAULT_COST_BANDS,
  resolveBandLabel,
  type ListOrg,
} from '@/stores/list-display-store'

import { playerCost } from './list-stats'

/**
 * Lists v2 — grouping. One list, five label sets (design LAW "Toolbar";
 * plan §3 **D4**).
 *
 * ## Where a bucket comes from — and it is not the same answer for all five
 *
 * The prototype keeps two different things on an entry: a **stored** bucket
 * (`tier`, `round`) that you drag a player into, and a **price** (`cost`) that
 * the cost and budget groupings *compute* their bands from. `screens/README.md`
 * records this correction against plan D4 in as many words: D4's *"nothing is
 * computed"* holds for bucket membership and is **wrong about stats** — the
 * `Cost PPR` column is a stat, and Budget % is computed from it.
 *
 * So:
 *
 * | Grouping | Bucket comes from | Writable today |
 * | --- | --- | --- |
 * | Ranked | array order (`position`) | n/a |
 * | Tiers | `list_players.tier` ∈ S–F | yes |
 * | Rounds | `list_players.tier` matching `r1`…`rN` | **no — LV.1.5** |
 * | Avg cost | computed from `players.auction_value` | n/a (computed) |
 * | Budget % | computed from `auction_value ÷ budget` | n/a (computed) |
 *
 * **Rounds renders correctly and will be empty until LV.1.5 lands**, and that
 * is deliberate rather than a stub. `list_players.tier` still carries the live
 * `list_players_tier_check` CHECK pinning it to S–F (PROGRESS §3 Q2), so no row
 * in any database can hold `r1` yet: every player falls into the ungrouped
 * bucket. The alternative — chunking the ranked order into rounds of twelve —
 * would have matched no screenshot (the reference's rounds hold 4/3/4/3/3
 * players, i.e. stored membership), invented a picks-per-round number no screen
 * shows, and quietly changed meaning the day LV.1.5 shipped real round buckets.
 *
 * ## Colour
 *
 * Band fills cycle the `tier-1..7` ramp, which the screenshots confirm runs
 * red → orange → gold → green → teal, **not** the "indigo ramp" the handoff
 * prose claims (PROGRESS §7 gap 4). Tiers 3–4 take ink text; the rest take
 * white — verified against `detail-grouping-rounds.png`, whose gold band 4
 * carries black text.
 */

export interface Bucket {
  key: string
  /** `null` renders as a bare list with no header (plain rank). */
  label: string | null
  /** Right-aligned figure in the header — the band's running spend. */
  meta: string | null
  /** Tailwind fill + ink/white text for the header band. */
  className: string
  /** Cost bands are the only renameable buckets (design LAW Interactions). */
  editableKey: string | null
  entries: ListPlayerWithPlayer[]
}

/** Band fills, cycled. Tiers 3–4 take ink text per `tailwind.config.ts`. */
const BAND_STYLES = [
  'bg-tier-1 text-white',
  'bg-tier-2 text-white',
  'bg-tier-3 text-ink',
  'bg-tier-4 text-ink',
  'bg-tier-5 text-white',
  'bg-tier-6 text-white',
  'bg-tier-7 text-white',
] as const

/** Neutral fill for the "these have no bucket yet" section. */
const UNGROUPED_STYLE = 'bg-n-4 text-ink'

export function bandStyle(index: number): string {
  return BAND_STYLES[index % BAND_STYLES.length]
}

/**
 * Stored tier vocabulary, best first — matches `TIER_VALUES`.
 *
 * Typed as `ListTier` on purpose: it is what the tier route and the live
 * `list_players_tier_check` accept **today**, so a drop that would write a round
 * key cannot typecheck its way into the mutation. When LV.1.5 widens both, this
 * is one of the places that has to change, and the compiler will say so.
 */
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D', 'F'] as const satisfies readonly ListTier[]

const ROUND_KEY = /^r(\d{1,2})$/

/**
 * Cost-band lower bounds, in display order, paired with
 * `DEFAULT_COST_BANDS`' keys.
 *
 * LV.1.4 dropped the prototype's `min` from the store on the reading that a
 * band is a bucket you drag into. That reading needs LV.1.5 (stored band keys)
 * and LV.4 (the drag) to be true, and neither has landed — so until they do the
 * threshold is the only thing that can put a player in a band at all, and it is
 * also what the reference screenshot shows: the labels *state* the thresholds
 * (`$40 and up`, `$25 – $39`). Renaming a band does not move its boundary, in
 * the prototype or here.
 */
const COST_BAND_MINIMUMS: readonly number[] = [40, 25, 10, 0]

/** Budget-share bands. Fixed labels — only cost bands are renameable. */
const BUDGET_BANDS = [
  { key: 'b1', label: 'Over 20% of budget', min: 0.2 },
  { key: 'b2', label: '10–20%', min: 0.1 },
  { key: 'b3', label: '5–10%', min: 0.05 },
  { key: 'b4', label: 'Under 5%', min: 0 },
] as const

function money(total: number): string {
  return `$${Math.round(total)}`
}

function spend(entries: ListPlayerWithPlayer[]): number {
  return entries.reduce((sum, entry) => sum + (playerCost(entry) ?? 0), 0)
}

/** Most expensive first — the order both cost screenshots render in. */
function byCostDesc(a: ListPlayerWithPlayer, b: ListPlayerWithPlayer): number {
  return (playerCost(b) ?? -1) - (playerCost(a) ?? -1)
}

interface BuildArgs {
  org: ListOrg
  entries: ListPlayerWithPlayer[]
  bandLabels: Readonly<Record<string, string>>
  budget: number
}

export function buildBuckets({ org, entries, bandLabels, budget }: BuildArgs): Bucket[] {
  if (org === 'rank') {
    return [{ key: 'all', label: null, meta: null, className: '', editableKey: null, entries }]
  }

  if (org === 'cost') return costBuckets(entries, bandLabels)
  if (org === 'budget') return budgetBuckets(entries, budget)

  return storedBuckets(org, entries)
}

/**
 * Tiers and rounds: membership is whatever `list_players.tier` says.
 *
 * Only buckets with members are rendered. The prototype renders empty ones too,
 * because they are drop targets — an affordance that arrives with LV.4's
 * drag-and-drop and would be inert furniture before it.
 */
function storedBuckets(org: ListOrg, entries: ListPlayerWithPlayer[]): Bucket[] {
  const keyed = new Map<string, ListPlayerWithPlayer[]>()
  const ungrouped: ListPlayerWithPlayer[] = []

  for (const entry of entries) {
    const key = bucketKeyFor(org, entry.tier)
    if (key == null) {
      ungrouped.push(entry)
      continue
    }
    const existing = keyed.get(key)
    if (existing) existing.push(entry)
    else keyed.set(key, [entry])
  }

  const order = org === 'round' ? roundOrder(keyed.keys()) : [...TIER_ORDER]
  const buckets: Bucket[] = []

  order.forEach((key) => {
    const members = keyed.get(key)
    if (!members?.length) return
    buckets.push({
      key,
      // "This control doubles as the heading for the content below, so sections
      // must not repeat the word Tier/Round" (design LAW, Toolbar) — the header
      // carries the value alone.
      label: org === 'round' ? key.slice(1) : key,
      meta: null,
      className: bandStyle(buckets.length),
      editableKey: null,
      entries: members,
    })
  })

  if (ungrouped.length) {
    // Nothing is bucketed at all: render one bare section rather than a header
    // labelling the whole list as leftovers.
    if (!buckets.length) {
      return [
        { key: 'all', label: null, meta: null, className: '', editableKey: null, entries: ungrouped },
      ]
    }
    buckets.push({
      key: 'ungrouped',
      label: 'Ungrouped',
      meta: null,
      className: UNGROUPED_STYLE,
      editableKey: null,
      entries: ungrouped,
    })
  }

  return buckets
}

function bucketKeyFor(org: ListOrg, tier: string | null): string | null {
  if (!tier) return null
  if (org === 'round') return ROUND_KEY.test(tier) ? tier : null
  return (TIER_ORDER as readonly string[]).includes(tier) ? tier : null
}

function roundOrder(keys: Iterable<string>): string[] {
  return [...keys].sort(
    (a, b) => Number(ROUND_KEY.exec(a)?.[1] ?? 0) - Number(ROUND_KEY.exec(b)?.[1] ?? 0),
  )
}

/**
 * Avg cost: four price bands over `auction_value`, most expensive first.
 * Empty bands stay — the reference shows `$10 – $24` and `Under $10` rendering
 * with a `$0` total and nothing under them.
 */
function costBuckets(
  entries: ListPlayerWithPlayer[],
  bandLabels: Readonly<Record<string, string>>,
): Bucket[] {
  const unpriced: ListPlayerWithPlayer[] = []
  const priced = entries.filter((entry) => {
    if (playerCost(entry) == null) {
      unpriced.push(entry)
      return false
    }
    return true
  })

  const buckets: Bucket[] = DEFAULT_COST_BANDS.map((band, index) => {
    const min = COST_BAND_MINIMUMS[index]
    const max = index === 0 ? Number.POSITIVE_INFINITY : COST_BAND_MINIMUMS[index - 1]
    const members = priced
      .filter((entry) => {
        const cost = playerCost(entry) as number
        return cost >= min && cost < max
      })
      .sort(byCostDesc)

    return {
      key: band.key,
      label: resolveBandLabel(band.key, bandLabels),
      meta: money(spend(members)),
      className: bandStyle(index),
      editableKey: band.key,
      entries: members,
    }
  })

  if (unpriced.length) {
    buckets.push({
      key: 'unpriced',
      label: 'No auction value',
      meta: money(0),
      className: UNGROUPED_STYLE,
      editableKey: null,
      entries: unpriced,
    })
  }

  return buckets
}

/**
 * Budget %: the same prices read as a share of the session budget. Empty bands
 * are dropped here (they are in the prototype too) — the reference shows only
 * the two bands that hold players.
 */
function budgetBuckets(entries: ListPlayerWithPlayer[], budget: number): Bucket[] {
  const safeBudget = budget > 0 ? budget : 1

  return BUDGET_BANDS.map((band, index) => {
    const max = index === 0 ? Number.POSITIVE_INFINITY : BUDGET_BANDS[index - 1].min
    const members = entries
      .filter((entry) => {
        const cost = playerCost(entry)
        if (cost == null) return false
        const share = cost / safeBudget
        return share >= band.min && share < max
      })
      .sort(byCostDesc)

    return {
      key: band.key,
      label: band.label,
      meta: money(spend(members)),
      className: bandStyle(index),
      editableKey: null,
      entries: members,
    }
  }).filter((bucket) => bucket.entries.length > 0)
}

/** A player's share of the budget as a whole percent, or `null` if unpriced. */
export function budgetShare(
  entry: ListPlayerWithPlayer,
  budget: number,
): number | null {
  const cost = playerCost(entry)
  if (cost == null) return null
  return Math.round((cost / (budget > 0 ? budget : 1)) * 100)
}

// =============================================================================
// Drag and drop (LV.4) — which groupings can be rearranged, and what a drop on
// a section header is allowed to write
// =============================================================================

/**
 * Can this grouping be reordered by hand?
 *
 * Only where a section's member order **is** the array order. The cost and
 * budget bands are computed and re-sorted by price on every render
 * (`byCostDesc` above), so a manual order there would be discarded the instant
 * React re-rendered — the drag would look like it worked and then snap back.
 * The affordance is therefore withheld in those two modes and says why on
 * hover, rather than being offered and silently undone (CLAUDE.md: never let
 * "nothing happened" mean "it worked").
 */
export function canReorder(org: ListOrg): boolean {
  return org === 'rank' || org === 'tier' || org === 'round'
}

export const COMPUTED_ORDER_REASON =
  'These sections are ordered by each player’s auction value, so they can’t be rearranged by hand. Switch to Ranked or Tiers to reorder.'

/**
 * Rounds are real buckets in the design and unwritable in the database *today*:
 * `list_players_tier_check` still pins the column to NULL or S–F until LV.1.5
 * widens it (PROGRESS §3 Q2), so a `r3` write returns a Postgres `23514` that
 * the tier route surfaces as a 500. The refusal is stated here, in the one place
 * that knows what a bucket means, and it disappears the day LV.1.5 lands.
 */
export const ROUND_BUCKET_REASON =
  'Round buckets can’t be assigned yet — this list still stores tiers S–F. Group by Tiers to move players between sections.'

export type BucketDrop =
  /** `tier: undefined` means "this grouping does not own the stored value". */
  | { ok: true; tier: ListTier | null | undefined }
  | { ok: false; reason: string }

/** What dropping a player into `bucketKey` writes, or why it cannot. */
export function bucketDrop(org: ListOrg, bucketKey: string): BucketDrop {
  if (org === 'cost' || org === 'budget') return { ok: false, reason: COMPUTED_ORDER_REASON }
  // The single unlabelled section (`rank`, or a tier list with nothing bucketed
  // yet) carries no stored value at all — a drop there is a pure reorder.
  if (bucketKey === 'all') return { ok: true, tier: undefined }
  if (bucketKey === 'ungrouped') return { ok: true, tier: null }
  if (org === 'round') return { ok: false, reason: ROUND_BUCKET_REASON }
  const tier = TIER_ORDER.find((value) => value === bucketKey)
  if (org === 'tier' && tier) return { ok: true, tier }
  return { ok: true, tier: undefined }
}

/**
 * The value the dashed "Drop a player here to start tier N" zone would assign —
 * the first tier letter this list is not already using, or `null` when all six
 * are taken.
 *
 * Tier mode only. Round mode has the same zone in the prototype and cannot write
 * one yet (see `ROUND_BUCKET_REASON`), so the zone is withheld there rather than
 * rendered as a target that 500s.
 */
export function nextTierBucket(org: ListOrg, buckets: Bucket[]): ListTier | null {
  if (org !== 'tier') return null
  const used = new Set(buckets.map((bucket) => bucket.key))
  return TIER_ORDER.find((tier) => !used.has(tier)) ?? null
}

export const ORG_OPTIONS: ReadonlyArray<{ id: ListOrg; label: string }> = [
  { id: 'rank', label: 'Ranked' },
  { id: 'tier', label: 'Tiers' },
  { id: 'round', label: 'Rounds' },
  { id: 'cost', label: 'Avg cost' },
  { id: 'budget', label: 'Budget %' },
]
