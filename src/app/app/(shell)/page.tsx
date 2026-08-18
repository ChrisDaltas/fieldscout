'use client'

import { AiExpertShelf } from '@/components/home/ai-expert-shelf'
import { HomeQuickActions } from '@/components/home/home-quick-actions'
import { InjuryNewsCard } from '@/components/home/injury-news-card'
import { RecentlyViewed } from '@/components/home/recently-viewed'
import { ScoutAiCard } from '@/components/home/scout-ai-card'
import { TrendingPlayersCard } from '@/components/home/trending-players-card'
import { WaiverAddsCard } from '@/components/home/waiver-adds-card'
import { YourLeagues } from '@/components/home/your-leagues'
import { PageHeader } from '@/components/layout/app-header'
import { TwoColumnLayout } from '@/components/layout/two-column-layout'
import { featureFlags } from '@/lib/feature-flags'

/**
 * Home — the jump-off hub (package screen 01). Two columns ~1.55fr/1fr with a
 * 19px gap (24 × 0.8): the viewer's real league cards on the left, Scout AI /
 * trending / waivers / injuries on the right. FieldScout-only surfaces the
 * mock doesn't show (AI experts shelf, recently viewed) keep their data
 * wiring and render full-width below the hub grid.
 */
export default function AppHomePage() {
  return (
    <div className="space-y-[19px]">
      <PageHeader title="Home" actions={<HomeQuickActions />} />

      {featureFlags.leagues ? (
        <TwoColumnLayout
          main={
            <div className="flex min-w-0 flex-col gap-[19px]">
              <YourLeagues />
            </div>
          }
          aside={
            <>
              <ScoutAiCard />
              <TrendingPlayersCard />
              <WaiverAddsCard />
              <InjuryNewsCard />
            </>
          }
        />
      ) : (
        // Leagues release gate off: no draft hero / league cards / waiver
        // feed — research content takes over the hub grid.
        <TwoColumnLayout
          main={
            <div className="flex min-w-0 flex-col gap-[19px]">
              <ScoutAiCard />
              <TrendingPlayersCard />
            </div>
          }
          aside={<InjuryNewsCard />}
        />
      )}

      <RecentlyViewed />
      <AiExpertShelf />
    </div>
  )
}
