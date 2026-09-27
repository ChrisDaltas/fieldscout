/**
 * sync:reingest — re-poll PAST weeks from Sleeper through the production
 * ingestion (`ingestWeek`), the ops step migration 143 needs (M6A L.E1.26
 * fix round, R1149; PROGRESS F400 / D380(11)). The logic lives in
 * `src/lib/sync/reingest-weeks.ts`; this wrapper binds the provider the
 * cron route binds — `withNflverseCalendar(sleeper, nflverse)` — so the rows
 * it writes are the live poll's rows (`source = sleeper+nflverse`).
 *
 *   npm run sync:reingest -- --season 2026 --weeks 1-3 --confirm-target <host>
 *
 * ⚠ TARGET. Like every sync:* script it loads `.env.local`, which names the
 * HOSTED project. It therefore refuses to write anywhere until
 * `--confirm-target` names the host it is about to write to: the first line
 * printed is always `target: <host>`, and without a matching
 * `--confirm-target` it exits 2 having polled and written nothing. To run
 * against the local stack, override both variables on the command line
 * (dotenv never overrides a variable that is already set):
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *     npm run sync:reingest -- --season 2026 --weeks 1-2 --confirm-target 127.0.0.1:54321
 *
 * PRODUCTION PUSH ORDER (143's banner, D380(11)): `npx supabase db push`
 * (143) → immediately `npm run sync:reingest -- --season 2026 --weeks <every
 * completed week> --confirm-target <hosted host>`. Idempotent: a second run
 * over unchanged weeks writes and enqueues nothing.
 *
 * Refuses (exit 1, nothing polled) a week that has not started. Exit 1 on
 * any failed week — a provider failure, a DB error, or a completed week
 * whose D/ST rows still hold NULL yards afterwards. Never a quiet success.
 */
import { NflverseProvider, withNflverseCalendar } from '../src/lib/leagues/stats/nflverse/nflverse-provider'
import { SleeperStatsProvider } from '../src/lib/leagues/stats/sleeper-stats-provider'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { confirmTarget, parseWeeks, reingestWeeks, renderReingest } from '../src/lib/sync/reingest-weeks'
import { cliClient, fail } from './_sync-cli'

function flag(name: string): string | undefined {
  const args = process.argv.slice(2)
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} needs a value`)
    process.exit(2)
  }
  return value
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  let host: string
  try {
    host = new URL(url).host
  } catch {
    console.error(`NEXT_PUBLIC_SUPABASE_URL is not a URL: "${url}"`)
    process.exit(2)
  }
  console.log(`target: ${host}`)

  const seasonRaw = flag('--season')
  const weeksRaw = flag('--weeks')
  if (seasonRaw === undefined || weeksRaw === undefined) {
    console.error('usage: npm run sync:reingest -- --season <yyyy> --weeks <1-3|1,2,4> --confirm-target <host>')
    process.exit(2)
  }
  const season = Number(seasonRaw)
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    console.error(`Invalid --season: ${seasonRaw}`)
    process.exit(2)
  }
  let weeks: number[]
  try {
    weeks = parseWeeks(weeksRaw)
    confirmTarget(url, flag('--confirm-target'))
  } catch (err) {
    console.error((err as Error).message)
    process.exit(2)
  }

  const provider = withNflverseCalendar(new SleeperStatsProvider(systemTime), new NflverseProvider(systemTime))
  const report = await reingestWeeks({ db: cliClient(), provider, time: systemTime }, { season, weeks })
  console.log(`Re-ingest [${season}] weeks ${weeks.join(', ')} → ${host}`)
  for (const line of renderReingest(report)) console.log(line)
  if (!report.ok) {
    console.error('FAILED — see the lines above')
    process.exit(1)
  }
  console.log('Done — the score-week worker drains the enqueued deltas (a final league week consumes them as week_final; no stored score moves).')
}

main().catch(fail)
