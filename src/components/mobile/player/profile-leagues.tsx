'use client'

import { useCallback, useEffect, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import type { MoveSheetKind } from '@/components/mobile/player/player-move-sheet'
import { clearsDay, movesTimeline, preDraftFor, shortDate, type MoveKind, type ProfileMove } from '@/components/mobile/player/profile-ops'
import { useProfileUiStore } from '@/components/mobile/player/profile-ui-store'
import { initials, leagueAvClass } from '@/components/mobile/shell/use-league-card'
import { useCardLeagueView } from '@/components/players/player-card-actions'
import { formatAdp } from '@/components/players/player-page-ops'
import { UsernameLink } from '@/components/shared/username-link'
import { useDraftQueue, useUpdateDraftQueue } from '@/hooks/use-draft-queue'
import { useLeague } from '@/hooks/use-league'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { useMobileProfileLeagueMoves } from '@/hooks/use-mobile-pprofile-league-moves'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Leagues (§2.7)
// ---------------------------------------------------------------------------

/**
 * One row per league the viewer is in: where he is there and the move that
 * fits, through the player card's own reads and gates (`useCardLeagueView`).
 * Add / Claim open the profile's move sheet in that league, Trade opens the
 * league's trade builder over the profile with him in it (§3 "Leagues:
 * Trade"), and a league that has not drafted offers its draft queue.
 *
 * Avatar colours follow the dock's league switcher (`leagueAvClass`: ink,
 * purple, blue, gold by list position) rather than §2.7's ink, gold,
 * purple, blue — one league reads the same colour everywhere in the app.
 */
export function LeaguesTab({
  player,
  pool,
  leagues,
  pending,
  error,
  onMove,
  onTrade,
}: {
  player: PlayerStatsPlayer
  pool: PoolPlayer
  leagues: MyLeagueRow[]
  pending: boolean
  error: boolean
  onMove: (kind: MoveSheetKind, leagueId: string) => void
  onTrade: (leagueId: string, teamId: string) => void
}) {
  if (pending) return <RowsSkeleton />
  if (error) return <Empty>Couldn’t load your leagues.</Empty>
  if (leagues.length === 0) return <Empty>Join a league to track availability.</Empty>
  return (
    <div className="px-4 py-2" data-profile-leagues>
      {leagues.map((l, i) => (
        <LeagueRow key={l.id} league={l} index={i} player={player} pool={pool} onMove={onMove} onTrade={onTrade} />
      ))}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-[30px] text-center text-[13px] font-medium text-m-t3">{children}</p>
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[46px] animate-pulse rounded-[12px] bg-m-b1" />
      ))}
    </div>
  )
}

type RowButton = { label: string; cls: string; open: boolean; reason?: string; run: () => void }

