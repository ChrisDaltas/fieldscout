/**
 * Download the top 300 NFL player headshots (by 2026 PPR projection) into
 * `player thumbnail headshots/` in the project root.
 *
 *   npx tsx scripts/download-top300-headshots.ts
 *
 * Files are named `001 - Allen QB.jpg` so they sort by rank in Finder and
 * drag into Figma in the right order.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const OUT_DIR = resolve(process.cwd(), 'player thumbnail headshots')

interface Player {
  full_name: string
  position: string | null
  headshot_url: string
}

function safeLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
  // Strip filesystem-unfriendly chars; keep letters, digits, dash, period.
  return last.replace(/[^A-Za-z0-9.\- ]/g, '').trim()
}

async function downloadOne(
  rank: number,
  player: Player,
): Promise<{ ok: boolean; reason?: string }> {
  const last = safeLastName(player.full_name)
  const pos = player.position ?? '??'
  const name = `${String(rank).padStart(3, '0')} - ${last} ${pos}.jpg`
  const dest = resolve(OUT_DIR, name)
  if (existsSync(dest)) return { ok: true, reason: 'cached' }

  try {
    const res = await fetch(player.headshot_url)
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(dest, buf)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`→ ${OUT_DIR}\n`)

  const { data, error } = await supabase
    .from('players')
    .select('full_name, position, headshot_url, projected_pts_ppr')
    .not('team', 'is', null)
    .not('headshot_url', 'is', null)
    .order('projected_pts_ppr', { ascending: false, nullsFirst: false })
    .limit(300)
  if (error) throw error
  if (!data) throw new Error('No data')

  const players = data as Player[]
  console.log(`Downloading ${players.length} headshots…`)

  const failures: Array<{ rank: number; name: string; reason: string }> = []
  let downloaded = 0
  let cached = 0

  const CHUNK = 25
  for (let i = 0; i < players.length; i += CHUNK) {
    const slice = players.slice(i, i + CHUNK)
    const results = await Promise.all(
      slice.map((p, j) => downloadOne(i + j + 1, p)),
    )
    results.forEach((res, j) => {
      const rank = i + j + 1
      const p = slice[j]
      if (res.ok) {
        if (res.reason === 'cached') cached++
        else downloaded++
      } else {
        failures.push({ rank, name: p.full_name, reason: res.reason ?? 'unknown' })
      }
    })
    process.stdout.write('.')
  }
  console.log('')

  console.log(`\nDownloaded: ${downloaded}`)
  console.log(`Cached:     ${cached}`)
  console.log(`Failed:     ${failures.length}`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      console.log(`  #${f.rank} ${f.name} — ${f.reason}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
