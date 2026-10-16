'use client'

import { useMemo } from 'react'

import { readLastRankPos } from '@/components/mobile/rankings/last-position'
import { StatusPill, type RankStatus } from '@/components/mobile/rankings/rank-parts'
import type { RankingsNav } from '@/components/mobile/rankings/rankings-hub'
import {
  RANK_POSITIONS,
  formatSaved,
  fromDbPos,
  opensInWeek,
  plural,
  rankPosOr,
  rankingTitle,
  seasonLabel,
  weekStatus,
  type RankPos,
  type RankType,
} from '@/components/mobile/rankings/rankings-ops'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { latestSaved, useMyRankingBoards, type BoardPlayerLite, type MyBoard } from '@/hooks/use-mobile-rankings-boards'
import { cn } from '@/lib/utils'

/**
 * My rankings (lr-myrank §2.1) — the Rankings screen's Mine tab since the
 * two became one screen (gap list #28) — over the user's real boards. A "ranking" is
 * one position's slice of a board, so each board shows a card per position
 * it holds. Statuses are the ones the app can express (Chris, 2026-10-15):
 * Published (a saved board — Publish is the only way to save, so every
 * stored ranking is published) and Finalized (a week that has been played —
 * read-only). There is no separate submission or draft state.
 *
 * Periods: Rest of season / Pre-draft, this week and the next three (open,
 * with Start when empty), later weeks locked ("Opens in Week N", three weeks
 * before), and past weeks only when they hold a ranking.
 */

export type MyRankFilter = 'all' | 'published' | 'finalized'

interface RankCard {
  key: string
  type: RankType
  pos: RankPos
  title: string
  status: RankStatus
  meta: string
  heads: BoardPlayerLite['player'][]
}

interface Period {
  key: string
  label: string
  type: RankType
  cards: RankCard[]
  /** Shown only when the period has no ranking at all. */
  empty: null | { open: boolean; sub: string }
}

function cardsFor(
  board: MyBoard,
  type: RankType,
  status: RankCard['status'],
  currentWeek: number,
  /** Leads the meta line — "This week" marks the current week's cards. */
  lead?: string,
): RankCard[] {
  const byPos = new Map<RankPos, BoardPlayerLite[]>()
  for (const r of board.players) {
    const pos = fromDbPos(r.player.position)
    if (!pos) continue
    const arr = byPos.get(pos) ?? []
    arr.push(r)
    byPos.set(pos, arr)
  }
  return RANK_POSITIONS.flatMap((pos) => {
    const rows = byPos.get(pos)
    if (!rows || rows.length === 0) return []
    const saved = formatSaved(latestSaved(rows))
    return [
      {
        key: `${type}-${pos}`,
        type,
        pos,
        title: rankingTitle(type, pos, currentWeek),
        status,
        meta: [lead, plural(rows.length, 'player'), saved].filter(Boolean).join(' · '),
        heads: rows.slice(0, 5).map((r) => r.player),
      },
    ]
  })
}

