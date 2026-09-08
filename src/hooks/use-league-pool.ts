'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { gameLockView, type GameLockView } from '@/lib/leagues/api/rosters-service'
import { createBrowserClient } from '@/lib/supabase/client'

import { useLeagueChannel } from './use-league-channel'
import { invalidatingHandlers, rostersEventInvalidates } from './use-league-channel-ops'

/**
 * The league's player POOL — `league_player_pool`'s rows as the players page
 * reads them (M4 task L.D5.4; spec §12.19, §13.1, §16.2 `free-agents-table`;
 * PROGRESS D294, D315(5), D319(6), F241(d), F251(b)).
 *
 * READ: an RLS-scoped direct SELECT (D92 — §15.3 prints NO players/free-
 * agents GET; `league_player_pool` is member-SELECT, 109). **Rows are LAZY
 * (§12.19: "a player with no row = free_agent if unowned")**, so an empty
 * read is a legal state for a league nobody has touched — the page derives
 * a player's availability from the row when there is one and from the
 * rosters when there is not (`players-page-ops.ts`). A transport error
 * THROWS rather than reading as "everyone is a free agent" (CLAUDE.md's
 * loud-emptiness rule).
 *
 * **What the row says and what it does not.** `state` is the pool's word
 * (`free_agent` · `on_waivers` · `rostered` · `locked_in_game` — the tick's
 * name for an unowned player whose game is on, 116) and `waivers_until` the
 * clearing instant a CHECK ties to `on_waivers` (113). `locked_until` is
 * the game-day lock VIEW — `lineup_lock_tick` refreshes it every minute
 * from `nfl_games` for EXISTING rows only — normalised here through the
 * rosters service's own `gameLockView` (F241(d): `'infinity'` = locked with
 * the release not yet recorded; an undefined shape THROWS, never a silently
 * unlocked row). The client computes NO lock: a free agent with no pool row
 * shows no 🔒 even if his game is on, and the add is refused by 113's own
 * E32 evaluation at transaction time, verbatim on screen. The view is the
 * CURRENT week's (F251(b) — decided here for both surfaces: no per-week arm
 * on the client; the tick's view is rendered as it stands and the server's
 * answer governs).
 *
 * **The surface is the gate (F249(a)'s posture):** `players-page.tsx` mounts
 * this below `useLeague`'s 403/404 and the `leagues` SELECT policy is
 * member/owner-only (052:126), so the hook cannot mount for a non-member.
 *
 * LIVE: joins the ONE `league:<id>` room (F233(a) — a handler map, never a
 * `.channel(`) on exactly the events the rosters listen to
 * (`rostersEventInvalidates`: `league_rosters` · `transactions` ·
 * `league_player_pool` — the pool's own coalesced tick summary, D319(6)),
 * because the pool and the rosters are two halves of one truth (D294's
 * mirror) and go stale together. Every confirmed (re)join refetches (§9.3).
 * Never optimistic: a move re-reads (`use-transactions.ts`).
 *
 * `Date.parse` is inside `gameLockView` (a pure parse of a stored value);
 * no clock is read here.
 */

export const leaguePoolKeys = {
  /** Everything for one league — the invalidation target. */
  all: (leagueId: string) => ['league-pool', leagueId] as const,
}

export interface PoolRow {
  player_id: string
  state: string
  waivers_until: string | null
  game_lock: GameLockView
}

/** PostgREST's default cap; the pool is bounded by the players a league has
 *  touched (≤ rosters + drops) and is asserted below it rather than assumed. */
const POSTGREST_CAP = 1000

export function useLeaguePool(leagueId: string | undefined) {
  return useQuery({
    queryKey: leaguePoolKeys.all(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: async (): Promise<PoolRow[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('league_player_pool')
        .select('player_id, state, waivers_until, locked_until')
        .eq('league_id', leagueId!)
        .order('player_id', { ascending: true })
      if (error) throw error
      const rows = data ?? []
      if (rows.length >= POSTGREST_CAP) {
        throw new Error(`league_player_pool: ${rows.length} rows reached PostgREST’s cap — the pool read is not whole`)
      }
      return rows.map((row) => ({
        player_id: row.player_id,
        state: row.state,
        waivers_until: row.waivers_until,
        game_lock: gameLockView(row.locked_until),
      }))
    },
  })
}

/** The fetch + subscribe half — what the mounted players page uses. */
export function useLeaguePoolLive(leagueId: string | undefined) {
  const query = useLeaguePool(leagueId)
  const queryClient = useQueryClient()

  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: leaguePoolKeys.all(leagueId) })
  }

  const { connection } = useLeagueChannel(
    leagueId,
    invalidatingHandlers(rostersEventInvalidates, invalidate),
    { onJoin: invalidate, onDrop: invalidate },
  )

  return { ...query, connection }
}
