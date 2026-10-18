'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { useAuth } from '@/hooks/use-auth'
import { useLayoutModeValue } from '@/hooks/use-layout-mode'
import { joinLeagueRoom, type LeagueChannelHandlers } from '@/hooks/use-league-channel'
import { useLeagues } from '@/hooks/use-leagues'
import { featureFlags } from '@/lib/feature-flags'
import { leagueIdInPath, presenceLeagueId, usePresenceStore } from '@/stores/presence-store'

/** The host hears no broadcasts of its own — presence only. */
const NO_HANDLERS: { current: LeagueChannelHandlers } = { current: {} }

/**
 * WHO'S ONLINE — the one place presence is held (gap list §3 #25: "who's
 * online everywhere, not just in the draft room").
 *
 * Mounted once per frame — the app shell and the draft room's `(room)`
 * layout, which sit side by side, so exactly one is ever mounted. It holds
 * ONE league room for the session: your CURRENT league (`presenceLeagueId`
 * — the league whose pages you're on, else on a phone the league you were
 * last in), asks it to count you as here (`tracksPresence`), and writes who
 * else is there into the presence store. Every green dot reads that store.
 *
 * Spec §9.3's budget is "≤ 3 channels (current league, current draft,
 * notifications)", and this stays inside it: on a league page the room is
 * the one the page already holds (the spine is refcounted per topic), so it
 * opens nothing new; in the draft room it is the draft's league beside the
 * draft's own channel, so a manager who is drafting right now is online
 * everywhere else too; moving to another league releases the old room.
 * Desktop holds a league room only on that league's pages (it draws no dot,
 * but a league-mate on a laptop there is online all the same).
 */
export function PresenceHost() {
  const { user } = useAuth()
  const viewerId = user?.id ?? null
  const leaguesOn = featureFlags.leagues
  const leagues = useLeagues({ enabled: leaguesOn && viewerId !== null })
  const pathname = usePathname()
  const mode = useLayoutModeValue()
  const recentLeagueId = usePresenceStore((s) => s.recentLeagueId)
  const leagueId = presenceLeagueId({ pathname, mode, recentLeagueId, leagues: leagues.data ?? [] })
  const onItsPages = leagueId !== null && leagueId === leagueIdInPath(pathname)

  // Remember the league you're in, so a phone keeps its room on Messages,
  // Home or Lists rather than hopping to another league.
  useEffect(() => {
    if (onItsPages && leagueId) usePresenceStore.getState().setRecentLeague(leagueId)
  }, [onItsPages, leagueId])

  if (!leaguesOn || !viewerId || leagueId === null) return null
  // Keyed by league: moving to another one releases the old room first.
  return <LeaguePresence key={leagueId} leagueId={leagueId} viewerId={viewerId} />
}

/** The current league's presence, held while it is current. */
function LeaguePresence({ leagueId, viewerId }: { leagueId: string; viewerId: string }) {
  useEffect(() => {
    const { setLeague, clearLeague } = usePresenceStore.getState()
    const release = joinLeagueRoom(leagueId, {
      handlers: NO_HANDLERS,
      tracksPresence: true,
      // You are never in the store: your own avatar shows no dot.
      onPresence: (userIds) => setLeague(leagueId, [...userIds].filter((id) => id !== viewerId)),
    })
    return () => {
      release()
      clearLeague(leagueId)
    }
  }, [leagueId, viewerId])
  return null
}
