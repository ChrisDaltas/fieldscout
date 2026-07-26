/**
 * Invite / join / claim service layer — M1 task L.A1.14 (spec §7.2, §12.23,
 * §15.1, §16.1; PROGRESS D36/D37/D46/D47/D48/D72).
 *
 * Same D68/D71 layering as `leagues-service.ts` (extend the pattern, no
 * forks): Route Handlers are thin wrappers; everything testable lives here
 * over an INJECTED Supabase client, so the stack suite
 * (`invites-api-db.test.ts`) drives the production composition over the
 * real PostgREST wire path. All writes go through the 062 SECURITY DEFINER
 * RPCs (Q8/v2.8.2 — no client DML anywhere here).
 *
 * Outcome mapping (D72): claim/join RPCs return outcome jsonb
 * ({ok:false, reason, message}) instead of raising, because E54's refusal
 * persists writes. The routes map reasons to statuses:
 *   not_found → 404 · mismatch → 403 · expired/revoked/spent → 410 ·
 *   seat_filled/seat_unavailable/league_full/joins_closed → 409.
 * The body always carries {reason, message} so the claim card (L.A2.6)
 * renders states from the payload, not the status code.
 *
 * RAISED-error mapping on the three COMMISH RPCs (D73/R87 — the 059/061
 * convention, three-deep precedent): 42501 → 403 · **P0002 → 404** (the
 * league is soft-deleted or invisible — same answer a malformed league id
 * already gets at the route) · P0001 → 400 (a genuine refusal of a
 * well-formed request against a live league) · everything else → 500.
 *
 * Email seam (D37/Q5): invite creation records send-intent on the row
 * in-RPC (created_at/last_sent_at — D46); the route-side send goes through
 * the injected `EmailSender` AFTER the RPC commits, and a send failure
 * never fails the request (email_sent: false in the response instead).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  buildClaimUrl,
  getEmailSender,
  renderLeagueInviteEmail,
  type EmailSender,
} from '@/lib/email/email-sender'
import type { Database, Json } from '@/types/database'

import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/invites — create seat-targeted or general invite
// ---------------------------------------------------------------------------

/** §7.2 paths 2–4: email XOR username XOR open link; identity-restricted
 *  invites are single-use (the RPC re-checks in-body — R75 doctrine). */
export const createInviteInputSchema = z
  .strictObject({
    target_team_id: z.uuid().nullish(),
    invited_email: z.email().max(255).nullish(),
    invited_username: z.string().trim().min(1).max(30).nullish(),
    max_uses: z.number().int().min(1).max(100).optional(),
  })
  .refine((body) => !(body.invited_email && body.invited_username), {
    message: 'An invite targets an email OR a username, not both.',
  })
  .refine(
    (body) => (body.max_uses ?? 1) === 1 || (!body.invited_email && !body.invited_username),
    { message: 'Identity-restricted invites are single-use — max_uses must be 1.' },
  )
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>

