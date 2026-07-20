import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ProviderGame,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'

import { STAT_COLUMN_BY_KEY, syncLiveStats, toStatColumns, weeksToFinalize } from './live-stats'
import type { SyncClient } from './types'

describe('weeksToFinalize', () => {
  it('finalizes older weeks still flagged live', () => {
    expect(weeksToFinalize([3, 4], 5, false)).toEqual([3, 4])
    expect(weeksToFinalize([3, 4], 5, true)).toEqual([3, 4])
  })

  it('finalizes the current week only once its window closes', () => {
    expect(weeksToFinalize([5], 5, true)).toEqual([])
    expect(weeksToFinalize([5], 5, false)).toEqual([5])
  })

  it('never touches future weeks and handles the clean state', () => {
    expect(weeksToFinalize([6], 5, false)).toEqual([])
    expect(weeksToFinalize([], 5, false)).toEqual([])
  })
})

// ── The L.A0.2b seam (integration; the repo's first ingestion-path test) ────
//
// syncLiveStats with a stub StatsProvider + VirtualClock + capturing fake
// SyncClient, asserting the exact upsert batches (tasks-M0 §5 L.A0.2b item 4).
// The suite stubs global fetch to THROW: the refactored seam must make zero
// external calls of its own — every read goes through the injected provider.

const SEASON = 2026
// Sunday of 2026 week 2 in the fixture schedule below.
const GAME_DAY = '2026-09-20'
const IN_WINDOW_NOW = new Date('2026-09-20T18:00:00Z') // kickoff day, mid-games
const OUT_OF_WINDOW_NOW = new Date('2026-09-23T18:00:00Z') // > 36h after day start

const WEEK2_GAME: ProviderGame = {
  gameId: '2026-wk02-DAL@PHI',
  season: SEASON,
  week: 2,
  homeTeam: 'PHI',
  awayTeam: 'DAL',
  kickoffAt: null,
  gameDate: GAME_DAY,
  status: 'live',
}

const QB_STATS: ProviderPlayerWeekStats = {
  playerId: '4881',
  season: SEASON,
  week: 2,
  stats: {
    pass_attempts: 38,
    pass_completions: 27,
    pass_yards: 304,
    pass_tds: 3,
    interceptions: 1,
    qb_sack_taken: 2,
    pass_2pt: 1,
    rush_yards: 42,
    rush_tds: 1,
  },
  advanced: {},
}
const RB_STATS: ProviderPlayerWeekStats = {
  playerId: '9509',
  season: SEASON,
  week: 2,
  stats: {
    rush_attempts: 22,
    rush_yards: 118,
    rush_tds: 1,
    targets: 5,
    receptions: 4,
    receiving_yards: 33,
    rush_2pt: 1,
    rec_2pt: 1,
    fumbles_lost: 1,
  },
  advanced: {},
}
const DEF_STATS: ProviderPlayerWeekStats = {
  playerId: 'PHI',
  season: SEASON,
  week: 2,
  stats: { def_sack: 4, def_int: 2, def_points_allowed: 17 },
  advanced: {},
}
// A player the players table doesn't know — must be filtered writer-side.
const UNKNOWN_PLAYER_STATS: ProviderPlayerWeekStats = {
  playerId: '999999',
  season: SEASON,
  week: 2,
  stats: { rush_yards: 50 },
  advanced: {},
}
// Only deferred-storage keys → zero columns → the row must be skipped whole.
const DEFERRED_ONLY_STATS: ProviderPlayerWeekStats = {
  playerId: '7839',
  season: SEASON,
  week: 2,
  stats: { pat_missed: 1, fg_0_39: 2 },
  advanced: {},
}

const KNOWN_IDS = ['4881', '9509', 'PHI', '7839']

interface StubProviderOpts {
  name?: string
  schedule?: ProviderGame[]
  weekStats?: (season: number, week: number) => ProviderPlayerWeekStats[]
}

function stubProvider(opts: StubProviderOpts = {}) {
  const getWeekStats = vi.fn(async (season: number, week: number) =>
    opts.weekStats ? opts.weekStats(season, week) : [],
  )
  const provider: StatsProvider = {
    name: opts.name ?? 'stub',
    capabilities: new Set(['core_box']),
    getSchedule: vi.fn(async () => opts.schedule ?? [WEEK2_GAME]),
    getGameStates: async () => [],
    getWeekStats,
    getInjuries: async () => [],
    getInactives: async () => [],
  }
  return { provider, getWeekStats }
}

interface FakeClientOpts {
  liveWeeks?: number[]
  knownIds?: string[]
  upsertError?: string
}

/** Capturing fake SyncClient covering the three query shapes the seam runs:
 *  the players known-id page scan, the per-week is_live count scan, and the
 *  player_stats upsert. */
