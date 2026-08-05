import { NextResponse } from 'next/server'
import { z } from 'zod'

import { forcePick } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/force-pick — commissioner picks for the
 * on-clock team (`made_via = 'commissioner'`; §15.2/L.B2.3). Thin wrapper
 * over `draft_force_pick` (069). `action_id` REQUIRED wire-side — the
 * same D68(1) stamping contract as the pick route (one UUID per panel
 * submit; a retry replays as E2 instead of double-picking).
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
  const result = await forcePick(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
