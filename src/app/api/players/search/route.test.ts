/**
 * GET /api/players/search — the phone search's team-code match (gap list
 * §3 #1): with `matchTeam=true`, a query that IS a team code ("phi") also
 * finds that team's players. Pinned here:
 *   1. Off by default — every other caller keeps its name-only filter.
 *   2. Only a 2–3 letter query is treated as a code, and only upper-cased
 *      letters reach the filter string (nothing else the user typed).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { or: [] as string[] }
  interface Builder extends PromiseLike<{ data: unknown[]; error: null }> {
    select: () => Builder
    or: (f: string) => Builder
    order: () => Builder
    limit: () => Builder
    eq: () => Builder
    not: () => Builder
  }
  const builder = (): Builder => {
    const b: Builder = {
      select: () => b,
      or: (f) => {
        state.or.push(f)
        return b
      },
      order: () => b,
      limit: () => b,
      eq: () => b,
      not: () => b,
      then: (onFulfilled, onRejected) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
    }
    return b
  }
  return { state, client: { from: () => builder() } }
})

vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.client }))

import { GET } from './route'

const search = (qs: string) => GET(new Request(`http://localhost/api/players/search?${qs}`))

beforeEach(() => {
  h.state.or = []
})

describe('the team-code match', () => {
  it('is off unless asked for', async () => {
    expect((await search('q=phi')).status).toBe(200)
    expect(h.state.or[0]).toBe('full_name.ilike.%phi%,search_name.ilike.%phi%')
  })

  it('asked for, a 2–3 letter query also matches that team, upper-cased', async () => {
    await search('q=phi&matchTeam=true')
    expect(h.state.or[0]).toBe('full_name.ilike.%phi%,search_name.ilike.%phi%,team.eq.PHI')
    await search('q=SF&matchTeam=true')
    expect(h.state.or[1]).toBe('full_name.ilike.%SF%,search_name.ilike.%SF%,team.eq.SF')
  })

  it('anything that isn’t a bare code stays a name search', async () => {
    for (const q of ['puka', 'p', 'ph1', 'a,b', 'ph i']) await search(`q=${encodeURIComponent(q)}&matchTeam=true`)
    expect(h.state.or.every((f) => !f.includes('team.eq.'))).toBe(true)
  })

  it('matchTeam takes only true or false', async () => {
    expect((await search('q=phi&matchTeam=yes')).status).toBe(400)
    await search('q=phi&matchTeam=false')
    expect(h.state.or[0]).not.toContain('team.eq.')
  })
})
