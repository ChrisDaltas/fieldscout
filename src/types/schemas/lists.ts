import { z } from 'zod'

export const POSITION_FILTERS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX'] as const
export const TIER_VALUES = ['S', 'A', 'B', 'C', 'D', 'F'] as const
export const RANKING_MODES = ['unranked', 'ranked', 'rank_and_tier'] as const
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
