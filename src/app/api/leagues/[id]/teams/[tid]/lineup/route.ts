import { NextResponse } from 'next/server'
import { z } from 'zod'

import { setLineup } from '@/lib/leagues/api/lineup-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; tid: string }>
}

const idSchema = z.uuid()

/** PATCH /api/leagues/[id]/teams/[tid]/lineup — set this week's lineup
 *  (§15.3 → `set_lineup`, migration 112/114; §11.2). Thin per the D68/D71
 *  layering: auth + param plumbing only. Everything else — validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard — is
 *  `lineup-service.ts`, which the stack suite drives directly.
 *
 *  Body: { week, slot_map, action_id, reason? } — the FULL canonical map
 *  incl. IR keys (an absent IR key is a removal), one UUID per submit —
 *  re-sending the same body replays it (R815) — and a reason only for the
 *  commissioner arm (F224(e)). */
export async function PATCH(request: Request, { params }: RouteParams) {
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
  const result = await setLineup(supabase, id, tid, body)
  return NextResponse.json(result.body, { status: result.status })
}
