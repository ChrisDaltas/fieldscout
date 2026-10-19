/**
 * The phone Members screen's pure rules (gap list §4 item 106): which seat
 * offers what — desktop `InvitePanel`'s row rules, moved into a sheet — and
 * the invite form's words.
 */
import { describe, expect, it } from 'vitest'

import { CREATOR_SEAT_NOTE, type Seat } from '@/components/leagues/invite-panel-ops'

import { INVITE_MODES, INVITE_MODE_ORDER, inviteStatusLine, manageOptions, seatAction, seatActionLabel } from './members-ops'

function seat(over: Partial<Seat>): Seat {
  return {
    key: 'm2',
    status: 'claimed',
    teamName: 'Bravo',
    teamId: 't2',
    memberId: 'm2',
    role: 'manager',
    isSelf: false,
    identity: '@jason',
    username: 'jason',
    emailTarget: null,
    usernameTarget: null,
    invite: null,
    ...over,
  }
}

const COMMISH = { canManage: true, myRole: 'commissioner', seatUserId: 'user-jason', leagueOwnerId: 'user-owner' }
const INVITE = {
  id: 'inv-1',
  target_team_id: 't4',
  invited_email: 'new@example.com',
  invited_username: null,
  token: 'tok',
  max_uses: 1,
  use_count: 0,
  expires_at: '2999-01-01T00:00:00.000Z',
  revoked_at: null,
  created_at: null,
}

describe('seatAction — what a seat row offers (desktop’s per-row rules)', () => {
  it('a commissioner: manage a seated manager, invite to a team with no manager, the pending invite', () => {
    expect(seatAction(seat({}), COMMISH)).toEqual({ kind: 'manage' })
    expect(seatAction(seat({ role: 'co_commissioner' }), COMMISH)).toEqual({ kind: 'manage' })
    expect(seatAction(seat({ status: 'placeholder', username: null, identity: null }), COMMISH)).toEqual({ kind: 'invite' })
    expect(seatAction(seat({ status: 'invited', username: null, identity: null, invite: INVITE }), COMMISH)).toEqual({ kind: 'pending' })
  })

  it('nothing to press: your own seat (Leave is at the foot), the sitting commissioner’s, an open seat with no team', () => {
    expect(seatAction(seat({ isSelf: true }), COMMISH)).toEqual({ kind: 'none', note: null })
    expect(seatAction(seat({ role: 'commissioner' }), { ...COMMISH, myRole: 'co_commissioner' })).toEqual({ kind: 'none', note: null })
    expect(seatAction(seat({ status: 'open', teamId: null, memberId: null, role: null }), COMMISH)).toEqual({ kind: 'none', note: null })
    // A placeholder needs its team to invite to.
    expect(seatAction(seat({ status: 'placeholder', teamId: null }), COMMISH)).toEqual({ kind: 'none', note: null })
  })

  it('a manager is offered nothing on any seat', () => {
    const member = { ...COMMISH, canManage: false, myRole: 'manager' }
    for (const s of [seat({}), seat({ status: 'placeholder' }), seat({ status: 'invited', invite: INVITE })]) {
      expect(seatAction(s, member)).toEqual({ kind: 'none', note: null })
    }
  })

  it('§7.2 anti-coup: a co-commissioner on the league creator’s seat is told why — never offered and refused', () => {
    const co = { canManage: true, myRole: 'co_commissioner', seatUserId: 'user-owner', leagueOwnerId: 'user-owner' }
    expect(seatAction(seat({}), co)).toEqual({ kind: 'none', note: CREATOR_SEAT_NOTE })
    // The sitting commissioner may change it.
    expect(seatAction(seat({}), { ...co, myRole: 'commissioner' })).toEqual({ kind: 'manage' })
  })

  it('the control is said for a screen reader, by team', () => {
    expect(seatActionLabel('manage', 'Bravo')).toBe('Manage Bravo')
    expect(seatActionLabel('invite', 'Echo')).toBe('Invite a manager to Echo')
    expect(seatActionLabel('pending', 'Delta')).toBe('The invite to Delta')
  })
})

describe('manageOptions — a seated manager’s sheet', () => {
  it('a manager: make co-commissioner, the transfer (sitting commissioner only), remove', () => {
    expect(manageOptions(seat({}), 'commissioner').map((o) => o.key)).toEqual(['make_co', 'transfer', 'remove'])
    expect(manageOptions(seat({}), 'co_commissioner').map((o) => o.key)).toEqual(['make_co', 'remove'])
  })
  it('a co-commissioner: make manager instead; remove is always last', () => {
    expect(manageOptions(seat({ role: 'co_commissioner' }), 'commissioner')).toEqual([
      { key: 'make_manager', label: 'Make manager' },
      { key: 'transfer', label: 'Make commissioner' },
      { key: 'remove', label: 'Remove manager' },
    ])
  })
  it('no retire anywhere (L.E1.42 — the team lives)', () => {
    for (const role of ['manager', 'co_commissioner']) {
      expect(JSON.stringify(manageOptions(seat({ role }), 'commissioner'))).not.toMatch(/retire/i)
    }
  })
})

describe('the invite form', () => {
  it('email first, then username, then assign — each says what it does', () => {
    expect(INVITE_MODE_ORDER).toEqual(['email', 'username', 'assign'])
    expect(INVITE_MODES.email).toMatchObject({ inputType: 'email', ariaLabel: 'Invite by email', button: 'Send invite' })
    expect(INVITE_MODES.email.hint).toContain('no account needed first')
    expect(INVITE_MODES.username).toMatchObject({ inputType: 'text', placeholder: '@username', button: 'Send invite' })
    expect(INVITE_MODES.assign).toMatchObject({ inputType: 'text', placeholder: '@username', button: 'Assign' })
    expect(INVITE_MODES.assign.hint).toContain('right away')
  })
  it('an invite’s line: when it runs out, or why it no longer works', () => {
    expect(inviteStatusLine('active', '2999-01-01T12:00:00.000Z')).toMatch(/^Expires /)
    expect(inviteStatusLine('expired', '2000-01-01T00:00:00.000Z')).toBe('Invite expired')
    expect(inviteStatusLine('revoked', '2999-01-01T00:00:00.000Z')).toBe('Invite revoked')
  })
})
