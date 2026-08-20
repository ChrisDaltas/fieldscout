import { NextResponse } from 'next/server'
import { z } from 'zod'

import { reverseWonBid } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/reverse-bid — reverse a won auction bid
 * (§8.7 "undo a won bid" / Manual Edit Mode's "Reset pick" — D142(a);
 * spec §15.2 via the C40 erratum; L.C2.2). Thin wrapper over
 * `draft_reverse_won_bid` (087): the D141 pause-first gate, the D138 mock
 * refusal, the refund-by-derivation (D127/D131(1)) and the D97 before/after
 * system chat post all live in the RPC. Body: `pick_id`, `reason`
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
  const result = await reverseWonBid(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
