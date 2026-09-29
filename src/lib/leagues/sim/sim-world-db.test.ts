/**
 * sim-world-db.test.ts — M5 L.D3.10 fix round (R1267, R1270; PROGRESS D423).
 * Stack pins for what the season sim does to the SHARED player pool and for
 * the sweep that undoes it:
 *
 *   1. MASK → PLANT → RESTORE round trip (F374 / R1266): a blocking status is
 *      masked `sim-world:<original>`, a non-blocking one is untouched, a plant
 *      writes `Out` + the recorded original, the census counts both, and one
 *      `cleanupSweep` puts every fixture back byte-identical.
 *   2. THE PAGED DETACH: a sim league holding MORE than PostgREST's 1000-row
 *      cap of teams is swept whole (unpaged, the first 1000 were detached and
 *      the league delete failed on `teams_league_id_fkey`).
 *   3. R1270: a sim-world restore that throws does not stop the sweep — the
 *      leagues and users are still swept — and the sweep then throws by name.
 *
 * Fixture players carry the `vitest-simworld-` id prefix and are deleted in
 * `afterAll`; anything the sim world touched is restored there too. The
 * sweep's other season-wide deletes (season 2099 stat / queue rows) are the
 * same ones every sim run makes; stack suites run serialized (F52).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  cleanupSweep,
  maskBlockingStatuses,
  plantDesignations,
  restoreSimWorld,
  simCensus,
  SIM_PLANTED_STATUS,
  SIM_USERNAME_PREFIX,
  SIM_WORLD_PLANT_PREFIX,
} from './runner'
import { SIM_LEAGUE_PREFIX } from './plan'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-simworld-'
const FIXTURES: Array<{ id: string; status: string | null; injury_notes: string | null }> = [
  { id: `${PREFIX}out`, status: 'Out', injury_notes: 'hamstring' },
  { id: `${PREFIX}ir`, status: 'IR', injury_notes: null },
  { id: `${PREFIX}questionable`, status: 'Questionable', injury_notes: 'ankle' },
  { id: `${PREFIX}healthy`, status: null, injury_notes: null },
]
const TEAMS = 1_050

let service: SupabaseClient<Database>
const logs: string[] = []

async function readFixtures(): Promise<Map<string, { status: string | null; injury_notes: string | null }>> {
  const { data, error } = await service.from('players').select('id, status, injury_notes').like('id', `${PREFIX}%`)
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((r) => [r.id, { status: r.status, injury_notes: r.injury_notes }]))
}

async function seedBigSimLeague(tag: string): Promise<string> {
  // Short: a longer handle fails the username rule and the profile gets a
  // generated one, which the sweep (matching the sim prefix) would not delete.
  const username = `${SIM_USERNAME_PREFIX}v${tag.slice(0, 2)}`
  const { data: created, error: userError } = await service.auth.admin.createUser({
    email: `sim-b6-bot-vitest-${tag}@fieldscout.test`,
    password: 'vitest-sim-world-1234',
    email_confirm: true,
    user_metadata: { username },
  })
  if (userError) throw new Error(userError.message)
  const owner = created.user.id
  const { data: league, error: leagueError } = await service
    .from('leagues')
    .insert({ name: `${SIM_LEAGUE_PREFIX} vitest ${tag}`, owner_id: owner, season: 2099 })
    .select('id')
    .single()
  if (leagueError) throw new Error(leagueError.message)
  for (let i = 0; i < TEAMS; i += 500) {
    const rows = Array.from({ length: Math.min(500, TEAMS - i) }, (_, k) => ({
      league_id: league.id,
      owner_id: owner,
      name: `vitest sim-world team ${i + k}`,
    }))
    const { error } = await service.from('teams').insert(rows)
    if (error) throw new Error(error.message)
  }
  return league.id
}

async function teamsIn(leagueId: string): Promise<number> {
  const { count, error } = await service.from('teams').select('id', { count: 'exact', head: true }).eq('league_id', leagueId)
  if (error) throw new Error(error.message)
  return count ?? -1
}

beforeAll(async () => {
  service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  await cleanupSweep(service, (l) => logs.push(l))
  const { error } = await service.from('players').upsert(
    FIXTURES.map((f) => ({ id: f.id, full_name: `Vitest ${f.id}`, position: 'WR', team: null, status: f.status, injury_notes: f.injury_notes })),
  )
  if (error) throw new Error(error.message)
})

afterAll(async () => {
  // Whatever happened above: the world restored, the fixtures gone, the stack swept.
  await service.from('players').update({ injury_notes: null }).eq('id', `${PREFIX}healthy`).like('injury_notes', `${SIM_WORLD_PLANT_PREFIX}{broken%`)
  await restoreSimWorld(service)
  await cleanupSweep(service, (l) => logs.push(l))
  await service.from('players').delete().like('id', `${PREFIX}%`)
  // Belt and braces: the fixture users by email, whatever their handle became.
  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 })
  for (const u of users?.users ?? []) {
    if ((u.email ?? '').startsWith('sim-b6-bot-vitest-')) await service.auth.admin.deleteUser(u.id)
  }
})

describe('the sim world (R1266 / R1267 / R1270)', () => {
  it('mask → plant → one sweep restores every fixture byte-identical; the census counts both halves meanwhile', async () => {
    const before = await readFixtures()
    expect(before.size).toBe(FIXTURES.length)

    const masked = await maskBlockingStatuses(service)
    expect(masked.Out ?? 0).toBeGreaterThanOrEqual(1)
    expect(masked.IR ?? 0).toBeGreaterThanOrEqual(1)
    const afterMask = await readFixtures()
    expect(afterMask.get(`${PREFIX}out`)!.status).toBe('sim-world:Out')
    expect(afterMask.get(`${PREFIX}ir`)!.status).toBe('sim-world:IR')
    expect(afterMask.get(`${PREFIX}questionable`)!.status).toBe('Questionable') // not blocking — untouched
    expect(afterMask.get(`${PREFIX}healthy`)!.status).toBeNull()

    // A plant on a MASKED player (its recorded status is the mask) and on a healthy one.
    await plantDesignations(service, [`${PREFIX}ir`, `${PREFIX}healthy`])
    const afterPlant = await readFixtures()
    expect(afterPlant.get(`${PREFIX}ir`)!.status).toBe(SIM_PLANTED_STATUS)
    expect(afterPlant.get(`${PREFIX}ir`)!.injury_notes).toBe(`${SIM_WORLD_PLANT_PREFIX}{"status":"sim-world:IR","injury_notes":null}`)
    expect(afterPlant.get(`${PREFIX}healthy`)!.injury_notes).toBe(`${SIM_WORLD_PLANT_PREFIX}{"status":null,"injury_notes":null}`)
    await expect(plantDesignations(service, [`${PREFIX}healthy`])).rejects.toThrow('already planted')

    const census = new Map((await simCensus(service)).map((c) => [c.what, c.count]))
    expect(census.get('players(status sim-world:*)')).toBeGreaterThanOrEqual(1)
    expect(census.get(`players(planted ${SIM_PLANTED_STATUS})`)).toBe(2)

    const summary = await cleanupSweep(service, (l) => logs.push(l))
    expect(summary).toMatch(/2 planted designation\(s\) restored/)
    expect(await readFixtures()).toEqual(before)
    const clean = await simCensus(service)
    expect(clean.filter((c) => c.count !== 0)).toEqual([])
  })

  it('a sim league holding more than 1000 teams is swept whole (the paged detach)', async () => {
    const leagueId = await seedBigSimLeague('paged')
    expect(await teamsIn(leagueId)).toBe(TEAMS)
    await cleanupSweep(service, (l) => logs.push(l))
    const { count, error } = await service.from('leagues').select('id', { count: 'exact', head: true }).eq('id', leagueId)
    expect(error).toBeNull()
    expect(count).toBe(0)
    const { count: left } = await service.from('teams').select('id', { count: 'exact', head: true }).like('name', 'vitest sim-world team %')
    expect(left).toBe(0)
  })

  it('R1270: a sim-world restore that throws does not stop the sweep, which then fails by name', async () => {
    const leagueId = await seedBigSimLeague('r1270')
    // A plant marker the restore cannot parse.
    const { error } = await service
      .from('players')
      .update({ status: 'Out', injury_notes: `${SIM_WORLD_PLANT_PREFIX}{broken` })
      .eq('id', `${PREFIX}healthy`)
    expect(error).toBeNull()
    await expect(cleanupSweep(service, (l) => logs.push(l))).rejects.toThrow(/cleanup: sim-world restore failed/)
    // …and the rest of the sweep still ran: the league and its teams are gone.
    const { count } = await service.from('leagues').select('id', { count: 'exact', head: true }).eq('id', leagueId)
    expect(count).toBe(0)
    expect(logs.some((l) => l.includes('the sim-world restore FAILED (the rest of the sweep still runs)'))).toBe(true)
    // Repair the fixture; the next sweep is clean.
    await service.from('players').update({ status: null, injury_notes: null }).eq('id', `${PREFIX}healthy`)
    await cleanupSweep(service, (l) => logs.push(l))
    expect((await simCensus(service)).filter((c) => c.count !== 0)).toEqual([])
  })
})
