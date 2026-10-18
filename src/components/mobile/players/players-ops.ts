/**
 * FieldScout Mobile — Players tab, pure derivation (handoff spec
 * `docs/design/mobile/m-players.md`).
 *
 * The prototype's column catalogue (`PCOLS` / `PCOLMETA`) narrowed to the
 * stats the app really has: every column here is read from a stored source
 * (the league's scored values, `player_stats` lines, `player_usage`,
 * `defense_position_splits`). The design's Ownership group (Rost% / +/- /
 * Start%) and the tracking-feed columns (air yards, aDOT, CPOE, rush share,
 * YCO, RYOE, broken tackles, red-zone attempts, YAC, YPRR) have no source and
 * are left out — the report lists them as gaps.
 *
 * The league tab offers the spec's catalogue only. The account Players tab
 * (`research` — not in the handoff) also offers Fumbles and the Kicking and
 * Defense groups, because the desktop research table it stands in for has
 * them (`players-spreadsheet.tsx`).
 *
 * Nothing here computes a fantasy score: points come from the server (the
 * league's own scoring) or the players builder route; this file only sums
 * box-score counting stats, formats, tiers and sorts.
 */

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export type Surface = 'league' | 'research'

export type ColGroup = 'fantasy' | 'matchup' | 'base' | 'usage' | 'apass' | 'arush' | 'arec' | 'kick' | 'def'

export type ColKey =
  | 'proj'
  | 'avg'
  | 'tot'
  | 'prk'
  | 'ovr'
  | 'oprk'
  | 'totyd'
  | 'tottd'
  | 'pyd'
  | 'ptd'
  | 'int'
  | 'ryd'
  | 'rtd'
  | 'recyd'
  | 'rectd'
  | 'fum'
  | 'snap'
  | 'touch'
  | 'opp'
  | 'patt'
  | 'cmp'
  | 'sack'
  | 'ratt'
  | 'tgt'
  | 'tshare'
  | 'rec'
  | 'catch'
  | 'fgm'
  | 'fga'
  | 'fg40'
  | 'fg50'
  | 'xpm'
  | 'xpa'
  | 'dsack'
  | 'dint'
  | 'dfr'
  | 'dtd'
  | 'dsaf'

export interface ColDef {
  key: ColKey
  group: ColGroup
  /** Customize-sheet chip label (`PCOLS[1]`). */
  chip: string
  /** Header / strip abbreviation (`PCOLMETA[k][0]`). */
  abbr: string
  /** Column-tip title (`PCOLMETA[k][1]`). */
  name: string
  /** Column-tip description, per surface where the meaning differs. */
  desc: string | Record<Surface, string>
  /** Which surfaces offer the column (default: both). */
  only?: Surface
}

export const GROUP_LABEL: Record<ColGroup, string> = {
  fantasy: 'Fantasy',
  matchup: 'Matchup',
  base: 'Base stats',
  usage: 'Usage',
  apass: 'Advanced passing',
  arush: 'Advanced rushing',
  arec: 'Advanced receiving',
  kick: 'Kicking',
  def: 'Defense',
}

/** The sheet's group band uses these when the run is under 3 columns. */
export const GROUP_SHORT: Record<ColGroup, string> = {
  fantasy: 'Fantasy',
  matchup: 'Match',
  base: 'Base',
  usage: 'Usage',
  apass: 'Adv pass',
  arush: 'Adv rush',
  arec: 'Adv rec',
  kick: 'Kick',
  def: 'Def',
}

/** Catalogue order — the order the Customize sheet lists and adding a
 *  column re-sorts into (spec §3 "Column chip"). */
