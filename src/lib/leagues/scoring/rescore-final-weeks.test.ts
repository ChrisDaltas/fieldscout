/**
 * rescore-final-weeks.test.ts — the pure pieces of M5 L.D3.13 (migration
 * 161; PROGRESS D425): the TS twin of E38 the prediction uses, the flip
 * sentences the dry run prints (the production dry run's review artefact),
 * the predicted flips, the CLI rendering, and the two readers that meet a
 * `rescore` row (the store's mapper, reconcile's exact locked-week check).
 */
import { describe, expect, it } from 'vitest'

import { type StoredPlayerPoints, toStoredRow } from './player-points-store'
import { classifyLockedCell } from './reconcile'
import { flipSentence, matchupResultOf, predictFlips, renderRescore, type RescoreReport, same, sideSentence } from './rescore-final-weeks'

describe('E38 in TS — 117’s matchup_result_internal, the rule the prediction uses', () => {
  it('two decimals; a two-decimal tie is a tie; a bye has no result', () => {
    expect(matchupResultOf(101.75, 98.9, 'b')).toBe('home')
    expect(matchupResultOf(95.75, 95.9, 'b')).toBe('away')
    expect(matchupResultOf(95.754, 95.75, 'b')).toBe('tie')
    expect(matchupResultOf(10, null, null)).toBeNull()
  })
  it('same() is two-decimal equality (the SQL numeric comparison is scale-blind)', () => {
    expect(same(95.9, 95.90)).toBe(true)
    expect(same(95.9, 95.91)).toBe(false)
    expect(same(null, null)).toBe(true)
    expect(same(null, 0)).toBe(false)
  })
})

describe('the flip sentences — the production dry run must print the two flips Chris was shown', () => {
  it('week 1: chris’s Team 101.75–98.90 over Team 8 → Team 8 95.90–95.75 over chris’s Team', () => {
    expect(
      flipSentence({
        matchup_id: 'm1',
        before: { home: 'chris\'s Team', away: 'Team 8', home_score: 101.75, away_score: 98.9, result: 'home' },
        after: { home: 'chris\'s Team', away: 'Team 8', home_score: 95.75, away_score: 95.9, result: 'away' },
      }),
    ).toBe('chris\'s Team 101.75–98.90 over Team 8 → Team 8 95.90–95.75 over chris\'s Team')
  })
  it('week 2: Team 11 85.40–83.25 over Team 10 → Team 10 80.25–79.40 over Team 11 (Team 10 away)', () => {
    expect(
      flipSentence({
        matchup_id: 'm2',
        before: { home: 'Team 10', away: 'Team 11', home_score: 83.25, away_score: 85.4, result: 'away' },
        after: { home: 'Team 10', away: 'Team 11', home_score: 80.25, away_score: 79.4, result: 'home' },
      }),
    ).toBe('Team 11 85.40–83.25 over Team 10 → Team 10 80.25–79.40 over Team 11')
  })
  it('a tie and a bye read in words', () => {
    expect(sideSentence({ home: 'A', away: 'B', home_score: 90, away_score: 90, result: 'tie' })).toBe('A 90.00–90.00 tie with B')
    expect(sideSentence({ home: 'A', away: null, home_score: 90, away_score: null, result: null })).toBe('A 90.00 (bye)')
  })
})

