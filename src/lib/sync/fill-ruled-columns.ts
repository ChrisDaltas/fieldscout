/**
 * fill-ruled-columns — the quiet fill behind `npm run sync:fill-ruled`
 * (PROGRESS F870, F871, F890, D832, D833, D835). Chris 2026-11-05, on the
 * questions asked 2026-11-04: "go on league kickers and the other plays".
 *
 * WHY IT EXISTS. The stat-feed mapping left seven columns empty on past weeks,
 * and every stored rules document already pays them. Filling those columns is
 * the first half of re-scoring weeks that have finished. Migration 218 (F871,
 * D835) added two more, `fg_60_plus` and `def_2pt_return` (217's columns, which
 * the map fills from `fgm_60p` and `def_2pt`): nine in all. A finished week's
 * stored rules don't name those two (Q64: they pay from the live week on), so
 * filling them moves stats pages and box-score lines, not a finished week's
 * score. `sync:reingest` can't
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
 *      as stored. A line with no stored row is one of four (D833), a
 *      display-only `advanced` key aside: (a) one with nothing on it is
 *      counted (`zeroNewLines`); (b) one with no ruled value but other data is
 *      a late line (`lateLines`, F895): the provider's, never stored, so it is
 *      listed by player, its keys print as other differences, and it is not
 *      written and blocks nothing; (c) one with a ruled value and other data
 *      beside it is a problem, so a late provider line can't slip in with the
 *      fill; (d) one with ruled values only goes in. A fill only raises: a
 *      ruled value the feed reads below a non-zero stored one is a problem,
 *      named by player, and every move from a non-zero stored value is listed
 *      by player, as is every move on a column the feed sums with a part
 *      already stored (`SUMMED_RULED_COLUMNS`, 0 → n included: F890 holds the
 *      values). A partial read is a problem too: a position with stored lines
 *      that the feed carried none of this week, or a stored D/ST line the feed
 *      doesn't carry. A missing offense line is counted by position, not
 *      blocked.
 *   4. WRITES ONLY WITH `apply`, and only with no problem anywhere: through
 *      `ingest_write_batch` with `enqueue: false` and `corrections: []` (legal
 *      at 167:291), so no event and no queue row. The door sets exactly the
 *      columns sent (167's step 4). The plan is handed to `beforeWrite`
 *      first, so the CLI prints it before the first door call.
 *   5. ASSERTS AFTER, LOUD: the K identities on every stored K line, row counts
 *      equal to the plan, nothing moved outside the ruled columns.
 *   6. RECORDS ITS FIX (migration 222; PROGRESS D839; Chris 2026-11-07, "the
 *      stats need to be correct. that should be done automatically"). Before
 *      the first write, every move — week, player, column, stored → feed (0
 *      for a new line) — is recorded as a stat fix (`record_stat_fix`), not
 *      yet written; once the after-write checks pass it is marked written
 *      (`mark_stat_fix_written`), and from then on the score-week pass
 *      re-scores every final league-week it touches, quietly, paying exactly
 *      these moves (`stat-fix-rescore.ts`). A run whose checks fail leaves it
 *      unwritten: nothing applies from it, and the RE-RUN finishes it (round
 *      5): it records one fix holding every move — the ones that landed then
 *      and the ones it writes now — in place of the unwritten one
 *      (`p_supersedes`, one transaction), so every move that landed is paid,
 *      once. A database without 222 refuses `--apply` by name before any
 *      write. The fill itself still writes no league table.
 *   7. NEVER WRITES THE PROVIDER'S LATE CORRECTION AS OURS (round 5, F405 /
 *      Q81). A stored ruled value a WRITTEN stat fix of ours set, that the
 *      feed now reads higher, moved at the provider after our fix: listed by
 *      player, not written, not recorded, not paid. (Lower stays a problem.)
 *
 * Time only via `time`; provider reads only via `provider`; every table read
 * pages past the PostgREST cap. It never touches `nfl_games`, `nfl_weeks` or
 * `system_flags`, and it never runs itself: the CLI is
 * `scripts/fill-ruled-columns.ts`.
 */

import { z } from 'zod'

import type { StatFixLine } from '@/lib/leagues/scoring/stat-fix-rescore'
import type { ProviderPlayerWeekStats } from '@/lib/leagues/stats/stats-provider'
import { isMissingSchemaObject } from '@/lib/supabase/postgrest-errors'
import type { Json } from '@/types/database'
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
  // F871 / migration 218 (D835): the 60+ make's top-up count and the D/ST
  // two-point return.
  'fg_60_plus',
  'def_2pt_return',
] as const
export type RuledColumn = (typeof RULED_COLUMNS)[number]
const RULED: ReadonlySet<string> = new Set(RULED_COLUMNS)

