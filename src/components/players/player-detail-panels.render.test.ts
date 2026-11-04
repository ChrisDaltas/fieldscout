/**
 * The desktop card's fantasy panels with a game that can't be scored (K0): a
 * dash on that game, the average and bars over the rest, and never NaN.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { GameLogRow, PlayerStatsResponse, SeasonBlock } from '@/hooks/use-player-stats'

import { GameLogPanel, StatsPanel, WeeklyPointsList } from './player-detail-panels'

const game = (week: number, ppr: number | null, standard: number | null = ppr): GameLogRow => ({
  week,
  source: 'sleeper',
  is_live: false,
  stats: {} as GameLogRow['stats'],
  fantasy: { ppr, standard },
})

const season = (fantasy: SeasonBlock['fantasy'], gamesPlayed: number): SeasonBlock => ({
  season: 2026,
  gamesPlayed,
  totals: {} as SeasonBlock['totals'],
  fantasy,
})

const response = (gameLog: GameLogRow[], fantasy: SeasonBlock['fantasy'], gamesPlayed: number): PlayerStatsResponse =>
  ({
    player: { position: 'DEF' },
    seasons: { current: season(fantasy, gamesPlayed), last: season(fantasy, gamesPlayed), projection: season(fantasy, gamesPlayed) },
    gameLog,
  }) as unknown as PlayerStatsResponse

describe('WeeklyPointsList', () => {
  it('skips a refused game in the average and bars and shows it as a dash', () => {
    const html = renderToStaticMarkup(createElement(WeeklyPointsList, { data: response([game(5, -2), game(6, 5), game(7, null)], { ppr: 3, standard: 3 }, 2) }))
    expect(html).toContain('>1.5<') // (−2 + 5) ÷ 2 scored games, not 3
    expect(html).toContain('>3<')
    expect(html).toContain('>–<')
    expect(html).not.toContain('NaN')
  })

  it('with every game refused it says there are none, and never prints NaN', () => {
    const html = renderToStaticMarkup(createElement(WeeklyPointsList, { data: response([game(1, null)], { ppr: null, standard: null }, 0) }))
    expect(html).toContain('No games logged yet')
    expect(html).not.toContain('NaN')
  })
})

describe('GameLogPanel and StatsPanel', () => {
  it('a null reads as a dash in the game log, with no NaN', () => {
    const html = renderToStaticMarkup(createElement(GameLogPanel, { data: response([game(5, -2), game(7, null)], { ppr: -2, standard: -2 }, 1) }))
    expect(html).toContain('-2.0')
    expect(html).toContain('–')
    expect(html).not.toContain('NaN')
  })

  it('a K or D/ST season with no number reads as a dash', () => {
    const html = renderToStaticMarkup(createElement(StatsPanel, { data: response([], { ppr: null, standard: null }, 0) }))
    expect(html).toContain('–')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('0.0') // not even "PPR / game 0.0" beside the dash
  })
})
