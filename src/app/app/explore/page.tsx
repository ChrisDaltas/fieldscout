'use client'

import { ExploreFeed } from '@/components/explore/explore-feed'
import { TopScoutsCard } from '@/components/explore/top-scouts-card'
import { TrendingTagsCard } from '@/components/explore/trending-tags-card'
import { PageHeader } from '@/components/layout/app-header'

/**
 * Community (package screen 08) — the social surface: explore other users'
 * public lists and rankings (moved here from Home). 1.7fr/1fr grid with a
 * 19px gap (24 × 0.8): feed on the left, top-scouts leaderboard + trending
 * tags in a sticky right column.
 */
export default function ExplorePage() {
  return (
    <>
      <PageHeader title="Community" />

      <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.7fr_1fr]">
        <ExploreFeed />

        <div className="flex min-w-0 flex-col gap-[19px] lg:sticky lg:top-[77px]">
          <TopScoutsCard />
          <TrendingTagsCard />
        </div>
      </div>
    </>
  )
}
