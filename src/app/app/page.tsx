'use client'

import { AiExpertShelf } from '@/components/home/ai-expert-shelf'
import { HomeQuickActions } from '@/components/home/home-quick-actions'
import { InjuryNewsCard } from '@/components/home/injury-news-card'
import { LiveDraftHero } from '@/components/home/live-draft-hero'
import { RecentlyViewed } from '@/components/home/recently-viewed'
import { ScoutAiCard } from '@/components/home/scout-ai-card'
import { TrendingPlayersCard } from '@/components/home/trending-players-card'
import { WaiverAddsCard } from '@/components/home/waiver-adds-card'
import { YourLeagues } from '@/components/home/your-leagues'
import { PageHeader } from '@/components/layout/app-header'

/**
 * Home — the jump-off hub (package screen 01). Two columns ~1.55fr/1fr with a
 * 19px gap (24 × 0.8): live-draft hero + league cards on the left, Scout AI /
 * trending / waivers / injuries on the right. FieldScout-only surfaces the
 * mock doesn't show (AI experts shelf, recently viewed) keep their data
 * wiring and render full-width below the hub grid.
 */
export default function AppHomePage() {
  return (
    <div className="space-y-[19px]">
      <PageHeader title="Home" actions={<HomeQuickActions />} />

      <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.55fr_1fr]">
        <div className="flex min-w-0 flex-col gap-[19px]">
          <LiveDraftHero />
          <YourLeagues />
        </div>

        <div className="flex min-w-0 flex-col gap-[19px]">
          <ScoutAiCard />
          <TrendingPlayersCard />
          <WaiverAddsCard />
          <InjuryNewsCard />
        </div>
      </div>

      <RecentlyViewed />
      <AiExpertShelf />
    </div>
  )
}
