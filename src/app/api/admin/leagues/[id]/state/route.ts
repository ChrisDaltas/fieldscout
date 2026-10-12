import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdminUser } from '@/lib/auth/require-admin'
import { opReadResponse } from '@/lib/admin/op-read-response'

/**
 * GET /api/admin/leagues/[id]/state — one league's live state (M8 L.G1.5;
 * spec §24.4 "Live-state view"; migration 186). The admin gate, then
 * `op_league_state` through the operator's OWN session client (the RPC
 * re-checks the operator gate in-body). One jsonb answer — no PostgREST cap.
 */
const idSchema = z.uuid()

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const { id } = await params
  const parsed = idSchema.safeParse(id)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid league id' }, { status: 400 })

  const { data, error } = await gate.supabase.rpc('op_league_state', { p_league_id: parsed.data })
  return opReadResponse(data, error)
}
