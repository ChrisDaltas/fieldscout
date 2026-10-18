import { ByLayout } from '@/components/mobile/by-layout'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'
import { NflGameRouteScreen } from '@/components/mobile/league/game/nfl-game-screen'

interface NflGamesLayoutProps {
  children: React.ReactNode
  params: Promise<{ leagueId: string }>
}

/**
 * The NFL game screen (gap list §3 #17; FieldScout Mobile handoff m-match
 * §2.3) — one game's box score, opened from a starter's game line. A phone
 * screen only: the desktop layout has no such page, so a desktop visit (a
 * shared link, a widened window) goes to the league's matchup. Covered by
 * the `(shell)/leagues/layout.tsx` flag gate; the game data is
 * world-readable, the strip's matchup is a member read (`useLeague` first).
 *
 * It renders HERE, above `[gameId]`, not in that page: Next remounts a page
 * whenever its dynamic segment changes, so a screen in the page would drop
 * its bar and game picker (and the picker's scroll) every time the picker
 * switches games. This layout stays mounted across games; the screen reads
 * the id from the URL and keeps the last game up while the next one loads.
 */
export default async function NflGamesLayout({ children, params }: NflGamesLayoutProps) {
  const { leagueId } = await params
  return (
    <>
      <ByLayout desktop={<DesktopRedirect href={`/app/leagues/${leagueId}/matchup`} />} mobile={<NflGameRouteScreen leagueId={leagueId} />} />
      {children}
    </>
  )
}
