import { NextResponse } from 'next/server'
import { z } from 'zod'

import { assignManager } from '@/lib/leagues/api/members-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; tid: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/teams/[tid]/assign-manager — seat a user on a
 *  franchise, opening a stint (commish; §15.1, §7.2.1).
 *
 *  BOTH segments are validated and BOTH are passed down: the RPC refuses a
 *  franchise that is not [id]'s, so a mis-addressed URL cannot seat someone
 *  in another league and answer 200 (R86). */
export async function POST(request: Request, { params }: RouteParams) {
  const { id, tid } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!idSchema.safeParse(tid).success) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await assignManager(supabase, id, tid, body)
  return NextResponse.json(result.body, { status: result.status })
}
