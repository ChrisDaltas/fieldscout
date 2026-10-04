'use client'

import { GLOBAL_CARD_CONTEXT, type PlayerCardContext } from '@/components/players/player-card-context'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

/**
 * Open a player from a link (Chris 2026-10-04, "Player links open the
 * modal"): the player view modal, carrying the league the link sat in. No
 * context = the surface's ambient one (league shell → that league; draft
 * room → its seat), else global. The draft room keeps the floating card —
 * its Queue button is the seat's action and the modal has none.
 */
export function openPlayer(playerId: string, context?: PlayerCardContext): void {
  const ctx = context ?? usePlayerWindowsStore.getState().ambient ?? GLOBAL_CARD_CONTEXT
  if (ctx.kind === 'draft') {
    usePlayerWindowsStore.getState().open(playerId, context ? { context } : undefined)
    return
  }
  usePlayerModalStore.getState().openPlayerView(playerId, ctx.kind === 'league' ? ctx.leagueId : null)
}

export function useOpenPlayer(): typeof openPlayer {
  return openPlayer
}
