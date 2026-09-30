/**
 * diff:fixtures — name every change between a week's two recorded snapshots
 * (M6 L.E2.5, tasks-M6 §6; spec §23.4; PROGRESS D458). Pure file work: no
 * network, no database.
 *
 *   npm run diff:fixtures -- --season 2026 --week 3                 (prints)
 *   npm run diff:fixtures -- --season 2026 --week 3 --write         (also writes the week's snapshot-diff.txt; refuses to replace one without --overwrite)
 *
 * Reads fixtures/nfl/<season>/wk<NN>/<provider>.final.jsonl.gz and
 * <provider>.window-end.jsonl.gz (written by `record:fixtures --snapshot`),
 * their `.lines.json` sidecars when present, and production-events.json when
 * present (`export:correction-events --write` — production's events to
 * cross-check against, and the instants production first saw each game
 * final: F528's clock). `--provider` picks the provider prefix (default
 * `sleeper+nflverse`, what the recorder's snapshot mode binds).
 *
 * The diff never invents a change: it reads only the two recorded bodies,
 * and a snapshot missing a successful read of the week's lines THROWS
 * (correction-snapshot-diff.ts). Exit 0 with or without changes — a week with
 * none prints so, in words. It loads no `.env.local` and reaches no database
 * (R1379 — a local `fail`, not `_sync-cli`'s, which loads the env on import).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { parseFixture } from '../src/lib/leagues/stats/fixtures/fixture-format'
import type { ExportedEvent } from './correction-events-export'
import {
  diffSnapshots,
  renderSettleProfile,
  renderSnapshotDiff,
  settleProfile,
  type FinalSeenGame,
  type LinesSidecar,
  type Snapshot,
} from './correction-snapshot-diff'

function fail(err: unknown): never {
  console.error(err)
  process.exit(1)
}

function flag(name: string): string | undefined {
  const args = process.argv.slice(2)
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} needs a value`)
    process.exit(2)
  }
  return value
}

function intFlag(name: string, lo: number, hi: number): number {
  const raw = flag(name)
  const n = Number(raw)
  if (raw === undefined || !Number.isInteger(n) || n < lo || n > hi) {
    console.error('usage: npm run diff:fixtures -- --season <yyyy> --week <n> [--provider <name>] [--write [--overwrite]] [--profile-only]')
    process.exit(2)
  }
  return n
}

function loadSnapshot(dir: string, provider: string, label: string): Snapshot {
  const path = resolve(dir, `${provider}.${label}.jsonl.gz`)
  if (!existsSync(path)) throw new Error(`no "${label}" snapshot at ${path} — record it with record:fixtures --snapshot ${label}`)
  const recording = parseFixture(gunzipSync(readFileSync(path)).toString('utf8'))
  const linesPath = resolve(dir, `${provider}.${label}.lines.json`)
  const lines = existsSync(linesPath) ? (JSON.parse(readFileSync(linesPath, 'utf8')) as LinesSidecar) : null
  return { label, recording, lines }
}

function main(): void {
  const season = intFlag('--season', 2000, 2100)
  const week = intFlag('--week', 1, 22)
  const provider = flag('--provider') ?? 'sleeper+nflverse'
  const dir = resolve(process.cwd(), `fixtures/nfl/${season}/wk${String(week).padStart(2, '0')}`)
  const first = loadSnapshot(dir, provider, 'final')
  const profileOnly = process.argv.includes('--profile-only')
  const second = profileOnly ? null : loadSnapshot(dir, provider, 'window-end')

  const prodPath = resolve(dir, 'production-events.json')
  let finalSeen: FinalSeenGame[] | null = null
  let events: ExportedEvent[] | null = null
  if (existsSync(prodPath)) {
    const prod = JSON.parse(readFileSync(prodPath, 'utf8')) as { games: FinalSeenGame[]; events: ExportedEvent[]; readAt: string }
    finalSeen = prod.games
    events = prod.events
    console.log(`(production-events.json read at ${prod.readAt}: ${prod.events.length} events, ${prod.games.length} games)`)
  } else {
    console.log('(no production-events.json — first-seen-final instants are the recorder\'s own bounds; no production cross-check)')
  }

  if (second === null) {
    // --profile-only: F528's settle profile of the "final" snapshot alone
    // (before its window-end pair exists) — no diff is claimed.
    if (!finalSeen) throw new Error('--profile-only needs production-events.json (its games carry the first-seen-final instants)')
    for (const line of renderSettleProfile(settleProfile(first, finalSeen), first.label)) console.log(line)
    return
  }
  const diff = diffSnapshots(first, second, { finalSeen, events })
  const out = renderSnapshotDiff(diff)
  if (finalSeen) {
    for (const snap of [first, second]) out.push(...renderSettleProfile(settleProfile(snap, finalSeen), snap.label))
  }
  for (const line of out) console.log(line)

  if (process.argv.includes('--write')) {
    const outPath = resolve(dir, 'snapshot-diff.txt')
    // R1380: a committed diff is never replaced by accident.
    if (existsSync(outPath) && !process.argv.includes('--overwrite')) {
      console.error(`--write refused: ${outPath} exists (add --overwrite to replace it)`)
      process.exit(1)
    }
    writeFileSync(outPath, out.join('\n') + '\n')
    console.log(`Wrote ${outPath}`)
  }
}

try {
  main()
} catch (err) {
  fail(err)
}
