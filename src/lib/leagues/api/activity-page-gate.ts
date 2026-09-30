/**
 * Who may open the Activity page — M6 task L.E1.34
 * (`/app/leagues/[leagueId]/activity`; spec §16.1, §10.3 — the log is
 * member-readable; PROGRESS D459).
 *
 * **Members only, decided on the SERVER before anything renders** — the
 * Commissioner Console's pattern (`commish-console-gate.ts`, D457(1)) with
 * the members' predicate: `is_league_member` (the SELECT policy of the feed's
 * tables and of `commissioner_actions`, 123:333, and the gate every read on
 * the page asks first — `assertLeagueMember`). Anyone else — a non-member, a
 * league id that is not a UUID, a league that does not exist — gets ONE
 * answer, the league page, which renders its own honest state; nothing about
 * a league the caller cannot see leaks through the redirect.
 *
 * A failed check is THROWN, never read as "not a member" (CLAUDE.md — a
 * member bounced by a database blip would be told nothing).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

export type ActivityPageGate = 'page' | 'league_page'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function readActivityPageGate(supabase: SupabaseClient<Database>, leagueId: string): Promise<ActivityPageGate> {
  if (!UUID_RE.test(leagueId)) return 'league_page'
  const { data, error } = await supabase.rpc('is_league_member', { p_league_id: leagueId })
  if (error) throw new Error(`is_league_member: ${error.message}`)
  return data === true ? 'page' : 'league_page'
}
