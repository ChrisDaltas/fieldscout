/**
 * waiverHoldLapsed — a player whose waiver hold has run out reads as a free
 * agent (Chris 2026-11-18: players showed "On waivers until Wed, Oct 7" in
 * November). Mirrors the add RPC's lapse rule (149).
 */
import { describe, expect, it } from 'vitest'

import { waiverHoldLapsed } from './use-league-pool'

const at = Date.parse('2026-11-18T12:00:00Z')

describe('waiverHoldLapsed', () => {
  it('a hold whose run has been processed has lapsed', () => {
    expect(waiverHoldLapsed('2026-10-07T07:00:00Z', '2026-11-19T07:00:00Z', at)).toBe(true)
  })

  it('a hold that has not reached its instant is still running', () => {
    expect(waiverHoldLapsed('2026-11-19T07:00:00Z', '2026-11-19T07:00:00Z', at)).toBe(false)
  })

  it('a hold whose instant has passed but whose run is not yet processed is still running', () => {
    expect(waiverHoldLapsed('2026-11-18T07:00:00Z', '2026-11-18T07:00:00Z', at)).toBe(false)
  })

  it('with no run tracked, the instant alone decides', () => {
    expect(waiverHoldLapsed('2026-10-07T07:00:00Z', null, at)).toBe(true)
    expect(waiverHoldLapsed('2026-11-19T07:00:00Z', null, at)).toBe(false)
  })

  it('a hold with no instant is not lapsed', () => {
    expect(waiverHoldLapsed(null, null, at)).toBe(false)
  })
})
