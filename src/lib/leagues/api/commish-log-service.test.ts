/**
 * commish-log-service.test.ts — the PURE half of the audit-log read (M6A
 * task L.E1.11; spec §15.4:1703, §10.3, §12.12; PROGRESS D351, R770):
 *
 *   - the CURSOR round-trips as ONE opaque token; a token that is not
 *     base64url, not JSON, not a `[instant, uuid]` pair — or is HALF a
 *     boundary — decodes to null and the service refuses it BY NAME (400 on
 *     `cursor`) before any read, never as "no cursor";
 *   - the query schema bounds the page far below PostgREST's cap and
 *     refuses an unknown key;
 *   - the read is GATED before the first `.from(` — a non-member's 403 is
 *     `assertLeagueMember`'s one no-leak copy and the table is never touched;
 *   - the page arithmetic: `has_more` from the over-fetch, `next_cursor`
 *     the LAST item's `(created_at, id)`, the boundary filter the activity
 *     feed's own composite predicate (imported, never re-derived).
 *
 * The live half (a member reads, a non-member cannot, the same-instant pair
 * split across two pages on the real table) is the stack suite.
 */
import { describe, expect, it, vi } from 'vitest'

import { activityCursorFilter } from './activity-service'
import {
  COMMISH_LOG_BAD_CURSOR_MESSAGE,
  COMMISH_LOG_DEFAULT_LIMIT,
  COMMISH_LOG_MAX_LIMIT,
  COMMISH_LOG_MAX_TYPES,
  COMMISH_LOG_UNKNOWN_ENTRY_MESSAGE,
  COMMISH_LOG_UNKNOWN_TEAM_MESSAGE,
  commishLogEntryFilter,
  commishLogQuerySchema,
  commishLogTeamFilter,
  decodeCommishLogCursor,
  encodeCommishLogCursor,
  readCommishLog,
} from './commish-log-service'
import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const T = '2026-09-16T14:03:00.123456+00:00'
const ID_A = 'aa000000-0000-4000-8000-00000000000a'
const ID_B = 'aa000000-0000-4000-8000-00000000000b'

describe('the opaque cursor', () => {
  it('round-trips the (created_at, id) tuple through ONE base64url token', () => {
    const token = encodeCommishLogCursor(T, ID_A)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/) // url-safe, no padding, no structural characters
    expect(decodeCommishLogCursor(token)).toStrictEqual({ before: T, beforeId: ID_A })
  })

  it('refuses garbage, non-JSON, a bare instant, a bare id, a wrong order, and a non-uuid id — each decodes to null, none to "no cursor"', () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    for (const token of [
      '!!!not-base64!!!',
      Buffer.from('{nope').toString('base64url'),
      b64(T), // the instant alone is NOT a page boundary (R770)
      b64([T]), // half a boundary
      b64([ID_A]),
      b64([ID_A, T]), // wrong order
      b64([T, 'not-a-uuid']),
      b64(['yesterday', ID_A]),
      b64({ before: T, before_id: ID_A }), // the activity feed's two-half shape is not this token
    ]) {
      expect(decodeCommishLogCursor(token), token).toBeNull()
    }
  })
})

describe('commishLogQuerySchema', () => {
  it('defaults the page size and coerces the string a query string delivers', () => {
    expect(commishLogQuerySchema.parse({})).toStrictEqual({ limit: COMMISH_LOG_DEFAULT_LIMIT })
    expect(commishLogQuerySchema.parse({ limit: '7' }).limit).toBe(7)
  })

  it('caps the page far below PostgREST’s 1000-row ceiling and refuses 0, a fraction and an unknown key', () => {
    expect(COMMISH_LOG_MAX_LIMIT).toBeLessThan(1000 / 2)
    expect(commishLogQuerySchema.safeParse({ limit: String(COMMISH_LOG_MAX_LIMIT + 1) }).success).toBe(false)
    expect(commishLogQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(commishLogQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false)
    expect(commishLogQuerySchema.safeParse({ bogus: '3' }).success).toBe(false)
  })
})

/** A client double: `rpc` answers the membership gate, `from` records the
 *  query chain and answers the read. */
function clientDouble(opts: { member: boolean; rows?: unknown[]; readError?: { message: string } }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const calls: Array<[string, unknown[]]> = []
  const query = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          const response = opts.readError ? { data: null, error: opts.readError } : { data: opts.rows ?? [], error: null }
          return (resolve: (v: unknown) => void) => resolve(response)
        }
        chain[prop] ??= vi.fn((...args: unknown[]) => {
          calls.push([prop, args])
          return query
        })
        return chain[prop]
      },
    },
  )
  const from = vi.fn((table: string) => (table ? query : query))
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'is_league_member') return { data: opts.member, error: null }
    throw new Error(`unexpected rpc ${fn}`)
  })
  // The soft-delete read inside assertLeagueMember goes through `from('leagues')`.
  const leaguesFrom = { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { id: LEAGUE }, error: null }) }) }) }) }
  const client = {
    rpc,
    from: (table: string) => (table === 'leagues' ? leaguesFrom : from(table)),
  }
  return { client: client as never, from, rpc, calls }
}

