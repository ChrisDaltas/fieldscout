import { NextResponse } from 'next/server'
import { z } from 'zod'

import { opWriteResponse } from '@/lib/admin/op-write-response'
import { requireAdminUser } from '@/lib/auth/require-admin'

/**
 * POST /api/admin/games/[id]/status — mark an NFL game (M8 L.G1.6; spec
 * §24.4 "Game status"; Q100; tasks-M8 TD7; migration 184; F585).
 *
 *   status     'in_week'      moved later this week (the week waits for it)
 *              'out_of_week'  moved out of the week (its players score 0)
 *              'cancelled'    cancelled (its players score 0)
 *              'normal'       back to normal (clears the mark)
 *   action_id  the retry key — one per confirm dialog
 *
 * The admin gate (404 to everyone else — TD8), the input shape, then
 * `op_set_game_status` through the operator's OWN session client. The RPC
 * re-checks the gate in-body, refuses a final game or a week already final in
 * any league (22023 → 400 with its words), is idempotent on `action_id` and
 * a no-op when the mark is unchanged. There is no finalize here (Q99 (a)).
 */

// nfl_games.id is TEXT (the provider's game id). Bounded and printable only.
const gameIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/)

const bodySchema = z.object({
  status: z.enum(['in_week', 'out_of_week', 'cancelled', 'normal']),
  action_id: z.uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const { id } = await params
  const gameId = gameIdSchema.safeParse(id)
  if (!gameId.success) return NextResponse.json({ error: 'Invalid game id' }, { status: 400 })

  const raw = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const b = parsed.data

  const { data, error } = await gate.supabase.rpc('op_set_game_status', {
    p_game_id: gameId.data,
    p_status: b.status,
    p_action_id: b.action_id,
    p_reason: b.reason,
  })
  return opWriteResponse(data, error, 'Marking games is not available yet.')
}
