'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { Crest } from '@/components/leagues/league-cells'
import { DropConfirm } from '@/components/leagues/drop-player-dialog'
import { formatInstantWithDate, lockBadgeFor } from '@/components/leagues/lineup-editor-ops'
import { moveReadout, poolRows } from '@/components/leagues/players-page-ops'
import { tradesHref } from '@/components/leagues/trades-ops'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useDraftQueue, useUpdateDraftQueue } from '@/hooks/use-draft-queue'
import { useLeague } from '@/hooks/use-league'
import { useLeaguePool } from '@/hooks/use-league-pool'
import { useLeagues, type MyLeagueRow } from '@/hooks/use-leagues'
import { useRosters } from '@/hooks/use-rosters'
import { useSubmitClaim } from '@/hooks/use-submit-claim'
import { tradeDeadlinePassed, useTradeDeadline } from '@/hooks/use-trade-deadline'
import { useAddDrop } from '@/hooks/use-transactions'
import { deriveRosterSize } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import { leagueCardContext, type PlayerCardContext } from './player-card-context'
import {
  acquireConfirmCopy,
  acquireConfirmVerb,
  acquireLabel,
  bidAllowed,
  cardLeagueView,
  claimPlacedCopy,
  droppable,
  leagueRowStatus,
  ROSTER_FULL_COPY,
  stepBid,
  type CardLeagueView,
} from './player-card-league-ops'

/**
 * The player card's actions block (League UX batch 2, built to the Claude
 * Design prototype's PlayerCard): a line saying where he is, then the one
 * move that fits — through the verbs that already exist (`useAddDrop`,
 * `useSubmitClaim`, the trade builder's `?with=&player=` door). Every
 * closed door says why instead of offering a button the server would
 * refuse. The commissioner sees HIS OWN team's actions only — acting for
 * another team stays in the commissioner tools.
 */

// ---------------------------------------------------------------------------
// League context
// ---------------------------------------------------------------------------

/** The league's card view for one player — the reads + the pure derivation
 *  the card's actions run on, shared by the card and the rail's Players tool
 *  (one flow, D483). React Query dedupes the reads across many rows. */
export function useCardLeagueView(player: PoolPlayer, leagueId: string) {
  const { user } = useAuth()
  const league = useLeague(leagueId)
  const rosters = useRosters(leagueId)
  const pool = useLeaguePool(leagueId)
  const deadline = useTradeDeadline(leagueId)
  const detail = league.data
  if (league.isPending || (rosters.isPending && !rosters.data) || (pool.isPending && !pool.data)) {
    return { state: 'loading' as const }
  }
  if (!detail || rosters.isError || pool.isError) return { state: 'error' as const }
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const tz = detail.settings.draft.time_zone ?? null
  const nextRun = detail.waiver_window?.next_run_at ?? null
  const view = cardLeagueView({
    player,
    leagueName: detail.league.name,
    leagueStatus: detail.league.status,
    rosters: rosters.data,
    pool: pool.data ?? [],
    myTeamId,
    rosterSize: deriveRosterSize(detail.settings.roster_settings),
    waiverType: detail.settings.waiver_type,
    waiverWindow: detail.waiver_window ?? null,
    claimsLive: detail.waivers_live !== false,
    tradesClosed: tradeDeadlinePassed(deadline.data),
    minBid: detail.settings.faab_min_bid,
    nextRunLocal: nextRun ? formatInstantWithDate(nextRun, tz).local : null,
    formatInstant: (iso) => formatInstantWithDate(iso, tz).local,
  })
  return { state: 'ready' as const, view, myTeamId }
}

export function LeagueCardActions({ player, leagueId }: { player: PoolPlayer; leagueId: string }) {
  const card = useCardLeagueView(player, leagueId)
  // D481: held here so "Added X" survives the card re-deriving him as yours.
  const move = useAddDrop(leagueId)
  if (card.state === 'loading') return <Skeleton className="h-12 w-full" />
  if (card.state === 'error') {
    return <p className="text-[11px] font-medium text-n-3">Couldn’t read this league right now.</p>
  }
  return <LeagueActionsBody view={card.view} leagueId={leagueId} myTeamId={card.myTeamId} move={move} />
}

