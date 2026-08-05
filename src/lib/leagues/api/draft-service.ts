/**
 * Draft schedule/start API service layer — M2 task L.B2.1 (spec §15.2;
 * tasks-M2 D92/D94/D95/D101; D105's RPC surface).
 *
 * Same layering as leagues-service (L.A1.12 precedent): the Route Handlers
 * under `src/app/api/leagues/[id]/draft/` are thin wrappers (auth + param
 * plumbing) and everything testable lives here over an INJECTED Supabase
 * client, so the stack suite (`draft-api-db.test.ts`) drives the identical
 * composition over the real PostgREST wire path with real signed-in users.
 *
 * Surface (§15.2):
 *   - POST  …/draft        → `draft_create`  (commish; idempotent vs the D95
 *     partial unique — a replayed create answers 200 with the existing row,
 *     the D68 replayed-success convention).
 *   - PATCH …/draft        → pre-start order edit incl. randomize →
 *     `draft_set_order` (069; D101/D108(7): "L.B2.1's pre-start PATCH stays
 *     the ordinary surface"). **No schedule field** — every
 *     `draft_scheduled_at` change flows through the league-settings PATCH
 *     (D95's single pre-start store; the strict body schema makes a smuggled
 *     schedule key a 400). Post-start (live/paused) order edits are L.B2.3's
 *     dispatch (reason required per D97) — until it lands they refuse with a
 *     seam 409, the 059 "lands in M2" refusal precedent.
 *   - POST  …/draft/start  → `draft_start`   (commish; create-if-absent +
 *     idempotent re-start are the RPC's — D105(3)).
 *
 * Randomize entropy (D101 instant shuffle): the ESLint determinism guard
 * bans every random source under `src/lib/leagues/**` (L.A0.3/R22), so the
 * shuffle here is PURE over injected uniform values — the ROUTE (outside the
 * guard) supplies crypto entropy per click; tests supply literals and pin
 * the exact permutation. The RPC validates the permutation either way and
 * remains the only writer (server-authoritative, §8.1).
 *
 * SQLSTATE mapping carries the 062/063 convention: 42501 → 403 (no-leak:
 * nonexistent league answers the same), P0002 → 404, P0001 → 400 friendly,
 * 22023 → 400.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Draft, Json } from '@/types/database'

import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

const NOT_COMMISH_MESSAGE = 'Only the commissioner can manage the draft.'
const NO_ACTIVE_DRAFT_MESSAGE =
  'No draft is scheduled for this league yet — create one from Draft setup first.'
const POST_START_ORDER_MESSAGE =
  'The draft has already started — mid-draft order changes arrive with the commissioner draft controls in M2.'

/** Statuses that make a non-mock draft "active" (the D95 partial-unique set). */
export const ACTIVE_DRAFT_STATUSES = ['scheduled', 'live', 'paused'] as const

export interface DraftStateBody {
  draft: Draft
  created?: boolean
  started?: boolean
}

