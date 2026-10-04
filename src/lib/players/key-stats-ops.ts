/**
 * The player view's position-specific Key stats (D486(14), Chris 2026-10-04:
 * "I think there are other stats that would help that are not present…").
 *
 * Every value is STORED (a `player_stats` box total, a `player_usage` rate)
 * or DERIVED from stored fields by a pinned formula (comp %, yds / target,
 * carries / game, passer rating, FG %). Anything else is omitted — never
 * invented. Totals and per-game values cover his completed games (the
 * average's games, D486(11)/R1506). No completed games → no tiles at all.
 *
 * Not stored anywhere today (filed, F578): snap COUNT, red-zone attempts /
 * targets, routes run, 40 time, FG long.
 */
import type { BoxTotals } from './core-stats-ops'

export interface KeyStatTile {
  key: string
  label: string
  value: string
}

export interface KeyStatsInput {
  games: number
  totals: BoxTotals
  usage: { snap_pct: number | null; target_share: number | null } | null
}

const one = (n: number) => n.toFixed(1)
const int = (n: number) => String(Math.round(n))

/** Completion % = completions ÷ attempts × 100. Null without attempts. */
export function completionPct(cmp: number | undefined, att: number | undefined): number | null {
  if (cmp === undefined || att === undefined || att <= 0) return null
  return (cmp / att) * 100
}

/** Yards per target = receiving yards ÷ targets. Null without targets. */
export function yardsPerTarget(yds: number | undefined, tgt: number | undefined): number | null {
  if (yds === undefined || tgt === undefined || tgt <= 0) return null
  return yds / tgt
}

/** A season total ÷ completed games. Null with no games or no total. */
export function perGame(total: number | undefined, games: number): number | null {
  if (total === undefined || games <= 0) return null
  return total / games
}

/**
 * The NFL passer rating: four components, each clamped to [0, 2.375],
 *   a = (cmp/att − 0.3) × 5,  b = (yds/att − 3) × 0.25,
 *   c = (td/att) × 20,        d = 2.375 − (int/att × 25),
 * rating = (a + b + c + d) ÷ 6 × 100 (0 – 158.3). Null without attempts or
 * with any of the five inputs missing.
 */
export function passerRating(t: BoxTotals): number | null {
  const { pass_attempts: att, pass_completions: cmp, pass_yards: yds, pass_tds: td, interceptions: ints } = t
  if (att === undefined || cmp === undefined || yds === undefined || td === undefined || ints === undefined || att <= 0) {
    return null
  }
  const clamp = (v: number) => Math.min(2.375, Math.max(0, v))
  const a = clamp((cmp / att - 0.3) * 5)
  const b = clamp((yds / att - 3) * 0.25)
  const c = clamp((td / att) * 20)
  const d = clamp(2.375 - (ints / att) * 25)
  return ((a + b + c + d) / 6) * 100
}

type Def = { key: string; label: string; value: (i: KeyStatsInput) => string | null }

const total = (k: keyof BoxTotals): ((i: KeyStatsInput) => string | null) => (i) =>
  i.totals[k] === undefined ? null : int(i.totals[k]!)
const fmt = (n: number | null, f: (n: number) => string) => (n === null ? null : f(n))

const SNAP: Def = { key: 'snap_pct', label: 'Snap %', value: (i) => fmt(i.usage?.snap_pct ?? null, (n) => `${one(n)}%`) }
const TARGETS: Def = { key: 'targets', label: 'Targets', value: total('targets') }
const RECEPTIONS: Def = { key: 'receptions', label: 'Receptions', value: total('receptions') }
const REC_YDS: Def = { key: 'rec_yds', label: 'Rec yds', value: total('receiving_yards') }
const REC_TD: Def = { key: 'rec_td', label: 'Rec TD', value: total('receiving_tds') }
const RUSH_YDS: Def = { key: 'rush_yds', label: 'Rush yds', value: total('rush_yards') }
const RUSH_TD: Def = { key: 'rush_td', label: 'Rush TD', value: total('rush_tds') }

