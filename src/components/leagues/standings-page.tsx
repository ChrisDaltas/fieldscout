'use client'

import Link from 'next/link'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useStandingsLive } from '@/hooks/use-standings'

import { PROJECTED_PENDING_COPY } from './standings-table-ops'
import { StandingsTable } from './standings-table'
import { ReconnectingBanner, STALE_LEAGUE_COPY, StaleDataBanner } from './status-banners'
import { ProblemCard, problemCopy } from './team-page'

/**
 * Standings page — §16.1 `…/leagues/[id]/standings` ("Standings + playoff
 * bracket"; the bracket is L.D1.8's, unbuilt behind Q39 — nothing here
 * pretends otherwise), M4 task L.D5.3 (PROGRESS D317).
 *
 * **Data, and who gates whom.** `useLeague` is the membership gate for the
 * whole page (the D316(4)/F249(a) posture): a non-member gets its 403/404
 * and nothing below mounts. `useStandingsLive` is 117's document through
 * the standings route (F247(b)'s scale normalised at the service; the
 * ranking is the RPC's — D297) plus the `league:<id>` room's `connection`
 * (F233(a) — one refcounted room, never a second `.channel(`), refetching
 * when a week FINALIZES and deliberately not on the score tick (D315(7)).
 *
 * **Final vs projected.** 117 reads final rows only and the live scores a
 * projection would need are L.D2.2's (behind B9), so the "projected" view
 * is rendered as PENDING BY NAME — a disabled segment with the honest label
 * — never folded from a datum the chain lacks (R801; PROGRESS F253).
 *
 * **The four states per surface (§16.5.4):** skeleton while the league or
 * the standings load · empty by REASON (`no_final_weeks`, designed copy over
 * the ranked all-zero rows) · error-with-retry (the league or the standings
 * read failed with nothing to show; ONE 404 copy, F250(a) — the service now
 * answers the family's copy too) · degraded (a refetch failed with last-good
 * rows on screen → the banner + the rows; the realtime drop → the
 * reconnecting banner).
 *
 * No clock here (§23.3 / the F226 fence): nothing on this page is an
 * instant.
 */
export function StandingsPage({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  if (league.isPending) return <StandingsSkeleton />
  if (league.isError || !league.data) {
    return (
      <ProblemCard
        heading="Standings"
        title="Couldn’t load this league."
        detail={problemCopy(league.error)}
        onRetry={() => league.refetch()}
        leagueId={null}
      />
    )
  }
  return <StandingsContent leagueId={leagueId} detail={league.data} />
}

function StandingsContent({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const { user } = useAuth()
  const standings = useStandingsLive(leagueId)
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const teamNames = new Map(detail.teams.map((t) => [t.id, t.name]))
  const problem = standings.isError
    ? standings.error instanceof Error
      ? standings.error
      : new Error(String(standings.error))
    : null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Standings"
        actions={
          <Button variant="stroke" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>
              <Icon name="cup" size={13} />
              {detail.league.name}
            </Link>
          </Button>
        }
      />

      {standings.connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
      {problem && standings.data && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segment aria-label="Standings view">
          <SegmentItem active>Final</SegmentItem>
          {/* PENDING BY NAME (R801/F253): live scoring is not on this chain. */}
          <SegmentItem active={false} disabled title={PROJECTED_PENDING_COPY} data-projected="pending">
            Projected
          </SegmentItem>
        </Segment>
        <div className="flex items-center gap-2">
          {detail.settings.schedule_mode === 'total_points' && <Badge variant="stroke">Total points</Badge>}
          {standings.data && (
            <span className="text-[11px] font-medium text-n-3">
              <span className="fs-num">{standings.data.weeks_final}</span> week{standings.data.weeks_final === 1 ? '' : 's'} final
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] font-medium text-n-3" data-projected-copy>
        {PROJECTED_PENDING_COPY}
      </p>

      {standings.isPending ? (
        <TableSkeleton />
      ) : problem && !standings.data ? (
        <ProblemCard
          heading="Standings"
          title="Couldn’t load the standings."
          detail={problemCopy(problem)}
          onRetry={() => standings.refetch()}
          leagueId={leagueId}
        />
      ) : standings.data ? (
        <StandingsTable
          doc={standings.data}
          settings={{ median_game: detail.settings.median_game, second_opponent: detail.settings.second_opponent }}
          teamNames={teamNames}
          highlightTeamId={myTeamId}
        />
      ) : null}
    </div>
  )
}

function StandingsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Standings" />
      <Skeleton className="h-7 w-48 rounded-sm" />
      <TableSkeleton />
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-skeleton="standings-table">
      <Skeleton className="h-6 w-80 rounded-sm" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-9 rounded-sm" />
      ))}
    </div>
  )
}
