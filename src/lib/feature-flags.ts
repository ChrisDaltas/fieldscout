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
  /** Leagues, league teams, and the live draft (/app/leagues). Server-backed
   *  since M1 — schema, RLS, the draft engine and the room all ship; the flag
   *  is a release gate on the SURFACES while the 2026 launch is Lists-only
   *  (F103: this docblock said "mock-data UI, no backend yet" until MP.5). */
  leagues: enabled(process.env.NEXT_PUBLIC_FLAG_LEAGUES),
  /** Direct messages (rail panel) — mock-data UI, no backend yet. */
  messages: enabled(process.env.NEXT_PUBLIC_FLAG_MESSAGES),
  /**
   * Practice (mock) drafts — `/app/mocks`, the launch dialog, the mock room
   * and the report (spec v2.16 §8.8; MP lane; D231).
   *
   * **A RELEASE STATEMENT, NOT A CODE-ISOLATION ONE (D231(2)).** A mock runs
   * on the SHARED draft engine — the same `drafts` rows, the same
   * `draft_tick`, the same RPC family, the same room component — and that
   * sharing is correct and stays. What this flag buys is release
   * INDEPENDENCE: no practice surface may be gated on `leagues`, and turning
   * `leagues` off must not turn practice off (E79 — pinned in
   * `route-groups.test.ts`).
   *
   * **Isolation is a different mechanism entirely and is never flag-dependent
   * (D231(2)/(4)).** A mock's separation from a real league is RLS and schema
   * — the `league_id IS NULL` ownership arm (D234/095) and §8.8's
   * zero-side-effects rule — enforced server-side, identically whatever this
   * flag says. `NEXT_PUBLIC_` values are inlined into the client bundle, so a
   * flag read in an authorization path would be a client-side gate on a
   * server-authoritative surface (§12; tasks-MP §4 rule 13): this flag gates
   * SURFACES only, never an RPC, a route handler's auth path or a policy.
   */
  mockDrafts: enabled(process.env.NEXT_PUBLIC_FLAG_MOCK_DRAFTS),

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

  // `listsV2` lived here from LV.1.1 to LV.7. It is gone, along with the
  // components it branched away from: /app/lists serves the rebuilt page
  // unconditionally, so there is no second Lists surface and nothing left to
  // flip. Do not reintroduce it — a flag with one branch is a lie about what
  // ships.
} as const

export type FeatureFlag = keyof typeof featureFlags
