/**
 * waiver-run-failure-db.test.ts — M7 L.F2.3 DRILL 4: the waiver job
 * fails for one league (spec §24.3 "waiver job partial failure (re-run
 * idempotently per league)"; §22.3 "every job handler is idempotent";
 * runbook `docs/runbooks/waiver-partial-failure.md`; PROGRESS D764).
 *
 * The waiver processor runs IN the database (`waiver_tick` → one
 * subtransaction per due league, 150 / 183), so a crash there is a
 * rollback, not a half-written league: this drill injects the failure the
 * runbook names — a team with claims in a FAAB league and no FAAB balance on
 * record — into one of two leagues due at the same instant, and checks the
 * runbook's promises: the healthy league settles once; the broken one is
 * refused whole (claims pending, no FAAB moved, no roster touched), retried
 * every tick and recorded each time; once the data is fixed it settles
 * EXACTLY once, with the same outcome as the healthy league; nothing is
 * ever awarded twice.
 *
 * SCOPE, SAID PLAINLY: every tick names its league (`p_league_id`). An
 * unscoped tick processes every due league in the database, and the local
 * database is shared — so the two leagues meet the processor one call each.
 * The per-league subtransaction inside one unscoped tick is the same block
 * either way (183's loop); that it isolates leagues inside ONE tick is not
 * re-proved here (deferred to the hosted test project, L.F2.10 — F834).
 *
 * The live `process-waivers` cron is a legal concurrent actor: both runs sit
 * in August 2072, never due for the wall clock.
 *
 * Requires the local stack (D59(5)). Fixtures `chaos-f23 waiv …`, season
 * 2072, `chaos_f23_waiv_*` users, players `chaos-f23-wv-*` — swept before
 * and after.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Json } from '@/types/database'

import { seedSyntheticSeason } from '../sim/synthetic-season'
import { CHAOS_PREFIX, CHAOS_SEASON, census, createChaosUser, must, mustRow, runReconcileCli, serviceClient, sweep, type ChaosUser } from './chaos-world'

const service = serviceClient()
const RUN = '2072-08-01T12:00:00.000Z'
const MINUTE = 60_000
const plus = (minutes: number) => new Date(Date.parse(RUN) + minutes * MINUTE).toISOString()

const POOL = Array.from({ length: 12 }, (_, i) => ({
  id: `${CHAOS_PREFIX}-wv-${String(i).padStart(2, '0')}`,
  full_name: `Chaos WV ${String(i).padStart(2, '0')}`,
  position: i % 2 === 0 ? 'WR' : 'RB',
  team: 'CXA',
  status: 'Active',
}))
/** Players 00–07 start on rosters (two per team); 08–11 are free. */
const TARGET_A = POOL[8].id
const TARGET_B = POOL[9].id

interface WaiverLeague {
  id: string
  teams: string[]
  managers: string[]
}

const users: ChaosUser[] = []
const leagues: Record<'healthy' | 'broken', WaiverLeague> = { healthy: { id: '', teams: [], managers: [] }, broken: { id: '', teams: [], managers: [] } }

async function tick(league: WaiverLeague, at: string): Promise<{ settled: Array<{ league_id: string }>; failures: Array<{ league_id: string; error: string }>; leagues: number }> {
  const { data, error } = await service.rpc('waiver_tick', { p_now: at, p_league_id: league.id })
  if (error) throw new Error(`waiver_tick: ${error.message}`)
  return data as unknown as { settled: Array<{ league_id: string }>; failures: Array<{ league_id: string; error: string }>; leagues: number }
}

/** Everything a waiver run can change, as one comparable picture. */
async function picture(league: WaiverLeague) {
  const claims = await must(service.from('waiver_claims').select('team_id, add_player_id, status').eq('league_id', league.id).order('created_at'), 'claims')
  const seats = await must(service.from('league_members').select('team_id, faab_balance').eq('league_id', league.id).order('team_id'), 'seats')
  const rosters = await must(service.from('league_rosters').select('team_id, player_id').eq('league_id', league.id).order('player_id'), 'rosters')
  const txns = await must(service.from('transactions').select('initiator_team_id, payload').eq('league_id', league.id).eq('type', 'waiver_claim'), 'transactions')
  const team = (id: string | null) => `T${league.teams.indexOf(id ?? '') + 1}`
  return {
    claims: (claims ?? []).map((c) => `${team(c.team_id)} ${c.add_player_id.slice(-5)} ${c.status}`).sort(),
    faab: (seats ?? []).map((s) => `${team(s.team_id)} ${s.faab_balance === null ? 'null' : s.faab_balance}`).sort(),
    owners: Object.fromEntries([TARGET_A, TARGET_B].map((p) => [p.slice(-5), (rosters ?? []).filter((r) => r.player_id === p).map((r) => team(r.team_id))])),
    wonTransactions: (txns ?? []).map((t) => `${team(t.initiator_team_id)} ${String((t.payload as { add_player_id?: string }).add_player_id ?? '').slice(-5)} $${(t.payload as { faab_bid?: number }).faab_bid ?? '?'}`).sort(),
  }
}

