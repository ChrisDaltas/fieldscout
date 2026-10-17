/**
 * sync:combine — each player's NFL Combine 40-yard dash onto
 * `players.forty_time` (F578, migration 195; PROGRESS D540).
 *
 * Sources (free, plain fetch — the RSS/YouTube-style "no scraping service"
 * rule; both are published files):
 *   - nflverse `combine.csv` (every Combine since 2000: `pfr_id`, `forty`);
 *   - DynastyProcess `db_playerids.csv` (the community id crosswalk:
 *     `sleeper_id` → `pfr_id`). `players.id` is Sleeper-keyed (§23.1).
 *
 * Never a guess: a player is matched ONLY through the crosswalk (no name
 * matching). A Sleeper id the crosswalk lists twice with different PFR ids,
 * or a PFR id with two different Combine forties, is AMBIGUOUS — no value,
 * named in the report. No match / did not run → NULL. The sync converges:
 * it writes exactly the rows whose stored value differs, and asserts every
 * update touched its row (CLAUDE.md: 0 rows is not success).
 */
import { parseCsv, requireColumns, toObjects } from '@/lib/leagues/stats/nflverse/csv'

import { pageAll, type SyncClient, type SyncSummary } from './types'

export const COMBINE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv'
export const PLAYER_IDS_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'

const blank = (v: string | undefined) => v === undefined || v === '' || v === 'NA'

export interface FortyMap {
  /** Sleeper id → 40 time (seconds). */
  bySleeperId: Map<string, number>
  /** Sleeper ids left out because a source disagreed with itself. */
  ambiguous: string[]
}

/** Pure: the two CSV texts → Sleeper id → forty. */
export function buildFortyMap(playerIdsCsv: string, combineCsv: string): FortyMap {
  const ids = parseCsv(playerIdsCsv)
  requireColumns(ids, ['sleeper_id', 'pfr_id'], 'db_playerids.csv')
  const combine = parseCsv(combineCsv)
  requireColumns(combine, ['pfr_id', 'forty'], 'combine.csv')

  const fortyByPfr = new Map<string, number | 'conflict'>()
  for (const r of toObjects(combine)) {
    if (blank(r.pfr_id) || blank(r.forty)) continue
    const t = Number(r.forty)
    if (!Number.isFinite(t) || t <= 3.5 || t >= 7) continue // 195's CHECK — a typo is not a time
    const prior = fortyByPfr.get(r.pfr_id)
    fortyByPfr.set(r.pfr_id, prior === undefined || prior === t ? t : 'conflict')
  }

  const pfrBySleeper = new Map<string, string | 'conflict'>()
  for (const r of toObjects(ids)) {
    if (blank(r.sleeper_id) || blank(r.pfr_id)) continue
    const prior = pfrBySleeper.get(r.sleeper_id)
    pfrBySleeper.set(r.sleeper_id, prior === undefined || prior === r.pfr_id ? r.pfr_id : 'conflict')
  }

  const bySleeperId = new Map<string, number>()
  const ambiguous: string[] = []
  for (const [sleeperId, pfr] of pfrBySleeper) {
    if (pfr === 'conflict') {
      ambiguous.push(sleeperId)
      continue
    }
    const t = fortyByPfr.get(pfr)
    if (t === 'conflict') ambiguous.push(sleeperId)
    else if (t !== undefined) bySleeperId.set(sleeperId, t)
  }
  return { bySleeperId, ambiguous: ambiguous.sort() }
}

/** The sync: fetch both files, then converge `players.forty_time`. */
export async function syncCombine(db: SyncClient, fetchText: (url: string) => Promise<string>): Promise<SyncSummary> {
  const [idsCsv, combineCsv] = await Promise.all([fetchText(PLAYER_IDS_URL), fetchText(COMBINE_URL)])
  const map = buildFortyMap(idsCsv, combineCsv)
  if (map.bySleeperId.size === 0) throw new Error('combine: the sources matched no player — refusing to clear every 40 time')

  const players = await pageAll<{ id: string; forty_time: number | string | null }>((from, to) =>
    db.from('players').select('id, forty_time', { count: 'exact' }).order('id').range(from, to),
  )
  let written = 0
  let cleared = 0
  let unchanged = 0
  let matched = 0
  for (const p of players) {
    const want = map.bySleeperId.get(p.id) ?? null
    if (want !== null) matched += 1
    const have = p.forty_time === null ? null : Number(p.forty_time)
    if (have === want) {
      unchanged += 1
      continue
    }
    const { data, error } = await db.from('players').update({ forty_time: want }).eq('id', p.id).select('id')
    if (error) throw new Error(`players ${p.id}: ${error.message}`)
    if ((data ?? []).length !== 1) throw new Error(`players ${p.id}: the update touched ${(data ?? []).length} rows, not 1`)
    if (want === null) cleared += 1
    else written += 1
  }
  return {
    name: 'combine',
    counts: { players: players.length, matched, written, cleared, unchanged, ambiguous: map.ambiguous.length },
    warnings: map.ambiguous.length > 0 ? [`ambiguous ids left without a 40 time: ${map.ambiguous.slice(0, 10).join(', ')}${map.ambiguous.length > 10 ? ', …' : ''}`] : [],
  }
}
