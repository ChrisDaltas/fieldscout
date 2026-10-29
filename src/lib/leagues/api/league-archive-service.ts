/**
 * League archive — F716 (Chris 2026-10-27: "I don't really see the need to
 * delete the league permanently"; asked, he chose "Archive, commissioner can
 * restore"). Migration 212; spec §15.1 v2.16.109; PROGRESS D780–D786.
 *
 *   POST /api/leagues/[id]/archive  → `archive_league`  (the commissioner only)
 *   POST /api/leagues/[id]/restore  → `restore_league`  (the commissioner only)
 *   GET  /api/leagues?archived=1    → the caller's archived leagues (read-only)
 *
 * Authorization is the RPC's (one no-leak 42501 for a co-commissioner, a
 * manager, an outsider and a missing league); these handlers never pre-check
 * the role. A database without 212 answers a named 503 (deploy before push).
 * `leagues.deleted_at` IS the archived-at stamp (212 repurposed it), so the
 * archived read selects only columns production already has.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { isDoorNotPushed } from '@/lib/supabase/postgrest-errors'
import type { Database, Json } from '@/types/database'

import { optionalReason } from './commish-matchup-service'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

export const ARCHIVE_FORBIDDEN_MESSAGE = 'Only the league’s commissioner can archive it.'
export const RESTORE_FORBIDDEN_MESSAGE = 'Only the league’s commissioner can restore it.'
export const ARCHIVE_DRAFT_IN_PROGRESS_MESSAGE =
  'The draft is in progress — finish or reset the draft before archiving the league.'
export const ARCHIVE_NOT_LIVE_MESSAGE = 'Archiving leagues isn’t switched on yet — it arrives with the next update.'
/** DELETE /api/leagues/[id] — leagues are never deleted any more (212). */
export const LEAGUE_DELETE_RETIRED_MESSAGE =
  'Leagues aren’t deleted — the commissioner can archive the league from League settings, and restore it any time.'
export const archiveLeagueInputSchema = z.strictObject({ reason: optionalReason })

/** 212's result document (both verbs). */
export interface ArchiveLeagueResult {
  league_id: string
  /** False = the repeat-safe no-op (already archived / not archived). */
  changed: boolean
  archived: boolean
  why?: string | null
  commissioner_action_id: string | null
  /** The restore's scoring catch-up (D782); absent on archive. */
  scores_requeued?: number
}

async function callVerb(
  supabase: Supabase,
  verb: 'archive_league' | 'restore_league',
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = archiveLeagueInputSchema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { reason } = parsed.data
  const { data, error } = await supabase.rpc(verb, {
    p_league_id: leagueId,
    ...(reason === undefined ? {} : { p_reason: reason }),
  })
  if (error) {
    if (isDoorNotPushed(error, { [verb]: ['p_league_id', 'p_reason'] })) {
      return { status: 503, body: { error: ARCHIVE_NOT_LIVE_MESSAGE } }
    }
    if (error.code === '42501') {
      return { status: 403, body: { error: verb === 'archive_league' ? ARCHIVE_FORBIDDEN_MESSAGE : RESTORE_FORBIDDEN_MESSAGE } }
    }
    if (error.code === '55000' && verb === 'archive_league' && /draft is in progress/.test(error.message ?? '')) {
      return { status: 409, body: { error: ARCHIVE_DRAFT_IN_PROGRESS_MESSAGE } }
    }
    if (error.code === '22023') {
      return { status: 400, body: { error: 'Keep the reason to 500 characters or fewer.' } }
    }
    return { status: 500, body: { error: error.message } }
  }
  // The answer must be this verb's, for this league — never a 200 for a
  // document that says something else happened.
  const result = (data ?? {}) as Partial<ArchiveLeagueResult>
  const wantArchived = verb === 'archive_league'
  if (String(result.league_id).toLowerCase() !== leagueId.toLowerCase() || result.archived !== wantArchived) {
    return { status: 500, body: { error: 'The change could not be confirmed — reload your leagues and check.' } }
  }
  return { status: 200, body: data as Json }
}

/** POST …/archive — `{ reason? }`. */
export function archiveLeague(supabase: Supabase, leagueId: string, rawBody: unknown): Promise<ServiceResult> {
  return callVerb(supabase, 'archive_league', leagueId, rawBody)
}

/** POST …/restore — `{ reason? }`. */
export function restoreLeague(supabase: Supabase, leagueId: string, rawBody: unknown): Promise<ServiceResult> {
  return callVerb(supabase, 'restore_league', leagueId, rawBody)
}

/** One row of GET /api/leagues?archived=1 — what "Archived leagues" shows. */
export interface ArchivedLeagueRow {
  id: string
  name: string
  avatar_url: string | null
  season: number
  status: string
  team_count: number
  /** When it was archived (`leagues.deleted_at`, 212). */
  archived_at: string
  my_role: string
}

/** The caller's archived leagues, newest archive first. Members still read
 *  an archived league's row (`leagues` keeps its member SELECT), which is
 *  how this list exists; nothing else about the league is read here. */
export async function listMyArchivedLeagues(supabase: Supabase, userId: string): Promise<ServiceResult> {
  const { data, error } = await supabase
    .from('league_members')
    .select('role, leagues!inner(id, name, avatar_url, season, status, team_count, deleted_at)')
    .eq('user_id', userId)
    .not('leagues.deleted_at', 'is', null)
  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  const leagues: ArchivedLeagueRow[] = (data ?? [])
    .map((row) => {
      const league = row.leagues
      return {
        id: league.id,
        name: league.name,
        avatar_url: league.avatar_url,
        season: league.season,
        status: league.status,
        team_count: league.team_count,
        archived_at: league.deleted_at as string,
        my_role: row.role,
      }
    })
    .filter((row) => row.archived_at !== null)
    .sort((a, b) => b.archived_at.localeCompare(a.archived_at))
  return { status: 200, body: { leagues } as unknown as Json }
}
