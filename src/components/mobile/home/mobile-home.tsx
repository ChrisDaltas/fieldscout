'use client'

import { HeaderActions, LogoLockup, MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useLeagues } from '@/hooks/use-leagues'
import { featureFlags } from '@/lib/feature-flags'

import { HomeAiExperts, HomeRecentlyViewed } from './home-extras'
import { HomeInjuries } from './home-injuries'
import { HomeMatchups } from './home-matchups'
import { HomeMyStuff } from './home-my-stuff'
import { trendSeeAllHref } from './home-ops'
import { HomePractice } from './home-practice'
import { HomeTrending } from './home-trending'

/**
 * Home — the account root on mobile (FieldScout Mobile, m-home §2A). One
 * scroller with the header inside it (not sticky): logo + Search ·
 * Notifications · Messages, then My stuff, Matchups (leagues release), Join
 * or create, Trending players, Injury news and Practice (practice-draft
 * release). FieldScout surfaces the design doesn't show (Recently viewed,
 * the AI experts) follow below in the same language (`home-extras.tsx`);
 * the desktop's sample-data cards (Scout AI, Top waiver adds) are left out.
 * 16px gutters; 24px under the last section, above the shell's dock
 * clearance.
 */
export function MobileHome() {
  const leagues = useLeagues({ enabled: featureFlags.leagues })
  const myLeagues = featureFlags.leagues ? (leagues.data ?? []) : []
  return (
    <MobileScreen>
      <div className="px-4 pb-6">
        <div className="flex h-12 items-center justify-between">
          <LogoLockup />
          <HeaderActions />
        </div>
        <HomeMyStuff />
        {featureFlags.leagues && <HomeMatchups />}
        <HomeTrending seeAllHref={trendSeeAllHref(myLeagues)} />
        <HomeInjuries leagues={myLeagues} ready={!featureFlags.leagues || !leagues.isPending} />
        {featureFlags.mockDrafts && <HomePractice />}
        <HomeRecentlyViewed />
        <HomeAiExperts />
      </div>
    </MobileScreen>
  )
}
