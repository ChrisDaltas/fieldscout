/**
 * rescore:final-weeks — the ONE-TIME, RULED, AUDITED re-score of FINAL
 * league-weeks (M5 L.D3.13, migration 161; PROGRESS D425). The logic lives in
 * `src/lib/leagues/scoring/rescore-final-weeks.ts`; the database door is
 * `admin_rescore_final_week`.
 *
 *   npm run rescore:final-weeks -- --season 2026 --weeks 1-2 --ruled-by <username> \
 *     --reason "<the ruling, quoted>" --why "<plain words for the league>"                       (dry run — writes nothing)
 *   …the same… --apply --confirm-target <host>
 *
 * THE 2026 RUN (Chris's ruling, 2026-09-29):
 *   --weeks 1-2
 *   --reason 'Chris (product owner), 2026-09-29: "re-score weeks 1 and 2 with the actual yards" — D/ST yards allowed were missing (read as 0) when weeks 1-2 were first scored; sync:reingest filled them (PROGRESS D425).'
 *   --why 'defense yards allowed were missing when it was first scored'
 *
 * ⚠ TARGET. Like every sync:* script it loads `.env.local`, which names the
 * HOSTED project: the first line printed is always `target: <host>`, and
 * `--apply` writes nothing unless `--confirm-target` names that host. The dry
 * run runs the door's apply inside the database and ROLLS IT BACK — it needs
 * migration 161 on the target. Against the local stack, override both
 * variables on the command line (dotenv never overrides a set variable).
 *
 * ORDER (production): `npx supabase db push` (161) → this, dry run (check it
 * reproduces the backfill's numbers and the two flips) → this, --apply →
 * `npm run backfill:player-points -- --season 2026` (dry, then --apply): weeks
 * 1–2 report `already_stored`, week 3 is stored as before. A second --apply
 * of this tool reports `scores_already_correct` (naming the audit row) and
 * sends nothing. Exit 1 on any problem, 2 on a usage / target error.
 */
import { rescoreFinalWeeks, renderRescore } from '../src/lib/leagues/scoring/rescore-final-weeks'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { confirmTarget, parseWeeks } from '../src/lib/sync/reingest-weeks'
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

const USAGE =
  'usage: npm run rescore:final-weeks -- --season <yyyy> --weeks <1-2> --ruled-by <username> --reason "<the ruling>" --why "<plain words>" [--apply --confirm-target <host>]'

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
  const ruledBy = flag('--ruled-by')
  const reason = flag('--reason')
  const why = flag('--why')
  const season = Number(seasonRaw)
  if (seasonRaw === undefined || weeksRaw === undefined || ruledBy === undefined || reason === undefined || why === undefined || !Number.isInteger(season) || season < 2000 || season > 2100) {
    console.error(USAGE)
    process.exit(2)
  }
  const apply = process.argv.includes('--apply')
  let weeks: number[]
  try {
    weeks = parseWeeks(weeksRaw)
    if (apply) confirmTarget(url, flag('--confirm-target'))
  } catch (err) {
    console.error((err as Error).message)
    process.exit(2)
  }

  const db = cliClient()
  const { data: actors, error } = await db.from('profiles').select('id, username').eq('username', ruledBy)
  if (error) throw new Error(`profiles read: ${error.message}`)
  if (!actors || actors.length !== 1) {
    console.error(`--ruled-by ${ruledBy}: expected exactly one profile with that username, found ${actors?.length ?? 0}`)
    process.exit(2)
  }
  console.log(`ruled by: ${actors[0].username} (${actors[0].id})`)

  const report = await rescoreFinalWeeks({ db, time: systemTime }, { season, weeks, apply, reason, memberNote: why, actorId: actors[0].id })
  for (const line of renderRescore(report)) console.log(line)
  if (!report.ok) {
    console.error('FAILED — see the lines above')
    process.exit(1)
  }
  console.log(
    apply
      ? 'Done — the re-scored weeks store their new scores, results and per-player points; standings follow. Next: npm run backfill:player-points -- --season ' + season
      : 'Dry run — the database ran the re-score and rolled it back; nothing was written. Re-run with --apply --confirm-target <host>.',
  )
}

main().catch(fail)
