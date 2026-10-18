'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { readLastRankPos } from '@/components/mobile/rankings/last-position'
import { useShowMovement } from '@/components/mobile/rankings/movement-pref'
import { MyRankingsBody, type MyRankFilter } from '@/components/mobile/rankings/my-rankings'
import {
  MovementMark,
  MovementSwitch,
  RkIcon,
  RK_ICON,
  StatCells,
  statCells,
  type StatCell,
} from '@/components/mobile/rankings/rank-parts'
import {
  HUB_POSITIONS,
  RANK_SCORINGS,
  activeWeekOf,
  agreementNote,
  cmpToneClass,
  expertSpread,
  fmt1,
  fromDbPos,
  hubPosLabel,
  inHubPos,
  isChipSource,
  plural,
  rankPosLabel,
  rankPosOr,
  relativeAgo,
  scoringLabel,
  seasonLabel,
  seasonSub,
  shortName,
  tierBreaks,
  tierChipClassFor,
  updatedLabel,
  type HubPos,
  type Movement,
  type RankOverlay,
  type RankPos,
  type RankingsUrlState,
  type SourceKey,
} from '@/components/mobile/rankings/rankings-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useMyRankingBoards } from '@/hooks/use-mobile-rankings-boards'
import {
  HUB_CAP,
  boardMovement,
  sourceRankMap,
  useAuthorBoard,
  useExpertBoards,
  useExpertsSource,
  useHubPool,
  useMarketSource,
  useUsersSource,
  type ExpertBoard,
  type HubPlayer,
  type HubRow,
  type MarketKey,
  type PoolStat,
} from '@/hooks/use-mobile-rankings-sources'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { authorAvatarClass } from '@/components/mobile/ui/avatar-colors'
import { computeInitials } from '@/utils/initials'

/**
 * The ONE Rankings screen (lr-hub.md; Chris, 2026-10-15, gap list #28) on
 * the app's real sources:
 *   - Experts  → the consensus of the app's AI expert boards (labelled as AI),
 *   - Scout AI → no ranking exists yet: the tab is there with an empty state,
 *   - Users    → the cred-weighted average of users' rankings,
 *   - ADP, Auction → desktop Big Board's market boards: average draft
 *                position and average auction price (#29),
 *   - an AI expert's own board as the author view (S4, `?src=p:<listId>`),
 *   - Mine     → your rankings: the filters and period cards that used to be
 *                the separate "My rankings" screen. `?view=mine` (Profile's
 *                and Home's link) opens this screen on this tab.
 * Every source is season-long, so the type menu offers the one season type.
 * The position chips add FLEX (RB, WR and TE in overall order, #29).
 * A row tap expands "Compare sources" (S9); the headshot opens the player.
 *
 * Movement (#33): on someone else's ranking — the experts' consensus, an AI
 * expert's board — each row shows how far the player moved since that
 * ranking's previous update (▲3 / ▼2, "New"), under the rank. On by
 * default; the "Show movement" switch (remembered on this device) appears
 * wherever there is a previous update to compare with. Users, ADP and
 * Auction keep no previous version, so they have none.
 */

export interface RankingsNav {
  state: RankingsUrlState
  currentWeek: number
  setHub: (patch: Partial<Pick<RankingsUrlState, 'src' | 'scoring' | 'pos'>>) => void
  open: (overlay: RankOverlay, mode?: 'push' | 'replace') => void
}

/** Root header (lr-frame §2.4): 34px back, 34px blue Create. Back goes to
 *  where you came from, else Profile (Chris, 2026-10-15, gap list #27). */
function RootHeader({ onCreate }: { onCreate: () => void }) {
  const goBack = useGoBack()
  return (
    <div className="flex items-center gap-2.5 px-4 pt-[2px]">
      <button
        type="button"
        onClick={() => goBack('/app/profile')}
        aria-label="Back"
        className="flex size-[34px] flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1"
      >
        <RkIcon d={RK_ICON.back} size={16} stroke={2} />
      </button>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onCreate}
        aria-label="Create a ranking"
        title="Create"
        className="flex size-[34px] flex-none items-center justify-center rounded-full bg-accent text-white"
      >
        <RkIcon d={RK_ICON.plus} size={15} stroke={2.4} />
      </button>
    </div>
  )
}

