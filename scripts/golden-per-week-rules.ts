/**
 * golden-per-week-rules.ts — the L.E1.27 golden BEFORE / AFTER (M6A, migration
 * 144; PROGRESS F397 / Q69 / D382). LOCAL STACK ONLY — refuses any other URL.
 *
 *   npx tsx scripts/golden-per-week-rules.ts
 *
 * The corpus: every player line of the REAL recorded Sleeper 2025 week 2
 * (`fixtures/nfl/2025/wk02/sleeper.jsonl.gz`, 373 lines) through ingestion's
 * own `toStatRow`, positions from the local `players` pool, scored by the
 * worker's own `scoreStarter` under each of the eight templates.
 *
 * BEFORE = main's reader: every week scored under the league's CURRENT
 * snapshot. AFTER = this branch's: every week under `weekScoringRules(its
 * league_weeks row)`, the rules 144's trigger stamped when the week opened.
 *   PART A — no scoring change: weeks 1–3 opened on template T. Every cell
 *            must be IDENTICAL (points and pending keys).
 *   PART B — then the league moves to T2 (a change with re-score off —
 *            a plain re-freeze), and week 4 opens. The ONLY cells allowed to
 *            differ are weeks 1–3 (they keep T — the ruling), and only where
 *            T and T2 score the line differently; week 4 must be identical.
 * Writes scratch leagues named `golden-pwr-*` and deletes them after.
 */
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'
import { parseFixture } from '@/lib/leagues/stats/fixtures/fixture-format'
import type { ProviderPlayerWeekStats } from '@/lib/leagues/stats/stats-provider'
import { normalizePosition, scoreStarter, type StatLineRow, weekScoringRules } from '@/lib/leagues/scoring/score-week-worker'
import type { ScoringRulesDoc } from '@/lib/leagues/scoring/rules-doc'
import { toStatRow } from '@/lib/sync/ingest-week'

const URL = 'http://127.0.0.1:54321'
const KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const PREFIX = 'golden-pwr'
const SEASON = 2026

const db = createClient<Database>(URL, KEY, { auth: { persistSession: false } })

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function cleanup(): Promise<void> {
  const leagues = await must(db.from('leagues').select('id').like('name', `${PREFIX}-%`), 'stale leagues')
  const ids = (leagues ?? []).map((l) => l.id)
  if (ids.length === 0) return
  await must(db.from('league_weeks').delete().in('league_id', ids), 'cleanup weeks')
  await must(db.from('leagues').delete().in('id', ids), 'cleanup leagues')
}

function key(points: number, pending: readonly string[]): string {
  return `${points}|${[...pending].sort().join(',')}`
}

