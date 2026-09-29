/**
 * The season sim's transport to the LOCAL stack — M5 L.D3.10 (PROGRESS F375,
 * D423). A `fetch` over `node:http` with ONE keep-alive agent, handed to every
 * supabase-js client the season command builds (through `scripts/sim.ts`'s
 * global wrapper, which is the sim's injection boundary).
 *
 * WHY IT EXISTS — MEASURED 2026-09-28 on this host (Node 24.14.1, its bundled
 * undici 7.24.4, the local Kong 2.8.1):
 *   - Kong closes every keep-alive connection after 100 requests (nginx
 *     `keepalive_requests`): the 100th response carries `Connection: close`.
 *   - After the first such server close, the global fetch's undici `Agent`
 *     DESTROYS its per-origin pool at the end of every request
 *     (`UND_ERR_DESTROYED` from the client's `[destroy]`), so each later
 *     request opens a fresh socket and closes it: 1000 sequential GETs cost
 *     802 connections under the default Agent, 10 under a bare undici `Pool`,
 *     and 10 under `node:http`'s keep-alive agent.
 *   - At `--leagues 100` the season phase is ~1,300 requests/s, one socket
 *     each; macOS holds a closed socket in TIME_WAIT for 2 × MSL (30 s) out of
 *     16,384 ephemeral ports, so the run died `TypeError: fetch failed` at
 *     ~50 s with 7,000–10,000 sockets in TIME_WAIT (F375's own numbers).
 * The fix is the transport, not the load: the same requests, in the same
 * order, on reused connections. Nothing here retries, and nothing changes what
 * the run asserts.
 *
 * Semantics kept from `fetch`: method / headers / body / `AbortSignal`; a
 * transport error rejects as `TypeError('fetch failed', { cause })`, as the
 * global fetch does; HEAD and 204/205/304 answers carry no body.
 */
import http from 'node:http'

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 })

const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

export async function keepAliveFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.protocol !== 'http:') throw new TypeError(`keepAliveFetch serves the local http stack only (got ${url.protocol})`)
  const body = request.body === null ? null : Buffer.from(await request.arrayBuffer())
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  if (body !== null) headers['content-length'] = String(body.length)
  const signal = init?.signal ?? null
  if (signal?.aborted) throw signal.reason ?? new DOMException('This operation was aborted', 'AbortError')

  return new Promise<Response>((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port === '' ? 80 : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('error', (e) => reject(new TypeError('fetch failed', { cause: e })))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          const out = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue
            if (Array.isArray(value)) for (const v of value) out.append(key, v)
            else out.set(key, value)
          }
          const noBody = request.method === 'HEAD' || NULL_BODY_STATUS.has(status)
          resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage ?? '', headers: out }))
        })
      },
    )
    req.on('error', (e) => reject(signal?.aborted ? (signal.reason ?? e) : new TypeError('fetch failed', { cause: e })))
    signal?.addEventListener('abort', () => req.destroy(new DOMException('This operation was aborted', 'AbortError')), { once: true })
    req.end(body ?? undefined)
  })
}
