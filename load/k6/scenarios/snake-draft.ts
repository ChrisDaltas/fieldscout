/**
 * §22.6 scenario (1) — simultaneous snake drafts, every seat a bot (M7
 * L.F2.1). Asserts: p95 pick→broadcast < 500 ms; zero duplicate picks.
 *
 * ONE VU = ONE SEAT, as a real room is one client per manager: it opens its
 * own socket, joins the PRIVATE `draft:<id>` channel with its own JWT (the
 * app's `use-draft.ts` join), and when its team is on the clock it waits a
 * think time, then calls `draft_make_pick` — the authoritative RPC. The
 * latency sample is measured on the picker's OWN clock: RPC sent → its own
 * pick's `draft_picks` broadcast received on its own socket (one machine,
 * one clock; no cross-host skew). A pick whose broadcast never arrives is
 * counted (`pick_broadcast_missing` — the F311 silent-drop class), enters
 * p95 at the full wait window, and fails the run (R1642).
 *
 * Duplicates are judged by the verify step from the STORED board, not from
 * what the bots believe (`checks.duplicatePicks`).
 */
import { PICK_TO_BROADCAST_P95_MS } from '../config'
import { describeTrend, duplicatePicks, percentile, type AssertLine, type PickRow } from '../lib/checks'
import { RealtimeConnection } from '../lib/phoenix'
import { rpc, select, type Endpoint } from '../lib/supa'
import { uniformInt, uuidV4, type Transport } from '../lib/transport'

export interface SnakeVuInput {
  t: Transport
  ep: Endpoint
  socketUrl: string
  token: string
  draftId: string
  teamId: string
  /** The bots' shared board, best first. */
  pool: readonly string[]
  pickDelayMs: { min: number; max: number }
  /** Give up (and report the draft unfinished) after this many wall ms. */
  timeoutMs: number
}

interface DraftRecord {
  status?: string
  current_pick_number?: number | null
  on_clock_team_id?: string | null
}

export const BROADCAST_WAIT_MS = 5_000
const REST_RESYNC_MS = 5_000

export async function snakeVu(input: SnakeVuInput): Promise<void> {
  const { t, ep, draftId, teamId } = input
  const conn = new RealtimeConnection(t, input.socketUrl)
  await conn.ready
  const join = await conn.join({ subtopic: `draft:${draftId}`, accessToken: input.token, presenceKey: teamId })
  t.metrics.trend('realtime_join_ms', join.ms)
  if (!join.ok) {
    t.metrics.count('realtime_join_refused')
    t.log(`snake: join refused for draft ${draftId}: ${JSON.stringify(join.reply)}`)
    conn.close()
    return
  }
  t.metrics.count('realtime_joins')

  const drafted = new Set<string>()
  const state: DraftRecord = {}
  let lastSignalMs = t.nowMs()
  let pending: { playerId: string; sentAt: number; seen: boolean } | null = null

  conn.onBroadcast((e) => {
    const record = (e.payload.record ?? {}) as Record<string, unknown>
    if (e.event === 'drafts') {
      Object.assign(state, record as DraftRecord)
      lastSignalMs = e.receivedAtMs
    } else if (e.event === 'draft_picks') {
      const playerId = String(record.player_id ?? '')
      if (record.is_undone === true) drafted.delete(playerId)
      else drafted.add(playerId)
      lastSignalMs = e.receivedAtMs
      if (pending !== null && !pending.seen && playerId === pending.playerId && record.team_id === teamId) {
        pending.seen = true
        t.metrics.trend('pick_to_broadcast_ms', e.receivedAtMs - pending.sentAt)
      }
    }
  })

  const resync = async (): Promise<void> => {
    const row = await select<DraftRecord>(t, ep, input.token, 'drafts', `id=eq.${draftId}&select=status,current_pick_number,on_clock_team_id`)
    if (row.ok && row.data && row.data[0]) Object.assign(state, row.data[0])
    const picks = await select<{ player_id: string; is_undone: boolean | null }>(
      t,
      ep,
      input.token,
      'draft_picks',
      `draft_id=eq.${draftId}&select=player_id,is_undone`,
    )
    if (picks.ok && picks.data) {
      drafted.clear()
      for (const p of picks.data) if (p.is_undone !== true) drafted.add(p.player_id)
    }
    lastSignalMs = t.nowMs()
  }

  await resync()
  const started = t.nowMs()
  let actedOnPick = -1
  while (state.status !== 'complete' && t.nowMs() - started < input.timeoutMs) {
    if (t.nowMs() - lastSignalMs > REST_RESYNC_MS) await resync()
    const pickNumber = state.current_pick_number ?? -1
    if (state.status === 'live' && state.on_clock_team_id === teamId && pickNumber !== actedOnPick) {
      actedOnPick = pickNumber
      await t.sleep(uniformInt(t.random, input.pickDelayMs.min, input.pickDelayMs.max))
      // Still ours after the think time? (the clock or the cron may have moved it)
      if (state.on_clock_team_id !== teamId || (state.current_pick_number ?? -1) !== pickNumber) continue
      for (let attempt = 0; attempt < 3; attempt++) {
        const playerId = input.pool.find((id) => !drafted.has(id))
        if (playerId === undefined) {
          t.log(`snake: draft ${draftId} — the bots' board is exhausted (seed a deeper pool)`)
          break
        }
        pending = { playerId, sentAt: t.nowMs(), seen: false }
        const res = await rpc(t, ep, input.token, 'draft_make_pick', {
          p_draft_id: draftId,
          p_player_id: playerId,
          p_action_id: uuidV4(t.random),
        })
        if (res.ok) {
          t.metrics.count('picks_made')
          const waitStart = t.nowMs()
          while (!pending.seen && t.nowMs() - waitStart < BROADCAST_WAIT_MS) await t.sleep(10)
          if (!pending.seen) {
            // R1642: a pick whose broadcast never came is the WORST sample,
            // never an absent one — it enters p95 at the full wait window
            // and is counted (the assert also requires the count be 0).
            t.metrics.count('pick_broadcast_missing')
            t.metrics.trend('pick_to_broadcast_ms', BROADCAST_WAIT_MS)
          }
          break
        }
        if (res.failed) {
          t.metrics.count('pick_transport_errors')
          t.log(`snake: draft_make_pick failed (${res.status}): ${res.message ?? ''}`)
        } else {
          t.metrics.count('pick_refusals')
        }
        pending = null
        await resync()
        if (state.on_clock_team_id !== teamId) break
      }
    }
    await t.sleep(50)
  }
  conn.close()
}

