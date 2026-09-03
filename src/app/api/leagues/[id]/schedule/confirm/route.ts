import { NextResponse } from 'next/server'
import { z } from 'zod'

import { confirmRemix } from '@/lib/leagues/api/schedule-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/schedule/confirm — apply a previewed remix (§15.3,
 *  §11.7 → `schedule_remix_confirm`, migration 111; atomic, with the D97
 *  system chat post written in the same transaction).
 *
 *  Body: { seed, reason?, action_id } — and nothing else. **The applied
 *  schedule is REGENERATED IN THE RPC's BODY from the seed**; no route,
 *  handler or client ever hands the server a set of matchups. The strict
 *  schema in `schedule-service.ts` is the enforcement. */
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
  const result = await confirmRemix(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
