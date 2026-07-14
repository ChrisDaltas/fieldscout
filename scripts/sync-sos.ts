/**
 * Stamp strength of schedule (players.sos, 1 = easiest – 32 = hardest).
 * Positional when defense_position_splits has the season (run sync:splits
 * first); team-strength fallback otherwise.
 *
 *   npx tsx scripts/sync-sos.ts          # current $NEXT_PUBLIC_NFL_SEASON
 *   npx tsx scripts/sync-sos.ts 2026     # explicit season
 */
import { cliClient, cliSeason, fail, printSummary } from './_sync-cli'
import { syncSos } from '../src/lib/sync/sos-sync'

syncSos(cliClient(), cliSeason()).then(printSummary).catch(fail)
