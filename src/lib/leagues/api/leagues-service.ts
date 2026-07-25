/**
 * League CRUD service layer — M1 task L.A1.12 (spec §15.1; §12.0 layering).
 *
 * The Route Handlers under `src/app/api/leagues/` are thin wrappers (auth +
 * param plumbing — CLAUDE.md: "app/ → Routes and layouts only. Minimal
 * logic"); everything testable lives here and takes an INJECTED Supabase
 * client, so the stack integration suite (`leagues-api-db.test.ts`) drives
 * the exact same composition — Zod parse → validateLeagueSettings →
 * splitSettings → RPC — over the real PostgREST wire path with real
 * signed-in clients, minus only the Next cookie plumbing (D68).
 *
 * §12.0 layering (059 precedent): full §7.3.8 validation runs HERE
 * (`validateLeagueSettings` — the API half of §7.3.8's "enforced in API +
 * DB constraints" split); the DB backstops are 040's CHECKs, the D43
 * trigger, and create_league's in-body v1 templates-only check. The RPC is
 * the ONLY league writer (Q8/v2.8.2) — no client DML anywhere here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json, League } from '@/types/database'

import {
  leagueSettingsSchema,
  mergeSettings,
  splitSettings,
  validateLeagueSettings,
  type LeagueSettings,
} from '../settings/league-settings'

type Supabase = SupabaseClient<Database>

/** Uniform service result: the route serializes body at the given status. */
export interface ServiceResult {
  status: number
  body: Json
}

// ---------------------------------------------------------------------------
// POST /api/leagues — create
// ---------------------------------------------------------------------------

/**
 * Create-league input (§7.2: name, season, team_count ∈ settings, wizard
 * settings; §15.1). `action_id` is the D68 idempotency key: ONE UUID per
 * user submit, REUSED on retry — the RPC replays instead of duplicating.
 * `settings` is the full L.A1.6 contract object (defaults fill missing
 * fields; unknown keys reject — the schema is strict).
 */
export const createLeagueInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  season: z.number().int().min(2020).max(2100),
  scoring_system_id: z.uuid(),
  team_name: z.string().trim().min(1).max(60).optional(),
  action_id: z.uuid(),
  settings: leagueSettingsSchema,
})
export type CreateLeagueInput = z.infer<typeof createLeagueInputSchema>

/** The friendly per-field RPC refusals we map to a 400 (message is UX). */
const RPC_FIELD_ERRORS: ReadonlyArray<{ marker: string; field: string }> = [
  { marker: 'scoring_system_id', field: 'scoring_system_id' },
  { marker: 'action_id', field: 'action_id' },
]

export async function createLeague(supabase: Supabase, rawBody: unknown): Promise<ServiceResult> {
  const parsed = createLeagueInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { name, season, scoring_system_id, team_name, action_id, settings } = parsed.data

  // §7.3.8 API-side validation (per-field messages are UX — surfaced as-is).
  const validation = validateLeagueSettings(settings)
  if (!validation.valid) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of validation.errors) {
      ;(fieldErrors[issue.field] ??= []).push(issue.message)
    }
    return { status: 400, body: { error: { fieldErrors } } }
  }

  // splitSettings is the §12.1 authority (D60): typed columns map
  // MECHANICALLY to p_<key> RPC args — a future typed column added in TS
  // without a matching RPC arg fails loudly at the PostgREST boundary
  // (function-not-found), never lands silently in the blob.
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )

  type CreateLeagueArgs = Database['public']['Functions']['create_league']['Args']
  const args = {
    p_name: name,
    p_season: season,
    p_scoring_system_id: scoring_system_id,
    // The RPC treats ''/whitespace as absent and derives "<display name>'s
    // Team" (typegen can't express the arg's nullability — '' avoids a cast).
    p_team_name: team_name ?? '',
    p_action_id: action_id,
    p_settings: blob,
    ...columnArgs,
    // trade_deadline_week is legitimately null; the generated Args type
    // can't express per-arg nullability, hence the one targeted cast.
  } as unknown as CreateLeagueArgs

  const { data, error } = await supabase.rpc('create_league', args)
  if (error) {
    if (error.code === 'P0001') {
      const match = RPC_FIELD_ERRORS.find((m) => error.message.includes(m.marker))
      if (match) {
        return { status: 400, body: { error: { fieldErrors: { [match.field]: [error.message] } } } }
      }
      return { status: 400, body: { error: error.message } }
    }
    if (error.code === '42501') {
      return { status: 401, body: { error: 'You must be signed in to create a league.' } }
    }
    if (error.code === '23514') {
      // DB CHECK backstop (040 team_count) — the Zod/validate layers should
      // have caught this first; still a client error, not a server fault.
      return { status: 400, body: { error: error.message } }
    }
    return { status: 500, body: { error: error.message } }
  }

  const result = data as { league_id: string; team_id: string; invite_code: string; replayed: boolean }
  // A replayed double-submit is a success, not a conflict (D68): same body,
  // 200 instead of 201.
  return { status: result.replayed ? 200 : 201, body: result as unknown as Json }
}

