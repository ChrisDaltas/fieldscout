import { NextResponse } from 'next/server'
import { z } from 'zod'

import { SET_COMMISSIONER_UNAVAILABLE } from '@/lib/admin/league-table'
import { opWriteResponse } from '@/lib/admin/op-write-response'
import { requireAdminUser } from '@/lib/auth/require-admin'

/**
 * POST /api/admin/leagues/[id]/commissioner — FieldScout makes a member the
 * commissioner when the sitting one is missing (ledger F750; spec §24.4
 * v2.16.106; migration 208).
 *
 *   member_id  the league_members row to promote (a person, not an empty seat)
 *   action_id  the retry key — one per confirm dialog
 *   reason     optional
 *
 * The admin gate (404 to everyone else — TD8), the input shape, then
 * `op_set_commissioner` through the operator's OWN session client. The RPC
 * re-checks the gate in-body, refuses a deleted league or another league's
 * member (P0002 → 404 with its words) and an empty seat (22023 → 400), is
 * idempotent on `action_id`, and answers `changed: false` with why for a
 * member who already is the commissioner. The old commissioner becomes a
 * manager and keeps his team.
 */

const bodySchema = z.object({
  member_id: z.uuid(),
  action_id: z.uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const { id } = await params
  const leagueId = z.uuid().safeParse(id)
  if (!leagueId.success) return NextResponse.json({ error: 'Invalid league id' }, { status: 400 })

  const raw = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const b = parsed.data

  const { data, error } = await gate.supabase.rpc('op_set_commissioner', {
    p_league_id: leagueId.data,
    p_new_member_id: b.member_id,
    p_action_id: b.action_id,
    p_reason: b.reason,
  })
  return opWriteResponse(data, error, SET_COMMISSIONER_UNAVAILABLE)
}
