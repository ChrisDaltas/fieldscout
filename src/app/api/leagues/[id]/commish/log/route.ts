import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readCommishLog } from '@/lib/leagues/api/commish-log-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/commish/log — the §10.3 audit log, ANY member reads
 *  it (spec §15.4:1703; §12.12's SELECT policy is `is_league_member`,
 *  `123:333-334`; M6A L.E1.11, PROGRESS D351). This is what L.E1.13's
 *  League Home activity section reads (Q66).
 *
 *  Query: `limit` (≤ 100) · `cursor` (the opaque token a previous page's
 *  `next_cursor` handed back — the composite `(created_at, id)` boundary,
 *  R770). Only the params present are forwarded; the service refuses an
 *  unrecognized key or a malformed cursor by name.
 *
 *  Membership is asserted in the service before any read (R807): a
 *  non-member gets the in-season family's one no-leak 403, never an empty
 *  log. A row is a CLAIM, not proof a verb ran (C70) — see the service. */
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

  // `?cursor=` (empty) is "no cursor", not a malformed one the caller
  // cannot see the cause of — the activity route's convention.
  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (value !== '') query[key] = value
  }

  const result = await readCommishLog(supabase, id, query)
  return NextResponse.json(result.body, { status: result.status })
}
