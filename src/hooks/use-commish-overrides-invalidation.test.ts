/**
 * use-commish-overrides-invalidation.test.ts — the four L.E1.10 hooks'
 * contract (D351 item 5; R822(i)), driven through a REAL `QueryClient` with
 * `MutationObserver` over each hook's own options object (the
 * `use-lineup-invalidation.test.ts` posture: no DOM, no React, no stack).
 *
 * Three things per hook, each a cell that reds if the option is removed:
 *
 *   1. **NOT optimistic** — before the answer arrives and after a refusal,
 *      the cached documents are BYTE-UNCHANGED; the hook paints nothing ahead
 *      of the server (the server returns the canonical document, §4 rule 15).
 *   2. **NOT retried** — a failing submit hits the wire EXACTLY ONCE (an
 *      `action_id` is consumed by its submit; a retry would be a silent
 *      replay). React Query's MUTATION default is already `retry: 0`, so a
 *      plain client cannot tell an explicit `retry: false` from an omitted
 *      one (measured 2026-09-16: the probe that deletes the line stayed
 *      green against a default client). The client here therefore sets an
 *      ADVERSARIAL mutation default — `retry: 3, retryDelay: 0` — so the
 *      hook's own `retry: false` is the only thing standing between a
 *      failure and three silent replays; delete it and the call count reds.
 *   3. **Invalidation on BOTH answers** — the affected week / roster /
 *      standings keys flip `isInvalidated` on a 200 AND on a 4xx, with
 *      negative controls (another week, another team, another league) so a
 *      blanket `invalidateQueries()` cannot pass either.
 *
 * Plus the wire: the matchup hooks keep `week` OFF the body (the route's
 * schema is strict), and no hook sends `reason` when it was not given.
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { leagueActivityKeys } from './use-league-activity'
import { leaguePoolKeys } from './use-league-pool'
import { teamLineupKeys } from './use-lineup'
import { leagueMatchupKeys } from './use-matchups'
import { leagueRosterKeys } from './use-rosters'
import { leagueStandingsKeys } from './use-standings'
import { commishMovePlayerMutationOptions } from './use-commish-move-player'
import { commishSetResultMutationOptions } from './use-commish-result'
import { commishForceAddDropMutationOptions } from './use-commish-roster'
import { commishEditScoreMutationOptions } from './use-commish-score'

const LEAGUE = '3f2b1c4d-0000-4000-8000-000000000301'
const OTHER_LEAGUE = '3f2b1c4d-0000-4000-8000-000000000302'
const TEAM_A = '3f2b1c4d-0000-4000-8000-000000000401'
const TEAM_B = '3f2b1c4d-0000-4000-8000-000000000402'
const OTHER_TEAM = '3f2b1c4d-0000-4000-8000-000000000403'
const MATCHUP = '3f2b1c4d-0000-4000-8000-000000000501'
const ACTION = '3f2b1c4d-0000-4000-8000-000000000601'
const WEEK = 3

/** 126's own 22023 text — the transitional no-reason refusal (F362). */
const REASON_GATE =
  'commish_edit_score: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)'

const SEEDED = {
  matchups: { league_id: LEAGUE, week: WEEK, matchups: [{ id: MATCHUP, home_score: 90 }] },
  standings: { league_id: LEAGUE, rows: [] },
  rosters: { league_id: LEAGUE, teams: [] },
  pool: { league_id: LEAGUE, players: [] },
  lineupA: { team_id: TEAM_A, slot_map: {} },
  lineupB: { team_id: TEAM_B, slot_map: {} },
  activity: { league_id: LEAGUE, items: [] },
}

/** A client whose MUTATION default is adversarial (`retry: 3`) — so a hook's
 *  own `retry: false` is the only thing standing between a failure and three
 *  silent replays of a spent action_id. */
function seededClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } },
  })
  client.setQueryData(leagueMatchupKeys.week(LEAGUE, WEEK), SEEDED.matchups)
  client.setQueryData(leagueStandingsKeys.all(LEAGUE), SEEDED.standings)
  client.setQueryData(leagueRosterKeys.all(LEAGUE), SEEDED.rosters)
  client.setQueryData(leaguePoolKeys.all(LEAGUE), SEEDED.pool)
  client.setQueryData(teamLineupKeys.all(TEAM_A), SEEDED.lineupA)
  client.setQueryData(teamLineupKeys.all(TEAM_B), SEEDED.lineupB)
  client.setQueryData(leagueActivityKeys.all(LEAGUE), SEEDED.activity)
  // Negative controls.
  client.setQueryData(leagueMatchupKeys.week(LEAGUE, WEEK + 1), null)
  client.setQueryData(leagueMatchupKeys.week(OTHER_LEAGUE, WEEK), null)
  client.setQueryData(leagueStandingsKeys.all(OTHER_LEAGUE), null)
  client.setQueryData(leagueRosterKeys.all(OTHER_LEAGUE), null)
  client.setQueryData(teamLineupKeys.all(OTHER_TEAM), null)
  return client
}

