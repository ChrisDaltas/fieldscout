'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import type { PlayerListContext } from '@/components/players/player-detail-actions'
import { useProfileUiStore, type ProfileResume } from '@/components/mobile/player/profile-ui-store'
import { getNflTeam } from '@/lib/nfl-teams'
import { usePlayerModalStore, type PlayerModalTarget } from '@/stores/player-modal-store'

/**
 * The player profile's door to his NFL team page (audit frame-2: desktop's
 * player header links its team to `/app/nfl/[team]`; the phone profile had
 * no way there). The team in the header opens the phone's team page, and
 * Back from it returns to the player — "Back always goes to where you came
 * from" (Chris, 2026-10-15, gap list #27).
 *
 * The profile is an overlay over a page that is never navigated, and any
 * link that leaves the page closes it. So the door leaves a mark on the
 * history entry it leaves (`history.state`, beside Next's own keys), and the
 * profile as it was — tab, stack, draft seat — in memory under the same id.
 * When Back (on-screen or the OS gesture) lands on that entry again, the
 * profile reopens just as it was left. The mark lives on that one entry, so
 * reaching the same page another way (the dock) opens nothing; after a
 * reload the memory is gone and the mark alone reopens the player.
 */

export const PROFILE_RESUME_KEY = 'fsProfileResume'

/** What the history entry carries: enough to reopen the player on its own. */
export interface ProfileResumeMark {
  id: string
  /** The page it was left on (a guard: the mark belongs to this entry). */
  path: string
  playerId: string
  leagueId: string | null
}

export interface TeamDoor {
  href: string
  /** "Kansas City Chiefs". */
  name: string
  /** The profile already sits over this team's page: the door just closes
   *  it, rather than stacking a second copy of the page. */
  here: boolean
}

/**
 * The team door for a profile, or null when there is none: a free agent, a
 * team the app's table doesn't know (its page would be a 404), or a profile
 * opened from a list editor holding a draft — leaving that page would throw
 * away the unsaved list changes.
 */
export function nflTeamDoor(
  team: string | null | undefined,
  pathname: string,
  listContext: PlayerListContext | null,
): TeamDoor | null {
  const info = getNflTeam(team)
  if (!info || listContext?.removeFromDraft) return null
  const href = `/app/nfl/${info.abbr}`
  return { href, name: `${info.city} ${info.name}`, here: pathname.toUpperCase() === href.toUpperCase() }
}

/** A tap the app routes itself (not a modified click into a new tab). */
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The mark on a history entry's state, if it carries a well-formed one. */
export function resumeMarkOf(state: unknown): ProfileResumeMark | null {
  if (!isObj(state)) return null
  const m = state[PROFILE_RESUME_KEY]
  if (!isObj(m)) return null
  if (typeof m.id !== 'string' || typeof m.path !== 'string' || typeof m.playerId !== 'string') return null
  if (m.leagueId !== null && typeof m.leagueId !== 'string') return null
  return { id: m.id, path: m.path, playerId: m.playerId, leagueId: m.leagueId }
}

/** The entry's state with the mark added (Next's own keys kept). */
export function withResumeMark(state: unknown, mark: ProfileResumeMark): Record<string, unknown> {
  return { ...(isObj(state) ? state : {}), [PROFILE_RESUME_KEY]: mark }
}

/** The entry's state with the mark taken off (Next's own keys kept). */
export function withoutResumeMark(state: unknown): Record<string, unknown> {
  const next = { ...(isObj(state) ? state : {}) }
  delete next[PROFILE_RESUME_KEY]
  return next
}

/** How the profile reopens: as it was left when memory still has it, else
 *  the player alone (from the mark, after a reload). */
export function reopenFrom(
  mark: ProfileResumeMark,
  kept: ProfileResume | null,
): Pick<ProfileResume, 'target' | 'trail' | 'draft'> & { restore: { playerId: string; tab: string } | null } {
  if (kept && kept.id === mark.id && kept.target.playerId === mark.playerId) {
    return { target: kept.target, trail: kept.trail, draft: kept.draft, restore: { playerId: kept.target.playerId, tab: kept.tab } }
  }
  return { target: { playerId: mark.playerId, leagueId: mark.leagueId, listContext: null }, trail: [], draft: null, restore: null }
}

type HistoryLike = Pick<History, 'state' | 'replaceState'>

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`

/**
 * Just before the door leaves: remember the profile (memory) and mark the
 * entry being left (history). The URL is untouched, so nothing re-renders.
 */
export function markProfileResume(history: HistoryLike, pathname: string, target: PlayerModalTarget, tab: string): ProfileResumeMark {
  const ui = useProfileUiStore.getState()
  const mark: ProfileResumeMark = { id: newId(), path: pathname, playerId: target.playerId, leagueId: target.leagueId }
  ui.setResume({ id: mark.id, target, tab, trail: ui.trail, draft: ui.draft })
  history.replaceState(withResumeMark(history.state, mark), '')
  return mark
}

/**
 * On arriving at an entry: if it carries a mark for this page, take it off
 * (it reopens once) and open the profile as it was left. Returns whether it
 * reopened one.
 */
export function resumeOnArrival(history: HistoryLike, pathname: string): boolean {
  const mark = resumeMarkOf(history.state)
  if (!mark || mark.path !== pathname) return false
  history.replaceState(withoutResumeMark(history.state), '')
  const ui = useProfileUiStore.getState()
  const open = reopenFrom(mark, ui.resume)
  useProfileUiStore.setState({ resume: null, trail: open.trail, draft: open.draft, restore: open.restore })
  usePlayerModalStore.getState().openPlayerView(open.target.playerId, open.target.leagueId, open.target.listContext)
  return true
}

/** Mounted with the phone profile: reopens a profile left for its team page
 *  when Back lands on the page it was left on. */
export function useProfileResume(): void {
  const pathname = usePathname()
  useEffect(() => {
    resumeOnArrival(window.history, window.location.pathname)
  }, [pathname])
}
