/**
 * Sanity check: print top 15 players by VORP and by raw projected points
 * so we can eyeball that the scarcity-aware order looks right.
 *   npx tsx scripts/preview-vorp.ts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import { rankByVorp, type VorpPosition } from '../src/lib/scoring/vorp'

config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

async function main() {
  const all: Array<{
    id: string
    full_name: string
    position: string
    team: string | null
    projected_pts_ppr: number | null
  }> = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('players')
      .select('id, full_name, position, team, projected_pts_ppr')
      .not('team', 'is', null)
      .in('position', ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    for (const r of data) all.push(r as typeof all[number])
    if (data.length < 1000) break
    offset += 1000
  }
  console.log('total:', all.length)

  const ranked = rankByVorp(
    all.map((p) => ({
      id: p.id,
      position: p.position as VorpPosition,
      projected_pts: p.projected_pts_ppr,
    })),
  )
  const lookup = new Map(all.map((p) => [p.id, p]))

  console.log('\nTop 15 by VORP (scarcity-aware):')
  for (let i = 0; i < 15; i++) {
    const r = ranked[i]
    const p = lookup.get(r.id)!
    console.log(
      `  ${String(i + 1).padStart(2)}. ${p.position.padEnd(3)} ${p.full_name.padEnd(22)} ${p.team ?? '   '}  proj=${r.projected_pts.toFixed(1).padStart(6)}  vorp=${r.vorp.toFixed(1).padStart(6)}`,
    )
  }

  console.log('\nTop 15 by raw projected points:')
  const rawSorted = [...all]
    .filter((p) => typeof p.projected_pts_ppr === 'number')
    .sort((a, b) => (b.projected_pts_ppr ?? 0) - (a.projected_pts_ppr ?? 0))
  for (let i = 0; i < 15; i++) {
    const p = rawSorted[i]
    console.log(
      `  ${String(i + 1).padStart(2)}. ${p.position.padEnd(3)} ${p.full_name.padEnd(22)} ${p.team ?? '   '}  proj=${(p.projected_pts_ppr ?? 0).toFixed(1).padStart(6)}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
