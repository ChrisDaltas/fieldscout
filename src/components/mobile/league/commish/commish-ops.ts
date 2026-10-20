/**
 * League Menu › Commissioner tools on the phone (gap list §4 item 109) — the
 * pure half. The console's own rules stay in `commish-console-ops.ts` (which
 * doors a league in a given state has, what needs him, the corrections
 * split) and the schedule tools' in `schedule-view-ops.ts` /
 * `commish-repair-ops.ts`; this file only holds what the phone adds: its
 * title and short notes, which upcoming week the edit list shows, the
 * remix preview's weeks as cards, and the words a finished change shows.
 * The client computes nothing the server decides.
 */
import { REPAIR_SCORED_TEAM_TITLE, teamSeatable, type RepairMatchupOption } from '@/components/leagues/commish-repair-ops'
import type { EditMatchupResult, RemixPreview, ScheduleMatchup } from '@/hooks/use-schedule'
import type { CommishEditScheduleResult } from '@/lib/leagues/api/commish-schedule-service'
import { sideBySide, type PairingCell, type TeamRef, type WeekCell } from '@/components/leagues/schedule-view-ops'

/** The page's title — the League Menu row's name for it. */
export const COMMISH_TOOLS_TITLE = 'Commissioner tools'

/** Override mode, on: the header's strip says so (with Turn off); this is
 *  what it means here. */
export const OVERRIDE_ON_NOTE =
  'Override mode is on — every screen you open from here lets you act for any team. Every change is recorded and shown to the league.'

/** Where the member Schedule page's door lands (`scheduleConsoleHref`). */
export const SCHEDULE_EDIT_ANCHOR = 'schedule-edit'

export function wantsScheduleEdit(hash: string | null | undefined): boolean {
  return hash === `#${SCHEDULE_EDIT_ANCHOR}`
}

export const REMIX_ROW_LABEL = 'Remix schedule'
export const REMIX_ROW_NOTE = 'A new draw for every week that hasn’t started. You see it before anything changes.'
export const REPAIR_ROW_NOTE = 'Change who plays whom in any regular-season week, even one under way.'
export const EDIT_SHEET_TITLE = 'Change matchup'
export const EDIT_SHEET_NOTE = 'The teams this moves are paired with each other, so every team still plays once this week.'
export const REASON_LABEL = 'Reason (optional)'
export const REASON_HINT = 'Posted to league chat if you give one.'

/** The week the edit list shows: the one picked while it can still be
 *  changed, else the first upcoming week. Null when there is none. */
export function editWeek(weeks: readonly Pick<WeekCell, 'week'>[], picked: number | null): number | null {
  if (picked !== null && weeks.some((w) => w.week === picked)) return picked
  return weeks[0]?.week ?? null
}

/** One regenerated week of a remix preview, as the phone shows it: the new
 *  pairings, each marked new / flipped / unchanged against today's. */
export interface RemixWeekCard {
  week: number
  pairings: PairingCell[]
  /** How many of its pairings change. */
  changed: number
}

/** The preview's regenerated weeks, in week order (kept weeks are said by
 *  `frozenWeekCopy` instead). */
export function remixWeekCards(
  plan: Pick<RemixPreview, 'proposed'>,
  current: readonly ScheduleMatchup[],
  names: ReadonlyMap<string, string>,
): RemixWeekCard[] {
  return sideBySide(current, plan.proposed, names)
    .filter((w) => w.regenerated)
    .map((w) => ({ week: w.week, pairings: w.proposed, changed: w.proposed.filter((c) => c.state !== 'same').length }))
}

/** After an upcoming week's edit: what changed, in words. */
export function editAppliedCopy(result: Pick<EditMatchupResult, 'week' | 'matchup'>, names: ReadonlyMap<string, string>): string {
  const after = result.matchup.after
  return `Week ${result.week}: ${names.get(after.home_team_id) ?? 'Unknown team'} vs ${names.get(after.away_team_id) ?? 'Unknown team'}.`
}

/** After a re-pair: the new pairing, or the server's reason nothing changed. */
export function repairAppliedCopy(result: CommishEditScheduleResult, names: ReadonlyMap<string, string>): { title: string; detail: string } {
  if (result.no_changes) return { title: 'Nothing changed.', detail: result.no_changes_why ?? '' }
  const after = result.matchup.after
  return {
    title: 'Matchup re-paired.',
    detail: `Week ${result.week}: ${names.get(after.home_team_id) ?? 'Unknown team'} vs ${names.get(after.away_team_id) ?? 'Unknown team'}.`,
  }
}

/**
 * The re-pair sheet's Home / Away choices: every team, with the ones that
 * can't move into `target` greyed out and saying why — their game that week
 * already has a score, or they have no game that week to leave (prevent,
 * don't refuse: `teamSeatable`, the verb's own rules).
 */
export function repairTeamOptions(
  teams: readonly TeamRef[],
  target: RepairMatchupOption,
  matchups: readonly ScheduleMatchup[],
): Array<{ value: string; label: string; disabled: boolean }> {
  return teams.map((t) => {
    const seat = teamSeatable(t.id, target, matchups)
    if (seat.ok) return { value: t.id, label: t.name, disabled: false }
    return { value: t.id, label: `${t.name} — ${seat.why === REPAIR_SCORED_TEAM_TITLE ? 'game already scored' : 'no game to move from'}`, disabled: true }
  })
}
