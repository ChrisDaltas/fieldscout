import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createDraft, patchDraftOrder } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft — create/schedule the draft from settings
 * (§15.2; L.B2.1). Thin wrapper over `draft_create` (D95 hydration +
 * idempotency live in the RPC). Commissioner-only in-body (42501 → 403).
 */
export async function POST(_request: Request, { params }: RouteParams) {
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

  const result = await createDraft(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}

/**
 * PATCH /api/leagues/[id]/draft — pre-start order edit incl. randomize
 * (§15.2; D101/D108(7)). NO schedule field — `draft_scheduled_at` flows
 * through the league-settings PATCH only (D95); the service's strict schema
 * enforces it. Randomize entropy lives HERE (crypto), outside the
 * `src/lib/leagues/**` determinism guard — the service's shuffle is pure
 * over these injected values and `draft_set_order` validates + writes.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
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
  const result = await patchDraftOrder(supabase, id, body, {
    randomValues: (count) => {
      const raw = new Uint32Array(count)
      crypto.getRandomValues(raw)
      return Array.from(raw, (v) => v / 2 ** 32)
    },
  })
  return NextResponse.json(result.body, { status: result.status })
}
