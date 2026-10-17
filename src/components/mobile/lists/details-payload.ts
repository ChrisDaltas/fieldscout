import { rosterTotal, type RosterDraft } from '@/components/lists/list-form-payload'
import {
  coverColorOf,
  type CoverColor,
  type CreateListWithCoverInput,
  type UpdateListWithCoverInput,
} from '@/lib/lists/cover-color'
import type { ListRosterSettings } from '@/types/database'
import { MAX_LINKS_PER_LIST, rosterSettingsSchema, type POSITION_FILTERS } from '@/types/schemas/lists'
import { youTubeId } from '@/utils/youtube'

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
  /**
   * The Public switch off (gap list §3 #4). New list always sends it, as
   * desktop's form does; Edit details sends it only when it changed.
   * Absent = leave visibility alone.
   */
  isPrivate?: boolean
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
  is_private?: boolean | null
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
    ...(draft.isPrivate !== undefined ? { is_private: draft.isPrivate } : {}),
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
  if (draft.isPrivate !== undefined && draft.isPrivate !== Boolean(current.is_private)) patch.is_private = draft.isPrivate
  if (current.tags.map((t) => t.name).join('\n') !== draft.tags.join('\n')) patch.tags = [...draft.tags]
  return patch
}

// =============================================================================
// Videos (gap list §3 #4): up to 10 on New list and Edit details
// =============================================================================

/** A video on the New list / Edit details draft. */
export interface VideoDraft {
  url: string
  /** YouTube's 11-character id; empty for a stored video link that isn't a
   *  YouTube one (desktop can attach any web address as a video). */
  yt: string
  /** The attached link's id — a video already on the list (Edit details). */
  linkId?: string
  /**
   * An attached video's stored title: YouTube's own, looked up when it was
   * attached, or null when YouTube gave none (then no title line shows). A
   * pasted video has none here — its row looks the title up
   * (`useYouTubeTitle`).
   */
  title?: string | null
}

/** A stored link as the draft needs it. */
export interface StoredLink {
  id: string
  kind: 'video' | 'article'
  url: string
  title: string | null
}

/** The list's attached videos, in order, as draft rows. */
export function videoDraftsOf(links: readonly StoredLink[]): VideoDraft[] {
  return links
    .filter((link) => link.kind === 'video')
    .map((link) => ({ url: link.url, yt: youTubeId(link.url) ?? '', linkId: link.id, title: link.title }))
}

/**
 * How many videos the list can hold: the attach route's cap
 * (`MAX_LINKS_PER_LIST`, 10) less any article links desktop attached — they
 * share it.
 */
export function maxVideos(links: readonly StoredLink[]): number {
  return Math.max(0, MAX_LINKS_PER_LIST - links.filter((link) => link.kind === 'article').length)
}

export type AddVideoProblem = 'invalid' | 'duplicate' | 'full'

/**
 * A pasted link added to the draft, or why it can't be: not a YouTube video
 * link, a video the list already has (the same video under another address
 * counts — it would be a second identical card), or no room left. The screen
 * hides the link field once the list is full, so 'full' is a backstop.
 */
export function addVideo(
  videos: readonly VideoDraft[],
  link: string,
  max: number,
): { ok: true; videos: VideoDraft[] } | { ok: false; problem: AddVideoProblem } {
  const yt = youTubeId(link)
  if (!yt) return { ok: false, problem: 'invalid' }
  if (videos.some((video) => video.yt === yt)) return { ok: false, problem: 'duplicate' }
  if (videos.length >= max) return { ok: false, problem: 'full' }
  return { ok: true, videos: [...videos, { url: link.trim(), yt }] }
}

/** The line under the link field for each problem (design copy for 'invalid'). */
export const ADD_VIDEO_PROBLEM: Record<AddVideoProblem, string> = {
  invalid: 'That doesn’t look like a YouTube link',
  duplicate: 'That video is already on this list',
  full: 'This list has no room for another video',
}

/**
 * What Done has to do to the attached videos: the ones taken off the draft
 * come off the list, the pasted ones go on, in the order they were added
 * (each lands at the end). `saveVideoChanges` makes the calls.
 */
export function videoChanges(
  stored: readonly StoredLink[],
  draft: readonly VideoDraft[],
): { remove: string[]; add: VideoDraft[] } {
  const kept = new Set(draft.flatMap((video) => (video.linkId ? [video.linkId] : [])))
  return {
    remove: stored.filter((link) => link.kind === 'video' && !kept.has(link.id)).map((link) => link.id),
    add: draft.filter((video) => !video.linkId),
  }
}

/** `POST /api/lists/[id]/links` for one pasted video. */
export interface VideoAttachBody {
  kind: 'video'
  url: string
  /** YouTube's own title, when the row already looked it up. */
  title?: string
}

/**
 * The calls Done makes for the videos, injected so the order and the failure
 * handling are pinned by `details-payload.test.ts`. `del` and `post` reject
 * when the call didn't go through (a `post` rejection carries the line to
 * show); `titleOf` is the title the row's lookup cached for a video id —
 * `null` when YouTube gave none, `undefined` while it's still loading.
 */
export interface VideoSaveIO {
  del: (listId: string, linkId: string) => Promise<void>
  post: (listId: string, body: VideoAttachBody) => Promise<void>
  titleOf: (yt: string) => string | null | undefined
}

/** The toast lines for a video call that didn't go through. */
export const VIDEO_REMOVE_FAILED = 'A video could not be removed.'
export const VIDEO_ATTACH_FAILED = 'Could not attach the video.'

/**
 * Done's video work: every removal first, so swapping a video on a full list
 * never hits the cap, then the new ones in order, one at a time (each lands
 * at the end). A video goes on with the title its row showed — YouTube's own
 * — or with none, and the attach route looks it up itself and stores no
 * title rather than a placeholder (gap list #11). A call that fails never
 * stops the rest; every failure is handed back, in order, for one toast.
 */
export async function saveVideoChanges(
  listId: string,
  changes: { remove: readonly string[]; add: readonly VideoDraft[] },
  io: VideoSaveIO,
): Promise<string[]> {
  const failures: string[] = []
  for (const linkId of changes.remove) {
    await io.del(listId, linkId).catch(() => failures.push(VIDEO_REMOVE_FAILED))
  }
  for (const video of changes.add) {
    const title = io.titleOf(video.yt)
    await io
      .post(listId, { kind: 'video', url: video.url, ...(title ? { title } : {}) })
      .catch((error: unknown) => failures.push(error instanceof Error && error.message ? error.message : VIDEO_ATTACH_FAILED))
  }
  return failures
}

/** What shows in place of the link field once the list holds all it can. */
export function videosFullNote(max: number): string {
  return max >= MAX_LINKS_PER_LIST
    ? `That’s ${MAX_LINKS_PER_LIST} videos, the most a list can hold`
    : `This list is full: videos and links share a limit of ${MAX_LINKS_PER_LIST}`
}
