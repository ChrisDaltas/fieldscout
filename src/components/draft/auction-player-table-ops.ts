/**
 * Auction player table — pure ops (M3 task L.C3.3; spec §16.2
 * `auction-player-table.tsx`, §16.4's v2.10 player-table callout — *the
 * column/filter/action list is the contract* — §12.24, §16.5.4; tasks-M3
 * C43/D139/D140; PROGRESS D194).
 *
 * Everything in this file is a pure function over data the room already
 * holds. Nothing here decides anything: the derived columns are
 * DISPLAY-ONLY mirrors, exactly as `auction-budget.ts` is for money, and
 * the L.C2.1 lesson applies verbatim — no route, hook, or component may
 * gate a submit on a number computed here. A nomination is admitted or
 * refused by `draft_nominate` (085) and by nothing else.
 *
 * Three things it owns, each pinned by a golden in the sibling test:
 *
 *  1. **The derived columns** — $-per-projected-point and projected
 *     points/week — as stored-literal goldens with their boundary
 *     instants (a zero-point player, a priceless player, the ÷-weeks
 *     rounding). Both are one-line formulas; both have a WRONG answer
 *     that looks plausible (multiply instead of divide, ÷ games instead
 *     of ÷ weeks), which is why they are pinned rather than inlined.
 *  2. **The scoring-family mapping** — which of `players`' three season
 *     point columns feeds "Projected Total Points" (and therefore the
 *     $-per-point ratio) — read from the LEAGUE'S OWN scoring rules
 *     (§7.3.3's `leagues.scoring_rules_snapshot`, the frozen copy),
 *     never from an app-wide default.
 *  3. **The C43 gate** — which of §16.4's nine Rushing/Receiving/Passing
 *     split columns may render at all, decided by what the projections
 *     blob actually CARRIES rather than by a flag someone has to
 *     remember to flip.
 *
 * ## The C43 gate, stated (read this before touching SPLIT_GROUPS)
 *
 * §16.4 names three split groups, each a triple: Rushing Att-Yds-TDs ·
 * Receiving Tgt-Yds-TDs · Passing Att-Yds-TDs. C43 (RULED
 * 2026-08-16) routes the missing data to a standalone projections-sync
 * task running in PARALLEL with the M3 build, and requires that the group
 * stay gated until it lands — *"No fake/empty columns ever ship"*.
 *
 * The gate is therefore a DATA gate, not a constant: a group renders iff
 * the loaded pool carries **every** key in that group. That is the
 * banner's own wording ("they render only when the projections blob
 * carries the keys") and it means the columns light up by themselves the
 * moment the sync extension lands — nobody has to ship a second PR to
 * flip a boolean.
 *
 * **The group is the unit, deliberately.** `sleeperProjectionToStatRow`
 * (`src/lib/sports-data/sleeper.ts:157`) already writes YARDS and TDS for
 * all three phases (`rush_yards`, `rush_tds`, `pass_yards`, `pass_tds`,
 * `receiving_yards`, `receiving_tds`, plus `receptions`) — measured on the
 * local pool, 590 blobs, 17 distinct keys, none of them a volume field.
 * What is missing everywhere is exactly the VOLUME column of each triple:
 * `rush_attempts`, `targets`, `pass_attempts`. A per-COLUMN gate would
 * therefore light up two-thirds of each group today and ship "Rushing"
 * without carries — a half-group is the fake column C43 forbids, and it
 * is not the shipping outcome C43 describes. So the triple lights up
 * together or not at all.
 *
 * *(C43's own evidence line — "no rushing/receiving/passing splits exist
 * anywhere" — is wrong about the codebase; the ruling it carries is not.
 * Corrected at spec v2.12.9 and filed as **Q16** for Chris's read, since
 * whether the six yards/TD columns should ship AHEAD of the volume fields
 * is a product call he has not made. Nothing here improvises it.)*
 *
 * Key names come from the app's ONE canonical stat namespace (D33) — the
 * `StatRow` convention in `lib/scoring/default.ts` and the column catalog
 * in `players-spreadsheet.tsx`, which is where `rush_attempts`, `targets`
 * and `pass_attempts` are already spelled. The sync extension writing any
 * other spelling would be the bug, and this gate would (correctly) stay
 * shut.
 */

import type { Json } from '@/types/database'

