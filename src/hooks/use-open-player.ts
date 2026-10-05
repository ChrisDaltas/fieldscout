'use client'

import type { PlayerListContext } from '@/components/players/player-detail-actions'
import { GLOBAL_CARD_CONTEXT, type PlayerCardContext } from '@/components/players/player-card-context'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

/**
 * Open a player from any click (Chris 2026-10-05, D494 — supersedes the
 * D488/D491 routing): the floating MINI CARD first, always, carrying the
 * league the click sat in. No context = the surface's ambient one (league
 * shell → that league; draft room → its seat and Queue), else global. The
 * card's Expand / More → "Open player view" then opens the full modal with
 * the same league and list context. Only the shared deep link
 * (`/app?player=`) opens the modal directly.
 *
 * `listContext`: opened from a list the viewer owns, the card (and the modal
 * it expands to) offers "Remove from list". Callers pass it only for an owned
 * list. The draft room ignores it — its card is unchanged.
 */
export function openPlayer(
  playerId: string,
  context?: PlayerCardContext,
  listContext?: PlayerListContext | null,
): void {
  const windows = usePlayerWindowsStore.getState()
  const ctx = context ?? windows.ambient ?? GLOBAL_CARD_CONTEXT
  if (ctx.kind === 'draft') {
    windows.open(playerId, context ? { context } : undefined)
    return
  }
  windows.open(playerId, { context: ctx, listContext: listContext ?? null })
}

export function useOpenPlayer(): typeof openPlayer {
  return openPlayer
}