function LeagueRow({
  league,
  index,
  player,
  pool,
  onMove,
  onTrade,
}: {
  league: MyLeagueRow
  index: number
  player: PlayerStatsPlayer
  pool: PoolPlayer
  onMove: (kind: MoveSheetKind, leagueId: string) => void
  onTrade: (leagueId: string, teamId: string) => void
}) {
  const card = useCardLeagueView(pool, league.id)
  const detail = useLeague(league.id)

  let sub: React.ReactNode = 'Checking…'
  let subCls = 'text-m-t3'
  let button: RowButton | null = null
  let queue = false

  if (card.state === 'error') {
    sub = 'Couldn’t read this league.'
    subCls = 'text-negative-strong'
  } else if (card.state === 'ready') {
    const v = card.view
    const a = v.row.availability
    if (preDraftFor(league.status, a.kind === 'rostered')) {
      const adp = formatAdp(player.adp)
      const at = detail.data?.active_draft?.scheduled_at ?? detail.data?.settings.draft.draft_scheduled_at ?? null
      const date = at ? shortDate(at) : ''
      sub = ['Pre-draft', adp ? `ADP ${adp}` : null, date ? `Draft ${date}` : null].filter(Boolean).join(' · ')
      subCls = 'text-m-to'
      queue = true
    } else if (a.kind === 'rostered' && a.mine) {
      sub = `On your team · ${a.teamName}`
      subCls = 'text-accent'
    } else if (a.kind === 'rostered') {
      const mgr = detail.data?.members.find((m) => m.team_id === a.teamId)?.profiles?.username
      sub = mgr ? (
        <>
          Rostered by <UsernameLink username={mgr} />
        </>
      ) : (
        `Rostered by ${a.teamName}`
      )
      if (v.kind === 'theirs') {
        const trade = v.trade
        button = {
          label: 'Trade',
          cls: 'bg-accent',
          open: trade.open,
          reason: trade.open ? undefined : trade.reason,
          run: () => onTrade(league.id, v.teamId),
        }
      }
    } else {
      const waivers = a.kind === 'on_waivers'
      const day = waivers ? clearsDay(a.until) : null
      sub = waivers ? (day ? `On waivers · ${day}` : 'On waivers') : 'Free agent'
      subCls = waivers ? 'text-m-to' : 'text-positive-strong'
      if (v.kind === 'available') {
        const claim = v.acquire.kind === 'claim' || (v.acquire.kind === 'none' && waivers)
        button = {
          label: claim ? 'Claim' : 'Add',
          cls: claim ? 'bg-m-gold' : 'bg-confirm',
          open: !v.acquire.disabled,
          reason: v.acquire.disabled ? v.acquire.title : undefined,
          run: () => onMove('acquire', league.id),
        }
      }
    }
  }

  const draftId = detail.data?.active_draft?.id ?? null
  return (
    <div className="flex min-h-[58px] items-center gap-3 border-b border-m-b2" data-profile-league-row={league.id}>
      <span className={cn('flex size-8 flex-none items-center justify-center rounded-[9px] text-[11px] font-semibold', leagueAvClass(index))}>
        {initials(league.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-semibold">{league.name}</span>
        <span className={cn('truncate text-[12px] font-medium', subCls)} data-profile-league-status>
          {sub}
        </span>
      </span>
      {queue && draftId && league.my_team_id ? (
        <QueueButton leagueId={league.id} leagueName={league.name} draftId={draftId} teamId={league.my_team_id} playerId={player.id} />
      ) : (
        button && (
          <button
            type="button"
            aria-disabled={!button.open || undefined}
            onClick={() => (button.open ? button.run() : toast({ title: button.reason ?? 'Not available right now.' }))}
            className={cn('flex h-[30px] flex-none items-center rounded-pill px-3.5 text-[12px] font-semibold text-white', button.cls, !button.open && 'opacity-40')}
          >
            {button.label}
          </button>
        )
      )}
    </div>
  )
}

/**
 * "Add to queue" — the draft room's Queue (`DraftCardActions`), for a
 * league that has not drafted yet (a Leagues row) or the draft seat the
 * profile was opened from (the header pill). An unread queue is never
 * treated as empty (the route REPLACES the whole list, R1463): the
 * replacement is always built from a fresh read (R1464), and a failed read
 * says so instead of sending.
 */
export function QueueButton({
  leagueId,
  leagueName,
  draftId,
  teamId,
  playerId,
  variant = 'row',
}: {
  /** Null for a mock draft. */
  leagueId: string | null
  leagueName: string | null
  draftId: string
  teamId: string
  playerId: string
  variant?: 'row' | 'header'
}) {
  const queue = useDraftQueue(draftId, teamId)
  const update = useUpdateDraftQueue(leagueId, draftId, teamId)
  const queued = !!queue.data?.some((r) => r.player_id === playerId)
  const onQueue = async () => {
    const fresh = await queue.refetch()
    if (fresh.isError || !fresh.data) {
      toast({ title: 'Couldn’t load your queue — try again.' })
      return
    }
    const ids = fresh.data.map((r) => r.player_id).filter((id) => id !== playerId)
    update.mutate([...ids, playerId], {
      onSuccess: () => toast({ title: leagueName ? `Added to your ${leagueName} queue` : 'Added to your queue' }),
      onError: (err) => toast({ title: err instanceof Error ? err.message : 'Couldn’t queue him.' }),
    })
  }
  const header = variant === 'header'
  return (
    <button
      type="button"
      // Waits for the first read. A failed read stays tappable — the tap
      // re-reads and says why it could not queue.
      disabled={queue.isPending || queued || update.isPending || queue.isFetching}
      onClick={() => void onQueue()}
      className={cn(
        'flex h-[30px] flex-none items-center whitespace-nowrap rounded-pill px-3.5 font-semibold disabled:cursor-default',
        header ? 'text-[13px]' : 'text-[12px]',
        queued ? 'bg-m-b2 text-m-t3' : 'bg-m-ink text-white disabled:opacity-40',
      )}
      data-profile-queue={variant}
    >
      {queued ? 'In your queue' : 'Add to queue'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Transactions (§2.8)
// ---------------------------------------------------------------------------

const KIND_PILL: Record<MoveKind, string> = {
  Added: 'bg-m-gg text-positive-strong',
  Drafted: 'bg-m-gb text-accent',
  Dropped: 'bg-m-gr text-negative-strong',
  Traded: 'bg-m-b2 text-m-t1',
}

/**
 * League filter chips, then his moves as ONE timeline (Chris, #46,
 * 2026-10-15): every shown league's moves merged newest first, each row
 * naming its league — no per-league grouping. The filter is remembered for
 * the session. The timeline waits until every shown league has answered,
 * so rows never reshuffle as a slower league lands; a league whose read
 * failed is named above the list (the timeline is missing its moves).
 */
export function TransactionsTab({
  playerId,
  leagues,
  pending,
  error,
}: {
  playerId: string
  leagues: MyLeagueRow[]
  pending: boolean
  error: boolean
}) {
  const stored = useProfileUiStore((s) => s.txFilter)
  const setFilter = useProfileUiStore((s) => s.setTxFilter)
  const filter = stored === 'all' || leagues.some((l) => l.id === stored) ? stored : 'all'
  const shown = filter === 'all' ? leagues : leagues.filter((l) => l.id === filter)
  const [reports, setReports] = useState<Record<string, MovesReport>>({})
  const report = useCallback(
    (leagueId: string, r: MovesReport) =>
      setReports((cur) => {
        const was = cur[leagueId]
        return was && was.state === r.state && was.moves === r.moves && was.truncated === r.truncated ? cur : { ...cur, [leagueId]: r }
      }),
    [],
  )

  if (pending) return <RowsSkeleton />
  if (error) return <Empty>Couldn’t load your leagues.</Empty>
  const got = shown.map((l) => ({ league: l, r: reports[l.id] }))
  const loading = got.some(({ r }) => !r || r.state === 'loading')
  const failed = got.filter(({ r }) => r?.state === 'error').map(({ league }) => league)
  const timeline = loading
    ? []
    : movesTimeline(got.filter(({ r }) => r?.state === 'ready').map(({ league, r }) => ({ leagueId: league.id, leagueName: league.name, moves: r!.moves })))
  const truncated = got.filter(({ r }) => r?.state === 'ready' && r.truncated).map(({ league }) => league)
  return (
    <div data-profile-tx>
      {shown.map((l) => (
        <LeagueMovesReporter key={l.id} leagueId={l.id} playerId={playerId} report={report} />
      ))}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-1.5 pt-3 scrollbar-none" role="group" aria-label="League">
        {[{ id: 'all', name: 'All leagues' }, ...leagues].map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={filter === c.id}
            onClick={() => setFilter(c.id)}
            className={cn(
              'flex h-[30px] flex-none items-center whitespace-nowrap rounded-pill px-3 text-[12px] font-semibold',
              filter === c.id ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex flex-col gap-2 px-4 py-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[44px] animate-pulse rounded-[12px] bg-m-b1" />
          ))}
        </div>
      ) : (
        <div className="px-4" data-profile-tx-timeline>
          {failed.map((l) => (
            <p key={l.id} className="border-b border-m-b2 py-3 text-[13px] font-medium text-negative-strong" role="alert">
              Couldn’t read {l.name}’s moves.
            </p>
          ))}
          {timeline.map((m) => (
            <div key={m.key} className="flex items-center gap-2.5 border-b border-m-b2 py-3" data-profile-move={m.kind} data-move-league={m.leagueId}>
              <span className={cn('flex h-[22px] min-w-[62px] flex-none items-center justify-center rounded-pill px-2 text-[11px] font-semibold', KIND_PILL[m.kind])}>
                {m.kind}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-[13px] font-semibold">
                  <MoveText move={m} />
                </span>
                <span className="truncate text-[11px] font-medium text-m-t3">{m.leagueName}</span>
              </span>
              <span className="flex-none whitespace-nowrap text-[11px] font-medium text-m-t3">{shortDate(m.at)}</span>
            </div>
          ))}
          {truncated.map((l) => (
            <p key={l.id} className="py-2 text-[11px] font-medium text-m-t3">
              Older moves in {l.name} aren’t shown.
            </p>
          ))}
          {timeline.length === 0 && failed.length === 0 && (
            <p className="py-[30px] text-center text-[13px] font-medium text-m-t3">
              {filter === 'all' && shown.length !== 1 ? 'No transactions in your leagues' : 'No transactions in this league'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

type MovesReport = { state: 'loading' | 'error' | 'ready'; moves: ProfileMove[]; truncated: boolean }

/** One league's moves of him, read and reported up to the timeline. */
function LeagueMovesReporter({
  leagueId,
  playerId,
  report,
}: {
  leagueId: string
  playerId: string
  report: (leagueId: string, r: MovesReport) => void
}) {
  const { state, moves, truncated } = useMobileProfileLeagueMoves(leagueId, playerId)
  useEffect(() => report(leagueId, { state, moves, truncated }), [leagueId, state, moves, truncated, report])
  return null
}

function MoveText({ move }: { move: ProfileMove }) {
  return (
    <>
      {move.lead}
      {move.username ? <UsernameLink username={move.username} /> : (move.team ?? 'a team')}
      {move.detail}
    </>
  )
}

// ---------------------------------------------------------------------------
// History › Transactions (§2.10)
// ---------------------------------------------------------------------------

const KIND_TEXT: Record<MoveKind, string> = {
  Added: 'text-positive-strong',
  Dropped: 'text-negative-strong',
  Drafted: 'text-accent',
  Traded: 'text-m-t1',
}

/** His moves as History's grey cards (white pill, wrapping text) for the
 *  given leagues; none at all reads "None · No transactions this season". */
export function MovesCards({ playerId, leagueIds }: { playerId: string; leagueIds: string[] }) {
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const done = leagueIds.every((id) => counts[id] !== undefined && counts[id] !== null)
  const total = leagueIds.reduce((a, id) => a + (counts[id] ?? 0), 0)
  return (
    <>
      {leagueIds.map((id) => (
        <LeagueMoveCards
          key={id}
          leagueId={id}
          playerId={playerId}
          report={(n) => setCounts((cur) => (cur[id] === n ? cur : { ...cur, [id]: n }))}
        />
      ))}
      {done && total === 0 && (
        <div className="flex items-center gap-2.5 rounded-[12px] bg-m-b1 px-3 py-2.5">
          <span className="flex h-[22px] flex-none items-center rounded-pill bg-m-b0 px-2 text-[11px] font-semibold text-m-t3">None</span>
          <span className="min-w-0 flex-1 text-[12px] font-medium text-m-t2">No transactions this season</span>
        </div>
      )}
    </>
  )
}

function LeagueMoveCards({ leagueId, playerId, report }: { leagueId: string; playerId: string; report: (n: number | null) => void }) {
  const moves = useMobileProfileLeagueMoves(leagueId, playerId)
  const count = moves.state === 'ready' ? moves.moves.length : null
  useEffect(() => report(count), [count, report])
  if (moves.state === 'loading') return <div className="h-[42px] animate-pulse rounded-[12px] bg-m-b1" />
  if (moves.state === 'error') {
    return <p className="text-[12px] font-medium text-negative-strong">Couldn’t read {moves.leagueName ?? 'this league'}’s moves.</p>
  }
  return (
    <>
      {moves.moves.map((m) => (
        <div key={m.id} className="flex items-center gap-2.5 rounded-[12px] bg-m-b1 px-3 py-2.5" data-history-move={m.kind}>
          <span className={cn('flex h-[22px] flex-none items-center rounded-pill bg-m-b0 px-2 text-[11px] font-semibold', KIND_TEXT[m.kind])}>{m.kind}</span>
          <span className="min-w-0 flex-1 text-[12px] font-medium text-m-t2">
            <MoveText move={m} />
          </span>
          <span className="flex-none text-[11px] font-medium text-m-t3">{shortDate(m.at)}</span>
        </div>
      ))}
    </>
  )
}
