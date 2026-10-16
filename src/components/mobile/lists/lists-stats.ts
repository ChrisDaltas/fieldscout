import { STAT_CATALOG, type StatDef } from '@/components/lists/v2/list-stats'
import type { FrameTotals, ListScoring, PlayerFrames, TimeFrame } from '@/hooks/use-mobile-lists-timeframe-stats'
import type { ListUsage } from '@/hooks/use-mobile-lists-usage'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { ASSUMED_TOTAL_GAMES, CURRENT_SEASON, LAST_SEASON } from '@/lib/stats/aggregate-fantasy'

/**
 * FieldScout Mobile — Lists stat columns (lr-lists §2.5, §5).
 *
 * The design's "Add stats" catalogue, limited to the stats the app holds data
 * for. Four sources:
 *
 * - the app's own list stats (`STAT_CATALOG` — ADP, Cost PPR, Proj, season
 *   points, Bye, SOS), keyed by the same ids, so a column chosen on desktop
 *   shows here and the reverse (the chosen ids live in the shared, session-only
 *   `list-display-store`, D3);
 * - the design's time-frame stats over weekly `player_stats` (Pts, Avg pts,
 *   targets, receptions, yards, passing) — `use-mobile-lists-timeframe-stats`;
 * - season usage from `player_usage` (Snap %, Tgt share) —
 *   `use-mobile-lists-usage`;
 * - Pos rk, the player's rank at his position by season points (the editor's
 *   "QB3" rule) over the Add players pool — `use-mobile-lists-pool`.
 *
 * Left out, with no data source in the app (lr-lists gap list): ECR and Scout
 * AI (no expert or AI rankings are stored), Users (the consensus view is
 * behind the off `consensus` flag), Route % and Rush share (`player_usage`
 * holds snaps and target share only), and YAC, aDOT, YPRR, YCO/att and RYOE
 * (`player_stats.advanced` is empty).
 *
 * ## Scoring (Chris, 2026-10-15, gap list #19)
 *
 * Every points value follows the list's session scoring — PPR, Half PPR,
 * Quarter PPR or Standard — and so does Pos rk (a rank by season points).
 * In PPR the app's own columns (Proj, 2026 pts, 2025 pts) keep the list
 * payload's server values, as before. In any other scoring they are worked
 * out from the weekly rows instead (`altSource: 'frames'`), with the same
 * rules the server uses for PPR: season points from the games played, and a
 * projection that is the season's pace over 17 games once he has played,
 * else the stored pre-season projection for that scoring (Quarter PPR, which
 * has no stored column, is the midpoint of Standard and Half PPR — exact,
 * since the scorings differ only by the value of a catch).
 */

export type StatGroup = 'Rankings' | 'Fantasy' | 'Usage' | 'Receiving' | 'Rushing' | 'Passing' | 'Draft' | 'Schedule'

/** Where a column's values come from (each is its own read). */
export type StatSource = 'app' | 'frames' | 'usage' | 'ranks'

export interface ValueCtx {
  frames: PlayerFrames | undefined
  tf: TimeFrame
  /** The scoring points follow; PPR when not given. */
  scoring?: ListScoring
  usage: ListUsage | undefined
  /** Position rank by season points; `null` = unranked (no games yet). */
  posRank: number | null | undefined
  /** Which reads have arrived. A cell whose read is loading or failed is
   *  blank, never "–" (that would claim "no value"). */
  ready: Readonly<Record<Exclude<StatSource, 'app'>, boolean>>
}

export interface MStat {
  id: string
  /** Column header. */
  label: string
  /** Chip in the Add stats sheet and the editor. */
  chip: string
  group: StatGroup
  source: StatSource
  /** The read it needs instead when the scoring isn't PPR (the list
   *  payload's own points are PPR). */
  altSource?: Exclude<StatSource, 'app'>
  /** Its value is fantasy points (or a rank by them), so it follows the
   *  scoring. */
  scored?: boolean
  /** Its value changes with Week N / Last 3 / Season. */
  timeframe: boolean
  value: (entry: ListPlayerWithPlayer, ctx: ValueCtx) => string
}

