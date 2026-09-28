/**
 * waivers-resolver-parity-db.test.ts — M5 L.D2.9 (FULL rigour): the SQL
 * processor (migration 150) is proven EQUAL to the TS reference resolver
 * (`resolveWaiverRun`, re-cut to F422 in this PR) — tasks-M5 TD7 / §6
 * L.D2.9 "Proofs"; PROGRESS F421(f)/(g).
 *
 *   A. PURE PARITY — the same random claim sets (the property suite's own
 *      generators, `waiver-run-arbitraries.ts`) through both
 *      implementations: `waiver_resolve_run_internal` (the SQL twin) and
 *      `resolveWaiverRun`. The SQL answer is MAPPED into a `WaiverRunResult`
 *      (same fields, same array orders) and compared through
 *      `serializeWaiverRunResult` — never SQL's own JSON text (jsonb
 *      reorders keys, F421(f)). PARITY_RUNS (default 1000) seeded runs.
 *   B. REFUSED INPUT ON BOTH SIDES (F421(g)) — a player on two rosters, a
 *      priority list that is not the active teams, a FAAB claim with no
 *      balance, `none_fcfs`: both refuse, with the SAME message.
 *   C. THROUGH THE PROCESSOR — a real league, real claims, the per-minute
 *      tick: the run's stored input fed to the TS resolver gives the result
 *      the tables now hold (claim statuses + reasons, balances, rosters,
 *      priorities, the won claim's transactions row incl. F416's names —
 *      the League Home sentence over that shape is pinned in
 *      activity-feed-ops.test.ts); two ticks racing settle the run
 *      exactly ONCE (SKIP LOCKED); a claim and an add racing for one player
 *      (E8) — one wins, the other is refused by name.
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down. The
 * live `process-waivers` cron is a legal concurrent actor: the fixture
 * league's pending run sits in 2099 at rest (never due for the cron), and
 * each processing step moves it and ticks at once, away from the minute
 * boundary the cron fires on. Fixture prefix `vitest-wparity` / players
 * `vitest-wp-*` / action ids `d29…` (this suite owns them).
 */
import { createClient } from '@supabase/supabase-js'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import {
  resolveWaiverRun,
  serializeWaiverRunResult,
  WaiverRunInputError,
  type WaiverClaimOutcome,
  type WaiverRunInput,
  type WaiverRunResult,
} from './resolve-waiver-run'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'

import { inputArb } from './waiver-run-arbitraries'
import { claim, input, team } from './waiver-run-fixture'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const SEED = process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : 20260928
const PARITY_RUNS = process.env.PARITY_RUNS !== undefined ? Number(process.env.PARITY_RUNS) : 1000

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
const rpc = service.rpc.bind(service) as unknown as Rpc

/** The SQL answer, mapped into the TS result's field order (F421(f)). */
function mapSqlResult(j: unknown): WaiverRunResult {
  const r = j as {
    outcomes: Array<Record<string, unknown>>
    teams: Array<Record<string, unknown>>
    priority: Record<string, unknown>
  }
  return {
    outcomes: r.outcomes.map(
      (o) =>
        ({
          decision: o.decision,
          claimId: o.claimId,
          teamId: o.teamId,
          addPlayerId: o.addPlayerId,
          dropPlayerId: o.dropPlayerId,
          status: o.status,
          reason: o.reason,
          faabSpent: o.faabSpent,
        }) as WaiverClaimOutcome,
    ),
    teams: r.teams.map((t) => ({
      teamId: t.teamId as string,
      faabBefore: t.faabBefore as number | null,
      faabAfter: t.faabAfter as number | null,
      rosterAfter: t.rosterAfter as string[],
      acquisitionsWeekAfter: t.acquisitionsWeekAfter as number,
      acquisitionsSeasonAfter: t.acquisitionsSeasonAfter as number,
    })),
    priority: {
      source: r.priority.source as WaiverRunResult['priority']['source'],
      persists: r.priority.persists as boolean,
      before: r.priority.before as string[],
      after: r.priority.after as string[],
    },
  }
}

async function sqlResolve(inp: WaiverRunInput): Promise<{ result?: string; error?: string }> {
  const { data, error } = await rpc('waiver_resolve_run_internal', { p_input: inp })
  if (error) return { error: error.message }
  return { result: serializeWaiverRunResult(mapSqlResult(data)) }
}

