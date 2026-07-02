import { NextResponse } from 'next/server'

import { ingestPersonaContent } from '@/lib/personas/ingest'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Daily persona content ingestion (spec-ai-content-engine.md, Slice B).
 * Triggered by Vercel Cron (vercel.json) — Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` automatically when the env var is
 * set. Runs change-gated, so quiet days cost zero paid calls.
 *
 * Cron-runner decision (plan §3.5): Vercel Cron over Supabase Edge
 * Functions — the ingestion engine shares src/lib TypeScript modules that
 * a Deno Edge Function couldn't import.
 */

export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Soft deadline under maxDuration: the engine stops gracefully and the
    // watermark semantics resume the remainder on the next run.
    const summary = await ingestPersonaContent(createAdminClient(), {
      deadlineAt: Date.now() + 250_000,
    })
    if (summary.errors.length > 0) {
      console.error('[ingest-persona-content] errors:', summary.errors)
    }
    // Total failure (nothing even checked — e.g. missing ANTHROPIC_API_KEY)
    // must be a 5xx so Vercel cron monitoring flags it; partial trouble is 207.
    const status =
      summary.errors.length === 0 ? 200 : summary.sourcesChecked === 0 ? 500 : 207
    return NextResponse.json(summary, { status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ingest-persona-content] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
