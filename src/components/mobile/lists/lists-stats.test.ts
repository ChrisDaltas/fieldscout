import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'

import { DASH, MOBILE_STATS, STAT_GROUPS, needsSource, resolveMobileStats, type ValueCtx } from './lists-stats'

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
