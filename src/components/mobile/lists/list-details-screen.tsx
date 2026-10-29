'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { rosterTotal, type RosterDraft } from '@/components/lists/list-form-payload'
import { refreshCommunity } from '@/components/mobile/community/community-store'
import { appEntryBehind, pathBehind } from '@/components/mobile/ui/back-nav'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { MSwitch } from '@/components/mobile/trades/m-overlay'
import { useListCoverColorSupport } from '@/hooks/use-list-cover-color-support'
import { listsKeys, useCreateList, useList, useUpdateList, type ListWithDetails } from '@/hooks/use-lists'
import { commitDraft } from '@/hooks/use-mobile-lists-commit'
import { thumbnailProblem, useMobileListsThumbnail } from '@/hooks/use-mobile-lists-thumbnail'
import { toast } from '@/hooks/use-toast'
import { useYouTubeTitle, youTubeTitleKey } from '@/hooks/use-youtube-title'
import { coverColorOf, hasCoverColorColumn, type CoverColor } from '@/lib/lists/cover-color'
import { cn } from '@/lib/utils'
import { MAX_DESCRIPTION_LEN, MAX_TAGS_PER_LIST, MAX_TITLE_LEN, listTitleSchema, tagNameSchema } from '@/types/schemas/lists'

import {
  ADD_VIDEO_PROBLEM,
  DEFAULT_TEAM_ROSTER,
  MAX_ROSTER,
  MAX_SLOT,
  ROSTER_SLOTS,
  VIDEO_ATTACH_FAILED,
  VIDEO_REMOVE_FAILED,
  addVideo,
  detailsPatch,
  maxVideos,
  nameReturnMovesOn,
  rosterDraftOf,
  rosterValid,
  saveVideoChanges,
  stepRoster,
  videoChanges,
  videoDraftsOf,
  videosFullNote,
  type AddVideoProblem,
  type VideoDraft,
  type VideoSaveIO,
} from './details-payload'
import {
  COVER_SWATCHES,
  POSITION_GROUP_OPTIONS,
  coverBgClass,
  positionGroupValue,
  youTubeThumb,
} from './lists-model'
import { NewListEditor, type EditorCommit } from './list-editor'
import type { ListDraft } from './lists-model'
import { COMMUNITY_HREF, listHref, useListsNav } from './lists-nav'
import { CenterNote, CoverImage, DiscardSheet, LIcon, PillButton, YouTubeBadge, type LIconName } from './lists-parts'
import { carryListSession } from './lists-session-store'
import {
  NEW_LIST_STEP_PARAM,
  createdToast,
  newListCloseAsks,
  newListDepth,
  newListKey,
  newListStartHref,
  newListStepHref,
  newListStrayBack,
  saveNewList,
  stepTwoDraft,
  type CreatedList,
  type NewListOutcome,
} from './new-list-save'

/**
 * FieldScout Mobile — New list, step 1 (lr-lists §2.2, states L3–L3h), and its
 * "Edit details" variant (L3x — unreachable in the prototype; here it opens
 * from a list's options).
 *
 * Name, description, thumbnail and video, then "Next: add players" opens step
 * 2 — the editor, Add players up — and saves nothing: the list is made only
 * by the editor's Save, Back from step 2 returns here with everything kept,
 * and ✕ leaves without a list (lr-lists §4; `NewListScreen`,
 * `new-list-save.ts`). Carried from the app: the cover upload goes
 * to the list's real storage with its size and type rules, Edit details also
 * edits tags, and both carry desktop's **position group** (Chris, 2026-10-15)
 * — an `MSegmented` row (exactly one choice is always on, "All" = no filter),
 * hidden for a team list as on desktop.
 *
 * **Colour swatches** (Chris, 2026-10-15, `lists.cover_color`, migration 188):
 * the design's six, shown only for the Player collage cover. No colour chosen
 * = the cover follows the position group, so existing lists keep their colour;
 * tapping the chosen swatch again goes back to that (a team list has no
 * position group, so its line says "the default colour" instead). They show
 * only once the column exists — Edit details checks the loaded row, New list
 * asks the database (`useListCoverColorSupport`) — so nothing offers a colour
 * before Chris pushes 188. What each screen sends is built by
 * `details-payload.ts` (and tested there).
 *
 * **Team lists** (gap list §3 #3): New list carries desktop's Team type — a
 * List / Team choice, and for a team its roster (starters, bench and IR
 * slots, desktop's defaults, steppers that stay inside the API's bounds). As
 * on desktop the type is fixed once the list exists, so Edit details shows a
 * team's roster to change but no type choice; a team has no position group.
 *
 * **Public and videos** (gap list §3 #4, the Community composer's list step,
 * m-composer §2.5): a Public switch (on by default, as there) and up to 10
 * YouTube videos rather than one — the link field stays above the attached
 * rows, and gives way to a line once the list is full (the attach route's
 * cap, shared with desktop's article links), so an 11th can't be tried. The
 * same video twice is refused at the field. Each row shows the video's real
 * title (looked up as it is pasted, the attach route's oEmbed lookup) or no
 * title at all — never a placeholder. Edit details carries both too: it
 * shows every attached video, and Done takes off the removed ones before it
 * attaches the new ones.
 *
 * **Return** (gap list §3 #7): in the name field it moves on once the list
 * has a name — New list's Next (to the editor, which reads "2 of 2"), or Edit
 * details' Done — as the composer's name step does; without a name it does
 * nothing, like the button.
 *
 * Left out, a lr-lists gap: the "Video frame" thumbnail (only an uploaded
 * image can be stored as a cover). The Next button is disabled until the list
 * has a name rather than tappable with a toast ("prevent, don't refuse").
 */