export async function createInvite(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
  emailSender: EmailSender = getEmailSender(),
): Promise<ServiceResult> {
  const parsed = createInviteInputSchema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { target_team_id, invited_email, invited_username, max_uses } = parsed.data

  const { data, error } = await supabase.rpc('create_league_invite', {
    p_league_id: leagueId,
    p_target_team_id: target_team_id ?? undefined,
    p_invited_email: invited_email ?? undefined,
    p_invited_username: invited_username ?? undefined,
    p_max_uses: max_uses ?? 1,
  } as Database['public']['Functions']['create_league_invite']['Args'])
  if (error) {
    if (error.code === '42501') {
      return { status: 403, body: { error: 'Only the commissioner can create invites.' } }
    }
    if (error.code === 'P0002') {
      return { status: 404, body: { error: 'League not found' } }
    }
    if (error.code === 'P0001' || error.code === '22023') {
      return { status: 400, body: { error: error.message } }
    }
    return { status: 500, body: { error: error.message } }
  }

  const invite = data as { invite_id: string; token: string; expires_at: string; resent: boolean }

  // D37 email seam: send AFTER the RPC committed the row (send-intent is
  // already recorded — D46); a sender failure never fails the request.
  let emailSent = false
  if (invited_email) {
    // The email needs league name + team label for its copy (§7.2 path 2);
    // both are commissioner-visible reads under RLS.
    const [{ data: league }, { data: team }] = await Promise.all([
      supabase.from('leagues').select('name').eq('id', leagueId).maybeSingle(),
      target_team_id
        ? supabase.from('teams').select('name').eq('id', target_team_id).maybeSingle()
        : Promise.resolve({ data: null as { name: string } | null }),
    ])
    try {
      const rendered = renderLeagueInviteEmail({
        leagueName: league?.name ?? 'a FieldScout league',
        teamLabel: team?.name ?? null,
        claimUrl: buildClaimUrl(invite.token),
        inviterName: null, // the email's From line is the product's; the card shows the inviter
      })
      const result = await emailSender.send({ to: invited_email, ...rendered })
      emailSent = result.ok
    } catch {
      emailSent = false
    }
  }

  return {
    status: invite.resent ? 200 : 201,
    body: { ...invite, email_sent: emailSent } as unknown as Json,
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/leagues/[id]/invites/[iid] — revoke
// ---------------------------------------------------------------------------

/**
 * R86 (batch 14): the `[id]` segment of `/api/leagues/[id]/invites/[iid]` is
 * LOAD-BEARING — it is passed to the RPC, which refuses an invite belonging
 * to a different league with the same 42501. Before this, a mis-addressed URL
 * revoked another league's invite and answered 200 (no authz consequence —
 * the commish gate is derived from the invite — but the wrong resource, and
 * the only doubly-nested route in the repo that ignored its parent).
 */
export async function revokeInvite(
  supabase: Supabase,
  leagueId: string,
  inviteId: string,
): Promise<ServiceResult> {
  if (!z.uuid().safeParse(leagueId).success || !z.uuid().safeParse(inviteId).success) {
    return { status: 400, body: { error: 'Invalid invite id.' } }
  }
  const { error } = await supabase.rpc('revoke_league_invite', {
    p_league_id: leagueId,
    p_invite_id: inviteId,
  })
  if (error) {
    if (error.code === '42501') {
      // Nonexistent invite and non-commish are indistinguishable (no
      // existence leak at the RPC) — surface as 403.
      return { status: 403, body: { error: 'Only the commissioner can revoke invites.' } }
    }
    return { status: 500, body: { error: error.message } }
  }
  return { status: 200, body: { ok: true } }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/invite — rotate/refresh the share code (§22.5)
// ---------------------------------------------------------------------------

export async function rotateInviteCode(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { data, error } = await supabase.rpc('rotate_invite_code', { p_league_id: leagueId })
  if (error) {
    if (error.code === '42501') {
      return { status: 403, body: { error: 'Only the commissioner can rotate the invite code.' } }
    }
    if (error.code === 'P0002') {
      return { status: 404, body: { error: 'League not found' } }
    }
    if (error.code === 'P0001') {
      return { status: 400, body: { error: error.message } }
    }
    return { status: 500, body: { error: error.message } }
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// PATCH /api/leagues/[id]/slug — set/clear the custom invite slug
// ---------------------------------------------------------------------------

export const setSlugInputSchema = z.strictObject({
  invite_slug: z.string().trim().min(1).max(60).nullable(),
})

export async function setInviteSlug(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = setSlugInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { data, error } = await supabase.rpc('set_league_invite_slug', {
    // §15.1 "set/clear": NULL clears the slug. The cast is the ONE seam here
    // that defeats the type checker (typegen renders p_slug as `string` —
    // PostgREST's OpenAPI carries no nullability), so the null CLEAR path is
    // pinned end-to-end (R88): pgTAP asserts the RPC + column + preview, and
    // the stack suite drives this exact call across the PostgREST wire —
    // load-bearing because it proves a NULL `p_slug` survives the
    // supabase-js/PostgREST round trip at all. If the schema above ever
    // relaxes `.nullable()` to `.optional()`, `{invite_slug: null}` stops
    // parsing and the service returns a flat 400 at the safeParse above,
    // never reaching this call — which is exactly what the vitest case's
    // 200 assertion trips on. (The `undefined`-cast/dropped-key hazard
    // p_slug's missing DEFAULT would create is only reachable from a `{}`
    // body, which no sanctioned caller sends — R89.)
    p_league_id: leagueId,
    p_slug: parsed.data.invite_slug as string,
  })
  if (error) {
    if (error.code === '42501') {
      return { status: 403, body: { error: 'Only the commissioner can set the invite slug.' } }
    }
    // BEFORE the P0001 arm: a missing/soft-deleted league is not an
    // invite_slug validation error (R87 — the mis-shape that arm produced).
    if (error.code === 'P0002') {
      return { status: 404, body: { error: 'League not found' } }
    }
    if (error.code === 'P0001') {
      return { status: 400, body: { error: { fieldErrors: { invite_slug: [error.message] } } } }
    }
    return { status: 500, body: { error: error.message } }
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/join + POST /api/invites/claim — outcome-jsonb mapping
// ---------------------------------------------------------------------------

export interface JoinClaimOutcome {
  ok: boolean
  already_member?: boolean
  league_id?: string
  team_id?: string
  league_name?: string
  reason?: string
  message?: string
}

/** D72 reason → HTTP status map (body always carries reason/message). */
const OUTCOME_STATUS: Record<string, number> = {
  not_found: 404,
  mismatch: 403,
  expired: 410,
  revoked: 410,
  spent: 410,
  seat_filled: 409,
  seat_unavailable: 409,
  league_full: 409,
  joins_closed: 409,
}

function mapOutcome(data: unknown): ServiceResult {
  const outcome = data as JoinClaimOutcome
  if (outcome.ok) {
    return { status: 200, body: outcome as unknown as Json }
  }
  return {
    status: OUTCOME_STATUS[outcome.reason ?? ''] ?? 400,
    body: outcome as unknown as Json,
  }
}

export const joinLeagueInputSchema = z.strictObject({
  code: z.string().trim().min(1).max(60),
})

/** POST /api/leagues/join — FREE (Q6/v2.8; F5): no Pro read anywhere. */
export async function joinLeague(supabase: Supabase, rawBody: unknown): Promise<ServiceResult> {
  const parsed = joinLeagueInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { data, error } = await supabase.rpc('join_league_by_code', {
    p_code_or_slug: parsed.data.code,
  })
  if (error) {
    if (error.code === '42501') {
      return { status: 401, body: { error: 'You must be signed in to join a league.' } }
    }
    return { status: 500, body: { error: error.message } }
  }
  return mapOutcome(data)
}

export const claimInviteInputSchema = z.strictObject({
  token: z.string().trim().min(1).max(64),
})

/** POST /api/invites/claim — E53/E54/E65 outcomes surface from the RPC. */
export async function claimInvite(supabase: Supabase, rawBody: unknown): Promise<ServiceResult> {
  const parsed = claimInviteInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { data, error } = await supabase.rpc('claim_league_invite', {
    p_token: parsed.data.token,
  })
  if (error) {
    if (error.code === '42501') {
      return { status: 401, body: { error: 'You must be signed in to claim an invite.' } }
    }
    return { status: 500, body: { error: error.message } }
  }
  return mapOutcome(data)
}
