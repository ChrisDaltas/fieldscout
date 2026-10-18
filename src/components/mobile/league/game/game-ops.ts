/**
 * The NFL game screen's box score (gap list §3 #17; handoff m-match §2.3 5
 * "Box score", §5 `BOX`) — pure. Every number is a stored `player_stats`
 * column read as is; nothing here scores, sums or estimates.
 *
 * Built from data the app already has: the game row (`nfl_games` — teams,
 * score, quarter, clock, status) and each player's stored weekly line. Left
 * out because nothing sends them (gap list §2 "TV network, NFL team records
 * and team stat totals"): the Team stats table, records, possession, down &
 * distance, the field strip and Play by play.
 */
import { shortName } from '@/components/mobile/league/match/match-ops'
import { isZeroingHold } from '@/lib/leagues/scoring/held-games'

/** The stored columns the box prints (a display subset of `player_stats`). */
export const GAME_BOX_COLUMNS = [
  'pass_completions',
  'pass_attempts',
  'pass_yards',
  'pass_tds',
  'interceptions',
  'rush_attempts',
  'rush_yards',
  'rush_tds',
  'targets',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'fg_made',
  'fg_attempted',
  'xp_made',
  'xp_attempted',
  'def_sacks',
  'def_interceptions',
  'def_fumble_recoveries',
  'def_tds',
] as const
export type GameBoxColumn = (typeof GAME_BOX_COLUMNS)[number]

export type GameBoxLine = { player_id: string; game_id: string | null } & Partial<Record<GameBoxColumn, number | null>>

export interface GameBoxPlayer {
  id: string
  full_name: string
  position: string
  /** His CURRENT NFL team (`players.team`). */
  team: string | null
}

/** The `nfl_games` row the screen shows (world-readable, 001/005). */
export interface NflGameRow {
  id: string
  season: number
  week: number
  home_team: string
  away_team: string
  kickoff_at: string
  status: string | null
  home_score: number | null
  away_score: number | null
  quarter: number | null
  game_clock: string | null
  /** An operator's mark (184) — absent on a database before that push. */
  operator_hold?: string | null
}

export function nflGameHref(leagueId: string, gameId: string): string {
  return `/app/leagues/${leagueId}/games/${encodeURIComponent(gameId)}`
}

/** Does a stored line belong to this game? The held-games rule — one rule
 *  for "which game is this line": by `game_id` when the line names one,
 *  else his current NFL team plays in it (production's lines carry no
 *  game id, F468(a)). */
export function lineInGame(line: Pick<GameBoxLine, 'game_id'>, player: Pick<GameBoxPlayer, 'team'> | undefined, game: Pick<NflGameRow, 'id' | 'home_team' | 'away_team'>): boolean {
  if (line.game_id) return line.game_id === game.id
  const team = player?.team ?? null
  return team !== null && (team === game.home_team || team === game.away_team)
}

// ---------------------------------------------------------------------------
// Status — the game's own stored state, in the design's words
// ---------------------------------------------------------------------------

export type GameState = 'live' | 'final' | 'scheduled' | 'postponed' | 'held'

export interface GameStatus {
  state: GameState
  /** "Q4 2:19" / "Final" / "Sun 1:00 PM" / "Postponed" / "Cancelled". */
  text: string
  /** Under way or over: the score means something. */
  started: boolean
}

function quarterText(quarter: number | null): string | null {
  if (quarter === null) return null
  return quarter >= 5 ? 'OT' : `Q${quarter}`
}

export function gameStatus(game: Pick<NflGameRow, 'status' | 'quarter' | 'game_clock' | 'operator_hold'>, kickoffLocal: string): GameStatus {
  if (isZeroingHold(game.operator_hold)) {
    return { state: 'held', text: game.operator_hold === 'cancelled' ? 'Cancelled' : 'Moved out of the week', started: false }
  }
  if (game.status === 'live') {
    const clock = [quarterText(game.quarter), game.game_clock].filter(Boolean).join(' ')
    return { state: 'live', text: clock || 'Live', started: true }
  }
  if (game.status === 'final') return { state: 'final', text: game.quarter !== null && game.quarter >= 5 ? 'Final/OT' : 'Final', started: true }
  if (game.status === 'postponed') return { state: 'postponed', text: 'Postponed', started: false }
  return { state: 'scheduled', text: kickoffLocal, started: false }
}

/** A side's score as the card prints it: blank until the game is under way. */
export function scoreText(status: GameStatus, score: number | null): string {
  return status.started && score !== null ? String(score) : ''
}

/** Why the box has no rows, in words. */
export function emptyBoxCopy(status: GameStatus): string {
  switch (status.state) {
    case 'held':
      return 'Its players score 0 this week.'
    case 'live':
      return 'No stats yet.'
    case 'final':
      return 'No player stats for this game.'
    default:
      return 'Stats show here once the game starts.'
  }
}

// ---------------------------------------------------------------------------
// Player groups — Passing, Rushing, Receiving (the design's three), plus
// Kicking and Defense so a K or D/ST starter's game shows his line too
// ---------------------------------------------------------------------------

export interface BoxRow {
  playerId: string
  /** "J. Burrow · CIN". */
  name: string
  cells: string[]
  /** What a screen reader hears: "J. Burrow, CIN: 24/31 C/Att, 288 Yds…". */
  label: string
}

export interface BoxGroup {
  key: 'passing' | 'rushing' | 'receiving' | 'kicking' | 'defense'
  title: string
  cols: readonly string[]
  rows: BoxRow[]
}

