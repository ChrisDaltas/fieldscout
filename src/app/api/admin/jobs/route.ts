import { NextResponse } from 'next/server'
import { z } from 'zod'

import { opWriteResponse } from '@/lib/admin/op-write-response'
import { requireAdminUser } from '@/lib/auth/require-admin'

/**
 * POST /api/admin/jobs — the job knobs (M8 L.G1.6; spec §24.4 "Job knobs";
 * Q98 / Q102; tasks-M8 TD3–TD5; migration 183; F583).
 *
 * A thin door: the admin gate (404 to everyone else — TD8), the input shape
 * (Zod), then ONE of `op_pause_job` / `op_resume_job` / `op_run_job_now`
 * through the operator's OWN session client. The RPC re-checks the operator
 * gate in-body, refuses what Q98 forbids by name (lineup locking is never
 * paused; drafts / stat syncing have no knobs), is idempotent on `action_id`
 * and says why when nothing changed. Nothing is computed or written here, and
 * the service role is never used.
 *
 *   verb       'pause' | 'resume' | 'run_now'
 *   job        'waivers' | 'week-advance' | 'week-finalize' | 'lineup-lock'
 *   league_id  one league, or omitted for every league
 *   action_id  the retry key — the console makes one per confirm dialog
 */

const VERB_RPC = {
  pause: 'op_pause_job',
  resume: 'op_resume_job',
  run_now: 'op_run_job_now',
} as const

const bodySchema = z
  .object({
    verb: z.enum(['pause', 'resume', 'run_now']),
    job: z.enum(['waivers', 'week-advance', 'week-finalize', 'lineup-lock']),
    league_id: z.uuid().optional(),
    action_id: z.uuid(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  // Q98: lineup locking is run-now only. The RPC refuses it too (22023); the
  // door refuses first so a bad call never reaches the database.
  .refine((b) => b.job !== 'lineup-lock' || b.verb === 'run_now', {
    message: 'lineup locking has "run now" only — it can never be paused or resumed',
    path: ['verb'],
  })

export async function POST(request: Request) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const raw = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const b = parsed.data

  const { data, error } = await gate.supabase.rpc(VERB_RPC[b.verb], {
    p_job: b.job,
    p_league_id: b.league_id,
    p_action_id: b.action_id,
    p_reason: b.reason,
  })
  return opWriteResponse(data, error, 'The job controls are not available yet.')
}
