'use client'

import { CollapsibleCard } from '@/components/layout/two-column-layout'
import { TagChip } from '@/components/lists/tag-chip'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTags } from '@/hooks/use-tags'

const TAG_COUNT = 8

/**
 * "Trending tags" card (package screen 08, right column) — real tags ranked
 * by use count, each linking to its public /tag/[tag] feed via the canonical
 * TagChip. A failed read says so, with Try again — never "No tags yet"
 * (plan C4, readiness S13).
 */
export function TrendingTagsCard() {
  const trending = useTags({ trending: true })
  const tags = (trending.data?.tags ?? []).slice(0, TAG_COUNT)

  return (
    <CollapsibleCard title="Trending tags">
      <div className="flex flex-wrap gap-2 p-[13px]">
        {trending.isPending ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-chip w-16 rounded-pill bg-surface-control" />
          ))
        ) : trending.isError ? (
          <div className="flex w-full flex-col items-center gap-2 p-1.5 text-center">
            <p className="text-[11px] font-semibold text-negative-strong">Couldn&apos;t load trending tags.</p>
            <Button variant="stroke" size="sm" onClick={() => void trending.refetch()} disabled={trending.isFetching}>
              {trending.isFetching ? 'Loading…' : 'Try again'}
            </Button>
          </div>
        ) : tags.length === 0 ? (
          <p className="text-[11px] font-medium text-n-6">No tags yet.</p>
        ) : (
          tags.map((tag) => (
            <TagChip key={tag.id} name={`#${tag.name}`} slug={tag.slug} />
          ))
        )}
      </div>
    </CollapsibleCard>
  )
}
