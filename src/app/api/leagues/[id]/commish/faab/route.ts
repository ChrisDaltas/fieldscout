import { NextResponse } from 'next/server'
import { z } from 'zod'

import { commishEditFaab } from '@/lib/leagues/api/commish-faab-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/commish/faab — set one team's FAAB balance (§15.4 →
 *  `commish_edit_faab`, migration 147; §10.1; M5 L.D2.12, D385).
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only; the schema, the
 *  RPC, the mapping and the F65(b) guard are `commish-faab-service.ts`'s.
 *
 *  Body: { team_id, balance, action_id, reason? } — `balance` any whole number
 *  0 … 2147483647 (above the budget allowed; R1172). Authorization is the
 *  RPC's (one no-leak 42501); this handler does not pre-check the role. */
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
  const result = await commishEditFaab(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
