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
 * WHEN THE WAY OUT IS LOCKED TOO (F690 — the block stands; Chris ruled
 * 2026-10-21, verbatim: "Nothing changes if the player is locked. that's
 * tough luck. but that's why we have ai roster automations coming."): once
 * his own game has kicked off, set_lineup refuses moving
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
 * F692 (Chris 2026-10-21, verbatim: "Yes the user can click on the player and
 * drop them directly. the player detail page, mini modal or card should have
 * "Drop" as an option if they are droppable. Not if they are locked for the
 * week though."): dropping him is a way out too — the card's own Drop
 * (`cardLeagueView`'s drop gate, closed while he is locked), and the server
 * lets an add + drop whose drop is him through (205). The ways below name it.
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
  /** His designation now (112's bridge) — null when he is healthy, and also
   *  for a status the bridge maps to none (Questionable, Inactive, NA, DNR). */
  designation: string | null
  /** His raw injury status as the sync wrote it ("Active", "Questionable", …)
   *  — what the copy names when the bridge gives no designation. */
  status: string | null
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
        status: p.status,
        stuck: stuckOf(p, currentWeek, weekGamesOver),
      })
    }
  }
  return out
}

/** "is healthy" (a blank or Active status only) — or, for a tag his spot
 *  doesn't take, "is listed Doubtful"; a status with no designation is named
 *  as listed too ("is listed Questionable"), never "healthy". 205's helper
 *  `why` says the same. */
function standing(b: HealthyIrBlocker): string {
  if (b.designation !== null) return `is listed ${b.designation}`
  const raw = (b.status ?? '').trim()
  return raw === '' || raw.toLowerCase() === 'active' ? 'is healthy' : `is listed ${raw}`
}

