import { NextResponse } from 'next/server'
import { z } from 'zod'

import { endDraft } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/end — §8.7 "End draft", C41's RULED
 * end-as-is (spec v2.10.1; §15.2 via the C40 erratum; L.C2.2). Thin
 * wrapper over `draft_end` (087): auction-only, live/paused only, the live
 * nomination voided un-awarded, the partial completion writer (rosters at
 * their prices, unfilled slots empty, league → `in_season`), the D138 mock
 * refusal and the D97 system chat post naming the unfilled-slot count all
 * live in the RPC. Terminal, so NOT pause-gated (the Reset treatment); the
 * hard-confirm phrase is the UI's (L.C3.2) — this route takes no phrase.
 * Body: `reason` (REQUIRED, stored nowhere — F32/F40), optional `draft_id`.
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
  const result = await endDraft(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
