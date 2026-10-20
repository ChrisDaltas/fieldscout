/**
 * §22.6 scenario (4) — the soak with connection churn — k6 entry (M7
 * L.F2.1):
 *   npx tsx scripts/load/k6.ts s4 --target test --profile y2026
 * `leagues × viewersPerLeague` connections (§22.1's viewer model) churn for
 * `soakHours`; one minute after they stop, the `probe` scenario joins every
 * league and counts presence a churner left behind (a leak).
 */
import exec from 'k6/execution'

import { soakConnections } from './config'
import { k6Transport } from './lib/k6-transport'
import { loadK6Context, signInAll } from './lib/k6-context'
import { soakLeakProbe, soakVu } from './scenarios/league-viewers'

const ctx = loadK6Context('leagues')
const perLeague = ctx.profile.viewersPerLeague
const connections = Math.min(soakConnections(ctx.profile), ctx.manifest.leagues.length * perLeague)
const soakSec = Math.ceil(ctx.profile.soakHours * 3600)

export const options = {
  scenarios: {
    churn: { executor: 'per-vu-iterations', vus: connections, iterations: 1, maxDuration: `${soakSec + 300}s` },
    probe: { executor: 'per-vu-iterations', vus: 1, iterations: 1, startTime: `${soakSec + 60}s`, exec: 'probe', maxDuration: '600s' },
  },
  thresholds: {
    realtime_quota_violations: ['count==0'],
    realtime_leaked_presences: ['count==0'],
  },
}

export function setup(): { tokens: Record<number, string> } {
  return { tokens: signInAll(ctx) }
}

// k6 runs the default export as the VU body.
export default async function vu(data: { tokens: Record<number, string> }): Promise<void> {
  const t = k6Transport()
  t.metrics.count('realtime_quota_violations', 0)
  const v = exec.vu.idInTest - 1
  const league = ctx.manifest.leagues[Math.floor(v / perLeague) % ctx.manifest.leagues.length]!
  const bot = league.members[v % perLeague]!
  await soakVu({
    t,
    socketUrl: ctx.socketUrl,
    token: data.tokens[bot]!,
    leagueId: league.leagueId,
    vuId: String(v),
    durationMs: soakSec * 1000,
    holdSec: ctx.profile.churnHoldSec,
  })
}

export async function probe(data: { tokens: Record<number, string> }): Promise<void> {
  const t = k6Transport()
  t.metrics.count('realtime_leaked_presences', 0)
  const league0 = ctx.manifest.leagues[0]!
  const r = await soakLeakProbe(t, ctx.socketUrl, data.tokens[league0.members[0]!]!, ctx.manifest.leagues.map((l) => l.leagueId))
  t.log(`leak probe: ${r.leaked} leaked presence key(s) across ${r.probed} league(s)`)
}