async function main(): Promise<void> {
  console.log(`target: ${URL} (local only)`)
  const recording = parseFixture(gunzipSync(readFileSync('fixtures/nfl/2025/wk02/sleeper.jsonl.gz')).toString('utf8'))
  const lines = recording.entries.find((e) => e.method === 'getWeekStats')!.body as ProviderPlayerWeekStats[]
  const players = new Map<string, string>()
  for (let i = 0; i < lines.length; i += 150) {
    const ids = lines.slice(i, i + 150).map((l) => l.playerId)
    for (const p of (await must(db.from('players').select('id, position').in('id', ids), 'players')) ?? []) players.set(p.id, normalizePosition(p.position))
  }
  const corpus: Array<{ id: string; position: string; row: StatLineRow }> = []
  let noPlayer = 0
  let noRow = 0
  for (const l of lines) {
    const position = players.get(l.playerId)
    if (!position) {
      noPlayer += 1
      continue
    }
    const { row } = toStatRow(l, { gameStatus: new Map(), anyGameOpen: false, providerName: 'sleeper' })
    if (!row) {
      noRow += 1
      continue
    }
    // The `player_stats` row as the worker reads it: the column surface + `advanced`.
    corpus.push({ id: l.playerId, position, row: { player_id: l.playerId, updated_at: '2025-09-15T00:00:00Z', advanced: row.advanced, ...row.columns } })
  }
  console.log(`corpus: ${lines.length} recorded lines → ${corpus.length} scored (${noPlayer} not in the local pool, ${noRow} with nothing storable)`)
  // R1156: a golden that checked nothing must never print OK — an empty local pool (e.g. straight after `db reset`) scores 0 lines.
  if (corpus.length < 300) throw new Error(`golden: only ${corpus.length} of ${lines.length} recorded lines are scorable — run \`RESTORE_SCOPE=draft npm run restore:dev\` first (R1156)`)

  await cleanup()
  const owner = (await must(db.from('profiles').select('id').limit(1).single(), 'owner'))!.id
  const templates = await must(db.from('scoring_systems').select('id, name, rules').eq('is_template', true).order('name'), 'templates')
  let totalA = 0
  let changedA = 0
  let totalB = 0
  let changedB = 0
  let unexplainedB = 0
  let week4Changed = 0
  for (const t of templates!) {
    const t2 = templates!.find((x) => x.name === (t.name === 'ESPN Full PPR' ? 'ESPN Standard' : 'ESPN Full PPR'))!
    const league = await must(
      db.from('leagues').insert({ owner_id: owner, name: `${PREFIX}-${t.name}`, season: SEASON, status: 'in_season', scoring_system_id: t.id, scoring_rules_snapshot: t.rules as Json }).select('id').single(),
      `league ${t.name}`,
    )
    const leagueId = league!.id
    await must(db.from('league_weeks').insert([1, 2, 3, 4].map((week) => ({ league_id: leagueId, season: SEASON, week }))), 'weeks')
    // weeks 1-3 OPEN on T (the trigger stamps them); week 1 final, week 2 correction_window, week 3 live.
    for (const [week, steps] of [[1, ['live', 'correction_window', 'final']], [2, ['live', 'correction_window']], [3, ['live']]] as const) {
      for (const status of steps) await must(db.from('league_weeks').update({ status }).eq('league_id', leagueId).eq('week', week), `week ${week} → ${status}`)
    }
    const readWeeks = async () => must(db.from('league_weeks').select('week, status, scoring_rules_snapshot').eq('league_id', leagueId).order('week'), 'weeks read')
    const readLeague = async () => (await must(db.from('leagues').select('scoring_rules_snapshot').eq('id', leagueId).single(), 'league read'))!.scoring_rules_snapshot

    // PART A — no change: BEFORE (league column) vs AFTER (the week's stamped rules).
    let leagueDoc = await readLeague()
    let tChangedA = 0
    for (const w of (await readWeeks())!.filter((x) => x.week <= 3)) {
      const after = weekScoringRules(w, leagueDoc)
      for (const c of corpus) {
        const b = scoreStarter(leagueDoc as ScoringRulesDoc, c.id, c.position, c.row)
        const a = scoreStarter(after, c.id, c.position, c.row)
        totalA += 1
        if (key(b.points, b.pending) !== key(a.points, a.pending)) {
          changedA += 1
          tChangedA += 1
        }
      }
    }

    // PART B — the league moves to T2 (re-freeze, re-score off); week 4 opens on T2.
    await must(db.from('leagues').update({ scoring_system_id: t2.id, scoring_rules_snapshot: t2.rules as Json }).eq('id', leagueId), 'change')
    await must(db.from('league_weeks').update({ status: 'live' }).eq('league_id', leagueId).eq('week', 4), 'week 4 opens')
    leagueDoc = await readLeague()
    let tChanged = 0
    for (const w of (await readWeeks())!) {
      const after = weekScoringRules(w, leagueDoc)
      for (const c of corpus) {
        const b = scoreStarter(leagueDoc as ScoringRulesDoc, c.id, c.position, c.row)
        const a = scoreStarter(after, c.id, c.position, c.row)
        totalB += 1
        if (key(b.points, b.pending) === key(a.points, a.pending)) continue
        changedB += 1
        tChanged += 1
        if (w.week === 4) week4Changed += 1
        // Explained iff AFTER is exactly T's score and BEFORE exactly T2's (the kept week keeps T).
        const underT = scoreStarter(t.rules as ScoringRulesDoc, c.id, c.position, c.row)
        const underT2 = scoreStarter(t2.rules as ScoringRulesDoc, c.id, c.position, c.row)
        if (key(a.points, a.pending) !== key(underT.points, underT.pending) || key(b.points, b.pending) !== key(underT2.points, underT2.pending)) unexplainedB += 1
      }
    }
    console.log(`  ${t.name.padEnd(18)} → ${t2.name.padEnd(14)}  A: ${3 * corpus.length} cells, ${tChangedA} changed | B: ${4 * corpus.length} cells, ${tChanged} changed (weeks 1–3 keep ${t.name}; week 4 on ${t2.name})`)
  }
  await cleanup()
  console.log(`PART A (no change): ${totalA} cells, ${changedA} changed`)
  console.log(`PART B (a change, re-score off): ${totalB} cells, ${changedB} changed — all in weeks 1–3 (week 4 changed: ${week4Changed}); unexplained: ${unexplainedB}`)
  if (totalA === 0 || totalB === 0 || changedA !== 0 || week4Changed !== 0 || unexplainedB !== 0) {
    console.error('GOLDEN FAILED')
    process.exit(1)
  }
  console.log('GOLDEN OK')
}

main().catch(async (err) => {
  console.error(err)
  await cleanup().catch(() => undefined)
  process.exit(1)
})
