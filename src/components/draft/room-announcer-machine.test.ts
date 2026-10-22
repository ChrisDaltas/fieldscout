/**
 * room-announcer-machine.test.ts — R1635 (PR #521 review): the announcer's
 * decisions driven through time with fake timers, render by render, the way
 * `room-announcer.tsx` drives them: a pick, an undo, a re-pick, and an
 * auction's bid clock vs the viewer's own nominating clock (R1630 / R1631).
 * Plus R1632's drag guard, at the helper and at the sensors the Targets
 * panel actually registers.
 *
 * The repo has no DOM test environment (no jsdom / happy-dom in
 * node_modules), so the machine is the unit under test — the component is
 * a thin feed into it — and the guard reads a structural node slice.
 * Expected sentences are stored literals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RowMouseSensor, RowTouchSensor } from './my-queue'
import { startsOnInteractiveChild, type GuardNode } from './my-queue-ops'
import {
  ANNOUNCE_GATHER_MS,
  RoomAnnouncerMachine,
  type AnnouncedPick,
  type AnnouncerInput,
} from './room-announcer-ops'

function pick(pickNumber: number, playerName: string, teamName: string, position = 'RB'): AnnouncedPick {
  return {
    key: `${pickNumber}:${playerName}`,
    pickNumber,
    pickLabel: `1.${String(pickNumber).padStart(2, '0')}`,
    teamName,
    playerName,
    position,
    price: null,
    isAuction: false,
  }
}

function rig() {
  const turn: string[] = []
  const clock: string[] = []
  const machine = new RoomAnnouncerMachine(
    { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as never) },
    (s) => turn.push(s),
    (s) => clock.push(s),
  )
  return { machine, turn, clock }
}

const SNAKE: AnnouncerInput = {
  latestPick: pick(7, 'Bijan Robinson', 'Team 7'),
  latestPickReady: true,
  youAreOnClock: false,
  onClockKey: '8:t8',
  onClockTeamName: 'Team 8',
  isAuction: false,
  nominationLive: false,
}

describe('picks, undo and re-pick (R1631)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('mount is silent; a pick + its turn are one sentence after the gather beat', () => {
    const { machine, turn } = rig()
    machine.update(SNAKE)
    vi.advanceTimersByTime(5_000)
    expect(turn).toEqual([])

    // The turn lands first (measured live), the pick a render later.
    machine.update({ ...SNAKE, onClockKey: '9:t9', onClockTeamName: 'Team 9' })
    machine.update({
      ...SNAKE,
      latestPick: pick(8, 'Jahmyr Gibbs', 'Team 8'),
      onClockKey: '9:t9',
      onClockTeamName: 'Team 9',
    })
    vi.advanceTimersByTime(ANNOUNCE_GATHER_MS - 1)
    expect(turn).toEqual([])
    vi.advanceTimersByTime(1)
    expect(turn).toEqual(['Pick 1.08: Team 8 takes Jahmyr Gibbs, RB. On the clock: Team 9.'])
  })

  it('an undo re-bases silently: the previous pick is NOT said again, the turn is', () => {
    const { machine, turn } = rig()
    machine.update(SNAKE)
    const after8 = { ...SNAKE, latestPick: pick(8, 'Jahmyr Gibbs', 'Team 8'), onClockKey: '9:t9', onClockTeamName: 'Team 9' }
    machine.update(after8)
    vi.advanceTimersByTime(ANNOUNCE_GATHER_MS)
    turn.length = 0

    // Undo pick 8: the newest live pick is 7 again, the clock is back on Team 8.
    machine.update({ ...SNAKE, onClockKey: '8:t8', onClockTeamName: 'Team 8' })
    vi.advanceTimersByTime(ANNOUNCE_GATHER_MS)
    expect(turn).toEqual(['On the clock: Team 8.'])

    // Re-pick at 8 with a different player: news again (8 >= 8, new key).
    machine.update({ ...SNAKE, latestPick: pick(8, 'Ja’Marr Chase', 'Team 8', 'WR'), onClockKey: '9:t9', onClockTeamName: 'Team 9' })
    vi.advanceTimersByTime(ANNOUNCE_GATHER_MS)
    expect(turn).toEqual([
      'On the clock: Team 8.',
      'Pick 1.08: Team 8 takes Ja’Marr Chase, WR. On the clock: Team 9.',
    ])
  })

  it('a pick waits for its name instead of reading an id', () => {
    const { machine, turn } = rig()
    machine.update(SNAKE)
    machine.update({ ...SNAKE, latestPick: pick(8, 'p-00-123', 'Team 8'), latestPickReady: false })
    vi.advanceTimersByTime(ANNOUNCE_GATHER_MS)
    expect(turn).toEqual([])
    machine.update({ ...SNAKE, latestPick: pick(8, 'Jahmyr Gibbs', 'Team 8'), latestPickReady: true })
    vi.advanceTimersByTime(ANNOUNCE_GATHER_MS)
    expect(turn).toEqual(['Pick 1.08: Team 8 takes Jahmyr Gibbs, RB.'])
  })
})

describe('auction clocks (R1630)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const AUCTION: AnnouncerInput = {
    latestPick: null,
    latestPickReady: true,
    youAreOnClock: true,
    onClockKey: '3:me',
    onClockTeamName: 'Team 1',
    isAuction: true,
    nominationLive: true,
  }

  it('no own-clock warning while a nomination is up for bid', () => {
    const { machine, clock } = rig()
    machine.update(AUCTION)
    for (const ms of [31_000, 29_000, 11_000, 9_000, 4_000]) machine.sampleClock(ms)
    expect(clock).toEqual([])
  })

  it('the viewer’s nominating clock warns once per threshold, and a moved deadline in the same turn does not repeat it', () => {
    const { machine, clock } = rig()
    machine.update({ ...AUCTION, nominationLive: false })
    machine.sampleClock(31_000)
    machine.sampleClock(29_500)
    expect(clock).toEqual(['30 seconds left to nominate.'])
    // The deadline moves back up inside the SAME turn (an edit, a resume).
    machine.sampleClock(45_000)
    machine.sampleClock(29_000)
    expect(clock).toEqual(['30 seconds left to nominate.'])
    machine.sampleClock(9_500)
    expect(clock).toEqual(['30 seconds left to nominate.', '10 seconds left to nominate.'])
    // Then the nomination goes live: the bid window says nothing.
    machine.update({ ...AUCTION, nominationLive: true })
    machine.sampleClock(31_000)
    machine.sampleClock(9_000)
    expect(clock).toHaveLength(2)
  })

  it('a NEW turn arms the warnings again', () => {
    const { machine, clock } = rig()
    machine.update({ ...AUCTION, nominationLive: false })
    machine.sampleClock(31_000)
    machine.sampleClock(29_000)
    machine.update({ ...AUCTION, nominationLive: false, onClockKey: '15:me' })
    machine.sampleClock(31_000)
    machine.sampleClock(29_000)
    expect(clock).toEqual(['30 seconds left to nominate.', '30 seconds left to nominate.'])
  })
})

// ---- R1632: the drag guard --------------------------------------------------

function el(tagName: string, parent: GuardNode | null, role: string | null = null): GuardNode {
  return { tagName, getAttribute: (n) => (n === 'role' ? role : null), parentElement: parent }
}

describe('Targets drag guard (R1632)', () => {
  const li = el('LI', null)
  const row = el('DIV', li, 'button') // the sortable root — role="button" itself
  const nameButton = el('BUTTON', row)
  const nameText = el('SPAN', nameButton)
  const rank = el('SPAN', row)

  it('a press on the row body may lift it; a press inside the name button or Remove may not', () => {
    expect(startsOnInteractiveChild(rank, row)).toBe(false)
    expect(startsOnInteractiveChild(row, row)).toBe(false)
    expect(startsOnInteractiveChild(nameButton, row)).toBe(true)
    expect(startsOnInteractiveChild(nameText, row)).toBe(true)
  })

  it('the sensors the panel registers refuse to activate from an interactive child', () => {
    const onActivation = vi.fn()
    const mouse = RowMouseSensor.activators[0]
    const touch = RowTouchSensor.activators[0]
    const mouseEvent = (target: GuardNode) =>
      ({ target, currentTarget: row, nativeEvent: { button: 0 } }) as never
    const touchEvent = (target: GuardNode) =>
      ({ target, currentTarget: row, nativeEvent: { touches: [{}] } }) as never

    expect(mouse.handler(mouseEvent(nameText), { onActivation } as never)).toBe(false)
    expect(touch.handler(touchEvent(nameButton), { onActivation } as never)).toBe(false)
    expect(onActivation).not.toHaveBeenCalled()

    expect(mouse.handler(mouseEvent(rank), { onActivation } as never)).toBe(true)
    expect(touch.handler(touchEvent(rank), { onActivation } as never)).toBe(true)
    expect(onActivation).toHaveBeenCalledTimes(2)
  })
})
