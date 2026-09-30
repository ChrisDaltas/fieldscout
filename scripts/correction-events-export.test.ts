/**
 * correction-events-export.test.ts — M6 L.E2.5 (PROGRESS D458). The
 * production route is READ ONLY by construction: the export reaches the
 * database only through `readOnly()`, whose surface is `from(table).select`
 * and nothing else; the export's own sources call no writer. Its read and
 * render run here over an in-memory fake (synthetic rows — no real event is
 * claimed): zero events says so with the reason; a pre-167 database is named;
 * an event is named with F528's minutes. Plus the line sidecar's reader.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { SyncClient } from '../src/lib/sync/types'

import { exportFile, graceOf, readCorrectionExport, readOnly, renderCorrectionExport, weekFinalSeen, type ReadOnlyDb } from './correction-events-export'
import { toLineMeta } from './correction-line-meta'

// ── A minimal in-memory PostgREST fake (select + eq / in / gt / order / range) ──

type Row = Record<string, unknown>
interface Result {
  data: Row[] | null
  error: { code?: string; message: string } | null
  count: number | null
}

function fakeDb(tables: Record<string, Row[] | { code: string; message: string }>, calls: string[]): Pick<SyncClient, 'from'> {
  const from = (table: string) => {
    calls.push(`from:${table}`)
    const builder = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        calls.push(`select:${table}`)
        const filters: ((r: Row) => boolean)[] = []
        let lo = 0
        let hi = Number.POSITIVE_INFINITY
        const q = {
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
          gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
          order: () => q,
          range: (a: number, b: number) => ((lo = a), (hi = b), q),
          then: (resolveThen: (r: Result) => unknown) => {
            const t = tables[table]
            if (!Array.isArray(t)) return Promise.resolve(resolveThen({ data: null, error: t ?? { message: `no table ${table}` }, count: null }))
            const rows = t.filter((r) => filters.every((f) => f(r)))
            return Promise.resolve(resolveThen({ data: opts?.head ? null : rows.slice(lo, hi + 1), error: null, count: rows.length }))
          },
        }
        return q
      },
      insert: () => calls.push(`WRITE insert:${table}`),
      update: () => calls.push(`WRITE update:${table}`),
      upsert: () => calls.push(`WRITE upsert:${table}`),
      delete: () => calls.push(`WRITE delete:${table}`),
    }
    return builder
  }
  return { from } as unknown as Pick<SyncClient, 'from'>
}

const GAMES: Row[] = [
  { id: '2031_03_ATL_GB', season: 2031, week: 3, home_team: 'GB', away_team: 'ATL', status: 'final', kickoff_at: '2031-09-25T00:15:00Z', updated_at: '2031-09-25T03:24:00Z' },
  { id: '2031_03_ARI_SF', season: 2031, week: 3, home_team: 'SF', away_team: 'ARI', status: 'final', kickoff_at: '2031-09-29T00:15:00Z', updated_at: '2031-09-29T03:18:00Z' },
]
const WEEKS: Row[] = [
  { season: 2031, week: 3, starts_at: '2031-09-23T04:00:00Z', first_kickoff_at: '2031-09-25T00:15:00Z', last_game_ends_at: '2031-09-29T07:00:00Z', correction_window_ends_at: '2031-10-02T00:15:00Z' },
  { season: 2031, week: 4, starts_at: '2031-09-30T04:00:00Z', first_kickoff_at: '2031-10-02T00:15:00Z', last_game_ends_at: null, correction_window_ends_at: '2031-10-09T00:15:00Z' },
]
const LINES: Row[] = [
  { season: 2031, week: 3, player_id: '8112', updated_at: '2031-09-29T03:18:00Z' },
  { season: 2031, week: 3, player_id: '9509', updated_at: '2031-09-29T03:18:00Z' },
]
const READ_AT = new Date('2031-09-30T13:40:00Z')

describe('readOnly — the only door, and it has no writer', () => {
  it('RO1 the wrapper exposes from(table).select and nothing else', () => {
    const calls: string[] = []
    const ro = readOnly(fakeDb({}, calls))
    expect(Object.keys(ro)).toEqual(['from'])
    const t = ro.from('stat_correction_events') as unknown as Record<string, unknown>
    expect(Object.keys(t)).toEqual(['select'])
    for (const writer of ['insert', 'update', 'upsert', 'delete', 'rpc']) expect(t[writer]).toBeUndefined()
    expect((ro as unknown as Record<string, unknown>).rpc).toBeUndefined()
    expect(Object.isFrozen(ro) && Object.isFrozen(t)).toBe(true)
  })

  it('RO2 a full export run makes select calls only — no write reached the client', async () => {
    const calls: string[] = []
    await readCorrectionExport(readOnly(fakeDb({ stat_correction_events: [], nfl_games: GAMES, nfl_weeks: WEEKS, player_stats: LINES, players: [] }, calls)), 2031, 3, READ_AT)
    expect(calls.filter((c) => c.startsWith('WRITE'))).toEqual([])
    expect(new Set(calls.map((c) => c.split(':')[0]))).toEqual(new Set(['from', 'select']))
  })

  it('RO3 source pin: neither export file names a writer, and the CLI builds its client only inside readOnly()', () => {
    for (const file of ['correction-events-export.ts', 'export-correction-events.ts']) {
      const src = readFileSync(resolve(__dirname, file), 'utf8')
      for (const writer of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) expect(src.includes(writer), `${file} contains ${writer}`).toBe(false)
    }
    const cli = readFileSync(resolve(__dirname, 'export-correction-events.ts'), 'utf8')
    expect(cli.match(/cliClient\(\)/g)).toEqual(['cliClient()'])
    expect(cli).toContain('readOnly(cliClient())')
  })
})

describe('readCorrectionExport + render', () => {
  function run(events: Row[] | { code: string; message: string }): ReturnType<typeof readCorrectionExport> {
    const db: ReadOnlyDb = readOnly(
      fakeDb({ stat_correction_events: events, nfl_games: GAMES, nfl_weeks: WEEKS, player_stats: LINES, players: [{ id: '8112', full_name: 'Drake London', position: 'WR', team: 'ATL' }] }, []),
    )
    return readCorrectionExport(db, 2031, 3, READ_AT)
  }

  it('E1 zero events says so — the week, the season count, the instant, and that no line moved after final', async () => {
    const x = await run([])
    const text = renderCorrectionExport(x).join('\n')
    expect(text).toContain('events: 0 for week 3 (0 in the 2031 season)')
    expect(text).toContain('as of 2031-09-30T13:40:00.000Z. Nothing is fabricated.')
    expect(text).toContain('written after the week was seen final: 0')
    expect(text).toContain("the week's last game first seen final (nfl_games.updated_at — the settle grace's clock): 2031-09-29T03:18:00Z")
    expect(text).toContain('correction window ends 2031-10-02T00:15:00Z')
  })

  it('E2 a pre-167 database (no table) is named, never read as zero', async () => {
    const x = await run({ code: 'PGRST205', message: "Could not find the table 'public.stat_correction_events' in the schema cache" })
    expect(x.eventsTableAbsent).toBe(true)
    expect(renderCorrectionExport(x).join('\n')).toContain('ABSENT on this database (pre-167)')
  })

  it('E3 any other read error throws (loud, not empty)', async () => {
    await expect(run({ code: '42501', message: 'permission denied' })).rejects.toThrow(/permission denied/)
  })

  it('E4 an event is named with F528: minutes after the week was first seen final, and the grace verdict', async () => {
    const x = await run([
      { id: 'e1', season: 2031, week: 3, player_id: '8112', stat_key: 'receiving_yards', old_value: 100, new_value: 94, detected_at: '2031-10-01T01:18:00Z', week_state: 'open', game_id: null, source: 'sleeper+nflverse' },
    ])
    expect(x.events).toHaveLength(1)
    expect(x.events[0].minutesAfterFinal).toBe(2760) // 03:18Z 9-29 → 01:18Z 10-1 = 46 h
    expect(x.events[0].grace).toBe('outside')
    const text = renderCorrectionExport(x).join('\n')
    expect(text).toContain('Drake London (WR, ATL; id 8112) — receiving_yards 100 → 94 — game the week (no game on the line — F468(a)) — detected 2031-10-01T01:18:00Z (open) — 2760 min after first seen final')
    // The committed file carries no event id and no host.
    const file = JSON.stringify(exportFile(x))
    expect(file).not.toContain('"id"')
    expect(file).not.toMatch(/supabase\.co/)
  })

  it('E5 the week final-seen instant is null while any in-week game is not final; grace boundary at 360 min', () => {
    expect(weekFinalSeen([{ ...GAMES[0], status: 'live' }, GAMES[1]] as never)).toBeNull()
    expect(weekFinalSeen(GAMES as never)).toBe('2031-09-29T03:18:00Z')
    expect([graceOf(359.9), graceOf(360), graceOf(null)]).toEqual(['inside', 'outside', 'undetermined'])
  })
})

describe('toLineMeta — the sidecar reader', () => {
  it('M1 keeps only the recorded players, maps the fields, stamps as ISO', () => {
    const rows = [
      { player_id: '8112', team: 'ATL', opponent: 'PIT', date: '2031-09-13', last_modified: 1790295344629, player: { first_name: 'Drake', last_name: 'London', position: 'WR' } },
      { player_id: '999', team: 'NO', player: { first_name: 'Not', last_name: 'Recorded' } },
    ]
    expect(toLineMeta(rows, new Set(['8112']))).toEqual({
      '8112': { name: 'Drake London', position: 'WR', team: 'ATL', opponent: 'PIT', gameDate: '2031-09-13', lastModified: new Date(1790295344629).toISOString() },
    })
  })

  it('M2 one player on two teams is refused — the reader never guesses his game', () => {
    expect(() => toLineMeta([{ player_id: '1', team: 'ATL' }, { player_id: '1', team: 'NO' }], new Set(['1']))).toThrow(/two teams/)
  })
})
