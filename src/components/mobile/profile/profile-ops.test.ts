import { describe, expect, it } from 'vitest'

import {
  MY_RANKINGS_HREF,
  NEW_RANKING_HREF,
  RANKING_SUB_CLASS,
  countTitles,
  credCard,
  filterSsQuestions,
  listKindLabel,
  listRowSub,
  parseMeTab,
  rankingEditHref,
  rankingRowSub,
  rankingRowTitle,
  relativeAgo,
  resolveMeTab,
  shortDate,
  shortName,
  sortRankingRows,
  sortSsQuestions,
  ssClosesLabel,
  ssCounts,
  ssFooter,
  ssIsOpen,
  ssPostedLabel,
  ssPreviewSub,
  ssResults,
  ssTitle,
  ssVotesReceived,
  type SsQuestion,
} from '@/components/mobile/profile/profile-ops'
import { parseRankingsParams } from '@/components/mobile/rankings/rankings-ops'

const NOW = new Date('2026-10-15T12:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('profile segment (?tab=)', () => {
  it('reads the handoff keys and aliases, rejects the rest', () => {
    expect(parseMeTab('rankings')).toBe('rankings')
    expect(parseMeTab('Lists')).toBe('lists')
    expect(parseMeTab('ss')).toBe('ss')
    expect(parseMeTab('start-sit')).toBe('ss')
    expect(parseMeTab('nope')).toBeNull()
    expect(parseMeTab(null)).toBeNull()
  })

  it('falls back to Lists when the requested segment is not released', () => {
    expect(resolveMeTab('rankings', ['rankings', 'lists', 'ss'])).toBe('rankings')
    expect(resolveMeTab('rankings', ['lists'])).toBe('lists')
    expect(resolveMeTab('ss', ['rankings', 'lists'])).toBe('lists')
  })
})

describe('dates', () => {
  it('relative times read like the handoff, then a date', () => {
    expect(relativeAgo(ago(10_000), NOW)).toBe('just now')
    expect(relativeAgo(ago(5 * MIN), NOW)).toBe('5m ago')
    expect(relativeAgo(ago(3 * HOUR), NOW)).toBe('3h ago')
    expect(relativeAgo(ago(2 * DAY), NOW)).toBe('2d ago')
    expect(relativeAgo('2026-08-20T12:00:00Z', NOW)).toBe('Aug 20')
    expect(relativeAgo(null, NOW)).toBeNull()
  })

  it("adds the year against the injected now, not today's clock", () => {
    expect(shortDate('2026-08-20T12:00:00Z', NOW)).toBe('Aug 20')
    expect(shortDate('2025-08-20T12:00:00Z', NOW)).toBe('Aug 20, 2025')
    const nextYear = new Date('2027-03-01T12:00:00Z').getTime()
    expect(relativeAgo('2026-08-20T12:00:00Z', nextYear)).toBe('Aug 20, 2026')
  })
})

describe('identity', () => {
  it('titles count leagues whose champion is my team', () => {
    const mine = [
      { id: 'l1', my_team_id: 't1' },
      { id: 'l2', my_team_id: 't2' },
      { id: 'l3', my_team_id: null },
    ]
    const champs = [
      { id: 'l1', champion_team_id: 't1' },
      { id: 'l2', champion_team_id: 'tX' },
      { id: 'l3', champion_team_id: 'tY' },
    ]
    expect(countTitles(mine, champs)).toBe(1)
    expect(countTitles(mine, [])).toBe(0)
  })
})

describe('lists preview', () => {
  it('kind is one of Ranked | Video | Tiers, or nothing', () => {
    expect(listKindLabel('ranked', false)).toBe('Ranked')
    expect(listKindLabel('rank_and_tier', true)).toBe('Tiers')
    // Tiers without numbers (migration 191) is still a tier list.
    expect(listKindLabel('tier_only', false)).toBe('Tiers')
    expect(listKindLabel('tier_only', true)).toBe('Tiers')
    expect(listKindLabel('unranked', true)).toBe('Video')
    expect(listKindLabel('unranked', false)).toBeNull()
  })

  it('sub: players · kind · updated', () => {
    expect(listRowSub({ player_count: 5, ranking_mode: 'ranked', updated_at: ago(2 * DAY) }, false, NOW)).toBe(
      '5 players · Ranked · Updated 2d ago',
    )
    expect(listRowSub({ player_count: 5, ranking_mode: 'unranked', updated_at: '2026-08-20T12:00:00Z' }, true, NOW)).toBe(
      '5 players · Video · Updated Aug 20',
    )
    expect(listRowSub({ player_count: 1, ranking_mode: 'rank_and_tier', updated_at: null }, false, NOW)).toBe(
      '1 player · Tiers',
    )
    expect(listRowSub({ player_count: 3, ranking_mode: 'unranked', updated_at: null }, false, NOW)).toBe('3 players')
  })
})

