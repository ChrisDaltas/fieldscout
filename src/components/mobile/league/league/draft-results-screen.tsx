'use client'

import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { parseDraftOrder } from '@/components/draft/draft-board-ops'
import { recapVariant } from '@/components/draft/draft-recap-ops'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
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
  EMPTY_TEAM_COPY,
  MOCK_LINE,
  NO_RESULTS_COPY,
  draftResultRows,
  draftResultTeams,
  draftRoundCount,
  draftTeamSpend,
  resultsSearch,
  roundFromParam,
  rowsForTeam,
  rowsInRound,
  teamFromParam,
  type DraftResultRow,
} from './draft-results-ops'
import { CenteredNote, LeaguePageBar, PageChip, useChipRowInView } from './league-bits'

/**
 * League Menu › Draft results (handoff m-community G3; gap list §3 #15) —
 * the phone's screen for `/draft/recap`: a 52px bar (blue back chevron,
 * "Draft results"), round chips, then that round's picks — pick number,
 * headshot, name over position · team, and the team that made it, in blue
 * when it's yours. Tapping a pick opens the player's card.
 *
 * A By round / By team switch sits over the chips (the design draws only
 * rounds; By team keeps the desktop recap's rosters on the phone, the way
 * ESPN and Yahoo offer both): team chips, yours first and in blue, then that
 * team's picks — and on an auction, what it spent and its biggest buy.
 *
 * Same reads as the desktop recap (`DraftRecap`): the league's newest
 * completed real draft, or `?draft=<id>` (a practice draft a league-mate
 * opened from a link), and its `draft_picks`. The chips are the draft's own
 * rounds; the round (`?round=`) and the team (`?team=`, By team only) ride
 * the address (no navigation) so a reload or Back reopens them. An auction
 * has no rounds — its first view lists every buy in nomination order,
 * priced. Back goes to where you came from (the Menu's screen), else the
 * League tab.
 */
