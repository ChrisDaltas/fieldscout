import { z } from 'zod'

/**
 * Route-layer rate limits — M7 L.F2.6 (spec §22.5; ledger F41; migration 209;
 * PROGRESS D700–D706).
 *
 * §22.5: "Route-layer per-user limits: 10 mutations/10s/league, chat 5
 * msgs/10s, bids 5/s (server also serializes via the draft lock). 429 with
 * retry-after; never silently drop." Mocks share every live-draft limit.
 *
 * The NUMBERS live in the database (`rate_limit_rule_internal`, 209) — the
 * one place the limiter reads them. This module is the route side only:
 *
 *   - `classifyRateLimitedRequest` — which requests spend which allowance.
 *     Every write (POST / PATCH / PUT / DELETE) under `/api/leagues/<id>/…`
 *     spends the league's "mutation" allowance, and under
 *     `/api/mocks/<id>/…` the practice draft's; a BID spends the "bid"
 *     allowance instead (a bidding war is many bids — it is not ten
 *     mutations); the trade preview is a read sent as a POST and spends
 *     nothing. Chat has no route (§9.3 / D99) — 209's trigger limits it on
 *     the insert path.
 *   - `parseRateLimitTake` — the door's answer, validated.
 *   - `rateLimitCopy` / `retryAfterSeconds` / `rateLimitedBody` — the 429:
 *     plain words naming the wait, `Retry-After` in whole seconds (≥ 1).
 *
 * Pure: no clock, no fetch, no env. The middleware does the one RPC.
 */

export type RateLimitBucket = 'mutation' | 'bid'

export interface RateLimitTarget {
  bucket: RateLimitBucket
  /** The league id (league routes) or the practice draft id (mock routes). */
  scope: string
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const LEAGUE_PATH = new RegExp(`^/api/leagues/(${UUID})(/.*)?$`)
const MOCK_PATH = new RegExp(`^/api/mocks/(${UUID})(/.*)?$`)

/** Methods that write. GET / HEAD / OPTIONS never spend an allowance. */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/** Sub-paths that are reads sent as a POST (the body is the question). */
const READS_SENT_AS_POST = new Set(['/trades/preview'])

/** Sub-paths that are bids (§22.5's own 5-per-second allowance). */
const LEAGUE_BID_PATHS = new Set(['/draft/bid'])
const MOCK_BID_PATHS = new Set(['/bid'])

function trimSlash(rest: string | undefined): string {
  if (!rest) return ''
  return rest.length > 1 && rest.endsWith('/') ? rest.slice(0, -1) : rest
}

/**
 * Which allowance a request spends, or `null` when it spends none. Paths
 * whose id segment is not a UUID spend nothing here — the route answers 404
 * on its own.
 */
export function classifyRateLimitedRequest(method: string, pathname: string): RateLimitTarget | null {
  if (!WRITE_METHODS.has(method.toUpperCase())) return null

  const league = LEAGUE_PATH.exec(pathname)
  if (league) {
    const rest = trimSlash(league[2])
    if (READS_SENT_AS_POST.has(rest)) return null
    return { bucket: LEAGUE_BID_PATHS.has(rest) ? 'bid' : 'mutation', scope: league[1].toLowerCase() }
  }

  const mock = MOCK_PATH.exec(pathname)
  if (mock) {
    const rest = trimSlash(mock[2])
    return { bucket: MOCK_BID_PATHS.has(rest) ? 'bid' : 'mutation', scope: mock[1].toLowerCase() }
  }

  return null
}

/** The door's answer (209 `rate_limit_take`). */
const takeSchema = z.object({
  allowed: z.boolean(),
  bucket: z.string(),
  limit: z.number().int(),
  window_ms: z.number().int(),
  remaining: z.number().int(),
  retry_after_ms: z.number().int().nonnegative(),
})

export type RateLimitTake = z.infer<typeof takeSchema>

/** The door's answer, or `null` when it is not the shape 209 returns. */
export function parseRateLimitTake(data: unknown): RateLimitTake | null {
  const parsed = takeSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** `Retry-After` in whole seconds, rounded UP and never below 1. */
export function retryAfterSeconds(retryAfterMs: number): number {
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return 1
  return Math.max(1, Math.ceil(retryAfterMs / 1000))
}

function secondsWord(seconds: number): string {
  return seconds === 1 ? '1 second' : `${seconds} seconds`
}

/** The refusal in plain words: what happened, how long to wait, that nothing changed. */
export function rateLimitCopy(bucket: RateLimitBucket, seconds: number): string {
  if (bucket === 'bid') {
    return `You're bidding faster than the room can take. Wait ${secondsWord(seconds)} and bid again — that bid wasn't placed.`
  }
  return `You're making changes too fast. Wait ${secondsWord(seconds)} and try again — nothing was changed.`
}

export interface RateLimitedBody {
  error: string
  code: 'RATE_LIMITED'
  bucket: RateLimitBucket
  retry_after_seconds: number
}

/** The 429 body and its `Retry-After` header value. */
export function rateLimitedResponseParts(
  bucket: RateLimitBucket,
  retryAfterMs: number,
): { body: RateLimitedBody; retryAfter: string } {
  const seconds = retryAfterSeconds(retryAfterMs)
  return {
    body: { error: rateLimitCopy(bucket, seconds), code: 'RATE_LIMITED', bucket, retry_after_seconds: seconds },
    retryAfter: String(seconds),
  }
}
