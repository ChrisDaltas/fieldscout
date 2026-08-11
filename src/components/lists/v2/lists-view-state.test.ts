import { describe, expect, it } from 'vitest'

import {
  formatCreated,
  listPositions,
  PAGE_MODES,
  partitionLists,
  playerCountLabel,
} from './lists-view-state'

import type { ListWithTags } from '@/hooks/use-lists'

function makeList(over: Partial<ListWithTags> & { id: string }): ListWithTags {
  return {
    id: over.id,
    title: over.title ?? 'A list',
    slug: over.slug ?? 'a-list',
    owner_id: over.owner_id ?? 'u1',
    created_at: over.created_at ?? '2026-08-08T12:00:00Z',
    updated_at: over.updated_at ?? '2026-08-08T12:00:00Z',
    deleted_at: null,
    description: over.description ?? null,
    player_count: over.player_count ?? 0,
    is_favorites: over.is_favorites ?? false,
    is_favorited: over.is_favorited ?? false,
    is_private: over.is_private ?? false,
    is_big_board: false,
    is_team: false,
    position_filter: over.position_filter ?? null,
    ranking_mode: over.ranking_mode ?? 'rank_only',
    thumbnail_url: over.thumbnail_url ?? null,
    view_count: over.view_count ?? 0,
    like_count: over.like_count ?? 0,
    ai_persona_id: null,
    comments_enabled: true,
    folder_id: null,
    hide_order: false,
    roster_settings: null,
    scoring_system_id: null,
    tiers_enabled: false,
    tags: over.tags ?? [],
    first_players: over.first_players ?? [],
    owner: over.owner ?? null,
  } as ListWithTags
}

describe('partitionLists', () => {
  it('splits on the server-set owner field, not a client auth guess', () => {
    const own = makeList({ id: 'a' })
    const savedFromSomeoneElse = makeList({
      id: 'b',
      owner: { username: 'gridironguru', avatar_url: null },
    })
    const { mine, saved } = partitionLists([own, savedFromSomeoneElse])
    expect(mine.map((l) => l.id)).toEqual(['a'])
    expect(saved.map((l) => l.id)).toEqual(['b'])
  })

  it('floats Favorites to the top of My lists and keeps the rest in API order', () => {
    const lists = [
      makeList({ id: 'x' }),
      makeList({ id: 'y' }),
      makeList({ id: 'fav', is_favorites: true }),
      makeList({ id: 'z' }),
    ]
    expect(partitionLists(lists).mine.map((l) => l.id)).toEqual(['fav', 'x', 'y', 'z'])
  })

  it('returns two empty arrays for an empty collection', () => {
    expect(partitionLists([])).toEqual({ mine: [], saved: [] })
  })
})

describe('formatCreated', () => {
  const now = new Date('2026-08-10T00:00:00Z')

  it('omits the year inside the current year', () => {
    expect(formatCreated('2026-08-08T12:00:00Z', now)).toBe('Aug 8')
  })

  it('includes the year for any other year', () => {
    expect(formatCreated('2025-11-09T12:00:00Z', now)).toBe('Nov 9, 2025')
  })

  // A missing created_at must render as nothing, not as "Invalid Date" — the
  // rail's meta line concatenates this with the player count.
  it('renders empty rather than a broken date', () => {
    expect(formatCreated(null, now)).toBe('')
    expect(formatCreated(undefined, now)).toBe('')
    expect(formatCreated('not-a-date', now)).toBe('')
  })
})

describe('playerCountLabel', () => {
  it('singularizes one and pluralizes the rest, including null', () => {
    expect(playerCountLabel(1)).toBe('1 player')
    expect(playerCountLabel(0)).toBe('0 players')
    expect(playerCountLabel(24)).toBe('24 players')
    expect(playerCountLabel(null)).toBe('0 players')
  })
})

describe('listPositions', () => {
  it('de-duplicates in list order and skips players with no position', () => {
    const list = makeList({
      id: 'a',
      first_players: [
        { id: '1', full_name: 'A', team: 'KC', headshot_url: null, position: 'WR' },
        { id: '2', full_name: 'B', team: 'SF', headshot_url: null, position: 'WR' },
        { id: '3', full_name: 'C', team: 'BUF', headshot_url: null, position: null },
        { id: '4', full_name: 'D', team: 'MIA', headshot_url: null, position: 'RB' },
      ],
    })
    expect(listPositions(list)).toEqual(['WR', 'RB'])
  })

  it('handles a list with no embedded players', () => {
    expect(listPositions(makeList({ id: 'a', first_players: [] }))).toEqual([])
  })
})

describe('PAGE_MODES', () => {
  // Round 2 scope guard: side-by-side compare must stay disabled until the
  // Round 2 task builds it (delivery plan §6).
  it('offers list and cards, with side by side present but disabled', () => {
    expect(PAGE_MODES.map((m) => m.id)).toEqual(['rail', 'gallery', 'compare'])
    expect(PAGE_MODES.filter((m) => m.disabled).map((m) => m.id)).toEqual(['compare'])
  })
})
