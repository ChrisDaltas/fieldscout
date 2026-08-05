import { NextResponse } from 'next/server'
import { z } from 'zod'

import { launchMockDraft, listMockDrafts } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/mock-drafts — launch a solo mock from league
 * settings (§15.2/§8.8; any member — authorization is `config.mock.
 * launched_by`, never role, D110(1)). Thin wrapper over `create_mock_draft`
 * (071): capacity == team_count (D103(1)), the §22.5 caps (3 active,
 * 5/hour) as friendly 400s, config + order snapshot — all in the RPC.
 *
 * Launch dedupe is owned END-TO-END here (D110(11)/R149): the RPC always
 * receives a `p_action_id` — the body's hook-minted UUID when the launcher
 * UI sends one (D68(1)), else one minted per submit below (crypto lives in
 * the route, outside the `src/lib/leagues/**` determinism guard). A
 * replayed submit answers 200 `created:false` with the ORIGINAL mock —
 * never a duplicate-launch error. NULL (the RPC's legacy no-dedupe path)
 * is never sent.
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
  const result = await launchMockDraft(supabase, id, body ?? {}, {
    mintActionId: () => crypto.randomUUID(),
  })
  return NextResponse.json(result.body, { status: result.status })
}

/**
 * GET /api/leagues/[id]/mock-drafts — my mocks in this league (§15.2):
 * `active` (live|paused — the §16.5.2 resumable cards, E59) + `recaps`
 * (complete — kept until owner-deleted, §8.8). RLS-scoped member SELECT,
 * launcher-filtered; a non-member reads nothing → empty lists (no-leak).
 */
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

  const result = await listMockDrafts(supabase, id, user.id)
  return NextResponse.json(result.body, { status: result.status })
}
