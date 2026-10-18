import { create } from 'zustand'

import { leagueIdOfThread } from '@/components/mobile/messages/messages-ops'
import type { LayoutMode } from '@/hooks/use-layout-mode'

/**
 * WHO'S ONLINE — gap list §3 #25 ("who's online everywhere, not just in the
 * draft room").
 *
 * The user ids your CURRENT league's room reports present (Supabase Realtime
 * Presence on `league:<id>` — 070's members-only policies), written by the
 * session's `PresenceHost` and read by any avatar through `useIsOnline` /
 * `useTeamOnline`. A dot reads this store; it never opens a channel.
 *
 * One league at a time (spec §9.3: "≤ 3 channels (current league, current
 * draft, notifications)") — `presenceLeagueId` below picks it. Kept per
 * league so the league you move off (or whose channel drops) takes its
 * people with it. You are never in it: the host leaves your own id out, so
 * your own avatar never shows a dot.
 *
 * In memory only, never persisted: presence is a live fact, and a stored one
 * would be a stale claim.
 */
interface PresenceStore {
  /** League id → the user ids present there (not you), sorted. */
  byLeague: Record<string, readonly string[]>
  setLeague: (leagueId: string, userIds: Iterable<string>) => void
  clearLeague: (leagueId: string) => void
  /** The league whose pages you were last on this session — where a phone
   *  keeps counting you as here once you step off them (Messages, Home…).
   *  Not `mobile-nav-store`'s `lastLeagueId`: that one clears on an account
   *  tab by design (it decides the tab bar), and presence must not hop to
   *  another league because you opened Lists. */
  recentLeagueId: string | null
  setRecentLeague: (leagueId: string) => void
}

function sameIds(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((id, i) => id === b[i])
}

export const usePresenceStore = create<PresenceStore>()((set) => ({
  byLeague: {},
  setLeague: (leagueId, userIds) =>
    set((s) => {
      const next = [...new Set(userIds)].sort()
      // Same people, same state — a presence sync that changes nothing
      // re-renders nothing.
      if (sameIds(s.byLeague[leagueId], next)) return s
      return { byLeague: { ...s.byLeague, [leagueId]: next } }
    }),
  clearLeague: (leagueId) =>
    set((s) => {
      if (!(leagueId in s.byLeague)) return s
      const byLeague = { ...s.byLeague }
      delete byLeague[leagueId]
      return { byLeague }
    }),
  recentLeagueId: null,
  setRecentLeague: (leagueId) => set((s) => (s.recentLeagueId === leagueId ? s : { recentLeagueId: leagueId })),
}))

/** Pure: is this user present in the room(s) the store holds? */
export function isOnlineIn(byLeague: Readonly<Record<string, readonly string[]>>, userId: string | null | undefined): boolean {
  if (!userId) return false
  for (const ids of Object.values(byLeague)) if (ids.includes(userId)) return true
  return false
}

/** Pure: everyone present in the room(s) the store holds. */
export function onlineUnion(byLeague: Readonly<Record<string, readonly string[]>>): ReadonlySet<string> {
  const all = new Set<string>()
  for (const ids of Object.values(byLeague)) for (const id of ids) all.add(id)
  return all
}

/** A finished season's room is never held for presence: nobody gathers in
 *  last year's league, and a long-time user would otherwise collect one
 *  per season. Every other status (setup through playoffs) is in play. */
export function isPresenceLeague(status: string): boolean {
  return status !== 'complete'
}

/** Pure: the league id a pathname is under (`/app/leagues/<id>/…`, the
 *  draft room included — or a league's message board,
 *  `/app/messages/league-<id>`, which holds that league's room too), or
 *  null. */
export function leagueIdInPath(pathname: string): string | null {
  const league = /^\/app\/leagues\/([^/?#]+)/.exec(pathname)?.[1]
  if (league) return league
  const thread = /^\/app\/messages\/([^/?#]+)/.exec(pathname)?.[1]
  if (!thread) return null
  try {
    return leagueIdOfThread(decodeURIComponent(thread))
  } catch {
    return null // a malformed escape names no league
  }
}

/**
 * Pure: the ONE league room this session counts you as here in — spec §9.3's
 * "current league", so who's online never costs a channel per league.
 *
 * - On a league's pages (its draft room and its message board too) it's that
 *   league: the room the page already holds, so presence opens nothing new,
 *   and the board's "N online" counts that league's people. A finished
 *   season's pages hold none.
 * - Elsewhere on a phone (Messages, Home, Lists…) it's the league you were
 *   last in this session, else your newest league still in play — so the
 *   dots there are that league's people.
 * - Elsewhere on desktop, none: desktop draws no dot, and off a league page
 *   it holds no league room at all (§9.3: unsubscribe on route change).
 */
export function presenceLeagueId(input: {
  pathname: string
  mode: LayoutMode | null
  recentLeagueId: string | null
  /** GET /api/leagues — newest first. */
  leagues: ReadonlyArray<{ id: string; status: string }>
}): string | null {
  const inPlay = input.leagues.filter((league) => isPresenceLeague(league.status))
  const holds = (id: string | null): id is string => id !== null && inPlay.some((league) => league.id === id)
  const fromPath = leagueIdInPath(input.pathname)
  if (fromPath !== null && input.leagues.some((league) => league.id === fromPath)) {
    return holds(fromPath) ? fromPath : null
  }
  if (input.mode !== 'mobile') return null
  if (holds(input.recentLeagueId)) return input.recentLeagueId
  return inPlay[0]?.id ?? null
}
