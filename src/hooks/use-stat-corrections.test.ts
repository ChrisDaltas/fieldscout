/**
 * use-stat-corrections.test.ts — the hook's pure halves (M6 L.E2.3; D454):
 * the query string, the page cursor it follows, and the deploy-before-push
 * arm (the route's named 503 ⇒ `unavailable` with the server's sentence —
 * never an empty list, never a thrown error screen).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CORRECTIONS_UNAVAILABLE_MESSAGE, type StatCorrectionsPage } from '@/lib/leagues/api/corrections-service'

import { fetchStatCorrections, statCorrectionsNextCursor, statCorrectionsSearchParams } from './use-stat-corrections'

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