/** The AI expert board an author view (`p:<id>`) shows, and its locked position. */
function useAuthor(src: SourceKey, fallbackPos: RankPos) {
  const boards = useExpertBoards()
  const id = src.startsWith('p:') ? src.slice(2) : null
  const board = id ? (boards.data?.find((b) => b.id === id) ?? null) : null
  return {
    id,
    board,
    pos: (board && fromDbPos(board.position_filter)) || fallbackPos,
    isPending: id !== null && boards.isPending,
    isError: id !== null && boards.isError,
    refetch: () => void boards.refetch(),
  }
}

export function RankingsHub({ nav }: { nav: RankingsNav }) {
  const { state, currentWeek } = nav
  const isMine = state.src === 'mine'
  // An AI expert's overall board is shown at one position: the chip's, RB
  // for FLEX.
  const author = useAuthor(state.src, rankPosOr(state.pos, 'RB'))
  // The Mine tab's filter lasts the session (lr-myrank §3): this screen
  // stays mounted under the wizard and editor, so plain state carries it.
  const [filter, setFilter] = useState<MyRankFilter>('all')
  // One expanded row at a time (lr-hub S9); any tab, chip or menu pick
  // collapses it.
  const [openRow, setOpenRow] = useState<string | null>(null)
  const view = `${state.src}|${state.pos}|${state.scoring}`
  const [openView, setOpenView] = useState(view)
  if (openView !== view) {
    setOpenView(view)
    setOpenRow(null)
  }

  const onCreate = () => {
    const active = activeWeekOf(currentWeek)
    // New ranking starts on the position last used on this device (gap list
    // #32) — an AI expert's board keeps its own.
    const pos = author.id ? author.pos : (readLastRankPos() ?? rankPosOr(state.pos, 'RB'))
    nav.open(
      isMine
        ? { kind: 'new', step: 1, type: active <= 18 ? `w${active}` : 'season', pos }
        : { kind: 'new', step: 1, type: 'season', pos },
      'push',
    )
  }

  const pickTab = (key: SourceKey) => {
    setOpenRow(null)
    // Leaving an author's ranking carries its position over (lr-hub §3.2).
    if (author.id && key !== state.src) nav.setHub({ src: key, pos: author.pos })
    // A tab with position chips opens on the position last used (gap list
    // #32) — the same one it showed, unless Mine's editor or New ranking
    // used another since. FLEX stays FLEX from one chip tab to the next.
    else if (isChipSource(key)) {
      const keepFlex = state.pos === 'FLEX' && isChipSource(state.src)
      nav.setHub({ src: key, pos: keepFlex ? 'FLEX' : (readLastRankPos() ?? state.pos) })
    } else nav.setHub({ src: key })
  }

  return (
    <MobileScreen header={<RootHeader onCreate={onCreate} />}>
      <div className="px-4 pt-3">
        <div role="heading" aria-level={1} className="text-[26px] font-bold tracking-[-0.03em] text-m-t1">
          Rankings
        </div>
      </div>
      <SourceTabs active={state.src} author={author.board} authorId={author.id} onPick={pickTab} />
      {isMine ? (
        <MyRankingsBody nav={nav} filter={filter} setFilter={setFilter} />
      ) : author.id ? (
        <AuthorBody nav={nav} author={author} openRow={openRow} setOpenRow={setOpenRow} />
      ) : (
        <>
          <FilterBar nav={nav} onPick={() => setOpenRow(null)} />
          {state.src === 'ai' ? (
            <p className="px-4 py-9 text-center text-[13px] font-medium text-m-t3">No Scout AI ranking yet</p>
          ) : (
            <SourceBody nav={nav} openRow={openRow} setOpenRow={setOpenRow} />
          )}
        </>
      )}
    </MobileScreen>
  )
}

