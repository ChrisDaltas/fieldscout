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

/** PostgREST's cap: never more than this many rows in one response (supabase/config.toml max_rows; the hosted project matches). */
const ROW_CAP = 1000

function harness(
  over: {
    rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }
    tables?: Record<string, unknown[]>
    /** A table read answers this error instead (the read-back after a lost reply). */
    tableError?: Record<string, { message: string }>
  } = {},
) {
  const out: string[] = []
  const err: string[] = []
  const calls: Call[] = []
  let connected = 0
  /** A response the way PostgREST gives it: the requested range, never more than ROW_CAP rows, the exact count when asked. */
  const answer = (result: { data: unknown; error: unknown }, lo: number, hi: number, counted: boolean) => {
    if (result.error || !Array.isArray(result.data)) return { ...result, count: null }
    const rows = result.data as unknown[]
    return { data: rows.slice(lo, Math.min(hi + 1, lo + ROW_CAP)), error: null, count: counted ? rows.length : null }
  }
  const db = {
    rpc: (fn: string, args: Record<string, unknown>, opts?: { count?: string }) => {
      calls.push({ fn, args })
      const result = over.rpc ? over.rpc(fn, args) : { data: null, error: { message: `unexpected rpc ${fn}` } }
      let lo = 0
      let hi = Number.POSITIVE_INFINITY
      const builder = {
        order: () => builder,
        range: (from: number, to: number) => ((lo = from), (hi = to), builder),
        then: (resolve: (v: unknown) => unknown) => resolve(Array.isArray(result.data) ? answer(result, lo, hi, opts?.count === 'exact') : result),
      }
      return builder
    },
    from: (table: string) => {
      const rows = over.tables?.[table] ?? []
      const error = over.tableError?.[table] ?? null
      let lo = 0
      let hi = Number.POSITIVE_INFINITY
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const matched = () => rows.filter((row) => filters.every((f) => f(row as Record<string, unknown>)))
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
        order: () => builder,
        range: (from: number, to: number) => ((lo = from), (hi = to), builder),
        maybeSingle: async () => (error ? { data: null, error } : { data: matched()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve(error ? { data: null, error, count: null } : answer({ data: matched(), error: null }, lo, hi, true)),
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
    expect(parseStatFixArgs(['plan', '--file', 'x.json', '--landed-at', '2026-11-06T18:52:00Z'])).toMatchObject({ command: 'plan', landedAt: '2026-11-06T18:52:00Z' })
    expect(parseStatFixArgs(['record', '--file', 'x.json', '--reason', 'why', '--landed-at', '2026-11-06T18:52:00Z', '--apply', '--confirm-target', 'h'])).toMatchObject({
      command: 'record',
      reason: 'why',
      apply: true,
      confirmTarget: 'h',
    })
    expect(parseStatFixArgs(['status'])).toMatchObject({ command: 'status' })
    expect(() => parseStatFixArgs(['apply'])).toThrow('unknown command apply — nothing read or written.')
    expect(() => parseStatFixArgs(['plan', '--file', 'x', '--apply'])).toThrow('plan does not take --apply')
    expect(() => parseStatFixArgs(['status', '--file', 'x'])).toThrow('status does not take --file')
    expect(() => parseStatFixArgs(['record', '--file', 'x'])).toThrow('record needs --reason')
    expect(() => parseStatFixArgs(['record', '--file', 'x', '--reason', 'r', '--landed-at', 'yesterday'])).toThrow('--landed-at must be an ISO instant with its zone')
    // Round 5: never "now" by default — it decides which weeks were already scored with our change.
    expect(() => parseStatFixArgs(['record', '--file', 'x', '--reason', 'r'])).toThrow(
      'record needs --landed-at <iso>: when our change reached the stats (the fill run’s instant) or the engine (the deploy, once the new code answered every request) — a week last scored after it is not paid again, so it is never assumed',
    )
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
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'the ruled columns', '--landed-at', '2026-11-06T18:52:00Z'], h.io)).toBe(0)
    expect(h.out[0]).toBe('target: 127.0.0.1:54321')
    expect(h.out[1]).toBe('would record a stat fix: season 2026, 2 line(s) over week(s) 1, 7, landed 2026-11-06T18:52:00Z — "the ruled columns"')
    expect(h.out.at(-1)).toBe(
      'Nothing recorded. To record it (the score-week pass then applies it): npm run stat-fix -- record --file f.json --reason "the ruled columns" --landed-at 2026-11-06T18:52:00Z --apply --confirm-target 127.0.0.1:54321',
    )
    expect(h.connected()).toBe(0)
  })

  it('--apply without --confirm-target, or naming another host, exits 2 having connected to nothing', async () => {
    const h = harness()
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--landed-at', '2026-11-06T18:52:00Z', '--apply'], h.io)).toBe(2)
    expect(h.err).toEqual(['target is 127.0.0.1:54321 — re-run with --confirm-target 127.0.0.1:54321 to write to it'])
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--landed-at', '2026-11-06T18:52:00Z', '--apply', '--confirm-target', 'prod.example'], h.io)).toBe(2)
    expect(h.connected()).toBe(0)
  })

  it('record --apply: records the fix with the landing it was GIVEN, THEN marks it written', async () => {
    const h = harness({
      rpc: (fn) => (fn === 'record_stat_fix' ? { data: 'fix-1', error: null } : { data: { fix_id: 'fix-1', already_written: false }, error: null }),
    })
    const args = ['record', '--file', 'f.json', '--reason', '  the ruled columns ', '--landed-at', '2026-11-06T18:52:00Z', '--apply', '--confirm-target', '127.0.0.1:54321']
    expect(await runStatFixCli(args, h.io)).toBe(0)
    expect(h.calls.map((c) => c.fn)).toEqual(['record_stat_fix', 'mark_stat_fix_written'])
    expect(h.calls[0].args).toEqual({ p_season: 2026, p_reason: 'the ruled columns', p_lines: JSON.parse(FILE).lines, p_landed_at: '2026-11-06T18:52:00Z' })
    expect(h.calls[1].args).toEqual({ p_fix_id: 'fix-1' })
    expect(h.out).toContain('recorded and written: stat fix fix-1 — season 2026, 2 line(s), landed 2026-11-06T18:52:00Z')
  })

  it('a landing in the FUTURE is refused before anything is read or written (it would make every week finalized until then owed)', async () => {
    const h = harness({ rpc: () => ({ data: 'fix-9', error: null }) })
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--landed-at', '2027-11-06T18:52:00Z', '--apply', '--confirm-target', '127.0.0.1:54321'], h.io)).toBe(2)
    expect(h.err).toEqual(['--landed-at 2027-11-06T18:52:00Z is after now (2026-11-07T12:00:00.000Z): our change can’t have landed yet — nothing read or written'])
    expect(h.calls).toEqual([])
  })

  it('a database without 222 refuses by name (exit 1)', async () => {
    const pre = harness({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.record_stat_fix(p_landed_at, p_lines, p_reason, p_season) in the schema cache' } }) })
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--landed-at', '2026-11-06T18:52:00Z', '--apply', '--confirm-target', '127.0.0.1:54321'], pre.io)).toBe(1)
    expect(pre.err[0]).toMatch(/^REFUSED — the database predates migration 222/)
  })

  it('a move a written fix already holds is REFUSED by the database, by name — a re-run never pays it twice', async () => {
    const again = harness({ rpc: () => ({ data: null, error: { code: 'P0001', message: 'record_stat_fix: already_recorded — week 1 player p-k stat fg_0_39 from 0 is already a move of written stat fix fix-1 (0 → 2); recorded again it would be paid twice' } }) })
    expect(await runStatFixCli(['record', '--file', 'f.json', '--reason', 'r', '--landed-at', '2026-11-06T18:52:00Z', '--apply', '--confirm-target', '127.0.0.1:54321'], again.io)).toBe(1)
    expect(again.err).toEqual(['REFUSED — record_stat_fix: record_stat_fix: already_recorded — week 1 player p-k stat fg_0_39 from 0 is already a move of written stat fix fix-1 (0 → 2); recorded again it would be paid twice'])
  })

  describe('a mark whose reply is lost is READ BACK, never assumed either way (round 5)', () => {
    const lost = (written: string | null, readError?: string) =>
      harness({
        rpc: (fn) => (fn === 'record_stat_fix' ? { data: 'fix-3', error: null } : { data: null, error: { message: 'connection reset' } }),
        tables: { stat_fixes: [{ id: 'fix-3', written_at: written }] },
        ...(readError ? { tableError: { stat_fixes: { message: readError } } } : {}),
      })
    const apply = ['record', '--file', 'f.json', '--reason', 'r', '--landed-at', '2026-11-06T18:52:00Z', '--apply', '--confirm-target', '127.0.0.1:54321']

    it('the mark landed (only its reply was lost): written, exit 0 — not a FAILED that invites a second record', async () => {
      const h = lost('2026-11-07T12:00:01+00:00')
      expect(await runStatFixCli(apply, h.io)).toBe(0)
      expect(h.err).toEqual([])
      expect(h.out).toContain('recorded and written: stat fix fix-3 — season 2026, 2 line(s), landed 2026-11-06T18:52:00Z (mark_stat_fix_written’s reply was lost — read back: written 2026-11-07T12:00:01+00:00)')
    })

    it('it did not land: NOT written, said by the read-back, and re-running is the way on', async () => {
      const h = lost(null)
      expect(await runStatFixCli(apply, h.io)).toBe(1)
      expect(h.err).toEqual([
        'FAILED — fix fix-3 is recorded but NOT written (read back): nothing applies from it (mark_stat_fix_written: connection reset). Re-run this record: a fix never written applies nowhere, so nothing is paid twice.',
      ])
    })

    it('the read-back fails too: say so, and point at status before anything else', async () => {
      const h = lost(null, 'upstream 502')
      expect(await runStatFixCli(apply, h.io)).toBe(1)
      expect(h.err).toEqual([
        'FAILED — fix fix-3 is recorded; whether it is written is NOT known (mark_stat_fix_written: connection reset; read-back: upstream 502). Run npm run stat-fix -- status before anything else: written, it is done; not written, re-run this record (a re-run is refused while a written fix holds these moves).',
      ])
    })
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
    expect(h.calls.every((c) => c.fn === 'stat_fix_targets' && c.args.p_owed_only === false)).toBe(true)
    expect(h.out.slice(1)).toEqual([
      'fix fix-1 season 2026 landed 2026-11-06T18:52:00+00:00 written 2026-11-07T12:00:01+00:00 — "the ruled columns": applied 1, owed 1, not eligible 1',
      '  league L2 week 1: bracket_built',
      'fix fix-0 season 2026 landed 2026-11-06T18:52:00+00:00 NOT WRITTEN (nothing applies from it) — "never confirmed": applied 0, owed 0, not eligible 0',
    ])
  })

  it('status reads EVERY target past PostgREST’s 1000-row cap — the newest fix (sorted last) is never cut to "owed 0" (round 5)', async () => {
    const leagues = Array.from({ length: 150 }, (_, i) => `L${String(i).padStart(3, '0')}`)
    const rows = [
      // fix-1: 8 weeks × 150 leagues, all applied — 1,200 rows ahead of fix-2 in the function's order.
      ...leagues.flatMap((league) => Array.from({ length: 8 }, (_, w) => ({ fix_id: 'fix-1', league_id: league, season: 2026, week: w + 1, state: 'applied' }))),
      // fix-2, the one being checked: 150 league-weeks still owed.
      ...leagues.map((league) => ({ fix_id: 'fix-2', league_id: league, season: 2026, week: 9, state: 'owed' })),
    ]
    const h = harness({
      tables: {
        stat_fixes: [
          { id: 'fix-1', season: 2026, reason: 'the backlog', landed_at: '2026-11-06T18:52:00+00:00', created_at: '2026-11-07T12:00:00+00:00', written_at: '2026-11-07T12:00:01+00:00' },
          { id: 'fix-2', season: 2026, reason: 'a fill', landed_at: '2026-11-08T11:00:00+00:00', created_at: '2026-11-08T11:00:00+00:00', written_at: '2026-11-08T11:00:02+00:00' },
        ],
      },
      rpc: () => ({ data: rows, error: null }),
    })
    expect(await runStatFixCli(['status'], h.io)).toBe(0)
    expect(h.out.slice(1)).toEqual([
      'fix fix-1 season 2026 landed 2026-11-06T18:52:00+00:00 written 2026-11-07T12:00:01+00:00 — "the backlog": applied 1200, owed 0, not eligible 0',
      'fix fix-2 season 2026 landed 2026-11-08T11:00:00+00:00 written 2026-11-08T11:00:02+00:00 — "a fill": applied 0, owed 150, not eligible 0',
    ])
  })
})
