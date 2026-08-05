import { NextResponse } from 'next/server'
import { z } from 'zod'

import { makePick } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/pick — make a pick (§15.2; L.B2.2). Thin
 * wrapper over `draft_make_pick` via the service: the body carries
 * `player_id` + the hook-minted `action_id` (D68(1) — one UUID per user
 * submit, so a retry replays as E2 instead of double-picking). Turn,
 * availability (E1), and the mock seam are the RPC's under the §4.6 lock.
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
  const result = await makePick(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