const row = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  action_type: 'edit_schedule',
  actor_id: 'ab000000-0000-4000-8000-000000000001',
  target_type: 'schedule',
  target_id: 'df000000-0000-4000-8000-000000000021',
  reason: null,
  before: { home_team_id: 'x' },
  after: { home_team_id: 'y' },
  metadata: { week: 3 },
  acting_as_team_id: null,
  reverts_action_id: null,
  created_at: createdAt,
  actor: { username: 'the_commish' },
  ...extra,
})

describe('readCommishLog', () => {
  it('a malformed cursor is a 400 on `cursor` BY NAME, before the membership gate and before any read', async () => {
    const { client, from, rpc } = clientDouble({ member: true })
    const res = await readCommishLog(client, LEAGUE, { cursor: 'not-a-token' })
    expect(res).toStrictEqual({ status: 400, body: { error: { fieldErrors: { cursor: [COMMISH_LOG_BAD_CURSOR_MESSAGE] } } } })
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('a NON-MEMBER gets the family’s one no-leak 403 and `commissioner_actions` is never read (R807) — the same answer a nonexistent league gives', async () => {
    const { client, from, rpc } = clientDouble({ member: false })
    const res = await readCommishLog(client, LEAGUE, {})
    expect(res).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    expect(rpc).toHaveBeenCalledWith('is_league_member', { p_league_id: LEAGUE })
    expect(from).not.toHaveBeenCalled()
  })

  it('a member reads the league’s rows newest-first over the (created_at DESC, id DESC) order, over-fetched by ONE; a NULL reason is rendered as null, never "null"', async () => {
    const { client, from, calls } = clientDouble({ member: true, rows: [row(ID_B, T), row(ID_A, T, { reason: 'trimmed reason' })] })
    const res = await readCommishLog(client, LEAGUE, { limit: '10' })
    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalledWith('commissioner_actions')
    expect(calls).toContainEqual(['eq', ['league_id', LEAGUE]])
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(calls).toContainEqual(['order', ['id', { ascending: false }]])
    expect(calls).toContainEqual(['limit', [11]])
    expect(calls.find(([m]) => m === 'or')).toBeUndefined() // no cursor ⇒ no boundary filter
    const body = res.body as { items: Array<{ id: string; reason: string | null; actor: { id: string; username: string | null } }>; has_more: boolean; next_cursor: string | null; limit: number }
    expect(body.limit).toBe(10)
    expect(body.has_more).toBe(false)
    expect(body.next_cursor).toBeNull()
    expect(body.items.map((i) => i.id)).toStrictEqual([ID_B, ID_A])
    expect(body.items[0].reason).toBeNull()
    expect(body.items[1].reason).toBe('trimmed reason')
    expect(body.items[0].actor).toStrictEqual({ id: 'ab000000-0000-4000-8000-000000000001', username: 'the_commish' })
    // C70: no field claims the verb ran.
    for (const item of body.items) {
      expect(Object.keys(item)).not.toContain('executed')
      expect(Object.keys(item)).not.toContain('applied')
    }
  })

  it('has_more comes from the OVER-FETCH and next_cursor is the LAST served item’s (created_at, id) — the row beyond the page is not served', async () => {
    const { client } = clientDouble({ member: true, rows: [row(ID_B, T), row(ID_A, T), row('aa000000-0000-4000-8000-000000000009', '2026-09-16T14:02:00+00:00')] })
    const res = await readCommishLog(client, LEAGUE, { limit: '2' })
    const body = res.body as { items: Array<{ id: string }>; has_more: boolean; next_cursor: string }
    expect(body.items.map((i) => i.id)).toStrictEqual([ID_B, ID_A])
    expect(body.has_more).toBe(true)
    expect(decodeCommishLogCursor(body.next_cursor)).toStrictEqual({ before: T, beforeId: ID_A })
  })

  it('a cursor becomes the activity feed’s composite boundary filter — created_at.lt.T OR (created_at.eq.T AND id.lt.ID), imported not re-derived', async () => {
    const { client, calls } = clientDouble({ member: true, rows: [] })
    const res = await readCommishLog(client, LEAGUE, { cursor: encodeCommishLogCursor(T, ID_A) })
    expect(res.status).toBe(200)
    expect(calls).toContainEqual(['or', [activityCursorFilter(T, ID_A)]])
    expect(activityCursorFilter(T, ID_A)).toContain('created_at.eq.')
  })

  it('a PostgREST error is a 500 with the driver’s message — never an empty log (rule 10)', async () => {
    const { client } = clientDouble({ member: true, readError: { message: 'relation exploded' } })
    expect(await readCommishLog(client, LEAGUE, {})).toStrictEqual({ status: 500, body: { error: 'relation exploded' } })
  })
})

// ---------------------------------------------------------------------------
// L.E1.32 — the filters (type / team_id / week; D455)
// ---------------------------------------------------------------------------

describe('commishLogQuerySchema — the L.E1.32 filters', () => {
  it('type: one slug or a comma-separated list, de-duplicated; a malformed slug, an empty list or more than the bound is refused', () => {
    expect(commishLogQuerySchema.parse({ type: 'edit_score' }).type).toStrictEqual(['edit_score'])
    expect(commishLogQuerySchema.parse({ type: 'edit_score,set_result,edit_score' }).type).toStrictEqual(['edit_score', 'set_result'])
    const tooMany = Array.from({ length: COMMISH_LOG_MAX_TYPES + 1 }, (_, i) => `t${i}`).join(',')
    for (const bad of ['Edit_Score', 'edit score', 'edit_score,', ',', 'edit-score', 'x'.repeat(65), tooMany]) {
      expect(commishLogQuerySchema.safeParse({ type: bad }).success, bad).toBe(false)
    }
  })

  it('team_id: a uuid, lower-cased (R768); anything else refused', () => {
    expect(commishLogQuerySchema.parse({ team_id: 'C1180051-0000-4000-8000-000000000002' }).team_id).toBe('c1180051-0000-4000-8000-000000000002')
    expect(commishLogQuerySchema.safeParse({ team_id: 'not-a-team' }).success).toBe(false)
  })

  it('week: the house week bound, 1–18, coerced from the query string', () => {
    expect(commishLogQuerySchema.parse({ week: '7' }).week).toBe(7)
    for (const bad of ['0', '19', '1.5', 'seven']) expect(commishLogQuerySchema.safeParse({ week: bad }).success, bad).toBe(false)
  })
})

const TEAM = 'c1180051-0000-4000-8000-000000000002'

/** A double that answers the team check and the log read separately and
 *  records each chain. */
function filterDouble(opts: { team?: 'of-this-league' | 'unknown' | 'error'; rows?: unknown[] }) {
  const calls: Array<[string, unknown[]]> = []
  const teamCalls: Array<[string, unknown[]]> = []
  const chainOf = (sink: Array<[string, unknown[]]>, answer: () => { data: unknown; error: unknown }) => {
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(answer())
          if (prop === 'maybeSingle') return async () => answer()
          return (...args: unknown[]) => {
            sink.push([prop, args])
            return proxy
          }
        },
      },
    )
    return proxy
  }
  const leaguesFrom = { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { id: LEAGUE }, error: null }) }) }) }) }
  const tables: string[] = []
  const client = {
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from: (table: string) => {
      tables.push(table)
      if (table === 'leagues') return leaguesFrom
      if (table === 'teams') {
        return chainOf(teamCalls, () =>
          opts.team === 'error'
            ? { data: null, error: { message: 'teams exploded' } }
            : { data: opts.team === 'unknown' ? null : { id: TEAM }, error: null },
        )
      }
      return chainOf(calls, () => ({ data: opts.rows ?? [], error: null }))
    },
  }
  return { client: client as never, calls, teamCalls, tables }
}

