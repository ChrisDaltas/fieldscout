import { z } from 'zod'

export const POSITION_FILTERS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX'] as const
export const TIER_VALUES = ['S', 'A', 'B', 'C', 'D', 'F'] as const
export const RANKING_MODES = ['unranked', 'ranked', 'rank_and_tier'] as const

// =============================================================================
// Bucket keys — the vocabulary of `list_players.tier` (LV.1.5)
// =============================================================================

/**
 * `list_players.tier` holds a **bucket key**, not just a tier letter.
 *
 * Plan **D4** makes tier / round / cost one mechanism with four label sets over
 * that one column. Migration `081_list_players_tier_vocabulary.sql` widened the
 * live `list_players_tier_check` to match, on Chris's ruling of 2026-08-09
 * (PROGRESS-lists-v2.md §3 **Q2** — the build's second and final schema
 * exception). Everything below is the TypeScript half of that pair.
 *
 * **The two halves must accept exactly the same strings, in both directions.**
 * `bucket-keys.test.ts` reads migration 081 off disk, lifts the regex out of the
 * CHECK, and asserts agreement over an exhaustive corpus — so a widening on one
 * side alone goes red here instead of surfacing as a Postgres `23514` returned
 * as an HTTP 500. `duplicate_list` (017) copies `tier` verbatim and never sees
 * Zod at all, which is why the database keeps its own guard rather than
 * delegating to this file.
 */

/** Tier letters, best first. The letter scale stays (Chris, 2026-08-09). */
export type ListTierValue = (typeof TIER_VALUES)[number]

/**
 * Rounds `r1`…`r30`.
 *
 * 30 is the deepest draft this app's own league settings can construct —
 * `league-settings.ts` caps bench at 20, plus starting slots (leagues D91:
 * `total_rounds` = Σ starters + bench, IR excluded). It nearly doubles D4's
 * stated 12–16 and keeps every key ≤ 3 characters. Raising it later is one edit
 * here and one to the CHECK in a new migration.
 */
export const ROUND_VALUES = [
  'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10',
  'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r20',
  'r21', 'r22', 'r23', 'r24', 'r25', 'r26', 'r27', 'r28', 'r29', 'r30',
] as const
export type ListRoundValue = (typeof ROUND_VALUES)[number]

/** The highest round key the vocabulary carries. */
export const ROUND_MAX = ROUND_VALUES.length

/**
 * Cost bands `c1`…`c4` — `DEFAULT_COST_BANDS`' own keys
 * (`src/stores/list-display-store.ts`), adopted on the wire rather than a second
 * alphabet being minted. Adopting them means **every key the route accepts has a
 * default label**, so `resolveBandLabel` can never fall through to rendering a
 * raw key (the R181/R183 hazard). Deliberately not widened to `c5`: a fifth band
 * would have no default label and would render the literal `c5` in the rail.
 *
 * Note these are accepted-but-unwritten today. LV.2/LV.3 shipped cost bands as
 * **computed** from `players.auction_value` (plan D4 erratum, v3.8), so nothing
 * currently stores a `c*` key. They are in the vocabulary anyway because the
 * schema budget closes with this migration: provisioning them now costs one
 * character class, and adding them later would cost a fourth schema exception.
 */
export const COST_BAND_VALUES = ['c1', 'c2', 'c3', 'c4'] as const
export type ListCostBandValue = (typeof COST_BAND_VALUES)[number]

/**
 * Every value `list_players.tier` may hold. `null` is "ungrouped" and is not a
 * member — `''` is not a bucket either.
 */
export const BUCKET_KEYS = [...TIER_VALUES, ...ROUND_VALUES, ...COST_BAND_VALUES] as const
export type ListBucketKey = (typeof BUCKET_KEYS)[number]

/**
 * The source text of migration 081's CHECK predicate, character for character.
 *
 * Kept as a string rather than a `RegExp` literal so the pairing test can
 * compare it to the migration file's own text directly. It is deliberately
 * anchored: an unanchored pattern would accept `xxSxx` on both sides and neither
 * layer would notice.
 */
export const BUCKET_KEY_PATTERN = '^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$'

/**
 * Membership test.
 *
 * Uses the enumerated set, not {@link BUCKET_KEY_PATTERN} — a set lookup has no
 * anchoring, backtracking or newline semantics to get wrong, and the two are
 * pinned to each other by `bucket-keys.test.ts`. (JavaScript's `$` matches only
 * at end of input, but Python's does not and POSIX ARE has a newline-sensitive
 * mode; a set lookup is immune to all of it.)
 */
export function isBucketKey(value: unknown): value is ListBucketKey {
  return typeof value === 'string' && (BUCKET_KEYS as readonly string[]).includes(value)
}

/** Is this the subset the S–F tier label set renders? */
export function isTierKey(value: unknown): value is ListTierValue {
  return typeof value === 'string' && (TIER_VALUES as readonly string[]).includes(value)
}

/** The round number a key denotes, or `null` when it is not a round key. */
export function roundNumberOf(value: unknown): number | null {
  if (typeof value !== 'string') return null
  if (!(ROUND_VALUES as readonly string[]).includes(value)) return null
  return Number(value.slice(1))
}

