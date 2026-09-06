/**
 * Standings service — M4 task L.D4.1, `GET /api/leagues/[id]/standings`
 * (spec §15.3 "standings (tiebreaker-ordered)"; §7.3.7, §11.5; migration
 * 117's `league_standings`; PROGRESS D297, D314, ledger **F247(b)**; §3
 * **Q38** stands provisionally).
 *
 * Same D68/D71 layering as the rest of the family; testable over an INJECTED
 * client (`inseason-reads-api-db.test.ts`).
 *
 * **The whole ranking is the RPC's** (server-authoritative; D297 — one
 * ranking rule in the product). `league_standings` is SECURITY DEFINER with
 * `authenticated` EXECUTE and an in-body `is_league_member` check: a
 * non-member is REFUSED with 42501 — the family's 403 — never handed an
 * empty table (§11.5 v2.16.23), so this route needs no membership gate of
 * its own; the RPC is the gate. Its document is passed through whole: the
 * ordered rows, the effective chain (`chain` + `chain_appended`), the named
 * E63/E64 skips, the coin-flip seed and its source, the `pa_gaps` note, and
 * `reason: 'no_final_weeks'` when nothing is final yet — the RPC's own name
 * for an empty table, which is what lets the UI render "no results yet" by
 * reason rather than by inference (rule 10). Nothing is re-derived and
 * nothing is annotated: the Points Against definition 117 renders (the
 * primary opponent's points once — the PF mirror) is **Q38**'s, unruled and
 * standing provisionally, and this route renders what the RPC returns
 * (R801: a definition the spec lacks is a §3 question, not an annotation).
 *
 * **F247(b) — the scale is normalised HERE, and not trusted.** 117 renders
 * `points_for` / `points_against` as JSON `0` for a team with no result
 * rows (`COALESCE(sum(...), 0)`) and as `35.00` otherwise (a `numeric(8,2)`
 * sum), and `win_pct` as `round(…, 4)`. Through `JSON.parse` both scales
 * already collapse to a JS number, but "already" is not a contract: this
 * layer coerces the three per-row figures through `Number()` and REFUSES
 * the document (a 500 by name) if any is not finite, so a renderer can
 * format `toFixed(2)` without a guard and a future scale change on the SQL
 * side cannot reach the UI as a string. The row count is asserted against
 * the seated-team arithmetic's ceiling too (rule 10).
 *
 * No Date/random read here (the `src/lib/leagues/**` ESLint fences).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

import { mapInSeasonRpcError } from './inseason-errors'
import { INSEASON_READ_FORBIDDEN_MESSAGE, assertBelowPostgrestCap } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

export interface StandingsRow {
  rank: number
  team_id: string
  name: string
  wins: number
  losses: number
  ties: number
  games: number
  win_pct: number
  points_for: number
  points_against: number
  weeks: number
  h2h_record: { wins: number; losses: number; ties: number }
  median_record: { wins: number; losses: number; ties: number }
  second_record: { wins: number; losses: number; ties: number }
  /** The chain entry that separated this row from the one above (null for
   *  the leader / an unseparated tie resolved by the coin flip's own entry). */
  separated_by: string | null
}

export interface LeagueStandings {
  league_id: string
  season: number
  schedule_mode: string
  regular_season: { first_week: number | null; last_week: number | null }
  weeks_final: number
  chain: unknown
  chain_appended: string[]
  coin_flip_seed: string
  coin_flip_seed_source: string
  /** E63/E64 — the named H2H skips (`group_of_3_or_more` / `total_points`). */
  skipped: unknown
  pa_gaps: unknown
  standings: StandingsRow[]
  /** `'no_final_weeks'` when nothing is final yet — the RPC's own reason. */
  reason: string | null
}

/** A JSON number or a numeric string, and NOTHING else: `Number(null)` is
 *  `0` and `Number(undefined)` is `NaN`, so a bare `Number()` would let a
 *  NULL figure render as a plausible `0.00` — the CLAUDE.md shape exactly. */
function figure(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw)
  return Number.NaN
}

/** The three per-row figures F247(b) names, coerced. Exported for its pins. */
export function normalizeStandingsRow(raw: Record<string, unknown>): StandingsRow {
  const figures = {
    win_pct: figure(raw.win_pct),
    points_for: figure(raw.points_for),
    points_against: figure(raw.points_against),
  }
  for (const [key, value] of Object.entries(figures)) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `league_standings: ${key} for team ${String(raw.team_id)} is not a finite number (${JSON.stringify(raw[key])}) — F247(b)`,
      )
    }
  }
  return { ...(raw as unknown as StandingsRow), ...figures }
}

/**
 * GET /api/leagues/[id]/standings — the tiebreaker-ordered table (§15.3 →
 * `league_standings`).
 */
export async function readStandings(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { data, error } = await supabase.rpc('league_standings', { p_league_id: leagueId })
  if (error) {
    return mapInSeasonRpcError(error, INSEASON_READ_FORBIDDEN_MESSAGE)
  }
  const doc = (data ?? null) as Record<string, unknown> | null
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.standings)) {
    return { status: 500, body: { error: 'league_standings: the RPC returned no standings document' } }
  }
  const capped = assertBelowPostgrestCap(doc.standings, 'league_standings.standings')
  if (capped) return capped

  let rows: StandingsRow[]
  try {
    rows = (doc.standings as Record<string, unknown>[]).map(normalizeStandingsRow)
  } catch (cause) {
    return { status: 500, body: { error: (cause as Error).message } }
  }

  const payload: LeagueStandings = { ...(doc as unknown as LeagueStandings), standings: rows }
  return { status: 200, body: payload as unknown as Json }
}
