/**
 * fill-ruled-columns — the quiet fill behind `npm run sync:fill-ruled`
 * (PROGRESS F870, F871, F890, D832). Chris 2026-11-05, on the questions asked
 * 2026-11-04: "go on league kickers and the other plays".
 *
 * WHY IT EXISTS. The stat-feed mapping left seven columns empty on past weeks,
 * and every stored rules document already pays them. Filling those columns is
 * the first half of re-scoring weeks that have finished. `sync:reingest` can't
 * do it: it rewrites whole lines, so it would land late provider fixes on any
 * stat (a re-score would then pay them past F405); it would write each moved
 * key as a provider-correction event into the table L.E2.5 measures; and it
 * refuses only unstarted weeks, so a league holding a week open would get
 * posts and notifications.
 *
 * WHAT ONE RUN DOES.
 *   1. REFUSES THE WHOLE RUN before any provider read, naming each cause: a
 *      week that hasn't started, or isn't `final` by the ingest door's own test
 *      (167:325-332): its correction window has closed, every game still in
 *      the week is final, and no in-season / playoff league (`deleted_at` NULL)
 *      holds it open. A leftover pre-draft league doesn't hold the gate shut.
 *   2. READS the feed for every requested week before any write, and proves
 *      the mapping is there: no `fg_0_39` on any K line, or no `def_block` on
 *      any D/ST line, is a refusal by name. A checkout whose map can't see
 *      these plays must fail loudly, never report "nothing to do".
 *   3. PLANS. Diffs only `RULED_COLUMNS`. Any other difference is reported by
 *      player and key and never written. A stored line's metadata goes back
 *      as stored. A new line goes in only if everything it carries outside the
 *      ruled columns is empty, so a late provider line can't slip in. A fill
 *      only raises: a ruled value the feed reads below a non-zero stored one
 *      is a problem, named by player, and every move from a non-zero stored
 *      value is listed by player. A partial read is a problem too: a position
 *      with stored lines that the feed carried none of this week, or a stored
 *      D/ST line the feed doesn't carry. A missing offense line is counted by
 *      position, not blocked.
 *   4. WRITES ONLY WITH `apply`, and only with no problem anywhere: through
 *      `ingest_write_batch` with `enqueue: false` and `corrections: []` (legal
 *      at 167:291), so no event and no queue row. The door sets exactly the
 *      columns sent (167's step 4).
 *   5. ASSERTS AFTER, LOUD: the K identities on every stored K line, row counts
 *      equal to the plan, nothing moved outside the ruled columns.
 *
 * Time only via `time`; provider reads only via `provider`; every table read
 * pages past the PostgREST cap. It never touches `nfl_games`, `nfl_weeks` or
 * `system_flags`, and it never runs itself: the CLI is
 * `scripts/fill-ruled-columns.ts`.
 */

import { z } from 'zod'

import type { ProviderPlayerWeekStats } from '@/lib/leagues/stats/stats-provider'
import { FANTASY_POSITIONS } from '@/lib/sports-data/sleeper'
import { pageAll } from '@/lib/supabase/page-all'

import {
  canonicalJson,
  collapseIdenticalRows,
  conflictingPlayers,
  CONTEXT_ADVANCED_KEYS,
  INGEST_DOOR,
  movedStatKeys,
  readGames,
  readStats,
  statTeamColumn,
  toStatRow,
  weekMatchupKeys,
  writeThroughDoor,
  type DbStatRow,
  type DoorTally,
  type MovedKey,
  type StatRow,
  type ToStatRowContext,
} from './ingest-week'
import { confirmTarget, parseWeeks, readWeeks, weekNotStartedCauses, type ReingestDeps, type WeekRow } from './reingest-weeks'
import type { SyncClient } from './types'

/** The only columns this tool ever writes on a stored line. */
export const RULED_COLUMNS = [
  'fg_0_39',
  'fg_missed',
  'def_block',
  'def_return_td',
  'def_fumble_recoveries',
  'return_td',
  'fumble_recovery_td',
] as const
export type RuledColumn = (typeof RULED_COLUMNS)[number]
const RULED: ReadonlySet<string> = new Set(RULED_COLUMNS)

// ── The refusals ───────────────────────────────────────────────────────────

/** `week_games_state_internal`'s answer: the door's own all-final test (116, 184). */
export interface WeekGameState {
  total_games: number
  open_games: number
  all_final: boolean
}

export interface LeagueHold {
  league_id: string
  week: number
  week_status: string
  league_status: string
}

/** The third arm of the door's `final` state, as written at 167:330-332. */
export function leagueHoldsWeek(weekStatus: string, league: { status: string; deleted_at: string | null }): boolean {
  return weekStatus !== 'final' && (league.status === 'in_season' || league.status === 'playoffs') && league.deleted_at === null
}

