import { NextResponse } from 'next/server'

import { ADMIN_NOT_FOUND_BODY } from '@/lib/admin/not-found'

/**
 * Shared answer for the operator's read-only RPCs (M8 L.G1.5, migration 186).
 * Fail loud: an error or a missing payload is never a 200 that looks like an
 * empty, healthy state.
 */
export function opReadResponse(
  data: unknown,
  error: { code?: string; message: string } | null,
  /** The named 503 while the RPC's migration is not pushed yet (TD9). */
  unavailable = 'The live-state view is not available yet.',
): NextResponse {
  if (error) {
    if (error.code === 'PGRST202') {
      // TD9 deploy-before-push: the RPC's migration (186 / 193) is not on this database yet.
      return NextResponse.json({ error: unavailable }, { status: 503 })
    }
    // A refused argument (193's sort / page bounds) — the RPC's own words.
    if (error.code === '22023') return NextResponse.json({ error: error.message }, { status: 400 })
    // TD8 / F581: the RPC's own gate refusing is answered like the route gate — 404.
    if (error.code === '42501') return NextResponse.json(ADMIN_NOT_FOUND_BODY, { status: 404 })
    if (error.code === 'P0002') return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return NextResponse.json({ error: 'The live-state view returned nothing.' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 200 })
}
