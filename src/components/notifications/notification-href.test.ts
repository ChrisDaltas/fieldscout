import { describe, expect, it } from 'vitest'

import { notificationHref } from './notification-href'

/**
 * F30 pin — the `league_invite` notification row renders as a LINK to the
 * /join/[token] claim page (L.A2.6 builds that destination). Before this arm,
 * `notifications-feed` built hrefs from `list_id` only, so a username-invite
 * notification was inert text.
 */
describe('notificationHref', () => {
  it('links a league_invite to /join/[token] (F30 — the invitee claim page)', () => {
    expect(
      notificationHref({
        type: 'league_invite',
        data: { league_id: 'lg-1', token: 'abc123deadbeef', event: 'invited' },
      }),
    ).toBe('/join/abc123deadbeef')
  })

  it('encodes the token in the /join path', () => {
    expect(
      notificationHref({ type: 'league_invite', data: { token: 'a/b c?d' } }),
    ).toBe(`/join/${encodeURIComponent('a/b c?d')}`)
  })

  it('keeps the pre-existing list arm', () => {
    expect(
      notificationHref({ type: 'list_update', data: { list_id: 'list-9', actor_id: 'u1' } }),
    ).toBe('/app/lists/list-9')
  })

  it('is inert when a league_invite carries no token (defensive)', () => {
    expect(
      notificationHref({ type: 'league_invite', data: { league_id: 'lg-1', event: 'invited' } }),
    ).toBeNull()
  })

  it('leaves league_member (removal/leave) inert — routed to L.A2.7 (F34)', () => {
    expect(
      notificationHref({
        type: 'league_member',
        data: { league_id: 'lg-1', team_id: 't-1', event: 'removed' },
      }),
    ).toBeNull()
  })

  it('is inert for an unknown type with no linkable data', () => {
    expect(notificationHref({ type: 'mystery', data: null })).toBeNull()
    expect(notificationHref({ type: 'league_invite', data: null })).toBeNull()
  })
})
