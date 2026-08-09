/**
 * Scout position guides — `/scout/positions/<position>`.
 * Spec: docs/specs/spec-scout.md §6.1.
 *
 * Each guide ranks metrics by how well they repeat, draws an explicit line
 * below which the numbers are mostly luck, and names what to ignore. Every
 * `slug` resolves to a registry entry — the copy lives there, not here.
 *
 * All `value` figures are year-over-year R² from Sharp Football Analysis
 * unless `stat` says otherwise. Never render an r and an R² on one axis.
 */

import type { Position } from './types'

export interface RankedMetric {
  /** Registry slug. Must resolve. */
  slug: string
  /** ≤60 chars. One-line reason it sits here, in this position's terms. */
  note: string
  stat: 'r' | 'r2'
  value: number
  /** Everything below the first `belowTheLine` entry is mostly luck. */
  belowTheLine: boolean
}

export interface PositionGuide {
  position: Position
  slug: string
  /** Sentence case. The page's H1. */
  title: string
  /** ≤180 chars. The whole argument for this position, up front. */
  thesis: string
  ranked: RankedMetric[]
  /** Exactly three. The "if you only check three" card. */
  shortlist: { slug: string; question: string }[]
  /** ≤200 chars. The don't-bother box. */
  ignore: string
  sourceUrl: string
}