async function runRows(league: WaiverLeague) {
  return (await must(service.from('waiver_runs').select('run_at, status, attempts, last_error').eq('league_id', league.id).order('run_at'), 'runs')) ?? []
}

async function buildLeague(tag: 'healthy' | 'broken', templateId: string, rules: Json): Promise<WaiverLeague> {
  const league = await mustRow(
    service
      .from('leagues')
      .insert({
        owner_id: users[0].userId,
        name: `${CHAOS_PREFIX} waiv ${tag}`,
        season: CHAOS_SEASON,
        status: 'in_season',
        team_count: 8,
        scoring_system_id: templateId,
        scoring_rules_snapshot: rules,
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
        roster_settings: { starting_slots: [{ key: 'qb', label: 'QB', eligible: ['QB'], count: 1 }], bench: 5, ir_slots: [], swap_spots: 0 } as unknown as Json,
        waiver_next_run_at: RUN,
      })
      .select('id')
      .single(),
    `league ${tag}`,
  )
  const out: WaiverLeague = { id: league.id, teams: [], managers: [] }
  for (const [i, u] of users.entries()) {
    const team = await mustRow(service.from('teams').insert({ owner_id: u.userId, name: `WV ${tag} ${i + 1}`, league_id: league.id }).select('id').single(), 'team')
    out.teams.push(team.id)
    out.managers.push(u.userId)
    await must(service.from('league_members').insert({ league_id: league.id, user_id: u.userId, team_id: team.id, role: i === 0 ? 'commissioner' : 'manager', faab_balance: 100 }), 'seat')
  }
  await must(service.from('league_weeks').insert(Array.from({ length: 14 }, (_, i) => ({ league_id: league.id, season: CHAOS_SEASON, week: i + 1 }))), 'league_weeks')
  await must(service.from('drafts').insert({ league_id: league.id, status: 'complete', completed_at: '2072-07-01T00:00:00Z', draft_order: out.teams as unknown as Json }), 'draft')
  await must(
    service.from('league_rosters').insert(out.teams.flatMap((t, i) => [POOL[2 * i], POOL[2 * i + 1]].map((p) => ({ league_id: league.id, team_id: t, player_id: p.id, slot_key: 'bn' })))),
    'rosters',
  )
  // The same three claims in both leagues: T1 and T2 both want A (T2 bids more), T3 wants B.
  await must(
    service.from('waiver_claims').insert([
      { league_id: league.id, team_id: out.teams[0], add_player_id: TARGET_A, drop_player_id: null, faab_bid: 10, claim_order: 1, action_id: crypto.randomUUID(), created_by: out.managers[0] },
      { league_id: league.id, team_id: out.teams[1], add_player_id: TARGET_A, drop_player_id: null, faab_bid: 20, claim_order: 1, action_id: crypto.randomUUID(), created_by: out.managers[1] },
      { league_id: league.id, team_id: out.teams[2], add_player_id: TARGET_B, drop_player_id: null, faab_bid: 5, claim_order: 1, action_id: crypto.randomUUID(), created_by: out.managers[2] },
    ]),
    'claims',
  )
  return out
}

/** The outcome both leagues must end on (stored literals). */
const SETTLED = {
  claims: ['T1 wv-08 lost', 'T2 wv-08 won', 'T3 wv-09 won'],
  faab: ['T1 100', 'T2 80', 'T3 95', 'T4 100'],
  owners: { 'wv-08': ['T2'], 'wv-09': ['T3'] },
  wonTransactions: ['T2 wv-08 $20', 'T3 wv-09 $5'],
}