/** "A One, B Two and C Three". */
function nameList(blockers: readonly HealthyIrBlocker[]): string {
  const names = blockers.map((b) => b.full_name)
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** The notice's headline — Chris, 2026-10-21, verbatim: "Change that message
 *  to say "You have an ineligible player in your IR spot."" The same sentence
 *  for one blocker or several, locked or not: who he is, and what works now,
 *  are the lines under it (`healthyIrWays`). The closed Add / Claim's reason
 *  (`healthyIrAddTitle`) and the server's refusal in plain words
 *  (friendly-messages) lead with it too. */
export const HEALTHY_IR_HEADLINE = 'You have an ineligible player in your IR spot.'

/** The notice's headline (`HEALTHY_IR_HEADLINE`) — null when nothing blocks. */
export function healthyIrHeadline(blockers: readonly HealthyIrBlocker[]): string | null {
  return blockers.length > 0 ? HEALTHY_IR_HEADLINE : null
}

/** The first line under the headline: who, and why adds are closed (or,
 *  while his game has him locked there, what is true instead). */
function healthyIrWho(blockers: readonly HealthyIrBlocker[]): string | null {
  const [first, ...rest] = blockers
  if (!first) return null
  if (rest.length === 0) {
    if (first.stuck?.kind === 'in_game') return `${first.full_name} ${standing(first)}, but his game has started — he’s locked in the spot, so you can’t add players yet.`
    if (first.stuck?.kind === 'week_over') return `${first.full_name} ${standing(first)} — he can’t leave the spot until next week, so adds stay closed unless you drop him.`
    return `${first.full_name} ${standing(first)}.`
  }
  if (blockers.some((b) => b.stuck)) return `${nameList(blockers)} can’t stay in your IR spots — adds stay closed until they leave them.`
  return `${nameList(blockers)} can’t stay in your IR spots — move them out, or drop them, to add players.`
}

/** The ways out (nothing locked): the two Chris named, in the order he said
 *  them, then dropping him from his card (F692, ruled 2026-10-21). */
export const HEALTHY_IR_WAYS: readonly string[] = [
  'Move him to your bench — drop someone too if your roster is full.',
  'Or swap another IR-eligible player into the spot.',
  'Or tap him and choose Drop.',
]

/** The move out waits for the next week once his game has started (set_lineup's IR timing). */
export const HEALTHY_IR_MOVE_NEXT_WEEK = 'Or move him out of the spot once next week starts.'

/** The notice's lines under the headline: who and why (`healthyIrWho`), then
 *  the ways out that work NOW, and when the locked ones open. `formatInstant`
 *  renders the drop's opening instant (the tick's `until`) in the viewer's time. */
export function healthyIrWays(blockers: readonly HealthyIrBlocker[], formatInstant: (iso: string) => string): readonly string[] {
  const dropWhen = (s: HealthyIrStuck): string =>
    s.kind === 'week_over' ? 'now' : `once this week’s games end${s.dropsOpenAt ? ` (${formatInstant(s.dropsOpenAt)})` : ''}`
  const who = healthyIrWho(blockers)
  const [first, ...rest] = blockers
  if (!first || who === null) return []
  if (rest.length === 0) return first.stuck ? [who, `You can drop him ${dropWhen(first.stuck)}.`, HEALTHY_IR_MOVE_NEXT_WEEK] : [who, ...HEALTHY_IR_WAYS]
  if (!blockers.some((b) => b.stuck)) return [who, ...HEALTHY_IR_WAYS]
  return [
    who,
    ...blockers.map((b) =>
      b.stuck
        ? `${b.full_name}: you can drop him ${dropWhen(b.stuck)}, or move him out once next week starts.`
        : `${b.full_name}: move him to your bench, swap an IR-eligible player into his spot, or drop him.`,
    ),
  ]
}

/** The line under the ways: what still works while he is there. */
export const HEALTHY_IR_STILL_OPEN = 'Lineup moves, drops and trades still work as usual.'

/** F693 as ruled (Chris 2026-10-21, verbatim: "no the claims are not
 *  cancelled, they should fail when waivers run."): a claim placed before he
 *  turned ineligible stays pending — nothing touches it until the run, which
 *  fails it if he is still in the spot then (205). So while the viewer has a
 *  pending claim the notice says so, under the ways out, before the failure
 *  notices are the first he hears of it. "When waivers run", not "the next
 *  run": a claim on a player whose waiver period ends later is decided at a
 *  later run. Null with no blocker or no pending claim. Only the headline's
 *  words were ruled — this line's wording is Chris's call. */
export function healthyIrClaimsLine(blockers: readonly HealthyIrBlocker[], pendingClaims: number): string | null {
  if (blockers.length === 0 || pendingClaims <= 0) return null
  const claims = pendingClaims === 1 ? 'Your pending claim' : 'Your pending claims'
  const out = blockers.length === 1 ? 'he’s out of the spot' : 'they’re all out of your IR spots'
  return `${claims} will fail when waivers run unless ${out} by then.`
}

/** The disabled Add / Claim's reason (its title / the card's closed line):
 *  the headline sentence, then the short fix. It opens with "You…", never his
 *  name: the + door's accessible name lower-cases a reason's first letter
 *  (`acquireLabel`), which must not touch a proper name. */
export function healthyIrAddTitle(blockers: readonly HealthyIrBlocker[]): string | null {
  const [first, ...rest] = blockers
  if (!first) return null
  if (rest.length > 0) {
    return blockers.some((b) => b.stuck)
      ? `${HEALTHY_IR_HEADLINE} No adds until ${nameList(blockers)} leave your IR spots.`
      : `${HEALTHY_IR_HEADLINE} Move ${nameList(blockers)} out of your IR spots, or drop them, to add players.`
  }
  if (first.stuck?.kind === 'in_game') {
    return `${HEALTHY_IR_HEADLINE} ${first.full_name}’s game has started — no adds until you can drop him (after this week’s games) or move him out (next week).`
  }
  if (first.stuck?.kind === 'week_over') {
    return `${HEALTHY_IR_HEADLINE} No adds until ${first.full_name} leaves the spot: drop him now, or move him out next week.`
  }
  return `${HEALTHY_IR_HEADLINE} Move ${first.full_name} out of the spot, or drop him, to add players.`
}