/** The rail's "+" (D483): the card's own pickup flow — the same confirm, the
 *  same FAAB bid step, the same drop picker on a full roster — laid out
 *  inline in a row (the + in the row, the step wrapping below it). Renders
 *  nothing while loading or when he is not available to the viewer's team.
 *  An add's readout is the host's to keep (`addDropKeys`): the row leaves
 *  the free-agent list as soon as the rosters re-read. */
export function RailPickup({ player, leagueId }: { player: PoolPlayer; leagueId: string }) {
  const card = useCardLeagueView(player, leagueId)
  if (card.state !== 'ready' || card.view.kind !== 'available' || !card.myTeamId) return null
  return <PickupActions view={card.view} leagueId={leagueId} teamId={card.myTeamId} inline />
}

/** The block for one computed view — exported for the render tests. */
type MoveHandle = ReturnType<typeof useAddDrop>

export function LeagueActionsBody({
  view,
  leagueId,
  myTeamId,
  move,
  confirmOpen,
}: {
  view: CardLeagueView
  leagueId: string
  myTeamId: string | null
  move?: MoveHandle
  /** Render with the + already pressed (the step open) — render tests. */
  confirmOpen?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5" data-card-league={view.kind}>
      <p className="text-[12px] font-extrabold text-ink" data-card-where>
        {view.where}
      </p>
      {view.kind === 'mine' && myTeamId && <MineActions view={view} leagueId={leagueId} teamId={myTeamId} />}
      {view.kind === 'theirs' &&
        (view.trade.open ? (
          <span>
            <Button variant="stroke" size="sm" asChild>
              <Link href={tradesHref(leagueId, { teamId: view.teamId, playerId: view.row.player.id })} data-card-action="trade">
                Propose trade
              </Link>
            </Button>
          </span>
        ) : (
          <ClosedReason>{view.trade.reason}</ClosedReason>
        ))}
      {view.kind !== 'available' && move?.data && (
        <p className="text-[12px] font-semibold text-positive-strong" role="status" data-card-result>
          {moveReadout(move.data, (iso) => iso).headline}.
        </p>
      )}
      {view.kind === 'available' && myTeamId && <PickupActions view={view} leagueId={leagueId} teamId={myTeamId} move={move} confirmOpen={confirmOpen} />}
    </div>
  )
}

function ClosedReason({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium text-n-3" data-card-closed>
      {children}
    </p>
  )
}

function MineActions({ view, leagueId, teamId }: { view: Extract<CardLeagueView, { kind: 'mine' }>; leagueId: string; teamId: string }) {
  const [confirming, setConfirming] = useState(false)
  if (!view.drop.open) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Button variant="stroke" size="sm" disabled data-card-action="drop">
          Drop
        </Button>
        <ClosedReason>{view.drop.reason}</ClosedReason>
      </span>
    )
  }
  if (confirming) {
    return (
      <DropConfirm
        leagueId={leagueId}
        teamId={teamId}
        player={{ player_id: view.row.player.id, full_name: view.row.player.full_name }}
        onClose={() => setConfirming(false)}
      />
    )
  }
  return (
    <span>
      <Button variant="stroke" size="sm" onClick={() => setConfirming(true)} data-card-action="drop">
        Drop
      </Button>
    </span>
  )
}

