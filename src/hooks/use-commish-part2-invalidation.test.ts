/**
 * use-commish-part2-invalidation.test.ts — the three L.E1.11 mutation hooks'
 * contract (D351 item 5; R822(i)) plus the log hook's query string, driven
 * through a REAL `QueryClient` with `MutationObserver` over each hook's own
 * options object (the `use-commish-overrides-invalidation.test.ts` posture:
 * no DOM, no React, no stack).
 *
 * Three things per hook, each a cell that reds if the option is removed:
 *
 *   1. **NOT optimistic** — before the answer arrives and after a refusal,
 *      the cached documents are BYTE-UNCHANGED.
 *   2. **NOT retried** — a failing submit hits the wire EXACTLY ONCE. The
 *      client's MUTATION default is ADVERSARIAL (`retry: 3, retryDelay: 0`,
 *      D362(7)): React Query's own default is already `retry: 0`, so against
 *      a plain client the delete-`retry: false` probe stays green and the pin
 *      is vacuous; here the hook's `retry: false` is the only thing between
 *      a failure and three silent replays of a spent action_id.
 *   3. **Invalidation on BOTH answers** with exact keys and negative
 *      controls (another week, another league, an untouched surface) so a
 *      blanket `invalidateQueries()` cannot pass. All three re-read the
 *      activity feed AND the audit log (`commishLogKeys.all`); the setting
 *      hook re-reads standings ONLY when `rescore` was asked for; the
 *      schedule hook keeps `week` OFF the wire (the route schema is strict).
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { commishLogKeys, commishLogSearchParams } from './use-commish-log'
import { commishEditScheduleMutationOptions } from './use-commish-schedule'
import { commishChangeSettingMutationOptions } from './use-commish-setting'
import { commishRenameTeamMutationOptions } from './use-commish-team'
import { leagueActivityKeys } from './use-league-activity'
import { leaguePoolKeys } from './use-league-pool'
import { leaguesKeys } from './use-leagues'
import { teamLineupKeys } from './use-lineup'
import { leagueMatchupKeys } from './use-matchups'
import { leagueRosterKeys } from './use-rosters'
import { scheduleKeys } from './use-schedule'
import { leagueStandingsKeys } from './use-standings'

const LEAGUE = '3f2b1c4d-0000-4000-8000-000000000311'
const OTHER_LEAGUE = '3f2b1c4d-0000-4000-8000-000000000312'
const TEAM_A = '3f2b1c4d-0000-4000-8000-000000000411'
const TEAM_B = '3f2b1c4d-0000-4000-8000-000000000412'
const MATCHUP = '3f2b1c4d-0000-4000-8000-000000000511'
const ACTION = '3f2b1c4d-0000-4000-8000-000000000611'
const WEEK = 3

const SEEDED = {
  detail: { id: LEAGUE, settings: { waiver_period_hours: 48 }, teams: [{ id: TEAM_A, name: 'Old Name' }] },
  matchups: { league_id: LEAGUE, week: WEEK, matchups: [{ id: MATCHUP }] },
  schedule: { league_id: LEAGUE, weeks: [] },
  standings: { league_id: LEAGUE, rows: [] },
  rosters: { league_id: LEAGUE, teams: [] },
  pool: { league_id: LEAGUE, players: [] },
  lineupA: { team_id: TEAM_A, slot_map: {} },
  activity: { league_id: LEAGUE, items: [] },
  log: { league_id: LEAGUE, items: [] },
}

/** A client whose MUTATION default is adversarial (`retry: 3`). */
function seededClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } },
  })
  client.setQueryData(leaguesKeys.detail(LEAGUE), SEEDED.detail)
  client.setQueryData(leagueMatchupKeys.week(LEAGUE, WEEK), SEEDED.matchups)
  client.setQueryData(scheduleKeys.all(LEAGUE), SEEDED.schedule)
  client.setQueryData(leagueStandingsKeys.all(LEAGUE), SEEDED.standings)
  client.setQueryData(leagueRosterKeys.all(LEAGUE), SEEDED.rosters)
  client.setQueryData(leaguePoolKeys.all(LEAGUE), SEEDED.pool)
  client.setQueryData(teamLineupKeys.all(TEAM_A), SEEDED.lineupA)
  client.setQueryData(leagueActivityKeys.all(LEAGUE), SEEDED.activity)
  client.setQueryData(commishLogKeys.all(LEAGUE), SEEDED.log)
  // Negative controls.
  client.setQueryData(leaguesKeys.detail(OTHER_LEAGUE), null)
  client.setQueryData(leagueMatchupKeys.week(LEAGUE, WEEK + 1), null)
  client.setQueryData(leagueMatchupKeys.week(OTHER_LEAGUE, WEEK), null)
  client.setQueryData(scheduleKeys.all(OTHER_LEAGUE), null)
  client.setQueryData(leagueStandingsKeys.all(OTHER_LEAGUE), null)
  client.setQueryData(leagueRosterKeys.all(OTHER_LEAGUE), null)
  client.setQueryData(commishLogKeys.all(OTHER_LEAGUE), null)
  client.setQueryData(leagueActivityKeys.all(OTHER_LEAGUE), null)
  return client
}

