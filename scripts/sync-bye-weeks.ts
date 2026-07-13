/**
 * Sync NFL bye weeks from the Sleeper schedule into the players table.
 *
 *   npx tsx scripts/sync-bye-weeks.ts          # current $NEXT_PUBLIC_NFL_SEASON
 *   npx tsx scripts/sync-bye-weeks.ts 2026     # explicit season
 */
import { cliClient, cliSeason, fail, printSummary } from './_sync-cli'
import { syncByeWeeks } from '../src/lib/sync/bye-weeks'

syncByeWeeks(cliClient(), cliSeason()).then(printSummary).catch(fail)
