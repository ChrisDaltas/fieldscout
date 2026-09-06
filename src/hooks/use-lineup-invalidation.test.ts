/**
 * use-lineup-invalidation.test.ts — the set's invalidation contract, driven
 * through a REAL `QueryClient` with `MutationObserver` over the hook's own
 * options object (the `use-league-scoring-invalidation.test.ts` posture: no
 * DOM, no React, no stack). L.D5.1 fix round, **R822(i)**; PROGRESS D316(10).
 *
 * The cell that matters: **a REFUSED set re-reads the roster and the row.**
 * The scoring family pins the opposite (a refused save invalidates nothing,
 * because nothing changed on the server); a refused SET is the other case —
 * the refusal is about state this client evaluated from a view the tick had
 * not yet refreshed (or a lagging tick left stale), so the 🔒 the server just
 * enforced must reach the screen without a reload. Before this round the
 * hook invalidated on success only, and the browser pass measured the
 * consequence: after the 409 the kicked-off player's row still rendered
 * placeable until a reload. The probe for the round (remove `onError`) reds
 * the refusal cell here.
 *
 * Assertions are on the KEYS' cache state with negative controls (another
 * team's week, another league's rosters), so a blanket
 * `invalidateQueries()` cannot pass either.
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SetLineupResult } from '@/lib/leagues/api/lineup-service'

import { setLineupMutationOptions, teamLineupKeys, type SetLineupVariables } from './use-lineup'
import { leagueRosterKeys } from './use-rosters'

const LEAGUE = '3f2b1c4d-0000-4000-8000-000000000101'
const OTHER_LEAGUE = '3f2b1c4d-0000-4000-8000-000000000102'
const TEAM = '3f2b1c4d-0000-4000-8000-000000000201'
const OTHER_TEAM = '3f2b1c4d-0000-4000-8000-000000000202'
const WEEK = 3

/** The 409 the browser pass rendered, verbatim (F224(e)); the RPC's own
 *  sentence with the player and his kickoff named. */
const LOCK_REFUSAL =
  "Dev RB Locked's game kicked off at 2001-09-09T17:00:00+00:00 (nfl_games) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted \"rb:1\""

const RESULT: SetLineupResult = {
  action_id: 'a-1',
  team_id: TEAM,
  week: WEEK,
  slot_map: { 'qb:0': 'qb1' },
  starters: [],
  bench: [],
  locked_at: null,
  no_changes: false,
  rearranged: false,
  moved: [],
  flags: { illegal: false },
  ir_moves: { placed: [], removed: [] },
} as unknown as SetLineupResult

const variables: SetLineupVariables = { week: WEEK, slot_map: { 'qb:0': 'qb1', 'rb:1': 'rb-locked' }, action_id: 'a-1' }

function seededClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(teamLineupKeys.week(TEAM, WEEK), null)
  client.setQueryData(leagueRosterKeys.all(LEAGUE), { league_id: LEAGUE, teams: [] })
  // Negative controls — another week of the same team, another team, another
  // league's rosters. None of them is what a set touched or evaluated.
  client.setQueryData(teamLineupKeys.week(TEAM, WEEK + 1), null)
  client.setQueryData(teamLineupKeys.week(OTHER_TEAM, WEEK), null)
  client.setQueryData(leagueRosterKeys.all(OTHER_LEAGUE), { league_id: OTHER_LEAGUE, teams: [] })
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

describe('a set re-reads the week’s row and the league’s rosters — on BOTH answers (R822(i))', () => {
  it('a 200 invalidates the two keys and nothing beside them; the wire is the PATCH with the variables whole', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: RESULT })
    expect(invalidated(client, teamLineupKeys.week(TEAM, WEEK))).toBe(false)
    expect(invalidated(client, leagueRosterKeys.all(LEAGUE))).toBe(false)

    const observer = new MutationObserver(client, setLineupMutationOptions(client, LEAGUE, TEAM))
    const result = await observer.mutate(variables)
    expect(result).toEqual(RESULT)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/teams/${TEAM}/lineup`)
    expect(calls[0].init.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(variables)

    expect(invalidated(client, teamLineupKeys.week(TEAM, WEEK))).toBe(true)
    expect(invalidated(client, leagueRosterKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, teamLineupKeys.week(TEAM, WEEK + 1))).toBe(false)
    expect(invalidated(client, teamLineupKeys.week(OTHER_TEAM, WEEK))).toBe(false)
    expect(invalidated(client, leagueRosterKeys.all(OTHER_LEAGUE))).toBe(false)
  })

  it('a 409 lock refusal reaches the caller VERBATIM and invalidates the SAME two keys — the stale view is re-read, never trusted', async () => {
    const client = seededClient()
    stubFetch({ ok: false, status: 409, body: { error: LOCK_REFUSAL } })

    const observer = new MutationObserver(client, setLineupMutationOptions(client, LEAGUE, TEAM))
    const failure = await observer.mutate(variables).catch((error: unknown) => error)

    expect((failure as { name: string }).name).toBe('LeagueActionError')
    expect((failure as { status: number }).status).toBe(409)
    expect((failure as Error).message).toBe(LOCK_REFUSAL)

    // THE R822(i) PIN. The page held a pool view that let a kicked-off player
    // be seated; the server refused from `nfl_games` at now(). Nothing was
    // written — but the VIEW was the wrong thing, so both entries go stale
    // and the 🔒 arrives without a reload.
    expect(invalidated(client, leagueRosterKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, teamLineupKeys.week(TEAM, WEEK))).toBe(true)
    // …and still nothing beside them.
    expect(invalidated(client, teamLineupKeys.week(TEAM, WEEK + 1))).toBe(false)
    expect(invalidated(client, teamLineupKeys.week(OTHER_TEAM, WEEK))).toBe(false)
    expect(invalidated(client, leagueRosterKeys.all(OTHER_LEAGUE))).toBe(false)
  })

  it('a 400 (the commissioner arm without a reason) re-reads too — the determinant is the answer having arrived, not its verb', async () => {
    const client = seededClient()
    const message = 'set_lineup: a commissioner setting another team’s lineup must give a reason (D290)'
    stubFetch({ ok: false, status: 400, body: { error: message } })

    const observer = new MutationObserver(client, setLineupMutationOptions(client, LEAGUE, TEAM))
    const failure = await observer.mutate(variables).catch((error: unknown) => error)
    expect((failure as { status: number }).status).toBe(400)
    expect(invalidated(client, leagueRosterKeys.all(LEAGUE))).toBe(true)
    expect(invalidated(client, teamLineupKeys.week(TEAM, WEEK))).toBe(true)
  })
})
