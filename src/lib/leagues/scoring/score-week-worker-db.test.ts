/**
 * score-week-worker-db.test.ts — L.D2.2 over the REAL stack: the queue,
 * the map, the week's lineups, the door, the ack, and the wire (spec §22.2
 * / §7.3.3 / §23.5 / E61 / §23.3 / §9.1; PROGRESS D292 / D295 / D321; F22 +
 * F23 discharged here at the production writer; F218 / F241(b) / F259(d)(e)
 * / F262(d) honoured, each pinned).
 *
 * Four leagues on `SYNTHETIC_SEASON` (2099 — F215/F226: no wall clock
 * anywhere in this file; every instant is a literal), every stat line and
 * queue row planted by the service role (ingestion is L.D2.1's; this suite
 * is the worker's contract with what ingestion leaves behind):
 *
 *   L1  h2h, ESPN Standard — four seats, two week-1 pairings (T1 v T2,
 *       T3 v T4). T1 starts the hand-computed ALPHA lineup
 *       (score-week-worker.test.ts: 92.08 incl. a TE with no line), holds a
 *       38-point RB on IR (must not count) and a bench WR with a queue row
 *       (must not recompute). T2 is the MANAGER's (the wire cell's member).
 *       Week 2 `upcoming` (the `week_not_open` hold).
 *   L2  total_points, ESPN Standard — 068's L2 shape: P RETIRED at week 2
 *       with successor S (orphaned), Q, R; week 1 `correction_window` with
 *       provisional rows for P/Q/R, week 2 `live` with none. F262(d) +
 *       F241(b).
 *   L3  h2h, a POISONED snapshot (`pass_yards: "corrupt"`) — the
 *       quarantine; U1 starts L1's QB (the same queue row scores L1 and
 *       fails L3 BY NAME in one drain).
 *   L4  h2h, a planted snapshot paying the D15 charted placeholder — E61 on
 *       the wire (V1 starts L1's WR: a NULL cell until the key lands); week
 *       2 `final` (the `week_final` consume, D295(b)).
 *
 * The map's negative control: L1's K is rostered by L1 alone — his drain
 * names L1 and no other league. Idempotence: the same rows re-queued ⇒
 * every league `no_change`, the door writes 0, and ZERO `matchups` events
 * reach a subscribed member (counted over the wire — one socket per cell,
 * the D319(9) shape). One door call per league per drain is counted
 * through a Proxy over the service client.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Fixture hygiene (F199): everything this suite writes carries the
 * `vitest-sw` prefix (leagues by name, players by id) or hangs off those
 * leagues; cleanup-first and after, by prefix. Action-id prefix `afe` —
 * this suite owns it (the D108(14) registry: af0–af4, af6–afd taken; af5
 * roster-add-drop; afe measured free 2026-09-07).
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { VirtualClock } from '../time/virtual-clock'
import { type BatchReport, type ScoreWorkerClient, runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-sw'
const SEASON = SYNTHETIC_SEASON

const COMMISH = { email: 'score-worker-commish@fieldscout.test', password: 'pgtap-sw-pass-1', username: 'sw_commish_one' }
const MANAGER = { email: 'score-worker-manager@fieldscout.test', password: 'pgtap-sw-pass-2', username: 'sw_manager_two' }

const ACTION = {
  l1: 'afe00000-0000-4000-8000-000000000001',
  l2: 'afe00000-0000-4000-8000-000000000002',
  l3: 'afe00000-0000-4000-8000-000000000003',
  l4: 'afe00000-0000-4000-8000-000000000004',
} as const

/** The poll instant every planted stat row and queue row carries. */
const STAMP = '2099-09-13T20:00:00.000Z'
/** A LATER poll: the F218 crash-gap fixture and the settle re-queue. */
const STAMP_LATER = '2099-09-13T20:20:00.000Z'
const STAMP_LATER_2 = '2099-09-13T20:40:00.000Z'

const P = {
  qb1: `${PREFIX}-qb1`,
  rb1: `${PREFIX}-rb1`,
  wr1: `${PREFIX}-wr1`,
  te1: `${PREFIX}-te1`,
  k1: `${PREFIX}-k1`,
  dst1: `${PREFIX}-dst1`,
  ir1: `${PREFIX}-ir1`,
  bn1: `${PREFIX}-bn1`,
  qb2: `${PREFIX}-qb2`,
  wr3: `${PREFIX}-wr3`,
  rb4: `${PREFIX}-rb4`,
  h1: `${PREFIX}-h1`,
  f1: `${PREFIX}-f1`,
  p1: `${PREFIX}-p1`,
  q1: `${PREFIX}-q1`,
  r1: `${PREFIX}-r1`,
} as const

const PLAYERS: Array<{ id: string; full_name: string; position: string; team: string; status: string }> = [
  { id: P.qb1, full_name: 'SW QB1', position: 'QB', team: 'SWA', status: 'Active' },
  { id: P.rb1, full_name: 'SW RB1', position: 'RB', team: 'SWA', status: 'Active' },
  { id: P.wr1, full_name: 'SW WR1', position: 'WR', team: 'SWA', status: 'Active' },
  { id: P.te1, full_name: 'SW TE1', position: 'TE', team: 'SWB', status: 'Active' },
  { id: P.k1, full_name: 'SW K1', position: 'K', team: 'SWA', status: 'Active' },
  { id: P.dst1, full_name: 'SW DST1', position: 'DEF', team: 'SWA', status: 'Active' }, // the feed's vocabulary
  { id: P.ir1, full_name: 'SW IR1', position: 'RB', team: 'SWA', status: 'Active' },
  { id: P.bn1, full_name: 'SW BN1', position: 'WR', team: 'SWA', status: 'Active' },
  { id: P.qb2, full_name: 'SW QB2', position: 'QB', team: 'SWB', status: 'Active' },
  { id: P.wr3, full_name: 'SW WR3', position: 'WR', team: 'SWB', status: 'Active' },
  { id: P.rb4, full_name: 'SW RB4', position: 'RB', team: 'SWB', status: 'Active' },
  { id: P.h1, full_name: 'SW H1', position: 'WR', team: 'SWB', status: 'Active' },
  { id: P.f1, full_name: 'SW F1', position: 'WR', team: 'SWB', status: 'Active' },
  { id: P.p1, full_name: 'SW P1', position: 'QB', team: 'SWC', status: 'Active' },
  { id: P.q1, full_name: 'SW Q1', position: 'RB', team: 'SWC', status: 'Active' },
  { id: P.r1, full_name: 'SW R1', position: 'WR', team: 'SWC', status: 'Active' },
]

