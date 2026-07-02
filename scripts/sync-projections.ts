/**
 * Sync pre-season fantasy projections from Sleeper into the `players` table.
 *
 *   npx tsx scripts/sync-projections.ts          # syncs current $NEXT_PUBLIC_NFL_SEASON
 *   npx tsx scripts/sync-projections.ts 2026     # explicit season
 *
 * Source: https://api.sleeper.com/projections/nfl/<season>?season_type=regular&position[]=<pos>
 *
 * Each row exposes pts_ppr, pts_std, pts_half_ppr which we store distinctly
 * — QBs/Ks/DEFs see the same number across scorings (no receptions), but
 * RB/WR/TE diverge significantly between standard and PPR. Storing all three
 * means the UI can pick the right one without re-fetching.
 *
 * Player ID matching: Sleeper offensive players use numeric IDs that match
 * our `players.id` (which is itself the Sleeper player_id). Defenses use
 * team abbreviations as IDs (e.g. "WAS"); those also match because our DEF
 * roster came from the same Sleeper /v1/players/nfl endpoint.
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

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
type Position = (typeof POSITIONS)[number]

const seasonArg = process.argv[2]
const SEASON = Number(
  seasonArg ?? process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026,
)
if (!Number.isInteger(SEASON) || SEASON < 2000 || SEASON > 2100) {
  console.error(`Invalid season: ${SEASON}`)
  process.exit(1)
}

interface SleeperProjectionRow {
  player_id: string
  stats: {
    pts_ppr?: number | null
    pts_std?: number | null
    pts_half_ppr?: number | null
    gp?: number | null
  } | null
}

async function fetchProjections(position: Position): Promise<SleeperProjectionRow[]> {
  const url = `https://api.sleeper.com/projections/nfl/${SEASON}?season_type=regular&position[]=${position}&order_by=adp_ppr`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Projections fetch failed for ${position}: ${res.status}`)
  }
  return (await res.json()) as SleeperProjectionRow[]
}

interface UpdateRow {
  id: string
  projected_pts_ppr: number | null
  projected_pts_standard: number | null
  projected_pts_half_ppr: number | null
  projected_games: number | null
  projections_season: number
  projections_updated_at: string
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function fetchKnownPlayerIds(): Promise<Set<string>> {
  const known = new Set<string>()
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('id')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const r of data) known.add(r.id as string)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return known
}

async function main() {
  console.log(`Syncing Sleeper projections for ${SEASON}…`)
  const known = await fetchKnownPlayerIds()
  console.log(`  ${known.size} players in DB`)

  const updates = new Map<string, UpdateRow>()
  const now = new Date().toISOString()
  let skippedNoMatch = 0
  let skippedNoPoints = 0

  for (const pos of POSITIONS) {
    process.stdout.write(`  fetching ${pos}…`)
    const rows = await fetchProjections(pos)
    process.stdout.write(` ${rows.length} rows`)

    let usedRows = 0
    for (const row of rows) {
      const id = row.player_id
      if (!known.has(id)) {
        skippedNoMatch++
        continue
      }
      const ppr = toNullableNumber(row.stats?.pts_ppr)
      const std = toNullableNumber(row.stats?.pts_std)
      const half = toNullableNumber(row.stats?.pts_half_ppr)
      if (ppr === null && std === null && half === null) {
        skippedNoPoints++
        continue
      }

      // Sleeper sometimes returns multiple rows per player (different
      // companies). Take the entry that has the largest non-null PPR value
      // — it's overwhelmingly the rotowire row, which is consistent across
      // positions. If a more sophisticated tiebreaker is ever needed,
      // surface `company` and pick deterministically.
      const existing = updates.get(id)
      if (existing && (existing.projected_pts_ppr ?? 0) >= (ppr ?? 0)) continue

      updates.set(id, {
        id,
        projected_pts_ppr: ppr,
        projected_pts_standard: std,
        projected_pts_half_ppr: half,
        projected_games: toNullableNumber(row.stats?.gp),
        projections_season: SEASON,
        projections_updated_at: now,
      })
      usedRows++
    }
    process.stdout.write(` (${usedRows} used)\n`)
  }

  console.log(`\n  total players w/ projections: ${updates.size}`)
  console.log(`  skipped (no DB match): ${skippedNoMatch}`)
  console.log(`  skipped (no points): ${skippedNoPoints}`)

  // Updates are independent rows — chunk to keep payloads reasonable.
  const all = Array.from(updates.values())
  const BATCH = 200
  let written = 0
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH)
    // Per-row update so we don't clobber unrelated columns on `players`.
    await Promise.all(
      batch.map((row) =>
        supabase
          .from('players')
          .update({
            projected_pts_ppr: row.projected_pts_ppr,
            projected_pts_standard: row.projected_pts_standard,
            projected_pts_half_ppr: row.projected_pts_half_ppr,
            projected_games: row.projected_games,
            projections_season: row.projections_season,
            projections_updated_at: row.projections_updated_at,
          })
          .eq('id', row.id),
      ),
    )
    written += batch.length
    process.stdout.write(`\r  wrote ${written}/${all.length}`)
  }
  process.stdout.write('\n')
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