/** The round key for a 1-based round number, or `null` when out of range. */
export function roundKeyFor(round: number): ListRoundValue | null {
  if (!Number.isInteger(round) || round < 1 || round > ROUND_MAX) return null
  return ROUND_VALUES[round - 1]
}

/**
 * The wire schema for a bucket write — one source, imported by
 * `PATCH /api/lists/[id]/players/[playerId]/tier` rather than duplicated there.
 * (Through v3.9 the route inlined its own copy of the six tier letters and this
 * file's `TIER_VALUES` was the unused twin; §3 Q2 asked for them collapsed.)
 */
export const bucketKeySchema = z.enum(BUCKET_KEYS)
export const TEAM_SLOTS = [
  'QB',
  'RB',
  'WR',
  'FLEX',
  'TE',
  'DST',
  'K',
  'IR',
  'BENCH',
] as const

export type RankingMode = (typeof RANKING_MODES)[number]

export const MAX_TAGS_PER_LIST = 5
export const MAX_TITLE_LEN = 100
export const MAX_DESCRIPTION_LEN = 500
export const MAX_COMMENT_LEN = 1000
export const MAX_TAG_NAME_LEN = 20

export const listTitleSchema = z.string().trim().min(1).max(MAX_TITLE_LEN)
export const listDescriptionSchema = z.string().trim().max(MAX_DESCRIPTION_LEN).optional()
export const positionFilterSchema = z.enum(POSITION_FILTERS).optional()
export const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TAG_NAME_LEN)
  .regex(/^[A-Za-z0-9 _-]+$/, 'Tags may only contain letters, numbers, spaces, hyphens, and underscores')

const slotCount = z.number().int().min(0).max(20)

export const rosterSettingsSchema = z.object({
  total: z.number().int().min(1).max(60),
  qb: slotCount,
  rb: slotCount,
  wr: slotCount,
  te: slotCount,
  flex: slotCount,
  dst: slotCount,
  k: slotCount,
  bench: slotCount,
  ir: slotCount,
})

export const createListSchema = z.object({
  title: listTitleSchema,
  description: listDescriptionSchema,
  position_filter: positionFilterSchema,
  ranking_mode: z.enum(RANKING_MODES).optional(),
  is_private: z.boolean().optional(),
  is_team: z.boolean().optional(),
  roster_settings: rosterSettingsSchema.optional(),
  // Legacy flags — kept for one release while consumers migrate to
  // ranking_mode. The API derives them from ranking_mode when present.
  hide_order: z.boolean().optional(),
  tiers_enabled: z.boolean().optional(),
  comments_enabled: z.boolean().optional(),
  tags: z.array(tagNameSchema).max(MAX_TAGS_PER_LIST).optional(),
})

export const updateListSchema = z.object({
  title: listTitleSchema.optional(),
  description: z.string().trim().max(MAX_DESCRIPTION_LEN).nullable().optional(),
  position_filter: z.enum(POSITION_FILTERS).nullable().optional(),
  ranking_mode: z.enum(RANKING_MODES).optional(),
  is_private: z.boolean().optional(),
  roster_settings: rosterSettingsSchema.optional(),
  folder_id: z.string().uuid().nullable().optional(),
  hide_order: z.boolean().optional(),
  tiers_enabled: z.boolean().optional(),
  comments_enabled: z.boolean().optional(),
  tags: z.array(tagNameSchema).max(MAX_TAGS_PER_LIST).optional(),
})

export const setSlotSchema = z.object({
  slot: z.enum(TEAM_SLOTS).nullable(),
})

export const folderNameSchema = z.string().trim().min(1).max(60)

export const createFolderSchema = z.object({
  name: folderNameSchema,
})

export const updateFolderSchema = z.object({
  name: folderNameSchema.optional(),
})

// Maps the 3-way ranking_mode to the legacy boolean pair so the API can
// dual-write during the transition. Keeps the database internally consistent.
export function rankingModeToLegacyFlags(mode: RankingMode): {
  hide_order: boolean
  tiers_enabled: boolean
} {
  switch (mode) {
    case 'unranked':
      return { hide_order: true, tiers_enabled: false }
    case 'ranked':
      return { hide_order: false, tiers_enabled: false }
    case 'rank_and_tier':
      return { hide_order: false, tiers_enabled: true }
  }
}

export const addPlayerSchema = z.object({
  player_id: z.string().min(1),
  /** Optional note stored on the list entry (e.g. AI-generated rationale). */
  notes: z.string().trim().max(280).optional(),
})

export const reorderPlayersSchema = z.object({
  positions: z
    .array(
      z.object({
        playerId: z.string().min(1),
        position: z.number().int().positive(),
      }),
    )
    .min(1),
})

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LEN),
  parent_id: z.string().uuid().nullable().optional(),
})

export const listsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  includeBigBoard: z.coerce.boolean().default(false),
})

export const commentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type CreateListInput = z.infer<typeof createListSchema>
export type UpdateListInput = z.infer<typeof updateListSchema>
export type AddPlayerInput = z.infer<typeof addPlayerSchema>
export type ReorderPlayersInput = z.infer<typeof reorderPlayersSchema>
export type CreateCommentInput = z.infer<typeof createCommentSchema>