/** The ALPHA lines (score-week-worker.test.ts — hand-computed there). */
const LINES: Array<{ player_id: string; week: number; columns: Record<string, number>; advanced?: Record<string, number> }> = [
  { player_id: P.qb1, week: 1, columns: { pass_yards: 312, pass_tds: 3, interceptions: 1, rush_yards: 21, sacks_taken: 2 } }, // 24.58
  { player_id: P.rb1, week: 1, columns: { rush_yards: 87, rush_tds: 1, receptions: 4, receiving_yards: 33, fumbles_lost: 1 } }, // 16.00
  { player_id: P.wr1, week: 1, columns: { receptions: 7, receiving_yards: 115, receiving_tds: 1, rec_2pt: 1 } }, // 19.50 (+ charted → 23.50)
  { player_id: P.k1, week: 1, columns: { fg_0_39: 2, fg_made_40_plus: 1, fg_made_50_plus: 1, xp_made: 3, fg_missed: 1 } }, // 17.00
  { player_id: P.dst1, week: 1, columns: { def_sacks: 3, def_interceptions: 1, def_fumble_recoveries: 1, def_tds: 1, def_points_allowed: 19, def_yards_allowed: 249 } }, // 15.00
  { player_id: P.ir1, week: 1, columns: { rush_yards: 200, rush_tds: 3 } }, // 38.00 — on IR, never counted
  { player_id: P.bn1, week: 1, columns: { receiving_yards: 50 } }, // bench — never recomputed
  { player_id: P.qb2, week: 1, columns: { pass_yards: 250, pass_tds: 2 } }, // 10 + 8 = 18.00
  { player_id: P.wr3, week: 1, columns: { receptions: 5, receiving_yards: 60 } }, // 6.00
  { player_id: P.h1, week: 2, columns: { receiving_yards: 10 } }, // L1 week 2 is upcoming → held
  { player_id: P.f1, week: 2, columns: { receiving_yards: 10 } }, // L4 week 2 is final → consumed, no cell
  // L2 (total_points): P's QB p1 — week 1 (P's book) 100 × 0.04 + 4 = 8.00; the
  // correction moves it to 150 yds → 6 + 4 = 10.00. Week 2 (S's book) 200 yds → 8 + 4 = 12.00.
  { player_id: P.p1, week: 1, columns: { pass_yards: 100, pass_tds: 1 } },
  { player_id: P.p1, week: 2, columns: { pass_yards: 200, pass_tds: 1 } },
  { player_id: P.q1, week: 1, columns: { rush_yards: 50 } }, // 5.00
  { player_id: P.q1, week: 2, columns: { rush_yards: 50 } }, // 5.00
  { player_id: P.r1, week: 2, columns: { receptions: 2, receiving_yards: 30 } }, // 3.00
]

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

/** Every `.rpc(...)` the worker makes, by (fn, league, week) — the one-call-per-league-per-drain pin. */
const rpcCalls: Array<{ fn: string; league: string; week: number; scores: Array<{ team_id: string; points: number | null }> }> = []
const countingDb = new Proxy(service, {
  get(target, prop, receiver) {
    if (prop === 'rpc') {
      return (fn: string, args: Record<string, unknown>) => {
        if (fn === 'score_write_week_batch') {
          rpcCalls.push({
            fn,
            league: args.p_league_id as string,
            week: args.p_week as number,
            scores: args.p_scores as Array<{ team_id: string; points: number | null }>,
          })
        }
        return target.rpc(fn as never, args as never)
      }
    }
    const value = Reflect.get(target, prop, receiver)
    return typeof value === 'function' ? value.bind(target) : value
  },
}) as unknown as ScoreWorkerClient

type SelectResult = { data: unknown; error: unknown }
type AnyFn = (...args: unknown[]) => unknown

/**
 * A client whose `.from(table).select(...)` results pass through `onResult`
 * before they reach the worker — every other table and verb untouched. Two
 * uses: (a) the RACE — the newer poll landing between the worker's claim
 * read and its ack (D321(2)); (b) the SNAPSHOT OVERLAY — the stack refuses
 * a corrupt or reserved-key snapshot at the write (059's NULL guard + 104's
 * wall, measured below), so the worker's quarantine and E61 paths are
 * driven by what it READS for a league, over the real door.
 */
function interceptSelect(base: ScoreWorkerClient, table: string, onResult: (res: SelectResult) => Promise<SelectResult>): ScoreWorkerClient {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop !== 'from') return Reflect.get(target, prop, receiver)
      return (t: string) => {
        const builder = (target as unknown as { from: (t: string) => object }).from(t)
        if (t !== table) return builder
        return new Proxy(builder, {
          get(b, p, r) {
            const value = Reflect.get(b, p, r)
            if (p !== 'select' || typeof value !== 'function') return value
            return (...args: unknown[]) => {
              const chain = (value as AnyFn).apply(b, args) as object
              return new Proxy(chain, {
                get(c, cp, cr) {
                  if (cp === 'then') {
                    return (onFulfilled: AnyFn, onRejected: AnyFn) =>
                      (c as PromiseLike<SelectResult>).then((res) => onResult(res)).then(onFulfilled as never, onRejected as never)
                  }
                  const v = Reflect.get(c, cp, cr)
                  if (typeof v !== 'function') return v
                  return (...a: unknown[]) => {
                    const out = (v as AnyFn).apply(c, a)
                    return out === c ? cr : out
                  }
                },
              })
            }
          },
        })
      }
    },
  }) as unknown as ScoreWorkerClient
}

