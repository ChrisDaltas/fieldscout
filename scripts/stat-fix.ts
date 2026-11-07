/**
 * stat-fix — our own stat fixes, recorded and checked (migration 222; PROGRESS
 * D836–D839; spec v2.16.118). The score-week pass applies a written fix to
 * every eligible final league-week by itself, quietly; this records one the
 * quiet fill did not (an engine fix, a backlog), previews one, and says what
 * is owed. The logic and the argument rules live in
 * `src/lib/leagues/scoring/stat-fix-cli.ts`.
 *
 *   npm run stat-fix -- plan --file <lines.json> [--landed-at <iso>]
 *     read-only: per league, week and player, stored → new and the delta;
 *     with --landed-at, a week last scored after it is named not eligible
 *   npm run stat-fix -- record --file <lines.json> --reason "<plain words>" --landed-at <iso>
 *     prints what it would record; add --apply --confirm-target <host> to record it.
 *     --landed-at is REQUIRED (when our change reached the stats, or the
 *     engine's deploy) and may not be in the future
 *   npm run stat-fix -- status
 *     every written fix: applied / owed / not eligible
 *
 * ⚠ TARGET. Like every sync:* script it loads `.env.local`, which names the
 * HOSTED project. The first line printed is `target: <host>`, and `--apply`
 * exits 2 having written nothing until `--confirm-target` names that host. A
 * local run overrides NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * (dotenv never overwrites a variable already set).
 *
 * Exit 2: bad arguments or target. Exit 1: a refusal, a problem or a failed
 * call. Never a quiet success.
 */
import { readFileSync } from 'node:fs'

import { runStatFixCli } from '../src/lib/leagues/scoring/stat-fix-cli'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { cliClient, fail } from './_sync-cli'

runStatFixCli(process.argv.slice(2), {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  connect: () => ({ db: cliClient(), time: systemTime }),
  readFile: (path) => readFileSync(path, 'utf8'),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
  .then((code) => process.exit(code))
  .catch(fail)
