/**
 * activity-service.test.ts — the feed's PURE halves: the query surface and
 * the two-stream merge (M4 task L.D4.2; spec §13.4/§15.3).
 *
 * `transactions-api-db.test.ts` drives the whole read over the real stack.
 * What lives here is the arithmetic a stack suite proves only by accident:
 * the paging over a UNION of two streams, where an off-by-one silently drops
 * an event and every assertion still looks green because the feed is
 * *plausible*. That is the failure CLAUDE.md's "never let 'nothing happened'
 * mean 'it worked'" rule is about, one layer up.
 *
 * **R770 made that claim true rather than aspirational.** This header used to
 * promise cursor coverage the file did not have: the tie test proved the
 * merge was DETERMINISTIC at a shared instant, never that a tied item
 * SURVIVES the page boundary — and it did not. The cursor was `created_at`
 * alone against a `(created_at DESC, id DESC)` order, so every item sharing
 * the boundary instant was served on no page at all. The composite-cursor
 * cells below are the missing half, and `transactions-api-db.test.ts` walks
 * the same two-row tie over the real PostgREST wire.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  STAT_CORRECTION_POST_PREFIX,
  statCorrectionPostWeek,
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  NOT_TRADE_COMPLETED_POST_FILTER,
  TRADE_COMPLETED_POST_PREFIX,
  TRADE_TRANSACTIONS_FILTER,
  TRADE_VOTE_VETO_POST_PREFIX,
  activityCursorFilter,
  activityQuerySchema,
  attachReceipts,
  instantMicros,
  mergeActivity,
  readActivity,
  vetoReceiptPost,
  type SystemActivityItem,
  type TransactionActivityItem,
} from './activity-service'

function txn(id: string, createdAt: string | null): TransactionActivityItem {
  return {
    kind: 'transaction',
    id,
    created_at: createdAt,
    type: 'add_drop',
    status: 'complete',
    week: 1,
    team_id: null,
    actor_id: null,
    action_id: null,
    payload: {},
  }
}

function post(id: string, createdAt: string | null): SystemActivityItem {
  return {
    kind: 'system',
    id,
    created_at: createdAt,
    context: 'league',
    message: 'Schedule remixed',
    actor_id: null,
    topic: null,
    week: null,
  }
}

describe('activityQuerySchema — the filters are validated, never silently dropped', () => {
  it('defaults to the whole feed at the default page size', () => {
    const parsed = activityQuerySchema.parse({})
    expect(parsed).toMatchObject({ kind: 'all', limit: ACTIVITY_DEFAULT_LIMIT })
    expect(parsed.type).toBeUndefined()
  })

  it('coerces the string values a query string actually delivers', () => {
    const parsed = activityQuerySchema.parse({ week: '7', limit: '10' })
    expect(parsed.week).toBe(7)
    expect(parsed.limit).toBe(10)
  })

  it('splits a csv `type` into the §12.9 vocabulary', () => {
    expect(activityQuerySchema.parse({ type: 'add_drop, trade' }).type).toEqual([
      'add_drop',
      'trade',
    ])
  })

  it('REFUSES a type outside §12.9 rather than widening the feed', () => {
    // The failure this prevents: an unknown value silently dropped from the
    // `in` list, so the caller's filter matches everything.
    expect(activityQuerySchema.safeParse({ type: 'add_drop,promotion' }).success).toBe(false)
    expect(activityQuerySchema.safeParse({ type: '' }).success).toBe(false)
  })

  it('caps the page size far below PostgREST\'s 1000-row ceiling', () => {
    expect(ACTIVITY_MAX_LIMIT).toBeLessThan(1000)
    // …and the over-fetch of limit+1 still cannot reach it.
    expect(ACTIVITY_MAX_LIMIT + 1).toBeLessThan(1000)
    expect(activityQuerySchema.safeParse({ limit: String(ACTIVITY_MAX_LIMIT + 1) }).success).toBe(
      false,
    )
    expect(activityQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
  })

  it('refuses an unrecognized query key instead of ignoring it', () => {
    expect(activityQuerySchema.safeParse({ kinds: 'system' }).success).toBe(false)
  })

  it('requires a real instant for the cursor', () => {
    expect(activityQuerySchema.safeParse({ before: '2026-09-03T12:00:00Z' }).success).toBe(true)
    expect(activityQuerySchema.safeParse({ before: 'yesterday' }).success).toBe(false)
  })

  it('takes the composite cursor, and refuses an id WITHOUT its instant (R770)', () => {
    const id = 'af700000-0000-4000-8000-000000000011'
    expect(
      activityQuerySchema.safeParse({ before: '2026-09-03T12:00:00Z', before_id: id }).success,
    ).toBe(true)
    // A lone `before_id` is not a narrower cursor, it is a MEANINGLESS one —
    // and quietly dropping it would page as if no cursor had been sent.
    const lone = activityQuerySchema.safeParse({ before_id: id })
    expect(lone.success).toBe(false)
    expect(JSON.stringify(lone.error)).toContain('before_id')
    expect(activityQuerySchema.safeParse({ before: '2026-09-03T12:00:00Z', before_id: 'x' }).success).toBe(
      false,
    )
  })
})

describe('activityCursorFilter — the page boundary, as PostgREST spells it (R770)', () => {
  const T = '2026-09-01T10:00:00.123456+00:00'
  const ID = 'af700000-0000-4000-8000-000000000011'

  it('is the exact INVERSE of the (created_at DESC, id DESC) sort', () => {
    // Verified on the wire against local PostgREST before it was written:
    // with two rows sharing T, `created_at.lt.T` alone serves NEITHER on the
    // next page; this filter serves the one with the smaller id.
    expect(activityCursorFilter(T, ID)).toBe(
      `created_at.lt."${T}",and(created_at.eq."${T}",id.lt."${ID}")`,
    )
  })

  it('quotes both values — a timestamptz carries `.`, `:` and `+`, all structural here', () => {
    const filter = activityCursorFilter(T, ID)
    expect(filter).toContain(`"${T}"`)
    expect(filter).toContain(`"${ID}"`)
    // The comma at the top level separates the two OR arms; the `and(...)`
    // arm keeps its own parentheses.
    expect(filter.split('),').length).toBe(1)
    expect(filter.endsWith(')')).toBe(true)
  })
})

describe('mergeActivity — the two streams interleave by instant, newest first', () => {
  const t1 = txn('t1', '2026-09-01T10:00:00+00:00')
  const t2 = txn('t2', '2026-09-01T12:00:00+00:00')
  const p1 = post('p1', '2026-09-01T11:00:00+00:00')
  const p2 = post('p2', '2026-09-01T13:00:00+00:00')

  it('interleaves rather than concatenating', () => {
    const feed = mergeActivity([t2, t1], [p2, p1], 10)
    expect(feed.items.map((i) => i.id)).toEqual(['p2', 't2', 'p1', 't1'])
    expect(feed.has_more).toBe(false)
    expect(feed.next_before).toBeNull()
    expect(feed.next_before_id).toBeNull()
  })

  it('reports has_more from the OVER-FETCH, never from a short page', () => {
    // Both streams were fetched at limit+1 = 3; the union of 4 exceeds the
    // page of 3, so there is provably more. `next_before` is the last
    // RETURNED item's instant, so the next page resumes exactly there.
    const feed = mergeActivity([t2, t1], [p2, p1], 3)
    expect(feed.items.map((i) => i.id)).toEqual(['p2', 't2', 'p1'])
    expect(feed.has_more).toBe(true)
    expect(feed.next_before).toBe('2026-09-01T11:00:00+00:00')
    // BOTH halves — the instant alone is not a page boundary (R770).
    expect(feed.next_before_id).toBe('p1')
  })

  it('a full page with nothing beyond it is NOT has_more', () => {
    const feed = mergeActivity([t2], [p2], 2)
    expect(feed.items).toHaveLength(2)
    expect(feed.has_more).toBe(false)
  })

  it('an empty feed is empty, not a lie about there being more', () => {
    expect(mergeActivity([], [], 25)).toEqual({
      items: [],
      limit: 25,
      has_more: false,
      next_before: null,
      next_before_id: null,
    })
  })

  it('ties break on id, deterministically — the same page twice is the same page', () => {
    const a = txn('aaa', '2026-09-01T10:00:00+00:00')
    const b = post('bbb', '2026-09-01T10:00:00+00:00')
    expect(mergeActivity([a], [b], 10).items.map((i) => i.id)).toEqual(['bbb', 'aaa'])
    expect(mergeActivity([a], [b], 10).items.map((i) => i.id)).toEqual(['bbb', 'aaa'])
  })

  it('SPLITS a same-instant pair across two pages instead of dropping one (R770)', () => {
    // The reviewer's reproduction, as a fixture: two rows written in one
    // transaction share `now()`. Page 1 (limit 1) returns 'bbb' and the
    // cursor MUST name it, or page 2 — filtered `created_at < T` — drops
    // 'aaa' from every page there will ever be. Determinism at the tie
    // (above) is a different claim and was the only one this file made.
    const tie = '2026-09-01T10:00:00+00:00'
    const a = txn('aaa', tie)
    const b = post('bbb', tie)

    const page1 = mergeActivity([a], [b], 1)
    expect(page1.items.map((i) => i.id)).toEqual(['bbb'])
    expect(page1.has_more).toBe(true)
    expect(page1.next_before).toBe(tie)
    expect(page1.next_before_id).toBe('bbb')

    // The cursor the service turns that into: everything older than the
    // instant, PLUS anything at the instant with a smaller id. 'aaa' < 'bbb'.
    expect(activityCursorFilter(page1.next_before!, page1.next_before_id!)).toContain(
      `and(created_at.eq."${tie}",id.lt."bbb")`,
    )
    // …and the instant-only cursor the feed used to emit would have excluded
    // 'aaa' from page 2 (`created_at < tie` is false for it).
    expect(Date.parse(a.created_at!) < Date.parse(page1.next_before!)).toBe(false)
  })

  it('a NULL created_at sorts LAST — never as the newest event', () => {
    // Both columns are DEFAULT NOW() but nullable. A naive comparator turns
    // NULL into 0 or NaN; either one puts a mystery row at the top of the
    // feed, which is the most visible surface in the league.
    const orphan = txn('nul', null)
    const feed = mergeActivity([t2, orphan], [p1], 10)
    expect(feed.items.map((i) => i.id)).toEqual(['t2', 'p1', 'nul'])
  })

  it('an unparseable created_at is treated like NULL, not like NaN', () => {
    const bad = txn('bad', 'not-a-timestamp')
    const feed = mergeActivity([t2, bad], [], 10)
    expect(feed.items.map((i) => i.id)).toEqual(['t2', 'bad'])
  })
})

// ---------------------------------------------------------------------------
// M6 L.E2.3 — a stat correction's league post is TAGGED in the feed
// ---------------------------------------------------------------------------

describe('the stat-correction league post is tagged (L.E2.3; D453(4) / D454)', () => {
  it('the prefix is the scoring door\'s own literal — the feed and migration 172 cannot part', () => {
    const sql = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/172_league_stat_corrections.sql'), 'utf8')
    expect(sql).toContain(`v_post := '${STAT_CORRECTION_POST_PREFIX}' || p_week || '): '`)
    // …and it writes the post with NO actor — the second marker (R1349).
    expect(sql).toContain("VALUES (p_league_id, NULL, v_post, 'league', TRUE);")
  })

  it('reads the week from the DOOR\'s post — the prefix and no actor (its real sentence, stack LC3) — and nothing from any other post', () => {
    expect(
      statCorrectionPostWeek(
        "Stat correction (Week 1): Lou Receiver's receiving yards 100 → 94 — Team One 10.00 → 9.40. Result changed: Team Two now beats Team One 9.80–9.40.",
        null,
      ),
    ).toBe(1)
    expect(statCorrectionPostWeek('Stat correction (Week 14): X', null)).toBe(14)
    expect(statCorrectionPostWeek('Schedule remixed by the commissioner.', null)).toBeNull()
    // Anchored at the start and on the full shape — a post that merely mentions one is not one.
    expect(statCorrectionPostWeek('Commissioner note: Stat correction (Week 3): pending', null)).toBeNull()
    expect(statCorrectionPostWeek('Stat correction (Week three): X', null)).toBeNull()
    expect(statCorrectionPostWeek('Stat correction (Week 3) X', null)).toBeNull()
  })

  it('R1349: the prefix WITH an actor stays untagged — the door writes user_id NULL, every commissioner post its actor', () => {
    expect(statCorrectionPostWeek("Stat correction (Week 1): Lou Receiver's receiving yards 100 → 94 — Team One 10.00 → 9.40.", 'commish-uid')).toBeNull()
  })

  it('R1349: the reviewer\'s rename scenario — a team named "Stat correction (Week 3): …" cannot plant a week through the commissioner posts that open with a team name', () => {
    const spoof = 'Stat correction (Week 3): Team Two 99.00 → 120.00'
    // 170:2423 the rename (opens with the OLD name); 147:293 FAAB; 139:439 autopilot; 169:1052 the retire — each writes auth.uid().
    for (const post of [
      `${spoof} is now Team Two — renamed by Commish (commissioner override)`,
      `${spoof}'s FAAB balance is now $5 (was $100) — set by Commish (commissioner override)`,
      `${spoof} is now on autopilot — set by Commish (commissioner override)`,
      `${spoof} was retired by Commish — the vacant franchise is sealed under its last manager`,
    ]) {
      expect(statCorrectionPostWeek(post, 'commish-uid'), post).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// L.E1.34 — one line per trade (Q84 / F463), the Trades topic, the week's
// correction posts (F532), each item's receipt (F233(d)); PROGRESS D459
// ---------------------------------------------------------------------------

const MIGRATION = (file: string) => readFileSync(path.resolve(process.cwd(), 'supabase/migrations', file), 'utf8')

describe('the literals the feed filters on are the migrations’ own (they cannot part)', () => {
  it('"Trade completed: " — every path that executes a trade writes it with NO actor, beside its transactions row (151 / 153 / 156)', () => {
    for (const file of ['151_trade_execution.sql', '153_week_ceiling.sql', '156_commish_force_or_reverse_trade.sql']) {
      const sql = MIGRATION(file)
      expect(sql, file).toContain(`v_post := '${TRADE_COMPLETED_POST_PREFIX}' || v_summary;`)
      expect(sql, file).toMatch(/INSERT INTO public\.transactions \(id, league_id, type, status, initiator_team_id, initiated_by, payload, week\)\s+VALUES \(v_txn_id, v_league\.id, 'trade', 'complete'/)
      expect(sql, file).toContain("VALUES (v_league.id, NULL, v_post, 'league', TRUE);")
    }
  })

  it('"Trade vetoed by league vote: " — 155’s post, no actor; the commissioner’s veto post is worded as 156 words it', () => {
    const vote = MIGRATION('155_trade_league_vote.sql')
    expect(vote).toContain(`v_post := '${TRADE_VOTE_VETO_POST_PREFIX}' || v_summary;`)
    expect(vote).toContain("VALUES (p_league.id, NULL, v_post, 'league', TRUE);")
    const force = MIGRATION('156_commish_force_or_reverse_trade.sql')
    expect(force).toContain("WHEN 'vetoed'            THEN 'vetoed a trade'")
    expect(force).toContain("v_message := public.draft_actor_name() || ' (commissioner) ' || v_act_text || ': ' || v_summary")
    expect(force).toContain("|| CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;")
  })

  it('the filter strings', () => {
    expect(NOT_TRADE_COMPLETED_POST_FILTER).toBe('user_id.not.is.null,message.not.like."Trade completed: *"')
    expect(TRADE_TRANSACTIONS_FILTER).toBe('type.eq.trade,and(type.eq.commissioner_move,payload->>kind.eq.trade_reversal)')
  })
})

describe('activityQuerySchema — `topic` (L.E1.34)', () => {
  it('trades is a topic; it stands alone — beside a type, a week or a team it is refused by name', () => {
    expect(activityQuerySchema.parse({ topic: 'trades' }).topic).toBe('trades')
    expect(activityQuerySchema.safeParse({ topic: 'offers' }).success).toBe(false)
    for (const extra of [{ type: 'trade' }, { week: '3' }, { team_id: 'aa000000-0000-4000-8000-000000000001' }]) {
      const parsed = activityQuerySchema.safeParse({ topic: 'trades', ...extra })
      expect(parsed.success, JSON.stringify(extra)).toBe(false)
      expect(JSON.stringify(parsed.error)).toContain('a topic can’t be combined')
    }
  })
})

describe('attachReceipts — each item’s receipt, by the instant its transaction wrote (pure)', () => {
  const T0 = '2099-09-10T12:00:00.123456+00:00'
  const T1 = '2099-09-10T12:00:00.123457+00:00' // one microsecond later — a different transaction
  const actorPost = (id: string, at: string, actor: string | null): SystemActivityItem => ({ ...post(id, at), actor_id: actor })

  it('a post takes the receipt ITS actor wrote at its instant; another actor’s receipt at the same instant is not its', () => {
    const [mine, theirs] = attachReceipts([actorPost('p1', T0, 'u1'), actorPost('p2', T0, 'u9')], new Map(), [{ id: 'ca1', actor_id: 'u1', created_at: T0 }])
    expect(mine.commish_action_id).toBe('ca1')
    expect(theirs.commish_action_id).toBeNull()
  })

  it('a post nobody wrote takes none, even at a receipt’s instant; a microsecond apart is another transaction', () => {
    const [nobody, later] = attachReceipts([actorPost('p1', T0, null), actorPost('p2', T1, 'u1')], new Map(), [{ id: 'ca1', actor_id: 'u1', created_at: T0 }])
    expect(nobody.commish_action_id).toBeNull()
    expect(later.commish_action_id).toBeNull()
  })

  it('a transaction takes its own related_action_id first, else the receipt at its instant (a trade executed inside a force)', () => {
    const [rev, forced, plain] = attachReceipts(
      [txn('t-rev', T0), txn('t-forced', T0), txn('t-plain', T1)],
      new Map([
        ['t-rev', 'ca-rel'],
        ['t-forced', null],
        ['t-plain', null],
      ]),
      [{ id: 'ca-at', actor_id: 'u1', created_at: T0 }],
    )
    expect(rev.commish_action_id).toBe('ca-rel')
    expect(forced.commish_action_id).toBe('ca-at')
    expect(plain.commish_action_id).toBeNull()
  })
})

describe('R1393 — the merge orders to the MICROSECOND (the boundary the next read sends is compared at µs)', () => {
  it('instantMicros: the fraction padded to 6 digits; no fraction, a Z, an offset; NULL / garbage sort last', () => {
    const base = Date.parse('2099-09-10T12:00:00Z') * 1000
    expect(instantMicros('2099-09-10T12:00:00.123456+00:00')).toBe(base + 123456)
    expect(instantMicros('2099-09-10T12:00:00.1234+00:00')).toBe(base + 123400) // PostgREST drops trailing zeros
    expect(instantMicros('2099-09-10T12:00:00.5Z')).toBe(base + 500000)
    expect(instantMicros('2099-09-10T12:00:00Z')).toBe(base)
    expect(instantMicros('2099-09-10T14:00:00.000001+02:00')).toBe(base + 1)
    expect(instantMicros(null)).toBe(Number.NEGATIVE_INFINITY)
    expect(instantMicros('not a time')).toBe(Number.NEGATIVE_INFINITY)
  })

  it('the reviewer’s demo: two streams inside ONE millisecond — the newer row is served first, so the cut cannot skip it', () => {
    // A transaction at .123400 with the LARGER id, a post at .123900. Ordered by
    // the millisecond, the id tie-break served the transaction and cut there; the
    // next read (created_at < .1234 at µs) could never return the .1239 post.
    const older = txn('ffffffff-0000-4000-8000-000000000001', '2099-09-10T12:00:00.1234+00:00')
    const newer = post('00000000-0000-4000-8000-000000000001', '2099-09-10T12:00:00.1239+00:00')
    const page1 = mergeActivity([older], [newer], 1)
    expect(page1.items.map((i) => i.id)).toStrictEqual([newer.id])
    expect([page1.next_before, page1.next_before_id]).toStrictEqual([newer.created_at, newer.id])
    // …and the next page (what the database returns under that boundary) serves the transaction.
    expect(mergeActivity([older], [], 1).items.map((i) => i.id)).toStrictEqual([older.id])
  })
})

describe('mergeActivity — a third stream (the Trades tab’s vetoes) cuts at the same boundary', () => {
  it('interleaves by instant and counts toward has_more like the others', () => {
    const veto = vetoReceiptPost({ id: 'v1', created_at: '2099-09-10T12:30:00Z', actor_id: 'u1', reason: null, metadata: { summary: 'S' }, actor: { username: 'chris' } })
    const feed = mergeActivity([txn('a', '2099-09-10T12:00:00Z')], [post('b', '2099-09-10T13:00:00Z')], 2, [veto])
    expect(feed.items.map((i) => i.id)).toStrictEqual(['b', 'v1'])
    expect(feed.has_more).toBe(true)
  })

  it('the veto line reads as 156’s post reads — the reason only when one was given', () => {
    const base = { id: 'v1', created_at: '2099-09-10T12:30:00Z', actor_id: 'u1', metadata: { summary: 'Alpha gives A; Bravo gives B' }, actor: { username: 'chris' } }
    expect(vetoReceiptPost({ ...base, reason: null }).message).toBe('chris (commissioner) vetoed a trade: Alpha gives A; Bravo gives B')
    expect(vetoReceiptPost({ ...base, reason: 'lopsided' }).message).toBe('chris (commissioner) vetoed a trade: Alpha gives A; Bravo gives B — reason: lopsided')
    expect(vetoReceiptPost({ ...base, reason: null }).commish_action_id).toBe('v1')
  })
})

/** A double that records each table's chains and answers per table, in order. */
function feedDouble(answers: Record<string, Array<{ data: unknown; error: unknown }>>) {
  const chains: Record<string, Array<Array<[string, unknown[]]>>> = {}
  const client = {
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      if (table === 'leagues') {
        return { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { id: 'L' }, error: null }) }) }) }) }
      }
      const sink: Array<[string, unknown[]]> = []
      ;(chains[table] ??= []).push(sink)
      const answer = answers[table]?.shift() ?? { data: [], error: null }
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(answer)
            return (...args: unknown[]) => {
              sink.push([prop, args])
              return proxy
            }
          },
        },
      )
      return proxy
    },
  }
  return { client: client as never, chains }
}

