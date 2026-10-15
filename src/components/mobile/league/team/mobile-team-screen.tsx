'use client'

import Link from 'next/link'

import { problemCopy } from '@/components/leagues/team-page'
import { MobileLeagueHeader } from '@/components/mobile/league/league/league-header'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useLeague } from '@/hooks/use-league'

import { MyTeamTab } from './my-team-tab'
import { TeamView } from './team-view'

/**
 * `…/leagues/[id]/team/[teamId]` on mobile. The app has one route for both
 * of the handoff's screens: YOUR team is the League › Team tab (§2.1); any
 * other team is the full-screen Team view (§2.3). `mine` (the dock's link
 * before the league list has loaded) resolves to your team. `useLeague`
 * gates membership before anything else mounts (the desktop page's D316).
 */
export function MobileTeamScreen({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const league = useLeague(leagueId)
  const { user, isLoading: authLoading } = useAuth()

  // Wait for the session too: which screen this is (your team or another)
  // depends on who is looking — never flash the Team view over your own team.
  if (league.isPending || (!user && authLoading)) {
    return (
      <MobileScreen header={<div className="h-[49px] border-b border-m-b3" />}>
        <div className="flex flex-col gap-2 px-3 pt-3" aria-busy="true" data-skeleton="team">
          <div className="h-[157px] rounded-[18px] bg-m-b1" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[58px] rounded-[14px] bg-m-b1" />
          ))}
        </div>
      </MobileScreen>
    )
  }
  if (league.isError || !league.data) {
    return (
      <MobileScreen>
        <Message title="Couldn’t load this league." detail={problemCopy(league.error)} retry={() => void league.refetch()} back="/app/leagues" />
      </MobileScreen>
    )
  }
  const detail = league.data
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const resolved = teamId === 'mine' ? myTeamId : teamId

  if (teamId === 'mine' && !myTeamId) {
    return (
      <MobileScreen header={<MobileLeagueHeader leagueName={detail.league.name} />}>
        <Message title="You don’t manage a team in this league." detail="You can follow every team from the League tab." back={`/app/leagues/${leagueId}`} />
      </MobileScreen>
    )
  }
  if (!resolved || !detail.teams.some((t) => t.id === resolved)) {
    return (
      <MobileScreen header={<MobileLeagueHeader leagueName={detail.league.name} />}>
        <Message title="This team isn’t a franchise of this league." detail="Check the link — a team lives in exactly one league." back={`/app/leagues/${leagueId}`} />
      </MobileScreen>
    )
  }
  if (resolved === myTeamId) return <MyTeamTab leagueId={leagueId} teamId={resolved} detail={detail} />
  return <TeamView leagueId={leagueId} teamId={resolved} detail={detail} />
}

function Message({ title, detail, retry, back }: { title: string; detail: string; retry?: () => void; back: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center" role="alert">
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="text-[13px] font-medium text-m-t3">{detail}</p>
      <div className="mt-2 flex gap-2">
        {retry && (
          <button type="button" onClick={retry} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold">
            Retry
          </button>
        )}
        <Link href={back} className="flex h-9 items-center rounded-pill bg-m-b2 px-4 text-[13px] font-semibold">
          Back to league
        </Link>
      </div>
    </div>
  )
}
