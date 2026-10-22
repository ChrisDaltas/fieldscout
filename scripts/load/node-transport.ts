/**
 * The Node implementation of the load harness's `Transport` (M7 L.F2.1) —
 * fetch, Node's global WebSocket, an in-memory metric store. It runs the
 * SAME scenario bodies k6 runs (`load/k6/scenarios/*`), so the harness can
 * be exercised where no k6 binary is installed (this task's local proof).
 *
 * This file is the injection boundary for wall time and entropy on the Node
 * side (the `scripts/sim.ts` precedent): the scenario bodies read both only
 * through the transport.
 */
import type { HttpMethod, HttpResult, Metrics, Socket, SocketHandlers, Transport } from '../../load/k6/lib/transport'

export class MemoryMetrics implements Metrics {
  readonly trends = new Map<string, number[]>()
  readonly counters = new Map<string, number>()
  trend(name: string, value: number): void {
    const list = this.trends.get(name) ?? []
    list.push(value)
    this.trends.set(name, list)
  }
  count(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by)
  }
  samples(name: string): number[] {
    return this.trends.get(name) ?? []
  }
  total(name: string): number {
    return this.counters.get(name) ?? 0
  }
}

export function nodeTransport(opts: { log?: (line: string) => void; random?: () => number } = {}): Transport & { metrics: MemoryMetrics } {
  const metrics = new MemoryMetrics()
  return {
    metrics,
    log: opts.log ?? ((line) => console.log(line)),
    random: opts.random ?? Math.random,
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
    async request(method: HttpMethod, url: string, body: string | null, headers: Record<string, string>): Promise<HttpResult> {
      try {
        const res = await fetch(url, { method, headers, body: body ?? undefined })
        return { status: res.status, body: await res.text(), error: null }
      } catch (e) {
        return { status: 0, body: '', error: (e as Error).message }
      }
    },
    connect(url: string, handlers: SocketHandlers): Socket {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => handlers.onOpen())
      ws.addEventListener('message', (e) => handlers.onMessage(typeof e.data === 'string' ? e.data : String(e.data)))
      ws.addEventListener('close', (e) => handlers.onClose(e.code, e.reason))
      ws.addEventListener('error', () => handlers.onError('websocket error'))
      return {
        send: (data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data)
        },
        close: () => ws.close(),
      }
    },
  }
}
