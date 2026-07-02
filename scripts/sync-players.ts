/**
 * Sync NFL players from the Sleeper API into the players table.
 *
 *   npx tsx scripts/sync-players.ts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import {
  fetchAllPlayers,
  isFantasyRelevant,
  mapSleeperPlayerToDb,
  type PlayerRow,
} from '../src/lib/sports-data/sleeper'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const BATCH_SIZE = 500

async function main() {
  console.log('Fetching all NFL players from Sleeper…')
  const all = await fetchAllPlayers()

  const rows: PlayerRow[] = []
  for (const player of Object.values(all)) {
    if (!isFantasyRelevant(player)) continue
    const row = mapSleeperPlayerToDb(player)
    if (row) rows.push(row)
  }

  console.log(`Mapped ${rows.length} active fantasy-relevant players. Upserting…`)

  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('players')
      .upsert(batch, { onConflict: 'sleeper_id' })

    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error.message)
      process.exit(1)
    }
    inserted += batch.length
    process.stdout.write(`\r  upserted ${inserted}/${rows.length}`)
  }

  process.stdout.write('\n')
  console.log(`Synced ${rows.length} players`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
