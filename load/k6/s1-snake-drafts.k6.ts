/**
 * §22.6 scenario (1) — k6 entry (M7 L.F2.1). Run through the wrapper:
 *   npx tsx scripts/load/k6.ts s1 --target test --profile y2026
 * One VU per seat across `drafts` drafts; the first seat of each draft
 * verifies its stored board when the draft ends. Thresholds = §22.6 (1).
 */
import exec from 'k6/execution'

import { PICK_TO_BROADCAST_P95_MS, seatsPerDraft } from './config'
import { k6Transport } from './lib/k6-transport'
import { loadK6Context, signInAll, startDrafts } from './lib/k6-context'
import { snakeVerify, snakeVu } from './scenarios/snake-draft'

const ctx = loadK6Context('snake')
const seats = seatsPerDraft(ctx.profile)
const vus = ctx.manifest.drafts.length * seats
/** Worst case: every pick runs its full clock (+5 s of tick slack). */
const timeoutSec = ctx.profile.rounds * seats * (ctx.profile.clockSec + 5)

export const options = {
  scenarios: {
    seats: { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: `${timeoutSec + 120}s` },
  },
  thresholds: {
    pick_to_broadcast_ms: [`p(95)<${PICK_TO_BROADCAST_P95_MS}`],
    duplicate_picks: ['count==0'],
    drafts_unfinished: ['count==0'],
    pick_broadcast_missing: ['count==0'], // R1642
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
  t.metrics.count('duplicate_picks', 0)
  t.metrics.count('drafts_unfinished', 0)
  t.metrics.count('pick_broadcast_missing', 0)
  const v = exec.vu.idInTest - 1
  const draft = ctx.manifest.drafts[Math.floor(v / seats)]!
  const seat = draft.seats[v % seats]!
  await snakeVu({
    t,
    ep: ctx.ep,
    socketUrl: ctx.socketUrl,
    token: data.tokens[seat.bot]!,
    draftId: draft.draftId,
    teamId: seat.teamId,
    pool: ctx.manifest.pool,
    pickDelayMs: ctx.profile.pickDelayMs,
    timeoutMs: timeoutSec * 1000,
  })
  if (v % seats === 0) {
    const r = await snakeVerify({ t, ep: ctx.ep, serviceKey: ctx.serviceKey, draftIds: [draft.draftId] })
    t.metrics.count('duplicate_picks', r.duplicatePlayers + r.duplicatePickNumbers)
    t.metrics.count('drafts_unfinished', r.unfinished.length)
    t.log(
      `verify ${draft.draftId}: ${r.picks} picks · ${r.duplicatePlayers + r.duplicatePickNumbers} duplicate(s) · ` +
        `${r.unfinished.length ? 'UNFINISHED' : 'complete'}`,
    )
  }
}