/** Every reason the run is refused, one per cause (empty: go on). */
export function fillRefusalCauses(
  weeks: number[],
  calendar: ReadonlyMap<number, WeekRow>,
  gameStates: ReadonlyMap<number, WeekGameState>,
  holds: readonly LeagueHold[],
  now: Date,
): string[] {
  const causes = weekNotStartedCauses(weeks, calendar, now)
  for (const week of weeks) {
    const row = calendar.get(week)
    if (row) {
      const ends = row.correction_window_ends_at ?? null
      if (ends === null) causes.push(`week ${week}: no correction window end is recorded — its window has not closed`)
      else if (new Date(ends).getTime() > now.getTime()) causes.push(`week ${week}: its correction window closes ${ends}, after now`)
    }
    const state = gameStates.get(week)
    if (!state?.all_final) {
      causes.push(`week ${week}: not every game still in the week is final (${state?.open_games ?? '?'} open of ${state?.total_games ?? '?'})`)
    }
    for (const hold of holds) {
      if (hold.week === week) causes.push(`week ${week}: league ${hold.league_id} (${hold.league_status}) holds it ${hold.week_status}`)
    }
  }
  return causes
}

const gameStateRows = z.array(z.object({ total_games: z.number(), open_games: z.number(), all_final: z.boolean() }))

async function readGameState(db: SyncClient, season: number, week: number): Promise<WeekGameState> {
  const { data, error } = await db.rpc('week_games_state_internal', { p_season: season, p_week: week })
  if (error) throw new Error(`week_games_state_internal(${season}, ${week}) failed: ${error.message}`)
  const parsed = gameStateRows.safeParse(data)
  if (!parsed.success || parsed.data.length !== 1) {
    throw new Error(`week_games_state_internal(${season}, ${week}) answered an unexpected shape: ${JSON.stringify(data)}`)
  }
  return parsed.data[0]
}

async function readLeagueHolds(db: SyncClient, season: number, weeks: number[]): Promise<LeagueHold[]> {
  const open = await pageAll<{ id: string; league_id: string; week: number; status: string }>((from, to) =>
    db
      .from('league_weeks')
      .select('id, league_id, week, status', { count: 'exact' })
      .eq('season', season)
      .in('week', weeks)
      .neq('status', 'final')
      .order('id')
      .range(from, to),
  )
  if (open.length === 0) return []
  const leagues = await pageAll<{ id: string; status: string; deleted_at: string | null }>((from, to) =>
    db
      .from('leagues')
      .select('id, status, deleted_at', { count: 'exact' })
      .in('id', [...new Set(open.map((row) => row.league_id))])
      .order('id')
      .range(from, to),
  )
  const byId = new Map(leagues.map((league) => [league.id, league]))
  const holds: LeagueHold[] = []
  for (const row of open) {
    const league = byId.get(row.league_id)
    if (league === undefined) throw new Error(`league_weeks ${row.id} names league ${row.league_id}, which the read did not return — refusing to read that as no hold`)
    if (leagueHoldsWeek(row.status, league)) holds.push({ league_id: row.league_id, week: row.week, week_status: row.status, league_status: league.status })
  }
  return holds
}

/** `players.id` → position; also the known-player set (FK target of a new line). */
async function readPlayerPositions(db: SyncClient): Promise<Map<string, string>> {
  const rows = await pageAll<{ id: string; position: string | null }>((from, to) =>
    db.from('players').select('id, position', { count: 'exact' }).order('id').range(from, to),
  )
  if (rows.length === 0) throw new Error('players is empty — every line would read as unknown (refusing to call that success)')
  return new Map(rows.map((row) => [row.id, row.position ?? '']))
}

// ── The plan (pure) ────────────────────────────────────────────────────────

/** A stored value outside the ruled columns that the feed reads differently. Reported, never written. */
export interface OtherDifference {
  player_id: string
  key: string
  column: string | null
  stored: number | null
  feed: number | null
}

/** A ruled value moving off a non-zero stored value. Listed by player; a lowered one is also a problem. */
export interface StoredValueMove {
  player_id: string
  column: RuledColumn
  stored: number
  feed: number
}

