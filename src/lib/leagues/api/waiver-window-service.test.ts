/**
 * waiver-window-service.test.ts + seat-columns — M5 task L.D2.13 (D414).
 *
 * (1) The detail's window read NEVER fails the detail: every failed side read
 *     is `window: null` with the failing read NAMED; a status with no pickups
 *     reads nothing.
 * (2) `selectWithSeatFallback` retries without `waiver_priority` ONLY on the
 *     undefined-column error that names it (a pre-145 hosted database), and
 *     passes every other error through untouched.
 */
import type { PostgrestError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { isMissingWaiverPriority, selectWithSeatFallback } from './seat-columns'
import { PRE_149_ERROR, pausedFlag, readWaiverWindow } from './waiver-window-service'

type Answer = { data: unknown; error: { message: string; code?: string } | null }

/** A fake client: `.from(table)` resolves to the table's answer through any chain. */
function fakeClient(answers: Record<string, Answer>, calls: string[] = []) {
  const chain = (table: string) => {
    const answer = answers[table] ?? { data: [], error: null }
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order']) builder[m] = () => builder
    builder.maybeSingle = () => Promise.resolve(answer)
    builder.then = (resolve: (a: Answer) => unknown) => Promise.resolve(answer).then(resolve)
    return builder
  }
  return {
    from: (table: string) => {
      calls.push(table)
      return chain(table)
    },
  } as never
}

const settings = defaultsForTeamCount(8)
const league = { id: 'l', season: 2026, status: 'in_season', waiver_next_run_at: null }
const AT = new Date('2026-09-08T12:00:00.000Z')

describe('readWaiverWindow — never fails the detail', () => {
  it('reads the draft, the weeks and the kill switch and composes the window', async () => {
    const read = await readWaiverWindow(
      fakeClient({
        drafts: { data: [{ completed_at: '2026-09-05T20:00:00.000Z' }], error: null },
        nfl_weeks: { data: [{ starts_at: '2026-09-09T04:00:00.000Z', last_game_ends_at: null }], error: null },
        system_flags: { data: { value: { paused: true } }, error: null },
      }),
      league,
      settings,
      AT,
    )
    expect(read.error).toBeNull()
    expect(read.window).toMatchObject({ why: 'awaiting_run', next_run_at: '2026-09-09T07:00:00.000Z', paused: true })
  })
  it('a failed side read is null WITH the read named — never an empty window', async () => {
    for (const table of ['drafts', 'nfl_weeks', 'system_flags']) {
      const read = await readWaiverWindow(fakeClient({ [table]: { data: null, error: { message: 'boom' } } }), league, settings, AT)
      expect(read.window, table).toBeNull()
      expect(read.error, table).toBe(`${table}: boom`)
    }
  })
  it('a league with no pickups yet reads nothing', async () => {
    const calls: string[] = []
    const read = await readWaiverWindow(fakeClient({}, calls), { ...league, status: 'setup' }, settings, AT)
    expect(read).toEqual({ window: null, error: 'no pickups while the league is setup', live: true })
    expect(calls).toEqual([])
  })
  it('R1219: a league row WITHOUT the `waiver_next_run_at` key (a pre-149 database) — no window, not live, nothing read', async () => {
    const calls: string[] = []
    const { waiver_next_run_at: _omit, ...pre149 } = league
    void _omit
    const read = await readWaiverWindow(fakeClient({}, calls), pre149, settings, AT)
    expect(read).toEqual({ window: null, error: PRE_149_ERROR, live: false })
    expect(PRE_149_ERROR).toBe('schedule not live on this database (pre-149)')
    expect(calls).toEqual([])
    // …while the key PRESENT with NULL is a live, untracked league.
    expect((await readWaiverWindow(fakeClient({}), league, settings, AT)).live).toBe(true)
  })
  it('R1223: every Postgres true spelling pauses; anything else does not', () => {
    for (const v of [true, 't', 'TRUE', 'yes', 'Y', 'on', '1', ' True ', 1]) expect(pausedFlag(v), String(v)).toBe(true)
    for (const v of [false, 'f', 'false', 'no', 'off', '0', '', null, undefined, 0, 2, {}]) expect(pausedFlag(v), String(v)).toBe(false)
  })
  it('a thrown read (a schedule the twin refuses) is caught and named', async () => {
    const read = await readWaiverWindow(fakeClient({}), league, { ...settings, waiver_run_days: [] }, AT)
    expect(read.window).toBeNull()
    expect(read.error).toMatch(/^waiver window: /)
  })
})

describe('selectWithSeatFallback — the pre-145 database (deploy before push)', () => {
  const missing = { code: '42703', message: 'column league_members.waiver_priority does not exist' } as PostgrestError
  it('only the undefined-column error naming waiver_priority triggers the fallback', () => {
    expect(isMissingWaiverPriority(missing)).toBe(true)
    expect(isMissingWaiverPriority({ ...missing, message: 'column league_members.other does not exist' })).toBe(false)
    // R1222: anchored — another table's column of the same name never triggers it.
    expect(isMissingWaiverPriority({ ...missing, message: 'column some_view.waiver_priority does not exist' })).toBe(false)
    expect(isMissingWaiverPriority({ ...missing, code: '42501' })).toBe(false)
    expect(isMissingWaiverPriority(null)).toBe(false)
  })
  it('falls back and fills waiver_priority: null', async () => {
    const out = await selectWithSeatFallback<{ team_id: string; faab_balance: number; waiver_priority: number | null }>(
      () => Promise.resolve({ data: null, error: missing }),
      () => Promise.resolve({ data: [{ team_id: 't', faab_balance: 40 }], error: null }),
    )
    expect(out).toEqual({ data: [{ team_id: 't', faab_balance: 40, waiver_priority: null }], error: null })
  })
  it('passes the full read through, and any other error untouched (no silent retry)', async () => {
    let legacyCalled = false
    const other = { code: '42501', message: 'permission denied' } as PostgrestError
    const out = await selectWithSeatFallback(
      () => Promise.resolve({ data: null, error: other }),
      () => {
        legacyCalled = true
        return Promise.resolve({ data: [], error: null })
      },
    )
    expect(out.error).toBe(other)
    expect(legacyCalled).toBe(false)
    const ok = await selectWithSeatFallback(
      () => Promise.resolve({ data: [{ waiver_priority: 2 }], error: null }),
      () => Promise.resolve({ data: [], error: null }),
    )
    expect(ok.data).toEqual([{ waiver_priority: 2 }])
  })
})
