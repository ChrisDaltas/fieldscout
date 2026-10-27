import type { CommitOutcome } from '@/hooks/use-mobile-lists-commit'
import type { CreateListWithCoverInput } from '@/lib/lists/cover-color'
import { listTitleSchema } from '@/types/schemas/lists'

import { detailsCreateInput, saveVideoChanges, type DetailsDraft, type VideoDraft, type VideoSaveIO } from './details-payload'
import type { ListDraft } from './lists-model'

/**
 * FieldScout Mobile — New list is one draft until Save (lr-lists §4: "Editor
 * (new) [‹] ──► New list step 1 (draft kept)"; FieldScout Mobile Lists and
 * Rankings.dc.html, the editor's back and save).
 *
 * Step 1 (name, description, cover, videos, type, position group) and step 2
 * (the players, Ranked / Tiers) are held on the phone. "Next: add players"
 * saves nothing; Back from step 2 returns to step 1 with all of it kept; ✕ on
 * step 1 leaves without a list. Only the editor's **Save** makes the list —
 * `saveNewList` — so no exit can leave an empty list behind in My lists.
 *
 * Save writes, in order: the list (`POST /api/lists`), its cover image, its
 * videos, then the players and Ranked / Tiers through the editor's own write
 * (`commitDraft`, checked against a re-read). The cover and videos never stop
 * the save (they didn't on step 1 either) — a failure there is told in the
 * "List created" toast. If the players fail after the list exists, the list
 * is kept (`created`) and Save again writes only what is left — it never makes
 * a second list.
 */

/** New list's step 2 is New list's own URL plus `step=2`. Next pushes it, so
 *  Back — on screen or the OS gesture — is history back to step 1. */
export const NEW_LIST_STEP_PARAM = 'step'

/** `/app/lists/new` with its markers kept (`from=`), at step 1 or 2. */
export function newListStepHref(search: string | URLSearchParams, step: 1 | 2): string {
  const params = new URLSearchParams(search)
  params.delete(NEW_LIST_STEP_PARAM)
  if (step === 2) params.set(NEW_LIST_STEP_PARAM, '2')
  const query = params.toString()
  return `/app/lists/new${query ? `?${query}` : ''}`
}

/** The id the editor's session choices (stat columns, time frame, scoring)
 *  are kept under until the list has a real one. */
export function newListKey(): string {
  return `new-list:${Math.random().toString(36).slice(2, 10)}`
}

/** What a new list is made as: a ranked list with this name and no players. */
function newListBase(title: string, rankingMode = 'ranked'): ListDraft['base'] {
  return { title, ranking_mode: rankingMode, players: [] }
}

/**
 * The editor's draft when Next opens step 2: the one Back kept — its players,
 * Ranked / Tiers and tier lines — under step 1's name, or a fresh, empty one.
 */
export function stepTwoDraft(kept: ListDraft | null, title: string): ListDraft {
  if (!kept) return { title, mode: 'ranked', entries: [], pending: 0, base: newListBase(title) }
  return { ...kept, title, base: { ...kept.base, title } }
}

/** Whether ✕ on step 1 should ask first: the draft holds players added in
 *  step 2, which leaving would throw away (gap list #16: Back/Cancel asks
 *  "Discard changes?" when there are edits). */
export function newListCloseAsks(draft: ListDraft | null): boolean {
  return Boolean(draft && draft.entries.length > 0)
}

/** The list once Save has made it, and how its cover and videos went. */
export interface CreatedList {
  id: string
  title: string
  ranking_mode: string
  /** The cover upload's error, when it failed. */
  coverError: string | null
  /** The videos that didn't attach. */
  videoFailures: string[]
}

export interface NewListSaveIO {
  create: (input: CreateListWithCoverInput) => Promise<{ id: string; title: string; ranking_mode?: string | null }>
  uploadCover: (listId: string, file: File) => Promise<unknown>
  videos: VideoSaveIO
  /** The editor's write (`commitDraft`): never throws. */
  commit: (listId: string, draft: ListDraft) => Promise<CommitOutcome>
}

export interface NewListSaveInput {
  /** Step 1's details. Its name is the draft's, which step 2 can edit. */
  details: Omit<DetailsDraft, 'title'>
  /** The uploaded cover, when step 1 picked one. */
  cover: File | null
  videos: readonly VideoDraft[]
  /** Step 2's draft. */
  draft: ListDraft
  /** The list an earlier Save made before failing; `null` until then. */
  created: CreatedList | null
}

/** Save's answer: the editor's (`CommitOutcome`), plus the list if it exists. */
export type NewListOutcome = CommitOutcome & { created: CreatedList | null }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Save on a new list's step 2: make the list (once), then write the draft. */
export async function saveNewList(input: NewListSaveInput, io: NewListSaveIO): Promise<NewListOutcome> {
  const failed = (error: string, created: CreatedList | null): NewListOutcome => ({
    ok: false,
    error,
    attempted: null,
    remaining: null,
    list: null,
    created,
  })
  const title = listTitleSchema.safeParse(input.draft.title)
  if (!title.success) return failed('Give your list a name.', input.created)

  let created = input.created
  if (!created) {
    let row: Awaited<ReturnType<NewListSaveIO['create']>>
    try {
      row = await io.create(detailsCreateInput({ ...input.details, title: title.data }))
    } catch (error) {
      return failed(`Could not create the list: ${message(error)}`, null)
    }
    let coverError: string | null = null
    if (input.cover) {
      await io.uploadCover(row.id, input.cover).catch((error: unknown) => {
        coverError = message(error)
      })
    }
    const videoFailures =
      input.videos.length > 0 ? await saveVideoChanges(row.id, { remove: [], add: input.videos }, io.videos) : []
    created = { id: row.id, title: row.title, ranking_mode: row.ranking_mode ?? 'ranked', coverError, videoFailures }
  }

  // The draft measured against the list as it was made (empty), so the
  // write adds every player and sets Ranked / Tiers if they changed.
  const outcome = await io.commit(created.id, { ...input.draft, base: newListBase(created.title, created.ranking_mode) })
  if (outcome.ok) return { ...outcome, created }
  // The list itself is saved: the note says so ("Saved: the list. Not
  // saved: 2 added players."), and Save again writes only what is left.
  return { ...outcome, alsoSaved: ['the list'], created }
}

/** The toast once a new list is saved: "List created", and what of its
 *  cover and videos didn't make it (only one toast shows at a time). */
export function createdToast(created: Pick<CreatedList, 'coverError' | 'videoFailures'>): {
  title: string
  description?: string
} {
  const videos = created.videoFailures.length
  const videoWords = videos === 1 ? 'a video' : `${videos} videos`
  if (created.coverError && videos > 0) {
    return { title: `List created, but the cover image and ${videoWords} couldn’t be added`, description: created.coverError }
  }
  if (created.coverError) return { title: 'List created, but the cover image didn’t upload', description: created.coverError }
  if (videos > 0) return { title: `List created, but ${videoWords} couldn’t be added`, description: created.videoFailures[0] }
  return { title: 'List created' }
}