function SourceTabs({
  active,
  author,
  authorId,
  onPick,
}: {
  active: SourceKey
  author: ExpertBoard | null
  authorId: string | null
  onPick: (key: SourceKey) => void
}) {
  const tabs: Array<{ key: SourceKey; label: string }> = [
    { key: 'experts', label: 'Experts' },
    { key: 'ai', label: 'Scout AI' },
    { key: 'users', label: 'Users' },
    // Desktop Big Board's market boards, after Users (#29).
    { key: 'adp', label: 'ADP' },
    { key: 'auction', label: 'Auction' },
    // The author tab exists only while their ranking is open (lr-hub S4).
    ...(authorId ? [{ key: `p:${authorId}` as SourceKey, label: author?.persona.display_name ?? 'Ranking' }] : []),
    { key: 'mine', label: 'Mine' },
  ]
  // The row scrolls on a narrow phone: keep the open tab in view (Profile's
  // link opens Mine, the last one).
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])
  return (
    <div
      role="tablist"
      aria-label="Ranking source"
      className="mt-1.5 flex gap-[18px] overflow-x-auto border-b border-m-b3 px-4 scrollbar-none"
    >
      {tabs.map((t) => {
        const on = active === t.key
        return (
          <button
            key={t.key}
            ref={on ? activeRef : undefined}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(t.key)}
            className={cn(
              'relative flex h-[38px] flex-none items-center whitespace-nowrap text-[14px] font-semibold',
              on ? 'text-m-t1' : 'text-m-t3',
            )}
          >
            {t.label}
            {/* t1, not ink: the same ink in light mode, white in dark mode,
                where ink is a dim grey (gap list #34). */}
            {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-m-t1" />}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comparison data shared by the source and author bodies
// ---------------------------------------------------------------------------

type RankMap = Map<string, number>

interface CmpSource {
  /** Row label (lr-hub §2.9) and info-line header name (§2.8). */
  short: string
  full: string
  ranks: RankMap
}

interface Breakdown {
  /** First cells: the sources in the design's order, as present. */
  sources: Array<{ label: string; ranks: RankMap }>
  /** Each AI expert's rank of a player (Best / Worst / Std dev, the note). */
  expertRanks: Map<string, number[]> | null
  /** The user's own ranking of this type and position (S10), if any. */
  mine: RankMap | null
}

/** The user's season ranking at a chip (the hub's one type), for the
 *  breakdown's "Your rank" cell — FLEX in the board's overall order. */
function useMySeasonRanks(pos: HubPos): RankMap | null {
  const boards = useMyRankingBoards()
  return useMemo(() => {
    const ids = (boards.data?.season?.players ?? [])
      .filter((r) => inHubPos(r.player.position, pos))
      .map((r) => r.player_id)
    return ids.length > 0 ? new Map(ids.map((id, i) => [id, i + 1])) : null
  }, [boards.data, pos])
}

/** Whether a source's movement has a previous update to show (the switch
 *  appears only then), and the marks to show when it's on. */
function useMovementView(movement: ReadonlyMap<string, Movement> | undefined) {
  const [on, setOn] = useShowMovement('others')
  const available = (movement?.size ?? 0) > 0
  return {
    available,
    on,
    setOn,
    marks: available && on ? movement : undefined,
  }
}

/** What an ADP / Auction row shows beside the stats: the market value. */
function marketCell(key: MarketKey, value: number | undefined): StatCell {
  if (value === undefined) return { v: '–', l: key === 'adp' ? 'ADP' : 'Auction' }
  return key === 'adp' ? { v: fmt1(value), l: 'ADP' } : { v: `$${Math.round(value)}`, l: 'Auction' }
}

// ---------------------------------------------------------------------------
// Source body (Experts / Users / ADP / Auction): info line · rows
// ---------------------------------------------------------------------------

function SourceBody({
  nav,
  openRow,
  setOpenRow,
}: {
  nav: RankingsNav
  openRow: string | null
  setOpenRow: (id: string | null) => void
}) {
  const { state, currentWeek } = nav
  const isExperts = state.src === 'experts'
  const market: MarketKey | null = state.src === 'adp' || state.src === 'auction' ? state.src : null
  const experts = useExpertsSource(state.pos)
  const users = useUsersSource(state.pos)
  const markets = useMarketSource(market, state.pos)
  const pool = useHubPool(state.pos, state.scoring)
  const mine = useMySeasonRanks(state.pos)
  const isPre = currentWeek === 0

  const expertRanks = useMemo(() => sourceRankMap(experts.data?.rows), [experts.data])
  const userRanks = useMemo(() => sourceRankMap(users.data), [users.data])
  const hasExperts = expertRanks.size > 0
  const hasUsers = userRanks.size > 0

  // The other source with a ranking at this chip (Scout AI has none). ADP
  // and Auction show their market value instead of a comparison column.
  const cmp: CmpSource[] = market
    ? []
    : isExperts
      ? hasUsers
        ? [{ short: 'Users', full: 'Users', ranks: userRanks }]
        : []
      : hasExperts
        ? [{ short: 'Experts', full: 'Experts', ranks: expertRanks }]
        : []
  const breakdown: Breakdown = {
    sources: [
      ...(hasExperts ? [{ label: 'Experts', ranks: expertRanks }] : []),
      ...(hasUsers ? [{ label: 'Users', ranks: userRanks }] : []),
    ],
    expertRanks: hasExperts ? (experts.data?.ranks ?? null) : null,
    mine,
  }

  const active = market
    ? { isPending: markets.isPending, isError: markets.isError, refetch: markets.refetch }
    : isExperts
      ? experts
      : users
  const rows = (market ? markets.data?.rows : isExperts ? experts.data?.rows : users.data) ?? []
  const upd = isExperts ? updatedLabel(experts.data?.updatedAt) : null
  const line =
    market === 'adp'
      ? 'Average draft position'
      : market === 'auction'
        ? 'Average auction price'
        : isExperts
          ? `Consensus of ${plural(experts.data?.experts ?? 0, 'AI expert')}${upd ? ` · ${upd}` : ''}`
          : 'Average of user rankings'
  // Movement: only the experts' consensus keeps a previous version here.
  const move = useMovementView(isExperts ? experts.data?.movement : undefined)
  const extra = market
    ? (id: string) => marketCell(market, markets.data?.values.get(id))
    : undefined

  return (
    <>
      {(active.isPending || rows.length > 0) && (
        <InfoLine
          dot={isPre ? 'pre' : 'plain'}
          text={active.isPending ? '' : line}
          cmp={active.isPending ? [] : cmp}
          movement={move.available ? { on: move.on, onChange: move.setOn } : null}
        />
      )}
      <div className="px-4 pb-6">
        <RowsState
          isPending={active.isPending}
          isError={active.isError}
          refetch={() => void active.refetch()}
          empty={rows.length === 0 ? `No ${hubPosLabel(state.pos)} players in this ranking yet` : null}
        >
          <TieredRows
            rows={rows.slice(0, HUB_CAP)}
            pool={pool.data}
            cmp={cmp}
            breakdown={breakdown}
            movement={move.marks}
            extra={extra}
            openRow={openRow}
            setOpenRow={setOpenRow}
          />
        </RowsState>
      </div>
    </>
  )
}

function InfoLine({
  dot,
  text,
  cmp,
  movement = null,
}: {
  dot: 'pre' | 'plain'
  text: string
  cmp: readonly CmpSource[]
  /** The "Show movement" switch, when the ranking has a previous update. */
  movement?: { on: boolean; onChange: (on: boolean) => void } | null
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-2.5">
      <span className={cn('size-1.5 flex-none rounded-full', dot === 'pre' ? 'bg-brand' : 'bg-m-t5')} />
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-m-t3">{text}</span>
      {movement && <MovementSwitch variant="inline" on={movement.on} onChange={movement.onChange} />}
      {cmp.length > 0 && (
        <span className="flex-none whitespace-nowrap text-[10px] font-semibold text-m-t3">
          {cmp.map((c) => c.full).join(' · ')}
        </span>
      )}
    </div>
  )
}

function RowsState({
  isPending,
  isError,
  refetch,
  empty,
  children,
}: {
  isPending: boolean
  isError: boolean
  refetch: () => void
  empty: string | null
  children: React.ReactNode
}) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-1.5 pt-3.5" aria-busy="true" aria-label="Loading ranking">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-[54px] rounded-[14px] bg-m-b1" />
        ))}
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-9 text-center">
        <span className="text-[13px] font-medium text-m-t3">Couldn&apos;t load this ranking.</span>
        <button type="button" onClick={refetch} className="text-[13px] font-semibold text-accent">
          Try again
        </button>
      </div>
    )
  }
  if (empty) return <p className="py-9 text-center text-[13px] font-medium text-m-t3">{empty}</p>
  return <>{children}</>
}

