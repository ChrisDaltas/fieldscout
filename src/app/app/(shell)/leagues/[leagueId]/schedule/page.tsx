import { ScheduleView } from '@/components/leagues/schedule-view'

export const metadata = { title: 'Schedule · FieldScout' }

interface ScheduleRouteProps {
  params: Promise<{ leagueId: string }>
}

/**
 * Season schedule — §16.1 `…/leagues/[id]/schedule` ("member view; commish:
 * edit + Remix §11.7"), M4 task L.D5.3. A SHELL page under the
 * `(shell)/leagues/layout.tsx` flag gate; the page is a client component
 * (`useLeague` gates membership first — D316(4)). The Remix modal and the
 * edit affordances render for a commissioner only, and the routes refuse
 * anyone else by name regardless.
 */
export default async function LeagueScheduleRoute({ params }: ScheduleRouteProps) {
  const { leagueId } = await params
  return <ScheduleView leagueId={leagueId} />
}