// ---------------------------------------------------------------------------
// 1. Scoring family — which season-points column the league is scored by
// ---------------------------------------------------------------------------

/** The three season-point columns `sync:projections` writes to `players`. */
export type ScoringFamily = 'ppr' | 'half_ppr' | 'standard'

/** family → the `players` column that carries its season projection. */
export const PROJECTED_POINTS_COLUMN = {
  ppr: 'projected_pts_ppr',
  half_ppr: 'projected_pts_half_ppr',
  standard: 'projected_pts_standard',
} as const satisfies Record<ScoringFamily, string>

/** Per-reception boundaries. The three shipped shapes are 0 / 0.5 / 1
 *  (migration 058's six parity templates), so the cuts sit at the
 *  MIDPOINTS — a league on 0.4 or 0.6 lands on the nearer family rather
 *  than falling through to standard. Both boundaries are pinned. */
export const HALF_PPR_FLOOR = 0.25
export const PPR_FLOOR = 0.75

/**
 * The league's scoring family, read from its own frozen rules
 * (`leagues.scoring_rules_snapshot` — §7.3.3's snapshot; a league in
 * `drafting`+ always has one, migration 059's guard). Returns `null` when
 * the rules are unreadable or carry no `receptions` coefficient: the
 * caller renders "—" and says so, because §16.5.4's degraded rule is
 * "never wrong numbers" and half-PPR-because-it-is-usually-half-PPR is a
 * wrong number wearing a plausible hat.
 */
export function scoringFamilyFromRules(rules: Json | null | undefined): ScoringFamily | null {
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) return null
  const perReception = (rules as Record<string, unknown>).receptions
  if (typeof perReception !== 'number' || !Number.isFinite(perReception)) return null
  if (perReception >= PPR_FLOOR) return 'ppr'
  if (perReception >= HALF_PPR_FLOOR) return 'half_ppr'
  return 'standard'
}

// ---------------------------------------------------------------------------
// 2. Row shapes
// ---------------------------------------------------------------------------

/** The `players` columns the table reads (the superset of the pool's — see
 *  `use-draft-pool.ts`). Every one of them already exists: `auction_value`
 *  (035), `sos` (032), `bye_week` (001), the three projection columns +
 *  `projected_stats` (031). */
export interface AuctionPlayerSource {
  id: string
  full_name: string
  position: string
  team: string | null
  adp: number | null
  headshot_url: string | null
  status: string | null
  auction_value: number | null
  bye_week: number | null
  sos: number | null
  projected_pts_ppr: number | null
  projected_pts_half_ppr: number | null
  projected_pts_standard: number | null
  projected_stats: Json | null
}

/** A rendered row: the source columns plus the derived mirrors and the
 *  per-user marks. */
export interface AuctionPlayerRow extends AuctionPlayerSource {
  /** The scoring-family season projection, or null when the family is
   *  unknown or the player has no projection. */
  projectedPoints: number | null
  /** `projectedPoints ÷ regular_season_weeks`, 1dp. */
  pointsPerWeek: number | null
  /** `auction_value ÷ projectedPoints`, 2dp — null when either side is
   *  missing or the projection is ≤ 0 (see `dollarsPerPoint`). */
  dollarsPerPoint: number | null
  /** The projections blob, flattened to the numeric keys the split
   *  columns read. `{}` when absent or malformed. */
  splits: Record<string, number>
  /** Live (non-undone) pick exists for this player. */
  drafted: boolean
  /** Winning price + team, for the Show-Drafted treatment. */
  price: number | null
  wonByTeamId: string | null
  /** My `draft_dnd_marks` row exists (§12.24) — DISPLAY ONLY. */
  dnd: boolean
  /** Already in my Targets (D140's noun for `draft_queues`). */
  queued: boolean
  /** On my `is_favorites` system list (028). */
  favorite: boolean
}

/** Numeric keys of a `projected_stats` blob; anything non-numeric is
 *  dropped rather than coerced (a string "12" in the blob is a sync bug,
 *  and rendering it as 12 would hide it). */
