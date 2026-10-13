'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useScheduleLive } from '@/hooks/use-schedule'

import { Crest, LeaguePageTitle, TeamNameLink } from './league-cells'
import { leagueBase } from './league-shell-ops'
import {
  H2H_TITLE,
  NO_GAMES_COPY,
  NO_TEAM_COPY,
  SEASON_ONLY_COPY,
  STATS_TITLE,
  TOTAL_POINTS_COPY,
  headToHead,
  overall,
  pointsText,
  recordText,
} from './stats-page-ops'
import { ReconnectingBanner, STALE_LEAGUE_COPY, StaleDataBanner } from './status-banners'
import { ProblemCard, problemCopy } from './team-page'

/**
 * League Stats — `/app/leagues/[id]/stats` (League UX batch 5; the
 * prototype's `StatsTab`): a team's head-to-head record against every
 * opponent — W–L, points for and against — from the stored results the
 * schedule read carries (`stats-page-ops.ts`). The viewer's own team by
 * default; any team can be picked. One season per league, so no season
 * filter. Membership is `useLeague`'s gate, as on every league page.
 */
export function StatsPage({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  if (league.isPending) return <StatsSkeleton />
  if (league.isError || !league.data) {
    return <ProblemCard heading={STATS_TITLE} title="Couldn’t load this league." detail={problemCopy(league.error)} onRetry={() => league.refetch()} leagueId={null} />
  }
  return <StatsContent leagueId={leagueId} detail={league.data} />
}

function StatsContent({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const { user } = useAuth()
  const schedule = useScheduleLive(leagueId)
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const teams = useMemo(() => detail.teams.filter((t) => t.status !== 'retired'), [detail.teams])
  const names = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const [picked, setPicked] = useState<string | null>(null)
  const teamId = picked ?? myTeamId ?? null
  const rows = useMemo(() => (teamId && schedule.data ? headToHead(schedule.data.matchups, teamId, names) : []), [teamId, schedule.data, names])
  const total = overall(rows)
  const totalPoints = detail.settings.schedule_mode === 'total_points'
  const problem = schedule.isError ? schedule.error : null

  return (
    <div className="flex flex-col gap-4" data-stats-page>
      <LeaguePageTitle
        title={STATS_TITLE}
        actions={
          <Button variant="stroke" size="sm" asChild>
            <Link href={`${leagueBase(leagueId)}/standings`} data-stats-standings>
              Standings
            </Link>
          </Button>
        }
      />
      {schedule.connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
      {problem && schedule.data && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}

      {totalPoints ? (
        <EmptyNote copy={TOTAL_POINTS_COPY} data-empty="total-points" />
      ) : problem && !schedule.data ? (
        <ProblemCard heading={H2H_TITLE} title="Couldn’t load the results." detail={problemCopy(problem)} onRetry={() => schedule.refetch()} leagueId={leagueId} />
      ) : !schedule.data ? (
        <Skeleton className="h-40 rounded-2xl bg-surface-control" />
      ) : (
        <Card className="overflow-hidden" data-h2h={teamId ?? ''}>
          <CardHeader className="min-h-0 border-b-0 px-[15px] pb-2.5 pt-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-[13px] font-bold tracking-[-0.02em]">
              {H2H_TITLE}
              <span className="ml-auto w-56 max-w-full">
                <Select value={teamId ?? ''} onValueChange={setPicked}>
                  <SelectTrigger className="h-btn-md" data-stats-team={teamId ?? ''} aria-label="Team">
                    <SelectValue placeholder="Pick a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.id === myTeamId ? `${t.name} (you)` : t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col p-0">
            {!teamId ? (
              <p className="border-t border-n-4 px-[15px] py-6 text-center text-[11px] font-medium text-n-6" data-empty="no-team">
                {NO_TEAM_COPY}
              </p>
            ) : rows.length === 0 ? (
              <p className="border-t border-n-4 px-[15px] py-6 text-center text-[11px] font-medium text-n-6" data-empty="no-games">
                {NO_GAMES_COPY}
              </p>
            ) : (
              // v7 stats table: 10px grey heads over a hairline, 11px rows on
              // hairlines with a grey hover, bold tabular numbers.
              <div className="border-t border-n-4 px-1.5">
                <Table className="text-[11px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-[31px] px-[9px]">Opponent</TableHead>
                      <TableHead className="h-[31px] px-[9px] text-right">W-L{total.ties > 0 ? '-T' : ''}</TableHead>
                      <TableHead className="h-[31px] px-[9px] text-right">PF</TableHead>
                      <TableHead className="h-[31px] px-[9px] text-right">PA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.opponentId} data-h2h-row={r.opponentId}>
                        <TableCell className="px-[9px] py-[5px]">
                          <span className="flex items-center gap-2">
                            <Crest name={r.opponentName} src={null} />
                            <TeamNameLink name={r.opponentName} leagueId={leagueId} teamId={r.opponentId} className="font-semibold text-ink" />
                          </span>
                        </TableCell>
                        <TableCell className="fs-num px-[9px] py-[5px] text-right font-bold text-ink" data-h2h-record>
                          {recordText(r)}
                        </TableCell>
                        <TableCell className="fs-num px-[9px] py-[5px] text-right font-medium text-n-2">{pointsText(r.pointsFor)}</TableCell>
                        <TableCell className="fs-num px-[9px] py-[5px] text-right font-medium text-n-2">{pointsText(r.pointsAgainst)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t border-n-4 hover:bg-transparent" data-h2h-total>
                      <TableCell className="px-[9px] py-2.5 text-[10px] font-semibold text-n-3">All opponents</TableCell>
                      <TableCell className="fs-num px-[9px] py-2.5 text-right text-[12px] font-bold text-ink">{recordText(total)}</TableCell>
                      <TableCell className="fs-num px-[9px] py-2.5 text-right text-[12px] font-bold text-ink">{pointsText(total.pointsFor)}</TableCell>
                      <TableCell className="fs-num px-[9px] py-2.5 text-right text-[12px] font-bold text-ink">{pointsText(total.pointsAgainst)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="border-t border-n-4 px-[15px] py-[9px] text-[10px] font-medium text-n-6">{SEASON_ONLY_COPY}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function EmptyNote({ copy, ...rest }: { copy: string } & Record<string, unknown>) {
  return (
    <Card>
      <CardContent className="px-card-pad py-10 text-center text-[11px] font-medium text-n-6" {...rest}>
        {copy}
      </CardContent>
    </Card>
  )
}

function StatsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <LeaguePageTitle title={STATS_TITLE} />
      <Skeleton className="h-40 rounded-2xl bg-surface-control" />
    </div>
  )
}