export function MobileDraftResults({ leagueId, draftIdParam }: { leagueId: string; draftIdParam?: string }) {
  const { user } = useAuth()
  const detail = useLeague(leagueId)
  // No `?draft=`: the league's completed REAL draft (practice drafts open
  // by explicit id only — a mock is its launcher's).
  const completedReal = useCompletedRealDraft(draftIdParam ? undefined : leagueId)
  const draftId = draftIdParam ?? completedReal.data?.id
  const room = useDraft(draftId)
  const header = <LeaguePageBar leagueId={leagueId} title="Draft results" />

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

type ResultsView = 'round' | 'team'

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
  const order = useMemo(() => parseDraftOrder(draft.draft_order), [draft.draft_order])
  const teamCount = order.length
  const rows = useMemo(() => draftResultRows(picks, { auction, teamCount, myTeamId }), [picks, auction, teamCount, myTeamId])
  const teamNameById = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const roundCount = draftRoundCount(draft.total_rounds, rows)
  const teams = useMemo(() => draftResultTeams(order, picks, myTeamId), [order, picks, myTeamId])

  const searchParams = useSearchParams()
  const [view, setView] = useState<ResultsView>(() => (searchParams?.get('team') && teams.length > 0 ? 'team' : 'round'))
  const [round, setRound] = useState(() => roundFromParam(searchParams?.get('round'), roundCount))
  const [team, setTeam] = useState(() => teamFromParam(searchParams?.get('team'), teams))
  const shown = Math.min(round, roundCount)
  const shownTeam = team && teams.includes(team) ? team : (teams[0] ?? null)
  // The address follows the segment and the chips without a navigation
  // (instant, scroll kept), so a reload or Back reopens what you had open.
  const remember = (at: { view: ResultsView; round: number; team: string | null }) => {
    const search = resultsSearch(window.location.search, { round: at.round, team: at.view === 'team' ? at.team : null })
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}`)
  }
  const chooseView = (next: ResultsView) => {
    setView(next)
    remember({ view: next, round: shown, team: shownTeam })
  }
  const chooseRound = (next: number) => {
    setRound(next)
    remember({ view, round: next, team: shownTeam })
  }
  const chooseTeam = (next: string) => {
    setTeam(next)
    remember({ view, round: shown, team: next })
  }

  // Opened at a later round or team: bring its chip into view in the scroller.
  // (The round and team scrollers are keyed apart, so neither inherits the
  // other's scroll position.)
  const chips = useChipRowInView<HTMLDivElement>(view)

  const playerIds = useMemo(() => rows.map((r) => r.playerId), [rows])
  const players = usePlayersByIds(playerIds)
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const byTeam = view === 'team' && shownTeam !== null
  const list = byTeam ? rowsForTeam(rows, shownTeam) : auction ? rows : rowsInRound(rows, shown)
  const spend = byTeam && auction ? draftTeamSpend(picks, shownTeam) : null
  const biggest = spend?.biggest ? players.playerById.get(spend.biggest.player_id) : undefined

  return (
    <div className="pb-8" data-draft-results>
      <div className="px-4 pt-3">
        <MSegmented
          options={auction ? AUCTION_VIEWS : ROUND_VIEWS}
          value={view}
          onChange={chooseView}
          label="Draft results view"
          className="gap-0 rounded-pill p-[3px]"
          itemClassName="h-[30px] rounded-pill text-[13px] font-semibold text-m-t1 transition-none"
          shadow="m-seg-3"
        />
      </div>
      {byTeam ? (
        <div key="teams" ref={chips} className="flex gap-1.5 overflow-x-auto px-4 pb-2 pt-2.5 scrollbar-none" role="group" aria-label="Teams" data-draft-teams>
          {teams.map((id) => (
            <PageChip key={id} on={id === shownTeam} mine={id === myTeamId} onClick={() => chooseTeam(id)} className="max-w-[180px]">
              <span className="truncate">{teamNameById.get(id) ?? 'Team'}</span>
            </PageChip>
          ))}
        </div>
      ) : auction ? (
        <p className="px-4 pb-2 pt-2.5 text-[12px] font-medium text-m-t3">{AUCTION_LINE}</p>
      ) : (
        <div key="rounds" ref={chips} className="flex gap-1.5 overflow-x-auto px-4 pb-2 pt-2.5 scrollbar-none" role="group" aria-label="Rounds" data-draft-rounds>
          {Array.from({ length: roundCount }, (_, i) => i + 1).map((r) => (
            <PageChip key={r} on={r === shown} onClick={() => chooseRound(r)}>
              Round {r}
            </PageChip>
          ))}
        </div>
      )}
      {draft.is_mock && <p className="px-4 pb-2 text-[12px] font-medium text-m-t3">{MOCK_LINE}</p>}
      {spend && (
        <p className="truncate px-4 pb-2 text-[12px] font-medium text-m-t3" data-draft-spend>
          <span className="font-semibold tabular-nums text-m-t1">${spend.total}</span> spent
          {spend.biggest && (
            <>
              {' · biggest buy '}
              <span className="font-semibold text-m-t1">{biggest?.full_name ?? 'Player'}</span>{' '}
              <span className="font-semibold tabular-nums text-m-t1">${spend.biggest.price ?? 0}</span>
            </>
          )}
        </p>
      )}
      <div className="px-4">
        {playerIds.length > 0 && players.isPending ? (
          <RowsSkeleton />
        ) : players.isError ? (
          <CenteredNote role="alert" message="Couldn’t load the players." action="Try again" onAction={() => void players.refetch()} />
        ) : list.length === 0 ? (
          <CenteredNote message={byTeam ? EMPTY_TEAM_COPY : EMPTY_ROUND_COPY} />
        ) : (
          list.map((row) => (
            <PickRow
              key={row.pickNumber}
              row={row}
              player={players.playerById.get(row.playerId)}
              // By team, every row is that team's — the name would only repeat.
              owner={byTeam ? undefined : (teamNameById.get(row.teamId) ?? 'Team')}
              onOpen={() => openPlayer(row.playerId, leagueId)}
            />
          ))
        )}
      </div>
    </div>
  )
}

const ROUND_VIEWS: ReadonlyArray<{ value: ResultsView; label: string }> = [
  { value: 'round', label: 'By round' },
  { value: 'team', label: 'By team' },
]
// An auction has no rounds: its first view is every buy, in order.
const AUCTION_VIEWS: ReadonlyArray<{ value: ResultsView; label: string }> = [
  { value: 'round', label: 'All buys' },
  { value: 'team', label: 'By team' },
]

function PickRow({ row, player, owner, onOpen }: { row: DraftResultRow; player: PlayerIdentity | undefined; owner?: string; onOpen: () => void }) {
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
      {owner !== undefined && (
        <span className={cn('max-w-[120px] flex-none truncate whitespace-nowrap text-[12px]', row.mine ? 'font-semibold text-accent' : 'font-medium text-m-t3')}>
          {owner}
        </span>
      )}
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
