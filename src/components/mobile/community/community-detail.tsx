'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { FollowButton } from '@/components/explore/follow-button'
import { AuthorAvatar, ListCover } from '@/components/mobile/community/community-cards'
import {
  classifyCommunityList,
  effectiveScoringFormat,
  formatFollows,
  playerMeta,
  SCORING_FORMAT_LABEL,
  scoringFormatOf,
  type CommunityScoring,
} from '@/components/mobile/community/community-ops'
import { ListActions } from '@/components/mobile/community/list-actions'
import { ReportRow, ReportSheet } from '@/components/mobile/community/report-sheet'
import { ListAiAttribution } from '@/components/mobile/lists/list-ai-attribution'
import { tierChipClass, viewSections, youTubeId, youTubeThumb } from '@/components/mobile/lists/lists-model'
import { LIcon, SlimBar, YouTubeBadge } from '@/components/mobile/lists/lists-parts'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { M_PROJ_TEXT, SEASON_PROJ_LABEL } from '@/components/players/projected-points'
import { reportAccess } from '@/components/report/report-ops'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import { useListPersona } from '@/hooks/use-list-persona'
import { useList, type ListPlayerWithPlayer, type ListWithDetails } from '@/hooks/use-lists'
import { useMobileCommunityListMeta } from '@/hooks/use-mobile-community-detail'
import { useMobileListsCoverPassed } from '@/hooks/use-mobile-lists-cover-passed'
import type { CommunityPlayer, CommunityVideo } from '@/hooks/use-mobile-community-feed'
import { featureFlags } from '@/lib/feature-flags'
import { hasTiers, isNumbered } from '@/lib/lists/ranking-mode'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { useReportedStore, wasReported } from '@/stores/reported-store'

/**
 * FieldScout Mobile — Community list detail (handoff m-community §2.14, D).
 * A full-screen page over the feed (`/app/explore?list=<id>`): it covers the
 * dock; Back floats on the 230px cover and scrolls away with it — then kind
 * pill, title, author + Follow, description, Save / Share, the Videos shelf
 * and the players. Once the cover has scrolled off, the List view's slim
 * Back · title bar (`SlimBar`, gap list #25) takes over at the top, so Back
 * never scrolls out of reach on a long list (plan C7, readiness S16). On
 * someone else's list the cover's top right has a ⋯ (the List view's), and
 * so does the slim bar: its sheet holds Report (plan C10). A
 * ranking (big board, weekly board, AI expert's board) is the handoff's
 * ranking variant ("Ranking · PPR", "Ranked players · N", always the collage
 * cover). The players carry
 * 1-2-3 numbers only when the list is numbered (`isNumbered` — not a Basic
 * or tier-only list), and sit under "Tier N" headings when it has tiers
 * (`hasTiers`) — as the phone's own List view draws them.
 *
 * A modal dialog (Radix): it's named by the list, Escape goes Back, focus is
 * trapped inside — the feed and the dock under it are hidden from keyboards
 * and screen readers — and on close focus returns to the card that opened it.
 * `onBack` goes back to where you came from (gap list #27 — the feed, or the
 * screen that linked here).
 */
