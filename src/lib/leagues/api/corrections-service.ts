/**
 * The league's stat corrections — M6 task L.E2.3, `GET /api/leagues/[id]/corrections?week=`
 * (spec §15.3 "stat corrections filtered to this league's starters", §23.4's
 * league-facing "Stat Corrections" view; tasks-M6 §6 L.E2.3 read through Q81;
 * PROGRESS D438 / D453 / D454).
 *
 * **What it reads.** 172's `league_stat_corrections` — the league's own record
 * of a correction that CHANGED one of its scores: one row per team that
 * STARTED the corrected player that week, written by the scoring door in the
 * same transaction as the re-score (D453(1)). Q81 (Chris 2026-09-29) struck
 * everything else: a fix after the window changes nothing in the league, so
 * it has no row here and there is **no `week final — scores unchanged`
 * label** and no "would have been" number (F510 — the breakdown's sentence is
 * superseded; every row this read can serve is an applied correction, so no
 * state field is sent at all).
 *
 * **Each correction, in plain words** (tasks-M6 §4 rule 10): the player, each
 * moved stat by its words (`stat-correction-labels.ts` — the same map the
 * door's post is generated from, so the view and the post say the same
 * words), old → new, the team, his points before → after, the team's score
 * before → after, and the result change — the matchup, the second game and
 * the median game — once the week's games were over (NULL results before
 * that: the record carries the score change only, D453(4)). `summary` is the
 * post's own sentence shape for the one record.
 *
 * **Membership first — the in-season family's no-leak 403 (R807; D387(3)'s
 * precedent).** The task's proof line says "non-member 404"; the family
 * answers ONE 403 for a non-member and a nonexistent league alike, and a 404
 * by name only for a member whose league was soft-deleted (R812). The table
 * is member-SELECT (172), so without the gate a non-member would read an
 * EMPTY list — the exact "nothing happened" shape CLAUDE.md forbids.
 *
 * **A week with none says so.** An empty first page carries `note` in words
 * ("No stat correction changed a score in this league in Week 3."), so an
 * empty list is never inferred — it is asserted.
 *
 * **Paged** by the house composite cursor `(recorded_at, id)` (R770), opaque
 * like the commissioner log's (`encodeCommishLogCursor`), over-fetched by one
 * so `has_more` is measured; the page ceiling sits far below PostgREST's
 * 1000-row cap.
 *
 * **Deploy before push (TD15 / D448).** On a database without 172 the table
 * is absent: PostgREST answers a GET with PGRST205 (Postgres 42P01), anchored
 * on the table's NAME (`isMissingSchemaObject`) ⇒ a named 503, never a 500
 * and never a silent empty list. Production is at 172, so this is the
 * rollback / fresh-environment path. Read by GET, never HEAD (R1257).
 *
 * No Date/random read here (the `src/lib/leagues/**` ESLint fences): the
 * cursor is the caller's, the ordering the database's.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { correctionLabel } from '@/lib/leagues/scoring/stat-correction-labels'
import { isMissingSchemaObject } from '@/lib/supabase/postgrest-errors'
import type { Database, Json } from '@/types/database'

import { decodeCommishLogCursor, encodeCommishLogCursor } from './commish-log-service'
import { assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

export const CORRECTIONS_MAX_LIMIT = 100
export const CORRECTIONS_DEFAULT_LIMIT = 50

/** The table this read needs (172). */
export const CORRECTIONS_TABLE = 'league_stat_corrections'

/** The deploy-before-push answer (503): the database predates 172. */
export const CORRECTIONS_UNAVAILABLE_MESSAGE =
  'Stat corrections aren’t available yet — the league database hasn’t been updated for them. Try again after the next update.'

/** The 400 for a cursor this read did not issue. */
export const CORRECTIONS_BAD_CURSOR_MESSAGE =
  'That page cursor is not one this list issued — reload the corrections from the top.'

/** The empty first page, in words — a week with none says so. */
export function correctionsEmptyNote(week: number | undefined): string {
  return week === undefined
    ? 'No stat correction has changed a score in this league yet.'
    : `No stat correction changed a score in this league in Week ${week}.`
}

