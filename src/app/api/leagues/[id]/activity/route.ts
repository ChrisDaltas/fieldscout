import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readActivity } from '@/lib/leagues/api/activity-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/activity — the unified activity feed (§15.3, §13.4).
 *
 *  Query: `kind` (all|transaction|system) · `type` (csv of
 *  `transactions.type`) · `week` · `team_id` · `limit` (≤ 100) · `before`
 *  (ISO cursor). Only the params present are forwarded, so an absent filter
 *  is absent rather than a defaulted one — the service refuses an
 *  unrecognized key with a field error.
 *
 *  Reads are RLS-scoped (D92): a non-member reads nothing and gets an empty
 *  feed, the no-leak posture for league reads. */
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

  // `Object.fromEntries` over the URL's params: repeated keys collapse to the
  // last, which the strict schema then validates. An EMPTY string is dropped
  // rather than forwarded — `?week=` is "no week filter", not a parse error
  // the caller cannot see the cause of.
  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (value !== '') query[key] = value
  }

  const result = await readActivity(supabase, id, query)
  return NextResponse.json(result.body, { status: result.status })
}
