/**
 * correction-replay.test.ts — the pure half of M6 L.E2.6's replay harness
 * (`correction-replay.ts`) and the real-capture scan
 * (`scripts/correction-replay-source.ts`). The stack half is
 * `correction-replay-db.test.ts`.
 *
 * The scan cells write a SYNTHETIC pair into an OS temp directory shaped like
 * a capture root — never into `fixtures/nfl/` (only real captures live
 * there) — and once read the real root as committed.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { afterAll, describe, expect, it } from 'vitest'

import { serializeFixture } from '@/lib/leagues/stats/fixtures/fixture-format'

import { diffSnapshots, renderSnapshotDiff } from '../../../../scripts/correction-snapshot-diff'
import { scanCapturedCorrections } from '../../../../scripts/correction-replay-source'
import { buildSyntheticCorrectionPair, SYNTHETIC_PROVIDER } from './__fixtures__/correction-replay-synthetic'
import { constructOpponentLine, lineOf, readReplaySnapshot, replayCalendar, ReplayPairProvider, slotForPosition } from './correction-replay'

const PAIR = buildSyntheticCorrectionPair('syn-wr')

describe('readReplaySnapshot — the calendar relabel; the values untouched', () => {
  it('maps the recorded week to week 1 (and the next to week 2) of the test season, prefixes game ids, keeps every stat value', () => {
    const s = readReplaySnapshot(PAIR.second, { season: 2080, gamePrefix: 'p-' })
    expect(s.games.map((g) => `${g.gameId} ${g.season} wk${g.week} ${g.status} ${(g.kickoffAt as Date).toISOString()}`)).toEqual([
      'p-syn-crp-w1 2080 wk1 final 2080-09-15T17:00:00.000Z',
      'p-syn-crp-w2 2080 wk2 scheduled 2080-09-20T00:15:00.000Z',
    ])
    expect(s.lines).toEqual([{ playerId: 'syn-wr', season: 2080, week: 1, stats: { receiving_yards: 94, receptions: 7 }, advanced: {} }])
    expect(s.t).toBe('2080-09-19T12:00:00.000Z')
  })

  it('a recording without a successful week-stats read THROWS (never an empty replay)', () => {
    const broken = { ...PAIR.first, entries: PAIR.first.entries.filter((e) => e.method !== 'getWeekStats') }
    expect(() => readReplaySnapshot(broken, { season: 2080, gamePrefix: 'p-' })).toThrow('no successful getWeekStats(2080,1)')
  })

  it('the window closes at the next week\'s first kickoff; a schedule without one THROWS', () => {
    const s = readReplaySnapshot(PAIR.first, { season: 2080, gamePrefix: '' })
    expect(replayCalendar(s).nextKickoff.toISOString()).toBe('2080-09-20T00:15:00.000Z')
    expect(() => replayCalendar({ ...s, games: s.games.filter((g) => g.week === 1) })).toThrow('no next-week kickoff')
  })
})

describe('constructOpponentLine — the one constructed line', () => {
  const s1 = readReplaySnapshot(PAIR.first, { season: 2080, gamePrefix: '' })
  const s2 = readReplaySnapshot(PAIR.second, { season: 2080, gamePrefix: '' })
  it('a change of 2+ units: the corrected value moved one unit back toward the old one — the matchup FLIPS', () => {
    const c = constructOpponentLine(lineOf(s1, 'syn-wr'), lineOf(s2, 'syn-wr'), 'receiving_yards', 'opp')
    expect([c.outcome, c.value, c.line.playerId, c.line.stats]).toEqual(['flip', 95, 'opp', { receiving_yards: 95, receptions: 7 }])
  })
  it('a change of exactly 1 unit: the old value — the matchup goes from a tie to a result', () => {
    const a = { ...lineOf(s1, 'syn-wr'), stats: { rushing_tds: 1 } }
    const b = { ...lineOf(s2, 'syn-wr'), stats: { rushing_tds: 0 } }
    expect(constructOpponentLine(a, b, 'rushing_tds', 'opp')).toMatchObject({ outcome: 'from_tie', value: 1 })
  })
  it('no change THROWS', () => {
    expect(() => constructOpponentLine(lineOf(s1, 'syn-wr'), lineOf(s1, 'syn-wr'), 'receiving_yards', 'opp')).toThrow('did not change')
  })
  it('a missing line THROWS (never a silent zero)', () => {
    expect(() => lineOf(s1, 'nobody')).toThrow('no line for nobody')
  })
})

describe('ReplayPairProvider', () => {
  it('serves snapshot 1, then snapshot 2, each with the constructed lines; its name says the origin', async () => {
    const s1 = readReplaySnapshot(PAIR.first, { season: 2080, gamePrefix: '' })
    const s2 = readReplaySnapshot(PAIR.second, { season: 2080, gamePrefix: '' })
    const opp = { playerId: 'opp', season: 2080, week: 1, stats: { receiving_yards: 95 }, advanced: {} }
    const p = new ReplayPairProvider({ 1: s1, 2: s2 }, [opp], 'synthetic', SYNTHETIC_PROVIDER)
    expect(p.name).toBe('replay:synthetic:synthetic:correction-replay')
    expect((await p.getWeekStats(2080, 1)).map((l) => `${l.playerId} ${l.stats.receiving_yards}`)).toEqual(['syn-wr 100', 'opp 95'])
    p.phase = 2
    expect((await p.getWeekStats(2080, 1)).map((l) => `${l.playerId} ${l.stats.receiving_yards}`)).toEqual(['syn-wr 94', 'opp 95'])
    expect(await p.getWeekStats(2080, 2)).toEqual([])
  })
  it('slots by position under the default roster; an unknown position THROWS', () => {
    expect(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(slotForPosition)).toEqual(['qb:0', 'rb:0', 'wr:0', 'te:0', 'k:0', 'dst:0'])
    expect(() => slotForPosition('LS')).toThrow('no default starting slot')
  })
})

describe('scanCapturedCorrections — the real-capture leg (non-blocking, D468)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'crp-scan-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  const provider = SYNTHETIC_PROVIDER
  /** A capture-shaped week dir holding the SYNTHETIC pair (in the temp dir only). */
  function week(name: string, opts: { pair?: boolean; diff?: 'right' | 'wrong' | 'none'; prod?: boolean }) {
    const dir = join(tmp, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${provider}.final.jsonl.gz`), gzipSync(serializeFixture(PAIR.first)))
    if (opts.pair !== false) writeFileSync(join(dir, `${provider}.window-end.jsonl.gz`), gzipSync(serializeFixture(PAIR.second)))
    const finalSeen = [{ week: 1, homeTeam: 'SYA', awayTeam: 'SYB', status: 'final', firstSeenFinalAt: '2080-09-15T20:30:00.000Z' }]
    if (opts.prod) writeFileSync(join(dir, 'production-events.json'), JSON.stringify({ games: finalSeen, events: [] }))
    const sidecar = (label: string, t: string) => ({ note: 'synthetic', season: 2080, week: 1, capturedAt: t, lines: { 'syn-wr': { name: 'Syn Receiver', position: 'WR', team: 'SYA', opponent: 'SYB', gameDate: '2080-09-15', lastModified: null } }, label })
    const s1 = sidecar('final', '2080-09-16T12:00:00.000Z')
    const s2 = sidecar('window-end', '2080-09-19T12:00:00.000Z')
    writeFileSync(join(dir, `${provider}.final.lines.json`), JSON.stringify(s1))
    if (opts.pair !== false) writeFileSync(join(dir, `${provider}.window-end.lines.json`), JSON.stringify(s2))
    if (opts.pair !== false && opts.diff !== 'none') {
      const d = diffSnapshots({ label: 'final', recording: PAIR.first, lines: s1 }, { label: 'window-end', recording: PAIR.second, lines: s2 }, { finalSeen: opts.prod ? finalSeen : null, events: opts.prod ? [] : null })
      const text = renderSnapshotDiff(d).join('\n')
      writeFileSync(join(dir, 'snapshot-diff.txt'), opts.diff === 'wrong' ? text.replaceAll('syn-wr', 'someone-else') : text)
    }
    return dir
  }

  it('the committed real root today: no pair anywhere — it SAYS SO and picks nothing', () => {
    const scan = scanCapturedCorrections(resolve(process.cwd(), 'fixtures/nfl/2026'))
    expect(scan.pick).toBeNull()
    expect(scan.sentence).toMatch(/^NO REAL 2026 CORRECTION CAPTURED YET — .*week 3: no snapshot pair \(only "final"\)/)
    expect(scan.sentence).toContain('F540 stays open')
  })

  it('a pair whose diff names a scorable change OUTSIDE the grace (production\'s first-seen-final): replayable, picked', () => {
    const root = join(tmp, 'outside')
    mkdirSync(root)
    week('outside/wk01', { prod: true, diff: 'right' })
    const scan = scanCapturedCorrections(root, provider)
    expect(scan.weeks.map((w) => w.verdict)).toEqual(['replayable'])
    expect(scan.pick?.change).toEqual({ playerId: 'syn-wr', statKey: 'receiving_yards', old: 100, new: 94, name: 'Syn Receiver', position: 'WR', nflTeam: 'SYA' })
    expect(scan.pick?.origin).toBe('real') // the scan's label for anything under a capture root — which is why only real captures may live there
    expect(scan.sentence).toMatch(/^REAL 2026 CORRECTION REPLAYED: Syn Receiver \(syn-wr\) receiving_yards 100 → 94/)
  })

  it('the same change with only the recorder\'s bound (no production instants): not outside — not replayed, said plainly', () => {
    const root = join(tmp, 'undetermined')
    mkdirSync(root)
    week('undetermined/wk01', { diff: 'right' })
    const scan = scanCapturedCorrections(root, provider)
    expect(scan.pick).toBeNull()
    expect(scan.weeks[0].verdict).toBe('no_outside_change')
    expect(scan.sentence).toContain('none a scorable correction outside the settle grace')
  })

  it('a week with only its "final" snapshot: no pair — said plainly', () => {
    const root = join(tmp, 'half')
    mkdirSync(root)
    week('half/wk01', { pair: false })
    expect(scanCapturedCorrections(root, provider).weeks.map((w) => w.sentence)).toEqual(['week 1: no snapshot pair (only "final") — nothing to replay yet'])
  })

  it('a pair with no committed snapshot-diff.txt is not replayed; one whose record disagrees with its own files THROWS', () => {
    const a = join(tmp, 'nodiff')
    mkdirSync(a)
    week('nodiff/wk01', { prod: true, diff: 'none' })
    expect(scanCapturedCorrections(a, provider).weeks[0].verdict).toBe('no_diff_record')
    const b = join(tmp, 'wrong')
    mkdirSync(b)
    week('wrong/wk01', { prod: true, diff: 'wrong' })
    expect(() => scanCapturedCorrections(b, provider)).toThrow('the committed snapshot-diff.txt does not')
  })
})