export interface FillWeekPlan {
  week: number
  /** Lines the provider returned. */
  feedLines: number
  /** Lines for a player `players` doesn't know. A problem only if the line carries a ruled value. */
  unknownPlayers: number
  /** Lines carrying nothing storable. */
  empty: number
  /** Byte-identical repeats in the answer. */
  duplicates: number
  /** Stored lines whose ruled columns already equal the feed. */
  unchanged: number
  /** New lines with every column empty: nothing to fill, so not inserted. */
  zeroNewLines: number
  /** Stored lines the feed doesn't carry (untouched). */
  storedOnly: number
  /** The same, by `players.position` ('' when the player has none). */
  storedOnlyByPosition: Record<string, number>
  /** Stored lines to rewrite: stored metadata plus the ruled columns only. */
  updates: StatRow[]
  /** New lines: the full `toStatRow` surface. */
  newRows: StatRow[]
  /** How many values each ruled column moves, new lines included. */
  moves: Record<RuledColumn, number>
  /** Every move whose stored value is not 0, by player: the ones a count alone can't explain. */
  fromStoredValue: StoredValueMove[]
  otherDifferences: OtherDifference[]
  /** Display-only `advanced` keys that differ, by key: can't score, never written. */
  contextDifferences: Record<string, number>
  /** Any entry blocks `--apply`. */
  problems: string[]
  /** What the mapping proof reads. */
  kLines: number
  kLinesWithShortFg: number
  dstLines: number
  dstLinesWithBlock: number
}

function ruledValues(row: StatRow): string[] {
  return RULED_COLUMNS.filter((column) => (row.columns[column] ?? 0) !== 0).map((column) => `${column}=${row.columns[column]}`)
}

function otherColumnDifferences(prior: StatRow | undefined, row: StatRow): OtherDifference[] {
  const out: OtherDifference[] = movedStatKeys(prior, row)
    .filter((moved) => moved.column === null || !RULED.has(moved.column))
    .map((moved) => ({ player_id: row.player_id, key: moved.stat_key, column: moved.column, stored: moved.old, feed: moved.new }))
  // The summed column has no registry key, so movedStatKeys can't see it.
  const sum = 'two_point_conversions'
  const before = prior?.columns[sum] ?? 0
  const after = row.columns[sum] ?? 0
  if (before !== after) out.push({ player_id: row.player_id, key: sum, column: sum, stored: prior === undefined ? null : before, feed: after })
  return out
}

/** `fg_0_39 + fg_made_40_plus + fg_made_50_plus = fg_made` and `fg_attempted - fg_made = fg_missed`. */
export function kIdentityFailures(playerId: string, columns: Readonly<Record<string, number | null>>): string[] {
  const read = (column: string): number => columns[column] ?? 0
  const buckets = read('fg_0_39') + read('fg_made_40_plus') + read('fg_made_50_plus')
  const out: string[] = []
  if (buckets !== read('fg_made')) {
    out.push(`K ${playerId}: fg_0_39 ${read('fg_0_39')} + fg_made_40_plus ${read('fg_made_40_plus')} + fg_made_50_plus ${read('fg_made_50_plus')} does not equal fg_made ${read('fg_made')}`)
  }
  if (read('fg_attempted') - read('fg_made') !== read('fg_missed')) {
    out.push(`K ${playerId}: fg_attempted ${read('fg_attempted')} - fg_made ${read('fg_made')} does not equal fg_missed ${read('fg_missed')}`)
  }
  return out
}

/** A value the door would change just by being sent it back: `readStats` reads these as defaults. */
export function metadataWontRoundTrip(raw: DbStatRow): string | null {
  if (raw.source === null) return 'its stored source is NULL'
  if (raw.is_live === null) return 'its stored is_live is NULL'
  const odd = Object.entries(raw.advanced ?? {}).filter(([, value]) => typeof value !== 'number')
  if (odd.length > 0) return `its stored advanced holds non-numbers: ${odd.map(([key]) => key).join(', ')}`
  return null
}

export interface PlanInput {
  week: number
  lines: readonly ProviderPlayerWeekStats[]
  stored: ReadonlyMap<string, StatRow>
  positions: ReadonlyMap<string, string>
  ctx: ToStatRowContext
  /** Stored lines whose metadata can't go back unchanged (`metadataWontRoundTrip`). */
  unsendable?: ReadonlyMap<string, string>
}

