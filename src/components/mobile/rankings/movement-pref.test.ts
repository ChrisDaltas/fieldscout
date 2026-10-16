import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MOVEMENT_DEFAULTS,
  MOVEMENT_PREF_KEY,
  readMovementPref,
  writeMovementPref,
} from '@/components/mobile/rankings/movement-pref'

/**
 * "Show movement" (Chris, 2026-10-15, gap list #33): ON by default on
 * someone else's ranking, OFF on your own — each remembered on this device.
 */

function storage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Show movement switches', () => {
  it('default on for others’ rankings, off for your own', () => {
    vi.stubGlobal('window', { localStorage: storage(), addEventListener: () => {}, removeEventListener: () => {} })
    expect(MOVEMENT_DEFAULTS).toEqual({ others: true, own: false })
    expect(readMovementPref('others')).toBe(true)
    expect(readMovementPref('own')).toBe(false)
  })

  it('remembers each switch on its own', () => {
    const s = storage()
    vi.stubGlobal('window', { localStorage: s })
    writeMovementPref('own', true)
    writeMovementPref('others', false)
    expect(JSON.parse(s.data.get(MOVEMENT_PREF_KEY)!)).toEqual({ own: true, others: false })
    expect(readMovementPref('own')).toBe(true)
    expect(readMovementPref('others')).toBe(false)
    writeMovementPref('own', false)
    expect(readMovementPref('own')).toBe(false)
    expect(readMovementPref('others')).toBe(false)
  })

  it('ignores a garbled value', () => {
    const s = storage()
    s.data.set(MOVEMENT_PREF_KEY, '{"own": "yes"')
    vi.stubGlobal('window', { localStorage: s })
    expect(readMovementPref('own')).toBe(false)
  })

  it('blocked storage (a private window) still switches for the visit and never throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('SecurityError')
        },
      },
    })
    expect(() => writeMovementPref('own', true)).not.toThrow()
    expect(readMovementPref('own')).toBe(true)
  })
})
