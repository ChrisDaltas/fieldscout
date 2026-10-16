'use client'

import { useState } from 'react'

import { RkIcon, RK_ICON } from '@/components/mobile/rankings/rank-parts'
import {
  RANK_POSITIONS,
  activeWeekOf,
  dbPos,
  formatSaved,
  fromDbPos,
  plural,
  rankPosLabel,
  rankableWeeks,
  rankingTitle,
  seasonLabel,
  shortName,
  weekOf,
  type RankFrom,
  type RankPos,
  type RankType,
} from '@/components/mobile/rankings/rankings-ops'
import { NFL_SEASON, latestSaved, useMyRankingBoards, type MyBoard } from '@/hooks/use-mobile-rankings-boards'
import { sourceDraft, useExpertsSource, useUsersSource } from '@/hooks/use-mobile-rankings-sources'
import { useNflWeekGames } from '@/hooks/use-nfl-week-games'
import { cn } from '@/lib/utils'

/**
 * New ranking (lr-myrank §2.2) for the types the app supports: a weekly
 * board — this week or one of the next three (Chris, 2026-10-15) — and the
 * season board (Rest of season / Pre-draft). Scoring isn't a ranking
 * dimension in the app, so step 1 has no Scoring block.
 *
 * A ranking "exists" when that board already holds players at the position
 * — then step 1 opens it. Otherwise step 2 picks where it starts: your
 * latest ranking (what the app seeds a new week from — desktop's default),
 * the AI experts' consensus, the users' average, or blank. Nothing is
 * written until the editor's Publish.
 */

export interface NewRankingProps {
  step: 1 | 2
  type: RankType
  pos: RankPos
  currentWeek: number
  onClose: () => void
  onChange: (next: { step?: 1 | 2; type?: RankType; pos?: RankPos }) => void
  onOpenEditor: (type: RankType, pos: RankPos, from: RankFrom | null) => void
}

/** The board a ranking of this type lives on (null: none yet). */
export function boardFor(data: { season: MyBoard | null; weeks: MyBoard[] } | undefined, type: RankType): MyBoard | null {
  if (!data) return null
  return type === 'season' ? data.season : (data.weeks.find((b) => b.week === weekOf(type)) ?? null)
}

/** What the server seeds a new week from: your latest earlier week, else
 *  the season board (/api/big-board/week/[n] carryover). */
export function carryBoard(data: { season: MyBoard | null; weeks: MyBoard[] } | undefined, week: number): MyBoard | null {
  if (!data) return null
  return [...data.weeks].filter((b) => b.week < week).sort((a, b) => b.week - a.week)[0] ?? data.season ?? null
}

/** "1. J. Gibbs 2. B. Robinson 3. S. Barkley" (single-spaced, short names). */
function top3(players: ReadonlyArray<{ full_name: string; position: string }>): string | null {
  const s = players
    .slice(0, 3)
    .map((p, i) => `${i + 1}. ${shortName(p.full_name, p.position)}`)
    .join(' ')
  return s || null
}

interface SourceOption {
  key: RankFrom
  label: string
  sub: string
  top: string | null
}

