/**
 * The app-wide avatar initials rule for a PERSON (a user or an AI persona)
 * with no profile photo. One definition: `UserAvatar` (desktop and mobile)
 * and the mobile screens that draw their own avatar circles all call it, so
 * a photoless person reads the same everywhere (Chris, 2026-10-15, mobile
 * gap list #8: "the profile photo, two letters when there's none").
 *
 * A plain `.ts` module on purpose: the mobile `*-ops.ts` files are pure and
 * tested, and a `.tsx` component module is unimportable from a vitest test
 * (`jsx: "preserve"`).
 *
 * Teams and leagues are not people — their crests keep their own lettering.
 */
export function computeInitials(name: string | null | undefined): string {
  if (!name) return '?'
  const trimmed = name.trim()
  if (trimmed.length === 0) return '?'

  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    // Two words -> one letter each (persona names like "FieldScout AI").
    return parts
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase()
  }

  // Single token — which every person is now, since identity is the @handle
  // and handles contain no spaces. Take the first two characters rather than
  // one, or every photoless avatar in the app collapses to a lone letter.
  return parts[0].slice(0, 2).toUpperCase()
}

/**
 * The same rule for a handle that may carry its "@" ("@marcus" → "MA"), so
 * the sign never becomes one of the two letters.
 */
export function handleInitials(handle: string | null | undefined): string {
  return computeInitials((handle ?? '').trim().replace(/^@/, ''))
}