/**
 * New list: step 1, the details form, and step 2, the editor
 * (`NewListEditor`) — one draft, held here, until the editor's Save makes the
 * list (`saveNewList`). Nothing reaches the server before that, so no way
 * out leaves an empty list in My lists (the design: the list gets its id on
 * Save, lr-lists §4).
 *
 * - **Next** checks the name and opens step 2 as a pushed `step=2` entry of
 *   this URL, over a pushed `step=1` (step 1 again, `NEW_LIST_STEP_PARAM`),
 *   so **Back** — the editor's, or the OS gesture — is history back to step
 *   1, with the name, description, cover, videos and settings as they were,
 *   and the players kept for the next Next. A name changed in step 2's
 *   header comes back to step 1 with it.
 * - **✕** on step 1 leaves (where you came from, #27) without a list. Once
 *   step 2 has players it asks first — "Discard this list?" (gap list #16:
 *   Back/Cancel asks when there are edits) — and so does the **OS back
 *   gesture** from step 1: it lands on New list's first entry, still this
 *   page, which puts step 1 back and asks (`newListStrayBack`; the editor's
 *   guard in `mobile-lists.tsx` is the same pattern). Without players the
 *   gesture carries on to where New list came from. A reload asks too.
 * - **Save** makes the list and leaves for its List view, which takes New
 *   list's place in history (step 2 steps back to New list's first entry,
 *   which is replaced), so Back from the List view goes where New list came
 *   from. A list Community started returns there instead, "List created"
 *   (gap list §3 #8).
 * - A reload, link or Forward onto step 1 again or step 2 has no draft to
 *   show: it steps back to New list's first entry, step 1.
 */
