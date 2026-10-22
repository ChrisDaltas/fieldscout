/**
 * §7.3.6's blocking designations and the `players.status` bridge — the ONE
 * definition, in a module both the draft runner and the season runner can
 * import without a cycle (L.D6.3; extracted from `season-runner.ts`, which
 * re-exports it so every existing importer and its pins are unmoved).
 *
 * It lives alone because several callers read it: the sim-world mask (F374),
 * the transaction harness's free-agent choice and the seating reads. (Until
 * D591 the season runner and the draft runner's need-aware personas also used
 * it to pass over a starter §7.3.6 refused in an `allow_illegal_lineups =
 * false` league; migration 201 retired the setting, so nobody is passed over
 * now.) `season-runner.ts` imports `runner.ts`, so the reverse import would
 * have been a module cycle.
 */

/**
 * §7.3.6's blocking designations, exactly as `lineup_designation_internal`
 * (112:337-353) spells them after bridging `players.status`. `Doubtful` is
 * NOT here: 114:596 blocks only these five.
 */
export const BLOCKING_DESIGNATIONS: ReadonlySet<string> = new Set([
  'OUT',
  'IR',
  'PUP',
  'NFI',
  'Suspended',
])

/**
 * `players.status` → the §7.3.2 designation, the TS side of 112:337-353.
 *
 * This is a CLIENT's preference, not an oracle. The sim is choosing what to
 * SUBMIT, exactly as a manager's UI does; the SERVER still decides, and if
 * this function is wrong the run goes RED on a `set_lineup` 409 rather than
 * quietly passing — which is what keeps it falsifiable (the same posture
 * D327(5) records for the greedy slot fit, which is not a mirror of
 * `lineup_fit_internal` either).
 */
export function simDesignation(status: string | null | undefined): string | null {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'out':
      return 'OUT'
    case 'ir':
      return 'IR'
    case 'doubtful':
      return 'Doubtful'
    case 'pup':
      return 'PUP'
    case 'nfi':
      return 'NFI'
    case 'sus':
    case 'suspended':
      return 'Suspended'
    default:
      return null
  }
}