function tsResolve(inp: WaiverRunInput): { result?: string; error?: string } {
  try {
    return { result: serializeWaiverRunResult(resolveWaiverRun(inp)) }
  } catch (e) {
    if (e instanceof WaiverRunInputError) return { error: e.message }
    throw e
  }
}

describe('A. pure parity — waiver_resolve_run_internal ≡ resolveWaiverRun, byte for byte', () => {
  it(`the SQL twin gives the TS resolver's exact bytes on ${PARITY_RUNS} seeded random claim sets`, async () => {
    const inputs = fc.sample(inputArb, { seed: SEED, numRuns: PARITY_RUNS })
    let decided = 0
    let won = 0
    for (const [i, inp] of inputs.entries()) {
      const ts = tsResolve(inp)
      const sql = await sqlResolve(inp)
      if (JSON.stringify(sql) !== JSON.stringify(ts)) {
        throw new Error(
          `parity broke on sample #${i} (seed ${SEED}):\n  input ${JSON.stringify(inp)}\n  ts    ${JSON.stringify(ts)}\n  sql   ${JSON.stringify(sql)}`,
        )
      }
      if (ts.result !== undefined) {
        const r = JSON.parse(ts.result) as WaiverRunResult
        decided += r.outcomes.length
        won += r.outcomes.filter((o) => o.status === 'won').length
      }
    }
    // Non-vacuity: the population actually decided claims and awarded some.
    expect(decided).toBeGreaterThan(PARITY_RUNS)
    expect(won).toBeGreaterThan(PARITY_RUNS / 2)
  }, 300_000)
})

describe('B. refused input — both sides refuse, with the same message (F421(g))', () => {
  const cases: Array<[string, WaiverRunInput]> = [
    ['a player on two rosters', input({ teams: [team('A', ['P']), team('B', ['P'])], claims: [] })],
    ['a priority list that is not the active teams', input({ teams: [team('A'), team('B')], claims: [], draftOrder: ['A'] })],
    ['a FAAB claim from a team with no balance on record', input({ teams: [team('A', [], null)], claims: [claim('a1', 'A', 'P', 0, 1)] })],
    ['the none_fcfs type', input({ teams: [team('A')], claims: [], settings: { waiverType: 'none_fcfs' as unknown as 'faab' } })],
    ['a claim listed twice', input({ teams: [team('A')], claims: [claim('c', 'A', 'P', 1, 1), claim('c', 'A', 'Q', 1, 2)] })],
  ]
  for (const [name, inp] of cases) {
    it(`${name}: refused by name on both sides, the same words`, async () => {
      const ts = tsResolve(inp)
      const sql = await sqlResolve(inp)
      expect(ts.error).toMatch(/^resolveWaiverRun: /)
      expect(sql.error).toBe(ts.error)
    })
  }
})

// ── C. Through the processor ────────────────────────────────────────────────

const LEAGUE_NAME = 'vitest-wparity-league'
const E2E_RUNS = process.env.PARITY_E2E_RUNS !== undefined ? Number(process.env.PARITY_E2E_RUNS) : 6
const DAY_MS = 86_400_000
/** The fixture league's first run: 12:00 UTC on a day well before the
 *  synthetic 2099 season opens (no week has started ⇒ nobody is locked), and
 *  far ahead of the wall clock — so the live `process-waivers` cron, which
 *  ticks at now(), never finds this league due. */
const FIRST_RUN_MS = Date.UTC(2099, 7, 1, 12, 0, 0)

const USERS = [
  { key: 'commish', email: 'wparity-commish@fieldscout.test', password: 'pgtap-wp-pass-1', username: 'wpar_commish' },
  { key: 'a', email: 'wparity-a@fieldscout.test', password: 'pgtap-wp-pass-2', username: 'wpar_a' },
  { key: 'b', email: 'wparity-b@fieldscout.test', password: 'pgtap-wp-pass-3', username: 'wpar_b' },
  { key: 'c', email: 'wparity-c@fieldscout.test', password: 'pgtap-wp-pass-4', username: 'wpar_c' },
] as const
const POOL = Array.from({ length: 16 }, (_, i) => ({
  id: `vitest-wp-${String(i).padStart(2, '0')}`,
  full_name: `Vitest WP ${String(i).padStart(2, '0')}`,
  position: i % 2 === 0 ? 'WR' : 'RB',
  team: i % 3 === 0 ? 'VWA' : 'VWB',
  status: 'Active',
}))
const RACE_PLAYER = { id: 'vitest-wp-race', full_name: 'Vitest WP Race', position: 'TE', team: 'VWC', status: 'Active' }
const E8_PLAYER_ID = 'vitest-wp-e8'
const ROSTER_SIZE = 6

