import {
  fetchAllPlayers,
  isFantasyRelevant,
  mapSleeperPlayerToDb,
  type PlayerRow,
} from '@/lib/sports-data/sleeper'

import type { SyncClient, SyncSummary } from './types'

const BATCH_SIZE = 500

/** Roster sync: identity/bio, team, status, depth chart. */
export async function syncPlayers(supabase: SyncClient): Promise<SyncSummary> {
  const all = await fetchAllPlayers()

  const rows: PlayerRow[] = []
  for (const player of Object.values(all)) {
    if (!isFantasyRelevant(player)) continue
    const row = mapSleeperPlayerToDb(player)
    if (row) rows.push(row)
  }

  let upserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('players')
      .upsert(batch, { onConflict: 'sleeper_id' })
    if (error) throw new Error(`players upsert failed: ${error.message}`)
    upserted += batch.length
  }

  return { name: 'players', counts: { mapped: rows.length, upserted }, warnings: [] }
}
