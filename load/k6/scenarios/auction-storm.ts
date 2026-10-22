/**
 * §22.6 scenario (2) — the auction bid storm: `bidsPerStorm` bids inside
 * `stormWindowMs` on ONE nomination (§22.6 prints 20 bids in 2 s), repeated
 * for `storms` nominations (M7 L.F2.1).
 *
 * §22.6 prints the storm and no latency number for it, so this scenario
 * asserts only what the spec and §22.1 already state: the bids are
 * SERIALIZED by the draft-row lock (standing bids strictly rise in commit
 * order), every bid gets an answer (accepted, or a product refusal such as
 * "outbid at $N" — §22.1 "loser gets instant 'outbid'") and none fails (a
 * 5xx or a transport error), and an awarded nomination sells at its highest
 * standing bid. Bid→own-broadcast latency is MEASURED and printed; any
 * threshold on it is Chris's to set (standing rule (f)).
 *
 * One VU per seat. The seat on the clock nominates the best available player
 * at $1; every VU then fires its share of the schedule: bid k (k = 0 … N-1)
 * goes from seat (nominator + 1 + k) mod seats at offset k·window/N, for
 * $2 + k — a strictly rising schedule, so a refusal is a race the lock
 * resolved (a raise that lost to a higher one), never a harness bug.
 */
import { describeTrend, judgeStorm, type AssertLine, type BidRow, type StormVerdict } from '../lib/checks'
import { RealtimeConnection } from '../lib/phoenix'
import { rpc, select, type Endpoint } from '../lib/supa'
import { uuidV4, type Transport } from '../lib/transport'

export interface AuctionVuInput {
  t: Transport
  ep: Endpoint
  socketUrl: string
  token: string
  draftId: string
  teamId: string
  /** This VU's seat index and the room's seat→team order (manifest order). */
  seat: number
  seatTeams: readonly string[]
  pool: readonly string[]
  bidsPerStorm: number
  stormWindowMs: number
  storms: number
  timeoutMs: number
}

interface Nomination {
  player_id: string
  high_bid: number
  high_bidder_team_id: string
}

interface AuctionRecord {
  status?: string
  current_pick_number?: number | null
  on_clock_team_id?: string | null
  current_nomination?: Nomination | null
}

const BROADCAST_WAIT_MS = 5_000

export async function auctionVu(input: AuctionVuInput): Promise<void> {
  const { t, ep, draftId, teamId } = input
  const conn = new RealtimeConnection(t, input.socketUrl)
  await conn.ready
  const join = await conn.join({ subtopic: `draft:${draftId}`, accessToken: input.token, presenceKey: teamId })
  t.metrics.trend('realtime_join_ms', join.ms)
  if (!join.ok) {
    t.metrics.count('realtime_join_refused')
    conn.close()
    return
  }
  t.metrics.count('realtime_joins')

  const state: AuctionRecord = {}
  const drafted = new Set<string>()
  const myBids = new Map<number, number>() // amount → sentAt
  conn.onBroadcast((e) => {
    const record = (e.payload.record ?? {}) as Record<string, unknown>
    if (e.event === 'drafts') Object.assign(state, record as AuctionRecord)
    else if (e.event === 'draft_picks') drafted.add(String(record.player_id ?? ''))
    else if (e.event === 'draft_bids' && e.payload.operation === 'INSERT' && record.team_id === teamId) {
      const amount = Number(record.amount)
      const sentAt = myBids.get(amount)
      if (sentAt !== undefined) {
        myBids.delete(amount)
        t.metrics.trend('bid_to_broadcast_ms', e.receivedAtMs - sentAt)
      }
    }
  })
  const resync = async (): Promise<void> => {
    const row = await select<AuctionRecord>(
      t,
      ep,
      input.token,
      'drafts',
      `id=eq.${draftId}&select=status,current_pick_number,on_clock_team_id,current_nomination`,
    )
    if (row.ok && row.data?.[0]) Object.assign(state, row.data[0])
    const picks = await select<{ player_id: string }>(t, ep, input.token, 'draft_picks', `draft_id=eq.${draftId}&select=player_id`)
    if (picks.ok && picks.data) for (const p of picks.data) drafted.add(p.player_id)
  }
  await resync()

  const started = t.nowMs()
  const timedOut = (): boolean => t.nowMs() - started > input.timeoutMs
  for (let storm = 0; storm < input.storms && !timedOut(); storm++) {
    // ---- Phase 1: a nomination is up (the seat on the clock makes it) -----
    let lastResync = t.nowMs()
    while (!timedOut() && state.status === 'live' && (state.current_nomination ?? null) === null) {
      if (state.on_clock_team_id === teamId) {
        const playerId = input.pool.find((id) => !drafted.has(id))
        if (playerId === undefined) break
        const res = await rpc(t, ep, input.token, 'draft_nominate', {
          p_draft_id: draftId,
          p_player_id: playerId,
          p_opening_bid: 1,
          p_action_id: uuidV4(t.random),
        })
        if (!res.ok) t.log(`auction: nominate refused (${res.status}): ${res.message ?? ''}`)
        await resync()
      }
      await t.sleep(50)
      if (t.nowMs() - lastResync > 2_000) {
        await resync()
        lastResync = t.nowMs()
      }
    }
    if (state.status !== 'live' || !state.current_nomination) break
    const seq = state.current_pick_number ?? -1
    const nomination = state.current_nomination
    const nominatorSeat = input.seatTeams.indexOf(nomination.high_bidder_team_id)

    // ---- Phase 2: the storm --------------------------------------------
    const stormStart = t.nowMs()
    const mine: number[] = []
    for (let k = 0; k < input.bidsPerStorm; k++) {
      if ((nominatorSeat + 1 + k) % input.seatTeams.length === input.seat) mine.push(k)
    }
    await Promise.all(
      mine.map(async (k) => {
        const at = stormStart + Math.floor((k * input.stormWindowMs) / input.bidsPerStorm)
        const wait = at - t.nowMs()
        if (wait > 0) await t.sleep(wait)
        const amount = 2 + k
        myBids.set(amount, t.nowMs())
        t.metrics.count('bids_sent')
        const res = await rpc(t, ep, input.token, 'draft_place_bid', {
          p_draft_id: draftId,
          p_amount: amount,
          p_action_id: uuidV4(t.random),
          p_nomination_seq: seq,
          p_player_id: nomination.player_id,
        })
        t.metrics.trend('bid_rpc_ms', res.ms)
        if (res.ok) t.metrics.count('bids_accepted')
        else if (res.failed) {
          myBids.delete(amount)
          t.metrics.count('bids_failed')
          t.log(`auction: bid $${amount} FAILED (${res.status}): ${res.message ?? ''}`)
        } else {
          myBids.delete(amount)
          t.metrics.count('bids_refused')
        }
      }),
    )
    const waitStart = t.nowMs()
    while (myBids.size > 0 && t.nowMs() - waitStart < BROADCAST_WAIT_MS) await t.sleep(20)
    myBids.clear()

    // ---- Phase 3: the award (the bid clock runs out; draft_tick awards) --
    while (!timedOut() && state.status === 'live' && (state.current_pick_number ?? -1) === seq) {
      await t.sleep(250)
      if (t.nowMs() - lastResync > 2_000) {
        await resync()
        lastResync = t.nowMs()
      }
    }
  }
  conn.close()
}

