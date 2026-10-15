'use client'

import { LogoTile } from '@/components/landing/fieldscout-logo'
import { HeaderActions, HeaderIconButton } from '@/components/mobile/ui/mobile-header'

/**
 * The league header (handoff m-league §2.0): a 48px row over a 1px b3 rule —
 * the logo tile (not tappable), the Home button, the league name (13/600,
 * ellipsis) and Search · Notifications · Messages. It stays put while the
 * page scrolls (the screen's sticky header band).
 */
export function MobileLeagueHeader({ leagueName }: { leagueName: string }) {
  return (
    <div className="border-b border-m-b3 px-3" data-mobile-league-header>
      <div className="flex h-12 items-center gap-2.5">
        <span className="ml-1 flex-none" role="img" aria-label="FieldScout">
          <LogoTile size={28} markSize={15} className="bg-brand" />
        </span>
        <div className="-ml-1.5 flex-none">
          <HeaderIconButton icon="houseHeader" label="Home" href="/app" />
        </div>
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[13px] font-semibold text-m-t1">{leagueName}</span>
        <HeaderActions />
      </div>
    </div>
  )
}
