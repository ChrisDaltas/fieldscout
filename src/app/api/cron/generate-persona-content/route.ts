import { NextResponse } from 'next/server'

import { generatePersonaContentRun } from '@/lib/personas/posts'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCronAuthorized } from '@/lib/auth/cron-secret'

/**
 * Weekly persona post generation (spec-ai-content-engine.md, Slice C).
 * Triggered by Vercel Cron (vercel.json). Posts land as drafts — the admin
 * review gate at /app/admin/posts publishes. Idempotent per (persona,
 * theme, season); the per-run cap drains the grid across weeks.
 */

export const maxDuration = 300

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await generatePersonaContentRun(createAdminClient(), {
      deadlineAt: Date.now() + 210_000,
    })
    if (summary.errors.length > 0) {
      console.error('[generate-persona-content] notes:', summary.errors)
    }
    const status =
      summary.errors.length === 0 ? 200 : summary.personas === 0 ? 500 : 207
    return NextResponse.json(summary, { status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[generate-persona-content] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
