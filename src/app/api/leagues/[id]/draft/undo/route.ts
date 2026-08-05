import { NextResponse } from 'next/server'
import { z } from 'zod'

import { undoDraft } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/undo — undo the last pick, or cascade to
 * `to_pick_number` (E4; §15.2/L.B2.3). Thin wrapper over `draft_undo`
 * (069): soft undo (`is_undone = TRUE`), pool return, clock rewind — all
 * in the RPC under the §4.6 lock, with the D97 system chat post in-txn.
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
  const result = await undoDraft(supabase, id, body ?? {})
  return NextResponse.json(result.body, { status: result.status })
}
