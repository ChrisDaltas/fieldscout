'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'

import {
  COMMUNITY_HREF,
  authorBgClass,
  communityDetailHref,
  expertRankingHref,
  authorInitials,
  coverHeight,
  formatFollows,
  playersAndLikes,
  postedAgo,
  topLine,
  updatedAgo,
  videoCount,
} from '@/components/mobile/community/community-ops'
import { useCommunityStore } from '@/components/mobile/community/community-store'
import { coverBgClass, youTubeId, youTubeThumb } from '@/components/mobile/lists/lists-model'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { CommunityAuthor, CommunityItem, CommunityVideo } from '@/hooks/use-mobile-community-feed'
import { ranksOn } from '@/lib/rankings/ranks-on'
import { cn } from '@/lib/utils'

/**
 * FieldScout Mobile — Community cards (handoff m-community §2.6, §2.10,
 * §2.11). Every card is one tap target (`CardLink`): it opens the list
 * detail over the feed (`?list=<id>`), or an AI expert's ranking in
 * Rankings. So the author's handle inside it is plain text — it
 * sits inside the card link's hit area (a profile link can't nest inside it;
 * the detail page's author is the profile link). Each such handle is written
 * where it renders, so the username census (L.E1.41) sees every one.
 */

// The detail URL lives with Community's other addresses (the phone search
// opens a list there too); re-exported for the cards' callers.
export { communityDetailHref }

/**
 * Opens the detail over the screen at once (handoff §2.14 mounts it
 * instantly): a history entry on the SAME page, not a router navigation, so
 * there's no server round trip — Next's `useSearchParams` follows
 * `pushState`. Back pops it. A modified click (new tab / window) is left to
 * the browser.
 */
function openDetail(e: React.MouseEvent<HTMLAnchorElement>, id: string, from: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  useCommunityStore.getState().setDetailFromFeed(true)
  window.history.pushState(null, '', communityDetailHref(id, from))
}

/**
 * A card's one tap target. An AI expert's ranking opens in Rankings (gap
 * list §3 #28; `expertRankingHref`) — a page of its own, whose Back returns
 * here. Everything else opens the detail
 * over this screen (`from`). Rankings exist only while their switch is on;
 * with it off a ranking keeps the detail.
 *
 * `away`: the card sits outside Community — Home's "From the Community"
 * shelf (plan C8) — where there's no feed under the screen to open the
 * detail over: a plain link to Community's list page, whose Back returns
 * to where you were.
 */
function CardLink({
  item,
  from = COMMUNITY_HREF,
  away = false,
  ...rest
}: { item: CommunityItem; from?: string; away?: boolean } & Omit<ComponentPropsWithoutRef<'a'>, 'href' | 'onClick'>) {
  const rankings = ranksOn() ? expertRankingHref(item) : null
  if (rankings) return <Link href={rankings} {...rest} />
  if (away) return <Link href={communityDetailHref(item.id)} {...rest} />
  return <a href={communityDetailHref(item.id, from)} onClick={(e) => openDetail(e, item.id, from)} {...rest} />
}

const AVATAR_SIZE: Record<16 | 26 | 34, { box: string; text: string }> = {
  // 7px, not 8: two letters must clear the 16px circle (gap list #8).
  16: { box: 'h-4 w-4', text: 'text-[7px]' },
  26: { box: 'h-[26px] w-[26px]', text: 'text-[10px]' },
  34: { box: 'h-[34px] w-[34px]', text: 'text-[13px]' },
}

/**
 * Author avatar: the person's photo when they have one, otherwise the
 * handoff's colour circle with the handle's first two letters (white, 600 —
 * the app-wide rule, gap list #8).
 */
export function AuthorAvatar({ author, size }: { author: CommunityAuthor; size: 16 | 26 | 34 }) {
  const s = AVATAR_SIZE[size]
  return (
    <UserAvatar
      src={author.avatarUrl}
      name={author.username}
      initials={authorInitials(author.username)}
      className={cn('flex-none', s.box)}
      fallbackClassName={cn(authorBgClass(authorSeed(author)), s.text, 'font-semibold text-white')}
    />
  )
}

