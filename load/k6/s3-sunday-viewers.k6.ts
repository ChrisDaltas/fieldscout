/**
 * §22.6 scenario (3), the VIEWER half — k6 entry (M7 L.F2.1). The feeder
 * (`scripts/load/sunday-replay.ts`) replays the Sunday and measures the
 * scoring lag; run this beside it for the replay's length:
 *   npx tsx scripts/load/k6.ts s3 --target test --profile y2026 --minutes 180
 * `viewersPerLeague` members per seeded league hold `league:<id>`.
 */
import exec from 'k6/execution'

import { k6Transport } from './lib/k6-transport'
import { loadK6Context, signInAll } from './lib/k6-context'
import { sundayViewerVu } from './scenarios/league-viewers'

const ctx = loadK6Context('leagues')
const perLeague = ctx.profile.viewersPerLeague
const minutes = Number(__ENV.FS_LOAD_MINUTES ?? '10')
const vus = ctx.manifest.leagues.length * perLeague

export const options = {
  scenarios: {
    viewers: { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: `${Math.ceil(minutes * 60) + 120}s` },
  },
  thresholds: {
    realtime_join_refused: ['count==0'],
  },
}

export function setup(): { tokens: Record<number, string> } {
  return { tokens: signInAll(ctx) }
}

// k6 runs the default export as the VU body.
export default async function vu(data: { tokens: Record<number, string> }): Promise<void> {
  const t = k6Transport()
  t.metrics.count('realtime_join_refused', 0)
  const v = exec.vu.idInTest - 1
  const league = ctx.manifest.leagues[Math.floor(v / perLeague)]!
  const bot = league.members[v % perLeague]!
  await sundayViewerVu({
    t,
    socketUrl: ctx.socketUrl,
    token: data.tokens[bot]!,
    leagueId: league.leagueId,
    presenceKey: `viewer-${v}`,
    durationMs: minutes * 60_000,
    reportSilence: v % perLeague === 0,
  })
}
