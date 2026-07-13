/**
 * Sync average auction values from ESPN live draft data into players.
 *
 *   npx tsx scripts/sync-auction.ts          # current $NEXT_PUBLIC_NFL_SEASON
 *   npx tsx scripts/sync-auction.ts 2026     # explicit season
 */
import { cliClient, cliSeason, fail, printSummary } from './_sync-cli'
import { syncAuctionValues } from '../src/lib/sync/auction'

syncAuctionValues(cliClient(), cliSeason()).then(printSummary).catch(fail)
