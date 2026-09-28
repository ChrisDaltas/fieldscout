/**
 * use-waiver-hooks.test.ts — the L.D2.12 mutation hooks' contract, driven
 * through a REAL `QueryClient` + `MutationObserver` over each hook's options
 * (the `use-commish-part2-invalidation.test.ts` posture: no DOM, no stack).
 *
 *   1. NOT retried — the client's mutation default is adversarial
 *      (`retry: 3`), so a failing submit hitting the wire once proves the
 *      hook's own `retry: false`.
 *   2. Submit / cancel / FAAB are NOT optimistic — cached documents are
 *      untouched until the answer, and after a refusal.
 *   3. Reorder IS optimistic (tasks-M5 §5) — the move lands before the
 *      answer and is ROLLED BACK on a refusal.
 *   4. Invalidation targets, with negative controls.
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'

import { cancelClaimMutationOptions } from './use-cancel-claim'
import { commishEditFaabMutationOptions } from './use-commish-faab'
import { editClaimMutationOptions } from './use-edit-claim'
import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leaguesKeys } from './use-leagues'
import { applyClaimMove, reorderClaimMutationOptions } from './use-reorder-claims'
import { leagueRosterKeys } from './use-rosters'
import { leagueStandingsKeys } from './use-standings'
import { submitClaimMutationOptions, submitClaimVariables } from './use-submit-claim'
import { waiverClaimKeys, waiverClaimsUrl } from './use-waiver-claims'

const LEAGUE = 'wh000000-league'
const OTHER = 'wh000000-other'

function claim(id: string, claim_order: number, status: 'pending' | 'won' = 'pending') {
  return { id, team_id: 't1', add: { player_id: id, full_name: null, position: null, nfl_team: null }, drop: null, faab_bid: 1, claim_order, status, result_reason: null, process_at: null, processed_at: null, created_at: '', created_by: 'u', cancelled_at: null }
}
const DOC: WaiverClaimsDocument = {
  league_id: LEAGUE,
  team_id: 't1',
  status: 'all',
  waiver_type: 'faab',
  faab_budget: 100,
  faab_min_bid: 0,
  faab_balance: 40,
  waiver_priority: null,
  claims: [claim('a', 1), claim('b', 2), claim('c', 3), claim('w', 1, 'won')],
}

function seeded() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } } })
  client.setQueryData(waiverClaimKeys.team(LEAGUE, null, 'all'), DOC)
  client.setQueryData(waiverClaimKeys.team(OTHER, null, 'all'), DOC)
  for (const key of [leagueRosterKeys.all(LEAGUE), leagueStandingsKeys.all(LEAGUE), leaguesKeys.detail(LEAGUE), leagueActivityKeys.all(LEAGUE), commishLogKeys.all(LEAGUE), leagueRosterKeys.all(OTHER)]) {
    client.setQueryData(key, { seeded: true })
  }
  return client
}

function stale(client: QueryClient, key: readonly unknown[]) {
  return client.getQueryState(key)?.isInvalidated === true
}

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('waiverClaimsUrl / submitClaimVariables', () => {
  it('pending is the default and stays off the wire; blanks are dropped', () => {
    expect(waiverClaimsUrl('L')).toBe('/api/leagues/L/waivers')
    expect(waiverClaimsUrl('L', { status: 'all', teamId: 't' })).toBe('/api/leagues/L/waivers?status=all&team_id=t')
    expect(submitClaimVariables({ teamId: 't', addPlayerId: 'p', dropPlayerId: null, reason: '  ' }, 'id')).toStrictEqual({
      team_id: 't',
      add_player_id: 'p',
      action_id: 'id',
    })
  })
})

describe('useSubmitClaim — not optimistic, not retried, re-reads claims (+ feeds on a commissioner claim)', () => {
  it('a refusal hits the wire ONCE, leaves the cache untouched, re-reads only the claims', async () => {
    const client = seeded()
    const fetchMock = respond(409, { error: 'waiver_claim_submit: a bid of $41 is more than the balance' })
    vi.stubGlobal('fetch', fetchMock)
    const observer = new MutationObserver(client, submitClaimMutationOptions(client, LEAGUE))
    await observer.mutate({ team_id: 't1', add_player_id: 'p', action_id: 'x' }).catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(waiverClaimKeys.team(LEAGUE, null, 'all'))).toBe(DOC)
    expect(stale(client, waiverClaimKeys.team(LEAGUE, null, 'all'))).toBe(true)
    expect(stale(client, waiverClaimKeys.team(OTHER, null, 'all'))).toBe(false)
    expect(stale(client, leagueActivityKeys.all(LEAGUE))).toBe(false)
  })

  it('a commissioner claim re-reads the activity feed and the audit log too', async () => {
    const client = seeded()
    vi.stubGlobal('fetch', respond(200, { acted_as_commissioner: true }))
    await new MutationObserver(client, submitClaimMutationOptions(client, LEAGUE)).mutate({ team_id: 't1', add_player_id: 'p', action_id: 'x' })
    expect(stale(client, leagueActivityKeys.all(LEAGUE))).toBe(true)
    expect(stale(client, commishLogKeys.all(LEAGUE))).toBe(true)
    expect(stale(client, leagueRosterKeys.all(LEAGUE))).toBe(false)
  })
})

describe('useCancelClaim', () => {
  it('DELETEs …/waivers/[cid] with the body, once, and re-reads the claims', async () => {
    const client = seeded()
    const fetchMock = respond(500, { error: 'boom' })
    vi.stubGlobal('fetch', fetchMock)
    await new MutationObserver(client, cancelClaimMutationOptions(client, LEAGUE)).mutate({ claim_id: 'b', action_id: 'x' }).catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/api/leagues/${LEAGUE}/waivers/b`)
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(String(init.body))).toStrictEqual({ action_id: 'x' })
    expect(stale(client, waiverClaimKeys.team(LEAGUE, null, 'all'))).toBe(true)
  })
})

describe('useEditClaim — ONE call, one transaction (M5 L.D2.9 / F417): not optimistic, not retried', () => {
  it('PATCHes …/waivers/[cid] with { faab_bid, drop_player_id, action_id } once; the cache is untouched; the claims re-read on a failure', async () => {
    const client = seeded()
    const fetchMock = respond(502, { error: 'upstream' })
    vi.stubGlobal('fetch', fetchMock)
    await new MutationObserver(client, editClaimMutationOptions(client, LEAGUE))
      .mutate({ claim_id: 'b', faab_bid: 12, drop_player_id: null, action_id: 'x' })
      .catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/api/leagues/${LEAGUE}/waivers/b`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toStrictEqual({ faab_bid: 12, drop_player_id: null, action_id: 'x' })
    expect(client.getQueryData(waiverClaimKeys.team(LEAGUE, null, 'all'))).toBe(DOC)
    expect(stale(client, waiverClaimKeys.team(LEAGUE, null, 'all'))).toBe(true)
    expect(stale(client, waiverClaimKeys.team(OTHER, null, 'all'))).toBe(false)
  })

  it("a manager's edit re-reads only the claims; a commissioner's also the feed and the audit log", async () => {
    const client = seeded()
    vi.stubGlobal('fetch', respond(200, { acted_as_commissioner: false }))
    await new MutationObserver(client, editClaimMutationOptions(client, LEAGUE)).mutate({ claim_id: 'b', faab_bid: 1, drop_player_id: null, action_id: 'x' })
    expect(stale(client, waiverClaimKeys.team(LEAGUE, null, 'all'))).toBe(true)
    expect(stale(client, leagueActivityKeys.all(LEAGUE))).toBe(false)
    vi.stubGlobal('fetch', respond(200, { acted_as_commissioner: true }))
    await new MutationObserver(client, editClaimMutationOptions(client, LEAGUE)).mutate({ claim_id: 'b', faab_bid: 1, drop_player_id: null, action_id: 'y' })
    expect(stale(client, leagueActivityKeys.all(LEAGUE))).toBe(true)
    expect(stale(client, commishLogKeys.all(LEAGUE))).toBe(true)
  })
})

describe('useReorderClaims — OPTIMISTIC, rolled back on a refusal', () => {
  it('applyClaimMove moves among PENDING claims only, renumbering 1..n', () => {
    const moved = applyClaimMove(DOC, 'c', 1)
    expect(moved.claims.map((c) => [c.id, c.claim_order])).toStrictEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
      ['w', 1],
    ])
    expect(applyClaimMove(DOC, 'w', 1)).toBe(DOC)
  })

  it('the move shows before the answer; a refusal restores the snapshot, hits the wire once, re-reads', async () => {
    const client = seeded()
    let release!: (r: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)))
    vi.stubGlobal('fetch', fetchMock)
    const observer = new MutationObserver(client, reorderClaimMutationOptions(client, LEAGUE))
    const pending = observer.mutate({ claim_id: 'c', claim_order: 1, action_id: 'x' }).catch(() => undefined)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const during = client.getQueryData<WaiverClaimsDocument>(waiverClaimKeys.team(LEAGUE, null, 'all'))
    expect(during?.claims[0].id).toBe('c')
    release(new Response(JSON.stringify({ error: 'the set changed' }), { status: 409 }))
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(waiverClaimKeys.team(LEAGUE, null, 'all'))).toStrictEqual(DOC)
    expect(stale(client, waiverClaimKeys.team(LEAGUE, null, 'all'))).toBe(true)
    // Another league's cache was never touched.
    expect(client.getQueryData(waiverClaimKeys.team(OTHER, null, 'all'))).toBe(DOC)
  })
})

describe('useCommishFaab — not optimistic, not retried, re-reads every balance surface', () => {
  it('on a refusal: once on the wire, caches untouched, and rosters / standings / detail / claims / feed / log re-read', async () => {
    const client = seeded()
    const fetchMock = respond(403, { error: 'Only this league’s commissioner can change a team’s FAAB balance.' })
    vi.stubGlobal('fetch', fetchMock)
    await new MutationObserver(client, commishEditFaabMutationOptions(client, LEAGUE)).mutate({ team_id: 't1', balance: 5, action_id: 'x' }).catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(leagueRosterKeys.all(LEAGUE))).toStrictEqual({ seeded: true })
    for (const key of [leagueRosterKeys.all(LEAGUE), leagueStandingsKeys.all(LEAGUE), leaguesKeys.detail(LEAGUE), waiverClaimKeys.team(LEAGUE, null, 'all'), leagueActivityKeys.all(LEAGUE), commishLogKeys.all(LEAGUE)]) {
      expect(stale(client, key), JSON.stringify(key)).toBe(true)
    }
    expect(stale(client, leagueRosterKeys.all(OTHER))).toBe(false)
  })
})