describe('readCommishLog — the L.E1.32 filters on the ordered read', () => {
  it('type ⇒ `action_type IN (…)`; week ⇒ `metadata->>week = N` (the week the verb recorded acting on); no team check without a team filter', async () => {
    const { client, calls, tables } = filterDouble({})
    const res = await readCommishLog(client, LEAGUE, { type: 'edit_score,set_result', week: '5' })
    expect(res.status).toBe(200)
    expect(calls).toContainEqual(['in', ['action_type', ['edit_score', 'set_result']]])
    expect(calls).toContainEqual(['eq', ['metadata->>week', '5']])
    expect(tables).not.toContain('teams')
    expect((res.body as { filters: unknown }).filters).toStrictEqual({ type: ['edit_score', 'set_result'], team_id: null, week: 5 })
  })

  it('team_id ⇒ checked to be a team of THIS league first, then the three places a receipt names a team, as one `or` tree', async () => {
    const { client, calls, teamCalls } = filterDouble({ team: 'of-this-league' })
    const res = await readCommishLog(client, LEAGUE, { team_id: TEAM.toUpperCase() })
    expect(res.status).toBe(200)
    expect(teamCalls).toContainEqual(['eq', ['id', TEAM]])
    expect(teamCalls).toContainEqual(['eq', ['league_id', LEAGUE]])
    expect(calls).toContainEqual(['or', [commishLogTeamFilter(TEAM)]])
    expect(commishLogTeamFilter(TEAM)).toBe(
      'acting_as_team_id.eq.' + TEAM + ',and(target_type.eq.team,target_id.eq.' + TEAM + '),metadata->affected_team_ids.cs.["' + TEAM + '"]',
    )
    expect((res.body as { filters: unknown }).filters).toStrictEqual({ type: null, team_id: TEAM, week: null })
  })

  it('a team filter and a cursor are TWO `or` trees on the one read (both sent — the stack suite proves PostgREST ANDs them)', async () => {
    const { client, calls } = filterDouble({ team: 'of-this-league' })
    await readCommishLog(client, LEAGUE, { team_id: TEAM, cursor: encodeCommishLogCursor(T, ID_A) })
    expect(calls.filter(([m]) => m === 'or').map(([, a]) => a[0])).toStrictEqual([activityCursorFilter(T, ID_A), commishLogTeamFilter(TEAM)])
  })

  it('another league’s (or an unknown) team is a 404 by name and the log is never read — never an empty log that says "nothing happened to it"', async () => {
    const { client, calls } = filterDouble({ team: 'unknown' })
    expect(await readCommishLog(client, LEAGUE, { team_id: TEAM })).toStrictEqual({ status: 404, body: { error: COMMISH_LOG_UNKNOWN_TEAM_MESSAGE } })
    expect(calls).toStrictEqual([])
    const failing = filterDouble({ team: 'error' })
    expect(await readCommishLog(failing.client, LEAGUE, { team_id: TEAM })).toStrictEqual({ status: 500, body: { error: 'teams: teams exploded' } })
  })

  it('no filter ⇒ none applied, and the page says so', async () => {
    const { client, calls } = filterDouble({})
    const res = await readCommishLog(client, LEAGUE, {})
    expect(calls.map(([m]) => m)).not.toContain('in')
    expect(calls.find(([m, a]) => m === 'eq' && a[0] === 'metadata->>week')).toBeUndefined()
    expect((res.body as { filters: unknown }).filters).toStrictEqual({ type: null, team_id: null, week: null })
  })
})