/** First YouTube video id on a list, if any. */
export function firstYouTube(videos: CommunityVideo[]): string | null {
  for (const v of videos) {
    const id = youTubeId(v.url)
    if (id) return id
  }
  return null
}

const COVER_H: Record<110 | 150 | 180 | 205, string> = {
  110: 'h-[110px]',
  150: 'h-[150px]',
  180: 'h-[180px]',
  205: 'h-[205px]',
}

/** Shelf header: 18/700 title + "See all" (handoff §2.7) — a button that
 *  switches tab (`onSeeAll`), or a link to a page of its own
 *  (`seeAllHref`: For you's "Latest"). Neither: no "See all". */
export function ShelfHeader({
  title,
  onSeeAll,
  seeAllHref,
  className,
  id,
}: {
  title: string
  onSeeAll?: () => void
  seeAllHref?: string
  className?: string
  /** The heading's id, for a shelf section that's labelled by it. */
  id?: string
}) {
  const seeAll = 'text-[13px] font-semibold text-accent'
  return (
    <div className={cn('flex items-baseline justify-between', className)}>
      <h2 id={id} className="whitespace-nowrap text-[18px] font-bold tracking-[-0.02em]">
        {title}
      </h2>
      {seeAllHref ? (
        <Link href={seeAllHref} className={seeAll}>
          See all
        </Link>
      ) : onSeeAll ? (
        <button type="button" onClick={onSeeAll} className={seeAll}>
          See all
        </button>
      ) : null}
    </div>
  )
}

/** An author's colour seed: the person's id, or the AI expert's handle. */
function authorSeed(author: CommunityAuthor): string {
  return author.profileId ?? author.username
}

/**
 * Ranking row (handoff §2.10): 60px tile on the author's colour with the #1
 * player, title, "@handle · N follows" and the top-three line.
 *
 * With `postedNow` it's a row of the Latest page (gap list #35, Chris
 * 2026-10-16), which mixes lists and rankings: the second line says what it
 * is and when it was posted ("@handle · List · 25m", the handoff's
 * "@jordan · 25m" idiom), and a list's tile takes the list's cover colour,
 * as its card would. `from`: the screen the detail opens over.
 */
export function RankingRow({
  item,
  postedNow,
  from = COMMUNITY_HREF,
}: {
  item: CommunityItem
  postedNow?: number
  from?: string
}) {
  const lead = item.heads[0]
  const top = topLine(item.heads, item.numbered ?? true)
  const followers = item.author.followers
  const latest = postedNow !== undefined
  const posted = latest ? postedAgo(item.createdAt, postedNow) : ''
  const meta = latest
    ? ` · ${item.kind === 'rank' ? 'Ranking' : 'List'}${posted ? ` · ${posted}` : ''}`
    : followers !== null
      ? ` · ${formatFollows(followers)}`
      : ''
  return (
    <CardLink item={item} from={from} className="flex items-center gap-3 py-2">
      <span
        className={cn(
          'relative flex h-[60px] w-[60px] flex-none items-center justify-center overflow-hidden rounded-[10px]',
          latest && item.kind === 'list'
            ? coverBgClass(item.positionFilter, item.coverColor)
            : authorBgClass(authorSeed(item.author)),
        )}
      >
        {lead && <MHeadshot player={lead} size={40} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold">{item.title}</span>
        <span className="truncate text-[12px] font-medium text-m-t3">
          @{item.author.username}
          {meta}
        </span>
        {top && <span className="truncate text-[11px] font-medium text-m-t3">{top}</span>}
      </span>
      <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
    </CardLink>
  )
}

/** "Updated by people you follow" row (handoff §2.6). The per-player moves
 *  and the unread dot have no data behind them, so they're left out. */
export function UpdatedRow({ item, now }: { item: CommunityItem; now: number }) {
  return (
    <CardLink item={item} className="flex items-center gap-[10px] rounded-[14px] bg-m-b1 px-3 py-[10px]">
      <AuthorAvatar author={item.author} size={34} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-semibold">
          @{item.author.username} · {item.title}
        </span>
        <span className="truncate text-[11px] font-medium text-m-t3">{updatedAgo(item.updatedAt, now)}</span>
      </span>
      <MIcon name="chevronRight" size={11} stroke={2} className="text-m-t5" />
    </CardLink>
  )
}

/** Filled play triangle (handoff video badge / play badge). */
export function PlayGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M4.5 2.8v10.4L13 8z" />
    </svg>
  )
}

