import { create } from 'zustand'

/**
 * WHO'S ONLINE — gap list §3 #25 ("who's online everywhere, not just in the
 * draft room").
 *
 * The user ids each of your leagues' rooms reports present (Supabase
 * Realtime Presence on `league:<id>` — 070's members-only policies), written
 * by the session's one `PresenceHost` and read by any avatar through
 * `useIsOnline` / `useTeamOnline`. A dot reads this store; it never opens a
 * channel.
 *
 * Kept per league so a league you leave (or whose channel drops) takes its
 * people with it; online-ness is the union — a league-mate is online if any
 * shared league sees them. You are never in it: the host leaves your own id
 * out, so your own avatar never shows a dot.
 *
 * In memory only, never persisted: presence is a live fact, and a stored one
 * would be a stale claim.
 */
interface PresenceStore {
  /** League id → the user ids present there (not you), sorted. */
  byLeague: Record<string, readonly string[]>
  setLeague: (leagueId: string, userIds: Iterable<string>) => void
  clearLeague: (leagueId: string) => void
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
}))

/** Pure: is this user present in any of your leagues' rooms? */
export function isOnlineIn(byLeague: Readonly<Record<string, readonly string[]>>, userId: string | null | undefined): boolean {
  if (!userId) return false
  for (const ids of Object.values(byLeague)) if (ids.includes(userId)) return true
  return false
}

/** Pure: everyone present in any of your leagues' rooms. */
export function onlineUnion(byLeague: Readonly<Record<string, readonly string[]>>): ReadonlySet<string> {
  const all = new Set<string>()
  for (const ids of Object.values(byLeague)) for (const id of ids) all.add(id)
  return all
}
