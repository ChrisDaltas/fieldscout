/**
 * Browser-side fetch helper for the league mutation hooks (M1 UI lane).
 *
 * The route handlers answer with a uniform `{ error }` body on failure, where
 * `error` is either a plain string or `{ fieldErrors }` (the per-field 400s the
 * services produce — invites-service/members-service). This wraps that into a
 * typed `LeagueActionError` so hooks can surface the RPC's UX message and, when
 * present, route field errors to their input (the slug editor, the invite
 * form). Mirrors `parseJsonOrThrow` in use-leagues.ts + `LeaguePatchError` in
 * use-league.ts — one shape for both invite and member actions, no fork.
 *
 * No Date/time reads here despite living under `src/lib/leagues/**` (the
 * TimeProvider ESLint guard's scope) — it's pure request plumbing.
 */

export class LeagueActionError extends Error {
  status: number
  fieldErrors?: Record<string, string[]>
  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'LeagueActionError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

function firstFieldMessage(fieldErrors: Record<string, string[]>): string | undefined {
  for (const messages of Object.values(fieldErrors)) {
    if (messages && messages.length > 0) return messages[0]
  }
  return undefined
}

/** Fetch JSON, throwing `LeagueActionError` on a non-2xx response. */
export async function sendLeagueAction<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init)
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null

  if (!response.ok) {
    const error = body?.error
    const fieldErrors =
      error && typeof error === 'object' && 'fieldErrors' in error
        ? (error as { fieldErrors: Record<string, string[]> }).fieldErrors
        : undefined
    const message =
      typeof error === 'string'
        ? error
        : (fieldErrors && firstFieldMessage(fieldErrors)) ?? 'Something went wrong. Please try again.'
    throw new LeagueActionError(response.status, message, fieldErrors)
  }

  return body as T
}

/** Convenience for a JSON-body POST/PATCH/DELETE. */
export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
}
