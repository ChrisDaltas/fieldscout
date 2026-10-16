import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import type { FrameTotals } from '@/hooks/use-mobile-lists-timeframe-stats'

import {
  DASH,
  MOBILE_STATS,
  STAT_GROUPS,
  needsLastSeason,
  needsSource,
  resolveMobileStats,
  scoringLabel,
  seasonLine,
  showsPoints,
  type ValueCtx,
} from './lists-stats'

const player = (position: string) =>
  ({ player_id: 'p1', player: { id: 'p1', full_name: 'Test Player', position, team: 'BUF' } }) as ListPlayerWithPlayer

const ctx = (over: Partial<ValueCtx> = {}): ValueCtx => ({
  frames: undefined,
  tf: 'week',
  usage: undefined,
  posRank: undefined,
  ready: { frames: true, usage: true, ranks: true },
  ...over,
})

const stat = (id: string) => {
  const found = MOBILE_STATS.find((s) => s.id === id)
  if (!found) throw new Error(id)
  return found
}

describe('Add stats catalogue', () => {
  it('follows the design’s groups, then the app’s own', () => {
    expect(STAT_GROUPS).toEqual(['Rankings', 'Fantasy', 'Usage', 'Receiving', 'Rushing', 'Passing', 'Draft', 'Schedule'])
    const chips = (group: string) => MOBILE_STATS.filter((s) => s.group === group).map((s) => s.chip)
    expect(chips('Rankings')).toEqual(['Pos rk'])
    expect(chips('Usage')).toEqual(['Snap %', 'Tgt share'])
  })

  it('Pos rk is the season-points rank, "–" when unranked, blank until the pool lands', () => {
    expect(stat('posrk').value(player('QB'), ctx({ posRank: 3 }))).toBe('3')
    expect(stat('posrk').value(player('QB'), ctx({ posRank: null }))).toBe(DASH)
    expect(stat('posrk').value(player('QB'), ctx({ ready: { frames: true, usage: true, ranks: false } }))).toBe('')
  })

  it('usage columns: whole percent, "–" where the position has none, blank while loading', () => {
    expect(stat('snap').value(player('WR'), ctx({ usage: { snap: 87.6, tshare: 24.2 } }))).toBe('88%')
    expect(stat('tshare').value(player('WR'), ctx({ usage: { snap: 87.6, tshare: 24.2 } }))).toBe('24%')
    expect(stat('snap').value(player('QB'), ctx({ usage: { snap: 100, tshare: null } }))).toBe('100%')
    expect(stat('tshare').value(player('QB'), ctx({ usage: { snap: 100, tshare: null } }))).toBe(DASH)
    expect(stat('snap').value(player('K'), ctx())).toBe(DASH)
    expect(stat('snap').value(player('WR'), ctx({ usage: undefined }))).toBe(DASH)
    expect(stat('snap').value(player('WR'), ctx({ ready: { frames: true, usage: false, ranks: true } }))).toBe('')
  })

  it('knows which reads the chosen columns need', () => {
    const cols = resolveMobileStats(['proj', 'snap', 'nope'])
    expect(cols.map((s) => s.id)).toEqual(['proj', 'snap'])
    expect(needsSource(cols, 'usage')).toBe(true)
    expect(needsSource(cols, 'frames')).toBe(false)
    expect(needsSource(cols, 'ranks')).toBe(false)
  })
})

