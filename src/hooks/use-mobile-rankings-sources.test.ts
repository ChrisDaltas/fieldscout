import { describe, expect, it } from 'vitest'

import type { BoardSourcePlayer } from '@/hooks/use-board-sources'
import {
  HUB_CAP,
  boardMovement,
  expertBoardsFor,
  marketRows,
  poolStats,
  quarterPool,
  type BuilderPlayer,
  type ExpertBoard,
  type HubPlayer,
} from '@/hooks/use-mobile-rankings-sources'

/**
 * Rankings' position pool in every scoring the phone offers (Chris,
 * 2026-10-15, gap list #30) and the hub's 36-player cap (#31).
 */

function player(id: string, over: Partial<BuilderPlayer>): BuilderPlayer {
  return {
    id,
    full_name: `Player ${id}`,
    position: 'WR',
    team: 'KC',
    headshot_url: null,
    current_pts: 0,
    current_games: 0,
    projected_pts: null,
    stats_current: {},
    ...over,
  }
}

describe('0.25 PPR pool', () => {
  // 10 catches, 100 yards, 1 TD: Standard 16, Half 21 → 0.25 PPR 18.5.
  const catches = { receptions: 10, receiving_yards: 100, receiving_tds: 1 }
  const std = [
    player('a', { current_pts: 16, current_games: 2, projected_pts: 100, stats_current: catches }),
    player('b', { current_pts: 30, current_games: 2, projected_pts: 90, stats_current: { rush_yards: 300 } }),
    player('c', { projected_pts: null }),
  ]
  const half = [
    player('a', { current_pts: 21, current_games: 2, projected_pts: 120, stats_current: catches }),
    player('b', { current_pts: 30, current_games: 2, projected_pts: 90, stats_current: { rush_yards: 300 } }),
    player('c', { projected_pts: 50 }),
  ]

  it('scores points from the season totals with 0.25 a catch', () => {
    const out = quarterPool(std, half)
    expect(out.find((p) => p.id === 'a')?.current_pts).toBe(18.5)
    expect(out.find((p) => p.id === 'b')?.current_pts).toBe(30)
  })

  it('projects the midpoint of Standard and Half PPR, and re-sorts by it', () => {
    const out = quarterPool(std, half)
    expect(out.map((p) => [p.id, p.projected_pts])).toEqual([
      ['a', 110],
      ['b', 90],
      // No Standard projection → none in 0.25 PPR (never half a guess).
      ['c', null],
    ])
  })

  it('fails loudly when the season totals are missing, rather than showing zeros', () => {
    expect(() => quarterPool([player('a', { stats_current: undefined })], half)).toThrow()
  })
})

describe('pool stats', () => {
  it('Pos rk ranks season points among players who played (ties share); projection order is kept', () => {
    const stats = poolStats([
      player('a', { current_pts: 20, current_games: 2, projected_pts: 200 }),
      player('b', { current_pts: 30, current_games: 2, projected_pts: 150 }),
      player('c', { current_pts: 20, current_games: 2, projected_pts: 100 }),
      player('d', { current_pts: 0, current_games: 0, projected_pts: 90 }),
    ])
    expect([...stats.values()].map((s) => [s.id, s.posRank, s.projRank])).toEqual([
      ['a', 2, 1],
      ['b', 1, 2],
      ['c', 2, 3],
      ['d', null, 4],
    ])
  })
})

describe('the hub cap', () => {
  it('shows the top 36 at a position', () => {
    expect(HUB_CAP).toBe(36)
  })
})

function market(id: string, position: string, adp: number | null, auction: number | null): BoardSourcePlayer {
  return {
    id,
    full_name: `Player ${id}`,
    position,
    team: 'KC',
    headshot_url: null,
    bye_week: 10,
    adp,
    projected_pts_standard: null,
    projected_pts_half_ppr: null,
    projected_pts_ppr: null,
    sos: null,
    auction_value: auction,
  }
}

