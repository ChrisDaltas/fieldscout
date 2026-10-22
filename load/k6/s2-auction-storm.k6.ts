/**
 * §22.6 scenario (2) — k6 entry (M7 L.F2.1). Run through the wrapper:
 *   npx tsx scripts/load/k6.ts s2 --target test --profile y2026
 * One VU per auction seat; seat 0 judges the stored bids at the end.
 */
import exec from 'k6/execution'

import { k6Transport } from './lib/k6-transport'
import { loadK6Context, signInAll, startDrafts } from './lib/k6-context'
import { auctionVerify, auctionVu } from './scenarios/auction-storm'

const ctx = loadK6Context('auction')
const draft = ctx.manifest.drafts[0]!
const seats = draft.seats.length
/** A storm, its bid clock and the award tick, with room to spare, per storm. */
const timeoutSec = ctx.profile.storms * (ctx.profile.clockSec * 3 + 30)

export const options = {
  scenarios: {
    seats: { executor: 'per-vu-iterations', vus: seats, iterations: 1, maxDuration: `${timeoutSec + 120}s` },
  },
  thresholds: {
    bids_failed: ['count==0'],
    bid_storm_inconsistent: ['count==0'],
  },
}

export function setup(): { tokens: Record<number, string> } {
  const tokens = signInAll(ctx)
  startDrafts(ctx, tokens)
  return { tokens }
}

// k6 runs the default export as the VU body.
export default async function vu(data: { tokens: Record<number, string> }): Promise<void> {
  const t = k6Transport()
  t.metrics.count('bids_failed', 0)
  t.metrics.count('bid_storm_inconsistent', 0)
  const v = exec.vu.idInTest - 1
  const seat = draft.seats[v]!
  await auctionVu({
    t,
    ep: ctx.ep,
    socketUrl: ctx.socketUrl,
    token: data.tokens[seat.bot]!,
    draftId: draft.draftId,
    teamId: seat.teamId,
    seat: v,
    seatTeams: draft.seats.map((s) => s.teamId),
    pool: ctx.manifest.pool,
    bidsPerStorm: ctx.profile.bidsPerStorm,
    stormWindowMs: ctx.profile.stormWindowMs,
    storms: ctx.profile.storms,
    timeoutMs: timeoutSec * 1000,
  })
  if (v === 0) {
    const r = await auctionVerify(t, ctx.ep, ctx.serviceKey, draft.draftId)
    const bad = r.storms.filter((s) => !s.serialized || s.awardMatchesHigh === false).length
    const short = Math.max(0, ctx.profile.storms - r.storms.length)
    t.metrics.count('bid_storm_inconsistent', bad + short)
    for (const s of r.storms) {
      t.log(
        `storm #${s.nominationSeq}: ${s.bids} bids · ${s.serialized ? 'serialized' : 'NOT serialized'} · ` +
          `award $${s.awardedPrice ?? '—'} / high $${s.maxAmount ?? '—'}`,
      )
    }
  }
}
