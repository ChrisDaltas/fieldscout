/**
 * draft-service-targets-copy.test.ts — F78 (M7 L.F1.1, D624): the
 * `draft_queue_replace` refusals reach a manager in the Targets vocabulary
 * (D140), translated at the service boundary because the RAISE texts are
 * pinned in released migrations. Goldens are stored literals — the user-facing
 * sentence, never re-derived from the map under test.
 */
import { describe, expect, it, vi } from 'vitest'

import { leagueScope, targetsRefusalCopy, upsertQueue } from './draft-service'

const LEAGUE = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'
const MY_TEAM = '33333333-3333-4333-8333-333333333333'
const USER = '55555555-5555-4555-8555-555555555555'

function fakeClient(rpc: ReturnType<typeof vi.fn>) {
  const rows: Record<string, unknown> = {
    drafts: { id: DRAFT, status: 'live', is_mock: false, config: {} },
    league_members: { team_id: MY_TEAM, role: 'manager' },
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

async function refusal(code: string, message: string) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message } })
  return upsertQueue(fakeClient(rpc), leagueScope(LEAGUE), USER, { draft_id: DRAFT, players: [] })
}

describe('F78 — Targets words on the queue-replace refusals', () => {
  it('42501: the forbidden fallback says Targets (403)', async () => {
    const result = await refusal('42501', 'You do not manage this queue.')
    expect(result).toEqual({ status: 403, body: { error: 'You do not manage these Targets.' } })
  })

  it('22023 duplicate: the RAISE text is translated (400)', async () => {
    const result = await refusal('22023', 'A player can appear in the queue only once.')
    expect(result).toEqual({
      status: 400,
      body: { error: 'A player can appear in your Targets only once.' },
    })
  })

  it('22023 cap (reachable through queueFromList append): translated (400)', async () => {
    const result = await refusal('22023', 'A queue can hold at most 500 players.')
    expect(result).toEqual({
      status: 400,
      body: { error: 'Your Targets can hold at most 500 players.' },
    })
  })

  it('an unrecognised message passes through unchanged', async () => {
    const result = await refusal('22023', 'Some other refusal.')
    expect(result).toEqual({ status: 400, body: { error: 'Some other refusal.' } })
    expect(targetsRefusalCopy('Some other refusal.')).toBe('Some other refusal.')
  })

  it('the client-side duplicate guard says Targets too', async () => {
    const rpc = vi.fn()
    const result = await upsertQueue(fakeClient(rpc), leagueScope(LEAGUE), USER, {
      draft_id: DRAFT,
      players: ['p1', 'p1'],
    })
    expect(result.status).toBe(400)
    expect(JSON.stringify(result.body)).toContain('A player can appear in your Targets only once.')
    expect(JSON.stringify(result.body)).not.toContain('queue')
    expect(rpc).not.toHaveBeenCalled()
  })
})
