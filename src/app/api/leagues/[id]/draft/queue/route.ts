import { NextResponse } from 'next/server'
import { z } from 'zod'

import { upsertQueue } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/queue — upsert/reorder MY queue (§15.2/§8.4;
 * L.B2.2). The body is the full ordered player list (replace semantics —
 * `draft_queues` is the one client-writable draft table, §12.6, and the 065
 * "Own queue write" policy backstops the service's own seat resolution).
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
  const result = await upsertQueue(supabase, id, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
