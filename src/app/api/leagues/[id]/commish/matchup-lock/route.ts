import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readCommishMatchupEditLock } from '@/lib/leagues/api/commish-matchup-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/commish/matchup-lock?matchup_id= — can this
 *  matchup's score or result be corrected yet? (Q61, ruled 2026-09-27: not
 *  while any starter on either team is still playing; a final week always.)
 *  M6A L.E1.18, migration 135's `commish_matchup_edit_lock` — the SAME helper
 *  `commish_edit_score` / `commish_set_result` refuse on, so the panel and the
 *  verbs cannot disagree.
 *
 *  Thin per D68/D71: auth + param plumbing only; the service validates, calls
 *  the RPC and maps SQLSTATEs (the one no-leak 403 for "no such league" and
 *  "not a commissioner" alike; 404 for a matchup that is not this league's). */
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

  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) query[key] = value

  const result = await readCommishMatchupEditLock(supabase, id, query)
  return NextResponse.json(result.body, { status: result.status })
}
