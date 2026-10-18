'use client'

import { useMemo, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { lockBadgeFor } from '@/components/leagues/lineup-editor-ops'
import { moveReadout } from '@/components/leagues/players-page-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MPosChip } from '@/components/mobile/ui/m-pos-chip'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useCardLeagueView } from '@/components/players/player-card-actions'
import {
  acquireConfirmCopy,
  acquireConfirmVerb,
  bidAllowed,
  claimPlacedCopy,
  dropConfirmCopy,
  droppable,
  ROSTER_FULL_COPY,
  stepBid,
  type CardLeagueView,
} from '@/components/players/player-card-league-ops'
import { useLeague } from '@/hooks/use-league'
import { useSubmitClaim } from '@/hooks/use-submit-claim'
import { toast } from '@/hooks/use-toast'
import { useAddDrop } from '@/hooks/use-transactions'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { cn } from '@/lib/utils'

export type MoveSheetKind = 'acquire' | 'drop'

/**
 * The mobile profile's roster move, as a bottom sheet: the player card's own
 * flow (`LeagueCardActions` / `PickupActions` / `DropConfirm`) in the mobile
 * design language — the same reads (`useCardLeagueView`), the same gates,
 * the same verbs (`useAddDrop`, `useSubmitClaim`), the same one-step confirm
 * (D481(n): every press opens this step first; only its button sends), the
 * drop picker on a full roster and the FAAB bid stepper. The server's answer
 * is shown as sent: the readout as a toast, a refusal verbatim in the sheet.
 */
export function PlayerMoveSheet({
  open,
  onOpenChange,
  kind,
  leagueId,
  player,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: MoveSheetKind
  leagueId: string
  player: PoolPlayer
}) {
  const card = useCardLeagueView(player, leagueId)
  const league = useLeague(leagueId)
  const view = card.state === 'ready' ? card.view : null
  const title =
    kind === 'drop'
      ? `Drop ${player.full_name}?`
      : view?.kind === 'available' && view.acquire.kind === 'claim'
        ? `Claim ${player.full_name}`
        : `Add ${player.full_name}`
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title={title} subtitle={league.data?.league.name}>
      {card.state === 'loading' ? (
        <div className="flex flex-col gap-2 px-5 pb-2">
          <div className="h-5 w-3/4 animate-pulse rounded-[8px] bg-m-b1" />
          <div className="h-[46px] animate-pulse rounded-pill bg-m-b1" />
        </div>
      ) : card.state === 'error' || !view ? (
        <p className="px-5 pb-3 text-[14px] font-medium text-m-t3">Couldn’t read this league right now.</p>
      ) : kind === 'drop' ? (
        view.kind === 'mine' && card.myTeamId && view.drop.open ? (
          <DropStep leagueId={leagueId} teamId={card.myTeamId} player={player} onDone={() => onOpenChange(false)} />
        ) : (
          <Closed reason={view.kind === 'mine' && !view.drop.open ? view.drop.reason : 'He isn’t on your roster in this league.'} onClose={() => onOpenChange(false)} />
        )
      ) : view.kind === 'available' && card.myTeamId && !view.acquire.disabled ? (
        <AcquireStep view={view} leagueId={leagueId} teamId={card.myTeamId} onDone={() => onOpenChange(false)} />
      ) : (
        <Closed
          reason={view.kind === 'available' && view.acquire.disabled ? (view.acquire.title ?? 'You can’t pick him up right now.') : view.where}
          onClose={() => onOpenChange(false)}
        />
      )}
    </MobileSheet>
  )
}

function Closed({ reason, onClose }: { reason: string; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-4 px-5 pb-1">
      <p className="text-[14px] font-medium leading-[1.45] text-m-t2">{reason}</p>
      <SheetButton tone="neutral" onClick={onClose}>
        Close
      </SheetButton>
    </div>
  )
}

/** The sheet's full-width pill — shared by the claim sheets (My moves). */
export function SheetButton({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: 'neutral' | 'add' | 'claim' | 'drop'
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-[46px] flex-1 items-center justify-center rounded-pill text-[15px] font-semibold disabled:opacity-40',
        tone === 'neutral' && 'bg-m-b2 text-m-t1 active:bg-m-b2h',
        tone === 'add' && 'bg-confirm text-white',
        tone === 'claim' && 'bg-m-gold text-white',
        tone === 'drop' && 'bg-negative-strong text-white',
      )}
    >
      {children}
    </button>
  )
}