/**
 * A list's cover (handoff §2.11 / §2.14): an uploaded image, a YouTube
 * thumbnail, a video placeholder (videos but no players), or the headshot
 * collage on the list's colour — the owner's chosen cover colour (migration
 * 188, Chris 2026-10-15), else its position group, as the Lists screens draw
 * it (`lists-model` coverBgClass, Chris's 2026-08-11 ruling). `coverColor` is
 * optional: rows that don't carry it fall back to the position colour.
 *
 * `card` is the masonry card (its height varies); `shelf` is the same card
 * cover at one fixed size, for a horizontal shelf; `detail` tops the detail.
 */
export function ListCover({
  item,
  variant,
}: {
  item: Pick<CommunityItem, 'id' | 'heads' | 'videos' | 'thumbnailUrl' | 'positionFilter'> & {
    coverColor?: string | null
  }
  variant: 'card' | 'shelf' | 'detail'
}) {
  const yt = firstYouTube(item.videos)
  const image = item.thumbnailUrl ?? (yt ? youTubeThumb(yt) : null)
  const placeholder = !image && item.videos.length > 0 && item.heads.length === 0
  const collage = !image && !placeholder
  const card = variant !== 'detail'
  const height =
    variant === 'shelf'
      ? 'h-[150px]'
      : card
        ? COVER_H[!item.thumbnailUrl && yt ? 110 : coverHeight(item.id)]
        : 'h-[230px]'
  const headSize = card ? 44 : 64
  return (
    <span
      className={cn(
        'relative block overflow-hidden',
        height,
        card && 'rounded-[14px]',
        collage ? coverBgClass(item.positionFilter, item.coverColor) : 'bg-m-ink',
      )}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- remote thumbnail; next/image has no remote hosts configured
        <img src={image} alt="" className="block h-full w-full object-cover" />
      )}
      {collage && item.heads.length > 0 && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className={cn('grid', card ? 'grid-cols-[repeat(2,44px)] gap-[6px]' : 'grid-cols-[repeat(2,64px)] gap-2')}>
            {item.heads.slice(0, 4).map((p) => (
              <MHeadshot key={p.id} player={p} size={headSize} />
            ))}
          </span>
        </span>
      )}
      {/* The first video's real title, or nothing (Chris, 2026-10-15) — the
          ink block and the video badge still say what this cover is. */}
      {placeholder && card && item.videos[0]!.title && (
        <span className="absolute inset-0 flex flex-col justify-end gap-1 p-[10px] text-white">
          <span className="text-pretty text-[12px] font-semibold leading-[1.25]">{item.videos[0]!.title}</span>
        </span>
      )}
      {card && item.videos.length > 0 && (
        <span className="absolute left-2 top-2 flex h-5 items-center gap-1 rounded-pill bg-black/60 px-[7px] text-[10px] font-semibold text-white">
          <PlayGlyph size={10} />
          {videoCount(item.videos.length)}
        </span>
      )}
    </span>
  )
}