/** The FIRST `score_fanout` read (the claim) is followed by `after()`. */
function raceAfterClaim(base: ScoreWorkerClient, after: () => Promise<void>): ScoreWorkerClient {
  let armed = true
  return interceptSelect(base, 'score_fanout', async (res) => {
    if (armed) {
      armed = false
      await after()
    }
    return res
  })
}

/** The worker sees `snapshot` for `leagueId` — the DB row keeps its valid one. */
const snapshotOverlay = new Map<string, Json>()
function withSnapshotOverlay(base: ScoreWorkerClient): ScoreWorkerClient {
  return interceptSelect(base, 'leagues', async (res) => {
    if (!Array.isArray(res.data)) return res
    return {
      ...res,
      data: (res.data as Array<{ id: string }>).map((row) =>
        snapshotOverlay.has(row.id) ? { ...row, scoring_rules_snapshot: snapshotOverlay.get(row.id) } : row,
      ),
    }
  })
}

/** The client every drain uses: door calls counted, the two overlays applied. */
const workerDb = withSnapshotOverlay(countingDb)

const clock = new VirtualClock(new Date('2099-09-13T20:00:05.000Z'))

interface Fixture {
  l1: string
  l2: string
  l3: string
  l4: string
  t1: string
  t2: string
  t3: string
  t4: string
  p: string
  q: string
  r: string
  s: string
  u1: string
  u2: string
  v1: string
  v2: string
}
let fx: Fixture
let POISONED: Json
let CHARTED: Json
let managerId: string
let commishId: string
let commishClient: SupabaseClient<Database>
const openClients: SupabaseClient<Database>[] = []
const openChannels: RealtimeChannel[] = []

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  await must(service.from('score_fanout').delete().like('player_id', `${PREFIX}-%`), 'cleanup score_fanout')
  await must(service.from('player_stats').delete().like('player_id', `${PREFIX}-%`), 'cleanup player_stats')
  const { data: stale } = await service.from('leagues').select('id').like('name', `${PREFIX}-%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) await must(service.from('team_lineups').delete().in('team_id', teamIds), 'cleanup team_lineups')
    for (const table of ['transactions', 'team_week_results', 'matchups', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    // A successor FK: clear the lineage before the rows go.
    await must(service.from('teams').update({ successor_team_id: null }).in('league_id', ids), 'cleanup teams lineage')
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  for (const u of [COMMISH, MANAGER]) await deleteUserByUsername(u.username)
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  await client.realtime.setAuth(data.session?.access_token ?? null)
  return client
}

async function createLeague(
  name: string,
  actionId: string,
  snapshot: Json,
  mode: 'h2h' | 'total_points',
  seats: number,
): Promise<{ id: string; teams: string[] }> {
  const base = defaultsForTeamCount(8)
  const settings =
    mode === 'total_points' ? { ...base, schedule_mode: 'total_points' as const, playoff_teams: 0 as const } : base
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error } = await commishClient.rpc('create_league', {
    p_name: name,
    p_season: SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: actionId,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league(${name}) failed: ${error.message}`)
  const id = (created as { league_id: string }).league_id
  const commishTeam = await must(service.from('teams').select('id').eq('league_id', id).single(), 'commish team')
  const extra = await must(
    service
      .from('teams')
      .insert(Array.from({ length: seats - 1 }, (_, i) => ({ owner_id: commishId, name: `Seat ${i + 2}`, league_id: id })))
      .select('id'),
    'extra seats',
  )
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: snapshot }).eq('id', id), 'league → in_season')
  return { id, teams: [commishTeam!.id, ...(extra ?? []).map((t) => t.id)] }
}

/** One legal F4 step per UPDATE (110's guard). */
async function setWeek(leagueId: string, week: number, status: 'upcoming' | 'live' | 'correction_window' | 'final'): Promise<void> {
  await must(service.from('league_weeks').insert({ league_id: leagueId, season: SEASON, week }), `league_weeks ${week}`)
  const chain: Array<'live' | 'correction_window' | 'final'> = ['live', 'correction_window', 'final']
  for (const step of chain) {
    if (status === 'upcoming') return
    await must(service.from('league_weeks').update({ status: step }).eq('league_id', leagueId).eq('week', week), `league_weeks ${week} → ${step}`)
    if (step === status) return
  }
}

async function lineup(teamId: string, week: number, slotMap: Record<string, string>): Promise<void> {
  await must(
    service.from('team_lineups').insert({ team_id: teamId, season: SEASON, week, starters: [], bench: [], slot_map: slotMap }),
    `team_lineups ${teamId} wk ${week}`,
  )
}

async function roster(leagueId: string, teamId: string, playerIds: string[]): Promise<void> {
  await must(
    service.from('league_rosters').insert(playerIds.map((player_id) => ({ league_id: leagueId, team_id: teamId, player_id }))),
    `league_rosters ${teamId}`,
  )
}

async function plantLine(playerId: string, week: number, columns: Record<string, number>, stamp: string, advanced: Record<string, number> = {}): Promise<void> {
  await must(
    service
      .from('player_stats')
      .upsert({ player_id: playerId, season: SEASON, week, stat_type: 'weekly', updated_at: stamp, advanced, ...columns }, { onConflict: 'player_id,season,week' })
      .select('player_id'),
    `player_stats ${playerId} wk ${week}`,
  )
}

async function enqueue(playerIds: string[], week: number, stamp: string): Promise<void> {
  await must(
    service
      .from('score_fanout')
      .upsert(
        playerIds.map((player_id) => ({ season: SEASON, week, player_id, enqueued_at: stamp })),
        { onConflict: 'season,week,player_id', ignoreDuplicates: false },
      )
      .select('player_id'),
    'enqueue',
  )
}

