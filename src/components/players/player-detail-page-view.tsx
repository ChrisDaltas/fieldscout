'use client'

import { useEffect, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
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
  scheduleRows,
  seasonTable,
  shortKickoff,
  thisWeek,
  type SeasonTableRow,
  type ThisWeek,
} from '@/components/players/player-page-ops'
import { Button } from '@/components/ui/button'
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
  type CoreStatsPayload,
  decisionTiles,
  MISSING,
  valueTiles,
  resolveChoice,
  SCORING_CHOICE_STORAGE_KEY,
  scoringOptions,
  systemLabel,
} from '@/lib/players/core-stats-ops'
import { keyStats, type KeyStatTile } from '@/lib/players/key-stats-ops'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

/**
 * The player view (D486(13), Chris 2026-10-04: "Simple at first, but lets the
 * user quickly go advanced, has just what you need to make a quality
 * decision now"). One component for the modal and the deep-link page.
 */
export function PlayerView({
  playerId,
  leagueId,
  variant,
}: {
  playerId: string
  leagueId: string | null
  /** Only the modal remains (Chris 2026-10-04, "Player links open the
   *  modal") — `/app/players/[id]` now redirects into it. */
  variant: 'modal'
}) {
  const { data, isLoading, error } = usePlayerStats(playerId)
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
  // Re-point the view at another league context (or none): the modal swaps in place.
  const goContext = (id: string | null) => openPlayerView(playerId, id)
  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-h6">Player not found</p>
        <p className="mt-1 text-[13px] font-medium text-negative-strong">
          {error?.message ?? 'This player may have moved or been removed.'}
        </p>
      </div>
    )
  }
  return (
    <div data-player-page={leagueId ? 'league' : 'global'} data-player-view={variant}>
      <PlayerBody data={data} leagueId={leagueId} goContext={goContext} />
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

export type SectionKey = 'stats' | 'log' | 'scoring' | 'value'
export const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'stats', label: 'Full stats' },
  { key: 'log', label: 'Game log' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'value', label: 'Draft & value' },
]
export const SECTIONS_STORAGE_KEY = 'fs.player-view.sections'

