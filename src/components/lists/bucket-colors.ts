import { TIER_VALUES, isTierKey, roundNumberOf } from '@/types/schemas/lists'

/**
 * Lists — how a bucket key becomes a colour (LV.1.5).
 *
 * ## Why these are functions and not `Record<ListTier, string>` maps
 *
 * They were exactly that until this task: `TIER_BG` and `TIER_BAND_BG` in
 * `tier-badge.tsx`, **total maps with no fallback**. `TIER_BAND_BG['r1']` was
 * `undefined` → `cn(undefined)` → a silently uncoloured band. That was harmless
 * only while `list_players.tier` could hold nothing but S–F, which stopped being
 * true when migration `081_list_players_tier_vocabulary.sql` widened
 * `list_players_tier_check` to accept `r1`–`r30` and `c1`–`c4` (plan **D4**,
 * PROGRESS-lists-v2.md §3 **Q2**). Both call sites — the flag-OFF legacy detail
 * view and the **server-rendered public share view** (`/u/[username]/lists/
 * [slug]`, SEO-critical per **D7**) — would have started rendering colourless
 * headers with nothing failing.
 *
 * A `Record` keyed on a union carries a second, quieter hazard: it forces every
 * caller to hold a `ListTier`, so the only way to reach it with a database value
 * is an `as ListTier` cast — and `list-detail-view.tsx` alone had a dozen. A
 * function total over `string` cannot be smuggled past.
 *
 * **The fallback is neutral, not a colour.** An unrecognised key gets the same
 * grey `lists/v2/list-buckets.ts` gives its Ungrouped section: a bucket nobody
 * can name should not be dressed up as tier 1.
 *
 * ## Why this is a `.ts` file and not part of `tier-badge.tsx`
 *
 * `tsconfig.json` sets `jsx: "preserve"` for Next, so vitest's esbuild leaves
 * JSX in place and **any `.tsx` module is unimportable from a test** (and from
 * a `.ts` module a test imports). Keeping the rules here is what lets
 * `bucket-colors.test.ts` assert them at all, and what lets `list-buckets.ts`
 * share one ramp with the badge without dragging a component into its graph.
 *
 * ## The ramp
 *
 * The design's tier ramp is warm — red → orange → gold → green → teal — and
 * `tailwind.config.ts` ships `tier-1..7` matching it (PROGRESS §7 gap 4). Six to
 * seven hues against up to 30 rounds, so **round mode cycles colours** rather
 * than assigning a unique one per bucket (plan D4).
 */

/**
 * Numeric tier ramp (bands 1-6): fill + contrast text in one recipe. Shared by
 * the list tier headers and the Big Board tier bands — tweak the ramp here and
 * every surface follows.
 *
 * Deliberately still **six** entries: `big-board/big-board-dashboard.tsx`
 * indexes it positionally and that tree is off limits to this build, so it is
 * re-exported unchanged from `tier-badge.tsx` where that file imports it. The
 * seventh step lives on {@link BAND_RAMP}.
 */
export const TIER_RAMP: readonly string[] = [
  'bg-tier-1 text-white',
  'bg-tier-2 text-white',
  'bg-tier-3 text-ink',
  'bg-tier-4 text-ink',
  'bg-tier-5 text-white',
  'bg-tier-6 text-white',
]

/**
 * The full seven-step ramp buckets cycle through.
 *
 * One definition, two consumers: this module's per-key colouring (legacy detail
 * + public share) and `lists/v2/list-buckets.ts`'s positional `bandStyle`. Those
 * two colour by different rules on purpose — a letter always gets its own step,
 * while a v2 section takes the step matching its render order — but they must
 * not disagree about what the steps *are*.
 */
export const BAND_RAMP: readonly string[] = [...TIER_RAMP, 'bg-tier-7 text-white']

/** Fill for a bucket key the ramp has no opinion about. */
export const UNKNOWN_BUCKET_STYLE = 'bg-n-4 text-ink'

/**
 * Which ramp step a bucket key takes, or `null` when the key is not one this
 * build's vocabulary defines.
 *
 * S–F keep their historical step (S → tier-1 … F → tier-6), so nothing that
 * renders today moves a pixel. Rounds and cost bands cycle: `r8` wraps back to
 * step 1, which is the stated consequence of a 7-hue ramp against 30 rounds.
 */
function rampIndex(key: string): number | null {
  if (isTierKey(key)) return TIER_VALUES.indexOf(key)
  const round = roundNumberOf(key)
  if (round !== null) return (round - 1) % BAND_RAMP.length
  const band = /^c([1-4])$/.exec(key)
  if (band) return (Number(band[1]) - 1) % BAND_RAMP.length
  return null
}

/** Band recipe for a section header — total over `string`, never `undefined`. */
export function bucketBandClass(key: string): string {
  const index = rampIndex(key)
  return index === null ? UNKNOWN_BUCKET_STYLE : BAND_RAMP[index]
}

/** Chip recipe for the badge — total over `string`, never `undefined`. */
export function bucketBadgeClass(key: string): string {
  const index = rampIndex(key)
  return index === null ? UNKNOWN_BUCKET_STYLE : BAND_RAMP[index]
}