export function planFillWeek(input: PlanInput): FillWeekPlan {
  const { week, lines, stored, positions, ctx, unsendable } = input
  const plan: FillWeekPlan = {
    week,
    feedLines: lines.length,
    unknownPlayers: 0,
    empty: 0,
    duplicates: 0,
    unchanged: 0,
    zeroNewLines: 0,
    storedOnly: 0,
    storedOnlyByPosition: {},
    updates: [],
    newRows: [],
    moves: Object.fromEntries(RULED_COLUMNS.map((column) => [column, 0])) as Record<RuledColumn, number>,
    fromStoredValue: [],
    otherDifferences: [],
    contextDifferences: {},
    problems: [],
    kLines: 0,
    kLinesWithShortFg: 0,
    dstLines: 0,
    dstLinesWithBlock: 0,
  }
  if (lines.length === 0) plan.problems.push(`week ${week}: the feed returned zero lines`)

  const known: StatRow[] = []
  for (const line of lines) {
    const { row } = toStatRow(line, ctx)
    if (row === null) {
      plan.empty += 1
    } else if (positions.has(row.player_id)) {
      known.push(row)
    } else {
      plan.unknownPlayers += 1
      const carried = ruledValues(row)
      if (carried.length > 0) plan.problems.push(`week ${week}: player ${row.player_id} is not in players, and its line carries ${carried.join(', ')}`)
    }
  }
  // A partial read: the provider reads each position on its own, and a 200
  // carrying no lines for one of them looks like a week with nothing to fill.
  const feedIds = new Set(known.map((row) => row.player_id))
  const storedByPosition = new Map<string, number>()
  const feedByPosition = new Map<string, number>()
  for (const id of stored.keys()) {
    const position = positions.get(id) ?? ''
    storedByPosition.set(position, (storedByPosition.get(position) ?? 0) + 1)
    if (!feedIds.has(id)) {
      plan.storedOnly += 1
      plan.storedOnlyByPosition[position] = (plan.storedOnlyByPosition[position] ?? 0) + 1
    }
  }
  for (const id of feedIds) {
    const position = positions.get(id) ?? ''
    feedByPosition.set(position, (feedByPosition.get(position) ?? 0) + 1)
  }
  if (lines.length > 0) {
    for (const position of FANTASY_POSITIONS) {
      const storedLines = storedByPosition.get(position) ?? 0
      if (storedLines > 0 && (feedByPosition.get(position) ?? 0) === 0) {
        plan.problems.push(`week ${week}: the feed carried no ${position} lines, against ${storedLines} stored — a partial read, not a week with nothing to fill`)
      }
    }
    // Only where the feed carried D/ST lines at all: the line above already names a whole missing position.
    if ((feedByPosition.get('DEF') ?? 0) > 0) {
      for (const id of stored.keys()) {
        if (positions.get(id) === 'DEF' && !feedIds.has(id)) plan.problems.push(`week ${week}: the feed doesn't carry D/ST ${id}, which has a stored line — a partial read`)
      }
    }
  }

  const unique = collapseIdenticalRows(known)
  plan.duplicates = unique.collapsed
  // F831's reading: which of two different lines to believe is not decided here.
  const conflicts = conflictingPlayers(unique.rows)
  if (conflicts.length > 0) {
    plan.problems.push(`week ${week}: the feed carries two different lines for ${conflicts.join(', ')} — this week is not planned (F831)`)
    return plan
  }

  const wouldBe = new Map<string, Readonly<Record<string, number | null>>>()
  for (const [id, prior] of stored) wouldBe.set(id, prior.columns)

  for (const row of unique.rows) {
    const id = row.player_id
    const position = positions.get(id)
    if (position === 'K') {
      plan.kLines += 1
      if ((row.columns.fg_0_39 ?? 0) > 0) plan.kLinesWithShortFg += 1
    } else if (position === 'DEF') {
      plan.dstLines += 1
      if ((row.columns.def_block ?? 0) > 0) plan.dstLinesWithBlock += 1
    }

    const prior = stored.get(id)
    const others = otherColumnDifferences(prior, row)
    plan.otherDifferences.push(...others)

    if (prior === undefined) {
      const carried = ruledValues(row)
      if (others.length > 0) {
        plan.problems.push(`week ${week}: new line for ${id} also carries ${others.map((o) => `${o.key}=${o.feed}`).join(', ')} — a late provider line, not written`)
      } else if (carried.length === 0) {
        plan.zeroNewLines += 1
      } else {
        plan.newRows.push(row)
        wouldBe.set(id, row.columns)
        for (const column of RULED_COLUMNS) if ((row.columns[column] ?? 0) !== 0) plan.moves[column] += 1
      }
      continue
    }

    for (const key of CONTEXT_ADVANCED_KEYS) {
      if (prior.advanced[key] !== row.advanced[key]) plan.contextDifferences[key] = (plan.contextDifferences[key] ?? 0) + 1
    }
    const moved = RULED_COLUMNS.filter((column) => (prior.columns[column] ?? 0) !== (row.columns[column] ?? 0))
    if (moved.length === 0) {
      plan.unchanged += 1
      continue
    }
    for (const column of moved) {
      plan.moves[column] += 1
      const was = prior.columns[column] ?? 0
      const now = row.columns[column] ?? 0
      if (was === 0) continue
      plan.fromStoredValue.push({ player_id: id, column, stored: was, feed: now })
      // A fill only adds plays the old map dropped. A lower reading is a provider fix or a map that reads less.
      if (now < was) plan.problems.push(`week ${week}: ${id} ${column} would go down from ${was} to ${now} — lowering a stored value is not a fill (a late provider fix, or a map that reads less)`)
    }
    const ruled = Object.fromEntries(RULED_COLUMNS.map((column) => [column, row.columns[column] ?? 0]))
    // `team` stays off the line: the door leaves a column it isn't sent alone.
    plan.updates.push({ player_id: id, game_id: prior.game_id, is_live: prior.is_live, source: prior.source, advanced: prior.advanced, columns: ruled })
    wouldBe.set(id, { ...prior.columns, ...ruled })
    const why = unsendable?.get(id)
    if (why !== undefined) plan.problems.push(`week ${week}: ${id} can't be rewritten — ${why}`)
  }

  // Checked here as well as after the write, so a failing identity blocks the run instead of being found once it is written.
  for (const [id, columns] of wouldBe) {
    if (positions.get(id) === 'K') plan.problems.push(...kIdentityFailures(id, columns).map((failure) => `week ${week}: ${failure}`))
  }
  return plan
}

