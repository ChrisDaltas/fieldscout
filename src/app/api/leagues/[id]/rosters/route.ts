import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readRosters } from '@/lib/leagues/api/rosters-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/rosters — every franchise's roster (§15.3).
 *  Reads are RLS-scoped (D92) behind the membership gate in
 *  `rosters-service.ts`: a non-member is refused, never handed an empty
 *  league. */
export async function GET(_request: Request, { params }: RouteParams) {
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

  const result = await readRosters(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}
