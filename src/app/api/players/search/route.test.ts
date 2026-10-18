/**
 * GET /api/players/search — the phone search's team-code match (gap list
 * §3 #1): with `matchTeam=true`, a query that IS a team code ("phi") also
 * finds that team's players. Pinned here:
 *   1. Off by default — every other caller keeps its name-only filter.
 *   2. Only a 2–3 letter query is treated as a code, and only upper-cased
 *      letters reach the filter string (nothing else the user typed).
 *   3. The typed text is a quoted value: a comma or bracket ("Smith, J")
 *      can't split the filter (PostgREST refused it → a 500 for good).
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
    expect(h.state.or[0]).toBe('full_name.ilike."%phi%",search_name.ilike."%phi%"')
  })

  it('asked for, a 2–3 letter query also matches that team, upper-cased', async () => {
    await search('q=phi&matchTeam=true')
    expect(h.state.or[0]).toBe('full_name.ilike."%phi%",search_name.ilike."%phi%",team.eq.PHI')
    await search('q=SF&matchTeam=true')
    expect(h.state.or[1]).toBe('full_name.ilike."%SF%",search_name.ilike."%SF%",team.eq.SF')
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

describe('the typed text stays one value', () => {
  /** The filter's terms, split the way PostgREST does: on commas outside
   *  double quotes (a backslash escapes the next character inside them). */
  const terms = (f: string) => {
    const out: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < f.length; i++) {
      const c = f[i]
      if (quoted && c === '\\') {
        cur += c + f[++i]
        continue
      }
      if (c === '"') quoted = !quoted
      if (c === ',' && !quoted) {
        out.push(cur)
        cur = ''
      } else cur += c
    }
    return [...out, cur]
  }

  it('a comma ("Smith, J") is answered, and the filter stays its terms', async () => {
    const res = await search(`q=${encodeURIComponent('Smith, J')}&limit=30&matchTeam=true`)
    expect(res.status).toBe(200)
    expect(h.state.or[0]).toBe('full_name.ilike."%Smith, J%",search_name.ilike."%Smith,J%"')
    expect(terms(h.state.or[0])).toEqual(['full_name.ilike."%Smith, J%"', 'search_name.ilike."%Smith,J%"'])
  })

  it('brackets stay inside the value; a team code is still its own term', async () => {
    await search(`q=${encodeURIComponent('a(b)')}&matchTeam=true`)
    expect(terms(h.state.or[0])).toEqual(['full_name.ilike."%a(b)%"', 'search_name.ilike."%a(b)%"'])
    await search('q=phi&matchTeam=true')
    expect(terms(h.state.or[1])).toEqual(['full_name.ilike."%phi%"', 'search_name.ilike."%phi%"', 'team.eq.PHI'])
  })

  it('a quote or backslash is escaped for the quotes; % and _ stay literal', async () => {
    await search(`q=${encodeURIComponent('a"b\\c')}`)
    // LIKE-escaped (\\ for the backslash), then each \\ and " escaped once more.
    expect(h.state.or[0]).toBe('full_name.ilike."%a\\"b\\\\\\\\c%",search_name.ilike."%a\\"b\\\\\\\\c%"')
    await search(`q=${encodeURIComponent('100%_')}`)
    expect(h.state.or[1]).toBe('full_name.ilike."%100\\\\%\\\\_%",search_name.ilike."%100\\\\%\\\\_%"')
    expect(terms(h.state.or[0])).toHaveLength(2)
  })
})
