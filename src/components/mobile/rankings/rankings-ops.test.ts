import { describe, expect, it } from 'vitest'

import {
  afterPublish,
  agreementNote,
  backAction,
  cmpToneClass,
  expertConsensus,
  expertSpread,
  formatSaved,
  moveItem,
  onBye,
  opensInWeek,
  orderChanged,
  parseRankingsParams,
  planSliceSave,
  publishButtonLabel,
  publishedToast,
  rankDelta,
  rankMap,
  rankableWeeks,
  rankingExists,
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

// Chris, 2026-10-15: "This week + 3 weeks out and rest of season" — this
// replaces the old current-week-only rule these tests used to pin.
describe('weekStatus: this week and the next three are open', () => {
  it('in season', () => {
    expect(weekStatus('w5', 6)).toBe('past')
    expect(weekStatus('w6', 6)).toBe('current')
    expect(weekStatus('w7', 6)).toBe('upcoming')
    expect(weekStatus('w9', 6)).toBe('upcoming')
    expect(weekStatus('w10', 6)).toBe('future')
    expect(weekStatus('season', 6)).toBe('season')
  })
  it('offseason treats week 1 as this week', () => {
    expect(weekStatus('w1', 0)).toBe('current')
    expect(weekStatus('w2', 0)).toBe('upcoming')
    expect(weekStatus('w4', 0)).toBe('upcoming')
    expect(weekStatus('w5', 0)).toBe('future')
  })
  it('stops at the regular season’s last week', () => {
    expect(weekStatus('w18', 16)).toBe('upcoming')
    expect(weekStatus('w18', 18)).toBe('current')
    expect(weekStatus('w17', 18)).toBe('past')
  })
})

describe('rankableWeeks / opensInWeek', () => {
  it('this week plus three, capped at week 18', () => {
    expect(rankableWeeks(6)).toEqual([6, 7, 8, 9])
    expect(rankableWeeks(0)).toEqual([1, 2, 3, 4])
    expect(rankableWeeks(16)).toEqual([16, 17, 18])
    expect(rankableWeeks(18)).toEqual([18])
  })
  it('a locked week opens three weeks before it (the handoff’s week − 3)', () => {
    expect(opensInWeek(10)).toBe(7)
    expect(opensInWeek(18)).toBe(15)
    expect(opensInWeek(2)).toBe(1)
  })
  it('agrees with weekStatus', () => {
    for (const cw of [0, 1, 6, 15, 18]) {
      const open = new Set(rankableWeeks(cw))
      for (let w = 1; w <= 18; w++) {
        const st = weekStatus(`w${w}`, cw)
        expect(open.has(w)).toBe(st === 'current' || st === 'upcoming')
      }
    }
  })
})

describe('publishing (Chris, 2026-10-15: one commit button, no save-without-publish)', () => {
  const base = { readOnly: false, isNew: false, dirty: false, publishing: false }
  it('Publish for a ranking that doesn’t exist yet, Publish updates for one that does', () => {
    expect(publishButtonLabel({ ...base, isNew: true })).toBe('Publish')
    expect(publishButtonLabel({ ...base, isNew: true, dirty: true })).toBe('Publish')
    expect(publishButtonLabel({ ...base, dirty: true })).toBe('Publish updates')
    expect(publishButtonLabel(base)).toBe('Published')
  })
  it('in flight, and a played week stays Finalized', () => {
    expect(publishButtonLabel({ ...base, dirty: true, publishing: true })).toBe('Publishing…')
    expect(publishButtonLabel({ ...base, readOnly: true })).toBe('Finalized')
  })
  it('never offers a plain save', () => {
    const labels = new Set<string>()
    for (const readOnly of [false, true])
      for (const isNew of [false, true])
        for (const dirty of [false, true])
          for (const publishing of [false, true]) labels.add(publishButtonLabel({ readOnly, isNew, dirty, publishing }))
    expect([...labels].some((l) => /\bsave/i.test(l))).toBe(false)
  })
  it('confirmation toast', () => {
    expect(publishedToast(true)).toBe('Ranking published')
    expect(publishedToast(false)).toBe('Updates published')
  })

  const rb = { player: { position: 'RB' } }
  it('a ranking exists by the board, not by where the draft started', () => {
    // Starting from the experts over the RB ranking you have → an update.
    expect(rankingExists([rb, rb], 'RB', null)).toBe(true)
    expect(rankingExists([{ player: { position: 'WR' } }], 'RB', null)).toBe(false)
    expect(rankingExists([], 'RB', null)).toBe(false)
    // After a publish here, that publish decides (emptied → none).
    expect(rankingExists([rb], 'RB', false)).toBe(false)
    expect(rankingExists([], 'RB', true)).toBe(true)
  })

  it('after a publish: nothing unpublished, the +/– markers reset to it', () => {
    // Opened at A B C D; the draft moved D to the top.
    const start = rankMap(['A', 'B', 'C', 'D'])
    const next = ['D', 'A', 'B', 'C']
    expect(next.map((id, i) => rankDelta(start, id, i + 1))).toEqual([3, -1, -1, -1])
    expect(orderChanged(next, ['A', 'B', 'C', 'D'])).toBe(true)

    const after = afterPublish(next)
    expect(after.savedSeq).toEqual(next)
    expect(orderChanged(next, after.savedSeq)).toBe(false)
    expect(next.map((id, i) => rankDelta(after.start, id, i + 1))).toEqual([0, 0, 0, 0])
    expect(after.hasRanking).toBe(true)
    // A copy, not the draft array itself.
    expect(after.savedSeq).not.toBe(next)
  })

  it('publishing an emptied position leaves no ranking there', () => {
    expect(afterPublish([])).toEqual({ savedSeq: [], start: new Map(), hasRanking: false })
  })

  it('a draft started from somewhere is publishable once it has players', () => {
    expect(orderChanged(['A'], [])).toBe(true)
    expect(orderChanged([], [])).toBe(false)
    expect(rankDelta(rankMap(['A']), 'Z', 1)).toBeNull()
  })

  it('Back: asks with changes, leaves without, waits mid-publish', () => {
    expect(backAction({ dirty: true, publishing: false })).toBe('ask')
    expect(backAction({ dirty: false, publishing: false })).toBe('leave')
    expect(backAction({ dirty: true, publishing: true })).toBe('wait')
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
