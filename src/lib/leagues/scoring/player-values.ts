/**
 * player-values — league-scored player values for autopilot (M6A task
 * L.E1.20; migration 137; PROGRESS Q62 (RULED 2026-09-27), F379 second
 * third, D374; discharges F385, F386(b) and F387's compute half; spec
 * §12.28 / §14's `league-player-values` row).
 *
 * Q62's three point keys, each "scored through the league's own scoring
 * settings" (Chris, 2026-09-27):
 *   (1) PROJECTED — THIS week's projected points (the `player_weekly_projections`
 *       line, L.E1.19);
 *   (2) SEASON    — season-to-date points (the player's `player_stats` rows
 *       for the season's weeks BEFORE the week being valued);
 *   (3) PRESEASON — the season line `players.projected_stats` (the docs
 *       session's READING of the preseason source, R1093 — flagged for this
 *       task's reviewer).
 * These are POINTS, not ranks: across positions the ruling compares
 * "total scored points", and within a position points order exactly as
 * positional rank does.
 *
 * THE ONE SCORER (D33 — never a second engine). Every value goes through
 * `scorePlayerWeek(resolveRules(snapshot, position), deriveTierIndicators(line,
 * cutsOf(snapshot)))` — the scoring worker's own composition, with the
 * league's FROZEN `scoring_rules_snapshot` (§7.3.3 — never the live
 * `scoring_systems` row; never-weaken). `src/lib/scoring/default.ts` (the
 * legacy research calculator, its own column-name namespace) is NOT used and
 * must never be: a value computed through it is a wrong value that looks
 * right (R1096).
 *
 *   * SEASON is literally the worker's `scoreStarter` per week — the stored
 *     per-player precision (§7.3.3 half-up, 2dp) summed and rounded once
 *     more for float noise, exactly as a team week is. Actual scoring is NOT
 *     touched by this module (no import it re-exports, no helper it changes).
 *   * PROJECTED / PRESEASON cannot reuse `scoreStarter` itself: its
 *     `deliveredLine` reads `player_stats` COLUMNS and treats an absent
 *     column as a delivered 0 (ingestion writes the whole surface, D303) —
 *     for a projection that would make a D/ST line with no points-allowed
 *     a SHUTOUT (`def_pa_0` hot). So a projected line is scoped to the
 *     position's scorable keys the same way (`POSITION_SCORABLE_KEYS` + the
 *     D/ST raw sources) WITHOUT the zero fill — an absent key stays on the
 *     calculator's pending path and contributes nothing.
 *
 * F386(b) — FRACTIONAL POINTS ALLOWED, projections only. Sleeper projects
 * `pts_allow` (and `yds_allow`) fractionally for most defenses, and
 * `deriveTierIndicators` withholds a non-integer source (R58/D58 — correct
 * for ACTUALS, which are integers; a fractional actual is corrupt data). For
 * a PROJECTION the value is an expectation, not a count, and the source says
 * which tier it means: every Sleeper DEF row carries its own one-hot
 * `pts_allow_*` / `yds_allow_*` indicator, and MEASURED 2026-09-27 over
 * weeks 1–6 (186 DEF rows, live endpoint) the indicator is the tier of
 * FLOOR(value) in 186 of 186 rows for both families (e.g. 20.75 → 14–20,
 * 21.25 → 21–27, 349.18 → 300–349), where round-half-up agrees in only 173
 * / 182. So a projected source value is FLOORED to an integer before the
 * one-hot (`floorProjectedTierSources`) — the source's own reading, applied
 * to the league's own tier table. This happens ONLY on the projected path;
 * `derive-stats.ts` and the worker are byte-untouched, so actual scores
 * cannot move (pinned: the worker's own suites + the fractional-actual cell
 * below).
 *
 * F386(a) — KEYS THE SOURCE CANNOT SUPPLY are NOT mapped here. The canonical
 * Sleeper map (`SLEEPER_STAT_KEY_MAP`, shared with the ACTUALS) carries no
 * spelling for `fg_0_39`, `fg_missed`, `def_yards_allowed`, `def_block`,
 * `def_return_td`, `return_td`, `fumble_recovery_td` — and the actuals have
 * the same gap (F10: the raw spellings are unevidenced). Extending the map
 * for projections only would make a projected and an actual line stop
 * matching key for key; extending it for actuals changes real scores. So
 * neither: those keys score as PENDING (contributing nothing) and every
 * value NAMES them (`*_unscored` — the applicable, non-zero rules keys this
 * source can never deliver), never a quiet under-count. F386(a) stays open
 * on F10's evidence.
 *
 * F385 — THE PRESEASON LINE IS IN THE LEGACY NAMESPACE (`xp_made`,
 * `def_sacks`, `fg_made_40_plus`, `two_point_conversions`, …, written by
 * `sleeperProjectionToStatRow`). It is TRANSLATED here, not re-stored:
 * each legacy key is a `player_stats` COLUMN name, and the STAT_KEYS
 * registry maps canonical key → column one-to-one, so the inverse of that
 * map is the translation (`xp_made` → `pat_made`, `def_sacks` →
 * `def_sack`, …; identity where key ≡ column). A legacy key with no
 * registry column (`two_point_conversions` — a SUM of the three canonical
 * 2-pt keys, which cannot be split) is untranslatable and its canonical
 * keys land in `preseason_unscored`. Re-storing the season line
 * canonically would buy only that 2-pt split and `pat_missed`: Sleeper's
 * SEASON endpoint carries no points-allowed at all (measured 2026-09-27),
 * so a D/ST preseason value has no tier family either way — named, not
 * guessed.
 *
 * F387 — FRESHNESS (compute half). A weekly line whose `fetched_at` is older
 * than PROJECTION_MAX_AGE_MS at the job's injected instant is treated as
 * ABSENT (`projected_missing = 'stale_line'` ⇒ the next fallback key), and
 * the line's `fetched_at` is persisted with the value so the READ at lock
 * (L.E1.21) can bound it again.
 *
 * NULL IS NOT ZERO. A player with no games this season has
 * `season_points = NULL` and `season_games = 0`; a player who played and
 * scored nothing has `0.00` and `season_games >= 1`. No line ⇒ NULL with a
 * named reason; a real projected 0.00 is a value.
 *
 * Pure: no IO, no clock (the instant is an argument — D3).
 */