/** The design's not-applicable value (en dash, U+2013). */
export const DASH = '–'

function fromApp(def: StatDef, chip: string, group: StatGroup): MStat {
  return {
    id: def.id,
    label: def.label,
    chip,
    group,
    source: 'app',
    timeframe: false,
    value: (entry) => {
      const raw = def.value(entry)
      return raw == null || !Number.isFinite(raw) ? DASH : def.format(raw)
    },
  }
}

const APP = new Map(STAT_CATALOG.map((def) => [def.id as string, def]))
function app(id: string, chip: string, group: StatGroup): MStat {
  const def = APP.get(id)
  if (!def) throw new Error(`Unknown list stat ${id}`)
  return fromApp(def, chip, group)
}

const oneDecimal = (value: number) => value.toFixed(1)
const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * An app column whose value is points: the list payload's PPR value in PPR,
 * else `other` (worked out from the weekly rows, blank until they land).
 */
function scoredApp(
  id: string,
  chip: string,
  other: (entry: ListPlayerWithPlayer, ctx: ValueCtx, scoring: Exclude<ListScoring, 'ppr'>) => number | null | undefined,
): MStat {
  const base = app(id, chip, 'Fantasy')
  return {
    ...base,
    altSource: 'frames',
    scored: true,
    value: (entry, ctx) => {
      const scoring = ctx.scoring ?? 'ppr'
      if (scoring === 'ppr') return base.value(entry, ctx)
      if (!ctx.ready.frames) return ''
      const raw = other(entry, ctx, scoring)
      // `undefined` = that read hasn't arrived (blank, never "–").
      if (raw === undefined) return ''
      return raw == null || !Number.isFinite(raw) ? DASH : oneDecimal(raw)
    },
  }
}

/** A frame's points in the scoring (PPR when none is given). */
export function framePts(frame: FrameTotals, scoring: ListScoring | undefined): number {
  return frame.pts[scoring ?? 'ppr']
}

/**
 * The projection in a non-PPR scoring, by the server's PPR rule
 * (`aggregate-fantasy.ts`): once he has played this season, his pace over
 * 17 games; before that, the stored pre-season projection for the scoring.
 */
export function projectionIn(
  entry: ListPlayerWithPlayer,
  season: FrameTotals | null | undefined,
  scoring: Exclude<ListScoring, 'ppr'>,
): number | null {
  if (season && season.games > 0) {
    const pts = season.pts[scoring]
    return round1(pts + (pts / season.games) * Math.max(0, ASSUMED_TOTAL_GAMES - season.games))
  }
  const std = entry.player.projected_pts_standard ?? null
  const half = entry.player.projected_pts_half_ppr ?? null
  const stored = scoring === 'standard' ? std : scoring === 'half' ? half : std != null && half != null ? (std + half) / 2 : null
  return stored == null ? null : round1(stored)
}

/**
 * A player's season points and games in the scoring — the editor rows' Pts
 * and Avg. PPR is the list payload's value; any other scoring reads the
 * season frame (`undefined` until it lands).
 */
export function seasonLine(
  entry: ListPlayerWithPlayer,
  frames: PlayerFrames | undefined,
  framesReady: boolean,
  scoring: ListScoring,
): { pts: number; games: number } | undefined {
  if (scoring === 'ppr') return { pts: entry.stats?.current_pts ?? 0, games: entry.stats?.current_games ?? 0 }
  if (!framesReady) return undefined
  const season = frames?.season
  return season ? { pts: season.pts[scoring], games: season.games } : { pts: 0, games: 0 }
}

type FrameKey = keyof Omit<FrameTotals, 'games' | 'pts'>
const POS_STATS: Record<string, readonly string[]> = {
  QB: ['pyd', 'ptd', 'int', 'cmp', 'ratt', 'ryd'],
  RB: ['ratt', 'ryd', 'tgt', 'rec', 'recyd'],
  WR: ['tgt', 'rec', 'recyd', 'ratt', 'ryd'],
  TE: ['tgt', 'rec', 'recyd'],
}

