/**
 * healthy-ir-ops.test.ts — the client's mirror of 205's
 * `ir_healthy_blockers_internal` (PROGRESS D593; pgTAP 155 §B is the server's
 * half, on the same shapes): who blocks, per spot's designations and the
 * Restricted stint, and the words the team screen and the closed Adds say.
 * Golden values are stored literals. Pure — no stack required.
 */
import { describe, expect, it } from 'vitest'

import { acquireLabel } from '@/components/players/player-card-league-ops'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { IrSlot } from '@/lib/leagues/settings/league-settings'

import {
  HEALTHY_IR_MOVE_NEXT_WEEK,
  HEALTHY_IR_STILL_OPEN,
  HEALTHY_IR_WAYS,
  currentWeekGamesOver,
  healthyIrAddTitle,
  healthyIrBlockers,
  healthyIrHeadline,
  healthyIrWays,
  type HealthyIrBlocker,
} from './healthy-ir-ops'

const SPOTS: IrSlot[] = [
  { key: 'ir', type: 'unrestricted', eligible_designations: ['OUT', 'IR'] },
  { key: 'dl', label: 'DL', type: 'restricted', eligible_designations: ['OUT', 'IR', 'Doubtful'], min_weeks: 4 },
]

type Row = Pick<
  RosterPlayer,
  'player_id' | 'full_name' | 'status' | 'slot_key' | 'ir_placed_week' | 'ir_lock_until_week' | 'game_lock' | 'nfl_team' | 'bye_week'
>
const row = (
  player_id: string,
  status: string | null,
  slot_key: string,
  ir_placed_week: number | null = null,
  ir_lock_until_week: number | null = null,
  extra: Partial<Row> = {},
): Row => ({
  player_id,
  full_name: `P ${player_id}`,
  status,
  slot_key,
  ir_placed_week,
  ir_lock_until_week,
  game_lock: { state: 'unlocked', until: null },
  nfl_team: 'PHI',
  bye_week: 9,
  ...extra,
})
const UNTIL = '2026-10-20T07:00:00Z'
const LOCKED: Partial<Row> = { game_lock: { state: 'locked_until', until: UNTIL } }
const free = (b: Omit<HealthyIrBlocker, 'stuck'>): HealthyIrBlocker => ({ ...b, stuck: null })

describe('who blocks — 205’s rule, mirrored', () => {
  it('a HEALTHY man in an IR spot blocks; a still-eligible one does not', () => {
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5)], SPOTS, 6)).toEqual([
      { player_id: 'a', full_name: 'P a', label: 'IR', designation: null, stuck: null },
    ])
    expect(healthyIrBlockers([row('b', 'Out', 'ir:0', 5), row('c', 'IR', 'ir:0', 5)], SPOTS, 6)).toEqual([])
    // The feed's spellings bridge as 112 does (Sus → Suspended is not in this spot's list).
    expect(healthyIrBlockers([row('d', 'Sus', 'ir:0', 5)], SPOTS, 6).map((b) => b.designation)).toEqual(['Suspended'])
  })
  it('PER-SPOT designations: Doubtful fits the DL spot, not the plain IR spot', () => {
    expect(healthyIrBlockers([row('d', 'Doubtful', 'dl:0', 5, 9)], SPOTS, 12)).toEqual([])
    expect(healthyIrBlockers([row('d', 'Doubtful', 'ir:0', 5)], SPOTS, 6)).toEqual([
      { player_id: 'd', full_name: 'P d', label: 'IR', designation: 'Doubtful', stuck: null },
    ])
  })
  it('a RESTRICTED stint still running blocks nothing (he can’t leave); from its last week on he blocks', () => {
    const r = [row('h', 'Active', 'dl:0', 5, 9)]
    expect(healthyIrBlockers(r, SPOTS, 8)).toEqual([])
    expect(healthyIrBlockers(r, SPOTS, 9)).toEqual([{ player_id: 'h', full_name: 'P h', label: 'DL', designation: null, stuck: null }])
    // Week unknown (the schedule still loading): not counted — the server decides.
    expect(healthyIrBlockers(r, SPOTS, null)).toEqual([])
  })
  it('only a man ON an IR spot counts: the bench, a starter, or a stale key are not', () => {
    expect(healthyIrBlockers([row('x', 'Active', 'bn'), row('y', 'Active', 'rb:0'), row('z', 'Active', 'ir:0')], SPOTS, 6)).toEqual([])
    expect(healthyIrBlockers([row('w', 'Active', 'gone:0', 5)], SPOTS, 6)).toEqual([])
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5)], [], 6)).toEqual([])
  })
})

