'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { PageHeader } from '@/components/layout/app-header'
import { LeagueAvailabilityRow, LeagueCardActions } from '@/components/players/player-card-actions'
import { PlayerDetailActions } from '@/components/players/player-detail-actions'
import { PlayerDetailHeader } from '@/components/players/player-detail-header'
import { GameLogPanel, StatsPanel } from '@/components/players/player-detail-panels'
import {
  draftValueCells,
  formatKickoff,
  matchupBadge,
  oppCell,
  ordinal as ordinalShort,
  playerPageHref,
  scheduleRows,
  seasonTable,
  shortKickoff,
  thisWeek,
  type SeasonTableRow,
  type ThisWeek,
} from '@/components/players/player-page-ops'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
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
import { getNflTeam } from '@/lib/nfl-teams'
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
 * Full player page — the waiver read (D486(12), Chris 2026-10-04: the
 * platform modals are "too busy"). The standard shell header, then one hero
 * (identity + the context's action, the key numbers, this week), ONE season
 * table (Wk · Opp · Proj · Pts) and the detailed stats behind "Full stats".
 */
export function PlayerDetailPageView({ playerId, leagueId = null }: PlayerDetailPageViewProps) {
  const { data, isLoading, error } = usePlayerStats(playerId)
  const router = useRouter()
  const inLeague = featureFlags.leagues && !!leagueId

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/app/research')
  }

  // The app's standard header (D486(12)): a plain title in the shell's
  // 58px bar, Back as a ghost action — the draft recap's pattern. The name
  // itself shows once, in the hero.
  const pageHeader = (
    <PageHeader
      title="Player"
      actions={
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
      <PlayerHero data={data} leagueId={inLeague ? leagueId : null} />
    </div>
  )
}

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

/** The scoring choice (D486(11)) and the core-stats read under it — one
 *  read feeds the key numbers AND the season table, so they always agree. */
function useScoredStats(player: PlayerStatsPlayer, leagueId: string | null) {
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
  return { value: choiceValue(choice), options, onPick, stats, label }
}

/**
 * Hero → season table → full stats. Mobile stacks: identity, the action
 * (under the name), key numbers, this week, the table, full stats. Not
 * interactive → no resting shadow (CLAUDE.md elevation rule).
 */
function PlayerHero({ data, leagueId }: { data: PlayerStatsResponse; leagueId: string | null }) {
  const { player } = data
  const season = data.seasons.current.season
  const games = useNflTeamSchedule(season, player.team)
  const splits = useDefenseSplits(season)
  const scored = useScoredStats(player, leagueId)
  const schedule = scheduleRows(player.team, player.position, games.data ?? [], splits.data ?? [], player.bye_week)
  const tw = games.data ? thisWeek(player.team, player.position, games.data, splits.data ?? [], player.bye_week) : null
  const table = seasonTable(schedule, games.data ?? [], scored.stats.data?.weekly ?? [], tw?.week ?? scored.stats.data?.week ?? null)
  const draftValue = draftValueCells(player)
  return (
    <>
      <Card>
        <div className="grid gap-4 p-card-pad sm:p-5 lg:grid-cols-[minmax(0,1fr)_264px] lg:items-start">
          <PlayerDetailHeader player={player} size="expanded" />
          <ActionsColumn player={player} leagueId={leagueId} />
        </div>
        <KeyNumbers player={player} scored={scored} />
        {tw && (
          <div className="border-t border-n-4 px-card-pad py-3 sm:px-5">
            <ThisWeekBlock tw={tw} position={player.position} />
          </div>
        )}
        {draftValue.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-n-4 px-card-pad py-2 sm:px-5" data-draft-value>
            {draftValue.map((c) => (
              <p key={c.key} className="text-[11px] font-semibold text-n-3" data-draft-cell={c.key}>
                {c.label} <span className="fs-num font-extrabold text-ink">{c.value}</span>
              </p>
            ))}
          </div>
        )}
      </Card>
      <SeasonTableCard
        data={data}
        rows={table}
        loading={games.isPending && !!player.team}
        error={games.isError}
      />
    </>
  )
}

const TONE_CHIP: Record<string, string> = {
  negative: 'bg-negative',
  caution: 'bg-caution',
  positive: 'bg-brand',
}

