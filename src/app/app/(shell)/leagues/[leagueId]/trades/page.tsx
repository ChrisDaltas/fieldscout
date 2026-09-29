import { TradesPage } from '@/components/leagues/trade-center'

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
 * from a player row and a team page.
 */
export default async function LeagueTradesRoute({ params, searchParams }: TradesRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  const one = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : null)
  return <TradesPage leagueId={leagueId} initialWith={one(query.with)} initialPlayer={one(query.player)} />
}
