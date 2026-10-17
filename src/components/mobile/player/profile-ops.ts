/**
 * FieldScout Mobile player profile — pure derivations (handoff spec
 * `docs/design/mobile/m-pprofile.md`). Everything here LABELS stored data:
 * the player row, the core-stats read, the schedule + defense splits, the
 * weekly box lines, the depth chart, the league feed and the draft. A value
 * with no real source is omitted (or a dash where the layout needs a cell);
 * the prototype's seeded placeholders (rostered %, news, advanced key stats,
 * team ranks, weekly snap % / position rank) are never invented.
 */
import type { Tone } from '@/components/leagues/my-team-ops'
import { formatAge, formatHeight, ordinal, shortKickoff, type ScheduleRow, type TeamGame } from '@/components/players/player-page-ops'
import type { DraftPickSummary } from '@/hooks/use-draft'
import type { LeagueDetail } from '@/hooks/use-league'
import type { DepthChartPlayer } from '@/hooks/use-mobile-pprofile-depth-chart'
import type { ProfileBoxColumn, ProfileStatLine } from '@/hooks/use-mobile-pprofile-stat-lines'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'
import { sumBox, type BoxKey, type BoxTotals, type CoreStatsPayload, type ScoringChoice } from '@/lib/players/core-stats-ops'
import { completionPct, perGame, yardsPerTarget } from '@/lib/players/key-stats-ops'
import { NFL_TEAM_COLORS } from '@/lib/nfl-team-colors'
import { calculateFantasyPoints, HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING, type ScoringRules } from '@/lib/scoring/default'

export const DASH = '–'

// ---------------------------------------------------------------------------
// Header (§2.1)
// ---------------------------------------------------------------------------

/** The prototype's `isLight`: perceived luminance > 160 (PIT, NO). */
export function isLightHex(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16)
  if (!Number.isFinite(n)) return false
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 160
}

/** The header's team colour (the app's NFL colour table — data, so it is an
 *  inline style) and whether it takes dark text. No team → null (the caller
 *  paints the prototype's #3A3A3C fallback from a token). */
export function headerColors(team: string | null): { bg: string; light: boolean } | null {
  const hex = team ? NFL_TEAM_COLORS[team]?.primary : undefined
  if (!hex) return null
  return { bg: hex, light: isLightHex(hex) }
}

export function isDefense(position: string): boolean {
  return position === 'DEF' || position === 'DST'
}

/** The injury pill (H2): the full word, orange for questionable/doubtful,
 *  red for out and the reserve lists. Statuses the feed sends that are not
 *  injuries (Active, …) show nothing. */
const STATUS_PILLS: Record<string, { label: string; tone: 'warn' | 'negative' }> = {
  Questionable: { label: 'Questionable', tone: 'warn' },
  Doubtful: { label: 'Doubtful', tone: 'warn' },
  Out: { label: 'Out', tone: 'negative' },
  IR: { label: 'IR', tone: 'negative' },
  injured: { label: 'IR', tone: 'negative' },
  PUP: { label: 'PUP', tone: 'negative' },
  Suspended: { label: 'Suspended', tone: 'negative' },
}

export function statusPill(status: string | null): { label: string; tone: 'warn' | 'negative' } | null {
  return status ? (STATUS_PILLS[status] ?? null) : null
}

/** "ATL · #36"; D/ST shows the team only; no team reads "FA". */
export function teamLine(player: Pick<PlayerStatsPlayer, 'team' | 'position' | 'jersey_number'>): string {
  const team = player.team ?? 'FA'
  if (isDefense(player.position) || player.jersey_number == null) return team
  return `${team} · #${player.jersey_number}`
}

/** "Rookie" in his first season, else "7th season" (`experience_years`
 *  counts completed seasons, so this is his `experience_years + 1`th). */
export function experienceLabel(years: number | null | undefined): string | null {
  if (years == null || !Number.isFinite(years) || years < 0) return null
  return years === 0 ? 'Rookie' : `${ordinal(years + 1)} season`
}