export function statSplits(blob: Json | null | undefined): Record<string, number> {
  if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(blob as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

// ---------------------------------------------------------------------------
// 3. The derived columns (display-only mirrors — §4.7's posture, applied
//    to projections instead of money)
// ---------------------------------------------------------------------------

const round1 = (value: number): number => Math.round(value * 10) / 10
const round2 = (value: number): number => Math.round(value * 100) / 100

/** The scoring-family season projection for one player. */
export function projectedPointsFor(
  player: Pick<
    AuctionPlayerSource,
    'projected_pts_ppr' | 'projected_pts_half_ppr' | 'projected_pts_standard'
  >,
  family: ScoringFamily | null,
): number | null {
  if (family === null) return null
  const value = player[PROJECTED_POINTS_COLUMN[family]]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * §16.4's "Projected Points (weekly average, derived)" — the SEASON total
 * over the league's REGULAR SEASON WEEKS (`regular_season_weeks`, 12–15,
 * a §7.3.5 setting), not over `players.projected_games`.
 *
 * The banner names the divisor ("derived ÷ regular-season weeks") and the
 * two divisors genuinely differ: `projected_games` is the provider's
 * games-played estimate (17 for a healthy starter), so dividing by it
 * answers "points per game he plays", while a fantasy manager buying a
 * roster spot is asking "points this lineup slot pays me per week I own
 * it" — bye included. A 14-week league divides a 280-point season by 14
 * (20.0), not by 17 (16.5).
 */
export function pointsPerWeek(
  projectedPoints: number | null,
  regularSeasonWeeks: number,
): number | null {
  if (projectedPoints === null) return null
  if (!Number.isFinite(regularSeasonWeeks) || regularSeasonWeeks <= 0) return null
  return round1(projectedPoints / regularSeasonWeeks)
}

/**
 * §16.4's "Dollar-to-Projected-Points ratio (derived)" — dollars of
 * projected cost per projected point, so LOWER is better value.
 *
 * Null rather than 0 or ∞ at both degenerate edges: a player with no
 * `auction_value` has no cost to divide, and a player projected at ≤ 0
 * points has no denominator (∞ dollars per point is arithmetically
 * honest and useless in a column — the row renders "—"). A $0 value over
 * real points is a legitimate 0 and is kept.
 */
export function dollarsPerPoint(
  auctionValue: number | null,
  projectedPoints: number | null,
): number | null {
  if (auctionValue === null || !Number.isFinite(auctionValue)) return null
  if (projectedPoints === null || !Number.isFinite(projectedPoints)) return null
  if (projectedPoints <= 0) return null
  return round2(auctionValue / projectedPoints)
}

// ---------------------------------------------------------------------------
// 4. The column catalog + the C43 gate
// ---------------------------------------------------------------------------

export type SplitGroupKey = 'rushing' | 'receiving' | 'passing'

export type AuctionColumnKey =
  | 'cost'
  | 'dollars_per_point'
  | 'proj_points'
  | 'proj_points_week'
  | 'bye'
  | 'sos'
  | 'adp'
  | 'rush_attempts'
  | 'rush_yards'
  | 'rush_tds'
  | 'targets'
  | 'receiving_yards'
  | 'receiving_tds'
  | 'pass_attempts'
  | 'pass_yards'
  | 'pass_tds'

export interface AuctionColumn {
  key: AuctionColumnKey
  /** Table header — short, because the header row is 11px in a panel. */
  label: string
  /** The customizer's full name (and the expanded row's label). */
  full: string
  /** Grouping in the customizer; split groups are additionally C43-gated. */
  group: 'value' | 'schedule' | SplitGroupKey
  /** Blob key for a split column; absent for the derived/typed columns. */
  statKey?: string
  /** Survives the §16.4 mobile density collapse (the rest move into the
   *  expanded row, which is where the customizer's picks live at 375). */
  essential?: boolean
}

/** §16.4's printed column list, in its printed order, plus ADP. ADP is
 *  here because the surface this table REPLACES in an auction room
 *  (`available-players`, the dock's Players panel) showed it — dropping
 *  it would be a regression, and it is the order the window is built in,
 *  so showing the sort key is honesty rather than density. */
export const AUCTION_COLUMNS: readonly AuctionColumn[] = [
  { key: 'cost', label: '$', full: 'Projected $ cost', group: 'value', essential: true },
  { key: 'dollars_per_point', label: '$/pt', full: 'Dollars per projected point', group: 'value' },
  { key: 'proj_points', label: 'Proj', full: 'Projected points (season)', group: 'value', essential: true },
  { key: 'proj_points_week', label: 'Pts/wk', full: 'Projected points per week', group: 'value' },
  { key: 'bye', label: 'Bye', full: 'Bye week', group: 'schedule' },
  { key: 'sos', label: 'SOS', full: 'Strength of schedule', group: 'schedule' },
  { key: 'adp', label: 'ADP', full: 'Average draft position', group: 'schedule' },
  // ---- C43-gated: the three split triples (§16.4). ----
  { key: 'rush_attempts', label: 'Att', full: 'Rushing attempts', group: 'rushing', statKey: 'rush_attempts' },
  { key: 'rush_yards', label: 'Yds', full: 'Rushing yards', group: 'rushing', statKey: 'rush_yards' },
  { key: 'rush_tds', label: 'TD', full: 'Rushing touchdowns', group: 'rushing', statKey: 'rush_tds' },
  { key: 'targets', label: 'Tgt', full: 'Targets', group: 'receiving', statKey: 'targets' },
  { key: 'receiving_yards', label: 'Yds', full: 'Receiving yards', group: 'receiving', statKey: 'receiving_yards' },
  { key: 'receiving_tds', label: 'TD', full: 'Receiving touchdowns', group: 'receiving', statKey: 'receiving_tds' },
  { key: 'pass_attempts', label: 'Att', full: 'Passing attempts', group: 'passing', statKey: 'pass_attempts' },
  { key: 'pass_yards', label: 'Yds', full: 'Passing yards', group: 'passing', statKey: 'pass_yards' },
  { key: 'pass_tds', label: 'TD', full: 'Passing touchdowns', group: 'passing', statKey: 'pass_tds' },
]

export const COLUMN_GROUP_LABELS: Record<AuctionColumn['group'], string> = {
  value: 'Value',
  schedule: 'Schedule',
  rushing: 'Rushing',
  receiving: 'Receiving',
  passing: 'Passing',
}

export const SPLIT_GROUP_KEYS: readonly SplitGroupKey[] = ['rushing', 'receiving', 'passing']

/** The blob keys each split group needs, all of them, before it renders. */
export const SPLIT_GROUP_STAT_KEYS: Record<SplitGroupKey, readonly string[]> = {
  rushing: ['rush_attempts', 'rush_yards', 'rush_tds'],
  receiving: ['targets', 'receiving_yards', 'receiving_tds'],
  passing: ['pass_attempts', 'pass_yards', 'pass_tds'],
}

/** The default visible set — §16.4's ungated columns. Reset restores it. */
export const DEFAULT_VISIBLE_COLUMNS: readonly AuctionColumnKey[] = [
  'cost',
  'dollars_per_point',
  'proj_points',
  'proj_points_week',
  'bye',
  'sos',
  'adp',
]

function isSplitGroup(group: AuctionColumn['group']): group is SplitGroupKey {
  return group === 'rushing' || group === 'receiving' || group === 'passing'
}

/**
 * THE C43 GATE. A split group is available iff every stat key in its
 * triple appears on at least one loaded row's blob — "at least one"
 * because a blob only carries a player's OWN non-zero stats (the sync's
 * `set()` skips zeroes), so a key's existence is a property of the FEED,
 * evidenced by any player who has it, not of every row.
 */
export function splitGroupAvailability(
  rows: ReadonlyArray<{ splits: Record<string, number> }>,
): Record<SplitGroupKey, boolean> {
  const seen = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row.splits)) seen.add(key)
  const out = {} as Record<SplitGroupKey, boolean>
  for (const group of SPLIT_GROUP_KEYS) {
    out[group] = SPLIT_GROUP_STAT_KEYS[group].every((key) => seen.has(key))
  }
  return out
}

