/**
 * The Community list detail's body. Pinned:
 *  - the kind pill and the projections follow the scoring the ranking counts
 *    as (Chris, 2026-10-16): its saved scoring; none saved is Half PPR; an AI
 *    expert's board with none saved is its persona's usual scoring (what
 *    migration 190 saves) — just "Ranking" until that is read;
 *  - the pill never asks for a scoring system;
 *  - 1-2-3 numbers only on a numbered list (`isNumbered`), "Tier N" headings
 *    only on a tiered one (`hasTiers`) — the phone's List view rule.
 */
import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ListPlayerWithPlayer, ListWithDetails } from '@/hooks/use-lists'

const h = vi.hoisted(() => ({
  list: null as unknown,
  meta: {} as Record<string, unknown>,
  metaArg: undefined as unknown,
}))

// The detail is a Radix dialog in a portal, which renders nothing on the
// server: render its parts in place.
vi.mock('@radix-ui/react-dialog', async () => {
  const react = await import('react')
  const pass = ({ children }: { children?: ReactNode }) => react.createElement(react.Fragment, null, children)
  return {
    Root: pass,
    Portal: pass,
    Content: ({ children }: { children?: ReactNode }) => react.createElement('div', { 'data-dialog': '' }, children),
    Title: ({ children, asChild }: { children?: ReactNode; asChild?: boolean }) =>
      asChild ? react.createElement(react.Fragment, null, children) : react.createElement('h2', null, children),
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/app/explore',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: { personas: false } }))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>() }),
  useToggleFollow: () => ({ mutate: () => {}, isPending: false }),
}))
vi.mock('@/hooks/use-lists', () => ({
  useList: () => ({ data: h.list, isError: false, error: null, refetch: () => {} }),
  useToggleFavorite: () => ({ mutate: () => {}, isPending: false }),
}))
vi.mock('@/hooks/use-mobile-community-detail', () => ({
  useMobileCommunityListMeta: (arg: unknown) => {
    h.metaArg = arg
    return h.meta
  },
}))
vi.mock('@/stores/player-modal-store', () => ({
  usePlayerModalStore: (pick: (s: { openPlayerView: () => void }) => unknown) => pick({ openPlayerView: () => {} }),
}))

import { CommunityDetail } from './community-detail'

const PERSON = { profileId: 'u-kelly', username: 'kelly', avatarUrl: null, followers: 10, isPersona: false }
const EXPERT = { profileId: null, username: 'bathew-merry-ai', avatarUrl: null, followers: null, isPersona: true }

function entry(n: number, tier: string | null = null): ListPlayerWithPlayer {
  return {
    id: `lp-${n}`,
    list_id: 'l1',
    player_id: `p-${n}`,
    position: n,
    tier,
    player: {
      id: `p-${n}`,
      full_name: `Player Number${n}`,
      position: 'WR',
      team: 'PHI',
      headshot_url: null,
      status: null,
      projected_pts_ppr: 20,
      projected_pts_half_ppr: 16,
      projected_pts_standard: 12,
    },
  } as unknown as ListPlayerWithPlayer
}

function list(over: Record<string, unknown> = {}): ListWithDetails {
  return {
    id: 'l1',
    owner_id: 'u-kelly',
    title: 'Week 7 board',
    slug: 'week-7',
    description: null,
    is_big_board: true,
    ai_persona_id: null,
    scoring_system_id: 'ss-1',
    ranking_mode: 'ranked',
    position_filter: null,
    thumbnail_url: null,
    is_owner: false,
    is_favorited: false,
    players: [entry(1), entry(2), entry(3)],
    links: [],
    tags: [],
    ...over,
  } as unknown as ListWithDetails
}

const render = () =>
  renderToStaticMarkup(createElement(Fragment, null, createElement(CommunityDetail, { listId: 'l1', onBack: () => {} })))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')

