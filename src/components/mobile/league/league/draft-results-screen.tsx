'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { parseDraftOrder } from '@/components/draft/draft-board-ops'
import { recapVariant } from '@/components/draft/draft-recap-ops'
import { MobileOverrideStrip } from '@/components/mobile/league/override-strip'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useCompletedRealDraft, useDraft, type DraftPickSummary } from '@/hooks/use-draft'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { usePlayersByIds, type PlayerIdentity } from '@/hooks/use-players-by-ids'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import type { Draft } from '@/types/database'

import {
  AUCTION_LINE,
  EMPTY_ROUND_COPY,
  MOCK_LINE,
  NO_RESULTS_COPY,
  draftResultRows,
  draftRoundCount,
  roundFromParam,
  roundSearch,
  rowsInRound,
  type DraftResultRow,
} from './draft-results-ops'
import { CenteredNote } from './league-bits'

/**
 * League Menu › Draft results (handoff m-community G3; gap list §3 #15) —
 * the phone's screen for `/draft/recap`: a 52px bar (blue back chevron,
 * "Draft results"), round chips, then that round's picks — pick number,
 * headshot, name over position · team, and the team that made it, in blue
 * when it's yours. Tapping a pick opens the player's card.
 *
 * Same reads as the desktop recap (`DraftRecap`): the league's newest
 * completed real draft, or `?draft=<id>` (a practice draft a league-mate
 * opened from a link), and its `draft_picks`. The chips are the draft's own
 * rounds; the round you're on rides `?round=` (no navigation) so a reload or
 * Back reopens it. An auction has no rounds — it lists every buy in
 * nomination order, priced. Back goes to where you came from (the Menu's
 * screen), else the League tab.
 */
export function MobileDraftResults({ leagueId, draftIdParam }: { leagueId: string; draftIdParam?: string }) {
  const { user } = useAuth()
  const detail = useLeague(leagueId)
  // No `?draft=`: the league's completed REAL draft (practice drafts open
  // by explicit id only — a mock is its launcher's).
  const completedReal = useCompletedRealDraft(draftIdParam ? undefined : leagueId)
  const draftId = draftIdParam ?? completedReal.data?.id
  const room = useDraft(draftId)
  const header = <DraftResultsBar leagueId={leagueId} />

  if (detail.isPending || (!draftIdParam && completedReal.isPending) || (draftId && room.isPending)) {
    return (
      <MobileScreen header={header}>
        <ResultsSkeleton />
      </MobileScreen>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <MobileScreen header={header}>
        <CenteredNote role="alert" message="Couldn’t load this league." action="Try again" onAction={() => void detail.refetch()} />
      </MobileScreen>
    )
  }
  if ((!draftIdParam && completedReal.isError) || room.isError) {
    return (
      <MobileScreen header={header}>
        <CenteredNote
          role="alert"
          message="Couldn’t load the draft results."
          action="Try again"
          onAction={() => void (room.isError ? room.refetch() : completedReal.refetch())}
        />
      </MobileScreen>
    )
  }
  const draft = room.data?.draft ?? null
  // One honest state (no leak): no finished draft here, an id we can't
  // read, another league's draft, or a draft still running.
  if (!draftId || !draft || draft.league_id !== leagueId || draft.status !== 'complete') {
    return (
      <MobileScreen header={header}>
        <CenteredNote message={NO_RESULTS_COPY} className="py-14" />
      </MobileScreen>
    )
  }
  return (
    <MobileScreen header={header}>
      <DraftResultsBody leagueId={leagueId} detail={detail.data} draft={draft} picks={room.data?.picks ?? []} userId={user?.id ?? null} />
    </MobileScreen>
  )
}

/** The G-page bar: back chevron in blue, the title centred, a spacer. */
function DraftResultsBar({ leagueId }: { leagueId: string }) {
  const goBack = useGoBack()
  return (
    <>
      <div className="flex h-[52px] items-center gap-2 border-b border-m-b3 px-3">
        <button
          type="button"
          onClick={() => goBack(`/app/leagues/${leagueId}`)}
          aria-label="Back"
          className="flex size-9 flex-none items-center justify-center rounded-full text-accent active:bg-m-b2"
          data-draft-results-back
        >
          <MIcon name="back" size={18} stroke={2} />
        </button>
        <h1 className="flex-1 text-center text-[16px] font-semibold text-m-t1">Draft results</h1>
        <span className="w-9 flex-none" aria-hidden />
      </div>
      <MobileOverrideStrip leagueId={leagueId} className="mb-1.5" />
    </>
  )
}