// ---------------------------------------------------------------------------
// L.E1.34 — `entry`: open the log AT a row (F233(d); D459)
// ---------------------------------------------------------------------------

const ENTRY = 'ca340000-0000-4000-8000-000000000034'
const ENTRY_AT = '2026-09-20T10:00:00.123456+00:00'

/** The entry lookup (first `commissioner_actions` chain) and the page read
 *  (second) answered and recorded separately. */
function entryDouble(opts: { entry: 'found' | 'unknown' | 'error'; rows?: unknown[] }) {
  const lookup: Array<[string, unknown[]]> = []
  const read: Array<[string, unknown[]]> = []
  let reads = 0
  const chainOf = (sink: Array<[string, unknown[]]>, answer: () => { data: unknown; error: unknown }) => {
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(answer())
          if (prop === 'maybeSingle') return async () => answer()
          return (...args: unknown[]) => {
            sink.push([prop, args])
            return proxy
          }
        },
      },
    )
    return proxy
  }
  const leaguesFrom = { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { id: LEAGUE }, error: null }) }) }) }) }
  const client = {
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from: (table: string) => {
      if (table === 'leagues') return leaguesFrom
      reads += 1
      if (reads === 1) {
        return chainOf(lookup, () =>
          opts.entry === 'error'
            ? { data: null, error: { message: 'lookup exploded' } }
            : { data: opts.entry === 'found' ? { id: ENTRY, created_at: ENTRY_AT } : null, error: null },
        )
      }
      return chainOf(read, () => ({ data: opts.rows ?? [], error: null }))
    },
  }
  return { client: client as never, lookup, read }
}

