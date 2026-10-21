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
 * WHEN THE WAY OUT IS LOCKED TOO (F690 — the block stands; Chris's
 * call is open): once his own game has kicked off, set_lineup refuses moving
 * him out of the spot (or swapping someone in) until the NEXT week starts,
 * and a drop of him is refused until the week's last game ends. So the copy
 * must not tell him to do what the app refuses (never demand the
 * impossible). Each blocker carries `stuck`, read from data the screen
 * already has — never a clock:
 *   - `in_game` — the tick's `game_lock` view says he is locked (kickoff
 *     passed, the week's games not over): no move and no drop yet; a drop
 *     opens at `dropsOpenAt` (the view's `until`, null while unrecorded).
 *   - `week_over` — the current week's games are over (its ladder row is
 *     `correction_window` / `final`) and he had a game in it (an NFL team,
 *     not on bye): a drop of him works now; the move waits for next week.
 *     (The ladder flips at the hourly :00 job, the drop lock at the games-
 *     over instant — the server decides inside that hour.)
 *   - null — nothing stops the move: the two ways out Chris named.
 *
 * What it never blocks: drops, lineup / bench moves (they are the ways out),
 * trades, the commissioner's roster tools. Pure: no clock, no fetch.
 */
import type { ScheduleWeek } from '@/hooks/use-schedule'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { IrSlot } from '@/lib/leagues/settings/league-settings'

import { designationOf } from './lineup-editor-ops'

/** Why the ways out are closed right now (see the header) — null when they are open. */
export type HealthyIrStuck = { kind: 'in_game'; dropsOpenAt: string | null } | { kind: 'week_over' }

export interface HealthyIrBlocker {
  player_id: string
  full_name: string
  /** The spot's label ("IR", "DL"). */
  label: string
  /** His designation now — null when he is healthy. */
  designation: string | null
  /** His game has started this week, so the move out (and for a while the
   *  drop) is refused too — null when nothing stops the fix. */
  stuck: HealthyIrStuck | null
}

type IrRow = Pick<
  RosterPlayer,
  'player_id' | 'full_name' | 'status' | 'slot_key' | 'ir_placed_week' | 'ir_lock_until_week' | 'game_lock' | 'nfl_team' | 'bye_week'
>

/** The current week's games are over (its ladder row has left `live`) — the
 *  stretch where a kicked-off IR man can be dropped but not yet moved. */
export function currentWeekGamesOver(weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[], currentWeek: number | null): boolean {
  if (currentWeek === null) return false
  const row = weeks.find((w) => w.week === currentWeek)
  return row !== undefined && (row.status === 'correction_window' || row.status === 'final')
}

function stuckOf(p: IrRow, currentWeek: number | null, weekGamesOver: boolean): HealthyIrStuck | null {
  if (p.game_lock.state !== 'unlocked') return { kind: 'in_game', dropsOpenAt: p.game_lock.until }
  if (weekGamesOver && p.nfl_team !== null && p.bye_week !== currentWeek) return { kind: 'week_over' }
  return null
}

export function healthyIrBlockers(
  roster: readonly IrRow[],
  irSlots: readonly Pick<IrSlot, 'key' | 'label' | 'eligible_designations'>[],
  currentWeek: number | null,
  weekGamesOver = false,
): HealthyIrBlocker[] {
  const out: HealthyIrBlocker[] = []
  for (const spot of irSlots) {
    for (const p of roster) {
      if (p.ir_placed_week === null || p.slot_key !== `${spot.key}:0`) continue
      const designation = designationOf(p.status)
      if (designation !== null && (spot.eligible_designations as readonly string[]).includes(designation)) continue
      if (p.ir_lock_until_week !== null && (currentWeek === null || currentWeek < p.ir_lock_until_week)) continue
      out.push({
        player_id: p.player_id,
        full_name: p.full_name,
        label: spot.label ?? 'IR',
        designation,
        stuck: stuckOf(p, currentWeek, weekGamesOver),
      })
    }
  }
  return out
}

/** "is healthy" — or, for a tag his spot doesn't take, "is listed Doubtful". */
function standing(b: HealthyIrBlocker): string {
  return b.designation === null ? 'is healthy' : `is listed ${b.designation}`
}

