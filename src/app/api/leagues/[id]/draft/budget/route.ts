import { NextResponse } from 'next/server'
import { z } from 'zod'

import { adjustBudget } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/budget — adjust a team's auction budget
 * (§8.7 "adjust a team's remaining budget"; spec §15.2 via the C40 erratum;
 * L.C2.2). Thin wrapper over `draft_adjust_budget` (087): E28's three
 * refusal arms (incl. D131(4)'s live-high-bid arm — its remedy copy passes
 * through verbatim), the D138 mock refusal, the cumulative
 * `budget_adjustments` write and the D97 before/after system chat post all
 * live in the RPC. NOT pause-gated (D141 does not name it). Body:
 * `team_id`, `delta` (integer dollars), `reason` (REQUIRED, stored nowhere
 * — F32/F40), optional `draft_id`.
 */
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
  const result = await adjustBudget(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
