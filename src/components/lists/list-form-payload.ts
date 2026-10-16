import {
  coverColorOf,
  type CoverColor,
  type CreateListWithCoverInput,
  type UpdateListWithCoverInput,
} from '@/lib/lists/cover-color'
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

interface PayloadOpts {
  /** The list being edited (edit mode); its stored colour is the baseline. */
  list?: { cover_color?: string | null } | null
  coloursReady: boolean
}

/**
 * The dialog's body, for create and edit alike (the PATCH schema drops the
 * create-only keys). The cover colour is sent only once the column exists
 * (`coloursReady` — main deploys before migration 188 is pushed) and only
 * when it says something: a chosen colour on create; a change on edit,
 * `null` included (back to the position colour).
 *
 * Position group "All players" ('') is **no position**: on create the key is
 * left out (the POST schema takes no null; the route stores null); on edit it
 * is sent as `null`, which the PATCH clears. `undefined` there would be
 * dropped by `JSON.stringify` and the old position would silently stay
 * (Chris, 2026-10-15 — "All players" didn't save).
 *
 * `ranking_mode` is create-only. The Type picker is disabled in edit mode, so
 * the key would never be a user choice there — and the dialog only knows
 * basic/ranked/team, so sending it would flatten a tiered list
 * (`rank_and_tier`, `tier_only`) back to plain 'ranked' on every rename or
 * position change (the PATCH rewrites `ranking_mode` and both legacy flags
 * whenever the key is present).
 */
export function listFormPayload(
  form: ListFormState,
  opts: PayloadOpts & { mode: 'create' },
): CreateListWithCoverInput
export function listFormPayload(
  form: ListFormState,
  opts: PayloadOpts & { mode: 'edit' },
): UpdateListWithCoverInput
export function listFormPayload(
  form: ListFormState,
  opts: PayloadOpts & { mode: 'create' | 'edit' },
): CreateListWithCoverInput | UpdateListWithCoverInput {
  const isTeam = form.listType === 'team'
  const sendColour =
    opts.coloursReady &&
    (opts.mode === 'create' ? form.coverColor !== null : form.coverColor !== coverColorOf(opts.list))
  const shared = {
    title: form.title.trim(),
    roster_settings: isTeam ? { ...form.roster, total: rosterTotal(form.roster) } : undefined,
    is_private: form.isPrivate,
    ...(sendColour ? { cover_color: form.coverColor } : {}),
  }
  if (opts.mode === 'edit') {
    return { ...shared, position_filter: form.positionFilter || null }
  }
  return {
    ...shared,
    position_filter: form.positionFilter || undefined,
    ranking_mode: form.listType === 'basic' ? 'unranked' : 'ranked',
    is_team: isTeam,
  }
}
