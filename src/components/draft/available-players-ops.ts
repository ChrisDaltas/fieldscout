/**
 * Available-players derivation — pure ops for `available-players.tsx` (M2
 * task L.B3.2; spec §8.5.2 "available players (searchable/filterable)",
 * §16.2, E17; tasks-M2 C26).
 *
 * THE C26 FIX LIVES HERE and is pinned in the sibling test: the pool
 * subtracts drafted players **by `player_id`** from the live `draft_picks`
 * rows — never by name. The mock-era `best-available-card` subtracted by
 * `full_name`, which collides on shared names (two "Josh Allen"s: drafting
 * one vanished both) and could never survive real picks. Undone picks are
 * NOT drafted (E4 returns the player to the pool), which falls out of the
 * caller passing only live (non-undone) pick ids.
 *
 * E17 flows through props: the picks channel updates the room's cached
 * rows, the drafted-id set is derived from them, and this pure subtraction
 * re-runs — the pool, queue greying and board all move on the same
 * broadcast.
 */

export interface PoolPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  adp: number | null
  headshot_url: string | null
  status: string | null
}

export interface PoolRow extends PoolPlayer {
  /** Rank on MY season Big Board (§8.9's default reference), null when the
   *  player is not on it. */
  bigBoardRank: number | null
}

/** Drafted-id set from live pick rows (C26: ids, never names). */
export function draftedIdSet(picks: ReadonlyArray<{ player_id: string; is_undone: boolean | null }>): Set<string> {
  const ids = new Set<string>()
  for (const pick of picks) if (!pick.is_undone) ids.add(pick.player_id)
  return ids
}

/** The pool minus drafted — BY player_id (C26). */
export function subtractDrafted<T extends { id: string }>(
  players: readonly T[],
  draftedIds: ReadonlySet<string>,
): T[] {
  return players.filter((p) => !draftedIds.has(p.id))
}

/** `list_players` of my Big Board (already position-ordered) → id ↦ rank. */
export function bigBoardRankById(
  rows: ReadonlyArray<{ player_id: string }>,
): Map<string, number> {
  const ranks = new Map<string, number>()
  rows.forEach((row, index) => {
    if (!ranks.has(row.player_id)) ranks.set(row.player_id, index + 1)
  })
  return ranks
}

/** Decorate the (already subtracted) pool with Big Board ranks. */
export function decoratePool(
  players: readonly PoolPlayer[],
  bigBoardRanks: ReadonlyMap<string, number>,
): PoolRow[] {
  return players.map((p) => ({ ...p, bigBoardRank: bigBoardRanks.get(p.id) ?? null }))
}

// ---------------------------------------------------------------------------
// §8.9 list overlay (M2 task L.B4.2) — rank/tier column + "only my list"
// ---------------------------------------------------------------------------

export interface ListOverlayMaps {
  rankById: Map<string, number>
  tierById: Map<string, string | null>
}

export interface OverlayPoolRow extends PoolRow {
  listRank: number | null
  listTier: string | null
}

/** `list_players` rows (ALREADY in the canonical `position, player_id`
 *  order — D113(5): one ordering, every consumer) → rank/tier maps. Rank is
 *  the 1-based index; first occurrence wins. */
export function overlayMaps(
  rows: ReadonlyArray<{ player_id: string; tier: string | null }>,
): ListOverlayMaps {
  const rankById = new Map<string, number>()
  const tierById = new Map<string, string | null>()
  rows.forEach((row, index) => {
    if (!rankById.has(row.player_id)) {
      rankById.set(row.player_id, index + 1)
      tierById.set(row.player_id, row.tier)
    }
  })
  return { rankById, tierById }
}

/** Annotate pool rows with the overlaid list's rank/tier ("show each
 *  player's rank/tier from that list as a column" — §8.9). */
export function decorateOverlay(rows: readonly PoolRow[], maps: ListOverlayMaps): OverlayPoolRow[] {
  return rows.map((row) => ({
    ...row,
    listRank: maps.rankById.get(row.id) ?? null,
    listTier: maps.tierById.get(row.id) ?? null,
  }))
}

/**
 * The §8.9 "only players on this list" filter — built FROM the list, not by
 * filtering the bounded pool window: a list player whose ADP falls outside
 * the browse window must still show (the "exactly 1000 rows" honesty rule
 * applied to the overlay: the filter claims the LIST, so it must reach all
 * of it). Rows keep list order; drafted players leave (E17); search and
 * position narrow client-side (a list is small — no server round trip).
 * Identities still loading are skipped — the caller renders its pending
 * state off the identity query, never a guessed row.
 */
export function onlyOnListRows(
  listRows: ReadonlyArray<{ player_id: string; tier: string | null }>,
  identityById: ReadonlyMap<
    string,
    {
      id: string
      full_name: string
      position: string
      team: string | null
      headshot_url: string | null
      status: string | null
      adp?: number | null
    }
  >,
  draftedIds: ReadonlySet<string>,
  search: string,
  position: string,
): PoolPlayer[] {
  const needle = search.trim().toLowerCase()
  const out: PoolPlayer[] = []
  const seen = new Set<string>()
  for (const row of listRows) {
    if (seen.has(row.player_id) || draftedIds.has(row.player_id)) continue
    seen.add(row.player_id)
    const identity = identityById.get(row.player_id)
    if (!identity) continue
    if (position && identity.position !== position) continue
    if (needle && !identity.full_name.toLowerCase().includes(needle)) continue
    out.push({ ...identity, adp: identity.adp ?? null })
  }
  return out
}