const userIds: Record<string, string> = {}
const teamIds: string[] = []
const managerOf: Record<string, string> = {}
let leagueId = ''

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((r) => r.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const tIds = (teams ?? []).map((r) => r.id)
    if (tIds.length > 0) {
      const { error: detach } = await service.from('teams').update({ league_id: null }).in('id', tIds)
      if (detach) throw new Error(`cleanup detach: ${detach.message}`)
    }
    const { error: lg } = await service.from('leagues').delete().in('id', ids)
    if (lg) throw new Error(`cleanup leagues: ${lg.message}`)
    if (tIds.length > 0) {
      const { error: tm } = await service.from('teams').delete().in('id', tIds)
      if (tm) throw new Error(`cleanup teams: ${tm.message}`)
    }
  }
  const { error: pl } = await service.from('players').delete().in('id', [...POOL.map((p) => p.id), RACE_PLAYER.id, E8_PLAYER_ID])
  if (pl) throw new Error(`cleanup players: ${pl.message}`)
  for (const u of USERS) await deleteUserByUsername(u.username)
}

/** A write whose answer carries no rows — it must succeed. */
async function ok(label: string, p: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await p
  if (error) throw new Error(`${label}: ${error.message}`)
}

/** A read or write that must succeed AND return data — an error or a null
 *  answer throws by name (never read as "nothing there"). */
async function must<R extends { data: unknown; error: { message: string } | null }>(label: string, p: PromiseLike<R>): Promise<NonNullable<R['data']>> {
  const { data, error } = await p
  if (error) throw new Error(`${label}: ${error.message}`)
  if (data === null || data === undefined) throw new Error(`${label}: no data`)
  return data as NonNullable<R['data']>
}

interface RunRow {
  input: WaiverRunInput
  result: unknown
  status: string
}

async function runRow(runAtMs: number): Promise<RunRow> {
  const rows = await must(
    'waiver_runs read',
    service.from('waiver_runs').select('input, result, status').eq('league_id', leagueId).eq('run_at', new Date(runAtMs).toISOString()),
  )
  expect(rows, `one waiver_runs row for ${new Date(runAtMs).toISOString()}`).toHaveLength(1)
  return rows[0] as unknown as RunRow
}

/** THE TABLES, read back into a WaiverRunResult (every field from the rows
 *  the run wrote; only the decision NUMBERS come from the stored result —
 *  a table does not record the order decisions were made in). */
async function tablesAsResult(input: WaiverRunInput, stored: WaiverRunResult): Promise<WaiverRunResult> {
  const claimIds = input.claims.map((c) => c.claimId)
  const claims = await must(
    'claims read',
    service.from('waiver_claims').select('id, team_id, add_player_id, drop_player_id, status, result_reason').in('id', claimIds.length > 0 ? claimIds : ['00000000-0000-0000-0000-000000000000']),
  )
  const txns = await must(
    'transactions read',
    service.from('transactions').select('payload, initiator_team_id, week, status').eq('league_id', leagueId).eq('type', 'waiver_claim'),
  )
  const spentByClaim = new Map<string, number>()
  for (const t of txns) {
    const p = t.payload as { claim_id?: string; faab_bid?: number }
    if (p.claim_id) spentByClaim.set(p.claim_id, p.faab_bid ?? 0)
  }
  const byId = new Map(claims.map((c) => [c.id, c]))
  const outcomes = stored.outcomes.map((o) => {
    const row = byId.get(o.claimId)
    if (!row) throw new Error(`claim ${o.claimId} not found`)
    return {
      decision: o.decision,
      claimId: row.id,
      teamId: row.team_id,
      addPlayerId: row.add_player_id,
      dropPlayerId: row.drop_player_id,
      status: row.status,
      reason: row.result_reason,
      faabSpent: row.status === 'won' ? (spentByClaim.get(row.id) ?? -1) : 0,
    } as WaiverClaimOutcome
  })
  const rosters = await must('rosters read', service.from('league_rosters').select('team_id, player_id').eq('league_id', leagueId))
  const seats = await must('seats read', service.from('league_members').select('team_id, faab_balance, waiver_priority').eq('league_id', leagueId))
  const allTx = await must(
    'caps read',
    service.from('transactions').select('initiator_team_id, week, status, payload').eq('league_id', leagueId).eq('status', 'complete'),
  )
  const week = Math.max(...allTx.map((t) => t.week ?? 0), 0)
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const teams = [...input.teams]
    .sort((a, b) => cmp(a.teamId, b.teamId))
    .map((t) => {
      const acq = allTx.filter((x) => x.initiator_team_id === t.teamId && (x.payload as { add_player_id?: string }).add_player_id)
      return {
        teamId: t.teamId,
        faabBefore: t.faabBalance,
        faabAfter: seats.find((s) => s.team_id === t.teamId)?.faab_balance ?? null,
        rosterAfter: rosters.filter((r) => r.team_id === t.teamId).map((r) => r.player_id).sort(cmp),
        acquisitionsWeekAfter: acq.filter((x) => x.week === week).length,
        acquisitionsSeasonAfter: acq.length,
      }
    })
  const after = seats
    .filter((s) => s.waiver_priority !== null)
    .sort((a, b) => (a.waiver_priority as number) - (b.waiver_priority as number))
    .map((s) => s.team_id as string)
  return { outcomes, teams, priority: { ...stored.priority, after: stored.priority.persists ? after : stored.priority.after } }
}