export function CommunityDetail({ listId, onBack }: { listId: string; onBack: () => void }) {
  const list = useList(listId)
  const backRef = useRef<HTMLButtonElement>(null)
  // What had focus before the page opened (the card, for a keyboard user) —
  // read during the first render, before the dialog moves focus.
  const [returnTo] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  )

  // Focus lands on Back when the page opens, and again when the loaded
  // page replaces the skeleton (its Back is a new element).
  const loaded = Boolean(list.data)
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true })
  }, [listId, loaded])

  const status = (list.error as (Error & { status?: number }) | null)?.status

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onBack()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] text-m-t1 outline-none"
          data-community-detail
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            backRef.current?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            if (returnTo && returnTo !== document.body && returnTo.isConnected) returnTo.focus({ preventScroll: true })
          }}
          // Full screen: nothing outside it to tap (a toast must not close it).
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {/* Loaded, the page's own 24px title names the dialog. */}
          {!list.data && <DialogPrimitive.Title className="sr-only">List</DialogPrimitive.Title>}
          <DetailScroll>
            {list.data ? (
              <DetailBody list={list.data} backRef={backRef} onBack={onBack} />
            ) : (
              <>
                <div className="relative h-[230px] bg-m-b1">
                  <BackOnCover buttonRef={backRef} onBack={onBack} />
                </div>
                {list.isError ? (
                  <div className="flex flex-col items-center gap-[10px] px-4 py-12 text-center">
                    <p className="text-pretty text-[14px] font-medium leading-[1.4] text-m-t3">
                      {status === 404
                        ? 'This list isn’t available. It may have been deleted or made private.'
                        : 'Couldn’t load this list.'}
                    </p>
                    {/* Back may lead somewhere other than Community (it goes
                        where you came from), so the action says "Go back". */}
                    <button
                      type="button"
                      onClick={() => (status === 404 ? onBack() : void list.refetch())}
                      className="text-[14px] font-semibold text-accent"
                    >
                      {status === 404 ? 'Go back' : 'Try again'}
                    </button>
                  </div>
                ) : (
                  <DetailSkeleton />
                )}
              </>
            )}
          </DetailScroll>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function DetailScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(32px+env(safe-area-inset-bottom))] scrollbar-none">
      {children}
    </div>
  )
}

/**
 * An AI expert's board says what it is right under its author (plan C8,
 * readiness F2): one Scout AI line — Home's "Scout AI · AI experts" label,
 * blue dot and all. The full "Generated by FieldScout AI as …" line stays
 * under the players (`ListAiAttribution`). The same read decides both: a
 * switched-off expert's board (`null`) has neither, as on the share page;
 * until the expert is read — or if it can't be — the line still shows.
 */
function ScoutAiNote({ personaId }: { personaId: string }) {
  const persona = useListPersona(personaId)
  if (persona.data === null) return null
  return (
    <p className="-mt-1 flex items-center gap-1.5 text-[11px] font-semibold leading-[14px] text-m-t3" data-scout-ai-note>
      <span className="size-1.5 flex-none rounded-full bg-accent" aria-hidden />
      <span className="min-w-0 truncate">Scout AI · An AI expert’s ranking, made by FieldScout AI</span>
    </p>
  )
}

/** An AI expert's handle: its page is /personas/… (when that surface is
 *  on), never a person's profile. */
function PersonaHandle({ username }: { username: string }) {
  const handle = `@${username}`
  return featureFlags.personas ? <Link href={`/personas/${encodeURIComponent(username)}`}>{handle}</Link> : <>{handle}</>
}

/** The cover's ⋯ — the List view's, in the same place (top right). */
function OptionsOnCover({ onOptions }: { onOptions: () => void }) {
  return (
    <button
      type="button"
      onClick={onOptions}
      aria-label="List options"
      aria-haspopup="dialog"
      className="absolute right-3 top-[10px] flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white"
      data-cover-options
    >
      <LIcon name="dots" size={16} stroke={2.6} />
    </button>
  )
}

/**
 * The ⋯'s sheet on someone else's list (plan C10): Report — the Report
 * sheet, then "Reported". The page's own row already has Like, Comments,
 * Save and Share, so they aren't repeated here.
 */
function CommunityListOptions({
  list,
  open,
  onOpenChange,
}: {
  list: ListWithDetails
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [reportOpen, setReportOpen] = useState(false)
  const { user } = useAuth()
  const reportedMarks = useReportedStore((state) => state.reported)
  return (
    <>
      <MobileSheet bodyClassName="leading-[normal]" open={open} onOpenChange={onOpenChange} title="List options" subtitle={list.title} showClose>
        <div className="flex flex-col px-3 pb-2" data-community-list-options>
          <ReportRow
            type="list"
            reported={wasReported(reportedMarks, user?.id, 'list', list.id)}
            onReport={() => {
              onOpenChange(false)
              setReportOpen(true)
            }}
          />
        </div>
      </MobileSheet>
      <ReportSheet open={reportOpen} onOpenChange={setReportOpen} target={{ type: 'list', id: list.id }} quote={list.title} />
    </>
  )
}

function BackOnCover({ buttonRef, onBack }: { buttonRef: React.Ref<HTMLButtonElement>; onBack: () => void }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onBack}
      aria-label="Back"
      className="absolute left-3 top-[10px] flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white"
    >
      <MIcon name="back" size={18} stroke={2} />
    </button>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">
      <span className="h-5 w-12 animate-pulse rounded-pill bg-m-b1" />
      <span className="h-7 w-4/5 animate-pulse rounded-[14px] bg-m-b1" />
      <span className="h-[26px] w-1/2 animate-pulse rounded-[14px] bg-m-b1" />
      <span className="mt-3 h-12 animate-pulse rounded-[14px] bg-m-b1" />
      <span className="h-12 animate-pulse rounded-[14px] bg-m-b1" />
      <span className="h-12 animate-pulse rounded-[14px] bg-m-b1" />
    </div>
  )
}

