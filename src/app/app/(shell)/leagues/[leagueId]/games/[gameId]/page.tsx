export const metadata = { title: 'Game · FieldScout' }

/**
 * `/app/leagues/[leagueId]/games/[gameId]` — the NFL game screen. It is
 * rendered by `../layout.tsx` (it stays mounted while the picker switches
 * games, which a page under this segment can't), so the page itself adds
 * nothing.
 */
export default function NflGameRoute() {
  return null
}
