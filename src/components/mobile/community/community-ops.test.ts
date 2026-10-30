import { describe, expect, it } from 'vitest'

import { parseRankingsParams } from '@/components/mobile/rankings/rankings-ops'
import type { CommunityItem, CommunityPlayer } from '@/hooks/use-mobile-community-feed'

import {
  COMMUNITY_HREF,
  CREATE_LIST_HREF,
  CREATE_RANKING_HREF,
  DEFAULT_SCORING_FORMAT,
  INJURIES_TOPIC,
  LATEST_HREF,
  LATEST_SIZE,
  OLDER_NONE,
  POPULAR,
  RANK_FILTERS_ALL,
  RANK_POS_CHIPS,
  RANK_SCORING_CHIPS,
  classifyCommunityList,
  closeCommunityDetail,
  communityView,
  coverHeight,
  deriveTopics,
  effectiveScoringFormat,
  emptyCopy,
  expertRankingHref,
  filterItems,
  formatFollows,
  hottestLikedOutside,
  latestPageItems,
  listsOnlyQuery,
  normQuery,
  nflSeasonOf,
  olderSpecs,
  personaScoring,
  pickLatest,
  playerMeta,
  popularScore,
  postHref,
  postedAgo,
  rankFilterOk,
  rankTypeChips,
  rankingThisWeek,
  recentLikeHeat,
  recentUpdates,
  scoringFormatOf,
  scoringLabel,
  shownInCommunityQuery,
  sortPopular,
  topLine,
  topicAwaitingServer,
  TRENDING_TAGS_SIZE,
  trendingTagTopics,
  updatedAgo,
  withOlder,
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
    scoring: 'Half PPR',
    scoringFormat: 'half',
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
  it('big board → season ranking; weekly board slug → that week; AI expert → season ranking; else a list', () => {
    expect(classifyCommunityList({ is_big_board: true, slug: 'big-board', ai_persona_id: null })).toEqual({
      kind: 'rank',
      rankType: 'season',
      week: null,
    })
    expect(classifyCommunityList({ is_big_board: false, slug: 'week-3-big-board-1783537316215', ai_persona_id: null })).toEqual({
      kind: 'rank',
      rankType: 'weekly',
      week: 3,
    })
    expect(classifyCommunityList({ is_big_board: false, slug: 'week-12-big-board', ai_persona_id: null }).week).toBe(12)
    // Every AI expert ranking is season-long (as the Rankings area reads them).
    expect(classifyCommunityList({ is_big_board: false, slug: 'wike-mright-ai-qb', ai_persona_id: 'p1' })).toEqual({
      kind: 'rank',
      rankType: 'season',
      week: null,
    })
    // A person's own ordered list is still a list.
    expect(classifyCommunityList({ is_big_board: false, slug: 'rb-targets', ai_persona_id: null })).toEqual({
      kind: 'list',
      rankType: null,
      week: null,
    })
    expect(classifyCommunityList({ is_big_board: null, slug: 'weekly-sleepers', ai_persona_id: null }).kind).toBe('list')
  })

  describe('the same split, asked of the server (plan C3)', () => {
    type Row = { is_big_board: boolean | null; slug: string; ai_persona_id: string | null; player_count: number }
    /** Records the filters, then reads them back the way Postgres would. */
    function recorder() {
      const ops: [string, unknown[]][] = []
      const q = {
        gt: (...a: unknown[]) => (ops.push(['gt', a]), q),
        not: (...a: unknown[]) => (ops.push(['not', a]), q),
        is: (...a: unknown[]) => (ops.push(['is', a]), q),
      }
      const keeps = (row: Row) =>
        ops.every(([name, [col, a, b]]) => {
          const value = row[col as keyof Row]
          if (name === 'gt') return typeof value === 'number' && value > (a as number)
          if (name === 'is') return value === a
          // not: `is true` → IS NOT TRUE (null passes); `match` → no regex match.
          if (a === 'is') return value !== b
          return !new RegExp(b as string).test(String(value))
        })
      return { q, ops, keeps }
    }
    const ROWS: Row[] = [
      { is_big_board: true, slug: 'big-board', ai_persona_id: null, player_count: 300 },
      { is_big_board: true, slug: 'big-board', ai_persona_id: null, player_count: 0 },
      { is_big_board: false, slug: 'week-3-big-board-1783537316215', ai_persona_id: null, player_count: 40 },
      { is_big_board: false, slug: 'week-12-big-board', ai_persona_id: null, player_count: 40 },
      { is_big_board: false, slug: 'wike-mright-ai-qb', ai_persona_id: 'p1', player_count: 25 },
      { is_big_board: false, slug: 'rb-targets', ai_persona_id: null, player_count: 12 },
      { is_big_board: null, slug: 'weekly-sleepers', ai_persona_id: null, player_count: 8 },
      { is_big_board: false, slug: 'untitled', ai_persona_id: null, player_count: 0 },
    ]

    it('lists only: exactly what classifyCommunityList calls a list', () => {
      const { q, keeps } = recorder()
      listsOnlyQuery(q)
      for (const row of ROWS) expect(keeps(row), row.slug).toBe(classifyCommunityList(row).kind === 'list')
    })

    it('rankings off: lists with players; rankings on: anything with players — never an empty board', () => {
      const off = recorder()
      shownInCommunityQuery(off.q, false)
      const on = recorder()
      shownInCommunityQuery(on.q, true)
      for (const row of ROWS) {
        expect(off.keeps(row), row.slug).toBe(row.player_count > 0 && classifyCommunityList(row).kind === 'list')
        expect(on.keeps(row), row.slug).toBe(row.player_count > 0)
      }
      expect(on.ops).toEqual([['gt', ['player_count', 0]]])
    })
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
  it('the top line keeps A.J., DK and CJ whole (gap list §4 item 17)', () => {
    expect(topLine([player('1', 'A.J. Brown'), player('2', 'Amon-Ra St. Brown'), player('3', 'DK Metcalf')])).toBe(
      '1. A.J. Brown 2. A. St. Brown 3. DK Metcalf',
    )
    expect(topLine([player('1', 'CJ Stroud', 'QB'), player('2', 'Steelers D/ST', 'DEF')], false)).toBe('CJ Stroud · Steelers D/ST')
  })
  it('top line is single-spaced', () => {
    expect(topLine([player('1', 'Bijan Robinson'), player('2', 'Jonathan Taylor'), player('3', 'Kyren Williams'), player('4', 'X Y')])).toBe(
      '1. B. Robinson 2. J. Taylor 3. K. Williams',
    )
  })
  it('a list without numbers names the same players in order, unnumbered (one numbering rule, 2026-10-16)', () => {
    const heads = [player('1', 'Bijan Robinson'), player('2', 'Jonathan Taylor'), player('3', 'Kyren Williams'), player('4', 'X Y')]
    expect(topLine(heads, false)).toBe('B. Robinson · J. Taylor · K. Williams')
    expect(topLine(heads, true)).toBe('1. B. Robinson 2. J. Taylor 3. K. Williams')
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
  it('List opens the mobile New list screen, marked as started from Community (gap list §3 #8)', () => {
    expect(CREATE_LIST_HREF).toBe('/app/lists/new?from=community')
  })
})

describe('an AI expert’s ranking opens in Rankings (gap list §3 #28)', () => {
  const expert = { profileId: null, username: 'bathew-merry-ai', avatarUrl: null, followers: null, isPersona: true, isActive: true }
  const open = (over: Partial<CommunityItem>) => {
    const href = expertRankingHref(item({ id: 'b1a2c3d4-0000-4000-8000-000000000001', kind: 'rank', author: expert, ...over }))
    expect(href).not.toBeNull()
    const url = new URL(href!, 'https://fieldscout.gg')
    return { url, state: parseRankingsParams(url.searchParams, { type: 'season' }) }
  }

  it('opens that expert’s ranking on the Rankings screen — not the new-ranking wizard or an editor', () => {
    const { url, state } = open({ positionFilter: 'WR', scoringFormat: 'ppr' })
    expect(url.pathname).toBe('/app/weekly-ranks')
    expect(state).toMatchObject({ view: 'hub', src: 'p:b1a2c3d4-0000-4000-8000-000000000001', pos: 'WR', overlay: null })
  })

  it('a position board opens at its position; D/ST boards read as D/ST', () => {
    expect(open({ positionFilter: 'RB' }).state.pos).toBe('RB')
    expect(open({ positionFilter: 'DEF' }).state.pos).toBe('DST')
  })

  it('an overall board opens at the position of the player its row leads with, else RB', () => {
    const heads = [player('a', "Ja'Marr Chase", 'WR', 'CIN'), player('b', 'Bijan Robinson', 'RB', 'ATL')]
    expect(open({ positionFilter: null, heads }).state.pos).toBe('WR')
    expect(open({ positionFilter: null, heads: [] }).state.pos).toBe('RB')
  })

  it('carries the ranking’s scoring, so the points are counted the expert’s way', () => {
    expect(open({ scoringFormat: 'half' }).state.scoring).toBe('half')
    expect(open({ scoringFormat: 'standard' }).state.scoring).toBe('std')
    expect(open({ scoringFormat: 'ppr' }).url.searchParams.has('scoring')).toBe(false)
  })

  it('a person’s ranking or list keeps the Community detail', () => {
    expect(expertRankingHref(item({ id: 'r1', kind: 'rank' }))).toBeNull()
    expect(expertRankingHref(item({ id: 'l1' }))).toBeNull()
  })

  it('a switched-off AI expert’s ranking keeps the Community detail — Rankings no longer has it', () => {
    const rank = (author: CommunityItem['author']) => expertRankingHref(item({ id: 'b1', kind: 'rank', author }))
    expect(rank({ ...expert, isActive: false })).toBeNull()
    // Not read reads as off: the detail opens any board; Rankings would not.
    expect(rank({ ...expert, isActive: undefined })).toBeNull()
    expect(rank(expert)).not.toBeNull()
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
    rankType: 'season',
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
    expect(rankFilterOk(r1, { ...RANK_FILTERS_ALL, type: 'season' })).toBe(false)
    expect(rankFilterOk(r2, { type: 'season', pos: 'WR', scoring: 'standard' })).toBe(true)
    expect(rankFilterOk(r2, { ...RANK_FILTERS_ALL, type: 'weekly' })).toBe(false)
    expect(RANK_POS_CHIPS.map((c) => c.label)).toEqual(['All positions', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'])
  })

  it('type chips (#27): the one season ranking has its own chip, called by the calendar', () => {
    // In season (any week, the postseason's pinned 18 too): Rest of season.
    expect(rankTypeChips(7).map((c) => c.label)).toEqual(['All types', 'Weekly', 'Rest of season'])
    expect(rankTypeChips(1).map((c) => c.label)).toEqual(['All types', 'Weekly', 'Rest of season'])
    expect(rankTypeChips(18).map((c) => c.label)).toEqual(['All types', 'Weekly', 'Rest of season'])
    // The offseason: Pre-draft — the same chip.
    expect(rankTypeChips(0).map((c) => c.label)).toEqual(['All types', 'Weekly', 'Pre-draft'])
    expect(rankTypeChips(0).map((c) => c.value)).toEqual(rankTypeChips(7).map((c) => c.value))
    expect(rankTypeChips(7).map((c) => c.value)).toEqual(['all', 'weekly', 'season'])
    // The chip holds the big board and the AI experts' boards, not a week's board.
    const { kind, rankType } = classifyCommunityList({ is_big_board: false, slug: 'x', ai_persona_id: 'p' })
    const ai = item({ id: 'ai2', kind, rankType })
    expect(rankFilterOk(ai, { ...RANK_FILTERS_ALL, type: 'season' })).toBe(true)
    expect(rankFilterOk(r1, { ...RANK_FILTERS_ALL, type: 'weekly' })).toBe(true)
  })

  it('scoring chips (#36): Any scoring + the four scorings; the saved scoring filters', () => {
    expect(RANK_SCORING_CHIPS.map((c) => c.label)).toEqual(['Any scoring', 'PPR', 'Half PPR', '0.25 PPR', 'Standard'])
    expect(RANK_SCORING_CHIPS.map((c) => c.value)).toEqual(['all', 'ppr', 'half', 'quarter', 'standard'])
    const quarter = item({ id: 'q', kind: 'rank', scoring: '0.25 PPR', scoringFormat: 'quarter' })
    expect(rankFilterOk(quarter, { ...RANK_FILTERS_ALL, scoring: 'quarter' })).toBe(true)
    expect(rankFilterOk(quarter, { ...RANK_FILTERS_ALL, scoring: 'half' })).toBe(false)
    expect(rankFilterOk(r1, { ...RANK_FILTERS_ALL, scoring: 'ppr' })).toBe(true)
  })

  it('no saved scoring counts as Half PPR (Chris, 2026-10-16), an AI expert’s as its usual scoring — 190’s rule', () => {
    // Published before migration 190, or 190 not pushed: no saved scoring.
    expect(DEFAULT_SCORING_FORMAT).toBe('half')
    expect(effectiveScoringFormat(null)).toBe('half')
    expect(effectiveScoringFormat(null, null)).toBe('half')
    // An AI expert's board: its persona's `scoring_default`, as 190 saves it;
    // one outside the vocabulary (or none) is Half PPR.
    expect(effectiveScoringFormat(null, 'PPR')).toBe('ppr')
    expect(effectiveScoringFormat(null, 'Half-PPR')).toBe('half')
    expect(effectiveScoringFormat(null, 'Standard')).toBe('standard')
    expect(effectiveScoringFormat(null, 'Superflex')).toBe('half')
    // A saved scoring is never overridden.
    expect(effectiveScoringFormat('ppr')).toBe('ppr')
    expect(effectiveScoringFormat('quarter', 'PPR')).toBe('quarter')
  })

  it('the scoring chips filter on what a ranking counts as: Half takes the no-saved-scoring ones, the others don’t', () => {
    // `ai` (and every fixture without a saved scoring) counts as Half PPR.
    expect(rankFilterOk(ai, { ...RANK_FILTERS_ALL, scoring: 'half' })).toBe(true)
    expect(rankFilterOk(ai, RANK_FILTERS_ALL)).toBe(true)
    for (const scoring of ['ppr', 'quarter', 'standard'] as const) {
      expect(rankFilterOk(ai, { ...RANK_FILTERS_ALL, scoring })).toBe(false)
    }
    expect(rankFilterOk(r1, { ...RANK_FILTERS_ALL, scoring: 'half' })).toBe(false)
    // A PPR expert's board with none saved files under PPR, not Half.
    const pprExpert = item({ id: 'x', kind: 'rank', scoring: 'PPR', scoringFormat: effectiveScoringFormat(null, 'PPR') })
    expect(rankFilterOk(pprExpert, { ...RANK_FILTERS_ALL, scoring: 'ppr' })).toBe(true)
    expect(rankFilterOk(pprExpert, { ...RANK_FILTERS_ALL, scoring: 'half' })).toBe(false)
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
    // Following people who haven't shared anything is not "follow people" —
    // and it's never "nothing recent": the empty state waits until every
    // public list has been searched (#30).
    expect(emptyCopy('following', null, '', false, { followsAnyone: true }).message).toBe(
      'People you follow haven’t shared lists or rankings yet',
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
    // Capped at LATEST_SIZE (about ten — a shelf; See all has the rest);
    // an unreadable time sorts last; same instant → by id.
    expect(LATEST_SIZE).toBe(10)
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
    communityView({ pool, popularExtra: [extra], latestRows, filter, rk: RANK_FILTERS_ALL, ranksOn: true, currentWeek: 7, now, ...over })
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

  it('"Rankings this week" (#27): season rankings and this week\'s boards — not another week\'s, not last season\'s', () => {
    const bigBoard = item({ id: 'bigBoard', kind: 'rank', rankType: 'season', createdAt: daysAgo(200), updatedAt: daysAgo(1) })
    const expert = item({ id: 'expert', kind: 'rank', rankType: 'season', createdAt: daysAgo(60), updatedAt: daysAgo(4) })
    const week7 = item({ id: 'week7', kind: 'rank', rankType: 'weekly', rankWeek: 7, createdAt: daysAgo(12), updatedAt: daysAgo(1) })
    const week6 = item({ id: 'week6', kind: 'rank', rankType: 'weekly', rankWeek: 6, createdAt: daysAgo(20), updatedAt: daysAgo(2) })
    const week8 = item({ id: 'week8', kind: 'rank', rankType: 'weekly', rankWeek: 8, createdAt: daysAgo(3), updatedAt: daysAgo(3) })
    // Week 7 of last season: the same week number, a year old.
    const oldWeek7 = item({ id: 'oldWeek7', kind: 'rank', rankType: 'weekly', rankWeek: 7, createdAt: daysAgo(365), updatedAt: daysAgo(360) })
    const ranks = [bigBoard, expert, week7, week6, week8, oldWeek7]
    const v = view({ pool: [...ranks, quietList], popularExtra: [], latestRows: [] })
    expect(ids(v.shelfRanks).sort()).toEqual(['bigBoard', 'expert', 'week7'])
    // Latest's own still stay out of it.
    expect(ids(view({ pool: ranks, popularExtra: [], latestRows: [week7] }).shelfRanks).sort()).toEqual(['bigBoard', 'expert'])
    // The Rankings tab keeps every ranking — its Weekly chip, every week.
    const tab = view({ pool: ranks, popularExtra: [], latestRows: [], filter: { ...filter, tab: 'rank' } })
    expect(ids(tab.ranks).sort()).toEqual(ids(ranks).sort())
    const weekly = view({ pool: ranks, popularExtra: [], latestRows: [], filter: { ...filter, tab: 'rank' }, rk: { ...RANK_FILTERS_ALL, type: 'weekly' } })
    expect(ids(weekly.ranks).sort()).toEqual(['oldWeek7', 'week6', 'week7', 'week8'])
    // Next week, next week's board is this week's.
    expect(ids(view({ pool: ranks, popularExtra: [], latestRows: [], currentWeek: 8 }).shelfRanks).sort()).toEqual([
      'bigBoard',
      'expert',
      'week8',
    ])
  })

  it('this week\'s board: the app\'s week (Week 1 in the offseason), made this NFL season', () => {
    const at = (iso: string) => Date.parse(iso)
    const board = (rankWeek: number, createdAt: string) => ({ rankType: 'weekly' as const, rankWeek, createdAt })
    // Season rankings always count, whatever the week.
    expect(rankingThisWeek({ rankType: 'season', rankWeek: null, createdAt: '2020-01-01T00:00:00Z' }, 7, now)).toBe(true)
    expect(rankingThisWeek(board(7, '2026-10-01T00:00:00Z'), 7, now)).toBe(true)
    expect(rankingThisWeek(board(6, '2026-10-01T00:00:00Z'), 7, now)).toBe(false)
    expect(rankingThisWeek(board(7, '2025-10-01T00:00:00Z'), 7, now)).toBe(false)
    // The offseason: Week 1 is this week, and a board made in the summer counts in September.
    expect(rankingThisWeek(board(1, '2026-06-10T00:00:00Z'), 0, at('2026-08-20T00:00:00Z'))).toBe(true)
    expect(rankingThisWeek(board(2, '2026-06-10T00:00:00Z'), 0, at('2026-08-20T00:00:00Z'))).toBe(false)
    expect(rankingThisWeek(board(1, '2026-06-10T00:00:00Z'), 1, at('2026-09-12T00:00:00Z'))).toBe(true)
    // No readable time: taken at its week number.
    expect(rankingThisWeek(board(7, ''), 7, now)).toBe(true)
    // Not a weekly board's week (no number): not this week's.
    expect(rankingThisWeek({ rankType: 'weekly', rankWeek: null, createdAt: '2026-10-01T00:00:00Z' }, 7, now)).toBe(false)
    // NFL seasons run March to February: the playoffs belong to the season ending.
    expect(nflSeasonOf(at('2026-10-15T00:00:00Z'))).toBe(2026)
    expect(nflSeasonOf(at('2027-01-20T00:00:00Z'))).toBe(2026)
    expect(nflSeasonOf(at('2027-02-28T23:00:00Z'))).toBe(2026)
    expect(nflSeasonOf(at('2027-03-01T00:00:00Z'))).toBe(2027)
    expect(nflSeasonOf(at('2026-06-01T00:00:00Z'))).toBe(2026)
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
    // Over the Latest page, its parent is the Latest page.
    closeCommunityDetail(false, nav, LATEST_HREF)
    expect(calls.at(-1)).toBe('goBack /app/explore/latest')
    expect(COMMUNITY_HREF).toBe('/app/explore')
  })

  it('someone else’s list opens on Community’s list page while Community is on, else the List view', () => {
    expect(postHref('l 1', true)).toBe('/app/explore?list=l%201')
    expect(postHref('l1', false)).toBe('/app/lists?list=l1')
  })
})

describe('the Latest page (Chris, 2026-10-16)', () => {
  const a = item({ id: 'a', createdAt: '2026-10-15T10:00:00Z' })
  const b = item({ id: 'b', kind: 'rank', createdAt: '2026-10-15T09:00:00Z' })
  const c = item({ id: 'c', createdAt: '2026-10-15T08:00:00Z' })
  const d = item({ id: 'd', createdAt: '2026-10-15T07:00:00Z' })

  it('its pages in order, each list or ranking once', () => {
    // A post between two reads pushes `c` onto page 2 as well: shown once.
    const pages = [{ items: [a, b, c] }, { items: [c, d] }]
    expect(latestPageItems(pages, true).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(latestPageItems([], true)).toEqual([])
  })

  it('rankings stay out while their switch is off', () => {
    expect(latestPageItems([{ items: [a, b, c] }], false).map((i) => i.id)).toEqual(['a', 'c'])
    expect(latestPageItems([{ items: [b] }], false)).toEqual([])
  })

  it('lives under Community', () => {
    expect(LATEST_HREF).toBe('/app/explore/latest')
  })
})

describe('For you’s Trending tags shelf (gap list §3 #26)', () => {
  const tag = (id: string, name = id) => ({ id, name, slug: id })
  const trending = [tag('t-sleep', 'Sleepers'), tag('t-busts', 'Busts'), tag('t-rook', 'Rookies'), tag('t-dyn', 'Dynasty')]

  it('offers only tags that a list showing on Community carries — a tap never finds nothing', () => {
    const shown = [item({ id: 'a', tags: [tag('t-rook', 'Rookies')] }), item({ id: 'b', tags: [tag('t-sleep', 'Sleepers')] })]
    expect(trendingTagTopics(trending, shown).map((t) => t.label)).toEqual(['Sleepers', 'Rookies'])
  })

  it('keeps the trending order (most used first), not the order lists carry them', () => {
    const shown = [item({ id: 'a', tags: [tag('t-dyn', 'Dynasty'), tag('t-busts', 'Busts'), tag('t-sleep', 'Sleepers')] })]
    expect(trendingTagTopics(trending, shown).map((t) => t.id)).toEqual(['t-sleep', 't-busts', 't-dyn'])
  })

  it('is topics Community filters by (kind "tag"), at most the shelf’s size', () => {
    const many = Array.from({ length: TRENDING_TAGS_SIZE + 3 }, (_, i) => tag(`t${i}`, `Tag ${i}`))
    const shown = [item({ id: 'a', tags: many })]
    const topics = trendingTagTopics(many, shown)
    expect(topics).toHaveLength(TRENDING_TAGS_SIZE)
    expect(topics[0]).toEqual({ kind: 'tag', id: 't0', label: 'Tag 0' })
  })

  it('none carried: an empty shelf (not drawn)', () => {
    expect(trendingTagTopics(trending, [item({ id: 'a' })])).toEqual([])
  })
})

describe('past the pool: search and filters cover every public list (gap list §3 #30)', () => {
  const ids = (items: readonly CommunityItem[]) => items.map((i) => i.id)
  const now = Date.parse('2026-10-15T12:00:00Z')
  const poolList = item({ id: 'poolList', title: 'Sleepers', updatedAt: '2026-10-14T00:00:00Z' })
  const poolRank = item({ id: 'poolRank', kind: 'rank', rankType: 'season', title: 'Sleepers board', updatedAt: '2026-10-13T00:00:00Z' })
  const filter = { tab: 'all' as const, topic: null, q: 'sleepers', followingIds: new Set<string>() }
  const view = (over: Partial<Parameters<typeof communityView>[0]> = {}) =>
    communityView({ pool: [poolList, poolRank], popularExtra: [], latestRows: [], filter, rk: RANK_FILTERS_ALL, ranksOn: true, currentWeek: 7, now, ...over })
  const older = (...pages: CommunityItem[][]) => ({ pages, done: true })
  const oldList = (id: string) => item({ id, updatedAt: '2026-08-01T00:00:00Z' })
  const oldRank = (id: string, over: Partial<CommunityItem> = {}) =>
    item({ id, kind: 'rank', rankType: 'weekly', scoringFormat: 'ppr', updatedAt: '2026-08-01T00:00:00Z', ...over })

  describe('which reads a view needs', () => {
    const base = { tab: 'all' as const, topic: null, q: '', rk: RANK_FILTERS_ALL, ranksOn: true, followingIds: new Set<string>() }

    it('For you’s shelves and Start or sit: none — every other view: rankings and lists', () => {
      expect(olderSpecs(base)).toEqual({ rank: null, list: null })
      expect(olderSpecs({ ...base, tab: 'poll', q: 'x' })).toEqual({ rank: null, list: null })
      const searched = olderSpecs({ ...base, q: 'kelce' })
      expect(searched.rank).toMatchObject({ kind: 'rank', q: 'kelce', following: null, rankType: 'all', rankPos: 'all' })
      expect(searched.list).toMatchObject({ kind: 'list', q: 'kelce' })
      const topic = olderSpecs({ ...base, topic: INJURIES_TOPIC })
      expect(topic.list?.topic).toEqual({ kind: 'injuries', id: 'injuries' })
    })

    it('a player topic is asked by id alone', () => {
      const pl = { kind: 'player' as const, id: 'p-1', label: 'Puka Nacua', player: player('p-1', 'Puka Nacua') }
      expect(olderSpecs({ ...base, topic: pl }).list?.topic).toEqual({ kind: 'player', id: 'p-1' })
    })

    it('Following: the people followed, sorted (a stable key)', () => {
      const f = olderSpecs({ ...base, tab: 'following', followingIds: new Set(['u-b', 'u-a']) })
      expect(f.rank?.following).toEqual(['u-a', 'u-b'])
      expect(f.list?.following).toEqual(['u-a', 'u-b'])
    })

    it('Rankings: rankings only, with the type and position chips — the scoring chip stays on the client', () => {
      const r = olderSpecs({ ...base, tab: 'rank', rk: { type: 'weekly', pos: 'QB', scoring: 'ppr' } })
      expect(r.list).toBeNull()
      expect(r.rank).toEqual({ kind: 'rank', following: null, topic: null, q: '', rankType: 'weekly', rankPos: 'QB' })
    })

    it('Lists: lists only; rankings switched off: never a rankings read', () => {
      expect(olderSpecs({ ...base, tab: 'list' }).rank).toBeNull()
      expect(olderSpecs({ ...base, tab: 'list' }).list).toMatchObject({ kind: 'list' })
      expect(olderSpecs({ ...base, q: 'x', ranksOn: false }).rank).toBeNull()
      expect(olderSpecs({ ...base, tab: 'rank', ranksOn: false })).toEqual({ rank: null, list: null })
    })
  })

  describe('what shows', () => {
    it('nothing past the pool (it holds every list): exactly the view, as before', () => {
      const v = view()
      const r = withOlder(v, { rank: OLDER_NONE, list: OLDER_NONE }, { tab: 'all', rk: RANK_FILTERS_ALL })
      expect(ids(r.ranks)).toEqual(ids(v.ranks))
      expect(r.listBlocks).toEqual([v.lists])
      expect(r.loading).toBe(false)
      expect(r.empty).toBe(v.empty)
    })

    it('the pool’s matches first (in the view’s order), then the older ones — each once', () => {
      const r = withOlder(
        view(),
        { rank: older([oldRank('r1'), poolRank]), list: older([oldList('l1'), oldList('l2')], [oldList('l2'), oldList('l3')]) },
        { tab: 'all', rk: RANK_FILTERS_ALL },
      )
      expect(ids(r.ranks)).toEqual(['poolRank', 'r1'])
      // One block per page read, so a page arriving never reflows the cards above it.
      expect(r.listBlocks.map(ids)).toEqual([['poolList'], ['l1', 'l2'], ['l3']])
    })

    it('an older row is checked for what it is: rankings above, lists below', () => {
      const r = withOlder(view(), { rank: older([oldList('stray')]), list: older([oldRank('stray2')]) }, { tab: 'all', rk: RANK_FILTERS_ALL })
      expect(ids(r.ranks)).toEqual(['poolRank'])
      expect(r.listBlocks.map(ids)).toEqual([['poolList']])
    })

    it('Rankings: every chip applies to older rankings too — the scoring one only here', () => {
      const rk = { ...RANK_FILTERS_ALL, scoring: 'ppr' as const }
      const v = view({ filter: { ...filter, tab: 'rank', q: '' }, rk })
      const r = withOlder(v, { rank: older([oldRank('ppr'), oldRank('half', { scoringFormat: 'half' })]), list: OLDER_NONE }, { tab: 'rank', rk })
      expect(ids(r.ranks)).toEqual(['ppr'])
    })

    it('nothing yet but a read still going: loading — never "Nothing matches"', () => {
      const v = view({ filter: { ...filter, q: 'zzz' } })
      const r = withOlder(v, { rank: { pages: [], done: false }, list: older([]) }, { tab: 'all', rk: RANK_FILTERS_ALL })
      expect(r.loading).toBe(true)
      expect(r.empty).toBe(false)
      // A page with nothing to show, and more to read: still loading.
      const more = withOlder(v, { rank: OLDER_NONE, list: { pages: [[]], done: false } }, { tab: 'all', rk: RANK_FILTERS_ALL })
      expect(more).toMatchObject({ loading: true, empty: false })
    })

    it('empty only once every list has been searched', () => {
      const v = view({ filter: { ...filter, q: 'zzz' } })
      const r = withOlder(v, { rank: older([]), list: older([], []) }, { tab: 'all', rk: RANK_FILTERS_ALL })
      expect(r).toMatchObject({ loading: false, empty: true, rankFilteredEmpty: false })
      expect(r.listBlocks).toEqual([])
    })

    it('the Rankings chips matching nothing anywhere: that empty state, even with no ranking in the pool', () => {
      const rk = { ...RANK_FILTERS_ALL, pos: 'K' as const }
      const v = view({ pool: [poolList], filter: { ...filter, tab: 'rank', q: '' }, rk })
      expect(v.rankFilteredEmpty).toBe(false)
      const r = withOlder(v, { rank: older([]), list: OLDER_NONE }, { tab: 'rank', rk })
      expect(r).toMatchObject({ empty: true, rankFilteredEmpty: true })
      expect(emptyCopy('rank', null, '', r.rankFilteredEmpty).message).toBe('Nothing matches these filters')
      // No chips on and no ranking anywhere: "No rankings yet".
      const none = withOlder(view({ pool: [poolList], filter: { ...filter, tab: 'rank', q: '' } }), { rank: older([]), list: OLDER_NONE }, { tab: 'rank', rk: RANK_FILTERS_ALL })
      expect(none).toMatchObject({ empty: true, rankFilteredEmpty: false })
    })
  })
})
