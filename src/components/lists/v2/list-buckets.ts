import { BAND_RAMP } from '@/components/lists/bucket-colors'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import {
  DEFAULT_COST_BANDS,
  resolveBandLabel,
  type ListOrg,
} from '@/stores/list-display-store'
import {
  ROUND_MAX,
  TIER_VALUES,
  isTierKey,
  roundKeyFor,
  roundNumberOf,
  type ListBucketKey,
  type ListTierValue,
} from '@/types/schemas/lists'

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
 * | Rounds | `list_players.tier` matching `r1`…`r30` | yes, since **LV.1.5** |
 * | Avg cost | computed from `players.auction_value` | n/a (computed) |
 * | Budget % | computed from `auction_value ÷ budget` | n/a (computed) |
 *
 * **Rounds went live with LV.1.5.** It rendered correctly and empty from LV.3,
 * because the live `list_players_tier_check` pinned the column to S–F (PROGRESS
 * §3 Q2) and no row in any database could hold `r1`. Migration
 * `081_list_players_tier_vocabulary.sql` widened it to `r1`–`r30` and `c1`–`c4`,
 * so this module now groups and, through `bucketDrop`, assigns them. Nothing
 * about the *rendering* changed with that migration — which was the point of
 * shipping it data-empty rather than chunking the ranked order into rounds of
 * twelve (that would have matched no screenshot, invented a picks-per-round
 * number no screen shows, and quietly changed meaning on the day LV.1.5 landed).
 *
 * **Cost and Budget stay computed and stay unassignable**, and that is not an
 * oversight LV.1.5 left behind: their membership is derived from
 * `players.auction_value` and re-sorted by price on every render, so a stored
 * `c2` would be ignored on read and the drag would snap back. Making them
 * assignable means deciding whether a stored band overrides the computed one,
 * what happens to unassigned players, and whether a band label may still state
 * a threshold (`$40 and up`) it no longer enforces. That is a product question,
 * not a flag flip — see PROGRESS §4, LV.1.5.
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

/**
 * Band fills, cycled. Tiers 3–4 take ink text per `tailwind.config.ts`.
 *
 * The seven strings used to be spelled out here as well as in the tier badge.
 * One ramp, one definition (LV.1.5) — the two files still *colour* by different
 * rules (a section here takes the step matching its render order; a letter there
 * always takes its own step) but they no longer disagree about the steps.
 */
const BAND_STYLES = BAND_RAMP

/** Neutral fill for the "these have no bucket yet" section. */
const UNGROUPED_STYLE = 'bg-n-4 text-ink'

export function bandStyle(index: number): string {
  return BAND_STYLES[index % BAND_STYLES.length]
}

/**
 * Stored tier vocabulary, best first — `TIER_VALUES` itself, not a copy of it.
 *
 * It was a local literal `satisfies readonly ListTier[]` so that a drop writing
 * a round key could not typecheck its way into the mutation while the CHECK
 * still forbade one. LV.1.5 widened both layers together, so the guard's job is
 * over and the duplicate is now just a place to drift from.
 */
const TIER_ORDER: readonly ListTierValue[] = TIER_VALUES

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

/**
 * Which section a stored value belongs to in this grouping — or `null` for the
 * Ungrouped pile.
 *
 * The membership tests come from `@/types/schemas/lists`, the same module the
 * route's Zod schema and migration 081 are pinned to. Reading the column with a
 * *looser* rule than the one that wrote it is its own bug: the old local
 * `/^r(\d{1,2})$/` would have filed a hypothetical `r99` into a round section
 * the vocabulary does not contain.
 *
 * A round key in tier mode (or a tier letter in round mode) is Ungrouped, not
 * hidden — the same answer the legacy detail view and the public share view
 * give.
 */
function bucketKeyFor(org: ListOrg, tier: string | null): string | null {
  if (!tier) return null
  if (org === 'round') return roundNumberOf(tier) === null ? null : tier
  return isTierKey(tier) ? tier : null
}