async function queued(): Promise<Array<{ player_id: string; week: number; enqueued_at: string }>> {
  const rows = await must(
    service.from('score_fanout').select('player_id, week, enqueued_at').like('player_id', `${PREFIX}-%`).order('week').order('player_id'),
    'queue read',
  )
  return (rows ?? []).map((r) => ({ ...r, enqueued_at: new Date(r.enqueued_at).toISOString() }))
}

async function matchupScores(leagueId: string, week: number): Promise<Array<{ home: string; away: string | null; hs: number | null; as: number | null }>> {
  const rows = await must(
    service.from('matchups').select('home_team_id, away_team_id, home_score, away_score').eq('league_id', leagueId).eq('week', week).order('home_team_id'),
    'matchups read',
  )
  return (rows ?? []).map((m) => ({ home: m.home_team_id, away: m.away_team_id, hs: m.home_score, as: m.away_score }))
}

async function results(leagueId: string, week: number): Promise<Array<{ team_id: string; points: number; is_final: boolean }>> {
  const rows = await must(
    service.from('team_week_results').select('team_id, points, is_final').eq('league_id', leagueId).eq('week', week).order('team_id'),
    'results read',
  )
  return (rows ?? []).map((r) => ({ team_id: r.team_id, points: Number(r.points), is_final: r.is_final }))
}

function drain(leagueIds?: string[]): Promise<BatchReport> {
  rpcCalls.length = 0
  return runScoreWeekBatch({ time: clock, db: workerDb }, { batchSize: 1000, leagueIds: leagueIds ?? [fx.l1, fx.l2, fx.l3, fx.l4] })
}

function league(report: BatchReport, leagueId: string, week: number) {
  const entry = report.leagues.find((l) => l.league_id === leagueId && l.week === week)
  if (!entry) throw new Error(`no report entry for ${leagueId} week ${week}: ${JSON.stringify(report.leagues.map((l) => [l.league_id, l.week, l.outcome]))}`)
  return entry
}

// ── Realtime helpers (the D319(9) one-socket-per-cell shape) ───────────────

interface BroadcastEnvelope {
  record?: Record<string, unknown> | null
  [key: string]: unknown
}

function subscribeAndWait(channel: RealtimeChannel, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), timeoutMs)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        clearTimeout(timer)
        resolve(status)
      }
    })
  })
}

const POLL_MS = 200

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const attempts = Math.ceil(timeoutMs / POLL_MS)
  for (let i = 0; i < attempts; i++) {
    const value = probe()
    if (value !== undefined) return value
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function settle(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, POLL_MS))
}

async function memberSocket(): Promise<SupabaseClient<Database>> {
  const client = await signIn(MANAGER)
  openClients.push(client)
  return client
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  commishId = await createUser(COMMISH)
  managerId = await createUser(MANAGER)
  commishClient = await signIn(COMMISH)

  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')

  const { data: espn } = await service.from('scoring_systems').select('rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const ESPN = espn?.rules as Record<string, number>
  POISONED = { ...ESPN, pass_yards: 'corrupt' } as unknown as Json
  CHARTED = { ...ESPN, example_charted_yards: 0.1 } as unknown as Json

  // ── L1: h2h, four seats, the manager on T2 ──
  const l1 = await createLeague(`${PREFIX}-h2h`, ACTION.l1, ESPN as unknown as Json, 'h2h', 4)
  const [t1, t2, t3, t4] = l1.teams
  await must(service.from('teams').update({ owner_id: managerId, name: 'Manager Team' }).eq('id', t2), 'T2 → manager')
  await must(service.from('league_members').insert({ league_id: l1.id, user_id: managerId, team_id: t2, role: 'manager' }), 'L1 member')
  await setWeek(l1.id, 1, 'live')
  await setWeek(l1.id, 2, 'upcoming')
  await must(
    service.from('matchups').insert([
      { league_id: l1.id, season: SEASON, week: 1, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: 'live' },
      { league_id: l1.id, season: SEASON, week: 1, round_type: 'regular', home_team_id: t3, away_team_id: t4, status: 'live' },
    ]),
    'L1 matchups',
  )
  await roster(l1.id, t1, [P.qb1, P.rb1, P.wr1, P.te1, P.k1, P.dst1, P.ir1, P.bn1, P.h1])
  await roster(l1.id, t2, [P.qb2])
  await roster(l1.id, t3, [P.wr3])
  await roster(l1.id, t4, [P.rb4])
  await lineup(t1, 1, { 'qb:0': P.qb1, 'rb:0': P.rb1, 'wr:0': P.wr1, 'te:0': P.te1, 'k:0': P.k1, 'dst:0': P.dst1, 'ir1:0': P.ir1 })
  await lineup(t2, 1, { 'qb:0': P.qb2 })
  await lineup(t3, 1, { 'wr:0': P.wr3 })
  await lineup(t4, 1, { 'rb:0': P.rb4 })

  // ── L2: total_points — P retired at week 2 → S; Q; R ──
  const l2 = await createLeague(`${PREFIX}-tp`, ACTION.l2, ESPN as unknown as Json, 'total_points', 4)
  const [p, q, r, s] = l2.teams
  await must(service.from('teams').update({ name: 'RS P', status: 'retired', retired_at_week: 2, successor_team_id: s }).eq('id', p), 'P retired')
  await must(service.from('teams').update({ name: 'Team 4', status: 'orphaned' }).eq('id', s), 'S orphaned')
  await setWeek(l2.id, 1, 'correction_window')
  await setWeek(l2.id, 2, 'live')
  await roster(l2.id, s, [P.p1]) // re-pointed WHOLE to the successor (120)
  await roster(l2.id, q, [P.q1])
  await roster(l2.id, r, [P.r1])
  await lineup(p, 1, { 'qb:0': P.p1 }) // week 1 stays P's (E49)
  await lineup(q, 1, { 'rb:0': P.q1 })
  await lineup(r, 1, { 'wr:0': P.r1 })
  await lineup(s, 2, { 'qb:0': P.p1 }) // week 2 is S's
  await lineup(q, 2, { 'rb:0': P.q1 })
  await lineup(r, 2, { 'wr:0': P.r1 })
  await must(
    service.from('team_week_results').insert([
      { league_id: l2.id, team_id: p, season: SEASON, week: 1, points: 40, is_final: false },
      { league_id: l2.id, team_id: q, season: SEASON, week: 1, points: 30, is_final: false },
      { league_id: l2.id, team_id: r, season: SEASON, week: 1, points: 20, is_final: false },
    ]),
    'L2 week-1 provisional rows',
  )

  // ── L3: the poisoned snapshot; U1 starts L1's QB ──
  const l3 = await createLeague(`${PREFIX}-quarantine`, ACTION.l3, ESPN as unknown as Json, 'h2h', 2)
  snapshotOverlay.set(l3.id, POISONED) // what the worker READS — the DB refuses the write (measured below)
  const [u1, u2] = l3.teams
  await setWeek(l3.id, 1, 'live')
  await must(
    service.from('matchups').insert({ league_id: l3.id, season: SEASON, week: 1, round_type: 'regular', home_team_id: u1, away_team_id: u2, status: 'live' }),
    'L3 matchup',
  )
  await roster(l3.id, u1, [P.qb1])
  await lineup(u1, 1, { 'qb:0': P.qb1 })

  // ── L4: the charted snapshot; V1 starts L1's WR; week 2 final ──
  const l4 = await createLeague(`${PREFIX}-charted`, ACTION.l4, ESPN as unknown as Json, 'h2h', 2)
  snapshotOverlay.set(l4.id, CHARTED)
  const [v1, v2] = l4.teams
  await setWeek(l4.id, 1, 'live')
  await setWeek(l4.id, 2, 'final')
  await must(
    service.from('matchups').insert({ league_id: l4.id, season: SEASON, week: 1, round_type: 'regular', home_team_id: v1, away_team_id: v2, status: 'live' }),
    'L4 matchup',
  )
  await roster(l4.id, v1, [P.wr1, P.f1])
  await lineup(v1, 1, { 'wr:0': P.wr1 })
  await lineup(v2, 1, {})

  for (const line of LINES) await plantLine(line.player_id, line.week, line.columns, STAMP, line.advanced)

  fx = { l1: l1.id, l2: l2.id, l3: l3.id, l4: l4.id, t1, t2, t3, t4, p, q, r, s, u1, u2, v1, v2 }
}, 120_000)

