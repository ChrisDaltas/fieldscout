/**
 * The runtime seam the four scenarios are written against (M7 L.F2.1).
 *
 * Every scenario's VU body is plain async TypeScript over this interface, so
 * ONE body runs under two runtimes:
 *   - k6 (`k6-transport.ts`: `http.asyncRequest`, `k6/websockets`, k6
 *     Trend/Counter metrics) — the §22.6 runs on the hosted test project;
 *   - Node (`scripts/load/node-transport.ts`: fetch, the global WebSocket, an
 *     in-memory metric store) — the harness's own smoke exercise, which is
 *     how this task proved the bodies without a k6 binary on the machine.
 * Wall time and randomness enter through here too, so a body never reads a
 * clock or an entropy source of its own.
 */

export interface HttpResult {
  status: number
  body: string
  /** Transport failure (no HTTP status) — never confused with a refusal. */
  error: string | null
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface SocketHandlers {
  onOpen: () => void
  onMessage: (data: string) => void
  onClose: (code: number, reason: string) => void
  onError: (message: string) => void
}

export interface Socket {
  send(data: string): void
  close(): void
}

export interface Metrics {
  /** A latency or size sample (ms unless the name says otherwise). */
  trend(name: string, value: number): void
  /** A count. */
  count(name: string, by?: number): void
}

export interface Transport {
  request(method: HttpMethod, url: string, body: string | null, headers: Record<string, string>): Promise<HttpResult>
  connect(url: string, handlers: SocketHandlers): Socket
  /** Wall-clock milliseconds (latency is measured on ONE machine's clock). */
  nowMs(): number
  sleep(ms: number): Promise<void>
  /** Uniform in [0, 1). */
  random(): number
  metrics: Metrics
  log(line: string): void
}

/** RFC 4122 v4 from the transport's own random source (action ids). */
export function uuidV4(random: () => number): string {
  const hex: string[] = []
  for (let i = 0; i < 32; i++) hex.push(Math.floor(random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

export function uniformInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

/** The metric names every runtime registers (k6 needs them at init time). */
export const TREND_METRICS = [
  'pick_to_broadcast_ms',
  'bid_rpc_ms',
  'bid_to_broadcast_ms',
  'realtime_join_ms',
  'score_broadcast_gap_ms',
] as const
export const COUNTER_METRICS = [
  'picks_made',
  'pick_refusals',
  'pick_transport_errors',
  'pick_broadcast_missing',
  'drafts_unfinished',
  'duplicate_picks',
  'bids_sent',
  'bids_accepted',
  'bids_refused',
  'bids_failed',
  'bid_storm_inconsistent',
  'realtime_joins',
  'realtime_join_refused',
  'realtime_quota_violations',
  'realtime_unexpected_closes',
  'realtime_leaked_presences',
  'score_broadcasts',
  'leagues_silent',
] as const
export type TrendMetric = (typeof TREND_METRICS)[number]
export type CounterMetric = (typeof COUNTER_METRICS)[number]