export function NewListScreen({ currentWeek = 0 }: { currentWeek?: number }) {
  const nav = useListsNav()
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const from = params.get('from')
  /** New list's entries above its first (0, 1 = step 1 again, 2 = step 2). */
  const depth = newListDepth(params.get(NEW_LIST_STEP_PARAM))
  const onStep2 = depth === 2
  const d = useDetailsDraft(null)
  const [draftKey] = React.useState(newListKey)
  /** Step 2's draft — the players, Ranked / Tiers — kept across Back. */
  const [draft, setDraft] = React.useState<ListDraft | null>(null)
  const [confirmClose, setConfirmClose] = React.useState(false)
  /** Leaving New list (see `leave` and `close`). Set before the history
   *  steps it takes, so they aren't read as a stray Back. */
  const [exit, setExit] = React.useState<NewListExit | null>(null)
  /** The OS gesture left step 1 with players: put step 1 back and ask. */
  const [caught, setCaught] = React.useState(false)
  /** The list, once a Save has made it — so Save again never makes another. */
  const created = React.useRef<CreatedList | null>(null)
  const [exists, setExists] = React.useState(false)
  /** Leaving from step 2 (Save, or Back once Save has made the list). */
  const leavingStep2 = exit !== null && exit.kind !== 'close'

  const createList = useCreateList()
  const thumbnail = useMobileListsThumbnail()
  const videoIO = useVideoSaveIO()
  const colourProbe = useListCoverColorSupport(true)
  const coloursReady = colourProbe.data === true

  const save = useMutation({
    mutationFn: async (current: ListDraft): Promise<NewListOutcome> => {
      const outcome = await saveNewList(
        {
          details: {
            desc: d.desc,
            position: d.position,
            coverColor: d.coverColor,
            coloursReady,
            team: d.team,
            roster: d.roster,
            isPrivate: !d.isPublic,
          },
          cover: d.thumb === 'upload' ? d.file : null,
          videos: d.videos,
          draft: current,
          created: created.current,
        },
        {
          create: (input) => createList.mutateAsync(input),
          uploadCover: (listId, file) => thumbnail.mutateAsync({ listId, file }),
          videos: videoIO,
          commit: (listId, next) => commitDraft(listId, next),
        },
      )
      created.current = outcome.created
      return outcome
    },
    onSettled: (outcome, _error, current) => {
      // Not saved, and the OS gesture stepped back to New list's first
      // entry meanwhile (Save holds step 2 up until it's done): put step 1
      // again back over it, so the gesture asks before the players go.
      if (!outcome?.ok && liveDepth() === 0 && newListCloseAsks(current)) {
        window.history.pushState(null, '', newListStepHref(window.location.search, 1))
      }
      const made = outcome?.created
      if (!made) return
      setExists(true)
      if (outcome.list) qc.setQueryData(listsKeys.detail(made.id), outcome.list)
      else void qc.invalidateQueries({ queryKey: listsKeys.detail(made.id) })
      void qc.invalidateQueries({ queryKey: listsKeys.collections() })
      void qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
    },
  })

  // Step 2 shows its draft — and stays up, locked, while Save writes and
  // while it leaves (even if the OS gesture stepped back meanwhile).
  const showStep2 = draft !== null && (onStep2 || save.isPending || leavingStep2)

  // Opened on step 1 again or step 2 (a reload, a link, Forward): no draft
  // to show — back to New list's first entry, step 1. Back through history
  // when that entry is behind, so it isn't left there twice.
  const settled = React.useRef(false)
  React.useEffect(() => {
    if (settled.current) return
    settled.current = true
    if (depth === 0) return
    const behind = pathBehind()
    if (appEntryBehind(depth) && (behind === null || behind === NEW_LIST_PATH)) window.history.go(-depth)
    else window.history.replaceState(null, '', newListStartHref(params))
    // Mount only: this settles the entry the page loaded on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Back on step 1: a name changed in step 2's header comes back with it.
  const [wasStep2, setWasStep2] = React.useState(showStep2)
  if (wasStep2 !== showStep2) {
    setWasStep2(showStep2)
    if (!showStep2 && draft && listTitleSchema.safeParse(draft.title).success) d.setTitle(draft.title)
  }

  // The OS gesture (or the browser's Back) down to New list's first entry,
  // with a draft: ask before the players go, or carry on out (✕'s way).
  // Not while Save writes: step 2 stays up, and Save leaves from wherever
  // the gesture got to.
  const [prevDepth, setPrevDepth] = React.useState(depth)
  if (prevDepth !== depth) {
    setPrevDepth(depth)
    const stray = newListStrayBack(prevDepth, depth, { draft, leaving: exit !== null || save.isPending })
    if (stray === 'ask') setCaught(true)
    else if (stray === 'leave') setExit({ kind: 'close' })
  }
  React.useEffect(() => {
    if (!caught) return
    setCaught(false)
    window.history.pushState(null, '', newListStepHref(window.location.search, 1))
    setConfirmClose(true)
  }, [caught])

  // Leaving: once the URL is back on New list's first entry, it's replaced
  // by where we go — or, for ✕, left the usual way (where you came from).
  const exited = React.useRef(false)
  React.useEffect(() => {
    if (!exit || exit.kind === 'gone' || depth > 0 || exited.current) return
    exited.current = true
    if (exit.kind === 'to') router.replace(exit.href)
    else nav.closeNew()
  }, [exit, depth, router, nav])

  // A reload or tab close would drop the players step 2 added.
  const holdsPlayers = newListCloseAsks(draft) && exit === null
  React.useEffect(() => {
    if (!holdsPlayers) return
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [holdsPlayers])

  /** Next: on to step 2, keeping whatever an earlier step 2 held. From New
   *  list's first entry, step 1 again goes under it (see the doc above). */
  const next = () => {
    const title = listTitleSchema.safeParse(d.title)
    if (!title.success || !detailsReady(d)) return
    setDraft((kept) => stepTwoDraft(kept, title.data))
    if (liveDepth() === 0) window.history.pushState(null, '', newListStepHref(params, 1))
    window.history.pushState(null, '', newListStepHref(params, 2))
  }

  /** Leave New list for `href`, in its place: back to its first entry,
   *  which the effect above then replaces. */
  const leave = (href: string) => {
    setExit({ kind: 'to', href })
    const above = liveDepth()
    if (above > 0) window.history.go(-above)
  }

  /** ✕, or Discard: leave without a list, to where New list came from. */
  const close = () => {
    const above = liveDepth()
    if (above === 0) {
      nav.closeNew()
      return
    }
    setExit({ kind: 'close' })
    window.history.go(-above)
  }

  /** Step 2's Back: step 1, draft kept — the entry Next pushed. Once a Save
   *  has made the list, it's that list's editor: its List view. */
  const backFromStep2 = () => {
    if (created.current) leave(listHref(created.current.id, from === 'grid' ? 'grid' : undefined))
    else window.history.back()
  }

  const saved = () => {
    const made = created.current
    if (!made) return
    toast(createdToast(made))
    carryListSession(draftKey, made.id)
    if (from === 'community') {
      refreshCommunity(qc)
      if (nav.returnToCommunity(liveDepth() + 1)) setExit({ kind: 'gone' })
      else leave(COMMUNITY_HREF)
      return
    }
    leave(listHref(made.id, from === 'grid' ? 'grid' : undefined))
  }

  const commit: EditorCommit = {
    mutate: (current, callbacks) => save.mutate(current, callbacks),
    isPending: save.isPending || leavingStep2,
  }

  return (
    <>
      {showStep2 && draft ? (
        <NewListEditor
          draftKey={draftKey}
          title={draft.title}
          positionFilter={d.team || d.position === 'ALL' ? null : d.position}
          draft={draft}
          exists={exists}
          commit={commit}
          currentWeek={currentWeek}
          onDraftChange={setDraft}
          onBack={backFromStep2}
          onSaved={saved}
        />
      ) : (
        <DetailsForm
          mode="new"
          list={null}
          d={d}
          onClose={() => (newListCloseAsks(draft) ? setConfirmClose(true) : close())}
          onNext={next}
        />
      )}
      <DiscardSheet
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard this list?"
        subtitle="The players you added haven’t been saved."
        detail="Leaving now drops this list and the players you added."
        onDiscard={close}
      />
    </>
  )
}

/** How New list is leaving: for `href` in its place (Save), without a list
 *  (✕, Discard), or already gone (back to Community, which opened it). */
type NewListExit = { kind: 'to'; href: string } | { kind: 'close' } | { kind: 'gone' }

/** New list's path, to tell its own entries from the screen behind it. */
const NEW_LIST_PATH = '/app/lists/new'

/** New list's entries above its first, as the address has them now — a
 *  Back taken while Save wrote may not have rendered yet. */
function liveDepth(): 0 | 1 | 2 {
  if (window.location.pathname !== NEW_LIST_PATH) return 0
  return newListDepth(new URLSearchParams(window.location.search).get(NEW_LIST_STEP_PARAM))
}

export function ListDetailsScreen({ listId }: { listId: string }) {
  const nav = useListsNav()
  const detail = useList(listId)
  const list = detail.data
  if (!list) {
    return (
      <Frame>
        <Header title="Edit details" step="" onClose={() => nav.closeEdit(listId)} />
        {detail.isError ? (
          <CenterNote
            title="This list could not be loaded."
            body={detail.error.message}
            action={<PillButton onClick={() => void detail.refetch()}>Try again</PillButton>}
          />
        ) : (
          <div className="flex flex-col gap-[18px] p-4" aria-busy="true" aria-label="Loading list">
            <div className="h-9 w-3/4 animate-pulse rounded-md bg-m-b1" />
            <div className="h-[74px] animate-pulse rounded-xl bg-m-b1" />
          </div>
        )}
      </Frame>
    )
  }
  if (!list.is_owner) {
    return (
      <Frame>
        <Header title="Edit details" step="" onClose={() => nav.closeEdit(listId)} />
        <CenterNote title="Only the owner can edit this list." />
      </Frame>
    )
  }
  return <EditDetails list={list} />
}

function EditDetails({ list }: { list: ListWithDetails }) {
  const nav = useListsNav()
  const d = useDetailsDraft(list)
  return <DetailsForm mode="edit" list={list} d={d} onClose={() => nav.closeEdit(list.id)} />
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] leading-[normal] text-m-t1 tabular-nums" data-mobile-screen>
      {children}
    </div>
  )
}

function Header({ title, step, onClose }: { title: string; step: string; onClose: () => void }) {
  return (
    <div className="flex h-[52px] flex-none items-center gap-2 border-b border-m-b3 px-3">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex size-9 flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2"
      >
        <MIcon name="close" size={14} stroke={2.2} />
      </button>
      <span className="flex-1 text-center text-[16px] font-semibold text-m-t1">{title}</span>
      <span className="w-9 flex-none text-right text-[12px] font-semibold text-m-t3">{step}</span>
    </div>
  )
}

/**
 * The details form's draft. New list keeps it across its two steps (so Back
 * from step 2 finds it as it was); Edit details, for its own life.
 */
function useDetailsDraft(list: ListWithDetails | null) {
  // The links as the form opened: Done changes only what was changed HERE,
  // so a video attached elsewhere meanwhile (a refetch) is never removed.
  const [openedLinks] = React.useState(() => list?.links ?? [])
  const [title, setTitle] = React.useState(list?.title ?? '')
  const [desc, setDesc] = React.useState(list?.description ?? '')
  const [thumb, setThumb] = React.useState<'collage' | 'upload'>(list?.thumbnail_url ? 'upload' : 'collage')
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<string | null>(null)
  const [isPublic, setIsPublic] = React.useState(!list?.is_private)
  const [videos, setVideos] = React.useState<VideoDraft[]>(() => videoDraftsOf(openedLinks))
  const [link, setLink] = React.useState('')
  const [linkProblem, setLinkProblem] = React.useState<AddVideoProblem | null>(null)
  const [tags, setTags] = React.useState<string[]>(list?.tags.map((t) => t.name) ?? [])
  const [position, setPosition] = React.useState(positionGroupValue(list?.position_filter))
  const [coverColor, setCoverColor] = React.useState<CoverColor | null>(coverColorOf(list))
  const [team, setTeam] = React.useState(Boolean(list?.is_team))
  const [roster, setRoster] = React.useState<RosterDraft>(() =>
    list?.is_team ? rosterDraftOf(list.roster_settings) : DEFAULT_TEAM_ROSTER,
  )
  const [tagText, setTagText] = React.useState('')

  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  return {
    openedLinks,
    title,
    setTitle,
    desc,
    setDesc,
    thumb,
    setThumb,
    file,
    setFile,
    preview,
    setPreview,
    isPublic,
    setIsPublic,
    videos,
    setVideos,
    link,
    setLink,
    linkProblem,
    setLinkProblem,
    tags,
    setTags,
    position,
    setPosition,
    coverColor,
    setCoverColor,
    team,
    setTeam,
    roster,
    setRoster,
    tagText,
    setTagText,
  }
}

type DetailsDraftState = ReturnType<typeof useDetailsDraft>

/** Whether the form can move on: a name, and for a team a roster that saves. */
function detailsReady(d: Pick<DetailsDraftState, 'title' | 'team' | 'roster'>): boolean {
  return listTitleSchema.safeParse(d.title).success && (!d.team || rosterValid(d.roster))
}

/** Done's (and Save's) video calls, for `saveVideoChanges` (which pins their order). */
function useVideoSaveIO(): VideoSaveIO {
  const qc = useQueryClient()
  return React.useMemo(
    () => ({
      del: async (listId, linkId) => {
        const res = await fetch(`/api/lists/${listId}/links/${linkId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(VIDEO_REMOVE_FAILED)
      },
      post: async (listId, body) => {
        const res = await fetch(`/api/lists/${listId}/links`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {
          throw new Error(VIDEO_ATTACH_FAILED)
        })
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? VIDEO_ATTACH_FAILED)
      },
      // The title the row showed, from the same lookup (`useYouTubeTitle`).
      titleOf: (yt) => qc.getQueryData<string | null>(youTubeTitleKey(yt)),
    }),
    [qc],
  )
}

function DetailsForm({
  mode,
  list,
  d,
  onClose,
  onNext,
}: {
  mode: 'new' | 'edit'
  list: ListWithDetails | null
  d: DetailsDraftState
  onClose: () => void
  /** New list's Next: on to step 2 — nothing is saved yet. */
  onNext?: () => void
}) {
  const nav = useListsNav()
  const qc = useQueryClient()
  const updateList = useUpdateList(list?.id ?? '')
  const thumbnail = useMobileListsThumbnail()
  const videoIO = useVideoSaveIO()
  const fileRef = React.useRef<HTMLInputElement | null>(null)
  const {
    openedLinks,
    title,
    setTitle,
    desc,
    setDesc,
    thumb,
    setThumb,
    file,
    setFile,
    preview,
    setPreview,
    isPublic,
    setIsPublic,
    videos,
    setVideos,
    link,
    setLink,
    linkProblem,
    setLinkProblem,
    tags,
    setTags,
    position,
    setPosition,
    coverColor,
    setCoverColor,
    team,
    setTeam,
    roster,
    setRoster,
    tagText,
    setTagText,
  } = d
  const videoMax = maxVideos(list?.links ?? openedLinks)
  const [busy, setBusy] = React.useState(false)

  const valid = detailsReady(d)
  // Swatches only once `lists.cover_color` exists (main deploys before the
  // migration is pushed): a loaded row proves it; a new list asks.
  const colourProbe = useListCoverColorSupport(mode === 'new')
  const coloursReady = mode === 'edit' ? hasCoverColorColumn(list) : colourProbe.data === true
  // A team has no position group, so its cover shows the default colour.
  const positionFilter = team || position === 'ALL' ? null : position
  const showPosition = !team
  const close = onClose

  const attach = () => {
    const result = addVideo(videos, link, videoMax)
    if (!result.ok) {
      setLinkProblem(result.problem)
      return
    }
    setVideos(result.videos)
    setLink('')
  }

  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    // Reset so picking the same file again still fires (lr-lists gap 22).
    event.target.value = ''
    if (!picked) return
    const problem = thumbnailProblem(picked)
    if (problem) {
      toast({ title: 'That image can’t be a cover', description: problem })
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setFile(picked)
    setPreview(URL.createObjectURL(picked))
    setThumb('upload')
  }

  const addTag = () => {
    const parsed = tagNameSchema.safeParse(tagText)
    if (!parsed.success) {
      if (tagText.trim()) toast({ title: 'That tag can’t be used', description: parsed.error.issues[0]?.message })
      return
    }
    if (!tags.some((t) => t.toLowerCase() === parsed.data.toLowerCase()) && tags.length < MAX_TAGS_PER_LIST) {
      setTags([...tags, parsed.data])
    }
    setTagText('')
  }

  /** One toast for what went wrong with the videos (only one shows at a time). */
  const videoFailureToast = (failures: readonly string[], saved: string) =>
    toast({
      title: `${saved}, but ${failures.length === 1 ? 'a video' : `${failures.length} videos`} didn’t update`,
      description: failures[0],
    })

  const submit = async () => {
    const parsed = listTitleSchema.safeParse(title)
    if (!parsed.success || !valid || busy) return
    // New list's Next saves nothing: the editor's Save makes the list.
    if (mode === 'new') return onNext?.()
    setBusy(true)
    try {
      const draft = { title: parsed.data, desc, position, coverColor, coloursReady, team, roster, isPrivate: !isPublic }
      const current = list!
      const patch = detailsPatch(current, { ...draft, tags })
      if (Object.keys(patch).length > 0) await updateList.mutateAsync(patch)
      if (file && thumb === 'upload') await thumbnail.mutateAsync({ listId: current.id, file })
      const changes = videoChanges(openedLinks, videos)
      let failures: string[] = []
      if (changes.remove.length > 0 || changes.add.length > 0) {
        try {
          failures = await saveVideoChanges(current.id, changes, videoIO)
        } finally {
          qc.invalidateQueries({ queryKey: listsKeys.detail(current.id) })
        }
      }
      if (failures.length > 0) videoFailureToast(failures, 'List saved')
      else toast({ title: 'List saved' })
      nav.closeEdit(current.id)
    } catch (error) {
      toast({
        title: 'Could not save the details',
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  // An uploaded cover can't be cleared in the app (no route clears
  // `thumbnail_url`), so Edit details can replace it but not go back to the
  // collage.
  const collageLocked = mode === 'edit' && Boolean(list?.thumbnail_url)
  const uploadSrc = preview ?? list?.thumbnail_url ?? null

  const tiles: Array<{
    id: 'collage' | 'upload'
    label: string
    icon: LIconName
    disabled?: boolean
    onClick: () => void
  }> = [
    { id: 'collage', label: 'Player collage', icon: 'collage', disabled: collageLocked, onClick: () => setThumb('collage') },
    { id: 'upload', label: 'Upload image', icon: 'upload', onClick: () => fileRef.current?.click() },
  ]

  return (
    <Frame>
      <Header title={mode === 'new' ? 'New list' : 'Edit details'} step={mode === 'new' ? '1 of 2' : ''} onClose={close} />
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-4 scrollbar-none">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          // Return moves on once the list has a name (gap list §3 #7): the
          // keyboard's key reads Next on New list and Done in Edit details.
          enterKeyHint={mode === 'new' ? 'next' : 'done'}
          onKeyDown={(event) => {
            const key = { key: event.key, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode }
            if (!nameReturnMovesOn(key, valid && !busy)) return
            event.preventDefault()
            void submit()
          }}
          maxLength={MAX_TITLE_LEN}
          placeholder="List name, like My top 5 QBs for Week 6"
          aria-label="List name"
          className="flex-none border-b-[1.5px] border-m-b3s bg-transparent pb-2.5 pt-1 text-[22px] font-bold tracking-[-0.02em] text-m-t1 outline-none placeholder:text-m-t3"
        />
        <textarea
          value={desc}
          onChange={(event) => setDesc(event.target.value)}
          maxLength={MAX_DESCRIPTION_LEN}
          rows={3}
          placeholder="Add a description"
          aria-label="Description"
          className="flex-none resize-none rounded-xl bg-m-b1 p-3 text-[14px] font-medium leading-[1.4] text-m-t1 outline-none placeholder:text-m-t3"
        />

        <PublicRow on={isPublic} onToggle={() => setIsPublic(!isPublic)} />

        {mode === 'new' && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-m-t3">Type</span>
            <MSegmented
              label="Type"
              options={[
                { value: 'list', label: 'List' },
                { value: 'team', label: 'Team' },
              ]}
              value={team ? 'team' : 'list'}
              onChange={(next) => setTeam(next === 'team')}
            />
            {team && (
              <span className="text-[11px] font-medium text-m-t3">A roster with starters, bench and IR slots.</span>
            )}
          </div>
        )}

        {team && <RosterSteppers roster={roster} onChange={setRoster} />}

        {showPosition && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-m-t3">Position group</span>
            <MSegmented
              label="Position group"
              options={POSITION_GROUP_OPTIONS}
              value={position}
              onChange={setPosition}
              itemClassName="px-0 text-[12px]"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-m-t3">Thumbnail</span>
          <div className="grid grid-cols-3 gap-2">
            {tiles.map((tile) => {
              const on = thumb === tile.id
              const showImg = tile.id === 'upload' && uploadSrc
              return (
                <button
                  key={tile.id}
                  type="button"
                  onClick={tile.onClick}
                  disabled={tile.disabled}
                  aria-pressed={on}
                  className="flex flex-col gap-[5px] disabled:opacity-40"
                >
                  <span
                    className={cn(
                      'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl',
                      tile.id === 'collage'
                        ? cn(coverBgClass(positionFilter, coloursReady ? coverColor : null), 'text-white')
                        : 'bg-m-b2 text-m-t3',
                      on && 'ring-2 ring-accent ring-offset-2 ring-offset-m-b0',
                    )}
                  >
                    {showImg ? <CoverImage src={uploadSrc} /> : <LIcon name={tile.icon} size={22} />}
                  </span>
                  <span className="text-center text-[11px] font-semibold text-m-t2">{tile.label}</span>
                </button>
              )
            })}
          </div>
          {coloursReady && thumb === 'collage' && (
            <CoverSwatches value={coverColor} onChange={setCoverColor} isTeam={team} />
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={pickFile}
            className="hidden"
            tabIndex={-1}
            aria-hidden
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-m-t3">Videos</span>
          {videos.length < videoMax ? (
            <div className="flex gap-2">
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-m-b2 px-3">
                <YouTubeBadge />
                <input
                  value={link}
                  onChange={(event) => {
                    setLink(event.target.value)
                    setLinkProblem(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') attach()
                  }}
                  inputMode="url"
                  placeholder="Paste a YouTube link"
                  aria-label="YouTube link"
                  className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-m-t1 outline-none placeholder:text-m-t3"
                />
              </label>
              <button
                type="button"
                onClick={attach}
                className={cn(
                  'flex h-10 flex-none items-center rounded-xl px-3.5 text-[13px] font-semibold',
                  link.trim() ? 'bg-m-ink text-white' : 'bg-m-b3s text-m-t3',
                )}
              >
                Add
              </button>
            </div>
          ) : (
            <span className="text-[12px] font-medium text-m-t3">{videosFullNote(videoMax)}</span>
          )}
          {linkProblem && (
            <span className="text-[11px] font-medium text-m-red">{ADD_VIDEO_PROBLEM[linkProblem]}</span>
          )}
          {videos.map((video) => (
            <VideoRow
              key={video.linkId ?? video.yt}
              video={video}
              onRemove={() => {
                setVideos(videos.filter((v) => v !== video))
                setLinkProblem(null)
              }}
            />
          ))}
        </div>

        {mode === 'edit' && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-m-t3">Tags</span>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="flex h-7 items-center gap-0.5 rounded-pill bg-m-b2 pl-2.5 pr-1 text-[12px] font-semibold text-m-t1">
                    #{tag}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
                      aria-label={`Remove tag ${tag}`}
                      className="flex size-5 items-center justify-center rounded-full text-m-t3"
                    >
                      <MIcon name="close" size={9} stroke={2.6} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {tags.length < MAX_TAGS_PER_LIST && (
              <input
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault()
                    addTag()
                  }
                }}
                onBlur={addTag}
                maxLength={20}
                placeholder="Add a tag"
                aria-label="Add a tag"
                className="h-10 rounded-xl bg-m-b2 px-3 text-[14px] font-medium text-m-t1 outline-none placeholder:text-m-t3"
              />
            )}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-m-b2 px-4 pb-[max(30px,env(safe-area-inset-bottom))] pt-2.5">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || busy}
          className={cn(
            'flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-semibold',
            valid ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b3s text-m-t3',
          )}
        >
          {busy ? 'Saving…' : mode === 'new' ? 'Next: add players' : 'Done'}
        </button>
      </div>
    </Frame>
  )
}

/**
 * The Public switch (m-composer §2.5 "Public row"): the whole row is the
 * switch — "Public" 14/600 over its one-line meaning (11/500 t3), the 44×26
 * switch at the end. "Follow" in the design's line became "save": a list can
 * be saved, not followed.
 */
function PublicRow({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="flex flex-none items-center gap-2.5 text-left">
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[14px] font-semibold text-m-t1">Public</span>
        <span className="text-[11px] font-medium text-m-t3">
          {on ? 'Anyone can find and save this list' : 'Only you can see this list'}
        </span>
      </span>
      <MSwitch on={on} size="md" />
    </button>
  )
}

/**
 * An attached video (m-composer §2.5 "Video rows"): the 96×54 YouTube
 * thumbnail on ink, the title, the link (11/500 t3, one line), and a 32px
 * remove. The title is the stored one for a video already on the list, or —
 * for a pasted one — YouTube's own, looked up as it is pasted. No title =
 * no title line (never a placeholder).
 */
function VideoRow({ video, onRemove }: { video: VideoDraft; onRemove: () => void }) {
  const lookup = useYouTubeTitle(video.linkId || !video.yt ? null : video.yt)
  const title = video.linkId ? (video.title ?? null) : (lookup.data ?? null)
  return (
    <div className="flex items-center gap-2.5" data-video-row>
      <span className="relative h-[54px] w-24 flex-none overflow-hidden rounded-md bg-m-ink">
        {video.yt ? <CoverImage src={youTubeThumb(video.yt)} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        {title ? <span className="truncate text-[13px] font-semibold text-m-t1">{title}</span> : null}
        <span className="truncate text-[11px] font-medium text-m-t3">{video.url}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={title ? `Remove ${title}` : 'Remove video'}
        className="flex size-8 flex-none items-center justify-center rounded-full text-m-t3 active:bg-m-b2"
      >
        <MIcon name="close" size={14} stroke={2} />
      </button>
    </div>
  )
}

/**
 * A team list's roster (desktop's Roster fields, gap list §3 #3): a 3×3 grid
 * of slot steppers on b1 cards, then the total. A stepper that would leave
 * the API's bounds (0–20 a slot, 60 in all) is off, so the roster can't be
 * pushed past what saves; an empty roster keeps the button off until a slot
 * is filled.
 */
function RosterSteppers({ roster, onChange }: { roster: RosterDraft; onChange: (next: RosterDraft) => void }) {
  const total = rosterTotal(roster)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-m-t3">Roster</span>
      <div className="grid grid-cols-3 gap-2">
        {ROSTER_SLOTS.map(({ key, label }) => {
          const n = roster[key]
          return (
            <div key={key} className="flex flex-col gap-1.5 rounded-xl bg-m-b1 px-2 pb-2 pt-1.5" data-roster-slot={key}>
              <span className="text-[11px] font-semibold text-m-t3">{label}</span>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label={`Fewer ${label}`}
                  disabled={n <= 0}
                  onClick={() => onChange(stepRoster(roster, key, -1))}
                  className="flex size-7 items-center justify-center rounded-full bg-m-b0 text-m-t1 active:bg-m-b2 disabled:opacity-40"
                >
                  <LIcon name="minus" size={12} stroke={2.2} />
                </button>
                <span className="text-[15px] font-semibold tabular-nums text-m-t1">{n}</span>
                <button
                  type="button"
                  aria-label={`More ${label}`}
                  disabled={n >= MAX_SLOT || total >= MAX_ROSTER}
                  onClick={() => onChange(stepRoster(roster, key, 1))}
                  className="flex size-7 items-center justify-center rounded-full bg-m-b0 text-m-t1 active:bg-m-b2 disabled:opacity-40"
                >
                  <LIcon name="plus" size={12} stroke={2.2} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <span className="text-[12px] font-medium text-m-t3">
        {total === 0 ? 'Add at least one slot' : `${total} ${total === 1 ? 'player' : 'players'} in all`}
      </span>
    </div>
  )
}

/**
 * The six cover colours (lr-lists §2.2 "Colour swatches"): 24px circles, gap
 * 8, padding-top 2; the chosen one ringed `0 0 0 2px <page>, 0 0 0 3.5px
 * <its colour>` (a 2px page-colour offset plus a 1.5px ring). The tap area
 * reaches the README's 30px without growing the circle (as lr-lists gap 32).
 * Tapping the chosen colour again clears it — the cover then follows the
 * position group, which the line underneath says. A team list has no position
 * group (its control is hidden), so for one the line says "the default
 * colour" — the accent its cover falls back to.
 */
function CoverSwatches({
  value,
  onChange,
  isTeam,
}: {
  value: CoverColor | null
  onChange: (next: CoverColor | null) => void
  isTeam: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      <div role="group" aria-label="Cover colour" className="flex gap-2">
        {COVER_SWATCHES.map((swatch) => {
          const on = value === swatch.key
          return (
            <button
              key={swatch.key}
              type="button"
              aria-pressed={on}
              aria-label={swatch.label}
              onClick={() => onChange(on ? null : swatch.key)}
              className={cn(
                "relative size-6 flex-none rounded-full after:absolute after:-inset-[3px] after:content-['']",
                swatch.bg,
                on && cn('ring-[1.5px] ring-offset-2 ring-offset-m-b0', swatch.ring),
              )}
            />
          )
        })}
      </div>
      <span className="text-[11px] font-medium text-m-t3">{coverSwatchHint(value !== null, isTeam)}</span>
    </div>
  )
}

/** The line under the swatches: what "no colour" means for this list. */
function coverSwatchHint(chosen: boolean, isTeam: boolean): string {
  if (isTeam) return chosen ? 'Tap it again to go back to the default colour' : 'Uses the default colour until you pick one'
  return chosen ? 'Tap it again to follow the position group' : 'Follows the position group until you pick one'
}
