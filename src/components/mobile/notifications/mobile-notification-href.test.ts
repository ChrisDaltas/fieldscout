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

  it('every waiver notification opens My moves — won, lost, failed or the commissioner’s (gap list §3 #12)', () => {
    for (const status of ['won', 'lost', 'invalid', undefined]) {
      expect(mobileNotificationHref(n('league_waiver_claim', { league_id: 'L1', status }))).toBe('/app/leagues/L1/activity/transactions?mine=1')
    }
    // The commissioner placed, cancelled or reordered a claim on your team: My moves lists your pending claims.
    expect(mobileNotificationHref(n('league_waiver_claim_commissioner', { league_id: 'L1', team_id: 'T1' }))).toBe(
      '/app/leagues/L1/activity/transactions?mine=1',
    )
    // No league id: still nowhere to go.
    expect(mobileNotificationHref(n('league_waiver_claim', { status: 'won' }))).toBeNull()
    expect(mobileNotificationHref(n('league_waiver_claim_commissioner', { team_id: 'T1' }))).toBeNull()
  })

  it('every other row keeps the shared target', () => {
    expect(mobileNotificationHref(n('list_updated', { list_id: 'x' }))).toBe('/app/lists/x')
    // 213: someone commented on your list → your List view, its Comments
    // sheet opened on arrival (WPO-1; was the bare list, with no comment in sight).
    expect(mobileNotificationHref(n('list_comment', { list_id: 'x', actor_id: 'u2' }))).toBe('/app/lists?list=x&comments=1')
    expect(mobileNotificationHref(n('league_member', { league_id: 'L1' }))).toBe('/app/leagues/L1')
    // Gap list #13 (192): a commissioner-note change → the League tab, where the note is pinned on top.
    expect(mobileNotificationHref(n('league_commissioner_note', { league_id: 'L1', actor_id: 'u1' }))).toBe('/app/leagues/L1')
    expect(mobileNotificationHref(n('something_new', null))).toBeNull()
  })
})
