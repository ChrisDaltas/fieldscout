/**
 * activity-page.test.ts — M6 L.E1.34's server gate ("members only, decided on
 * the server") and the old `/corrections` route's redirect (F536; PROGRESS
 * D459). Driven through the real page modules with the two edges mocked: the
 * Supabase server client (its `rpc` answers as the database would) and Next's
 * `redirect` (which throws in Next; here it records and throws the same way).
 */
import { isValidElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ rpc }),
}))

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT ${to}`)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to)
  },
}))

import { ActivityPage } from '@/components/leagues/activity-page'

import LeagueCorrectionsRoute from '../corrections/page'
import LeagueActivityRoute from './page'

const LEAGUE = 'c3340000-0000-4000-8000-000000000001'

async function open(leagueId: string, query: Record<string, string> = {}): Promise<{ redirectedTo: string } | { rendered: unknown }> {
  try {
    const element = await LeagueActivityRoute({ params: Promise.resolve({ leagueId }), searchParams: Promise.resolve(query) })
    return { rendered: element }
  } catch (e) {
    if (e instanceof RedirectSignal) return { redirectedTo: e.to }
    throw e
  }
}

afterEach(() => {
  rpc.mockReset()
})

describe('the Activity page — members only, decided on the server', () => {
  it('a NON-MEMBER is sent to the league page and the page never renders; the check is is_league_member', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    expect(await open(LEAGUE)).toEqual({ redirectedTo: `/app/leagues/${LEAGUE}` })
    expect(rpc).toHaveBeenCalledWith('is_league_member', { p_league_id: LEAGUE })
  })

  it('a MEMBER gets the page, opened on the tab and filters the URL names', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const outcome = await open(LEAGUE, { tab: 'commissioner', week: '4' })
    expect('rendered' in outcome).toBe(true)
    const element = (outcome as { rendered: unknown }).rendered
    expect(isValidElement(element)).toBe(true)
    expect((element as { type: unknown }).type).toBe(ActivityPage)
    expect((element as { props: unknown }).props).toStrictEqual({ leagueId: LEAGUE, initial: { tab: 'commissioner', week: 4, team: null, entry: null } })
  })

  it('a non-UUID id is asked nothing and gets the same answer; only a literal true opens it', async () => {
    expect(await open('not-a-league')).toEqual({ redirectedTo: '/app/leagues/not-a-league' })
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValue({ data: 'true', error: null })
    expect(await open(LEAGUE)).toEqual({ redirectedTo: `/app/leagues/${LEAGUE}` })
  })

  it('a failed check is LOUD — thrown, never read as "not a member"', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    await expect(open(LEAGUE)).rejects.toThrow('is_league_member: db down')
  })
})

describe('the old /corrections route — a deep link to the tab (F536)', () => {
  const go = async (query: Record<string, string>) => {
    try {
      await LeagueCorrectionsRoute({ params: Promise.resolve({ leagueId: LEAGUE }), searchParams: Promise.resolve(query) })
      return null
    } catch (e) {
      if (e instanceof RedirectSignal) return e.to
      throw e
    }
  }
  it('redirects to the Activity page’s Stat corrections tab, week and all', async () => {
    expect(await go({ week: '3' })).toBe(`/app/leagues/${LEAGUE}/activity?tab=corrections&week=3`)
    expect(await go({})).toBe(`/app/leagues/${LEAGUE}/activity?tab=corrections`)
    expect(await go({ week: 'bogus' })).toBe(`/app/leagues/${LEAGUE}/activity?tab=corrections`)
  })
})
