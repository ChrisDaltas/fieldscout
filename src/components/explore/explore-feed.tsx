'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'

import { FollowButton } from '@/components/explore/follow-button'
import { trendingTagTopics, type CommunityTopic } from '@/components/mobile/community/community-ops'
import { UsernameLink } from '@/components/shared/username-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem, Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  exploreFeedItems,
  exploreFeedKeys,
  useExploreFeed,
  withLikeCount,
  type ExploreFeedItem,
  type ExploreFeedPage,
  type ExploreFeedPageParam,
  type ExploreFeedTab,
} from '@/hooks/use-explore-feed'
import { useToggleLike } from '@/hooks/use-lists'
import { useTags } from '@/hooks/use-tags'
import { toast } from '@/hooks/use-toast'
import { ranksOn } from '@/lib/rankings/ranks-on'
import { useCommunityTopicStore } from '@/stores/community-topic-store'
import { useUIStore } from '@/stores/ui-store'

const TOPIC_CHIP_COUNT = 6

/**
 * The topic chips: the most used tags (`/api/tags?trending=true`) that a
 * list on the feed carries (`shown`: the unfiltered Popular feed's loaded
 * rows) — the phone's Trending tags rule (`trendingTagTopics`), so a chip
 * never opens an empty feed (plan C4: topic pills come only from what's
 * visible). The chip that's on stays, even if the rows that carried it
 * have since changed, so it can be seen and cleared.
 */
export function feedTopics(
  trending: readonly { id: string; name: string }[],
  shown: readonly Pick<ExploreFeedItem, 'tags'>[],
  activeId: string | null,
): CommunityTopic[] {
  const topics = trendingTagTopics(trending, shown, TOPIC_CHIP_COUNT)
  if (!activeId || topics.some((t) => t.id === activeId)) return topics
  const active = trending.find((t) => t.id === activeId)
  return active ? [...topics, { kind: 'tag', id: active.id, label: active.name }] : topics
}

