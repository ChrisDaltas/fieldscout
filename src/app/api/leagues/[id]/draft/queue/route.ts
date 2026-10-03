import { NextResponse } from 'next/server'
import { z } from 'zod'

import { leagueScope, readTeamQueue, upsertQueue } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/queue — upsert/reorder MY queue, or (F524) a
 * team the commissioner names in `team_id` (receipted by 171) (§15.2/§8.4;
 * L.B2.2). The body is the full ordered player list (replace semantics —
 * `draft_queues` is the one client-writable draft table, §12.6, and the 065
 * "Own queue write" policy backstops the service's own seat resolution).
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
  const result = await upsertQueue(supabase, leagueScope(id), user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}

/**
 * GET /api/leagues/[id]/draft/queue?team_id=<uuid>[&draft_id=<uuid>] — a
 * team's Targets, for the commissioner who is about to edit them (F524 /
 * F48). His own seat reads like any manager's; another team is read through
 * `draft_queue_for_team` (178). A manager naming another team is a 403; on a
 * chain without 178 the read is a named 503, never an empty queue.
 */
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

  const search = new URL(request.url).searchParams
  const query: Record<string, string> = {}
  for (const key of ['team_id', 'draft_id']) {
    const value = search.get(key)
    if (value !== null) query[key] = value
  }
  const result = await readTeamQueue(supabase, leagueScope(id), user.id, query)
  return NextResponse.json(result.body, { status: result.status })
}
