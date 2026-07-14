'use client'

import { ExploreFeed } from '@/components/explore/explore-feed'
import { TopScoutsCard } from '@/components/explore/top-scouts-card'
import { TrendingTagsCard } from '@/components/explore/trending-tags-card'
import { PageHeader } from '@/components/layout/app-header'
import { TwoColumnLayout } from '@/components/layout/two-column-layout'

/**
 * Community (package screen 08) — the social surface: explore other users'
 * public lists and rankings (moved here from Home). Feed fills the main
 * column; the top-scouts leaderboard + trending tags sit in the capped
 * context column (collapsible menus on mobile).
 */
export default function ExplorePage() {
  return (
    <>
      <PageHeader title="Community" />

      <TwoColumnLayout
        main={<ExploreFeed />}
        aside={
          <>
            <TopScoutsCard />
            <TrendingTagsCard />
          </>
        }
      />
    </>
  )
}
