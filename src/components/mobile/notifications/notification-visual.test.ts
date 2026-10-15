import { describe, expect, it } from 'vitest'

import { NOTIF_PATH, notificationVisual, shortTime, subLine } from './notification-visual'

describe('mobile Notifications row look (m-home §2B)', () => {
  it('maps real types onto the design palette', () => {
    expect(notificationVisual({ type: 'league_trade_proposed', data: null })).toEqual({ path: NOTIF_PATH.trade, tone: 'blue' })
    expect(notificationVisual({ type: 'league_trade_executed', data: null }).tone).toBe('green')
    expect(notificationVisual({ type: 'league_trade_vetoed', data: null }).tone).toBe('red')
    expect(notificationVisual({ type: 'league_waiver_claim', data: { status: 'won' } as never })).toEqual({ path: NOTIF_PATH.plus, tone: 'green' })
    expect(notificationVisual({ type: 'league_waiver_claim', data: { status: 'lost' } as never })).toEqual({ path: NOTIF_PATH.alert, tone: 'red' })
    expect(notificationVisual({ type: 'list_updated', data: null })).toEqual({ path: NOTIF_PATH.lists, tone: 'purple' })
    expect(notificationVisual({ type: 'stat_correction_result', data: null }).tone).toBe('orange')
    expect(notificationVisual({ type: 'something_new', data: null }).tone).toBe('neutral')
  })

  it('short relative times', () => {
    const now = Date.UTC(2026, 9, 15, 12)
    const ago = (s: number) => new Date(now - s * 1000).toISOString()
    expect(shortTime(ago(20), now)).toBe('now')
    expect(shortTime(ago(8 * 60), now)).toBe('8m')
    expect(shortTime(ago(12 * 3600), now)).toBe('12h')
    expect(shortTime(ago(2 * 86_400), now)).toBe('2d')
    expect(shortTime(ago(15 * 86_400), now)).toBe('2w')
  })

  it('"{sub} · {time}", or the time alone', () => {
    expect(subLine('You added Kendrick Bourne for $1', '12h')).toBe('You added Kendrick Bourne for $1 · 12h')
    expect(subLine(null, '8m')).toBe('8m')
    expect(subLine('  ', '8m')).toBe('8m')
  })
})
