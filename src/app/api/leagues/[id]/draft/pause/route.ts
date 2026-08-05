import { NextResponse } from 'next/server'
import { z } from 'zod'

import { pauseOrResumeDraft } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/pause — pause/resume (§15.2's ONE route for
 * both verbs: `action: 'pause' | 'resume'` in the body; L.B2.3). Thin
 * wrapper over `draft_pause`/`draft_resume` (069): commissioner-only on
 * real drafts, LAUNCHER-only on mocks (D110(1) — a mock room passes its
 * `draft_id` and this same route is the E59 resume path). `reason`
 * accepted, stored nowhere (F32/D97 — the system chat post is the
 * transparency).
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
  const result = await pauseOrResumeDraft(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