describe('the words', () => {
  it('the notice: his name and the fix; the two ways out; what still works', () => {
    expect(healthyIrHeadline([free({ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: null })])).toBe(
      'Jalen Hurts is healthy — move him out of your IR spot to add players',
    )
    expect(healthyIrHeadline([free({ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: 'Doubtful' })])).toBe(
      'Jalen Hurts is listed Doubtful — move him out of your IR spot to add players',
    )
    expect(
      healthyIrHeadline([
        free({ player_id: 'a', full_name: 'A One', label: 'IR', designation: null }),
        free({ player_id: 'b', full_name: 'B Two', label: 'DL', designation: null }),
      ]),
    ).toBe('A One and B Two can’t stay in your IR spots — move them out to add players')
    expect(healthyIrHeadline([])).toBeNull()
    expect(HEALTHY_IR_WAYS).toEqual(['Move him to your bench — drop someone too if your roster is full.', 'Or swap another IR-eligible player into the spot.'])
    expect(HEALTHY_IR_STILL_OPEN).toBe('Lineup moves, drops and trades still work as usual.')
  })
  it('the closed Add / Claim says why', () => {
    expect(healthyIrAddTitle([free({ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: null })])).toBe(
      'Your IR spot still holds Jalen Hurts, who is healthy — move him out of it to add players.',
    )
    expect(healthyIrAddTitle([free({ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: 'Doubtful' })])).toBe(
      'Your IR spot still holds Jalen Hurts, listed Doubtful — move him out of it to add players.',
    )
    expect(
      healthyIrAddTitle([
        free({ player_id: 'a', full_name: 'A One', label: 'IR', designation: null }),
        free({ player_id: 'b', full_name: 'B Two', label: 'DL', designation: null }),
      ]),
    ).toBe('Your IR spots still hold players who aren’t IR-eligible — move them out to add players.')
    expect(healthyIrAddTitle([])).toBeNull()
  })
  it('the + door’s name keeps his name capitalised (acquireLabel lower-cases only the reason’s first word)', () => {
    const title = healthyIrAddTitle([free({ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: null })])!
    expect(acquireLabel('none', 'Puka Nacua', title)).toBe(
      'Can’t pick up Puka Nacua — your IR spot still holds Jalen Hurts, who is healthy — move him out of it to add players',
    )
  })
})

