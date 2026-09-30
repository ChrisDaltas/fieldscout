import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readCommishSummary } from '@/lib/leagues/api/commish-summary-service'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/commish/summary — what needs the commissioner now
 *  (M6 L.E1.32; spec §10.1 / §16.2 as folded by v2.16.77 — the console is a
 *  launchpad, PROGRESS D443; D455). Commissioners and co-commissioners only:
 *  a non-member gets the in-season family's no-leak 403 (the same answer a
 *  nonexistent league gives), a manager this read's own 403.
 *
 *  Three sections — teams with no manager and autopilot off, trades waiting
 *  on the commissioner's review, matchups that can / cannot be corrected yet
 *  — each `unavailable` by name on a database without its object (D447).
 *  No query parameters. Thin per D68/D71: auth + plumbing only; the service
 *  does the rest, at the TimeProvider's now. */
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

  const unexpected = [...new URL(request.url).searchParams.keys()]
  if (unexpected.length > 0) {
    return NextResponse.json({ error: `This read takes no query parameters (got: ${unexpected.join(', ')}).` }, { status: 400 })
  }

  const result = await readCommishSummary(supabase, id, user.id, systemTime.now())
  return NextResponse.json(result.body, { status: result.status })
}
