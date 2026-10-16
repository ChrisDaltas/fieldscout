/**
 * POST /api/lists and PATCH /api/lists/[id] — the cover colour (migration
 * 188, Chris 2026-10-15).
 *
 * Pinned here:
 *   1. Validation: one of the six keys or null; anything else is a 400 and
 *      nothing is written.
 *   2. The column is named ONLY when a colour is sent (create: a chosen key;
 *      edit: a key or null) — main deploys before 188 is pushed, so a write
 *      that never mentions the column must keep working on the older schema.
 *   3. The database answering "no such column" (PGRST204) is a clear 409 with
 *      a code, never a 500. Any other database error is still a 500.
 *
 * The Supabase server client is faked with a chainable builder that records
 * each insert/update payload and answers the write with `h.writeError`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  type Result = { data: unknown; error: { code: string; message: string } | null }

  const state = {
    inserts: [] as Row[],
    updates: [] as Row[],
    writeError: null as { code: string; message: string } | null,
  }

  const OWNER = '11111111-1111-4111-8111-111111111111'
  const LIST_ID = '22222222-2222-4222-8222-222222222222'

  /** The PATCH route's ownership read. */
  const existing = {
    id: LIST_ID,
    owner_id: OWNER,
    is_big_board: false,
    slug: 'my-list',
    title: 'My list',
    is_private: false,
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
      maybeSingle: async () => ({ data: existing, error: null }),
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

const MISSING_COLUMN = {
  code: 'PGRST204',
  message: "Could not find the 'cover_color' column of 'lists' in the schema cache",
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
})

describe('POST /api/lists — cover colour', () => {
  it('stores a chosen colour', async () => {
    const res = await post({ title: 'Sleepers', cover_color: 'purple' })
    expect(res.status).toBe(201)
    expect(h.state.inserts).toHaveLength(1)
    expect(h.state.inserts[0]).toMatchObject({ title: 'Sleepers', cover_color: 'purple' })
  })

  it('never names the column without a colour — so it works before 188 is pushed', async () => {
    expect((await post({ title: 'No colour' })).status).toBe(201)
    expect((await post({ title: 'Null colour', cover_color: null })).status).toBe(201)
    expect(h.state.inserts).toHaveLength(2)
    for (const row of h.state.inserts) expect(row).not.toHaveProperty('cover_color')
  })

  it('refuses anything outside the six keys with a 400, writing nothing', async () => {
    for (const bad of ['#0088FF', 'Blue', '', 'orange']) {
      const res = await post({ title: 'Bad', cover_color: bad })
      expect(res.status, bad).toBe(400)
    }
    expect(h.state.inserts).toHaveLength(0)
  })

  it('answers a database without the column with a clear 409, not a 500', async () => {
    h.state.writeError = MISSING_COLUMN
    const res = await post({ title: 'Too early', cover_color: 'red' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'COVER_COLOR_UNAVAILABLE' })
  })

  it('any other database error is still a 500', async () => {
    h.state.writeError = { code: 'XX000', message: 'boom' }
    const res = await post({ title: 'Broken', cover_color: 'red' })
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/lists/[id] — cover colour', () => {
  it('stores a chosen colour', async () => {
    const res = await patch({ cover_color: 'green' })
    expect(res.status).toBe(200)
    expect(h.state.updates).toHaveLength(1)
    expect(h.state.updates[0]).toMatchObject({ cover_color: 'green' })
  })

  it('null clears it back to the position colour', async () => {
    expect((await patch({ cover_color: null })).status).toBe(200)
    expect(h.state.updates[0]).toHaveProperty('cover_color', null)
  })

  it('an edit that doesn’t send it never names the column', async () => {
    expect((await patch({ title: 'Renamed', position_filter: 'QB' })).status).toBe(200)
    expect(h.state.updates[0]).toMatchObject({ title: 'Renamed', position_filter: 'QB' })
    expect(h.state.updates[0]).not.toHaveProperty('cover_color')
  })

  it('refuses anything outside the six keys with a 400, writing nothing', async () => {
    const res = await patch({ cover_color: '#F75252' })
    expect(res.status).toBe(400)
    expect(h.state.updates).toHaveLength(0)
  })

  it('answers a database without the column with a clear 409, not a 500', async () => {
    h.state.writeError = MISSING_COLUMN
    const res = await patch({ cover_color: 'ink' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'COVER_COLOR_UNAVAILABLE' })
  })
})
