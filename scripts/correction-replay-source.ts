/**
 * correction-replay-source — which REAL captured correction the L.E2.6
 * replay proof replays, if any (M6 L.E2.6; PROGRESS D468 — Chris
 * 2026-10-02, "yeah lets not hold for it": the real-capture leg is
 * NON-BLOCKING). Reads only committed files; no network, no database.
 *
 * For every `wkNN/` under the capture root (`fixtures/nfl/2026/` by default)
 * it looks for L.E2.5's pair — `<provider>.final.jsonl.gz` and
 * `<provider>.window-end.jsonl.gz` — and the committed `snapshot-diff.txt`.
 * Where all three exist it RE-RUNS the diff (`diffSnapshots`, the same pure
 * code `diff:fixtures` ran, with `production-events.json` when present) and
 * keeps the changes that are a correction production would record: a
 * SCORABLE key, final at snapshot 1 on production's arm, settle-grace
 * verdict `outside`, an updated line with both values known. Each such
 * change must also be named in the committed `snapshot-diff.txt` (its
 * player id and stat key) — a committed record that disagrees with its own
 * files THROWS rather than being replayed or ignored.
 *
 * It never invents a correction (L.E2.5's rule): with none it says so, per
 * week, in plain words, and the replay proof runs on the synthetic pair
 * alone.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import type { ReplayPair } from '../src/lib/leagues/scoring/correction-replay'
import { parseFixture } from '../src/lib/leagues/stats/fixtures/fixture-format'
import type { ExportedEvent } from './correction-events-export'
import { diffSnapshots, type FinalSeenGame, type LinesSidecar, type Snapshot, type SnapshotChange } from './correction-snapshot-diff'

export const CAPTURE_PROVIDER = 'sleeper+nflverse'

export type CaptureWeekVerdict = 'replayable' | 'no_pair' | 'no_diff_record' | 'no_outside_change'

export interface CaptureWeekStatus {
  dir: string
  week: number
  verdict: CaptureWeekVerdict
  sentence: string
  candidates: SnapshotChange[]
}

export interface CaptureScan {
  root: string
  weeks: CaptureWeekStatus[]
  /** The first replayable change (a production-matched one preferred), as a pair; null when none. */
  pick: ReplayPair | null
  /** One plain sentence for the test log. */
  sentence: string
}

function loadSnapshot(dir: string, provider: string, label: string): Snapshot {
  const recording = parseFixture(gunzipSync(readFileSync(resolve(dir, `${provider}.${label}.jsonl.gz`))).toString('utf8'))
  const linesPath = resolve(dir, `${provider}.${label}.lines.json`)
  const lines = existsSync(linesPath) ? (JSON.parse(readFileSync(linesPath, 'utf8')) as LinesSidecar) : null
  return { label, recording, lines }
}

/** A correction production would record (see the header). */
export function isReplayableChange(c: SnapshotChange): boolean {
  return c.surface === 'scorable' && c.finalAtFirst && c.grace === 'outside' && c.line === 'updated' && c.old !== null && c.new !== null
}

export function scanCapturedCorrections(root: string, provider: string = CAPTURE_PROVIDER): CaptureScan {
  const weeks: CaptureWeekStatus[] = []
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^wk\d{2}$/.test(d)).sort() : []
  let pick: { change: SnapshotChange; first: Snapshot; second: Snapshot; dir: string } | null = null
  for (const d of dirs) {
    const dir = resolve(root, d)
    const week = Number(d.slice(2))
    const has = (label: string) => existsSync(resolve(dir, `${provider}.${label}.jsonl.gz`))
    if (!has('final') || !has('window-end')) {
      const held = ['final', 'window-end'].filter(has)
      weeks.push({ dir, week, verdict: 'no_pair', candidates: [], sentence: `week ${week}: no snapshot pair (${held.length === 0 ? 'no snapshot' : `only "${held.join('", "')}"`}) — nothing to replay yet` })
      continue
    }
    const diffPath = resolve(dir, 'snapshot-diff.txt')
    if (!existsSync(diffPath)) {
      weeks.push({ dir, week, verdict: 'no_diff_record', candidates: [], sentence: `week ${week}: both snapshots but no committed snapshot-diff.txt — run diff:fixtures --write first; not replayed` })
      continue
    }
    const first = loadSnapshot(dir, provider, 'final')
    const second = loadSnapshot(dir, provider, 'window-end')
    const prodPath = resolve(dir, 'production-events.json')
    const prod = existsSync(prodPath) ? (JSON.parse(readFileSync(prodPath, 'utf8')) as { games: FinalSeenGame[]; events: ExportedEvent[] }) : null
    const diff = diffSnapshots(first, second, { finalSeen: prod?.games ?? null, events: prod?.events ?? null })
    const candidates = diff.changes.filter(isReplayableChange)
    const record = readFileSync(diffPath, 'utf8')
    for (const c of candidates) {
      if (!record.includes(`id ${c.playerId})`) || !record.includes(c.statKey)) {
        throw new Error(`week ${week}: the diff names ${c.playerId} ${c.statKey} ${c.old} → ${c.new} (outside the grace) but the committed snapshot-diff.txt does not — re-run diff:fixtures --write --overwrite and commit it`)
      }
    }
    if (candidates.length === 0) {
      weeks.push({ dir, week, verdict: 'no_outside_change', candidates, sentence: `week ${week}: ${diff.changes.length} final-game change(s), none a scorable correction outside the settle grace — no real correction to replay (never fabricated)` })
      continue
    }
    weeks.push({ dir, week, verdict: 'replayable', candidates, sentence: `week ${week}: ${candidates.length} real scorable correction(s) outside the settle grace` })
    const best = candidates.find((c) => c.productionEvent !== null) ?? candidates[0]
    if (pick === null || (pick.change.productionEvent === null && best.productionEvent !== null)) pick = { change: best, first, second, dir }
  }
  if (pick === null) {
    const detail = weeks.length === 0 ? `no capture under ${root}` : weeks.map((w) => w.sentence).join('; ')
    return { root, weeks, pick: null, sentence: `NO REAL 2026 CORRECTION CAPTURED YET — ${detail}. The replay proof runs on the synthetic pair only (Chris 2026-10-02, D468); F540 stays open.` }
  }
  const c = pick.change
  if (c.position === null) throw new Error(`the real correction ${c.playerId} ${c.statKey} has no position in its sidecar — cannot seat him`)
  const pair: ReplayPair = {
    origin: 'real',
    label: `${pick.dir} (${provider})`,
    first: pick.first.recording,
    second: pick.second.recording,
    change: { playerId: c.playerId, statKey: c.statKey, old: c.old!, new: c.new!, name: c.name ?? `player ${c.playerId}`, position: c.position, nflTeam: c.team },
  }
  return { root, weeks, pick: pair, sentence: `REAL 2026 CORRECTION REPLAYED: ${pair.change.name} (${c.playerId}) ${c.statKey} ${c.old} → ${c.new}, ${pair.label}${c.productionEvent ? ' — production recorded it' : ''}` }
}