/**
 * Ruled columns the feed hands over already summed with a part the old map
 * stored (PROGRESS F890, D832; review round 2). `def_fumble_recoveries` reads
 * `fum_rec + def_st_fum_rec`; its stored value is `fum_rec` alone, a locked
 * week's value. A late provider fix raising `fum_rec` on a team-week that is
 * filling anyway is one move, the same count as a clean fill, and from a
 * stored 0 it isn't a move off a stored value either. This checkout can't
 * split the sum (the canonical key arrives summed), so every move on such a
 * column is listed by player, stored → feed, and F890 carries the values a
 * run must print: any other value is a provider fix hiding inside the fill.
 */
export const SUMMED_RULED_COLUMNS = ['def_fumble_recoveries'] as const satisfies readonly RuledColumn[]
const SUMMED: ReadonlySet<string> = new Set(SUMMED_RULED_COLUMNS)

/** Code-point order: the same on every machine, whatever its locale. */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

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

/**
 * `players.id` → position (also the known-player set, the FK target of a new
 * line) and → `full_name`, which only the printed output reads.
 */
async function readPlayerPositions(db: SyncClient): Promise<{ positions: Map<string, string>; names: Map<string, string> }> {
  const rows = await pageAll<{ id: string; position: string | null; full_name: string | null }>((from, to) =>
    db.from('players').select('id, position, full_name', { count: 'exact' }).order('id').range(from, to),
  )
  if (rows.length === 0) throw new Error('players is empty — every line would read as unknown (refusing to call that success)')
  return {
    positions: new Map(rows.map((row) => [row.id, row.position ?? ''])),
    names: new Map(rows.filter((row) => typeof row.full_name === 'string' && row.full_name !== '').map((row) => [row.id, row.full_name as string])),
  }
}

const NO_NAMES: ReadonlyMap<string, string> = new Map()