/** The catalog minus every column a gate closes — what the table may
 *  render AND what the customizer may offer (an option that can only
 *  produce an empty column is the same lie as the column). */
export function availableColumns(
  availability: Record<SplitGroupKey, boolean>,
): AuctionColumn[] {
  return AUCTION_COLUMNS.filter(
    (column) => !isSplitGroup(column.group) || availability[column.group],
  )
}

/** Catalog order ∩ the user's visible set ∩ what the gate allows. */
export function visibleColumns(
  visible: ReadonlySet<AuctionColumnKey>,
  availability: Record<SplitGroupKey, boolean>,
): AuctionColumn[] {
  return availableColumns(availability).filter((column) => visible.has(column.key))
}

/** The cell's value for one row/column, or null for "—". */
export function columnValue(row: AuctionPlayerRow, column: AuctionColumn): number | null {
  switch (column.key) {
    case 'cost':
      return row.auction_value
    case 'dollars_per_point':
      return row.dollarsPerPoint
    case 'proj_points':
      return row.projectedPoints
    case 'proj_points_week':
      return row.pointsPerWeek
    case 'bye':
      return row.bye_week
    case 'sos':
      return row.sos
    case 'adp':
      return row.adp
    default:
      return column.statKey !== undefined ? (row.splits[column.statKey] ?? null) : null
  }
}

