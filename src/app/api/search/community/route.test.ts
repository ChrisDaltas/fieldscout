/**
 * GET /api/search/community — the phone's search and the desktop command
 * palette (plan C3, readiness S9). Pinned: asked for what Community shows
 * (`show`, sent by `communitySearchHref` while Community is on), the lists
 * it finds are public, not deleted, with players (never anyone's empty "My
 * Big Board"), and for `show=lists` no big boards, weekly boards or AI
 * experts' boards — the feed's own rule, applied in the read. Without
 * `show` (Community off) it finds what it always has. The route reads no
 * switch itself (`flag-free-server-paths.test.ts`). People search is
 * untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = [string, unknown[]]
interface Call {
  table: string
  ops: Op[]
}

const h = vi.hoisted(() => ({
  user: { id: 'viewer' } as { id: string } | null,
  calls: [] as { table: string; ops: [string, unknown[]][] }[],
  answer: (() => ({ data: [], error: null })) as (call: { table: string }) => { data: unknown; error: unknown },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      const call: Call = { table, ops: [] }
      h.calls.push(call)
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(h.answer(call)).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args])
              return builder
            }
          },
        },
      )
      return builder
    },
  }),
}))

import { WEEKLY_BOARD_PATTERN } from '@/components/mobile/community/community-ops'

import { GET } from './route'

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)
const search = (q: string, extra = '') =>
  GET(new Request(`http://localhost/api/search/community?q=${encodeURIComponent(q)}${extra}`))
const listsCall = () => h.calls.find((c) => c.table === 'lists')!
const usersCall = () => h.calls.find((c) => c.table === 'profiles')!

beforeEach(() => {
  h.calls.length = 0
  h.user = { id: 'viewer' }
  h.answer = () => ({ data: [], error: null })
})

describe('community search finds what Community shows', () => {
  it('show=lists: public, not deleted, with players — and no rankings', async () => {
    const res = await search('big board', '&show=lists')
    expect(res.status).toBe(200)
    const call = listsCall()
    expect(op(call, 'ilike')).toContainEqual(['title', '%big board%'])
    expect(op(call, 'eq')).toContainEqual(['is_private', false])
    expect(op(call, 'is')).toContainEqual(['deleted_at', null])
    expect(op(call, 'gt')).toContainEqual(['player_count', 0])
    expect(op(call, 'not')).toContainEqual(['is_big_board', 'is', true])
    expect(op(call, 'not')).toContainEqual(['slug', 'match', WEEKLY_BOARD_PATTERN])
    expect(op(call, 'is')).toContainEqual(['ai_persona_id', null])
  })

  it('show=all (rankings switched on): rankings are found again; empty lists still never are', async () => {
    await search('board', '&show=all')
    const call = listsCall()
    expect(op(call, 'gt')).toContainEqual(['player_count', 0])
    expect(op(call, 'not')).toEqual([])
    expect(op(call, 'is')).not.toContainEqual(['ai_persona_id', null])
  })

  it('no show (Community off): every public list, as search found before Community', async () => {
    await search('board')
    const call = listsCall()
    expect(op(call, 'eq')).toContainEqual(['is_private', false])
    expect(op(call, 'is')).toContainEqual(['deleted_at', null])
    expect(op(call, 'gt')).toEqual([])
    expect(op(call, 'not')).toEqual([])
  })

  it('a show value it doesn’t know is a 400, never a guess', async () => {
    const res = await search('board', '&show=rankings')
    expect(res.status).toBe(400)
  })

  it('people search is unchanged', async () => {
    await search('dev')
    const call = usersCall()
    expect(op(call, 'ilike')).toEqual([['username', '%dev%']])
    expect(op(call, 'gt')).toEqual([])
    expect(op(call, 'not')).toEqual([])
  })

  it('a failed lists read is a 500, never an empty result', async () => {
    h.answer = (call) => (call.table === 'lists' ? { data: null, error: { message: 'boom' } } : { data: [], error: null })
    const res = await search('sleepers')
    expect(res.status).toBe(500)
  })

  it('signed out: 401, nothing read', async () => {
    h.user = null
    const res = await search('sleepers')
    expect(res.status).toBe(401)
    expect(h.calls).toHaveLength(0)
  })
})