function frameOf(ctx: ValueCtx): FrameTotals | null {
  return ctx.frames ? ctx.frames[ctx.tf] : null
}

function counting(id: string, label: string, group: StatGroup, key: FrameKey): MStat {
  return {
    id,
    label,
    chip: label,
    group,
    source: 'frames',
    timeframe: true,
    value: (entry, ctx) => {
      if (!(POS_STATS[entry.player.position ?? ''] ?? []).includes(id)) return DASH
      if (!ctx.ready.frames) return ''
      const frame = frameOf(ctx)
      return frame ? String(Math.round(frame[key])) : DASH
    },
  }
}

/** Who a usage column applies to (the design's `PG` table). */
const USAGE_POS: Record<'snap' | 'tshare', readonly string[]> = {
  snap: ['QB', 'RB', 'WR', 'TE'],
  tshare: ['RB', 'WR', 'TE'],
}

function usage(id: 'snap' | 'tshare', label: string): MStat {
  return {
    id,
    label,
    chip: label,
    group: 'Usage',
    source: 'usage',
    timeframe: false,
    value: (entry, ctx) => {
      if (!USAGE_POS[id].includes(entry.player.position ?? '')) return DASH
      if (!ctx.ready.usage) return ''
      const raw = ctx.usage?.[id]
      // Real shares can reach 100% (a QB's snaps), so no 99 cap (the design's
      // cap only bounds its seeded random values).
      return raw == null || !Number.isFinite(raw) ? DASH : `${Math.round(raw)}%`
    },
  }
}

export const MOBILE_STATS: readonly MStat[] = [
  {
    id: 'posrk',
    label: 'Pos rk',
    chip: 'Pos rk',
    group: 'Rankings',
    source: 'ranks',
    // Ranked by season points in the list's scoring (`useMobileListsPosRanks`).
    scored: true,
    timeframe: false,
    value: (_entry, ctx) => {
      if (!ctx.ready.ranks) return ''
      return ctx.posRank ? String(ctx.posRank) : DASH
    },
  },
  scoredApp('proj', 'Proj', (entry, ctx, scoring) => projectionIn(entry, ctx.frames?.season, scoring)),
  {
    id: 'pts',
    label: 'Pts',
    chip: 'Pts',
    group: 'Fantasy',
    source: 'frames',
    scored: true,
    timeframe: true,
    value: (_entry, ctx) => {
      if (!ctx.ready.frames) return ''
      const frame = frameOf(ctx)
      return frame ? framePts(frame, ctx.scoring).toFixed(1) : DASH
    },
  },
  {
    id: 'avg',
    label: 'Avg pts',
    chip: 'Avg pts',
    group: 'Fantasy',
    source: 'frames',
    scored: true,
    timeframe: false,
    value: (_entry, ctx) => {
      if (!ctx.ready.frames) return ''
      const season = ctx.frames?.season
      return season && season.games > 0 ? (framePts(season, ctx.scoring) / season.games).toFixed(1) : DASH
    },
  },
  // The payload's PPR value has no figure when its stats failed (`stats`
  // null → "–"); the other scorings say the same.
  scoredApp('current', `${CURRENT_SEASON} pts`, (entry, ctx, scoring) =>
    entry.stats == null ? null : (ctx.frames?.season?.pts[scoring] ?? 0),
  ),
  scoredApp('last', `${LAST_SEASON} pts`, (entry, ctx, scoring) => {
    if (entry.stats == null) return null
    const last = ctx.frames?.lastSeason
    return last === undefined ? undefined : (last?.pts[scoring] ?? 0)
  }),
  usage('snap', 'Snap %'),
  usage('tshare', 'Tgt share'),
  counting('tgt', 'Tgt', 'Receiving', 'targets'),
  counting('rec', 'Rec', 'Receiving', 'receptions'),
  counting('recyd', 'Rec yds', 'Receiving', 'receiving_yards'),
  counting('ratt', 'Rush att', 'Rushing', 'rush_attempts'),
  counting('ryd', 'Rush yds', 'Rushing', 'rush_yards'),
  counting('pyd', 'Pass yds', 'Passing', 'pass_yards'),
  counting('ptd', 'Pass TD', 'Passing', 'pass_tds'),
  {
    id: 'cmp',
    label: 'Cmp %',
    chip: 'Cmp %',
    group: 'Passing',
    source: 'frames',
    timeframe: true,
    value: (entry, ctx) => {
      if (entry.player.position !== 'QB') return DASH
      if (!ctx.ready.frames) return ''
      const frame = frameOf(ctx)
      if (!frame || frame.pass_attempts <= 0) return DASH
      return `${Math.round((frame.pass_completions / frame.pass_attempts) * 100)}%`
    },
  },
  counting('int', 'Int', 'Passing', 'interceptions'),
  // The app's own list stats the design lacks, after the design's groups.
  app('adp', 'ADP', 'Draft'),
  app('auction', 'Cost PPR', 'Draft'),
  app('bye', 'Bye', 'Schedule'),
  app('sos', 'SOS', 'Schedule'),
]

