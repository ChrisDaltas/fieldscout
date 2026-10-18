/**
 * The Community reads (gap list #35–#37). Pinned:
 *  - the lists reads use `select('*')` + embeds and never NAME `cover_color`
 *    (migration 188) or `scoring_format` (migration 190) — main deploys
 *    before the push, and naming a missing column fails the whole read;
 *  - a ranking's saved scoring is read from the row when it's there, and is
 *    "none" (never an error) before 190 — which counts as Half PPR (Chris,
 *    2026-10-16), or on an AI expert's board as its persona's usual scoring
 *    (what 190 saves), never a guess from a scoring system;
 *  - Latest is its own read, by `created_at` (the pool is by update time);
 *  - recent likes are read for the whole window (not just the lists read),
 *    paged past PostgREST's 1000-row cap, and a likes error fails the read
 *    (no silent "no likes");
 *  - a list liked lately that the update-ordered pool left out is read too
 *    (`popularExtra`, For you's candidates) — a like doesn't update a list;
 *  - Injuries asks the server with the Home injury report's statuses;
 *  - the pool is read in a total order (last update, then the id), and a
 *    full one says where the older lists start (`olderFrom`, gap list §3
 *    #30) — a full read is never taken for every public list.
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

import { INJURY_STATUSES } from '@/components/mobile/home/home-ops'
import { RANK_FILTERS_ALL, rankFilterOk } from '@/components/mobile/community/community-ops'

import {
  COMMUNITY_POOL_SIZE,
  LATEST_READ_SIZE,
  LIKED_EXTRA_SIZE,
  POOL_SELECT,
  readCommunityFeed,
  readInjuryMatches,
} from './use-mobile-community-feed'

const NOW = Date.parse('2026-10-15T12:00:00Z')

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)
const isLatest = (call: Call) => op(call, 'order').some(([col]) => col === 'created_at')
/** The read of recently liked lists outside the pool (by id). */
const isExtra = (call: Call) => op(call, 'in').some(([col]) => col === 'id')
const mainOrder = (call: Call) => op(call, 'order').find(([, o]) => !(o as { referencedTable?: string }).referencedTable)

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `List ${id}`,
    slug: id,
    description: null,
    is_big_board: true,
    position_filter: null,
    player_count: 3,
    like_count: 2,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-14T00:00:00Z',
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

beforeEach(() => {
  calls.length = 0
  answer = () => ({ data: [], error: null })
})

