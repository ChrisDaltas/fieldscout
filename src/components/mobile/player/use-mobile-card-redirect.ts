'use client'

import { useEffect } from 'react'

import type { PlayerListContext } from '@/components/players/player-detail-actions'
import { useProfileUiStore, type ProfileDraftContext } from '@/components/mobile/player/profile-ui-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { usePlayerWindowsStore, type PlayerWindowState } from '@/stores/player-windows-store'

/** What the profile opens with in place of a mini card: its league (a
 *  league or draft context), its list context and, from a draft room with a
 *  seat, that seat — so the profile keeps the draft card's Queue. */
export function profileOpenFor(card: PlayerWindowState): {
  playerId: string
  leagueId: string | null
  listContext: PlayerListContext | null
  draft: ProfileDraftContext | null
} {
  const ctx = card.context
  return {
    playerId: card.playerId,
    leagueId: ctx.kind === 'league' ? ctx.leagueId : ctx.kind === 'draft' ? ctx.leagueId : null,
    listContext: card.listContext,
    draft:
      ctx.kind === 'draft' && ctx.teamId
        ? { playerId: card.playerId, draftId: ctx.draftId, teamId: ctx.teamId, leagueId: ctx.leagueId }
        : null,
  }
}

/**
 * The mobile layout has no floating mini card (handoff m-pprofile §4: every
 * player tap opens the full profile). Whatever opens a mini card through the
 * windows store — `openPlayer`, a surface calling `open` directly — is
 * turned into the full profile here instead (`profileOpenFor`). Desktop is
 * untouched.
 */
export function useMobileCardRedirect(mobile: boolean, windows: readonly PlayerWindowState[]) {
  useEffect(() => {
    if (!mobile || windows.length === 0) return
    const open = profileOpenFor(windows[windows.length - 1]!)
    useProfileUiStore.getState().setDraft(open.draft)
    usePlayerWindowsStore.getState().closeAll()
    usePlayerModalStore.getState().openPlayerView(open.playerId, open.leagueId, open.listContext)
  }, [mobile, windows])
}
