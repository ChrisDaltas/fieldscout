/**
 * use-commish-bracket-invalidation.test.ts — the L.E1.16 mutation hook's
 * contract (D351 item 5; R822(i)), driven through a REAL `QueryClient` with
 * `MutationObserver` over the hook's own options object (the
 * `use-commish-part2-invalidation.test.ts` posture: no DOM, no React, no
 * stack). Three cells that red if the option is removed: NOT optimistic,
 * NOT retried against an ADVERSARIAL `retry: 3` client (D362(7)), and
 * invalidation on BOTH answers with exact keys and negative controls — the
 * bracket document, EVERY week of the round, activity and the log; never
 * the standings, never another league. `weeks` never reaches the wire; a
 * BYE travels as `away_team_id: null`, present.
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { commishEditBracketMutationOptions } from './use-commish-bracket'
import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leaguesKeys } from './use-leagues'
import { leagueMatchupKeys } from './use-matchups'
import { playoffBracketKeys } from './use-playoff-bracket'
import { leagueStandingsKeys } from './use-standings'

const LEAGUE = '3f2b1c4d-0000-4000-8000-000000000321'
const OTHER_LEAGUE = '3f2b1c4d-0000-4000-8000-000000000322'
const TEAM_E = '3f2b1c4d-0000-4000-8000-000000000425'
const TEAM_F = '3f2b1c4d-0000-4000-8000-000000000426'
const MATCHUP = '3f2b1c4d-0000-4000-8000-000000000571'
const ACTION = '3f2b1c4d-0000-4000-8000-000000000671'
const WEEKS = [7, 8] as const

const SEEDED = {
  detail: { id: LEAGUE, teams: [{ id: TEAM_E, name: 'E' }] },
  bracket: { league_id: LEAGUE, kind: 'bracket', round_list: [] },
  w7: { league_id: LEAGUE, week: 7, matchups: [{ id: MATCHUP }] },
  w8: { league_id: LEAGUE, week: 8, matchups: [] },
  standings: { league_id: LEAGUE, rows: [] },
  activity: { league_id: LEAGUE, items: [] },
  log: { league_id: LEAGUE, items: [] },
}

function seededClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } },
  })
  client.setQueryData(leaguesKeys.detail(LEAGUE), SEEDED.detail)
  client.setQueryData(playoffBracketKeys.all(LEAGUE), SEEDED.bracket)
  client.setQueryData(leagueMatchupKeys.week(LEAGUE, 7), SEEDED.w7)
  client.setQueryData(leagueMatchupKeys.week(LEAGUE, 8), SEEDED.w8)
  client.setQueryData(leagueStandingsKeys.all(LEAGUE), SEEDED.standings)
  client.setQueryData(leagueActivityKeys.all(LEAGUE), SEEDED.activity)
  client.setQueryData(commishLogKeys.all(LEAGUE), SEEDED.log)
  // Negative controls.
  client.setQueryData(leaguesKeys.detail(OTHER_LEAGUE), null)
  client.setQueryData(playoffBracketKeys.all(OTHER_LEAGUE), null)
  client.setQueryData(leagueMatchupKeys.week(LEAGUE, 6), null)
  client.setQueryData(leagueMatchupKeys.week(OTHER_LEAGUE, 7), null)
  client.setQueryData(leagueStandingsKeys.all(OTHER_LEAGUE), null)
  client.setQueryData(commishLogKeys.all(OTHER_LEAGUE), null)
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

function expectCacheUntouched(client: QueryClient) {
  expect(client.getQueryData(leaguesKeys.detail(LEAGUE))).toStrictEqual(SEEDED.detail)
  expect(client.getQueryData(playoffBracketKeys.all(LEAGUE))).toStrictEqual(SEEDED.bracket)
  expect(client.getQueryData(leagueMatchupKeys.week(LEAGUE, 7))).toStrictEqual(SEEDED.w7)
  expect(client.getQueryData(leagueStandingsKeys.all(LEAGUE))).toStrictEqual(SEEDED.standings)
  expect(client.getQueryData(commishLogKeys.all(LEAGUE))).toStrictEqual(SEEDED.log)
}

const expectKeys = (client: QueryClient, on: ReadonlyArray<readonly unknown[]>, off: ReadonlyArray<readonly unknown[]>) => {
  for (const key of on) expect(invalidated(client, key), `ON ${JSON.stringify(key)}`).toBe(true)
  for (const key of off) expect(invalidated(client, key), `OFF ${JSON.stringify(key)}`).toBe(false)
}

describe('useCommishEditBracket — /commish/bracket', () => {
  const variables = { matchup_id: MATCHUP, home_team_id: TEAM_E, away_team_id: TEAM_F, action_id: ACTION, weeks: WEEKS }
  const wire = { matchup_id: MATCHUP, home_team_id: TEAM_E, away_team_id: TEAM_F, action_id: ACTION }
  const ON = [playoffBracketKeys.all(LEAGUE), leagueMatchupKeys.week(LEAGUE, 7), leagueMatchupKeys.week(LEAGUE, 8), leagueActivityKeys.all(LEAGUE), commishLogKeys.all(LEAGUE)]
  const OFF = [leagueMatchupKeys.week(LEAGUE, 6), leagueMatchupKeys.week(OTHER_LEAGUE, 7), playoffBracketKeys.all(OTHER_LEAGUE), leagueStandingsKeys.all(LEAGUE), leaguesKeys.detail(LEAGUE), commishLogKeys.all(OTHER_LEAGUE)]

  it('a 200 re-reads the bracket, EVERY week of the round, activity and log — not another week, not the standings; `weeks` never reaches the wire', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { verb: 'commish_edit_bracket' } })
    await new MutationObserver(client, commishEditBracketMutationOptions(client, LEAGUE)).mutate(variables)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/commish/bracket`)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual(wire)
    expectKeys(client, ON, OFF)
    expectCacheUntouched(client)
  })

  it('a BYE travels as `away_team_id: null` — present on the wire, never omitted', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { verb: 'commish_edit_bracket' } })
    await new MutationObserver(client, commishEditBracketMutationOptions(client, LEAGUE)).mutate({ ...variables, away_team_id: null })
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual({ ...wire, away_team_id: null })
  })

  it('a 409 (a team from outside the round) is sent EXACTLY ONCE against the retry:3 client, mutates no cache, and invalidates the same keys', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: false, status: 409, body: { error: 'commish_edit_bracket: team … is not in round 1 of league … — the round’s entrants are the 6 teams seeded on its rows' } })
    const failure = await new MutationObserver(client, commishEditBracketMutationOptions(client, LEAGUE)).mutate(variables).catch((e: unknown) => e)
    expect((failure as { name: string }).name).toBe('LeagueActionError')
    expect((failure as { status: number }).status).toBe(409)
    expect(calls).toHaveLength(1)
    expectCacheUntouched(client)
    expectKeys(client, ON, OFF)
  })
})
