import { NextResponse } from 'next/server'
import { z } from 'zod'

import { proposeTrade, readTrades } from '@/lib/leagues/api/trades-service'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/trades — propose a trade (§15.3, §13.3 →
 *  `trade_propose`, migrations 148 / 151; M5 L.D3.6).
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard live in
 *  `trades-service.ts`, which the stack suite drives directly.
 *
 *  Body: { from_team_id, to_team_id, items: [{ player_id | faab_amount,
 *  from_team_id }], drops?, note?, action_id, reason? } — one `action_id` per
 *  submit (re-sending the same body replays it). A commissioner may propose
 *  for any team (TD5); `reason` is stored only on that arm. */
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
  const result = await proposeTrade(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}

/** GET /api/leagues/[id]/trades — the league's trades with status, reason,
 *  review countdown and (league vote, Q77) the vote count.
 *
 *  Query: `status` (open | closed | all; default all) · `team_id` (either
 *  side). Trades are not blind (§12.11) — every member reads every trade; a
 *  non-member gets the in-season family's no-leak 403 (R807), never an empty
 *  list. Countdowns are computed at the TimeProvider's now. Empty query
 *  values are dropped; the strict schema refuses an unknown key. */
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

  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (value !== '') query[key] = value
  }

  const result = await readTrades(supabase, id, user.id, query, systemTime.now())
  return NextResponse.json(result.body, { status: result.status })
}