/** Cell text. `$` columns carry their unit; everything else is a number
 *  at its own precision. Null is the em-dash everywhere (§16.5.4: an
 *  absent number renders as absent, never as 0). */
export function formatColumnValue(value: number | null, key: AuctionColumnKey): string {
  if (value === null) return '—'
  switch (key) {
    case 'cost':
      return `$${Math.round(value)}`
    case 'dollars_per_point':
      return `$${value.toFixed(2)}`
    case 'proj_points':
      return value.toFixed(1)
    case 'proj_points_week':
      return value.toFixed(1)
    case 'adp':
      return value.toFixed(1)
    case 'bye':
    case 'sos':
      return String(value)
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(1)
  }
}

// ---------------------------------------------------------------------------
// 5. Row assembly + filtering
// ---------------------------------------------------------------------------

export interface PickFact {
  player_id: string
  team_id: string
  price: number | null
  is_undone: boolean | null
}

export interface DecorateInput {
  players: readonly AuctionPlayerSource[]
  picks: readonly PickFact[]
  family: ScoringFamily | null
  regularSeasonWeeks: number
  dndIds: ReadonlySet<string>
  queuedIds: ReadonlySet<string>
  favoriteIds: ReadonlySet<string>
}

/**
 * Source rows → rendered rows. The pick facts come from the room's live
 * cache, so every pick broadcast re-runs this and the row flips to
 * drafted without a refetch (the E17 shape `available-players-ops.ts`
 * established). Undone picks are not drafted (E4).
 */
export function decorateRows(input: DecorateInput): AuctionPlayerRow[] {
  const priceById = new Map<string, { price: number | null; teamId: string }>()
  for (const pick of input.picks) {
    if (pick.is_undone) continue
    priceById.set(pick.player_id, { price: pick.price, teamId: pick.team_id })
  }
  return input.players.map((player) => {
    const splits = statSplits(player.projected_stats)
    const projectedPoints = projectedPointsFor(player, input.family)
    const won = priceById.get(player.id)
    return {
      ...player,
      splits,
      projectedPoints,
      pointsPerWeek: pointsPerWeek(projectedPoints, input.regularSeasonWeeks),
      dollarsPerPoint: dollarsPerPoint(player.auction_value, projectedPoints),
      drafted: won !== undefined,
      price: won?.price ?? null,
      wonByTeamId: won?.teamId ?? null,
      dnd: input.dndIds.has(player.id),
      queued: input.queuedIds.has(player.id),
      favorite: input.favoriteIds.has(player.id),
    }
  })
}

/** Merge the ADP window with the by-id read that serves Show Drafted,
 *  Favorites and the §8.9 overlay's only-mode. First occurrence wins;
 *  window order is preserved and the extras follow. */