/** "1.2k"-style compact count, mono via .fs-num at the call site. */
function formatCount(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

/** A like or unlike that didn't go through: the error toast (an alert glyph
 *  on the ink toast, never a red fill) — the phone's words. */
export function toastLikeFailed(wasLiking: boolean) {
  toast({
    title: wasLiking ? 'Couldn’t like this list' : 'Couldn’t unlike this list',
    description: 'Try again in a moment.',
    variant: 'destructive',
  })
}

function LikeButton({ item }: { item: ExploreFeedItem }) {
  const qc = useQueryClient()
  const toggleLike = useToggleLike(item.id)
  // Seed from the viewer's real liked state so already-liked lists render
  // liked. The row knows that state, so a tap flips it at once (CLAUDE.md:
  // like/unlike are optimistic); the toggle's answer — its liked state and
  // authoritative count — is written last. A failure puts it back and says
  // so (plan C3, F12): never a like that silently snaps back.
  const [liked, setLiked] = useState(item.is_liked)
  const [delta, setDelta] = useState(0)
  // A like made elsewhere — the list's own page (plan C5) writes `is_liked`
  // into the feed — re-seeds the button from the feed's state. Adjusted in
  // render, never by remounting (a `key`), so a like from this row keeps
  // keyboard focus on the button.
  const [seenLiked, setSeenLiked] = useState(item.is_liked)
  if (item.is_liked !== seenLiked) {
    setSeenLiked(item.is_liked)
    setLiked(item.is_liked)
    setDelta(0)
  }
  const count = Math.max(0, item.like_count + delta)

  return (
    <button
      type="button"
      aria-label={liked ? `Unlike ${item.title}` : `Like ${item.title}`}
      aria-pressed={liked}
      // One toggle at a time (the server flips whatever it holds), held by
      // a guard rather than `disabled`: a focused button that turns
      // disabled loses keyboard focus, as a remount would.
      aria-disabled={toggleLike.isPending}
      onClick={() => {
        if (toggleLike.isPending) return
        const next = !liked
        setLiked(next)
        setDelta(next ? 1 : -1)
        toggleLike.mutate(undefined, {
          onSuccess: (data) => {
            setLiked(data.liked)
            setDelta(0)
            // Write the authoritative count — and the liked state — into
            // every cached feed tab.
            qc.setQueriesData<InfiniteData<ExploreFeedPage, ExploreFeedPageParam>>(
              { queryKey: exploreFeedKeys.all },
              (old) => withLikeCount(old, item.id, data.like_count, data.liked),
            )
          },
          onError: () => {
            setLiked(!next)
            setDelta(0)
            toastLikeFailed(next)
          },
        })
      }}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold transition-colors ${
        liked ? 'text-accent' : 'text-n-6 hover:text-ink'
      }`}
    >
      <Icon name="like" size={12} />
      <span className="fs-num">{formatCount(count)}</span>
    </button>
  )
}

/** A feed row: the list (the whole row opens it), its author, Like, the
 *  comment count and Follow. Home's "From the Community" card shows the
 *  same rows (plan C8). */
export function FeedRow({ item }: { item: ExploreFeedItem }) {
  return (
    <div className="relative flex items-center gap-[11px] px-[15px] py-[11px] transition-colors hover:bg-surface-sunken">
      <UserAvatar
        src={item.author.avatar_url}
        name={item.author.name ?? item.author.handle}
        className="h-8 w-8 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* Stretched link: the whole row opens the list. */}
          <Link
            href={item.href}
            className="truncate text-[13px] font-bold tracking-[-0.01em] text-ink after:absolute after:inset-0"
          >
            {item.title}
          </Link>
          <Badge
            variant={item.is_ranking ? 'accent' : 'stroke'}
            className="shrink-0"
          >
            {item.is_ranking ? 'Ranking' : 'List'}
          </Badge>
          {item.is_ai && (
            <Badge variant="stroke" className="shrink-0">
              AI
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate text-[10px] font-semibold text-n-6">
          {/* L.E1.41: a person's handle opens his profile, above the row's
              stretched link. An AI persona (it has a name) keeps its plain
              handle — its page is /personas/…, not a person's profile. */}
          {item.author.name ? (
            `${item.author.name} · @${item.author.handle}`
          ) : (
            <UsernameLink username={item.author.handle} className="relative z-10" />
          )}
          {item.tag && (
            <>
              {' · '}
              <span className="font-semibold text-accent">
                {item.tag.name}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Interactive cluster sits above the stretched link; the comment count
          is display-only, so clicks there fall through to the row link. */}
      <div className="pointer-events-none relative z-10 flex shrink-0 items-center gap-4">
        <span className="pointer-events-auto">
          <LikeButton item={item} />
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-n-6">
          <Icon name="comments" size={12} />
          <span className="fs-num">{formatCount(item.comment_count)}</span>
        </span>
        {item.author_id && (
          <FollowButton
            userId={item.author_id}
            className="pointer-events-auto"
          />
        )}
      </div>
    </div>
  )
}

export function FeedSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-n-4" aria-busy="true" aria-label="Loading lists">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-[11px] px-[15px] py-[11px]">
          <Skeleton className="h-8 w-8 rounded-pill bg-surface-control" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/2 rounded-md bg-surface-control" />
            <Skeleton className="h-2.5 w-1/3 rounded-md bg-surface-control" />
          </div>
          <Skeleton className="h-btn-sm w-16 rounded-pill bg-surface-control" />
        </div>
      ))}
    </div>
  )
}

/**
 * Community feed (package screen 08, left column): Popular / Newest /
 * Following tabs, topic chips from the trending tags its lists carry
 * (`feedTopics`), and a flush-row card
 * of public lists (and rankings, once they're switched on), a page at a time
 * with "Load more" (`use-explore-feed.ts` — what shows, and Popular's
 * order, are the phone's).
 */
export function ExploreFeed() {
  const [tab, setTab] = useState<ExploreFeedTab>('popular')
  // The topic is shared with the Trending tags card beside the feed, so a
  // tag there sets this same filter (`community-topic-store`). Leaving
  // Community clears it, as when it was this feed's own state.
  const tagId = useCommunityTopicStore((s) => s.tagId)
  const setTagId = useCommunityTopicStore((s) => s.setTagId)
  useEffect(() => () => setTagId(null), [setTagId])
  const openCreateList = useUIStore((s) => s.setCreateListOpen)

  const feed = useExploreFeed(tab, tagId)
  const items = feed.data ? exploreFeedItems(feed.data.pages) : []

  // The chips are drawn from the unfiltered Popular feed — the screen's
  // first view, so this reads nothing more; it stays loaded while a chip or
  // another tab is on, so the chips don't change under the pointer.
  const { data: tagData } = useTags({ trending: true })
  const unfiltered = useExploreFeed('popular', null)
  const shown = unfiltered.data ? exploreFeedItems(unfiltered.data.pages) : []
  const topics = feedTopics(tagData?.tags ?? [], shown, tagId)
  // Nothing read (the first page failed) says so; a later page failing
  // keeps the rows already read, with the failure beside Load more.
  const failed = feed.isError && !feed.data
  const moreFailed = feed.isFetchNextPageError

  const activeTopic = topics.find((t) => t.id === tagId)

  return (
    <div>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ExploreFeedTab)}
        className="mb-3.5"
      >
        <TabsList>
          <TabsTrigger value="popular">Popular</TabsTrigger>
          <TabsTrigger value="newest">Newest</TabsTrigger>
          <TabsTrigger value="following">Following</TabsTrigger>
        </TabsList>
      </Tabs>

      {topics.length > 0 && (
        /* Single-select: 'All' is `tagId === null`, so exactly one item is
           always active and clearing a topic just moves the fill back to All.
           That makes it the shared segment control (LV.11). The clear-by-
           re-tapping gesture is kept deliberately — it is the only way back to
           All without moving the pointer.

           Boxed, not bare, and the frame is load-bearing: the Radix tab row
           (Trending / Newest / Following) sits directly above and is bare.
           Un-framed, the two read as the same control — a tab set and a filter
           blurring together is the exact confusion D9 worried about. Measured
           both ways in the browser before choosing. The cost is a ragged wrap
           below `sm`, which is the lesser problem. */
        <Segment aria-label="Filter by topic" className="mb-4 flex flex-wrap">
          <SegmentItem active={tagId === null} onClick={() => setTagId(null)}>
            All
          </SegmentItem>
          {topics.map((topic) => (
            <SegmentItem
              key={topic.id}
              active={tagId === topic.id}
              onClick={() => setTagId(tagId === topic.id ? null : topic.id)}
            >
              {topic.label}
            </SegmentItem>
          ))}
        </Segment>
      )}

      <Card>
        {feed.isPending ? (
          <FeedSkeleton />
        ) : failed ? (
          <div className="flex flex-col items-center gap-2.5 px-[19px] py-10 text-center">
            <p className="text-[11px] font-semibold text-negative-strong">
              Couldn&apos;t load the feed — try again in a moment.
            </p>
            <Button variant="stroke" size="sm" onClick={() => void feed.refetch()} disabled={feed.isFetching}>
              {feed.isFetching ? 'Loading…' : 'Try again'}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-[19px] py-10 text-center" data-feed-empty>
            <p className="text-[15px] font-bold tracking-[-0.02em] text-ink">
              {tab === 'following'
                ? 'Nothing from your follows yet'
                : `No ${activeTopic ? activeTopic.label.toLowerCase() : 'public'} lists yet`}
            </p>
            <p className="mt-1 text-[11px] font-medium text-n-6">
              {tab === 'following'
                ? // Only what's switched on is promised (plan C4, readiness S5).
                  `${ranksOn() ? 'Lists and rankings' : 'Lists'} from scouts you follow will show up here.`
                : 'Be the first — make a list and add a few players to it.'}
            </p>
            {tab !== 'following' && (
              <Button variant="blue" size="sm" className="mt-3.5" onClick={() => openCreateList(true)}>
                <Icon name="plus" size={13} /> New list
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-n-4">
              {items.map((item) => (
                <FeedRow key={item.id} item={item} />
              ))}
            </div>
            {/* Every page that exists can be read — never a silent stop at
                the first (plan C3, S14). */}
            {feed.hasNextPage && (
              <div className="flex flex-wrap items-center justify-center gap-2 border-t border-n-4 py-3" data-feed-more>
                <Button
                  variant="stroke"
                  size="sm"
                  onClick={() => void feed.fetchNextPage()}
                  disabled={feed.isFetchingNextPage}
                >
                  {feed.isFetchingNextPage ? 'Loading…' : moreFailed ? 'Try again' : 'Load more'}
                </Button>
                {moreFailed && !feed.isFetchingNextPage && (
                  <span className="text-[10px] font-medium text-negative-strong">Couldn&apos;t load more.</span>
                )}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
