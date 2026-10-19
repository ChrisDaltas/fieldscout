'use client'

import { FollowButton } from '@/components/explore/follow-button'
import { AuthorAvatar, ShelfHeader } from '@/components/mobile/community/community-cards'
import { trendingTagTopics, type CommunityTopic } from '@/components/mobile/community/community-ops'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import type { CommunityItem } from '@/hooks/use-mobile-community-feed'
import { useTags } from '@/hooks/use-tags'
import { useTopScouts } from '@/hooks/use-top-scouts'
import { cn } from '@/lib/utils'

/**
 * FieldScout Mobile — For you's people and tag shelves (gap list §3 #26).
 * The handoff draws neither; both are desktop Community's right-hand cards
 * (`top-scouts-card.tsx`, `trending-tags-card.tsx`) brought to the phone in
 * its shelf language: the 18/700 shelf header, then rows or pills on the m-*
 * tokens. Same reads as desktop. An empty shelf isn't drawn; a failed read
 * says so, with a retry — never an empty-looking shelf.
 */

const SHELF_HEADER = 'mb-[6px] mt-[22px]'

/**
 * "Top scouts": desktop's leaderboard (`useTopScouts` — the five highest cred
 * scores; there's no accuracy measure yet, so a row reads "N cred"). Nothing
 * awards cred yet, so every row reads the start — "7 cred", everyone starts
 * at 7 (Chris 2026-10-18, `CRED_START`, after the gap list §3 #26 review
 * found it read "0 cred") — and the order is only the hook's fixed
 * tiebreak, not merit. Each row
 * opens that person's profile (the handle is the link, stretched over the
 * row); Follow sits above it, and your own row says "You" instead.
 */
export function TopScoutsShelf() {
  const scouts = useTopScouts()
  const { user } = useAuth()

  if (scouts.isSuccess && scouts.data.length === 0) return null

  return (
    <section aria-labelledby="community-top-scouts">
      <ShelfHeader id="community-top-scouts" title="Top scouts" className={SHELF_HEADER} />
      {scouts.isPending ? (
        <div className="flex flex-col" aria-busy="true" aria-label="Loading top scouts">
          {[0, 1, 2].map((i) => (
            <span key={i} className="my-2 h-[34px] animate-pulse rounded-[14px] bg-m-b1" />
          ))}
        </div>
      ) : scouts.isError ? (
        <ShelfError message="Couldn’t load top scouts." onRetry={() => void scouts.refetch()} />
      ) : (
        <ol className="flex flex-col">
          {scouts.data.map((scout, i) => (
            <li key={scout.id} className="relative flex items-center gap-3 py-2" data-top-scout>
              <span className="w-4 flex-none text-center text-[13px] font-semibold tabular-nums text-m-t3">{i + 1}</span>
              <AuthorAvatar
                author={{
                  profileId: scout.id,
                  username: scout.username,
                  avatarUrl: scout.avatar_url,
                  followers: null,
                  isPersona: false,
                }}
                size={34}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <UsernameLink
                  username={scout.username}
                  className="truncate text-[14px] font-semibold text-m-t1 after:absolute after:inset-0"
                />
                <span className="text-[12px] font-medium tabular-nums text-m-t3">
                  {scout.cred_score.toLocaleString('en-US')} cred
                </span>
              </span>
              {scout.id === user?.id ? (
                <span className="relative z-10 flex h-[30px] flex-none items-center rounded-pill bg-m-gb px-[14px] text-[12px] font-semibold text-m-tb">
                  You
                </span>
              ) : (
                <FollowButton userId={scout.id} look="phone" className="relative z-10" />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * "Trending tags": desktop's card (`useTags({ trending: true })`, most used
 * first) as pills. A tag filters Community by that topic, here on the phone
 * (`onPick`) — and the shelf offers only the tags that the lists showing on
 * Community carry (`shown`; `trendingTagTopics`), so a tap always finds
 * something.
 */
export function TrendingTagsShelf({
  shown,
  onPick,
}: {
  shown: readonly Pick<CommunityItem, 'tags'>[]
  onPick: (topic: CommunityTopic) => void
}) {
  const trending = useTags({ trending: true })
  const tags = trending.data ? trendingTagTopics(trending.data.tags, shown) : []

  if (trending.isSuccess && tags.length === 0) return null

  return (
    <section aria-labelledby="community-trending-tags">
      <ShelfHeader id="community-trending-tags" title="Trending tags" className="mb-[10px] mt-[22px]" />
      {trending.isPending ? (
        <div className="flex flex-wrap gap-[6px]" aria-busy="true" aria-label="Loading trending tags">
          {['w-[72px]', 'w-24', 'w-16', 'w-[88px]'].map((w) => (
            <span key={w} className={cn('h-8 animate-pulse rounded-pill bg-m-b1', w)} />
          ))}
        </div>
      ) : trending.isError ? (
        <ShelfError message="Couldn’t load trending tags." onRetry={() => void trending.refetch()} />
      ) : (
        <div className="flex flex-wrap gap-[6px]">
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t)}
              className="flex h-8 flex-none items-center whitespace-nowrap rounded-pill bg-m-b2 px-3 text-[13px] font-semibold text-m-t1"
              data-trending-tag
            >
              #{t.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function ShelfError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="rounded-[14px] bg-m-b1 px-4 py-4 text-center text-[13px] font-medium text-m-t3">
      {message}{' '}
      <button type="button" onClick={onRetry} className="font-semibold text-accent">
        Try again
      </button>
    </p>
  )
}
