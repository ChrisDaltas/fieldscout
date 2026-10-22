/**
 * The k6 implementation of `Transport` (M7 L.F2.1). Imported ONLY by the
 * `*.k6.ts` entries — k6 resolves `k6/*` modules itself; nothing else in the
 * repo can load this file.
 *
 * k6 requires custom metrics to be created in the init context, so every
 * metric the scenarios use is registered here at module load from the one
 * list in `transport.ts`.
 */
import http from 'k6/http'
import { Counter, Trend } from 'k6/metrics'
import { setTimeout } from 'k6/timers'
import { WebSocket } from 'k6/websockets'

import { COUNTER_METRICS, TREND_METRICS, type Transport } from './transport'

const trends = new Map<string, Trend>(TREND_METRICS.map((n) => [n, new Trend(n, true)]))
const counters = new Map<string, Counter>(COUNTER_METRICS.map((n) => [n, new Counter(n)]))

export function k6Transport(): Transport {
  return {
    metrics: {
      trend(name, value) {
        const t = trends.get(name)
        if (!t) throw new Error(`k6 transport: trend '${name}' is not registered (load/k6/lib/transport.ts)`)
        t.add(value)
      },
      count(name, by = 1) {
        const c = counters.get(name)
        if (!c) throw new Error(`k6 transport: counter '${name}' is not registered (load/k6/lib/transport.ts)`)
        c.add(by)
      },
    },
    log: (line) => console.log(line),
    random: Math.random,
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms))),
    async request(method, url, body, headers) {
      const res = await http.asyncRequest(method, url, body, { headers, timeout: '30s' })
      if (res.error_code !== 0 && res.status === 0) return { status: 0, body: '', error: res.error }
      return { status: res.status, body: res.body ?? '', error: null }
    },
    connect(url, handlers) {
      const ws = new WebSocket(url)
      ws.onopen = () => handlers.onOpen()
      ws.onmessage = (e) => handlers.onMessage(e.data)
      ws.onclose = (e) => handlers.onClose(e.code, e.reason)
      ws.onerror = (e) => handlers.onError(e.error ?? 'websocket error')
      return {
        send: (data) => {
          if (ws.readyState === 1) ws.send(data)
        },
        close: () => ws.close(),
      }
    },
  }
}

/** Blocking (setup/teardown-safe) JSON request — k6 lifecycle helpers. */
export function k6Json(method: string, url: string, body: unknown, headers: Record<string, string>): { status: number; json: unknown } {
  const res = http.request(method, url, body === null ? null : JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...headers },
    timeout: '30s',
  })
  let json: unknown = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = null
  }
  return { status: res.status, json }
}
