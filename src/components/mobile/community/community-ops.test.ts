import { describe, expect, it } from 'vitest'

import { parseRankingsParams } from '@/components/mobile/rankings/rankings-ops'
import type { CommunityItem, CommunityPlayer } from '@/hooks/use-mobile-community-feed'

import {
  CREATE_LIST_HREF,
  CREATE_RANKING_HREF,
  RANK_FILTERS_ALL,
  RANK_POS_CHIPS,
  RANK_SCORING_CHIPS,
  RANK_TYPE_CHIPS,
  classifyCommunityList,
  coverHeight,
  deriveTopics,
  emptyCopy,
  filterItems,
  formatFollows,
  normQuery,
  personaScoring,
  playerMeta,
  rankFilterOk,
  recentUpdates,
  scoringLabel,
  shortName,
  topLine,
  updatedAgo,
} from './community-ops'

const player = (id: string, full_name: string, position = 'WR', team = 'PHI'): CommunityPlayer => ({
  id,
  full_name,
  position,
  team,
  headshot_url: null,
})

function item(over: Partial<CommunityItem> & { id: string }): CommunityItem {
  return {
    title: 'A list',
    slug: over.id,
    description: null,
    kind: 'list',
    rankType: null,
    positionFilter: null,
    scoring: null,
    playerCount: 3,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    thumbnailUrl: null,
    ownerUsername: 'kelly',
    author: { profileId: 'u-kelly', username: 'kelly', avatarUrl: null, followers: 10, isPersona: false },
    heads: [],
    tags: [],
    videos: [],
    ...over,
  }
}

describe('rankings vs lists', () => {
  it('big board → pre-draft ranking; weekly board slug → weekly ranking; AI expert → ranking; else a list', () => {
    expect(classifyCommunityList({ is_big_board: true, slug: 'big-board', ai_persona_id: null })).toEqual({ kind: 'rank', rankType: 'pre' })
    expect(classifyCommunityList({ is_big_board: false, slug: 'week-3-big-board-1783537316215', ai_persona_id: null })).toEqual({
      kind: 'rank',
      rankType: 'weekly',
    })
    expect(classifyCommunityList({ is_big_board: false, slug: 'wike-mright-ai-qb', ai_persona_id: 'p1' })).toEqual({ kind: 'rank', rankType: null })
    // A person's own ordered list is still a list.
    expect(classifyCommunityList({ is_big_board: false, slug: 'rb-targets', ai_persona_id: null })).toEqual({ kind: 'list', rankType: null })
    expect(classifyCommunityList({ is_big_board: null, slug: 'weekly-sleepers', ai_persona_id: null }).kind).toBe('list')
  })

  it('scoring from points per reception, or an AI expert default', () => {
    expect(scoringLabel({ receptions: 1 })).toBe('PPR')
    expect(scoringLabel({ receptions: 0.5 })).toBe('Half PPR')
    expect(scoringLabel({ receptions: 0 })).toBe('Standard')
    expect(scoringLabel(null)).toBeNull()
    expect(scoringLabel({})).toBeNull()
    expect(personaScoring('Half-PPR')).toBe('Half PPR')
    expect(personaScoring('PPR')).toBe('PPR')
    expect(personaScoring(null)).toBeNull()
  })
})

describe('formats', () => {
  it('short names follow the handoff', () => {
    expect(shortName('DK Metcalf')).toBe('D. Metcalf')
    expect(shortName('A.J. Brown')).toBe('A.J. Brown')
    expect(shortName('Amon-Ra St. Brown')).toBe('A. St. Brown')
    expect(shortName('Steelers D/ST')).toBe('Steelers D/ST')
    expect(shortName('Pittsburgh Steelers', 'DEF')).toBe('Pittsburgh Steelers')
  })
  it('top line is single-spaced', () => {
    expect(topLine([player('1', 'Bijan Robinson'), player('2', 'Jonathan Taylor'), player('3', 'Kyren Williams'), player('4', 'X Y')])).toBe(
      '1. B. Robinson 2. J. Taylor 3. K. Williams',
    )
  })
  it('meta reads POS · TEAM with D/ST', () => {
    expect(playerMeta({ position: 'RB', team: 'ATL' })).toBe('RB · ATL')
    expect(playerMeta({ position: 'DEF', team: 'PIT' })).toBe('D/ST · PIT')
  })
  it('follow counts', () => {
    expect(formatFollows(12000)).toBe('12k follows')
    expect(formatFollows(8400)).toBe('8.4k follows')
    expect(formatFollows(640)).toBe('640 follows')
    expect(formatFollows(1)).toBe('1 follow')
  })
  it('relative update times', () => {
    const now = Date.parse('2026-10-15T12:00:00Z')
    expect(updatedAgo('2026-10-15T11:20:00Z', now)).toBe('Updated 40m ago')
    expect(updatedAgo('2026-10-15T11:00:00Z', now)).toBe('Updated 1h ago')
    expect(updatedAgo('2026-10-13T12:00:00Z', now)).toBe('Updated 2d ago')
    expect(updatedAgo('2026-10-15T11:59:40Z', now)).toBe('Updated just now')
  })
  it('cover heights are one of three, stable per id', () => {
    const hs = new Set(Array.from({ length: 30 }, (_, i) => coverHeight(`list-${i}`)))
    expect([...hs].every((h) => h === 150 || h === 180 || h === 205)).toBe(true)
    expect(hs.size).toBe(3)
    expect(coverHeight('abc')).toBe(coverHeight('abc'))
  })
})

