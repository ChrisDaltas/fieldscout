'use client'

import { CollapsibleCard } from '@/components/layout/two-column-layout'
import { TagChip } from '@/components/lists/tag-chip'
import { Skeleton } from '@/components/ui/skeleton'
import { useTags } from '@/hooks/use-tags'

const TAG_COUNT = 8

/**
 * "Trending tags" card (package screen 08, right column) — real tags ranked
 * by use count, each linking to its public /tag/[tag] feed via the canonical
 * TagChip.
 */
export function TrendingTagsCard() {
  const { data, isLoading } = useTags({ trending: true })
  const tags = (data?.tags ?? []).slice(0, TAG_COUNT)

  return (
    <CollapsibleCard title="Trending tags">
      <div className="flex flex-wrap gap-2 p-[13px]">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-chip w-16" />
          ))
        ) : tags.length === 0 ? (
          <p className="text-[11px] font-medium text-n-3">No tags yet.</p>
        ) : (
          tags.map((tag) => (
            <TagChip key={tag.id} name={`#${tag.name}`} slug={tag.slug} />
          ))
        )}
      </div>
    </CollapsibleCard>
  )
}
