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

  // ---------------------------------------------------------------------
  // 2026 go-live scope (CLAUDE.md → Active Builds). The soft launch ships
  // Lists + Stats/player research + AI stat lists only. Everything below is
  // built but not reskinned yet, so it stays out of the deployed app and
  // comes back one flag at a time as each surface lands in the new design
  // language. One flag per surface, deliberately — a single blunt "launch"
  // flag couldn't release them independently.
  // ---------------------------------------------------------------------

  /** Pre-draft big board (/app/big-board + the public /u/[username]/big-board). */
  bigBoard: enabled(process.env.NEXT_PUBLIC_FLAG_BIG_BOARD),
  /** Weekly rankings (/app/weekly-ranks). */
  weeklyRanks: enabled(process.env.NEXT_PUBLIC_FLAG_WEEKLY_RANKS),
  /** Public cred-weighted consensus rankings (/consensus). */
  consensus: enabled(process.env.NEXT_PUBLIC_FLAG_CONSENSUS),
  /** Community feed (/app/explore) — social/user-generated content. */
  community: enabled(process.env.NEXT_PUBLIC_FLAG_COMMUNITY),
  /** Start or sit questions (/app/start-or-sit). */
  startOrSit: enabled(process.env.NEXT_PUBLIC_FLAG_START_OR_SIT),
  /** AI expert personas — public profiles and posts (/personas). */
  personas: enabled(process.env.NEXT_PUBLIC_FLAG_PERSONAS),
  /** Fantasy teams (/app/teams). */
  teams: enabled(process.env.NEXT_PUBLIC_FLAG_TEAMS),
} as const

export type FeatureFlag = keyof typeof featureFlags
