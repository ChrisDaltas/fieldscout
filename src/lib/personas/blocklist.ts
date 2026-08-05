/**
 * Parody firewall (spec-ai-expert-personas.md): real analyst names must NEVER
 * appear in persona usernames, persona names, bios, list titles, or generated
 * rationale text. This module is enforced at every persona write path and in
 * the blocklist test.
 *
 * Grow this list whenever the roster grows. Full names are matched as
 * substrings; single tokens are only listed when they are distinctive enough
 * not to collide with NFL player names (e.g. never bare "Moore" or "Wright" —
 * those are player surnames).
 */

export const REAL_ANALYST_BLOCKLIST: readonly string[] = [
  // Full names (safe substring matches).
  'Matthew Berry',
  'Field Yates',
  'Mina Kimes',
  'Justin Boone',
  'JJ Zachariason',
  'J.J. Zachariason',
  'Jason Moore',
  'Andy Holloway',
  'Mike Wright',
  // Distinctive single tokens (no NFL-player collisions).
  'Zachariason',
  'Kimes',
]

/** Case-insensitive scan; returns every blocklisted name found in `text`. */
export function findRealAnalystNames(text: string): string[] {
  const haystack = text.toLowerCase()
  return REAL_ANALYST_BLOCKLIST.filter((name) =>
    haystack.includes(name.toLowerCase()),
  )
}

/** Throws when generated persona content contains a real analyst's name. */
export function assertNoRealAnalystNames(text: string, context: string): void {
  const hits = findRealAnalystNames(text)
  if (hits.length > 0) {
    throw new Error(
      `Parody firewall violation in ${context}: found real analyst name(s) ${hits.join(', ')}`,
    )
  }
}