/** A refusal, verbatim — the verb names the rule it applied. */
export function Refusal({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-[12px] bg-m-gr px-3 py-2 text-[13px] font-medium leading-[1.4] text-m-tr">
      {error instanceof Error ? error.message : 'The move was refused.'}
    </p>
  )
}

function DropStep({ leagueId, teamId, player, onDone }: { leagueId: string; teamId: string; player: PoolPlayer; onDone: () => void }) {
  const move = useAddDrop(leagueId)
  return (
    <div className="flex flex-col gap-4 px-5 pb-1" data-move-sheet="drop">
      <p className="text-[14px] font-medium leading-[1.45] text-m-t2">{dropConfirmCopy(player.full_name)}</p>
      {move.isError && <Refusal error={move.error} />}
      <div className="flex gap-2">
        <SheetButton tone="neutral" disabled={move.isPending} onClick={onDone}>
          Keep him
        </SheetButton>
        <SheetButton
          tone="drop"
          disabled={move.isPending}
          onClick={() =>
            move
              .submitAsync({ teamId, dropPlayerId: player.id })
              .then((result) => {
                toast({ title: `${moveReadout(result, (iso) => iso).headline}.` })
                onDone()
              })
              .catch(() => {
                // The refusal renders from `move.error` above — verbatim.
              })
          }
        >
          {move.isPending ? 'Dropping…' : 'Drop'}
        </SheetButton>
      </div>
    </div>
  )
}

type AvailableView = Extract<CardLeagueView, { kind: 'available' }>

function AcquireStep({ view, leagueId, teamId, onDone }: { view: AvailableView; leagueId: string; teamId: string; onDone: () => void }) {
  const move = useAddDrop(leagueId)
  const claim = useSubmitClaim(leagueId)
  const [dropId, setDropId] = useState<string | null>(null)
  const [bid, setBid] = useState<number>(view.faab?.min ?? 0)
  const choices = useMemo(() => droppable(view.myRoster, (p) => lockBadgeFor(p.game_lock, true).locked), [view.myRoster])
  const acq = view.acquire
  const kind = acq.kind === 'claim' ? 'claim' : 'add'
  const name = view.row.player.full_name
  const faab = kind === 'claim' && view.faab ? view.faab : null
  const pending = move.isPending || claim.isPending
  const ready = !(view.needsDrop && dropId === null) && (faab === null || bidAllowed(bid, faab))
  const refusal = move.isError ? move.error : claim.isError ? claim.error : null

  const send = () => {
    const drop = dropId
    if (kind === 'add') {
      move
        .submitAsync({ teamId, addPlayerId: view.row.player.id, dropPlayerId: drop })
        .then((result) => {
          toast({ title: `${moveReadout(result, (iso) => iso).headline}.` })
          onDone()
        })
        .catch(() => {
          // The refusal renders from `move.error` below — verbatim.
        })
    } else {
      claim
        .submitAsync({ teamId, addPlayerId: view.row.player.id, dropPlayerId: drop, ...(faab ? { faabBid: bid } : {}) })
        .then(() => {
          toast({ title: claimPlacedCopy(name, view.nextRunLocal) })
          onDone()
        })
        .catch(() => {
          // The refusal renders from `claim.error` below — verbatim.
        })
    }
  }

  return (
    <div className="flex flex-col gap-4 px-5 pb-1" data-move-sheet={kind}>
      <p className="text-[14px] font-medium leading-[1.45] text-m-t2">
        {acquireConfirmCopy(kind === 'add' ? { kind } : { kind, nextRunLocal: view.nextRunLocal, bid: faab ? bid : null }, name)}
      </p>
      {view.needsDrop && <DropPicker title={ROSTER_FULL_COPY} choices={choices} value={dropId} onChange={setDropId} />}
      {faab && <BidStepper bid={bid} bounds={faab} onChange={setBid} />}
      {refusal && <Refusal error={refusal} />}
      {/* Pinned to the sheet's bottom edge: on a full roster the drop picker
          lists every droppable player, and the confirm must stay in reach. */}
      <div className="sticky bottom-0 -mx-5 flex gap-2 bg-m-b0 px-5 pb-1 pt-2">
        <SheetButton tone="neutral" disabled={pending} onClick={onDone}>
          Cancel
        </SheetButton>
        <SheetButton tone={kind === 'claim' ? 'claim' : 'add'} disabled={!ready || pending} onClick={send}>
          {pending ? 'Sending…' : acquireConfirmVerb(kind)}
        </SheetButton>
      </div>
    </div>
  )
}

