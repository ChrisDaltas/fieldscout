/**
 * The app's one player-name search rule, in both of its forms:
 *   - `playerNameFilter` — the PostgREST `or=(…)` filter a `players` read
 *     applies SERVER-side, so a search runs over the whole table, never over
 *     a page already in hand (the "exactly 1000 rows" lesson, CLAUDE.md);
 *   - `playerNameMatches` — the same rule on rows already loaded (a complete
 *     set read by id, or a previous search's rows while the next one lands).
 *
 * A player matches when his `full_name` holds the typed text anywhere
 * (case-insensitive), or his `search_name` — Sleeper's lower-cased,
 * run-together name ("ajbrown", "amonrastbrown") — holds it with the spaces
 * taken out, so "aj brown" finds A.J. Brown. A typed `%` or `_` matches
 * itself.
 */

/** Escape LIKE wildcards so a typed "%" or "_" matches itself. */
function likeEscape(q: string): string {
  return q.replace(/[%_\\]/g, (m) => `\\${m}`)
}

/** One value in a PostgREST `or=(…)` filter, double-quoted so a comma or
 *  bracket the user typed ("Smith, J") stays inside the value instead of
 *  splitting the filter (which PostgREST refuses). Inside the quotes a
 *  backslash escapes the next character, so `\` and `"` each get one. */
function orValue(v: string): string {
  return `"${v.replace(/[\\"]/g, (m) => `\\${m}`)}"`
}

/** The `players` name filter for a typed query (already trimmed, non-empty). */
export function playerNameFilter(q: string): string {
  const escaped = likeEscape(q)
  const collapsed = escaped.replace(/\s+/g, '')
  return `full_name.ilike.${orValue(`%${escaped}%`)},search_name.ilike.${orValue(`%${collapsed}%`)}`
}

/** `playerNameFilter`'s rule on a row in hand. An empty query matches all. */
export function playerNameMatches(player: { full_name: string; search_name?: string | null }, q: string): boolean {
  const term = q.trim().toLowerCase()
  if (!term) return true
  if (player.full_name.toLowerCase().includes(term)) return true
  const collapsed = term.replace(/\s+/g, '')
  return collapsed !== '' && (player.search_name ?? '').toLowerCase().includes(collapsed)
}
