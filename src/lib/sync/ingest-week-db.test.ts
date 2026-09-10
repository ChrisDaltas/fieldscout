/**
 * ingest-week-db.test.ts — L.D2.1 over the REAL local stack (spec §22.2 top
 * half, §23.2, §23.3, E42/E43/E45; PROGRESS D300/D303; F13 flips here).
 *
 * The §23.6 SyntheticStatsProvider on a VirtualClock drives `ingestWeek`
 * against the local Supabase tables with the service-role client (this
 * writer is sync territory — tasks-M4 §4 rule 9). Pins, each a stored
 * literal or a counted result:
 *   - the golden first poll (nfl_games × 3, nfl_weeks.first_kickoff_at,
 *     player_stats × 6 with `source='synthetic'`, `advanced` on the D15
 *     placeholder key, the D12 stamp, score_fanout × 6);
 *   - DIFF-AWARENESS: an identical re-poll writes 0 and enqueues 0 (the
 *     DoD break probe — skip the diff — turns this red); a moved poll
 *     updates exactly the moved rows (5 of 6 at 18:40) and the PK dedupe
 *     swallows an undrained re-enqueue (D292);
 *   - E42: the `flex_move` scenario moves `nfl_games.kickoff_at` at the
 *     announcement instant (announceAt−1s unchanged / announceAt moved —
 *     D146), and nfl_weeks.first_kickoff_at stays the week's first game;
 *   - E45: the `provider_outage` scenario writes NOTHING during the outage,
 *     raises `stats_degraded` on exactly the 3rd failed poll (2 → false,
 *     3 → true), clears on recovery, and the recovered rows EQUAL the
 *     uninterrupted `happy_path` state at the same instant (same seed —
 *     the back-fill is the cumulative read, R26's reading);
 *   - E43: a postponed-out game is stored `postponed` and never bounds the
 *     week; `last_game_ends_at` stamps at the LATER of the all-final instant
 *     and Q50's Tuesday 00:00 Pacific floor (−1s from all-final: NULL);
 *   - F13: `source` follows `provider.name` per provider — a second
 *     provider over the same rows flips ONLY provenance (written, not
 *     enqueued);
 *   - loud emptiness: an unknown player is counted, a kickoff-less tier
 *     writes no games and says why;
 *   - R706 (at-least-once): the queue is written BEFORE player_stats, so a
 *     crash between the two calls leaves the stored row stale and the next
 *     poll re-detects and re-enqueues the delta (the probe — stats first —
 *     loses it: 0 re-enqueued); `enqueued_at === updated_at` on a clean
 *     poll, the L.D2.2 readiness predicate (F218);
 *   - R707: a schedule week the calendar does not know (week 19) is
 *     skipped, counted (`outsideCalendar`) and named, the live week still
 *     lands — and its one-unit sibling week 18 IS maintained; ingesting
 *     week 19 itself refuses before any write.
 *
 * Fixture hygiene (F199, tightened for R708): the 18 synthetic players are
 * inserted here and removed after; every touched row is restored BY ID —
 * the synthetic game ids share real data's `${season}-wk02-…` shape
 * (sleeperGameId), so no prefix deletes — and the stat/queue deletes are
 * `syn-%`-scoped. The (2026, 2) and (2026, 18) nfl_weeks bounds are put
 * back: pgTAP 003 pins them NULL, so `afterAll` MUST restore them. If the
 * stack is down this suite FAILS (never skips — D59).
 */
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type {
  ProviderGame,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '@/lib/leagues/stats/stats-provider'
import { makeScenario } from '@/lib/leagues/stats/synthetic/scenarios'
import type { ScenarioId } from '@/lib/leagues/stats/synthetic/scenario'
import { SyntheticStatsProvider } from '@/lib/leagues/stats/synthetic/synthetic-stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'

import { ingestWeek, type IngestIo, type IngestReport } from './ingest-week'
import type { SyncClient } from './types'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const db = service as unknown as SyncClient

const SEASON = 2026
const WEEK = 2
const G1 = '2026-wk02-DAL@PHI'
const G2 = '2026-wk02-BUF@KC'
const G3 = '2026-wk02-SEA@SF'
// R707's pair: week 18 is the calendar's last seeded row (039), week 19 the
// first outside it. Synthetic ids on purpose — `syn-` so they can never
// collide with a real feed's `${season}-wk18-…`.
const G18 = 'syn-2026-wk18-BUF@KC'
const G19 = 'syn-2026-wk19-BUF@KC'
const SYN_GAME_IDS = [G1, G2, G3, G18, G19]
const RESTORED_WEEKS = [WEEK, 18]

// The scenario library's 18 players (scenarios.ts basePlayers) — FK targets
// for player_stats / score_fanout. Inserted here, removed in afterAll.
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const SYNTHETIC_PLAYERS = [1, 2, 3].flatMap((g) =>
  POSITIONS.map((position) => ({
    id: `syn-g${g}-${position.toLowerCase()}`,
    full_name: `Synthetic G${g} ${position}`,
    position,
    team: 'SYN',
  })),
)

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function cleanup(): Promise<void> {
  await must(service.from('score_fanout').delete().like('player_id', 'syn-%'), 'cleanup score_fanout')
  await must(service.from('player_stats').delete().like('player_id', 'syn-%'), 'cleanup player_stats')
  await must(service.from('nfl_games').delete().in('id', SYN_GAME_IDS), 'cleanup nfl_games')
  await must(
    service
      .from('nfl_weeks')
      .update({ first_kickoff_at: null, last_game_ends_at: null })
      .eq('season', SEASON)
      .in('week', RESTORED_WEEKS),
    'cleanup nfl_weeks',
  )
}

beforeAll(async () => {
  await cleanup()
  await must(service.from('players').delete().like('id', 'syn-%'), 'cleanup players')
  await must(service.from('players').insert(SYNTHETIC_PLAYERS), 'insert synthetic players')
})

afterAll(async () => {
  await cleanup()
  await must(service.from('players').delete().like('id', 'syn-%'), 'cleanup players')
  // pgTAP 003 pins these NULL for every 2026 week — prove the restore.
  const rows = await must(
    service
      .from('nfl_weeks')
      .select('week')
      .eq('season', SEASON)
      .or('first_kickoff_at.not.is.null,last_game_ends_at.not.is.null'),
    'verify nfl_weeks restored',
  )
  expect(rows).toEqual([])
})

beforeEach(async () => {
  await cleanup()
})

function synthetic(id: ScenarioId, clock: VirtualClock): SyntheticStatsProvider {
  return new SyntheticStatsProvider(makeScenario(id), clock)
}

function io(degradation = new DegradationTracker()): IngestIo {
  return { db, degradation, season: SEASON, week: WEEK }
}

async function poll(provider: StatsProvider, clock: VirtualClock, iso: string, deps: IngestIo): Promise<IngestReport> {
  clock.advanceTo(new Date(iso))
  return ingestWeek(provider, clock, deps)
}

interface StoredStat {
  player_id: string
  game_id: string | null
  is_live: boolean
  source: string
  updated_at: string
  advanced: Record<string, number>
  pass_attempts: number
  pass_yards: number
  sacks_taken: number
  rush_yards: number
  def_sacks: number
  def_points_allowed: number
  fg_made: number
}

async function storedStats(): Promise<Map<string, StoredStat>> {
  const rows = await must(
    service
      .from('player_stats')
      .select(
        'player_id, game_id, is_live, source, updated_at, advanced, pass_attempts, pass_yards, sacks_taken, rush_yards, def_sacks, def_points_allowed, fg_made',
      )
      .eq('season', SEASON)
      .eq('week', WEEK)
      .like('player_id', 'syn-%')
      .order('player_id'),
    'read player_stats',
  )
  return new Map((rows as unknown as StoredStat[]).map((r) => [r.player_id, r]))
}

async function storedGames(): Promise<Map<string, { kickoff_at: string; status: string; updated_at: string }>> {
  const rows = await must(
    service.from('nfl_games').select('id, kickoff_at, status, updated_at').in('id', SYN_GAME_IDS).order('id'),
    'read nfl_games',
  )
  return new Map(
    (rows as Array<{ id: string; kickoff_at: string; status: string; updated_at: string }>).map((r) => [
      r.id,
      {
        kickoff_at: new Date(r.kickoff_at).toISOString(),
        status: r.status,
        updated_at: new Date(r.updated_at).toISOString(),
      },
    ]),
  )
}

async function storedWeek(): Promise<{ first_kickoff_at: string | null; last_game_ends_at: string | null }> {
  const rows = await must(
    service.from('nfl_weeks').select('first_kickoff_at, last_game_ends_at').eq('season', SEASON).eq('week', WEEK),
    'read nfl_weeks',
  )
  const row = (rows as Array<{ first_kickoff_at: string | null; last_game_ends_at: string | null }>)[0]
  return {
    first_kickoff_at: row.first_kickoff_at === null ? null : new Date(row.first_kickoff_at).toISOString(),
    last_game_ends_at: row.last_game_ends_at === null ? null : new Date(row.last_game_ends_at).toISOString(),
  }
}

async function queuedRows(): Promise<Array<{ player_id: string; enqueued_at: string }>> {
  const rows = await must(
    service
      .from('score_fanout')
      .select('player_id, enqueued_at')
      .eq('season', SEASON)
      .eq('week', WEEK)
      .like('player_id', 'syn-%')
      .order('player_id'),
    'read score_fanout',
  )
  return (rows as Array<{ player_id: string; enqueued_at: string }>).map((r) => ({
    player_id: r.player_id,
    enqueued_at: new Date(r.enqueued_at).toISOString(),
  }))
}

async function queued(): Promise<string[]> {
  return (await queuedRows()).map((r) => r.player_id)
}

/** A db whose `player_stats` WRITE throws — the invocation dying between the
 *  enqueue and the stats upsert (R706). Reads are untouched. */
function crashingBeforeStatsWrite(): SyncClient {
  return {
    from(table: string) {
      const builder = service.from(table)
      if (table === 'player_stats') {
        builder.upsert = (() => {
          throw new Error('simulated crash between the enqueue and the player_stats write')
        }) as typeof builder.upsert
      }
      return builder
    },
  } as unknown as SyncClient
}

const G1_PLAYERS = ['syn-g1-def', 'syn-g1-k', 'syn-g1-qb', 'syn-g1-rb', 'syn-g1-te', 'syn-g1-wr']

describe('ingestWeek — the golden first poll and diff-awareness (§22.2/§23.2)', () => {
  it('writes nfl_games, nfl_weeks.first_kickoff_at, player_stats (+advanced, source, D12 stamp) and enqueues exactly the new rows', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z')) // G1 live 60 of 200 min; G2/G3 ahead
    const provider = synthetic('happy_path', clock)
    const report = await poll(provider, clock, '2026-09-20T18:00:00Z', io())

    expect(report.ok).toBe(true)
    expect(report.degraded).toBe(false)
    expect(report.polledAt).toBe('2026-09-20T18:00:00.000Z')
    expect(report.games).toEqual({ seen: 3, withoutKickoff: 0, inserted: 3, updated: 0, unchanged: 0 })
    expect(report.weeks).toEqual({ touched: 1, updated: 1, unchanged: 0, outsideCalendar: 0 })
    expect(report.stats).toEqual({
      seen: 6,
      unknownPlayer: 0,
      empty: 0,
      droppedAdvancedKeys: 0,
      inserted: 6,
      updated: 0,
      metaOnly: 0,
      unchanged: 0,
      deltas: 6,
      enqueued: 6,
      restamped: 0,
    })
    expect(report.reasons).toEqual([])

    // nfl_games — the table's first writer (C58): the scenario's three literals.
    const games = await storedGames()
    expect(games.get(G1)).toEqual({ kickoff_at: '2026-09-20T17:00:00.000Z', status: 'live', updated_at: '2026-09-20T18:00:00.000Z' })
    expect(games.get(G2)).toEqual({ kickoff_at: '2026-09-20T20:25:00.000Z', status: 'scheduled', updated_at: '2026-09-20T18:00:00.000Z' })
    expect(games.get(G3)).toEqual({ kickoff_at: '2026-09-21T00:20:00.000Z', status: 'scheduled', updated_at: '2026-09-20T18:00:00.000Z' })

    // nfl_weeks — F9's columns, live at last: first kickoff = G1; nothing final yet.
    expect(await storedWeek()).toEqual({ first_kickoff_at: '2026-09-20T17:00:00.000Z', last_game_ends_at: null })

    // player_stats — the QB literal (finalLine × 0.3 progress): every column from
    // the provider, source = provider.name (F13), the D12 stamp, advanced on the
    // D15 tracking key ONLY (charted posts Monday — absent = pending, §23.5).
    const stats = await storedStats()
    expect([...stats.keys()]).toEqual(G1_PLAYERS)
    expect(stats.get('syn-g1-qb')).toEqual({
      player_id: 'syn-g1-qb',
      game_id: G1,
      is_live: true,
      source: 'synthetic',
      updated_at: '2026-09-20T18:00:00+00:00',
      advanced: { example_tracking_yards: 36 },
      pass_attempts: 10,
      pass_yards: 56,
      sacks_taken: 0,
      rush_yards: 1,
      def_sacks: 0,
      def_points_allowed: 0,
      fg_made: 0,
    })
    expect(stats.get('syn-g1-def')!.def_sacks).toBe(1)
    expect(stats.get('syn-g1-def')!.def_points_allowed).toBe(9)
    expect(stats.get('syn-g1-def')!.advanced).toEqual({}) // DEF has no tracking line
    for (const row of stats.values()) expect(row.source).toBe('synthetic')

    expect(await queued()).toEqual(G1_PLAYERS)
    // The L.D2.2 readiness predicate (R706/F218): on a clean poll the queue
    // row and the stat row carry the SAME injected instant, so
    // `updated_at >= enqueued_at` reads "the stats for this delta landed".
    for (const q of await queuedRows()) {
      expect(q.enqueued_at).toBe('2026-09-20T18:00:00.000Z')
      expect(new Date(stats.get(q.player_id)!.updated_at).toISOString()).toBe(q.enqueued_at)
    }
  })

  it('an IDENTICAL re-poll writes nothing and enqueues nothing — counted (the zero-delta pin; the DoD probe reds here)', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const provider = synthetic('happy_path', clock)
    const deps = io()
    await poll(provider, clock, '2026-09-20T18:00:00Z', deps)
    const before = await storedStats()

    const again = await poll(provider, clock, '2026-09-20T18:00:00Z', deps)

    expect(again.games).toEqual({ seen: 3, withoutKickoff: 0, inserted: 0, updated: 0, unchanged: 3 })
    expect(again.weeks).toEqual({ touched: 1, updated: 0, unchanged: 1, outsideCalendar: 0 })
    expect(again.stats.inserted + again.stats.updated + again.stats.metaOnly).toBe(0)
    expect(again.stats.unchanged).toBe(6)
    expect(again.stats.deltas).toBe(0)
    expect(again.stats.enqueued).toBe(0)
    expect(again.reasons).toEqual([
      'nfl_games unchanged: 3 games identical to stored',
      'player_stats unchanged: 6 rows identical to stored',
      'score_fanout: no scoring delta — nothing enqueued',
    ])
    // Nothing touched: the D12 stamps did not move.
    expect(await storedStats()).toEqual(before)
    expect(await queued()).toEqual(G1_PLAYERS)
  })

  it('a moved poll updates exactly the moved rows; an undrained queue dedupes (D292); a drained one re-enqueues', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const provider = synthetic('happy_path', clock)
    const deps = io()
    await poll(provider, clock, '2026-09-20T18:00:00Z', deps)

    // +20 min: every G1 line moved (measured), but the queue still holds all 6
    // → 0 NEW rows (the PK dedupe, D292) — RE-STAMPED to 18:20 (D321(2): the
    // worker acks by stamp, so a delta landing mid-drain moves the stamp and
    // survives the ack; the probe — `ignoreDuplicates: true` — leaves 18:00).
    const moved = await poll(provider, clock, '2026-09-20T18:20:00Z', deps)
    expect(moved.stats.updated).toBe(6)
    expect(moved.stats.unchanged).toBe(0)
    expect(moved.stats.deltas).toBe(6)
    expect(moved.stats.enqueued).toBe(0)
    expect(moved.stats.restamped).toBe(6)
    expect(moved.reasons).toContain(
      'score_fanout: all 6 deltas already queued (PK dedupe) — re-stamped to 2026-09-20T18:20:00.000Z (D321(2))',
    )
    const restamped = await queuedRows()
    expect(restamped).toHaveLength(6)
    for (const q of restamped) expect(q.enqueued_at).toBe('2026-09-20T18:20:00.000Z')
    expect((await storedStats()).get('syn-g1-qb')).toMatchObject({
      pass_attempts: 14,
      pass_yards: 75,
      sacks_taken: 1,
      updated_at: '2026-09-20T18:20:00+00:00',
      advanced: { example_tracking_yards: 49 },
    })
    // A game status flip alone is a real nfl_games change; here nothing flipped.
    expect(moved.games).toEqual({ seen: 3, withoutKickoff: 0, inserted: 0, updated: 0, unchanged: 3 })

    // Drain (what the L.D2.2 worker will do), then +20 min: the K's line is the
    // one that did not move between 18:20 and 18:40 (measured) → 5 updates,
    // 1 unchanged, 5 NEW queue rows — the diff is per row, not per poll.
    await must(service.from('score_fanout').delete().eq('season', SEASON).eq('week', WEEK).like('player_id', 'syn-%'), 'drain')
    const later = await poll(provider, clock, '2026-09-20T18:40:00Z', deps)
    expect(later.stats.updated).toBe(5)
    expect(later.stats.unchanged).toBe(1)
    expect(later.stats.deltas).toBe(5)
    expect(later.stats.enqueued).toBe(5)
    const q = await queued()
    expect(q).toHaveLength(5)
    expect(q).not.toContain('syn-g1-k')
    const stats = await storedStats()
    expect(stats.get('syn-g1-k')!.updated_at).toBe('2026-09-20T18:20:00+00:00') // untouched row keeps its stamp
    expect(stats.get('syn-g1-qb')!.updated_at).toBe('2026-09-20T18:40:00+00:00')
  })
})

