/**
 * Player news ingest, by hand (F575; D550). Production runs the same code
 * every 30 min via /api/cron/ingest-player-news (pg_cron
 * `ingest-player-news-ping`).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local> \
 *     npm run ingest:player-news
 *
 * LOCAL ONLY: refuses any non-localhost Supabase URL (`.env.local` points at
 * the hosted project). Exit 1 on any source failure — never a quiet success.
 */
import { cliClient, fail } from './_sync-cli'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { ingestPlayerNews } from '../src/lib/news/ingest'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error(`refusing to ingest into ${url || '(unset)'} — this script is local-only`)
  }
  const report = await ingestPlayerNews({ db: cliClient() as never, time: systemTime })
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exit(1)
}

main().catch(fail)
