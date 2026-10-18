import { ByLayout } from '@/components/mobile/by-layout'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'
import { NflGameScreen } from '@/components/mobile/league/game/nfl-game-screen'

export const metadata = { title: 'Game · FieldScout' }

interface NflGameRouteProps {
  params: Promise<{ leagueId: string; gameId: string }>
}

/** The id as stored (`nfl_games.id`, e.g. "2026-wk01-BUF@KC"): the segment
 *  arrives encoded or not depending on the link, so decode it once. */
function gameIdOf(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * The NFL game screen (gap list §3 #17; FieldScout Mobile handoff m-match
 * §2.3) — one game's box score, opened from a starter's game line. A phone
 * screen only: the desktop layout has no such page, so a desktop visit (a
 * shared link, a widened window) goes to the league's matchup. Covered by
 * the `(shell)/leagues/layout.tsx` flag gate; the game data is
 * world-readable, the strip's matchup is a member read (`useLeague` first).
 */
export default async function NflGameRoute({ params }: NflGameRouteProps) {
  const { leagueId, gameId } = await params
  return (
    <ByLayout
      desktop={<DesktopRedirect href={`/app/leagues/${leagueId}/matchup`} />}
      mobile={<NflGameScreen leagueId={leagueId} gameId={gameIdOf(gameId)} />}
    />
  )
}