describe('E42 — flex_move moves nfl_games.kickoff_at at the announcement instant', () => {
  it('announceAt−1s: unchanged; announceAt: G3 moves Sun-night → Sun-late, G1/G2 untouched, first_kickoff_at stays G1', async () => {
    const clock = new VirtualClock(new Date('2026-09-17T12:00:00Z'))
    const provider = synthetic('flex_move', clock)
    const deps = io()

    const first = await poll(provider, clock, '2026-09-17T12:00:00Z', deps)
    expect(first.games).toEqual({ seen: 3, withoutKickoff: 0, inserted: 3, updated: 0, unchanged: 0 })
    expect(first.stats.seen).toBe(0) // Thursday — nothing has kicked off
    expect(first.reasons).toEqual([
      'provider returned zero stat rows for 2026 week 2',
      'score_fanout: no scoring delta — nothing enqueued',
    ])
    expect((await storedGames()).get(G3)!.kickoff_at).toBe('2026-09-21T00:20:00.000Z')

    const before = await poll(provider, clock, '2026-09-17T19:59:59Z', deps)
    expect(before.games).toEqual({ seen: 3, withoutKickoff: 0, inserted: 0, updated: 0, unchanged: 3 })
    expect((await storedGames()).get(G3)!.kickoff_at).toBe('2026-09-21T00:20:00.000Z')

    const at = await poll(provider, clock, '2026-09-17T20:00:00Z', deps)
    expect(at.games).toEqual({ seen: 3, withoutKickoff: 0, inserted: 0, updated: 1, unchanged: 2 })
    const games = await storedGames()
    expect(games.get(G3)).toEqual({ kickoff_at: '2026-09-20T21:05:00.000Z', status: 'scheduled', updated_at: '2026-09-17T20:00:00.000Z' })
    expect(games.get(G1)!.updated_at).toBe('2026-09-17T12:00:00.000Z') // untouched rows keep their stamp
    expect(games.get(G2)!.updated_at).toBe('2026-09-17T12:00:00.000Z')
    // The E42 datum is nfl_games.kickoff_at; the week's first kickoff did not move.
    expect(await storedWeek()).toEqual({ first_kickoff_at: '2026-09-20T17:00:00.000Z', last_game_ends_at: null })
    expect(at.weeks).toEqual({ touched: 1, updated: 0, unchanged: 1, outsideCalendar: 0 })
  })
})

