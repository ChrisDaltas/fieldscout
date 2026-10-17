import { Suspense } from 'react'

import { ExploreFeed } from '@/components/explore/explore-feed'
import { TopScoutsCard } from '@/components/explore/top-scouts-card'
import { TrendingTagsCard } from '@/components/explore/trending-tags-card'
import { PageHeader } from '@/components/layout/app-header'
import { TwoColumnLayout } from '@/components/layout/two-column-layout'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileCommunity } from '@/components/mobile/community/mobile-community'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'

/**
 * Community (package screen 08) — the social surface: explore other users'
 * public lists and rankings (moved here from Home). Feed fills the main
 * column; the top-scouts leaderboard + trending tags sit in the capped
 * context column. The mobile layout is its own screen (FieldScout Mobile
 * handoff, m-community).
 */
export default function ExplorePage() {
  return (
    <ByLayout
      desktop={
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
      }
      mobile={
        // Streams on its own, so reading the NFL week never holds up the
        // desktop tree.
        <Suspense fallback={null}>
          <MobileCommunityRoute />
        </Suspense>
      }
    />
  )
}

/** The mobile screen with the app's current NFL week (its Start or sit
 *  shelf is titled "Start or sit · Week N"). */
async function MobileCommunityRoute() {
  const currentWeek = await getCurrentNflWeek()
  return <MobileCommunity currentWeek={currentWeek} />
}
