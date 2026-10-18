import { describe, expect, it } from 'vitest'

import { mobileNotificationHref } from './mobile-notification-href'

const n = (type: string, data: Record<string, unknown> | null) => ({ type, data: data as never })

describe('mobile Notifications row doors (m-home §3, m-dock §2.10)', () => {
  it("a trade row opens that trade's detail over the league's Trades page", () => {
    expect(mobileNotificationHref(n('league_trade_proposed', { league_id: 'L1', trade_id: 'T9' }))).toBe('/app/leagues/L1/trades?trade=T9')
    expect(mobileNotificationHref(n('league_trade_executed', { league_id: 'L1', trade_id: 'T9' }))).toBe('/app/leagues/L1/trades?trade=T9')
    // No trade id: the shared target (the Trades page).
    expect(mobileNotificationHref(n('league_trade_proposed', { league_id: 'L1' }))).toBe('/app/leagues/L1/trades')
  })

  it('every waiver result opens My moves — won, lost or failed (gap list §3 #12)', () => {
    for (const status of ['won', 'lost', 'invalid', undefined]) {
      expect(mobileNotificationHref(n('league_waiver_claim', { league_id: 'L1', status }))).toBe('/app/leagues/L1/activity/transactions?mine=1')
    }
    // No league id: still nowhere to go.
    expect(mobileNotificationHref(n('league_waiver_claim', { status: 'won' }))).toBeNull()
  })

  it('every other row keeps the shared target', () => {
    expect(mobileNotificationHref(n('list_updated', { list_id: 'x' }))).toBe('/app/lists/x')
    expect(mobileNotificationHref(n('league_member', { league_id: 'L1' }))).toBe('/app/leagues/L1')
    // Gap list #13 (192): a commissioner-note change → the League tab, where the note is pinned on top.
    expect(mobileNotificationHref(n('league_commissioner_note', { league_id: 'L1', actor_id: 'u1' }))).toBe('/app/leagues/L1')
    expect(mobileNotificationHref(n('something_new', null))).toBeNull()
  })
})
