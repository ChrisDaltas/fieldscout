/**
 * A league board's reads (gap list §3 #23 — older posts load as you scroll
 * up; it used to stop at the latest 30, silently). Pinned:
 *  - the latest window is unchanged: member posts only, newest 30, shown
 *    oldest first (every board card reads it);
 *  - the `from` read takes every post from `from` on — `(created_at, id) >=
 *    from` — newest first and bounded, and a read that no longer reaches
 *    `from` is recognised (`boardMeetsFrom`), never taken as the whole;
 *  - an older page is the posts just before its cursor — `(created_at, id) <
 *    before`, the activity feed's own boundary, so posts sharing an instant
 *    are neither skipped nor repeated — read one post past a page, so it
 *    knows whether anything older exists without an empty extra read;
 *  - a failed read throws (an error state with a Try again), never an
 *    empty page that would read as "the start".
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

import { activityCursorFilter } from '@/lib/leagues/api/activity-service'

import {
  LEAGUE_CHAT_COLUMNS,
  LEAGUE_CHAT_SINCE_MAX,
  LEAGUE_CHAT_WINDOW,
  boardMeetsFrom,
  chatCursorOf,
  chatSinceFilter,
  leagueChatKeys,
  readLeagueChat,
  windowFrom,
} from './use-league-chat'
import { readOlderChatPage } from './use-league-chat-older'

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)

const T0 = Date.parse('2026-10-15T12:00:00Z')
/** Post `n` (higher = newer), as a read returns it. */
function post(n: number) {
  return {
    id: `p${String(n).padStart(3, '0')}`,
    user_id: 'u1',
    message: `post ${n}`,
    context: 'league',
    is_system: false,
    created_at: new Date(T0 + n * 60_000).toISOString(),
  }
}
/** Posts `hi` down to `lo` — newest first, as the reads order them. */
const newestFirst = (hi: number, lo: number) => Array.from({ length: hi - lo + 1 }, (_, i) => post(hi - i))

beforeEach(() => {
  calls.length = 0
  answer = () => ({ data: [], error: null })
})

describe('the latest window (every board card)', () => {
  it('member posts on this league’s board, newest 30, shown oldest first — no `from` filter', async () => {
    answer = () => ({ data: newestFirst(40, 11), error: null })
    const rows = await readLeagueChat('L1', null)
    const [call] = calls
    expect(call!.table).toBe('league_chat')
    expect(op(call!, 'select')).toEqual([[LEAGUE_CHAT_COLUMNS]])
    expect(op(call!, 'eq')).toEqual([
      ['league_id', 'L1'],
      ['context', 'league'],
      ['is_system', false],
    ])
    expect(op(call!, 'or')).toEqual([])
    expect(op(call!, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(op(call!, 'limit')).toEqual([[LEAGUE_CHAT_WINDOW]])
    expect(LEAGUE_CHAT_WINDOW).toBe(30)
    expect(rows.map((r) => r.message)).toEqual(newestFirst(40, 11).reverse().map((r) => r.message))
  })
})

describe('the `from` read (once older posts are asked for)', () => {
  const from = { at: '2026-10-15T12:11:00.123456+00:00', id: 'p011' }

  it('every post from `from` on — the post at `from` included — newest first, bounded', async () => {
    await readLeagueChat('L1', from)
    const [call] = calls
    expect(op(call!, 'or')).toEqual([[chatSinceFilter(from)]])
    expect(chatSinceFilter(from)).toBe(
      'created_at.gt."2026-10-15T12:11:00.123456+00:00",and(created_at.eq."2026-10-15T12:11:00.123456+00:00",id.gte."p011")',
    )
    expect(op(call!, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(op(call!, 'limit')).toEqual([[LEAGUE_CHAT_SINCE_MAX]])
  })

  it('is the exact other side of the older pages’ boundary: `>= from` here, `< before` there', () => {
    expect(chatSinceFilter(from)).toContain('created_at.gt.')
    expect(chatSinceFilter(from)).toContain('id.gte.')
    expect(activityCursorFilter(from.at, from.id)).toContain('created_at.lt.')
    expect(activityCursorFilter(from.at, from.id)).toContain('id.lt.')
  })

  it('still meets the older pages only while its oldest post IS `from` — a full read that stops short does not', () => {
    expect(boardMeetsFrom([{ id: 'p011' }, { id: 'p012' }], from)).toBe(true)
    expect(boardMeetsFrom([{ id: 'p012' }, { id: 'p013' }], from)).toBe(false)
    expect(boardMeetsFrom([], from)).toBe(false)
  })

  it('starts out holding the window already on screen, from `from` on', () => {
    const onScreen = [{ id: 'p010' }, { id: 'p011' }, { id: 'p012' }]
    expect(windowFrom(onScreen, from)).toEqual([{ id: 'p011' }, { id: 'p012' }])
    expect(windowFrom([{ id: 'p012' }], from)).toBeUndefined()
    expect(windowFrom(undefined, from)).toBeUndefined()
  })

  it('lives under the board key (a broadcast or a send re-reads it); the older pages do not', () => {
    const board = leagueChatKeys.board('L1')
    expect(leagueChatKeys.since('L1', from).slice(0, board.length)).toEqual([...board])
    expect(leagueChatKeys.older('L1', from).slice(0, board.length)).not.toEqual([...board])
  })

  it('a post with no instant can’t be paged from', () => {
    expect(chatCursorOf({ id: 'x', created_at: null })).toBeNull()
    expect(chatCursorOf({ id: 'x', created_at: '2026-10-15T12:00:00Z' })).toEqual({ at: '2026-10-15T12:00:00Z', id: 'x' })
  })
})

describe('an older page', () => {
  const before = { at: post(31).created_at, id: post(31).id }

  it('the posts just before the cursor — the activity feed’s boundary — one past a page, newest first', async () => {
    await readOlderChatPage('L1', before)
    const [call] = calls
    expect(op(call!, 'eq')).toEqual([
      ['league_id', 'L1'],
      ['context', 'league'],
      ['is_system', false],
    ])
    expect(op(call!, 'or')).toEqual([[activityCursorFilter(before.at, before.id)]])
    expect(op(call!, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(op(call!, 'limit')).toEqual([[LEAGUE_CHAT_WINDOW + 1]])
  })

  it('a read past a full page: shows the page oldest first, and the next page ends at its oldest post', async () => {
    answer = () => ({ data: newestFirst(30, 0), error: null }) // 31 posts
    const page = await readOlderChatPage('L1', before)
    expect(page.rows).toHaveLength(LEAGUE_CHAT_WINDOW)
    expect(page.rows.map((r) => r.message)).toEqual(newestFirst(30, 1).reverse().map((r) => r.message))
    expect(page.next).toEqual({ at: post(1).created_at, id: post(1).id })
  })

  it('a page of exactly 30 with nothing older is the start — no empty extra read', async () => {
    answer = () => ({ data: newestFirst(30, 1), error: null })
    const page = await readOlderChatPage('L1', before)
    expect(page.rows).toHaveLength(30)
    expect(page.next).toBeNull()
  })

  it('nothing older: the start, not an error', async () => {
    expect(await readOlderChatPage('L1', before)).toEqual({ rows: [], next: null })
  })

  it('a failed read throws — never an empty page that would read as the start', async () => {
    answer = () => ({ data: null, error: { message: 'boom' } })
    await expect(readOlderChatPage('L1', before)).rejects.toMatchObject({ message: 'boom' })
    await expect(readLeagueChat('L1', null)).rejects.toMatchObject({ message: 'boom' })
  })
})
