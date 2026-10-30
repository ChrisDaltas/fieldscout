/**
 * Browser-side fetch for the operator console's `/api/admin/*` routes
 * (M8 L.G1.6). Every non-2xx answer throws with its status and the route's own
 * words — a failure is never turned into an empty, healthy-looking result.
 */
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

function errorText(body: unknown, status: number): string {
  const e = (body as { error?: unknown } | null)?.error
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    // Zod's flatten(): the first field / form message.
    const f = e as { formErrors?: string[]; fieldErrors?: Record<string, string[]> }
    const first = f.formErrors?.[0] ?? Object.values(f.fieldErrors ?? {})[0]?.[0]
    if (first) return first
  }
  if (status === 404) return 'Not found.'
  return `Something went wrong (${status}).`
}

export async function adminFetch<T>(url: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const res = await fetch(url, init
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
    : undefined)
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new AdminApiError(res.status, errorText(body, res.status))
  if (body === null || typeof body !== 'object') {
    throw new AdminApiError(500, 'The server answered with nothing.')
  }
  return body as T
}

export const adminKeys = {
  all: ['admin'] as const,
  platform: () => ['admin', 'platform-state'] as const,
  league: (id: string) => ['admin', 'league-state', id] as const,
  log: () => ['admin', 'operator-log'] as const,
  leagueSearch: (q: string) => ['admin', 'league-search', q] as const,
  leagueTable: (url: string) => ['admin', 'league-table', url] as const,
  leagueDetail: (id: string) => ['admin', 'league-detail', id] as const,
  // Community launch plan C10: Admin › Reports (and Home's "N new reports").
  reports: () => ['admin', 'reports'] as const,
}

/** A fresh retry key (TD3). One per confirm dialog / compose; reused on retry. */
export function newActionId(): string {
  return crypto.randomUUID()
}