/** `full_name (id)` for a printed line; the bare id for a player `players` doesn't know. */
export function who(names: ReadonlyMap<string, string>, id: string): string {
  const name = names.get(id)
  return name === undefined ? id : `${name} (${id})`
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

/** One ruled value's move, by player. `stored` is 0 for a line with no stored row. */
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
  /** New lines with nothing on them, a display-only `advanced` key aside: nothing to fill, so not inserted (D833 (a)). */
  zeroNewLines: number
  /**
   * New lines with no ruled value that carry other data, by player id in
   * code-point order (D833 (b), F895). Not written, not a problem, not a move,
   * not counted in any row count; their keys are in `otherDifferences`.
   */
  lateLines: string[]
  /** Stored lines the feed doesn't carry (untouched). */
  storedOnly: number
  /** The same, by `players.position` ('' when the player has none). */
  storedOnlyByPosition: Record<string, number>
  /** Stored lines to rewrite: stored metadata plus the ruled columns only. */
  updates: StatRow[]
  /** New lines carrying ruled values and nothing else, a display-only `advanced` key aside (D833 (d)): the full `toStatRow` surface. */
  newRows: StatRow[]
  /** How many values each ruled column moves, new lines included. */
  moves: Record<RuledColumn, number>
  /** Every move whose stored value is not 0, by player: the ones a count alone can't explain. A lowered one is also a problem. */
  fromStoredValue: StoredValueMove[]
  /**
   * Round 5 (F405 / Q81): a stored value a WRITTEN stat fix of ours set that
   * the feed now reads higher — the provider's late correction, after our fix.
   * Listed by player; not written, not a move, not recorded, not paid. (Lower
   * is a problem, as for any stored value.)
   */
  providerMoves: StoredValueMove[]
  /** Every move on a `SUMMED_RULED_COLUMNS` column, 0 → n and new lines included, by column then player id. */
  summedMoves: StoredValueMove[]
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

/**
 * `fg_0_39 + fg_made_40_plus + fg_made_50_plus = fg_made`,
 * `fg_attempted - fg_made = fg_missed`, and `fg_60_plus <= fg_made_50_plus`: a
 * 60+ make is also a 50+ make (`fgm_50p` = `fgm_50_59 + fgm_60p` on 954 of 954
 * saved kicker lines), so more 60+ makes than 50+ makes is a broken line.
 */
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
  if (read('fg_60_plus') > read('fg_made_50_plus')) {
    out.push(`K ${playerId}: fg_60_plus ${read('fg_60_plus')} is more than fg_made_50_plus ${read('fg_made_50_plus')} (a 60+ make is also a 50+ make)`)
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
  /** `players.full_name` by id, for the problem text only. */
  names?: ReadonlyMap<string, string>
  /** This week's values our WRITTEN stat fixes set, `${player_id}|${column}` → after (round 5: what moved from one since is the provider's). */
  ours?: ReadonlyMap<string, number>
}

export function planFillWeek(input: PlanInput): FillWeekPlan {
  const { week, lines, stored, positions, ctx, unsendable } = input
  const label = (id: string) => who(input.names ?? NO_NAMES, id)
  const plan: FillWeekPlan = {
    week,
    feedLines: lines.length,
    unknownPlayers: 0,
    empty: 0,
    duplicates: 0,
    unchanged: 0,
    zeroNewLines: 0,
    lateLines: [],
    storedOnly: 0,
    storedOnlyByPosition: {},
    updates: [],
    newRows: [],
    moves: Object.fromEntries(RULED_COLUMNS.map((column) => [column, 0])) as Record<RuledColumn, number>,
    fromStoredValue: [],
    providerMoves: [],
    summedMoves: [],
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
        if (positions.get(id) === 'DEF' && !feedIds.has(id)) plan.problems.push(`week ${week}: the feed doesn't carry D/ST ${label(id)}, which has a stored line — a partial read`)
      }
    }
  }

  const unique = collapseIdenticalRows(known)
  plan.duplicates = unique.collapsed
  // F831's reading: which of two different lines to believe is not decided here.
  const conflicts = conflictingPlayers(unique.rows)
  if (conflicts.length > 0) {
    plan.problems.push(`week ${week}: the feed carries two different lines for ${conflicts.map(label).join(', ')} — this week is not planned (F831)`)
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
      if (carried.length === 0) {
        // Nothing to fill. Other data on it is a provider line never stored (F895): listed, not this fill's to write or block (D833).
        if (others.length > 0) plan.lateLines.push(id)
        else plan.zeroNewLines += 1
      } else if (others.length > 0) {
        plan.problems.push(`week ${week}: new line for ${label(id)} also carries ${others.map((o) => `${o.key}=${o.feed}`).join(', ')} — a late provider line, not written`)
      } else {
        plan.newRows.push(row)
        wouldBe.set(id, row.columns)
        for (const column of RULED_COLUMNS) {
          const now = row.columns[column] ?? 0
          if (now === 0) continue
          plan.moves[column] += 1
          if (SUMMED.has(column)) plan.summedMoves.push({ player_id: id, column, stored: 0, feed: now })
        }
      }
      continue
    }

    for (const key of CONTEXT_ADVANCED_KEYS) {
      if (prior.advanced[key] !== row.advanced[key]) plan.contextDifferences[key] = (plan.contextDifferences[key] ?? 0) + 1
    }
    const differ = RULED_COLUMNS.filter((column) => (prior.columns[column] ?? 0) !== (row.columns[column] ?? 0))
    if (differ.length === 0) {
      plan.unchanged += 1
      continue
    }
    // Round 5 (F405 / Q81): a stored value a WRITTEN fix of ours set, that the feed now reads HIGHER, moved at the
    // PROVIDER after our fix — its late correction. Never this fill's to write, record or pay; listed by player. (A
    // lower reading stays the problem below: a late provider fix or a map that reads less, either way loud.)
    const theirs = new Set(
      differ.filter((column) => input.ours?.get(`${id}|${column}`) === (prior.columns[column] ?? 0) && (row.columns[column] ?? 0) > (prior.columns[column] ?? 0)),
    )
    for (const column of theirs) plan.providerMoves.push({ player_id: id, column, stored: prior.columns[column] ?? 0, feed: row.columns[column] ?? 0 })
    const moved = differ.filter((column) => !theirs.has(column))
    if (moved.length === 0) continue
    for (const column of moved) {
      plan.moves[column] += 1
      const was = prior.columns[column] ?? 0
      const now = row.columns[column] ?? 0
      if (SUMMED.has(column)) plan.summedMoves.push({ player_id: id, column, stored: was, feed: now })
      if (was === 0) continue
      plan.fromStoredValue.push({ player_id: id, column, stored: was, feed: now })
      // A fill only adds plays the old map dropped. A lower reading is a provider fix or a map that reads less.
      if (now < was) plan.problems.push(`week ${week}: ${label(id)} ${column} would go down from ${was} to ${now} — lowering a stored value is not a fill (a late provider fix, or a map that reads less)`)
    }
    const ruled = Object.fromEntries(RULED_COLUMNS.map((column) => [column, theirs.has(column) ? (prior.columns[column] ?? 0) : (row.columns[column] ?? 0)]))
    // `team` stays off the line: the door leaves a column it isn't sent alone.
    plan.updates.push({ player_id: id, game_id: prior.game_id, is_live: prior.is_live, source: prior.source, advanced: prior.advanced, columns: ruled })
    wouldBe.set(id, { ...prior.columns, ...ruled })
    const why = unsendable?.get(id)
    if (why !== undefined) plan.problems.push(`week ${week}: ${label(id)} can't be rewritten — ${why}`)
  }

  // Checked here as well as after the write, so a failing identity blocks the run instead of being found once it is written.
  for (const [id, columns] of wouldBe) {
    if (positions.get(id) === 'K') plan.problems.push(...kIdentityFailures(label(id), columns).map((failure) => `week ${week}: ${failure}`))
  }
  // A fixed order, so the printed line compares with F890's text as it stands.
  plan.summedMoves.sort((a, b) => byCodePoint(a.column, b.column) || byCodePoint(a.player_id, b.player_id))
  plan.lateLines.sort(byCodePoint)
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
  names: ReadonlyMap<string, string> = NO_NAMES,
): string[] {
  const week = `week ${plan.week}`
  const label = (id: string) => who(names, id)
  const out: string[] = []
  const expected = before.size + plan.newRows.length
  if (after.size !== expected) out.push(`${week}: ${after.size} stored lines after the fill, the plan says ${expected}`)

  const written = new Map([...plan.updates, ...plan.newRows].map((row) => [row.player_id, row]))
  for (const [id, row] of written) {
    const line = after.get(id)
    if (line === undefined) {
      out.push(`${week}: ${label(id)} has no stored line after the fill`)
      continue
    }
    for (const column of RULED_COLUMNS) {
      const got = line.columns[column] ?? 0
      const want = row.columns[column] ?? 0
      if (got !== want) out.push(`${week}: ${label(id)} ${column} reads ${got} after the fill, the plan wrote ${want}`)
    }
  }
  for (const row of plan.newRows) {
    const line = after.get(row.player_id)
    if (line !== undefined && nonRuledFingerprint(line) !== nonRuledFingerprint(row)) out.push(`${week}: new line ${label(row.player_id)} was stored differently outside the ruled columns`)
  }

  let moved = 0
  for (const [id, prior] of before) {
    const line = after.get(id)
    if (line === undefined) {
      out.push(`${week}: ${label(id)} lost its stored line during the fill`)
      continue
    }
    if (nonRuledFingerprint(prior) !== nonRuledFingerprint(line)) out.push(`${week}: ${label(id)} moved outside the ruled columns during the fill (a concurrent poll, or the write)`)
    if (RULED_COLUMNS.some((column) => (prior.columns[column] ?? 0) !== (line.columns[column] ?? 0))) {
      moved += 1
      if (!written.has(id)) out.push(`${week}: ${label(id)} moved on a ruled column but is not in the plan`)
    }
  }
  if (moved !== plan.updates.length) out.push(`${week}: ${moved} stored lines moved on the ruled columns, the plan says ${plan.updates.length}`)

  for (const [id, line] of after) {
    if (positions.get(id) === 'K') out.push(...kIdentityFailures(label(id), line.columns).map((failure) => `${week}: ${failure}`))
  }
  return out
}

