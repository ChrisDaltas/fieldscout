/**
 * commish-page.test.ts — M6 L.E1.33's proof "a manager gets the league page,
 * not the console": the console's SERVER component decides before anything
 * renders (`readCommishConsoleGate` over `is_league_commish`, 052), and sends
 * everyone who is not a commissioner or co-commissioner to the league page.
 * A hidden nav link is not the gate — this is.
 *
 * Driven through the real page module with the two edges mocked: the
 * Supabase server client (its `rpc` answers as the database would for each
 * role) and Next's `redirect` (which throws in Next; here it records and
 * throws the same way, so nothing after it can run).
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

import { CommishConsole } from '@/components/leagues/commish-console'
import { readCommishConsoleGate } from '@/lib/leagues/api/commish-console-gate'

import CommishConsolePage from './page'

const LEAGUE = 'c3300000-0000-4000-8000-000000000001'

async function open(leagueId: string): Promise<{ redirectedTo: string } | { rendered: unknown }> {
  try {
    const element = await CommishConsolePage({ params: Promise.resolve({ leagueId }) })
    return { rendered: element }
  } catch (e) {
    if (e instanceof RedirectSignal) return { redirectedTo: e.to }
    throw e
  }
}

afterEach(() => {
  rpc.mockReset()
})

describe('the Commissioner Console page — commissioners only, decided on the server', () => {
  it('a MANAGER is redirected to the league page and the console never renders', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    const outcome = await open(LEAGUE)
    expect(outcome).toEqual({ redirectedTo: `/app/leagues/${LEAGUE}` })
    expect(rpc).toHaveBeenCalledWith('is_league_commish', { p_league_id: LEAGUE })
  })

  it('a commissioner (or co-commissioner — the same predicate) gets the console', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const outcome = await open(LEAGUE)
    expect('rendered' in outcome).toBe(true)
    const element = (outcome as { rendered: unknown }).rendered
    expect(isValidElement(element)).toBe(true)
    expect((element as { type: unknown }).type).toBe(CommishConsole)
    expect((element as { props: { leagueId: string } }).props.leagueId).toBe(LEAGUE)
  })

  it('a non-member / unknown league gets the same answer as a manager (no leak) — and a non-UUID id asks nothing', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    expect(await open(LEAGUE)).toEqual({ redirectedTo: `/app/leagues/${LEAGUE}` })
    rpc.mockReset()
    expect(await open('not-a-league')).toEqual({ redirectedTo: '/app/leagues/not-a-league' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a FAILED check is loud — never read as "not a commissioner" (no silent bounce)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    await expect(open(LEAGUE)).rejects.toThrow('is_league_commish: connection reset')
  })

  it('the gate answers null / non-boolean as NOT a commissioner (only a literal true opens it)', async () => {
    for (const data of [null, 'true', 1]) {
      rpc.mockResolvedValueOnce({ data, error: null })
      expect(await readCommishConsoleGate({ rpc } as never, LEAGUE)).toBe('league_page')
    }
  })
})
