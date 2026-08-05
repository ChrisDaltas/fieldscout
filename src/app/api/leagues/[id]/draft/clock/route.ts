import { NextResponse } from 'next/server'
import { z } from 'zod'

import { setClock } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/clock — the E15 clock edit (§8.7 "Adjust
 * clock"; L.B2.3). A dedicated verb — the Builder-finalized choice vs
 * §15.2's list (D114; spec erratum v2.8.17): the draft PATCH stays the
 * config/order surface, and the clock edit is a live control like its
 * §15.2 siblings. Thin wrapper over `draft_set_clock` (069): subsequent
 * picks always; `extend_current: true` also extends the current deadline
 * (GREATEST — extend-only; paused + extend refused in the RPC).
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
  const result = await setClock(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