describe('readCommunityFeed', () => {
  it('reads lists with * — never naming cover_color or scoring_format', async () => {
    await readCommunityFeed(NOW)
    expect(POOL_SELECT.trim().startsWith('*,')).toBe(true)
    expect(POOL_SELECT).not.toMatch(/cover_color|scoring_format/)
    const lists = calls.filter((c) => c.table === 'lists')
    expect(lists).toHaveLength(2)
    for (const c of lists) {
      expect(op(c, 'select')).toEqual([[POOL_SELECT]])
      expect(op(c, 'eq')).toContainEqual(['is_private', false])
    }
  })

  it('Latest is its own read, newest POSTED first; the pool is by last update', async () => {
    await readCommunityFeed(NOW)
    const lists = calls.filter((c) => c.table === 'lists')
    const latest = lists.find(isLatest)!
    const pool = lists.find((c) => !isLatest(c))!
    expect(mainOrder(latest)).toEqual(['created_at', { ascending: false, nullsFirst: false }])
    expect(op(latest, 'limit')).toContainEqual([LATEST_READ_SIZE])
    expect(mainOrder(pool)).toEqual(['updated_at', { ascending: false, nullsFirst: false }])
    // Then the id: a total order, so "after the pool's last row" is exact.
    const poolOrders = op(pool, 'order').filter(([, o]) => !(o as { referencedTable?: string }).referencedTable)
    expect(poolOrders).toEqual([
      ['updated_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: false }],
    ])
    expect(op(pool, 'limit')).toContainEqual([COMMUNITY_POOL_SIZE])
  })

  it('a full pool says where the older lists start — its last row; one that isn’t full holds them all', async () => {
    const full = Array.from({ length: COMMUNITY_POOL_SIZE }, (_, i) =>
      row(`p${i}`, { updated_at: new Date(Date.parse('2026-10-14T00:00:00Z') - i * 60_000).toISOString() }),
    )
    // The last row counts even when the cards can't draw it (no owner).
    full[COMMUNITY_POOL_SIZE - 1] = { ...full[COMMUNITY_POOL_SIZE - 1]!, owner: null as never }
    answer = (call) => ({ data: call.table === 'lists' && !isLatest(call) ? full : [], error: null })
    const capped = await readCommunityFeed(NOW)
    expect(capped.capped).toBe(true)
    expect(capped.items).toHaveLength(COMMUNITY_POOL_SIZE - 1)
    expect(capped.olderFrom).toEqual({ updatedAt: full[COMMUNITY_POOL_SIZE - 1]!.updated_at, id: `p${COMMUNITY_POOL_SIZE - 1}` })

    answer = (call) => ({ data: call.table === 'lists' && !isLatest(call) ? full.slice(0, 5) : [], error: null })
    const all = await readCommunityFeed(NOW)
    expect(all.capped).toBe(false)
    expect(all.olderFrom).toBeNull()
  })

  it('the saved scoring: from the row once 190 is pushed; none (no error) before', async () => {
    answer = (call) =>
      call.table === 'lists'
        ? isLatest(call)
          ? { data: [], error: null }
          : { data: [row('a', { scoring_format: 'quarter' }), row('b'), row('c', { scoring_format: 'bogus' })], error: null }
        : { data: [], error: null }
    const feed = await readCommunityFeed(NOW)
    const by = Object.fromEntries(feed.items.map((i) => [i.id, i]))
    expect(by.a).toMatchObject({ scoringFormat: 'quarter', scoring: '0.25 PPR' })
    // Before 190 (no key) or an unknown value: no saved scoring, which
    // counts as Half PPR — and the Half chip takes it, the others don't.
    expect(by.b).toMatchObject({ scoringFormat: 'half', scoring: 'Half PPR' })
    expect(by.c).toMatchObject({ scoringFormat: 'half', scoring: 'Half PPR' })
    expect(rankFilterOk(by.b!, { ...RANK_FILTERS_ALL, scoring: 'half' })).toBe(true)
    for (const scoring of ['ppr', 'quarter', 'standard'] as const) {
      expect(rankFilterOk(by.b!, { ...RANK_FILTERS_ALL, scoring })).toBe(false)
    }
    // Never a guess from a scoring system: it isn't read.
    expect(POOL_SELECT).not.toMatch(/scoring_systems/)
  })

  it('numbers follow the list’s Ranked switch; a ranking is always numbered (2026-10-16)', async () => {
    answer = (call) =>
      call.table === 'lists'
        ? isLatest(call)
          ? { data: [], error: null }
          : {
              data: [
                row('plain', { is_big_board: false, ranking_mode: 'unranked' }),
                row('tiers', { is_big_board: false, ranking_mode: 'tier_only' }),
                row('ranked', { is_big_board: false, ranking_mode: 'ranked' }),
                row('both', { is_big_board: false, ranking_mode: 'rank_and_tier' }),
                row('board', { ranking_mode: 'unranked' }),
              ],
              error: null,
            }
        : { data: [], error: null }
    const feed = await readCommunityFeed(NOW)
    const by = Object.fromEntries(feed.items.map((i) => [i.id, i]))
    expect(by.plain?.numbered).toBe(false)
    expect(by.tiers?.numbered).toBe(false)
    expect(by.ranked?.numbered).toBe(true)
    expect(by.both?.numbered).toBe(true)
    expect(by.board).toMatchObject({ kind: 'rank', numbered: true })
  })

  it('ranking types (#27): the big board and AI experts’ boards are season rankings; a weekly board carries its week', async () => {
    answer = (call) =>
      call.table === 'lists'
        ? isLatest(call)
          ? { data: [], error: null }
          : {
              data: [
                row('board'),
                row('wk', { is_big_board: false, slug: 'week-7-big-board-1791000000000' }),
                row('ai', { is_big_board: false, ai_persona_id: 'p1', persona: { username: 'ai', avatar_url: null, scoring: null } }),
                row('list', { is_big_board: false }),
              ],
              error: null,
            }
        : { data: [], error: null }
    const feed = await readCommunityFeed(NOW)
    const by = Object.fromEntries(feed.items.map((i) => [i.id, i]))
    expect(by.board).toMatchObject({ kind: 'rank', rankType: 'season', rankWeek: null })
    expect(by.wk).toMatchObject({ kind: 'rank', rankType: 'weekly', rankWeek: 7 })
    expect(by.ai).toMatchObject({ kind: 'rank', rankType: 'season', rankWeek: null })
    expect(by.list).toMatchObject({ kind: 'list', rankType: null, rankWeek: null })
  })

  it('an AI expert’s board with no saved scoring counts as its persona’s usual scoring — what 190 saves', async () => {
    answer = (call) =>
      call.table === 'lists' && !isLatest(call)
        ? {
            data: [
              row('ai', {
                is_big_board: false,
                ai_persona_id: 'p1',
                persona: { username: 'bathew-merry-ai', avatar_url: null, scoring: 'PPR' },
              }),
              row('ai-odd', {
                is_big_board: false,
                ai_persona_id: 'p2',
                persona: { username: 'wike-mright-ai', avatar_url: null, scoring: 'Superflex' },
              }),
              row('ai-saved', {
                is_big_board: false,
                ai_persona_id: 'p1',
                persona: { username: 'bathew-merry-ai', avatar_url: null, scoring: 'PPR' },
                scoring_format: 'standard',
              }),
              row('person', { scoring_format: 'ppr' }),
            ],
            error: null,
          }
        : { data: [], error: null }
    const feed = await readCommunityFeed(NOW)
    const by = Object.fromEntries(feed.items.map((i) => [i.id, i]))
    expect(POOL_SELECT).toMatch(/persona:ai_personas[^)]*scoring:style_profile->>scoring_default/)
    expect(by.ai).toMatchObject({ kind: 'rank', scoringFormat: 'ppr', scoring: 'PPR' })
    expect(by.ai!.author.isPersona).toBe(true)
    expect(rankFilterOk(by.ai!, { ...RANK_FILTERS_ALL, scoring: 'ppr' })).toBe(true)
    expect(rankFilterOk(by.ai!, { ...RANK_FILTERS_ALL, scoring: 'half' })).toBe(false)
    // A persona scoring outside the vocabulary: Half PPR, as 190 falls back.
    expect(by['ai-odd']).toMatchObject({ scoringFormat: 'half', scoring: 'Half PPR' })
    // A saved scoring always wins.
    expect(by['ai-saved']).toMatchObject({ scoringFormat: 'standard', scoring: 'Standard' })
    expect(by.person).toMatchObject({ scoringFormat: 'ppr', scoring: 'PPR' })
  })

  it('an AI expert’s switch is read and carried (only a switched-on expert opens in Rankings — gap list §3 #28)', async () => {
    answer = (call) =>
      call.table === 'lists' && !isLatest(call)
        ? {
            data: [
              row('on', {
                is_big_board: false,
                ai_persona_id: 'p1',
                persona: { username: 'bathew-merry-ai', avatar_url: null, scoring: 'PPR', is_active: true },
              }),
              row('off', {
                is_big_board: false,
                ai_persona_id: 'p2',
                persona: { username: 'wike-mright-ai', avatar_url: null, scoring: 'PPR', is_active: false },
              }),
              // Nullable in the schema: only true is on (as `useExpertBoards` filters).
              row('unset', {
                is_big_board: false,
                ai_persona_id: 'p3',
                persona: { username: 'third-ai', avatar_url: null, scoring: 'PPR', is_active: null },
              }),
              row('person'),
            ],
            error: null,
          }
        : { data: [], error: null }
    const feed = await readCommunityFeed(NOW)
    const by = Object.fromEntries(feed.items.map((i) => [i.id, i]))
    expect(POOL_SELECT).toMatch(/persona:ai_personas[^)]*\bis_active\b/)
    expect(by.on!.author).toMatchObject({ isPersona: true, isActive: true })
    expect(by.off!.author).toMatchObject({ isPersona: true, isActive: false })
    expect(by.unset!.author).toMatchObject({ isPersona: true, isActive: false })
    expect(by.person!.author.isActive).toBeUndefined()
  })

  it('likes: the whole last 14 days, paged past the 1000-row cap', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      list_id: 'a',
      user_id: `u${i}`,
      created_at: '2026-10-15T11:00:00Z',
    }))
    const page2 = [
      { list_id: 'z', user_id: 'x', created_at: '2026-10-14T12:00:00Z' },
      { list_id: 'a', user_id: 'y', created_at: null },
    ]
    answer = (call) => {
      if (call.table === 'lists') return { data: isLatest(call) ? [row('z')] : [row('a'), row('b')], error: null }
      const [from] = op(call, 'range')[0] as [number, number]
      return { data: from === 0 ? page1 : page2, error: null }
    }
    const feed = await readCommunityFeed(NOW)
    const likes = calls.filter((c) => c.table === 'list_likes')
    expect(likes).toHaveLength(2)
    expect(op(likes[0]!, 'range')).toEqual([[0, 999]])
    expect(op(likes[1]!, 'range')).toEqual([[1000, 1999]])
    // Not narrowed to the lists read: it's also how liked lists outside the pool are found.
    expect(op(likes[0]!, 'in')).toEqual([])
    expect(op(likes[0]!, 'gte')).toEqual([['created_at', '2026-10-01T12:00:00.000Z']])
    const a = feed.items.find((i) => i.id === 'a')!
    expect(a.recentLikes).toHaveLength(1000) // the untimed like is left to the count
    expect(a.likeCount).toBe(2)
    expect(feed.items.find((i) => i.id === 'b')!.recentLikes).toEqual([])
    expect(feed.latest.map((i) => i.id)).toEqual(['z'])
    expect(feed.latest[0]!.recentLikes).toEqual([Date.parse('2026-10-14T12:00:00Z')])
    // z is liked and outside the pool: a For you candidate — its Latest row
    // reused, not read again.
    expect(feed.popularExtra.map((i) => i.id)).toEqual(['z'])
    expect(calls.filter(isExtra)).toHaveLength(0)
  })

  it('a list liked lately but edited long ago (outside the pool) is read for For you', async () => {
    // `old` was last edited weeks ago — the update-ordered pool doesn't hold
    // it — but it was liked today, more than anything in the pool.
    const likes = [
      ...['u1', 'u2', 'u3'].map((u) => ({ list_id: 'old', user_id: u, created_at: '2026-10-15T10:00:00Z' })),
      { list_id: 'a', user_id: 'u1', created_at: '2026-10-15T09:00:00Z' },
      { list_id: 'gone', user_id: 'u1', created_at: '2026-10-15T08:00:00Z' },
    ]
    answer = (call) => {
      if (call.table === 'list_likes') return { data: likes, error: null }
      if (isExtra(call)) return { data: [row('old', { updated_at: '2026-09-20T00:00:00Z', like_count: 3 })], error: null }
      return { data: isLatest(call) ? [] : [row('a')], error: null }
    }
    const feed = await readCommunityFeed(NOW)
    const [extra, ...more] = calls.filter(isExtra)
    expect(more).toHaveLength(0)
    // Hottest first, the pool's own `a` left out; `gone` (private, deleted or
    // empty) simply doesn't come back through the public filter.
    expect(op(extra!, 'in')).toEqual([['id', ['old', 'gone']]])
    expect(op(extra!, 'select')).toEqual([[POOL_SELECT]])
    expect(op(extra!, 'eq')).toContainEqual(['is_private', false])
    expect(op(extra!, 'is')).toContainEqual(['deleted_at', null])
    expect(op(extra!, 'gt')).toContainEqual(['player_count', 0])
    expect(op(extra!, 'limit')).toContainEqual([4, { referencedTable: 'heads' }])
    expect(feed.items.map((i) => i.id)).toEqual(['a'])
    expect(feed.popularExtra.map((i) => i.id)).toEqual(['old'])
    expect(feed.popularExtra[0]!.recentLikes).toHaveLength(3)
  })

  it('at most LIKED_EXTRA_SIZE liked lists outside the pool are read; a failed read fails the feed', async () => {
    const likes = Array.from({ length: LIKED_EXTRA_SIZE + 5 }, (_, i) => ({
      list_id: `l${i}`,
      user_id: 'u1',
      created_at: '2026-10-15T10:00:00Z',
    }))
    answer = (call) =>
      call.table === 'list_likes'
        ? { data: likes, error: null }
        : isExtra(call)
          ? { data: null, error: { message: 'extra boom' } }
          : { data: [], error: null }
    await expect(readCommunityFeed(NOW)).rejects.toMatchObject({ message: 'extra boom' })
    const [extra] = calls.filter(isExtra)
    expect((op(extra!, 'in')[0] as [string, string[]])[1]).toHaveLength(LIKED_EXTRA_SIZE)
  })

  it('a likes read that fails fails the feed — never a quiet "no likes" order', async () => {
    answer = (call) =>
      call.table === 'list_likes'
        ? { data: null, error: { message: 'boom' } }
        : { data: isLatest(call) ? [] : [row('a')], error: null }
    await expect(readCommunityFeed(NOW)).rejects.toMatchObject({ message: 'boom' })
  })

  it('no recent likes: one likes read, no extra lists read', async () => {
    const feed = await readCommunityFeed(NOW)
    expect(calls.filter((c) => c.table === 'list_likes')).toHaveLength(1)
    expect(calls.filter(isExtra)).toHaveLength(0)
    expect(feed.popularExtra).toEqual([])
  })
})

describe('readInjuryMatches', () => {
  it('asks for pool lists with a player on the injury report (Home’s statuses, on an NFL team), one row each', async () => {
    answer = () => ({ data: [{ id: 'l1', lp: [{}] }, { id: 'l3', lp: [{}] }], error: null })
    const ids = await readInjuryMatches(['l1', 'l2', 'l3'])
    expect([...ids]).toEqual(['l1', 'l3'])
    const [call] = calls
    expect(call!.table).toBe('lists')
    expect(op(call!, 'select')[0]![0]).toMatch(/lp:list_players!inner\(player:players!inner\(status, team\)\)/)
    expect(op(call!, 'in')).toEqual([
      ['id', ['l1', 'l2', 'l3']],
      ['lp.player.status', [...INJURY_STATUSES]],
    ])
    expect(op(call!, 'not')).toEqual([['lp.player.team', 'is', null]])
    expect(op(call!, 'limit')).toEqual([[1, { referencedTable: 'lp' }]])
  })

  it('an error is thrown, not an empty set', async () => {
    answer = () => ({ data: null, error: { message: 'nope' } })
    await expect(readInjuryMatches(['l1'])).rejects.toMatchObject({ message: 'nope' })
  })
})
