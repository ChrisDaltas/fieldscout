'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { AuthorAvatar, ListCover, PlayGlyph } from '@/components/mobile/community/community-cards'
import {
  classifyCommunityList,
  effectiveScoringFormat,
  formatFollows,
  playerMeta,
  SCORING_FORMAT_LABEL,
  scoringFormatOf,
  type CommunityScoring,
} from '@/components/mobile/community/community-ops'
import { tierChipClass, viewSections, youTubeId, youTubeThumb } from '@/components/mobile/lists/lists-model'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { UsernameLink } from '@/components/shared/username-link'
import { userProfileHref } from '@/components/shared/username-link-ops'
import { useAuth } from '@/hooks/use-auth'
import { useFollowingIds, useToggleFollow } from '@/hooks/use-follows'
import { useList, useToggleFavorite, type ListPlayerWithPlayer, type ListWithDetails } from '@/hooks/use-lists'
import { useMobileCommunityListMeta } from '@/hooks/use-mobile-community-detail'
import type { CommunityPlayer, CommunityVideo } from '@/hooks/use-mobile-community-feed'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'
import { hasTiers, isNumbered } from '@/lib/lists/ranking-mode'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

/**
 * FieldScout Mobile — Community list detail (handoff m-community §2.14, D).
 * A full-screen page over the feed (`/app/explore?list=<id>`): it covers the
 * dock, has no fixed header — Back floats on the 230px cover and scrolls
 * away with it — then kind pill, title, author + Follow, description, Save /
 * Share, the Videos shelf and the players. A ranking (big board, weekly
 * board, AI expert's board) is the handoff's ranking variant ("Ranking ·
 * PPR", "Ranked players · N", always the collage cover). The players carry
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

/** An AI expert's handle: its page is /personas/… (when that surface is
 *  on), never a person's profile. */
function PersonaHandle({ username }: { username: string }) {
  const handle = `@${username}`
  return featureFlags.personas ? <Link href={`/personas/${encodeURIComponent(username)}`}>{handle}</Link> : <>{handle}</>
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
  const router = useRouter()
  const { user } = useAuth()
  // The kind pill never reads a scoring system (migration 190 doesn't), so
  // none is asked for: the meta's scoring is then just an AI expert's usual
  // one — what 190 saves on its board.
  const meta = useMobileCommunityListMeta({
    owner_id: list.owner_id,
    ai_persona_id: list.ai_persona_id,
    scoring_system_id: null,
  })
  const following = useFollowingIds()
  const toggleFollow = useToggleFollow()
  const toggleSave = useToggleFavorite()
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null)

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
  const heads = players.slice(0, 4).map(asCommunityPlayer)
  const videos = list.links
    .filter((l) => l.kind === 'video')
    .map((l) => ({ url: l.url, title: l.title, duration: l.duration_label, source: l.source_label }))

  const author = meta.data?.author ?? null
  const canFollow = Boolean(author?.profileId) && !list.is_owner && author?.profileId !== user?.id
  const isFollowing = author?.profileId ? (following.data?.has(author.profileId) ?? false) : false
  const saved = savedOverride ?? Boolean(list.is_favorited)

  const requireUser = () => {
    if (user) return true
    router.push('/login')
    return false
  }

  const onFollow = () => {
    if (!author?.profileId || !requireUser()) return
    toggleFollow.mutate({ targetId: author.profileId, isFollowing })
  }

  const onSave = () => {
    if (!requireUser() || toggleSave.isPending) return
    const next = !saved
    setSavedOverride(next)
    toggleSave.mutate(list.id, {
      onSuccess: (res) => setSavedOverride(res.is_favorited),
      onError: () => {
        setSavedOverride(!next)
        toast({ title: 'Couldn’t save this list' })
      },
    })
  }

  const onShare = async () => {
    const owner = meta.data?.ownerUsername
    if (!owner) return
    const url = `${window.location.origin}${userProfileHref(owner)}/lists/${encodeURIComponent(list.slug)}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'Link copied' })
    } catch {
      toast({ title: 'Couldn’t copy the link' })
    }
  }

  return (
    <>
      <div className="relative">
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
      </div>

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
              {canFollow && (
                <button
                  type="button"
                  onClick={onFollow}
                  disabled={toggleFollow.isPending}
                  aria-pressed={isFollowing}
                  className={cn(
                    'flex h-[30px] flex-none items-center rounded-pill px-[14px] text-[12px] font-semibold',
                    isFollowing ? 'bg-m-b3s text-m-t2' : 'bg-accent text-white',
                  )}
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </button>
              )}
            </>
          ) : meta.isError ? (
            <span className="text-[13px] font-medium text-m-t3">Couldn’t load the author</span>
          ) : (
            <span className="h-[26px] w-1/2 animate-pulse rounded-[14px] bg-m-b1" />
          )}
        </div>

        {list.description?.trim() ? (
          <p className="text-pretty text-[14px] font-medium leading-[1.45] text-m-t2">{list.description}</p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSave}
            aria-pressed={saved}
            className={cn(
              'flex h-9 items-center gap-[6px] rounded-pill bg-m-b2 px-[14px] text-[13px] font-semibold',
              saved ? 'text-accent' : 'text-m-t1',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              width={14}
              height={14}
              fill={saved ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 2.5h8v11L8 10.5l-4 3z" />
            </svg>
            {saved ? 'Saved' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => void onShare()}
            className="flex h-9 items-center gap-[6px] rounded-pill bg-m-b2 px-[14px] text-[13px] font-semibold text-m-t1"
          >
            <svg
              viewBox="0 0 16 16"
              width={14}
              height={14}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 2.5v8M5 5.5l3-3 3 3M3.5 9v4h9V9" />
            </svg>
            Share
          </button>
        </div>
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

      <h2 className="px-4 pb-1 pt-3 text-[16px] font-semibold">
        {isRank ? 'Ranked players' : 'Players'} · {players.length}
      </h2>
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
                    {proj !== null && <span className="flex-none text-[13px] font-semibold tabular-nums">{proj.toFixed(1)}</span>}
                  </button>
                </li>
              )
            })}
          </ListTag>
        </div>
      ))}
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
        <span className="absolute left-1/2 top-1/2 flex h-7 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[8px] bg-negative-strong text-white">
          <PlayGlyph size={12} />
        </span>
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