describe('E45 — provider_outage raises stats_degraded on the 3rd failed poll, writes nothing, clears and back-fills on recovery', () => {
  it('2 failures → not degraded; 3 → degraded; recovery clears it and the rows equal the uninterrupted happy_path state', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T17:40:00Z'))
    const provider = synthetic('provider_outage', clock)
    const tracker = new DegradationTracker()
    const deps = io(tracker)

    const healthy = await poll(provider, clock, '2026-09-20T17:40:00Z', deps)
    expect(healthy.ok).toBe(true)
    expect(healthy.stats.inserted).toBe(6)
    const beforeOutage = await storedStats()
    const queueBefore = await queued()

    // The outage window is [18:00, 18:40) — three polls inside it.
    const fail1 = await poll(provider, clock, '2026-09-20T18:00:00Z', deps)
    expect(fail1.ok).toBe(false)
    expect(fail1.degraded).toBe(false)
    const fail2 = await poll(provider, clock, '2026-09-20T18:10:00Z', deps)
    expect(fail2.ok).toBe(false)
    expect(fail2.degraded).toBe(false) // one unit short of the §23.2 threshold
    const fail3 = await poll(provider, clock, '2026-09-20T18:20:00Z', deps)
    expect(fail3.ok).toBe(false)
    expect(fail3.degraded).toBe(true) // exactly the 3rd
    expect(fail3.error).toContain('synthetic provider outage (scenario provider_outage)')
    expect(fail3.reasons).toEqual(['provider poll failed — nothing written (§23.2 never partial data); stats_degraded=true'])
    expect(fail3.stats).toMatchObject({ seen: 0, inserted: 0, updated: 0, deltas: 0, enqueued: 0 })
    expect(tracker.degraded).toBe(true)

    // Never partial data: nothing moved during the outage.
    expect(await storedStats()).toEqual(beforeOutage)
    expect(await queued()).toEqual(queueBefore)
    expect((await storedGames()).get(G1)!.updated_at).toBe('2026-09-20T17:40:00.000Z')

    // Recovery at the window's end instant (the outage is half-open) — the
    // flag clears and the cumulative read IS the back-fill.
    await must(service.from('score_fanout').delete().eq('season', SEASON).eq('week', WEEK).like('player_id', 'syn-%'), 'drain')
    const recovered = await poll(provider, clock, '2026-09-20T18:40:00Z', deps)
    expect(recovered.ok).toBe(true)
    expect(recovered.degraded).toBe(false)
    expect(tracker.degraded).toBe(false)
    expect(recovered.stats.updated).toBe(6) // every G1 line moved across the gap (measured)
    expect(recovered.stats.enqueued).toBe(6)

    // The comparator: happy_path shares the seed and has no outage, so its
    // 18:40 lines are the uninterrupted truth the recovered rows must equal.
    const comparator = synthetic('happy_path', new VirtualClock(new Date('2026-09-20T18:40:00Z')))
    const truth = await comparator.getWeekStats(SEASON, WEEK)
    const stats = await storedStats()
    expect(truth).toHaveLength(6)
    for (const line of truth) {
      const row = stats.get(line.playerId)!
      expect(row.pass_attempts, line.playerId).toBe(line.stats.pass_attempts ?? 0)
      expect(row.pass_yards, line.playerId).toBe(line.stats.pass_yards ?? 0)
      expect(row.rush_yards, line.playerId).toBe(line.stats.rush_yards ?? 0)
      expect(row.def_sacks, line.playerId).toBe(line.stats.def_sack ?? 0)
      expect(row.def_points_allowed, line.playerId).toBe(line.stats.def_points_allowed ?? 0)
      expect(row.fg_made, line.playerId).toBe(line.stats.fg_made ?? 0)
      expect(row.advanced, line.playerId).toEqual(line.advanced)
      expect(row.updated_at, line.playerId).toBe('2026-09-20T18:40:00+00:00')
    }
    expect(stats.get('syn-g1-qb')).toMatchObject({ pass_attempts: 18, pass_yards: 94, advanced: { example_tracking_yards: 61 } })
  })
})

