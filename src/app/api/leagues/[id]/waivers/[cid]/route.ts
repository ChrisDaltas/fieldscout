import { NextResponse } from 'next/server'
import { z } from 'zod'

import { cancelClaim, editClaim, reorderClaim } from '@/lib/leagues/api/waivers-service'
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

/** PATCH /api/leagues/[id]/waivers/[cid] — two moves on one claim, told apart
 *  by the body:
 *   - { claim_order, action_id, reason? } — move this claim to a new place in
 *     its team's order (tasks-M5 §5 → `waiver_claim_reorder`, migration 145;
 *     M5 L.D2.12). The service reads the team's pending order, moves [cid],
 *     and hands the whole list to the verb (which refuses by name if the set
 *     changed in between — and, in a FAAB league, if a smaller bid would go
 *     above a bigger one: F422(b), migration 150).
 *   - { faab_bid, drop_player_id, action_id, reason? } — change its bid and
 *     drop IN PLACE, one transaction (`waiver_claim_edit`, migration 150;
 *     M5 L.D2.9, PROGRESS F417). */
export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const { id, cid } = await params
  const checked = await gate(id, cid)
  if (checked.refused) return checked.refused

  const body = await request.json().catch(() => null)
  const isMove = typeof body === 'object' && body !== null && 'claim_order' in body
  const result = isMove ? await reorderClaim(checked.supabase, id, cid, body) : await editClaim(checked.supabase, id, cid, body)
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
