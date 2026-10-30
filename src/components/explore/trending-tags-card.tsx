'use client'

import { CollapsibleCard } from '@/components/layout/two-column-layout'
import { TagChip } from '@/components/lists/tag-chip'
import { trendingTagTopics } from '@/components/mobile/community/community-ops'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { exploreFeedItems, useExploreFeed } from '@/hooks/use-explore-feed'
import { useTags } from '@/hooks/use-tags'
import { useCommunityTopicStore } from '@/stores/community-topic-store'

const TAG_COUNT = 8

/**
 * "Trending tags" card (package screen 08, right column) — the same rules
 * as the phone's Trending tags shelf (`TrendingTagsShelf`):
 *  - it offers only the most used tags that a list Community shows carries
 *    (`trendingTagTopics` over the feed's own unfiltered Popular read — the
 *    rows its topic pills come from, so nothing more is read), never one
 *    only an empty list or a ranking you can't see carries (plan C4: topic
 *    pills come only from what's visible);
 *  - a tag sets the feed's own topic, inside the app (the feed's pills and
 *    this card share it, `community-topic-store`) — pressed again, it goes
 *    back to All. It never leaves for the public /tag page;
 *  - with no tag to offer the card isn't shown at all, as on the phone;
 *  - a failed read says so, with Try again — never "no tags" (plan C4,
 *    readiness S13).
 */
export function TrendingTagsCard() {
  const trending = useTags({ trending: true })
  const shown = useExploreFeed('popular', null)
  const tagId = useCommunityTopicStore((s) => s.tagId)
  const setTagId = useCommunityTopicStore((s) => s.setTagId)

  const rows = shown.data ? exploreFeedItems(shown.data.pages) : []
  const tags = trending.data ? trendingTagTopics(trending.data.tags, rows, TAG_COUNT) : []
  // The feed's rows count as read once a page is in: a later page failing
  // keeps the tags of the rows already shown.
  const failed = trending.isError || (shown.isError && !shown.data)
  const pending = !failed && (trending.isPending || shown.isPending)

  if (!failed && !pending && tags.length === 0) return null

  const retry = () => {
    if (trending.isError) void trending.refetch()
    if (shown.isError) void shown.refetch()
  }
  const retrying = trending.isFetching || shown.isFetching

  return (
    <CollapsibleCard title="Trending tags">
      <div className="flex flex-wrap gap-2 p-[13px]" data-trending-tags>
        {pending ? (
          <div className="flex flex-wrap gap-2" aria-busy="true" aria-label="Loading trending tags">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-chip w-16 rounded-pill bg-surface-control" />
            ))}
          </div>
        ) : failed ? (
          <div className="flex w-full flex-col items-center gap-2 p-1.5 text-center">
            <p className="text-[11px] font-semibold text-negative-strong">Couldn&apos;t load trending tags.</p>
            <Button variant="stroke" size="sm" onClick={retry} disabled={retrying}>
              {retrying ? 'Loading…' : 'Try again'}
            </Button>
          </div>
        ) : (
          tags.map((tag) => (
            <TagChip
              key={tag.id}
              name={`#${tag.label}`}
              active={tagId === tag.id}
              onClick={() => setTagId(tagId === tag.id ? null : tag.id)}
            />
          ))
        )}
      </div>
    </CollapsibleCard>
  )
}
