/**
 * waivers-service.test.ts — the PURE half of the claim routes (M5 L.D2.12;
 * migration 145): the schemas, 145's argument shapes, the family mapper
 * verbatim, the F65(b) guard per verb, `moveClaim`, and the GET's
 * blind-bid refusal. The live half — RLS, the real verbs, the reads — is
 * `waivers-api-db.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  PG_INT_MAX,
  WAIVER_CLAIMS_READ_FORBIDDEN_MESSAGE,
  WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE,
  WAIVER_CLAIM_FORBIDDEN_MESSAGE,
  cancelClaim,
  moveClaim,
  readClaims,
  reorderClaim,
  submitClaim,
  submitClaimInputSchema,
} from './waivers-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const TEAM = 'AB000000-0000-4000-8000-000000000001'
const TEAM_LC = 'ab000000-0000-4000-8000-000000000001'
const ACTION = 'AB000000-0000-4000-8000-0000000000A1'
const ACTION_LC = 'ab000000-0000-4000-8000-0000000000a1'
const CLAIM = 'ab000000-0000-4000-8000-0000000000c1'

function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

const submitBody = { team_id: TEAM, add_player_id: 'p-add', drop_player_id: 'p-drop', faab_bid: 12, action_id: ACTION }
const submitEcho = {
  verb: 'waiver_claim_submit',
  action_id: ACTION_LC,
  team_id: TEAM_LC,
  claim: { id: CLAIM, add_player_id: 'p-add', drop_player_id: 'p-drop', faab_bid: 12, claim_order: 1 },
}

describe('submitClaimInputSchema', () => {
  it('bid: a whole number 0 … INTEGER max, or absent ($0) — R1172’s bound for the same column type', () => {
    expect(PG_INT_MAX).toBe(2147483647)
    for (const faab_bid of [0, 1, PG_INT_MAX, undefined]) {
      expect(submitClaimInputSchema.safeParse({ ...submitBody, faab_bid }).success, String(faab_bid)).toBe(true)
    }
    for (const faab_bid of [-1, PG_INT_MAX + 1, 2.5, '5', null]) {
      expect(submitClaimInputSchema.safeParse({ ...submitBody, faab_bid }).success, String(faab_bid)).toBe(false)
    }
  })

  it('add is required, drop may be null / absent but never the add, unknown keys refused, uuids lower-cased', () => {
    const noAdd: Record<string, unknown> = { ...submitBody }
    delete noAdd.add_player_id
    expect(submitClaimInputSchema.safeParse(noAdd).success).toBe(false)
    expect(submitClaimInputSchema.safeParse({ ...submitBody, drop_player_id: null }).success).toBe(true)
    const same = submitClaimInputSchema.safeParse({ ...submitBody, drop_player_id: 'p-add' })
    expect(same.success).toBe(false)
    expect(JSON.stringify(same.error)).toContain('drop_player_id')
    expect(submitClaimInputSchema.safeParse({ ...submitBody, priority: 1 }).success).toBe(false)
    const parsed = submitClaimInputSchema.parse(submitBody)
    expect([parsed.team_id, parsed.action_id]).toStrictEqual([TEAM_LC, ACTION_LC])
  })
})

describe('submitClaim — the RPC, the mapper, the F65(b) guard', () => {
  it("calls waiver_claim_submit with 145's arguments, omitting what is absent", async () => {
    const { client, rpc } = rpcDouble({ data: submitEcho, error: null })
    expect(await submitClaim(client, LEAGUE, submitBody)).toStrictEqual({ status: 200, body: submitEcho })
    expect(rpc).toHaveBeenCalledWith('waiver_claim_submit', {
      p_league_id: LEAGUE,
      p_team_id: TEAM_LC,
      p_add: 'p-add',
      p_drop: 'p-drop',
      p_bid: 12,
      p_action_id: ACTION_LC,
    })
    const bare = { ...submitEcho, claim: { ...submitEcho.claim, drop_player_id: null, faab_bid: 0 } }
    const second = rpcDouble({ data: bare, error: null })
    const res = await submitClaim(second.client, LEAGUE, { team_id: TEAM, add_player_id: 'p-add', action_id: ACTION, reason: 'acting for him' })
    expect(res.status).toBe(200)
    expect(second.rpc).toHaveBeenCalledWith('waiver_claim_submit', {
      p_league_id: LEAGUE,
      p_team_id: TEAM_LC,
      p_add: 'p-add',
      p_action_id: ACTION_LC,
      p_reason: 'acting for him',
    })
  })

  it('maps 42501 → 403 (one no-leak copy), P0001 → 409 / 22023 → 400 verbatim, else 500', async () => {
    const cases = [
      [{ code: '42501', message: 'waiver_claim_submit: not a manager of this team' }, 403, WAIVER_CLAIM_FORBIDDEN_MESSAGE],
      [{ code: 'P0001', message: "waiver_claim_submit: a bid of $31 is more than A's FAAB balance of $30 (§13.2)" }, 409, "waiver_claim_submit: a bid of $31 is more than A's FAAB balance of $30 (§13.2)"],
      [{ code: '22023', message: 'waiver_claim_submit: a bid of $-1 is negative' }, 400, 'waiver_claim_submit: a bid of $-1 is negative'],
      [{ code: 'XX000', message: 'boom' }, 500, 'boom'],
    ] as const
    for (const [error, status, message] of cases) {
      const { client } = rpcDouble({ data: null, error })
      expect(await submitClaim(client, LEAGUE, submitBody)).toStrictEqual({ status, body: { error: message } })
    }
  })

  it('a reused action_id whose stored claim differs in add / drop / bid / team / verb is a 409 (F65(b))', async () => {
    for (const other of [
      { ...submitEcho, claim: { ...submitEcho.claim, add_player_id: 'p-other' } },
      { ...submitEcho, claim: { ...submitEcho.claim, drop_player_id: null } },
      { ...submitEcho, claim: { ...submitEcho.claim, faab_bid: 13 } },
      { ...submitEcho, team_id: 'ab000000-0000-4000-8000-000000000002' },
      { ...submitEcho, verb: 'waiver_claim_cancel' },
    ]) {
      const { client } = rpcDouble({ data: other, error: null })
      expect(await submitClaim(client, LEAGUE, submitBody)).toStrictEqual({ status: 409, body: { error: WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE } })
    }
    // An absent bid is $0 on the echo — not a mismatch.
    const zero = { ...submitEcho, claim: { ...submitEcho.claim, faab_bid: 0 } }
    const { client } = rpcDouble({ data: zero, error: null })
    const noBid: Record<string, unknown> = { ...submitBody }
    delete noBid.faab_bid
    expect((await submitClaim(client, LEAGUE, noBid)).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// moveClaim + reorder
// ---------------------------------------------------------------------------

describe('moveClaim — the pure "move to place N"', () => {
  it('moves up, down, to either end, and clamps out-of-range places', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(moveClaim(ids, 'c', 1)).toStrictEqual(['c', 'a', 'b', 'd'])
    expect(moveClaim(ids, 'a', 3)).toStrictEqual(['b', 'c', 'a', 'd'])
    expect(moveClaim(ids, 'a', 4)).toStrictEqual(['b', 'c', 'd', 'a'])
    expect(moveClaim(ids, 'b', 2)).toStrictEqual(ids)
    expect(moveClaim(ids, 'b', 99)).toStrictEqual(['a', 'c', 'd', 'b'])
    expect(moveClaim(ids, 'b', 0)).toStrictEqual(['b', 'a', 'c', 'd'])
  })
})

/** A client whose `from('waiver_claims')` answers the two reads in order. */
function reorderDouble(claim: unknown, pending: unknown[], rpcResponse: { data: unknown; error: unknown }) {
  let orders = 0
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  // The pending read ends in two .order() calls — the second one resolves.
  builder.order = vi.fn(() => (++orders % 2 === 0 ? Promise.resolve({ data: pending, error: null }) : builder))
  builder.maybeSingle = vi.fn(async () => ({ data: claim, error: null }))
  const from = vi.fn(() => builder)
  const rpc = vi.fn().mockResolvedValue(rpcResponse)
  return { client: { from, rpc } as never, rpc }
}