function TieredRows({
  rows,
  pool,
  cmp,
  breakdown,
  movement,
  extra,
  openRow,
  setOpenRow,
}: {
  rows: HubRow[]
  pool: Map<string, PoolStat> | undefined
  cmp: readonly CmpSource[]
  breakdown: Breakdown
  /** Each player's movement since the previous update, when shown. */
  movement?: ReadonlyMap<string, Movement>
  /** A fourth stat cell (ADP / Auction's market value). */
  extra?: (id: string) => StatCell
  openRow: string | null
  setOpenRow: (id: string | null) => void
}) {
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const breaks = useMemo(() => tierBreaks(rows.map((r) => r.score)), [rows])
  const tiers = useMemo(() => {
    const starts = [0, ...breaks]
    return starts.map((s, i) => ({ tier: i + 1, start: s, end: starts[i + 1] ?? rows.length }))
  }, [breaks, rows.length])

  return (
    <>
      {tiers.map((t) => (
        <div key={t.tier}>
          <div className="flex items-center gap-2 pb-1 pt-3.5">
            <span className={tierChipClassFor(t.tier)}>Tier {t.tier}</span>
            <span aria-hidden className="h-px flex-1 bg-m-b3" />
            <span className="text-[10px] font-medium text-m-t3">{plural(t.end - t.start, 'player')}</span>
          </div>
          {rows.slice(t.start, t.end).map((r, j) => {
            const rank = t.start + j + 1
            const open = openRow === r.player.id
            return (
              <Fragment key={r.player.id}>
                <HubPlayerRow
                  rank={rank}
                  player={r.player}
                  stat={pool?.get(r.player.id)}
                  cmp={cmp}
                  movement={movement?.get(r.player.id)}
                  extra={extra?.(r.player.id)}
                  open={open}
                  onToggle={() => setOpenRow(open ? null : r.player.id)}
                  onOpenPlayer={() => openPlayer(r.player.id)}
                />
                {open && <BreakdownPanel player={r.player} breakdown={breakdown} />}
              </Fragment>
            )
          })}
        </div>
      ))}
    </>
  )
}

