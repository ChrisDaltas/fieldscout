/**
 * commish-team-service.test.ts — the PURE half of the commissioner team
 * rename (M6A task L.E1.11; spec §15.4's v2.16.39 erratum; migration 128 via
 * 131; PROGRESS D351). The part-1 suites' three proofs, for this verb:
 *
 *   - the SCHEMA accepts an absent / blank reason (Q66), LOWER-CASES every
 *     uuid (R768), trims the name and refuses a blank or a 101-char one
 *     (128:365-369 mirrored);
 *   - 128:637's argument order, an absent reason OMITTED, and NEVER the
 *     manager's `rename_own_team`;
 *   - the family mapper's four arms VERBATIM, and the F65(b) guard — a
 *     reused `action_id` for a different team / name / verb is a 409.
 *
 * The live half (the sealed-franchise refusal, the collision report, the
 * receipt) is pgTAP 076 + the stack suite.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_TEAM_ACTION_ID_REUSED_MESSAGE,
  COMMISH_TEAM_FORBIDDEN_MESSAGE,
  commishRenameTeam,
  commishRenameTeamInputSchema,
} from './commish-team-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const TEAM_A = 'CE000000-0000-4000-8000-000000000001'
const TEAM_A_LC = 'ce000000-0000-4000-8000-000000000001'
const TEAM_B = 'ce000000-0000-4000-8000-000000000002'
const ACTION = 'AFA00000-0000-4000-8000-000000000051'
const ACTION_LC = 'afa00000-0000-4000-8000-000000000051'

const body = {
  team_id: TEAM_A,
  name: '  Alpha Reborn  ',
  action_id: ACTION,
  reason: 'paper draft: the owner picked a name',
}

describe('commishRenameTeamInputSchema — 128:637', () => {
  it('LOWER-CASES every uuid (R768), TRIMS the name, and accepts an absent / blank reason (Q66)', () => {
    const parsed = commishRenameTeamInputSchema.parse({ ...body, reason: '\t' })
    expect(parsed.team_id).toBe(TEAM_A_LC)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.name).toBe('Alpha Reborn')
    expect(parsed.reason).toBeUndefined()
    const without: Partial<typeof body> = { ...body }
    delete without.reason
    expect(commishRenameTeamInputSchema.safeParse(without).success).toBe(true)
  })

  it('a blank / whitespace-only name and a 101-char name are field errors (128:365-369 mirrored); 100 passes', () => {
    expect(commishRenameTeamInputSchema.safeParse({ ...body, name: '   ' }).success).toBe(false)
    expect(commishRenameTeamInputSchema.safeParse({ ...body, name: 'x'.repeat(101) }).success).toBe(false)
    expect(commishRenameTeamInputSchema.safeParse({ ...body, name: 'x'.repeat(100) }).success).toBe(true)
  })

  it('501-char reasons, a null reason and unknown keys are refused', () => {
    expect(commishRenameTeamInputSchema.safeParse({ ...body, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(commishRenameTeamInputSchema.safeParse({ ...body, reason: null }).success).toBe(false)
    expect(commishRenameTeamInputSchema.safeParse({ ...body, owner_id: TEAM_B }).success).toBe(false)
  })
})

function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const result = {
  verb: 'commish_rename_team',
  action_type: 'reassign_team',
  action_id: ACTION_LC,
  team_id: TEAM_A_LC,
  name: 'Alpha Reborn',
  previous_name: 'Team 1',
  requested_name: 'Alpha Reborn',
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000006',
}

describe('commishRenameTeam — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_rename_team in 128:637’s order with the TRIMMED name; the reason rides when given and is OMITTED when blank', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    expect((await commishRenameTeam(client, LEAGUE, body)).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_rename_team', {
      p_league_id: LEAGUE,
      p_team_id: TEAM_A_LC,
      p_name: 'Alpha Reborn',
      p_reason: body.reason,
      p_action_id: ACTION_LC,
    })
    await commishRenameTeam(client, LEAGUE, { ...body, reason: '' })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_reason')
  })

  it('never calls the manager’s verb — rename_own_team is a manager action, not a /commish/ door', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    await commishRenameTeam(client, LEAGUE, body)
    expect(rpc.mock.calls.map((c) => c[0])).toStrictEqual(['commish_rename_team'])
  })

  it('returns 128’s document WHOLE — name_collides_with and propagation are not narrowed away', async () => {
    const full = { ...result, name_collides_with: [TEAM_B], propagation: { live: true, history_rewritten: false } }
    const { client } = rpcDouble({ data: full, error: null })
    expect((await commishRenameTeam(client, LEAGUE, body)).body).toStrictEqual(full)
  })

  it('the family mapper: 403 with this route’s copy · 404 · 409 · 400, each message VERBATIM', async () => {
    expect(await commishRenameTeam(rpcDouble({ data: null, error: { code: '42501', message: 'x' } }).client, LEAGUE, body)).toStrictEqual({ status: 403, body: { error: COMMISH_TEAM_FORBIDDEN_MESSAGE } })
    expect(await commishRenameTeam(rpcDouble({ data: null, error: { code: 'P0002', message: 'gone' } }).client, LEAGUE, body)).toStrictEqual({ status: 404, body: { error: 'gone' } })
    const sealed = 'commish_rename_team: franchise ce… is RETIRED — its name is FROZEN, because a sealed franchise is the record History Mode shows under its last manager (spec:183, §7.2.1(b))'
    expect(await commishRenameTeam(rpcDouble({ data: null, error: { code: 'P0001', message: sealed } }).client, LEAGUE, body)).toStrictEqual({ status: 409, body: { error: sealed } })
    const bound = 'commish_rename_team: the name is 101 characters — at most 100 (the league-rename bound, createLeagueInputSchema.name)'
    expect(await commishRenameTeam(rpcDouble({ data: null, error: { code: '22023', message: bound } }).client, LEAGUE, body)).toStrictEqual({ status: 400, body: { error: bound } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT team / name / verb / id is a 409, never a 200 for a rename nobody made', async () => {
    for (const wrong of [
      { ...result, team_id: TEAM_B },
      { ...result, requested_name: 'Alpha Reborn II' },
      { ...result, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...result, verb: 'rename_own_team' },
      {},
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishRenameTeam(client, LEAGUE, body)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_TEAM_ACTION_ID_REUSED_MESSAGE })
    }
  })
})
