'use client'

import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { dropConfirmCopy } from '@/components/players/player-card-league-ops'
import { moveReadout } from '@/components/leagues/players-page-ops'
import { useAddDrop } from '@/hooks/use-transactions'
import { toast } from '@/hooks/use-toast'

/**
 * "Drop <player>?" on mobile — the desktop team page's lone-drop
 * confirmation (`DropPlayerDialog` / `DropConfirm`) in the mobile sheet: the
 * same verb (`useAddDrop` with a drop and no add), never optimistic, the
 * server's refusal verbatim. While the drop is in flight the sheet can't be
 * dismissed (backdrop, Escape and Keep him all wait — the desktop
 * confirm's rule). The roster re-reads on the answer (the hook's
 * invalidations).
 */
export function DropSheet({
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
  const move = useAddDrop(leagueId)
  const close = () => {
    if (move.isPending) return
    move.reset()
    onClose()
  }
  return (
    <MobileSheet
      open={player !== null}
      onOpenChange={(open) => !open && close()}
      title={`Drop ${player?.full_name ?? 'this player'}?`}
      subtitle="A roster move — the league sees it in Activity."
    >
      {player && (
        <DropBody
          key={player.player_id}
          teamId={teamId}
          player={player}
          move={move}
          onCancel={close}
          onDone={() => {
            move.reset()
            onClose()
          }}
        />
      )}
    </MobileSheet>
  )
}

function DropBody({
  teamId,
  player,
  move,
  onCancel,
  onDone,
}: {
  teamId: string
  player: { player_id: string; full_name: string }
  move: ReturnType<typeof useAddDrop>
  onCancel: () => void
  onDone: () => void
}) {
  const refusal = move.isError ? (move.error instanceof Error ? move.error.message : 'The drop was refused.') : null
  return (
    <div className="flex flex-col gap-3 px-5 pb-2" data-drop-sheet={player.player_id}>
      <p className="text-[14px] font-medium text-m-t2">{dropConfirmCopy(player.full_name)}</p>
      {refusal && (
        <p role="alert" className="rounded-[12px] bg-m-gr px-3 py-2 text-[13px] font-medium text-m-tr">
          {refusal}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={move.isPending} className="h-12 rounded-pill bg-m-b2 text-[15px] font-semibold text-m-t1 disabled:opacity-50">
          Keep him
        </button>
        <button
          type="button"
          disabled={move.isPending}
          onClick={() =>
            move
              .submitAsync({ teamId, dropPlayerId: player.player_id })
              .then((result) => {
                toast({ title: `${moveReadout(result, (iso) => iso).headline}` })
                onDone()
              })
              .catch(() => {})
          }
          className="h-12 rounded-pill bg-m-gr text-[15px] font-semibold text-m-tr disabled:opacity-50"
          data-drop-confirm
        >
          {move.isPending ? 'Dropping…' : 'Drop'}
        </button>
      </div>
    </div>
  )
}
