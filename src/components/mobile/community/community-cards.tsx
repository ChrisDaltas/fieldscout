'use client'

import {
  authorBgClass,
  authorInitial,
  coverHeight,
  formatFollows,
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
import { cn } from '@/lib/utils'

/**
 * FieldScout Mobile — Community cards (handoff m-community §2.6, §2.10,
 * §2.11). Every card is one tap target that opens the list detail over the
 * feed (`?list=<id>`), so the author's handle inside it is plain text — it
 * sits inside the card link's hit area (a profile link can't nest inside it;
 * the detail page's author is the profile link). Each such handle is written
 * where it renders, so the username census (L.E1.41) sees every one.
 */

/** The Community detail URL — the feed stays mounted underneath. A mobile
 *  URL: the desktop Community page ignores `?list=`. */
export function communityDetailHref(id: string): string {
  return `/app/explore?list=${encodeURIComponent(id)}`
}

/**
 * Opens the detail over the feed at once (handoff §2.14 mounts it
 * instantly): a history entry, not a router navigation, so there's no server
 * round trip — Next's `useSearchParams` follows `pushState`. Back pops it.
 * A modified click (new tab / window) is left to the browser.
 */
function openDetail(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  useCommunityStore.getState().setDetailFromFeed(true)
  window.history.pushState(null, '', communityDetailHref(id))
}

const AVATAR_SIZE: Record<16 | 26 | 34, { box: string; text: string }> = {
  16: { box: 'h-4 w-4', text: 'text-[8px]' },
  26: { box: 'h-[26px] w-[26px]', text: 'text-[10px]' },
  34: { box: 'h-[34px] w-[34px]', text: 'text-[13px]' },
}

/**
 * Author avatar: the person's photo when they have one, otherwise the
 * handoff's colour circle with the handle's first letter (white, 600).
 */
export function AuthorAvatar({ author, size }: { author: CommunityAuthor; size: 16 | 26 | 34 }) {
  const s = AVATAR_SIZE[size]
  return (
    <UserAvatar
      src={author.avatarUrl}
      name={author.username}
      initials={authorInitial(author.username)}
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

/** Shelf header: 18/700 title + "See all" (handoff §2.7). */
export function ShelfHeader({
  title,
  onSeeAll,
  className,
}: {
  title: string
  onSeeAll: () => void
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between', className)}>
      <h2 className="whitespace-nowrap text-[18px] font-bold tracking-[-0.02em]">{title}</h2>
      <button type="button" onClick={onSeeAll} className="text-[13px] font-semibold text-accent">
        See all
      </button>
    </div>
  )
}

/** An author's colour seed: the person's id, or the AI expert's handle. */
function authorSeed(author: CommunityAuthor): string {
  return author.profileId ?? author.username
}

/** Ranking row (handoff §2.10): 60px tile on the author's colour with the #1
 *  player, title, "@handle · N follows" and the top-three line. */
export function RankingRow({ item }: { item: CommunityItem }) {
  const lead = item.heads[0]
  const top = topLine(item.heads)
  const followers = item.author.followers
  return (
    <a
      href={communityDetailHref(item.id)}
      onClick={(e) => openDetail(e, item.id)}
      className="flex items-center gap-3 py-2"
    >
      <span
        className={cn(
          'relative flex h-[60px] w-[60px] flex-none items-center justify-center overflow-hidden rounded-[10px]',
          authorBgClass(authorSeed(item.author)),
        )}
      >
        {lead && <MHeadshot player={lead} size={40} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold">{item.title}</span>
        <span className="truncate text-[12px] font-medium text-m-t3">
          @{item.author.username}
          {followers !== null && ` · ${formatFollows(followers)}`}
        </span>
        {top && <span className="truncate text-[11px] font-medium text-m-t3">{top}</span>}
      </span>
      <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
    </a>
  )
}

/** "Updated by people you follow" row (handoff §2.6). The per-player moves
 *  and the unread dot have no data behind them, so they're left out. */
export function UpdatedRow({ item, now }: { item: CommunityItem; now: number }) {
  return (
    <a
      href={communityDetailHref(item.id)}
      onClick={(e) => openDetail(e, item.id)}
      className="flex items-center gap-[10px] rounded-[14px] bg-m-b1 px-3 py-[10px]"
    >
      <AuthorAvatar author={item.author} size={34} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-semibold">
          @{item.author.username} · {item.title}
        </span>
        <span className="truncate text-[11px] font-medium text-m-t3">{updatedAgo(item.updatedAt, now)}</span>
      </span>
      <MIcon name="chevronRight" size={11} stroke={2} className="text-m-t5" />
    </a>
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
 * collage on the list's colour — its position group, as the Lists screens
 * draw it (`lists-model` coverBgClass, Chris's 2026-08-11 ruling).
 */
export function ListCover({
  item,
  variant,
}: {
  item: Pick<CommunityItem, 'id' | 'heads' | 'videos' | 'thumbnailUrl' | 'positionFilter'>
  variant: 'card' | 'detail'
}) {
  const yt = firstYouTube(item.videos)
  const image = item.thumbnailUrl ?? (yt ? youTubeThumb(yt) : null)
  const placeholder = !image && item.videos.length > 0 && item.heads.length === 0
  const collage = !image && !placeholder
  const card = variant === 'card'
  const height = card ? COVER_H[!item.thumbnailUrl && yt ? 110 : coverHeight(item.id)] : 'h-[230px]'
  const headSize = card ? 44 : 64
  return (
    <span
      className={cn(
        'relative block overflow-hidden',
        height,
        card && 'rounded-[14px]',
        collage ? coverBgClass(item.positionFilter) : 'bg-m-ink',
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
      {placeholder && card && (
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
    <a
      href={communityDetailHref(item.id)}
      onClick={(e) => openDetail(e, item.id)}
      className="mb-[14px] flex break-inside-avoid flex-col gap-[6px]"
    >
      <ListCover item={item} variant="card" />
      <span className="text-pretty text-[13px] font-semibold leading-[1.25]">{item.title}</span>
      <span className="flex items-center gap-[5px] text-[11px] font-medium text-m-t3">
        <AuthorAvatar author={item.author} size={16} />
        <span className="truncate">
          @{item.author.username} · {item.playerCount} {item.playerCount === 1 ? 'player' : 'players'}
        </span>
      </span>
    </a>
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
