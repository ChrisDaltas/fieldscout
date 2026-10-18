/**
 * The Latest page's read (Chris, 2026-10-16: "a page with a simple literal
 * most recent"). Pinned:
 *  - the same rows as the Latest shelf — public, not deleted, with players,
 *    read with `select('*')` + embeds (never naming a column a migration not
 *    yet pushed adds);
 *  - newest POSTED first, then the id (a total order, so pages don't
 *    overlap or skip on a tie) — no popularity;
 *  - paged with `.range()`: a full page has a next page, a short one is the
 *    end — never one capped read taken for all of them;
 *  - a failed read throws (an error state), never an empty page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = [string, unknown[]]
interface Call {
  table: string
  ops: Op[]
}
const calls: Call[] = []
let answer: (call: Call) => { data: unknown; error: unknown } = () => ({ data: [], error: null })

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: (table: string) => {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(answer(call)).then(resolve, reject)
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

import { LATEST_PAGE_SIZE, readLatestPage } from './use-community-latest'
import { POOL_SELECT } from './use-mobile-community-feed'

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)
const mainOrders = (call: Call) =>
  op(call, 'order').filter(([, o]) => !(o as { referencedTable?: string } | undefined)?.referencedTable)

function row(id: string, created_at: string) {
  return {
    id,
    title: `List ${id}`,
    slug: id,
    description: null,
    is_big_board: false,
    position_filter: null,
    player_count: 3,
    like_count: 0,
    created_at,
    updated_at: created_at,
    thumbnail_url: null,
    ai_persona_id: null,
    owner: { id: `u-${id}`, username: `user${id}`, avatar_url: null, follower_count: 1 },
    persona: null,
    tag_links: [],
    links: [],
    heads: [],
  }
}

beforeEach(() => {
  calls.length = 0
  answer = () => ({ data: [], error: null })
})

describe('readLatestPage', () => {
  it('reads the shelf’s rows: public, not deleted, with players — with *, never naming new columns', async () => {
    await readLatestPage(0)
    const [call] = calls
    expect(calls).toHaveLength(1)
    expect(call!.table).toBe('lists')
    expect(op(call!, 'select')).toEqual([[POOL_SELECT]])
    expect(POOL_SELECT).not.toMatch(/cover_color|scoring_format/)
    expect(op(call!, 'eq')).toContainEqual(['is_private', false])
    expect(op(call!, 'is')).toContainEqual(['deleted_at', null])
    expect(op(call!, 'gt')).toContainEqual(['player_count', 0])
    expect(op(call!, 'limit')).toContainEqual([4, { referencedTable: 'heads' }])
  })

  it('newest posted first, then the id — nothing else orders it', async () => {
    await readLatestPage(0)
    expect(mainOrders(calls[0]!)).toEqual([
      ['created_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: false }],
    ])
    expect(op(calls[0]!, 'order').map(([col]) => col)).not.toContain('like_count')
  })

  it('pages with .range(): a full page has a next page, a short one is the end', async () => {
    const full = Array.from({ length: LATEST_PAGE_SIZE }, (_, i) =>
      row(`n${i}`, new Date(Date.parse('2026-10-15T12:00:00Z') - i * 60_000).toISOString()),
    )
    answer = () => ({ data: full, error: null })
    const first = await readLatestPage(0)
    expect(op(calls[0]!, 'range')).toEqual([[0, LATEST_PAGE_SIZE - 1]])
    expect(first.items.map((i) => i.id)).toEqual(full.map((r) => r.id))
    expect(first.next).toBe(LATEST_PAGE_SIZE)

    answer = () => ({ data: [row('last', '2026-10-01T00:00:00Z')], error: null })
    const second = await readLatestPage(first.next!)
    expect(op(calls[1]!, 'range')).toEqual([[LATEST_PAGE_SIZE, 2 * LATEST_PAGE_SIZE - 1]])
    expect(second.items.map((i) => i.id)).toEqual(['last'])
    expect(second.next).toBeNull()
  })

  it('no rows: the end, not an error', async () => {
    expect(await readLatestPage(0)).toEqual({ items: [], next: null })
  })

  it('rankings come back as rankings (the screen drops them while their switch is off)', async () => {
    answer = () => ({ data: [{ ...row('bb', '2026-10-15T00:00:00Z'), is_big_board: true }], error: null })
    const page = await readLatestPage(0)
    expect(page.items[0]).toMatchObject({ id: 'bb', kind: 'rank', rankType: 'season', scoring: 'Half PPR' })
  })

  it('a failed read throws — never an empty page', async () => {
    answer = () => ({ data: null, error: { message: 'boom' } })
    await expect(readLatestPage(0)).rejects.toMatchObject({ message: 'boom' })
  })
})
