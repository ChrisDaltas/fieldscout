/**
 * The league-channel half of §22.6 scenarios (3) and (4) (M7 L.F2.1).
 *
 * (3) SUNDAY VIEWERS — `viewersPerLeague` members per seeded league hold the
 *     PRIVATE `league:<id>` channel (the app's `use-league-channel.ts` join,
 *     presence keyed by the viewer) for the length of the replay and count the
 *     score broadcasts (`matchups`, `team_week_results`) that reach them. The
 *     scoring-lag p95 is measured server-side by the feeder
 *     (`scripts/load/sunday-replay.ts`); the viewers supply §22.1's
 *     connection load and catch the other failure — a league whose scores
 *     moved but whose viewers heard nothing (`leagues_silent`, F311).
 * (4) SOAK WITH CHURN — each connection joins, tracks presence, holds for a
 *     random `churnHoldSec`, leaves, closes and reconnects, until the soak
 *     ends. Asserts: zero realtime-quota violations; no leaked connections —
 *     after every churner has closed, an observer joins each league and reads
 *     its presence state: any churner key still present is a leak.
 */
import type { AssertLine } from '../lib/checks'
import { describeTrend } from '../lib/checks'
import { RealtimeConnection, presenceKeys } from '../lib/phoenix'
import type { Transport } from '../lib/transport'
import { uniformInt } from '../lib/transport'

export const SCORE_EVENTS = ['matchups', 'team_week_results'] as const
export const SOAK_PRESENCE_PREFIX = 'soak-'

export interface ViewerVuInput {
  t: Transport
  socketUrl: string
  token: string
  leagueId: string
  presenceKey: string
  durationMs: number
  /** Report this league silent if this viewer heard no score broadcast. */
  reportSilence: boolean
  /** Leave early once this says so (the Node driver ends with the replay). */
  stop?: () => boolean
}

export async function sundayViewerVu(input: ViewerVuInput): Promise<number> {
  const { t } = input
  const conn = new RealtimeConnection(t, input.socketUrl)
  await conn.ready
  const join = await conn.join({ subtopic: `league:${input.leagueId}`, accessToken: input.token, presenceKey: input.presenceKey })
  t.metrics.trend('realtime_join_ms', join.ms)
  if (!join.ok) {
    t.metrics.count('realtime_join_refused')
    conn.close()
    return 0
  }
  t.metrics.count('realtime_joins')
  await conn.track(`league:${input.leagueId}`, { viewer: input.presenceKey })
  let heard = 0
  let lastAt: number | null = null
  conn.onBroadcast((e) => {
    if (!(SCORE_EVENTS as readonly string[]).includes(e.event)) return
    heard += 1
    t.metrics.count('score_broadcasts')
    if (lastAt !== null) t.metrics.trend('score_broadcast_gap_ms', e.receivedAtMs - lastAt)
    lastAt = e.receivedAtMs
  })
  const end = t.nowMs() + input.durationMs
  while (t.nowMs() < end && !(input.stop?.() ?? false)) await t.sleep(500)
  if (conn.quotaViolations > 0) t.metrics.count('realtime_quota_violations', conn.quotaViolations)
  if (conn.unexpectedClose !== null) t.metrics.count('realtime_unexpected_closes')
  if (input.reportSilence && heard === 0) t.metrics.count('leagues_silent')
  conn.close()
  return heard
}

export interface SoakVuInput {
  t: Transport
  socketUrl: string
  token: string
  leagueId: string
  /** Unique per VU; the presence key is `soak-<id>-<cycle>`. */
  vuId: string
  durationMs: number
  holdSec: { min: number; max: number }
}

export async function soakVu(input: SoakVuInput): Promise<void> {
  const { t } = input
  const end = t.nowMs() + input.durationMs
  let cycle = 0
  while (t.nowMs() < end) {
    cycle += 1
    let conn: RealtimeConnection
    try {
      conn = new RealtimeConnection(t, input.socketUrl)
      await conn.ready
    } catch (e) {
      // A refused CONNECT is how a connection quota usually surfaces.
      const message = (e as Error).message
      t.metrics.count(/quota|limit|too.many/i.test(message) ? 'realtime_quota_violations' : 'realtime_unexpected_closes')
      await t.sleep(1_000)
      continue
    }
    const subtopic = `league:${input.leagueId}`
    const join = await conn.join({ subtopic, accessToken: input.token, presenceKey: `${SOAK_PRESENCE_PREFIX}${input.vuId}-${cycle}` })
    t.metrics.trend('realtime_join_ms', join.ms)
    if (join.ok) {
      t.metrics.count('realtime_joins')
      await conn.track(subtopic, { soak: input.vuId, cycle })
    } else {
      t.metrics.count('realtime_join_refused')
    }
    const hold = Math.min(uniformInt(t.random, input.holdSec.min * 1000, input.holdSec.max * 1000), Math.max(0, end - t.nowMs()))
    const holdEnd = t.nowMs() + hold
    while (t.nowMs() < holdEnd && conn.unexpectedClose === null) await t.sleep(250)
    if (conn.quotaViolations > 0) t.metrics.count('realtime_quota_violations', conn.quotaViolations)
    if (conn.unexpectedClose !== null) t.metrics.count('realtime_unexpected_closes')
    else if (join.ok) conn.leave(subtopic)
    await conn.closeAndWait()
  }
}

/**
 * The leak probe: join each league as an observer and count presence keys a
 * churner left behind. Call only after every churner has closed (plus the
 * server's presence timeout).
 */
export async function soakLeakProbe(
  t: Transport,
  socketUrl: string,
  token: string,
  leagueIds: readonly string[],
): Promise<{ leaked: number; probed: number }> {
  let leaked = 0
  let probed = 0
  for (const leagueId of leagueIds) {
    const conn = new RealtimeConnection(t, socketUrl)
    await conn.ready
    let state: string[] | null = null
    conn.onPresence((_topic, event, payload) => {
      if (event === 'presence_state') state = presenceKeys(payload)
    })
    const join = await conn.join({ subtopic: `league:${leagueId}`, accessToken: token, presenceKey: `observer-${leagueId}` })
    if (join.ok) {
      const waitEnd = t.nowMs() + 5_000
      while (state === null && t.nowMs() < waitEnd) await t.sleep(100)
      probed += 1
      leaked += (state ?? ([] as string[])).filter((k: string) => k.startsWith(SOAK_PRESENCE_PREFIX)).length
    }
    await conn.closeAndWait()
  }
  t.metrics.count('realtime_leaked_presences', leaked)
  return { leaked, probed }
}

export function soakAsserts(c: {
  joins: number
  refused: number
  quota: number
  unexpected: number
  leaked: number
  probed: number
  leagues: number
  joinMs: readonly number[]
}): AssertLine[] {
  return [
    { name: '§22.6 (4) zero realtime-quota violations', pass: c.quota === 0, detail: `${c.quota} violation(s) over ${c.joins} joins` },
    {
      name: '§22.6 (4) no connection leaks (no churner presence left after every churner closed)',
      pass: c.leaked === 0 && c.probed === c.leagues,
      detail: `${c.leaked} leaked presence key(s) · ${c.probed}/${c.leagues} leagues probed`,
    },
    { name: 'joins refused (channel auth / limits)', pass: c.refused === 0, detail: `${c.refused}` },
    { name: 'connections the server closed under us', pass: true, info: true, detail: `${c.unexpected}` },
    { name: 'join latency', pass: true, info: true, detail: describeTrend(c.joinMs) },
  ]
}
