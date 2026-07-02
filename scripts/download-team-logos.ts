/**
 * Download all 32 NFL team logos from Sleeper's CDN into `nfl team logos/`
 * at the project root. Files are named `<TEAM>.png` (e.g. `BAL.png`).
 *
 *   npx tsx scripts/download-team-logos.ts
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT_DIR = resolve(process.cwd(), 'nfl team logos')

const TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB',  'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV',  'MIA', 'MIN', 'NE',  'NO',  'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF',  'TB',  'TEN', 'WAS',
]

async function downloadOne(team: string): Promise<{ ok: boolean; reason?: string }> {
  const url = `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`
  const dest = resolve(OUT_DIR, `${team}.png`)
  if (existsSync(dest)) return { ok: true, reason: 'cached' }
  try {
    const res = await fetch(url)
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`→ ${OUT_DIR}\n`)

  const results = await Promise.all(TEAMS.map(async (t) => [t, await downloadOne(t)] as const))

  let downloaded = 0
  let cached = 0
  const failures: Array<{ team: string; reason: string }> = []
  for (const [team, res] of results) {
    if (res.ok) {
      if (res.reason === 'cached') cached++
      else downloaded++
    } else {
      failures.push({ team, reason: res.reason ?? 'unknown' })
    }
  }

  console.log(`Downloaded: ${downloaded}`)
  console.log(`Cached:     ${cached}`)
  console.log(`Failed:     ${failures.length}`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  ${f.team} — ${f.reason}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