afterAll(async () => {
  for (const channel of openChannels) await channel.unsubscribe().catch(() => undefined)
  for (const client of openClients) client.realtime.disconnect()
  commishClient?.realtime.disconnect()
  await cleanup()
})

describe('the score-league-week worker over the real stack (L.D2.2)', () => {
  it('an empty queue is a named empty drain, never a silent success', async () => {
    const report = await drain()
    expect(report.claimed).toBe(0)
    expect(report.reason).toBe('queue_empty')
    expect(report.leagues).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('MEASURED — the chain refuses every corruption the quarantine guards against AT THE WRITE: a non-finite coefficient (104’s wall), a reserved advanced key (the scorable allowlist), a NULL snapshot on an in_season league (059’s guard)', async () => {
    const poisoned = await service.from('leagues').update({ scoring_rules_snapshot: POISONED }).eq('id', fx.l3)
    expect(poisoned.error?.message).toMatch(/Bounds .*"pass_yards" must be a finite number; got "corrupt"/)
    const reserved = await service.from('leagues').update({ scoring_rules_snapshot: CHARTED }).eq('id', fx.l4)
    expect(reserved.error?.message).toMatch(/example_charted_yards/)
    const nulled = await service.from('leagues').update({ scoring_rules_snapshot: null }).eq('id', fx.l3)
    expect(nulled.error?.message).toMatch(/cannot be in status in_season without scoring_rules_snapshot/)
    // So on this chain a FROZEN snapshot can neither be corrupt nor pay a
    // key the provider never delivers: the cells below drive the worker's
    // quarantine and E61 paths through what it READS (the overlay), over the
    // real door. The DB rows stay valid throughout.
    const { data } = await service.from('leagues').select('id, scoring_rules_snapshot').in('id', [fx.l3, fx.l4])
    expect(data?.every((r) => r.scoring_rules_snapshot !== null)).toBe(true)
  })

  it('THE FIRST DRAIN — T1 = 92.08 through the queue → map → week lineup → door (F22/F23 at the writer); IR and bench excluded; L3 QUARANTINED by name in the same drain; L4 pending (E61 NULL); the map’s negative control', async () => {
    // Every week-1 line of L1/L3/L4 is a delta, plus the bench WR.
    await enqueue([P.qb1, P.rb1, P.wr1, P.k1, P.dst1, P.ir1, P.bn1], 1, STAMP)
    const report = await drain()

    expect(report.claimed).toBe(7)
    expect(report.not_ready).toBe(0)
    expect(report.failed).toBe(1)
    expect(report.written).toBe(2) // L1 + L4
    expect(report.drained).toBe(7)
    expect(await queued()).toEqual([])

    // L1: T1 written, the IR RB and the bench WR never counted.
    const l1 = league(report, fx.l1, 1)
    expect(l1.outcome).toBe('written')
    expect(l1.affected_team_ids).toEqual([fx.t1])
    expect(l1.bench_player_ids).toEqual([P.bn1, P.ir1].sort())
    const t1 = l1.teams.find((t) => t.team_id === fx.t1)!
    expect(t1.points).toBe(92.08)
    expect(t1.no_stat_row).toEqual([P.te1])
    // (jsonb key order is Postgres's — compare as a sorted set)
    expect(t1.starters.map((s) => [s.player_id, s.points]).sort()).toEqual(
      [
        [P.qb1, 24.58],
        [P.rb1, 16],
        [P.wr1, 19.5],
        [P.te1, 0],
        [P.k1, 17],
        [P.dst1, 15],
      ].sort(),
    )
    expect(l1.door).toMatchObject({ written: 1, writable: 1, unchanged: 0, reason: null, skipped: [] })
    // The DB holds the JS literal — no re-rounding anywhere (F22): 92.08 read back as 92.08.
    expect(await matchupScores(fx.l1, 1)).toEqual([
      { home: fx.t1, away: fx.t2, hs: 92.08, as: 0 },
      { home: fx.t3, away: fx.t4, hs: 0, as: 0 },
    ].sort((a, b) => (a.home < b.home ? -1 : 1)))

    // L3: quarantined BY NAME — nothing written, its matchup untouched at 109's DEFAULT 0.
    const l3 = league(report, fx.l3, 1)
    expect(l3.outcome).toBe('failed')
    expect(l3.error).toMatch(/^snapshot_corrupt: scoring_rules_snapshot corrupt: .*pass_yards/)
    expect(l3.teams).toEqual([])
    expect(await matchupScores(fx.l3, 1)).toEqual([{ home: fx.u1, away: fx.u2, hs: 0, as: 0 }])
    expect(report.problems.some((p) => p.includes(`QUARANTINED league ${fx.l3}`))).toBe(true)

    // L4: the charted key is undelivered → V1 PENDING → NULL on the cell (E61), never 0.
    const l4 = league(report, fx.l4, 1)
    expect(l4.outcome).toBe('written')
    expect(l4.teams[0]).toMatchObject({ team_id: fx.v1, points: null, pending: [{ player_id: P.wr1, keys: ['example_charted_yards'] }] })
    expect(await matchupScores(fx.l4, 1)).toEqual([{ home: fx.v1, away: fx.v2, hs: null, as: 0 }])

    // The map's negative control: the K is L1's alone — his delta names L1 and no other league.
    expect(l1.mapped_player_ids).toContain(P.k1)
    expect(l3.mapped_player_ids).toEqual([P.qb1])
    expect(l4.mapped_player_ids).toEqual([P.wr1])
    expect(report.leagues.map((l) => l.league_id).sort()).toEqual([fx.l1, fx.l3, fx.l4].sort())

    // ONE door call per league per drain (§22.2's coalesce rule), every points value scale ≤ 2.
    expect(rpcCalls.map((c) => c.league).sort()).toEqual([fx.l1, fx.l4].sort())
    for (const call of rpcCalls) for (const s of call.scores) if (s.points !== null) expect(String(s.points)).toMatch(/^-?\d+(\.\d{1,2})?$/)
  })

  it('IDEMPOTENT RE-DRAIN — the same rows re-queued: every league `no_change`, the door writes 0, the queue drains; the quarantine re-fails by name', async () => {
    await enqueue([P.qb1, P.rb1, P.wr1, P.k1, P.dst1], 1, STAMP)
    const report = await drain()
    expect(report.claimed).toBe(5)
    expect(report.no_change).toBe(2)
    expect(report.written).toBe(0)
    expect(report.failed).toBe(1)
    expect(league(report, fx.l1, 1).door).toMatchObject({ written: 0, writable: 1, unchanged: 1, reason: 'no_change' })
    expect(league(report, fx.l4, 1).door).toMatchObject({ written: 0, reason: 'no_change' })
    expect(report.drained).toBe(5)
    expect(await queued()).toEqual([])
    expect(await matchupScores(fx.l1, 1)).toContainEqual({ home: fx.t1, away: fx.t2, hs: 92.08, as: 0 })
  })

  it('F218 — a queued delta whose stats have NOT landed (stamp newer than the row) stays queued and is never scored stale; it scores once the stats land', async () => {
    // The RB's line is at STAMP; the queue says a LATER poll enqueued him.
    await enqueue([P.rb1], 1, STAMP_LATER)
    const held = await drain()
    expect(held.claimed).toBe(1)
    expect(held.not_ready).toBe(1)
    expect(held.reason).toBe('nothing_ready')
    expect(held.drained).toBe(0)
    expect(held.leagues).toEqual([])
    expect((await queued()).map((q) => q.player_id)).toEqual([P.rb1])

    // The stats land (the RB moved: 87 → 97 yds ⇒ 16.00 + 1.00 = 17.00; T1 92.08 + 1 = 93.08).
    await plantLine(P.rb1, 1, { rush_yards: 97, rush_tds: 1, receptions: 4, receiving_yards: 33, fumbles_lost: 1 }, STAMP_LATER)
    const scored = await drain()
    expect(scored.not_ready).toBe(0)
    expect(league(scored, fx.l1, 1).teams[0].points).toBe(93.08)
    expect(scored.drained).toBe(1)
    expect(await matchupScores(fx.l1, 1)).toContainEqual({ home: fx.t1, away: fx.t2, hs: 93.08, as: 0 })
  })

  it('D321(2) — the ack is BY STAMP: a newer poll landing between the worker’s claim and its ack re-stamps the row, the claimed-stamp delete misses it, and the next drain scores the newer line', async () => {
    await enqueue([P.rb1], 1, STAMP_LATER) // the row the worker will claim
    // The race, injected deterministically: right after the worker's claim
    // read resolves, "ingestion" re-stamps the row and lands the newer line
    // (107 yds ⇒ 18.00; T1 = 94.08) — exactly the R706 order, queue first.
    const racing = raceAfterClaim(workerDb, async () => {
      await enqueue([P.rb1], 1, STAMP_LATER_2)
      await plantLine(P.rb1, 1, { rush_yards: 107, rush_tds: 1, receptions: 4, receiving_yards: 33, fumbles_lost: 1 }, STAMP_LATER_2)
    })
    rpcCalls.length = 0
    const raced = await runScoreWeekBatch({ time: clock, db: racing }, { batchSize: 1000, leagueIds: [fx.l1, fx.l2, fx.l3, fx.l4] })
    // The worker scored from the line it read (the OLD 97-yd line: 93.08 —
    // a no_change against the cell) and its ack missed: the row survives
    // under the newer stamp. Nothing was lost.
    expect(raced.claimed).toBe(1)
    expect(raced.drained).toBe(0)
    expect(raced.problems.some((p) => p.includes('re-stamped by a newer delta mid-drain'))).toBe(true)
    expect((await queued()).map((q) => [q.player_id, q.enqueued_at])).toEqual([[P.rb1, STAMP_LATER_2]])
    // The next drain scores the newer line and acks it.
    const next = await drain()
    expect(league(next, fx.l1, 1).teams[0].points).toBe(94.08)
    expect(next.drained).toBe(1)
    expect(await queued()).toEqual([])
    expect(await matchupScores(fx.l1, 1)).toContainEqual({ home: fx.t1, away: fx.t2, hs: 94.08, as: 0 })
  })

  it('E61 settles — the charted key lands, the delta re-queues, V1 goes NULL → 23.50 (19.50 + 40 × 0.1)', async () => {
    await plantLine(P.wr1, 1, { receptions: 7, receiving_yards: 115, receiving_tds: 1, rec_2pt: 1 }, STAMP_LATER, { example_charted_yards: 40 })
    await enqueue([P.wr1], 1, STAMP_LATER)
    const report = await drain()
    const l4 = league(report, fx.l4, 1)
    expect(l4.outcome).toBe('written')
    expect(l4.teams[0]).toMatchObject({ team_id: fx.v1, points: 23.5, pending: [] })
    expect(await matchupScores(fx.l4, 1)).toEqual([{ home: fx.v1, away: fx.v2, hs: 23.5, as: 0 }])
    // L1 (an ESPN doc — no charted key) is unmoved by the same row: 94.08 stays.
    expect(league(report, fx.l1, 1).outcome).toBe('no_change')
  })

  it('F262(d) — a PAST-week correction attributes through THAT week’s lineup row: P’s week-1 row moves, no (S, week 1) row is minted, the successor’s folded PF counts week 1 once', async () => {
    // The correction: P's QB week-1 line 100 → 150 yds (8.00 → 10.00). p1 is
    // rostered by S NOW (120 re-pointed the roster whole).
    await plantLine(P.p1, 1, { pass_yards: 150, pass_tds: 1 }, STAMP_LATER)
    await enqueue([P.p1], 1, STAMP_LATER)
    const report = await drain()
    const l2 = league(report, fx.l2, 1)
    expect(l2.mode).toBe('total_points')
    expect(l2.outcome).toBe('written')
    expect(l2.affected_team_ids).toEqual([fx.p]) // the RETIRED franchise's book, via its week-1 lineup row
    expect(l2.provisional_team_ids).toEqual([]) // S's week 1 is P's — nothing seeded for S
    expect(l2.teams.map((t) => [t.team_id, t.points])).toEqual([[fx.p, 10]])
    expect(await results(fx.l2, 1)).toEqual([
      { team_id: fx.p, points: 10, is_final: false },
      { team_id: fx.q, points: 30, is_final: false },
      { team_id: fx.r, points: 20, is_final: false },
    ].sort((a, b) => (a.team_id < b.team_id ? -1 : 1)))
    expect(rpcCalls.filter((c) => c.league === fx.l2)).toHaveLength(1)
  })

  it('F241(b) — the FIRST batch of a total_points week writes a provisional row for EVERY seated team (the successor included, the retired predecessor not); the folded PF reads week 1 once', async () => {
    await enqueue([P.q1], 2, STAMP)
    const report = await drain()
    const l2 = league(report, fx.l2, 2)
    expect(l2.outcome).toBe('written')
    expect(l2.affected_team_ids).toEqual([fx.q])
    expect(l2.provisional_team_ids).toEqual([fx.r, fx.s].sort())
    expect(l2.teams.map((t) => [t.team_id, t.points]).sort()).toEqual(
      [
        [fx.q, 5], // 50 × 0.1
        [fx.r, 3], // 2 × 0 + 30 × 0.1
        [fx.s, 12], // 200 × 0.04 + 4 — S's book (week 2 ≥ retired_at_week 2)
      ].sort(),
    )
    expect(l2.door).toMatchObject({ written: 3, writable: 3, reason: null })
    expect(await results(fx.l2, 2)).toEqual(
      [
        { team_id: fx.q, points: 5, is_final: false },
        { team_id: fx.r, points: 3, is_final: false },
        { team_id: fx.s, points: 12, is_final: false },
      ].sort((a, b) => (a.team_id < b.team_id ? -1 : 1)),
    )
    // The projected standings fold P's week 1 (10.00) into "Team 4" ONCE: 10 + 12 = 22.00.
    const { data, error } = await commishClient.rpc('league_standings_projected', { p_league_id: fx.l2 })
    if (error) throw new Error(`league_standings_projected: ${error.message}`)
    const rows = (data as { standings: Array<{ team_id: string; points_for: unknown }> }).standings
    expect(Number(rows.find((r) => r.team_id === fx.s)?.points_for)).toBe(22)
    // A second drain of the same row: no_change, and no re-seeding.
    await enqueue([P.q1], 2, STAMP)
    const again = await drain()
    expect(league(again, fx.l2, 2)).toMatchObject({ outcome: 'no_change', provisional_team_ids: [] })
  })

  it('the door’s report is read (F259(e)): a delta whose only touched row is protected is `nothing_writable` — logged as a PROBLEM, never success', async () => {
    // Override T3's matchup (§22.2 — never auto-recomputed), then a delta for T3's WR.
    await must(service.from('matchups').update({ is_overridden: true, home_score: 55, away_score: 44 }).eq('league_id', fx.l1).eq('home_team_id', fx.t3), 'override')
    await enqueue([P.wr3], 1, STAMP)
    const report = await drain()
    const l1 = league(report, fx.l1, 1)
    expect(l1.outcome).toBe('nothing_writable')
    expect(l1.door?.skipped).toEqual([expect.objectContaining({ reason: 'overridden', round_type: 'regular' })])
    expect(report.nothing_writable).toBe(1)
    expect(report.problems.some((p) => p.includes('door wrote NOTHING'))).toBe(true)
    expect(await matchupScores(fx.l1, 1)).toContainEqual({ home: fx.t3, away: fx.t4, hs: 55, as: 44 })
    await must(service.from('matchups').update({ is_overridden: false, home_score: 0, away_score: 0 }).eq('league_id', fx.l1).eq('home_team_id', fx.t3), 'un-override')
  })

  it('the week’s door state: an `upcoming` week HOLDS the row (named every drain); a `final` week CONSUMES it with no cell changed (D295(b))', async () => {
    await enqueue([P.h1, P.f1], 2, STAMP)
    const report = await drain()
    expect(league(report, fx.l1, 2)).toMatchObject({ outcome: 'held', skip_reason: 'week_not_open' })
    expect(league(report, fx.l4, 2)).toMatchObject({ outcome: 'skipped', skip_reason: 'week_final' })
    expect(report.held).toBe(1)
    expect(report.skipped).toBe(1)
    expect(report.drained).toBe(1) // f1's row consumed; h1's held
    expect((await queued()).map((q) => q.player_id)).toEqual([P.h1])
    expect(rpcCalls).toEqual([])
    // Open L1's week 2: the held row scores on the next drain — T1 has no
    // week-2 lineup row, so the WR is unstarted there (named), the row consumed.
    await must(service.from('league_weeks').update({ status: 'live' }).eq('league_id', fx.l1).eq('week', 2), 'L1 week 2 → live')
    const next = await drain()
    expect(league(next, fx.l1, 2)).toMatchObject({ outcome: 'skipped', bench_player_ids: [P.h1], affected_team_ids: [] })
    expect(await queued()).toEqual([])
  })

  it('the scope seam: a scoped drain never consumes another league’s rows', async () => {
    await enqueue([P.k1], 1, STAMP)
    const scoped = await drain([fx.l4])
    expect(scoped.out_of_scope).toBe(1)
    expect(scoped.reason).toBe('nothing_in_scope')
    expect(scoped.drained).toBe(0)
    expect((await queued()).map((q) => q.player_id)).toEqual([P.k1])
    const mine = await drain()
    expect(mine.drained).toBe(1)
    expect(league(mine, fx.l1, 1).outcome).toBe('no_change')
  })

  it('a signed-in user cannot drive the door the worker uses (42501 in-body — the service role is the worker’s identity)', async () => {
    const { error } = await commishClient.rpc('score_write_week_batch', { p_league_id: fx.l1, p_week: 1, p_scores: [{ team_id: fx.t1, points: 1 }] as unknown as Json })
    expect(error?.code).toBe('42501')
  })

  it('THE WIRE — one drain touching two pairings reaches a subscribed MEMBER as EXACTLY ONE `matchups` event (count 2); the identical re-drain delivers NOTHING', async () => {
    const events: BroadcastEnvelope[] = []
    const member = await memberSocket()
    const channel = member.channel(`league:${fx.l1}`, { config: { private: true } }).on('broadcast', { event: 'matchups' }, (msg) => events.push(msg.payload as BroadcastEnvelope))
    openChannels.push(channel)
    expect(await subscribeAndWait(channel, 15_000)).toBe('SUBSCRIBED')

    // Readiness (harness, not assertion — the sibling suites' gate): fire
    // 070's leagues trigger until the socket proves delivery, on a second
    // handler so the counted events stay the matchups ones.
    const ready: unknown[] = []
    channel.on('broadcast', { event: 'leagues' }, (msg) => ready.push(msg.payload))
    for (let fire = 0; fire < 8 && ready.length === 0; fire++) {
      await service.from('leagues').update({ name: `${PREFIX}-h2h` }).eq('id', fx.l1)
      for (let poll = 0; poll < 15 && ready.length === 0; poll++) await new Promise((r) => setTimeout(r, POLL_MS))
    }
    if (ready.length === 0) throw new Error('realtime service never delivered a Broadcast-from-DB message (join or delivery pipeline still down)')

    // Two deltas in two pairings: T1's K (fg_0_39 2 → 3: 17.00 → 20.00; T1 94.08 → 97.08) and T3's WR (60 → 70 yds: 6.00 → 7.00).
    await plantLine(P.k1, 1, { fg_0_39: 3, fg_made_40_plus: 1, fg_made_50_plus: 1, xp_made: 3, fg_missed: 1 }, STAMP_LATER_2)
    await plantLine(P.wr3, 1, { receptions: 5, receiving_yards: 70 }, STAMP_LATER_2)
    await enqueue([P.k1, P.wr3], 1, STAMP_LATER_2)
    const report = await drain()
    expect(league(report, fx.l1, 1)).toMatchObject({ outcome: 'written', affected_team_ids: [fx.t1, fx.t3].sort() })
    expect(league(report, fx.l1, 1).door).toMatchObject({ written: 2, writable: 2 })

    await waitFor(() => (events.length > 0 ? true : undefined), 20_000, 'the matchups event')
    await settle(8)
    expect(events).toHaveLength(1)
    expect(events[0].record).toMatchObject({ season: SEASON, week: 1, count: 2 })

    // The identical re-drain: no_change, zero writes, zero events.
    await enqueue([P.k1, P.wr3], 1, STAMP_LATER_2)
    const again = await drain()
    expect(league(again, fx.l1, 1)).toMatchObject({ outcome: 'no_change' })
    await settle(8)
    expect(events).toHaveLength(1)
    expect(await matchupScores(fx.l1, 1)).toEqual(
      [
        { home: fx.t1, away: fx.t2, hs: 97.08, as: 0 },
        { home: fx.t3, away: fx.t4, hs: 7, as: 0 },
      ].sort((a, b) => (a.home < b.home ? -1 : 1)),
    )
  }, 60_000)
})
