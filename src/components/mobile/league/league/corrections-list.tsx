'use client'

import Link from 'next/link'
import { useState } from 'react'

import {
  CORRECTIONS_INTRO_COPY,
  CORRECTIONS_PROBLEM_COPY,
  CORRECTIONS_SHOW_OLDER_LABEL,
  CORRECTIONS_STALE_COPY,
  correctionCard,
  correctionWeekOptions,
  correctionsListView,
} from '@/components/leagues/corrections-view-ops'
import { teamPageHref } from '@/components/leagues/league-cells'
import { formatInstantWithDate } from '@/components/leagues/lineup-editor-ops'
import { MPosChip } from '@/components/mobile/ui/m-pos-chip'
import { useSchedule } from '@/hooks/use-schedule'
import { useStatCorrectionsLive } from '@/hooks/use-stat-corrections'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { CenteredNote, SkeletonBlocks, StatusLine } from './league-bits'

/**
 * Stat corrections in the mobile language — the same read and the same
 * words as the app's corrections view (`useStatCorrectionsLive`, the ops'
 * cards: only fixes that CHANGED a league score, each in the record's own
 * sentence), restyled: a week chip row, then one row per correction —
 * position, player (opens his profile), team, week and time; the stat
 * changes; the team (a door to its page), his points and the team score
 * before → after; the result, flagged when it changed. States: skeleton,
 * the server's own empty sentence, error with Try again, the stale and
 * reconnecting lines, a database without corrections said by name, and
 * Show older on the server's cursor.
 */
export function MobileCorrections({
  leagueId,
  initialWeek,
  leagueTimeZone,
  onWeekChange,
}: {
  leagueId: string
  initialWeek: number | null
  leagueTimeZone: string | null
  onWeekChange: (week: number | null) => void
}) {
  const [week, setWeek] = useState<number | null>(initialWeek)
  const schedule = useSchedule(leagueId)
  const corrections = useStatCorrectionsLive(leagueId, week === null ? {} : { week })
  const pages = corrections.data?.pages
  const view = pages ? correctionsListView(pages) : null
  const weekOptions = correctionWeekOptions((schedule.data?.weeks ?? []).map((w) => w.week), week)
  const pick = (value: string) => {
    const next = value === 'all' ? null : Number(value)
    setWeek(next)
    onWeekChange(next)
  }

  return (
    <div className="flex flex-col" data-mobile-corrections>
      <p className="px-1 pb-2.5 text-[12px] font-medium leading-[1.35] text-m-t3">{CORRECTIONS_INTRO_COPY}</p>
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-3 scrollbar-none" role="group" aria-label="Week">
        {weekOptions.map((o) => {
          const on = o.value === (week === null ? 'all' : String(week))
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => pick(o.value)}
              className={cn(
                'flex h-9 flex-none items-center whitespace-nowrap rounded-pill px-4 text-[13px] font-semibold',
                on ? 'bg-accent text-white' : 'bg-m-b2 text-m-t1',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {corrections.connection === 'reconnecting' && (
        <div className="pb-2">
          <StatusLine>Reconnecting — syncing this league…</StatusLine>
        </div>
      )}
      {corrections.isError && pages && (
        <div className="pb-2">
          <StatusLine>{CORRECTIONS_STALE_COPY}</StatusLine>
        </div>
      )}

      {corrections.isPending ? (
        <SkeletonBlocks count={3} className="h-[88px]" />
      ) : corrections.isError && !pages ? (
        <CenteredNote role="alert" message={CORRECTIONS_PROBLEM_COPY} action="Try again" onAction={() => void corrections.refetch()} />
      ) : view?.kind === 'unavailable' ? (
        <p className="rounded-[14px] bg-m-b1 px-3 py-3 text-[12px] font-medium text-m-t3" data-corrections-state="unavailable">
          {view.reason}
        </p>
      ) : view?.kind === 'empty' ? (
        <CenteredNote message={view.note} />
      ) : view?.kind === 'items' ? (
        <>
          <ol className="flex flex-col border-t border-m-b2" data-corrections-state="items">
            {view.items.map((item) => (
              <CorrectionRow key={item.id} leagueId={leagueId} card={correctionCard(item)} leagueTimeZone={leagueTimeZone} />
            ))}
          </ol>
          {view.hasMore && (
            <div className="flex justify-center py-4">
              <button
                type="button"
                onClick={() => void corrections.fetchNextPage()}
                disabled={corrections.isFetchingNextPage}
                className="text-[14px] font-semibold text-accent disabled:text-m-t4"
              >
                {corrections.isFetchingNextPage ? 'Loading…' : CORRECTIONS_SHOW_OLDER_LABEL}
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function CorrectionRow({
  leagueId,
  card,
  leagueTimeZone,
}: {
  leagueId: string
  card: ReturnType<typeof correctionCard>
  leagueTimeZone: string | null
}) {
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const when = formatInstantWithDate(card.recordedAt, leagueTimeZone)
  return (
    <li className="flex flex-col gap-1.5 border-b border-m-b2 px-1 py-3" data-correction={card.id} data-result-tone={card.result.tone}>
      <div className="flex min-w-0 items-center gap-1.5">
        {card.position && <MPosChip pos={card.position} />}
        <button type="button" onClick={() => openPlayer(card.playerId, leagueId)} className="min-w-0 truncate text-left text-[14px] font-semibold text-m-t1">
          {card.playerName}
        </button>
        {card.nflTeam && <span className="flex-none text-[11px] font-medium text-m-t3">{card.nflTeam}</span>}
        <span className="flex-1" />
        <span className="flex-none whitespace-nowrap text-[11px] font-medium tabular-nums text-m-t3" title={when.title ?? undefined}>
          Week {card.week} · {when.local}
        </span>
      </div>
      <ul className="flex flex-col text-[12px] font-medium text-m-t2" data-correction-stats>
        {card.stats.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] font-medium tabular-nums text-m-t3">
        <Link href={teamPageHref(leagueId, card.teamId)} className="font-semibold text-m-t1">
          {card.teamName}
        </Link>
        <span>{card.playerPoints}</span>
        <span>{card.teamScore}</span>
      </p>
      {card.result.tone === 'changed' ? (
        <div className="flex flex-wrap items-center gap-1.5" data-correction-result="changed">
          <span className="flex h-[18px] items-center rounded-pill bg-m-gr px-[7px] text-[10.5px] font-semibold text-m-tr">Result changed</span>
          {card.result.lines.map((line) => (
            <span key={line} className="text-[12px] font-semibold text-m-t1">
              {line}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11.5px] font-medium text-m-t3" data-correction-result={card.result.tone}>
          {card.result.lines[0]}
        </p>
      )}
    </li>
  )
}