export const correctionsQuerySchema = z.strictObject({
  week: z.coerce.number().int().min(1).max(18).optional(),
  limit: z.coerce.number().int().min(1).max(CORRECTIONS_MAX_LIMIT).default(CORRECTIONS_DEFAULT_LIMIT),
  /** The opaque token from a previous page's `next_cursor`. */
  cursor: z.string().min(1).max(512).optional(),
})
export type CorrectionsQuery = z.input<typeof correctionsQuerySchema>

/** A matchup outcome as the door derives it (118's `week_results_derive_internal`). */
export type CorrectionOutcome = 'win' | 'loss' | 'tie' | null

export type CorrectionGame = 'matchup' | 'second_game' | 'median_game'

export interface CorrectionStatChange {
  /** The canonical key (D33) — for keying only; render `stat`. */
  stat_key: string
  /** The stat in words ("receiving yards"). */
  stat: string
  old: number | null
  new: number | null
  /** "receiving yards 100 → 94" — the post's own words. */
  words: string
}

export interface CorrectionResultChange {
  game: CorrectionGame
  before: CorrectionOutcome
  after: CorrectionOutcome
  /** "Matchup: win → loss". */
  words: string
}

export interface StatCorrectionItem {
  id: string
  week: number
  recorded_at: string
  player: { id: string; name: string; position: string | null; nfl_team: string | null }
  team: { id: string; name: string }
  matchup_id: string | null
  slot: string
  stat_changes: CorrectionStatChange[]
  player_points: { before: number | null; after: number }
  /** NULL = the score was still pending (E61). */
  team_score: { before: number | null; after: number | null }
  result: {
    /** False while the week's games were still being played — no result yet (D453(4)). */
    known: boolean
    changed: boolean
    /** Only the games whose result moved. */
    changes: CorrectionResultChange[]
  }
  /** "Lou Receiver's receiving yards 100 → 94 — Team One 10.00 → 9.40". */
  summary: string
}

export interface StatCorrectionsPage {
  week: number | null
  items: StatCorrectionItem[]
  limit: number
  has_more: boolean
  next_cursor: string | null
  /** Words for an empty first page; null otherwise. */
  note: string | null
}

const OUTCOMES = new Set(['win', 'loss', 'tie'])
const GAME_WORDS: Record<CorrectionGame, string> = {
  matchup: 'Matchup',
  second_game: 'Second game',
  median_game: 'Median game',
}
const GAME_KEYS: Array<[CorrectionGame, string]> = [
  ['matchup', 'h2h'],
  ['second_game', 'second'],
  ['median_game', 'median'],
]

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** The door's `trim_scale(...)::text` for a stat value; a missing one is "none". */
function statWords(value: number | null): string {
  return value === null ? 'none' : String(value)
}

function scoreWords(value: number | null): string {
  return value === null ? 'pending' : value.toFixed(2)
}

function outcome(value: unknown): CorrectionOutcome {
  return typeof value === 'string' && OUTCOMES.has(value) ? (value as CorrectionOutcome) : null
}

function outcomeWords(value: CorrectionOutcome): string {
  return value ?? 'no result'
}

/** Pure: the stored `stat_changes` array in words. Exported for its pins. */
export function correctionStatChanges(raw: Json): CorrectionStatChange[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>
    const statKey = String(e.stat_key ?? '')
    const stat = correctionLabel(statKey)
    const oldValue = num(e.old)
    const newValue = num(e.new)
    return { stat_key: statKey, stat, old: oldValue, new: newValue, words: `${stat} ${statWords(oldValue)} → ${statWords(newValue)}` }
  })
}