describe('ADP and Auction tabs (gap list #29) — desktop Big Board’s market boards', () => {
  // Desktop's ADP board comes ADP-first; its auction board price-first.
  const adpBoard = [market('qb', 'QB', 1.2, 30), market('rb', 'RB', 2.5, 60), market('te', 'TE', 3.1, 25), market('wr', 'WR', 4, null)]
  it('cuts the board to a position, ADP lowest first, carrying the value', () => {
    const rb = marketRows(adpBoard, 'adp', 'RB')
    expect(rb.rows.map((r) => r.player.id)).toEqual(['rb'])
    expect(rb.values.get('rb')).toBe(2.5)
    // Higher score = better, for the tier cuts.
    expect(rb.rows[0]!.score).toBe(-2.5)
  })
  it('FLEX is RB, WR and TE in the board’s overall order', () => {
    expect(marketRows(adpBoard, 'adp', 'FLEX').rows.map((r) => r.player.id)).toEqual(['rb', 'te', 'wr'])
  })
  it('Auction skips players without a price, highest price first', () => {
    const auctionBoard = [market('rb', 'RB', 2.5, 60), market('qb', 'QB', 1.2, 30), market('wr', 'WR', 4, null)]
    const flex = marketRows(auctionBoard, 'auction', 'FLEX')
    expect(flex.rows.map((r) => [r.player.id, r.score])).toEqual([['rb', 60]])
  })
})

describe('Experts at FLEX', () => {
  const board = (id: string, expert: string, position_filter: string | null): ExpertBoard => ({
    id,
    title: id,
    description: null,
    position_filter,
    player_count: 10,
    updated_at: '2026-10-01T00:00:00Z',
    persona: { username: expert, display_name: expert, avatar_url: null, scoring: 'PPR' },
  })
  it('only an overall board can order FLEX; a position keeps its own board first', () => {
    const boards = [board('e1-rb', 'e1', 'RB'), board('e1-all', 'e1', null), board('e2-rb', 'e2', 'RB')]
    expect(expertBoardsFor(boards, 'FLEX').map((b) => b.id)).toEqual(['e1-all'])
    expect(expertBoardsFor(boards, 'RB').map((b) => b.id)).toEqual(['e1-rb', 'e2-rb'])
  })
})

describe('an AI expert’s board movement (gap list #33)', () => {
  const hp = (id: string, position: string): HubPlayer => ({
    id,
    full_name: id,
    position,
    team: 'KC',
    headshot_url: null,
    bye_week: null,
  })

  it('measures the position’s rows against the board’s previous update', () => {
    // Overall board: QB q sits between the backs and is not counted.
    const board = {
      players: [hp('b', 'RB'), hp('q', 'QB'), hp('a', 'RB'), hp('n', 'RB')],
      prev: new Map<string, number | null>([
        ['a', 1],
        ['q', 2],
        ['b', 4],
        ['n', null],
      ]),
    }
    expect([...boardMovement(board, 'RB')]).toEqual([
      ['b', 1],
      ['a', -1],
      ['n', 'new'],
    ])
    expect(boardMovement(undefined, 'RB').size).toBe(0)
  })

  it('counts over the whole position, not just the top 36 shown', () => {
    // 45 backs; the one now 30th was 40th before (everyone from 30th to
    // 39th slid down one).
    const ids = Array.from({ length: 45 }, (_, i) => `rb${i + 1}`)
    const now = [...ids.slice(0, 29), 'rb40', ...ids.slice(29, 39), ...ids.slice(40)]
    const board = {
      players: now.map((id) => hp(id, 'RB')),
      prev: new Map<string, number | null>(ids.map((id, i) => [id, i + 1])),
    }
    const m = boardMovement(board, 'RB')
    expect(now.indexOf('rb40')).toBe(29)
    expect(m.get('rb40')).toBe(10)
    expect(m.get('rb30')).toBe(-1)
    expect(HUB_CAP).toBeLessThan(40)
  })
})