describe('predictFlips — every NON-overridden row whose E38 result moves under the recompute', () => {
  const names = new Map([['t1', 'One'], ['t2', 'Two'], ['t3', 'Three'], ['t4', 'Four']])
  const row = (id: string, home: string, away: string | null, hs: number, as: number | null, result: string | null, over = false) => ({
    id, week: 1, round_type: 'regular', home_team_id: home, away_team_id: away, home_score: hs, away_score: as, result, status: 'final', is_overridden: over,
  })
  it('names the flip, leaves a row whose winner stands, and never predicts an overridden row (the commissioner’s number)', () => {
    const rows = [row('m1', 't1', 't2', 101.75, 98.9, 'home'), row('m2', 't3', 't4', 90, 80, 'home', true)]
    const flips = predictFlips(rows, new Map([['t1', 85.75], ['t2', 95.9], ['t3', 50], ['t4', 30]]), names)
    expect(flips.map((f) => [f.matchup_id, f.after.result, flipSentence(f)])).toEqual([['m1', 'away', 'One 101.75–98.90 over Two → Two 95.90–85.75 over One']])
    expect(predictFlips(rows, new Map([['t1', 99], ['t2', 95.9], ['t3', 10], ['t4', 90]]), names)).toEqual([])
  })
  it('a bye row keeps its (absent) result', () => {
    expect(predictFlips([row('b', 't1', null, 50, null, null)], new Map([['t1', 40]]), names)).toEqual([])
  })
})

describe('renderRescore — one line per fact (the dry run is the review artefact)', () => {
  it('the header, each team’s stored → recomputed with its delta, every flip, the post, and PROBLEM lines', () => {
    const report: RescoreReport = {
      ran_at: '2026-09-29T00:00:00.000Z', season: 2026, weeks: [1], mode: 'dry_run', leagues: 1,
      counts: { would_rescore: 1 }, scores_changed: 2, results_flipped: 1, score_cells: 0, cells_moved: 0, ok: false,
      problems: ['a named problem'],
      league_weeks: [{
        league_id: 'L', league_name: 'Test League', week: 1, status: 'final', verdict: 'would_rescore',
        teams: [
          { team_id: 't8', team_name: 'Team 8', stored: [98.9], recomputed: 95.9, delta: -3, overridden_cells: 0 },
          { team_id: 'tc', team_name: 'chris\'s Team', stored: [101.75], recomputed: 95.75, delta: -6, overridden_cells: 0 },
        ],
        scores_changed: 2,
        flips: [{ matchup_id: 'm1', before: { home: 'chris\'s Team', away: 'Team 8', home_score: 101.75, away_score: 98.9, result: 'home' }, after: { home: 'chris\'s Team', away: 'Team 8', home_score: 95.75, away_score: 95.9, result: 'away' } }],
        overridden: [], results_changed: ['chris\'s Team: h2h win → loss'], system_post: 'Week 1 was re-scored: …', notified: 2,
        commissioner_action_id: null, prior_rescores: [],
      }],
    }
    expect(renderRescore(report)).toEqual([
      'season 2026 · dry_run · weeks 1 · leagues 1 · team scores changing 2 · results flipping 1',
      'verdicts: would_rescore=1',
      'league Test League (L) week 1 (final): would_rescore',
      '  Team 8: 98.90 → 95.90 (−3.00)',
      '  chris\'s Team: 101.75 → 95.75 (−6.00)',
      '  RESULT FLIPS: chris\'s Team 101.75–98.90 over Team 8 → Team 8 95.90–95.75 over chris\'s Team',
      '  result changed — chris\'s Team: h2h win → loss',
      '  league post: Week 1 was re-scored: …',
      '  notifications: 2',
      'PROBLEM: a named problem',
    ])
  })
})

describe('the readers that meet a `rescore` row (161)', () => {
  const raw = { team_id: 't1', week: 1, slot: 'qb:0', player_id: 'q1', points: '50.00', pending: [], reason: 'scored', source: 'rescore' }
  it('the store keeps the source (it was mapped to worker before 161)', () => {
    expect(toStoredRow(raw).source).toBe('rescore')
  })
  it('reconcile checks a re-scored locked week EXACTLY like a worker week — Σ rows = stored ⇒ clean; ≠ ⇒ drift', () => {
    const rows: StoredPlayerPoints[] = [toStoredRow(raw), toStoredRow({ ...raw, slot: 'wr:0', player_id: 'w1', points: '35.75' })]
    expect(classifyLockedCell(85.75, rows, null)).toEqual([])
    expect(classifyLockedCell(101.75, rows, null).map((f) => [f.kind, f.severity])).toEqual([['drift', 'alert']])
  })
})
