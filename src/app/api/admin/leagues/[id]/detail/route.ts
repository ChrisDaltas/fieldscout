import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdminUser } from '@/lib/auth/require-admin'
import { opReadResponse } from '@/lib/admin/op-read-response'
import { LEAGUE_DETAIL_UNAVAILABLE } from '@/lib/admin/league-table'

/**
 * GET /api/admin/leagues/[id]/detail — one league's members and full settings
 * (M8 follow-up, Chris 2026-10-15; migration 187 `op_league_detail`). The
 * admin gate, then ONE RPC through the operator's own session client (the RPC
 * re-checks the operator gate in-body). Unknown league → 404; before 187 is
 * pushed → a named 503 (TD9).
 */
const idSchema = z.uuid()

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const { id } = await params
  const parsed = idSchema.safeParse(id)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid league id' }, { status: 400 })

  const { data, error } = await gate.supabase.rpc('op_league_detail', { p_league_id: parsed.data })
  if (!error && data && typeof data === 'object' && !Array.isArray(data) && !Array.isArray((data as { members?: unknown }).members)) {
    return NextResponse.json({ error: 'The league detail came back without its members.' }, { status: 500 })
  }
  return opReadResponse(data, error, LEAGUE_DETAIL_UNAVAILABLE)
}