describe('Create sheet destinations', () => {
  it('Ranking opens the new-ranking wizard (step 1), not the Rankings hub', () => {
    const sp = new URL(CREATE_RANKING_HREF, 'https://fieldscout.gg').searchParams
    expect(new URL(CREATE_RANKING_HREF, 'https://fieldscout.gg').pathname).toBe('/app/weekly-ranks')
    expect(parseRankingsParams(sp, { type: 'w5' }).overlay).toMatchObject({ kind: 'new', step: 1, type: 'w5' })
  })
  it('List opens the mobile New list screen', () => {
    expect(CREATE_LIST_HREF).toBe('/app/lists/new?from=back')
  })
})

describe('filters', () => {
  const puka = player('p-puka', 'Puka Nacua', 'WR', 'LAR')
  const kittle = player('p-kittle', 'George Kittle', 'TE', 'SF')
  const r1 = item({ id: 'r1', kind: 'rank', rankType: 'weekly', positionFilter: 'RB', scoring: 'PPR', title: 'Week 5 RB', heads: [puka] })
  const r2 = item({
    id: 'r2',
    kind: 'rank',
    rankType: 'pre',
    positionFilter: 'WR',
    scoring: 'Standard',
    author: { profileId: 'u-ortiz', username: 'ortizff', avatarUrl: null, followers: 8400, isPersona: false },
    heads: [puka, kittle],
  })
  const ai = item({
    id: 'ai',
    kind: 'rank',
    positionFilter: 'QB',
    scoring: 'Half PPR',
    author: { profileId: null, username: 'bathew-merry-ai', avatarUrl: null, followers: null, isPersona: true },
  })
  const l1 = item({
    id: 'l1',
    title: 'Buy-low WRs',
    description: 'Targets are there',
    tags: [{ id: 't-sleep', name: 'Sleeper picks', slug: 'sleeper-picks' }],
    heads: [kittle],
  })
  const pool = [r1, r2, ai, l1]
  const base = { tab: 'all' as const, topic: null, q: '', followingIds: new Set<string>() }

  it('tabs: following needs a followed person; start or sit has nothing yet', () => {
    expect(filterItems(pool, base).map((i) => i.id)).toEqual(['r1', 'r2', 'ai', 'l1'])
    expect(filterItems(pool, { ...base, tab: 'rank' }).map((i) => i.id)).toEqual(['r1', 'r2', 'ai'])
    expect(filterItems(pool, { ...base, tab: 'list' }).map((i) => i.id)).toEqual(['l1'])
    expect(filterItems(pool, { ...base, tab: 'poll' })).toEqual([])
    expect(filterItems(pool, { ...base, tab: 'following', followingIds: new Set(['u-ortiz']) }).map((i) => i.id)).toEqual(['r2'])
  })

  it('topics: a tag, or a player (server set when known, else the cover players)', () => {
    const tag = { kind: 'tag' as const, id: 't-sleep', label: 'Sleeper picks' }
    expect(filterItems(pool, { ...base, topic: tag }).map((i) => i.id)).toEqual(['l1'])
    const p = { kind: 'player' as const, id: 'p-puka', label: 'Puka Nacua', player: puka }
    expect(filterItems(pool, { ...base, topic: p }).map((i) => i.id)).toEqual(['r1', 'r2'])
    expect(filterItems(pool, { ...base, topic: p, topicListIds: new Set(['l1']) }).map((i) => i.id)).toEqual(['l1'])
  })

  it('query: title, handle, description, tags, players — plus server player matches', () => {
    expect(filterItems(pool, { ...base, q: normQuery('  ORTIZ ') }).map((i) => i.id)).toEqual(['r2'])
    expect(filterItems(pool, { ...base, q: 'targets' }).map((i) => i.id)).toEqual(['l1'])
    expect(filterItems(pool, { ...base, q: 'kittle' }).map((i) => i.id)).toEqual(['r2', 'l1'])
    expect(filterItems(pool, { ...base, q: 'zzz', queryListIds: new Set(['ai']) }).map((i) => i.id)).toEqual(['ai'])
    expect(normQuery('   ')).toBe('')
  })

  it('rank chips: type × position × scoring', () => {
    expect(rankFilterOk(r1, RANK_FILTERS_ALL)).toBe(true)
    expect(rankFilterOk(r1, { ...RANK_FILTERS_ALL, type: 'pre' })).toBe(false)
    expect(rankFilterOk(r2, { type: 'pre', pos: 'WR', scoring: 'Standard' })).toBe(true)
    // A Half PPR ranking (an AI expert's default) shows under Any scoring only.
    expect(rankFilterOk(ai, { ...RANK_FILTERS_ALL, scoring: 'PPR' })).toBe(false)
    expect(rankFilterOk(ai, { ...RANK_FILTERS_ALL, scoring: 'Standard' })).toBe(false)
    expect(rankFilterOk(ai, RANK_FILTERS_ALL)).toBe(true)
    // The handoff's rows, fixed (Rest of season has no data — left out).
    expect(RANK_TYPE_CHIPS.map((c) => c.label)).toEqual(['All types', 'Weekly', 'Pre-draft'])
    expect(RANK_POS_CHIPS.map((c) => c.label)).toEqual(['All positions', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'])
    expect(RANK_SCORING_CHIPS.map((c) => c.label)).toEqual(['Any scoring', 'PPR', 'Standard'])
  })

  it('topics come from the pool: tags first, players shared by 2+ lists interleaved', () => {
    const topics = deriveTopics(pool, null)
    expect(topics.map((t) => t.label)).toEqual(['Sleeper picks', 'George Kittle', 'Puka Nacua'])
    const selected = { kind: 'tag' as const, id: 'gone', label: 'Old topic' }
    expect(deriveTopics(pool, selected)[0]).toEqual(selected)
  })

  it('updated by people you follow: their rankings edited this week — all of them, newest first', () => {
    const now = Date.parse('2026-10-15T12:00:00Z')
    const fresh = item({ ...r2, id: 'fresh', updatedAt: '2026-10-15T11:20:00Z', createdAt: '2026-09-01T00:00:00Z' })
    const old = item({ ...r2, id: 'old', updatedAt: '2026-10-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' })
    const neverEdited = item({ ...r2, id: 'new', updatedAt: '2026-10-15T11:00:00Z', createdAt: '2026-10-15T11:00:00Z' })
    expect(recentUpdates([fresh, old, neverEdited, l1], new Set(['u-ortiz', 'u-kelly']), now).map((i) => i.id)).toEqual(['fresh'])
    const many = Array.from({ length: 5 }, (_, i) =>
      item({ ...r2, id: `m${i}`, updatedAt: `2026-10-1${i}T10:00:00Z`, createdAt: '2026-09-01T00:00:00Z' }),
    )
    expect(recentUpdates(many, new Set(['u-ortiz']), now).map((i) => i.id)).toEqual(['m4', 'm3', 'm2', 'm1', 'm0'])
  })

  it('empty states', () => {
    expect(emptyCopy('following', null, '', false).message).toBe(
      'Follow people to see their lists, rankings and start/sit questions here',
    )
    expect(emptyCopy('following', null, '', false).action).toBe('Browse For you')
    // Following people whose lists aren't in the pool is not "follow people".
    expect(emptyCopy('following', null, '', false, { followsAnyone: true, capped: false }).message).toBe(
      'People you follow haven’t shared lists or rankings yet',
    )
    expect(emptyCopy('following', null, '', false, { followsAnyone: true, capped: true }).message).toBe(
      'Nothing recent from people you follow',
    )
    expect(emptyCopy('poll', null, '', false).message).toBe('No start or sit questions yet')
    expect(emptyCopy('all', { kind: 'tag', id: 't', label: 'Puka Nacua' }, 'x', false)).toMatchObject({
      message: 'Nothing matches Puka Nacua',
      action: 'Clear filters',
    })
    expect(emptyCopy('list', null, 'zz', false).message).toBe('Nothing matches your search')
    expect(emptyCopy('rank', null, '', true)).toMatchObject({ message: 'Nothing matches these filters', kind: 'rank' })
  })
})