export function PickupActions({
  view,
  leagueId,
  teamId,
  move: held,
  confirmOpen = false,
  inline = false,
}: {
  view: Extract<CardLeagueView, { kind: 'available' }>
  leagueId: string
  teamId: string
  move?: MoveHandle
  confirmOpen?: boolean
  /** The rail's row layout (D483): the block dissolves into the row (CSS
   *  `contents`) so the + sits in the row and the step wraps below it. */
  inline?: boolean
}) {
  const own = useAddDrop(leagueId)
  const move = held ?? own
  const claim = useSubmitClaim(leagueId)
  const [dropId, setDropId] = useState<string>('')
  const [bid, setBid] = useState<number>(view.faab?.min ?? 0)
  // D481(n) (Chris 2026-10-03, "Always confirm first"): EVERY press opens the
  // one step first — the confirm, or for a FAAB claim the bid — and only its
  // button sends. There is no one-press path.
  const [choosing, setChoosing] = useState(confirmOpen)
  const choices = useMemo(() => droppable(view.myRoster, (p) => lockBadgeFor(p.game_lock, true).locked), [view.myRoster])
  const playerId = view.row.player.id
  const name = view.row.player.full_name
  const acq = view.acquire
  const faab = acq.kind === 'claim' && view.faab ? view.faab : null
  const pending = move.isPending || claim.isPending

  if (move.data) {
    return (
      <p className="text-[12px] font-semibold text-positive-strong" role="status" data-card-result>
        {moveReadout(move.data, (iso) => iso).headline}.
      </p>
    )
  }
  if (claim.data) {
    return (
      <p className={cn('text-[12px] font-semibold text-ink', inline && 'basis-full text-[11px]')} role="status" data-card-result>
        {claimPlacedCopy(name, view.nextRunLocal)}
      </p>
    )
  }
  // A race: the server's own sentence, verbatim.
  const refusal = move.isError ? move.error : claim.isError ? claim.error : null
  const send = () => {
    const drop = dropId || null
    if (acq.kind === 'add') move.submit({ teamId, addPlayerId: playerId, dropPlayerId: drop })
    else if (acq.kind === 'claim') claim.submit({ teamId, addPlayerId: playerId, dropPlayerId: drop, ...(faab ? { faabBid: bid } : {}) })
  }
  const label = acquireLabel(acq.kind, name, acq.disabled ? acq.title : undefined)

  return (
    <div className={inline ? 'contents' : 'flex flex-col gap-1.5'}>
      <span className="flex flex-wrap items-center gap-2">
        <Button
          variant="green"
          size="icon-sm"
          aria-label={label}
          title={acq.disabled ? acq.title : label}
          disabled={acq.disabled || pending || choosing}
          onClick={() => {
            move.reset()
            claim.reset()
            setChoosing(true)
          }}
          data-card-action="acquire"
          data-acquire={acq.kind}
        >
          <Icon name="plus" size={13} />
        </Button>
        {acq.disabled && acq.title && !inline && <ClosedReason>{acq.title}</ClosedReason>}
      </span>
      {choosing && !acq.disabled && (
        <div className={inline ? 'basis-full pt-1.5' : 'contents'}>
        <AcquireStep
          kind={acq.kind}
          name={name}
          nextRunLocal={view.nextRunLocal}
          needsDrop={view.needsDrop}
          choices={choices}
          faab={faab}
          dropId={dropId}
          bid={bid}
          pending={pending}
          onDrop={setDropId}
          onBid={setBid}
          onConfirm={send}
          onCancel={() => {
            setChoosing(false)
            setDropId('')
            setBid(view.faab?.min ?? 0)
          }}
        />
        </div>
      )}
      {refusal && (
        <p role="alert" className="basis-full rounded-sm border border-negative bg-negative-soft px-2 py-1.5 text-[11px] font-medium text-ink" data-card-refusal>
          {refusal instanceof Error ? refusal.message : 'The move was refused.'}
        </p>
      )}
    </div>
  )
}

/** The card's one step (D481(n)): the plain-words line, the drop picker on a
 *  full roster, the bid stepper on a FAAB claim, then Add / Place claim and
 *  Cancel. Exported for the render tests. */