export const COLUMNS: readonly ColDef[] = [
  {
    key: 'proj',
    group: 'fantasy',
    chip: 'Proj',
    abbr: 'Proj',
    name: 'Projected points',
    desc: {
      league: 'FieldScout’s projected fantasy points for the week, in your league’s scoring — this week’s under Season. A past week shows “–” once its projection is out of date.',
      research: 'Projected fantasy points for the whole season, in the scoring you picked — the live pace once games are played, the preseason projection before.',
    },
  },
  {
    key: 'avg',
    group: 'fantasy',
    chip: 'Avg pts',
    abbr: 'Avg',
    name: 'Average points',
    desc: {
      league: 'Fantasy points per game played this season, in your league’s scoring.',
      research: 'Fantasy points per game played in the season you picked, in the scoring you picked.',
    },
  },
  {
    key: 'tot',
    group: 'fantasy',
    chip: 'Total pts',
    abbr: 'Tot',
    name: 'Total points',
    desc: {
      league: 'Fantasy points scored in the period you picked, in your league’s scoring. Season counts the weeks before this one.',
      research: 'Fantasy points scored in the season you picked, in the scoring you picked.',
    },
  },
  // Ranks are research-only: the app ranks a player in his LEAGUE's scoring
  // only one player at a time (`/api/players/[id]/core-stats?league=`, which
  // re-scores the whole pool on every call, uncached for a league), so a
  // list cannot sort by them — a gap until a bulk league-ranks read exists.
  // The research tab ranks over the whole pool it already holds.
  { key: 'prk', group: 'fantasy', chip: 'Pos rk', abbr: 'PosRk', name: 'Position rank', desc: 'Where the player ranks at his position in total fantasy points.', only: 'research' },
  { key: 'ovr', group: 'fantasy', chip: 'Ovr rk', abbr: 'OvrRk', name: 'Overall rank', desc: 'Where the player ranks among all players in total fantasy points.', only: 'research' },
  {
    key: 'oprk',
    group: 'matchup',
    chip: 'OPRK',
    abbr: 'OPRK',
    name: 'Opponent rank',
    desc: 'How generous this week’s defense is to the position. Higher means an easier matchup.',
    only: 'league',
  },
  { key: 'totyd', group: 'base', chip: 'Tot yds', abbr: 'TotYd', name: 'Total yards', desc: 'Passing, rushing and receiving yards combined.' },
  { key: 'tottd', group: 'base', chip: 'Tot TD', abbr: 'TotTD', name: 'Total touchdowns', desc: 'Passing, rushing and receiving touchdowns combined.' },
  { key: 'pyd', group: 'base', chip: 'Pass yds', abbr: 'PaYd', name: 'Passing yards', desc: 'Yards gained through the air.' },
  { key: 'ptd', group: 'base', chip: 'Pass TD', abbr: 'PaTD', name: 'Passing touchdowns', desc: 'Touchdown passes thrown.' },
  { key: 'int', group: 'base', chip: 'Int', abbr: 'Int', name: 'Interceptions', desc: 'Passes caught by the defense.' },
  { key: 'ryd', group: 'base', chip: 'Rush yds', abbr: 'RuYd', name: 'Rushing yards', desc: 'Yards gained on carries.' },
  { key: 'rtd', group: 'base', chip: 'Rush TD', abbr: 'RuTD', name: 'Rushing touchdowns', desc: 'Touchdowns scored on carries.' },
  { key: 'recyd', group: 'base', chip: 'Rec yds', abbr: 'ReYd', name: 'Receiving yards', desc: 'Yards gained on catches.' },
  { key: 'rectd', group: 'base', chip: 'Rec TD', abbr: 'ReTD', name: 'Receiving touchdowns', desc: 'Touchdowns scored on catches.' },
  { key: 'fum', group: 'base', chip: 'Fumbles', abbr: 'Fum', name: 'Fumbles lost', desc: 'Fumbles the other team recovered.', only: 'research' },
  {
    key: 'snap',
    group: 'usage',
    chip: 'Snap %',
    abbr: 'Snap%',
    name: 'Snap share',
    desc: 'Share of the team’s offensive snaps the player was on the field for, over the season.',
  },
  { key: 'touch', group: 'usage', chip: 'Touches', abbr: 'Tch', name: 'Touches', desc: 'Carries plus receptions.' },
  { key: 'opp', group: 'usage', chip: 'Opps', abbr: 'Opp', name: 'Opportunities', desc: 'Carries plus targets. A volume measure that doesn’t depend on efficiency.' },
  { key: 'patt', group: 'apass', chip: 'Att', abbr: 'Att', name: 'Pass attempts', desc: 'Passes thrown.' },
  { key: 'cmp', group: 'apass', chip: 'Cmp %', abbr: 'Cmp%', name: 'Completion %', desc: 'Share of passes completed.' },
  { key: 'sack', group: 'apass', chip: 'Sacks', abbr: 'Sk', name: 'Sacks taken', desc: 'Times the quarterback was sacked.' },
  { key: 'ratt', group: 'arush', chip: 'Rush att', abbr: 'RuAtt', name: 'Rush attempts', desc: 'Carries.' },
  { key: 'tgt', group: 'arec', chip: 'Tgt', abbr: 'Tgt', name: 'Targets', desc: 'Passes thrown to the player.' },
  {
    key: 'tshare',
    group: 'arec',
    chip: 'Tgt share',
    abbr: 'TgtSh',
    name: 'Target share',
    desc: 'Share of the team’s targets that went to this player, over the season.',
  },
  { key: 'rec', group: 'arec', chip: 'Rec', abbr: 'Rec', name: 'Receptions', desc: 'Passes caught.' },
  { key: 'catch', group: 'arec', chip: 'Catch %', abbr: 'Ctch%', name: 'Catch rate', desc: 'Receptions divided by targets.' },
  { key: 'fgm', group: 'kick', chip: 'FG made', abbr: 'FGM', name: 'Field goals made', desc: 'Field goals made.', only: 'research' },
  { key: 'fga', group: 'kick', chip: 'FG att', abbr: 'FGA', name: 'Field goals attempted', desc: 'Field goal tries.', only: 'research' },
  { key: 'fg40', group: 'kick', chip: 'FG 40+', abbr: 'FG40', name: 'Field goals 40+ yards', desc: 'Field goals made from 40 yards or more.', only: 'research' },
  { key: 'fg50', group: 'kick', chip: 'FG 50+', abbr: 'FG50', name: 'Field goals 50+ yards', desc: 'Field goals made from 50 yards or more.', only: 'research' },
  { key: 'xpm', group: 'kick', chip: 'XP made', abbr: 'XPM', name: 'Extra points made', desc: 'Extra points made.', only: 'research' },
  { key: 'xpa', group: 'kick', chip: 'XP att', abbr: 'XPA', name: 'Extra points attempted', desc: 'Extra point tries.', only: 'research' },
  { key: 'dsack', group: 'def', chip: 'Sacks', abbr: 'Sck', name: 'Sacks', desc: 'Quarterback sacks by the defense.', only: 'research' },
  { key: 'dint', group: 'def', chip: 'Int', abbr: 'DInt', name: 'Interceptions', desc: 'Passes the defense intercepted.', only: 'research' },
  { key: 'dfr', group: 'def', chip: 'Fum rec', abbr: 'FR', name: 'Fumble recoveries', desc: 'Fumbles the defense recovered.', only: 'research' },
  { key: 'dtd', group: 'def', chip: 'Def TD', abbr: 'DTD', name: 'Defensive touchdowns', desc: 'Touchdowns scored by the defense.', only: 'research' },
  { key: 'dsaf', group: 'def', chip: 'Safeties', abbr: 'Sfty', name: 'Safeties', desc: 'Safeties scored by the defense.', only: 'research' },
]

const BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]))

export function colDef(key: ColKey): ColDef {
  return BY_KEY.get(key)!
}

export function catalogue(surface: Surface): ColDef[] {
  return COLUMNS.filter((c) => !c.only || c.only === surface)
}

export function colDesc(col: ColDef, surface: Surface): string {
  return typeof col.desc === 'string' ? col.desc : col.desc[surface]
}

/** `PCOL_DEF` narrowed to the columns each surface has (the prototype's
 *  order, not catalogue order — so the default sheet shows split bands). */
export const DEFAULT_COLS: Record<Surface, ColKey[]> = {
  league: ['proj', 'avg', 'tot', 'oprk', 'snap', 'tgt', 'tshare', 'ratt', 'totyd'],
  research: ['proj', 'avg', 'tot', 'prk', 'ovr', 'snap', 'tgt', 'tshare', 'ratt', 'totyd'],
}

/** Spec §3 "Column chip": removing keeps the order; adding re-sorts every
 *  selected column into catalogue order. */
export function toggleCol(cols: readonly ColKey[], key: ColKey, surface: Surface): ColKey[] {
  if (cols.includes(key)) return cols.filter((k) => k !== key)
  const next = new Set<ColKey>([...cols, key])
  return catalogue(surface)
    .map((c) => c.key)
    .filter((k) => next.has(k))
}