function fakeSyncClient(opts: FakeClientOpts = {}) {
  const upsertBatches: Array<Array<Record<string, unknown>>> = []
  const upsertOptions: unknown[] = []
  const client = {
    from(table: string) {
      return {
        // Extra call-site args (column list, count options) are irrelevant to
        // the fake — the cast to SyncClient hides the narrower signature.
        select() {
          if (table === 'players') {
            return {
              order: () => ({
                range: async (from: number) => ({
                  data: from === 0 ? (opts.knownIds ?? KNOWN_IDS).map((id) => ({ id })) : [],
                  error: null,
                }),
              }),
            }
          }
          const filters: Record<string, unknown> = {}
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value
              return chain
            },
            then(resolve: (value: { count: number; error: null }) => void) {
              const week = filters.week as number
              const count = (opts.liveWeeks ?? []).includes(week) ? 3 : 0
              resolve({ count, error: null })
            },
          }
          return chain
        },
        upsert: async (rows: Array<Record<string, unknown>>, upsertOpts: unknown) => {
          if (opts.upsertError) return { error: { message: opts.upsertError } }
          upsertBatches.push(rows)
          upsertOptions.push(upsertOpts)
          return { error: null }
        },
      }
    },
  }
  return { client: client as unknown as SyncClient, upsertBatches, upsertOptions }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function banFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('seam violation: syncLiveStats made a direct external call')
    }),
  )
}

describe('syncLiveStats (seam integration)', () => {
  it('writes the exact upsert batch during a game window — provider payload → columns, D12 stamp, D14 source', async () => {
    banFetch()
    const time = new VirtualClock(IN_WINDOW_NOW)
    const { provider, getWeekStats } = stubProvider({
      name: 'stub',
      weekStats: () => [QB_STATS, RB_STATS, DEF_STATS, UNKNOWN_PLAYER_STATS, DEFERRED_ONLY_STATS],
    })
    const { client, upsertBatches, upsertOptions } = fakeSyncClient()

    const summary = await syncLiveStats(client, provider, SEASON, 2, time)

    expect(getWeekStats).toHaveBeenCalledExactlyOnceWith(SEASON, 2)
    expect(upsertOptions).toEqual([{ onConflict: 'player_id,season,week' }])
    expect(upsertBatches).toEqual([
      [
        {
          player_id: '4881',
          season: SEASON,
          week: 2,
          stat_type: 'weekly',
          source: 'stub', // provider.name flows through — 'sleeper' in prod (D14)
          is_live: true,
          updated_at: '2026-09-20T18:00:00.000Z', // injected virtual time (D12)
          pass_attempts: 38,
          pass_completions: 27,
          pass_yards: 304,
          pass_tds: 3,
          interceptions: 1,
          sacks_taken: 2,
          rush_yards: 42,
          rush_tds: 1,
          two_point_conversions: 1,
        },
        {
          player_id: '9509',
          season: SEASON,
          week: 2,
          stat_type: 'weekly',
          source: 'stub',
          is_live: true,
          updated_at: '2026-09-20T18:00:00.000Z',
          rush_attempts: 22,
          rush_yards: 118,
          rush_tds: 1,
          targets: 5,
          receptions: 4,
          receiving_yards: 33,
          fumbles_lost: 1,
          two_point_conversions: 2, // rush_2pt + rec_2pt summed writer-side
        },
        {
          player_id: 'PHI',
          season: SEASON,
          week: 2,
          stat_type: 'weekly',
          source: 'stub',
          is_live: true,
          updated_at: '2026-09-20T18:00:00.000Z',
          def_sacks: 4,
          def_interceptions: 2,
          def_points_allowed: 17,
        },
        // '999999' filtered (unknown player); '7839' skipped (no columns).
      ],
    ])
    expect(summary).toEqual({ name: 'live-stats', counts: { 'live-wk2': 3 }, warnings: [] })
  })

  it('stamps updated_at from the injected clock — advancing virtual time moves the stamp (D12 falsifiability)', async () => {
    banFetch()
    const time = new VirtualClock(IN_WINDOW_NOW)
    const { provider } = stubProvider({ weekStats: () => [QB_STATS] })

    const first = fakeSyncClient()
    await syncLiveStats(first.client, provider, SEASON, 2, time)
    time.advanceBy(90_000)
    const second = fakeSyncClient()
    await syncLiveStats(second.client, provider, SEASON, 2, time)

    expect(first.upsertBatches[0][0].updated_at).toBe('2026-09-20T18:00:00.000Z')
    expect(second.upsertBatches[0][0].updated_at).toBe('2026-09-20T18:01:30.000Z')
  })

  it('runs a FINAL pass (is_live=false) for lingering live weeks behind the window', async () => {
    banFetch()
    const time = new VirtualClock(OUT_OF_WINDOW_NOW)
    const { provider, getWeekStats } = stubProvider({
      weekStats: (_season, week) => [{ ...QB_STATS, week }],
    })
    const { client, upsertBatches } = fakeSyncClient({ liveWeeks: [1, 2] })

    const summary = await syncLiveStats(client, provider, SEASON, 2, time)

    expect(getWeekStats.mock.calls).toEqual([
      [SEASON, 1],
      [SEASON, 2],
    ])
    expect(upsertBatches).toHaveLength(2)
    for (const batch of upsertBatches) {
      expect(batch).toHaveLength(1)
      expect(batch[0].is_live).toBe(false)
    }
    expect(summary.counts).toEqual({ 'finalized-wk1': 1, 'finalized-wk2': 1 })
  })

  it('skips without polling stats when no window is open and nothing lingers', async () => {
    banFetch()
    const time = new VirtualClock(OUT_OF_WINDOW_NOW)
    const { provider, getWeekStats } = stubProvider()
    const { client, upsertBatches } = fakeSyncClient()

    const summary = await syncLiveStats(client, provider, SEASON, 2, time)

    expect(getWeekStats).not.toHaveBeenCalled()
    expect(upsertBatches).toEqual([])
    expect(summary).toEqual({
      name: 'live-stats',
      counts: { skipped: 1 },
      warnings: ['week 2: no game window open — skipped'],
    })
  })

  it('no-ops in the offseason without touching the provider at all', async () => {
    banFetch()
    const time = new VirtualClock(IN_WINDOW_NOW)
    const { provider } = stubProvider()
    const { client } = fakeSyncClient()

    for (const week of [0, 19]) {
      const summary = await syncLiveStats(client, provider, SEASON, week, time)
      expect(summary.warnings).toEqual(['offseason — skipped'])
    }
    expect(provider.getSchedule).not.toHaveBeenCalled()
  })

  it('splits upserts into batches of 500, preserving order', async () => {
    banFetch()
    const time = new VirtualClock(IN_WINDOW_NOW)
    const ids = Array.from({ length: 501 }, (_, i) => `p${i}`)
    const { provider } = stubProvider({
      weekStats: () =>
        ids.map((playerId) => ({
          playerId,
          season: SEASON,
          week: 2,
          stats: { rush_yards: 10 },
          advanced: {},
        })),
    })
    const { client, upsertBatches } = fakeSyncClient({ knownIds: ids })

    const summary = await syncLiveStats(client, provider, SEASON, 2, time)

    expect(upsertBatches.map((b) => b.length)).toEqual([500, 1])
    expect(upsertBatches[0][0].player_id).toBe('p0')
    expect(upsertBatches[1][0].player_id).toBe('p500')
    expect(summary.counts['live-wk2']).toBe(501)
  })

  it('propagates provider failures (DegradationTracker input, §23.2) and upsert failures', async () => {
    banFetch()
    const time = new VirtualClock(IN_WINDOW_NOW)
    const failing = stubProvider().provider
    ;(failing.getWeekStats as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Sleeper weekly stats fetch failed (QB wk2): 500'),
    )
    await expect(
      syncLiveStats(fakeSyncClient().client, failing, SEASON, 2, time),
    ).rejects.toThrow('Sleeper weekly stats fetch failed (QB wk2): 500')

    const { provider } = stubProvider({ weekStats: () => [QB_STATS] })
    const { client } = fakeSyncClient({ upsertError: 'connection reset' })
    await expect(syncLiveStats(client, provider, SEASON, 2, time)).rejects.toThrow(
      'stats upsert failed (wk2): connection reset',
    )
  })
})

