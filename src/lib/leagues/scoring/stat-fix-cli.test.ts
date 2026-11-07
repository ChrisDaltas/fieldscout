/**
 * stat-fix-cli.test.ts — `npm run stat-fix` (migration 222; PROGRESS D838):
 * the arguments, the lines file, the target guard and the record / status
 * paths over a fake database. The plan path runs over the real door in
 * `stat-fix-rescore-db.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { VirtualClock } from '../time/virtual-clock'
import { parseStatFixArgs, parseStatFixFile, runStatFixCli, type StatFixCliIo } from './stat-fix-cli'

const FILE = JSON.stringify({
  season: 2026,
  lines: [
    { week: 1, player_id: 'p-k', stat_key: 'fg_0_39', before: 0, after: 2 },
    { week: 7, player_id: 'p-dst', stat_key: 'def_fumble_recoveries', before: 1, after: 2 },
  ],
})

interface Call {
  fn: string
  args: Record<string, unknown>
}

function harness(over: { rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }; tables?: Record<string, unknown[]> } = {}) {
  const out: string[] = []
  const err: string[] = []
  const calls: Call[] = []
  let connected = 0
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return over.rpc ? over.rpc(fn, args) : { data: null, error: { message: `unexpected rpc ${fn}` } }
    },
    from: (table: string) => {
      const rows = over.tables?.[table] ?? []
      const builder = {
        select: () => builder,
        order: () => builder,
        range: () => builder,
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null, count: rows.length }),
      }
      return builder
    },
  }
  const io: StatFixCliIo = {
    supabaseUrl: 'http://127.0.0.1:54321',
    connect: () => {
      connected += 1
      return { db: db as never, time: new VirtualClock(new Date('2026-11-07T12:00:00.000Z')) }
    },
    readFile: () => FILE,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  }
  return { io, out, err, calls, connected: () => connected }
}

describe('arguments', () => {
  it('a command and only its own flags; a stale or mistyped flag never runs', () => {
    expect(parseStatFixArgs(['plan', '--file', 'x.json'])).toMatchObject({ command: 'plan', file: 'x.json', apply: false })
    expect(parseStatFixArgs(['record', '--file', 'x.json', '--reason', 'why', '--apply', '--confirm-target', 'h'])).toMatchObject({ command: 'record', reason: 'why', apply: true, confirmTarget: 'h' })
    expect(parseStatFixArgs(['status'])).toMatchObject({ command: 'status' })
    expect(() => parseStatFixArgs(['apply'])).toThrow('unknown command apply — nothing read or written.')
    expect(() => parseStatFixArgs(['plan', '--file', 'x', '--apply'])).toThrow('plan does not take --apply')
    expect(() => parseStatFixArgs(['status', '--file', 'x'])).toThrow('status does not take --file')
    expect(() => parseStatFixArgs(['record', '--file', 'x'])).toThrow('record needs --reason')
    expect(() => parseStatFixArgs(['record', '--file', 'x', '--reason', 'r', '--landed-at', 'yesterday'])).toThrow('--landed-at must be an ISO instant with its zone')
    expect(() => parseStatFixArgs(['plan'])).toThrow('plan needs --file')
  })
})

describe('the lines file', () => {
  it('reads {season, lines}; refuses a line that does not move, a repeat, and a bad shape — by name', () => {
    expect(parseStatFixFile(FILE).lines).toHaveLength(2)
    expect(() => parseStatFixFile('{')).toThrow('the lines file is not JSON')
    expect(() => parseStatFixFile(JSON.stringify({ season: 2026, lines: [] }))).toThrow('the lines file is not {season, lines')
    expect(() => parseStatFixFile(JSON.stringify({ season: 2026, lines: [{ week: 1, player_id: 'p', stat_key: 'fg_0_39', before: 1, after: 1 }] }))).toThrow(
      'week 1 player p fg_0_39 does not move (1 → 1) — a fix names only what it changed',
    )
    const twice = { week: 1, player_id: 'p', stat_key: 'fg_0_39', before: 0, after: 1 }
    expect(() => parseStatFixFile(JSON.stringify({ season: 2026, lines: [twice, twice] }))).toThrow('week 1 player p fg_0_39 appears twice in the lines file')
  })
})

describe('the CLI', () => {
  it('prints the target first; record without --apply says what it would record and touches NOTHING (no connection)', async () => {
    const h = harness()
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'the ruled columns'], h.io)).toBe(0)
    expect(h.out[0]).toBe('target: 127.0.0.1:54321')
    expect(h.out[1]).toBe('would record a stat fix: season 2026, 2 line(s) over week(s) 1, 7 — "the ruled columns"')
    expect(h.out.at(-1)).toBe('Nothing recorded. To record it (the score-week pass then applies it): npm run stat-fix -- record --file f.json --reason "the ruled columns" --apply --confirm-target 127.0.0.1:54321')
    expect(h.connected()).toBe(0)
  })

  it('--apply without --confirm-target, or naming another host, exits 2 having connected to nothing', async () => {
    const h = harness()
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--apply'], h.io)).toBe(2)
    expect(h.err).toEqual(['target is 127.0.0.1:54321 — re-run with --confirm-target 127.0.0.1:54321 to write to it'])
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--apply', '--confirm-target', 'prod.example'], h.io)).toBe(2)
    expect(h.connected()).toBe(0)
  })

  it('record --apply: records the fix, THEN marks it written — the landing is the run’s instant unless named', async () => {
    const h = harness({
      rpc: (fn) => (fn === 'record_stat_fix' ? { data: 'fix-1', error: null } : { data: { fix_id: 'fix-1', already_written: false }, error: null }),
    })
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', '  the ruled columns ', '--apply', '--confirm-target', '127.0.0.1:54321'], h.io)).toBe(0)
    expect(h.calls.map((c) => c.fn)).toEqual(['record_stat_fix', 'mark_stat_fix_written'])
    expect(h.calls[0].args).toEqual({ p_season: 2026, p_reason: 'the ruled columns', p_lines: JSON.parse(FILE).lines, p_landed_at: '2026-11-07T12:00:00.000Z' })
    expect(h.calls[1].args).toEqual({ p_fix_id: 'fix-1' })
    expect(h.out).toContain('recorded and written: stat fix fix-1 — season 2026, 2 line(s), landed 2026-11-07T12:00:00.000Z')
    const named = harness({ rpc: (fn) => (fn === 'record_stat_fix' ? { data: 'fix-2', error: null } : { data: {}, error: null }) })
    await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--landed-at', '2026-11-06T18:52:00Z', '--apply', '--confirm-target', '127.0.0.1:54321'], named.io)
    expect(named.calls[0].args.p_landed_at).toBe('2026-11-06T18:52:00Z')
  })

  it('a database without 222 refuses by name (exit 1), and a fix that cannot be marked is said to apply nowhere', async () => {
    const pre = harness({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.record_stat_fix(p_landed_at, p_lines, p_reason, p_season) in the schema cache' } }) })
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--apply', '--confirm-target', '127.0.0.1:54321'], pre.io)).toBe(1)
    expect(pre.err[0]).toMatch(/^REFUSED — the database predates migration 222/)
    const half = harness({ rpc: (fn) => (fn === 'record_stat_fix' ? { data: 'fix-3', error: null } : { data: null, error: { message: 'connection reset' } }) })
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--apply', '--confirm-target', '127.0.0.1:54321'], half.io)).toBe(1)
    expect(half.err).toEqual(['FAILED — fix fix-3 is recorded but NOT written (nothing applies from it): mark_stat_fix_written: connection reset'])
  })

  it('status: each fix with applied / owed / not eligible, every not-eligible league-week by name; an unwritten fix says so', async () => {
    const h = harness({
      tables: {
        stat_fixes: [
          { id: 'fix-1', season: 2026, reason: 'the ruled columns', landed_at: '2026-11-06T18:52:00+00:00', created_at: '2026-11-07T12:00:00+00:00', written_at: '2026-11-07T12:00:01+00:00' },
          { id: 'fix-0', season: 2026, reason: 'never confirmed', landed_at: '2026-11-06T18:52:00+00:00', created_at: '2026-11-07T12:00:00+00:00', written_at: null },
        ],
      },
      rpc: () => ({
        data: [
          { fix_id: 'fix-1', league_id: 'L1', season: 2026, week: 1, state: 'applied' },
          { fix_id: 'fix-1', league_id: 'L1', season: 2026, week: 2, state: 'owed' },
          { fix_id: 'fix-1', league_id: 'L2', season: 2026, week: 1, state: 'bracket_built' },
        ],
        error: null,
      }),
    })
    expect(await runStatFixCli(['status'], h.io)).toBe(0)
    expect(h.calls).toEqual([{ fn: 'stat_fix_targets', args: { p_owed_only: false, p_limit: 1 } }])
    expect(h.out.slice(1)).toEqual([
      'fix fix-1 season 2026 landed 2026-11-06T18:52:00+00:00 written 2026-11-07T12:00:01+00:00 — "the ruled columns": applied 1, owed 1, not eligible 1',
      '  league L2 week 1: bracket_built',
      'fix fix-0 season 2026 landed 2026-11-06T18:52:00+00:00 NOT WRITTEN (nothing applies from it) — "never confirmed": applied 0, owed 0, not eligible 0',
    ])
  })
})
