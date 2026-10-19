/**
 * Pure helpers for the mobile League › Match tab (FieldScout Mobile handoff,
 * `docs/design/mobile/m-match.md` §2.2 / §5). Every number they format is the
 * server's — a stored matchup score, a box line's points, a stored projection,
 * an `nfl_games` row — and every state is a stored status; nothing here
 * computes a fantasy score (the desktop `matchup-view-ops.ts` posture).
 */
import type { BoxGame, BoxStarter } from '@/lib/leagues/api/box-score-service'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import type { StarterCell } from '@/components/leagues/matchup-view-ops'
import { posLabel } from '@/components/mobile/ui/m-pos-chip'
import { liveClock } from '@/utils/game-clock'

// ---------------------------------------------------------------------------
// Routes — the swiped matchup lives in the URL (`/matchup/[mid]`)
// ---------------------------------------------------------------------------

export function matchupHref(leagueId: string, matchupId: string): string {
  return `/app/leagues/${leagueId}/matchup/${matchupId}`
}

export function weekHref(leagueId: string, week: number): string {
  return `/app/leagues/${leagueId}/matchup?week=${week}`
}

/** The matchup id a pathname names (`…/matchup/<id>`), or null for the bare
 *  Match tab (`…/matchup`) — which is "your matchup". */
