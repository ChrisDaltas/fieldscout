/**
 * Sync implied defensive splits by position (from matchup-adjusted weekly
 * projections) into defense_position_splits. Run sync:sos afterwards.
 *
 *   npx tsx scripts/sync-splits.ts          # current $NEXT_PUBLIC_NFL_SEASON
 *   npx tsx scripts/sync-splits.ts 2026     # explicit season
 */
import { cliClient, cliSeason, fail, printSummary } from './_sync-cli'
import { syncSplits } from '../src/lib/sync/splits-sync'

syncSplits(cliClient(), cliSeason()).then(printSummary).catch(fail)
