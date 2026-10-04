'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { PageHeader } from '@/components/layout/app-header'
import { LeagueAvailabilityRow, LeagueCardActions } from '@/components/players/player-card-actions'
import { PlayerDetailActions } from '@/components/players/player-detail-actions'
import { PlayerDetailHeader } from '@/components/players/player-detail-header'
import {
  GameLogPanel,
  StatsPanel,
  WeeklyPointsList,
} from '@/components/players/player-detail-panels'
import {
  nextScheduled,
  playerPageHref,
  scheduleRows,
  scoutMatchupRead,
  type ScheduleRow,
} from '@/components/players/player-page-ops'
import { AIInsight } from '@/components/ui/ai-insight'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDefenseSplits } from '@/hooks/use-defense-splits'
import { useLeague } from '@/hooks/use-league'
import { useLeagues } from '@/hooks/use-leagues'
import { useNflTeamSchedule } from '@/hooks/use-nfl-team-schedule'
import { usePlayerCoreStats } from '@/hooks/use-player-core-stats'
import {
  usePlayerStats,
  type PlayerStatsPlayer,
  type PlayerStatsResponse,
} from '@/hooks/use-player-stats'
import { featureFlags } from '@/lib/feature-flags'
import {
  basisLabel,
  choiceValue,
  coreTiles,
  resolveChoice,
  SCORING_CHOICE_STORAGE_KEY,
  scoringOptions,
  systemLabel,
} from '@/lib/players/core-stats-ops'
import { cn } from '@/lib/utils'

interface PlayerDetailPageViewProps {
  playerId: string
  /** Opened from a league (`?league=`): the league-scoped variant. */
  leagueId?: string | null
}

/**
 * Full player page — built to the Claude Design prototype's PlayerPage
 * (Chris 2026-10-04): a ghost Back, the hero card (identity + vitals left,
 * the actions column right), the Scout AI matchup read when real data
 * supports one, then the tab set. Reuses the card's pieces — its league
 * actions, its per-league rows, its weekly / stats lists.
 */