/** Default tiles + the rest (into Full stats), per position. */
const BY_POSITION: Record<string, { primary: Def[]; more: Def[] }> = {
  RB: {
    primary: [
      SNAP,
      { key: 'carries_pg', label: 'Carries / gm', value: (i) => fmt(perGame(i.totals.rush_attempts, i.games), one) },
      RUSH_YDS,
      RUSH_TD,
      TARGETS,
      RECEPTIONS,
    ],
    more: [REC_YDS, REC_TD],
  },
  WR: {
    primary: [
      TARGETS,
      // player_usage.target_share = his targets ÷ his team's pass attempts
      // (the sync's definition) — labelled as exactly that.
      { key: 'target_share', label: 'Tgt share (team att)', value: (i) => fmt(i.usage?.target_share ?? null, (n) => `${one(n)}%`) },
      RECEPTIONS,
      REC_YDS,
      { key: 'ypt', label: 'Yds / target', value: (i) => fmt(yardsPerTarget(i.totals.receiving_yards, i.totals.targets), one) },
      REC_TD,
    ],
    more: [SNAP],
  },
  QB: {
    primary: [
      { key: 'comp_pct', label: 'Comp %', value: (i) => fmt(completionPct(i.totals.pass_completions, i.totals.pass_attempts), (n) => `${one(n)}%`) },
      { key: 'pass_yds', label: 'Pass yds', value: total('pass_yards') },
      { key: 'pass_td', label: 'Pass TD', value: total('pass_tds') },
      { key: 'int', label: 'INT', value: total('interceptions') },
      RUSH_YDS,
      RUSH_TD,
    ],
    more: [
      { key: 'att', label: 'Attempts', value: total('pass_attempts') },
      { key: 'rating', label: 'Passer rating', value: (i) => fmt(passerRating(i.totals), one) },
    ],
  },
  K: {
    primary: [
      {
        key: 'fg',
        label: 'FG made / att',
        value: (i) =>
          i.totals.fg_made === undefined || i.totals.fg_attempted === undefined ? null : `${int(i.totals.fg_made)}/${int(i.totals.fg_attempted)}`,
      },
      { key: 'fg_pct', label: 'FG %', value: (i) => fmt(completionPct(i.totals.fg_made, i.totals.fg_attempted), (n) => `${one(n)}%`) },
      { key: 'fg_40', label: 'FG 40+', value: total('fg_made_40_plus') },
      { key: 'fg_50', label: 'FG 50+', value: total('fg_made_50_plus') },
      {
        key: 'xp',
        label: 'XP made / att',
        value: (i) =>
          i.totals.xp_made === undefined || i.totals.xp_attempted === undefined ? null : `${int(i.totals.xp_made)}/${int(i.totals.xp_attempted)}`,
      },
    ],
    more: [],
  },
  DEF: {
    primary: [
      { key: 'sacks', label: 'Sacks', value: total('def_sacks') },
      { key: 'def_int', label: 'INT', value: total('def_interceptions') },
      { key: 'fum_rec', label: 'Fum rec', value: total('def_fumble_recoveries') },
      { key: 'def_td', label: 'Def TD', value: total('def_tds') },
      { key: 'pa_pg', label: 'Pts allowed / gm', value: (i) => fmt(perGame(i.totals.def_points_allowed, i.games), one) },
      { key: 'ya_pg', label: 'Yds allowed / gm', value: (i) => fmt(perGame(i.totals.def_yards_allowed, i.games), one) },
    ],
    more: [],
  },
}
BY_POSITION.TE = BY_POSITION.WR
BY_POSITION.DST = BY_POSITION.DEF

function build(defs: Def[], input: KeyStatsInput): KeyStatTile[] {
  const out: KeyStatTile[] = []
  for (const d of defs) {
    const v = d.value(input)
    if (v !== null) out.push({ key: d.key, label: d.label, value: v })
  }
  return out
}

/** The default tiles and the Full-stats extras for his position. No
 *  completed games (or an unknown position) → both empty. */
export function keyStats(position: string, input: KeyStatsInput | null): { primary: KeyStatTile[]; more: KeyStatTile[] } {
  const spec = BY_POSITION[position.toUpperCase()]
  if (!spec || !input || input.games <= 0) return { primary: [], more: [] }
  return { primary: build(spec.primary, input), more: build(spec.more, input) }
}
