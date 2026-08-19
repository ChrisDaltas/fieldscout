import { readFileSync } from 'node:fs'
import path from 'node:path'

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

  it('links a league_member row to the league home (F34 — removed / left)', () => {
    // The removal notification writes { league_id, team_id, event } and no
    // token; L.A2.7 builds the league home, so this arm now resolves.
    expect(
      notificationHref({
        type: 'league_member',
        data: { league_id: 'lg-1', team_id: 't-1', event: 'removed' },
      }),
    ).toBe('/app/leagues/lg-1')
    // The leave path (Q11/v2.8.9 — the departing user is notified too).
    expect(
      notificationHref({
        type: 'league_member',
        data: { league_id: 'lg-9', event: 'left' },
      }),
    ).toBe('/app/leagues/lg-9')
  })

  it('is inert when a league_member row carries no league_id (defensive)', () => {
    expect(
      notificationHref({ type: 'league_member', data: { team_id: 't-1', event: 'removed' } }),
    ).toBeNull()
  })

  it('is inert for an unknown type with no linkable data', () => {
    expect(notificationHref({ type: 'mystery', data: null })).toBeNull()
    expect(notificationHref({ type: 'league_invite', data: null })).toBeNull()
  })
})

/**
 * DR.6 item 2 — RULED (Chris, 2026-08-17; spec §16.1 v2.12): draft
 * notifications route to the league/app home, where the Join Draft CTAs are
 * the ONE entry point into the room — because that entry point is where the
 * desktop-new-tab / mobile-in-place split lives (`useRoomEntryTarget`). A
 * notification href pointing straight at `/draft` would silently bypass the
 * split. The 2026-08-18 sweep found NO arm that targets `/draft` (no
 * draft-event arm exists at all yet); these pins keep it that way when one
 * is added.
 */
describe('draft notifications never deep-link into the room (§16.1 v2.12)', () => {
  it('no arm emits a /draft href, even for draft-shaped events', () => {
    const draftShaped = [
      { type: 'draft_started', data: { league_id: 'lg-1', draft_id: 'd-1' } },
      { type: 'league_draft', data: { league_id: 'lg-1', draft_id: 'd-1' } },
      { type: 'league_member', data: { league_id: 'lg-1', event: 'draft_started' } },
      { type: 'league_invite', data: { token: 'tok-1', draft_id: 'd-1' } },
      { type: 'list_update', data: { list_id: 'list-1', draft_id: 'd-1' } },
    ]
    for (const n of draftShaped) {
      const href = notificationHref(n)
      // Either inert, or a destination OUTSIDE the room (the league home
      // arm is the ruled landing: the split-carrying CTA is one tap away).
      expect(href === null || !href.includes('/draft'), `${n.type} → ${href}`).toBe(true)
    }
  })

  it('a draft-shaped league_member event still lands on the league home', () => {
    // The ruled destination, positively: the league home, never the room.
    expect(
      notificationHref({ type: 'league_member', data: { league_id: 'lg-1', event: 'draft_started' } }),
    ).toBe('/app/leagues/lg-1')
  })

  it('the mapping source itself never names the room path', () => {
    // Source pin: a future arm hard-coding `/draft` fails HERE even if its
    // type never appears in the behavioral battery above.
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/components/notifications/notification-href.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(source).not.toContain('/draft')
  })
})
