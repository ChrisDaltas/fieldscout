/**
 * sync:fill-ruled — fill the ruled stat columns on finished weeks, quietly
 * (PROGRESS F890, D832). The logic and the argument rules live in
 * `src/lib/sync/fill-ruled-columns.ts`; this wrapper binds the provider the
 * cron route binds, so a new line's `source` is the live poll's.
 *
 *   npm run sync:fill-ruled -- --season 2026 --weeks 1-8
 *     prints the plan and writes nothing
 *   npm run sync:fill-ruled -- --season 2026 --weeks 1-8 --apply --confirm-target <host>
 *     writes it
 *
 * ⚠ TARGET. Like every sync:* script it loads `.env.local`, which names the
 * HOSTED project. The first line printed is always `target: <host>`, and
 * `--apply` exits 2 having read and written nothing until `--confirm-target`
 * names that host.
 *
 * ⚠ A NEW SCRIPT NAME ON PURPOSE. `sync:reingest` ignores flags it doesn't
 * know, so a quiet flag on it would run a whole-line write from a stale
 * checkout. Here a stale checkout has no such script, and this one exits 2 on
 * any flag it doesn't know.
 *
 * Exit 2: bad arguments or target. Exit 1: refused, any problem, or a failed
 * check after writing. Never a quiet success.
 */
import { NflverseProvider, withNflverseCalendar } from '../src/lib/leagues/stats/nflverse/nflverse-provider'
import { SleeperStatsProvider } from '../src/lib/leagues/stats/sleeper-stats-provider'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { runFillCli } from '../src/lib/sync/fill-ruled-columns'
import { cliClient, fail } from './_sync-cli'

runFillCli(process.argv.slice(2), {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  connect: () => ({
    db: cliClient(),
    provider: withNflverseCalendar(new SleeperStatsProvider(systemTime), new NflverseProvider(systemTime)),
    time: systemTime,
  }),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
  .then((code) => process.exit(code))
  .catch(fail)