export function mergeSources(
  windowRows: readonly AuctionPlayerSource[],
  extraRows: readonly AuctionPlayerSource[],
): AuctionPlayerSource[] {
  const seen = new Set<string>()
  const out: AuctionPlayerSource[] = []
  for (const row of [...windowRows, ...extraRows]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

export interface FilterInput {
  rows: readonly AuctionPlayerRow[]
  /** The debounced search term. Applied here too because the by-id rows
   *  (drafted / favorites / list) never went through the server filter. */
  search: string
  position: string
  favoritesOnly: boolean
  showDrafted: boolean
  /** §8.9's "only players on this list" — the overlaid list's ids, or
   *  null when the filter is off. */
  onlyListIds: ReadonlySet<string> | null
}

/**
 * The four filters, composed. Drafted rows are REMOVED unless Show
 * Drafted is on — when it is on they stay in place, greyed, carrying
 * their price and winner (§16.4's toggle: "not hidden by default when
 * on"). DND marks filter NOTHING: they are a label (§12.24, C42).
 */
export function filterRows(input: FilterInput): AuctionPlayerRow[] {
  const needle = input.search.trim().toLowerCase()
  return input.rows.filter((row) => {
    if (row.drafted && !input.showDrafted) return false
    if (input.position && row.position !== input.position) return false
    if (needle && !row.full_name.toLowerCase().includes(needle)) return false
    if (input.favoritesOnly && !row.favorite) return false
    if (input.onlyListIds !== null && !input.onlyListIds.has(row.id)) return false
    return true
  })
}

/**
 * Which empty state the §16.5.4 catalog owes, given why nothing showed.
 * Never "no players" when a filter is what emptied it — the "nothing
 * happened means it worked" rule applied to an empty table: assert the
 * REASON rather than inferring one from a row count.
 *
 * **An ACTIVE FILTER always explains the emptiness before `no-pool`
 * does** — a browser-pass correction, and the reason the check is ordered
 * this way rather than cheapest-first. Search and position narrow
 * SERVER-side (`useAuctionPool`), so a term that matches nobody empties
 * `totalRows` itself: a `totalRows === 0` shortcut therefore told a user
 * who typed "zzzz" that *"the player pool is empty"* — measured live at
 * 1280 before this ordering landed.
 *
 * **The two "you have nothing" branches come FIRST** (R450, M3 batch 16):
 * "None of your Favorites match" is what a user with ZERO favourites was
 * told, and "No players on this list are still available" is what an
 * EMPTY attached list said — both assert a filtering outcome where the
 * truth is that the set being filtered by is empty. They outrank the
 * search/position branch because no amount of loosening a search fixes
 * them, so under composition the ordinary "loosen the filter" copy would
 * be an unactionable instruction.
 *
 * Every branch's copy is true under COMPOSITION as well as alone, which
 * is what fixes the ordering rather than just moving the bug: with a
 * search and Favorites both on, "loosen the search or position filter" is
 * still both true and actionable.
 *
 * The caller owes this function SETTLED counts. A pending or failed read
 * also reports `size === 0`, and calling either of the new branches on one
 * would be the same lie one layer up — `tablePending` and `failureReason`
 * below are what keep this function from ever seeing an unsettled count.
 */
export function emptyReason(input: {
  totalRows: number
  search: string
  position: string
  favoritesOnly: boolean
  /** How many ids the (SETTLED) Favorites read returned. */
  favoritesCount: number
  onlyList: boolean
  /** How many players the (SETTLED) overlaid list holds. */
  onlyListCount: number
}): 'filters' | 'favorites' | 'no-favorites' | 'list' | 'empty-list' | 'all-drafted' | 'no-pool' {
  if (input.favoritesOnly && input.favoritesCount === 0) return 'no-favorites'
  if (input.onlyList && input.onlyListCount === 0) return 'empty-list'
  if (input.search !== '' || input.position !== '') return 'filters'
  if (input.favoritesOnly) return 'favorites'
  if (input.onlyList) return 'list'
  if (input.totalRows === 0) return 'no-pool'
  return 'all-drafted'
}

export const EMPTY_COPY: Record<ReturnType<typeof emptyReason>, string> = {
  filters: 'No available players match. Loosen the search or position filter.',
  favorites: 'None of your Favorites match. Turn Favorites off to see the whole pool.',
  'no-favorites':
    'You haven’t favorited any players yet. Turn Favorites off to see the whole pool.',
  list: 'No players on this list are still available.',
  'empty-list': 'This list has no players on it yet. Turn “Only this list” off to see the pool.',
  'all-drafted': 'Every player in the window is drafted. Turn on Show drafted to see prices.',
  'no-pool': 'The player pool is empty.',
}

// ---------------------------------------------------------------------------
// 5b. The load gates — every read this table consumes reaches one of them
// ---------------------------------------------------------------------------

/**
 * The table's loading gate. **A read that is still in flight must never
 * reach `emptyReason`**: an unsettled filter source reports an empty set
 * exactly like a settled-and-empty one, and the empty-state sentence then
 * asserts a reason that is not true yet (CLAUDE.md's "never let *nothing
 * happened* mean *it worked*", applied to a read that has not happened).
 *
 * Two of the four arms are gated on the filter being IN USE, because a
 * disabled React Query v5 query reports `isPending` forever:
 *   - `extras` (`useAuctionPlayersByIds`) is `enabled` only while ids
 *     exist — the R283 gate, restated for this table's second read;
 *   - `overlayRows` (`useLeagueListPlayers`) is `enabled` only while a
 *     list is overlaid, which is exactly `onlyMode`.
 * The Favorites read is always enabled, so its arm needs only the filter.
 */
export function tablePending(input: {
  poolPending: boolean
  extrasPending: boolean
  /** 0 ⇒ the by-id read is DISABLED and pends forever. */
  extraIdCount: number
  favoritesOnly: boolean
  favoritesPending: boolean
  /** "Only this list" is on AND a list is actually overlaid. */
  onlyMode: boolean
  overlayPending: boolean
}): boolean {
  if (input.poolPending) return true
  if (input.extrasPending && input.extraIdCount > 0) return true
  if (input.favoritesOnly && input.favoritesPending) return true
  if (input.onlyMode && input.overlayPending) return true
  return false
}

export type LoadFailure = 'pool' | 'overlay' | 'favorites' | 'extras'

/**
 * Which read failed, or `null` when none did — the error branch's reason,
 * chosen the same way `emptyReason` chooses its own.
 *
 * **A FAILED FILTER READ IS NOT AN EMPTY RESULT.** Every source below,
 * when it throws, leaves its id set empty, and the row set then filters to
 * nothing: without this function the table renders a DESIGNED EMPTY STATE
 * whose stated reason is untrue, with no error copy and no retry. That
 * defect shipped three times on this surface — search ordering (D194(9)),
 * Favorites (D194(13)) and the §8.9 overlay (R444) — so the sources are
 * enumerated here rather than spelled out at the call site a fourth time.
 *
 * Order is most-fundamental-first, and every arm's copy is true under
 * composition: the pool IS the row set, so when it failed nothing else can
 * be said honestly; the overlay and Favorites arms name the filter the
 * user is actually holding; `extras` is the window-independent top-up that
 * all three window-escaping filters share.
 */
export function failureReason(input: {
  poolError: boolean
  /** Gated by the caller on there being ids to fetch. */
  extrasError: boolean
  extraIdCount: number
  favoritesOnly: boolean
  favoritesError: boolean
  onlyMode: boolean
  overlayError: boolean
}): LoadFailure | null {
  if (input.poolError) return 'pool'
  if (input.onlyMode && input.overlayError) return 'overlay'
  if (input.favoritesOnly && input.favoritesError) return 'favorites'
  if (input.extrasError && input.extraIdCount > 0) return 'extras'
  return null
}

export const FAILURE_COPY: Record<LoadFailure, string> = {
  pool: 'The player pool didn’t load.',
  overlay: 'The overlaid list didn’t load, so “Only this list” can’t be trusted.',
  favorites: 'Your Favorites didn’t load, so this filter can’t be trusted.',
  extras: 'Players outside the browse window didn’t load, so this filter is incomplete.',
}

// ---------------------------------------------------------------------------
// 6. Column-visibility state (the customizer's reducer)
// ---------------------------------------------------------------------------

export type ColumnAction =
  | { type: 'toggle'; column: AuctionColumnKey }
  | { type: 'reset' }

/** Add/remove one column, or Reset-to-default (§16.4's two requirements).
 *  Order is never stored: the catalog owns it, so a column that comes
 *  back comes back in its printed place. */
export function columnsReducer(
  state: readonly AuctionColumnKey[],
  action: ColumnAction,
): AuctionColumnKey[] {
  switch (action.type) {
    case 'reset':
      return [...DEFAULT_VISIBLE_COLUMNS]
    case 'toggle': {
      const next = new Set(state)
      if (next.has(action.column)) next.delete(action.column)
      else next.add(action.column)
      return AUCTION_COLUMNS.filter((column) => next.has(column.key)).map((column) => column.key)
    }
  }
}

/** True when the visible set differs from the default — the Reset control
 *  is offered only when it would do something. */
export function columnsAreDefault(state: readonly AuctionColumnKey[]): boolean {
  if (state.length !== DEFAULT_VISIBLE_COLUMNS.length) return false
  return DEFAULT_VISIBLE_COLUMNS.every((key, index) => state[index] === key)
}
