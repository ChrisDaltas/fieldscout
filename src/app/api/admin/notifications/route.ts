import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdminUser } from '@/lib/auth/require-admin'

/**
 * POST /api/admin/notifications — send a hand-written FieldScout notice
 * (M8 L.G1.2; spec §24.4 "Notices"; tasks-M8 TD10; Q97 / Q101; migration 185).
 *
 * A thin door: the admin gate (`requireAdminUser`), input shape (Zod), then
 * `op_send_notification` through the operator's OWN session client — the
 * RPC re-checks the operator gate in-body, picks the recipients, writes the
 * notifications in pages, the one audit receipt and (league sends) the
 * "FieldScout" league line. Nothing is computed or written here, and the
 * service role is never used.
 *
 *   audience  'all_users' | 'all_league_members' | 'league' (league_id then required)
 *   channels  today only ['in_app'] — email / push are future members, unbuilt
 *   action_id the retry key: a resend with the same id sends nothing twice
 *
 * Answers with the RPC's own result, including `recipients` (the count it
 * wrote) — never a re-read that PostgREST could cap at 1000.
 */

const bodySchema = z
  .object({
    audience: z.enum(['all_users', 'all_league_members', 'league']),
    league_id: z.uuid().optional(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000).optional(),
    link: z.string().max(500).optional(),
    channels: z.array(z.literal('in_app')).min(1).default(['in_app']),
    action_id: z.uuid(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((b) => (b.audience === 'league') === (b.league_id !== undefined), {
    message: 'league_id is required exactly when the audience is one league',
    path: ['league_id'],
  })

/** Map op_send_notification's refusals to HTTP — loud, never an empty 200. */
function mapRpcError(error: { code?: string; message: string }): NextResponse {
  if (error.code === 'PGRST202') {
    // TD9 deploy-before-push: migration 185 is not on this database yet.
    return NextResponse.json({ error: 'Sending notices is not available yet.' }, { status: 503 })
  }
  if (error.code === '42501') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (error.code === 'P0002') {
    const status = error.message.includes('no recipients') ? 422 : 404
    return NextResponse.json({ error: error.message }, { status })
  }
  if (error.code === '22023') {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ error: error.message }, { status: 500 })
}

export async function POST(request: Request) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const raw = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const b = parsed.data

  const { data, error } = await gate.supabase.rpc('op_send_notification', {
    p_audience: b.audience,
    p_title: b.title,
    p_body: b.body,
    p_link: b.link,
    p_league_id: b.league_id,
    p_channels: b.channels,
    p_action_id: b.action_id,
    p_reason: b.reason,
  })
  if (error) return mapRpcError(error)

  return NextResponse.json(data, { status: 200 })
}