// ── One run ────────────────────────────────────────────────────────────────

export interface FillOptions {
  season: number
  /** Ascending, de-duplicated, each 1-18 (`parseWeeks`). */
  weeks: number[]
  apply: boolean
  /**
   * Called once with the finished plan, after every check and before the
   * first door call (only on a run that goes on to write), so the plan is on
   * screen even if the run dies writing.
   */
  beforeWrite?: (report: FillReport) => void
}

export interface FillReport {
  season: number
  mode: 'plan' | 'apply'
  /** false when anything was refused, blocked, or failed. */
  ok: boolean
  /** Set when the run stopped before planning finished. Nothing was written. */
  refused?: string
  weeks: FillWeekPlan[]
  /** `players.full_name` by id: the printed output only. */
  names: ReadonlyMap<string, string>
  /** The door was called at least once. */
  wrote: boolean
  /** The door's counts: all must stay zero. */
  door: DoorTally
  /** Lines in the door calls that returned. A failing call's earlier batches may have landed too, so on a failure it is a floor. */
  linesWritten: number
  /** The door failed partway. The diff makes a re-run safe. */
  writeFailure?: string
  /** Assertions that failed after writing. */
  afterProblems: string[]
  /**
   * 222: the stat fix this run recorded (apply only, when anything moved); `written` once its checks passed.
   * `supersedes`: an earlier run's fix never written, finished here — `carried` of its moves had landed then.
   */
  fix?: { id: string; lines: number; written: boolean; supersedes?: string; carried?: number }
  /** 222: the fix could not be recorded, so nothing was written (a database without 222, or a refusal). */
  fixRefusal?: string
  /** Round 5: a fix an earlier run recorded and never wrote — `--apply` finishes it (the plan says so first). */
  pendingFix?: string
}

/** The fill's stat-fix reason (222): plain words, recorded on every fix it writes. */
export const FILL_FIX_REASON =
  'sync:fill-ruled: the ruled stat columns the feed map left empty on finished weeks (PROGRESS F870, F871, F890, D832; Chris 2026-11-05: "go on league kickers and the other plays")'
