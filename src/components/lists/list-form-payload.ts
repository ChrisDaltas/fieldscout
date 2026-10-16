import { coverColorOf, type CoverColor, type CreateListWithCoverInput } from '@/lib/lists/cover-color'
import type { ListRosterSettings } from '@/types/database'
import type { POSITION_FILTERS } from '@/types/schemas/lists'

/**
 * What the desktop list dialog (`list-form-dialog.tsx`) sends — pure, so the
 * body that reaches `POST /api/lists` / `PATCH /api/lists/[id]` is pinned by
 * `list-form-payload.test.ts` and not only what the dialog draws.
 */

export type PositionFilter = (typeof POSITION_FILTERS)[number]
export type ListType = 'basic' | 'ranked' | 'team'
export type RosterDraft = Omit<ListRosterSettings, 'total'>

export interface ListFormState {
  title: string
  positionFilter: PositionFilter | ''
  listType: ListType
  roster: RosterDraft
  isPrivate: boolean
  /** `lists.cover_color` (migration 188); null = follow the position group. */
  coverColor: CoverColor | null
}

export function rosterTotal(r: RosterDraft): number {
  return r.qb + r.rb + r.wr + r.te + r.flex + r.dst + r.k + r.bench + r.ir
}

/**
 * The dialog's body, for create and edit alike (the PATCH schema drops the
 * create-only keys). The cover colour is sent only once the column exists
 * (`coloursReady` — main deploys before migration 188 is pushed) and only
 * when it says something: a chosen colour on create; a change on edit,
 * `null` included (back to the position colour).
 */
export function listFormPayload(
  form: ListFormState,
  opts: {
    mode: 'create' | 'edit'
    /** The list being edited (edit mode); its stored colour is the baseline. */
    list?: { cover_color?: string | null } | null
    coloursReady: boolean
  },
): CreateListWithCoverInput {
  const isTeam = form.listType === 'team'
  const sendColour =
    opts.coloursReady &&
    (opts.mode === 'create' ? form.coverColor !== null : form.coverColor !== coverColorOf(opts.list))
  return {
    title: form.title.trim(),
    position_filter: form.positionFilter || undefined,
    ranking_mode: form.listType === 'basic' ? 'unranked' : 'ranked',
    is_team: isTeam,
    roster_settings: isTeam ? { ...form.roster, total: rosterTotal(form.roster) } : undefined,
    is_private: form.isPrivate,
    ...(sendColour ? { cover_color: form.coverColor } : {}),
  }
}
