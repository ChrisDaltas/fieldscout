import { NextResponse } from 'next/server'
import { z } from 'zod'

import { setAutodraft } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/autodraft — "Auto-draft me" (§8.4/§15.2;
 * L.B2.2/F33). SELF toggle only: the service resolves the caller's own seat
 * and calls `set_team_autodraft` (072). The commissioner's any-team toggle
 * is the members PATCH (`PATCH …/members/[mid]` with `is_autodraft`).
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
  const result = await setAutodraft(supabase, id, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