function roundOrder(keys: Iterable<string>): string[] {
  // Numeric, not lexical — `r10` must not sort between `r1` and `r2`.
  return [...keys].sort((a, b) => (roundNumberOf(a) ?? 0) - (roundNumberOf(b) ?? 0))
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
 * **Rounds became assignable at LV.1.5** and this constant is the record of why
 * it could not be before: `list_players_tier_check` pinned the column to NULL
 * or S–F, so an `r3` write was a Postgres `23514` the tier route surfaced as a
 * 500. Migration `081_list_players_tier_vocabulary.sql` widened it. Kept as a
 * named export rather than deleted because `bucketDrop` still has to refuse
 * *something*, and the next reader should be able to see that the round refusal
 * was retired deliberately rather than lost.
 *
 * @deprecated Unreachable since LV.1.5 — round drops are writes now.
 */
export const ROUND_BUCKET_REASON =
  'Round buckets can’t be assigned yet — this list still stores tiers S–F. Group by Tiers to move players between sections.'

export type BucketDrop =
  /** `tier: undefined` means "this grouping does not own the stored value". */
  | { ok: true; tier: ListBucketKey | null | undefined }
  | { ok: false; reason: string }

/** What dropping a player into `bucketKey` writes, or why it cannot. */
export function bucketDrop(org: ListOrg, bucketKey: string): BucketDrop {
  if (org === 'cost' || org === 'budget') return { ok: false, reason: COMPUTED_ORDER_REASON }
  // The single unlabelled section (`rank`, or a tier list with nothing bucketed
  // yet) carries no stored value at all — a drop there is a pure reorder.
  if (bucketKey === 'all') return { ok: true, tier: undefined }
  if (bucketKey === 'ungrouped') return { ok: true, tier: null }
  if (org === 'tier' && isTierKey(bucketKey)) return { ok: true, tier: bucketKey }
  // Round mode writes the round key itself. Re-checked against the vocabulary
  // rather than trusted: `bucketKey` arrives from a DOM attribute.
  if (org === 'round' && roundNumberOf(bucketKey) !== null) {
    return { ok: true, tier: bucketKey as ListBucketKey }
  }
  return { ok: true, tier: undefined }
}

/**
 * The value the dashed "Drop a player here to start tier/round N" zone would
 * assign — the first bucket this list is not already using — or `null` when the
 * grouping has no assignable buckets left.
 *
 * Tier mode: the first unused letter of S–F. Round mode: the first unused round
 * of `r1`–`r30`, which LV.1.5 opened; before it, the zone was withheld here
 * rather than rendered as a target that 500s. `rank`, `cost` and `budget` own no
 * stored value, so they have no zone.
 *
 * Renamed from `nextTierBucket` at LV.1.5 — the old name became a lie the moment
 * it could return `r7`, and a stale name on a widened function is how the next
 * reader concludes rounds are still tier-only.
 */
export function nextBucket(org: ListOrg, buckets: Bucket[]): ListBucketKey | null {
  const used = new Set(buckets.map((bucket) => bucket.key))
  if (org === 'tier') return TIER_ORDER.find((tier) => !used.has(tier)) ?? null
  if (org !== 'round') return null
  for (let round = 1; round <= ROUND_MAX; round += 1) {
    const key = roundKeyFor(round)
    if (key && !used.has(key)) return key
  }
  return null
}

/** How the zone names the bucket it would create. */
export function bucketZoneLabel(org: ListOrg, key: ListBucketKey): string {
  const round = roundNumberOf(key)
  return round === null ? `start tier ${key}` : `start round ${round}`
}

/**
 * A bucket's heading **where nothing above it already names the grouping** —
 * Side by side's columns (LV.13).
 *
 * The detail view's section headers carry the value alone (`S`, `4`) because the
 * grouping dropdown sits directly above them and the design LAW is explicit that
 * sections "must not repeat the word Tier/Round". A comparison column has no
 * such dropdown — its grouping lives inside the header's `dots` menu — so
 * `screens/side-by-side-columns.png` shows the words in full: `Tier 1`,
 * `Tier 2`, `Round 4`.
 *
 * Only the two **stored** vocabularies take a prefix. `Ungrouped`, the cost
 * bands (`$40 and up`) and the budget bands (`Over 20% of budget`) are already
 * sentences, and plain rank's single section has no label at all — `null` means
 * "draw no band", exactly as `Bucket.label` does.
 */
export function bucketHeading(org: ListOrg, bucket: Bucket): string | null {
  if (bucket.label === null) return null
  if (org === 'tier' && isTierKey(bucket.key)) return `Tier ${bucket.label}`
  if (org === 'round' && roundNumberOf(bucket.key) !== null) return `Round ${bucket.label}`
  return bucket.label
}

/**
 * The running `#N` across every bucket, as the prototype numbers them —
 * `entry.id` → its ordinal in the whole list, not within its section.
 *
 * Lives here, beside the bucketing that decides the order, because **two**
 * surfaces render the same list's numbers now: the detail view's three view
 * styles (`useRanks` in `list-body.tsx` wraps this) and a Side by side column
 * (LV.13). Two copies of the rule is two chances for the same player to be #9
 * in the panel and #10 in the column he is being compared against.
 */
export function rankMap(buckets: Bucket[]): Map<string, number> {
  const ranks = new Map<string, number>()
  let n = 0
  for (const bucket of buckets) {
    for (const entry of bucket.entries) {
      n += 1
      ranks.set(entry.id, n)
    }
  }
  return ranks
}

export const ORG_OPTIONS: ReadonlyArray<{ id: ListOrg; label: string }> = [
  { id: 'rank', label: 'Ranked' },
  { id: 'tier', label: 'Tiers' },
  { id: 'round', label: 'Rounds' },
  { id: 'cost', label: 'Avg cost' },
  { id: 'budget', label: 'Budget %' },
]