export function AcquireStep({
  kind,
  name,
  nextRunLocal,
  needsDrop,
  choices,
  faab,
  dropId,
  bid,
  pending,
  onDrop,
  onBid,
  onConfirm,
  onCancel,
}: {
  kind: 'add' | 'claim'
  name: string
  nextRunLocal: string | null
  needsDrop: boolean
  choices: readonly { player_id: string; position: string; full_name: string }[]
  faab: { min: number; max: number | null } | null
  dropId: string
  bid: number
  pending: boolean
  onDrop: (id: string) => void
  onBid: (fn: (b: number) => number) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const ready = !(needsDrop && dropId === '') && (faab === null || bidAllowed(bid, faab))
  const copy = acquireConfirmCopy(kind === 'add' ? { kind } : { kind, nextRunLocal, bid: faab ? bid : null }, name)
  return (
    <div className="flex flex-col gap-1.5" data-card-acquire-choice={kind === 'claim' && faab ? 'bid' : kind}>
      <p className="text-[12px] font-semibold text-ink" data-card-acquire-copy>
        {copy}
      </p>
      {needsDrop && (
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-n-3">
          {ROSTER_FULL_COPY}
          <select
            value={dropId}
            onChange={(e) => onDrop(e.target.value)}
            className="h-btn-md rounded-sm border border-ink bg-white px-2 text-[12px] font-medium text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            data-card-drop-pick
          >
            <option value="">Choose who to drop</option>
            {choices.map((p) => (
              <option key={p.player_id} value={p.player_id}>
                {p.position} · {p.full_name}
              </option>
            ))}
          </select>
        </label>
      )}
      {faab && (
        <span className="inline-flex items-center gap-1" data-card-bid>
          <Button variant="stroke" size="icon-sm" aria-label="Lower the bid" onClick={() => onBid((b) => stepBid(b, -1, faab))}>
            −
          </Button>
          <span className="fs-num min-w-[32px] text-center text-[12px] font-extrabold" data-card-bid-amount>
            ${bid}
          </span>
          <Button variant="stroke" size="icon-sm" aria-label="Raise the bid" onClick={() => onBid((b) => stepBid(b, 1, faab))}>
            +
          </Button>
        </span>
      )}
      {faab && faab.max !== null && (
        <p className="text-[10px] font-medium text-n-3">
          Bids from ${faab.min} to ${faab.max} (your FAAB left).
        </p>
      )}
      <span className="flex flex-wrap items-center gap-1.5">
        <Button variant="green" size="sm" disabled={!ready || pending} onClick={onConfirm} data-card-acquire-confirm>
          {pending ? 'Sending…' : acquireConfirmVerb(kind)}
        </Button>
        <Button variant="stroke" size="sm" disabled={pending} onClick={onCancel} data-card-acquire-cancel>
          Cancel
        </Button>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Global context — "Available in N leagues"
// ---------------------------------------------------------------------------

/** One of the viewer's leagues in the global card's expander: avatar, name,
 *  where he is there, and the door into that league's card (where the move
 *  itself lives, with its checks). Reads the league's rosters + pool over
 *  the existing routes — no new read. */
export function LeagueAvailabilityRow({
  player,
  league,
  first,
  onOpen,
}: {
  player: PoolPlayer
  league: MyLeagueRow
  first: boolean
  /** Where the row's door goes. The card re-opens itself in that league;
   *  the full player page navigates to its league variant. */
  onOpen?: (leagueId: string) => void
}) {
  const rosters = useRosters(league.id)
  const pool = useLeaguePool(league.id)
  const setContext = usePlayerWindowsStore((s) => s.setContext)
  const openInLeague = () => (onOpen ? onOpen(league.id) : setContext(player.id, leagueCardContext(league.id)))
  const status = useMemo(() => {
    if (!rosters.data || !pool.data) return null
    const [row] = poolRows([player], rosters.data, pool.data, league.my_team_id, 'all')
    const a = row.availability
    const kind = a.kind === 'rostered' ? (a.mine ? 'mine' : 'theirs') : 'available'
    return { text: leagueRowStatus(row), kind }
  }, [rosters.data, pool.data, player, league])

  const label = status?.kind === 'mine' ? 'Drop' : status?.kind === 'theirs' ? 'Trade' : status?.kind === 'available' ? 'Add' : null
  return (
    <div className={cn('flex items-center gap-2 py-1.5', !first && 'border-t border-n-4')} data-card-league-row={league.id}>
      <Crest name={league.name} src={league.avatar_url} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-extrabold leading-tight">{league.name}</span>
        <span
          className={cn('mt-0.5 block text-[11px] font-semibold leading-tight', status?.kind === 'available' ? 'text-brand-strong' : 'text-n-3')}
          data-card-league-status
        >
          {rosters.isError || pool.isError ? 'Couldn’t read this league.' : (status?.text ?? 'Checking…')}
        </span>
      </span>
      {label === 'Add' ? (
        // D481: the one "+" — it opens him in that league, where the + runs
        // the add or the claim the league's rules allow.
        <Button
          variant="green"
          size="icon-sm"
          onClick={openInLeague}
          data-card-league-open={league.id}
          aria-label={`Pick up ${player.full_name} in ${league.name}`}
          title={`Pick up ${player.full_name} in ${league.name}`}
        >
          <Icon name="plus" size={13} />
        </Button>
      ) : label && (
        <Button
          variant="stroke"
          size="sm"
          onClick={openInLeague}
          data-card-league-open={league.id}
          title={`Open him in ${league.name}`}
        >
          {label}
        </Button>
      )}
    </div>
  )
}

export function GlobalLeaguesExpander({ player }: { player: PoolPlayer }) {
  const [open, setOpen] = useState(false)
  const { data: leagues, isPending } = useLeagues()
  const count = leagues?.length ?? 0
  if (isPending) return <span className="py-1 text-[12px] font-semibold text-n-3">Checking your leagues…</span>
  if (count === 0) return <span className="py-1 text-[12px] font-medium text-n-3">Join a league to track availability</span>
  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 self-start py-1 text-[12px] font-extrabold text-accent-strong transition-colors hover:text-accent"
        data-card-leagues-toggle
      >
        Available in {count} {count === 1 ? 'league' : 'leagues'}
        <Icon name="arrow-next" size={13} className={cn('transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="pb-1">
          {leagues!.map((lg, i) => (
            <LeagueAvailabilityRow key={lg.id} player={player} league={lg} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Draft context — Queue
// ---------------------------------------------------------------------------

export function DraftCardActions({ playerId, context }: { playerId: string; context: Extract<PlayerCardContext, { kind: 'draft' }> }) {
  const queue = useDraftQueue(context.draftId, context.teamId ?? undefined)
  const update = useUpdateDraftQueue(context.leagueId, context.draftId, context.teamId ?? '')
  if (!context.teamId) return null
  // R1463 — the queue route REPLACES the whole list, so an unread queue must
  // never be treated as an empty one (that would wipe every Target). Until
  // the read succeeds, Queue stays off; a failed read shows why + a retry.
  if (queue.isError || !queue.data) {
    return (
      <span className="flex items-center gap-2" data-card-queue-state={queue.isError ? 'error' : 'loading'}>
        <Button variant="blue" size="sm" disabled data-card-action="queue">
          Queue
        </Button>
        {queue.isError ? (
          <>
            <span className="text-[11px] font-medium text-ink">Couldn’t load your Targets.</span>
            <Button variant="stroke" size="sm" onClick={() => void queue.refetch()} data-card-action="queue-retry">
              Retry
            </Button>
          </>
        ) : (
          <span className="text-[11px] font-medium text-n-3">Loading your Targets…</span>
        )}
      </span>
    )
  }
  const queued = queue.data.some((r) => r.player_id === playerId)
  // R1464 — build the replacement from a FRESH read, not the card's cache,
  // so a Targets-panel edit made while the card was open is not overwritten.
  const onQueue = async () => {
    const fresh = await queue.refetch()
    if (fresh.isError || !fresh.data) return
    const ids = fresh.data.map((r) => r.player_id).filter((id) => id !== playerId)
    update.mutate([...ids, playerId])
  }
  return (
    <span className="flex items-center gap-2">
      <Button
        variant={queued ? 'stroke' : 'blue'}
        size="sm"
        disabled={queued || update.isPending || queue.isFetching}
        onClick={() => void onQueue()}
        data-card-action="queue"
      >
        {queued ? 'In your Targets' : 'Queue'}
      </Button>
      {update.isError && <span className="text-[11px] font-medium text-ink">{update.error instanceof Error ? update.error.message : 'Couldn’t queue him.'}</span>}
    </span>
  )
}