/** The sort after a column change. Removing the sort column resets the sort
 *  (the prototype keeps sorting by a hidden column — spec open question; the
 *  gap analysis recommends the reset) to Proj, else the first column. */
export function sortAfterToggle(cols: readonly ColKey[], sort: ColKey): ColKey {
  if (cols.includes(sort)) return sort
  if (cols.includes('proj')) return 'proj'
  return cols[0] ?? 'proj'
}

/** Consecutive runs of one group — the Sheet view's group bands. */
export function groupRuns(cols: readonly ColKey[]): Array<{ group: ColGroup; n: number; label: string }> {
  const out: Array<{ group: ColGroup; n: number; label: string }> = []
  for (const key of cols) {
    const g = colDef(key).group
    const last = out[out.length - 1]
    if (last && last.group === g) last.n += 1
    else out.push({ group: g, n: 1, label: '' })
  }
  for (const run of out) run.label = run.n >= 3 ? GROUP_LABEL[run.group] : GROUP_SHORT[run.group]
  return out
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export type Tier = 'good' | 'mid' | 'bad'

export interface Cell {
  /** Display text; "–" (en dash) when there is no value. */
  text: string
  /** Sort value (descending); null sinks to the bottom. */
  sort: number | null
  tier?: Tier
}

export const BLANK: Cell = { text: '–', sort: null }

export function num1(n: number | null | undefined): Cell {
  return n === null || n === undefined || !Number.isFinite(n) ? BLANK : { text: n.toFixed(1), sort: n }
}

export function int(n: number | null | undefined): Cell {
  return n === null || n === undefined || !Number.isFinite(n) ? BLANK : { text: String(Math.round(n)), sort: n }
}

export function pct(n: number | null | undefined): Cell {
  return n === null || n === undefined || !Number.isFinite(n) ? BLANK : { text: `${Math.round(n)}%`, sort: n }
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st", "23rd". */
export function ordinal(n: number): string {
  const r100 = n % 100
  if (r100 >= 11 && r100 <= 13) return `${n}th`
  const r10 = n % 10
  if (r10 === 1) return `${n}st`
  if (r10 === 2) return `${n}nd`
  if (r10 === 3) return `${n}rd`
  return `${n}th`
}

/** Rank columns sort best first: the sort value is the negated rank. */
export function rankCell(rank: number | null, prefix = ''): Cell {
  return rank === null ? BLANK : { text: `${prefix}${rank}`, sort: -rank }
}

/** Spec §5 tier rules for the columns the app has. */
export function tierOf(key: ColKey, value: number): Tier | undefined {
  if (key === 'snap') return value >= 80 ? 'good' : value < 50 ? 'bad' : 'mid'
  if (key === 'tshare') return value >= 22 ? 'good' : value < 12 ? 'bad' : 'mid'
  return undefined
}

export function tiered(key: ColKey, cell: Cell): Cell {
  if (cell.sort === null) return cell
  const tier = tierOf(key, cell.sort)
  return tier ? { ...cell, tier } : cell
}

/** OPRK cell: the ordinal, tiered by the app's one band rule (D486(16)). */
export function oprkCell(oprk: number | null, tone: 'positive' | 'caution' | 'negative' | null): Cell {
  if (oprk === null || tone === null) return BLANK
  return { text: ordinal(oprk), sort: oprk, tier: tone === 'positive' ? 'good' : tone === 'negative' ? 'bad' : 'mid' }
}

/** Text colour per cell (spec `cellOf`): tier text, t5 for "–", else t1. */
export function cellFg(cell: Cell): string {
  if (cell.sort === null) return 'text-m-t5'
  if (cell.tier === 'good') return 'text-m-tg'
  if (cell.tier === 'mid') return 'text-m-to'
  if (cell.tier === 'bad') return 'text-m-tr'
  return 'text-m-t1'
}

/** Sheet-view fill: tier fill wins; else the sort column's gb, else b1. */
export function cellBg(cell: Cell, sorted: boolean): string {
  if (cell.sort !== null && cell.tier === 'good') return 'bg-m-gg'
  if (cell.sort !== null && cell.tier === 'mid') return 'bg-m-go'
  if (cell.sort !== null && cell.tier === 'bad') return 'bg-m-gr'
  return sorted ? 'bg-m-gb' : 'bg-m-b1'
}

// ---------------------------------------------------------------------------
// Box-score counting stats
// ---------------------------------------------------------------------------

export const STAT_FIELDS = [
  'pass_attempts',
  'pass_completions',
  'pass_yards',
  'pass_tds',
  'interceptions',
  'sacks_taken',
  'rush_attempts',
  'rush_yards',
  'rush_tds',
  'fumbles_lost',
  'targets',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'fg_made',
  'fg_attempted',
  'fg_made_40_plus',
  'fg_made_50_plus',
  'xp_made',
  'xp_attempted',
  'def_sacks',
  'def_interceptions',
  'def_fumble_recoveries',
  'def_tds',
  'def_safeties',
] as const

export type StatField = (typeof STAT_FIELDS)[number]
export type StatLine = Record<StatField, number> & { games: number }

/** Sum weekly `player_stats` rows into one line per player (games = rows). */
export function sumLines(rows: ReadonlyArray<Partial<Record<StatField, number | null>> & { player_id: string | null }>): Map<string, StatLine> {
  const out = new Map<string, StatLine>()
  for (const row of rows) {
    if (!row.player_id) continue
    let acc = out.get(row.player_id)
    if (!acc) {
      acc = { games: 0 } as StatLine
      for (const f of STAT_FIELDS) acc[f] = 0
      out.set(row.player_id, acc)
    }
    acc.games += 1
    for (const f of STAT_FIELDS) acc[f] += Number(row[f] ?? 0) || 0
  }
  return out
}

const PASSING: readonly ColKey[] = ['pyd', 'ptd', 'int', 'patt', 'cmp', 'sack']
const RUSHING: readonly ColKey[] = ['ryd', 'rtd', 'ratt']
const RECEIVING: readonly ColKey[] = ['recyd', 'rectd', 'tgt', 'tshare', 'rec', 'catch']
const OFFENSE: readonly ColKey[] = ['totyd', 'tottd', 'fum', 'touch', 'opp', 'snap']
const KICKING: readonly ColKey[] = ['fgm', 'fga', 'fg40', 'fg50', 'xpm', 'xpa']
const DEFENSE: readonly ColKey[] = ['dsack', 'dint', 'dfr', 'dtd', 'dsaf']

/** Which stat columns a position can have a value in (spec §5 "Blank
 *  columns by position", read for real stats: a QB has no receiving line, a
 *  kicker and a defense only their own groups). */
const RELEVANT: Record<string, ReadonlySet<ColKey>> = {
  QB: new Set([...PASSING, ...RUSHING, ...OFFENSE]),
  RB: new Set([...RUSHING, ...RECEIVING, ...OFFENSE]),
  WR: new Set([...RUSHING, ...RECEIVING, ...OFFENSE]),
  TE: new Set([...RUSHING, ...RECEIVING, ...OFFENSE]),
  K: new Set(KICKING),
  DEF: new Set(DEFENSE),
  DST: new Set(DEFENSE),
}

export interface Usage {
  snap: number | null
  tshare: number | null
}

/**
 * The box-score and usage cells for one player. `line` is the period's summed
 * line (null = no game in the period → every stat "–"); `usage` is the
 * season's `player_usage` row. Irrelevant columns for the position are "–".
 */
export function statCells(position: string, line: StatLine | null, usage: Usage | null): Partial<Record<ColKey, Cell>> {
  const rel = RELEVANT[position] ?? new Set<ColKey>()
  const out: Partial<Record<ColKey, Cell>> = {}
  const put = (key: ColKey, cell: Cell) => {
    out[key] = rel.has(key) ? tiered(key, cell) : BLANK
  }
  put('snap', pct(usage?.snap ?? null))
  put('tshare', pct(usage?.tshare ?? null))
  if (!line || line.games === 0) return out
  const L = line
  put('totyd', int(L.pass_yards + L.rush_yards + L.receiving_yards))
  put('tottd', int(L.pass_tds + L.rush_tds + L.receiving_tds))
  put('pyd', int(L.pass_yards))
  put('ptd', int(L.pass_tds))
  put('int', int(L.interceptions))
  put('ryd', int(L.rush_yards))
  put('rtd', int(L.rush_tds))
  put('recyd', int(L.receiving_yards))
  put('rectd', int(L.receiving_tds))
  put('fum', int(L.fumbles_lost))
  put('touch', int(L.rush_attempts + L.receptions))
  put('opp', int(L.rush_attempts + L.targets))
  put('patt', int(L.pass_attempts))
  put('cmp', L.pass_attempts > 0 ? pct((L.pass_completions / L.pass_attempts) * 100) : BLANK)
  put('sack', int(L.sacks_taken))
  put('ratt', int(L.rush_attempts))
  put('tgt', int(L.targets))
  put('rec', int(L.receptions))
  put('catch', L.targets > 0 ? pct((L.receptions / L.targets) * 100) : BLANK)
  put('fgm', int(L.fg_made))
  put('fga', int(L.fg_attempted))
  put('fg40', int(L.fg_made_40_plus))
  put('fg50', int(L.fg_made_50_plus))
  put('xpm', int(L.xp_made))
  put('xpa', int(L.xp_attempted))
  put('dsack', int(L.def_sacks))
  put('dint', int(L.def_interceptions))
  put('dfr', int(L.def_fumble_recoveries))
  put('dtd', int(L.def_tds))
  put('dsaf', int(L.def_safeties))
  return out
}

const VALUE_KEYS: ReadonlySet<ColKey> = new Set(['proj', 'avg', 'tot', 'prk', 'ovr'])
const USAGE_KEYS: ReadonlySet<ColKey> = new Set(['snap', 'tshare'])

/** Which reads the shown columns (and the sort) need — a read nobody shows
 *  is not made. */
export function colNeeds(cols: readonly ColKey[], sort: ColKey): { values: boolean; usage: boolean; lines: boolean } {
  const all = [...cols, sort]
  return {
    values: all.some((k) => VALUE_KEYS.has(k)),
    usage: all.some((k) => USAGE_KEYS.has(k)),
    lines: all.some((k) => !VALUE_KEYS.has(k) && !USAGE_KEYS.has(k) && k !== 'oprk'),
  }
}

/**
 * One week's league-scored points from two server reads: the season to date
 * before the week, and before the week after (the player-values route's own
 * `season_points` / `season_games`, scored by the league). No game in the
 * week (the games count did not move) is "–", never 0.
 */
export function weekPointsCell(
  before: { season_points: number | null; season_games: number } | undefined,
  after: { season_points: number | null; season_games: number } | undefined,
): Cell {
  if (!before || !after) return BLANK
  if (after.season_games - before.season_games <= 0) return BLANK
  return num1(Math.round(((after.season_points ?? 0) - (before.season_points ?? 0)) * 100) / 100)
}

// ---------------------------------------------------------------------------
// The game line
// ---------------------------------------------------------------------------

/** A stored `nfl_games` row. The state columns are optional so a read that
 *  selects only the schedule still fits: a missing score or clock reads as
 *  unknown, never as 0. */
export interface GameLike {
  home_team: string
  away_team: string
  kickoff_at: string
  status: string | null
  home_score?: number | null
  away_score?: number | null
  quarter?: number | null
  game_clock?: string | null
}

/** `nfl_games.status` while a game is on (the sync writes `live`; the
 *  provider's own word is `in_progress`). */
export function isLiveStatus(status: string | null | undefined): boolean {
  return status === 'live' || status === 'in_progress'
}

/**
 * Where his team's game stands, without the opponent (spec §5 `game`
 * formats; the player profile's this-week card, gap list §3 #19): "Sun 5:20
 * PM" before kickoff, "Q4 2:19 · 18-28" live (his team's score first, OT
 * from the fifth quarter), "Final W 31-20" after. Read from the stored row
 * (the provider's status, quarter, clock and score), never a wall clock.
 *
 * The sync stores only a game's status today (`toGameRow`, ingest-week.ts):
 * the score columns keep 001's 0/0 default and the quarter and clock stay
 * null. So a score counts only beside a clock — plain "Live" otherwise —
 * and a final 0-0 is the default, not a result: plain "Final" (gap list §2,
 * "A live game's clock and score").
 */
export function gameState(team: string, g: GameLike, kickoff: (iso: string) => string): string {
  const home = g.home_team === team
  const mine = (home ? g.home_score : g.away_score) ?? null
  const theirs = (home ? g.away_score : g.home_score) ?? null
  const score = mine !== null && theirs !== null ? `${mine}-${theirs}` : null
  if (isLiveStatus(g.status)) {
    const quarter = g.quarter == null || g.quarter < 1 ? null : g.quarter >= 5 ? 'OT' : `Q${g.quarter}`
    const clock = [quarter, g.game_clock].filter(Boolean).join(' ')
    if (!clock) return 'Live'
    return score ? `${clock} · ${score}` : clock
  }
  if (g.status === 'final') {
    if (mine === null || theirs === null || (mine === 0 && theirs === 0)) return 'Final'
    return `Final ${mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'} ${score}`
  }
  return kickoff(g.kickoff_at)
}

/**
 * The row's game string from the stored game (spec §5 `game` formats):
 * "Sun 5:20 PM vs BAL" before kickoff, "Q4 2:19 · 18-28 vs CIN" live (his
 * team's score first), "Final L 7-31 @ GB" after. `null` when the week's
 * games are not on record; "Bye" when his team has no game that week.
 */
export function gameText(team: string | null, games: readonly GameLike[], kickoff: (iso: string) => string): { text: string; opp: string | null } | null {
  if (!team || games.length === 0) return null
  const g = games.find((x) => x.home_team === team || x.away_team === team)
  if (!g) return { text: 'Bye', opp: null }
  const home = g.home_team === team
  const opp = home ? g.away_team : g.home_team
  const where = `${home ? 'vs' : '@'} ${opp}`
  const state = gameState(team, g, kickoff)
  return { text: state ? `${state} ${where}` : where, opp }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Always descending (spec §5 "Sort"), stable: ties keep the incoming order.
 * A missing value sinks to the bottom — the app's null-sinks rule (never
 * read as −1 the way the prototype's `parseFloat(…) || -1` does).
 */
export function sortByCell<T>(rows: readonly T[], cellOf: (row: T) => Cell): T[] {
  return rows
    .map((row, i) => ({ row, i, v: cellOf(row).sort }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i
      if (a.v === null) return 1
      if (b.v === null) return -1
      return a.v === b.v ? a.i - b.i : b.v - a.v
    })
    .map((x) => x.row)
}

// ---------------------------------------------------------------------------
// Names, positions, filters
// ---------------------------------------------------------------------------

/** "F. Last …" — D/ST and dotted first names ("A.J. Brown") kept whole. */
export function shortName(full: string, position: string): string {
  if (position === 'DEF' || position === 'DST' || /D\/ST$/.test(full)) return full
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2 || parts[0]!.includes('.')) return full
  return `${parts[0]![0]}. ${parts.slice(1).join(' ')}`
}

export type MPos = 'All' | 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'K' | 'D/ST'
export const POS_OPTIONS: readonly MPos[] = ['All', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'D/ST']

/** The `players.position` values a position option covers (D/ST is DEF in
 *  the app; FLEX is RB/WR/TE). Null = every position. */
export function positionsOf(pos: MPos): string[] | null {
  if (pos === 'All') return null
  if (pos === 'FLEX') return ['RB', 'WR', 'TE']
  if (pos === 'D/ST') return ['DEF']
  return [pos]
}

export function posMatches(pos: MPos, position: string): boolean {
  const list = positionsOf(pos)
  return list === null || list.includes(position === 'DST' ? 'DEF' : position)
}

/** The 32 NFL abbreviations in alphabetical order (spec §2.1 team popover). */
export const NFL_TEAMS: readonly string[] = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]

/** Count text: "+" when the browse window was full (more players exist than
 *  the list could read — the honest version of the prototype's "40+"). */
export function countText(n: number, truncated: boolean): string {
  return `${n}${truncated ? '+' : ''}`
}

/** Rows shown per page; "Show more" appends another page (the prototype
 *  caps the list at 40 — spec §1 "Capped result"). */
export const PAGE = 40