import { SLEEPER_STAT_KEY_MAP } from '../stats/sleeper-stats-provider'
import { STAT_KEYS } from '../stats/stat-keys'
import { roundHalfUp, scorePlayerWeek } from './calculator'
import { DEF_PA_SOURCE_KEY, DEF_YA_SOURCE_KEY, deriveTierIndicators } from './derive-stats'
import { resolveRules, SCORING_POSITIONS, type ScoringPosition, type ScoringRulesDoc } from './rules-doc'
import { applicableKeys, cutsOf, scoreStarter, type StatLineRow } from './score-week-worker'
import { POSITION_SCORABLE_KEYS } from './validate-rules-doc'

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * F387's bound. The weekly sync runs hourly (136's `40 * * * *`) and rewrites
 * every line it still projects, so a healthy line is at most ~1 h old; six
 * consecutive missed runs is a dead sync, not a blip (a Sleeper hiccup, one
 * failed deploy). Past this a line is not trusted — the next key orders the
 * player instead. Inclusive: an age of EXACTLY the bound is still fresh.
 */
export const PROJECTION_MAX_AGE_MS = 6 * 60 * 60 * 1000

export type ProjectedMissing = 'no_line' | 'stale_line'
export type PreseasonMissing = 'no_line' | 'other_season'

const POSITION_SET: ReadonlySet<string> = new Set(SCORING_POSITIONS)
const DST_SOURCES: readonly string[] = [DEF_PA_SOURCE_KEY, DEF_YA_SOURCE_KEY]

// ── Source vocabularies (derived, never hand-listed) ───────────────────────

/** Canonical keys the WEEKLY line can ever carry: the image of the one
 *  Sleeper → canonical map (the line is written through it, D373(2)). */
export const WEEKLY_SOURCE_KEYS: ReadonlySet<string> = new Set(Object.values(SLEEPER_STAT_KEY_MAP))

/** `player_stats` column → canonical key, the inverse of the registry's
 *  column map. One-to-one (pinned by test), so the inverse is well defined. */
const KEY_BY_COLUMN: ReadonlyMap<string, string> = new Map(
  STAT_KEYS.filter((def) => def.storage === 'column' && def.column !== undefined).map((def) => [
    def.column as string,
    def.key,
  ]),
)

/**
 * The legacy keys `sleeperProjectionToStatRow` can write (sleeper.ts) — the
 * season line's whole vocabulary. Listed because the writer is a hand-coded
 * mapper, not a map; `player-values.test.ts` pins that it matches what the
 * mapper emits for a line carrying every field it reads.
 */
export const LEGACY_SEASON_LINE_KEYS: readonly string[] = [
  'pass_yards',
  'pass_tds',
  'interceptions',
  'rush_yards',
  'rush_tds',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'fumbles_lost',
  'two_point_conversions',
  'fg_made_40_plus',
  'fg_made_50_plus',
  'xp_made',
  'def_sacks',
  'def_interceptions',
  'def_fumble_recoveries',
  'def_tds',
  'def_safeties',
]

