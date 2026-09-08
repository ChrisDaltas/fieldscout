import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readBoxScore } from '@/lib/leagues/api/box-score-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/matchups/box?week=&team= — one team's box score
 *  for one week: the starters with the worker's per-starter points /
 *  pending / no-line states and each one's Live Mode phase (§11.4 — the
 *  lines the matchup view refetches on `scores_updated`; M4 task L.D5.2).
 *  Both query params are required; nothing is inferred (§23.3). Reads are
 *  RLS-scoped (D92) behind the membership gate in `box-score-service.ts`. */
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

  // The matchups route's rule: only the params PRESENT reach the schema.
  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (value !== '') query[key] = value
  }

  const result = await readBoxScore(supabase, id, query)
  return NextResponse.json(result.body, { status: result.status })
}