describe('readActivity — what each read asks for (L.E1.34)', () => {
  const AT = '2099-09-10T12:00:00.123456+00:00'

  it('every read drops the executed trade’s post in SQL (one line per trade), and names each item’s receipt from ONE read of the page’s instants', async () => {
    const { client, chains } = feedDouble({
      transactions: [{ data: [{ id: 'tx', created_at: AT, type: 'trade', status: 'complete', week: 3, initiator_team_id: null, initiated_by: 'u2', action_id: null, related_action_id: null, payload: {} }], error: null }],
      league_chat: [{ data: [{ id: 'p1', created_at: AT, context: 'league', message: 'chris (commissioner) forced a trade through: S', user_id: 'u1' }], error: null }],
      commissioner_actions: [{ data: [{ id: 'ca-force', actor_id: 'u1', created_at: AT }], error: null }],
    })
    const res = await readActivity(client, 'L', {})
    expect(res.status).toBe(200)
    expect(chains.league_chat[0]).toContainEqual(['or', [NOT_TRADE_COMPLETED_POST_FILTER]])
    expect(chains.transactions[0]).toContainEqual(['select', ['id, created_at, type, status, week, initiator_team_id, initiated_by, action_id, related_action_id, payload']])
    expect(chains.commissioner_actions).toHaveLength(1)
    expect(chains.commissioner_actions[0]).toContainEqual(['in', ['created_at', [AT]]])
    const items = (res.body as { items: Array<{ id: string; commish_action_id: string | null }> }).items
    expect(items.map((i) => [i.id, i.commish_action_id])).toStrictEqual([
      ['tx', 'ca-force'],
      ['p1', 'ca-force'],
    ])
  })

  it('topic=trades: trade + reversal rows, the league vote’s veto post, the commissioner’s vetoes from the log', async () => {
    const { client, chains } = feedDouble({})
    const res = await readActivity(client, 'L', { topic: 'trades' })
    expect(res.status).toBe(200)
    expect(chains.transactions[0]).toContainEqual(['or', [TRADE_TRANSACTIONS_FILTER]])
    expect(chains.league_chat[0]).toContainEqual(['is', ['user_id', null]])
    expect(chains.league_chat[0]).toContainEqual(['like', ['message', `${TRADE_VOTE_VETO_POST_PREFIX}*`]])
    expect(chains.commissioner_actions[0]).toContainEqual(['eq', ['action_type', 'veto_trade']])
  })

  it('F532: a week keeps THAT week’s stat-correction posts (the door’s — no actor, its literal); a type or team still drops every post', async () => {
    const week = feedDouble({})
    await readActivity(week.client, 'L', { week: '3' })
    expect(week.chains.league_chat[0]).toContainEqual(['is', ['user_id', null]])
    expect(week.chains.league_chat[0]).toContainEqual(['like', ['message', 'Stat correction (Week 3): *']])
    expect(week.chains.transactions[0]).toContainEqual(['eq', ['week', 3]])
    const typed = feedDouble({})
    await readActivity(typed.client, 'L', { type: 'add_drop', week: '3' })
    expect(typed.chains.league_chat).toBeUndefined()
  })

  it('a failed receipt read is a 500 by name — never items quietly missing their ✸ links', async () => {
    const { client } = feedDouble({
      league_chat: [{ data: [{ id: 'p1', created_at: AT, context: 'league', message: 'x', user_id: 'u1' }], error: null }],
      commissioner_actions: [{ data: null, error: { message: 'boom' } }],
    })
    expect(await readActivity(client, 'L', {})).toStrictEqual({ status: 500, body: { error: 'Something went wrong — try again.' } })
  })
})