/** The key numbers (D486(12)) with the scoring dropdown + basis beside. */
function KeyNumbers({ player, scored }: { player: PlayerStatsPlayer; scored: ReturnType<typeof useScoredStats> }) {
  const tiles = coreTiles(scored.stats.data ?? null, player)
  return (
    <div className="border-t border-n-4 px-card-pad py-3 sm:px-5" data-core-stats>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Select value={scored.value} onValueChange={scored.onPick}>
          <SelectTrigger className="h-btn-md w-auto min-w-[150px] px-3 text-[12px] font-bold" aria-label="Scoring" data-core-scoring>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scored.options.map((o) => (
              <SelectItem key={o.value} value={o.value} data-core-scoring-option={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] font-semibold text-n-3" data-core-basis>
          {scored.label}
        </p>
        <p className="text-[11px] font-medium text-n-3" data-core-avg-note>
          Avg of completed weeks
        </p>
      </div>
      <StatsStrip tiles={tiles} pending={scored.stats.isPending} />
    </div>
  )
}

/** One bordered strip of the five key numbers — mono numerals, small
 *  labels, hairline dividers. 3 + 2 on a phone (no h-scroll). */
export function StatsStrip({ tiles, pending = false }: { tiles: ReturnType<typeof coreTiles>; pending?: boolean }) {
  return (
    <div className="grid grid-cols-3 border-l border-t border-n-4 sm:grid-cols-5" data-stats-strip>
      {tiles.map((t) => (
        <div key={t.key} className="min-w-0 border-b border-r border-n-4 px-2.5 py-2" data-core-tile={t.key}>
          <p
            className={cn(
              'fs-num truncate text-[19px] font-extrabold leading-tight',
              t.value === '—' && 'text-n-3',
              pending && 'animate-pulse',
            )}
          >
            {t.value}
          </p>
          <p className="fs-overline mt-0.5 truncate text-n-3">{t.label}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * "This week" — the factual matchup (D486(12)): "@ SEA · Sun 1:05 PM ET"
 * and the matchup badge from `defense_position_splits` (OPRK, 1 = toughest;
 * My Team's chip tones). A bye says so. No rank → no badge, never invented.
 */
export function ThisWeekBlock({ tw, position }: { tw: ThisWeek; position: string }) {
  if (tw.kind === 'bye') {
    return (
      <div data-this-week="bye">
        <p className="fs-overline text-n-3">This week · Wk {tw.week}</p>
        <p className="mt-0.5 text-h6" data-this-week-bye>
          Bye week
        </p>
      </div>
    )
  }
  const team = getNflTeam(tw.opp)
  const kickoff = formatKickoff(tw.kickoff_at)
  const badge = tw.oprk !== null ? matchupBadge(tw.oprk, tw.ranked, position) : null
  const vs = tw.home ? 'vs' : '@'
  return (
    <div data-this-week="game">
      <p className="fs-overline text-n-3">This week · Wk {tw.week}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-h6" title={team ? `${vs} ${team.city} ${team.name}` : undefined} data-this-week-opp>
          {`${vs} ${tw.opp}`}
        </span>
        {kickoff && (
          <span className="fs-num text-[12px] font-semibold text-n-3" data-this-week-kickoff>
            {`· ${kickoff}`}
          </span>
        )}
        {badge && (
          <span
            className={cn('inline-flex rounded-sm px-1.5 py-px text-[11px] font-extrabold', TONE_CHIP[badge.tone])}
            data-matchup-badge={badge.tone}
          >
            {badge.text}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The season table (D486(12), Yahoo's one table): Wk · Opp (rank vs his
 * position) · Proj · Pts, the current week marked. Replaces the old weekly
 * list and Schedule tab. "Full stats" (collapsed) holds the season cards
 * and the game log.
 */
export function SeasonTableCard({
  data,
  rows,
  loading,
  error,
}: {
  data: PlayerStatsResponse
  rows: SeasonTableRow[]
  loading: boolean
  error: boolean
}) {
  const [full, setFull] = useState(false)
  return (
    <Card>
      <div className="p-card-pad sm:p-5">
        <p className="fs-overline mb-1.5 text-n-3">{data.seasons.current.season} season</p>
        <SeasonTable rows={rows} loading={loading} error={error} />
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => setFull((v) => !v)}
          aria-expanded={full}
          data-full-stats-toggle
        >
          <Icon name={full ? 'arrow-up' : 'arrow-bottom'} size={13} />
          Full stats
        </Button>
        {full && (
          <div className="mt-3 space-y-5" data-full-stats>
            <StatsPanel data={data} />
            <GameLogPanel data={data} />
          </div>
        )}
      </div>
    </Card>
  )
}

function pts(n: number | null): string {
  return n === null ? '—' : n.toFixed(1)
}

export function SeasonTable({ rows, loading, error }: { rows: SeasonTableRow[]; loading: boolean; error: boolean }) {
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
    <table className="w-full table-fixed text-[12px]" data-season-table>
      <thead>
        <tr className="border-b border-ink text-left text-[11px] font-semibold text-n-3">
          <th className="w-10 py-1.5 font-semibold">Wk</th>
          <th className="py-1.5 font-semibold">Opp</th>
          <th className="w-14 py-1.5 text-right font-semibold">Proj</th>
          <th className="w-[84px] py-1.5 text-right font-semibold">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const bye = r.opponent?.kind === 'bye'
          const kickoff = r.points === null && r.kickoff_at ? shortKickoff(r.kickoff_at) : null
          return (
            <tr
              key={r.week}
              className={cn('border-b border-n-4', r.current && 'bg-accent-soft')}
              data-season-week={r.week}
              data-current={r.current || undefined}
            >
              <td className="fs-num py-2 font-bold text-n-3">{r.week}</td>
              <td className="truncate py-2 font-extrabold">
                {oppCell(r)}
                {!bye && r.oprk !== null && r.tone && r.oprk > 0 && (
                  <span
                    className={cn('fs-num ml-1.5 inline-flex rounded-sm px-1 py-px text-[10px] font-extrabold', TONE_CHIP[r.tone])}
                    data-oprk={r.oprk}
                  >
                    {ordinalShort(r.oprk)}
                  </span>
                )}
              </td>
              <td className="fs-num py-2 text-right font-semibold text-n-3">{bye ? '' : pts(r.proj)}</td>
              <td className="fs-num truncate py-2 text-right font-extrabold">
                {bye ? '' : kickoff ? <span className="text-[11px] font-semibold text-n-3">{kickoff}</span> : pts(r.points)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
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

