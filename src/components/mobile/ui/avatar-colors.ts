/**
 * Avatar fills for FieldScout Mobile — ONE place for the handoff's avatar
 * palettes, so a team, a manager or an author wears the same colour on every
 * screen. The app stores no colour per team, person or league, so each one's
 * colour is derived (league order, or a hash of an id).
 *
 * These borrow the position hues, but they are avatar circles, not position
 * tags — position tags stay `PositionBadge` / `MPosChip` (D497).
 */

/** A stable 32-bit hash (FNV-1a) for picking a colour from an id. */
export function colorSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Teams / managers (handoff §5 TEAMS)
// ---------------------------------------------------------------------------

/** You: always the accent blue (#0088FF). */
export const MY_TEAM_FILL = 'bg-accent'

/** Every other team, in league order: ink, #9D70E9, #F75252, #ECAD48,
 *  #5C7CE5, #07A852, #FF8A00, #3A3A3C, #00A6A3, #E5508A, #6E6E73. Fixed
 *  fills — the prototype's themed `--x-t2` / `--x-t3` avatars turn light
 *  grey under white initials in dark mode (m-match §6 defect). */
export const TEAM_FILLS = [
  'bg-m-ink',
  'bg-pos-wr',
  'bg-pos-qb',
  'bg-pos-te',
  'bg-pos-rb',
  'bg-positive-strong',
  'bg-warn',
  'bg-n-2',
  'bg-m-av-teal',
  'bg-m-av-pink',
  'bg-n-3',
] as const

/** A team's avatar fill: the viewer's team is blue, every other team takes
 *  the next colour in league order (`teamIds`, oldest first) with yours left
 *  out. `myTeamId` null = the viewer manages no team here: nobody is blue. */
export function teamAvatarClass(teamIds: readonly string[], teamId: string, myTeamId: string | null): string {
  if (myTeamId && teamId === myTeamId) return MY_TEAM_FILL
  const others = teamIds.filter((id) => id !== myTeamId)
  const i = others.indexOf(teamId)
  return TEAM_FILLS[(i < 0 ? 0 : i) % TEAM_FILLS.length]!
}

// ---------------------------------------------------------------------------
// Authors (handoff COMM `av`)
// ---------------------------------------------------------------------------

/** Community authors and AI experts: blue, red, gold, indigo, green,
 *  purple, teal, pink, ink. */
export const AUTHOR_FILLS = [
  'bg-accent',
  'bg-pos-qb',
  'bg-pos-te',
  'bg-pos-rb',
  'bg-positive-strong',
  'bg-pos-wr',
  'bg-m-av-teal',
  'bg-m-av-pink',
  'bg-m-ink',
] as const

/** One stable colour per author, hashed from their id (or handle). */
export function authorAvatarClass(seed: string): string {
  return AUTHOR_FILLS[colorSeed(seed) % AUTHOR_FILLS.length]!
}

// ---------------------------------------------------------------------------
// Leagues (handoff §2.2 LEAGUES)
// ---------------------------------------------------------------------------

/** Ink, purple, blue, gold — cycled by the league's place in your list.
 *  Gold takes ink text (handoff §2.2: avFg is #1D1D1F on #ECAD48). */
const LEAGUE_FILLS = ['bg-m-ink text-white', 'bg-pos-wr text-white', 'bg-pos-rb text-white', 'bg-pos-te text-ink'] as const

export function leagueAvClass(index: number): string {
  return LEAGUE_FILLS[index % LEAGUE_FILLS.length]!
}