/** How a fix the fill recorded is told from any other (the reason's head, whatever words follow it in a later checkout). */
const FILL_FIX_PREFIX = 'sync:fill-ruled:'

/** 222: our stat fixes of one season, as the fill reads them (round 5). */
export interface OurFixes {
  /** `${week}|${player_id}|${column}` → the after value of the newest WRITTEN fix line on it: a value our change set. */
  written: ReadonlyMap<string, number>
  /** Fixes a fill recorded and never wrote (a run whose write or checks failed), oldest first: the re-run finishes them. */
  pending: Array<{ id: string; landed_at: string; lines: StatFixLine[] }>
}

/**
 * Round 5: our stat fixes of the season (222's tables, the service role's
 * read). A database without 222 has none: the plan reads as before, and
 * `--apply` refuses by name at the record.
 */
export async function readOurFixes(db: SyncClient, season: number): Promise<OurFixes> {
  const none: OurFixes = { written: new Map(), pending: [] }
  const probe = await db.from('stat_fixes').select('id').eq('season', season).range(0, 0)
  if (probe.error) {
    if (isMissingSchemaObject(probe.error, ['stat_fixes'])) return none
    throw new Error(`stat_fixes read: ${probe.error.message}`)
  }
  const fixes = await pageAll<{ id: string; reason: string; landed_at: string; written_at: string | null }>((from, to) =>
    db.from('stat_fixes').select('id, reason, landed_at, created_at, written_at', { count: 'exact' }).eq('season', season).order('created_at').order('id').range(from, to),
  )
  if (fixes.length === 0) return none
  const rows = await pageAll<{ fix_id: string; week: number; player_id: string; stat_key: string; before_value: number | string; after_value: number | string }>((from, to) =>
    db
      .from('stat_fix_lines')
      .select('fix_id, week, player_id, stat_key, before_value, after_value', { count: 'exact' })
      .eq('season', season)
      .order('fix_id')
      .order('week')
      .order('player_id')
      .order('stat_key')
      .range(from, to),
  )
  const byFix = new Map<string, StatFixLine[]>()
  for (const r of rows) {
    byFix.set(r.fix_id, [...(byFix.get(r.fix_id) ?? []), { week: r.week, player_id: r.player_id, stat_key: r.stat_key, before: Number(r.before_value), after: Number(r.after_value) }])
  }
  const written = new Map<string, number>()
  const pending: OurFixes['pending'] = []
  // Oldest first: a newer written fix's value on the same key wins.
  for (const fix of fixes) {
    const lines = byFix.get(fix.id) ?? []
    if (fix.written_at !== null) for (const line of lines) written.set(`${line.week}|${line.player_id}|${line.stat_key}`, line.after)
    else if (fix.reason.startsWith(FILL_FIX_PREFIX)) pending.push({ id: fix.id, landed_at: fix.landed_at, lines })
  }
  return { written, pending }
}

/** One week's slice of `OurFixes.written`, keyed `${player_id}|${column}` (planFillWeek's `ours`). */
function oursFor(fixes: OurFixes, week: number): Map<string, number> {
  const head = `${week}|`
  return new Map([...fixes.written].filter(([key]) => key.startsWith(head)).map(([key, after]) => [key.slice(head.length), after]))
}

/**
 * Round 5: an earlier run's fix, recorded and never written (its write failed
 * partway, or its checks did), FINISHED by this run. Each of its moves is, by
 * what is stored now: never landed (at its before — this run's plan, if it
 * moves the value, is the move now: nothing carried), or landed (at its after,
 * and this run moves it no further — ours, still owed its re-score: carried
 * into the one fix this run records in its place). Anything else, or a week
 * this run doesn't read, is a refusal by name: what of it is ours is not
 * known. More than one such fix: refused (a run leaves at most one).
 */