export const POSITION_GUIDES: Record<string, PositionGuide> = {
  'wide-receiver': {
    position: 'WR',
    slug: 'wide-receiver',
    title: 'What actually matters for a receiver',
    thesis:
      'Receivers are made by volume, not by hands. Find the guy who gets the targets and stop grading what he does with them.',
    ranked: [
      { slug: 'points-per-game', note: 'The headline number, health removed', stat: 'r2', value: 0.567, belowTheLine: false },
      { slug: 'targets-per-game', note: 'How often the coach looks his way', stat: 'r2', value: 0.539, belowTheLine: false },
      { slug: 'receptions', note: 'Targets, minus what the quarterback missed', stat: 'r2', value: 0.521, belowTheLine: false },
      { slug: 'target-share', note: 'His slice of the offense', stat: 'r2', value: 0.401, belowTheLine: false },
      { slug: 'targets-per-route-run', note: 'Target-earning skill, snaps removed', stat: 'r2', value: 0.392, belowTheLine: false },
      { slug: 'yards-per-target', note: 'Looks like talent, behaves like a coin flip', stat: 'r2', value: 0.028, belowTheLine: true },
      { slug: 'games-played', note: 'Nobody can predict injuries. Nobody.', stat: 'r2', value: 0.022, belowTheLine: true },
      { slug: 'receiving-touchdowns', note: 'The most random stat in football', stat: 'r2', value: 0.008, belowTheLine: true },
    ],
    shortlist: [
      { slug: 'target-share', question: 'Is he the guy?' },
      { slug: 'air-yards-share', question: 'Is he the guy downfield?' },
      { slug: 'expected-touchdowns', question: 'Is he cheap right now?' },
    ],
    ignore:
      'Catch rate, drop rate, separation, contested catch rate. All real skills. None of them predict fantasy points.',
    sourceUrl:
      'https://www.sharpfootballanalysis.com/fantasy/wide-receiver-stats-that-matter-fantasy-football-2024/',
  },

  'running-back': {
    position: 'RB',
    slug: 'running-back',
    title: 'What actually matters for a running back',
    thesis:
      'Touches are everything and efficiency is nothing. No position in fantasy has a wider gap between what people argue about and what actually scores.',
    ranked: [
      { slug: 'touches-per-game', note: 'The whole position in one number', stat: 'r2', value: 0.567, belowTheLine: false },
      { slug: 'carries-per-game', note: 'The floor. Repeats as well as anything here.', stat: 'r2', value: 0.562, belowTheLine: false },
      { slug: 'targets-per-game', note: 'Pass-game work is what separates RB1s', stat: 'r2', value: 0.477, belowTheLine: false },
      { slug: 'goal-line-carry-share', note: 'Where the touchdowns actually come from', stat: 'r2', value: 0.3, belowTheLine: false },
      { slug: 'yards-per-carry', note: 'Close to random from year to year', stat: 'r2', value: 0.031, belowTheLine: true },
      { slug: 'rush-yards-over-expected', note: 'Fun to read, almost useless to project', stat: 'r2', value: 0.02, belowTheLine: true },
    ],
    shortlist: [
      { slug: 'touches-per-game', question: 'How much does he get?' },
      { slug: 'targets-per-game', question: 'Does he play on third down?' },
      { slug: 'goal-line-carry-share', question: 'Does he get the ball at the one?' },
    ],
    ignore:
      'Yards per carry, yards after contact, rush yards over expected. Running back efficiency barely repeats in any form we can measure.',
    sourceUrl:
      'https://www.sharpfootballanalysis.com/fantasy/running-back-stats-that-matter-fantasy-football-2024/',
  },

  'tight-end': {
    position: 'TE',
    slug: 'tight-end',
    title: 'What actually matters for a tight end',
    thesis:
      'Tight end is the position where snap counts lie hardest. A blocker and a receiver post the same snap share, and only one of them scores.',
    ranked: [
      { slug: 'receiving-yards', note: 'Per game. The most repeatable TE number.', stat: 'r2', value: 0.609, belowTheLine: false },
      { slug: 'receptions', note: 'Per game. PPR points in the bank.', stat: 'r2', value: 0.6, belowTheLine: false },
      { slug: 'targets-per-game', note: 'The input behind both lines above', stat: 'r2', value: 0.597, belowTheLine: false },
      { slug: 'route-participation', note: 'The honest version of snap share here', stat: 'r2', value: 0.3, belowTheLine: false },
      { slug: 'catch-rate', note: 'Mostly tells you how short they throw to him', stat: 'r2', value: 0.098, belowTheLine: true },
      { slug: 'yards-per-target', note: 'Swings hard on a couple of long plays', stat: 'r2', value: 0.047, belowTheLine: true },
      { slug: 'receiving-touchdowns', note: 'The single least repeatable line in this app', stat: 'r2', value: 0.0002, belowTheLine: true },
    ],
    shortlist: [
      { slug: 'targets-per-game', question: 'Do they throw to him?' },
      { slug: 'target-share', question: 'Is he a real part of the offense?' },
      { slug: 'red-zone-target-share', question: 'Does he play near the end zone?' },
    ],
    ignore:
      'Snap share on its own. A blocking tight end and a receiving tight end look identical on a snap count, and the difference is your whole week.',
    sourceUrl:
      'https://www.sharpfootballanalysis.com/fantasy/te-stats-that-matter-fantasy-football/',
  },

  quarterback: {
    position: 'QB',
    slug: 'quarterback',
    title: 'What actually matters for a quarterback',
    thesis:
      'Fantasy quarterbacks are made with their legs. Rushing volume repeats better than anything a passer does with his arm, and it scores four times faster per yard.',
    ranked: [
      { slug: 'qb-rushing-yards', note: 'The cheapest floor in fantasy football', stat: 'r2', value: 0.553, belowTheLine: false },
      { slug: 'carries-per-game', note: 'Rushing attempts. The input behind the yards.', stat: 'r2', value: 0.544, belowTheLine: false },
      { slug: 'passing-yards', note: 'Repeats well, scores slowly', stat: 'r2', value: 0.511, belowTheLine: false },
      { slug: 'cpoe', note: 'The one "over expected" stat that genuinely holds', stat: 'r2', value: 0.226, belowTheLine: false },
      { slug: 'yards-per-attempt', note: 'A classic that barely repeats', stat: 'r2', value: 0.092, belowTheLine: true },
    ],
    shortlist: [
      { slug: 'qb-rushing-yards', question: 'Does he run?' },
      { slug: 'passing-yards', question: 'Does his team throw a lot?' },
      { slug: 'cpoe', question: 'Is he actually accurate?' },
    ],
    ignore:
      'Yards per attempt, passer rating, and completion percentage on its own. None of them separate fantasy quarterbacks the way rushing does.',
    sourceUrl:
      'https://www.sharpfootballanalysis.com/fantasy/quarterback-stats-that-matter-fantasy-football-2025/',
  },
}

/**
 * Two figures above are editorial placeholders, deliberately flagged rather
 * than invented precisely: goal-line carry share (RB, 0.30) and route
 * participation (TE, 0.30). Neither has a published year-over-year figure we
 * could verify. Per spec §3.1 they must render WITHOUT a number until one is
 * sourced — the value here only sets sort order, and the UI must suppress the
 * printed figure when `stabilityEvidence` on the registry entry is null.
 */
export const UNSOURCED_ORDERING_ONLY = ['goal-line-carry-share', 'route-participation']
