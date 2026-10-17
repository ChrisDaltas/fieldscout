import { z } from 'zod'

import type { PostgrestErrorLike } from '@/lib/supabase/postgrest-errors'
import { createListSchema, updateListSchema } from '@/types/schemas/lists'

/**
 * A list's cover colour (Chris, 2026-10-15, mobile ruling 9; migration 188).
 *
 * The owner can pick one of the design's six swatches for the player-collage
 * cover (lr-lists §2.2 "Colour swatches"). Stored as a stable KEY, never a hex
 * — each surface maps the key to its own theme token (mobile:
 * `lists-model.ts`, desktop: `list-thumbnail.tsx`), so a palette change never
 * needs a data migration. `null` = no colour chosen: the cover keeps today's
 * rule and follows the list's position group, so existing lists don't change.
 *
 * Keep {@link COVER_COLORS} and the CHECK in `188_list_cover_color.sql` in
 * step — `cover-color.test.ts` reads the migration and compares them.
 */
export const COVER_COLORS = ['blue', 'ink', 'red', 'purple', 'indigo', 'green'] as const
export type CoverColor = (typeof COVER_COLORS)[number]

/** Plain names for the swatches' accessible labels (ink reads as black). */
export const COVER_COLOR_LABEL: Record<CoverColor, string> = {
  blue: 'Blue',
  ink: 'Black',
  red: 'Red',
  purple: 'Purple',
  indigo: 'Indigo',
  green: 'Green',
}

/** A colour key, or `null` to go back to the position colour. */
export const coverColorSchema = z.enum(COVER_COLORS).nullable()

/** `POST /api/lists` — the shared create body plus an optional colour. */
export const createListWithCoverSchema = createListSchema.extend({
  cover_color: coverColorSchema.optional(),
})

/** `PATCH /api/lists/[id]` — the shared update body plus an optional colour. */
export const updateListWithCoverSchema = updateListSchema.extend({
  cover_color: coverColorSchema.optional(),
})

export type CreateListWithCoverInput = z.infer<typeof createListWithCoverSchema>
export type UpdateListWithCoverInput = z.infer<typeof updateListWithCoverSchema>

export function isCoverColor(value: unknown): value is CoverColor {
  return typeof value === 'string' && (COVER_COLORS as readonly string[]).includes(value)
}

/**
 * The list's chosen colour, or `null` (follow the position colour). Tolerates
 * a row read before migration 188 is pushed (no `cover_color` key at all) and
 * any value outside the vocabulary.
 */
export function coverColorOf(row: { cover_color?: string | null } | null | undefined): CoverColor | null {
  const value = row?.cover_color
  return isCoverColor(value) ? value : null
}

/**
 * Whether a row read with `select('*')` carries the column — i.e. migration
 * 188 has been pushed to this environment. Main deploys before the push, so
 * the colour controls only show once a loaded row proves the column exists.
 */
export function hasCoverColorColumn(row: object | null | undefined): boolean {
  return row != null && Object.prototype.hasOwnProperty.call(row, 'cover_color')
}

/**
 * True when the database answered "there is no `cover_color` column" —
 * migration 188 not pushed yet. PostgREST says PGRST204 ("Could not find the
 * 'cover_color' column of 'lists' in the schema cache") for a write and
 * Postgres says 42703 ("column lists.cover_color does not exist") for a read.
 * Anchored on the column's name so an unrelated missing column is never
 * mistaken for this one.
 */
export function isMissingCoverColorColumn(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false
  if (error.code !== 'PGRST204' && error.code !== '42703') return false
  return /\bcover_color\b/.test(error.message ?? '')
}

/**
 * The API's answer when a colour is sent before migration 188 is pushed: a
 * clear 409 rather than a 500, and nothing is saved (the write is one
 * statement). The app only offers the swatches once the column exists, so
 * this is reached by a stale page or a direct API call.
 */
export const COVER_COLOR_UNAVAILABLE_STATUS = 409
export const COVER_COLOR_UNAVAILABLE_BODY = {
  error: 'Cover colours aren’t available yet, so nothing was saved. Try again without a colour.',
  code: 'COVER_COLOR_UNAVAILABLE',
} as const