export function PlayerDetailPageView({ playerId, leagueId = null }: PlayerDetailPageViewProps) {
  const { data, isLoading, error } = usePlayerStats(playerId)
  const router = useRouter()
  const inLeague = featureFlags.leagues && !!leagueId

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/app/research')
  }

  const pageHeader = (
    <PageHeader
      title={
        <Button variant="ghost" size="sm" onClick={goBack} data-player-back>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      }
    />
  )

  if (isLoading) {
    return (
      <div className="max-w-[944px] space-y-4">
        {pageHeader}
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-[944px] space-y-4">
        {pageHeader}
        <Card className="p-card-pad">
          <p className="text-h6">Player not found</p>
          <p className="mt-1 text-[13px] font-medium text-negative-strong">
            {error?.message ?? 'This player may have moved or been removed.'}
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-[944px] space-y-4" data-player-page={inLeague ? 'league' : 'global'}>
      {pageHeader}

      {/* Hero — not interactive, so no resting shadow (CLAUDE.md elevation rule). */}
      <Card>
        <div className="flex flex-col gap-6 p-card-pad sm:p-5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <PlayerDetailHeader player={data.player} size="expanded" />
          </div>
          <ActionsColumn player={data.player} leagueId={inLeague ? leagueId : null} />
        </div>
        <CoreStatsRow player={data.player} leagueId={inLeague ? leagueId : null} />
      </Card>

      <ScheduleSections data={data} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Core stats row (D486(10)) — Chris's seven tiles, in his order
// ---------------------------------------------------------------------------

/**
 * Season points, avg / week, this week's projection and the two ranks come
 * from the server (`/api/players/[id]/core-stats`) under the league's scoring
 * in a league, the default template outside one; SOS and bye from the player
 * record. A value with no source is "—", never 0. Not interactive → no
 * shadow (CLAUDE.md elevation rule).
 */
function readStoredChoice(): string | null {
  try {
    return window.localStorage.getItem(SCORING_CHOICE_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredChoice(v: string) {
  try {
    window.localStorage.setItem(SCORING_CHOICE_STORAGE_KEY, v)
  } catch {
    // Private window / blocked storage — the choice just isn't remembered.
  }
}

export function CoreStatsRow({ player, leagueId }: { player: PlayerStatsPlayer; leagueId: string | null }) {
  // R1501's fallback: a `?league=` the viewer can't read scores by default.
  const league = useLeague(featureFlags.leagues && leagueId ? leagueId : undefined)
  const leagueParam = leagueId && !league.isError ? leagueId : null
  const leagues = useLeagues({ enabled: featureFlags.leagues })
  const myLeagues = featureFlags.leagues ? (leagues.isError ? [] : (leagues.data ?? null)) : []
  const [picked, setPicked] = useState<string | null>(null)
  const [stored, setStored] = useState<string | null>(null)
  useEffect(() => setStored(readStoredChoice()), [])
  const choice = resolveChoice({ picked, leagueParam, stored, leagues: myLeagues })
  const options = scoringOptions(myLeagues ?? [])
  // The ?league= league shows as an option even before the list loads.
  if (leagueParam && !options.some((o) => o.value === `league:${leagueParam}`)) {
    options.push({ value: `league:${leagueParam}`, label: league.data?.league.name ?? 'This league' })
  }
  const stats = usePlayerCoreStats(player.id, choice)
  const tiles = coreTiles(stats.data ?? null, player)
  const label = stats.data
    ? basisLabel(stats.data.basis)
    : stats.isError
      ? 'Couldn’t load points'
      : choice.kind === 'league'
        ? `${options.find((o) => o.value === choiceValue(choice))?.label ?? 'League'} scoring`
        : `${systemLabel(choice.system)} scoring`
  const onPick = (v: string) => {
    setPicked(v)
    writeStoredChoice(v)
  }
  return (
    <div className="border-t border-n-4 px-card-pad py-3 sm:px-5" data-core-stats>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Select value={choiceValue(choice)} onValueChange={onPick}>
          <SelectTrigger className="h-btn-md w-auto min-w-[150px] px-3 text-[12px] font-bold" aria-label="Scoring" data-core-scoring>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value} data-core-scoring-option={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] font-semibold text-n-3" data-core-basis>
          {label}
        </p>
        <p className="text-[11px] font-medium text-n-3" data-core-avg-note>
          Avg of completed weeks
        </p>
      </div>
      <div className="grid grid-cols-4 gap-y-3 sm:grid-cols-7">
        {tiles.map((t) => (
          <div key={t.key} className="min-w-0 pr-2" data-core-tile={t.key}>
            <p
              className={cn(
                'fs-num truncate text-[19px] font-extrabold leading-tight',
                t.value === '—' && 'text-n-3',
                stats.isPending && 'animate-pulse',
              )}
            >
              {t.value}
            </p>
            <p className="fs-overline mt-0.5 truncate text-n-3">{t.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Actions column (prototype 330px ×0.8)
// ---------------------------------------------------------------------------

function poolOf(player: PlayerStatsPlayer): PoolPlayer {
  return {
    id: player.id,
    full_name: player.full_name,
    position: player.position,
    team: player.team,
    adp: player.adp,
    headshot_url: player.headshot_url,
    status: player.status,
  }
}

/**
 * In a league: "Viewing in <League>" and that league's actions — the card's
 * own `LeagueCardActions` (+ / Drop / Propose trade, each closed door with
 * its reason). Outside one: "Your leagues" — the card's per-league rows,
 * each opening this page's league variant. Add to list rides along in both.
 * With the leagues release gated off only the list actions render.
 */
export function ActionsColumn({ player, leagueId }: { player: PlayerStatsPlayer; leagueId: string | null }) {
  const pool = poolOf(player)
  // R1501: a `?league=` the viewer isn't in (or whose read fails) falls back
  // to the page without a league — never a "Viewing in …" that never resolves.
  const league = useLeague(featureFlags.leagues && leagueId ? leagueId : undefined)
  const inLeagueId = leagueId && !league.isError ? leagueId : null
  return (
    <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[264px]" data-card-actions={inLeagueId ? 'league' : 'global'}>
      {featureFlags.leagues && (inLeagueId ? <InLeagueBlock pool={pool} leagueId={inLeagueId} /> : <YourLeaguesBlock pool={pool} />)}
      <div className="flex flex-wrap items-center gap-1.5">
        <PlayerDetailActions player={player} onFullPage />
      </div>
    </div>
  )
}

function InLeagueBlock({ pool, leagueId }: { pool: PoolPlayer; leagueId: string }) {
  const league = useLeague(leagueId)
  const router = useRouter()
  return (
    <div>
      <p className="fs-overline mb-1.5 text-n-3" data-viewing-in>
        Viewing in {league.data?.league.name ?? '…'}
      </p>
      <LeagueCardActions player={pool} leagueId={leagueId} />
      <button
        type="button"
        onClick={() => router.push(playerPageHref(pool.id))}
        className="mt-1.5 text-[11px] font-bold text-n-3 underline decoration-transparent underline-offset-2 transition-colors hover:text-ink hover:decoration-current"
        data-card-all-leagues
      >
        See all my leagues
      </button>
    </div>
  )
}

function YourLeaguesBlock({ pool }: { pool: PoolPlayer }) {
  const { data: leagues, isPending, isError } = useLeagues()
  const router = useRouter()
  return (
    <div>
      <p className="fs-overline mb-1 text-n-3">Your leagues</p>
      {isPending ? (
        <div className="space-y-1.5">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : isError ? (
        <p className="py-2 text-[12px] font-semibold text-n-3">Couldn&apos;t load your leagues.</p>
      ) : leagues && leagues.length > 0 ? (
        <div>
          {leagues.map((lg, i) => (
            <LeagueAvailabilityRow
              key={lg.id}
              player={pool}
              league={lg}
              first={i === 0}
              onOpen={(id) => router.push(playerPageHref(pool.id, id))}
            />
          ))}
        </div>
      ) : (
        <p className="py-2 text-[12px] font-medium text-n-3">Join a league to track availability.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scout AI read + tabs (they share the schedule reads)
// ---------------------------------------------------------------------------

function ScheduleSections({ data }: { data: PlayerStatsResponse }) {
  const { player } = data
  const season = data.seasons.current.season
  const games = useNflTeamSchedule(season, player.team)
  const splits = useDefenseSplits(season)
  const rows = scheduleRows(player.team, player.position, games.data ?? [], splits.data ?? [], player.bye_week)
  const read = splits.data ? scoutMatchupRead(nextScheduled(rows, games.data ?? []), player.position) : null

  return (
    <>
      {/* Only when real data supports it — omitted otherwise, never invented. */}
      {read && (
        <div data-scout-read>
          <AIInsight heading={read} />
        </div>
      )}
      <PlayerTabs data={data} schedule={{ rows, loading: games.isPending && !!player.team, error: games.isError }} />
    </>
  )
}

export function PlayerTabs({
  data,
  schedule,
}: {
  data: PlayerStatsResponse
  schedule: { rows: ScheduleRow[]; loading: boolean; error: boolean }
}) {
  // News: no player-news source yet (F-row filed) — the tab is omitted.
  return (
    <Card>
      <Tabs defaultValue="overview">
        <div className="border-b border-ink px-card-pad py-3">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>
        </div>
        <div className="p-card-pad sm:p-5">
          <TabsContent value="overview" className="mt-0">
            <WeeklyPointsList data={data} />
          </TabsContent>
          <TabsContent value="stats" className="mt-0 space-y-5">
            <StatsPanel data={data} />
            <GameLogPanel data={data} />
          </TabsContent>
          <TabsContent value="schedule" className="mt-0">
            <ScheduleList {...schedule} />
          </TabsContent>
        </div>
      </Tabs>
    </Card>
  )
}

const TONE_CHIP: Record<string, string> = {
  negative: 'bg-negative',
  caution: 'bg-caution',
  positive: 'bg-brand',
}

export function ScheduleList({ rows, loading, error }: { rows: ScheduleRow[]; loading: boolean; error: boolean }) {
  if (loading) return <Skeleton className="h-40 w-full" />
  if (error) return <p className="text-[12px] font-semibold text-n-3">Couldn&apos;t load the schedule.</p>
  if (rows.length === 0) {
    return (
      <p className="border border-n-4 p-3 text-center text-[12px] font-semibold text-n-3">
        No schedule on file for this season yet.
      </p>
    )
  }
  return (
    <div data-schedule>
      <div className="flex items-center gap-3 border-b border-n-4 pb-1.5 text-[11px] font-semibold text-n-3">
        <span className="w-10 shrink-0">Week</span>
        <span className="flex-1">Opponent</span>
        <span className="w-12 shrink-0 text-right">OPRK</span>
      </div>
      {rows.map((r) => (
        <div key={r.week} className="flex items-center gap-3 border-b border-n-4 py-2" data-schedule-week={r.week}>
          <span className="fs-num w-10 shrink-0 text-[12px] font-bold text-n-3">Wk {r.week}</span>
          <span className={cn('flex-1 text-[13px] font-extrabold', r.final && 'text-n-3')}>
            {r.opponent.kind === 'game' ? r.opponent.label : 'BYE'}
          </span>
          <span className="w-12 shrink-0 text-right">
            {r.oprk !== null && r.tone && (
              <span
                className={cn('fs-num inline-flex rounded-sm px-1.5 py-px text-[11px] font-extrabold', TONE_CHIP[r.tone])}
                data-oprk={r.oprk}
              >
                {r.oprk}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