describe('rankings preview — one row per position ranking (gap list §3 #22)', () => {
  it('title: period · position · scoring', () => {
    expect(rankingRowTitle({ type: 'w5', pos: 'RB', scoring: 'half' }, 6)).toBe('Week 5 · RB · Half PPR')
    expect(rankingRowTitle({ type: 'season', pos: 'WR', scoring: 'ppr' }, 6)).toBe('Rest of season · WR · PPR')
    expect(rankingRowTitle({ type: 'season', pos: 'DST', scoring: 'std' }, 0)).toBe('Pre-draft · D/ST · Standard')
    expect(rankingRowTitle({ type: 'w7', pos: 'QB', scoring: 'quarter' }, 6)).toBe('Week 7 · QB · 0.25 PPR')
  })

  it('sub: the app’s own status words — Published, or Finalized once the week is played', () => {
    // This week, a week ahead and the season ranking are Published.
    expect(rankingRowSub({ type: 'w6', savedAt: ago(40 * MIN) }, 6, NOW)).toBe('Published · updated 40m ago')
    expect(rankingRowSub({ type: 'w8', savedAt: ago(2 * DAY) }, 6, NOW)).toBe('Published · updated 2d ago')
    expect(rankingRowSub({ type: 'season', savedAt: ago(3 * HOUR) }, 6, NOW)).toBe('Published · updated 3h ago')
    // A played week is Finalized.
    expect(rankingRowSub({ type: 'w4', savedAt: '2026-09-28T12:00:00Z' }, 6, NOW)).toBe('Finalized · updated Sep 28')
    // In the offseason Week 1 is this week — nothing is played yet.
    expect(rankingRowSub({ type: 'w1', savedAt: null }, 0, NOW)).toBe('Published')
    // Nothing reads Saved, Draft or Submitted.
    for (const sub of [rankingRowSub({ type: 'w6', savedAt: null }, 6), rankingRowSub({ type: 'w2', savedAt: null }, 6)]) {
      expect(sub).not.toMatch(/Saved|Draft|Submitted/)
    }
  })

  it('status colours: Published in the design’s Submitted green, Finalized in t4', () => {
    expect(RANKING_SUB_CLASS).toEqual({ Published: 'text-m-green', Finalized: 'text-m-t4' })
  })

  it('a row opens that ranking’s editor over the Mine tab; See all opens Mine; the button opens New ranking', () => {
    const query = (href: string) => new URLSearchParams(href.split('?')[1])
    expect(rankingEditHref('w5', 'RB')).toBe('/app/weekly-ranks?view=mine&pos=RB&edit=w5&ep=RB')
    const row = parseRankingsParams(query(rankingEditHref('season', 'DST')), { type: 'w6', pos: 'QB' })
    expect(row.view).toBe('mine')
    expect(row.overlay).toEqual({ kind: 'edit', type: 'season', pos: 'DST', from: null })
    const mine = parseRankingsParams(query(MY_RANKINGS_HREF), { type: 'season' })
    expect(mine.view).toBe('mine')
    expect(mine.overlay).toBeNull()
    const create = parseRankingsParams(query(NEW_RANKING_HREF), { type: 'season' })
    expect(create.overlay).toMatchObject({ kind: 'new', step: 1 })
  })

  it('sort newest save first, never saved last, ties keep their order', () => {
    const rows = [
      { id: 'a', savedAt: ago(3 * DAY) },
      { id: 'b', savedAt: null },
      { id: 'c', savedAt: ago(MIN) },
      { id: 'd', savedAt: ago(3 * DAY) },
    ]
    expect(sortRankingRows(rows).map((r) => r.id)).toEqual(['c', 'a', 'd', 'b'])
  })
})

const player = (id: string, full_name: string, team = 'KC') => ({
  id,
  full_name,
  team,
  position: 'RB',
  headshot_url: null,
})

const q = (over: Partial<SsQuestion> & { id: string }): SsQuestion => ({
  note: null,
  season: 2026,
  week: 6,
  votesA: 0,
  votesB: 0,
  closesAt: new Date(NOW + DAY).toISOString(),
  resolvedAt: null,
  createdAt: ago(HOUR),
  playerA: player('a', 'Isiah Pacheco'),
  playerB: player('b', 'Tyler Allgeier', 'ATL'),
  ...over,
})

