/**
 * The comment routes under migration 213 (Community launch plan C2).
 *
 * DELETE /api/lists/[id]/comments/[commentId]:
 *   1. The database decides through `remove_list_comment`: done → 200; a
 *      missing / already-removed comment (P0002) → 404; not yours (42501) →
 *      403; anything else → 500. Never OK for nothing.
 *   2. Deploy before push: while the door is missing (PGRST202 naming it,
 *      with the route's own parameters) the route falls back to the pre-213
 *      author-or-owner UPDATE — and a fallback UPDATE that changed no row is
 *      a 409, never `{ ok: true }`. The fallback reads no row back (no
 *      RETURNING: 213's read rule would refuse it).
 *   3. A PGRST202 that names other parameters (the call drifted) is a 500,
 *      not the quiet fallback.
 *
 * POST /api/lists/[id]/comments:
 *   4. 213's refusal (PostgREST `rate_limited`) is a 429 with Retry-After and
 *      the reason in plain words; any other insert error stays a 500.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Err = { code: string; message: string; details?: string | null; hint?: string | null }
  const USER = '11111111-1111-4111-8111-111111111111'
  const OTHER = '33333333-3333-4333-8333-333333333333'
  const LIST_ID = '22222222-2222-4222-8222-222222222222'
  const COMMENT_ID = '44444444-4444-4444-8444-444444444444'

  const state = {
    user: { id: USER } as { id: string } | null,
    rpc: { data: null as unknown, error: null as Err | null },
    rpcCalls: [] as { fn: string; args: unknown }[],
    comment: { id: COMMENT_ID, list_id: LIST_ID, author_id: USER, deleted_at: null } as Record<string, unknown> | null,
    listOwner: OTHER,
    update: { error: null as Err | null, count: 1 as number | null },
    updates: [] as { values: unknown; opts: unknown }[],
    selectAfterUpdate: false,
    insertError: null as Err | null,
  }

  type Result = { data: unknown; error: Err | null; count?: number | null }
  interface Builder extends PromiseLike<Result> {
    select: (cols?: string) => Builder
    eq: () => Builder
    is: () => Builder
    insert: (row: unknown) => Builder
    update: (values: unknown, opts?: unknown) => Builder
    single: () => Promise<Result>
    maybeSingle: () => Promise<Result>
  }

  const from = (table: string): Builder => {
    let updated = false
    const b: Builder = {
      select: () => {
        if (updated) state.selectAfterUpdate = true
        return b
      },
      eq: () => b,
      is: () => b,
      insert: () => b,
      update: (values, opts) => {
        updated = true
        state.updates.push({ values, opts })
        return b
      },
      single: async () =>
        table === 'list_comments' && state.insertError
          ? { data: null, error: state.insertError }
          : { data: { id: 'new', created_at: '2026-10-29T12:00:00Z' }, error: null },
      maybeSingle: async () => {
        if (table === 'lists') return { data: { id: LIST_ID, owner_id: state.listOwner, comments_enabled: true }, error: null }
        return { data: state.comment, error: null }
      },
      then: (onFulfilled, onRejected) =>
        Promise.resolve<Result>(
          updated ? { data: null, error: state.update.error, count: state.update.count } : { data: [], error: null },
        ).then(onFulfilled, onRejected),
    }
    return b
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args })
      return state.rpc
    },
    from,
  }

  return { state, client, USER, OTHER, LIST_ID, COMMENT_ID }
})

vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.client }))

import { DELETE } from './[id]/comments/[commentId]/route'
import { POST } from './[id]/comments/route'

const params = { params: Promise.resolve({ id: h.LIST_ID, commentId: h.COMMENT_ID }) }
const del = () => DELETE(new Request('http://x/api'), params)

const NOT_PUSHED = {
  code: 'PGRST202',
  message: 'Could not find the function public.remove_list_comment(p_comment_id, p_list_id) in the schema cache',
  hint: null,
}

beforeEach(() => {
  h.state.user = { id: h.USER }
  h.state.rpc = { data: null, error: null }
  h.state.rpcCalls = []
  h.state.comment = { id: h.COMMENT_ID, list_id: h.LIST_ID, author_id: h.USER, deleted_at: null }
  h.state.listOwner = h.OTHER
  h.state.update = { error: null, count: 1 }
  h.state.updates = []
  h.state.selectAfterUpdate = false
  h.state.insertError = null
})

describe('DELETE a comment — through remove_list_comment (213)', () => {
  it('signed out is a 401 and asks the database nothing', async () => {
    h.state.user = null
    const res = await del()
    expect(res.status).toBe(401)
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('done → 200, the door called with the list and the comment, no UPDATE', async () => {
    h.state.rpc = { data: { removed_as: 'author' }, error: null }
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(h.state.rpcCalls).toEqual([
      { fn: 'remove_list_comment', args: { p_list_id: h.LIST_ID, p_comment_id: h.COMMENT_ID } },
    ])
    expect(h.state.updates).toHaveLength(0)
  })

  it('a missing or already-removed comment (P0002) → 404 with the database’s words', async () => {
    h.state.rpc = { data: null, error: { code: 'P0002', message: 'That comment isn’t there — it may already have been removed.' } }
    const res = await del()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('That comment isn’t there — it may already have been removed.')
    expect(h.state.updates).toHaveLength(0)
  })

  it('not yours (42501) → 403', async () => {
    h.state.rpc = { data: null, error: { code: '42501', message: 'You can only remove your own comments, or comments on your own list.' } }
    const res = await del()
    expect(res.status).toBe(403)
    expect(h.state.updates).toHaveLength(0)
  })

  it('any other database error → 500, never OK', async () => {
    h.state.rpc = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    const res = await del()
    expect(res.status).toBe(500)
  })

  it('a PGRST202 for other parameters (the call drifted) is a 500, not the fallback', async () => {
    h.state.rpc = {
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.remove_list_comment(p_bogus, p_list_id) in the schema cache', hint: null },
    }
    const res = await del()
    expect(res.status).toBe(500)
    expect(h.state.updates).toHaveLength(0)
  })
})

describe('DELETE a comment — before 213 is pushed (the door missing)', () => {
  beforeEach(() => {
    h.state.rpc = { data: null, error: NOT_PUSHED }
  })

  it('the author: today’s soft-delete, counted, and no row read back', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(h.state.updates).toHaveLength(1)
    expect(h.state.updates[0].opts).toEqual({ count: 'exact' })
    expect(Object.keys(h.state.updates[0].values as object)).toEqual(['deleted_at'])
    expect(h.state.selectAfterUpdate).toBe(false)
  })

  it('the list’s owner may remove someone else’s comment', async () => {
    h.state.comment = { ...h.state.comment, author_id: h.OTHER }
    h.state.listOwner = h.USER
    const res = await del()
    expect(res.status).toBe(200)
    expect(h.state.updates).toHaveLength(1)
  })

  it('an UPDATE that changed no row is a loud 409, never OK', async () => {
    h.state.update = { error: null, count: 0 }
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/wasn’t removed/)
  })

  it('neither author nor owner → 403 and nothing written', async () => {
    h.state.comment = { ...h.state.comment, author_id: h.OTHER }
    const res = await del()
    expect(res.status).toBe(403)
    expect(h.state.updates).toHaveLength(0)
  })

  it('missing or already removed → 404 and nothing written', async () => {
    h.state.comment = null
    expect((await del()).status).toBe(404)
    h.state.comment = { id: h.COMMENT_ID, list_id: h.LIST_ID, author_id: h.USER, deleted_at: '2026-10-29T00:00:00Z' }
    expect((await del()).status).toBe(404)
    expect(h.state.updates).toHaveLength(0)
  })
})

describe('POST a comment — the 5-a-minute refusal (213)', () => {
  const post = () =>
    POST(
      new Request('http://x/api', { method: 'POST', body: JSON.stringify({ body: 'Great list' }), headers: { 'content-type': 'application/json' } }),
      { params: Promise.resolve({ id: h.LIST_ID }) },
    )

  it('the trigger’s refusal → 429, Retry-After and the reason in plain words', async () => {
    h.state.insertError = {
      code: 'rate_limited',
      message: 'You’re commenting too fast — you can comment again in 20 seconds.',
      details: 'retry_after_seconds=20',
      hint: null,
    }
    const res = await post()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('20')
    expect(await res.json()).toEqual({
      error: 'You’re commenting too fast — you can comment again in 20 seconds.',
      code: 'RATE_LIMITED',
      bucket: 'comment',
      retry_after_seconds: 20,
    })
  })

  it('any other insert error stays a 500', async () => {
    h.state.insertError = { code: '42501', message: 'new row violates row-level security policy for table "list_comments"' }
    expect((await post()).status).toBe(500)
  })

  it('a comment that lands is a 201', async () => {
    expect((await post()).status).toBe(201)
  })
})