function asCommunityPlayer(row: ListPlayerWithPlayer): CommunityPlayer {
  const p = row.player
  return { id: p.id, full_name: p.full_name, position: p.position, team: p.team, headshot_url: p.headshot_url }
}

/**
 * What the rows' projection is. The design draws this week's ("6.8"); the
 * app has only the season-long one for a whole list (`projected_pts_*`), so
 * the column says so (gap list §3 #29) — the same label as the phone Lists
 * column (`SEASON_PROJ_LABEL`).
 */
const PROJ_LABEL = SEASON_PROJ_LABEL

function projectionFor(row: ListPlayerWithPlayer, scoring: CommunityScoring | null): number | null {
  if (!scoring) return null
  const p = row.player
  // 0.25 PPR has no stored projection: halfway between Standard and Half
  // PPR, the app's rule (`projectionIn`, mobile lists).
  const v =
    scoring === 'Standard'
      ? p.projected_pts_standard
      : scoring === 'Half PPR'
        ? p.projected_pts_half_ppr
        : scoring === '0.25 PPR'
          ? p.projected_pts_standard != null && p.projected_pts_half_ppr != null
            ? (p.projected_pts_standard + p.projected_pts_half_ppr) / 2
            : null
          : p.projected_pts_ppr
  return typeof v === 'number' ? v : null
}

