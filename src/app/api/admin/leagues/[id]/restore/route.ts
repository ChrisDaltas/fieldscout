import { NextResponse } from 'next/server'
import { z } from 'zod'

import { RESTORE_LEAGUE_UNAVAILABLE } from '@/lib/admin/league-table'
import { opWriteResponse } from '@/lib/admin/op-write-response'
import { requireAdminUser } from '@/lib/auth/require-admin'

/**
 * POST /api/admin/leagues/[id]/restore — FieldScout restores an archived
 * league (ledger F851; migration 212 `op_restore_league`). The league's own
 * commissioner restores it from Leagues › Archived leagues; this is the door
 * for when he is gone. After it, the existing Make commissioner tool can seat
 * a new one.
 *
 *   action_id  the retry key — one per confirm dialog
 *   reason     optional
 *
 * The admin gate (404 to everyone else — TD8), the input shape, then the RPC
 * through the operator's OWN session client. It re-checks the gate in-body,
 * is idempotent on `action_id`, answers `changed: false` with why for a
 * league that is not archived, and writes one operator receipt + one
 * "FieldScout restored the league." line.
 */

const bodySchema = z.object({
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

  const { data, error } = await gate.supabase.rpc('op_restore_league', {
    p_league_id: leagueId.data,
    p_action_id: parsed.data.action_id,
    p_reason: parsed.data.reason,
  })
  return opWriteResponse(data, error, RESTORE_LEAGUE_UNAVAILABLE)
}
