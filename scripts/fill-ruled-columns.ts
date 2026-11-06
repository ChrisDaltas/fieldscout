/**
 * sync:fill-ruled — fill the ruled stat columns on finished weeks, quietly
 * (PROGRESS F890, D832, D835). Nine columns since migration 218 (F871): the
 * first seven, plus `fg_60_plus` and `def_2pt_return`. A run on weeks a first
 * run already filled moves only those two. The logic and the argument rules live in
 * `src/lib/sync/fill-ruled-columns.ts`; this wrapper binds the provider the
 * cron route binds, so a new line's `source` is the live poll's.
 *
 *   npm run sync:fill-ruled -- --season 2026 --weeks 1-8
 *     prints the plan and writes nothing
 *   npm run sync:fill-ruled -- --season 2026 --weeks 1-8 --apply --confirm-target <host>
 *     writes it
 *
 * ⚠ TARGET. Like every sync:* script it loads `.env.local`, which names the
 * HOSTED project. Once the arguments parse, the first line printed is
 * `target: <host>`, and `--apply` exits 2 having read and written nothing
 * until `--confirm-target` names that host.
 *
 * ⚠ 2026 ONLY. Any other `--season` exits 2 while the arguments parse, by
 * name, before the target line and before any read: 2025 is F872, not ruled.
 *
 * ⚠ A NEW SCRIPT NAME ON PURPOSE. `sync:reingest` ignores flags it doesn't
 * know, so a quiet flag on it would run a whole-line write from a stale
 * checkout. Here a stale checkout has no such script, and this one exits 2 on
 * any flag it doesn't know.
 *
 * An `--apply` that goes on to write prints its whole plan before the first
 * door call, then the lines written and every check after.
 *
 * Exit 2: bad arguments (a season other than 2026 included) or target. Exit
 * 1: refused, any problem, a failed write, or a failed check after writing.
 * Never a quiet success.
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