export function finishPendingFix(
  pending: OurFixes['pending'],
  planned: readonly StatFixLine[],
  before: ReadonlyMap<number, ReadonlyMap<string, StatRow>>,
  weeks: readonly number[],
): { fix: OurFixes['pending'][number] | null; carried: StatFixLine[]; refusal?: string } {
  if (pending.length === 0) return { fix: null, carried: [] }
  if (pending.length > 1) {
    return { fix: null, carried: [], refusal: `${pending.length} stat fixes of earlier runs are recorded and never written (${pending.map((f) => f.id).join(', ')}) — a run leaves at most one, so which to finish is not known. Nothing was written.` }
  }
  const fix = pending[0]
  const head = `stat fix ${fix.id} (an earlier run’s, recorded and never written) can’t be finished`
  const fixWeeks = [...new Set(fix.lines.map((line) => line.week))].sort((a, b) => a - b)
  const unread = fixWeeks.filter((week) => !weeks.includes(week))
  if (unread.length > 0) {
    const all = [...new Set([...weeks, ...fixWeeks])].sort((a, b) => a - b)
    return { fix: null, carried: [], refusal: `${head}: ${unread.map((week) => `it moves week ${week}, which this run does not read`).join('; ')} — re-run with its weeks (${all.join(', ')}). Nothing was written.` }
  }
  const movingNow = new Set(planned.map((line) => `${line.week}|${line.player_id}|${line.stat_key}`))
  const carried: StatFixLine[] = []
  const problems: string[] = []
  for (const line of fix.lines) {
    const stored = before.get(line.week)?.get(line.player_id)?.columns[line.stat_key] ?? 0
    if (stored === line.before) continue
    const where = `week ${line.week} ${line.player_id} ${line.stat_key}`
    if (stored === line.after && !movingNow.has(`${line.week}|${line.player_id}|${line.stat_key}`)) carried.push(line)
    else if (stored === line.after) problems.push(`${where} landed at its after (${line.after}) and this run moves it on from there — what of that is ours is not known`)
    else problems.push(`${where} reads ${stored} now, neither its before (${line.before}) nor its after (${line.after}) — moved by something else since, so what of it is ours is not known`)
  }
  if (problems.length > 0) return { fix: null, carried: [], refusal: `${head}: ${problems.join('; ')}. Nothing was written.` }
  return { fix, carried }
}

/**
 * Every move a plan writes, as stat-fix lines (222): an updated line's ruled
 * columns that differ from the stored ones (stored → feed), a new line's
 * non-zero ruled columns (0 → feed).
 */
export function fixLinesOf(plans: readonly FillWeekPlan[], before: ReadonlyMap<number, ReadonlyMap<string, StatRow>>): StatFixLine[] {
  const out: StatFixLine[] = []
  for (const plan of plans) {
    const stored = before.get(plan.week) ?? new Map<string, StatRow>()
    for (const row of plan.updates) {
      const prior = stored.get(row.player_id)
      for (const column of RULED_COLUMNS) {
        const was = prior?.columns[column] ?? 0
        const now = row.columns[column] ?? 0
        if (was !== now) out.push({ week: plan.week, player_id: row.player_id, stat_key: column, before: was, after: now })
      }
    }
    for (const row of plan.newRows) {
      for (const column of RULED_COLUMNS) {
        const now = row.columns[column] ?? 0
        if (now !== 0) out.push({ week: plan.week, player_id: row.player_id, stat_key: column, before: 0, after: now })
      }
    }
  }
  return out
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
    names: NO_NAMES,
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

  const { positions, names } = await readPlayerPositions(db)
  report.names = names
  const teamColumn = await statTeamColumn(db)
  const games = await readGames(db, season)
  const gameStatus = new Map([...games.values()].map((game) => [game.id, game.status]))
  // Round 5: our written fixes (what moved from a value one of them set is the provider's) and a fix a failed run left unwritten.
  const ours = await readOurFixes(db, season)
  if (ours.pending.length > 0) report.pendingFix = ours.pending.map((fix) => fix.id).join(', ')

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
        names,
        ours: oursFor(ours, week),
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

  opts.beforeWrite?.(report)
  const stamp = time.now().toISOString()
  // 222: the fix is recorded BEFORE any write (not yet written: nothing applies from it until the checks below pass).
  const planned = fixLinesOf(report.weeks, before)
  // Round 5: a fix an earlier run left unwritten is FINISHED here — the moves of it that landed join this run's in one
  // fix recorded in its place (p_supersedes withdraws it in the same transaction), landed when the first of them did.
  const finish = finishPendingFix(ours.pending, planned, before, weeks)
  if (finish.refusal !== undefined) {
    report.fixRefusal = finish.refusal
    return report
  }
  const lines = [...planned, ...finish.carried]
  if (lines.length > 0) {
    const recorded = await db.rpc('record_stat_fix', {
      p_season: season,
      p_reason: FILL_FIX_REASON,
      p_lines: lines as unknown as Json,
      p_landed_at: finish.fix?.landed_at ?? stamp,
      ...(finish.fix ? { p_supersedes: finish.fix.id } : {}),
    })
    if (recorded.error) {
      report.fixRefusal = isMissingSchemaObject(recorded.error, ['record_stat_fix'])
        ? 'the database predates migration 222 (no record_stat_fix): a fill records its fix before it writes, so every final week it touches re-scores by itself — push 222 first. Nothing was written.'
        : `record_stat_fix refused the fix: ${recorded.error.message}. Nothing was written.`
      return report
    }
    report.fix = { id: recorded.data as string, lines: lines.length, written: false, ...(finish.fix ? { supersedes: finish.fix.id, carried: finish.carried.length } : {}) }
  }
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
    // A failing call's earlier batches of 500 may have landed, and a batch that fails its count checks did land: a floor, not a count.
    // Round 5: never "re-running is safe" while our fix is unwritten without saying what the re-run does with it.
    report.writeFailure =
      `${err instanceof Error ? err.message : String(err)} — at least ${report.linesWritten} lines were written before it` +
      (report.fix === undefined
        ? '; re-running is safe, it diffs against what landed'
        : `. Stat fix ${report.fix.id} stays recorded but NOT written: nothing applies from it yet. Re-run the same command once the cause is fixed: it plans against what landed and finishes this fix (one fix holding every move, landed or not, in its place).`)
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
    report.afterProblems.push(...afterWriteProblems(plan, before.get(plan.week)!, after, positions, names))
  }
  // writeThroughDoor already throws on a batch whose counts don't sum to 0, so on
  // integer counts this can't fire. Kept: on counts that aren't whole numbers,
  // float sums across batches can disagree with the per-batch sums.
  const { stats, corrections } = report.door
  const unexpected = stats.enqueued + stats.restamped + corrections.recorded + corrections.replayed + corrections.unchangedAtWrite
  if (unexpected !== 0) report.afterProblems.push(`the door reports ${unexpected} queue rows or events; this tool sends none`)
  if (report.fix !== undefined) {
    if (report.afterProblems.length > 0) {
      report.afterProblems.push(
        `stat fix ${report.fix.id} stays recorded but NOT written: nothing applies from it yet — once the lines are explained, re-run the same command: it finishes this fix (one fix holding every move, landed or not, in its place)`,
      )
    } else {
      const marked = await db.rpc('mark_stat_fix_written', { p_fix_id: report.fix.id })
      if (!marked.error) {
        report.fix.written = true
      } else {
        // An error is not "not written": the mark may have committed and only its reply been lost. Read it back.
        const back = await db.from('stat_fixes').select('written_at').eq('id', report.fix.id)
        if (!back.error && (back.data ?? [])[0]?.written_at) report.fix.written = true
        else {
          report.afterProblems.push(
            `stat fix ${report.fix.id} could not be marked written (${marked.error.message}${back.error ? `; read-back: ${back.error.message}` : ''}): nothing applies from it yet — re-run the same command: it finishes this fix (a move a written fix holds is never recorded twice)`,
          )
        }
      }
    }
  }
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

