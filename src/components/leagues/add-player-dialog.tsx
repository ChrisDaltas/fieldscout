'use client'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { LeagueCardActions } from '@/components/players/player-card-actions'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * F570 — a free agent dragged from the rail onto My Team's bench: the card's
 * own add flow (`LeagueCardActions`) with its one confirm step already open —
 * the same confirm, FAAB bid and drop picker as the +. Nothing is sent until
 * its button is pressed. A dialog is a true overlay, so it keeps the
 * primitive's resting shadow (CLAUDE.md).
 */
export function AddPlayerDialog({
  leagueId,
  player,
  onClose,
}: {
  leagueId: string
  /** null = closed. */
  player: PoolPlayer | null
  onClose: () => void
}) {
  return (
    <Dialog open={player !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" data-add-dialog={player?.id ?? ''}>
        <DialogHeader>
          <DialogTitle>Add {player?.full_name ?? 'this player'}?</DialogTitle>
          <DialogDescription>A roster move — the league sees it in Activity.</DialogDescription>
        </DialogHeader>
        {player && <LeagueCardActions key={player.id} player={player} leagueId={leagueId} confirmOpen />}
      </DialogContent>
    </Dialog>
  )
}
