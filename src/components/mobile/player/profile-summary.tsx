'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { holdersOf } from '@/components/leagues/players-page-ops'
import {
  gameCards,
  initialCardIndex,
  keyStatTrends,
  leagueOwnership,
  ownershipNeedsRosters,
  ownershipSummary,
  preDraftFor,
  type GameCard,
  type LeagueOwnership,
} from '@/components/mobile/player/profile-ops'
import { useProfileUiStore, type ProfileSection } from '@/components/mobile/player/profile-ui-store'
import type { useProfileLeague } from '@/components/mobile/player/use-profile-context'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { posLabel } from '@/components/mobile/ui/m-pos-chip'
import { useCardLeagueView } from '@/components/players/player-card-actions'
import type { ScheduleRow, TeamGame } from '@/components/players/player-page-ops'
import { useLeague } from '@/hooks/use-league'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import type { ProfileStatLine } from '@/hooks/use-mobile-pprofile-stat-lines'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import { useRosters } from '@/hooks/use-rosters'
import type { CoreStatsPayload } from '@/lib/players/core-stats-ops'
import { keyStats } from '@/lib/players/key-stats-ops'
import { cn } from '@/lib/utils'

/** One card (200) plus the gap (8) — the prev / next step (§3). */
const CARD_STEP = 208

/**
 * Summary (m-pprofile §2.5): the ownership row, Key stats and Games and
 * projections. The prototype's "Recent news" section has no source (no
 * player-news feed exists, F575) and is left out rather than written by the
 * app (D486: the view never writes advice of its own).
 */
