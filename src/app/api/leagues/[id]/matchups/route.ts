import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readMatchups } from '@/lib/leagues/api/matchups-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/matchups?week= — one week's matchups, live scores
 *  and finalized results (§15.3; §11.4). `week` is required (the spec's own
 *  `?week=`); which week a surface shows by default is the surface's call.
 *  Reads are RLS-scoped (D92) behind the membership gate in
 *  `matchups-service.ts`. */
export async function GET(request: Request, { params }: RouteParams) {
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

  // The activity route's rule: only the params PRESENT reach the schema; an
  // empty `?week=` is an absent week (a field error the caller can read),
  // not a parse error it cannot see the cause of.
  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (value !== '') query[key] = value
  }

  const result = await readMatchups(supabase, id, query)
  return NextResponse.json(result.body, { status: result.status })
}