/** The design's six groups in its order, then the app's two. */
export const STAT_GROUPS: readonly StatGroup[] = [
  'Rankings',
  'Fantasy',
  'Usage',
  'Receiving',
  'Rushing',
  'Passing',
  'Draft',
  'Schedule',
]

const BY_ID = new Map(MOBILE_STATS.map((stat) => [stat.id, stat]))

/** The chosen ids this catalogue can render, in the chosen order. */
export function resolveMobileStats(ids: readonly string[]): MStat[] {
  return ids.map((id) => BY_ID.get(id)).filter((stat): stat is MStat => Boolean(stat))
}

/** The read a column needs in this scoring. */
export function statSource(stat: MStat, scoring: ListScoring = 'ppr'): StatSource {
  return scoring !== 'ppr' && stat.altSource ? stat.altSource : stat.source
}

/** Whether any chosen column reads `source` (in this scoring). */
export function needsSource(
  stats: readonly MStat[],
  source: Exclude<StatSource, 'app'>,
  scoring: ListScoring = 'ppr',
): boolean {
  return stats.some((stat) => statSource(stat, scoring) === source)
}

/** Whether the weekly read must take in last season too (2025 pts outside
 *  PPR, where the payload's own value is PPR). */
export function needsLastSeason(stats: readonly MStat[], scoring: ListScoring): boolean {
  return scoring !== 'ppr' && stats.some((stat) => stat.id === 'last')
}

/** Whether any chosen column shows points (so the scoring control matters). */
export function showsPoints(stats: readonly MStat[]): boolean {
  return stats.some((stat) => stat.scored)
}

// =============================================================================
// Scoring labels (gap list #19)
// =============================================================================

export const SCORING_OPTIONS: ReadonlyArray<{ value: ListScoring; label: string; sub: string }> = [
  { value: 'ppr', label: 'PPR', sub: '1 point per catch' },
  { value: 'half', label: 'Half PPR', sub: '0.5 points per catch' },
  { value: 'quarter', label: 'Quarter PPR', sub: '0.25 points per catch' },
  { value: 'standard', label: 'Standard', sub: 'No points for a catch' },
]

export function scoringLabel(scoring: ListScoring): string {
  return SCORING_OPTIONS.find((option) => option.value === scoring)?.label ?? 'PPR'
}

/** The cell colour rule (lr-lists §5): "–" t5, "+…" green, "-…" red, else t1. */
export function cellTextClass(value: string): string {
  if (value === DASH) return 'text-m-t5'
  if (value.startsWith('+')) return 'text-positive-strong'
  if (value.startsWith('-')) return 'text-negative-strong'
  return 'text-m-t1'
}

export const TIME_FRAMES: readonly TimeFrame[] = ['week', 'last3', 'season']

export function timeFrameLabel(tf: TimeFrame, latestWeek: number | null): string {
  if (tf === 'week') return latestWeek ? `Week ${latestWeek}` : 'Week'
  if (tf === 'last3') return 'Last 3'
  return 'Season'
}