describe('readCommishLog — `entry` (L.E1.34): the page starts AT the entry and runs older', () => {
  it('the schema takes a uuid (lower-cased) and refuses anything else', () => {
    expect(commishLogQuerySchema.parse({ entry: ENTRY.toUpperCase() }).entry).toBe(ENTRY)
    expect(commishLogQuerySchema.safeParse({ entry: 'nope' }).success).toBe(false)
  })

  it('the boundary is the INCLUSIVE twin of the cursor: created_at < T OR (created_at = T AND id <= ID)', () => {
    expect(commishLogEntryFilter(ENTRY_AT, ENTRY)).toBe(`created_at.lt."${ENTRY_AT}",and(created_at.eq."${ENTRY_AT}",id.lte."${ENTRY}")`)
    expect(commishLogEntryFilter(ENTRY_AT, ENTRY)).not.toBe(activityCursorFilter(ENTRY_AT, ENTRY)) // lte, not lt — the entry itself is served
  })

  it('an entry of THIS league: looked up by id AND league, then the read carries the boundary; the page echoes it', async () => {
    const { client, lookup, read } = entryDouble({ entry: 'found' })
    const res = await readCommishLog(client, LEAGUE, { entry: ENTRY })
    expect(res.status).toBe(200)
    expect(lookup).toContainEqual(['eq', ['id', ENTRY]])
    expect(lookup).toContainEqual(['eq', ['league_id', LEAGUE]])
    expect(read).toContainEqual(['or', [commishLogEntryFilter(ENTRY_AT, ENTRY)]])
    expect((res.body as { filters: unknown }).filters).toStrictEqual({ type: null, team_id: null, week: null, entry: ENTRY })
  })

  it('with a later page’s cursor, both boundaries are sent (the stricter cursor wins — two ANDed trees)', async () => {
    const { client, read } = entryDouble({ entry: 'found' })
    await readCommishLog(client, LEAGUE, { entry: ENTRY, cursor: encodeCommishLogCursor(T, ID_A) })
    expect(read.filter(([m]) => m === 'or').map(([, a]) => a[0])).toStrictEqual([activityCursorFilter(T, ID_A), commishLogEntryFilter(ENTRY_AT, ENTRY)])
  })

  it('another league’s (or an unknown) entry is a 404 by name and the log is never read — never the top of the log as if it were there', async () => {
    const unknown = entryDouble({ entry: 'unknown' })
    expect(await readCommishLog(unknown.client, LEAGUE, { entry: ENTRY })).toStrictEqual({ status: 404, body: { error: COMMISH_LOG_UNKNOWN_ENTRY_MESSAGE } })
    expect(unknown.read).toStrictEqual([])
    const failing = entryDouble({ entry: 'error' })
    expect(await readCommishLog(failing.client, LEAGUE, { entry: ENTRY })).toStrictEqual({ status: 500, body: { error: 'commissioner_actions: lookup exploded' } })
  })
})
