import { NextResponse } from 'next/server'

import { systemTime } from '@/lib/leagues/time/time-provider'
import { ingestPlayerNews } from '@/lib/news/ingest'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Player news ingest (F575; migration 198; PROGRESS D550). SCHEDULED every
 * 30 min by pg_cron `ingest-player-news-ping` →
 * `cron_ping_route('/api/cron/ingest-player-news')` (124's vehicle). No
 * vercel.json entry (Hobby = daily only). Plain fetch of free RSS feeds and
 * the public Bluesky AppView; stores only items that match a player;
 * idempotent (unique source item + unique link).
 *
 * Sources are fetched concurrently under a 45 s budget, inside maxDuration
 * 60 and the ping's 55 s pg_net timeout (R1590).
 * 200 = every source read; 207 = some source failed or timed out (named in
 * the body);
 * 500 = nothing could run (e.g. no players read).
 */

export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await ingestPlayerNews({ db: createAdminClient(), time: systemTime })
    for (const s of report.sources) if (s.error) console.error('[ingest-player-news] source failed', s.key, s.error)
    console.log('[ingest-player-news]', JSON.stringify({ items: report.itemsUpserted, links: report.linksInserted, ok: report.ok }))
    return NextResponse.json(report, { status: report.ok ? 200 : 207 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ingest-player-news] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
