/**
 * no-pending-word.test.ts — D845's guard (Chris 2026-11-06: "i've never heard
 * of this pending thing before. been playing fantasy football on multiple
 * platforms for decades and i've never heard of pending."). The spec's E61
 * "pending" and §16.5.4's "final (pending corrections)" are internal words;
 * a manager never reads "pending" on a score, a points cell, a bracket, a
 * box total or a week badge. Every helper that turns a score or a week
 * status into words is swept over every input shape it can meet — NULL
 * scores, every week status, every matchup status, with and without a
 * projection — and none may say "pending", in its text or its hover title.
 *
 * Waiver claims, trades, invites and loading states keep their standard
 * "Pending" — this sweep covers scores and week badges only.
 */
import { describe, expect, it } from 'vitest'

import { pointsDisplay } from '@/components/mobile/league/match/match-ops'
import type { BracketGame } from '@/lib/leagues/api/playoffs-service'

import { pointsWords } from './corrections-view-ops'
import {
  boxSumCell,
  leaderboardPendingCell,
  scoreCell,
  starterCell,
  teamScoreCell,
  weekBadge,
  type ScoreCell,
} from './matchup-view-ops'
import { bracketTotalCell, bracketWeekCells } from './playoff-bracket-ops'
import { formatScore, weekStatusBadge } from './schedule-view-ops'

const WEEK_STATUSES = ['upcoming', 'live', 'correction_window', 'final', null, undefined, 'nonsense'] as const
const MATCHUP_STATUSES = ['scheduled', 'live', 'final'] as const
const SCORES = [null, 0, 71.5] as const
const PROJECTIONS = [null, undefined, 0, 98.44] as const

function words(cell: Pick<ScoreCell, 'text' | 'title'>): string {
  return `${cell.text} ${cell.title ?? ''}`
}

const PENDING = /pending/i

describe('D845 — no score or week-badge helper ever says "pending"', () => {
  it('teamScoreCell / scoreCell / formatScore / leaderboardPendingCell over every score × matchup × week × projection', () => {
    let checked = 0
    for (const score of SCORES) {
      for (const m of MATCHUP_STATUSES) {
        expect(formatScore(score, m)).not.toMatch(PENDING)
        expect(words(scoreCell(score, m))).not.toMatch(PENDING)
        for (const w of WEEK_STATUSES) {
          for (const p of PROJECTIONS) {
            expect(words(teamScoreCell(score, m, w, p)), `${score} ${m} ${w} ${p}`).not.toMatch(PENDING)
            expect(words(leaderboardPendingCell(w, p))).not.toMatch(PENDING)
            checked++
          }
        }
      }
    }
    expect(checked).toBe(SCORES.length * MATCHUP_STATUSES.length * WEEK_STATUSES.length * PROJECTIONS.length)
  })

  it('a started week with no score shows the projection, never the word — the F907 reading, on every surface’s helper', () => {
    for (const w of ['live', 'correction_window', 'final']) {
      expect(teamScoreCell(null, 'live', w, 98.44)).toMatchObject({ text: 'Proj 98.4', projected: true })
      expect(teamScoreCell(null, 'final', w, null).text).toBe('—')
    }
  })

  it('weekBadge / weekStatusBadge: label and title, every status — the correction window reads "Final"', () => {
    for (const w of WEEK_STATUSES) {
      const status = w ?? ''
      const badge = weekBadge(status)
      expect(`${badge.label} ${badge.title}`, status).not.toMatch(PENDING)
      expect(weekStatusBadge(status).label).not.toMatch(PENDING)
    }
    expect(weekBadge('correction_window').label).toBe('Final')
  })

  it('starterCell / boxSumCell / the phone’s pointsDisplay: stats still to come in is a dash with plain words', () => {
    const base = { points: 12.3, phase: 'done' as const, reason: 'scored' as const }
    for (const pending of [[], ['def_yards_allowed'], ['pass_yards', 'rush_yards']]) {
      const cell = starterCell({ ...base, pending })
      expect(words(cell)).not.toMatch(PENDING)
      expect(pointsDisplay(cell).text).not.toMatch(PENDING)
    }
    for (const points of [null, 0, 101.02]) expect(words(boxSumCell({ points }))).not.toMatch(PENDING)
  })

  it('the bracket: every week cell and total, single- and two-week rounds, with and without projections', () => {
    const game = (weeks: Array<{ week: number; home: number | null; away: number | null; status: string }>): BracketGame => ({
      home_team_id: 'h',
      home_seed: 1,
      away_team_id: 'a',
      away_seed: 4,
      weeks: weeks.map((w) => ({ week: w.week, matchup_id: `m${w.week}`, home_score: w.home, away_score: w.away, status: w.status, result: null, is_overridden: false })),
      home_total: 0,
      away_total: 0,
      winner_team_id: 'h',
      decided_by: 'points',
      final: false,
    })
    for (const ws of WEEK_STATUSES) {
      const statusOf = () => ws ?? undefined
      for (const projectedOf of [() => null, () => 88.8]) {
        for (const g of [
          game([{ week: 15, home: null, away: null, status: 'live' }]),
          game([{ week: 15, home: null, away: 40, status: 'final' }]),
          game([
            { week: 15, home: null, away: null, status: 'live' },
            { week: 16, home: null, away: null, status: 'scheduled' },
          ]),
          game([
            { week: 15, home: 50, away: null, status: 'final' },
            { week: 16, home: null, away: null, status: 'live' },
          ]),
        ]) {
          for (const side of ['home', 'away'] as const) {
            for (const cell of bracketWeekCells(g, side, statusOf, projectedOf)) expect(words(cell)).not.toMatch(PENDING)
            expect(words(bracketTotalCell(g, side, statusOf, projectedOf))).not.toMatch(PENDING)
          }
        }
      }
    }
  })

  it('the commissioner’s corrections view: a NULL score is the dash', () => {
    expect(pointsWords(null)).toBe('—')
    expect(pointsWords(9.4)).toBe('9.40')
  })
})