const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated

function stubFetch(response: { ok: boolean; status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve({ ok: response.ok, status: response.status, json: () => Promise.resolve(response.body) } as unknown as Response)
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The cached documents, byte-compared — the "not optimistic" pin. */
function expectCacheUntouched(client: QueryClient) {
  expect(client.getQueryData(leaguesKeys.detail(LEAGUE))).toStrictEqual(SEEDED.detail)
  expect(client.getQueryData(leagueMatchupKeys.week(LEAGUE, WEEK))).toStrictEqual(SEEDED.matchups)
  expect(client.getQueryData(scheduleKeys.all(LEAGUE))).toStrictEqual(SEEDED.schedule)
  expect(client.getQueryData(leagueStandingsKeys.all(LEAGUE))).toStrictEqual(SEEDED.standings)
  expect(client.getQueryData(leagueRosterKeys.all(LEAGUE))).toStrictEqual(SEEDED.rosters)
  expect(client.getQueryData(commishLogKeys.all(LEAGUE))).toStrictEqual(SEEDED.log)
}

const expectKeys = (client: QueryClient, on: ReadonlyArray<readonly unknown[]>, off: ReadonlyArray<readonly unknown[]>) => {
  for (const key of on) expect(invalidated(client, key), `ON ${JSON.stringify(key)}`).toBe(true)
  for (const key of off) expect(invalidated(client, key), `OFF ${JSON.stringify(key)}`).toBe(false)
}

describe('useCommishRenameTeam — /commish/team', () => {
  const variables = { team_id: TEAM_A, name: 'New Name', action_id: ACTION }
  const ON = [leaguesKeys.detail(LEAGUE), leagueRosterKeys.all(LEAGUE), leagueStandingsKeys.all(LEAGUE), leagueMatchupKeys.week(LEAGUE, WEEK), leagueActivityKeys.all(LEAGUE), commishLogKeys.all(LEAGUE)]
  const OFF = [leaguesKeys.detail(OTHER_LEAGUE), leagueRosterKeys.all(OTHER_LEAGUE), leagueMatchupKeys.week(OTHER_LEAGUE, WEEK), commishLogKeys.all(OTHER_LEAGUE), leaguePoolKeys.all(LEAGUE), teamLineupKeys.all(TEAM_A)]

  it('a 200 sends the strict body and re-reads every surface that prints a team name (detail, rosters, standings, all weeks’ matchups) + activity + log — not the pool, not lineups, not another league', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { verb: 'commish_rename_team' } })
    await new MutationObserver(client, commishRenameTeamMutationOptions(client, LEAGUE)).mutate(variables)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/commish/team`)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual(variables)
    expectKeys(client, ON, OFF)
    expectCacheUntouched(client)
  })

  it('a 409 (the sealed-franchise refusal) is sent EXACTLY ONCE against the retry:3 client, mutates no cache, and invalidates the SAME keys', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: false, status: 409, body: { error: 'commish_rename_team: franchise … is RETIRED — its name is FROZEN' } })
    const failure = await new MutationObserver(client, commishRenameTeamMutationOptions(client, LEAGUE)).mutate(variables).catch((e: unknown) => e)
    expect((failure as { name: string }).name).toBe('LeagueActionError')
    expect((failure as { status: number }).status).toBe(409)
    expect(calls).toHaveLength(1)
    expectCacheUntouched(client)
    expectKeys(client, ON, OFF)
  })
})

describe('useCommishChangeSetting — /commish/setting', () => {
  const variables = { key: 'waiver_period_hours', value: 72, action_id: ACTION }
  const ON = [leaguesKeys.detail(LEAGUE), leagueActivityKeys.all(LEAGUE), commishLogKeys.all(LEAGUE)]
  const OFF = [leagueStandingsKeys.all(LEAGUE), leaguesKeys.detail(OTHER_LEAGUE), leagueRosterKeys.all(LEAGUE), leagueMatchupKeys.week(LEAGUE, WEEK), commishLogKeys.all(OTHER_LEAGUE)]

  it('a 200 WITHOUT rescore re-reads the league detail + activity + log — and NOT the standings (nothing scored moved)', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { verb: 'commish_change_setting', rescore_performed: false } })
    await new MutationObserver(client, commishChangeSettingMutationOptions(client, LEAGUE)).mutate(variables)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/commish/setting`)
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual(variables)
    expectKeys(client, ON, OFF)
    expectCacheUntouched(client)
  })

  it('a 200 WITH rescore ALSO re-reads the standings (129’s rescore arm rebuilds team_week_results) — the `rescore` flag rides on the wire', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { verb: 'commish_change_setting', rescore_performed: true } })
    const withRescore = { ...variables, key: 'scoring_system_id', value: 'ab000000-0000-4000-8000-000000000001', rescore: true }
    await new MutationObserver(client, commishChangeSettingMutationOptions(client, LEAGUE)).mutate(withRescore)
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual(withRescore)
    expectKeys(client, [...ON, leagueStandingsKeys.all(LEAGUE)], [leagueStandingsKeys.all(OTHER_LEAGUE), leagueRosterKeys.all(LEAGUE)])
  })

  it('a 409 (a REFUSED-in-season key, 129’s copy) is sent EXACTLY ONCE, mutates no cache, and invalidates the same keys', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: false, status: 409, body: { error: 'commish_change_setting: team_count is PRE-DRAFT ONLY (§7.3)' } })
    const failure = await new MutationObserver(client, commishChangeSettingMutationOptions(client, LEAGUE)).mutate({ ...variables, key: 'team_count', value: 12 }).catch((e: unknown) => e)
    expect((failure as { status: number }).status).toBe(409)
    expect((failure as Error).message).toBe('team_count is PRE-DRAFT ONLY')
    expect(calls).toHaveLength(1)
    expectCacheUntouched(client)
    expectKeys(client, ON, OFF)
  })
})

