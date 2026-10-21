/**
 * A healthy player left in an IR spot blocks the team's adds — pure
 * derivation (PROGRESS D593; spec v2.16.105 §7.3.2; migration 205).
 *
 * Chris, 2026-10-20: "…if you have a player that was in the IR spot but then
 * they became healthy again while they were there, most platforms block you
 * from doing anything until you put that injured player or that formerly
 * injured player out of your IR spot." — and "when I say roster moves, I mean
 * adds and drops. You can still change who's on your bench and who's in your
 * starting lineup."
 *
 * THE RULE, mirrored from 205's `ir_healthy_blockers_internal` so the screen
 * can PREVENT what the server would refuse (prevent, don't refuse — the
 * server stays the backstop, and its refusal reads in the same words): a
 * roster row on an IR spot (`ir_placed_week` set, `slot_key` = "<spot>:0" of a
 * configured spot) whose designation — 112's bridge, `designationOf` — is not
 * one of THAT spot's `eligible_designations` blocks every add and claim, less
 * any whose Restricted stint still runs (`currentWeek < ir_lock_until_week`:
 * he can't leave, so nothing is asked of him). With the current week unknown
 * a Restricted occupant is not counted (the server decides).
 *
 * What it never blocks: drops, lineup / bench moves (they are the ways out),
 * trades, the commissioner's roster tools. Pure: no clock, no fetch.
 */
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { IrSlot } from '@/lib/leagues/settings/league-settings'

import { designationOf } from './lineup-editor-ops'

export interface HealthyIrBlocker {
  player_id: string
  full_name: string
  /** The spot's label ("IR", "DL"). */
  label: string
  /** His designation now — null when he is healthy. */
  designation: string | null
}

type IrRow = Pick<RosterPlayer, 'player_id' | 'full_name' | 'status' | 'slot_key' | 'ir_placed_week' | 'ir_lock_until_week'>

export function healthyIrBlockers(
  roster: readonly IrRow[],
  irSlots: readonly Pick<IrSlot, 'key' | 'label' | 'eligible_designations'>[],
  currentWeek: number | null,
): HealthyIrBlocker[] {
  const out: HealthyIrBlocker[] = []
  for (const spot of irSlots) {
    for (const p of roster) {
      if (p.ir_placed_week === null || p.slot_key !== `${spot.key}:0`) continue
      const designation = designationOf(p.status)
      if (designation !== null && (spot.eligible_designations as readonly string[]).includes(designation)) continue
      if (p.ir_lock_until_week !== null && (currentWeek === null || currentWeek < p.ir_lock_until_week)) continue
      out.push({ player_id: p.player_id, full_name: p.full_name, label: spot.label ?? 'IR', designation })
    }
  }
  return out
}

/** "is healthy" — or, for a tag his spot doesn't take, "is listed Doubtful". */
function standing(b: HealthyIrBlocker): string {
  return b.designation === null ? 'is healthy' : `is listed ${b.designation}`
}

/** The notice's headline: "<Player> is healthy — move him out of your IR spot to add players". */
export function healthyIrHeadline(blockers: readonly HealthyIrBlocker[]): string | null {
  const [first, ...rest] = blockers
  if (!first) return null
  if (rest.length === 0) return `${first.full_name} ${standing(first)} — move him out of your IR spot to add players`
  const names = blockers.map((b) => b.full_name)
  const list = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${list} can’t stay in your IR spots — move them out to add players`
}

/** The two ways out Chris names, in the order he said them. */
export const HEALTHY_IR_WAYS: readonly string[] = [
  'Move him to your bench — drop someone too if your roster is full.',
  'Or swap another IR-eligible player into the spot.',
]

/** The line under the ways: what still works while he is there. */
export const HEALTHY_IR_STILL_OPEN = 'Lineup moves, drops and trades still work as usual.'

/** The disabled Add / Claim's reason (its title / the card's closed line).
 *  It opens with "Your…", never his name: the + door's accessible name
 *  lower-cases a reason's first letter (`acquireLabel`), which must not
 *  touch a proper name. */
export function healthyIrAddTitle(blockers: readonly HealthyIrBlocker[]): string | null {
  const [first, ...rest] = blockers
  if (!first) return null
  if (rest.length > 0) return 'Your IR spots still hold players who aren’t IR-eligible — move them out to add players.'
  const who = first.designation === null ? 'who is healthy' : `listed ${first.designation}`
  return `Your IR spot still holds ${first.full_name}, ${who} — move him out of it to add players.`
}
