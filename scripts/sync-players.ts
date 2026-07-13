/**
 * Sync NFL players from the Sleeper API into the players table.
 *
 *   npx tsx scripts/sync-players.ts
 */
import { cliClient, fail, printSummary } from './_sync-cli'
import { syncPlayers } from '../src/lib/sync/players'

syncPlayers(cliClient()).then(printSummary).catch(fail)
