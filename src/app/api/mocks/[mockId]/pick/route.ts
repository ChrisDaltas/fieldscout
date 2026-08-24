import { NextResponse } from 'next/server'

import { makePick, standaloneMockScope } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ mockId: string }>
}

/**
 * POST /api/mocks/[mockId]/pick — pick in a STANDALONE practice draft (MP
 * task MP.6b; spec v2.16 §8.8).
 *
 * THE URL SHAPE IS A DECISION, not a detail (D243(5); this lane's
 * two-questions-two-endpoints rule, already stated by `POST /api/mocks` and
 * `DELETE /api/mocks/[mockId]`): `/api/leagues/[id]/draft/pick` answers
 * "pick in THIS LEAGUE's draft" and its authorization story is league
 * membership all the way down; this answers "pick in THIS PRACTICE draft",
 * and there is no league in the question. **Every future standalone verb —
 * MP.8's report included — inherits this shape.**
 *
 * It is a THIN WRAPPER over the SAME service function the league route
 * calls, with one argument different: the scope. There is no second
 * resolver, no per-verb branch and no forked pick path — `makePick` runs
 * `resolveDraftForAction`, which carries the standalone arm, and the RPC
 * (`draft_make_pick`) is the authority exactly as before.
 *
 * NO feature-flag read (tasks-MP §4 rule 13 / D231(4)): this is a
 * server-authoritative surface; `mockDrafts` gates the UI that calls it.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { mockId } = await params

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await makePick(supabase, standaloneMockScope(mockId, user.id), body)
  return NextResponse.json(result.body, { status: result.status })
}