const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated

function stubFetch(response: { ok: boolean; status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    } as unknown as Response)
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The cached documents, byte-compared — the "not optimistic" pin. */
function expectCacheUntouched(client: QueryClient) {
  expect(client.getQueryData(leagueMatchupKeys.week(LEAGUE, WEEK))).toStrictEqual(SEEDED.matchups)
  expect(client.getQueryData(leagueStandingsKeys.all(LEAGUE))).toStrictEqual(SEEDED.standings)
  expect(client.getQueryData(leagueRosterKeys.all(LEAGUE))).toStrictEqual(SEEDED.rosters)
  expect(client.getQueryData(leaguePoolKeys.all(LEAGUE))).toStrictEqual(SEEDED.pool)
  expect(client.getQueryData(teamLineupKeys.all(TEAM_A))).toStrictEqual(SEEDED.lineupA)
  expect(client.getQueryData(teamLineupKeys.all(TEAM_B))).toStrictEqual(SEEDED.lineupB)
}

describe('useCommishEditScore — /commish/score', () => {
  const variables = { matchup_id: MATCHUP, home_score: 98.4, away_score: 101.25, action_id: ACTION, week: WEEK }
  const RESULT = { matchup_id: MATCHUP, action_id: ACTION, verb: 'commish_edit_score', week: WEEK, no_changes: false }

  it('a 200 re-reads the WEEK’s matchups, the standings and the activity feed — nothing beside them; `week` never reaches the wire', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: RESULT })
    const result = await new MutationObserver(client, commishEditScoreMutationOptions(client, LEAGUE)).mutate(variables)
    expect(result).toEqual(RESULT)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/commish/score`)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual({ matchup_id: MATCHUP, home_score: 98.4, away_score: 101.25, action_id: ACTION })

    expect(invalidated(client, leagueMatchupKeys.week(LEAGUE, WEEK))).toBe(true)
    expect(invalidated(client, leagueStandingsKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, leagueActivityKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, leagueMatchupKeys.week(LEAGUE, WEEK + 1))).toBe(false)
    expect(invalidated(client, leagueMatchupKeys.week(OTHER_LEAGUE, WEEK))).toBe(false)
    expect(invalidated(client, leagueStandingsKeys.all(OTHER_LEAGUE))).toBe(false)
    expect(invalidated(client, leagueRosterKeys.all(LEAGUE))).toBe(false)
    // Not optimistic: the answer is a signal to RE-READ, never a document
    // written into the cache by this hook.
    expectCacheUntouched(client)
  })

  it('a 400 (the transitional no-reason gate) reaches the caller VERBATIM, is sent EXACTLY ONCE, mutates no cache, and invalidates the SAME keys', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: false, status: 400, body: { error: REASON_GATE } })
    const failure = await new MutationObserver(client, commishEditScoreMutationOptions(client, LEAGUE))
      .mutate(variables)
      .catch((error: unknown) => error)

    expect((failure as { name: string }).name).toBe('LeagueActionError')
    expect((failure as { status: number }).status).toBe(400)
    expect((failure as Error).message).toBe('a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)')
    // NOT retried — one action_id, one wire call.
    expect(calls).toHaveLength(1)
    expectCacheUntouched(client)
    // R822(i): the refusal re-reads too.
    expect(invalidated(client, leagueMatchupKeys.week(LEAGUE, WEEK))).toBe(true)
    expect(invalidated(client, leagueStandingsKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, leagueActivityKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, leagueMatchupKeys.week(LEAGUE, WEEK + 1))).toBe(false)
  })
})

describe('useCommishSetResult — /commish/result', () => {
  const variables = { matchup_id: MATCHUP, winner_team_id: TEAM_B, action_id: ACTION, reason: 'bye-week starter', week: WEEK }

  it('a 200 sends the strict body (with the reason when given, `week` stripped) and re-reads the week / standings / activity', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { matchup_id: MATCHUP } })
    await new MutationObserver(client, commishSetResultMutationOptions(client, LEAGUE)).mutate(variables)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/commish/result`)
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual({ matchup_id: MATCHUP, winner_team_id: TEAM_B, action_id: ACTION, reason: 'bye-week starter' })
    expect(invalidated(client, leagueMatchupKeys.week(LEAGUE, WEEK))).toBe(true)
    expect(invalidated(client, leagueStandingsKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, leagueActivityKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, leagueMatchupKeys.week(OTHER_LEAGUE, WEEK))).toBe(false)
    expectCacheUntouched(client)
  })

  it('a 409 (F351’s tie refusal) is sent once, mutates no cache, and still invalidates the same keys', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: false, status: 409, body: { error: 'commish_set_result: team … is not a side of matchup …' } })
    const failure = await new MutationObserver(client, commishSetResultMutationOptions(client, LEAGUE)).mutate(variables).catch((e: unknown) => e)
    expect((failure as { status: number }).status).toBe(409)
    expect(calls).toHaveLength(1)
    expectCacheUntouched(client)
    expect(invalidated(client, leagueMatchupKeys.week(LEAGUE, WEEK))).toBe(true)
    expect(invalidated(client, leagueStandingsKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, leagueStandingsKeys.all(OTHER_LEAGUE))).toBe(false)
  })
})