describe('E43 / §12.20 / Q50 — postponement and the last_game_ends_at rule', () => {
  /** 2026 week 2's floor: the first Tuesday 00:00 America/Los_Angeles after
   *  the seeded `starts_at` 2026-09-16T04:00:00Z (039:66). PDT ⇒ 07:00Z. */
  const WEEK2_FLOOR = '2026-09-22T07:00:00.000Z'

  it('a postponed-out game is stored postponed with its moved kickoff and never bounds the week; its players emit no lines', async () => {
    const clock = new VirtualClock(new Date('2026-09-21T04:00:00Z')) // Monday 04:00Z — G1/G3 final, G2 postponed
    const provider = synthetic('postponement', clock)
    const report = await poll(provider, clock, '2026-09-21T04:00:00Z', io())
    const games = await storedGames()
    expect(games.get(G2)).toEqual({ kickoff_at: '2026-09-27T20:25:00.000Z', status: 'postponed', updated_at: '2026-09-21T04:00:00.000Z' })
    expect(games.get(G1)!.status).toBe('final')
    expect(games.get(G3)!.status).toBe('final')
    // Both in-week games are final (G2 excluded) ⇒ the week RELEASES — held
    // to Q50's floor, because this Monday observation is before it.
    expect(await storedWeek()).toEqual({ first_kickoff_at: '2026-09-20T17:00:00.000Z', last_game_ends_at: WEEK2_FLOOR })
    expect(report.stats.inserted).toBe(12) // 18 players − G2's 6 (postponed: score 0, no line — §23.3)
    const stats = await storedStats()
    expect([...stats.keys()].some((id) => id.startsWith('syn-g2-'))).toBe(false)
    for (const row of stats.values()) expect(row.is_live).toBe(false) // both remaining games final
  })

  it('last_game_ends_at is NULL one second before the last game ends and stamps at Q50’s FLOOR, not the ending instant (D146 + Q50)', async () => {
    const clock = new VirtualClock(new Date('2026-09-21T03:39:59Z'))
    const provider = synthetic('happy_path', clock)
    const deps = io()
    await poll(provider, clock, '2026-09-21T03:39:59Z', deps) // G3 still live (ends 03:40:00Z)
    expect(await storedWeek()).toEqual({ first_kickoff_at: '2026-09-20T17:00:00.000Z', last_game_ends_at: null })
    const at = await poll(provider, clock, '2026-09-21T03:40:00Z', deps)
    expect(at.games.updated).toBe(1) // G3 live → final
    expect(at.weeks).toEqual({ touched: 1, updated: 1, unchanged: 0, outsideCalendar: 0 })
    // The games ended at 03:40:00Z (Sun 20:40 PDT); the RELEASE is the floor,
    // ~27 h later. Before Q50 this cell read '2026-09-21T03:40:00.000Z'.
    expect(await storedWeek()).toEqual({ first_kickoff_at: '2026-09-20T17:00:00.000Z', last_game_ends_at: WEEK2_FLOOR })
    // Kept on the next poll, not re-stamped.
    const later = await poll(provider, clock, '2026-09-21T04:00:00Z', deps)
    expect(later.weeks).toEqual({ touched: 1, updated: 0, unchanged: 1, outsideCalendar: 0 })
    expect((await storedWeek()).last_game_ends_at).toBe(WEEK2_FLOOR)
    // One second before the end every nonzero G3 line reads floor(v × (1 − ε)) = v − 1,
    // so the ending instant is a scoring delta for all six G3 players (measured);
    // the 11 G1/G2 rows, final for hours, are unchanged.
    expect(at.stats).toMatchObject({ updated: 6, unchanged: 11, metaOnly: 0, deltas: 6 })
    expect(later.stats).toMatchObject({ updated: 0, unchanged: 17, metaOnly: 0, deltas: 0 })
  })

  it('Q50 past the floor: the FIRST all-final poll landing after Tuesday 00:00 PT stamps ITSELF — release is immediate, never the following Tuesday', async () => {
    // The outage/late-poll shape of Chris's weather-delay case: the games are
    // long over, nothing observed them until Tuesday afternoon. `max()` yields
    // the observation, and the floor — anchored on the WEEK, not on a kickoff
    // — cannot push this to 2026-09-29.
    const clock = new VirtualClock(new Date('2026-09-22T21:00:00Z')) // Tue 14:00 PDT
    const provider = synthetic('happy_path', clock)
    await poll(provider, clock, '2026-09-22T21:00:00Z', io())
    expect((await storedWeek()).last_game_ends_at).toBe('2026-09-22T21:00:00.000Z')
  })
})

