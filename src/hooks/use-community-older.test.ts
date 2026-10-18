/**
 * Community past the pool (gap list §3 #30: "search and filters cover every
 * public list, not just the newest 100"). Pinned:
 *  - the same rows as the pool — public, not deleted, with players, read with
 *    `*` (never naming a column a migration not yet pushed adds) — plus
 *    filter-only embeds when a topic or search needs them;
 *  - each page starts after the row the last one ended on, in the pool's
 *    order (last update, then the id) — never an offset; a full page has a
 *    next one, a short page is the end; a failed read throws;
 *  - every filter the client applies to the pool, on the server: ranking vs
 *    list (the client's own split), the type and position chips, Following,
 *    a tag / player / injuries topic, and the search over the title,
 *    description, @handle, tags and every player in the list;
 *  - what a person types stays text (quotes, commas, brackets, wildcards).
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

import { WEEKLY_BOARD_PATTERN, type OlderSpec } from '@/components/mobile/community/community-ops'
import { INJURY_STATUSES } from '@/components/mobile/home/home-ops'

import { OLDER_PAGE_SIZE, olderSelect, readOlderPage, searchPatterns } from './use-community-older'
import { POOL_SELECT, type PoolCursor } from './use-mobile-community-feed'

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)
const ors = (call: Call) => op(call, 'or').map(([f]) => f as string)
const mainOrders = (call: Call) =>
  op(call, 'order').filter(([, o]) => !(o as { referencedTable?: string } | undefined)?.referencedTable)

const AFTER: PoolCursor = { updatedAt: '2026-10-01T12:00:00.123456+00:00', id: 'last-id' }
const LIST: OlderSpec = { kind: 'list', following: null, topic: null, q: '', rankType: 'all', rankPos: 'all' }
const RANK: OlderSpec = { ...LIST, kind: 'rank' }

function row(id: string, updated_at: string | null, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `List ${id}`,
    slug: id,
    description: null,
    is_big_board: false,
    position_filter: null,
    player_count: 3,
    like_count: 0,
    created_at: '2026-09-01T00:00:00Z',
    updated_at,
    thumbnail_url: null,
    ai_persona_id: null,
    owner: { id: `u-${id}`, username: `user${id}`, avatar_url: null, follower_count: 1 },
    persona: null,
    tag_links: [],
    links: [],
    heads: [],
    ...over,
  }
}

async function read(spec: OlderSpec, after = AFTER) {
  calls.length = 0
  const page = await readOlderPage(spec, after)
  return { page, call: calls[0]! }
}

beforeEach(() => {
  calls.length = 0
  answer = () => ({ data: [], error: null })
})

describe('the read past the pool', () => {
  it('the pool’s rows — public, not deleted, with players — with *, never naming new columns', async () => {
    const { call } = await read(LIST)
    expect(calls).toHaveLength(1)
    expect(call.table).toBe('lists')
    expect(op(call, 'select')).toEqual([[POOL_SELECT]])
    expect(POOL_SELECT).not.toMatch(/cover_color|scoring_format/)
    expect(op(call, 'eq')).toContainEqual(['is_private', false])
    expect(op(call, 'is')).toContainEqual(['deleted_at', null])
    expect(op(call, 'gt')).toContainEqual(['player_count', 0])
    expect(op(call, 'limit')).toContainEqual([4, { referencedTable: 'heads' }])
  })

  it('starts after the pool’s last row, in the pool’s order — never an offset', async () => {
    const { call } = await read(LIST)
    expect(ors(call)).toContainEqual(
      'updated_at.lt."2026-10-01T12:00:00.123456+00:00",and(updated_at.eq."2026-10-01T12:00:00.123456+00:00",id.lt.last-id),updated_at.is.null',
    )
    expect(mainOrders(call)).toEqual([
      ['updated_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: false }],
    ])
    expect(op(call, 'limit')).toContainEqual([OLDER_PAGE_SIZE])
    expect(op(call, 'range')).toEqual([])
    // A last row with no update time: only those (they sort last), by id.
    const { call: nulls } = await read(LIST, { updatedAt: null, id: 'z' })
    expect(op(nulls, 'is')).toContainEqual(['updated_at', null])
    expect(op(nulls, 'lt')).toContainEqual(['id', 'z'])
  })

  it('a full page has a next one, after its last row; a short page is the end', async () => {
    const full = Array.from({ length: OLDER_PAGE_SIZE }, (_, i) => row(`r${i}`, `2026-09-${String(28 - i).padStart(2, '0')}T00:00:00Z`))
    answer = () => ({ data: full, error: null })
    const { page } = await read(LIST)
    expect(page.items.map((i) => i.id)).toEqual(full.map((r) => r.id))
    expect(page.next).toEqual({ updatedAt: full[OLDER_PAGE_SIZE - 1]!.updated_at, id: `r${OLDER_PAGE_SIZE - 1}` })

    answer = () => ({ data: [row('end', null)], error: null })
    expect((await read(LIST, page.next!)).page.next).toBeNull()
  })

  it('maps rows as the pool does — a ranking comes back as one', async () => {
    answer = () => ({ data: [row('bb', '2026-09-01T00:00:00Z', { is_big_board: true })], error: null })
    const { page } = await read(RANK)
    expect(page.items[0]).toMatchObject({ id: 'bb', kind: 'rank', rankType: 'season', scoring: 'Half PPR' })
  })

  it('a failed read throws — never an empty page', async () => {
    answer = () => ({ data: null, error: { message: 'boom' } })
    await expect(readOlderPage(LIST, AFTER)).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('rankings vs lists, on the server — the client’s own split', () => {
  const weekly = `"${WEEKLY_BOARD_PATTERN}"`

  it('the weekly board pattern reads the same in JavaScript (and is what Postgres matches)', () => {
    const re = new RegExp(WEEKLY_BOARD_PATTERN)
    expect(re.exec('week-7-big-board-1712')?.[1]).toBe('7')
    expect(re.test('week-12-big-board')).toBe(true)
    expect(re.test('week-7-big-boards')).toBe(false)
    expect(re.test('my-week-7-big-board')).toBe(false)
  })

  it('a list: not the big board, not a weekly board, not an AI expert’s', async () => {
    const { call } = await read(LIST)
    expect(op(call, 'not')).toEqual([
      ['is_big_board', 'is', true],
      ['slug', 'match', WEEKLY_BOARD_PATTERN],
    ])
    expect(op(call, 'is')).toContainEqual(['ai_persona_id', null])
  })

  it('a ranking: the big board, a weekly board or an AI expert’s; the type chip narrows it', async () => {
    expect(ors((await read(RANK)).call)).toContainEqual(`is_big_board.is.true,slug.match.${weekly},ai_persona_id.not.is.null`)
    const w = (await read({ ...RANK, rankType: 'weekly' })).call
    expect(op(w, 'not')).toContainEqual(['is_big_board', 'is', true])
    expect(op(w, 'filter')).toContainEqual(['slug', 'match', WEEKLY_BOARD_PATTERN])
    expect(ors((await read({ ...RANK, rankType: 'season' })).call)).toContainEqual(
      `is_big_board.is.true,and(slug.not.match.${weekly},ai_persona_id.not.is.null)`,
    )
  })

  it('the position chip: that position; D/ST takes DEF and DST too', async () => {
    expect(op((await read({ ...RANK, rankPos: 'QB' })).call, 'ilike')).toContainEqual(['position_filter', 'QB'])
    expect(ors((await read({ ...RANK, rankPos: 'DST' })).call)).toContainEqual(
      'position_filter.ilike.DEF,position_filter.ilike.DST,position_filter.ilike."D/ST"',
    )
    // Lists have no position chip.
    expect(op((await read({ ...LIST, rankPos: 'QB' })).call, 'ilike')).toEqual([])
  })
})

describe('Following and topics', () => {
  it('Following: the people followed, their own lists (an AI expert’s board is no one’s)', async () => {
    const { call } = await read({ ...LIST, following: ['u-a', 'u-b'] })
    expect(op(call, 'in')).toContainEqual(['owner_id', ['u-a', 'u-b']])
    expect(op(call, 'is')).toContainEqual(['ai_persona_id', null])
  })

  it('following no one: nothing to read, and no read', async () => {
    const { page } = await read({ ...LIST, following: [] })
    expect(page).toEqual({ items: [], next: null })
    expect(calls).toHaveLength(0)
  })

  it('a tag, a player, or a player on the injury report — one row each, filters only', async () => {
    const tag = (await read({ ...LIST, topic: { kind: 'tag', id: 't-1' } })).call
    expect(op(tag, 'select')[0]![0]).toContain('sq_topic:list_tags!inner(tag_id)')
    expect(op(tag, 'eq')).toContainEqual(['sq_topic.tag_id', 't-1'])
    expect(op(tag, 'limit')).toContainEqual([1, { referencedTable: 'sq_topic' }])

    const player = (await read({ ...LIST, topic: { kind: 'player', id: 'p-9' } })).call
    expect(op(player, 'select')[0]![0]).toContain('sq_topic:list_players!inner(player_id)')
    expect(op(player, 'eq')).toContainEqual(['sq_topic.player_id', 'p-9'])

    const hurt = (await read({ ...LIST, topic: { kind: 'injuries', id: 'injuries' } })).call
    expect(op(hurt, 'select')[0]![0]).toContain('sq_topic:list_players!inner(player:players!inner(status, team))')
    expect(op(hurt, 'in')).toContainEqual(['sq_topic.player.status', [...INJURY_STATUSES]])
    expect(op(hurt, 'not')).toContainEqual(['sq_topic.player.team', 'is', null])
  })

  it('no topic and no search: just the card’s embeds', () => {
    expect(olderSelect(LIST)).toBe(POOL_SELECT)
  })
})

describe('the search', () => {
  it('looks where the client does: title, description, @handle, tags — and every player in the list', async () => {
    const { call } = await read({ ...LIST, q: 'kelce' })
    const select = op(call, 'select')[0]![0] as string
    expect(select.startsWith(POOL_SELECT)).toBe(true)
    expect(select).toContain('sq_owner:profiles!lists_owner_id_fkey(username)')
    expect(select).toContain('sq_persona:ai_personas!lists_ai_persona_id_fkey(username)')
    expect(select).toContain('sq_tags:list_tags(tag:tags!inner(name))')
    expect(select).toContain('sq_players:list_players(player:players!inner(full_name))')
    expect(op(call, 'ilike')).toEqual([
      ['sq_owner.username', '%kelce%'],
      ['sq_persona.username', '%kelce%'],
      ['sq_tags.tag.name', '%kelce%'],
      ['sq_players.player.full_name', '%kelce%'],
    ])
    expect(op(call, 'limit')).toContainEqual([1, { referencedTable: 'sq_players' }])
    expect(ors(call)).toContainEqual(
      'title.ilike."%kelce%",description.ilike."%kelce%",and(ai_persona_id.is.null,sq_owner.not.is.null),sq_persona.not.is.null,sq_tags.not.is.null,sq_players.not.is.null',
    )
  })

  it('"@" searches handles that start with the rest — the client reads handles as "@handle"', () => {
    expect(searchPatterns('@dev')).toEqual({ text: '%@dev%', handle: 'dev%' })
    expect(searchPatterns('dev')).toEqual({ text: '%dev%', handle: '%dev%' })
  })

  it('what a person types stays text: wildcards, quotes, commas and brackets', async () => {
    expect(searchPatterns('50%_off')).toEqual({ text: '%50\\%\\_off%', handle: '%50\\%\\_off%' })
    const { call } = await read({ ...LIST, q: 'a,b) "c\\' })
    const [search] = ors(call).filter((f) => f.startsWith('title.'))
    // Quoted, with the quote and the backslash escaped inside.
    expect(search).toContain('title.ilike."%a,b) \\"c\\\\\\\\%"')
  })
})