/**
 * The mapping proof, across every requested week (PROGRESS D832(3)). Each arm
 * reads only the weeks that planned lines of its kind: a week the feed left
 * empty, or that a conflict stopped (F831), proves nothing either way. When no
 * week did and a plan already names a problem, that problem is the reason, so
 * the arm says nothing and the problem prints and blocks. When no week did and
 * nothing else is wrong, the map can't be proved, which is a refusal too.
 */
export function mappingRefusals(plans: readonly FillWeekPlan[]): string[] {
  const explained = plans.some((plan) => plan.problems.length > 0)
  const out: string[] = []
  const arms = [
    { kind: 'field-goal', key: 'fg_0_39', who: 'K', lines: (plan: FillWeekPlan) => plan.kLines, hits: (plan: FillWeekPlan) => plan.kLinesWithShortFg, hint: '' },
    { kind: 'blocked-kick', key: 'def_block', who: 'D/ST', lines: (plan: FillWeekPlan) => plan.dstLines, hits: (plan: FillWeekPlan) => plan.dstLinesWithBlock, hint: ' (if these weeks truly hold no blocked kick, request a week that does)' },
  ]
  for (const arm of arms) {
    const read = plans.filter((plan) => arm.lines(plan) > 0)
    if (read.length === 0) {
      if (!explained) out.push(`this checkout's ${arm.kind} mapping can't be proved: the feed for weeks ${plans.map((plan) => plan.week).join(', ')} planned no ${arm.who} line to read ${arm.key} on`)
      continue
    }
    if (read.reduce((sum, plan) => sum + arm.hits(plan), 0) > 0) continue
    const weeks = read.map((plan) => plan.week).join(', ')
    const count = read.reduce((sum, plan) => sum + arm.lines(plan), 0)
    out.push(`this checkout has no ${arm.kind} mapping: the feed for weeks ${weeks} read no ${arm.key} on any of its ${count} ${arm.who} lines${arm.hint}`)
  }
  return out
}

// ── After the write ────────────────────────────────────────────────────────

function nonRuledFingerprint(row: StatRow): string {
  const columns = Object.fromEntries(Object.entries(row.columns).filter(([column]) => !RULED.has(column)))
  return canonicalJson({ game_id: row.game_id, team: row.team ?? null, is_live: row.is_live, source: row.source, advanced: row.advanced, columns })
}

