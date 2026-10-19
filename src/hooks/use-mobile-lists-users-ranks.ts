'use client'

import { useQueries, type UseQueryResult } from '@tanstack/react-query'

import { RANK_POSITIONS, fromDbPos, type RankPos } from '@/components/mobile/rankings/rankings-ops'
import { sourceRankMap, usersSourceQuery, type HubRow } from '@/hooks/use-mobile-rankings-sources'

/**
 * FieldScout Mobile — Lists: the "Users" rank stat column (lr-lists §2.5,
 * gap list §3 #9). Each player's place in the users' consensus at his
 * position (lr-lists §5 `statv`: his place in that source's position
 * ranking) — read exactly as the phone Rankings hub's Users tab reads it,
 * through the same query and cache (`usersSourceQuery`), and numbered the
 * same way (`sourceRankMap`), so a player has one Users rank on both
 * screens. Players the consensus ties take the order the hub gives them
 * (1, 2 — never 1, 1).
 *
 * The consensus is the existing `consensus_rankings` view (001), which
 * applies Rule 9: every public, ranked list counts, weighted by its owner's
 * cred score (`GREATEST(cred_score, 1)` — never 0; every account starts at
 * 7, `CRED_START`, migration 197). It is season-long, so the column ignores the
 * time frame and the scoring.
 *
 * One read per position on the list (as the hub reads one per chip). A
 * player missing from his position's consensus simply isn't in it ("–"); a
 * failed read is an error, never an empty map that would read as "nobody
 * ranked him".
 */

/** The positions a list's Users column reads: each position on the list
 *  once, in the hub's chip order (the app's DEF is the hub's DST). A
 *  position with no hub chip has no users' ranking. */
export function usersRankPositions(positions: ReadonlyArray<string | null | undefined>): RankPos[] {
  const on = new Set(positions.map(fromDbPos))
  return RANK_POSITIONS.filter((pos) => on.has(pos))
}

/** Player id → his rank among users at his position (each player is in one
 *  position's consensus, so the maps never overlap). */
export function usersRanks(sources: ReadonlyArray<readonly HubRow[] | undefined>): Map<string, number> {
  const out = new Map<string, number>()
  for (const rows of sources) for (const [id, rank] of sourceRankMap(rows)) out.set(id, rank)
  return out
}

/**
 * The Users column's ranks, shaped like the screen's other reads (`data` /
 * `isSuccess` / `isError` / `refetch`). `data` arrives once every position's
 * read has.
 */
export function useMobileListsUsersRanks(playerPositions: ReadonlyArray<string | null | undefined>, enabled: boolean) {
  return useQueries({
    queries: usersRankPositions(playerPositions).map((pos) => ({ ...usersSourceQuery(pos), enabled })),
    combine: combineUsers,
  })
}

/** Stable (module-level) so TanStack memoises the combined result. */
function combineUsers(results: Array<UseQueryResult<HubRow[]>>) {
  const isSuccess = results.every((result) => result.isSuccess)
  return {
    data: isSuccess ? usersRanks(results.map((result) => result.data)) : undefined,
    isSuccess,
    isError: results.some((result) => result.isError),
    refetch: () => Promise.all(results.filter((result) => result.isError).map((result) => result.refetch())),
  }
}
