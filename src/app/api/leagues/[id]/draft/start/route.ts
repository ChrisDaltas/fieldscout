import { NextResponse } from 'next/server'
import { z } from 'zod'

import { startDraft } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/start — the commissioner's manual start
 * (§15.2 → rpc `draft_start`; §8.5.1's early path beside D94's auto-start).
 * Create-if-absent, snapshot-before-transition, order resolution, and the
 * idempotent re-start all live in the RPC (066/D105).
 */
export async function POST(_request: Request, { params }: RouteParams) {
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

  const result = await startDraft(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}
