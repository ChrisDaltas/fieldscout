'use client'

import { usePathname, useRouter } from 'next/navigation'

import { leagueFallbackTitle, leagueTabHref } from '@/components/mobile/shell/mobile-nav'
import { RoundNavButton } from '@/components/mobile/ui/mobile-header'
import { useLeagues } from '@/hooks/use-leagues'
import { featureFlags } from '@/lib/feature-flags'

/**
 * The mobile header for a league page that has no FieldScout Mobile screen
 * yet (settings, schedule, draft results, members, stats, commissioner
 * tools — all reached from the league Menu): the design's sub-screen row,
 * close on the left and the page's title centred, sticky over the page. The
 * page below keeps its own content. Close returns to the League tab.
 */
export function MobileLeagueFallbackHeader({ leagueId }: { leagueId: string }) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const { data: leagues } = useLeagues({ enabled: featureFlags.leagues })
  const title = leagueFallbackTitle(pathname)
  if (!title) return null
  const myTeamId = leagues?.find((l) => l.id === leagueId)?.my_team_id ?? null
  return (
    <div className="sticky top-0 z-10 -mx-4 -mt-5 mb-3 bg-m-b0 pt-[env(safe-area-inset-top)]" data-league-fallback-header>
      <div className="flex h-[52px] items-center gap-2 px-3">
        <RoundNavButton kind="close" label="Close" onClick={() => router.push(leagueTabHref(leagueId, 'league', myTeamId))} />
        <h1 className="flex-1 text-center text-[16px] font-semibold text-m-t1">{title}</h1>
        <span className="w-9 flex-none" />
      </div>
    </div>
  )
}
