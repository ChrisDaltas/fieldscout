/**
 * L.A2.5 invite-panel-ops — schema-fixture / logic golden pins (tasks-M1
 * §4.3 UI scoping: "schema-fixture/logic pins where there's pure logic
 * (seat-status derivation, the identity/email-visibility rule — pin that a
 * claimed seat renders no email)" + the D39 browser pass in the session log).
 *
 * The load-bearing pin is #4 — THE PRIVACY INVARIANT (§7.2/§12.23): a claimed
 * seat carries no email even when a leftover invite for its franchise still
 * holds `invited_email`. Pin #5 is its positive control (an invited seat DOES
 * surface the email), so #4 cannot pass vacuously.
 */
import { describe, expect, it } from 'vitest'

import {
  buildJoinLink,
  deriveSeats,
  extractJoinCode,
  formatManagerIdentity,
  inviteState,
  preferredShareCode,
  validateSlug,
  type PendingInviteInput,
  type SeatMemberInput,
  type SeatTeamInput,
} from './invite-panel-ops'

// A fixed clock for every time-dependent pin — never a wall-clock read.
const NOW = Date.parse('2026-07-26T12:00:00.000Z')

function invite(overrides: Partial<PendingInviteInput>): PendingInviteInput {
  return {
    id: 'inv-1',
    target_team_id: 'team-x',
    invited_email: null,
    invited_username: null,
    token: 'tok-1',
    max_uses: 1,
    use_count: 0,
    expires_at: '2026-08-09T12:00:00.000Z', // +14d, active at NOW
    revoked_at: null,
    created_at: '2026-07-26T11:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Identity render rule (§16.4): display name (@username)
// ---------------------------------------------------------------------------

describe('formatManagerIdentity', () => {
  it('renders "display name (@username)" when a display name is set', () => {
    expect(formatManagerIdentity({ username: 'jasonjones1995', display_name: 'Jason Jones' })).toBe(
      'Jason Jones (@jasonjones1995)',
    )
  })

  it('falls back to the bare handle when the display name is unset', () => {
    expect(formatManagerIdentity({ username: 'tim_boris02', display_name: null })).toBe(
      '@tim_boris02',
    )
  })

  it('never emits an email — a null profile is Unclaimed, not an address', () => {
    expect(formatManagerIdentity(null)).toBe('Unclaimed')
  })
})

// ---------------------------------------------------------------------------
// 2. Invite status machine (§16.5.2) — precedence + expires-AT-the-instant
// ---------------------------------------------------------------------------

describe('inviteState', () => {
  it('is active before expiry', () => {
    expect(inviteState(invite({}), NOW)).toBe('active')
  })

  it('expires AT the instant (nowMs >= expires_at, D72(3)/F6)', () => {
    const at = invite({ expires_at: new Date(NOW).toISOString() })
    expect(inviteState(at, NOW)).toBe('expired') // exactly at
    expect(inviteState(at, NOW - 1000)).toBe('active') // 1s before
    expect(inviteState(at, NOW + 1000)).toBe('expired') // 1s past
  })

  it('is spent once use_count reaches max_uses', () => {
    expect(inviteState(invite({ max_uses: 2, use_count: 2 }), NOW)).toBe('spent')
    expect(inviteState(invite({ max_uses: 2, use_count: 1 }), NOW)).toBe('active')
  })

  it('revoked wins over expired and spent (062 claim order)', () => {
    const revoked = invite({
      revoked_at: '2026-07-26T10:00:00.000Z',
      expires_at: new Date(NOW - 5000).toISOString(),
      max_uses: 1,
      use_count: 1,
    })
    expect(inviteState(revoked, NOW)).toBe('revoked')
  })
})

// ---------------------------------------------------------------------------
// 3. deriveSeats — statuses + counts (open/invited/claimed/placeholder)
// ---------------------------------------------------------------------------

const CLAIMED_MEMBER: SeatMemberInput = {
  id: 'm-claimed',
  user_id: 'u-jason',
  team_id: 'team-1',
  role: 'commissioner',
  is_placeholder: false,
  profiles: { username: 'jasonjones1995', display_name: 'Jason Jones', avatar_url: null },
}
const PLACEHOLDER_MEMBER: SeatMemberInput = {
  id: 'm-placeholder',
  user_id: null,
  team_id: 'team-2',
  role: 'manager',
  is_placeholder: true,
  profiles: null,
}
const INVITED_MEMBER: SeatMemberInput = {
  id: 'm-invited',
  user_id: null,
  team_id: 'team-3',
  role: 'manager',
  is_placeholder: true,
  profiles: null,
}
const TEAMS: SeatTeamInput[] = [
  { id: 'team-1', name: 'Yardboats', status: 'active' },
  { id: 'team-2', name: 'Team 2', status: 'active' },
  { id: 'team-3', name: 'Team 3', status: 'active' },
]

describe('deriveSeats', () => {
  it('classifies claimed / placeholder / invited and pads open ghosts to team_count', () => {
    const model = deriveSeats(
      {
        teamCount: 6,
        members: [CLAIMED_MEMBER, PLACEHOLDER_MEMBER, INVITED_MEMBER],
        teams: TEAMS,
        invites: [invite({ id: 'inv-3', target_team_id: 'team-3', invited_email: 'gm@x.com' })],
        currentUserId: 'u-jason',
      },
      NOW,
    )

    expect(model.seats.map((s) => s.status)).toEqual([
      'claimed',
      'placeholder',
      'invited',
      'open',
      'open',
      'open',
    ])
    expect(model.total).toBe(6)
    expect(model.claimedCount).toBe(1)
    expect(model.materialisedCount).toBe(3)
    expect(model.openCount).toBe(3)

    const claimed = model.seats[0]
    expect(claimed.teamName).toBe('Yardboats')
    expect(claimed.identity).toBe('Jason Jones (@jasonjones1995)')
    expect(claimed.isSelf).toBe(true)

    const invited = model.seats[2]
    expect(invited.emailTarget).toBe('gm@x.com')
    expect(invited.invite?.token).toBe('tok-1')
  })

  it('never produces negative open ghosts when the league is full', () => {
    const model = deriveSeats(
      { teamCount: 1, members: [CLAIMED_MEMBER], teams: TEAMS, invites: [], currentUserId: null },
      NOW,
    )
    expect(model.openCount).toBe(0)
    expect(model.seats).toHaveLength(1)
  })

  it('ignores general (targetless) and non-pending invites for seat status', () => {
    const model = deriveSeats(
      {
        teamCount: 3,
        members: [PLACEHOLDER_MEMBER],
        teams: TEAMS,
        invites: [
          invite({ id: 'gen', target_team_id: null, invited_email: 'anyone@x.com' }), // general link
          invite({ id: 'rev', target_team_id: 'team-2', revoked_at: '2026-07-26T10:00Z' }), // revoked
        ],
        currentUserId: null,
      },
      NOW,
    )
    // team-2 has only a revoked seat invite → placeholder, not invited.
    expect(model.seats[0].status).toBe('placeholder')
    expect(model.seats[0].emailTarget).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. THE PRIVACY INVARIANT — a claimed seat renders NO email (§7.2/§12.23)
// ---------------------------------------------------------------------------

describe('privacy invariant: claimed seats carry no email', () => {
  it('a claimed franchise with a LEFTOVER invite for it shows identity, never the email', () => {
    // The commissioner CAN see this consumed/leftover invite over RLS (email
    // included) — but the seat is claimed, so the panel must not render it.
    const leftover = invite({
      id: 'inv-stale',
      target_team_id: 'team-1', // same franchise as the claimed member
      invited_email: 'secret-address@example.com',
      use_count: 1,
      max_uses: 1, // spent, but even a still-pending one must not leak
    })
    const model = deriveSeats(
      {
        teamCount: 4,
        members: [CLAIMED_MEMBER],
        teams: TEAMS,
        invites: [leftover],
        currentUserId: 'u-jason',
      },
      NOW,
    )

    const claimed = model.seats[0]
    expect(claimed.status).toBe('claimed')
    expect(claimed.emailTarget).toBeNull()
    expect(claimed.usernameTarget).toBeNull()
    expect(claimed.invite).toBeNull()
    // The falsifiable pin: nothing anywhere on the rendered seat is the email.
    expect(JSON.stringify(claimed)).not.toContain('secret-address@example.com')
  })

  it('even a STILL-PENDING invite for a claimed franchise does not leak (claimed > invited)', () => {
    const stillPending = invite({
      id: 'inv-live',
      target_team_id: 'team-1',
      invited_email: 'live-address@example.com',
      // active at NOW (default expiry, use_count 0)
    })
    const model = deriveSeats(
      { teamCount: 2, members: [CLAIMED_MEMBER], teams: TEAMS, invites: [stillPending], currentUserId: null },
      NOW,
    )
    expect(model.seats[0].status).toBe('claimed')
    expect(JSON.stringify(model.seats[0])).not.toContain('live-address@example.com')
  })
})

// ---------------------------------------------------------------------------
// 5. Positive control — an INVITED seat DOES surface the email (else #4 is vacuous)
// ---------------------------------------------------------------------------

describe('positive control: invited seats do surface the commissioner-visible email', () => {
  it('an invited placeholder shows invited_email and the copyable token', () => {
    const model = deriveSeats(
      {
        teamCount: 2,
        members: [INVITED_MEMBER],
        teams: TEAMS,
        invites: [invite({ target_team_id: 'team-3', invited_email: 'gm@example.com', token: 'abc123' })],
        currentUserId: null,
      },
      NOW,
    )
    const seat = model.seats[0]
    expect(seat.status).toBe('invited')
    expect(seat.emailTarget).toBe('gm@example.com')
    expect(JSON.stringify(seat)).toContain('gm@example.com')
    expect(seat.invite?.token).toBe('abc123')
  })
})

// ---------------------------------------------------------------------------
// 6. Share-link helpers (§7.2 path 1)
// ---------------------------------------------------------------------------

describe('share link', () => {
  it('prefers the custom slug over the random code, falling back cleanly', () => {
    expect(preferredShareCode('yardboats', 'a1b2c3d4e5')).toBe('yardboats')
    expect(preferredShareCode(null, 'a1b2c3d4e5')).toBe('a1b2c3d4e5')
    expect(preferredShareCode(null, null)).toBeNull()
  })

  it('builds an absolute link from an origin and a relative one during SSR', () => {
    expect(buildJoinLink('https://fieldscout.gg', 'yardboats')).toBe('https://fieldscout.gg/join/yardboats')
    expect(buildJoinLink('', 'tok-1')).toBe('/join/tok-1')
  })
})

// ---------------------------------------------------------------------------
// 7. Slug validation (mirrors the 062 contract; RPC stays the authority)
// ---------------------------------------------------------------------------

describe('validateSlug', () => {
  it('accepts a well-formed slug', () => {
    expect(validateSlug('yardboats-2026')).toBeNull()
  })
  it('rejects too-short, bad chars, and non-alphanumeric ends', () => {
    expect(validateSlug('ab')).toContain('3 characters')
    expect(validateSlug('has space')).toContain('Letters, numbers and hyphens')
    expect(validateSlug('-leading')).toContain('Letters, numbers and hyphens')
    expect(validateSlug('trailing-')).toContain('Letters, numbers and hyphens')
  })
})

// ---------------------------------------------------------------------------
// 8. extractJoinCode — normalise a pasted /join/… link to the bare code (R114)
// ---------------------------------------------------------------------------
//
// The finding: the join-by-code dialog pushed the pasted string verbatim, so a
// full `${origin}/join/CODE` share link (the exact affordance its copy invites)
// became the unresolvable `/join/https%3A%2F%2F…` segment → get_join_preview
// {found:false} → "This link isn't valid" on a VALID invite. Every row below
// that involves a link WOULD FAIL against the old verbatim passthrough
// (`raw.trim()`); only the bare-code and empty rows survive it — so this table
// is discriminating, not vacuous.

const CODE = 'a1b2c3d4e5' // a real invite_code shape (lowercase alnum)

describe('extractJoinCode', () => {
  const cases: Array<[label: string, input: string, expected: string]> = [
    // The two REAL share artifacts (the ones commissioners actually paste):
    ['buildJoinLink absolute output', buildJoinLink('https://fieldscout.gg', CODE), CODE],
    ['wizard SuccessPanel copied URL shape', `https://fieldscout.gg/join/${CODE}`, CODE],
    // Every input form the field must tolerate:
    ['full absolute URL', 'https://fieldscout.gg/join/a1b2c3d4e5', 'a1b2c3d4e5'],
    ['bare-host (no protocol)', 'fieldscout.gg/join/a1b2c3d4e5', 'a1b2c3d4e5'],
    ['protocol-relative', '//fieldscout.gg/join/a1b2c3d4e5', 'a1b2c3d4e5'],
    ['path-only', '/join/a1b2c3d4e5', 'a1b2c3d4e5'],
    ['trailing slash', 'https://fieldscout.gg/join/a1b2c3d4e5/', 'a1b2c3d4e5'],
    ['query suffix', 'https://fieldscout.gg/join/a1b2c3d4e5?utm=share', 'a1b2c3d4e5'],
    ['hash suffix', 'https://fieldscout.gg/join/a1b2c3d4e5#top', 'a1b2c3d4e5'],
    ['query + trailing slash', 'https://fieldscout.gg/join/a1b2c3d4e5/?ref=x', 'a1b2c3d4e5'],
    ['a custom slug link', 'https://fieldscout.gg/join/yardboats-2026', 'yardboats-2026'],
    ['surrounding whitespace on a link', '  https://fieldscout.gg/join/a1b2c3d4e5  ', 'a1b2c3d4e5'],
    // Bare code/slug passthrough (no /join/) — must survive untouched:
    ['a bare code passes through trimmed', '  a1b2c3d4e5  ', 'a1b2c3d4e5'],
    ['a bare custom slug passes through', 'yardboats-2026', 'yardboats-2026'],
    // Empty / whitespace-only → empty (the dialog then no-ops the submit):
    ['empty string', '', ''],
    ['whitespace only', '   ', ''],
  ]

  it.each(cases)('%s → %j', (_label, input, expected) => {
    expect(extractJoinCode(input)).toBe(expected)
  })

  it('preserves the case of a seat token (tokens are case-sensitive; only the RPC lower()s codes)', () => {
    // A wrong-cased token would fail the exact-match resolution — so extraction
    // must NOT lowercase. The /join/ marker match is case-insensitive; the
    // extracted segment keeps its bytes.
    expect(extractJoinCode('https://fieldscout.gg/join/AbC123dEf0')).toBe('AbC123dEf0')
  })

  it('yields empty for a /join/ link with no code, so the dialog no-ops rather than pushing a dead segment', () => {
    expect(extractJoinCode('https://fieldscout.gg/join/')).toBe('')
    expect(extractJoinCode('/join/')).toBe('')
  })
})
