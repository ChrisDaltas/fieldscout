import { NextResponse } from 'next/server'
import { z } from 'zod'

import { cancelNomination } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/cancel-nomination — §8.7 "Edit current
 * nomination" = cancel-and-renominate (D143; spec §15.2 via the C40
 * erratum; L.C2.2). Thin wrapper over `draft_cancel_nomination` (087): the
 * D141 pause-first gate (paused only), the bidding-phase check, the D162
 * `voided_at` stamp (the sequence number is NOT consumed), the D138 mock
 * refusal and the D97 system chat post all live in the RPC. Body: `reason`
 * (REQUIRED, stored nowhere — F32/F40), optional `draft_id`.
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
  const result = await cancelNomination(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