/** Canonical keys the PRESEASON line can ever carry after translation. */
export const PRESEASON_SOURCE_KEYS: ReadonlySet<string> = new Set(
  LEGACY_SEASON_LINE_KEYS.map((k) => KEY_BY_COLUMN.get(k)).filter((k): k is string => k !== undefined),
)

// ── Lines ──────────────────────────────────────────────────────────────────

function isScoringPosition(position: string): position is ScoringPosition {
  return POSITION_SET.has(position)
}

/**
 * F386(b): a FRACTIONAL D/ST tier source on a PROJECTED line is floored to
 * an integer — the tier Sleeper itself assigns (186/186 measured). An
 * integer, a non-number, or a non-finite value passes through untouched
 * (the derive's own guard then decides). Projections only — never called on
 * an actual line.
 */
export function floorProjectedTierSources(line: Record<string, number>): Record<string, number> {
  const out = { ...line }
  for (const key of DST_SOURCES) {
    const value = out[key]
    if (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)) {
      out[key] = Math.floor(value)
    }
  }
  return out
}

/**
 * A projected (canonical-keyed) line scoped to what a player of `position`
 * can deliver — the worker's `deliveredLine` scope (the position's scorable
 * keys; for a D/ST also the two raw tier sources) — WITHOUT its zero fill:
 * an absent key stays absent (pending, contributes nothing). Only finite
 * numbers survive. A position outside the six keeps nothing.
 */
