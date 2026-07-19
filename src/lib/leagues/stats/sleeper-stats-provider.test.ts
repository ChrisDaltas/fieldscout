import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TimeProvider } from '../time/time-provider'
import {
  mapSleeperGameStatus,
  SLEEPER_STAT_KEY_MAP,
  SleeperStatsProvider,
} from './sleeper-stats-provider'
import { STAT_KEYS } from './stat-keys'

const FROZEN_NOW = new Date('2026-09-13T17:00:00Z')
const frozenTime: TimeProvider = { now: () => FROZEN_NOW }

// ── Trimmed-real Sleeper payloads ───────────────────────────────────────────

// Weekly actual-stat rows (shape per live-stats.ts's SleeperWeeklyStatsRow).
const QB_ROW = {
  player_id: '4881',
  stats: { pass_yd: 304, pass_td: 3, pass_int: 1, pass_2pt: 1, pass_sack: 2, rush_yd: 42, rush_td: 1, pts_ppr: 32.5 },
}
const RB_ROW = {
  player_id: '9509',
  stats: { rush_att: 22, rush_yd: 118, rush_td: 1, rec: 4, rec_yd: 33, rec_2pt: 1, fum_lost: 1 },
}
const K_ROW = {
  player_id: '7839',
  stats: { fgm: 3, fga: 4, fgm_40_49: 2, fgm_50p: 1, xpm: 3, xpmiss: 1 },
}
const DEF_ROW = {
  player_id: 'PHI',
  stats: { sack: 4, int: 2, fum_rec: 1, def_td: 1, safe: 1, pts_allow: 17 },
}
// Rows the adapter must skip: nothing canonical / null stats.
const NOISE_ROW = { player_id: '1049', stats: { pts_ppr: 0.5 } }
const NULL_STATS_ROW = { player_id: '2216', stats: null }

const SCHEDULE = [
  { week: 1, home: 'KC', away: 'BUF', status: 'complete', date: '2026-09-10' },
  { week: 2, home: 'PHI', away: 'DAL', status: 'pre_game', date: '2026-09-17' },
  { week: 2, home: 'NYJ', away: 'MIA', status: null, date: null },
]

// Roster-dump entries (only the fields the adapter and isFantasyRelevant read).
const ROSTER_DUMP = {
  '4881': {
    player_id: '4881', active: true, team: 'BUF', position: 'QB', fantasy_positions: ['QB'],
    injury_status: 'Questionable', injury_start_date: '2026-09-10',
  },
  '9509': {
    player_id: '9509', active: true, team: 'ATL', position: 'RB', fantasy_positions: ['RB'],
    injury_status: null, injury_start_date: null,
  },
  '1234': {
    // Injured but not fantasy-relevant (no current team) — must be skipped.
    player_id: '1234', active: true, team: null, position: 'WR', fantasy_positions: ['WR'],
    injury_status: 'Out', injury_start_date: '2026-08-01',
  },
  '7523': {
    player_id: '7523', active: true, team: 'CIN', position: 'WR', fantasy_positions: ['WR'],
    injury_status: 'Out', injury_start_date: null,
  },
}

// ── fetch stub ──────────────────────────────────────────────────────────────

const ok = (body: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as unknown as Response
const fail = (status: number) =>
  ({ ok: false, status, statusText: 'ERR', json: async () => ({}) }) as unknown as Response

function stubFetch(handler: (url: string) => Response | undefined): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const res = handler(url)
      if (!res) throw new Error(`unexpected fetch in test: ${url}`)
      return res
    }),
  )
}

