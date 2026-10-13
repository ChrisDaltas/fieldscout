import { NextResponse } from 'next/server'

/**
 * Shared answer for the operator's read-only RPCs (M8 L.G1.5, migration 186).
 * Fail loud: an error or a missing payload is never a 200 that looks like an
 * empty, healthy state.
 */
export function opReadResponse(
  data: unknown,
  error: { code?: string; message: string } | null,
): NextResponse {
  if (error) {
    if (error.code === 'PGRST202') {
      // TD9 deploy-before-push: migration 186 is not on this database yet.
      return NextResponse.json({ error: 'The live-state view is not available yet.' }, { status: 503 })
    }
    if (error.code === '42501') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (error.code === 'P0002') return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return NextResponse.json({ error: 'The live-state view returned nothing.' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 200 })
}