/** A provider that delegates to the synthetic tier under another name. */
function renamed(inner: StatsProvider, name: string): StatsProvider {
  return {
    name,
    capabilities: inner.capabilities,
    getSchedule: (s) => inner.getSchedule(s),
    getGameStates: (s, w) => inner.getGameStates(s, w),
    getWeekStats: (s, w) => inner.getWeekStats(s, w),
    getInjuries: (s, w) => inner.getInjuries(s, w),
    getInactives: (s, w) => inner.getInactives(s, w),
  }
}

describe('F13 — provenance follows provider.name, per provider', () => {
  it('a second provider over identical lines flips ONLY source (metaOnly, not a scoring delta — nothing enqueued)', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const inner = synthetic('happy_path', clock)
    const deps = io()
    await poll(inner, clock, '2026-09-20T18:00:00Z', deps)
    for (const row of (await storedStats()).values()) expect(row.source).toBe('synthetic')
    await must(service.from('score_fanout').delete().eq('season', SEASON).eq('week', WEEK).like('player_id', 'syn-%'), 'drain')

    const other = renamed(inner, 'fixture:synthetic')
    const report = await poll(other, clock, '2026-09-20T18:00:00Z', deps)
    expect(report.provider).toBe('fixture:synthetic')
    expect(report.stats).toMatchObject({ updated: 0, metaOnly: 6, unchanged: 0, deltas: 0, enqueued: 0 })
    for (const row of (await storedStats()).values()) expect(row.source).toBe('fixture:synthetic')
    expect(await queued()).toEqual([])
  })
})