export function NewRanking({ step, type: typeProp, pos, currentWeek, onClose, onChange, onOpenEditor }: NewRankingProps) {
  const boards = useMyRankingBoards()
  const active = activeWeekOf(currentWeek)
  // This week and the next three. A week outside them (a stale or hand-made
  // link) falls back to this week, so a new ranking is never started on a
  // week that can't be ranked.
  const weeks = rankableWeeks(currentWeek)
  const type: RankType =
    typeProp !== 'season' && !weeks.includes(weekOf(typeProp))
      ? weeks.length > 0
        ? `w${active}`
        : 'season'
      : typeProp
  const weekly = type !== 'season'
  const week = weekOf(type)
  const summary = rankingTitle(type, pos, currentWeek)

  const board = boardFor(boards.data, type)
  const exists = (board?.players ?? []).some((r) => fromDbPos(r.player.position) === pos)

  // ---- step 2 sources --------------------------------------------------------
  const onStep2 = step === 2
  const experts = useExpertsSource(pos, onStep2)
  const users = useUsersSource(dbPos(pos), onStep2)
  const games = useNflWeekGames(onStep2 && weekly ? NFL_SEASON : undefined, onStep2 && weekly ? week : undefined)
  const sourcesPending = onStep2 && (experts.isPending || users.isPending || (weekly && games.isPending))
  const sourcesFailed = onStep2 && (experts.isError || users.isError)

  const options: SourceOption[] = []
  if (onStep2 && !sourcesPending) {
    if (weekly) {
      const carry = carryBoard(boards.data, week)
      const rows = (carry?.players ?? []).filter((r) => fromDbPos(r.player.position) === pos)
      if (carry && rows.length > 0) {
        const saved = formatSaved(latestSaved(rows))
        options.push({
          key: 'carry',
          label: carry.week > 0 ? `Your Week ${carry.week} ranking` : `Your ${seasonLabel(currentWeek).toLowerCase()} ranking`,
          sub: saved ? `${plural(rows.length, 'player')} · published ${saved}` : plural(rows.length, 'player'),
          top: top3(rows.map((r) => r.player)),
        })
      }
    }
    const ex = sourceDraft(experts.data?.rows, weekly, games.data)
    if (ex.length > 0) {
      options.push({
        key: 'experts',
        label: 'Expert consensus',
        sub: `Average of ${plural(experts.data?.experts ?? 0, 'AI expert')}`,
        top: top3(ex),
      })
    }
    const us = sourceDraft(users.data, weekly, games.data)
    if (us.length > 0) {
      options.push({ key: 'users', label: 'Users average', sub: 'Average of user rankings', top: top3(us) })
    }
    options.push({ key: 'blank', label: 'Start blank', sub: 'Add players one at a time', top: null })
  }
  const [pick, setPick] = useState<RankFrom | null>(null)
  const chosen = options.find((o) => o.key === pick)?.key ?? options[0]?.key ?? null

  const next = () => {
    if (step === 1) {
      if (exists) onOpenEditor(type, pos, null)
      else onChange({ step: 2 })
      return
    }
    if (chosen) onOpenEditor(type, pos, chosen)
  }

  const typeOptions: ReadonlyArray<{ key: string; label: string; sub: string; on: boolean; pick: () => void }> = [
    ...(weeks.length > 0
      ? [
          {
            key: 'weekly',
            label: 'Weekly',
            sub: 'One week of games. Locks once the week is played.',
            on: weekly,
            // Keeps the week already picked; otherwise this week.
            pick: () => onChange({ type: weekly ? type : `w${active}` }),
          },
        ]
      : []),
    {
      key: 'season',
      label: seasonLabel(currentWeek),
      sub:
        currentWeek === 0
          ? 'Your board for upcoming drafts. Syncs to the draft room.'
          : 'Where players finish from here. Your draft room uses it.',
      on: !weekly,
      pick: () => onChange({ type: 'season' }),
    },
  ]

  const disabled = step === 1 ? boards.isPending || boards.isError : sourcesPending || !chosen

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] text-m-t1" role="dialog" aria-label="New ranking">
      <div className="flex h-[52px] flex-none items-center gap-2 border-b border-m-b3 px-3">
        <button
          type="button"
          onClick={step === 1 ? onClose : () => onChange({ step: 1 })}
          aria-label={step === 1 ? 'Close' : 'Back'}
          className="flex size-9 flex-none items-center justify-center rounded-full text-m-t1"
        >
          <RkIcon d={step === 1 ? RK_ICON.close : RK_ICON.back} size={16} stroke={2} />
        </button>
        <span className="flex-1 text-center text-[16px] font-semibold">New ranking</span>
        {/* Two steps (the handoff's "of 3" counts a step that doesn't exist — lr-myrank ruling #21). */}
        <span className="w-9 flex-none text-right text-[12px] font-semibold text-m-t3">{step} of 2</span>
      </div>
      <div className="h-[3px] flex-none bg-m-b2">
        <div
          className="h-[3px] bg-accent transition-[width] duration-200 ease-linear"
          style={{ width: step === 1 ? '50%' : '100%' }}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-4 pb-6 pt-[18px] scrollbar-none">
        {step === 1 ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-[22px] font-bold tracking-[-0.02em]">What are you ranking?</span>
              <span className="text-[13px] font-medium text-m-t3">
                Each type is saved separately, so a Week 6 ranking never changes your Week 5 one.
              </span>
            </div>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Ranking type">
              {typeOptions.map((o) => (
                <RadioCard key={o.key} label={o.label} sub={o.sub} on={o.on} onPick={o.pick} />
              ))}
            </div>
            {weekly && (
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold text-m-t3">Week</span>
                <div className="flex flex-wrap gap-1.5">
                  {weeks.map((w) => (
                    <Chip
                      key={w}
                      label={`Week ${w}`}
                      note={w === active ? 'This week' : undefined}
                      on={week === w}
                      onPick={() => onChange({ type: `w${w}` })}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-m-t3">Position</span>
              <div className="grid grid-cols-4 gap-1.5">
                {RANK_POSITIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={pos === p}
                    onClick={() => onChange({ pos: p })}
                    className={cn(
                      'flex h-9 items-center justify-center rounded-[10px] text-[13px] font-semibold',
                      pos === p ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
                    )}
                  >
                    {rankPosLabel(p)}
                  </button>
                ))}
              </div>
            </div>
            {boards.isError ? (
              <div className="flex items-center gap-2 text-[12px] font-medium text-m-t3">
                Couldn&apos;t check your rankings.
                <button type="button" onClick={() => void boards.refetch()} className="font-semibold text-accent">
                  Try again
                </button>
              </div>
            ) : exists ? (
              <div className="rounded-[12px] bg-m-go px-3 py-2.5 text-[12px] font-medium leading-[1.4] text-m-to">
                You already have a {summary} ranking. Continuing opens it instead of starting a new one.
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-[22px] font-bold tracking-[-0.02em]">Start from</span>
              <span className="text-[13px] font-medium text-m-t3">{summary}</span>
            </div>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Start from">
              {sourcesPending
                ? Array.from({ length: 3 }, (_, i) => <div key={i} className="h-[78px] rounded-[14px] bg-m-b1" />)
                : options.map((o) => (
                    <RadioCard
                      key={o.key}
                      label={o.label}
                      sub={o.sub}
                      on={chosen === o.key}
                      onPick={() => setPick(o.key)}
                      top={o.top}
                    />
                  ))}
            </div>
            {sourcesFailed && (
              <div className="flex items-center gap-2 text-[12px] font-medium text-m-t3">
                Some rankings couldn&apos;t load.
                <button
                  type="button"
                  onClick={() => {
                    if (experts.isError) experts.refetch()
                    if (users.isError) void users.refetch()
                  }}
                  className="font-semibold text-accent"
                >
                  Try again
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex-none border-t border-m-b2 px-4 pb-[30px] pt-2.5">
        <button
          type="button"
          onClick={next}
          disabled={disabled}
          className="flex h-12 w-full items-center justify-center rounded-[14px] bg-accent text-[15px] font-semibold text-white"
        >
          {step === 2 ? 'Start ranking' : exists ? 'Open my ranking' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

function RadioCard({
  label,
  sub,
  on,
  onPick,
  top,
}: {
  label: string
  sub: string
  on: boolean
  onPick: () => void
  top?: string | null
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn('flex flex-col gap-2 rounded-[14px] bg-m-b1 px-3.5 py-3 text-left', on && 'shadow-m-select')}
    >
      <span className="flex w-full items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="whitespace-nowrap text-[15px] font-semibold text-m-t1">{label}</span>
          <span className="text-[12px] font-medium text-m-t3">{sub}</span>
        </span>
        <RadioDot on={on} />
      </span>
      {top ? <span className="w-full truncate whitespace-nowrap text-[11px] font-medium text-m-t3">{top}</span> : null}
    </button>
  )
}

/** 20px radio: a 6px blue annulus around the card colour when on, a 1.5px b4 ring when off. */
function RadioDot({ on }: { on: boolean }) {
  return on ? (
    <span aria-hidden className="flex size-5 flex-none items-center justify-center rounded-full bg-accent">
      <span className="size-2 rounded-full bg-m-b1" />
    </span>
  ) : (
    <span aria-hidden className="size-5 flex-none rounded-full border-[1.5px] border-m-b4m" />
  )
}

function Chip({ label, note, on, onPick }: { label: string; note?: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        'flex h-[34px] items-center gap-[5px] rounded-pill px-3.5 text-[13px] font-semibold',
        on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
      )}
    >
      {label}
      {/* Marks this week among the open ones (My rankings' count style). */}
      {note ? <span className="text-[11px] font-semibold opacity-60">· {note}</span> : null}
    </button>
  )
}
