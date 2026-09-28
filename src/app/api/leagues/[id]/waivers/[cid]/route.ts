import { NextResponse } from 'next/server'
import { z } from 'zod'

import { cancelClaim, reorderClaim } from '@/lib/leagues/api/waivers-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; cid: string }>
}

const idSchema = z.uuid()

type Gate = { refused: NextResponse; supabase?: undefined } | { refused?: undefined; supabase: Awaited<ReturnType<typeof createServerClient>> }

async function gate(id: string, cid: string): Promise<Gate> {
  if (!idSchema.safeParse(id).success) {
    return { refused: NextResponse.json({ error: 'League not found' }, { status: 404 }) }
  }
  if (!idSchema.safeParse(cid).success) {
    return { refused: NextResponse.json({ error: 'Claim not found' }, { status: 404 }) }
  }
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { refused: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { supabase }
}

/** PATCH /api/leagues/[id]/waivers/[cid] — move this claim to a new place in
 *  its team's order (tasks-M5 §5 → `waiver_claim_reorder`, migration 145;
 *  M5 L.D2.12). Body: { claim_order, action_id, reason? }. The service reads
 *  the team's pending order, moves [cid], and hands the whole list to the
 *  verb (which refuses by name if the set changed in between). */
export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const { id, cid } = await params
  const checked = await gate(id, cid)
  if (checked.refused) return checked.refused

  const body = await request.json().catch(() => null)
  const result = await reorderClaim(checked.supabase, id, cid, body)
  return NextResponse.json(result.body, { status: result.status })
}

/** DELETE /api/leagues/[id]/waivers/[cid] — cancel a pending claim (tasks-M5
 *  §5 → `waiver_claim_cancel`, migration 145; M5 L.D2.12). Body:
 *  { action_id, reason? } — the members DELETE precedent (a JSON body). */
export async function DELETE(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const { id, cid } = await params
  const checked = await gate(id, cid)
  if (checked.refused) return checked.refused

  const body = await request.json().catch(() => null)
  const result = await cancelClaim(checked.supabase, id, cid, body)
  return NextResponse.json(result.body, { status: result.status })
}