/** The notice's headline: "<Player> is healthy — move him out of your IR spot to add players"
 *  (or, while his game has him locked there, what is true instead). */
export function healthyIrHeadline(blockers: readonly HealthyIrBlocker[]): string | null {
  const [first, ...rest] = blockers
  if (!first) return null
  if (rest.length === 0) {
    if (first.stuck?.kind === 'in_game') return `${first.full_name} ${standing(first)}, but his game has started — he’s locked in your IR spot, so you can’t add players yet`
    if (first.stuck?.kind === 'week_over') return `${first.full_name} ${standing(first)} — he can’t leave your IR spot until next week, so adds stay closed unless you drop him`
    return `${first.full_name} ${standing(first)} — move him out of your IR spot to add players`
  }
  const names = blockers.map((b) => b.full_name)
  const list = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  if (blockers.some((b) => b.stuck)) return `${list} can’t stay in your IR spots — adds stay closed until they leave them`
  return `${list} can’t stay in your IR spots — move them out to add players`
}

/** The two ways out Chris names, in the order he said them (nothing locked). */
export const HEALTHY_IR_WAYS: readonly string[] = [
  'Move him to your bench — drop someone too if your roster is full.',
  'Or swap another IR-eligible player into the spot.',
]

/** The move out waits for the next week once his game has started (set_lineup's IR timing). */
export const HEALTHY_IR_MOVE_NEXT_WEEK = 'Or move him out of the spot once next week starts.'

/** The notice's lines under the headline: the ways out that work NOW, and
 *  when the locked ones open. `formatInstant` renders the drop's opening
 *  instant (the tick's `until`) in the viewer's time. */
export function healthyIrWays(blockers: readonly HealthyIrBlocker[], formatInstant: (iso: string) => string): readonly string[] {
  const dropWhen = (s: HealthyIrStuck): string =>
    s.kind === 'week_over' ? 'now' : `once this week’s games end${s.dropsOpenAt ? ` (${formatInstant(s.dropsOpenAt)})` : ''}`
  const [first, ...rest] = blockers
  if (!first) return []
  if (rest.length === 0) return first.stuck ? [`You can drop him ${dropWhen(first.stuck)}.`, HEALTHY_IR_MOVE_NEXT_WEEK] : HEALTHY_IR_WAYS
  if (!blockers.some((b) => b.stuck)) return HEALTHY_IR_WAYS
  return blockers.map((b) =>
    b.stuck
      ? `${b.full_name}: you can drop him ${dropWhen(b.stuck)}, or move him out once next week starts.`
      : `${b.full_name}: move him to your bench, or swap an IR-eligible player into his spot.`,
  )
}

/** The line under the ways: what still works while he is there. */
export const HEALTHY_IR_STILL_OPEN = 'Lineup moves, drops and trades still work as usual.'

/** The disabled Add / Claim's reason (its title / the card's closed line).
 *  It opens with "Your…", never his name: the + door's accessible name
 *  lower-cases a reason's first letter (`acquireLabel`), which must not
 *  touch a proper name. */
export function healthyIrAddTitle(blockers: readonly HealthyIrBlocker[]): string | null {
  const [first, ...rest] = blockers
  if (!first) return null
  if (rest.length > 0) {
    return blockers.some((b) => b.stuck)
      ? 'Your IR spots still hold players who aren’t IR-eligible — no adds until they leave them.'
      : 'Your IR spots still hold players who aren’t IR-eligible — move them out to add players.'
  }
  const who = first.designation === null ? 'who is healthy' : `listed ${first.designation}`
  if (first.stuck?.kind === 'in_game') {
    return `Your IR spot still holds ${first.full_name}, ${who}, and his game has started — no adds until you can drop him (after this week’s games) or move him out (next week).`
  }
  if (first.stuck?.kind === 'week_over') {
    return `Your IR spot still holds ${first.full_name}, ${who} — no adds until he leaves it: drop him now, or move him out next week.`
  }
  return `Your IR spot still holds ${first.full_name}, ${who} — move him out of it to add players.`
}