export interface SnakeVerifyInput {
  t: Transport
  ep: Endpoint
  serviceKey: string
  draftIds: readonly string[]
}

export interface SnakeVerifyResult {
  unfinished: string[]
  duplicatePlayers: number
  duplicatePickNumbers: number
  picks: number
}

/** The stored-board half of the asserts (service key: reads only). */
export async function snakeVerify(input: SnakeVerifyInput): Promise<SnakeVerifyResult> {
  const out: SnakeVerifyResult = { unfinished: [], duplicatePlayers: 0, duplicatePickNumbers: 0, picks: 0 }
  for (const draftId of input.draftIds) {
    const draft = await select<{ status: string }>(input.t, input.ep, input.serviceKey, 'drafts', `id=eq.${draftId}&select=status`)
    if (!draft.ok || draft.data?.[0]?.status !== 'complete') out.unfinished.push(draftId)
    const rows = await select<PickRow>(
      input.t,
      input.ep,
      input.serviceKey,
      'draft_picks',
      `draft_id=eq.${draftId}&select=pick_number,player_id,team_id,is_undone&limit=5000`,
    )
    if (!rows.ok || rows.data === null) throw new Error(`snake verify: draft_picks read failed (${rows.status} ${rows.message ?? ''})`)
    const d = duplicatePicks(rows.data)
    out.duplicatePlayers += d.duplicatePlayers.length
    out.duplicatePickNumbers += d.duplicatePickNumbers.length
    out.picks += rows.data.length
  }
  return out
}

export function snakeAsserts(latencies: readonly number[], verify: SnakeVerifyResult, missing: number): AssertLine[] {
  const p95 = percentile(latencies, 95)
  return [
    {
      name: `§22.6 (1) p95 pick→broadcast < ${PICK_TO_BROADCAST_P95_MS} ms (a missing broadcast enters at the ${BROADCAST_WAIT_MS} ms window)`,
      pass: p95 !== null && p95 < PICK_TO_BROADCAST_P95_MS && missing === 0,
      detail: `${describeTrend(latencies)} · ${missing} missing`,
    },
    {
      name: '§22.6 (1) zero duplicate picks',
      pass: verify.duplicatePlayers === 0 && verify.duplicatePickNumbers === 0,
      detail: `${verify.duplicatePlayers} player(s) drafted twice · ${verify.duplicatePickNumbers} pick number(s) written twice · ${verify.picks} stored picks`,
    },
    {
      name: 'every draft completed (harness — a stalled draft would hide both asserts)',
      pass: verify.unfinished.length === 0,
      detail: verify.unfinished.length === 0 ? 'all complete' : `${verify.unfinished.length} unfinished`,
    },
    {
      name: 'every pick\u2019s own broadcast arrived (the F311 silent-drop class — R1642)',
      pass: missing === 0,
      detail: `${missing} missing`,
    },
  ]
}