/** The row numbers, in order (the 13px tabular figure before each headshot). */
const numbers = (out: string) => [...out.matchAll(/tabular-nums text-m-t3">(\d+)<\/span>/g)].map((m) => Number(m[1]))
/** The projections, in order. */
const projections = (out: string) => [...out.matchAll(/tabular-nums">(\d+\.\d)<\/span>/g)].map((m) => m[1])

beforeEach(() => {
  h.list = list()
  h.meta = { data: { ownerUsername: 'kelly', author: PERSON, scoring: null }, isError: false }
  h.metaArg = undefined
})

describe('the Community detail — scoring', () => {
  it('a ranking with no saved scoring: "Ranking · Half PPR" and Half PPR projections', () => {
    const out = render()
    expect(out).toContain('Ranking · Half PPR')
    expect(projections(out)).toEqual(['16.0', '16.0', '16.0'])
  })

  it('a saved scoring wins: 0.25 PPR, halfway between Standard and Half', () => {
    h.list = list({ scoring_format: 'quarter' })
    const out = render()
    expect(out).toContain('Ranking · 0.25 PPR')
    expect(projections(out)).toEqual(['14.0', '14.0', '14.0'])
  })

  it('an AI expert’s board with none saved: its persona’s usual scoring, as 190 saves it', () => {
    h.list = list({ is_big_board: false, ai_persona_id: 'persona-1' })
    h.meta = { data: { ownerUsername: 'fieldscout', author: EXPERT, scoring: 'PPR' }, isError: false }
    const out = render()
    expect(out).toContain('Ranking · PPR')
    expect(projections(out)).toEqual(['20.0', '20.0', '20.0'])
  })

  it('…an unknown one is Half PPR; and until it is read the pill says just "Ranking" (no guessed projections)', () => {
    h.list = list({ is_big_board: false, ai_persona_id: 'persona-1' })
    h.meta = { data: { ownerUsername: 'fieldscout', author: EXPERT, scoring: null }, isError: false }
    expect(render()).toContain('Ranking · Half PPR')
    h.meta = { data: undefined, isError: false }
    const out = render()
    expect(out).toMatch(/>Ranking<\/span>/)
    expect(out).not.toContain('Ranking ·')
    expect(projections(out)).toEqual([])
  })

  it('never asks for a scoring system (190 doesn’t read one)', () => {
    render()
    expect(h.metaArg).toEqual({ owner_id: 'u-kelly', ai_persona_id: null, scoring_system_id: null })
  })
})

describe('the Community detail — numbers and tiers (isNumbered / hasTiers)', () => {
  const tiered = [entry(1, 'S'), entry(2, 'S'), entry(3, 'A')]

  it('a ranked list: 1-2-3, no tier headings', () => {
    h.list = list({ is_big_board: false, slug: 'rb-targets', ranking_mode: 'ranked' })
    const out = render()
    expect(numbers(out)).toEqual([1, 2, 3])
    expect(out).not.toContain('Tier 1')
  })

  it('a plain (unranked) list: no numbers, no headings', () => {
    h.list = list({ is_big_board: false, slug: 'rb-targets', ranking_mode: 'unranked' })
    const out = render()
    expect(numbers(out)).toEqual([])
    expect(out).not.toContain('Tier 1')
    expect(out).toContain('Player Number3')
  })

  it('a tier-only list: tier headings, no numbers', () => {
    h.list = list({ is_big_board: false, slug: 'rb-targets', ranking_mode: 'tier_only', players: tiered })
    const out = render()
    expect(numbers(out)).toEqual([])
    expect(out).toMatch(/<h3[^>]*><span[^>]*>Tier 1<\/span><\/h3>/)
    expect(out).toMatch(/<h3[^>]*><span[^>]*>Tier 2<\/span><\/h3>/)
    // Each player under his tier, in list order (the table, past the cover).
    const table = out.slice(out.indexOf('Players · 3'))
    expect(table.indexOf('Tier 1')).toBeLessThan(table.indexOf('Player Number1'))
    expect(table.indexOf('Player Number2')).toBeLessThan(table.indexOf('Tier 2'))
    expect(table.indexOf('Tier 2')).toBeLessThan(table.indexOf('Player Number3'))
  })

  it('ranked with tiers: the headings, and the numbers run on through them', () => {
    h.list = list({ is_big_board: false, slug: 'rb-targets', ranking_mode: 'rank_and_tier', players: tiered })
    const out = render()
    expect(numbers(out)).toEqual([1, 2, 3])
    expect(out).toContain('Tier 1')
    expect(out).toContain('Tier 2')
  })
})
