import { fetchKnownPlayerIds } from './projections'
import { num, type SyncClient, type SyncSummary } from './types'

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
type Position = (typeof POSITIONS)[number]

interface SleeperStatsRow {
  player_id: string
  team: string | null
  stats: {
    off_snp?: number | null
    tm_off_snp?: number | null
    rec_tgt?: number | null
    pass_att?: number | null
  } | null
}

async function fetchSeasonStats(
  season: number,
  position: Position,
): Promise<SleeperStatsRow[]> {
  const url = `https://api.sleeper.com/stats/nfl/${season}?season_type=regular&position[]=${position}&order_by=pts_half_ppr`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Stats fetch failed for ${position}: ${res.status}`)
  }
  return (await res.json()) as SleeperStatsRow[]
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Usage rates from season stats: snap_pct = off_snp / tm_off_snp;
 * target_share = rec_tgt / team pass attempts (derived by summing pass_att
 * across the team's players). Usage is a look-back stat — pre-draft callers
 * pass last season; in-season the current one.
 */
export async function syncUsage(
  supabase: SyncClient,
  statsSeason: number,
): Promise<SyncSummary> {
  const rows: SleeperStatsRow[] = []
  for (const pos of POSITIONS) {
    rows.push(...(await fetchSeasonStats(statsSeason, pos)))
  }

  const teamPassAtt = new Map<string, number>()
  for (const row of rows) {
    const att = num(row.stats?.pass_att)
    if (!row.team || !att) continue
    teamPassAtt.set(row.team, (teamPassAtt.get(row.team) ?? 0) + att)
  }

  interface UsageRow {
    id: string
    snap_pct: number | null
    target_share: number | null
  }
  const updates = new Map<string, UsageRow>()
  for (const row of rows) {
    const offSnp = num(row.stats?.off_snp)
    const tmOffSnp = num(row.stats?.tm_off_snp)
    const targets = num(row.stats?.rec_tgt)
    const teamAtt = row.team ? teamPassAtt.get(row.team) : undefined

    const snapPct =
      offSnp !== null && tmOffSnp !== null && tmOffSnp > 0
        ? round1((offSnp / tmOffSnp) * 100)
        : null
    const targetShare =
      targets !== null && teamAtt && teamAtt > 0
        ? round1((targets / teamAtt) * 100)
        : null
    if (snapPct === null && targetShare === null) continue

    // Multiple rows per player (companies); keep the most complete picture.
    const existing = updates.get(row.player_id)
    if (existing && (existing.snap_pct ?? -1) >= (snapPct ?? -1)) continue
    updates.set(row.player_id, {
      id: row.player_id,
      snap_pct: snapPct,
      target_share: targetShare,
    })
  }

  // One shared per-season source (player_usage) — Big Board and Research
  // read the same rows; a new season never overwrites the previous one.
  const known = await fetchKnownPlayerIds(supabase)

  const now = new Date().toISOString()
  const rowsToWrite = Array.from(updates.values())
    .filter((row) => known.has(row.id))
    .map((row) => ({
      player_id: row.id,
      season: statsSeason,
      snap_pct: row.snap_pct,
      target_share: row.target_share,
      updated_at: now,
    }))
  const skippedNoMatch = updates.size - rowsToWrite.length

  const BATCH = 500
  let written = 0
  for (let i = 0; i < rowsToWrite.length; i += BATCH) {
    const batch = rowsToWrite.slice(i, i + BATCH)
    const { error } = await supabase
      .from('player_usage')
      .upsert(batch, { onConflict: 'player_id,season' })
    if (error) throw new Error(`usage upsert failed: ${error.message}`)
    written += batch.length
  }

  return {
    name: 'usage',
    counts: { written, skippedNoMatch, statsSeason },
    warnings: [],
  }
}