function HubPlayerRow({
  rank,
  player,
  stat,
  cmp,
  movement,
  extra,
  open,
  onToggle,
  onOpenPlayer,
}: {
  rank: number
  player: HubPlayer
  stat: PoolStat | undefined
  cmp: readonly CmpSource[]
  movement: Movement | undefined
  extra: StatCell | undefined
  open: boolean
  onToggle: () => void
  onOpenPlayer: () => void
}) {
  const short = shortName(player.full_name, player.position)
  return (
    <div className="relative flex min-h-[54px] w-full items-center gap-2.5 border-b border-m-b2 py-1.5">
      {/* The whole row toggles "Compare sources" (lr-hub §3.4); the headshot
          above it opens the player. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${short}, compare sources`}
        className="absolute inset-0"
      />
      {/* Rank over its movement (lr-frame §2.13.5): 9.5px, only when moved. */}
      <span className="flex w-[26px] flex-none flex-col items-center gap-px">
        <span className="text-[14px] font-bold text-m-t1">{rank}</span>
        <MovementMark m={movement} className="text-[9.5px]" />
      </span>
      <button
        type="button"
        onClick={onOpenPlayer}
        aria-label={`Open ${player.full_name}`}
        className="relative z-[1] flex-none rounded-full"
      >
        <MHeadshot player={player} size={36} />
      </button>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold text-m-t1">{short}</span>
        <span className="flex min-w-0 items-center gap-[5px] overflow-hidden whitespace-nowrap text-[11px] font-medium text-m-t3">
          {seasonSub(player.team, player.bye_week)}
        </span>
      </span>
      <StatCells cells={extra ? [...statCells(stat, player.position), extra] : statCells(stat, player.position)} />
      {cmp.length > 0 && (
        <>
          <span aria-hidden className="my-1.5 w-px flex-none self-stretch bg-m-b3" />
          <span className="flex flex-none gap-[2px]">
            {cmp.map((c) => {
              const other = c.ranks.get(player.id)
              return (
                <span key={c.short} className="flex w-8 flex-col items-center gap-px">
                  <span className={cn('text-[13px] font-semibold', cmpToneClass(other, rank))}>{other ?? '–'}</span>
                  <span className="whitespace-nowrap text-[9px] font-medium text-m-t3">{c.short}</span>
                </span>
              )
            })}
          </span>
        </>
      )}
    </div>
  )
}

