import { NextResponse } from 'next/server'
import { z } from 'zod'

import { setClock } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/clock — the E15 clock edit (§8.7 "Adjust
 * clock"; L.B2.3). A dedicated verb — the Builder-finalized choice vs
 * §15.2's list (D114; spec erratum v2.8.17): the draft PATCH stays the
 * config/order surface, and the clock edit is a live control like its
 * §15.2 siblings. Thin wrapper over `draft_set_clock` (head 101):
 * subsequent picks/nominations ONLY — `extend_current: true` is an
 * unconditional refusal on both draft types since migration 090 retired
 * the extend arms (F57 ALIGN; E15 — a running clock is never rewritten;
 * F100). Pause-first on a real draft; a MOCK's launcher edits unpaused
 * (§8.7 v2.15 / MS.3).
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
  const result = await setClock(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
