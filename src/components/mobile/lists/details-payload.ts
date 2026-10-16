import {
  coverColorOf,
  type CoverColor,
  type CreateListWithCoverInput,
  type UpdateListWithCoverInput,
} from '@/lib/lists/cover-color'
import type { POSITION_FILTERS } from '@/types/schemas/lists'

import { positionGroupValue } from './lists-model'

/**
 * FieldScout Mobile — what New list / Edit details send (lr-lists §2.2).
 * Pure: the screen (`list-details-screen.tsx`) holds the draft and hands it
 * here, so what reaches `POST /api/lists` and `PATCH /api/lists/[id]` is
 * pinned by `details-payload.test.ts` rather than only what is drawn.
 */

/** The position group choice: a stored `position_filter`, or 'ALL' (none). */
export type PositionGroup = (typeof POSITION_FILTERS)[number] | 'ALL'

export interface DetailsDraft {
  /** The validated name (`listTitleSchema`'s output). */
  title: string
  /** The description as typed; trimmed here. */
  desc: string
  position: PositionGroup
  coverColor: CoverColor | null
  /**
   * `lists.cover_color` exists here (migration 188 pushed). Until it does, no
   * colour is ever sent — the API would refuse the write.
   */
  coloursReady: boolean
}

/** The list as loaded, for working out what Edit details changed. */
export interface DetailsCurrent {
  title: string
  description: string | null
  position_filter: string | null
  is_team?: boolean | null
  /** Absent on a row read before migration 188 is pushed. */
  cover_color?: string | null
  tags: ReadonlyArray<{ name: string }>
}

/** A position choice as the column's value: 'ALL' = no filter (null). */
function filterOf(position: PositionGroup): Exclude<PositionGroup, 'ALL'> | null {
  return position === 'ALL' ? null : position
}

/**
 * `POST /api/lists` for New list: a ranked list, with the position group and
 * a cover colour only when one is chosen ("All" and "no colour" are the
 * defaults, so they're left out).
 */
export function detailsCreateInput(draft: DetailsDraft): CreateListWithCoverInput {
  const positionFilter = filterOf(draft.position)
  return {
    title: draft.title,
    description: draft.desc.trim() || undefined,
    ranking_mode: 'ranked',
    ...(positionFilter ? { position_filter: positionFilter } : {}),
    ...(draft.coloursReady && draft.coverColor ? { cover_color: draft.coverColor } : {}),
  }
}

/**
 * `PATCH /api/lists/[id]` for Edit details: only what changed. Clearing is a
 * change too — "All" sends `position_filter: null`, un-choosing a colour sends
 * `cover_color: null` (back to the position colour). A team list has no
 * position group to change, so none is sent for one.
 */
export function detailsPatch(
  current: DetailsCurrent,
  draft: DetailsDraft & { tags: readonly string[] },
): UpdateListWithCoverInput {
  const patch: UpdateListWithCoverInput = {}
  if (draft.title !== current.title) patch.title = draft.title
  const nextDesc = draft.desc.trim()
  if (nextDesc !== (current.description ?? '')) patch.description = nextDesc || null
  if (!current.is_team && draft.position !== positionGroupValue(current.position_filter)) {
    patch.position_filter = filterOf(draft.position)
  }
  if (draft.coloursReady && draft.coverColor !== coverColorOf(current)) patch.cover_color = draft.coverColor
  if (current.tags.map((t) => t.name).join('\n') !== draft.tags.join('\n')) patch.tags = [...draft.tags]
  return patch
}
