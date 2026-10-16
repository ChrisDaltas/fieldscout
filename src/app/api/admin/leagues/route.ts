import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdminUser } from '@/lib/auth/require-admin'

/**
 * GET /api/admin/leagues?q= — the console's league finder (M8 L.G1.6).
 *
 * Name search runs through the operator's OWN session client, so it is bounded
 * by `leagues` RLS (members / owner — 052): it finds the leagues the operator
 * belongs to. Any other league is opened by pasting its link or id — the
 * live-state read (`op_league_state`, 186) takes any league id. A platform-wide
 * name search needs an operator RPC that does not exist yet (F-row filed by
 * L.G1.6); the service role is not used to fake one.
 *
 * `limit` rows at most, with `more` saying the list was cut — never a silent cap.
 */
const SEARCH_LIMIT = 25
const qSchema = z.string().trim().max(80)

export async function GET(request: Request) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const parsed = qSchema.safeParse(new URL(request.url).searchParams.get('q') ?? '')
  if (!parsed.success) return NextResponse.json({ error: 'Search is at most 80 characters' }, { status: 400 })
  // ilike wildcards in the user's text are matched literally.
  const q = parsed.data.replace(/[\\%_]/g, (c) => `\\${c}`)

  let query = gate.supabase
    .from('leagues')
    .select('id, name, season, status')
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .limit(SEARCH_LIMIT + 1)
  if (q !== '') query = query.ilike('name', `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!Array.isArray(data)) return NextResponse.json({ error: 'The league search returned nothing.' }, { status: 500 })

  return NextResponse.json(
    { leagues: data.slice(0, SEARCH_LIMIT), more: data.length > SEARCH_LIMIT, limit: SEARCH_LIMIT },
    { status: 200 },
  )
}