/** "Age 28 · 5'9" · 221 lb · 7th season" — present parts only. */
export function bioLine(player: PlayerStatsPlayer, today: Date): string {
  if (isDefense(player.position)) return 'Defense / special teams'
  const parts: string[] = []
  const age = formatAge(player.birth_date, today)
  if (age) parts.push(`Age ${age}`)
  const height = formatHeight(player.height)
  if (height) parts.push(height)
  if (player.weight != null) parts.push(`${player.weight} lb`)
  const exp = experienceLabel(player.experience_years)
  if (exp) parts.push(exp)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Stat strip (§2.2)
// ---------------------------------------------------------------------------

export interface StripCell {
  key: string
  value: string
  label: string
  missing: boolean
}

/** Position rank · Avg pts · season pts · Bye week. The prototype's
 *  "Rost %" has no source (no rostered-% snapshot exists) and is left out. */
export function stripCells(core: CoreStatsPayload | null, player: Pick<PlayerStatsPlayer, 'position' | 'bye_week'>, season: number, posLabel: string): StripCell[] {
  const cells: StripCell[] = [
    {
      key: 'rank',
      value: core?.pos_rank != null ? `#${core.pos_rank}` : DASH,
      label: `${posLabel} rank`,
      missing: core?.pos_rank == null,
    },
    { key: 'avg', value: core?.avg_points != null ? core.avg_points.toFixed(1) : DASH, label: 'Avg pts', missing: core?.avg_points == null },
    {
      key: 'total',
      value: core?.total_points != null ? core.total_points.toFixed(1) : DASH,
      label: `${season} pts`,
      missing: core?.total_points == null,
    },
  ]
  if (player.bye_week != null) cells.push({ key: 'bye', value: String(player.bye_week), label: 'Bye week', missing: false })
  return cells
}

// ---------------------------------------------------------------------------
// Games and projections cards (§2.5c)
// ---------------------------------------------------------------------------

export type CardPill = 'current' | 'played' | 'upcoming'

export interface GameCard {
  week: number
  bye: boolean
  pill: CardPill
  current: boolean
  /** "vs PHI" / "@ LV"; null for a bye or an unknown game. */
  opp: string | null
  /** "(32nd)" and its tone, when the defense ranks against his position. */
  oprk: string | null
  tone: Tone | null
  mainLabel: string
  main: string
  /** 'up' = met his projection, 'down' = fell short; null = plain. */
  mainTone: 'up' | 'down' | null
  sub: { label: string; value: string } | null
  line: string | null
}

/** `nfl_games.status` while a game is on (the sync writes `live`; the
 *  provider's own word is `in_progress`). */
const LIVE_STATUSES = new Set(['in_progress', 'live'])

/**
 * The week the strip rings as "current" (§2.5c, P1h): a week whose game is
 * being played; else the NFL calendar's current week (the core-stats read's
 * `week` — the week being played, or the next one before it starts); else
 * the schedule's own next game or bye (`thisWeek`). Never the first game
 * still `scheduled` while this week's game is on — that is next week.
 */
export function currentWeekOf(games: readonly TeamGame[], calendarWeek: number | null, scheduled: number | null): number | null {
  const live = games.filter((g) => g.status !== null && LIVE_STATUSES.has(g.status)).map((g) => g.week)
  if (live.length > 0) return Math.max(...live)
  return calendarWeek ?? scheduled
}

/**
 * One card per schedule row (games + the bye). Points come only from the
 * core-stats read (completed games, under the chosen scoring); the
 * projection only where a stored weekly line exists; a played card's stat
 * line from that week's box line.
 *
 * The current week before its points are known (P1h, "no points") shows
 * his projection and where his game stands — kickoff, live or final — with
 * the box line once he has one. The design's "Points so far" (live partial
 * points) has no source: the core-stats read scores completed weeks only.
 */
export function gameCards(args: {
  schedule: readonly ScheduleRow[]
  games: readonly TeamGame[]
  weekly: ReadonlyArray<{ week: number; points: number | null; proj: number | null }>
  lines: ReadonlyArray<ProfileStatLine>
  position: string
  currentWeek: number | null
}): GameCard[] {
  return args.schedule.map((r): GameCard => {
    const current = r.week === args.currentWeek
    if (r.opponent.kind === 'bye') {
      return {
        week: r.week, bye: true, pill: current ? 'current' : 'upcoming', current, opp: null, oprk: null, tone: null,
        mainLabel: '', main: '', mainTone: null, sub: null, line: null,
      }
    }
    const g = args.games.find((x) => x.week === r.week)
    const cell = args.weekly.find((w) => w.week === r.week)
    const points = cell?.points ?? null
    const proj = cell?.proj ?? null
    const opp = r.opponent.kind === 'game' ? r.opponent.label : null
    const oprk = r.oprk !== null && r.oprk > 0 ? `(${ordinal(r.oprk)})` : null
    const live = g?.status ? LIVE_STATUSES.has(g.status) : false
    const final = g?.status === 'final'
    const played = points !== null || (!current && final)
    if (played) {
      return {
        week: r.week, bye: false, pill: current ? 'current' : 'played', current, opp, oprk, tone: oprk ? r.tone : null,
        mainLabel: 'Points',
        main: points !== null ? points.toFixed(1) : DASH,
        mainTone: points !== null && proj !== null ? (points >= proj ? 'up' : 'down') : null,
        sub: proj !== null ? { label: 'Proj', value: proj.toFixed(1) } : null,
        line: points !== null ? statLine(args.position, args.lines.find((l) => l.week === r.week && !l.is_live)) : null,
      }
    }
    const kickoff = g && g.status === 'scheduled' ? shortKickoff(g.kickoff_at) : null
    return {
      week: r.week, bye: false, pill: current ? 'current' : 'upcoming', current, opp, oprk, tone: oprk ? r.tone : null,
      mainLabel: 'Projected',
      main: proj !== null ? proj.toFixed(1) : DASH,
      mainTone: null,
      sub: live ? { label: 'Game', value: 'Live' } : final ? { label: 'Game', value: 'Final' } : kickoff ? { label: 'Kickoff', value: kickoff } : null,
      line: current && (live || final) ? statLine(args.position, args.lines.find((l) => l.week === r.week)) : null,
    }
  })
}

/** The index the strip opens at: the card before the current week, so the
 *  previous week sits at the gutter (§2.5c "Initial scroll position"). */
export function initialCardIndex(cards: readonly GameCard[]): number {
  const i = cards.findIndex((c) => c.current)
  return Math.max(0, i - 1)
}

const n = (v: number | null | undefined) => (v == null ? 0 : v)
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/** A played card's box line, per position (§5 "Stat-line formats"). */
export function statLine(position: string, line: ProfileStatLine | undefined): string | null {
  if (!line) return null
  switch (position) {
    case 'QB':
      return `${n(line.pass_completions)}/${n(line.pass_attempts)} · ${n(line.pass_yards)} yds · ${n(line.pass_tds)} TD`
    case 'RB':
      return `${n(line.rush_attempts)} car ${n(line.rush_yards)} yds · ${n(line.receptions)} rec ${n(line.receiving_yards)} yds`
    case 'WR':
    case 'TE':
      return `${n(line.receptions)}/${n(line.targets)} rec · ${n(line.receiving_yards)} yds · ${n(line.receiving_tds)} TD`
    case 'K':
      return `${n(line.fg_made)}/${n(line.fg_attempted)} FG · ${n(line.xp_made)} XP`
    case 'DEF':
    case 'DST':
      return line.def_points_allowed != null
        ? `${num(n(line.def_sacks))} sacks · ${line.def_points_allowed} PA`
        : `${num(n(line.def_sacks))} sacks · ${n(line.def_interceptions)} INT`
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Key stats trend (§2.5b) — "▲ last 3 Δ"
// ---------------------------------------------------------------------------

export interface KeyStatTrend {
  /** The arrow: ▲ when the last three games ran above his season rate,
   *  ▼ when below. */
  up: boolean
  /** The colour: green when the change is GOOD for him, red when bad —
   *  for a stat where lower is better (interceptions thrown, points
   *  allowed) a drop is green and a rise red (Chris, #43, 2026-10-15). */
  good: boolean
  text: string
}

const TREND_SPAN = 3

type TrendMetric = { of: (t: BoxTotals, games: number) => number | null; pct?: true }
const perGameOf = (k: BoxKey): TrendMetric => ({ of: (t, g) => perGame(t[k], g) })

/** The rate behind each Key stats tile (`keyStats` keys): a total tile
 *  trends as its per-game rate, a rate tile as itself. Snap % and target
 *  share are season-only rows (`player_usage`) — no weekly source, no
 *  trend. */
const TREND_METRICS = {
  carries_pg: perGameOf('rush_attempts'),
  rush_yds: perGameOf('rush_yards'),
  rush_td: perGameOf('rush_tds'),
  targets: perGameOf('targets'),
  receptions: perGameOf('receptions'),
  rec_yds: perGameOf('receiving_yards'),
  rec_td: perGameOf('receiving_tds'),
  ypt: { of: (t) => yardsPerTarget(t.receiving_yards, t.targets) },
  comp_pct: { of: (t) => completionPct(t.pass_completions, t.pass_attempts), pct: true },
  pass_yds: perGameOf('pass_yards'),
  pass_td: perGameOf('pass_tds'),
  int: perGameOf('interceptions'),
  fg: perGameOf('fg_made'),
  fg_pct: { of: (t) => completionPct(t.fg_made, t.fg_attempted), pct: true },
  fg_40: perGameOf('fg_made_40_plus'),
  fg_50: perGameOf('fg_made_50_plus'),
  xp: perGameOf('xp_made'),
  sacks: perGameOf('def_sacks'),
  def_int: perGameOf('def_interceptions'),
  fum_rec: perGameOf('def_fumble_recoveries'),
  def_td: perGameOf('def_tds'),
  pa_pg: perGameOf('def_points_allowed'),
  ya_pg: perGameOf('def_yards_allowed'),
} satisfies Record<string, TrendMetric>

export type TrendKey = keyof typeof TREND_METRICS

/**
 * Which way is better for him, decided per trended stat (#43). Typed over
 * every trended tile, so a new trend cannot ship without this call.
 *
 * Lower is better: interceptions THROWN (the QB tile `int`) and a defense's
 * points / yards allowed. A defense's own sacks and interceptions (`sacks`,
 * `def_int`) are takeaways — higher is better.
 *
 * Fumbles lost and sacks taken ARE stored per week (`player_stats` columns;
 * the profile's stat-lines read already carries `fumbles_lost`), but neither
 * has a Key stats tile (`key-stats-ops`), so neither trends yet. Drops are
 * not stored at all. A tile added for any of them trends as its per-game
 * rate and belongs here as 'lower'.
 */
export const TREND_BETTER: Record<TrendKey, 'higher' | 'lower'> = {
  carries_pg: 'higher',
  rush_yds: 'higher',
  rush_td: 'higher',
  targets: 'higher',
  receptions: 'higher',
  rec_yds: 'higher',
  rec_td: 'higher',
  ypt: 'higher',
  comp_pct: 'higher',
  pass_yds: 'higher',
  pass_td: 'higher',
  int: 'lower',
  fg: 'higher',
  fg_pct: 'higher',
  fg_40: 'higher',
  fg_50: 'higher',
  xp: 'higher',
  sacks: 'higher',
  def_int: 'higher',
  fum_rec: 'higher',
  def_td: 'higher',
  pa_pg: 'lower',
  ya_pg: 'lower',
}

/** Whether a move in this stat is good for him: a rise where higher is
 *  better, a drop where lower is better. */
export function trendIsGood(key: TrendKey, up: boolean): boolean {
  return TREND_BETTER[key] === 'higher' ? up : !up
}

/**
 * Each tile's "last 3" line: his last three completed games against his
 * season (the same completed games the tiles total — the core-stats read's
 * scored weeks). Δ is one decimal, or whole percentage points for a
 * percentage. Three games or fewer is the whole season, so no trend; a Δ
 * that rounds to nothing has no direction and is left off. The arrow says
 * which way it moved; the colour says whether that is good (`trendIsGood`).
 */
export function keyStatTrends(args: {
  lines: readonly ProfileStatLine[]
  season: number
  completedWeeks: ReadonlySet<number>
}): Record<string, KeyStatTrend> {
  const games = args.lines
    .filter((l) => l.season === args.season && !l.is_live && args.completedWeeks.has(l.week))
    .sort((a, b) => a.week - b.week)
  if (games.length <= TREND_SPAN) return {}
  const season = sumBox(games)
  const last = sumBox(games.slice(-TREND_SPAN))
  const out: Record<string, KeyStatTrend> = {}
  for (const key of Object.keys(TREND_METRICS) as TrendKey[]) {
    const m: TrendMetric = TREND_METRICS[key]
    const s = m.of(season, games.length)
    const l = m.of(last, TREND_SPAN)
    if (s === null || l === null) continue
    const d = l - s
    const mag = m.pct ? `${Math.round(Math.abs(d))}%` : Math.abs(d).toFixed(1)
    if (mag === '0%' || mag === '0.0') continue
    const up = d > 0
    out[key] = { up, good: trendIsGood(key, up), text: `${up ? '▲' : '▼'} last ${TREND_SPAN} ${mag}` }
  }
  return out
}

// ---------------------------------------------------------------------------
// Shared stats table (§2.11) — Game log and History
// ---------------------------------------------------------------------------

export type CellKind = 'plain' | 'dash' | 'bye' | 'good' | 'mid' | 'bad'

export interface TableCell {
  value: string
  kind: CellKind
}

export interface TableGroup {
  label: string
  cols: number
}

export interface TableRow {
  key: string
  k1: string
  k2: string
  /** The k2 text's colour: an OPRK tone, plain (t1), muted (t3) or none (t5). */
  k2Tone: Tone | 'plain' | 'muted' | 'none'
  cells: TableCell[]
}

export interface StatsTable {
  k1Label: string
  k1Width: number
  k2Label: string
  groups: TableGroup[]
  cols: string[]
  rows: TableRow[]
}

type BoxGroup = [label: string, cols: Array<[label: string, key: ProfileBoxColumn]>]

/** The box columns by position (the prototype's SDEF, minus kicker "Long",
 *  which is not stored — F578). */
export function boxGroups(position: string): BoxGroup[] {
  const rushing3: BoxGroup = ['Rushing', [['Att', 'rush_attempts'], ['Yds', 'rush_yards'], ['TD', 'rush_tds']]]
  const receiving: BoxGroup = ['Receiving', [['Tgt', 'targets'], ['Rec', 'receptions'], ['Yds', 'receiving_yards'], ['TD', 'receiving_tds']]]
  switch (position) {
    case 'QB':
      return [
        ['Passing', [['Att', 'pass_attempts'], ['Cmp', 'pass_completions'], ['Yds', 'pass_yards'], ['TD', 'pass_tds'], ['Int', 'interceptions']]],
        rushing3,
      ]
    case 'RB':
      return [rushing3, receiving]
    case 'K':
      return [['Kicking', [['FGM', 'fg_made'], ['FGA', 'fg_attempted'], ['XPM', 'xp_made']]]]
    case 'DEF':
    case 'DST':
      return [['Defense', [['Sack', 'def_sacks'], ['Int', 'def_interceptions'], ['FR', 'def_fumble_recoveries'], ['TD', 'def_tds'], ['PA', 'def_points_allowed']]]]
    default:
      return [receiving, ['Rushing', [['Att', 'rush_attempts'], ['Yds', 'rush_yards']]]]
  }
}

/** The prototype's per-position weekly baseline (`BASE`) — a week ≥ 1.2×
 *  is a good one, under 0.75× a bad one (§5 "Game log cells"). */
const BASE: Record<string, number> = { QB: 19, RB: 13, WR: 12, TE: 8, K: 8, DEF: 7, DST: 7 }

export function fptsTone(points: number, position: string): 'good' | 'mid' | 'bad' {
  const base = BASE[position] ?? 10
  if (points >= base * 1.2) return 'good'
  if (points < base * 0.75) return 'bad'
  return 'mid'
}

const plain = (v: string): TableCell => ({ value: v, kind: 'plain' })
const dash: TableCell = { value: DASH, kind: 'dash' }
const byeCell: TableCell = { value: '', kind: 'bye' }

function boxCells(groups: BoxGroup[], line: Partial<Record<ProfileBoxColumn, number | null>> | undefined): TableCell[] {
  return groups.flatMap(([, cols]) =>
    cols.map(([, key]) => {
      // A column the line does not carry is a dash, never an invented 0.
      const v = line?.[key]
      return v != null ? plain(num(v)) : dash
    }),
  )
}

/** The preset rules past seasons are scored under (the stats route's own
 *  calculator — the core-stats engine reads the current season only). A
 *  league basis falls back to standard. KNOWN GAP (F576): this legacy
 *  calculator has no D/ST points-allowed tiers and no missed-kick
 *  penalties, so past-season Fpts are not on the same basis as the current
 *  season's core-stats points — the same numbers the desktop game log shows
 *  for those seasons. Closing it needs the engine to score past seasons
 *  server-side. */
export function pastSeasonRules(choice: ScoringChoice): ScoringRules {
  if (choice.kind === 'system') {
    if (choice.system === 'ppr') return PPR_SCORING
    if (choice.system === 'half_ppr') return HALF_PPR_SCORING
  }
  return STANDARD_SCORING
}

/** Any nonzero stat on the line — the core-stats appearance proxy (R1506). */
export function appeared(line: ProfileStatLine): boolean {
  for (const [k, v] of Object.entries(line)) {
    if (k === 'season' || k === 'week' || k === 'is_live') continue
    if (typeof v === 'number' && v !== 0) return true
  }
  return false
}

/**
 * The Game log for one season. The current season follows the schedule
 * (games and the bye, opponent tinted by OPRK) and takes its Fpts from the
 * core-stats weekly points, so it agrees with the strip and the cards. A
 * past season lists weeks 1–18 from its stored lines (no schedule on file
 * for it here — the Opp cell is a dash) scored under the preset rules.
 */
export function gameLogTable(args: {
  season: number
  current: boolean
  position: string
  lines: readonly ProfileStatLine[]
  schedule: readonly ScheduleRow[]
  weekly: ReadonlyArray<{ week: number; points: number | null }>
  rules: ScoringRules
}): StatsTable {
  const groups = boxGroups(args.position)
  const cols = ['Fpts', ...groups.flatMap(([, c]) => c.map(([label]) => label))]
  const lineOf = (week: number) => args.lines.find((l) => l.season === args.season && l.week === week && !l.is_live)
  const rows: TableRow[] = []
  if (args.current) {
    const weeks = new Set<number>(args.schedule.map((r) => r.week))
    for (const l of args.lines) if (l.season === args.season) weeks.add(l.week)
    for (const w of args.weekly) weeks.add(w.week)
    for (const week of [...weeks].sort((a, b) => a - b)) {
      const r = args.schedule.find((x) => x.week === week)
      if (r?.opponent.kind === 'bye') {
        rows.push({ key: String(week), k1: String(week), k2: 'Bye', k2Tone: 'muted', cells: cols.map(() => byeCell) })
        continue
      }
      const g = r?.opponent.kind === 'game' ? r.opponent : null
      const k2 = g ? (g.label.startsWith('@') ? `@${g.opp}` : g.opp) : DASH
      const pts = args.weekly.find((x) => x.week === week)?.points ?? null
      const line = lineOf(week)
      const played = pts !== null
      rows.push({
        key: String(week),
        k1: String(week),
        k2,
        k2Tone: g ? (r?.tone ?? 'plain') : 'none',
        cells: played
          ? [{ value: pts.toFixed(2), kind: fptsTone(pts, args.position) }, ...boxCells(groups, line)]
          : cols.map(() => dash),
      })
    }
  } else {
    for (let week = 1; week <= 18; week += 1) {
      const line = lineOf(week)
      const pts = line && appeared(line) ? calculateFantasyPoints(line, args.rules) : null
      rows.push({
        key: String(week),
        k1: String(week),
        k2: DASH,
        k2Tone: 'none',
        cells: line ? [pts !== null ? { value: pts.toFixed(2), kind: fptsTone(pts, args.position) } : dash, ...boxCells(groups, line)] : cols.map(() => dash),
      })
    }
  }
  return {
    k1Label: 'Wk',
    k1Width: 28,
    k2Label: 'Opp',
    groups: [{ label: 'Fantasy', cols: 1 }, ...groups.map(([label, c]) => ({ label, cols: c.length }))],
    cols,
    rows,
  }
}

/** The past seasons that have stored lines, newest first. */
export function seasonsWithLines(lines: readonly ProfileStatLine[], currentSeason: number): number[] {
  return [...new Set(lines.map((l) => l.season))].filter((s) => s < currentSeason).sort((a, b) => b - a)
}

/** The career table's rank tint (§5 "Rank tint `rt`"): top 12 good,
 *  24th and worse bad, otherwise mid. */
export function rankTone(rank: number): 'good' | 'mid' | 'bad' {
  if (rank <= 12) return 'good'
  if (rank >= 24) return 'bad'
  return 'mid'
}

/**
 * History's career table: one row per season with games — the current
 * season from the core-stats read (games and points under the chosen
 * scoring), earlier ones from their stored lines (preset rules). Then his
 * position rank under ESPN Standard and Full PPR — known for the current
 * season only (the core-stats read ranks the current season; past-season
 * ranks are not computed, so those cells are dashes). Fpts is tinted by the
 * Std rank, as are Std and PPR by their own. Season sums per box column.
 * The Team column is known for the current season only (`players.team`; no
 * per-season team is stored), a dash before it.
 */
export function careerTable(args: {
  currentSeason: number
  position: string
  team: string | null
  lines: readonly ProfileStatLine[]
  core: CoreStatsPayload | null
  rules: ScoringRules
  /** His current-season position rank under each preset (null = unread). */
  ranks?: { std: number | null; ppr: number | null } | null
}): StatsTable {
  const groups = boxGroups(args.position)
  const cols = ['Gm', 'Fpts', 'Std', 'PPR', ...groups.flatMap(([, c]) => c.map(([label]) => label))]
  const seasons = [args.currentSeason, ...seasonsWithLines(args.lines, args.currentSeason)].slice(0, 4)
  const rankCell = (rank: number | null): TableCell => (rank !== null ? { value: String(rank), kind: rankTone(rank) } : dash)
  const rows = seasons.map((season): TableRow => {
    const done = args.lines.filter((l) => l.season === season && !l.is_live)
    const games = done.filter(appeared)
    const sums: Partial<Record<ProfileBoxColumn, number>> = {}
    for (const l of done) {
      for (const [, cols2] of groups) {
        for (const [, key] of cols2) {
          const v = l[key]
          if (typeof v === 'number') sums[key] = (sums[key] ?? 0) + v
        }
      }
    }
    const isCurrent = season === args.currentSeason
    const gm = isCurrent && args.core ? args.core.games : games.length
    const fpts = isCurrent
      ? (args.core?.total_points ?? null)
      : games.length > 0
        ? Math.round(games.reduce((a, l) => a + calculateFantasyPoints(l, args.rules), 0) * 10) / 10
        : null
    const std = isCurrent ? (args.ranks?.std ?? null) : null
    const ppr = isCurrent ? (args.ranks?.ppr ?? null) : null
    return {
      key: String(season),
      k1: String(season),
      k2: isCurrent ? (args.team ?? 'FA') : DASH,
      k2Tone: isCurrent ? 'plain' : 'none',
      cells: [
        plain(String(gm)),
        fpts !== null ? { value: fpts.toFixed(1), kind: std !== null ? rankTone(std) : 'plain' } : dash,
        rankCell(std),
        rankCell(ppr),
        ...boxCells(groups, done.length > 0 ? sums : undefined),
      ],
    }
  })
  return {
    k1Label: 'Year',
    k1Width: 40,
    k2Label: 'Team',
    groups: [{ label: 'Fantasy', cols: 2 }, { label: 'Position rank', cols: 2 }, ...groups.map(([label, c]) => ({ label, cols: c.length }))],
    cols,
    rows,
  }
}

// ---------------------------------------------------------------------------
// Depth chart (§2.9)
// ---------------------------------------------------------------------------

export interface DepthCell {
  first: string
  last: string
  /** His full name — what a tappable cell is called (#45). */
  name: string
  /** The profiled player — his last name is blue. */
  self: boolean
  playerId: string
}

export interface DepthRow {
  slot: string
  /** The slot's position for its text colour (QB / RB / WR / TE / K). */
  pos: string
  cells: Array<DepthCell | null>
}

/** Sleeper's depth-chart slots, in the prototype's row order: the three WR
 *  slots are the left / right / slot receiver (LWR / RWR / SWR). */
const DEPTH_SLOTS: Array<{ slot: string; pos: string; match: (p: DepthChartPlayer) => boolean }> = [
  { slot: 'QB', pos: 'QB', match: (p) => p.position === 'QB' && p.depth_chart_position === 'QB' },
  { slot: 'RB', pos: 'RB', match: (p) => p.position === 'RB' && p.depth_chart_position === 'RB' },
  { slot: 'WR1', pos: 'WR', match: (p) => p.position === 'WR' && p.depth_chart_position === 'LWR' },
  { slot: 'WR2', pos: 'WR', match: (p) => p.position === 'WR' && p.depth_chart_position === 'RWR' },
  { slot: 'WR3', pos: 'WR', match: (p) => p.position === 'WR' && p.depth_chart_position === 'SWR' },
  { slot: 'TE', pos: 'TE', match: (p) => p.position === 'TE' && p.depth_chart_position === 'TE' },
  { slot: 'K', pos: 'K', match: (p) => p.position === 'K' && (p.depth_chart_position === 'K' || p.depth_chart_position === 'PK') },
]

function splitName(p: DepthChartPlayer): { first: string; last: string } {
  if (p.first_name && p.last_name) return { first: p.first_name, last: p.last_name }
  const i = p.full_name.indexOf(' ')
  return i > 0 ? { first: p.full_name.slice(0, i), last: p.full_name.slice(i + 1) } : { first: '', last: p.full_name }
}

/**
 * Rows QB · RB · WR1–3 · TE · K, up to three deep, ordered by the stored
 * depth order. A feed that files receivers under a plain "WR" (no
 * left/right/slot) gets one WR row instead. Slots nobody fills are omitted.
 * Line 1 is "First · age" (age from the birth date — one source).
 */
export function depthChart(players: readonly DepthChartPlayer[], selfId: string, today: Date): DepthRow[] {
  const byOrder = [...players].sort((a, b) => (a.depth_chart_order ?? 99) - (b.depth_chart_order ?? 99))
  const slots = [...DEPTH_SLOTS]
  if (!byOrder.some((p) => p.position === 'WR' && ['LWR', 'RWR', 'SWR'].includes(p.depth_chart_position ?? ''))) {
    slots.splice(2, 3, { slot: 'WR', pos: 'WR', match: (p) => p.position === 'WR' && p.depth_chart_position === 'WR' })
  }
  const rows: DepthRow[] = []
  for (const s of slots) {
    const list = byOrder.filter(s.match).slice(0, 3)
    if (list.length === 0) continue
    rows.push({
      slot: s.slot,
      pos: s.pos,
      cells: [0, 1, 2].map((j) => {
        const p = list[j]
        if (!p) return null
        const { first, last } = splitName(p)
        const age = formatAge(p.birth_date, today)
        return { first: age ? `${first} · ${age}` : first, last, name: p.full_name, self: p.id === selfId, playerId: p.id }
      }),
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Moves (Transactions tab §2.8, History §2.10)
// ---------------------------------------------------------------------------

export type MoveKind = 'Added' | 'Dropped' | 'Drafted' | 'Traded'

export interface ProfileMove {
  id: string
  kind: MoveKind
  /** "by " / "to " — then the manager (a username link) or the team. */
  lead: string
  username: string | null
  team: string | null
  /** " · free agent", " · waiver $11", " in round 6", " for $59" … */
  detail: string
  at: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const idOf = (side: unknown): string | null => (isObj(side) && typeof side.player_id === 'string' ? side.player_id : null)

/** The moves that name this player in one league: adds and drops (113's
 *  `add` / `drop` objects or a claim's bare `add_player_id`), trades (the
 *  executed trade's `players` legs) and his draft pick. Newest first. */
export function playerMoves(args: {
  playerId: string
  items: readonly ActivityItem[]
  picks: readonly DraftPickSummary[]
  teams: LeagueDetail['teams']
  members: LeagueDetail['members']
}): ProfileMove[] {
  const who = (teamId: string | null) => ({
    username: teamId ? (args.members.find((m) => m.team_id === teamId)?.profiles?.username ?? null) : null,
    team: teamId ? (args.teams.find((t) => t.id === teamId)?.name ?? null) : null,
  })
  const out: ProfileMove[] = []
  for (const item of args.items) {
    if (item.kind !== 'transaction' || item.status !== 'complete' || !isObj(item.payload)) continue
    const p = item.payload
    const addId = idOf(p.add) ?? (typeof p.add_player_id === 'string' ? p.add_player_id : null)
    const dropId = idOf(p.drop) ?? (typeof p.drop_player_id === 'string' ? p.drop_player_id : null)
    const how =
      item.type === 'waiver_claim'
        ? ` · waiver${typeof p.faab_bid === 'number' && typeof p.faab_before === 'number' ? ` $${p.faab_bid}` : ''}`
        : item.type === 'commissioner_move'
          ? ' · commissioner'
          : ' · free agent'
    if (addId === args.playerId) {
      out.push({ id: `${item.id}:add`, kind: 'Added', lead: 'by ', ...who(item.team_id), detail: how, at: item.created_at })
    }
    if (dropId === args.playerId) {
      out.push({
        id: `${item.id}:drop`,
        kind: 'Dropped',
        lead: 'by ',
        ...who(item.team_id),
        detail: item.type === 'commissioner_move' ? ' · commissioner' : '',
        at: item.created_at,
      })
    }
    if (item.type === 'trade' && Array.isArray(p.players)) {
      for (const leg of p.players) {
        if (!isObj(leg) || leg.player_id !== args.playerId) continue
        const to = typeof leg.to_team_id === 'string' ? leg.to_team_id : null
        out.push({ id: `${item.id}:trade`, kind: 'Traded', lead: 'to ', ...who(to), detail: ' · trade', at: item.created_at })
      }
    }
  }
  const pick = args.picks.find((x) => x.player_id === args.playerId && !x.is_undone)
  if (pick) {
    const detail = pick.price != null ? ` for $${pick.price}` : pick.round != null ? ` in round ${pick.round}` : ''
    out.push({ id: `pick:${pick.pick_number}`, kind: 'Drafted', lead: 'by ', ...who(pick.team_id), detail, at: pick.created_at })
  }
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
}

/** A move on the Transactions timeline: which league it happened in. */
export interface TimelineMove extends ProfileMove {
  /** Unique across leagues (a move id is unique within its league only). */
  key: string
  leagueId: string
  leagueName: string
}

/**
 * Profile › Transactions as ONE timeline (Chris, #46, 2026-10-15): every
 * league's moves of him merged, newest first, each naming its league — no
 * per-league grouping. A move with no instant sorts last; ties keep league
 * order, then each league's own (newest-first) order.
 */
export function movesTimeline(perLeague: ReadonlyArray<{ leagueId: string; leagueName: string; moves: readonly ProfileMove[] }>): TimelineMove[] {
  const all = perLeague.flatMap((l) => l.moves.map((m): TimelineMove => ({ ...m, key: `${l.leagueId}:${m.id}`, leagueId: l.leagueId, leagueName: l.leagueName })))
  // Instants, not strings: two feeds may print the same moment differently.
  const when = (m: TimelineMove) => {
    const t = m.at ? Date.parse(m.at) : Number.NaN
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
  }
  // Array.prototype.sort is stable: equal instants keep the order above.
  return all.sort((x, y) => {
    const a = when(x)
    const b = when(y)
    return a === b ? 0 : b > a ? 1 : -1
  })
}

/** "Oct 11" in the viewer's own time. */
export function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d)
}

// ---------------------------------------------------------------------------
// Leagues (§2.5a ownership row, §2.7)
// ---------------------------------------------------------------------------

/** League statuses before any roster exists (the draft has not run). */
export function isPreDraft(status: string): boolean {
  return status === 'setup' || status === 'scheduled'
}

/** A league row reads "Pre-draft" (its door is the draft queue) before the
 *  draft, and during a live draft while he has not been picked. */
export function preDraftFor(status: string, rostered: boolean): boolean {
  return isPreDraft(status) || (status === 'drafting' && !rostered)
}

/** A league whose roster moves are open (in season / playoffs). */
export function movesOpenStatus(status: string): boolean {
  return status === 'in_season' || status === 'playoffs'
}

/**
 * Where he stands in one of the viewer's leagues, for the ownership row's
 * summary (§2.5a; Chris, #44, 2026-10-15):
 *   - `pre_draft`   — the league has not drafted (setup / scheduled), or its
 *                     draft is live and he has not been picked yet;
 *   - `rostered`    — on a team's roster (anyone's, the viewer's included);
 *   - `available`   — unrostered where roster moves are open (in season /
 *                     playoffs) and the viewer has a team to add him to;
 *   - `no_team`     — unrostered where moves are open but the viewer has no
 *                     team there;
 *   - `season_over` — unrostered in a finished league.
 * `rostered` is null when the rosters were not read — only a league that has
 * not drafted needs no read (`ownershipNeedsRosters`).
 */
export type LeagueOwnership = 'pre_draft' | 'rostered' | 'available' | 'no_team' | 'season_over'

/** A league whose rosters say whether he is on one (it has drafted, or its
 *  draft is under way). */
export function ownershipNeedsRosters(status: string): boolean {
  return !isPreDraft(status)
}

export function leagueOwnership(status: string, myTeamId: string | null, rostered: boolean | null): LeagueOwnership {
  if (isPreDraft(status)) return 'pre_draft'
  if (rostered) return 'rostered'
  if (status === 'drafting') return 'pre_draft'
  if (movesOpenStatus(status)) return myTeamId ? 'available' : 'no_team'
  return 'season_over'
}

const leagues = (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}`

/**
 * The ownership row's summary across every league (#44 — never the unclear
 * "Not available"):
 *   - any league still being read → "Checking…"; a failed read → says so;
 *   - available anywhere → "Available in N leagues" (what he can act on);
 *   - rostered everywhere → "Rostered in all your leagues";
 *   - no league has drafted → "Pre-draft";
 *   - otherwise each kind with its count: "Rostered in 2 · Pre-draft in 1".
 */
export function ownershipSummary(states: ReadonlyArray<LeagueOwnership | 'loading' | 'error'>): string {
  if (states.some((s) => s === 'loading')) return 'Checking…'
  if (states.some((s) => s === 'error')) return 'Couldn’t check every league'
  const count = (k: LeagueOwnership) => states.filter((s) => s === k).length
  const available = count('available')
  if (available > 0) return `Available in ${leagues(available)}`
  const total = states.length
  if (total === 0) return ''
  const rostered = count('rostered')
  const preDraft = count('pre_draft')
  const seasonOver = count('season_over')
  const noTeam = count('no_team')
  if (rostered === total) return 'Rostered in all your leagues'
  if (preDraft === total) return 'Pre-draft'
  if (seasonOver === total) return 'Season over'
  if (noTeam === total) return 'No team in your leagues'
  return [
    rostered > 0 ? `Rostered in ${rostered}` : null,
    preDraft > 0 ? `Pre-draft in ${preDraft}` : null,
    seasonOver > 0 ? `Season over in ${seasonOver}` : null,
    noTeam > 0 ? `No team in ${noTeam}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** "clears Wed" — the weekday his waiver period ends, in the viewer's time. */
export function clearsDay(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `clears ${new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)}`
}