describe('scoring (gap list #19)', () => {
  const frame = (games: number, ppr: number, half: number, quarter: number, standard: number): FrameTotals =>
    ({ games, pts: { ppr, half, quarter, standard } }) as unknown as FrameTotals
  const wr = {
    player_id: 'p1',
    player: {
      id: 'p1',
      full_name: 'Test Player',
      position: 'WR',
      team: 'BUF',
      projected_pts_standard: 180,
      projected_pts_half_ppr: 220,
      projected_pts_ppr: 260,
    },
    stats: { current_pts: 88.8, current_games: 4, last_pts: 300, last_games: 17, projected_pts: 377.4 },
  } as unknown as ListPlayerWithPlayer
  const frames = {
    week: frame(1, 25, 22, 20.5, 19),
    last3: null,
    season: frame(4, 88.8, 76, 69.6, 63.2),
    lastSeason: frame(17, 300, 260, 240, 220),
  }

  it('PPR keeps the payload’s own figures', () => {
    expect(stat('proj').value(wr, ctx({ frames, scoring: 'ppr' }))).toBe('377.4')
    expect(stat('current').value(wr, ctx({ frames, scoring: 'ppr' }))).toBe('88.8')
    expect(stat('last').value(wr, ctx({ frames, scoring: 'ppr' }))).toBe('300.0')
    expect(stat('pts').value(wr, ctx({ frames }))).toBe('25.0')
  })

  it('every points column follows the scoring', () => {
    const half = ctx({ frames, scoring: 'half' })
    expect(stat('pts').value(wr, half)).toBe('22.0')
    expect(stat('avg').value(wr, half)).toBe('19.0')
    expect(stat('current').value(wr, half)).toBe('76.0')
    expect(stat('last').value(wr, half)).toBe('260.0')
    // In season: the pace over 17 games (76 / 4 × 17).
    expect(stat('proj').value(wr, half)).toBe('323.0')
    expect(stat('pts').value(wr, ctx({ frames, scoring: 'quarter' }))).toBe('20.5')
    expect(stat('last').value(wr, ctx({ frames, scoring: 'standard' }))).toBe('220.0')
  })

  it('before his first game, the stored projection for the scoring (Quarter = midpoint)', () => {
    const preseason = { week: null, last3: null, season: null, lastSeason: null }
    expect(stat('proj').value(wr, ctx({ frames: preseason, scoring: 'standard' }))).toBe('180.0')
    expect(stat('proj').value(wr, ctx({ frames: preseason, scoring: 'half' }))).toBe('220.0')
    expect(stat('proj').value(wr, ctx({ frames: preseason, scoring: 'quarter' }))).toBe('200.0')
    expect(stat('current').value(wr, ctx({ frames: preseason, scoring: 'half' }))).toBe('0.0')
  })

  it('blank (never "–") until the weekly rows land', () => {
    const loading = ctx({ scoring: 'half', ready: { frames: false, usage: true, ranks: true } })
    expect(stat('proj').value(wr, loading)).toBe('')
    expect(stat('last').value(wr, ctx({ frames: { ...frames, lastSeason: undefined }, scoring: 'half' }))).toBe('')
  })

  it('outside PPR the payload columns need the weekly read (2025 pts: last season too)', () => {
    const cols = resolveMobileStats(['proj', 'last', 'adp'])
    expect(needsSource(cols, 'frames')).toBe(false)
    expect(needsSource(cols, 'frames', 'half')).toBe(true)
    expect(needsLastSeason(cols, 'ppr')).toBe(false)
    expect(needsLastSeason(cols, 'standard')).toBe(true)
    expect(needsLastSeason(resolveMobileStats(['proj']), 'standard')).toBe(false)
    expect(showsPoints(cols)).toBe(true)
    expect(showsPoints(resolveMobileStats(['adp', 'snap']))).toBe(false)
  })

  it('the editor rows’ Pts / Avg line', () => {
    expect(seasonLine(wr, frames, true, 'ppr')).toEqual({ pts: 88.8, games: 4 })
    expect(seasonLine(wr, frames, true, 'standard')).toEqual({ pts: 63.2, games: 4 })
    expect(seasonLine(wr, frames, false, 'standard')).toBeUndefined()
    expect(seasonLine(wr, { ...frames, season: null }, true, 'half')).toEqual({ pts: 0, games: 0 })
  })

  it('labels', () => {
    expect(['ppr', 'half', 'quarter', 'standard'].map((s) => scoringLabel(s as never))).toEqual([
      'PPR',
      'Half PPR',
      'Quarter PPR',
      'Standard',
    ])
  })
})