export function scopedProjectedLine(stats: Readonly<Record<string, unknown>>, position: string): Record<string, number> {
  const scoped = isScoringPosition(position) ? POSITION_SCORABLE_KEYS[position] : []
  const keys = position === 'DST' ? [...scoped, ...DST_SOURCES] : scoped
  const out: Record<string, number> = {}
  for (const key of keys) {
    const value = stats[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** F385: the legacy season line → canonical keys (the registry's column map,
 *  inverted). Untranslatable legacy keys are returned by name. */
export function translateLegacySeasonLine(legacy: Readonly<Record<string, unknown>>): {
  line: Record<string, number>
  untranslated: string[]
} {
  const line: Record<string, number> = {}
  const untranslated: string[] = []
  for (const [legacyKey, value] of Object.entries(legacy)) {
    const key = KEY_BY_COLUMN.get(legacyKey)
    if (key === undefined) {
      untranslated.push(legacyKey)
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) line[key] = value
  }
  return { line, untranslated: untranslated.sort() }
}

// ── Scoring ────────────────────────────────────────────────────────────────

export interface ProjectedScore {
  /** `roundHalfUp` of the full-precision dot product (§7.3.3, 2dp). */
  points: number
  /** Applicable, non-zero rules keys the SOURCE can never deliver and the
   *  line did not — each one a known under-count, named (F386(a)). Sorted. */
  unscored: string[]
}

/**
 * Score a projected line under the league's snapshot — the worker's exact
 * composition (resolve per position, derive with the document's own tier
 * cuts, then the dot product). `sourceKeys` is the source's vocabulary: a
 * pending key INSIDE it is merely not projected (a zero), one OUTSIDE it is
 * a key the source cannot supply and is named.
 */
export function scoreProjectedLine(
  snapshot: ScoringRulesDoc,
  position: string,
  line: Readonly<Record<string, number>>,
  sourceKeys: ReadonlySet<string>,
): ProjectedScore {
  const rules = resolveRules(snapshot, position)
  const breakdown = scorePlayerWeek(rules, deriveTierIndicators({ ...line }, cutsOf(snapshot)))
  const applicable = applicableKeys(position)
  const unscored = breakdown.pending
    .filter((key) => applicable.has(key) && rules[key] !== 0 && !sourceKeys.has(key))
    .sort()
  return { points: breakdown.total, unscored }
}

/** THIS week's projected points from a canonical weekly line. */
export function scoreWeeklyProjection(
  snapshot: ScoringRulesDoc,
  position: string,
  stats: Readonly<Record<string, unknown>>,
): ProjectedScore {
  return scoreProjectedLine(snapshot, position, floorProjectedTierSources(scopedProjectedLine(stats, position)), WEEKLY_SOURCE_KEYS)
}

/** The preseason points from the LEGACY season line (translated, F385). */
export function scorePreseasonLine(
  snapshot: ScoringRulesDoc,
  position: string,
  legacy: Readonly<Record<string, unknown>>,
): ProjectedScore {
  const { line } = translateLegacySeasonLine(legacy)
  return scoreProjectedLine(snapshot, position, floorProjectedTierSources(scopedProjectedLine(line, position)), PRESEASON_SOURCE_KEYS)
}

/**
 * Season-to-date points: the worker's own `scoreStarter` per week (the
 * stored per-player precision), summed, the sum snapped once more for float
 * noise — exactly how a team week sums its starters. No row ⇒ NULL (no games
 * yet), never 0.
 */
export function seasonToDate(
  snapshot: ScoringRulesDoc,
  playerId: string,
  position: string,
  weeklyRows: readonly StatLineRow[],
): { points: number | null; games: number } {
  if (weeklyRows.length === 0) return { points: null, games: 0 }
  let sum = 0
  for (const row of weeklyRows) sum += scoreStarter(snapshot, playerId, position, row).points
  return { points: roundHalfUp(sum), games: weeklyRows.length }
}

/** F387: is a line fetched at `fetchedAt` still trusted at `now`? */
export function isFreshLine(fetchedAt: string, now: Date, maxAgeMs: number = PROJECTION_MAX_AGE_MS): boolean {
  const fetched = Date.parse(fetchedAt)
  if (!Number.isFinite(fetched)) return false
  return now.getTime() - fetched <= maxAgeMs
}

// ── One player's value row ─────────────────────────────────────────────────

export interface WeeklyLineInput {
  stats: Readonly<Record<string, unknown>>
  fetched_at: string
}

export interface PreseasonInput {
  projected_stats: unknown
  projections_season: number | null
  /** Did the source project him at all (any `projected_pts_*` non-null)? The
   *  legacy line omits zeros, so `{}` alone cannot tell "projected 0" from
   *  "not projected" — the source's own point totals are the presence
   *  signal, and are read for NOTHING else. */
  projected: boolean
}

export interface PlayerValueInput {
  player_id: string
  /** `players.position` normalized (`DEF` → `DST`). */
  position: string
  weekly: WeeklyLineInput | null
  /** His `player_stats` rows for the season's weeks BEFORE `week`. */
  seasonRows: readonly StatLineRow[]
  preseason: PreseasonInput | null
}

export interface PlayerValueRow {
  league_id: string
  season: number
  week: number
  player_id: string
  projected_points: number | null
  projected_missing: ProjectedMissing | null
  projected_unscored: string[] | null
  projection_fetched_at: string | null
  season_points: number | null
  season_games: number
  preseason_points: number | null
  preseason_missing: PreseasonMissing | null
  preseason_unscored: string[] | null
  computed_at: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function computePlayerValue(
  snapshot: ScoringRulesDoc,
  ctx: { league_id: string; season: number; week: number; now: Date },
  input: PlayerValueInput,
): PlayerValueRow {
  // (1) THIS week's projection.
  let projected_points: number | null = null
  let projected_missing: ProjectedMissing | null = 'no_line'
  let projected_unscored: string[] | null = null
  let projection_fetched_at: string | null = null
  if (input.weekly !== null) {
    projection_fetched_at = input.weekly.fetched_at
    if (isFreshLine(input.weekly.fetched_at, ctx.now)) {
      const scored = scoreWeeklyProjection(snapshot, input.position, input.weekly.stats)
      projected_points = scored.points
      projected_unscored = scored.unscored
      projected_missing = null
    } else {
      projected_missing = 'stale_line'
    }
  }

  // (2) Season to date (weeks before this one).
  const season = seasonToDate(snapshot, input.player_id, input.position, input.seasonRows)

  // (3) Preseason — the season line, for THIS season only.
  let preseason_points: number | null = null
  let preseason_missing: PreseasonMissing | null = 'no_line'
  let preseason_unscored: string[] | null = null
  const pre = input.preseason
  if (pre !== null && pre.projected && isPlainObject(pre.projected_stats)) {
    if (pre.projections_season !== ctx.season) {
      preseason_missing = 'other_season'
    } else {
      const scored = scorePreseasonLine(snapshot, input.position, pre.projected_stats)
      preseason_points = scored.points
      preseason_unscored = scored.unscored
      preseason_missing = null
    }
  }

  return {
    league_id: ctx.league_id,
    season: ctx.season,
    week: ctx.week,
    player_id: input.player_id,
    projected_points,
    projected_missing,
    projected_unscored,
    projection_fetched_at,
    season_points: season.points,
    season_games: season.games,
    preseason_points,
    preseason_missing,
    preseason_unscored,
    computed_at: ctx.now.toISOString(),
  }
}