function DetailBody({
  list,
  backRef,
  onBack,
}: {
  list: ListWithDetails
  backRef: React.Ref<HTMLButtonElement>
  onBack: () => void
}) {
  // The kind pill never reads a scoring system (migration 190 doesn't), so
  // none is asked for: the meta's scoring is then just an AI expert's usual
  // one — what 190 saves on its board.
  const meta = useMobileCommunityListMeta({
    owner_id: list.owner_id,
    ai_persona_id: list.ai_persona_id,
    scoring_system_id: null,
  })
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
  const { user } = useAuth()
  // The ⋯ (plan C10): someone else's list only — its one item is Report,
  // which is never offered on your own (prevent, don't refuse).
  const [optionsOpen, setOptionsOpen] = useState(false)
  const hasOptions = !list.is_owner && reportAccess({ viewerId: user?.id, ownerId: list.owner_id }) === 'report'
  // The slim bar shows once the cover has gone up under it (the List view's
  // watcher: it hears this dialog's own scroller too).
  const coverRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const coverOff = useMobileListsCoverPassed(coverRef, barRef, true)

  // Rankings vs lists as the feed draws them (big boards, weekly boards and
  // AI experts' boards are rankings).
  const isRank = classifyCommunityList(list).kind === 'rank'
  // The scoring the ranking counts as — the feed's label and the scoring
  // chips' answer (`effectiveScoringFormat`): the one saved with it
  // (migration 190; absent from the `select('*')` row until it's pushed);
  // else an AI expert's usual scoring — not known (null) until the meta
  // reads it, when the pill says just "Ranking" — else Half PPR. The meta's
  // label ("PPR", "Half PPR", "Standard") is in the persona vocabulary.
  const savedScoring = scoringFormatOf(list as { scoring_format?: unknown })
  const scoring: CommunityScoring | null =
    savedScoring === null && list.ai_persona_id && !meta.data
      ? null
      : SCORING_FORMAT_LABEL[effectiveScoringFormat(savedScoring, meta.data?.scoring)]
  const numbered = isNumbered(list.ranking_mode)
  // A plain list is in no order worth announcing: a bulleted list to a screen reader.
  const ListTag = numbered ? 'ol' : 'ul'
  const players = list.players.filter((r) => r.player)
  // One section with no heading, or one per tier (and "Ungrouped"). The
  // numbers run on through the tiers, as on the List view.
  const sections = viewSections(players, hasTiers(list.ranking_mode))
  const sectionStart = sections.map((_, i) => sections.slice(0, i).reduce((sum, s) => sum + s.entries.length, 0))
  // The column's label shows only over a column that has a number in it.
  const anyProj = players.some((r) => projectionFor(r, scoring) !== null)
  const heads = players.slice(0, 4).map(asCommunityPlayer)
  const videos = list.links
    .filter((l) => l.kind === 'video')
    .map((l) => ({ url: l.url, title: l.title, duration: l.duration_label, source: l.source_label }))

  const author = meta.data?.author ?? null
  // A person's list that isn't yours (an AI expert has no follow graph);
  // FollowButton itself hides on your own profile.
  const followId = !list.is_owner && author?.profileId ? author.profileId : null

  return (
    <>
      {/* The dialog already pads its scroller clear of the notch. */}
      <SlimBar
        barRef={barRef}
        shown={coverOff}
        title={list.title}
        onBack={onBack}
        onOptions={hasOptions ? () => setOptionsOpen(true) : undefined}
        safeArea={false}
      />
      <div ref={coverRef} className="relative">
        <ListCover
          item={{
            id: list.id,
            heads,
            // The ranking variant is always the collage (handoff D4).
            videos: isRank ? [] : videos,
            thumbnailUrl: isRank ? null : list.thumbnail_url,
            positionFilter: list.position_filter,
            // Absent until migration 188 is pushed (`select('*')`): then null.
            coverColor: list.cover_color ?? null,
          }}
          variant="detail"
        />
        <BackOnCover buttonRef={backRef} onBack={onBack} />
        {hasOptions && <OptionsOnCover onOptions={() => setOptionsOpen(true)} />}
      </div>
      {hasOptions && <CommunityListOptions list={list} open={optionsOpen} onOpenChange={setOptionsOpen} />}

      <div className="flex flex-col gap-3 p-4">
        <span
          className={cn(
            'flex h-5 items-center self-start rounded-pill px-2 text-[10px] font-semibold text-white',
            isRank ? 'bg-accent' : 'bg-m-ink',
          )}
        >
          {isRank ? (scoring ? `Ranking · ${scoring}` : 'Ranking') : 'List'}
        </span>
        <DialogPrimitive.Title asChild>
          <h1 className="text-pretty text-[24px] font-bold leading-[1.15] tracking-[-0.02em]">{list.title}</h1>
        </DialogPrimitive.Title>

        <div className="flex items-center gap-2">
          {author ? (
            <>
              <AuthorAvatar author={author} size={26} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {author.isPersona ? <PersonaHandle username={author.username} /> : <UsernameLink username={author.username} />}{' '}
                {author.followers !== null && (
                  <span className="font-medium text-m-t3">· {formatFollows(author.followers)}</span>
                )}
              </span>
              {followId && <FollowButton userId={followId} look="phone" />}
            </>
          ) : meta.isError ? (
            <span className="text-[13px] font-medium text-m-t3">Couldn’t load the author</span>
          ) : (
            <span className="h-[26px] w-1/2 animate-pulse rounded-[14px] bg-m-b1" />
          )}
        </div>
        {list.ai_persona_id ? <ScoutAiNote personaId={list.ai_persona_id} /> : null}

        {list.description?.trim() ? (
          <p className="text-pretty text-[14px] font-medium leading-[1.45] text-m-t2">{list.description}</p>
        ) : null}

        <ListActions list={list} />
      </div>

      {videos.length > 0 && (
        <>
          <h2 className="px-4 pb-2 pt-[6px] text-[16px] font-semibold">Videos</h2>
          <div className="flex gap-[10px] overflow-x-auto px-4 pb-2 scrollbar-none">
            {videos.map((v) => (
              <VideoCard key={v.url} video={v} />
            ))}
          </div>
        </>
      )}

      <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3">
        <h2 className="min-w-0 text-[16px] font-semibold">
          {isRank ? 'Ranked players' : 'Players'} · {players.length}
        </h2>
        {/* Screen readers hear it on each row instead. */}
        {anyProj && (
          <span aria-hidden="true" data-proj-label className="flex-none text-[11px] font-medium text-m-t3">
            {PROJ_LABEL}
          </span>
        )}
      </div>
      {sections.map((section, si) => (
        <div key={section.label ?? si}>
          {section.label !== null && (
            <h3 className="px-4 pb-1 pt-3">
              {/* Desktop's tier palette, as the List view's chip (gap list #10). */}
              <span className={tierChipClass(section.tierIndex)}>{section.label}</span>
            </h3>
          )}
          <ListTag className="px-4">
            {section.entries.map((row, i) => {
              const p = asCommunityPlayer(row)
              const proj = projectionFor(row, scoring)
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() =>
                      openPlayerView(p.id, null, list.is_owner ? { listId: list.id, listTitle: list.title } : null)
                    }
                    className="flex w-full items-center gap-[10px] border-b border-m-b2 py-2 text-left"
                  >
                    {numbered && (
                      <span className="min-w-[20px] flex-none text-[13px] font-semibold tabular-nums text-m-t3">
                        {sectionStart[si]! + i + 1}
                      </span>
                    )}
                    <MHeadshot player={p} size={36} />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[14px] font-semibold">{p.full_name}</span>
                      <span className={cn('text-[11px] font-semibold', posTextClass((p.position ?? '').toUpperCase()))}>
                        {playerMeta(p)}
                      </span>
                    </span>
                    {proj !== null && (
                      <>
                        <span className="sr-only">{PROJ_LABEL}</span>
                        {/* Projections are dark blue, never the ink of points scored (D497). */}
                        <span className={cn('flex-none text-[13px] font-semibold tabular-nums', M_PROJ_TEXT)}>
                          {proj.toFixed(1)}
                        </span>
                      </>
                    )}
                  </button>
                </li>
              )
            })}
          </ListTag>
        </div>
      ))}
      {/* An AI expert's list says it was made by AI, as on the List view and
          the share page (spec-ai-expert-personas UI requirement 4). */}
      {list.ai_persona_id ? (
        <div className="pt-4">
          <ListAiAttribution personaId={list.ai_persona_id} />
        </div>
      ) : null}
    </>
  )
}

