import { describe, expect, it } from 'vitest'

import {
  commandBarModel,
  exitDraftCopy,
  type CommandBarInput,
  type CommandBarModel,
} from './command-bar-ops'

/**
 * The D154 golden table (tasks-DR DR.2 DoD): every viewer × draft-state cell
 * of the command bar's variant derivation, stored as literals. The
 * commissioner-in-a-mock rows are the D110(1) pins that SURVIVE MS.5 — "a
 * commissioner in a mock is not a commissioner": role never opens the door
 * on a mock. What opens it there is being the LAUNCHER of a LEAGUE-ATTACHED
 * mock (MS.5 — §8.8 v2.15/D259: the launcher is the commissioner of their
 * own mock; the menu holds the MOCK catalog). A STANDALONE mock's launcher
 * keeps the reduced practice menu — no control has a wire door there yet
 * (F128/F129), and the model must not offer a control that would 400
 * (R515).
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
      stale: false,
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
      stale: false,
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
      stale: false,
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
      stale: false,
      exit: true,
    },
  },
  {
    // MS.5 (§8.8 v2.15/D259): the launcher of a LEAGUE-ATTACHED mock gets
    // Draft Options ITSELF — the same door with the same name (D221(2)),
    // holding the mock catalog — and the single-item practice menu
    // dissolves into its destructive group. Role plays no part: this row's
    // commishRole is false (a plain member who launched a practice — the
    // exact person MS.2's gate reorder was for).
    name: 'mock launcher (league-attached, plain member) · live — MS.5',
    input: { commishRole: false, isMock: true, isMockLauncher: true, paused: false },
    expected: {
      variant: 'mock',
      pauseResume: 'pause',
      draftOptions: true,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice live',
      reconnecting: false,
      stale: false,
      exit: true,
    },
  },
  {
    name: 'mock launcher (league-attached, plain member) · paused — MS.5',
    input: { commishRole: false, isMock: true, isMockLauncher: true, paused: true },
    expected: {
      variant: 'mock',
      pauseResume: 'resume',
      draftOptions: true,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice paused',
      reconnecting: false,
      stale: false,
      exit: true,
    },
  },
  {
    // MS.5's honest-render rule (R515): a STANDALONE practice has no wire
    // door for any control yet (F128: order; F129: clock), so its launcher
    // keeps the reduced Practice-options menu — Draft Options stays shut
    // until the /api/mocks commissioner wire family exists.
    name: 'STANDALONE mock launcher · live — practice menu, no Draft Options (F128/F129)',
    input: {
      commishRole: false,
      isMock: true,
      isMockLauncher: true,
      standalone: true,
      paused: false,
    },
    expected: {
      variant: 'mock',
      pauseResume: 'pause',
      draftOptions: false,
      practiceOptions: true,
      mockBadge: true,
      statusText: 'Practice live',
      reconnecting: false,
      stale: false,
      exit: true,
    },
  },
  {
    name: 'STANDALONE mock launcher · paused — practice menu, no Draft Options (F128/F129)',
    input: {
      commishRole: false,
      isMock: true,
      isMockLauncher: true,
      standalone: true,
      paused: true,
    },
    expected: {
      variant: 'mock',
      pauseResume: 'resume',
      draftOptions: false,
      practiceOptions: true,
      mockBadge: true,
      statusText: 'Practice paused',
      reconnecting: false,
      stale: false,
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
      stale: false,
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
      stale: false,
      exit: true,
    },
  },
  {
    // D110(1)'s SURVIVING half after MS.5: role never opens the door on a
    // mock. A commissioner viewing somebody else's practice gets NOTHING —
    // not the full catalog, not the mock catalog, not pause (D103(2):
    // nobody else drives a solo practice; 069's arms give commissioners no
    // bypass). This row is the ops layer enforcing that for a caller that
    // forgot it.
    name: 'commissioner in a MOCK who is NOT the launcher gets nothing · live (D110(1)/D103(2))',
    input: { commishRole: true, isMock: true, isMockLauncher: false, paused: false },
    expected: {
      variant: 'mock',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice live',
      reconnecting: false,
      stale: false,
      exit: true,
    },
  },
  {
    name: 'commissioner in a MOCK who is NOT the launcher gets nothing · paused (D110(1)/D103(2))',
    input: { commishRole: true, isMock: true, isMockLauncher: false, paused: true },
    expected: {
      variant: 'mock',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice paused',
      reconnecting: false,
      stale: false,
      exit: true,
    },
  },
  {
    // A commissioner who launched their OWN practice gets exactly the
    // LAUNCHER's rights (069/071's mock-launcher arm) — since MS.5 that
    // includes Draft Options with the MOCK catalog on a league-attached
    // mock, and it comes from `isMockLauncher`, never from the role (the
    // model output is identical to the plain-member launcher rows above).
    name: 'commissioner who is the mock LAUNCHER (league-attached) · live',
    input: { commishRole: true, isMock: true, isMockLauncher: true, paused: false },
    expected: {
      variant: 'mock',
      pauseResume: 'pause',
      draftOptions: true,
      practiceOptions: false,
      mockBadge: true,
      statusText: 'Practice live',
      reconnecting: false,
      stale: false,
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
      stale: false,
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
      stale: false,
      exit: true,
    },
  },
  {
    // L.C3.1 / F56's room half: `stale` is the FETCH path's twin of
    // `reconnecting` — orthogonal to the status words AND to each other. A
    // paused commissioner room whose channel is fine but whose REST reads
    // are failing shows the degraded banner alone.
    name: 'commissioner · paused · STALE fetch (F56)',
    input: {
      commishRole: true,
      isMock: false,
      isMockLauncher: false,
      paused: true,
      stale: true,
    },
    expected: {
      variant: 'commissioner',
      pauseResume: 'resume',
      draftOptions: true,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft paused',
      reconnecting: false,
      stale: true,
      exit: true,
    },
  },
  {
    // Both wires down at once: two banners, two different states. This is
    // deliberately NOT the say-a-thing-once violation — one says the socket
    // dropped, the other says the fetch is not answering.
    name: 'member · live · RECONNECTING + STALE (both paths down)',
    input: {
      commishRole: false,
      isMock: false,
      isMockLauncher: false,
      paused: false,
      reconnecting: true,
      stale: true,
    },
    expected: {
      variant: 'member',
      pauseResume: null,
      draftOptions: false,
      practiceOptions: false,
      mockBadge: false,
      statusText: 'Draft live',
      reconnecting: true,
      stale: true,
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
      stale: false,
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
      stale: false,
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

  it('Draft Options on a mock is the LAUNCHER of a league-attached mock and nobody else (MS.5, swept)', () => {
    // D110(1)'s surviving half + MS.5's honest-render rule, as one sweep:
    // role never opens the door on a mock, being the launcher does — and
    // only where the enabled controls have wire doors (league-attached;
    // standalone waits on F128/F129).
    for (const row of GOLDEN.filter((r) => r.input.isMock)) {
      const shouldOpen =
        row.input.isMockLauncher && !(row.input.standalone ?? false) && !(row.input.lobby ?? false)
      expect(commandBarModel(row.input).draftOptions, row.name).toBe(shouldOpen)
    }
  })

  it('the two menus never render together, and a launcher always has exactly one (MS.5)', () => {
    // D221(2): one door — the practice menu DISSOLVES into Draft Options on
    // a league-attached mock rather than standing beside it.
    for (const row of GOLDEN) {
      const model = commandBarModel(row.input)
      expect(model.draftOptions && model.practiceOptions, row.name).toBe(false)
      if (row.input.isMock && row.input.isMockLauncher && !(row.input.lobby ?? false)) {
        expect(model.draftOptions || model.practiceOptions, row.name).toBe(true)
      }
    }
  })

  it('standalone is meaningless on a real draft — the commissioner keeps the door (guard)', () => {
    const model = commandBarModel({
      commishRole: true,
      isMock: false,
      isMockLauncher: false,
      standalone: true,
      paused: false,
    })
    expect(model.draftOptions).toBe(true)
    expect(model.practiceOptions).toBe(false)
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
    expect(exitDraftCopy({ isMock: false, hasSeat: true, lobby: true, hasSchedule: true })).toBe(
      lobbyLine,
    )
    expect(exitDraftCopy({ isMock: false, hasSeat: false, lobby: true, hasSchedule: true })).toBe(
      lobbyLine,
    )
  })

  it('the NO-SCHEDULE lobby is not promised an auto-start that cannot happen (R396)', () => {
    // The lobby renders with `draft_scheduled_at` null (the league is
    // `scheduled`, no instant stored — draft-lobby.tsx's no-countdown
    // sub-state), and "it still starts on schedule" is false there. The
    // honest sentence is the commissioner's Start-now. Seat-independent,
    // and `hasSchedule` omitted defaults to the non-promise.
    const noScheduleLine =
      "Leave the lobby — the draft hasn't started. The commissioner can start it whether or not you're here."
    expect(exitDraftCopy({ isMock: false, hasSeat: true, lobby: true, hasSchedule: false })).toBe(
      noScheduleLine,
    )
    expect(exitDraftCopy({ isMock: false, hasSeat: false, lobby: true, hasSchedule: false })).toBe(
      noScheduleLine,
    )
    expect(exitDraftCopy({ isMock: false, hasSeat: true, lobby: true })).toBe(noScheduleLine)
  })
})