export function SummaryTab({
  player,
  pool,
  season,
  core,
  coreError,
  ctx,
  schedule,
  games,
  gamesState,
  lines,
  currentWeek,
  onLeagues,
}: {
  player: PlayerStatsPlayer
  pool: PoolPlayer
  season: number
  core: CoreStatsPayload | null
  coreError: boolean
  ctx: ReturnType<typeof useProfileLeague>
  schedule: readonly ScheduleRow[]
  games: readonly TeamGame[]
  gamesState: 'loading' | 'error' | 'ready'
  lines: readonly ProfileStatLine[]
  currentWeek: number | null
  onLeagues: () => void
}) {
  const collapsed = useProfileUiStore((s) => s.collapsed)
  const toggle = useProfileUiStore((s) => s.toggle)
  const tiles = keyStats(player.position, core ? { ...core.box, usage: core.usage } : null).primary
  // "▲/▼ last 3" under each tile, over the same completed games the tiles
  // total (the weeks the core-stats read scored).
  const trends = useMemo(
    () =>
      keyStatTrends({
        lines,
        season,
        completedWeeks: new Set((core?.weekly ?? []).filter((w) => w.points !== null).map((w) => w.week)),
      }),
    [lines, season, core],
  )
  const cards = useMemo(
    () =>
      gameCards({
        team: player.team,
        schedule,
        games,
        weekly: core?.weekly ?? [],
        lines: lines.filter((l) => l.season === season),
        position: player.position,
        currentWeek,
      }),
    [player.team, schedule, games, core, lines, season, player.position, currentWeek],
  )
  return (
    <div className="flex flex-col gap-[18px] px-4 py-[14px]" data-profile-summary>
      {ctx.leagues.length > 0 && <OwnershipRow pool={pool} ctx={ctx} onOpen={onLeagues} />}

      <section className="flex flex-col gap-2.5" data-profile-section="key">
        <SectionHead title="Key stats" sub={`${posLabel(player.position)} · ${season}`} open={!collapsed.key} onToggle={() => toggle('key')} />
        {!collapsed.key &&
          (tiles.length > 0 ? (
            <div className="grid grid-cols-3 gap-1.5">
              {tiles.map((t) => {
                const trend = trends[t.key]
                return (
                  <div key={t.key} className="flex min-w-0 flex-col gap-0.5 rounded-[12px] bg-m-b1 p-2.5" data-key-stat={t.key}>
                    <span className="whitespace-nowrap text-[17px] font-bold">{t.value}</span>
                    <span className="truncate text-[10px] font-semibold text-m-t2" title={t.label}>
                      {t.label}
                    </span>
                    {trend && (
                      // The arrow is the direction; the colour is better or
                      // worse for him (#43 — fewer interceptions is green).
                      <span
                        className={cn('whitespace-nowrap text-[10px] font-semibold', trend.good ? 'text-m-green' : 'text-m-red')}
                        data-key-trend={trend.up ? 'up' : 'down'}
                        data-key-trend-tone={trend.good ? 'good' : 'bad'}
                      >
                        {trend.text}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[13px] font-medium text-m-t3">
              {coreError ? 'Couldn’t load his stats right now.' : core ? 'No completed games yet this season.' : 'Loading…'}
            </p>
          ))}
      </section>

      <GamesSection cards={cards} state={gamesState} open={!collapsed.games} section="games" onToggle={toggle} />
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return <MIcon name="chevronUp" size={12} stroke={2.2} className={cn('text-m-t4', !open && 'rotate-180')} />
}

/** A collapsible section's header row (§2.5b): the whole row toggles; the
 *  title is the accessible button. */
function SectionHead({
  title,
  sub,
  open,
  onToggle,
  children,
}: {
  title: string
  sub?: string
  open: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    // The row is the touch target (as in the design); the title button
    // carries the keyboard and screen-reader semantics.
    <div className="flex cursor-pointer items-center gap-2" onClick={onToggle}>
      <button type="button" aria-expanded={open} className="flex-1 text-left text-[15px] font-semibold">
        {title}
      </button>
      {sub && <span className="whitespace-nowrap text-[11px] font-medium text-m-t3">{sub}</span>}
      {children}
      <Chevron open={open} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ownership row (§2.5a)
// ---------------------------------------------------------------------------

type Probe = LeagueOwnership | 'loading' | 'error'

function OwnershipRow({ pool, ctx, onOpen }: { pool: PoolPlayer; ctx: ReturnType<typeof useProfileLeague>; onOpen: () => void }) {
  const [probes, setProbes] = useState<Record<string, Probe>>({})
  const summary = ownershipSummary(ctx.leagues.map((l) => probes[l.id] ?? 'loading'))
  return (
    <>
      {ctx.leagues.map((l) => (
        <AvailabilityProbe key={l.id} pool={pool} league={l} report={(p) => setProbes((cur) => (cur[l.id] === p ? cur : { ...cur, [l.id]: p }))} />
      ))}
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-2.5 rounded-[12px] bg-m-b1 px-3 py-2.5 text-left"
        data-profile-ownership
      >
        {ctx.leagueId ? (
          <ContextOwner pool={pool} leagueId={ctx.leagueId} status={ctx.leagues.find((l) => l.id === ctx.leagueId)?.status ?? null} />
        ) : (
          <>
            <span className="size-2 flex-none rounded-full bg-m-t5" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">Your leagues</span>
          </>
        )}
        {/* A mixed summary ("Rostered in 1 · Pre-draft in 1 · Season over in
            1") can outrun a phone's row: it truncates, capped so the left
            label always keeps room, and the row never scrolls sideways. */}
        <span className="min-w-0 max-w-[60%] truncate text-[12px] font-medium text-m-t3" data-profile-ownership-summary>
          {summary}
        </span>
        <MIcon name="chevronRight" size={11} stroke={2} className="text-m-t5" />
      </button>
    </>
  )
}

/**
 * Where he stands in one league (`leagueOwnership`), reported up for the
 * row's summary (#44). Light on purpose — it runs for every league on every
 * profile open: one read, the rosters (the holder of record — the players
 * page's own `holdersOf`), and none at all for a league that has not
 * drafted. Whether he is on a roster is all the summary needs: unrostered
 * where moves are open is available to the viewer's team, waivers or not.
 */
function AvailabilityProbe({ pool, league, report }: { pool: PoolPlayer; league: MyLeagueRow; report: (p: Probe) => void }) {
  const read = ownershipNeedsRosters(league.status)
  const rosters = useRosters(read ? league.id : undefined)
  let probe: Probe
  if (!read) probe = leagueOwnership(league.status, league.my_team_id, null)
  else if (rosters.isError) probe = 'error'
  else if (!rosters.data) probe = 'loading'
  else probe = leagueOwnership(league.status, league.my_team_id, holdersOf(rosters.data).has(pool.id))
  useEffect(() => report(probe), [probe, report])
  return null
}

function ContextOwner({ pool, leagueId, status }: { pool: PoolPlayer; leagueId: string; status: string | null }) {
  const card = useCardLeagueView(pool, leagueId)
  const league = useLeague(leagueId)
  let dot = 'bg-m-t5'
  let label = 'Checking…'
  if (card.state === 'error') label = 'Couldn’t read this league'
  if (card.state === 'ready') {
    const a = card.view.row.availability
    if (status && preDraftFor(status, a.kind === 'rostered')) {
      label = 'Pre-draft'
    } else if (a.kind === 'rostered') {
      if (a.mine) {
        dot = 'bg-accent'
        label = `${a.teamName} · your team`
      } else {
        const mgr = league.data?.members.find((m) => m.team_id === a.teamId)?.profiles?.username
        label = mgr ? `${a.teamName} · @${mgr}` : a.teamName
      }
    } else if (a.kind === 'on_waivers') {
      dot = 'bg-m-gold'
      label = 'On waivers'
    } else {
      dot = 'bg-confirm'
      label = 'Free agent'
    }
  }
  return (
    <>
      <span className={cn('size-2 flex-none rounded-full', dot)} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{label}</span>
    </>
  )
}

// ---------------------------------------------------------------------------
// Games and projections (§2.5c)
// ---------------------------------------------------------------------------

function GamesSection({
  cards,
  state,
  open,
  section,
  onToggle,
}: {
  cards: GameCard[]
  state: 'loading' | 'error' | 'ready'
  open: boolean
  section: ProfileSection
  onToggle: (s: ProfileSection) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const placed = useRef<HTMLDivElement | null>(null)
  // Each newly mounted strip opens with the week before the current one at
  // the gutter — set instantly, once per mount (§2.5c).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || placed.current === el || cards.length === 0) return
    placed.current = el
    el.style.scrollBehavior = 'auto'
    el.scrollLeft = initialCardIndex(cards) * CARD_STEP
    el.style.scrollBehavior = ''
  }, [cards, open])
  const step = (dir: -1 | 1) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (ref.current) ref.current.scrollLeft += dir * CARD_STEP
  }
  return (
    <section className="flex flex-col gap-2.5" data-profile-section="games">
      <SectionHead title="Games and projections" open={open} onToggle={() => onToggle(section)}>
        <button type="button" aria-label="Earlier weeks" onClick={step(-1)} className="flex size-[26px] flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1">
          <MIcon name="back" size={10} stroke={2.4} />
        </button>
        <button type="button" aria-label="Later weeks" onClick={step(1)} className="flex size-[26px] flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1">
          <MIcon name="chevronRight" size={10} stroke={2.4} />
        </button>
      </SectionHead>
      {open &&
        (state === 'loading' ? (
          <div className="-mx-4 flex gap-2 overflow-hidden px-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-[113px] w-[200px] flex-none animate-pulse rounded-[14px] bg-m-b1" />
            ))}
          </div>
        ) : state === 'error' ? (
          <p className="text-[13px] font-medium text-m-t3">Couldn’t load the schedule.</p>
        ) : cards.length === 0 ? (
          <p className="text-[13px] font-medium text-m-t3">No schedule on file for this season yet.</p>
        ) : (
          <div ref={ref} className="-mx-4 flex gap-2 overflow-x-auto scroll-smooth px-4 scrollbar-none" data-profile-games>
            {cards.map((c) => (
              <GameCardView key={c.week} card={c} />
            ))}
          </div>
        ))}
    </section>
  )
}

const OPRK_TEXT = { positive: 'text-m-green', negative: 'text-m-red', caution: 'text-warn' } as const

function GameCardView({ card: c }: { card: GameCard }) {
  return (
    <div
      className={cn('flex w-[200px] flex-none flex-col gap-2 rounded-[14px] bg-m-b1 p-3', c.current && 'shadow-m-select')}
      data-game-week={c.week}
      data-current={c.current || undefined}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'flex h-5 flex-none items-center whitespace-nowrap rounded-pill px-[7px] text-[10px] font-bold',
            c.pill === 'current' ? 'bg-accent text-white' : c.pill === 'played' ? 'bg-m-ink text-white' : 'bg-m-b3s text-m-t2',
          )}
        >
          Wk {c.week}
        </span>
        {c.opp && (
          <span className="min-w-0 flex-1 whitespace-nowrap text-[12px] font-semibold">
            {c.opp} {c.oprk && <span className={c.tone ? OPRK_TEXT[c.tone] : undefined}>{c.oprk}</span>}
          </span>
        )}
      </div>
      {c.bye ? (
        <span className="text-[13px] font-medium text-m-t3">Bye week</span>
      ) : (
        <>
          <div className="flex items-end justify-between gap-2">
            <div className="flex flex-col gap-px">
              <span className="text-[10px] font-medium text-m-t3">{c.mainLabel}</span>
              <span
                className={cn(
                  'text-[22px] font-bold tracking-[-0.02em]',
                  c.mainTone === 'up' ? 'text-m-green' : c.mainTone === 'down' ? 'text-m-red' : 'text-m-t1',
                )}
              >
                {c.main}
              </span>
            </div>
            {c.sub && (
              <div className="flex flex-col items-end gap-px">
                <span className="text-[10px] font-medium text-m-t3">{c.sub.label}</span>
                <span className="whitespace-nowrap text-[14px] font-semibold text-m-t2">{c.sub.value}</span>
              </div>
            )}
          </div>
          {c.line && <span className="truncate text-[11px] font-medium text-m-t2">{c.line}</span>}
        </>
      )}
    </div>
  )
}