describe('useCommishEditSchedule — /commish/schedule', () => {
  const variables = { matchup_id: MATCHUP, home_team_id: TEAM_B, away_team_id: TEAM_A, action_id: ACTION, week: WEEK }
  const wire = { matchup_id: MATCHUP, home_team_id: TEAM_B, away_team_id: TEAM_A, action_id: ACTION }
  const ON = [leagueMatchupKeys.week(LEAGUE, WEEK), scheduleKeys.all(LEAGUE), leagueActivityKeys.all(LEAGUE), commishLogKeys.all(LEAGUE)]
  const OFF = [leagueMatchupKeys.week(LEAGUE, WEEK + 1), leagueMatchupKeys.week(OTHER_LEAGUE, WEEK), scheduleKeys.all(OTHER_LEAGUE), leagueStandingsKeys.all(LEAGUE), leaguesKeys.detail(LEAGUE), commishLogKeys.all(OTHER_LEAGUE)]

  it('a 200 re-reads the WEEK’s matchups, the schedule, activity and log — not another week, not the standings; `week` never reaches the wire', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { verb: 'commish_edit_schedule' } })
    await new MutationObserver(client, commishEditScheduleMutationOptions(client, LEAGUE)).mutate(variables)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/commish/schedule`)
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual(wire)
    expectKeys(client, ON, OFF)
    expectCacheUntouched(client)
  })

  it('a 409 (a bye row) is sent EXACTLY ONCE, mutates no cache, and invalidates the same keys', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: false, status: 409, body: { error: 'commish_edit_schedule: matchup … is a bye row — v1 schedules have none to edit' } })
    const failure = await new MutationObserver(client, commishEditScheduleMutationOptions(client, LEAGUE)).mutate(variables).catch((e: unknown) => e)
    expect((failure as { status: number }).status).toBe(409)
    expect(calls).toHaveLength(1)
    expectCacheUntouched(client)
    expectKeys(client, ON, OFF)
  })
})

describe('useCommishLog — the read hook’s query string', () => {
  it('sends only the params that are SET; the cursor travels as ONE token', () => {
    expect(commishLogSearchParams({})).toBe('')
    expect(commishLogSearchParams({ limit: 20 })).toBe('?limit=20')
    expect(commishLogSearchParams({ cursor: 'abc_-' })).toBe('?cursor=abc_-')
    expect(commishLogSearchParams({ limit: 5, cursor: 'tok' })).toBe('?limit=5&cursor=tok')
  })

  it('its page key is a child of `all`, so one invalidation reaches every page', () => {
    expect(commishLogKeys.page(LEAGUE, 'tok', 5).slice(0, 2)).toStrictEqual([...commishLogKeys.all(LEAGUE)])
  })
})
