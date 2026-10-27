import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * The one check every `/api/cron/*` route makes (M7 L.F2.8, F721): the
 * request carries `Authorization: Bearer <CRON_SECRET>`.
 *
 * - **Fails closed.** No secret configured (unset or empty) → false, always.
 * - **Constant time.** Both sides are hashed to 32 bytes first, so
 *   `timingSafeEqual` compares equal lengths and the time taken says nothing
 *   about how much of the header matched (or how long the secret is).
 */
export function isCronAuthorized(
  request: Request,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest()
  const given = createHash('sha256').update(header).digest()
  return timingSafeEqual(given, expected)
}
