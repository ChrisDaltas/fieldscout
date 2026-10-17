/**
 * POST /api/lists and PATCH /api/lists/[id] — tiers without numbers
 * (`ranking_mode = 'tier_only'`, migration 191, Chris 2026-10-15).
 *
 * Pinned here:
 *   1. The API accepts the fourth mode and writes the legacy flag pair with
 *      it: hide_order = true (no numbers), tiers_enabled = true (tiers).
 *      A legacy client sending only that pair gets the same mode.
 *   2. Before 191 is pushed the database's older CHECK refuses the value
 *      (23514 naming `lists_ranking_mode_check`): a clear 409 with a code,
 *      never a 500. Other 23514s — the private-list cap's trigger — and any
 *      other error keep their own answers.
 *   3. A Big Board can't lose its numbers this way either.
 *
 * The Supabase server client is faked with a chainable builder that records
 * each insert/update payload and answers the write with `h.writeError`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  type Result = { data: unknown; error: { code: string; message: string } | null }

  const OWNER = '11111111-1111-4111-8111-111111111111'
  const LIST_ID = '22222222-2222-4222-8222-222222222222'

  const state = {
    inserts: [] as Row[],
    updates: [] as Row[],
    writeError: null as { code: string; message: string } | null,
    /** The PATCH route's ownership read. */
    existing: {
      id: LIST_ID,
      owner_id: OWNER,
      is_big_board: false,
      slug: 'my-list',
      title: 'My list',
      is_private: false,
    },
  }

  interface Builder extends PromiseLike<Result> {
    select: () => Builder
    eq: () => Builder
    is: () => Builder
    like: () => Builder
    insert: (row: Row) => Builder
    update: (row: Row) => Builder
    single: () => Promise<Result>
    maybeSingle: () => Promise<Result>
  }

  const builder = (): Builder => {
    let written: Row | null = null
    const b: Builder = {
      select: () => b,
      eq: () => b,
      is: () => b,
      like: () => b,
      insert: (row) => {
        written = row
        state.inserts.push(row)
        return b
      },
      update: (row) => {
        written = row
        state.updates.push(row)
        return b
      },
      single: async () =>
        state.writeError
          ? { data: null, error: state.writeError }
          : { data: { id: LIST_ID, owner_id: OWNER, ...written }, error: null },
      maybeSingle: async () => ({ data: state.existing, error: null }),
      // `generateUniqueSlug` awaits the builder itself: no slug is taken.
      then: (onFulfilled, onRejected) =>
        Promise.resolve<Result>({ data: [], error: null }).then(onFulfilled, onRejected),
    }
    return b
  }

  return { state, OWNER, LIST_ID, builder }
})

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.OWNER } } }) },
    from: () => h.builder(),
  }),
}))

import { PATCH } from './[id]/route'
import { POST } from './route'

/** What a pre-191 database answers a tier-only write with (Postgres's own
 *  text, passed through by PostgREST — measured by pgTAP 140 against the
 *  older CHECK). */
const OLD_CHECK = {
  code: '23514',
  message: 'new row for relation "lists" violates check constraint "lists_ranking_mode_check"',
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

function patch(body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/lists/${h.LIST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: h.LIST_ID }) },
  )
}

beforeEach(() => {
  h.state.inserts = []
  h.state.updates = []
  h.state.writeError = null
  h.state.existing = { ...h.state.existing, is_big_board: false }
})

describe('POST /api/lists — tiers without numbers', () => {
  it('stores tier_only with hide_order and tiers_enabled both on', async () => {
    const res = await post({ title: 'Tiered, no numbers', ranking_mode: 'tier_only' })
    expect(res.status).toBe(201)
    expect(h.state.inserts).toHaveLength(1)
    expect(h.state.inserts[0]).toMatchObject({ ranking_mode: 'tier_only', hide_order: true, tiers_enabled: true })
  })

  it('the three older modes keep their flag pairs', async () => {
    await post({ title: 'a', ranking_mode: 'unranked' })
    await post({ title: 'b', ranking_mode: 'ranked' })
    await post({ title: 'c', ranking_mode: 'rank_and_tier' })
    expect(h.state.inserts.map((row) => [row.ranking_mode, row.hide_order, row.tiers_enabled])).toEqual([
      ['unranked', true, false],
      ['ranked', false, false],
      ['rank_and_tier', false, true],
    ])
  })

  it('a legacy client sending both flags gets tier_only (the fourth combination)', async () => {
    expect((await post({ title: 'Legacy', hide_order: true, tiers_enabled: true })).status).toBe(201)
    expect(h.state.inserts[0]).toMatchObject({ ranking_mode: 'tier_only', hide_order: true, tiers_enabled: true })
  })

  it('refuses an unknown mode with a 400, writing nothing', async () => {
    expect((await post({ title: 'Bad', ranking_mode: 'tiers' })).status).toBe(400)
    expect(h.state.inserts).toHaveLength(0)
  })

  it('answers a database without 191 with a clear 409, not a 500', async () => {
    h.state.writeError = OLD_CHECK
    const res = await post({ title: 'Too early', ranking_mode: 'tier_only' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'TIER_ONLY_UNAVAILABLE',
      error: expect.stringContaining('Tiers without numbers is coming in the next update'),
    })
  })

  it('another 23514 is not mistaken for it — the private-list cap keeps its 403', async () => {
    h.state.writeError = { code: '23514', message: 'Free accounts can have one private list.' }
    const res = await post({ title: 'Private', ranking_mode: 'tier_only', is_private: true })
    expect(res.status).toBe(403)
  })

  it('a 23514 on another constraint is still a 500', async () => {
    h.state.writeError = { code: '23514', message: 'new row for relation "lists" violates check constraint "lists_scoring_format_check"' }
    expect((await post({ title: 'Other', ranking_mode: 'tier_only' })).status).toBe(500)
  })
})

describe('PATCH /api/lists/[id] — tiers without numbers', () => {
  it('stores tier_only with its flag pair', async () => {
    const res = await patch({ ranking_mode: 'tier_only' })
    expect(res.status).toBe(200)
    expect(h.state.updates[0]).toMatchObject({ ranking_mode: 'tier_only', hide_order: true, tiers_enabled: true })
  })

  it('answers a database without 191 with a clear 409, not a 500', async () => {
    h.state.writeError = OLD_CHECK
    const res = await patch({ title: 'Renamed', ranking_mode: 'tier_only' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'TIER_ONLY_UNAVAILABLE' })
  })

  it('an edit that isn’t tier_only never gets the 409', async () => {
    h.state.writeError = OLD_CHECK
    expect((await patch({ ranking_mode: 'ranked' })).status).toBe(500)
  })

  it('a Big Board keeps its numbers: tier_only is refused with a 400, writing nothing', async () => {
    h.state.existing = { ...h.state.existing, is_big_board: true }
    const res = await patch({ ranking_mode: 'tier_only' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'The Big Board is always ranked.' })
    expect(h.state.updates).toHaveLength(0)
  })

  it('a numbered mode on a Big Board is not refused', async () => {
    h.state.existing = { ...h.state.existing, is_big_board: true }
    expect((await patch({ ranking_mode: 'rank_and_tier' })).status).toBe(200)
  })
})
