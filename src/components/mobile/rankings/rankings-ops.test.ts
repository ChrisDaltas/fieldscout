import { describe, expect, it } from 'vitest'

import {
  agreementNote,
  cmpToneClass,
  expertConsensus,
  expertSpread,
  formatSaved,
  moveItem,
  onBye,
  parseRankingsParams,
  planSliceSave,
  shortName,
  tierBreaks,
  toRankingsSearch,
  weekStatus,
  weeklySub,
} from '@/components/mobile/rankings/rankings-ops'

describe('tierBreaks (handoff breaks, lr-frame §2.13.8)', () => {
  it('breaks where a gap beats 1.55 × the mean, keeping ≥ 2 per tier', () => {
    // gaps 1,1,10,1,1 → mean 2.8 → only the 10 qualifies (before index 3)
    expect(tierBreaks([20, 19, 18, 8, 7, 6])).toEqual([3])
  })
  it('never breaks before index 1 (tier 1 holds at least 2)', () => {
    expect(tierBreaks([100, 1, 0.5])).toEqual([])
  })
  it('caps at 7 breaks (8 tiers)', () => {
    const scores = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1000 - i * 50 : 1000 - i * 50 - 1))
    expect(tierBreaks(scores).length).toBeLessThanOrEqual(7)
  })
  it('has no breaks for 0–1 rows or equal scores', () => {
    expect(tierBreaks([])).toEqual([])
    expect(tierBreaks([5])).toEqual([])
    expect(tierBreaks([3, 3, 3])).toEqual([])
  })
})

describe('planSliceSave writes only the edited position', () => {
  // Board slots (list_players.position) with gaps, as deletes leave them.
  const rows = [
    { playerId: 'qb1', slot: 1, pos: 'QB' as const },
    { playerId: 'rb1', slot: 2, pos: 'RB' as const },
    { playerId: 'wr1', slot: 4, pos: 'WR' as const },
    { playerId: 'rb2', slot: 5, pos: 'RB' as const },
    { playerId: 'te1', slot: 7, pos: 'TE' as const },
    { playerId: 'rb3', slot: 9, pos: 'RB' as const },
  ]
  it('permutes a position inside its own slots and sends nothing else', () => {
    expect(planSliceSave(rows, 'RB', ['rb3', 'rb1', 'rb2'])).toEqual({
      remove: [],
      add: [],
      positions: [
        { playerId: 'rb3', position: 2 },
        { playerId: 'rb1', position: 5 },
        { playerId: 'rb2', position: 9 },
      ],
    })
  })
  it('drops removed players and puts added ones after the last slot', () => {
    expect(planSliceSave(rows, 'RB', ['rb2', 'rb9', 'rb7', 'rb8'])).toEqual({
      remove: ['rb1', 'rb3'],
      add: ['rb9', 'rb7', 'rb8'],
      positions: [
        { playerId: 'rb2', position: 2 },
        { playerId: 'rb9', position: 5 },
        { playerId: 'rb7', position: 9 },
        { playerId: 'rb8', position: 10 },
      ],
    })
  })
  it('a blank start empties the slice; a new board has no slots yet', () => {
    expect(planSliceSave(rows, 'RB', [])).toEqual({ remove: ['rb1', 'rb2', 'rb3'], add: [], positions: [] })
    expect(planSliceSave([], 'K', ['k1', 'k2']).positions).toEqual([
      { playerId: 'k1', position: 1 },
      { playerId: 'k2', position: 2 },
    ])
  })
})

describe('AI expert consensus (the Experts source)', () => {
  const orders = [
    { expert: 'a', players: ['p1', 'p2', 'p3'] },
    { expert: 'b', players: ['p2', 'p1', 'p3'] },
    { expert: 'c', players: ['p1', 'p3'] },
  ]
  it('orders by mean rank, an unranked player one past that expert’s last spot', () => {
    const rows = expertConsensus(orders)
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3'])
    // p2: 2 + 1 + (2 + 1) = 6 → 2.0; p3: 3 + 3 + 2 = 8 → 2.67
    expect(rows[1]!.mean).toBe(2)
    expect(rows[1]!.ranks).toEqual([2, 1])
  })
  it('spread and the agreement note (lr-hub §5.4)', () => {
    expect(expertSpread([])).toBeNull()
    const tight = expertSpread([3, 5, 4])!
    expect([tight.best, tight.worst]).toEqual([3, 5])
    expect(agreementNote('S. Barkley', tight)).toBe('Experts mostly agree. Every expert has him within two spots.')
    expect(agreementNote('S. Barkley', expertSpread([3, 6, 4])!)).toBe('Experts mostly agree. Range #3 to #6.')
    expect(agreementNote('G. Wilson', expertSpread([1, 9, 2, 10])!)).toBe(
      'Experts disagree on G. Wilson. Range #1 to #10 is wider than most at this tier.',
    )
  })
  it('comparison colour: ±3 or more turns red (ranked lower) or green (higher)', () => {
    expect(cmpToneClass(9, 5)).toBe('text-negative-strong')
    expect(cmpToneClass(2, 5)).toBe('text-positive-strong')
    expect(cmpToneClass(7, 5)).toBe('text-m-t1')
    expect(cmpToneClass(undefined, 5)).toBe('text-m-t1')
  })
})

