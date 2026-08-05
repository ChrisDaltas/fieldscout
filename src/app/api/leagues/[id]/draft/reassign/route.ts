import { NextResponse } from 'next/server'
import { z } from 'zod'

import { reassignPick } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/reassign — reassign a pick to another team
 * and/or correct its player (§15.2/L.B2.3). Thin wrapper over
 * `draft_reassign_pick` (069): exclusivity + capacity validation and the
 * before/after D97 system chat post live in the RPC.
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
  const result = await reassignPick(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