/** Everything the write must leave true for one week. Empty means it held. */
export function afterWriteProblems(
  plan: FillWeekPlan,
  before: ReadonlyMap<string, StatRow>,
  after: ReadonlyMap<string, StatRow>,
  positions: ReadonlyMap<string, string>,
): string[] {
  const week = `week ${plan.week}`
  const out: string[] = []
  const expected = before.size + plan.newRows.length
  if (after.size !== expected) out.push(`${week}: ${after.size} stored lines after the fill, the plan says ${expected}`)

  const written = new Map([...plan.updates, ...plan.newRows].map((row) => [row.player_id, row]))
  for (const [id, row] of written) {
    const line = after.get(id)
    if (line === undefined) {
      out.push(`${week}: ${id} has no stored line after the fill`)
      continue
    }
    for (const column of RULED_COLUMNS) {
      const got = line.columns[column] ?? 0
      const want = row.columns[column] ?? 0
      if (got !== want) out.push(`${week}: ${id} ${column} reads ${got} after the fill, the plan wrote ${want}`)
    }
  }
  for (const row of plan.newRows) {
    const line = after.get(row.player_id)
    if (line !== undefined && nonRuledFingerprint(line) !== nonRuledFingerprint(row)) out.push(`${week}: new line ${row.player_id} was stored differently outside the ruled columns`)
  }

  let moved = 0
  for (const [id, prior] of before) {
    const line = after.get(id)
    if (line === undefined) {
      out.push(`${week}: ${id} lost its stored line during the fill`)
      continue
    }
    if (nonRuledFingerprint(prior) !== nonRuledFingerprint(line)) out.push(`${week}: ${id} moved outside the ruled columns during the fill (a concurrent poll, or the write)`)
    if (RULED_COLUMNS.some((column) => (prior.columns[column] ?? 0) !== (line.columns[column] ?? 0))) {
      moved += 1
      if (!written.has(id)) out.push(`${week}: ${id} moved on a ruled column but is not in the plan`)
    }
  }
  if (moved !== plan.updates.length) out.push(`${week}: ${moved} stored lines moved on the ruled columns, the plan says ${plan.updates.length}`)

  for (const [id, line] of after) {
    if (positions.get(id) === 'K') out.push(...kIdentityFailures(id, line.columns).map((failure) => `${week}: ${failure}`))
  }
  return out
}

// ── One run ────────────────────────────────────────────────────────────────

export interface FillOptions {
  season: number
  /** Ascending, de-duplicated, each 1-18 (`parseWeeks`). */
  weeks: number[]
  apply: boolean
}

export interface FillReport {
  season: number
  mode: 'plan' | 'apply'
  /** false when anything was refused, blocked, or failed. */
  ok: boolean
  /** Set when the run stopped before planning finished. Nothing was written. */
  refused?: string
  weeks: FillWeekPlan[]
  /** The door was called at least once. */
  wrote: boolean
  /** The door's counts: all must stay zero. */
  door: DoorTally
  /** Lines the door accepted. */
  linesWritten: number
  /** The door failed partway. The diff makes a re-run safe. */
  writeFailure?: string
  /** Assertions that failed after writing. */
  afterProblems: string[]
}

function emptyTally(): DoorTally {
  return {
    stats: { enqueued: 0, restamped: 0 },
    corrections: { recorded: 0, replayed: 0, unchangedAtWrite: 0, weekState: null },
  }
}

export async function fillRuledColumns(deps: ReingestDeps, opts: FillOptions): Promise<FillReport> {
  const { db, provider, time } = deps
  const { season, weeks, apply } = opts
  if (weeks.length === 0) throw new Error('fillRuledColumns: no weeks requested')

  const report: FillReport = {
    season,
    mode: apply ? 'apply' : 'plan',
    ok: false,
    weeks: [],
    wrote: false,
    door: emptyTally(),
    linesWritten: 0,
    afterProblems: [],
  }

  const calendar = await readWeeks(db, season, weeks)
  const gameStates = new Map<number, WeekGameState>()
  for (const week of weeks) gameStates.set(week, await readGameState(db, season, week))
  const holds = await readLeagueHolds(db, season, weeks)
  const causes = fillRefusalCauses(weeks, calendar, gameStates, holds, time.now())
  if (causes.length > 0) {
    report.refused = `refused — ${causes.join('; ')}. Nothing was read from the provider or written.`
    return report
  }

  const positions = await readPlayerPositions(db)
  const teamColumn = await statTeamColumn(db)
  const games = await readGames(db, season)
  const gameStatus = new Map([...games.values()].map((game) => [game.id, game.status]))

  const before = new Map<number, Map<string, StatRow>>()
  for (const week of weeks) {
    let lines: ProviderPlayerWeekStats[]
    try {
      lines = await provider.getWeekStats(season, week)
    } catch (err) {
      report.weeks = []
      report.refused = `refused — the feed failed on week ${week}: ${err instanceof Error ? err.message : String(err)}. Nothing was written.`
      return report
    }
    const unsendable = new Map<string, string>()
    const stored = await readStats(db, season, week, teamColumn, (raw) => {
      const why = metadataWontRoundTrip(raw)
      if (why !== null) unsendable.set(raw.player_id, why)
    })
    before.set(week, stored)
    report.weeks.push(
      planFillWeek({
        week,
        lines,
        stored,
        positions,
        unsendable,
        ctx: {
          providerName: provider.name,
          gameStatus,
          // The refusal above proved every game still in this week final.
          anyGameOpen: false,
          weekMatchups: teamColumn ? weekMatchupKeys(games.values(), season, week) : undefined,
        },
      }),
    )
  }

  const mapping = mappingRefusals(report.weeks)
  if (mapping.length > 0) {
    report.weeks = []
    report.refused = `refused — ${mapping.join('; ')}. Nothing was written.`
    return report
  }

  const anyProblem = report.weeks.some((plan) => plan.problems.length > 0)
  if (!apply || anyProblem) {
    report.ok = !anyProblem
    return report
  }

  const stamp = time.now().toISOString()
  const noQueue = new Set<string>()
  const noCorrections = new Map<string, MovedKey[]>()
  try {
    for (const plan of report.weeks) {
      if (plan.updates.length > 0) {
        report.wrote = true
        await writeThroughDoor(db, INGEST_DOOR, season, plan.week, stamp, plan.updates, noQueue, noCorrections, report.door, false)
        report.linesWritten += plan.updates.length
      }
      if (plan.newRows.length > 0) {
        report.wrote = true
        await writeThroughDoor(db, INGEST_DOOR, season, plan.week, stamp, plan.newRows, noQueue, noCorrections, report.door, teamColumn)
        report.linesWritten += plan.newRows.length
      }
    }
  } catch (err) {
    report.writeFailure = `${err instanceof Error ? err.message : String(err)} — ${report.linesWritten} lines were written before it; re-running is safe, it diffs against what landed`
    return report
  }

  for (const plan of report.weeks) {
    let after: Map<string, StatRow>
    try {
      after = await readStats(db, season, plan.week, teamColumn)
    } catch (err) {
      // The writes landed: say so, and let the report print, rather than throw past it.
      report.afterProblems.push(
        `could not re-read week ${plan.week}: ${err instanceof Error ? err.message : String(err)}; ${report.linesWritten} lines were written in this run; ` +
          'nothing after this was checked — re-run (it plans against what landed) to re-check',
      )
      break
    }
    report.afterProblems.push(...afterWriteProblems(plan, before.get(plan.week)!, after, positions))
  }
  const { stats, corrections } = report.door
  const unexpected = stats.enqueued + stats.restamped + corrections.recorded + corrections.replayed + corrections.unchangedAtWrite
  if (unexpected !== 0) report.afterProblems.push(`the door reports ${unexpected} queue rows or events; this tool sends none`)
  report.ok = report.afterProblems.length === 0
  return report
}