beforeAll(async () => {
  await sweep(service)
  await seedSyntheticSeason(service, CHAOS_SEASON)
  await must(service.from('players').upsert(POOL), 'players')
  for (let i = 1; i <= 4; i++) users.push(await createChaosUser(service, `waiv_m${i}`))
  const template = await mustRow(service.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single(), 'template')
  leagues.healthy = await buildLeague('healthy', template.id, template.rules)
  leagues.broken = await buildLeague('broken', template.id, template.rules)
  // THE FAULT (the runbook's own example): T2 of the broken league has claims and no FAAB balance on record.
  await must(service.from('league_members').update({ faab_balance: null }).eq('league_id', leagues.broken.id).eq('team_id', leagues.broken.teams[1]), 'fault')
}, 120_000)

afterAll(async () => {
  await sweep(service)
  expect(Object.values(await census(service)).every((n) => n === 0)).toBe(true)
}, 120_000)

describe('L.F2.3 drill 4 — the waiver run fails for one league', () => {
  let brokenBefore: Awaited<ReturnType<typeof picture>>

  it('W1 the healthy league settles at its run time', async () => {
    const r = await tick(leagues.healthy, RUN)
    expect([r.settled.length, r.failures.length]).toEqual([1, 0])
    expect(await picture(leagues.healthy)).toEqual(SETTLED)
  })

  it('W2 the broken league is refused WHOLE: claims pending, no FAAB moved, no roster touched, the failure recorded with its reason', async () => {
    brokenBefore = await picture(leagues.broken)
    const r = await tick(leagues.broken, RUN)
    expect([r.settled.length, r.failures.length]).toEqual([0, 1])
    expect(r.failures[0].error).toMatch(/FAAB/i)
    expect(await picture(leagues.broken)).toEqual(brokenBefore)
    expect(brokenBefore.claims).toEqual(['T1 wv-08 pending', 'T2 wv-08 pending', 'T3 wv-09 pending'])
    const runs = await runRows(leagues.broken)
    expect(runs.map((x) => [new Date(x.run_at).toISOString(), x.status, x.attempts])).toEqual([[RUN, 'refused', 1]])
    console.log(`[L.F2.3 drill 4] the refusal the runbook's step 2 reads: ${runs[0].last_error}`)
  })

  it('W3 the next ticks retry the broken league (counted) and never touch the healthy one again', async () => {
    for (const m of [1, 2]) {
      const b = await tick(leagues.broken, plus(m))
      expect([b.settled.length, b.failures.length]).toEqual([0, 1])
      const h = await tick(leagues.healthy, plus(m))
      expect(h.settled.length).toBe(0)
    }
    expect((await runRows(leagues.broken)).map((x) => [x.status, x.attempts])).toEqual([['refused', 3]])
    expect(await picture(leagues.broken)).toEqual(brokenBefore)
    expect(await picture(leagues.healthy)).toEqual(SETTLED) // nothing awarded twice
  })

  it('W4 the data is fixed (the commissioner\'s step 5): the next tick settles the broken league EXACTLY once, with the healthy league\'s outcome', async () => {
    await must(service.from('league_members').update({ faab_balance: 100 }).eq('league_id', leagues.broken.id).eq('team_id', leagues.broken.teams[1]), 'fix')
    const r = await tick(leagues.broken, plus(3))
    expect([r.settled.length, r.failures.length]).toEqual([1, 0])
    expect(await picture(leagues.broken)).toEqual(SETTLED)
    for (const m of [4, 5]) expect((await tick(leagues.broken, plus(m))).settled.length).toBe(0)
    expect(await picture(leagues.broken)).toEqual(SETTLED)
    const runs = await runRows(leagues.broken)
    console.log(`[L.F2.3 drill 4] the broken league's run rows after the fix: ${JSON.stringify(runs.map((x) => [x.run_at, x.status, x.attempts]))}`)
    expect(runs.filter((x) => x.status === 'settled')).toHaveLength(1)
  })

  it('END reconcile exits 0 for both leagues (no scored week: 0 cells — said, not hidden)', () => {
    const cli = runReconcileCli([leagues.healthy.id, leagues.broken.id])
    console.log(`[L.F2.3 drill 4] reconcile CLI exit ${cli.status}: ${JSON.stringify(cli.summary)}`)
    expect(cli.status, cli.stdout + cli.stderr).toBe(0)
    expect(cli.summary).toMatchObject({ alerts: 0 })
  }, 150_000)
})