describe('F690 — when his game has started, the way out is locked too (the copy says what works NOW)', () => {
  it('the tick’s lock view marks him in_game, with the drop’s opening instant; unrecorded → null', () => {
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5, null, LOCKED)], SPOTS, 6).map((b) => b.stuck)).toEqual([
      { kind: 'in_game', dropsOpenAt: UNTIL },
    ])
    expect(
      healthyIrBlockers([row('a', 'Active', 'ir:0', 5, null, { game_lock: { state: 'locked_release_unrecorded', until: null } })], SPOTS, 6).map(
        (b) => b.stuck,
      ),
    ).toEqual([{ kind: 'in_game', dropsOpenAt: null }])
  })
  it('the week’s games over: week_over for a man who played — not for one on bye, nor one with no NFL team', () => {
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5)], SPOTS, 6, true).map((b) => b.stuck)).toEqual([{ kind: 'week_over' }])
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5, null, { bye_week: 6 })], SPOTS, 6, true).map((b) => b.stuck)).toEqual([null])
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5, null, { nfl_team: null })], SPOTS, 6, true).map((b) => b.stuck)).toEqual([null])
    // The games not over and no lock: nothing stops the move.
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5)], SPOTS, 6, false).map((b) => b.stuck)).toEqual([null])
    // Still blocked either way — the lock changes the words, not the rule.
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5, null, LOCKED)], SPOTS, 6, true)).toHaveLength(1)
  })
  it('currentWeekGamesOver reads the current week’s ladder row (correction_window / final), never a clock', () => {
    const weeks = [
      { week: 5, status: 'final' },
      { week: 6, status: 'live' },
      { week: 7, status: 'upcoming' },
    ]
    expect(currentWeekGamesOver(weeks, 6)).toBe(false)
    expect(currentWeekGamesOver([weeks[0]!, { week: 6, status: 'correction_window' }, weeks[2]!], 6)).toBe(true)
    expect(currentWeekGamesOver(weeks, null)).toBe(false)
    expect(currentWeekGamesOver([], 6)).toBe(false)
  })
  const hurts = (stuck: HealthyIrBlocker['stuck']): HealthyIrBlocker => ({ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: null, stuck })
  const fmt = (iso: string) => `<${iso}>`
  it('the notice while he is in his game: no move, no drop yet — when the drop opens, and that the move waits for next week', () => {
    const b = [hurts({ kind: 'in_game', dropsOpenAt: UNTIL })]
    expect(healthyIrHeadline(b)).toBe('Jalen Hurts is healthy, but his game has started — he’s locked in your IR spot, so you can’t add players yet')
    expect(healthyIrWays(b, fmt)).toEqual([`You can drop him once this week’s games end (<${UNTIL}>).`, HEALTHY_IR_MOVE_NEXT_WEEK])
    expect(healthyIrWays([hurts({ kind: 'in_game', dropsOpenAt: null })], fmt)).toEqual(['You can drop him once this week’s games end.', HEALTHY_IR_MOVE_NEXT_WEEK])
    expect(HEALTHY_IR_MOVE_NEXT_WEEK).toBe('Or move him out of the spot once next week starts.')
    expect(healthyIrAddTitle(b)).toBe(
      'Your IR spot still holds Jalen Hurts, who is healthy, and his game has started — no adds until you can drop him (after this week’s games) or move him out (next week).',
    )
  })
  it('the notice once the week’s games are over: a drop of him works now, the move waits', () => {
    const b = [hurts({ kind: 'week_over' })]
    expect(healthyIrHeadline(b)).toBe('Jalen Hurts is healthy — he can’t leave your IR spot until next week, so adds stay closed unless you drop him')
    expect(healthyIrWays(b, fmt)).toEqual(['You can drop him now.', HEALTHY_IR_MOVE_NEXT_WEEK])
    expect(healthyIrAddTitle(b)).toBe('Your IR spot still holds Jalen Hurts, who is healthy — no adds until he leaves it: drop him now, or move him out next week.')
  })
  it('nothing locked: the two ways out Chris named, unchanged', () => {
    expect(healthyIrWays([hurts(null)], fmt)).toBe(HEALTHY_IR_WAYS)
    expect(healthyIrWays([], fmt)).toEqual([])
  })
  it('two blockers, one locked: a line each, saying what works for him', () => {
    const b = [hurts({ kind: 'in_game', dropsOpenAt: null }), { player_id: 'b', full_name: 'B Two', label: 'DL', designation: null, stuck: null }]
    expect(healthyIrHeadline(b)).toBe('Jalen Hurts and B Two can’t stay in your IR spots — adds stay closed until they leave them')
    expect(healthyIrWays(b, fmt)).toEqual([
      'Jalen Hurts: you can drop him once this week’s games end, or move him out once next week starts.',
      'B Two: move him to your bench, or swap an IR-eligible player into his spot.',
    ])
    expect(healthyIrAddTitle(b)).toBe('Your IR spots still hold players who aren’t IR-eligible — no adds until they leave them.')
  })
})
