'use client'

import { PlayerView } from '@/components/players/player-detail-page-view'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { featureFlags } from '@/lib/feature-flags'
import { usePlayerModalStore } from '@/stores/player-modal-store'

/**
 * The player view as a modal (D486(13)) — the app's own `ui/dialog`, no new
 * primitive. Centered ~800px with inner scroll on desktop, a full-screen
 * sheet on a phone. ×, Esc or a click outside closes it; the page under it
 * is never navigated, so its scroll and state survive. Mounted once at the
 * root (beside the mini cards) so any surface can open it via the store.
 */
export function PlayerViewModal() {
  const target = usePlayerModalStore((s) => s.target)
  const close = usePlayerModalStore((s) => s.closePlayerView)
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
      {target && (
        // Elevation exception: the dialog is a true overlay — DialogContent
        // keeps its resting shadow (CLAUDE.md → "Elevation").
        <DialogContent
          className="flex h-[100dvh] max-h-[100dvh] max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[90vh] sm:w-[calc(100vw-32px)] sm:max-w-[800px]"
          data-player-modal={target.playerId}
        >
          <DialogTitle className="sr-only">Player</DialogTitle>
          <DialogDescription className="sr-only">Player details, this week&apos;s matchup and the season.</DialogDescription>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PlayerView playerId={target.playerId} leagueId={featureFlags.leagues ? target.leagueId : null} variant="modal" />
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
