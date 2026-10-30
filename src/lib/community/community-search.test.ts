/**
 * `communitySearchHref` — the search screens' one door to community search
 * (plan C3). Pinned: it carries the query and page size; while Community is
 * on it asks for what Community shows — lists only while rankings are off
 * (`ranksOn()`), rankings too once they're on; while Community is off it
 * asks nothing more, so search outside Community is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ community: true, weeklyRanks: false }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))

import { COMMUNITY_SEARCH_SHOW_PARAM, communitySearchHref } from './community-search'

const paramsOf = (href: string) => new URL(href, 'http://localhost').searchParams

beforeEach(() => {
  flags.community = true
  flags.weeklyRanks = false
})

describe('communitySearchHref', () => {
  it('Community on, rankings off: the query, the page size, and lists only', () => {
    const href = communitySearchHref('big board', 30)
    expect(href.startsWith('/api/search/community?')).toBe(true)
    expect(paramsOf(href).get('q')).toBe('big board')
    expect(paramsOf(href).get('limit')).toBe('30')
    // The name the route reads.
    expect(COMMUNITY_SEARCH_SHOW_PARAM).toBe('show')
    expect(paramsOf(href).get('show')).toBe('lists')
  })

  it('Community on, rankings on: rankings too', () => {
    flags.weeklyRanks = true
    expect(paramsOf(communitySearchHref('board', 8)).get('show')).toBe('all')
  })

  it('Community off: search asks what it always asked', () => {
    flags.community = false
    expect(paramsOf(communitySearchHref('board', 8)).has('show')).toBe(false)
    flags.weeklyRanks = true
    expect(paramsOf(communitySearchHref('board', 8)).has('show')).toBe(false)
  })

  it('what a person types stays theirs', () => {
    expect(paramsOf(communitySearchHref('a&b=c %', 8)).get('q')).toBe('a&b=c %')
  })
})