// ---------------------------------------------------------------------------
// GET /api/leagues — my leagues (via league_members, task item 2)
// ---------------------------------------------------------------------------

export async function listMyLeagues(supabase: Supabase, userId: string): Promise<ServiceResult> {
  const { data, error } = await supabase
    .from('league_members')
    .select(
      'role, team_id, leagues!inner(id, name, season, status, team_count, created_at, deleted_at)',
    )
    .eq('user_id', userId)
    .is('leagues.deleted_at', null)

  if (error) {
    return { status: 500, body: { error: error.message } }
  }

  const leagues = (data ?? [])
    .map((row) => {
      const league = row.leagues
      return {
        id: league.id,
        name: league.name,
        season: league.season,
        status: league.status,
        team_count: league.team_count,
        created_at: league.created_at,
        my_role: row.role,
        my_team_id: row.team_id,
      }
    })
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    .reverse()

  return { status: 200, body: { leagues } as unknown as Json }
}

// ---------------------------------------------------------------------------
// GET /api/leagues/[id] — detail (settings + members + teams + my role)
// ---------------------------------------------------------------------------

export async function getLeagueDetail(
  supabase: Supabase,
  userId: string,
  leagueId: string,
): Promise<ServiceResult> {
  // RLS scopes visibility (member-or-owner SELECT, 052); a non-member simply
  // sees no row — indistinguishable from nonexistent (no existence leak).
  const { data: league, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  if (!league) {
    return { status: 404, body: { error: 'League not found' } }
  }

  // mergeSettings THROWS on a corrupt row (D58 loud-failure doctrine) — let
  // it surface as a 500 via the route's error boundary rather than serving
  // silently-wrong settings.
  let settings: LeagueSettings
  try {
    settings = mergeSettings(league as League)
  } catch (cause) {
    return {
      status: 500,
      body: { error: `league ${leagueId} has a corrupt settings row: ${(cause as Error).message}` },
    }
  }

  const [membersResult, teamsResult] = await Promise.all([
    supabase
      .from('league_members')
      .select(
        'id, user_id, team_id, role, is_placeholder, is_autodraft, joined_at, profiles(username, display_name, avatar_url)',
      )
      .eq('league_id', leagueId)
      .order('joined_at', { ascending: true }),
    supabase
      .from('teams')
      .select('id, name, owner_id, status, created_at')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: true }),
  ])
  if (membersResult.error) {
    return { status: 500, body: { error: membersResult.error.message } }
  }
  if (teamsResult.error) {
    return { status: 500, body: { error: teamsResult.error.message } }
  }

  const members = membersResult.data ?? []
  const myRole = members.find((m) => m.user_id === userId)?.role ?? null

  return {
    status: 200,
    body: {
      league: {
        id: league.id,
        name: league.name,
        description: league.description,
        season: league.season,
        status: league.status,
        owner_id: league.owner_id,
        scoring_system_id: league.scoring_system_id,
        invite_code: league.invite_code,
        invite_slug: league.invite_slug,
        max_teams: league.max_teams,
        created_at: league.created_at,
        updated_at: league.updated_at,
      },
      settings,
      members,
      teams: teamsResult.data ?? [],
      my_role: myRole,
    } as unknown as Json,
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/leagues/[id] — soft delete (commish; Q8: via RPC only)
// ---------------------------------------------------------------------------

export async function deleteLeague(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { error } = await supabase.rpc('soft_delete_league', { p_league_id: leagueId })
  if (error) {
    if (error.code === '42501') {
      // Non-commish AND nonexistent league both land here (no existence
      // leak at the RPC) — surface as 403.
      return { status: 403, body: { error: 'Only the commissioner can delete a league.' } }
    }
    return { status: 500, body: { error: error.message } }
  }
  return { status: 200, body: { ok: true } }
}
