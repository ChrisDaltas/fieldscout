import { NextResponse } from 'next/server'

import { pauseOrResumeDraft, standaloneMockScope } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ mockId: string }>
}

/**
 * POST /api/mocks/[mockId]/pause — pause/resume a STANDALONE practice draft
 * (MP.6b). ONE route for both verbs, `action: 'pause' | 'resume'` in the
 * body — §15.2's shape, kept rather than re-decided.
 *
 * These two are the ONLY control verbs this task opens. The §8.7
 * commissioner surface stays league-side: it is MS's lane (tasks-MP §7),
 * and pause/resume are here because a practice room's own lifecycle needs
 * them (§8.8's E59 resume path), not because the control surface moved.
 * `draft_pause`/`draft_resume` already carry their launcher arms (069's
 * mock arm, re-emitted by 095), so this route adds no authority — it gives
 * the shipped authority a URL that has no league in it.
 *
 * NO feature-flag read (§4 rule 13 / D231(4)).
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
  const result = await pauseOrResumeDraft(supabase, standaloneMockScope(mockId, user.id), body)
  return NextResponse.json(result.body, { status: result.status })
}