describe('start/sit', () => {
  const open1 = q({ id: 'o1', createdAt: ago(2 * HOUR), votesA: 27, votesB: 31 })
  const open2 = q({ id: 'o2', createdAt: ago(MIN) })
  const closedWk4 = q({ id: 'c4', week: 4, closesAt: ago(9 * DAY), votesA: 152, votesB: 62 })
  const closedWk5 = q({ id: 'c5', week: 5, closesAt: ago(2 * DAY), votesA: 10, votesB: 10 })
  const resolved = q({ id: 'r', week: 3, resolvedAt: ago(DAY) })
  const all = [closedWk4, open1, resolved, closedWk5, open2]

  it('open = voting running and not resolved', () => {
    expect(ssIsOpen(open1, NOW)).toBe(true)
    expect(ssIsOpen(closedWk4, NOW)).toBe(false)
    expect(ssIsOpen(resolved, NOW)).toBe(false)
  })

  it('sorts open first (newest first), then closed by week, latest first', () => {
    expect(sortSsQuestions(all, NOW).map((x) => x.id)).toEqual(['o2', 'o1', 'c5', 'c4', 'r'])
  })

  it('filters and counts over the unfiltered set', () => {
    expect(ssCounts(all, NOW)).toEqual({ all: 5, open: 2, closed: 3 })
    expect(filterSsQuestions(all, 'open', NOW).map((x) => x.id)).toEqual(['o1', 'o2'])
    expect(filterSsQuestions(all, 'closed', NOW)).toHaveLength(3)
    expect(ssVotesReceived(all)).toBe(58 + 214 + 20)
  })

  it('results: whole percents, top highlighted, no lean at 0 votes or a tie', () => {
    expect(ssResults(open1)).toEqual({ total: 58, pcts: [47, 53], top: [false, true], lean: 1 })
    expect(ssResults(open2)).toEqual({ total: 0, pcts: [0, 0], top: [false, false], lean: null })
    expect(ssResults(closedWk5)).toEqual({ total: 20, pcts: [50, 50], top: [true, true], lean: null })
  })

  it('copy: title, footer, preview sub', () => {
    expect(shortName('Isiah Pacheco')).toBe('I. Pacheco')
    expect(shortName('A.J. Brown')).toBe('A.J. Brown')
    expect(shortName('Chiefs D/ST')).toBe('Chiefs D/ST')
    expect(ssTitle(open1)).toBe('I. Pacheco or T. Allgeier?')
    expect(ssTitle({ ...open1, note: ' FLEX spot: who starts? ' })).toBe('FLEX spot: who starts?')
    expect(ssFooter(open1, NOW)).toBe('58 votes · crowd leans T. Allgeier')
    expect(ssFooter(open2, NOW)).toBe('0 votes')
    expect(ssFooter(closedWk4, NOW)).toBe('214 votes')
    expect(ssFooter(q({ id: 'one', votesA: 1 }), NOW)).toBe('1 vote · crowd leans I. Pacheco')
    expect(ssPreviewSub(open1, NOW)).toBe('Start 1 of 2 · Open · 58 votes')
    expect(ssPreviewSub(closedWk4, NOW)).toBe('Start 1 of 2 · Closed · 214 votes')
  })

  it('meta and close labels', () => {
    expect(ssPostedLabel(ago(10_000), NOW)).toBe('Just now')
    expect(ssPostedLabel(ago(12 * MIN), NOW)).toBe('12m')
    expect(ssPostedLabel(ago(HOUR), NOW)).toBe('1h')
    expect(ssPostedLabel('2026-09-28T12:00:00Z', NOW)).toBe('Sep 28')
    // Local times, so the weekday/time read the same in every time zone.
    const local = new Date(2026, 9, 15, 9, 0).getTime()
    expect(ssClosesLabel(new Date(2026, 9, 18, 13, 0).toISOString(), local)).toBe('Sun 1:00 PM')
    expect(ssClosesLabel(new Date(2026, 9, 30, 13, 0).toISOString(), local)).toBe('Oct 30')
  })
})

describe('credCard — the slim Cred card (gap list §3 #21)', () => {
  it('reads the stored cred score through the existing tier table', () => {
    expect(credCard(340)).toEqual({
      tier: 'JV',
      accent: '#3B82F6',
      level: 'Scout tier 3 of 10',
      score: '340 cred',
      next: '260 to Varsity',
      pct: 13,
      top: false,
      barLabel: 'Progress to Varsity',
    })
  })

  it('starts a new account on the first tier with an empty bar', () => {
    expect(credCard(0)).toMatchObject({ tier: 'Freshie', level: 'Scout tier 1 of 10', next: '100 to Sophomore', pct: 0, top: false })
  })

  it('enters a tier at its threshold with the bar back at zero', () => {
    expect(credCard(600)).toMatchObject({ tier: 'Varsity', level: 'Scout tier 4 of 10', next: '400 to Rookie', pct: 0 })
    expect(credCard(599)).toMatchObject({ tier: 'JV', next: '1 to Varsity', pct: 100 })
  })

  it('groups thousands and stops at the top tier with a full bar', () => {
    expect(credCard(4500)).toMatchObject({ tier: 'Local Legend', score: '4,500 cred', next: '1,500 to Hall of Famer', pct: 25 })
    expect(credCard(9400)).toEqual({
      tier: 'GOAT',
      accent: '#1DB954',
      level: 'Scout tier 10 of 10',
      score: '9,400 cred',
      next: 'Top tier',
      pct: 100,
      top: true,
      barLabel: 'Top tier reached',
    })
  })
})