function readSections(): SectionKey[] {
  try {
    const raw = window.localStorage.getItem(SECTIONS_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((k): k is SectionKey => SECTIONS.some((s) => s.key === k)) : []
  } catch {
    return []
  }
}

function writeSections(keys: SectionKey[]) {
  try {
    window.localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // Blocked storage — the open sections just aren't remembered.
  }
}

/**
 * The calm default view, then progressive disclosure: header (+ the one
 * action) → the decision line (Pos rank · Avg / week · Proj this wk) → this
 * week → the season table → a quiet row of section toggles (Full stats ·
 * Game log · Scoring · Draft & value), each collapsed by default and
 * remembered per viewer. Mobile stacks in the same order.
 */
export function PlayerBody({
  data,
  leagueId,
  goContext,
}: {
  data: PlayerStatsResponse
  leagueId: string | null
  goContext: (leagueId: string | null) => void
}) {
  const { player } = data
  const season = data.seasons.current.season
  const games = useNflTeamSchedule(season, player.team)
  const splits = useDefenseSplits(season)
  const scored = useScoredStats(player, leagueId)
  const schedule = scheduleRows(player.team, player.position, games.data ?? [], splits.data ?? [], player.bye_week)
  const tw = games.data ? thisWeek(player.team, player.position, games.data, splits.data ?? [], player.bye_week) : null
  const table = seasonTable(schedule, games.data ?? [], scored.stats.data?.weekly ?? [], tw?.week ?? scored.stats.data?.week ?? null)
  const keys = keyStats(player.position, scored.stats.data ? { ...scored.stats.data.box, usage: scored.stats.data.usage } : null)
  const [open, setOpen] = useState<SectionKey[]>([])
  useEffect(() => setOpen(readSections()), [])
  const toggle = (k: SectionKey, force?: boolean) =>
    setOpen((cur) => {
      const on = force ?? !cur.includes(k)
      const next = on ? [...cur.filter((x) => x !== k), k] : cur.filter((x) => x !== k)
      writeSections(next)
      return next
    })
  return (
    <div className="space-y-6 p-5 sm:p-7">
      <div className="grid gap-4 pr-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <PlayerDetailHeader player={player} size="expanded" />
        <ActionsColumn player={player} leagueId={leagueId} goContext={goContext} />
      </div>

      <DecisionLine player={player} scored={scored} onBasis={() => toggle('scoring', true)} />
      {tw && <ThisWeekBlock tw={tw} position={player.position} />}
      <KeyStatsPanel tiles={keys.primary} />

      <SeasonTable rows={table} loading={games.isPending && !!player.team} error={games.isError} season={season} />

      <SectionToggles open={open} onToggle={toggle} />
      {SECTIONS.filter((sec) => open.includes(sec.key)).map((sec) => (
        <section key={sec.key} className="border-t border-n-4 pt-4" data-section={sec.key}>
          <p className="fs-overline mb-2 text-n-3">{sec.label}</p>
          {sec.key === 'stats' && (
            <div className="space-y-5">
              {keys.more.length > 0 && <KeyStatsPanel tiles={keys.more} more />}
              <StatsPanel data={data} />
            </div>
          )}
          {sec.key === 'log' && <GameLogPanel data={data} />}
          {sec.key === 'scoring' && <ScoringPicker scored={scored} />}
          {sec.key === 'value' && <DraftValue player={player} stats={scored.stats.data ?? null} />}
        </section>
      ))}
    </div>
  )
}

export function SectionToggles({ open, onToggle }: { open: readonly SectionKey[]; onToggle: (k: SectionKey) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-n-4 pt-4" data-section-toggles>
      {SECTIONS.map((sec) => {
        const on = open.includes(sec.key)
        return (
          <Button
            key={sec.key}
            variant="ghost"
            size="sm"
            onClick={() => onToggle(sec.key)}
            aria-expanded={on}
            data-section-toggle={sec.key}
            className={cn(on && 'bg-accent-soft')}
          >
            <Icon name={on ? 'arrow-up' : 'arrow-bottom'} size={12} />
            {sec.label}
          </Button>
        )
      })}
    </div>
  )
}

/** The three decision numbers (D486(13)) with the scoring basis beside —
 *  tapping the basis opens the Scoring section. */
function DecisionLine({
  player,
  scored,
  onBasis,
}: {
  player: PlayerStatsPlayer
  scored: ReturnType<typeof useScoredStats>
  onBasis: () => void
}) {
  const tiles = decisionTiles(scored.stats.data ?? null, player)
  return (
    <div data-core-stats>
      <StatsStrip tiles={tiles} pending={scored.stats.isPending} />
      <button
        type="button"
        onClick={onBasis}
        className="mt-1.5 text-[11px] font-semibold text-n-3 underline decoration-transparent underline-offset-2 transition-colors hover:text-ink hover:decoration-current"
        data-core-basis
      >
        {scored.label}
      </button>
    </div>
  )
}

/** Three large numbers with small labels — no boxes, generous space. */
export function StatsStrip({ tiles, pending = false }: { tiles: ReturnType<typeof coreTiles>; pending?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-4" data-stats-strip>
      {tiles.map((t) => (
        <div key={t.key} className="min-w-0" data-core-tile={t.key}>
          <p
            className={cn(
              'fs-num truncate text-[29px] font-extrabold leading-none',
              t.value === '—' && 'text-n-3',
              pending && 'animate-pulse',
            )}
          >
            {t.value}
          </p>
          <p className="fs-overline mt-1.5 truncate text-n-3">{t.label}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * Key stats (D486(14)): about six compact, position-specific tiles — stored
 * or derived from stored fields, season to date over completed games. None
 * on file → the panel is omitted. `more` = the Full-stats extras.
 */
export function KeyStatsPanel({ tiles, more = false }: { tiles: KeyStatTile[]; more?: boolean }) {
  if (tiles.length === 0) return null
  return (
    <div data-key-stats={more ? 'more' : 'primary'}>
      {!more && <p className="fs-overline mb-2 text-n-3">Key stats · season</p>}
      <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.key} className="min-w-0" data-key-stat={t.key}>
            <p className="fs-num truncate text-[17px] font-extrabold leading-tight">{t.value}</p>
            <p className="fs-overline mt-0.5 truncate text-n-3" title={t.label}>
              {t.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The Scoring section: the D486(11) dropdown + its basis and avg notes. */
function ScoringPicker({ scored }: { scored: ReturnType<typeof useScoredStats> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Select value={scored.value} onValueChange={scored.onPick}>
        <SelectTrigger className="h-btn-md w-auto min-w-[170px] px-3 text-[12px] font-bold" aria-label="Scoring" data-core-scoring>
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
      <p className="text-[11px] font-medium text-n-3" data-core-avg-note>
        Avg of completed weeks
      </p>
    </div>
  )
}

/** Draft & value: ADP · Auction $ · SOS · Total pts · Overall — present
 *  values only (a missing one is omitted, never "—"). */
export function DraftValue({ player, stats }: { player: PlayerStatsPlayer; stats: CoreStatsPayload | null }) {
  const cells = [
    ...draftValueCells(player),
    ...valueTiles(stats).filter((t) => t.value !== MISSING),
  ]
  if (cells.length === 0) return <p className="text-[12px] font-semibold text-n-3">Nothing on file yet.</p>
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5" data-draft-value>
      {cells.map((c) => (
        <div key={c.key} data-draft-cell={c.key}>
          <p className="fs-num text-[17px] font-extrabold leading-tight">{c.value}</p>
          <p className="fs-overline mt-0.5 text-n-3">{c.label}</p>
        </div>
      ))}
    </div>
  )
}

const TONE_CHIP: Record<string, string> = {
  negative: 'bg-negative',
  caution: 'bg-caution',
  positive: 'bg-brand',
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
 * position) · Proj · Pts, the current week marked.
 */
function pts(n: number | null): string {
  return n === null ? '—' : n.toFixed(1)
}

export function SeasonTable({
  rows,
  loading,
  error,
  season,
}: {
  rows: SeasonTableRow[]
  loading: boolean
  error: boolean
  season?: number
}) {
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
    <div>
      {season !== undefined && <p className="fs-overline mb-1.5 text-n-3">{season} season</p>}
    <table className="w-full table-fixed text-[13px]" data-season-table>
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
              <td className="fs-num py-2.5 font-bold text-n-3">{r.week}</td>
              <td className="truncate py-2.5 font-extrabold">
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
              <td className="fs-num py-2.5 text-right font-semibold text-n-3">{bye ? '' : pts(r.proj)}</td>
              <td className="fs-num truncate py-2.5 text-right font-extrabold">
                {bye ? '' : kickoff ? <span className="text-[11px] font-semibold text-n-3">{kickoff}</span> : pts(r.points)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
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
export function ActionsColumn({
  player,
  leagueId,
  goContext = () => {},
}: {
  player: PlayerStatsPlayer
  leagueId: string | null
  goContext?: (leagueId: string | null) => void
}) {
  const pool = poolOf(player)
  // R1501: a `?league=` the viewer isn't in (or whose read fails) falls back
  // to the page without a league — never a "Viewing in …" that never resolves.
  const league = useLeague(featureFlags.leagues && leagueId ? leagueId : undefined)
  const inLeagueId = leagueId && !league.isError ? leagueId : null
  return (
    <div className="flex w-full shrink-0 flex-col gap-3 sm:w-[264px]" data-card-actions={inLeagueId ? 'league' : 'global'}>
      {featureFlags.leagues &&
        (inLeagueId ? (
          <InLeagueBlock pool={pool} leagueId={inLeagueId} goContext={goContext} />
        ) : (
          <YourLeaguesBlock pool={pool} goContext={goContext} />
        ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <PlayerDetailActions player={player} onFullPage />
      </div>
    </div>
  )
}

function InLeagueBlock({
  pool,
  leagueId,
  goContext,
}: {
  pool: PoolPlayer
  leagueId: string
  goContext: (leagueId: string | null) => void
}) {
  const league = useLeague(leagueId)
  return (
    <div>
      <p className="fs-overline mb-1.5 text-n-3" data-viewing-in>
        Viewing in {league.data?.league.name ?? '…'}
      </p>
      <LeagueCardActions player={pool} leagueId={leagueId} />
      <button
        type="button"
        onClick={() => goContext(null)}
        className="mt-1.5 text-[11px] font-bold text-n-3 underline decoration-transparent underline-offset-2 transition-colors hover:text-ink hover:decoration-current"
        data-card-all-leagues
      >
        See all my leagues
      </button>
    </div>
  )
}

function YourLeaguesBlock({ pool, goContext }: { pool: PoolPlayer; goContext: (leagueId: string | null) => void }) {
  const { data: leagues, isPending, isError } = useLeagues()
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
              onOpen={(id) => goContext(id)}
            />
          ))}
        </div>
      ) : (
        <p className="py-2 text-[12px] font-medium text-n-3">Join a league to track availability.</p>
      )}
    </div>
  )
}

