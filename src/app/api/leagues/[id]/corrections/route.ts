import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readStatCorrections } from '@/lib/leagues/api/corrections-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/corrections — the league's stat corrections (§15.3,
 *  §23.4; M6 L.E2.3, PROGRESS D454): only corrections that CHANGED one of its
 *  scores (Q81), each in plain words, newest first.
 *
 *  Query: `week` (1–18) · `limit` (≤ 100) · `cursor` (a previous page's
 *  `next_cursor`). Only the params present are forwarded; the service
 *  refuses an unrecognized key with a field error. Membership is asserted in
 *  the service before any read (R807): a non-member gets the in-season
 *  family's one no-leak 403. A database without migration 172 answers a
 *  named 503 (TD15). */
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

  // An EMPTY string is "no filter", not a parse error (`?week=`).
  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (value !== '') query[key] = value
  }

  const result = await readStatCorrections(supabase, id, query)
  return NextResponse.json(result.body, { status: result.status })
}