// ── Output ─────────────────────────────────────────────────────────────────

function movesText(moves: Readonly<Record<RuledColumn, number>>): string {
  return RULED_COLUMNS.filter((column) => moves[column] > 0).map((column) => `${column}=${moves[column]}`).join(' ') || 'no ruled column moved'
}

function sumMoves(moves: Readonly<Record<RuledColumn, number>>): number {
  return RULED_COLUMNS.reduce((sum, column) => sum + moves[column], 0)
}

/** Week by week, key by key, every other-column difference, every problem. */
export function renderFill(report: FillReport): string[] {
  if (report.refused !== undefined) return [`REFUSED [${report.season}]: ${report.refused}`]
  const lines: string[] = []
  const totals = Object.fromEntries(RULED_COLUMNS.map((column) => [column, 0])) as Record<RuledColumn, number>
  let updated = 0
  let inserted = 0
  let others = 0
  let fromStored = 0
  for (const plan of report.weeks) {
    updated += plan.updates.length
    inserted += plan.newRows.length
    others += plan.otherDifferences.length
    fromStored += plan.fromStoredValue.length
    for (const column of RULED_COLUMNS) totals[column] += plan.moves[column]
    const byPosition = Object.entries(plan.storedOnlyByPosition)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([position, count]) => `${position || 'no position'} ${count}`)
      .join(', ')
    lines.push(
      `  week ${plan.week}: ${plan.updates.length + plan.newRows.length} lines to write (${plan.updates.length} updated, ${plan.newRows.length} new), ` +
        `${sumMoves(plan.moves)} moves: ${movesText(plan.moves)} | feed lines=${plan.feedLines} unchanged=${plan.unchanged} ` +
        `unknownPlayers=${plan.unknownPlayers} empty=${plan.empty} repeats=${plan.duplicates} zeroNewLines=${plan.zeroNewLines} storedOnly=${plan.storedOnly}` +
        (byPosition === '' ? '' : ` (${byPosition})`),
    )
    for (const row of plan.newRows) lines.push(`      new line ${row.player_id}: ${ruledValues(row).join(', ')}`)
    for (const move of plan.fromStoredValue) lines.push(`      from a stored value ${move.player_id} ${move.column}: stored ${move.stored} → feed ${move.feed}`)
    for (const other of plan.otherDifferences) lines.push(`      other (not written) ${other.player_id} ${other.key}: stored ${other.stored} → feed ${other.feed}`)
    for (const [key, count] of Object.entries(plan.contextDifferences)) lines.push(`      display-only (not written) ${key}: ${count} lines differ`)
    for (const problem of plan.problems) lines.push(`      PROBLEM: ${problem}`)
  }
  lines.push(`  all weeks: ${updated + inserted} lines (${updated} updated, ${inserted} new), ${sumMoves(totals)} moves: ${movesText(totals)}; ${fromStored} from a non-zero stored value; ${others} other-column differences`)
  if (report.mode === 'apply' && report.wrote) {
    lines.push(`  written: ${report.linesWritten} lines; queue rows ${report.door.stats.enqueued + report.door.stats.restamped}; events ${report.door.corrections.recorded + report.door.corrections.replayed + report.door.corrections.unchangedAtWrite}`)
  }
  if (report.writeFailure !== undefined) lines.push(`  WRITE FAILED: ${report.writeFailure}`)
  for (const problem of report.afterProblems) lines.push(`  FAILED AFTER WRITING: ${problem}`)
  return lines
}

