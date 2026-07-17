/**
 * Release gates for features that exist in code but aren't ready for users.
 *
 * A flag is ON in local development by default (hidden features stay
 * workable while we build them) and OFF everywhere else. A deployed
 * environment opts in per feature by setting its NEXT_PUBLIC_FLAG_* env var
 * to "true"; setting it to "false" in .env.local previews the released app
 * locally.
 *
 * NEXT_PUBLIC_ env vars are inlined at build time, so each flag must read
 * its own env var literally — never look them up dynamically.
 */
function enabled(value: string | undefined): boolean {
  // Unset OR empty (a blank line in .env) falls back to the dev default.
  if (value) return value === 'true'
  return process.env.NODE_ENV === 'development'
}

export const featureFlags = {
  /** Leagues, league teams, and the live draft — mock-data UI, no backend yet. */
  leagues: enabled(process.env.NEXT_PUBLIC_FLAG_LEAGUES),
  /** Direct messages (rail panel) — mock-data UI, no backend yet. */
  messages: enabled(process.env.NEXT_PUBLIC_FLAG_MESSAGES),
} as const

export type FeatureFlag = keyof typeof featureFlags