describe('R706 — the queue is written BEFORE player_stats, so a crash between them is at-least-once, never lost', () => {
  it('a crash after the enqueue leaves the stored row stale; the next poll re-detects and re-enqueues the delta (the probe — stats first — re-enqueues 0)', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const provider = synthetic('happy_path', clock)
    const deps = io()
    await poll(provider, clock, '2026-09-20T18:00:00Z', deps)
    await must(service.from('score_fanout').delete().eq('season', SEASON).eq('week', WEEK).like('player_id', 'syn-%'), 'drain')

    // +20 min: every G1 line moved (measured, the moved-poll pin), and the
    // invocation dies between the two PostgREST calls.
    const crashed = { ...deps, db: crashingBeforeStatsWrite() }
    await expect(poll(provider, clock, '2026-09-20T18:20:00Z', crashed)).rejects.toThrow(
      'simulated crash between the enqueue and the player_stats write',
    )
    // The queue holds the 6 deltas — enqueued BEFORE the crash — at 18:20 …
    const afterCrash = await queuedRows()
    expect(afterCrash.map((r) => r.player_id)).toEqual(G1_PLAYERS)
    for (const q of afterCrash) expect(q.enqueued_at).toBe('2026-09-20T18:20:00.000Z')
    // … and the stat rows are STALE (18:00): updated_at < enqueued_at, which
    // is exactly what the worker's readiness predicate (F218) refuses to score.
    const stale = await storedStats()
    for (const row of stale.values()) expect(row.updated_at).toBe('2026-09-20T18:00:00+00:00')
    expect(stale.get('syn-g1-qb')!.pass_attempts).toBe(10)

    // Worst case: a worker drained the queue anyway. The NEXT poll at the same
    // instant sees stored ≠ incoming, so the delta is re-detected and
    // re-enqueued — at-least-once. (Stats-first would have written 18:20
    // before dying, the re-poll would read `unchanged`, and this is the line
    // the probe turns red: expected 6, received 0.)
    await must(service.from('score_fanout').delete().eq('season', SEASON).eq('week', WEEK).like('player_id', 'syn-%'), 'drain')
    const repoll = await poll(provider, clock, '2026-09-20T18:20:00Z', deps)
    expect(repoll.stats).toMatchObject({ updated: 6, unchanged: 0, deltas: 6, enqueued: 6 })
    expect(await queued()).toEqual(G1_PLAYERS)
    const landed = await storedStats()
    expect(landed.get('syn-g1-qb')).toMatchObject({ pass_attempts: 14, updated_at: '2026-09-20T18:20:00+00:00' })
    // Ready now: updated_at == enqueued_at.
    for (const q of await queuedRows()) {
      expect(new Date(landed.get(q.player_id)!.updated_at).toISOString()).toBe(q.enqueued_at)
    }
  })
})

