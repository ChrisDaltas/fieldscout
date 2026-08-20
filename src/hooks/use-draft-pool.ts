'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type {
  AuctionPlayerSource,
} from '@/components/draft/auction-player-table-ops'
import { scoringFamilyFromRules } from '@/components/draft/auction-player-table-ops'
import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { createBrowserClient } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

/**
 * Draft-room player pool + my Big Board ranks (M2 task L.B3.2; spec §8.5.2
 * available-players; §16.2; tasks-M2 C26/D92 — reads are RLS-scoped direct
 * SELECTs, `players` is world-readable and app-read-only).
 *
 * SEARCH IS SERVER-BACKED on purpose (the "exactly 1000 rows" lesson,
 * CLAUDE.md): the browse view is a deliberately bounded ADP-ordered window
 * (`POOL_WINDOW` — a full 16×16 draft consumes 256 players off the top, so
 * the window comfortably outlives every board), and any player outside it
 * is still findable because a search term becomes an `ilike` FILTER in the
 * query rather than a scan of the bounded page. Drafted subtraction happens
 * client-side BY player_id (C26 — available-players-ops.ts) so the pool,
 * queue and board all move on the same picks broadcast (E17) without
 * refetching this query.
 */

/** ADP-ordered browse window; search/position narrow SERVER-side. */
export const POOL_WINDOW = 300

export const draftPoolKeys = {
  pool: (search: string, position: string) => ['draft-pool', search, position] as const,
  bigBoard: (userId: string) => ['draft-big-board', userId] as const,
}

export function useDraftPool(search: string, position: string) {
  const normalizedSearch = search.trim()
  return useQuery({
    queryKey: draftPoolKeys.pool(normalizedSearch, position),
    queryFn: async (): Promise<PoolPlayer[]> => {
      const supabase = createBrowserClient()
      let query = supabase
        .from('players')
        .select('id, full_name, position, team, adp, headshot_url, status')
        // The active pool: retirees/free agents have no current team (the
        // players-builder route's own filter — one definition of "active").
        .not('team', 'is', null)
      if (position) query = query.eq('position', position)
      if (normalizedSearch) query = query.ilike('full_name', `%${normalizedSearch}%`)
      const { data, error } = await query
        .order('adp', { ascending: true, nullsFirst: false })
        .order('full_name', { ascending: true })
        .order('id', { ascending: true }) // unique tiebreak — stable window
        .limit(POOL_WINDOW)
      if (error) throw error
      return (data ?? []) as PoolPlayer[]
    },
    staleTime: 5 * 60 * 1000, // the pool itself moves slowly; picks don't touch it
  })
}

/**
 * My season Big Board rank map (§8.9's default reference — the ranks column
 * §16.2 names). Own-lists RLS read: the board is `lists.is_big_board`
 * (partial-unique per owner, auto-created at signup) and rank = position
 * order in `list_players`. Absent board ⇒ an empty map (the column renders
 * "—").
 */
