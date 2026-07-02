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
