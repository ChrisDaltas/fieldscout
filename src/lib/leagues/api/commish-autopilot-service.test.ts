/**
 * commish-autopilot-service.test.ts — the PURE half of the commissioner's
 * per-team autopilot switch (M6A task L.E1.22; spec §7.2.1(c) / §10.1, Q63;
 * migration 139; PROGRESS D351's doctrine copied, D376). The part-1 suites'
 * three proofs, for this verb:
 *
 *   - the SCHEMA: a boolean `on` (never a string / null), LOWER-CASED uuids
 *     (R768), an absent / blank reason (Q66), unknown keys refused;
 *   - 139's argument order, an absent reason OMITTED;
 *   - the family mapper's four arms VERBATIM, and the F65(b) guard — a reused
 *     `action_id` naming a different team / direction / verb / id is a 409.
 *
 * The live half (the seat predicate, the no-op, the receipt, RLS) is pgTAP
 * 087 + the stack suite `commish-autopilot-api-db.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_AUTOPILOT_ACTION_ID_REUSED_MESSAGE,
  COMMISH_AUTOPILOT_FORBIDDEN_MESSAGE,
  commishSetAutopilot,
  commishSetAutopilotInputSchema,
} from './commish-autopilot-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const TEAM_A = 'CE000000-0000-4000-8000-000000000001'
const TEAM_A_LC = 'ce000000-0000-4000-8000-000000000001'
const TEAM_B = 'ce000000-0000-4000-8000-000000000002'
const ACTION = 'AFA00000-0000-4000-8000-000000000071'
const ACTION_LC = 'afa00000-0000-4000-8000-000000000071'

const body = { team_id: TEAM_A, on: true, action_id: ACTION, reason: 'nobody has claimed the seat yet' }

describe('commishSetAutopilotInputSchema — 139', () => {
  it('LOWER-CASES every uuid (R768), keeps `on` a boolean, and accepts an absent / blank reason (Q66)', () => {
    const parsed = commishSetAutopilotInputSchema.parse({ ...body, reason: '\t' })
    expect(parsed).toStrictEqual({ team_id: TEAM_A_LC, on: true, action_id: ACTION_LC, reason: undefined })
    const without: Partial<typeof body> = { ...body }
    delete without.reason
    expect(commishSetAutopilotInputSchema.safeParse(without).success).toBe(true)
    expect(commishSetAutopilotInputSchema.parse({ ...body, on: false }).on).toBe(false)
  })

  it('`on` must be a real boolean — a missing, null or string value is a field error, never coerced', () => {
    const missing: Partial<typeof body> = { ...body }
    delete missing.on
    for (const bad of [missing, { ...body, on: null }, { ...body, on: 'true' }, { ...body, on: 1 }]) {
      expect(commishSetAutopilotInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('501-char reasons, a null reason and unknown keys are refused', () => {
    expect(commishSetAutopilotInputSchema.safeParse({ ...body, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(commishSetAutopilotInputSchema.safeParse({ ...body, reason: null }).success).toBe(false)
    expect(commishSetAutopilotInputSchema.safeParse({ ...body, remind: true }).success).toBe(false)
  })
})

function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const result = {
  verb: 'commish_set_autopilot',
  action_type: 'set_autopilot',
  action_id: ACTION_LC,
  team_id: TEAM_A_LC,
  autopilot: true,
  previous: false,
  requested: true,
  seat: 'unmanaged',
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000071',
}

describe('commishSetAutopilot — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_set_autopilot in 139’s order; the reason rides when given and is OMITTED when blank', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    expect((await commishSetAutopilot(client, LEAGUE, body)).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_set_autopilot', {
      p_league_id: LEAGUE,
      p_team_id: TEAM_A_LC,
      p_on: true,
      p_reason: body.reason,
      p_action_id: ACTION_LC,
    })
    await commishSetAutopilot(client, LEAGUE, { ...body, reason: '' })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_reason')
  })

  it('returns 139’s document WHOLE — effect / seat_why are not narrowed away', async () => {
    const full = { ...result, effect: 'on — from the next lineup-lock tick …', seat_why: 'no manager is seated …' }
    const { client } = rpcDouble({ data: full, error: null })
    expect((await commishSetAutopilot(client, LEAGUE, body)).body).toStrictEqual(full)
  })

  it('a 400 for a malformed body never reaches the RPC', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    expect((await commishSetAutopilot(client, LEAGUE, { ...body, on: 'yes' })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('the family mapper: 403 with this route’s copy · 404 · 409 · 400, each message VERBATIM', async () => {
    expect(await commishSetAutopilot(rpcDouble({ data: null, error: { code: '42501', message: 'x' } }).client, LEAGUE, body)).toStrictEqual({ status: 403, body: { error: COMMISH_AUTOPILOT_FORBIDDEN_MESSAGE } })
    expect(await commishSetAutopilot(rpcDouble({ data: null, error: { code: 'P0002', message: 'gone' } }).client, LEAGUE, body)).toStrictEqual({ status: 404, body: { error: 'gone' } })
    const managed = "commish_set_autopilot: team ce… has a manager — autopilot is for a seat with NO manager (§7.2.1(c)); to set this team's lineup, use the lineup override"
    expect(await commishSetAutopilot(rpcDouble({ data: null, error: { code: 'P0001', message: managed } }).client, LEAGUE, body)).toStrictEqual({ status: 409, body: { error: managed } })
    const shape = 'commish_set_autopilot: p_on is required — TRUE puts the team on autopilot, FALSE takes it off'
    expect(await commishSetAutopilot(rpcDouble({ data: null, error: { code: '22023', message: shape } }).client, LEAGUE, body)).toStrictEqual({ status: 400, body: { error: shape } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT team / direction / verb / id is a 409, never a 200 for a switch nobody flipped', async () => {
    for (const wrong of [
      { ...result, team_id: TEAM_B },
      { ...result, requested: false },
      { ...result, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...result, verb: 'commish_rename_team' },
      {},
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishSetAutopilot(client, LEAGUE, body)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_AUTOPILOT_ACTION_ID_REUSED_MESSAGE })
    }
  })
})
