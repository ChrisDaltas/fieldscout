import { STAT_CATALOG, type StatDef } from '@/components/lists/v2/list-stats'
import type { FrameTotals, PlayerFrames, TimeFrame } from '@/hooks/use-mobile-lists-timeframe-stats'
import type { ListUsage } from '@/hooks/use-mobile-lists-usage'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { CURRENT_SEASON, LAST_SEASON } from '@/lib/stats/aggregate-fantasy'

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
 */

export type StatGroup = 'Rankings' | 'Fantasy' | 'Usage' | 'Receiving' | 'Rushing' | 'Passing' | 'Draft' | 'Schedule'

/** Where a column's values come from (each is its own read). */
export type StatSource = 'app' | 'frames' | 'usage' | 'ranks'

export interface ValueCtx {
  frames: PlayerFrames | undefined
  tf: TimeFrame
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
    timeframe: false,
    value: (_entry, ctx) => {
      if (!ctx.ready.ranks) return ''
      return ctx.posRank ? String(ctx.posRank) : DASH
    },
  },
  app('proj', 'Proj', 'Fantasy'),
  {
    id: 'pts',
    label: 'Pts',
    chip: 'Pts',
    group: 'Fantasy',
    source: 'frames',
    timeframe: true,
    value: (_entry, ctx) => {
      if (!ctx.ready.frames) return ''
      const frame = frameOf(ctx)
      return frame ? frame.pts.toFixed(1) : DASH
    },
  },
  {
    id: 'avg',
    label: 'Avg pts',
    chip: 'Avg pts',
    group: 'Fantasy',
    source: 'frames',
    timeframe: false,
    value: (_entry, ctx) => {
      if (!ctx.ready.frames) return ''
      const season = ctx.frames?.season
      return season && season.games > 0 ? (season.pts / season.games).toFixed(1) : DASH
    },
  },
  app('current', `${CURRENT_SEASON} pts`, 'Fantasy'),
  app('last', `${LAST_SEASON} pts`, 'Fantasy'),
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

/** Whether any chosen column reads `source`. */
export function needsSource(stats: readonly MStat[], source: Exclude<StatSource, 'app'>): boolean {
  return stats.some((stat) => stat.source === source)
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