function mapDraftRpcError(error: { code?: string; message: string }): ServiceResult {
  if (error.code === '42501') {
    // Non-commish AND nonexistent league both land here (the RPCs' no-leak
    // fast-fail) — surface as 403, the deleteLeague precedent.
    return { status: 403, body: { error: NOT_COMMISH_MESSAGE } }
  }
  if (error.code === 'P0002') {
    return { status: 404, body: { error: 'League not found' } }
  }
  if (error.code === 'P0001' || error.code === '22023') {
    // Friendly in-body refusals are UX (§8.3 checklist) — surfaced verbatim.
    return { status: 400, body: { error: error.message } }
  }
  return { status: 500, body: { error: error.message } }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/draft — create/schedule (D95 hydration in the RPC)
// ---------------------------------------------------------------------------

export async function createDraft(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { data, error } = await supabase.rpc('draft_create', { p_league_id: leagueId })
  if (error) return mapDraftRpcError(error)
  const result = data as unknown as DraftStateBody
  // Idempotent double-create (D95): the existing row back as a 200 — a
  // success, never a conflict (the D68 replayed-submit convention).
  return { status: result.created ? 201 : 200, body: result as unknown as Json }
}

// ---------------------------------------------------------------------------
// PATCH /api/leagues/[id]/draft — pre-start order edit (explicit | randomize)
// ---------------------------------------------------------------------------

/**
 * PATCH body: exactly one of `order` (the manual drag result — a full
 * permutation of active franchise ids) or `randomize: true` (D101's instant
 * shuffle). `reason` is accepted for forward-compat with L.B2.3's post-start
 * dispatch (D97) and stored nowhere (the F32 pattern). strictObject is the
 * D95 fence: `draft_scheduled_at` (or any other key) in this body is a 400 —
 * the league-settings PATCH is the only schedule writer.
 */
export const patchDraftInputSchema = z
  .strictObject({
    order: z.array(z.uuid()).min(1).optional(),
    randomize: z.literal(true).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((body) => (body.order !== undefined) !== (body.randomize !== undefined), {
    message: 'Send exactly one of `order` (the full team order) or `randomize: true`.',
  })
export type PatchDraftInput = z.infer<typeof patchDraftInputSchema>

/**
 * Pure Fisher–Yates over INJECTED uniform values in [0, 1) — one value per
 * swap step, consumed front-to-back (`values[0]` drives the last index).
 * Deterministic given (ids, values), which is what makes the wire pin
 * possible; the route supplies crypto entropy, never this module.
 */
export function shuffleTeamIds(ids: readonly string[], values: readonly number[]): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const r = values[out.length - 1 - i] ?? 0
    const j = Math.min(i, Math.max(0, Math.floor(r * (i + 1))))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface PatchDraftOrderDeps {
  /** `count` uniform values in [0, 1) for the randomize shuffle. */
  randomValues: (count: number) => number[]
}

export async function patchDraftOrder(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
  deps: PatchDraftOrderDeps,
): Promise<ServiceResult> {
  const parsed = patchDraftInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  // Locate the active non-mock draft over RLS (member SELECT, 065): a
  // non-member sees no row — 404, indistinguishable from no draft (no-leak);
  // the D95 partial unique guarantees at most one row matches.
  const { data: draft, error: draftError } = await supabase
    .from('drafts')
    .select('id, status')
    .eq('league_id', leagueId)
    .eq('is_mock', false)
    .in('status', [...ACTIVE_DRAFT_STATUSES])
    .maybeSingle()
  if (draftError) {
    return { status: 500, body: { error: draftError.message } }
  }
  if (!draft) {
    return { status: 404, body: { error: NO_ACTIVE_DRAFT_MESSAGE } }
  }
  if (draft.status !== 'scheduled') {
    // The L.B2.3 seam (tasks-M2 §6: "post-start order edits route through
    // L.B2.3's dispatch") — an explicit refusal, the 059 precedent.
    return { status: 409, body: { error: POST_START_ORDER_MESSAGE } }
  }

  let order: string[]
  if (parsed.data.randomize) {
    // Active franchises, id-sorted so (entropy → permutation) is a pure
    // function of the fetched set (the wire pin's determinism).
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId)
      .neq('status', 'retired')
      .order('id', { ascending: true })
    if (teamsError) {
      return { status: 500, body: { error: teamsError.message } }
    }
    const ids = (teams ?? []).map((t) => t.id)
    if (ids.length === 0) {
      return { status: 404, body: { error: NO_ACTIVE_DRAFT_MESSAGE } }
    }
    order = shuffleTeamIds(ids, deps.randomValues(ids.length))
  } else {
    order = parsed.data.order as string[]
  }

  // draft_set_order (069) is the writer + validator (permutation of active
  // franchises → friendly P0001) and posts the D97 system chat message.
  const { data, error } = await supabase.rpc('draft_set_order', {
    p_draft_id: draft.id,
    p_order: order,
    ...(parsed.data.reason !== undefined ? { p_reason: parsed.data.reason } : {}),
  })
  if (error) return mapDraftRpcError(error)
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/draft/start — manual start (D94's early path)
// ---------------------------------------------------------------------------

export async function startDraft(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { data, error } = await supabase.rpc('draft_start', { p_league_id: leagueId })
  if (error) return mapDraftRpcError(error)
  // Both started:true and the D63-class idempotent re-start (started:false)
  // are 200 successes — the RPC's contract (D105(3)).
  return { status: 200, body: data as unknown as Json }
}
