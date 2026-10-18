'use client'

import { useCallback, useMemo } from 'react'

import { isOnlineIn, onlineUnion, usePresenceStore } from '@/stores/presence-store'

/**
 * Who's online (gap list §3 #25) — read side. Each avatar asks the presence
 * store, which the session's `PresenceHost` fills from your current
 * league's room; nothing here opens a channel, so a list of a hundred rows
 * costs a hundred store reads and zero sockets.
 *
 * Online means a member of your current league has FieldScout open in front
 * of them right now. It is false for you, for someone outside that league
 * (one room per session — spec §9.3 — so nothing tells us), and while
 * presence is unknown (a dropped channel claims nobody).
 */
export function useIsOnline(userId: string | null | undefined): boolean {
  return usePresenceStore((s) => isOnlineIn(s.byLeague, userId))
}

/** Pure: a league's members → "is this team's manager online?". A team
 *  with no manager (an open seat, a vacated team) is never online. */
export function teamOnlineLookup(
  members: ReadonlyArray<{ user_id: string | null; team_id: string | null }>,
  online: ReadonlySet<string>,
): (teamId: string | null | undefined) => boolean {
  const onlineTeams = new Set<string>()
  for (const m of members) if (m.team_id && m.user_id && online.has(m.user_id)) onlineTeams.add(m.team_id)
  return (teamId) => (teamId ? onlineTeams.has(teamId) : false)
}

/** Every online league-mate (not you). */
export function useOnlineUserIds(): ReadonlySet<string> {
  const byLeague = usePresenceStore((s) => s.byLeague)
  return useMemo(() => onlineUnion(byLeague), [byLeague])
}

/** "Is this team's manager online?" for a league's team rows (standings,
 *  matchups, the team page) — teams light up through their manager. */
export function useTeamOnline(
  members: ReadonlyArray<{ user_id: string | null; team_id: string | null }> | null | undefined,
): (teamId: string | null | undefined) => boolean {
  const online = useOnlineUserIds()
  const lookup = useMemo(() => teamOnlineLookup(members ?? [], online), [members, online])
  return useCallback((teamId: string | null | undefined) => lookup(teamId), [lookup])
}
