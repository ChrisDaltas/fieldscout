import { rosterTotal, type RosterDraft } from '@/components/lists/list-form-payload'
import {
  coverColorOf,
  type CoverColor,
  type CreateListWithCoverInput,
  type UpdateListWithCoverInput,
} from '@/lib/lists/cover-color'
import type { ListRosterSettings } from '@/types/database'
import { rosterSettingsSchema, type POSITION_FILTERS } from '@/types/schemas/lists'

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
  /**
   * A team list (desktop's Team type: starters, bench and IR slots) and its
   * roster. Chosen on New list only — as on desktop, a list's type is fixed
   * once it exists; Edit details changes a team's roster.
   */
  team?: boolean
  roster?: RosterDraft
}

/** Desktop's opening roster for a new team list (list-form-dialog). */
export const DEFAULT_TEAM_ROSTER: RosterDraft = { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, dst: 1, k: 1, bench: 6, ir: 2 }

/** The roster's slots, in desktop's order, with the phone's labels. */
export const ROSTER_SLOTS: ReadonlyArray<{ key: keyof RosterDraft; label: string }> = [
  { key: 'qb', label: 'QB' },
  { key: 'rb', label: 'RB' },
  { key: 'wr', label: 'WR' },
  { key: 'flex', label: 'FLEX' },
  { key: 'te', label: 'TE' },
  { key: 'dst', label: 'D/ST' },
  { key: 'k', label: 'K' },
  { key: 'bench', label: 'Bench' },
  { key: 'ir', label: 'IR' },
]

/** The API's bounds (`rosterSettingsSchema`): 0–20 a slot, 1–60 in all. */
export const MAX_SLOT = 20
export const MAX_ROSTER = 60

/** Whether a roster can be saved (at least one player, at most 60). */
export function rosterValid(roster: RosterDraft): boolean {
  const total = rosterTotal(roster)
  return total >= 1 && total <= MAX_ROSTER
}

/** One slot moved by `delta`, kept inside the bounds — the steppers can't
 *  push a roster past what the API takes ("prevent, don't refuse"). */
export function stepRoster(roster: RosterDraft, key: keyof RosterDraft, delta: 1 | -1): RosterDraft {
  const next = roster[key] + delta
  if (next < 0 || next > MAX_SLOT) return roster
  if (delta > 0 && rosterTotal(roster) >= MAX_ROSTER) return roster
  return { ...roster, [key]: next }
}

/**
 * A stored roster (`lists.roster_settings`, JSON) as the steppers' draft —
 * read through the API's own schema, so a malformed row opens on desktop's
 * default rather than on NaN slots. Its `total` is derived, never edited.
 */
export function rosterDraftOf(settings: unknown): RosterDraft {
  const parsed = rosterSettingsSchema.safeParse(settings)
  if (!parsed.success) return DEFAULT_TEAM_ROSTER
  const { qb, rb, wr, te, flex, dst, k, bench, ir } = parsed.data
  return { qb, rb, wr, te, flex, dst, k, bench, ir }
}

function rosterSettings(roster: RosterDraft): ListRosterSettings {
  return { ...roster, total: rosterTotal(roster) }
}

/** The list as loaded, for working out what Edit details changed. */
export interface DetailsCurrent {
  title: string
  description: string | null
  position_filter: string | null
  is_team?: boolean | null
  /** Absent on a row read before migration 188 is pushed. */
  cover_color?: string | null
  /** JSON on the row; read with `rosterDraftOf`. */
  roster_settings?: unknown
  tags: ReadonlyArray<{ name: string }>
}

/** A position choice as the column's value: 'ALL' = no filter (null). */
function filterOf(position: PositionGroup): Exclude<PositionGroup, 'ALL'> | null {
  return position === 'ALL' ? null : position
}

/**
 * `POST /api/lists` for New list: a ranked list, with the position group and
 * a cover colour only when one is chosen ("All" and "no colour" are the
 * defaults, so they're left out). A team list sends desktop's team body
 * instead of a position group — `is_team` and its roster (the route refuses
 * a team without one).
 */
export function detailsCreateInput(draft: DetailsDraft): CreateListWithCoverInput {
  const positionFilter = draft.team ? null : filterOf(draft.position)
  return {
    title: draft.title,
    description: draft.desc.trim() || undefined,
    ranking_mode: 'ranked',
    ...(positionFilter ? { position_filter: positionFilter } : {}),
    ...(draft.team ? { is_team: true, roster_settings: rosterSettings(draft.roster ?? DEFAULT_TEAM_ROSTER) } : {}),
    ...(draft.coloursReady && draft.coverColor ? { cover_color: draft.coverColor } : {}),
  }
}

/**
 * `PATCH /api/lists/[id]` for Edit details: only what changed. Clearing is a
 * change too — "All" sends `position_filter: null`, un-choosing a colour sends
 * `cover_color: null` (back to the position colour). A team list has no
 * position group to change, so none is sent for one; its roster is sent
 * whole when a slot changed (desktop's edit dialog does the same).
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
  if (current.is_team && draft.roster) {
    const before = rosterDraftOf(current.roster_settings)
    if (ROSTER_SLOTS.some(({ key }) => before[key] !== draft.roster![key])) patch.roster_settings = rosterSettings(draft.roster)
  }
  if (draft.coloursReady && draft.coverColor !== coverColorOf(current)) patch.cover_color = draft.coverColor
  if (current.tags.map((t) => t.name).join('\n') !== draft.tags.join('\n')) patch.tags = [...draft.tags]
  return patch
}
