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
import { friendlyMessage } from './friendly-messages'

export class LeagueActionError extends Error {
  status: number
  fieldErrors?: Record<string, string[]>
  /** The server's text as sent — for code that PARSES a refusal
   *  (`dropsNeeded`, `isDeadlineRefusal`); `message` is the member's copy. */
  raw: string
  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>, raw?: string) {
    super(message)
    this.name = 'LeagueActionError'
    this.status = status
    this.fieldErrors = fieldErrors
    this.raw = raw ?? message
  }
}

/** The server's raw text behind an error (parsers read this, never the copy). */
export function rawErrorText(error: unknown): string | null {
  if (error instanceof LeagueActionError) return error.raw
  return error instanceof Error ? error.message : null
}

/**
 * F116 (MP.11) → friendly server messages (D481): a `RAISE EXCEPTION`
 * message arrives on the wire as `set_lineup: Josh Allen's game kicked off at
 * … (§11.2, lineup_lock = per_player_kickoff); wanted "QB:0"`. The member
 * reads it through THIS one function, at the one surfacing layer every
 * league hook throws through — never per call site — so route bodies (and
 * every stack-backed assertion on them) keep the raw string. The rules live
 * in `friendly-messages.ts` (phrase map, then the generic cleanup).
 */
export function userFacingMessage(raw: string): string {
  return friendlyMessage(raw)
}

/** A per-field error map, each message made friendly. */
export function friendlyFieldErrors(fieldErrors: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, (v ?? []).map(userFacingMessage)]))
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
    throw new LeagueActionError(
      response.status,
      userFacingMessage(message),
      fieldErrors && friendlyFieldErrors(fieldErrors),
      message,
    )
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