function stubHappyPath(): void {
  stubFetch((url) => {
    if (url.includes('/stats/nfl/')) {
      const position = /position\[\]=(\w+)/.exec(url)?.[1]
      const rowsByPosition: Record<string, unknown[]> = {
        QB: [QB_ROW, NOISE_ROW, NULL_STATS_ROW],
        RB: [RB_ROW],
        WR: [],
        TE: [],
        K: [K_ROW],
        DEF: [DEF_ROW],
      }
      return ok(rowsByPosition[position ?? ''] ?? [])
    }
    if (url.includes('/schedule/nfl/regular/')) return ok(SCHEDULE)
    if (url.includes('/players/nfl')) return ok(ROSTER_DUMP)
    return undefined
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SleeperStatsProvider', () => {
  it('declares the sleeper_free identity and core_box-only capability (§23.5, D5)', () => {
    const provider = new SleeperStatsProvider(frozenTime)
    expect(provider.name).toBe('sleeper')
    expect([...provider.capabilities]).toEqual(['core_box'])
  })

  it('emits only registry-canonical core_box keys (§7.3.3 one-namespace rule)', () => {
    const byKey = new Map(STAT_KEYS.map((def) => [def.key, def]))
    for (const canonical of Object.values(SLEEPER_STAT_KEY_MAP)) {
      const def = byKey.get(canonical)
      expect(def, `adapter emits unregistered key: ${canonical}`).toBeDefined()
      expect(def?.tier, canonical).toBe('core_box')
      expect(def?.placeholder, canonical).toBeUndefined()
    }
  })

  it('maps trimmed-real weekly rows to canonical payloads and drops non-canonical noise', async () => {
    stubHappyPath()
    const provider = new SleeperStatsProvider(frozenTime)
    const rows = await provider.getWeekStats(2026, 2)
    expect(rows).toEqual([
      {
        playerId: '4881', season: 2026, week: 2,
        stats: { pass_yards: 304, pass_tds: 3, interceptions: 1, pass_2pt: 1, rush_yards: 42, rush_tds: 1 },
        advanced: {},
      },
      {
        playerId: '9509', season: 2026, week: 2,
        stats: { rush_yards: 118, rush_tds: 1, receptions: 4, receiving_yards: 33, rec_2pt: 1, fumbles_lost: 1 },
        advanced: {},
      },
      {
        playerId: '7839', season: 2026, week: 2,
        stats: { fg_40_49: 2, fg_50_plus: 1, pat_made: 3, pat_missed: 1 },
        advanced: {},
      },
      {
        playerId: 'PHI', season: 2026, week: 2,
        stats: { def_sack: 4, def_int: 2, def_fumble_rec: 1, def_td: 1, def_safety: 1 },
        advanced: {},
      },
    ])
  })

  it('surfaces a failed weekly-stats poll as a throw (DegradationTracker input, §23.2)', async () => {
    stubFetch((url) => (url.includes('/stats/nfl/') ? fail(500) : undefined))
    const provider = new SleeperStatsProvider(frozenTime)
    await expect(provider.getWeekStats(2026, 2)).rejects.toThrow(
      'Sleeper weekly stats fetch failed (QB wk2): 500',
    )
  })

  it('maps the schedule with null kickoffs (Q1) and synthesized game ids', async () => {
    stubHappyPath()
    const provider = new SleeperStatsProvider(frozenTime)
    expect(await provider.getSchedule(2026)).toEqual([
      { gameId: '2026-wk01-BUF@KC', season: 2026, week: 1, homeTeam: 'KC', awayTeam: 'BUF', kickoffAt: null, status: 'final' },
      { gameId: '2026-wk02-DAL@PHI', season: 2026, week: 2, homeTeam: 'PHI', awayTeam: 'DAL', kickoffAt: null, status: 'scheduled' },
      { gameId: '2026-wk02-MIA@NYJ', season: 2026, week: 2, homeTeam: 'NYJ', awayTeam: 'MIA', kickoffAt: null, status: 'scheduled' },
    ])
  })

  it('propagates a schedule fetch failure', async () => {
    stubFetch((url) => (url.includes('/schedule/nfl/regular/') ? fail(503) : undefined))
    const provider = new SleeperStatsProvider(frozenTime)
    await expect(provider.getSchedule(2026)).rejects.toThrow('Schedule fetch failed: 503')
  })

  it('filters game states to the requested week', async () => {
    stubHappyPath()
    const provider = new SleeperStatsProvider(frozenTime)
    expect(await provider.getGameStates(2026, 2)).toEqual([
      { gameId: '2026-wk02-DAL@PHI', status: 'scheduled' },
      { gameId: '2026-wk02-MIA@NYJ', status: 'scheduled' },
    ])
  })

  it('reports injuries from the roster dump, skipping healthy and non-fantasy players', async () => {
    stubHappyPath()
    const provider = new SleeperStatsProvider(frozenTime)
    expect(await provider.getInjuries(2026, 2)).toEqual([
      { playerId: '4881', designation: 'questionable', reportedAt: new Date('2026-09-10T00:00:00Z') },
      { playerId: '7523', designation: 'out', reportedAt: FROZEN_NOW },
    ])
  })

  it('returns no inactives — sleeper_free has no official-inactives feed (Q1)', async () => {
    stubFetch(() => undefined) // must not fetch at all
    const provider = new SleeperStatsProvider(frozenTime)
    expect(await provider.getInactives(2026, 2)).toEqual([])
  })
})

describe('mapSleeperGameStatus', () => {
  it('maps known statuses and falls back to scheduled', () => {
    expect(mapSleeperGameStatus('complete')).toBe('final')
    expect(mapSleeperGameStatus('post_game')).toBe('final')
    expect(mapSleeperGameStatus('in_game')).toBe('live')
    expect(mapSleeperGameStatus('pre_game')).toBe('scheduled')
    expect(mapSleeperGameStatus('anything_else')).toBe('scheduled')
    expect(mapSleeperGameStatus(null)).toBe('scheduled')
    expect(mapSleeperGameStatus(undefined)).toBe('scheduled')
  })
})