describe('useCommishMovePlayer — /commish/move-player', () => {
  const variables = { player_id: 'cr-qb1', from_team_id: TEAM_A, to_team_id: TEAM_B, action_id: ACTION }

  it('a 200 re-reads rosters, pool, BOTH teams’ lineups and the activity feed — not another team’s, not another league’s', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { verb: 'commish_move_player' } })
    await new MutationObserver(client, commishMovePlayerMutationOptions(client, LEAGUE)).mutate(variables)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/commish/move-player`)
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual(variables)
    for (const key of [leagueRosterKeys.all(LEAGUE), leaguePoolKeys.all(LEAGUE), teamLineupKeys.all(TEAM_A), teamLineupKeys.all(TEAM_B), leagueActivityKeys.all(LEAGUE)]) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(true)
    }
    expect(invalidated(client, teamLineupKeys.all(OTHER_TEAM))).toBe(false)
    expect(invalidated(client, leagueRosterKeys.all(OTHER_LEAGUE))).toBe(false)
    expect(invalidated(client, leagueMatchupKeys.week(LEAGUE, WEEK))).toBe(false)
    expectCacheUntouched(client)
  })

  it('a 400 (the transitional no-reason gate) is sent once, mutates no cache, and invalidates the same five keys', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: false, status: 400, body: { error: REASON_GATE.replace('commish_edit_score', 'commish_move_player') } })
    const failure = await new MutationObserver(client, commishMovePlayerMutationOptions(client, LEAGUE)).mutate(variables).catch((e: unknown) => e)
    expect((failure as { status: number }).status).toBe(400)
    expect(calls).toHaveLength(1)
    expectCacheUntouched(client)
    for (const key of [leagueRosterKeys.all(LEAGUE), leaguePoolKeys.all(LEAGUE), teamLineupKeys.all(TEAM_A), teamLineupKeys.all(TEAM_B), leagueActivityKeys.all(LEAGUE)]) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(true)
    }
    expect(invalidated(client, teamLineupKeys.all(OTHER_TEAM))).toBe(false)
  })
})

describe('useCommishForceAddDrop — /commish/roster', () => {
  const variables = { team_id: TEAM_A, add_player_id: 'cr-fa1', action_id: ACTION }

  it('a 200 re-reads rosters, pool, THE team’s lineups and the activity feed — the other team is untouched', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { verb: 'commish_force_add_drop' } })
    await new MutationObserver(client, commishForceAddDropMutationOptions(client, LEAGUE)).mutate(variables)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/commish/roster`)
    expect(JSON.parse(String(calls[0].init.body))).toStrictEqual(variables)
    for (const key of [leagueRosterKeys.all(LEAGUE), leaguePoolKeys.all(LEAGUE), teamLineupKeys.all(TEAM_A), leagueActivityKeys.all(LEAGUE)]) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(true)
    }
    expect(invalidated(client, teamLineupKeys.all(TEAM_B))).toBe(false)
    expect(invalidated(client, leagueRosterKeys.all(OTHER_LEAGUE))).toBe(false)
    expectCacheUntouched(client)
  })

  it('a 409 (roster full) is sent once, mutates no cache, and invalidates the same four keys', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: false, status: 409, body: { error: 'commish_force_add_drop: roster is full (16 of 16)' } })
    const failure = await new MutationObserver(client, commishForceAddDropMutationOptions(client, LEAGUE)).mutate(variables).catch((e: unknown) => e)
    expect((failure as { status: number }).status).toBe(409)
    expect(calls).toHaveLength(1)
    expectCacheUntouched(client)
    for (const key of [leagueRosterKeys.all(LEAGUE), leaguePoolKeys.all(LEAGUE), teamLineupKeys.all(TEAM_A), leagueActivityKeys.all(LEAGUE)]) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(true)
    }
    expect(invalidated(client, teamLineupKeys.all(TEAM_B))).toBe(false)
  })
})
