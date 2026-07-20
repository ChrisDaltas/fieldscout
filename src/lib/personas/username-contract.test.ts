import { describe, expect, it } from 'vitest'

import { PERSONA_ROSTER } from './roster'

/**
 * Username contract pins — spec-redraft-leagues v2.8/v2.8.1 (Q4/Q7 rulings).
 *
 * These two regexes are LITERAL COPIES of migration 040's
 * profiles_username_format_check branches. If either changes there, change it
 * here in the same commit — this file exists so a roster edit (or a future
 * contract change) that would fail the DB constraint fails in vitest first,
 * instead of at prod-push time.
 */
const HUMAN_PATTERN = /^[a-z0-9_]{5,20}$/
const PERSONA_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*-ai$/

// The system-owner account seeded by scripts/seed-ai-personas.ts (not part of
// PERSONA_ROSTER; pinned as a literal because scripts/ isn't importable here).
const SYSTEM_OWNER_USERNAME = 'fieldscout-ai'

// Dev seeds from scripts/seed-dev-user.ts (same import caveat).
const DEV_SEED_USERNAMES = ['dev_user', 'devpro']

describe('username contract (migration 040, Q4/Q7)', () => {
  it('every roster persona handle passes the persona pattern', () => {
    for (const persona of PERSONA_ROSTER) {
      expect(persona.username, persona.username).toMatch(PERSONA_PATTERN)
    }
    expect(SYSTEM_OWNER_USERNAME).toMatch(PERSONA_PATTERN)
  })

  it('no persona handle passes the HUMAN pattern (namespace separation)', () => {
    for (const persona of PERSONA_ROSTER) {
      expect(persona.username, persona.username).not.toMatch(HUMAN_PATTERN)
    }
    expect(SYSTEM_OWNER_USERNAME).not.toMatch(HUMAN_PATTERN)
  })

  it('dev-seed usernames pass the human pattern', () => {
    for (const username of DEV_SEED_USERNAMES) {
      expect(username, username).toMatch(HUMAN_PATTERN)
    }
  })

  it('the signup fallback shape (user_ + 8 hex) passes the human pattern', () => {
    expect('user_ab12cd34').toMatch(HUMAN_PATTERN)
  })

  it('a human cannot hold a *-ai handle under the human pattern (hyphen-free charset)', () => {
    expect('evil-ai').not.toMatch(HUMAN_PATTERN)
    // ...and the persona pattern rejects malformed handles:
    expect('bad--name-ai').not.toMatch(PERSONA_PATTERN)
    expect('-ai').not.toMatch(PERSONA_PATTERN)
  })
})
