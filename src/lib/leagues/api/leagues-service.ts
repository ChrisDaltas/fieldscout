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
 * trigger, and create_league's in-body checks (v1 templates-only + the Q10
 * strict-continuity seam and 13–16 range, R75/D69 — the direct-RPC path
 * never runs this file, so the seam invariant lives in the RPC body too;
 * blob-shape validation stays API-only per the D68(3)/D69 boundary). The
 * RPC is the ONLY league writer (Q8/v2.8.2) — no client DML anywhere here.
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
 * fields; unknown keys reject — the schema is strict at BOTH levels: the
 * settings blob AND this top-level object (R77 — a plain z.object would
 * silently strip top-level unknown keys instead of rejecting them).
 */
export const createLeagueInputSchema = z.strictObject({
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
  // The R75 Q10 backstops (range + seam) — validateLeagueSettings catches
  // these first on THIS path, but if the DB refusal ever surfaces (validator
  // drift) it still maps to the same per-field 400 shape.
  { marker: 'playoff_start_week', field: 'playoff_start_week' },
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
// PATCH /api/leagues/[id] — settings + lifecycle (L.A1.13; §15.1)
// ---------------------------------------------------------------------------

/**
 * PATCH body (§15.1 "update settings"; wire shape recorded in D70). Partial
 * at the league-resource level — each present key is an ATOMIC unit:
 *   - `settings`: the FULL L.A1.6 contract object (the sanctioned client —
 *     L.A2.4's panel / L.A2.1's wizard — round-trips GET detail → edit →
 *     PATCH back; a leaf-level diff wire shape would need a hand-maintained
 *     deep-partial schema that drifts from the catalog, the D60(10)
 *     anti-pattern). Last-write-wins wholesale between concurrent
 *     commissioner edits (single-commissioner reality in M1; noted in D70).
 *   - `scoring_system_id`: the §7.3.3 template choice (carried alongside the
 *     split, never inside it). May combine with `settings` — one atomic RPC.
 *   - `status`: the M1 lifecycle verbs only ('setup' | 'scheduled' — §7.1;
 *     everything past scheduled is M2's draft engine, unrepresentable here).
 *     Must be the ONLY key: a settings write and a transition are two RPCs,
 *     and a half-applied combined PATCH would be unreportable.
 */
export const patchLeagueInputSchema = z
  .strictObject({
    settings: leagueSettingsSchema.optional(),
    scoring_system_id: z.uuid().optional(),
    status: z.enum(['setup', 'scheduled']).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Nothing to update — send settings, scoring_system_id, or status.',
  })
  .refine(
    (body) => body.status === undefined || (body.settings === undefined && body.scoring_system_id === undefined),
    { message: 'A status transition must be its own PATCH — apply settings changes first, then transition.' },
  )
export type PatchLeagueInput = z.infer<typeof patchLeagueInputSchema>

/** The PATCH-path RPC refusals mapped to per-field 400s (messages are UX). */
const PATCH_FIELD_ERRORS: ReadonlyArray<{ marker: string; field: string }> = [
  { marker: 'scoring_system_id', field: 'scoring_system_id' },
  { marker: 'playoff_start_week', field: 'playoff_start_week' },
  { marker: 'draft_scheduled_at', field: 'draft.draft_scheduled_at' },
]

/** Shared error mapping for the two PATCH-path RPCs (D70). */
function mapPatchRpcError(error: { code: string; message: string }): ServiceResult {
  if (error.code === '42501') {
    return { status: 403, body: { error: 'Only the commissioner can update this league.' } }
  }
  if (error.code === 'P0002') {
    return { status: 404, body: { error: 'League not found' } }
  }
  if (error.code === 'P0001') {
    // §7.3 header status gate + the M1 transition fence both surface as a
    // clear 409 (the task text's "M1 returns a clear 409").
    if (
      error.message.includes('settings are locked once the draft starts') ||
      error.message.includes('the draft engine lands in M2') ||
      error.message.includes('transitions from draft/season states')
    ) {
      return { status: 409, body: { error: error.message } }
    }
    const match = PATCH_FIELD_ERRORS.find((m) => error.message.includes(m.marker))
    if (match) {
      return { status: 400, body: { error: { fieldErrors: { [match.field]: [error.message] } } } }
    }
    return { status: 400, body: { error: error.message } }
  }
  if (error.code === '23514' || error.code === '22007' || error.code === '22008') {
    // DB CHECK / bad-timestamp backstops — client errors, not server faults.
    return { status: 400, body: { error: error.message } }
  }
  return { status: 500, body: { error: error.message } }
}

/** Read + merge the current settings row (RLS-scoped; 404 = invisible). */
async function readCurrentSettings(
  supabase: Supabase,
  leagueId: string,
): Promise<{ settings: LeagueSettings } | ServiceResult> {
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
  try {
    return { settings: mergeSettings(league as League) }
  } catch (cause) {
    return {
      status: 500,
      body: { error: `league ${leagueId} has a corrupt settings row: ${(cause as Error).message}` },
    }
  }
}

/**
 * PATCH /api/leagues/[id] (L.A1.13). Two paths, both server-authoritative
 * (Q8/v2.8.2 — clients hold no UPDATE on leagues):
 *   - settings/scoring → `update_league_settings` RPC (commish-only in-body;
 *     §7.3-header status gate → 409; templates-only + Q10 backstops in-body;
 *     max_teams = team_count in the same statement, §12.1).
 *   - status → `set_league_status` RPC (L.A1.11). For 'scheduled', THIS
 *     route is the enforcement point for settings validity (§7.3.8's
 *     "enforced in API + DB constraints" split; 059's banner names it):
 *     validateLeagueSettings runs over the CURRENT stored settings first;
 *     the RPC then enforces transition legality + draft_scheduled_at, and
 *     the D43 trigger enforces the snapshot invariant.
 */
export async function patchLeague(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = patchLeagueInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { settings: patchedSettings, scoring_system_id, status } = parsed.data

  // -- Lifecycle path (status is the only key — schema-enforced) -----------
  if (status !== undefined) {
    if (status === 'scheduled') {
      // The enforcement point for settings validity on the scheduled
      // transition (task item 3): the stored settings must pass §7.3.8
      // BEFORE the league may schedule its draft.
      const current = await readCurrentSettings(supabase, leagueId)
      if (!('settings' in current)) return current
      const validation = validateLeagueSettings(current.settings)
      if (!validation.valid) {
        const fieldErrors: Record<string, string[]> = {}
        for (const issue of validation.errors) {
          ;(fieldErrors[issue.field] ??= []).push(issue.message)
        }
        return { status: 400, body: { error: { fieldErrors } } }
      }
    }
    const { error } = await supabase.rpc('set_league_status', {
      p_league_id: leagueId,
      p_status: status,
    })
    if (error) return mapPatchRpcError(error)
    return { status: 200, body: { ok: true, status } }
  }

  // -- Settings path --------------------------------------------------------
  // A scoring-only PATCH still writes the full column/blob surface (the RPC
  // takes the complete split) — sourced from the CURRENT stored settings.
  let settings: LeagueSettings
  if (patchedSettings !== undefined) {
    settings = patchedSettings
  } else {
    const current = await readCurrentSettings(supabase, leagueId)
    if (!('settings' in current)) return current
    settings = current.settings
  }

  // §7.3.8 API-side validation — same composition as create (D68/§12.0).
  const validation = validateLeagueSettings(settings)
  if (!validation.valid) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of validation.errors) {
      ;(fieldErrors[issue.field] ??= []).push(issue.message)
    }
    return { status: 400, body: { error: { fieldErrors } } }
  }

  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )

  type UpdateLeagueArgs = Database['public']['Functions']['update_league_settings']['Args']
  const args = {
    p_league_id: leagueId,
    // NULL = keep the current reference (the RPC's contract); typegen can't
    // express per-arg nullability, hence the one targeted cast (D68 pattern).
    p_scoring_system_id: scoring_system_id ?? null,
    p_settings: blob,
    ...columnArgs,
  } as unknown as UpdateLeagueArgs

  const { error } = await supabase.rpc('update_league_settings', args)
  if (error) return mapPatchRpcError(error)
  return { status: 200, body: { ok: true } }
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