describe('reorderClaim — reads the order, moves [cid], guards the echo', () => {
  const TEAM_ROW = { id: CLAIM, team_id: TEAM_LC, status: 'pending' }
  const pending = [{ id: 'x1' }, { id: CLAIM }, { id: 'x3' }]
  const reorderEcho = {
    verb: 'waiver_claim_reorder',
    action_id: ACTION_LC,
    team_id: TEAM_LC,
    pending_claims: [{ id: CLAIM, claim_order: 1 }, { id: 'x1', claim_order: 2 }, { id: 'x3', claim_order: 3 }],
  }

  it('hands 145 the WHOLE order with [cid] moved, and returns the document', async () => {
    const { client, rpc } = reorderDouble(TEAM_ROW, pending, { data: reorderEcho, error: null })
    const res = await reorderClaim(client, LEAGUE, CLAIM.toUpperCase(), { claim_order: 1, action_id: ACTION })
    expect(res).toStrictEqual({ status: 200, body: reorderEcho })
    expect(rpc).toHaveBeenCalledWith('waiver_claim_reorder', {
      p_league_id: LEAGUE,
      p_team_id: TEAM_LC,
      p_claim_ids: [CLAIM, 'x1', 'x3'],
      p_action_id: ACTION_LC,
    })
  })

  it('an invisible claim is the no-leak 403; a settled one a 409 by name; a place past the end a 400 — none reach the RPC', async () => {
    const hidden = reorderDouble(null, pending, { data: reorderEcho, error: null })
    expect(await reorderClaim(hidden.client, LEAGUE, CLAIM, { claim_order: 1, action_id: ACTION })).toStrictEqual({
      status: 403,
      body: { error: WAIVER_CLAIM_FORBIDDEN_MESSAGE },
    })
    const settled = reorderDouble({ ...TEAM_ROW, status: 'won' }, pending, { data: reorderEcho, error: null })
    const res = await reorderClaim(settled.client, LEAGUE, CLAIM, { claim_order: 1, action_id: ACTION })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).toContain('this one is won')
    const past = reorderDouble(TEAM_ROW, pending, { data: reorderEcho, error: null })
    const pastRes = await reorderClaim(past.client, LEAGUE, CLAIM, { claim_order: 4, action_id: ACTION })
    expect(pastRes.status).toBe(400)
    expect(JSON.stringify(pastRes.body)).toContain('pick a place from 1 to 3')
    for (const d of [hidden, settled, past]) expect(d.rpc).not.toHaveBeenCalled()
  })

  it('an echo that does not put [cid] at the asked place (a reused action_id) is a 409', async () => {
    const wrong = { ...reorderEcho, pending_claims: [{ id: 'x1' }, { id: CLAIM }, { id: 'x3' }] }
    const { client } = reorderDouble(TEAM_ROW, pending, { data: wrong, error: null })
    expect(await reorderClaim(client, LEAGUE, CLAIM, { claim_order: 1, action_id: ACTION })).toStrictEqual({
      status: 409,
      body: { error: WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE },
    })
  })
})

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe('cancelClaim', () => {
  const cancelEcho = { verb: 'waiver_claim_cancel', action_id: ACTION_LC, claim_id: CLAIM }

  it('calls waiver_claim_cancel with the lower-cased claim id and guards the echo', async () => {
    const { client, rpc } = rpcDouble({ data: cancelEcho, error: null })
    expect(await cancelClaim(client, LEAGUE, CLAIM.toUpperCase(), { action_id: ACTION })).toStrictEqual({ status: 200, body: cancelEcho })
    expect(rpc).toHaveBeenCalledWith('waiver_claim_cancel', { p_league_id: LEAGUE, p_claim_id: CLAIM, p_action_id: ACTION_LC })
    const other = rpcDouble({ data: { ...cancelEcho, claim_id: 'ab000000-0000-4000-8000-0000000000c2' }, error: null })
    expect((await cancelClaim(other.client, LEAGUE, CLAIM, { action_id: ACTION })).status).toBe(409)
    expect((await cancelClaim(other.client, LEAGUE, CLAIM, {})).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// GET — the blind-bid refusal happens BEFORE any claim read
// ---------------------------------------------------------------------------

describe('readClaims — another team’s claims are the commissioner’s only', () => {
  function readDouble(opts: { member: boolean; ownTeam: string | null; commish: boolean }) {
    const from = vi.fn((table: string) => {
      const builder: Record<string, unknown> = {}
      builder.select = vi.fn(() => builder)
      builder.eq = vi.fn(() => builder)
      builder.is = vi.fn(() => builder)
      builder.maybeSingle = vi.fn(async () => {
        if (table === 'leagues') return { data: { id: LEAGUE, waiver_type: 'faab', faab_budget: 100, settings: {} }, error: null }
        if (table === 'league_members') return { data: opts.ownTeam ? { team_id: opts.ownTeam } : null, error: null }
        throw new Error(`unexpected maybeSingle on ${table}`)
      })
      return builder
    })
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'is_league_member') return { data: opts.member, error: null }
      if (fn === 'is_league_commish') return { data: opts.commish, error: null }
      throw new Error(fn)
    })
    return { client: { from, rpc } as never, from }
  }

  it('non-member → the family 403; a member naming another team → 403 by name; nothing reads waiver_claims', async () => {
    const outsider = readDouble({ member: false, ownTeam: null, commish: false })
    expect((await readClaims(outsider.client, LEAGUE, 'u', {})).status).toBe(403)
    const member = readDouble({ member: true, ownTeam: 'ab000000-0000-4000-8000-000000000009', commish: false })
    expect(await readClaims(member.client, LEAGUE, 'u', { team_id: TEAM })).toStrictEqual({
      status: 403,
      body: { error: WAIVER_CLAIMS_READ_FORBIDDEN_MESSAGE },
    })
    for (const d of [outsider, member]) {
      expect(d.from.mock.calls.map(([t]) => t)).not.toContain('waiver_claims')
    }
  })

  it('an unknown query key or status is a 400', async () => {
    const d = readDouble({ member: true, ownTeam: TEAM_LC, commish: false })
    expect((await readClaims(d.client, LEAGUE, 'u', { status: 'won' })).status).toBe(400)
    expect((await readClaims(d.client, LEAGUE, 'u', { bid: '1' })).status).toBe(400)
  })
})