export function routeMatchupId(pathname: string | null, leagueId: string): string | null {
  if (!pathname) return null
  const prefix = `/app/leagues/${leagueId}/matchup/`
  if (!pathname.startsWith(prefix)) return null
  const id = pathname.slice(prefix.length).split(/[/?#]/)[0]
  return id ? decodeURIComponent(id) : null
}

/** The bare Match tab (`…/matchup`, no week) — what the dock's Match links
 *  to, so a click on it while Match is showing is the re-tap. */
export function isBareMatchHref(href: string | null, leagueId: string): boolean {
  return href === `/app/leagues/${leagueId}/matchup`
}

// ---------------------------------------------------------------------------
// Where the tab was left (handoff §3.2 item 7: `mi` and `week` outlive it)
// ---------------------------------------------------------------------------

/** A swiped matchup (null = yours) and a week other than the ladder's
 *  current one (null = the current week). */
export interface MatchSpot {
  matchupId: string | null
  week: number | null
}

/** What to remember for the screen as shown: the matchup only when it is
 *  not yours (index 0), the week only when it is not the current one. */
export function spotOf(args: { index: number; matchupId: string | null; week: number; currentWeek: number | null }): MatchSpot {
  return {
    matchupId: args.index > 0 ? args.matchupId : null,
    week: args.week === args.currentWeek ? null : args.week,
  }
}

/** A remembered spot worth restoring, or null when it is the default. */
export function spotToRestore(spot: MatchSpot | undefined): MatchSpot | null {
  if (!spot || (spot.matchupId === null && spot.week === null)) return null
  return spot
}

// ---------------------------------------------------------------------------
// The week's matchups — yours first (handoff: `mi === 0` is "your matchup")
// ---------------------------------------------------------------------------

/** The swipe order: the viewer's matchup first, then the rest in the
 *  service's order. Swiping wraps around both ends. */
export function orderMatchups<T extends Pick<MatchupRow, 'home_team_id' | 'away_team_id'>>(rows: readonly T[], myTeamId: string | null): T[] {
  if (!myTeamId) return [...rows]
  const mine = rows.findIndex((r) => r.home_team_id === myTeamId || r.away_team_id === myTeamId)
  if (mine <= 0) return [...rows]
  return [rows[mine]!, ...rows.slice(0, mine), ...rows.slice(mine + 1)]
}

/** Which team sits on the left (side A) of a matchup: yours when you play in
 *  it (the handoff always shows you on the left), otherwise the home team. */
export function sidesOf(row: Pick<MatchupRow, 'home_team_id' | 'away_team_id'>, myTeamId: string | null): { a: string; b: string | null } {
  if (myTeamId && row.away_team_id === myTeamId) return { a: row.away_team_id, b: row.home_team_id }
  return { a: row.home_team_id, b: row.away_team_id }
}

/** One team's side of the stored row: its score as the write door left it. */
export function sideScore(row: Pick<MatchupRow, 'home_team_id' | 'home_score' | 'away_score'>, teamId: string): number | null {
  return row.home_team_id === teamId ? row.home_score : row.away_score
}

/** Step `index` by `d` over `count` items, wrapping (handoff §3.2 step 2). */
export function wrapIndex(index: number, d: number, count: number): number {
  if (count <= 0) return 0
  return (((index + d) % count) + count) % count
}

// ---------------------------------------------------------------------------
// Team avatars — a deterministic palette (the teams table has no colour)
// ---------------------------------------------------------------------------

/** Team avatars live in the shared mobile palette (one colour per team on
 *  every screen) — re-exported here for the league screens' imports. */
export { teamAvatarClass } from '@/components/mobile/ui/avatar-colors'

/** The avatar's single initial — the first character of the team name. */
export function teamInitial(name: string): string {
  const first = Array.from(name.trim())[0]
  return first ? first.toUpperCase() : '?'
}

// ---------------------------------------------------------------------------
// The card's text column
// ---------------------------------------------------------------------------

/** A decided head-to-head result in the slot the design gives the win-%
 *  line (11/600, coloured). Null while undecided — no probability is shown
 *  because the app has no win-probability model. */
export function resultWord(result: string | null): { text: string; tone: 'win' | 'loss' | 'tie' } | null {
  switch (result) {
    case 'win':
      return { text: 'Won', tone: 'win' }
    case 'loss':
      return { text: 'Lost', tone: 'loss' }
    case 'tie':
      return { text: 'Tied', tone: 'tie' }
    default:
      return null
  }
}

/** A projected total as the card shows it — the bare number, two decimals —
 *  only when every filled starter has a stored projection (a partial sum
 *  would understate the side; `projectedTotalText`'s rule). */
export function cardProjection(total: { total: number; missing: number } | null, filled: number): string | null {
  if (!total || filled === 0 || total.missing > 0) return null
  return total.total.toFixed(2)
}

// ---------------------------------------------------------------------------
// Starter rows
// ---------------------------------------------------------------------------

/** "J. Chase" (handoff `short(n)`): unchanged for a D/ST, a single word, or a
 *  first token that already holds a dot ("A.J. Brown"). */
export function shortName(fullName: string, position: string | null | undefined): string {
  const name = fullName.trim()
  if (position === 'DEF' || position === 'DST' || /D\/ST$/.test(name)) return name
  const parts = name.split(/\s+/)
  if (parts.length < 2 || parts[0]!.includes('.')) return name
  return `${parts[0]![0]}. ${parts.slice(1).join(' ')}`
}

/** "QB · CLE (9)" — the bye week from the roster read when known. */
export function metaTeam(nflTeam: string | null, bye: number | null | undefined): string | null {
  if (!nflTeam) return null
  return bye ? `${nflTeam} (${bye})` : nflTeam
}

/** "vs DET" / "@ LAR" from the stored game row. */
export function opponentOf(nflTeam: string | null, game: Pick<BoxGame, 'home_team' | 'away_team'> | null): string | null {
  if (!game || !nflTeam) return null
  if (game.home_team === nflTeam) return `vs ${game.away_team}`
  if (game.away_team === nflTeam) return `@ ${game.home_team}`
  return null
}

/**
 * The game line under a player (handoff §5 "Game status strings"):
 * pre-game "Sun 1:00 PM vs DET", in progress "Q4 6:50 @ DEN", final
 * "Final W 31-20 @ GB". Read from the stored `nfl_games` row — the provider's
 * status, quarter and clock, never a wall clock. `kickoffLocal` is the
 * stored kickoff formatted by the caller.
 */
export function gameLine(
  nflTeam: string | null,
  phase: BoxStarter['phase'],
  game: BoxGame | null,
  kickoffLocal: string | null,
): string {
  if (!game) return phase === 'bye' ? 'Bye week' : ''
  const opp = opponentOf(nflTeam, game)
  const tail = opp ? ` ${opp}` : ''
  if (game.status === 'live') {
    return `${liveClock(game) ?? 'Live'}${tail}`
  }
  if (game.status === 'final') {
    const home = game.home_team === nflTeam
    const mine = home ? game.home_score : game.away_score
    const theirs = home ? game.away_score : game.home_score
    if (mine === null || theirs === null || !opp) return `Final${tail}`
    const wl = mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'
    return `Final ${wl} ${mine}-${theirs}${tail}`
  }
  if (game.status === 'postponed') return `Postponed${tail}`
  return `${kickoffLocal ?? ''}${tail}`.trim()
}

/** The points cell as the design draws it: a number (t1), "-" for a player
 *  who has not played yet and "–" for an empty seat (both t5), and the
 *  app's `pending` WORD — never a number — while a stat is undelivered. */
export function pointsDisplay(cell: Pick<StarterCell, 'text' | 'tone'>): { text: string; tone: 'scored' | 'dim' | 'word' } {
  switch (cell.tone) {
    case 'scored':
    case 'zero_by_name':
    case 'bye':
      return { text: cell.text, tone: 'scored' }
    case 'yet_to_play':
      return { text: '-', tone: 'dim' }
    case 'pending':
      return { text: cell.text, tone: 'word' }
    default:
      return { text: '–', tone: 'dim' }
  }
}

// ---------------------------------------------------------------------------
// Slot chips (handoff §2.2 C — 26px, radius 8, 11/600; fills from `MPosChip`)
// ---------------------------------------------------------------------------

const POSITION_SLOTS = new Set(['qb', 'rb', 'wr', 'te', 'k', 'def', 'dst'])

/** The `MPosChip` position a slot chip draws: the slot's own position for a
 *  position slot (QB…D/ST), else its short text (FLEX takes the shared
 *  chip's ink FLEX fill; any other slot the shared chip's neutral fill). */
export function slotChipPos(slotKey: string, text: string): string {
  const key = slotKey.toLowerCase()
  return POSITION_SLOTS.has(key) ? key.toUpperCase() : text
}

/** The Team tab's BN chip — a fixed #EDEDF0 with ink text (handoff m-team §E). */
export const BENCH_CHIP = 'bg-surface-hover text-ink'

/** The chip's short text — "FLEX (W/R/T)" reads "FLEX" in a 38px chip. */
export function slotChipText(label: string, slotKey: string): string {
  const base = label.replace(/\s*\(.*\)\s*$/, '').trim().toUpperCase() || slotKey.toUpperCase()
  if (base === 'DEF' || base === 'DST') return 'D/ST'
  if (base.length <= 5) return base
  if (/SUPER/.test(base)) return 'SFLX'
  return base.slice(0, 4)
}

// ---------------------------------------------------------------------------
// "Yet to play" (handoff §2.2 A.3)
// ---------------------------------------------------------------------------

/** Filled starters whose game has not kicked off (the box's `up_next`
 *  phase, from each game's stored status) and their positions in slot
 *  order. A bye is not "yet to play". */
export function yetToPlay(starters: readonly Pick<BoxStarter, 'player' | 'phase'>[]): { count: number; positions: string[] } {
  const left = starters.filter((s) => s.player !== null && s.phase === 'up_next')
  return { count: left.length, positions: left.map((s) => posLabel(s.player!.position)) }
}

export function yetToPlayText(count: number, positions: readonly string[] | null): string {
  return positions && positions.length > 0 ? `Yet to play: ${count} · ${positions.join(', ')}` : `Yet to play: ${count}`
}
