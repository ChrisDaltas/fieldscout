/**
 * commish-faab-service.test.ts — the PURE half of `POST …/commish/faab`
 * (M5 L.D2.12; migration 147; D385; R1172): the schema's balance bound, the
 * RPC argument order, the family mapper verbatim, and the F65(b) guard.
 * The live half is `waivers-api-db.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_FAAB_ACTION_ID_REUSED_MESSAGE,
  COMMISH_FAAB_FORBIDDEN_MESSAGE,
  commishEditFaab,
  commishEditFaabInputSchema,
} from './commish-faab-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const TEAM = 'FA000000-0000-4000-8000-000000000001'
const TEAM_LC = 'fa000000-0000-4000-8000-000000000001'
const ACTION = 'FA000000-0000-4000-8000-0000000000A1'
const ACTION_LC = 'fa000000-0000-4000-8000-0000000000a1'

const body = { team_id: TEAM, balance: 250, action_id: ACTION }

describe('commishEditFaabInputSchema — R1172: a whole number 0 … 2147483647, no lower sanity cap', () => {
  it('accepts 0, above-budget amounts and INTEGER max; lower-cases the uuids; reason optional (Q66)', () => {
    for (const balance of [0, 1, 250, 100_000, 2147483647]) {
      expect(commishEditFaabInputSchema.safeParse({ ...body, balance }).success, String(balance)).toBe(true)
    }
    const parsed = commishEditFaabInputSchema.parse({ ...body, reason: '  ' })
    expect(parsed.team_id).toBe(TEAM_LC)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.reason).toBeUndefined()
  })

  it('refuses one past INTEGER max (a clean 400, never a raw DB overflow), negatives, fractions, strings and unknown keys', () => {
    for (const balance of [2147483648, -1, 1.5, '40', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(commishEditFaabInputSchema.safeParse({ ...body, balance }).success, String(balance)).toBe(false)
    }
    expect(commishEditFaabInputSchema.safeParse({ team_id: TEAM, action_id: ACTION }).success).toBe(false)
    expect(commishEditFaabInputSchema.safeParse({ ...body, faab_budget: 100 }).success).toBe(false)
  })
})

function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const echo = { verb: 'commish_edit_faab', action_id: ACTION_LC, team_id: TEAM_LC, requested_balance: 250, faab_balance: 250 }

describe('commishEditFaab — the RPC, the mapper, the F65(b) guard', () => {
  it("calls commish_edit_faab with 147's arguments (reason OMITTED when absent) and returns the document whole", async () => {
    const { client, rpc } = rpcDouble({ data: echo, error: null })
    const res = await commishEditFaab(client, LEAGUE, body)
    expect(res).toStrictEqual({ status: 200, body: echo })
    expect(rpc).toHaveBeenCalledWith('commish_edit_faab', {
      p_league_id: LEAGUE,
      p_team_id: TEAM_LC,
      p_balance: 250,
      p_action_id: ACTION_LC,
    })
  })

  it('an out-of-range balance never reaches the RPC', async () => {
    const { client, rpc } = rpcDouble({ data: echo, error: null })
    const res = await commishEditFaab(client, LEAGUE, { ...body, balance: 2147483648 })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps 42501 → 403 (the one no-leak copy), P0001 → 409 / 22023 → 400 verbatim, else 500', async () => {
    const cases = [
      [{ code: '42501', message: 'commish_edit_faab: not a commissioner of this league' }, 403, COMMISH_FAAB_FORBIDDEN_MESSAGE],
      [{ code: 'P0001', message: 'commish_edit_faab: franchise x is RETIRED' }, 409, 'commish_edit_faab: franchise x is RETIRED'],
      [{ code: '22023', message: 'commish_edit_faab: a FAAB balance cannot be negative' }, 400, 'commish_edit_faab: a FAAB balance cannot be negative'],
      [{ code: 'XX000', message: 'boom' }, 500, 'boom'],
    ] as const
    for (const [error, status, message] of cases) {
      const { client } = rpcDouble({ data: null, error })
      expect(await commishEditFaab(client, LEAGUE, body)).toStrictEqual({ status, body: { error: message } })
    }
  })

  it('a reused action_id whose stored edit named another team, another balance or another verb is a 409', async () => {
    for (const other of [
      { ...echo, team_id: 'fa000000-0000-4000-8000-000000000002' },
      { ...echo, requested_balance: 60 },
      { ...echo, verb: 'commish_rename_team' },
      { ...echo, action_id: 'fa000000-0000-4000-8000-0000000000a2' },
    ]) {
      const { client } = rpcDouble({ data: other, error: null })
      expect(await commishEditFaab(client, LEAGUE, body)).toStrictEqual({
        status: 409,
        body: { error: COMMISH_FAAB_ACTION_ID_REUSED_MESSAGE },
      })
    }
  })
})
