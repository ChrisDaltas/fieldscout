/**
 * export:correction-events — L.E2.5's production route (tasks-M6 §6;
 * PROGRESS D458). Reads one week's `stat_correction_events` from the target
 * database READ ONLY and names every recorded correction (player, key,
 * old → new, game, minutes after the week was first seen final — F528).
 *
 *   npm run export:correction-events -- --season 2026 --week 3 --confirm-target <host>            (prints — writes nothing)
 *   npm run export:correction-events -- --season 2026 --week 3 --confirm-target <host> --write    (also writes the week's production-events.json)
 *
 * ⚠ TARGET. Like every sync:* script it loads `.env.local`, which names the
 * HOSTED project: the first line printed is always `target: <host>`, and it
 * reads NOTHING unless `--confirm-target` names that host. It never writes to
 * the database: the export sees it only through `readOnly()` (select only).
 * `--write` writes one LOCAL file, fixtures/nfl/<season>/wk<NN>/production-events.json
 * — public NFL stat facts only (no ids, no host, no key); refuses to replace
 * an existing file unless `--overwrite`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { systemTime } from '../src/lib/leagues/time/time-provider'
import { confirmTarget } from '../src/lib/sync/reingest-weeks'
import { cliClient, fail } from './_sync-cli'
import { exportFile, readCorrectionExport, readOnly, renderCorrectionExport } from './correction-events-export'

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

function intFlag(name: string, lo: number, hi: number): number {
  const raw = flag(name)
  const n = Number(raw)
  if (raw === undefined || !Number.isInteger(n) || n < lo || n > hi) {
    console.error('usage: npm run export:correction-events -- --season <yyyy> --week <n> --confirm-target <host> [--write [--overwrite]]')
    process.exit(2)
  }
  return n
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
  const season = intFlag('--season', 2000, 2100)
  const week = intFlag('--week', 1, 22)
  try {
    // Required to READ: this is production's data. The check is the house
    // one (reingest-weeks.ts) — its wording says "to write"; here nothing is.
    confirmTarget(url, flag('--confirm-target'))
  } catch (err) {
    console.error(`${(err as Error).message.replace('to write to it', 'to read it (read only)').replace('nothing written', 'nothing read')}`)
    process.exit(2)
  }
  const x = await readCorrectionExport(readOnly(cliClient()), season, week, systemTime.now())
  for (const line of renderCorrectionExport(x)) console.log(line)

  if (!process.argv.includes('--write')) {
    console.log('Read only — nothing written anywhere. Add --write to save the week\'s production-events.json fixture.')
    return
  }
  if (x.eventsTableAbsent) {
    console.error('--write refused: the database has no stat_correction_events table (pre-167)')
    process.exit(1)
  }
  const outPath = resolve(process.cwd(), `fixtures/nfl/${season}/wk${String(week).padStart(2, '0')}/production-events.json`)
  if (existsSync(outPath) && !process.argv.includes('--overwrite')) {
    console.error(`--write refused: ${outPath} exists (add --overwrite to replace it)`)
    process.exit(1)
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(exportFile(x), null, 1) + '\n')
  console.log(`Wrote ${outPath} (${x.events.length} events, ${x.games.length} games) — the database was only read.`)
}

main().catch(fail)