export function MyRankingsBody({
  nav,
  filter,
  setFilter,
}: {
  nav: RankingsNav
  filter: MyRankFilter
  setFilter: (f: MyRankFilter) => void
}) {
  const { currentWeek } = nav
  const boards = useMyRankingBoards()

  const periods = useMemo<Period[]>(() => {
    if (!boards.data) return []
    const out: Period[] = []
    const season = boards.data.season
    const seasonCards = season ? cardsFor(season, 'season', 'Published', currentWeek) : []
    out.push({
      key: 'season',
      label: seasonLabel(currentWeek),
      type: 'season',
      cards: seasonCards,
      empty: seasonCards.length === 0 ? { open: true, sub: 'Not started' } : null,
    })
    const byWeek = new Map(boards.data.weeks.map((b) => [b.week, b]))
    for (let w = 1; w <= 18; w++) {
      const type: RankType = `w${w}`
      const status = weekStatus(type, currentWeek)
      const board = byWeek.get(w)
      const cards = board
        ? cardsFor(
            board,
            type,
            status === 'past' ? 'Finalized' : 'Published',
            currentWeek,
            status === 'current' ? 'This week' : undefined,
          )
        : []
      if (cards.length > 0) {
        out.push({ key: type, label: `Week ${w}`, type, cards, empty: null })
      } else if (status === 'current') {
        out.push({ key: type, label: `Week ${w}`, type, cards, empty: { open: true, sub: 'This week · not started' } })
      } else if (status === 'upcoming') {
        out.push({ key: type, label: `Week ${w}`, type, cards, empty: { open: true, sub: 'Not started' } })
      } else if (status === 'future') {
        out.push({
          key: type,
          label: `Week ${w}`,
          type,
          cards,
          empty: { open: false, sub: `Opens in Week ${opensInWeek(w)}` },
        })
      }
    }
    return out
  }, [boards.data, currentWeek])

  const allCards = periods.flatMap((p) => p.cards)
  const counts = {
    all: allCards.length,
    published: allCards.filter((c) => c.status === 'Published').length,
    finalized: allCards.filter((c) => c.status === 'Finalized').length,
  }
  const chips: ReadonlyArray<{ key: MyRankFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'published', label: 'Published' },
    { key: 'finalized', label: 'Finalized' },
  ]
  const filtered =
    filter === 'all' ? [] : allCards.filter((c) => (filter === 'published' ? c.status === 'Published' : c.status === 'Finalized'))

  const openCard = (c: RankCard) => nav.open({ kind: 'edit', type: c.type, pos: c.pos, from: null }, 'push')
  // New ranking starts on the position last used on this device (gap list #32).
  const startPeriod = (type: RankType) =>
    nav.open({ kind: 'new', step: 1, type, pos: readLastRankPos() ?? rankPosOr(nav.state.pos, 'RB') }, 'push')

  return (
    <div className="flex flex-col gap-2.5 px-4 pb-6 pt-3.5">
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none" role="group" aria-label="Filter rankings">
        {chips.map((c) => {
          const on = filter === c.key
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(c.key)}
              className={cn(
                'flex h-[30px] flex-none items-center gap-[5px] whitespace-nowrap rounded-pill px-3 text-[13px] font-semibold',
                on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
              )}
            >
              {c.label}
              <span className="text-[11px] font-semibold opacity-60">{boards.data ? counts[c.key] : ''}</span>
            </button>
          )
        })}
      </div>

      {boards.isPending ? (
        Array.from({ length: 3 }, (_, i) => <div key={i} className="h-[104px] rounded-[16px] bg-m-b1" />)
      ) : boards.isError ? (
        <div className="flex flex-col items-center gap-2 py-9 text-center">
          <span className="text-[13px] font-medium text-m-t3">Couldn&apos;t load your rankings.</span>
          <button type="button" onClick={() => void boards.refetch()} className="text-[13px] font-semibold text-accent">
            Try again
          </button>
        </div>
      ) : filter === 'all' ? (
        periods.map((p) => (
          <div key={p.key} className="flex flex-col gap-2.5">
            {p.cards.map((c) => (
              <RankingCard key={c.key} card={c} onOpen={() => openCard(c)} />
            ))}
            {p.empty && (
              <EmptyPeriodCard
                label={p.label}
                sub={p.empty.sub}
                open={p.empty.open}
                onStart={() => startPeriod(p.type)}
              />
            )}
          </div>
        ))
      ) : filtered.length === 0 ? (
        <p className="py-9 text-center text-[13px] font-medium text-m-t3">
          {filter === 'finalized'
            ? 'No finalized rankings yet. Weekly rankings finalize once their week is played.'
            : 'No published rankings yet'}
        </p>
      ) : (
        filtered.map((c) => <RankingCard key={c.key} card={c} onOpen={() => openCard(c)} />)
      )}
    </div>
  )
}

function RankingCard({ card, onOpen }: { card: RankCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-2 rounded-[16px] px-3.5 py-3 text-left shadow-m-outline"
    >
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-m-t1">{card.title}</span>
        <StatusPill status={card.status} />
      </span>
      <span className="text-[12px] font-medium text-m-t3">{card.meta}</span>
      <span className="flex items-center">
        {card.heads.map((h) => (
          <span key={h.id} className="-mr-1.5 rounded-full shadow-m-badge">
            <MHeadshot player={h} size={26} />
          </span>
        ))}
      </span>
    </button>
  )
}

function EmptyPeriodCard({
  label,
  sub,
  open,
  onStart,
}: {
  label: string
  sub: string
  open: boolean
  onStart: () => void
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-m-t1">{label}</span>
        <span className="text-[12px] font-medium text-m-t3">{sub}</span>
      </span>
      {open && (
        <span className="flex h-7 flex-none items-center rounded-pill bg-accent px-3 text-[12px] font-semibold text-white">
          Start
        </span>
      )}
    </>
  )
  const cls = 'flex items-center gap-2 rounded-[16px] px-3.5 py-3 text-left shadow-m-outline'
  return open ? (
    <button type="button" onClick={onStart} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cn(cls, 'opacity-50')} aria-disabled="true">
      {body}
    </div>
  )
}
