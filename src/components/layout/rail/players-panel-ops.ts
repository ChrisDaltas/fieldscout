/**
 * The rail Players tool — pure helpers (D483). No reads, no clock.
 */

/** Route segments under `/app/leagues/` that are not a league id. */
const NOT_A_LEAGUE = new Set(['new', 'join'])

/** The league a page belongs to, from its path (`/app/leagues/<id>/…`),
 *  else null — the rail's Players tool is scoped to it. */
export function leagueIdFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/app\/leagues\/([^/?#]+)/.exec(pathname ?? '')
  if (!m) return null
  const id = decodeURIComponent(m[1])
  return NOT_A_LEAGUE.has(id) ? null : id
}

/** The position chips, prototype order; `null` = All. */
export const RAIL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
export type RailPosition = (typeof RAIL_POSITIONS)[number]

/** The switch's right-hand label — what the list is showing. */
export function poolSwitchLabel(onRosters: boolean): string {
  return onRosters ? 'League-owned players' : 'Free agents'
}

/** "Adds go to <team>" — null when the viewer has no team here. */
export function addsGoToLine(teamName: string | null | undefined): string | null {
  return teamName ? `Adds go to ${teamName}` : null
}

/** A row's meta line: "TEAM · Proj 12.3 · 45.6 pts" — the projection and
 *  season points only when the league's values route answered (F565: no
 *  rostered-% / FAAB-average source exists, so those are never shown). */
export function railMetaLine(
  nflTeam: string | null,
  values: { proj: number | null; season: number | null } | null,
  opts: { season: boolean } = { season: true },
): string {
  // A missing value is left out of the line — never shown as 0.
  const parts = [nflTeam ?? 'FA']
  if (values?.proj != null) parts.push(`Proj ${values.proj.toFixed(1)}`)
  if (opts.season && values?.season != null) parts.push(`${values.season.toFixed(1)} pts`)
  return parts.join(' · ')
}

/** The owning team's crest tooltip: "team · manager" (no manager = "no
 *  manager"). */
export function ownerTooltip(teamName: string, manager: string | null): string {
  return `${teamName} · ${manager ?? 'no manager'}`
}

/** Roster groups for the Teams tool's roster view. */
export type RosterGroup = 'Starters' | 'Bench' | 'Injured'
export function rosterGroupOf(slotKey: string | null): RosterGroup {
  if (slotKey === 'ir') return 'Injured'
  if (slotKey === null || slotKey === 'bn') return 'Bench'
  return 'Starters'
}

/** "W–L" or "W–L–T" when there are ties. */
export function recordText(w: number, l: number, t: number): string {
  return t > 0 ? `${w}–${l}–${t}` : `${w}–${l}`
}
