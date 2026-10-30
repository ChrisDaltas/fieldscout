'use client'

import { AiExpertShelf } from '@/components/home/ai-expert-shelf'
import { HomeCommunityCard } from '@/components/home/home-community-card'
import { HomeQuickActions } from '@/components/home/home-quick-actions'
import { InjuryNewsCard } from '@/components/home/injury-news-card'
import { RecentlyViewed } from '@/components/home/recently-viewed'
import { TrendingPlayersCard } from '@/components/home/trending-players-card'
import { YourLeagues } from '@/components/home/your-leagues'
import { PageHeader } from '@/components/layout/app-header'
import { TwoColumnLayout } from '@/components/layout/two-column-layout'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileHome } from '@/components/mobile/home/mobile-home'
import { featureFlags } from '@/lib/feature-flags'

/**
 * Home — the jump-off hub (v7 account Home). Sections sit 31px apart; inside
 * the hub grid cards sit 10px apart: the viewer's real league cards on the
 * left, then — while Community is switched on — "From the Community" (plan
 * C8), trending / injuries on the right. FieldScout-only
 * surfaces v7 doesn't show (AI experts shelf, recently viewed) keep their data
 * wiring and render full-width below the hub grid in the same card language.
 * The title stays the shell's standard page header (one header per page —
 * `page-header-rule.test.ts`), with the quick actions as its v7 pills.
 *
 * v7's Scout AI card and Top waiver adds were removed (Chris, 2026-10-15,
 * mobile gap list #15 — his explicit exception to "delete nothing"): both
 * were hard-coded sample data with no source behind them. They return only
 * when a real Scout AI insight source / waiver feed exists.
 */
export default function AppHomePage() {
  // Mobile has its own Home (FieldScout Mobile — `components/mobile/home`).
  return <ByLayout desktop={<DesktopHome />} mobile={<MobileHome />} />
}

function DesktopHome() {
  return (
    <div className="space-y-[31px]">
      <PageHeader title="Home" actions={<HomeQuickActions />} />

      {featureFlags.leagues ? (
        <TwoColumnLayout
          main={
            <div className="flex min-w-0 flex-col gap-[10px]">
              <YourLeagues />
              {featureFlags.community && <HomeCommunityCard />}
            </div>
          }
          aside={
            <>
              <TrendingPlayersCard />
              <InjuryNewsCard />
            </>
          }
        />
      ) : (
        // Leagues release gate off: no draft hero / league cards / waiver
        // feed — research content takes over the hub grid.
        <TwoColumnLayout
          main={
            <div className="flex min-w-0 flex-col gap-[10px]">
              <TrendingPlayersCard />
              {featureFlags.community && <HomeCommunityCard />}
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