/**
 * A video on the community detail. `title` is YouTube's real one or null —
 * then no title line shows (Chris, 2026-10-15: "the actual YouTube titles or
 * nothing"); the thumbnail, duration and source still identify it, and the
 * link is named by its action for assistive tech.
 */
export function VideoCard({ video }: { video: CommunityVideo }) {
  const yt = youTubeId(video.url)
  let source = video.source
  if (yt) source = 'YouTube'
  else if (!source) {
    try {
      source = new URL(video.url).hostname.replace(/^www\./, '')
    } catch {
      source = null
    }
  }
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={video.title ? undefined : source ? `Watch on ${source}` : 'Watch video'}
      className="flex w-[220px] flex-none flex-col gap-[6px]"
    >
      <span className="relative block h-[124px] w-[220px] overflow-hidden rounded-[12px] bg-m-ink">
        {yt && (
          // eslint-disable-next-line @next/next/no-img-element -- remote thumbnail; next/image has no remote hosts configured
          <img src={youTubeThumb(yt)} alt="" className="block h-full w-full object-cover" />
        )}
        <YouTubeBadge size="lg" on="media" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        {video.duration && (
          <span className="absolute bottom-[6px] right-[6px] flex h-[18px] items-center rounded-[4px] bg-black/75 px-[5px] text-[10px] font-semibold text-white">
            {video.duration}
          </span>
        )}
      </span>
      {video.title ? <span className="text-pretty text-[12px] font-semibold leading-[1.3]">{video.title}</span> : null}
      {source && <span className="text-[11px] font-medium text-m-t3">{source}</span>}
    </a>
  )
}
