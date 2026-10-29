import { NextResponse } from 'next/server'
import { z } from 'zod'

import { restoreLeague } from '@/lib/leagues/api/league-archive-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/restore — `{ reason? }`. The league's commissioner
 *  brings an archived league back exactly as it was (F716 / migration 212).
 *  Authorization is the RPC's (one no-leak 42501 → 403). */
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

  const body = await request.json().catch(() => ({}))
  const result = await restoreLeague(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