describe('R707 — a schedule week outside the calendar is skipped and counted, never a poll-wide throw', () => {
  const G18_GAME: ProviderGame = {
    gameId: G18,
    season: SEASON,
    week: 18,
    homeTeam: 'KC',
    awayTeam: 'BUF',
    kickoffAt: new Date('2027-01-10T18:00:00Z'),
    gameDate: '2027-01-10',
    status: 'scheduled',
  }
  const G19_GAME: ProviderGame = { ...G18_GAME, gameId: G19, week: 19, kickoffAt: new Date('2027-01-17T18:00:00Z'), gameDate: '2027-01-17' }

  function withLateWeeks(inner: StatsProvider): StatsProvider {
    return {
      ...renamed(inner, 'synthetic'),
      getSchedule: async (s) => [...(await inner.getSchedule(s)), G18_GAME, G19_GAME],
    }
  }

  it('week 18 (the last seeded row) is maintained and week 19 (one past it) is skipped + counted + named; the live week still lands', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const provider = withLateWeeks(synthetic('happy_path', clock))
    const report = await poll(provider, clock, '2026-09-20T18:00:00Z', io())

    expect(report.ok).toBe(true)
    expect(report.games).toEqual({ seen: 5, withoutKickoff: 0, inserted: 5, updated: 0, unchanged: 0 })
    // touched = updated + unchanged + outsideCalendar: weeks 2 and 18 updated, 19 skipped.
    expect(report.weeks).toEqual({ touched: 3, updated: 2, unchanged: 0, outsideCalendar: 1 })
    expect(report.reasons).toEqual([
      'nfl_weeks: 1 schedule week(s) outside the calendar skipped — 2026 week 19 (no nfl_weeks row; 039 seeds 1–18)',
    ])
    // The live week's stats landed — the E45 promise: staleness is never silent.
    expect(report.stats).toMatchObject({ inserted: 6, enqueued: 6 })
    expect(await storedWeek()).toEqual({ first_kickoff_at: '2026-09-20T17:00:00.000Z', last_game_ends_at: null })
    // Week 18 IS in the calendar: its bounds moved. Week 19 has no row to move.
    const bounds = await must(
      service.from('nfl_weeks').select('week, first_kickoff_at').eq('season', SEASON).in('week', [18, 19]).order('week'),
      'read nfl_weeks 18/19',
    )
    expect(
      (bounds as Array<{ week: number; first_kickoff_at: string | null }>).map((r) => ({
        week: r.week,
        first_kickoff_at: r.first_kickoff_at === null ? null : new Date(r.first_kickoff_at).toISOString(),
      })),
    ).toEqual([{ week: 18, first_kickoff_at: '2027-01-10T18:00:00.000Z' }])
    // Both games are stored — the schedule is honest data; only the CALENDAR row is missing.
    const games = await storedGames()
    expect(games.get(G18)!.kickoff_at).toBe('2027-01-10T18:00:00.000Z')
    expect(games.get(G19)!.kickoff_at).toBe('2027-01-17T18:00:00.000Z')
  })

  it('ingesting a week the calendar does not know (io.week = 19) refuses BEFORE any write — the integrity throw is kept for the ingested week only', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const provider = withLateWeeks(synthetic('happy_path', clock))
    await expect(poll(provider, clock, '2026-09-20T18:00:00Z', { ...io(), week: 19 })).rejects.toThrow(
      'nfl_weeks has no row for 2026 week 19 — the calendar seed is missing',
    )
    expect((await storedGames()).size).toBe(0) // nothing written, not even the week-2 games
    expect((await storedStats()).size).toBe(0)
    expect(await queued()).toEqual([])
    expect(await storedWeek()).toEqual({ first_kickoff_at: null, last_game_ends_at: null })
  })
})

