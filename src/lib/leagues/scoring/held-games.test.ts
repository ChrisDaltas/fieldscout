/**
 * held-games.test.ts — the held-game rule's line matching (184 / R1547) and
 * F589 (194): a NULL-game line is judged by the team the LINE was played
 * for, never the player's current team; only a line with no stored team
 * falls back to the current team.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { NO_HELD_GAMES, onHeldGame, readHeldGames, withoutHeldLines, type HeldGames } from './held-games'

// The KC–BUF game is cancelled this week; MIA–NYJ is played.
const held: HeldGames = {
  gameIds: new Set(['g-kc-buf']),
  teams: new Set(['KC', 'BUF']),
  lineTeams: new Map([
    ['traded-out', 'KC'], // played for KC, then traded to MIA
    ['released', 'KC'], // played for KC, then released (no current team)
    ['traded-in', 'MIA'], // played for MIA, then traded to KC
  ]),
}
const current: Record<string, string | null> = {
  'traded-out': 'MIA',
  released: null,
  'traded-in': 'KC',
  legacy: 'KC', // a pre-194 line: no stored team
  unmoved: 'NYJ',
}
const teamOf = (id: string) => current[id]

describe('onHeldGame — F589', () => {
  it('a line naming its game is matched by the game alone', () => {
    expect(onHeldGame({ game_id: 'g-kc-buf' }, 'traded-in', held, teamOf)).toBe(true)
    expect(onHeldGame({ game_id: 'g-mia-nyj' }, 'traded-out', held, teamOf)).toBe(false)
  })
  it('traded away after playing for the cancelled team: zeroed (the old rule kept his points)', () => {
    expect(onHeldGame({ game_id: null }, 'traded-out', held, teamOf)).toBe(true)
  })
  it('released after playing for the cancelled team: zeroed (the old rule kept his points — no team)', () => {
    expect(onHeldGame({ game_id: null }, 'released', held, teamOf)).toBe(true)
  })
  it('traded IN to the cancelled team after playing elsewhere: keeps his points (the old rule zeroed him)', () => {
    expect(onHeldGame({ game_id: null }, 'traded-in', held, teamOf)).toBe(false)
  })
  it('a line with no stored team falls back to his current team', () => {
    expect(onHeldGame({ game_id: null }, 'legacy', held, teamOf)).toBe(true)
    expect(onHeldGame({ game_id: null }, 'unmoved', held, teamOf)).toBe(false)
  })
  it('nothing held ⇒ nothing dropped', () => {
    expect(onHeldGame({ game_id: null }, 'legacy', NO_HELD_GAMES, teamOf)).toBe(false)
  })
  it('withoutHeldLines names the dropped players', () => {
    const lines = new Map(Object.keys(current).map((id) => [id, { game_id: null }]))
    expect(withoutHeldLines(lines, held, teamOf).dropped).toEqual(['legacy', 'released', 'traded-out'])
  })
})

/** A minimal PostgREST stand-in: nfl_games answers once, player_stats pages. */
function stubDb(games: unknown[], stats: unknown[] | { error: string }) {
  const calls: string[] = []
  const db = {
    from(table: string) {
      calls.push(table)
      let range: [number, number] = [0, 999]
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          range = [a, b]
          return q
        },
        then(resolve: (v: unknown) => void) {
          if (table === 'nfl_games') return resolve({ data: games, error: null })
          if (!Array.isArray(stats)) return resolve({ data: null, error: { message: stats.error } })
          return resolve({ data: stats.slice(range[0], range[1] + 1), error: null })
        },
      }
      return q
    },
  }
  return { db: db as unknown as SupabaseClient<Database>, calls }
}

describe('readHeldGames — the line teams', () => {
  const kcBuf = { id: 'g-kc-buf', home_team: 'KC', away_team: 'BUF', operator_hold: 'cancelled' }
  it('nothing held ⇒ player_stats is never read', async () => {
    const { db, calls } = stubDb([{ ...kcBuf, operator_hold: null }], [])
    expect((await readHeldGames(db, 2026, 7)).lineTeams.size).toBe(0)
    expect(calls).toEqual(['nfl_games'])
  })
  it('held ⇒ every page of NULL-game lines is read; a NULL / absent team (pre-194) is not a line team', async () => {
    const stats = [
      ...Array.from({ length: 1000 }, (_, i) => ({ player_id: `p${String(i).padStart(4, '0')}`, team: 'NYJ' })),
      { player_id: 'z-kc', team: 'KC' },
      { player_id: 'z-null', team: null },
      { player_id: 'z-absent' },
    ]
    const { db, calls } = stubDb([kcBuf], stats)
    const h = await readHeldGames(db, 2026, 7)
    expect(calls).toEqual(['nfl_games', 'player_stats', 'player_stats'])
    expect(h.lineTeams.size).toBe(1001)
    expect(h.lineTeams.get('z-kc')).toBe('KC')
    expect(h.lineTeams.has('z-null')).toBe(false)
    expect(h.lineTeams.has('z-absent')).toBe(false)
  })
  it('a failed line read throws by name — never "no line team"', async () => {
    const { db } = stubDb([kcBuf], { error: 'boom' })
    await expect(readHeldGames(db, 2026, 7)).rejects.toThrow(/^player_stats read \(line teams, 2026 week 7\) failed: boom/)
  })
})
