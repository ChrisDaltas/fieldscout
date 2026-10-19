import { describe, expect, it } from 'vitest'

import {
  afterPublish,
  agreementNote,
  backAction,
  cmpToneClass,
  DEFAULT_RANK_SCORING,
  consensusMovement,
  editorMovement,
  editorMovementAvailable,
  expertConsensus,
  hubDbPositions,
  hubPosLabel,
  inHubPos,
  movementBetween,
  movementText,
  previousOrder,
  rankPosOr,
  scoringFormatOf,
  scoringFromFormat,
  storedMovement,
  expertSpread,
  formatSaved,
  moveItem,
  onBye,
  opensInWeek,
  orderChanged,
  parseRankingsParams,
  planSliceSave,
  positionInUse,
  publishButtonLabel,
  publishEntries,
  publishedToast,
  RANK_SCORINGS,
  rankDelta,
  rankMap,
  rankableWeeks,
  rankingExists,
  rankingScoring,
  scoringChanged,
  scoringLabel,
  shortName,
  tierBreaks,
  toRankingsSearch,
  weekStatus,
  weeklySub,
} from '@/components/mobile/rankings/rankings-ops'
import { DEFAULT_RANKING_SCORING } from '@/lib/lists/ranking-publish'

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

describe('publishEntries: who has no previous position (#33)', () => {
  // A new week's board, seeded on its first read from last week's RB A(2),
  // B(5), C(9); the user's new RB ranking from Experts is [C, A, D].
  const rows = [
    { playerId: 'A', slot: 2, pos: 'RB' as const },
    { playerId: 'B', slot: 5, pos: 'RB' as const },
    { playerId: 'C', slot: 9, pos: 'RB' as const },
  ]
  const plan = planSliceSave(rows, 'RB', ['C', 'A', 'D'])

  it('a ranking’s first publish flags EVERY entry — the seeded slots are not a previous version', () => {
    expect(publishEntries(plan.positions, new Set(plan.add), true)).toEqual([
      { playerId: 'C', position: 2, isNew: true },
      { playerId: 'A', position: 5, isNew: true },
      { playerId: 'D', position: 9, isNew: true },
    ])
  })
  it('an update flags only the players it added', () => {
    expect(publishEntries(plan.positions, new Set(plan.add), false)).toEqual([
      { playerId: 'C', position: 2 },
      { playerId: 'A', position: 5 },
      { playerId: 'D', position: 9, isNew: true },
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
    expect(agreementNote('S. Barkley', tight)).toBe('Experts mostly agree. Every expert has S. Barkley within two spots.')
    expect(agreementNote('S. Barkley', expertSpread([3, 6, 4])!)).toBe('Experts mostly agree. Range #3 to #6.')
    expect(agreementNote('G. Wilson', expertSpread([1, 9, 2, 10])!)).toBe(
      'Experts disagree on G. Wilson. Range #1 to #10 is wider than most at this tier.',
    )
  })
  it('the agreement note never says "him" — a kicker or a D/ST reads by name (gap list §4 item 16)', () => {
    const tight = expertSpread([1, 1, 2])!
    for (const short of ['Broncos D/ST', 'B. Aubrey', 'S. Barkley']) {
      for (const s of [tight, expertSpread([3, 6, 4])!, expertSpread([1, 9, 2, 10])!]) {
        expect(agreementNote(short, s)).not.toMatch(/\b(him|his|he)\b/i)
      }
    }
    expect(agreementNote(shortName('Broncos D/ST', 'DEF'), tight)).toBe(
      'Experts mostly agree. Every expert has Broncos D/ST within two spots.',
    )
    expect(agreementNote(shortName('Brandon Aubrey', 'K'), tight)).toBe(
      'Experts mostly agree. Every expert has B. Aubrey within two spots.',
    )
  })
  it('comparison colour: ±3 or more turns red (ranked lower) or green (higher)', () => {
    expect(cmpToneClass(9, 5)).toBe('text-m-red')
    expect(cmpToneClass(2, 5)).toBe('text-m-green')
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

  it('after a publish: nothing unpublished', () => {
    // Opened at A B C D; the draft moved D to the top.
    const next = ['D', 'A', 'B', 'C']
    expect(orderChanged(next, ['A', 'B', 'C', 'D'])).toBe(true)

    const after = afterPublish(next)
    expect(after.savedSeq).toEqual(next)
    expect(orderChanged(next, after.savedSeq)).toBe(false)
    expect(after.hasRanking).toBe(true)
    // A copy, not the draft array itself.
    expect(after.savedSeq).not.toBe(next)
  })

  it('publishing an emptied position leaves no ranking there', () => {
    expect(afterPublish([])).toEqual({ savedSeq: [], hasRanking: false })
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
    const s = parseRankingsParams(new URLSearchParams('src=nope&edit=season&from=nope'), { type: 'season' })
    expect(s.src).toBe('experts')
    expect(s.overlay).toEqual({ kind: 'edit', type: 'season', pos: 'RB', from: null })
    expect(toRankingsSearch({ ...s, overlay: null })).toBe('?pos=RB')
    expect(parseRankingsParams(new URLSearchParams('src=p:abc-123'), { type: 'season' }).src).toBe('p:abc-123')
  })
  it('view=mine opens the Mine tab; bad values fall back', () => {
    const s = parseRankingsParams(new URLSearchParams('view=mine&src=users&pos=XX&new=2&nt=w99'), { type: 'season' })
    expect(s.src).toBe('mine')
    expect(s.pos).toBe('RB')
    expect(s.overlay).toEqual({ kind: 'new', step: 2, type: 'season', pos: 'RB' })
    expect(toRankingsSearch({ ...s, overlay: null })).toBe('?view=mine&pos=RB')
  })
  it('the desktop ?tab=pre link opens the Mine tab', () => {
    expect(parseRankingsParams(new URLSearchParams('tab=pre'), { type: 'season' }).view).toBe('mine')
  })
})

describe('one Rankings screen (gap list #28)', () => {
  it('`?view=mine` — the link Profile and Home use — is the Mine tab of the one screen', () => {
    const s = parseRankingsParams(new URLSearchParams('view=mine'), { type: 'season' })
    expect(s).toMatchObject({ view: 'mine', src: 'mine', overlay: null })
  })
  it('leaving Mine for another tab drops view=mine; coming back writes it again', () => {
    const mine = parseRankingsParams(new URLSearchParams('view=mine&pos=WR'), { type: 'season' })
    const users = parseRankingsParams(new URLSearchParams(toRankingsSearch({ ...mine, src: 'users' }).slice(1)), {
      type: 'season',
    })
    expect(users).toMatchObject({ view: 'hub', src: 'users', pos: 'WR' })
    expect(toRankingsSearch({ ...users, src: 'mine' })).toBe('?view=mine&pos=WR')
    // `src=mine` (hand-made) is the same tab.
    expect(parseRankingsParams(new URLSearchParams('src=mine'), { type: 'season' }).view).toBe('mine')
  })
})

describe('scoring (gap list #30)', () => {
  it('reads and writes PPR, Half PPR, 0.25 PPR and Standard; anything else is PPR', () => {
    for (const k of ['half', 'quarter', 'std'] as const) {
      const s = parseRankingsParams(new URLSearchParams(`scoring=${k}`), { type: 'season' })
      expect(s.scoring).toBe(k)
      expect(toRankingsSearch(s)).toBe(`?scoring=${k}&pos=RB`)
    }
    expect(parseRankingsParams(new URLSearchParams('scoring=ppr'), { type: 'season' }).scoring).toBe('ppr')
    expect(parseRankingsParams(new URLSearchParams('scoring=half_ppr'), { type: 'season' }).scoring).toBe('ppr')
    expect(toRankingsSearch(parseRankingsParams(new URLSearchParams(''), { type: 'season' }))).toBe('?pos=RB')
  })
  it('labels the four in menu order', () => {
    expect(RANK_SCORINGS.map((s) => s.label)).toEqual(['PPR', 'Half PPR', '0.25 PPR', 'Standard'])
    expect(scoringLabel('quarter')).toBe('0.25 PPR')
    expect(scoringLabel('std')).toBe('Standard')
  })
})

describe('the remembered position (gap list #32)', () => {
  it('a URL naming no position opens the hub and New ranking on the remembered one', () => {
    const hub = parseRankingsParams(new URLSearchParams(''), { type: 'season', pos: 'TE' })
    expect(hub.pos).toBe('TE')
    const wizard = parseRankingsParams(new URLSearchParams('new=1'), { type: 'w6', pos: 'TE' })
    expect(wizard.overlay).toEqual({ kind: 'new', step: 1, type: 'w6', pos: 'TE' })
    // A position the URL names wins.
    expect(parseRankingsParams(new URLSearchParams('pos=QB&new=1&np=K'), { type: 'w6', pos: 'TE' })).toMatchObject({
      pos: 'QB',
      overlay: { pos: 'K' },
    })
  })
  it('RB only when nothing is remembered', () => {
    expect(parseRankingsParams(new URLSearchParams('new=1'), { type: 'season' }).overlay).toMatchObject({ pos: 'RB' })
  })
  it('every written URL names its position, so the remembered one never overrides it', () => {
    const s = parseRankingsParams(new URLSearchParams('pos=RB'), { type: 'season', pos: 'WR' })
    expect(s.pos).toBe('RB')
    expect(parseRankingsParams(new URLSearchParams(toRankingsSearch(s).slice(1)), { type: 'season', pos: 'WR' }).pos).toBe(
      'RB',
    )
  })
  it('the position in use: the overlay’s, else the chips on Experts / Scout AI / Users', () => {
    const base = { src: 'experts' as const, pos: 'WR' as const, overlay: null }
    expect(positionInUse(base)).toBe('WR')
    expect(positionInUse({ ...base, src: 'ai' })).toBe('WR')
    expect(positionInUse({ ...base, src: 'users' })).toBe('WR')
    expect(positionInUse({ ...base, src: 'mine' })).toBeNull()
    expect(positionInUse({ ...base, src: 'p:abc' })).toBeNull()
    expect(positionInUse({ ...base, src: 'mine', overlay: { kind: 'new', step: 1, type: 'w6', pos: 'K' } })).toBe('K')
    expect(positionInUse({ ...base, overlay: { kind: 'edit', type: 'season', pos: 'QB', from: null } })).toBe('QB')
  })
})

describe('ADP, Auction and FLEX (Chris, 2026-10-15, gap list #29)', () => {
  it('ADP and Auction are tabs with the position chips', () => {
    for (const src of ['adp', 'auction'] as const) {
      const s = parseRankingsParams(new URLSearchParams(`src=${src}&pos=WR`), { type: 'season' })
      expect(s).toMatchObject({ view: 'hub', src, pos: 'WR' })
      expect(toRankingsSearch(s)).toBe(`?src=${src}&pos=WR`)
      expect(positionInUse(s)).toBe('WR')
    }
  })
  it('FLEX is a hub chip — RB, WR and TE overall — that no ranking starts on', () => {
    const s = parseRankingsParams(new URLSearchParams('src=users&pos=FLEX&new=1'), { type: 'w6', pos: 'TE' })
    expect(s.pos).toBe('FLEX')
    expect(toRankingsSearch({ ...s, overlay: null })).toBe('?src=users&pos=FLEX')
    // New ranking (and the editor) take a ranked position: the remembered one.
    expect(s.overlay).toEqual({ kind: 'new', step: 1, type: 'w6', pos: 'TE' })
    const ed = parseRankingsParams(new URLSearchParams('pos=FLEX&edit=season'), { type: 'season' })
    expect(ed.overlay).toEqual({ kind: 'edit', type: 'season', pos: 'RB', from: null })
    // FLEX is never remembered as "the position last used".
    expect(positionInUse({ src: 'experts', pos: 'FLEX', overlay: null })).toBeNull()
    expect(rankPosOr('FLEX', 'QB')).toBe('QB')
    expect(rankPosOr('K', 'QB')).toBe('K')
  })
  it('FLEX covers RB / WR / TE; D/ST keeps its app code', () => {
    expect(hubDbPositions('FLEX')).toEqual(['RB', 'WR', 'TE'])
    expect(hubDbPositions('DST')).toEqual(['DEF'])
    expect(['RB', 'WR', 'TE', 'QB', 'K', 'DEF'].filter((p) => inHubPos(p, 'FLEX'))).toEqual(['RB', 'WR', 'TE'])
    expect(inHubPos('DEF', 'DST')).toBe(true)
    expect(inHubPos(null, 'FLEX')).toBe(false)
    expect(hubPosLabel('FLEX')).toBe('FLEX')
    expect(hubPosLabel('DST')).toBe('D/ST')
  })
})

describe('saved scoring (Chris, 2026-10-15, gap list #36)', () => {
  it('no scoring chosen is Half PPR (Chris, 2026-10-16) — the same default the server saves', () => {
    expect(DEFAULT_RANK_SCORING).toBe('half')
    expect(scoringFormatOf(DEFAULT_RANK_SCORING)).toBe(DEFAULT_RANKING_SCORING)
    expect(scoringLabel(DEFAULT_RANK_SCORING)).toBe('Half PPR')
  })

  it('the editor’s scoring: picked, else saved, else Half PPR', () => {
    expect(rankingScoring(null, null)).toBe('half')
    expect(rankingScoring(null, 'std')).toBe('std')
    expect(rankingScoring('ppr', 'std')).toBe('ppr')
    expect(rankingScoring('quarter', null)).toBe('quarter')
  })

  it('a picked scoring that differs from the saved one is a change to publish on its own', () => {
    const base = { picked: 'ppr' as const, saved: null, savable: true, hasRanking: true }
    // A ranking with none saved (Half PPR) can be tagged without moving a
    // player; a wrong tag can be fixed.
    expect(scoringChanged(base)).toBe(true)
    expect(scoringChanged({ ...base, picked: 'std', saved: 'ppr' })).toBe(true)
    // Nothing picked (the default shown), or the saved one picked again.
    expect(scoringChanged({ ...base, picked: null })).toBe(false)
    expect(scoringChanged({ ...base, saved: 'ppr' })).toBe(false)
    // None saved already reads Half PPR: picking Half changes nothing.
    expect(scoringChanged({ ...base, picked: 'half' })).toBe(false)
    // A new ranking carries its scoring in its first publish; before 190
    // is pushed (or the board unknown) there is nowhere to keep it.
    expect(scoringChanged({ ...base, hasRanking: false })).toBe(false)
    expect(scoringChanged({ ...base, savable: false })).toBe(false)
  })

  it('maps the phone’s scorings onto the saved vocabulary and back', () => {
    expect(RANK_SCORINGS.map((o) => scoringFormatOf(o.key))).toEqual(['ppr', 'half', 'quarter', 'standard'])
    expect(['ppr', 'half', 'quarter', 'standard'].map(scoringFromFormat)).toEqual(['ppr', 'half', 'quarter', 'std'])
    // Nothing saved, not pushed yet (undefined), or outside the vocabulary.
    expect([null, undefined, 'std', 'half_ppr', 3].map(scoringFromFormat)).toEqual([null, null, null, null, null])
  })
})

describe('movement (Chris, 2026-10-15, gap list #33)', () => {
  it('counts among the players in both versions; a new one is New', () => {
    const m = movementBetween(['A', 'B', 'C', 'D'], ['D', 'A', 'X', 'B', 'C'])
    expect([...m]).toEqual([
      ['D', 3],
      ['A', -1],
      ['X', 'new'],
      ['B', -1],
      ['C', -1],
    ])
  })
  it('adding or dropping a player puts no arrow on the players below him', () => {
    expect([...movementBetween(['A', 'B', 'C'], ['B', 'C'])]).toEqual([
      ['B', 0],
      ['C', 0],
    ])
    expect([...movementBetween(['A', 'B'], ['N', 'A', 'B'])]).toEqual([
      ['N', 'new'],
      ['A', 0],
      ['B', 0],
    ])
  })
  it('no previous version: no movement at all, not New on everyone', () => {
    expect(movementBetween([], ['A', 'B']).size).toBe(0)
  })
  it('rebuilds the previous order from stored positions (board slots, gaps and all)', () => {
    // An RB slice of a cross-position board: slots 2, 5, 9 last time.
    const rows = [
      { id: 'C', prev: 9 },
      { id: 'A', prev: 2 },
      { id: 'N', prev: null },
      { id: 'B', prev: 5 },
    ]
    expect(previousOrder(rows)).toEqual(['A', 'B', 'C'])
    expect([...storedMovement(rows)]).toEqual([
      ['C', 2],
      ['A', -1],
      ['N', 'new'],
      ['B', -1],
    ])
  })
  it('nothing stored (not updated since, or the column not pushed yet) → nothing to show', () => {
    expect(previousOrder([{ id: 'A', prev: null }])).toBeNull()
    expect(storedMovement([{ id: 'A', prev: undefined }, { id: 'B', prev: undefined }]).size).toBe(0)
  })
  it('the editor: the published ranking’s own movement until you change it, then draft vs published', () => {
    const published = [
      { id: 'B', prev: 2 },
      { id: 'A', prev: 1 },
    ]
    // Nothing unpublished → what everyone else sees (B passed A last time).
    expect([...editorMovement(['B', 'A'], published)]).toEqual([
      ['B', 1],
      ['A', -1],
    ])
    // A draft → against what's published (what Publish will record).
    expect([...editorMovement(['A', 'B', 'N'], published)]).toEqual([
      ['A', 1],
      ['B', -1],
      ['N', 'new'],
    ])
    // Not published yet → nothing to compare with.
    expect(editorMovement(['A'], []).size).toBe(0)
  })
  it('the editor’s switch only where there is a version to compare with', () => {
    const stored = [
      { id: 'B', prev: 2 },
      { id: 'A', prev: 1 },
    ]
    const none = [
      { id: 'B', prev: null },
      { id: 'A', prev: undefined },
    ]
    expect(editorMovementAvailable(stored, false)).toBe(true)
    // Never republished since movement was recorded (or 190 not pushed),
    // and nothing reordered → nothing to show, so no switch.
    expect(editorMovementAvailable(none, false)).toBe(false)
    // A reordering draft compares with what's published.
    expect(editorMovementAvailable(none, true)).toBe(true)
    // Nothing published at the position.
    expect(editorMovementAvailable([], true)).toBe(false)
  })
  it('the Experts consensus moves when an expert’s board does; untouched boards count as unchanged', () => {
    const m = consensusMovement([
      // Expert 1 moved C from 3rd to 1st in its last update.
      { expert: 'e1', players: ['C', 'A', 'B'], prev: [3, 1, 2] },
      // Expert 2 hasn't been updated since movement was recorded.
      { expert: 'e2', players: ['A', 'B', 'C'], prev: [null, null, null] },
    ])
    // Before: A (1,1) B (2,2) C (3,3). Now: A (2,1)=1.5, C (1,3)=2, B (3,2)=2.5.
    expect([...m]).toEqual([
      ['A', 0],
      ['C', 1],
      ['B', -1],
    ])
    expect(
      consensusMovement([{ expert: 'e1', players: ['A', 'B'], prev: [undefined, undefined] }]).size,
    ).toBe(0)
  })
  it('reads ▲ / ▼ / New, nothing when unmoved', () => {
    expect([3, -2, 0, 'new' as const, undefined].map(movementText)).toEqual(['▲3', '▼2', '', 'New', ''])
  })
})
