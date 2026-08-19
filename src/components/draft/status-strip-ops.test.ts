import { describe, expect, it } from 'vitest'

import { statusStripModel, type StatusStripInput, type StatusStripModel } from './status-strip-ops'

/**
 * Golden table for the DR.4 status strip (spec §16.4 zone 2; D149;
 * requirement (3)) — stored as LITERALS (the falsifiability floor / the
 * command-bar-ops precedent), never derived by re-running the model's own
 * logic.
 *
 * The two structural pins (asserted on EVERY row, both the
 * you-are-on-the-clock and someone-else arms):
 *   - the on-clock line is the LEFT run's leading element (requirement 3);
 *   - the clock is the RIGHT edge (D149: the band's ends read *whose turn*
 *     and *how long*).
 */

const rows: Array<{ name: string; input: StatusStripInput; expected: StatusStripModel }> = [
  {
    name: 'you are on the clock, live',
    input: {
      paused: false,
      round: 3,
      pickNumber: 27,
      youAreOnClock: true,
      onClockTeamName: 'Hadouken Heroes',
      myNextPickLabel: '3.03',
    },
    expected: {
      left: {
        onClock: { text: "You're on the clock", you: true },
        badge: 'live',
        round: '3',
        pick: '27',
        // On the clock ⇒ no "Your next" hint, even with a label supplied.
        nextHint: null,
      },
      middle: { presence: true },
      right: { clock: true },
    },
  },
  {
    name: 'someone else on the clock, live, seated viewer',
    input: {
      paused: false,
      round: 3,
      pickNumber: 27,
      youAreOnClock: false,
      onClockTeamName: 'Hadouken Heroes',
      myNextPickLabel: '3.09',
    },
    expected: {
      left: {
        onClock: { text: 'On the clock · Hadouken Heroes', you: false },
        badge: 'live',
        round: '3',
        pick: '27',
        nextHint: { label: '3.09' },
      },
      middle: { presence: true },
      right: { clock: true },
    },
  },
  {
    name: 'someone else on the clock, paused',
    input: {
      paused: true,
      round: 5,
      pickNumber: 41,
      youAreOnClock: false,
      onClockTeamName: 'Shoryuken Squad',
      myNextPickLabel: '5.08',
    },
    expected: {
      left: {
        onClock: { text: 'On the clock · Shoryuken Squad', you: false },
        badge: 'paused',
        round: '5',
        pick: '41',
        nextHint: { label: '5.08' },
      },
      middle: { presence: true },
      right: { clock: true },
    },
  },
  {
    name: 'you on the clock while paused',
    input: {
      paused: true,
      round: 1,
      pickNumber: 4,
      youAreOnClock: true,
      onClockTeamName: null,
      myNextPickLabel: null,
    },
    expected: {
      left: {
        onClock: { text: "You're on the clock", you: true },
        badge: 'paused',
        round: '1',
        pick: '4',
        nextHint: null,
      },
      middle: { presence: true },
      right: { clock: true },
    },
  },
  {
    name: 'unnamed on-clock team (name not resolved), spectator',
    input: {
      paused: false,
      round: 2,
      pickNumber: 13,
      youAreOnClock: false,
      onClockTeamName: null,
      myNextPickLabel: null,
    },
    expected: {
      left: {
        onClock: { text: 'On the clock', you: false },
        badge: 'live',
        round: '2',
        pick: '13',
        nextHint: null,
      },
      middle: { presence: true },
      right: { clock: true },
    },
  },
  {
    name: 'between picks: round/pick unresolved render as em dashes',
    input: {
      paused: false,
      round: null,
      pickNumber: null,
      youAreOnClock: false,
      onClockTeamName: null,
      myNextPickLabel: null,
    },
    expected: {
      left: {
        onClock: { text: 'On the clock', you: false },
        badge: 'live',
        round: '—',
        pick: '—',
        nextHint: null,
      },
      middle: { presence: true },
      right: { clock: true },
    },
  },
]

describe('statusStripModel — the D149 golden table', () => {
  for (const row of rows) {
    it(row.name, () => {
      expect(statusStripModel(row.input)).toEqual(row.expected)
    })
  }

  it('the on-clock line is the LEFT run and the clock is the RIGHT edge in BOTH arms (requirement 3)', () => {
    const you = statusStripModel(rows[0].input)
    const other = statusStripModel(rows[1].input)
    // Structural, not textual: the model has no representation in which the
    // on-clock line can sit on the right or the clock on the left.
    expect(you.left.onClock).toEqual({ text: "You're on the clock", you: true })
    expect(other.left.onClock).toEqual({ text: 'On the clock · Hadouken Heroes', you: false })
    expect(you.right).toEqual({ clock: true })
    expect(other.right).toEqual({ clock: true })
  })
})
