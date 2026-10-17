'use client'

import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { rosterTotal, type RosterDraft } from '@/components/lists/list-form-payload'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { MSwitch } from '@/components/mobile/trades/m-overlay'
import { useListCoverColorSupport } from '@/hooks/use-list-cover-color-support'
import { listsKeys, useCreateList, useList, useUpdateList, type ListWithDetails } from '@/hooks/use-lists'
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
  addVideo,
  detailsCreateInput,
  detailsPatch,
  maxVideos,
  rosterDraftOf,
  rosterValid,
  stepRoster,
  videoChanges,
  videoDraftsOf,
  videosFullNote,
  type AddVideoProblem,
  type VideoDraft,
} from './details-payload'
import {
  COVER_SWATCHES,
  POSITION_GROUP_OPTIONS,
  coverBgClass,
  positionGroupValue,
  youTubeThumb,
} from './lists-model'
import { useListsNav } from './lists-nav'
import { CenterNote, CoverImage, LIcon, PillButton, YouTubeBadge, type LIconName } from './lists-parts'

/**
 * FieldScout Mobile — New list, step 1 (lr-lists §2.2, states L3–L3h), and its
 * "Edit details" variant (L3x — unreachable in the prototype; here it opens
 * from a list's options).
 *
 * Name, description, thumbnail and video, then "Next: add players" creates
 * the list (the app needs it to exist before a player can be added) and opens
 * the editor with Add players up. Carried from the app: the cover upload goes
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
 * Left out, a lr-lists gap: the "Video frame" thumbnail (only an uploaded
 * image can be stored as a cover). The Next button is disabled until the list
 * has a name rather than tappable with a toast ("prevent, don't refuse").
 */

export function NewListScreen() {
  return <DetailsForm mode="new" list={null} />
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
  return <DetailsForm mode="edit" list={list} />
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

function DetailsForm({ mode, list }: { mode: 'new' | 'edit'; list: ListWithDetails | null }) {
  const nav = useListsNav()
  const qc = useQueryClient()
  const createList = useCreateList()
  const updateList = useUpdateList(list?.id ?? '')
  const thumbnail = useMobileListsThumbnail()
  const fileRef = React.useRef<HTMLInputElement | null>(null)

  // The links as the form opened: Done changes only what was changed HERE,
  // so a video attached elsewhere meanwhile (a refetch) is never removed.
  const [openedLinks] = React.useState(() => list?.links ?? [])
  const videoMax = maxVideos(list?.links ?? openedLinks)
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
  const [busy, setBusy] = React.useState(false)

  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  const valid = listTitleSchema.safeParse(title).success && (!team || rosterValid(roster))
  // Swatches only once `lists.cover_color` exists (main deploys before the
  // migration is pushed): a loaded row proves it; a new list asks.
  const colourProbe = useListCoverColorSupport(mode === 'new')
  const coloursReady = mode === 'edit' ? hasCoverColorColumn(list) : colourProbe.data === true
  // A team has no position group, so its cover shows the default colour.
  const positionFilter = team || position === 'ALL' ? null : position
  const showPosition = !team
  const close = () => (mode === 'new' ? nav.closeNew() : nav.closeEdit(list!.id))

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

  const postVideo = (listId: string, draft: VideoDraft) => {
    // The title the row showed — YouTube's own, from the same lookup. None
    // (still loading, or YouTube gave none) = none is sent: the server then
    // looks it up itself, and stores no title rather than a placeholder
    // (gap list #11).
    const shown = qc.getQueryData<string | null>(youTubeTitleKey(draft.yt))
    return fetch(`/api/lists/${listId}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'video', url: draft.url, ...(shown ? { title: shown } : {}) }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not attach the video.')
    })
  }

  /**
   * The video work: removals first, then the new ones in order (one at a
   * time — each lands at the end). Every failure is kept and handed back to be
   * reported, never swallowed; the rest still go ahead.
   */
  const saveVideos = async (listId: string, remove: readonly string[], add: readonly VideoDraft[]) => {
    const failures: string[] = []
    for (const linkId of remove) {
      const res = await fetch(`/api/lists/${listId}/links/${linkId}`, { method: 'DELETE' }).catch(() => null)
      if (!res?.ok) failures.push('A video could not be removed.')
    }
    for (const draft of add) {
      await postVideo(listId, draft).catch((error: Error) => failures.push(error.message))
    }
    return failures
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
    setBusy(true)
    try {
      const draft = { title: parsed.data, desc, position, coverColor, coloursReady, team, roster, isPrivate: !isPublic }
      if (mode === 'new') {
        const created = await createList.mutateAsync(detailsCreateInput(draft))
        if (file && thumb === 'upload') {
          await thumbnail.mutateAsync({ listId: created.id, file }).catch((error: Error) =>
            toast({ title: 'The cover image didn’t upload', description: error.message }),
          )
        }
        const failures = videos.length > 0 ? await saveVideos(created.id, [], videos) : []
        if (failures.length > 0) videoFailureToast(failures, 'List created')
        qc.invalidateQueries({ queryKey: listsKeys.detail(created.id) })
        nav.createdList(created.id)
        return
      }

      const current = list!
      const patch = detailsPatch(current, { ...draft, tags })
      if (Object.keys(patch).length > 0) await updateList.mutateAsync(patch)
      if (file && thumb === 'upload') await thumbnail.mutateAsync({ listId: current.id, file })
      const changes = videoChanges(openedLinks, videos)
      let failures: string[] = []
      if (changes.remove.length > 0 || changes.add.length > 0) {
        try {
          failures = await saveVideos(current.id, changes.remove, changes.add)
        } finally {
          qc.invalidateQueries({ queryKey: listsKeys.detail(current.id) })
        }
      }
      if (failures.length > 0) videoFailureToast(failures, 'List saved')
      else toast({ title: 'List saved' })
      nav.closeEdit(current.id)
    } catch (error) {
      toast({
        title: mode === 'new' ? 'Could not create the list' : 'Could not save the details',
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
            <span className="text-[11px] font-medium text-negative-strong">{ADD_VIDEO_PROBLEM[linkProblem]}</span>
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
          {busy ? (mode === 'new' ? 'Creating…' : 'Saving…') : mode === 'new' ? 'Next: add players' : 'Done'}
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
