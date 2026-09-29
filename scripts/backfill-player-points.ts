/**
 * backfill:player-points — the ONE-TIME backfill of stored per-player points
 * for weeks scored before migration 158 (M5 L.D3.11 (d); PROGRESS F405 /
 * D422). The logic lives in `src/lib/leagues/scoring/player-points-backfill.ts`.
 *
 *   npm run backfill:player-points -- --season 2026                                  (dry run — writes nothing)
 *   npm run backfill:player-points -- --season 2026 --apply --confirm-target <host>
 *
 * ⚠ TARGET. Like every sync:* script it loads `.env.local`, which names the
 * HOSTED project: the first line printed is always `target: <host>`, and
 * `--apply` writes nothing unless `--confirm-target` names that host. Against
 * the local stack, override both variables on the command line (dotenv never
 * overrides a variable that is already set).
 *
 * PRODUCTION ORDER: `npx supabase db push` (158) → this, dry run → this,
 * --apply. Idempotent: a second run finds every team-week `already_stored`.
 * Exit 1 on any problem — including a stored score that moved (the golden;
 * the door never writes one) — and on a pre-158 database (named).
 */
import { backfillPlayerPoints, renderBackfill } from '../src/lib/leagues/scoring/player-points-backfill'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { confirmTarget } from '../src/lib/sync/reingest-weeks'
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
  const season = Number(seasonRaw)
  if (seasonRaw === undefined || !Number.isInteger(season) || season < 2000 || season > 2100) {
    console.error('usage: npm run backfill:player-points -- --season <yyyy> [--apply --confirm-target <host>]')
    process.exit(2)
  }
  const apply = process.argv.includes('--apply')
  if (apply) {
    try {
      confirmTarget(url, flag('--confirm-target'))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(2)
    }
  }
  const report = await backfillPlayerPoints({ db: cliClient(), time: systemTime }, { season, apply })
  for (const line of renderBackfill(report)) console.log(line)
  if (!report.ok) {
    console.error('FAILED — see the lines above')
    process.exit(1)
  }
  console.log(apply ? 'Done — every scored week now stores its per-player points; no stored score moved.' : 'Dry run — nothing written. Re-run with --apply --confirm-target <host>.')
}

main().catch(fail)