/** The whole report: the plan, then what the write did. */
export function renderFill(report: FillReport): string[] {
  return [...renderFillPlan(report), ...renderFillWrite(report)]
}

/** Week by week, key by key, every late line, every other-column difference, every problem. */
export function renderFillPlan(report: FillReport): string[] {
  if (report.refused !== undefined) return [`REFUSED [${report.season}]: ${report.refused}`]
  const name = (id: string) => who(report.names, id)
  const lines: string[] = []
  const totals = Object.fromEntries(RULED_COLUMNS.map((column) => [column, 0])) as Record<RuledColumn, number>
  let updated = 0
  let inserted = 0
  let others = 0
  let fromStored = 0
  let late = 0
  for (const plan of report.weeks) {
    updated += plan.updates.length
    inserted += plan.newRows.length
    others += plan.otherDifferences.length
    fromStored += plan.fromStoredValue.length
    late += plan.lateLines.length
    for (const column of RULED_COLUMNS) totals[column] += plan.moves[column]
    const byPosition = Object.entries(plan.storedOnlyByPosition)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([position, count]) => `${position || 'no position'} ${count}`)
      .join(', ')
    lines.push(
      `  week ${plan.week}: ${plan.updates.length + plan.newRows.length} lines to write (${plan.updates.length} updated, ${plan.newRows.length} new), ` +
        `${sumMoves(plan.moves)} moves: ${movesText(plan.moves)} | feed lines=${plan.feedLines} unchanged=${plan.unchanged} ` +
        `unknownPlayers=${plan.unknownPlayers} empty=${plan.empty} repeats=${plan.duplicates} zeroNewLines=${plan.zeroNewLines} lateLines=${plan.lateLines.length} storedOnly=${plan.storedOnly}` +
        (byPosition === '' ? '' : ` (${byPosition})`),
    )
    for (const row of plan.newRows) lines.push(`      new line ${row.player_id}: ${ruledValues(row).join(', ')}`)
    for (const id of plan.lateLines) lines.push(`      late line (not written, F895) ${name(id)}: no ruled value`)
    for (const move of plan.fromStoredValue) lines.push(`      from a stored value ${move.player_id} ${move.column}: stored ${move.stored} → feed ${move.feed}`)
    for (const move of plan.providerMoves) lines.push(`      the provider’s since our fix (not written, not paid — F405) ${name(move.player_id)} ${move.column}: our fix wrote ${move.stored} → feed ${move.feed}`)
    for (const move of plan.summedMoves) lines.push(`      summed ${move.column} ${name(move.player_id)}: stored ${move.stored} → feed ${move.feed}`)
    for (const other of plan.otherDifferences) lines.push(`      other (not written) ${name(other.player_id)} ${other.key}: stored ${other.stored} → feed ${other.feed}`)
    for (const [key, count] of Object.entries(plan.contextDifferences)) lines.push(`      display-only (not written) ${key}: ${count} lines differ`)
    for (const problem of plan.problems) lines.push(`      PROBLEM: ${problem}`)
  }
  lines.push(
    `  all weeks: ${updated + inserted} lines (${updated} updated, ${inserted} new), ${sumMoves(totals)} moves: ${movesText(totals)}; ` +
      `${fromStored} from a non-zero stored value; ${others} other-column differences; ${late} late lines (not written)`,
  )
  if (report.pendingFix !== undefined) {
    lines.push(`  stat fix ${report.pendingFix}: an earlier run’s, recorded and never written — --apply finishes it (every move of it that landed goes into the one fix it records)`)
  }
  // Every move on a summed column, 0 → n included: the line F890's values are compared with, value by value.
  // Ids only, so it compares with F890's text as written: names never go in a repo file. The week lines above carry the names.
  for (const column of SUMMED_RULED_COLUMNS) {
    const byWeek = report.weeks
      .map((plan) => ({ week: plan.week, moves: plan.summedMoves.filter((move) => move.column === column) }))
      .filter((entry) => entry.moves.length > 0)
      .map((entry) => `wk${entry.week} ${entry.moves.map((move) => `${move.player_id} ${move.stored}→${move.feed}`).join(', ')}`)
    lines.push(`  all weeks ${column} by player, stored → feed: ${byWeek.join('; ') || 'none'}`)
  }
  return lines
}

