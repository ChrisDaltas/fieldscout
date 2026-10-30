import { NextResponse } from 'next/server'

import { readAdminReports } from '@/lib/admin/content-reports'
import { requireAdminUser } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/reports — Admin › Reports (Community launch plan C10): every
 * report, newest first (the newest 200, with the total and the "new" count),
 * with what each is about. `content_reports` (migration 214) has RLS on and
 * no client policy, so it is read with the service role AFTER the admin gate
 * (the Admin › Posts pattern). The admin gate is the authority here, not
 * the Community switch (a flag gates surfaces, never a server path —
 * `flag-free-server-paths.test.ts`): the page that calls it rides the switch.
 *
 * 503 while 214 isn't on the database (deploy before push) — never an empty
 * list; any other failed read is a loud 500.
 */
export async function GET() {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const read = await readAdminReports(createAdminClient(), gate.user.id)
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status })
  return NextResponse.json(read.payload)
}
