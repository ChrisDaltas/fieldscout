/**
 * Sync season usage rates (snap %, target share) into the players table.
 * Usage is a look-back stat, so the default season is LAST season.
 *
 *   npx tsx scripts/sync-season-usage.ts          # $NEXT_PUBLIC_NFL_SEASON - 1
 *   npx tsx scripts/sync-season-usage.ts 2025     # explicit season
 */
import { cliClient, cliSeason, fail, printSummary } from './_sync-cli'
import { syncUsage } from '../src/lib/sync/usage'

syncUsage(cliClient(), cliSeason(-1)).then(printSummary).catch(fail)
