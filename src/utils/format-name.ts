/**
 * Abbreviate the last name to a single initial when the full name would
 * overflow a small card. Multi-word last names (`Justin Jefferson`,
 * `Christian McCaffrey`) collapse the trailing word to a one-letter initial,
 * preserving any prefix tokens like `St.` or `de`.
 *
 *   "CeeDee Lamb"          -> "CeeDee Lamb"
 *   "Justin Jefferson"     -> "Justin J."
 *   "Christian McCaffrey"  -> "Christian M."
 *   "Amon-Ra St. Brown"    -> "Amon-Ra St. B."
 *   "Mahomes"              -> "Mahomes"
 */
export function abbreviateLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length < 2) return fullName.trim()
  const last = parts[parts.length - 1]
  const initial = last[0]?.toUpperCase()
  if (!initial) return fullName.trim()
  return `${parts.slice(0, -1).join(' ')} ${initial}.`
}

/**
 * Adaptively truncate a player's display name. Returns the full name when it
 * fits, otherwise the abbreviated form.
 */
export function compactPlayerName(fullName: string, maxLength = 14): string {
  const trimmed = fullName.trim()
  if (trimmed.length <= maxLength) return trimmed
  return abbreviateLastName(trimmed)
}

/**
 * The phone's ONE short player name (gap list §4 item 17): the first initial,
 * a period, then every later word — "Saquon Barkley" → "S. Barkley",
 * "Amon-Ra St. Brown" → "A. St. Brown", "Michael Penix Jr." → "M. Penix Jr.".
 * Every mobile screen that shortens a player's name calls this, so one player
 * reads the same on Rankings, Lists, Community, Team, Match and Players.
 *
 * Left exactly as written:
 * - a first name that is already initials — "A.J. Brown", "DK Metcalf",
 *   "CJ Stroud", "T.J. Hockenson". Cutting them made A.J. Brown "A. Brown"
 *   right next to "A. St. Brown", and DK a "D. Metcalf" nobody calls him;
 * - a team defense ("Broncos D/ST", or any DEF / DST row);
 * - a one-word name.
 */
export function shortPlayerName(fullName: string, position?: string | null): string {
  const name = fullName.trim()
  const pos = (position ?? '').toUpperCase()
  if (pos === 'DEF' || pos === 'DST' || /D\/ST$/.test(name)) return name
  const [first, ...rest] = name.split(/\s+/)
  if (!first || rest.length === 0 || isInitials(first)) return name
  return `${first[0]}. ${rest.join(' ')}`
}

/** "A.J.", "T.J.", "DK", "CJ": a first name that is already initials — it
 *  has a period, or it is two or three capital letters. */
function isInitials(first: string): boolean {
  return first.includes('.') || /^[A-Z]{2,3}$/.test(first)
}