/**
 * The drop picker: one radio row per player who may be dropped (position
 * chip, name, NFL team, a check on the chosen one). Tapping the chosen row
 * again un-picks it. `allowNone` puts a "No drop" row first — the choice
 * when nothing is picked; without it, nothing picked means "choose one".
 */
export function DropPicker({
  title,
  note,
  choices,
  value,
  onChange,
  allowNone = false,
}: {
  title: string
  note?: string
  choices: readonly Pick<RosterPlayer, 'player_id' | 'full_name' | 'position' | 'nfl_team'>[]
  value: string | null
  onChange: (playerId: string | null) => void
  allowNone?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Player to drop" data-drop-picker>
      <p className="text-[13px] font-semibold text-m-t1">{title}</p>
      {note && <p className="-mt-1 text-[12px] font-medium text-m-t3">{note}</p>}
      {allowNone && <DropChoice on={value === null} onClick={() => onChange(null)} label="No drop" />}
      {choices.map((p) => {
        const on = value === p.player_id
        return (
          <DropChoice
            key={p.player_id}
            on={on}
            onClick={() => onChange(on ? null : p.player_id)}
            label={p.full_name}
            pos={p.position}
            team={p.nfl_team}
            id={p.player_id}
          />
        )
      })}
    </div>
  )
}

function DropChoice({ on, onClick, label, pos, team, id }: { on: boolean; onClick: () => void; label: string; pos?: string; team?: string | null; id?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn('flex min-h-[48px] items-center gap-2.5 rounded-[14px] px-3 text-left active:bg-m-b2', on && 'bg-m-b1')}
      data-drop-choice={id ?? 'none'}
    >
      {pos && <MPosChip pos={pos} />}
      <span className={cn('min-w-0 flex-1 truncate text-[15px] font-semibold', !pos && 'text-m-t2')}>{label}</span>
      {team && <span className="text-[12px] font-medium text-m-t3">{team}</span>}
      <span className="flex size-[18px] flex-none items-center justify-center text-accent">{on && <MIcon name="check" size={18} stroke={2.2} />}</span>
    </button>
  )
}

/** The FAAB bid stepper: − / the bid / +, held inside the bounds
 *  (`stepBid`), with the range under it when the balance is known. */
export function BidStepper({ bid, bounds, onChange }: { bid: number; bounds: { min: number; max: number | null }; onChange: (bid: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5" data-move-bid>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-m-t1">Your bid</span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Lower the bid"
            disabled={bid <= bounds.min}
            onClick={() => onChange(stepBid(bid, -1, bounds))}
            className="flex size-9 items-center justify-center rounded-full bg-m-b2 text-m-t1 active:bg-m-b2h disabled:opacity-30"
          >
            <MIcon name="drop" size={14} stroke={2.2} />
          </button>
          <span className="min-w-[48px] text-center text-[22px] font-bold tabular-nums tracking-[-0.02em]">${bid}</span>
          <button
            type="button"
            aria-label="Raise the bid"
            disabled={bounds.max !== null && bid >= bounds.max}
            onClick={() => onChange(stepBid(bid, 1, bounds))}
            className="flex size-9 items-center justify-center rounded-full bg-m-b2 text-m-t1 active:bg-m-b2h disabled:opacity-30"
          >
            <MIcon name="add" size={14} stroke={2.2} />
          </button>
        </span>
      </div>
      {bounds.max !== null && (
        <p className="text-[12px] font-medium text-m-t3">
          Bids from ${bounds.min} to ${bounds.max} (your FAAB left).
        </p>
      )}
    </div>
  )
}
