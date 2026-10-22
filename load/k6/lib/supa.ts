/**
 * PostgREST + GoTrue over the `Transport` seam (M7 L.F2.1).
 *
 * The scenarios call the AUTHORITATIVE RPCs directly with each bot's own JWT
 * (`draft_make_pick`, `draft_nominate`, `draft_place_bid`) — the path every
 * route handler wraps (`src/lib/leagues/api/draft-service.ts`), the sim's
 * D100 precedent minus the Next cookie layer. Reads are RLS-scoped SELECTs
 * under the same JWT; the service key is used only by the verify step.
 */
import type { HttpResult, Transport } from './transport'

export interface Endpoint {
  url: string
  anonKey: string
}

export interface RpcOutcome<T = unknown> {
  /** 2xx */
  ok: boolean
  status: number
  data: T | null
  /** The refusal text (PostgREST `message`) or the transport error. */
  message: string | null
  /** A transport failure or a 5xx — never a product refusal. */
  failed: boolean
  ms: number
}

function headersFor(ep: Endpoint, token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: ep.anonKey,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extra,
  }
}

function outcome<T>(res: HttpResult, ms: number): RpcOutcome<T> {
  if (res.error !== null) return { ok: false, status: 0, data: null, message: res.error, failed: true, ms }
  let parsed: unknown = null
  try {
    parsed = res.body.length > 0 ? JSON.parse(res.body) : null
  } catch {
    parsed = null
  }
  const ok = res.status >= 200 && res.status < 300
  const message = ok ? null : typeof (parsed as { message?: unknown })?.message === 'string' ? (parsed as { message: string }).message : res.body.slice(0, 200)
  return { ok, status: res.status, data: ok ? (parsed as T) : null, message, failed: res.status >= 500, ms }
}

export async function rpc<T = unknown>(
  t: Transport,
  ep: Endpoint,
  token: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcOutcome<T>> {
  const started = t.nowMs()
  const res = await t.request('POST', `${ep.url}/rest/v1/rpc/${fn}`, JSON.stringify(args), headersFor(ep, token))
  return outcome<T>(res, t.nowMs() - started)
}

/** `GET /rest/v1/<table>?<query>` — `query` is already PostgREST syntax. */
export async function select<T = unknown>(
  t: Transport,
  ep: Endpoint,
  token: string,
  table: string,
  query: string,
): Promise<RpcOutcome<T[]>> {
  const started = t.nowMs()
  const res = await t.request('GET', `${ep.url}/rest/v1/${table}?${query}`, null, headersFor(ep, token))
  return outcome<T[]>(res, t.nowMs() - started)
}

/** Password sign-in (GoTrue). Throws on failure — a bot that cannot sign in
 *  is a provisioning failure, never a load result. */
export async function signIn(t: Transport, ep: Endpoint, email: string, password: string): Promise<string> {
  const res = await t.request(
    'POST',
    `${ep.url}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    { apikey: ep.anonKey, 'content-type': 'application/json' },
  )
  if (res.error !== null || res.status !== 200) {
    throw new Error(`sign-in failed for a load bot (${res.status}${res.error ? ` ${res.error}` : ''})`)
  }
  const token = (JSON.parse(res.body) as { access_token?: unknown }).access_token
  if (typeof token !== 'string') throw new Error('sign-in returned no access_token')
  return token
}