type Line = GameBoxLine
const v = (line: Line, c: GameBoxColumn): number => line[c] ?? 0
/** A stored number as printed; a column the line doesn't carry is "–". */
const n = (line: Line, c: GameBoxColumn): string => {
  const x = line[c]
  return x === null || x === undefined ? '–' : String(x)
}
const pair = (line: Line, made: GameBoxColumn, att: GameBoxColumn): string => {
  if ((line[made] ?? null) === null && (line[att] ?? null) === null) return '–'
  return `${n(line, made)}/${n(line, att)}`
}
const isDefense = (p: GameBoxPlayer) => p.position === 'DEF' || p.position === 'DST'

interface GroupSpec {
  key: BoxGroup['key']
  title: string
  cols: readonly string[]
  has: (line: Line, p: GameBoxPlayer) => boolean
  cells: (line: Line) => string[]
  /** The leader first, within each team. */
  rank: (line: Line) => number
}

const GROUPS: readonly GroupSpec[] = [
  {
    key: 'passing',
    title: 'Passing',
    cols: ['C/Att', 'Yds', 'TD', 'Int'],
    has: (l, p) => !isDefense(p) && (v(l, 'pass_attempts') > 0 || v(l, 'pass_completions') > 0 || v(l, 'pass_yards') !== 0 || v(l, 'pass_tds') > 0 || v(l, 'interceptions') > 0),
    cells: (l) => [pair(l, 'pass_completions', 'pass_attempts'), n(l, 'pass_yards'), n(l, 'pass_tds'), n(l, 'interceptions')],
    rank: (l) => v(l, 'pass_yards'),
  },
  {
    key: 'rushing',
    title: 'Rushing',
    cols: ['Car', 'Yds', 'TD'],
    has: (l, p) => !isDefense(p) && (v(l, 'rush_attempts') > 0 || v(l, 'rush_yards') !== 0 || v(l, 'rush_tds') > 0),
    cells: (l) => [n(l, 'rush_attempts'), n(l, 'rush_yards'), n(l, 'rush_tds')],
    rank: (l) => v(l, 'rush_yards'),
  },
  {
    key: 'receiving',
    title: 'Receiving',
    cols: ['Rec', 'Yds', 'TD'],
    has: (l, p) => !isDefense(p) && (v(l, 'receptions') > 0 || v(l, 'targets') > 0 || v(l, 'receiving_yards') !== 0 || v(l, 'receiving_tds') > 0),
    cells: (l) => [n(l, 'receptions'), n(l, 'receiving_yards'), n(l, 'receiving_tds')],
    rank: (l) => v(l, 'receiving_yards'),
  },
  {
    key: 'kicking',
    title: 'Kicking',
    cols: ['FG', 'XP'],
    has: (l, p) => !isDefense(p) && (v(l, 'fg_attempted') > 0 || v(l, 'fg_made') > 0 || v(l, 'xp_attempted') > 0 || v(l, 'xp_made') > 0),
    cells: (l) => [pair(l, 'fg_made', 'fg_attempted'), pair(l, 'xp_made', 'xp_attempted')],
    rank: (l) => v(l, 'fg_made') * 3 + v(l, 'xp_made'),
  },
  {
    key: 'defense',
    title: 'Defense',
    cols: ['Sacks', 'Int', 'FR', 'TD'],
    has: (_l, p) => isDefense(p),
    cells: (l) => [n(l, 'def_sacks'), n(l, 'def_interceptions'), n(l, 'def_fumble_recoveries'), n(l, 'def_tds')],
    rank: () => 0,
  },
]

/**
 * The box's player groups for one game: each stored line of a player in
 * this game (`lineInGame`), in the group(s) his line has numbers for. The
 * away team's players come first, then the home team's (the design's
 * order — "J. Burrow · CIN" before "T. Tagovailoa · MIA"), each led by the
 * group's yardage leader. A group with no rows is left out. A held game
 * (moved out of the week / cancelled) has no lines: its players score 0.
 */
export function boxGroups(game: NflGameRow, players: readonly GameBoxPlayer[], lines: readonly GameBoxLine[]): BoxGroup[] {
  if (isZeroingHold(game.operator_hold)) return []
  const byId = new Map(players.map((p) => [p.id, p]))
  const mine = lines.flatMap((line) => {
    const p = byId.get(line.player_id)
    return p && lineInGame(line, p, game) ? [{ line, p }] : []
  })
  const side = (p: GameBoxPlayer) => (p.team === game.away_team ? 0 : 1)
  const out: BoxGroup[] = []
  for (const g of GROUPS) {
    const rows = mine
      .filter(({ line, p }) => g.has(line, p))
      .sort((x, y) => side(x.p) - side(y.p) || g.rank(y.line) - g.rank(x.line) || x.p.full_name.localeCompare(y.p.full_name))
      .map(({ line, p }) => {
        const short = shortName(p.full_name, p.position)
        const team = p.team ?? ''
        const cells = g.cells(line)
        return {
          playerId: p.id,
          name: team ? `${short} · ${team}` : short,
          cells,
          label: `${short}${team ? `, ${team}` : ''}: ${cells.map((c, i) => `${c} ${g.cols[i]}`).join(', ')}`,
        }
      })
    if (rows.length > 0) out.push({ key: g.key, title: g.title, cols: g.cols, rows })
  }
  return out
}
