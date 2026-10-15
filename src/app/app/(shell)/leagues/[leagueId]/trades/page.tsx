import { TradesRoute } from '@/components/mobile/trades/trades-route'

export const metadata = { title: 'Trades · FieldScout' }

interface TradesRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Trade center — §16.1 `…/leagues/[id]/trades` (M5 task L.D3.7). A SHELL page
 * covered by the `(shell)/leagues/layout.tsx` flag gate. Server shell; the
 * page is a client component (`useLeague` gates membership first — D316(4)).
 * `?with=<team>&player=<id>` opens the builder toward that team — the doors
 * from a player row and a team page. `TradesRoute` renders the desktop trade
 * center unchanged, or the FieldScout Mobile Trades page in the mobile
 * layout (which also reads `?trade=<id>` to open one trade).
 */
export default async function LeagueTradesRoute({ params, searchParams }: TradesRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  const one = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : null)
  return <TradesRoute leagueId={leagueId} initialWith={one(query.with)} initialPlayer={one(query.player)} initialTrade={one(query.trade)} />
}
