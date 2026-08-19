import { describe, expect, it } from 'vitest'

import {
  commandBarModel,
  exitDraftCopy,
  type CommandBarInput,
  type CommandBarModel,
} from './command-bar-ops'

/**
 * The D154 golden table (tasks-DR DR.2 DoD): every viewer × draft-state cell
 * of the command bar's variant derivation, stored as literals. The three
 * commissioner-in-a-mock rows are the D110(1) pins — "a commissioner in a
 * mock is NOT a commissioner", so a mock may NEVER surface Draft Options or
 * commissioner pause, no matter what role the caller passes.
 *
 * Break probes recorded in the DR.2 PR (shown RED, then reverted):
 *   - dropping the `!isMock` mask from the commissioner derivation reddens
 *     exactly the three commissioner-in-a-mock rows;
 *   - forcing the member shape for commissioners reddens exactly the two
 *     commissioner rows (the DoD's "Pause/Options pins fail" probe).
 */

interface GoldenRow {
  name: string
  input: CommandBarInput
  expected: CommandBarModel
}

const GOLDEN: GoldenRow[] = [
  {
    name: 'commissioner · live',
    input: { commishRole: true, isMock: false, isMockLauncher: false, paused: false },
    expected: {
      variant: 'commissioner',
      pauseResume: 'pause',
      draftOptions: true,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft live',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'commissioner · paused',
    input: { commishRole: true, isMock: false, isMockLauncher: false, paused: true },
    expected: {
      variant: 'commissioner',
      pauseResume: 'resume',
      draftOptions: true,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft paused',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'member · live',
    input: { commishRole: false, isMock: false, isMockLauncher: false, paused: false },
    expected: {
      variant: 'member',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft live',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'member · paused',
    input: { commishRole: false, isMock: false, isMockLauncher: false, paused: true },
    expected: {
      variant: 'member',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft paused',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'mock launcher · live',
    input: { commishRole: false, isMock: true, isMockLauncher: true, paused: false },
    expected: {
      variant: 'mock',
      pauseResume: 'pause',
      draftOptions: false,
      practiceOptions: true,
      mockBadge: true,
      statusText: 'Practice live',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'mock launcher · paused',
    input: { commishRole: false, isMock: true, isMockLauncher: true, paused: true },
    expected: {
      variant: 'mock',
      pauseResume: 'resume',
      draftOptions: false,
      practiceOptions: true,
      mockBadge: true,
      statusText: 'Practice paused',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'mock member (not the launcher) · live',
    input: { commishRole: false, isMock: true, isMockLauncher: false, paused: false },
    expected: {
      variant: 'mock',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice live',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'mock member (not the launcher) · paused',
    input: { commishRole: false, isMock: true, isMockLauncher: false, paused: true },
    expected: {
      variant: 'mock',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice paused',
      reconnecting: false,
      exit: true,
    },
  },
  {
    // D110(1): the room's own gate is `canUseCommishPanel(role) &&
    // !draft.is_mock`; this row is the ops layer enforcing the same mask
    // for a caller that forgot it.
    name: 'commissioner in a MOCK is not a commissioner · live (D110(1))',
    input: { commishRole: true, isMock: true, isMockLauncher: false, paused: false },
    expected: {
      variant: 'mock',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice live',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'commissioner in a MOCK is not a commissioner · paused (D110(1))',
    input: { commishRole: true, isMock: true, isMockLauncher: false, paused: true },
    expected: {
      variant: 'mock',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice paused',
      reconnecting: false,
      exit: true,
    },
  },
  {
    // A commissioner who launched their OWN practice gets exactly the
    // launcher's rights (069/071's mock-launcher arm) — never Draft Options.
    name: 'commissioner who is the mock LAUNCHER · live',
    input: { commishRole: true, isMock: true, isMockLauncher: true, paused: false },
    expected: {
      variant: 'mock',
      pauseResume: 'pause',
      draftOptions: false,
      practiceOptions: true,
      mockBadge: true,
      statusText: 'Practice live',
      reconnecting: false,
      exit: true,
    },
  },
  {
    // DR.7(4): the pre-start lobby. Nothing runs yet, so even the
    // commissioner gets NO controls — no Pause (no clock to freeze), no
    // Draft Options (§8.7's controls act on a draft in flight; Start draft
    // now / Draft setup are the lobby CARD's affordances). Status is the
    // one telling of the phase; the countdown stays the card's hero.
    name: 'commissioner · LOBBY (pre-start — DR.7(4))',
    input: {
      commishRole: true,
      isMock: false,
      isMockLauncher: false,
      paused: false,
      lobby: true,
    },
    expected: {
      variant: 'commissioner',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft scheduled',
      reconnecting: false,
      exit: true,
    },
  },
  {
    name: 'member · LOBBY (pre-start — DR.7(4))',
    input: {
      commishRole: false,
      isMock: false,
      isMockLauncher: false,
      paused: false,
      lobby: true,
    },
    expected: {
      variant: 'member',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft scheduled',
      reconnecting: false,
      exit: true,
    },
  },
  {
    // DR.7(3): reconnecting is ORTHOGONAL to the status words — a member's
    // live room that drops its channel keeps "Draft live" AND shows the
    // reconnecting strip; neither replaces the other.
    name: 'member · live · RECONNECTING (DR.7(3))',
    input: {
      commishRole: false,
      isMock: false,
      isMockLauncher: false,
      paused: false,
      reconnecting: true,
    },
    expected: {
      variant: 'member',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft live',
      reconnecting: true,
      exit: true,
    },
  },
  {
    // Paused + reconnecting: both states, each told once — the paused words
    // stay authoritative while the connection strip rides beside them, and
    // the commissioner's Resume control is unaffected.
    name: 'commissioner · paused · RECONNECTING (DR.7(3))',
    input: {
      commishRole: true,
      isMock: false,
      isMockLauncher: false,
      paused: true,
      reconnecting: true,
    },
    expected: {
      variant: 'commissioner',
      pauseResume: 'resume',
      draftOptions: true,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft paused',
      reconnecting: true,
      exit: true,
    },
  },
]

describe('commandBarModel — the D154 golden table', () => {
  for (const row of GOLDEN) {
    it(row.name, () => {
      expect(commandBarModel(row.input)).toEqual(row.expected)
    })
  }

  it('Exit Draft is unconditional across the whole table (Q13)', () => {
    for (const row of GOLDEN) {
      expect(commandBarModel(row.input).exit, row.name).toBe(true)
    }
  })

  it('no mock row ever surfaces Draft Options (D110(1), swept)', () => {
    for (const row of GOLDEN.filter((r) => r.input.isMock)) {
      expect(commandBarModel(row.input).draftOptions, row.name).toBe(false)
    }
  })
})

describe('exitDraftCopy — Q13 honest-copy goldens (§16.4 zone 1)', () => {
  it('a seated manager is told about the Targets away path and the way back', () => {
    expect(exitDraftCopy({ isMock: false, hasSeat: true })).toBe(
      "Leave the room — after a short grace, your picks are made from your Targets while you're away. Come back anytime to take over again.",
    )
  })

  it('a mock is told about the E59 auto-pause and the 72h keep', () => {
    expect(exitDraftCopy({ isMock: true, hasSeat: true })).toBe(
      'Leave the room — your practice pauses automatically and keeps for 72 hours.',
    )
  })

  it('a seatless viewer gets no false autopick promise', () => {
    expect(exitDraftCopy({ isMock: false, hasSeat: false })).toBe(
      'Leave the room and head back to the league.',
    )
  })

  it("a mock SPECTATOR is not told 'your practice' about a practice that is not theirs", () => {
    // Caught by the DR.2 browser inventory: the mock-member bar carried the
    // launcher's pause copy. Only the launcher holds the human seat (D103(2)).
    expect(exitDraftCopy({ isMock: true, hasSeat: false })).toBe(
      'Leave the room and head back to the league.',
    )
  })

  it('the LOBBY is not told the away-path sentence — nothing runs yet (DR.7(4))', () => {
    // Pre-start there is no clock and no grace hold, so the Targets
    // sentence would be false; the honest warning is the D94 auto-start.
    // Seat-independent: leaving a lobby costs the same for everyone.
    const lobbyLine =
      "Leave the lobby — the draft hasn't started. It still starts on schedule whether or not you're here."
    expect(exitDraftCopy({ isMock: false, hasSeat: true, lobby: true })).toBe(lobbyLine)
    expect(exitDraftCopy({ isMock: false, hasSeat: false, lobby: true })).toBe(lobbyLine)
  })
})