/** What the write did: the count, a failure partway, every failed check after it. */
export function renderFillWrite(report: FillReport): string[] {
  if (report.refused !== undefined) return []
  const lines: string[] = []
  if (report.mode === 'apply' && report.wrote) {
    lines.push(
      `  written: ${report.writeFailure === undefined ? '' : 'at least '}${report.linesWritten} lines; ` +
        `queue rows ${report.door.stats.enqueued + report.door.stats.restamped}; events ${report.door.corrections.recorded + report.door.corrections.replayed + report.door.corrections.unchangedAtWrite}`,
    )
  }
  if (report.fixRefusal !== undefined) lines.push(`  REFUSED: ${report.fixRefusal}`)
  if (report.fix !== undefined) {
    lines.push(
      `  stat fix ${report.fix.id}: ${report.fix.lines} move(s) recorded${report.fix.written ? ' and written — the score-week pass re-scores every final league-week they touch, quietly' : ', NOT written — nothing applies from it'}` +
        (report.fix.supersedes === undefined ? '' : ` (in place of ${report.fix.supersedes}, an earlier run’s fix never written: ${report.fix.carried} of its moves had landed)`),
    )
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

/** The one season the fill is ruled for (F890). 2025 is F872's call, not ruled. */
export const FILL_SEASON = 2026

const USAGE = `usage: npm run sync:fill-ruled -- --season ${FILL_SEASON} --weeks <1-3|1,2,4> [--apply --confirm-target <host>]`
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
  if (season.data !== FILL_SEASON) {
    throw new Error(`--season ${season.data} refused: this tool fills ${FILL_SEASON} only (2025 is F872, not ruled). Nothing read or written.`)
  }
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

  const weeks = args.weeks.join(',')
  let planPrinted = false
  const printPlan = (planned: FillReport) => {
    io.log(`${args.apply ? 'Fill' : 'Plan'} [${args.season}] weeks ${weeks} → ${host}`)
    for (const line of renderFillPlan(planned)) io.log(line)
    planPrinted = true
  }
  // An --apply that goes on to write prints its plan before the first door call.
  const report = await fillRuledColumns(io.connect(), { season: args.season, weeks: args.weeks, apply: args.apply, beforeWrite: printPlan })
  if (!planPrinted) printPlan(report)
  for (const line of renderFillWrite(report)) io.log(line)
  if (report.refused !== undefined || report.fixRefusal !== undefined) {
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
  // Round 5: "the fix is written" only when it is — a run that moved nothing recorded none.
  if (args.apply) {
    io.log(
      `Done — ruled columns only; no queue row, no event; K identities and row counts hold; ${report.fix?.written ? 'the fix is written, so final weeks re-score by themselves.' : 'nothing moved, so no stat fix was recorded.'}`,
    )
  }
  else io.log(`Plan only — nothing written. To write it: npm run sync:fill-ruled -- --season ${args.season} --weeks ${weeks} --apply --confirm-target ${host}`)
  return 0
}