describe('toStatColumns (D22 column surface)', () => {
  it('writes exactly the pre-seam STAT_MAP column surface — nothing dropped, nothing invented', () => {
    // The 27 player_stats columns the pre-refactor STAT_MAP wrote (D22's
    // enumerated non-catalog columns included). If a registry edit drops a
    // column mapping — or adds a new write — this pin fails.
    const PRE_SEAM_COLUMNS = [
      'pass_attempts',
      'pass_completions',
      'pass_yards',
      'pass_tds',
      'interceptions',
      'sacks_taken',
      'rush_attempts',
      'rush_yards',
      'rush_tds',
      'fumbles_lost',
      'targets',
      'receptions',
      'receiving_yards',
      'receiving_tds',
      'two_point_conversions',
      'fg_made',
      'fg_attempted',
      'fg_made_40_plus',
      'fg_made_50_plus',
      'xp_made',
      'xp_attempted',
      'def_sacks',
      'def_interceptions',
      'def_fumble_recoveries',
      'def_tds',
      'def_safeties',
      'def_points_allowed',
    ].sort()
    const writableSurface = [
      ...new Set([...Object.values(STAT_COLUMN_BY_KEY), 'two_point_conversions']),
    ].sort()
    expect(writableSurface).toEqual(PRE_SEAM_COLUMNS)
  })

  it('sums the per-type 2-pt keys into the single column, only when at least one is present', () => {
    expect(toStatColumns({ pass_2pt: 1, rec_2pt: 1 })).toEqual({ two_point_conversions: 2 })
    expect(toStatColumns({ rush_2pt: 2 })).toEqual({ two_point_conversions: 2 })
    expect(toStatColumns({ rush_yards: 10 })).toEqual({ rush_yards: 10 })
  })

  it('drops deferred-storage keys instead of inventing columns for them', () => {
    expect(toStatColumns({ pat_missed: 1, fg_0_39: 2, def_pa_1_6: 1 })).toEqual({})
  })
})
