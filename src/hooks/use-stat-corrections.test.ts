/**
 * use-stat-corrections.test.ts — the hook's pure halves (M6 L.E2.3; D454):
 * the query string, the page cursor it follows, and the deploy-before-push
 * arm (the route's named 503 ⇒ `unavailable` with the server's sentence —
 * never an empty list, never a thrown error screen).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CORRECTIONS_UNAVAILABLE_MESSAGE, type StatCorrectionsPage } from '@/lib/leagues/api/corrections-service'

import { CORRECTIONS_INVALIDATING_EVENTS, LEAGUE_CHANNEL_EVENTS } from './use-league-channel-ops'
import {
  fetchStatCorrections,
  statCorrectionsEventEffect,
  statCorrectionsHandlers,
  statCorrectionsNextCursor,
  statCorrectionsSearchParams,
} from './use-stat-corrections'

const LEAGUE = '00000000-0000-4000-8000-0000000000aa'

function page(overrides: Partial<StatCorrectionsPage> = {}): StatCorrectionsPage {
  return { week: null, items: [], limit: 50, has_more: false, next_cursor: null, note: null, ...overrides }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useStatCorrections — the pure halves', () => {
  it('only the params that are SET reach the query string; the cursor travels as given', () => {
    expect(statCorrectionsSearchParams({})).toBe('')
    expect(statCorrectionsSearchParams({ week: 3 })).toBe('?week=3')
    expect(statCorrectionsSearchParams({ week: 3, limit: 10 }, 'tok')).toBe('?week=3&limit=10&cursor=tok')
  })

  it('follows the server\'s next_cursor only while it says there is more', () => {
    expect(statCorrectionsNextCursor({ state: 'known', page: page({ has_more: true, next_cursor: 'tok' }) })).toBe('tok')
    expect(statCorrectionsNextCursor({ state: 'known', page: page() })).toBeUndefined()
    expect(statCorrectionsNextCursor({ state: 'unavailable', reason: 'x' })).toBeUndefined()
  })

  it('the route\'s named 503 (a database without 172) is `unavailable` with the server\'s sentence', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: CORRECTIONS_UNAVAILABLE_MESSAGE }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchStatCorrections(LEAGUE, { week: 2 })).toEqual({ state: 'unavailable', reason: CORRECTIONS_UNAVAILABLE_MESSAGE })
    expect(fetchMock.mock.calls[0]).toEqual([`/api/leagues/${LEAGUE}/corrections?week=2`, undefined])
  })

  it('R1350: a 503 that is NOT the named sentence (a gateway, an upstream outage) still throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 })))
    await expect(fetchStatCorrections(LEAGUE, {})).rejects.toMatchObject({ status: 503, message: 'Service Unavailable' })
  })

  it('any other failure still throws — a 403 is never demoted to "unavailable"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Only members of this league can view it.' }), { status: 403 })))
    await expect(fetchStatCorrections(LEAGUE, {})).rejects.toMatchObject({ status: 403, message: 'Only members of this league can view it.' })
  })

  it('a 200 is the page, as sent', async () => {
    const body = page({ week: 1, note: 'No stat correction changed a score in this league in Week 1.' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    expect(await fetchStatCorrections(LEAGUE, { week: 1 })).toEqual({ state: 'known', page: body })
  })
})

/** The scoring door's post as 070's `league_chat_broadcast_payload` ships it (172:856-857). */
function doorPost(week: number, over: Record<string, unknown> = {}) {
  return {
    operation: 'INSERT',
    record: {
      id: 'chat-1',
      user_id: null,
      message: `Stat correction (Week ${week}): Lou Receiver's receiving yards 100 → 94 — Team One 101.20 → 100.60.`,
      context: 'league',
      is_system: true,
      created_at: '2099-09-24T15:00:00Z',
      ...over,
    },
  }
}

describe('F527 — the list refreshes when the scoring door announces a correction (M6 L.E2.4)', () => {
  it('the carrier is the door\'s league post, and ONLY league_chat — a score tick is not a record', () => {
    expect([...CORRECTIONS_INVALIDATING_EVENTS]).toEqual(['league_chat'])
    for (const quiet of LEAGUE_CHANNEL_EVENTS.filter((e) => e !== 'league_chat')) {
      expect(statCorrectionsEventEffect(quiet, doorPost(3)), quiet).toBe('ignore')
    }
  })

  it('the door\'s post refetches — any week for the whole list, only its week for a filtered one', () => {
    expect(statCorrectionsEventEffect('league_chat', doorPost(3))).toBe('refetch')
    expect(statCorrectionsEventEffect('league_chat', doorPost(3), 3)).toBe('refetch')
    expect(statCorrectionsEventEffect('league_chat', doorPost(4), 3)).toBe('ignore')
  })

  it('a member\'s chat line, a commissioner post with the prefix (R1349) and a non-system row are inert', () => {
    expect(statCorrectionsEventEffect('league_chat', doorPost(3, { user_id: 'u-commish' }))).toBe('ignore')
    expect(statCorrectionsEventEffect('league_chat', doorPost(3, { is_system: false }))).toBe('ignore')
    expect(statCorrectionsEventEffect('league_chat', doorPost(3, { message: 'Week 3 was finalized.' }))).toBe('ignore')
    expect(statCorrectionsEventEffect('league_chat', { operation: 'INSERT', record: null })).toBe('ignore')
    expect(statCorrectionsEventEffect('league_chat', undefined)).toBe('ignore')
  })

  it('the handler map is DERIVED from the predicate (R773) and calls invalidate only on the door\'s post', () => {
    const invalidate = vi.fn()
    const handlers = statCorrectionsHandlers(undefined, invalidate)
    expect(Object.keys(handlers)).toEqual(['league_chat'])
    handlers.league_chat?.(doorPost(3, { user_id: 'u-1' }))
    expect(invalidate).not.toHaveBeenCalled()
    handlers.league_chat?.(doorPost(3))
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('172\'s door writes the post this reducer reads: no actor, a system row, league context', () => {
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/172_league_stat_corrections.sql'), 'utf8')
    expect(sql).toContain('INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)')
    expect(sql).toContain("VALUES (p_league_id, NULL, v_post, 'league', TRUE);")
    // 070's broadcast payload carries the three fields the reducer reads.
    const rt = readFileSync(path.join(process.cwd(), 'supabase/migrations/070_draft_realtime.sql'), 'utf8')
    for (const field of ["'user_id',    c.user_id", "'message',    c.message", "'is_system',  c.is_system"]) expect(rt).toContain(field)
  })
})
