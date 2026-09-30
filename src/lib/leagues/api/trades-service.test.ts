/**
 * trades-service.test.ts — the L.D3.6 service's own contract over a FAKE
 * client (no stack): the schemas, the exact RPC arguments, the SQLSTATE map,
 * the F65(b) echo guards (each one a mismatch that must be a 409), the
 * deploy-before-push 503 (anchored on the trade objects' names) and the
 * countdown arithmetic. The real wire is `trades-api-db.test.ts` /
 * `commish-trade-api-db.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_TRADE_FORBIDDEN_MESSAGE,
  COMMISH_TRADE_OPS,
  TRADES_UNAVAILABLE_MESSAGE,
  TRADE_ACTION_ID_REUSED_MESSAGE,
  TRADE_PROPOSE_FORBIDDEN_MESSAGE,
  TRADE_RESPOND_FORBIDDEN_MESSAGE,
  TRADE_VOTE_FORBIDDEN_MESSAGE,
  TRADE_CHECKS_FORBIDDEN_MESSAGE,
  TRADE_CHECKS_UNAVAILABLE_MESSAGE,
  previewTrade,
  readTradeDeadline,
  actOnTrade,
  commishTrade,
  isDoorNotPushed,
  isMissingSchemaObject,
  msUntil,
  proposeTrade,
  readTrades,
} from './trades-service'

const L = 'b8a00000-0000-4000-8000-000000000001'
const TA = 'b8a00000-0000-4000-8000-00000000000a'
const TB = 'b8a00000-0000-4000-8000-00000000000b'
const TID = 'b8a00000-0000-4000-8000-0000000000f1'
const ACT = 'b8a00000-0000-4000-8000-0000000000a1'

type RpcAnswer = { data: unknown; error: { code?: string; message: string } | null }

function rpcClient(answer: RpcAnswer | ((name: string, args: Record<string, unknown>) => RpcAnswer)) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => (typeof answer === 'function' ? answer(name, args) : answer))
  return { client: { rpc } as never, rpc }
}

const proposeBody = {
  from_team_id: TA,
  to_team_id: TB,
  items: [
    { player_id: 'p1', from_team_id: TA },
    { player_id: 'p3', from_team_id: TB },
    { faab_amount: 5, from_team_id: TB },
  ],
  drops: ['p2'],
  note: '  good luck  ',
  action_id: ACT,
}

function proposeEcho(overrides: Record<string, unknown> = {}, trade: Record<string, unknown> = {}) {
  return {
    verb: 'trade_propose',
    action_id: ACT,
    team_id: TA,
    trade: {
      id: TID,
      proposer_team_id: TA,
      recipient_team_id: TB,
      items: [
        { from_team_id: TA, player_id: 'p1', faab_amount: null },
        { from_team_id: TB, player_id: 'p3', faab_amount: null },
        { from_team_id: TB, player_id: null, faab_amount: 5 },
      ],
      drops: [{ team_id: TA, player_id: 'p2' }],
      ...trade,
    },
    ...overrides,
  }
}

describe('proposeTrade', () => {
  it('sends 148’s arguments exactly — the note trimmed, the drops kept, reason omitted when absent', async () => {
    const { client, rpc } = rpcClient({ data: proposeEcho(), error: null })
    const res = await proposeTrade(client, L, proposeBody)
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('trade_propose', {
      p_league_id: L,
      p_from_team_id: TA,
      p_to_team_id: TB,
      p_items: proposeBody.items,
      p_drops: ['p2'],
      p_note: 'good luck',
      p_action_id: ACT,
    })
  })

  it('an uppercase team id reaches the RPC lower-cased, so the echo guard compares like with like (R768)', async () => {
    const { client, rpc } = rpcClient({ data: proposeEcho(), error: null })
    const res = await proposeTrade(client, L, { ...proposeBody, from_team_id: TA.toUpperCase(), items: proposeBody.items.map((i) => ({ ...i, from_team_id: i.from_team_id.toUpperCase() })) })
    expect(res.status).toBe(200)
    expect((rpc.mock.calls[0][1] as { p_from_team_id: string }).p_from_team_id).toBe(TA)
  })

  it('refuses a malformed body with a 400 and never calls the RPC', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    for (const bad of [
      { ...proposeBody, to_team_id: TA },
      { ...proposeBody, items: [] },
      { ...proposeBody, items: [{ player_id: 'p1', faab_amount: 3, from_team_id: TA }] },
      { ...proposeBody, items: [{ faab_amount: 0, from_team_id: TA }] },
      { ...proposeBody, items: [{ faab_amount: 2.5, from_team_id: TA }] },
      { ...proposeBody, extra: true },
      { ...proposeBody, action_id: 'nope' },
    ]) {
      expect((await proposeTrade(client, L, bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('F65(b): an echo that is not THIS offer is a 409 — another recipient, other legs, other drops, another verb', async () => {
    for (const echo of [
      proposeEcho({ verb: 'trade_respond' }),
      proposeEcho({ action_id: TID }),
      proposeEcho({}, { recipient_team_id: TA }),
      proposeEcho({}, { items: [{ from_team_id: TA, player_id: 'p1', faab_amount: null }] }),
      proposeEcho({}, { items: [{ from_team_id: TA, player_id: 'p1' }, { from_team_id: TB, player_id: 'p3' }, { from_team_id: TB, player_id: null, faab_amount: 6 }] }),
      proposeEcho({}, { drops: [] }),
    ]) {
      const { client } = rpcClient({ data: echo, error: null })
      expect(await proposeTrade(client, L, proposeBody)).toStrictEqual({ status: 409, body: { error: TRADE_ACTION_ID_REUSED_MESSAGE } })
    }
  })

  it('maps 42501 → 403 (no-leak), P0001 → 409 verbatim, 22023 → 400, and the missing function → the named 503', async () => {
    const cases: Array<[RpcAnswer['error'], number, unknown]> = [
      [{ code: '42501', message: 'trade_propose: not a manager of this team' }, 403, TRADE_PROPOSE_FORBIDDEN_MESSAGE],
      [{ code: 'P0001', message: 'trade_propose: the trade deadline has passed' }, 409, 'trade_propose: the trade deadline has passed'],
      [{ code: '22023', message: 'trade_propose: the note is 600 characters' }, 400, 'trade_propose: the note is 600 characters'],
      [{ code: 'PGRST202', message: 'Could not find the function public.trade_propose(p_action_id, p_from_team_id) in the schema cache' }, 503, TRADES_UNAVAILABLE_MESSAGE],
    ]
    for (const [error, status, message] of cases) {
      const { client } = rpcClient({ data: null, error })
      expect(await proposeTrade(client, L, proposeBody)).toStrictEqual({ status, body: { error: message } })
    }
  })
})

describe('actOnTrade (PATCH …/trades/[tid])', () => {
  const respondEcho = (op: string, extra: Record<string, unknown> = {}) => ({
    verb: 'trade_respond',
    op,
    action_id: ACT,
    trade_id: TID,
    trade: { id: TID, proposer_team_id: TA, recipient_team_id: TB, items: [], drops: [{ team_id: TB, player_id: 'p4' }] },
    counter_trade: null,
    ...extra,
  })

  it('accept sends its drops; the echo’s receiving-team drops must be the ones sent', async () => {
    const { client, rpc } = rpcClient({ data: respondEcho('accept'), error: null })
    expect((await actOnTrade(client, L, TID.toUpperCase(), { op: 'accept', drops: ['p4'], action_id: ACT })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('trade_respond', { p_league_id: L, p_trade_id: TID, p_op: 'accept', p_drops: ['p4'], p_action_id: ACT })
    // The same id replayed for an accept with NO drops (the first accept named one) — refused.
    const { client: c2 } = rpcClient({ data: respondEcho('accept'), error: null })
    expect(await actOnTrade(c2, L, TID, { op: 'accept', action_id: ACT })).toStrictEqual({ status: 409, body: { error: TRADE_ACTION_ID_REUSED_MESSAGE } })
  })

  it('reject / cancel carry no legs or drops; a leg on them is a 400 before the wire', async () => {
    const { client, rpc } = rpcClient({ data: respondEcho('cancel'), error: null })
    expect((await actOnTrade(client, L, TID, { op: 'cancel', action_id: ACT, reason: '  ' })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('trade_respond', { p_league_id: L, p_trade_id: TID, p_op: 'cancel', p_action_id: ACT })
    expect((await actOnTrade(client, L, TID, { op: 'reject', drops: ['p4'], action_id: ACT })).status).toBe(400)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('counter sends the counter-offer; the echoed counter_trade must carry exactly those legs', async () => {
    const items = [
      { player_id: 'p4', from_team_id: TB },
      { player_id: 'p2', from_team_id: TA },
    ]
    const counter = { id: 'new', proposer_team_id: TB, recipient_team_id: TA, items, drops: [] }
    const { client, rpc } = rpcClient({ data: respondEcho('counter', { counter_trade: counter }), error: null })
    expect((await actOnTrade(client, L, TID, { op: 'counter', items, note: 'how about', action_id: ACT })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('trade_respond', { p_league_id: L, p_trade_id: TID, p_op: 'counter', p_items: items, p_note: 'how about', p_action_id: ACT })
    const { client: c2 } = rpcClient({ data: respondEcho('counter', { counter_trade: { ...counter, items: items.slice(0, 1) } }), error: null })
    expect((await actOnTrade(c2, L, TID, { op: 'counter', items, action_id: ACT })).status).toBe(409)
    const { client: c3 } = rpcClient({ data: respondEcho('counter'), error: null })
    expect((await actOnTrade(c3, L, TID, { op: 'counter', items, action_id: ACT })).status).toBe(409)
  })

  it('an echo for another op / trade / verb is a 409', async () => {
    for (const echo of [respondEcho('reject'), { ...respondEcho('cancel'), trade_id: TA }, { ...respondEcho('cancel'), verb: 'trade_vote' }]) {
      const { client } = rpcClient({ data: echo, error: null })
      expect((await actOnTrade(client, L, TID, { op: 'cancel', action_id: ACT })).status).toBe(409)
    }
  })

  it('vote goes to trade_vote (155) with no team and no reason; its echo is checked', async () => {
    const { client, rpc } = rpcClient({ data: { op: 'vote', trade_id: TID, vote: 'veto', outcome: 'recorded' }, error: null })
    expect((await actOnTrade(client, L, TID, { op: 'vote', vote: 'veto', action_id: ACT })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('trade_vote', { p_league_id: L, p_trade_id: TID, p_vote: 'veto', p_action_id: ACT })
    expect((await actOnTrade(client, L, TID, { op: 'vote', vote: 'veto', action_id: ACT, reason: 'x' })).status).toBe(400)
    expect((await actOnTrade(client, L, TID, { op: 'vote', vote: 'maybe', action_id: ACT })).status).toBe(400)
    const { client: c2 } = rpcClient({ data: { op: 'vote', trade_id: TID, vote: 'approve' }, error: null })
    expect((await actOnTrade(c2, L, TID, { op: 'vote', vote: 'veto', action_id: ACT })).status).toBe(409)
  })

  it('each door keeps its own no-leak 403 copy; an unknown op is a 400', async () => {
    const { client } = rpcClient({ data: null, error: { code: '42501', message: 'x' } })
    expect(await actOnTrade(client, L, TID, { op: 'accept', action_id: ACT })).toStrictEqual({ status: 403, body: { error: TRADE_RESPOND_FORBIDDEN_MESSAGE } })
    expect(await actOnTrade(client, L, TID, { op: 'vote', vote: 'approve', action_id: ACT })).toStrictEqual({ status: 403, body: { error: TRADE_VOTE_FORBIDDEN_MESSAGE } })
    expect((await actOnTrade(client, L, TID, { op: 'approve', action_id: ACT })).status).toBe(400)
  })
})

describe('commishTrade (POST …/commish/trade — F451)', () => {
  const echo = { verb: 'commish_force_or_reverse_trade', op: 'force', action_id: ACT, trade_id: TID, no_changes: false }

  it('sends 156’s arguments (reason optional, blank dropped) and passes the document through', async () => {
    const { client, rpc } = rpcClient({ data: echo, error: null })
    const res = await commishTrade(client, L, { trade_id: TID, op: 'force', action_id: ACT, reason: ' ' })
    expect(res).toStrictEqual({ status: 200, body: echo })
    expect(rpc).toHaveBeenCalledWith('commish_force_or_reverse_trade', { p_league_id: L, p_trade_id: TID, p_op: 'force', p_action_id: ACT })
    await commishTrade(client, L, { trade_id: TID, op: 'force', action_id: ACT, reason: 'he asked' })
    expect(rpc.mock.calls[1][1]).toStrictEqual({ p_league_id: L, p_trade_id: TID, p_op: 'force', p_reason: 'he asked', p_action_id: ACT })
  })

  it('the identity guard on the echoed op + trade + id (F65(b)); an unknown op is a 400', async () => {
    for (const bad of [{ ...echo, op: 'veto' }, { ...echo, trade_id: TA }, { ...echo, action_id: TID }, { ...echo, verb: 'x' }]) {
      const { client } = rpcClient({ data: bad, error: null })
      expect(await commishTrade(client, L, { trade_id: TID, op: 'force', action_id: ACT })).toStrictEqual({ status: 409, body: { error: TRADE_ACTION_ID_REUSED_MESSAGE } })
    }
    const { client, rpc } = rpcClient({ data: echo, error: null })
    expect((await commishTrade(client, L, { trade_id: TID, op: 'undo', action_id: ACT })).status).toBe(400)
    // 174 / D463 (Chris 2026-09-30, "Remove reverse"): reverse is no longer an op — refused before the wire.
    expect((await commishTrade(client, L, { trade_id: TID, op: 'reverse', action_id: ACT })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('the ops are approve / veto / force; the no-leak copy names only those (174)', () => {
    expect(COMMISH_TRADE_OPS).toStrictEqual(['approve', 'veto', 'force'])
    expect(COMMISH_TRADE_FORBIDDEN_MESSAGE).toBe('Only this league’s commissioner can approve, veto or force a trade.')
    expect(TRADE_PROPOSE_FORBIDDEN_MESSAGE).toBe('Only this team’s manager can offer a trade for it.')
    expect(TRADE_RESPOND_FORBIDDEN_MESSAGE).toBe('Only the two teams in this trade can answer it.')
  })

  it('42501 → 403 no-leak; P0001 → 409 with the refusal verbatim; 22023 → 400', async () => {
    const refusal = 'commish_force_or_reverse_trade: Vitest One is no longer on Team B — move him back first with commish_move_player'
    for (const [error, status, message] of [
      [{ code: '42501', message: 'commish_force_or_reverse_trade: not a commissioner of this league' }, 403, COMMISH_TRADE_FORBIDDEN_MESSAGE],
      [{ code: 'P0001', message: refusal }, 409, refusal],
      [{ code: '22023', message: 'commish_force_or_reverse_trade: the reason is 501 characters' }, 400, 'commish_force_or_reverse_trade: the reason is 501 characters'],
    ] as const) {
      const { client } = rpcClient({ data: null, error })
      expect(await commishTrade(client, L, { trade_id: TID, op: 'veto', action_id: ACT })).toStrictEqual({ status, body: { error: message } })
    }
  })
})

describe('isMissingSchemaObject — the deploy-before-push predicate, anchored by name', () => {
  it('matches PostgREST’s two schema-cache answers (as measured) and Postgres’s own for a trade object', () => {
    expect(isMissingSchemaObject({ code: 'PGRST205', message: "Could not find the table 'public.trades' in the schema cache" }, ['trades'])).toBe(true)
    expect(isMissingSchemaObject({ code: 'PGRST202', message: 'Could not find the function public.trade_vote(p_action_id, p_league_id, p_trade_id, p_vote) in the schema cache' }, ['trade_vote'])).toBe(true)
    expect(isMissingSchemaObject({ code: '42P01', message: 'relation "trades" does not exist' }, ['trades'])).toBe(true)
  })

  it('never matches another object, a prefix of a longer name, or another code', () => {
    expect(isMissingSchemaObject({ code: 'PGRST205', message: "Could not find the table 'public.trades_archive' in the schema cache" }, ['trades'])).toBe(false)
    expect(isMissingSchemaObject({ code: 'PGRST202', message: 'Could not find the function public.trade_vote_tally(p_trade_id) in the schema cache' }, ['trade_vote'])).toBe(false)
    expect(isMissingSchemaObject({ code: 'P0001', message: "Could not find the table 'public.trades'" }, ['trades'])).toBe(false)
    expect(isMissingSchemaObject(null, ['trades'])).toBe(false)
  })
})

describe('msUntil — the countdown at the server’s clock', () => {
  const now = new Date('2099-09-10T12:00:00.000Z')
  it('whole milliseconds to a future instant; 0 once it has passed; null for no instant or infinity', () => {
    expect(msUntil('2099-09-10T13:00:00+00:00', now)).toBe(3_600_000)
    expect(msUntil('2099-09-10T12:00:00+00:00', now)).toBe(0)
    expect(msUntil('2099-09-10T11:00:00+00:00', now)).toBe(0)
    expect(msUntil('infinity', now)).toBeNull()
    expect(msUntil(null, now)).toBeNull()
  })
})

describe('readTrades against a database without the trade tables (deploy before push)', () => {
  function chain(result: unknown) {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'order', 'in', 'or']) c[m] = () => c
    c.maybeSingle = async () => result
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return c
  }

  it('a member gets the named 503 — never a 500, never an empty list', async () => {
    const tables: Record<string, unknown> = {
      leagues: { data: { id: L, trade_review: 'commissioner', trade_deadline_week: 11, settings: {} }, error: null },
      league_members: { data: { team_id: TA }, error: null },
      teams: { data: [{ id: TA, name: 'A' }], error: null },
      trades: { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.trades' in the schema cache" } },
    }
    const client = {
      rpc: async (name: string) => ({ data: name === 'is_league_member' || name === 'is_league_commish' ? true : null, error: null }),
      from: (table: string) => chain(tables[table]),
    } as never
    expect(await readTrades(client, L, 'u', {}, new Date('2099-01-01T00:00:00Z'))).toStrictEqual({
      status: 503,
      body: { error: TRADES_UNAVAILABLE_MESSAGE },
    })
  })

  it('an unknown query key is a 400 before any read', async () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as never
    expect((await readTrades(client, L, 'u', { peek: 'x' }, new Date('2099-01-01T00:00:00Z'))).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// L.D3.12 — the deadline and the legality preview (162)
// ---------------------------------------------------------------------------

// As measured on the local stack (2026-09-29): PostgREST's answer for a
// function the schema cache does not have — the shape a database without
// 162 gives for each door, argument names sorted.
const DEADLINE_MISSING = { code: 'PGRST202', message: 'Could not find the function public.trade_deadline(p_league_id) in the schema cache' }
const PREVIEW_MISSING = {
  code: 'PGRST202',
  message: 'Could not find the function public.trade_preview(p_from_team_id, p_items, p_league_id, p_to_team_id) in the schema cache',
}

describe('readTradeDeadline (GET …/trades/deadline → trade_deadline, 162)', () => {
  it('passes the document through; asks with the league only', async () => {
    const view = { league_id: L, deadline_week: 7, deadline_at: '2026-10-28T04:00:00+00:00', passed: false }
    const { client, rpc } = rpcClient({ data: view, error: null })
    expect(await readTradeDeadline(client, L)).toStrictEqual({ status: 200, body: view })
    expect(rpc).toHaveBeenCalledWith('trade_deadline', { p_league_id: L })
  })
  it('before 162: the missing function is the named 503 (the screen falls back); 42501 is the no-leak 403; an empty answer is a loud 500', async () => {
    expect(await readTradeDeadline(rpcClient({ data: null, error: DEADLINE_MISSING }).client, L)).toStrictEqual({
      status: 503,
      body: { error: TRADE_CHECKS_UNAVAILABLE_MESSAGE },
    })
    expect(await readTradeDeadline(rpcClient({ data: null, error: { code: '42501', message: 'trade_deadline: not a member of this league' } }).client, L)).toStrictEqual({
      status: 403,
      body: { error: TRADE_CHECKS_FORBIDDEN_MESSAGE },
    })
    expect((await readTradeDeadline(rpcClient({ data: null, error: null }).client, L)).status).toBe(500)
  })
  it('the 503 is anchored on the door’s NAME — a longer name that starts the same is not "not pushed"', async () => {
    const other = { code: 'PGRST202', message: 'Could not find the function public.trade_deadline_read_internal(p_at, p_league_id) in the schema cache' }
    expect((await readTradeDeadline(rpcClient({ data: null, error: other }).client, L)).status).toBe(500)
  })
})

describe('previewTrade (POST …/trades/preview → trade_preview, 162)', () => {
  const offer = { from_team_id: TA, to_team_id: TB, items: [{ player_id: 'p1', from_team_id: TA }, { faab_amount: 5, from_team_id: TB }], drops: ['p2'] }
  it('OFFER: both teams, the legs and the offering team’s drops — nothing else', async () => {
    const { client, rpc } = rpcClient({ data: { ok: true }, error: null })
    expect(await previewTrade(client, L, offer)).toStrictEqual({ status: 200, body: { ok: true } })
    expect(rpc).toHaveBeenCalledWith('trade_preview', {
      p_league_id: L,
      p_from_team_id: TA,
      p_to_team_id: TB,
      p_items: offer.items,
      p_drops: ['p2'],
    })
  })
  it('ACCEPT: the trade only, plus the receiving team’s drops (omitted when none)', async () => {
    const { client, rpc } = rpcClient({ data: { ok: false }, error: null })
    await previewTrade(client, L, { trade_id: TID, drops: [] })
    expect(rpc).toHaveBeenCalledWith('trade_preview', { p_league_id: L, p_trade_id: TID })
    await previewTrade(client, L, { trade_id: TID, drops: ['p9'] })
    expect(rpc).toHaveBeenLastCalledWith('trade_preview', { p_league_id: L, p_trade_id: TID, p_drops: ['p9'] })
  })
  it('a malformed body is a 400 before the wire — both arms at once, a team with itself, no legs, an unknown key', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    for (const body of [
      { ...offer, trade_id: TID },
      { ...offer, to_team_id: TA },
      { ...offer, items: [] },
      { trade_id: TID, note: 'x' },
      null,
    ]) {
      expect((await previewTrade(client, L, body)).status).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
  })
  it('before 162: the missing function is the named 503; 42501 → 403 no-leak; P0001 (another league’s team / trade) → 409; 22023 → 400', async () => {
    const cases: Array<[RpcAnswer['error'], number, unknown]> = [
      [PREVIEW_MISSING, 503, TRADE_CHECKS_UNAVAILABLE_MESSAGE],
      [{ code: '42501', message: 'trade_preview: not a member of this league' }, 403, TRADE_CHECKS_FORBIDDEN_MESSAGE],
      [{ code: 'P0001', message: 'trade_preview: team x is not a franchise of league y' }, 409, 'trade_preview: team x is not a franchise of league y'],
      [{ code: '22023', message: 'trade_preview: trade leg {} must be …' }, 400, 'trade_preview: trade leg {} must be …'],
    ]
    for (const [error, status, message] of cases) {
      expect(await previewTrade(rpcClient({ data: null, error }).client, L, offer)).toStrictEqual({ status, body: { error: message } })
    }
  })
})

describe('isDoorNotPushed — R1282: "not pushed yet" only when the door is absent, never on argument drift', () => {
  // PostgREST's answers, measured on the local stack 2026-09-29 (162 applied).
  const DRIFT_WITH_HINT = {
    code: 'PGRST202',
    message: 'Could not find the function public.trade_deadline(p_bogus) in the schema cache',
    hint: 'Perhaps you meant to call the function public.trade_deadline(p_league_id)',
  }
  const DRIFT_NO_HINT = { code: 'PGRST202', message: 'Could not find the function public.trade_preview(p_bogus, p_league_id) in the schema cache', hint: null }
  const ABSENT_OTHER_HINT = {
    code: 'PGRST202',
    message: 'Could not find the function public.trade_deadline(p_league_id) in the schema cache',
    hint: 'Perhaps you meant to call the function public.trade_deadline_view_internal',
  }
  it('absent door (our own arguments, no same-name hint) → not pushed', () => {
    expect(isDoorNotPushed(DEADLINE_MISSING)).toBe(true)
    expect(isDoorNotPushed(PREVIEW_MISSING)).toBe(true)
    expect(isDoorNotPushed(ABSENT_OTHER_HINT)).toBe(true)
    expect(isDoorNotPushed({ code: '42883', message: 'function public.trade_preview(uuid) does not exist' })).toBe(true)
  })
  it('the door is there but the call drifted — a same-name hint, or an argument the door does not have → NOT "not pushed"', () => {
    expect(isDoorNotPushed(DRIFT_WITH_HINT)).toBe(false)
    expect(isDoorNotPushed(DRIFT_NO_HINT)).toBe(false)
    expect(isDoorNotPushed(null)).toBe(false)
    expect(isDoorNotPushed({ code: 'P0001', message: 'Could not find the function public.trade_preview(p_league_id)' })).toBe(false)
  })
  it('…so the routes answer a drifted call with a loud 500, not the quiet named 503', async () => {
    expect((await readTradeDeadline(rpcClient({ data: null, error: DRIFT_WITH_HINT }).client, L)).status).toBe(500)
    expect((await previewTrade(rpcClient({ data: null, error: DRIFT_NO_HINT }).client, L, { trade_id: TID })).status).toBe(500)
  })
})
