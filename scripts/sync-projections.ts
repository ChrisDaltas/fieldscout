/**
 * Sync pre-season fantasy projections (points, ADP, full stat lines) from
 * Sleeper into the players table.
 *
 *   npx tsx scripts/sync-projections.ts          # current $NEXT_PUBLIC_NFL_SEASON
 *   npx tsx scripts/sync-projections.ts 2026     # explicit season
 */
import { cliClient, cliSeason, fail, printSummary } from './_sync-cli'
import { syncProjections } from '../src/lib/sync/projections'

syncProjections(cliClient(), cliSeason()).then(printSummary).catch(fail)
