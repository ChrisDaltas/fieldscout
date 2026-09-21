import { NextResponse } from 'next/server'
import { z } from 'zod'

import { renameOwnTeam } from '@/lib/leagues/api/team-rename-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; tid: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/teams/[tid]/name — a MANAGER renames his OWN franchise (`rename_own_team`, migration 128 §4; M6A L.E1.13). NOT a commissioner door: no reason, no receipt, no action_id (128:659-693) — the commissioner's audited rename of any team is `POST …/commish/team`.
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  league-of-the-URL check, the RPC call and the SQLSTATE mapping live in
 *  `team-rename-service.ts`, which the stack suite drives directly.
 *
 *  Body: { name }. Authorization is the RPC's: ONE no-leak 42501. */
export async function POST(request: Request, { params }: RouteParams) {
  const { id, tid } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!idSchema.safeParse(tid).success) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await renameOwnTeam(supabase, id.toLowerCase(), tid.toLowerCase(), body)
  return NextResponse.json(result.body, { status: result.status })
}
