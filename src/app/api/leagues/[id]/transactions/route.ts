import { NextResponse } from 'next/server'
import { z } from 'zod'

import { submitAddDrop } from '@/lib/leagues/api/transactions-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/transactions — add/drop a free agent (§15.3 →
 *  `roster_add_drop`, migration 113; §13.1). Thin per the D68/D71 layering:
 *  auth + param plumbing only. Everything else — validation, the RPC call,
 *  the SQLSTATE mapping and the F65(b) identity guard — is
 *  `transactions-service.ts`, which the stack suite drives directly.
 *
 *  Body: { team_id, add_player_id?, drop_player_id?, action_id } — either
 *  side may be null, never both, and the `action_id` is one UUID per submit
 *  reused on retry (F227(f)). */
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
  const result = await submitAddDrop(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
