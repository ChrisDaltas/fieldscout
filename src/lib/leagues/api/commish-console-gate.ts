/**
 * Who may open the Commissioner Console — M6 task L.E1.33
 * (`/app/leagues/[leagueId]/commish`; spec §10.1 as folded by v2.16.77 — the
 * console is the commissioner's launchpad; PROGRESS D443, D457).
 *
 * **A SERVER decision, made before anything renders.** The console page is a
 * server component that asks this first and sends everyone who is not a
 * commissioner (or co-commissioner) to the league page — a hidden nav link
 * is not a gate (the task text: "a manager gets the league page, not the
 * console"). The predicate is `is_league_commish` (052), the one every
 * commissioner verb and `GET …/commish/summary` check, so the page can never
 * open for someone the console's own read would refuse.
 *
 * - `'console'`         — a commissioner or co-commissioner of this league.
 * - `'league_page'`     — anyone else: a manager, a non-member, a league id
 *                         that is not a UUID, a league that does not exist.
 *                         One answer for all of them, so the redirect leaks
 *                         nothing about a league the caller cannot see; the
 *                         league page renders its own honest state.
 *
 * A failed check is THROWN, never read as "not a commissioner" (CLAUDE.md:
 * a failure is loud — a commissioner bounced to the league page by a database
 * blip would be told nothing).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

export type CommishConsoleGate = 'console' | 'league_page'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function readCommishConsoleGate(
  supabase: SupabaseClient<Database>,
  leagueId: string,
): Promise<CommishConsoleGate> {
  if (!UUID_RE.test(leagueId)) return 'league_page'
  const { data, error } = await supabase.rpc('is_league_commish', { p_league_id: leagueId })
  if (error) throw new Error(`is_league_commish: ${error.message}`)
  return data === true ? 'console' : 'league_page'
}

/** Where the console lives — one spelling of the URL (the `teamPageHref`
 *  idiom), shared by the page, the league nav and League Home's door. */
export function commishConsoleHref(leagueId: string): string {
  return `/app/leagues/${leagueId}/commish`
}
