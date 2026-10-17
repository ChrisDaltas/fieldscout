import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdminUser } from '@/lib/auth/require-admin'
import { opReadResponse } from '@/lib/admin/op-read-response'
import { LEAGUE_SORTS, LEAGUE_TABLE_UNAVAILABLE } from '@/lib/admin/league-table'

/**
 * GET /api/admin/leagues — EVERY league on the platform, one page at a time
 * (M8 follow-up, Chris 2026-10-15; migration 193 `op_list_leagues`; F599).
 *
 * The admin gate (404 to everyone else), Zod, then ONE RPC through the
 * operator's OWN session client — the RPC re-checks the operator gate
 * in-body and reads past `leagues` RLS as its definer. No service role.
 *
 * Query: `q` (name or commissioner, literal), `sort`
 * (name | created | season | status | members | commissioner), `dir`
 * (asc | desc), `offset`, `limit` (1–100), `deleted` (1 = include deleted).
 * The answer carries the TRUE `total` and `more` — never a silent cap.
 * Before 193 is pushed this is a named 503 (TD9).
 */
const querySchema = z.object({
  q: z.string().trim().max(80, 'Search is at most 80 characters').default(''),
  sort: z.enum(LEAGUE_SORTS).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  deleted: z.enum(['0', '1']).default('0'),
})

export async function GET(request: Request) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const params = Object.fromEntries(
    [...new URL(request.url).searchParams.entries()].filter(([, v]) => v !== ''),
  )
  const parsed = querySchema.safeParse(params)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const p = parsed.data

  const { data, error } = await gate.supabase.rpc('op_list_leagues', {
    p_q: p.q,
    p_sort: p.sort,
    p_desc: p.dir === 'desc',
    p_limit: p.limit,
    p_offset: p.offset,
    p_include_deleted: p.deleted === '1',
  })
  if (!error && data && typeof data === 'object' && !Array.isArray(data) && !Array.isArray((data as { leagues?: unknown }).leagues)) {
    return NextResponse.json({ error: 'The league table came back without its leagues.' }, { status: 500 })
  }
  return opReadResponse(data, error, LEAGUE_TABLE_UNAVAILABLE)
}
