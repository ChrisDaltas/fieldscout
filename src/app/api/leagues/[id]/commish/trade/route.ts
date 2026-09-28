import { NextResponse } from 'next/server'
import { z } from 'zod'

import { commishTrade } from '@/lib/leagues/api/trades-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/commish/trade — the commissioner's trade tools
 *  (§15.4 → `commish_force_or_reverse_trade`, migration 156; §10.1, §13.3,
 *  E11; M5 L.D3.6, D416, PROGRESS F451).
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only; the schema, the
 *  RPC, the mapping and the F65(b) guard on the echoed op + trade are
 *  `trades-service.ts`'s.
 *
 *  Body: { trade_id, op: 'approve' | 'veto' | 'force' | 'reverse',
 *  action_id, reason? } — reason OPTIONAL (Q66). Authorization is the RPC's
 *  (one no-leak 42501 → 403); a refusal by name is a 409 with the database's
 *  sentence; a malformed argument a 400. */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await commishTrade(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
