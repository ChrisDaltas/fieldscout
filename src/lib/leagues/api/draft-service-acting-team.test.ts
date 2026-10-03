/**
 * draft-service-acting-team.test.ts — F524's service arms with doubles (the
 * stack halves live in draft-queue-api-db / auction-api-db):
 *   - the bid sends `p_team_id` ONLY when the commissioner names another team
 *     (the manager's call is the five arguments it always was — deploy-safe);
 *   - a non-commissioner naming another team is refused BEFORE any RPC (the
 *     F65 / R420 discriminator stays a team the caller may act for);
 *   - degrade-before-push: on a chain without 178 the commissioner's read of
 *     another team's Targets answers PGRST202, and the route names it as a
 *     503 — never an empty queue.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_QUEUE_READ_NOT_PUSHED_MESSAGE,
  NOT_COMMISH_FOR_TEAM_MESSAGE,
  leagueScope,
  placeBid,
  readTeamQueue,
} from './draft-service'

const LEAGUE = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'
const MY_TEAM = '33333333-3333-4333-8333-333333333333'
const OTHER_TEAM = '44444444-4444-4444-8444-444444444444'
const USER = '55555555-5555-4555-8555-555555555555'
const ACTION = '66666666-6666-4666-8666-666666666666'

interface Fake {
  role: string
  rpc: ReturnType<typeof vi.fn>
}

function fakeClient({ role, rpc }: Fake) {
  const rows: Record<string, unknown> = {
    drafts: { id: DRAFT, status: 'live', is_mock: false, config: {} },
    league_members: { team_id: MY_TEAM, role },
  }
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'is', 'order']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null })
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
    return chain
  }
  return { from, rpc } as never
}

function bidBody(teamId?: string) {
  return {
    draft_id: DRAFT,
    nomination_seq: 4,
    player_id: 'p1',
    amount: 3,
    action_id: ACTION,
    ...(teamId ? { team_id: teamId } : {}),
  }
}

function bidResult(teamId: string) {
  return {
    data: {
      draft: { id: DRAFT },
      bid: { team_id: teamId, nomination_seq: 4, player_id: 'p1', amount: 3 },
    },
    error: null,
  }
}

describe('placeBid — the commissioner arm (F524)', () => {
  it('no team named: the five arguments the manager always sent (no p_team_id key)', async () => {
    const rpc = vi.fn().mockResolvedValue(bidResult(MY_TEAM))
    const result = await placeBid(fakeClient({ role: 'manager', rpc }), leagueScope(LEAGUE), USER, bidBody())
    expect(result.status).toBe(200)
    expect(Object.keys(rpc.mock.calls[0][1]).sort()).toEqual([
      'p_action_id',
      'p_amount',
      'p_draft_id',
      'p_nomination_seq',
      'p_player_id',
    ])
  })

  it('his own seat named is his own bid (no p_team_id)', async () => {
    const rpc = vi.fn().mockResolvedValue(bidResult(MY_TEAM))
    const result = await placeBid(
      fakeClient({ role: 'commissioner', rpc }),
      leagueScope(LEAGUE),
      USER,
      bidBody(MY_TEAM),
    )
    expect(result.status).toBe(200)
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_team_id')
  })

  it('a commissioner naming another team sends p_team_id and the F65 check keys on THAT team', async () => {
    const rpc = vi.fn().mockResolvedValue(bidResult(OTHER_TEAM))
    const result = await placeBid(
      fakeClient({ role: 'co_commissioner', rpc }),
      leagueScope(LEAGUE),
      USER,
      bidBody(OTHER_TEAM),
    )
    expect(result.status).toBe(200)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_team_id: OTHER_TEAM })
  })

  it('…and a row that is not that team’s is the F65 409', async () => {
    const rpc = vi.fn().mockResolvedValue(bidResult(MY_TEAM))
    const result = await placeBid(
      fakeClient({ role: 'commissioner', rpc }),
      leagueScope(LEAGUE),
      USER,
      bidBody(OTHER_TEAM),
    )
    expect(result.status).toBe(409)
  })

  it('a manager naming another team is a 403 by name BEFORE any RPC', async () => {
    const rpc = vi.fn()
    const result = await placeBid(fakeClient({ role: 'manager', rpc }), leagueScope(LEAGUE), USER, bidBody(OTHER_TEAM))
    expect(result).toEqual({ status: 403, body: { error: NOT_COMMISH_FOR_TEAM_MESSAGE } })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('readTeamQueue — the commissioner read (F48 / F524) and its degrade', () => {
  it('on a chain without 178 the door answers PGRST202 and the route names it as a 503 — never an empty queue', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message:
          'Could not find the function public.draft_queue_for_team(p_draft_id, p_team_id) in the schema cache',
        hint: null,
      },
    })
    const result = await readTeamQueue(fakeClient({ role: 'commissioner', rpc }), leagueScope(LEAGUE), USER, {
      draft_id: DRAFT,
      team_id: OTHER_TEAM,
    })
    expect(result).toEqual({ status: 503, body: { error: COMMISH_QUEUE_READ_NOT_PUSHED_MESSAGE } })
  })

  it('the door’s rows come back as the queue', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ player_id: 'p9', rank: 1 }], error: null })
    const result = await readTeamQueue(fakeClient({ role: 'commissioner', rpc }), leagueScope(LEAGUE), USER, {
      draft_id: DRAFT,
      team_id: OTHER_TEAM,
    })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ draft_id: DRAFT, team_id: OTHER_TEAM, queue: [{ player_id: 'p9', rank: 1 }] })
    expect(rpc).toHaveBeenCalledWith('draft_queue_for_team', { p_draft_id: DRAFT, p_team_id: OTHER_TEAM })
  })

  it('a manager naming another team is a 403 and the door is never called', async () => {
    const rpc = vi.fn()
    const result = await readTeamQueue(fakeClient({ role: 'manager', rpc }), leagueScope(LEAGUE), USER, {
      draft_id: DRAFT,
      team_id: OTHER_TEAM,
    })
    expect(result.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a 42501 from the door (not an active franchise / not his league) is a 403, not a 500', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'draft_queue_for_team: only a commissioner can read another team’s Targets (§12.6)' },
    })
    const result = await readTeamQueue(fakeClient({ role: 'commissioner', rpc }), leagueScope(LEAGUE), USER, {
      draft_id: DRAFT,
      team_id: OTHER_TEAM,
    })
    expect(result.status).toBe(403)
  })
})
