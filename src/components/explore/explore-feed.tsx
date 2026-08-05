'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'

import { FollowButton } from '@/components/explore/follow-button'
import { Badge, FilterChip } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  exploreFeedKeys,
  useExploreFeed,
  type ExploreFeedItem,
  type ExploreFeedTab,
} from '@/hooks/use-explore-feed'
import { useToggleLike } from '@/hooks/use-lists'
import { useTags } from '@/hooks/use-tags'

const TOPIC_CHIP_COUNT = 6

/** "1.2k"-style compact count, mono via .fs-num at the call site. */
function formatCount(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

function LikeButton({ item }: { item: ExploreFeedItem }) {
  const qc = useQueryClient()
  const toggleLike = useToggleLike(item.id)
  // Seed from the viewer's real liked state so already-liked lists render
  // liked; the toggle endpoint returns the authoritative state after a click.
  const [liked, setLiked] = useState(item.is_liked)

  return (
    <button
      type="button"
      aria-label={liked ? `Unlike ${item.title}` : `Like ${item.title}`}
      aria-pressed={liked}
      disabled={toggleLike.isPending}
      onClick={() => {
        toggleLike.mutate(undefined, {
          onSuccess: (data) => {
            setLiked(data.liked)
            // Write the authoritative count into every cached feed tab.
            qc.setQueriesData<ExploreFeedItem[]>(
              { queryKey: exploreFeedKeys.all },
              (old) =>
                old?.map((i) =>
                  i.id === item.id ? { ...i, like_count: data.like_count } : i,
                ),
            )
          },
        })
      }}
      className={`inline-flex items-center gap-1 text-[10px] font-bold transition-colors ${
        liked ? 'text-accent' : 'text-n-3 hover:text-ink'
      }`}
    >
      <Icon name="like" size={12} />
      <span className="fs-num">{formatCount(item.like_count)}</span>
    </button>
  )
}

function FeedRow({ item }: { item: ExploreFeedItem }) {
  return (
    <div className="relative flex items-center gap-[11px] px-[13px] py-[11px] transition-colors hover:bg-n-4/50">
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
            className="truncate text-[12px] font-bold text-ink after:absolute after:inset-0"
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
        <div className="mt-0.5 truncate text-[10px] font-semibold text-n-3">
          {item.author.name ? `${item.author.name} · ` : ''}@{item.author.handle}
          {item.tag && (
            <>
              {' · '}
              <span className="font-bold text-accent-strong">
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
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-n-3">
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

function FeedSkeleton() {
  return (
    <div className="divide-y divide-n-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-[11px] px-[13px] py-[11px]">
          <Skeleton className="h-8 w-8 rounded-pill" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-btn-sm w-16" />
        </div>
      ))}
    </div>
  )
}

/**
 * Community feed (package screen 08, left column): Trending / Newest /
 * Following tabs, topic chips from real trending tags, and a flush-row card
 * of public lists and rankings.
 */
export function ExploreFeed() {
  const [tab, setTab] = useState<ExploreFeedTab>('trending')
  const [tagId, setTagId] = useState<string | null>(null)

  const { data: tagData } = useTags({ trending: true })
  const topics = (tagData?.tags ?? []).slice(0, TOPIC_CHIP_COUNT)

  const { data: items, isLoading, isError } = useExploreFeed(tab, tagId)

  const activeTopic = topics.find((t) => t.id === tagId)

  return (
    <div>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ExploreFeedTab)}
        className="mb-3.5"
      >
        <TabsList>
          <TabsTrigger value="trending">Trending</TabsTrigger>
          <TabsTrigger value="newest">Newest</TabsTrigger>
          <TabsTrigger value="following">Following</TabsTrigger>
        </TabsList>
      </Tabs>

      {topics.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <FilterChip pressed={tagId === null} onPressedChange={() => setTagId(null)}>
            All
          </FilterChip>
          {topics.map((topic) => (
            <FilterChip
              key={topic.id}
              pressed={tagId === topic.id}
              onPressedChange={(pressed) => setTagId(pressed ? topic.id : null)}
            >
              {topic.name}
            </FilterChip>
          ))}
        </div>
      )}

      <Card>
        {isLoading ? (
          <FeedSkeleton />
        ) : isError ? (
          <p className="p-[19px] text-center text-[11px] font-bold text-negative-strong">
            Couldn&apos;t load the feed — try again in a moment.
          </p>
        ) : !items || items.length === 0 ? (
          <div className="p-[19px] text-center">
            <p className="text-h6">
              {tab === 'following'
                ? 'Nothing from your follows yet'
                : `No ${activeTopic ? activeTopic.name.toLowerCase() : 'public'} lists yet`}
            </p>
            <p className="mt-1 text-[11px] font-medium text-n-3">
              {tab === 'following'
                ? 'Lists and rankings from scouts you follow will show up here.'
                : 'Be the first — make a list and set it to public.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-n-4">
            {items.map((item) => (
              <FeedRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