export function DraftResultsBody({
  leagueId,
  detail,
  draft,
  picks,
  userId,
}: {
  leagueId: string
  detail: LeagueDetail
  draft: Draft
  picks: DraftPickSummary[]
  userId: string | null
}) {
  const myMemberTeamId = userId ? (detail.members.find((m) => m.user_id === userId)?.team_id ?? null) : null
  const variant = recapVariant(draft, userId, myMemberTeamId)
  // Yours: your own team — or, on a practice draft, the seat that was played.
  const myTeamId = variant.kind === 'mock' ? variant.humanTeamId : variant.myTeamId
  const auction = draft.draft_type === 'auction'
  const teamCount = parseDraftOrder(draft.draft_order).length
  const rows = useMemo(() => draftResultRows(picks, { auction, teamCount, myTeamId }), [picks, auction, teamCount, myTeamId])
  const teamNameById = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const roundCount = draftRoundCount(draft.total_rounds, rows)

  const searchParams = useSearchParams()
  const [round, setRound] = useState(() => roundFromParam(searchParams?.get('round'), roundCount))
  const shown = Math.min(round, roundCount)
  const choose = (next: number) => {
    setRound(next)
    // The address follows the chip without a navigation (instant, scroll
    // kept), so a reload or Back reopens this round.
    const url = `${window.location.pathname}${roundSearch(window.location.search, next)}`
    window.history.replaceState(window.history.state, '', url)
  }

  // Opened at a later round: bring its chip into view in the scroller.
  const chips = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const row = chips.current
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (row && on && on.offsetLeft + on.offsetWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - 16
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])

  const playerIds = useMemo(() => rows.map((r) => r.playerId), [rows])
  const players = usePlayersByIds(playerIds)
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const list = auction ? rows : rowsInRound(rows, shown)

  return (
    <div className="pb-8" data-draft-results>
      {auction ? (
        <p className="px-4 pb-2 pt-3 text-[12px] font-medium text-m-t3">{AUCTION_LINE}</p>
      ) : (
        <div ref={chips} className="flex gap-1.5 overflow-x-auto px-4 pb-2 pt-3 scrollbar-none" role="group" aria-label="Rounds" data-draft-rounds>
          {Array.from({ length: roundCount }, (_, i) => i + 1).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => choose(r)}
              aria-pressed={r === shown}
              className={cn(
                'flex h-8 flex-none items-center whitespace-nowrap rounded-pill px-3.5 text-[12px] font-semibold',
                r === shown ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
              )}
            >
              Round {r}
            </button>
          ))}
        </div>
      )}
      {draft.is_mock && <p className="px-4 pb-2 text-[12px] font-medium text-m-t3">{MOCK_LINE}</p>}
      <div className="px-4">
        {playerIds.length > 0 && players.isPending ? (
          <RowsSkeleton />
        ) : players.isError ? (
          <CenteredNote role="alert" message="Couldn’t load the players." action="Try again" onAction={() => void players.refetch()} />
        ) : list.length === 0 ? (
          <CenteredNote message={EMPTY_ROUND_COPY} />
        ) : (
          list.map((row) => (
            <PickRow
              key={row.pickNumber}
              row={row}
              player={players.playerById.get(row.playerId)}
              owner={teamNameById.get(row.teamId) ?? 'Team'}
              onOpen={() => openPlayer(row.playerId, leagueId)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function PickRow({ row, player, owner, onOpen }: { row: DraftResultRow; player: PlayerIdentity | undefined; owner: string; onOpen: () => void }) {
  const name = player?.full_name ?? 'Player'
  const pos = player?.position ?? ''
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 border-b border-m-b2 py-2 text-left" data-draft-pick={row.pickNumber} data-mine={row.mine || undefined}>
      <span className="w-9 flex-none text-[12px] font-semibold tabular-nums text-m-t3">{row.label}</span>
      <MHeadshot player={player ?? { id: row.playerId, full_name: name, team: null }} size={34} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-semibold text-m-t1">{name}</span>
        <span className="truncate text-[11px] font-semibold">
          <span className={posTextClass(pos)}>
            {posLabel(pos)} · {player?.team ?? 'FA'}
          </span>
          {row.auto && <span className="text-m-t3"> · Auto</span>}
        </span>
      </span>
      <span className={cn('max-w-[120px] flex-none truncate whitespace-nowrap text-[12px]', row.mine ? 'font-semibold text-accent' : 'font-medium text-m-t3')}>
        {owner}
      </span>
    </button>
  )
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 border-b border-m-b2 py-2">
          <span className="h-3 w-7 flex-none animate-pulse rounded-[4px] bg-m-b1" />
          <span className="size-[34px] flex-none animate-pulse rounded-full bg-m-b1" />
          <span className="h-4 flex-1 animate-pulse rounded-[6px] bg-m-b1" />
          <span className="h-3 w-20 flex-none animate-pulse rounded-[4px] bg-m-b1" />
        </div>
      ))}
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div data-draft-results="loading">
      <div className="flex gap-1.5 overflow-hidden px-4 pb-2 pt-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="h-8 w-[78px] flex-none animate-pulse rounded-pill bg-m-b1" />
        ))}
      </div>
      <div className="px-4">
        <RowsSkeleton />
      </div>
    </div>
  )
}
