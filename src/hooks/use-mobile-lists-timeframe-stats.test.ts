/** A frame's points under each list scoring (gap list #19), scored game by game
 *  by the one preset scorer (K0). */
import { describe, expect, it } from 'vitest'

import { framePts, projectionIn } from '@/components/mobile/lists/lists-stats'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { BASS_2026_WK1, BOSWELL_2026_WK8, cowboysThroughKickoff, DAL_2026_WK5, DAL_2026_WK6, JEANTY_2025_WK2, KICKOFF_DST, storedGame } from '@/lib/players/preset-scoring.fixtures'

import { frameTotals, LIST_SCORINGS, playerFrames } from './use-mobile-lists-timeframe-stats'

const row = (over: Record<string, number>) => ({ player_id: 'p1', season: 2026, week: 1, source: null, ...over })

describe('frameTotals', () => {
  it('sums the games and scores them four ways (only the catch value differs)', () => {
    const totals = frameTotals(
      [row({ receptions: 6, receiving_yards: 80, receiving_tds: 1 }), row({ receptions: 2, receiving_yards: 20 })],
      'WR',
    )
    // Standard: 100 yds × 0.1 + 1 TD × 6 = 16; catches: 8.
    expect(totals?.games).toBe(2)
    expect(totals?.receptions).toBe(8)
    expect(totals?.pts).toEqual({ standard: 16, quarter: 18, half: 20, ppr: 24 })
  })

  it('no games is no frame', () => {
    expect(frameTotals([], 'WR')).toBeNull()
    expect(frameTotals([], 'K')).toBeNull()
  })

  it('a kicker reads ESPN table in all four scorings: Bass 13 + Boswell 8 = 21', () => {
    const totals = frameTotals([storedGame('k', 2026, 1, BASS_2026_WK1), storedGame('k', 2026, 8, BOSWELL_2026_WK8)], 'K')
    expect(totals?.games).toBe(2)
    expect(totals?.pts).toEqual({ standard: 21, quarter: 21, half: 21, ppr: 21 })
  })

  it('a two-week D/ST is its games alone: Cowboys −2 + 5 = 3 in all four scorings', () => {
    const totals = frameTotals([storedGame('DAL', 2026, 5, DAL_2026_WK5), storedGame('DAL', 2026, 6, DAL_2026_WK6)], 'DEF')
    expect(totals?.pts).toEqual({ standard: 3, quarter: 3, half: 3, ppr: 3 })
  })

  it('a frame whose every game is refused has no number', () => {
    expect(frameTotals([storedGame('DAL', 2026, 7, KICKOFF_DST)], 'DEF')).toBeNull()
  })

  it('0.25 PPR rounds an exact half up: Jeanty 2025 wk2 is 5.15, read as 5.2', () => {
    expect(frameTotals([storedGame('RB', 2025, 2, JEANTY_2025_WK2)], 'RB')?.pts.quarter).toBe(5.2)
  })
})

describe('refused games are not games (Cowboys weeks 5 and 6 final, week 7 a live kickoff row)', () => {
  const entry = { player_id: 'DAL', player: { position: 'DEF' } } as unknown as ListPlayerWithPlayer
  const frames = playerFrames(cowboysThroughKickoff(), null, 'DEF', 6)

  it('2 games, 3 points, average 1.5, pace 25.5, in every scoring', () => {
    expect(frames.season?.games).toBe(2)
    for (const scoring of LIST_SCORINGS) {
      const season = frames.season!
      expect(framePts(season, scoring), scoring).toBe(3)
      expect(framePts(season, scoring) / season.games, scoring).toBe(1.5)
    }
    for (const scoring of ['half', 'quarter', 'standard'] as const) {
      expect(projectionIn(entry, frames.season, scoring), scoring).toBe(25.5)
    }
  })

  it('Last 3 is the last three SCORED games, so the refused newest row takes no slot', () => {
    const early = storedGame('DAL', 2026, 4, DAL_2026_WK6)
    const withEarlier = playerFrames([early, ...cowboysThroughKickoff()], null, 'DEF', 6)
    expect(withEarlier.last3?.games).toBe(3)
    expect(withEarlier.last3?.pts.ppr).toBe(8)
    expect(withEarlier.season?.games).toBe(3)
  })

  it('Week N on a refused game is a dash, not a 0', () => {
    expect(playerFrames(cowboysThroughKickoff(), null, 'DEF', 7).week).toBeNull()
    expect(frames.week?.pts.ppr).toBe(5)
  })

  it('last season is only there when it was read, and a K with no usable rows has no frame', () => {
    expect('lastSeason' in frames).toBe(false)
    const empty = storedGame('k', 2025, 3, {})
    expect(playerFrames([], [empty], 'K', 6).lastSeason).toBeNull()
  })

  it('a player with rows and no position fails loudly; with no rows he just has no frames', () => {
    expect(() => playerFrames(cowboysThroughKickoff(), null, '', 6)).toThrow(/no position/)
    expect(playerFrames([], null, '', 6).season).toBeNull()
  })
})
