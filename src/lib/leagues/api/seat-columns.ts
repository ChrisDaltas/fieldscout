/**
 * `league_members.waiver_priority` on a database that predates it — M5 task
 * L.D2.13 (deploy before push; PROGRESS D414).
 *
 * L.D2.12 added `waiver_priority` (migration 145) to three member reads — the
 * league detail, the rosters route and standings. Merged code deploys to
 * production at once while the hosted database gets 145 only at Chris's
 * `db push`, and PostgREST answers a select naming a column that does not
 * exist with 42703 — so every league page (the detail is their membership
 * gate) failed until the push. This wrapper runs the read, and ONLY on that
 * exact error (undefined column, naming `waiver_priority`) re-runs it without
 * the column and fills `waiver_priority: null` — which is what the column
 * reads on a fresh 145 row anyway ("no priority set yet"). Any other error is
 * returned untouched, so a real failure still fails loudly.
 */
import type { PostgrestError } from '@supabase/supabase-js'

type Result<T> = { data: T | null; error: PostgrestError | null }

export function isMissingWaiverPriority(error: PostgrestError | null): boolean {
  return error !== null && error.code === '42703' && /waiver_priority/.test(error.message ?? '')
}

export async function selectWithSeatFallback<Row>(
  full: () => PromiseLike<Result<Row[]>>,
  legacy: () => PromiseLike<Result<Array<Omit<Row, 'waiver_priority'>>>>,
): Promise<Result<Row[]>> {
  const first = await full()
  if (!isMissingWaiverPriority(first.error)) return first
  const second = await legacy()
  if (second.error) return { data: null, error: second.error }
  return { data: (second.data ?? []).map((r) => ({ ...r, waiver_priority: null }) as unknown as Row), error: null }
}
