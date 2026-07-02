/**
 * Generate plausible mock 2026 season stats for weeks 1-4 from the players
 * already loaded in the DB. Marks every row with source='mock', is_live=false.
 *
 *   npx tsx scripts/generate-mock-current-stats.ts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

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

const SEASON = 2026
const WEEKS = [1, 2, 3, 4]
const BATCH_SIZE = 500

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
type Position = (typeof POSITIONS)[number]

interface Player {
  id: string
  position: string
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

interface StatLine {
  pass_attempts: number
  pass_completions: number
  pass_yards: number
  pass_tds: number
  interceptions: number
  rush_attempts: number
  rush_yards: number
  rush_tds: number
  targets: number
  receptions: number
  receiving_yards: number
  receiving_tds: number
}

function emptyLine(): StatLine {
  return {
    pass_attempts: 0,
    pass_completions: 0,
    pass_yards: 0,
    pass_tds: 0,
    interceptions: 0,
    rush_attempts: 0,
    rush_yards: 0,
    rush_tds: 0,
    targets: 0,
    receptions: 0,
    receiving_yards: 0,
    receiving_tds: 0,
  }
}

function generateLine(position: Position): StatLine {
  const line = emptyLine()
  switch (position) {
    case 'QB': {
      const attempts = randInt(28, 42)
      line.pass_attempts = attempts
      line.pass_completions = Math.round(attempts * (0.58 + Math.random() * 0.15))
      line.pass_yards = randInt(280, 380)
      line.pass_tds = randInt(1, 3)
      line.interceptions = randInt(0, 1)
      line.rush_attempts = randInt(2, 5)
      line.rush_yards = randInt(5, 25)
      break
    }
    case 'RB': {
      line.rush_attempts = randInt(12, 22)
      line.rush_yards = randInt(70, 110)
      line.rush_tds = randInt(0, 1)
      line.targets = randInt(3, 7)
      line.receptions = randInt(3, 6)
      line.receiving_yards = randInt(15, 45)
      line.receiving_tds = Math.random() < 0.15 ? 1 : 0
      break
    }
    case 'WR': {
      line.targets = randInt(5, 11)
      line.receptions = randInt(4, 8)
      line.receiving_yards = randInt(60, 110)
      line.receiving_tds = randInt(0, 1)
      break
    }
    case 'TE': {
      line.targets = randInt(3, 7)
      line.receptions = randInt(2, 5)
      line.receiving_yards = randInt(30, 70)
      line.receiving_tds = randInt(0, 1)
      break
    }
  }
  return line
}

async function fetchPlayers(): Promise<Player[]> {
  const all: Player[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('id, position')
      .in('position', POSITIONS as unknown as string[])
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as Player[]))
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function main() {
  console.log(`Generating mock stats for season ${SEASON} weeks ${WEEKS.join(', ')}…`)
  const players = await fetchPlayers()
  console.log(`Found ${players.length} eligible players in DB`)

  const rows: Record<string, unknown>[] = []
  for (const week of WEEKS) {
    for (const p of players) {
      const line = generateLine(p.position as Position)
      rows.push({
        player_id: p.id,
        season: SEASON,
        week,
        stat_type: 'weekly',
        is_live: false,
        source: 'mock',
        ...line,
      })
    }
  }

  console.log(`Upserting ${rows.length} mock stat rows…`)
  let upserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('player_stats')
      .upsert(batch, { onConflict: 'player_id,season,week' })
    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error.message)
      process.exit(1)
    }
    upserted += batch.length
    process.stdout.write(`\r  upserted ${upserted}/${rows.length}`)
  }

  process.stdout.write('\n')
  console.log(`Generated ${rows.length} mock stat rows for ${players.length} players`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
