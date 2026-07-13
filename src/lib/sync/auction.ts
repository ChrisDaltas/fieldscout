import type { SyncClient, SyncSummary } from './types'

/**
 * Average auction values from ESPN's public fantasy API —
 * ownership.auctionValueAverage is the running average price across real
 * ESPN auction drafts (the only free live-auction source; the endpoint is
 * unofficial, so the sync degrades to a warning if it changes shape).
 *
 * Matching: espn_id (from the Sleeper roster feed) when present, else
 * normalized name + position. Sleeper only carries espn_id for a fraction
 * of players, so name matching does most of the work; ambiguous names are
 * skipped rather than guessed.
 */

const ESPN_URL = (season: number) =>
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`

/** ESPN defaultPositionId → app position. D/ST intentionally absent —
 *  ESPN D/ST entries are team pseudo-players that don't name-match ours. */
const ESPN_POSITIONS: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
}

const FETCH_LIMIT = 600

interface EspnPlayerRow {
  player?: {
    id: number
    fullName?: string | null
    defaultPositionId?: number | null
    ownership?: { auctionValueAverage?: number | null } | null
  } | null
}

/** Same shape Sleeper's search_full_name uses: lowercase letters only. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '')
}

export async function syncAuctionValues(
  supabase: SyncClient,
  season: number,
): Promise<SyncSummary> {
  const res = await fetch(ESPN_URL(season), {
    headers: {
      accept: 'application/json',
      'x-fantasy-filter': JSON.stringify({
        players: {
          limit: FETCH_LIMIT,
          sortPercOwned: { sortAsc: false, sortPriority: 1 },
        },
      }),
    },
  })
  if (!res.ok) {
    throw new Error(`ESPN auction fetch failed: ${res.status}`)
  }
  const body = (await res.json()) as { players?: EspnPlayerRow[] }
  const espnRows = body.players ?? []
  if (espnRows.length === 0) {
    return {
      name: 'auction',
      counts: { matched: 0 },
      warnings: ['ESPN returned no players — endpoint shape may have changed'],
    }
  }

  // Our players: two lookups — by espn_id, and by normalized name+position
  // (ambiguous name+position keys are dropped).
  const { data: players, error } = await supabase
    .from('players')
    .select('id, full_name, position, espn_id')
    .not('team', 'is', null)
  if (error) throw new Error(`players query failed: ${error.message}`)

  const byEspnId = new Map<string, string>()
  const byNamePos = new Map<string, string | null>()
  for (const p of players ?? []) {
    if (p.espn_id) byEspnId.set(String(p.espn_id), p.id as string)
    const key = `${normalizeName(p.full_name as string)}|${p.position}`
    byNamePos.set(key, byNamePos.has(key) ? null : (p.id as string))
  }

  let matchedById = 0
  let matchedByName = 0
  let unmatched = 0
  const now = new Date().toISOString()
  const updates: Array<{ id: string; auction_value: number }> = []
  for (const row of espnRows) {
    const espn = row.player
    const avg = espn?.ownership?.auctionValueAverage
    if (!espn || avg == null || avg <= 0) continue
    const position = ESPN_POSITIONS[espn.defaultPositionId ?? -1]
    if (!position || !espn.fullName) continue

    let id = byEspnId.get(String(espn.id))
    if (id) {
      matchedById++
    } else {
      id = byNamePos.get(`${normalizeName(espn.fullName)}|${position}`) ?? undefined
      if (id) matchedByName++
    }
    if (!id) {
      unmatched++
      continue
    }
    updates.push({ id, auction_value: Math.round(avg * 10) / 10 })
  }

  const BATCH = 200
  let written = 0
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map((u) =>
        supabase
          .from('players')
          .update({ auction_value: u.auction_value, auction_updated_at: now })
          .eq('id', u.id),
      ),
    )
    for (const r of results) {
      if (r.error) throw new Error(`auction update failed: ${r.error.message}`)
    }
    written += batch.length
  }

  return {
    name: 'auction',
    counts: { espnRows: espnRows.length, written, matchedById, matchedByName, unmatched },
    warnings: [],
  }
}
