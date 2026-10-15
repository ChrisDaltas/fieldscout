'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { activityRouteFrom, type ActivityRoute } from '@/components/leagues/activity-page-ops'
import { seasonStarted } from '@/components/leagues/league-shell-ops'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useLeague } from '@/hooks/use-league'

import { ActivitySegment } from './activity-segment'
import { CenteredNote, SkeletonBlocks } from './league-bits'
import { MobileLeagueHeader } from './league-header'
import { SEGMENTS, commishLogHref, correctionsScreenHref, segmentAtPath, segmentHref, standingsHref, type LeagueSegment } from './league-tab-ops'
import { useLeagueTabStore, useTxFilter } from './league-tab-store'
import { MatchupsSegment } from './matchups-segment'
import { StandingsSegment } from './standings-segment'

/**
 * League › League tab (FieldScout Mobile handoff, m-league.md): the league
 * header, the Matchups / Standings / Activity segmented control (it scrolls
 * with the page — not sticky), and the segment. The three segments keep the
 * app's three URLs (`/leagues/[id]`, `/standings`, `/activity`); switching is
 * instant (no navigation — the address follows along), the scroll position
 * is kept, and the last segment is remembered per league, so leaving the
 * League tab and coming back lands on the same one.
 *
 * The ADDRESS is the truth for what shows: a browser Back can restore this
 * page with an address the segment control rewrote (`replaceState`), so the
 * segment and the bracket are read from the address the page opens at, not
 * from which route file rendered it. `/standings?tab=playoffs` puts the
 * bracket over the table, and the address keeps `?tab=playoffs` while it
 * shows; leaving Standings closes it.
 *
 * `/activity?tab=commissioner` and `?tab=corrections` (the desktop doors —
 * a ✸ badge, the old `/corrections` link) move on to their own full screens,
 * `/activity/commissioner` and `/activity/corrections`.
 */
export function MobileLeagueTab({
  leagueId,
  segment,
  standingsTab = 'standings',
  activityInitial,
}: {
  leagueId: string
  /** The route's segment; null on the league page (the remembered one). */
  segment: LeagueSegment | null
  standingsTab?: 'standings' | 'playoffs'
  /** The Activity route's parse of its query (the server's). */
  activityInitial?: ActivityRoute
}) {
  const searchParams = useSearchParams()
  const activityRoute = activityInitial ? activityRouteFrom(searchParams, activityInitial) : null
  if (activityRoute && (activityRoute.tab === 'commissioner' || activityRoute.tab === 'corrections')) {
    return <ActivityDoor leagueId={leagueId} route={activityRoute} />
  }
  return (
    <LeagueTabScreen
      leagueId={leagueId}
      routeSegment={segment}
      routeBracket={segment === 'standings' && standingsTab === 'playoffs'}
      tradesDoor={activityRoute?.tab === 'trades'}
    />
  )
}

/** What the address shows: its segment (the league page → the remembered
 *  one) and whether the bracket is open. Undefined off the client. */
function fromAddress(leagueId: string): { segment: LeagueSegment | null; bracket: boolean } | undefined {
  if (typeof window === 'undefined') return undefined
  const segment = segmentAtPath(window.location.pathname, leagueId)
  if (segment === undefined) return undefined
  return { segment, bracket: segment === 'standings' && new URLSearchParams(window.location.search).get('tab') === 'playoffs' }
}

function LeagueTabScreen({
  leagueId,
  routeSegment,
  routeBracket,
  tradesDoor,
}: {
  leagueId: string
  routeSegment: LeagueSegment | null
  routeBracket: boolean
  tradesDoor: boolean
}) {
  const league = useLeague(leagueId)
  const { user } = useAuth()
  const remembered = useLeagueTabStore((s) => s.segments[leagueId])
  const remember = useLeagueTabStore((s) => s.setSegment)
  const [initial] = useState(() => fromAddress(leagueId) ?? { segment: routeSegment, bracket: routeBracket })
  const [segment, setSegment] = useState<LeagueSegment>(() => initial.segment ?? remembered ?? 'matchups')
  const [bracket, setBracket] = useState(initial.bracket)
  const [, setFilter] = useTxFilter(leagueId)

  // A desktop "Trades" door (`/activity?tab=trades`) opens Activity on Trades.
  useEffect(() => {
    if (tradesDoor) setFilter({ type: 'Trades' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per door
  }, [tradesDoor, leagueId])

  // The segment is remembered and the address follows it (and the bracket),
  // without a navigation (instant switch, scroll kept).
  useEffect(() => {
    remember(leagueId, segment)
    const href = segment === 'standings' ? standingsHref(leagueId, bracket) : segmentHref(leagueId, segment)
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(window.history.state, '', href)
  }, [leagueId, segment, bracket, remember])

  const choose = (next: LeagueSegment) => {
    if (next !== 'standings') setBracket(false)
    setSegment(next)
  }

  const data = league.data
  const myTeamId = data?.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null

  return (
    <MobileScreen header={<MobileLeagueHeader leagueName={data?.league.name ?? ''} leagueId={leagueId} />}>
      <div className="px-4 pb-1 pt-3">
        <MSegmented
          options={SEGMENTS}
          value={segment}
          onChange={choose}
          label="League"
          className="gap-0 rounded-pill p-[3px]"
          itemClassName="h-[30px] rounded-pill text-[13px] font-semibold text-m-t1 transition-none"
          shadow="m-seg-3"
        />
      </div>
      {league.isPending ? (
        <div className="px-3 pt-2.5">
          <SkeletonBlocks count={4} className="h-[90px]" />
        </div>
      ) : !data ? (
        <CenteredNote role="alert" message="Couldn’t load this league." action="Back to leagues" href="/app/leagues" />
      ) : segment === 'matchups' ? (
        <MatchupsSegment leagueId={leagueId} detail={data} myTeamId={myTeamId} viewerId={user?.id ?? null} />
      ) : segment === 'standings' ? (
        seasonStarted(data.league.status) ? (
          <StandingsSegment leagueId={leagueId} detail={data} myTeamId={myTeamId} showBracket={bracket} onCloseBracket={() => setBracket(false)} />
        ) : (
          <CenteredNote message="Standings open after the draft, when the season starts." />
        )
      ) : (
        <ActivitySegment leagueId={leagueId} detail={data} myTeamId={myTeamId} />
      )}
    </MobileScreen>
  )
}

/** A desktop Activity-tab door on mobile: on to the full screen it names. */
function ActivityDoor({ leagueId, route }: { leagueId: string; route: ActivityRoute }) {
  const router = useRouter()
  const href = route.tab === 'commissioner' ? commishLogHref(leagueId, route) : correctionsScreenHref(leagueId, route.week)
  useEffect(() => {
    router.replace(href)
  }, [router, href])
  return (
    <MobileScreen>
      <CenteredNote role="status" message="Opening…" />
    </MobileScreen>
  )
}
