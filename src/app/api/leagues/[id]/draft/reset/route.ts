import { NextResponse } from 'next/server'
import { z } from 'zod'

import { resetDraft } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/reset — wipe to pre-draft (§15.2/L.B2.3).
 * Thin wrapper over `draft_reset` (069): `drafting`/`paused` only
 * (post-completion reset is M6's — F44), picks soft-undone, draft AND
 * league back to `scheduled`, the stored schedule instant cleared (the
 * D107(5) auto-start seam), D97 system chat post — all in the RPC.
 */
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
  const result = await resetDraft(supabase, id, body ?? {})
  return NextResponse.json(result.body, { status: result.status })
}
