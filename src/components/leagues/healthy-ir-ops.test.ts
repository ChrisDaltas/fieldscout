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
  HEALTHY_IR_STILL_OPEN,
  HEALTHY_IR_WAYS,
  healthyIrAddTitle,
  healthyIrBlockers,
  healthyIrHeadline,
} from './healthy-ir-ops'

const SPOTS: IrSlot[] = [
  { key: 'ir', type: 'unrestricted', eligible_designations: ['OUT', 'IR'] },
  { key: 'dl', label: 'DL', type: 'restricted', eligible_designations: ['OUT', 'IR', 'Doubtful'], min_weeks: 4 },
]

type Row = Pick<RosterPlayer, 'player_id' | 'full_name' | 'status' | 'slot_key' | 'ir_placed_week' | 'ir_lock_until_week'>
const row = (player_id: string, status: string | null, slot_key: string, ir_placed_week: number | null = null, ir_lock_until_week: number | null = null): Row => ({
  player_id,
  full_name: `P ${player_id}`,
  status,
  slot_key,
  ir_placed_week,
  ir_lock_until_week,
})

describe('who blocks — 205’s rule, mirrored', () => {
  it('a HEALTHY man in an IR spot blocks; a still-eligible one does not', () => {
    expect(healthyIrBlockers([row('a', 'Active', 'ir:0', 5)], SPOTS, 6)).toEqual([
      { player_id: 'a', full_name: 'P a', label: 'IR', designation: null },
    ])
    expect(healthyIrBlockers([row('b', 'Out', 'ir:0', 5), row('c', 'IR', 'ir:0', 5)], SPOTS, 6)).toEqual([])
    // The feed's spellings bridge as 112 does (Sus → Suspended is not in this spot's list).
    expect(healthyIrBlockers([row('d', 'Sus', 'ir:0', 5)], SPOTS, 6).map((b) => b.designation)).toEqual(['Suspended'])
  })
  it('PER-SPOT designations: Doubtful fits the DL spot, not the plain IR spot', () => {
    expect(healthyIrBlockers([row('d', 'Doubtful', 'dl:0', 5, 9)], SPOTS, 12)).toEqual([])
    expect(healthyIrBlockers([row('d', 'Doubtful', 'ir:0', 5)], SPOTS, 6)).toEqual([
      { player_id: 'd', full_name: 'P d', label: 'IR', designation: 'Doubtful' },
    ])
  })
  it('a RESTRICTED stint still running blocks nothing (he can’t leave); from its last week on he blocks', () => {
    const r = [row('h', 'Active', 'dl:0', 5, 9)]
    expect(healthyIrBlockers(r, SPOTS, 8)).toEqual([])
    expect(healthyIrBlockers(r, SPOTS, 9)).toEqual([{ player_id: 'h', full_name: 'P h', label: 'DL', designation: null }])
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
    expect(healthyIrHeadline([{ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: null }])).toBe(
      'Jalen Hurts is healthy — move him out of your IR spot to add players',
    )
    expect(healthyIrHeadline([{ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: 'Doubtful' }])).toBe(
      'Jalen Hurts is listed Doubtful — move him out of your IR spot to add players',
    )
    expect(
      healthyIrHeadline([
        { player_id: 'a', full_name: 'A One', label: 'IR', designation: null },
        { player_id: 'b', full_name: 'B Two', label: 'DL', designation: null },
      ]),
    ).toBe('A One and B Two can’t stay in your IR spots — move them out to add players')
    expect(healthyIrHeadline([])).toBeNull()
    expect(HEALTHY_IR_WAYS).toEqual(['Move him to your bench — drop someone too if your roster is full.', 'Or swap another IR-eligible player into the spot.'])
    expect(HEALTHY_IR_STILL_OPEN).toBe('Lineup moves, drops and trades still work as usual.')
  })
  it('the closed Add / Claim says why', () => {
    expect(healthyIrAddTitle([{ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: null }])).toBe(
      'Your IR spot still holds Jalen Hurts, who is healthy — move him out of it to add players.',
    )
    expect(healthyIrAddTitle([{ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: 'Doubtful' }])).toBe(
      'Your IR spot still holds Jalen Hurts, listed Doubtful — move him out of it to add players.',
    )
    expect(
      healthyIrAddTitle([
        { player_id: 'a', full_name: 'A One', label: 'IR', designation: null },
        { player_id: 'b', full_name: 'B Two', label: 'DL', designation: null },
      ]),
    ).toBe('Your IR spots still hold players who aren’t IR-eligible — move them out to add players.')
    expect(healthyIrAddTitle([])).toBeNull()
  })
  it('the + door’s name keeps his name capitalised (acquireLabel lower-cases only the reason’s first word)', () => {
    const title = healthyIrAddTitle([{ player_id: 'a', full_name: 'Jalen Hurts', label: 'IR', designation: null }])!
    expect(acquireLabel('none', 'Puka Nacua', title)).toBe(
      'Can’t pick up Puka Nacua — your IR spot still holds Jalen Hurts, who is healthy — move him out of it to add players',
    )
  })
})
