'use client'

import Link from 'next/link'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { usePlayoffBracketLive } from '@/hooks/use-playoff-bracket'
import { useProjectedStandingsLive, useStandingsLive } from '@/hooks/use-standings'

import { PlayoffBracket } from './playoff-bracket'
import { PROJECTED_COPY } from './standings-table-ops'
import { StandingsTable } from './standings-table'
import { ReconnectingBanner, STALE_LEAGUE_COPY, StaleDataBanner } from './status-banners'
import { ProblemCard, problemCopy } from './team-page'

export type StandingsTab = 'standings' | 'playoffs'
export type StandingsView = 'final' | 'projected'

/**
 * Standings page — §16.1 `…/leagues/[id]/standings` ("Standings + playoff
 * bracket — the 'Playoffs' tab shows the bracket ALL SEASON: what it would
 * be if the playoffs started today", v2.16.25 / Q39 (E)), M4 tasks L.D5.3
 * (PROGRESS D317) and L.D5.5 (D326).
 *
 * **Two tabs, ONE control** (`ui/tabs.tsx` — Radix `Tabs`, a genuine tab
 * set: one panel per trigger). "Standings" is L.D5.3's table; "Playoffs"
 * is `playoff-bracket.tsx` over 118's `league_playoff_bracket`. The initial
 * tab is the route's `?tab=` (the league home's hero deep-links the
 * bracket); switching is local state.
 *
 * **Data, and who gates whom.** `useLeague` is the membership gate for the
 * whole page (the D316(4)/F249(a) posture). `useStandingsLive` is 117's
 * FINAL document; `useProjectedStandingsLive` is 118's PROJECTED one
 * (`?view=projected` — the same chain over the open weeks "as if they
 * ended now", D318(3)), fetched only while the `Projected` segment is
 * selected; `usePlayoffBracketLive` is the bracket, fetched only while its
 * tab shows. All three JOIN the one refcounted `league:<id>` room (F233(a)
 * — never a second `.channel(`), each with its own derived handler map.
 *
 * **Final vs projected — LIVE (L.D5.5).** The `Final | Projected` segment
 * switches the READ; nothing is projected client-side. D317(3)'s
 * pending-by-name copy retired with the data source.
 *
 * **The four states per surface (§16.5.4):** skeleton while the league or
 * a document loads · empty by REASON (`no_final_weeks`; the bracket's
 * shapes are each designed copy) · error-with-retry (ONE 404 copy,
 * F250(a)) · degraded (a refetch failed with last-good data on screen →
 * the banner + the data; the realtime drop → the reconnecting banner).
 *
 * No clock here (§23.3 / the F226 fence): the bracket's rollover is a
 * stored instant formatted for the viewer.
 */
export function StandingsPage({ leagueId, initialTab = 'standings' }: { leagueId: string; initialTab?: StandingsTab }) {
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
  return <StandingsContent leagueId={leagueId} detail={league.data} initialTab={initialTab} />
}

function StandingsContent({ leagueId, detail, initialTab }: { leagueId: string; detail: LeagueDetail; initialTab: StandingsTab }) {
  const { user } = useAuth()
  const [tab, setTab] = useState<StandingsTab>(initialTab)
  const [view, setView] = useState<StandingsView>('final')
  const finalStandings = useStandingsLive(leagueId)
  const projected = useProjectedStandingsLive(leagueId, view === 'projected')
  const bracket = usePlayoffBracketLive(leagueId, tab === 'playoffs')
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const teamNames = new Map(detail.teams.map((t) => [t.id, t.name]))
  const leagueTimeZone = detail.settings.draft.time_zone ?? null

  const standings = view === 'projected' ? projected : finalStandings
  const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
  const standingsProblem = standings.isError ? asError(standings.error) : null
  const bracketProblem = bracket.isError ? asError(bracket.error) : null
  const reconnecting = finalStandings.connection === 'reconnecting' || projected.connection === 'reconnecting' || bracket.connection === 'reconnecting'

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

      {reconnecting && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}

      <Tabs value={tab} onValueChange={(value) => setTab(value as StandingsTab)}>
        <TabsList aria-label="Standings page" data-standings-tabs>
          <TabsTrigger value="standings" data-tab="standings">
            Standings
          </TabsTrigger>
          <TabsTrigger value="playoffs" data-tab="playoffs">
            Playoffs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="standings" className="flex flex-col gap-4" data-tab-panel="standings">
          {standingsProblem && standings.data && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segment aria-label="Standings view">
              <SegmentItem active={view === 'final'} onClick={() => setView('final')} data-view="final">
                Final
              </SegmentItem>
              <SegmentItem active={view === 'projected'} onClick={() => setView('projected')} data-view="projected">
                Projected
              </SegmentItem>
            </Segment>
            <div className="flex items-center gap-2">
              {detail.settings.schedule_mode === 'total_points' && <Badge variant="stroke">Total points</Badge>}
              {standings.data && (
                <span className="text-[11px] font-medium text-n-3" data-weeks-counted>
                  <span className="fs-num">{standings.data.weeks_final}</span> week{standings.data.weeks_final === 1 ? '' : 's'} final
                  {standings.data.projected && (
                    <>
                      {' · '}
                      <span className="fs-num">{standings.data.weeks_projected}</span> projected
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
          {view === 'projected' && (
            <p className="text-[11px] font-medium text-n-3" data-projected-copy>
              {PROJECTED_COPY}
            </p>
          )}

          {standings.isPending ? (
            <TableSkeleton />
          ) : standingsProblem && !standings.data ? (
            <ProblemCard
              heading="Standings"
              title="Couldn’t load the standings."
              detail={problemCopy(standingsProblem)}
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
        </TabsContent>

        <TabsContent value="playoffs" className="flex flex-col gap-4" data-tab-panel="playoffs">
          {bracketProblem && bracket.data && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
          {bracket.isPending ? (
            <BracketSkeleton />
          ) : bracketProblem && !bracket.data ? (
            <ProblemCard
              heading="Standings"
              title="Couldn’t load the bracket."
              detail={problemCopy(bracketProblem)}
              onRetry={() => bracket.refetch()}
              leagueId={leagueId}
            />
          ) : bracket.data ? (
            <PlayoffBracket
              doc={bracket.data}
              teamNames={teamNames}
              leagueTimeZone={leagueTimeZone}
              myRole={detail.my_role}
              myTeamId={myTeamId}
              finalStandings={finalStandings.data?.standings ?? null}
            />
          ) : null}
        </TabsContent>
      </Tabs>
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

export function BracketSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-skeleton="playoff-bracket">
      <Skeleton className="h-6 w-64 rounded-sm" />
      <div className="flex flex-col gap-3 md:flex-row">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 flex-1 rounded-sm" />
        ))}
      </div>
    </div>
  )
}