// ── The CLI (scripts/fill-ruled-columns.ts is only its bindings) ───────────

export interface FillArgs {
  season: number
  weeks: number[]
  apply: boolean
  confirmTarget?: string
}

const USAGE = 'usage: npm run sync:fill-ruled -- --season <yyyy> --weeks <1-3|1,2,4> [--apply --confirm-target <host>]'
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--season', '--weeks', '--confirm-target'])
const seasonSchema = z.coerce.number().int().min(2000).max(2100)

/** Throws, naming the argument, on anything this tool doesn't take: a stale or mistyped flag never runs. */
export function parseFillArgs(argv: readonly string[]): FillArgs {
  const values = new Map<string, string>()
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--apply') {
      apply = true
    } else if (VALUE_FLAGS.has(token)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value — ${USAGE}`)
      if (values.has(token)) throw new Error(`${token} was given twice — ${USAGE}`)
      values.set(token, value)
      i += 1
    } else {
      throw new Error(`unknown argument ${token} — nothing read or written. ${USAGE}`)
    }
  }
  const seasonRaw = values.get('--season')
  const weeksRaw = values.get('--weeks')
  if (seasonRaw === undefined || weeksRaw === undefined) throw new Error(USAGE)
  const season = seasonSchema.safeParse(seasonRaw)
  if (!season.success) throw new Error(`Invalid --season: ${seasonRaw}`)
  return { season: season.data, weeks: parseWeeks(weeksRaw), apply, confirmTarget: values.get('--confirm-target') }
}

export interface FillCliIo {
  supabaseUrl: string | undefined
  /** Called only once the arguments and the target have passed. */
  connect: () => ReingestDeps
  log: (line: string) => void
  error: (line: string) => void
}

/** The whole CLI as a function: returns the exit code. 2 = bad arguments or target, 1 = refused, a problem, or a failed check. */
export async function runFillCli(argv: readonly string[], io: FillCliIo): Promise<number> {
  let args: FillArgs
  try {
    args = parseFillArgs(argv)
  } catch (err) {
    io.error((err as Error).message)
    return 2
  }
  const url = io.supabaseUrl ?? ''
  let host: string
  try {
    host = new URL(url).host
  } catch {
    io.error(`NEXT_PUBLIC_SUPABASE_URL is not a URL: "${url}"`)
    return 2
  }
  io.log(`target: ${host}`)
  if (args.apply || args.confirmTarget !== undefined) {
    try {
      confirmTarget(url, args.confirmTarget)
    } catch (err) {
      io.error((err as Error).message)
      return 2
    }
  }

  const report = await fillRuledColumns(io.connect(), { season: args.season, weeks: args.weeks, apply: args.apply })
  const weeks = args.weeks.join(',')
  io.log(`${args.apply ? 'Fill' : 'Plan'} [${args.season}] weeks ${weeks} → ${host}`)
  for (const line of renderFill(report)) io.log(line)
  if (report.refused !== undefined) {
    io.error('REFUSED — nothing written; see the line above')
    return 1
  }
  if (report.writeFailure !== undefined || report.afterProblems.length > 0) {
    io.error('FAILED — see the lines above')
    return 1
  }
  if (!report.ok) {
    io.error(args.apply ? 'REFUSED — problems above; nothing written' : 'PROBLEMS above — --apply would write nothing until they are explained')
    return 1
  }
  if (args.apply) io.log('Done — ruled columns only; no queue row, no event; K identities and row counts hold.')
  else io.log(`Plan only — nothing written. To write it: npm run sync:fill-ruled -- --season ${args.season} --weeks ${weeks} --apply --confirm-target ${host}`)
  return 0
}