/** Pure: the result change from the record's `{h2h, second, median}` before / after. Exported for its pins. */
export function correctionResult(before: Json | null, after: Json | null, changed: boolean): StatCorrectionItem['result'] {
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') {
    return { known: false, changed: false, changes: [] }
  }
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const changes: CorrectionResultChange[] = []
  for (const [game, key] of GAME_KEYS) {
    const was = outcome(b[key])
    const now = outcome(a[key])
    if (was !== now) changes.push({ game, before: was, after: now, words: `${GAME_WORDS[game]}: ${outcomeWords(was)} → ${outcomeWords(now)}` })
  }
  return { known: true, changed, changes }
}

/** One stored row (with its embedded player and team) → the item. */
type CorrectionRow = Database['public']['Tables']['league_stat_corrections']['Row'] & {
  player: { id: string; full_name: string; position: string | null; team: string | null } | null
  team: { id: string; name: string } | null
}

export function toCorrectionItem(row: CorrectionRow): StatCorrectionItem {
  const statChanges = correctionStatChanges(row.stat_changes)
  const playerName = row.player?.full_name ?? row.player_id
  const teamName = row.team?.name ?? row.team_id
  const scoreBefore = num(row.team_score_before)
  const scoreAfter = num(row.team_score_after)
  return {
    id: row.id,
    week: row.week,
    recorded_at: row.recorded_at,
    player: { id: row.player_id, name: playerName, position: row.player?.position ?? null, nfl_team: row.player?.team ?? null },
    team: { id: row.team_id, name: teamName },
    matchup_id: row.matchup_id,
    slot: row.slot,
    stat_changes: statChanges,
    player_points: { before: num(row.player_points_before), after: num(row.player_points_after) ?? 0 },
    team_score: { before: scoreBefore, after: scoreAfter },
    result: correctionResult(row.result_before, row.result_after, row.result_changed),
    summary: `${playerName}'s ${statChanges.map((c) => c.words).join(', ')} — ${teamName} ${scoreWords(scoreBefore)} → ${scoreWords(scoreAfter)}`,
  }
}

/** The page-boundary filter over `(recorded_at DESC, id DESC)` — the R770 shape. */
export function correctionsCursorFilter(before: string, beforeId: string): string {
  return `recorded_at.lt."${before}",and(recorded_at.eq."${before}",id.lt."${beforeId}")`
}

/**
 * GET /api/leagues/[id]/corrections — the league's applied stat corrections, newest first.
 */
export async function readStatCorrections(
  supabase: Supabase,
  leagueId: string,
  rawQuery: unknown,
): Promise<ServiceResult> {
  const parsed = correctionsQuerySchema.safeParse(rawQuery ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { week, limit, cursor } = parsed.data

  // A malformed cursor is refused BY NAME — never demoted to "no cursor".
  const boundary = cursor === undefined ? undefined : decodeCommishLogCursor(cursor)
  if (boundary === null) {
    return { status: 400, body: { error: { fieldErrors: { cursor: [CORRECTIONS_BAD_CURSOR_MESSAGE] } } } }
  }

  // The family's gate BEFORE the first `.from(` (R807).
  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  let query = supabase
    .from(CORRECTIONS_TABLE)
    .select('*, player:players!league_stat_corrections_player_id_fkey(id, full_name, position, team), team:teams!league_stat_corrections_team_id_fkey(id, name)')
    .eq('league_id', leagueId)
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (week !== undefined) query = query.eq('week', week)
  if (boundary) query = query.or(correctionsCursorFilter(boundary.before, boundary.beforeId))

  const { data, error } = await query
  if (error) {
    if (isMissingSchemaObject(error, [CORRECTIONS_TABLE])) {
      return { status: 503, body: { error: CORRECTIONS_UNAVAILABLE_MESSAGE } }
    }
    return { status: 500, body: { error: `${CORRECTIONS_TABLE}: ${error.message}` } }
  }
  const rows = (data ?? []) as unknown as CorrectionRow[]
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(toCorrectionItem)
  const last = items[items.length - 1]

  const page: StatCorrectionsPage = {
    week: week ?? null,
    items,
    limit,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCommishLogCursor(last.recorded_at, last.id) : null,
    note: items.length === 0 && boundary === undefined ? correctionsEmptyNote(week) : null,
  }
  return { status: 200, body: page as unknown as Json }
}