describe('loud emptiness (CLAUDE.md) — every skip is counted and named', () => {
  it('a line for a player the players table does not know is counted, never written, never an FK error', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const inner = synthetic('happy_path', clock)
    const ghosted: StatsProvider = {
      ...renamed(inner, 'synthetic'),
      getWeekStats: async (s, w) => {
        const rows = await inner.getWeekStats(s, w)
        const ghost: ProviderPlayerWeekStats = { ...rows[0], playerId: 'syn-ghost' }
        return [...rows, ghost]
      },
    }
    const report = await poll(ghosted, clock, '2026-09-20T18:00:00Z', io())
    expect(report.stats.seen).toBe(7)
    expect(report.stats.unknownPlayer).toBe(1)
    expect(report.stats.inserted).toBe(6)
    expect((await storedStats()).has('syn-ghost')).toBe(false)
  })

  it('a tier without kickoff timestamps (sleeper-shaped) writes no games and says why', async () => {
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const inner = synthetic('happy_path', clock)
    const dayOnly: StatsProvider = {
      ...renamed(inner, 'sleeper'),
      getSchedule: async (s) => (await inner.getSchedule(s)).map((g): ProviderGame => ({ ...g, kickoffAt: null })),
      getWeekStats: async () => [],
    }
    const report = await poll(dayOnly, clock, '2026-09-20T18:00:00Z', io())
    expect(report.games).toEqual({ seen: 3, withoutKickoff: 3, inserted: 0, updated: 0, unchanged: 0 })
    expect(report.weeks).toEqual({ touched: 0, updated: 0, unchanged: 0, outsideCalendar: 0 })
    expect(report.reasons[0]).toBe(
      'nfl_games untouched: none of the 3 games carry a kickoff timestamp (sleeper tier — F11 supplies them)',
    )
    expect((await storedGames()).size).toBe(0)
    expect(await storedWeek()).toEqual({ first_kickoff_at: null, last_game_ends_at: null })
  })
})
