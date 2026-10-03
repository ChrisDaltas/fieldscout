'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { dropConfirmCopy } from '@/components/players/player-card-league-ops'
import { useAddDrop } from '@/hooks/use-transactions'

import { moveReadout } from './players-page-ops'

/**
 * "Drop <player>?" — the one confirmation for a lone drop (League UX batch
 * 2). The verb is `useAddDrop` with a drop and no add (113 accepts either
 * side alone); the answer renders as the server sent it — the readout on
 * success, the refusal verbatim. Never optimistic: the roster re-reads on
 * the answer (the hook invalidates rosters, pool and feed).
 *
 * `DropConfirm` is the body. The player card renders it INLINE (a dialog
 * would open beneath the floating card, which sits above the dialog layer);
 * the team page wraps it in `DropPlayerDialog`.
 */
/** Who a drop names — the roster row's id and name. */
export type DropTarget = { player_id: string; full_name: string }

export function DropConfirm({
  leagueId,
  teamId,
  player,
  onClose,
}: {
  leagueId: string
  teamId: string
  player: { player_id: string; full_name: string }
  onClose: () => void
}) {
  const move = useAddDrop(leagueId)
  const close = () => {
    if (move.isPending) return
    move.reset()
    onClose()
  }
  const refusal = move.isError ? (move.error instanceof Error ? move.error.message : 'The drop was refused.') : null
  const done = move.data ? moveReadout(move.data, (iso) => iso) : null

  return (
    <div className="flex flex-col gap-2" data-drop-confirm-for={player.player_id}>
      <p className="text-[12px] font-semibold text-ink" data-drop-copy>
        {done ? `${done.headline}.` : dropConfirmCopy(player.full_name)}
      </p>
      {refusal && (
        <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-2 py-1.5 text-[11px] font-medium text-ink" data-drop-refusal>
          {refusal}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-1.5">
        {done ? (
          <Button variant="stroke" size="sm" onClick={close} data-drop-done>
            Done
          </Button>
        ) : (
          <>
            <Button variant="stroke" size="sm" onClick={close} disabled={move.isPending}>
              Keep him
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={move.isPending}
              onClick={() => move.submit({ teamId, dropPlayerId: player.player_id })}
              data-drop-confirm
            >
              {move.isPending ? 'Dropping…' : `Drop ${player.full_name}`}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/** The team page's confirmation. A dialog is a true overlay, so it keeps the
 *  primitive's resting shadow (CLAUDE.md). */
export function DropPlayerDialog({
  leagueId,
  teamId,
  player,
  onClose,
}: {
  leagueId: string
  teamId: string
  /** null = closed. */
  player: { player_id: string; full_name: string } | null
  onClose: () => void
}) {
  return (
    <Dialog open={player !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" data-drop-dialog={player?.player_id ?? ''}>
        <DialogHeader>
          <DialogTitle>Drop {player?.full_name ?? 'this player'}?</DialogTitle>
          <DialogDescription>A roster move — the league sees it in Activity.</DialogDescription>
        </DialogHeader>
        {player && <DropConfirm key={player.player_id} leagueId={leagueId} teamId={teamId} player={player} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}
