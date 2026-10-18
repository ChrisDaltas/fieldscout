/**
 * sync:combine — NFL Combine 40-yard dash onto `players.forty_time`
 * (F578, migration 195; PROGRESS D540). Logic: src/lib/sync/combine.ts.
 *
 *   npx tsx scripts/sync-combine.ts
 *
 * Targets whatever `.env.local` names (hosted by default). To run against
 * the local stack, override both variables on the command line:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *     npx tsx scripts/sync-combine.ts
 *
 * Needs migration 195 on the target database (the column).
 */
import { syncCombine } from '../src/lib/sync/combine'
import { cliClient, fail, printSummary } from './_sync-cli'

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

syncCombine(cliClient(), fetchText).then(printSummary).catch(fail)
