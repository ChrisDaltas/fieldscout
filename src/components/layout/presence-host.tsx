'use client'

import { useEffect } from 'react'

import { useAuth } from '@/hooks/use-auth'
import { joinLeagueRoom, type LeagueChannelHandlers } from '@/hooks/use-league-channel'
import { useLeagues } from '@/hooks/use-leagues'
import { featureFlags } from '@/lib/feature-flags'
import { usePresenceStore } from '@/stores/presence-store'

/** The host hears no broadcasts of its own — presence only. */
const NO_HANDLERS: { current: LeagueChannelHandlers } = { current: {} }

/**
 * WHO'S ONLINE — the one place presence is held (gap list §3 #25: "who's
 * online everywhere, not just in the draft room").
 *
 * Mounted once, in the app shell, for the whole signed-in session: it joins
 * the `league:<id>` room of every league you're in, asks each to count you as
 * here (`tracksPresence`), and writes who else is there into the presence
 * store. Every green dot reads that store — one presence subscription per
 * league per session, never one per row or per screen. A league page that
 * mounts later joins the SAME room (the spine is refcounted per topic), so
 * it opens nothing new.
 *
 * Held on both layouts although only phones draw the dot: a league-mate on a
 * laptop is online too, and leaving desktop out would show them offline.
 * The draft room (outside the shell) keeps its own presence on its own
 * channel, as before.
 */
export function PresenceHost() {
  const { user } = useAuth()
  const viewerId = user?.id ?? null
  const leaguesOn = featureFlags.leagues
  const leagues = useLeagues({ enabled: leaguesOn && viewerId !== null })
  if (!leaguesOn || !viewerId) return null
  return (
    <>
      {(leagues.data ?? []).map((league) => (
        <LeaguePresence key={league.id} leagueId={league.id} viewerId={viewerId} />
      ))}
    </>
  )
}

/** One league's presence, held while you're in it. Its own effect, so
 *  joining or leaving one league never re-joins the others. */
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