async function tick(runAtMs: number): Promise<Record<string, unknown>> {
  const { data, error } = await rpc('waiver_tick', { p_now: new Date(runAtMs).toISOString(), p_league_id: leagueId })
  if (error) throw new Error(`waiver_tick: ${error.message}`)
  return data as Record<string, unknown>
}

describe('C. through the processor — the tables equal the TS resolver on the run\'s own input', () => {
  beforeAll(async () => {
    await cleanup()
    await seedSyntheticSeason(service)
    for (const u of USERS) {
      const { data, error } = await service.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { username: u.username },
      })
      if (error) throw new Error(`createUser ${u.email}: ${error.message}`)
      userIds[u.key] = data.user.id
    }
    const template = await must(
      'template read',
      service.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single(),
    )
    const league = await must(
      'league insert',
      service
        .from('leagues')
        .insert({
          owner_id: userIds.commish,
          name: LEAGUE_NAME,
          season: SYNTHETIC_SEASON,
          status: 'in_season',
          team_count: 8,
          scoring_system_id: template.id,
          scoring_rules_snapshot: template.rules,
          lineup_lock: 'per_player_kickoff',
          waiver_type: 'faab',
          faab_budget: 100,
          settings: {
            faab_tiebreaker: 'rolling_priority',
            waiver_run_days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
            waiver_run_time: '12:00',
            waiver_time_zone: 'UTC',
            free_agency_opens: 'after_waiver_run',
          } as unknown as Json,
          roster_settings: {
            starting_slots: [{ key: 'qb', label: 'QB', eligible: ['QB'], count: 1 }],
            bench: ROSTER_SIZE - 1,
            ir_slots: [],
            swap_spots: 0,
          } as unknown as Json,
          waiver_next_run_at: new Date(FIRST_RUN_MS).toISOString(),
        })
        .select('id')
        .single(),
    )
    leagueId = league.id
    for (const key of ['commish', 'a', 'b', 'c'] as const) {
      const team = await must(
        'team insert',
        service.from('teams').insert({ owner_id: userIds[key], name: `WPar ${key}`, league_id: leagueId }).select('id').single(),
      )
      teamIds.push(team.id)
      managerOf[team.id] = userIds[key]
      await ok(
        'seat insert',
        service.from('league_members').insert({
          league_id: leagueId,
          user_id: userIds[key],
          team_id: team.id,
          role: key === 'commish' ? 'commissioner' : 'manager',
          faab_balance: 100,
        }),
      )
    }
    await ok(
      'league_weeks insert',
      service.from('league_weeks').insert(Array.from({ length: 14 }, (_, i) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week: i + 1 }))),
    )
    await ok(
      'draft insert',
      service.from('drafts').insert({ league_id: leagueId, status: 'complete', completed_at: '2099-07-01T00:00:00Z', draft_order: teamIds as unknown as Json }),
    )
    await ok('players upsert', service.from('players').upsert([...POOL, RACE_PLAYER]))
    // Two players each to start (POOL 00–07), the rest free.
    await ok(
      'rosters insert',
      service.from('league_rosters').insert(
        teamIds.flatMap((t, i) => [POOL[2 * i], POOL[2 * i + 1]].map((p) => ({ league_id: leagueId, team_id: t, player_id: p.id, slot_key: 'bn' }))),
      ),
    )
  }, 120_000)

  afterAll(async () => {
    await cleanup()
  }, 60_000)

  it(`${E2E_RUNS} seeded random runs: each run's stored result is the TS resolver's (bytes), and the tables it wrote say the same`, async () => {
    const claimArb = fc.array(
      fc.record({
        team: fc.nat({ max: 3 }),
        add: fc.nat({ max: POOL.length - 1 }),
        drop: fc.option(fc.nat({ max: 20 }), { freq: 2 }),
        bid: fc.oneof(fc.integer({ min: 0, max: 45 }), fc.constantFrom(5, 10, 20)),
        order: fc.integer({ min: 1, max: 4 }),
      }),
      { minLength: 3, maxLength: 12 },
    )
    const plans = fc.sample(claimArb, { seed: SEED, numRuns: E2E_RUNS })
    let won = 0
    for (const [r, plan] of plans.entries()) {
      const runAt = FIRST_RUN_MS + r * DAY_MS
      const rosters = await must('rosters read', service.from('league_rosters').select('team_id, player_id').eq('league_id', leagueId))
      const seen = new Set<string>()
      const rows = []
      for (const c of plan) {
        const team = teamIds[c.team]
        const own = rosters.filter((x) => x.team_id === team).map((x) => x.player_id).sort()
        const add = POOL[c.add].id
        const drop = c.drop === null || own.length === 0 ? null : own[c.drop % own.length]
        if (drop === add) continue
        const key = `${team}|${add}|${drop ?? ''}`
        if (seen.has(key)) continue // the verbs refuse an identical pending claim; so does the partial unique index
        seen.add(key)
        rows.push({
          league_id: leagueId,
          team_id: team,
          add_player_id: add,
          drop_player_id: drop,
          faab_bid: c.bid,
          claim_order: c.order,
          action_id: crypto.randomUUID(),
          created_by: managerOf[team],
        })
      }
      await ok('claims insert', service.from('waiver_claims').insert(rows))
      const report = await tick(runAt)
      const settled = (report.settled as Array<{ league_id: string; status: string }>).filter((s) => s.league_id === leagueId)
      expect(settled, JSON.stringify(report)).toHaveLength(1)

      const row = await runRow(runAt)
      expect(row.status).toBe('settled')
      const ts = resolveWaiverRun(row.input)
      const stored = mapSqlResult(row.result)
      expect(serializeWaiverRunResult(stored), `run ${r}: stored result vs TS`).toBe(serializeWaiverRunResult(ts))
      const tables = await tablesAsResult(row.input, stored)
      expect(serializeWaiverRunResult(tables), `run ${r}: tables vs TS`).toBe(serializeWaiverRunResult(ts))
      won += ts.outcomes.filter((o) => o.status === 'won').length
    }
    expect(won).toBeGreaterThan(0) // non-vacuity
  }, 180_000)

  it("F416: every won claim's transactions row carries 113's add / drop objects — the players' real names, positions and teams (the League Home sentence over this shape is pinned in activity-feed-ops.test.ts)", async () => {
    const txns = await must(
      'txn read',
      service.from('transactions').select('payload').eq('league_id', leagueId).eq('type', 'waiver_claim').limit(50),
    )
    expect(txns.length).toBeGreaterThan(0)
    const players = new Map([...POOL, RACE_PLAYER].map((p) => [p.id, p]))
    for (const t of txns) {
      const p = t.payload as {
        add_player_id: string
        drop_player_id: string | null
        add: { player_id: string; name: string; position: string; nfl_team: string }
        drop: { player_id: string; name: string; position: string; nfl_team: string } | null
        faab_bid: number
        faab_before: number | null
        faab_after: number | null
      }
      const add = players.get(p.add_player_id)
      expect([p.add.player_id, p.add.name, p.add.position, p.add.nfl_team]).toStrictEqual([add?.id, add?.full_name, add?.position, add?.team])
      if (p.drop_player_id === null) {
        expect(p.drop).toBeNull()
      } else {
        const drop = players.get(p.drop_player_id)
        expect([p.drop?.player_id, p.drop?.name, p.drop?.position, p.drop?.nfl_team]).toStrictEqual([drop?.id, drop?.full_name, drop?.position, drop?.team])
      }
      expect((p.faab_before ?? 0) - (p.faab_after ?? 0)).toBe(p.faab_bid) // a FAAB league: the price is the debit
    }
  })

  it('two ticks RACING settle a due run exactly once (FOR UPDATE SKIP LOCKED)', async () => {
    const runAt = FIRST_RUN_MS + E2E_RUNS * DAY_MS
    const team = teamIds[0]
    const rosterCount = (await must('count', service.from('league_rosters').select('player_id').eq('team_id', team))).length
    const drop = rosterCount >= ROSTER_SIZE ? (await must('own', service.from('league_rosters').select('player_id').eq('team_id', team).limit(1)))[0].player_id : null
    const claim = await must(
      'race claim',
      service
        .from('waiver_claims')
        .insert({ league_id: leagueId, team_id: team, add_player_id: RACE_PLAYER.id, drop_player_id: drop, faab_bid: 1, claim_order: 1, action_id: crypto.randomUUID(), created_by: managerOf[team] })
        .select('id')
        .single(),
    )
    const before = (await must('bal', service.from('league_members').select('faab_balance').eq('team_id', team).single())).faab_balance as number
    const [x, y] = await Promise.all([tick(runAt), tick(runAt)])
    const settledCount = [x, y].map((r) => (r.settled as Array<{ league_id: string }>).filter((s) => s.league_id === leagueId).length)
    expect(settledCount.sort()).toStrictEqual([0, 1])
    const runs = await must('runs', service.from('waiver_runs').select('status').eq('league_id', leagueId).eq('run_at', new Date(runAt).toISOString()))
    expect(runs).toStrictEqual([{ status: 'settled' }])
    const c = await must('claim', service.from('waiver_claims').select('status').eq('id', claim.id).single())
    expect(c.status).toBe('won')
    const after = (await must('bal', service.from('league_members').select('faab_balance').eq('team_id', team).single())).faab_balance as number
    expect(before - after).toBe(1)
    const txn = await must('txn', service.from('transactions').select('id').eq('league_id', leagueId).contains('payload', { claim_id: claim.id }))
    expect(txn).toHaveLength(1)
  }, 60_000)

  it('E8: a claim and an instant add RACING for one player — exactly one gets him; the other is refused by name (never a raw 23505)', async () => {
    const runAt = FIRST_RUN_MS + (E2E_RUNS + 1) * DAY_MS
    const claimer = teamIds[1]
    const adder = teamIds[2]
    const target = { id: E8_PLAYER_ID, full_name: 'Vitest WP Eight', position: 'TE', team: 'VWC', status: 'Active' }
    await ok('player', service.from('players').upsert([target]))
    const room = async (t: string): Promise<string | null> => {
      const own = await must('own', service.from('league_rosters').select('player_id').eq('team_id', t))
      return own.length >= ROSTER_SIZE ? own[0].player_id : null
    }
    const claimDrop = await room(claimer)
    const addDrop = await room(adder)
    const claim = await must(
      'e8 claim',
      service
        .from('waiver_claims')
        .insert({ league_id: leagueId, team_id: claimer, add_player_id: target.id, drop_player_id: claimDrop, faab_bid: 2, claim_order: 1, action_id: crypto.randomUUID(), created_by: managerOf[claimer] })
        .select('id')
        .single(),
    )
    const adderClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
    const { error: signInError } = await adderClient.auth.signInWithPassword({ email: USERS[2].email, password: USERS[2].password })
    if (signInError) throw new Error(`sign-in: ${signInError.message}`)
    const [, add] = await Promise.all([
      tick(runAt),
      (adderClient.rpc as unknown as Rpc)('roster_add_drop', {
        p_league_id: leagueId,
        p_team_id: adder,
        p_add: target.id,
        p_drop: addDrop,
        p_action_id: crypto.randomUUID(),
      }),
    ])
    const owners = await must('owners', service.from('league_rosters').select('team_id').eq('league_id', leagueId).eq('player_id', target.id))
    expect(owners).toHaveLength(1)
    const c = await must('claim', service.from('waiver_claims').select('status, result_reason').eq('id', claim.id).single())
    if (add.error === null) {
      // The add held the league row first: the claim found him rostered.
      expect(owners[0].team_id).toBe(adder)
      expect(c).toStrictEqual({ status: 'invalid', result_reason: 'add_rostered' })
    } else {
      // The run held it first: the add is refused by name.
      expect(owners[0].team_id).toBe(claimer)
      expect(c).toStrictEqual({ status: 'won', result_reason: null })
      expect(add.error.code).toBe('P0001')
      expect(add.error.message).toMatch(/already on WPar a's roster in this league/)
    }
  }, 60_000)
})
