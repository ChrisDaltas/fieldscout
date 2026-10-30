import { NextResponse } from 'next/server'
import { z } from 'zod'

import { REPORTS_UNAVAILABLE } from '@/lib/admin/content-reports'
import { requireAdminUser } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { isDoorNotPushed, isMissingSchemaObject } from '@/lib/supabase/postgrest-errors'

interface RouteParams {
  params: Promise<{ id: string }>
}

const bodySchema = z.object({ action: z.enum(['review', 'remove']) })

/** The doors this route calls, and the parameters it sends them. */
const REVIEW_DOOR = { mark_content_report_reviewed: ['p_report_id'] } as const
const REMOVE_DOOR = { remove_list_comment: ['p_list_id', 'p_comment_id'] } as const

type RpcError = { code?: string | null; message: string; hint?: string | null }

/**
 * POST /api/admin/reports/[id] — Admin › Reports' two actions (Community
 * launch plan C10), both through the database's own doors, called with the
 * ADMIN'S OWN session (they check `is_platform_operator()` and stamp
 * `auth.uid()`), never the service role:
 *
 *  - `{ action: 'review' }` → `mark_content_report_reviewed` (214): stamps
 *    the report reviewed by you, now, and writes the operator log. An
 *    already-reviewed report is left as it is and says so.
 *  - `{ action: 'remove' }` → a reported COMMENT only: `remove_list_comment`
 *    (213, C2's operator permission). Removed as an admin, it also stamps
 *    every open report on that comment reviewed by you (214) — the record of
 *    who took it down. Which comment is read from the report itself (service
 *    role), so the page can't aim Remove at anything else.
 *
 * Every refusal is the database's own words: 404 for a report or comment
 * that isn't there, 503 while 214 isn't pushed. Nothing answers OK unless
 * the database says it changed (or that it already had).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'That report isn’t there.' }, { status: 404 })
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  if (parsed.data.action === 'review') {
    const { data, error } = await gate.supabase.rpc('mark_content_report_reviewed', { p_report_id: id })
    if (error) return refusal(error, REVIEW_DOOR)
    const answer = (data ?? null) as { status?: unknown; reviewed_at?: unknown } | null
    if (answer?.status !== 'reviewed' && answer?.status !== 'already_reviewed') {
      return NextResponse.json({ error: 'Couldn’t confirm the report was marked reviewed.' }, { status: 500 })
    }
    return NextResponse.json({ status: answer.status, reviewed_at: answer.reviewed_at ?? null })
  }

  // Remove: only a reported comment, and the comment the report names.
  const { data: report, error: readError } = await createAdminClient()
    .from('content_reports')
    .select('id, target_type, target_id, list_id')
    .eq('id', id)
    .maybeSingle()
  if (readError) {
    if (isMissingSchemaObject(readError, ['content_reports'])) {
      return NextResponse.json({ error: REPORTS_UNAVAILABLE }, { status: 503 })
    }
    return NextResponse.json({ error: readError.message }, { status: 500 })
  }
  if (!report) return NextResponse.json({ error: 'That report isn’t there.' }, { status: 404 })
  if (report.target_type !== 'comment' || !report.list_id) {
    return NextResponse.json({ error: 'Only a reported comment can be removed from here.' }, { status: 400 })
  }

  const { data, error } = await gate.supabase.rpc('remove_list_comment', {
    p_list_id: report.list_id,
    p_comment_id: report.target_id,
  })
  if (error) return refusal(error, REMOVE_DOOR)
  const answer = (data ?? null) as { removed_as?: unknown; reports_reviewed?: unknown } | null
  if (typeof answer?.removed_as !== 'string') {
    return NextResponse.json({ error: 'Couldn’t confirm the comment was removed.' }, { status: 500 })
  }
  return NextResponse.json({
    status: 'removed',
    removed_as: answer.removed_as,
    // Present only for a removal made as an admin (214); none otherwise.
    reports_reviewed: typeof answer.reports_reviewed === 'number' ? answer.reports_reviewed : 0,
  })
}

function refusal(error: RpcError, door: Readonly<Record<string, readonly string[]>>) {
  if (isDoorNotPushed(error, door)) return NextResponse.json({ error: REPORTS_UNAVAILABLE }, { status: 503 })
  if (error.code === 'P0002') return NextResponse.json({ error: error.message }, { status: 404 })
  if (error.code === '42501') return NextResponse.json({ error: error.message }, { status: 403 })
  return NextResponse.json({ error: error.message }, { status: 500 })
}
