'use client'

import { usePathname, useRouter } from 'next/navigation'

import { leagueTabHref, mobileFallback } from '@/components/mobile/shell/mobile-nav'
import { RoundNavButton } from '@/components/mobile/ui/mobile-header'
import { useLeagues } from '@/hooks/use-leagues'
import { featureFlags } from '@/lib/feature-flags'

/**
 * The mobile header for a page that has no FieldScout Mobile screen yet:
 * the design's sub-screen row — close (league pages, opened from the league
 * Menu; back to the League tab) or back (account pages; history back, else
 * the page's parent) with the title centred — sticky over the page, which
 * keeps its own content. Rendered by the shell in the mobile layout only.
 */
export function MobileFallbackHeader() {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const { data: leagues } = useLeagues({ enabled: featureFlags.leagues })
  const fallback = mobileFallback(pathname)
  if (!fallback) return null
  const onNav = () => {
    if (fallback.kind === 'league') {
      const myTeamId = leagues?.find((l) => l.id === fallback.leagueId)?.my_team_id ?? null
      router.push(leagueTabHref(fallback.leagueId, 'league', myTeamId))
    } else if (window.history.length > 1) router.back()
    else router.replace(fallback.parent)
  }
  return (
    <div className="sticky top-0 z-10 -mx-4 -mt-5 mb-3 bg-m-b0 pt-[env(safe-area-inset-top)]" data-mobile-fallback-header>
      <div className="flex h-[52px] items-center gap-2 px-3">
        {fallback.kind === 'league' ? (
          <RoundNavButton kind="close" label="Close" onClick={onNav} />
        ) : (
          <RoundNavButton kind="back" label="Back" onClick={onNav} />
        )}
        <h1 className="flex-1 text-center text-[16px] font-semibold text-m-t1">{fallback.title}</h1>
        <span className="w-9 flex-none" />
      </div>
    </div>
  )
}