export interface AuctionVerifyResult {
  storms: StormVerdict[]
}

/** Every nomination that drew bids, judged from the stored rows. */
export async function auctionVerify(t: Transport, ep: Endpoint, serviceKey: string, draftId: string): Promise<AuctionVerifyResult> {
  const bids = await select<BidRow>(
    t,
    ep,
    serviceKey,
    'draft_bids',
    `draft_id=eq.${draftId}&select=nomination_seq,team_id,amount,created_at,voided_at&order=created_at.asc&limit=10000`,
  )
  if (!bids.ok || bids.data === null) throw new Error(`auction verify: draft_bids read failed (${bids.status} ${bids.message ?? ''})`)
  const picks = await select<{ pick_number: number; price: number | null }>(
    t,
    ep,
    serviceKey,
    'draft_picks',
    `draft_id=eq.${draftId}&is_undone=eq.false&select=pick_number,price`,
  )
  if (!picks.ok || picks.data === null) throw new Error(`auction verify: draft_picks read failed (${picks.status})`)
  const priceBySeq = new Map(picks.data.map((p) => [p.pick_number, p.price]))
  const seqs = [...new Set(bids.data.map((b) => b.nomination_seq))].sort((a, b) => a - b)
  return {
    storms: seqs
      .map((seq) => judgeStorm(seq, bids.data!, priceBySeq.get(seq) ?? null))
      // a nomination nobody raised (the opening bid alone) is not a storm
      .filter((v) => v.bids > 1),
  }
}

export function auctionAsserts(
  verify: AuctionVerifyResult,
  counts: { sent: number; accepted: number; refused: number; failed: number },
  bidToBroadcast: readonly number[],
  expectedStorms: number,
): AssertLine[] {
  const storms = verify.storms
  return [
    {
      name: `§22.6 (2) storms ran (${expectedStorms} nomination(s) × the profile's bids)`,
      pass: storms.length >= expectedStorms,
      detail: `${storms.length} raised nomination(s) stored · ${counts.sent} bids sent`,
    },
    {
      name: '§22.1 bids serialized by the draft-row lock (standing bids strictly rise in commit order)',
      pass: storms.length > 0 && storms.every((s) => s.serialized),
      detail: storms.map((s) => `#${s.nominationSeq}: ${s.bids} bids ${s.serialized ? 'rising' : 'NOT rising'}`).join(' · ') || 'none',
    },
    {
      name: 'every bid answered — accepted or refused, none failed (5xx / transport)',
      pass: counts.failed === 0 && counts.accepted + counts.refused === counts.sent,
      detail: `${counts.accepted} accepted · ${counts.refused} refused (race losers) · ${counts.failed} failed`,
    },
    {
      name: 'an awarded nomination sells at its highest standing bid',
      pass: storms.every((s) => s.awardMatchesHigh !== false),
      detail: storms.map((s) => `#${s.nominationSeq}: $${s.awardedPrice ?? '—'} vs high $${s.maxAmount ?? '—'}`).join(' · ') || 'none',
    },
    {
      name: 'bid → own broadcast (a measurement; §22.6 prints no number for scenario 2)',
      pass: true,
      info: true,
      detail: describeTrend(bidToBroadcast),
    },
  ]
}
