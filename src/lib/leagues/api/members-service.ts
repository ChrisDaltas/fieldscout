/**
 * Member-management service layer — M1 task L.A1.15 (spec §7.2, §7.2.1,
 * §12.2, §12.22, §15.1; PROGRESS D42/D47/D63/D74).
 *
 * Same D68/D71 layering as `leagues-service.ts` / `invites-service.ts`
 * (extend the pattern, never fork): the Route Handlers under
 * `src/app/api/leagues/[id]/members` and `.../teams/[tid]/assign-manager`
 * are thin wrappers; everything testable lives here over an INJECTED
 * Supabase client, so the stack suite (`members-api-db.test.ts`) drives the
 * production composition across the real PostgREST wire. Every write goes
 * through the 063 SECURITY DEFINER RPCs (Q8/v2.8.2 — no client DML anywhere
 * here; as of 063 `league_members` has no client write policy at all).
 *
 * RAISED-error mapping (the 059/061/062 convention, three-deep precedent):
 *   42501 → 403 · **P0002 → 404** (soft-deleted or invisible league — the
 *   same answer a malformed league id already gets at the route; the arm
 *   sits BEFORE any P0001 field mapping, R87) · P0001 → 400 (a genuine
 *   refusal of a well-formed request against a live league; the RPC message
 *   is the UX copy) · 22023 → 400 (argument shape) · everything else → 500.
 *
 * These RPCs RAISE rather than returning outcome jsonb (unlike claim/join):
 * no refusal here has side effects worth preserving, and L.A2.5 renders the
 * unavailable `retire` mode as a DISABLED control with an "after the draft"
 * note rather than as a submitted state (D74(7)). One style per route family.
 *
 * §15.1's `reason` is accepted and validated here and passed to the RPC so
 * the documented request shape is stable from day one — but nothing stores
 * it: `commissioner_actions` (the audit table every "audited" annotation
 * refers to) does not exist anywhere in the repo yet; it is Phase E/M6.
 * Ledger row **F32** carries the write-it-down obligation.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

const uuid = z.uuid()

/** Shared RAISE mapping — see the header. */
function mapMemberRpcError(
  error: { code?: string; message: string },
  forbiddenMessage: string,
): ServiceResult {
  if (error.code === '42501') {
    return { status: 403, body: { error: forbiddenMessage } }
  }
  // BEFORE any P0001 arm: a missing/soft-deleted league is not a validation
  // error on the submitted body (R87 — the mis-shape that ordering produced).
  if (error.code === 'P0002') {
    return { status: 404, body: { error: 'League not found' } }
  }
  if (error.code === 'P0001' || error.code === '22023') {
    return { status: 400, body: { error: error.message } }
  }
  return { status: 500, body: { error: error.message } }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/members — add a placeholder seat (commish)
// ---------------------------------------------------------------------------

/** §7.2 "Commissioner can create empty seats". `team_name` is optional — the
 *  RPC derives the deterministic "Team N" when it is absent (D74(5)). */
export const addPlaceholderSeatInputSchema = z.strictObject({
  team_name: z.string().trim().min(1).max(60).nullish(),
})

export async function addPlaceholderSeat(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = addPlaceholderSeatInputSchema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const { data, error } = await supabase.rpc('add_placeholder_seat', {
    p_league_id: leagueId,
    // The RPC treats ''/whitespace as absent (create_league's p_team_name
    // convention) — '' avoids a nullability cast the generated Args can't
    // express.
    p_team_name: parsed.data.team_name ?? '',
  })
  if (error) {
    return mapMemberRpcError(error, 'Only the commissioner can add seats.')
  }
  return { status: 201, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// PATCH /api/leagues/[id]/members/[mid] — role change (commish)
// ---------------------------------------------------------------------------

/**
 * §15.1's members-PATCH carries two verbs: the role change (M1) and the
 * autodraft toggle (M2 — the column shipped in 052 per §12.2 verbatim, but
 * nothing consumes it before a draft exists). `is_autodraft` is therefore a
 * KNOWN key with an explicit named refusal rather than an unknown-key
 * rejection, so the message tells the caller when it arrives (F33).
 */
export const patchMemberInputSchema = z.strictObject({
  role: z.enum(['commissioner', 'co_commissioner', 'manager']).optional(),
  is_autodraft: z.boolean().optional(),
})

export const AUTODRAFT_DEFERRED_MESSAGE =
  'Autodraft toggles arrive with the draft engine in M2 — this league has no draft yet.'

export async function patchMember(
  supabase: Supabase,
  leagueId: string,
  memberId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  if (!uuid.safeParse(leagueId).success || !uuid.safeParse(memberId).success) {
    return { status: 400, body: { error: 'Invalid member id.' } }
  }
  const parsed = patchMemberInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  if (parsed.data.is_autodraft !== undefined) {
    return {
      status: 400,
      body: { error: { fieldErrors: { is_autodraft: [AUTODRAFT_DEFERRED_MESSAGE] } } },
    }
  }
  if (parsed.data.role === undefined) {
    return { status: 400, body: { error: { fieldErrors: { role: ['A role is required.'] } } } }
  }

  const { data, error } = await supabase.rpc('set_member_role', {
    p_league_id: leagueId,
    p_member_id: memberId,
    p_role: parsed.data.role,
  })
  if (error) {
    return mapMemberRpcError(error, 'Only the commissioner can change member roles.')
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// DELETE /api/leagues/[id]/members/[mid] — remove a manager, or leave
// ---------------------------------------------------------------------------

/** §15.1 body: { mode, successor_user_id?, reason }. `takeover` reseats a
 *  NAMED successor (§7.2.1(a)); the "invite a replacement" journey is
 *  `vacate` + a seat-targeted invite (D74(6)). */
export const removeMemberInputSchema = z
  .strictObject({
    mode: z.enum(['takeover', 'retire', 'vacate']),
    successor_user_id: z.uuid().nullish(),
    reason: z.string().trim().max(500).nullish(),
  })
  .refine((body) => body.mode !== 'takeover' || !!body.successor_user_id, {
    message: 'A takeover needs the successor to seat on the franchise.',
    path: ['successor_user_id'],
  })
  .refine((body) => body.mode === 'takeover' || !body.successor_user_id, {
    message: 'successor_user_id only applies to a takeover.',
    path: ['successor_user_id'],
  })

/**
 * §15.1 prints NO leave endpoint — the only removal verb is
 * `DELETE .../members/[mid]` — so this handler dispatches on whose membership
 * `[mid]` is (D74(8)): the caller's own → `leave_league` (end_reason 'left',
 * no mode: §7.2.1 gives the leaver no choice of franchise outcome), anyone
 * else's → the commish-gated `remove_manager(mode)`. The body is parsed only
 * on the removal branch; a self-DELETE carries no mode.
 */
export async function removeMember(
  supabase: Supabase,
  leagueId: string,
  memberId: string,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  if (!uuid.safeParse(leagueId).success || !uuid.safeParse(memberId).success) {
    return { status: 400, body: { error: 'Invalid member id.' } }
  }

  // Whose seat is this? Visible to any member of the league under the 052
  // SELECT policy; a row that is merely INVISIBLE comes back as `null` with
  // NO error and falls through to the RPC, which decides (and refuses without
  // leaking existence). A non-null error is therefore never that benign
  // signal — `maybeSingle` synthesizes PGRST116 only for >1 row and returns
  // transport failures as `{data: null, error}` — so it must not be dropped:
  // dropping it served an infrastructure fault as a 400 Zod payload from the
  // removal branch below (R95). Matches `readCurrentSettings` in
  // leagues-service.ts.
  const { data: member, error: readError } = await supabase
    .from('league_members')
    .select('id, user_id')
    .eq('id', memberId)
    .eq('league_id', leagueId)
    .maybeSingle()
  if (readError) {
    return { status: 500, body: { error: readError.message } }
  }

  if (member && member.user_id === userId) {
    const { data, error } = await supabase.rpc('leave_league', { p_league_id: leagueId })
    if (error) {
      return mapMemberRpcError(error, 'You are not a member of this league.')
    }
    return { status: 200, body: data as unknown as Json }
  }

  const parsed = removeMemberInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { mode, successor_user_id, reason } = parsed.data

  const { data, error } = await supabase.rpc('remove_manager', {
    p_league_id: leagueId,
    p_member_id: memberId,
    p_mode: mode,
    // Optional args: omit rather than send null (the generated Args type
    // cannot express per-arg nullability, and the RPC defaults both).
    ...(successor_user_id ? { p_successor_user_id: successor_user_id } : {}),
    ...(reason ? { p_reason: reason } : {}),
  })
  if (error) {
    return mapMemberRpcError(error, 'Only the commissioner can remove a manager.')
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/teams/[tid]/assign-manager — seat a user (commish)
// ---------------------------------------------------------------------------

export const assignManagerInputSchema = z.strictObject({
  user_id: z.uuid(),
})

export async function assignManager(
  supabase: Supabase,
  leagueId: string,
  teamId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  if (!uuid.safeParse(leagueId).success || !uuid.safeParse(teamId).success) {
    return { status: 400, body: { error: 'Invalid team id.' } }
  }
  const parsed = assignManagerInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  // BOTH segments are passed down: the RPC refuses a franchise that is not
  // this league's, so a mis-addressed URL cannot seat someone in another
  // league and answer 200 (R86 — the doubly-nested-route rule).
  const { data, error } = await supabase.rpc('assign_manager', {
    p_league_id: leagueId,
    p_team_id: teamId,
    p_user_id: parsed.data.user_id,
  })
  if (error) {
    return mapMemberRpcError(error, 'Only the commissioner can assign a manager.')
  }
  return { status: 200, body: data as unknown as Json }
}