/** Masonry list card (handoff §2.11). */
export function ListCard({ item }: { item: CommunityItem }) {
  return (
    <CardLink item={item} className="mb-[14px] flex break-inside-avoid flex-col gap-[6px]">
      <ListCover item={item} variant="card" />
      <span className="text-pretty text-[13px] font-semibold leading-[1.25]">{item.title}</span>
      <span className="flex items-center gap-[5px] text-[11px] font-medium text-m-t3">
        <AuthorAvatar author={item.author} size={16} />
        <span className="truncate">
          @{item.author.username} · {item.playerCount} {item.playerCount === 1 ? 'player' : 'players'}
        </span>
      </span>
    </CardLink>
  )
}

/** Two-column masonry (CSS columns: down column 1, then column 2). */
export function ListMasonry({ items }: { items: CommunityItem[] }) {
  return (
    <div className="columns-2 gap-x-[10px]">
      {items.map((item) => (
        <ListCard key={item.id} item={item} />
      ))}
    </div>
  )
}

/**
 * A card of For you's "Latest" shelf (Chris, 2026-10-16): a fixed 150px
 * card — the cover the detail opens with (a ranking's is always the collage,
 * as on the detail), the title, the author, and what it is and when it was
 * posted ("List · 25m").
 *
 * `home`: the same card on Home's "From the Community" shelf (plan C8) — it
 * opens Community's list page (`away`: no feed under Home), and its last
 * line says how popular the list is ("8 players · 2 likes",
 * `playersAndLikes`): the shelf is popular lists, so "List" and the posting
 * time would say less.
 */
export function LatestCard({ item, now, home = false }: { item: CommunityItem; now: number; home?: boolean }) {
  const rank = item.kind === 'rank'
  const posted = postedAgo(item.createdAt, now)
  return (
    <CardLink
      item={item}
      away={home}
      className="flex w-[150px] flex-none snap-start flex-col gap-[6px]"
      data-latest-card={home ? undefined : true}
      data-home-community-card={home ? true : undefined}
    >
      <ListCover
        item={rank ? { ...item, videos: [], thumbnailUrl: null } : item}
        variant="shelf"
      />
      <span className="line-clamp-2 text-pretty text-[13px] font-semibold leading-[1.25]">{item.title}</span>
      <span className="flex min-w-0 items-center gap-[5px] text-[11px] font-medium text-m-t3">
        <AuthorAvatar author={item.author} size={16} />
        <span className="truncate">@{item.author.username}</span>
      </span>
      <span className="truncate text-[11px] font-medium text-m-t3">
        {home ? (
          playersAndLikes(item)
        ) : (
          <>
            {rank ? 'Ranking' : 'List'}
            {posted ? ` · ${posted}` : ''}
          </>
        )}
      </span>
    </CardLink>
  )
}

/**
 * For you's "Latest" shelf: one row that scrolls sideways, snapping card by
 * card, edge to edge with the 16px gutter kept at both ends (handoff
 * horizontal shelves: `margin 0 -16px; padding 0 16px; gap 10px`). Only the
 * shelf scrolls sideways, never the page. `home`: Home's "From the
 * Community" shelf, the same row of the same cards (`LatestCard`'s `home`).
 */
export function LatestShelf({
  items,
  now,
  home = false,
}: {
  items: readonly CommunityItem[]
  now: number
  home?: boolean
}) {
  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-[10px] overflow-x-auto px-4 scrollbar-none"
      data-latest-shelf={home ? undefined : true}
      data-home-community-shelf={home ? true : undefined}
    >
      {items.map((item) => (
        <LatestCard key={item.id} item={item} now={now} home={home} />
      ))}
    </div>
  )
}

/** Empty / error state (handoff §2.12): centred t3 message + a blue action. */
export function EmptyBlock({ message, action, onAction }: { message: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-center gap-[10px] px-4 py-12 text-center">
      <p className="text-pretty text-[14px] font-medium leading-[1.4] text-m-t3">{message}</p>
      <button type="button" onClick={onAction} className="text-[14px] font-semibold text-accent">
        {action}
      </button>
    </div>
  )
}

