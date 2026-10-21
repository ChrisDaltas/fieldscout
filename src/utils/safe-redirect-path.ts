/**
 * Validate a post-sign-in destination taken from a URL parameter
 * (`?redirect=` on /login, `?next=` on /auth/callback).
 *
 * Only a same-origin PATH is accepted: it starts with exactly one `/`, holds
 * no backslash and no control character, and still resolves to this origin.
 * Anything else — a full URL, a scheme, a protocol-relative `//host`, a value
 * a browser would normalize into one — falls back to `fallback`.
 *
 * Returns the normalized `pathname + search + hash`, never the raw input.
 * Pure: no env, no window — safe on the server and in the browser.
 */
export const DEFAULT_POST_SIGN_IN_PATH = '/app'

/** Any C0 control character, DEL, or a backslash, anywhere in the value. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/

/** A fixed, throwaway base: only used to check where a path resolves. */
const PROBE_ORIGIN = 'http://same-origin.invalid'

export function safeRedirectPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_POST_SIGN_IN_PATH,
): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback
  if (UNSAFE_CHARS.test(raw)) return fallback
  if (raw[0] !== '/' || raw[1] === '/') return fallback

  let resolved: URL
  try {
    resolved = new URL(raw, PROBE_ORIGIN)
  } catch {
    return fallback
  }
  if (resolved.origin !== PROBE_ORIGIN) return fallback

  const path = resolved.pathname + resolved.search + resolved.hash
  // Belt and braces: the normalized form must itself be a single-slash path.
  if (path[0] !== '/' || path[1] === '/' || path.includes('\\')) return fallback
  return path
}
