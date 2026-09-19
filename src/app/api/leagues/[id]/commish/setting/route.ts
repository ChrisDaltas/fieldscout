import { NextResponse } from 'next/server'
import { z } from 'zod'

import { commishChangeSetting } from '@/lib/leagues/api/commish-setting-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/commish/setting — the audited in-season change of ONE league setting (spec §15.4:1701 → `commish_change_setting`; §10.3; D347's per-key policy; M6A L.E1.11, PROGRESS D351). Which keys may change is 129's policy table — refused keys come back with 129's copy verbatim.
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard all live in
 *  `commish-setting-service.ts`, which the stack suite drives directly.
 *
 *  Body: { key, value, rescore?, action_id, reason? } — one UUID per submit (re-sending the same body replays it).
 *  `reason` is OPTIONAL (Q66, spec v2.16.41; end to end since migration 131)
 *  and blank normalises to absent.
 *
 *  Authorization is the RPC's: ONE no-leak 42501 for "no such league" and
 *  "not a commissioner" alike. This handler deliberately does not pre-check
 *  the role — that would duplicate the gate and could drift from it. */
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
  const result = await commishChangeSetting(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