/** The paging state a list read hands the footer — an infinite query's own. */
export interface PagedRead {
  /** Anything read yet (undefined until the first page is in). */
  data?: unknown
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: () => unknown
  refetch: () => unknown
}

/** A paged read's first page failed — nothing read, so it's retried whole. */
function firstPageFailed(read: PagedRead): boolean {
  return read.isError && read.data === undefined
}

/** A paged read has failed and is waiting on Try again: its first page, or
 *  a later one (what was read stays shown). */
export function pagedReadFailed(read: PagedRead): boolean {
  return firstPageFailed(read) || read.isFetchNextPageError
}

/** One Try again for every read given that failed: a read whose first page
 *  failed is read again whole; one whose later page failed, that page. */
export function retryFailedReads(reads: readonly PagedRead[]): void {
  for (const read of reads) {
    if (firstPageFailed(read)) void read.refetch()
    else if (read.isFetchNextPageError) void read.fetchNextPage()
  }
}

/**
 * The end of a paged list (the Latest page; Community's results past the
 * pool — gap list §3 #30): nothing is cut off. While there's more, a button
 * reads the next page (`label`); `auto` also reads it as the end comes
 * near, again after each page while it still is (a page whose rows were all
 * left out adds none) — for the last section on a screen. Reading shows
 * `skeleton`; so does a page to come while nothing shows yet (`nothingShown`)
 * rather than a button on a blank screen. A failed page says so
 * (`errorLabel` — a screen with two paged sections names which), with Try
 * again — never a quiet end.
 */
export function MoreFooter({
  read,
  auto,
  label = 'Load more',
  errorLabel = 'Couldn’t load more.',
  nothingShown = false,
  skeleton,
}: {
  read: PagedRead
  auto: boolean
  label?: string
  errorLabel?: string
  nothingShown?: boolean
  skeleton: ReactNode
}) {
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = read
  const [endEl, setEndEl] = useState<HTMLDivElement | null>(null)
  const [nearEnd, setNearEnd] = useState(false)
  useEffect(() => {
    if (!auto || !endEl || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => setNearEnd(entries.some((e) => e.isIntersecting)), {
      rootMargin: '0px 0px 600px 0px',
    })
    observer.observe(endEl)
    return () => {
      observer.disconnect()
      setNearEnd(false)
    }
  }, [auto, endEl])
  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [nearEnd, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  const reading = (read.data === undefined && !read.isError) || isFetchingNextPage
  return (
    <>
      {auto && <div ref={setEndEl} />}
      {pagedReadFailed(read) ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center" role="alert">
          <p className="text-[13px] font-medium text-m-t3">{errorLabel}</p>
          <button
            type="button"
            onClick={() => retryFailedReads([read])}
            className="text-[13px] font-semibold text-accent"
          >
            Try again
          </button>
        </div>
      ) : reading || (hasNextPage && nothingShown) ? (
        skeleton
      ) : hasNextPage ? (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            className="flex h-9 items-center rounded-pill bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2h"
          >
            {label}
          </button>
        </div>
      ) : null}
    </>
  )
}

/** Ranking or Latest rows loading: the 60px tile and two lines. */
export function RowsSkeleton({ count, label }: { count: number; label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <span className="h-[60px] w-[60px] flex-none animate-pulse rounded-[10px] bg-m-b1" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-3/4 animate-pulse rounded-[14px] bg-m-b1" />
            <span className="h-3 w-1/2 animate-pulse rounded-[14px] bg-m-b1" />
          </span>
        </div>
      ))}
    </div>
  )
}

/** List cards loading: two covers side by side, as the masonry starts —
 *  spaced from the cards above as the masonry blocks are. */
export function CardsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="mt-[14px] grid grid-cols-2 gap-[10px]">
      <span className="h-[180px] animate-pulse rounded-[14px] bg-m-b1" />
      <span className="h-[150px] animate-pulse rounded-[14px] bg-m-b1" />
    </div>
  )
}
