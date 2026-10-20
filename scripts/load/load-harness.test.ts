/**
 * The Node half of the §22.6 harness (M7 L.F2.1): the target guard's
 * production names, the seeder's lineup builder and argument hygiene, and
 * the Sunday feeder's remap / alert split. Pure — no stack.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { LOAD_GAME_PREFIX, LOAD_SEASON, LOAD_WEEK } from '../../load/k6/config'
import type { FixtureRecording } from '@/lib/leagues/stats/fixtures/fixture-format'
import type { StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { firstCompletePoll } from './recording'
import { buildLineups, parseArgs } from './seed-staging'
import { LoadSeasonProvider, shiftFor, splitAlerts } from './sunday-replay'
import { parseEnvFile, productionNames, resolveTarget } from './target'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

function checkout(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'load-target-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

describe('target — production names are read at run time (TD2)', () => {
  it('parses env files without interpolation', () => {
    expect(parseEnvFile('# c\nA=1\nB="two"\nC=\'3\'\n\nbad line\n')).toEqual({ A: '1', B: 'two', C: '3' })
  })

  it('collects the linked ref, the hosted .env.local host and FS_LOAD_DENY — never a local host', () => {
    const hosted = checkout({ 'supabase/.temp/project-ref': 'RefFromLink\n', '.env.local': 'NEXT_PUBLIC_SUPABASE_URL=https://hosted-prod.example.co\n' })
    const local = checkout({ '.env.local': 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n' })
    expect(productionNames([hosted, local], 'Extra-One, ')).toEqual(['reffromlink', 'hosted-prod.example.co', 'extra-one'])
  })

  it('resolveTarget(test) refuses the linked production ref, reading the TEST values from .env.test-project.local', () => {
    const dir = checkout({
      'supabase/.temp/project-ref': 'prodrefprodrefprodre',
      '.env.test-project.local': 'NEXT_PUBLIC_SUPABASE_URL=https://prodrefprodrefprodre.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\nSUPABASE_SERVICE_ROLE_KEY=s\n',
    })
    delete process.env.FS_LOAD_URL
    expect(() => resolveTarget('test', dir)).toThrow(/PRODUCTION/)
  })

  it('resolveTarget(test) with no readable production name fails closed', () => {
    const dir = checkout({ '.env.test-project.local': 'FS_LOAD_URL=https://some-test.supabase.co\nFS_LOAD_ANON_KEY=a\nFS_LOAD_SERVICE_KEY=s\n' })
    delete process.env.FS_LOAD_URL
    delete process.env.FS_LOAD_DENY
    expect(() => resolveTarget('test', dir)).toThrow(/fails closed/)
  })

  it('resolveTarget(test) accepts a test project that is not production, and never reads .env.local for keys', () => {
    const dir = checkout({
      'supabase/.temp/project-ref': 'prodrefprodrefprodre',
      '.env.local': 'FS_LOAD_URL=https://WRONG.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=WRONG\n',
      '.env.test-project.local': 'NEXT_PUBLIC_SUPABASE_URL=https://some-test.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\nSUPABASE_SERVICE_ROLE_KEY=s\n',
    })
    delete process.env.FS_LOAD_URL
    const t = resolveTarget('test', dir)
    expect([t.kind, t.url, t.anonKey, t.serviceKey]).toEqual(['test', 'https://some-test.supabase.co', 'a', 's'])
  })

  it('there is no default target', () => {
    expect(() => resolveTarget(undefined)).toThrow(/--target is required/)
  })
})

describe('seed-staging', () => {
  it('refuses an unknown argument rather than ignoring it', () => {
    expect(() => parseArgs(['--target', 'local', '--yolo'])).toThrow(/refused, never ignored/)
    expect(parseArgs(['--target', 'local', '--cleanup'])).toMatchObject({ target: 'local', cleanup: true })
  })

  it('buildLineups fills every slot it can, never seats a player twice in one league', () => {
    const slots = [
      { key: 'qb', eligible: ['QB'], count: 1 },
      { key: 'flex', eligible: ['RB', 'WR'], count: 2 },
    ]
    const byPos = new Map([
      ['QB', ['q1', 'q2']],
      ['RB', ['r1']],
      ['WR', ['w1', 'w2']],
    ])
    const out = buildLineups(slots, ['t1', 't2'], byPos, 0)
    const all = [...out.values()].flatMap((m) => Object.values(m))
    expect(new Set(all).size).toBe(all.length)
    expect(out.get('t1')).toEqual({ 'qb:0': 'q1', 'flex:0': 'r1', 'flex:1': 'w1' })
    expect(out.get('t2')).toEqual({ 'qb:0': 'q2', 'flex:0': 'w2' }) // the pool ran dry — the slot stays empty, never a repeat
  })
})

describe('sunday-replay — the recorded week lands on the harness week', () => {
  const inner: StatsProvider = {
    name: 'fixture:sleeper',
    capabilities: new Set(['core_box']),
    getSchedule: async () => [
      { gameId: 'G1', season: 2026, week: 3, homeTeam: 'KC', awayTeam: 'BUF', kickoffAt: new Date('2026-09-27T17:00:00Z'), gameDate: '2026-09-27', status: 'final' },
      { gameId: 'G2', season: 2026, week: 4, homeTeam: 'KC', awayTeam: 'LV', kickoffAt: new Date('2026-10-04T17:00:00Z'), gameDate: '2026-10-04', status: 'scheduled' },
    ],
    getGameStates: async () => [{ gameId: 'G1', status: 'final' }],
    getWeekStats: async () => [{ playerId: 'p1', season: 2026, week: 3, gameId: 'G1', stats: { pass_yards: 300 }, advanced: {} }],
    getInjuries: async () => [],
    getInactives: async () => [],
  }

  it('remaps season, week and game ids, shifts kickoffs, and drops other weeks', async () => {
    const shift = shiftFor(2026, 3)
    const p = new LoadSeasonProvider(inner, 2026, 3, shift)
    const games = await p.getSchedule(LOAD_SEASON)
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({ gameId: `${LOAD_GAME_PREFIX}G1`, season: LOAD_SEASON, week: LOAD_WEEK })
    expect(games[0]!.kickoffAt!.getTime()).toBe(Date.parse('2026-09-27T17:00:00Z') + shift)
    const lines = await p.getWeekStats(LOAD_SEASON, LOAD_WEEK)
    expect(lines[0]).toMatchObject({ playerId: 'p1', season: LOAD_SEASON, week: LOAD_WEEK, gameId: `${LOAD_GAME_PREFIX}G1` })
    expect((await p.getGameStates(LOAD_SEASON, LOAD_WEEK))[0]!.gameId).toBe(`${LOAD_GAME_PREFIX}G1`)
  })

  it('serves ONLY the harness season/week — a real season is refused', async () => {
    const p = new LoadSeasonProvider(inner, 2026, 3, 0)
    await expect(p.getSchedule(2026)).rejects.toThrow(/serves only 2070 week 1/)
    await expect(p.getWeekStats(LOAD_SEASON, 2)).rejects.toThrow(/serves only/)
  })

  it('the shift maps the recorded week start onto the harness week start', () => {
    // 039's derivation: week N starts (N-1) weeks after the season's 09-09 04:00Z.
    expect(Date.parse('2026-09-23T04:00:00.000Z') + shiftFor(2026, 3)).toBe(Date.parse('2070-09-09T04:00:00.000Z'))
  })

  it('the first complete poll is when BOTH schedule and stats have an answer', () => {
    const rec = {
      header: { format: 'fieldscout-fixture', version: 1, provider: 'x', season: 2026, week: 3 },
      entries: [
        { t: '2026-01-01T00:00:00.000Z', method: 'getSchedule', args: [2026], ok: true, status: 200, body: [] },
        { t: '2026-01-01T00:00:00.500Z', method: 'getWeekStats', args: [2026, 3], ok: true, status: 200, body: [] },
      ],
    } as unknown as FixtureRecording
    expect(firstCompletePoll(rec)).toBe(Date.parse('2026-01-01T00:00:00.500Z'))
  })

  it("splitAlerts asserts score alerts only — the harness calendar and unrostered players' queue rows are reported", () => {
    const split = splitAlerts(
      [
        { kind: 'drift', severity: 'alert' },
        { kind: 'no_game_rows', severity: 'alert' },
        { kind: 'stuck_queue', severity: 'alert', player_id: 'ours' },
        { kind: 'stuck_queue', severity: 'alert', player_id: 'theirs' },
        { kind: 'post_window_correction', severity: 'warn' },
      ],
      new Set(['ours']),
    )
    expect(split).toEqual({ scored: { drift: 1, stuck_queue: 1 }, other: { no_game_rows: 1, stuck_queue: 1 } })
  })
})