export function useMyBigBoardRanks(userId: string | undefined) {
  return useQuery({
    queryKey: draftPoolKeys.bigBoard(userId ?? 'none'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Array<{ player_id: string }>> => {
      const supabase = createBrowserClient()
      const { data: board, error: boardError } = await supabase
        .from('lists')
        .select('id')
        .eq('owner_id', userId!)
        .eq('is_big_board', true)
        .is('deleted_at', null)
        .maybeSingle()
      if (boardError) throw boardError
      if (!board) return []
      const { data, error } = await supabase
        .from('list_players')
        .select('player_id')
        .eq('list_id', board.id)
        .order('position', { ascending: true })
      if (error) throw error
      return (data ?? []) as Array<{ player_id: string }>
    },
    staleTime: 5 * 60 * 1000,
  })
}

// ---------------------------------------------------------------------------
// The AUCTION player table's reads — M3 task L.C3.3 (spec §16.2
// `auction-player-table.tsx`, §16.4's v2.10 player-table callout; D194)
// ---------------------------------------------------------------------------

/**
 * The auction table needs a SUPERSET of the pool's columns — `auction_value`
 * (035), `bye_week` (001), `sos` (032), the three season-projection columns
 * and the `projected_stats` blob (031) — so it reads them here rather than
 * fattening `useDraftPool`, whose rows paint a compact list in every snake
 * room and have no use for a per-player projections blob. Same table, same
 * window, the same bounded-window honesty note as above; one more key.
 */
export const auctionPoolSelect =
  'id, full_name, position, team, adp, headshot_url, status, auction_value, bye_week, sos, ' +
  'projected_pts_ppr, projected_pts_half_ppr, projected_pts_standard, projected_stats'

export const auctionPoolKeys = {
  window: (search: string, position: string) => ['auction-pool', search, position] as const,
  byIds: (ids: readonly string[]) => ['auction-pool-by-ids', ids] as const,
  scoring: (leagueId: string) => ['league-scoring-family', leagueId] as const,
}

/** The ADP-ordered browse window with the auction columns. Search/position
 *  narrow SERVER-side exactly as the pool's do; DRAFTED PLAYERS ARE NOT
 *  EXCLUDED here — the Show-Drafted toggle needs them, and the caller does
 *  the C26 by-id subtraction. */
export function useAuctionPool(search: string, position: string) {
  const normalizedSearch = search.trim()
  return useQuery({
    queryKey: auctionPoolKeys.window(normalizedSearch, position),
    queryFn: async (): Promise<AuctionPlayerSource[]> => {
      const supabase = createBrowserClient()
      let query = supabase.from('players').select(auctionPoolSelect).not('team', 'is', null)
      if (position) query = query.eq('position', position)
      if (normalizedSearch) query = query.ilike('full_name', `%${normalizedSearch}%`)
      const { data, error } = await query
        .order('adp', { ascending: true, nullsFirst: false })
        .order('full_name', { ascending: true })
        .order('id', { ascending: true }) // unique tiebreak — stable window
        .limit(POOL_WINDOW)
      if (error) throw error
      return (data ?? []) as unknown as AuctionPlayerSource[]
    },
    staleTime: 5 * 60 * 1000,
  })
}

/** PostgREST caps an unbounded response at 1000 rows, so ONE `.in()` over a
 *  long id list could truncate silently — the exact "exactly 1000 rows"
 *  defect CLAUDE.md names. The id set is chunked instead. */
const BY_ID_CHUNK = 300

/**
 * Auction-column rows for ids that the ADP window may not contain — the
 * union of what the table's window-INDEPENDENT filters need: every drafted
 * player (Show Drafted must price the sleeper taken at pick 140, not only
 * the studs), my Favorites, and the §8.9 overlay's list under "Only this
 * list". ONE read serves all three; ids already inside the window cost
 * nothing extra because `mergeSources` dedupes by id.
 */
export function useAuctionPlayersByIds(ids: readonly string[]) {
  // Sorted + deduped so the key is stable across re-renders and arrival
  // order (the `usePlayersByIds` idiom).
  const sortedIds = useMemo(() => Array.from(new Set(ids)).sort(), [ids])
  return useQuery({
    queryKey: auctionPoolKeys.byIds(sortedIds),
    enabled: sortedIds.length > 0,
    queryFn: async (): Promise<AuctionPlayerSource[]> => {
      const supabase = createBrowserClient()
      const out: AuctionPlayerSource[] = []
      for (let i = 0; i < sortedIds.length; i += BY_ID_CHUNK) {
        const { data, error } = await supabase
          .from('players')
          .select(auctionPoolSelect)
          .in('id', sortedIds.slice(i, i + BY_ID_CHUNK))
        if (error) throw error
        out.push(...((data ?? []) as unknown as AuctionPlayerSource[]))
      }
      return out
    },
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * The league's scoring family (§7.3.3) — read from `leagues
 * .scoring_rules_snapshot`, the FROZEN copy a league in `drafting`+ always
 * carries (migration 059's guard), so the table's projections are scored by
 * the rules the season will actually use.
 *
 * A MOCK draft runs while its league is still `setup`/`scheduled`, where no
 * snapshot exists yet — so the read falls back to the league's chosen
 * `scoring_systems.rules`, world-readable for the template rows every
 * shipped league uses (058's policy). When NEITHER resolves the family is
 * `null` and the two dependent columns render "—" with the reason said out
 * loud: §16.5.4's "never wrong numbers" forbids substituting a default
 * scoring family for the league's real one.
 */
export function useLeagueScoringFamily(leagueId: string | undefined) {
  const query = useQuery({
    queryKey: auctionPoolKeys.scoring(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: async (): Promise<Json | null> => {
      const supabase = createBrowserClient()
      const { data: league, error } = await supabase
        .from('leagues')
        .select('scoring_rules_snapshot, scoring_system_id')
        .eq('id', leagueId!)
        .maybeSingle()
      if (error) throw error
      if (league?.scoring_rules_snapshot != null) return league.scoring_rules_snapshot
      if (!league?.scoring_system_id) return null
      const { data: system, error: systemError } = await supabase
        .from('scoring_systems')
        .select('rules')
        .eq('id', league.scoring_system_id)
        .maybeSingle()
      if (systemError) throw systemError
      return system?.rules ?? null
    },
    staleTime: 10 * 60 * 1000,
  })
  return { ...query, family: scoringFamilyFromRules(query.data) }
}
