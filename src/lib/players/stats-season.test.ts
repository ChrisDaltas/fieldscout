/**
 * Which season a Players table opens on (audit desktop-a-1, 2026-10-27: the
 * desktop Players table opened on last season in Week 7, and Reset went back
 * to it). Pinned here:
 *   1. The rule: current season once it has games, last season before.
 *   2. The table shows the viewer's pick, else that default.
 *   3. "Has games" asks the whole table for one real (non-mock) weekly line,
 *      and a failed read throws instead of reading as "no games yet".
 *   4. The desktop table and the route use the rule — no hard-coded season.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { currentSeasonHasGames, defaultStatsSeason, shownStatsSeason } from './stats-season'

describe('defaultStatsSeason', () => {
  it('opens on the current season once it has games', () => {
    expect(defaultStatsSeason(true)).toBe('current')
  })

  it('opens on last season before the current one has any games (preseason)', () => {
    expect(defaultStatsSeason(false)).toBe('last')
  })
})

describe('shownStatsSeason', () => {
  it("shows the viewer's pick over the default", () => {
    expect(shownStatsSeason('last', 'current')).toBe('last')
    expect(shownStatsSeason('current', 'last')).toBe('current')
  })

  it('shows the default when nothing is picked (and after Reset clears the pick)', () => {
    expect(shownStatsSeason(null, 'current')).toBe('current')
    expect(shownStatsSeason(null, 'last')).toBe('last')
  })

  it('is the current season before the read has answered', () => {
    expect(shownStatsSeason(null, null)).toBe('current')
  })
})

type Call = [method: string, ...args: unknown[]]

/** A recording stand-in for the one `player_stats` read. */
function fakeClient(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: Call[] = []
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'or']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args])
      return builder
    }
  }
  builder.limit = (...args: unknown[]) => {
    calls.push(['limit', ...args])
    return Promise.resolve(result)
  }
  const client = {
    from: (table: string) => {
      calls.push(['from', table])
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('currentSeasonHasGames', () => {
  it('asks the whole table for one real weekly line in that season', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'x' }], error: null })
    await expect(currentSeasonHasGames(client, 2026)).resolves.toBe(true)
    expect(calls).toEqual([
      ['from', 'player_stats'],
      ['select', 'id'],
      ['eq', 'season', 2026],
      ['not', 'week', 'is', null],
      ['or', 'source.is.null,source.neq.mock'],
      ['limit', 1],
    ])
    // Never narrowed to the filtered pool — the answer can't move with a filter.
    expect(calls.some(([m]) => m === 'in')).toBe(false)
  })

  it('is false when the season has no lines yet', async () => {
    const { client } = fakeClient({ data: [], error: null })
    await expect(currentSeasonHasGames(client, 2026)).resolves.toBe(false)
  })

  it('throws on a read error rather than reading it as "no games yet"', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } })
    await expect(currentSeasonHasGames(client, 2026)).rejects.toThrow(/2026 season.*boom/)
  })
})

describe('the tables use the rule', () => {
  const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

  it('the desktop Players table opens on, and resets to, the read’s default — never a fixed season', () => {
    const table = src('src/components/players/players-spreadsheet.tsx')
    expect(table).toMatch(/shownStatsSeason\(seasonPick, defaultSeason\)/)
    expect(table).toMatch(/setDefaultSeason\(data\.season\.default\)/)
    // Reset clears the pick, so the table falls back to the default.
    expect(table).toMatch(/const resetFilters = \(\) => \{[^}]*setSeasonPick\(null\)/)
    expect(table).not.toMatch(/useState<SeasonKey>\('(last|current)'\)/)
    expect(table).not.toMatch(/setSeason\w*\('(last|current)'\)/)
  })

  it('the players read names the default from the rule', () => {
    const route = src('src/app/api/players/builder/route.ts')
    expect(route).toMatch(/default: defaultStatsSeason\(currentHasGames\)/)
    expect(route).toMatch(/currentSeasonHasGames\(supabase, CURRENT_SEASON\)/)
  })
})
