import { NextResponse } from 'next/server'

import { ADMIN_NOT_FOUND_BODY } from '@/lib/admin/not-found'

/**
 * Shared answer for the operator's WRITE RPCs (M8 L.G1.6 — the job knobs,
 * migration 183, and the game mark, migration 184). Same shape as
 * `op-read-response.ts`, and as loud:
 *
 *   PGRST202  the RPC is not on this database yet (TD9 deploy-before-push) → 503,
 *             named, so the console can say so instead of a raw error
 *   42501     the RPC's own in-body gate refused → 404 (TD8: never reveal the console)
 *   22023     a refusal by rule (lineup locking cannot be paused, a final game,
 *             a reused action id …) → 400 with the RPC's own words
 *   P0002     no such league / game → 404 with the RPC's own words
 *   other     500 with the message
 *
 * A success must be a JSON object (the RPC's `changed` / `why` / report);
 * anything else is a 500, never an empty 200 that looks like "done".
 */
export function opWriteResponse(
  data: unknown,
  error: { code?: string; message: string } | null,
  unavailable: string,
): NextResponse {
  if (error) {
    if (error.code === 'PGRST202') return NextResponse.json({ error: unavailable }, { status: 503 })
    if (error.code === '42501') return NextResponse.json(ADMIN_NOT_FOUND_BODY, { status: 404 })
    if (error.code === '22023') return NextResponse.json({ error: error.message }, { status: 400 })
    if (error.code === 'P0002') return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return NextResponse.json({ error: 'The operator action returned nothing.' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 200 })
}
