import { describe, expect, it } from 'vitest'

import { parseRankingsParams } from '@/components/mobile/rankings/rankings-ops'
import type { CommunityItem, CommunityPlayer } from '@/hooks/use-mobile-community-feed'

import {
  CREATE_LIST_HREF,
  CREATE_RANKING_HREF,
  INJURIES_TOPIC,
  LATEST_SIZE,
  POPULAR,
  RANK_FILTERS_ALL,
  RANK_POS_CHIPS,
  RANK_SCORING_CHIPS,
  RANK_TYPE_CHIPS,
  classifyCommunityList,
  closeCommunityDetail,
  communityView,
  coverHeight,
  deriveTopics,
  emptyCopy,
  filterItems,
  formatFollows,
  hottestLikedOutside,
  normQuery,
  personaScoring,
  pickLatest,
  playerMeta,
  popularScore,
  postedAgo,
  rankFilterOk,
  recentLikeHeat,
  recentUpdates,
  scoringFormatOf,
  scoringLabel,
  shortName,
  sortPopular,
  topLine,
  topicAwaitingServer,
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
    scoringFormat: null,
    playerCount: 3,
    likeCount: 0,
    recentLikes: [],
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
  const r1 = item({
    id: 'r1',
    kind: 'rank',
    rankType: 'weekly',
    positionFilter: 'RB',
    scoring: 'PPR',
    scoringFormat: 'ppr',
    title: 'Week 5 RB',
    heads: [puka],
  })
  const r2 = item({
    id: 'r2',
    kind: 'rank',
    rankType: 'pre',
    positionFilter: 'WR',
    scoring: 'Standard',
    scoringFormat: 'standard',
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
    expect(rankFilterOk(r2, { type: 'pre', pos: 'WR', scoring: 'standard' })).toBe(true)
    // The handoff's rows (Rest of season has no data — left out).
    expect(RANK_TYPE_CHIPS.map((c) => c.label)).toEqual(['All types', 'Weekly', 'Pre-draft'])
    expect(RANK_POS_CHIPS.map((c) => c.label)).toEqual(['All positions', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'])
  })

  it('scoring chips (#36): Any scoring + the four saved scorings; only the SAVED scoring filters', () => {
    expect(RANK_SCORING_CHIPS.map((c) => c.label)).toEqual(['Any scoring', 'PPR', 'Half PPR', '0.25 PPR', 'Standard'])
    expect(RANK_SCORING_CHIPS.map((c) => c.value)).toEqual(['all', 'ppr', 'half', 'quarter', 'standard'])
    const quarter = item({ id: 'q', kind: 'rank', scoring: '0.25 PPR', scoringFormat: 'quarter' })
    expect(rankFilterOk(quarter, { ...RANK_FILTERS_ALL, scoring: 'quarter' })).toBe(true)
    expect(rankFilterOk(quarter, { ...RANK_FILTERS_ALL, scoring: 'half' })).toBe(false)
    expect(rankFilterOk(r1, { ...RANK_FILTERS_ALL, scoring: 'ppr' })).toBe(true)
    // No saved scoring (published before migration 190, or 190 not pushed):
    // "Any scoring" only — even when its label is known from a scoring
    // system or an AI expert's default.
    expect(ai.scoringFormat).toBeNull()
    for (const scoring of ['ppr', 'half', 'quarter', 'standard'] as const) {
      expect(rankFilterOk(ai, { ...RANK_FILTERS_ALL, scoring })).toBe(false)
    }
    expect(rankFilterOk(ai, RANK_FILTERS_ALL)).toBe(true)
  })

  it('the saved scoring is read tolerantly (no column before 190; unknown values)', () => {
    expect(scoringFormatOf({ scoring_format: 'half' })).toBe('half')
    expect(scoringFormatOf({ scoring_format: 'quarter' })).toBe('quarter')
    expect(scoringFormatOf({ scoring_format: null })).toBeNull()
    expect(scoringFormatOf({})).toBeNull()
    expect(scoringFormatOf({ scoring_format: 'PPR' })).toBeNull()
    expect(scoringFormatOf(null)).toBeNull()
  })

  it('topics: tags and shared players from the pool, plus an always-present Injuries pill in the trend slot', () => {
    const topics = deriveTopics(pool, null)
    expect(topics.map((t) => t.label)).toEqual(['Sleeper picks', 'George Kittle', 'Injuries', 'Puka Nacua'])
    const selected = { kind: 'tag' as const, id: 'gone', label: 'Old topic' }
    expect(deriveTopics(pool, selected)[0]).toEqual(selected)
    // Nothing in the pool → still Injuries.
    expect(deriveTopics([], null)).toEqual([INJURIES_TOPIC])
    // A full pool keeps all its automatic pills (five tags, three players)
    // PLUS Injuries, in the handoff's trend slot.
    const tag = (n: number) => ({ id: `t${n}`, name: `Tag ${n}`, slug: `tag-${n}` })
    const pa = player('pa', 'A Player'), pb = player('pb', 'B Player'), pc = player('pc', 'C Player')
    const full = [0, 1].map((n) =>
      item({ id: `f${n}`, tags: [tag(1), tag(2), tag(3), tag(4), tag(5), tag(6)], heads: [pa, pb, pc] }),
    )
    expect(deriveTopics(full, null).map((t) => t.label)).toEqual([
      'Tag 1',
      'Tag 2',
      'A Player',
      'Injuries',
      'B Player',
      'Tag 3',
      'Tag 4',
      'Tag 5',
      'C Player',
    ])
    // Selecting Injuries doesn't duplicate it.
    expect(deriveTopics(full, INJURIES_TOPIC).filter((t) => t.kind === 'injuries')).toHaveLength(1)
  })

  it('Injuries topic: exactly the server’s lists (with a player on the injury report) — no client guess', () => {
    expect(filterItems(pool, { ...base, topic: INJURIES_TOPIC })).toEqual([])
    expect(filterItems(pool, { ...base, topic: INJURIES_TOPIC, topicListIds: new Set(['r2', 'l1']) }).map((i) => i.id)).toEqual([
      'r2',
      'l1',
    ])
    expect(
      filterItems(pool, { ...base, tab: 'list', topic: INJURIES_TOPIC, topicListIds: new Set(['r2', 'l1']) }).map((i) => i.id),
    ).toEqual(['l1'])
    expect(emptyCopy('all', INJURIES_TOPIC, '', false)).toMatchObject({
      message: 'No lists with a player on this week’s injury report',
      action: 'Clear filters',
    })
    expect(emptyCopy('all', INJURIES_TOPIC, 'zz', false).message).toBe('Nothing matches your search')
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

describe('For you order (#35)', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  const DAY = 24 * 60 * 60 * 1000
  const daysAgo = (d: number) => new Date(now - d * DAY).toISOString()
  const likesAgo = (...days: number[]) => days.map((d) => now - d * DAY)

  it('posted times are short', () => {
    expect(postedAgo('2026-10-15T11:59:40Z', now)).toBe('now')
    expect(postedAgo('2026-10-15T11:35:00Z', now)).toBe('25m')
    expect(postedAgo('2026-10-15T09:00:00Z', now)).toBe('3h')
    expect(postedAgo('2026-10-13T12:00:00Z', now)).toBe('2d')
    expect(postedAgo('2026-09-24T12:00:00Z', now)).toBe('3w')
    expect(postedAgo('', now)).toBe('')
  })

  it('Latest is strictly newest-posted first — likes and updates never move it', () => {
    const old = item({ id: 'old', createdAt: daysAgo(9), updatedAt: daysAgo(0), likeCount: 90, recentLikes: likesAgo(0, 0, 0) })
    const mid = item({ id: 'mid', createdAt: daysAgo(3), updatedAt: daysAgo(3) })
    const fresh = item({ id: 'fresh', createdAt: daysAgo(0.1), updatedAt: daysAgo(0.1) })
    const rank = item({ id: 'rank', kind: 'rank', createdAt: daysAgo(1), updatedAt: daysAgo(1) })
    expect(pickLatest([old, mid, rank, fresh], true).map((i) => i.id)).toEqual(['fresh', 'rank', 'mid', 'old'])
    // Rankings switched off: rankings leave Latest.
    expect(pickLatest([old, mid, rank, fresh], false).map((i) => i.id)).toEqual(['fresh', 'mid', 'old'])
    // Capped at LATEST_SIZE; an unreadable time sorts last; same instant → by id.
    const many = Array.from({ length: LATEST_SIZE + 3 }, (_, i) => item({ id: `n${i}`, createdAt: daysAgo(i) }))
    expect(pickLatest(many, true)).toHaveLength(LATEST_SIZE)
    expect(pickLatest(many, true)[0]!.id).toBe('n0')
    const noTime = item({ id: 'a-no-time', createdAt: '' })
    expect(pickLatest([noTime, mid], true).map((i) => i.id)).toEqual(['mid', 'a-no-time'])
    const twinB = item({ id: 'b', createdAt: daysAgo(2) })
    const twinA = item({ id: 'a', createdAt: daysAgo(2) })
    expect(pickLatest([twinB, twinA], true).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('the score: a new list with no likes is 1; every like counts; the old part halves each week untouched', () => {
    expect(popularScore({ likeCount: 0, recentLikes: [], updatedAt: daysAgo(0) }, now)).toBeCloseTo(1)
    // A like given just now counts fully (1 + 1).
    expect(popularScore({ likeCount: 1, recentLikes: likesAgo(0), updatedAt: daysAgo(0) }, now)).toBeCloseTo(2)
    // Its extra weight halves every LIKE_HALF_LIFE_DAYS: 0.25 + 0.75 × ½.
    expect(
      popularScore({ likeCount: 1, recentLikes: likesAgo(POPULAR.LIKE_HALF_LIFE_DAYS), updatedAt: daysAgo(0) }, now),
    ).toBeCloseTo(1 + 0.25 + 0.75 * 0.5)
    // An old like (outside the window, or untimed) counts at the floor.
    expect(popularScore({ likeCount: 4, recentLikes: [], updatedAt: daysAgo(0) }, now)).toBeCloseTo(1 + 4 * POPULAR.LIKE_FLOOR)
    // A week untouched halves the list and its old likes…
    expect(popularScore({ likeCount: 4, recentLikes: [], updatedAt: daysAgo(POPULAR.AGE_HALF_LIFE_DAYS) }, now)).toBeCloseTo(
      (1 + 4 * POPULAR.LIKE_FLOOR) / 2,
    )
    // …but not a like given today: that fades by its own age only.
    expect(popularScore({ likeCount: 1, recentLikes: likesAgo(0), updatedAt: daysAgo(28) }, now)).toBeCloseTo(
      (1 + POPULAR.LIKE_FLOOR) / 16 + (1 - POPULAR.LIKE_FLOOR),
    )
    // A count lagging its rows never undercounts them.
    expect(popularScore({ likeCount: 0, recentLikes: likesAgo(0, 0), updatedAt: daysAgo(0) }, now)).toBeCloseTo(3)
    // No readable update time: the list part sinks to 0; recent likes still count.
    expect(popularScore({ likeCount: 50, recentLikes: [], updatedAt: '' }, now)).toBe(0)
    expect(popularScore({ likeCount: 1, recentLikes: likesAgo(0), updatedAt: '' }, now)).toBeCloseTo(0.75)
    expect(recentLikeHeat(likesAgo(0, POPULAR.LIKE_HALF_LIFE_DAYS), now)).toBeCloseTo(1.5)
  })

  it('lists getting likes lately rise; older posts fade even if they were popular', () => {
    const order = (...items: CommunityItem[]) => sortPopular(items, now).map((i) => i.id)
    // Liked a lot, long ago, and untouched for three weeks.
    const oldHit = item({ id: 'oldHit', updatedAt: daysAgo(21), likeCount: 40, recentLikes: [] })
    // A week old, but three likes today.
    const warming = item({ id: 'warming', updatedAt: daysAgo(7), likeCount: 3, recentLikes: likesAgo(0, 0, 0.2) })
    // Brand new, no likes yet.
    const brandNew = item({ id: 'brandNew', updatedAt: daysAgo(0), likeCount: 0, recentLikes: [] })
    // Same week as `warming`, same like count, but the likes came 12 days ago.
    const cooled = item({ id: 'cooled', updatedAt: daysAgo(7), likeCount: 3, recentLikes: likesAgo(12, 12, 12) })
    expect(order(oldHit, cooled, brandNew, warming)[0]).toBe('warming')
    expect(order(cooled, warming)).toEqual(['warming', 'cooled'])
    expect(order(brandNew, oldHit)).toEqual(['oldHit', 'brandNew'])
    // A month on, the old hit has faded below a new list with nothing.
    const olderHit = item({ ...oldHit, id: 'olderHit', updatedAt: daysAgo(35) })
    expect(order(olderHit, brandNew)).toEqual(['brandNew', 'olderHit'])
  })

  it('a list edited a month ago but liked today rises; one whose likes are all old stays down', () => {
    const order = (...items: CommunityItem[]) => sortPopular(items, now).map((i) => i.id)
    const brandNew = item({ id: 'brandNew', updatedAt: daysAgo(0) })
    const likedToday = item({ id: 'likedToday', updatedAt: daysAgo(28), likeCount: 10, recentLikes: likesAgo(0, 0, 0, 0.1, 0.2) })
    const likedLongAgo = item({ id: 'likedLongAgo', updatedAt: daysAgo(28), likeCount: 10, recentLikes: [] })
    expect(order(likedLongAgo, brandNew, likedToday)).toEqual(['likedToday', 'brandNew', 'likedLongAgo'])
    // Even one like today lifts a list untouched for two weeks past an empty new one.
    const oneLike = item({ id: 'oneLike', updatedAt: daysAgo(14), likeCount: 1, recentLikes: likesAgo(0) })
    expect(order(brandNew, oneLike)).toEqual(['oneLike', 'brandNew'])
  })

  it('recently liked lists outside the pool: hottest first, the pool left out, at most `size`', () => {
    const likes = new Map<string, number[]>([
      ['inPool', likesAgo(0, 0, 0)],
      ['warm', likesAgo(0, 0)],
      ['hot', likesAgo(0, 0, 0, 0)],
      ['cool', likesAgo(10, 10)],
      ['twinB', likesAgo(1)],
      ['twinA', likesAgo(1)],
      ['none', []],
    ])
    expect(hottestLikedOutside(likes, new Set(['inPool']), now, 10)).toEqual(['hot', 'warm', 'twinA', 'twinB', 'cool'])
    expect(hottestLikedOutside(likes, new Set(['inPool']), now, 2)).toEqual(['hot', 'warm'])
    expect(hottestLikedOutside(new Map(), new Set(), now, 10)).toEqual([])
  })

  it('ties: the more recently updated first, then by id — and the input is not reordered', () => {
    const a = item({ id: 'a', updatedAt: daysAgo(1) })
    const b = item({ id: 'b', updatedAt: daysAgo(1) })
    const input = [b, a]
    expect(sortPopular(input, now).map((i) => i.id)).toEqual(['a', 'b'])
    expect(input.map((i) => i.id)).toEqual(['b', 'a'])
  })
})

describe('what the screen shows (#35, #27)', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  const DAY = 24 * 60 * 60 * 1000
  const daysAgo = (d: number) => new Date(now - d * DAY).toISOString()
  const likesAgo = (...days: number[]) => days.map((d) => now - d * DAY)
  const ortiz = { profileId: 'u-ortiz', username: 'ortizff', avatarUrl: null, followers: 8400, isPersona: false }

  // The pool comes most-recently-updated first, as the read orders it.
  const quietList = item({ id: 'quietList', createdAt: daysAgo(30), updatedAt: daysAgo(0.5) })
  const likedList = item({ id: 'likedList', createdAt: daysAgo(30), updatedAt: daysAgo(2), likeCount: 5, recentLikes: likesAgo(0, 0, 0) })
  const freshList = item({ id: 'freshList', createdAt: daysAgo(0.1), updatedAt: daysAgo(0.1) })
  const quietRank = item({ id: 'quietRank', kind: 'rank', author: ortiz, createdAt: daysAgo(20), updatedAt: daysAgo(1) })
  const hotRank = item({ id: 'hotRank', kind: 'rank', author: ortiz, createdAt: daysAgo(20), updatedAt: daysAgo(3), likeCount: 9, recentLikes: likesAgo(0, 0, 0, 0) })
  const pool = [quietList, quietRank, likedList, hotRank, freshList].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  // Edited a month ago (outside the update-ordered pool), liked a lot today.
  const extra = item({ id: 'extra', createdAt: daysAgo(40), updatedAt: daysAgo(30), likeCount: 12, recentLikes: likesAgo(0, 0, 0, 0, 0, 0) })
  const latestRows = [freshList]
  const filter = { tab: 'all' as const, topic: null, q: '', followingIds: new Set(['u-ortiz']) }
  const view = (over: Partial<Parameters<typeof communityView>[0]> = {}) =>
    communityView({ pool, popularExtra: [extra], latestRows, filter, rk: RANK_FILTERS_ALL, ranksOn: true, now, ...over })
  const ids = (items: CommunityItem[]) => items.map((i) => i.id)

  it('For you: Latest newest-posted; everything else popular + recent, Latest left out; liked lists outside the pool join', () => {
    const v = view()
    expect(v.shelves).toBe(true)
    expect(ids(v.latest)).toEqual(['freshList'])
    expect(ids(v.filtered)).toEqual(ids(sortPopular([...pool, extra], now)))
    expect(ids(v.shelfLists)).toEqual(['extra', 'likedList', 'quietList'])
    expect(ids(v.shelfRanks)).toEqual(['hotRank', 'quietRank'])
    expect(v.anyList).toBe(true)
  })

  it('For you: "Updated by people you follow" is popular + recent too, and leaves out what Latest shows', () => {
    expect(ids(view().updates)).toEqual(['hotRank', 'quietRank'])
    // A followed ranking posted this week and edited since: in Latest, so not again.
    const newRank = item({ id: 'newRank', kind: 'rank', author: ortiz, createdAt: daysAgo(2), updatedAt: daysAgo(0.2) })
    const v = view({ pool: [newRank, ...pool], latestRows: [newRank, freshList] })
    expect(ids(v.latest)).toEqual(['freshList', 'newRank'])
    expect(ids(v.updates)).not.toContain('newRank')
    // The Following tab keeps them newest-updated first, and doesn't drop Latest's.
    const following = view({ pool: [newRank, ...pool], latestRows: [newRank], filter: { ...filter, tab: 'following' } })
    expect(ids(following.updates)).toEqual(['newRank', 'quietRank', 'hotRank'])
  })

  it('the other tabs keep the pool and its order — no popular order, no liked extras, no Latest', () => {
    for (const tab of ['following', 'rank', 'list'] as const) {
      const v = view({ filter: { ...filter, tab } })
      expect(v.shelves).toBe(false)
      expect(v.latest).toEqual([])
      expect(ids(v.filtered)).not.toContain('extra')
    }
    expect(ids(view({ filter: { ...filter, tab: 'list' } }).lists)).toEqual(['freshList', 'quietList', 'likedList'])
    expect(ids(view({ filter: { ...filter, tab: 'rank' } }).ranks)).toEqual(['quietRank', 'hotRank'])
  })

  it('For you with a topic or search: popular + recent, extras included, no Latest or updates', () => {
    const v = view({ filter: { ...filter, q: 'a list' } })
    expect(v.shelves).toBe(false)
    expect(v.latest).toEqual([])
    expect(v.updates).toEqual([])
    expect(ids(v.lists)).toEqual(['extra', 'likedList', 'freshList', 'quietList'])
  })

  it('rankings switched off: no ranking anywhere — shelves, Latest or updates', () => {
    const rankLatest = item({ id: 'rankLatest', kind: 'rank', createdAt: daysAgo(0.05), updatedAt: daysAgo(0.05) })
    const v = view({ ranksOn: false, latestRows: [rankLatest, freshList] })
    expect(v.ranks).toEqual([])
    expect(v.shelfRanks).toEqual([])
    expect(v.updates).toEqual([])
    expect(ids(v.latest)).toEqual(['freshList'])
    // Following with only rankings matched: nothing shows, so it's the empty state.
    const onlyRanks = view({ ranksOn: false, filter: { ...filter, tab: 'following' } })
    expect(onlyRanks.empty).toBe(true)
  })

  it('the Rankings chips can exclude every ranking — that is its own empty state', () => {
    const v = view({ filter: { ...filter, tab: 'rank' }, rk: { ...RANK_FILTERS_ALL, scoring: 'ppr' } })
    expect(v.ranksAll).toHaveLength(2)
    expect(v.ranks).toEqual([])
    expect(v.rankFilteredEmpty).toBe(true)
    expect(v.empty).toBe(true)
  })

  it('a topic waits for the server: a player topic and Injuries; tags and no topic never do', () => {
    const loading = { player: true, injuries: true }
    const pl = { kind: 'player' as const, id: 'p', label: 'P', player: player('p', 'P') }
    expect(topicAwaitingServer(pl, { player: true, injuries: false })).toBe(true)
    expect(topicAwaitingServer(pl, { player: false, injuries: true })).toBe(false)
    expect(topicAwaitingServer(INJURIES_TOPIC, { player: false, injuries: true })).toBe(true)
    expect(topicAwaitingServer(INJURIES_TOPIC, { player: true, injuries: false })).toBe(false)
    expect(topicAwaitingServer({ kind: 'tag', id: 't', label: 'T' }, loading)).toBe(false)
    expect(topicAwaitingServer(null, loading)).toBe(false)
  })

  it('the detail\'s Back: pops the feed when opened from it, else goes back to where you came from (#27)', () => {
    const calls: string[] = []
    const nav = { popFeed: () => calls.push('pop'), goBack: (parent: string) => calls.push(`goBack ${parent}`) }
    closeCommunityDetail(true, nav)
    closeCommunityDetail(false, nav)
    expect(calls).toEqual(['pop', 'goBack /app/explore'])
  })
})