describe('moveItem lands where the drop line shows', () => {
  const a = ['a', 'b', 'c', 'd']
  it('moving down inserts before the target row', () => {
    expect(moveItem(a, 0, 3)).toEqual(['b', 'c', 'a', 'd'])
  })
  it('moving to the end', () => {
    expect(moveItem(a, 0, 4)).toEqual(['b', 'c', 'd', 'a'])
  })
  it('moving up', () => {
    expect(moveItem(a, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })
  it('a drop on its own edges is a no-op', () => {
    expect(moveItem(a, 1, 1)).toEqual(a)
    expect(moveItem(a, 1, 2)).toEqual(a)
  })
})

describe('names and sublines', () => {
  it('short names keep defenses whole', () => {
    expect(shortName('Amon-Ra St. Brown', 'WR')).toBe('A. St. Brown')
    expect(shortName('Denver Broncos', 'DEF')).toBe('Denver Broncos')
  })
  it('weekly subline reads the real schedule, with byes', () => {
    const games = [{ home_team: 'BAL', away_team: 'PHI' }]
    expect(weeklySub('PHI', games)).toBe('PHI @ BAL')
    expect(weeklySub('BAL', games)).toBe('BAL vs PHI')
    expect(weeklySub('KC', games)).toBe('KC · Bye')
    expect(weeklySub('KC', [])).toBe('KC')
    expect(onBye('KC', games)).toBe(true)
    expect(onBye('PHI', games)).toBe(false)
    expect(onBye('KC', [])).toBe(false)
  })
  it('save stamps', () => {
    const now = Date.parse('2026-10-15T12:00:00Z')
    expect(formatSaved('2026-10-15T11:59:30Z', now)).toBe('Just now')
    expect(formatSaved('2026-10-13T12:00:00Z', now)).toBe('Oct 13')
    expect(formatSaved(null, now)).toBeNull()
  })
})

describe('weekStatus follows the app rule (current week only)', () => {
  it('in season', () => {
    expect(weekStatus('w5', 6)).toBe('past')
    expect(weekStatus('w6', 6)).toBe('current')
    expect(weekStatus('w7', 6)).toBe('future')
    expect(weekStatus('season', 6)).toBe('season')
  })
  it('offseason treats week 1 as current', () => {
    expect(weekStatus('w1', 0)).toBe('current')
    expect(weekStatus('w2', 0)).toBe('future')
  })
})

describe('url state', () => {
  it('round-trips the hub and overlays', () => {
    const s = parseRankingsParams(new URLSearchParams('src=users&pos=WR&scoring=std&edit=w6&ep=QB&from=experts'), {
      type: 'season',
    })
    expect(s).toEqual({
      view: 'hub',
      src: 'users',
      scoring: 'std',
      pos: 'WR',
      overlay: { kind: 'edit', type: 'w6', pos: 'QB', from: 'experts' },
    })
    expect(toRankingsSearch(s)).toBe('?src=users&scoring=std&pos=WR&edit=w6&ep=QB&from=experts')
  })
  it('Experts is the default source; unknown sources and starts fall back', () => {
    const s = parseRankingsParams(new URLSearchParams('src=adp&edit=season&from=nope'), { type: 'season' })
    expect(s.src).toBe('experts')
    expect(s.overlay).toEqual({ kind: 'edit', type: 'season', pos: 'RB', from: null })
    expect(toRankingsSearch({ ...s, overlay: null })).toBe('')
    expect(parseRankingsParams(new URLSearchParams('src=p:abc-123'), { type: 'season' }).src).toBe('p:abc-123')
  })
  it('view=mine forces the Mine source; bad values fall back', () => {
    const s = parseRankingsParams(new URLSearchParams('view=mine&src=users&pos=XX&new=2&nt=w99'), { type: 'season' })
    expect(s.src).toBe('mine')
    expect(s.pos).toBe('RB')
    expect(s.overlay).toEqual({ kind: 'new', step: 2, type: 'season', pos: 'RB' })
    expect(toRankingsSearch({ ...s, overlay: null })).toBe('?view=mine')
  })
  it('the desktop ?tab=pre link opens My rankings', () => {
    expect(parseRankingsParams(new URLSearchParams('tab=pre'), { type: 'season' }).view).toBe('mine')
  })
})