/** Expanded "Compare sources" panel (lr-hub §2.9 S9/S10, §5.4). */
function BreakdownPanel({ player, breakdown }: { player: HubPlayer; breakdown: Breakdown }) {
  const er = breakdown.expertRanks?.get(player.id) ?? null
  const spread = er ? expertSpread(er) : null
  const cells: Array<{ v: string; l: string }> = breakdown.sources.map((s) => {
    const r = s.ranks.get(player.id)
    return { v: r ? `#${r}` : '–', l: s.label }
  })
  if (breakdown.expertRanks) {
    cells.push({ v: spread ? `#${spread.best}` : '–', l: 'Best expert' })
    cells.push({ v: spread ? `#${spread.worst}` : '–', l: 'Worst expert' })
  }
  if (breakdown.mine) {
    const r = breakdown.mine.get(player.id)
    cells.push({ v: r ? `#${r}` : '–', l: 'Your rank' })
  } else if (breakdown.expertRanks) {
    cells.push({ v: spread ? spread.sd.toFixed(1) : '–', l: 'Std dev' })
  }
  return (
    <div className="mb-2 mt-1.5 flex flex-col gap-2 rounded-[12px] bg-m-b1 p-2.5">
      <div className="grid grid-cols-3 gap-1.5">
        {cells.map((c) => (
          <div key={c.l} className="flex min-w-0 flex-col gap-px rounded-[10px] bg-m-b0 p-2">
            <span className="text-[15px] font-bold text-m-t1">{c.v}</span>
            <span className="truncate text-[10px] font-medium text-m-t3">{c.l}</span>
          </div>
        ))}
      </div>
      {spread && (
        <p className="text-pretty text-[11px] font-medium leading-[1.4] text-m-t2">
          {agreementNote(shortName(player.full_name, player.position), spread)}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Author view — an AI expert's own board (lr-hub §2.6 / S4)
// ---------------------------------------------------------------------------

function scoringName(v: string | null): string | null {
  if (v === 'PPR' || v === 'Standard') return v
  if (v === 'Half-PPR' || v === 'Half PPR') return 'Half PPR'
  return null
}

function AuthorBody({
  nav,
  author,
  openRow,
  setOpenRow,
}: {
  nav: RankingsNav
  author: ReturnType<typeof useAuthor>
  openRow: string | null
  setOpenRow: (id: string | null) => void
}) {
  const { state, currentWeek } = nav
  const pos = author.pos
  const playersQ = useAuthorBoard(author.board ? author.board.id : null)
  const experts = useExpertsSource(pos, author.board !== null)
  const pool = useHubPool(pos, state.scoring)
  const mine = useMySeasonRanks(pos)
  const [confirm, setConfirm] = useState(false)

  const rows = useMemo<HubRow[]>(() => {
    const out: HubRow[] = []
    ;(playersQ.data?.players ?? []).forEach((p, i) => {
      // The board is in the expert's order; its overall spots cut the tiers.
      if (out.length < HUB_CAP && fromDbPos(p.position) === pos) out.push({ player: p, score: -i })
    })
    return out
  }, [playersQ.data, pos])
  // The board's movement since its previous update, over its whole slice at
  // this position (the rows shown look themselves up).
  const move = useMovementView(useMemo(() => boardMovement(playersQ.data, pos), [playersQ.data, pos]))

  const expertRanks = useMemo(() => sourceRankMap(experts.data?.rows), [experts.data])
  const authorRanks = useMemo(() => sourceRankMap(rows), [rows])
  const hasExperts = expertRanks.size > 0
  // On an author's ranking Users drops out; the author takes its place (S4).
  const cmp: CmpSource[] = hasExperts ? [{ short: 'Experts', full: 'Experts', ranks: expertRanks }] : []
  const name = author.board?.persona.display_name ?? ''
  const breakdown: Breakdown = {
    sources: [...(hasExperts ? [{ label: 'Experts', ranks: expertRanks }] : []), { label: name, ranks: authorRanks }],
    expertRanks: hasExperts ? (experts.data?.ranks ?? null) : null,
    mine,
  }

  const startFrom = () => {
    if (!author.board) return
    nav.open({ kind: 'edit', type: 'season', pos, from: `p:${author.board.id}` }, 'push')
  }

  if (author.isPending) {
    return (
      <div className="px-4 pb-6">
        <RowsState isPending isError={false} refetch={() => undefined} empty={null}>
          {null}
        </RowsState>
      </div>
    )
  }
  if (author.isError || !author.board) {
    return (
      <div className="px-4 pb-6">
        <RowsState
          isPending={false}
          isError={author.isError}
          refetch={author.refetch}
          empty="This ranking isn't available"
        >
          {null}
        </RowsState>
      </div>
    )
  }

  const board = author.board
  const label = seasonLabel(currentWeek)
  const posLabel = rankPosLabel(pos)
  return (
    <>
      <AuthorCard
        board={board}
        title={[label, posLabel, scoringName(board.persona.scoring)].filter(Boolean).join(' · ')}
        onCopy={() => (mine ? setConfirm(true) : startFrom())}
      />
      <InfoLine
        dot={currentWeek === 0 ? 'pre' : 'plain'}
        text={cmp.length > 0 ? 'Compared with Experts · tap a player for detail' : 'Tap a player for detail'}
        cmp={cmp}
        movement={move.available ? { on: move.on, onChange: move.setOn } : null}
      />
      <div className="px-4 pb-6">
        <RowsState
          isPending={playersQ.isPending}
          isError={playersQ.isError}
          refetch={() => void playersQ.refetch()}
          empty={rows.length === 0 ? `No ${posLabel} players in this ranking` : null}
        >
          <TieredRows
            rows={rows}
            pool={pool.data}
            cmp={cmp}
            breakdown={breakdown}
            movement={move.marks}
            openRow={openRow}
            setOpenRow={setOpenRow}
          />
        </RowsState>
      </div>

      {/* "Start my ranking from this" over a ranking you already have asks
          first, as New ranking step 1 does (lr-hub Q6). */}
      <MobileSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={`You already have a ${label} · ${posLabel} ranking`}
        subtitle={`Starting from ${board.persona.display_name}'s replaces its order when you publish.`}
        footer={
          <div className="flex flex-col gap-2 px-4 pb-[30px] pt-1">
            <button
              type="button"
              onClick={() => {
                setConfirm(false)
                startFrom()
              }}
              className="flex h-12 items-center justify-center rounded-[14px] bg-accent text-[15px] font-semibold text-white"
            >
              Start from this ranking
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirm(false)
                nav.open({ kind: 'edit', type: 'season', pos, from: null }, 'push')
              }}
              className="flex h-12 items-center justify-center rounded-[14px] bg-m-b2 text-[15px] font-semibold text-m-t1"
            >
              Open my ranking
            </button>
          </div>
        }
      >
        <span className="sr-only">Choose whether to start over from this ranking or open yours.</span>
      </MobileSheet>
    </>
  )
}

function AuthorCard({ board, title, onCopy }: { board: ExpertBoard; title: string; onCopy: () => void }) {
  const ago = relativeAgo(board.updated_at)
  const name = board.persona.display_name
  const nameEl = featureFlags.personas ? (
    <Link href={`/personas/${board.persona.username}`} className="truncate text-[14px] font-semibold text-m-t1">
      {name}
    </Link>
  ) : (
    <span className="truncate text-[14px] font-semibold text-m-t1">{name}</span>
  )
  return (
    <div className="mx-4 mt-3 flex flex-col gap-2.5 rounded-[16px] bg-m-b1 p-3.5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'relative flex size-9 flex-none items-center justify-center overflow-hidden rounded-full text-[14px] font-semibold text-white',
            authorAvatarClass(board.persona.username),
          )}
        >
          {board.persona.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- small avatar
            <img src={board.persona.avatar_url} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            // No photo: the app-wide two-letter rule (gap list #8).
            computeInitials(name)
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          {nameEl}
          <span className="truncate text-[11px] font-medium text-m-t3">
            AI expert · {plural(board.player_count, 'player')}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[17px] font-bold tracking-[-0.01em] text-m-t1">{title}</span>
        <span className="text-[11px] font-medium text-m-t3">
          {title}
          {ago ? ` · updated ${ago}` : ''}
        </span>
      </div>
      {board.description ? (
        <p className="text-pretty text-[13px] font-medium leading-[1.4] text-m-t2">{board.description}</p>
      ) : null}
      <button
        type="button"
        onClick={onCopy}
        className="flex h-[38px] items-center justify-center gap-1.5 rounded-[12px] bg-m-b0 text-[13px] font-semibold text-m-t1 shadow-m-outline"
      >
        <RkIcon d={RK_ICON.copy} size={13} stroke={1.8} />
        Start my ranking from this
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sticky filter bar + menus (lr-hub §2.7)
// ---------------------------------------------------------------------------

function FilterBar({ nav, onPick }: { nav: RankingsNav; onPick: () => void }) {
  const { state, currentWeek } = nav
  const [menu, setMenu] = useState<null | 'type' | 'scoring'>(null)
  const typeLabel = seasonLabel(currentWeek)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  const pill = (k: 'type' | 'scoring', label: string) => (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={menu === k}
      onClick={() => setMenu((m) => (m === k ? null : k))}
      className="flex h-[30px] flex-none items-center gap-[5px] whitespace-nowrap rounded-pill bg-m-ink pl-3 pr-2.5 text-[13px] font-semibold text-white"
    >
      {label}
      <RkIcon d={RK_ICON.chevronDown} size={10} stroke={2.4} />
    </button>
  )

  // Scoring: PPR · Half PPR · 0.25 PPR · Standard (gap list #30), a 2×2 grid.
  const opts: ReadonlyArray<{ key: string; label: string; on: boolean; pick: () => void }> =
    menu === 'type'
      ? [{ key: 'season', label: typeLabel, on: true, pick: () => undefined }]
      : RANK_SCORINGS.map((s) => ({
          key: s.key,
          label: s.label,
          on: state.scoring === s.key,
          pick: () => nav.setHub({ scoring: s.key }),
        }))

  return (
    <div
      className={cn(
        'sticky top-[calc(env(safe-area-inset-top)+36px)] border-b border-m-b2 bg-m-b0 pb-2 pt-2.5',
        // An open menu lifts the bar over the dock so its catcher and card
        // cover the tab bar too (lr-hub §2.7, "Menu popover").
        menu ? 'z-[45]' : 'z-[5]',
      )}
    >
      <div className="flex gap-1.5 overflow-x-auto px-4 scrollbar-none">
        {pill('type', typeLabel)}
        {pill('scoring', scoringLabel(state.scoring))}
        <span aria-hidden className="mx-0.5 my-1 w-px flex-none bg-m-b3s" />
        {/* QB · RB · WR · TE · FLEX · K · D/ST — FLEX is RB/WR/TE overall (#29). */}
        {HUB_POSITIONS.map((p) => {
          const on = state.pos === p
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onPick()
                nav.setHub({ pos: p })
              }}
              className={cn(
                'flex h-[30px] flex-none items-center whitespace-nowrap rounded-pill px-3 text-[13px] font-semibold',
                on ? 'bg-accent text-white' : 'bg-m-b2 text-m-t1',
              )}
            >
              {hubPosLabel(p)}
            </button>
          )
        })}
      </div>
      {menu && (
        <>
          {/* Transparent outside-tap catcher: a tap anywhere else only closes the menu. */}
          <div aria-hidden className="fixed inset-0" onClick={() => setMenu(null)} />
          {/* A true overlay (a popover over scrolling content) — keeps its resting shadow. */}
          <div
            role="dialog"
            aria-label={menu === 'type' ? 'Ranking type' : 'Scoring'}
            className="absolute inset-x-4 top-[calc(100%+4px)] flex flex-col gap-2 rounded-[16px] bg-m-b0 p-3 shadow-m-menu"
          >
            <span className="text-[12px] font-semibold text-m-t3">{menu === 'type' ? 'Ranking type' : 'Scoring'}</span>
            <div className="grid grid-cols-2 gap-1.5">
              {opts.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={o.on}
                  onClick={() => {
                    onPick()
                    o.pick()
                    setMenu(null)
                  }}
                  className={cn(
                    'flex h-[38px] items-center justify-center rounded-[10px] px-2.5 text-[13px] font-semibold',
                    o.on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
